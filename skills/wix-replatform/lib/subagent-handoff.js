'use strict';

// The short, deterministic context a FRESH subagent starts from.
//
// Measured on a measured full run: the orchestrator resumed the same Developer subagent across
// fix-and-retry rounds, and its context reached 919K tokens, re-sent on each of 402 model calls
// (239.5M tokens for one subagent). A fresh subagent that starts from this file instead of an old
// transcript pays for a few KB, not the whole history. The file is built only from durable project
// state, so it is the same no matter which agent writes it, and it is capped in size.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { summarizeWriteLog } = require('./write-log-summary.js');
const { listUserActions } = require('./user-actions.js');

const SCHEMA_VERSION = 1;
const HANDOFF_DIR = ['state', 'handoffs'];
const DEFAULT_CAP_BYTES = 8 * 1024;
const OUTCOMES = new Set(['done', 'failed', 'budget_exceeded', 'needs_decision', 'resume_limit', 'qa_findings']);
const CROSSWALK_FILE = 'state/crosswalk/crosswalk.ndjson';

function handoffDir(projectDir) { return path.join(projectDir, ...HANDOFF_DIR); }

function safeStage(stage) {
  const value = String(stage || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(value)) throw new Error(`invalid --stage ${JSON.stringify(stage)} (letters, digits, _ . - only)`);
  return value;
}

function listHandoffs(projectDir, stage) {
  const dir = handoffDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const prefix = `${stage}-`;
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .map((name) => ({ name, round: Number(name.slice(prefix.length, -5)) }))
    .filter((entry) => Number.isInteger(entry.round))
    .sort((a, b) => a.round - b.round);
}

function readHandoff(projectDir, stage, round) {
  const file = path.join(handoffDir(projectDir), `${stage}-${round}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// A checkpoint is settled import progress: per entity, how many attempts are now `imported`, plus
// how many crosswalk rows exist, plus the completion-report status. Bytes are not progress: an
// importer appends a `started` row before every write, so a crash on the same record would always
// look like movement.
const PROGRESS_STATUSES = new Set(['imported']);

async function countLines(file) {
  if (!fs.existsSync(file)) return 0;
  let count = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) count += 1;
  return count;
}

async function checkpointOf(projectDir) {
  const ledger = await summarizeWriteLog(projectDir, { log: 'attempts' });
  const settled = {};
  for (const [entity, statuses] of Object.entries(ledger.byEntity || {})) {
    const done = Object.entries(statuses).filter(([status]) => PROGRESS_STATUSES.has(status)).reduce((sum, [, n]) => sum + n, 0);
    if (done) settled[entity] = done;
  }
  const report = path.join(projectDir, 'execution', 'completion-report.json');
  let reportStatus = null;
  if (fs.existsSync(report)) {
    try { reportStatus = JSON.parse(fs.readFileSync(report, 'utf8')).status || null; } catch { reportStatus = 'unreadable'; }
  }
  return { settled, crosswalkRows: await countLines(path.join(projectDir, CROSSWALK_FILE)), completionReportStatus: reportStatus };
}

function sameCheckpoint(a, b) {
  return Boolean(a && b) && JSON.stringify(a.settled) === JSON.stringify(b.settled)
    && a.crosswalkRows === b.crosswalkRows && a.completionReportStatus === b.completionReportStatus;
}

function readFindings(findingsFile) {
  if (!findingsFile) return [];
  const raw = fs.readFileSync(findingsFile, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.findings) ? parsed.findings : [parsed]);
    return list.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
  } catch {
    return raw.split(/\r?\n/).map((line) => line.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
  }
}

function sizeOf(value) { return Buffer.byteLength(JSON.stringify(value, null, 2)); }

// Shrink in a fixed order until the file fits: samples first, QA findings last (they are the
// reason the round exists). Every cut is recorded so the next agent knows to ask for more.
function fitToCap(handoff, capBytes) {
  const cuts = [];
  const steps = [
    () => { if (handoff.writeLog && handoff.writeLog.topErrors) { delete handoff.writeLog.topErrors; cuts.push('writeLog.topErrors'); return true; } return false; },
    () => { if (handoff.changedFiles.length > 20) { handoff.changedFilesOmitted = handoff.changedFiles.length - 20; handoff.changedFiles = handoff.changedFiles.slice(0, 20); cuts.push('changedFiles'); return true; } return false; },
    () => { if (handoff.pendingUserActions.length > 5) { handoff.pendingUserActionsOmitted = handoff.pendingUserActions.length - 5; handoff.pendingUserActions = handoff.pendingUserActions.slice(0, 5); cuts.push('pendingUserActions'); return true; } return false; },
    () => { if (handoff.writeLog && handoff.writeLog.byEntity) { handoff.writeLog = { totals: handoff.writeLog.totals, runs: handoff.writeLog.runs, attempts: handoff.writeLog.attempts }; cuts.push('writeLog.byEntity'); return true; } return false; },
    () => { if (handoff.notes && handoff.notes.length > 400) { handoff.notes = `${handoff.notes.slice(0, 400)}…`; cuts.push('notes'); return true; } return false; },
    () => {
      const long = handoff.qaFindings.some((f) => f.length > 400);
      if (!long) return false;
      handoff.qaFindings = handoff.qaFindings.map((f) => (f.length > 400 ? `${f.slice(0, 400)}…` : f));
      cuts.push('qaFindings.truncatedEach');
      return true;
    },
    () => { if (handoff.qaFindings.length > 10) { handoff.qaFindingsOmitted = handoff.qaFindings.length - 10; handoff.qaFindings = handoff.qaFindings.slice(0, 10); cuts.push('qaFindings.count'); return true; } return false; },
  ];
  for (const step of steps) {
    if (sizeOf(handoff) <= capBytes) break;
    step();
  }
  if (cuts.length) handoff.trimmed = { capBytes, cuts, fullSourcesNote: 'Cut items are still in their source files; read them with write-log-summary.js or the QA result file, never the raw ledger.' };
  return handoff;
}

async function writeHandoff(projectDir, options = {}) {
  const stage = safeStage(options.stage);
  const outcome = options.outcome || options.reason || 'done';
  if (!OUTCOMES.has(outcome)) throw new Error(`invalid outcome ${outcome} (expected ${[...OUTCOMES].join(', ')})`);
  const capBytes = Number(options.capBytes) > 0 ? Number(options.capBytes) : DEFAULT_CAP_BYTES;

  const previous = listHandoffs(projectDir, stage);
  const round = previous.length ? previous[previous.length - 1].round + 1 : 1;
  const checkpoint = await checkpointOf(projectDir);

  // Repeated budget rounds that moved no durable state are a thrash signal, never a stop.
  let budgetRoundsWithoutProgress = 0;
  if (outcome === 'budget_exceeded') {
    budgetRoundsWithoutProgress = 1;
    for (let i = previous.length - 1; i >= 0; i -= 1) {
      const earlier = readHandoff(projectDir, stage, previous[i].round);
      if (earlier.outcome !== 'budget_exceeded' || !sameCheckpoint(earlier.checkpoint, checkpoint)) break;
      budgetRoundsWithoutProgress += 1;
    }
  }

  const ledger = await summarizeWriteLog(projectDir, { log: 'attempts' });
  const writeLog = ledger.missing ? null : { attempts: ledger.attempts, runs: ledger.runs, totals: ledger.totals, byEntity: ledger.byEntity, topErrors: ledger.topErrors };

  let pendingUserActions = [];
  try {
    pendingUserActions = (await listUserActions(projectDir, { status: 'pending' })).map((row) => ({ requestId: row.requestId, kind: row.kind || row.type || null, title: row.title || null }));
  } catch { pendingUserActions = [{ requestId: null, title: 'user-action index unreadable; run rp-user-action-recovery' }]; }

  const handoff = {
    schemaVersion: SCHEMA_VERSION,
    ...(options.workerId || process.env.CODEX_THREAD_ID ? { workerId: String(options.workerId || process.env.CODEX_THREAD_ID) } : {}),
    stage,
    resource: options.resource || null,
    round,
    outcome,
    writtenAt: new Date().toISOString(),
    nextDispatch: 'fresh subagent; pass only resource, project dir and this file',
    checkpoint,
    budgetRoundsWithoutProgress,
    qaFindings: readFindings(options.findingsFile),
    changedFiles: (options.changedFiles || []).map(String),
    pendingUserActions,
    writeLog,
    notes: options.notes ? String(options.notes) : null,
  };
  fitToCap(handoff, capBytes);

  const dir = handoffDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stage}-${round}.json`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(handoff, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { file, handoff, bytes: fs.statSync(file).size };
}

module.exports = { writeHandoff, readHandoff, listHandoffs, checkpointOf, sameCheckpoint, DEFAULT_CAP_BYTES, OUTCOMES };
