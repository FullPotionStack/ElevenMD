import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp, packagedExecutable } from './helpers/electron-harness.mjs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-exports-'))
const source = path.join(dir, 'source.md'), original = '# Export title\n\n**Original** text\n'
await writeFile(source, original)
const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(dir, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  const options = process.argv.includes('--packaged') ? { executablePath: packagedExecutable(), args: [source] } : { args: ['.', source] }
  app = await electron.launch({ ...options, env, timeout: 30000 })
  const page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: 'source.md', exact: true })).toBeVisible()
  for (const format of ['RTF', 'PDF']) {
    const target = path.join(dir, `result.${format.toLowerCase()}`)
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, target)
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: `Export ${format}…` }).click()
    await expect(page.locator('#toast')).toContainText(`${format} exported`, { timeout: 30000 })
    const bytes = await readFile(target)
    assert.ok(bytes.length > 100)
    assert.equal(bytes.subarray(0, format === 'PDF' ? 5 : 6).toString(), format === 'PDF' ? '%PDF-' : '{\\rtf1')
    if (format === 'PDF') {
      const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false })
      const pdf = await task.promise
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ')
      assert.match(text, /Export title/); assert.match(text, /Original/)
      await task.destroy()
    }
    assert.equal(await readFile(source, 'utf8'), original)
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, target)
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Open…' }).click()
    await expect(page.locator('#toast')).toContainText('not supported')
    await expect(page.getByRole('tab', { name: `result.${format.toLowerCase()}`, exact: true })).toHaveCount(0)
    assert.deepEqual(await readFile(target), bytes)
    console.log(`${format}: exported ${bytes.length} bytes; opening rejected; original files unchanged`)
  }
} finally {
  await closeTestApp(app)
  await rm(dir, { recursive: true, force: true })
}
