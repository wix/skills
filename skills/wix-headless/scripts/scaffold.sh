#!/usr/bin/env bash
# Scaffold a new Wix Managed Headless project using the CLI's preset blank template.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/scaffold.sh <project-slug> "<Brand Name>" [--frontend astro|react-vite]
#
# <project-slug>: 3-20 lowercase alphanumeric chars (no hyphens, no spaces) — the
#                 Wix CLI rejects anything else. Becomes the project directory name.
# <Brand Name>:   human-readable business name; quote if it contains spaces.
# --frontend:     which scaffold template to use. Defaults to "astro" (current Beta).
#                 "react-vite" is reserved — the template isn't staged yet, so the
#                 script exits 4 with a "not yet staged" message.
#                 "user-provided" is an explicit rejection — integrate mode skips
#                 scaffold entirely; Discovery should never invoke this script with
#                 that value. Exits 2.
#
# After scaffold succeeds, read <project-slug>/wix.config.json to extract appId
# (project's appId) and siteId (used as --site for `wix token` and in REST call
# bodies). The orchestrator does that read; this script just runs the npm create.
#
# Behavior:
#   - Pre-flight validates the slug (regex ^[a-z0-9]{3,20}$).
#   - Pre-flight requires both positional args.
#   - Runs `npm create @wix/new@latest headless` with --no-publish + --skip-install
#     so the orchestrator can deferred-install with its own package set.
#   - Passes bare `--site-template` so non-interactive scaffolding stays on the
#     blank starter.
#
# Exit codes:
#   0 — ok
#   2 — argument validation failed (bad slug, missing args, frontend=user-provided)
#   3 — Wix CLI not logged in (defensive; the Discovery pre-flight is the primary check)
#   4 — frontend value recognized but the template isn't staged yet (react-vite today)
#   <other> — npm create failed; stderr surfaced to caller for orchestrator-side
#             recovery (auth / other scaffold failures live in the orchestrator).

set -euo pipefail

FRONTEND="astro"
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --frontend)
      if [[ $# -lt 2 ]]; then
        echo "scaffold.sh: --frontend requires a value (astro|react-vite|user-provided)." >&2
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
  echo "scaffold.sh: both positional args required. Got project-slug='${POSITIONAL[0]:-}' brand-name='${POSITIONAL[1]:-}'." >&2
  echo "Usage: bash scaffold.sh <slug> \"<Brand Name>\" [--frontend astro|react-vite] — slug first, brand quoted." >&2
  exit 2
fi

case "$FRONTEND" in
  astro)
    ;;
  react-vite)
    echo "scaffold.sh: --frontend=react-vite recognized but the react-vite/blank template isn't staged yet." >&2
    echo "Per PLAN-beta-frontend-pluggability.md § Order of operations, react-vite lands after astro + user-provided." >&2
    exit 4
    ;;
  user-provided)
    echo "scaffold.sh: --frontend=user-provided is invalid — integrate mode skips scaffold." >&2
    echo "Discovery should route directly to SETUP.md § 'Existing project flow' without dispatching this script." >&2
    exit 2
    ;;
  *)
    echo "scaffold.sh: unknown --frontend value '$FRONTEND'. Allowed: astro, react-vite, user-provided." >&2
    exit 2
    ;;
esac

if [[ ! "${POSITIONAL[0]}" =~ ^[a-z0-9]{3,20}$ ]]; then
  echo "scaffold.sh: project-slug='${POSITIONAL[0]}' is not valid." >&2
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
  --business-name "${POSITIONAL[1]}" \
  --project-name "${POSITIONAL[0]}" \
  --site-template \
  --no-publish \
  --skip-install
