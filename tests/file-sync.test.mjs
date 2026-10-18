import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, rename } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { testScratch } from './helpers/electron-harness.mjs'
const { createDocumentService } = createRequire(import.meta.url)('../electron/files.cjs')
async function fixture(t) {
  const dir = await mkdtemp(path.join(await testScratch(), 'file-sync-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'note.md'); await writeFile(filename, '\ufeffbase\r\n')
  const files = createDocumentService(), doc = await files.openPath(filename)
  return { dir, filename, files, doc, inspect: async () => (await files.inspect([doc.id]))[0] }
}
test('inspection distinguishes same, changed, missing and unreadable without adopting disk changes', async t => {
  const f = await fixture(t); assert.equal((await f.inspect()).status, 'same')
  await writeFile(f.filename, 'outside'); const changed = await f.inspect()
  assert.equal(changed.status, 'changed'); assert.equal(changed.content, 'outside'); assert.equal(f.files.getDocument(f.doc.id).content, 'base\n')
  assert.equal((await f.inspect()).revision, changed.revision)
  await rm(f.filename); assert.equal((await f.inspect()).status, 'missing')
  await writeFile(f.filename, Buffer.from([255, 0])); assert.equal((await f.inspect()).status, 'unreadable')
  await assert.rejects(f.files.inspect(['renderer/path']))
})
test('reload adopts only the reviewed disk revision and rejects another external edit', async t => {
  const f = await fixture(t); await writeFile(f.filename, 'outside'); const change = await f.inspect()
  await writeFile(f.filename, 'newer')
  await assert.rejects(f.files.resolveExternal({ id: f.doc.id, revision: change.revision, action: 'reload' }), /changed|review/i)
  const fresh = await f.inspect(), result = await f.files.resolveExternal({ id: f.doc.id, revision: fresh.revision, action: 'reload' })
  assert.equal(result.content, 'newer'); assert.equal((await f.inspect()).status, 'changed')
  await f.files.adoptExternal({ id: f.doc.id, revision: fresh.revision })
  assert.equal((await f.inspect()).status, 'same')
})
test('overwrite requires native approval and rechecks disk after approval; cancellation preserves both versions', async t => {
  const f = await fixture(t); await writeFile(f.filename, 'outside'); const change = await f.inspect()
  const request = { id: f.doc.id, revision: change.revision, action: 'overwrite', content: 'mine' }
  await assert.rejects(f.files.resolveExternal(request), /confirmation/i)
  assert.equal(await f.files.resolveExternal(request, async () => false), null)
  assert.equal(await readFile(f.filename, 'utf8'), 'outside')
  await assert.rejects(f.files.resolveExternal(request, async () => { await writeFile(f.filename, 'third'); return true }), /changed|review/i)
  assert.equal(await readFile(f.filename, 'utf8'), 'third')
  const fresh = await f.inspect(); await f.files.resolveExternal({ ...request, revision: fresh.revision }, async () => true)
  assert.equal(await readFile(f.filename, 'utf8'), 'mine')
})
test('deleted originals cannot be saved normally and recreate is explicit, reviewed and metadata preserving', async t => {
  const f = await fixture(t); await rm(f.filename); const missing = await f.inspect()
  await assert.rejects(f.files.save({ id: f.doc.id, content: 'mine', saveAs: false }))
  const result = await f.files.resolveExternal({ id: f.doc.id, revision: missing.revision, action: 'recreate', content: 'mine\n' }, async () => true)
  assert.equal(result.bom, true); assert.deepEqual(await readFile(f.filename), Buffer.from('\ufeffmine\r\n'))
})
test('native locate binds the original tab without discarding its synchronized baseline', async t => {
  const f = await fixture(t), moved = path.join(f.dir, 'moved.md'); await rename(f.filename, moved)
  const located = await f.files.locate(f.doc.id, async () => moved)
  assert.equal(located.id, f.doc.id); assert.equal(located.path, moved); assert.equal((await f.inspect()).status, 'same')
  await assert.rejects(f.files.locate(f.doc.id, null))
})
