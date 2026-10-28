# ElevenMD

A Markdown and plain-text desktop editor for Windows, Linux, and macOS.

- Formatted editing, Markdown source, and preview with tables, task lists, footnotes, and math.
- Tabs, session recovery, find/replace, and light/dark themes.
- Disk-change detection, recoverable refresh, and conflict comparison.
- Local files and drafts. Optional diagnostics stay on your computer.

## Download

Version **0.3.13**.

| Platform | Installer | Portable |
| --- | --- | --- |
| Windows x64 | [EXE](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-Setup-0.3.13.exe) | [ZIP](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-windows-x64-portable.zip) |
| Linux x64 | [DEB](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-linux-x64.deb) | [tar.gz](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-linux-x64-portable.tar.gz) |
| Linux ARM64 | [DEB](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-linux-arm64.deb) | [tar.gz](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-linux-arm64-portable.tar.gz) |
| macOS Intel | [DMG](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-mac-x64.dmg) | [ZIP](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-mac-x64-portable.zip) |
| macOS Apple silicon | [DMG](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-mac-arm64.dmg) | [ZIP](https://github.com/FullPotionStack/ElevenMD/releases/download/v0.3.13/ElevenMD-0.3.13-mac-arm64-portable.zip) |

Alpha release. Windows builds are unsigned; macOS builds are not notarized. Your OS may show a security warning.

DEB packages are for Debian/Ubuntu. On Fedora, use the portable archive; see [Linux requirements](docs/DISTRIBUTION.md#fedora-source-setup-and-reproduction). Keep portable runtime folders intact; drafts and preferences live in your user app-data directory.

[Release notes and checksums](https://github.com/FullPotionStack/ElevenMD/releases/tag/v0.3.13)

## Before you write

Closing the window restores your tabs next time; only Save writes to document files. Draft recovery is local plaintext, not a backup.

Formatted edits normalize Markdown. Use Source to preserve exact syntax. Files must be UTF-8, up to 10 MiB.

Clean tabs refresh from disk; local edits trigger a comparison instead. Deleted files stay recoverable and show File missing until you locate, save elsewhere, or explicitly recreate them.

Update checks contact GitHub, without document text or logs. Approved updates use a separate helper. Windows updates download a verified bundle and replace app files directly; Setup is only for initial installation. DEB updates request system authorization. [Update requirements](docs/DISTRIBUTION.md#update-bundles-0310-development) · [Privacy](docs/PRIVACY.md).

## Build from source

Requires a security-patched Node.js release (22.23.4+ on 22.x or 24.22.1+ on 24.x) and your platform's [runtime libraries](docs/DISTRIBUTION.md).

```sh
git clone https://github.com/FullPotionStack/ElevenMD.git
cd ElevenMD
npm ci
npm run runtime:install
npm run build
npm start
```

Tests:

```sh
npm test
npx playwright install chromium
npm run test:ui
```

[Packaging](docs/DISTRIBUTION.md) · [Forking](docs/FORKING.md) · [MIT license](LICENSE)
