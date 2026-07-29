import { expect, test } from 'bun:test'
import { shouldSplitPage } from './image'

test('splits portrait pages only for four-page paper mode', () => {
  expect(shouldSplitPage(1200, 1800, 'portrait', 'fourway')).toBe(true)
  expect(shouldSplitPage(1200, 1800, 'portrait', 'nosplit')).toBe(false)
})

test('preserves landscape split rules', () => {
  expect(shouldSplitPage(1200, 1800, 'landscape', 'overlap')).toBe(true)
  expect(shouldSplitPage(1800, 1200, 'landscape', 'overlap')).toBe(false)
})
