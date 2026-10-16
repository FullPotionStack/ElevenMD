import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp } from './helpers/electron-harness.mjs'

const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-update-progress-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(dir, 'profile') }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
let app
try {
  app = await electron.launch({ args: [path.resolve('electron/main.cjs')], env })
  const page = await app.firstWindow()
  await expect(page.getByRole('tab')).toBeVisible()
  // Controlled main-process HTTP transport only: exercise the real updater, IPC and renderer.
  // Never execute these deliberately non-executable fixture bytes.
  await app.evaluate(() => {
    const { createHash } = process.getBuiltinModule('node:crypto')
    const bytes = Buffer.alloc(128 * 1024, 7)
    const name = 'ElevenMD-Setup-999.0.0.exe'
    const base = 'https://github.com/FullPotionStack/ElevenMD/releases/download/v999.0.0/'
    globalThis.fetch = async url => {
      if (String(url).includes('/releases/latest')) return Response.json({ tag_name: 'v999.0.0', draft: false, prerelease: false, body: '# Controlled progress fixture', assets: [
        { name, size: bytes.length, browser_download_url: base + name },
        { name: 'SHA256SUMS', size: 130, browser_download_url: base + 'SHA256SUMS' },
      ] })
      if (url === base + 'SHA256SUMS') return new Response(`${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)
      if (url !== base + name) throw new Error('Unexpected test request')
      let offset = 0
      return new Response(new ReadableStream({ async pull(controller) {
        await new Promise(resolve => setTimeout(resolve, 120))
        if (offset === bytes.length) { controller.close(); return }
        controller.enqueue(bytes.subarray(offset, offset + 4096)); offset += 4096
      } }))
    }
  })
  // Construct an isolated real service after startup so the controlled transport cannot
  // affect unrelated app networking. The existing sandboxed bridge delivers its progress.
  await app.evaluate(async ({ BrowserWindow }, downloadDir) => {
    const require = process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json')
    const { createUpdateService } = require('./electron/updates.cjs')
    globalThis.progressService = createUpdateService({ version: '0.3.5', repository: 'FullPotionStack/ElevenMD', downloadsDir: downloadDir, platform: 'win32',
      fetchImpl: globalThis.fetch,
      onState: state => BrowserWindow.getAllWindows()[0].webContents.send('notepad:action', { type: 'update-progress', state }),
    })
    await progressService.check()
  }, path.join(dir, 'downloads'))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Updates', exact: true }).click()
  const downloading = app.evaluate(async () => progressService.download())
  const bar = page.getByRole('progressbar', { name: 'Update progress' })
  await expect(bar).toBeVisible()
  await expect.poll(() => bar.getAttribute('value')).not.toBe('0')
  const first = Number(await bar.getAttribute('value'))
  assert.ok(first > 0 && first < 128 * 1024)
  await expect.poll(async () => Number(await bar.getAttribute('value'))).toBeGreaterThan(first)
  await page.screenshot({ path: path.join(await testScratch(), 'elevenmd-update-download-progress.png') })
  assert.equal((await downloading).status, 'downloaded')
  await expect(bar).toBeHidden()
  await expect(page.locator('#update-status')).toContainText('Update ready')
  console.log('PASS Electron: real streaming update service → main action IPC → sandboxed renderer live progress; observed increasing bytes before completion. Controlled HTTP fixture only; no installer executed.')
} finally { await closeTestApp(app); await rm(dir, { recursive: true, force: true }) }
