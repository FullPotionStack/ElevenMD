import { test, expect } from '@playwright/test'
test('quitting checkpoints all tabs without asking to save or touching target files', async ({ page }) => {
  await page.addInitScript(() => {
    window.confirmCount = 0
    window.notepad = {
      initialFiles: async () => [{ id: '11111111-1111-4111-8111-111111111111', path: 'C:/docs/original.md', name: 'original.md', content: '# Original', eol: 'LF', bom: false }],
      restoreSession: async () => null,
      saveSession: async payload => { window.sessionSnapshot = structuredClone(payload); return { stored: true } },
      setDirty: () => {}, preferences: async () => {},
      confirmClose: async () => { window.confirmCount++; return 'cancel' },
      closeWindow: async () => { window.didClose = true },
      onAction: callback => { window.nativeAction = callback },
    }
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'original.md', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Edited original')
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown source' }).fill('# Unnamed text')
  await page.evaluate(() => window.nativeAction('close-window'))
  await expect.poll(() => page.evaluate(() => window.didClose)).toBe(true)
  expect(await page.evaluate(() => window.confirmCount)).toBe(0)
  const snapshot = await page.evaluate(() => window.sessionSnapshot)
  expect(snapshot.tabs.map(tab => tab.content)).toEqual(['# Edited original', '# Unnamed text'])
  expect(snapshot.tabs[0].savedContent).toBe('# Original')
  expect(snapshot.tabs[0]).not.toHaveProperty('path')
  expect(snapshot.activeId).toBe(snapshot.tabs[1].id)
})
