'use strict';
const fs = require('./updater/fs.cjs').promises;
const path = require('node:path');
const { createReadStream } = require('./updater/fs.cjs');
const { createHash } = require('node:crypto');
const { validateManifest, extractBundle, verifyTree, LIMITS } = require('./update-bundle.cjs');
function createNativeUpdates({ platform, arch, repository, downloadsDir, target, request, readBounded, withDeadline, confirmInstall, beforeInstall, prepareBundle, onState }) {
  let state, candidate, record, handedOff = false;
  const snapshot = () => ({ ...state, progress: state.progress ? { ...state.progress } : null });
  const publish = next => { state = { ...state, ...next }; onState(snapshot()); return snapshot(); };
  const prefix = require('./distribution.cjs').installerPrefix.replace(/-Setup$/, '');
  function asset(release, name, limit, base) {
    const matches = release.assets?.filter(item => item?.name === name);
    if (matches?.length !== 1 || matches[0].browser_download_url !== base + name || !Number.isSafeInteger(matches[0].size) || matches[0].size <= 0 || matches[0].size > limit) throw new Error('Invalid native update asset.');
    return { name, url: base + name, size: matches[0].size };
  }
  async function discard() {
    if (handedOff) throw new Error('An update is already running.');
    const old = record; record = null; await old?.prepared?.dispose();
    if (old) await fs.rm(old.directory, { recursive: true, force: true });
  }
  async function check(release, initial) {
    await discard(); candidate = null;
    const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : platform;
    const stem = `${prefix}-${initial.version}-${os}-${arch}-update`;
    if (!Array.isArray(release.assets) || !release.assets.some(item => item?.name === `${stem}.json`)) return null;
    const base = `https://github.com/${repository}/releases/download/v${initial.version}/`;
    const descriptorAsset = asset(release, `${stem}.json`, LIMITS.manifest + 1024, base);
    const descriptor = await withDeadline(15000, async context => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(await request(descriptorAsset.url, context), LIMITS.manifest + 1024, context))));
    if (!descriptor || descriptor.schema !== 1 || Object.keys(descriptor).some(k => !['schema', 'asset', 'size', 'sha256', 'manifest'].includes(k)) || descriptor.asset !== `${stem}.bundle.gz` || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('Invalid update descriptor.');
    const manifest = validateManifest(descriptor.manifest, { version: initial.version, repository, platform, arch, route: ['deb', 'windows-installed'].includes(target.route) ? 'portable' : target.route });
    const bundle = asset(release, descriptor.asset, LIMITS.compressed, base);
    if (descriptor.size !== bundle.size) throw new Error('Bundle size mismatch.');
    candidate = { ...bundle, manifest, sha256: descriptor.sha256, route: target.route };
    if (['deb', 'windows-installed'].includes(target.route)) {
      const windows = target.route === 'windows-installed';
      const deb = asset(release, windows ? `${require('./distribution.cjs').installerPrefix}-${initial.version}.exe` : `${prefix}-${initial.version}-linux-${arch}.deb`, LIMITS.compressed, base);
      const sums = asset(release, windows ? 'SHA256SUMS' : `${prefix}-${initial.version}-linux-${arch}-SHA256SUMS.txt`, 128 * 1024, base);
      const text = await withDeadline(15000, async context => (await readBounded(await request(sums.url, context), 128 * 1024, context)).toString('utf8'));
      const matches = text.split(/\r?\n/).map(line => /^([a-f0-9]{64}) [ *]([A-Za-z0-9._-]+)$/.exec(line)).filter(row => row?.[2] === deb.name);
      if (matches.length !== 1) throw new Error('Missing package checksum.');
      candidate = { ...deb, sha256: matches[0][1], manifest: { sha256: matches[0][1], version: initial.version }, route: target.route };
    }
    state = { ...initial, manualDownload: false, status: 'available', error: null, progress: null }; return publish({});
  }
  async function rehash(filename, expected) {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== expected.size || await fs.realpath(filename) !== filename) throw new Error('Invalid cached update.');
    const hash = createHash('sha256'); let size = 0;
    for await (const bytes of createReadStream(filename)) { size += bytes.length; if (size > expected.size) throw new Error('Cached update grew.'); hash.update(bytes); }
    if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('Cached update changed.');
  }
  async function download() {
    if (record && state.status === 'downloaded') return snapshot();
    let directory, handle;
    try {
      await discard(); if (!candidate) throw new Error('No native update selected.');
      await fs.mkdir(downloadsDir, { recursive: true, mode: 0o700 });
      directory = await fs.mkdtemp(path.join(downloadsDir, 'native-update-'));
      const filename = path.join(directory, candidate.route === 'deb' ? 'payload.deb' : candidate.route === 'windows-installed' ? 'payload.exe' : 'payload.bundle.gz');
      publish({ status: 'downloading', progress: { received: 0, total: candidate.size }, error: null });
      handle = await fs.open(filename, 'wx', 0o600); const hash = createHash('sha256');
      await withDeadline(300000, async context => {
        const response = await request(candidate.url, context);
        const total = await readBounded(response, candidate.size, context, async bytes => {
          hash.update(bytes); await handle.writeFile(bytes);
          publish({ progress: { received: state.progress.received + bytes.length, total: candidate.size } });
        });
        publish({ status: 'verifying' });
        if (total !== candidate.size || hash.digest('hex') !== candidate.sha256) throw new Error('Native update hash mismatch.');
        await handle.sync();
      });
      await handle.close(); handle = null;
      const direct = ['portable', 'mac-bundle'].includes(candidate.route);
      const staged = direct ? path.join(directory, 'staged') : filename;
      if (direct) await extractBundle({ filename, destination: staged, expected: candidate.manifest });
      if (typeof prepareBundle !== 'function') throw new Error('Native updater unavailable.');
      const prepared = await prepareBundle({ directory, filename, staged, manifest: candidate.manifest });
      if (!prepared || typeof prepared.launch !== 'function' || typeof prepared.dispose !== 'function') throw new Error('Invalid helper preparation.');
      record = { directory, filename, staged, prepared, ...candidate };
      return publish({ status: 'downloaded' });
    } catch {
      if (handle) await handle.close().catch(() => {});
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      record = null; return publish({ status: 'error', progress: null, error: 'Unable to prepare a verified update. Your app has not changed.' });
    }
  }
  async function install() {
    if (handedOff) return { ...snapshot(), installed: true };
    try {
      if (!record || state.status !== 'downloaded' || typeof confirmInstall !== 'function' || typeof beforeInstall !== 'function') throw new Error('Native installation unavailable.');
      if (await confirmInstall(snapshot()) !== true) return snapshot();
      await rehash(record.filename, record);
      if (['portable', 'mac-bundle'].includes(record.route)) await verifyTree(record.staged, record.manifest);
      await beforeInstall();
      await record.prepared.launch(); handedOff = true;
      return { ...snapshot(), installed: true };
    } catch { await record?.prepared.dispose(); return publish({ status: 'error', error: 'Could not start the updater. Your tabs stay open.' }); }
  }
  return { check, download, install };
}
module.exports = { createNativeUpdates };
