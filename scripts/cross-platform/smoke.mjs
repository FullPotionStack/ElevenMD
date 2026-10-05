// Native CI invokes this against EXTRACTED portable and INSTALLED app artifacts.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { _electron as electron } from '@playwright/test'

const executablePath = process.env.NOTEPAD_EXECUTABLE_PATH
if (!executablePath || !path.isAbsolute(executablePath)) throw new Error('An absolute NOTEPAD_EXECUTABLE_PATH is required.')
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const scratchBase = process.env.ELEVENMD_TEST_SCRATCH || process.env.TMPDIR || os.tmpdir()
await mkdir(scratchBase, { recursive: true })
const scratch = await mkdtemp(path.join(scratchBase, 'elevenmd-native-smoke-'))
let app
try {
  const env = { ...process.env, NOTEPAD_USER_DATA_DIR: scratch }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath, args: [], env, timeout: 30_000 })
  const window = await app.firstWindow({ timeout: 30_000 })
  await window.waitForLoadState('domcontentloaded')
  await window.getByRole('button', { name: 'Source', exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  assert.match(await window.title(), /ElevenMD/)
  assert.match(window.url(), /^file:/)
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return { packaged: app.isPackaged, version: app.getVersion(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, platform: process.platform, arch: process.arch }
  })
  assert.equal(runtime.packaged, true)
  assert.equal(runtime.version, pkg.version)
  assert.equal(runtime.sandbox, true)
  assert.equal(runtime.contextIsolation, true)
  assert.equal(runtime.nodeIntegration, false)
  assert.equal(runtime.platform, process.platform)
  assert.equal(runtime.arch, process.arch)
  assert.match(await window.locator('body').innerText(), /Source/)
  // Exercise the actual sandboxed preload/main IPC, not only a simulated platform unit test.
  const updateState = await window.evaluate(async () => {
    const before = await window.notepad.updatesState()
    const download = await window.notepad.downloadUpdate()
    const install = await window.notepad.installUpdate()
    return { before, download, install }
  })
  for (const state of Object.values(updateState)) {
    assert.equal(state.manualDownload, true)
    assert.notEqual(state.status, 'downloaded')
    assert.notEqual(state.status, 'downloading')
    assert.notEqual(state.installed, true)
  }
  console.log('PASS native manual release-link updater: Windows installer actions are inert')
  console.log(`PASS packaged native launch ${JSON.stringify(runtime)}: ${executablePath}`)
} finally {
  if (app) {
    // This clean launch owns its windows; no user data and no unsaved-close prompt.
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy() }).catch(() => {})
    await app.close()
  }
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
