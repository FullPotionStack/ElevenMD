import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
import { markRuntime, emitUpdateBundle } from '../scripts/update-bundles.mjs'
test('macOS managed marker stays inside Resources so the bundle root can be sealed', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'mac-update-marker-')); t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'Contents/MacOS'), { recursive: true }); await mkdir(path.join(dir, 'Contents/Resources'), { recursive: true })
  await writeFile(path.join(dir, 'Contents/MacOS/ElevenMD'), 'runtime')
  await markRuntime({ root: dir, platform: 'darwin', arch: 'arm64', route: 'mac-bundle', executable: 'Contents/MacOS/ElevenMD' })
  const marker = JSON.parse(await readFile(path.join(dir, 'Contents/Resources/.elevenmd-managed.json'), 'utf8'))
  assert.ok(marker.owned.includes('Contents/Resources/.elevenmd-managed.json'))
  await assert.rejects(readFile(path.join(dir, '.elevenmd-managed.json')))
})

test('packaging emits an immutable platform-bound descriptor and explicit owned-file marker', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'update-packaging-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'runtime'); await mkdir(root); await writeFile(path.join(root, 'elevenmd'), 'runtime')
  await markRuntime({ root, platform: 'linux', arch: 'x64', executable: 'elevenmd', route: 'portable' })
  const marker = JSON.parse(await readFile(path.join(root, '.elevenmd-managed.json'), 'utf8'))
  assert.deepEqual(marker.owned, ['.elevenmd-managed.json', 'elevenmd'])
  const result = await emitUpdateBundle({ root, release: dir, prefix: 'ElevenMD', version: '0.4.0', platform: 'linux', arch: 'x64', executable: 'elevenmd', route: 'portable', repository: 'FullPotionStack/ElevenMD' })
  const descriptor = JSON.parse(await readFile(result.descriptor, 'utf8'))
  assert.equal(descriptor.manifest.platform, 'linux'); assert.equal(descriptor.manifest.version, '0.4.0')
  assert.equal(descriptor.asset, 'ElevenMD-0.4.0-linux-x64-update.bundle.gz'); assert.match(descriptor.sha256, /^[0-9a-f]{64}$/)
  assert.equal(descriptor.size, (await readFile(result.bundle)).length)
  await assert.rejects(emitUpdateBundle({ root, release: dir, prefix: 'ElevenMD', version: '0.4.0', platform: 'linux', arch: 'x64', executable: 'elevenmd', route: 'portable', repository: 'FullPotionStack/ElevenMD' }))
})
