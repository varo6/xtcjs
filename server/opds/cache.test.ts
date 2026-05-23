import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversionCache } from './cache'
import type { LibraryBook, ServerConversionOptions } from './types'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'xtcjs-cache-'))
  tempDirs.push(dir)
  return dir
}

const options: ServerConversionOptions = {
  device: 'X4',
  splitMode: 'overlap',
  dithering: 'floyd',
  contrast: 4,
  is2bit: false,
  orientation: 'landscape',
}

function book(overrides: Partial<LibraryBook> = {}): LibraryBook {
  return {
    id: 'book-1',
    relativePath: 'book.cbz',
    absolutePath: '/library/book.cbz',
    title: 'Book',
    size: 100,
    mtimeMs: 1000,
    updated: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ConversionCache', () => {
  test('returns an existing cache hit without converting again', async () => {
    const dir = await makeTempDir()
    const cache = new ConversionCache(dir)
    let conversions = 0

    const first = await cache.getOrCreate(book(), options, async () => {
      conversions++
      return new ArrayBuffer(4)
    })
    const second = await cache.getOrCreate(book(), options, async () => {
      conversions++
      return new ArrayBuffer(8)
    })

    expect(first.path).toBe(second.path)
    expect(conversions).toBe(1)
  })

  test('source changes produce a different cache entry', async () => {
    const dir = await makeTempDir()
    const cache = new ConversionCache(dir)

    const first = await cache.getOrCreate(book({ size: 100 }), options, async () => new ArrayBuffer(4))
    const second = await cache.getOrCreate(book({ size: 101 }), options, async () => new ArrayBuffer(4))

    expect(second.path).not.toBe(first.path)
  })

  test('concurrent requests share one conversion promise', async () => {
    const dir = await makeTempDir()
    const cache = new ConversionCache(dir)
    let conversions = 0

    const convert = async () => {
      conversions++
      await Bun.sleep(20)
      return new ArrayBuffer(4)
    }

    const [first, second] = await Promise.all([
      cache.getOrCreate(book(), options, convert),
      cache.getOrCreate(book(), options, convert),
    ])

    expect(first.path).toBe(second.path)
    expect(conversions).toBe(1)
  })
})
