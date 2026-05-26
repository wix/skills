#!/usr/bin/env bash
# Scaffold a new Wix Managed Headless project with the pure-headless blank template.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/scaffold.sh <folder-name> "<Brand Name>"
#
# <folder-name>:  lowercase letters, numbers, and hyphens only. Becomes the
#                 local project directory name.
# <Brand Name>:   human-readable business name; quote if it contains spaces.
#
# After scaffold succeeds, read <folder-name>/wix.config.json to extract appId
# (project's appId) and siteId (used for MCP calls). The orchestrator does that
# read; this script just runs the npm create.
#
# Behavior:
#   - Pre-flight validates the folder name syntax.
#   - Pre-flight requires both args.
#   - Runs `npm create @wix/new@latest headless` with --no-publish + --skip-install
#     so the orchestrator can deferred-install with its own package set.
#   - Template ID is the pure-headless blank (vibe-compatible templates trigger
#     an interactive prompt that blocks non-TTY runs).
#
# Exit codes:
#   0 — ok
#   2 — argument validation failed
#   <other> — npm create failed; stderr surfaced to caller for orchestrator-side
#             recovery (auth / invalid-template ladder lives in the orchestrator).

set -euo pipefail

if [[ $# -lt 2 || -z "${1:-}" || -z "${2:-}" ]]; then
  echo "scaffold.sh: both args required. Got folder-name='${1:-}' brand-name='${2:-}'." >&2
  echo "Usage: bash scaffold.sh <folder-name> \"<Brand Name>\" — folder name first, brand quoted." >&2
  exit 2
fi

if [[ ! "$1" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "scaffold.sh: folder-name='$1' is not valid." >&2
  echo "Folder name must contain only lowercase letters, numbers, and hyphens." >&2
  echo "Derive it from the brand as a lowercase, npm-safe directory name." >&2
  exit 2
fi

# Pure-headless blank template. Vibe-compatible templates show an interactive
# vibe setup prompt that blocks non-TTY contexts — do not substitute.
TEMPLATE_ID="blank"

npm create @wix/new@latest headless -- \
  --business-name "$2" \
  --folder-name "$1" \
  --site-template "$TEMPLATE_ID" \
  --no-publish \
  --skip-install
