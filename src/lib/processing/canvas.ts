// Canvas utility functions for rotation and resizing

import { DEVICES } from '../devices'

export const TARGET_WIDTH = DEVICES.X4.width;
export const TARGET_HEIGHT = DEVICES.X4.height;

/**
 * Rotate canvas by specified degrees
 */
export function rotateCanvas(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rotated = document.createElement('canvas');

  if (degrees === -90 || degrees === 90) {
    rotated.width = canvas.height;
    rotated.height = canvas.width;
  } else {
    rotated.width = canvas.width;
    rotated.height = canvas.height;
  }

  const ctx = rotated.getContext('2d')!;
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

  return rotated;
}

/**
 * Extract a region from canvas and rotate it
 */
export function extractAndRotate(
  srcCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  degrees = 90
): HTMLCanvasElement {
  const extractCanvas = document.createElement('canvas');
  extractCanvas.width = w;
  extractCanvas.height = h;
  const ctx = extractCanvas.getContext('2d')!;
  ctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);

  return rotateCanvas(extractCanvas, degrees);
}

/**
 * Extract a region from canvas without rotation (for portrait mode)
 */
export function extractRegion(
  srcCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
): HTMLCanvasElement {
  const extractCanvas = document.createElement('canvas');
  extractCanvas.width = w;
  extractCanvas.height = h;
  const ctx = extractCanvas.getContext('2d')!;
  ctx.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);

  return extractCanvas;
}

/**
 * Resize canvas with padding to fit target dimensions
 */
export function resizeWithPadding(
  canvas: HTMLCanvasElement,
  padColor = 255,
  targetWidth: number = TARGET_WIDTH,
  targetHeight: number = TARGET_HEIGHT
): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = targetWidth;
  result.height = targetHeight;
  const ctx = result.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fill with padding color (white by default)
  ctx.fillStyle = `rgb(${padColor}, ${padColor}, ${padColor})`;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // Calculate scale to fit
  const scale = Math.min(targetWidth / canvas.width, targetHeight / canvas.height);
  const newWidth = Math.floor(canvas.width * scale);
  const newHeight = Math.floor(canvas.height * scale);

  // Center the image
  const x = Math.floor((targetWidth - newWidth) / 2);
  const y = Math.floor((targetHeight - newHeight) / 2);

  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, newWidth, newHeight);

  return result;
}
