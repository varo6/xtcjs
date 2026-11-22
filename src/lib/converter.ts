// Browser conversion logic for CBZ/CBR/PDF/Image/Video to XTC

import JSZip from 'jszip'
import { createExtractorFromData } from 'node-unrar-js'
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url'
import { buildXtcFromXtgPages } from './xtc-format'
import { extractPdfMetadata } from './metadata/pdf-outline'
import { parseComicInfo } from './metadata/comicinfo'
import { PageMappingContext, adjustTocForMapping } from './page-mapping'
import { ConvertWorkerPool, isWorkerPipelineSupported } from './conversion/worker-pool'
import { schedulePages } from './conversion/schedule-pages'
import { convertPage, type ConvertedPage } from './conversion/render-page'
import { loadPdfDocument } from './pdfjs'
import type { BookMetadata } from './metadata'
import type { ConversionOptions, ConversionResult } from './conversion/types'

export type { ConversionOptions, ConversionResult } from './conversion/types'

const PERF_PIPELINE_V2 = true
const PREVIEW_EVERY_N_PAGES = 5
const MAX_STORED_PREVIEWS = 12
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

interface EncodedPage {
  name: string
  xtg: ArrayBuffer
}

interface LoadedVideoMetadata {
  width: number
  height: number
  duration: number
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
  if (!isCoverPage || baseOptions.firstPageIsCover === false) {
    return baseOptions
  }

  let coverOptions = baseOptions

  // Crosspoint uses XTC page 0 as the home preview, so keep cover full-size.
  if (coverOptions.splitMode !== 'nosplit') {
    coverOptions = { ...coverOptions, splitMode: 'nosplit' }
  }

  if (coverOptions.coverPortrait && coverOptions.orientation === 'landscape') {
    coverOptions = { ...coverOptions, orientation: 'portrait' }
  }

  return coverOptions
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'))
    reader.readAsDataURL(blob)
  })
}

async function finalizeConversionResult(
  outputName: string,
  encodedPages: EncodedPage[],
  mappingCtx: PageMappingContext,
  metadata: BookMetadata,
  sampledPreviews: string[],
  is2bit = false
): Promise<ConversionResult> {
  encodedPages.sort((a, b) => a.name.localeCompare(b.name))

  if (metadata.toc.length > 0) {
    metadata.toc = adjustTocForMapping(metadata.toc, mappingCtx)
  }

  const xtcData = await buildXtcFromXtgPages(encodedPages.map((page) => page.xtg), { metadata, is2bit })

  return {
    name: is2bit ? outputName.replace(/\.xtc$/i, '.xtch') : outputName,
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: encodedPages.length,
    pageImages: sampledPreviews,
    previewMode: 'sparse'
  }
}

interface LoadedArchivePage {
  pageNum: number
  pageOptions: ConversionOptions
  includePreview: boolean
  imgBlob: Blob
}

interface ConvertedArchivePage {
  pages: EncodedPage[]
  previewForProgress: string | null
  previewForStorage: string | null
}

async function processArchiveSourcePages(
  totalPages: number,
  getBlob: (index: number) => Promise<Blob>,
  getPageOptions: (index: number) => ConversionOptions,
  getOriginalPage: (index: number) => number,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<{ encodedPages: EncodedPage[]; mappingCtx: PageMappingContext; sampledPreviews: string[] }> {
  const sampledPreviews: string[] = []
  let completed = 0

  const workerPoolSize = calculateWorkerPoolSize()
  const pool = PERF_PIPELINE_V2 && isWorkerPipelineSupported() ? new ConvertWorkerPool(workerPoolSize) : null

  const withPreviews = async (pages: ConvertedPage[], pageOptions: ConversionOptions): Promise<ConvertedArchivePage> => {
    const preview = pages[0]?.preview
    return {
      pages,
      previewForProgress: preview && pageOptions.showProgressPreview ? URL.createObjectURL(preview) : null,
      previewForStorage: preview && sampledPreviews.length < MAX_STORED_PREVIEWS ? await blobToDataUrl(preview) : null
    }
  }

  const results = await schedulePages<LoadedArchivePage, ConvertedArchivePage>({
    totalPages,
    workers: pool && {
      slotCount: workerPoolSize,
      convert: async ({ pageNum, pageOptions, includePreview, imgBlob }) =>
        withPreviews(await pool.processPage(pageNum, imgBlob, pageOptions, includePreview), pageOptions),
      destroy: () => pool.destroy()
    },
    load: async (index) => {
      const pageOptions = getPageOptions(index)
      const pageNum = index + 1
      const includePreview = sampledPreviews.length < MAX_STORED_PREVIEWS &&
        shouldGenerateSampledPreview(pageNum, totalPages)
      return { pageNum, pageOptions, includePreview, imgBlob: await getBlob(index) }
    },
    convertOnMainThread: async ({ pageNum, pageOptions, includePreview, imgBlob }) => {
      const image = await decodeImage(imgBlob)
      return withPreviews(image ? await convertPage(image, pageNum, pageOptions, includePreview) : [], pageOptions)
    },
    onPageDone: ({ previewForProgress, previewForStorage }) => {
      if (previewForStorage && sampledPreviews.length < MAX_STORED_PREVIEWS) {
        sampledPreviews.push(previewForStorage)
      }
      completed++
      onProgress(completed / totalPages, previewForProgress)
    }
  })

  const mappingCtx = new PageMappingContext()
  const encodedPages: EncodedPage[] = []
  for (let i = 0; i < totalPages; i++) {
    const pages = results[i]?.pages || []
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
async function convertCbzToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const zip = await JSZip.loadAsync(file)

  const imageFiles: Array<{ path: string; entry: any; originalPage: number }> = []
  let comicInfoEntry: any = null

  zip.forEach((relativePath: string, zipEntry: any) => {
    if (zipEntry.dir) return
    if (relativePath.toLowerCase().startsWith('__macos')) return

    const ext = relativePath.toLowerCase().substring(relativePath.lastIndexOf('.'))
    if (IMAGE_EXTENSIONS.has(ext)) {
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
  if (options.firstPageIsCover !== false) moveCoverToFront(imageFiles, metadata)

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
    sampledPreviews,
    options.is2bit
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
async function convertCbrToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const [wasmBinary, arrayBuffer] = await Promise.all([
    loadUnrarWasm(),
    file.arrayBuffer(),
  ])
  const extractor = await createExtractorFromData({ data: arrayBuffer, wasmBinary })

  const imageFiles: Array<{ path: string; data: Uint8Array; originalPage: number }> = []
  let comicInfoContent: string | null = null

  const { files } = extractor.extract()
  for (const extractedFile of files) {
    if (extractedFile.fileHeader.flags.directory) continue

    const path = extractedFile.fileHeader.name
    if (path.toLowerCase().startsWith('__macos')) continue

    const ext = path.toLowerCase().substring(path.lastIndexOf('.'))
    if (IMAGE_EXTENSIONS.has(ext) && extractedFile.extraction) {
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
  if (options.firstPageIsCover !== false) moveCoverToFront(imageFiles, metadata)

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
    sampledPreviews,
    options.is2bit
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
async function convertImageToXtc(
  file: File,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const image = await decodeImage(file)
  if (!image) {
    throw new Error('Failed to decode image')
  }

  const encodedPages = await convertPage(image, 1, { ...options, splitMode: 'nosplit' }, true)
  const previewDataUrl = await blobToDataUrl(encodedPages[0].preview!)
  const sampledPreviews = [previewDataUrl]
  onProgress(1, options.showProgressPreview ? previewDataUrl : null)

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

function readLoadedVideoMetadata(video: HTMLVideoElement): LoadedVideoMetadata {
  if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) ||
      video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('Invalid video dimensions')
  }

  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
  }
}

function loadVideoMetadata(video: HTMLVideoElement): Promise<LoadedVideoMetadata> {
  return waitForVideoMetadata(video).then(() => readLoadedVideoMetadata(video))
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
async function convertVideoToXtc(
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
    const videoMetadata = await loadVideoMetadata(video)

    const fps = Math.max(0.1, Math.min(10, Number.isFinite(options.videoFps) ? options.videoFps : 1))
    const duration = videoMetadata.duration
    const frameCount = duration > 0 ? Math.max(1, Math.floor(duration * fps)) : 1

    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = videoMetadata.width
    captureCanvas.height = videoMetadata.height
    const captureCtx = captureCanvas.getContext('2d')!

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

      const includePreview = sampledPreviews.length < MAX_STORED_PREVIEWS &&
        shouldGenerateSampledPreview(i + 1, frameCount)
      const pages = await convertPage(captureCanvas, i + 1, frameOptions, includePreview)
      encodedPages.push(...pages)
      mappingCtx.addOriginalPage(i + 1, pages.length)

      if (pages[0].preview) {
        const previewDataUrl = await blobToDataUrl(pages[0].preview)
        sampledPreviews.push(previewDataUrl)
        onProgress((i + 1) / frameCount, options.showProgressPreview ? previewDataUrl : null)
      } else {
        onProgress((i + 1) / frameCount, null)
      }
    }

    return finalizeConversionResult(
      getOutputName(file.name),
      encodedPages,
      mappingCtx,
      { toc: [] },
      sampledPreviews,
      options.is2bit
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
    const pageOptions = getPageProcessingOptions(options, i === 1)
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

    const includePreview = sampledPreviews.length < MAX_STORED_PREVIEWS &&
      shouldGenerateSampledPreview(i, numPages)
    const pages = await convertPage(canvas, i, pageOptions, includePreview)
    encodedPages.push(...pages)
    mappingCtx.addOriginalPage(i, pages.length)

    if (pages[0].preview) {
      const previewDataUrl = await blobToDataUrl(pages[0].preview)
      onProgress(i / numPages, options.showProgressPreview ? previewDataUrl : null)

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
    sampledPreviews,
    options.is2bit
  )
}

function decodeImage(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(null)
    }
    img.src = objectUrl
  })
}
