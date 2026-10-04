import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const scratch = path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch')
const modulePath = '../electron/diagnostics.cjs'
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(scratch, 'notepad-diagnostics-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'private', 'diagnostics.json')
  const service = require(modulePath).createDiagnosticsService({ file, version: '0.3.0', ...options })
  await service.load()
  return { dir, file, service }
}

test('consent decisions persist separately from unset and revocation clears records', async t => {
  const { service, file } = await fixture(t)
  await service.setConsent(true)
  assert.equal(await service.record({ type: 'document_new', outcome: 'success' }), true)
  assert.equal((await service.inspect()).events.length, 1)
  const restarted = require(modulePath).createDiagnosticsService({ file, version: '0.3.0' })
  await restarted.load()
  assert.equal(restarted.getConsent(), true)
  assert.equal((await restarted.inspect()).events.length, 1)
  await service.setConsent(false)
  assert.equal(service.getConsent(), false)
  assert.deepEqual((await service.inspect()).events, [])
  const bytes = await readFile(file, 'utf8')
  assert.equal(await service.record({ type: 'document_new', outcome: 'success' }), false)
  assert.equal(await readFile(file, 'utf8'), bytes)
  const denied = require(modulePath).createDiagnosticsService({ file, version: '0.3.0' })
  await denied.load()
  assert.equal(denied.getConsent(), false)
  assert.deepEqual((await denied.inspect()).events, [])
  await assert.rejects(service.setConsent('true'), /Invalid consent/)
})

test('semantic allowlist drops sensitive keys and rejects arbitrary values without writes', async t => {
  const { service, file } = await fixture(t, { now: () => 1000000000 })
  await service.setConsent(true)
  const accepted = [
    { type: 'mode_changed', mode: 'source' },
    ...['new', 'open', 'save', 'save_as', 'close'].map(action => ({ type: `document_${action}`, outcome: 'success' })),
    { type: 'formatting', action: 'bold', outcome: 'success' },
    { type: 'theme_changed', preference: 'dark' },
    { type: 'find_replace', action: 'replace_all', outcome: 'success', count: 3 },
    { type: 'update', action: 'check', outcome: 'failure', category: 'network' },
    { type: 'lifecycle', action: 'startup' },
    { type: 'error', category: 'file_read' },
  ]
  for (const event of accepted) {
    assert.equal(await service.record({ ...event, content: 'SECRET', path: 'SECRET', name: 'SECRET', url: 'SECRET', query: 'SECRET', input: 'SECRET', key: 'SECRET', screenshot: 'SECRET', clipboard: 'SECRET', message: 'SECRET', stack: 'SECRET', metadata: { secret: 'SECRET' }, at: 12, id: 'SECRET' }), true)
  }
  const events = (await service.inspect()).events
  assert.deepEqual(events, accepted.map(event => ({ ...event, at: 1000000000 })))
  const bytes = await readFile(file, 'utf8')
  for (const bad of [null, {}, 'input', { type: 'keystroke', key: 'x' }, { type: 'document_open', outcome: '/private/file' }, { type: 'formatting', action: 'SECRET' }, { type: 'error', category: 'SECRET' }, { type: 'mode_changed', mode: 'SECRET' }, { type: 'theme_changed', preference: 'SECRET' }, { type: 'find_replace', action: 'SECRET' }, { type: 'update', action: 'SECRET' }, { type: 'lifecycle', action: 'SECRET' }]) {
    assert.equal(await service.record(bad), false)
  }
  assert.equal(await readFile(file, 'utf8'), bytes)
  assert.equal(bytes.includes('SECRET'), false)
  for (const count of ['SECRET', -1, 1.5, Infinity, 10001]) {
    await service.record({ type: 'find_replace', action: 'find_next', outcome: 'success', count })
    assert.equal(Object.hasOwn((await service.inspect()).events.at(-1), 'count'), false)
  }
  const hostile = Object.create(null)
  Object.defineProperty(hostile, 'type', { get() { throw new Error('SECRET') } })
  assert.equal(await service.record(hostile), false)
})

test('retains only the last 200 steps under 256 KiB and expires at seven days', async t => {
  let clock = 1000000000
  const { service, file } = await fixture(t, { now: () => clock })
  await service.setConsent(true)
  for (let index = 0; index < 205; index++) {
    await service.record({ type: 'find_replace', action: 'replace_all', outcome: 'success', count: index })
  }
  const snapshot = await service.inspect()
  assert.equal(snapshot.events.length, 200)
  assert.equal(snapshot.events[0].count, 5)
  assert.equal(snapshot.events.at(-1).count, 204)
  assert.ok((await stat(file)).size <= 256 * 1024)
  clock += 7 * 24 * 60 * 60 * 1000
  assert.deepEqual((await service.inspect()).events, [])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).events, [])
  await service.record({ type: 'document_new', outcome: 'success' })
  await service.clear()
  assert.equal(service.getConsent(), true)
  assert.deepEqual((await service.inspect()).events, [])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).events, [])
})

test('restart sanitizes tampered history including timestamps and personal fields on disk', async t => {
  const clock = 1000000000
  const { service, file } = await fixture(t, { now: () => clock })
  await service.setConsent(true)
  await writeFile(file, JSON.stringify({ schema: 1, consent: true, username: 'SECRET', machine: 'SECRET', version: 'SECRET', events: [
    { type: 'document_open', outcome: 'success', at: clock - 1, path: 'SECRET', metadata: { content: 'SECRET' } },
    { type: 'mode_changed', mode: 'source', at: clock, stack: 'SECRET' },
    { type: 'document_save', outcome: 'SECRET', at: clock },
    { type: 'document_open', outcome: 'success', at: clock + 1 },
    { type: 'document_open', outcome: 'success', at: clock - 7 * 24 * 60 * 60 * 1000 },
    { type: 'document_open', outcome: 'success', at: 'SECRET' },
    { type: 'keystroke', at: clock }, null,
  ] }))
  const restarted = require(modulePath).createDiagnosticsService({ file, version: '0.3.0', now: () => clock })
  await restarted.load()
  assert.equal(restarted.getConsent(), true)
  assert.deepEqual((await restarted.inspect()).events, [
    { type: 'document_open', outcome: 'success', at: clock - 1 },
    { type: 'mode_changed', mode: 'source', at: clock },
  ])
  assert.equal((await readFile(file, 'utf8')).includes('SECRET'), false)
  await writeFile(file, JSON.stringify({ schema: 1, consent: false, events: [{ type: 'document_open', outcome: 'success', at: clock, content: 'SECRET' }] }))
  const denied = require(modulePath).createDiagnosticsService({ file, version: '0.3.0', now: () => clock })
  await denied.load()
  assert.equal(denied.getConsent(), false)
  assert.deepEqual((await denied.inspect()).events, [])
  assert.equal((await readFile(file, 'utf8')).includes('SECRET'), false)
})

test('invalid, oversized, and unsupported stored formats fail closed and are replaced safely', async t => {
  const { service, file } = await fixture(t)
  await service.setConsent(true)
  for (const raw of ['{SECRET', 'SECRET'.repeat(50000), 'null', JSON.stringify({ schema: 99, consent: true }), JSON.stringify({ schema: 1, consent: 'true', events: [] })]) {
    await writeFile(file, raw)
    const restarted = require(modulePath).createDiagnosticsService({ file, version: '0.3.0' })
    await restarted.load()
    assert.equal(restarted.getConsent(), null)
    assert.equal(await restarted.record({ type: 'document_new', outcome: 'success' }), false)
    assert.deepEqual((await restarted.inspect()).events, [])
    assert.ok((await stat(file)).size <= 256 * 1024)
    assert.equal((await readFile(file, 'utf8')).includes('SECRET'), false)
  }
})

test('a burst has bounded pending records and serialized atomic writes', async t => {
  const realFs = await import('node:fs/promises')
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  let blocked = false, active = 0, maxActive = 0, writes = 0
  const io = { ...realFs, async rename(...args) {
    active++; maxActive = Math.max(maxActive, active); writes++
    try { if (blocked) { entered(); await gate } return await realFs.rename(...args) }
    finally { active-- }
  } }
  const { service, file, dir } = await fixture(t, { io })
  await service.setConsent(true)
  assert.equal(service.getState().pendingRecords, 0)
  blocked = true
  const first = service.record({ type: 'document_new', outcome: 'success' })
  await started
  const pending = Array.from({ length: 1000 }, (_, count) => service.record({ type: 'find_replace', action: 'replace_all', outcome: 'success', count }))
  assert.equal(service.getState().pendingRecords, 200)
  release()
  const results = await Promise.all(pending)
  await first
  assert.equal(results.filter(Boolean).length, 200)
  assert.equal(maxActive, 1)
  assert.ok(writes <= 3, `unexpected write count ${writes}`)
  const events = (await service.inspect()).events
  assert.equal(events.length, 200)
  assert.equal(events[0].count, 0)
  assert.equal(events.at(-1).count, 199)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).events, events)
  assert.deepEqual(await readdir(path.join(dir, 'private')), ['diagnostics.json'])
})

test('revocation clears queued events before acknowledgement and prevents later writes', async t => {
  const { service, file } = await fixture(t)
  await service.setConsent(true)
  const pending = Array.from({ length: 200 }, () => service.record({ type: 'document_new', outcome: 'success' }))
  const revoked = service.setConsent(false)
  assert.equal(service.getConsent(), false)
  assert.equal(await service.record({ type: 'document_open', outcome: 'success' }), false)
  await revoked
  await Promise.all(pending)
  assert.deepEqual((await service.inspect()).events, [])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schema: 1, consent: false, events: [] })
})

test('failed atomic writes expose only a fixed category and remain recoverable', async t => {
  const realFs = await import('node:fs/promises')
  let fail = false
  const io = { ...realFs, async rename(...args) {
    if (fail) throw Object.assign(new Error('SECRET path and stack'), { code: 'EACCES' })
    return realFs.rename(...args)
  } }
  const { service, file, dir } = await fixture(t, { io })
  await service.setConsent(true)
  await service.record({ type: 'document_new', outcome: 'success' })
  fail = true
  await assert.rejects(service.record({ type: 'document_open', outcome: 'success' }), error => {
    assert.equal(error.message, 'Diagnostics storage failed.')
    assert.equal(error.code, 'DIAGNOSTICS_STORAGE')
    assert.equal(error.message.includes('SECRET'), false)
    return true
  })
  assert.equal(service.getState().storageError, 'diagnostics_storage')
  assert.equal(service.getConsent(), false)
  assert.deepEqual((await service.inspect()).events, [])
  assert.equal(await service.record({ type: 'document_save', outcome: 'success' }), false)
  assert.deepEqual(await readdir(path.join(dir, 'private')), [])
  await assert.rejects(stat(file), { code: 'ENOENT' })
  fail = false
  await service.setConsent(true)
  await service.record({ type: 'document_new', outcome: 'success' })
  assert.equal(service.getState().storageError, null)
  assert.equal((await service.inspect()).events.length, 1)
})

test('failed consent revocation removes old storage rather than retaining an enabled history', async t => {
  const realFs = await import('node:fs/promises')
  let fail = false
  const io = { ...realFs, async rename(...args) {
    if (fail) throw new Error('SECRET')
    return realFs.rename(...args)
  } }
  const { service, file } = await fixture(t, { io })
  await service.setConsent(true)
  await service.record({ type: 'document_new', outcome: 'success' })
  fail = true
  await assert.rejects(service.setConsent(false), { code: 'DIAGNOSTICS_STORAGE' })
  assert.equal(service.getConsent(), false)
  assert.deepEqual((await service.inspect()).events, [])
  await assert.rejects(stat(file), { code: 'ENOENT' })
})

test('inspect and report expose only safe environment versions and defensive copies', async t => {
  const { service, dir } = await fixture(t, {
    version: '0.3.0', platform: 'win32', arch: 'x64',
    versions: { electron: '44.5.1', chrome: '150.0.0.1', node: '26.0.0', username: 'SECRET', hostname: 'SECRET', os: 'SECRET' },
  })
  await service.setConsent(true)
  await service.record({ type: 'document_open', outcome: 'success', path: 'SECRET' })
  const snapshot = await service.inspect()
  assert.deepEqual(snapshot.environment, { appVersion: '0.3.0', osFamily: 'Windows', arch: 'x64', electronVersion: '44.5.1', chromeVersion: '150.0.0.1', nodeVersion: '26.0.0' })
  assert.deepEqual(snapshot.limits, { maxEvents: 200, maxBytes: 256 * 1024, maxAgeDays: 7 })
  assert.equal(snapshot.eventCount, 1)
  snapshot.events[0].type = 'SECRET'; snapshot.environment.appVersion = 'SECRET'; snapshot.limits.maxEvents = 999999
  const report = await service.buildReport({ input: 'SECRET' })
  const parsed = JSON.parse(report)
  assert.equal(parsed.events[0].type, 'document_open')
  assert.equal(parsed.environment.appVersion, '0.3.0')
  assert.equal(parsed.limits.maxEvents, 200)
  assert.equal(report.includes('SECRET'), false)
  for (const field of ['path', 'username', 'hostname', 'id', 'url', 'query', 'input', 'key', 'clipboard', 'screenshot', 'stack', 'message']) assert.equal(Object.hasOwn(parsed, field), false)
  const hostile = require(modulePath).createDiagnosticsService({ file: path.join(dir, 'unused'), version: 'SECRET', platform: 'SECRET', arch: 'SECRET', versions: { node: '26.0.0 SECRET', electron: '/SECRET/path', chrome: 'https://SECRET' } })
  await hostile.load()
  const safe = await hostile.inspect()
  assert.deepEqual(safe.environment, { appVersion: 'unknown', osFamily: 'unknown', arch: 'unknown', electronVersion: 'unknown', chromeVersion: 'unknown', nodeVersion: 'unknown' })
  assert.equal(JSON.stringify(safe).includes('SECRET'), false)
})

test('explicit bootstrap is idempotent and cannot reload revoked consent', async t => {
  const { file, dir } = await fixture(t)
  const service = require(modulePath).createDiagnosticsService({ file, version: '0.3.0' })
  assert.equal(service.getState().loaded, false)
  assert.equal(await service.record({ type: 'document_new', outcome: 'success' }), false)
  await assert.rejects(service.setConsent(true), /Diagnostics not loaded/)
  await assert.rejects(service.clear(), /Diagnostics not loaded/)
  assert.equal(service.load(), service.load())
  await service.load()
  assert.equal(service.getState().loaded, true)
  await service.setConsent(true)
  await service.record({ type: 'document_new', outcome: 'success' })
  assert.equal(service.getState().eventCount, 1)
  await service.setConsent(false)
  await writeFile(file, JSON.stringify({ schema: 1, consent: true, events: [] }))
  await service.load()
  assert.equal(service.getConsent(), false)
  assert.equal(await service.record({ type: 'document_new', outcome: 'success' }), false)
  assert.deepEqual(await readdir(path.join(dir, 'private')), ['diagnostics.json'])
})

test('exported event contract is immutable and all declared enum values are usable', async t => {
  const { EVENT_SCHEMA, OUTCOMES, ERROR_CATEGORIES, LIMITS } = require(modulePath)
  assert.ok(EVENT_SCHEMA && Object.isFrozen(EVENT_SCHEMA))
  assert.deepEqual(OUTCOMES, ['success', 'cancelled', 'failure', 'blocked', 'noop'])
  assert.ok(Object.isFrozen(ERROR_CATEGORIES))
  assert.deepEqual(LIMITS, { maxEvents: 200, maxBytes: 256 * 1024, maxAgeDays: 7 })
  const { service } = await fixture(t)
  await service.setConsent(true)
  for (const [type, fields] of Object.entries(EVENT_SCHEMA)) {
    assert.ok(Object.isFrozen(fields))
    const event = { type, ...Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values[0]])) }
    for (const [key, values] of Object.entries(fields)) {
      assert.ok(Object.isFrozen(values))
      for (const value of values) assert.equal(await service.record({ ...event, [key]: value }), true, `${type}.${key}=${value}`)
    }
  }
  assert.throws(() => EVENT_SCHEMA.mode_changed.mode.push('SECRET'), TypeError)
  const { buildReport } = service
  assert.equal(JSON.parse(await buildReport()).eventCount, (await service.inspect()).events.length)
})

test('temporary files are cleaned even when closing a handle fails', async t => {
  const realFs = await import('node:fs/promises')
  const io = { ...realFs, async open(file, flags, ...args) {
    const handle = await realFs.open(file, flags, ...args)
    if (flags !== 'wx') return handle
    return {
      writeFile: (...values) => handle.writeFile(...values),
      sync: () => handle.sync(),
      async close() { try { await handle.close() } catch {} throw new Error('SECRET close failure') },
    }
  } }
  const { service, dir } = await fixture(t, { io })
  await assert.rejects(service.setConsent(true), { code: 'DIAGNOSTICS_STORAGE' })
  assert.equal(service.getConsent(), false)
  assert.deepEqual(await readdir(path.join(dir, 'private')), [])
})

test('a changing property descriptor cannot smuggle unvalidated optional metadata', async t => {
  const { service, file } = await fixture(t)
  await service.setConsent(true)
  let reads = 0
  const event = new Proxy({ type: 'update', action: 'check', outcome: 'failure' }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'category') return { configurable: true, enumerable: true, writable: true, value: ++reads === 1 ? 'network' : 'SECRET' }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  assert.equal(await service.record(event), true)
  assert.equal((await service.inspect()).events[0].category, 'network')
  assert.equal(reads, 1)
  assert.equal((await readFile(file, 'utf8')).includes('SECRET'), false)
})

test('recording stays off until asynchronous startup repair is finished', async t => {
  const realFs = await import('node:fs/promises')
  const { file, service } = await fixture(t)
  await service.setConsent(true)
  await writeFile(file, JSON.stringify({ schema: 1, consent: true, events: [], content: 'SECRET' }))
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const io = { ...realFs, async rename(...args) { entered(); await gate; return realFs.rename(...args) } }
  const restarted = require(modulePath).createDiagnosticsService({ file, version: '0.3.0', io })
  const loading = restarted.load()
  await started
  assert.equal(restarted.getState().loaded, false)
  const recording = restarted.record({ type: 'document_new', outcome: 'success' })
  release()
  await loading
  assert.equal(await recording, false)
  assert.deepEqual((await restarted.inspect()).events, [])
})

test('events arriving between flush completion microtasks are not lost on disk', async t => {
  const realFs = await import('node:fs/promises')
  for (let depth = 0; depth < 12; depth++) {
    let service, schedule = false, capture
    const captured = new Promise(resolve => { capture = resolve })
    function later(remaining) {
      if (remaining > 0) queueMicrotask(() => later(remaining - 1))
      else capture(service.record({ type: 'document_open', outcome: 'success' }))
    }
    const io = { ...realFs, async rename(...args) {
      await realFs.rename(...args)
      if (schedule) { schedule = false; later(depth) }
    } }
    const fixtureData = await fixture(t, { io })
    service = fixtureData.service
    await service.setConsent(true)
    schedule = true
    await service.record({ type: 'document_new', outcome: 'success' })
    assert.equal(await captured, true)
    const snapshot = await service.inspect()
    assert.equal(snapshot.events.length, 2)
    assert.deepEqual(JSON.parse(await readFile(fixtureData.file, 'utf8')).events, snapshot.events, `lost event at depth ${depth}`)
  }
})

test('a consent request during failed-write cleanup cannot silently reenable collection', async t => {
  const realFs = await import('node:fs/promises')
  let file, fail = false, release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const io = { ...realFs,
    async rename(...args) { if (fail) throw new Error('SECRET'); return realFs.rename(...args) },
    async rm(target, ...args) { if (target === file && fail) { entered(); await gate } return realFs.rm(target, ...args) },
  }
  const data = await fixture(t, { io }); file = data.file
  await data.service.setConsent(true)
  fail = true
  const failed = data.service.record({ type: 'document_new', outcome: 'success' })
  const checkedFailure = assert.rejects(failed, { code: 'DIAGNOSTICS_STORAGE' })
  await started
  fail = false
  const enabled = data.service.setConsent(true)
  const checkedEnable = assert.rejects(enabled, { code: 'DIAGNOSTICS_STORAGE' })
  release()
  await Promise.all([checkedFailure, checkedEnable])
  assert.equal(data.service.getConsent(), false)
  assert.equal(await data.service.record({ type: 'document_open', outcome: 'success' }), false)
})

test('default unset consent does not create storage when recording', async t => {
  const { service, file } = await fixture(t)
  assert.equal(service.getConsent(), null)
  assert.equal(service.getState().enabled, false)
  assert.equal(await service.record({ type: 'document_new', outcome: 'success' }), false)
  assert.deepEqual((await service.inspect()).events, [])
  await assert.rejects(stat(file), { code: 'ENOENT' })
})
