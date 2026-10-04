import { test, expect } from '@playwright/test'
for (const content of ['Inline $x^2$ math\n', 'Term\n: Definition\n']) {
  test(`advanced construct stays lossless: ${content.trim()}`, async ({ page }) => {
    await page.addInitScript(content => { window.notepad = { initialFiles: async () => [{ id: '11111111-1111-4111-8111-111111111111', path: 'C:/docs/advanced.md', name: 'advanced.md', content }], setDirty: () => {}, onAction: () => {} } }, content)
    await page.goto('/')
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(content)
  })
}
