import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { testScratch } from './helpers/electron-harness.mjs'
const { findRecoveryJob, cleanupCompletedJobs } = createRequire(import.meta.url)('../electron/updater/recovery.cjs')
test('startup discovers an interrupted job even when the macOS target bundle is missing', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'update-recovery-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const userData = path.join(dir, 'profile'), jobDir = path.join(userData, 'updates/native-update-fixture'), target = path.join(dir, 'ElevenMD.app'), execPath = path.join(target, 'Contents/MacOS/ElevenMD')
  await mkdir(path.join(jobDir, 'helper.app/Contents/MacOS'), { recursive: true }); await writeFile(path.join(jobDir, 'helper.app/Contents/MacOS/ElevenMD'), 'helper')
  const job = { schema: 1, protocol: 1, directory: jobDir, userData, helperExec: path.join(jobDir, 'helper.app/Contents/MacOS/ElevenMD'), targetInfo: { target, execPath }, reservation: { id: 'a'.repeat(36), pid: 2147483647 } }
  await writeFile(path.join(jobDir, 'job.json'), JSON.stringify(job)); await writeFile(path.join(jobDir, 'transaction.json'), JSON.stringify({ phase: 'prepared' }))
  const found = await findRecoveryJob({ userData, execPath }); assert.equal(found.directory, jobDir)
  job.reservation.pid = process.pid; await writeFile(path.join(jobDir, 'job.json'), JSON.stringify(job))
  assert.equal(await findRecoveryJob({ userData, execPath }), null)
})
test('housekeeping removes only completed owned jobs after helper exit, preserving pending recovery', async t => {
  const dir = await mkdtemp(path.join(await testScratch(), 'update-housekeeping-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const userData = path.join(dir, 'profile'), execPath = path.join(dir, 'runtime/elevenmd')
  for (const [suffix, status] of [['complete', 'complete'], ['pending', 'recovery-required']]) {
    const directory = path.join(userData, 'updates', `native-update-${suffix}`); await mkdir(path.join(directory, 'helper-runtime'), { recursive: true })
    await writeFile(path.join(directory, 'job.json'), JSON.stringify({ schema: 1, protocol: 1, directory, userData, targetInfo: { execPath }, helperExec: path.join(directory, 'helper-runtime/elevenmd'), reservation: { pid: 2147483647 } }))
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ status }))
  }
  await cleanupCompletedJobs({ userData, execPath })
  await assert.rejects(access(path.join(userData, 'updates/native-update-complete')))
  await access(path.join(userData, 'updates/native-update-pending'))
})
