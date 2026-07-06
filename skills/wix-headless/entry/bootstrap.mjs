#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

// ── tiny event protocol (one JSON object per line) ───────────────────────────
const emit = (event, extra = {}) =>
  process.stdout.write(JSON.stringify({ event, ...extra }) + '\n');
const fail = (event, extra = {}) => {
  emit(event, { ok: false, ...extra });
  process.exit(1);
};

// ── platform-safe binary names (npm/npx are .cmd on Windows) ─────────────────
const isWin = process.platform === 'win32';
const bin = (name) => (isWin ? `${name}.cmd` : name);
const WIX = [bin('npx'), '-y', '@wix/cli@latest']; // run the CLI via npx — no global install/mutation

// Force the CLI into non-interactive "agent" mode. Without an agent signal in
// the env, `wix login` renders an interactive Ink TUI (device code + keypress)
// that needs a raw TTY and crashes in an agent sandbox — and it never emits the
// JSON login events this script forwards. The CLI uses @vercel/detect-agent,
// whose first check is the AI_AGENT env var, so setting it guarantees agent mode
// (and the awaiting_user/success/logged_in events) for every child we spawn.
// Respect an existing value so a known runner (claude, cursor, …) keeps its name.
const AGENT_ENV = { ...process.env, AI_AGENT: process.env.AI_AGENT || 'wix-headless-skill' };

// run a command, capture stdout+stderr (combined), return {status, out}
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, env: AGENT_ENV, ...opts });
  return { status: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`, error: r.error };
}

// ── 1. CLI reachable (via npx — no install) ──────────────────────────────────
function checkCli() {
  const r = capture(WIX[0], [...WIX.slice(1), '--version']);
  if (r.status !== 0) fail('cli_unreachable', { detail: r.out.trim().slice(0, 400) });
  // npx interleaves "npm notice …" lines with the version, so don't just take the
  // last line — pick the first semver-looking token, falling back to the last line.
  const version = (r.out.match(/\d+\.\d+\.\d+[^\s]*/) || [])[0] || r.out.trim().split('\n').pop();
  emit('cli_ok', { version });
}

// ── 2. Login (human-in-the-loop device code; forward the CLI's own events) ───
function login() {
  return new Promise((resolve) => {
    const child = spawn(WIX[0], [...WIX.slice(1), 'login'], { shell: false, env: AGENT_ENV });
    const rl = readline.createInterface({ input: child.stdout });
    let loggedIn = false;
    // Buffer the CLI's own diagnostics (stderr + any non-event stdout chatter) so a
    // failure reports the REAL cause — network/proxy error, expired code, etc. — not
    // a guess. Keep only the tail so a chatty CLI can't blow up memory, and draining
    // stderr also avoids the pipe filling up and stalling the child.
    let diag = '';
    const collect = (chunk) => {
      diag = (diag + chunk).slice(-2000);
    };
    child.stderr?.on('data', collect);
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t) return;
      // In agent mode the CLI emits {event:"awaiting_user"|"success"|"logged_in", ...}
      // — pass those straight through so the agent can relay the device code.
      try {
        const ev = JSON.parse(t);
        if (ev && ev.event) {
          process.stdout.write(t + '\n');
          if (ev.event === 'success' || ev.event === 'logged_in') {
            loggedIn = true;
            resolve();
          }
          return;
        }
        collect(line + '\n'); // JSON, but not an event — keep for diagnostics
      } catch {
        collect(line + '\n');
      } // non-JSON CLI chatter — keep for diagnostics
    });
    // Only a success/logged_in event counts as login. On any other exit, surface the
    // CLI's actual output — do NOT assume a cause (agent mode, etc.).
    child.on('close', (code) => {
      if (loggedIn) return;
      const detail =
        diag.trim().slice(-1500) ||
        `wix login exited (code ${code}) before authenticating, with no output.`;
      fail('login_failed', { code, detail });
    });
    child.on('error', (e) => fail('login_failed', { detail: String(e) }));
  });
}

// ── main ────────────────────────────────────────────────────────────────────
checkCli();
await login();
