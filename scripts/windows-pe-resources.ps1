param(
  [Parameter(Mandatory=$true)][ValidateSet('inspect', 'update')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Executable,
  [string]$Payload
)
$ErrorActionPreference = 'Stop'
# No external binary/tool download: use the Windows resource APIs on a build copy.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class PEResource {
    public int Type;
    public string Name;
    public bool Numeric;
    public int Language;
    public string Data;
}
public static class PEResources {
    delegate bool Names(IntPtr module, IntPtr type, IntPtr name, IntPtr arg);
    delegate bool Languages(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr arg);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryExW(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceNamesW(IntPtr module, IntPtr type, Names callback, IntPtr arg);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceLanguagesW(IntPtr module, IntPtr type, IntPtr name, Languages callback, IntPtr arg);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindResourceExW(IntPtr module, IntPtr type, IntPtr name, ushort language);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResourceW(string file, bool deleteExisting);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResourceW(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EndUpdateResourceW(IntPtr update, bool discard);
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static PEResource[] Read(string file) {
        var module = LoadLibraryExW(file, IntPtr.Zero, 2); // data file, never execute it
        if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var result = new List<PEResource>();
        try {
            foreach (int resourceType in new int[] { 3, 14, 16, 24 }) {
                Names names = delegate(IntPtr m, IntPtr t, IntPtr n, IntPtr arg) {
                    bool numeric = n.ToInt64() >= 0 && n.ToInt64() <= 65535;
                    string name = numeric ? n.ToInt64().ToString() : Marshal.PtrToStringUni(n);
                    Languages languages = delegate(IntPtr lm, IntPtr lt, IntPtr ln, ushort lang, IntPtr larg) {
                        var handle = FindResourceExW(lm, lt, ln, lang);
                        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                        uint size = SizeofResource(lm, handle);
                        var loaded = LoadResource(lm, handle);
                        var pointer = LockResource(loaded);
                        if (pointer == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                        var bytes = new byte[size];
                        Marshal.Copy(pointer, bytes, 0, bytes.Length);
                        result.Add(new PEResource { Type = resourceType, Name = name, Numeric = numeric, Language = lang, Data = Convert.ToBase64String(bytes) });
                        return true;
                    };
                    Check(EnumResourceLanguagesW(m, t, n, languages, IntPtr.Zero));
                    return true;
                };
                bool ok = EnumResourceNamesW(module, new IntPtr(resourceType), names, IntPtr.Zero);
                if (!ok && Marshal.GetLastWin32Error() != 1813) Check(false); // no resources of this type
            }
        } finally { FreeLibrary(module); }
        return result.ToArray();
    }
    static void WriteOne(IntPtr update, PEResource r, byte[] bytes) {
        IntPtr name = r.Numeric ? new IntPtr(Int32.Parse(r.Name)) : Marshal.StringToHGlobalUni(r.Name);
        try { Check(UpdateResourceW(update, new IntPtr(r.Type), name, (ushort)r.Language, bytes, bytes == null ? 0 : (uint)bytes.Length)); }
        finally { if (!r.Numeric) Marshal.FreeHGlobal(name); }
    }
    public static void Write(string file, PEResource[] replacements) {
        var previous = Read(file); // unload before opening the resource transaction
        var update = BeginUpdateResourceW(file, false);
        if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        bool committed = false;
        try {
            foreach (var r in previous) if (r.Type == 3 || r.Type == 14 || r.Type == 16) WriteOne(update, r, null);
            foreach (var r in replacements) WriteOne(update, r, Convert.FromBase64String(r.Data));
            Check(EndUpdateResourceW(update, false));
            committed = true;
        } finally { if (!committed) EndUpdateResourceW(update, true); }
    }
}
'@
$target = (Resolve-Path -LiteralPath $Executable).Path
if ($Mode -eq 'update') {
  if (-not $Payload) { throw 'Resource update payload required.' }
  $items = Get-Content -LiteralPath $Payload -Raw | ConvertFrom-Json
  $resources = @($items | ForEach-Object {
    $r = New-Object PEResource
    $r.Type = $_.type
    $r.Name = [string]$_.name
    $r.Numeric = $true
    $r.Language = $_.language
    $r.Data = $_.data
    $r
  })
  [PEResources]::Write($target, [PEResource[]]$resources)
}
$vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($target)
@{
  version = @{
    FileDescription = $vi.FileDescription; ProductName = $vi.ProductName
    OriginalFilename = $vi.OriginalFilename; InternalName = $vi.InternalName
    CompanyName = $vi.CompanyName; FileVersion = $vi.FileVersion; ProductVersion = $vi.ProductVersion
    FileMajorPart = $vi.FileMajorPart; FileMinorPart = $vi.FileMinorPart; FileBuildPart = $vi.FileBuildPart; FilePrivatePart = $vi.FilePrivatePart
    ProductMajorPart = $vi.ProductMajorPart; ProductMinorPart = $vi.ProductMinorPart; ProductBuildPart = $vi.ProductBuildPart; ProductPrivatePart = $vi.ProductPrivatePart
  }
  resources = @([PEResources]::Read($target) | ForEach-Object {
    @{ type = $_.Type; name = $(if ($_.Numeric) { [int]$_.Name } else { $_.Name }); language = $_.Language; data = $_.Data }
  })
} | ConvertTo-Json -Depth 8 -Compress
