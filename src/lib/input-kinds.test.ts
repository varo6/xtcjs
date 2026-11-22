import { expect, test } from 'bun:test'
import { acceptsFile } from './input-kinds'

test('accepts each converter input by extension, ignoring case', () => {
  expect(acceptsFile('cbz', 'Vol 1.CBR')).toBe(true)
  expect(acceptsFile('cbz', 'vol1.cbz')).toBe(true)
  expect(acceptsFile('pdf', 'Paper.PDF')).toBe(true)
  expect(acceptsFile('image', 'cover.JPEG')).toBe(true)
  expect(acceptsFile('video', 'clip.mov')).toBe(true)
  expect(acceptsFile('xtc', 'book.xtch')).toBe(true)
})

test('rejects files from another converter', () => {
  expect(acceptsFile('cbz', 'paper.pdf')).toBe(false)
  expect(acceptsFile('pdf', 'vol1.cbz')).toBe(false)
  expect(acceptsFile('image', 'clip.mp4')).toBe(false)
})
