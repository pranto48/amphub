param([string]$Version = "0.1.0")

$root = Resolve-Path "$PSScriptRoot\..\.."
$dist = Join-Path $root "dist\windows"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Copy-Item "$root\agent\src\agent.mjs" "$dist\amphub-agent.exe" -Force

if (Get-Command iscc.exe -ErrorAction SilentlyContinue) {
  iscc.exe "$root\packaging\windows\installer.iss"
  Write-Host "Built Windows .exe installer in $dist"
} else {
  Write-Host "Inno Setup not installed; raw executable staged at $dist\\amphub-agent.exe"
}

if (Get-Command candle.exe -ErrorAction SilentlyContinue -and Get-Command light.exe -ErrorAction SilentlyContinue) {
  Write-Host "WiX tools detected. Add your .wxs authoring file to emit an .msi package."
} else {
  Write-Host "WiX not installed; .msi build skipped."
}
