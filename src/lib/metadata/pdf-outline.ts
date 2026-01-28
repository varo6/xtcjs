// PDF outline/bookmark extraction

import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { BookMetadata, TocEntry } from './types'

interface PdfOutlineItem {
  title: string
  dest: string | unknown[] | null
  items?: PdfOutlineItem[]
}

/**
 * Extract metadata (title, author, TOC) from a PDF document
 */
export async function extractPdfMetadata(pdf: PDFDocumentProxy): Promise<BookMetadata> {
  const metadata: BookMetadata = { toc: [] }

  // Extract document info (title, author)
  try {
    const info = await pdf.getMetadata()
    if (info?.info) {
      const docInfo = info.info as Record<string, unknown>
      if (typeof docInfo.Title === 'string' && docInfo.Title) {
        metadata.title = docInfo.Title
      }
      if (typeof docInfo.Author === 'string' && docInfo.Author) {
        metadata.author = docInfo.Author
      }
    }
  } catch {
    // Metadata extraction failed, continue without it
  }

  // Extract TOC from outline/bookmarks
  try {
    const outline = await pdf.getOutline() as PdfOutlineItem[] | null
    if (outline && outline.length > 0) {
      metadata.toc = await flattenOutline(pdf, outline)
    }
  } catch {
    // Outline extraction failed, continue without TOC
  }

  return metadata
}

/**
 * Flatten nested outline into a flat TOC list with page numbers
 */
async function flattenOutline(
  pdf: PDFDocumentProxy,
  items: PdfOutlineItem[],
  result: TocEntry[] = []
): Promise<TocEntry[]> {
  for (const item of items) {
    const pageNum = await resolveDestinationPage(pdf, item.dest)
    if (pageNum !== null) {
      result.push({
        title: item.title,
        startPage: pageNum,
        endPage: pageNum  // Will be calculated later
      })
    }

    // Recursively process nested items
    if (item.items && item.items.length > 0) {
      await flattenOutline(pdf, item.items, result)
    }
  }

  // Calculate end pages based on next chapter start
  for (let i = 0; i < result.length; i++) {
    if (i < result.length - 1) {
      result[i].endPage = result[i + 1].startPage - 1
    } else {
      result[i].endPage = pdf.numPages
    }
  }

  return result
}

/**
 * Resolve a PDF destination to a page number
 */
async function resolveDestinationPage(
  pdf: PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<number | null> {
  if (!dest) return null

  try {
    let explicitDest: unknown[] | null = Array.isArray(dest) ? dest : null

    // If dest is a named destination string, resolve it
    if (typeof dest === 'string') {
      explicitDest = await pdf.getDestination(dest)
      if (!explicitDest) return null
    }

    // Explicit destination is an array where first element is a page reference
    if (Array.isArray(explicitDest) && explicitDest.length > 0) {
      const pageRef = explicitDest[0]
      if (pageRef && typeof pageRef === 'object' && 'num' in pageRef) {
        // Page reference object with num and gen
        const pageIndex = await pdf.getPageIndex(pageRef as { num: number; gen: number })
        return pageIndex + 1  // Convert to 1-indexed
      }
    }
  } catch {
    // Destination resolution failed
  }

  return null
}
