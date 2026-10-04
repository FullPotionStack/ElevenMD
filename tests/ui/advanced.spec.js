import { test, expect } from '@playwright/test'

test('advanced Markdown stays in source until user explicitly accepts conversion', async ({ page }) => {
  const markdown = '---\ntitle: Preserve me\n---\n\n# Heading\n\n<!-- a comment -->\n\nA footnote[^1].\n\n[^1]: Keep this note.'
  await page.addInitScript(content => { window.notepad = { initialFiles: async () => [{ id: 'advanced', name: 'advanced.md', path: 'C:/scratch/advanced.md', content }], setDirty: () => {}, onAction: () => {} } }, markdown)
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(markdown)
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('may remove unsupported syntax')
  await page.getByRole('button', { name: 'Keep source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(markdown)
  await expect(page.getByRole('tab', { name: 'advanced.md' })).toHaveAttribute('data-dirty', 'false')
})
