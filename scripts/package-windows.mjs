import { cp, mkdir, readFile, readdir, rename, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { validateDistribution } from './distribution-policy.mjs'
import assert from 'node:assert/strict'
import { brandWindowsExecutable } from './windows-branding.mjs'
import { createBrandAssets } from './generate-brand-assets.mjs'

if (process.platform !== 'win32') throw new Error('This packaging script targets Windows; use a Windows host.')
const root = path.resolve(import.meta.dirname, '..')
if (process.argv.includes('--test-branding')) {
  // Scratch PE only: no build, release deletion, install, or registry writes.
  const result = spawnSync(process.execPath, ['--test', 'tests/windows-branding.test.mjs', 'tests/brand-assets.test.mjs', 'tests/windows-packaging.test.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
if (process.argv.length > 2) throw new Error('Unknown packaging argument. Use --test-branding for scratch-only verification.')
const distribution = createRequire(import.meta.url)('../electron/distribution.cjs')
let origin
try { origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { throw new Error('Packaging requires a GitHub checkout with git origin. Forks must configure their own repository in electron/distribution.cjs.') }
validateDistribution(distribution, origin)
const assets = createBrandAssets()
assert.equal(await readFile(path.join(root, 'public', 'elevenmd-mark.svg'), 'utf8'), assets.svg, 'SVG drift: run node scripts/generate-brand-assets.mjs')
assert.deepEqual(await readFile(path.join(root, 'public', 'elevenmd.ico')), assets.ico, 'ICO drift: run node scripts/generate-brand-assets.mjs')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a numeric release version.')
const out = path.join(root, 'release', `win-${pkg.version}-unpacked`)
const app = path.join(out, 'resources', 'app')
// Restrict deletion to the generated distribution directory, never project source.
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(path.join(root, 'node_modules', 'electron', 'dist'), out, { recursive: true })
await rename(path.join(out, 'electron.exe'), path.join(out, 'ElevenMD.exe'))
await brandWindowsExecutable(path.join(out, 'ElevenMD.exe'), path.join(root, 'public', 'elevenmd.ico'), pkg.version)
await cp(path.join(root, 'examples'), path.join(out, 'examples'), { recursive: true })
await mkdir(path.join(out, 'docs'), { recursive: true })
for (const name of ['DEVELOPMENT.md', 'MARKDOWN-FEATURES.md', 'PRIVACY.md', 'FORKING.md']) await cp(path.join(root, 'docs', name), path.join(out, 'docs', name))
for (const name of ['README.md', 'CHANGELOG.md']) await cp(path.join(root, name), path.join(out, name))
await cp(path.join(root, 'LICENSE'), path.join(out, 'ELEVENMD-LICENSE.txt'))
await mkdir(app, { recursive: true })
for (const dir of ['electron', 'dist']) await cp(path.join(root, dir), path.join(app, dir), { recursive: true })
await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'ElevenMD', version: pkg.version, main: 'electron/main.cjs', private: true }, null, 2))
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
let notices = 'ElevenMD — third-party notices\n\nElectron and Chromium notices are also included beside the executable.\n\n'
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!relative || info.dev) continue
  const dir = path.join(root, relative)
  const files = (await readdir(dir)).filter(n => /^(license|copying|notice)([.-]|$)/i.test(n))
  if (!files.length) throw new Error(`Missing license text for ${relative}`)
  notices += `\n${'='.repeat(72)}\n${relative.replace(/^node_modules\//, '')} ${info.version} (${info.license})\n`
  for (const file of files) notices += `\n${file}\n${await readFile(path.join(dir, file), 'utf8')}\n`
}
notices += `\n${'='.repeat(72)}\nElectron\n${await readFile(path.join(root, 'node_modules', 'electron', 'LICENSE'), 'utf8')}\n`
await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices)
await writeFile(path.join(out, 'START-HERE.txt'), `ElevenMD — Windows alpha ${pkg.version}\r\n\r\nDouble-click ElevenMD.exe. Keep this entire folder together.\r\nNo installation, account, or network connection is needed.\r\nClosing the window keeps all tabs in a private session without asking to save.\r\nOnly Save / Save As writes the Markdown files. Settings shows the session path.\r\nRemote HTTPS images require opt-in; spelling checks start off.\r\nYou can also pass a .md or .txt file as a command-line argument.\r\n\r\nThis is an unsigned local alpha.\r\nFormatted edits normalize Markdown syntax. Use Source for advanced Markdown.\r\nDraft recovery is best-effort and is not a substitute for saving files.\r\n`)
console.log(`Windows app packaged: ${path.join(out, 'ElevenMD.exe')}`)
