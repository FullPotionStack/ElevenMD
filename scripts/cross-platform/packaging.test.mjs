import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const scratch = process.env.ELEVENMD_TEST_SCRATCH || process.env.TMPDIR || os.tmpdir()
await mkdir(scratch, { recursive: true })

test('staging uses the Electron resources layout, carries notices, and never overwrites outputs', async t => {
  const { stageNative } = await import('./shared.mjs')
  const root = await mkdtemp(path.join(scratch, 'elevenmd-packaging-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtime = path.join(root, 'runtime')
  for (const dir of ['runtime/resources', 'dist', 'electron', 'node_modules/example']) await mkdir(path.join(root, dir), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'eleven-md', version: '1.2.3', license: 'MIT', devDependencies: { electron: '44.5.1' } }))
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/example': { version: '1.0.0', license: 'MIT' } } }))
  await writeFile(path.join(root, 'electron/distribution.cjs'), "module.exports = { repository: 'FullPotionStack/ElevenMD', installerPrefix: 'ElevenMD-Setup' }")
  await writeFile(path.join(root, 'electron/main.cjs'), '// fixture main')
  await writeFile(path.join(root, 'dist/index.html'), '<h1>fixture</h1>')
  await writeFile(path.join(root, 'LICENSE'), 'app fixture license')
  await writeFile(path.join(root, 'node_modules/example/LICENSE-MIT.txt'), 'dependency fixture license')
  await writeFile(path.join(runtime, 'version'), '44.5.1')
  await writeFile(path.join(runtime, 'LICENSE'), 'electron fixture license')
  await writeFile(path.join(runtime, 'LICENSES.chromium.html'), 'chromium fixture license')
  // ELF fixture is enough to test architecture validation, not a runnable native runtime.
  const elf = Buffer.alloc(64); elf.write('\x7fELF'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18)
  await writeFile(path.join(runtime, 'electron'), elf)
  await writeFile(path.join(runtime, 'resources/default_app.asar'), 'unused Electron demo')
  const options = { root, runtime, platform: 'linux', arch: 'x64', origin: 'https://github.com/FullPotionStack/ElevenMD.git' }
  const result = await stageNative(options)
  assert.equal(result.out, path.join(root, 'release/linux-1.2.3-x64-unpacked'))
  const app = JSON.parse(await readFile(path.join(result.app, 'package.json'), 'utf8'))
  assert.equal(app.main, 'electron/main.cjs'); assert.equal(app.productName, 'ElevenMD')
  assert.equal(await readFile(path.join(result.app, 'dist/index.html'), 'utf8'), '<h1>fixture</h1>')
  assert.match(await readFile(path.join(result.out, 'THIRD-PARTY-NOTICES.txt'), 'utf8'), /dependency fixture license/)
  assert.equal(await readFile(path.join(result.out, 'LICENSES.chromium.html'), 'utf8'), 'chromium fixture license')
  await assert.rejects(access(path.join(result.out, 'resources/default_app.asar')), { code: 'ENOENT' })
  await assert.rejects(stageNative(options), /already exists/)
  await assert.rejects(stageNative({ ...options, origin: 'https://github.com/wrong/repo.git' }), /does not match/)
  await assert.rejects(stageNative({ ...options, arch: 'arm64' }), /architecture/)
  const macRuntime = path.join(root, 'mac-runtime')
  await mkdir(path.join(macRuntime, 'Electron.app/Contents/MacOS'), { recursive: true })
  await mkdir(path.join(macRuntime, 'Electron.app/Contents/Resources'), { recursive: true })
  const macho = Buffer.alloc(64); macho.writeUInt32LE(0xfeedfacf, 0); macho.writeUInt32LE(0x0100000c, 4)
  await writeFile(path.join(macRuntime, 'Electron.app/Contents/MacOS/Electron'), macho)
  for (const [name, value] of [['version', '44.5.1'], ['LICENSE', 'electron mac fixture license'], ['LICENSES.chromium.html', 'chromium mac fixture license']]) await writeFile(path.join(macRuntime, name), value)
  const mac = await stageNative({ ...options, runtime: macRuntime, platform: 'darwin', arch: 'arm64' })
  assert.equal(mac.bundle, path.join(root, 'release/mac-1.2.3-arm64-unpacked/ElevenMD.app'))
  assert.equal(mac.app, path.join(mac.bundle, 'Contents/Resources/app'))
  assert.match(await readFile(path.join(mac.bundle, 'Contents/Resources/THIRD-PARTY-NOTICES.txt'), 'utf8'), /dependency fixture license/)
  assert.equal(await readFile(path.join(mac.bundle, 'Contents/Resources/LICENSES.chromium.html'), 'utf8'), 'chromium mac fixture license')
  await rm(path.join(root, 'node_modules/example/LICENSE-MIT.txt'))
  await assert.rejects(stageNative({ ...options, runtime: macRuntime, platform: 'darwin', arch: 'arm64' }), /Missing license text/)
  await writeFile(path.join(runtime, 'version'), '0.0.0')
  await assert.rejects(stageNative(options), /Electron version/)
})
test('Debian tree contains native runtime, safe argument forwarding, associations, and notices', async t => {
  const { buildDebTree } = await import('./linux.mjs')
  const root = await mkdtemp(path.join(scratch, 'elevenmd-deb-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const out = path.join(root, 'unpacked')
  await mkdir(out)
  for (const name of ['elevenmd', 'chrome-sandbox', 'THIRD-PARTY-NOTICES.txt', 'elevenmd.png']) await writeFile(path.join(out, name), `fixture ${name}`)
  const tree = await buildDebTree({ root, out, pkg: { version: '1.2.3' }, arch: 'arm64', repository: 'FullPotionStack/ElevenMD' })
  assert.match(await readFile(path.join(tree, 'DEBIAN/control'), 'utf8'), /Architecture: arm64/)
  assert.match(await readFile(path.join(tree, 'DEBIAN/control'), 'utf8'), /Version: 1.2.3/)
  assert.equal(await readFile(path.join(tree, 'usr/bin/elevenmd'), 'utf8'), '#!/bin/sh\nexec /opt/elevenmd/elevenmd "$@"\n')
  assert.match(await readFile(path.join(tree, 'usr/share/applications/elevenmd.desktop'), 'utf8'), /Exec=\/usr\/bin\/elevenmd %F/)
  assert.match(await readFile(path.join(tree, 'usr/share/applications/elevenmd.desktop'), 'utf8'), /MimeType=text\/markdown;text\/plain;/)
  assert.equal(await readFile(path.join(tree, 'opt/elevenmd/THIRD-PARTY-NOTICES.txt'), 'utf8'), 'fixture THIRD-PARTY-NOTICES.txt')
})

test('mac bundle metadata replaces Electron identity without breaking helper executable names', async () => {
  const { macBundleInfo } = await import('./macos.mjs')
  const main = macBundleInfo({ CFBundleExecutable: 'Electron', CFBundleIconFile: 'electron.icns', Keep: 'yes' }, '1.2.3')
  assert.equal(main.CFBundleExecutable, 'ElevenMD')
  assert.equal(main.CFBundleIdentifier, 'io.github.fullpotionstack.elevenmd')
  assert.equal(main.CFBundleIconFile, 'elevenmd.icns')
  assert.equal(main.CFBundleShortVersionString, '1.2.3')
  assert.equal(main.Keep, 'yes')
  const helper = macBundleInfo({ CFBundleExecutable: 'Electron Helper (Renderer)', CFBundleName: 'Electron Helper (Renderer)' }, '1.2.3', 'Renderer')
  assert.equal(helper.CFBundleExecutable, 'Electron Helper (Renderer)')
  assert.equal(helper.CFBundleDisplayName, 'ElevenMD Helper (Renderer)')
  assert.equal(helper.CFBundleIdentifier, 'io.github.fullpotionstack.elevenmd.helper.renderer')
})

test('native command failures propagate and checksum manifests hash the actual artifact bytes', async t => {
  const { run, writeChecksums } = await import('./shared.mjs')
  assert.equal(run(process.execPath, ['-e', 'process.stdout.write("native probe")'], { capture: true }), 'native probe')
  assert.throws(() => run(process.execPath, ['-e', 'process.exit(7)'], { capture: true }), /exited with 7/)
  const root = await mkdtemp(path.join(scratch, 'elevenmd-hashes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifact = path.join(root, 'ElevenMD-fixture.tar.gz')
  const { assertNewOutputs } = await import('./shared.mjs')
  await assertNewOutputs([artifact])
  await writeFile(artifact, 'abc')
  await assert.rejects(assertNewOutputs([artifact]), /already exists/)
  await writeChecksums([artifact], path.join(root, 'SHA256SUMS.txt'))
  assert.equal(await readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  ElevenMD-fixture.tar.gz\n')
})

test('packaging CLIs expose help and reject unsupported hosts before touching output', () => {
  for (const [script, platform] of [['package-linux.mjs', 'linux'], ['package-macos.mjs', 'darwin']]) {
    const file = path.resolve(import.meta.dirname, '..', script)
    const help = spawnSync(process.execPath, [file, '--help'], { encoding: 'utf8' })
    assert.equal(help.status, 0); assert.match(help.stdout, /Native/)
    const badArgument = spawnSync(process.execPath, [file, '--unexpected'], { encoding: 'utf8' })
    assert.notEqual(badArgument.status, 0); assert.match(badArgument.stderr, /Unknown argument/)
    if (process.platform !== platform) {
      const wrongHost = spawnSync(process.execPath, [file], { encoding: 'utf8' })
      assert.notEqual(wrongHost.status, 0); assert.match(wrongHost.stderr, /requires a native/)
    }
  }
})

test('smoke harness requires an explicit executable rather than silently testing a Windows build', () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'smoke.mjs')], { encoding: 'utf8', env: { ...process.env, NOTEPAD_EXECUTABLE_PATH: '' } })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /NOTEPAD_EXECUTABLE_PATH is required/)
})

test('native build target rejects cross-host and cross-architecture packaging', async () => {
  const { validateTarget } = await import('./shared.mjs')
  assert.doesNotThrow(() => validateTarget('linux', 'x64', { platform: 'linux', arch: 'x64' }))
  assert.doesNotThrow(() => validateTarget('darwin', 'arm64', { platform: 'darwin', arch: 'arm64' }))
  assert.throws(() => validateTarget('linux', 'x64', { platform: 'win32', arch: 'x64' }), /native/)
  assert.throws(() => validateTarget('darwin', 'arm64', { platform: 'darwin', arch: 'x64' }), /architecture/)
  assert.throws(() => validateTarget('linux', 'ia32', { platform: 'linux', arch: 'ia32' }), /Unsupported/)
})
