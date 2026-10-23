// With bun run dev: await (await import('/scripts/pdf-strips.browser.ts')).checkPdfStrips()
import { PDFDocument } from 'pdf-lib'
import { convertToXtc, type ConversionOptions } from '../src/lib/converter'
import { extractXtcPages, parseXtcFile } from '../src/lib/xtc-reader'
import { getTargetDimensions } from '../src/lib/processing/canvas'
import { loadPdfDocument } from '../src/lib/pdfjs'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function makeScannedBookPdf(edgeTest = false): Promise<File> {
  const pdf = await PDFDocument.create()
  for (let page = 0; page < (edgeTest ? 1 : 3); page++) {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 900
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 600, 900)
    ctx.fillStyle = 'black'
    ctx.font = '14px sans-serif'
    if (edgeTest) {
      for (const top of [264, 354, 534, 624]) ctx.fillRect(100, top, 400, 12)
      ctx.fillText('Turkish: \u00c7a\u011fr\u0131, \u0131\u015f\u0131k, \u0130, \u015f, \u011f, \u00f6, \u00fc, \u00e7', 100, 200)
    } else {
      for (let row = 14; row < 890; row += 20) {
        const strip = Math.floor(row / 300)
        const density = page * 0.25 + (strip + 1) * 0.05
        ctx.fillRect(0, row, Math.round(600 * density), 12)
      }
      ctx.fillText(`Page ${page + 1} - scanned image`, 410, 100)
      ctx.fillText('Turkish: \u00c7a\u011fr\u0131, \u0131\u015f\u0131k, \u0130, \u015f, \u011f', 410, 150)
    }
    const image = await pdf.embedPng(canvas.toDataURL('image/png'))
    pdf.addPage([600, 900]).drawImage(image, { x: 0, y: 0, width: 600, height: 900 })
  }
  const bytes = await pdf.save()
  return new File([new Uint8Array(bytes)], edgeTest ? 'scan-line-edges.pdf' : 'scanned-reading-order.pdf', { type: 'application/pdf' })
}

const base: ConversionOptions = {
  device: 'X4', orientation: 'landscape', splitMode: 'overlap', splitSpreads: false,
  firstPageIsCover: false, coverPortrait: false, avoidTextCuts: false,
  pageOverview: 'none', dithering: 'none', is2bit: false, contrast: 0,
  horizontalMargin: 0, verticalMargin: 0, landscapeFlipClockwise: false,
  showProgressPreview: false, imageMode: 'letterbox', videoFps: 1,
}

async function samePixels(a: ArrayBuffer, b: ArrayBuffer) {
  const aa = (await parseXtcFile(a)).pageData
  const bb = (await parseXtcFile(b)).pageData
  return aa.length === bb.length && aa.every((page, index) => {
    const x = new Uint8Array(page), y = new Uint8Array(bb[index])
    return x.length === y.length && x.every((value, i) => value === y[i])
  })
}

export async function checkPdfStrips() {
  const file = await makeScannedBookPdf()
  const doc = await loadPdfDocument(await file.arrayBuffer())
  for (let i = 1; i <= doc.numPages; i++) {
    check((await (await doc.getPage(i)).getTextContent()).items.length === 0, 'Fixture must contain only scanned images')
  }
  await doc.destroy()
  const passed: string[] = []
  for (const scenario of [
    { name: 'normal thirds', options: {} },
    { name: 'line-aware thirds', options: { avoidTextCuts: true } },
    { name: 'line-aware XTCH', options: { avoidTextCuts: true, is2bit: true } },
    { name: 'clockwise strips', options: { avoidTextCuts: true, landscapeFlipClockwise: true } },
    { name: 'X3 strips', options: { avoidTextCuts: true, device: 'X3' } },
    { name: 'Sticky strips', options: { avoidTextCuts: true, device: 'Sticky' } },
  ] satisfies Array<{ name: string; options: Partial<ConversionOptions> }>) {
    const options = { ...base, ...scenario.options }
    const result = await convertToXtc(file, 'pdf', options, () => {})
    const pages = await extractXtcPages(result.data!)
    const { width, height } = getTargetDimensions(options.device)
    check(pages.length === 9, `${scenario.name}: expected three strips per source page`)
    check(pages.every(page => page.width === width && page.height === height), 'Wrong panel dimensions')
    const densities = pages.map(canvas => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let dark = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128) dark++
      return dark / (canvas.width * canvas.height)
    })
    check(densities.every((value, i) => i === 0 || value > densities[i - 1]),
      `${scenario.name}: expected page 1 top/middle/bottom, then page 2, then page 3`)
    check(result.pageImages!.length < result.pageCount!, 'Fixture must exercise sampled previews')
    passed.push(scenario.name)
  }

  const preserved = await convertToXtc(file, 'pdf', { ...base, firstPageIsCover: true }, () => {})
  check(preserved.pageCount === 7, 'Default full-cover handling changed')
  passed.push('default cover preserved')
  for (const layout of [
    { splitMode: 'split', orientation: 'landscape' },
    { splitMode: 'nosplit', orientation: 'landscape' },
    { splitMode: 'fourway', orientation: 'portrait' },
  ] as const) {
    const options = { ...base, ...layout }
    const plain = await convertToXtc(file, 'pdf', options, () => {})
    const enabled = await convertToXtc(file, 'pdf', { ...options, avoidTextCuts: true }, () => {})
    check(await samePixels(plain.data!, enabled.data!), 'Text option affected an unsupported layout')
    passed.push(`unchanged ${layout.orientation} ${layout.splitMode}`)
  }

  const edges = await makeScannedBookPdf(true)
  for (const landscapeFlipClockwise of [false, true]) {
    const plain = await convertToXtc(edges, 'pdf', { ...base, landscapeFlipClockwise }, () => {})
    const aligned = await convertToXtc(edges, 'pdf', { ...base, landscapeFlipClockwise, avoidTextCuts: true }, () => {})
    const edgeInk = async (buffer: ArrayBuffer) => (await extractXtcPages(buffer)).reduce((sum, page) => {
      const pixels = page.getContext('2d')!.getImageData(0, 0, page.width, page.height).data
      for (let y = 100; y < page.height - 100; y++) {
        if (pixels[(y * page.width) * 4] < 128) sum++
        if (pixels[(y * page.width + page.width - 1) * 4] < 128) sum++
      }
      return sum
    }, 0)
    check(await edgeInk(plain.data!) > 0, 'Fixture did not reproduce cut text at strip edges')
    check(await edgeInk(aligned.data!) === 0, 'Aligned crops still cut through the text bands')
    passed.push(`complete text bands ${landscapeFlipClockwise ? 'clockwise' : 'counterclockwise'}`)
  }
  return { passed }
}
