# Changes

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
