import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
let collectNotices
try { ({ collectNotices } = await import('../scripts/notices.mjs')) } catch {}

test('notices include installed licenses and skip only unavailable optional platform packages', async t => {
  assert.equal(typeof collectNotices, 'function', 'notice collection must exist')
  const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-notices-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'node_modules', 'required'), { recursive: true })
  await writeFile(path.join(dir, 'node_modules', 'required', 'LICENSE'), 'Required license')
  const lock = { packages: {
    '': {}, 'node_modules/required': { version: '1', license: 'MIT' },
    'node_modules/not-installed': { version: '1', license: 'MIT', optional: true },
  } }
  assert.match(await collectNotices(dir, lock), /Required license/)
  await assert.rejects(collectNotices(dir, { packages: { 'node_modules/missing': { version: '1', license: 'MIT' } } }), /ENOENT|missing/i)
})
