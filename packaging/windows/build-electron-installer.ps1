param(
  [switch]$InstallDeps
)

$ErrorActionPreference = 'Stop'

if ($InstallDeps) {
  Write-Host 'Installing npm dependencies...'
  npm ci
}

Write-Host 'Building Amphub Windows Electron installer...'
npm run electron:dist:win

Write-Host 'Done. Installer output:'
Write-Host '  release/electron/amphub-setup-<version>.exe'
