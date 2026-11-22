// Cover handling must apply to every multi-page source, not just the CBZ path (#41).
import { expect, test } from '@playwright/test'
import { convert, makeCbz, makeComicPage, makePdf, openHarness, samePageBytes, type Source } from './support'

test.beforeEach(async ({ page }) => openHarness(page))

const spreads = [makeComicPage(), makeComicPage(), makeComicPage()]
const sources: Array<[string, () => Promise<Source>]> = [
  ['CBZ', () => makeCbz(spreads)],
  ['PDF', () => makePdf(spreads)],
]

for (const [label, makeSource] of sources) {
  test.describe(label, () => {
    test('landscape + coverPortrait keeps the first page portrait and unsplit', async ({ page }) => {
      const source = await makeSource()
      const kept = await convert(page, source, { coverPortrait: true })
      // A cover rendered as a portrait page, without any split, is exactly what the
      // portrait orientation produces for page 1.
      const portrait = await convert(page, source, { orientation: 'portrait' })
      const rotated = await convert(page, source, { coverPortrait: false })

      expect(samePageBytes(kept.xtc.pageData[0], portrait.xtc.pageData[0]), 'cover is portrait and whole').toBe(true)
      expect(samePageBytes(kept.xtc.pageData[0], rotated.xtc.pageData[0]), 'coverPortrait changed nothing').toBe(false)
    })

    test('cover is never split even when splitting is on', async ({ page }) => {
      const source = await makeSource()
      const split = await convert(page, source, { coverPortrait: false, splitMode: 'overlap' })
      const whole = await convert(page, source, { coverPortrait: false, splitMode: 'nosplit' })

      expect(samePageBytes(split.xtc.pageData[0], whole.xtc.pageData[0]), 'cover was split').toBe(true)
      // Story pages still split, so the splitting itself is not what was disabled.
      expect(split.pageCount).toBeGreaterThan(whole.pageCount)
    })

    test('firstPageIsCover off gives the first page the normal treatment', async ({ page }) => {
      const source = await makeSource()
      const chapter = await convert(page, source, { firstPageIsCover: false, coverPortrait: true })
      const portrait = await convert(page, source, { orientation: 'portrait' })

      expect(samePageBytes(chapter.xtc.pageData[0], portrait.xtc.pageData[0])).toBe(false)
      expect(chapter.pageCount).toBeGreaterThan(portrait.pageCount)
    })
  })
}
