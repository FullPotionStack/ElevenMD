import { test, expect } from '@playwright/test'

test('find and replace edits exact Markdown source instead of flattening formatting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Hello\n\n**Hello**, Windows. Hello again.')
  await page.keyboard.press('Control+h')
  await page.getByRole('textbox', { name: 'Find text' }).fill('Hello')
  await page.getByRole('textbox', { name: 'Replace with' }).fill('Hi')
  await page.getByRole('button', { name: 'Replace all', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Hi\n\n**Hi**, Windows. Hi again.')
  await page.getByRole('button', { name: 'Close find', exact: true }).click()
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await expect(page.locator('.tiptap strong')).toHaveText('Hi')
})
