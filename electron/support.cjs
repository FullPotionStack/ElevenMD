'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createUpdateService } = require('./updates.cjs');
const { createDiagnosticsService } = require('./diagnostics.cjs');
const { REPOSITORY, prepareReport, issueURL } = require('./bug-report.cjs');

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
  const updates = createUpdateService({ version, repository: REPOSITORY, downloadsDir: path.join(userData, 'updates'),
    confirmInstall: async update => {
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Update ElevenMD', message: `Install ElevenMD ${update.version}?`,
        detail: 'Your tabs have been checkpointed. ElevenMD will close and the verified release installer will open. Continue through the installer to restart the app. Your document files will not be overwritten.',
        buttons: ['Install and restart', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      return result.response === 0;
    },
    beforeInstall: async () => { if (typeof checkpoint !== 'function') throw new Error('Checkpoint unavailable.'); await checkpoint(); },
    launchInstaller: async filename => {
      // Keep upgrades in an installed app's own directory; portable users get a normal install.
      const args = ['/UPDATE', '/NOCLOSEAPPLICATIONS', '/NORESTART'];
      if (app.isPackaged && await fs.stat(path.join(path.dirname(process.execPath), 'unins000.exe')).then(s => s.isFile(), () => false)) args.push(`/DIR=${path.dirname(process.execPath)}`);
      await new Promise((resolve, reject) => {
        const child = spawn(filename, args, { shell: false, detached: true, stdio: 'ignore' });
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
      });
    },
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
  let reviewed = null;
  handle('prepare-bug-report', async payload => {
    const prepared = prepareReport(payload);
    const report = await diagnostics.inspect();
    // Bounded summary. The user can attach a full reviewed export manually.
    const summary = { environment: report.environment, events: prepared.includeDiagnostics ? report.events.slice(-12) : [] };
    const appendix = prepared.includeDiagnostics ? `\n\n## Sanitized diagnostics\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`` : `\n\nElevenMD ${version}`;
    if (prepared.body.length + appendix.length > 6000) throw new Error('Report too long. Shorten your steps or export diagnostics separately.');
    reviewed = prepareReport({ ...prepared, body: prepared.body + appendix });
    issueURL(reviewed); // Verify it fits before displaying a draft we cannot open.
    return { ...reviewed };
  });
  handle('report-bug', async payload => {
    const report = prepareReport(payload);
    if (!reviewed || JSON.stringify(report) !== JSON.stringify(reviewed)) return false;
    const result = await dialog.showMessageBox(window, { type: 'question', title: 'Public bug report', message: 'Open this reviewed report on GitHub?', detail: 'GitHub issues are public. You will still choose whether to submit the issue in your browser. No files or screenshots are uploaded.', buttons: ['Open GitHub', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
    if (result.response !== 0) return false;
    await shell.openExternal(issueURL(report)); reviewed = null;
    return true;
  });
  return { diagnostics, updates, record };
}
module.exports = { setupSupport };
