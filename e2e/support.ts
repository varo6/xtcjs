import { deflateSync, crc32 } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { PDFDocument, PDFName, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib'
import type { Page } from '@playwright/test'
import type { ConversionOptions } from '../src/lib/conversion/types'
import { parseXtcFile, type ParsedXtc } from '../src/lib/xtc-reader'
import type { Harness, Pipeline, SourceType } from './harness/harness'

// ---------------------------------------------------------------- fixtures

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** 8-bit grayscale PNG, white background with black rectangles [x, y, w, h]. */
export function makePng(width: number, height: number, blackRects: Array<[number, number, number, number]>): Buffer {
  const stride = width + 1
  const raw = Buffer.alloc(stride * height, 255)
  for (let y = 0; y < height; y++) raw[y * stride] = 0
  for (const [rx, ry, rw, rh] of blackRects) {
    for (let y = ry; y < Math.min(ry + rh, height); y++) {
      raw.fill(0, y * stride + 1 + rx, y * stride + 1 + Math.min(rx + rw, width))
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 0, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A comic page whose quadrants have distinct ink densities, so reading order
 * survives rotation and encoding. Landscape pages are spreads.
 */
export function makeComicPage(portrait = false): Buffer {
  const [w, h] = portrait ? [1201, 1643] : [1643, 1201]
  return makePng(w, h, [[821, 0, 822, 600], [821, 600, 411, 601], [0, 0, 205, 600]])
}

const SPREAD_COMIC_INFO = '<ComicInfo><Title>Spread test</Title><Pages>' +
  '<Page Image="0" Type="FrontCover"/><Page Image="1" Bookmark="First spread"/>' +
  '<Page Image="2" Bookmark="Second spread"/></Pages></ComicInfo>'

export interface Source {
  name: string
  type: SourceType
  bytes: Uint8Array
}

export async function makeCbz(pages: Buffer[], comicInfo: string | null = SPREAD_COMIC_INFO, name = 'fixture.cbz'): Promise<Source> {
  const zip = new JSZip()
  const date = new Date(0)
  pages.forEach((page, i) => zip.file(`${String(i + 1).padStart(3, '0')}.png`, page, { date }))
  if (comicInfo) zip.file('ComicInfo.xml', comicInfo, { date })
  return { name, type: 'cbz', bytes: await zip.generateAsync({ type: 'uint8array' }) }
}

function rarBlock(type: number, flags: number, fields: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from([type]), u16(flags), u16(7 + fields.length), fields])
  return Buffer.concat([u16(crc32(body) & 0xffff), body])
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2)
  out.writeUInt16LE(value)
  return out
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value >>> 0)
  return out
}

// RAR 1.5-4.x with the "store" method (0x30), the only variant writable without the proprietary rar tool.
export function makeCbr(pages: Buffer[], comicInfo: string | null = SPREAD_COMIC_INFO, name = 'fixture.cbr'): Source {
  const entries: Array<[string, Buffer]> = pages.map((page, i) => [`${String(i + 1).padStart(3, '0')}.png`, page])
  if (comicInfo) entries.push(['ComicInfo.xml', Buffer.from(comicInfo)])
  const LONG_BLOCK = 0x8000
  const files = entries.map(([path, data]) => {
    const fileName = Buffer.from(path)
    const fields = Buffer.concat([
      u32(data.length), u32(data.length), Buffer.from([0]), u32(crc32(data)), u32(0x00210000),
      Buffer.from([20, 0x30]), u16(fileName.length), u32(0x20), fileName,
    ])
    return Buffer.concat([rarBlock(0x74, LONG_BLOCK, fields), data])
  })
  const bytes = Buffer.concat([
    Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]),
    rarBlock(0x73, 0, Buffer.alloc(6)),
    ...files,
    rarBlock(0x7b, 0x4000, Buffer.alloc(0)),
  ])
  return { name, type: 'cbr', bytes: new Uint8Array(bytes) }
}

export async function makePdf(pages: Buffer[], name = 'fixture.pdf'): Promise<Source> {
  const pdf = await PDFDocument.create()
  for (const png of pages) {
    const image = await pdf.embedPng(png)
    // 72 dpi at render scale 2 gives the same pixel size as the CBZ page.
    const page = pdf.addPage([image.width / 2, image.height / 2])
    page.drawImage(image, { x: 0, y: 0, width: image.width / 2, height: image.height / 2 })
  }
  return { name, type: 'pdf', bytes: await pdf.save() }
}

/** A one-page PDF whose only image is JPEG 2000 (JPXDecode), needing PDF.js's WASM decoder. */
export async function makeJpxPdf(name = 'jpx.pdf'): Promise<Source> {
  const jp2 = readFileSync(new URL('./fixtures/jpx-sample.jp2', import.meta.url))
  const pdf = await PDFDocument.create()
  const stream = pdf.context.stream(jp2, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: 256,
    Height: 256,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'JPXDecode',
  })
  const page = pdf.addPage([256, 256])
  page.node.setXObject(PDFName.of('Im0'), pdf.context.register(stream))
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(256, 0, 0, 256, 0, 0), drawObject('Im0'), popGraphicsState())
  return { name, type: 'pdf', bytes: await pdf.save() }
}

export function makeImage(png: Buffer, name = 'fixture.png'): Source {
  return { name, type: 'image', bytes: new Uint8Array(png) }
}

// ----------------------------------------------------------------- options

export const baseOptions: ConversionOptions = {
  device: 'X4', orientation: 'landscape', splitMode: 'overlap', splitSpreads: true,
  coverPortrait: true, firstPageIsCover: true, pageOverview: 'none', contrast: 0, dithering: 'none',
  horizontalMargin: 0, verticalMargin: 0, is2bit: false, landscapeFlipClockwise: false,
  showProgressPreview: false, imageMode: 'letterbox', videoFps: 1,
}

// ------------------------------------------------------------- page driver

export async function openHarness(page: Page): Promise<void> {
  // The XTC TOC header embeds Date.now(); freeze it so identical conversions hash identically.
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'))
  await page.goto('/e2e/harness/index.html')
  await page.waitForFunction(() => 'xtcHarness' in window)
}

export interface Conversion {
  data: Buffer
  pageCount: number
  workersCreated: number
  xtc: ParsedXtc
  sha256: string
}

export async function convert(
  page: Page,
  source: Source,
  options: Partial<ConversionOptions> = {},
  pipeline: Pipeline = 'worker',
): Promise<Conversion> {
  const merged = { ...baseOptions, ...options }
  const out = await page.evaluate(
    ({ bytes, name, type, merged, pipeline }) => {
      const harness = (window as unknown as { xtcHarness: Harness }).xtcHarness
      return harness.convert(bytes, name, type, merged, pipeline)
    },
    { bytes: source.bytes, name: source.name, type: source.type, merged, pipeline },
  )
  const data = Buffer.from(out.data)
  return {
    data,
    pageCount: out.pageCount,
    workersCreated: out.workersCreated,
    xtc: await parseXtcFile(toArrayBuffer(data)),
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}

export async function targetDimensions(page: Page, device: ConversionOptions['device']) {
  return page.evaluate(
    (device) => (window as unknown as { xtcHarness: Harness }).xtcHarness.targetDimensions(device),
    device,
  )
}

// ------------------------------------------------------------ XTC readers

export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

export function samePageBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0
}

/** Fraction of black pixels in a 1-bit XTG page. */
export function inkFraction(page: ArrayBuffer): number {
  const bytes = new Uint8Array(page)
  const view = new DataView(page)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2])
  if (magic !== 'XTG') throw new Error(`inkFraction needs a 1-bit XTG page, got ${magic}`)
  const width = view.getUint16(4, true)
  const height = view.getUint16(6, true)
  const rowBytes = Math.ceil(width / 8)
  let black = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (((bytes[22 + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) === 0) black++
    }
  }
  return black / (width * height)
}
