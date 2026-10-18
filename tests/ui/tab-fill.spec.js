import { test, expect } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`whole colored tabs keep readable text, close buttons and active markers in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => {
      localStorage.setItem('notepad-preferences', JSON.stringify({ theme }))
      localStorage.setItem('notepad-session', JSON.stringify({ tabs: [
        { id: 'colored', name: 'Colored', content: 'Dirty', savedContent: '', color: '#60a5fa' },
        { id: 'plain', name: 'Plain', content: '', savedContent: '' },
      ], activeId: 'plain', mode: 'source' }))
    }, theme)
    await page.goto('/')
    const tab = page.getByRole('tab', { name: 'Colored', exact: true })
    const container = page.locator('.tab-container').filter({ has: tab })
    await expect(container).toHaveCSS('background-color', 'rgb(96, 165, 250)')
    await expect(page.locator('.tab-container').filter({ has: page.getByRole('tab', { name: 'Plain', exact: true }) })).not.toHaveClass(/tab-colored/)
    for (const color of ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#c084fc', '#f472b6', '#000000', '#ffffff', '#777777']) {
      await tab.click({ button: 'right' })
      await page.locator('#tab-custom-color').fill(color)
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      for (const selected of [false, true]) {
        await page.getByRole('tab', { name: selected ? 'Colored' : 'Plain', exact: true }).click()
        await tab.hover()
        const state = await container.evaluate(el => {
          const rgb = value => value.match(/\d+/g).slice(0, 3).map(Number)
          const luminance = channels => channels.map(c => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
          const bg = getComputedStyle(el).backgroundColor
          const l = luminance(rgb(bg))
          const contrast = node => { const f = luminance(rgb(getComputedStyle(node).color)); return (Math.max(l, f) + 0.05) / (Math.min(l, f) + 0.05) }
          return { bg, text: contrast(el.querySelector('.tab')), close: contrast(el.querySelector('.close-tab')), dirty: contrast(el.querySelector('.dirty-dot')), shadow: getComputedStyle(el).boxShadow, buttonBg: getComputedStyle(el.querySelector('.tab')).backgroundColor }
        })
        const channels = color.slice(1).match(/../g).map(v => parseInt(v, 16))
        expect(state.bg).toBe(`rgb(${channels.join(', ')})`)
        expect(state.buttonBg).toBe('rgba(0, 0, 0, 0)')
        for (const ratio of [state.text, state.close, state.dirty]) expect(ratio).toBeGreaterThanOrEqual(4.5)
        expect(state.shadow === 'none').toBe(!selected)
        await container.locator('.close-tab').hover()
        await expect(container.locator('.close-tab')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      }
    }
    await tab.click({ button: 'right' })
    await page.getByRole('button', { name: 'No color', exact: true }).click()
    await expect(container).not.toHaveClass(/tab-colored/)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  })
}
