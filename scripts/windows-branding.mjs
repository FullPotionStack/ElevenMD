import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const helper = path.join(import.meta.dirname, 'windows-pe-resources.ps1')
const language = 0x0409
const pad = bytes => Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4)])
const words = values => { const b = Buffer.alloc(values.length * 2); values.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b }
const dwords = values => { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4)); return b }
const utf16 = text => Buffer.from(`${text}\0`, 'utf16le')
function block(key, value, children = [], text = false) {
  const head = pad(Buffer.concat([Buffer.alloc(6), utf16(key)]))
  const body = Buffer.concat([head, children.length ? pad(value) : value, ...children.map(pad)])
  body.writeUInt16LE(body.length, 0)
  body.writeUInt16LE(text ? value.length / 2 : value.length, 2)
  body.writeUInt16LE(text ? 1 : 0, 4)
  return body
}

export function versionResource(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || version.split('.').some(n => Number(n) > 65535)) throw new Error('Expected a numeric three-part Windows version with components <= 65535.')
  const [major, minor, patch] = version.split('.').map(Number)
  const high = (major * 65536 + minor) >>> 0
  const low = (patch * 65536) >>> 0
  const fixed = dwords([0xfeef04bd, 0x10000, high, low, high, low, 0x3f, 0, 0x40004, 1, 0, 0, 0])
  const values = {
    CompanyName: 'ElevenMD', FileDescription: 'ElevenMD', ProductName: 'ElevenMD',
    InternalName: 'ElevenMD', OriginalFilename: 'ElevenMD.exe', FileVersion: version, ProductVersion: version,
  }
  const strings = block('StringFileInfo', Buffer.alloc(0), [block('040904B0', Buffer.alloc(0), Object.entries(values).map(([key, value]) => block(key, utf16(value), [], true)), true)], true)
  const translation = block('VarFileInfo', Buffer.alloc(0), [block('Translation', words([language, 1200]))], true)
  return block('VS_VERSION_INFO', fixed, [strings, translation])
}

export function iconResources(ico) {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('Expected a Windows ICO asset.')
  const count = ico.readUInt16LE(4)
  if (!count || ico.length < 6 + count * 16) throw new Error('Invalid ICO directory.')
  const group = Buffer.alloc(6 + count * 14)
  ico.copy(group, 0, 0, 6)
  const icons = []
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    const length = ico.readUInt32LE(offset + 8)
    const start = ico.readUInt32LE(offset + 12)
    if (!length || start < 6 + count * 16 || start + length > ico.length) throw new Error('ICO image out of bounds.')
    ico.copy(group, 6 + i * 14, offset, offset + 12)
    group.writeUInt16LE(i + 1, 6 + i * 14 + 12)
    icons.push({ type: 3, name: i + 1, language, data: ico.subarray(start, start + length).toString('base64') })
  }
  return [{ type: 14, name: 1, language, data: group.toString('base64') }, ...icons]
}
function runHelper(mode, exe, payload) {
  if (process.platform !== 'win32') throw new Error('Windows PE branding requires a Windows host.')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode, '-Executable', path.resolve(exe), ...(payload ? ['-Payload', payload] : [])], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Windows PE ${mode} failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim())
}
export async function inspectWindowsExecutable(exe) {
  return runHelper('inspect', exe)
}
export async function brandWindowsExecutable(exe, icon, version, { scratchRoot = process.env.TMPDIR || os.tmpdir() } = {}) {
  // Validate all inputs before touching the executable. Only call this on a build copy.
  const versionBytes = versionResource(version)
  const icons = iconResources(await readFile(icon))
  const resources = [...icons, { type: 16, name: 1, language, data: versionBytes.toString('base64') }]
  const scratch = await mkdtemp(path.join(scratchRoot, 'elevenmd-pe-'))
  try {
    const payload = path.join(scratch, 'resources.json')
    await writeFile(payload, JSON.stringify(resources))
    const actual = runHelper('update', exe, payload)
    for (const key of ['CompanyName', 'FileDescription', 'ProductName', 'InternalName']) assert.equal(actual.version[key], 'ElevenMD', `PE ${key}`)
    assert.equal(actual.version.OriginalFilename, 'ElevenMD.exe')
    assert.equal(actual.version.FileVersion, version)
    assert.equal(actual.version.ProductVersion, version)
    const expectedParts = [...version.split('.').map(Number), 0]
    assert.deepEqual(['Major', 'Minor', 'Build', 'Private'].map(p => actual.version[`File${p}Part`]), expectedParts)
    assert.deepEqual(['Major', 'Minor', 'Build', 'Private'].map(p => actual.version[`Product${p}Part`]), expectedParts)
    const installed = actual.resources.filter(r => [3, 14, 16].includes(r.type)).sort((a, b) => a.type - b.type || a.name - b.name)
    assert.deepEqual(installed, resources.sort((a, b) => a.type - b.type || a.name - b.name), 'embedded resources must exactly match the icon and version payload')
    return actual
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
