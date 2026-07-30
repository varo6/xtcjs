import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversionOptions } from '../lib/converter'
import { normalizeSplitModeForOrientation, Options } from './Options'

function renderPdfOptions(orientation: ConversionOptions['orientation']) {
  const options: ConversionOptions = {
    device: 'X4',
    splitMode: 'nosplit',
    pageOverview: 'none',
    dithering: 'atkinson',
    is2bit: false,
    contrast: 0,
    horizontalMargin: 0,
    verticalMargin: 0,
    orientation,
    coverPortrait: false,
    landscapeFlipClockwise: false,
    showProgressPreview: false,
    imageMode: 'letterbox',
    videoFps: 1,
  }

  return renderToStaticMarkup(<Options options={options} onChange={() => {}} fileType="pdf" />)
}

test('offers two-column paper splitting only in portrait PDF mode', () => {
  expect(renderPdfOptions('portrait')).toContain('Two-column paper (4 pages)')
  expect(renderPdfOptions('landscape')).not.toContain('Two-column paper (4 pages)')
})

test('clears portrait paper splitting when returning to landscape', () => {
  expect(normalizeSplitModeForOrientation('landscape', 'fourway')).toBe('overlap')
})
