// Browser conversion of CBZ/CBR/PDF/image/video files to XTC. Every format
// goes through the same loop; conversion/sources.ts holds what differs.

import { buildXtcFromXtgPages } from './xtc-format'
import { PageMappingContext, adjustTocForMapping } from './page-mapping'
import { ConvertWorkerPool, isWorkerPipelineSupported } from './conversion/worker-pool'
import { schedulePages } from './conversion/schedule-pages'
import { convertPage, type ConvertedPage } from './conversion/render-page'
import { openBook, type FileType, type SourceImage, type SourcePage } from './conversion/sources'
import type { BookMetadata } from './metadata'
import type { ConversionOptions, ConversionResult } from './conversion/types'

export type { ConversionOptions, ConversionResult } from './conversion/types'

const PREVIEW_EVERY_N_PAGES = 5
const MAX_STORED_PREVIEWS = 12

interface LoadedPage {
  pageNum: number
  options: ConversionOptions
  includePreview: boolean
  image: SourceImage
}

interface FinishedPage {
  pages: ConvertedPage[]
  previewForProgress: string | null
  previewForStorage: string | null
}

export async function convertToXtc(
  file: File,
  fileType: FileType,
  options: ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<ConversionResult> {
  const book = await openBook[fileType](file, options)
  try {
    const coverFirst = book.hasCover && options.firstPageIsCover !== false
    const pages = coverFirst ? moveCoverToFront(book.pages, book.metadata) : book.pages
    const finished = await convertPages(
      pages,
      (index) => resolvePageOptions(options, book.forceNoSplit, coverFirst && index === 0),
      onProgress
    )

    const mappingCtx = new PageMappingContext()
    const encodedPages: ConvertedPage[] = []
    finished.forEach(({ pages: converted }, index) => {
      mappingCtx.addOriginalPage(pages[index].originalPage, converted.length)
      encodedPages.push(...converted)
    })
    if (encodedPages.length === 0) {
      throw new Error('Failed to decode any page')
    }
    encodedPages.sort((a, b) => a.name.localeCompare(b.name))

    const metadata = book.metadata
    if (metadata.toc.length > 0) {
      metadata.toc = adjustTocForMapping(metadata.toc, mappingCtx)
    }
    const xtcData = await buildXtcFromXtgPages(encodedPages.map((page) => page.xtg), { metadata, is2bit: options.is2bit })

    return {
      name: getOutputName(file.name, options.is2bit),
      data: xtcData,
      size: xtcData.byteLength,
      pageCount: encodedPages.length,
      pageImages: finished.flatMap((page) => page.previewForStorage ?? []).slice(0, MAX_STORED_PREVIEWS),
      previewMode: 'sparse'
    }
  } finally {
    book.close?.()
  }
}

/** The only place where options differ between the pages of one book. */
function resolvePageOptions(options: ConversionOptions, forceNoSplit: boolean, isCover: boolean): ConversionOptions {
  let resolved = forceNoSplit ? { ...options, splitMode: 'nosplit' as const } : options
  if (isCover) {
    // Crosspoint uses XTC page 0 as the home preview, so keep the cover whole.
    resolved = { ...resolved, splitMode: 'nosplit' }
    if (resolved.coverPortrait && resolved.orientation === 'landscape') {
      resolved = { ...resolved, orientation: 'portrait' }
    }
  }
  return resolved
}

async function convertPages(
  pages: SourcePage[],
  getPageOptions: (index: number) => ConversionOptions,
  onProgress: (progress: number, previewUrl: string | null) => void
): Promise<FinishedPage[]> {
  const totalPages = pages.length
  let storedPreviews = 0
  let completed = 0

  const workerPoolSize = Math.min(calculateWorkerPoolSize(), totalPages)
  const pool = isWorkerPipelineSupported() ? new ConvertWorkerPool(workerPoolSize) : null

  const finish = async (converted: ConvertedPage[], options: ConversionOptions): Promise<FinishedPage> => {
    const preview = converted[0]?.preview
    return {
      pages: converted,
      previewForProgress: preview && options.showProgressPreview ? URL.createObjectURL(preview) : null,
      previewForStorage: preview && storedPreviews < MAX_STORED_PREVIEWS ? await blobToDataUrl(preview) : null
    }
  }

  return schedulePages<LoadedPage, FinishedPage>({
    totalPages,
    workers: pool && {
      slotCount: workerPoolSize,
      convert: async ({ pageNum, options, includePreview, image }) => {
        const workerImage = image instanceof Blob ? image : await createImageBitmap(image)
        return finish(await pool.processPage(pageNum, workerImage, options, includePreview), options)
      },
      destroy: () => pool.destroy()
    },
    load: async (index) => {
      const pageNum = index + 1
      return {
        pageNum,
        options: getPageOptions(index),
        includePreview: storedPreviews < MAX_STORED_PREVIEWS && shouldGenerateSampledPreview(pageNum, totalPages),
        image: await pages[index].load()
      }
    },
    convertOnMainThread: async ({ pageNum, options, includePreview, image }) => {
      const decoded = image instanceof Blob ? await decodeImage(image) : image
      return finish(decoded ? await convertPage(decoded, pageNum, options, includePreview) : [], options)
    },
    onPageDone: ({ previewForProgress, previewForStorage }) => {
      if (previewForStorage) {
        storedPreviews++
      }
      completed++
      onProgress(completed / totalPages, previewForProgress)
    }
  })
}

function normalizeArchivePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase()
}

function getBaseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function moveCoverToFront(pages: SourcePage[], metadata: BookMetadata): SourcePage[] {
  let coverIndex = -1

  if (Number.isInteger(metadata.coverPage) && (metadata.coverPage ?? 0) > 0) {
    coverIndex = pages.findIndex((page) => page.originalPage === metadata.coverPage)
  }

  if (coverIndex === -1 && metadata.coverImagePath) {
    const coverPath = normalizeArchivePath(metadata.coverImagePath)
    const paths = pages.map((page) => page.path === undefined ? undefined : normalizeArchivePath(page.path))
    coverIndex = paths.indexOf(coverPath)
    if (coverIndex === -1) {
      coverIndex = paths.findIndex((path) => path !== undefined && getBaseName(path) === getBaseName(coverPath))
    }
  }

  if (coverIndex <= 0) {
    return pages
  }
  return [pages[coverIndex], ...pages.slice(0, coverIndex), ...pages.slice(coverIndex + 1)]
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

function getOutputName(fileName: string, is2bit: boolean): string {
  const dot = fileName.lastIndexOf('.')
  const stem = dot <= 0 ? fileName : fileName.slice(0, dot)
  return `${stem}${is2bit ? '.xtch' : '.xtc'}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'))
    reader.readAsDataURL(blob)
  })
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
