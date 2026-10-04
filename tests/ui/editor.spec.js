import { test, expect } from '@playwright/test'

test('Markdown source becomes editable formatted content and round-trips edits', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Hello Windows\n\nSome **bold** writing.')
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await expect(page.locator('.tiptap h1')).toHaveText('Hello Windows')
  await expect(page.locator('.tiptap strong')).toHaveText('bold')
  await page.locator('.tiptap').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' More.')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(/More\./)
})
