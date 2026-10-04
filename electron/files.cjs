'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const MAX_BYTES = 10 * 1024 * 1024;
const normalize = text => text.replace(/\r\n|\r/g, '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function validateSave(payload) {
  const allowed = new Set(['id', 'content', 'saveAs', 'name']);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !allowed.has(key)) ||
      typeof payload.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id) ||
      typeof payload.content !== 'string' || typeof payload.saveAs !== 'boolean' ||
      (payload.name !== undefined && (typeof payload.name !== 'string' || !payload.name || payload.name.length > 255 || /[\\/\\\\:\u0000-\u001f]/.test(payload.name)))) {
    throw new Error('Invalid save request. Paths must come from a native dialog.');
  }
  if (payload.content.includes('\u0000')) throw new Error('Binary text cannot be saved.');
  if (Buffer.byteLength(payload.content, 'utf8') > MAX_BYTES) throw new Error('Content exceeds the 10 MiB limit.');
}
function createDocumentService(options = {}) {
  const io = options.fs || fs;
  const documents = new Map();
  const byPath = new Map();
  async function snapshot(filename) {
    let stat;
    try { stat = await io.lstat(filename); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile()) throw new Error('Only regular files can be opened or saved.');
    if (stat.size > MAX_BYTES) throw new Error('File exceeds the 10 MiB limit.');
    const handle = await io.open(filename, 'r');
    let bytes;
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) throw new Error('Only regular files can be opened or saved.');
      if (openedStat.size > MAX_BYTES) throw new Error('File exceeds the 10 MiB limit.');
      const buffer = Buffer.allocUnsafe(MAX_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, Math.min(65536, buffer.length - total), total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > MAX_BYTES) throw new Error('File exceeds the 10 MiB limit.');
      bytes = buffer.subarray(0, total);
      stat = openedStat;
    } finally { await handle.close(); }
    const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    if (text.includes('\u0000')) throw new Error('Binary files cannot be edited.');
    return { hash: hash(bytes), mode: stat.mode, bom, eol: text.includes('\r\n') ? 'CRLF' : 'LF', content: normalize(text) };
  }
  async function openPath(filename) {
    const canonical = await io.realpath(filename);
    const existing = await snapshot(canonical);
    if (!existing) throw new Error('File no longer exists.');
    const prior = documents.get(byPath.get(canonical));
    if (prior && prior.hash === existing.hash) return { ...prior.doc };
    const doc = { id: randomUUID(), path: canonical, name: path.basename(canonical), content: existing.content, eol: existing.eol, bom: existing.bom };
    documents.set(doc.id, { doc, hash: existing.hash });
    byPath.set(canonical, doc.id);
    return { ...doc };
  }
  async function save(payload, choosePath) {
    validateSave(payload);
    let record = documents.get(payload.id);
    let target = record?.doc.path;
    if (!record || payload.saveAs) {
      if (typeof choosePath !== 'function') throw new Error('A native Save dialog is required.');
      const selected = await choosePath({ name: record?.doc.name || payload.name || 'Untitled.md', path: target });
      if (!selected) return null;
      target = path.resolve(selected);
      try { target = await io.realpath(target); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        target = path.join(await io.realpath(path.dirname(target)), path.basename(target));
      }
    }
    const owner = byPath.get(target);
    if (owner && owner !== payload.id) throw new Error('This target is already open in another tab. Save that tab or choose a different file.');
    const existing = await snapshot(target);
    const expectedHash = record && target === record.doc.path ? record.hash : existing?.hash;
    const content = normalize(payload.content);
    const metadata = existing || record?.doc || { eol: 'LF', bom: false };
    const text = metadata.eol === 'CRLF' ? content.replace(/\n/g, '\r\n') : content;
    const bytes = Buffer.from((metadata.bom ? '\ufeff' : '') + text, 'utf8');
    if (bytes.length > MAX_BYTES) throw new Error('Encoded file exceeds the 10 MiB limit.');
    async function checkOriginal() {
      const current = await snapshot(target);
      if (current?.hash !== expectedHash) throw new Error('File changed on disk. Reopen it or use Save As to a different file.');
    }
    await checkOriginal();
    const temporary = path.join(path.dirname(target), `.notepad-md-${randomUUID()}.tmp`);
    let handle;
    let ownsTemporary = false;
    try {
      handle = await io.open(temporary, 'wx', 0o600);
      ownsTemporary = true;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await checkOriginal();
      await io.rename(temporary, target);
      ownsTemporary = false;
    } finally {
      try { if (handle) await handle.close(); }
      finally { if (ownsTemporary) await io.rm(temporary, { force: true }); }
    }
    if (record && byPath.get(record.doc.path) === payload.id) byPath.delete(record.doc.path);
    const doc = { id: payload.id, path: target, name: path.basename(target), content, eol: metadata.eol, bom: metadata.bom };
    record = { doc, hash: hash(bytes) };
    documents.set(doc.id, record);
    byPath.set(target, doc.id);
    return { ...doc };
  }
  // Serialize dialogs and disk operations so each save compares against the previous save's hash.
  let queue = Promise.resolve();
  function serial(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  return {
    getDocument: id => { const record = documents.get(id); return record ? { ...record.doc, diskHash: record.hash } : null; },
    restoreDocument: tab => {
      if (byPath.has(tab.path) && byPath.get(tab.path) !== tab.id) throw new Error('Duplicate stored document path.');
      const doc = { id: tab.id, path: tab.path, name: tab.name, content: tab.savedContent ?? tab.content, eol: tab.eol, bom: tab.bom };
      documents.set(tab.id, { doc, hash: tab.diskHash }); byPath.set(tab.path, tab.id);
    },
    openPath: filename => serial(() => openPath(filename)),
    save: (payload, choosePath) => serial(() => save(payload, choosePath)),
  };
}
module.exports = { createDocumentService, MAX_BYTES };
