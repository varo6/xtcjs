import { convertToXtc } from './converter'
import type { ConversionOptions } from './conversion/types'
import { mapWithConcurrency } from './concurrency'
import { imageDataToXtg, imageDataToXth } from './processing/xtg'
import { decodeXtcPageToCanvas } from './xtc-reader'
import {
  inspectReplaceableXtc,
  parseXtcRawPage,
  type ImportedXtcPage,
  type ReplaceableXtcBook,
} from './page-replacement'

type ConvertibleImportType = 'cbz' | 'cbr' | 'pdf' | 'image'
type PageImportType = ConvertibleImportType | 'xtc' | 'raw'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])

export const PAGE_IMPORT_ACCEPT = [
  '.xtg', '.xth', '.xtc', '.xtch',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif',
  '.cbz', '.cbr', '.pdf',
].join(',')

function detectPageImportType(file: File): PageImportType {
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  if (extension === 'xtg' || extension === 'xth') return 'raw'
  if (extension === 'xtc' || extension === 'xtch') return 'xtc'
  if (extension === 'cbz' || extension === 'cbr' || extension === 'pdf') return extension
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  throw new Error('Unsupported import. Use XTG, XTH, XTC, XTCH, CBZ, CBR, PDF, or an image file.')
}

function inferTargetDevice(book: ReplaceableXtcBook): ConversionOptions['device'] {
  const firstPage = book.pages[0]
  const dimensions = new Set([`${firstPage.width}x${firstPage.height}`, `${firstPage.height}x${firstPage.width}`])
  if (dimensions.has('528x792')) return 'X3'
  if (dimensions.has('480x800')) return 'X4'
  throw new Error(
    `Automatic image/archive conversion requires X4 (480×800) or X3 (528×792) pages; ` +
    `this book uses ${firstPage.width}×${firstPage.height}. Raw XTG/XTH and XTC/XTCH imports are still supported.`
  )
}

function getExpectedPageSize(magic: 'XTG' | 'XTH', width: number, height: number): number {
  const payloadSize = magic === 'XTH'
    ? Math.ceil(height / 8) * width * 2
    : Math.ceil(width / 8) * height
  return 22 + payloadSize
}

function getAutomaticConversionOptions(
  book: ReplaceableXtcBook,
  fileType: ConvertibleImportType
): ConversionOptions {
  const isImage = fileType === 'image'
  const isPdf = fileType === 'pdf'

  return {
    device: inferTargetDevice(book),
    splitMode: isImage ? 'nosplit' : 'overlap',
    pageOverview: 'none',
    dithering: isPdf ? 'atkinson' : 'floyd',
    is2bit: book.is2bit,
    contrast: isPdf ? 8 : 4,
    horizontalMargin: 0,
    verticalMargin: 0,
    orientation: isImage ? 'portrait' : 'landscape',
    coverPortrait: false,
    landscapeFlipClockwise: false,
    showProgressPreview: false,
    imageMode: isImage ? 'cover' : 'letterbox',
    videoFps: 1,
  }
}

function rawBufferToImportedPage(buffer: ArrayBuffer): ImportedXtcPage {
  const header = parseXtcRawPage(buffer)
  return {
    data: new Blob([buffer]),
    magic: header.magic,
    width: header.width,
    height: header.height,
  }
}

function convertRawBufferToBook(
  buffer: ArrayBuffer,
  book: ReplaceableXtcBook
): ImportedXtcPage {
  const header = parseXtcRawPage(buffer)
  if (header.magic === book.pageMagic) {
    return rawBufferToImportedPage(buffer)
  }

  const canvas = decodeXtcPageToCanvas(buffer)
  const imageData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  const converted = book.is2bit ? imageDataToXth(imageData) : imageDataToXtg(imageData)
  return rawBufferToImportedPage(converted)
}

async function importRawPage(file: File, book: ReplaceableXtcBook): Promise<ImportedXtcPage[]> {
  return [convertRawBufferToBook(await file.arrayBuffer(), book)]
}

async function importXtcBook(
  file: File,
  destination: ReplaceableXtcBook,
  onProgress: (progress: number) => void
): Promise<ImportedXtcPage[]> {
  const importedBook = await inspectReplaceableXtc(file)

  if (importedBook.pageMagic === destination.pageMagic) {
    onProgress(1)
    return importedBook.pages.map((page, index) => {
      const expectedSize = getExpectedPageSize(importedBook.pageMagic, page.width, page.height)
      if (page.size !== expectedSize) {
        throw new Error(
          `Imported book page ${index + 1} has an unsupported padded or nonstandard payload size.`
        )
      }

      return {
        data: file.slice(page.offset, page.offset + page.size),
        magic: importedBook.pageMagic,
        width: page.width,
        height: page.height,
      }
    })
  }

  let completed = 0
  return mapWithConcurrency(importedBook.pages, async (page) => {
    const buffer = await file.slice(page.offset, page.offset + page.size).arrayBuffer()
    const converted = convertRawBufferToBook(buffer, destination)
    completed++
    onProgress(completed / importedBook.pageCount)
    return converted
  }, 3)
}

async function importConvertibleFile(
  file: File,
  fileType: ConvertibleImportType,
  book: ReplaceableXtcBook,
  onProgress: (progress: number) => void
): Promise<ImportedXtcPage[]> {
  const result = await convertToXtc(
    file,
    fileType,
    getAutomaticConversionOptions(book, fileType),
    (progress) => onProgress(progress)
  )

  if (!result.data || !result.pageCount) {
    throw new Error('The selected file did not produce any pages.')
  }

  const convertedBookBlob = new Blob([result.data])
  const convertedBook = await inspectReplaceableXtc(convertedBookBlob)
  return convertedBook.pages.map((page) => ({
    data: convertedBookBlob.slice(page.offset, page.offset + page.size),
    magic: convertedBook.pageMagic,
    width: page.width,
    height: page.height,
  }))
}

export async function importPagesForBook(
  file: File,
  book: ReplaceableXtcBook,
  onProgress: (progress: number) => void = () => {}
): Promise<ImportedXtcPage[]> {
  const fileType = detectPageImportType(file)

  if (fileType === 'raw') {
    const pages = await importRawPage(file, book)
    onProgress(1)
    return pages
  }
  if (fileType === 'xtc') {
    return importXtcBook(file, book, onProgress)
  }
  return importConvertibleFile(file, fileType, book, onProgress)
}
