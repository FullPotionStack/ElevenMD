import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url)

test('automatic logging records failed file operations without raw personal data', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-critical-log-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'diagnostics.json')
  const service = require('../electron/diagnostics.cjs').createDiagnosticsService({ file })
  await service.load()
  await service.record({ type: 'document_save', outcome: 'failure', message: 'SECRET', path: 'SECRET' })
  const records = (await service.inspect()).events
  assert.equal(records.length, 1)
  assert.equal(records[0].type, 'error')
  assert.equal(records[0].category, 'file_write')
  assert.equal((await readFile(file, 'utf8')).includes('SECRET'), false)
})

test('corrupted saved consent fails closed instead of re-enabling automatic collection', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-consent-corrupt-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'diagnostics.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, '{not valid json')
  const service = require('../electron/diagnostics.cjs').createDiagnosticsService({ file })
  await service.load()
  assert.equal(service.getState().enabled, false)
  assert.equal(await service.record({ type: 'error', category: 'renderer' }), false)
})
