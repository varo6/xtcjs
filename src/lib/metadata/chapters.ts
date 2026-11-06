import type { TocEntry } from './types'

export function sliceChapters(toc: readonly TocEntry[], start: number, end: number): TocEntry[] {
  return toc.flatMap(chapter => {
    // CrossPoint treats a legacy zero page field as the first page.
    const first = Math.max(start, chapter.startPage, 1)
    const last = Math.min(end, Math.max(chapter.endPage, 1))
    return first > last ? [] : [{
      ...chapter,
      startPage: first - start + 1,
      endPage: last - start + 1,
    }]
  })
}
