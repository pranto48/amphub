param(
  [string]$BinaryPath = "C:\Program Files\AmpHub Agent\amphub-agent.exe",
  [string]$ConfigPath = "C:\ProgramData\amphub-agent\config.json"
)

$serviceName = "AmpHubAgent"

if (!(Test-Path $BinaryPath)) {
  throw "Binary not found at $BinaryPath"
}

if (!(Test-Path $ConfigPath)) {
  & $BinaryPath init-config
}

sc.exe create $serviceName binPath= "\"$BinaryPath\" run" start= auto
sc.exe description $serviceName "AmpHub Remote Agent"
sc.exe failure $serviceName reset= 60 actions= restart/5000
sc.exe start $serviceName
Write-Host "Installed and started $serviceName"
