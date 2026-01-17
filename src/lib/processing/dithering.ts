// Dithering algorithms optimized for manga on e-ink displays
// Each algorithm has different characteristics for handling manga art

/**
 * Applies the selected dithering algorithm to canvas
 */
export function applyDithering(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  algorithm: string
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  switch (algorithm) {
    case 'none':
      applyThreshold(data);
      break;
    case 'sierra-lite':
      applySierraLite(data, width, height);
      break;
    case 'atkinson':
      applyAtkinson(data, width, height);
      break;
    case 'floyd':
      applyFloydSteinberg(data, width, height);
      break;
    case 'ordered':
      applyOrdered(data, width, height);
      break;
    default:
      applyFloydSteinberg(data, width, height);
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Simple threshold - no dithering
 */
function applyThreshold(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const val = data[i] >= 128 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
}

/**
 * Sierra Lite dithering
 * Lighter than Floyd-Steinberg, preserves fine details and text
 * Error distribution:
 *         X   2
 *     1   1
 * Divider: 4
 */
function applySierraLite(data: Uint8ClampedArray, width: number, height: number): void {
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = pixels[idx];
      const newPixel = oldPixel >= 128 ? 255 : 0;
      pixels[idx] = newPixel;
      const error = oldPixel - newPixel;

      // Distribute error
      if (x + 1 < width) pixels[idx + 1] += error * 2 / 4;
      if (y + 1 < height) {
        if (x > 0) pixels[idx + width - 1] += error * 1 / 4;
        pixels[idx + width] += error * 1 / 4;
      }
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    const val = Math.max(0, Math.min(255, pixels[i]));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = val;
  }
}

/**
 * Atkinson dithering
 * Creates lighter images, good for preventing dark pages
 * Only distributes 75% of error (6/8)
 */
function applyAtkinson(data: Uint8ClampedArray, width: number, height: number): void {
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = pixels[idx];
      const newPixel = oldPixel >= 128 ? 255 : 0;
      pixels[idx] = newPixel;
      const error = (oldPixel - newPixel) / 8;

      if (x + 1 < width) pixels[idx + 1] += error;
      if (x + 2 < width) pixels[idx + 2] += error;
      if (y + 1 < height) {
        if (x > 0) pixels[idx + width - 1] += error;
        pixels[idx + width] += error;
        if (x + 1 < width) pixels[idx + width + 1] += error;
      }
      if (y + 2 < height) {
        pixels[idx + width * 2] += error;
      }
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    const val = Math.max(0, Math.min(255, pixels[i]));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = val;
  }
}

/**
 * Floyd-Steinberg dithering
 * The classic algorithm, good balance
 */
function applyFloydSteinberg(data: Uint8ClampedArray, width: number, height: number): void {
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * 4];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = pixels[idx];
      const newPixel = oldPixel >= 128 ? 255 : 0;
      pixels[idx] = newPixel;
      const error = oldPixel - newPixel;

      if (x + 1 < width) pixels[idx + 1] += error * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) pixels[idx + width - 1] += error * 3 / 16;
        pixels[idx + width] += error * 5 / 16;
        if (x + 1 < width) pixels[idx + width + 1] += error * 1 / 16;
      }
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    const val = Math.max(0, Math.min(255, pixels[i]));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = val;
  }
}

/**
 * Ordered/Bayer dithering
 * Creates regular patterns
 */
function applyOrdered(data: Uint8ClampedArray, width: number, height: number): void {
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const threshold = (bayer[y % 4][x % 4] / 16) * 255;
      const val = data[idx] > threshold ? 255 : 0;
      data[idx] = data[idx + 1] = data[idx + 2] = val;
    }
  }
}
