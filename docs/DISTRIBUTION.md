# Native distributions

Build on the target operating system and architecture with Node.js 24, `npm ci`, and the relevant command:

| Host | Command | Output in `release/` |
| --- | --- | --- |
| Linux x64 / arm64 | `npm run package:linux` | Debian package, portable tar.gz, architecture-specific SHA256SUMS.txt |
| macOS x64 / arm64 | `npm run package:mac` | DMG, portable ZIP, architecture-specific SHA256SUMS.txt |
| Windows x64 | `npm run installer:win` | Inno installer and staged portable runtime |

Linux uses `dpkg-deb` and `tar`. macOS uses Xcode command-line tools and the system `hdiutil`, `ditto`, `plutil`, `sips`, `iconutil`, and `codesign`. Cross-compilation is intentionally unsupported. The packager checks the installed Electron version and binary architecture, refuses existing versioned output directories, and validates the distribution repository against GitHub origin. Move previous generated output aside explicitly before rebuilding.

Every build carries application, dependency, Electron, and Chromium notices. macOS notices travel inside the `.app`; ZIP/DMG copy tools preserve framework symlinks.

## GitHub Actions

`.github/workflows/native-distributions.yml` builds on Ubuntu 24.04 x64/arm64 and macOS 15 Intel/Apple silicon runners. Each lane runs packaging fixtures, selected platform-neutral application unit tests, native packaging, checksum verification, and actual packaged launches of both distribution formats. Linux installs the Debian package on the disposable runner and extracts the tar.gz; macOS extracts the ZIP and copies the app from a mounted DMG into runner scratch. All smoke launches use isolated per-test application data.

```sh
gh workflow run native-distributions.yml --ref main -f release_tag=v0.3.4
```

A manual release dispatch builds the immutable commit selected by `main`, not the old release tag. `release_tag` must exactly equal `v` plus `package.json` version, and attachment dispatches must use main. The workflow does not move or rewrite the existing tag. The build source SHA is recorded in the job summary. This permits adding native assets to a release whose original tag predates native packaging. Source changes and platform-specific updater guards are therefore in the recorded main commit, not necessarily in the original tag or existing Windows binary.

A blank `release_tag` uploads CI artifacts only. A published-release event builds its event commit. Attachment requires every native build lane to succeed, verifies the merged checksum manifests, uploads without overwriting existing release assets, and reads the exact release back to check the expected names. If an upload partially succeeds, inspect the release before retrying; do not overwrite already-published binaries blindly.

## Security and test limits

Chromium sandboxing stays enabled. The Debian package installs a root-owned 4755 `chrome-sandbox`. Linux portable builds require unprivileged user namespaces and system Electron libraries. The CI runner relaxes Ubuntu's AppArmor namespace restriction solely for its disposable launch tests; users may need distribution-specific administrator configuration. The shipped launcher never adds `--no-sandbox`.

macOS builds are ad-hoc signed only. Ad-hoc verification is not Developer ID signing, notarization, or a Gatekeeper acceptance test. Downloaded/quarantined apps can require manual approval. Do not disable Gatekeeper system-wide. Public notarized releases require Apple credentials and additional release configuration.

The smoke test proves native packaged startup, version and architecture, renderer visibility, sandbox/context isolation, and the main/preload prohibition on Windows installer download/install on non-Windows systems. It does not certify every OS release or test all native file dialogs, file associations, or the quarantined download experience. Linux/macOS updates use a manual release-page lane, not automatic native replacement.

Verify downloaded files using their matching manifest from the same release, for example inside the directory containing the artifacts:

```sh
sha256sum -c ElevenMD-0.3.4-linux-x64-SHA256SUMS.txt
# macOS:
shasum -a 256 -c ElevenMD-0.3.4-mac-arm64-SHA256SUMS.txt
```

A published checksum detects mismatched bytes; it does not authenticate a compromised repository independently.
