'use strict';

const { verificationKind } = require('./entity-verification');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  UNRESOLVED_ATTEMPT_STATUSES,
  loadAttemptJournal,
  loadCrosswalk,
  rerunDecision,
  attemptJournalPath,
  readAttemptJournalSince,
  foldAttemptsBySourceKey,
} = require('./local-state.js');
const { updateSupportFor } = require('./rerun-conflicts.js');
const { appendExecutionLog } = require('./execution-log.js');

const RECOVERY_SCHEMA_VERSION = 1;
const RECOVERY_MODES = ['partial', 'missing-only', 'failed-only', 'deferred-only', 'unresolved-only', 'resumed', 'rerun'];
const RECOVERY_STATUSES = ['complete', 'partial', 'failed', 'blocked'];
const DEFERRED_ATTEMPT_STATUSES = new Set(['deferred', 'needs_verification']);
// A missing crosswalk link uses existing source-marker/natural-key checks and
// attempt-journal reconciliation before create. These statuses mean a previous write MIGHT have
// landed without being confirmed into the crosswalk, so creating again risks a duplicate.
const UNCERTAIN_ATTEMPT_STATUSES = new Set(['deferred', 'needs_verification', 'succeeded_unverified', 'started']);
// The three terminal `skipped_*` statuses
// `coverageStatusCounts` deliberately never buckets (it has no branch for any of them) make no
// journal-count claim at all -- there is nothing an importer could even report a disagreeing
// number for. A target type whose journal rows are ENTIRELY one or more of these is therefore not
// "unreported journal activity"; it is a type nothing was ever attempted, deferred, or failed for.
// Before this fix, the reverse journal->summary check (`unmatchedJournalEntities` below) counted
// ALL rows for a target type, including these, so a type whose only rows were e.g.
// `skipped_out_of_scope` was never named by any ordinary or naming-only summary bucket (nothing
// was imported/deferred/failed/attempted/already-present for it) and fell into
// `unmatchedJournalEntities` permanently -- for example a journal whose only row for
// a target type (`ecom/shipping-option`) is a single `skipped_out_of_scope` row. Excluding these statuses from the "claiming" row count used by
// that check -- and from `coverageByType`'s cumulative high-water mark itself,
// so the mark and the check it feeds always measure the same thing -- fixes this without making
// skipped_out_of_scope a journal-count claim anywhere else.
const NON_CLAIMING_ATTEMPT_STATUSES = new Set(['skipped_already_imported', 'skipped_safe_mode_blocked', 'skipped_out_of_scope']);

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
    // Unresolved gets its own selection mode because its next action differs:
    // read the target back, never re-send. Re-sending an uncertain write is how a recovery
    // pass creates a duplicate on a live store.
    unresolvedOnly: Boolean(input.unresolvedOnly || input['unresolved-only']),
  };
  const exclusive = [filters.missingOnly, filters.failedOnly, filters.deferredOnly, filters.unresolvedOnly].filter(Boolean);
  if (exclusive.length > 1) {
    throw new Error('--missing-only, --failed-only, --deferred-only, and --unresolved-only are mutually exclusive');
  }
  return filters;
}

// A rerun buckets the refreshed scope into create / update / unchanged
// / unknown against the crosswalk baseline. It is deliberately NOT expressible as the existing
// filters: `missingOnly` excludes every crosswalk hit (so no changed record is ever seen) and
// `failedOnly` only revisits what was already attempted (so a change nobody attempted is
// missed). A regression check exists because an importer built from those two filters looks
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
  // never guessed here — an object id or capture time must never be treated as a record version an object id or capture time as a record version.
  const sourceVersionField = options.sourceVersionField || null;
  const getSourceVersion = options.getSourceVersion
    || ((record) => (sourceVersionField ? record?.[sourceVersionField] : undefined));
  const getSourceHash = options.getSourceHash || (() => undefined);
  const sourceHashDefinition = options.sourceHashDefinition || null;
  // Excluded history and deletions stay out. The accepted scope is enforced HERE
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

  // Unknown counts are not zero. The caller reports these four buckets separately; an
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
  const unresolved = [];

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
    if (filters.unresolvedOnly && (!latestAttempt || !UNRESOLVED_ATTEMPT_STATUSES.has(latestAttempt.status))) {
      excluded.push({ sourceStableKey: stableKey, reason: 'not_unresolved' });
      continue;
    }

    if (latestAttempt && String(latestAttempt.status).startsWith('failed')) {
      failed.push(stableKey);
    }
    if (latestAttempt && DEFERRED_ATTEMPT_STATUSES.has(latestAttempt.status)) {
      deferred.push(stableKey);
    }
    // Never also counted in `failed`: the two sets are disjoint by construction, and an
    // uncertain write summed into a failure count produces a report that reconciles
    // arithmetically and is wrong.
    if (latestAttempt && UNRESOLVED_ATTEMPT_STATUSES.has(latestAttempt.status)) {
      unresolved.push(stableKey);
    }
    selected.push({ record, sourceStableKey: stableKey, sourceType, existing, latestAttempt });
  }

  return {
    filters,
    entity: sourceEntityType,
    selected,
    alreadyPresent,
    excluded,
    unresolved,
    summary: {
      entity: sourceEntityType,
      sourceType: filters.sourceType || 'all',
      recordsRead: records.length,
      recordsSelected: selected.length,
      alreadyPresent: alreadyPresent.length,
      excluded: excluded.length,
      failedCandidates: failed.length,
      deferredCandidates: deferred.length,
      unresolvedCandidates: unresolved.length,
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
        input.selectionFilters.deferredOnly ? 'deferred-only' :
          input.selectionFilters.unresolvedOnly ? 'unresolved-only' : 'partial'
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
  // `unresolved` must be stated, not defaulted: an entry that omits it is an
  // entry whose author never decided where its uncertain writes went, and `count()` would
  // silently read that as zero.
  if (input.unresolved === undefined || input.unresolved === null) {
    throw new Error('recovery unresolved count must be stated explicitly — uncertain writes are never folded into failed');
  }
  const entry = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    recoveryId: input.recoveryId || null,
    timestamp,
    // This entry is built field by field, so anything not named here is
    // dropped silently — which is why both of these are added explicitly.
    runId: requireString(input.runId, 'recovery runId'),
    mode,
    selectionFilters: input.selectionFilters || {},
    reason: requireString(input.reason || 'operator_requested_recovery', 'recovery reason'),
    recordsSelected: count(input.recordsSelected, 'recordsSelected'),
    recordsAttempted: count(input.recordsAttempted, 'recordsAttempted'),
    imported: count(input.imported, 'imported'),
    alreadyPresent: count(input.alreadyPresent, 'alreadyPresent'),
    failed: count(input.failed, 'failed'),
    deferred: count(input.deferred, 'deferred'),
    // Its own count, never summed into `failed`. A recovery record whose failed count silently
    // includes uncertain writes reconciles arithmetically and is wrong, which is the worst
    // combination available.
    unresolved: count(input.unresolved, 'unresolved'),
    crosswalkChanges: input.crosswalkChanges || { before: 0, after: 0, added: 0, updated: 0 },
    summaryChanges: input.summaryChanges || {},
    outcome: requireString(input.outcome || status, 'recovery outcome'),
    status,
    logs: Array.isArray(input.logs) ? input.logs : [],
    // A keep-Wix answer has to survive a reload, or the next rerun re-asks a
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

// ---------------------------------------------------------------------------
// The live import summary checks its held counters against the attempt journal for
// the same run, instead of trusting them on faith. This cache keeps that check cheap and isolated per run.
// ---------------------------------------------------------------------------

const COVERAGE_JOURNAL_REL_PATH = 'state/attempts/write-attempts.ndjson';
const COVERAGE_ORDINARY_BUCKETS = ['imported', 'deferred', 'failed', 'attempted'];
// A flush can legitimately name an entity ONLY through a
// non-coverage-bucket counter -- `alreadyPresentByCrosswalk` records what a re-run pass found
// already linked, with nothing attempted this run and so no journal status to compare it
// against (the `imported + alreadyPresentByCrosswalk + deferred + failed == inScope` identity
// this repo's entityCompleteness accounting already protects). A flush naming only this
// counter for an entity is still reporting on that entity: it must count toward "this flush named
// it" for the reverse-direction match, the same way an ordinary bucket does, or a correct re-run
// pass reporting solely `alreadyPresentByCrosswalk` gets the same false `unmatchedJournalEntities`
// mismatch an ordinary bucket's absence would produce if it were mistaken for silence.
const COVERAGE_NAMING_ONLY_BUCKETS = ['alreadyPresentByCrosswalk'];

// Keyed by the absolute live-journal path, so distinct project directories (or a test's many temp
// dirs) never share state. Each entry's `offset` is the end of the last complete line read; `runs`
// holds one folded Map<sourceStableKey, latestRow> PER RUN ID seen in the journal so far -- not
// only the run currently flushing -- so switching from run A to run B and back never carries A's
// rows into B's map and never misses a row written while the other run was flushing. Memory is
// O(unique records across runs in the journal); work per flush is O(new bytes read).
//
// `reportedEntityCoverage` is a SIBLING per-run accumulator, independent of the folded rows: for
// each resolved target entity type some flush of this run has named a summary key for (ever, not
// only the flush currently running), it keeps the highest CLAIMING journal row count (never the raw row count -- see `NON_CLAIMING_ATTEMPT_STATUSES` above) that was true for
// that entity AT THE TIME it was last named -- not just a boolean "was it ever named". The journal fold
// is deliberately cumulative across the whole run (so a later flush sees everything an earlier one
// did -- that is the point of this cache), but `live-import-summary.json` is fully overwritten on
// every flush and a real multi-entity importer flushes one entity at a time (the only documented
// caller shape, rp-import-codegen/SKILL.md's contacts wrapper). Comparing the CURRENT flush's
// summary keys against the FULL run's cumulative journal entity types would then flag every entity
// reported by an earlier flush of the SAME run as "journal has rows, no summary key names it" the
// moment a later flush reports a different entity -- a false mismatch on every correctly-behaving
// multi-entity run. Tracking what has EVER been named across
// the run's own flushes, instead of only the current one, keeps a truly never-reported entity type
// detectable (it is never added) while an entity named by an earlier flush of this same run is
// correctly recognized as reported, not re-flagged by a later, different flush -- AS LONG AS the
// journal has not grown new rows for that entity since the last time it was named.
//
// A plain per-entity boolean
// is wrong, because "named once" is not the same thing as "accounts for the journal's current
// state". A flush naming an entity ONLY via a naming-only bucket (`alreadyPresentByCrosswalk`)
// while that entity had zero matching journal rows at that moment legitimately agrees -- but if the journal LATER accrues real, ordinary-status rows for that same entity type,
// and no later flush of the run ever names it again (via any bucket), a permanent boolean would
// keep calling that entity "reported" forever, hiding genuinely unreported journal activity from
// the reverse-direction (journal -> summary) check this check exists to provide. Storing the ROW
// COUNT that was true at the moment of naming, instead of a bare boolean, and re-comparing it
// against the journal's CURRENT row count on every subsequent flush, fixes this without reopening
// either case: an entity whose journal rows have not grown past what was already named stays correctly
// exempt (the legitimate "nothing new happened" cases both look like this), while new,
// never-claimed rows past that high-water mark are caught the same way a never-named entity is.
//
// This whole cache, including `reportedEntityCoverage`, is
// process-local (in-memory) and is NOT persisted across a process restart. That is intentional,
// not an oversight: a run id's entire lifetime is confined to one process by a GATE-ENFORCED
// contract, not merely a convention. Every generated importer must self-describe
// `runIdSource: "process-start"` (`assertGeneratedImporterContract` below rejects anything else;
// `rp-import-codegen/SKILL.md`'s "runId is the id the importer mints at process start" and
// `rp-execute-import/SKILL.md`'s recovery-log contract, "the id the importer minted at process
// start, so the entry is attributable to a pass", restate the same rule). So a genuinely resumed
// or recovery pass is a NEW process that mints a NEW run id -- it is correct, not a loss of state,
// for that new run id's `reportedEntityCoverage` to start empty, because no flush has ever happened
// under it. This reasoning does NOT cover a caller outside that gated contract that manually
// reuses an old run id across a process restart (for example an ad hoc recovery script bypassing
// codegen); that usage is unsupported today and would resurface the false-mismatch pattern on
// its first post-restart flush.
const coverageJournalCache = new Map();

function emptyCoverageCacheEntry() {
  return { offset: 0, runs: new Map(), reportedEntityCoverage: new Map() };
}

// Reuses `foldAttemptsBySourceKey` (local-state.js) on just the newly read rows, grouped by run,
// then merges each run's folded result into that run's cached map -- `Map.set` overwrites, and the
// new rows are strictly later in file order than whatever is already cached, so this reproduces
// exactly what folding the whole run's rows from scratch would produce.
function mergeRowsIntoCoverageCache(entry, rows) {
  const byRun = new Map();
  for (const row of rows) {
    if (!row || !row.runId || !row.sourceStableKey) {
      continue;
    }
    if (!byRun.has(row.runId)) {
      byRun.set(row.runId, []);
    }
    byRun.get(row.runId).push(row);
  }
  for (const [rowRunId, runRows] of byRun) {
    const folded = foldAttemptsBySourceKey(runRows);
    let runMap = entry.runs.get(rowRunId);
    if (!runMap) {
      runMap = new Map();
      entry.runs.set(rowRunId, runMap);
    }
    for (const [key, row] of folded) {
      runMap.set(key, row);
    }
  }
}

// Count buckets, computed directly from the folded rows' latest status -- never derived by summing
// other held counters. `attempted` matches this repo's documented semantics
// (rp-import-codegen/SKILL.md:2181-2182): imported or failed, never deferred.
function coverageStatusCounts(rows) {
  const counts = { imported: 0, deferred: 0, failed: 0, attempted: 0, unexpectedSkipped: 0, unresolved: 0 };
  for (const row of rows) {
    const status = row.status;
    if (status === 'imported') {
      counts.imported += 1;
      counts.attempted += 1;
    } else if (status === 'failed_retryable' || status === 'failed_terminal') {
      counts.failed += 1;
      counts.attempted += 1;
    } else if (DEFERRED_ATTEMPT_STATUSES.has(status)) {
      counts.deferred += 1;
    } else if (status === 'skipped_unexpected') {
      counts.unexpectedSkipped += 1;
    } else if (UNRESOLVED_ATTEMPT_STATUSES.has(status)) {
      counts.unresolved += 1;
    }
  }
  return counts;
}

// A held counter is "carried" only when the summary names it explicitly, including an explicit 0
// -- `in` rather than a truthiness check, so a real `0` is never mistaken for absence.
function heldBucketValue(summary, bucket, key) {
  const container = summary && summary[bucket];
  if (!container || typeof container !== 'object' || !(key in container)) {
    return { present: false, value: null };
  }
  return { present: true, value: container[key] };
}

function truncateMessage(message) {
  return typeof message === 'string' && message.length > 300 ? message.slice(0, 300) : message;
}

// Disagreeing `{key, bucket, held, journal}` entries, in entity-then-bucket order -- shared by the
// execution-log detail text below and by completion-report.js's operator-action text.
function coverageDisagreements(coverageCheck) {
  const items = [];
  for (const [key, row] of Object.entries((coverageCheck && coverageCheck.entities) || {})) {
    for (const bucket of [...COVERAGE_ORDINARY_BUCKETS, 'unexpectedSkipped']) {
      const counter = row[bucket];
      if (counter && counter.compared && counter.agrees === false) {
        items.push({ key, bucket, held: counter.held, journal: counter.journal });
      }
    }
  }
  return items;
}

function describeCoverageMismatch(coverageCheck) {
  const parts = coverageDisagreements(coverageCheck)
    .map((item) => `${item.key}.${item.bucket} disagrees (held ${item.held}, journal ${item.journal})`);
  for (const key of (coverageCheck && coverageCheck.unmatched) || []) {
    parts.push(`${key} not found in the journal for this run`);
  }
  for (const type of (coverageCheck && coverageCheck.unmatchedJournalEntities) || []) {
    parts.push(`journal has ${type} records not named by any summary key`);
  }
  return parts.join('; ') || 'coverage check mismatch';
}

// Reads (incrementally, via the cache above) the live journal rows for `runId`,
// folds them, and compares them against `summary`'s held counters. Never throws: every case the
// check itself cannot complete resolves to `status: "unchecked"` with a named `reason`.
async function computeCoverageCheck(projectDir, summary, options, runId) {
  const checkedAt = new Date().toISOString();
  const base = { runId: runId || null, checkedAt, journalPath: COVERAGE_JOURNAL_REL_PATH };
  if (!runId) {
    return { ...base, status: 'unchecked', reason: 'no_run_id', rowsRead: 0, entities: {}, unmatched: [], unmatchedJournalEntities: [] };
  }

  const absPath = path.resolve(attemptJournalPath(projectDir));
  let entry = coverageJournalCache.get(absPath);
  if (!entry) {
    entry = emptyCoverageCacheEntry();
    coverageJournalCache.set(absPath, entry);
  }

  let readResult;
  try {
    readResult = await readAttemptJournalSince(projectDir, entry.offset);
  } catch (error) {
    if (error && error.code === 'JOURNAL_MISSING') {
      return { ...base, status: 'unchecked', reason: 'journal_missing', rowsRead: 0, entities: {}, unmatched: [], unmatchedJournalEntities: [] };
    }
    if (error && error.code === 'JOURNAL_READ_FAILED') {
      return {
        ...base, status: 'unchecked', reason: 'journal_read_failed', rowsRead: 0, entities: {}, unmatched: [], unmatchedJournalEntities: [],
        error: { code: (error.cause && error.cause.code) || null, message: truncateMessage(error.message) },
      };
    }
    if (error && error.code === 'JOURNAL_INVALID') {
      // Drop the whole cache entry so the next flush retries with a full read.
      coverageJournalCache.delete(absPath);
      return {
        ...base, status: 'unchecked', reason: 'journal_invalid', rowsRead: 0, entities: {}, unmatched: [], unmatchedJournalEntities: [],
        error: { line: truncateMessage(error.line), message: truncateMessage(error.message) },
      };
    }
    throw error;
  }

  if (readResult.truncated) {
    entry.runs = new Map();
    entry.reportedEntityCoverage = new Map();
  }
  mergeRowsIntoCoverageCache(entry, readResult.rows);
  entry.offset = readResult.nextOffset;

  const runMap = entry.runs.get(runId) || new Map();
  const entityTypesOption = (options && options.entityTypes) || {};
  const resolveTargetEntityType = (key) => entityTypesOption[key] || key;

  // Buckets that merely NAME an entity (for match purposes) vs. buckets whose VALUE is actually
  // compared against the journal. `alreadyPresentByCrosswalk` is in the first set only.
  const summaryKeys = new Set();
  for (const bucket of [...COVERAGE_ORDINARY_BUCKETS, 'unexpectedSkipped', ...COVERAGE_NAMING_ONLY_BUCKETS]) {
    const container = summary && summary[bucket];
    if (container && typeof container === 'object') {
      for (const key of Object.keys(container)) {
        summaryKeys.add(key);
      }
    }
  }

  const rowsByTargetType = new Map();
  for (const row of runMap.values()) {
    const type = row.targetEntityType;
    if (!rowsByTargetType.has(type)) {
      rowsByTargetType.set(type, []);
    }
    rowsByTargetType.get(type).push(row);
  }

  const entities = {};
  const unmatched = [];
  const matchedTargetTypes = new Set();
  let anyMismatch = false;
  let anyUnresolved = false;

  for (const key of summaryKeys) {
    const targetType = resolveTargetEntityType(key);
    const rows = rowsByTargetType.get(targetType) || [];
    // A key named ONLY through a naming-only bucket (e.g. `alreadyPresentByCrosswalk`) makes
    // no claim about journal activity for this entity -- zero matching rows is its expected,
    // unremarkable state (nothing was attempted this run), not an unmatched claim. A key that
    // names at least one ORDINARY bucket (imported/deferred/failed/attempted) is still held to
    // the existing rule: claiming activity with zero matching journal rows is unmatched.
    const namesOrdinaryBucket = COVERAGE_ORDINARY_BUCKETS.some((bucket) => heldBucketValue(summary, bucket, key).present);
    if (rows.length === 0 && namesOrdinaryBucket) {
      // A summary key with no matching rows is reported as unmatched, never as agreement.
      unmatched.push(key);
      anyMismatch = true;
      continue;
    }
    matchedTargetTypes.add(targetType);
    const counts = coverageStatusCounts(rows);
    if (counts.unresolved > 0) {
      anyUnresolved = true;
    }
    const entityRow = { unresolved: counts.unresolved };
    for (const bucket of COVERAGE_ORDINARY_BUCKETS) {
      const held = heldBucketValue(summary, bucket, key);
      if (!held.present) {
        entityRow[bucket] = { held: null, journal: counts[bucket], agrees: null, compared: false };
      } else {
        const agrees = held.value === counts[bucket];
        if (!agrees) {
          anyMismatch = true;
        }
        entityRow[bucket] = { held: held.value, journal: counts[bucket], agrees, compared: true };
      }
    }
    // `unexpectedSkipped` is deliberately the opposite of the four ordinary buckets: a status
    // nothing should ever reach must not go invisible merely because the importer never named a
    // counter for it, so an absent held value defaults to 0 rather than to "not compared".
    const heldSkipped = heldBucketValue(summary, 'unexpectedSkipped', key);
    const heldSkippedValue = heldSkipped.present ? heldSkipped.value : 0;
    const skippedAgrees = heldSkippedValue === counts.unexpectedSkipped;
    if (!skippedAgrees) {
      anyMismatch = true;
    }
    entityRow.unexpectedSkipped = { held: heldSkippedValue, journal: counts.unexpectedSkipped, agrees: skippedAgrees, compared: true };
    entities[key] = entityRow;
  }

  // Accumulate this flush's matched target types into the run's PERSISTED, cumulative
  // coverage map -- not a bare "was it ever named" boolean, but the CLAIMING journal row count that
  // was true for that entity AT THE TIME it was named. See the cache comment above
  // `coverageJournalCache` for why cumulative tracking across flushes is required at all, and
  // for why a boolean is not enough on its own: a naming-only bucket (or any bucket) can
  // legitimately name an entity while the journal has zero (or fewer) rows for it, and the journal
  // can keep growing afterward without any later flush ever naming that entity again. Storing the
  // row count lets the reverse check keep comparing cumulative reported coverage against the
  // journal's cumulative state on every flush, instead of permanently exempting an entity the
  // moment it is named once.
  //
  // This mark and the reverse-mismatch check below are two
  // halves of one invariant -- "the mark only ever reflects rows that make a journal-count claim" --
  // and must be computed from the SAME per-type claiming count, not two separately-filtered ones.
  // Updating the mark with each type's FULL row count (claiming + non-claiming) while the check below
  // compares it against the claiming-only count let a type matched while it already had non-claiming
  // rows (e.g. `skipped_out_of_scope`) set an inflated mark that could then mask a later genuine,
  // never-renamed claiming row (e.g. a real `imported` row) for that same type -- the mark never
  // dropped, so `covered < claimingRowCount` stayed false even though the claim was real. Computing
  // `claimingRowCountByType` once, up front, and using it for BOTH the mark and the check keeps them
  // structurally unable to drift apart again.
  const claimingRowCountByType = new Map();
  for (const [targetType, rowsForType] of rowsByTargetType) {
    const claimingRowCount = rowsForType.filter((row) => !NON_CLAIMING_ATTEMPT_STATUSES.has(row.status)).length;
    claimingRowCountByType.set(targetType, claimingRowCount);
  }

  let coverageByType = entry.reportedEntityCoverage.get(runId);
  if (!coverageByType) {
    coverageByType = new Map();
    entry.reportedEntityCoverage.set(runId, coverageByType);
  }
  for (const targetType of matchedTargetTypes) {
    const claimingRowCount = claimingRowCountByType.get(targetType) || 0;
    const previouslyCovered = coverageByType.get(targetType) || 0;
    coverageByType.set(targetType, Math.max(previouslyCovered, claimingRowCount));
  }

  // Journal -> summary direction: a targetEntityType with real folded CLAIMING rows but no summary
  // key EVER naming it across this run's flushes (directly, or via `entityTypes`) is a counter the
  // importer never reported. "Named" is re-checked against the journal's CURRENT cumulative
  // claiming row count on every flush, not treated as a one-time permanent exemption -- an entity
  // whose claiming row count has grown past what was covered the last time it was named is just as
  // unreported, from this run's own summary, as one that was never named at all.
  //
  // A target type whose ONLY rows are e.g. `skipped_out_of_scope` has zero claiming rows, so
  // `covered` (0, since `coverageByType` only ever accumulates claiming counts too) is never less
  // than 0 and it is correctly never flagged -- it made no claim, so there is nothing to be missing.
  const unmatchedJournalEntities = [];
  for (const [targetType, claimingRowCount] of claimingRowCountByType) {
    const covered = coverageByType.get(targetType) || 0;
    if (covered < claimingRowCount) {
      unmatchedJournalEntities.push(targetType);
      anyMismatch = true;
    }
  }

  let status;
  let reason;
  if (anyMismatch) {
    status = 'mismatch';
  } else if (anyUnresolved) {
    status = 'unchecked';
    reason = 'has_unresolved';
  } else {
    status = 'agrees';
  }

  return {
    ...base,
    status,
    ...(reason ? { reason } : {}),
    rowsRead: readResult.rows.length,
    entities,
    unmatched,
    unmatchedJournalEntities,
  };
}

// This is the PER-BATCH FLUSH POINT, not a recovery-only helper. An
// importer that holds its counters until the end loses them to any interruption, and a long
// import redirected to a temp file loses them to the shell. Call it after every batch with the
// run's own held counters -- never with figures re-derived from the append-only ledger, which
// folds dry-run rows, retried batches and recovery re-entries into the live total.
//
// Durable accounting, not liveness: heartbeat output belongs to `lib/progress-log.js`.
//
// When this flush names a run id (its own `options.runId`, else `summary.runId`), the
// write is also checked against that run's attempt-journal rows. The check never replaces a
// held counter and never throws for its own sake -- a wrong or uncheckable count is reported, not
// hidden, and the write still completes normally either way.
async function writeLiveImportSummary(projectDir, summary, options = {}) {
  const before = await readJsonIfExists(liveImportSummaryPath(projectDir), null);
  const effectiveRunId = options.runId || (summary && summary.runId) || null;
  const coverageCheck = await computeCoverageCheck(projectDir, summary, options, effectiveRunId);
  const next = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(summary || {}),
    coverageCheck,
  };
  await writeJsonAtomic(liveImportSummaryPath(projectDir), next);
  if (options.runId) {
    await appendExecutionLog(projectDir, {
      runId: options.runId,
      phase: options.phase || 'import',
      event: 'batch_flush',
      detail: options.detail || `accounting flushed after batch ${options.batchNumber === undefined ? '(unnumbered)' : options.batchNumber}`,
      artifacts: ['execution/live-import-summary.json'],
    });
  }
  if (effectiveRunId && coverageCheck.status === 'mismatch') {
    await appendExecutionLog(projectDir, {
      runId: effectiveRunId,
      phase: options.phase || 'import',
      event: 'coverage_mismatch',
      detail: describeCoverageMismatch(coverageCheck),
      artifacts: ['execution/live-import-summary.json'],
    });
  } else if (effectiveRunId && coverageCheck.status === 'unchecked') {
    await appendExecutionLog(projectDir, {
      runId: effectiveRunId,
      phase: options.phase || 'import',
      event: 'coverage_unchecked',
      detail: `coverage check could not run (reason: ${coverageCheck.reason})`,
      artifacts: ['execution/live-import-summary.json'],
    });
  }
  return {
    path: 'execution/live-import-summary.json',
    beforeExists: Boolean(before),
    changes: {
      imported: diffCounts(before && before.imported, next.imported),
      deferred: diffCounts(before && before.deferred, next.deferred),
      failed: diffCounts(before && before.failed, next.failed),
      ...(options.extraChanges || {}),
    },
    coverageCheck,
  };
}


// ---------------------------------------------------------------------------
// The generated importer declares its modes, and the gate checks them.
//
// Before this, the codegen skill ASKED for selective-recovery flags and nothing anywhere
// verified that a generated importer honoured the instruction. A generated importer once
// shipped that parsed no command-line arguments at all, exposed none of the modes,
// and passed the import gate — a mandatory boundary that existed only as prose.
// ---------------------------------------------------------------------------

const GENERATED_IMPORTER_CONTRACT_VERSION = 1;

const REQUIRED_SELECTION_MODES = [
  'entity',
  'source-type',
  'missing-only',
  'failed-only',
  'deferred-only',
  'unresolved-only',
  'rerun',
];

// Project-relative, forward-slashed. These are the paths the shared helpers actually write, so
// a descriptor that names something else describes an importer keeping a private ledger.
const REQUIRED_LEDGER_PATHS = {
  attempts: 'state/attempts/write-attempts.ndjson',
  sampleAttempts: 'state/sample/attempts/write-attempts.ndjson',
  unresolved: 'execution/unresolved-writes.ndjson',
  recoveryLog: 'execution/recovery-log.json',
};

// Throws naming EVERY missing mode and EVERY misplaced path at once. One error per run of the
// gate would turn a codegen fix into a guessing game.
function assertGeneratedImporterContract(descriptor) {
  const problems = [];
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new Error('generated importer contract: descriptor must be an object — an entrypoint that ignores --describe fails the gate, it never passes by default');
  }
  if (descriptor.contractVersion !== GENERATED_IMPORTER_CONTRACT_VERSION) {
    problems.push(`contractVersion must be ${GENERATED_IMPORTER_CONTRACT_VERSION}, got ${JSON.stringify(descriptor.contractVersion)}`);
  }
  if (descriptor.runIdSource !== 'process-start') {
    problems.push(`runIdSource must be "process-start", got ${JSON.stringify(descriptor.runIdSource)}`);
  }
  const modes = Array.isArray(descriptor.selectionModes) ? descriptor.selectionModes : null;
  if (!modes) {
    problems.push('selectionModes must be an array of mode names');
  } else {
    for (const mode of REQUIRED_SELECTION_MODES) {
      if (!modes.includes(mode)) {
        problems.push(`missing selection mode: ${mode}`);
      }
    }
  }
  const ledger = descriptor.ledger;
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    problems.push('ledger must be an object naming the durable artifact paths');
  } else {
    for (const [key, expected] of Object.entries(REQUIRED_LEDGER_PATHS)) {
      const actual = ledger[key];
      if (typeof actual !== 'string' || actual.replace(/\\/g, '/') !== expected) {
        problems.push(`ledger.${key} must be "${expected}", got ${JSON.stringify(actual)}`);
      }
    }
    // The vendoring escape hatch survives for the helper IMPLEMENTATIONS; it does not survive
    // for the entry contract, and an append-only ledger is part of that contract.
    if (ledger.appendOnly !== true) {
      problems.push('ledger.appendOnly must be true — a per-record log of what we wrote to a merchant store is only ever appended to');
    }
  }
  if (problems.length) {
    throw new Error(`generated importer contract violated:\n  - ${problems.join('\n  - ')}`);
  }
  return descriptor;
}

module.exports = {
  RECOVERY_SCHEMA_VERSION,
  RECOVERY_MODES,
  DEFERRED_ATTEMPT_STATUSES,
  UNCERTAIN_ATTEMPT_STATUSES,
  GENERATED_IMPORTER_CONTRACT_VERSION,
  REQUIRED_SELECTION_MODES,
  REQUIRED_LEDGER_PATHS,
  assertGeneratedImporterContract,
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
  // Exported so `completion-report.js`'s operator-action text and `website-handoff.js`'s
  // rendering can describe the same disagreements the writer computed, without recomputing them.
  coverageDisagreements,
  describeCoverageMismatch,
  COVERAGE_JOURNAL_REL_PATH,
};
