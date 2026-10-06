import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { testScratch } from './helpers/electron-harness.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const scratch = await testScratch();
const repository = 'FullPotionStack/ElevenMD';
const api = `https://api.github.com/repos/${repository}/releases/latest`;
const releaseURL = `https://github.com/${repository}/releases/tag/v0.4.0`;
const baseURL = `https://github.com/${repository}/releases/download/v0.4.0/`;
const installerName = 'ElevenMD-Setup-0.4.0.exe';
const installer = Buffer.from('MZ fixture installer bytes; never execute');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function release(overrides = {}) {
  return { tag_name: 'v0.4.0', draft: false, prerelease: false, body: '# Changes\nFixed typing.',
    html_url: releaseURL, assets: [
      { name: installerName, size: installer.length, browser_download_url: baseURL + installerName },
      { name: 'SHA256SUMS', size: 130, browser_download_url: baseURL + 'SHA256SUMS' },
    ], ...overrides };
}
async function fixture(t, overrides = {}) {
  await fs.mkdir(scratch, { recursive: true });
  const downloadsDir = await fs.mkdtemp(path.join(scratch, 'elevenmd-updates-'));
  t.after(() => fs.rm(downloadsDir, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === api) return Response.json(release());
    if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
    if (url === baseURL + installerName) return new Response(installer);
    assert.fail(`Unexpected network request: ${url}`);
  };
  let module;
  try { module = require('../electron/updates.cjs'); }
  catch (error) { assert.fail(`Update service is not implemented: ${error.message}`); }
  const service = module.createUpdateService({ version: '0.3.0', repository, downloadsDir, fetchImpl, platform: 'win32', ...overrides });
  return { service, calls, downloadsDir };
}

test('non-Windows updates expose only a trusted release page and never download or execute Windows assets', async t => {
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    let hooks = 0;
    const { service, calls, downloadsDir } = await fixture(t, {
      platform, confirmInstall: async () => { hooks++; return true; },
      beforeInstall: async () => { hooks++; }, launchInstaller: async () => { hooks++; },
    });
    assert.equal(service.getState().manualDownload, true);
    assert.equal((await service.check()).status, 'available');
    assert.equal(service.getState().releaseUrl, releaseURL);
    await service.download(); await service.install();
    assert.equal(hooks, 0);
    assert.deepEqual(calls.map(call => call.url), [api]);
    assert.deepEqual(await fs.readdir(downloadsDir), []);
    const noWindowsAssets = await fixture(t, { platform, fetchImpl: async () => Response.json(release({ assets: [] })) });
    assert.equal((await noWindowsAssets.service.check()).status, 'available');
    assert.equal(noWindowsAssets.service.getState().releaseUrl, releaseURL);
  }
});

test('automatically decoded gzip metadata uses streamed decoded bounds, not compressed Content-Length equality', async t => {
  const data = JSON.stringify(release());
  const { service } = await fixture(t, { fetchImpl: async () => new Response(data, { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '100' } }) });
  assert.equal((await service.check()).status, 'available');
  const oversized = await fixture(t, { fetchImpl: async () => new Response('x'.repeat(1048577), { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '100' } }) });
  assert.equal((await oversized.service.check()).status, 'error');
});

test('current stable release keeps inert notes and trusted URL without offering installation', async t => {
  const { service } = await fixture(t, { fetchImpl: async () => Response.json(release({ tag_name: 'v0.3.0', body: '# Changes\nFixed a bug.' })) });
  const state = await service.check();
  assert.equal(state.status, 'current'); assert.equal(state.version, null);
  assert.match(state.notes, /Fixed a bug/);
  assert.equal(state.releaseUrl, 'https://github.com/FullPotionStack/ElevenMD/releases/tag/v0.3.0');
});

test('ignores drafts, prereleases, equal versions and downgrades using numeric semver ordering', async t => {
  for (const data of [release({ draft: true }), release({ prerelease: true }),
    release({ tag_name: 'v0.4.0-beta.1' }), release({ tag_name: 'v0.3.0' }), release({ tag_name: 'v0.2.99' })]) {
    const { service } = await fixture(t, { fetchImpl: async () => Response.json(data) });
    const state = await service.check();
    assert.equal(state.status, 'current');
    assert.equal(state.version, null);
  }
  const { service } = await fixture(t, { version: '0.10.0', fetchImpl: async () => Response.json(release()) });
  assert.equal((await service.check()).status, 'current');
});

test('rejects malformed semver, flags, installer names, URLs and missing checksum assets', async t => {
  const invalid = [
    ...['v01.4.0', '0.4', 'v0.4.0/evil', 'v0.4.0+foo', 'v0.4.0\\evil', ' v0.4.0', 'v0.4.0\n'].map(tag_name => release({ tag_name })),
    release({ draft: 'false' }), release({ prerelease: null }), release({ assets: [] }),
    release({ assets: release().assets.slice(0, 1) }),
    ...['../ElevenMD-Setup-0.4.0.exe', 'ElevenMD-Setup-0.3.0.exe', 'ElevenMD-Setup-0.4.0.exe.cmd'].map(name =>
      release({ assets: [{ ...release().assets[0], name }, release().assets[1]] })),
    ...['https://evil.example/a.exe', baseURL.replace(repository, 'attacker/ElevenMD') + installerName,
      baseURL.replace('https:', 'http:') + installerName, baseURL.replace('github.com', 'github.com.evil') + installerName,
      baseURL + installerName + '?download=1', baseURL + '%2e%2e/' + installerName,
      baseURL.replace('github.com', 'user@github.com') + installerName].map(browser_download_url =>
      release({ assets: [{ ...release().assets[0], browser_download_url }, release().assets[1]] })),
    release({ assets: [...release().assets, release().assets[0]] }),
    release({ assets: [{ ...release().assets[0], size: -1 }, release().assets[1]] }),
  ];
  for (const data of invalid) {
    const { service } = await fixture(t, { fetchImpl: async () => Response.json(data) });
    const state = await service.check();
    assert.equal(state.status, 'error', JSON.stringify(data));
    assert.equal(state.error, 'Unable to check for updates. Please try again later.');
    assert.equal(state.releaseUrl, null);
  }
});

test('returns bounded inert notes without HTML, invisible controls or markdown link destinations', async t => {
  const { service } = await fixture(t, { fetchImpl: async () => Response.json(release({
    body: '<script>alert(1)</script>\n<b>Fix</b> [read](javascript:evil)\u0000\u202e' + 'z'.repeat(10000),
  })) });
  const state = await service.check();
  assert.equal(state.status, 'available');
  assert.ok(state.notes.length <= 8000);
  assert.doesNotMatch(state.notes, /<|>|javascript:|\u0000|\u202e/);
});

test('check bounds streaming JSON, total time and HTTP errors without leaking private errors', async t => {
  const responses = [
    () => new Response('private server path C:/secret', { status: 500 }),
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
    () => new Response('{bad JSON'),
    () => new Response('x', { headers: { 'Content-Length': '1048577' } }),
    () => new Response('x'.repeat(1048577)),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1048577)); } })),
    () => new Response(new ReadableStream({ start() {} })),
    () => new Promise(() => {}),
    () => { throw new Error('token=private C:/secret'); },
    () => { throw null; },
  ];
  for (const response of responses) {
    const { service } = await fixture(t, { requestTimeoutMs: 30, fetchImpl: async () => response() });
    const state = await Promise.race([service.check(), new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Check did not respect its deadline')), 200);
    })]);
    assert.equal(state.status, 'error');
    assert.equal(state.error, 'Unable to check for updates. Please try again later.');
    assert.doesNotMatch(JSON.stringify(state), /private|secret|token/);
  }
});

test('configuration accepts only a literal trusted repository and stable current version', async t => {
  for (const options of [
    { repository: '../evil' }, { repository: repository + '/other' }, { repository: repository + '?token=x' },
    { repository: 'attacker/ElevenMD' }, { version: 'v0.3.0' }, { version: '0.03.0' }, { version: '0.3.0\n' },
  ]) {
    await assert.rejects(fixture(t, options), /Invalid update configuration/);
  }
});

test('explicit download verifies release SHA256SUMS bytes in a private cache without launching', async t => {
  let launched = 0;
  const { service, calls, downloadsDir } = await fixture(t, { launchInstaller: async () => { launched++; } });
  await service.check();
  assert.equal(calls.length, 1);
  const state = await service.download();
  assert.equal(state.status, 'downloaded');
  assert.deepEqual(calls.map(call => call.url), [api, baseURL + 'SHA256SUMS', baseURL + installerName]);
  const directories = await fs.readdir(downloadsDir);
  assert.equal(directories.length, 1);
  const cache = path.join(downloadsDir, directories[0]);
  assert.deepEqual(await fs.readdir(cache), [installerName]);
  assert.deepEqual(await fs.readFile(path.join(cache, installerName)), installer);
  assert.equal(launched, 0);
  assert.doesNotMatch(JSON.stringify(state), /\.exe|downloadsDir|sha256/i);
  assert.equal((await service.download()).status, 'downloaded');
  assert.equal(calls.length, 3, 'repeat download uses only the cached verified installer');
});

test('download follows only GitHub release-asset redirects and blocks unexpected delivery hosts', async t => {
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?signature=test';
  const seen = [];
  const { service } = await fixture(t, { fetchImpl: async (url, options) => {
    seen.push(url);
    assert.equal(options.redirect, 'manual');
    if (url === api) return Response.json(release());
    if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
    if (url === baseURL + installerName) return new Response(null, { status: 302, headers: { Location: cdn } });
    assert.equal(url, cdn);
    return new Response(installer);
  } });
  await service.check();
  assert.equal((await service.download()).status, 'downloaded');
  assert.equal(seen.at(-1), cdn);
  for (const location of ['http://release-assets.githubusercontent.com/a', 'https://evil.example/a',
    'https://release-assets.githubusercontent.com.evil/a', 'https://user@release-assets.githubusercontent.com/a',
    'https://release-assets.githubusercontent.com:444/a', 'file:///C:/a.exe',
    baseURL.replace(repository, 'attacker/ElevenMD') + installerName,
    'https://objects.githubusercontent.com/not-an-asset', 'https://github.com/login',
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/a#fragment']) {
    let fetchedUnsafe = false;
    const { service, downloadsDir } = await fixture(t, { fetchImpl: async url => {
      if (url === api) return Response.json(release());
      if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
      if (url === baseURL + installerName) return new Response(null, { status: 302, headers: { Location: location } });
      fetchedUnsafe = true; return new Response(installer);
    } });
    await service.check();
    assert.equal((await service.download()).status, 'error', location);
    assert.equal(fetchedUnsafe, false, location);
    assert.deepEqual(await fs.readdir(downloadsDir), []);
  }
});

test('checksum manifest is mandatory, exact and unambiguous before fetching the installer', async t => {
  for (const manifest of ['', 'not a checksum', `${digest(installer)}  another.exe\n`,
    `${digest(installer)}  prefix  ${installerName}\n`, `${digest(installer)}  ../${installerName}\n`,
    `${digest(installer)}  ${installerName}\n${digest(installer)} *${installerName}\n`,
    `${digest(installer)}  ${installerName}\n`.repeat(2), 'x'.repeat(131073)]) {
    let exeRequested = false;
    const { service, downloadsDir } = await fixture(t, { fetchImpl: async url => {
      if (url === api) return Response.json(release());
      if (url === baseURL + 'SHA256SUMS') return new Response(manifest);
      exeRequested = true; return new Response(installer);
    } });
    await service.check();
    assert.equal((await service.download()).status, 'error', manifest.slice(0, 200));
    assert.equal(exeRequested, false);
    assert.deepEqual(await fs.readdir(downloadsDir), []);
  }
  const { service } = await fixture(t, { fetchImpl: async url => {
    if (url === api) return Response.json(release());
    if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer).toUpperCase()} *${installerName}\r\n`);
    return new Response(installer);
  } });
  await service.check();
  assert.equal((await service.download()).status, 'downloaded', 'GNU binary checksums are supported');
});

test('download rejects digest mismatches, oversize/truncated bodies, stalled streams and failed delivery', async t => {
  const responses = [
    () => new Response(Buffer.alloc(installer.length, 7)),
    () => new Response(Buffer.alloc(installer.length + 1)),
    () => new Response(installer.subarray(1)),
    () => new Response(installer, { headers: { 'Content-Length': String(installer.length + 1) } }),
    () => new Response('private delivery failure', { status: 403 }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(installer); controller.error(new Error('secret')); } })),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(installer.subarray(0, 2)); } })),
    () => new Promise(() => {}),
  ];
  for (const makeResponse of responses) {
    const { service, downloadsDir } = await fixture(t, { downloadTimeoutMs: 30, fetchImpl: async url => {
      if (url === api) return Response.json(release());
      if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
      return makeResponse();
    } });
    await service.check();
    const state = await Promise.race([service.download(), new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Download did not respect its deadline')), 200);
    })]);
    assert.equal(state.status, 'error');
    assert.equal(state.error, 'Unable to download a verified update. Please try again later.');
    assert.deepEqual(await fs.readdir(downloadsDir), []);
  }
  const { service } = await fixture(t, { maxInstallerBytes: installer.length - 1 });
  assert.equal((await service.check()).status, 'error', 'metadata also enforces the configured size limit');
});

test('install requires native confirmation, checkpoints first and launches only its cached verified executable', async t => {
  const events = [];
  const { service, downloadsDir, calls } = await fixture(t, {
    confirmInstall: async state => { events.push('confirm'); assert.equal(state.status, 'downloaded'); return true; },
    beforeInstall: async () => { events.push('checkpoint'); },
    launchInstaller: async filename => {
      events.push('launch');
      assert.equal(path.basename(filename), installerName);
      assert.equal(path.dirname(path.dirname(filename)), await fs.realpath(downloadsDir));
      assert.deepEqual(await fs.readFile(filename), installer);
    },
  });
  assert.equal((await service.install()).status, 'error');
  assert.deepEqual(events, []);
  await service.check(); await service.download();
  await assert.rejects(service.install('C:/renderer/arbitrary.exe'), /do not accept arguments/);
  const result = await service.install();
  assert.equal(result.installed, true);
  assert.equal(result.status, 'downloaded');
  assert.deepEqual(events, ['confirm', 'checkpoint', 'launch']);
  assert.equal(calls.length, 3);
  assert.equal((await service.install()).installed, true);
  assert.deepEqual(events, ['confirm', 'checkpoint', 'launch'], 'an installer may be launched only once');
});

test('install rehashes the cache after native confirmation and checkpoint; tampering never launches', async t => {
  for (const tamper of ['modify', 'delete', 'hardlink', 'directory']) {
    let launched = 0, tampered = false;
    const { service, downloadsDir } = await fixture(t, {
      confirmInstall: async () => true,
      beforeInstall: async () => {
        const cache = path.join(downloadsDir, (await fs.readdir(downloadsDir))[0]);
        const filename = path.join(cache, installerName);
        if (tamper === 'modify') await fs.writeFile(filename, Buffer.alloc(installer.length, 1));
        if (tamper === 'delete') await fs.rm(filename);
        if (tamper === 'hardlink') await fs.link(filename, path.join(downloadsDir, 'untrusted.exe'));
        if (tamper === 'directory') { await fs.rm(filename); await fs.mkdir(filename); }
        tampered = true;
      },
      launchInstaller: async () => { launched++; },
    });
    await service.check(); await service.download();
    assert.equal((await service.install()).status, 'error', tamper);
    assert.equal(tampered, true);
    assert.equal(launched, 0);
  }
});

test('native cancellation and missing confirmation do not launch; checkpoint and launch errors are generic', async t => {
  for (const confirmInstall of [undefined, async () => false, async () => 'yes']) {
    let launched = 0;
    const { service } = await fixture(t, { confirmInstall, launchInstaller: async () => { launched++; } });
    await service.check(); await service.download();
    const result = await service.install();
    assert.equal(result.status, confirmInstall ? 'downloaded' : 'error');
    assert.equal(launched, 0);
  }
  for (const failing of ['beforeInstall', 'launchInstaller']) {
    let launched = 0;
    const options = { confirmInstall: async () => true, launchInstaller: async () => { launched++; } };
    options[failing] = async () => { throw new Error('C:/secret token=private'); };
    const { service } = await fixture(t, options);
    await service.check(); await service.download();
    const result = await service.install();
    assert.equal(result.status, 'error');
    assert.equal(launched, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  }
});

test('state uses renderer version and reports an unpublished release when GitHub latest returns 404', async t => {
  const { service } = await fixture(t, { fetchImpl: async () => new Response(null, { status: 404 }) });
  assert.equal(service.getState().version, null);
  const state = await service.check();
  assert.equal(state.status, 'unpublished');
  assert.equal(state.version, null);
  assert.equal(state.error, null);
  const available = await fixture(t);
  assert.equal((await available.service.check()).version, '0.4.0');
});

test('a fresh check invalidates and removes only the previously verified cache', async t => {
  let data = release(), launched = 0;
  const { service, downloadsDir } = await fixture(t, { confirmInstall: async () => true,
    launchInstaller: async () => { launched++; }, fetchImpl: async url => {
      if (url === api) return Response.json(data);
      if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
      return new Response(installer);
    },
  });
  await service.check(); await service.download();
  const unrelated = path.join(downloadsDir, 'keep.txt');
  await fs.writeFile(unrelated, 'untouched');
  data = release({ tag_name: 'v0.2.0' });
  assert.equal((await service.check()).status, 'current');
  assert.deepEqual(await fs.readdir(downloadsDir), ['keep.txt']);
  assert.equal((await service.install()).status, 'error');
  assert.equal((await service.download()).status, 'error');
  assert.equal(launched, 0);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'untouched');
});

test('concurrent calls serialize check, streamed download and installation without duplicate launches', async t => {
  let resolveCheck, launched = 0, confirmed = 0;
  const calls = [];
  const { service } = await fixture(t, {
    confirmInstall: async () => { confirmed++; return true; },
    launchInstaller: async () => { launched++; },
    fetchImpl: async url => {
      calls.push(url);
      if (url === api) return new Promise(resolve => { resolveCheck = resolve; });
      if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
      return new Response(new ReadableStream({ start(controller) {
        for (const byte of installer) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      } }));
    },
  });
  const checking = service.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveCheck, 'function', 'the deferred HTTP check actually started');
  assert.equal(service.getState().status, 'checking');
  const downloading = service.download(), duplicateDownload = service.download();
  assert.deepEqual(calls, [api]);
  resolveCheck(Response.json(release()));
  assert.equal((await checking).status, 'available');
  assert.equal((await downloading).status, 'downloaded');
  assert.equal((await duplicateDownload).status, 'downloaded');
  const results = await Promise.all([service.install(), service.install()]);
  assert.ok(results.every(result => result.installed === true));
  assert.equal(confirmed, 1); assert.equal(launched, 1);
  assert.deepEqual(calls, [api, baseURL + 'SHA256SUMS', baseURL + installerName]);
  await assert.rejects(service.check('https://evil.example'), /do not accept arguments/);
  await assert.rejects(service.download({ path: 'C:/evil.exe' }), /do not accept arguments/);
});

test('redirect loops and automatically-followed responses never produce a verified executable', async t => {
  const cdn = 'https://objects.githubusercontent.com/github-production-release-asset/123/abc';
  for (const automatic of [false, true]) {
    let requests = 0;
    const { service, downloadsDir } = await fixture(t, { fetchImpl: async url => {
      if (url === api) return Response.json(release());
      if (url === baseURL + 'SHA256SUMS') return new Response(`${digest(installer)}  ${installerName}\n`);
      requests++;
      if (automatic) {
        const response = new Response(installer);
        Object.defineProperty(response, 'redirected', { value: true });
        Object.defineProperty(response, 'url', { value: 'https://evil.example/installer' });
        return response;
      }
      return new Response(null, { status: 302, headers: { Location: cdn } });
    } });
    await service.check();
    assert.equal((await service.download()).status, 'error');
    assert.equal(requests, automatic ? 1 : 4, 'redirect budget is actually exercised');
    assert.deepEqual(await fs.readdir(downloadsDir), []);
  }
});

test('check finds a newer stable release without downloading or trusting the release HTML URL', async t => {
  const { service, calls, downloadsDir } = await fixture(t, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url, api);
      return Response.json(release({ html_url: 'https://evil.example/execute' }));
    },
  });
  assert.equal(service.getState().status, 'idle');
  const state = await service.check();
  assert.equal(state.status, 'available');
  assert.equal(state.currentVersion, '0.3.0');
  assert.equal(state.version, '0.4.0');
  assert.equal(state.releaseUrl, releaseURL);
  assert.equal(state.notes, '# Changes\nFixed typing.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(await fs.readdir(downloadsDir), []);
  state.version = '9.9.9';
  assert.equal(service.getState().version, '0.4.0');
});
