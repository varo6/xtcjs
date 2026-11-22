// Behavior oracle for the conversion pipeline: SHA-256 of every produced XTC for a
// fixed set of fixtures x options, committed in golden/hashes.json. Refactors must
// keep these byte-identical, and the worker and main-thread pipelines must agree.
// Regenerate deliberately with `UPDATE_GOLDEN=1 bun run e2e e2e/golden.e2e.ts --workers=1`.
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ConversionOptions } from '../src/lib/conversion/types'
import { convert, makeCbz, makeComicPage, makeImage, makePdf, openHarness, type Source } from './support'

const GOLDEN = new URL('./golden/hashes.json', import.meta.url)
const update = !!process.env.UPDATE_GOLDEN

const golden: Record<string, string> = JSON.parse(readFileSync(GOLDEN, 'utf8'))

type FixtureName = 'cbz' | 'cbzPortrait' | 'pdf' | 'image'
const cases: Array<[string, FixtureName, Partial<ConversionOptions>]> = [
  ['cbz landscape overlap', 'cbz', { splitMode: 'overlap' }],
  ['cbz landscape split', 'cbz', { splitMode: 'split' }],
  ['cbz landscape fourway', 'cbz', { splitMode: 'fourway' }],
  ['cbz landscape nosplit', 'cbz', { splitMode: 'nosplit' }],
  ['cbz splitSpreads off', 'cbz', { splitSpreads: false }],
  ['cbz pageOverview portrait', 'cbz', { pageOverview: 'portrait' }],
  ['cbz pageOverview landscape', 'cbz', { pageOverview: 'landscape' }],
  ['cbz portrait pages overlap', 'cbzPortrait', { splitMode: 'overlap' }],
  ['cbz portrait pages split', 'cbzPortrait', { splitMode: 'split' }],
  ['cbz portrait pages fourway', 'cbzPortrait', { splitMode: 'fourway' }],
  ['cbz portrait pages nosplit', 'cbzPortrait', { splitMode: 'nosplit' }],
  ['cbz portrait orientation', 'cbz', { orientation: 'portrait' }],
  ['cbz X3', 'cbz', { device: 'X3' }],
  ['cbz 2-bit', 'cbz', { is2bit: true }],
  ['cbz dithering floyd contrast', 'cbz', { dithering: 'floyd', contrast: 4 }],
  ['cbz chapter (no cover)', 'cbz', { firstPageIsCover: false }],
  ['pdf default', 'pdf', {}],
  ['pdf 2-bit atkinson', 'pdf', { is2bit: true, dithering: 'atkinson' }],
  ['pdf coverPortrait off', 'pdf', { coverPortrait: false }],
  ['image portrait cover', 'image', { orientation: 'portrait', imageMode: 'cover' }],
  ['image X3 2-bit', 'image', { orientation: 'portrait', device: 'X3', is2bit: true }],
]

const fixtures: Record<FixtureName, Source> = {} as Record<FixtureName, Source>
test.beforeAll(async () => {
  const spread = makeComicPage()
  fixtures.cbz = await makeCbz([spread, spread, spread])
  const tall = makeComicPage(true)
  fixtures.cbzPortrait = await makeCbz([tall, tall, tall], null)
  fixtures.pdf = await makePdf([spread, spread])
  fixtures.image = makeImage(makeComicPage(true))
})

for (const [name, fixture, options] of cases) {
  test(name, async ({ page }) => {
    await openHarness(page)
    const worker = await convert(page, fixtures[fixture], options, 'worker')
    const main = await convert(page, fixtures[fixture], options, 'main-thread')

    if (update) {
      // Read-modify-write: run with --workers=1.
      const next: Record<string, string> = JSON.parse(readFileSync(GOLDEN, 'utf8'))
      next[name] = worker.sha256
      writeFileSync(GOLDEN, JSON.stringify(next, null, 2) + '\n')
      return
    }

    expect(golden[name], 'no golden hash recorded; run with UPDATE_GOLDEN=1').toBeDefined()
    expect(worker.sha256, 'worker pipeline output changed').toBe(golden[name])
    expect(main.sha256, 'main-thread pipeline differs from the worker pipeline').toBe(worker.sha256)
  })
}
