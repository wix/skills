'use strict';

// The toolkit's background work for one project, and the one wait for it, so an agent never
// writes its own wait loop. A hand-written loop can hang: `while pgrep -f "scripts/x.js"; do
// sleep 10; done` matches the shell running that same line, so it never ends and the agent sits
// idle until the host's tool-call limit.
//
// It reads only what already exists, and writes nothing (the extract status read records a
// crashed extract as failed, as it always has):
// - execution/progress.ndjson: every toolkit script (capture, extract, import, generated code)
//   writes start ... complete|error there with its own pid and host (lib/progress-log.js);
// - the source extract status (lib/source-extract-background.js), which covers its start gap;
// - the detached import supervisors (lib/detached-supervisor.js), which cover a resume gap.
// A run is running while its newest record is not terminal and its pid is alive on this host.
// A run whose pid is gone without a terminal record ended abnormally (failed).
// Limitations: a run written from another host is not waited for; a reused pid keeps a dead run
// "running" until the wait's timeout.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isProcessAlive } = require('./local-state.js');
const { projectProgressLog } = require('./progress-log.js');

const TERMINAL = { complete: 'completed', error: 'failed' };
const HOST = Buffer.from(os.hostname()).toString('base64url');

function readRecords(projectDir) {
  let raw = '';
  try { raw = fs.readFileSync(projectProgressLog(projectDir), 'utf8'); } catch { return []; }
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* a truncated line from a killed writer */ }
  }
  return records;
}

// This process and the processes it runs under (the agent, the runner): never waited for.
function ancestors() {
  const out = new Set([process.pid]);
  let pid = process.ppid;
  for (let i = 0; pid > 1 && i < 64; i += 1) {
    out.add(pid);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    } catch { break; }
  }
  return out;
}

// One entry per progress run: { kind, name, runId, status, pid, startedAt, lastAt, message }.
function progressJobs(projectDir, skip) {
  const runs = new Map();
  for (const r of readRecords(projectDir)) {
    if (!r || !r.runId || typeof r.script !== 'string') continue;
    const run = runs.get(r.runId) || { first: r, last: r };
    if ((Number(r.seq) || 0) >= (Number(run.last.seq) || 0)) run.last = r;
    runs.set(r.runId, run);
  }
  const jobs = [];
  for (const [runId, { first, last }] of runs) {
    let status = TERMINAL[last.event];
    if (!status) {
      const local = last.host === HOST && Number.isInteger(last.pid) && last.pid > 0;
      if (local && skip.has(last.pid)) continue;
      status = !local ? 'unknown-host' : alive(last.pid) ? 'running' : 'failed';
    }
    jobs.push({ kind: 'script', name: last.script, runId, status, pid: last.pid ?? null, startedAt: first.ts, lastAt: last.ts,
      ...(status === 'failed' && !TERMINAL[last.event] ? { reason: 'process-ended-without-status' } : {}), message: last.message });
  }
  return jobs;
}

function extractJob(projectDir) {
  const status = require('./source-extract-background.js').readSourceExtractStatus(projectDir);
  if (!status) return null;
  const map = { starting: 'running', running: 'running', complete: 'completed', partial: 'failed', failed: 'failed' };
  return { kind: 'source-extract', name: 'source-extract', status: map[status.status] || status.status, detail: status.status,
    startedAt: status.startedAt, lastAt: status.finishedAt || status.startedAt, ...(status.out ? { out: status.out } : {}) };
}

function supervisorJobs(projectDir) {
  return require('./detached-supervisor.js').liveSupervisors(projectDir)
    .map((claim) => ({ kind: 'import-supervisor', name: 'import-supervise', status: 'running', pid: claim.pid, startedAt: claim.startedAt }));
}

// Every known job of the project; `script` keeps those whose name contains it.
function backgroundJobs(projectDir, { script = null } = {}) {
  const dir = path.resolve(projectDir);
  const jobs = [...progressJobs(dir, ancestors()), extractJob(dir), ...supervisorJobs(dir)].filter(Boolean);
  return script ? jobs.filter((job) => String(job.name).includes(script)) : jobs;
}

// A zombie (exited, not yet reaped by its parent) still answers kill(pid, 0); it is not running.
function alive(pid) {
  if (!isProcessAlive(pid)) return false;
  try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'; } catch { return true; }
}

const running = (jobs) => jobs.filter((job) => job.status === 'running');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const key = (job) => job.runId || `${job.kind}:${job.pid || ''}`;

// Blocks until no matching job runs, or timeoutMs passes. Returns
// { outcome: done|still_running|idle, running, ended, failed }:
// - done: something ran when the wait began (or started during it) and all of it has ended;
// - idle: nothing was running; `recent` is the newest run of each job, to read its result;
// - still_running: the timeout passed first; run the same wait again.
function waitForBackground(projectDir, { script = null, timeoutMs = 0, pollMs = 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  const seen = new Map();
  let jobs = backgroundJobs(projectDir, { script });
  for (const job of running(jobs)) seen.set(key(job), job);
  while (running(jobs).length && Date.now() < until) {
    sleep(Math.min(pollMs, Math.max(1, until - Date.now())));
    jobs = backgroundJobs(projectDir, { script });
    for (const job of running(jobs)) seen.set(key(job), job);
  }
  const now = running(jobs);
  if (now.length) return { outcome: 'still_running', running: now };
  if (!seen.size) {
    const newest = new Map();
    for (const job of jobs) if (!newest.has(job.name) || String(job.lastAt) > String(newest.get(job.name).lastAt)) newest.set(job.name, job);
    const recent = [...newest.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, 10);
    return { outcome: 'idle', recent, failed: recent.filter((job) => job.status === 'failed') };
  }
  const byKey = new Map(jobs.map((job) => [key(job), job]));
  const ended = [...seen.keys()].map((k) => byKey.get(k) || { ...seen.get(k), status: 'ended' });
  return { outcome: 'done', ended, failed: ended.filter((job) => job.status === 'failed') };
}

// Files the toolkit's own work appends to while it runs. The import journals every write in
// state/attempts/write-attempts.ndjson even when its generated code logs nothing to
// execution/progress.ndjson (run 7b: the journal grew for 40 minutes after the progress log
// went quiet). A directory's mtime changes when a file is added to it.
const ACTIVITY_PATHS = [
  path.join('execution', 'progress.ndjson'),
  path.join('execution', 'source-extract-background.json'),
  path.join('state', 'attempts', 'write-attempts.ndjson'),
  path.join('state', 'attempts', 'wix-request-captures.ndjson'),
  path.join('state', 'sample', 'attempts', 'write-attempts.ndjson'),
  path.join('state', 'source-extract-ledger.ndjson'),
  path.join('state', 'write-verification-journal'),
  path.join('state', 'supervise'),
];

// One string that changes whenever any toolkit journal grows or changes.
function activityMark(projectDir) {
  return ACTIVITY_PATHS.map((rel) => {
    try { const stat = fs.statSync(path.join(projectDir, rel)); return `${stat.size}:${stat.mtimeMs}`; } catch { return '-'; }
  }).join('|');
}

// The toolkit jobs of the project that are alive now (scripts, extract, import supervisors).
function liveToolkitJobs(projectDir) {
  try { return running(backgroundJobs(projectDir)); } catch { return []; }
}

module.exports = { backgroundJobs, waitForBackground, activityMark, liveToolkitJobs, ACTIVITY_PATHS };
