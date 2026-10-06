import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
const scratch = await testScratch()

test('private session keeps unnamed and edited file tabs without writing originals', async t => {
  const dir = await mkdtemp(path.join(scratch, 'notepad-session-test-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'original.md'); await writeFile(target, '# Original\n')
  const files = require('../electron/files.cjs').createDocumentService()
  const opened = await files.openPath(target), unnamed = randomUUID()
  const payload = { tabs: [
    { id: opened.id, name: opened.name, content: '# Edited, not saved\n', savedContent: opened.content, eol: opened.eol, bom: opened.bom },
    { id: unnamed, name: 'Untitled 1', content: '# Unnamed\n', savedContent: '', eol: 'LF', bom: false },
  ], activeId: unnamed, mode: 'source' }
  const file = path.join(dir, 'private', 'session.json')
  const service = require('../electron/session.cjs').createSessionService({ file, files })
  await service.save(payload)
  assert.equal(await readFile(target, 'utf8'), '# Original\n')
  const restoredFiles = require('../electron/files.cjs').createDocumentService()
  const restarted = require('../electron/session.cjs').createSessionService({ file, files: restoredFiles })
  const restored = await restarted.load()
  assert.equal(restored.tabs[0].content, '# Edited, not saved\n')
  assert.equal(restored.tabs[0].path, opened.path)
  assert.equal(restored.tabs[1].content, '# Unnamed\n')
  assert.equal(restored.activeId, unnamed)
  await restoredFiles.save({ id: opened.id, content: restored.tabs[0].content, saveAs: false })
  assert.equal(await readFile(target, 'utf8'), '# Edited, not saved\n')
})
test('session checkpoints cannot forge paths and retain external-change protection after restart', async t => {
  const dir = await mkdtemp(path.join(scratch, 'notepad-session-security-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'original.md'); await writeFile(target, 'Original')
  const files = require('../electron/files.cjs').createDocumentService(), doc = await files.openPath(target)
  const tab = { id: doc.id, name: doc.name, content: 'Buffered edit', savedContent: doc.content, eol: 'LF', bom: false }
  const file = path.join(dir, 'session.json'), service = require('../electron/session.cjs').createSessionService({ file, files })
  await assert.rejects(service.save({ tabs: [{ ...tab, path: target }], activeId: doc.id, mode: 'source' }), /invalid/i)
  await service.save({ tabs: [tab], activeId: doc.id, mode: 'source' })
  await writeFile(target, 'Changed by another app')
  const restoredFiles = require('../electron/files.cjs').createDocumentService()
  await require('../electron/session.cjs').createSessionService({ file, files: restoredFiles }).load()
  await assert.rejects(restoredFiles.save({ id: doc.id, content: 'Buffered edit', saveAs: false }), /changed on disk/i)
  assert.equal(await readFile(target, 'utf8'), 'Changed by another app')
})
