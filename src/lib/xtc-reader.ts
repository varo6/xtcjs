// XTC format reader/parser for XTEink X4 e-reader

import { TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas'

export interface XtcHeader {
  magic: string
  version: number
  pageCount: number
  indexOffset: bigint
  dataOffset: bigint
}

export interface XtcIndexEntry {
  offset: bigint
  size: number
  width: number
  height: number
}

export interface ParsedXtc {
  header: XtcHeader
  entries: XtcIndexEntry[]
  pageData: ArrayBuffer[]
}

/**
 * Parse XTC file header (48 bytes)
 */
function parseXtcHeader(view: DataView): XtcHeader {
  const uint8 = new Uint8Array(view.buffer, view.byteOffset, 4)
  const magic = String.fromCharCode(uint8[0], uint8[1], uint8[2])

  if (magic !== 'XTC') {
    throw new Error('Invalid XTC file: bad magic number')
  }

  return {
    magic,
    version: view.getUint16(4, true),
    pageCount: view.getUint16(6, true),
    indexOffset: getBigUint64(view, 24),
    dataOffset: getBigUint64(view, 32),
  }
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
 * Parse an XTC file and extract all page data
 */
export async function parseXtcFile(buffer: ArrayBuffer): Promise<ParsedXtc> {
  const view = new DataView(buffer)
  const header = parseXtcHeader(view)

  const entries: XtcIndexEntry[] = []
  const indexOffset = Number(header.indexOffset)

  for (let i = 0; i < header.pageCount; i++) {
    const entryOffset = indexOffset + i * 16
    entries.push(parseIndexEntry(view, entryOffset))
  }

  const pageData: ArrayBuffer[] = []
  for (const entry of entries) {
    const offset = Number(entry.offset)
    const data = buffer.slice(offset, offset + entry.size)
    pageData.push(data)
  }

  return { header, entries, pageData }
}

/**
 * Get page count from XTC file without parsing all data
 */
export async function getXtcPageCount(buffer: ArrayBuffer): Promise<number> {
  const view = new DataView(buffer)
  const header = parseXtcHeader(view)
  return header.pageCount
}

/**
 * Decode XTG page data to canvas
 */
export function decodeXtgToCanvas(xtgBuffer: ArrayBuffer): HTMLCanvasElement {
  const view = new DataView(xtgBuffer)
  const uint8 = new Uint8Array(xtgBuffer)

  // Verify XTG magic
  const magic = String.fromCharCode(uint8[0], uint8[1], uint8[2])
  if (magic !== 'XTG') {
    throw new Error('Invalid XTG data: bad magic number')
  }

  const width = view.getUint16(4, true)
  const height = view.getUint16(6, true)
  const pixelDataSize = view.getUint32(10, true)

  // XTG header is 22 bytes
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
      data[idx] = color     // R
      data[idx + 1] = color // G
      data[idx + 2] = color // B
      data[idx + 3] = 255   // A
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

/**
 * Extract all pages from XTC as canvases
 */
export async function extractXtcPages(buffer: ArrayBuffer): Promise<HTMLCanvasElement[]> {
  const parsed = await parseXtcFile(buffer)
  return parsed.pageData.map(data => decodeXtgToCanvas(data))
}

/**
 * Extract raw XTG page data from XTC (for direct copy during merge)
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
