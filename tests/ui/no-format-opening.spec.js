import { test, expect } from '@playwright/test'

test('opening an RTF or PDF event never creates a format tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.notepad = {
      restoreSession: async () => ({ tabs: [], activeId: null, mode: 'formatted' }),
      initialFiles: async () => [], saveSession: async () => ({}), preferences: async () => {}, setDirty: () => {},
      onAction: callback => { window.deliverAction = callback },
    }
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Untitled 1' })).toBeVisible()
  await page.evaluate(() => window.deliverAction({ type: 'opened', files: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'example.rtf', kind: 'rtf', data: btoa('{\\rtf1 hello}') },
    { id: '22222222-2222-4222-8222-222222222222', name: 'example.pdf', kind: 'pdf', data: btoa('%PDF-test') },
  ] }))
  await page.waitForTimeout(1000) // Opening is asynchronous, including conversion and viewer loading.
  await expect(page.getByRole('tab', { name: 'Untitled 1' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /example/ })).toHaveCount(0)
})

test('legacy browser session is backed up and its converted draft survives without reopening PDF', async ({ page }) => {
  await page.addInitScript(() => {
    const hash = 'a'.repeat(64), pdf = btoa('%PDF-test')
    const state = { tabs: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'old.rtf.md', content: 'Important draft', savedContent: null, eol: 'LF', bom: false, sourceKind: 'rtf', sourceHash: hash, sourceBaseline: 'Old', rtfWarning: true },
      { id: '22222222-2222-4222-8222-222222222222', name: 'old.pdf', content: pdf, savedContent: pdf, kind: 'pdf', eol: 'LF', bom: false },
    ], activeId: '22222222-2222-4222-8222-222222222222', mode: 'source' }
    localStorage.setItem('notepad-session', JSON.stringify(state))
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'old.rtf.md' })).toBeVisible()
  await expect(page.locator('#source')).toHaveValue('Important draft')
  await expect(page.getByRole('tab', { name: 'old.pdf' })).toHaveCount(0)
  const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('notepad-legacy-formats-backup')))
  expect(backup.tabs).toHaveLength(2)
  expect(backup.tabs[1].kind).toBe('pdf')
})
