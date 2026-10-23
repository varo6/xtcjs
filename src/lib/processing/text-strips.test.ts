import { expect, test } from 'bun:test'
import { alignStripBoundaries } from './text-strips'

const strips = [
  { x: 0, y: 0, w: 600, h: 90 },
  { x: 0, y: 60, w: 600, h: 90 },
  { x: 0, y: 120, w: 600, h: 90 },
]

function scan(background = 255) {
  const data = new Uint8ClampedArray(100 * 210 * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = background
    data[i + 3] = 255
  }
  return { width: 100, height: 210, data }
}

function ink(image: ReturnType<typeof scan>, top: number, bottom: number) {
  for (let y = top; y < bottom; y++) {
    for (let x = 20; x < 80; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0
    }
  }
}

test('moves strip edges outward to include complete text lines', () => {
  const image = scan()
  for (const [top, bottom] of [[58, 64], [85, 95], [118, 126], [145, 155]]) ink(image, top, bottom)
  const actual = alignStripBoundaries(image, strips)
  expect(actual[0].y + actual[0].h).toBeGreaterThanOrEqual(95)
  expect(actual[1].y).toBeLessThanOrEqual(58)
  expect(actual[1].y + actual[1].h).toBeGreaterThanOrEqual(155)
  expect(actual[2].y).toBeLessThanOrEqual(118)
})

test('preserves reading order, overlap, page edges and every original crop pixel', () => {
  const image = scan()
  ink(image, 85, 95)
  const original = structuredClone(strips)
  const pixels = image.data.slice()
  const actual = alignStripBoundaries(image, strips)
  expect(actual).toHaveLength(3)
  expect(actual[0].y).toBe(0)
  expect(actual[2].y + actual[2].h).toBe(210)
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].x).toBe(0)
    expect(actual[i].w).toBe(600)
    expect(actual[i].y).toBeLessThanOrEqual(strips[i].y)
    expect(actual[i].y + actual[i].h).toBeGreaterThanOrEqual(strips[i].y + strips[i].h)
    if (i > 0) {
      expect(actual[i].y).toBeGreaterThanOrEqual(actual[i - 1].y)
      expect(actual[i].y).toBeLessThanOrEqual(actual[i - 1].y + actual[i - 1].h)
    }
  }
  expect(strips).toEqual(original)
  expect(image.data).toEqual(pixels)
})

test('keeps diacritics with their text line instead of cutting the small gap between them', () => {
  const image = scan()
  ink(image, 82, 83)
  ink(image, 86, 90)
  const actual = alignStripBoundaries(image, [
    { x: 0, y: 0, w: 600, h: 85 },
    { x: 0, y: 85, w: 600, h: 125 },
  ])
  expect(actual[0].h).toBeGreaterThanOrEqual(90)
  expect(actual[1].y).toBeLessThanOrEqual(82)
})

test('leaves blank and plain grey paper unchanged', () => {
  expect(alignStripBoundaries(scan(), strips)).toEqual(strips)
  expect(alignStripBoundaries(scan(195), strips)).toEqual(strips)
})

test('recognizes text on grey scanned paper', () => {
  const image = scan(195)
  ink(image, 85, 95)
  expect(alignStripBoundaries(image, strips)[0].h).toBeGreaterThanOrEqual(95)
})

test('falls back to the original overlap when no nearby gap exists', () => {
  expect(alignStripBoundaries(scan(0), strips)).toEqual(strips)
  const image = scan()
  ink(image, 20, 190)
  expect(alignStripBoundaries(image, strips)).toEqual(strips)
})
