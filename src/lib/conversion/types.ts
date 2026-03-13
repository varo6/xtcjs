export type SplitMode = 'overlap' | 'split' | 'nosplit' | 'quarter' | 'euro2' | 'euro'
export type PageOverviewMode = 'none' | 'portrait' | 'landscape'

export interface ConversionOptions {
  device: 'X4' | 'X3'
  splitMode: SplitMode
  pageOverview: PageOverviewMode
  dithering: string
  contrast: number
  horizontalMargin: number
  verticalMargin: number
  orientation: 'landscape' | 'portrait'
  landscapeFlipClockwise: boolean
  showProgressPreview: boolean
  imageMode: 'cover' | 'letterbox' | 'fill' | 'crop'
  videoFps: number
}

export interface ConversionResult {
  name: string
  data?: ArrayBuffer
  size?: number
  pageCount?: number
  pageImages?: string[]
  previewMode?: 'sparse' | 'full'
  error?: string
}
