import { test, expect } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  for (const selected of [false, true]) {
    test(`hover fills the whole ${selected ? 'active' : 'inactive'} tab including its close area in ${theme}`, async ({ page }) => {
      await page.addInitScript(({ theme, selected }) => {
        localStorage.setItem('notepad-preferences', JSON.stringify({ theme }))
        localStorage.setItem('notepad-session', JSON.stringify({ tabs: [
          { id: 'first', name: 'First', content: '', savedContent: '' },
          { id: 'second', name: 'Second', content: '', savedContent: '' },
        ], activeId: selected ? 'first' : 'second', mode: 'source' }))
      }, { theme, selected })
      await page.goto('/')
      await page.locator('#source').hover()
      const tab = page.getByRole('tab', { name: 'First', exact: true })
      const container = page.locator('.tab-container').filter({ has: tab })
      const close = container.locator('.close-tab')
      const background = () => container.evaluate(el => getComputedStyle(el).backgroundColor)
      const resting = await background()
      const marker = await container.evaluate(el => getComputedStyle(el).boxShadow)
      await tab.hover()
      expect(await background()).not.toBe(resting)
      const hovered = await background()
      await expect(tab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await close.hover()
      expect(await background()).toBe(hovered)
      expect(await container.evaluate(el => getComputedStyle(el).boxShadow)).toBe(marker)
      await expect(tab).toHaveAttribute('aria-selected', String(selected))
      await page.locator('#source').hover()
      expect(await background()).toBe(resting)
    })
  }
}
