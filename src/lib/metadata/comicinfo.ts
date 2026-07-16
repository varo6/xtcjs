// ComicInfo.xml parsing for CBZ/CBR metadata

import type { BookMetadata, TocEntry } from './types'

/**
 * Parse ComicInfo.xml content and extract metadata
 */
export function parseComicInfo(xmlContent: string): BookMetadata {
  const metadata: BookMetadata = { toc: [] }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, 'text/xml')

    // Check for parse errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      return metadata
    }

    // Extract title
    const titleEl = doc.querySelector('Title')
    if (titleEl?.textContent) {
      metadata.title = titleEl.textContent.trim()
    }

    // Extract author (Writer or Artist)
    const writerEl = doc.querySelector('Writer')
    const artistEl = doc.querySelector('Artist')
    if (writerEl?.textContent) {
      metadata.author = writerEl.textContent.trim()
    } else if (artistEl?.textContent) {
      metadata.author = artistEl.textContent.trim()
    }

    // Extract TOC from Pages elements if available
    const pages = doc.querySelectorAll('Pages > Page')
    if (pages.length > 0) {
      metadata.toc = extractTocFromPages(pages)

      const coverHint = extractCoverHintFromPages(pages)
      if (coverHint.coverPage !== undefined) {
        metadata.coverPage = coverHint.coverPage
      }
      if (coverHint.coverImagePath) {
        metadata.coverImagePath = coverHint.coverImagePath
      }
    }

    // Additional non-standard cover hint some ComicInfo variants include.
    const coverImageEl = doc.querySelector('CoverImage')
    if (!metadata.coverImagePath && coverImageEl?.textContent) {
      const coverImagePath = coverImageEl.textContent.trim()
      if (coverImagePath) {
        metadata.coverImagePath = coverImagePath
      }
    }
  } catch {
    // XML parsing failed, return empty metadata
  }

  return metadata
}

/**
 * Extract TOC entries from ComicInfo Pages elements
 * Pages with Bookmark attribute are treated as chapter markers
 */
function extractTocFromPages(pages: NodeListOf<Element>): TocEntry[] {
  const toc: TocEntry[] = []
  const totalPages = pages.length

  pages.forEach((page, index) => {
    const bookmark = page.getAttribute('Bookmark')
    if (bookmark) {
      // Page index is 0-indexed, convert to 1-indexed
      const startPage = index + 1

      toc.push({
        title: bookmark,
        startPage,
        endPage: startPage  // Will be calculated below
      })
    }
  })

  // Calculate end pages based on next chapter start
  for (let i = 0; i < toc.length; i++) {
    if (i < toc.length - 1) {
      toc[i].endPage = toc[i + 1].startPage - 1
    } else {
      toc[i].endPage = totalPages
    }
  }

  return toc
}

function extractCoverHintFromPages(
  pages: NodeListOf<Element>
): { coverPage?: number; coverImagePath?: string } {
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]
    const type = normalizePageType(page.getAttribute('Type'))

    if (type !== 'frontcover' && type !== 'cover') {
      continue
    }

    const filePath = page.getAttribute('File')?.trim()
    const coverPage = parseZeroIndexedPage(page.getAttribute('Image'))

    return {
      coverPage: coverPage ?? index + 1,
      coverImagePath: filePath || undefined
    }
  }

  return {}
}

function normalizePageType(rawType: string | null): string {
  if (!rawType) return ''
  return rawType.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function parseZeroIndexedPage(rawPage: string | null): number | undefined {
  if (!rawPage) return undefined
  const parsed = Number.parseInt(rawPage.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }
  return parsed + 1
}

/**
 * Try to find and parse ComicInfo.xml from a list of file entries
 */
function findComicInfoXml(
  files: Array<{ path: string; content: string }>
): BookMetadata | null {
  for (const file of files) {
    const lowerPath = file.path.toLowerCase()
    if (lowerPath === 'comicinfo.xml' || lowerPath.endsWith('/comicinfo.xml')) {
      return parseComicInfo(file.content)
    }
  }
  return null
}
