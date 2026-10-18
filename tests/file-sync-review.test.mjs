import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url), { createDocumentService } = require('../electron/files.cjs'), { createSessionService } = require('../electron/session.cjs')
async function setup(t, options) {
  const dir = await fs.mkdtemp(path.join(await testScratch(), 'sync-review-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'note.md'); await fs.writeFile(target, '\ufeffA\r\n')
  const files = createDocumentService(options), doc = await files.openPath(target), file = path.join(dir, 'session.json')
  const payload = { tabs: [{ id: doc.id, name: doc.name, content: doc.content, savedContent: doc.content, eol: doc.eol, bom: doc.bom, previousContent: null }], activeId: doc.id, mode: 'source' }
  return { dir, target, files, doc, file, payload, sessions: createSessionService({ file, files }) }
}
test('old queued renderer snapshot cannot acquire a falsely clean newer disk baseline', async t => {
  const f = await setup(t)
  const delayed = createSessionService({ file: f.file, files: f.files })
  // The old payload was captured before adoption; it is persisted behind a newer checkpoint.
  await fs.writeFile(f.target, 'B\n'); const observation = (await f.files.inspect([f.doc.id]))[0]
  await f.files.resolveExternal({ id: f.doc.id, revision: observation.revision, action: 'reload' }); await f.files.adoptExternal({ id: f.doc.id, revision: observation.revision })
  const current = structuredClone(f.payload); current.tabs[0].content = current.tabs[0].savedContent = 'B\n'
  await Promise.all([delayed.save(current), delayed.save(f.payload)])
  const restarted = createDocumentService(), restored = await createSessionService({ file: f.file, files: restarted }).load()
  assert.equal(restored.tabs[0].content, 'A\n')
  assert.equal(restored.tabs[0].savedContent, 'B\n', 'baseline text must match the registered hash, making stale text visibly dirty')
  assert.equal(restored.tabs[0].bom, false); assert.equal(restored.tabs[0].eol, 'LF')
})
test('binding main-owned baselines cannot produce an oversized unreadable session', async t => {
  const f = await setup(t), content = 'x'.repeat(2 * 1024 * 1024)
  const tabs = Array.from({ length: 51 }, (_, i) => ({ ...f.payload.tabs[0], id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, content: '', savedContent: '' }))
  const service = createSessionService({ file: f.file, files: { getDocument: () => ({ ...f.doc, content, diskHash: 'a'.repeat(64) }) } })
  await assert.rejects(service.save({ tabs, activeId: tabs[0].id, mode: 'source' }), /100 MiB/)
})
test('checkpoint during approved recreation retains a valid committed baseline and can restore', async t => {
  let unblock, ready; const paused = new Promise(r => { ready = r }), gate = new Promise(r => { unblock = r })
  const io = { ...fs, open: async (filename, ...args) => { if (String(filename).endsWith('.tmp') && args[0] === 'wx') { ready(); await gate } return fs.open(filename, ...args) } }
  const f = await setup(t, { fs: io }); await fs.rm(f.target)
  const missing = (await f.files.inspect([f.doc.id]))[0], pending = f.files.resolveExternal({ id: f.doc.id, revision: missing.revision, action: 'recreate', content: 'restored\n' }, async () => true)
  await paused
  try {
    await f.sessions.save(f.payload)
    const stored = JSON.parse(await fs.readFile(f.file)); assert.match(stored.tabs[0].diskHash, /^[a-f0-9]{64}$/)
    const fresh = createDocumentService(); await createSessionService({ file: f.file, files: fresh }).load()
    assert.equal((await fresh.inspect([f.doc.id]))[0].status, 'missing')
  } finally { unblock(); await pending }
})
test('reopening an externally changed path preserves the visible capability and remains saveable after adoption', async t => {
  const f = await setup(t); await fs.writeFile(f.target, 'B\n')
  const reopened = await f.files.openPath(f.target); assert.equal(reopened.id, f.doc.id)
  const external = (await f.files.inspect([f.doc.id]))[0]
  await f.files.resolveExternal({ id: f.doc.id, revision: external.revision, action: 'reload' }); await f.files.adoptExternal({ id: f.doc.id, revision: external.revision })
  await f.files.save({ id: f.doc.id, content: 'C\n', saveAs: false }); assert.equal(await fs.readFile(f.target, 'utf8'), 'C\n')
})
