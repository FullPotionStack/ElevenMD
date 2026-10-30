import { test, expect } from '@playwright/test'

test('privacy controls disclose automatic critical-only collection', async ({ page }) => {
  await page.addInitScript(() => {
    window.notepad = {
      restoreSession: async () => ({ tabs: [], activeId: null, mode: 'formatted' }), initialFiles: async () => [],
      saveSession: async () => ({}), preferences: async () => {}, setDirty: () => {}, onAction: () => {},
      diagnosticsState: async () => ({ consent: null, enabled: true, count: 0 }),
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Privacy & diagnostics' }).click()
  await expect(page.locator('#diagnostics-status')).toContainText('Automatic')
  await expect(page.locator('#disable-diagnostics')).toContainText('Disable')
  await expect(page.locator('#settings-diagnostics')).toContainText(/warnings/i)
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByLabel('Language').selectOption('pt-BR')
  await page.getByRole('tab', { name: 'Privacidade e diagnóstico' }).click()
  await expect(page.locator('#settings-diagnostics')).toContainText('automaticamente')
  await expect(page.locator('#disable-diagnostics')).toContainText('Desativar')
})
