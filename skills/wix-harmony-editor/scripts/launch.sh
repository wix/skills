#!/bin/bash
# Launch a separate, headed Chrome profile for a Wix Harmony editor session.
# The Chrome DevTools endpoint is loopback-only and is never printed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PW_PORT:-9333}"
PROFILE="${WIX_HARMONY_PROFILE_DIR:-${TMPDIR:-/tmp}/wix-harmony-editor-profile}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EDITOR_URL="${1:-about:blank}"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome was not found at: $CHROME" >&2
  exit 1
fi

umask 077
mkdir -p "$PROFILE"
chmod 700 "$PROFILE"

if curl -fsS -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "Wix Harmony Chrome is already running on local CDP port ${PORT}."
  exit 0
fi

nohup "$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  "$EDITOR_URL" >"${PROFILE}/chrome.log" 2>&1 &

for _ in $(seq 1 40); do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "Wix Harmony Chrome is ready on local CDP port ${PORT}."
    exit 0
  fi
  sleep 0.5
done

echo "Chrome did not expose its local CDP endpoint. Check ${PROFILE}/chrome.log." >&2
exit 1
