#!/bin/bash
set -e

# host_updater.sh - Safe background self-updater runner for AMPHUB
# This script should be run periodically (e.g., via systemd timer or cron) on the host system.

# Navigate to the project root directory where docker-compose.yml resides
# If running via systemd, it is best to set the WorkingDirectory in the systemd service.
# Otherwise, we can find the script's directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

TRIGGER_FILE="./update-shared/trigger.json"
SECRET_FILE="./update-shared/.secret"

if [ ! -f "$TRIGGER_FILE" ]; then
    # No update triggered
    exit 0
fi

echo "Found update trigger file at $TRIGGER_FILE. Validating request..."

# Parse fields from JSON (simplistic grep/sed to avoid dependency on jq)
STATUS=$(grep -o '"status": *"[^"]*"' "$TRIGGER_FILE" | cut -d'"' -f4 || true)
TIMESTAMP=$(grep -o '"timestamp": *"[^"]*"' "$TRIGGER_FILE" | cut -d'"' -f4 || true)
SIGNATURE=$(grep -o '"auth_signature": *"[^"]*"' "$TRIGGER_FILE" | cut -d'"' -f4 || true)
REQUESTED_BY=$(grep -o '"requested_by": *"[^"]*"' "$TRIGGER_FILE" | cut -d'"' -f4 || true)

if [ "$STATUS" != "TRIGGERED" ]; then
    echo "Update trigger status is not TRIGGERED (got: '$STATUS'). Skipping."
    exit 0
fi

if [ -z "$TIMESTAMP" ] || [ -z "$SIGNATURE" ]; then
    echo "Error: Missing timestamp or auth_signature in trigger file."
    exit 1
fi

if [ ! -f "$SECRET_FILE" ]; then
    echo "Error: Shared secret file '$SECRET_FILE' not found. Cannot validate signature."
    exit 1
fi

# Load the secret, trimming any trailing newlines or whitespace
SECRET=$(tr -d '\r\n[:space:]' < "$SECRET_FILE")

if [ -z "$SECRET" ]; then
    echo "Error: Shared secret is empty."
    exit 1
fi

# Compute expected HMAC-SHA256 signature using openssl on host
# Output of openssl is processed to extract the hex string (handles macOS and Linux differences)
EXPECTED_SIGNATURE=$(echo -n "$TIMESTAMP" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //' | tr -d '\r\n[:space:]')

if [ "$SIGNATURE" != "$EXPECTED_SIGNATURE" ]; then
    echo "Error: Cryptographic signature mismatch!"
    echo "  Provided: $SIGNATURE"
    echo "  Expected: $EXPECTED_SIGNATURE"
    exit 1
fi

echo "Signature validated successfully. Triggered by: $REQUESTED_BY at $TIMESTAMP."
echo "Triggering AMPHUB Docker update..."

# Pull updates from git branch
git pull origin main

# Rebuild docker images and recreate containers
docker compose build --pull
docker compose up -d --force-recreate

# Clean up trigger file to finalize update loop
rm -f "$TRIGGER_FILE"

echo "AMPHUB update completed successfully."
