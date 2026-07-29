import { ConversionCache } from './cache'
import { convertCbzFileToXtc } from './cbz-converter'
import { loadOpdsConfig } from './config'
import { LibraryIndex } from './library-index'
import { SerialTaskQueue } from './task-queue'
import type { LibraryBook, OpdsConfig } from './types'

export class OpdsService {
  readonly config: OpdsConfig
  private readonly index: LibraryIndex
  private readonly cache: ConversionCache
  private readonly conversions = new SerialTaskQueue()
  private scanPromise: Promise<LibraryBook[]> | null = null

  constructor(config = loadOpdsConfig()) {
    this.config = config
    this.index = new LibraryIndex(config.libraryDir)
    this.cache = new ConversionCache(config.cacheDir)
  }

  async ensureScanned(): Promise<LibraryBook[]> {
    if (this.index.getBooks().length > 0) {
      return this.index.getBooks()
    }
    return this.rescan()
  }

  async rescan(): Promise<LibraryBook[]> {
    if (!this.scanPromise) {
      this.scanPromise = this.index.rescan().finally(() => {
        this.scanPromise = null
      })
    }
    return this.scanPromise
  }

  async search(query: string): Promise<LibraryBook[]> {
    await this.ensureScanned()
    return this.index.search(query)
  }

  async getBook(id: string): Promise<LibraryBook | undefined> {
    await this.ensureScanned()
    return this.index.getBook(id)
  }

  async getStatus() {
    await this.ensureScanned()
    return {
      pageSize: this.config.pageSize,
      conversion: this.config.conversion,
      bookCount: this.index.getBooks().length,
    }
  }

  async getConvertedBook(book: LibraryBook) {
    return this.cache.getOrCreate(book, this.config.conversion, () =>
      this.conversions.run(() => convertCbzFileToXtc(book.absolutePath, this.config.conversion))
    )
  }
}

export const opdsService = new OpdsService()
