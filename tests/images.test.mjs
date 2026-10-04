import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { crc32, inflateSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const scratch = process.env.HERMES_TEST_SCRATCH || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch') : process.env.TMPDIR);
assert.ok(scratch, 'A test scratch directory is required');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, 'notepad-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'docs');
  await fs.mkdir(dir);
  const doc = { id: randomUUID(), path: path.join(dir, 'My notes.md'), name: 'My notes.md' };
  await fs.writeFile(doc.path, '# Notes');
  return { root, dir, doc };
}
function service(doc) {
  let module;
  try { module = require('../electron/images.cjs'); }
  catch (error) { assert.fail(`Image service is not implemented: ${error.message}`); }
  return module.createImageService({ getDocument: id => id === doc.id ? doc : null });
}
function decoded(result) {
  assert.equal(result.src.startsWith(`data:${result.mime};base64,`), true);
  return Buffer.from(result.src.slice(result.src.indexOf(',') + 1), 'base64');
}
test('resolves an encoded local PNG to its exact original bytes', async t => {
  assert.equal(PNG.readUInt32BE(16), 1);
  assert.equal(PNG.readUInt32BE(20), 1);
  for (let offset = 8; offset < PNG.length;) {
    const length = PNG.readUInt32BE(offset);
    assert.equal(crc32(PNG.subarray(offset + 4, offset + 8 + length)), PNG.readUInt32BE(offset + 8 + length), 'PNG fixture chunk CRC must be valid');
    if (PNG.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      assert.deepEqual(inflateSync(PNG.subarray(offset + 8, offset + 8 + length)), Buffer.from([1, 255, 255]));
    }
    offset += length + 12;
  }
  const { dir, doc } = await fixture(t);
  await fs.writeFile(path.join(dir, 'pixel image.png'), PNG);
  const result = await service(doc).resolve({ id: doc.id, source: './pixel%20image.png' });
  assert.equal(result.mime, 'image/png');
  assert.deepEqual(decoded(result), PNG);
});
test('rejects malformed capabilities and unsaved or unknown documents before lookup or reads', async t => {
  const { dir, doc } = await fixture(t);
  await fs.writeFile(path.join(dir, 'pixel.png'), PNG);
  const images = service(doc);
  for (const payload of [null, [], {}, { id: 42, source: 'pixel.png' },
    { id: doc.id, source: 42 }, { id: doc.id, source: '' },
    { id: doc.id, source: 'pixel.png', path: dir }, { id: randomUUID(), source: 'pixel.png' }]) {
    await assert.rejects(images.resolve(payload), /invalid|unknown|saved/i);
  }
  const unsaved = service({ id: doc.id, path: null });
  await assert.rejects(unsaved.resolve({ id: doc.id, source: 'pixel.png' }), /saved/i);
  let lookedUp = false;
  const guarded = require('../electron/images.cjs').createImageService({ getDocument() {
    lookedUp = true;
    return doc;
  } });
  await assert.rejects(guarded.resolve({ id: {}, source: 'pixel.png' }), /invalid/i);
  assert.equal(lookedUp, false);
});
test('rejects traversal, encoded traversal, absolute paths and URL schemes', async t => {
  const { root, dir, doc } = await fixture(t);
  await fs.writeFile(path.join(root, 'outside.png'), PNG);
  await fs.writeFile(path.join(dir, 'pixel.png'), PNG);
  const images = service(doc);
  for (const source of [
    '../outside.png', '%2e%2e%2foutside.png', '%252e%252e%252foutside.png',
    'sub/../../outside.png', '..\\outside.png', '%2e%2e%5coutside.png',
    path.join(root, 'outside.png'), '/outside.png', '//server/share.png',
    'C:/outside.png', 'C:outside.png', '\\\\server\\share.png',
    'file:///outside.png', 'https://example.invalid/pixel.png', 'data:image/png;base64,AAAA',
    'pixel.png:secret', 'pixel.png%00', 'pixel.png?query', 'pixel.png#hash', '%zz',
  ]) {
    await assert.rejects(images.resolve({ id: doc.id, source }), /invalid|outside|relative/i, source);
  }
});
test('rejects realpath escapes through an image directory symlink', async t => {
  const { root, dir, doc } = await fixture(t);
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'pixel.png'), PNG);
  try { await fs.symlink(outside, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`OS cannot create symlinks: ${error.code}`); return; }
    throw error;
  }
  await assert.rejects(service(doc).resolve({ id: doc.id, source: 'linked/pixel.png' }), /outside|symlink/i);
});
test('rejects image-looking text, truncated signatures and SVG rather than exposing bytes', async t => {
  const { dir, doc } = await fixture(t);
  const images = service(doc);
  for (const [name, bytes] of [
    ['secret.png', Buffer.from('private API key: do not expose')],
    ['truncated.png', PNG.subarray(0, 8)],
    ['static.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')],
    ['active.svg', Buffer.from('<svg><script>alert(1)</script></svg>')],
  ]) {
    await fs.writeFile(path.join(dir, name), bytes);
    await assert.rejects(images.resolve({ id: doc.id, source: name }), /unsupported|signature|image/i);
  }
});
test('enforces the 20 MiB byte limit and rejects directories', async t => {
  const { dir, doc } = await fixture(t);
  const filename = path.join(dir, 'oversized.png');
  const handle = await fs.open(filename, 'w');
  try {
    await handle.write(PNG);
    await handle.truncate(20 * 1024 * 1024 + 1);
  } finally { await handle.close(); }
  assert.equal((await fs.stat(filename)).size, 20 * 1024 * 1024 + 1);
  await assert.rejects(service(doc).resolve({ id: doc.id, source: 'oversized.png' }), /20 MiB|limit/i);
  await fs.mkdir(path.join(dir, 'folder.png'));
  await assert.rejects(service(doc).resolve({ id: doc.id, source: 'folder.png' }), /regular file/i);
});
test('identifies raster types by signatures, not misleading filename extensions', async t => {
  const { dir, doc } = await fixture(t);
  // GIF is a real 1x1 fixture; the other short buffers exercise header recognition,
  // not browser decoding. PNG end-to-end byte fidelity is tested separately.
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([12, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(4)]);
  const bmp = Buffer.alloc(54);
  bmp.write('BM'); bmp.writeUInt32LE(54, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  const avif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypavif'), Buffer.alloc(4), Buffer.from('avifmif1')]);
  const images = service(doc);
  for (const [mime, bytes] of [['image/gif', gif], ['image/jpeg', jpeg], ['image/webp', webp], ['image/bmp', bmp], ['image/avif', avif]]) {
    await fs.writeFile(path.join(dir, 'misnamed.png'), bytes);
    const result = await images.resolve({ id: doc.id, source: 'misnamed.png' });
    assert.equal(result.mime, mime);
    assert.deepEqual(decoded(result), bytes);
  }
});
test('imports native-selected bytes into unique sibling assets without changing the source or existing files', async t => {
  const { root, dir, doc } = await fixture(t);
  const selected = path.join(root, 'selected image.png');
  await fs.writeFile(selected, PNG);
  const before = await fs.stat(selected);
  const assets = path.join(dir, 'My notes.assets');
  await fs.mkdir(assets);
  await fs.writeFile(path.join(assets, 'selected-image.png'), 'existing asset');
  const images = service(doc);
  assert.equal(typeof images.importImage, 'function');
  const first = await images.importImage({ id: doc.id }, async () => selected);
  const second = await images.importImage({ id: doc.id }, async () => selected);
  assert.notEqual(first.source, second.source);
  for (const result of [first, second]) {
    assert.match(result.source, /^My%20notes\.assets\/[^/]+\.png$/);
    assert.equal(result.source.includes('\\'), false);
    const copied = path.join(dir, decodeURIComponent(result.source));
    assert.deepEqual(await fs.readFile(copied), PNG);
    assert.deepEqual(decoded(await images.resolve({ id: doc.id, source: result.source })), PNG);
  }
  assert.deepEqual(await fs.readFile(selected), PNG);
  assert.equal((await fs.stat(selected)).mtimeMs, before.mtimeMs);
  assert.equal(await fs.readFile(path.join(assets, 'selected-image.png'), 'utf8'), 'existing asset');
  assert.equal((await fs.readdir(assets)).length, 3);
});
test('cancelled native selection returns null without creating assets or changing documents', async t => {
  const { dir, doc } = await fixture(t);
  let chosen = 0;
  assert.equal(await service(doc).importImage({ id: doc.id }, async () => { chosen++; return null; }), null);
  assert.equal(chosen, 1);
  assert.deepEqual(await fs.readdir(dir), ['My notes.md']);
  assert.equal(await fs.readFile(doc.path, 'utf8'), '# Notes');
});
test('import requires a valid saved capability and an absolute native picker result before writing', async t => {
  const { root, dir, doc } = await fixture(t);
  const selected = path.join(root, 'selected.png');
  await fs.writeFile(selected, PNG);
  const images = service(doc);
  for (const payload of [null, {}, { id: 42 }, { id: randomUUID() }, { id: doc.id, path: selected }]) {
    await assert.rejects(images.importImage(payload, () => assert.fail('Invalid request opened picker')), /invalid|unknown/i);
  }
  await assert.rejects(service({ id: doc.id, path: null }).importImage({ id: doc.id }, () => assert.fail('Unsaved request opened picker')), /saved/i);
  await assert.rejects(images.importImage({ id: doc.id }), /native|picker/i);
  for (const selectedPath of [42, '', path.relative(process.cwd(), selected)]) {
    await assert.rejects(images.importImage({ id: doc.id }, async () => selectedPath), /invalid|absolute/i);
  }
  assert.deepEqual(await fs.readdir(dir), ['My notes.md']);
});
test('refuses to write imports through a symlinked assets directory', async t => {
  const { root, dir, doc } = await fixture(t);
  const selected = path.join(root, 'selected.png');
  const outside = path.join(root, 'outside-assets');
  await fs.writeFile(selected, PNG);
  await fs.mkdir(outside);
  try { await fs.symlink(outside, path.join(dir, 'My notes.assets'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`OS cannot create symlinks: ${error.code}`); return; }
    throw error;
  }
  await assert.rejects(service(doc).importImage({ id: doc.id }, async () => selected), /symlink|outside|directory/i);
  assert.deepEqual(await fs.readdir(outside), []);
  assert.deepEqual(await fs.readFile(selected), PNG);
});
test('imported Markdown paths safely encode saved document names with hashes and parentheses', async t => {
  const { root, doc } = await fixture(t);
  const renamed = path.join(path.dirname(doc.path), '#Notes (draft)!.md');
  await fs.rename(doc.path, renamed);
  doc.path = renamed;
  const selected = path.join(root, 'image.png');
  await fs.writeFile(selected, PNG);
  const images = service(doc);
  const result = await images.importImage({ id: doc.id }, async () => selected);
  assert.match(result.source, /^%23Notes%20%28draft%29%21\.assets\//);
  assert.deepEqual(decoded(await images.resolve({ id: doc.id, source: result.source })), PNG);
});
