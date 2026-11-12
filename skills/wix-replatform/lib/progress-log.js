'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const RUNNING_EVENTS = new Set(['start', 'progress', 'heartbeat', 'warning']);

function slugify(value) {
  return String(value || 'script')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'script';
}

function defaultRunId(script) {
  return `${slugify(script)}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
}

function parseProgressArgs(argv, env = process.env) {
  const args = [];
  const progress = {
    progressLog: env.PROGRESS_LOG || null,
    runId: env.RUN_ID || null,
    parentRunId: env.PARENT_RUN_ID || null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--progress-log') {
      progress.progressLog = argv[i + 1];
      i += 1;
    } else if (arg === '--run-id') {
      progress.runId = argv[i + 1];
      i += 1;
    } else if (arg === '--parent-run-id') {
      progress.parentRunId = argv[i + 1];
      i += 1;
    } else {
      args.push(arg);
    }
  }

  return { args, progress };
}

function statusForEvent(event) {
  if (event === 'complete') {
    return 'completed';
  }
  if (event === 'error') {
    return 'failed';
  }
  if (RUNNING_EVENTS.has(event)) {
    return 'running';
  }
  throw new Error(`unknown progress event: ${event}`);
}

function createProgressLogger(options = {}) {
  const progressLog = options.progressLog || null;
  const script = options.script || 'script';
  const runId = options.runId || defaultRunId(script);
  const parentRunId = options.parentRunId || null;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || 30000;

  let seq = 0;
  let started = false;
  let terminal = false;
  let lastProgressAt = 0;
  let heartbeatTimer = null;
  let heartbeatContext = null;

  function enabled() {
    return Boolean(progressLog);
  }

  function append(event, message, fields = {}) {
    if (!enabled()) {
      return null;
    }
    fs.mkdirSync(path.dirname(progressLog), { recursive: true });
    seq += 1;
    const record = {
      ts: new Date().toISOString(),
      runId,
      ...(parentRunId ? { parentRunId } : {}),
      script,
      event,
      status: statusForEvent(event),
      seq,
      // `host`/`pid` give a health-check reader a script-agnostic, same-machine liveness signal
      // straight from the record itself -- the existing state/.lock/ owner-claim check only ever
      // covers a process that calls withStateLock (import writers), so a read-only script (e.g.
      // a generated run-extract.js) that never acquires that lock had no way to be corroborated
      // as live once its heartbeat went stale. `host` is encoded the same way local-state.js's
      // lock-claim filenames already are, so a reader only ever trusts a pid on ITS OWN machine.
      // BUG FIX: `...fields` must spread BEFORE `host`/`pid`, not after --
      // a caller-supplied heartbeat field literally named `host` or `pid` must never be able to
      // shadow this record's own true liveness identity.
      ...fields,
      host: Buffer.from(os.hostname()).toString('base64url'),
      pid: process.pid,
      message: String(message || event),
    };
    fs.appendFileSync(progressLog, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
    // BUG FIX: this used to only reset on a NON-heartbeat event, so once
    // the ticker's own `elapsed >= heartbeatIntervalMs` check first became true, `lastProgressAt`
    // never moved again and every subsequent tick re-fired a heartbeat -- flooding the log at the
    // ticker's poll rate (capped at 5s) instead of the configured interval. A heartbeat IS
    // progress (proof the process is alive and looking), so it must reset the clock the same as
    // any other event.
    lastProgressAt = Date.now();
    if (event === 'start') {
      started = true;
    }
    if (event === 'complete' || event === 'error') {
      terminal = true;
      stopHeartbeat();
    }
    return record;
  }

  function start(message, fields = {}) {
    return append('start', message, fields);
  }

  function progress(message, fields = {}) {
    return append('progress', message, fields);
  }

  function heartbeat(message, fields = {}) {
    return append('heartbeat', message, fields);
  }

  function warn(message, fields = {}) {
    return append('warning', message, fields);
  }

  function error(message, fields = {}) {
    return append('error', message, fields);
  }

  function complete(message, fields = {}) {
    return append('complete', message, fields);
  }

  function startHeartbeat(fields = {}) {
    if (!enabled() || heartbeatTimer) {
      return;
    }
    heartbeatContext = fields;
    heartbeatTimer = setInterval(() => {
      if (terminal) {
        stopHeartbeat();
        return;
      }
      const elapsed = Date.now() - lastProgressAt;
      if (elapsed >= heartbeatIntervalMs) {
        heartbeat(fields.message || 'Still running', fields);
      }
    }, Math.max(1000, Math.min(heartbeatIntervalMs, 5000)));
    heartbeatTimer.unref?.();
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      heartbeatContext = null;
    }
  }

  async function withHeartbeat(fields, fn) {
    startHeartbeat(fields);
    try {
      return await fn();
    } finally {
      stopHeartbeat();
    }
  }

  function childEnv(extra = {}) {
    return {
      ...extra,
      ...(progressLog ? { PROGRESS_LOG: progressLog, PARENT_RUN_ID: runId } : {}),
    };
  }

  function installTerminalHandlers() {
    if (!enabled()) {
      return;
    }
    process.on('exit', (code) => {
      if (started && !terminal && code !== 0) {
        append('error', `Process exited before writing a terminal progress record`, {
          exitCode: code,
          ...(heartbeatContext || {}),
        });
      }
    });
    process.on('uncaughtException', (err) => {
      if (started && !terminal) {
        error(err && err.message ? err.message : 'Uncaught exception', { errorName: err && err.name });
      }
      throw err;
    });
    process.on('unhandledRejection', (reason) => {
      if (started && !terminal) {
        error(reason && reason.message ? reason.message : 'Unhandled rejection', { errorName: reason && reason.name });
      }
    });
  }

  installTerminalHandlers();

  return {
    progressLog,
    script,
    runId,
    parentRunId,
    enabled,
    start,
    progress,
    heartbeat,
    warn,
    error,
    complete,
    startHeartbeat,
    stopHeartbeat,
    withHeartbeat,
    childEnv,
  };
}

module.exports = {
  createProgressLogger,
  parseProgressArgs,
};
