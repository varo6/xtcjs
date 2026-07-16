import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type { LibraryBook } from './types'

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
    const books: LibraryBook[] = []
    await this.findCbzFiles(this.libraryDir, books)
    books.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    this.books = books
    return this.getBooks()
  }

  private async findCbzFiles(dir: string, books: LibraryBook[]): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      const absolutePath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.findCbzFiles(absolutePath, books)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cbz')) {
        books.push(await this.createBook(absolutePath))
      }
    }
  }

  private async createBook(absolutePath: string): Promise<LibraryBook> {
    const safePath = resolve(absolutePath)
    if (!safePath.startsWith(this.libraryDir + sep) && safePath !== this.libraryDir) {
      throw new Error(`Library path escapes root: ${absolutePath}`)
    }

    const info = await stat(safePath)
    const relativePath = relative(this.libraryDir, safePath).split(sep).join('/')

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
      title: basename(relativePath, extname(relativePath)),
      size: info.size,
      mtimeMs: info.mtimeMs,
      updated: info.mtime.toISOString(),
    }
  }
}
