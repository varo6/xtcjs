// Dithering algorithms optimized for manga on e-ink displays
// Each algorithm has different characteristics for handling manga art
//
// Pipeline applied here (after grayscale/resize, right before bit-packing):
//   1. Unsharp mask  - recovers line-art crispness lost when downscaling to panel size
//   2. Tone curve    - 2-bit only: lifts shadows so dark shading doesn't crush to black
//                      on the panel (the e-ink dark-gray level renders darker than its
//                      nominal sRGB value, which makes shadow areas merge into black)
//   3. Quantization  - serpentine error diffusion (alternating scan direction removes
//                      the diagonal "worm" artifacts of classic one-way diffusion)

const LEVELS_2BIT = [0, 85, 170, 255]

// Shadow-lift LUT for 2-bit output. Gamma < 1 lifts midtones/shadows while keeping
// black and white anchored, compensating for the panel's dark gray rendering darker
// than nominal. A linear toe below 24 keeps solid blacks solid.
const SHADOW_LIFT_GAMMA = 0.75
const SHADOW_TOE = 24
const shadowLiftLut = buildShadowLiftLut()

function buildShadowLiftLut(): Float32Array {
  const lut = new Float32Array(256)
  const toeTop = 255 * Math.pow(SHADOW_TOE / 255, SHADOW_LIFT_GAMMA)
  for (let v = 0; v < 256; v++) {
    if (v < SHADOW_TOE) {
      lut[v] = (v / SHADOW_TOE) * toeTop
    } else {
      lut[v] = 255 * Math.pow(v / 255, SHADOW_LIFT_GAMMA)
    }
  }
  return lut
}

function quantizePixel(value: number, is2bit: boolean): number {
  if (!is2bit) {
    return value >= 128 ? 255 : 0
  }
  // Nearest of the four levels (midpoint thresholds)
  if (value < 42.5) return 0
  if (value < 127.5) return 85
  if (value < 212.5) return 170
  return 255
}

/**
 * Applies the selected dithering algorithm to canvas
 */
export function applyDithering(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  algorithm: string,
  is2bit = false
): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  // Single luminance working buffer shared by all stages
  const pixels = new Float32Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4]
  }

  // Slightly lighter sharpening for 2-bit: it keeps more real tonal data,
  // so it needs less artificial edge boost.
  sharpenLuminance(pixels, width, height, is2bit ? 0.45 : 0.7)

  if (is2bit) {
    applyShadowLift(pixels)
  }

  switch (algorithm) {
    case 'none':
      applyThreshold(pixels, is2bit)
      break
    case 'sierra-lite':
      applySierraLite(pixels, width, height, is2bit)
      break
    case 'atkinson':
      applyAtkinson(pixels, width, height, is2bit)
      break
    case 'floyd':
      applyFloydSteinberg(pixels, width, height, is2bit)
      break
    case 'ordered':
      applyOrdered(pixels, width, height, is2bit)
      break
    default:
      applyFloydSteinberg(pixels, width, height, is2bit)
  }

  for (let i = 0; i < pixels.length; i++) {
    const val = Math.max(0, Math.min(255, pixels[i]))
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = val
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Unsharp mask on the luminance buffer (3x3 gaussian blur as base).
 * Restores edge contrast on line art and text after downscaling.
 */
function sharpenLuminance(
  pixels: Float32Array,
  width: number,
  height: number,
  amount: number
): void {
  if (amount <= 0 || width < 3 || height < 3) return

  const blurred = new Float32Array(pixels.length)

  for (let y = 0; y < height; y++) {
    const yUp = y > 0 ? y - 1 : 0
    const yDown = y < height - 1 ? y + 1 : height - 1
    const rowUp = yUp * width
    const row = y * width
    const rowDown = yDown * width

    for (let x = 0; x < width; x++) {
      const xL = x > 0 ? x - 1 : 0
      const xR = x < width - 1 ? x + 1 : width - 1

      // [1 2 1; 2 4 2; 1 2 1] / 16
      blurred[row + x] = (
        pixels[rowUp + xL] + 2 * pixels[rowUp + x] + pixels[rowUp + xR] +
        2 * pixels[row + xL] + 4 * pixels[row + x] + 2 * pixels[row + xR] +
        pixels[rowDown + xL] + 2 * pixels[rowDown + x] + pixels[rowDown + xR]
      ) / 16
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    const sharpened = pixels[i] + amount * (pixels[i] - blurred[i])
    pixels[i] = Math.max(0, Math.min(255, sharpened))
  }
}

/**
 * Shadow-lifting tone curve for 2-bit output (see SHADOW_LIFT_GAMMA above).
 */
function applyShadowLift(pixels: Float32Array): void {
  for (let i = 0; i < pixels.length; i++) {
    const v = Math.max(0, Math.min(255, pixels[i]))
    const lo = Math.floor(v)
    const hi = Math.min(255, lo + 1)
    const frac = v - lo
    pixels[i] = shadowLiftLut[lo] * (1 - frac) + shadowLiftLut[hi] * frac
  }
}

/**
 * Simple threshold - no dithering
 */
function applyThreshold(pixels: Float32Array, is2bit: boolean): void {
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = quantizePixel(pixels[i], is2bit)
  }
}

// Clamp accumulated error so high-contrast edges (text, panel borders)
// don't smear streaks of inverted pixels into neighboring flat areas.
const ERROR_CLAMP = 96

function clampError(error: number): number {
  if (error > ERROR_CLAMP) return ERROR_CLAMP
  if (error < -ERROR_CLAMP) return -ERROR_CLAMP
  return error
}

/**
 * Sierra Lite dithering (serpentine)
 * Lighter than Floyd-Steinberg, preserves fine details and text
 * Error distribution:
 *         X   2
 *     1   1
 * Divider: 4
 */
function applySierraLite(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1
    const dir = reverse ? -1 : 1

    for (let i = 0; i < width; i++) {
      const x = reverse ? width - 1 - i : i
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = clampError(oldPixel - newPixel)

      const xAhead = x + dir
      const xBehind = x - dir

      if (xAhead >= 0 && xAhead < width) pixels[idx + dir] += error * 2 / 4
      if (y + 1 < height) {
        if (xBehind >= 0 && xBehind < width) pixels[idx + width - dir] += error * 1 / 4
        pixels[idx + width] += error * 1 / 4
      }
    }
  }
}

/**
 * Atkinson dithering (serpentine)
 * Creates lighter images, good for preventing dark pages
 * Only distributes 75% of error (6/8)
 */
function applyAtkinson(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1
    const dir = reverse ? -1 : 1

    for (let i = 0; i < width; i++) {
      const x = reverse ? width - 1 - i : i
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = clampError(oldPixel - newPixel) / 8

      const xAhead1 = x + dir
      const xAhead2 = x + dir * 2
      const xBehind = x - dir

      if (xAhead1 >= 0 && xAhead1 < width) pixels[idx + dir] += error
      if (xAhead2 >= 0 && xAhead2 < width) pixels[idx + dir * 2] += error
      if (y + 1 < height) {
        if (xBehind >= 0 && xBehind < width) pixels[idx + width - dir] += error
        pixels[idx + width] += error
        if (xAhead1 >= 0 && xAhead1 < width) pixels[idx + width + dir] += error
      }
      if (y + 2 < height) {
        pixels[idx + width * 2] += error
      }
    }
  }
}

/**
 * Floyd-Steinberg dithering (serpentine)
 * The classic algorithm, good balance
 */
function applyFloydSteinberg(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1
    const dir = reverse ? -1 : 1

    for (let i = 0; i < width; i++) {
      const x = reverse ? width - 1 - i : i
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = quantizePixel(oldPixel, is2bit)
      pixels[idx] = newPixel
      const error = clampError(oldPixel - newPixel)

      const xAhead = x + dir
      const xBehind = x - dir

      if (xAhead >= 0 && xAhead < width) pixels[idx + dir] += error * 7 / 16
      if (y + 1 < height) {
        if (xBehind >= 0 && xBehind < width) pixels[idx + width - dir] += error * 3 / 16
        pixels[idx + width] += error * 5 / 16
        if (xAhead >= 0 && xAhead < width) pixels[idx + width + dir] += error * 1 / 16
      }
    }
  }
}

// 8x8 Bayer matrix - finer pattern than 4x4, smoother gradients in screentones
const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
]

/**
 * Ordered/Bayer dithering (8x8 matrix)
 * Creates regular patterns, no error bleeding between regions
 */
function applyOrdered(
  pixels: Float32Array,
  width: number,
  height: number,
  is2bit: boolean
): void {
  // 2-bit level spacing is 85; spread the matrix across one level interval
  const amplitude2bit = 85

  for (let y = 0; y < height; y++) {
    const row = BAYER_8[y & 7]
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const matrixValue = row[x & 7]

      if (is2bit) {
        const adjusted = pixels[idx] + (((matrixValue + 0.5) / 64) - 0.5) * amplitude2bit
        pixels[idx] = quantizePixel(Math.max(0, Math.min(255, adjusted)), true)
      } else {
        const threshold = ((matrixValue + 0.5) / 64) * 255
        pixels[idx] = pixels[idx] > threshold ? 255 : 0
      }
    }
  }
}
