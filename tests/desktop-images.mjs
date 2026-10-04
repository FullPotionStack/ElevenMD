import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
const dir = await mkdtemp(path.join(await testScratch(), 'notepad-desktop-images-'))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
await mkdir(path.join(dir, 'assets')); await writeFile(path.join(dir, 'assets', 'pixel.png'), png)
const target = path.join(dir, 'images.md'), picked = path.join(dir, 'picked.png')
const original = '# Images\n\n![Local](assets/pixel.png)\n'
await writeFile(target, original); await writeFile(picked, png)
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
let app
try {
  app = await electron.launch({ executablePath: packagedExecutable(), args: [target], env })
  const page = await app.firstWindow()
  const local = page.locator('.tiptap img[alt="Local"]')
  await expect.poll(() => local.evaluate(el => el.naturalWidth)).toBe(1)
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect.poll(() => page.locator('#preview img').evaluate(el => el.naturalWidth)).toBe(1)
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(original)
  await page.getByRole('button', { name: 'Formatted', exact: true }).click()
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, picked)
  await page.getByRole('button', { name: 'Insert image', exact: true }).click()
  await page.getByRole('textbox', { name: 'Image alt text', exact: true }).fill('Copied')
  await page.getByRole('button', { name: 'Choose local image…', exact: true }).click()
  await expect.poll(() => page.locator('.tiptap img[alt="Copied"]').evaluate(el => el.naturalWidth)).toBe(1)
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const source = await page.getByRole('textbox', { name: 'Markdown source' }).inputValue()
  const relative = source.match(/!\[Copied\]\(([^)]+)\)/)[1]
  assert.equal(relative.startsWith('images.assets/'), true)
  assert.deepEqual(await readFile(path.join(dir, decodeURIComponent(relative))), png)
  assert.equal(await readFile(target, 'utf8'), original, 'inserting image must not save the Markdown target automatically')
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('tab', { name: 'images.md', exact: true })).toHaveAttribute('data-dirty', 'false')
  assert.equal(await readFile(target, 'utf8'), source)
  assert.deepEqual(await readFile(picked), png)
  console.log('PASS: packaged app resolves local images through real IPC in formatted editor and Preview; native-picker integration copies images to assets; relative Markdown paths survive Save; originals preserved')
} finally { await closeTestApp(app); await rm(dir, { recursive: true, force: true }) }
