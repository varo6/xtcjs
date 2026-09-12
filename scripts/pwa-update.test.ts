import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'

test('production builds reload open clients after a service worker update', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'xtcjs-pwa-'))

  try {
    await build({
      configFile: resolve(import.meta.dir, '../vite.config.ts'),
      build: { outDir, emptyOutDir: true },
      logLevel: 'silent',
    })

    const indexHtml = await readFile(join(outDir, 'index.html'), 'utf8')
    const scripts = (await readdir(join(outDir, 'assets'))).filter((file) => file.endsWith('.js'))
    const bundles = await Promise.all(scripts.map((file) => readFile(join(outDir, 'assets', file), 'utf8')))

    expect(indexHtml).not.toContain('/registerSW.js')
    expect(bundles.some((bundle) => (
      bundle.includes('new Workbox("/sw.js"') ||
      /new \w+\("\/sw\.js".*addEventListener\("activated".*location\.reload\(\)/s.test(bundle)
    ))).toBe(true)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 30_000)
