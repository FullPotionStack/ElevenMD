# Cross-platform updater implementation plan

> **For agentic workers:** Use superpowers:executing-plans for native implementation, with isolated parallel work only where file ownership is disjoint. Steps use checkbox syntax.

**Goal:** Add verified native update bundles and a separate staged updater that preserves sessions, safely replaces portable runtimes/macOS bundles, and routes installed copies through their existing installer/package manager.

**Architecture:** A bounded gzip bundle carries a manifest and streamed file bodies. The app verifies and extracts it before exit, stages its own independent Electron helper, then hands over an authenticated loopback lifecycle connection. The helper journals replacement, restarts the editor, and requires a restored-session acknowledgement before accepting success.

**Tech stack:** Existing Electron, Node built-ins, Vite, node:test, Playwright; OS-native Inno, apt/pkexec and macOS codesign adapters.

**Spec:** docs/superpowers/specs/2026-10-17-cross-platform-updater-design.md

## Global constraints

- No source checkout downloads, new required system runtimes, renderer paths or arbitrary update scripts.
- Existing repository/HTTPS validation, explicit install consent, sandboxing and latest session checkpoint remain mandatory.
- Whole bundles first; manifests schema 1/helper protocol 1; SHA-256; OS/architecture/install route bound.
- Unknown/read-only/package-managed targets fail closed or use explicit native/manual routes.
- Preserve document files, userData, unrelated portable files and platform registrations.
- Do not label source-only work as a released or installed fix; no owner installation without separate permission.
- Owner delegates routine design and execution choices; proceed natively without further yes/no gates. Reserve questions for critical choices or real blockers.

## Review focus

- A startup after failed replacement must remain recoverable even if the helper was interrupted between renames (Task 3).
- Framework links must work without allowing an archive path to escape staging (Task 1).
- A second update or stale job must not modify a different installation (Task 3).
- Downloads may finish while a user is still typing; checkpoint the newest session (Task 4).
- Restart success must follow session restoration, not merely process creation (Task 4).

## Task 1: Validated update bundles

Files: create `electron/update-bundle.cjs`, `tests/update-bundle.test.mjs`, `scripts/update-bundles.mjs`.

Interfaces: `validateManifest(value, { platform, arch, version, repository }) -> manifest`; `createBundle({ root, destination, version, repository, platform, arch, route, executable }) -> { manifest, sha256, size }`; `extractBundle({ filename, destination, expected }) -> manifest`; `verifyTree(root, manifest) -> void`. Export via CommonJS from the Electron module and import through createRequire in build scripts.

Manifest: `{ schema:1, protocol:1, version, repository, platform, arch, route, executable, entries:[{ path, type:'file', size, sha256, mode } | { path, type:'symlink', target }] }`. Paths are slash-separated relative paths. Bundle is gzip of uint32BE manifest byte length, UTF-8 manifest, then concatenated regular-file bodies in inventory order. Bound manifest to 2 MiB, entries to 10000, compressed to 512 MiB, expanded to 2 GiB, individual file to 256 MiB. Reject trailing data, duplicates, case-fold collisions, ancestor link/file collisions, executable outside inventory and escaping links. Symlinks may only reference listed internal entries and are created last.

- [ ] Add real scratch roundtrip plus corrupt digest, traversal, case collision, link escape, truncated/trailing stream, unsupported target/version, bounds and permissions tests; run and observe RED.
- [ ] Implement validation, deterministic inventory, bounded streaming creation/extraction and tree verification without external archive libraries.
- [ ] Run `node --test tests/update-bundle.test.mjs`; require all pass.

## Task 2: Packaging and eligible release assets

Files: modify `scripts/package-windows.mjs`, `scripts/package-linux.mjs`, `scripts/package-macos.mjs`, `scripts/cross-platform/linux.mjs`; create packaging tests beside bundle tests.

Interfaces: consume Task 1 creator. Emit `ElevenMD-VERSION-PLATFORM-ARCH-update.bundle.gz` plus matching `.json` descriptor containing manifest, bundle asset name/size/SHA-256. Use `darwin` in schema and `mac` in public filename. Route markers are build-owned files, not inferred from writability: portable/mac bundle markers in application resources, DEB marker explicitly overrides portable marker in DEB tree. Installed Windows retains trusted Inno metadata detection.

- [ ] Add failing packaging fixtures proving manifest/markers, immutable version binding, executable inventory, native helper inclusion and unchanged macOS signatures (bundle inventory happens after signing).
- [ ] Emit bundle/descriptor after complete branded native staging, before publication; preserve previous assets. Add update assets to checksum manifests and workflow uploads/verification.
- [ ] Run fixture tests and Windows packaging; Linux/macOS execution stays tied to native CI, never inferred from Windows fixtures.

## Task 3: Transactional replacement and helper process

Files: create `electron/updater/transaction.cjs`, `electron/updater/main.cjs`, `electron/updater/preload.cjs`, `electron/updater/index.html`, `electron/update-handoff.cjs`, `tests/update-transaction.test.mjs`, `tests/update-handoff.test.mjs`.

Interfaces: `applyUpdate({ target, staged, manifest, jobDir, onProgress, fault }) -> transaction`; `rollbackUpdate(jobDir)`, `commitUpdate(jobDir)`; `prepareHandoff({ execPath, userData, staged, manifest, parentPid, ... }) -> { launch(), dispose() }`. Data-only jobs bind canonical target, staged tree, manifest, token and protocol. Helper uses an authenticated local socket to prove readiness while parent remains connected; replacement starts only after parent disconnect plus exact-parent exit confirmation. No renderer install paths.

- [ ] Add failing scratch tests for owned-file replacement, unrelated-file preservation, symlink/junction targets, interruption before/after each journal boundary, existing backups, lock contention, rollback and idempotent commit. Test startup handshake rejection and no quit on failed readiness.
- [ ] Implement journal writes with flush and same-filesystem backups; verify tree before replacement. For full macOS bundle swap preserve every signed byte/link/mode. Keep durable recovery information until restart acknowledgement.
- [ ] Stage a full private copy of the old runtime, launch its dedicated helper entry without modifying a signed bundle; pass the updater JS entry as the Electron app entry. The helper has isolated userData and a sandboxed local progress window. Block navigation, remote resources, permissions, popups and arbitrary IPC.
- [ ] Implement platform-native wait and backend adapters with bounded timeouts; package installs use fixed executable/argument arrays, no shell and no unattended elevation. Do not terminate unrelated processes.
- [ ] Run transaction/handshake tests and a real isolated helper launch, not mocks alone.

## Task 4: App service and restored-session handshake

Files: modify `electron/updates.cjs`, `electron/support.cjs`, `electron/main.cjs`, `src/support-ui.js`; add `electron/update-target.cjs`, `tests/update-target.test.mjs`, integration tests in `tests/updates.test.mjs` and `tests/ui/update-progress.spec.js`.

Interfaces: route resolver derives OS/arch/path/package markers from main-owned runtime. Legacy releases retain existing fallback. Modern releases select only an exact matching bounded descriptor, verify compressed hash, extract inventory, prepare helper, then confirm/checkpoint/launch. Restart acknowledgement comes only after renderer session readiness through fixed authenticated main IPC.

- [ ] Write failing tests for modern Linux/mac update availability, missing/wrong assets, manual reasons, cancellation, preflight failure, edits during download, and old-release compatibility.
- [ ] Integrate staged bundle state with existing serialized service and progress. Extend state without exposing local paths. Freeze new edits only for final checkpoint/quit; no data loss window between checkpoint and exit.
- [ ] Add main-owned one-use restart acknowledgement following actual session restoration; rollback if absent. Startup housekeeping only acts on authenticated owned jobs after helper exit.
- [ ] Run unit/UI suites and production build; confirm legacy tests still pass or update their assertions to explicit legacy manifests rather than weakening platform checks.

## Task 5: Native acceptance, docs and review

Files: add `tests/desktop-updater.mjs`; modify `.github/workflows/native-distributions.yml`, `.github/workflows/fedora-source.yml`, add Windows CI lane; update `docs/DISTRIBUTION.md`, concise README behavior, changelog, version/lockfile.

- [ ] Exercise real staged helper, whole runtime replacement, restart acknowledgement and same private session in scratch. Add corrupt payload, held runtime, missed acknowledgement and interrupted-journal cases. Keep owner installation/registrations untouched.
- [ ] Wire native x64/arm64 Linux/macOS CI to real update/restart scenarios and signature checks; use disposable DEB/Windows installed environments for system registrations and elevation lanes.
- [ ] Run `npm test`, `npm run test:ui`, `npm run build`, packaging fixtures and applicable desktop checks. Record exact native limitations; never claim unexecuted platform coverage.
- [ ] Review the entire diff once independently, resolve critical findings, rerun affected tests. Document release asset ordering and helper migration. Version bump before shipping; do not overwrite 0.3.9 artifacts with different bytes.
- [ ] Commit/push/publish/install only within authorized delivery scope; report each state separately and verify remote writes by readback.
