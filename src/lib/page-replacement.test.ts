import { describe, expect, test } from 'bun:test'
import { buildXtcFromXtgPages } from './xtc-format'
import { parseXtcFile } from './xtc-reader'
import {
  createReplacedXtcBlob,
  inspectReplaceableXtc,
  parseXtcRawPage,
  validateXtcPageReplacement,
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
})
