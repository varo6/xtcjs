import type { TocEntry } from './metadata/types'

export interface PageMapping {
  originalPage: number
  xtcStartPage: number
  xtcPageCount: number
}

export class PageMappingContext {
  private mappings: PageMapping[] = []
  private currentXtcPage = 1

  addOriginalPage(originalPage: number, xtcPageCount: number): void {
    this.mappings.push({
      originalPage,
      xtcStartPage: this.currentXtcPage,
      xtcPageCount
    })
    this.currentXtcPage += xtcPageCount
  }

  getXtcPage(originalPage: number): number {
    const mapping = this.mappings.find(m => m.originalPage === originalPage)
    return mapping ? mapping.xtcStartPage : originalPage
  }

  getMappings(): PageMapping[] {
    return [...this.mappings]
  }

  getTotalXtcPages(): number {
    return this.currentXtcPage - 1
  }
}

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
