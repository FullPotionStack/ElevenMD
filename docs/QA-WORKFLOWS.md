# Writing-workflow QA

## Release 0.3.3

93 unit tests and 88 Chromium UI tests passed. The release-note regression failed on the old plain-text display and passed with semantic headings, lists, emphasis, code and tables. Tests also verify no active HTML, hyperlinks or image requests, formatting after download, keyboard scrolling and narrow light/dark layouts. Packaged file and support/privacy checks passed.

The normal-user installation was upgraded to 0.3.3 through a normal checkpointed close. Its update dialog was checked and screenshotted in light/dark using the actual published GitHub release response, delivered through an explicitly controlled test transport to the real installed update service and IPC. The anonymous live API returned HTTP 403 with zero remaining quota after repeated QA requests; that live check is blocked, not a passing result. The optional `--recorded-release <json>` lane in `tests/desktop-release-notes.mjs` labels this distinction and modifies only harness-owned handlers, never installed files.

## Release 0.3.2

The final local verification passed **93 unit tests and 86 Chromium UI tests**, including 40 writing-workflow scenarios. Packaged Windows checks passed for files, sessions, images, executable branding, diagnostics and the installer lifecycle. This is a bounded acceptance run, not a claim that every possible document or device works.

Browser tests use real typing, selections, toolbar/menu commands, HTML dialogs, tabs and Preview DOM. They simulate native dialogs at the desktop bridge. Separate Electron tests exercise actual IPC and disk bytes. A separate 0.3.0 desktop UI run used the real Windows Save and Save As dialogs and verified the resulting files; 0.3.2 file handling was rechecked through installed Electron IPC. Tests use isolated profiles and synthetic documents only.

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

## Published update verification

The published 0.3.2 release was tested against the real anonymous GitHub API and its real installer asset. The installed main/renderer path verified checksums, respected native cancellation, checkpointed named and unnamed edited tabs, launched the real installer, and recovered both buffers after replacement/relaunch without changing the original file bytes. The latest installed updater/support modules matched the source exactly.

The upgrade fixture changed only its scratch package version to simulate an older release and controlled native confirmation/silent installer decisions. It deliberately omitted the new launcher’s `/NOCLOSEAPPLICATIONS` flag to prove the new installer’s default also fixes legacy callers. This is not a claim that an unchanged 0.3.0 updater can perform the compressed-response fix itself; users of 0.3.0 should install the latest release manually.

An immediate post-publication download initially failed closed; a subsequent run and a repeat with no debugging instrumentation completed the full update path. The initial network/delivery failure was not diagnosed, so this does not certify transient network reliability. Unit tests separately cover trusted hosts, checksums, cancellation, tampering, bounds and serialization. The final normal-user 0.3.2 installation also passed file IPC and support/privacy checks in isolated profiles.

Releases remain unsigned. SHA-256 verifies release-relative integrity, not independent publisher authenticity.
