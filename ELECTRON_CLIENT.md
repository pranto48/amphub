# Amphub Windows Client (amphub.exe)

This repository now includes an Electron-based Windows client installer (`amphub-setup-<version>.exe`) that installs an app executable named `amphub.exe`.

## What it does
- On first launch, shows a setup screen requesting your Amphub server URL (Docker-hosted server).
- Stores the server URL in user-local config (`client-config.json` under Electron userData).
- Opens the configured server URL in the desktop client window.
- Lets users change/reset server address from the app menu (`Amphub` menu).

## Local development
```bash
npm run electron:start
```

## Build Windows installer
```bash
npm run electron:dist:win
```

The installer artifact is generated in:
- `release/electron/amphub-setup-<version>.exe`

## Docker server connection expectations
- Enter a reachable HTTP/HTTPS URL during setup, for example:
  - `https://amphub.example.com`
  - `http://192.168.1.50:3000`
- The Windows client does not directly run Docker; it connects to your already running Amphub server endpoint.
