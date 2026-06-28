#!/usr/bin/env bash
# Read-only environment audit for Wix Headless (macOS / Linux).
#
# Emits ONE compact JSON line to stdout describing what's installed and whether
# it meets the bar. Does NOT install anything and does NOT hit the network — it
# only probes local tools, so it's safe to run on every pre-flight (~tens of ms).
#
# Node gate: >= 20.11.0 (the floor the @wix/cli scaffold + astro toolchain need).
#
# Companion: scripts/audit-env.ps1 (Windows / PowerShell) emits the IDENTICAL
# JSON shape. references/shared/ENVIRONMENT.md parses one shape for both.
#
# Usage:
#   bash <SKILL_ROOT>/scripts/audit-env.sh
#
# Output shape (single line):
#   {"os":"darwin","node":{"present":true,"version":"22.3.0","ok":true},
#    "npm":{"present":true,"version":"10.8.1"},
#    "git":{"present":true,"version":"2.45.1"},
#    "gitIdentity":{"nameSet":true,"emailSet":true},
#    "xcodeCLT":{"present":true},"minNode":"20.11.0"}
# On non-macOS, "xcodeCLT" is null.
set -u

MIN_NODE="20.11.0"

has()   { command -v "$1" >/dev/null 2>&1; }
jbool() { if [ "${1:-0}" = "1" ]; then printf 'true'; else printf 'false'; fi; }

case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)      os="unknown" ;;
esac

# --- node (+ semver gate, MAJOR.MINOR.PATCH numeric compare) ---
node_present=0; node_version=""; node_ok=0
if has node; then
  node_present=1
  node_version="$(node -v 2>/dev/null | sed 's/^v//')"
  if [ -n "$node_version" ]; then
    node_ok="$(awk -v v="$node_version" -v m="$MIN_NODE" 'BEGIN{
      split(v,a,/[.-]/); split(m,b,".");
      for(i=1;i<=3;i++){ai=a[i]+0; bi=b[i]+0;
        if(ai>bi){print 1; exit} if(ai<bi){print 0; exit}}
      print 1}')"
  fi
fi

# --- npm ---
npm_present=0; npm_version=""
if has npm; then npm_present=1; npm_version="$(npm -v 2>/dev/null)"; fi

# --- git ---
git_present=0; git_version=""
if has git; then
  git_present=1
  git_version="$(git --version 2>/dev/null | awk '{print $3}')"
fi

# --- git identity (only meaningful when git is present) ---
name_set=0; email_set=0
if [ "$git_present" = "1" ]; then
  [ -n "$(git config --global user.name 2>/dev/null)" ]  && name_set=1
  [ -n "$(git config --global user.email 2>/dev/null)" ] && email_set=1
fi

# --- macOS Command Line Tools (git + compilers for native modules) ---
clt_json="null"
if [ "$os" = "darwin" ]; then
  clt_present=0
  if xcode-select -p >/dev/null 2>&1; then clt_present=1; fi
  clt_json="{\"present\":$(jbool "$clt_present")}"
fi

printf '{'
printf '"os":"%s",' "$os"
printf '"node":{"present":%s,"version":"%s","ok":%s},' "$(jbool "$node_present")" "$node_version" "$(jbool "$node_ok")"
printf '"npm":{"present":%s,"version":"%s"},' "$(jbool "$npm_present")" "$npm_version"
printf '"git":{"present":%s,"version":"%s"},' "$(jbool "$git_present")" "$git_version"
printf '"gitIdentity":{"nameSet":%s,"emailSet":%s},' "$(jbool "$name_set")" "$(jbool "$email_set")"
printf '"xcodeCLT":%s,' "$clt_json"
printf '"minNode":"%s"' "$MIN_NODE"
printf '}\n'
