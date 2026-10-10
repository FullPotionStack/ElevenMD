param(
  [Parameter(Mandatory = $true)][int]$TargetProcessId,
  [Parameter(Mandatory = $true)][string]$FilePath,
  [int]$TimeoutMs = 15000,
  [switch]$Cancel
)
$ErrorActionPreference = 'Stop'
if ($TargetProcessId -le 0 -or $TimeoutMs -lt 100 -or $TimeoutMs -gt 15000) {
  throw 'Invalid process ID or native dialog timeout.'
}
if (-not [System.IO.Path]::IsPathRooted($FilePath) -or [System.IO.File]::Exists($FilePath)) {
  throw 'Native dialog tests require a new absolute fixture path.'
}
# Language-independent Win32 controls, scoped to the actual Electron browser PID.
# No SendKeys, foreground activation, mocked Electron dialogs, or desktop-wide clicks.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeSaveDialog {
  public delegate bool Callback(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr unused);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, Callback callback, IntPtr unused);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder value, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, string lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] public static extern IntPtr ReadMessageTimeout(IntPtr hwnd, uint msg, IntPtr wparam, StringBuilder lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  public static string ClassName(IntPtr hwnd) {
    var value = new StringBuilder(256);
    GetClassName(hwnd, value, value.Capacity);
    return value.ToString();
  }
  public static IntPtr Dialog(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hwnd, unused) => {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner == pid && IsWindowVisible(hwnd) && ClassName(hwnd) == "#32770") {
        found = hwnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static IntPtr Control(IntPtr dialog, int id, string className) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dialog, (hwnd, unused) => {
      if (GetDlgCtrlID(hwnd) == id && ClassName(hwnd) == className) {
        found = hwnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$deadline = [System.Diagnostics.Stopwatch]::StartNew()
while ($deadline.ElapsedMilliseconds -lt $TimeoutMs) {
  $dialog = [NativeSaveDialog]::Dialog($TargetProcessId)
  if ($dialog -ne [IntPtr]::Zero) {
    $edit = [NativeSaveDialog]::Control($dialog, 1001, 'Edit')
    $save = [NativeSaveDialog]::Control($dialog, 1, 'Button')
    $cancelButton = [NativeSaveDialog]::Control($dialog, 2, 'Button')
    if ($edit -ne [IntPtr]::Zero -and $save -ne [IntPtr]::Zero -and $cancelButton -ne [IntPtr]::Zero) {
      $button = $cancelButton
      if (-not $Cancel) {
        $result = [IntPtr]::Zero
        if ([NativeSaveDialog]::SendMessageTimeout($edit, 0x000C, [IntPtr]::Zero, $FilePath, 2, 2000, [ref]$result) -eq [IntPtr]::Zero -or $result -eq [IntPtr]::Zero) {
          throw 'Could not set the native filename field.'
        }
        $value = New-Object System.Text.StringBuilder ($FilePath.Length + 1)
        if ([NativeSaveDialog]::ReadMessageTimeout($edit, 0x000D, [IntPtr]$value.Capacity, $value, 2, 2000, [ref]$result) -eq [IntPtr]::Zero -or $value.ToString() -cne $FilePath) {
          throw 'Native filename field did not retain the exact fixture path.'
        }
        $button = $save
      }
      if (-not [NativeSaveDialog]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw 'Could not invoke the native dialog button.'
      }
      # Posting BM_CLICK only queues the action. Success requires destruction of
      # this exact dialog HWND, not disappearance of any other PID-owned dialog.
      # Discovery and closure share the same capped timeout budget.
      while ([NativeSaveDialog]::IsWindow($dialog)) {
        [uint32]$owner = 0
        [void][NativeSaveDialog]::GetWindowThreadProcessId($dialog, [ref]$owner)
        # The HWND may have been destroyed between IsWindow and the owner read.
        if (-not [NativeSaveDialog]::IsWindow($dialog)) { break }
        if ($owner -ne $TargetProcessId) {
          throw "Native Save dialog HWND $dialog changed owner while waiting for browser PID $TargetProcessId."
        }
        if ($deadline.ElapsedMilliseconds -ge $TimeoutMs) {
          throw "Native Save dialog did not close for browser PID $TargetProcessId (HWND=$dialog, cancel=$Cancel) within $TimeoutMs ms; the posted button click may have been ignored."
        }
        Start-Sleep -Milliseconds 100
      }
      Write-Output "Verified native dialog closure for browser PID $TargetProcessId (HWND=$dialog, cancel=$Cancel)."
      exit 0
    }
  }
  Start-Sleep -Milliseconds 100
}
throw "No usable native Save dialog for browser PID $TargetProcessId within $TimeoutMs ms."
