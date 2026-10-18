'use strict';
const fs = require('node:fs');
const io = require('node:fs/promises');
const path = require('node:path');
function createFileMonitor({ notify, watch = fs.watch, intervalMs = 2000, debounceMs = 100 }) {
  let documents = [], disposed = false, busy = false, pending;
  const signatures = new Map(), watchers = new Map();
  function hint() {
    if (disposed) return;
    clearTimeout(pending); pending = setTimeout(() => { if (!disposed) notify(); }, debounceMs); pending.unref?.();
  }
  function setDocuments(next) {
    if (disposed) return;
    documents = next.map(({ id, path }) => ({ id, path }));
    const ids = new Set(documents.map(d => d.id));
    for (const id of signatures.keys()) if (!ids.has(id)) signatures.delete(id);
    const directories = new Set(documents.map(d => path.dirname(d.path)));
    for (const [dir, watcher] of watchers) if (!directories.has(dir)) { watcher.close(); watchers.delete(dir); }
    for (const dir of directories) if (!watchers.has(dir)) {
      try {
        const watcher = watch(dir, { persistent: false }, (_type, filename) => {
          if (!filename || documents.some(d => path.dirname(d.path) === dir && path.basename(d.path) === String(filename))) hint();
        });
        watcher.on('error', () => { watcher.close(); watchers.delete(dir); hint(); }); watchers.set(dir, watcher);
      } catch { /* Missing/unsupported directories are covered by metadata polling. */ }
    }
  }
  async function poll() {
    if (disposed || busy) return;
    busy = true;
    try {
      for (const doc of documents) {
        let signature;
        try { const s = await io.lstat(doc.path, { bigint: true }); signature = `${doc.path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.mode}`; }
        catch (error) { signature = `${doc.path}:${error.code}`; }
        if (signatures.get(doc.id) !== signature) { signatures.set(doc.id, signature); hint(); }
      }
    } finally { busy = false; }
  }
  const timer = setInterval(() => { poll().catch(hint); }, intervalMs); timer.unref?.();
  return { setDocuments, poll, close() { disposed = true; clearInterval(timer); clearTimeout(pending); for (const w of watchers.values()) w.close(); watchers.clear(); documents = []; } };
}
module.exports = { createFileMonitor };
