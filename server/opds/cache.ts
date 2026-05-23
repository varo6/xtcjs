import { createHash } from 'node:crypto'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CachedConversion, LibraryBook, ServerConversionOptions } from './types'

type Converter = () => Promise<ArrayBuffer>

const inFlight = new Map<string, Promise<CachedConversion>>()

export class ConversionCache {
  constructor(private readonly cacheDir: string) {}

  async getOrCreate(
    book: LibraryBook,
    options: ServerConversionOptions,
    convert: Converter
  ): Promise<CachedConversion> {
    const key = getCacheKey(book, options)
    const filename = `${sanitizeFilename(book.title)}.${options.is2bit ? 'xtch' : 'xtc'}`
    const path = join(this.cacheDir, key, filename)

    const cached = await getExisting(path, filename)
    if (cached) return cached

    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = this.create(path, filename, convert)
    inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      inFlight.delete(key)
    }
  }

  private async create(path: string, filename: string, convert: Converter): Promise<CachedConversion> {
    await mkdir(dirname(path), { recursive: true })
    const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
    const data = await convert()
    await Bun.write(tmpPath, data)
    await rename(tmpPath, path)
    const info = await stat(path)
    return { path, filename, size: info.size }
  }
}

function getCacheKey(book: LibraryBook, options: ServerConversionOptions): string {
  return createHash('sha256')
    .update(book.relativePath)
    .update('\0')
    .update(String(book.size))
    .update('\0')
    .update(String(book.mtimeMs))
    .update('\0')
    .update(JSON.stringify(options))
    .digest('hex')
}

async function getExisting(path: string, filename: string): Promise<CachedConversion | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return { path, filename, size: info.size }
  } catch {
    return null
  }
}

export function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized || 'book'
}
