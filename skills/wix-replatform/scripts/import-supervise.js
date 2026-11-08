#!/usr/bin/env node
'use strict';

// Run the generated import (or extract) to an end state in deterministic code.
//
// Measured on a full run: the "execute import" Developer subagent spent 345 model calls and 98.3M
// tokens, 23.3M of them on calls that only slept, polled the health check or tailed the progress
// log; and every call after a wait longer than the prompt cache re-wrote its whole context. This
// script owns that loop: launch, poll `execution-health-check.js`, resume (re-run the same
// idempotent entrypoint) after a crash or a stalled verdict, and stop with one JSON line when an
// agent is actually needed.
//
// Exit codes (stable):
//   0  complete         -- the entrypoint finished and the health check reports complete
//   10 needs_decision   -- a pending user action, the auth stop (75) or an awaiting-user exit (3)
//   11 resume_limit     -- the same settled progress failed --max-resumes times in a row, or
//                          --max-launches launches happened in this call
//   1  supervisor error -- bad arguments or the supervisor itself failed
//   128+n               -- the supervisor got signal n; it forwarded it to the import and waited
//
// It never starts a second import: a claim file records the child it launched, and a later call
// that finds that child still alive attaches to it (polls only) instead of spawning. Every relaunch
// is the same entrypoint with the same arguments, which resumes from the attempt journal and
// crosswalk exactly as a manual re-run would.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { checkpointOf, sameCheckpoint } = require('../lib/subagent-handoff.js');
const { listPendingBlockingUserActions } = require('../lib/user-actions.js');
const { isProcessAlive } = require('../lib/local-state.js');

const HEALTH_CHECK = path.join(__dirname, 'execution-health-check.js');
const EXIT = { complete: 0, needs_decision: 10, resume_limit: 11, error: 1 };
const AUTH_STOP_EXIT = 75; // wix-auth.js WIX_AUTH_EXIT_CODE
const AWAITING_USER_EXIT = 3;
const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
const HEARTBEAT_RE = /\b(withHeartbeat|startHeartbeat)\b/;

function usage() {
  return `Usage:
  node skills/wix-replatform/scripts/import-supervise.js --project <dir>
      [--entry src/import/run-import.js] [--script <health-check script id>]
      [--poll 3m] [--stale-after 5m] [--max-resumes 3] [--max-launches 10] [--backoff 30s]
      [-- <entrypoint args>]

Runs the entrypoint (relative to --project) until it completes, needs a decision, or stops making
settled progress. If an import it launched earlier is still running, it attaches to that one.
Run it in the host's background mode; after a timed-out call, just run it again.
Prints one JSON line. Exit 0 complete, 10 needs_decision, 11 resume_limit, 1 error.
`;
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i;
const UNIT = { ms: 1, s: 1000, m: 60000, h: 3600000 };
function durationMs(value, label) {
  const match = DURATION_RE.exec(String(value).trim());
  if (!match) throw new Error(`invalid ${label}: ${value}`);
  return Number(match[1]) * UNIT[(match[2] || 'ms').toLowerCase()];
}

function parseArgs(argv) {
  const args = { entry: 'src/import/run-import.js', poll: '3m', staleAfter: '5m', maxResumes: '3', maxLaunches: '10', backoff: '30s', passthrough: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') { args.passthrough = argv.slice(i + 1); break; }
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${token}`);
    args[key] = value;
    i += 1;
  }
  if (!args.script) args.script = path.basename(args.entry, '.js');
  return args;
}

function health(projectDir, script, staleAfter) {
  const result = spawnSync(process.execPath, [HEALTH_CHECK, projectDir, '--script', script, '--stale-after', staleAfter], { encoding: 'utf8' });
  try { return JSON.parse(result.stdout); } catch { return { status: 'unknown', detail: (result.stderr || '').trim().slice(0, 300) }; }
}

async function pendingActions(projectDir) {
  try { return (await listPendingBlockingUserActions(projectDir)).map((request) => request.requestId); } catch { return ['unreadable']; }
}

// Without heartbeats a long healthy loop looks `stalled`; killing it would cut it mid-write every
// few minutes. Generated entrypoints are thin wrappers and the write loops (with their heartbeats)
// live elsewhere under src/, so look through the entrypoint's directory and the project's src/
// tree once, before the first launch.
const HEARTBEAT_SCAN_MAX_FILES = 2000;
function hasHeartbeat(projectDir, entryPath) {
  const roots = [path.dirname(entryPath), path.join(projectDir, 'src')];
  const seen = new Set();
  const stack = [...roots];
  let scanned = 0;
  const check = (file) => { try { return HEARTBEAT_RE.test(fs.readFileSync(file, 'utf8')); } catch { return false; } };
  if (check(entryPath)) return true;
  while (stack.length && scanned < HEARTBEAT_SCAN_MAX_FILES) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(c|m)?js$/.test(entry.name)) {
        scanned += 1;
        if (check(full)) return true;
      }
    }
  }
  return false;
}

// The claim says which child this supervisor launched, so a later call can attach to it.
function claimPath(projectDir, script) {
  return path.join(projectDir, 'state', 'supervise', `${script.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
}
function readClaim(projectDir, script) {
  try { return JSON.parse(fs.readFileSync(claimPath(projectDir, script), 'utf8')); } catch { return null; }
}
function writeClaim(projectDir, script, claim) {
  const file = claimPath(projectDir, script);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(claim));
  fs.renameSync(`${file}.tmp`, file);
}
// A recorded pid can be reused after a reboot. Where /proc exists, the process must still be
// running our entrypoint; elsewhere a live pid on this host is the best evidence available.
function runsEntry(pid, entry) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').some((arg) => arg.endsWith(entry));
  } catch (error) {
    return !(error && error.code === 'ENOENT' && fs.existsSync('/proc/self'));
  }
}
function liveClaim(projectDir, script) {
  const claim = readClaim(projectDir, script);
  // pid must be positive: process.kill(0|-n, ...) signals a whole process group, never one import.
  return claim && claim.host === os.hostname() && Number.isInteger(claim.pid) && claim.pid > 0 && isProcessAlive(claim.pid)
    && runsEntry(claim.pid, claim.entry || '') ? claim : null;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

let activeChild = null;
// The pid of an import this supervisor attached to (it did not spawn it, so there is no child handle).
let attachedPid = null;
let stopSignal = null;

// Without heartbeats a `stalled` verdict is not trusted, but a run that has looked stalled for this
// many stale windows in a row is treated as hung: stopped, and returned to an agent.
const NO_HEARTBEAT_STALL_FACTOR = 6;

function runOnce({ projectDir, entry, passthrough, pollMs, script, staleAfter, killOnStall }) {
  const hungAfterMs = durationMs(staleAfter, '--stale-after') * NO_HEARTBEAT_STALL_FACTOR;
  return new Promise((resolve) => {
    // The entrypoint's own output goes to a log file, never into the agent's context.
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });
    const log = fs.openSync(path.join(projectDir, 'logs', 'import-supervise.log'), 'a');
    const child = spawn(process.execPath, [path.join(projectDir, entry), ...passthrough], { cwd: projectDir, stdio: ['ignore', log, 'pipe'] });
    activeChild = child;
    if (child.pid) writeClaim(projectDir, script, { pid: child.pid, host: os.hostname(), supervisorPid: process.pid, entry, startedAt: new Date().toISOString() });
    let stderrTail = '';
    child.stderr.on('data', (chunk) => { try { fs.writeSync(log, chunk); } catch { /* log closed */ } stderrTail = `${stderrTail}${chunk}`.slice(-2000); });
    let killedForStall = false;
    let stallSeenWithoutHeartbeat = false;
    let hungWithoutHeartbeat = false;
    let stalledSince = null;
    let lastHealth = null;
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 10000).unref();
    };
    const timer = setInterval(() => {
      lastHealth = health(projectDir, script, staleAfter);
      if (lastHealth.status !== 'stalled' || child.exitCode !== null) { stalledSince = null; return; }
      if (killOnStall) { killedForStall = true; stop(); return; }
      stallSeenWithoutHeartbeat = true;
      stalledSince = stalledSince || Date.now();
      if (Date.now() - stalledSince >= hungAfterMs && !hungWithoutHeartbeat) { hungWithoutHeartbeat = true; stop(); }
    }, pollMs);
    const done = (result) => {
      clearInterval(timer);
      try { fs.closeSync(log); } catch { /* already closed */ }
      activeChild = null;
      resolve({ ...result, killedForStall, stallSeenWithoutHeartbeat, hungWithoutHeartbeat, lastHealth, stderrTail: stderrTail.trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400) });
    };
    child.on('close', (code, signal) => done({ code, signal }));
    child.on('error', (error) => { stderrTail = String(error.message); done({ code: null, signal: null }); });
  });
}

// Attach to a child an earlier supervisor call launched and that is still alive: poll only.
async function attach({ projectDir, claim, pollMs, script, staleAfter, killOnStall }) {
  const hungAfterMs = durationMs(staleAfter, '--stale-after') * NO_HEARTBEAT_STALL_FACTOR;
  let killedForStall = false;
  let hungWithoutHeartbeat = false;
  let stalledSince = null;
  attachedPid = claim.pid;
  while (isProcessAlive(claim.pid)) {
    if (stopSignal) { attachedPid = null; return { code: null, signal: stopSignal, attached: true }; }
    const verdict = health(projectDir, script, staleAfter);
    if (verdict.status !== 'stalled') stalledSince = null;
    else if (killOnStall && !killedForStall) {
      killedForStall = true;
      try { process.kill(claim.pid, 'SIGTERM'); } catch { /* already gone */ }
    } else if (!killOnStall) {
      stalledSince = stalledSince || Date.now();
      if (Date.now() - stalledSince >= hungAfterMs && !hungWithoutHeartbeat) {
        hungWithoutHeartbeat = true;
        try { process.kill(claim.pid, 'SIGTERM'); } catch { /* already gone */ }
      }
    }
    await sleep(Math.min(pollMs, 5000));
  }
  attachedPid = null;
  return { code: null, signal: null, attached: true, killedForStall, hungWithoutHeartbeat, stderrTail: '' };
}

async function supervise(args) {
  const projectDir = path.resolve(args.project);
  const entryPath = path.join(projectDir, args.entry);
  if (!fs.existsSync(entryPath)) throw new Error(`entrypoint not found: ${args.entry}`);
  const pollMs = durationMs(args.poll, '--poll');
  const backoffMs = durationMs(args.backoff, '--backoff');
  const maxResumes = Math.max(1, Number(args.maxResumes) || 3);
  const maxLaunches = Math.max(1, Number(args.maxLaunches) || 10);
  const killOnStall = hasHeartbeat(projectDir, entryPath);
  const started = Date.now();
  let launches = 0;
  let attachedRuns = 0;
  let sameCheckpointFailures = 0;
  let lastFailureCheckpoint = null;
  const extra = killOnStall ? {} : { heartbeatMissing: true };

  for (;;) {
    if (stopSignal) return { outcome: 'stopped', signal: stopSignal, launches, attachedRuns, ...extra };
    let run;
    const claim = launches === 0 && attachedRuns === 0 ? liveClaim(projectDir, args.script) : null;
    if (claim) {
      attachedRuns += 1;
      run = await attach({ projectDir, claim, pollMs, script: args.script, staleAfter: args.staleAfter, killOnStall });
    } else {
      if (launches >= maxLaunches) {
        return { outcome: 'resume_limit', launches, attachedRuns, elapsedMs: Date.now() - started, reason: 'launch_cap', maxLaunches, ...extra };
      }
      launches += 1;
      run = await runOnce({ projectDir, entry: args.entry, passthrough: args.passthrough, pollMs, script: args.script, staleAfter: args.staleAfter, killOnStall });
    }
    if (stopSignal) return { outcome: 'stopped', signal: stopSignal, launches, attachedRuns, ...extra };
    const base = { launches, attachedRuns, elapsedMs: Date.now() - started, lastExit: run.code, lastSignal: run.signal, ...extra };
    const pending = await pendingActions(projectDir);
    if (run.hungWithoutHeartbeat) {
      return { outcome: 'resume_limit', ...base, reason: 'stalled_without_heartbeat', lastError: run.stderrTail || null };
    }

    if ((run.code === 0 || run.attached) && !pending.length) {
      const verdict = health(projectDir, args.script, args.staleAfter);
      if (verdict.status === 'complete') return { outcome: 'complete', ...base, runId: verdict.runId || null };
    }
    if (pending.length || run.code === AUTH_STOP_EXIT || run.code === AWAITING_USER_EXIT) {
      return { outcome: 'needs_decision', ...base, reason: run.code === AUTH_STOP_EXIT ? 'auth_stop' : (pending.length ? 'pending_user_action' : 'awaiting_user_action'), userActionIds: pending };
    }

    // Only `imported` records count as progress. A resume that advances only
    // `succeeded_unverified` or `deferred` rows can reach the limit; that is intended -- it goes to
    // a fresh Developer, which is the right reader for a run that keeps ending unsettled.
    const checkpoint = await checkpointOf(projectDir);
    if (lastFailureCheckpoint && sameCheckpoint(lastFailureCheckpoint, checkpoint)) sameCheckpointFailures += 1;
    else sameCheckpointFailures = 1;
    lastFailureCheckpoint = checkpoint;
    const errorClass = run.killedForStall ? 'stalled' : (run.attached ? 'attached_run_ended_not_complete' : (run.code === 0 ? 'exited_0_not_complete' : `exit_${run.code === null ? run.signal || 'spawn_error' : run.code}`));
    if (sameCheckpointFailures >= maxResumes) {
      return { outcome: 'resume_limit', ...base, reason: errorClass, sameCheckpointFailures, lastError: run.stderrTail || null, checkpoint };
    }
    process.stderr.write(`import-supervise: ${errorClass}; resuming (${sameCheckpointFailures}/${maxResumes} without new settled progress)\n`);
    await sleep(backoffMs);
    if (stopSignal) return { outcome: 'stopped', signal: stopSignal, launches, attachedRuns, ...extra };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  if (!args.project) throw new Error(`--project is required\n${usage()}`);
  // A host that stops the tool call stops this process. Forward the signal so the import stops
  // with it (and resumes on the next call) instead of running on unsupervised.
  for (const name of Object.keys(SIGNALS)) {
    process.on(name, () => {
      stopSignal = name;
      if (activeChild && activeChild.exitCode === null) activeChild.kill(name);
      // An attached import has no child handle; stopping the supervisor must stop it too, or it runs on
      // unsupervised (the next call resumes it).
      if (attachedPid > 0) { try { process.kill(attachedPid, name); } catch { /* already gone */ } }
    });
  }
  const result = await supervise(args);
  process.stdout.write(`${JSON.stringify({ ok: result.outcome !== 'stopped', ...result })}\n`);
  process.exitCode = result.outcome === 'stopped' ? 128 + SIGNALS[result.signal] : EXIT[result.outcome];
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, outcome: 'error', error: String(error && error.message ? error.message : error).slice(0, 400) })}\n`);
  process.exit(EXIT.error);
});
