import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateTarget, stageNative, run, writeChecksums, assertNewOutputs } from './cross-platform/shared.mjs'
import { buildDebTree } from './cross-platform/linux.mjs'
import { createBrandAssets } from './generate-brand-assets.mjs'

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/package-linux.mjs\nNative Linux x64/arm64 only; first run npm ci && npm run build. Produces .deb and portable .tar.gz in release/. Requires dpkg-deb and tar. Existing versioned staging directories are never overwritten.')
  process.exit(0)
}
if (process.argv.length > 2) throw new Error('Unknown argument. Use --help.')
validateTarget('linux', process.arch)
const root = path.resolve(import.meta.dirname, '..')
const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: root, capture: true })
const stage = await stageNative({ root, runtime: path.join(root, 'node_modules/electron/dist'), platform: 'linux', arch: process.arch, origin })
const { out, pkg, distribution } = stage
const release = path.join(root, 'release')
const prefix = distribution.installerPrefix.replace(/-Setup$/, '')
const portable = path.join(release, `${prefix}-${pkg.version}-linux-${process.arch}-portable.tar.gz`)
const deb = path.join(release, `${prefix}-${pkg.version}-linux-${process.arch}.deb`)
const sums = path.join(release, `${prefix}-${pkg.version}-linux-${process.arch}-SHA256SUMS.txt`)
await assertNewOutputs([deb, portable, sums])
await chmod(path.join(out, 'elevenmd'), 0o755)
// Portable builds use Chromium's unprivileged-user-namespace sandbox. No --no-sandbox launcher.
await chmod(path.join(out, 'chrome-sandbox'), 0o755)
await writeFile(path.join(out, 'elevenmd.png'), createBrandAssets().previews.at(-1))
await writeFile(path.join(out, 'START-HERE.txt'), `ElevenMD ${pkg.version} — Linux ${process.arch}\n\nPortable: extract the whole archive, then run ./elevenmd as a regular user.\nKeep all runtime files together. System Electron/Chromium shared libraries are required.\nThe portable sandbox needs permitted unprivileged user namespaces; some distributions\n(including Ubuntu with restrictive AppArmor policies) need administrator configuration.\nDo not disable the sandbox. The Debian installer supplies a root-owned setuid sandbox.\nInstaller: sudo apt install ./"${path.basename(deb)}"\nDrafts and preferences use the standard per-user application data directory, not this folder.\nClosing the window preserves private drafts; only Save / Save As writes document files.\n`)
const tree = await buildDebTree({ root, out, pkg, arch: process.arch, repository: distribution.repository })
run('dpkg-deb', ['--root-owner-group', '--build', tree, deb])
run('dpkg-deb', ['--info', deb])
run('tar', ['-czf', portable, '-C', release, path.basename(out)])
run('tar', ['-tzf', portable], { capture: true })
await writeChecksums([deb, portable], sums)
console.log(`Linux artifacts:\n${deb}\n${portable}\n${sums}`)
