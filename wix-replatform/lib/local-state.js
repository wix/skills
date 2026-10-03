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
  await fs.writeFile(tempPath, text, { encoding: 'utf8', mode: 0o600 });
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
  // Spec 0140 §2: the version pair recorded from a CONFIRMED write, so a rerun can tell a
  // changed source record from an unchanged one. All four stay OPTIONAL, because rows written
  // before this existed must still load -- but absence is never read as "unchanged" (see
  // rerunDecision, which reports `unknown` rather than skipping).
  if (row.sourceVersionField !== undefined
    && (typeof row.sourceVersionField !== 'string' || row.sourceVersionField === '')) {
    errors.push(`${label}.sourceVersionField must be a non-empty string when present`);
  }
  if (row.sourceVersion !== undefined
    && !(typeof row.sourceVersion === 'string' || typeof row.sourceVersion === 'number')) {
    errors.push(`${label}.sourceVersion must be a string or number when present`);
  }
  if (row.sourceVersion !== undefined && row.sourceVersionField === undefined) {
    errors.push(`${label}.sourceVersion requires sourceVersionField — a version with no named field cannot be compared`);
  }
  if (row.targetRevision !== undefined
    && (typeof row.targetRevision !== 'string' || row.targetRevision === '')) {
    errors.push(`${label}.targetRevision must be a non-empty opaque string when present`);
  }
  if (row.sourceHash !== undefined && (typeof row.sourceHash !== 'string' || row.sourceHash === '')) {
    errors.push(`${label}.sourceHash must be a non-empty string when present`);
  }
  if (row.sourceHashDefinition !== undefined
    && (typeof row.sourceHashDefinition !== 'string' || row.sourceHashDefinition === '')) {
    errors.push(`${label}.sourceHashDefinition must be a non-empty string when present`);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

// Spec 0140 §2 and A.2. Decides what a rerun does with one source record, given its crosswalk
// baseline. Pure: no I/O, no writes, so the same inputs always give the same verdict.
//
// The load-bearing rule is the LAST one: a linked record with no usable comparison evidence is
// `unknown`, never `skip` and never a blind `update`. "We lost the baseline" and "the source did
// not change" are different facts, and conflating them either silently drops a real change or
// silently overwrites a merchant's Wix edit.
const RERUN_ACTIONS = new Set(['create', 'skip', 'update', 'unknown']);

function comparableVersion(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  // Version IDs are opaque (A.2): compare as strings, never numerically or by recency.
  return String(value);
}

function rerunDecision({
  crosswalkRow = null,
  sourceVersion = undefined,
  sourceVersionField = null,
  sourceHash = undefined,
  sourceHashDefinition = null,
} = {}) {
  if (!crosswalkRow) {
    return {
      action: 'create',
      reason: 'no_crosswalk_link',
      targetId: null,
      targetRevision: null,
    };
  }
  const targetId = crosswalkRow.targetId || null;
  const targetRevision = crosswalkRow.targetRevision || null;
  const base = { targetId, targetRevision };

  const baselineVersion = comparableVersion(crosswalkRow.sourceVersion);
  const currentVersion = comparableVersion(sourceVersion);
  const baselineField = crosswalkRow.sourceVersionField || null;
  const baselineHash = comparableVersion(crosswalkRow.sourceHash);
  const currentHash = comparableVersion(sourceHash);

  // A.2: "Changing the comparison field/hash definition invalidates that baseline until
  // reconciled." A baseline captured from `date_modified_gmt` says nothing about a version now
  // read from a different field.
  if (baselineField && sourceVersionField && baselineField !== sourceVersionField) {
    return { ...base, action: 'unknown', reason: 'version_field_changed' };
  }
  // A.2 applies the same rule to the hash: "Changing the comparison field/hash definition
  // invalidates that baseline until reconciled." A hash computed over a different set of mapped
  // fields is not comparable with the stored one -- without this, a redefinition falls through
  // to `update` and quietly overwrites Wix on every rerun.
  if (crosswalkRow.sourceHashDefinition && sourceHashDefinition
    && crosswalkRow.sourceHashDefinition !== sourceHashDefinition) {
    return { ...base, action: 'unknown', reason: 'hash_definition_changed' };
  }

  const versionComparable = baselineVersion !== null && currentVersion !== null;
  const hashComparable = baselineHash !== null && currentHash !== null;

  // A hash difference catches a change the timestamp missed (coarse or unchanged mtime), so it
  // is checked even when the versions match.
  if (hashComparable && baselineHash !== currentHash) {
    if (!targetRevision) {
      return { ...base, action: 'unknown', reason: 'no_saved_revision_for_update' };
    }
    return { ...base, action: 'update', reason: 'source_hash_differs' };
  }
  if (versionComparable && baselineVersion !== currentVersion) {
    // A linked row with no saved revision cannot be updated safely: the write would carry no
    // revision and therefore no conflict protection, so a merchant edit would be overwritten
    // silently. Legacy rows written before the version pair existed land here too.
    if (!targetRevision) {
      return { ...base, action: 'unknown', reason: 'no_saved_revision_for_update' };
    }
    return { ...base, action: 'update', reason: 'source_version_differs' };
  }
  if (versionComparable || hashComparable) {
    // Equality WITH adequate evidence. Wix may have changed on its own; that is not a reason to
    // write, and not a reason to refresh the saved revision either.
    return { ...base, action: 'skip', reason: versionComparable ? 'source_version_equal' : 'source_hash_equal' };
  }
  return {
    ...base,
    action: 'unknown',
    reason: crosswalkRow.sourceVersion === undefined && crosswalkRow.sourceHash === undefined
      ? 'no_baseline_recorded'
      : 'source_version_unavailable',
  };
}

// Spec 0140 §2 and A.2: the pair advances ONLY on a confirmed write. A failed, conflicted,
// dry-run or skipped write leaves the previous baseline exactly where it was, so the record
// stays eligible for recovery instead of being recorded as applied.
const CONFIRMED_WRITE_OUTCOMES = new Set(['created', 'updated']);

function nextCrosswalkBaseline({
  existingRow = null,
  outcome = null,
  sourceVersion = undefined,
  sourceVersionField = null,
  sourceHash = undefined,
  sourceHashDefinition = null,
  targetRevision = undefined,
} = {}) {
  if (!CONFIRMED_WRITE_OUTCOMES.has(outcome)) {
    return { advanced: false, reason: `outcome_not_confirmed:${outcome === null ? 'none' : outcome}`, row: existingRow };
  }
  // Consistent with validateCrosswalkRow, which hard-rejects the same shape: a version with no
  // named field cannot be compared later, so accepting it silently would write an unusable
  // baseline that reads as "compared and equal" on the next rerun.
  if (sourceVersion !== undefined && !sourceVersionField) {
    throw new Error('nextCrosswalkBaseline: sourceVersion requires sourceVersionField — an unnamed version cannot be compared on a later rerun');
  }
  const next = { ...(existingRow || {}) };
  if (sourceVersion !== undefined && sourceVersionField) {
    next.sourceVersion = sourceVersion;
    next.sourceVersionField = sourceVersionField;
  }
  if (sourceHash !== undefined) {
    next.sourceHash = sourceHash;
  }
  if (sourceHashDefinition) {
    next.sourceHashDefinition = sourceHashDefinition;
  }
  // A.2: "Preserve its exact value; do not increment it locally." An absent revision in the
  // response is not a reason to invent one, and not a reason to drop a known-good earlier one.
  const haveRevision = targetRevision !== undefined && targetRevision !== null && targetRevision !== '';
  if (haveRevision) {
    next.targetRevision = String(targetRevision);
  }
  // A.2 again: "If the response lacks a revision, reconcile a readback with the expected written
  // values before establishing a baseline." Advancing the SOURCE version while keeping the OLD
  // revision would pair a new source state with a revision that predates the write — the saved
  // pair would no longer describe the same write, and the next change would send a stale
  // revision and self-conflict. An update that returns no revision is therefore not a baseline;
  // it needs reconciliation.
  // This applies to a FIRST write too, not only to a re-write of an already-linked record. A
  // create whose response carried no revision leaves the pair half-formed: the source version
  // says "this state is applied" while there is no revision to protect the next update, so the
  // next change would be written with no concurrency guard at all. Half a pair is not a
  // baseline.
  if (!haveRevision) {
    return {
      advanced: false,
      reason: 'confirmed_write_without_returned_revision',
      needsReconciliation: true,
      row: existingRow,
    };
  }
  return { advanced: true, reason: outcome, row: next };
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
  if (row.blockedDataSnapshot !== undefined) {
    const snapshot = row.blockedDataSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      errors.push(`${label}.blockedDataSnapshot must be an object`);
    } else {
      for (const field of ['sourceEntityRef', 'extractedAt', 'checksum']) requireString(snapshot, field, `${label}.blockedDataSnapshot`, errors);
      if (!Number.isInteger(snapshot.snapshotVersion) || snapshot.snapshotVersion < 1) {
        errors.push(`${label}.blockedDataSnapshot.snapshotVersion must be a positive integer`);
      }
      if (snapshot.extractedAt !== undefined && Number.isNaN(Date.parse(snapshot.extractedAt))) {
        errors.push(`${label}.blockedDataSnapshot.extractedAt must be an ISO timestamp`);
      }
      if (snapshot.checksum !== undefined && !/^sha256:[a-f0-9]{64}$/.test(snapshot.checksum)) {
        errors.push(`${label}.blockedDataSnapshot.checksum must be a sha256 digest`);
      }
    }
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

async function updateCrosswalkRows(projectDir, updates, { remove = [] } = {}) {
  // Load protected receipts once per batch, not once per crosswalk row.
  const states = new Map();
  const verifier = require('./write-verification');
  for (const row of updates) {
    validateCrosswalkRow(row);
    if (!row.verification) continue;
    let receipt = row.verification;
    if (receipt.storage === 'write-verification') {
      const ref = receipt;
      if (!states.has(ref.siteId)) states.set(ref.siteId, await require('./write-verification-state').load(projectDir, ref.siteId));
      const candidate = states.get(ref.siteId).rows[row.sourceStableKey];
      if (candidate?.identityConflict) throw new Error('Revoked crosswalk verification');
      receipt = [candidate?.receipt, candidate?.lastVerifiedReceipt].find(r => r && ref.receiptDigest === verifier.digest(r));
      if (!receipt || ref.receiptDigest !== verifier.digest(receipt) || ref.sourceKey !== row.sourceStableKey || ref.targetId !== row.targetId || ref.siteId !== receipt?.siteId || ref.kind !== receipt?.kind) throw new Error('Invalid crosswalk verification reference');
    }
    if (!verifier.validReceipt(receipt, { sourceKey: row.sourceStableKey, targetId: row.targetId })) throw new Error('Invalid crosswalk verification');
  }
  const current = await loadCrosswalk(projectDir);
  for (const key of remove) delete current.bySource[key];
  for (const row of updates) current.bySource[row.sourceStableKey] = row;
  const rows = Object.values(current.bySource).sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey));
  await writeTextAtomic(crosswalkPath(projectDir), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  await rebuildCrosswalkIndexes(projectDir);
}
async function upsertCrosswalkRow(projectDir, row) {
  await updateCrosswalkRows(projectDir, [row]);
  return row;
}
async function removeCrosswalkRow(projectDir, sourceStableKey) {
  await updateCrosswalkRows(projectDir, [], { remove: [sourceStableKey] });
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
  await mkdirp(lockPath);
  const host = Buffer.from(require('node:os').hostname()).toString('base64url');
  // Unique claim files avoid deleting/replacing a directory another runner just acquired.
  // Publish the claim before scanning. Concurrent entrants see each other and at least
  // one backs off; a process that starts later always sees the active owner's claim.
  const claim = `${host}.${process.pid}.${require('node:crypto').randomUUID()}.owner`;
  const claimPath = path.join(lockPath, claim);
  await fs.writeFile(claimPath, JSON.stringify({ pid: process.pid, host, acquiredAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  try {
    for (const entry of await fs.readdir(lockPath)) {
      if (entry === claim) continue;
      const match = /^([^.]+)\.(\d+)\.[a-f0-9-]+\.owner$/.exec(entry);
      if (!match || match[1] !== host) throw new Error(`state lock owner cannot be checked locally: ${path.join(lockPath, entry)}; confirm that importer is stopped before removing its claim`);
      try { process.kill(Number(match[2]), 0); }
      catch (error) {
        if (error.code === 'ESRCH') { await fs.rm(path.join(lockPath, entry), { force: true }); continue; }
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error(`state lock already held by PID ${match[2]}: ${lockPath}`);
    }
    return await fn();
  } finally {
    await fs.rm(claimPath, { force: true });
    // Keep the empty container: its existence is not ownership. SIGKILL leaves only
    // this process's uniquely named claim, which the next local process can reclaim.
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
  updateCrosswalkRows,
  removeCrosswalkRow,
  loadAttemptJournal,
  appendAttempt,
  validateCrosswalkRow,
  validateAttemptRow,
  appendSafeModeEmailReplacement,
  appendSafeModeBlockedRecord,
  appendWixRequestCapture,
  loadWixRequestCaptures,
  appendDryRunCrosswalkRow,
  loadDryRunCrosswalk,
  dryRunUpsertDecision,
  RERUN_ACTIONS,
  rerunDecision,
  CONFIRMED_WRITE_OUTCOMES,
  nextCrosswalkBaseline,
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
