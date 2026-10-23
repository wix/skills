#!/usr/bin/env node
'use strict';

// One reusable check that answers exactly one question about a long-running
// generated script: healthy, stalled, or complete. Reads only the artifacts the progress-log and
// execution contracts already define (`execution/progress.ndjson`, `execution/completion-
// report.json`, the `state/.lock/` PID/host claim model rp-execute-import/SKILL.md already
// describes) -- it defines no new state and writes none.
//
// This does not change the progress-log format, event names, or polling contract; it is
// the "so nobody hand-rolls this per run" check layered on top of them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');
// Note: `process.kill(pid, 0)` throwing does not
// by itself mean the process is dead -- Node surfaces the same exception for ESRCH (no such
// process) and EPERM (a real, live process this user cannot signal, e.g. owned by a different
// UID on a shared sandbox). Only ESRCH means dead. This used to be a separate copy of the same
// check duplicated from `local-state.js`'s `withStateLock` -- now shared from one place.
const { isProcessAlive } = require('../lib/local-state.js');

const DEFAULT_SCRIPT = 'run-import';
const DEFAULT_STALE_AFTER = '5m';

let progress;

function usage() {
  console.error(`Usage:
  node skills/wix-replatform/scripts/execution-health-check.js <projectDir> [--script <name>] [--stale-after <duration>]

Reads <projectDir>/execution/progress.ndjson (the NDJSON progress contract) and
<projectDir>/execution/completion-report.json and reports whether the named script's most
recent run is healthy, stalled, or complete. Writes no state and touches no target.

--script        script id to filter progress records by (substring match against each
                record's own "script" field); default "${DEFAULT_SCRIPT}"
--stale-after   how old the most recent matching record may be before it counts as stale,
                absent a live local process claim; default "${DEFAULT_STALE_AFTER}"
                (accepts "<n>ms", "<n>s", "<n>m", "<n>h", "<n>d", or a bare millisecond
                integer)
`);
}

function parseArgs(argv) {
  const args = { script: DEFAULT_SCRIPT, staleAfter: DEFAULT_STALE_AFTER };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--script') {
      args.script = argv[i + 1];
      i += 1;
    } else if (token === '--stale-after') {
      args.staleAfter = argv[i + 1];
      i += 1;
    } else if (!args.projectDir) {
      args.projectDir = token;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i;
const DURATION_UNIT_MS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

function parseDurationMs(value) {
  const match = DURATION_RE.exec(String(value === undefined ? '' : value).trim());
  if (!match) {
    throw new Error(`invalid --stale-after duration: ${JSON.stringify(value)} (expected e.g. "5m", "30s", "1h", or a bare millisecond integer)`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  return amount * DURATION_UNIT_MS[unit];
}

function readProgressRecords(progressLogPath) {
  let raw;
  try {
    raw = fs.readFileSync(progressLogPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { records: [], anyLineSeen: false };
    }
    throw error;
  }
  const records = [];
  let anyLineSeen = false;
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    anyLineSeen = true;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      // This used to throw and crash the WHOLE health-check on a
      // single malformed/truncated line -- e.g. a generated run-import.js SIGKILLed/OOM-killed
      // mid-write leaves a truncated final line in progress.ndjson. That turned the exact
      // crashed-process case this tool exists to diagnose into an opaque failure (exit 1 instead
      // of "stalled"), and every future poll on that project would fail the same way, since the
      // append-only file is never rewritten. Skip the malformed line and keep reading: the health
      // check still evaluates off the last VALID record, which is exactly what "healthy, stalled,
      // or complete" needs. `local-state.js` already tolerates malformed/historical rows the same
      // way on read for the same reason (see tolerateIdentifierOnlyMessage).
      process.stderr.write(`warning: ${progressLogPath}:${index + 1} invalid NDJSON, skipped: ${error.message}\n`);
    }
  }
  // `records.length === 0` alone cannot tell "the log never
  // existed / has zero lines" apart from "the log has lines, but every one was malformed and
  // skipped above" -- both looked identical to `checkHealth`'s `noProgressRecordsAtAll`, letting
  // an all-malformed log fall through to trusting a stale, unrelated completion-report.json as
  // proof of completion. `anyLineSeen` lets the caller tell the two apart.
  return { records, anyLineSeen };
}

// Per the progress-log contract: `seq` is only strictly increasing WITHIN one `runId` -- a shared file can
// interleave more than one `runId`'s lines. "The current state of this script" is therefore the
// highest-`seq` record belonging to the MOST RECENT `runId` that produced a matching line, never
// the raw last line in file order and never a max `seq` compared across different `runId`s.
// "The most recent runId" used to be picked by array position --
// whichever matching record happened to be LAST IN FILE-APPEND ORDER (`matching[matching.length -
// 1].runId`), not by actual timestamp. That is racy if two processes for the same --script ever
// append to the same progress.ndjson concurrently (e.g. a health-check falsely reports "stalled"
// on a run that's actually alive, the driving agent redispatches per this file's own SKILL.md
// guidance without confirming the first process is dead, and now two processes append heartbeats
// to the same file): whichever write reaches the file last would silently win, ignoring the other
// process's later completion or crash. Every record already carries its own genuine `ts`
// (progress-log.js's `append` writes `new Date().toISOString()` on every record, never supplied
// by a caller), so pick the runId that owns the record with the latest real timestamp instead of
// trusting file position. A millisecond-exact tie between two different runIds' records is not
// disambiguated further (ISO timestamps only carry millisecond resolution) -- an acceptable
// residual limitation, not the append-order bug this closes.
function latestMatchingRecord(records, scriptFilter) {
  const matching = records.filter((record) => (
    record && typeof record.script === 'string' && record.script.includes(scriptFilter)
  ));
  if (!matching.length) {
    return null;
  }
  const recordTimeMs = (record) => {
    const parsed = Date.parse(record?.ts);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  const mostRecentRunId = matching.reduce((best, record) => (
    best === null || recordTimeMs(record) > recordTimeMs(best) ? record : best
  ), null).runId;
  const sameRun = matching.filter((record) => record.runId === mostRecentRunId);
  return sameRun.reduce((best, record) => (
    best === null || (Number(record.seq) || 0) > (Number(best.seq) || 0) ? record : best
  ), null);
}

// Best-effort, local-machine-only liveness: reuses the SAME PID/host claim
// model `state/.lock/` already uses (see local-state.js's withStateLock and
// rp-execute-import/SKILL.md). A run driven from a different host cannot be corroborated this
// way -- staleness alone still produces a correct verdict for it.
//
// This only ever covers a process that calls `withStateLock` -- an import writer. A read-only
// script (a generated `run-extract.js`, or any future non-writing script) never acquires this
// lock even while genuinely alive, so this check alone cannot corroborate it. See
// `hasLiveRecordedPid` below for the script-agnostic complement.
// this used to treat ANY live PID claim under state/.lock/ for
// this host as proof the QUERIED script (`scriptFilter`) was alive, regardless of which
// script/writer actually holds that claim. A genuinely crashed run-import.js could be falsely
// reported healthy merely because an unrelated concurrent writer (e.g. run-extract.js) holds its
// own live claim in the same project. `local-state.js`'s `withStateLock` now writes a `script`
// field into the claim's own JSON content (defaulting to `process.argv[1]` of whichever process
// acquired it) -- require that identity to match `scriptFilter` before trusting the claim at all,
// mirroring how `hasLiveRecordedPid` below is already scoped to a specific progress record's own
// `script` field rather than any record's pid.
function hasLiveLocalProcess(projectDir, scriptFilter) {
  const lockDir = path.join(projectDir, 'state', '.lock');
  let entries;
  try {
    entries = fs.readdirSync(lockDir);
  } catch (error) {
    return false;
  }
  const host = Buffer.from(os.hostname()).toString('base64url');
  for (const entry of entries) {
    const match = /^([^.]+)\.(\d+)\.[a-f0-9-]+\.owner$/.exec(entry);
    if (!match || match[1] !== host) {
      continue;
    }
    let claim = null;
    try {
      claim = JSON.parse(fs.readFileSync(path.join(lockDir, entry), 'utf8'));
    } catch (error) {
      // Unreadable/malformed/removed-mid-read claim: its identity cannot be corroborated, so it
      // cannot count as evidence for ANY specific script. Keep checking other claims present.
    }
    // A claim written before this field existed, or with no recognizable script identity, cannot
    // be trusted as evidence for this specific scriptFilter either -- the whole point of this
    // fix is that an uncorroborated claim must not pass as "this script is alive".
    if (!claim || typeof claim.script !== 'string' || !claim.script.includes(scriptFilter)) {
      continue;
    }
    if (isProcessAlive(Number(match[2]))) {
      return true;
    }
    // ESRCH: that claim's process is dead; keep checking any other claim present.
  }
  return false;
}

// Script-agnostic complement to `hasLiveLocalProcess`: every progress-log record now carries its
// own writer's `host`/`pid` (see lib/progress-log.js), so a read-only script that never touches
// `state/.lock/` -- an extraction pass, or anything else that only reads -- can still be
// corroborated as live directly from its own most recent heartbeat, the same way an import
// writer is corroborated via its lock claim. Only trusts a pid on THIS host, same as the lock
// check.
function hasLiveRecordedPid(record) {
  if (!record || typeof record.pid !== 'number' || typeof record.host !== 'string') {
    return false;
  }
  if (record.host !== Buffer.from(os.hostname()).toString('base64url')) {
    return false;
  }
  return isProcessAlive(record.pid);
}

// Either signal corroborates liveness: an import writer's lock claim (now scoped to the same
// scriptFilter this whole check is asked about), or (for any script, writer or read-only) its own
// most recent heartbeat's recorded pid still being alive on this host.
function hasLiveSignal(projectDir, latestRecord, scriptFilter) {
  return hasLiveLocalProcess(projectDir, scriptFilter) || hasLiveRecordedPid(latestRecord);
}

function checkHealth({ projectDir, scriptFilter, staleAfterMs }) {
  const completionReportPath = path.join(projectDir, 'execution', 'completion-report.json');
  const progressLogPath = path.join(projectDir, 'execution', 'progress.ndjson');
  const { records, anyLineSeen } = readProgressRecords(progressLogPath);
  const latest = latestMatchingRecord(records, scriptFilter);
  const lastEventAt = latest ? latest.ts : null;
  const runId = latest ? latest.runId : null;
  // A missing/unparsable `ts` used to throw here, crashing the
  // whole check (exit 1) instead of producing a verdict -- the same failure mode the
  // malformed-NDJSON-line fix closed for a syntactically-broken line, just left open for a
  // schema-level defect (no `ts`, or one `Date.parse` can't read) in an otherwise-valid record,
  // e.g. from a hand-rolled heartbeat that never went through lib/progress-log.js's `append()`.
  // Treat it as "this record can't corroborate freshness" rather than fatal: `ageMs` stays null,
  // which the staleness check below (`ageMs <= staleAfterMs`) cannot satisfy, so evaluation falls
  // through to the live-signal checks instead of ever treating an unknown age as fresh.
  let ageMs = null;
  if (latest) {
    const parsedAgeMs = Date.now() - Date.parse(latest.ts);
    if (!Number.isNaN(parsedAgeMs)) {
      ageMs = parsedAgeMs;
    } else {
      process.stderr.write(`warning: ${progressLogPath}: most recent matching record has an unparsable ts, treating its age as unknown: ${JSON.stringify(latest.ts)}\n`);
    }
  }

  // A completion artifact settles the verdict regardless of progress-log staleness -- the run
  // finished, so a stale-looking last heartbeat before completion is not evidence of a stall.
  // But a completion report is only evidence for the run it was written for: a resumed project
  // carries its PREVIOUS run's completion-report.json into the new run's entire duration (it is
  // only overwritten at the new run's own end), so existence alone would falsely call an actively
  // resuming run "complete" from its very first tick. Only trust it when its own recorded `runId`
  // matches the most recent run this progress log has seen -- if a newer `runId` is already
  // writing progress lines, the report is stale evidence of a PRIOR run, not this one.
  let completionReport = null;
  if (fs.existsSync(completionReportPath)) {
    try {
      completionReport = JSON.parse(fs.readFileSync(completionReportPath, 'utf8'));
    } catch (error) {
      throw new Error(`${completionReportPath}: invalid JSON: ${error.message}`);
    }
  }
  // `runId` (from `latest`) is null in two different situations that must NOT be conflated:
  // the progress log has no records at all (a legacy script never instrumented with
  // heartbeats -- the completion report is the only signal there is and must be trusted), or
  // the progress log has records, just none matching THIS `--script` filter (a filter/script-id
  // mismatch, or a different script actively writing under a name this call isn't watching).
  // Only the first case may fall back to trusting an unmatched completion report; the second
  // must not, or a caller who mis-names `--script` gets a false "complete" from some unrelated
  // run's leftover report instead of a "stalled"/"no signal" verdict it would actually notice.
  //
  // Even the first case must not trust the report BLINDLY: a resumed/fresh run can be genuinely
  // alive and simply hasn't flushed its first heartbeat yet, while a stale completion-report.json
  // from a wholly earlier run still sits on disk. Corroborate with the same liveness signal used
  // everywhere else in this file -- if something claims to be running right now, that wins over
  // an old report, exactly like the "past the staleness window but a live claim exists" branch
  // below already does for the non-empty-log case.
  //
  // Note: a redispatched run that crashes
  // before writing its first heartbeat or acquiring its lock claim is, from this file's evidence
  // alone, INDISTINGUISHABLE from "a legacy script that never emits heartbeats at all" -- both
  // produce zero progress records and no live signal. A runId-based heuristic was tried here and
  // reverted: `tests/execution-health/execution-health-check-test.js`'s own "a legacy
  // uninstrumented script's completion report is still trusted" case deliberately gives its
  // completion report a real, non-null `runId` (`'legacy-run'`), so "does the report have a real
  // runId" cannot separate the two cases -- it isn't a signal this file has. Closing this race
  // for real needs a NEW artifact recording that a dispatch attempt started (written by the
  // dispatcher before it launches the script, not by the script itself, since the crash this
  // finding describes happens before the script can write anything) -- out of scope for a
  // same-file fix; flagged as a known, accepted limitation rather than silently left unaddressed.
  const noProgressRecordsAtAll = !anyLineSeen;
  const legacyReportTrustworthy = noProgressRecordsAtAll && !hasLiveSignal(projectDir, null, scriptFilter);
  if (completionReport && (legacyReportTrustworthy || (runId && completionReport.runId === runId))) {
    return {
      ok: true,
      status: 'complete',
      lastEventAt,
      ageMs,
      runId,
      detail: `${completionReportPath} exists and matches the most recent run (${completionReport.runId})`,
    };
  }

  if (!latest) {
    // No matching heartbeat AND no (trustworthy) completion report. A live local process claim
    // still corroborates "genuinely running, just hasn't flushed its first heartbeat yet" over
    // "stalled" -- the same "a live claim beats an old/absent signal" rule the staleness branch
    // below applies. `hasLiveRecordedPid` needs a record to check a pid against, so only the
    // lock-claim signal is available here.
    if (hasLiveLocalProcess(projectDir, scriptFilter)) {
      return {
        ok: true,
        status: 'healthy',
        lastEventAt: null,
        ageMs: null,
        runId: null,
        detail: `no progress record for script matching "${scriptFilter}" in ${progressLogPath} yet, but a live local process claim was found`,
      };
    }
    return {
      ok: true,
      status: 'stalled',
      lastEventAt: null,
      ageMs: null,
      runId: null,
      detail: `no progress record for script matching "${scriptFilter}" in ${progressLogPath}, and no completion report`,
    };
  }

  if (ageMs !== null && ageMs <= staleAfterMs) {
    return {
      ok: true,
      status: 'healthy',
      lastEventAt,
      ageMs,
      runId,
      detail: `last matching event ${ageMs}ms ago, within the ${staleAfterMs}ms staleness window`,
    };
  }

  if (!hasLiveSignal(projectDir, latest, scriptFilter)) {
    return {
      ok: true,
      status: 'stalled',
      lastEventAt,
      ageMs,
      runId,
      detail: `last matching event ${ageMs}ms ago, past the ${staleAfterMs}ms staleness window, and no live local process claim or recorded pid was found`,
    };
  }

  // Older than the staleness window but a live local process claim OR the record's own recorded
  // pid still claims this run: the process being alive is the stronger signal when the two
  // disagree. A slow batch without a fresh heartbeat is not itself a failure.
  return {
    ok: true,
    status: 'healthy',
    lastEventAt,
    ageMs,
    runId,
    detail: `last matching event ${ageMs}ms ago, past the ${staleAfterMs}ms staleness window, but a live local process claim or recorded pid was found`,
  };
}

function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/execution-health-check.js',
    ...parsed.progress,
  });
  progress.start('Execution health check started', { phase: 'execution', step: 'health-check' });

  const args = parseArgs(parsed.args);
  if (!args.projectDir) {
    usage();
    throw new Error('Missing project directory');
  }

  const projectDir = path.resolve(args.projectDir);
  const staleAfterMs = parseDurationMs(args.staleAfter);
  const result = checkHealth({ projectDir, scriptFilter: args.script, staleAfterMs });

  console.log(JSON.stringify(result, null, 2));
  progress.complete('Execution health check completed', {
    phase: 'execution',
    step: 'health-check',
    artifact: projectDir,
    status: result.status,
  });
}

try {
  main();
  process.exit(0);
} catch (error) {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Execution health check failed', {
      phase: 'execution',
      step: 'health-check',
    });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}
