#!/usr/bin/env bash
# Mints a fresh Wix CLI token for a migration project's site and writes it
# directly into config/wix.env as WIX_AUTH_TOKEN — never printing the value.
#
# Usage (from the migration project root):
#   bash scripts/mint-token.sh
#
# This helper runs from a project's scripts/ directory: it finds config/wix.env one level up.
# A quick import copies it there (scripts/quick-run.js does this itself).
#
# Reads WIX_SITE_ID from config/wix.env.
# Requires: the installed Wix CLI (logged in — check: npx --no-install wix whoami)
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

# The token is read from stdout only; the CLI's stderr is kept just to explain a failure.
# The token is the first line that holds one: the leading run of printable, space-free characters, ending at the end of
# the line or at the first non-ASCII character. An out-of-date CLI draws an "update available" box after the token,
# which can start on the token's own line. This is the same rule as tokenFromOutput in scripts/wix-destination.js.
# The CLI's whole output is captured first (nothing it writes after the token can hit a closed pipe), with its
# exit code and its own error words. A token is read only when the CLI succeeded (a failing CLI may print a word).
CLI_ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/wix-token-err.XXXXXX")"
CLI_EXIT=0
CLI_OUT=$(npx --no-install wix token --site "$WIX_SITE_ID" 2>"$CLI_ERR_FILE") || CLI_EXIT=$?
CLI_LOGIN=0
if grep -qiE 'logged in|log in|login' "$CLI_ERR_FILE"; then CLI_LOGIN=1; fi
CLI_ERR=$(tail -n 3 "$CLI_ERR_FILE" | tr '\n' ' ' | cut -c1-300)
rm -f "$CLI_ERR_FILE"
TOKEN=""
[[ "$CLI_EXIT" -eq 0 ]] && TOKEN=$(printf '%s\n' "$CLI_OUT" | LC_ALL=C sed -nE -e '/^[[:space:]]*[!-~]+([^ -~]|[[:space:]]*$)/{s/^[[:space:]]*([!-~]+).*/\1/;p;:rest' -e 'n;b rest' -e '}')
unset CLI_OUT

if [[ -z "$TOKEN" ]]; then
  # Only the CLI's own words say whether the login is the problem (a logged-out CLI says it must be logged in).
  # A missing CLI, the network or no access to this site keep their own words, so a new login is not asked for.
  if [[ "$CLI_EXIT" -eq 0 || "$CLI_LOGIN" -eq 1 ]]; then
    echo "Error: token command returned empty output (the Wix CLI login is needed: npx --no-install wix whoami) ${CLI_ERR}" >&2
  else
    echo "Error: wix token failed (exit $CLI_EXIT): ${CLI_ERR:-no error text}" >&2
  fi
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
