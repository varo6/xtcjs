// Merge logic for CBZ, PDF, and XTC files

import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { buildXtc, buildXtcFromBuffers } from './xtc-format'
import { decodeXtcPageToCanvas, parseXtcFile } from './xtc-reader'
import { sliceChapters } from './metadata/chapters'
import type { BookMetadata, TocEntry } from './metadata/types'
import { loadPdfDocument } from './pdfjs'
import { TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas'
import { mapWithConcurrency } from './concurrency'

export type FileType = 'cbz' | 'pdf' | 'xtc' | 'xtch' | 'unknown'
export type OutputFormat = 'xtc' | 'cbz' | 'pdf'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

export interface MergeResult {
  name: string
  data: ArrayBuffer
  size: number
  pageCount: number
  pageImages?: string[]
}

export interface MergeProgress {
  file: string
  fileIndex: number
  totalFiles: number
  pageProgress: number
  previewUrl?: string
}

/**
 * Detect file type from extension
 */
export function detectFileType(file: File): FileType {
  const ext = file.name.toLowerCase().split('.').pop()
  switch (ext) {
    case 'cbz':
      return 'cbz'
    case 'pdf':
      return 'pdf'
    case 'xtc':
      return 'xtc'
    case 'xtch':
      return 'xtch'
    default:
      return 'unknown'
  }
}

/**
 * Validate that all files are the same type
 */
export function validateSameType(files: File[]): { valid: boolean; type: FileType; error?: string } {
  if (files.length === 0) {
    return { valid: false, type: 'unknown', error: 'No files provided' }
  }

  const firstType = detectFileType(files[0])
  if (firstType === 'unknown') {
    return { valid: false, type: 'unknown', error: 'Unsupported file type' }
  }

  for (let i = 1; i < files.length; i++) {
    const type = detectFileType(files[i])
    if (type !== firstType) {
      return { valid: false, type: firstType, error: 'All files must be the same type' }
    }
  }

  return { valid: true, type: firstType }
}

/**
 * Merge files into a single output
 */
export async function mergeFiles(
  files: File[],
  outputFormat: OutputFormat,
  onProgress: (progress: MergeProgress) => void,
  createChapters = false,
): Promise<MergeResult> {
  const validation = validateSameType(files)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  switch (validation.type) {
    case 'cbz':
      return mergeCbzFiles(files, outputFormat, onProgress)
    case 'pdf':
      return mergePdfFiles(files, outputFormat, onProgress)
    case 'xtc':
    case 'xtch':
      return mergeXtcFiles(files, outputFormat, onProgress, createChapters)
    default:
      throw new Error('Unsupported file type')
  }
}

/**
 * Merge CBZ files
 */
async function mergeCbzFiles(
  files: File[],
  outputFormat: OutputFormat,
  onProgress: (progress: MergeProgress) => void
): Promise<MergeResult> {
  const allImages: { name: string; blob: Blob }[] = []
  let globalIndex = 0

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx]
    onProgress({
      file: file.name,
      fileIndex: fileIdx,
      totalFiles: files.length,
      pageProgress: 0,
    })

    const zip = await JSZip.loadAsync(file)
    const imageFiles: Array<{ path: string; entry: any }> = []

    zip.forEach((relativePath: string, zipEntry: any) => {
      if (zipEntry.dir) return
      if (relativePath.toLowerCase().startsWith('__macos')) return

      const ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'))
      if (IMAGE_EXTENSIONS.has(ext)) {
        imageFiles.push({ path: relativePath, entry: zipEntry })
      }
    })

    imageFiles.sort((a, b) => a.path.localeCompare(b.path))

    let completedImages = 0
    const imageBlobs = await mapWithConcurrency(imageFiles, async (imgFile) => {
      const blob = await imgFile.entry.async('blob')
      completedImages++
      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: completedImages / imageFiles.length,
      })
      return { path: imgFile.path, blob }
    })

    for (const imgFile of imageBlobs) {
      const ext = imgFile.path.substring(imgFile.path.lastIndexOf('.'))

      allImages.push({
        name: `${String(globalIndex + 1).padStart(5, '0')}${ext}`,
        blob: imgFile.blob,
      })
      globalIndex++
    }
  }

  if (outputFormat === 'cbz') {
    const data = await buildCbz(allImages)
    return {
      name: 'merged.cbz',
      data,
      size: data.byteLength,
      pageCount: allImages.length,
    }
  } else {
    // Convert to XTC
    const canvases = await imageBlobsToCanvases(allImages.map(img => img.blob), (i, total, preview) => {
      onProgress({
        file: 'Converting to XTC',
        fileIndex: files.length - 1,
        totalFiles: files.length,
        pageProgress: i / total,
        previewUrl: preview,
      })
    })

    const pages = canvases.map((canvas, i) => ({
      name: `${String(i).padStart(5, '0')}.png`,
      canvas,
    }))

    const pageImages = pages.map(p => p.canvas.toDataURL('image/png'))
    const data = await buildXtc(pages)

    return {
      name: 'merged.xtc',
      data,
      size: data.byteLength,
      pageCount: pages.length,
      pageImages,
    }
  }
}

/**
 * Merge PDF files
 */
async function mergePdfFiles(
  files: File[],
  outputFormat: OutputFormat,
  onProgress: (progress: MergeProgress) => void
): Promise<MergeResult> {
  // For PDF output, use pdf-lib for efficient merging
  if (outputFormat === 'pdf') {
    const mergedPdf = await PDFDocument.create()
    let totalPages = 0

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx]
      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 0,
      })

      const arrayBuffer = await file.arrayBuffer()
      const srcPdf = await PDFDocument.load(arrayBuffer)
      const pageIndices = srcPdf.getPageIndices()
      const copiedPages = await mergedPdf.copyPages(srcPdf, pageIndices)

      for (const page of copiedPages) {
        mergedPdf.addPage(page)
        totalPages++
      }

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 1,
      })
    }

    const data = await mergedPdf.save()
    return {
      name: 'merged.pdf',
      data: data.buffer as ArrayBuffer,
      size: data.byteLength,
      pageCount: totalPages,
    }
  }

  // For CBZ or XTC output, render PDF pages to canvases
  const allCanvases: HTMLCanvasElement[] = []

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx]
    onProgress({
      file: file.name,
      fileIndex: fileIdx,
      totalFiles: files.length,
      pageProgress: 0,
    })

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await loadPdfDocument(arrayBuffer)
    const numPages = pdf.numPages

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i)
      const scale = 2.0
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({
        canvas,
        viewport,
        background: 'rgb(255,255,255)',
      }).promise

      allCanvases.push(canvas)

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: i / numPages,
        previewUrl: canvas.toDataURL('image/png'),
      })
    }
  }

  if (outputFormat === 'cbz') {
    const images = allCanvases.map((canvas, i) => ({
      name: `${String(i + 1).padStart(5, '0')}.png`,
      blob: dataURLtoBlob(canvas.toDataURL('image/png')),
    }))

    const data = await buildCbz(images)
    return {
      name: 'merged.cbz',
      data,
      size: data.byteLength,
      pageCount: allCanvases.length,
    }
  } else {
    const pages = allCanvases.map((canvas, i) => ({
      name: `${String(i).padStart(5, '0')}.png`,
      canvas: resizeCanvasForXtc(canvas),
    }))

    const pageImages = pages.map(p => p.canvas.toDataURL('image/png'))
    const data = await buildXtc(pages)

    return {
      name: 'merged.xtc',
      data,
      size: data.byteLength,
      pageCount: pages.length,
      pageImages,
    }
  }
}

/**
 * Merge XTC files
 */
async function mergeXtcFiles(
  files: File[],
  outputFormat: OutputFormat,
  onProgress: (progress: MergeProgress) => void,
  createChapters: boolean,
): Promise<MergeResult> {
  if (outputFormat === 'xtc') {
    // Keep encoded page bytes, including XTCH bitplanes, unchanged.
    const allXtgData: ArrayBuffer[] = []
    const chapters: TocEntry[] = []
    let metadata: BookMetadata = { toc: [] }
    let is2bit = false

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx]
      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 0,
      })

      const buffer = await file.arrayBuffer()
      const parsed = await parseXtcFile(buffer)
      if (fileIdx === 0) {
        is2bit = parsed.header.is2bit
        metadata = parsed.metadata ?? { toc: [] }
      } else if (parsed.header.is2bit !== is2bit) {
        throw new Error('XTC and XTCH files must have the same bit depth to merge. Convert them to the same format first.')
      }
      if (parsed.pageData.length === 0) throw new Error(`${file.name} contains no pages`)
      const offset = allXtgData.length
      const fileChapters = createChapters
        ? [{ title: file.name.replace(/\.xtch?$/i, '').trim() || `Chapter ${fileIdx + 1}`,
            startPage: 1, endPage: parsed.pageData.length }]
        : sliceChapters(parsed.metadata?.toc ?? [], 1, parsed.pageData.length)
      chapters.push(...fileChapters.map(chapter => ({
        ...chapter, startPage: chapter.startPage + offset, endPage: chapter.endPage + offset,
      })))
      allXtgData.push(...parsed.pageData)

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 1,
      })
    }

    const data = await buildXtcFromBuffers(allXtgData, { is2bit, metadata: { ...metadata, toc: chapters } })
    return {
      name: is2bit ? 'merged.xtch' : 'merged.xtc',
      data,
      size: data.byteLength,
      pageCount: allXtgData.length,
    }
  } else {
    // Output CBZ: need to decode XTC pages to images
    const images: { name: string; blob: Blob }[] = []

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx]
      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 0,
      })

      const buffer = await file.arrayBuffer()
      const parsed = await parseXtcFile(buffer)
      for (const page of parsed.pageData) {
        const canvas = decodeXtcPageToCanvas(page)
        images.push({
          name: `${String(images.length + 1).padStart(5, '0')}.png`,
          blob: dataURLtoBlob(canvas.toDataURL('image/png')),
        })
        canvas.width = canvas.height = 0
      }

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 1,
      })
    }

    const data = await buildCbz(images)
    return {
      name: 'merged.cbz',
      data,
      size: data.byteLength,
      pageCount: images.length,
    }
  }
}

/**
 * Build a CBZ file from images
 */
export async function buildCbz(images: { name: string; blob: Blob }[]): Promise<ArrayBuffer> {
  const zip = new JSZip()

  for (const img of images) {
    zip.file(img.name, img.blob)
  }

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

/**
 * Split a PDF file by page ranges
 */
export async function splitPdf(
  file: File,
  ranges: { start: number; end: number }[]
): Promise<{ data: ArrayBuffer; pageCount: number }[]> {
  const arrayBuffer = await file.arrayBuffer()
  const srcPdf = await PDFDocument.load(arrayBuffer)

  return mapWithConcurrency(ranges, async (range) => {
    const newPdf = await PDFDocument.create()
    // PDF pages are 0-indexed in pdf-lib, but our ranges are 1-indexed
    const pageIndices = []
    for (let i = range.start - 1; i < range.end; i++) {
      pageIndices.push(i)
    }
    const copiedPages = await newPdf.copyPages(srcPdf, pageIndices)
    for (const page of copiedPages) {
      newPdf.addPage(page)
    }
    const data = await newPdf.save()
    return {
      data: data.buffer as ArrayBuffer,
      pageCount: copiedPages.length,
    }
  }, 3)
}

/**
 * Convert image blobs to canvases (resized for XTC)
 */
async function imageBlobsToCanvases(
  blobs: Blob[],
  onProgress: (index: number, total: number, preview?: string) => void
): Promise<HTMLCanvasElement[]> {
  let completedImages = 0
  return mapWithConcurrency(blobs, async (blob) => {
    const canvas = await blobToCanvas(blob)
    const resized = resizeCanvasForXtc(canvas)

    completedImages++
    onProgress(completedImages, blobs.length, resized.toDataURL('image/png'))
    return resized
  }, 4)
}

/**
 * Convert blob to canvas
 */
function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(canvas)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

/**
 * Resize canvas for XTC format (480x800)
 */
function resizeCanvasForXtc(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const result = document.createElement('canvas')
  result.width = TARGET_WIDTH
  result.height = TARGET_HEIGHT
  const ctx = result.getContext('2d')!

  // Fill with white
  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT)

  // Calculate scale to fit
  const scale = Math.min(TARGET_WIDTH / canvas.width, TARGET_HEIGHT / canvas.height)
  const newWidth = Math.floor(canvas.width * scale)
  const newHeight = Math.floor(canvas.height * scale)

  // Center the image
  const x = Math.floor((TARGET_WIDTH - newWidth) / 2)
  const y = Math.floor((TARGET_HEIGHT - newHeight) / 2)

  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, newWidth, newHeight)

  return result
}

/**
 * Convert data URL to Blob
 */
function dataURLtoBlob(dataURL: string): Blob {
  const parts = dataURL.split(',')
  const mime = parts[0].match(/:(.*?);/)![1]
  const bstr = atob(parts[1])
  const n = bstr.length
  const u8arr = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i)
  }

  return new Blob([u8arr], { type: mime })
}
