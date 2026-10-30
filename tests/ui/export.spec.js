import { test, expect } from '@playwright/test'

test('plain Markdown checkpoints remain readable by the previous version schema', async ({ page }) => {
  await page.addInitScript(() => {
    window.snapshots = []
    window.notepad = { restoreSession: async () => ({ tabs: [], activeId: null, mode: 'formatted' }), initialFiles: async () => [], saveSession: async value => { window.snapshots.push(structuredClone(value)) }, preferences: async () => {}, setDirty: () => {}, onAction: () => {} }
  })
  await page.goto('/')
  await page.locator('.tiptap').fill('A plain document')
  await expect.poll(() => page.evaluate(() => window.snapshots.length)).toBeGreaterThan(0)
  const tab = await page.evaluate(() => window.snapshots.at(-1).tabs[0])
  expect(tab).not.toHaveProperty('rtfWarning')
  expect(tab).not.toHaveProperty('kind')
})

test('exports the current Markdown to RTF without marking its edits saved', async ({ page }) => {
  await page.addInitScript(() => {
    window.exports = []
    window.notepad = {
      restoreSession: async () => ({ tabs: [], activeId: null, mode: 'formatted' }),
      initialFiles: async () => [], saveSession: async () => ({}), preferences: async () => {}, setDirty: () => {}, onAction: () => {},
      exportRtf: async request => { window.exports.push(request); return { name: request.name } },
    }
  })
  await page.goto('/')
  await page.locator('.tiptap').fill('My exported note')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export RTF…' }).click()
  await expect.poll(() => page.evaluate(() => window.exports.length)).toBe(1)
  const request = await page.evaluate(() => window.exports[0])
  expect(request.data).toContain('My exported note')
  expect(request.data).toMatch(/^\{\\rtf1/)
  await expect(page.locator('#file-status')).toContainText('Unsaved changes')
})

test('exports Markdown as PDF without changing the document state', async ({ page }) => {
  await page.addInitScript(() => {
    window.pdfExports = []
    window.notepad = {
      restoreSession: async () => ({ tabs: [], activeId: null, mode: 'formatted' }),
      initialFiles: async () => [], saveSession: async () => ({}), preferences: async () => {}, setDirty: () => {}, onAction: () => {},
      exportPdf: async request => { window.pdfExports.push(request); return { name: request.name } },
    }
  })
  await page.goto('/')
  await page.locator('.tiptap').fill('PDF contents')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export PDF…' }).click()
  await expect.poll(() => page.evaluate(() => window.pdfExports.length)).toBe(1)
  expect((await page.evaluate(() => window.pdfExports[0])).html).toContain('PDF contents')
  await expect(page.locator('#file-status')).toContainText('Unsaved changes')
})

test('PDF export warns before replacing inaccessible images with text', async ({ page }) => {
  await page.addInitScript(() => {
    window.pdfExports = []
    window.notepad = {
      restoreSession: async () => ({ tabs: [], activeId: null, mode: 'source' }),
      initialFiles: async () => [], saveSession: async () => ({}), preferences: async () => {}, setDirty: () => {}, onAction: () => {},
      exportPdf: async request => { window.pdfExports.push(request); return { name: request.name } },
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill('![diagram](missing.png)')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export PDF…' }).click()
  await expect(page.getByRole('dialog')).toContainText('image')
  expect(await page.evaluate(() => window.pdfExports.length)).toBe(0)
  await page.getByRole('button', { name: 'Export anyway' }).click()
  await expect.poll(() => page.evaluate(() => window.pdfExports.length)).toBe(1)
  expect((await page.evaluate(() => window.pdfExports[0])).html).toContain('[Image: diagram]')
})
