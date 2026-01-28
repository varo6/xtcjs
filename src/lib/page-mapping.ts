// Page mapping for TOC adjustment based on conversion mode

import type { TocEntry } from './metadata/types'

export interface PageMapping {
  originalPage: number  // 1-indexed
  xtcStartPage: number  // 1-indexed
  xtcPageCount: number
}

/**
 * Context for tracking page mappings during conversion
 */
export class PageMappingContext {
  private mappings: PageMapping[] = []
  private currentXtcPage = 1

  /**
   * Record that an original page was converted to N XTC pages
   */
  addOriginalPage(originalPage: number, xtcPageCount: number): void {
    this.mappings.push({
      originalPage,
      xtcStartPage: this.currentXtcPage,
      xtcPageCount
    })
    this.currentXtcPage += xtcPageCount
  }

  /**
   * Get the XTC page number for an original page number
   * Returns the first XTC page that corresponds to the original page
   */
  getXtcPage(originalPage: number): number {
    const mapping = this.mappings.find(m => m.originalPage === originalPage)
    return mapping ? mapping.xtcStartPage : originalPage
  }

  /**
   * Get all mappings
   */
  getMappings(): PageMapping[] {
    return [...this.mappings]
  }

  /**
   * Get total XTC page count
   */
  getTotalXtcPages(): number {
    return this.currentXtcPage - 1
  }
}

/**
 * Adjust TOC entries based on page mapping from original to XTC pages
 */
export function adjustTocForMapping(
  toc: TocEntry[],
  mappingCtx: PageMappingContext
): TocEntry[] {
  if (toc.length === 0) {
    return []
  }

  const totalXtcPages = mappingCtx.getTotalXtcPages()

  return toc.map((entry, index) => {
    const adjustedStartPage = mappingCtx.getXtcPage(entry.startPage)

    // Calculate end page: either the page before the next chapter starts,
    // or the last page for the final chapter
    let adjustedEndPage: number
    if (index < toc.length - 1) {
      const nextChapterStart = mappingCtx.getXtcPage(toc[index + 1].startPage)
      adjustedEndPage = nextChapterStart - 1
    } else {
      adjustedEndPage = totalXtcPages
    }

    return {
      title: entry.title,
      startPage: adjustedStartPage,
      endPage: adjustedEndPage
    }
  })
}
