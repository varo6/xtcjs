// Merge logic for CBZ, PDF, and XTC files

import JSZip from 'jszip'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import { buildXtc } from './xtc-format'
import { extractXtcPages, extractXtcRawPages, parseXtcFile } from './xtc-reader'
import { TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export type FileType = 'cbz' | 'cbr' | 'pdf' | 'xtc' | 'unknown'
export type OutputFormat = 'xtc' | 'cbz' | 'pdf'

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
    case 'cbr':
      return 'cbr'
    case 'pdf':
      return 'pdf'
    case 'xtc':
      return 'xtc'
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
  onProgress: (progress: MergeProgress) => void
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
      return mergeXtcFiles(files, outputFormat, onProgress)
    default:
      throw new Error('Unsupported file type')
  }
}

/**
 * Merge CBZ files
 */
export async function mergeCbzFiles(
  files: File[],
  outputFormat: OutputFormat,
  onProgress: (progress: MergeProgress) => void
): Promise<MergeResult> {
  const allImages: { name: string; blob: Blob }[] = []
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
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
      if (imageExtensions.includes(ext)) {
        imageFiles.push({ path: relativePath, entry: zipEntry })
      }
    })

    imageFiles.sort((a, b) => a.path.localeCompare(b.path))

    for (let i = 0; i < imageFiles.length; i++) {
      const imgFile = imageFiles[i]
      const blob = await imgFile.entry.async('blob')
      const ext = imgFile.path.substring(imgFile.path.lastIndexOf('.'))

      allImages.push({
        name: `${String(globalIndex + 1).padStart(5, '0')}${ext}`,
        blob,
      })
      globalIndex++

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: (i + 1) / imageFiles.length,
      })
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
export async function mergePdfFiles(
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
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
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
export async function mergeXtcFiles(
  files: File[],
  outputFormat: OutputFormat,
  onProgress: (progress: MergeProgress) => void
): Promise<MergeResult> {
  if (outputFormat === 'xtc') {
    // Fast path: concatenate raw XTG data without decoding
    const allXtgData: ArrayBuffer[] = []

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx]
      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 0,
      })

      const buffer = await file.arrayBuffer()
      const rawPages = await extractXtcRawPages(buffer)
      allXtgData.push(...rawPages)

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 1,
      })
    }

    const data = buildXtcFromRawPages(allXtgData)
    return {
      name: 'merged.xtc',
      data,
      size: data.byteLength,
      pageCount: allXtgData.length,
    }
  } else {
    // Output CBZ: need to decode XTC pages to images
    const allCanvases: HTMLCanvasElement[] = []

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx]
      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 0,
      })

      const buffer = await file.arrayBuffer()
      const canvases = await extractXtcPages(buffer)
      allCanvases.push(...canvases)

      onProgress({
        file: file.name,
        fileIndex: fileIdx,
        totalFiles: files.length,
        pageProgress: 1,
      })
    }

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
  const results: { data: ArrayBuffer; pageCount: number }[] = []

  for (const range of ranges) {
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
    results.push({
      data: data.buffer as ArrayBuffer,
      pageCount: copiedPages.length,
    })
  }

  return results
}

/**
 * Build XTC from raw XTG page data (fast path for XTC merge)
 */
function buildXtcFromRawPages(xtgBlobs: ArrayBuffer[]): ArrayBuffer {
  const pageCount = xtgBlobs.length
  const headerSize = 48
  const indexEntrySize = 16
  const indexOffset = headerSize
  const dataOffset = indexOffset + pageCount * indexEntrySize

  let totalSize = dataOffset
  for (const blob of xtgBlobs) {
    totalSize += blob.byteLength
  }

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8 = new Uint8Array(buffer)

  // Header: XTC magic number
  uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x00
  view.setUint16(4, 1, true) // version
  view.setUint16(6, pageCount, true)
  view.setUint8(8, 0)
  view.setUint8(9, 0)
  view.setUint8(10, 0)
  view.setUint8(11, 0)
  view.setUint32(12, 0, true)

  setBigUint64(view, 16, 0n)
  setBigUint64(view, 24, BigInt(indexOffset))
  setBigUint64(view, 32, BigInt(dataOffset))
  setBigUint64(view, 40, 0n)

  // Write index entries
  let relOffset = dataOffset
  for (let i = 0; i < pageCount; i++) {
    const blob = xtgBlobs[i]
    const entryOffset = indexOffset + i * indexEntrySize

    setBigUint64(view, entryOffset, BigInt(relOffset))
    view.setUint32(entryOffset + 8, blob.byteLength, true)
    view.setUint16(entryOffset + 12, TARGET_WIDTH, true)
    view.setUint16(entryOffset + 14, TARGET_HEIGHT, true)

    relOffset += blob.byteLength
  }

  // Write page data
  let writeOffset = dataOffset
  for (const blob of xtgBlobs) {
    uint8.set(new Uint8Array(blob), writeOffset)
    writeOffset += blob.byteLength
  }

  return buffer
}

/**
 * Helper to set 64-bit unsigned integer (little-endian)
 */
function setBigUint64(view: DataView, offset: number, value: bigint): void {
  const low = Number(value & 0xFFFFFFFFn)
  const high = Number(value >> 32n)
  view.setUint32(offset, low, true)
  view.setUint32(offset + 4, high, true)
}

/**
 * Convert image blobs to canvases (resized for XTC)
 */
async function imageBlobsToCanvases(
  blobs: Blob[],
  onProgress: (index: number, total: number, preview?: string) => void
): Promise<HTMLCanvasElement[]> {
  const canvases: HTMLCanvasElement[] = []

  for (let i = 0; i < blobs.length; i++) {
    const canvas = await blobToCanvas(blobs[i])
    const resized = resizeCanvasForXtc(canvas)
    canvases.push(resized)

    onProgress(i + 1, blobs.length, resized.toDataURL('image/png'))
  }

  return canvases
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
