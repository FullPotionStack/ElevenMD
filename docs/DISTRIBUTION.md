# Native distributions

Build on the target operating system and architecture with Node.js 22.12.0 or newer (Node 24 LTS recommended), `npm ci`, `npm run runtime:install`, and the relevant command. Locked Vite 8.3.2 accepts `^20.19.0 || >=22.12.0`, but Electron 44.5.1's installer requires Node 22.12.0 or newer. Electron exposes `install-electron` as an explicit binary installer; `npm ci` alone does not download the runtime:

| Host | Command | Output in `release/` |
| --- | --- | --- |
| Linux x64 / arm64 | `npm run package:linux` | Debian package, portable tar.gz, architecture-specific SHA256SUMS.txt |
| macOS x64 / arm64 | `npm run package:mac` | DMG, portable ZIP, architecture-specific SHA256SUMS.txt |
| Windows x64 | `npm run installer:win` | Inno installer and staged portable runtime |

Linux uses `dpkg-deb` and `tar`. macOS uses Xcode command-line tools and the system `hdiutil`, `ditto`, `plutil`, `sips`, `iconutil`, and `codesign`. Cross-compilation is intentionally unsupported. The packager checks the installed Electron version and binary architecture, refuses existing versioned output directories, and validates the distribution repository against GitHub origin. Move previous generated output aside explicitly before rebuilding.

Every build carries application, dependency, Electron, and Chromium notices. macOS notices travel inside the `.app`; ZIP/DMG copy tools preserve framework symlinks.

## GitHub Actions

`.github/workflows/native-distributions.yml` builds on Ubuntu 24.04 x64/arm64 and macOS 15 Intel/Apple silicon runners. Each lane runs packaging fixtures, the full application unit suite, native packaging, checksum verification, and actual packaged launches of both distribution formats. Linux installs the Debian package on the disposable runner and extracts the tar.gz; macOS extracts the ZIP and copies the app from a mounted DMG into runner scratch. All smoke launches use isolated per-test application data.

```sh
gh workflow run native-distributions.yml --ref main -f release_tag=v0.3.5
```

A manual release dispatch builds the immutable commit selected by `main`, not the old release tag. `release_tag` must exactly equal `v` plus `package.json` version, and attachment dispatches must use main. The workflow does not move or rewrite the existing tag. The build source SHA is recorded in the job summary. This permits adding native assets to a release whose original tag predates native packaging. Source changes and platform-specific updater guards are therefore in the recorded main commit, not necessarily in the original tag or existing Windows binary.

A blank `release_tag` uploads CI artifacts only. A published-release event builds its event commit. Attachment requires every native build lane to succeed, verifies the merged checksum manifests, uploads without overwriting existing release assets, and reads the exact release back to check the expected names. If an upload partially succeeds, inspect the release before retrying; do not overwrite already-published binaries blindly.

## Fedora source setup and reproduction

On Fedora 43 x64, install Electron's native libraries first:

```sh
sudo dnf install -y nss nspr atk at-spi2-atk cups-libs libdrm dbus-libs \
  libX11 libxcb libXcomposite libXdamage libXext libXfixes libXrandr \
  mesa-libgbm libxkbcommon pango cairo alsa-lib gtk3 xdg-utils liberation-fonts
```

Install Node using your preferred version manager or Fedora packages, then check `node --version`. The CI matrix pins Node **22.23.3** (npm 10.9.9) and **24.21.0** (npm 11.19.0). Within the checkout, run these as a regular user, not with `sudo`:

```sh
npm ci
npm run runtime:install
npm run build
npm start
```

Tests are separate from launching the editor. The UI suite needs an explicit Chromium download:

```sh
npm test
npx playwright install chromium
npm run test:ui
```

For the source Electron integration test on a headless machine, install `xorg-x11-server-Xvfb` and `xorg-x11-xauth`, then run `xvfb-run -a npm run test:desktop`. Tests honor `HERMES_TEST_SCRATCH`; otherwise they use the platform scratch directory, with an OS temporary-directory fallback when Unix `TMPDIR` is unset. They do not require Windows `LOCALAPPDATA` on Unix.

`.github/workflows/fedora-source.yml` runs `scripts/ci/fedora.sh` in a real `fedora:43` Docker container on GitHub's Ubuntu host. It records Fedora, Node, npm, Vite, Electron and Playwright versions, checks Electron shared-library resolution, and exercises locked dependency installation, runtime download, the full unit suite, all browser UI tests, production build, source Electron file/save/conflict tests, native Linux packaging, archive checksums, and an extracted portable Electron launch. All npm commands and app launches run as the nonroot `tester` user; native launches use Xvfb with sandbox and context isolation enabled. Logs are uploaded even after failures.

[Verified Fedora run](https://github.com/FullPotionStack/ElevenMD/actions/runs/37413556029), source commit `6c78a1dad66c18aa6c55bdd27eb398fef8ed56a1`: both Node lanes passed 94 unit tests (one existing Windows PE-resource test skipped on Linux), 8 packaging tests, and all 90 browser UI tests, plus source and extracted packaged Electron launches. The [pre-fix reproduction](https://github.com/FullPotionStack/ElevenMD/actions/runs/37412848437) recorded nine unit-suite failures from Windows-only fixture paths; it already passed the build and launch stages. This establishes a test-portability defect, not the cause of an installation failure without its error log.

The container grants `SYS_ADMIN` and unconfined seccomp for Chromium's nested namespace sandbox; the disposable Ubuntu host also relaxes its AppArmor namespace restriction. These are CI-only settings, not Fedora desktop setup instructions. This checks Fedora 43 userspace on the host's kernel, not a Fedora VM, SELinux desktop policy, native dialogs, or GPU hardware. Fedora uses the portable Linux archive, not the Debian installer. To generate the existing Linux formats on Fedora, also install `git`, `dpkg`, `dpkg-dev`, `tar`, and `gzip`, then run `npm run package:linux`.

## Security and test limits

Chromium sandboxing stays enabled. The Debian package installs a root-owned 4755 `chrome-sandbox`. Linux portable builds require unprivileged user namespaces and system Electron libraries. The CI runner relaxes Ubuntu's AppArmor namespace restriction solely for its disposable launch tests; users may need distribution-specific administrator configuration. The shipped launcher never adds `--no-sandbox`.

macOS builds are ad-hoc signed only. Ad-hoc verification is not Developer ID signing, notarization, or a Gatekeeper acceptance test. Downloaded/quarantined apps can require manual approval. Do not disable Gatekeeper system-wide. Public notarized releases require Apple credentials and additional release configuration.

The smoke test proves native packaged startup, version and architecture, renderer visibility, sandbox/context isolation, and the main/preload prohibition on Windows installer download/install on non-Windows systems. It does not certify every OS release or test all native file dialogs, file associations, or the quarantined download experience. Linux/macOS updates use a manual release-page lane, not automatic native replacement.

Verify downloaded files using their matching manifest from the same release, for example inside the directory containing the artifacts:

```sh
sha256sum -c ElevenMD-0.3.5-linux-x64-SHA256SUMS.txt
# macOS:
shasum -a 256 -c ElevenMD-0.3.5-mac-arm64-SHA256SUMS.txt
```

A published checksum detects mismatched bytes; it does not authenticate a compromised repository independently.
