import { afterEach, describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryIndex } from './library-index'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'xtcjs-library-'))
  tempDirs.push(dir)
  return dir
}

async function writeCbz(path: string, comicInfo?: string): Promise<void> {
  const zip = new JSZip()
  zip.file('page001.txt', 'not an image')
  if (comicInfo) {
    zip.file('ComicInfo.xml', comicInfo)
  }
  await writeFile(path, Buffer.from(await zip.generateAsync({ type: 'uint8array' })))
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('LibraryIndex', () => {
  test('finds nested CBZ files and ignores other files', async () => {
    const dir = await makeTempDir()
    await mkdir(join(dir, 'Series'), { recursive: true })
    await writeCbz(join(dir, 'Series', 'Book.cbz'))
    await writeFile(join(dir, 'Series', 'notes.txt'), 'ignore me')

    const index = new LibraryIndex(dir)
    const books = await index.rescan()

    expect(books).toHaveLength(1)
    expect(books[0].relativePath).toBe('Series/Book.cbz')
    expect(books[0].title).toBe('Book')
  })

  test('does not unpack CBZ metadata while indexing', async () => {
    const dir = await makeTempDir()
    await writeCbz(join(dir, 'comic.cbz'), `
      <ComicInfo>
        <Title>Library Title</Title>
        <Writer>Library Author</Writer>
      </ComicInfo>
    `)

    const index = new LibraryIndex(dir)
    const [book] = await index.rescan()

    expect(book.title).toBe('comic')
    expect(book.author).toBeUndefined()
  })

  test('book id changes when source metadata changes', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'book.cbz')
    await writeCbz(path)

    const index = new LibraryIndex(dir)
    const [first] = await index.rescan()
    await Bun.sleep(5)
    await writeCbz(path, '<ComicInfo><Title>Changed</Title></ComicInfo>')
    const [second] = await index.rescan()

    expect(second.id).not.toBe(first.id)
  })
})
