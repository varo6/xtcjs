// With `bun run dev` running, execute in the browser console:
// await (await import('/scripts/comic-spreads.browser.ts')).checkComicSpreads()
import JSZip from 'jszip'
import { convertToXtc, type ConversionOptions } from '../src/lib/converter'
import { extractXtcPages, parseXtcFile } from '../src/lib/xtc-reader'
import { getTargetDimensions } from '../src/lib/processing/canvas'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function makeComic(portrait = false): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = portrait ? 1201 : 1643
  canvas.height = portrait ? 1643 : 1201
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'black'
  // Distinct quadrant densities let us check reading order after rotation/encoding.
  ctx.fillRect(821, 0, 822, 600)
  ctx.fillRect(821, 600, 411, 601)
  ctx.fillRect(0, 0, 205, 600)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')))
  })
  const zip = new JSZip()
  zip.file('001.png', blob)
  zip.file('002.png', blob)
  zip.file('003.png', blob)
  zip.file('ComicInfo.xml', '<ComicInfo><Title>Spread test</Title><Pages>' +
    '<Page Image="0" Type="FrontCover"/><Page Image="1" Bookmark="First spread"/>' +
    '<Page Image="2" Bookmark="Second spread"/></Pages></ComicInfo>')
  return new File([await zip.generateAsync({ type: 'blob' })], 'spread-test.cbz')
}

export async function checkComicSpreads() {
  const file = await makeComic()
  const base: ConversionOptions = {
    device: 'X4', orientation: 'landscape', splitMode: 'overlap', splitSpreads: true,
    coverPortrait: true, firstPageIsCover: true, pageOverview: 'none', contrast: 0, dithering: 'none',
    horizontalMargin: 0, verticalMargin: 0, is2bit: false,
    showProgressPreview: false, imageMode: 'letterbox', videoFps: 1,
  }
  const NativeWorker = window.Worker
  const NativeOffscreenCanvas = window.OffscreenCanvas
  let workersCreated = 0
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      workersCreated++
    }
  }
  const cases = [
    { name: 'thirds', options: {}, count: 13, perSpread: 6 },
    { name: 'halves', options: { splitMode: 'split' }, count: 9, perSpread: 4 },
    { name: 'keep spreads', options: { splitSpreads: false }, count: 3, perSpread: 1 },
    { name: 'no split', options: { splitMode: 'nosplit' }, count: 3, perSpread: 1 },
    { name: 'portrait', options: { orientation: 'portrait' }, count: 3, perSpread: 1 },
    { name: 'overview', options: { pageOverview: 'portrait' }, count: 15, perSpread: 7 },
    { name: 'clockwise', options: { landscapeFlipClockwise: true }, count: 13, perSpread: 6 },
    { name: 'X3', options: { device: 'X3' }, count: 13, perSpread: 6 },
    { name: 'Sticky', options: { device: 'Sticky' }, count: 13, perSpread: 6 },
    { name: 'XTCH', options: { is2bit: true }, count: 13, perSpread: 6 },
    { name: 'margins', options: { horizontalMargin: 1, verticalMargin: 2 }, count: 13, perSpread: 6 },
    { name: 'ignore PDF text setting', options: { avoidTextCuts: true }, count: 13, perSpread: 6 },
    { name: 'chapter thirds', options: { firstPageIsCover: false }, count: 18, perSpread: 6 },
    { name: 'chapter halves', options: { firstPageIsCover: false, splitMode: 'split' }, count: 12, perSpread: 4 },
    { name: 'chapter XTCH', options: { firstPageIsCover: false, is2bit: true }, count: 18, perSpread: 6 },
  ] satisfies Array<{ name: string; options: Partial<ConversionOptions>; count: number; perSpread: number }>
  const passed: string[] = []
  try {
    for (const scenario of cases) {
      const options = { ...base, ...scenario.options }
      const workerCountBefore = workersCreated
      const workerResult = await convertToXtc(file, 'cbz', options, () => {})
      check(workersCreated > workerCountBefore, 'Worker path was not exercised')
      const worker = await parseXtcFile(workerResult.data!)

      // Exercise the fallback used by browsers without OffscreenCanvas.
      Object.defineProperty(window, 'OffscreenCanvas', { value: undefined, configurable: true })
      const fallbackResult = await convertToXtc(file, 'cbz', options, () => {})
      Object.defineProperty(window, 'OffscreenCanvas', { value: NativeOffscreenCanvas, configurable: true })
      const fallback = await parseXtcFile(fallbackResult.data!)
      check(workerResult.pageCount === scenario.count, `${scenario.name}: wrong page count`)
      check(fallbackResult.pageCount === scenario.count, `${scenario.name}: fallback page count`)
      const { width, height } = getTargetDimensions(options.device)
      check(worker.entries.every(page => page.width === width && page.height === height), 'Wrong panel dimensions')
      const nextPage = options.firstPageIsCover ? 2 : 1 + scenario.perSpread
      check(worker.metadata.toc[0].startPage === nextPage, 'Incorrect first page crop count')
      check(worker.metadata.toc[1].startPage === nextPage + scenario.perSpread, 'TOC skipped/reordered spread sections')
      for (let i = 0; i < worker.pageData.length; i++) {
        const expected = new Uint8Array(worker.pageData[i])
        const actual = new Uint8Array(fallback.pageData[i])
        check(expected.length === actual.length && expected.every((v, n) => v === actual[n]),
          `${scenario.name}: worker/fallback differ at page ${i + 1}`)
      }
      if (scenario.name === 'halves') {
        const pages = await extractXtcPages(workerResult.data!)
        const density = pages.slice(1, 5).map(page => {
          const pixels = page.getContext('2d')!.getImageData(0, 0, page.width, page.height).data
          let black = 0
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0) black++
          return black / (page.width * page.height)
        })
        check(density[0] > density[1] && density[1] > density[2] && density[2] > density[3],
          'Expected right top, right bottom, left top, left bottom')
      }
      passed.push(scenario.name)
    }
  } finally {
    window.Worker = NativeWorker
    Object.defineProperty(window, 'OffscreenCanvas', { value: NativeOffscreenCanvas, configurable: true })
  }
  return { passed, workersCreated }
}

// Regression for #48: a chapter's first story page must split when cover handling is off.
export async function checkComicCoverHandling() {
  const file = await makeComic(true)
  const base: ConversionOptions = {
    device: 'X4', orientation: 'landscape', splitMode: 'overlap', splitSpreads: false,
    coverPortrait: true, firstPageIsCover: true, pageOverview: 'none', contrast: 0,
    dithering: 'none', horizontalMargin: 0, verticalMargin: 0, is2bit: false,
    showProgressPreview: false, imageMode: 'letterbox', videoFps: 1,
  }
  const NativeOffscreenCanvas = window.OffscreenCanvas
  const passed: string[] = []
  try {
    for (const fallback of [false, true]) {
      Object.defineProperty(window, 'OffscreenCanvas', {
        value: fallback ? undefined : NativeOffscreenCanvas, configurable: true,
      })
      for (const is2bit of [false, true]) {
        for (const [splitMode, count, nextPage] of [
          ['overlap', 9, 4], ['split', 6, 3], ['nosplit', 3, 2],
        ] as const) {
          const options = { ...base, is2bit, splitMode, firstPageIsCover: false }
          const result = await convertToXtc(file, 'cbz', options, () => {})
          const parsed = await parseXtcFile(result.data!)
          check(result.pageCount === count, `${splitMode}: first story page was not split`)
          check(parsed.metadata.toc[0].startPage === nextPage, 'TOC did not account for the first page crops')
          const portraitIgnored = await convertToXtc(file, 'cbz', { ...options, coverPortrait: false }, () => {})
          const comparison = await parseXtcFile(portraitIgnored.data!)
          for (let i = 0; i < parsed.pageData.length; i++) {
            const a = new Uint8Array(parsed.pageData[i]), b = new Uint8Array(comparison.pageData[i])
            check(a.length === b.length && a.every((value, index) => value === b[index]),
              'Cover portrait affected a story page while cover handling was off')
          }
          passed.push(`${fallback ? 'main' : 'worker'} ${is2bit ? 'XTCH' : 'XTC'} ${splitMode}`)
        }
        const preserved = await convertToXtc(file, 'cbz', { ...base, is2bit }, () => {})
        check(preserved.pageCount === 7, 'Default cover behaviour changed')
      }
      const lateCoverZip = await JSZip.loadAsync(file)
      lateCoverZip.file('ComicInfo.xml', '<ComicInfo><Title>Chapter order test</Title><Pages>' +
        '<Page Image="0" Bookmark="First story page"/><Page Image="1" Bookmark="Second story page"/>' +
        '<Page Image="2" Type="FrontCover"/></Pages></ComicInfo>')
      const lateCoverFile = new File([await lateCoverZip.generateAsync({ type: 'blob' })], 'chapter-order.cbz')
      for (const firstPageIsCover of [false, true]) {
        const result = await convertToXtc(lateCoverFile, 'cbz', { ...base, firstPageIsCover }, () => {})
        const parsed = await parseXtcFile(result.data!)
        check(parsed.metadata.toc[0].startPage === (firstPageIsCover ? 2 : 1),
          'Cover metadata changed the first story page order')
        check(parsed.metadata.toc[1].startPage === (firstPageIsCover ? 5 : 4),
          'Cover metadata changed the second story page order')
        passed.push(`${fallback ? 'main' : 'worker'} cover metadata ${firstPageIsCover ? 'on' : 'off'}`)
      }
    }
  } finally {
    Object.defineProperty(window, 'OffscreenCanvas', { value: NativeOffscreenCanvas, configurable: true })
  }
  return { passed }
}
