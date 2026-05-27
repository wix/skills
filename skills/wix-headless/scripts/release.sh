#!/usr/bin/env bash
# Build the project and release to production. Unlike preview.sh, this populates
# the Frontend link in dashboard → Settings → Headless Settings → Manage URLs,
# which Wix injects into transactional emails (order confirmations, password
# resets, member invites). Use release.sh for production deploys.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/release.sh
#
# Run from the project directory (CWD = <project>/). Requires wix.config.json.
#
# Output: stdout is the released URL that `npx @wix/cli release` printed
# (extracted from the line `Site published on <url>`); the orchestrator
# captures it as outcome.releaseUrl in run.json. All other CLI output goes
# to stderr.
#
# Exit codes:
#   0 — ok; release URL on stdout
#   <other> — build or release failed; stderr surfaces the underlying error.
#             Build failures are code bugs (TypeScript / Astro / missing
#             module) — the orchestrator does NOT retry. On a release auth
#             failure the orchestrator runs `npx @wix/cli login` itself per
#             SKILL.md § "Authentication" (background, surface the device code,
#             resume) — it does NOT stop and punt to the user.

set -euo pipefail

npx @wix/cli build 1>&2

RELEASE_OUTPUT="$(mktemp)"
trap 'rm -f "$RELEASE_OUTPUT"' EXIT

npx @wix/cli release 2>&1 | tee "$RELEASE_OUTPUT" 1>&2

# CLI prints `Site published on <url>` — extract the URL after that marker.
# Fall back to the first https://*.wix-host.com URL if the marker line is
# not found (CLI wording may vary between versions).
RELEASE_URL="$(sed -nE 's/.*Site published on ([^[:space:]]+).*/\1/p' "$RELEASE_OUTPUT" | head -n 1 || true)"
if [[ -z "$RELEASE_URL" ]]; then
  RELEASE_URL="$(grep -oE 'https://[A-Za-z0-9.-]+\.wix-host\.com[^[:space:]]*' "$RELEASE_OUTPUT" | head -n 1 || true)"
fi

if [[ -z "$RELEASE_URL" ]]; then
  echo "release.sh: could not extract a release URL from release output" >&2
  exit 1
fi

echo "$RELEASE_URL"
