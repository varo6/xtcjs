// XTC format reader/parser for XTEink e-readers

import type { BookMetadata } from './metadata/types'

export interface XtcHeader {
  magic: string
  is2bit: boolean
  version: number
  pageCount: number
  hasMetadata: boolean
  metadataOffset: bigint
  indexOffset: bigint
  dataOffset: bigint
  tocOffset: bigint
}

export interface XtcIndexEntry {
  offset: bigint
  size: number
  width: number
  height: number
}

export interface ParsedXtc {
  header: XtcHeader
  metadata?: BookMetadata
  entries: XtcIndexEntry[]
  pageData: ArrayBuffer[]
}

/**
 * Parse XTC file header (48-56 bytes)
 */
function parseXtcHeader(view: DataView): XtcHeader {
  const uint8 = new Uint8Array(view.buffer, view.byteOffset, 4)
  const magic = String.fromCharCode(uint8[0], uint8[1], uint8[2])
  const is2bit = uint8[3] === 0x48 || uint8[3] === 0x68 // 'H' or 'h'

  if (magic !== 'XTC') {
    throw new Error('Invalid XTC file: bad magic number')
  }

  const flagsLow = view.getUint32(8, true)
  const hasMetadata = flagsLow !== 0

  return {
    magic,
    is2bit,
    version: view.getUint16(4, true),
    pageCount: view.getUint16(6, true),
    hasMetadata,
    metadataOffset: getBigUint64(view, 16),
    indexOffset: getBigUint64(view, 24),
    dataOffset: getBigUint64(view, 32),
    tocOffset: hasMetadata && view.byteLength >= 56 ? getBigUint64(view, 48) : 0n,
  }
}

/**
 * Parse null-terminated UTF-8 string.
 */
function readNullTerminatedString(view: DataView, offset: number, maxLength: number): string {
  if (offset < 0 || offset >= view.byteLength) {
    return ''
  }

  const safeLength = Math.max(0, Math.min(maxLength, view.byteLength - offset))
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, safeLength)
  let len = 0
  while (len < safeLength && bytes[len] !== 0) {
    len++
  }
  return new TextDecoder('utf-8').decode(bytes.subarray(0, len))
}

/**
 * Parse metadata block (title, author, toc).
 */
function parseMetadata(view: DataView, header: XtcHeader): BookMetadata {
  const metadata: BookMetadata = { toc: [] }
  if (!header.hasMetadata || header.metadataOffset === 0n) {
    return metadata
  }

  const metaOffset = Number(header.metadataOffset)
  if (!Number.isFinite(metaOffset) || metaOffset < 0 || metaOffset >= view.byteLength) {
    return metadata
  }

  metadata.title = readNullTerminatedString(view, metaOffset, 128)
  metadata.author = readNullTerminatedString(view, metaOffset + 128, 112)

  const tocHeaderOffset = metaOffset + 128 + 112
  if (tocHeaderOffset + 8 > view.byteLength) {
    return metadata
  }

  const chapterCount = view.getUint16(tocHeaderOffset + 6, true)
  const tocOffset = header.tocOffset !== 0n
    ? Number(header.tocOffset)
    : tocHeaderOffset + 16

  for (let i = 0; i < chapterCount; i++) {
    const entryOffset = tocOffset + i * 96
    if (entryOffset + 84 > view.byteLength) {
      break
    }

    const title = readNullTerminatedString(view, entryOffset, 80)
    const startPage = view.getUint16(entryOffset + 80, true)
    const endPage = view.getUint16(entryOffset + 82, true)

    metadata.toc.push({ title, startPage, endPage })
  }

  return metadata
}

/**
 * Parse XTC index entry (16 bytes each)
 */
function parseIndexEntry(view: DataView, offset: number): XtcIndexEntry {
  return {
    offset: getBigUint64(view, offset),
    size: view.getUint32(offset + 8, true),
    width: view.getUint16(offset + 12, true),
    height: view.getUint16(offset + 14, true),
  }
}

/**
 * Parse an XTC file and extract page data.
 */
export async function parseXtcFile(
  buffer: ArrayBuffer,
  maxPages?: number
): Promise<ParsedXtc> {
  const view = new DataView(buffer)
  const header = parseXtcHeader(view)
  const metadata = parseMetadata(view, header)

  const pageCountToRead = typeof maxPages === 'number'
    ? Math.max(0, Math.min(header.pageCount, maxPages))
    : header.pageCount

  const entries: XtcIndexEntry[] = []
  const indexOffset = Number(header.indexOffset)

  for (let i = 0; i < pageCountToRead; i++) {
    const entryOffset = indexOffset + i * 16
    entries.push(parseIndexEntry(view, entryOffset))
  }

  const pageData: ArrayBuffer[] = []
  for (const entry of entries) {
    const offset = Number(entry.offset)
    pageData.push(buffer.slice(offset, offset + entry.size))
  }

  return { header, metadata, entries, pageData }
}

/**
 * Get page count from XTC file without parsing all data.
 */
async function getXtcPageCount(buffer: ArrayBuffer): Promise<number> {
  const view = new DataView(buffer)
  const header = parseXtcHeader(view)
  return header.pageCount
}

/**
 * Decode XTG or XTH page data to canvas.
 */
function decodeXtcPageToCanvas(pageBuffer: ArrayBuffer): HTMLCanvasElement {
  const view = new DataView(pageBuffer)
  const uint8 = new Uint8Array(pageBuffer)

  const magic = String.fromCharCode(uint8[0], uint8[1], uint8[2])
  const is2bit = magic === 'XTH'
  if (magic !== 'XTG' && magic !== 'XTH') {
    throw new Error(`Invalid page data: bad magic number ${magic}`)
  }

  const width = view.getUint16(4, true)
  const height = view.getUint16(6, true)
  const headerSize = 22

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const imageData = ctx.createImageData(width, height)
  const data = imageData.data

  if (is2bit) {
    const colBytes = Math.ceil(height / 8)
    const planeSize = colBytes * width
    const p0 = new Uint8Array(pageBuffer, headerSize, planeSize)
    const p1 = new Uint8Array(pageBuffer, headerSize + planeSize, planeSize)

    for (let x = 0; x < width; x++) {
      const targetCol = width - 1 - x
      const colOffset = targetCol * colBytes

      for (let y = 0; y < height; y++) {
        const byteIdx = colOffset + (y >> 3)
        const bitIdx = 7 - (y % 8)

        const bit0 = (p0[byteIdx] >> bitIdx) & 1
        const bit1 = (p1[byteIdx] >> bitIdx) & 1
        const val = bit0 | (bit1 << 1)

        let color = 255
        if (val === 1) color = 170
        else if (val === 2) color = 85
        else if (val === 3) color = 0

        const idx = (y * width + x) * 4
        data[idx] = color
        data[idx + 1] = color
        data[idx + 2] = color
        data[idx + 3] = 255
      }
    }
  } else {
    const pixelDataSize = view.getUint32(10, true)
    const pixelData = new Uint8Array(pageBuffer, headerSize, pixelDataSize)
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
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

/**
 * Backward-compatible alias for callers that decode XTG pages.
 */
const decodeXtgToCanvas = decodeXtcPageToCanvas

/**
 * Extract pages from XTC as canvases.
 */
export async function extractXtcPages(
  buffer: ArrayBuffer,
  maxPages?: number
): Promise<HTMLCanvasElement[]> {
  const parsed = await parseXtcFile(buffer, maxPages)
  return parsed.pageData.map(data => decodeXtcPageToCanvas(data))
}

/**
 * Extract raw XTG/XTH page data from XTC.
 */
export async function extractXtcRawPages(buffer: ArrayBuffer): Promise<ArrayBuffer[]> {
  const parsed = await parseXtcFile(buffer)
  return parsed.pageData
}

/**
 * Helper to read 64-bit unsigned integer (little-endian)
 */
function getBigUint64(view: DataView, offset: number): bigint {
  const low = view.getUint32(offset, true)
  const high = view.getUint32(offset + 4, true)
  return BigInt(low) + (BigInt(high) << 32n)
}
