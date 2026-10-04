import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp } from './helpers/electron-harness.mjs'
const scratch = await testScratch()
const temp = await mkdtemp(path.join(scratch, 'notepad-preferences-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(temp, 'profile') }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
let app
try {
  app = await electron.launch({ args: [path.resolve('electron/main.cjs')], env })
  const page = await app.firstWindow()
  await expect(page.getByRole('tab')).toBeVisible()
  await expect(page.locator('.app-name')).toContainText('ElevenMD')
  const overlay = await page.evaluate(() => ({ visible: navigator.windowControlsOverlay?.visible, y: document.querySelector('.tabs').getBoundingClientRect().y }))
  assert.equal(overlay.visible, true, 'actual native window-control overlay must be visible')
  assert.equal(overlay.y, 0, 'tabs must begin in the titlebar, not underneath it')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await page.getByRole('checkbox', { name: 'Spell check' }).check()
  await expect.poll(() => app.evaluate(({ session }) => session.fromPartition('persist:notepad-md-11').isSpellCheckerEnabled())).toBe(true)
  await page.getByRole('checkbox', { name: 'Spell check' }).uncheck()
  await expect.poll(() => app.evaluate(({ session }) => session.fromPartition('persist:notepad-md-11').isSpellCheckerEnabled())).toBe(false)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.locator('.tiptap').fill('Words without unwanted underlines')
  await expect(page.locator('.tiptap')).toHaveAttribute('spellcheck', 'false')
  await page.screenshot({ path: path.join(scratch, 'notepad-11-md-titlebar-dark.png') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('light')
  await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.screenshot({ path: path.join(scratch, 'notepad-11-md-titlebar-light.png') })
  console.log('PASS: actual native caption overlay shares tab row; live renderer/native themes; native spell checker toggles and remains disabled while editing')
} finally { await closeTestApp(app); await rm(temp, { recursive: true, force: true }) }
