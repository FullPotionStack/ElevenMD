import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { checkDiskSpace } = require('../electron/update-handoff.cjs')
const { stopOwnedChild, installerArguments } = require('../electron/updater/main.cjs')
const { retryFileOperation } = require('../electron/updater/transaction.cjs')
test('transient Windows teardown locks are retried without bypassing persistent failures', async () => {
  let attempts = 0
  assert.equal(await retryFileOperation(async () => { if (++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' }); return 'done' }, { platform: 'win32', budgetMs: 1000 }), 'done')
  await assert.rejects(retryFileOperation(async () => { throw Object.assign(new Error('permission'), { code: 'EPERM' }) }, { platform: 'win32', budgetMs: 20 }), /permission/)
})
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
test('termination command failure is harmless only when child exit is independently confirmed', async () => {
  await assert.doesNotReject(stopOwnedChild({ pid: 12345, exitCode: null }, { platform: 'win32', exec: async () => { throw new Error('already exited') }, wait: async () => {} }))
})
test('installed Windows helper backend suppresses installer-owned restart and targets only the trusted installation', () => {
  const args = installerArguments({ targetInfo: { target: 'C:\\Apps\\ElevenMD', route: 'windows-installed' }, parentPid: 123 })
  assert.ok(args.includes('/EXTERNALUPDATER')); assert.ok(args.includes('/PARENTPID=123')); assert.ok(args.includes('/DIR=C:\\Apps\\ElevenMD'))
  assert.ok(args.includes('/NOCLOSEAPPLICATIONS')); assert.ok(!args.includes('/PORTABLEUPDATE'))
})
