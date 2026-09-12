import { expect, test } from 'bun:test'
import { shouldSplitPage, calculateOverlapSegments, snapSegmentsToGutters } from './image'

test('splits portrait pages only for four-page paper mode', () => {
  expect(shouldSplitPage(1200, 1800, 'portrait', 'fourway')).toBe(true)
  expect(shouldSplitPage(1200, 1800, 'portrait', 'nosplit')).toBe(false)
})

test('preserves landscape split rules', () => {
  expect(shouldSplitPage(1200, 1800, 'landscape', 'overlap')).toBe(true)
  expect(shouldSplitPage(1800, 1200, 'landscape', 'overlap')).toBe(false)
})

test('snapSegmentsToGutters snaps to nearby gutters', () => {
  const segments = calculateOverlapSegments(764, 1200)
  const gutters = [410, 820]

  const snapped = snapSegmentsToGutters(segments, gutters, 1200)

  expect(snapped.length).toBe(segments.length)
  // First segment always starts at 0
  expect(snapped[0].y).toBe(0)
  // Later segments should snap to gutters if within threshold
  const segHeight = segments[0].h
  const threshold = segHeight * 0.15
  for (let i = 1; i < snapped.length; i++) {
    const originalY = segments[i].y
    const snappedY = snapped[i].y
    const nearestGutter = gutters.reduce((best, g) =>
      Math.abs(g - originalY) < Math.abs(best - originalY) ? g : best
    )
    if (Math.abs(nearestGutter - originalY) <= threshold) {
      expect(snappedY).toBe(nearestGutter)
    }
  }
  // Last segment extends to page bottom
  const last = snapped[snapped.length - 1]
  expect(last.y + last.h).toBe(1200)
})

test('snapSegmentsToGutters ignores distant gutters', () => {
  const segments = [
    { x: 0, y: 0, w: 764, h: 600 },
    { x: 0, y: 400, w: 764, h: 600 },
    { x: 0, y: 800, w: 764, h: 400 },
  ]
  // Gutter at 100 is nowhere near any segment start
  const snapped = snapSegmentsToGutters(segments, [100], 1200)
  expect(snapped[1].y).toBe(400)
  expect(snapped[2].y).toBe(800)
})

test('snapSegmentsToGutters returns original when no gutters', () => {
  const segments = calculateOverlapSegments(764, 1200)
  const snapped = snapSegmentsToGutters(segments, [], 1200)
  expect(snapped).toEqual(segments)
})

test('snapSegmentsToGutters handles single segment', () => {
  const segments = [{ x: 0, y: 0, w: 764, h: 1200 }]
  const snapped = snapSegmentsToGutters(segments, [400, 800], 1200)
  expect(snapped).toEqual(segments)
})
