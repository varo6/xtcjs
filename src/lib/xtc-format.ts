// XTC format generation for XTEink X4 e-reader

import { TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas';

interface ProcessedPage {
  name: string;
  canvas: HTMLCanvasElement;
}

/**
 * Build XTC file from processed pages
 */
export async function buildXtc(pages: ProcessedPage[]): Promise<ArrayBuffer> {
  const xtgBlobs = pages.map(page =>
    imageDataToXtg(page.canvas.getContext('2d')!.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT))
  );

  const pageCount = xtgBlobs.length;
  const headerSize = 48;
  const indexEntrySize = 16;
  const indexOffset = headerSize;
  const dataOffset = indexOffset + pageCount * indexEntrySize;

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
  view.setUint8(8, 0);
  view.setUint8(9, 0);
  view.setUint8(10, 0);
  view.setUint8(11, 0);
  view.setUint32(12, 0, true);

  setBigUint64(view, 16, 0n);
  setBigUint64(view, 24, BigInt(indexOffset));
  setBigUint64(view, 32, BigInt(dataOffset));
  setBigUint64(view, 40, 0n);

  // Write index entries
  let relOffset = dataOffset;
  for (let i = 0; i < pageCount; i++) {
    const blob = xtgBlobs[i];
    const entryOffset = indexOffset + i * indexEntrySize;

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
