#ifndef AppVersion
  #error AppVersion must be supplied by build-installer.mjs
#endif

#ifndef InstallerPrefix
  #error InstallerPrefix must be supplied by build-installer.mjs
#endif

#define AppName "ElevenMD"
#define AppExe "ElevenMD.exe"
#define AppId "{{6C0E4662-46BB-4C4A-B40C-6C11A157E911}}"
#define AppProgIdMD "ElevenMD.Markdown"
#define AppProgIdText "ElevenMD.Text"
; Optional build-only paths let verification use scratch without replacing release assets.
#ifndef AppSourceDir
  #define AppSourceDir "..\release\win-" + AppVersion + "-unpacked"
#endif
#ifndef BuildOutputDir
  #define BuildOutputDir "..\release"
#endif
#define SourceDir AppSourceDir

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=ElevenMD
DefaultDirName={localappdata}\Programs\ElevenMD
DefaultGroupName=ElevenMD
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#BuildOutputDir}
OutputBaseFilename={#InstallerPrefix}-{#AppVersion}
SetupIconFile=..\public\elevenmd.ico
UninstallDisplayIcon={app}\{#AppExe}
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ChangesAssociations=NotPortableUpdate
Uninstallable=NotPortableUpdate
CreateUninstallRegKey=NotPortableUpdate
; The updater closes only ElevenMD after checkpointing. Do not stop injected security services.
CloseApplications=no
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked; Check: NotPortableUpdate
Name: "filemenu"; Description: "Add ‘Open with ElevenMD’ to .md, .markdown and .txt Explorer menus"; GroupDescription: "Explorer integration:"; Flags: checkedonce; Check: NotPortableUpdate
Name: "associate"; Description: "Register ElevenMD as an available app for .md, .markdown and .txt files (you can choose defaults in Windows Settings)"; GroupDescription: "File types:"; Flags: checkedonce; Check: NotPortableUpdate
Name: "defaultapps"; Description: "Open Windows Default apps settings when installation finishes"; GroupDescription: "File types:"; Flags: unchecked; Check: NotPortableUpdate

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; BeforeInstall: CheckRuntimeFileWritable

[Icons]
Name: "{autoprograms}\ElevenMD"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"; Check: NotPortableUpdate
Name: "{autodesktop}\ElevenMD"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon; Check: NotPortableUpdate

[Registry]
; Register only optional, app-owned entries. Never write extension defaults.
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "ElevenMD"; Tasks: associate or filemenu; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"; Tasks: associate or filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate or filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".txt"; ValueData: ""; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdMD}"; ValueType: string; ValueName: ""; ValueData: "ElevenMD Markdown document"; Tasks: associate; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdMD}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\resources\icons\elevenmd-markdown.ico"",0"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdMD}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdText}"; ValueType: string; ValueName: ""; ValueData: "ElevenMD Text document"; Tasks: associate; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdText}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\resources\icons\elevenmd-text.ico"",0"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdText}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "{#AppProgIdMD}"; ValueData: ""; Tasks: associate; Flags: uninsdeletevalue; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "{#AppProgIdMD}"; ValueData: ""; Tasks: associate; Flags: uninsdeletevalue; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: string; ValueName: "{#AppProgIdText}"; ValueData: ""; Tasks: associate; Flags: uninsdeletevalue; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "ElevenMD"; Tasks: associate; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "A local-first Markdown and plain-text editor"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "{#AppProgIdMD}"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "{#AppProgIdMD}"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".txt"; ValueData: "{#AppProgIdText}"; Tasks: associate; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "ElevenMD"; ValueData: "Software\ElevenMD\Capabilities"; Tasks: associate; Flags: uninsdeletevalue; Check: NotPortableUpdate
; Icon is a named VALUE on the verb, not an Icon subkey.
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithElevenMD"; ValueType: string; ValueName: ""; ValueData: "Open with ElevenMD"; Tasks: filemenu; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithElevenMD"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithElevenMD\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithElevenMD"; ValueType: string; ValueName: ""; ValueData: "Open with ElevenMD"; Tasks: filemenu; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithElevenMD"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithElevenMD\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.txt\shell\OpenWithElevenMD"; ValueType: string; ValueName: ""; ValueData: "Open with ElevenMD"; Tasks: filemenu; Flags: uninsdeletekey; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.txt\shell\OpenWithElevenMD"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: filemenu; Check: NotPortableUpdate
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.txt\shell\OpenWithElevenMD\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: filemenu; Check: NotPortableUpdate

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch ElevenMD"; Flags: postinstall nowait skipifsilent; Check: NotUpdate
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: UpdateOwnsRestart
Filename: "explorer.exe"; Parameters: "ms-settings:defaultapps"; Description: "Choose ElevenMD for .md and .txt in Windows Settings"; Flags: postinstall shellexec nowait skipifsilent; Tasks: defaultapps; Check: NotPortableUpdate

[Code]
var
  UpdateParentHandle: THandle;

function OpenProcess(DesiredAccess: Cardinal; InheritHandle: Boolean; ProcessId: Cardinal): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(Handle: THandle; Milliseconds: Cardinal): Cardinal;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';
function QueryFullProcessImageNameW(Handle: THandle; Flags: Cardinal; ImageName: String; var Size: Cardinal): Boolean;
  external 'QueryFullProcessImageNameW@kernel32.dll stdcall';
function GetTickCount64: Int64;
  external 'GetTickCount64@kernel32.dll stdcall';
function CreateFileW(Filename: String; Access, ShareMode: Cardinal; SecurityAttributes: Integer;
  CreationDisposition, Flags: Cardinal; TemplateFile: THandle): THandle;
  external 'CreateFileW@kernel32.dll stdcall';

function HasSwitch(const Switch: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Switch) = 0 then
      Result := True;
end;

function IsUpdate: Boolean;
begin
  Result := HasSwitch('/UPDATE');
end;

function UpdateOwnsRestart: Boolean;
begin
  Result := IsUpdate and not HasSwitch('/EXTERNALUPDATER');
end;

function NotUpdate: Boolean;
begin
  Result := not IsUpdate;
end;

function IsPortableUpdate: Boolean;
begin
  Result := HasSwitch('/PORTABLEUPDATE');
end;

function NotPortableUpdate: Boolean;
begin
  Result := not IsPortableUpdate;
end;

// Accept exactly one explicit absolute target; never fall back to a registered install.
function ExplicitUpdateDirectory: String;
var
  I, Count: Integer;
  Value: String;
begin
  Result := '';
  Count := 0;
  for I := 1 to ParamCount do
    if CompareText(Copy(ParamStr(I), 1, 5), '/DIR=') = 0 then begin
      Count := Count + 1;
      Value := Copy(ParamStr(I), 6, MaxInt);
    end;
  if (Count <> 1) or (Length(Value) < 4) then Exit;
  // Reject relative, root-only, expandable and UNC targets. Launcher supplies a local runtime path.
  if (Copy(Value, 2, 2) <> ':\') or (Pos('{', Value) > 0) or (Pos('"', Value) > 0) then Exit;
  Result := RemoveBackslashUnlessRoot(ExpandFileName(Value));
  if Length(Result) <= 3 then Result := '';
end;

function UpdateRefused(const Reason: String): Boolean;
begin
  Log(Reason);
  SuppressibleMsgBox(Reason + #13#10 + 'No files were replaced. Restart ElevenMD and retry.', mbError, MB_OK, IDOK);
  Result := False;
end;

function InitializeSetup: Boolean;
var
  Target, PidValue: String;
  ParentPid: Cardinal;
  ParsedPid: Int64;
  I, PidCount: Integer;
begin
  Result := False;
  UpdateParentHandle := 0;
  if IsPortableUpdate and (not IsUpdate) then begin
    Result := UpdateRefused('Portable update requires /UPDATE.');
    Exit;
  end;
  if not IsUpdate then begin
    Result := True;
    Exit;
  end;
  PidCount := 0;
  for I := 1 to ParamCount do
    if CompareText(Copy(ParamStr(I), 1, 11), '/PARENTPID=') = 0 then begin
      PidCount := PidCount + 1;
      PidValue := Copy(ParamStr(I), 12, MaxInt);
    end;
  Target := ExplicitUpdateDirectory;
  if (Target = '') or not FileExists(AddBackslash(Target) + '{#AppExe}') then begin
    Result := UpdateRefused('Update refused: missing explicit existing application target.');
    Exit;
  end;
  if IsPortableUpdate and (FileExists(AddBackslash(Target) + 'unins000.exe') or
      FileExists(AddBackslash(Target) + 'unins000.dat')) then begin
    Result := UpdateRefused('Portable update refused: target contains installation metadata.');
    Exit;
  end;
  // Published older installed copies pass /UPDATE and /DIR but no parent PID.
  // Keep their one-time transition available only for an explicit installed target.
  // Portable copies without a target must never fall back to a normal installation.
  if (PidCount = 0) and NotPortableUpdate then begin
    if FileExists(AddBackslash(Target) + 'unins000.exe') and
        FileExists(AddBackslash(Target) + 'unins000.dat') then
      Result := True
    else
      Result := UpdateRefused('This older updater cannot identify an installed copy safely. Download the matching portable archive or installer manually.');
    Exit;
  end;
  ParsedPid := StrToInt64Def(PidValue, 0);
  if (PidCount <> 1) or (ParsedPid <= 0) or (ParsedPid > $FFFFFFFF) then begin
    Result := UpdateRefused('Update refused: invalid parent PID.');
    Exit;
  end;
  ParentPid := ParsedPid;
  // SYNCHRONIZE + PROCESS_QUERY_LIMITED_INFORMATION, no termination rights.
  // Hold this handle from initialization so PID reuse cannot change the waited process.
  UpdateParentHandle := OpenProcess($00101000, False, ParentPid);
  if UpdateParentHandle = 0 then begin
    // ERROR_INVALID_PARAMETER means this exact PID has already exited.
    if DLLGetLastError <> 87 then begin
      Result := UpdateRefused('Update refused: cannot safely open parent process.');
      Exit;
    end;
  end;
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ParentImage: String;
  ImageLength, WaitResult: Cardinal;
  Deadline: Int64;
begin
  Result := '';
  if not IsUpdate then Exit;
  if CompareText(ExplicitUpdateDirectory, ExpandConstant('{app}')) <> 0 then begin
    Result := 'The update target changed unexpectedly. No files were replaced.';
    Exit;
  end;
  if UpdateParentHandle = 0 then Exit;
  try
    // The app may have quit after OpenProcess succeeded. A signaled held handle
    // already proves this exact process ended; querying its image can now fail.
    if WaitForSingleObject(UpdateParentHandle, 0) = 0 then Exit;
    SetLength(ParentImage, 32768);
    ImageLength := Length(ParentImage);
    if not QueryFullProcessImageNameW(UpdateParentHandle, 0, ParentImage, ImageLength) then begin
      if WaitForSingleObject(UpdateParentHandle, 0) = 0 then Exit;
      Result := 'Cannot verify the ElevenMD update parent. No files were replaced.';
      Exit;
    end;
    SetLength(ParentImage, ImageLength);
    if CompareText(ParentImage, ExpandConstant('{app}\{#AppExe}')) <> 0 then begin
      Result := 'The update parent is not this ElevenMD executable. No files were replaced.';
      Exit;
    end;
    WizardForm.StatusLabel.Caption := 'Waiting for ElevenMD to finish saving and close...';
    Deadline := GetTickCount64() + 60000;
    repeat
      WaitResult := WaitForSingleObject(UpdateParentHandle, 100);
      if WaitResult = 0 then Exit;
      if WaitResult <> 258 then begin
        Result := 'Cannot wait safely for ElevenMD. No files were replaced.';
        Exit;
      end;
    until GetTickCount64() >= Deadline;
    Result := 'ElevenMD did not close within 60 seconds. No files were replaced. Please restart it and retry.';
  finally
    CloseHandle(UpdateParentHandle);
    UpdateParentHandle := 0;
  end;
end;

procedure CheckRuntimeFileWritable;
var
  Filename: String;
  Handle: THandle;
begin
  if not IsUpdate then Exit;
  Filename := ExpandConstant(CurrentFilename);
  if not FileExists(Filename) then Exit;
  // No truncation or deletion. Refuse locked/read-only shipped targets before
  // Inno can offer Ignore and then accidentally restart a mixed runtime.
  Handle := CreateFileW(Filename, $40000000, 0, 0, 3, $80, 0);
  if Handle = THandle(-1) then
    RaiseException('The update cannot replace a locked or read-only runtime file: ' + Filename);
  CloseHandle(Handle);
end;

procedure DeinitializeSetup;
begin
  if UpdateParentHandle <> 0 then begin
    CloseHandle(UpdateParentHandle);
    UpdateParentHandle := 0;
  end;
end;

[UninstallDelete]
Type: dirifempty; Name: "{app}"
