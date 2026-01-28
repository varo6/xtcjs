// CBZ/CBR/PDF to XTC conversion logic

import JSZip from 'jszip'
import { createExtractorFromData } from 'node-unrar-js'
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { applyDithering } from './processing/dithering'
import { toGrayscale, applyContrast, calculateOverlapSegments } from './processing/image'
import { rotateCanvas, extractAndRotate, extractRegion, resizeWithPadding, TARGET_WIDTH, TARGET_HEIGHT } from './processing/canvas'
import { buildXtc } from './xtc-format'
import { extractPdfMetadata } from './metadata/pdf-outline'
import { parseComicInfo } from './metadata/comicinfo'
import { PageMappingContext, adjustTocForMapping } from './page-mapping'
import type { BookMetadata } from './metadata/types'

// Set up PDF.js worker from bundled asset
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export interface ConversionOptions {
  splitMode: string
  dithering: string
  contrast: number
  margin: number
  orientation: 'landscape' | 'portrait'
}

export interface ConversionResult {
  name: string
  data?: ArrayBuffer
  size?: number
  pageCount?: number
  pageImages?: string[]
  error?: string
}

interface ProcessedPage {
  name: string
  canvas: HTMLCanvasElement
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

    // Look for ComicInfo.xml
    if (relativePath.toLowerCase() === 'comicinfo.xml' ||
        relativePath.toLowerCase().endsWith('/comicinfo.xml')) {
      comicInfoEntry = zipEntry
    }
  })

  imageFiles.sort((a, b) => a.path.localeCompare(b.path))

  if (imageFiles.length === 0) {
    throw new Error('No images found in CBZ')
  }

  // Extract metadata from ComicInfo.xml if present
  let metadata: BookMetadata = { toc: [] }
  if (comicInfoEntry) {
    try {
      const xmlContent = await comicInfoEntry.async('string')
      metadata = parseComicInfo(xmlContent)
    } catch {
      // ComicInfo parsing failed, continue without metadata
    }
  }

  const processedPages: ProcessedPage[] = []
  const mappingCtx = new PageMappingContext()

  for (let i = 0; i < imageFiles.length; i++) {
    const imgFile = imageFiles[i]
    const imgBlob = await imgFile.entry.async('blob')

    const pages = await processImage(imgBlob, i + 1, options)
    processedPages.push(...pages)

    // Track page mapping for TOC adjustment
    mappingCtx.addOriginalPage(i + 1, pages.length)

    if (pages.length > 0 && pages[0].canvas) {
      const previewUrl = pages[0].canvas.toDataURL('image/png')
      onProgress((i + 1) / imageFiles.length, previewUrl)
    } else {
      onProgress((i + 1) / imageFiles.length, null)
    }
  }

  processedPages.sort((a, b) => a.name.localeCompare(b.name))

  // Adjust TOC page numbers based on mapping
  if (metadata.toc.length > 0) {
    metadata.toc = adjustTocForMapping(metadata.toc, mappingCtx)
  }

  const pageImages = processedPages.map(page => page.canvas.toDataURL('image/png'))
  const xtcData = await buildXtc(processedPages, { metadata })

  return {
    name: file.name.replace(/\.cbz$/i, '.xtc'),
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: processedPages.length,
    pageImages
  }
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

  // Extract all files from the RAR archive
  const { files } = extractor.extract()
  for (const extractedFile of files) {
    if (extractedFile.fileHeader.flags.directory) continue

    const path = extractedFile.fileHeader.name
    if (path.toLowerCase().startsWith('__macos')) continue

    const ext = path.toLowerCase().substring(path.lastIndexOf('.'))
    if (imageExtensions.includes(ext) && extractedFile.extraction) {
      imageFiles.push({ path, data: extractedFile.extraction })
    }

    // Look for ComicInfo.xml
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

  // Extract metadata from ComicInfo.xml if present
  let metadata: BookMetadata = { toc: [] }
  if (comicInfoContent) {
    try {
      metadata = parseComicInfo(comicInfoContent)
    } catch {
      // ComicInfo parsing failed, continue without metadata
    }
  }

  const processedPages: ProcessedPage[] = []
  const mappingCtx = new PageMappingContext()

  for (let i = 0; i < imageFiles.length; i++) {
    const imgFile = imageFiles[i]
    // Create a copy of the data with a regular ArrayBuffer for Blob compatibility
    const imgBlob = new Blob([new Uint8Array(imgFile.data)])

    const pages = await processImage(imgBlob, i + 1, options)
    processedPages.push(...pages)

    // Track page mapping for TOC adjustment
    mappingCtx.addOriginalPage(i + 1, pages.length)

    if (pages.length > 0 && pages[0].canvas) {
      const previewUrl = pages[0].canvas.toDataURL('image/png')
      onProgress((i + 1) / imageFiles.length, previewUrl)
    } else {
      onProgress((i + 1) / imageFiles.length, null)
    }
  }

  processedPages.sort((a, b) => a.name.localeCompare(b.name))

  // Adjust TOC page numbers based on mapping
  if (metadata.toc.length > 0) {
    metadata.toc = adjustTocForMapping(metadata.toc, mappingCtx)
  }

  const pageImages = processedPages.map(page => page.canvas.toDataURL('image/png'))
  const xtcData = await buildXtc(processedPages, { metadata })

  return {
    name: file.name.replace(/\.cbr$/i, '.xtc'),
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: processedPages.length,
    pageImages
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
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  // Extract metadata (title, author, TOC) from PDF
  let metadata: BookMetadata = { toc: [] }
  try {
    metadata = await extractPdfMetadata(pdf)
  } catch {
    // Metadata extraction failed, continue without it
  }

  const processedPages: ProcessedPage[] = []
  const mappingCtx = new PageMappingContext()
  const numPages = pdf.numPages

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const scale = 2.0 // Render at 2x for better quality
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
    processedPages.push(...pages)

    // Track page mapping for TOC adjustment
    mappingCtx.addOriginalPage(i, pages.length)

    if (pages.length > 0 && pages[0].canvas) {
      const previewUrl = pages[0].canvas.toDataURL('image/png')
      onProgress(i / numPages, previewUrl)
    } else {
      onProgress(i / numPages, null)
    }
  }

  processedPages.sort((a, b) => a.name.localeCompare(b.name))

  // Adjust TOC page numbers based on mapping
  if (metadata.toc.length > 0) {
    metadata.toc = adjustTocForMapping(metadata.toc, mappingCtx)
  }

  const pageImages = processedPages.map(page => page.canvas.toDataURL('image/png'))
  const xtcData = await buildXtc(processedPages, { metadata })

  return {
    name: file.name.replace(/\.pdf$/i, '.xtc'),
    data: xtcData,
    size: xtcData.byteLength,
    pageCount: processedPages.length,
    pageImages
  }
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

  let width = sourceCanvas.width
  let height = sourceCanvas.height

  if (options.margin > 0) {
    const marginPx = {
      left: Math.floor(width * options.margin / 100),
      top: Math.floor(height * options.margin / 100),
      right: Math.floor(width * options.margin / 100),
      bottom: Math.floor(height * options.margin / 100)
    }

    const croppedWidth = width - marginPx.left - marginPx.right
    const croppedHeight = height - marginPx.top - marginPx.bottom

    canvas.width = croppedWidth
    canvas.height = croppedHeight
    ctx.drawImage(
      sourceCanvas,
      marginPx.left, marginPx.top,
      croppedWidth, croppedHeight,
      0, 0,
      croppedWidth, croppedHeight
    )

    width = croppedWidth
    height = croppedHeight
  } else {
    canvas.width = width
    canvas.height = height
    ctx.drawImage(sourceCanvas, 0, 0)
  }

  if (options.contrast > 0) {
    applyContrast(ctx, width, height, options.contrast)
  }

  toGrayscale(ctx, width, height)

  // Portrait mode: no rotation, 1 page = 1 page on e-reader
  if (options.orientation === 'portrait') {
    const finalCanvas = resizeWithPadding(canvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_page.png`,
      canvas: finalCanvas
    })
    return results
  }

  // Landscape mode: rotate and optionally split
  const shouldSplit = width < height && options.splitMode !== 'nosplit'

  if (shouldSplit) {
    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h)
        const finalCanvas = resizeWithPadding(pageCanvas)
        applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        })
      })
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight)
      const topFinal = resizeWithPadding(topCanvas)
      applyDithering(topFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      })

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight)
      const bottomFinal = resizeWithPadding(bottomCanvas)
      applyDithering(bottomFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      })
    }
  } else {
    const rotatedCanvas = rotateCanvas(canvas, 90)
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

  let width = img.width
  let height = img.height

  // Apply margin crop if configured
  if (options.margin > 0) {
    const marginPx = {
      left: Math.floor(width * options.margin / 100),
      top: Math.floor(height * options.margin / 100),
      right: Math.floor(width * options.margin / 100),
      bottom: Math.floor(height * options.margin / 100)
    }

    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = width - marginPx.left - marginPx.right
    croppedCanvas.height = height - marginPx.top - marginPx.bottom
    const croppedCtx = croppedCanvas.getContext('2d')!

    croppedCtx.drawImage(
      img,
      marginPx.left, marginPx.top,
      croppedCanvas.width, croppedCanvas.height,
      0, 0,
      croppedCanvas.width, croppedCanvas.height
    )

    width = croppedCanvas.width
    height = croppedCanvas.height

    canvas.width = width
    canvas.height = height
    ctx.drawImage(croppedCanvas, 0, 0)
  } else {
    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0)
  }

  // Apply contrast enhancement
  if (options.contrast > 0) {
    applyContrast(ctx, width, height, options.contrast)
  }

  // Convert to grayscale
  toGrayscale(ctx, width, height)

  // Portrait mode: no rotation, 1 page = 1 page on e-reader
  if (options.orientation === 'portrait') {
    const finalCanvas = resizeWithPadding(canvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_page.png`,
      canvas: finalCanvas
    })
    return results
  }

  // Landscape mode: rotate and optionally split
  const shouldSplit = width < height && options.splitMode !== 'nosplit'

  if (shouldSplit) {
    if (options.splitMode === 'overlap') {
      const segments = calculateOverlapSegments(width, height)
      segments.forEach((seg, idx) => {
        const letter = String.fromCharCode(97 + idx)
        const pageCanvas = extractAndRotate(canvas, seg.x, seg.y, seg.w, seg.h)
        const finalCanvas = resizeWithPadding(pageCanvas)
        applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

        results.push({
          name: `${String(pageNum).padStart(4, '0')}_3_${letter}.png`,
          canvas: finalCanvas
        })
      })
    } else {
      const halfHeight = Math.floor(height / 2)

      const topCanvas = extractAndRotate(canvas, 0, 0, width, halfHeight)
      const topFinal = resizeWithPadding(topCanvas)
      applyDithering(topFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_a.png`,
        canvas: topFinal
      })

      const bottomCanvas = extractAndRotate(canvas, 0, halfHeight, width, halfHeight)
      const bottomFinal = resizeWithPadding(bottomCanvas)
      applyDithering(bottomFinal.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)
      results.push({
        name: `${String(pageNum).padStart(4, '0')}_2_b.png`,
        canvas: bottomFinal
      })
    }
  } else {
    const rotatedCanvas = rotateCanvas(canvas, 90)
    const finalCanvas = resizeWithPadding(rotatedCanvas)
    applyDithering(finalCanvas.getContext('2d')!, TARGET_WIDTH, TARGET_HEIGHT, options.dithering)

    results.push({
      name: `${String(pageNum).padStart(4, '0')}_0_spread.png`,
      canvas: finalCanvas
    })
  }

  return results
}
