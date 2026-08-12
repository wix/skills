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
# Self-test:     bash .github/scripts/check-cli-pinned.sh --self-test
# CI:            invoked by .github/workflows/check-cli-pinned.yml on PRs

set -euo pipefail

SUBCMDS="token|whoami|login|env|build|release|preview|dev"

# The second grep drops matches sitting on a comment line in source files —
# prose about the CLI, not a call. Markdown keeps every match: `#` opens a
# heading there, and an unpinned command in docs is one a reader will copy.
scan() {
  grep -rnE "npx @wix/cli (${SUBCMDS})([[:space:]]|$)" \
    --include='*.md' --include='*.sh' --include='*.mjs' --include='*.js' --include='*.ts' \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
    "$1" 2>/dev/null | grep -vE '\.(sh|mjs|js|ts):[0-9]+:[[:space:]]*(//|/\*|\*|#)' || true
}

# Guards both directions: that real invocations are still caught, and that
# prose about the CLI is not. Without it, "still catches everything it used to"
# is only ever checked by hand, once, by whoever last edited the matcher.
if [[ "${1:-}" == "--self-test" ]]; then
  dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
  # Built from $cli so this file never contains a literal match and cannot
  # flag its own fixtures when the check scans the repo.
  cli="npx @wix/cli"
  printf 'Run `%s token --site x`\n'           "$cli" > "$dir/doc.md"
  printf '%s login\n'                          "$cli" > "$dir/run.sh"
  printf 'execSync("%s build --prod") // note\n' "$cli" > "$dir/call.js"
  printf '// e.g. `%s token --site x`\n'       "$cli" > "$dir/line-comment.js"
  printf ' * see `%s token --site x`\n'        "$cli" > "$dir/block-comment.js"
  printf '# example: %s login\n'               "$cli" > "$dir/comment.sh"
  printf 'run("%s@latest build --prod")\n'     "$cli" > "$dir/pinned.js"

  found=$(scan "$dir"); rc=0
  for f in doc.md run.sh call.js; do
    grep -q "/$f:" <<<"$found" || { echo "FAIL: $f should be flagged" >&2; rc=1; }
  done
  for f in line-comment.js block-comment.js comment.sh pinned.js; do
    grep -q "/$f:" <<<"$found" && { echo "FAIL: $f should be ignored" >&2; rc=1; }
  done
  [[ $rc -eq 0 ]] && echo "Self-test passed ✓"
  exit $rc
fi

bare=$(scan .)

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
