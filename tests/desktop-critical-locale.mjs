import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'

const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-auto-logs-'))
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: dir }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  const options = process.argv.includes('--packaged') ? { executablePath: packagedExecutable(), args: [] } : { args: ['.'] }
  app = await electron.launch({ ...options, env, timeout: 30000 })
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  await page.evaluate(() => console.warn('SECRET_DIAGNOSTIC_FIXTURE'))
  const file = path.join(dir, 'diagnostics.json')
  await expect.poll(async () => {
    try { return JSON.parse(await readFile(file, 'utf8')).events.some(e => e.type === 'warning' && e.category === 'renderer') } catch { return false }
  }).toBe(true)
  await page.evaluate(async () => { try { await window.notepad.exportRtf({ data: 'SECRET_DIAGNOSTIC_FIXTURE', unexpected: true }) } catch {} })
  await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).events.some(e => e.type === 'error' && e.category === 'file_write')).toBe(true)
  assert.equal((await readFile(file, 'utf8')).includes('SECRET_DIAGNOSTIC_FIXTURE'), false)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Language').selectOption('pt-BR')
  await page.getByRole('button', { name: 'Concluído' }).click()
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async (_window, options) => { globalThis.testOpenOptions = options; return { canceled: true, filePaths: [] } } })
  await page.getByRole('button', { name: 'Arquivo', exact: true }).click()
  await page.getByRole('menuitem', { name: /Abrir/ }).click()
  await expect.poll(() => app.evaluate(() => globalThis.testOpenOptions?.title)).toBe('Abrir')
  assert.deepEqual(await app.evaluate(() => globalThis.testOpenOptions.filters[0].extensions), ['md', 'markdown', 'txt'])
  console.log('PASS: actual Electron warning and export failure saved as sanitized categories; Portuguese native Open dialog and filters verified')
} finally {
  await closeTestApp(app)
  await rm(dir, { recursive: true, force: true })
}
