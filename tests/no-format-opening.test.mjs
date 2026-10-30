import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { testScratch } from './helpers/electron-harness.mjs'

const require = createRequire(import.meta.url)

test('document service refuses to open RTF and PDF without changing their bytes', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-no-format-open-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const service = require('../electron/files.cjs').createDocumentService()
  for (const name of ['sample.rtf', 'sample.PDF']) {
    const filename = path.join(dir, name)
    await writeFile(filename, 'plain text fixture')
    await assert.rejects(service.openPath(filename), /export|not supported/i)
    assert.equal(await readFile(filename, 'utf8'), 'plain text fixture')
  }
})

test('legacy imported tabs are backed up before PDF is removed and RTF draft is detached', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-legacy-format-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const pdfId = randomUUID(), rtfId = randomUUID(), hash = 'a'.repeat(64)
  const pdf = Buffer.from('%PDF-test').toString('base64')
  const state = { tabs: [
    { id: rtfId, name: 'legacy.rtf.md', content: 'Unsaved draft', savedContent: null, eol: 'LF', bom: false, sourceKind: 'rtf', sourceHash: hash, sourceBaseline: 'Before', rtfWarning: true, path: null, diskHash: null, origin: { kind: 'rtf', sourceHash: hash, path: path.join(dir, 'legacy.rtf') } },
    { id: pdfId, name: 'legacy.pdf', content: pdf, savedContent: pdf, eol: 'LF', bom: false, kind: 'pdf', path: null, diskHash: null },
  ], activeId: pdfId, mode: 'preview' }
  const file = path.join(dir, 'session.json'), original = JSON.stringify(state)
  await writeFile(file, original)
  const files = require('../electron/files.cjs').createDocumentService()
  const restored = await require('../electron/session.cjs').createSessionService({ file, files }).load()
  assert.equal(restored.tabs.length, 1)
  assert.equal(restored.tabs[0].content, 'Unsaved draft')
  assert.equal(restored.tabs[0].savedContent, null)
  assert.equal(restored.tabs[0].sourceKind, undefined)
  assert.equal(restored.activeId, rtfId)
  const backup = (await readdir(dir)).filter(name => name.startsWith('session.legacy-formats-'))
  assert.equal(backup.length, 1)
  assert.equal(await readFile(path.join(dir, backup[0]), 'utf8'), original)
  assert.equal(await readFile(file, 'utf8'), original)
})

test('Windows installer does not register RTF or PDF as openable types', async () => {
  const source = await readFile(new URL('../installer/ElevenMD.iss', import.meta.url), 'utf8')
  const registry = source.split('[Registry]')[1].split('\n[')[0]
  assert.doesNotMatch(registry, /AppProgId(?:RTF|PDF)|ValueName: "\.(?:rtf|pdf)"/i)
})

test('a legacy text capability for an RTF path becomes an unsaved detached Markdown draft', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-old-rtf-text-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'session.json'), id = randomUUID(), target = path.join(dir, 'old.rtf')
  await writeFile(target, 'old bytes')
  await writeFile(file, JSON.stringify({ tabs: [{ id, name: 'old.rtf', content: 'edited draft', savedContent: 'old bytes', eol: 'LF', bom: false, path: target, diskHash: 'a'.repeat(64) }], activeId: id, mode: 'source' }))
  const files = require('../electron/files.cjs').createDocumentService()
  const result = await require('../electron/session.cjs').createSessionService({ file, files }).load()
  assert.equal(result.tabs[0].content, 'edited draft')
  assert.equal(result.tabs[0].path, null)
  assert.equal(result.tabs[0].savedContent, null)
  assert.match(result.tabs[0].name, /\.md$/)
  assert.equal(files.getDocument(id), null)
  assert.equal(await readFile(target, 'utf8'), 'old bytes')
})
