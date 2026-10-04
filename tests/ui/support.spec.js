import { test, expect } from '@playwright/test'

async function desktop(page, update = { status: 'available', version: '0.4.0', notes: 'A useful fix\n<script>alert(1)</script>', releaseUrl: 'https://github.com/FullPotionStack/ElevenMD/releases/tag/v0.4.0' }) {
  await page.addInitScript(({ update }) => {
    window.supportCalls = []
    let consent = null
    window.notepad = {
      setDirty: async () => {}, preferences: async () => {}, initialFiles: async () => [], onAction: () => {},
      saveSession: async () => { window.supportCalls.push('checkpoint') },
      restoreSession: async () => ({ tabs: [] }),
      updatesState: async () => ({ status: 'idle' }),
      checkUpdates: async () => { window.supportCalls.push('check'); return update },
      downloadUpdate: async () => { window.supportCalls.push('download'); return { ...update, status: 'downloaded' } },
      installUpdate: async () => { window.supportCalls.push('install'); return { ...update, status: 'downloaded', cancelled: true } },
      openRelease: async () => { window.supportCalls.push('release') },
      diagnosticsState: async () => ({ consent, count: 0 }),
      diagnosticsConsent: async value => { consent = value; window.supportCalls.push(`consent:${value}`); return { consent, count: 0 } },
      diagnosticsInspect: async () => ({ schema: 1, consent, events: [], environment: { version: '0.3.0', platform: 'win32' } }),
      diagnosticsClear: async () => ({ consent, count: 0 }),
      diagnosticsExport: async () => { window.supportCalls.push('export'); return true },
      reportBug: async value => { window.supportCalls.push({ report: value }); return true },
      recordDiagnostic: async event => { window.supportCalls.push({ event }) },
    }
  }, { update })
  await page.goto('/')
  await expect(page.getByRole('tab')).toBeVisible()
}

test('startup only checks releases; user chooses download and installation after checkpoint', async ({ page }) => {
  await desktop(page)
  await expect(page.getByRole('button', { name: 'Update available: 0.4.0' })).toBeVisible()
  expect(await page.evaluate(() => supportCalls.filter(x => x === 'check').length)).toBe(1)
  expect(await page.evaluate(() => supportCalls.includes('download'))).toBe(false)
  await page.getByRole('button', { name: 'Update available: 0.4.0' }).click()
  await expect(page.locator('#release-notes')).toContainText('<script>alert(1)</script>')
  expect(await page.locator('#release-notes script').count()).toBe(0)
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Install and restart', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Install and restart', exact: true }).click()
  const calls = await page.evaluate(() => supportCalls)
  expect(calls.indexOf('checkpoint')).toBeLessThan(calls.indexOf('install'))
})

test('manual checks show a dialog while a request is pending', async ({ page }) => {
  await desktop(page, { status: 'current' })
  await page.evaluate(() => { notepad.checkUpdates = () => new Promise(resolve => { window.finishCheck = resolve }) })
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Check updates', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 })
  await expect(page.locator('#update-description')).toContainText('Checking')
  await page.evaluate(() => finishCheck({ status: 'current' }))
  await expect(page.locator('#update-description')).toContainText('up to date')
})

test('diagnostics require a decision and can be inspected and disabled', async ({ page }) => {
  await desktop(page, { status: 'current', version: '0.3.0' })
  expect(await page.evaluate(() => supportCalls.some(x => String(x).startsWith('consent:')))).toBe(false)
  await page.getByRole('button', { name: 'Choose diagnostics privacy' }).click()
  await expect(page.getByRole('dialog')).toContainText('200')
  await expect(page.getByRole('dialog')).toContainText('document text')
  await page.getByRole('button', { name: 'Enable sanitized local logs', exact: true }).click()
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Diagnostics & privacy', exact: true }).click()
  await page.getByRole('button', { name: 'Inspect logs', exact: true }).click()
  await expect(page.locator('#diagnostics-preview')).toContainText('win32')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Disable and delete logs', exact: true }).click()
  expect(await page.evaluate(() => supportCalls)).toContain('consent:false')
})

test('diagnostic read/clear failures warn about disk history and do not escape as page errors', async ({ page }) => {
  await desktop(page, { status: 'current' })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Choose diagnostics privacy' }).click()
  await page.evaluate(() => {
    notepad.diagnosticsInspect = async () => { throw new Error('Synthetic failure') }
    notepad.diagnosticsClear = async () => { throw new Error('Synthetic failure') }
    notepad.diagnosticsState = async () => ({ consent: false, count: 0, storageError: 'diagnostics_storage' })
  })
  await page.getByRole('button', { name: 'Inspect logs' }).click()
  await expect(page.locator('#diagnostics-status')).toContainText('may remain')
  await expect(page.locator('#toast')).toContainText('Could not inspect')
  await page.getByRole('button', { name: 'Clear logs' }).click()
  await expect(page.locator('#toast')).toContainText('Could not clear')
  expect(errors).toEqual([])
})

test('late inspection or update completion never replaces a closed or unrelated dialog', async ({ page }) => {
  await desktop(page, { status: 'current' })
  await page.evaluate(() => { notepad.diagnosticsInspect = () => new Promise(resolve => { window.finishInspection = resolve }) })
  await page.getByRole('button', { name: 'Choose diagnostics privacy' }).click()
  await page.getByRole('button', { name: 'Inspect logs' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.evaluate(() => finishInspection({ events: [] }))
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Settings')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.evaluate(() => { notepad.checkUpdates = () => new Promise(resolve => { window.finishUpdate = resolve }) })
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Check updates', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.evaluate(() => finishUpdate({ status: 'current' }))
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Settings')
})

test('meaningful UI actions produce only enum diagnostics, not typed text or search strings', async ({ page }) => {
  await desktop(page, { status: 'current' })
  await page.locator('.tiptap').fill('PRIVATE TYPING SENTINEL')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('PRIVATE SEARCH')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const events = await page.evaluate(() => supportCalls.filter(x => x?.event).map(x => x.event))
  expect(events).toContainEqual({ type: 'formatting', action: 'bold', outcome: 'success' })
  expect(events).toContainEqual({ type: 'mode_changed', mode: 'source' })
  expect(events).toContainEqual({ type: 'find_replace', action: 'find_next', outcome: 'noop' })
  expect(JSON.stringify(events)).not.toContain('PRIVATE')
})

test('report composer sends only explicitly reviewed text and defaults to excluding diagnostics', async ({ page }) => {
  await desktop(page, { status: 'current', version: '0.3.0' })
  await page.locator('.tiptap').fill('PRIVATE DOCUMENT SENTINEL')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Report a bug', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Include sanitized diagnostics' })).not.toBeChecked()
  await page.getByRole('textbox', { name: 'Report title' }).fill('Preview defect')
  await page.getByRole('textbox', { name: 'Steps to reproduce' }).fill('1. Switch to preview')
  await page.getByRole('textbox', { name: 'Expected behavior' }).fill('Show the list')
  await page.getByRole('textbox', { name: 'Actual behavior' }).fill('The list is missing')
  await page.getByRole('button', { name: 'Review report', exact: true }).click()
  await expect(page.locator('#bug-preview')).not.toContainText('PRIVATE DOCUMENT SENTINEL')
  await expect(page.locator('#bug-preview')).toContainText('Switch to preview')
  await page.getByRole('button', { name: 'Open GitHub issue', exact: true }).click()
  const report = await page.evaluate(() => supportCalls.find(x => x?.report)?.report)
  expect(report.includeDiagnostics).toBe(false)
  expect(report.body).not.toContain('PRIVATE DOCUMENT SENTINEL')
})
