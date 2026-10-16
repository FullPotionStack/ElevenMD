import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('Settings caption matches the package version', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('#settings-appearance .muted')).toHaveText(`ElevenMD · ${version} alpha`)
})

async function desktop(page, answer = 'discard') {
  await page.addInitScript(answer => {
    window.closedWindows = 0
    window.notepad = {
      initialFiles: async () => [], onAction: () => {}, setDirty: () => {},
      confirmClose: async () => answer,
      closeWindow: async () => { window.closedWindows++ },
    }
  }, answer)
  await page.goto('/')
}

test('closing the final tab checkpoints an empty session and closes the window instead of replacing it', async ({ page }) => {
  await desktop(page)
  await page.getByRole('button', { name: 'Close Untitled 1', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.closedWindows)).toBe(1)
  await expect(page.getByRole('tab')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('notepad-session')).tabs)).toEqual([])
})

test('cancelling final dirty tab dismissal leaves the app and text intact', async ({ page }) => {
  await desktop(page, 'cancel')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill('Keep this draft')
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('#source')).toHaveValue('Keep this draft')
  expect(await page.evaluate(() => window.closedWindows)).toBe(0)
})

test('failed final-tab checkpoint keeps the tab and text available', async ({ page }) => {
  await desktop(page)
  await page.evaluate(() => { window.notepad.saveSession = async () => { throw new Error('Storage unavailable') } })
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill('Do not lose this')
  await page.keyboard.press('Control+w')
  await expect(page.locator('#toast')).toContainText('Storage unavailable')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('#source')).toHaveValue('Do not lose this')
  expect(await page.evaluate(() => window.closedWindows)).toBe(0)
})

test('closing a nonfinal tab does not close the window', async ({ page }) => {
  await desktop(page)
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-label', 'Untitled 1')
  expect(await page.evaluate(() => window.closedWindows)).toBe(0)
})

test('discarding the final dirty tab does not resurrect a recovery draft', async ({ page }) => {
  await desktop(page)
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill('Discard this')
  await page.keyboard.press('Control+w')
  await expect.poll(() => page.evaluate(() => window.closedWindows)).toBe(1)
  await page.reload()
  await expect(page.locator('#source')).toHaveValue('')
})

test('tab color strips are independent, persist on reload, and can be removed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  const first = page.getByRole('tab', { name: 'Untitled 1', exact: true })
  await first.click({ button: 'right' })
  await page.getByRole('button', { name: 'Blue', exact: true }).click()
  const strip = page.locator('.tab-container').filter({ has: first }).locator('.tab-color-strip')
  await expect(strip).toHaveCSS('background-color', 'rgb(96, 165, 250)')
  await expect(strip).toHaveCSS('height', '3px')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-label', 'Untitled 2')
  await expect(page.locator('.tab-color-strip')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notepad-session') || '{}').tabs?.[0]?.color)).toBe('#60a5fa')
  await page.reload()
  await expect(strip).toHaveCSS('background-color', 'rgb(96, 165, 250)')
  await first.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('button', { name: 'No color', exact: true }).click()
  await expect(page.locator('.tab-color-strip')).toHaveCount(0)
})
