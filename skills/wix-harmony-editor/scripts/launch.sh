#!/bin/bash
# Launch a separate, headed Chrome profile for a Wix Harmony editor session.
# The Chrome DevTools endpoint is loopback-only and is never printed.
#
# Cross-platform: macOS, Linux (including headless boxes with no physical
# display), WSL, and Windows Git Bash/MSYS are detected and a usable
# Chrome/Chromium binary is located for each. Nothing here is ever
# substituted silently: if no browser can be found, the script fails with
# an actionable message naming what to install.
#
# Headless Linux note: Wix Harmony intentionally requires a HEADED browser
# (never --headless) so a human can interact with a Wix sign-in page if one
# appears. A machine with no physical monitor can still run headed Chrome
# against a virtual framebuffer (Xvfb) - this script will start one
# automatically on Linux if $DISPLAY isn't already set and Xvfb is
# installed. Xvfb itself is a prerequisite install (see the error message
# below); this script does not silently `sudo apt-get install` anything on
# your behalf.
#
# If Wix shows a sign-in page while running under a virtual display, you
# need some way to actually see and interact with it. Options, from
# simplest to most complete:
#   - Take a screenshot from Playwright (page.screenshot()) to see the
#     current page - good enough to tell what state the editor is in, but
#     not interactive.
#   - Run a lightweight VNC server against the same DISPLAY, e.g.:
#       x11vnc -display :99 -localhost -nopw
#     then forward the VNC port (default 5900) to a machine with a VNC
#     client. This gives full interactive mouse/keyboard control, but you
#     are responsible for setting up that port forward for your sandbox.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PW_PORT:-9333}"
PROFILE="${WIX_HARMONY_PROFILE_DIR:-${TMPDIR:-/tmp}/wix-harmony-editor-profile}"
EDITOR_URL="${1:-about:blank}"

umask 077
mkdir -p "$PROFILE"
chmod 700 "$PROFILE"

# If a Wix Harmony Chrome is already up on this port, nothing else to do.
if curl -fsS -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "Wix Harmony Chrome is already running on local CDP port ${PORT}."
  exit 0
fi

# --- OS detection -----------------------------------------------------
detect_os() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  case "$uname_s" in
    Darwin)
      echo macos
      ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo wsl
      else
        echo linux
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo windows
      ;;
    *)
      echo unknown
      ;;
  esac
}

OS_TYPE="$(detect_os)"

# --- Chrome/Chromium discovery -----------------------------------------
# Prints the resolved binary path on stdout, or nothing if not found.
find_chrome_macos() {
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

# Finds the newest Playwright-managed Chromium build under its cache dir,
# e.g. ~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome. This is
# the browser `npx playwright install` downloads; it's a reasonable
# fallback on Linux boxes with no system Chrome package installed.
find_chrome_playwright_linux() {
  local pw_dir="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  [[ -d "$pw_dir" ]] || return 1
  local newest
  newest="$(find "$pw_dir" -maxdepth 1 -type d -iname 'chromium-*' 2>/dev/null | sort -V | tail -1)"
  [[ -n "$newest" ]] || return 1
  local sub
  for sub in chrome-linux64/chrome chrome-linux/chrome; do
    if [[ -x "$newest/$sub" ]]; then
      echo "$newest/$sub"
      return 0
    fi
  done
  return 1
}

find_chrome_linux() {
  local bin
  for bin in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then
      command -v "$bin"
      return 0
    fi
  done
  find_chrome_playwright_linux && return 0
  return 1
}

find_chrome_wsl() {
  # Prefer a native Linux Chrome/Chromium installed inside the WSL distro,
  # then fall back to the Windows-side install reachable under /mnt/c.
  find_chrome_linux && return 0
  local candidates=(
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

find_chrome_windows() {
  local bin
  for bin in chrome.exe chromium.exe; do
    if command -v "$bin" >/dev/null 2>&1; then
      command -v "$bin"
      return 0
    fi
  done
  local candidates=(
    "/c/Program Files/Google/Chrome/Application/chrome.exe"
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

CHROME=""
case "$OS_TYPE" in
  macos)   CHROME="$(find_chrome_macos || true)" ;;
  linux)   CHROME="$(find_chrome_linux || true)" ;;
  wsl)     CHROME="$(find_chrome_wsl || true)" ;;
  windows) CHROME="$(find_chrome_windows || true)" ;;
esac

if [[ -z "$CHROME" ]]; then
  case "$OS_TYPE" in
    macos)
      echo "No Google Chrome or Chromium install was found under /Applications." >&2
      echo "Install Google Chrome (https://www.google.com/chrome/) and retry." >&2
      ;;
    linux)
      echo "No Chrome/Chromium binary was found on PATH (checked: google-chrome," >&2
      echo "google-chrome-stable, chromium, chromium-browser), and no Playwright-managed" >&2
      echo "Chromium was found under \${PLAYWRIGHT_BROWSERS_PATH:-~/.cache/ms-playwright}." >&2
      echo "Install one of:" >&2
      echo "  sudo apt-get install -y chromium-browser   # Debian/Ubuntu" >&2
      echo "  sudo dnf install -y chromium               # Fedora/RHEL" >&2
      echo "or fetch Playwright's bundled browser: npx playwright install chromium" >&2
      ;;
    wsl)
      echo "No Chrome/Chromium binary was found inside WSL or under /mnt/c/Program Files." >&2
      echo "Install Chrome/Chromium inside the WSL distro, or install Google Chrome on" >&2
      echo "the Windows host so it is reachable at /mnt/c/Program Files/Google/Chrome/..." >&2
      ;;
    windows)
      echo "No chrome.exe/chromium.exe was found on PATH or under Program Files." >&2
      echo "Install Google Chrome (https://www.google.com/chrome/) and retry." >&2
      ;;
    *)
      echo "Could not detect this OS (uname -s reported an unrecognized value) and" >&2
      echo "no Chrome/Chromium binary could be located automatically." >&2
      ;;
  esac
  exit 1
fi

# --- Headless Linux: provide a virtual display if none exists ----------
# Real desktops (macOS, WSL with WSLg, Windows) already have a display.
# A headless Linux sandbox does not, but headed Chrome still needs one to
# start; Xvfb provides a virtual framebuffer it can render into.
if [[ "$OS_TYPE" == "linux" && -z "${DISPLAY:-}" ]]; then
  XVFB_DISPLAY_NUM="${WIX_HARMONY_XVFB_DISPLAY:-99}"
  XVFB_LOCK="/tmp/.X${XVFB_DISPLAY_NUM}-lock"
  # An X11 lock file's mere existence is not proof a usable Xvfb is behind it: if a prior Xvfb
  # was killed uncleanly (OOM, `kill -9`, a container restart) the lock file survives with no
  # process left to serve the display, and Chrome would then fail against a dead display with
  # only a generic ~20s CDP-timeout error instead of this script's own actionable diagnosis. Per
  # the standard X11 lock-file convention, the file's content IS the owning process's pid (ASCII
  # decimal, whitespace-padded) -- check it directly rather than trusting the file's presence.
  if [[ -e "$XVFB_LOCK" ]]; then
    xvfb_lock_pid="$(tr -d '[:space:]' < "$XVFB_LOCK" 2>/dev/null || true)"
    xvfb_lock_stale=0
    if [[ -z "$xvfb_lock_pid" ]]; then
      xvfb_lock_stale=1
    elif [[ ! -e "/proc/$xvfb_lock_pid" ]]; then
      # BUG FIX (code review, round 3): `kill -0` alone cannot tell "no such process" (ESRCH,
      # truly stale) apart from "process alive, owned by a different user" (EPERM) -- both return
      # the same nonzero exit code. Checking /proc/<pid> directly (this branch only runs under
      # linux, see the OS_TYPE guard above) answers the ESRCH question on its own: no /proc entry
      # means the process is genuinely gone.
      # NOTE (code review, round 6): this is the same EPERM/ESRCH distinction as
      # `skills/wix-replatform/lib/local-state.js`'s `isProcessAlive` (consolidated there with
      # `execution-health-check.js` in round 5), reimplemented here in bash since JS and bash
      # can't share code cheaply. A future fix to one should prompt a check of the other.
      xvfb_lock_stale=1
    elif ! kill -0 "$xvfb_lock_pid" 2>/dev/null; then
      # /proc/<pid> exists (a real process is running under that pid) but kill -0 still failed:
      # this is EPERM, not ESRCH -- a live Xvfb owned by a different UID (e.g. a shared
      # container/sandbox). Misdiagnosing this as dead and deleting its lock would let a second
      # Xvfb start and race to bind the same display. Fail loudly instead of guessing.
      echo "Xvfb lock ${XVFB_LOCK} names pid ${xvfb_lock_pid}, which is running but owned by a" >&2
      echo "different user (kill -0 was denied) -- this looks like a LIVE Xvfb this script does" >&2
      echo "not have permission to inspect or replace, not a stale lock from a dead process." >&2
      echo "Remove ${XVFB_LOCK} yourself once you've confirmed it's safe, or export DISPLAY to" >&2
      echo "point at a display this script can use." >&2
      exit 1
    fi
    if [[ "$xvfb_lock_stale" -eq 1 ]]; then
      echo "Removing stale Xvfb lock ${XVFB_LOCK} (pid ${xvfb_lock_pid:-unknown} is not running)." >&2
      # `|| true`: under `set -e`, an `rm -f` that genuinely fails (permission denied, or the
      # path turning out not to be a plain file) would otherwise abort the script right here with
      # rm's own generic error, before the verification below ever runs. Trust the follow-up
      # existence check, not rm's exit code, to decide whether removal actually happened.
      rm -f "$XVFB_LOCK" || true
      if [[ -e "$XVFB_LOCK" ]]; then
        # BUG FIX (code review, round 3): `rm -f` exits 0 even when it silently fails to remove a
        # path it lacks permission for (e.g. a sticky /tmp directory owned by another user, or the
        # path turning out not to be a plain file at all) -- verify removal actually happened
        # rather than trusting rm's exit code. Falling through here with the lock still present
        # would skip starting a fresh Xvfb below and export DISPLAY at a dead display.
        echo "Failed to remove stale Xvfb lock ${XVFB_LOCK} (no permission, or it is not a" >&2
        echo "plain file?). Remove it manually and re-run, or export DISPLAY yourself." >&2
        exit 1
      fi
    fi
  fi
  if [[ ! -e "$XVFB_LOCK" ]]; then
    if ! command -v Xvfb >/dev/null 2>&1; then
      echo "No \$DISPLAY is set and Xvfb is not installed, so headed Chrome cannot" >&2
      echo "start on this headless Linux machine. Install it, e.g.:" >&2
      echo "  sudo apt-get install -y xvfb   # Debian/Ubuntu" >&2
      echo "  sudo dnf install -y xorg-x11-server-Xvfb   # Fedora/RHEL" >&2
      echo "then re-run this script (or export DISPLAY yourself if you already have" >&2
      echo "a virtual/real display running)." >&2
      exit 1
    fi
    nohup Xvfb ":${XVFB_DISPLAY_NUM}" -screen 0 1280x800x24 \
      >"${PROFILE}/xvfb.log" 2>&1 &
    xvfb_pid=$!
    disown
    # A backgrounded Xvfb takes a moment to create its lock file and start serving the display;
    # `sleep 1` then unconditionally exporting DISPLAY assumed it always makes that window, with no
    # check that it actually came up. If Xvfb itself failed fast (missing X extension, a stale
    # /tmp permission problem, port/display already in some other conflicting state), the old code
    # would still export DISPLAY and hand Chrome a dead display -- Chrome would then fail ~20s
    # later against a generic CDP-timeout, with nothing pointing back at Xvfb as the real cause.
    # Poll for the lock file actually appearing (proof Xvfb bound the display), or the backgrounded
    # pid dying (proof it won't), across a short retry window -- the same diagnostic quality as the
    # stale-lock check above this block, rather than a blind fixed sleep.
    xvfb_ready=0
    for _ in $(seq 1 30); do
      if [[ -e "$XVFB_LOCK" ]]; then
        xvfb_ready=1
        break
      fi
      if ! kill -0 "$xvfb_pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if [[ "$xvfb_ready" -ne 1 ]]; then
      echo "Xvfb did not come up on display :${XVFB_DISPLAY_NUM} within 3s (lock file" >&2
      echo "${XVFB_LOCK} never appeared). Check ${PROFILE}/xvfb.log for its own error output," >&2
      echo "e.g. a missing X extension, a permissions problem under /tmp, or the display" >&2
      echo "number already being used by something else that isn't Xvfb itself." >&2
      exit 1
    fi
  fi
  export DISPLAY=":${XVFB_DISPLAY_NUM}"
  echo "No \$DISPLAY was set; using virtual display ${DISPLAY} (Xvfb) for headed Chrome." >&2
  echo "If Wix shows a sign-in page, you'll need a way to see/interact with this" >&2
  echo "virtual display - e.g. 'x11vnc -display ${DISPLAY} -localhost -nopw' plus a" >&2
  echo "forwarded VNC port, or take Playwright screenshots to inspect page state." >&2
fi

nohup "$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  "$EDITOR_URL" >"${PROFILE}/chrome.log" 2>&1 &

for _ in $(seq 1 40); do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "Wix Harmony Chrome is ready on local CDP port ${PORT}."
    exit 0
  fi
  sleep 0.5
done

echo "Chrome did not expose its local CDP endpoint. Check ${PROFILE}/chrome.log." >&2
exit 1
