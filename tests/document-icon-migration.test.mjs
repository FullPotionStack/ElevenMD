import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { testScratch } from './helpers/electron-harness.mjs'

const run = promisify(execFile)
const scriptURL = new URL('../electron/windows-document-icons.ps1', import.meta.url)

async function fixture(action) {
  const dir = await mkdtemp(path.join(await testScratch(), 'document-icons-'))
  const registryRoot = `Software\\ElevenMD\\Tests\\${randomUUID()}`
  try {
    const source = await readFile(scriptURL, 'utf8')
    assert.equal(source.split("$classesRoot = 'Software\\Classes'").length, 2, 'test redirects only the registry root, not the migration algorithm')
    const script = path.join(dir, 'migration.ps1')
    await writeFile(script, source.replace("$classesRoot = 'Software\\Classes'", `$classesRoot = '${registryRoot}'`))
    const target = path.join(dir, 'runtime')
    await mkdir(path.join(target, 'resources', 'icons'), { recursive: true })
    for (const name of ['ElevenMD.exe', 'unins000.exe', 'unins000.dat', 'resources/icons/elevenmd-markdown.ico', 'resources/icons/elevenmd-text.ico']) await writeFile(path.join(target, name), 'fixture')
    const driver = path.join(dir, 'driver.ps1')
    await writeFile(driver, `param([string]$Target, [string]$Root, [string]$Migration)\n$ErrorActionPreference = 'Stop'\n${action}\n`)
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver, '-Target', target, '-Root', registryRoot, '-Migration', script], { windowsHide: true, timeout: 15000 })
    return JSON.parse(stdout.trim())
  } finally {
    await run('reg.exe', ['delete', `HKCU\\${registryRoot}`, '/f'], { windowsHide: true }).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

const setup = `
$exe = Join-Path $Target 'ElevenMD.exe'
$expectedCommand = '"' + $exe + '" "%1"'
$legacy = '"' + $exe + '",0'
foreach ($id in @('ElevenMD.Markdown', 'ElevenMD.Text')) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$Root\\$id\\shell\\open\\command")
  $key.SetValue('', $expectedCommand); $key.Dispose()
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$Root\\$id\\DefaultIcon")
  $key.SetValue('', $legacy); $key.Dispose()
}
`

test('native migration refreshes only existing owned icons and is idempotent', { skip: process.platform !== 'win32' }, async () => {
  const result = await fixture(`${setup}
$first = & $Migration -Executable $exe | ConvertFrom-Json
$second = & $Migration -Executable $exe | ConvertFrom-Json
$values = @{}
foreach ($id in @('ElevenMD.Markdown','ElevenMD.Text')) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$Root\\$id\\DefaultIcon")
  $values[$id] = $key.GetValue(''); $key.Dispose()
}
[pscustomobject]@{First=$first.Changed; Second=$second.Changed; Values=$values; Target=$Target} | ConvertTo-Json -Depth 5
`)
  assert.equal(result.First, 2)
  assert.equal(result.Second, 0)
  assert.equal(result.Values['ElevenMD.Markdown'], `"${path.join(result.Target, 'resources/icons/elevenmd-markdown.ico')}",0`)
  assert.equal(result.Values['ElevenMD.Text'], `"${path.join(result.Target, 'resources/icons/elevenmd-text.ico')}",0`)
})

test('migration leaves portable copies, foreign commands, custom icons and absent registrations alone', { skip: process.platform !== 'win32' }, async () => {
  for (const scenario of ['portable', 'foreign', 'custom', 'missing-icon', 'missing-key']) {
    const result = await fixture(`${setup}
$scenario = '${scenario}'
foreach ($id in @('ElevenMD.Markdown','ElevenMD.Text')) {
  if ($scenario -eq 'foreign') {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$Root\\$id\\shell\\open\\command", $true)
    $key.SetValue('', '"C:\\Another copy\\ElevenMD.exe" "%1"'); $key.Dispose()
  }
  if ($scenario -eq 'custom') {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$Root\\$id\\DefaultIcon", $true)
    $key.SetValue('', '"C:\\Custom icon.ico",0'); $key.Dispose()
  }
  if ($scenario -eq 'missing-key') { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("$Root\\$id") }
}
if ($scenario -eq 'portable') { Remove-Item -LiteralPath (Join-Path $Target 'unins000.dat') }
if ($scenario -eq 'missing-icon') { Remove-Item -LiteralPath (Join-Path $Target 'resources\\icons') -Recurse }
$before = (& reg.exe query "HKCU\\$Root" /s 2>&1 | Out-String)
$receipt = & $Migration -Executable $exe | ConvertFrom-Json
$after = (& reg.exe query "HKCU\\$Root" /s 2>&1 | Out-String)
[pscustomobject]@{Changed=$receipt.Changed; Equal=($before -ceq $after)} | ConvertTo-Json
`)
    assert.equal(result.Changed, 0, scenario)
    assert.equal(result.Equal, true, `${scenario}: unrelated registry state must be unchanged`)
  }
})

test('startup wrapper invokes only a packaged, non-isolated Windows copy with bounded native execution', async () => {
  const { refreshDocumentIcons } = await import('../electron/document-icons.cjs')
  const calls = []
  const run = async (...args) => { calls.push(args); return { stdout: '{"Changed":2}' } }
  const exe = path.resolve('fixture/ElevenMD.exe')
  assert.equal(await refreshDocumentIcons({ execPath: exe, isPackaged: true, platform: 'win32', run }), 2)
  assert.equal(calls.length, 1)
  assert.ok(calls[0][0].endsWith('powershell.exe'))
  assert.ok(calls[0][1].includes('-File'))
  assert.equal(calls[0][1].at(-1), exe)
  assert.equal(calls[0][2].windowsHide, true)
  assert.ok(calls[0][2].timeout > 0 && calls[0][2].timeout <= 15000)
  for (const options of [{ isPackaged: false }, { platform: 'linux' }, { platform: 'darwin' }, { isolated: true }]) {
    assert.equal(await refreshDocumentIcons({ execPath: exe, isPackaged: true, platform: 'win32', run, ...options }), 0)
  }
  assert.equal(calls.length, 1)
  await assert.rejects(refreshDocumentIcons({ execPath: exe, isPackaged: true, platform: 'win32', run: async () => ({ stdout: '{"Changed":99}' }) }), /receipt/i)
  const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  assert.match(main, /refreshDocumentIcons\(/)
  assert.match(main, /isolated: Boolean\(env\.NOTEPAD_USER_DATA_DIR && !\(env\.ELEVENMD_UPDATE_ACK_PORT && env\.ELEVENMD_UPDATE_ACK_TOKEN\)\)/)
  assert.ok(main.indexOf('refreshDocumentIcons(') > main.indexOf("handle('session-ready'"), 'migration must not run before renderer restoration')
  assert.match(main, /waitForCommit: Boolean\(port && token\)/)
})

test('an uncommitted update cannot migrate registry icons, including after rollback removes new icon files', { skip: process.platform !== 'win32' }, async () => {
  const result = await fixture(`${setup}
$lock = Join-Path (Split-Path $Target) ('.' + (Split-Path $Target -Leaf) + '.elevenmd-update.lock')
@{target=$Target; jobDir=(Split-Path $Migration)} | ConvertTo-Json | Set-Content -LiteralPath $lock
$before = (& reg.exe query "HKCU\\$Root" /s | Out-String)
$pending = & $Migration -Executable $exe | ConvertFrom-Json
Remove-Item -LiteralPath (Join-Path $Target 'resources\\icons') -Recurse
Remove-Item -LiteralPath $lock
$rolledBack = & $Migration -Executable $exe | ConvertFrom-Json
$after = (& reg.exe query "HKCU\\$Root" /s | Out-String)
[pscustomobject]@{Pending=$pending.Changed; RolledBack=$rolledBack.Changed; Equal=($before -ceq $after)} | ConvertTo-Json
`)
  assert.equal(result.Pending, 0, 'reserved update must not change legacy document icons')
  assert.equal(result.RolledBack, 0)
  assert.equal(result.Equal, true, 'failed restart/rollback must leave the original icon registration intact')
})

test('native update restart waits for durable commitment and never migrates a rolled-back transaction', { skip: process.platform !== 'win32' }, async () => {
  for (const phase of ['committed', 'rolled-back']) {
    const result = await fixture(`${setup}
$lock = Join-Path (Split-Path $Target) ('.' + (Split-Path $Target -Leaf) + '.elevenmd-update.lock')
$journal = Join-Path (Split-Path $Migration) 'transaction.json'
@{target=$Target; jobDir=(Split-Path $Migration)} | ConvertTo-Json | Set-Content -LiteralPath $lock
@{phase='applied'; target=$Target} | ConvertTo-Json | Set-Content -LiteralPath $journal
$finish = Start-Job -ArgumentList $lock,$journal,$Target,$Root,$legacy -ScriptBlock {
  param($Lock,$Journal,$Target,$Root,$Legacy)
  Start-Sleep -Milliseconds 500
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$Root\\ElevenMD.Markdown\\DefaultIcon")
  try { $unchanged = $key.GetValue('') -ceq $Legacy } finally { $key.Dispose() }
  @{phase='${phase}'; target=$Target} | ConvertTo-Json | Set-Content -LiteralPath $Journal
  Remove-Item -LiteralPath $Lock
  $unchanged
}
try { $receipt = & $Migration -Executable $exe -WaitForCommit | ConvertFrom-Json }
finally { $beforeCommit = $finish | Wait-Job | Receive-Job; $finish | Remove-Job }
[pscustomobject]@{Changed=$receipt.Changed; EarlyUnchanged=($beforeCommit -eq $true); Phase=(Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json).phase} | ConvertTo-Json
`)
    assert.equal(result.EarlyUnchanged, true, 'registry must still contain legacy icon while transaction is applied')
    assert.equal(result.Changed, phase === 'committed' ? 2 : 0)
    assert.equal(result.Phase, phase)
  }
})
