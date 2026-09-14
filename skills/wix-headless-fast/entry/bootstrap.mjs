#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// Where the detached login parks its output between runs. It has to outlive this
// process, so it can't be a pipe and can't live in the project.
const STATE_DIR = join(tmpdir(), 'wix-headless-login');
const LOG = join(STATE_DIR, 'login.log');
const PIDFILE = join(STATE_DIR, 'login.pid');

// run a command, capture stdout+stderr (combined), return {status, out}
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: isWin, env: AGENT_ENV, ...opts });
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

// ── 2. Reuse an existing session, or start device login ──────────────────────
const hasExistingSession = () => capture(WIX[0], [...WIX.slice(1), 'whoami']).status === 0;

function loginEvents() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null; // non-JSON CLI chatter
      }
    })
    .filter((e) => e && e.event);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A login this machine started earlier may still be waiting on the browser. Reuse
// its code instead of minting a second one — a new login invalidates nothing, but
// it hands the user a different code than the one already on their screen.
function pendingLogin() {
  if (!existsSync(PIDFILE)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(PIDFILE, 'utf8'));
  } catch {
    return null;
  }
  if (!state.pid || !alive(state.pid)) return null;
  const ev = loginEvents().find((e) => e.event === 'awaiting_user');
  if (!ev) return null;
  // Don't hand back a code that's about to expire mid-typing.
  const ageSeconds = Math.round((Date.now() - state.startedAt) / 1000);
  if (ageSeconds > (ev.expiresInSeconds ?? 600) - 60) return null;
  return ev;
}

// Detach so the login keeps polling after this process exits. stdio goes to a
// file, not a pipe: a pipe dies with the parent, and the CLI would get EPIPE.
function startLogin() {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOG, '');
  const out = openSync(LOG, 'a');
  const child = spawn(WIX[0], [...WIX.slice(1), 'login'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: AGENT_ENV,
    shell: isWin,
  });
  child.on('error', (e) => fail('login_failed', { detail: String(e) }));
  writeFileSync(PIDFILE, JSON.stringify({ pid: child.pid, startedAt: Date.now() }));
  child.unref();
}

async function waitForCode(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = loginEvents();
    const ev = events.find((e) => e.event === 'awaiting_user');
    if (ev) return ev;
    const bad = events.find((e) => e.event === 'login_failed');
    if (bad) fail('login_failed', bad);
    await new Promise((r) => setTimeout(r, 500));
  }
  const detail = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().slice(-1500) : '';
  fail('login_failed', {
    detail: detail || `wix login produced no device code within ${timeoutMs / 1000}s.`,
  });
}

// The next move is the user's, so hand the code back and exit rather than holding
// the caller open for a browser round-trip. `message` is the sentence to relay.
function surrenderTo(ev) {
  emit('awaiting_user', {
    ...ev,
    message:
      `To connect your Wix account, open ${ev.verificationUri} and enter the code ` +
      `${ev.userCode}. Tell me once you're done and I'll continue.`,
  });
  process.exit(0);
}

// ── main ────────────────────────────────────────────────────────────────────
checkCli();

if (hasExistingSession()) {
  emit('logged_in');
  process.exit(0);
}

const pending = pendingLogin();
if (pending) surrenderTo(pending);

startLogin();
surrenderTo(await waitForCode());
