import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { testScratch, closeTestApp } from './helpers/electron-harness.mjs'
import { inspectWindowsExecutable, iconResources } from '../scripts/windows-branding.mjs'

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const installer = path.resolve(`release/ElevenMD-Setup-${version}.exe`)
const dir = await mkdtemp(path.join(await testScratch(), 'elevenmd-installer-')), installDir = path.join(dir, 'installed')
const exe = path.join(installDir, 'ElevenMD.exe')
const desktop = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim()
const shortcuts = [path.join(desktop, 'ElevenMD.lnk'), path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ElevenMD.lnk')]
const key = name => `HKCU\\Software\\Classes\\${name}`
const query = (name, value) => spawnSync('reg.exe', ['query', name, value ? '/v' : '/ve', ...(value ? [value] : [])], { encoding: 'utf8' })
const defaults = ['.md', '.markdown', '.txt'].map(ext => query(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`, 'ProgId').stdout)
let app, installed = false
try {
  execFileSync(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${installDir}`, '/TASKS=associate,filemenu,desktopicon'], { stdio: 'ignore' }); installed = true
  await access(exe); for (const file of shortcuts) await access(file)
  const branding = await inspectWindowsExecutable(exe)
  assert.equal(branding.version.ProductName, 'ElevenMD'); assert.equal(branding.version.FileDescription, 'ElevenMD'); assert.equal(branding.version.FileVersion, version)
  const expectedIcons = iconResources(await readFile(new URL('../public/elevenmd.ico', import.meta.url))).sort((a,b) => a.type-b.type || a.name-b.name)
  assert.deepEqual(branding.resources.filter(r => [3,14].includes(r.type)).sort((a,b) => a.type-b.type || a.name-b.name), expectedIcons)
  assert.match(query(key('Applications\\ElevenMD.exe'), 'FriendlyAppName').stdout, /ElevenMD/)
  for (const ext of ['.md', '.markdown', '.txt']) {
    const prog = ext === '.txt' ? 'ElevenMD.Text' : 'ElevenMD.Markdown'
    assert.equal(query(key(`${ext}\\OpenWithProgids`), prog).status, 0)
    const verb = query(key(`SystemFileAssociations\\${ext}\\shell\\OpenWithElevenMD`), 'Icon')
    assert.equal(verb.status, 0); assert.ok(verb.stdout.includes(exe))
    const fixture = path.join(dir, `fixture${ext}`); await writeFile(fixture, '# Installed fixture\n\nSynthetic QA document.\n')
    const env = { ...process.env, NOTEPAD_USER_DATA_DIR: path.join(dir, `profile-${ext}`) }; delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
    app = await electron.launch({ executablePath: exe, args: [fixture], env })
    const page = await app.firstWindow()
    await expect(page.getByRole('tab', { name: `fixture${ext}`, exact: true })).toBeVisible()
    await expect(page.locator('.tiptap')).toContainText('Installed fixture')
    await expect(page.getByRole('button', { name: 'Choose diagnostics privacy' })).toBeVisible()
    await closeTestApp(app); app = null
  }
  const after = ['.md', '.markdown', '.txt'].map(ext => query(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`, 'ProgId').stdout)
  assert.deepEqual(after, defaults, 'installer must not change Windows defaults')
  console.log('PASS real per-user installer: exact PE icon/name/version; friendly Open With registration; optional shortcuts/verbs; .md/.markdown/.txt installed launches; existing defaults untouched')
} finally {
  await closeTestApp(app)
  if (installed) {
    const result = spawnSync(path.join(installDir, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { stdio: 'ignore' })
    assert.equal(result.status, 0)
    await new Promise(resolve => setTimeout(resolve, 1500))
    await assert.rejects(access(exe))
    for (const file of shortcuts) await assert.rejects(access(file))
    for (const name of ['Applications\\ElevenMD.exe', 'ElevenMD.Markdown', 'ElevenMD.Text', ...['.md', '.markdown', '.txt'].map(ext => `SystemFileAssociations\\${ext}\\shell\\OpenWithElevenMD`)]) assert.notEqual(query(key(name)).status, 0)
    console.log('PASS uninstall: app-owned executable, shortcuts and friendly Open With/Explorer registrations removed')
  }
  await rm(dir, { recursive: true, force: true })
}
