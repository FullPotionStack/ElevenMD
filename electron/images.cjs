'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const MAX_BYTES = 20 * 1024 * 1024;
async function readImage(filename) {
  const before = await fs.lstat(filename);
  if (!before.isFile()) throw new Error('Images must be regular files.');
  if (before.size > MAX_BYTES) throw new Error('Image exceeds the 20 MiB limit.');
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error('Images must be regular files.');
    if (opened.size > MAX_BYTES) throw new Error('Image exceeds the 20 MiB limit.');
    if (before.dev !== opened.dev || before.ino !== opened.ino || await fs.realpath(filename) !== filename) {
      throw new Error('Image file changed during access.');
    }
    // Bounded reads also catch a file growing after stat; never use unbounded readFile.
    const chunks = [];
    let total = 0;
    while (total <= MAX_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, MAX_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_BYTES) throw new Error('Image exceeds the 20 MiB limit.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}
function imageType(bytes) {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' &&
      bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 &&
      bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) {
    return { mime: 'image/png', extension: '.png' };
  }
  if (bytes.length >= 14 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) &&
      bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes.at(-1) === 0x3b) {
    return { mime: 'image/gif', extension: '.gif' };
  }
  if (bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[3] >= 0xc0 && bytes[3] <= 0xfe && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return { mime: 'image/jpeg', extension: '.jpg' };
  }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.readUInt32LE(4) === bytes.length - 8 && bytes.toString('ascii', 8, 12) === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) {
    return { mime: 'image/webp', extension: '.webp' };
  }
  if (bytes.length >= 54 && bytes.toString('ascii', 0, 2) === 'BM' &&
      bytes.readUInt32LE(2) === bytes.length && bytes.readUInt32LE(10) >= 26 &&
      bytes.readUInt32LE(10) <= bytes.length && bytes.readUInt32LE(14) >= 40 &&
      bytes.readUInt16LE(26) === 1 && [1, 4, 8, 16, 24, 32].includes(bytes.readUInt16LE(28))) {
    return { mime: 'image/bmp', extension: '.bmp' };
  }
  if (bytes.length >= 24 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const boxSize = bytes.readUInt32BE(0);
    if (boxSize >= 24 && boxSize <= bytes.length && boxSize % 4 === 0) {
      const brands = [bytes.toString('ascii', 8, 12)];
      for (let offset = 16; offset < boxSize; offset += 4) brands.push(bytes.toString('ascii', offset, offset + 4));
      if (brands.includes('avif') || brands.includes('avis')) return { mime: 'image/avif', extension: '.avif' };
    }
  }
  // SVG deliberately unsupported: signatures alone cannot establish passive XML.
  throw new Error('Unsupported image signature. SVG is not supported.');
}
function createImageService({ getDocument }) {
  async function documentFor(payload, resolving) {
    const keys = resolving ? ['id', 'source'] : ['id'];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).some(key => !keys.includes(key)) ||
        typeof payload.id !== 'string' || !payload.id || payload.id.length > 128 ||
        (resolving && (typeof payload.source !== 'string' || !payload.source || payload.source.length > 4096))) {
      throw new Error('Invalid image request.');
    }
    const doc = await getDocument(payload.id);
    if (!doc || doc.id !== payload.id) throw new Error('Unknown document.');
    if (typeof doc.path !== 'string' || !path.isAbsolute(doc.path)) throw new Error('A saved document is required.');
    return doc;
  }
  return {
    async resolve(payload) {
      const doc = await documentFor(payload, true);
      const { source } = payload;
      let relative;
      try { relative = decodeURIComponent(source); }
      catch { throw new Error('Invalid image source encoding.'); }
      if (/[?#]/.test(source) || /[\\\\:\u0000-\u001f\u007f]/.test(relative) || /%[0-9a-f]{2}/i.test(relative) ||
          path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
        throw new Error('Invalid image source: use a relative local path.');
      }
      const directory = path.dirname(doc.path);
      const filename = path.resolve(directory, relative);
      const fromDirectory = path.relative(directory, filename);
      if (!fromDirectory || fromDirectory === '..' || fromDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(fromDirectory)) {
        throw new Error('Image source is outside the document directory.');
      }
      const canonicalDirectory = await fs.realpath(directory);
      const canonicalFile = await fs.realpath(filename);
      const canonicalRelative = path.relative(canonicalDirectory, canonicalFile);
      if (!canonicalRelative || canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
        throw new Error('Image symlink points outside the document directory.');
      }
      const bytes = await readImage(canonicalFile);
      const { mime } = imageType(bytes);
      return { src: `data:${mime};base64,${bytes.toString('base64')}`, mime };
    },
    async importImage(payload, choosePath) {
      const doc = await documentFor(payload, false);
      if (typeof choosePath !== 'function') throw new Error('A native image picker is required.');
      const selected = await choosePath();
      if (selected === null || selected === undefined) return null;
      if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\u0000')) {
        throw new Error('Invalid native image selection: an absolute path is required.');
      }
      const bytes = await readImage(await fs.realpath(selected));
      const { extension } = imageType(bytes);
      const directory = await fs.realpath(path.dirname(doc.path));
      const assetName = `${path.parse(doc.path).name}.assets`;
      const assets = path.join(directory, assetName);
      try { await fs.mkdir(assets); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const assetStat = await fs.lstat(assets);
      if (!assetStat.isDirectory() || assetStat.isSymbolicLink() || await fs.realpath(assets) !== assets) {
        throw new Error('Assets directory must not be a symlink or point outside the document directory.');
      }
      const basename = path.parse(selected).name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || 'image';
      const filename = `${basename}-${randomUUID()}${extension}`;
      await fs.writeFile(path.join(assets, filename), bytes, { flag: 'wx' });
      const encodeSegment = value => encodeURIComponent(value).replace(/[!'()*]/g,
        char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return { source: [assetName, filename].map(encodeSegment).join('/') };
    },
  };
}
module.exports = { createImageService };
