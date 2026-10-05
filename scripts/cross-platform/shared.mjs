// Manual prebuilt-runtime layout: https://www.electronjs.org/docs/latest/tutorial/application-distribution
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, cp, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validateDistribution } from '../distribution-policy.mjs'

export function run(tool, args, { cwd, capture = false } = {}) {
  const result = spawnSync(tool, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${tool} exited with ${result.status ?? result.signal}: ${result.stderr || ''}`)
  return result.stdout?.trim() || ''
}

export async function assertNewOutputs(files) {
  for (const file of files) {
    try { await access(file) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    throw new Error(`Output already exists: ${file}. Refusing to overwrite a previous artifact.`)
  }
}

export async function writeChecksums(files, destination) {
  const lines = []
  for (const file of files) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    lines.push(`${hash.digest('hex')}  ${path.basename(file)}\n`)
  }
  await writeFile(destination, lines.join(''), { flag: 'wx' })
}

export async function stageNative({ root, runtime, platform, arch, origin }) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a numeric release version.')
  const distribution = createRequire(import.meta.url)(path.join(root, 'electron/distribution.cjs'))
  validateDistribution(distribution, origin)
  const version = (await readFile(path.join(runtime, 'version'), 'utf8')).trim().replace(/^v/, '')
  if (version !== pkg.devDependencies.electron) throw new Error('Installed Electron version does not match package.json.')
  const isMac = platform === 'darwin'
  const executable = path.join(runtime, isMac ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
  const handle = await open(executable, 'r')
  let header
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(64), 0, 64, 0)
    header = buffer.subarray(0, bytesRead)
  } finally { await handle.close() }
  const correctArch = isMac
    ? header.length >= 8 && header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === (arch === 'x64' ? 0x01000007 : 0x0100000c)
    : header.length >= 20 && header.subarray(0, 4).equals(Buffer.from('\x7fELF')) && header[4] === 2 && header[5] === 1 && header.readUInt16LE(18) === (arch === 'x64' ? 62 : 183)
  if (!correctArch) throw new Error('Electron runtime platform/architecture does not match target.')
  for (const file of ['dist/index.html', 'electron/main.cjs', 'LICENSE']) await access(path.join(root, file))
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  let notices = 'ElevenMD — third-party notices\n\nElectron and Chromium notices are included with this distribution.\n'
  for (const [relative, info] of Object.entries(lock.packages)) {
    if (!relative || info.dev) continue
    const dir = path.join(root, relative)
    const names = (await readdir(dir)).filter(name => /^(license|copying|notice)([.-]|$)/i.test(name)).sort()
    if (!names.length) throw new Error(`Missing license text for ${relative}`)
    notices += `\n${'='.repeat(72)}\n${relative} ${info.version} (${info.license})\n`
    for (const name of names) notices += `\n${name}\n${await readFile(path.join(dir, name), 'utf8')}\n`
  }
  const out = path.join(root, 'release', `${isMac ? 'mac' : 'linux'}-${pkg.version}-${arch}-unpacked`)
  await mkdir(path.dirname(out), { recursive: true })
  try { await mkdir(out) } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${out}. Move or explicitly remove that generated directory before rebuilding.`)
    throw error
  }
  await cp(runtime, out, { recursive: true, verbatimSymlinks: true })
  let bundle
  if (isMac) {
    bundle = path.join(out, 'ElevenMD.app')
    await rename(path.join(out, 'Electron.app'), bundle)
  } else await rename(path.join(out, 'electron'), path.join(out, 'elevenmd'))
  const resources = isMac ? path.join(bundle, 'Contents/Resources') : path.join(out, 'resources')
  await rm(path.join(resources, 'default_app.asar'), { force: true })
  const app = path.join(resources, 'app')
  await mkdir(app, { recursive: true })
  for (const name of ['electron', 'dist']) await cp(path.join(root, name), path.join(app, name), { recursive: true })
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'ElevenMD', version: pkg.version, main: 'electron/main.cjs', private: true }, null, 2))
  await cp(path.join(root, 'LICENSE'), path.join(out, 'ELEVENMD-LICENSE.txt'))
  await writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notices)
  // On macOS these must travel INSIDE the .app, not only beside it in the staging folder.
  if (isMac) for (const name of ['LICENSE', 'LICENSES.chromium.html', 'ELEVENMD-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) {
    await cp(path.join(out, name), path.join(resources, name))
  }
  return { out, app, bundle, pkg, distribution }
}
export function validateTarget(platform, arch, host = process) {
  if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported packaging target.')
  if (host.platform !== platform) throw new Error(`Packaging ${platform} requires a native ${platform} host.`)
  if (host.arch !== arch) throw new Error('Packaging requires a matching native architecture; install Electron on that runner.')
}
