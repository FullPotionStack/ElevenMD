import { test, expect } from '@playwright/test'

test('wheel over document tabs scrolls the strip without selecting another document', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto('/')
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'New tab', exact: true }).click()
  const tabs = page.locator('#tablist')
  const selected = page.getByRole('tab', { selected: true })
  const name = await selected.getAttribute('aria-label')
  await tabs.evaluate(el => { el.scrollLeft = 0 })
  await tabs.hover()
  await page.mouse.wheel(0, 240)
  await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await expect(selected).toHaveAttribute('aria-label', name)
  const offset = await tabs.evaluate(el => el.scrollLeft)
  await page.mouse.wheel(0, -120)
  await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBeLessThan(offset)
  await expect(selected).toHaveAttribute('aria-label', name)
  // Horizontal trackpad gestures retain their native direction.
  await tabs.evaluate(el => { el.scrollLeft = 0 })
  await page.mouse.wheel(150, 0)
  await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await expect(selected).toHaveAttribute('aria-label', name)
})
