import { test, expect } from '@playwright/test'

test('undo in a new document cannot bring content from another tab', async ({ page }) => {
  await page.goto('/')
  await page.locator('.tiptap').fill('PRIVATE FIRST DOCUMENT')
  // Separate ProseMirror's history groups; otherwise a single undo hides cross-tab leakage.
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.locator('.tiptap').fill('SECOND DOCUMENT')
  await page.waitForTimeout(600)
  await page.getByRole('tab', { name: 'Untitled 1' }).click()
  await page.locator('.tiptap').click()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.tiptap')).not.toContainText('SECOND DOCUMENT')
  await page.getByRole('tab', { name: 'Untitled 2' }).click()
  await expect(page.locator('.tiptap')).toContainText('SECOND DOCUMENT')
})
