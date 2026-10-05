import { chmod, cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const desktopEntry = `[Desktop Entry]
Type=Application
Name=ElevenMD
Comment=Local-first Markdown and plain-text editor
Exec=/usr/bin/elevenmd %F
Icon=elevenmd
Terminal=false
Categories=Office;TextEditor;
MimeType=text/markdown;text/plain;
StartupWMClass=eleven-md
`

export async function buildDebTree({ root, out, pkg, arch, repository }) {
  const tree = path.join(root, 'release', `linux-${pkg.version}-${arch}-deb`)
  await mkdir(path.dirname(tree), { recursive: true })
  await mkdir(tree) // Refuse to overwrite a previous build.
  for (const dir of ['DEBIAN', 'opt', 'usr/bin', 'usr/share/applications', 'usr/share/icons/hicolor/256x256/apps']) await mkdir(path.join(tree, dir), { recursive: true })
  const runtime = path.join(tree, 'opt/elevenmd')
  await cp(out, runtime, { recursive: true, verbatimSymlinks: true })
  // dpkg-deb --root-owner-group supplies root ownership; retain Chromium's sandbox.
  await chmod(path.join(runtime, 'elevenmd'), 0o755)
  await chmod(path.join(runtime, 'chrome-sandbox'), 0o4755)
  await writeFile(path.join(tree, 'usr/bin/elevenmd'), '#!/bin/sh\nexec /opt/elevenmd/elevenmd "$@"\n', { mode: 0o755 })
  await writeFile(path.join(tree, 'usr/share/applications/elevenmd.desktop'), desktopEntry)
  await cp(path.join(out, 'elevenmd.png'), path.join(tree, 'usr/share/icons/hicolor/256x256/apps/elevenmd.png'))
  const dependencies = ['libc6', 'libnss3', 'libnspr4', 'libatk1.0-0t64 | libatk1.0-0', 'libatk-bridge2.0-0t64 | libatk-bridge2.0-0', 'libatspi2.0-0t64 | libatspi2.0-0', 'libcups2t64 | libcups2', 'libdrm2', 'libdbus-1-3', 'libx11-6', 'libxcb1', 'libxcomposite1', 'libxdamage1', 'libxext6', 'libxfixes3', 'libxrandr2', 'libgbm1', 'libxkbcommon0', 'libpango-1.0-0', 'libcairo2', 'libasound2t64 | libasound2', 'libgtk-3-0t64 | libgtk-3-0', 'xdg-utils']
  await writeFile(path.join(tree, 'DEBIAN/control'), `Package: elevenmd\nVersion: ${pkg.version}\nSection: editors\nPriority: optional\nArchitecture: ${arch === 'x64' ? 'amd64' : 'arm64'}\nMaintainer: ElevenMD contributors <noreply@github.com>\nHomepage: https://github.com/${repository}\nDepends: ${dependencies.join(', ')}\nDescription: Local-first Markdown and plain-text editor\n Markdown, source, and preview modes powered by Electron.\n`)
  return tree
}
