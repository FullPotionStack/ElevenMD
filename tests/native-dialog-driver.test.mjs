import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { testScratch } from './helpers/electron-harness.mjs'

const run = promisify(execFile)
const driver = fileURLToPath(new URL('./helpers/windows-save-dialog.ps1', import.meta.url))
const options = { skip: process.platform !== 'win32' }
const invoke = (pid, filename) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', driver,
  '-TargetProcessId', String(pid), '-FilePath', filename, '-TimeoutMs', '100'], { timeout: 15000, windowsHide: true })

test('native dialog driver fails promptly when the target process has no Save dialog', options, async () => {
  const dir = await mkdtemp(path.join(await testScratch(), 'native-driver-no-dialog-'))
  const target = path.join(dir, 'not-created.md')
  try {
    // This Node test process owns no native Save dialog: do not target another app.
    await assert.rejects(invoke(process.pid, target), error => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /No usable native Save dialog/)
      return true
    })
    await assert.rejects(readFile(target), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('native dialog driver refuses an existing destination without altering its bytes', options, async () => {
  const dir = await mkdtemp(path.join(await testScratch(), 'native-driver-existing-'))
  const target = path.join(dir, 'existing.md')
  try {
    await writeFile(target, 'Do not overwrite this fixture.\r\n')
    await assert.rejects(invoke(process.pid, target), error => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /new absolute fixture path/)
      return true
    })
    assert.equal(await readFile(target, 'utf8'), 'Do not overwrite this fixture.\r\n')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('native dialog driver rejects a desktop-wide process target', options, async () => {
  await assert.rejects(invoke(0, path.join(await testScratch(), 'never-created.md')), error => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /Invalid process ID/)
    return true
  })
})
