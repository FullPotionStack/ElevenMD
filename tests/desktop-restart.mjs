import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
const temp = await mkdtemp(path.join(await testScratch(), 'notepad-restart-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(temp, 'profile') }; delete env.ELECTRON_RUN_AS_NODE
const options = { executablePath: packagedExecutable(), args: [], env }
let app
async function stop() {
  if (!app) return
  const page = app.windows()[0]
  const closed = page?.waitForEvent('close', { timeout: 15000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await closed
  await closeTestApp(app); app = undefined
}
try {
  app = await electron.launch(options)
  let page = await app.firstWindow()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Draft across an actual restart')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'App theme' }).selectOption('dark')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await stop()
  app = await electron.launch(options)
  page = await app.firstWindow()
  await expect(page.getByRole('tab')).toHaveAttribute('data-dirty', 'true')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue('# Draft across an actual restart')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  console.log('PASS: unsaved draft and theme survive complete packaged-app restart')
} finally { await stop(); await rm(temp, { recursive: true, force: true }) }
