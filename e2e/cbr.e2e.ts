import { expect, test } from '@playwright/test'
import { convert, makeCbr, makeCbz, makeComicPage, openHarness } from './support'

for (const pipeline of ['worker', 'main-thread'] as const) {
  test(`a CBR converts to the same XTC as a CBZ with the same pages (${pipeline})`, async ({ page }) => {
    await openHarness(page)
    const pages = [makeComicPage(true), makeComicPage(), makeComicPage()]

    const fromCbz = await convert(page, await makeCbz(pages), {}, pipeline)
    const fromCbr = await convert(page, makeCbr(pages), {}, pipeline)

    expect(fromCbr.pageCount).toBe(fromCbz.pageCount)
    expect(fromCbr.sha256).toBe(fromCbz.sha256)
  })
}
