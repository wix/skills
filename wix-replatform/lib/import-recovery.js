'use strict';

const { verificationKind } = require('./entity-verification');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadAttemptJournal, loadCrosswalk, rerunDecision } = require('./local-state.js');
const { updateSupportFor } = require('./rerun-conflicts.js');

const RECOVERY_SCHEMA_VERSION = 1;
const RECOVERY_MODES = ['partial', 'missing-only', 'failed-only', 'deferred-only', 'resumed', 'rerun'];
const RECOVERY_STATUSES = ['complete', 'partial', 'failed', 'blocked'];
const DEFERRED_ATTEMPT_STATUSES = new Set(['deferred', 'needs_verification']);
// A.2: "A missing crosswalk link uses existing source-marker/natural-key checks and
// attempt-journal reconciliation before create." These statuses mean a previous write MIGHT have
// landed without being confirmed into the crosswalk, so creating again risks a duplicate.
const UNCERTAIN_ATTEMPT_STATUSES = new Set(['deferred', 'needs_verification', 'succeeded_unverified', 'started']);

function executionDir(projectDir) {
  return path.join(projectDir, 'execution');
}

function recoveryLogPath(projectDir) {
  return path.join(executionDir(projectDir), 'recovery-log.json');
}

function liveImportSummaryPath(projectDir) {
  return path.join(executionDir(projectDir), 'live-import-summary.json');
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
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readJsonIfExists(filePath, fallback) {
  if (!(await pathExists(filePath))) {
    return fallback;
  }
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function requireString(value, field) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function count(value, field) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function sourceStableKey(sourceSystem, sourceEntityType, sourceId) {
  return `${sourceSystem}:${sourceEntityType}:${sourceId}`;
}

function defaultSourceId(record) {
  return record && (record.id ?? record.ID ?? record.sourceId);
}

function defaultSourceType(record) {
  return record && (record.sourceType ?? record.subtype ?? record.type);
}

function normalizeSelectionFilters(input = {}) {
  const filters = {
    entity: input.entity || input.sourceEntityType || null,
    sourceType: input.sourceType || input.source_type || null,
    missingOnly: Boolean(input.missingOnly || input['missing-only']),
    failedOnly: Boolean(input.failedOnly || input['failed-only']),
    deferredOnly: Boolean(input.deferredOnly || input['deferred-only']),
  };
  const exclusive = [filters.missingOnly, filters.failedOnly, filters.deferredOnly].filter(Boolean);
  if (exclusive.length > 1) {
    throw new Error('--missing-only, --failed-only, and --deferred-only are mutually exclusive');
  }
  return filters;
}

// Spec 0140 §1/§2 and A.2. A rerun buckets the refreshed scope into create / update / unchanged
// / unknown against the crosswalk baseline. It is deliberately NOT expressible as the existing
// filters: `missingOnly` excludes every crosswalk hit (so no changed record is ever seen) and
// `failedOnly` only revisits what was already attempted (so a change nobody attempted is
// missed). A.4's regression check exists because an importer built from those two filters looks
// like a delta and silently is not.
//
// `unknown` is a first-class outcome, never folded into unchanged: see rerunDecision.
function selectRerunRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new Error('records must be an array');
  }
  const sourceSystem = options.sourceSystem || 'wordpress';
  const sourceEntityType = requireString(
    options.entity || options.sourceEntityType,
    'rerun selection entity',
  );
  const getSourceId = options.getSourceId || defaultSourceId;
  const crosswalkBySource = options.crosswalkBySource || {};
  const attemptsBySource = options.attemptsBySource || foldAttemptsBySource(options.attemptRows || []);
  // How to read this entity's version off a refreshed source record. Declared by the adapter,
  // never guessed here — A.2 forbids treating an object id or capture time as a record version.
  const sourceVersionField = options.sourceVersionField || null;
  const getSourceVersion = options.getSourceVersion
    || ((record) => (sourceVersionField ? record?.[sourceVersionField] : undefined));
  const getSourceHash = options.getSourceHash || (() => undefined);
  const sourceHashDefinition = options.sourceHashDefinition || null;
  // A.4 row 1: "excluded history and deletions stay out". The accepted scope is enforced HERE
  // rather than deferred to a generated importer: `inScope(record)` returns false for anything
  // the approved plan excluded, and those records are reported as out-of-scope, never actioned.
  // Deletions need no rule beyond this loop: a record absent from the refreshed source is simply
  // never iterated, so absence can never become a delete instruction.
  const inScope = typeof options.inScope === 'function' ? options.inScope : null;
  // Per-entity update capability, so a changed record for an entity with no verified
  // revision-protected writer is reported for review instead of being routed to an update.
  const entityRef = options.targetEntityRef || null;
  const declaredUpdateWriters = options.declaredUpdateWriters || {};
  // FAIL CLOSED. An undeclared entity used to default to supported:true, which bypassed BOTH the
  // order ban and the verified-writer requirement — an order with no targetEntityRef went
  // straight to `update`. Absence of a declaration is not evidence that an update is safe, so
  // the missing declaration is itself a review outcome.
  const updateSupport = updateSupportFor(entityRef, { declaredUpdateWriters });

  const create = [];
  const update = [];
  const unchanged = [];
  const unknown = [];
  const excluded = [];
  const outOfScope = [];
  const needsReconciliation = [];
  const reportForReview = [];

  for (const record of records) {
    const sourceId = getSourceId(record);
    if (sourceId === undefined || sourceId === null || sourceId === '') {
      excluded.push({ record, reason: 'missing_source_id' });
      continue;
    }
    const stableKey = sourceStableKey(sourceSystem, sourceEntityType, String(sourceId));
    if (inScope && !inScope(record)) {
      outOfScope.push({ sourceStableKey: stableKey, reason: 'excluded_by_accepted_scope' });
      continue;
    }
    const crosswalkRow = crosswalkBySource[stableKey] || null;
    const latestAttempt = attemptsBySource[stableKey] || null;
    const decision = rerunDecision({
      crosswalkRow,
      sourceVersion: getSourceVersion(record),
      sourceVersionField,
      sourceHash: getSourceHash(record),
      sourceHashDefinition,
    });
    const entry = {
      record,
      sourceStableKey: stableKey,
      existing: crosswalkRow,
      latestAttempt,
      decision,
    };
    if (decision.action === 'create') {
      // The attempt journal is consulted, not merely carried: an unconfirmed earlier write may
      // already exist on the target, so this reconciles before it creates a second one.
      if (latestAttempt && UNCERTAIN_ATTEMPT_STATUSES.has(latestAttempt.status)) {
        needsReconciliation.push({ ...entry, reason: `uncertain_prior_attempt:${latestAttempt.status}` });
      } else {
        create.push(entry);
      }
    } else if (decision.action === 'update') {
      if (!updateSupport.supported) {
        reportForReview.push({ ...entry, reason: updateSupport.reason, detail: updateSupport.detail || null });
      } else if (latestAttempt && UNCERTAIN_ATTEMPT_STATUSES.has(latestAttempt.status)) {
        // An uncertain attempt is as dangerous on a LINKED record as on a new one, for a
        // different reason: if the previous write actually landed and the process died before
        // saving its baseline, the saved revision is already stale. Re-sending it makes the
        // importer collide with its OWN earlier write and report it to the user as a merchant
        // edit. Reconcile first.
        needsReconciliation.push({ ...entry, reason: `uncertain_prior_attempt:${latestAttempt.status}` });
      } else {
        update.push(entry);
      }
    } else if (decision.action === 'skip') {
      if (verificationKind({ ...options, entity: sourceEntityType }) !== 'none') {
        needsReconciliation.push({ ...entry, reason: 'unchanged_source_requires_target_verification' });
      } else unchanged.push(entry);
    } else {
      unknown.push(entry);
    }
  }

  // §6: "Unknown counts are not zero." The caller reports these four buckets separately; an
  // unresolved record must never be summed into unchanged to make a report look clean.
  return {
    entity: sourceEntityType,
    mode: 'rerun',
    create,
    update,
    unchanged,
    unknown,
    excluded,
    outOfScope,
    needsReconciliation,
    reportForReview,
    updateSupport,
    summary: {
      entity: sourceEntityType,
      recordsRead: records.length,
      toCreate: create.length,
      toUpdate: update.length,
      unchanged: unchanged.length,
      unknown: unknown.length,
      needsReconciliation: needsReconciliation.length,
      reportForReview: reportForReview.length,
      outOfScope: outOfScope.length,
      excluded: excluded.length,
      sourceVersionField: sourceVersionField || null,
    },
  };
}

async function selectRerunRecordsFromState(projectDir, records, options = {}) {
  const crosswalk = await loadCrosswalk(projectDir);
  const attempts = await loadAttemptJournal(projectDir);
  return selectRerunRecords(records, {
    ...options,
    crosswalkBySource: crosswalk.bySource,
    attemptRows: attempts.rows,
  });
}

function foldAttemptsBySource(attemptRows = []) {
  const bySource = {};
  for (const row of attemptRows) {
    if (!row || !row.sourceStableKey) {
      continue;
    }
    bySource[row.sourceStableKey] = row;
  }
  return bySource;
}

function selectImportRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new Error('records must be an array');
  }
  const filters = normalizeSelectionFilters(options.filters || options);
  const sourceSystem = options.sourceSystem || 'wordpress';
  const sourceEntityType = requireString(filters.entity || options.sourceEntityType, 'selection entity');
  const getSourceId = options.getSourceId || defaultSourceId;
  const getSourceType = options.getSourceType || defaultSourceType;
  const crosswalkBySource = options.crosswalkBySource || {};
  const attemptsBySource = options.attemptsBySource || foldAttemptsBySource(options.attemptRows || []);

  const selected = [];
  const alreadyPresent = [];
  const excluded = [];
  const failed = [];
  const deferred = [];

  for (const record of records) {
    const sourceId = getSourceId(record);
    if (sourceId === undefined || sourceId === null || sourceId === '') {
      excluded.push({ record, reason: 'missing_source_id' });
      continue;
    }
    const stableKey = sourceStableKey(sourceSystem, sourceEntityType, String(sourceId));
    const sourceType = getSourceType(record);
    const existing = crosswalkBySource[stableKey] || null;
    const latestAttempt = attemptsBySource[stableKey] || null;

    if (filters.sourceType && String(sourceType) !== String(filters.sourceType)) {
      excluded.push({ sourceStableKey: stableKey, sourceType, reason: 'source_type_filter' });
      continue;
    }
    const identityRequired = verificationKind({ ...options, entity: sourceEntityType, targetEntityType: existing?.targetEntityType }) !== 'none';
    if (filters.missingOnly && existing && !identityRequired) {
      alreadyPresent.push({ sourceStableKey: stableKey, targetId: existing.targetId, reason: 'crosswalk' });
      continue;
    }
    if (filters.failedOnly && (!latestAttempt || !String(latestAttempt.status).startsWith('failed'))) {
      excluded.push({ sourceStableKey: stableKey, reason: 'not_failed' });
      continue;
    }
    if (filters.deferredOnly && (!latestAttempt || !DEFERRED_ATTEMPT_STATUSES.has(latestAttempt.status))) {
      excluded.push({ sourceStableKey: stableKey, reason: 'not_deferred' });
      continue;
    }

    if (latestAttempt && String(latestAttempt.status).startsWith('failed')) {
      failed.push(stableKey);
    }
    if (latestAttempt && DEFERRED_ATTEMPT_STATUSES.has(latestAttempt.status)) {
      deferred.push(stableKey);
    }
    selected.push({ record, sourceStableKey: stableKey, sourceType, existing, latestAttempt });
  }

  return {
    filters,
    entity: sourceEntityType,
    selected,
    alreadyPresent,
    excluded,
    summary: {
      entity: sourceEntityType,
      sourceType: filters.sourceType || 'all',
      recordsRead: records.length,
      recordsSelected: selected.length,
      alreadyPresent: alreadyPresent.length,
      excluded: excluded.length,
      failedCandidates: failed.length,
      deferredCandidates: deferred.length,
    },
  };
}

async function selectImportRecordsFromState(projectDir, records, options = {}) {
  const crosswalk = await loadCrosswalk(projectDir);
  const attempts = await loadAttemptJournal(projectDir);
  return selectImportRecords(records, {
    ...options,
    crosswalkBySource: crosswalk.bySource,
    attemptRows: attempts.rows,
  });
}

function recoveryIdFor(entry) {
  if (entry.recoveryId) {
    return entry.recoveryId;
  }
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      timestamp: entry.timestamp,
      selectionFilters: entry.selectionFilters,
      reason: entry.reason,
      recordsSelected: entry.recordsSelected,
      recordsAttempted: entry.recordsAttempted,
    }))
    .digest('hex')
    .slice(0, 12);
  const stamp = String(entry.timestamp || new Date().toISOString()).replace(/[^0-9TZ]/g, '').slice(0, 15);
  return `recovery-${stamp}-${hash}`;
}

function normalizeRecoveryEntry(input = {}) {
  const mode = input.mode || (input.selectionFilters && (
    input.selectionFilters.missingOnly ? 'missing-only' :
      input.selectionFilters.failedOnly ? 'failed-only' :
        input.selectionFilters.deferredOnly ? 'deferred-only' : 'partial'
  ));
  if (!RECOVERY_MODES.includes(mode)) {
    throw new Error(`recovery mode must be one of: ${RECOVERY_MODES.join(', ')}`);
  }
  const status = input.status || 'partial';
  if (!RECOVERY_STATUSES.includes(status)) {
    throw new Error(`recovery status must be one of: ${RECOVERY_STATUSES.join(', ')}`);
  }
  const timestamp = input.timestamp || new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error('recovery timestamp must be an ISO timestamp');
  }
  const entry = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    recoveryId: input.recoveryId || null,
    timestamp,
    mode,
    selectionFilters: input.selectionFilters || {},
    reason: requireString(input.reason || 'operator_requested_recovery', 'recovery reason'),
    recordsSelected: count(input.recordsSelected, 'recordsSelected'),
    recordsAttempted: count(input.recordsAttempted, 'recordsAttempted'),
    imported: count(input.imported, 'imported'),
    alreadyPresent: count(input.alreadyPresent, 'alreadyPresent'),
    failed: count(input.failed, 'failed'),
    deferred: count(input.deferred, 'deferred'),
    crosswalkChanges: input.crosswalkChanges || { before: 0, after: 0, added: 0, updated: 0 },
    summaryChanges: input.summaryChanges || {},
    outcome: requireString(input.outcome || status, 'recovery outcome'),
    status,
    logs: Array.isArray(input.logs) ? input.logs : [],
    // Spec 0140 §4: a keep-Wix answer has to survive a reload, or the next rerun re-asks a
    // question the user already answered — or worse, silently overwrites what they chose to
    // keep. This entry is built field-by-field, so anything not named here is dropped; before
    // this, passing a recordConflictDecision() result through lost choice, record identity,
    // versions and the binding fingerprint without erroring.
    conflictDecisions: normalizeConflictDecisions(input.conflictDecisions),
  };
  entry.recoveryId = recoveryIdFor(entry);
  return entry;
}

// Each decision keeps exactly the fields keepDecisionApplies()/approvalApplies() need to judge
// whether it still applies. A decision missing any of them cannot be matched later, so it is
// rejected at write time rather than silently stored as unusable.
const CONFLICT_DECISION_FIELDS = [
  'choice', 'sourceStableKey', 'targetId', 'entity',
  'sourceVersion', 'sourceHash', 'reviewedTargetRevision', 'bindingFingerprint',
  'decidedBy', 'decidedAt',
];

function normalizeConflictDecisions(input) {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error('conflictDecisions must be an array');
  }
  return input.map((d, i) => {
    if (!d || typeof d !== 'object') {
      throw new Error(`conflictDecisions[${i}] must be an object`);
    }
    for (const required of ['choice', 'sourceStableKey', 'targetId', 'bindingFingerprint']) {
      if (!d[required] || typeof d[required] !== 'string') {
        throw new Error(`conflictDecisions[${i}].${required} must be a non-empty string — a decision that cannot be matched to a record is not reusable`);
      }
    }
    if (!['override', 'keep'].includes(d.choice)) {
      throw new Error(`conflictDecisions[${i}].choice must be override or keep`);
    }
    const out = {};
    for (const f of CONFLICT_DECISION_FIELDS) {
      out[f] = d[f] === undefined ? null : d[f];
    }
    return out;
  });
}

// Reads every conflict decision recorded across the whole recovery log, newest last, so a rerun
// can ask "did the user already answer for this record?" without replaying the log itself.
function recoveryEntriesOf(recoveryLog) {
  // loadRecoveryLog() returns an ARRAY. Reading `.entries` off it yields
  // Array.prototype.entries -- a function, which a for-of then rejects with a bare
  // "entries is not iterable". Accept the array (the real shape on disk) and the
  // `{ entries: [...] }` wrapper, and treat anything else as empty.
  if (Array.isArray(recoveryLog)) {
    return recoveryLog;
  }
  if (recoveryLog && Array.isArray(recoveryLog.entries)) {
    return recoveryLog.entries;
  }
  return [];
}

function loadConflictDecisions(recoveryLog) {
  const entries = recoveryEntriesOf(recoveryLog);
  const out = [];
  for (const entry of entries) {
    for (const d of (entry.conflictDecisions || [])) {
      out.push({ ...d, recoveryId: entry.recoveryId || null, timestamp: entry.timestamp || null });
    }
  }
  return out;
}

// The newest decision for one record, which is the only one that can still apply.
function latestConflictDecisionFor(recoveryLog, sourceStableKey) {
  const all = loadConflictDecisions(recoveryLog).filter((d) => d.sourceStableKey === sourceStableKey);
  return all.length ? all[all.length - 1] : null;
}

async function loadRecoveryLog(projectDir) {
  const rows = await readJsonIfExists(recoveryLogPath(projectDir), []);
  if (!Array.isArray(rows)) {
    throw new Error('execution/recovery-log.json must contain a JSON array');
  }
  return rows.map((row) => normalizeRecoveryEntry(row));
}

async function appendRecoveryLogEntry(projectDir, entry) {
  const existing = await loadRecoveryLog(projectDir);
  const normalized = normalizeRecoveryEntry(entry);
  if (existing.some((row) => row.recoveryId === normalized.recoveryId)) {
    throw new Error(`duplicate recoveryId: ${normalized.recoveryId}`);
  }
  const next = [...existing, normalized];
  await writeJsonAtomic(recoveryLogPath(projectDir), next);
  return normalized;
}

function diffCounts(before = {}, after = {}) {
  before = before || {};
  after = after || {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const diff = {};
  for (const key of keys) {
    if (Number.isInteger(before[key]) || Number.isInteger(after[key])) {
      diff[key] = (after[key] || 0) - (before[key] || 0);
    }
  }
  return diff;
}

async function writeLiveImportSummary(projectDir, summary, options = {}) {
  const before = await readJsonIfExists(liveImportSummaryPath(projectDir), null);
  const next = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(summary || {}),
  };
  await writeJsonAtomic(liveImportSummaryPath(projectDir), next);
  return {
    path: 'execution/live-import-summary.json',
    beforeExists: Boolean(before),
    changes: {
      imported: diffCounts(before && before.imported, next.imported),
      deferred: diffCounts(before && before.deferred, next.deferred),
      failed: diffCounts(before && before.failed, next.failed),
      ...(options.extraChanges || {}),
    },
  };
}

module.exports = {
  RECOVERY_SCHEMA_VERSION,
  recoveryLogPath,
  liveImportSummaryPath,
  normalizeSelectionFilters,
  foldAttemptsBySource,
  sourceStableKey,
  selectImportRecords,
  selectImportRecordsFromState,
  selectRerunRecords,
  selectRerunRecordsFromState,
  normalizeRecoveryEntry,
  normalizeConflictDecisions,
  recoveryEntriesOf,
  loadConflictDecisions,
  latestConflictDecisionFor,
  loadRecoveryLog,
  appendRecoveryLogEntry,
  writeLiveImportSummary,
};
