'use strict';
const fs = require('./fs.cjs').promises;
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { randomBytes, createHash } = require('node:crypto');
const { createReadStream } = require('./fs.cjs');
const { canonicalDirectory, validateManifest, verifyTree } = require('../update-bundle.cjs');
const { applyUpdate, rollbackUpdate, commitUpdate, durable, assertReservation, assertIdentity, releaseReservation } = require('./transaction.cjs');
const { createGate, waitForExit } = require('./protocol.cjs');
function cleanEnvironment(env) {
  const result = { ...env };
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'ELEVENMD_UPDATE_ACK_PORT', 'ELEVENMD_UPDATE_ACK_TOKEN']) delete result[name];
  return result;
}
async function readJob(filename, execPath, { recovery = false } = {}) {
  if (!path.isAbsolute(filename) || path.basename(filename) !== 'job.json') throw new Error('Invalid update job path.');
  const directory = path.dirname(filename); await canonicalDirectory(directory);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error('Invalid update job.');
  const job = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (job.schema !== 1 || job.protocol !== 1 || job.directory !== directory || job.helperExec !== execPath || !execPath.startsWith(directory + path.sep) || !/^[a-f0-9]{64}$/.test(job.token) || !Number.isSafeInteger(job.parentPid) || job.parentPid <= 0 || !Number.isInteger(job.port) || job.port < 1 || job.port > 65535 || !path.isAbsolute(job.userData)) throw new Error('Untrusted update job.');
  const info = job.targetInfo;
  if (!info || !['portable', 'mac-bundle', 'deb', 'windows-installed'].includes(info.route) || info.platform !== process.platform || info.arch !== process.arch || !path.isAbsolute(info.target) || info.execPath !== path.join(info.target, info.executable) || info.target === directory || directory.startsWith(info.target + path.sep) || info.target.startsWith(directory + path.sep)) throw new Error('Update target mismatch.');
  if (recovery) {
    await canonicalDirectory(path.dirname(info.target));
    try { await canonicalDirectory(info.target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  } else await canonicalDirectory(info.target);
  if (!job.reservation || job.reservation.target !== info.target || job.reservation.jobDir !== directory) throw new Error('Reservation target mismatch.');
  await assertReservation(job.reservation, { identity: !recovery });
  if (['portable', 'mac-bundle'].includes(info.route)) {
    job.manifest = validateManifest(job.manifest, { platform: process.platform, arch: process.arch, route: info.route });
    if (job.manifest.executable !== info.executable || job.staged !== path.join(directory, 'staged')) throw new Error('Invalid staged runtime.');
    await verifyTree(job.staged, job.manifest);
  } else {
    if (job.staged !== path.join(directory, info.route === 'deb' ? 'payload.deb' : 'payload.exe') || !job.manifest || !/^[a-f0-9]{64}$/.test(job.manifest.sha256)) throw new Error('Invalid package job.');
    const hash = createHash('sha256'); for await (const bytes of createReadStream(job.staged)) hash.update(bytes);
    if (hash.digest('hex') !== job.manifest.sha256) throw new Error('Package checksum mismatch.');
  }
  return job;
}
async function parentHandoff(job) {
  await new Promise((resolve, reject) => {
    let approved = false, data = '';
    const socket = net.connect(job.port, '127.0.0.1');
    socket.setTimeout(30000, () => socket.destroy(new Error('Parent did not finish handoff.')));
    socket.once('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify({ token: job.token, kind: 'ready' }) + '\n'));
    socket.on('data', bytes => { data += bytes.toString(); if (data.length > 1024) socket.destroy(new Error('Invalid handoff.')); else if (data.includes('\n')) { try { approved = JSON.parse(data.trim()).start === true; } catch { socket.destroy(new Error('Invalid handoff.')); } } });
    socket.once('close', () => approved ? resolve() : reject(new Error('Update handoff cancelled.')));
  });
  await waitForExit({ pid: job.parentPid });
}
async function stopOwnedChild(child, { platform = process.platform, wait = waitForExit, exec = promisify(execFile) } = {}) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (platform === 'win32') await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  } catch { /* The owned process may already have exited; verify independently. */ }
  try {
    await wait({ pid: child.pid, timeoutMs: 10000 });
  } catch {
    const error = new Error('Restarted process has not been confirmed stopped; recovery files preserved.');
    error.unsafeToRollback = true; throw error;
  }
}
function installerArguments(job) {
  if (job.targetInfo.route !== 'windows-installed' || !Number.isSafeInteger(job.parentPid) || job.parentPid < 1 || !/^[A-Za-z]:\\/.test(job.targetInfo.target) || /[\x00-\x1f"<>|?*]/.test(job.targetInfo.target)) throw new Error('Invalid installed update backend.');
  return ['/SP-', '/SILENT', '/NOCANCEL', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/UPDATE', '/EXTERNALUPDATER', `/PARENTPID=${job.parentPid}`, `/DIR=${job.targetInfo.target}`];
}
async function restart(job, { acknowledge = true } = {}) {
  let browserPid;
  const token = randomBytes(32).toString('hex'), gate = acknowledge ? await createGate({ token, kind: 'restored', timeoutMs: 45000, onStarted: async pid => {
    if (browserPid && browserPid !== pid) throw new Error('Restart browser identity changed.');
    browserPid = pid; await durable(path.join(job.directory, 'restart-owner.json'), { pid, target: job.targetInfo.target });
  } }) : null;
  const env = { ...cleanEnvironment(process.env), NOTEPAD_USER_DATA_DIR: job.userData };
  if (gate) { env.ELEVENMD_UPDATE_ACK_PORT = String(gate.port); env.ELEVENMD_UPDATE_ACK_TOKEN = token; }
  let child;
  try {
    child = spawn(job.targetInfo.execPath, [], { shell: false, detached: true, stdio: 'ignore', env });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
    if (!browserPid) await durable(path.join(job.directory, 'restart-owner.json'), { pid: child.pid, target: job.targetInfo.target });
    if (gate) {
      const failure = new Promise((_, reject) => child.once('exit', () => reject(new Error('Updated application exited before session readiness.'))));
      await Promise.race([gate.ready, failure]);
    }
    child.unref(); return { pid: browserPid || child.pid };
  } catch (error) {
    // Only this newly launched child is owned by this helper. Stop it before rollback.
    await stopOwnedChild(browserPid ? { pid: browserPid, exitCode: null, kill: signal => process.kill(browserPid, signal) } : child);
    throw error;
  } finally { gate?.dispose(); }
}
async function runJob(job, progress) {
  await parentHandoff(job); await assertIdentity(job.targetInfo.target, job.reservation.identity); progress('Installing update…');
  let applied = false;
  try {
    if (job.targetInfo.route === 'deb') {
      await promisify(execFile)('/usr/bin/pkexec', ['/usr/bin/apt-get', 'install', '-y', '--', job.staged], { timeout: 600000, maxBuffer: 1024 * 1024 });
    } else if (job.targetInfo.route === 'windows-installed') {
      await promisify(execFile)(job.staged, installerArguments(job), { timeout: 600000, maxBuffer: 1024 * 1024 });
    } else {
      if (job.targetInfo.route === 'mac-bundle') await promisify(execFile)('/usr/bin/codesign', ['--verify', '--deep', '--strict', job.staged]);
      await applyUpdate({ target: job.targetInfo.target, staged: job.staged, manifest: job.manifest, jobDir: job.directory, reservation: job.reservation, onProgress: p => progress(`Installing update… ${Math.floor(p.completed * 100 / p.total)}%`) });
      applied = true;
    }
    progress('Reopening ElevenMD…'); const reopened = await restart(job);
    if (applied) await commitUpdate(job.directory);
    else await releaseReservation(job.reservation);
    await durable(path.join(job.directory, 'result.json'), { status: 'complete', pid: reopened.pid });
    progress('Update complete.');
  } catch (error) {
    if (error.unsafeToRollback) { await durable(path.join(job.directory, 'result.json'), { status: 'recovery-required', reason: 'restart-still-running' }); throw error; }
    if (['portable', 'mac-bundle'].includes(job.targetInfo.route)) {
      try { await rollbackUpdate(job.directory); await restart(job, { acknowledge: false }); }
      catch (recoveryError) { await durable(path.join(job.directory, 'result.json'), { status: 'recovery-required', reason: recoveryError.code || 'recovery-failed' }); throw new Error('Update failed. Recovery files were preserved; do not delete the update folder.'); }
    } else { await releaseReservation(job.reservation); await restart(job, { acknowledge: false }).catch(() => {}); }
    await durable(path.join(job.directory, 'result.json'), { status: 'failed' });
    throw new Error('Update failed. The previous app was restored where possible. Your documents were not changed.');
  }
}
async function recoverJob(job, progress) {
  try { await parentHandoff(job); }
  catch { await waitForExit({ pid: job.parentPid, timeoutMs: 0 }); }
  const restarted = await fs.readFile(path.join(job.directory, 'restart-owner.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (restarted) await waitForExit({ pid: restarted.pid, timeoutMs: 0 });
  progress('Recovering previous version…'); await rollbackUpdate(job.directory);
  const reopened = await restart(job);
  await durable(path.join(job.directory, 'result.json'), { status: 'recovered', pid: reopened.pid });
}
async function startUpdater(electron, filename, { recovery = false } = {}) {
  const { app, BrowserWindow, session, ipcMain } = electron;
  let window;
  try {
    const job = await readJob(filename, process.execPath, { recovery });
    if (recovery) {
      const owner = await fs.readFile(path.join(job.directory, 'helper-owner.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (owner && owner.pid !== process.pid) await waitForExit({ pid: owner.pid, timeoutMs: 0 });
    }
    await durable(path.join(job.directory, 'helper-owner.json'), { token: job.token, pid: process.pid });
    app.setPath('userData', path.join(job.directory, 'helper-user-data'));
    await app.whenReady();
    const partition = session.fromPartition(`updater-${job.token}`);
    partition.setPermissionRequestHandler((_w, _p, callback) => callback(false)); partition.setPermissionCheckHandler(() => false);
    const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
    partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== entry }));
    window = new BrowserWindow({ width: 440, height: 180, resizable: false, title: 'Updating ElevenMD', autoHideMenuBar: true, webPreferences: { session: partition, preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) window.webContents.on(event, e => e.preventDefault());
    let running = true; window.on('close', e => { if (running) e.preventDefault(); });
    await window.loadFile(path.join(__dirname, 'index.html'));
    const progress = text => { if (!window.isDestroyed()) window.webContents.send('updater:progress', text); };
    if (recovery) await recoverJob(job, progress); else await runJob(job, progress); running = false; window.destroy(); app.quit();
  } catch (error) {
    if (window && !window.isDestroyed()) window.destroy();
    await app.whenReady(); electron.dialog.showErrorBox('ElevenMD update stopped', error.message); app.quit();
  }
}
module.exports = { readJob, runJob, startUpdater, stopOwnedChild, installerArguments };
