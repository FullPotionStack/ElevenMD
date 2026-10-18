import { test, expect } from '@playwright/test'
const id = '11111111-1111-4111-8111-111111111111'
async function start(page, content = 'base\n', status = 'same') {
  await page.addInitScript(({ id, content, status }) => {
    window.disk = { status, content: 'outside\n', revision: 'revision-1', writes: [], snapshots: [] }
    window.notepad = {
      restoreSession: async () => ({ tabs: [{ id, name: 'note.md', path: 'FIXTURE:/note.md', content, savedContent: 'base\n', eol: 'LF', bom: false }], activeId: id, mode: 'source' }), initialFiles: async () => [],
      inspectFiles: async () => [{ id, ...window.disk }],
      resolveFile: async request => {
        if (request.revision !== window.disk.revision) throw new Error('File changed again. Review it.')
        if (window.disk.pauseReload && request.action === 'reload') await new Promise(resolve => { window.disk.resumeReload = resolve })
        if (request.action !== 'reload') { window.disk.writes.push(request); window.disk.content = request.content; window.disk.status = 'same' }
        return { id, name: 'note.md', path: 'FIXTURE:/note.md', content: window.disk.content, eol: 'LF', bom: false }
      },
      adoptFile: async request => { if (request.revision !== window.disk.revision) throw new Error('File changed again.'); window.disk.status = 'same' },
      saveSession: async value => { window.disk.snapshots.push(structuredClone(value)); return { stored: true } },
      preferences: async () => {}, setDirty: () => {}, onAction: callback => { window.disk.action = callback },
      save: async () => { throw new Error('Normal Save must not bypass conflict resolution') },
    }
  }, { id, content, status })
  await page.goto('/'); await expect(page.locator('#source')).toHaveValue(content)
}
async function change(page, status = 'changed', content = 'outside\n') {
  await page.evaluate(({ status, content }) => { window.disk.status = status; window.disk.content = content; window.disk.revision += '-next'; window.disk.action({ type: 'files-changed' }) }, { status, content })
}
test('clean buffer reloads external text and previous buffer remains recoverable', async ({ page }) => {
  await start(page); await change(page)
  await expect(page.locator('#source')).toHaveValue('outside\n')
  await page.getByRole('button', { name: 'Restore previous buffer', exact: true }).click()
  await expect(page.locator('#source')).toHaveValue('base\n')
  await expect(page.locator('#file-status')).toContainText('Unsaved')
})
test('dirty conflict compares safely and resolves only the reviewed disk revision', async ({ page }) => {
  await start(page); await page.locator('#source').fill('my edit\n'); await change(page, 'changed', '<img src=x onerror=alert(1)>\n')
  await expect(page.getByRole('tab')).toHaveAttribute('data-file-state', 'changed')
  await page.getByRole('button', { name: 'Compare changes', exact: true }).click()
  await expect(page.getByLabel('Your version', { exact: true })).toHaveValue('my edit\n')
  await expect(page.getByLabel('Disk version', { exact: true })).toHaveValue('<img src=x onerror=alert(1)>\n')
  await expect(page.locator('#file-comparison img')).toHaveCount(0)
  await change(page, 'changed', 'newer outside\n')
  await page.getByRole('button', { name: 'Overwrite disk with mine', exact: true }).click()
  await expect(page.locator('#toast')).toContainText('changed again')
  expect(await page.evaluate(() => window.disk.writes.length)).toBe(0)
  await expect(page.locator('#source')).toHaveValue('my edit\n')
})
test('missing file retains text and offers explicit recreation instead of Saved', async ({ page }) => {
  await start(page); await change(page, 'missing')
  await expect(page.locator('#file-status')).toContainText('File missing')
  await expect(page.locator('#source')).toHaveValue('base\n')
  await page.getByRole('button', { name: 'Recreate file', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.disk.writes.length)).toBe(1)
  expect(await page.evaluate(() => window.disk.writes[0].action)).toBe('recreate')
})
test('typing while an automatic reload is in flight preserves the new edit as a conflict', async ({ page }) => {
  await start(page); await page.evaluate(() => { window.disk.pauseReload = true }); await change(page)
  await expect.poll(() => page.evaluate(() => typeof window.disk.resumeReload)).toBe('function')
  await page.locator('#source').fill('typed during reload')
  await page.evaluate(() => window.disk.resumeReload())
  await expect(page.locator('#source')).toHaveValue('typed during reload')
  await expect(page.getByRole('button', { name: 'Compare changes', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.disk.status)).toBe('changed')
})
