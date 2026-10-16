import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'

const dir = await mkdtemp(path.join(await testScratch(), 'notepad-tab-rendering-'))
const target = path.join(dir, 'restored.md'), opened = path.join(dir, 'opened.md')
const original = '# Restored document\n', extra = '# Newly opened document\n'
await writeFile(target, original); await writeFile(opened, extra)
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(dir, 'profile') }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
const launch = args => electron.launch(process.argv.includes('--packaged')
  ? { executablePath: packagedExecutable(), args, env }
  : { args: [path.resolve('electron/main.cjs'), ...args], env })
let app
try {
  app = await launch([target])
  let page = await app.firstWindow()
  await expect(page.locator('.tiptap')).toContainText('Restored document')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.locator('#preview')).toContainText('Restored document')
  const closed = page.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed; await closeTestApp(app); app = undefined
  const session = JSON.parse(await readFile(path.join(dir, 'profile', 'session.json'), 'utf8'))
  assert.equal(session.mode, 'preview')
  app = await launch([]); page = await app.firstWindow()
  await expect(page.locator('#preview')).toBeVisible()
  await expect(page.locator('#preview')).toContainText('Restored document')
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.toolbar')).toBeHidden()
  // Exercise native CLI opening on top of the restored session in another clean process.
  const closedAgain = page.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closedAgain; await closeTestApp(app); app = undefined
  app = await launch([opened]); page = await app.firstWindow()
  await expect(page.locator('#preview')).toBeVisible()
  await expect(page.locator('#preview')).toContainText('Newly opened document')
  await page.getByRole('tab', { name: 'restored.md', exact: true }).click()
  await expect(page.locator('#preview')).toContainText('Restored document')
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(page.locator('#preview')).toBeVisible()
  const tabs = page.locator('#tablist'), selected = page.getByRole('tab', { selected: true })
  const name = await selected.getAttribute('aria-label')
  await tabs.evaluate(el => { el.scrollLeft = 0 })
  await tabs.hover(); await page.mouse.wheel(0, 240)
  await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await expect(selected).toHaveAttribute('aria-label', name)
  assert.equal(await readFile(target, 'utf8'), original)
  assert.equal(await readFile(opened, 'utf8'), extra)
  console.log('PASS: Electron normal quit/restart restores a visible Preview and synchronized controls; CLI-opened, switched and new tabs stay visible; wheel scrolls native tab strip without changing selection; fixture files unchanged.')
} finally { await closeTestApp(app); await rm(dir, { recursive: true, force: true }) }
