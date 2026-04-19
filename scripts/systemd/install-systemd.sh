#!/usr/bin/env bash
set -euo pipefail

install -m 0755 ./dist/linux/amphub-agent /usr/local/bin/amphub-agent
install -d -m 0755 /etc/amphub-agent /var/lib/amphub-agent
if [[ ! -f /etc/amphub-agent/config.json ]]; then
  /usr/local/bin/amphub-agent init-config
fi
install -m 0644 ./scripts/systemd/amphub-agent.service /etc/systemd/system/amphub-agent.service
systemctl daemon-reload
systemctl enable --now amphub-agent.service
