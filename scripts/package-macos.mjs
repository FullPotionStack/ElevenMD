import { cp, mkdir, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateTarget, stageNative, run, writeChecksums, assertNewOutputs } from './cross-platform/shared.mjs'
import { macBundleInfo } from './cross-platform/macos.mjs'
import { createBrandAssets, iconSizes } from './generate-brand-assets.mjs'

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/package-macos.mjs\nNative macOS x64/arm64 only; first run npm ci && npm run build. Produces .dmg and portable .zip in release/. Uses Xcode command-line tools, hdiutil, ditto, sips, iconutil, plutil and codesign. Builds are ad-hoc signed, NOT Developer ID signed or notarized.')
  process.exit(0)
}
if (process.argv.length > 2) throw new Error('Unknown argument. Use --help.')
validateTarget('darwin', process.arch)
const root = path.resolve(import.meta.dirname, '..')
const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: root, capture: true })
const { out, bundle, pkg, distribution } = await stageNative({ root, runtime: path.join(root, 'node_modules/electron/dist'), platform: 'darwin', arch: process.arch, origin })
const contents = path.join(bundle, 'Contents')
async function updatePlist(file, helper) {
  const original = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { capture: true }))
  await writeFile(file, JSON.stringify(macBundleInfo(original, pkg.version, helper, distribution.repository)))
  run('/usr/bin/plutil', ['-convert', 'xml1', file])
}
await updatePlist(path.join(contents, 'Info.plist'))
await rename(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/ElevenMD'))
const frameworks = path.join(contents, 'Frameworks')
for (const name of await readdir(frameworks)) {
  const helper = /^Electron Helper(?: \((.+)\))?\.app$/.exec(name)
  if (helper) await updatePlist(path.join(frameworks, name, 'Contents/Info.plist'), helper[1] || '')
}
const iconset = path.join(out, 'elevenmd.iconset')
await mkdir(iconset)
const assets = createBrandAssets()
const source = path.join(out, 'elevenmd-256.png')
await writeFile(source, assets.previews.at(-1))
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  const pixels = size * scale
  const filename = path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)
  const index = iconSizes.indexOf(pixels)
  if (index >= 0) await writeFile(filename, assets.previews[index])
  else run('/usr/bin/sips', ['-z', String(pixels), String(pixels), source, '--out', filename], { capture: true })
}
run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(contents, 'Resources/elevenmd.icns')])
const instructions = `ElevenMD ${pkg.version} — macOS ${process.arch}\n\nDMG: drag ElevenMD.app to Applications. ZIP: extract and move ElevenMD.app wherever you prefer.\nThis build is ad-hoc signed only; no Apple Developer ID certificate or notarization is supplied.\nGatekeeper may block downloaded builds; use Apple's documented manual approval process only if you trust the source.\nDo not disable Gatekeeper system-wide. A public signed/notarized release needs Apple credentials and additional release configuration.\nDrafts and preferences live in the standard per-user application data directory, not in the app bundle.\nClosing the window preserves private drafts; only Save / Save As writes document files.\n`
await writeFile(path.join(contents, 'Resources/START-HERE.txt'), instructions)
// Rebranding invalidates Electron's original signature. ARM64 requires at least ad-hoc signing.
// This is NOT a substitute for Developer ID signing + notarization:
// https://www.electronjs.org/docs/latest/tutorial/code-signing
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', bundle])
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle])
const release = path.join(root, 'release')
const prefix = distribution.installerPrefix.replace(/-Setup$/, '')
const zip = path.join(release, `${prefix}-${pkg.version}-mac-${process.arch}-portable.zip`)
const dmg = path.join(release, `${prefix}-${pkg.version}-mac-${process.arch}.dmg`)
const sums = path.join(release, `${prefix}-${pkg.version}-mac-${process.arch}-SHA256SUMS.txt`)
await assertNewOutputs([dmg, zip, sums])
const image = path.join(release, `mac-${pkg.version}-${process.arch}-dmg`)
await mkdir(image)
await cp(bundle, path.join(image, 'ElevenMD.app'), { recursive: true, verbatimSymlinks: true })
await symlink('/Applications', path.join(image, 'Applications'))
await writeFile(path.join(image, 'START-HERE.txt'), instructions)
run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip])
run('/usr/bin/unzip', ['-tq', zip])
run('/usr/bin/hdiutil', ['create', '-volname', 'ElevenMD', '-srcfolder', image, '-format', 'UDZO', '-fs', 'HFS+', dmg])
run('/usr/bin/hdiutil', ['verify', dmg])
await writeChecksums([dmg, zip], sums)
console.log(`macOS artifacts (ad-hoc signed; not notarized):\n${dmg}\n${zip}\n${sums}`)
