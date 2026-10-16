// Scratch-only LOCAL VERIFICATION BUILD, not a release or an installed-app lifecycle test.
// HTTP metadata/assets and the native consent answer are controlled; actual setup replacement,
// checkpointing, process exit, restart and restored document DOM are real.
import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, rename, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { testScratch, closeTestApp } from './helpers/electron-harness.mjs'

if (process.platform !== 'win32') throw new Error('Windows-only portable update verification.')
const exec = promisify(execFile), scratch = await testScratch()
const dir = await mkdtemp(path.join(scratch, 'elevenmd-portable-update-'))
const payload = path.join(dir, 'payload'), portable = path.join(dir, 'portable copy')
const profile = path.join(dir, 'profile'), resultPath = path.join(dir, 'restart-result.json')
const launchPath = path.join(dir, 'launch.json'), logPath = path.join(dir, 'setup.log')
const pkg = JSON.parse(await readFile('package.json', 'utf8')), name = `ElevenMD-Setup-${pkg.version}.exe`
const installer = path.join(dir, name), fixture = path.join(portable, 'my own document.md')
const registryKeys = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{6C0E4662-46BB-4C4A-B40C-6C11A157E911}_is1',
  'HKCU\\Software\\Classes\\Applications\\ElevenMD.exe', 'HKCU\\Software\\Classes\\ElevenMD.Markdown', 'HKCU\\Software\\Classes\\ElevenMD.Text',
  'HKCU\\Software\\ElevenMD',
  ...['.md', '.markdown', '.txt'].map(ext => `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\OpenWithElevenMD`),
  ...['.md', '.markdown', '.txt'].map(ext => `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`),
]
async function registrySnapshot() {
  return Promise.all(registryKeys.map(async key => {
    try { return (await exec('reg.exe', ['query', key, '/s'], { windowsHide: true })).stdout }
    catch (error) { if (error.code === 1) return null; throw error }
  }))
}
// Prove registry observation works before trusting unchanged/missing-key assertions.
assert.ok((await exec('reg.exe', ['query', 'HKCU\\Software'], { windowsHide: true })).stdout.includes('HKEY_CURRENT_USER'))
const before = await registrySnapshot()
let app
try {
  await cp('node_modules/electron/dist', payload, { recursive: true })
  await rename(path.join(payload, 'electron.exe'), path.join(payload, 'ElevenMD.exe'))
  const appDir = path.join(payload, 'resources', 'app')
  await mkdir(appDir, { recursive: true })
  for (const folder of ['dist', 'electron']) await cp(folder, path.join(appDir, folder), { recursive: true })
  const restartEntry = `const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.on('browser-window-created', (_, win) => win.webContents.once('did-finish-load', () => {
  let attempts = 0;
  const capture = async () => {
    const dom = await win.webContents.executeJavaScript(\`({ preview: document.querySelector('#preview').innerText, previewHidden: document.querySelector('#preview').hidden, tabs: [...document.querySelectorAll('#tablist [role=tab]')].map(el => ({ name: el.getAttribute('aria-label'), selected: el.getAttribute('aria-selected') })), mode: document.querySelector('#preview-mode').getAttribute('aria-pressed') })\`);
    if ((!dom.preview.includes('Unnamed portable draft') || dom.tabs.length !== 2) && ++attempts < 50) { setTimeout(capture, 100); return; }
    fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ ...dom, version: app.getVersion(), execPath: process.execPath, pid: process.pid }));
    win.close();
  };
  setTimeout(capture, 100);
}));
require('./electron/main.cjs');\n`
  await writeFile(path.join(appDir, 'verification-restart.cjs'), restartEntry)
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: 'verification-restart.cjs' }))
  // No release output directory is modified. Compile the real installer script against scratch.
  const compilers = [process.env.ISCC_PATH, path.join(process.env.LOCALAPPDATA, 'Programs/Inno Setup 6/ISCC.exe'), 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'].filter(Boolean)
  let compiler
  for (const candidate of compilers) { try { await access(candidate); compiler = candidate; break } catch {} }
  assert.ok(compiler, 'Inno Setup compiler exists')
  const compiled = await exec(compiler, [`/DAppVersion=${pkg.version}`, '/DInstallerPrefix=ElevenMD-Setup', `/DAppSourceDir=${payload}`, `/DBuildOutputDir=${dir}`, path.resolve('installer/ElevenMD.iss')], { windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 })
  await writeFile(path.join(dir, 'compile.log'), compiled.stdout)
  await access(installer)
  await cp(payload, portable, { recursive: true })
  const oldApp = path.join(portable, 'resources', 'app')
  await writeFile(path.join(oldApp, 'package.json'), JSON.stringify({ name: pkg.name, version: '0.0.0', main: 'verification-old.cjs' }))
  await writeFile(fixture, '# Original bytes must not change\r\n')
  await writeFile(path.join(portable, 'keep-me.txt'), 'Unrelated portable file')
  const oldEntry = `const fs = require('node:fs');
const crypto = require('node:crypto');
const child = require('node:child_process'), spawn = child.spawn;
child.spawn = function(file, args, options) {
  const process = spawn(file, [...args, ${JSON.stringify('/LOG=' + logPath)}], options);
  fs.writeFileSync(${JSON.stringify(launchPath)}, JSON.stringify({ file, args, pid: process.pid }));
  return process;
};
const bytes = fs.readFileSync(${JSON.stringify(installer)}), name = ${JSON.stringify(name)};
const base = 'https://github.com/FullPotionStack/ElevenMD/releases/download/v${pkg.version}/';
globalThis.fetch = async url => {
  if (String(url).endsWith('/releases/latest')) return Response.json({ tag_name: 'v${pkg.version}', draft: false, prerelease: false, body: '# Local verification build', assets: [
    { name, size: bytes.length, browser_download_url: base + name },
    { name: 'SHA256SUMS', size: 130, browser_download_url: base + 'SHA256SUMS' }
  ] });
  if (url === base + 'SHA256SUMS') return new Response(crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + name + '\\n');
  if (url === base + name) return new Response(bytes);
  throw new Error('Unexpected verification request');
};
require('./electron/main.cjs');\n`
  await writeFile(path.join(oldApp, 'verification-old.cjs'), oldEntry)
  const env = { ...process.env, NOTEPAD_USER_DATA_DIR: profile }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NOTEPAD_DEV_URL
  app = await electron.launch({ executablePath: path.join(portable, 'ElevenMD.exe'), args: [fixture], env })
  const page = await app.firstWindow()
  await expect(page.getByRole('tab', { name: 'my own document.md', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  await page.locator('#source').fill('# Unsaved named portable draft\n')
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.locator('#source').fill('# Unnamed portable draft\n')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
  await expect(page.locator('#update-status')).toContainText('Update available')
  await page.locator('#update-status').click()
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Install and restart', exact: true })).toBeVisible({ timeout: 30000 })
  const exited = page.waitForEvent('close', { timeout: 30000 })
  await page.getByRole('button', { name: 'Install and restart', exact: true }).click()
  await exited
  // The original app exited normally. Its Playwright dispatcher is already disposed;
  // do not ask closeTestApp to inspect it or kill the detached updater's process tree.
  app = undefined
  // Do not close/kill Playwright's process tree here: setup is its detached descendant.
  const deadline = Date.now() + 90000
  while (true) {
    try { await access(resultPath); break } catch { if (Date.now() >= deadline) throw new Error('Portable updater did not replace and restart the fixture.'); await new Promise(resolve => setTimeout(resolve, 200)) }
  }
  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  const launch = JSON.parse(await readFile(launchPath, 'utf8'))
  assert.ok(launch.args.includes('/PORTABLEUPDATE'))
  assert.ok(launch.args.includes('/SILENT'))
  assert.equal(launch.args.includes('/VERYSILENT'), false, 'native progress is not hidden')
  assert.equal(result.version, pkg.version)
  for (const file of ['main.cjs', 'updates.cjs', 'support.cjs', 'update-launcher.cjs']) {
    assert.deepEqual(await readFile(path.join(portable, 'resources', 'app', 'electron', file)), await readFile(path.join(payload, 'resources', 'app', 'electron', file)), `Updated ${file} matches the local verification payload`)
  }
  assert.equal(result.execPath.toLowerCase(), path.join(portable, 'ElevenMD.exe').toLowerCase())
  assert.equal(result.previewHidden, false); assert.equal(result.mode, 'true')
  assert.match(result.preview, /Unnamed portable draft/)
  assert.equal(result.tabs.length, 2)
  assert.equal(result.tabs[1].selected, 'true')
  const stored = JSON.parse(await readFile(path.join(profile, 'session.json'), 'utf8'))
  assert.deepEqual(stored.tabs.map(tab => tab.content), ['# Unsaved named portable draft\n', '# Unnamed portable draft\n'])
  assert.equal(await readFile(fixture, 'utf8'), '# Original bytes must not change\r\n')
  assert.equal(await readFile(path.join(portable, 'keep-me.txt'), 'utf8'), 'Unrelated portable file')
  await assert.rejects(access(path.join(portable, 'unins000.exe')))
  await assert.rejects(access(path.join(portable, 'unins000.dat')))
  assert.deepEqual(await registrySnapshot(), before, 'portable update must not change app-owned Windows registrations')
  const setupLog = await readFile(logPath, 'utf8')
  assert.match(setupLog, /Installation process succeeded/)
  console.log(`PASS: LOCAL VERIFICATION BUILD ${pkg.version}, simulated previous metadata 0.0.0. Real verified download → checkpoint → progress-only portable setup → same-folder replacement → automatic restart with both dirty tabs and visible Preview restored. Original/unrelated files and Windows app registrations unchanged; no uninstaller created. Controlled HTTP/native approval and harness-only startup entries, not a published release or installed-app lifecycle check. Evidence: ${dir}`)
} catch (error) {
  console.error(`Portable verification evidence retained: ${dir}`)
  try { console.error((await readFile(logPath, 'utf8')).slice(-6000)) } catch {}
  throw error
} finally {
  await closeTestApp(app)
  // Retain isolated local-build evidence; no release artifacts or installed identities touched.
}
