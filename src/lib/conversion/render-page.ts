import { applyDithering } from '../processing/dithering'
import { applyContrast, calculateFourWaySegments, calculateOverlapSegments, calculateSpreadSegments, findContentBounds, shouldSplitPage, toGrayscale } from '../processing/image'
import { context2d, createCanvas, encodeJpeg, extractAndRotate, extractRegion, resizeWithPadding, rotateCanvas, type PageCanvas } from '../processing/canvas'
import { imageDataToXtg, imageDataToXth } from '../processing/xtg'
import { getTargetDimensions } from '../devices'
import type { ConversionOptions } from './types'

const PREVIEW_WIDTH = 240
const PREVIEW_HEIGHT = 400
const PREVIEW_JPEG_QUALITY = 0.55

export type DecodedPage = ImageBitmap | HTMLImageElement | PageCanvas

export interface ConvertedPage {
  name: string
  xtg: ArrayBuffer
  preview?: Blob
}

interface RenderedPage {
  name: string
  canvas: PageCanvas
}

export async function convertPage(
  source: DecodedPage,
  pageNum: number,
  options: ConversionOptions,
  includePreview: boolean
): Promise<ConvertedPage[]> {
  const rendered = renderPage(source, pageNum, options)
  const pages: ConvertedPage[] = rendered.map(({ name, canvas }) => ({ name, xtg: encodeXtg(canvas, options.is2bit) }))
  if (includePreview) {
    pages[0].preview = await previewJpeg(rendered[0].canvas)
  }
  return pages
}

function renderPage(source: DecodedPage, pageNum: number, options: ConversionOptions): RenderedPage[] {
  const { width: targetWidth, height: targetHeight } = getTargetDimensions(options.device)
  const { x, y, width, height } = getAxisCropRect(source.width, source.height, options)

  const base = createCanvas(width, height)
  const ctx = context2d(base)
  // Transparent source pixels become white, as on paper.
  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height)
  if (options.contrast > 0) {
    applyContrast(ctx, width, height, options.contrast)
  }
  toGrayscale(ctx, width, height)

  const page = (suffix: string, canvas: PageCanvas): RenderedPage => {
    applyDithering(context2d(canvas), targetWidth, targetHeight, options.dithering, options.is2bit)
    return { name: `${String(pageNum).padStart(4, '0')}_${suffix}.png`, canvas }
  }
  const fit = (canvas: PageCanvas) => resizeWithPadding(canvas, 255, targetWidth, targetHeight)
  const letter = (index: number) => String.fromCharCode(97 + index)

  const shouldSplit = shouldSplitPage(width, height, options.orientation, options.splitMode, options.splitSpreads)
  if (options.orientation === 'portrait' && !shouldSplit) {
    return [page('0_page', applyImageMode(base, targetWidth, targetHeight, options.imageMode))]
  }

  const rotation = options.landscapeFlipClockwise ? -90 : 90
  if (!shouldSplit) {
    return [page('0_spread', fit(rotateCanvas(base, rotation)))]
  }

  const pages: RenderedPage[] = []
  if (options.orientation === 'landscape' && options.pageOverview !== 'none') {
    const overview = options.pageOverview === 'portrait' ? base : rotateCanvas(base, rotation)
    pages.push(page(`1_overview_${options.pageOverview}`, fit(overview)))
  }

  const spreadSegments = options.splitSpreads
    ? calculateSpreadSegments(width, height, options.splitMode, targetWidth, targetHeight)
    : []
  if (options.splitMode === 'overlap' || spreadSegments.length > 0) {
    const segments = spreadSegments.length > 0
      ? spreadSegments
      : calculateOverlapSegments(width, height, targetWidth, targetHeight)
    segments.forEach((seg, i) => {
      pages.push(page(`3_${letter(i)}`, fit(extractAndRotate(base, seg.x, seg.y, seg.w, seg.h, rotation))))
    })
  } else if (options.splitMode === 'fourway') {
    calculateFourWaySegments(width, height).forEach((seg, i) => {
      const segment = trimToContent(extractRegion(base, seg.x, seg.y, seg.w, seg.h))
      pages.push(page(`4_${letter(i)}`, fit(options.orientation === 'portrait' ? segment : rotateCanvas(segment, rotation))))
    })
  } else {
    const half = Math.floor(height / 2)
    pages.push(page('2_a', fit(extractAndRotate(base, 0, 0, width, half, rotation))))
    pages.push(page('2_b', fit(extractAndRotate(base, 0, half, width, half, rotation))))
  }
  return pages
}

function clampMarginPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(20, value))
}

function getAxisCropRect(sourceWidth: number, sourceHeight: number, options: ConversionOptions) {
  const maxCropX = Math.floor((sourceWidth - 1) / 2)
  const maxCropY = Math.floor((sourceHeight - 1) / 2)
  const cropX = Math.min(Math.floor(sourceWidth * clampMarginPercent(options.horizontalMargin) / 100), maxCropX)
  const cropY = Math.min(Math.floor(sourceHeight * clampMarginPercent(options.verticalMargin) / 100), maxCropY)
  return {
    x: cropX,
    y: cropY,
    width: Math.max(1, sourceWidth - cropX * 2),
    height: Math.max(1, sourceHeight - cropY * 2)
  }
}

function trimToContent(canvas: PageCanvas): PageCanvas {
  const bounds = findContentBounds(context2d(canvas).getImageData(0, 0, canvas.width, canvas.height))
  return bounds ? extractRegion(canvas, bounds.x, bounds.y, bounds.width, bounds.height) : canvas
}

function applyImageMode(
  source: PageCanvas,
  targetWidth: number,
  targetHeight: number,
  imageMode: ConversionOptions['imageMode']
): PageCanvas {
  if (imageMode === 'letterbox') {
    return resizeWithPadding(source, 255, targetWidth, targetHeight)
  }

  const result = createCanvas(targetWidth, targetHeight)
  const ctx = context2d(result)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (imageMode === 'fill') {
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
    return result
  }

  if (imageMode === 'crop') {
    const sourceAspect = source.width / source.height
    const targetAspect = targetWidth / targetHeight
    let sx = 0
    let sy = 0
    let sw = source.width
    let sh = source.height
    if (sourceAspect > targetAspect) {
      sw = Math.round(source.height * targetAspect)
      sx = Math.floor((source.width - sw) / 2)
    } else if (sourceAspect < targetAspect) {
      sh = Math.round(source.width / targetAspect)
      sy = Math.floor((source.height - sh) / 2)
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
    return result
  }

  const scale = Math.max(targetWidth / source.width, targetHeight / source.height)
  const drawWidth = Math.round(source.width * scale)
  const drawHeight = Math.round(source.height * scale)
  ctx.drawImage(source, Math.floor((targetWidth - drawWidth) / 2), Math.floor((targetHeight - drawHeight) / 2), drawWidth, drawHeight)
  return result
}

function encodeXtg(canvas: PageCanvas, is2bit: boolean): ArrayBuffer {
  const imageData = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height)
  return is2bit ? imageDataToXth(imageData) : imageDataToXtg(imageData)
}

function previewJpeg(canvas: PageCanvas): Promise<Blob> {
  const preview = createCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  context2d(preview).drawImage(canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  return encodeJpeg(preview, PREVIEW_JPEG_QUALITY)
}
