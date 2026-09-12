import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { init } from '@jsquash/jxl/decode.js'
import JSZip from 'jszip'
import { decodeJxlBlob, isComicImagePath, isJxlPath } from './image-codec'
import { getPageCount } from './split'

async function jxlCbz(): Promise<File> {
  const zip = new JSZip()
  zip.file('001.jxl', await readFile(new URL('./fixtures/test.jxl', import.meta.url)))
  return Object.assign(await zip.generateAsync({ type: 'uint8array' }), {
    name: 'book.cbz',
  }) as unknown as File
}

test('recognizes JPEG XL pages in comic archives', () => {
  expect(isComicImagePath('pages/001.jxl')).toBe(true)
  expect(isComicImagePath('pages/002.JXL')).toBe(true)
  expect(isComicImagePath('ComicInfo.xml')).toBe(false)
  expect(isJxlPath('pages/COVER.JXL')).toBe(true)
  expect(isJxlPath('pages/cover.jpg')).toBe(false)
})

test('decodes a JPEG XL page', async () => {
  const decoderUrl = import.meta.resolve('@jsquash/jxl/decode.js')
  const wasm = await WebAssembly.compile(await readFile(new URL('./codec/dec/jxl_dec.wasm', decoderUrl)))
  await init(wasm)

  const file = await readFile(new URL('./fixtures/test.jxl', import.meta.url))
  const image = await decodeJxlBlob(new Blob([file]))

  expect(image.width).toBe(50)
  expect(image.height).toBe(50)
  expect(image.data).toHaveLength(50 * 50 * 4)
})

test('counts JPEG XL pages when splitting a CBZ', async () => {
  expect(await getPageCount(await jxlCbz())).toBe(1)
})
