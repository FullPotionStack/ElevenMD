import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
const dir = await mkdtemp(path.join(await testScratch(), 'notepad-session-restart-'))
const target = path.join(dir, 'original.md'), profile = path.join(dir, 'profile')
const original = Buffer.from('\ufeff# Original\r\n', 'utf8')
await writeFile(target, original)
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
const launch = args => electron.launch(process.argv.includes('--packaged') ? { executablePath: packagedExecutable(), args, env } : { args: [path.resolve('electron/main.cjs'), ...args], env })
let app
try {
  app = await launch([target])
  let page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: 'original.md', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Buffer kept separate\n')
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Unnamed, kept after quit\n')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('dark')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('Quit must never ask to save.') }; dialog.showSaveDialog = async () => { throw new Error('Quit must never write a target file.') } })
  const closed = page.waitForEvent('close', { timeout: 15000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed; await closeTestApp(app); app = undefined
  assert.deepEqual(await readFile(target), original)
  const stored = JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8'))
  assert.equal(stored.tabs.length, 2)
  assert.deepEqual(stored.tabs.map(t => t.content), ['# Buffer kept separate\n', '# Unnamed, kept after quit\n'])
  app = await launch([]); page = await app.firstWindow()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Unnamed, kept after quit\n')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('tab', { name: 'original.md', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Buffer kept separate\n')
  assert.deepEqual(await readFile(target), original)
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'original.md', exact: true })).toHaveAttribute('data-dirty', 'false')
  assert.deepEqual(await readFile(target), Buffer.from('\ufeff# Buffer kept separate\r\n', 'utf8'))
  console.log('PASS: normal dirty-window quit has no prompts; full disk-backed session survives process restart; both tabs and active tab restored; original BOM/CRLF bytes untouched until explicit Save; restored file can Save directly')
} finally { await closeTestApp(app); await rm(dir, { recursive: true, force: true }) }
