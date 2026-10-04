import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const scratch = await testScratch()
const temp = await mkdtemp(path.join(await testScratch(), 'notepad-desktop-test-'))
const fixture = path.join(temp, 'fixture.md')
const saveAs = path.join(temp, 'saved-as.md')
await writeFile(fixture, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Desktop fixture\r\n\r\n**Original**\r\n')]))
const packaged = process.argv.includes('--packaged')
const options = packaged ? { executablePath: packagedExecutable(), args: [fixture] } : { args: ['.', fixture] }
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(temp, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ ...options, env, timeout: 30000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await expect(page.getByRole('tab', { name: 'fixture.md', exact: true })).toBeVisible()
  await expect(page.locator('.tiptap h1')).toHaveText('Desktop fixture')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Saved from real Electron\n\n**Still Markdown**\n')
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'fixture.md', exact: true })).toHaveAttribute('data-dirty', 'false')
  const bytes = await readFile(fixture)
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(bytes.subarray(3).toString('utf8'), '# Saved from real Electron\r\n\r\n**Still Markdown**\r\n')
  // Exercise actual IPC and file service with controlled dialog results, not arbitrary renderer paths.
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, saveAs)
  await page.keyboard.press('Control+Shift+s')
  await expect(page.getByRole('tab', { name: 'saved-as.md', exact: true })).toBeVisible()
  const savedBytes = await readFile(saveAs)
  assert.deepEqual(savedBytes, bytes)
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }) })
  await page.keyboard.press('Control+Shift+s')
  await expect(page.getByRole('tab', { name: 'saved-as.md', exact: true })).toBeVisible()
  await writeFile(saveAs, 'EXTERNAL EDIT MUST SURVIVE')
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('Would overwrite externally modified file')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#toast')).toContainText(/changed|modified|conflict/i)
  assert.equal(await readFile(saveAs, 'utf8'), 'EXTERNAL EDIT MUST SURVIVE')
  await expect(page.getByRole('tab', { name: 'saved-as.md', exact: true })).toHaveAttribute('data-dirty', 'true')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }) })
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab', { name: 'saved-as.md', exact: true })).toBeVisible()
  // Verify BrowserWindow isolation/security settings on the window actually running.
  const security = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0], p = w.webContents.getLastWebPreferences()
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }
  })
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: path.join(scratch, `elevenmd-${packaged ? 'packaged' : 'desktop'}-smoke.png`) })
  console.log(JSON.stringify({ result: 'PASS', mode: packaged ? 'packaged executable' : 'development Electron', checks: ['CLI file opening', 'formatted heading', 'real save IPC', 'UTF-8 BOM/CRLF preservation', 'Save As', 'cancelled Save As', 'external edit conflict protects disk', 'unsaved tab dismissal cancel', 'sandboxed isolated renderer', 'no page errors'], fixtureBytes: bytes.length }, null, 2))
} finally {
  await closeTestApp(app)
  await rm(temp, { recursive: true, force: true })
}
