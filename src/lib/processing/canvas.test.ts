import { expect, test } from 'bun:test'
import { getTargetDimensions } from './canvas'

test('uses the CrossPoint portrait canvas for Sticky', () => {
  expect(getTargetDimensions('Sticky')).toEqual({ width: 480, height: 800 })
})

test('uses the 552x768 portrait canvas for eegoread A4', () => {
  expect(getTargetDimensions('A4')).toEqual({ width: 552, height: 768 })
})
