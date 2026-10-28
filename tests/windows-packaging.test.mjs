import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, access } from 'node:fs/promises'
import path from 'node:path'
import { testScratch } from './helpers/electron-harness.mjs'

const packageSource = new URL('../scripts/package-windows.mjs', import.meta.url)
const installerSource = new URL('../installer/ElevenMD.iss', import.meta.url)

test('document icon packaging validates checked-in assets before copying top-level managed resources', async () => {
  const text = await readFile(packageSource, 'utf8')
  // Check the scratch-safe seam before importing: legacy packaging executes on import.
  assert.match(text, /export async function copyDocumentIcons/)
  const validateCall = text.indexOf('await validateDocumentIcons(root)')
  const copyCall = text.indexOf('await copyDocumentIcons(root, out)')
  assert.ok(validateCall >= 0 && validateCall < text.indexOf('await rm(out,'), 'validate before deleting the distribution')
  assert.ok(copyCall >= 0 && copyCall < text.indexOf('await markRuntime('), 'icons are included in the update ownership inventory')
  assert.match(text, /tests\/document-icons\.test\.mjs/, 'scratch-only branding mode covers document assets')
  const { validateDocumentIcons, copyDocumentIcons } = await import('../scripts/package-windows.mjs')
  const { markRuntime } = await import('../scripts/update-bundles.mjs')
  const scratch = await mkdtemp(path.join(await testScratch(), 'elevenmd-icon-packaging-'))
  const source = path.join(scratch, 'source'), out = path.join(scratch, 'runtime')
  const sourcePublic = path.join(source, 'public')
  const kinds = ['markdown', 'text']
  try {
    await mkdir(sourcePublic, { recursive: true })
    for (const kind of kinds) for (const ext of ['svg', 'ico']) {
      const name = `elevenmd-${kind}.${ext}`
      await cp(new URL(`../public/${name}`, import.meta.url), path.join(sourcePublic, name))
    }
    await validateDocumentIcons(source)
    await copyDocumentIcons(source, out)
    for (const kind of kinds) assert.deepEqual(await readFile(path.join(out, 'resources', 'icons', `elevenmd-${kind}.ico`)), await readFile(path.join(sourcePublic, `elevenmd-${kind}.ico`)))
    await assert.rejects(access(path.join(out, 'resources', 'app')), { code: 'ENOENT' }, 'not hidden inside the application directory')
    await markRuntime({ root: out, platform: 'win32', arch: 'x64', route: 'portable', executable: 'ElevenMD.exe' })
    const marker = JSON.parse(await readFile(path.join(out, '.elevenmd-managed.json'), 'utf8'))
    for (const kind of kinds) assert.ok(marker.owned.includes(`resources/icons/elevenmd-${kind}.ico`), 'icon is update-marker-owned')
    for (const kind of kinds) for (const ext of ['svg', 'ico']) {
      const file = path.join(sourcePublic, `elevenmd-${kind}.${ext}`)
      const original = await readFile(file)
      const rejectedOut = path.join(scratch, `rejected-${kind}-${ext}`)
      await writeFile(file, ext === 'svg' ? '<svg/>' : Buffer.alloc(8))
      await assert.rejects(validateDocumentIcons(source), /drift: run node scripts\/generate-document-icons\.mjs/)
      await assert.rejects(copyDocumentIcons(source, rejectedOut), /drift/)
      await assert.rejects(access(rejectedOut), { code: 'ENOENT' }, 'all assets validate before any output is written')
      await rm(file)
      await assert.rejects(copyDocumentIcons(source, rejectedOut), { code: 'ENOENT' })
      await assert.rejects(access(rejectedOut), { code: 'ENOENT' })
      await writeFile(file, original)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('packaging brands the copied PE before reporting success and has a scratch-only test mode', async () => {
  const text = await readFile(packageSource, 'utf8')
  assert.match(text, /await brandWindowsExecutable\(path\.join\(out, 'ElevenMD\.exe'\),.*pkg\.version\)/)
  assert.match(text, /--test-branding/)
  assert.match(text, /Windows alpha \$\{pkg\.version\}/)
  assert.ok(text.indexOf('await rename(') < text.indexOf('await brandWindowsExecutable('))
  assert.ok(text.indexOf('await brandWindowsExecutable(') < text.indexOf('Windows app packaged:'))
})

test('installer and update launcher never close unrelated apps or request an OS restart', async () => {
  const installer = await readFile(installerSource, 'utf8')
  const launcher = await readFile(new URL('../electron/update-launcher.cjs', import.meta.url), 'utf8')
  const support = await readFile(new URL('../electron/support.cjs', import.meta.url), 'utf8')
  assert.match(installer, /^CloseApplications=no$/m)
  assert.match(installer, /^RestartApplications=no$/m)
  for (const flag of ['/UPDATE', '/NOCLOSEAPPLICATIONS', '/NORESTART', '/NORESTARTAPPLICATIONS']) assert.ok(launcher.includes(`'${flag}'`))
  assert.doesNotMatch(support, /launchInstaller:|createUpdateLauncher/)
  assert.match(support, /prepareBundle: record => prepareHandoff/)
  assert.doesNotMatch(installer, /CloseApplications=force/)
})

test('installer assigns only document ProgIDs to quoted document icons while retaining association task defaults', async () => {
  const text = await readFile(installerSource, 'utf8')
  const registry = text.split('[Registry]')[1].split('\n[')[0].split('\n').filter(line => line.startsWith('Root:'))
  for (const [progId, kind] of [['AppProgIdMD', 'markdown'], ['AppProgIdText', 'text']]) {
    const matches = registry.filter(line => line.includes(`Software\\Classes\\{#${progId}}\\DefaultIcon`))
    assert.equal(matches.length, 1)
    assert.ok(matches[0].includes(`ValueData: """{app}\\resources\\icons\\elevenmd-${kind}.ico"",0"`), matches[0])
    assert.ok(matches[0].includes('Tasks: associate; Check: NotPortableUpdate'))
  }
  const applicationIcons = registry.filter(line => line.includes('ValueName: "Icon"') || line.includes('ValueName: "ApplicationIcon"') || line.includes('Applications\\{#AppExe}\\DefaultIcon'))
  assert.equal(applicationIcons.length, 5, 'OpenWith application icon, capabilities icon, and all three Explorer verbs')
  for (const line of applicationIcons) {
    assert.ok(line.includes('ValueData: """{app}\\{#AppExe}"",0"'), `app/OpenWith/verb still uses the application logo: ${line}`)
  }
  for (const [task, flag] of [['desktopicon', 'unchecked'], ['filemenu', 'checkedonce'], ['associate', 'checkedonce'], ['defaultapps', 'unchecked']]) {
    const taskLine = text.split('\n').find(line => line.startsWith(`Name: "${task}";`))
    assert.ok(taskLine?.includes(`Flags: ${flag}; Check: NotPortableUpdate`), `unchanged optional task: ${task}`)
  }
  for (const [ext, progId] of [['md', 'AppProgIdMD'], ['markdown', 'AppProgIdMD'], ['txt', 'AppProgIdText']]) {
    assert.ok(registry.some(line => line.includes(`Classes\\.${ext}\\OpenWithProgids`) && line.includes(`ValueName: "{#${progId}}"`) && line.includes('Tasks: associate; Flags: uninsdeletevalue')))
  }
})

test('installer app identity is friendly, optional, correctly quoted and scoped on uninstall', async () => {
  const text = await readFile(installerSource, 'utf8')
  const registry = text.split('[Registry]')[1].split('\n[')[0].split('\n').filter(line => line.startsWith('Root:'))
  assert.ok(registry.length > 20)
  for (const line of registry) {
    assert.match(line, /Root: HKCU;/)
    assert.match(line, /Tasks: (associate|filemenu)/, `optional registration: ${line}`)
    assert.doesNotMatch(line, /UserChoice|ValueName: "ProgId"|Subkey: "Software\\Classes\\\.(md|markdown|txt)";/)
    assert.doesNotMatch(line, /OpenWithElevenMD\\Icon/)
    if (/shell\\OpenWithElevenMD"/.test(line) && /ValueName: "Icon"/.test(line)) assert.match(line, /ValueData: """\{app\}\\\{#AppExe\}"",0"/)
  }
  const app = registry.filter(line => line.includes('Applications\\{#AppExe}'))
  assert.ok(app.some(line => line.includes('FriendlyAppName') && line.includes('ValueData: "ElevenMD"') && line.includes('uninsdeletekey')))
  assert.ok(app.some(line => line.includes('shell\\open\\command') && line.includes('ValueData: """{app}\\{#AppExe}"" ""%1"""')))
  for (const ext of ['md', 'markdown', 'txt']) assert.ok(app.some(line => line.includes('SupportedTypes') && line.includes(`ValueName: ".${ext}"`)))
  for (const ext of ['md', 'markdown', 'txt']) {
    assert.ok(registry.some(line => line.includes(`SystemFileAssociations\\.${ext}\\shell\\OpenWithElevenMD"`) && line.includes('ValueName: "Icon"')))
    assert.ok(registry.some(line => line.includes(`SystemFileAssociations\\.${ext}\\shell\\OpenWithElevenMD"`) && line.includes('uninsdeletekey')))
  }
  assert.match(text, /PrivilegesRequired=lowest/)
  assert.match(text, /Type: dirifempty; Name: "\{app\}"/)
  assert.doesNotMatch(text, /Type: filesandordirs|UserChoice/)
})
