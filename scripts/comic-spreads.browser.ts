// With `bun run dev` running, execute in the browser console:
// await (await import('/scripts/comic-spreads.browser.ts')).checkComicSpreads()
import JSZip from 'jszip'
import { convertToXtc, type ConversionOptions } from '../src/lib/converter'
import { extractXtcPages, parseXtcFile } from '../src/lib/xtc-reader'
import { getTargetDimensions } from '../src/lib/processing/canvas'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function makeComic(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 1643
  canvas.height = 1201
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
    coverPortrait: true, pageOverview: 'none', contrast: 0, dithering: 'none',
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
      check(worker.metadata.toc[0].startPage === 2, 'Cover must remain one complete page')
      check(worker.metadata.toc[1].startPage === 2 + scenario.perSpread, 'TOC skipped/reordered spread sections')
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
