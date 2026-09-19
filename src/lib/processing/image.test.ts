import { expect, test } from 'bun:test'
import { calculateOverlapSegments, calculateSpreadSegments, shouldSplitPage } from './image'

test('splits portrait pages only for four-page paper mode', () => {
  expect(shouldSplitPage(1200, 1800, 'portrait', 'fourway')).toBe(true)
  expect(shouldSplitPage(1200, 1800, 'portrait', 'nosplit')).toBe(false)
})

test('preserves landscape split rules', () => {
  expect(shouldSplitPage(1200, 1800, 'landscape', 'overlap')).toBe(true)
  expect(shouldSplitPage(1800, 1200, 'landscape', 'overlap')).toBe(false)
})

test('splits wide manga pages only when spread splitting is enabled', () => {
  expect(shouldSplitPage(1643, 1200, 'landscape', 'overlap', true)).toBe(true)
  expect(shouldSplitPage(1643, 1200, 'landscape', 'split', true)).toBe(true)
  expect(shouldSplitPage(1643, 1200, 'landscape', 'nosplit', true)).toBe(false)
  expect(shouldSplitPage(1643, 1200, 'portrait', 'overlap', true)).toBe(false)
  expect(shouldSplitPage(1643, 1200, 'landscape', 'fourway', true)).toBe(false)
  expect(shouldSplitPage(1643, 1200, 'landscape', 'overlap', false)).toBe(false)
})

test('enlarges the reported spread in right-to-left, top-to-bottom order', () => {
  const segments = calculateSpreadSegments(1643, 1200, 'overlap')
  expect(segments).toHaveLength(6)
  expect(segments.slice(0, 3)).toEqual(
    calculateOverlapSegments(822, 1200).map(segment => ({ ...segment, x: 821 }))
  )
  expect(segments.slice(3)).toEqual(calculateOverlapSegments(821, 1200))
  for (const segment of segments) {
    expect(segment.x + segment.w).toBeLessThanOrEqual(1643)
    expect(segment.y + segment.h).toBeLessThanOrEqual(1200)
    expect(segment.w).toBeGreaterThan(0)
    expect(segment.h).toBeGreaterThan(0)
  }
})

test('half splitting covers every pixel of odd-sized spreads', () => {
  expect(calculateSpreadSegments(1643, 1201, 'split')).toEqual([
    { x: 821, y: 0, w: 822, h: 600 },
    { x: 821, y: 600, w: 822, h: 601 },
    { x: 0, y: 0, w: 821, h: 600 },
    { x: 0, y: 600, w: 821, h: 601 },
  ])
})

test('keeps other layouts out of the manga spread path', () => {
  expect(calculateSpreadSegments(835, 1200, 'overlap')).toEqual([])
  expect(calculateSpreadSegments(1200, 1200, 'overlap')).toEqual([])
  expect(calculateSpreadSegments(1643, 1200, 'nosplit')).toEqual([])
  expect(calculateSpreadSegments(1643, 1200, 'fourway')).toEqual([])
})

test('uses the selected panel aspect ratio for X3 spread crops', () => {
  const segments = calculateSpreadSegments(1643, 1200, 'overlap', 528, 792)
  expect(segments).toHaveLength(6)
  expect(segments[0].h).toBe(Math.floor(822 * 528 / 792))
  for (const column of [segments.slice(0, 3), segments.slice(3)]) {
    expect(column[0].y).toBe(0)
    expect(column[2].y + column[2].h).toBe(1200)
    expect(column[1].y).toBeLessThan(column[0].y + column[0].h)
    expect(column[2].y).toBeLessThan(column[1].y + column[1].h)
  }
})

test('does not crop outside unusually wide or one-pixel-high images', () => {
  for (const mode of ['overlap', 'split'] as const) {
    for (const [width, height] of [[8000, 1200], [3, 1]]) {
      const segments = calculateSpreadSegments(width, height, mode)
      for (const segment of segments) {
        expect(segment.x).toBeGreaterThanOrEqual(0)
        expect(segment.y).toBeGreaterThanOrEqual(0)
        expect(segment.w).toBeGreaterThan(0)
        expect(segment.h).toBeGreaterThan(0)
        expect(segment.x + segment.w).toBeLessThanOrEqual(width)
        expect(segment.y + segment.h).toBeLessThanOrEqual(height)
      }
    }
  }
})
