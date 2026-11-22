// A JPEG 2000 image needs PDF.js's WASM decoder, which only the production build
// can fail to ship (ba197a9). Without it the pages convert to blank.
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { parseXtcFile } from '../src/lib/xtc-reader'
import { inkFraction, makeJpxPdf, toArrayBuffer } from './support'

test('PDF with a JPX image converts to non-blank pages in the production build', async ({ page }) => {
  const pdf = await makeJpxPdf()
  await page.goto('/pdf')
  await page.locator('input[type="file"]').setInputFiles({
    name: pdf.name, mimeType: 'application/pdf', buffer: Buffer.from(pdf.bytes),
  })
  await page.getByRole('button', { name: /convert/i }).click()
  await expect(page.locator('.result-item .name')).toHaveText('jpx.xtc')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.btn-download').click(),
  ])
  const xtc = await parseXtcFile(toArrayBuffer(await readFile((await download.path())!)))

  expect(xtc.pageData.length).toBeGreaterThan(0)
  const ink = inkFraction(xtc.pageData[0])
  expect(ink, 'page is blank white').toBeGreaterThan(0.02)
  expect(ink, 'page is solid black').toBeLessThan(0.9)
})
