#!/usr/bin/env bash
set -euo pipefail
# Root only provisions the disposable Fedora environment; every npm/app command is nonroot.
dnf install -y curl xz tar gzip git shadow-utils findutils dpkg dpkg-dev \
  nss nspr atk at-spi2-atk cups-libs libdrm dbus-libs libX11 libxcb \
  libXcomposite libXdamage libXext libXfixes libXrandr mesa-libgbm \
  libxkbcommon pango cairo alsa-lib gtk3 xdg-utils \
  xorg-x11-server-Xvfb xorg-x11-xauth liberation-fonts
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
sha256sum --check --ignore-missing SHASUMS256.txt
tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1
useradd --create-home tester
mkdir -p /home/tester/repo /home/tester/scratch
(cd /checkout && tar --exclude=node_modules --exclude=release --exclude=test-results -cf - .) | tar -xf - -C /home/tester/repo
chown -R tester:tester /home/tester /logs
runuser -u tester -- bash -s <<'SOURCE_TEST'
set -euo pipefail
cd /home/tester/repo
export HERMES_TEST_SCRATCH=/home/tester/scratch
unset TMPDIR LOCALAPPDATA ELECTRON_RUN_AS_NODE
cat /etc/fedora-release | tee /logs/versions.txt
node --version | tee -a /logs/versions.txt
npm --version | tee -a /logs/versions.txt
id | tee -a /logs/versions.txt
test "$(id -u)" != 0
npm ci 2>&1 | tee /logs/npm-ci.txt
npm run runtime:install 2>&1 | tee /logs/runtime-install.txt
node -e 'for (const name of ["vite", "electron", "@playwright/test"]) { const p=require(name+"/package.json"); console.log(name,p.version,p.engines) }' | tee -a /logs/versions.txt
ldd node_modules/electron/dist/electron | tee /logs/electron-libraries.txt
if grep -q 'not found' /logs/electron-libraries.txt; then exit 1; fi
failed=0
npm test 2>&1 | tee /logs/unit.txt || failed=1
npm run test:packaging 2>&1 | tee /logs/packaging-unit.txt || failed=1
npx playwright install chromium 2>&1 | tee /logs/browser-install.txt
npm run test:ui 2>&1 | tee /logs/ui.txt || failed=1
npm run build 2>&1 | tee /logs/build.txt
# Source native launch uses the full desktop integration harness, isolated userData.
# Existing helper currently requires TMPDIR; record that until its portability fix.
TMPDIR="$HERMES_TEST_SCRATCH" xvfb-run -a npm run test:desktop 2>&1 | tee /logs/source-launch.txt || failed=1
npm run package:linux 2>&1 | tee /logs/package.txt
(cd release && sha256sum -c *-linux-*-SHA256SUMS.txt)
mkdir -p "$HERMES_TEST_SCRATCH/extracted"
tar -xzf release/*-linux-*-portable.tar.gz -C "$HERMES_TEST_SCRATCH/extracted"
executable=$(find "$HERMES_TEST_SCRATCH/extracted" -mindepth 2 -maxdepth 2 -name elevenmd -type f)
test -n "$executable"
NOTEPAD_EXECUTABLE_PATH="$executable" TMPDIR="$HERMES_TEST_SCRATCH" xvfb-run -a npm run test:packaging:smoke 2>&1 | tee /logs/packaged-launch.txt || failed=1
exit "$failed"
SOURCE_TEST
