import { expect, test } from 'bun:test'
import { withoutStoredResult } from './useStoredResults'

test('removes only the requested stored result', () => {
  const results = [{ id: 'one' }, { id: 'two' }]
  expect(withoutStoredResult(results, 'one')).toEqual([{ id: 'two' }])
})
