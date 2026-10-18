import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { checkDiskSpace } = require('../electron/update-handoff.cjs')
const { stopOwnedChild, installerArguments } = require('../electron/updater/main.cjs')
test('preflight checks the target volume as well as the staging volume', async () => {
  const seen = []
  await assert.rejects(checkDiskSpace({ directory: 'cache-volume', targetParent: 'app-volume', runtimeBytes: 1024,
    statfs: async name => { seen.push(name); return { bavail: name === 'app-volume' ? 0n : 1000000000n, bsize: 1n } } }), /space/i)
  assert.deepEqual(seen, ['cache-volume', 'app-volume'])
})
test('an unconfirmed restarted-child exit blocks rollback instead of being swallowed', async () => {
  const child = { pid: 12345, exitCode: null, kill() {} }
  await assert.rejects(stopOwnedChild(child, { platform: 'linux', wait: async () => { throw new Error('still alive') } }), error => error.unsafeToRollback === true)
})
test('installed Windows helper backend suppresses installer-owned restart and targets only the trusted installation', () => {
  const args = installerArguments({ targetInfo: { target: 'C:\\Apps\\ElevenMD', route: 'windows-installed' }, parentPid: 123 })
  assert.ok(args.includes('/EXTERNALUPDATER')); assert.ok(args.includes('/PARENTPID=123')); assert.ok(args.includes('/DIR=C:\\Apps\\ElevenMD'))
  assert.ok(args.includes('/NOCLOSEAPPLICATIONS')); assert.ok(!args.includes('/PORTABLEUPDATE'))
})
