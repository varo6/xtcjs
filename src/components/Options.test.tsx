import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversionOptions } from '../lib/converter'
import { normalizeSplitModeForOrientation, Options } from './Options'
import { DEVICE_IDS, DEVICES } from '../lib/devices'

function deviceSelectTag(markup: string) {
  const tag = markup.match(/<select[^>]*id="targetDevice"[^>]*>/)
  if (!tag) throw new Error('no target device select rendered')
  return tag[0]
}

function deviceSelectMarkup(markup: string) {
  const select = markup.match(/<select[^>]*id="targetDevice"[\s\S]*?<\/select>/)
  if (!select) throw new Error('no target device select rendered')
  return select[0]
}

function renderPdfOptions(
  orientation: ConversionOptions['orientation'],
  device: ConversionOptions['device'] = 'X4',
  firstPageIsCover = true,
  fileType: 'cbz' | 'pdf' = 'pdf'
) {
  const options: ConversionOptions = {
    device,
    splitMode: 'nosplit',
    splitSpreads: false,
    pageOverview: 'none',
    dithering: 'atkinson',
    is2bit: false,
    contrast: 0,
    horizontalMargin: 0,
    verticalMargin: 0,
    orientation,
    firstPageIsCover,
    coverPortrait: false,
    landscapeFlipClockwise: false,
    showProgressPreview: false,
    imageMode: 'letterbox',
    videoFps: 1,
  }

  return renderToStaticMarkup(<Options options={options} onChange={() => {}} fileType={fileType} />)
}

test('disables cover orientation when manga cover handling is off', () => {
  const markup = renderPdfOptions('landscape', 'X4', false, 'cbz')
  expect(markup.match(/<input[^>]*id="coverPortrait"[^>]*>/)?.[0]).toContain('disabled')
})

test('keeps cover orientation available for manga covers and PDFs', () => {
  for (const markup of [
    renderPdfOptions('landscape', 'X4', true, 'cbz'),
    renderPdfOptions('landscape', 'X4', false, 'pdf'),
  ]) {
    expect(markup.match(/<input[^>]*id="coverPortrait"[^>]*>/)?.[0]).not.toContain('disabled')
  }
})

test('offers two-column paper splitting only in portrait PDF mode', () => {
  expect(renderPdfOptions('portrait')).toContain('Two-column paper (4 pages)')
  expect(renderPdfOptions('landscape')).not.toContain('Two-column paper (4 pages)')
})

test('clears portrait paper splitting when returning to landscape', () => {
  expect(normalizeSplitModeForOrientation('landscape', 'fourway')).toBe('overlap')
})

test('offers Sticky as a target device', () => {
  expect(renderPdfOptions('portrait')).toContain('[Sticky]')
})

test('labels every target device with its panel size', () => {
  const markup = renderPdfOptions('portrait')

  expect(DEVICE_IDS).toEqual(['X4', 'X3', 'Sticky'])
  for (const id of DEVICE_IDS) {
    expect(markup).toContain(`[${DEVICES[id].label}]`)
  }
  expect(markup).toContain('480 × 800')
  expect(markup).toContain('528 × 792')
})

test('renders the target devices in one labelled dropdown', () => {
  const markup = renderPdfOptions('portrait')
  const select = deviceSelectMarkup(markup)

  expect(select.match(/<option/g)?.length).toBe(DEVICE_IDS.length)
  expect(deviceSelectTag(markup)).toContain('aria-label="Target device"')
})

test('selects X4 by default and allows X3 or Sticky', () => {
  const x4Markup = renderPdfOptions('portrait')
  const x3Markup = renderPdfOptions('portrait', 'X3')
  const stickyMarkup = renderPdfOptions('portrait', 'Sticky')

  expect(x4Markup).toContain('<option value="X4" selected="">')
  expect(x3Markup).toContain('<option value="X3" selected="">')
  expect(stickyMarkup).toContain('<option value="Sticky" selected="">')
})

test('warns that the Sticky target requires CrossPoint Reader', () => {
  const stickyMarkup = renderPdfOptions('portrait', 'Sticky')
  expect(stickyMarkup).toContain('Requires CrossPoint Reader firmware')
  expect(stickyMarkup).toContain('Not compatible with the original Seeed firmware')
  expect(renderPdfOptions('portrait', 'X4')).not.toContain('Requires CrossPoint Reader firmware')
})

test('links the Sticky firmware notice to the dropdown for screen readers', () => {
  const stickyMarkup = renderPdfOptions('portrait', 'Sticky')

  const describedBy = deviceSelectTag(stickyMarkup).match(/aria-describedby="([^"]+)"/)?.[1]

  expect(describedBy).toBeDefined()
  expect(stickyMarkup).toMatch(new RegExp(`id="${describedBy}"[^>]*>[\\s\\S]*Requires CrossPoint Reader firmware`))
  expect(stickyMarkup).toContain('aria-live="polite"')
})

test('keeps the live region mounted but drops the notice reference when unselected', () => {
  const x4Markup = renderPdfOptions('portrait', 'X4')

  // The live region has to stay in the DOM for the notice to be announced when
  // Sticky is picked, but aria-describedby must not point at a missing element.
  expect(x4Markup).toContain('aria-live="polite"')
  expect(x4Markup).not.toContain('Requires CrossPoint Reader firmware')
  expect(x4Markup).not.toContain('aria-describedby')
})
