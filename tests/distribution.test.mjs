import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDistribution } from '../scripts/distribution-policy.mjs'

test('official and correctly retargeted forks match their own git origin', () => {
  for (const origin of ['https://github.com/FullPotionStack/ElevenMD.git', 'git@github.com:FullPotionStack/ElevenMD.git']) assert.equal(validateDistribution({ repository: 'FullPotionStack/ElevenMD', installerPrefix: 'ElevenMD-Setup' }, origin), true)
  assert.equal(validateDistribution({ repository: 'ExampleOwner/MyFork', installerPrefix: 'MyFork-Setup' }, 'https://github.com/ExampleOwner/MyFork.git'), true)
})
test('retargeted distribution makes the real update module use only the fork repository', async t => {
  const fs = await import('node:fs/promises'), path = await import('node:path')
  const { createRequire } = await import('node:module')
  const dir = await fs.mkdtemp(path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch', 'elevenmd-fork-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  for (const file of ['updates.cjs']) await fs.copyFile(new URL(`../electron/${file}`, import.meta.url), path.join(dir, file))
  await fs.writeFile(path.join(dir, 'distribution.cjs'), "module.exports = Object.freeze({repository: 'ExampleOwner/MyFork', installerPrefix: 'MyFork-Setup'});\n")
  const require = createRequire(import.meta.url), { createUpdateService } = require(path.join(dir, 'updates.cjs'))
  const calls = []
  const service = createUpdateService({ version: '1.0.0', repository: 'ExampleOwner/MyFork', downloadsDir: path.join(dir, 'downloads'), fetchImpl: async url => {
    calls.push(url)
    return Response.json({ draft: false, prerelease: false, tag_name: 'v1.0.1', body: 'Fork changes', assets: [
      { name: 'MyFork-Setup-1.0.1.exe', size: 100, browser_download_url: 'https://github.com/ExampleOwner/MyFork/releases/download/v1.0.1/MyFork-Setup-1.0.1.exe' },
      { name: 'SHA256SUMS', size: 100, browser_download_url: 'https://github.com/ExampleOwner/MyFork/releases/download/v1.0.1/SHA256SUMS' },
    ] })
  } })
  assert.equal((await service.check()).status, 'available')
  assert.deepEqual(calls, ['https://api.github.com/repos/ExampleOwner/MyFork/releases/latest'])
  assert.throws(() => createUpdateService({ version: '1.0.0', repository: 'FullPotionStack/ElevenMD', downloadsDir: dir }), /invalid/i)
})

test('a fork cannot package with upstream updates; invalid destinations fail closed', () => {
  assert.throws(() => validateDistribution({ repository: 'FullPotionStack/ElevenMD', installerPrefix: 'ElevenMD-Setup' }, 'https://github.com/ExampleOwner/MyFork.git'), /fork|origin/i)
  for (const repository of ['owner/repo/extra', '../repo', 'https://github.com/owner/repo', 'owner/repo?x', '']) assert.throws(() => validateDistribution({ repository, installerPrefix: 'ElevenMD-Setup' }, 'https://github.com/owner/repo.git'), /invalid/i)
  assert.throws(() => validateDistribution({ repository: 'owner/repo', installerPrefix: '../evil' }, 'https://github.com/owner/repo.git'), /invalid/i)
  assert.throws(() => validateDistribution({ repository: 'owner/repo', installerPrefix: 'ElevenMD-Setup' }, 'https://github.com.attacker.test/owner/repo.git'), /origin/i)
})
