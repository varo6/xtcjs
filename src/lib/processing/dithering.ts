import { applyDitheringRgba } from './pixels'

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
  applyDitheringRgba(imageData.data, width, height, algorithm, is2bit)
  ctx.putImageData(imageData, 0, 0)
}
