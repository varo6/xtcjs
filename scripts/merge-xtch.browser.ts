// With bun run dev: await (await import('/scripts/merge-xtch.browser.ts')).checkXtchMerge()
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { mergeFiles } from '../src/lib/merge'
import { splitFile } from '../src/lib/split'
import { buildXtcFromBuffers } from '../src/lib/xtc-format'
import { parseXtcFile } from '../src/lib/xtc-reader'
import { imageDataToXtg, imageDataToXth } from '../src/lib/processing/xtg'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function makeReaderBook(name: string, count: number, is2bit = true, seed = 0) {
  const pages: ArrayBuffer[] = []
  const images: ImageData[] = []
  for (let i = 0; i < count; i++) {
    const image = new ImageData(32, 24)
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4
        const level = ((Math.floor(x / 8) + i + seed) % 4) * 85
        const grey = is2bit ? level : level >= 128 ? 255 : 0
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = grey
        image.data[offset + 3] = 255
      }
    }
    pages.push(is2bit ? imageDataToXth(image) : imageDataToXtg(image))
    images.push(image)
  }
  const data = await buildXtcFromBuffers(pages, {
    is2bit, metadata: { title: 'Test volume', author: 'Test author',
      toc: [{ title: 'Original chapter', startPage: 1, endPage: count }] },
  })
  return { file: new File([data], name), pages, images }
}

async function checkPngExport(data: ArrayBuffer, expected: ImageData[]) {
  const zip = await JSZip.loadAsync(data)
  const entries = Object.keys(zip.files).filter(name => name.endsWith('.png')).sort()
  check(entries.length === expected.length, 'Wrong number of exported PNG pages')
  for (let i = 0; i < entries.length; i++) {
    const blob = await zip.file(entries[i])!.async('blob')
    const bitmap = await createImageBitmap(blob)
    const actual = document.createElement('canvas')
    actual.width = bitmap.width
    actual.height = bitmap.height
    actual.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const a = actual.getContext('2d')!.getImageData(0, 0, actual.width, actual.height).data
    const b = expected[i].data
    check(actual.width === expected[i].width && actual.height === expected[i].height, 'PNG dimensions changed')
    check(a.length === b.length && a.every((value, index) => value === b[index]), 'PNG export changed grayscale values or page order')
    actual.width = actual.height = 0
  }
}

export async function checkXtchMerge() {
  const passed: string[] = []
  const a = await makeReaderBook('Chapter 01.xtch', 2)
  const b = await makeReaderBook('Chapter 02.XTCH', 3, true, 1)
  const merged = await mergeFiles([a.file, b.file], 'xtc', () => {}, true)
  const parsed = await parseXtcFile(merged.data)
  check(merged.name === 'merged.xtch' && parsed.header.is2bit, 'XTCH format was not preserved')
  check(parsed.metadata?.toc[1].startPage === 3 && parsed.metadata.toc[1].endPage === 5, 'Wrong generated chapter boundaries')
  passed.push('XTCH merge with chapter boundaries')

  const cbz = await mergeFiles([a.file, b.file], 'cbz', () => {})
  await checkPngExport(cbz.data, [...a.images, ...b.images])
  passed.push('XTCH to CBZ preserves all four grayscale levels')
  const [part] = await splitFile(new File([merged.data], merged.name), [{ start: 2, end: 4 }], 'cbz', () => {})
  await checkPngExport(part.data, [a.images[1], b.images[0], b.images[1]])
  passed.push('XTCH split to CBZ preserves grayscale and order')

  const mono = await makeReaderBook('Chapter 01.xtc', 2, false)
  const monoCbz = await mergeFiles([mono.file, mono.file], 'cbz', () => {})
  await checkPngExport(monoCbz.data, [...mono.images, ...mono.images])
  passed.push('XTC export remains monochrome')

  for (const source of [mono, a]) {
    const pages = source.pages.map(page => {
      const copy = page.slice(0)
      new DataView(copy).setUint32(10, 0, true)
      return copy
    })
    const is2bit = source === a
    const data = await buildXtcFromBuffers(pages, { is2bit })
    const legacy = new File([data], is2bit ? 'legacy.xtch' : 'legacy.xtc')
    const exported = await mergeFiles([legacy, legacy], 'cbz', () => {})
    await checkPngExport(exported.data, [...source.images, ...source.images])
    passed.push(`legacy ${is2bit ? 'XTCH' : 'XTC'} size fields`)
  }

  const png = await (await JSZip.loadAsync(cbz.data)).file('00001.png')!.async('uint8array')
  const inputZip = new JSZip()
  inputZip.file('001.png', png)
  const comic = new File([await inputZip.generateAsync({ type: 'blob' })], 'chapter.cbz')
  const comicMerge = await mergeFiles([comic, comic], 'cbz', () => {})
  check(comicMerge.pageCount === 2, 'CBZ merging regressed')
  const [comicPart] = await splitFile(new File([comicMerge.data], comicMerge.name), [{ start: 2, end: 2 }], 'cbz', () => {})
  check(comicPart.pageCount === 1, 'CBZ splitting regressed')
  passed.push('CBZ merge and split unchanged')

  const pdf = await PDFDocument.create()
  pdf.addPage([100, 150])
  const pdfFile = new File([new Uint8Array(await pdf.save())], 'chapter.pdf')
  const pdfMerge = await mergeFiles([pdfFile, pdfFile], 'pdf', () => {})
  const [pdfPart] = await splitFile(new File([pdfMerge.data], pdfMerge.name), [{ start: 2, end: 2 }], 'pdf', () => {})
  check(pdfMerge.pageCount === 2 && (await PDFDocument.load(pdfPart.data)).getPageCount() === 1, 'PDF merge/split regressed')
  passed.push('PDF merge and split unchanged')
  return { passed }
}
