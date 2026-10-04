import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageSource = new URL('../scripts/package-windows.mjs', import.meta.url)
const installerSource = new URL('../installer/ElevenMD.iss', import.meta.url)

test('packaging brands the copied PE before reporting success and has a scratch-only test mode', async () => {
  const text = await readFile(packageSource, 'utf8')
  assert.match(text, /await brandWindowsExecutable\(path\.join\(out, 'ElevenMD\.exe'\),.*pkg\.version\)/)
  assert.match(text, /--test-branding/)
  assert.match(text, /Windows alpha \$\{pkg\.version\}/)
  assert.ok(text.indexOf('await rename(') < text.indexOf('await brandWindowsExecutable('))
  assert.ok(text.indexOf('await brandWindowsExecutable(') < text.indexOf('Windows app packaged:'))
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
