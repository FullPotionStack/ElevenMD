import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { testScratch } from './helpers/electron-harness.mjs'
const require = createRequire(import.meta.url)
test('monitor detects replacement and deletion with metadata fallback and disposes owned watchers', async t => {
  const { createFileMonitor } = require('../electron/file-monitor.cjs')
  const dir = await mkdtemp(path.join(await testScratch(), 'file-monitor-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const filename = path.join(dir, 'note.md'); await writeFile(filename, 'original')
  let hints = 0, closed = 0
  const monitor = createFileMonitor({ notify: () => hints++, watch: () => ({ on() {}, close() { closed++ } }), intervalMs: 60000, debounceMs: 0 })
  t.after(() => monitor.close()); monitor.setDocuments([{ id: 'registered', path: filename }]); await monitor.poll()
  await new Promise(r => setTimeout(r, 10)); const initial = hints
  const replacement = path.join(dir, 'atomic'); await writeFile(replacement, 'replacement'); await rename(replacement, filename); await monitor.poll()
  await new Promise(r => setTimeout(r, 10)); assert.ok(hints > initial)
  const beforeDelete = hints; await rm(filename); await monitor.poll(); await new Promise(r => setTimeout(r, 10)); assert.ok(hints > beforeDelete)
  monitor.setDocuments([]); assert.equal(closed, 1); monitor.close()
})
