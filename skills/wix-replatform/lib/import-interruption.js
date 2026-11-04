'use strict';

// A run that stops still writes what it knows. One wrapper owns an import's
// dispatch and its single completion call. A normal end, a thrown error, a `wix_auth_expired`
// stop and SIGTERM/SIGINT all reach `finalize` exactly once; only a stop passes an
// `interruption`. When finalize cannot run or does not mark the stop, the report is stamped or
// rebuilt from the attempt journal, so cutover never meets a missing report.
const fs = require('node:fs/promises');
const path = require('node:path');
// Loaded on a stop only: a vendored entrypoint must start even where the report's own target
// knowledge is not laid out yet.
const lazy = (name) => () => require(name);
const reportLib = lazy('./completion-report.js');
const localLib = lazy('./local-state.js');

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
// Long enough for one in-flight batch to settle; a supervisor's SIGKILL usually follows within
// a minute, and the journal fallback covers that case.
const FINALIZE_GRACE_MS = 60000;
const IMPORTED = new Set(['imported']);
const PRESENT = new Set(['skipped_already_imported']);
const FAILED = new Set(['failed_retryable', 'failed_terminal']);

function interruptionFromSignal(signal, at = new Date()) {
  return { kind: 'signal', signal, code: null, at: new Date(at).toISOString() };
}

// Codes only: an error message can echo a record value.
function interruptionFromError(error, at = new Date()) {
  const auth = Boolean(error) && error.interruption === true && error.code === 'wix_auth_expired';
  const code = error && typeof error.code === 'string' && error.code ? error.code : (error && error.name) || null;
  return { kind: auth ? 'wix_auth_expired' : 'error', signal: null, code, at: new Date(at).toISOString() };
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Rebuilds per-entity counts from the attempt journal: the latest row per source key, grouped by
// target entity type. Records the run never reached have no row and are not counted; the
// interruption action says so.
function journalCompleteness(rows) {
  const latest = new Map();
  for (const row of rows) if (row && row.sourceStableKey && row.phase !== 'setup') latest.set(`${row.targetEntityType || row.writeSpecId}\0${row.sourceStableKey}`, row);
  const byEntity = new Map();
  for (const row of latest.values()) {
    const entity = row.targetEntityType || row.writeSpecId || 'unknown';
    const counts = byEntity.get(entity) || { entity, subtype: 'all', inScope: 0, attempted: 0, imported: 0, alreadyPresentByCrosswalk: 0, deferred: 0, failed: 0, unresolved: 0, sourceKeys: [] };
    if (row.status === 'skipped_out_of_scope') { byEntity.set(entity, counts); continue; }
    counts.inScope += 1; counts.sourceKeys.push(row.sourceStableKey);
    if (IMPORTED.has(row.status)) { counts.imported += 1; counts.attempted += 1; }
    else if (PRESENT.has(row.status)) counts.alreadyPresentByCrosswalk += 1;
    else if (FAILED.has(row.status)) { counts.failed += 1; counts.attempted += 1; }
    else if (row.status === 'deferred' || row.status === 'skipped_safe_mode_blocked' || row.status === 'skipped_unexpected') counts.deferred += 1;
    // Uncertain writes (started, succeeded_unverified, needs_verification) are left out of every
    // counter here: attachAttemptReasons fills the gap from the same rows, with their target ids.
    else counts.attempted += 1;
    byEntity.set(entity, counts);
  }
  return [...byEntity.values()].sort((a, b) => a.entity.localeCompare(b.entity));
}

async function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, text);
  await fs.rename(temp, file);
}

async function manifestDigest(projectDir) {
  const manifest = await readJson(path.join(projectDir, 'execution/execution-manifest.json'));
  return manifest && typeof manifest.mappingPlanDigest === 'string' ? manifest.mappingPlanDigest : null;
}


// Makes sure `execution/completion-report.json` records this stop. Three cases:
// - finalize already wrote this run's report with the interruption: nothing to do;
// - finalize wrote this run's report without it (an older generated importer): stamp it;
// - there is no report for this run: rebuild one from the attempt journal.
async function ensureInterruptedCompletionReport(projectDir, { runId = null, interruption, siteId = null, mappingPlanDigest = null } = {}) {
  const normalized = reportLib().normalizeInterruption(interruption);
  const existing = await readJson(path.join(projectDir, reportLib().COMPLETION_REPORT_FILE));
  if (existing && existing.interruption && (!runId || existing.runId === runId)) return { action: 'kept', report: existing };
  if (existing && runId && existing.runId === runId) {
    // Already joined by the writer: stamp in place, never re-join (that would repeat the joined
    // operator actions).
    const stamped = reportLib().stampInterruption(existing, normalized);
    await writeAtomic(path.join(projectDir, reportLib().COMPLETION_REPORT_FILE), `${JSON.stringify(stamped, null, 2)}\n`);
    await writeAtomic(path.join(projectDir, reportLib().COMPLETION_SUMMARY_FILE), reportLib().renderCompletionSummary(stamped));
    return { action: 'stamped', report: stamped };
  }
  const { rows } = await localLib().loadAttemptJournal(projectDir).catch((error) => { if (error.code === 'ENOENT') return { rows: [] }; throw error; });
  const runIds = [...new Set(rows.map((row) => row.runId).filter((id) => typeof id === 'string' && id))];
  const rebuiltRunId = runId || runIds[runIds.length - 1] || 'interrupted-run';
  const completeness = journalCompleteness(rows);
  const lastWriteAt = rows.map((row) => row.ts).filter((ts) => typeof ts === 'string' && !Number.isNaN(Date.parse(ts))).sort().pop() || normalized.at;
  const rebuilt = reportLib().createCompletionReport({
    runId: rebuiltRunId,
    siteId,
    lastWriteAt,
    interruption: { ...normalized, rebuiltFromJournal: true },
    entityCompleteness: runIds.length ? reportLib().attachAttemptReasons(completeness, rows, { runIds }) : completeness,
    stageResiduals: [],
    orderHistoryInScope: completeness.some((row) => /(^|[/:._-])orders?$/i.test(row.entity)),
    warnings: ['Rebuilt from the attempt journal after the import stopped before its completion step; records the run never reached are not counted.'],
  });
  const written = await reportLib().writeCompletionReport(projectDir, rebuilt, { runId: rebuiltRunId, mappingPlanDigest: mappingPlanDigest || await manifestDigest(projectDir) });
  return { action: 'rebuilt', report: written.report };
}

// The cutover-facing artifacts for a stopped run. Best effort: a refusal here (a stale census, an
// unapproved mapping) is the same refusal the router would hit, and it never hides the report.
async function refreshInterruptedHandoff(projectDir, { stderr = process.stderr } = {}) {
  const value = await readJson(path.join(projectDir, reportLib().COMPLETION_REPORT_FILE));
  try {
    if (value && value.managementImportMode !== 'quick') await require('./discovered-set-status.js').buildDiscoveredSetStatus(projectDir);
  } catch (error) {
    stderr.write(`interrupted handoff: discovered-set status not refreshed (${error.code || error.message})\n`);
  }
  const outcome = await require('./website-handoff.js').generatePostExecutionHandoff(projectDir);
  if (!outcome.ok) stderr.write(`interrupted handoff: post-execution handoff refused (${outcome.reason})\n`);
  return outcome;
}

async function recordInterruption(projectDir, options, { stderr = process.stderr } = {}) {
  try {
    const result = await ensureInterruptedCompletionReport(projectDir, options);
    await refreshInterruptedHandoff(projectDir, { stderr });
    return result;
  } catch (error) {
    stderr.write(`interrupted import: completion report not written (${error.code || error.message}); run scripts/interrupted-completion-report.js\n`);
    return { action: 'failed', error };
  }
}

function delay(ms) {
  let timer;
  const promise = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return { promise, cancel: () => clearTimeout(timer) };
}

// Awaits `promise` for at most `ms`; a step that hangs past it is reported and abandoned, so the
// whole shutdown stays bounded.
async function bounded(promise, ms, label, stderr) {
  const timer = delay(ms);
  try {
    const outcome = await Promise.race([promise.then(() => 'done', (error) => { stderr.write(`${label} failed (${error.code || error.message})\n`); return 'failed'; }), timer.promise.then(() => 'timeout')]);
    if (outcome === 'timeout') stderr.write(`${label} did not finish within ${ms} ms; the journal is the record\n`);
    return outcome;
  } finally { timer.cancel(); }
}

function latchStop(projectDir, signal) {
  if (!projectDir) return;
  try { require('./wix-auth.js').latchStop(projectDir, signal); } catch (error) {
    // A project that never vendored wix-auth.js has no token-source client to stop.
    if (!(error && error.code === 'MODULE_NOT_FOUND')) throw error;
  }
}

// Runs `dispatch({ stopRequested })`, then `finalize(interruption, result)` at most once.
// - normal end: finalize(null, result), return the result. A stop during finalize, or a finalize
//   that throws, never calls finalize again: the report is stamped or rebuilt instead.
// - dispatch throws: finalize(error interruption), record the stop, rethrow.
// - SIGTERM/SIGINT: latch the project (no new Wix request, no new `started` row), let in-flight
//   writes settle for `graceMs`. If dispatch settled, finalize from memory with what it returned;
//   if not, writes are still outstanding and only the journal is trusted. Record the stop, exit
//   143/130. Every step is bounded by `stepMs`; a second signal exits at once.
// `onInterrupted(interruption)` stamps or rebuilds the report and writes the handoff.
async function runImportWithFinalize({ dispatch, finalize, onInterrupted = async () => {}, projectDir, graceMs = FINALIZE_GRACE_MS, stepMs = FINALIZE_GRACE_MS, proc = process, stderr = process.stderr }) {
  // Without the project there is no latch, and a stopped run would keep starting writes.
  if (typeof projectDir !== 'string' || !projectDir) throw new TypeError('runImportWithFinalize requires projectDir');
  let finalized = false;
  const finalizeOnce = (interruption, result) => {
    if (finalized) return Promise.resolve();
    finalized = true;
    return Promise.resolve().then(() => finalize(interruption, result));
  };
  let signalled = null;
  let resolveSignal;
  const signal = new Promise((resolve) => { resolveSignal = resolve; });
  const handlers = Object.keys(SIGNAL_EXIT_CODES).map((name) => {
    const handler = () => {
      if (signalled) { proc.exit(SIGNAL_EXIT_CODES[name]); return; }
      signalled = interruptionFromSignal(name);
      latchStop(projectDir, name);
      stderr.write(`import stopping on ${name}: no new writes; recording what is known before exit\n`);
      resolveSignal(signalled);
    };
    proc.on(name, handler);
    return [name, handler];
  });
  const settled = { done: false, result: undefined };
  const work = Promise.resolve()
    .then(() => dispatch({ stopRequested: () => Boolean(signalled) }))
    .then((result) => { settled.done = true; settled.result = result; return result; }, (error) => { settled.done = true; throw error; });
  const recordStop = (interruption) => bounded(Promise.resolve().then(() => onInterrupted(interruption)), stepMs, 'recording the stop', stderr);
  const exitOnSignal = async (interruption) => {
    await recordStop(interruption);
    proc.exit(SIGNAL_EXIT_CODES[interruption.signal]);
  };
  try {
    const first = await Promise.race([work.then((result) => ({ result })), signal.then((interruption) => ({ interruption }))]);
    if (!first.interruption) {
      let finalizeError = null;
      const finalizing = finalizeOnce(null, first.result).then(() => 'done', (error) => { finalizeError = error; return 'failed'; });
      const outcome = await Promise.race([finalizing, signal.then(() => 'signal')]);
      if (outcome === 'signal') {
        // Let the running finalizer land first (the writer's latch fence marks its report
        // aborted), so recording the stop keeps or stamps that report instead of racing it.
        await bounded(finalizing, stepMs, 'import finalization after the stop', stderr);
        await exitOnSignal(signalled);
        return undefined;
      }
      if (finalizeError) {
        // Every write finished but no report was written: rebuild it, then fail the run.
        await recordStop(interruptionFromError(finalizeError));
        throw finalizeError;
      }
      return first.result;
    }
    const grace = delay(graceMs);
    await Promise.race([work.catch(() => {}), grace.promise]);
    grace.cancel();
    if (settled.done) await bounded(finalizeOnce(first.interruption, settled.result), stepMs, 'import finalization after the stop', stderr);
    else stderr.write('writes still in flight after the grace period; the report is rebuilt from the attempt journal\n');
    await exitOnSignal(first.interruption);
    return undefined;
  } catch (error) {
    if (finalized) throw error;
    const interruption = interruptionFromError(error);
    await bounded(finalizeOnce(interruption, undefined), stepMs, 'import finalization after the error', stderr);
    await recordStop(interruption);
    throw error;
  } finally {
    for (const [name, handler] of handlers) proc.removeListener(name, handler);
  }
}

module.exports = {
  SIGNAL_EXIT_CODES,
  FINALIZE_GRACE_MS,
  interruptionFromSignal,
  interruptionFromError,
  journalCompleteness,
  ensureInterruptedCompletionReport,
  refreshInterruptedHandoff,
  recordInterruption,
  runImportWithFinalize,
};
