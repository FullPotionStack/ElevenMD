import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
if (process.platform !== 'win32') throw new Error('Real Windows native dialog tests require Windows.')
const run = promisify(execFile)
const driver = fileURLToPath(new URL('./helpers/windows-save-dialog.ps1', import.meta.url))
const temp = await mkdtemp(path.join(await testScratch(), 'notepad-native-dialogs-ç QA-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(temp, 'profile') }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
const first = path.join(temp, 'native-first.md'), second = path.join(temp, 'native-second.md')
let app
try {
  const packaged = process.argv.includes('--packaged')
  app = await electron.launch({ ...(packaged ? { executablePath: packagedExecutable(), args: [] } : { args: [path.resolve('electron/main.cjs')] }), env })
  const page = await app.firstWindow()
  // Playwright's child can be Electron's launcher, not the browser owning the dialog.
  const browserPid = await app.evaluate(() => process.pid)
  const completeDialog = async (filename, cancel = false) => {
    assert.equal(path.dirname(filename), temp, 'native dialog destinations must stay in the owned fixture directory')
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', driver,
      '-TargetProcessId', String(browserPid), '-FilePath', filename, ...(cancel ? ['-Cancel'] : [])],
    { timeout: 30000, windowsHide: true })
    console.log(stdout.trim())
  }
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Native save\n\nSaved through the real Windows dialog.\n')
  console.log(JSON.stringify({ stage: 'native Save dialog', browserPid, first, second }))
  await page.keyboard.press('Control+s')
  await completeDialog(first)
  await expect(page.getByRole('tab', { name: 'native-first.md', exact: true })).toBeVisible({ timeout: 15000 })
  assert.equal(await readFile(first, 'utf8'), '# Native save\n\nSaved through the real Windows dialog.\n')
  await expect(page.locator('#file-status')).toHaveText('Saved')
  console.log('Verified first file bytes. Opening real Save As dialog.')
  await page.keyboard.press('Control+Shift+s')
  await completeDialog(second)
  await expect(page.getByRole('tab', { name: 'native-second.md', exact: true })).toBeVisible({ timeout: 15000 })
  assert.equal(await readFile(second, 'utf8'), await readFile(first, 'utf8'))
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Edited after Save As\n')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#file-status')).toHaveText('Saved')
  assert.equal(await readFile(second, 'utf8'), '# Edited after Save As\n')
  assert.equal(await readFile(first, 'utf8'), '# Native save\n\nSaved through the real Windows dialog.\n')
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Unsaved closing check\n')
  const canceled = path.join(temp, 'canceled.md')
  await page.keyboard.press('Control+Shift+s')
  await completeDialog(canceled, true)
  await expect(page.getByRole('tab', { name: 'native-second.md', exact: true })).toHaveAttribute('data-dirty', 'true')
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Unsaved closing check\n')
  await assert.rejects(readFile(canceled), { code: 'ENOENT' })
  assert.equal(await readFile(second, 'utf8'), '# Edited after Save As\n')
  console.log('Verified native Save As cancellation preserves the dirty buffer and saved bytes.')
  // A closed dialog alone does not prove the canceled operation released its lock.
  // Reopen and finish a real Save As to a fresh destination before testing quit.
  const afterCancel = path.join(temp, 'native-after-cancel.md')
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Save As after cancellation\n')
  await page.keyboard.press('Control+Shift+s')
  await completeDialog(afterCancel)
  await expect(page.getByRole('tab', { name: 'native-after-cancel.md', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('#file-status')).toHaveText('Saved')
  assert.equal(await readFile(afterCancel, 'utf8'), '# Save As after cancellation\n')
  assert.equal(await readFile(first, 'utf8'), '# Native save\n\nSaved through the real Windows dialog.\n')
  assert.equal(await readFile(second, 'utf8'), '# Edited after Save As\n')
  await assert.rejects(readFile(canceled), { code: 'ENOENT' })
  // Make the now-saved document dirty again so the original quit checkpoint
  // assertion still exercises an unsaved buffer rather than a clean document.
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Unsaved closing check\n')
  await expect(page.getByRole('tab', { name: 'native-after-cancel.md', exact: true })).toHaveAttribute('data-dirty', 'true')
  console.log('Verified a fresh Save As after Cancel releases the save lock. Quitting with an unsaved buffer and no save prompt.')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('Quit must not ask to save.') } })
  const closed = page.waitForEvent('close', { timeout: 15000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  const session = JSON.parse(await readFile(path.join(temp, 'profile', 'session.json'), 'utf8'))
  assert.equal(session.tabs[0].content, '# Unsaved closing check\n')
  assert.equal(await readFile(first, 'utf8'), '# Native save\n\nSaved through the real Windows dialog.\n')
  assert.equal(await readFile(second, 'utf8'), '# Edited after Save As\n')
  assert.equal(await readFile(afterCancel, 'utf8'), '# Save As after cancellation\n')
  console.log('PASS: real native Windows Save, Save As, subsequent Save, verified Cancel closure and fresh Save As, and prompt-free dirty quit with private session checkpoint; exact disk bytes checked; save dialogs are not mocked')
} finally { await closeTestApp(app); await rm(temp, { recursive: true, force: true }) }
