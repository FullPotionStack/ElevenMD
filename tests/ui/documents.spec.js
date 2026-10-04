import { test, expect } from '@playwright/test'

test('tabs keep independent source; opening and mode toggles preserve exact file until an edit; save clears dirty', async ({ page }) => {
  await page.addInitScript(() => {
    window.saved = []
    window.notepad = {
      initialFiles: async () => [], open: async () => [{ id: 'opened', path: 'C:/scratch/original.md', name: 'original.md', content: '# Exact\r\n\r\n*unchanged*\r\n', eol: 'CRLF', bom: false }],
      save: async (doc) => { window.saved.push(doc); return { ...doc, path: 'C:/scratch/original.md', name: 'original.md' } },
      setDirty: () => {}, confirmClose: async () => 'cancel', onAction: () => {},
    }
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Untitled 1' })).toBeVisible()
  await page.keyboard.press('Control+o')
  await expect(page.getByRole('tab', { name: 'original.md' })).toBeVisible()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Exact\r\n\r\n*unchanged*\r\n'.replaceAll('\r\n', '\n'))
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await page.keyboard.press('Control+s')
  expect(await page.evaluate(() => window.saved[0].content)).toBe('# Exact\r\n\r\n*unchanged*\r\n')
  await page.getByRole('button', { name: 'New tab' }).click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('my other document')
  await page.getByRole('tab', { name: 'original.md' }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Exact\n\n*unchanged*\n')
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Changed')
  await expect(page.getByRole('tab', { name: 'original.md' })).toHaveAttribute('data-dirty', 'true')
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'original.md' })).toHaveAttribute('data-dirty', 'false')
  await page.getByRole('tab', { name: 'Untitled 2' }).click()
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab', { name: 'Untitled 2' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('my other document')
})
