// What each input format contributes to a conversion: its pages, how to load
// one, and its metadata. Everything else (cover handling, per-page options,
// scheduling, previews) is the same for every format and lives in converter.ts.

import JSZip from 'jszip'
import { createExtractorFromData } from 'node-unrar-js'
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url'
import { extractPdfMetadata } from '../metadata/pdf-outline'
import { parseComicInfo } from '../metadata/comicinfo'
import { loadPdfDocument } from '../pdfjs'
import type { BookMetadata } from '../metadata'
import type { ConversionOptions } from './types'

export type FileType = 'cbz' | 'cbr' | 'pdf' | 'image' | 'video'

/** An encoded image file, or a page the main thread rendered (PDF page, video frame). */
export type SourceImage = Blob | HTMLCanvasElement

export interface SourcePage {
  /** 1-based position in the source file, used to remap the table of contents. */
  originalPage: number
  /** Archive entry path, matched against the ComicInfo cover hint. */
  path?: string
  load: () => Promise<SourceImage>
}

export interface Book {
  pages: SourcePage[]
  metadata: BookMetadata
  /** The format has a cover page, so `firstPageIsCover` applies to it. */
  hasCover: boolean
  /** Every page is converted whole, whatever `splitMode` says. */
  forceNoSplit: boolean
  close?: () => void
}

type SourceOptions = Pick<ConversionOptions, 'videoFps'>

export const openBook: Record<FileType, (file: File, options: SourceOptions) => Promise<Book>> = {
  cbz: openCbz,
  cbr: openCbr,
  pdf: openPdf,
  image: openImage,
  video: openVideo,
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

function isIgnored(path: string): boolean {
  return path.toLowerCase().startsWith('__macos')
}

function isPageImage(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.has(lower.substring(lower.lastIndexOf('.')))
}

function isComicInfo(path: string): boolean {
  const lower = path.toLowerCase()
  return lower === 'comicinfo.xml' || lower.endsWith('/comicinfo.xml')
}

function archiveBook(
  format: string,
  images: Array<{ path: string; load: () => Promise<Blob> }>,
  comicInfoXml: string | null
): Book {
  if (images.length === 0) {
    throw new Error(`No images found in ${format}`)
  }

  let metadata: BookMetadata = { toc: [] }
  if (comicInfoXml) {
    try {
      metadata = parseComicInfo(comicInfoXml)
    } catch {
      // Continue conversion without metadata.
    }
  }

  const pages = [...images]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((image, index) => ({ ...image, originalPage: index + 1 }))
  return { pages, metadata, hasCover: true, forceNoSplit: false }
}

async function openCbz(file: File): Promise<Book> {
  const zip = await JSZip.loadAsync(file)
  const entries = zip.filter((path, entry) => !entry.dir && !isIgnored(path))
  const images = entries
    .filter((entry) => isPageImage(entry.name))
    .map((entry) => ({ path: entry.name, load: () => entry.async('blob') }))
  const comicInfo = entries.filter((entry) => isComicInfo(entry.name)).pop()
  const comicInfoXml = comicInfo ? await comicInfo.async('string').catch(() => null) : null
  return archiveBook('CBZ', images, comicInfoXml)
}

let unrarWasmBinary: ArrayBuffer | null = null

async function loadUnrarWasm(): Promise<ArrayBuffer> {
  unrarWasmBinary ??= await (await fetch(unrarWasm)).arrayBuffer()
  return unrarWasmBinary
}

async function openCbr(file: File): Promise<Book> {
  const [wasmBinary, data] = await Promise.all([loadUnrarWasm(), file.arrayBuffer()])
  const extractor = await createExtractorFromData({ data, wasmBinary })
  const images: Array<{ path: string; load: () => Promise<Blob> }> = []
  let comicInfoXml: string | null = null

  for (const { fileHeader, extraction } of extractor.extract().files) {
    const path = fileHeader.name
    if (fileHeader.flags.directory || !extraction || isIgnored(path)) continue
    if (isPageImage(path)) {
      images.push({ path, load: async () => new Blob([new Uint8Array(extraction)]) })
    }
    if (isComicInfo(path)) {
      comicInfoXml = new TextDecoder('utf-8').decode(extraction)
    }
  }

  return archiveBook('CBR', images, comicInfoXml)
}

async function openPdf(file: File): Promise<Book> {
  const pdf = await loadPdfDocument(await file.arrayBuffer())

  let metadata: BookMetadata = { toc: [] }
  try {
    metadata = await extractPdfMetadata(pdf)
  } catch {
    // Continue conversion without metadata.
  }

  const render = async (pageNumber: number) => {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 2.0 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise
    return canvas
  }

  const pages = Array.from({ length: pdf.numPages }, (_, i) => ({ originalPage: i + 1, load: () => render(i + 1) }))
  return { pages, metadata, hasCover: true, forceNoSplit: false }
}

async function openImage(file: File): Promise<Book> {
  return {
    pages: [{ originalPage: 1, load: async () => file }],
    metadata: { toc: [] },
    hasCover: false,
    forceNoSplit: true,
  }
}

async function openVideo(file: File, { videoFps }: SourceOptions): Promise<Book> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url
  const close = () => {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
  }

  let duration: number
  try {
    duration = await loadVideoDuration(video)
  } catch (err) {
    close()
    throw err
  }

  const fps = Math.max(0.1, Math.min(10, Number.isFinite(videoFps) ? videoFps : 1))
  const frameCount = duration > 0 ? Math.max(1, Math.floor(duration * fps)) : 1

  const captureFrame = async (time: number) => {
    await seekVideo(video, time)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  // One <video> element seeks to one time at a time, so frames load in order.
  let previousFrame: Promise<unknown> = Promise.resolve()
  const pages = Array.from({ length: frameCount }, (_, i) => ({
    originalPage: i + 1,
    load: () => {
      const time = duration > 0 ? Math.min(Math.max(0, duration - 0.001), i / fps) : 0
      const frame = previousFrame.then(() => captureFrame(time))
      previousFrame = frame.catch(() => {})
      return frame
    },
  }))

  return { pages, metadata: { toc: [] }, hasCover: false, forceNoSplit: true, close }
}

async function loadVideoDuration(video: HTMLVideoElement): Promise<number> {
  if (video.readyState < 1) {
    await waitForEvent(video, 'loadedmetadata', 'Failed to load video metadata')
  }
  if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) ||
      video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('Invalid video dimensions')
  }
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const seeked = waitForEvent(video, 'seeked', 'Failed to seek video')
  video.currentTime = Math.max(0, time)
  await seeked
}

function waitForEvent(video: HTMLVideoElement, type: 'loadedmetadata' | 'seeked', errorMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(errorMessage))
    }
    const cleanup = () => {
      video.removeEventListener(type, onEvent)
      video.removeEventListener('error', onError)
    }
    video.addEventListener(type, onEvent)
    video.addEventListener('error', onError)
  })
}
