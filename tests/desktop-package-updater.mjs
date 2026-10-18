// Native package adapters touch registrations/system package databases. CI only.
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { testScratch, closeTestApp } from './helpers/electron-harness.mjs'
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') throw new Error('System package update tests require a disposable GitHub Actions runner; refusing this machine.')
if (!['win32', 'linux'].includes(process.platform)) throw new Error('Unsupported package test platform.')
const exec = promisify(execFile), windows = process.platform === 'win32', deny = process.argv.includes('--deny')
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const dir = await mkdtemp(path.join(await testScratch(), 'package-updater-'))
const userData = path.join(dir, 'profile'), directory = path.join(userData, 'updates/native-update-package')
const target = windows ? path.join(dir, 'installed') : '/opt/elevenmd', executable = windows ? 'ElevenMD.exe' : 'elevenmd'
const packageFile = path.resolve(windows ? `release/ElevenMD-Setup-${version}.exe` : `release/ElevenMD-${version}-linux-${process.arch}.deb`)
const staged = path.join(directory, windows ? 'payload.exe' : 'payload.deb')
const policyTarget = '/etc/polkit-1/rules.d/49-elevenmd-updater-ci.rules'
let app, restartedPid, complete = false
try {
  await mkdir(directory, { recursive: true })
  if (windows) {
    await exec(packageFile, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${target}`, '/TASKS='])
    const file = path.join(target, 'resources/app/package.json'), pkg = JSON.parse(await readFile(file, 'utf8')); pkg.version = '0.3.9'; await writeFile(file, JSON.stringify(pkg))
  } else {
    const tree = path.join(dir, 'previous-deb'), oldPackage = path.join(dir, 'previous.deb')
    await exec('dpkg-deb', ['-R', packageFile, tree])
    const control = path.join(tree, 'DEBIAN/control'); await writeFile(control, (await readFile(control, 'utf8')).replace(/^Version: .*$/m, 'Version: 0.3.9'))
    const file = path.join(tree, 'opt/elevenmd/resources/app/package.json'), pkg = JSON.parse(await readFile(file, 'utf8')); pkg.version = '0.3.9'; await writeFile(file, JSON.stringify(pkg))
    if (deny) {
      const helper = path.join(tree, 'opt/elevenmd/resources/app/electron/updater/main.cjs')
      await writeFile(helper, (await readFile(helper, 'utf8')).replace("electron.dialog.showErrorBox('ElevenMD update stopped', error.message); app.quit();", 'app.quit();'))
    }
    await exec('dpkg-deb', ['--root-owner-group', '--build', tree, oldPackage])
    await exec('sudo', ['/usr/bin/apt-get', 'install', '-y', '--allow-downgrades', oldPackage], { maxBuffer: 8 * 1024 * 1024 })
    const policy = path.join(dir, 'updater.rules')
    await writeFile(policy, `polkit.addRule(function(action, subject) { if (action.id === "org.freedesktop.policykit.exec" && subject.user === ${JSON.stringify(os.userInfo().username)} && action.lookup("program") === "/usr/bin/apt-get") return polkit.Result.${deny ? 'NO' : 'YES'}; });\n`)
    await exec('sudo', ['install', '-m', '0644', policy, policyTarget]); await exec('sudo', ['systemctl', 'restart', 'polkit'])
  }
  // Keep terminal receipts readable until this isolated harness has asserted them.
  // A denied update reopens the old app, whose normal startup cleanup can remove the receipt between polls.
  const recoveryFile = path.join(target, 'resources/app/electron/updater/recovery.cjs')
  const recoverySource = await readFile(recoveryFile, 'utf8')
  assert.ok(recoverySource.includes('async function cleanupCompletedJobs(context) {'))
  await writeFile(recoveryFile, recoverySource.replace('async function cleanupCompletedJobs(context) {', 'async function cleanupCompletedJobs(context) { return;'))
  await cp(packageFile, staged)
  const sha256 = createHash('sha256').update(await readFile(staged)).digest('hex')
  const env = { ...process.env, NOTEPAD_USER_DATA_DIR: userData }; delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: path.join(target, executable), args: [], env })
  const page = await app.firstWindow(); await page.getByRole('button', { name: 'Source', exact: true }).click(); await page.locator('#source').fill('Package updater private draft fixture')
  await app.evaluate(async ({ app }, args) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    const { resolveUpdateTarget } = require('./electron/update-target.cjs')
    const targetInfo = await resolveUpdateTarget({ execPath: process.execPath, isPackaged: app.isPackaged })
    if (targetInfo.route !== args.route) throw new Error('Wrong native package route: ' + targetInfo.route)
    const prepared = await require('./electron/update-handoff.cjs').prepareHandoff({ targetInfo, userData: app.getPath('userData'), directory: args.directory, staged: args.staged, manifest: { sha256: args.sha256, version: args.version } })
    await prepared.launch()
  }, { directory, staged, sha256, version, route: windows ? 'windows-installed' : 'deb' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {}); app = undefined
  const deadline = Date.now() + 120000; let result
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')); console.log('Native package receipt:', JSON.stringify(result)); break } catch (error) { if (error.code !== 'ENOENT') throw error }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(result, `No native package result; evidence: ${directory}`)
  restartedPid = result.pid || JSON.parse(await readFile(path.join(directory, 'restart-owner.json'), 'utf8')).pid
  assert.equal(result.status, deny ? 'failed' : 'complete')
  assert.equal(JSON.parse(await readFile(path.join(target, 'resources/app/package.json'), 'utf8')).version, deny ? '0.3.9' : version)
  assert.equal(JSON.parse(await readFile(path.join(userData, 'session.json'), 'utf8')).tabs[0].content, 'Package updater private draft fixture')
  complete = true
  console.log(`PASS: real ${windows ? 'Inno installed' : 'DEB/Polkit'} backend ${deny ? 'denial left the old version intact and reopened it' : 'upgraded and received a restored-renderer acknowledgement'}; draft preserved. Previous-version metadata is a fixture; authorization decisions are CI-controlled, not a visible native-dialog test.`)
} finally {
  await closeTestApp(app)
  if (restartedPid) {
    if (windows) await exec('taskkill.exe', ['/PID', String(restartedPid), '/T', '/F']).catch(() => {})
    else { try { process.kill(restartedPid, 'SIGTERM') } catch {} }
  }
  if (!windows) await exec('sudo', ['rm', '-f', policyTarget]).catch(() => {})
  if (complete) {
    await new Promise(resolve => setTimeout(resolve, 1500))
    if (windows) await exec(path.join(target, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'])
    else await exec('sudo', ['/usr/bin/apt-get', 'remove', '-y', 'elevenmd'], { maxBuffer: 8 * 1024 * 1024 })
    await rm(dir, { recursive: true, force: true })
  }
}
