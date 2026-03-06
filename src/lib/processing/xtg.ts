function createDigestSeed(data: Uint8Array): Uint8Array {
  const digest = new Uint8Array(8)
  for (let i = 0; i < Math.min(8, data.length); i++) {
    digest[i] = data[i]
  }
  return digest
}

/**
 * Convert ImageData to XTG format (XTEink Graphics, 1-bit row-major).
 */
export function imageDataToXtg(imageData: ImageData): ArrayBuffer {
  const w = imageData.width
  const h = imageData.height
  const data = imageData.data

  const rowBytes = Math.ceil(w / 8)
  const pixelData = new Uint8Array(rowBytes * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const bit = data[idx] >= 128 ? 1 : 0
      const byteIndex = y * rowBytes + Math.floor(x / 8)
      const bitIndex = 7 - (x % 8)
      if (bit) {
        pixelData[byteIndex] |= 1 << bitIndex
      }
    }
  }

  return buildPageBuffer('XTG', w, h, pixelData)
}

/**
 * Convert ImageData to XTH format (XTEink 2-bit grayscale, planar vertical scan).
 * Layout matches the reference encoders in cbz2xtc and xtcjsapp:
 * columns are stored right-to-left, then split into two bitplanes.
 */
export function imageDataToXth(imageData: ImageData): ArrayBuffer {
  const w = imageData.width
  const h = imageData.height
  const data = imageData.data

  const colBytes = Math.ceil(h / 8)
  const planeSize = colBytes * w
  const plane0 = new Uint8Array(planeSize)
  const plane1 = new Uint8Array(planeSize)

  for (let x = 0; x < w; x++) {
    const targetCol = w - 1 - x
    const colOffset = targetCol * colBytes

    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4
      const val = get2BitLevel(data[idx])
      const byteIdx = colOffset + (y >> 3)
      const bitIdx = 7 - (y & 7)

      if (val & 1) {
        plane0[byteIdx] |= 1 << bitIdx
      }
      if (val & 2) {
        plane1[byteIdx] |= 1 << bitIdx
      }
    }
  }

  const pixelData = new Uint8Array(planeSize * 2)
  pixelData.set(plane0, 0)
  pixelData.set(plane1, planeSize)

  return buildPageBuffer('XTH', w, h, pixelData)
}

function get2BitLevel(value: number): number {
  if (value >= 212) return 0
  if (value >= 127) return 1
  if (value >= 42) return 2
  return 3
}

function buildPageBuffer(magic: 'XTG' | 'XTH', width: number, height: number, pixelData: Uint8Array): ArrayBuffer {
  const digest = createDigestSeed(pixelData)
  const headerSize = 22
  const totalSize = headerSize + pixelData.length
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8 = new Uint8Array(buffer)

  uint8[0] = magic.charCodeAt(0)
  uint8[1] = magic.charCodeAt(1)
  uint8[2] = magic.charCodeAt(2)
  uint8[3] = 0x00
  view.setUint16(4, width, true)
  view.setUint16(6, height, true)
  view.setUint8(8, 0)
  view.setUint8(9, 0)
  view.setUint32(10, pixelData.length, true)
  uint8.set(digest, 14)
  uint8.set(pixelData, headerSize)

  return buffer
}
