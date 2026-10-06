import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'

test('test scratch honors an explicit isolated directory before platform defaults', async t => {
  const { testScratch } = await import('./helpers/electron-harness.mjs')
  const parent = await testScratch()
  const dir = await mkdtemp(path.join(parent, 'scratch-override-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previous = process.env.HERMES_TEST_SCRATCH
  try {
    process.env.HERMES_TEST_SCRATCH = dir
    assert.equal(await testScratch(), dir)
  } finally {
    if (previous === undefined) delete process.env.HERMES_TEST_SCRATCH
    else process.env.HERMES_TEST_SCRATCH = previous
  }
})

test('test scratch works on Unix with no Windows or TMPDIR environment', async t => {
  const { testScratch } = await import('./helpers/electron-harness.mjs')
  const parent = await testScratch()
  const dir = await mkdtemp(path.join(parent, 'scratch-unix-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal(await testScratch({ env: {}, platform: 'linux', tempDirectory: dir }), dir)
})

test('packaged tests select the source version build or an explicit extracted executable', async () => {
  const { packagedExecutable } = await import('./helpers/electron-harness.mjs')
  assert.equal(typeof packagedExecutable, 'function')
  const { readFile } = await import('node:fs/promises'), { default: path } = await import('node:path')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const previous = process.env.NOTEPAD_EXECUTABLE_PATH
  try {
    delete process.env.NOTEPAD_EXECUTABLE_PATH
    assert.equal(packagedExecutable(), path.resolve(`release/win-${pkg.version}-unpacked/ElevenMD.exe`))
    process.env.NOTEPAD_EXECUTABLE_PATH = 'C:/isolated/extracted/ElevenMD.exe'
    assert.equal(packagedExecutable(), process.env.NOTEPAD_EXECUTABLE_PATH)
  } finally { if (previous === undefined) delete process.env.NOTEPAD_EXECUTABLE_PATH; else process.env.NOTEPAD_EXECUTABLE_PATH = previous }
})

test('failed or hung test-app shutdown terminates only its owned process', async () => {
  const { closeTestApp } = await import('./helpers/electron-harness.mjs')
  for (const hangs of [false, true]) {
    const calls = []
    const child = { pid: 12345, exitCode: null }
    const app = {
      process: () => child,
      evaluate: async () => { throw new Error('renderer disconnected') },
      close: () => hangs ? new Promise(() => {}) : Promise.reject(new Error('close failed')),
    }
    await closeTestApp(app, { budget: 20, killTree: async pid => { calls.push(pid); child.exitCode = 0 } })
    assert.deepEqual(calls, [12345])
  }
})
