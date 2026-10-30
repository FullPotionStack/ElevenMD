'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const LIMIT = 32 * 1024 * 1024;

function createExportService({ io = fs } = {}) {
  async function snapshot(target) {
    let stat;
    try { stat = await io.lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('Export destination is not a supported regular file.');
    const data = await io.readFile(target);
    if (data.length > LIMIT) throw new Error('Export destination exceeds the size limit.');
    return createHash('sha256').update(data).digest('hex');
  }
  async function exportFile(payload, choosePath) {
    if (!payload || Object.keys(payload).some(key => !['format', 'data', 'name'].includes(key)) ||
      !['rtf', 'pdf'].includes(payload.format) || typeof payload.name !== 'string' ||
      !payload.name || payload.name.length > 255 || /[\\/:\u0000-\u001f]/.test(payload.name) ||
      !(typeof payload.data === 'string' || Buffer.isBuffer(payload.data))) throw new Error('Invalid export request.');
    const bytes = Buffer.from(payload.data);
    if (!bytes.length || bytes.length > LIMIT) throw new Error('Export exceeds the size limit.');
    if (payload.format === 'rtf' && !bytes.subarray(0, 6).equals(Buffer.from('{\\rtf1')) ||
        payload.format === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid export content.');
    if (typeof choosePath !== 'function') throw new Error('A native Save dialog is required.');
    const chosen = await choosePath(payload.name, payload.format);
    if (!chosen) return null;
    let target = path.resolve(chosen);
    if (path.extname(target).toLowerCase() !== `.${payload.format}`) throw new Error('The destination must use the selected format extension.');
    try { target = await io.realpath(target); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      target = path.join(await io.realpath(path.dirname(target)), path.basename(target));
    }
    if (path.extname(target).toLowerCase() !== `.${payload.format}`) throw new Error('The resolved destination must use the selected format extension.');
    const original = await snapshot(target);
    const temporary = path.join(path.dirname(target), `.elevenmd-export-${randomUUID()}.tmp`);
    let handle, owned = false;
    try {
      handle = await io.open(temporary, 'wx', 0o600); owned = true;
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      if (await snapshot(target) !== original) throw new Error('Export destination changed on disk. Choose it again.');
      await io.rename(temporary, target); owned = false;
    } finally {
      if (handle) await handle.close();
      if (owned) await io.rm(temporary, { force: true });
    }
    return { name: path.basename(target) };
  }
  let queue = Promise.resolve();
  return { exportFile(payload, choosePath) { const next = queue.then(() => exportFile(payload, choosePath)); queue = next.catch(() => {}); return next; } };
}
module.exports = { createExportService };
