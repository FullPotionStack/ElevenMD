import { test, expect } from '@playwright/test'
import path from 'node:path'
import { testScratch } from '../helpers/electron-harness.mjs'

test('strikethrough and Save As shortcuts do not conflict', async ({ page }) => {
  await page.addInitScript(() => {
    window.saveRequests = []
    window.notepad = {
      restoreSession: async () => ({ tabs: [], activeId: null, mode: 'formatted' }), initialFiles: async () => [],
      saveSession: async () => ({}), preferences: async () => {}, setDirty: () => {}, onAction: () => {},
      save: async request => { window.saveRequests.push(request); return null },
    }
  })
  await page.goto('/')
  await page.locator('.tiptap').fill('crossed out')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+Shift+x')
  await expect(page.locator('.tiptap s')).toHaveText('crossed out')
  expect(await page.evaluate(() => window.saveRequests.length)).toBe(0)
  await page.keyboard.press('Control+Alt+s')
  expect(await page.evaluate(() => window.saveRequests.length)).toBe(0)
  await expect(page.locator('.tiptap s')).toHaveText('crossed out')
  await page.keyboard.press('ControlOrMeta+Shift+s')
  await expect.poll(() => page.evaluate(() => window.saveRequests.length)).toBe(1)
  expect(await page.evaluate(() => window.saveRequests[0].saveAs)).toBe(true)
  await expect(page.locator('.tiptap s')).toHaveText('crossed out')
})

test('shortcut reference stays organized and usable at a small window in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 440 })
  await page.goto('/')
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Quick theme' }).selectOption(theme)
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.shortcut-card')).toHaveCount(4)
    await expect(dialog.locator('kbd').first()).toBeVisible()
    const close = dialog.getByRole('button', { name: 'Close', exact: true })
    await expect(close).toBeVisible()
    const bounds = await close.boundingBox()
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(440)
    await page.screenshot({ path: path.join(await testScratch(), `elevenmd-shortcuts-${theme}.png`) })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused()
  }
})

test('Help lists keyboard shortcuts including strikethrough and Save As', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Strikethrough')
  await expect(dialog).toContainText('Ctrl+Shift+X')
  await expect(dialog).toContainText('Ctrl+Shift+S')
  await expect(dialog).not.toContainText('Ctrl+Alt+S')
})
