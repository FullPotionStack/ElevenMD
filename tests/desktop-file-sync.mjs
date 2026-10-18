import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, rename } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, packagedExecutable } from './helpers/electron-harness.mjs'
const dir = await mkdtemp(path.join(await testScratch(), 'desktop-file-sync-')), target = path.join(dir, 'note.md'), profile = path.join(dir, 'profile')
await writeFile(target, 'base\n')
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
const launch = args => electron.launch(process.argv.includes('--packaged') ? { executablePath: packagedExecutable(), args, env } : { args: [path.resolve('electron/main.cjs'), ...args], env })
let app, page
async function close() {
  const closed = page.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(error => { if (!/closed/i.test(error.message)) throw error }); await closed; app = null
  // Let the normal process and its Chromium children release this isolated profile.
  await new Promise(resolve => setTimeout(resolve, 1200))
}
try {
  app = await launch([target]); page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: 'note.md', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Source', exact: true }).click()
  const replacement = path.join(dir, 'atomic.tmp'); await writeFile(replacement, 'outside\n'); await rename(replacement, target)
  await expect(page.locator('#source')).toHaveValue('outside\n', { timeout: 12000 }); await expect(page.getByRole('tab')).toHaveAttribute('data-dirty', 'false')
  await page.locator('#source').fill('mine\n'); await writeFile(target, 'outside again\n')
  await page.getByRole('button', { name: 'Compare changes', exact: true }).click({ timeout: 12000 })
  await expect(page.getByLabel('Your version', { exact: true })).toHaveValue('mine\n'); await expect(page.getByLabel('Disk version', { exact: true })).toHaveValue('outside again\n')
  await page.locator('#modal').screenshot({ path: path.join(await testScratch(), 'elevenmd-file-conflict.png') })
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) })
  await page.getByRole('button', { name: 'Overwrite disk with mine', exact: true }).click(); await expect(page.getByRole('button', { name: 'Overwrite disk with mine', exact: true })).toBeVisible()
  assert.equal(await readFile(target, 'utf8'), 'outside again\n')
  await app.evaluate(({ dialog }, target) => {
    dialog.showMessageBox = async () => { await process.getBuiltinModule('node:fs/promises').writeFile(target, 'third-party during approval\n'); return { response: 0 } }
  }, target)
  await page.getByRole('button', { name: 'Overwrite disk with mine', exact: true }).click(); await expect(page.locator('#toast')).toContainText('changed again')
  assert.equal(await readFile(target, 'utf8'), 'third-party during approval\n'); await expect(page.locator('#source')).toHaveValue('mine\n')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Compare changes', exact: true }).click()
  await expect(page.getByLabel('Disk version', { exact: true })).toHaveValue('third-party during approval\n')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
  await page.getByLabel('Merged result', { exact: true }).fill('combined\n'); await page.getByRole('button', { name: 'Save merged result', exact: true }).click()
  await expect(page.locator('#source')).toHaveValue('combined\n'); assert.equal(await readFile(target, 'utf8'), 'combined\n')
  await rm(target); await expect(page.locator('#file-status')).toContainText('File missing', { timeout: 12000 })
  await close(); await assert.rejects(readFile(target), { code: 'ENOENT' })
  app = await launch([]); page = await app.firstWindow(); await expect(page.locator('#source')).toHaveValue('combined\n'); await expect(page.locator('#file-status')).toContainText('File missing', { timeout: 12000 })
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
  await page.getByRole('button', { name: 'Recreate file', exact: true }).click(); await expect.poll(() => readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })).toBe('combined\n')
  await writeFile(target, Buffer.from([0, 255])); await expect(page.locator('#file-status')).toContainText('Unable to check', { timeout: 12000 }); await expect(page.locator('#source')).toHaveValue('combined\n')
  await writeFile(target, 'combined\n'); await expect(page.locator('#file-status')).not.toContainText('Unable to check', { timeout: 12000 })
  const moved = path.join(dir, 'moved.md'); await rename(target, moved); await expect(page.locator('#file-status')).toContainText('File missing', { timeout: 12000 })
  await app.evaluate(({ dialog }, moved) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [moved] }) }, moved)
  await page.getByRole('button', { name: 'Locate file', exact: true }).click(); await expect(page.getByRole('tab', { name: 'moved.md', exact: true })).toBeVisible(); await expect(page.locator('#file-status')).not.toContainText('File missing')
  await assert.rejects(readFile(target), { code: 'ENOENT' }); assert.equal(await readFile(moved, 'utf8'), 'combined\n')
  await close()
  console.log('PASS: real app detected atomic replacement, retained conflicting edits, compared versions, cancelled writes, rejected edits during native approval, saved a reviewed merge, preserved a missing-file buffer across restart, recreated only on approval, distinguished unreadable files, and located a moved file. Native consent/picker decisions were controlled; all documents were synthetic.')
} finally {
  if (app) { try { await close() } catch {} }
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
