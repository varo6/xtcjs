// Ported from the former scripts/comic-spreads.browser.ts console checks.
import { expect, test } from '@playwright/test'
import type { ConversionOptions } from '../src/lib/conversion/types'
import { convert, inkFraction, makeCbz, makeComicPage, openHarness, samePageBytes, targetDimensions, type Source } from './support'

test.beforeEach(async ({ page }) => openHarness(page))

const spreadScenarios = [
  { name: 'thirds', options: {}, count: 13, perSpread: 6 },
  { name: 'halves', options: { splitMode: 'split' }, count: 9, perSpread: 4 },
  { name: 'keep spreads', options: { splitSpreads: false }, count: 3, perSpread: 1 },
  { name: 'no split', options: { splitMode: 'nosplit' }, count: 3, perSpread: 1 },
  { name: 'portrait', options: { orientation: 'portrait' }, count: 3, perSpread: 1 },
  { name: 'overview', options: { pageOverview: 'portrait' }, count: 15, perSpread: 7 },
  { name: 'clockwise', options: { landscapeFlipClockwise: true }, count: 13, perSpread: 6 },
  { name: 'X3', options: { device: 'X3' }, count: 13, perSpread: 6 },
  { name: 'Sticky', options: { device: 'Sticky' }, count: 13, perSpread: 6 },
  { name: 'XTCH', options: { is2bit: true }, count: 13, perSpread: 6 },
  { name: 'margins', options: { horizontalMargin: 1, verticalMargin: 2 }, count: 13, perSpread: 6 },
  { name: 'chapter thirds', options: { firstPageIsCover: false }, count: 18, perSpread: 6 },
  { name: 'chapter halves', options: { firstPageIsCover: false, splitMode: 'split' }, count: 12, perSpread: 4 },
  { name: 'chapter XTCH', options: { firstPageIsCover: false, is2bit: true }, count: 18, perSpread: 6 },
] satisfies Array<{ name: string; options: Partial<ConversionOptions>; count: number; perSpread: number }>

test.describe('wide spreads', () => {
  let comic: Source
  test.beforeAll(async () => {
    const page = makeComicPage()
    comic = await makeCbz([page, page, page], undefined, 'spread-test.cbz')
  })

  for (const scenario of spreadScenarios) {
    test(scenario.name, async ({ page }) => {
      const options = scenario.options as Partial<ConversionOptions>
      const device = options.device ?? 'X4'
      const firstPageIsCover = options.firstPageIsCover ?? true

      const worker = await convert(page, comic, options, 'worker')
      expect(worker.workersCreated, 'worker path was not exercised').toBeGreaterThan(0)
      const fallback = await convert(page, comic, options, 'main-thread')
      expect(fallback.workersCreated).toBe(0)

      expect(worker.pageCount, 'page count').toBe(scenario.count)
      expect(fallback.pageCount, 'fallback page count').toBe(scenario.count)

      const { width, height } = await targetDimensions(page, device)
      for (const entry of worker.xtc.entries) {
        expect({ width: entry.width, height: entry.height }).toEqual({ width, height })
      }

      const nextPage = firstPageIsCover ? 2 : 1 + scenario.perSpread
      expect(worker.xtc.metadata!.toc[0].startPage, 'first page crop count').toBe(nextPage)
      expect(worker.xtc.metadata!.toc[1].startPage, 'TOC skipped/reordered spread sections').toBe(nextPage + scenario.perSpread)

      expect(fallback.xtc.pageData).toHaveLength(worker.xtc.pageData.length)
      worker.xtc.pageData.forEach((expected, i) => {
        expect(samePageBytes(expected, fallback.xtc.pageData[i]), `worker/fallback differ at page ${i + 1}`).toBe(true)
      })

      if (scenario.name === 'halves') {
        const density = worker.xtc.pageData.slice(1, 5).map(inkFraction)
        expect(density[0], 'right top').toBeGreaterThan(density[1])
        expect(density[1], 'right bottom').toBeGreaterThan(density[2])
        expect(density[2], 'left top').toBeGreaterThan(density[3])
      }
    })
  }
})

// Regression for #48: a chapter's first story page must split when cover handling is off.
test.describe('cover handling', () => {
  let comic: Source
  test.beforeAll(async () => {
    const page = makeComicPage(true)
    comic = await makeCbz([page, page, page], undefined, 'spread-test.cbz')
  })

  const base = { splitSpreads: false } satisfies Partial<ConversionOptions>

  for (const pipeline of ['worker', 'main-thread'] as const) {
    for (const is2bit of [false, true]) {
      const label = `${pipeline} ${is2bit ? 'XTCH' : 'XTC'}`

      for (const [splitMode, count, nextPage] of [['overlap', 9, 4], ['split', 6, 3], ['nosplit', 3, 2]] as const) {
        test(`${label} ${splitMode}: first story page splits`, async ({ page }) => {
          await openHarness(page)
          const options = { ...base, is2bit, splitMode, firstPageIsCover: false }
          const result = await convert(page, comic, options, pipeline)
          expect(result.pageCount, 'first story page was not split').toBe(count)
          expect(result.xtc.metadata!.toc[0].startPage, 'TOC did not account for the first page crops').toBe(nextPage)

          const portraitIgnored = await convert(page, comic, { ...options, coverPortrait: false }, pipeline)
          result.xtc.pageData.forEach((expected, i) => {
            expect(
              samePageBytes(expected, portraitIgnored.xtc.pageData[i]),
              `cover portrait affected story page ${i + 1} while cover handling was off`,
            ).toBe(true)
          })
        })
      }

      test(`${label}: default cover behaviour is preserved`, async ({ page }) => {
        await openHarness(page)
        const result = await convert(page, comic, { ...base, is2bit }, pipeline)
        expect(result.pageCount).toBe(7)
      })
    }

    test(`${pipeline}: cover metadata does not reorder story pages`, async ({ page }) => {
      await openHarness(page)
      const pageImage = makeComicPage(true)
      const lateCover = await makeCbz([pageImage, pageImage, pageImage],
        '<ComicInfo><Title>Chapter order test</Title><Pages>' +
        '<Page Image="0" Bookmark="First story page"/><Page Image="1" Bookmark="Second story page"/>' +
        '<Page Image="2" Type="FrontCover"/></Pages></ComicInfo>', 'chapter-order.cbz')
      for (const firstPageIsCover of [false, true]) {
        const result = await convert(page, lateCover, { ...base, firstPageIsCover }, pipeline)
        const toc = result.xtc.metadata!.toc
        expect(toc[0].startPage, 'first story page order').toBe(firstPageIsCover ? 2 : 1)
        expect(toc[1].startPage, 'second story page order').toBe(firstPageIsCover ? 5 : 4)
      }
    })
  }
})
