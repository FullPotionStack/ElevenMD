import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'

const root = path.resolve(import.meta.dirname, '..')

test('Windows PE branding replaces Electron identity and every icon resource', { skip: process.platform !== 'win32' }, async () => {
  const { brandWindowsExecutable, inspectWindowsExecutable } = await import('../scripts/windows-branding.mjs')
  const scratch = await mkdtemp(path.join(await testScratch(), 'elevenmd-branding-'))
  const options = { scratchRoot: scratch }
  try {
    const exe = path.join(scratch, 'ElevenMD.exe')
    await cp(path.join(root, 'node_modules/electron/dist/electron.exe'), exe)
    const before = await inspectWindowsExecutable(exe)
    assert.equal(before.version.FileDescription, 'Electron')
    assert.equal(before.version.ProductName, 'Electron')
    assert.equal(before.version.OriginalFilename, 'electron.exe')
    assert.equal(before.version.FileVersion, '44.5.1')
    console.log('BEFORE:', JSON.stringify(before.version))
    const icon = path.join(root, 'public/elevenmd.ico')
    await brandWindowsExecutable(exe, icon, '0.3.0', options)
    const after = await inspectWindowsExecutable(exe)
    for (const key of ['FileDescription', 'ProductName', 'InternalName', 'CompanyName']) assert.equal(after.version[key], 'ElevenMD', key)
    assert.equal(after.version.OriginalFilename, 'ElevenMD.exe')
    assert.equal(after.version.FileVersion, '0.3.0')
    assert.equal(after.version.ProductVersion, '0.3.0')
    assert.notDeepEqual(after.resources.filter(r => r.type === 14), before.resources.filter(r => r.type === 14))
    const ico = await readFile(icon)
    const count = ico.readUInt16LE(4)
    const icons = after.resources.filter(r => r.type === 3)
    const groups = after.resources.filter(r => r.type === 14)
    assert.equal(icons.length, count, 'no leftover Electron icons')
    assert.equal(groups.length, 1, 'no leftover Electron icon groups')
    const group = Buffer.from(groups[0].data, 'base64')
    assert.equal(group.readUInt16LE(4), count)
    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i
      const resourceEntry = 6 + 14 * i
      assert.deepEqual(group.subarray(resourceEntry, resourceEntry + 12), ico.subarray(entry, entry + 12))
      const id = group.readUInt16LE(resourceEntry + 12)
      const resource = icons.find(r => r.name === id && r.language === groups[0].language)
      assert.ok(resource, `icon ${id} exists in group language`)
      const offset = ico.readUInt32LE(entry + 12)
      const length = ico.readUInt32LE(entry + 8)
      assert.deepEqual(Buffer.from(resource.data, 'base64'), ico.subarray(offset, offset + length), `embedded icon ${id} exactly matches asset`)
    }
    assert.deepEqual(after.resources.filter(r => r.type === 24), before.resources.filter(r => r.type === 24), 'Electron security manifest preserved')
    console.log('AFTER:', JSON.stringify(after.version), `icon sizes=${Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256).join(',')}; exact resource bytes verified`)
    const first = await readFile(exe)
    await brandWindowsExecutable(exe, icon, '0.3.0', options)
    assert.deepEqual(await readFile(exe), first, 'resource update is byte-identical on repeat')
    const secondExe = path.join(scratch, 'second-copy.exe')
    await cp(path.join(root, 'node_modules/electron/dist/electron.exe'), secondExe)
    await brandWindowsExecutable(secondExe, icon, '0.3.0', options)
    assert.deepEqual(await readFile(secondExe), first, 'fresh copies yield byte-identical branded executables')
    await assert.rejects(brandWindowsExecutable(exe, icon, '../bad', options), /version/i)
    await assert.rejects(brandWindowsExecutable(exe, icon, '65536.0.0', options), /version/i)
    const brokenIcon = path.join(scratch, 'broken.ico')
    const invalid = Buffer.from(ico)
    invalid.writeUInt32LE(invalid.length, 6 + 12)
    await writeFile(brokenIcon, invalid)
    await assert.rejects(brandWindowsExecutable(exe, brokenIcon, '0.3.0', options), /bounds/i)
    assert.deepEqual(await readFile(exe), first, 'invalid inputs cannot mutate the PE')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
