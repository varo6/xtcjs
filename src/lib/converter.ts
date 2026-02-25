// CBZ/CBR/PDF to XTC conversion logic

import JSZip from 'jszip'
import { createExtractorFromData } from 'node-unrar-js'
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { applyDithering } from './processing/dithering'
import { toGrayscale, applyContrast, calculateOverlapSegments } from './processing/image'
import { rotateCanvas, extractAndRotate, resizeWithPadding, TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas'
import { imageDataToXtg } from './processing/xtg'
import { buildXtcFromXtgPages } from './xtc-format'
import { extractPdfMetadata } from './metadata/pdf-outline'
import { parseComicInfo } from './metadata/comicinfo'
import { PageMappingContext, adjustTocForMapping } from './page-mapping'
import { ConvertWorkerPool, isWorkerPipelineSupported } from './conversion/worker-pool'
import type { BookMetadata } from './metadata/types'
import type { ConversionOptions, ConversionResult } from './conversion/types'

export type { ConversionOptions, ConversionResult } from './conversion/types'

// Set up PDF.js worker from bundled asset
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const PERF_PIPELINE_V2 = true
const PREVIEW_EVERY_N_PAGES = 5
const MAX_STORED_PREVIEWS = 12
const PREVIEW_JPEG_QUALITY = 0.55

interface ProcessedPage {
  name: string
  canvas: HTMLCanvasElement
}

interface EncodedPage {
  name: string
  xtg: ArrayBuffer
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

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

function shouldGenerateSampledPreview(pageNum: number, totalPages: number): boolean {
  return pageNum === 1 || pageNum === totalPages || pageNum % PREVIEW_EVERY_N_PAGES === 0
}

function calculateWorkerPoolSize(): number {
  const cores = Math.max(2, navigator.hardwareConcurrency || 4)
  return Math.max(2, Math.min(6, Math.floor(cores * 0.6)))
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode canvas preview'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'))
    reader.readAsDataURL(blob)
  })
}

function encodeCanvasPage(page: ProcessedPage): EncodedPage {
  const ctx = page.canvas.getContext('2d')!
  const imageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT)
  return {
    name: page.name,
    xtg: imageDataToXtg(imageData)
  }
}

async function finalizeConversionResult(
  outputName: string,
  encodedPages: EncodedPage[],
  mappingCtx: PageMappingContext,
  metadata: BookMetadata,
  sampledPreviews: string[]
): Promise<ConversionResult> {
  encodedPages.sort((a, b) => a.name.localeCompare(b.name))

  if (metadata.toc.length > 0) {
    metadata.toc = adjustTocForMapping(metadata.toc, mappingCtx)
  }

  const xtcData = await buildXtcFromXtgPages(encodedPages.map((page) => page.xtg), { metadata })

  return {
    name: outputName,
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: encodedPages.length,
    pageImages: sampledPreviews,
    previewMode: 'sparse'
  }
}

async function processArchiveSourcePages(
  totalPages: number,
  getBlob: (index: number) => Promise<Blob>,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<{ encodedPages: EncodedPage[]; mappingCtx: PageMappingContext; sampledPreviews: string[] }> {
  const sampledPreviews: string[] = []
  const pageResultsByIndex: EncodedPage[][] = new Array(totalPages)

  let pool: ConvertWorkerPool | null = null
  let workerDisabled = false
  let completed = 0
  let nextIndex = 0

  if (PERF_PIPELINE_V2 && isWorkerPipelineSupported()) {
    pool = new ConvertWorkerPool(calculateWorkerPoolSize())
  }

  const concurrency = pool ? calculateWorkerPoolSize() : 1

  const runSlot = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= totalPages) {
        return
      }

      const pageNum = index + 1
      const includePreview = shouldGenerateSampledPreview(pageNum, totalPages)
      const imgBlob = await getBlob(index)

      let previewForProgress: string | null = null
      let previewForStorage: string | null = null
      let pageResults: EncodedPage[] = []

      if (pool && !workerDisabled) {
        try {
          const workerPages = await pool.processPage(pageNum, imgBlob, options, includePreview)
          pageResults = workerPages.map((page) => ({ name: page.name, xtg: page.xtg }))

          if (includePreview) {
            const previewBytes = workerPages.find((page) => page.previewJpeg)?.previewJpeg
            if (previewBytes) {
              const previewBlob = new Blob([previewBytes], { type: 'image/jpeg' })
              previewForProgress = URL.createObjectURL(previewBlob)
              if (sampledPreviews.length < MAX_STORED_PREVIEWS) {
                previewForStorage = await blobToDataUrl(previewBlob)
              }
            }
          }
        } catch {
          if (!workerDisabled) {
            workerDisabled = true
            pool.destroy()
            pool = null
          }
        }
      }

      if (pageResults.length === 0) {
        const pages = await processImage(imgBlob, pageNum, options)
        pageResults = pages.map(encodeCanvasPage)

        if (includePreview && pages.length > 0 && pages[0].canvas) {
          const previewDataUrl = pages[0].canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY)
          previewForProgress = previewDataUrl
          if (sampledPreviews.length < MAX_STORED_PREVIEWS) {
            previewForStorage = previewDataUrl
          }
        }
      }

      pageResultsByIndex[index] = pageResults
      if (previewForStorage && sampledPreviews.length < MAX_STORED_PREVIEWS) {
        sampledPreviews.push(previewForStorage)
      }

      completed++
      onProgress(completed / totalPages, previewForProgress)
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => runSlot()))
  } finally {
    pool?.destroy()
  }

  const mappingCtx = new PageMappingContext()
  const encodedPages: EncodedPage[] = []
  for (let i = 0; i < totalPages; i++) {
    const pages = pageResultsByIndex[i] || []
    mappingCtx.addOriginalPage(i + 1, pages.length)
    encodedPages.push(...pages)
  }

  return { encodedPages, mappingCtx, sampledPreviews }
}

/**
 * Convert a file to XTC format (supports CBZ, CBR and PDF)
 */
export async function convertToXtc(
  file: File,
  fileType: 'cbz' | 'cbr' | 'pdf',
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  if (fileType === 'pdf') {
    return convertPdfToXtc(file, options, onProgress)
  }
  if (fileType === 'cbr') {
    return convertCbrToXtc(file, options, onProgress)
  }
  return convertCbzToXtc(file, options, onProgress)
}

/**
 * Convert a CBZ file to XTC format
 */
export async function convertCbzToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const zip = await JSZip.loadAsync(file)

  const imageFiles: Array<{ path: string; entry: any }> = []
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
  let comicInfoEntry: any = null

  zip.forEach((relativePath: string, zipEntry: any) => {
    if (zipEntry.dir) return
    if (relativePath.toLowerCase().startsWith('__macos')) return

    const ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'))
    if (imageExtensions.includes(ext)) {
      imageFiles.push({ path: relativePath, entry: zipEntry })
    }

    if (relativePath.toLowerCase() === 'comicinfo.xml' ||
        relativePath.toLowerCase().endsWith('/comicinfo.xml')) {
      comicInfoEntry = zipEntry
    }
  })

  imageFiles.sort((a, b) => a.path.localeCompare(b.path))

  if (imageFiles.length === 0) {
    throw new Error('No images found in CBZ')
  }

  let metadata: BookMetadata = { toc: [] }
  if (comicInfoEntry) {
    try {
      const xmlContent = await comicInfoEntry.async('string')
      metadata = parseComicInfo(xmlContent)
    } catch {
      // Continue conversion without metadata.
    }
  }

  const { encodedPages, mappingCtx, sampledPreviews } = await processArchiveSourcePages(
    imageFiles.length,
    (index) => imageFiles[index].entry.async('blob'),
    options,
    onProgress
  )

  return finalizeConversionResult(
    file.name.replace(/\.cbz$/i, '.xtc'),
    encodedPages,
    mappingCtx,
    metadata,
    sampledPreviews
  )
}

// Cache for loaded wasm binary
let wasmBinaryCache: ArrayBuffer | null = null

async function loadUnrarWasm(): Promise<ArrayBuffer> {
  if (wasmBinaryCache) {
    return wasmBinaryCache
  }
  const response = await fetch(unrarWasm)
  wasmBinaryCache = await response.arrayBuffer()
  return wasmBinaryCache
}

/**
 * Convert a CBR file to XTC format
 */
export async function convertCbrToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const wasmBinary = await loadUnrarWasm()
  const arrayBuffer = await file.arrayBuffer()
  const extractor = await createExtractorFromData({ data: arrayBuffer, wasmBinary })

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
  const imageFiles: Array<{ path: string; data: Uint8Array }> = []
  let comicInfoContent: string | null = null

  const { files } = extractor.extract()
  for (const extractedFile of files) {
    if (extractedFile.fileHeader.flags.directory) continue

    const path = extractedFile.fileHeader.name
    if (path.toLowerCase().startsWith('__macos')) continue

    const ext = path.toLowerCase().substring(path.lastIndexOf('.'))
    if (imageExtensions.includes(ext) && extractedFile.extraction) {
      imageFiles.push({ path, data: extractedFile.extraction })
    }

    if ((path.toLowerCase() === 'comicinfo.xml' ||
         path.toLowerCase().endsWith('/comicinfo.xml')) &&
        extractedFile.extraction) {
      const decoder = new TextDecoder('utf-8')
      comicInfoContent = decoder.decode(extractedFile.extraction)
    }
  }

  imageFiles.sort((a, b) => a.path.localeCompare(b.path))

  if (imageFiles.length === 0) {
    throw new Error('No images found in CBR')
  }

  let metadata: BookMetadata = { toc: [] }
  if (comicInfoContent) {
    try {
      metadata = parseComicInfo(comicInfoContent)
    } catch {
      // Continue conversion without metadata.
    }
  }

  const { encodedPages, mappingCtx, sampledPreviews } = await processArchiveSourcePages(
    imageFiles.length,
    async (index) => new Blob([new Uint8Array(imageFiles[index].data)]),
    options,
    onProgress
  )

  return finalizeConversionResult(
    file.name.replace(/\.cbr$/i, '.xtc'),
    encodedPages,
    mappingCtx,
    metadata,
    sampledPreviews
  )
}

/**
 * Convert a PDF file to XTC format
 */
async function convertPdfToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let metadata: BookMetadata = { toc: [] }
  try {
    metadata = await extractPdfMetadata(pdf)
  } catch {
    // Continue conversion without metadata.
  }

  const encodedPages: EncodedPage[] = []
  const sampledPreviews: string[] = []
  const mappingCtx = new PageMappingContext()
  const numPages = pdf.numPages

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const scale = 2.0
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({
      canvas,
      viewport,
      background: 'rgb(255,255,255)'
    }).promise

    const pages = processCanvasAsImage(canvas, i, options)
    encodedPages.push(...pages.map(encodeCanvasPage))
    mappingCtx.addOriginalPage(i, pages.length)

    const includePreview = shouldGenerateSampledPreview(i, numPages)
    if (includePreview && pages.length > 0 && pages[0].canvas) {
      const previewBlob = await canvasToBlob(pages[0].canvas, 'image/jpeg', PREVIEW_JPEG_QUALITY)
      const previewDataUrl = await blobToDataUrl(previewBlob)
      onProgress(i / numPages, previewDataUrl)

      if (sampledPreviews.length < MAX_STORED_PREVIEWS) {
        sampledPreviews.push(previewDataUrl)
      }
    } else {
      onProgress(i / numPages, null)
    }
  }

  return finalizeConversionResult(
    file.name.replace(/\.pdf$/i, '.xtc'),
    encodedPages,
    mappingCtx,
    metadata,
    sampledPreviews
  )
}

/**
 * Process a canvas (from PDF rendering) through the same pipeline as images
 */
function processCanvasAsImage(
  sourceCanvas: HTMLCanvasElement,
  pageNum: number,
  options: ConversionOptions
): ProcessedPage[] {
  const results: ProcessedPage[] = []
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  const crop = getAxisCropRect(sourceCanvas.width, sourceCanvas.height, options)
  canvas.width = crop.width
  canvas.height = crop.height
  ctx.drawImage(
    sourceCanvas,
    crop.x, crop.y,
    crop.width, crop.height,
    0, 0,
    crop.width, crop.height
  )

  const width = crop.width
  const height = crop.height

  if (options.contrast > 0) {
    applyContrast(ctx, width, height, options.contrast)
  }

  toGrayscale(ctx, width, height)

  if (options.orientation === 'portrait') {
    const finalCanvas = resizeWithPadding(canvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_page.png`,
      canvas: finalCanvas
    })
    return results
  }

  const landscapeRotation = options.landscapeFlipClockwise ? -90 : 90
  const shouldSplit = width < height && options.splitMode !== 'nosplit'

  if (shouldSplit) {
    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h, landscapeRotation)
        const finalCanvas = resizeWithPadding(pageCanvas)
        applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        })
      })
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight, landscapeRotation)
      const topFinal = resizeWithPadding(topCanvas)
      applyDithering(topFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      })

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight, landscapeRotation)
      const bottomFinal = resizeWithPadding(bottomCanvas)
      applyDithering(bottomFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      })
    }
  } else {
    const rotatedCanvas = rotateCanvas(canvas, landscapeRotation)
    const finalCanvas = resizeWithPadding(rotatedCanvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_spread.png`,
      canvas: finalCanvas
    })
  }

  return results
}

/**
 * Process a single image
 */
async function processImage(
  imgBlob: Blob,
  pageNum: number,
  options: ConversionOptions
): Promise<ProcessedPage[]> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(imgBlob)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const pages = processLoadedImage(img, pageNum, options)
      resolve(pages)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      console.error(`Failed to load image for page ${pageNum}`)
      resolve([])
    }
    img.src = objectUrl
  })
}

/**
 * Process a loaded image element
 */
function processLoadedImage(
  img: HTMLImageElement,
  pageNum: number,
  options: ConversionOptions
): ProcessedPage[] {
  const results: ProcessedPage[] = []
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  const crop = getAxisCropRect(img.width, img.height, options)
  canvas.width = crop.width
  canvas.height = crop.height
  ctx.drawImage(
    img,
    crop.x, crop.y,
    crop.width, crop.height,
    0, 0,
    crop.width, crop.height
  )

  const width = crop.width
  const height = crop.height

  if (options.contrast > 0) {
    applyContrast(ctx, width, height, options.contrast)
  }

  toGrayscale(ctx, width, height)

  if (options.orientation === 'portrait') {
    const finalCanvas = resizeWithPadding(canvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_page.png`,
      canvas: finalCanvas
    })
    return results
  }

  const landscapeRotation = options.landscapeFlipClockwise ? -90 : 90
  const shouldSplit = width < height && options.splitMode !== 'nosplit'

  if (shouldSplit) {
    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h, landscapeRotation)
        const finalCanvas = resizeWithPadding(pageCanvas)
        applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        })
      })
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight, landscapeRotation)
      const topFinal = resizeWithPadding(topCanvas)
      applyDithering(topFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      })

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight, landscapeRotation)
      const bottomFinal = resizeWithPadding(bottomCanvas)
      applyDithering(bottomFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      })
    }
  } else {
    const rotatedCanvas = rotateCanvas(canvas, landscapeRotation)
    const finalCanvas = resizeWithPadding(rotatedCanvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_spread.png`,
      canvas: finalCanvas
    })
  }

  return results
}
