#!/usr/bin/env bash
# Mints a fresh Wix CLI token for a migration project's site and writes it
# directly into config/wix.env as WIX_AUTH_TOKEN — never printing the value.
#
# Usage (from the migration project root):
#   bash scripts/mint-token.sh
#
# Reads WIX_SITE_ID from config/wix.env.
# Requires: npx @wix/cli@latest (logged in — check: npx @wix/cli@latest whoami)
#
# This is the canonical copy. rp-import-codegen copies it into
# migrations/<project>/scripts/mint-token.sh during project scaffolding.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/config/wix.env"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: config file not found: $CONFIG_FILE" >&2
  exit 1
fi

WIX_SITE_ID=$(grep '^WIX_SITE_ID=' "$CONFIG_FILE" | cut -d'=' -f2- | tr -d '[:space:]')

if [[ -z "$WIX_SITE_ID" ]]; then
  echo "Error: WIX_SITE_ID is blank in $CONFIG_FILE" >&2
  exit 1
fi

echo "Minting token for site $WIX_SITE_ID ..." >&2

# Capture token only on stdout; suppress CLI spinner/progress on stderr
TOKEN=$(npx @wix/cli@latest token --site "$WIX_SITE_ID" 2>/dev/null | tr -d '[:space:]')

if [[ -z "$TOKEN" ]]; then
  echo "Error: token command returned empty output" >&2
  exit 1
fi

# Write into config (replace existing line, or append).
# Not `sed -i`: BSD/macOS sed requires a backup-suffix argument for -i, so the
# portable-looking GNU form silently consumes the expression as the suffix.
# The token is passed through the environment, never as an awk -v value or on a
# command line, so no escape processing can corrupt it and it stays out of `ps`.
if grep -q '^WIX_AUTH_TOKEN=' "$CONFIG_FILE"; then
  TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/wix.env.XXXXXX")"
  trap 'rm -f "$TMP_FILE"' EXIT
  RP_NEW_TOKEN="$TOKEN" awk '
    /^WIX_AUTH_TOKEN=/ { print "WIX_AUTH_TOKEN=" ENVIRON["RP_NEW_TOKEN"]; next }
    { print }
  ' "$CONFIG_FILE" > "$TMP_FILE"
  # Copy contents rather than mv, so the config file keeps its own permissions.
  cat "$TMP_FILE" > "$CONFIG_FILE"
  rm -f "$TMP_FILE"
else
  printf '\nWIX_AUTH_TOKEN=%s\n' "$TOKEN" >> "$CONFIG_FILE"
fi

TOKEN_LEN=${#TOKEN}
unset TOKEN

echo "✓ WIX_AUTH_TOKEN written to config/wix.env ($TOKEN_LEN chars)" >&2
