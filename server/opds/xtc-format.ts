interface TocEntry {
  title: string
  startPage: number
  endPage: number
}

interface BookMetadata {
  title?: string
  author?: string
  toc: TocEntry[]
}

interface XtcBuildOptions {
  metadata?: BookMetadata
  is2bit?: boolean
}

const HEADER_BASE_SIZE = 48
const HEADER_WITH_METADATA_SIZE = 56
const INDEX_ENTRY_SIZE = 16
const TITLE_SIZE = 128
const AUTHOR_SIZE = 112
const TOC_HEADER_SIZE = 16
const TOC_ENTRY_SIZE = 96
const TOC_TITLE_SIZE = 80
const FLAG_HAS_METADATA_LOW = 0x01000100
const FLAG_HAS_METADATA_HIGH = 0x00000001

export async function buildXtcFromXtgPages(
  xtgBlobs: ArrayBuffer[],
  options: XtcBuildOptions = {}
): Promise<ArrayBuffer> {
  const is2bit = options.is2bit || false
  const pageCount = xtgBlobs.length
  const hasMetadata = options.metadata && (
    options.metadata.title ||
    options.metadata.author ||
    options.metadata.toc.length > 0
  )

  let metadataSize = 0
  let tocEntriesOffset = 0
  if (hasMetadata) {
    metadataSize = TITLE_SIZE + AUTHOR_SIZE + TOC_HEADER_SIZE
    if (options.metadata!.toc.length > 0) {
      metadataSize += options.metadata!.toc.length * TOC_ENTRY_SIZE
    }
    tocEntriesOffset = HEADER_WITH_METADATA_SIZE + TITLE_SIZE + AUTHOR_SIZE + TOC_HEADER_SIZE
  }

  const headerSize = hasMetadata ? HEADER_WITH_METADATA_SIZE : HEADER_BASE_SIZE
  const metadataOffset = hasMetadata ? HEADER_WITH_METADATA_SIZE : 0
  const indexOffset = headerSize + metadataSize
  const dataOffset = indexOffset + pageCount * INDEX_ENTRY_SIZE
  const totalSize = xtgBlobs.reduce((size, blob) => size + blob.byteLength, dataOffset)

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8 = new Uint8Array(buffer)

  if (is2bit) {
    uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x48
  } else {
    uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x00
  }
  view.setUint16(4, 1, true)
  view.setUint16(6, pageCount, true)

  if (hasMetadata) {
    view.setUint32(8, FLAG_HAS_METADATA_LOW, true)
    view.setUint32(12, FLAG_HAS_METADATA_HIGH, true)
  } else {
    view.setUint32(8, 0, true)
    view.setUint32(12, 0, true)
  }

  setBigUint64(view, 16, BigInt(metadataOffset))
  setBigUint64(view, 24, BigInt(indexOffset))
  setBigUint64(view, 32, BigInt(dataOffset))
  setBigUint64(view, 40, 0n)

  if (hasMetadata) {
    setBigUint64(view, 48, BigInt(tocEntriesOffset))
    writeMetadata(uint8, view, HEADER_WITH_METADATA_SIZE, options.metadata!)
  }

  let relOffset = dataOffset
  for (let i = 0; i < pageCount; i++) {
    const blob = xtgBlobs[i]
    const entryOffset = indexOffset + i * INDEX_ENTRY_SIZE
    const dimensions = getXtgDimensions(blob)
    setBigUint64(view, entryOffset, BigInt(relOffset))
    view.setUint32(entryOffset + 8, blob.byteLength, true)
    view.setUint16(entryOffset + 12, dimensions.width, true)
    view.setUint16(entryOffset + 14, dimensions.height, true)
    relOffset += blob.byteLength
  }

  let writeOffset = dataOffset
  for (const blob of xtgBlobs) {
    uint8.set(new Uint8Array(blob), writeOffset)
    writeOffset += blob.byteLength
  }

  return buffer
}

function getXtgDimensions(xtgBlob: ArrayBuffer): { width: number; height: number } {
  if (xtgBlob.byteLength < 8) {
    return { width: 480, height: 800 }
  }
  const view = new DataView(xtgBlob)
  return {
    width: view.getUint16(4, true),
    height: view.getUint16(6, true),
  }
}

function writeMetadata(uint8: Uint8Array, view: DataView, offset: number, metadata: BookMetadata): void {
  const encoder = new TextEncoder()
  let currentOffset = offset

  if (metadata.title) {
    const titleBytes = encoder.encode(metadata.title)
    uint8.set(titleBytes.subarray(0, TITLE_SIZE - 1), currentOffset)
  }
  currentOffset += TITLE_SIZE

  if (metadata.author) {
    const authorBytes = encoder.encode(metadata.author)
    uint8.set(authorBytes.subarray(0, AUTHOR_SIZE - 1), currentOffset)
  }
  currentOffset += AUTHOR_SIZE

  view.setUint32(currentOffset, Math.floor(Date.now() / 1000), true)
  view.setUint16(currentOffset + 4, 0, true)
  view.setUint16(currentOffset + 6, metadata.toc.length, true)
  currentOffset += TOC_HEADER_SIZE

  for (const entry of metadata.toc) {
    const titleBytes = encoder.encode(entry.title)
    uint8.set(titleBytes.subarray(0, TOC_TITLE_SIZE - 1), currentOffset)
    view.setUint16(currentOffset + TOC_TITLE_SIZE, entry.startPage, true)
    view.setUint16(currentOffset + TOC_TITLE_SIZE + 2, entry.endPage, true)
    currentOffset += TOC_ENTRY_SIZE
  }
}

function setBigUint64(view: DataView, offset: number, value: bigint): void {
  const low = Number(value & 0xFFFFFFFFn)
  const high = Number((value >> 32n) & 0xFFFFFFFFn)
  view.setUint32(offset, low, true)
  view.setUint32(offset + 4, high, true)
}
