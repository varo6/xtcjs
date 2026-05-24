import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureParentDirectory } from './storage'

describe('ensureParentDirectory', () => {
  test('creates the parent directory for a database path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xtcjs-storage-'))
    const dbPath = join(dir, 'nested', 'stats.db')

    await ensureParentDirectory(dbPath)

    expect(existsSync(join(dir, 'nested'))).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})
