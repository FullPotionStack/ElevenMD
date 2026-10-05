# ElevenMD

Write Markdown and plain text in a desktop app for Windows, Linux, and macOS. Edit formatted documents, switch to the original Markdown source, or read a preview with tables, task lists, footnotes, and math.

![ElevenMD mark](public/elevenmd-mark.svg)

## Install

Choose your operating system and processor from [Releases](https://github.com/FullPotionStack/ElevenMD/releases/latest). `x64` is Intel/AMD 64-bit; `arm64` is ARM 64-bit, including Apple silicon. ElevenMD is an alpha without publisher-certified releases.

| Platform | Installer | Portable | How to run |
| --- | --- | --- | --- |
| Windows x64 | `ElevenMD-Setup-0.3.4.exe` | `ElevenMD-0.3.4-windows-x64-portable.zip` | Run the installer, or extract the entire ZIP and open `ElevenMD.exe`. |
| Linux x64 / arm64 | `ElevenMD-0.3.4-linux-<arch>.deb` | `ElevenMD-0.3.4-linux-<arch>-portable.tar.gz` | Install with `sudo apt install ./<filename>.deb`, or extract the archive and run `./elevenmd` inside its directory as a regular user. |
| macOS x64 / arm64 | `ElevenMD-0.3.4-mac-<arch>.dmg` | `ElevenMD-0.3.4-mac-<arch>-portable.zip` | Open the DMG and drag `ElevenMD.app` to Applications, or extract the ZIP and move the app where you prefer. |

Portable means you do not need an installer; it does not put drafts and preferences beside the executable. The app stores them in your platform's per-user application data directory. Keep the whole Linux/Windows runtime directory together.

- **Windows:** the unsigned installer may show an unknown-publisher warning. It creates a Start menu shortcut and offers optional desktop shortcuts, file registration, and an Explorer menu. It does not change existing default apps.
- **Linux:** the `.deb` targets Debian-compatible systems and resolves shared-library dependencies through APT. The portable archive also needs Electron's system libraries and permitted unprivileged user namespaces for Chromium sandboxing. Ubuntu/AppArmor policies may require administrator configuration; do not work around this with `--no-sandbox`. The Debian package supplies a root-owned setuid sandbox.
- **macOS:** builds are ad-hoc signed, not Apple Developer ID signed or notarized. Gatekeeper may block a downloaded app. Follow [Apple's manual approval instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) only if you trust the source; do not disable Gatekeeper system-wide. CI launch tests do not prove the quarantined first-download experience.

The Windows checksum file is `SHA256SUMS`; each Linux/macOS architecture has a separate `*-SHA256SUMS.txt` file. See [native build and verification details](docs/DISTRIBUTION.md).

## Writing and saving

- Use Formatted for ordinary Markdown, Source for exact syntax, and Preview for reading.
- Open `.md`, `.markdown`, and `.txt` files. Open and Save use native dialogs.
- Ctrl+N/O/S opens a new tab, opens a file, or saves. Ctrl+Shift+S is Save as; Ctrl+F/H is find/replace. These are currently Ctrl shortcuts on macOS too.
- Closing the app checkpoints all tabs, including unnamed drafts. Only Save or Save as writes to your actual document files.
- Edits made by another program trigger overwrite protection. Use Save as to keep both versions.
- Light, Dark, and Auto themes are available in the menu bar. Settings controls font size, source wrapping, spelling, and remote images.

Formatted edits normalize Markdown syntax. Advanced constructs that the formatted editor cannot preserve open in Source; conversion requires your approval. Private session storage is local plaintext, not an encrypted backup. Save important files separately.

## Updates

ElevenMD checks this repository's latest published release when it opens. You can also use **Help → Check updates**. An available update appears in the status bar; select it to read the release notes.

Checking contacts GitHub and exposes the normal network information a request carries, including your IP address. It sends no document text or diagnostic logs. On Windows, download and installation require your action. The updater verifies a SHA-256 checksum from the release before offering to run the installer, and checkpoints your tabs first. On Linux and macOS, the Updates panel opens the release page: choose the matching native download, close the app, and install or replace it manually. The app does not download or execute Windows installers on those platforms.

A checksum detects a damaged or mismatched download; it is not a code signature or protection against an attacker controlling this repository. Updating a source checkout does not update an installed app.

## Local diagnostics and privacy

Optional diagnostics are **off until you consent**. If enabled, they keep the last 200 meaningful actions for up to 7 days on your computer. They record action categories and outcomes, not document text, typing, clipboard contents, file names or paths, URLs, search strings, screenshots, credentials, or identifying machine/user information.

**Settings → Privacy & diagnostics** lets you inspect, clear, export, or disable and delete the local history. Logs are never uploaded. Built-in bug reporting is not available in this build. See [diagnostics details](docs/PRIVACY.md).

## Build from source

Install Node.js 24 or later, then run these commands on the target operating system:

```sh
git clone https://github.com/FullPotionStack/ElevenMD.git
cd ElevenMD
npm ci
npm run runtime:install
npm test
npm run test:ui
npm run build
npm start
```

The full legacy unit suite includes Windows-specific tests; native CI runs a selected platform-neutral lane plus packaging and packaged-launch tests. Package on a native machine matching the desired architecture:

| Target | Command | Additional tools |
| --- | --- | --- |
| Windows x64 | `npm run installer:win` | [Inno Setup 6](https://jrsoftware.org/isinfo.php); set `ISCC_PATH` for a nonstandard install. `npm run package:win` stages the portable runtime. |
| Linux x64 / arm64 | `npm run package:linux` | `dpkg-deb` and `tar`; produces `.deb`, `.tar.gz`, and checksums. |
| macOS x64 / arm64 | `npm run package:mac` | Xcode command-line tools and macOS `hdiutil`, `ditto`, `sips`, `iconutil`, `plutil`, `codesign`; produces `.dmg`, `.zip`, and checksums. |

## Fork distribution requirements

Before distributing a modified fork, you **MUST change the update destination to your own repository** in `electron/distribution.cjs`. Do not ship a fork that checks `FullPotionStack/ElevenMD` for updates. Set `installerPrefix` to your own installer asset prefix, and publish a matching `<prefix>-<version>.exe` plus `SHA256SUMS`.

Packaging refuses a distribution whose configured repository does not match its GitHub `origin`. This is a build safeguard against accidental upstream targeting, not a restriction added to the MIT license. Deliberately removing the safeguard cannot be prevented by open-source code.

Also use your own Windows installer AppId, product name, ProgIDs, and session-storage identity so your fork does not replace the official installation or share private drafts. Update your README/release links and `package.json` repository metadata. See [forking instructions](docs/FORKING.md).

## Known limits

The app supports UTF-8 (including BOM) and LF/CRLF line endings, with a 10 MiB document limit. Local raster images must stay within the document directory; SVG and absolute/parent-directory image paths are unsupported. Remote images require an opt-in preference. Web/mail links require confirmation before opening outside the app.

Printing, drag-and-drop file opening, recent files, other text encodings, and publisher-signed releases are not implemented. Native CI targets Ubuntu 24.04 and macOS 15 on both architectures; this is not certification for every distribution, macOS version, desktop environment, or Gatekeeper configuration. Session recovery has been tested across app restarts, not destructive power-loss scenarios.

## License

[MIT](LICENSE). Electron, Chromium, and bundled dependencies retain their own licenses; every distribution includes their notices.
