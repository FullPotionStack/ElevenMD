import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url)
const { prepareHandoff } = require('../electron/update-handoff.cjs')
const { resolveUpdateTarget } = require('../electron/update-target.cjs')
const { createUpdateService } = require('../electron/updates.cjs')
const repository = 'FullPotionStack/ElevenMD'
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(await testScratch(), 'windows-bundle-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'installed'), directory = path.join(dir, 'job')
  await fs.mkdir(target); await fs.mkdir(directory)
  for (const name of ['ElevenMD.exe', 'unins000.exe', 'unins000.dat']) await fs.writeFile(path.join(target, name), name)
  return { dir, target, directory, executable: 'ElevenMD.exe', execPath: path.join(target, 'ElevenMD.exe') }
}
test('installed Windows requires a managed inventory before allowing file replacement', async t => {
  const f = await fixture(t)
  const options = { execPath: f.execPath, isPackaged: true, platform: 'win32', arch: 'x64' }
  assert.equal((await resolveUpdateTarget(options)).route, 'manual')
  await fs.writeFile(path.join(f.target, '.elevenmd-managed.json'), JSON.stringify({ schema: 1, platform: 'win32', arch: 'x64', route: 'portable', executable: f.executable, owned: [f.executable, '.elevenmd-managed.json'] }))
  assert.equal((await resolveUpdateTarget(options)).route, 'windows-installed')
})
test('installed Windows handoff validates the staged tree before staging a helper', async t => {
  const f = await fixture(t)
  await assert.rejects(prepareHandoff({ targetInfo: { ...f, route: 'windows-installed' }, userData: path.join(f.dir, 'profile'), staged: path.join(f.dir, 'nonexistent'), manifest: {}, directory: f.directory }))
})
test('installed Windows helper accepts a verified bundle tree rather than an executable package', async t => {
  const f = await fixture(t), staged = path.join(f.directory, 'staged')
  await fs.mkdir(staged); await fs.writeFile(path.join(staged, f.executable), 'replacement runtime')
  const { createBundle } = require('../electron/update-bundle.cjs')
  const built = await createBundle({ root: staged, destination: path.join(f.dir, 'bundle.gz'), version: '0.4.0', repository, platform: process.platform, arch: process.arch, route: 'portable', executable: f.executable })
  const { reserveUpdate, captureIdentity, durable, releaseReservation } = require('../electron/updater/transaction.cjs')
  const reservation = await reserveUpdate({ target: f.target, jobDir: f.directory, identity: await captureIdentity(f.target, f.executable) })
  t.after(() => releaseReservation(reservation))
  const helperExec = path.join(f.directory, 'helper-runtime', f.executable)
  await fs.mkdir(path.dirname(helperExec)); await fs.writeFile(helperExec, 'helper')
  const filename = path.join(f.directory, 'job.json')
  await durable(filename, { schema: 1, protocol: 1, parentPid: process.pid, token: 'b'.repeat(64), port: 12345, directory: f.directory, helperExec, targetInfo: { target: f.target, execPath: f.execPath, executable: f.executable, platform: process.platform, arch: process.arch, route: 'windows-installed' }, userData: path.join(f.dir, 'profile'), staged, manifest: built.manifest, reservation })
  const { readJob } = require('../electron/updater/main.cjs')
  assert.equal((await readJob(filename, helperExec)).manifest.route, 'portable')
  await fs.writeFile(path.join(staged, f.executable), 'tampered')
  await assert.rejects(readJob(filename, helperExec))
})
test('unmanaged Windows copies offer manual downloads rather than an installer update path', async t => {
  const dir = await fs.mkdtemp(path.join(await testScratch(), 'manual-windows-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const service = createUpdateService({ version: '0.3.11', repository, platform: 'win32', downloadsDir: dir, bundleTarget: { route: 'manual' }, fetchImpl: async () => Response.json({ tag_name: 'v0.4.0', draft: false, prerelease: false, assets: [] }) })
  const result = await service.check()
  assert.equal(result.status, 'available'); assert.equal(result.manualDownload, true)
})
test('a managed Windows update never falls back to downloading Setup when a bundle is absent', async t => {
  const dir = await fs.mkdtemp(path.join(await testScratch(), 'no-setup-fallback-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const base = `https://github.com/${repository}/releases/download/v0.4.0/`, requested = []
  const release = { tag_name: 'v0.4.0', draft: false, prerelease: false, assets: [
    { name: 'ElevenMD-Setup-0.4.0.exe', size: 5, browser_download_url: base + 'ElevenMD-Setup-0.4.0.exe' },
    { name: 'SHA256SUMS', size: 100, browser_download_url: base + 'SHA256SUMS' },
  ] }
  const service = createUpdateService({ version: '0.3.11', repository, platform: 'win32', arch: 'x64', downloadsDir: dir, bundleTarget: { route: 'windows-installed' }, fetchImpl: async url => { requested.push(url); return Response.json(release) } })
  assert.equal((await service.check()).status, 'error')
  assert.equal(requested.length, 1)
})
