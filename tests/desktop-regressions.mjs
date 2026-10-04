import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const scratch = await testScratch(), temp = await mkdtemp(path.join(scratch, 'notepad-regressions-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(temp, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
let app
try {
  app = await electron.launch({ executablePath: packagedExecutable(), args: [], env })
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version)
  const page = await app.firstWindow()
  await expect(page.getByRole('combobox', { name: 'Quick theme' })).toBeVisible()
  await page.locator('.tiptap').fill('A selected task becomes a bullet')
  await page.keyboard.press('Control+a')
  await page.getByRole('button', { name: 'Task list', exact: true }).click()
  await page.getByRole('button', { name: 'Bullet list', exact: true }).click()
  await expect(page.locator('.tiptap li')).toHaveCount(1)
  await expect(page.locator('.tiptap input')).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.locator('#preview li')).toHaveCount(1)
  await expect(page.locator('#preview')).not.toContainText('[ ]')
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await page.locator('.tiptap').fill('The active tab is highlighted')
  for (const theme of ['dark', 'light', 'system']) {
    await page.getByRole('combobox', { name: 'Quick theme' }).selectOption(theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme)
    const selected = page.getByRole('tab', { selected: true })
    await expect(selected).toHaveCSS('font-weight', '600')
    await expect(page.getByRole('button', { name: 'Formatted', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Formatted', exact: true })).toHaveCSS('font-weight', '600')
    if (theme !== 'system') await page.screenshot({ path: path.join(scratch, `elevenmd-${version}-${theme}.png`) })
  }
  const overlay = await page.evaluate(() => ({ visible: navigator.windowControlsOverlay?.visible, y: document.querySelector('.tabs').getBoundingClientRect().y }))
  assert.deepEqual(overlay, { visible: true, y: 0 })
  console.log('PASS: actual packaged executable: task→bullet Preview parity; visible Light/Dark/Auto control updates native themes; highlighted active tab; native controls share titlebar. Theme screenshots saved to Hermes scratch.')
} finally { await closeTestApp(app); await rm(temp, { recursive: true, force: true }) }
