#!/usr/bin/env bash
# Copy the skill's shared utilities into the project's src/utils/ and strip the
# Astro starter cruft that ships with the blank template.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/seed-utilities.sh
#
# Run from the project directory (CWD = <project>/). The script computes its
# own location to find the shared-utilities source — no PLUGIN_ROOT or env
# variable required.
#
# Behavior:
#   - Copies <SKILL_ROOT>/shared-utilities/*.ts into src/utils/ with `cp -n`
#     (never overwrites — users can override a utility by dropping their own
#     file in first).
#   - Removes Astro starter cruft (Welcome.astro + marketing SVGs) that ships
#     with the blank template but is never imported by the build skill. A
#     2026-04-27 sanity run shipped Welcome.astro lingering in src/components/;
#     a 2026-05-03 sanity run flagged the orphaned SVG assets. The rm -f
#     invocations are unconditional but safe (-f suppresses missing-file).
#
# Shared utilities copied:
#   - wix-image.ts  — media URL resolver (used by stores, blog, cms)
#   - analytics.ts  — event tracking (used by stores, ecom, blog)
#   - ricos.ts      — Ricos JSON to HTML renderer for SSR Astro pages

set -euo pipefail

# Resolve the skill's shared-utilities directory from this script's location.
# Script lives at <SKILL_ROOT>/scripts/seed-utilities.sh.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_UTILS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/shared-utilities"

if [[ ! -d "$SHARED_UTILS_DIR" ]]; then
  echo "seed-utilities.sh: cannot find $SHARED_UTILS_DIR — skill layout broken?" >&2
  exit 1
fi

mkdir -p src/utils
cp -n "$SHARED_UTILS_DIR/"*.ts src/utils/

# Astro starter cruft cleanup (see header comment).
rm -f src/components/Welcome.astro
rm -f src/assets/astro.svg src/assets/wix.svg src/assets/background.svg
