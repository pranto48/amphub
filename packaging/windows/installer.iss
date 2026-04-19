#define MyAppName "AmpHub Agent"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "AmpHub"
#define MyAppExeName "amphub-agent.exe"

[Setup]
AppId={{10DF6264-EA53-4A5C-8958-0BD4CEAB5A45}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\AmpHub Agent
DefaultGroupName=AmpHub Agent
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir=..\..\dist\windows
OutputBaseFilename=amphub-agent-setup
Compression=lzma
SolidCompression=yes

[Files]
Source: "..\..\dist\windows\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\scripts\windows\install-service.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\scripts\windows\uninstall-service.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File \"{app}\\install-service.ps1\""; Flags: runhidden

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File \"{app}\\uninstall-service.ps1\""; RunOnceId: "AmpHubAgentCleanup"
