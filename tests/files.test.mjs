import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Some runners reset TMPDIR to Windows Temp. Keep fixtures in Hermes scratch regardless.
const scratch = process.env.HERMES_TEST_SCRATCH || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch')
  : process.env.TMPDIR);
assert.ok(scratch, 'A test scratch directory is required');
async function fixture(t) {
  await fs.mkdir(scratch, { recursive: true });
  const dir = await fs.mkdtemp(path.join(scratch, 'notepad-files-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function service(options) {
  let module;
  try { module = require('../electron/files.cjs'); } catch (error) {
    assert.fail(`Document file service is not implemented: ${error.message}`);
  }
  return module.createDocumentService(options);
}
test('internal document lookup returns copies only for registered file capabilities', async t => {
  const dir = await fixture(t), filename = path.join(dir, 'lookup.md');
  await fs.writeFile(filename, '# Registered');
  const service = require('../electron/files.cjs').createDocumentService();
  const opened = await service.openPath(filename);
  assert.equal(service.getDocument(randomUUID()), null);
  const metadata = service.getDocument(opened.id);
  assert.equal(metadata.path, opened.path);
  metadata.path = 'renderer-mutation';
  assert.equal(service.getDocument(opened.id).path, opened.path);
});
test('opens UTF-8 BOM and CRLF with an opaque capability and normalized editor text', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'notes.md');
  await fs.writeFile(target, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Notes\r\nOlá\r\n')]));
  const files = service();
  const doc = await files.openPath(target);
  assert.match(doc.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(doc.id, target);
  assert.equal(doc.name, 'notes.md');
  assert.equal(doc.path, await fs.realpath(target));
  assert.equal(doc.content, '# Notes\nOlá\n');
  assert.equal(doc.eol, 'CRLF');
  assert.equal(doc.bom, true);
  assert.deepEqual(await files.openPath(target), doc);
});
test('saves an opened capability atomically preserving its BOM and CRLF', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'existing.md');
  await fs.writeFile(target, '\ufeffold\r\n');
  const files = service();
  const doc = await files.openPath(target);
  const saved = await files.save({ id: doc.id, content: 'new\nline\n', saveAs: false }, () => assert.fail('Must not ask for a path'));
  assert.equal(saved.id, doc.id);
  assert.equal(saved.content, 'new\nline\n');
  assert.deepEqual(await fs.readFile(target), Buffer.from('\ufeffnew\r\nline\r\n'));
  assert.deepEqual(await fs.readdir(dir), ['existing.md']);
  const again = await files.save({ id: doc.id, content: 'again\n', saveAs: false });
  assert.equal(again.bom, true);
  assert.equal(again.eol, 'CRLF');
});
test('unregistered tab ids and Save As require a trusted path picker; cancellation writes nothing', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'new.md');
  const files = service();
  const id = randomUUID();
  let picked = 0;
  const result = await files.save({ id, content: 'hello\r\n', saveAs: false, name: 'new.md' }, async info => {
    assert.equal(info.name, 'new.md');
    picked++;
    return target;
  });
  assert.equal(picked, 1);
  assert.equal(result.id, id);
  assert.equal(result.eol, 'LF');
  assert.equal(result.bom, false);
  assert.equal(await fs.readFile(target, 'utf8'), 'hello\n');
  assert.equal(await files.save({ id, content: 'discarded', saveAs: true }, async () => null), null);
  assert.equal(await fs.readFile(target, 'utf8'), 'hello\n');
  const other = path.join(dir, 'copy.md');
  const copy = await files.save({ id, content: 'copy', saveAs: true }, async () => other);
  assert.equal(copy.path, other);
  assert.equal(await fs.readFile(target, 'utf8'), 'hello\n');
  assert.equal(await fs.readFile(other, 'utf8'), 'copy');
});
test('renderer paths, malformed payloads, binary text, and oversized saves are rejected before dialogs', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'private.md');
  await fs.writeFile(target, 'original');
  const files = service();
  const doc = await files.openPath(target);
  const base = { id: doc.id, content: 'changed', saveAs: false };
  for (const payload of [
    { ...base, path: target }, { ...base, bom: true }, { ...base, id: target },
    { ...base, content: 42 }, { ...base, content: '\u0000' },
    { ...base, content: 'a'.repeat(10 * 1024 * 1024 + 1) },
    { ...base, saveAs: 'false' }, { ...base, name: '../outside.md' }, null,
  ]) {
    await assert.rejects(files.save(payload, () => assert.fail('Invalid data must not open a dialog')), /invalid|limit|binary/i);
  }
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
});
test('refuses to overwrite changed or deleted originals and retains capability state', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'conflict.md');
  await fs.writeFile(target, 'original');
  const files = service();
  const doc = await files.openPath(target);
  await fs.writeFile(target, 'external editor');
  await assert.rejects(files.save({ id: doc.id, content: 'ours', saveAs: false }), /changed on disk/i);
  assert.equal(await fs.readFile(target, 'utf8'), 'external editor');
  await fs.rm(target);
  await assert.rejects(files.save({ id: doc.id, content: 'ours', saveAs: false }), /changed on disk/i);
  assert.deepEqual(await fs.readdir(dir), []);
  await fs.writeFile(target, 'original');
  await files.save({ id: doc.id, content: 'now safe', saveAs: false });
  assert.equal(await fs.readFile(target, 'utf8'), 'now safe');
});
test('failed atomic rename retains original and removes only its own temporary file', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'safe.md');
  const unrelated = path.join(dir, '.notepad-md-unrelated.tmp');
  await fs.writeFile(target, 'original');
  await fs.writeFile(unrelated, 'leave alone');
  let attempted = false;
  const files = service({ fs: { ...fs, async rename(from, to) {
    attempted = true;
    assert.equal(path.dirname(from), dir);
    assert.equal(to, target);
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    assert.equal(await fs.readFile(from, 'utf8'), 'replacement');
    throw Object.assign(new Error('Simulated locked destination'), { code: 'EPERM' });
  } } });
  const doc = await files.openPath(target);
  await assert.rejects(files.save({ id: doc.id, content: 'replacement', saveAs: false }), /locked destination/);
  assert.equal(attempted, true, 'failure injection actually ran');
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'leave alone');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['.notepad-md-unrelated.tmp', 'safe.md']);
});
test('rechecks the disk hash after flushing the temp file, before overwrite', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'late-conflict.md');
  await fs.writeFile(target, 'original');
  let changed = false;
  const files = service({ fs: { ...fs, async open(filename, ...args) {
    const handle = await fs.open(filename, ...args);
    if (String(filename).endsWith('.tmp')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); await fs.writeFile(target, 'late external change'); changed = true; };
    }
    return handle;
  } } });
  const doc = await files.openPath(target);
  await assert.rejects(files.save({ id: doc.id, content: 'ours', saveAs: false }), /changed on disk/i);
  assert.equal(changed, true);
  assert.equal(await fs.readFile(target, 'utf8'), 'late external change');
  assert.deepEqual(await fs.readdir(dir), ['late-conflict.md']);
});
test('security policies reject remote dev servers, other local files, and non-main-frame IPC', () => {
  let security;
  try { security = require('../electron/security.cjs'); } catch (error) { assert.fail(`Shell security is not implemented: ${error.message}`); }
  const root = path.resolve('dist');
  const { pathToFileURL } = require('node:url');
  const production = security.createSecurityPolicy(root, undefined);
  assert.equal(production.allowRequest(pathToFileURL(path.join(root, 'assets', 'app.js')).href), true);
  assert.equal(production.allowRequest(pathToFileURL(path.resolve('package.json')).href), false);
  assert.equal(production.allowRequest('https://example.com/pixel'), false);
  assert.equal(production.allowRequest('file://server/share/file.md'), false);
  for (const bad of ['https://example.com', 'http://localhost.evil', 'file:///a', 'http://user@127.0.0.1:5173', 'http://127.1:5173', 'http://2130706433:5173']) {
    assert.throws(() => security.createSecurityPolicy(root, bad), /loopback/i);
  }
  const dev = security.createSecurityPolicy(root, 'http://127.0.0.1:5173/');
  assert.equal(dev.allowRequest('http://127.0.0.1:5173/src/main.js'), true);
  assert.equal(dev.allowRequest('ws://127.0.0.1:5173/'), true);
  assert.equal(dev.allowRequest('http://localhost:5173/'), false);
  const frame = { url: production.entryURL };
  const win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  assert.equal(security.isTrustedSender({ sender: win.webContents, senderFrame: frame }, win, production), true);
  assert.equal(security.isTrustedSender({ sender: {}, senderFrame: frame }, win, production), false);
  assert.equal(security.isTrustedSender({ sender: win.webContents, senderFrame: { url: frame.url } }, win, production), false);
  frame.url = 'https://example.com';
  assert.equal(security.isTrustedSender({ sender: win.webContents, senderFrame: frame }, win, production), false);
});
function fakeElectron() {
  const { EventEmitter } = require('node:events');
  const { pathToFileURL } = require('node:url');
  const handlers = new Map();
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getAppPath = () => path.resolve('.');
  app.getPath = () => path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch', `notepad-fake-${randomUUID()}`);
  app.quit = () => { app.quitting = true; };
  const session = {
    webRequest: { onBeforeRequest(_filter, cb) { session.request = cb; }, onHeadersReceived(_filter, cb) { session.headers = cb; } },
    setPermissionRequestHandler(cb) { session.permission = cb; },
    setPermissionCheckHandler(cb) { session.checkPermission = cb; },
    setDevicePermissionHandler(cb) { session.devicePermission = cb; },
  };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.session = session;
      this.webContents.mainFrame = { url: '' };
      this.webContents.setWindowOpenHandler = cb => { this.popup = cb; };
      this.webContents.send = (...args) => { (this.messages ||= []).push(args); };
      BrowserWindow.last = this;
    }
    async loadFile(filename) { this.loadedFile = filename; this.webContents.mainFrame.url = pathToFileURL(filename).href; }
    async loadURL(url) { this.loadedURL = url; this.webContents.mainFrame.url = url; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    isMinimized() { return false; }
    restore() {}
    setDocumentEdited(value) { this.edited = value; }
  }
  const dialog = {
    errors: [], messages: [],
    showErrorBox(...args) { this.errors.push(args); },
    async showOpenDialog() { return this.openResult || { canceled: true, filePaths: [] }; },
    async showSaveDialog(_window, options) { this.saveOptions = options; return this.saveResult || { canceled: true }; },
    async showMessageBox(_window, options) { this.messages.push(options); return { response: this.response ?? 2 }; },
  };
  const electron = { app, BrowserWindow, dialog, session: { fromPartition: () => session },
    Menu: { setApplicationMenu(value) { electron.menu = value; } },
    ipcMain: { handle(channel, cb) { handlers.set(channel, cb); } } };
  return { electron, handlers, session, dialog, invoke(name, value) {
    const win = BrowserWindow.last;
    const cb = handlers.get(`notepad:${name}`);
    assert.ok(cb, `IPC ${name} registered`);
    return cb({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, value);
  } };
}
test('external links require explicit approval and reject executable URL schemes', async () => {
  const fake = fakeElectron(); let opened;
  fake.electron.shell = { openExternal: async url => { opened = url; } };
  await require('../electron/main.cjs').startDesktop(fake.electron, { argv: [], env: {} });
  for (const url of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-settings:', 'https://user:password@example.com']) await assert.rejects(fake.invoke('open-link', url), /invalid|unsupported/i);
  await fake.invoke('open-link', 'https://example.com'); assert.equal(opened, undefined);
  fake.dialog.response = 0;
  await fake.invoke('open-link', 'https://example.com'); assert.equal(opened, 'https://example.com/');
});
test('caption colors follow the rendered system theme rather than an overridden native theme', async () => {
  const fake = fakeElectron(), { EventEmitter } = require('node:events');
  fake.electron.nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: true });
  fake.electron.BrowserWindow.prototype.setTitleBarOverlay = function(value) { this.overlay = value; };
  await require('../electron/main.cjs').startDesktop(fake.electron, { argv: [], env: {} });
  await fake.invoke('preferences', { theme: 'system', effectiveTheme: 'light', spellcheck: false, remoteImages: false });
  assert.equal(fake.electron.BrowserWindow.last.overlay.color, '#211f29');
});
test('desktop shell uses native chrome and blocks navigation, windows, network, permissions, and webviews', async () => {
  let main;
  try { main = require('../electron/main.cjs'); } catch (error) { assert.fail(`Desktop shell is not implemented: ${error.message}`); }
  const fake = fakeElectron();
  await main.startDesktop(fake.electron, { argv: [], env: {} });
  const win = fake.electron.BrowserWindow.last;
  assert.equal(win.options.title, 'ElevenMD');
  assert.equal(win.options.titleBarStyle, 'hidden');
  assert.equal(win.options.titleBarOverlay.height, 46);
  assert.match(win.options.icon, /dist[\\/]elevenmd\.ico$/);
  assert.equal(win.options.backgroundColor, '#fffaf2');
  assert.equal(win.options.webPreferences.spellcheck, true);
  assert.equal(win.options.width, 1100);
  assert.equal(win.options.height, 760);
  assert.equal(win.options.minWidth, 640);
  assert.equal(win.options.minHeight, 440);
  assert.notEqual(win.options.frame, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.webviewTag, false);
  assert.equal(fake.electron.menu, null);
  assert.equal(win.loadedFile, path.resolve('dist/index.html'));
  assert.deepEqual(win.popup({ url: 'https://example.com' }), { action: 'deny' });
  for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    win.webContents.emit(name, { preventDefault() { prevented = true; } }, 'https://example.com');
    assert.equal(prevented, true, `${name} blocked`);
  }
  let request;
  fake.session.request({ url: 'https://example.com' }, value => { request = value; });
  assert.deepEqual(request, { cancel: true });
  let permission;
  fake.session.permission(win.webContents, 'camera', value => { permission = value; });
  assert.equal(permission, false);
  assert.equal(fake.session.checkPermission(), false);
  assert.equal(fake.session.devicePermission(), false);
});
test('native open/save IPC is capability-scoped and dirty close waits for renderer acknowledgement', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'dialog.md');
  await fs.writeFile(target, 'hello');
  const fake = fakeElectron();
  await require('../electron/main.cjs').startDesktop(fake.electron, { argv: [], env: {} });
  const win = fake.electron.BrowserWindow.last;
  assert.deepEqual(await fake.invoke('open'), []);
  fake.dialog.openResult = { canceled: false, filePaths: [target] };
  const [doc] = await fake.invoke('open');
  assert.equal(doc.content, 'hello');
  const saved = await fake.invoke('save', { id: doc.id, content: 'changed', saveAs: false });
  assert.equal(saved.path, target);
  assert.equal(await fs.readFile(target, 'utf8'), 'changed');
  for (const [channel, handler] of fake.handlers) {
    await assert.rejects(handler({ sender: {}, senderFrame: win.webContents.mainFrame }), /unauthorized/i, channel);
    await assert.rejects(handler({ sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } }), /unauthorized/i, channel);
  }
  for (const [response, expected] of [[0, 'save'], [1, 'discard'], [2, 'cancel']]) {
    fake.dialog.response = response;
    assert.equal(await fake.invoke('confirm-close', 'dialog.md'), expected);
  }
  const confirmation = fake.dialog.messages.at(-1);
  assert.deepEqual(confirmation.buttons, ['Save', "Don't Save", 'Cancel']);
  assert.equal(confirmation.cancelId, 2);
  await assert.rejects(fake.invoke('set-dirty', 'true'), /boolean|invalid/i);
  await fake.invoke('set-dirty', true);
  let prevented = false;
  win.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(win.isDestroyed(), false);
  assert.deepEqual(win.messages.at(-1), ['notepad:action', 'close-window']);
  await fake.invoke('close-window');
  assert.equal(win.isDestroyed(), true);
});
test('support IPC requires consent, exports exact safe logs and opens only a reviewed project issue draft', async t => {
  const dir = await fixture(t), fake = fakeElectron();
  fake.electron.app.getPath = () => dir;
  fake.electron.app.getVersion = () => '0.3.0';
  const external = [];
  fake.electron.shell = { openExternal: async url => external.push(url) };
  await require('../electron/main.cjs').startDesktop(fake.electron, { argv: [], env: {} });
  assert.equal((await fake.invoke('diagnostics-state')).consent, null);
  await fake.invoke('record-diagnostic', { type: 'formatting', action: 'bold', outcome: 'success', text: 'PRIVATE' });
  assert.equal((await fake.invoke('diagnostics-inspect')).events.length, 0);
  assert.equal((await fake.invoke('diagnostics-consent', true)).consent, true);
  await fake.invoke('record-diagnostic', { type: 'formatting', action: 'bold', outcome: 'success', text: 'PRIVATE', path: 'C:/private' });
  const report = await fake.invoke('diagnostics-inspect');
  assert.equal(report.events.at(-1).action, 'bold');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  fake.dialog.saveResult = { canceled: false, filePath: path.join(dir, 'export.json') };
  assert.equal(await fake.invoke('diagnostics-export'), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'export.json'), 'utf8')).events.length, 1);
  const draft = await fake.invoke('prepare-bug-report', { title: 'Format defect', body: 'Steps: make bold', includeDiagnostics: true });
  assert.match(draft.body, /bold/);
  assert.equal(await fake.invoke('report-bug', { ...draft, body: draft.body + '\nUNREVIEWED' }), false);
  fake.dialog.response = 0;
  assert.equal(await fake.invoke('report-bug', draft), true);
  assert.equal(new URL(external.at(-1)).pathname, '/FullPotionStack/ElevenMD/issues/new');
  assert.equal(new URL(external.at(-1)).searchParams.get('body'), draft.body);
  await assert.rejects(fake.invoke('updates-check', 'https://attacker.test'), /argument|invalid/i);
  await fake.invoke('diagnostics-consent', false);
  assert.equal((await fake.invoke('diagnostics-inspect')).events.length, 0);
  for (const [name, handler] of fake.handlers) await assert.rejects(handler({ sender: {}, senderFrame: {} }), /unauthorized/i, name);
});

test('sandboxed preload exposes only fixed document APIs and strips Electron events from callbacks', async () => {
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  let source;
  try { source = await fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'); }
  catch (error) { assert.fail(`Preload bridge is not implemented: ${error.message}`); }
  const ipc = new EventEmitter();
  const calls = [];
  ipc.invoke = async (...args) => { calls.push(args); return 'result'; };
  let api;
  const electron = { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'notepad'); api = value; } } };
  vm.runInNewContext(source, { require(name) { assert.equal(name, 'electron'); return electron; } });
  assert.deepEqual(Object.keys(api).sort(), ['closeWindow', 'confirmClose', 'initialFiles', 'importImage', 'onAction', 'resolveImage', 'open', 'openLink', 'preferences', 'restoreSession', 'save', 'saveSession', 'setDirty', 'updatesState', 'checkUpdates', 'downloadUpdate', 'installUpdate', 'checkpointUpdate', 'openRelease', 'diagnosticsState', 'diagnosticsConsent', 'diagnosticsInspect', 'diagnosticsClear', 'diagnosticsExport', 'recordDiagnostic', 'prepareBugReport', 'reportBug'].sort());
  for (const [method, channel, args] of [
    ['open', 'open', []], ['initialFiles', 'initial-files', []],
    ['updatesState', 'updates-state', []], ['checkUpdates', 'updates-check', []], ['downloadUpdate', 'updates-download', []], ['installUpdate', 'updates-install', []], ['openRelease', 'open-release', []],
    ['diagnosticsState', 'diagnostics-state', []], ['diagnosticsConsent', 'diagnostics-consent', [false]], ['diagnosticsInspect', 'diagnostics-inspect', []], ['diagnosticsClear', 'diagnostics-clear', []], ['diagnosticsExport', 'diagnostics-export', []],
    ['recordDiagnostic', 'record-diagnostic', [{ type: 'mode_changed', mode: 'source' }]], ['checkpointUpdate', 'checkpoint-update', [{ token: 'test', snapshot: {} }]], ['prepareBugReport', 'prepare-bug-report', [{ title: 'Test', body: 'Steps', includeDiagnostics: false }]], ['reportBug', 'report-bug', [{ title: 'Test', body: 'Steps', includeDiagnostics: false }]],
    ['openLink', 'open-link', ['https://example.com']],
    ['resolveImage', 'resolve-image', [{ id: randomUUID(), source: 'assets/photo.png' }]], ['importImage', 'import-image', [{ id: randomUUID() }]],
    ['restoreSession', 'restore-session', []], ['saveSession', 'save-session', [{ tabs: [], activeId: null, mode: 'source' }]],
    ['preferences', 'preferences', [{ theme: 'dark', spellcheck: false, remoteImages: false }]],
    ['save', 'save', [{ id: randomUUID(), content: 'text', saveAs: false }]],
    ['confirmClose', 'confirm-close', ['Untitled']], ['setDirty', 'set-dirty', [true]], ['closeWindow', 'close-window', []],
  ]) {
    assert.equal(await api[method](...args), 'result');
    assert.deepEqual(calls.at(-1), [`notepad:${channel}`, ...args]);
  }
  let received;
  let count = 0;
  const unsubscribe = api.onAction((...args) => { received = args; count++; });
  ipc.emit('notepad:action', { sender: 'secret ipc' }, 'close-window');
  assert.deepEqual(received, ['close-window']);
  unsubscribe(); unsubscribe();
  ipc.emit('notepad:action', {}, 'close-window');
  assert.equal(count, 1);
  assert.throws(() => api.onAction('invalid'), /callback/i);
});
test('CLI startup files are delivered once; second-instance launch forwards opened capabilities', async t => {
  const dir = await fixture(t);
  const first = path.join(dir, 'first.MARKDOWN');
  const second = path.join(dir, 'second.txt');
  await fs.writeFile(first, 'first');
  await fs.writeFile(second, 'second');
  const fake = fakeElectron();
  await require('../electron/main.cjs').startDesktop(fake.electron, { argv: [first, path.join(dir, 'missing.md'), '--flag', path.join(dir, 'ignored.exe')], env: {} });
  const initial = await fake.invoke('initial-files');
  assert.equal(initial.length, 1);
  assert.equal(initial[0].content, 'first');
  assert.deepEqual(await fake.invoke('initial-files'), []);
  assert.equal(fake.dialog.errors.length, 1);
  const launch = fake.electron.app.listeners('second-instance')[0];
  assert.equal(typeof launch, 'function');
  await launch({}, ['electron', 'project', 'second.txt'], dir);
  const win = fake.electron.BrowserWindow.last;
  assert.equal(win.focused, true);
  assert.equal(win.messages.at(-1)[0], 'notepad:action');
  assert.equal(win.messages.at(-1)[1].type, 'opened');
  assert.equal(win.messages.at(-1)[1].files[0].content, 'second');
  assert.match(win.messages.at(-1)[1].files[0].id, /^[0-9a-f-]{36}$/i);
  let prevented = false;
  win.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'clean windows checkpoint their open tabs before closing');
  assert.equal(win.messages.at(-1)[1], 'close-window');
  fake.electron.app.emit('window-all-closed');
  assert.equal(fake.electron.app.quitting, true);
});
test('Save As to an existing file preserves target encoding and rejects stale registered targets', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'overwrite.md');
  await fs.writeFile(target, '\ufeffold\r\n');
  const files = service();
  const id = randomUUID();
  const saved = await files.save({ id, content: 'new\n', saveAs: false }, async () => target);
  assert.equal(saved.bom, true);
  assert.equal(saved.eol, 'CRLF');
  assert.equal(await fs.readFile(target, 'utf8'), '\ufeffnew\r\n');
  await fs.writeFile(target, 'external');
  await assert.rejects(files.save({ id: randomUUID(), content: 'another tab', saveAs: true }, async () => target), /changed on disk|already open/i);
  assert.equal(await fs.readFile(target, 'utf8'), 'external');
});
test('temporary-file creation failure never deletes a file it did not create', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'collision.md');
  await fs.writeFile(target, 'original');
  let collisionPath;
  const files = service({ fs: { ...fs, async open(filename, ...args) {
    if (args[0] === 'wx') {
      collisionPath = filename;
      await fs.writeFile(filename, 'someone else owns this');
      throw Object.assign(new Error('Temporary name collision'), { code: 'EEXIST' });
    }
    return fs.open(filename, ...args);
  } } });
  const doc = await files.openPath(target);
  await assert.rejects(files.save({ id: doc.id, content: 'replacement', saveAs: false }), /collision/);
  assert.ok(collisionPath);
  assert.equal(await fs.readFile(collisionPath, 'utf8'), 'someone else owns this');
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
});
test('the 10 MiB save limit includes CRLF expansion and UTF-8 BOM bytes', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'encoded.md');
  await fs.writeFile(target, '\ufefforiginal\r\n');
  const files = service();
  const doc = await files.openPath(target);
  const text = '\n'.repeat(6 * 1024 * 1024);
  assert.ok(Buffer.byteLength(text) < 10 * 1024 * 1024);
  assert.ok(Buffer.byteLength('\ufeff' + text.replace(/\n/g, '\r\n')) > 10 * 1024 * 1024);
  await assert.rejects(files.save({ id: doc.id, content: text, saveAs: false }), /10 MiB/i);
  assert.equal(await fs.readFile(target, 'utf8'), '\ufefforiginal\r\n');
  assert.deepEqual(await fs.readdir(dir), ['encoded.md']);
});
test('concurrent saves are serialized and subsequent edits use the new disk hash', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'concurrent.md');
  await fs.writeFile(target, 'original');
  let active = 0;
  let attempts = 0;
  const files = service({ fs: { ...fs, async rename(from, to) {
    active++; attempts++;
    assert.equal(active, 1, 'atomic replacements must not overlap');
    await new Promise(resolve => setTimeout(resolve, 30));
    await fs.rename(from, to);
    active--;
  } } });
  const doc = await files.openPath(target);
  const results = await Promise.all([
    files.save({ id: doc.id, content: 'first', saveAs: false }),
    files.save({ id: doc.id, content: 'second', saveAs: false }),
  ]);
  assert.equal(attempts, 2);
  assert.deepEqual(results.map(item => item.content), ['first', 'second']);
  assert.equal(await fs.readFile(target, 'utf8'), 'second');
  const third = await files.save({ id: doc.id, content: 'third', saveAs: false });
  assert.equal(third.content, 'third');
});
test('reads remain bounded if a file grows after the size check', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'growing.md');
  await fs.writeFile(target, 'small');
  let reads = 0;
  let totalBytes = 0;
  const files = service({ fs: { ...fs, async open(filename, ...args) {
    const handle = await fs.open(filename, ...args);
    if (filename === target && args[0] === 'r') {
      const stat = handle.stat.bind(handle);
      handle.stat = async () => {
        const result = await stat();
        await fs.writeFile(target, Buffer.alloc(10 * 1024 * 1024 + 4096, 65));
        return result;
      };
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        reads++;
        const result = await read(...readArgs);
        totalBytes += result.bytesRead;
        assert.ok(totalBytes <= 10 * 1024 * 1024 + 1, 'bounded read never consumes the entire oversized file');
        return result;
      };
    }
    return handle;
  } } });
  await assert.rejects(files.openPath(target), /10 MiB/i);
  assert.ok(reads > 0, 'the growing-file read hook was exercised');
  assert.equal(totalBytes, 10 * 1024 * 1024 + 1);
});
test('write or close failures keep the original and still attempt scoped temporary cleanup', async t => {
  const dir = await fixture(t);
  for (const stage of ['write', 'close']) {
    const target = path.join(dir, `${stage}.md`);
    await fs.writeFile(target, 'original');
    let injected = false;
    const files = service({ fs: { ...fs, async open(filename, ...args) {
      const handle = await fs.open(filename, ...args);
      if (args[0] === 'wx') {
        if (stage === 'write') {
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async () => { await write('partial'); injected = true; throw new Error('Injected write failure'); };
        } else {
          const close = handle.close.bind(handle);
          handle.close = async () => { await close(); injected = true; throw new Error('Injected close failure'); };
        }
      }
      return handle;
    } } });
    const doc = await files.openPath(target);
    await assert.rejects(files.save({ id: doc.id, content: 'replacement', saveAs: false }), /Injected .* failure/);
    assert.equal(injected, true);
    assert.equal(await fs.readFile(target, 'utf8'), 'original');
    assert.equal((await fs.readdir(dir)).some(name => name.endsWith('.tmp')), false);
  }
});
test('preserves a literal leading U+FEFF in text separately from the UTF-8 encoding BOM', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'literal-bom.md');
  await fs.writeFile(target, '\ufeff\ufefftext\n');
  const files = service();
  const doc = await files.openPath(target);
  assert.equal(doc.bom, true);
  assert.equal(doc.content, '\ufefftext\n');
  await files.save({ id: doc.id, content: doc.content, saveAs: false });
  assert.equal(await fs.readFile(target, 'utf8'), '\ufeff\ufefftext\n');
});
test('reopening a changed file returns fresh content without refreshing an old tab capability', async t => {
  const dir = await fixture(t);
  const target = path.join(dir, 'reopen.md');
  await fs.writeFile(target, 'original');
  const files = service();
  const first = await files.openPath(target);
  await fs.writeFile(target, 'external edit');
  const reopened = await files.openPath(target);
  assert.equal(reopened.content, 'external edit');
  assert.notEqual(reopened.id, first.id);
  await assert.rejects(files.save({ id: first.id, content: 'stale editor text', saveAs: false }), /changed on disk|already open/i);
  await files.save({ id: reopened.id, content: 'fresh editor text', saveAs: false });
  assert.equal(await fs.readFile(target, 'utf8'), 'fresh editor text');
  await files.save({ id: first.id, content: 'recovered stale draft', saveAs: true }, async () => path.join(dir, 'recovery.md'));
  assert.equal((await files.openPath(target)).id, reopened.id, 'Save As of a stale tab must not revoke the fresh tab capability');
});
test('desktop harness can isolate userData before app readiness', async t => {
  const dir = await fixture(t);
  const fake = fakeElectron();
  let ready = false;
  let configured;
  fake.electron.app.setPath = (name, value) => {
    assert.equal(ready, false);
    assert.equal(name, 'userData');
    configured = value;
  };
  fake.electron.app.whenReady = async () => { ready = true; };
  await require('../electron/main.cjs').startDesktop(fake.electron, { argv: [], env: { NOTEPAD_USER_DATA_DIR: dir } });
  assert.equal(configured, path.resolve(dir));
});
test('refuses invalid UTF-8, binary NUL, directories, and files above 10 MiB', async t => {
  const dir = await fixture(t);
  const files = service();
  const cases = [
    ['invalid.md', Buffer.from([0xff, 0xfe, 0x00]), /UTF-8/i],
    ['binary.txt', Buffer.from('abc\u0000def'), /binary/i],
    ['large.md', Buffer.alloc(10 * 1024 * 1024 + 1, 65), /10 MiB/i],
  ];
  for (const [name, bytes, message] of cases) {
    const target = path.join(dir, name);
    await fs.writeFile(target, bytes);
    await assert.rejects(files.openPath(target), message);
  }
  await assert.rejects(files.openPath(dir), /regular file/i);
});
