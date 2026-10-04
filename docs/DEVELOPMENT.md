# ElevenMD — local development notes

Windows-first alpha, version 0.3.0. A local-first Markdown and plain-text editor with formatted, source, and preview modes.

## Run

Open `release/win-0.3.0-unpacked/ElevenMD.exe` for the portable build. For the installable version, run `release/ElevenMD-Setup-0.3.0.exe`. The installer creates Start menu shortcuts; a desktop shortcut is optional. It can add “Open with ElevenMD” to `.md` and `.txt` Explorer context menus and register ElevenMD as an available app for Markdown and text files. Those file/context-menu options are explicit installer choices. Windows protects the user's default-app choice, so the installer never silently takes over `.md` or `.txt`; select ElevenMD in Windows Settings → Default apps, or choose the optional installer task to open that page after installation.

The app is unsigned. It has no account, document cloud service, AI integration, or automatic telemetry upload. Startup and manual update checks contact GitHub; download and installation require user approval. Diagnostics remain off until explicit consent and stay local unless the user shares a reviewed report or export. For source:

```sh
npm ci
npm run build
npm start
```

The renderer can also be developed with `npm run dev`; a renderer preview in a browser cannot open/save desktop files. To use Vite in Electron, set `NOTEPAD_DEV_URL=http://127.0.0.1:5173` before `npm start`.

## Current behavior

- Editable formatted Markdown, an exact-source textarea, and a sanitized extended Preview.
- Tabs, native open/save dialogs, prompt-free window quit, CLI file opening. Explicitly closing an unsaved tab still offers Save/Discard/Cancel.
- Headings 1–6, emphasis, strike, inline/fenced code, lists, checkboxes, quotes, rules, editable tables/alignment, links, and images. Preview adds footnotes, math, definition lists and displayed front matter.
- Ctrl+N/O/S, Ctrl+Shift+S, Ctrl+W, Ctrl+Tab; Ctrl+F/H uses source-mode find/replace.
- Light, Dark and Auto (system) themes are available directly in the menu bar and persist across restarts. Font, size, source wrapping and zoom are in Settings.
- The active document tab and active Formatted/Source/Preview mode have a brighter background and an accent marker.
- Changing between checkbox, bullet and numbered lists converts the list instead of nesting incompatible list types. Empty checkboxes and checked-task styling agree between Formatted and Preview.
- Independent ephemeral formatted and source undo histories per tab. Source/format changes reset the formatted undo history when the source has changed. Source history bounds retained snapshots; neither history enters diagnostics.
- Automatic private session checkpoints and persistent preferences. All tabs, including clean named files and unnamed buffers, return after app exit/relaunch. Edits are kept separately in `session.json` under Electron userData; Settings shows the exact location. Quit flushes the session and closes without asking to save. Only explicit Save/Save As writes to the target document. Stored named-file capabilities retain external-change protection.
- File-service UTF-8 BOM and LF/CRLF handling, a 10 MiB file limit, same-directory temporary writes, and external-change hash checks.

## Boundaries

Formatted edits normalize Markdown. Opening or toggling a supported document does not itself replace its source with serialized output. Recognized front matter, raw HTML/comments, footnotes, math blocks, and directives open in source mode; formatted editing requires an explicit warning acknowledgment. This detection is conservative, not complete support for every Markdown dialect. Local PNG/JPEG/GIF/WebP/BMP/AVIF images resolve within the document directory. Insert image copies native-selected pictures into a sibling assets folder. SVG and parent-directory/absolute image references are not supported. HTTPS images require the remote-image preference. Web/mail links open only after confirmation; Ctrl+click follows a link while formatted editing. See MARKDOWN-FEATURES.md for dialect limits.

Several native-editor behaviors are not yet included: printing, drag-and-drop opening, a recent-files list, configurable encodings, and a signed release. Linux/macOS portability is architectural only; neither platform has been tested. Session storage is durable local plaintext, not an external backup. It survives ordinary OS restarts, but no machine reboot/power-loss test has been performed. Session checkpoint failure leaves the window open with an error rather than silently losing text. Writes are checked immediately before rename but cannot eliminate every external-process race.

If a file changed outside the app, save your changes under a different name. To display the changed disk version, close its existing tab and reopen it; opening the same path while its tab is still present selects that tab.

## Verification commands

```sh
npm test
npm run test:ui
npm run test:desktop
npm run package:win
npm run installer:win
npm run test:packaged
node tests/desktop-restart.mjs
npm run test:session
npm audit
```

Desktop test scripts use the explicit Hermes scratch directory on Windows. They isolate userData and operate only on temporary fixtures. Save As/confirmation responses are controlled in the automated harness; their real IPC handlers and actual filesystem are exercised. A separate desktop UI check opened the real Windows Open dialog and loaded the included example.

Packaging follows Electron's prebuilt-runtime distribution layout. Runtime dependency license texts are assembled into `THIRD-PARTY-NOTICES.txt`; Electron/Chromium notices remain adjacent to the executable. The approved public repository is https://github.com/FullPotionStack/ElevenMD. Publish the versioned installer and a SHA256SUMS asset with each stable release. The updater compares the latest stable release against app.getVersion().
