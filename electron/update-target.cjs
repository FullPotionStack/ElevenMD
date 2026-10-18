'use strict';
const fs = require('./updater/fs.cjs').promises;
const path = require('node:path');
const { canonicalDirectory } = require('./update-bundle.cjs');
const { readMarker } = require('./updater/transaction.cjs');
async function resolveUpdateTarget({ execPath, isPackaged, platform = process.platform, arch = process.arch, toolsAvailable = async () => {
  try { await fs.access('/usr/bin/pkexec', fs.constants.X_OK); await fs.access('/usr/bin/apt-get', fs.constants.X_OK); return true; } catch { return false; }
} }) {
  const manual = reason => ({ route: 'manual', reason });
  if (!isPackaged) return manual('Updates require a packaged application.');
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch) || platform === 'win32' && arch !== 'x64') return manual('This platform or processor is not supported by the updater.');
  try {
    if (await fs.realpath(execPath) !== path.resolve(execPath) || !(await fs.lstat(execPath)).isFile()) return manual('The executable path is aliased.');
    const target = platform === 'darwin' ? path.resolve(path.dirname(execPath), '../..') : path.dirname(execPath);
    await canonicalDirectory(target);
    const result = { target, execPath, platform, arch, executable: path.relative(target, execPath).split(path.sep).join('/') };
    let installedWindows = false;
    if (platform === 'win32') {
      const metadata = await Promise.all(['unins000.exe', 'unins000.dat'].map(name => fs.lstat(path.join(target, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; })));
      if (metadata.some(Boolean)) {
        if (!metadata.every(s => s?.isFile() && !s.isSymbolicLink())) return manual('Incomplete installer metadata.');
        installedWindows = true;
      }
    }
    if (platform === 'linux') {
      const marker = await fs.readFile(path.join(target, '.elevenmd-package-managed'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      if (marker) return marker === 'deb\n' && await toolsAvailable() ? { ...result, route: 'deb' } : manual('Update this installation with its package manager; native authorization tools are unavailable.');
      if (target.startsWith('/opt/') || target.startsWith('/usr/') || target.startsWith('/var/lib/')) return manual('Update this system installation with its package manager.');
    }
    if (platform === 'darwin' && (target.startsWith('/Volumes/') || !target.endsWith('.app'))) return manual('Move ElevenMD to a writable application folder before updating.');
    const marker = await readMarker(target);
    const route = platform === 'darwin' ? 'mac-bundle' : 'portable';
    if (marker.route !== route || marker.platform !== platform || marker.arch !== arch || marker.executable !== result.executable) return manual('This copy does not have a matching updater identity.');
    await fs.access(target, fs.constants.W_OK); await fs.access(path.dirname(target), fs.constants.W_OK);
    return { ...result, route: installedWindows ? 'windows-installed' : route };
  } catch { return manual('This copy cannot be safely updated automatically. Use the matching download.'); }
}
module.exports = { resolveUpdateTarget };
