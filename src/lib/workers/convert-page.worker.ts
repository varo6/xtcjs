import { applyDithering } from '../processing/dithering'
import { TARGET_WIDTH, TARGET_HEIGHT } from '../processing/canvas'
import { applyContrast, calculateOverlapSegments, toGrayscale } from '../processing/image'
import { imageDataToXtg } from '../processing/xtg'
import type { ConversionOptions } from '../conversion/types'

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

interface WorkerRequest {
  jobId: number
  pageNum: number
  blob: Blob
  options: ConversionOptions
  includePreview: boolean
}

interface WorkerPageResult {
  name: string
  xtg: ArrayBuffer
  previewJpeg?: ArrayBuffer
}

interface WorkerResponse {
  jobId: number
  pages?: WorkerPageResult[]
  error?: string
}

const PREVIEW_WIDTH = 240
const PREVIEW_HEIGHT = 400
const PREVIEW_JPEG_QUALITY = 0.55

function clampMarginPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(20, value))
}

function getAxisCropRect(
  sourceWidth: number,
  sourceHeight: number,
  options: ConversionOptions
): CropRect {
  const horizontalMargin = clampMarginPercent(options.horizontalMargin)
  const verticalMargin = clampMarginPercent(options.verticalMargin)

  const maxCropX = Math.floor((sourceWidth - 1) / 2)
  const maxCropY = Math.floor((sourceHeight - 1) / 2)

  const cropX = Math.min(Math.floor(sourceWidth * horizontalMargin / 100), maxCropX)
  const cropY = Math.min(Math.floor(sourceHeight * verticalMargin / 100), maxCropY)

  return {
    x: cropX,
    y: cropY,
    width: Math.max(1, sourceWidth - cropX * 2),
    height: Math.max(1, sourceHeight - cropY * 2)
  }
}

function asCanvas2d(ctx: OffscreenCanvasRenderingContext2D): CanvasRenderingContext2D {
  return ctx as unknown as CanvasRenderingContext2D
}

function rotateCanvas(canvas: OffscreenCanvas, degrees: number): OffscreenCanvas {
  const rotated = degrees === -90 || degrees === 90
    ? new OffscreenCanvas(canvas.height, canvas.width)
    : new OffscreenCanvas(canvas.width, canvas.height)

  const ctx = rotated.getContext('2d', { alpha: false })!
  ctx.translate(rotated.width / 2, rotated.height / 2)
  ctx.rotate(degrees * Math.PI / 180)
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return rotated
}

function extractAndRotate(
  source: OffscreenCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  degrees = 90
): OffscreenCanvas {
  const extract = new OffscreenCanvas(w, h)
  const ctx = extract.getContext('2d', { alpha: false })!
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h)
  return rotateCanvas(extract, degrees)
}

function resizeWithPadding(canvas: OffscreenCanvas, padColor = 255): OffscreenCanvas {
  const result = new OffscreenCanvas(TARGET_WIDTH, TARGET_HEIGHT)
  const ctx = result.getContext('2d', { alpha: false })!
  ctx.fillStyle = `rgb(${padColor}, ${padColor}, ${padColor})`
  ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT)

  const scale = Math.min(TARGET_WIDTH / canvas.width, TARGET_HEIGHT / canvas.height)
  const newWidth = Math.floor(canvas.width * scale)
  const newHeight = Math.floor(canvas.height * scale)
  const x = Math.floor((TARGET_WIDTH - newWidth) / 2)
  const y = Math.floor((TARGET_HEIGHT - newHeight) / 2)
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, newWidth, newHeight)
  return result
}

async function buildWorkerPage(
  name: string,
  canvas: OffscreenCanvas,
  includePreview: boolean
): Promise<WorkerPageResult> {
  const ctx = canvas.getContext('2d', { alpha: false })!
  const xtg = imageDataToXtg(ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT))

  if (!includePreview) {
    return { name, xtg }
  }

  const previewCanvas = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT)
  const previewCtx = previewCanvas.getContext('2d', { alpha: false })!
  previewCtx.fillStyle = 'rgb(255,255,255)'
  previewCtx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  previewCtx.drawImage(canvas, 0, 0, TARGET_WIDTH, TARGET_HEIGHT, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
  const previewBlob = await previewCanvas.convertToBlob({
    type: 'image/jpeg',
    quality: PREVIEW_JPEG_QUALITY
  })

  return {
    name,
    xtg,
    previewJpeg: await previewBlob.arrayBuffer()
  }
}

async function processBitmap(
  source: ImageBitmap,
  pageNum: number,
  options: ConversionOptions,
  includePreview: boolean
): Promise<WorkerPageResult[]> {
  const results: WorkerPageResult[] = []
  const crop = getAxisCropRect(source.width, source.height, options)

  const baseCanvas = new OffscreenCanvas(crop.width, crop.height)
  const baseCtx = baseCanvas.getContext('2d', { alpha: false })!
  baseCtx.drawImage(
    source,
    crop.x, crop.y,
    crop.width, crop.height,
    0, 0,
    crop.width, crop.height
  )

  const width = crop.width
  const height = crop.height

  if (options.contrast > 0) {
    applyContrast(asCanvas2d(baseCtx), width, height, options.contrast)
  }

  toGrayscale(asCanvas2d(baseCtx), width, height)

  if (options.orientation === 'portrait') {
    const finalCanvas = resizeWithPadding(baseCanvas)
    applyDithering(asCanvas2d(finalCanvas.getContext('2d', { alpha: false })!), TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
    results.push(await buildWorkerPage(
      `${String(pageNum).padStart(4, '0')}_0_page.png`,
      finalCanvas,
      includePreview
    ))
    return results
  }

  const landscapeRotation = options.landscapeFlipClockwise ? -90 : 90
  const shouldSplit = width < height && options.splitMode !== 'nosplit'
  let previewAssigned = false

  if (shouldSplit) {
    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx]
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(baseCanvas, seg.x, seg.y, seg.w, seg.h, landscapeRotation)
        const finalCanvas = resizeWithPadding(pageCanvas)
        applyDithering(asCanvas2d(finalCanvas.getContext('2d', { alpha: false })!), TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

        results.push(await buildWorkerPage(
          `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          finalCanvas,
          includePreview && !previewAssigned
        ))
        previewAssigned = true
      }
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(baseCanvas, 0, 0, width, halfHeight, landscapeRotation)
      const topFinal = resizeWithPadding(topCanvas)
      applyDithering(asCanvas2d(topFinal.getContext('2d', { alpha: false })!), TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push(await buildWorkerPage(
        `${String(pageNum).padStart(4, '0')}_2_a.png`,
        topFinal,
        includePreview && !previewAssigned
      ))
      previewAssigned = true

      const bottomCanvas = extractAndRotate(baseCanvas, 0, halfHeight, width, halfHeight, landscapeRotation)
      const bottomFinal = resizeWithPadding(bottomCanvas)
      applyDithering(asCanvas2d(bottomFinal.getContext('2d', { alpha: false })!), TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push(await buildWorkerPage(
        `${String(pageNum).padStart(4, '0')}_2_b.png`,
        bottomFinal,
        includePreview && !previewAssigned
      ))
    }
  } else {
    const rotatedCanvas = rotateCanvas(baseCanvas, landscapeRotation)
    const finalCanvas = resizeWithPadding(rotatedCanvas)
    applyDithering(asCanvas2d(finalCanvas.getContext('2d', { alpha: false })!), TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
    results.push(await buildWorkerPage(
      `${String(pageNum).padStart(4, '0')}_0_spread.png`,
      finalCanvas,
      includePreview
    ))
  }

  return results
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { jobId, pageNum, blob, options, includePreview } = event.data

  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const pages = await processBitmap(bitmap, pageNum, options, includePreview)
      const transferables: Transferable[] = []
      for (const page of pages) {
        transferables.push(page.xtg)
        if (page.previewJpeg) transferables.push(page.previewJpeg)
      }

      const response: WorkerResponse = { jobId, pages }
      ;(self as any).postMessage(response, transferables)
    } finally {
      bitmap.close()
    }
  } catch (err) {
    const response: WorkerResponse = {
      jobId,
      error: err instanceof Error ? err.message : 'Worker processing failed'
    }
    ;(self as any).postMessage(response)
  }
}
