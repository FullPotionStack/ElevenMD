'use strict';
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
function createSecurityPolicy(distDirectory, devURL) {
  const root = path.resolve(distDirectory);
  let development;
  if (devURL !== undefined && devURL !== '') {
    // Check the literal authority before URL's permissive IPv4 normalization.
    if (typeof devURL !== 'string' || !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(devURL)) {
      throw new Error('NOTEPAD_DEV_URL must use an explicit loopback HTTP(S) address.');
    }
    development = new URL(devURL);
    if (development.username || development.password) throw new Error('Loopback development URLs cannot contain credentials.');
  }
  const entryURL = development ? development.href : pathToFileURL(path.join(root, 'index.html')).href;
  const documentURL = value => { const url = new URL(value); url.hash = ''; return url.href; };
  function allowRequest(value) {
    try {
      const url = new URL(value);
      if (development) {
        if (url.protocol === 'ws:') url.protocol = 'http:';
        if (url.protocol === 'wss:') url.protocol = 'https:';
        return !url.username && !url.password && url.origin === development.origin;
      }
      if (url.protocol !== 'file:' || url.hostname) return false;
      const relative = path.relative(root, fileURLToPath(url));
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    } catch { return false; }
  }
  function allowDocument(value) {
    try { return documentURL(value) === documentURL(entryURL); } catch { return false; }
  }
  const connect = development ? `${development.origin} ${development.origin.replace(/^http/, 'ws')}` : "'none'";
  const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src ${connect}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return { entryURL, development: Boolean(development), allowRequest, allowDocument, csp };
}
function isTrustedSender(event, window, policy) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame && policy.allowDocument(event.senderFrame.url));
}
module.exports = { createSecurityPolicy, isTrustedSender };
