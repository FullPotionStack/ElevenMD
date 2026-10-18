import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { createRequire } from 'node:module'
const { createGate, waitForExit } = createRequire(import.meta.url)('../electron/updater/protocol.cjs')
test('loopback readiness requires the one-use token and rejects malformed peers', async () => {
  const token = 'a'.repeat(64), gate = await createGate({ token, kind: 'ready', timeoutMs: 2000 })
  const bad = net.connect(gate.port, '127.0.0.1'); bad.on('error', () => {}); bad.write(JSON.stringify({ token: 'wrong', kind: 'ready' }) + '\n')
  const good = net.connect(gate.port, '127.0.0.1'); good.on('error', () => {}); good.write(JSON.stringify({ token, kind: 'ready' }) + '\n')
  const socket = await gate.ready; assert.equal(socket.remoteAddress, '127.0.0.1'); gate.dispose(); good.destroy(); bad.destroy()
})
test('failed readiness times out instead of permitting app quit', async () => {
  const gate = await createGate({ token: 'b'.repeat(64), kind: 'ready', timeoutMs: 30 })
  await assert.rejects(gate.ready, /timed out/); gate.dispose()
})
test('parent PID reuse or a live parent never permits replacement', async () => {
  await assert.rejects(waitForExit({ pid: process.pid, timeoutMs: 30, intervalMs: 5 }), /still running/)
  await waitForExit({ pid: 2147483647, timeoutMs: 30, intervalMs: 5 })
})
