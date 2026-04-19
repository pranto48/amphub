# AmpHub Agent Runtime and Packaging

This directory provides a cross-platform agent runtime and packaging scaffolding for Windows and Linux.

## Config file fields

The runtime uses a JSON config file (defaults: `/etc/amphub-agent/config.json` on Linux, `%ProgramData%\\amphub-agent\\config.json` on Windows):

- `central_server_url`
- `node_name`
- `remote_id` (generated once, then persisted)
- `private_key` / `public_key`
- `node_token` / `node_certificate`
- `heartbeat_seconds` (clamped to 10-30 seconds)

`remote_id` is persisted in state (`/var/lib/amphub-agent/state.json` on Linux, `%ProgramData%\\amphub-agent\\state.json` on Windows).

## Secure enrollment flow

On first run (when `node_token`/`node_certificate` are missing), the agent sends:

- hardware fingerprint,
- hostname,
- OS/architecture,
- `remote_id`, `node_name`, and node public key.

The agent expects an enrollment response with a signed node token/certificate and stores both in config.

## Heartbeat

Every 10-30 seconds the agent POSTs status to `/api/agent/heartbeat` with:

- `online`/`offline` status,
- local IP,
- `last_seen` timestamp,
- OS details.

## Service integration

- Linux: `scripts/systemd/amphub-agent.service` with install/uninstall helpers.
- Windows: `scripts/windows/install-service.ps1` and `scripts/windows/uninstall-service.ps1`.

Uninstall hooks call `amphub-agent cleanup`, which sends final offline heartbeat and revokes token (`/api/agent/revoke`).

## Packaging

### Linux

```bash
./packaging/linux/build-packages.sh 0.1.0
```

Artifacts:

- `dist/linux/amphub-agent-install.sh` (shell installer)
- Optional `.deb`/`.rpm` if `fpm` is installed.

### Windows

```powershell
./packaging/windows/build-installer.ps1 -Version 0.1.0
```

Artifacts:

- `dist/windows/amphub-agent.exe` staged binary
- Optional `.exe` installer if Inno Setup (`iscc.exe`) is available
- MSI path is prepared for WiX (`candle.exe`/`light.exe`) integration.
