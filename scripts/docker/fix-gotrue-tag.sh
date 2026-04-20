#!/usr/bin/env bash
set -euo pipefail

FILE_PATH="${1:-docker-compose.yml}"
TAG="${2:-v2.186.0}"

if [[ ! -f "$FILE_PATH" ]]; then
  echo "File not found: $FILE_PATH" >&2
  exit 1
fi

if rg -n "supabase/gotrue:latest" "$FILE_PATH" >/dev/null; then
  sed -i "s|supabase/gotrue:latest|supabase/gotrue:${TAG}|g" "$FILE_PATH"
  echo "Updated supabase/gotrue tag in $FILE_PATH -> ${TAG}"
else
  echo "No supabase/gotrue:latest entries found in $FILE_PATH"
fi
