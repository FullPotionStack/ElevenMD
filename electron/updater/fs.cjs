'use strict';
// Electron's patched fs treats .asar files as virtual directories. Updater
// inventories and replacements must operate on physical bytes instead.
module.exports = process.versions.electron ? require('original-fs') : require('node:fs');
