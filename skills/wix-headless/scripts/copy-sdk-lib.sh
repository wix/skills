#!/usr/bin/env bash
# Copy the deterministic SDK-logic layer into a scaffolded astro project, per
# loaded vertical. These files are brand-invariant pure-SDK wrappers (no UI) —
# shipped verbatim so build agents IMPORT them rather than (mis)generating them.
# Mirrors how seed-utilities.sh ships the cross-cutting utils (wix-image/analytics).
#
# Usage:
#   bash copy-sdk-lib.sh <project-dir> <vertical> [<vertical> ...]
# e.g. bash copy-sdk-lib.sh /path/to/site stores ecom bookings gift-cards
#
# Idempotent. Run in the build-wave pre-batch, before the per-vertical build
# agents (BUILD-astro.md § Step 4.5), so the agents find these on disk and import
# them. Each agent's INSTRUCTIONS list these under "pre-copied — do NOT write".
set -euo pipefail

PROJ="${1:?usage: copy-sdk-lib.sh <project-dir> <vertical...>}"; shift
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../references/astro/lib" && pwd)"
mkdir -p "$PROJ/src/utils" "$PROJ/src/components"

copied=()
for v in "$@"; do
  case "$v" in
    stores)
      cp "$LIB/stores/categories.ts"     "$PROJ/src/utils/categories.ts"
      cp "$LIB/stores/back-in-stock.ts"  "$PROJ/src/utils/back-in-stock.ts"
      copied+=("categories.ts" "back-in-stock.ts") ;;
    ecom)
      cp "$LIB/ecom/discounts.ts"        "$PROJ/src/utils/discounts.ts"
      copied+=("discounts.ts") ;;
    bookings)
      cp "$LIB/bookings/bookingDriver.ts" "$PROJ/src/components/bookingDriver.ts"
      copied+=("bookingDriver.ts") ;;
    gift-cards)
      cp "$LIB/gift-cards/gift-cards.ts" "$PROJ/src/utils/gift-cards.ts"
      copied+=("gift-cards.ts") ;;
    *) ;; # cms, forms, blog, ecom-only-skip etc. have no shipped logic file
  esac
done
echo "copy-sdk-lib: shipped [${copied[*]:-none}] for verticals [$*]"
