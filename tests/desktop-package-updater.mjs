// Native package fixtures touch registrations/system package databases. CI only.
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { testScratch, closeTestApp } from './helpers/electron-harness.mjs'
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') throw new Error('System package update tests require a disposable GitHub Actions runner; refusing this machine.')
if (!['win32', 'linux'].includes(process.platform)) throw new Error('Unsupported package test platform.')
const exec = promisify(execFile), windows = process.platform === 'win32', deny = process.argv.includes('--deny')
if (windows && deny) throw new Error('--deny exercises Linux DEB/Polkit authorization only.')
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const dir = await mkdtemp(path.join(await testScratch(), 'package-updater-'))
const userData = path.join(dir, 'profile')
let directory = path.join(userData, 'updates/native-update-package')
const target = windows ? path.join(dir, 'installed') : '/opt/elevenmd', executable = windows ? 'ElevenMD.exe' : 'elevenmd'
const packageFile = path.resolve(windows ? `release/ElevenMD-Setup-${version}.exe` : `release/ElevenMD-${version}-linux-${process.arch}.deb`)
const staged = path.join(directory, 'payload.deb')
const policyTarget = '/etc/polkit-1/rules.d/49-elevenmd-updater-ci.rules'
const obsolete = 'obsolete-updater-fixture.txt', unrelated = 'Unrelated original file must survive'
let expectedDraft = 'Package updater private draft fixture'
let descriptor, descriptorFile, bundleFile, base, api, manifest, originalUninstaller, requests = []
async function retainFixtureReceipt(file) {
  // Only the copied previous-version fixture skips cleanup, so terminal evidence survives startup.
  const source = await readFile(file, 'utf8')
  assert.ok(source.includes('async function cleanupCompletedJobs(context) {'))
  await writeFile(file, source.replace('async function cleanupCompletedJobs(context) {', 'async function cleanupCompletedJobs(context) { return;'))
}
let app, restartedPid, parentPid, helperPid, complete = false
try {
  await mkdir(directory, { recursive: true })
  if (windows) {
    // Setup is used ONCE to create a disposable installed fixture, never as an update payload.
    await exec(packageFile, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${target}`, '/TASKS='])
    const file = path.join(target, 'resources/app/package.json'), pkg = JSON.parse(await readFile(file, 'utf8')); pkg.version = '0.3.9'; await writeFile(file, JSON.stringify(pkg))
    originalUninstaller = await Promise.all(['unins000.exe', 'unins000.dat'].map(name => readFile(path.join(target, name))))
    const markerFile = path.join(target, '.elevenmd-managed.json'), marker = JSON.parse(await readFile(markerFile, 'utf8'))
    assert.equal(marker.route, 'portable')
    assert.ok(!marker.owned.some(name => /^unins000\.(exe|dat)$/i.test(name)))
    await writeFile(path.join(target, obsolete), 'Old marker-owned runtime file must be removed')
    marker.owned.push(obsolete); await writeFile(markerFile, JSON.stringify(marker))
    await writeFile(path.join(target, 'unrelated.md'), unrelated)
    await retainFixtureReceipt(path.join(target, 'resources/app/electron/updater/recovery.cjs'))
    // Fixture-only transport injection; retain the real createUpdateService, prepareHandoff,
    // native consent and renderer checkpoint. Expose the SAME service to call install without
    // the IPC adapter's automatic destroy/quit, then exercise a final normal window close.
    const supportFile = path.join(target, 'resources/app/electron/support.cjs'), support = await readFile(supportFile, 'utf8')
    const constructor = 'createUpdateService({ version, repository:', observer = '  const zero = (name, callback) =>'
    assert.ok(support.includes(constructor)); assert.ok(support.includes(observer))
    await writeFile(supportFile, support.replace(constructor, 'createUpdateService({ fetchImpl: (...args) => process.__elevenmdFixtureFetch(...args), version, repository:').replace(observer, '  process.__elevenmdFixtureUpdates = updates;\n' + observer))
    const { repository } = createRequire(import.meta.url)('../electron/distribution.cjs')
    const stem = `ElevenMD-${version}-windows-${process.arch}-update`
    descriptorFile = path.resolve(`release/${stem}.json`); bundleFile = path.resolve(`release/${stem}.bundle.gz`)
    descriptor = JSON.parse(await readFile(descriptorFile, 'utf8')); manifest = descriptor.manifest
    assert.equal(descriptor.asset, `${stem}.bundle.gz`)
    assert.equal(descriptor.size, (await stat(bundleFile)).size)
    assert.equal(createHash('sha256').update(await readFile(bundleFile)).digest('hex'), descriptor.sha256)
    assert.equal(manifest.version, version); assert.equal(manifest.repository, repository)
    assert.equal(manifest.platform, 'win32'); assert.equal(manifest.arch, process.arch); assert.equal(manifest.route, 'portable')
    assert.notEqual(version, '0.3.9', 'Release must be newer than the previous-version metadata fixture')
    assert.ok(!manifest.entries.some(entry => [obsolete, 'unrelated.md'].includes(entry.path)))
    assert.ok(!manifest.entries.some(entry => /(^|\/)(?:unins000\.(?:exe|dat)|.*-Setup-.*\.exe)$/i.test(entry.path)))
    base = `https://github.com/${repository}/releases/download/v${version}/`
    api = `https://api.github.com/repos/${repository}/releases/latest`
  } else {
    const tree = path.join(dir, 'previous-deb'), oldPackage = path.join(dir, 'previous.deb')
    await exec('dpkg-deb', ['-R', packageFile, tree])
    const control = path.join(tree, 'DEBIAN/control'); await writeFile(control, (await readFile(control, 'utf8')).replace(/^Version: .*$/m, 'Version: 0.3.9'))
    const file = path.join(tree, 'opt/elevenmd/resources/app/package.json'), pkg = JSON.parse(await readFile(file, 'utf8')); pkg.version = '0.3.9'; await writeFile(file, JSON.stringify(pkg))
    await retainFixtureReceipt(path.join(tree, 'opt/elevenmd/resources/app/electron/updater/recovery.cjs'))
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
  if (!windows) await cp(packageFile, staged)
  const env = { ...process.env, NOTEPAD_USER_DATA_DIR: userData }; delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: path.join(target, executable), args: [], env }); parentPid = await app.evaluate(() => process.pid)
  const page = await app.firstWindow(); await page.getByRole('button', { name: 'Source', exact: true }).click(); await page.locator('#source').fill(expectedDraft)
  if (windows) {
    const release = { tag_name: `v${version}`, draft: false, prerelease: false, body: 'Controlled installed-Windows bundle fixture', assets: [
      { name: path.basename(descriptorFile), browser_download_url: base + path.basename(descriptorFile), size: (await stat(descriptorFile)).size },
      { name: descriptor.asset, browser_download_url: base + descriptor.asset, size: descriptor.size },
      // Advertise the real Setup too: installed updates must prefer the release bundle.
      { name: path.basename(packageFile), browser_download_url: base + path.basename(packageFile), size: (await stat(packageFile)).size },
    ] }
    await app.evaluate(async ({ app, dialog, BrowserWindow }, args) => {
      const fs = process.getBuiltinModule('node:fs/promises')
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
      const info = await require('./electron/update-target.cjs').resolveUpdateTarget({ execPath: process.execPath, isPackaged: app.isPackaged })
      if (info.route !== 'windows-installed') throw new Error('Wrong installed-Windows route: ' + info.route)
      process.__elevenmdFixtureRequests = []; process.__elevenmdFixtureConsent = []
      process.__elevenmdFixtureFetch = async url => {
        process.__elevenmdFixtureRequests.push(url)
        if (url === args.api) return Response.json(args.release)
        if (url === args.base + args.descriptorName) return new Response(await fs.readFile(args.descriptorFile))
        if (url === args.base + args.bundleName) {
          const { Readable } = require('node:stream')
          return new Response(Readable.toWeb(require('node:fs').createReadStream(args.bundleFile)))
        }
        throw new Error('Unexpected fixture transport URL (Setup/EXE updates are forbidden)')
      }
      // Production native-dialog hook, CI-controlled answer; not a visible OS-dialog test.
      dialog.showMessageBox = async (owner, options) => {
        if (owner !== BrowserWindow.getAllWindows()[0] || options.title !== 'Update ElevenMD') throw new Error('Unexpected native confirmation')
        process.__elevenmdFixtureConsent.push({ title: options.title, message: options.message, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId })
        return { response: 0 }
      }
    }, { api, base, release, descriptorName: path.basename(descriptorFile), descriptorFile, bundleName: descriptor.asset, bundleFile })
    assert.equal((await page.evaluate(() => window.notepad.checkUpdates())).status, 'available')
    assert.equal((await page.evaluate(() => window.notepad.downloadUpdate())).status, 'downloaded')
    expectedDraft += ' edited after download'; await page.locator('#source').fill(expectedDraft)
    const trace = await app.evaluate(async () => ({ state: await process.__elevenmdFixtureUpdates.install(), requests: process.__elevenmdFixtureRequests, consent: process.__elevenmdFixtureConsent }))
    requests = trace.requests
    assert.equal(trace.state.installed, true); assert.equal(trace.state.currentVersion, '0.3.9')
    assert.deepEqual(requests, [api, base + path.basename(descriptorFile), base + descriptor.asset])
    assert.ok(requests.every(url => !/setup|\.exe(?:$|[?#])/i.test(url)), 'No Setup or EXE download during an installed update')
    assert.deepEqual(trace.consent, [{ title: 'Update ElevenMD', message: `Install ElevenMD ${version}?`, buttons: ['Install and restart', 'Cancel'], defaultId: 1, cancelId: 1 }])
    const jobs = []
    for (const name of await readdir(path.join(userData, 'updates'))) {
      const candidate = path.join(userData, 'updates', name)
      try { jobs.push({ directory: candidate, job: JSON.parse(await readFile(path.join(candidate, 'job.json'), 'utf8')) }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    assert.equal(jobs.length, 1); directory = jobs[0].directory
    const { job } = jobs[0]
    assert.equal(job.targetInfo.route, 'windows-installed'); assert.equal(job.targetInfo.target, target)
    assert.equal(job.parentPid, parentPid); assert.deepEqual(job.manifest, manifest)
    assert.equal(job.staged, path.join(directory, 'staged'))
    assert.equal(job.helperExec, path.join(directory, 'helper-runtime', executable))
    assert.notEqual(job.helperExec, path.join(target, executable))
    helperPid = JSON.parse(await readFile(path.join(directory, 'helper-owner.json'), 'utf8')).pid
    assert.ok(Number.isInteger(helperPid)); assert.notEqual(helperPid, parentPid); process.kill(helperPid, 0)
    // Separate helper is ready, but replacement must wait for normal parent exit.
    process.kill(parentPid, 0)
    assert.equal(JSON.parse(await readFile(path.join(target, 'resources/app/package.json'), 'utf8')).version, '0.3.9')
    assert.equal(await readFile(path.join(target, obsolete), 'utf8'), 'Old marker-owned runtime file must be removed')
    assert.equal(JSON.parse(await readFile(path.join(userData, 'session.json'), 'utf8')).tabs[0].content, expectedDraft)
  } else {
    const sha256 = createHash('sha256').update(await readFile(staged)).digest('hex')
    await app.evaluate(async ({ app }, args) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
      const { resolveUpdateTarget } = require('./electron/update-target.cjs')
      const targetInfo = await resolveUpdateTarget({ execPath: process.execPath, isPackaged: app.isPackaged })
      if (targetInfo.route !== 'deb') throw new Error('Wrong native package route: ' + targetInfo.route)
      const prepared = await require('./electron/update-handoff.cjs').prepareHandoff({ targetInfo, userData: app.getPath('userData'), directory: args.directory, staged: args.staged, manifest: { sha256: args.sha256, version: args.version } })
      await prepared.launch()
    }, { directory, staged, sha256, version })
  }
  // Normal close checkpoints through the real renderer; never kill the parent/helper subtree.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {}); app = undefined
  const deadline = Date.now() + 120000; let result
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')); console.log('Native package receipt:', JSON.stringify({ status: result.status, pid: result.pid, reason: result.reason })); break } catch (error) { if (error.code !== 'ENOENT') throw error }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(result, `No native package result; evidence: ${directory}`)
  restartedPid = result.pid || JSON.parse(await readFile(path.join(directory, 'restart-owner.json'), 'utf8')).pid
  assert.equal(result.status, deny ? 'failed' : 'complete')
  assert.equal(JSON.parse(await readFile(path.join(target, 'resources/app/package.json'), 'utf8')).version, deny ? '0.3.9' : version)
  assert.equal(JSON.parse(await readFile(path.join(userData, 'session.json'), 'utf8')).tabs[0].content, expectedDraft)
  if (windows) {
    assert.ok(Number.isInteger(result.pid)); assert.notEqual(restartedPid, parentPid); assert.notEqual(restartedPid, helperPid)
    process.kill(restartedPid, 0)
    assert.equal(JSON.parse(await readFile(path.join(directory, 'restart-owner.json'), 'utf8')).pid, restartedPid)
    const journal = JSON.parse(await readFile(path.join(directory, 'transaction.json'), 'utf8'))
    assert.equal(journal.phase, 'committed') // Commit follows restored-renderer ACK, not mere spawn.
    assert.equal(journal.route, 'portable'); assert.equal(journal.target, target)
    assert.deepEqual(journal.operations.find(op => op.path === obsolete), { path: obsolete, hadOld: true, hasNew: false })
    assert.ok(journal.operations.some(op => op.path === executable && op.hadOld && op.hasNew))
    assert.ok(!journal.operations.some(op => ['unins000.exe', 'unins000.dat', 'unrelated.md'].includes(op.path)))
    await assert.rejects(readFile(path.join(target, obsolete)), { code: 'ENOENT' })
    const marker = JSON.parse(await readFile(path.join(target, '.elevenmd-managed.json'), 'utf8'))
    assert.deepEqual([...marker.owned].sort(), manifest.entries.map(entry => entry.path).sort())
    for (const entry of manifest.entries) {
      assert.equal(entry.type, 'file')
      assert.equal(createHash('sha256').update(await readFile(path.join(target, entry.path))).digest('hex'), entry.sha256, `Release bundle replacement: ${entry.path}`)
    }
    for (const [i, name] of ['unins000.exe', 'unins000.dat'].entries()) assert.deepEqual(await readFile(path.join(target, name)), originalUninstaller[i], `${name} must be preserved byte-for-byte`)
    assert.equal(await readFile(path.join(target, 'unrelated.md'), 'utf8'), unrelated)
    console.log('Installed update requests:', JSON.stringify(requests))
  }
  complete = true
  console.log(windows
    ? 'PASS: installed Windows service selected the GitHub release bundle, never downloaded Setup/EXE, checkpointed after-download edits, obtained controlled native consent, used a separate helper after normal close, replaced marker-owned files and received restored-renderer ACK; uninstaller metadata, unrelated file and private draft preserved. Previous-version metadata uses current runtime code; transport/consent are controlled CI fixtures, not live GitHub/native-dialog interaction.'
    : `PASS: real DEB/Polkit backend ${deny ? 'denial left the old version intact and reopened it' : 'upgraded and received a restored-renderer acknowledgement'}; draft preserved. Previous-version metadata is a fixture; authorization decisions are CI-controlled, not a visible native-dialog test.`)
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
