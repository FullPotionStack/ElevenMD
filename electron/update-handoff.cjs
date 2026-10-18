'use strict';
const fs = require('./updater/fs.cjs').promises;
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { canonicalDirectory, verifyTree } = require('./update-bundle.cjs');
const { durable, captureIdentity, reserveUpdate, releaseReservation } = require('./updater/transaction.cjs');
const { createGate } = require('./updater/protocol.cjs');
function launchEnvironment(env = process.env) {
  const clean = { ...env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'ELEVENMD_UPDATE_ACK_PORT', 'ELEVENMD_UPDATE_ACK_TOKEN']) delete clean[key];
  return clean;
}
async function checkDiskSpace({ directory, targetParent, runtimeBytes, statfs = fs.statfs }) {
  const staging = await statfs(directory, { bigint: true });
  const installation = await statfs(targetParent, { bigint: true });
  const need = BigInt(runtimeBytes * 3 + 64 * 1024 * 1024);
  if (staging.bavail * staging.bsize < need || installation.bavail * installation.bsize < need) throw new Error('Insufficient disk space for a recoverable update.');
}
async function prepareHandoff({ targetInfo, userData, staged, manifest, directory, parentPid = process.pid, spawnImpl = spawn }) {
  const { target, executable, execPath, route } = targetInfo;
  if (!['portable', 'mac-bundle', 'deb', 'windows-installed'].includes(route) || !Number.isSafeInteger(parentPid) || parentPid < 1 || !path.isAbsolute(userData)) throw new Error('Invalid updater handoff.');
  await canonicalDirectory(target); await canonicalDirectory(directory);
  if (directory === target || directory.startsWith(target + path.sep) || userData === target || userData.startsWith(target + path.sep)) throw new Error('Unsafe updater staging location.');
  const direct = ['portable', 'mac-bundle'].includes(route);
  if (direct) await verifyTree(staged, manifest);
  const identity = await captureIdentity(target, executable);
  let runtimeBytes = 0;
  async function sum(dir) { for (const name of await fs.readdir(dir)) { const filename = path.join(dir, name), stat = await fs.lstat(filename); if (stat.isDirectory() && !stat.isSymbolicLink()) await sum(filename); else runtimeBytes += stat.size; } }
  await sum(target);
  // Old helper copy plus incoming target-local copy and previous-version backup.
  await checkDiskSpace({ directory, targetParent: path.dirname(target), runtimeBytes });
  if (route !== 'deb') { await fs.access(target, fs.constants.W_OK); await fs.access(path.dirname(target), fs.constants.W_OK); }
  else {
    await fs.access('/usr/bin/pkexec', fs.constants.X_OK); await fs.access('/usr/bin/apt-get', fs.constants.X_OK);
    const sandbox = await fs.lstat(path.join(target, 'chrome-sandbox'));
    if (!sandbox.isFile() || sandbox.isSymbolicLink() || sandbox.uid !== 0 || (sandbox.mode & 0o4755) !== 0o4755) throw new Error('Trusted system sandbox unavailable.');
  }
  const helperRoot = path.join(directory, route === 'mac-bundle' ? 'helper.app' : 'helper-runtime');
  await fs.cp(target, helperRoot, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  const helperExec = path.join(helperRoot, executable);
  const token = randomBytes(32).toString('hex');
  let gate, reservation;
  return {
    async launch() {
      reservation = await reserveUpdate({ target, jobDir: directory, identity, ...(route === 'deb' ? { lockDirectory: path.dirname(directory) } : {}) });
      gate = await createGate({ token, kind: 'ready', timeoutMs: 30000 });
      const job = { schema: 1, protocol: 1, parentPid, token, port: gate.port, directory, helperExec, targetInfo, userData, staged, manifest, reservation };
      const jobFile = path.join(directory, 'job.json'); await durable(jobFile, job);
      let child;
      try {
        child = spawnImpl(helperExec, ['--elevenmd-updater-job', jobFile], { shell: false, detached: true, stdio: 'ignore', windowsHide: true, env: { ...launchEnvironment(), ...(route === 'deb' ? { CHROME_DEVEL_SANDBOX: path.join(target, 'chrome-sandbox') } : {}) } });
        const failure = new Promise((_, reject) => { child.once('error', reject); child.once('exit', () => reject(new Error('Updater exited before readiness.'))); });
        const socket = await Promise.race([gate.ready, failure]);
        socket.write('{"start":true}\n'); socket.unref(); child.unref();
        // Parent process termination closes this authenticated socket. The helper
        // additionally requires PID absence; socket closure alone never allows writes.
      } catch (error) { gate.dispose(); await releaseReservation(reservation); throw error; }
    },
    async dispose() { gate?.dispose(); await releaseReservation(reservation); },
  };
}
module.exports = { prepareHandoff, launchEnvironment, checkDiskSpace };
