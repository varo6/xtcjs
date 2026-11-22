import { expect, test } from 'bun:test'
import { getPdfJsWasmUrl } from './pdfjs'

test('loads PDF.js image decoders from dependencies during development', () => {
  expect(getPdfJsWasmUrl(true, '/')).toBe('/node_modules/pdfjs-dist/wasm/')
  expect(getPdfJsWasmUrl(false, '/')).toBe('/pdfjs/wasm/')
})

test('keeps production decoder assets under the configured app base', () => {
  expect(getPdfJsWasmUrl(false, '/xtcjs/')).toBe('/xtcjs/pdfjs/wasm/')
})
