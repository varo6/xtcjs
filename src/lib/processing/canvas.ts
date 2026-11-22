import { DEVICES } from '../devices'

export const TARGET_WIDTH = DEVICES.X4.width
export const TARGET_HEIGHT = DEVICES.X4.height

export type PageCanvas = OffscreenCanvas | HTMLCanvasElement

export function createCanvas(width: number, height: number): PageCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function context2d(canvas: PageCanvas): CanvasRenderingContext2D {
  return canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
}

export function encodeJpeg(canvas: PageCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode canvas preview')), 'image/jpeg', quality)
  })
}

export function rotateCanvas(canvas: PageCanvas, degrees: number): PageCanvas {
  const quarterTurn = degrees === -90 || degrees === 90
  const rotated = createCanvas(quarterTurn ? canvas.height : canvas.width, quarterTurn ? canvas.width : canvas.height)
  const ctx = context2d(rotated)
  ctx.translate(rotated.width / 2, rotated.height / 2)
  ctx.rotate(degrees * Math.PI / 180)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return rotated
}

export function extractRegion(source: PageCanvas, x: number, y: number, w: number, h: number): PageCanvas {
  const region = createCanvas(w, h)
  context2d(region).drawImage(source, x, y, w, h, 0, 0, w, h)
  return region
}

export function extractAndRotate(source: PageCanvas, x: number, y: number, w: number, h: number, degrees: number): PageCanvas {
  return rotateCanvas(extractRegion(source, x, y, w, h), degrees)
}

export function resizeWithPadding(canvas: PageCanvas, padColor: number, targetWidth: number, targetHeight: number): PageCanvas {
  const result = createCanvas(targetWidth, targetHeight)
  const ctx = context2d(result)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = `rgb(${padColor}, ${padColor}, ${padColor})`
  ctx.fillRect(0, 0, targetWidth, targetHeight)

  const scale = Math.min(targetWidth / canvas.width, targetHeight / canvas.height)
  const newWidth = Math.floor(canvas.width * scale)
  const newHeight = Math.floor(canvas.height * scale)
  const x = Math.floor((targetWidth - newWidth) / 2)
  const y = Math.floor((targetHeight - newHeight) / 2)
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, newWidth, newHeight)
  return result
}
