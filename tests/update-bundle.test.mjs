import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url)
const { createBundle, extractBundle, validateManifest, verifyTree } = require('../electron/update-bundle.cjs')
const expected = { version: '0.4.0', repository: 'FullPotionStack/ElevenMD', platform: 'linux', arch: 'x64' }
async function fixture(t) {
  const dir = await mkdtemp(path.join(await testScratch(), 'update-bundle-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'source'); await mkdir(path.join(root, 'resources'), { recursive: true })
  await writeFile(path.join(root, 'elevenmd'), 'runtime', { mode: 0o755 })
  await writeFile(path.join(root, 'resources', 'app.txt'), 'Unicode: café 日本語')
  const filename = path.join(dir, 'update.gz')
  const built = await createBundle({ root, destination: filename, ...expected, route: 'portable', executable: 'elevenmd' })
  return { dir, root, filename, ...built }
}
function mutate(bytes, fn) {
  const raw = gunzipSync(bytes), length = raw.readUInt32BE(0), manifest = JSON.parse(raw.subarray(4, 4 + length))
  fn(manifest)
  const json = Buffer.from(JSON.stringify(manifest)), header = Buffer.alloc(4); header.writeUInt32BE(json.length)
  return gzipSync(Buffer.concat([header, json, raw.subarray(4 + length)]))
}
test('bundle roundtrip preserves exact bytes and rejects modified staged files', async t => {
  const f = await fixture(t), destination = path.join(f.dir, 'extracted')
  const manifest = await extractBundle({ filename: f.filename, destination, expected })
  assert.equal(manifest.executable, 'elevenmd')
  assert.equal(await readFile(path.join(destination, 'resources/app.txt'), 'utf8'), 'Unicode: café 日本語')
  await verifyTree(destination, manifest)
  await writeFile(path.join(destination, 'elevenmd'), 'tampered')
  await assert.rejects(verifyTree(destination, manifest), /digest|size/i)
})
test('manifest rejects traversal, collisions, unsupported targets and executable outside inventory', async t => {
  const f = await fixture(t)
  for (const change of [m => { m.entries[0].path = '../escape' }, m => { m.entries[0].path = 'C:/escape' }, m => { m.entries.push({ ...m.entries[0], path: m.entries[0].path.toUpperCase() }) }, m => { m.executable = 'missing' }, m => { m.platform = 'other' }, m => { m.protocol = 2 }, m => { m.entries[0].mode = 0o4755 }, m => { m.entries.push({ path: 'resources', type: 'file', size: 0, sha256: '0'.repeat(64), mode: 0o644 }) }]) {
    const m = structuredClone(f.manifest); change(m)
    assert.throws(() => validateManifest(m, expected))
  }
  assert.throws(() => validateManifest(f.manifest, { ...expected, arch: 'arm64' }))
  assert.throws(() => validateManifest(f.manifest, { ...expected, version: '0.4.1' }))
})
test('extractor refuses corrupt bodies, truncated and trailing data and leaves no extracted tree', async t => {
  const f = await fixture(t), bytes = await readFile(f.filename), raw = gunzipSync(bytes)
  for (const [i, bad] of [gzipSync(Buffer.concat([raw, Buffer.from('extra')])), gzipSync(raw.subarray(0, raw.length - 1)), mutate(bytes, m => { m.entries[0].sha256 = '0'.repeat(64) }), gzipSync(Buffer.from([0xff, 0xff, 0xff, 0xff]))].entries()) {
    const file = path.join(f.dir, `bad-${i}.gz`), destination = path.join(f.dir, `bad-${i}`)
    await writeFile(file, bad)
    await assert.rejects(extractBundle({ filename: file, destination, expected }))
    await assert.rejects(lstat(destination), { code: 'ENOENT' })
  }
})
test('extractor never overwrites an existing destination', async t => {
  const f = await fixture(t)
  await assert.rejects(extractBundle({ filename: f.filename, destination: f.root, expected }))
  assert.equal(await readFile(path.join(f.root, 'elevenmd'), 'utf8'), 'runtime')
})
test('manifest accepts internal framework links but rejects escapes and descendants of links', async t => {
  const f = await fixture(t), m = structuredClone(f.manifest)
  m.entries.push({ path: 'current', type: 'symlink', target: 'resources' })
  validateManifest(m, expected)
  m.entries.at(-1).target = '../outside'
  assert.throws(() => validateManifest(m, expected))
  m.entries.at(-1).target = 'resources'
  m.entries.push({ path: 'current/file', type: 'file', size: 0, mode: 0o644, sha256: '0'.repeat(64) })
  assert.throws(() => validateManifest(m, expected))
})
test('framework aliases resolve component-by-component before parent traversal', async t => {
  const f = await fixture(t), framework = structuredClone(f.manifest)
  framework.entries.push({ path: 'Framework/Versions/A/Binary', type: 'file', size: 0, mode: 0o755, sha256: '0'.repeat(64) },
    { path: 'Framework/Versions/Current', type: 'symlink', target: 'A' },
    { path: 'Framework/Binary', type: 'symlink', target: 'Versions/Current/Binary' })
  assert.doesNotThrow(() => validateManifest(framework, expected))
  const escape = structuredClone(f.manifest)
  escape.entries.push({ path: 'R/file', type: 'file', size: 0, mode: 0o644, sha256: '0'.repeat(64) },
    { path: 'dir/file', type: 'file', size: 0, mode: 0o644, sha256: '0'.repeat(64) },
    { path: 'dir/deep/link', type: 'symlink', target: '../../R' },
    { path: 'escape', type: 'symlink', target: 'dir/deep/link/../../file' })
  assert.throws(() => validateManifest(escape, expected), /escaping|missing/i)
})

test('builder rejects symlink escapes without following them', async t => {
  const f = await fixture(t)
  await symlink(f.dir, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createBundle({ root: f.root, destination: path.join(f.dir, 'escape.gz'), ...expected, route: 'portable', executable: 'elevenmd' }))
})
