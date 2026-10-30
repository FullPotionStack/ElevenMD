import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

test('captures process failures using bounded categories, never raw errors', async () => {
  const { observeCriticalEvents } = require('../electron/critical-events.cjs')
  const app = new EventEmitter(), window = new EventEmitter(), webContents = new EventEmitter(), events = []
  window.webContents = webContents
  const dispose = observeCriticalEvents({ app, window, record: event => events.push(event) })
  webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 12, message: 'SECRET' })
  window.emit('unresponsive')
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'out-of-memory', message: 'SECRET' })
  webContents.emit('console-message', { level: 'warning', message: 'SECRET', sourceId: 'SECRET' })
  webContents.emit('console-message', { level: 'error', message: 'SECRET', sourceId: 'SECRET' })
  webContents.emit('console-message', { level: 'info', message: 'SECRET' })
  assert.deepEqual(events, [
    { type: 'process_failure', process: 'renderer', reason: 'crashed' },
    { type: 'process_failure', process: 'renderer', reason: 'unresponsive' },
    { type: 'process_failure', process: 'gpu', reason: 'out_of_memory' },
    { type: 'warning', category: 'renderer' },
    { type: 'error', category: 'renderer' },
  ])
  dispose()
  webContents.emit('render-process-gone', {}, { reason: 'crashed' })
  assert.equal(events.length, 5)
})

test('cleanup does not access a destroyed BrowserWindow', () => {
  const { observeCriticalEvents } = require('../electron/critical-events.cjs')
  const app = new EventEmitter(), window = new EventEmitter(), webContents = new EventEmitter()
  let destroyed = false
  Object.defineProperty(window, 'webContents', { get() { if (destroyed) throw new Error('Object has been destroyed'); return webContents } })
  const dispose = observeCriticalEvents({ app, window, record() {} })
  destroyed = true
  assert.doesNotThrow(dispose)
  assert.equal(app.listenerCount('child-process-gone'), 0)
  assert.equal(webContents.listenerCount('console-message'), 0)
  assert.equal(window.listenerCount('unresponsive'), 0)
})
