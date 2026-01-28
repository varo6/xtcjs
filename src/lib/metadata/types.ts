// Metadata types for XTC format

export interface TocEntry {
  title: string
  startPage: number  // 1-indexed original page
  endPage: number    // 1-indexed original page
}

export interface BookMetadata {
  title?: string
  author?: string
  toc: TocEntry[]
}

export interface XtcMetadataOptions {
  metadata?: BookMetadata
}
