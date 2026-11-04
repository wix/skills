'use strict';

// A bounded summary of the write ledger, so no agent reads the raw file.
//
// The attempt journal (`state/attempts/write-attempts.ndjson`) is append-only and reached 79 MB on
// a measured full run; agents opened it repeatedly and every byte they read stayed in their context
// for the rest of the subagent's life. This reads it as a stream, folds rows by `attemptId` (a
// later row for the same attempt updates it, exactly like `local-state.js` `foldAttempts`), and
// returns counts plus a small, capped sample. Memory grows with distinct attempts, never with
// file size. It writes nothing and calls nothing remote.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const LEDGERS = {
  attempts: 'state/attempts/write-attempts.ndjson',
  audit: 'logs/import-audit.ndjson',
};
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const TOP_ERRORS = 5;
const MESSAGE_CHARS = 160;
const DEFAULT_FIELDS = ['attemptId', 'sourceStableKey', 'targetEntityType', 'status', 'runId', 'errorClass', 'message'];

function errorClassOf(row) {
  const failure = row && row.failure;
  if (!failure || typeof failure !== 'object') return null;
  if (failure.errorCode) return String(failure.errorCode);
  if (failure.httpStatus) return `http_${failure.httpStatus}`;
  if (failure.outcome) return String(failure.outcome);
  return 'unclassified';
}

function compactAttempt(row) {
  const failure = row.failure && typeof row.failure === 'object' ? row.failure : null;
  const message = failure && failure.message ? String(failure.message) : null;
  return {
    attemptId: row.attemptId,
    sourceStableKey: row.sourceStableKey,
    targetEntityType: row.targetEntityType || 'unknown',
    status: row.status || 'unknown',
    runId: row.runId || null,
    errorClass: errorClassOf(row),
    message: message && message.length > MESSAGE_CHARS ? `${message.slice(0, MESSAGE_CHARS)}…` : message,
  };
}

async function forEachRow(filePath, onRow) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let rows = 0;
  let invalid = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { invalid += 1; continue; }
    rows += 1;
    onRow(row);
  }
  return { rows, invalid };
}

function bump(map, key, sub) {
  const inner = map.get(key) || {};
  inner[sub] = (inner[sub] || 0) + 1;
  map.set(key, inner);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function normalizeOptions(options = {}) {
  const limit = Math.min(Math.max(Number.isFinite(Number(options.limit)) ? Number(options.limit) : DEFAULT_LIMIT, 0), MAX_LIMIT);
  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : DEFAULT_FIELDS;
  return { run: options.run || null, sinceRun: options.sinceRun || null, entity: options.entity || null, status: options.status || null, limit, fields };
}

async function summarizeAttempts(filePath, options = {}) {
  const opts = normalizeOptions(options);
  const attempts = new Map();
  const runOrder = [];
  const seenRuns = new Set();
  const { rows, invalid } = await forEachRow(filePath, (row) => {
    if (!row || !row.attemptId) return;
    if (row.runId && !seenRuns.has(row.runId)) { seenRuns.add(row.runId); runOrder.push(row.runId); }
    const previous = attempts.get(row.attemptId);
    const merged = compactAttempt(previous ? { ...previous.raw, ...row } : row);
    // Keep only the fields compactAttempt needs, so memory tracks attempts, not row size.
    attempts.set(row.attemptId, { ...merged, raw: { attemptId: row.attemptId, sourceStableKey: merged.sourceStableKey, targetEntityType: merged.targetEntityType, status: merged.status, runId: merged.runId, failure: row.failure || (previous && previous.raw.failure) || undefined } });
  });

  const latestRun = runOrder.length ? runOrder[runOrder.length - 1] : null;
  const runFilter = opts.run === 'latest' ? latestRun : opts.run;
  const sinceIndex = opts.sinceRun ? runOrder.indexOf(opts.sinceRun) : -1;
  const runsAfter = sinceIndex >= 0 ? new Set(runOrder.slice(sinceIndex + 1)) : null;

  const byEntity = new Map();
  const errors = new Map();
  const sample = [];
  let matching = 0;
  for (const attempt of attempts.values()) {
    if (runFilter && attempt.runId !== runFilter) continue;
    if (runsAfter && !runsAfter.has(attempt.runId)) continue;
    bump(byEntity, attempt.targetEntityType, attempt.status);
    if (attempt.errorClass) bump(errors, attempt.targetEntityType, attempt.errorClass);
    if (opts.entity && attempt.targetEntityType !== opts.entity) continue;
    if (opts.status && attempt.status !== opts.status) continue;
    matching += 1;
    if (sample.length < opts.limit && (opts.entity || opts.status)) {
      sample.push(Object.fromEntries(opts.fields.filter((field) => field in attempt).map((field) => [field, attempt[field]])));
    }
  }

  const topErrors = {};
  for (const [entity, classes] of errors.entries()) {
    topErrors[entity] = Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, TOP_ERRORS).map(([errorClass, count]) => ({ errorClass, count }));
  }
  const totals = {};
  for (const statuses of byEntity.values()) {
    for (const [status, count] of Object.entries(statuses)) totals[status] = (totals[status] || 0) + count;
  }

  return {
    ledger: 'attempts',
    file: filePath,
    bytes: fs.statSync(filePath).size,
    rows,
    invalidRows: invalid,
    attempts: attempts.size,
    runs: { count: runOrder.length, latest: latestRun, scope: runFilter || (opts.sinceRun ? `after:${opts.sinceRun}` : 'all') },
    totals,
    byEntity: sortedObject(byEntity),
    topErrors,
    filter: (opts.entity || opts.status) ? { entity: opts.entity, status: opts.status, matching, shown: sample.length, limit: opts.limit } : null,
    sample,
  };
}

async function summarizeAudit(filePath, options = {}) {
  const opts = normalizeOptions(options);
  const byEndpoint = new Map();
  const runs = new Set();
  const { rows, invalid } = await forEachRow(filePath, (row) => {
    if (row.runId) runs.add(row.runId);
    if (opts.run && opts.run !== 'latest' && row.runId !== opts.run) return;
    const endpoint = `${row.method || ''} ${row.endpoint || row.operation || 'unknown'}`.trim();
    const outcome = row.httpStatus ? String(row.httpStatus) : (row.result || row.status || 'unknown');
    bump(byEndpoint, endpoint, String(outcome));
  });
  const entries = [...byEndpoint.entries()]
    .map(([endpoint, outcomes]) => [endpoint, outcomes, Object.values(outcomes).reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[2] - a[2]);
  return {
    ledger: 'audit',
    file: filePath,
    bytes: fs.statSync(filePath).size,
    rows,
    invalidRows: invalid,
    runs: { count: runs.size },
    byEndpoint: Object.fromEntries(entries.slice(0, Math.max(opts.limit, 1)).map(([endpoint, outcomes]) => [endpoint, outcomes])),
    endpointsShown: Math.min(entries.length, Math.max(opts.limit, 1)),
    endpointsTotal: entries.length,
  };
}

async function summarizeWriteLog(projectDir, options = {}) {
  const ledger = options.log || 'attempts';
  if (!LEDGERS[ledger]) throw new Error(`unknown --log ${ledger} (expected ${Object.keys(LEDGERS).join(' or ')})`);
  const filePath = path.join(projectDir, LEDGERS[ledger]);
  if (!fs.existsSync(filePath)) {
    return { ledger, file: filePath, missing: true, rows: 0 };
  }
  return ledger === 'audit' ? summarizeAudit(filePath, options) : summarizeAttempts(filePath, options);
}

const TEXT_CAP = 4096;

function formatText(summary) {
  const lines = [];
  if (summary.missing) return `${summary.ledger} ledger not found: ${summary.file}\n`;
  lines.push(`${summary.ledger} ledger: ${summary.rows} rows, ${(summary.bytes / 1e6).toFixed(1)} MB${summary.invalidRows ? `, ${summary.invalidRows} unreadable` : ''}`);
  if (summary.ledger === 'audit') {
    for (const [endpoint, outcomes] of Object.entries(summary.byEndpoint)) {
      lines.push(`  ${endpoint}: ${Object.entries(outcomes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    if (summary.endpointsTotal > summary.endpointsShown) lines.push(`  … ${summary.endpointsTotal - summary.endpointsShown} more endpoints (raise --limit)`);
  } else {
    lines.push(`attempts: ${summary.attempts}; runs: ${summary.runs.count} (latest ${summary.runs.latest}); scope: ${summary.runs.scope}`);
    lines.push(`totals: ${Object.entries(summary.totals).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    for (const [entity, statuses] of Object.entries(summary.byEntity)) {
      const errs = (summary.topErrors[entity] || []).map((e) => `${e.errorClass}×${e.count}`).join(', ');
      lines.push(`  ${entity}: ${Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join(' ')}${errs ? ` | errors: ${errs}` : ''}`);
    }
    if (summary.filter) {
      lines.push(`filter entity=${summary.filter.entity || '*'} status=${summary.filter.status || '*'}: ${summary.filter.matching} match, showing ${summary.filter.shown}`);
      for (const row of summary.sample) lines.push(`  ${JSON.stringify(row)}`);
    }
  }
  let text = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(text) > TEXT_CAP) {
    text = `${Buffer.from(text).subarray(0, TEXT_CAP - 80).toString('utf8')}\n… output capped at ${TEXT_CAP} bytes; narrow with --entity/--status/--limit\n`;
  }
  return text;
}

module.exports = { summarizeWriteLog, formatText, errorClassOf, LEDGERS, TEXT_CAP, DEFAULT_LIMIT };
