import { expect, test } from 'bun:test'
import { getTargetDimensions } from './canvas'

test('uses the CrossPoint portrait canvas for Sticky', () => {
  expect(getTargetDimensions('Sticky')).toEqual({ width: 480, height: 800 })
})
