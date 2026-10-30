import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

test('Wayland workaround respects platform and explicit user GPU choices', () => {
  const { configureWaylandGpu } = require('../electron/wayland-gpu.cjs')
  const run = (platform, env, initial = {}) => {
    const switches = { ...initial }
    configureWaylandGpu({ platform, env, commandLine: {
      hasSwitch: key => Object.hasOwn(switches, key),
      getSwitchValue: key => switches[key] || '',
      appendSwitch: (key, value) => { switches[key] = value },
    } })
    return switches
  }
  assert.equal(run('linux', { XDG_SESSION_TYPE: 'wayland' })['use-webgpu-adapter'], 'opengles')
  assert.equal(run('linux', {}, { 'ozone-platform': 'wayland' })['use-webgpu-adapter'], 'opengles')
  assert.equal(run('win32', { XDG_SESSION_TYPE: 'wayland' })['use-webgpu-adapter'], undefined)
  assert.equal(run('linux', { XDG_SESSION_TYPE: 'x11' })['use-webgpu-adapter'], undefined)
  assert.equal(run('linux', { XDG_SESSION_TYPE: 'wayland' }, { 'ozone-platform': 'x11' })['use-webgpu-adapter'], undefined)
  assert.equal(run('linux', { XDG_SESSION_TYPE: 'wayland' }, { 'use-webgpu-adapter': 'vulkan' })['use-webgpu-adapter'], 'vulkan')
  assert.equal(run('linux', { XDG_SESSION_TYPE: 'wayland' }, { 'enable-features': 'Vulkan,Other' })['use-webgpu-adapter'], undefined)
  assert.equal(run('linux', { XDG_SESSION_TYPE: 'wayland' }, { 'use-angle': 'vulkan' })['use-webgpu-adapter'], undefined)
})
