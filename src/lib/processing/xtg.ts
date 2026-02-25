/**
 * Convert ImageData to XTG format (XTEink Graphics).
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

  // Create MD5-like digest (simplified)
  const md5digest = new Uint8Array(8)
  for (let i = 0; i < Math.min(8, pixelData.length); i++) {
    md5digest[i] = pixelData[i]
  }

  const headerSize = 22
  const totalSize = headerSize + pixelData.length
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8 = new Uint8Array(buffer)

  // XTG header
  uint8[0] = 0x58; uint8[1] = 0x54; uint8[2] = 0x47; uint8[3] = 0x00
  view.setUint16(4, w, true)
  view.setUint16(6, h, true)
  view.setUint8(8, 0)
  view.setUint8(9, 0)
  view.setUint32(10, pixelData.length, true)
  uint8.set(md5digest, 14)

  uint8.set(pixelData, headerSize)
  return buffer
}
