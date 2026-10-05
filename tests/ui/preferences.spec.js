import { test, expect } from '@playwright/test'

test('primary dialog actions meet normal-text contrast in light and dark themes', async ({ page }) => {
  await page.goto('/')
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Quick theme' }).selectOption(theme)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const ratio = await page.locator('#done').evaluate(el => {
      const style = getComputedStyle(el)
      const luminance = value => value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0)
      const a = luminance(style.color), b = luminance(style.backgroundColor)
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
  }
})

test('ElevenMD applies themes immediately and makes spell checking optional', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tab')).toBeVisible()
  await expect(page.locator('.app-name')).toContainText('ElevenMD')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(29, 26, 34)')
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 250, 242)')
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Spell check' }).uncheck()
  await expect(page.locator('.tiptap')).toHaveAttribute('spellcheck', 'false')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  await expect(page.locator('.tiptap')).toHaveAttribute('spellcheck', 'false')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Spell check' }).check()
  await expect(page.locator('.tiptap')).toHaveAttribute('spellcheck', 'true')
})
