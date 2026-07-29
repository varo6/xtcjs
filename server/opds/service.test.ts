import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpdsService } from './service'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('status does not expose host filesystem paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xtcjs-opds-service-'))
  tempDirs.push(root)
  const service = new OpdsService({
    libraryDir: join(root, 'library'),
    cacheDir: join(root, 'cache'),
    pageSize: 50,
    conversion: {
      device: 'X4',
      splitMode: 'overlap',
      dithering: 'floyd',
      contrast: 4,
      is2bit: false,
      orientation: 'landscape',
    },
  })

  const status = await service.getStatus()

  expect(status).not.toHaveProperty('libraryDir')
  expect(status).not.toHaveProperty('cacheDir')
})
