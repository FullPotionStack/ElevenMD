import { test, expect } from '@playwright/test'
test('Preview renders advanced Markdown without changing or flattening the source', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const text = '---\ntitle: Test\n---\n\n# Advanced\n\nA footnote[^1], and $x^2$.\n\n[^1]: Preserved note\n\n- [x] Completed\n\nTerm\n: Definition\n'
  await page.getByRole('textbox', { name: 'Markdown source' }).fill(text)
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.locator('#preview h1')).toHaveText('Advanced')
  await expect(page.locator('#preview .katex')).toBeVisible()
  await expect(page.locator('#preview')).toContainText('Preserved note')
  await expect(page.locator('#preview dl')).toContainText('Definition')
  await expect(page.locator('#preview input[type="checkbox"]')).toBeDisabled()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(text)
})
