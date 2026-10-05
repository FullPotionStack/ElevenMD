import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'

// Explicit live-release check: run after publication, not in the offline unit suite.
const scratch = await testScratch(), dir = await mkdtemp(path.join(scratch, 'elevenmd-release-notes-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: dir }
delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
let app
try {
  app = await electron.launch({ executablePath: packagedExecutable(), args: [], env })
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('tab')).toBeVisible()
  const recordedIndex = process.argv.indexOf('--recorded-release')
  if (recordedIndex !== -1) {
    // Explicit recorded-transport lane for rate-limited/offline verification.
    // This changes only handlers in this harness-owned process, never shipped files.
    await expect.poll(() => page.evaluate(() => notepad.updatesState().then(state => state.status)), { timeout: 20000 }).toMatch(/current|error|available|unpublished/)
    const recorded = JSON.parse(await readFile(process.argv[recordedIndex + 1], 'utf8'))
    await app.evaluate(({ app, ipcMain }, release) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
      const { createUpdateService } = require('./electron/updates.cjs')
      const distribution = require('./electron/distribution.cjs')
      const api = `https://api.github.com/repos/${distribution.repository}/releases/latest`
      const service = createUpdateService({ version: app.getVersion(), repository: distribution.repository,
        downloadsDir: app.getPath('userData') + '/recorded-updates', fetchImpl: async url => {
          if (url !== api) throw new Error('Recorded lane must not fetch assets.')
          return new Response(JSON.stringify(release), { headers: { 'Content-Type': 'application/json' } })
        } })
      ipcMain.removeHandler('notepad:updates-check'); ipcMain.removeHandler('notepad:updates-state')
      ipcMain.handle('notepad:updates-check', () => service.check())
      ipcMain.handle('notepad:updates-state', () => service.getState())
    }, recorded)
    console.log('Recorded public-release transport selected; this is not live-network verification.')
  }
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Quick theme' }).selectOption(theme)
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Check updates', exact: true }).click()
    await expect(page.locator('#update-description')).toHaveText('You are up to date.', { timeout: 20000 })
    const notes = page.getByRole('region', { name: 'Release notes', exact: true })
    await expect(notes.getByRole('heading', { name: 'Changes', exact: true })).toBeVisible()
    const version = await app.evaluate(({ app }) => app.getVersion())
    await expect(notes.getByRole('heading', { name: version, exact: true })).toBeVisible()
    await expect(notes.locator('ul > li').first()).toContainText('formatted Markdown')
    assert.equal(await notes.locator('script, img, a, iframe').count(), 0)
    assert.equal(await notes.evaluate(node => getComputedStyle(node).whiteSpace), 'normal')
    await page.screenshot({ path: path.join(scratch, `elevenmd-release-notes-${theme}.png`) })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }
  assert.deepEqual(errors, [])
  console.log('PASS published release notes through real main IPC in the packaged/installed app: semantic Markdown headings/lists, normal prose font, no active HTML/links/images, light/dark screenshots and no renderer errors.')
} finally { await closeTestApp(app); await rm(dir, { recursive: true, force: true }) }
