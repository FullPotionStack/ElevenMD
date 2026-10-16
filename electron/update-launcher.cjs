'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

/** Main-process-only launcher. filename must already be privately cached and rehashed.
 * execPath, parentPid and isPackaged are trusted runtime values, never IPC fields.
 * Resolution means process creation, NOT completion of the asynchronous update.
 */
function createUpdateLauncher({ execPath, parentPid, isPackaged, spawnImpl = spawn, fsImpl = fs }) {
  return async function launchInstaller(filename) {
    const safePath = value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f"<>|?*]/.test(value);
    if (isPackaged !== true) throw new Error('Updates require a packaged application.');
    if (arguments.length !== 1 || !safePath(execPath) || path.basename(execPath).toLowerCase() !== 'elevenmd.exe' ||
        path.dirname(execPath) === path.parse(execPath).root || !Number.isInteger(parentPid) || parentPid <= 0 || parentPid > 0xffffffff ||
        !safePath(filename) || path.extname(filename).toLowerCase() !== '.exe') throw new Error('Invalid update launcher arguments.');
    const directory = path.dirname(execPath);
    // The installer accepts local-drive targets, not UNC/extended paths.
    if (process.platform === 'win32' && !/^[a-z]:\\/i.test(directory)) throw new Error('Unsafe update directory.');
    const canonical = await fsImpl.realpath(execPath);
    const samePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (samePath(canonical) !== samePath(execPath) || !(await fsImpl.lstat(execPath)).isFile()) {
      throw new Error('Unsafe noncanonical application path (symlink or junction).');
    }
    const args = ['/SP-', '/SILENT', '/NOCANCEL', '/NORESTART',
      '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/UPDATE', `/PARENTPID=${parentPid}`, `/DIR=${directory}`];
    const metadata = await Promise.all(['unins000.exe', 'unins000.dat'].map(name =>
      fsImpl.lstat(path.join(directory, name)).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      })));
    const installed = metadata.some(Boolean);
    if (installed) {
      try {
        if (!metadata.every(stat => stat?.isFile())) throw new Error('Incomplete uninstall metadata');
        const manifest = JSON.parse(await fsImpl.readFile(path.join(directory, 'resources', 'app', 'package.json'), 'utf8'));
        if (manifest.name !== 'eleven-md') throw new Error('Unrecognized application');
      } catch { throw new Error('Cannot identify this ElevenMD installation safely.'); }
    }
    if (!installed) args.push('/PORTABLEUPDATE', '/TASKS=');

    // Fail before quitting if the existing folder is read-only. Only remove our
    // exclusive creation, never a preexisting path. Individual file ACLs and
    // transient runtime locks remain the installer's responsibility.
    const probe = path.join(directory, `.elevenmd-update-probe-${randomUUID()}`);
    let owned = false;
    try {
      const handle = await fsImpl.open(probe, 'wx', 0o600);
      owned = true;
      try { await handle.writeFile('ElevenMD update write probe\n'); await handle.sync(); }
      finally { await handle.close(); }
    } finally {
      if (owned) await fsImpl.unlink(probe);
    }
    await new Promise((resolve, reject) => {
      const child = spawnImpl(filename, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  };
}
module.exports = { createUpdateLauncher };
