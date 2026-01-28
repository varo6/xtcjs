// XTC format generation for XTEink X4 e-reader

import { TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas';
import type { BookMetadata, TocEntry } from './metadata/types';

interface ProcessedPage {
  name: string;
  canvas: HTMLCanvasElement;
}

interface XtcBuildOptions {
  metadata?: BookMetadata;
}

// XTC format constants (based on reference file analysis)
// Header: 48 bytes base + 8 bytes TOC offset pointer = 56 bytes total
const HEADER_BASE_SIZE = 48;
const TOC_OFFSET_PTR_SIZE = 8;
const HEADER_WITH_METADATA_SIZE = HEADER_BASE_SIZE + TOC_OFFSET_PTR_SIZE;  // 56 bytes
const INDEX_ENTRY_SIZE = 16;
const TITLE_SIZE = 128;
const AUTHOR_SIZE = 112;  // 112 bytes, not 128 - TOC header comes right after
const TOC_HEADER_SIZE = 16;
const TOC_ENTRY_SIZE = 96;
const TOC_TITLE_SIZE = 80;

// Flags for metadata presence: 0x01000100 with extra byte at 0x0C = 0x01
const FLAG_HAS_METADATA_LOW = 0x01000100;
const FLAG_HAS_METADATA_HIGH = 0x00000001;

/**
 * Build XTC file from processed pages
 */
export async function buildXtc(
  pages: ProcessedPage[],
  options: XtcBuildOptions = {}
): Promise<ArrayBuffer> {
  const xtgBlobs = pages.map(page =>
    imageDataToXtg(page.canvas.getContext('2d')!.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT))
  );

  const pageCount = xtgBlobs.length;
  const hasMetadata = options.metadata && (
    options.metadata.title ||
    options.metadata.author ||
    options.metadata.toc.length > 0
  );

  // Calculate metadata section size
  let metadataSize = 0;
  let tocEntriesOffset = 0;

  if (hasMetadata) {
    // Structure: Header(56) + Title(128) + Author(112) + TOC Header(16) + TOC Entries(N*96)
    metadataSize = TITLE_SIZE + AUTHOR_SIZE + TOC_HEADER_SIZE;
    if (options.metadata!.toc.length > 0) {
      metadataSize += options.metadata!.toc.length * TOC_ENTRY_SIZE;
    }
    // TOC entries start after header + title + author + toc header
    tocEntriesOffset = HEADER_WITH_METADATA_SIZE + TITLE_SIZE + AUTHOR_SIZE + TOC_HEADER_SIZE;
  }

  // Calculate offsets
  const headerSize = hasMetadata ? HEADER_WITH_METADATA_SIZE : HEADER_BASE_SIZE;
  const metadataOffset = hasMetadata ? HEADER_WITH_METADATA_SIZE : 0;  // Points to title start
  const indexOffset = headerSize + metadataSize;
  const dataOffset = indexOffset + (pageCount * INDEX_ENTRY_SIZE);

  let totalSize = dataOffset;
  for (const blob of xtgBlobs) {
    totalSize += blob.byteLength;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Header: XTC magic number
  uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x43; uint8[3] = 0x00;
  view.setUint16(4, 1, true); // version
  view.setUint16(6, pageCount, true);

  // Flags
  if (hasMetadata) {
    view.setUint32(8, FLAG_HAS_METADATA_LOW, true);
    view.setUint32(12, FLAG_HAS_METADATA_HIGH, true);
  } else {
    view.setUint32(8, 0, true);
    view.setUint32(12, 0, true);
  }

  // Offsets (8 bytes each, little-endian)
  setBigUint64(view, 16, BigInt(metadataOffset));  // 0x10: Metadata offset (title start)
  setBigUint64(view, 24, BigInt(indexOffset));     // 0x18: Index offset
  setBigUint64(view, 32, BigInt(dataOffset));      // 0x20: Data offset
  setBigUint64(view, 40, 0n);                      // 0x28: Reserved

  // Write TOC entries offset at 0x30 (only when metadata present)
  if (hasMetadata) {
    setBigUint64(view, 48, BigInt(tocEntriesOffset));  // 0x30: TOC entries offset
  }

  // Write metadata section if present
  if (hasMetadata && options.metadata) {
    writeMetadata(uint8, view, HEADER_WITH_METADATA_SIZE, options.metadata);
  }

  // Write index entries
  let relOffset = dataOffset;
  for (let i = 0; i < pageCount; i++) {
    const blob = xtgBlobs[i];
    const entryOffset = indexOffset + i * INDEX_ENTRY_SIZE;

    setBigUint64(view, entryOffset, BigInt(relOffset));
    view.setUint32(entryOffset + 8, blob.byteLength, true);
    view.setUint16(entryOffset + 12, TARGET_WIDTH, true);
    view.setUint16(entryOffset + 14, TARGET_HEIGHT, true);

    relOffset += blob.byteLength;
  }

  // Write page data
  let writeOffset = dataOffset;
  for (const blob of xtgBlobs) {
    uint8.set(new Uint8Array(blob), writeOffset);
    writeOffset += blob.byteLength;
  }

  return buffer;
}

/**
 * Write metadata section (title, author, TOC header, TOC entries)
 */
function writeMetadata(
  uint8: Uint8Array,
  view: DataView,
  offset: number,
  metadata: BookMetadata
): void {
  const encoder = new TextEncoder();
  let currentOffset = offset;

  // Write title (128 bytes, null-terminated)
  if (metadata.title) {
    const titleBytes = encoder.encode(metadata.title);
    const titleLen = Math.min(titleBytes.length, TITLE_SIZE - 1);
    uint8.set(titleBytes.subarray(0, titleLen), currentOffset);
  }
  currentOffset += TITLE_SIZE;

  // Write author (112 bytes, null-terminated)
  if (metadata.author) {
    const authorBytes = encoder.encode(metadata.author);
    const authorLen = Math.min(authorBytes.length, AUTHOR_SIZE - 1);
    uint8.set(authorBytes.subarray(0, authorLen), currentOffset);
  }
  currentOffset += AUTHOR_SIZE;

  // Write TOC header (16 bytes)
  writeTocHeader(view, currentOffset, metadata.toc.length);
  currentOffset += TOC_HEADER_SIZE;

  // Write TOC entries
  if (metadata.toc.length > 0) {
    writeTocEntries(uint8, view, currentOffset, metadata.toc);
  }
}

/**
 * Write TOC header (16 bytes)
 */
function writeTocHeader(view: DataView, offset: number, chapterCount: number): void {
  // Structure (based on reference file):
  // - 4 bytes: timestamp
  // - 2 bytes: reserved (0)
  // - 2 bytes: chapter count
  // - 8 bytes: padding
  const timestamp = Math.floor(Date.now() / 1000);
  view.setUint32(offset, timestamp, true);
  view.setUint16(offset + 4, 0, true);  // reserved
  view.setUint16(offset + 6, chapterCount, true);
  // Rest is padding (already zero)
}

/**
 * Write TOC entries (96 bytes each)
 */
function writeTocEntries(
  uint8: Uint8Array,
  view: DataView,
  offset: number,
  toc: TocEntry[]
): void {
  const encoder = new TextEncoder();
  let entryOffset = offset;

  for (const entry of toc) {
    // Title (80 bytes, null-terminated)
    const titleBytes = encoder.encode(entry.title);
    const titleLen = Math.min(titleBytes.length, TOC_TITLE_SIZE - 1);
    uint8.set(titleBytes.subarray(0, titleLen), entryOffset);

    // Start page (2 bytes, 1-indexed)
    view.setUint16(entryOffset + TOC_TITLE_SIZE, entry.startPage, true);

    // End page (2 bytes)
    view.setUint16(entryOffset + TOC_TITLE_SIZE + 2, entry.endPage, true);

    // Rest is padding (12 bytes, already zero)

    entryOffset += TOC_ENTRY_SIZE;
  }
}

/**
 * Convert ImageData to XTG format (XTEink Graphics)
 */
function imageDataToXtg(imageData: ImageData): ArrayBuffer {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;

  const rowBytes = Math.ceil(w / 8);
  const pixelData = new Uint8Array(rowBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const bit = data[idx] >= 128 ? 1 : 0;
      const byteIndex = y * rowBytes + Math.floor(x / 8);
      const bitIndex = 7 - (x % 8);
      if (bit) {
        pixelData[byteIndex] |= 1 << bitIndex;
      }
    }
  }

  // Create MD5-like digest (simplified)
  const md5digest = new Uint8Array(8);
  for (let i = 0; i < Math.min(8, pixelData.length); i++) {
    md5digest[i] = pixelData[i];
  }

  const headerSize = 22;
  const totalSize = headerSize + pixelData.length;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // XTG header
  uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x47; uint8[3] = 0x00;
  view.setUint16(4, w, true);
  view.setUint16(6, h, true);
  view.setUint8(8, 0);
  view.setUint8(9, 0);
  view.setUint32(10, pixelData.length, true);
  uint8.set(md5digest, 14);

  uint8.set(pixelData, headerSize);

  return buffer;
}

/**
 * Helper to set 64-bit unsigned integer (little-endian)
 */
function setBigUint64(view: DataView, offset: number, value: bigint): void {
  const low = Number(value & 0xFFFFFFFFn);
  const high = Number(value >> 32n);
  view.setUint32(offset, low, true);
  view.setUint32(offset + 4, high, true);
}
