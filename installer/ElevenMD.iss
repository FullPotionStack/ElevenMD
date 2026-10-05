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
#define SourceDir "..\release\win-" + AppVersion + "-unpacked"

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
OutputDir=..\release
OutputBaseFilename={#InstallerPrefix}-{#AppVersion}
SetupIconFile=..\public\elevenmd.ico
UninstallDisplayIcon={app}\{#AppExe}
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ChangesAssociations=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "filemenu"; Description: "Add ‘Open with ElevenMD’ to .md, .markdown and .txt Explorer menus"; GroupDescription: "Explorer integration:"; Flags: checkedonce
Name: "associate"; Description: "Register ElevenMD as an available app for .md, .markdown and .txt files (you can choose defaults in Windows Settings)"; GroupDescription: "File types:"; Flags: checkedonce
Name: "defaultapps"; Description: "Open Windows Default apps settings when installation finishes"; GroupDescription: "File types:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ElevenMD"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"
Name: "{autodesktop}\ElevenMD"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Register only optional, app-owned entries. Never write extension defaults.
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "ElevenMD"; Tasks: associate or filemenu; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"; Tasks: associate or filemenu
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate or filemenu
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".txt"; ValueData: ""; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdMD}"; ValueType: string; ValueName: ""; ValueData: "ElevenMD Markdown document"; Tasks: associate; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdMD}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdMD}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdText}"; ValueType: string; ValueName: ""; ValueData: "ElevenMD Text document"; Tasks: associate; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdText}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\{#AppProgIdText}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "{#AppProgIdMD}"; ValueData: ""; Tasks: associate; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "{#AppProgIdMD}"; ValueData: ""; Tasks: associate; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: string; ValueName: "{#AppProgIdText}"; ValueData: ""; Tasks: associate; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "ElevenMD"; Tasks: associate; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "A local-first Markdown and plain-text editor"; Tasks: associate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: associate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "{#AppProgIdMD}"; Tasks: associate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "{#AppProgIdMD}"; Tasks: associate
Root: HKCU; Subkey: "Software\{#AppName}\Capabilities\FileAssociations"; ValueType: string; ValueName: ".txt"; ValueData: "{#AppProgIdText}"; Tasks: associate
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "ElevenMD"; ValueData: "Software\ElevenMD\Capabilities"; Tasks: associate; Flags: uninsdeletevalue
; Icon is a named VALUE on the verb, not an Icon subkey.
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithElevenMD"; ValueType: string; ValueName: ""; ValueData: "Open with ElevenMD"; Tasks: filemenu; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithElevenMD"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: filemenu
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.md\shell\OpenWithElevenMD\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: filemenu
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithElevenMD"; ValueType: string; ValueName: ""; ValueData: "Open with ElevenMD"; Tasks: filemenu; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithElevenMD"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: filemenu
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.markdown\shell\OpenWithElevenMD\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: filemenu
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.txt\shell\OpenWithElevenMD"; ValueType: string; ValueName: ""; ValueData: "Open with ElevenMD"; Tasks: filemenu; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.txt\shell\OpenWithElevenMD"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#AppExe}"",0"; Tasks: filemenu
Root: HKCU; Subkey: "Software\Classes\SystemFileAssociations\.txt\shell\OpenWithElevenMD\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: filemenu

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch ElevenMD"; Flags: postinstall nowait skipifsilent; Check: NotUpdate
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: IsUpdate
Filename: "explorer.exe"; Parameters: "ms-settings:defaultapps"; Description: "Choose ElevenMD for .md and .txt in Windows Settings"; Flags: postinstall shellexec nowait skipifsilent; Tasks: defaultapps

[Code]
function IsUpdate: Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/UPDATE') = 0 then
      Result := True;
end;

function NotUpdate: Boolean;
begin
  Result := not IsUpdate;
end;

[UninstallDelete]
Type: dirifempty; Name: "{app}"
