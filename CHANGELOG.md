# Changes

## 0.3.3

- Release notes now display formatted Markdown headings, lists, emphasis, tables and code instead of raw source text.
- The release-note renderer disables HTML, links and image loading and sanitizes its output. The separate GitHub release-page button remains available.
- Release notes support keyboard scrolling and light/dark themes; diagnostic and report previews remain exact plain text.

## 0.3.2

- Fixed Windows update installation being aborted when Restart Manager tried to close unrelated security software. Setup no longer closes or restarts other applications; the updater checkpoints and closes ElevenMD itself.
- Update launches explicitly disallow automatic operating-system restarts.

## 0.3.1

- Fixed real GitHub update checks: compressed HTTP response lengths are no longer compared with decoded JSON lengths. Decoded streaming bounds and installer SHA-256 checks remain enforced.
- Added a single build-owned distribution configuration for update and bug-report repositories.
- Fork packaging now refuses to use an upstream destination that differs from its GitHub origin. Forks must retarget their own release assets and reports.
- Kept SVG line endings deterministic in fresh Windows checkouts.

## 0.3.0

### Fixed

- Windows executable branding now uses ElevenMD's product name and icon instead of Electron's metadata.
- File registration gives ElevenMD a friendly name in Windows Open with.
- Explorer context-menu icons use the correct registry value.
- Table commands target the clicked cell; column alignment agrees between Formatted and Preview.
- Source undo/redo history stays with its tab, and replacement actions have separate undo steps.
- Select all retains the editor selection; Escape restores menu focus and closes Find.
- Dialogs have accessible names; primary action text has stronger contrast in both themes.
- Diagnostic failures show storage/deletion warnings; late operations do not replace dismissed dialogs.
- Bug-report redaction handles quoted credentials and validates the resulting draft size.

### Added

- A redesigned 11/M mark, with matching window, executable, and installer assets.
- Startup release checks, Help → Check updates, and a small status-bar update notification.
- Release notes, user-requested verified downloads, and installer-based updates that checkpoint open tabs before installation.
- Help → Report a bug, with a reviewed public GitHub issue draft.
- Opt-in local sanitized diagnostics: a bounded action history, inspection, export, clearing, and deletion when disabled.
- Public source, MIT license, and Windows release downloads.

### Limits

This remains an unsigned Windows alpha. Update checks require a connection to GitHub. Updates install only when you choose them; file defaults stay under your control. Diagnostics do not record document contents and cannot replay every content-dependent problem.
