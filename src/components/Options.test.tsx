import { expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversionOptions } from '../lib/converter'
import { normalizeSplitModeForOrientation, Options, TARGET_DEVICES } from './Options'

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
  fileType: 'cbz' | 'pdf' | 'image' | 'video' = 'pdf',
  overrides: Partial<ConversionOptions> = {},
  advanced = false
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
    ...overrides,
  }

  // SSR cannot click the advanced toggle; start its local state expanded instead.
  const state = advanced ? spyOn(React, 'useState').mockReturnValueOnce([true, () => {}]) : undefined
  try {
    return renderToStaticMarkup(<Options options={options} onChange={() => {}} fileType={fileType} />)
  } finally {
    state?.mockRestore()
  }
}

test('disables cover orientation when PDF or manga cover handling is off', () => {
  for (const fileType of ['cbz', 'pdf'] as const) {
    const markup = renderPdfOptions('landscape', 'X4', false, fileType)
    expect(markup.match(/<input[^>]*id="coverPortrait"[^>]*>/)?.[0]).toContain('disabled')
  }
})

test('keeps cover orientation available for manga covers and PDFs', () => {
  for (const markup of [
    renderPdfOptions('landscape', 'X4', true, 'cbz'),
    renderPdfOptions('landscape', 'X4', true, 'pdf'),
  ]) {
    expect(markup.match(/<input[^>]*id="coverPortrait"[^>]*>/)?.[0]).not.toContain('disabled')
  }
})

test('offers first-page cover handling on by default in PDF and CBZ advanced settings', () => {
  for (const fileType of ['pdf', 'cbz'] as const) {
    const markup = renderPdfOptions('landscape', 'X4', true, fileType, {}, true)
    expect(markup.match(/<input[^>]*id="firstPageIsCover"[^>]*>/)?.[0]).toContain('checked')
    expect(markup).toContain('aria-describedby="first-page-cover-note"')
    expect(markup).toContain('id="first-page-cover-note"')
    expect(markup).toContain('first page is content')
  }
})

test('renders disabled cover handling as unchecked in PDF advanced settings', () => {
  const markup = renderPdfOptions('landscape', 'X4', false, 'pdf', {}, true)
  const checkbox = markup.match(/<input[^>]*id="firstPageIsCover"[^>]*>/)?.[0]
  expect(checkbox).toBeDefined()
  expect(checkbox).not.toContain('checked')
})

test('offers optional text-cut avoidance only in landscape overlapping PDF advanced settings', () => {
  const markup = renderPdfOptions('landscape', 'X4', true, 'pdf', { splitMode: 'overlap' }, true)
  const checkbox = markup.match(/<input[^>]*id="avoidTextCuts"[^>]*>/)?.[0]
  expect(checkbox).toBeDefined()
  expect(checkbox).not.toContain('checked')
  expect(checkbox).toContain('aria-describedby="avoid-text-cuts-note"')
  expect(markup).toContain('Avoid cutting text lines')
  expect(markup).toContain('id="avoid-text-cuts-note"')
  expect(markup).toContain('nearby gaps between text lines; no OCR')
  expect(markup).toContain('Keeps normal overlap if no safe gap is found')
})

test('reflects enabled text-cut avoidance in the PDF checkbox', () => {
  const markup = renderPdfOptions('landscape', 'X4', true, 'pdf', {
    splitMode: 'overlap', avoidTextCuts: true,
  }, true)
  expect(markup.match(/<input[^>]*id="avoidTextCuts"[^>]*>/)?.[0]).toContain('checked')
})

test('hides text-cut avoidance outside PDF landscape overlap or collapsed advanced settings', () => {
  for (const fileType of ['cbz', 'image', 'video'] as const) {
    expect(renderPdfOptions('landscape', 'X4', true, fileType, { splitMode: 'overlap' }, true))
      .not.toContain('id="avoidTextCuts"')
  }
  for (const splitMode of ['nosplit', 'split', 'fourway'] as const) {
    expect(renderPdfOptions('landscape', 'X4', true, 'pdf', { splitMode }, true))
      .not.toContain('id="avoidTextCuts"')
  }
  expect(renderPdfOptions('portrait', 'X4', true, 'pdf', { splitMode: 'overlap' }, true))
    .not.toContain('id="avoidTextCuts"')
  expect(renderPdfOptions('landscape', 'X4', true, 'pdf', { splitMode: 'overlap' }))
    .not.toContain('id="avoidTextCuts"')
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

  expect(TARGET_DEVICES.map(device => device.id)).toEqual(['X4', 'X3', 'Sticky'])
  for (const device of TARGET_DEVICES) {
    expect(markup).toContain(`[${device.label}]`)
    expect(markup).toContain(device.size)
  }
  expect(markup).toContain('480 × 800')
  expect(markup).toContain('528 × 792')
})

test('renders the target devices in one labelled dropdown', () => {
  const markup = renderPdfOptions('portrait')
  const select = deviceSelectMarkup(markup)

  expect(select.match(/<option/g)?.length).toBe(TARGET_DEVICES.length)
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

  expect(deviceSelectTag(stickyMarkup)).toContain('aria-describedby="device-notice-sticky"')
  expect(stickyMarkup).toContain('id="device-notice-sticky"')
  expect(stickyMarkup).toContain('aria-live="polite"')
})

test('keeps the live region mounted but drops the notice reference when unselected', () => {
  const x4Markup = renderPdfOptions('portrait', 'X4')

  // The live region has to stay in the DOM for the notice to be announced when
  // Sticky is picked, but aria-describedby must not point at a missing element.
  expect(x4Markup).toContain('aria-live="polite"')
  expect(x4Markup).not.toContain('id="device-notice-sticky"')
  expect(x4Markup).not.toContain('aria-describedby')
})
