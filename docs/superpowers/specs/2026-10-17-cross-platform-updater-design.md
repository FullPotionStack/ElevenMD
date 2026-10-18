# Cross-platform updates

Status: approved; implementation and native validation are on `feat/cross-platform-updater`. No release or owner installation is implied.

## Goal and agreed flow

The owner approved a separate updater: clicking Update downloads a built release, preserves tabs, closes ElevenMD, replaces the application, and reopens it. The updater itself must also be replaceable. Use GitHub Releases, not raw files from main. Keep progress visible and portable copies portable.

Success means real replacement and restart on the supported platform/architecture, with the same session and unchanged document files. Source edits, passing unit tests, published assets, and the owner's installed application are separate delivery gates.

## Architecture decision

Use complete, verified release bundles for the first implementation. Do not implement changed-file downloads yet.

Reuse Electron for the separate updater process. Before quitting, stage a private disposable copy of the current runtime with a dedicated updater entry point. The helper executes outside the installation being replaced, so it can replace the main executable and the installed updater code. It must not require system Node.js, Python, Rust, Go, or a shell script interpreter on the user's computer.

Trade-off: copying a runtime consumes additional disk space and startup time. A new native helper would be smaller but adds a build toolchain and native UI lifecycle; live per-file patching is smaller to download but complicates consistency and recovery. The runtime-copy approach is the selected initial design.

The normal application and helper share a versioned data-only handoff protocol. Never execute commands or scripts supplied by a release manifest. The helper has a sandboxed local progress window with context isolation, no remote content, fixed IPC, and no document access.

## Platform routes

| Installation | Replacement route |
| --- | --- |
| Windows portable x64 | Helper replaces only manifest-owned application files after the exact parent exits; preserve unrelated files and create no shortcuts, registry entries or uninstaller. |
| Windows installed x64 | Separate progress helper coordinates the existing verified Inno update backend, preserving installation/uninstall metadata and the trusted target directory. No setup wizard. |
| macOS x64/arm64 | Helper replaces the complete built `.app` bundle, preserving permissions, framework symlinks and signatures. Never patch signed bundle internals. |
| Linux portable x64/arm64 | Helper replaces the manifest-owned runtime in the same user-writable directory, preserving permissions and unrelated files. |
| Debian/Ubuntu DEB | Helper invokes the native package installation path with explicit OS authorization, using fixed arguments to `pkexec` and the system `apt-get install` for the verified local DEB. Never directly replace package-owned files. |

Installed Windows keeps its existing backend instead of introducing a second uninstaller/registry implementation. The helper is the consistent user experience, not a promise to eliminate every native package format.

DEB packaging writes an explicit package-managed marker. Unknown system-managed installations, unsupported architectures, missing authorization tools, read-only targets, and macOS apps launched from a mounted DMG stay on a clearly explained manual-update route. Do not guess that any writable Linux directory is portable. Future RPM/Flatpak/Snap distributions require their own package-manager routes; they are not covered by the portable backend.

No administrator escalation for portable replacement. For macOS, this iteration requires a writable installed bundle and parent directory; otherwise show the manual route before closing. Current ad-hoc signing remains ad-hoc signing, not Developer ID signing or notarization.

## Release contract and trust

Add a bounded schema-versioned update manifest to each release. Bind it to the exact release version, repository, OS, architecture, installation route, required helper protocol, asset basename, byte length, SHA-256, and bounded installed-file inventory. Each inventory entry has a safe relative path, type, mode and digest or constrained symlink target. Embed build source SHA for traceability.

Reuse the existing literal repository, HTTPS allowlist, bounded streaming, stable-version comparison, serialized operations and main-owned zero-argument IPC. Never accept renderer-supplied targets, executable paths, URLs or install commands.

Reject absolute/traversing paths, duplicates, case collisions on applicable filesystems, unexpected entry types, escaping links, archive bombs, unsupported protocols, mismatched versions/architectures, and missing or inconsistent inventories. Preserve required internal macOS framework links without permitting writes outside staging. Revalidate the staged files before installation and again in the helper before activation.

Use GitHub HTTPS and release hashes as the initial trust model, matching the existing updater. A hash hosted beside an asset does not independently authenticate a compromised repository. Adding signed update metadata requires a separately approved signing-key lifecycle; do not claim this design already provides it.

Publish all required target assets before a release is update-eligible. Missing target assets must never offer Install or close the app. Old releases without manifests retain the existing Windows installer/manual-platform fallback. Previously published assets and tags are not overwritten.

## Handoff and lifecycle

1. Check: resolve only the matching supported route; render inert release notes.
2. Download and verify: stream into private app-owned staging while the editor stays usable; report bytes and verification progress.
3. Prepare: extract safely, validate the full inventory, stage the independent helper, check available disk space and target permissions, and acquire an installation-scoped exclusive update lock.
4. Confirm: obtain renderer approval and main-owned native confirmation. Checkpoint the latest session, including edits made during download. Do not write document targets.
5. Launch: hand the helper an exclusive private job file containing validated data, a random handshake token and exact installation identity. Receive a readiness acknowledgement before quitting. Process creation alone is not readiness.
6. Wait: helper validates the job and source/target identity and waits for the exact editor process to exit. On Windows hold the process handle; on Unix bind the identity to process start information and the authenticated parent handoff. A reused PID or timeout must not permit writes. Remaining file locks cause safe failure, never termination of unrelated processes.
7. Replace: apply the chosen platform backend with visible progress. Keep the old application or an app-owned backup until successful activation. Keep userData and document files outside replacement scope.
8. Restart: launch the new application with the same trusted userData identity and a one-use success token. Wait for its main-owned acknowledgement after session restoration and window readiness; spawning it is not success.
9. Commit: acknowledge success, release the update lock, and clean only owned staging/backup data after the helper exits.

The next normal startup can clean stale completed jobs or finish bounded updater-file housekeeping only after confirming the helper has exited. It must not execute arbitrary pending instructions. Each release supplies updated helper code, so neither the main executable nor updater is frozen forever.

## Failure and rollback

Before app exit: any download, verification, preparation, authorization preflight, checkpoint or helper-readiness failure leaves the editor open and unchanged. Cancel keeps the current session.

For portable runtime and macOS bundle replacement, maintain a flushed transaction journal recording owned files/paths and backup state before destructive steps. Recover interrupted replacement on the next helper or application launch. Same-filesystem rename is used where possible, but a multi-step directory or file replacement is not described as globally atomic. Restore the previous app on failed replacement or missing restart acknowledgement; do not erase newly checkpointed drafts.

A post-install smoke failure must not automatically downgrade userData schemas. This release must preserve backward-readable session storage; future incompatible migrations need explicit rollback design.

For Inno/DEB backends, use their own installation semantics and report failures honestly. Do not claim the portable journal makes a package-manager transaction atomic or guarantees automatic package rollback. Preserve the verified package and recovery instructions if authorization is cancelled or the package manager reports failure. No app-owned registry/shortcut changes outside the installed Windows backend.

## Integration points

- `electron/updates.cjs`: platform/architecture assets, manifest validation, streaming and staging state.
- `electron/update-launcher.cjs`: existing installed-Windows adapter plus explicit route dispatch.
- `electron/support.cjs`: confirmation, checkpoint, authenticated helper readiness and quit.
- New focused helper modules: job protocol, transaction journal, replacement backends and progress window/preload.
- `scripts/package-windows.mjs`, `scripts/cross-platform/shared.mjs`, Linux/macOS packaging: helper entry, inventories, markers and update manifests.
- CI: include helper sources in workflow triggers, add native update/restart tests and a Windows lane; retain sandboxing and existing packaging tests.
- README: concise supported update behavior; technical and recovery details belong in `docs/DISTRIBUTION.md`.

## Acceptance evidence

- Unit tests: manifest/protocol rejection; safe extraction; wrong OS/architecture; redirect/size/digest failures; cancellation; latest checkpoint; readiness failure; duplicate jobs; PID reuse; held locks; permission/disk failures; interrupted journal recovery; rollback; helper replacement and cleanup containment.
- UI tests: download/verification/install progress, Cancel/error states, manual-route explanation and Settings close/reopen; no untrusted renderer paths or remote updater content.
- Windows isolated packaged tests: real portable replacement including executable and helper, restart/session recovery, unchanged originals and Windows registrations; installed route tested on a disposable user/VM rather than overwriting the owner's registrations.
- Linux x64/arm64 CI: real portable replacement/restart; real DEB upgrade and cancelled/failed authorization in disposable runners. Fedora userspace test exercises the portable route; this does not certify every distro or SELinux/GPU configuration.
- macOS x64/arm64 CI: real full-bundle replacement/restart, valid signatures/framework links, session recovery, and permission/DMG rejection. Distinguish this from notarized or quarantined first-download acceptance.
- Failure injection: kill at each journal boundary; corrupt one staged payload; suppress restart acknowledgement; leave updater running during startup cleanup. Verify the previous app remains recoverable and no documents or unrelated files are deleted.
- Final gates: full unit/UI/build suites, native replacement evidence for every advertised target, immutable matching release assets and readback, explicit version bump, and separately authorized owner installation with session backup.

## Scope exclusions

Changed-file/delta downloads, universal Linux compatibility, package repositories, RPM/Flatpak/Snap backends, publisher-signing credentials, unattended elevation, and owner installation are not implicitly included. Do not advertise non-Windows automatic updating until its native end-to-end lane passes.
