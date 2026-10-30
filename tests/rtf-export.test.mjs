import test from 'node:test';
import assert from 'node:assert/strict';

const { markdownToRtf } = await import('../src/rtf-export.js').catch(() => ({ markdownToRtf: undefined }));

test('exports formatted Markdown as RTF with escaped text and Unicode', () => {
  assert.equal(typeof markdownToRtf, 'function', 'RTF export must be implemented');
  const result = markdownToRtf('# Hello\n\n**bold** and *italic* and ~~struck~~\n\nOlá {world} \\ 😀');
  assert.match(result.rtf, /^\{\\rtf1/);
  assert.match(result.rtf, /\\b\s+bold/);
  assert.match(result.rtf, /\\i\s+italic/);
  assert.match(result.rtf, /\\strike\s+struck/);
  assert.match(result.rtf, /Ol\\u225\?/);
  assert.match(result.rtf, /\\\{world\\\}/);
  assert.match(result.rtf, /\\u-10179\?\\u-8704\?/);
});

test('exports a Markdown table as a real RTF table with cell formatting and alignments', () => {
  const result = markdownToRtf('| Item | Count |\n| :--- | ---: |\n| **Pens** | 2 |\n| Paper | 5 |\n\nAfter table');
  assert.equal(result.warnings.some(warning => /table/i.test(warning)), false);
  assert.equal((result.rtf.match(/\\trowd/g) || []).length, 3);
  assert.equal((result.rtf.match(/\\cellx\d+/g) || []).length, 6);
  assert.equal((result.rtf.match(/\\cell(?:\s|\\)/g) || []).length, 6);
  assert.equal((result.rtf.match(/\\row(?:\s|\\)/g) || []).length, 3);
  assert.match(result.rtf, /\\qr/);
  assert.match(result.rtf, /\\b\s+Pens/);
  assert.match(result.rtf, /Paper/);
  assert.match(result.rtf, /After table/);
});

test('retains link destinations as visible text in exported RTF', () => {
  const result = markdownToRtf('[Read](https://example.com)');
  assert.match(result.rtf, /Read/);
  assert.match(result.rtf, /https:\/\/example\.com/);
});
