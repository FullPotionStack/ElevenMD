'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Only semantic enums cross the storage boundary. Never stringify caller objects.
const OUTCOMES = Object.freeze(['success', 'cancelled', 'failure', 'blocked', 'noop']);
const ERROR_CATEGORIES = Object.freeze(['file_read', 'file_write', 'external_change', 'file_too_large', 'unsupported_format', 'permission', 'session_read', 'session_write', 'image_read', 'image_import', 'network', 'update_check', 'update_download', 'update_install', 'diagnostics_storage', 'renderer', 'unknown']);
const EVENT_SCHEMA = Object.freeze({
  mode_changed: { mode: ['formatted', 'source', 'preview'] },
  document_new: { outcome: OUTCOMES },
  document_open: { outcome: OUTCOMES },
  document_save: { outcome: OUTCOMES },
  document_save_as: { outcome: OUTCOMES },
  document_close: { outcome: OUTCOMES },
  formatting: { action: ['paragraph', 'heading', 'bold', 'italic', 'strike', 'code', 'code_block', 'blockquote', 'bullet_list', 'ordered_list', 'task_list', 'link', 'image', 'table', 'horizontal_rule', 'undo', 'redo'], outcome: OUTCOMES },
  theme_changed: { preference: ['system', 'light', 'dark'] },
  find_replace: { action: ['open_find', 'open_replace', 'find_next', 'find_previous', 'replace_one', 'replace_all', 'close'], outcome: OUTCOMES },
  update: { action: ['check', 'download', 'install', 'open_release'], outcome: OUTCOMES },
  lifecycle: { action: ['startup', 'session_restore', 'quit'], },
  error: { category: ERROR_CATEGORIES },
});
for (const fields of Object.values(EVENT_SCHEMA)) {
  for (const values of Object.values(fields)) Object.freeze(values);
  Object.freeze(fields);
}
function own(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
function sanitizeEvent(input, at) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const type = own(input, 'type');
    if (typeof type !== 'string' || !Object.hasOwn(EVENT_SCHEMA, type)) return null;
    const result = { type };
    for (const [key, values] of Object.entries(EVENT_SCHEMA[type])) {
      const value = own(input, key);
      if (!values.includes(value)) return null;
      result[key] = value;
    }
    if (type !== 'error') {
      const category = own(input, 'category');
      if (ERROR_CATEGORIES.includes(category)) result.category = category;
    }
    if (type === 'find_replace') {
      const count = own(input, 'count');
      if (Number.isInteger(count) && count >= 0 && count <= 10000) result.count = count;
    }
    result.at = at;
    return result;
  } catch { return null; }
}

const MAX_EVENTS = 200;
const MAX_BYTES = 256 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const LIMITS = Object.freeze({ maxEvents: MAX_EVENTS, maxBytes: MAX_BYTES, maxAgeDays: 7 });
function safeVersion(value) {
  return typeof value === 'string' && /^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(value) ? value : 'unknown';
}

/**
 * Main-process-only, local, opt-in diagnostics. Pass a file below app.getPath('userData').
 * const diagnostics = createDiagnosticsService({ file, version: app.getVersion() });
 * await diagnostics.load(); // idempotent; getConsent() is null (unset), false, or true
 * await diagnostics.setConsent(true); // only after an explicit user decision
 * await diagnostics.record({ type: 'document_save', outcome: 'success' });
 * await diagnostics.inspect(); // detached safe object; no personal environment fields
 * await diagnostics.buildReport(); // safe JSON text only; never uploads or opens URLs
 * await diagnostics.clear(); // preserves consent; setConsent(false) also clears history
 *
 * EVENT_SCHEMA lists REQUIRED enum fields; optional category uses ERROR_CATEGORIES.
 * Only find_replace supports count (integer 0..10000). at is a service-owned timestamp.
 * record resolves false when off, before load, invalid, or the 200-pending-record limit
 * is reached. A true result means accepted into the bounded history, not immortalized:
 * later events, expiry, clear, and revocation may remove it. Calls share one serialized
 * flush promise. Await consent/clear before confirming durability to the user.
 * Storage failures reject with fixed code DIAGNOSTICS_STORAGE, disable recording and
 * attempt deletion. If the OS denies deletion too, callers must not claim disk clearing.
 * Retention is applied on startup and every record/inspection (also report creation).
 * now/io/platform/arch/versions are trusted main-process test seams, never renderer input.
 */
function createDiagnosticsService({ file, version, now = Date.now, io = fs, platform = process.platform, arch = process.arch, versions = process.versions }) {
  const environment = Object.freeze({
    appVersion: safeVersion(version),
    osFamily: platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : 'unknown',
    arch: ['x64', 'arm64', 'ia32', 'arm', 'riscv64'].includes(arch) ? arch : 'unknown',
    electronVersion: safeVersion(versions?.electron),
    chromeVersion: safeVersion(versions?.chrome),
    nodeVersion: safeVersion(versions?.node),
  });
  let consent = null, events = [], queue = null, dirty = false, pendingRecords = 0, storageError = null;
  let loaded = false, loadPromise = null;
  const getState = () => ({ loaded, consent, enabled: loaded && consent === true, eventCount: events.length, pendingRecords, storageError, limits: { ...LIMITS } });
  async function failStorage() {
    // Fail closed; never echo filesystem exceptions or their personal paths.
    consent = false; events = []; dirty = false; storageError = 'diagnostics_storage';
    try { await io.rm(file, { force: true }); } catch { /* The fixed failure means disk cleanup is not guaranteed. */ }
    // Requests sharing this failed flush must not leave a successful-looking opt-in.
    consent = false; events = []; dirty = false;
    throw Object.assign(new Error('Diagnostics storage failed.'), { code: 'DIAGNOSTICS_STORAGE' });
  }
  function prune() {
    const clock = now(), before = events.length;
    events = events.filter(event => Number.isSafeInteger(event.at) && event.at <= clock && event.at > clock - MAX_AGE_MS).slice(-MAX_EVENTS);
    return before !== events.length;
  }
  async function persist() {
    prune();
    const bytes = JSON.stringify({ schema: 1, consent, events });
    if (Buffer.byteLength(bytes, 'utf8') > MAX_BYTES) throw new Error('Diagnostics storage failed.');
    await io.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle, owned = false;
    try {
      handle = await io.open(temporary, 'wx', 0o600); owned = true;
      await handle.writeFile(bytes, 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      await io.rename(temporary, file); owned = false;
    } finally {
      try { if (handle) await handle.close(); }
      finally { if (owned) await io.rm(temporary, { force: true }); }
    }
    return true;
  }
  function enqueue() {
    dirty = true;
    if (!queue) {
      // A single shared flush promise, not an unbounded chain of event closures.
      queue = Promise.resolve().then(async () => {
        while (dirty) {
          dirty = false;
          pendingRecords = 0;
          await persist();
        }
        storageError = null;
        return true;
      }).catch(failStorage).finally(() => {
        queue = null;
        // An event can arrive after the final while-check but before this microtask.
        if (dirty) return enqueue();
        pendingRecords = 0;
      });
    }
    return queue;
  }
  async function readState() {
      let handle, raw, repair = false;
      try {
        handle = await io.open(file, 'r');
        if ((await handle.stat()).size > MAX_BYTES) {
          repair = true;
        } else {
          // Bounded even if another process grows the file after stat().
          const buffer = Buffer.alloc(MAX_BYTES + 1);
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
          }
          if (length > MAX_BYTES) repair = true;
          else raw = buffer.subarray(0, length).toString('utf8');
        }
      } catch (error) {
        if (error.code === 'ENOENT') return getState();
        throw new Error('Diagnostics storage failed.');
      } finally { if (handle) await handle.close(); }
      consent = null; events = [];
      try {
        if (repair) throw new Error();
        const state = JSON.parse(raw);
        if (!state || state.schema !== 1 || ![true, false, null].includes(state.consent) || !Array.isArray(state.events)) throw new Error();
        consent = state.consent;
        if (consent === true) {
          events = state.events.map(event => sanitizeEvent(event, event && own(event, 'at'))).filter(Boolean);
          events.sort((a, b) => a.at - b.at);
          prune();
        }
        repair = raw !== JSON.stringify({ schema: 1, consent, events });
      } catch { consent = null; events = []; repair = true; }
      if (repair) await enqueue();
      return getState();
  }
  async function inspect() {
    await queue;
    if (prune()) await enqueue();
    return { schema: 1, ...getState(), environment: { ...environment }, events: structuredClone(events) };
  }
  return {
    load() {
      if (!loadPromise) {
        loadPromise = readState().catch(failStorage).then(() => { loaded = true; return getState(); }, error => { loaded = true; throw error; });
      }
      return loadPromise;
    },
    getState,
    getConsent() { return consent; },
    async setConsent(value) {
      if (!loaded) throw new Error('Diagnostics not loaded.');
      if (typeof value !== 'boolean') throw new Error('Invalid consent.');
      consent = value;
      if (!value) events = [];
      return enqueue();
    },
    async record(event) {
      if (!loaded || consent !== true || pendingRecords >= MAX_EVENTS) return false;
      const sanitized = sanitizeEvent(event, now());
      if (!sanitized) return false;
      pendingRecords++;
      events.push(sanitized);
      prune();
      return enqueue();
    },
    async clear() {
      if (!loaded) throw new Error('Diagnostics not loaded.');
      events = []; return enqueue();
    },
    inspect,
    async buildReport() { return JSON.stringify(await inspect(), null, 2); },
  };
}

module.exports = { createDiagnosticsService, EVENT_SCHEMA, OUTCOMES, ERROR_CATEGORIES, LIMITS };
