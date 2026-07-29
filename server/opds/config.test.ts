import { expect, test } from 'bun:test'
import { loadOpdsConfig } from './config'

test('loads optional OPDS Basic Auth credentials', () => {
  const config = loadOpdsConfig({
    OPDS_USERNAME: 'reader',
    OPDS_PASSWORD: 'secret',
  })

  expect(config.auth).toEqual({ username: 'reader', password: 'secret' })
})

test('rejects incomplete OPDS Basic Auth credentials', () => {
  expect(() => loadOpdsConfig({ OPDS_USERNAME: 'reader' })).toThrow(
    'OPDS_USERNAME and OPDS_PASSWORD must be set together',
  )
})
