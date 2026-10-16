import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'

const dir = await mkdtemp(path.join(await testScratch(), 'notepad-tab-customization-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(dir, 'profile') }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
const launch = () => electron.launch(process.argv.includes('--packaged')
  ? { executablePath: packagedExecutable(), args: [], env }
  : { args: [path.resolve('electron/main.cjs')], env })
let app
async function naturalExit(action) {
  const child = app.process()
  const exited = once(child, 'exit')
  await action()
  const [code] = await Promise.race([exited, new Promise((_, reject) => {
    const timeout = setTimeout(() => reject(new Error('App did not naturally exit after the last tab closed')), 10000)
    exited.finally(() => clearTimeout(timeout))
  })])
  assert.equal(code, 0)
  app = undefined
}
try {
  app = await launch()
  let page = await app.firstWindow()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await page.getByRole('tab').click({ button: 'right' })
  await page.getByRole('button', { name: 'Blue', exact: true }).click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill('Private fixture draft')
  await naturalExit(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()))
  let state = JSON.parse(await readFile(path.join(dir, 'profile', 'session.json'), 'utf8'))
  assert.equal(state.tabs[0].color, '#60a5fa')
  assert.equal(state.tabs[0].content, 'Private fixture draft')
  app = await launch(); page = await app.firstWindow()
  await expect(page.locator('.tab-color-strip')).toHaveCSS('background-color', 'rgb(96, 165, 250)')
  await expect(page.locator('#source')).toHaveValue('Private fixture draft')
  // Controlled native confirmation responses; not a visual native-dialog test.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }) })
  await page.keyboard.press('Control+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('#source')).toHaveValue('Private fixture draft')
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) })
  await naturalExit(() => page.getByRole('button', { name: 'Close Untitled 1', exact: true }).click())
  state = JSON.parse(await readFile(path.join(dir, 'profile', 'session.json'), 'utf8'))
  assert.deepEqual(state.tabs, [])
  app = await launch(); page = await app.firstWindow()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('#source')).toHaveValue('')
  await expect(page.locator('.tab-color-strip')).toHaveCount(0)
  await naturalExit(() => page.keyboard.press('Control+w'))
  console.log('PASS: packaged/source Electron preserves tab color and unsaved text across normal quit/restart; Cancel protects final dirty tab; Discard exits naturally with an empty session; next launch is blank; clean final-tab Ctrl+W exits naturally.')
} finally { await closeTestApp(app); await rm(dir, { recursive: true, force: true }) }
