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

/**
 * Try to find and parse ComicInfo.xml from a list of file entries
 */
export function findComicInfoXml(
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
