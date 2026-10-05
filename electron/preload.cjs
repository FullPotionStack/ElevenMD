'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// This bridge is deliberately self-contained: sandboxed preload cannot require local modules.
contextBridge.exposeInMainWorld('notepad', Object.freeze({
  open: () => ipcRenderer.invoke('notepad:open'),
  initialFiles: () => ipcRenderer.invoke('notepad:initial-files'),
  save: request => ipcRenderer.invoke('notepad:save', request),
  openLink: value => ipcRenderer.invoke('notepad:open-link', value),
  resolveImage: value => ipcRenderer.invoke('notepad:resolve-image', value),
  importImage: value => ipcRenderer.invoke('notepad:import-image', value),
  saveSession: value => ipcRenderer.invoke('notepad:save-session', value),
  restoreSession: () => ipcRenderer.invoke('notepad:restore-session'),
  preferences: value => ipcRenderer.invoke('notepad:preferences', value),
  confirmClose: name => ipcRenderer.invoke('notepad:confirm-close', name),
  setDirty: value => ipcRenderer.invoke('notepad:set-dirty', value),
  closeWindow: () => ipcRenderer.invoke('notepad:close-window'),
  updatesState: () => ipcRenderer.invoke('notepad:updates-state'),
  checkUpdates: () => ipcRenderer.invoke('notepad:updates-check'),
  downloadUpdate: () => ipcRenderer.invoke('notepad:updates-download'),
  installUpdate: () => ipcRenderer.invoke('notepad:updates-install'),
  checkpointUpdate: value => ipcRenderer.invoke('notepad:checkpoint-update', value),
  openRelease: () => ipcRenderer.invoke('notepad:open-release'),
  diagnosticsState: () => ipcRenderer.invoke('notepad:diagnostics-state'),
  diagnosticsConsent: value => ipcRenderer.invoke('notepad:diagnostics-consent', value),
  diagnosticsInspect: () => ipcRenderer.invoke('notepad:diagnostics-inspect'),
  diagnosticsClear: () => ipcRenderer.invoke('notepad:diagnostics-clear'),
  diagnosticsExport: () => ipcRenderer.invoke('notepad:diagnostics-export'),
  recordDiagnostic: value => ipcRenderer.invoke('notepad:record-diagnostic', value),
  onAction: callback => {
    if (typeof callback !== 'function') throw new TypeError('Action callback must be a function.');
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('notepad:action', listener);
    return () => ipcRenderer.removeListener('notepad:action', listener);
  },
}));
