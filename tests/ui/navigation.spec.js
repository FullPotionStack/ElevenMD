import { test, expect } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`active tab is brighter with a persistent selection marker in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('notepad-preferences', JSON.stringify({ theme })), theme)
    await page.goto('/')
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    const styles = await page.evaluate(() => {
      const selected = document.querySelector('[role=tab][aria-selected=true]'), inactive = document.querySelector('[role=tab][aria-selected=false]')
      const get = el => { const style = getComputedStyle(el.parentElement); return { brightness: style.backgroundColor.match(/\d+/g).slice(0, 3).map(Number).reduce((a,b) => a+b, 0), shadow: style.boxShadow, weight: getComputedStyle(el).fontWeight } }
      return { active: get(selected), inactive: get(inactive) }
    })
    expect(styles.active.brightness).toBeGreaterThan(styles.inactive.brightness)
    expect(styles.active.shadow).not.toBe('none')
    expect(Number(styles.active.weight)).toBeGreaterThan(Number(styles.inactive.weight))
    await page.getByRole('tab', { selected: true }).hover()
    await expect(page.getByRole('tab', { selected: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.getByRole('tab', { name: 'Untitled 1', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Untitled 1', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Untitled 2', exact: true })).toHaveAttribute('aria-selected', 'false')
  })
}

for (const theme of ['light', 'dark']) {
  test(`Formatted, Source, Preview mode selection is brighter and explicit in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('notepad-preferences', JSON.stringify({ theme })), theme)
    await page.goto('/')
    for (const mode of ['Formatted', 'Source', 'Preview']) {
      const button = page.getByRole('button', { name: mode, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.modes [aria-pressed=false]')).toHaveCount(2)
      const contrast = await button.evaluate(el => {
        const rgb = node => getComputedStyle(node).backgroundColor.match(/\d+/g).slice(0, 3).map(Number).reduce((a,b) => a+b, 0)
        return { active: rgb(el), background: rgb(el.parentElement), shadow: getComputedStyle(el).boxShadow }
      })
      expect(contrast.active).toBeGreaterThan(contrast.background)
      expect(contrast.shadow).not.toBe('none')
    }
  })
}

test('visible theme selector offers Light, Dark, Auto and persists across restart', async ({ page }) => {
  await page.goto('/')
  const theme = page.getByRole('combobox', { name: 'Quick theme', exact: true })
  await expect(theme).toBeVisible()
  for (const value of ['light', 'dark', 'system']) {
    await theme.selectOption(value)
    await expect(page.locator('html')).toHaveAttribute('data-theme', value)
    await page.reload()
    await expect(theme).toHaveValue(value)
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(29, 26, 34)')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 250, 242)')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'App theme', exact: true }).selectOption('dark')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(theme).toHaveValue('dark')
  await page.setViewportSize({ width: 640, height: 440 })
  await expect(theme).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
