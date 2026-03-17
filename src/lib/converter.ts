// Browser conversion logic for CBZ/CBR/PDF/Image/Video to XTC

import JSZip from 'jszip'
import { createExtractorFromData } from 'node-unrar-js'
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url'
import { applyDithering } from './processing/dithering'
import { toGrayscale, applyContrast, calculateOverlapSegments } from './processing/image'
import { rotateCanvas, extractAndRotate, resizeWithPadding, getTargetDimensions } from './processing/canvas'
import { imageDataToXtg, imageDataToXth } from './processing/xtg'
import { buildXtcFromXtgPages } from './xtc-format'
import { extractPdfMetadata } from './metadata/pdf-outline'
import { parseComicInfo } from './metadata/comicinfo'
import { PageMappingContext, adjustTocForMapping } from './page-mapping'
import { ConvertWorkerPool, isWorkerPipelineSupported } from './conversion/worker-pool'
import { loadPdfDocument } from './pdfjs'
import type { BookMetadata } from './metadata/types'
import type { ConversionOptions, ConversionResult } from './conversion/types'

export type { ConversionOptions, ConversionResult } from './conversion/types'

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

function buildOverviewPage(
  canvas: HTMLCanvasElement,
  pageNum: number,
  targetWidth: number,
  targetHeight: number,
  options: ConversionOptions,
  landscapeRotation: number
): ProcessedPage {
  const overviewCanvas = options.pageOverview === 'portrait'
    ? resizeWithPadding(canvas, 255, targetWidth, targetHeight)
    : resizeWithPadding(rotateCanvas(canvas, landscapeRotation), 255, targetWidth, targetHeight)

  applyDithering(overviewCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering)

  return {
    name: `${String(pageNum).padStart(4, '0')}_1_overview_${options.pageOverview}.png`,
    canvas: overviewCanvas
  }
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

function normalizeArchivePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase()
}

function getBaseName(path: string): string {
  const slashIndex = path.lastIndexOf('/')
  if (slashIndex < 0) return path
  return path.slice(slashIndex + 1)
}

function moveCoverToFront<T extends { path: string; originalPage: number }>(
  imageFiles: T[],
  metadata: BookMetadata
): void {
  if (imageFiles.length < 2) return

  let coverIndex = -1

  if (Number.isInteger(metadata.coverPage) && (metadata.coverPage ?? 0) > 0) {
    coverIndex = imageFiles.findIndex(file => file.originalPage === metadata.coverPage)
  }

  if (coverIndex === -1 && metadata.coverImagePath) {
    const normalizedCoverPath = normalizeArchivePath(metadata.coverImagePath)
    coverIndex = imageFiles.findIndex(file =>
      normalizeArchivePath(file.path) === normalizedCoverPath
    )

    if (coverIndex === -1) {
      const coverBaseName = getBaseName(normalizedCoverPath)
      coverIndex = imageFiles.findIndex(file =>
        getBaseName(normalizeArchivePath(file.path)) === coverBaseName
      )
    }
  }

  if (coverIndex > 0) {
    const [coverImage] = imageFiles.splice(coverIndex, 1)
    imageFiles.unshift(coverImage)
  }
}

function getPageProcessingOptions(
  baseOptions: ConversionOptions,
  isCoverPage: boolean
): ConversionOptions {
  // Crosspoint uses XTC page 0 as the home preview, so keep cover full-size.
  if (!isCoverPage || baseOptions.splitMode === 'nosplit') {
    return baseOptions
  }
  return { ...baseOptions, splitMode: 'nosplit' }
}

function getOutputDimensions(options: ConversionOptions): { width: number; height: number } {
  return getTargetDimensions(options.device)
}

function applyImageMode(
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  imageMode: ConversionOptions['imageMode'],
  padColor = 255
): HTMLCanvasElement {
  if (imageMode === 'letterbox') {
    return resizeWithPadding(sourceCanvas, padColor, targetWidth, targetHeight)
  }

  const result = document.createElement('canvas')
  result.width = targetWidth
  result.height = targetHeight
  const ctx = result.getContext('2d')!

  if (imageMode === 'fill') {
    ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight)
    return result
  }

  if (imageMode === 'crop') {
    const sourceAspect = sourceCanvas.width / sourceCanvas.height
    const targetAspect = targetWidth / targetHeight
    let sx = 0
    let sy = 0
    let sw = sourceCanvas.width
    let sh = sourceCanvas.height

    if (sourceAspect > targetAspect) {
      sw = Math.round(sourceCanvas.height * targetAspect)
      sx = Math.floor((sourceCanvas.width - sw) / 2)
    } else if (sourceAspect < targetAspect) {
      sh = Math.round(sourceCanvas.width / targetAspect)
      sy = Math.floor((sourceCanvas.height - sh) / 2)
    }

    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
    return result
  }

  // cover: fill frame and crop overflow
  const scale = Math.max(targetWidth / sourceCanvas.width, targetHeight / sourceCanvas.height)
  const drawWidth = Math.round(sourceCanvas.width * scale)
  const drawHeight = Math.round(sourceCanvas.height * scale)
  const dx = Math.floor((targetWidth - drawWidth) / 2)
  const dy = Math.floor((targetHeight - drawHeight) / 2)
  ctx.drawImage(sourceCanvas, dx, dy, drawWidth, drawHeight)
  return result
}

function shouldGenerateSampledPreview(pageNum: number, totalPages: number): boolean {
  let interval = PREVIEW_EVERY_N_PAGES
  if (totalPages > 150) interval = 8
  if (totalPages > 350) interval = 12
  if (totalPages > 700) interval = 20
  return pageNum === 1 || pageNum === totalPages || pageNum % interval === 0
}

function calculateWorkerPoolSize(): number {
  const cores = Math.max(1, navigator.hardwareConcurrency || 4)
  let poolSize = Math.max(1, Math.min(6, Math.floor(cores * 0.6)))

  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number') {
    if (nav.deviceMemory <= 1) poolSize = 1
    else if (nav.deviceMemory <= 2) poolSize = Math.min(poolSize, 2)
    else if (nav.deviceMemory <= 4) poolSize = Math.min(poolSize, 3)
  }

  return poolSize
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
  const imageData = ctx.getImageData(0, 0, page.canvas.width, page.canvas.height)
  return {
    name: page.name,
    xtg: imageDataToXtg(imageData)
  }
}

function encodeImageCanvasPage(page: ProcessedPage, is2bit: boolean): EncodedPage {
  const ctx = page.canvas.getContext('2d')!
  const imageData = ctx.getImageData(0, 0, page.canvas.width, page.canvas.height)
  return {
    name: page.name,
    xtg: is2bit ? imageDataToXth(imageData) : imageDataToXtg(imageData)
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
  getPageOptions: (index: number) => ConversionOptions,
  getOriginalPage: (index: number) => number,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<{ encodedPages: EncodedPage[]; mappingCtx: PageMappingContext; sampledPreviews: string[] }> {
  const sampledPreviews: string[] = []
  const pageResultsByIndex: EncodedPage[][] = new Array(totalPages)

  let pool: ConvertWorkerPool | null = null
  let workerDisabled = false
  let completed = 0
  let nextIndex = 0

  const workerPoolSize = calculateWorkerPoolSize()
  if (PERF_PIPELINE_V2 && isWorkerPipelineSupported()) {
    pool = new ConvertWorkerPool(workerPoolSize)
  }

  const concurrency = pool ? workerPoolSize : 1

  const runSlot = async (slotIndex: number) => {
    while (true) {
      // If workers are disabled at runtime, continue on one main-thread lane only.
      if (workerDisabled && slotIndex > 0) {
        return
      }

      const index = nextIndex++
      if (index >= totalPages) {
        return
      }

      const pageOptions = getPageOptions(index)
      const pageNum = index + 1
      const includePreview = pageOptions.showProgressPreview &&
        sampledPreviews.length < MAX_STORED_PREVIEWS &&
        shouldGenerateSampledPreview(pageNum, totalPages)
      const imgBlob = await getBlob(index)

      let previewForProgress: string | null = null
      let previewForStorage: string | null = null
      let pageResults: EncodedPage[] = []

      if (pool && !workerDisabled) {
        try {
          const workerPages = await pool.processPage(pageNum, imgBlob, pageOptions, includePreview)
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
        const pages = await processImage(imgBlob, pageNum, pageOptions)
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
    await Promise.all(Array.from({ length: concurrency }, (_, slotIndex) => runSlot(slotIndex)))
  } finally {
    pool?.destroy()
  }

  const mappingCtx = new PageMappingContext()
  const encodedPages: EncodedPage[] = []
  for (let i = 0; i < totalPages; i++) {
    const pages = pageResultsByIndex[i] || []
    mappingCtx.addOriginalPage(getOriginalPage(i), pages.length)
    encodedPages.push(...pages)
  }

  return { encodedPages, mappingCtx, sampledPreviews }
}

/**
 * Convert a file to XTC format (supports CBZ, CBR, PDF, image, and video)
 */
export async function convertToXtc(
  file: File,
  fileType: 'cbz' | 'cbr' | 'pdf' | 'image' | 'video',
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  if (fileType === 'image') {
    return convertImageToXtc(file, options, onProgress)
  }
  if (fileType === 'video') {
    return convertVideoToXtc(file, options, onProgress)
  }
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

  const imageFiles: Array<{ path: string; entry: any; originalPage: number }> = []
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
  let comicInfoEntry: any = null

  zip.forEach((relativePath: string, zipEntry: any) => {
    if (zipEntry.dir) return
    if (relativePath.toLowerCase().startsWith('__macos')) return

    const ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'))
    if (imageExtensions.includes(ext)) {
      imageFiles.push({ path: relativePath, entry: zipEntry, originalPage: 0 })
    }

    if (relativePath.toLowerCase() === 'comicinfo.xml' ||
        relativePath.toLowerCase().endsWith('/comicinfo.xml')) {
      comicInfoEntry = zipEntry
    }
  })

  imageFiles.sort((a, b) => a.path.localeCompare(b.path))
  imageFiles.forEach((imageFile, index) => {
    imageFile.originalPage = index + 1
  })

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
  moveCoverToFront(imageFiles, metadata)

  const { encodedPages, mappingCtx, sampledPreviews } = await processArchiveSourcePages(
    imageFiles.length,
    (index) => imageFiles[index].entry.async('blob'),
    (index) => getPageProcessingOptions(options, index === 0),
    (index) => imageFiles[index].originalPage,
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
  const imageFiles: Array<{ path: string; data: Uint8Array; originalPage: number }> = []
  let comicInfoContent: string | null = null

  const { files } = extractor.extract()
  for (const extractedFile of files) {
    if (extractedFile.fileHeader.flags.directory) continue

    const path = extractedFile.fileHeader.name
    if (path.toLowerCase().startsWith('__macos')) continue

    const ext = path.toLowerCase().substring(path.lastIndexOf('.'))
    if (imageExtensions.includes(ext) && extractedFile.extraction) {
      imageFiles.push({ path, data: extractedFile.extraction, originalPage: 0 })
    }

    if ((path.toLowerCase() === 'comicinfo.xml' ||
         path.toLowerCase().endsWith('/comicinfo.xml')) &&
        extractedFile.extraction) {
      const decoder = new TextDecoder('utf-8')
      comicInfoContent = decoder.decode(extractedFile.extraction)
    }
  }

  imageFiles.sort((a, b) => a.path.localeCompare(b.path))
  imageFiles.forEach((imageFile, index) => {
    imageFile.originalPage = index + 1
  })

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
  moveCoverToFront(imageFiles, metadata)

  const { encodedPages, mappingCtx, sampledPreviews } = await processArchiveSourcePages(
    imageFiles.length,
    async (index) => new Blob([new Uint8Array(imageFiles[index].data)]),
    (index) => getPageProcessingOptions(options, index === 0),
    (index) => imageFiles[index].originalPage,
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

function getOutputName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return `${fileName}.xtc`
  return `${fileName.slice(0, dot)}.xtc`
}

function getImageOutputName(fileName: string, is2bit: boolean): string {
  const dot = fileName.lastIndexOf('.')
  const extension = is2bit ? '.xtch' : '.xtc'
  if (dot <= 0) return `${fileName}${extension}`
  return `${fileName.slice(0, dot)}${extension}`
}

/**
 * Convert a single image file to XTC.
 */
export async function convertImageToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const imagePages = await processImage(file, 1, {
    ...options,
    splitMode: 'nosplit'
  }, options.is2bit)

  if (imagePages.length === 0) {
    throw new Error('Failed to decode image')
  }

  const encodedPages = imagePages.map((page) => encodeImageCanvasPage(page, options.is2bit))

  let previewUrl: string | null = null
  const sampledPreviews: string[] = []
  if (options.showProgressPreview && imagePages[0]?.canvas) {
    previewUrl = imagePages[0].canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY)
    sampledPreviews.push(previewUrl)
  }
  onProgress(1, previewUrl)

  encodedPages.sort((a, b) => a.name.localeCompare(b.name))

  const xtcData = await buildXtcFromXtgPages(
    encodedPages.map((page) => page.xtg),
    { metadata: { toc: [] }, is2bit: options.is2bit }
  )

  return {
    name: getImageOutputName(file.name, options.is2bit),
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: encodedPages.length,
    pageImages: sampledPreviews,
    previewMode: 'sparse'
  }
}

async function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Failed to load video metadata'))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }

    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
  })
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Failed to seek video'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = Math.max(0, time)
  })
}

/**
 * Convert video frames to XTC.
 */
export async function convertVideoToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    await waitForVideoMetadata(video)

    if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) ||
        video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('Invalid video dimensions')
    }

    const fps = Math.max(0.1, Math.min(10, Number.isFinite(options.videoFps) ? options.videoFps : 1))
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    const frameCount = duration > 0 ? Math.max(1, Math.floor(duration * fps)) : 1

    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = video.videoWidth
    captureCanvas.height = video.videoHeight
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true })!

    const encodedPages: EncodedPage[] = []
    const sampledPreviews: string[] = []
    const mappingCtx = new PageMappingContext()
    const frameOptions = { ...options, splitMode: 'nosplit' as const }

    for (let i = 0; i < frameCount; i++) {
      const frameTime = duration > 0
        ? Math.min(Math.max(0, duration - 0.001), i / fps)
        : 0

      await seekVideo(video, frameTime)
      captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)

      const pages = processCanvasAsImage(captureCanvas, i + 1, frameOptions)
      encodedPages.push(...pages.map(encodeCanvasPage))
      mappingCtx.addOriginalPage(i + 1, pages.length)

      const includePreview = options.showProgressPreview &&
        sampledPreviews.length < MAX_STORED_PREVIEWS &&
        shouldGenerateSampledPreview(i + 1, frameCount)
      if (includePreview && pages.length > 0 && pages[0].canvas) {
        const previewDataUrl = pages[0].canvas.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY)
        sampledPreviews.push(previewDataUrl)
        onProgress((i + 1) / frameCount, previewDataUrl)
      } else {
        onProgress((i + 1) / frameCount, null)
      }
    }

    return finalizeConversionResult(
      getOutputName(file.name),
      encodedPages,
      mappingCtx,
      { toc: [] },
      sampledPreviews
    )
  } finally {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
  }
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
  const pdf = await loadPdfDocument(arrayBuffer)

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

    const includePreview = options.showProgressPreview &&
      sampledPreviews.length < MAX_STORED_PREVIEWS &&
      shouldGenerateSampledPreview(i, numPages)
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
  const { width: targetWidth, height: targetHeight } = getOutputDimensions(options)
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
    const finalCanvas = applyImageMode(
      canvas,
      targetWidth,
      targetHeight,
      options.imageMode,
      255
    )
    applyDithering(finalCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_page.png`,
      canvas: finalCanvas
    })
    return results
  }

  const landscapeRotation = options.landscapeFlipClockwise ? -90 : 90
  const shouldSplit = width < height && options.splitMode !== 'nosplit'

  if (shouldSplit) {
    if (options.pageOverview !== 'none') {
      results.push(buildOverviewPage(canvas, pageNum, targetWidth, targetHeight, options, landscapeRotation))
    }

    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h, landscapeRotation)
        const finalCanvas = resizeWithPadding(pageCanvas, 255, targetWidth, targetHeight)
        applyDithering(finalCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering)

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        })
      })
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight, landscapeRotation)
      const topFinal = resizeWithPadding(topCanvas, 255, targetWidth, targetHeight)
      applyDithering(topFinal.getContext('2d')!, targetWidth, targetHeight, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      })

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight, landscapeRotation)
      const bottomFinal = resizeWithPadding(bottomCanvas, 255, targetWidth, targetHeight)
      applyDithering(bottomFinal.getContext('2d')!, targetWidth, targetHeight, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      })
    }
  } else {
    const rotatedCanvas = rotateCanvas(canvas, landscapeRotation)
    const finalCanvas = resizeWithPadding(rotatedCanvas, 255, targetWidth, targetHeight)
    applyDithering(finalCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering)

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
  options: ConversionOptions,
  is2bit = false
): Promise<ProcessedPage[]> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(imgBlob)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const pages = processLoadedImage(img, pageNum, options, is2bit)
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
  options: ConversionOptions,
  is2bit = false
): ProcessedPage[] {
  const { width: targetWidth, height: targetHeight } = getOutputDimensions(options)
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
    const finalCanvas = applyImageMode(
      canvas,
      targetWidth,
      targetHeight,
      options.imageMode,
      255
    )
    applyDithering(finalCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering, is2bit)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_page.png`,
      canvas: finalCanvas
    })
    return results
  }

  const landscapeRotation = options.landscapeFlipClockwise ? -90 : 90
  const shouldSplit = width < height && options.splitMode !== 'nosplit'

  if (shouldSplit) {
    if (options.pageOverview !== 'none') {
      results.push(buildOverviewPage(canvas, pageNum, targetWidth, targetHeight, options, landscapeRotation))
    }

    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h, landscapeRotation)
        const finalCanvas = resizeWithPadding(pageCanvas, 255, targetWidth, targetHeight)
        applyDithering(finalCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering, is2bit)

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        })
      })
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight, landscapeRotation)
      const topFinal = resizeWithPadding(topCanvas, 255, targetWidth, targetHeight)
      applyDithering(topFinal.getContext('2d')!, targetWidth, targetHeight, options.dithering, is2bit)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      })

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight, landscapeRotation)
      const bottomFinal = resizeWithPadding(bottomCanvas, 255, targetWidth, targetHeight)
      applyDithering(bottomFinal.getContext('2d')!, targetWidth, targetHeight, options.dithering, is2bit)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      })
    }
  } else {
    const rotatedCanvas = rotateCanvas(canvas, landscapeRotation)
    const finalCanvas = resizeWithPadding(rotatedCanvas, 255, targetWidth, targetHeight)
    applyDithering(finalCanvas.getContext('2d')!, targetWidth, targetHeight, options.dithering, is2bit)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_spread.png`,
      canvas: finalCanvas
    })
  }

  return results
}
