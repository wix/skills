'use strict';

// The writer for `execution-log.md`. Three rules hold this file together, and every one of them is load-bearing:
//
//  1. APPEND-ONLY. A resumed or recovery pass adds entries; it never truncates or regenerates
//     the file. A chronology that a later pass can rewrite is not a chronology.
//  2. PER-ENTRY runId. Every entry carries the run that wrote it, so a second pass's entries are
//     distinguishable from the first pass's without inferring anything from timestamps.
//  3. NON-AUTHORITATIVE. `execution/completion-report.json` is the final outcome and
//     `execution/review/completion-summary.md` is rendered from that report. Nothing here is a
//     count anyone may read back. This module therefore exposes no aggregation helper at all --
//     the cheapest way to keep a derived count out of shipped code is to ship no way to derive
//     one.
//
// This is NOT a heartbeat. `lib/progress-log.js` writes liveness to a caller-supplied path, which
// in practice may be a temp file outside the project; that contract is unchanged.
// `appendExecutionLog` always writes inside the project directory.

const fs = require('node:fs/promises');
const path = require('node:path');

const EXECUTION_LOG_FILE = 'execution-log.md';

const HEADER = [
  '# Execution Log',
  '',
  'Chronology of this migration run: what ran, in what order, and where the run stopped or',
  'resumed. Append-only -- later passes add lines, never rewrite them.',
  '',
  '**Not authoritative for counts.** The final outcome is',
  '`execution/completion-report.json`; the human-readable account is',
  '`execution/review/completion-summary.md`, rendered from that report. Never read a final',
  'number out of this file.',
  '',
].join('\n');

const ENTRY_FIELDS = new Set(['at', 'runId', 'phase', 'event', 'detail', 'artifacts']);

// A handoff, a summary and this log all get attached to pull requests and pasted into chat. The
// same confidentiality rule applies to all three: counts, ids, reason codes and artifact paths --
// never record values. An email address is the one record value that reliably survives a careless
// template (`imported customer ${record.email}`), so it is rejected outright rather than trusted
// to reviewer discipline.
const EMAIL_SHAPED = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function requireString(value, field) {
  if (!value || typeof value !== 'string') {
    throw new Error(`execution log entry ${field} must be a non-empty string`);
  }
  return value;
}

function assertNoRecordValues(value, field) {
  if (EMAIL_SHAPED.test(value)) {
    throw new Error(
      `execution log entry ${field} looks like it carries a record value (email address); `
      + 'the execution log records counts, ids, reason codes and artifact paths only',
    );
  }
  return value;
}

function executionLogPath(projectDir) {
  return path.join(projectDir, EXECUTION_LOG_FILE);
}

function normalizeExecutionLogEntry(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('execution log entry must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!ENTRY_FIELDS.has(key)) {
      throw new Error(`unknown execution log entry field: ${key}`);
    }
  }
  const runId = requireString(input.runId, 'runId');
  const phase = requireString(input.phase, 'phase');
  const event = requireString(input.event, 'event');
  const detail = assertNoRecordValues(requireString(input.detail, 'detail'), 'detail');
  const at = input.at === undefined || input.at === null ? new Date().toISOString() : requireString(input.at, 'at');
  const artifacts = input.artifacts === undefined || input.artifacts === null ? [] : input.artifacts;
  if (!Array.isArray(artifacts)) {
    throw new Error('execution log entry artifacts must be an array');
  }
  return {
    at,
    runId,
    phase,
    event,
    detail,
    artifacts: artifacts.map((artifact, index) => assertNoRecordValues(
      requireString(artifact, `artifacts[${index}]`),
      `artifacts[${index}]`,
    )),
  };
}

function renderExecutionLogEntry(entry) {
  const artifacts = entry.artifacts.length ? ` | artifacts: ${entry.artifacts.join(', ')}` : '';
  return `- ${entry.at} | run ${entry.runId} | ${entry.phase} | ${entry.event} | ${entry.detail}${artifacts}`;
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

// `fs.appendFile` rather than read-modify-write: there is no code path here that can truncate the
// file, not even a crash between the read and the write.
async function appendExecutionLog(projectDir, entry) {
  const normalized = normalizeExecutionLogEntry(entry);
  const filePath = executionLogPath(projectDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existed = await pathExists(filePath);
  const line = renderExecutionLogEntry(normalized);
  await fs.appendFile(filePath, existed ? `${line}\n` : `${HEADER}${line}\n`, 'utf8');
  return { path: EXECUTION_LOG_FILE, entry: normalized, line, createdFile: !existed };
}

async function executionLogExists(projectDir) {
  return pathExists(executionLogPath(projectDir));
}

// Reads entries back for orchestration and tests -- for "did this event happen, and in what
// order", never for a count. Deliberately returns rows, not totals.
async function readExecutionLogEntries(projectDir) {
  const filePath = executionLogPath(projectDir);
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, entries: [] };
    throw error;
  }
  const entries = [];
  for (const rawLine of text.split('\n')) {
    if (!rawLine.startsWith('- ')) continue;
    const parts = rawLine.slice(2).split(' | ');
    if (parts.length < 5) continue;
    const [at, runField, phase, event, ...rest] = parts;
    if (!runField.startsWith('run ')) continue;
    const artifactsPart = rest.length > 1 && rest[rest.length - 1].startsWith('artifacts: ')
      ? rest.pop().slice('artifacts: '.length)
      : null;
    entries.push({
      at,
      runId: runField.slice('run '.length),
      phase,
      event,
      detail: rest.join(' | '),
      artifacts: artifactsPart ? artifactsPart.split(', ') : [],
    });
  }
  return { exists: true, entries };
}

module.exports = {
  EXECUTION_LOG_FILE,
  executionLogPath,
  normalizeExecutionLogEntry,
  renderExecutionLogEntry,
  appendExecutionLog,
  executionLogExists,
  readExecutionLogEntries,
};
