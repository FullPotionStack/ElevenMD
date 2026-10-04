import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
const temp = await mkdtemp(path.join(await testScratch(), 'notepad-native-dialogs-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(temp, 'profile') }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
const first = path.join(temp, 'native-first.md'), second = path.join(temp, 'native-second.md')
let app
try {
  const packaged = process.argv.includes('--packaged')
  app = await electron.launch({ ...(packaged ? { executablePath: packagedExecutable(), args: [] } : { args: [path.resolve('electron/main.cjs')] }), env })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Native save\n\nSaved through the real Windows dialog.\n')
  console.log(JSON.stringify({ stage: 'native Save dialog', pid: app.process().pid, first, second }))
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'native-first.md', exact: true })).toBeVisible({ timeout: 180000 })
  assert.equal(await readFile(first, 'utf8'), '# Native save\n\nSaved through the real Windows dialog.\n')
  await expect(page.locator('#file-status')).toHaveText('Saved')
  console.log('Verified first file bytes. Opening real Save As dialog.')
  await page.keyboard.press('Control+Shift+s')
  await expect(page.getByRole('tab', { name: 'native-second.md', exact: true })).toBeVisible({ timeout: 180000 })
  assert.equal(await readFile(second, 'utf8'), await readFile(first, 'utf8'))
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Edited after Save As\n')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#file-status')).toHaveText('Saved')
  assert.equal(await readFile(second, 'utf8'), '# Edited after Save As\n')
  assert.equal(await readFile(first, 'utf8'), '# Native save\n\nSaved through the real Windows dialog.\n')
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Unsaved closing check\n')
  console.log('Verified Save As and subsequent Save. Quitting without a save prompt.')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('Quit must not ask to save.') } })
  const closed = page.waitForEvent('close', { timeout: 15000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  const session = JSON.parse(await readFile(path.join(temp, 'profile', 'session.json'), 'utf8'))
  assert.equal(session.tabs[0].content, '# Unsaved closing check\n')
  assert.equal(await readFile(second, 'utf8'), '# Edited after Save As\n')
  console.log('PASS: real native Windows Save, Save As, subsequent Save, and prompt-free quit with private session checkpoint; exact disk bytes checked; save dialogs are not mocked')
} finally { await closeTestApp(app); await rm(temp, { recursive: true, force: true }) }
