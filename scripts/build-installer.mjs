import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { validateDistribution } from './distribution-policy.mjs'

if (process.platform !== 'win32') throw new Error('The Windows installer must be compiled on Windows.')
const root = process.cwd()
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const distribution = createRequire(import.meta.url)('../electron/distribution.cjs')
validateDistribution(distribution, execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim())
const script = path.join(root, 'installer', 'ElevenMD.iss')
const release = path.join(root, 'release', `win-${pkg.version}-unpacked`)
await access(path.join(release, 'ElevenMD.exe'))
const candidates = [
  process.env.ISCC_PATH,
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
].filter(Boolean)
let compiler
for (const candidate of candidates) {
  try { await access(candidate); compiler = candidate; break } catch { /* try next known location */ }
}
if (!compiler) throw new Error('Inno Setup 6 compiler not found. Install JRSoftware.InnoSetup or set ISCC_PATH to ISCC.exe.')
const result = spawnSync(compiler, [`/DAppVersion=${pkg.version}`, `/DInstallerPrefix=${distribution.installerPrefix}`, script], { cwd: root, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
const output = path.join(root, 'release', `${distribution.installerPrefix}-${pkg.version}.exe`)
await access(output)
console.log(`Windows installer created: ${output}`)
