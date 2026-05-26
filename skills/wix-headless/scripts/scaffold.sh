#!/usr/bin/env bash
# Scaffold a new Wix Managed Headless project using the CLI's preset blank template.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/scaffold.sh <project-slug> "<Brand Name>"
#
# <project-slug>: 3-20 lowercase alphanumeric chars (no hyphens, no spaces) — the
#                 Wix CLI rejects anything else. Becomes the project directory name.
# <Brand Name>:   human-readable business name; quote if it contains spaces.
#
# After scaffold succeeds, read <project-slug>/wix.config.json to extract appId
# (project's appId) and siteId (used as --site for `wix token` and in REST call
# bodies). The orchestrator does that read; this script just runs the npm create.
#
# Behavior:
#   - Pre-flight validates the slug (regex ^[a-z0-9]{3,20}$).
#   - Pre-flight requires both args.
#   - Runs `npm create @wix/new@latest headless` with --no-publish + --skip-install
#     so the orchestrator can deferred-install with its own package set.
#   - Passes bare `--site-template` so non-interactive scaffolding stays on the
#     blank starter.
#
# Exit codes:
#   0 — ok
#   2 — argument validation failed
#   3 — Wix CLI not logged in (defensive; the Discovery pre-flight is the primary check)
#   <other> — npm create failed; stderr surfaced to caller for orchestrator-side
#             recovery (auth / other scaffold failures live in the orchestrator).

set -euo pipefail

if [[ $# -lt 2 || -z "${1:-}" || -z "${2:-}" ]]; then
  echo "scaffold.sh: both args required. Got project-slug='${1:-}' brand-name='${2:-}'." >&2
  echo "Usage: bash scaffold.sh <slug> \"<Brand Name>\" — slug first, brand quoted." >&2
  exit 2
fi

if [[ ! "$1" =~ ^[a-z0-9]{3,20}$ ]]; then
  echo "scaffold.sh: project-slug='$1' is not valid." >&2
  echo "Slug must be 3-20 lowercase alphanumeric chars (no hyphens, no spaces)." >&2
  echo "Derive from the brand: lowercase, strip non-[a-z0-9], truncate to 20." >&2
  exit 2
fi

# Defensive auth check — DISCOVERY.md's pre-flight should have caught this
# already, but scaffold.sh is also a documented standalone entry point
# (SKILL.md § "When NOT to use this skill"). `npm create @wix/new` requires
# an active CLI session and otherwise fails mid-run with an opaque error.
# `wix whoami` exits non-zero on a logged-out session and prints the
# authenticated email + user id when logged in.
if ! npx @wix/cli whoami >/dev/null 2>&1; then
  echo "scaffold.sh: not logged in to Wix CLI." >&2
  echo "Run 'npx @wix/cli login' and retry." >&2
  exit 3
fi

npm create @wix/new@latest headless -- \
  --business-name "$2" \
  --project-name "$1" \
  --site-template \
  --no-publish \
  --skip-install
