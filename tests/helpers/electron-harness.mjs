import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'

export function packagedExecutable() {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  return process.env.NOTEPAD_EXECUTABLE_PATH || path.resolve(`release/win-${pkg.version}-unpacked/ElevenMD.exe`)
}

export async function testScratch() {
  const base = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA, 'hermes', 'cache', 'scratch')
    : process.env.TMPDIR
  if (!base) throw new Error('An explicit test scratch directory is required.')
  await mkdir(base, { recursive: true })
  return base
}

async function terminateOwnedTree(pid) {
  if (process.platform === 'win32') await promisify(execFile)('taskkill.exe', ['/PID', String(pid), '/T', '/F']).catch(error => {
    if (error.code !== 128) throw error
  })
  else { try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
}

export async function closeTestApp(app, { budget = 8000, killTree = terminateOwnedTree } = {}) {
  if (!app) return
  const child = app.process()
  let timer
  try {
    await Promise.race([
      (async () => {
        await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.destroy() }).catch(() => {})
        await app.close()
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test app did not exit.')), budget) }),
    ])
  } catch {
    // This process is owned by this harness; never target names or unrelated windows.
  } finally {
    clearTimeout(timer)
    if (child?.pid && child.exitCode === null) await killTree(child.pid)
  }
}
