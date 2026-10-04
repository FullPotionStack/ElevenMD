import test from 'node:test'
import assert from 'node:assert/strict'
import { SourceHistory } from '../src/source-history.js'
test('source undo and redo stay independent per document after tab changes', () => {
  const a = new SourceHistory(''), b = new SourceHistory('')
  a.record('PRIVATE ALPHA', 0, 0, 'insertFromPaste', 1)
  b.record('PUBLIC BETA', 0, 0, 'insertFromPaste', 2)
  a.record('PRIVATE ALPHA edited', 13, 13, 'insertFromPaste', 3)
  assert.equal(a.undo().text, 'PRIVATE ALPHA')
  assert.equal(b.undo().text, '')
  assert.equal(a.text, 'PRIVATE ALPHA')
  assert.equal(b.redo().text, 'PUBLIC BETA')
})
test('typing coalesces but paste separates; new edits discard redo; large snapshots remain bounded', () => {
  const h = new SourceHistory('')
  h.record('a', 0, 0, 'insertText', 1); h.record('ab', 1, 1, 'insertText', 2)
  assert.equal(h.undo().text, '')
  h.record('new', 0, 0, 'insertFromPaste', 3)
  assert.equal(h.redo(), null)
  for (let i = 0; i < 120; i++) h.record(String(i), 0, 0, 'insertFromPaste', i + 10)
  assert.ok(h.past.length <= 100)
  const large = new SourceHistory('x'.repeat(12000000))
  large.record('y'.repeat(12000000), 0, 0, 'insertFromPaste', 1)
  assert.ok(large.past.reduce((n, v) => n + v.text.length, 0) <= 10000000)
})
