#!/usr/bin/env node
'use strict';

// The read-only source extract (data/source-extract), run by the toolkit, not the agent.
// It starts in the background as soon as discovery capture ends, and the mapping stage entry waits
// for it, so the plan pre-fill has records without an agent turn. Every reader runs, optional ones
// included (a reader whose route the store lacks writes 0 records). Reads only; never writes to Wix.
//
//   node source-extract-background.js --wait --project <dir> [--timeout-ms <n>]   wait, print the status
//   node source-extract-background.js --run --project <dir> --script <extractor>  (internal: the child)
//
// Status: execution/source-extract-background.json
//   { status: starting|running|complete|partial|failed, pid, startedAt, finishedAt, exitCode, out, log }
//   partial = some readers failed (the extractor's exit 1); the rest of the records are written.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const STATUS = 'execution/source-extract-background.json';
const OUT = 'execution/source-extract-background.out.json';
const LOG = 'execution/source-extract-background.log';
// Platform family -> its read-only extractor. It must accept --project <dir> --all.
const EXTRACTORS = Object.freeze({ wordpress: 'resources/rp-source-wordpress/scripts/wp-catalog-extract.js' });
const ACTIVE = new Set(['starting', 'running']);
const START_GRACE_MS = 60000;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function writeStatus(projectDir, status) {
  const file = path.join(projectDir, STATUS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(status, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}
const readStatus = (projectDir) => readJson(path.join(projectDir, STATUS));
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }

function extractorFor(platform) {
  const family = require('./plan-prefill.js').platformFamily(platform);
  const rel = EXTRACTORS[family];
  return rel ? path.join(__dirname, '..', rel) : null;
}

// The source credentials the capture used (config/source.<platform>.env).
function hasSourceCredentials(projectDir) {
  try { return fs.readdirSync(path.join(projectDir, 'config')).some((n) => /^source\..+\.env$/.test(n)); } catch { return false; }
}

// Records already on disk (an earlier extract, or the mapper's own) are not read again.
function extracted(projectDir) {
  return ['data/source-extract', 'data/mapper-extract'].some((rel) => { try { return fs.readdirSync(path.join(projectDir, rel)).some((n) => n.endsWith('.ndjson') || n === 'manifest.json'); } catch { return false; } });
}

// A status whose process is gone is final: a crash before it wrote its end is a failure.
function current(projectDir) {
  const status = readStatus(projectDir);
  if (!status || !ACTIVE.has(status.status)) return status;
  const gone = status.pid ? !alive(status.pid) : Date.now() - Date.parse(status.startedAt || 0) > START_GRACE_MS;
  if (!gone) return status;
  const ended = { ...readStatus(projectDir) };
  if (!ACTIVE.has(ended.status)) return ended;
  const failed = { ...ended, status: 'failed', finishedAt: new Date().toISOString(), reason: 'process-ended-without-status' };
  writeStatus(projectDir, failed);
  return failed;
}

// Starts the extract once per project. Returns { started, status } or { skipped, ... }.
// A failed extract is started again only when asked (retry: the mapping entry), not on every route.
function startSourceExtract(projectDir, { platform, retry = false } = {}) {
  const script = extractorFor(platform);
  if (!script || !fs.existsSync(script)) return { skipped: 'no-extractor', platform: platform || null };
  if (!hasSourceCredentials(projectDir)) return { skipped: 'no-source-credentials', platform };
  const status = current(projectDir);
  if (status && (status.status !== 'failed' || !retry)) return { skipped: 'already-started', status: status.status };
  if (!status && extracted(projectDir)) return { skipped: 'already-extracted' };
  writeStatus(projectDir, { status: 'starting', platform, startedAt: new Date().toISOString(), out: OUT, log: LOG });
  const child = spawn(process.execPath, [__filename, '--run', '--project', projectDir, '--script', script], { detached: true, stdio: 'ignore', cwd: projectDir });
  child.unref();
  return { started: true, status: 'starting', file: STATUS };
}

function runChild(projectDir, script) {
  const started = readStatus(projectDir) || {};
  writeStatus(projectDir, { ...started, status: 'running', pid: process.pid, startedAt: started.startedAt || new Date().toISOString(), out: OUT, log: LOG });
  const out = fs.openSync(path.join(projectDir, OUT), 'w');
  const log = fs.openSync(path.join(projectDir, LOG), 'w');
  const res = spawnSync(process.execPath, [script, '--project', projectDir, '--all'], { cwd: projectDir, stdio: ['ignore', out, log] });
  fs.closeSync(out); fs.closeSync(log);
  const exitCode = res.status;
  writeStatus(projectDir, { ...readStatus(projectDir), status: exitCode === 0 ? 'complete' : exitCode === 1 ? 'partial' : 'failed', exitCode, finishedAt: new Date().toISOString() });
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Blocks until the extract ends or timeoutMs passes; returns the status (null: never started).
function waitForSourceExtract(projectDir, { timeoutMs = 0, pollMs = 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  let status = current(projectDir);
  while (status && ACTIVE.has(status.status) && Date.now() < until) {
    sleep(Math.min(pollMs, Math.max(1, until - Date.now())));
    status = current(projectDir);
  }
  return status;
}

// The run controller's wait: the same, without blocking its event loop.
async function waitForSourceExtractAsync(projectDir, { timeoutMs = 0, pollMs = 2000 } = {}) {
  const until = Date.now() + timeoutMs;
  let status = current(projectDir);
  while (status && ACTIVE.has(status.status) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, until - Date.now()))));
    status = current(projectDir);
  }
  return status;
}

module.exports = { startSourceExtract, waitForSourceExtract, waitForSourceExtractAsync, readSourceExtractStatus: current, extractorFor, STATUS, EXTRACTORS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const projectDir = arg('--project') && path.resolve(arg('--project'));
  if (!projectDir) { console.log(JSON.stringify({ ok: false, error: 'usage', message: '--project is required' })); process.exitCode = 2; }
  else if (argv.includes('--run')) runChild(projectDir, arg('--script'));
  else {
    const status = waitForSourceExtract(projectDir, { timeoutMs: Number(arg('--timeout-ms') || 30 * 60000) });
    console.log(JSON.stringify(status || { status: 'not-started' }, null, 2));
    process.exitCode = status && ['complete', 'partial'].includes(status.status) ? 0 : 1;
  }
}
