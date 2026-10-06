import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Fedora CI exercises the full source path and sandboxed native launches as a regular user', async () => {
  const workflow = await readFile(new URL('../.github/workflows/fedora-source.yml', import.meta.url), 'utf8')
  const script = await readFile(new URL('../scripts/ci/fedora.sh', import.meta.url), 'utf8')
  assert.match(workflow, /fedora:43/)
  for (const version of ['22.23.3', '24.21.0']) assert.ok(workflow.includes(version))
  for (const command of ['npm ci', 'npm run runtime:install', 'npm test', 'npx playwright install chromium', 'npm run test:ui', 'npm run package:linux', 'npm run test:packaging:smoke']) assert.ok(script.includes(command), command)
  assert.match(script, /runuser -u tester/)
  assert.match(script, /xvfb-run/)
  assert.doesNotMatch(script, /--no-sandbox/)
  assert.match(script, /ldd/)
})
