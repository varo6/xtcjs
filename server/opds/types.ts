export interface LibraryBook {
  id: string
  relativePath: string
  absolutePath: string
  title: string
  author?: string
  size: number
  mtimeMs: number
  updated: string
}

export interface OpdsConfig {
  libraryDir: string
  cacheDir: string
  pageSize: number
  auth?: OpdsAuth
  conversion: ServerConversionOptions
}

export interface OpdsAuth {
  username: string
  password: string
}

export interface ServerConversionOptions {
  device: 'X4' | 'X3'
  splitMode: 'overlap' | 'split' | 'fourway' | 'nosplit'
  dithering: 'floyd' | 'atkinson' | 'sierra-lite' | 'ordered' | 'none'
  contrast: number
  is2bit: boolean
  orientation: 'landscape' | 'portrait'
}

export interface CachedConversion {
  path: string
  filename: string
  size: number
}
