// Split logic for CBZ, PDF, and XTC files

import JSZip from 'jszip'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { buildXtc } from './xtc-format'
import { parseXtcFile } from './xtc-reader'
import { buildCbz, splitPdf, type OutputFormat, detectFileType } from './merge'
import { TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export interface PageRange {
  start: number
  end: number
}

export interface SplitResult {
  name: string
  data: ArrayBuffer
  size: number
  pageCount: number
  pageImages?: string[]
}

export interface SplitProgress {
  phase: 'extracting' | 'building'
  rangeIndex: number
  totalRanges: number
  pageProgress: number
  previewUrl?: string
}

/**
 * Parse page range string like "1-10, 11-20, 21-30"
 */
export function parsePageRanges(input: string, totalPages: number): PageRange[] {
  const ranges: PageRange[] = []
  const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0)

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim())
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${part}`)
      }

      if (start < 1 || end > totalPages || start > end) {
        throw new Error(`Invalid range: ${part} (total pages: ${totalPages})`)
      }

      ranges.push({ start, end })
    } else {
      const page = parseInt(part, 10)
      if (isNaN(page) || page < 1 || page > totalPages) {
        throw new Error(`Invalid page: ${part} (total pages: ${totalPages})`)
      }
      ranges.push({ start: page, end: page })
    }
  }

  return ranges
}

/**
 * Calculate page ranges for splitting into N equal parts
 */
export function calculateEqualParts(totalPages: number, parts: number): PageRange[] {
  if (parts < 1) {
    throw new Error('Must have at least 1 part')
  }
  if (parts > totalPages) {
    throw new Error(`Cannot split ${totalPages} pages into ${parts} parts`)
  }

  const ranges: PageRange[] = []
  const pagesPerPart = Math.floor(totalPages / parts)
  const remainder = totalPages % parts

  let currentPage = 1
  for (let i = 0; i < parts; i++) {
    const pagesInThisPart = pagesPerPart + (i < remainder ? 1 : 0)
    ranges.push({
      start: currentPage,
      end: currentPage + pagesInThisPart - 1,
    })
    currentPage += pagesInThisPart
  }

  return ranges
}

/**
 * Get total page count for a file
 */
export async function getPageCount(file: File): Promise<number> {
  const type = detectFileType(file)

  switch (type) {
    case 'cbz':
      return getCbzPageCount(file)
    case 'pdf':
      return getPdfPageCount(file)
    case 'xtc':
      const buffer = await file.arrayBuffer()
      const parsed = await parseXtcFile(buffer)
      return parsed.header.pageCount
    default:
      throw new Error('Unsupported file type')
  }
}

async function getCbzPageCount(file: File): Promise<number> {
  const zip = await JSZip.loadAsync(file)
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
  let count = 0

  zip.forEach((relativePath: string, zipEntry: any) => {
    if (zipEntry.dir) return
    if (relativePath.toLowerCase().startsWith('__macos')) return
    const ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'))
    if (imageExtensions.includes(ext)) count++
  })

  return count
}

async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  return pdf.numPages
}

/**
 * Split a file into multiple parts based on page ranges
 * Optimized: only extracts the pages needed for each range
 */
export async function splitFile(
  file: File,
  ranges: PageRange[],
  outputFormat: OutputFormat,
  onProgress: (progress: SplitProgress) => void
): Promise<SplitResult[]> {
  const type = detectFileType(file)

  switch (type) {
    case 'cbz':
      return splitCbzFile(file, ranges, outputFormat, onProgress)
    case 'pdf':
      return splitPdfFile(file, ranges, outputFormat, onProgress)
    case 'xtc':
      return splitXtcFile(file, ranges, outputFormat, onProgress)
    default:
      throw new Error('Unsupported file type')
  }
}

/**
 * Split CBZ - only extract images for each range
 */
async function splitCbzFile(
  file: File,
  ranges: PageRange[],
  outputFormat: OutputFormat,
  onProgress: (progress: SplitProgress) => void
): Promise<SplitResult[]> {
  const zip = await JSZip.loadAsync(file)
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
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

  const baseName = file.name.replace(/\.cbz$/i, '')
  const results: SplitResult[] = []

  for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
    const range = ranges[rangeIdx]
    const pageCount = range.end - range.start + 1

    onProgress({
      phase: 'building',
      rangeIndex: rangeIdx,
      totalRanges: ranges.length,
      pageProgress: 0,
    })

    // Only extract images for this range
    const rangeImages: { name: string; blob: Blob }[] = []
    for (let i = range.start - 1; i < range.end; i++) {
      const imgFile = imageFiles[i]
      const blob = await imgFile.entry.async('blob')
      const ext = imgFile.path.substring(imgFile.path.lastIndexOf('.'))
      rangeImages.push({
        name: `${String(rangeImages.length + 1).padStart(5, '0')}${ext}`,
        blob,
      })

      onProgress({
        phase: 'building',
        rangeIndex: rangeIdx,
        totalRanges: ranges.length,
        pageProgress: (rangeImages.length) / pageCount,
      })
    }

    if (outputFormat === 'cbz') {
      const data = await buildCbz(rangeImages)
      results.push({
        name: `${baseName}_part${rangeIdx + 1}.cbz`,
        data,
        size: data.byteLength,
        pageCount: rangeImages.length,
      })
    } else {
      // Convert to XTC
      const canvases = await blobsToCanvases(rangeImages.map(i => i.blob))
      const pages = canvases.map((canvas, i) => ({
        name: `${String(i).padStart(5, '0')}.png`,
        canvas: resizeCanvasForXtc(canvas),
      }))
      const pageImages = pages.map(p => p.canvas.toDataURL('image/png'))
      const data = await buildXtc(pages)

      results.push({
        name: `${baseName}_part${rangeIdx + 1}.xtc`,
        data,
        size: data.byteLength,
        pageCount: pages.length,
        pageImages,
      })
    }
  }

  return results
}

/**
 * Split PDF - only render pages for each range
 */
async function splitPdfFile(
  file: File,
  ranges: PageRange[],
  outputFormat: OutputFormat,
  onProgress: (progress: SplitProgress) => void
): Promise<SplitResult[]> {
  const baseName = file.name.replace(/\.pdf$/i, '')

  // For PDF output, use pdf-lib for efficient splitting
  if (outputFormat === 'pdf') {
    onProgress({
      phase: 'extracting',
      rangeIndex: 0,
      totalRanges: ranges.length,
      pageProgress: 0,
    })

    const pdfResults = await splitPdf(file, ranges)
    const results: SplitResult[] = []

    for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
      const { data, pageCount } = pdfResults[rangeIdx]
      results.push({
        name: `${baseName}_part${rangeIdx + 1}.pdf`,
        data,
        size: data.byteLength,
        pageCount,
      })

      onProgress({
        phase: 'building',
        rangeIndex: rangeIdx,
        totalRanges: ranges.length,
        pageProgress: 1,
      })
    }

    return results
  }

  // For CBZ or XTC output, render PDF pages to canvases
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const results: SplitResult[] = []

  for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
    const range = ranges[rangeIdx]
    const pageCount = range.end - range.start + 1

    onProgress({
      phase: 'building',
      rangeIndex: rangeIdx,
      totalRanges: ranges.length,
      pageProgress: 0,
    })

    // Only render pages for this range
    const rangeCanvases: HTMLCanvasElement[] = []
    for (let pageNum = range.start; pageNum <= range.end; pageNum++) {
      const page = await pdf.getPage(pageNum)
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

      rangeCanvases.push(canvas)

      onProgress({
        phase: 'building',
        rangeIndex: rangeIdx,
        totalRanges: ranges.length,
        pageProgress: rangeCanvases.length / pageCount,
        previewUrl: canvas.toDataURL('image/png'),
      })
    }

    if (outputFormat === 'cbz') {
      const images = rangeCanvases.map((canvas, i) => ({
        name: `${String(i + 1).padStart(5, '0')}.png`,
        blob: dataURLtoBlob(canvas.toDataURL('image/png')),
      }))
      const data = await buildCbz(images)

      results.push({
        name: `${baseName}_part${rangeIdx + 1}.cbz`,
        data,
        size: data.byteLength,
        pageCount: rangeCanvases.length,
      })
    } else {
      const pages = rangeCanvases.map((canvas, i) => ({
        name: `${String(i).padStart(5, '0')}.png`,
        canvas: resizeCanvasForXtc(canvas),
      }))
      const pageImages = pages.map(p => p.canvas.toDataURL('image/png'))
      const data = await buildXtc(pages)

      results.push({
        name: `${baseName}_part${rangeIdx + 1}.xtc`,
        data,
        size: data.byteLength,
        pageCount: pages.length,
        pageImages,
      })
    }
  }

  return results
}

/**
 * Split XTC - direct slice of raw page data (very fast)
 */
async function splitXtcFile(
  file: File,
  ranges: PageRange[],
  outputFormat: OutputFormat,
  onProgress: (progress: SplitProgress) => void
): Promise<SplitResult[]> {
  const buffer = await file.arrayBuffer()
  const parsed = await parseXtcFile(buffer)

  const baseName = file.name.replace(/\.xtc$/i, '')
  const results: SplitResult[] = []

  for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
    const range = ranges[rangeIdx]

    onProgress({
      phase: 'building',
      rangeIndex: rangeIdx,
      totalRanges: ranges.length,
      pageProgress: 0.5,
    })

    // Slice only the pages for this range
    const rangePages = parsed.pageData.slice(range.start - 1, range.end)

    if (outputFormat === 'xtc') {
      const data = buildXtcFromRawPages(rangePages)
      results.push({
        name: `${baseName}_part${rangeIdx + 1}.xtc`,
        data,
        size: data.byteLength,
        pageCount: rangePages.length,
      })
    } else {
      // Decode to CBZ
      const canvases = rangePages.map(data => decodeXtgToCanvas(data))
      const images = canvases.map((canvas, i) => ({
        name: `${String(i + 1).padStart(5, '0')}.png`,
        blob: dataURLtoBlob(canvas.toDataURL('image/png')),
      }))
      const data = await buildCbz(images)

      results.push({
        name: `${baseName}_part${rangeIdx + 1}.cbz`,
        data,
        size: data.byteLength,
        pageCount: canvases.length,
      })
    }

    onProgress({
      phase: 'building',
      rangeIndex: rangeIdx,
      totalRanges: ranges.length,
      pageProgress: 1,
    })
  }

  return results
}

/**
 * Decode XTG to canvas (inline to avoid import cycle)
 */
function decodeXtgToCanvas(xtgBuffer: ArrayBuffer): HTMLCanvasElement {
  const view = new DataView(xtgBuffer)
  const uint8 = new Uint8Array(xtgBuffer)

  const width = view.getUint16(4, true)
  const height = view.getUint16(6, true)
  const pixelDataSize = view.getUint32(10, true)

  const headerSize = 22
  const pixelData = new Uint8Array(xtgBuffer, headerSize, pixelDataSize)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const imageData = ctx.createImageData(width, height)
  const data = imageData.data

  const rowBytes = Math.ceil(width / 8)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byteIndex = y * rowBytes + Math.floor(x / 8)
      const bitIndex = 7 - (x % 8)
      const bit = (pixelData[byteIndex] >> bitIndex) & 1

      const idx = (y * width + x) * 4
      const color = bit ? 255 : 0
      data[idx] = color
      data[idx + 1] = color
      data[idx + 2] = color
      data[idx + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

/**
 * Build XTC from raw XTG page data
 */
function buildXtcFromRawPages(xtgBlobs: ArrayBuffer[]): ArrayBuffer {
  const pageCount = xtgBlobs.length
  const headerSize = 48
  const indexEntrySize = 16
  const indexOffset = headerSize
  const dataOffset = indexOffset + pageCount * indexEntrySize

  let totalSize = dataOffset
  for (const blob of xtgBlobs) totalSize += blob.byteLength

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8 = new Uint8Array(buffer)

  uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x00
  view.setUint16(4, 1, true)
  view.setUint16(6, pageCount, true)

  setBigUint64(view, 24, BigInt(indexOffset))
  setBigUint64(view, 32, BigInt(dataOffset))

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

  let writeOffset = dataOffset
  for (const blob of xtgBlobs) {
    uint8.set(new Uint8Array(blob), writeOffset)
    writeOffset += blob.byteLength
  }

  return buffer
}

function setBigUint64(view: DataView, offset: number, value: bigint): void {
  view.setUint32(offset, Number(value & 0xFFFFFFFFn), true)
  view.setUint32(offset + 4, Number(value >> 32n), true)
}

async function blobsToCanvases(blobs: Blob[]): Promise<HTMLCanvasElement[]> {
  return Promise.all(blobs.map(blobToCanvas))
}

function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      resolve(canvas)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

function resizeCanvasForXtc(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const result = document.createElement('canvas')
  result.width = TARGET_WIDTH
  result.height = TARGET_HEIGHT
  const ctx = result.getContext('2d')!

  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT)

  const scale = Math.min(TARGET_WIDTH / canvas.width, TARGET_HEIGHT / canvas.height)
  const newWidth = Math.floor(canvas.width * scale)
  const newHeight = Math.floor(canvas.height * scale)
  const x = Math.floor((TARGET_WIDTH - newWidth) / 2)
  const y = Math.floor((TARGET_HEIGHT - newHeight) / 2)

  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, newWidth, newHeight)
  return result
}

function dataURLtoBlob(dataURL: string): Blob {
  const parts = dataURL.split(',')
  const mime = parts[0].match(/:(.*?);/)![1]
  const bstr = atob(parts[1])
  const u8arr = new Uint8Array(bstr.length)
  for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i)
  return new Blob([u8arr], { type: mime })
}
