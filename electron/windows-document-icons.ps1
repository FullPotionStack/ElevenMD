param([Parameter(Mandatory=$true)][string]$Executable, [switch]$WaitForCommit)
$ErrorActionPreference = 'Stop'
# Only these existing application-owned values may be migrated. Never register
# an association, change UserChoice, or modify an extension's default handler.
$classesRoot = 'Software\Classes'
$Executable = [IO.Path]::GetFullPath($Executable)
$directory = [IO.Path]::GetDirectoryName($Executable)
$changed = 0
if (!(Test-Path -LiteralPath $Executable -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $directory 'unins000.exe') -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $directory 'unins000.dat') -PathType Leaf)) {
  @{Changed=0} | ConvertTo-Json -Compress
  exit 0
}
# An updater restart must not change registry state until its file transaction
# commits. The reservation is released only after the durable terminal journal.
$lock = Join-Path ([IO.Path]::GetDirectoryName($directory)) ('.' + [IO.Path]::GetFileName($directory) + '.elevenmd-update.lock')
if (Test-Path -LiteralPath $lock) {
  if (!$WaitForCommit) { @{Changed=0} | ConvertTo-Json -Compress; exit 0 }
  try {
    $lockInfo = Get-Item -LiteralPath $lock
    if ($lockInfo.Length -gt 16384 -or ($lockInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid update reservation.' }
    $reservation = Get-Content -LiteralPath $lock -Raw | ConvertFrom-Json
    if ($reservation.target -cne $directory -or ![IO.Path]::IsPathRooted($reservation.jobDir)) { throw 'Mismatched update reservation.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ((Test-Path -LiteralPath $lock) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (Test-Path -LiteralPath $lock) { throw 'Update is not committed.' }
    $journalPath = Join-Path $reservation.jobDir 'transaction.json'
    $journalInfo = Get-Item -LiteralPath $journalPath
    if ($journalInfo.Length -gt 4194304 -or ($journalInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid update journal.' }
    $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    if ($journal.target -cne $directory -or $journal.phase -cne 'committed') { throw 'Update did not commit.' }
  } catch { @{Changed=0} | ConvertTo-Json -Compress; exit 0 }
}
$command = '"' + $Executable + '" "%1"'
$legacy = '"' + $Executable + '",0'
foreach ($entry in @(
  @{Id='ElevenMD.Markdown'; File='elevenmd-markdown.ico'},
  @{Id='ElevenMD.Text'; File='elevenmd-text.ico'}
)) {
  $icon = Join-Path $directory ('resources\icons\' + $entry.File)
  if (!(Test-Path -LiteralPath $icon -PathType Leaf)) { continue }
  $openKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$classesRoot\$($entry.Id)\shell\open\command")
  if (!$openKey) { continue }
  try { $ownsCommand = $openKey.GetValue('') -ceq $command } finally { $openKey.Dispose() }
  if (!$ownsCommand) { continue }
  $iconKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$classesRoot\$($entry.Id)\DefaultIcon", $true)
  if (!$iconKey) { continue }
  try {
    # Respect an explicitly customized icon instead of silently overwriting it.
    if ($iconKey.GetValue('') -cne $legacy) { continue }
    $desired = '"' + $icon + '",0'
    $iconKey.SetValue('', $desired, [Microsoft.Win32.RegistryValueKind]::String)
    if ($iconKey.GetValue('') -cne $desired) { throw 'Document icon update could not be verified.' }
    $changed++
  } finally { $iconKey.Dispose() }
}
if ($changed) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ElevenMDShellIcons {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
  [ElevenMDShellIcons]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}
@{Changed=$changed} | ConvertTo-Json -Compress
