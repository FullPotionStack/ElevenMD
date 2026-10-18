'use strict';
const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('updater:progress', (_event, text) => { if (typeof text === 'string' && text.length <= 200) document.querySelector('#status').textContent = text; });
});
