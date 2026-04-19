#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/linux"
VERSION="${1:-0.1.0}"

mkdir -p "$DIST_DIR"
cp "$ROOT_DIR/agent/src/agent.mjs" "$DIST_DIR/amphub-agent"
chmod +x "$DIST_DIR/amphub-agent"

cat > "$DIST_DIR/amphub-agent-install.sh" <<INSTALL
#!/usr/bin/env bash
set -euo pipefail
install -m 0755 ./amphub-agent /usr/local/bin/amphub-agent
install -d -m 0755 /etc/amphub-agent /var/lib/amphub-agent
/usr/local/bin/amphub-agent init-config || true
install -m 0644 ../../scripts/systemd/amphub-agent.service /etc/systemd/system/amphub-agent.service
systemctl daemon-reload
systemctl enable --now amphub-agent.service
INSTALL
chmod +x "$DIST_DIR/amphub-agent-install.sh"

if command -v fpm >/dev/null 2>&1; then
  fpm -s dir -t deb -n amphub-agent -v "$VERSION" \
    --prefix /usr/local/bin "$DIST_DIR/amphub-agent"=/amphub-agent
  fpm -s dir -t rpm -n amphub-agent -v "$VERSION" \
    --prefix /usr/local/bin "$DIST_DIR/amphub-agent"=/amphub-agent
else
  echo "fpm not installed: skipped .deb/.rpm build (shell installer was created)."
fi

echo "Linux artifacts are in $DIST_DIR"
