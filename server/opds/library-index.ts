import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type { LibraryBook } from './types'

interface ParsedComicInfo {
  title?: string
  author?: string
}

export class LibraryIndex {
  private books: LibraryBook[] = []
  private readonly libraryDir: string

  constructor(libraryDir: string) {
    this.libraryDir = resolve(libraryDir)
  }

  getBooks(): LibraryBook[] {
    return [...this.books]
  }

  getBook(id: string): LibraryBook | undefined {
    return this.books.find((book) => book.id === id)
  }

  search(query: string): LibraryBook[] {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return this.getBooks()
    return this.books.filter((book) =>
      book.title.toLowerCase().includes(normalized) ||
      book.relativePath.toLowerCase().includes(normalized) ||
      (book.author?.toLowerCase().includes(normalized) ?? false)
    )
  }

  async rescan(): Promise<LibraryBook[]> {
    const files = await this.findCbzFiles(this.libraryDir)
    const books = await Promise.all(files.map((absolutePath) => this.createBook(absolutePath)))
    books.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    this.books = books
    return this.getBooks()
  }

  private async findCbzFiles(dir: string): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const files: string[] = []
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...await this.findCbzFiles(absolutePath))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cbz')) {
        files.push(absolutePath)
      }
    }
    return files
  }

  private async createBook(absolutePath: string): Promise<LibraryBook> {
    const safePath = resolve(absolutePath)
    if (!safePath.startsWith(this.libraryDir + sep) && safePath !== this.libraryDir) {
      throw new Error(`Library path escapes root: ${absolutePath}`)
    }

    const info = await stat(safePath)
    const relativePath = relative(this.libraryDir, safePath).split(sep).join('/')
    const comicInfo = await readComicInfo(safePath)
    const fallbackTitle = basename(relativePath, extname(relativePath))

    return {
      id: createHash('sha256')
        .update(relativePath)
        .update('\0')
        .update(String(info.size))
        .update('\0')
        .update(String(info.mtimeMs))
        .digest('hex')
        .slice(0, 24),
      relativePath,
      absolutePath: safePath,
      title: comicInfo.title || fallbackTitle,
      author: comicInfo.author,
      size: info.size,
      mtimeMs: info.mtimeMs,
      updated: info.mtime.toISOString(),
    }
  }
}

async function readComicInfo(path: string): Promise<ParsedComicInfo> {
  try {
    const zip = await JSZip.loadAsync(await Bun.file(path).arrayBuffer())
    let entry: JSZip.JSZipObject | null = null
    zip.forEach((relativePath, zipEntry) => {
      if (!entry && !zipEntry.dir && relativePath.toLowerCase().split('/').pop() === 'comicinfo.xml') {
        entry = zipEntry
      }
    })
    if (!entry) return {}
    return parseComicInfoText(await entry.async('string'))
  } catch {
    return {}
  }
}

function parseComicInfoText(xml: string): ParsedComicInfo {
  const title = extractTag(xml, 'Title')
  const writer = extractTag(xml, 'Writer')
  const artist = extractTag(xml, 'Artist')
  return {
    title,
    author: writer || artist,
  }
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  const value = match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
  return value || undefined
}
