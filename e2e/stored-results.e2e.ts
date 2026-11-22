// Results live in real IndexedDB; removing one must survive a reload.
import { expect, test, type Page } from '@playwright/test'
import { makeCbz, makeComicPage, type Source } from './support'

async function convertThroughUi(page: Page, files: Source[]) {
  await page.locator('input[type="file"]').setInputFiles(files.map((file) => ({
    name: file.name, mimeType: 'application/vnd.comicbook+zip', buffer: Buffer.from(file.bytes),
  })))
  await page.getByRole('button', { name: /convert/i }).click()
  await expect(page.locator('.result-item')).toHaveCount(files.length)
}

test('stored results persist across reload and removal persists too', async ({ page }) => {
  const portrait = makeComicPage(true)
  const keep = await makeCbz([portrait], null, 'keep.cbz')
  const drop = await makeCbz([portrait], null, 'drop.cbz')

  await page.goto('/')
  await convertThroughUi(page, [keep, drop])

  await page.reload()
  await expect(page.getByText('Recovered 2 files from previous session')).toBeVisible()
  await expect(page.locator('.result-item')).toHaveCount(2)
  await expect(page.locator('.result-item .name').filter({ hasText: 'keep.xtc' })).toHaveCount(1)
  await expect(page.locator('.result-item .name').filter({ hasText: 'drop.xtc' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Remove drop.xtc' }).click()
  await expect(page.locator('.result-item .name')).toHaveText(['keep.xtc'])

  await page.reload()
  await expect(page.getByText('Recovered 1 file from previous session')).toBeVisible()
  await expect(page.locator('.result-item .name')).toHaveText(['keep.xtc'])
})

test('removing the last stored result leaves nothing after reload', async ({ page }) => {
  const only = await makeCbz([makeComicPage(true)], null, 'only.cbz')

  await page.goto('/')
  await convertThroughUi(page, [only])
  await page.getByRole('button', { name: 'Remove only.xtc' }).click()
  await expect(page.locator('.result-item')).toHaveCount(0)

  await page.reload()
  await expect(page.locator('.recovered-notice')).toHaveCount(0)
  await expect(page.locator('.result-item')).toHaveCount(0)
})
