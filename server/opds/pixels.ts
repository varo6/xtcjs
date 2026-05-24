export type DitheringAlgorithm = 'none' | 'sierra-lite' | 'atkinson' | 'floyd' | 'ordered'

function quantizePixel(value: number, is2bit: boolean): number {
  if (!is2bit) {
    return value >= 128 ? 255 : 0
  }
  if (value < 42) return 0
  if (value < 127) return 85
  if (value < 212) return 170
  return 255
}

export function toGrayscaleRgba(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = data[i + 1] = data[i + 2] = gray
  }
}

export function applyContrastRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  level: number
): void {
  const blackCutoff = 3 * level
  const whiteCutoff = 3 + 9 * level
  const histogram = new Array(256).fill(0)

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    histogram[gray]++
  }

  const totalPixels = width * height
  const blackThreshold = totalPixels * blackCutoff / 100
  const whiteThreshold = totalPixels * whiteCutoff / 100

  let blackPoint = 0
  let whitePoint = 255
  let count = 0

  for (let i = 0; i < 256; i++) {
    count += histogram[i]
    if (count >= blackThreshold) {
      blackPoint = i
      break
    }
  }

  count = 0
  for (let i = 255; i >= 0; i--) {
    count += histogram[i]
    if (count >= whiteThreshold) {
      whitePoint = i
      break
    }
  }

  const range = whitePoint - blackPoint
  if (range <= 0) return

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, ((data[i + c] - blackPoint) / range) * 255))
    }
  }
}

export function applyDitheringRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  algorithm: string,
  is2bit = false
): void {
  switch (algorithm) {
    case 'none':
      applyThreshold(data, is2bit)
      break
    case 'sierra-lite':
      applySierraLite(data, width, height, is2bit)
      break
    case 'atkinson':
      applyAtkinson(data, width, height, is2bit)
      break
    case 'ordered':
      applyOrdered(data, width, height, is2bit)
      break
    case 'floyd':
    default:
      applyFloydSteinberg(data, width, height, is2bit)
      break
  }
}

function applyThreshold(data: Uint8ClampedArray, is2bit: boolean): void {
  for (let i = 0; i < data.length; i += 4) {
    const val = quantizePixel(data[i], is2bit)
    data[i] = data[i + 1] = data[i + 2] = val
  }
}

function applySierraLite(data: Uint8ClampedArray, width: number, height: number, is2bit: boolean): void {
  const pixels = new Float32Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = oldPixel - newPixel

      if (x + 1 < width) pixels[idx + 1] += error * 2 / 4
      if (y + 1 < height) {
        if (x > 0) pixels[idx + width - 1] += error * 1 / 4
        pixels[idx + width] += error * 1 / 4
      }
    }
  }

  copyPixelsToRgba(pixels, data)
}

function applyAtkinson(data: Uint8ClampedArray, width: number, height: number, is2bit: boolean): void {
  const pixels = new Float32Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = (oldPixel - newPixel) / 8

      if (x + 1 < width) pixels[idx + 1] += error
      if (x + 2 < width) pixels[idx + 2] += error
      if (y + 1 < height) {
        if (x > 0) pixels[idx + width - 1] += error
        pixels[idx + width] += error
        if (x + 1 < width) pixels[idx + width + 1] += error
      }
      if (y + 2 < height) pixels[idx + width * 2] += error
    }
  }

  copyPixelsToRgba(pixels, data)
}

function applyFloydSteinberg(data: Uint8ClampedArray, width: number, height: number, is2bit: boolean): void {
  const pixels = new Float32Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = oldPixel - newPixel

      if (x + 1 < width) pixels[idx + 1] += error * 7 / 16
      if (y + 1 < height) {
        if (x > 0) pixels[idx + width - 1] += error * 3 / 16
        pixels[idx + width] += error * 5 / 16
        if (x + 1 < width) pixels[idx + width + 1] += error * 1 / 16
      }
    }
  }

  copyPixelsToRgba(pixels, data)
}

function applyOrdered(data: Uint8ClampedArray, width: number, height: number, is2bit: boolean): void {
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const matrixValue = bayer[y % 4][x % 4]
      let val: number
      if (is2bit) {
        const adjusted = data[idx] + (((matrixValue + 0.5) / 16) - 0.5) * 64
        val = quantizePixel(Math.max(0, Math.min(255, adjusted)), true)
      } else {
        const threshold = (matrixValue / 16) * 255
        val = data[idx] > threshold ? 255 : 0
      }
      data[idx] = data[idx + 1] = data[idx + 2] = val
    }
  }
}

function copyPixelsToRgba(pixels: Float32Array, data: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i++) {
    const val = Math.max(0, Math.min(255, pixels[i]))
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = val
  }
}

export function rgbaToXtg(data: Uint8ClampedArray, width: number, height: number): ArrayBuffer {
  const rowBytes = Math.ceil(width / 8)
  const pixelData = new Uint8Array(rowBytes * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const bit = data[idx] >= 128 ? 1 : 0
      const byteIndex = y * rowBytes + Math.floor(x / 8)
      const bitIndex = 7 - (x % 8)
      if (bit) pixelData[byteIndex] |= 1 << bitIndex
    }
  }

  return buildPageBuffer('XTG', width, height, pixelData)
}

export function rgbaToXth(data: Uint8ClampedArray, width: number, height: number): ArrayBuffer {
  const colBytes = Math.ceil(height / 8)
  const planeSize = colBytes * width
  const plane0 = new Uint8Array(planeSize)
  const plane1 = new Uint8Array(planeSize)

  for (let x = 0; x < width; x++) {
    const targetCol = width - 1 - x
    const colOffset = targetCol * colBytes

    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4
      const value = get2BitLevel(data[idx])
      const byteIndex = colOffset + (y >> 3)
      const bitIndex = 7 - (y & 7)

      if (value & 1) plane0[byteIndex] |= 1 << bitIndex
      if (value & 2) plane1[byteIndex] |= 1 << bitIndex
    }
  }

  const pixelData = new Uint8Array(planeSize * 2)
  pixelData.set(plane0)
  pixelData.set(plane1, planeSize)
  return buildPageBuffer('XTH', width, height, pixelData)
}

function get2BitLevel(value: number): number {
  if (value >= 212) return 0
  if (value >= 127) return 1
  if (value >= 42) return 2
  return 3
}

function createDigestSeed(data: Uint8Array): Uint8Array {
  const digest = new Uint8Array(8)
  for (let i = 0; i < Math.min(8, data.length); i++) {
    digest[i] = data[i]
  }
  return digest
}

function buildPageBuffer(magic: 'XTG' | 'XTH', width: number, height: number, pixelData: Uint8Array): ArrayBuffer {
  const digest = createDigestSeed(pixelData)
  const headerSize = 22
  const buffer = new ArrayBuffer(headerSize + pixelData.length)
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
