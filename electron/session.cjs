'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 100 * 1024 * 1024;
function validate(payload) {
  if (!payload || Object.keys(payload).some(k => !['tabs', 'activeId', 'mode'].includes(k)) || !Array.isArray(payload.tabs) || payload.tabs.length > 200 || !['formatted', 'source', 'preview'].includes(payload.mode)) throw new Error('Invalid session.');
  const ids = new Set();
  for (const tab of payload.tabs) {
    if (!tab || Object.keys(tab).some(k => !['id', 'name', 'content', 'savedContent', 'eol', 'bom'].includes(k)) || !UUID.test(tab.id) || ids.has(tab.id) || typeof tab.name !== 'string' || !tab.name || tab.name.length > 255 || /[\u0000-\u001f]/.test(tab.name) || typeof tab.content !== 'string' || tab.content.includes('\0') || (tab.savedContent !== null && typeof tab.savedContent !== 'string') || !['LF', 'CRLF'].includes(tab.eol) || typeof tab.bom !== 'boolean') throw new Error('Invalid session tab.');
    if (Buffer.byteLength(tab.content, 'utf8') > 10 * 1024 * 1024) throw new Error('Session document exceeds 10 MiB.');
    ids.add(tab.id);
  }
  if (payload.tabs.length && !ids.has(payload.activeId)) throw new Error('Invalid active session tab.');
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BYTES) throw new Error('Session exceeds 100 MiB.');
}
function createSessionService({ file, files }) {
  let queue = Promise.resolve();
  async function save(payload) {
    validate(payload);
    const state = { ...payload, tabs: payload.tabs.map(tab => {
      const registered = files.getDocument(tab.id);
      return { ...tab, path: registered?.path || null, diskHash: registered?.diskHash || null };
    }) };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle, owned = false;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); owned = true;
      await handle.writeFile(JSON.stringify(state), 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, file); owned = false;
    } finally {
      try { if (handle) await handle.close(); } finally { if (owned) await fs.rm(temporary, { force: true }); }
    }
    return { stored: true, path: file };
  }
  async function load() {
    let bytes;
    try {
      const handle = await fs.open(file, 'r');
      try {
        if ((await handle.stat()).size > MAX_BYTES) throw new Error('Stored session exceeds 100 MiB.');
        bytes = await handle.readFile('utf8');
      } finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const state = JSON.parse(bytes);
    const payload = { tabs: state.tabs.map(({ path: _path, diskHash: _hash, ...tab }) => tab), activeId: state.activeId, mode: state.mode };
    validate(payload);
    for (const tab of state.tabs) {
      if (tab.path !== null) {
        if (typeof tab.path !== 'string' || !path.isAbsolute(tab.path) || /[\u0000-\u001f]/.test(tab.path) || !/^[a-f0-9]{64}$/i.test(tab.diskHash)) throw new Error('Invalid stored document capability.');
        files.restoreDocument(tab);
      }
    }
    return state;
  }
  return {
    save(payload) { const result = queue.then(() => save(payload)); queue = result.catch(() => {}); return result; },
    load,
    file,
  };
}
module.exports = { createSessionService };
