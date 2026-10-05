# Distributing a fork

Forks **MUST change their update repository before distributing modified builds**. A modified app must not download official ElevenMD installers that replace the fork.

## Set the distribution destination

Edit `electron/distribution.cjs`:

- `repository`: your literal GitHub `owner/repository`, without a URL, query string or trailing slash.
- `installerPrefix`: your installer asset prefix. A version `1.2.3` with prefix `MyFork-Setup` expects `MyFork-Setup-1.2.3.exe`.

The updater reads this configuration in the main process. Renderer input cannot change it. Release API requests, release links, and installer URLs use that configured repository; installer URLs are still validated against it. GitHub release-delivery redirects, bounded responses, checksums and native installation approval remain enforced.

Set Git `origin` to your fork's GitHub URL and update `package.json` repository metadata. Both Windows packaging entry points reject a configured repository that differs from `origin`. Use a GitHub checkout rather than a source archive when packaging.

This check prevents accidental upstream targeting. MIT remains the source license; the build policy does not claim to stop someone intentionally editing it out or falsifying their remote.

## Separate the Windows installation

Give the fork its own product/executable identity, installer AppId, ProgIDs, Windows registrations and shortcuts. Change package/user-data and persistent-partition identities too. Do not let a fork overwrite the official installation or reuse another app's private session files.

Identity strings and branding assets are intentionally separate from the update destination; changing one is not a substitute for changing the other. Update documentation and public links to match your fork.

## Publish an update

Publish a stable `vX.Y.Z` GitHub release with:

1. The configured `<installerPrefix>-X.Y.Z.exe` asset.
2. An asset named exactly `SHA256SUMS`, containing the installer SHA-256 and basename in standard checksum format.
3. Release notes explaining the changes and any migration requirements.

Drafts, prereleases, equal versions and downgrades do not offer an update. Installation is optional and requires both an app action and native confirmation. The app checkpoints tabs before launching the verified installer.

## Verify your destination

Run `npm test`, particularly `tests/distribution.test.mjs`, then the UI and packaged tests. Test a real unauthenticated API check and release download from your own repository before distributing a build. Mocked HTTP tests alone cannot prove the public delivery path.
