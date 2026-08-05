'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEMA_VERSION = 1;

const CROSSWALK_STATUS = new Set(['imported']);
const ATTEMPT_STATUS = new Set([
  'started',
  'succeeded_unverified',
  'imported',
  'failed_retryable',
  'failed_terminal',
  'deferred',
  'needs_verification',
  'skipped_already_imported',
  'skipped_safe_mode_blocked',
]);

function stateDir(projectDir) {
  return path.join(projectDir, 'state');
}

function crosswalkDir(projectDir) {
  return path.join(stateDir(projectDir), 'crosswalk');
}

function crosswalkPath(projectDir) {
  return path.join(crosswalkDir(projectDir), 'crosswalk.ndjson');
}

function crosswalkIndexDir(projectDir) {
  return path.join(crosswalkDir(projectDir), 'indexes');
}

function attemptsDir(projectDir) {
  return path.join(stateDir(projectDir), 'attempts');
}

function attemptJournalPath(projectDir) {
  return path.join(attemptsDir(projectDir), 'write-attempts.ndjson');
}

function wixRequestCapturesPath(projectDir) {
  return path.join(attemptsDir(projectDir), 'wix-request-captures.ndjson');
}

function cmsMirrorDir(projectDir) {
  return path.join(stateDir(projectDir), 'cms-mirror');
}

function safeModeDir(projectDir) {
  return path.join(stateDir(projectDir), 'safe-mode');
}

function safeModeEmailReplacementsPath(projectDir) {
  return path.join(safeModeDir(projectDir), 'email-replacements.ndjson');
}

function safeModeBlockedRecordsPath(projectDir) {
  return path.join(safeModeDir(projectDir), 'blocked-records.ndjson');
}

function dryRunCrosswalkPath(projectDir) {
  return path.join(crosswalkDir(projectDir), 'dry-run-crosswalk.ndjson');
}

async function mkdirp(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, data) {
  await mkdirp(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function writeTextAtomic(filePath, text) {
  await mkdirp(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, text, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function appendNdjson(filePath, row) {
  await mkdirp(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

async function readNdjson(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const rows = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${filePath}:${index + 1} invalid NDJSON: ${error.message}`);
    }
  }
  return rows;
}

function assertObject(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(row, field, label, errors) {
  if (!row[field] || typeof row[field] !== 'string') {
    errors.push(`${label}.${field} must be a non-empty string`);
  }
}

function validateCrosswalkRow(row, { allowThrow = true, label = 'crosswalk row' } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of [
    'sourceSystem',
    'sourceEntityType',
    'sourceId',
    'sourceStableKey',
    'targetSystem',
    'targetEntityType',
    'targetId',
    'status',
  ]) {
    requireString(row, field, label, errors);
  }
  if (row.status && !CROSSWALK_STATUS.has(row.status)) {
    errors.push(`${label}.status must be one of: ${Array.from(CROSSWALK_STATUS).join(', ')}`);
  }
  if (row.updatedAt !== undefined && Number.isNaN(Date.parse(row.updatedAt))) {
    errors.push(`${label}.updatedAt must be an ISO timestamp when present`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function validateAttemptRow(row, { allowThrow = true, label = 'attempt row' } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of ['attemptId', 'sourceStableKey', 'writeSpecId', 'operation', 'targetEntityType', 'status']) {
    requireString(row, field, label, errors);
  }
  if (row.status && !ATTEMPT_STATUS.has(row.status)) {
    errors.push(`${label}.status must be one of: ${Array.from(ATTEMPT_STATUS).join(', ')}`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function validateSafeModeEmailReplacementRow(row, { allowThrow = true, label = 'safe-mode email replacement row' } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of [
    'runId',
    'sourceSystem',
    'sourceEntityType',
    'sourceId',
    'sourceStableKey',
    'targetSystem',
    'targetEntityType',
    'targetId',
    'sourceEmail',
    'targetEmail',
    'createdAt',
  ]) {
    requireString(row, field, label, errors);
  }
  if (row.createdAt !== undefined && Number.isNaN(Date.parse(row.createdAt))) {
    errors.push(`${label}.createdAt must be an ISO timestamp`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function validateSafeModeBlockedRecordRow(row, { allowThrow = true, label = 'safe-mode blocked record row' } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of [
    'runId',
    'sourceSystem',
    'sourceEntityType',
    'sourceId',
    'sourceStableKey',
    'targetSystem',
    'targetEntityType',
    'reason',
    'createdAt',
  ]) {
    requireString(row, field, label, errors);
  }
  if (!Array.isArray(row.paths) || row.paths.some((item) => typeof item !== 'string' || !item)) {
    errors.push(`${label}.paths must be an array of non-empty strings`);
  }
  if (row.reason && row.reason !== 'SAFE_MODE_SUSPICIOUS_EMAIL') {
    errors.push(`${label}.reason must be SAFE_MODE_SUSPICIOUS_EMAIL`);
  }
  if (row.createdAt !== undefined && Number.isNaN(Date.parse(row.createdAt))) {
    errors.push(`${label}.createdAt must be an ISO timestamp`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function validateWixRequestCaptureRow(row, { allowThrow = true, label = 'Wix request capture row' } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of ['requestCaptureId', 'timestamp', 'runId', 'phase', 'method', 'endpoint', 'result']) {
    requireString(row, field, label, errors);
  }
  if (row.phase && !['setup', 'import'].includes(row.phase)) {
    errors.push(`${label}.phase must be setup or import`);
  }
  if (row.result && row.result !== 'dry_run_skipped_wix_call') {
    errors.push(`${label}.result must be dry_run_skipped_wix_call`);
  }
  if (row.headers !== undefined && (!row.headers || typeof row.headers !== 'object' || Array.isArray(row.headers))) {
    errors.push(`${label}.headers must be an object when present`);
  }
  if (row.headers && Object.prototype.hasOwnProperty.call(row.headers, 'Authorization')) {
    errors.push(`${label}.headers must not include Authorization`);
  }
  if (Number.isNaN(Date.parse(row.timestamp))) {
    errors.push(`${label}.timestamp must be an ISO timestamp`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function validateDryRunCrosswalkRow(row, { allowThrow = true, label = 'dry-run crosswalk row' } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of [
    'runId',
    'sourceSystem',
    'sourceEntityType',
    'sourceId',
    'sourceStableKey',
    'targetSystem',
    'targetEntityType',
    'placeholderTargetId',
    'operation',
    'createdAt',
  ]) {
    requireString(row, field, label, errors);
  }
  if (row.dryRun !== true) {
    errors.push(`${label}.dryRun must be true`);
  }
  if (row.placeholder !== true) {
    errors.push(`${label}.placeholder must be true`);
  }
  if (row.createdAt !== undefined && Number.isNaN(Date.parse(row.createdAt))) {
    errors.push(`${label}.createdAt must be an ISO timestamp`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function indexCrosswalkRows(rows) {
  const bySource = {};
  const byTarget = {};
  for (const row of rows) {
    bySource[row.sourceStableKey] = row;
    byTarget[row.targetId] = row;
  }
  return { bySource, byTarget };
}

async function loadCrosswalk(projectDir) {
  const rows = await readNdjson(crosswalkPath(projectDir));
  for (const row of rows) {
    validateCrosswalkRow(row);
  }
  const { bySource, byTarget } = indexCrosswalkRows(rows);
  return { rows, bySource, byTarget };
}

async function appendCrosswalkRow(projectDir, row) {
  validateCrosswalkRow(row);
  await appendNdjson(crosswalkPath(projectDir), row);
  return row;
}

async function upsertCrosswalkRow(projectDir, row) {
  validateCrosswalkRow(row);
  const current = await loadCrosswalk(projectDir);
  current.bySource[row.sourceStableKey] = row;
  const rows = Object.values(current.bySource).sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey));
  const text = rows.map((item) => JSON.stringify(item)).join('\n');
  await writeTextAtomic(crosswalkPath(projectDir), text ? `${text}\n` : '');
  await rebuildCrosswalkIndexes(projectDir);
  return row;
}

function foldAttempts(rows) {
  const byAttemptId = {};
  for (const row of rows) {
    byAttemptId[row.attemptId] = {
      ...(byAttemptId[row.attemptId] || {}),
      ...row,
    };
  }
  return byAttemptId;
}

async function loadAttemptJournal(projectDir) {
  const rows = await readNdjson(attemptJournalPath(projectDir));
  for (const row of rows) {
    validateAttemptRow(row);
  }
  return { rows, byAttemptId: foldAttempts(rows) };
}

async function appendAttempt(projectDir, row) {
  validateAttemptRow(row);
  await appendNdjson(attemptJournalPath(projectDir), row);
  return row;
}

async function appendSafeModeEmailReplacement(projectDir, row) {
  validateSafeModeEmailReplacementRow(row);
  await appendNdjson(safeModeEmailReplacementsPath(projectDir), row);
  return row;
}

async function appendSafeModeBlockedRecord(projectDir, row) {
  validateSafeModeBlockedRecordRow(row);
  await appendNdjson(safeModeBlockedRecordsPath(projectDir), row);
  return row;
}

async function appendWixRequestCapture(projectDir, row) {
  validateWixRequestCaptureRow(row);
  await appendNdjson(wixRequestCapturesPath(projectDir), row);
  return row;
}

async function loadWixRequestCaptures(projectDir) {
  const rows = await readNdjson(wixRequestCapturesPath(projectDir));
  for (const row of rows) {
    validateWixRequestCaptureRow(row);
  }
  return rows;
}

async function appendDryRunCrosswalkRow(projectDir, row) {
  validateDryRunCrosswalkRow(row);
  await appendNdjson(dryRunCrosswalkPath(projectDir), row);
  return row;
}

async function loadDryRunCrosswalk(projectDir) {
  const rows = await readNdjson(dryRunCrosswalkPath(projectDir));
  for (const row of rows) {
    validateDryRunCrosswalkRow(row);
  }
  return rows;
}

function dryRunUpsertDecision({ localCrosswalkRow = null, requiresRevision = false, hasLocalRevision = false, supportsRevisionFreeRequestBuild = false } = {}) {
  if (localCrosswalkRow) {
    return {
      dryRun: true,
      decision: 'based_on_local_crosswalk',
      targetId: localCrosswalkRow.targetId,
      stateKnown: true,
    };
  }
  if (requiresRevision && !hasLocalRevision) {
    return {
      dryRun: true,
      decision: 'would_require_live_lookup',
      stateKnown: false,
      canBuildRequest: Boolean(supportsRevisionFreeRequestBuild),
    };
  }
  return {
    dryRun: true,
    decision: 'would_create_if_not_found',
    stateKnown: false,
    canBuildRequest: true,
  };
}

async function markAttempt(projectDir, attemptId, patch) {
  if (!attemptId || typeof attemptId !== 'string') {
    throw new Error('attemptId must be a non-empty string');
  }
  assertObject(patch, 'attempt patch');
  const journal = await loadAttemptJournal(projectDir);
  const current = journal.byAttemptId[attemptId];
  if (!current) {
    throw new Error(`unknown attemptId: ${attemptId}`);
  }
  const row = {
    ...current,
    ...patch,
    attemptId,
  };
  validateAttemptRow(row);
  await appendNdjson(attemptJournalPath(projectDir), row);
  return row;
}

async function rebuildCrosswalkIndexes(projectDir) {
  const { bySource, byTarget } = await loadCrosswalk(projectDir);
  await writeJsonAtomic(path.join(crosswalkIndexDir(projectDir), 'by-source.json'), bySource);
  await writeJsonAtomic(path.join(crosswalkIndexDir(projectDir), 'by-target.json'), byTarget);
  return { bySource, byTarget };
}

async function localCrosswalkStateExists(projectDir) {
  if (!(await pathExists(crosswalkPath(projectDir)))) {
    return false;
  }
  await loadCrosswalk(projectDir);
  return true;
}

function newestRow(a, b) {
  const aTime = Date.parse(a.updatedAt);
  const bTime = Date.parse(b.updatedAt);
  if (Number.isNaN(aTime) || Number.isNaN(bTime) || aTime === bTime) {
    return null;
  }
  return bTime > aTime ? b : a;
}

async function seedCrosswalkFromCmsMirror(projectDir, rows) {
  if (!Array.isArray(rows)) {
    throw new Error('CMS mirror rows must be an array');
  }
  if (await localCrosswalkStateExists(projectDir)) {
    return { seeded: false, reason: 'local_crosswalk_exists', accepted: 0, rejected: 0, conflicts: 0 };
  }

  const rejected = [];
  const conflicts = [];
  const bySource = {};

  for (const row of rows) {
    const validation = validateCrosswalkRow(row, { allowThrow: false, label: 'CMS mirror row' });
    if (!validation.ok) {
      rejected.push({ row, errors: validation.errors });
      continue;
    }

    const current = bySource[row.sourceStableKey];
    if (!current) {
      bySource[row.sourceStableKey] = row;
      continue;
    }

    const winner = newestRow(current, row);
    if (!winner) {
      if (current.targetId !== row.targetId) {
        conflicts.push(current, row);
      }
      continue;
    }
    bySource[row.sourceStableKey] = winner;
  }

  await mkdirp(cmsMirrorDir(projectDir));
  await writeTextAtomic(
    path.join(cmsMirrorDir(projectDir), 'imported-from-cms.ndjson'),
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
  );
  if (rejected.length) {
    await writeTextAtomic(
      path.join(cmsMirrorDir(projectDir), 'rejected.ndjson'),
      rejected.map((item) => JSON.stringify(item)).join('\n') + '\n',
    );
  }
  if (conflicts.length) {
    await writeTextAtomic(
      path.join(cmsMirrorDir(projectDir), 'conflicts.ndjson'),
      conflicts.map((row) => JSON.stringify(row)).join('\n') + '\n',
    );
    throw new Error(`CMS mirror seed has ${conflicts.length} conflicting rows; see state/cms-mirror/conflicts.ndjson`);
  }

  const acceptedRows = Object.values(bySource).sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey));
  const text = acceptedRows.map((row) => JSON.stringify(row)).join('\n');
  await writeTextAtomic(crosswalkPath(projectDir), text ? `${text}\n` : '');
  await rebuildCrosswalkIndexes(projectDir);
  return { seeded: true, accepted: acceptedRows.length, rejected: rejected.length, conflicts: 0 };
}

async function withStateLock(projectDir, fn) {
  const lockPath = path.join(stateDir(projectDir), '.lock');
  await mkdirp(stateDir(projectDir));
  try {
    await fs.mkdir(lockPath);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(`state lock already held: ${lockPath}`);
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

module.exports = {
  SCHEMA_VERSION,
  stateDir,
  crosswalkPath,
  attemptJournalPath,
  wixRequestCapturesPath,
  cmsMirrorDir,
  safeModeDir,
  safeModeEmailReplacementsPath,
  safeModeBlockedRecordsPath,
  dryRunCrosswalkPath,
  loadCrosswalk,
  appendCrosswalkRow,
  upsertCrosswalkRow,
  loadAttemptJournal,
  appendAttempt,
  appendSafeModeEmailReplacement,
  appendSafeModeBlockedRecord,
  appendWixRequestCapture,
  loadWixRequestCaptures,
  appendDryRunCrosswalkRow,
  loadDryRunCrosswalk,
  dryRunUpsertDecision,
  validateSafeModeEmailReplacementRow,
  validateSafeModeBlockedRecordRow,
  validateWixRequestCaptureRow,
  validateDryRunCrosswalkRow,
  markAttempt,
  rebuildCrosswalkIndexes,
  localCrosswalkStateExists,
  seedCrosswalkFromCmsMirror,
  withStateLock,
};
