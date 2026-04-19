#!/usr/bin/env bash
set -euo pipefail

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop amphub-agent.service || true
  /usr/local/bin/amphub-agent cleanup || true
  systemctl disable amphub-agent.service || true
  rm -f /etc/systemd/system/amphub-agent.service
  systemctl daemon-reload || true
fi

rm -f /usr/local/bin/amphub-agent
