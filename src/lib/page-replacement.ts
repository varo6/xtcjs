const XTC_HEADER_SIZE = 48
const XTC_EXTENDED_HEADER_SIZE = 56
const XTC_INDEX_ENTRY_SIZE = 16
const RAW_PAGE_HEADER_SIZE = 22

export type XtcRawPageMagic = 'XTG' | 'XTH'

export interface ReplaceableXtcPage {
  offset: number
  size: number
  width: number
  height: number
}

export interface ReplaceableXtcBook {
  version: number
  pageCount: number
  is2bit: boolean
  pageMagic: XtcRawPageMagic
  hasMetadata: boolean
  indexOffset: number
  dataOffset: number
  sourceSize: number
  pages: ReplaceableXtcPage[]
}

export interface XtcRawPageHeader {
  magic: XtcRawPageMagic
  width: number
  height: number
  payloadSize: number
  totalSize: number
}

export interface XtcPageReplacement {
  pageNumber: number
  file: Blob
}

export class XtcPageReplacementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XtcPageReplacementError'
  }
}

function fail(message: string): never {
  throw new XtcPageReplacementError(message)
}

function getSafeUint64(view: DataView, offset: number, label: string): number {
  const low = view.getUint32(offset, true)
  const high = view.getUint32(offset + 4, true)
  const value = BigInt(low) + (BigInt(high) << 32n)

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(`${label} is too large for this browser.`)
  }

  return Number(value)
}

function getPage(book: ReplaceableXtcBook, pageNumber: number): ReplaceableXtcPage {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > book.pageCount) {
    fail(`Page number must be between 1 and ${book.pageCount}.`)
  }

  return book.pages[pageNumber - 1]
}

/**
 * Read only the XTC/XTCH header and page index. Page payloads stay in the source Blob.
 */
export async function inspectReplaceableXtc(source: Blob): Promise<ReplaceableXtcBook> {
  if (source.size < XTC_HEADER_SIZE) {
    fail('The selected file is too small to be an XTC/XTCH book.')
  }

  const headerBuffer = await source
    .slice(0, Math.min(source.size, XTC_EXTENDED_HEADER_SIZE))
    .arrayBuffer()
  const headerView = new DataView(headerBuffer)
  const headerBytes = new Uint8Array(headerBuffer)
  const magic = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2])
  const formatMarker = headerBytes[3]

  if (magic !== 'XTC' || (formatMarker !== 0 && formatMarker !== 0x48 && formatMarker !== 0x68)) {
    fail('The selected file does not have a valid XTC/XTCH header.')
  }

  const version = headerView.getUint16(4, true)
  const pageCount = headerView.getUint16(6, true)
  const hasMetadata = headerView.getUint32(8, true) !== 0
  const indexOffset = getSafeUint64(headerView, 24, 'Page index offset')
  const dataOffset = getSafeUint64(headerView, 32, 'Page data offset')
  const indexSize = pageCount * XTC_INDEX_ENTRY_SIZE
  const indexEnd = indexOffset + indexSize

  if (pageCount === 0) {
    fail('The selected book does not contain any pages.')
  }
  if (indexOffset < XTC_HEADER_SIZE || indexEnd > source.size) {
    fail('The book page index is outside the selected file.')
  }
  if (dataOffset < indexEnd || dataOffset > source.size) {
    fail('The book page data offset is invalid.')
  }

  const indexBuffer = await source.slice(indexOffset, indexEnd).arrayBuffer()
  const indexView = new DataView(indexBuffer)
  const pages: ReplaceableXtcPage[] = []

  for (let index = 0; index < pageCount; index++) {
    const entryOffset = index * XTC_INDEX_ENTRY_SIZE
    const offset = getSafeUint64(indexView, entryOffset, `Page ${index + 1} offset`)
    const size = indexView.getUint32(entryOffset + 8, true)
    const width = indexView.getUint16(entryOffset + 12, true)
    const height = indexView.getUint16(entryOffset + 14, true)
    const end = offset + size

    if (size < RAW_PAGE_HEADER_SIZE || width === 0 || height === 0) {
      fail(`Page ${index + 1} has an invalid index entry.`)
    }
    if (offset < dataOffset || end > source.size || !Number.isSafeInteger(end)) {
      fail(`Page ${index + 1} points outside the selected file.`)
    }

    pages.push({ offset, size, width, height })
  }

  const pagesByOffset = [...pages].sort((left, right) => left.offset - right.offset)
  for (let index = 1; index < pagesByOffset.length; index++) {
    const previous = pagesByOffset[index - 1]
    const current = pagesByOffset[index]
    if (current.offset < previous.offset + previous.size) {
      fail('The book contains overlapping page ranges.')
    }
  }

  const is2bit = formatMarker === 0x48 || formatMarker === 0x68
  return {
    version,
    pageCount,
    is2bit,
    pageMagic: is2bit ? 'XTH' : 'XTG',
    hasMetadata,
    indexOffset,
    dataOffset,
    sourceSize: source.size,
    pages,
  }
}

/**
 * Validate the complete 22-byte XTG/XTH header and its fixed-size pixel payload.
 */
export function parseXtcRawPage(buffer: ArrayBuffer): XtcRawPageHeader {
  if (buffer.byteLength < RAW_PAGE_HEADER_SIZE) {
    fail('The replacement file is too small to contain an XTG/XTH page.')
  }

  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2])

  if ((magic !== 'XTG' && magic !== 'XTH') || bytes[3] !== 0) {
    fail('The replacement file does not have a valid XTG/XTH header.')
  }

  const width = view.getUint16(4, true)
  const height = view.getUint16(6, true)
  const payloadSize = view.getUint32(10, true)
  if (width === 0 || height === 0) {
    fail('The replacement page dimensions are invalid.')
  }

  const expectedPayloadSize = magic === 'XTH'
    ? Math.ceil(height / 8) * width * 2
    : Math.ceil(width / 8) * height
  const totalSize = RAW_PAGE_HEADER_SIZE + payloadSize

  if (payloadSize !== expectedPayloadSize || totalSize !== buffer.byteLength) {
    fail('The replacement page payload is truncated or has an invalid size.')
  }

  return {
    magic,
    width,
    height,
    payloadSize,
    totalSize,
  }
}

export async function readXtcPage(
  source: Blob,
  book: ReplaceableXtcBook,
  pageNumber: number
): Promise<ArrayBuffer> {
  if (source.size !== book.sourceSize) {
    fail('The source book changed after it was inspected.')
  }

  const page = getPage(book, pageNumber)
  return source.slice(page.offset, page.offset + page.size).arrayBuffer()
}

export function validateXtcPageBuffer(
  book: ReplaceableXtcBook,
  pageNumber: number,
  buffer: ArrayBuffer,
  label = 'Replacement page'
): XtcRawPageHeader {
  const target = getPage(book, pageNumber)
  const page = parseXtcRawPage(buffer)

  if (page.magic !== book.pageMagic) {
    fail(`${label} must be ${book.pageMagic} for this ${book.is2bit ? 'XTCH' : 'XTC'} book.`)
  }
  if (page.width !== target.width || page.height !== target.height) {
    fail(
      `${label} must be ${target.width}×${target.height}px; received ${page.width}×${page.height}px.`
    )
  }
  if (page.totalSize !== target.size) {
    fail(`${label} must have the same byte size as the original page.`)
  }

  return page
}

export async function validateXtcPageReplacement(
  book: ReplaceableXtcBook,
  pageNumber: number,
  replacement: Blob
): Promise<ArrayBuffer> {
  const buffer = await replacement.arrayBuffer()
  validateXtcPageBuffer(book, pageNumber, buffer)
  return buffer
}

/**
 * Compose a new book from source slices. Fixed-size replacements leave the original
 * header, metadata, page index, reserved fields, and all untouched bytes unchanged.
 */
export async function createReplacedXtcBlob(
  source: Blob,
  book: ReplaceableXtcBook,
  replacements: XtcPageReplacement[]
): Promise<Blob> {
  if (source.size !== book.sourceSize) {
    fail('The source book changed after it was inspected.')
  }
  if (replacements.length === 0) {
    fail('Add at least one page replacement before downloading.')
  }

  const seenPages = new Set<number>()
  for (const replacement of replacements) {
    getPage(book, replacement.pageNumber)
    if (seenPages.has(replacement.pageNumber)) {
      fail(`Page ${replacement.pageNumber} has more than one replacement.`)
    }
    seenPages.add(replacement.pageNumber)
  }

  await Promise.all(replacements.map((replacement) =>
    validateXtcPageReplacement(book, replacement.pageNumber, replacement.file)
  ))

  const replacementsByOffset = replacements
    .map((replacement) => ({
      ...replacement,
      page: getPage(book, replacement.pageNumber),
    }))
    .sort((left, right) => left.page.offset - right.page.offset)

  const parts: BlobPart[] = []
  let cursor = 0

  for (const replacement of replacementsByOffset) {
    parts.push(source.slice(cursor, replacement.page.offset))
    parts.push(replacement.file)
    cursor = replacement.page.offset + replacement.page.size
  }
  parts.push(source.slice(cursor))

  const output = new Blob(parts, { type: 'application/octet-stream' })
  if (output.size !== source.size) {
    fail('The edited book size changed unexpectedly.')
  }

  return output
}
