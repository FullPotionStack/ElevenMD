import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const service = () => require('../electron/bug-report.cjs')

test('bug reports redact obvious personal data and secrets from explicitly supplied text', () => {
  const { prepareReport } = service()
  const report = prepareReport({ title: 'Cannot open C:\\Users\\private\\note.md', body: 'Email name@example.com and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 then https://example.com/private?token=abcdef', includeDiagnostics: false })
  for (const secret of ['private', 'name@example.com', 'ghp_', 'example.com']) assert.equal(JSON.stringify(report).includes(secret), false)
  assert.match(report.body, /redacted/)
})

test('quoted JSON, YAML and assignment secrets are redacted as complete values', () => {
  const { prepareReport } = service()
  for (const text of ['{"token":"SYNTHETIC_ONLY_123456789"}', 'password = "SYNTHETIC ONLY 123456789"', "'api_key': 'SYNTHETIC ONLY 123456789'", 'secret: "escaped \\"SYNTHETIC\\" value"']) {
    const report = prepareReport({ title: 'Credentials in an error', body: text, includeDiagnostics: false })
    assert.doesNotMatch(report.body, /SYNTHETIC|ONLY|value/)
    assert.match(report.body, /redacted credential/)
  }
});

test('redaction expansion cannot exceed the outgoing report contract', () => {
  const { prepareReport } = service()
  assert.throws(() => prepareReport({ title: 'A report', body: 'http://x '.repeat(600), includeDiagnostics: false }), /shorten/i)
});

test('issue draft is fixed to project and requires bounded reviewed text', () => {
  const { issueURL, prepareReport } = service()
  const report = prepareReport({ title: 'Save defect', body: 'Steps: save a new note.', includeDiagnostics: false })
  const url = new URL(issueURL(report))
  assert.equal(url.origin, 'https://github.com')
  assert.equal(url.pathname, '/FullPotionStack/ElevenMD/issues/new')
  assert.equal(url.searchParams.get('body'), report.body)
  assert.throws(() => prepareReport({ title: 'x', body: 'a'.repeat(10000), includeDiagnostics: false }), /invalid/i)
  assert.throws(() => prepareReport({ title: 'x', body: 'y', includeDiagnostics: false, path: '/private' }), /invalid/i)
})
