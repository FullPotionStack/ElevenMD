'use strict';
const fs = require('./fs.cjs').promises;
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { relative, validateManifest, verifyTree, canonicalDirectory } = require('../update-bundle.cjs');
async function exists(filename) { try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function durable(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`, handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temporary, filename); } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}
async function safeParents(root, name) {
  await canonicalDirectory(root);
  const parts = relative(name).split('/');
  for (let i = 1; i < parts.length; i++) {
    const stat = await exists(path.join(root, ...parts.slice(0, i)));
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Aliased update parent.');
  }
}
async function readMarker(root) {
  const filename = path.join(root, '.elevenmd-managed.json'), stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('Invalid managed installation marker.');
  const value = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (value.schema !== 1 || !Array.isArray(value.owned) || value.owned.length > 10000 || !value.owned.includes('.elevenmd-managed.json') || !value.owned.includes(value.executable)) throw new Error('Invalid managed installation inventory.');
  const seen = new Set();
  for (const name of value.owned) { relative(name); const lower = name.toLowerCase(); if (seen.has(lower)) throw new Error('Duplicate managed path.'); seen.add(lower); }
  return value;
}
async function captureIdentity(target, executable) {
  await canonicalDirectory(target); relative(executable); await safeParents(target, executable);
  const root = await fs.lstat(target, { bigint: true }), file = await fs.lstat(path.join(target, executable), { bigint: true });
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n) throw new Error('Invalid installation executable.');
  const hashes = {};
  for (const name of ['.elevenmd-managed.json', 'resources/app/package.json', 'Contents/Resources/app/package.json']) {
    const filename = path.join(target, name), stat = await exists(filename);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid installation identity file.');
    hashes[name] = require('node:crypto').createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  }
  return { executable, rootDev: String(root.dev), rootIno: String(root.ino), exeDev: String(file.dev), exeIno: String(file.ino), size: String(file.size), mtime: String(file.mtimeNs), hashes };
}
async function assertIdentity(target, identity) {
  if (!identity || JSON.stringify(await captureIdentity(target, identity.executable)) !== JSON.stringify(identity)) throw new Error('Installation identity changed since update preparation.');
}
function lockPath(target) { return path.join(path.dirname(target), `.${path.basename(target)}.elevenmd-update.lock`); }
async function reserveUpdate({ target, jobDir, identity }) {
  target = await canonicalDirectory(target); jobDir = await canonicalDirectory(jobDir);
  await assertIdentity(target, identity);
  const id = randomUUID(), reservation = { id, jobDir, target, identity, pid: process.pid };
  const handle = await fs.open(lockPath(target), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(reservation)); await handle.sync(); } finally { await handle.close(); }
  try { await assertIdentity(target, identity); } catch (error) { await fs.unlink(lockPath(target)); throw error; }
  return reservation;
}
async function assertReservation(reservation, { identity = true } = {}) {
  const filename = lockPath(reservation.target), stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid update reservation.');
  const owner = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (owner.id !== reservation.id || owner.jobDir !== reservation.jobDir || owner.target !== reservation.target) throw new Error('Update reservation mismatch.');
  if (identity) await assertIdentity(reservation.target, reservation.identity);
}
async function releaseReservation(reservation) {
  if (!reservation || await exists(path.join(reservation.jobDir, 'transaction.json'))) return;
  const filename = lockPath(reservation.target), stat = await exists(filename); if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid reservation lock.');
  const owner = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (owner.id !== reservation.id || owner.jobDir !== reservation.jobDir) throw new Error('Reservation owner mismatch.');
  await fs.unlink(filename);
}
async function readJournal(jobDir) {
  await canonicalDirectory(jobDir);
  const filename = path.join(jobDir, 'transaction.json'), stat = await exists(filename);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error('Invalid transaction journal.');
  const value = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (value.schema !== 1 || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || !['portable', 'mac-bundle'].includes(value.route) || !['prepared', 'applied', 'committed', 'rolled-back'].includes(value.phase) || !path.isAbsolute(value.target) || !Array.isArray(value.operations) || value.operations.length > 20000) throw new Error('Invalid transaction.');
  const expected = path.join(path.dirname(value.target), `.elevenmd-update-${value.id}`);
  if (value.workspace !== expected || path.dirname(value.workspace) !== path.dirname(value.target)) throw new Error('Unsafe transaction workspace.');
  const paths = new Set();
  for (const op of value.operations) {
    relative(op.path); if (typeof op.hadOld !== 'boolean' || typeof op.hasNew !== 'boolean' || paths.has(op.path.toLowerCase())) throw new Error('Invalid transaction operation.'); paths.add(op.path.toLowerCase());
  }
  return value;
}
async function applyUpdate({ target, staged, manifest, jobDir, reservation, onProgress = () => {}, fault = () => {} }) {
  target = await canonicalDirectory(target); staged = await canonicalDirectory(staged); jobDir = await canonicalDirectory(jobDir);
  if ([staged, jobDir].some(dir => dir === target || dir.startsWith(target + path.sep) || target.startsWith(dir + path.sep))) throw new Error('Update directories must be disjoint.');
  manifest = validateManifest(manifest); await verifyTree(staged, manifest);
  if (await exists(path.join(jobDir, 'transaction.json'))) throw new Error('Existing transaction requires recovery.');
  const marker = manifest.route === 'portable' ? await readMarker(target) : null;
  if (marker && (marker.platform !== manifest.platform || marker.arch !== manifest.arch || marker.route !== 'portable' || marker.executable !== manifest.executable)) throw new Error('Managed target mismatch.');
  reservation ||= await reserveUpdate({ target, jobDir, identity: await captureIdentity(target, manifest.executable) });
  if (reservation.target !== target || reservation.jobDir !== jobDir) throw new Error('Reservation target mismatch.');
  await assertReservation(reservation);
  const lock = lockPath(target);
  const id = reservation.id, workspace = path.join(path.dirname(target), `.elevenmd-update-${id}`);
  let journalWritten = false;
  try {
    await fs.mkdir(workspace, { mode: 0o700 });
    const incoming = path.join(workspace, 'incoming'), backup = path.join(workspace, 'backup');
    await fs.cp(staged, incoming, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await verifyTree(incoming, manifest);
    const old = new Set(marker?.owned || []), fresh = new Set(manifest.entries.map(e => e.path));
    const operations = [];
    if (manifest.route === 'portable') {
      for (const name of [...new Set([...old, ...fresh])].sort()) {
        await safeParents(target, name);
        const stat = await exists(path.join(target, name));
        if (stat && (!old.has(name) || stat.isDirectory() || (!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink !== 1)))) throw new Error('Unowned collision or unsafe target entry.');
        operations.push({ path: name, hadOld: Boolean(stat), hasNew: fresh.has(name) });
      }
    }
    if (manifest.route === 'portable') await fs.mkdir(backup);
    const journal = { schema: 1, id, route: manifest.route, target, workspace, phase: 'prepared', operations };
    await durable(path.join(jobDir, 'transaction.json'), journal); journalWritten = true;
    await fault('prepared');
    if (manifest.route === 'mac-bundle') {
      await fs.rename(target, backup); await fault('backup:0');
      await fs.rename(incoming, target); await fault('installed:0');
    } else {
      for (const [i, op] of operations.entries()) {
        await safeParents(target, op.path);
        if (op.hadOld) {
          const destination = path.join(backup, op.path); await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.rename(path.join(target, op.path), destination);
        }
        await fault(`backup:${i}`);
        if (op.hasNew) { const destination = path.join(target, op.path); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.rename(path.join(incoming, op.path), destination); }
        await fault(`installed:${i}`);
        onProgress({ completed: i + 1, total: operations.length });
      }
    }
    journal.phase = 'applied'; await durable(path.join(jobDir, 'transaction.json'), journal); await fault('applied');
    return { jobDir, target };
  } catch (error) {
    if (!journalWritten) { await fs.rm(workspace, { recursive: true, force: true }); await fs.unlink(lock).catch(() => {}); }
    throw error;
  }
}
async function finish(jobDir, rollback) {
  const journal = await readJournal(jobDir);
  if (!journal) return;
  if (['committed', 'rolled-back'].includes(journal.phase)) { await cleanupTerminal(jobDir, journal); return; }
  const lock = path.join(path.dirname(journal.target), `.${path.basename(journal.target)}.elevenmd-update.lock`);
  const lockStat = await fs.lstat(lock);
  if (!lockStat.isFile() || lockStat.isSymbolicLink() || lockStat.size > 4096) throw new Error('Invalid update lock.');
  const owner = JSON.parse(await fs.readFile(lock, 'utf8'));
  if (owner.id !== journal.id || owner.jobDir !== jobDir) throw new Error('Transaction lock mismatch.');
  await canonicalDirectory(journal.workspace);
  const backup = path.join(journal.workspace, 'backup'), incoming = path.join(journal.workspace, 'incoming');
  if (rollback) {
    if (journal.route === 'mac-bundle') {
      if (await exists(backup)) {
        if (await exists(journal.target)) { await canonicalDirectory(journal.target); await fs.rename(journal.target, path.join(journal.workspace, 'failed')); }
        await fs.rename(backup, journal.target);
      }
    } else {
      await canonicalDirectory(journal.target);
      for (const op of [...journal.operations].reverse()) {
        await safeParents(journal.target, op.path); await safeParents(backup, op.path);
        const saved = path.join(backup, op.path), destination = path.join(journal.target, op.path);
        if (await exists(saved)) {
          const stat = await exists(destination); if (stat?.isDirectory()) throw new Error('Unexpected directory blocks rollback.');
          if (stat) await fs.unlink(destination);
          await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.rename(saved, destination);
        } else if (!op.hadOld && op.hasNew && !(await exists(path.join(incoming, op.path)))) {
          const stat = await exists(destination); if (stat?.isDirectory()) throw new Error('Unexpected directory blocks rollback.');
          if (stat) await fs.unlink(destination);
        }
      }
    }
  } else if (journal.phase !== 'applied') throw new Error('Cannot commit an incomplete update.');
  journal.phase = rollback ? 'rolled-back' : 'committed';
  await durable(path.join(jobDir, 'transaction.json'), journal);
  await cleanupTerminal(jobDir, journal);
}
async function cleanupTerminal(jobDir, journal) {
  const lock = lockPath(journal.target), stat = await exists(lock);
  if (stat) {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid cleanup lock.');
    const owner = JSON.parse(await fs.readFile(lock, 'utf8'));
    if (owner.id !== journal.id || owner.jobDir !== jobDir) throw new Error('Cleanup lock belongs to another update.');
  }
  if (await exists(journal.workspace)) { await canonicalDirectory(journal.workspace); await fs.rm(journal.workspace, { recursive: true, force: true }); }
  if (stat) await fs.unlink(lock);
}
module.exports = { captureIdentity, assertIdentity, reserveUpdate, assertReservation, releaseReservation, applyUpdate, rollbackUpdate: jobDir => finish(jobDir, true), commitUpdate: jobDir => finish(jobDir, false), readJournal, readMarker, durable };
