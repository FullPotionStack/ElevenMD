import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { testScratch } from './helpers/electron-harness.mjs';
const require = createRequire(import.meta.url);
let createExportService;
try { ({ createExportService } = require('../electron/export-file.cjs')); } catch {}

test('export refuses an RTF alias that resolves to a Markdown file', async t => {
  const base = await testScratch(); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'elevenmd-alias-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const markdown = path.join(dir, 'original.md'), alias = path.join(dir, 'alias.rtf');
  await fs.writeFile(markdown, 'Markdown must survive');
  const service = createExportService({ io: { ...fs, realpath: async filename => filename === alias ? markdown : fs.realpath(filename) } });
  await assert.rejects(service.exportFile({ format: 'rtf', data: '{\\rtf1 new}', name: 'alias.rtf' }, async () => alias), /format|extension/i);
  assert.equal(await fs.readFile(markdown, 'utf8'), 'Markdown must survive');
});

test('export writes only to a native-selected destination and does not modify the source', async t => {
  assert.equal(typeof createExportService, 'function', 'export file service must exist');
  const base = await testScratch(); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'elevenmd-export-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.md'), target = path.join(dir, 'export.rtf');
  await fs.writeFile(source, 'original');
  const service = createExportService();
  const result = await service.exportFile({ format: 'rtf', data: '{\\rtf1 hello}', name: 'export.rtf' }, async () => target);
  assert.equal(result.name, 'export.rtf');
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.equal(await fs.readFile(target, 'utf8'), '{\\rtf1 hello}');
  assert.equal(await service.exportFile({ format: 'rtf', data: '{\\rtf1 changed}', name: 'export.rtf' }, async () => null), null);
  assert.equal(await fs.readFile(target, 'utf8'), '{\\rtf1 hello}');
});
