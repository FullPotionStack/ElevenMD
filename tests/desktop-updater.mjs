import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { testScratch, packagedExecutable, closeTestApp } from './helpers/electron-harness.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createBundle } = require('../electron/update-bundle.cjs')
const scratch = await mkdtemp(path.join(await testScratch(), 'desktop-updater-'))
const executable = process.platform === 'win32' ? 'ElevenMD.exe' : process.platform === 'darwin' ? 'Contents/MacOS/ElevenMD' : 'elevenmd'
const route = process.platform === 'darwin' ? 'mac-bundle' : 'portable'
const runtime = process.platform === 'darwin' ? path.resolve(path.dirname(packagedExecutable()), '../..') : path.dirname(packagedExecutable())
const crash = process.argv.includes('--crash-recovery'), missingAck = process.argv.includes('--missing-ack'), serviceFlow = process.argv.includes('--service')
const target = path.join(scratch, process.platform === 'darwin' ? 'ElevenMD.app' : 'portable'), userData = path.join(scratch, 'profile')
let directory = path.join(userData, 'updates/native-update-fixture')
const staged = path.join(directory, 'staged')
let expectedDraft = 'Unsaved updater regression fixture'
let app, restartPid, message, finished = false
async function waitResult() {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Updater never completed. Recovery directory: ${directory}`)
}
try {
  await mkdir(directory, { recursive: true }); await cp(runtime, target, { recursive: true, verbatimSymlinks: true }); await cp(runtime, staged, { recursive: true, verbatimSymlinks: true })
  const pkgFile = path.join(target, process.platform === 'darwin' ? 'Contents/Resources/app/package.json' : 'resources/app/package.json'), pkg = JSON.parse(await readFile(pkgFile, 'utf8')); pkg.version = '0.3.9'; await writeFile(pkgFile, JSON.stringify(pkg))
  await writeFile(path.join(target, 'unrelated.md'), 'Unrelated original file must survive')
  if (crash) {
    const transaction = path.join(path.dirname(pkgFile), 'electron/updater/transaction.cjs')
    const source = await readFile(transaction, 'utf8')
    const needle = route === 'mac-bundle' ? "await fault('backup:0');" : 'await fault(`backup:${i}`);'
    assert.ok(source.includes(needle))
    await writeFile(transaction, source.replace(needle, route === 'mac-bundle' ? 'process.exit(86);' : 'if (i === 0) process.exit(86);'))
  }
  if (missingAck) {
    const appPath = process.platform === 'darwin' ? 'Contents/Resources/app' : 'resources/app'
    const preload = path.join(staged, appPath, 'electron/preload.cjs')
    const text = await readFile(preload, 'utf8'); assert.ok(text.includes("sessionReady: () => ipcRenderer.invoke('notepad:session-ready')"))
    await writeFile(preload, text.replace("sessionReady: () => ipcRenderer.invoke('notepad:session-ready')", 'sessionReady: async () => true'))
    const helper = path.join(target, appPath, 'electron/updater/main.cjs')
    const helperSource = await readFile(helper, 'utf8')
    await writeFile(helper, helperSource.replace('timeoutMs: 45000', 'timeoutMs: 3000').replace("electron.dialog.showErrorBox('ElevenMD update stopped', error.message); app.quit();", 'app.quit();'))
  }
  if (serviceFlow) {
    const supportFile = path.join(path.dirname(pkgFile), 'electron/support.cjs'), supportSource = await readFile(supportFile, 'utf8')
    const needle = 'createUpdateService({ version, repository:'; assert.ok(supportSource.includes(needle))
    await writeFile(supportFile, supportSource.replace(needle, 'createUpdateService({ fetchImpl: (...args) => process.__elevenmdFixtureFetch(...args), version, repository:'))
  }
  const built = await createBundle({ root: staged, destination: path.join(scratch, 'fixture.bundle.gz'), version: '0.3.10', repository: 'FullPotionStack/ElevenMD', platform: process.platform, arch: process.arch, route, executable })
  const { manifest } = built
  const env = { ...process.env, NOTEPAD_USER_DATA_DIR: userData }; delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: path.join(target, executable), args: [], env })
  const page = await app.firstWindow(); await page.getByRole('button', { name: 'Source', exact: true }).click(); await page.locator('#source').fill(expectedDraft)
  if (serviceFlow) {
    await app.evaluate(({ dialog }, args) => {
      const fs = process.getBuiltinModule('node:fs/promises')
      const stem = `ElevenMD-0.3.10-${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch}-update`
      const base = 'https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.10/'
      const descriptor = { schema: 1, asset: stem + '.bundle.gz', size: args.size, sha256: args.sha256, manifest: args.manifest }
      const json = JSON.stringify(descriptor)
      process.__elevenmdFixtureFetch = async url => {
        if (url.endsWith('/releases/latest')) return Response.json({ tag_name: 'v0.3.10', draft: false, prerelease: false, body: 'Controlled native service fixture', assets: [{ name: stem + '.json', browser_download_url: base + stem + '.json', size: Buffer.byteLength(json) }, { name: stem + '.bundle.gz', browser_download_url: base + stem + '.bundle.gz', size: args.size }] })
        if (url === base + stem + '.json') return new Response(json)
        if (url === base + stem + '.bundle.gz') return new Response(await fs.readFile(args.filename))
        throw new Error('Unexpected fixture transport URL')
      }
      dialog.showMessageBox = async () => ({ response: 0 })
    }, { ...built, filename: path.join(scratch, 'fixture.bundle.gz') })
    assert.equal((await page.evaluate(() => window.notepad.checkUpdates())).status, 'available')
    assert.equal((await page.evaluate(() => window.notepad.downloadUpdate())).status, 'downloaded')
    expectedDraft += ' edited after download'; await page.locator('#source').fill(expectedDraft)
    await page.evaluate(() => window.notepad.installUpdate()).catch(error => { if (!/closed/i.test(error.message)) throw error })
    for (const name of await (await import('node:fs/promises')).readdir(path.join(userData, 'updates'))) {
      const candidate = path.join(userData, 'updates', name)
      try { await readFile(path.join(candidate, 'job.json')); directory = candidate; break } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  } else await app.evaluate(async ({ app }, args) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    const { prepareHandoff } = require(require('node:path').join(app.getAppPath(), 'electron/update-handoff.cjs'))
    const prepared = await prepareHandoff({ targetInfo: { target: args.target, execPath: process.execPath, executable: args.executable, platform: process.platform, arch: process.arch, route: args.route }, userData: app.getPath('userData'), staged: args.staged, manifest: args.manifest, directory: args.directory, parentPid: process.pid })
    await prepared.launch()
  }, { target, staged, manifest, directory, executable, route })
  // Checkpoint through the normal close flow; do not dispose Playwright's app
  // dispatcher or kill its detached updater subtree after natural parent exit.
  if (!serviceFlow) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
  app = undefined
  if (crash) {
    const deadline = Date.now() + 45000
    let stopped = false
    while (Date.now() < deadline) {
      try {
        const journal = JSON.parse(await readFile(path.join(directory, 'transaction.json'), 'utf8'))
        const owner = JSON.parse(await readFile(path.join(directory, 'helper-owner.json'), 'utf8'))
        try { process.kill(owner.pid, 0) } catch (error) { if (error.code === 'ESRCH' && journal.phase === 'prepared') { stopped = true; break } }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(stopped, 'helper must actually terminate at the journal boundary')
    if (route === 'portable') {
      const recoveryApp = await electron.launch({ executablePath: path.join(target, executable), args: [], env })
      // Startup must discover the interrupted job and hand off without opening the editor.
      const child = recoveryApp.process(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve))
    } else {
      // Missing .app cannot be launched: exercise the preserved standalone helper.
      const job = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8'))
      const child = (await import('node:child_process')).spawn(job.helperExec, ['--elevenmd-updater-recover', path.join(directory, 'job.json')], { detached: true, stdio: 'ignore', env }); child.unref()
    }
  }
  const result = await waitResult(); restartPid = result.pid || (missingAck ? JSON.parse(await readFile(path.join(directory, 'restart-owner.json'), 'utf8')).pid : undefined)
  assert.equal(result.status, crash ? 'recovered' : missingAck ? 'failed' : 'complete')
  assert.ok(Number.isInteger(restartPid))
  assert.equal(JSON.parse(await readFile(pkgFile, 'utf8')).version, crash || missingAck ? '0.3.9' : '0.3.10')
  const session = JSON.parse(await readFile(path.join(userData, 'session.json'), 'utf8'))
  assert.equal(session.tabs[0].content, expectedDraft)
  if (route === 'portable') assert.equal(await readFile(path.join(target, 'unrelated.md'), 'utf8'), 'Unrelated original file must survive')
  assert.equal(JSON.parse(await readFile(path.join(directory, 'transaction.json'), 'utf8')).phase, crash || missingAck ? 'rolled-back' : 'committed')
  finished = true
  if (crash) message = 'PASS: abrupt helper termination after backup was recovered by the next app/helper launch; old runtime and draft restored with no unrelated-file loss.'
  else if (missingAck) message = 'PASS: absent renderer-ready acknowledgement stopped the newly launched app before rollback and restored the previous runtime and draft. Fixture-only shortened deadline and suppressed error dialog.'
  else if (serviceFlow) message = 'PASS: real app update service checked and downloaded the verified bundle, ran native confirmation, checkpointed edits made after downloading, handed off to the helper, replaced the runtime and received restored-session readiness. Transport and confirmation are controlled fixtures.'
  else message = 'PASS: real packaged updater waited for parent exit, replaced runtime/helper files, reopened the new version, received renderer session-ready acknowledgement, preserved the draft and unrelated file, and committed recovery journal. Controlled local payload; not a live GitHub transport test.'
} finally {
  await closeTestApp(app)
  if (restartPid) {
    if (process.platform === 'win32') await promisify(execFile)('taskkill.exe', ['/PID', String(restartPid), '/T', '/F']).catch(() => {})
    else { try { process.kill(restartPid, 'SIGTERM') } catch {} }
  }
  // Preserve failure evidence rather than deleting a running helper or recovery payload.
  if (restartPid && finished) { await new Promise(resolve => setTimeout(resolve, 1500)); await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
}
if (finished) console.log(message)
