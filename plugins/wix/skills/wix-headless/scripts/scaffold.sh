#!/usr/bin/env bash
# Scaffold a new Wix Managed Headless project using the CLI's preset blank template.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/scaffold.sh <folder-name> "<Brand Name>" [--frontend astro|custom]
#
# <folder-name>:  lowercase letters, numbers, and hyphens only; must start with a
#                 letter or number. Becomes the local project directory name.
# <Brand Name>:   human-readable business name; quote if it contains spaces. The
#                 CLI derives the Wix project display-name and URL slug from it, so
#                 it must include at least one English letter or number.
# --frontend:     the frontend axis. Defaults to "astro" — the only supported (and
#                 only scaffolded) frontend. "custom" (any non-astro frontend) is
#                 NOT scaffolded yet: Discovery routes custom to the not-available
#                 stub (references/custom/INSTRUCTIONS.md) before scaffold ever runs,
#                 so this script should only ever be invoked with "astro". If it is
#                 invoked with "custom" it exits 4 (recognized, not staged).
#
# After scaffold succeeds, read <folder-name>/wix.config.json to extract appId
# (project's appId) and siteId (used as --site for `wix token` and in REST call
# bodies). The orchestrator does that read; this script just runs the npm create.
#
# Behavior:
#   - Pre-flight validates the folder name syntax (regex ^[a-z0-9][a-z0-9-]*$).
#   - Pre-flight requires both positional args.
#   - Runs `npm create @wix/new@latest headless` with --no-publish + --skip-install
#     so the orchestrator can deferred-install with its own package set.
#   - Passes bare `--site-template` so non-interactive scaffolding stays on the
#     blank starter. Without it, @wix/create-new (>=0.0.72) prompts for a template
#     choice and aborts in a non-TTY agent shell ("not supported in non-interactive
#     terminals").
#
# Exit codes:
#   0 — ok
#   2 — argument validation failed (bad folder name, missing args, unknown --frontend value)
#   3 — Wix CLI not logged in (defensive; the Discovery pre-flight is the primary check)
#   4 — frontend value recognized but not scaffolded yet (custom today)
#   <other> — npm create failed; stderr surfaced to caller for orchestrator-side
#             recovery (auth / other scaffold failures live in the orchestrator).

set -euo pipefail

FRONTEND="astro"
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --frontend)
      if [[ $# -lt 2 ]]; then
        echo "scaffold.sh: --frontend requires a value (astro|custom)." >&2
        exit 2
      fi
      FRONTEND="$2"
      shift 2
      ;;
    --frontend=*)
      FRONTEND="${1#--frontend=}"
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 2 || -z "${POSITIONAL[0]:-}" || -z "${POSITIONAL[1]:-}" ]]; then
  echo "scaffold.sh: both positional args required. Got folder-name='${POSITIONAL[0]:-}' brand-name='${POSITIONAL[1]:-}'." >&2
  echo "Usage: bash scaffold.sh <folder-name> \"<Brand Name>\" [--frontend astro|custom] — folder name first, brand quoted." >&2
  exit 2
fi

case "$FRONTEND" in
  astro)
    ;;
  custom)
    echo "scaffold.sh: --frontend=custom is not scaffolded yet — astro is the only supported frontend." >&2
    echo "Discovery routes custom (non-astro) frontends to references/custom/INSTRUCTIONS.md (the not-available stub) before scaffold; this script should not be invoked with 'custom'." >&2
    exit 4
    ;;
  *)
    echo "scaffold.sh: unknown --frontend value '$FRONTEND'. Allowed: astro, custom." >&2
    exit 2
    ;;
esac

if [[ ! "${POSITIONAL[0]}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "scaffold.sh: folder-name='${POSITIONAL[0]}' is not valid." >&2
  echo "Folder name must contain only lowercase letters, numbers, and hyphens, and start with a letter or number." >&2
  echo "Derive it from the brand as a lowercase, npm-safe directory name." >&2
  exit 2
fi

# Defensive auth check — DISCOVERY.md's pre-flight should have caught this
# already, but scaffold.sh is also a documented standalone entry point
# (SKILL.md § "When NOT to use this skill"). `npm create @wix/new` requires
# an active CLI session and otherwise fails mid-run with an opaque error.
# `wix whoami` exits non-zero on a logged-out session and prints the
# authenticated email + user id when logged in.
if ! npx @wix/cli@latest whoami >/dev/null 2>&1; then
  echo "scaffold.sh: not logged in to Wix CLI." >&2
  echo "Run 'npx @wix/cli@latest login' and retry." >&2
  exit 3
fi

npm create @wix/new@latest headless -- \
  --business-name "${POSITIONAL[1]}" \
  --folder-name "${POSITIONAL[0]}" \
  --site-template \
  --no-publish \
  --skip-install
