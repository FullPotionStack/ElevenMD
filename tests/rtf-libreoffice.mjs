import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { testScratch } from './helpers/electron-harness.mjs'
import { markdownToRtf } from '../src/rtf-export.js'


const exe = process.env.LIBREOFFICE_PATH || 'C:/Program Files/LibreOffice/program/soffice.exe'
const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-rtf-office-'))
let browser
try {
  const source = path.join(dir, 'table.rtf'), profile = path.join(dir, 'lo-profile')
  await mkdir(profile)
  const markdown = '# Inventory\n\n| Item | Count |\n| :--- | ---: |\n| **Pens** | 2 |\n| Paper | 5 |\n\nAfter table'
  const result = markdownToRtf(markdown)
  assert.ok(!result.warnings.length)
  await writeFile(source, result.rtf, 'ascii')
  const run = spawnSync(exe, ['--headless', `-env:UserInstallation=${pathToFileURL(profile).href}`, '--convert-to', 'html', '--outdir', dir, source], { timeout: 60000, encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 0, `LibreOffice conversion failed: ${run.stderr}`)
  const html = await readFile(path.join(dir, 'table.html'), 'utf8')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setContent(html)
  assert.equal(await page.locator('table').count(), 1, 'LibreOffice recognizes a table')
  assert.deepEqual(await page.locator('table tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim()))), [['Item', 'Count'], ['Pens', '2'], ['Paper', '5']])
  assert.match(await page.locator('body').innerText(), /After\s+table/)
  assert.equal(await page.locator('table strong, table b').count() > 0, true, 'Bold text survives in a cell')
  console.log('PASS: LibreOffice independently opened the RTF as a 3-row, 2-column table with content and bold formatting')


} finally {
  await browser?.close()
  await rm(dir, { recursive: true, force: true })
}
