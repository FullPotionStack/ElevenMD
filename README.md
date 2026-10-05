# ElevenMD

Write Markdown and plain text in a Windows desktop app. Edit formatted documents, switch to the original Markdown source, or read a preview with tables, task lists, footnotes, and math.

![ElevenMD mark](public/elevenmd-mark.svg)

## Install

Download the Windows installer from [Releases](https://github.com/FullPotionStack/ElevenMD/releases/latest). ElevenMD is currently an **unsigned alpha**; Windows may show an unknown-publisher warning.

The installer creates a Start menu shortcut. You can choose a desktop shortcut, file registration, and an "Open with ElevenMD" Explorer menu. It does not change your current Markdown or text-file defaults. Choose those yourself in Windows Settings → Default apps.

The portable build requires its entire extracted directory, not just `ElevenMD.exe`.

## Writing and saving

- Use Formatted for ordinary Markdown, Source for exact syntax, and Preview for reading.
- Open `.md`, `.markdown`, and `.txt` files. Save uses native Windows dialogs.
- Ctrl+N/O/S opens a new tab, opens a file, or saves. Ctrl+Shift+S is Save as; Ctrl+F/H is find/replace.
- Closing the app checkpoints all tabs, including unnamed drafts. Only Save or Save as writes to your actual document files.
- Edits made by another program trigger overwrite protection. Use Save as to keep both versions.
- Light, Dark, and Auto themes are available in the menu bar. Settings controls font size, source wrapping, spelling, and remote images.

Formatted edits normalize Markdown syntax. Advanced constructs that the formatted editor cannot preserve open in Source; conversion requires your approval. Private session storage is local plaintext, not an encrypted backup. Save important files separately.

## Updates

ElevenMD checks this repository's latest published release when it opens. You can also use **Help → Check updates**. An available update appears in the status bar; select it to read the release notes.

Checking contacts GitHub and exposes the normal network information a request carries, including your IP address. It sends no document text or diagnostic logs. Download and installation require your action. The updater verifies a SHA-256 checksum from the release before offering to run the installer, and checkpoints your tabs first.

A checksum detects a damaged or mismatched download; it is not a code signature or protection against an attacker controlling this repository. GitHub release installers, rather than `git clone`, update the installed Windows app.

## Local diagnostics and privacy

Optional diagnostics are **off until you consent**. If enabled, they keep the last 200 meaningful actions for up to 7 days on your computer. They record action categories and outcomes, not document text, typing, clipboard contents, file names or paths, URLs, search strings, screenshots, credentials, or identifying machine/user information.

**Settings → Privacy & diagnostics** lets you inspect, clear, export, or disable and delete the local history. Logs are never uploaded. Built-in bug reporting is not available in this build. See [diagnostics details](docs/PRIVACY.md).

## Build from source

On Windows, install Node.js and [Inno Setup 6](https://jrsoftware.org/isinfo.php), then:

```sh
git clone https://github.com/FullPotionStack/ElevenMD.git
cd ElevenMD
npm ci
npm test
npm run test:ui
npm run build
npm start
```

`npm run package:win` produces the portable runtime. `npm run installer:win` builds a versioned installer. Set `ISCC_PATH` if the Inno compiler is outside its usual installation location. Packaging tools and notices are included in the build process.

## Fork distribution requirements

Before distributing a modified fork, you **MUST change the update destination to your own repository** in `electron/distribution.cjs`. Do not ship a fork that checks `FullPotionStack/ElevenMD` for updates. Set `installerPrefix` to your own installer asset prefix, and publish a matching `<prefix>-<version>.exe` plus `SHA256SUMS`.

Windows packaging refuses a distribution whose configured repository does not match its GitHub `origin`. This is a build safeguard against accidental upstream targeting, not a restriction added to the MIT license. Deliberately removing the safeguard cannot be prevented by open-source code.

Also use your own Windows installer AppId, product name, ProgIDs, and session-storage identity so your fork does not replace the official installation or share private drafts. Update your README/release links and `package.json` repository metadata. See [forking instructions](docs/FORKING.md).

## Known limits

The app supports UTF-8 (including BOM) and LF/CRLF line endings, with a 10 MiB document limit. Local raster images must stay within the document directory; SVG and absolute/parent-directory image paths are unsupported. Remote images require an opt-in preference. Web/mail links require confirmation before opening outside the app.

Printing, drag-and-drop file opening, recent files, other text encodings, and signed releases are not implemented. Linux and macOS have not been tested. Session recovery has been tested across app restarts, not destructive power-loss scenarios.

## License

[MIT](LICENSE). Electron, Chromium, and bundled dependencies retain their own licenses; the Windows distribution includes their notices.
