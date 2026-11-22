import { expect, test } from 'bun:test'
import { detectFileType, mergeFiles, validateSameType } from './merge'
import { getPageCount, splitFile } from './split'
import { buildXtcFromBuffers } from './xtc-format'
import { parseXtcFile } from './xtc-reader'
import type { BookMetadata } from './metadata/types'

function page(is2bit: boolean, value: number, width = 8, height = 8) {
  const size = is2bit ? Math.ceil(height / 8) * width * 2 : Math.ceil(width / 8) * height
  const data = new ArrayBuffer(22 + size)
  const bytes = new Uint8Array(data)
  bytes.set([88, 84, is2bit ? 72 : 71, 0])
  const view = new DataView(data)
  view.setUint16(4, width, true)
  view.setUint16(6, height, true)
  view.setUint32(10, size, true)
  bytes.fill(value, 22)
  return data
}

async function book(name: string, values: number[], is2bit = true, metadata?: BookMetadata, width = 8, height = 8) {
  const pages = values.map(value => page(is2bit, value, width, height))
  const data = await buildXtcFromBuffers(pages, { is2bit, metadata })
  return { file: new File([data], name), pages }
}

test('recognizes XTCH case-insensitively and rejects unsupported comic formats', () => {
  expect(detectFileType(new File([], 'chapter.XTCH'))).toBe('xtch')
  expect(detectFileType(new File([], 'chapter.xtc'))).toBe('xtc')
  expect(detectFileType(new File([], 'chapter.cbr'))).toBe('unknown')
  expect(validateSameType([new File([], 'a.xtch'), new File([], 'b.XTCH')]).valid).toBe(true)
})

test('reads XTCH page counts and merges pages without changing bit depth or bytes', async () => {
  const a = await book('c001.xtch', [17, 34])
  const b = await book('c002.XTCH', [51])
  expect(await getPageCount(a.file)).toBe(2)
  const result = await mergeFiles([a.file, b.file], 'xtc', () => {})
  const parsed = await parseXtcFile(result.data)
  expect(result.name).toBe('merged.xtch')
  expect(parsed.header.is2bit).toBe(true)
  expect(parsed.header.pageCount).toBe(3)
  expect(parsed.pageData.map(data => new Uint8Array(data))).toEqual(
    [...a.pages, ...b.pages].map(data => new Uint8Array(data)),
  )
})

test('reads the page count without loading the whole reader file', async () => {
  const source = await book('large.xtch', [17, 34])
  class HeaderOnlyFile extends File {
    override arrayBuffer(): Promise<ArrayBuffer> {
      throw new Error('Reading the entire book is unnecessary for its page count')
    }
  }
  const file = new HeaderOnlyFile([await source.file.arrayBuffer()], 'large.xtch')
  expect(await getPageCount(file)).toBe(2)
})

test('uses actual native page dimensions for both XTC and XTCH', async () => {
  for (const is2bit of [false, true]) {
    const ext = is2bit ? 'xtch' : 'xtc'
    const source = await book('x3.' + ext, [85], is2bit, undefined, 528, 792)
    const merged = await mergeFiles([source.file, source.file], 'xtc', () => {})
    const parsed = await parseXtcFile(merged.data)
    expect(parsed.header.is2bit).toBe(is2bit)
    expect(parsed.entries.map(({ width, height }) => [width, height])).toEqual([[528, 792], [528, 792]])
    const [part] = await splitFile(new File([merged.data], merged.name), [{ start: 2, end: 2 }], 'xtc', () => {})
    expect(part.name).toBe('merged_part1.' + ext)
    expect((await parseXtcFile(part.data)).entries[0]).toMatchObject({ width: 528, height: 792 })
  }
})

test('creates one chapter per file using listed order and cumulative page counts', async () => {
  const a = await book('Ch\u01b0\u01a1ng 10.XTCH', [17, 34])
  const b = await book('Ch\u01b0\u01a1ng 2.xtch', [51, 68, 85])
  const result = await mergeFiles([a.file, b.file], 'xtc', () => {}, true)
  const parsed = await parseXtcFile(result.data)
  expect(parsed.metadata?.toc).toEqual([
    { title: 'Ch\u01b0\u01a1ng 10', startPage: 1, endPage: 2 },
    { title: 'Ch\u01b0\u01a1ng 2', startPage: 3, endPage: 5 },
  ])
  const view = new DataView(result.data)
  const tocOffset = Number(view.getBigUint64(48, true))
  expect(view.getUint8(11)).toBe(1)
  expect(view.getUint16(tocOffset + 80, true)).toBe(1)
  expect(view.getUint16(tocOffset + 96 + 80, true)).toBe(3)
  expect(parsed.pageData.map(data => new Uint8Array(data))).toEqual(
    [...a.pages, ...b.pages].map(data => new Uint8Array(data)),
  )
})

test('preserves existing chapter lists, title and author by default', async () => {
  const a = await book('a.xtch', [17, 34], true, {
    title: 'Volume', author: 'Author', toc: [{ title: 'First', startPage: 1, endPage: 2 }],
  })
  const b = await book('b.xtch', [51, 68, 85], true, {
    toc: [{ title: 'Second', startPage: 1, endPage: 1 }, { title: 'Third', startPage: 2, endPage: 3 }],
  })
  const result = await mergeFiles([a.file, b.file], 'xtc', () => {})
  const parsed = await parseXtcFile(result.data)
  expect(parsed.metadata).toMatchObject({ title: 'Volume', author: 'Author', toc: [
    { title: 'First', startPage: 1, endPage: 2 },
    { title: 'Second', startPage: 3, endPage: 3 },
    { title: 'Third', startPage: 4, endPage: 5 },
  ] })
})

test('clips and rebases chapters when splitting XTCH without changing page bytes', async () => {
  const source = await book('volume.xtch', [17, 34, 51, 68, 85], true, {
    title: 'Volume', author: 'Author', toc: [
      { title: 'First', startPage: 1, endPage: 2 },
      { title: 'Second', startPage: 3, endPage: 5 },
    ],
  })
  const [part] = await splitFile(source.file, [{ start: 2, end: 4 }], 'xtc', () => {})
  const parsed = await parseXtcFile(part.data)
  expect(part.name).toBe('volume_part1.xtch')
  expect(parsed.header.is2bit).toBe(true)
  expect(parsed.metadata).toMatchObject({ title: 'Volume', author: 'Author', toc: [
    { title: 'First', startPage: 1, endPage: 1 },
    { title: 'Second', startPage: 2, endPage: 3 },
  ] })
  expect(parsed.pageData.map(data => new Uint8Array(data))).toEqual(
    source.pages.slice(1, 4).map(data => new Uint8Array(data)),
  )
})

test('rejects mixed bit depths, including misleading file extensions', async () => {
  const mono = await book('a.xtc', [0], false)
  const grey = await book('b.xtc', [0], true)
  await expect(mergeFiles([mono.file, grey.file], 'xtc', () => {})).rejects.toThrow(/XTC.*XTCH|bit depth/i)
})

test('rejects overflowing page counts instead of writing a truncated header', async () => {
  await expect(buildXtcFromBuffers(Array(65536).fill(page(false, 0)))).rejects.toThrow(/65535/)
})

test('does not split a multi-byte chapter title at the format byte limit', async () => {
  const source = await book('a.xtch', [0], true, {
    toc: [{ title: 'a'.repeat(78) + '\u00e9', startPage: 1, endPage: 1 }],
  })
  expect((await parseXtcFile(await source.file.arrayBuffer())).metadata?.toc[0].title).toBe('a'.repeat(78))
})

test('drops chapters outside a split range and handles legacy first-page fields', async () => {
  const source = await book('volume.xtch', [17, 34, 51], true, { toc: [
    { title: 'First', startPage: 0, endPage: 0 },
    { title: 'Rest', startPage: 2, endPage: 65535 },
  ] })
  const [first, rest] = await splitFile(source.file, [{ start: 1, end: 1 }, { start: 2, end: 3 }], 'xtc', () => {})
  expect((await parseXtcFile(first.data)).metadata?.toc).toEqual([{ title: 'First', startPage: 1, endPage: 1 }])
  expect((await parseXtcFile(rest.data)).metadata?.toc).toEqual([{ title: 'Rest', startPage: 1, endPage: 2 }])
})

test('rejects invalid split ranges instead of silently slicing the wrong pages', async () => {
  const source = await book('a.xtch', [0])
  for (const range of [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 1.5, end: 1.5 }]) {
    await expect(splitFile(source.file, [range], 'xtc', () => {})).rejects.toThrow(/Invalid page range/)
  }
})

test('rejects mismatched or truncated encoded pages', async () => {
  await expect(buildXtcFromBuffers([page(true, 0)])).rejects.toThrow(/bit depth/)
  await expect(buildXtcFromBuffers([new ArrayBuffer(8)])).rejects.toThrow(/bit depth/)
  const broken = page(false, 0).slice(0, 22)
  await expect(buildXtcFromBuffers([broken])).rejects.toThrow(/page data|payload/i)
})

test('rejects overflowing chapter counts instead of losing the bookmark list', async () => {
  await expect(buildXtcFromBuffers([page(false, 0)], { metadata: {
    toc: Array(65536).fill({ title: 'Chapter', startPage: 1, endPage: 1 }),
  } })).rejects.toThrow(/65535/)
})

test('does not expose page-index bytes as phantom chapters when a split has no bookmarks', async () => {
  const source = await book('volume.xtch', Array(8).fill(0), true, {
    title: 'Volume', toc: [{ title: 'Last page', startPage: 8, endPage: 8 }],
  })
  const [part] = await splitFile(source.file, [{ start: 1, end: 7 }], 'xtc', () => {})
  const parsed = await parseXtcFile(part.data)
  const view = new DataView(part.data)
  expect(parsed.metadata?.title).toBe('Volume')
  expect(parsed.metadata?.toc).toEqual([])
  expect(view.getUint8(9)).toBe(1)
  expect(view.getUint8(11)).toBe(0)
  expect(view.getBigUint64(48, true)).toBe(0n)
})

test('preserves complete raw pages with unset legacy payload-size fields', async () => {
  for (const is2bit of [false, true]) {
    const raw = page(is2bit, 85)
    new DataView(raw).setUint32(10, 0, true)
    const data = await buildXtcFromBuffers([raw], { is2bit })
    expect(new Uint8Array((await parseXtcFile(data)).pageData[0])).toEqual(new Uint8Array(raw))
  }
})
