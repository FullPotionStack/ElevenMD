import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url)
const { createBundle } = require('../electron/update-bundle.cjs')
const { createUpdateService } = require('../electron/updates.cjs')
const repository = 'FullPotionStack/ElevenMD'
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(await testScratch(), 'native-updates-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'root'), downloadsDir = path.join(dir, 'downloads'); await mkdir(root); await mkdir(downloadsDir)
  await writeFile(path.join(root, 'elevenmd'), 'new runtime')
  const platform = overrides.platform || 'linux', executable = platform === 'darwin' ? 'Contents/MacOS/ElevenMD' : 'elevenmd'
  if (platform === 'darwin') { await mkdir(path.join(root, 'Contents/MacOS'), { recursive: true }); await writeFile(path.join(root, executable), 'runtime') }
  const built = await createBundle({ root, destination: path.join(dir, 'bundle.gz'), version: '0.4.0', repository, platform, arch: 'x64', route: platform === 'darwin' ? 'mac-bundle' : 'portable', executable })
  const stem = `ElevenMD-0.4.0-${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : platform}-x64-update`, asset = stem + '.bundle.gz', base = `https://github.com/${repository}/releases/download/v0.4.0/`
  const descriptor = { schema: 1, asset, size: built.size, sha256: built.sha256, manifest: built.manifest }
  const json = Buffer.from(JSON.stringify(descriptor)), bundle = await readFile(path.join(dir, 'bundle.gz'))
  const release = { tag_name: 'v0.4.0', draft: false, prerelease: false, body: 'Changes', assets: [{ name: stem + '.json', size: json.length, browser_download_url: base + stem + '.json' }, { name: asset, size: bundle.length, browser_download_url: base + asset }] }
  const packageRoute = ['deb', 'windows-installed'].includes(overrides.route)
  const packageName = overrides.route === 'windows-installed' ? 'ElevenMD-Setup-0.4.0.exe' : 'ElevenMD-0.4.0-linux-x64.deb'
  const sumsName = overrides.route === 'windows-installed' ? 'SHA256SUMS' : 'ElevenMD-0.4.0-linux-x64-SHA256SUMS.txt'
  const sums = Buffer.from(`${built.sha256}  ${packageName}\n`)
  if (packageRoute) release.assets.push({ name: packageName, size: bundle.length, browser_download_url: base + packageName }, { name: sumsName, size: sums.length, browser_download_url: base + sumsName })
  let launched = 0, prepared = 0, checkpoints = 0
  const service = createUpdateService({ version: '0.3.9', repository, platform, downloadsDir, arch: 'x64', bundleTarget: { route: overrides.route || (platform === 'darwin' ? 'mac-bundle' : 'portable') },
    fetchImpl: async url => { if (url.endsWith('/releases/latest')) return Response.json(release); if (url.endsWith(packageName)) return new Response(bundle); if (url.endsWith(sumsName)) return new Response(sums); if (url.endsWith('.json')) return new Response(json); if (url.endsWith('.gz')) return new Response(overrides.corrupt ? Buffer.from('corrupt') : bundle); throw new Error('Unexpected URL') },
    confirmInstall: async () => overrides.approve !== false,
    beforeInstall: async () => { checkpoints++ },
    prepareBundle: async record => { prepared++; if (packageRoute) assert.deepEqual(await readFile(record.staged), bundle); else assert.equal(await readFile(path.join(record.staged, executable), 'utf8'), platform === 'darwin' ? 'runtime' : 'new runtime'); return { launch: async () => { launched++ }, dispose() {} } },
  })
  return { service, release, counts: () => ({ launched, prepared, checkpoints }) }
}
for (const platform of ['linux', 'darwin']) test(`native ${platform} downloads a matching verified bundle before checkpoint and handoff`, async t => {
  const f = await fixture(t, { platform }); assert.equal((await f.service.check()).manualDownload, false)
  assert.equal((await f.service.download()).status, 'downloaded'); assert.deepEqual(f.counts(), { launched: 0, prepared: 1, checkpoints: 0 })
  assert.equal((await f.service.install()).installed, true); assert.deepEqual(f.counts(), { launched: 1, prepared: 1, checkpoints: 1 })
})
for (const [platform, route] of [['win32', 'windows-installed'], ['linux', 'deb']]) test(`${route} enters the helper lifecycle using the verified native package`, async t => {
  const f = await fixture(t, { platform, route }); assert.equal((await f.service.check()).manualDownload, false)
  assert.equal((await f.service.download()).status, 'downloaded'); assert.equal((await f.service.install()).installed, true)
  assert.deepEqual(f.counts(), { launched: 1, prepared: 1, checkpoints: 1 })
})

test('corrupt bundle leaves app open and never prepares or launches helper', async t => {
  const f = await fixture(t, { corrupt: true }); await f.service.check(); assert.equal((await f.service.download()).status, 'error'); assert.deepEqual(f.counts(), { launched: 0, prepared: 0, checkpoints: 0 })
})
test('native confirmation cancellation preserves ready bundle without checkpoint or launch', async t => {
  const f = await fixture(t, { approve: false }); await f.service.check(); await f.service.download(); assert.equal((await f.service.install()).status, 'downloaded'); assert.deepEqual(f.counts(), { launched: 0, prepared: 1, checkpoints: 0 })
})
