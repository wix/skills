'use strict';

// Where a detached import supervisor records itself, and how to find or stop it.
//
// A host stops a long tool call at its own limit (for example a background command's longest
// timeout). The supervisor that owns the import therefore runs in its own session, outside the
// agent's tool call, and records itself here. The agent's command only waits for it; the runner's
// cancel stops it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isProcessAlive } = require('./local-state.js');

const SUPERVISOR_ENTRY = 'import-supervise.js';

function superviseDir(projectDir) {
  return path.join(projectDir, 'state', 'supervise');
}
function safeScript(script) {
  return String(script).replace(/[^A-Za-z0-9_.-]/g, '_');
}
function supervisorClaimPath(projectDir, script) {
  return path.join(superviseDir(projectDir), `${safeScript(script)}.supervisor.json`);
}
function supervisorResultPath(projectDir, script) {
  return path.join(superviseDir(projectDir), `${safeScript(script)}.result.json`);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}

// A recorded pid can be reused after a reboot. Where /proc exists, the process must still be
// running the given script; elsewhere a live pid on this host is the best evidence available.
function runsEntry(pid, entry) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').some((arg) => arg.endsWith(entry));
  } catch (error) {
    return !(error && error.code === 'ENOENT' && fs.existsSync('/proc/self'));
  }
}

function isLiveSupervisor(pid) {
  return Number.isInteger(pid) && pid > 0 && isProcessAlive(pid) && runsEntry(pid, SUPERVISOR_ENTRY);
}

function liveSupervisor(projectDir, script) {
  const claim = readJson(supervisorClaimPath(projectDir, script));
  return claim && claim.host === os.hostname() && isLiveSupervisor(claim.pid) ? claim : null;
}

// Every live detached supervisor of this project (one per script id).
function liveSupervisors(projectDir) {
  let names = [];
  try { names = fs.readdirSync(superviseDir(projectDir)); } catch { return []; }
  return names.filter((name) => name.endsWith('.supervisor.json'))
    .map((name) => liveSupervisor(projectDir, name.slice(0, -'.supervisor.json'.length)))
    .filter(Boolean);
}

// SIGTERM makes a supervisor stop its import (no new writes) and record its result.
function stopSupervisors(projectDir, signal = 'SIGTERM') {
  const stopped = [];
  for (const claim of liveSupervisors(projectDir)) {
    try { process.kill(claim.pid, signal); stopped.push(claim.pid); } catch { /* already gone */ }
  }
  return stopped;
}

module.exports = { supervisorClaimPath, supervisorResultPath, readJson, writeJson, runsEntry, isLiveSupervisor, liveSupervisor, liveSupervisors, stopSupervisors };
