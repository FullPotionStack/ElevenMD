import { test, expect } from '@playwright/test'

test('unsaved drafts survive reload without silently overwriting original files', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Recover this\n\nNever lose a draft.')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notepad-session') || 'null')?.tabs?.[0]?.content)).toBe('# Recover this\n\nNever lose a draft.')
  // Exercise draft fallback explicitly, rather than racing the debounced session checkpoint.
  await page.evaluate(() => localStorage.removeItem('notepad-session'))
  await page.reload()
  await expect(page.getByRole('tab')).toHaveAttribute('data-dirty', 'true')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Recover this\n\nNever lose a draft.')
  await expect(page.locator('#file-status')).toContainText('Recovered draft')
})
