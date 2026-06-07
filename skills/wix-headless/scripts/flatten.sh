#!/usr/bin/env bash
# Flatten a scaffolded subdir up into the current directory — the framework-
# agnostic half of single-folder bootstrap for the own-build path.
#
# WHY THIS EXISTS: every framework scaffolder (Vite, Vue, SvelteKit, …) insists
# on creating a *named subdir* and offers no reliable in-place option. The skill
# wants the project in CWD (one `.wix`, CWD == project == site-root — same layout
# astro's scaffold.sh produces). The flatten is identical regardless of framework,
# so it lives here as ONE tested script instead of being re-derived in prose every
# run (the orchestrator otherwise burns a long turn agonizing over mv -n vs rsync
# vs cp --no-clobber and BSD-vs-GNU portability). Scaffold into a temp subdir with
# the framework's own command, then call this.
#
# astro's scaffold.sh ALSO delegates its in-place flatten here (same logic), so
# this is the single source for the flatten. Remove the flatten entirely when the
# CLI gains `--folder-name .` (or --cwd) — the in-place flag obviates it.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/flatten.sh <scaffold-subdir>
#
# <scaffold-subdir>: the transient directory the framework scaffolder created
#                    (e.g. "_scaffold_tmp"). Everything inside it — including
#                    dotfiles — is moved up into CWD; its `.wix/*` is merged into
#                    the existing `.wix/` WITHOUT overwriting any pre-existing
#                    `.wix/` entries (mv -n); then the subdir is removed.
#
# Exit codes:
#   0 — ok (or subdir absent / already flat — no-op)
#   2 — argument missing
#   5 — could not fully flatten (name collision left files behind)

set -euo pipefail

SUBDIR="${1:-}"
if [[ -z "$SUBDIR" ]]; then
  echo "flatten.sh: scaffold-subdir argument required." >&2
  echo "Usage: bash flatten.sh <scaffold-subdir>" >&2
  exit 2
fi

# Absent or not a dir → nothing to flatten (scaffolder may have gone in-place).
[[ -d "$SUBDIR" ]] || { echo "flatten.sh: '$SUBDIR' is not a directory — nothing to flatten."; exit 0; }

shopt -s dotglob nullglob
mkdir -p .wix
if [[ -d "$SUBDIR/.wix" ]]; then
  for f in "$SUBDIR"/.wix/*; do
    mv -n "$f" .wix/      # -n: never overwrite pre-existing `.wix/` entries
  done
  rmdir "$SUBDIR/.wix" 2>/dev/null || rm -rf "$SUBDIR/.wix"
fi
for f in "$SUBDIR"/*; do
  mv -n "$f" ./
done
shopt -u dotglob nullglob

if ! rmdir "$SUBDIR" 2>/dev/null; then
  echo "flatten.sh: could not fully flatten '$SUBDIR' into CWD — leftover:" >&2
  ls -A "$SUBDIR" >&2
  exit 5
fi
