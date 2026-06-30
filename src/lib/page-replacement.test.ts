import { describe, expect, test } from 'bun:test'
import { buildXtcFromXtgPages } from './xtc-format'
import { parseXtcFile } from './xtc-reader'
import { importPagesForBook } from './page-import'
import {
  createEditedXtcBlob,
  createReplacedXtcBlob,
  inspectReplaceableXtc,
  parseXtcRawPage,
  validateXtcPageReplacement,
  type ImportedXtcPage,
  type XtcRawPageMagic,
} from './page-replacement'

function makeRawPage(
  magic: XtcRawPageMagic,
  width: number,
  height: number,
  fill: number
): ArrayBuffer {
  const payloadSize = magic === 'XTH'
    ? Math.ceil(height / 8) * width * 2
    : Math.ceil(width / 8) * height
  const buffer = new ArrayBuffer(22 + payloadSize)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  bytes.set([magic.charCodeAt(0), magic.charCodeAt(1), magic.charCodeAt(2), 0])
  view.setUint16(4, width, true)
  view.setUint16(6, height, true)
  view.setUint32(10, payloadSize, true)
  bytes.fill(fill, 22)
  bytes.set(bytes.subarray(22, 30), 14)

  return buffer
}

function asImportedPage(buffer: ArrayBuffer): ImportedXtcPage {
  const header = parseXtcRawPage(buffer)
  return {
    data: new Blob([buffer]),
    magic: header.magic,
    width: header.width,
    height: header.height,
  }
}

describe('XTC page replacement', () => {
  test('replaces several XTG pages without changing metadata or surrounding bytes', async () => {
    const originalPages = [
      makeRawPage('XTG', 16, 8, 0x11),
      makeRawPage('XTG', 16, 8, 0x22),
      makeRawPage('XTG', 16, 8, 0x33),
    ]
    const sourceBuffer = await buildXtcFromXtgPages(originalPages, {
      metadata: {
        title: 'Test Book',
        author: 'XTC.js',
        toc: [{ title: 'Chapter 1', startPage: 1, endPage: 3 }],
      },
    })
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)
    const pageOne = makeRawPage('XTG', 16, 8, 0xaa)
    const pageThree = makeRawPage('XTG', 16, 8, 0xcc)

    const output = await createReplacedXtcBlob(source, book, [
      { pageNumber: 3, file: new Blob([pageThree]) },
      { pageNumber: 1, file: new Blob([pageOne]) },
    ])
    const outputBuffer = await output.arrayBuffer()
    const expected = new Uint8Array(sourceBuffer.slice(0))
    expected.set(new Uint8Array(pageOne), book.pages[0].offset)
    expected.set(new Uint8Array(pageThree), book.pages[2].offset)

    expect(book.pageMagic).toBe('XTG')
    expect(book.hasMetadata).toBe(true)
    expect(new Uint8Array(outputBuffer)).toEqual(expected)

    const parsed = await parseXtcFile(outputBuffer)
    expect(parsed.metadata).toEqual({
      title: 'Test Book',
      author: 'XTC.js',
      toc: [{ title: 'Chapter 1', startPage: 1, endPage: 3 }],
    })
  })

  test('supports fixed-size XTH replacements in XTCH books', async () => {
    const original = makeRawPage('XTH', 16, 8, 0x44)
    const replacement = makeRawPage('XTH', 16, 8, 0x99)
    const sourceBuffer = await buildXtcFromXtgPages([original], { is2bit: true })
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)

    const output = await createReplacedXtcBlob(source, book, [
      { pageNumber: 1, file: new Blob([replacement]) },
    ])
    const outputBuffer = await output.arrayBuffer()
    const parsed = await parseXtcFile(outputBuffer)

    expect(book.is2bit).toBe(true)
    expect(book.pageMagic).toBe('XTH')
    expect(parsed.header.is2bit).toBe(true)
    expect(new Uint8Array(parsed.pageData[0])).toEqual(new Uint8Array(replacement))
  })

  test('rejects the wrong page format and dimensions', async () => {
    const original = makeRawPage('XTH', 16, 8, 0x44)
    const sourceBuffer = await buildXtcFromXtgPages([original], { is2bit: true })
    const book = await inspectReplaceableXtc(new Blob([sourceBuffer]))

    await expect(validateXtcPageReplacement(
      book,
      1,
      new Blob([makeRawPage('XTG', 16, 8, 0x55)])
    )).rejects.toThrow('must be XTH')

    await expect(validateXtcPageReplacement(
      book,
      1,
      new Blob([makeRawPage('XTH', 8, 16, 0x55)])
    )).rejects.toThrow('must be 16×8px')
  })

  test('rejects truncated raw page payloads and duplicate replacements', async () => {
    const original = makeRawPage('XTG', 16, 8, 0x11)
    const sourceBuffer = await buildXtcFromXtgPages([original])
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)
    const replacement = new Blob([makeRawPage('XTG', 16, 8, 0x22)])

    expect(() => parseXtcRawPage(original.slice(0, -1))).toThrow('truncated')
    await expect(createReplacedXtcBlob(source, book, [
      { pageNumber: 1, file: replacement },
      { pageNumber: 1, file: replacement },
    ])).rejects.toThrow('more than one replacement')
  })

  test('adds several pages before a position and adjusts later TOC references', async () => {
    const originalPages = [
      makeRawPage('XTG', 16, 8, 0x11),
      makeRawPage('XTG', 16, 8, 0x22),
      makeRawPage('XTG', 16, 8, 0x33),
    ]
    const addedPages = [
      makeRawPage('XTG', 16, 8, 0xaa),
      makeRawPage('XTG', 16, 8, 0xbb),
    ]
    const sourceBuffer = await buildXtcFromXtgPages(originalPages, {
      metadata: {
        title: 'Add Test',
        toc: [
          { title: 'First', startPage: 1, endPage: 1 },
          { title: 'Second', startPage: 2, endPage: 3 },
        ],
      },
    })
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)

    const output = await createEditedXtcBlob(source, book, [{
      mode: 'add',
      pageNumber: 2,
      pages: addedPages.map(asImportedPage),
    }])
    const parsed = await parseXtcFile(await output.arrayBuffer())

    expect(parsed.header.pageCount).toBe(5)
    expect(parsed.pageData.map((page) => new Uint8Array(page)[22])).toEqual([
      0x11, 0xaa, 0xbb, 0x22, 0x33,
    ])
    expect(parsed.metadata?.toc).toEqual([
      { title: 'First', startPage: 1, endPage: 1 },
      { title: 'Second', startPage: 4, endPage: 5 },
    ])
  })

  test('replaces one page with a multi-page sequence and can append at the end', async () => {
    const originalPages = [
      makeRawPage('XTG', 16, 8, 0x11),
      makeRawPage('XTG', 16, 8, 0x22),
      makeRawPage('XTG', 16, 8, 0x33),
    ]
    const sourceBuffer = await buildXtcFromXtgPages(originalPages)
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)

    const output = await createEditedXtcBlob(source, book, [
      {
        mode: 'replace',
        pageNumber: 2,
        pages: [
          asImportedPage(makeRawPage('XTG', 16, 8, 0xaa)),
          asImportedPage(makeRawPage('XTG', 16, 8, 0xbb)),
        ],
      },
      {
        mode: 'add',
        pageNumber: 4,
        pages: [asImportedPage(makeRawPage('XTG', 16, 8, 0xcc))],
      },
    ])
    const parsed = await parseXtcFile(await output.arrayBuffer())

    expect(parsed.header.pageCount).toBe(5)
    expect(parsed.pageData.map((page) => new Uint8Array(page)[22])).toEqual([
      0x11, 0xaa, 0xbb, 0x33, 0xcc,
    ])
  })

  test('imports raw pages and every page from another XTC book', async () => {
    const destinationBuffer = await buildXtcFromXtgPages([
      makeRawPage('XTG', 16, 8, 0x11),
    ])
    const destination = await inspectReplaceableXtc(new Blob([destinationBuffer]))
    const rawPage = makeRawPage('XTG', 16, 8, 0xaa)
    const importedBookBuffer = await buildXtcFromXtgPages([
      makeRawPage('XTG', 16, 8, 0xbb),
      makeRawPage('XTG', 16, 8, 0xcc),
    ])

    const rawImport = await importPagesForBook(
      new File([rawPage], 'single.xtg'),
      destination
    )
    const bookImport = await importPagesForBook(
      new File([importedBookBuffer], 'several.xtc'),
      destination
    )

    expect(rawImport).toHaveLength(1)
    expect(new Uint8Array(await rawImport[0].data.arrayBuffer())[22]).toBe(0xaa)
    expect(bookImport).toHaveLength(2)
    expect(await Promise.all(bookImport.map(async (page) =>
      new Uint8Array(await page.data.arrayBuffer())[22]
    ))).toEqual([0xbb, 0xcc])
  })

  test('uses original-book positions for multiple page-agnostic additions', async () => {
    const sourceBuffer = await buildXtcFromXtgPages([
      makeRawPage('XTG', 16, 8, 0x11),
      makeRawPage('XTG', 16, 8, 0x22),
      makeRawPage('XTG', 16, 8, 0x33),
      makeRawPage('XTG', 16, 8, 0x44),
    ])
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)

    const output = await createEditedXtcBlob(source, book, [
      {
        mode: 'add',
        pageNumber: 1,
        pages: [asImportedPage(makeRawPage('XTG', 16, 8, 0xaa))],
      },
      {
        mode: 'add',
        pageNumber: 3,
        pages: [asImportedPage(makeRawPage('XTG', 16, 8, 0xbb))],
      },
    ])
    const parsed = await parseXtcFile(await output.arrayBuffer())

    expect(parsed.pageData.map((page) => new Uint8Array(page)[22])).toEqual([
      0xaa, 0x11, 0x22, 0xbb, 0x33, 0x44,
    ])
  })

  test('rebuilds multi-page XTH edits and remaps replacement TOC ranges', async () => {
    const sourceBuffer = await buildXtcFromXtgPages([
      makeRawPage('XTH', 16, 8, 0x11),
      makeRawPage('XTH', 16, 8, 0x22),
      makeRawPage('XTH', 16, 8, 0x33),
    ], {
      is2bit: true,
      metadata: {
        toc: [
          { title: 'First', startPage: 1, endPage: 1 },
          { title: 'Second', startPage: 2, endPage: 3 },
        ],
      },
    })
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)

    const output = await createEditedXtcBlob(source, book, [{
      mode: 'replace',
      pageNumber: 2,
      pages: [
        asImportedPage(makeRawPage('XTH', 16, 8, 0xaa)),
        asImportedPage(makeRawPage('XTH', 16, 8, 0xbb)),
      ],
    }])
    const parsed = await parseXtcFile(await output.arrayBuffer())

    expect(parsed.header.is2bit).toBe(true)
    expect(parsed.pageData.map((page) => new Uint8Array(page)[22])).toEqual([
      0x11, 0xaa, 0xbb, 0x33,
    ])
    expect(parsed.metadata?.toc).toEqual([
      { title: 'First', startPage: 1, endPage: 1 },
      { title: 'Second', startPage: 2, endPage: 4 },
    ])
  })

  test('rejects invalid edit combinations before rebuilding the book', async () => {
    const sourceBuffer = await buildXtcFromXtgPages([
      makeRawPage('XTG', 16, 8, 0x11),
    ])
    const source = new Blob([sourceBuffer])
    const book = await inspectReplaceableXtc(source)
    const imported = asImportedPage(makeRawPage('XTG', 16, 8, 0xaa))

    await expect(createEditedXtcBlob(source, book, [
      { mode: 'add', pageNumber: 1, pages: [imported] },
      { mode: 'replace', pageNumber: 1, pages: [imported] },
    ])).rejects.toThrow('more than one queued edit')

    await expect(createEditedXtcBlob(source, book, [
      { mode: 'replace', pageNumber: 2, pages: [imported] },
    ])).rejects.toThrow('between 1 and 1')

    await expect(createEditedXtcBlob(source, book, [
      { mode: 'add', pageNumber: 1, pages: [] },
    ])).rejects.toThrow('does not contain any imported pages')

    await expect(createEditedXtcBlob(source, book, [
      {
        mode: 'add',
        pageNumber: 1,
        pages: [asImportedPage(makeRawPage('XTH', 16, 8, 0xaa))],
      },
    ])).rejects.toThrow('must be XTG')

    await expect(createEditedXtcBlob(source, book, [
      { mode: 'add', pageNumber: 1, pages: new Array(0xFFFF).fill(imported) },
    ])).rejects.toThrow('65,535 pages')
  })
})
