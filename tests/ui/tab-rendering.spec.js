import { test, expect } from '@playwright/test'

for (const mode of ['preview', 'source', 'formatted']) {
  test(`restoring ${mode} synchronizes the visible panel before switching or opening documents`, async ({ page }) => {
    await page.addInitScript(mode => {
      localStorage.setItem('notepad-session', JSON.stringify({
        tabs: [
          { id: 'first', name: 'first.md', content: '# First restored document', savedContent: '# First restored document' },
          { id: 'second', name: 'second.md', content: '# Second restored document', savedContent: '# Second restored document' },
        ], activeId: 'first', mode,
      }))
      window.notepad = {
        initialFiles: async () => [],
        open: async () => [{ id: 'opened', name: 'opened.md', content: '# Opened document', savedContent: '# Opened document' }],
        setDirty: () => {}, onAction: () => {},
      }
    }, mode)
    await page.goto('/')
    const panel = page.locator(mode === 'preview' ? '#preview' : mode === 'source' ? '#source' : '.tiptap')
    const check = async text => {
      await expect(panel).toBeVisible()
      if (mode === 'source') await expect(panel).toHaveValue(`# ${text}`)
      else await expect(panel).toContainText(text)
      await expect(page.getByRole('button', { name: mode === 'preview' ? 'Preview' : mode === 'source' ? 'Source' : 'Formatted', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.toolbar')).toBeVisible({ visible: mode === 'formatted' })
    }
    await check('First restored document')
    await page.getByRole('tab', { name: 'second.md', exact: true }).click()
    await check('Second restored document')
    await page.keyboard.press('Control+o')
    await check('Opened document')
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await expect(panel).toBeVisible()
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-label', 'Untitled 1')
  })
}

test('switching from a long scrolled document keeps short and new documents on screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill(Array.from({ length: 200 }, (_, i) => `Paragraph ${i}`).join('\n\n'))
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await page.evaluate(() => { const main = document.querySelector('main'); main.scrollTop = main.scrollHeight })
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.locator('.tiptap').fill('Short document remains visible')
  await page.getByRole('tab', { name: 'Untitled 1', exact: true }).click()
  await page.evaluate(() => { const main = document.querySelector('main'); main.scrollTop = main.scrollHeight })
  await page.getByRole('tab', { name: 'Untitled 2', exact: true }).click()
  await expect(page.locator('.tiptap p')).toBeInViewport()
  await expect(page.locator('.tiptap')).toContainText('Short document remains visible')
})
