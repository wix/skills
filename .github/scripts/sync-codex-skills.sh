#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/skills"
TARGET_DIR="${REPO_ROOT}/codex-skills"

SKILLS=(
  wix-app
  wix-manage
  wix-design-system
  wix-docs
  wix-headless-kit
  wix-headless-templates
)

mkdir -p "$TARGET_DIR"
for skill in "${SKILLS[@]}"; do
  rsync -a --delete "${SOURCE_DIR}/${skill}/" "${TARGET_DIR}/${skill}/"
done

# The only Codex-specific change: point wix-manage at the WixREADME tool first.
WIX_MANAGE_SKILL="${TARGET_DIR}/wix-manage/SKILL.md"
export START_HERE_BLOCK="$(cat <<'BLOCK'
## Start Here — Wix MCP

### Call the `WixREADME` tool
Must be read at the start of any flow. How to work with the Wix MCP: source-of-truth rules, the discovery-and-call flow, batching calls into one invocation, and loading site context.

---
BLOCK
)"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
awk '
  !inserted && /^# / { print; print ""; print ENVIRON["START_HERE_BLOCK"]; inserted = 1; next }
  { print }
  END { if (!inserted) { print "ERROR: no # heading found" > "/dev/stderr"; exit 1 } }
' "$WIX_MANAGE_SKILL" > "$TMP_FILE"
cat "$TMP_FILE" > "$WIX_MANAGE_SKILL"
