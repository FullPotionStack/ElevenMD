import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url)
const { applyUpdate, rollbackUpdate, commitUpdate, captureIdentity, reserveUpdate, releaseReservation } = require('../electron/updater/transaction.cjs')
const { createBundle } = require('../electron/update-bundle.cjs')
async function fixture(t) {
  const dir = await mkdtemp(path.join(await testScratch(), 'update-transaction-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'app'), staged = path.join(dir, 'staged'), jobDir = path.join(dir, 'job')
  for (const d of [target, staged, jobDir]) await mkdir(d)
  await writeFile(path.join(target, 'elevenmd'), 'old runtime')
  await writeFile(path.join(target, 'obsolete'), 'old owned file')
  await writeFile(path.join(target, 'my-note.md'), 'private unrelated file')
  await writeFile(path.join(target, '.elevenmd-managed.json'), JSON.stringify({ schema: 1, platform: 'linux', arch: 'x64', route: 'portable', executable: 'elevenmd', owned: ['elevenmd', 'obsolete', '.elevenmd-managed.json'] }))
  await writeFile(path.join(staged, 'elevenmd'), 'new runtime')
  await writeFile(path.join(staged, 'added'), 'new asset')
  await writeFile(path.join(staged, '.elevenmd-managed.json'), JSON.stringify({ schema: 1, platform: 'linux', arch: 'x64', route: 'portable', executable: 'elevenmd', owned: ['elevenmd', 'added', '.elevenmd-managed.json'] }))
  const { manifest } = await createBundle({ root: staged, destination: path.join(dir, 'bundle.gz'), platform: 'linux', arch: 'x64', version: '0.4.0', repository: 'FullPotionStack/ElevenMD', route: 'portable', executable: 'elevenmd' })
  return { dir, target, staged, jobDir, manifest }
}
test('transaction replaces owned files, removes obsolete files and preserves unrelated documents', async t => {
  const f = await fixture(t); await applyUpdate(f)
  assert.equal(await readFile(path.join(f.target, 'elevenmd'), 'utf8'), 'new runtime')
  await assert.rejects(access(path.join(f.target, 'obsolete')))
  assert.equal(await readFile(path.join(f.target, 'my-note.md'), 'utf8'), 'private unrelated file')
  await commitUpdate(f.jobDir)
  await commitUpdate(f.jobDir)
})
test('rollback restores exact previous files and removes newly introduced files', async t => {
  const f = await fixture(t); await applyUpdate(f); await rollbackUpdate(f.jobDir); await rollbackUpdate(f.jobDir)
  assert.equal(await readFile(path.join(f.target, 'elevenmd'), 'utf8'), 'old runtime')
  assert.equal(await readFile(path.join(f.target, 'obsolete'), 'utf8'), 'old owned file')
  await assert.rejects(access(path.join(f.target, 'added')))
  assert.equal(await readFile(path.join(f.target, 'my-note.md'), 'utf8'), 'private unrelated file')
})
test('every journal interruption restores the old runtime without deleting unrelated files', async t => {
  for (const phase of ['prepared', 'backup:0', 'installed:0', 'backup:1', 'installed:1', 'applied']) {
    const f = await fixture(t)
    await assert.rejects(applyUpdate({ ...f, fault: p => { if (p === phase) throw new Error('simulated crash') } }), /simulated crash/)
    await rollbackUpdate(f.jobDir)
    assert.equal(await readFile(path.join(f.target, 'elevenmd'), 'utf8'), 'old runtime', phase)
    assert.equal(await readFile(path.join(f.target, 'obsolete'), 'utf8'), 'old owned file', phase)
    await assert.rejects(access(path.join(f.target, 'added')))
    assert.equal(await readFile(path.join(f.target, 'my-note.md'), 'utf8'), 'private unrelated file')
  }
})
test('unowned collisions and corrupt staged files leave installed files untouched', async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.target, 'added'), 'user file')
  await assert.rejects(applyUpdate(f), /unowned|collision/i)
  assert.equal(await readFile(path.join(f.target, 'added'), 'utf8'), 'user file')
  await rm(path.join(f.target, 'added')); await writeFile(path.join(f.staged, 'added'), 'corrupt')
  await assert.rejects(applyUpdate(f), /digest|size/i)
  assert.equal(await readFile(path.join(f.target, 'elevenmd'), 'utf8'), 'old runtime')
})
test('reservation rejects a substituted installation and competing prepared updates before quit', async t => {
  const f = await fixture(t), identity = await captureIdentity(f.target, 'elevenmd')
  const reservation = await reserveUpdate({ target: f.target, jobDir: f.jobDir, identity })
  await assert.rejects(reserveUpdate({ target: f.target, jobDir: f.jobDir, identity }))
  await releaseReservation(reservation)
  const { rename } = await import('node:fs/promises')
  await rename(f.target, path.join(f.dir, 'original'))
  await mkdir(f.target); await writeFile(path.join(f.target, 'elevenmd'), 'different installation')
  await assert.rejects(reserveUpdate({ target: f.target, jobDir: f.jobDir, identity }), /identity|changed/i)
  assert.equal(await readFile(path.join(f.target, 'elevenmd'), 'utf8'), 'different installation')
})
test('terminal journal cleanup is retryable after a crash before workspace removal', async t => {
  const f = await fixture(t); await applyUpdate(f)
  const journalPath = path.join(f.jobDir, 'transaction.json'), journal = JSON.parse(await readFile(journalPath, 'utf8'))
  journal.phase = 'committed'; await writeFile(journalPath, JSON.stringify(journal))
  await commitUpdate(f.jobDir)
  await assert.rejects(access(journal.workspace))
  await assert.rejects(access(path.join(path.dirname(f.target), `.${path.basename(f.target)}.elevenmd-update.lock`)))
})

test('aliased target and concurrent update are rejected', async t => {
  const f = await fixture(t), alias = path.join(f.dir, 'alias')
  await symlink(f.target, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(applyUpdate({ ...f, target: alias }), /canonical/i)
  await applyUpdate(f)
  await assert.rejects(applyUpdate({ ...f, jobDir: path.join(f.dir, 'other') }))
  await rollbackUpdate(f.jobDir)
})
