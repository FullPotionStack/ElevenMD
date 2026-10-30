import { test, expect } from '@playwright/test'

test('Portuguese update progress translates the dynamic percentage', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = []
    window.emitUpdate = state => listeners.forEach(callback => callback({ type: 'update-progress', state }))
    window.notepad = {
      initialFiles: async () => [], setDirty: () => {}, preferences: async () => {},
      onAction: callback => { listeners.push(callback) },
      checkUpdates: async () => ({ status: 'available', version: '0.4.0', notes: 'Save' }),
      downloadUpdate: () => new Promise(resolve => { window.finishDownload = resolve }),
    }
  })
  await page.goto('/')
  await expect(page.locator('#update-status')).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Language').selectOption('pt-BR')
  await page.getByRole('button', { name: 'Concluído' }).click()
  await page.locator('#update-status').click()
  await page.getByRole('button', { name: 'Baixar atualização', exact: true }).click()
  await page.evaluate(() => emitUpdate({ status: 'downloading', version: '0.4.0', progress: { received: 250, total: 1000 } }))
  await expect(page.locator('#update-progress-text')).toHaveText('Baixando atualização… 25%')
  await expect(page.locator('#update-status')).toHaveText('Baixando atualização… 25%')
})

for (const theme of ['light', 'dark']) {
  test(`update progress is live, accessible and survives closing Settings in ${theme}`, async ({ page }) => {
    await page.addInitScript(() => {
      const listeners = []
      const available = { status: 'available', version: '0.4.0', notes: '# Fixes' }
      window.emitUpdate = state => listeners.forEach(callback => callback({ type: 'update-progress', state }))
      window.notepad = {
        initialFiles: async () => [], setDirty: () => {}, preferences: async () => {},
        onAction: callback => { listeners.push(callback) },
        checkUpdates: async () => available,
        downloadUpdate: () => new Promise(resolve => { window.finishDownload = resolve }),
      }
    })
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Quick theme' }).selectOption(theme)
    await page.getByRole('button', { name: 'Update available: 0.4.0' }).click()
    await page.getByRole('button', { name: 'Download update', exact: true }).click()
    await page.evaluate(() => emitUpdate({ status: 'downloading', version: '0.4.0', progress: { received: 250, total: 1000 } }))
    const progress = page.getByRole('progressbar', { name: 'Update progress' })
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute('value', '250')
    await expect(progress).toHaveAttribute('max', '1000')
    await expect(page.locator('#update-progress-text')).toContainText('25%')
    await expect(page.locator('#update-description')).toContainText('Downloading')
    await expect(page.locator('#check-updates')).toBeDisabled()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.evaluate(() => emitUpdate({ status: 'downloading', version: '0.4.0', progress: { received: 750, total: 1000 } }))
    await expect(page.locator('#update-status')).toContainText('75%')
    await page.locator('#update-status').click()
    await expect(progress).toHaveAttribute('value', '750')
    await page.evaluate(() => emitUpdate({ status: 'verifying', version: '0.4.0', progress: { received: 1000, total: 1000 } }))
    await expect(progress).not.toHaveAttribute('value')
    await expect(page.locator('#update-progress-text')).toContainText('Verifying')
    await page.evaluate(() => finishDownload({ status: 'downloaded', version: '0.4.0', progress: { received: 1000, total: 1000 } }))
    await expect(progress).toBeHidden()
    await expect(page.getByRole('button', { name: 'Install and restart', exact: true })).toBeVisible()
    await expect(page.locator('#check-updates')).toBeEnabled()
  })
}
