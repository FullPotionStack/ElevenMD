'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const distribution = require('./distribution.cjs');
const MAX_METADATA_BYTES = 1024 * 1024;
function boundedOption(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) throw new Error('Invalid update configuration.');
  return value;
}
async function withDeadline(milliseconds, operation) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Update timed out')); }, milliseconds);
  });
  const context = { signal: controller.signal, wait: promise => Promise.race([promise, expired]) };
  // Race network operations, not disk work: cleanup must await the owned file operation.
  try { return await operation(context); }
  finally { clearTimeout(timer); controller.abort(); }
}
async function readBounded(response, limit, context, onChunk) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(limit))) throw new Error('Invalid content length');
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await context.wait(reader.read());
      if (done) break;
      context.signal.throwIfAborted();
      total += value.byteLength;
      if (total > limit) throw new Error('Update response too large');
      const bytes = Buffer.from(value);
      if (onChunk) await onChunk(bytes); else chunks.push(bytes);
    }
    // Fetch transparently decodes gzip/br/etc.; Content-Length describes wire bytes.
    // Decoded streaming bounds always apply. Exact length applies only to identity bodies.
    const encoded = response.headers.get('content-encoding');
    if ((!encoded || encoded === 'identity') && length !== null && total !== Number(length)) throw new Error('Truncated response');
    return onChunk ? total : Buffer.concat(chunks, total);
  } finally { void reader.cancel().catch(() => {}); }
}
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
const MAX_INSTALLER_BYTES = 256 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 128 * 1024;
function newer(a, b) {
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
function plainNotes(value) {
  return typeof value === 'string' ? value.slice(0, 32000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/[<>]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 8000) : '';
}
/**
 * Main-process-only updater. Construction and check() never download or execute code.
 * Required: version (stable X.Y.Z), repository matching the build-owned distribution.cjs trust anchor,
 * downloadsDir (private app-owned absolute directory). fetchImpl defaults to Node fetch.
 * Optional lower-only bounds: requestTimeoutMs <= 15000, downloadTimeoutMs <= 120000,
 * maxInstallerBytes <= 256 MiB. Metadata <= 1 MiB, SHA256SUMS <= 128 KiB.
 *
 * getState() is a defensive copy; zero-argument check()/download()/install() return it.
 * State: { status, currentVersion, version: availableVersion|null, notes, releaseUrl, error }.
 * Status: idle/checking/available/current/error/unpublished/downloading/downloaded.
 * Never render notes as HTML/Markdown; use textContent. No paths enter public state.
 *
 * install() fails closed unless these MAIN-owned hooks are supplied:
 * confirmInstall(state): native dialog, resolve exactly true to proceed;
 * beforeInstall(): optional durable draft/session checkpoint, reject to stop;
 * launchInstaller(absoluteFilename): launch this verified executable WITHOUT a shell,
 * resolve only after successful process creation. No default launch implementation.
 * Renderer confirmation must precede the trusted main handler calling install().
 * Success returns { ...state, installed: true }; cancellation returns downloaded state.
 * Publish SHA256SUMS (exact filename), with sha256sum text/binary rows and simple basenames.
 * Checksums establish release integrity, not authenticity independent of GitHub/repo trust.
 */
function createUpdateService({ version, repository, downloadsDir, fetchImpl = globalThis.fetch,
  requestTimeoutMs, downloadTimeoutMs, maxInstallerBytes, confirmInstall, beforeInstall, launchInstaller }) {
  if (repository !== distribution.repository || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(distribution.installerPrefix) || typeof version !== 'string' || version.length > 100 ||
      !STABLE.test(version) || /[\r\n]/.test(version) || typeof downloadsDir !== 'string' || !path.isAbsolute(downloadsDir) ||
      typeof fetchImpl !== 'function') throw new Error('Invalid update configuration.');
  const checkTimeout = boundedOption(requestTimeoutMs, 15000);
  const downloadTimeout = boundedOption(downloadTimeoutMs, 120000);
  const installerLimit = boundedOption(maxInstallerBytes, MAX_INSTALLER_BYTES);
  const api = `https://api.github.com/repos/${repository}/releases/latest`;
  const unpublished = Symbol('unpublished');
  async function request(initialURL, context) {
    let url = initialURL;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await context.wait(fetchImpl(url, {
        redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: context.signal,
        headers: { Accept: initialURL === api ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'ElevenMD-Updater' },
      }));
      context.signal.throwIfAborted();
      if (response.redirected || (response.url && response.url !== url)) throw new Error('Unexpected automatic redirect');
      if (response.status === 200) return response;
      void response.body?.cancel().catch(() => {});
      if (initialURL === api && response.status === 404) throw unpublished;
      if (initialURL === api || redirects === 3 || ![301, 302, 303, 307, 308].includes(response.status)) {
        throw new Error('Unexpected update response');
      }
      const location = response.headers.get('location');
      if (!location || location.length > 8192 || /[\s\\]/.test(location)) throw new Error('Invalid asset redirect');
      const next = new URL(location, url);
      const assetHost = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname);
      if (next.protocol !== 'https:' || next.username || next.password || next.port || next.hash ||
          !((next.href === initialURL) || (assetHost && /^\/github-production-release-asset\/[A-Za-z0-9/_-]+$/.test(next.pathname)))) {
        throw new Error('Untrusted asset redirect');
      }
      url = next.href;
    }
    throw new Error('Too many redirects');
  }
  const empty = { currentVersion: version, version: null, releaseUrl: null, notes: '', error: null };
  let state = { ...empty, status: 'idle' }, candidate = null;
  const getState = () => ({ ...state });
  async function discardVerified() {
    const previous = verified;
    verified = null; installed = false;
    if (previous) await fs.rm(previous.directory, { recursive: true, force: true });
  }
  async function check() {
    state = { ...empty, status: 'checking' }; candidate = null;
    try {
      await discardVerified();
      const release = await withDeadline(checkTimeout, async context => {
        const response = await request(api, context);
        const bytes = await readBounded(response, MAX_METADATA_BYTES, context);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      });
      if (!release || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean' ||
          typeof release.tag_name !== 'string' || release.tag_name.length > 100) throw new Error('Invalid release');
      const tag = release.tag_name, latest = tag.replace(/^v/, '');
      if (!SEMVER.test(latest) || /[\r\n]/.test(latest)) throw new Error('Invalid version');
      if (release.draft || release.prerelease || !STABLE.test(latest) || !newer(latest, version)) {
        state.status = 'current';
        if (!release.draft && !release.prerelease && latest === version) {
          state.notes = plainNotes(release.body);
          state.releaseUrl = `https://github.com/${repository}/releases/tag/${tag}`;
        }
        return getState();
      }
      const name = `${distribution.installerPrefix}-${latest}.exe`;
      if (!Array.isArray(release.assets) || release.assets.length > 100) throw new Error('Invalid assets');
      const base = `https://github.com/${repository}/releases/download/${tag}/`;
      function asset(wanted, max) {
        const found = release.assets.filter(value => value && value.name === wanted);
        if (found.length !== 1 || found[0].browser_download_url !== base + wanted ||
            !Number.isSafeInteger(found[0].size) || found[0].size < 1 || found[0].size > max) throw new Error('Invalid asset');
        return { name: wanted, url: base + wanted, size: found[0].size };
      }
      candidate = { installer: asset(name, installerLimit), checksums: asset('SHA256SUMS', MAX_CHECKSUM_BYTES) };
      state = { ...empty, status: 'available', version: latest,
        releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`, notes: plainNotes(release.body) };
    } catch (error) {
      state = error === unpublished ? { ...empty, status: 'unpublished' }
        : { ...empty, status: 'error', error: 'Unable to check for updates. Please try again later.' };
    }
    return getState();
  }
  let verified = null;
  async function download() {
    if (verified && state.status === 'downloaded') return getState();
    state = { ...state, status: 'downloading', error: null };
    let directory, handle;
    try {
      await discardVerified();
      if (!candidate) throw new Error('No update selected');
      await withDeadline(downloadTimeout, async context => {
        const response = await request(candidate.checksums.url, context);
        const sums = new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, MAX_CHECKSUM_BYTES, context));
        const matches = [];
        for (const line of sums.split(/\r?\n/)) {
          if (!line) continue;
          const parsed = /^([a-fA-F0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
          if (!parsed) throw new Error('Invalid checksum manifest');
          if (parsed[2] === candidate.installer.name) matches.push(parsed[1]);
        }
        if (matches.length !== 1) throw new Error('Invalid checksums');
        const expected = matches[0].toLowerCase();
        await fs.mkdir(downloadsDir, { recursive: true, mode: 0o700 });
        const root = await fs.realpath(downloadsDir);
        directory = await fs.mkdtemp(path.join(root, 'elevenmd-update-'));
        const filename = path.join(directory, candidate.installer.name);
        handle = await fs.open(filename, 'wx', 0o600);
        const hash = createHash('sha256');
        const exe = await request(candidate.installer.url, context);
        const total = await readBounded(exe, candidate.installer.size, context, async bytes => {
          hash.update(bytes); await handle.writeFile(bytes);
        });
        if (total !== candidate.installer.size || hash.digest('hex') !== expected) throw new Error('Checksum mismatch');
        await handle.sync(); await handle.close(); handle = null;
        context.signal.throwIfAborted();
        verified = { filename, directory, hash: expected, size: total };
      });
      state.status = 'downloaded';
    } catch {
      verified = null;
      state = { ...state, status: 'error', error: 'Unable to download a verified update. Please try again later.' };
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (!verified && directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
    return getState();
  }
  let installed = false;
  async function install() {
    if (installed) return { ...getState(), installed: true };
    try {
      if (!verified || state.status !== 'downloaded' || typeof confirmInstall !== 'function' ||
          typeof launchInstaller !== 'function') throw new Error('Installation is unavailable');
      if (await confirmInstall(getState()) !== true) return getState();
      if (beforeInstall) await beforeInstall();
      const record = verified;
      const directoryStat = await fs.lstat(record.directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
          await fs.realpath(record.directory) !== record.directory ||
          await fs.realpath(record.filename) !== record.filename) throw new Error('Invalid installer cache');
      const stat = await fs.lstat(record.filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== record.size) throw new Error('Invalid installer file');
      const handle = await fs.open(record.filename, 'r');
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.size !== record.size ||
            opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('Installer changed');
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
        let total = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          total += bytesRead;
          if (total > record.size) throw new Error('Installer changed');
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (total !== record.size || hash.digest('hex') !== record.hash) throw new Error('Installer changed');
        const latest = await fs.lstat(record.filename);
        if (!latest.isFile() || latest.nlink !== 1 || latest.ino !== opened.ino || latest.dev !== opened.dev ||
            latest.size !== opened.size || latest.mtimeMs !== opened.mtimeMs || latest.ctimeMs !== opened.ctimeMs) {
          throw new Error('Installer changed');
        }
        // Retain the read handle through the launch. This narrows, but cannot remove,
        // same-user filesystem races between verification and Windows process creation.
        await launchInstaller(record.filename);
      } finally { await handle.close(); }
      installed = true;
      return { ...getState(), installed: true };
    } catch {
      state = { ...state, status: 'error', error: 'Unable to install the update. Please download it again and try later.' };
      return getState();
    }
  }
  let queue = Promise.resolve();
  function serial(operation, args) {
    if (args.length) return Promise.reject(new Error('Update operations do not accept arguments.'));
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  return { getState, check: (...args) => serial(check, args), download: (...args) => serial(download, args),
    install: (...args) => serial(install, args) };
}
module.exports = { createUpdateService };