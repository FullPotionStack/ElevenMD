'use strict';
const fs = require('./fs.cjs').promises;
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { canonicalDirectory } = require('../update-bundle.cjs');
const { durable } = require('./transaction.cjs');
const { createGate } = require('./protocol.cjs');
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function json(filename, limit = 4 * 1024 * 1024) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit) throw new Error('Unsafe recovery metadata.');
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}
async function jobs({ userData, execPath }) {
  const root = path.join(userData, 'updates');
  try { await canonicalDirectory(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const name of await fs.readdir(root)) {
    if (!/^native-update-[A-Za-z0-9_-]+$/.test(name)) continue;
    const directory = path.join(root, name);
    try {
      await canonicalDirectory(directory);
      const job = await json(path.join(directory, 'job.json'));
      if (job.schema !== 1 || job.protocol !== 1 || job.directory !== directory || job.userData !== userData || job.targetInfo?.execPath !== execPath || typeof job.helperExec !== 'string' || !job.helperExec.startsWith(directory + path.sep)) continue;
      let pid = job.reservation?.pid;
      // The helper persists its actual PID before signalling readiness.
      const owner = await json(path.join(directory, 'helper-owner.json'), 4096).catch(() => null);
      if (owner && owner.token === job.token) pid = owner.pid;
      if (alive(pid)) continue;
      result.push(job);
    } catch { /* Unrecognized directories are never modified. */ }
  }
  return result;
}
async function findRecoveryJob(context) {
  for (const job of await jobs(context)) {
    const result = await json(path.join(job.directory, 'result.json'), 4096).catch(() => null);
    if (['complete', 'recovered', 'failed'].includes(result?.status)) continue;
    const journal = await json(path.join(job.directory, 'transaction.json')).catch(() => null);
    if (journal && ['prepared', 'applied'].includes(journal.phase)) return job;
  }
  return null;
}
async function cleanupCompletedJobs(context) {
  for (const job of await jobs(context)) {
    const result = await json(path.join(job.directory, 'result.json'), 4096).catch(() => null);
    const journal = await json(path.join(job.directory, 'transaction.json')).catch(() => null);
    const terminal = journal && ['committed', 'rolled-back'].includes(journal.phase);
    if (result ? !['complete', 'recovered', 'failed'].includes(result.status) : !terminal) continue;
    if (journal && !terminal) continue;
    if (journal) await (journal.phase === 'committed' ? require('./transaction.cjs').commitUpdate(job.directory) : require('./transaction.cjs').rollbackUpdate(job.directory));
    await fs.rm(job.directory, { recursive: true, force: true });
  }
}
async function launchRecovery(job) {
  await canonicalDirectory(path.dirname(job.helperExec));
  if (await fs.realpath(job.helperExec) !== job.helperExec || !(await fs.lstat(job.helperExec)).isFile()) throw new Error('Recovery helper unavailable.');
  const token = randomBytes(32).toString('hex'), gate = await createGate({ token, kind: 'ready' });
  const next = { ...job, parentPid: process.pid, token, port: gate.port };
  await durable(path.join(job.directory, 'job.json'), next);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  try {
    const child = spawn(job.helperExec, ['--elevenmd-updater-recover', path.join(job.directory, 'job.json')], { detached: true, shell: false, stdio: 'ignore', env });
    const failed = new Promise((_, reject) => { child.once('error', reject); child.once('exit', () => reject(new Error('Recovery helper exited.'))); });
    const socket = await Promise.race([gate.ready, failed]); socket.write('{"start":true}\n'); socket.unref(); child.unref();
  } catch (error) { gate.dispose(); throw error; }
}
module.exports = { findRecoveryJob, cleanupCompletedJobs, launchRecovery };
