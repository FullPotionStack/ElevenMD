'use strict';
const path = require('node:path');
const { createSecurityPolicy, isTrustedSender } = require('./security.cjs');
const { createDocumentService } = require('./files.cjs');
const { createSessionService } = require('./session.cjs');
const { createImageService } = require('./images.cjs');
const { setupSupport } = require('./support.cjs');
async function startDesktop(electron, options = {}) {
  const { app, BrowserWindow, Menu, session, nativeTheme } = electron;
  const env = options.env || process.env;
  if (env.NOTEPAD_USER_DATA_DIR) app.setPath('userData', path.resolve(env.NOTEPAD_USER_DATA_DIR));
  const policy = createSecurityPolicy(path.join(__dirname, '..', 'dist'), app.isPackaged ? undefined : env.NOTEPAD_DEV_URL);
  if (!app.requestSingleInstanceLock()) { app.quit(); return null; }
  let deliverLaunch;
  const pendingLaunches = [];
  app.on('second-instance', (...args) => {
    if (deliverLaunch) return deliverLaunch(...args);
    pendingLaunches.push(args);
  });
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  Menu.setApplicationMenu(null);
  const isolatedSession = session.fromPartition('persist:notepad-md-11');
  isolatedSession.setSpellCheckerEnabled?.(false);
  let remoteImages = false;
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setDevicePermissionHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const externalImage = remoteImages && details.resourceType === 'image' && /^https:\/\//i.test(details.url);
    callback({ cancel: !policy.allowRequest(details.url) && !externalImage });
  });
  isolatedSession.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'content-security-policy') delete headers[name];
    headers['Content-Security-Policy'] = [policy.csp];
    callback({ responseHeaders: headers });
  });
  const window = new BrowserWindow({
    title: 'ElevenMD', icon: path.join(__dirname, '..', 'dist', 'elevenmd.ico'), width: 1100, height: 760, minWidth: 640, minHeight: 440,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: { height: 46, color: '#211f29', symbolColor: '#fff7ed' } } : {}),
    show: false, backgroundColor: '#fffaf2',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webviewTag: false, webSecurity: true, spellcheck: true,
      allowRunningInsecureContent: false, partition: 'persist:notepad-md-11' },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate', 'will-attach-webview']) {
    window.webContents.on(name, event => event.preventDefault());
  }
  const files = createDocumentService();
  const images = createImageService({ getDocument: id => files.getDocument(id) });
  const userData = app.getPath('userData');
  const sessions = createSessionService({ file: path.join(userData, 'session.json'), files });
  const restoredSession = await sessions.load();
  let dirty = false;
  const filters = [{ name: 'Markdown and text', extensions: ['md', 'markdown', 'txt'] }];
  const { ipcMain, dialog } = electron;
  const handle = (name, callback) => ipcMain.handle(`notepad:${name}`, async (event, ...args) => {
    if (!isTrustedSender(event, window, policy)) throw new Error('Unauthorized IPC sender.');
    return callback(...args);
  });
  let pendingCheckpoint;
  handle('checkpoint-update', async payload => {
    if (!pendingCheckpoint || !payload || payload.token !== pendingCheckpoint.token) throw new Error('Invalid checkpoint.');
    const pending = pendingCheckpoint;
    await sessions.save(payload.snapshot);
    if (pendingCheckpoint === pending) { clearTimeout(pending.timer); pendingCheckpoint = null; pending.resolve(); }
    return true;
  });
  const checkpoint = () => new Promise((resolve, reject) => {
    const token = require('node:crypto').randomUUID();
    const timer = setTimeout(() => { pendingCheckpoint = null; reject(new Error('Checkpoint timed out.')); }, 10000);
    pendingCheckpoint = { token, timer, resolve };
    window.webContents.send('notepad:action', { type: 'checkpoint-update', token });
  });
  const support = await setupSupport({ electron, window, handle, userData, checkpoint, version: app.getVersion?.() || require('../package.json').version });
  const track = async (type, operation) => {
    try {
      const value = await operation();
      await support.record({ type, outcome: value === null || (Array.isArray(value) && !value.length) ? 'cancelled' : 'success' });
      return value;
    } catch (error) { await support.record({ type, outcome: 'failure' }); throw error; }
  };
  let initialFiles = [];
  let initialConsumed = false;
  async function openArguments(args, cwd = process.cwd()) {
    const opened = [];
    for (const arg of args) {
      if (typeof arg !== 'string' || arg.startsWith('-') || !/\.(md|markdown|txt)$/i.test(arg)) continue;
      try {
        const doc = await track('document_open', () => files.openPath(path.resolve(cwd, arg)));
        if (!opened.some(item => item.id === doc.id)) opened.push(doc);
      } catch (error) { dialog.showErrorBox('Cannot open document', `${path.basename(arg)}\n\n${error.message}`); }
    }
    return opened;
  }
  const startupArgs = options.argv || process.argv.slice(process.defaultApp ? 2 : 1);
  const startup = openArguments(startupArgs);
  handle('initial-files', async () => {
    await startup;
    initialConsumed = true;
    const result = initialFiles;
    initialFiles = [];
    return result;
  });
  initialFiles.push(...await startup);
  deliverLaunch = async (_event, argv, workingDirectory) => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    const opened = await openArguments(argv.slice(app.isPackaged ? 1 : 2), workingDirectory);
    if (window.isDestroyed()) return;
    if (initialConsumed) {
      if (opened.length) window.webContents.send('notepad:action', { type: 'opened', files: opened });
    } else {
      for (const doc of opened) if (!initialFiles.some(item => item.id === doc.id)) initialFiles.push(doc);
    }
  };
  for (const launch of pendingLaunches.splice(0)) await deliverLaunch(...launch);
  handle('open', () => track('document_open', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open', properties: ['openFile', 'multiSelections'], filters });
    if (result.canceled) return [];
    const opened = [];
    for (const filename of result.filePaths) opened.push(await files.openPath(filename));
    return opened;
  }));
  handle('save', payload => track(payload?.saveAs ? 'document_save_as' : 'document_save', () => files.save(payload, async info => {
    const result = await dialog.showSaveDialog(window, { title: 'Save As', defaultPath: info.path || info.name,
      filters, properties: ['showOverwriteConfirmation', 'createDirectory'] });
    return result.canceled ? null : result.filePath;
  })));
  handle('open-link', async value => {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020]/.test(value)) throw new Error('Invalid link.');
    let url; try { url = new URL(value); } catch { throw new Error('Invalid link.'); }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported link.');
    const result = await dialog.showMessageBox(window, { type: 'question', title: 'Open link', message: 'Open this link outside ElevenMD?', detail: url.href, buttons: ['Open', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
    if (result.response === 0) await electron.shell.openExternal(url.href);
  });
  handle('resolve-image', payload => images.resolve(payload));
  handle('import-image', payload => images.importImage(payload, async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Insert image', properties: ['openFile'], filters: [{ name: 'Raster images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] }] });
    return result.canceled ? null : result.filePaths[0];
  }));
  handle('confirm-close', async name => {
    if (typeof name !== 'string' || name.length > 255 || /[\u0000-\u001f]/.test(name)) throw new Error('Invalid document name.');
    const result = await dialog.showMessageBox(window, { type: 'question', title: 'ElevenMD',
      message: `Do you want to save changes to ${name || 'Untitled'}?`,
      buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response] || 'cancel';
  });
  handle('set-dirty', value => {
    if (typeof value !== 'boolean') throw new Error('Dirty state must be a boolean.');
    dirty = value;
    window.setDocumentEdited(value);
  });
  handle('save-session', payload => sessions.save(payload));
  handle('restore-session', async () => {
    await support.record({ type: 'lifecycle', action: 'session_restore' });
    return { ...(restoredSession || { tabs: [], activeId: null, mode: 'formatted' }), storagePath: sessions.file };
  });
  handle('close-window', async () => { await support.record({ type: 'lifecycle', action: 'quit' }); dirty = false; window.destroy(); });
  let renderedTheme;
  const updateChrome = () => {
    const dark = renderedTheme ? renderedTheme === 'dark' : nativeTheme?.shouldUseDarkColors || false;
    if (process.platform !== 'darwin' && !window.isDestroyed()) window.setTitleBarOverlay?.({ height: 46, color: '#211f29', symbolColor: '#fff7ed' });
  };
  nativeTheme?.on('updated', updateChrome);
  updateChrome();
  handle('preferences', value => {
    if (!value || Object.keys(value).some(k => !['theme', 'effectiveTheme', 'spellcheck', 'remoteImages'].includes(k)) || !['system', 'light', 'dark'].includes(value.theme) || typeof value.spellcheck !== 'boolean' || typeof value.remoteImages !== 'boolean') throw new Error('Invalid preferences.');
    if (value.effectiveTheme !== undefined && !['light', 'dark'].includes(value.effectiveTheme)) throw new Error('Invalid effective theme.');
    renderedTheme = value.effectiveTheme;
    if (nativeTheme) nativeTheme.themeSource = value.theme;
    isolatedSession.setSpellCheckerEnabled?.(value.spellcheck);
    if (value.spellcheck) isolatedSession.setSpellCheckerLanguages?.(['en-US', 'pt-BR']);
    remoteImages = value.remoteImages;
    updateChrome();
  });
  window.on('close', event => {
    event.preventDefault(); window.webContents.send('notepad:action', 'close-window');
  });
  window.once('ready-to-show', () => window.show());
  if (policy.development) await window.loadURL(policy.entryURL);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return { window, policy };
}
module.exports = { startDesktop };
// Electron's main-entry loader does not guarantee require.main === module.
// Keep plain-Node imports side-effect free for unit tests, but bootstrap the real browser process.
if (process.versions.electron && process.type === 'browser') {
  const electron = require('electron');
  startDesktop(electron).catch(error => { electron.dialog.showErrorBox('Cannot start ElevenMD', error.message); electron.app.quit(); });
}
