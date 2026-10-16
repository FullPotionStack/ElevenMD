import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { testScratch } from './helpers/electron-harness.mjs';
const require = createRequire(import.meta.url);

async function fixture(t, installed = false) {
  const root = await fs.mkdtemp(path.join(await testScratch(), 'update-launcher-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const execPath = path.join(root, 'ElevenMD.exe');
  await fs.writeFile(execPath, 'fixture, not executable');
  if (installed) {
    await fs.writeFile(path.join(root, 'unins000.exe'), 'fixture');
    await fs.writeFile(path.join(root, 'unins000.dat'), 'fixture');
    await fs.mkdir(path.join(root, 'resources', 'app'), { recursive: true });
    await fs.writeFile(path.join(root, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'eleven-md' }));
  }
  const calls = [];
  const spawnImpl = (...args) => {
    calls.push(args);
    const child = new EventEmitter(); child.unref = () => { child.unreferenced = true; };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const module = await Promise.resolve().then(() => {
    try { return require('../electron/update-launcher.cjs'); }
    catch (error) { assert.fail(`Update launcher is not implemented: ${error.message}`); }
  });
  const options = { execPath, parentPid: 1234, isPackaged: true, spawnImpl };
  return { root, execPath, calls, options, createUpdateLauncher: module.createUpdateLauncher };
}

test('portable update selects the same directory but cannot enable setup side effects', async t => {
  const f = await fixture(t);
  await f.createUpdateLauncher(f.options)(path.join(f.root, 'verified.exe'));
  assert.deepEqual(f.calls[0][1].slice(-3), [`/DIR=${f.root}`, '/PORTABLEUPDATE', '/TASKS=']);
  assert.equal(f.calls[0][1].includes('/VERYSILENT'), false);
});

test('rejects development runtimes, malformed trusted configuration and arbitrary extra launch fields', async t => {
  const f = await fixture(t);
  for (const invalid of [{ isPackaged: false }, { execPath: 'ElevenMD.exe' }, { execPath: path.join(f.root, 'electron.exe') },
    { parentPid: 0 }, { parentPid: -1 }, { parentPid: 1.2 }, { parentPid: '1234' }, { parentPid: 4294967296 }]) {
    await assert.rejects(() => f.createUpdateLauncher({ ...f.options, ...invalid })(path.join(f.root, 'verified.exe')), /Invalid|packaged/i);
  }
  const launch = f.createUpdateLauncher(f.options);
  for (const invalid of ['relative.exe', path.join(f.root, 'bad.cmd'), 'C:\\bad\".exe']) await assert.rejects(() => launch(invalid), /Invalid/);
  await assert.rejects(() => launch(path.join(f.root, 'verified.exe'), { directory: 'C:\\elsewhere' }), /Invalid/);
  assert.equal(f.calls.length, 0);
});

test('an unrelated or incomplete uninstaller is ambiguous and fails without launching', async t => {
  const f = await fixture(t);
  const launch = f.createUpdateLauncher(f.options);
  await fs.writeFile(path.join(f.root, 'unins000.exe'), 'unrelated');
  await assert.rejects(() => launch(path.join(f.root, 'verified.exe')), /installation/i);
  await fs.writeFile(path.join(f.root, 'unins000.dat'), 'unrelated');
  await fs.mkdir(path.join(f.root, 'resources', 'app'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'another-app' }));
  await assert.rejects(() => launch(path.join(f.root, 'verified.exe')), /installation/i);
  assert.equal(f.calls.length, 0);
});

test('spawn failures reject before the main process is allowed to quit', async t => {
  const f = await fixture(t);
  const spawnImpl = () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('launch denied'))); return child; };
  await assert.rejects(() => f.createUpdateLauncher({ ...f.options, spawnImpl })(path.join(f.root, 'verified.exe')), /launch denied/);
});

const installerSource = await fs.readFile(new URL('../installer/ElevenMD.iss', import.meta.url), 'utf8');
const section = name => installerSource.split(`[${name}]`)[1]?.split(/^\[/m)[0] || '';

test('portable setup disables every machine integration and uninstall side effect independently of tasks', () => {
  assert.match(section('Setup'), /^Uninstallable=NotPortableUpdate$/m);
  assert.match(section('Setup'), /^CreateUninstallRegKey=NotPortableUpdate$/m);
  assert.match(section('Setup'), /^ChangesAssociations=NotPortableUpdate$/m);
  for (const name of ['Tasks', 'Icons', 'Registry']) {
    const entries = section(name).split('\n').filter(line => line.trim() && !line.startsWith(';'));
    assert.ok(entries.length > 0);
    for (const entry of entries) assert.match(entry, /Check: NotPortableUpdate(?:;|\s*$)/, `${name}: ${entry}`);
  }
  const defaultApps = section('Run').split('\n').find(line => line.includes('ms-settings:defaultapps'));
  assert.match(defaultApps, /Check: NotPortableUpdate/);
  assert.equal(section('InstallDelete'), '', 'portable updates never remove unknown files');
  assert.doesNotMatch(section('Files'), /restartreplace|deleteafterinstall/);
});

test('portable setup validates explicit target and holds only the exact parent process handle before copying', () => {
  assert.match(installerSource, /function InitializeSetup: Boolean;/);
  assert.match(installerSource, /ExplicitUpdateDirectory/);
  assert.match(installerSource, /IsPortableUpdate and \(not IsUpdate\)/);
  assert.match(installerSource, /OpenProcess\(\$00101000, False, ParentPid\)/);
  assert.match(installerSource, /QueryFullProcessImageNameW/);
  assert.match(installerSource, /CompareText\(ParentImage, ExpandConstant\('\{app\}\\\{#AppExe\}'\)\)/);
  assert.match(installerSource, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(installerSource, /WaitForSingleObject\(UpdateParentHandle, 100\)/);
  assert.match(installerSource, /GetTickCount64\(\) \+ 60000/);
  assert.match(installerSource, /finally\s+CloseHandle\(UpdateParentHandle\)/);
  assert.doesNotMatch(installerSource, /TerminateProcess|taskkill|restartreplace/i);
});

test('progress-only setup keeps native failure dialogs visible', async t => {
  const f = await fixture(t);
  await f.createUpdateLauncher(f.options)(path.join(f.root, 'verified.exe'));
  assert.equal(f.calls[0][1].includes('/SUPPRESSMSGBOXES'), false);
});

test('an unwritable portable directory fails before process creation and never removes an unowned path', async t => {
  const f = await fixture(t);
  let opened = false, removed = false;
  const fsImpl = { ...fs, open: async (file, flags) => {
    opened = true; assert.equal(path.dirname(file), f.root); assert.equal(flags, 'wx');
    throw Object.assign(new Error('read only fixture'), { code: 'EACCES' });
  }, unlink: async () => { removed = true; } };
  await assert.rejects(() => f.createUpdateLauncher({ ...f.options, fsImpl })(path.join(f.root, 'verified.exe')), /read only|writable/i);
  assert.equal(opened, true); assert.equal(removed, false); assert.equal(f.calls.length, 0);
});

test('write probe is exclusive, flushed and removed before the installer starts', async t => {
  const f = await fixture(t);
  const events = [];
  const fsImpl = { ...fs, open: async (file, flags) => {
    events.push('open'); assert.equal(flags, 'wx');
    const handle = await fs.open(file, flags);
    return { writeFile: async value => { events.push('write'); await handle.writeFile(value); },
      sync: async () => { events.push('sync'); await handle.sync(); }, close: async () => { events.push('close'); await handle.close(); } };
  }, unlink: async file => { events.push('unlink'); await fs.unlink(file); } };
  await f.createUpdateLauncher({ ...f.options, fsImpl, spawnImpl: (...args) => { events.push('spawn'); return f.options.spawnImpl(...args); } })(path.join(f.root, 'verified.exe'));
  assert.deepEqual(events, ['open', 'write', 'sync', 'close', 'unlink', 'spawn']);
  assert.deepEqual(await fs.readdir(f.root), ['ElevenMD.exe']);
});

test('junction aliases and ambiguous uninstall metadata fail before launch', async t => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => f.createUpdateLauncher({ ...f.options, execPath: path.join(alias, 'ElevenMD.exe') })(path.join(f.root, 'verified.exe')), /unsafe|ambiguous|canonical/i);
  await fs.mkdir(path.join(f.root, 'unins000.exe'));
  await assert.rejects(() => f.createUpdateLauncher(f.options)(path.join(f.root, 'verified.exe')), /installation/i);
  await fs.rmdir(path.join(f.root, 'unins000.exe'));
  await fs.writeFile(path.join(f.root, 'unins000.dat'), 'orphan');
  await assert.rejects(() => f.createUpdateLauncher(f.options)(path.join(f.root, 'verified.exe')), /installation/i);
  assert.equal(f.calls.length, 0);
});

test('legacy installed updaters can transition only with an explicit existing installed target', () => {
  const initialize = installerSource.split('function InitializeSetup: Boolean;')[1].split('function PrepareToInstall(')[0];
  const legacy = initialize.indexOf('if (PidCount = 0) and NotPortableUpdate then begin');
  assert.ok(legacy > initialize.indexOf('Target := ExplicitUpdateDirectory;'));
  const branch = initialize.slice(legacy, initialize.indexOf('ParsedPid :=', legacy));
  assert.match(branch, /FileExists\(AddBackslash\(Target\) \+ 'unins000.exe'\)/);
  assert.match(branch, /FileExists\(AddBackslash\(Target\) \+ 'unins000.dat'\)/);
  assert.match(branch, /Result := True\s+else/);
  assert.match(installerSource, /SuppressibleMsgBox\(Reason/);
  assert.match(installerSource, /CompareText\(ExplicitUpdateDirectory, ExpandConstant\('\{app\}'\)\)/);
});

test('runtime locks fail fatally rather than offering to ignore an executable replacement', () => {
  assert.match(section('Files'), /BeforeInstall: CheckRuntimeFileWritable/);
  assert.match(installerSource, /CreateFileW\(Filename, \$40000000, 0, 0, 3, \$80, 0\)/);
  assert.match(installerSource, /RaiseException\('The update cannot replace a locked or read-only runtime file/);
});

test('exited parent handles are accepted before querying a now-unavailable process image', () => {
  const prepare = installerSource.split('function PrepareToInstall(')[1].split('procedure CheckRuntimeFileWritable;')[0];
  const query = prepare.indexOf('if not QueryFullProcessImageNameW');
  const exited = prepare.indexOf('if WaitForSingleObject(UpdateParentHandle, 0) = 0 then Exit;');
  assert.ok(exited >= 0 && query > exited);
  assert.match(prepare.slice(query), /then begin\s+if WaitForSingleObject\(UpdateParentHandle, 0\) = 0 then Exit;/);
});

test('installed update launches progress-only setup in its trusted application directory', async t => {
  const f = await fixture(t, true);
  const filename = path.join(f.root, 'verified setup.exe');
  const launchInstaller = f.createUpdateLauncher(f.options);
  await launchInstaller(filename);
  assert.deepEqual(f.calls, [[filename, ['/SP-', '/SILENT', '/NOCANCEL', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/UPDATE', '/PARENTPID=1234', `/DIR=${f.root}`], { shell: false, detached: true, stdio: 'ignore', windowsHide: true }]]);
});
