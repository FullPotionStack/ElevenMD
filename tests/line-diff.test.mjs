import test from 'node:test'
import assert from 'node:assert/strict'
import { lineDiff } from '../src/line-diff.js'
test('line diff marks additions/removals and bounds pathological work', () => {
  const result = lineDiff('one\ntwo\n', 'one\nthree\n')
  assert.equal(result.truncated, false)
  assert.ok(result.lines.some(x => x.kind === 'remove' && x.text === 'two'))
  assert.ok(result.lines.some(x => x.kind === 'add' && x.text === 'three'))
  const large = lineDiff('x\n'.repeat(20000), 'y\n'.repeat(20000))
  assert.equal(large.truncated, true); assert.ok(large.lines.length <= 4000)
})
