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
    if (tab?.sourceKind !== undefined && (!['rtf', 'pdf'].includes(tab.sourceKind) || !/^[a-f0-9]{64}$/.test(tab.sourceHash) || (tab.sourceKind === 'rtf' && (typeof tab.sourceBaseline !== 'string' || tab.sourceBaseline.includes('\0') || Buffer.byteLength(tab.sourceBaseline, 'utf8') > 10 * 1024 * 1024)) || (tab.sourceKind === 'pdf' && (tab.kind !== 'pdf' || tab.sourceBaseline !== undefined)))) throw new Error('Invalid imported source.');
    if (tab?.sourceKind === undefined && (tab?.sourceHash !== undefined || tab?.sourceBaseline !== undefined)) throw new Error('Invalid imported source.');
    if (tab?.pdfPreviousSelected !== undefined && (tab.kind !== 'pdf' || tab.pdfPreviousSelected !== true || typeof tab.previousContent !== 'string')) throw new Error('Invalid previous PDF state.');
    if (tab?.kind === 'pdf' && tab.previousContent != null && (typeof tab.previousContent !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(tab.previousContent) || !Buffer.from(tab.previousContent, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new Error('Invalid previous PDF.');
    if (tab?.kind !== undefined && (tab.kind !== 'pdf' || tab.savedContent !== tab.content || !/^[A-Za-z0-9+/]*={0,2}$/.test(tab.content) || !Buffer.from(tab.content, 'base64').subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new Error('Invalid PDF session tab.');
    if (!tab || (tab.rtfWarning !== undefined && typeof tab.rtfWarning !== 'boolean') || Object.keys(tab).some(k => !['id', 'name', 'content', 'savedContent', 'previousContent', 'pdfPreviousSelected', 'eol', 'bom', 'color', 'rtfWarning', 'kind', 'sourceKind', 'sourceHash', 'sourceBaseline'].includes(k)) || (tab.previousContent !== undefined && tab.previousContent !== null && (typeof tab.previousContent !== 'string' || tab.previousContent.includes('\0') || Buffer.byteLength(tab.previousContent, 'utf8') > 10 * 1024 * 1024)) || (tab.color !== undefined && tab.color !== null && (typeof tab.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(tab.color))) || !UUID.test(tab.id) || ids.has(tab.id) || typeof tab.name !== 'string' || !tab.name || tab.name.length > 255 || /[\u0000-\u001f]/.test(tab.name) || typeof tab.content !== 'string' || tab.content.includes('\0') || (tab.savedContent !== null && typeof tab.savedContent !== 'string') || !['LF', 'CRLF'].includes(tab.eol) || typeof tab.bom !== 'boolean') throw new Error('Invalid session tab.');
    if (Buffer.byteLength(tab.content, 'utf8') > 10 * 1024 * 1024) throw new Error('Session document exceeds 10 MiB.');
    ids.add(tab.id);
  }
  if (payload.tabs.length && !ids.has(payload.activeId)) throw new Error('Invalid active session tab.');
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BYTES) throw new Error('Session exceeds 100 MiB.');
}
function createSessionService({ file, files, imports }) {
  let queue = Promise.resolve();
  async function save(payload) {
    validate(payload);
    if (payload.tabs.some(tab => tab.kind === 'pdf' || tab.sourceKind)) throw new Error('RTF and PDF opening is not supported.');
    const state = { ...payload, tabs: payload.tabs.map(tab => {
      const registered = tab.sourceKind ? null : files.getDocument(tab.id);
      const origin = tab.sourceKind ? imports?.getOrigin(tab.id, tab.sourceHash) : null;
      if (tab.sourceKind && (!origin || origin.kind !== tab.sourceKind)) throw new Error('Invalid import capability.');
      return { ...tab, ...(registered ? { savedContent: registered.content, eol: registered.eol, bom: registered.bom } : {}), path: registered?.path || null, diskHash: registered?.diskHash || null, ...(origin ? { origin } : {}) };
    }) };
    if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_BYTES) throw new Error('Session exceeds 100 MiB.');
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
    const payload = { tabs: state.tabs.map(({ path: _path, diskHash: _hash, origin: _origin, ...tab }) => tab), activeId: state.activeId, mode: state.mode };
    validate(payload);
    if (state.tabs.some(tab => tab.kind === 'pdf' || tab.sourceKind || /\.(?:rtf|pdf)$/i.test(tab.path || ''))) {
      // Keep an exact private recovery copy before the first new checkpoint can replace it.
      const backup = path.join(path.dirname(file), `session.legacy-formats-${randomUUID()}.json`);
      let handle, owned = false;
      try {
        handle = await fs.open(backup, 'wx', 0o600); owned = true;
        await handle.writeFile(bytes, 'utf8'); await handle.sync(); await handle.close(); handle = null;
        owned = false;
      } finally {
        try { if (handle) await handle.close(); } finally { if (owned) await fs.rm(backup, { force: true }); }
      }
      state.tabs = state.tabs.filter(tab => tab.kind !== 'pdf').map(tab => {
        if (!tab.sourceKind && !/\.(?:rtf|pdf)$/i.test(tab.path || '')) return tab;
        const { sourceKind, sourceHash, sourceBaseline, origin, rtfWarning, ...draft } = tab;
        return { ...draft, name: /\.(?:rtf|pdf)$/i.test(draft.name) ? `${draft.name.slice(0, 252)}.md` : draft.name, path: null, diskHash: null, savedContent: null, recovered: true };
      });
      if (!state.tabs.some(tab => tab.id === state.activeId)) state.activeId = state.tabs[0]?.id || null;
    }
    for (const tab of state.tabs) {
      if (tab.sourceKind) {
        if (!imports || !tab.origin || tab.path !== null || tab.origin.kind !== tab.sourceKind || tab.origin.sourceHash !== tab.sourceHash) throw new Error('Invalid stored import capability.');
        imports.restore(tab.id, tab.origin);
      } else if (tab.origin !== undefined) throw new Error('Invalid stored import capability.');
      if (tab.path !== null) {
        if (typeof tab.path !== 'string' || !path.isAbsolute(tab.path) || /[\u0000-\u001f]/.test(tab.path) || !/^[a-f0-9]{64}$/i.test(tab.diskHash)) throw new Error('Invalid stored document capability.');
        files.restoreDocument(tab);
      }
    }
    return { ...state, tabs: state.tabs.map(({ origin: _origin, ...tab }) => tab) };
  }
  return {
    save(payload) { const result = queue.then(() => save(payload)); queue = result.catch(() => {}); return result; },
    load,
    file,
  };
}
module.exports = { createSessionService };
