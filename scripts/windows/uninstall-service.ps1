param(
  [string]$BinaryPath = "C:\Program Files\AmpHub Agent\amphub-agent.exe"
)

$serviceName = "AmpHubAgent"

sc.exe stop $serviceName | Out-Null
if (Test-Path $BinaryPath) {
  & $BinaryPath cleanup
}
sc.exe delete $serviceName
Write-Host "Uninstalled $serviceName and revoked enrollment token"
