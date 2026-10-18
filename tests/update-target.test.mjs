import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'
const { resolveUpdateTarget } = createRequire(import.meta.url)('../electron/update-target.cjs')
test('target resolver requires explicit packaging markers and keeps package-managed paths separate', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'update-target-')); t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'resources/app'), { recursive: true }); const execPath = path.join(dir, 'elevenmd'); await writeFile(execPath, 'runtime')
  assert.equal((await resolveUpdateTarget({ execPath, isPackaged: false, platform: 'linux', arch: 'x64' })).route, 'manual')
  assert.equal((await resolveUpdateTarget({ execPath, isPackaged: true, platform: 'linux', arch: 'x64' })).route, 'manual')
  await writeFile(path.join(dir, '.elevenmd-managed.json'), JSON.stringify({ schema: 1, platform: 'linux', arch: 'x64', route: 'portable', executable: 'elevenmd', owned: ['elevenmd', '.elevenmd-managed.json'] }))
  assert.equal((await resolveUpdateTarget({ execPath, isPackaged: true, platform: 'linux', arch: 'x64' })).route, 'portable')
  await writeFile(path.join(dir, '.elevenmd-package-managed'), 'deb\n')
  assert.equal((await resolveUpdateTarget({ execPath, isPackaged: true, platform: 'linux', arch: 'x64', toolsAvailable: async () => true })).route, 'deb')
  assert.equal((await resolveUpdateTarget({ execPath, isPackaged: true, platform: 'linux', arch: 'x64', toolsAvailable: async () => false })).route, 'manual')
})
