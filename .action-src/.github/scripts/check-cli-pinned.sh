#!/usr/bin/env bash
# check-cli-pinned.sh
#
# Fails (exit 1) if any `npx @wix/cli <subcmd>` invocation in the repo is
# NOT pinned to `@latest`. Every CLI invocation must read `npx @wix/cli@latest`.
#
# Subcommand list mirrors what PR #302 pinned. Add new subcommands here when
# the @wix/cli surface grows.
#
# Run locally:   bash .github/scripts/check-cli-pinned.sh
# CI:            invoked by .github/workflows/check-cli-pinned.yml on PRs

set -euo pipefail

SUBCMDS="token|whoami|login|env|build|release|preview|dev"

bare=$(grep -rnE "npx @wix/cli (${SUBCMDS})([[:space:]]|$)" \
  --include='*.md' --include='*.sh' --include='*.mjs' --include='*.js' --include='*.ts' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  . 2>/dev/null || true)

if [[ -n "$bare" ]]; then
  echo "ERROR: unpinned 'npx @wix/cli <subcmd>' occurrences found." >&2
  echo "Every CLI invocation MUST be 'npx @wix/cli@latest <subcmd>' (see PR #302)." >&2
  echo "Fix with:" >&2
  echo "  for cmd in ${SUBCMDS//|/ }; do" >&2
  echo "    find . -type f \\( -name '*.md' -o -name '*.sh' -o -name '*.mjs' \\) -print0 \\" >&2
  echo "      | xargs -0 sed -i '' \"s|npx @wix/cli \${cmd}|npx @wix/cli@latest \${cmd}|g\"" >&2
  echo "  done" >&2
  echo >&2
  echo "Offending lines:" >&2
  echo "$bare" >&2
  exit 1
fi

echo "All npx @wix/cli invocations are pinned to @latest ✓"
