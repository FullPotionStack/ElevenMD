'use strict';
const fs = require('./updater/fs.cjs').promises;
const { createReadStream, createWriteStream } = require('./updater/fs.cjs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createGzip, createGunzip } = require('node:zlib');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const LIMITS = Object.freeze({ manifest: 2 * 1024 * 1024, entries: 10000, compressed: 512 * 1024 * 1024, expanded: 2 * 1024 * 1024 * 1024, file: 256 * 1024 * 1024 });
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function relative(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe relative update path.');
  return value;
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Invalid update schema.');
}
function validateManifest(value, expected = {}) {
  exactKeys(value, ['schema', 'protocol', 'version', 'repository', 'platform', 'arch', 'route', 'executable', 'entries']);
  if (value.schema !== 1 || value.protocol !== 1 || typeof value.version !== 'string' || !stable.test(value.version) || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.repository) || !['win32', 'linux', 'darwin'].includes(value.platform) || !['x64', 'arm64'].includes(value.arch) || !['portable', 'mac-bundle'].includes(value.route) || (value.route === 'mac-bundle') !== (value.platform === 'darwin') || !Array.isArray(value.entries) || !value.entries.length || value.entries.length > LIMITS.entries) throw new Error('Unsupported update manifest.');
  for (const key of ['version', 'repository', 'platform', 'arch', 'route']) if (expected[key] !== undefined && value[key] !== expected[key]) throw new Error(`Update ${key} mismatch.`);
  relative(value.executable);
  const entries = new Map(), folded = new Set(); let total = 0;
  for (const item of value.entries) {
    exactKeys(item, item.type === 'file' ? ['path', 'type', 'size', 'sha256', 'mode'] : ['path', 'type', 'target']);
    relative(item.path);
    const lower = item.path.toLowerCase();
    if (entries.has(item.path) || folded.has(lower)) throw new Error('Duplicate update path.');
    folded.add(lower); entries.set(item.path, item);
    if (item.type === 'file') {
      if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > LIMITS.file || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o777) throw new Error('Invalid update file.');
      total += item.size;
    } else if (item.type !== 'symlink' || value.platform === 'win32' || typeof item.target !== 'string' || !item.target || item.target.length > 1024 || /[\\:\x00-\x1f]/.test(item.target) || item.target.startsWith('/')) throw new Error('Invalid update link.');
  }
  if (total > LIMITS.expanded || entries.get(value.executable)?.type !== 'file') throw new Error('Invalid executable or expanded size.');
  const allPaths = new Set([...entries.keys(), ...[...entries.keys()].flatMap(name => { const parts = name.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')); })]);
  const directoryCase = new Map();
  for (const name of allPaths) {
    const lower = name.toLowerCase();
    if (directoryCase.has(lower) && directoryCase.get(lower) !== name) throw new Error('Directory case collision.');
    directoryCase.set(lower, name);
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (entries.has(parts.slice(0, i).join('/'))) throw new Error('Update entry below a file or link.');
  }
  function resolveLink(name) {
    // Resolve links before consuming subsequent '..' components, as the kernel
    // does. Lexical normalization first can both reject frameworks and hide escapes.
    const queue = [...name.split('/')], resolved = []; let expansions = 0;
    while (queue.length) {
      const component = queue.shift();
      if (!component || component === '.') continue;
      if (component === '..') {
        if (!resolved.length) throw new Error('Escaping update link.');
        resolved.pop(); continue;
      }
      resolved.push(component);
      const entry = entries.get(resolved.join('/'));
      if (entry?.type === 'symlink') {
        if (++expansions > 40) throw new Error('Cyclic update link.');
        resolved.pop(); queue.unshift(...entry.target.split('/'));
      } else if (entry?.type === 'file' && queue.length) throw new Error('Update link crosses a file.');
      else if (!allPaths.has(resolved.join('/'))) throw new Error('Missing update link target.');
    }
    if (!allPaths.has(resolved.join('/'))) throw new Error('Missing update link target.');
  }
  for (const item of value.entries) if (item.type === 'symlink') resolveLink(item.path);
  return JSON.parse(JSON.stringify(value));
}
async function digest(filename) {
  const hash = createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(filename)) { hash.update(bytes); size += bytes.length; if (size > LIMITS.file) throw new Error('Update file too large.'); }
  return { sha256: hash.digest('hex'), size };
}
async function inventory(root) {
  const result = [];
  async function walk(dir, prefix = '') {
    for (const name of (await fs.readdir(dir)).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name; relative(rel);
      const filename = path.join(dir, name), stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) result.push({ path: rel, type: 'symlink', target: await fs.readlink(filename) });
      else if (stat.isDirectory()) await walk(filename, rel);
      else if (stat.isFile() && stat.nlink === 1) result.push({ path: rel, type: 'file', ...await digest(filename), mode: stat.mode & 0o777 });
      else throw new Error('Unsupported update filesystem entry.');
      if (result.length > LIMITS.entries) throw new Error('Too many update files.');
    }
  }
  await walk(root); return result;
}
async function canonicalDirectory(root) {
  const resolved = path.resolve(root), stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) throw new Error('Noncanonical update directory.');
  return resolved;
}
async function createBundle({ root, destination, version, repository, platform, arch, route, executable }) {
  root = await canonicalDirectory(root);
  if (path.resolve(destination).startsWith(root + path.sep)) throw new Error('Bundle destination must be outside its input.');
  const manifest = validateManifest({ schema: 1, protocol: 1, version, repository, platform, arch, route, executable, entries: await inventory(root) });
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > LIMITS.manifest) throw new Error('Manifest too large.');
  const header = Buffer.alloc(4); header.writeUInt32BE(json.length);
  async function* source() {
    yield header; yield json;
    for (const item of manifest.entries) if (item.type === 'file') {
      const hash = createHash('sha256'); let size = 0;
      for await (const bytes of createReadStream(path.join(root, item.path))) { size += bytes.length; if (size > item.size) throw new Error('Source changed.'); hash.update(bytes); yield bytes; }
      if (size !== item.size || hash.digest('hex') !== item.sha256) throw new Error('Source changed.');
    }
  }
  let owned = false, size = 0; const hash = createHash('sha256');
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  output.once('open', () => { owned = true; });
  const counter = new Transform({ transform(bytes, _encoding, callback) {
    size += bytes.length;
    if (size > LIMITS.compressed) return callback(new Error('Bundle too large.'));
    hash.update(bytes); callback(null, bytes);
  } });
  try { await pipeline(Readable.from(source()), createGzip(), counter, output); }
  catch (error) { if (owned) await fs.unlink(destination).catch(() => {}); throw error; }
  return { manifest, size, sha256: hash.digest('hex') };
}
async function verifyTree(root, manifest) {
  manifest = validateManifest(manifest); root = await canonicalDirectory(root);
  const actual = await inventory(root);
  const expected = new Map(manifest.entries.map(item => [item.path, item]));
  if (actual.length !== expected.size) throw new Error('Unexpected update files.');
  for (const item of actual) {
    const want = expected.get(item.path);
    if (!want || item.type !== want.type || (item.type === 'file' ? item.size !== want.size || item.sha256 !== want.sha256 || (process.platform !== 'win32' && item.mode !== want.mode) : item.target !== want.target)) throw new Error('Update file digest, size or metadata mismatch.');
  }
}
async function extractBundle({ filename, destination, expected }) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.compressed) throw new Error('Invalid bundle.');
  let owned = false;
  const input = createReadStream(filename), unzip = createGunzip(); input.on('error', error => unzip.destroy(error)); input.pipe(unzip);
  const iterator = unzip[Symbol.asyncIterator](); let buffer = Buffer.alloc(0), consumed = 0;
  async function take(size, write) {
    let remaining = size;
    while (remaining) {
      if (!buffer.length) { const next = await iterator.next(); if (next.done) throw new Error('Truncated update bundle.'); buffer = next.value; }
      const length = Math.min(remaining, buffer.length), bytes = buffer.subarray(0, length);
      buffer = buffer.subarray(length); consumed += length;
      if (consumed > LIMITS.expanded + LIMITS.manifest + 4) throw new Error('Expanded update too large.');
      await write(bytes); remaining -= length;
    }
  }
  async function read(size) { const chunks = []; await take(size, bytes => { chunks.push(bytes); }); return Buffer.concat(chunks); }
  try {
    const length = (await read(4)).readUInt32BE();
    if (!length || length > LIMITS.manifest) throw new Error('Invalid manifest size.');
    const manifest = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(length))), expected);
    await fs.mkdir(destination, { mode: 0o700 }); owned = true;
    await canonicalDirectory(destination);
    for (const item of manifest.entries) if (item.type === 'file') {
      const target = path.join(destination, item.path); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      const handle = await fs.open(target, 'wx', item.mode), hash = createHash('sha256');
      try {
        await take(item.size, async bytes => { hash.update(bytes); await handle.writeFile(bytes); });
        if (hash.digest('hex') !== item.sha256) throw new Error('Update digest mismatch.');
        await handle.sync();
      } finally { await handle.close(); }
      await fs.chmod(target, item.mode);
    }
    if (buffer.length || !(await iterator.next()).done) throw new Error('Trailing update data.');
    for (const item of manifest.entries) if (item.type === 'symlink') {
      const target = path.join(destination, item.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.symlink(item.target, target);
    }
    await verifyTree(destination, manifest); return manifest;
  } catch (error) { if (owned) await fs.rm(destination, { recursive: true, force: true }); throw error; }
  finally { input.destroy(); unzip.destroy(); }
}
module.exports = { LIMITS, relative, validateManifest, createBundle, extractBundle, verifyTree, inventory, canonicalDirectory };
