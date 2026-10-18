'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createUpdateLauncher } = require('./update-launcher.cjs');
const { resolveUpdateTarget } = require('./update-target.cjs');
const { prepareHandoff } = require('./update-handoff.cjs');
const { createUpdateService } = require('./updates.cjs');
const { createDiagnosticsService } = require('./diagnostics.cjs');
const { repository: REPOSITORY } = require('./distribution.cjs');

async function setupSupport({ electron, window, handle, userData, version, checkpoint }) {
  const { app, dialog, shell } = electron;
  const diagnostics = createDiagnosticsService({ file: path.join(userData, 'diagnostics.json'), version });
  await diagnostics.load().catch(() => {}); // Storage failure disables collection, never app startup.
  const state = () => ({ ...diagnostics.getState(), count: diagnostics.getState().eventCount });
  let storageWarned = false;
  const record = event => diagnostics.record(event).catch(() => {
    if (!storageWarned && !window.isDestroyed()) { storageWarned = true; window.webContents.send('notepad:action', { type: 'diagnostics-error' }); }
    return false;
  });
  await record({ type: 'lifecycle', action: 'startup' });
  const targetInfo = await resolveUpdateTarget({ execPath: process.execPath, isPackaged: app.isPackaged });
  const updates = createUpdateService({ version, repository: REPOSITORY, downloadsDir: path.join(userData, 'updates'),
    bundleTarget: targetInfo,
    prepareBundle: record => prepareHandoff({ targetInfo, userData, ...record }),
    onState: state => {
      if (!window.isDestroyed()) window.webContents.send('notepad:action', { type: 'update-progress', state });
    },
    confirmInstall: async update => {
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Update ElevenMD', message: `Install ElevenMD ${update.version}?`,
        detail: 'Your tabs will be checkpointed before ElevenMD closes. The updater will show progress, update this copy in its current folder, and reopen it without a setup wizard. Portable copies stay portable. Your document files will not be overwritten.',
        buttons: ['Install and restart', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      return result.response === 0;
    },
    beforeInstall: async () => { if (typeof checkpoint !== 'function') throw new Error('Checkpoint unavailable.'); await checkpoint(); },
    launchInstaller: createUpdateLauncher({ execPath: process.execPath, parentPid: process.pid, isPackaged: app.isPackaged }),
  });
  const zero = (name, callback) => handle(name, (...args) => {
    if (args.some(value => value !== undefined)) throw new Error('Invalid arguments.');
    return callback();
  });
  zero('updates-state', () => updates.getState());
  for (const action of ['check', 'download', 'install']) zero(`updates-${action}`, async () => {
    const result = await updates[action]();
    await record({ type: 'update', action, outcome: result.status === 'error' ? 'failure' : action === 'install' && !result.installed ? 'cancelled' : 'success' });
    if (result.installed) { window.destroy(); app.quit(); }
    else if (action === 'install' && !window.isDestroyed()) window.webContents.send('notepad:action', { type: 'update-resume' });
    return result;
  });
  zero('open-release', async () => {
    await shell.openExternal(updates.getState().releaseUrl || `https://github.com/${REPOSITORY}/releases`);
    await record({ type: 'update', action: 'open_release', outcome: 'success' });
  });
  zero('diagnostics-state', state);
  handle('diagnostics-consent', async value => { await diagnostics.setConsent(value); return state(); });
  handle('record-diagnostic', async event => {
    // Native file/update/lifecycle outcomes are recorded by main, not claimed by renderer.
    if (!event || !['mode_changed', 'formatting', 'theme_changed', 'find_replace', 'document_new', 'document_close'].includes(event.type)) return false;
    return record(event);
  });
  zero('diagnostics-inspect', () => diagnostics.inspect());
  zero('diagnostics-clear', async () => { await diagnostics.clear(); return state(); });
  zero('diagnostics-export', async () => {
    const report = await diagnostics.buildReport();
    const result = await dialog.showSaveDialog(window, { title: 'Export sanitized diagnostics', defaultPath: 'ElevenMD-diagnostics.json', filters: [{ name: 'JSON diagnostics', extensions: ['json'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, report, { encoding: 'utf8', mode: 0o600 });
    return true;
  });
  return { diagnostics, updates, record };
}
module.exports = { setupSupport };
