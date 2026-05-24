import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('OPDS runtime imports', () => {
  test('server converter does not import browser src modules at runtime', async () => {
    const source = await readFile(join(import.meta.dir, 'cbz-converter.ts'), 'utf8')

    expect(source).not.toContain('../../src/')
  })
})
