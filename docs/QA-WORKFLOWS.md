# Writing-workflow QA

## Release 0.3.2

The final local verification passed **93 unit tests and 86 Chromium UI tests**, including 40 writing-workflow scenarios. Packaged Windows checks passed for files, sessions, images, executable branding, diagnostics and the installer lifecycle. This is a bounded acceptance run, not a claim that every possible document or device works.

Browser tests use real typing, selections, toolbar/menu commands, HTML dialogs, tabs and Preview DOM. They simulate native dialogs at the desktop bridge. Separate Electron tests exercise actual IPC and disk bytes. A desktop UI run used the real Windows Save and Save As dialogs and verified the resulting files. Tests use isolated profiles and synthetic documents only.

## User scenarios exercised

| Scenario | Coverage |
| --- | --- |
| Quick draft | Type, dirty marker, new/switch/close tabs, browser reload and complete packaged process restart |
| README | All headings, paragraph, marks, quote, code/fences, lists, rule, links, Source/Formatted/Preview |
| Tasks | Six task/bullet/numbered conversions, checking, nested indent/outdent, empty next task and Preview parity |
| Plain text | Literal punctuation, Unicode, tabs and blank lines; exact Source save payload |
| Advanced Markdown | Source guard, explicit conversion, metadata, footnotes, math, definition lists; unchanged source before edits |
| Tables | Cell input; every exposed row/column command; column alignment; source/Preview parity; delete and undo |
| Links/images | Insert/cancel, unsafe scheme rejection, logical paths, local raster resolution/copy, remote-image opt-in |
| Find/replace | Literal case-insensitive search, wrap, one/all, literal replacements, no match, undo/redo, Close/Escape focus |
| Edit history | Independent formatted/source histories; persistent Select all selection |
| Files | Native IPC, Save As/cancel, BOM/CRLF bytes, external-change refusal, duplicates, dirty-tab Save/Discard/Cancel |
| Quit/recovery | Prompt-free full-session checkpoint; named and unnamed buffers survive process restart without overwriting files |
| Preferences | Themes, font/size/wrap/spelling, zoom, persistence, selected mode/tab and keyboard menus |
| Layout/accessibility | 640×440 window, named dialogs, labels, dismissal/focus, primary-action contrast in both themes |
| Support/privacy | Startup/manual checks, pending state, explicit update choices, opt-in/inspect/export/revoke logs, storage warnings, reviewed report and late-operation dismissal |
| Installer | Seven exact embedded icon sizes, native product metadata, friendly registration, optional shortcuts/verbs, installed .md/.markdown/.txt launches, defaults unchanged, uninstall cleanup |

## Bugs found and fixed

- Column alignment changed one cell; it now applies to every row and survives safe Preview sanitization.
- Clicking cell padding could leave a table command targeting the header; the clicked cell now determines the target.
- Formatted Select all lost selection on deferred focus; typing now replaces the selection.
- Source undo history disappeared on tab changes; each document owns bounded ephemeral history. Replace operations form separate undo steps.
- Escape dropped menu focus and did not close Find; both paths restore expected focus.
- Writing/settings dialogs lacked accessible names; visible headings now name them.
- Primary buttons had insufficient text contrast; ink-plum backgrounds replace coral/white treatment.

Security review found quoted credentials evading report redaction, unhandled diagnostic failures, oversized redaction output and late dialogs replacing newer UI. Regression tests now cover those fixes. Review is still essential: redaction cannot recognize every secret or personal detail a user writes.

## Commands and evidence

```sh
npm test
npm run test:ui
npm run installer:win
npm run test:packaged
npm run test:session
npm run test:restart
npm run test:images
npm run test:regressions
npm run test:support
npm run test:installer
npm run test:native
npm audit
```

The dependency audit found no vulnerabilities. The build emits a bundle-size warning; the app still builds and runs.

`test:native` needs desktop interaction with two Save dialogs. Other Electron tests control decisions but exercise real handlers/files. `test:installer` installs/uninstalls in a temporary directory and temporarily registers Windows integration; run it before your personal installation, or reinstall afterward. Do not point tests at user data.

Use a separate `PLAYWRIGHT_PORT` for concurrent browser runs. The strict-port server belongs to its runner. Screenshots and exploratory logs remain local, not application telemetry.

## Gaps

No screen-reader, high-DPI, IME, destructive power-loss, machine-reboot or Linux/macOS certification. Not every clipboard operation, Markdown nesting, huge document or font/zoom boundary was exercised.

PE resources, friendly Windows registration, installed launches and actual Save-dialog icons were verified. A direct Open with chooser probe returned a Windows shell error, so that visible chooser itself is not certified by the probe.

Real public release download/update verification follows publication. Unit tests cover trusted hosts, checksums, cancellation, tampering, bounds and serialization; simulated responses alone do not prove the public path.

Releases remain unsigned. SHA-256 verifies release-relative integrity, not independent publisher authenticity.
