'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function refreshDocumentIcons({ execPath, isPackaged, platform = process.platform, isolated = false, waitForCommit = false, run = promisify(execFile) }) {
  if (platform !== 'win32' || !isPackaged || isolated) return 0;
  // Fixed script and argument-list execution: no renderer input, command strings,
  // default-app writes, or association creation. Native checks bind existing
  // ProgIDs to this exact installed executable and preserve customized icons.
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows-document-icons.ps1'), '-Executable', execPath];
  if (waitForCommit) args.push('-WaitForCommit');
  const { stdout } = await run(powershell, args, { windowsHide: true, timeout: 15000, maxBuffer: 16384, encoding: 'utf8' });
  const receipt = JSON.parse(stdout.trim());
  if (!Number.isInteger(receipt.Changed) || receipt.Changed < 0 || receipt.Changed > 2) throw new Error('Invalid document icon migration receipt.');
  return receipt.Changed;
}
module.exports = { refreshDocumentIcons };
