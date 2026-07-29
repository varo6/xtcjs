import { expect, test } from 'bun:test'
import { deleteStoredResult, withoutStoredResult } from './useStoredResults'

test('removes only the requested stored result', () => {
  const results = [{ id: 'one' }, { id: 'two' }]
  expect(withoutStoredResult(results, 'one')).toEqual([{ id: 'two' }])
})

test('waits for persisted deletion before succeeding', async () => {
  let resolveDeletion!: () => void
  let completed = false
  const removal = deleteStoredResult({ id: 'stored-one' }, () => new Promise<void>((resolve) => {
    resolveDeletion = resolve
  }))
  void removal.then(() => {
    completed = true
  })

  await Promise.resolve()
  expect(completed).toBe(false)

  resolveDeletion()
  await expect(removal).resolves.toBe(true)
})

test('skips persisted deletion for in-memory results', async () => {
  let deleted = false

  await expect(deleteStoredResult({ id: 'mem-one' }, async () => {
    deleted = true
  })).resolves.toBe(true)

  expect(deleted).toBe(false)
})

test('returns false when persisted deletion fails', async () => {
  await expect(deleteStoredResult({ id: 'stored-one' }, async () => {
    throw new Error('delete failed')
  })).resolves.toBe(false)
})
