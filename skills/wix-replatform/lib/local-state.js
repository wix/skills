'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEMA_VERSION = 1;

// `process.kill(pid, 0)` throwing does not by itself mean the
// process is dead -- Node surfaces the same exception for ESRCH (no such process) and EPERM (a
// real, live process this user cannot signal, e.g. owned by a different UID on a shared
// sandbox). Only ESRCH means dead; only Node's own `error.code` is needed to tell the two apart,
// no filesystem check required. Shared with `execution-health-check.js`, which had its own
// independent copy of this exact check before round 5 consolidated them.
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

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
  // A record excluded by an accepted
  // out-of-scope rule (`entityCompleteness.skippedOutOfScope`) needs its own
  // terminal attempt-journal status alongside the other `skipped_*` outcomes below, or the
  // very first such row written to a project's real ledger makes `validateAttemptRow` throw
  // and poisons every future read of that append-only journal (`loadAttemptJournal`,
  // `readAttemptJournalSince`) for the rest of the project's life. Like its `skipped_*`
  // siblings, it makes no journal-count claim and is intentionally not a branch in
  // `coverageStatusCounts` (import-recovery.js) or `DEFERRED_ATTEMPT_STATUSES` below.
  'skipped_out_of_scope',
  // An in-scope record the runner skipped WITHOUT an accepted source-data rule.
  // Deliberately not `deferred` (an accepted, reasoned deferral) and in none of the deferred,
  // uncertain or failure-required sets: it was never sent, so recovery treats it as missing.
  'skipped_unexpected',
]);

// An UNRESOLVED outcome is a write whose result we do not know: it may or may
// not have landed on the merchant's store. Its next action is to READ THE TARGET BACK, never to
// re-send, so it is deliberately a different class from `failed` (re-attempt) and from
// `deferred` (reconsider when the blocker clears). Folding it into `failed` is how a recovery
// pass creates a duplicate on a live store.
//
// This is NOT import-recovery's UNCERTAIN_ATTEMPT_STATUSES, which additionally covers the
// deferred pair for a different question ("could a prior write already exist?").
const UNRESOLVED_ATTEMPT_STATUSES = new Set(['started', 'succeeded_unverified']);

// These statuses must carry a structured `failure` block, because for each of
// them the identifying facts are the whole value of the row. `started` is excluded on purpose:
// a `started` row is written BEFORE the outcome is known, so it has no facts to carry yet. It
// becomes unresolved only by dangling — by never getting a terminal follow-on row — which is a
// property of the journal, not of the row, and is resolved in the projection below.
const FAILURE_REQUIRED_STATUSES = new Set(['failed_retryable', 'failed_terminal', 'succeeded_unverified']);
const FAILURE_OUTCOMES = new Set(['failed_terminal', 'failed_retryable', 'unresolved']);
const PRODUCT_MEDIA_FAILURE_REASONS = new Set([
  'no-source-id',
  'no-source-record',
  'source-unreadable',
]);

// The outcome a given status must declare, so a row cannot say `failed_terminal` in one field
// and `unresolved` in the other.
const FAILURE_OUTCOME_FOR_STATUS = {
  failed_retryable: 'failed_retryable',
  failed_terminal: 'failed_terminal',
  succeeded_unverified: 'unresolved',
};

// The truncation rule made checkable. The defect this closes: a coupon failure
// kept the first 300 characters of the error message, and in every case the identifier of the
// thing that failed sat past the cut. A GUID is the identifier shape the target uses, it never
// occurs in ordinary prose, and so a GUID present in `failure.message` and nowhere else on the
// row is exactly the evidence-destroying pattern -- detectable with no heuristics.
const GUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// a message naming exactly one GUID is not always
// naming THIS row's own target -- Wix's own validator errors routinely echo back a REFERENCED
// entity's id while explaining why some OTHER entity's reference to it failed, e.g.
// `scope.group={name:product,entityId:<PRODUCT-GUID>} entityId not found` on a failed
// coupon-create. That message names exactly one distinct GUID, but it is the product the coupon
// referenced, not the coupon itself -- and the single-GUID auto-extraction below would have
// misattributed that product's id to the coupon row as its own targetEntityId. `scope.group=`
// and `entityId ... not found` are the two markers Wix's own foreign-reference-lookup failures use
// to describe an id that belongs to some OTHER record; when either appears, the message is
// self-evidently talking about a reference, not self-identifying, so this is treated the same as
// the already-handled two-distinct-GUIDs case -- leave targetEntityId unguessed.
//
// BUG FIX: the second alternative used to require the literal, ADJACENT
// substring "entityId not found" -- but Wix's actual documented error text for this exact case
// (domains/stores/entities/coupon.json, wix-writers.js:4148) is `entityId '<id>' not found`, with
// the referenced GUID quoted in between "entityId" and "not found". That real shape matched
// neither alternative, so a coupon-create failure carrying Wix's own documented wording still hit
// the single-GUID auto-extraction path and misattributed the referenced product's GUID to the
// coupon row -- the identical misattribution bug this guard exists to close, just via a phrasing
// the marker didn't cover. Broadened to `entityId\b.*not found`, which still requires "entityId"
// to actually appear before "not found" (so an unrelated, later "not found" elsewhere in a long
// message can't match on its own): confirmed against every "entityId ... not found" error shape
// documented in this repo (coupon.json, wix-writers.js) that this is the only live use of the
// phrase, always in the same foreign-reference-scope context, so widening it introduces no
// self-referential false positive.
// `.*` cannot span a newline, but `wix.send()` embeds up to 400
// raw response characters into `error.message` (see below), which can be a pretty-printed,
// multi-line 400 body. `[\s\S]*` matches the same "entityId ... not found" shape across an
// embedded newline, where a bare `.` would silently fail to match and let the single-GUID
// auto-extraction below misattribute a referenced entity's GUID as this row's own targetEntityId.
// BUG FIX: `entityId\b` has no boundary BEFORE "entityId", so it also
// matched inside a compound identifier like "targetEntityId" (e.g. "field targetEntityId is
// required but was not found..."), a false positive about the row's OWN record, not a foreign
// reference -- suppressing legitimate GUID auto-extraction for that row. The negative lookbehind
// requires "entityId" not be preceded by a letter, so it only matches as its own token.
const FOREIGN_REFERENCE_MARKER = /scope\.group\s*=|(?<![a-zA-Z])entityId\b[\s\S]*not found/i;

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

// A validation pass keeps its rows under a PARALLEL SUBTREE, not beside the real
// journal under a different filename. The dry-run crosswalk's sibling-filename convention is
// deliberately not followed here and is not changed by this: the property this buys is
// that a validation pass has no path to the real ledger at all, and a sibling filename leaves
// the real journal one string substitution away -- which is precisely how a record limit came
// to select a truncating open against the right path.
function sampleStateDir(projectDir) {
  return path.join(projectDir, 'state', 'sample');
}

function sampleAttemptJournalPath(projectDir) {
  return path.join(sampleStateDir(projectDir), 'attempts', 'write-attempts.ndjson');
}

// A derived re-read queue, rebuilt from the journal. It is a PROJECTION: deleting
// it loses nothing and it is never a source of truth.
function unresolvedWritesPath(projectDir) {
  return path.join(projectDir, 'execution', 'unresolved-writes.ndjson');
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

const crosswalkListeners = new Map();
async function crosswalkFileStamp(file) { try { const stat = await fs.stat(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; } catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; } }
function onCrosswalkChange(projectDir, listener) {
  const root = path.resolve(projectDir); if (!crosswalkListeners.has(root)) crosswalkListeners.set(root, new Set());
  crosswalkListeners.get(root).add(listener); return () => crosswalkListeners.get(root)?.delete(listener);
}
async function notifyCrosswalkChange(projectDir, event) { for (const listener of crosswalkListeners.get(path.resolve(projectDir)) || []) listener(event); }
function stampSite(projectDir, row) {
  const context = require('./execution-capability').projectContext(projectDir);
  if (context && row.siteId && row.siteId !== context.siteId) throw new Error('SITE_EVIDENCE_MISMATCH');
  return context ? { ...row, siteId: context.siteId } : row;
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
  if (row.siteId !== undefined && (typeof row.siteId !== 'string' || !row.siteId)) errors.push(`${label}.siteId must be a nonempty string`);
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
  // The version pair recorded from a CONFIRMED write, so a rerun can tell a
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

// Decides what a rerun does with one source record, given its crosswalk
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
  // Version IDs are opaque: compare as strings, never numerically or by recency.
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

  // Changing the comparison field/hash definition invalidates that baseline until
  // reconciled. A baseline captured from `date_modified_gmt` says nothing about a version now
  // read from a different field.
  if (baselineField && sourceVersionField && baselineField !== sourceVersionField) {
    return { ...base, action: 'unknown', reason: 'version_field_changed' };
  }
  // The same rule applies to the hash: changing the comparison field/hash definition
  // invalidates that baseline until reconciled. A hash computed over a different set of mapped
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

// The pair advances ONLY on a confirmed write. A failed, conflicted,
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
  // Preserve its exact value; do not increment it locally. An absent revision in the
  // response is not a reason to invent one, and not a reason to drop a known-good earlier one.
  const haveRevision = targetRevision !== undefined && targetRevision !== null && targetRevision !== '';
  if (haveRevision) {
    next.targetRevision = String(targetRevision);
  }
  // If the response lacks a revision, reconcile a readback with the expected written
  // values before establishing a baseline. Advancing the SOURCE version while keeping the OLD
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

// `runId` and `phase` join the required set. The
// asymmetry this closes: validateWixRequestCaptureRow and validateDryRunCrosswalkRow already
// require `runId`; the durable journal -- the one artifact a reader still has a year later --
// was the only one that did not. Without them, "how many records did this pass import" cannot
// be answered from the file at all, and every per-ROW count silently reads as a per-RECORD one.
//
// This array is the single source of truth for the documented required set: the codegen skill
// document is checked against it by tests/orchestration/runtime-contract-test.js, so a prose
// list cannot drift from the validator.
const ATTEMPT_REQUIRED_FIELDS = [
  'attemptId',
  'sourceStableKey',
  'writeSpecId',
  'operation',
  'targetEntityType',
  'status',
  'runId',
  'phase',
];

// A limited pass that writes for REAL is not a sample: its rows belong in the
// real journal, stamped like any other pass, and `selection` is what makes its scope legible.
function validateAttemptSelection(row, label, errors) {
  if (row.selection === undefined) {
    return;
  }
  const selection = row.selection;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    errors.push(`${label}.selection must be an object`);
    return;
  }
  for (const field of ['offset', 'limit']) {
    const value = selection[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (!Number.isInteger(value) || value < 0) {
      errors.push(`${label}.selection.${field} must be a non-negative integer or null`);
    }
  }
  if (selection.filters !== undefined && selection.filters !== null
    && (typeof selection.filters !== 'object' || Array.isArray(selection.filters))) {
    errors.push(`${label}.selection.filters must be an object`);
  }
}

// `reconcile` is the structured evidence an unknown-outcome recovery needs: the
// region and the ids that existed before the POST, plus any candidate ids found afterwards. Ids
// live here as fields, never only inside `failure.message`.
function validateAttemptReconcile(row, label, errors) {
  if (row.reconcile === undefined) {
    return;
  }
  const reconcile = row.reconcile;
  if (!reconcile || typeof reconcile !== 'object' || Array.isArray(reconcile)) {
    errors.push(`${label}.reconcile must be an object`);
    return;
  }
  if (reconcile.deliveryRegionId !== undefined && (typeof reconcile.deliveryRegionId !== 'string' || !reconcile.deliveryRegionId)) {
    errors.push(`${label}.reconcile.deliveryRegionId must be a non-empty string when present`);
  }
  for (const field of ['preWriteTargetIds', 'candidateTargetIds']) {
    const value = reconcile[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id))) {
      errors.push(`${label}.reconcile.${field} must be an array of non-empty strings when present`);
    }
  }
}

// A failure keeps its identifying facts as FIELDS; only the human sentence is
// ever shortened.
function validateAttemptFailure(row, label, errors) {
  const required = FAILURE_REQUIRED_STATUSES.has(row.status);
  if (row.failure === undefined || row.failure === null) {
    if (required) {
      errors.push(`${label}.failure is required when status is ${row.status} — a truncated sentence is not a record of what failed`);
    }
    return;
  }
  const failure = row.failure;
  const failureLabel = `${label}.failure`;
  if (typeof failure !== 'object' || Array.isArray(failure)) {
    errors.push(`${failureLabel} must be an object`);
    return;
  }
  for (const field of ['sourceId', 'operation']) {
    requireString(failure, field, failureLabel, errors);
  }
  if (typeof failure.message !== 'string') {
    errors.push(`${failureLabel}.message must be a string`);
  }
  if (!FAILURE_OUTCOMES.has(failure.outcome)) {
    errors.push(`${failureLabel}.outcome must be one of: ${Array.from(FAILURE_OUTCOMES).join(', ')}`);
  }
  if (failure.reason !== undefined && !PRODUCT_MEDIA_FAILURE_REASONS.has(failure.reason)) {
    errors.push(`${failureLabel}.reason must be one of: ${Array.from(PRODUCT_MEDIA_FAILURE_REASONS).join(', ')}`);
  }
  const expectedOutcome = FAILURE_OUTCOME_FOR_STATUS[row.status];
  if (expectedOutcome && failure.outcome && failure.outcome !== expectedOutcome) {
    errors.push(`${failureLabel}.outcome must be ${expectedOutcome} when status is ${row.status}`);
  }
  // Present-and-nullable: the KEY must exist, so "we looked and the request named none" is
  // distinguishable from "nobody extracted it". targetEntityId is the field the run lost inside
  // a 300-character slice, so its absence is an error rather than a default.
  for (const field of ['targetEntityId', 'errorCode', 'scopeGroupName']) {
    if (!(field in failure)) {
      errors.push(`${failureLabel}.${field} must be present (string or null)`);
    } else if (failure[field] !== null && typeof failure[field] !== 'string') {
      errors.push(`${failureLabel}.${field} must be a string or null`);
    }
  }
  if (!('httpStatus' in failure)) {
    errors.push(`${failureLabel}.httpStatus must be present (integer or null)`);
  } else if (failure.httpStatus !== null && !Number.isInteger(failure.httpStatus)) {
    errors.push(`${failureLabel}.httpStatus must be an integer or null`);
  }
  assertNoIdentifierOnlyInMessage(row, failureLabel, errors);
}

// The truncation rule, stated as a rule because it IS the defect: no identifier may
// exist only inside `failure.message`. Implementations extract the identifying fields from the
// error BEFORE shortening the message, never after — so a GUID that the message carries and no
// structured field repeats means the extraction was skipped and the evidence is one truncation
// away from being gone.
//
// this rule is about `failure.message` specifically,
// not about every field on the row -- `failure.originalMessage` (see `tolerateIdentifierOnlyMessage`
// below) is a DELIBERATE exception, not a gap in this check. It preserves the raw pre-redaction
// text for a human/later diagnosis pass in the ambiguous/foreign-reference case where
// `targetEntityId` is intentionally left unguessed (a wrong guess there is worse than none) -- it
// is not itself a structured, machine-actionable identifier field, so an identifier that exists
// ONLY in `originalMessage` still counts as "only in message-shaped text" for this rule's
// purpose, same as `failure.message` itself, and must be excluded from "elsewhere" below.
// (`originalMessage` is always the pre-redaction copy of `message`, so leaving it in "elsewhere"
// would also let it trivially self-corroborate -- the same text checked against itself is not
// independent evidence in a different field.) `assertNoIdentifierOnlyInMessage` is intentionally
// never called against `originalMessage` itself: this rule fires on the CURRENT `message`, and a
// redacted `message` (replaced with `<redacted-id>`) no longer carries a raw GUID to flag --
// exactly the truncation rule being satisfied, not bypassed, since the identifier no longer sits
// only in message-shaped text once it has been removed from `message` and structured extraction
// was attempted (`targetEntityId`, when unambiguous) or deliberately declined with the reason
// recorded (the foreign-reference/ambiguous comment above).
function assertNoIdentifierOnlyInMessage(row, failureLabel, errors) {
  const message = typeof row.failure.message === 'string' ? row.failure.message : '';
  const found = message.match(GUID_IN_TEXT);
  if (!found) {
    return;
  }
  const elsewhere = JSON.stringify({ ...row, failure: { ...row.failure, message: '', originalMessage: '' } }).toLowerCase();
  for (const guid of new Set(found.map((value) => value.toLowerCase()))) {
    if (!elsewhere.includes(guid)) {
      errors.push(`${failureLabel}.message carries identifier ${guid} that appears in no other field — extract identifying facts into fields before truncating the message`);
    }
  }
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
  if (row.siteId !== undefined && (typeof row.siteId !== 'string' || !row.siteId)) errors.push(`${label}.siteId must be a nonempty string`);
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of ATTEMPT_REQUIRED_FIELDS) {
    requireString(row, field, label, errors);
  }
  if (row.status && !ATTEMPT_STATUS.has(row.status)) {
    errors.push(`${label}.status must be one of: ${Array.from(ATTEMPT_STATUS).join(', ')}`);
  }
  if (row.deferral !== undefined && (row.status !== 'deferred' || !row.deferral || typeof row.deferral.reason !== 'string')) errors.push(`${label}.deferral invalid`);
  validateAttemptSelection(row, label, errors);
  validateAttemptFailure(row, label, errors);
  validateAttemptReconcile(row, label, errors);
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

// assertNoIdentifierOnlyInMessage above
// is deliberate and correct: an identifier that exists ONLY inside `failure.message` really is
// undocumented evidence on that row, and this function must never weaken that guard. But
// `wix.send()` (rp-target-wix/lib/wix-writers.js) embeds the full request URL and up to 400 raw
// response characters into `error.message`, so a genuine Wix API error can legitimately echo
// back some entity's GUID that the caller never thought to extract into a structured field --
// and a validator rejection at write time must never crash the whole import run over message
// phrasing. In the incident, a project's own catch-all recovery path then tried to log a SECOND
// attempt row built from the validation error's own message -- which still carried the same
// GUID -- and THAT rejection was uncaught, which is what actually took the run down.
//
// The fix, ported from that project's local `recordAttemptGuarded` wrapper into the one place
// every generated importer already goes through: on exactly this rejection, extract the GUID
// into a real structured field when that's unambiguous, and EITHER WAY keep the original message
// on the row (never just delete it) before retrying once. A row that is broken for any OTHER
// reason -- the GUID is embedded a second way with no single unambiguous target, or unrelated
// fields are missing/invalid -- still throws, from the retry's own validateAttemptRow call, so a
// genuinely different caller bug is never silently swallowed.
//
// Two failure modes this must not reintroduce, both found in review after the redact-only version
// shipped: (1) redacting `failure.message` in place and discarding the original text loses the
// only surviving evidence of what the identifier actually was, with nothing on the row saying a
// redaction even happened -- exactly the truncation-without-extraction defect
// assertNoIdentifierOnlyInMessage exists to catch, just moved one step later. (2) this must run on
// READ as well as write: a row already on disk before this function existed (or written by some
// other path) fails the same validator on every future `loadAttemptJournal` call, which
// `markAttempt` depends on to find the row it is patching -- one bad historical row would
// otherwise wedge every future read of an append-only journal that is never rewritten or trimmed.
function tolerateIdentifierOnlyMessage(row) {
  const validation = validateAttemptRow(row, { allowThrow: false });
  if (validation.ok) {
    return { ok: true, row };
  }
  const carriesUnredactedIdentifier = row && row.failure && typeof row.failure.message === 'string'
    && validation.errors.some((error) => error.includes('appears in no other field'));
  if (!carriesUnredactedIdentifier) {
    return { ok: false, errors: validation.errors };
  }
  const originalMessage = row.failure.message;
  const found = originalMessage.match(GUID_IN_TEXT) || [];
  const distinctGuids = Array.from(new Set(found.map((value) => value.toLowerCase())));
  const patchedFailure = { ...row.failure };
  // Prefer real structured extraction over redact-and-hide: if targetEntityId is explicitly null
  // (present, "we looked and there was none yet") and the message names exactly one candidate
  // GUID, that GUID is almost certainly the record the message is about -- put it where
  // assertNoIdentifierOnlyInMessage always wanted it. Two or more distinct GUIDs, an already-set
  // targetEntityId naming something else, or the KEY BEING ABSENT ENTIRELY are all left alone:
  // a missing key (as opposed to an explicit null) is its own caller bug -- "nobody populated
  // this field at all" -- and synthesizing one from the message text would silently paper over
  // that, not fix it; the row still throws below with the real "targetEntityId must be present"
  // error in that case. A single GUID corroborated as a FOREIGN reference (see
  // FOREIGN_REFERENCE_MARKER above) is left unguessed for the same reason two distinct GUIDs are:
  // "unambiguous" here has to mean "unambiguously THIS row's own record", not merely "only one
  // GUID appears in the text" -- a message can name exactly one GUID and still be talking about
  // someone else's identity entirely.
  if (
    'targetEntityId' in patchedFailure && patchedFailure.targetEntityId === null
    && distinctGuids.length === 1 && !FOREIGN_REFERENCE_MARKER.test(originalMessage)
  ) {
    patchedFailure.targetEntityId = found[0];
  }
  // Whichever way that went, never destroy the original text: keep it in its own field so a
  // human or a later diagnosis pass can still see exactly what the source system said, and so
  // `assertNoIdentifierOnlyInMessage`'s own "does this identifier appear anywhere else on the
  // row" check (which this redaction must still satisfy) finds it there rather than nowhere.
  patchedFailure.message = originalMessage.replace(GUID_IN_TEXT, '<redacted-id>');
  patchedFailure.originalMessage = originalMessage;
  const redactedRow = { ...row, failure: patchedFailure };
  const revalidation = validateAttemptRow(redactedRow, { allowThrow: false });
  if (!revalidation.ok) {
    return { ok: false, errors: revalidation.errors };
  }
  return { ok: true, row: redactedRow };
}

function withIdentifierRedactionRetry(row) {
  const result = tolerateIdentifierOnlyMessage(row);
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.row;
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
  if (row.siteId !== undefined && (typeof row.siteId !== 'string' || !row.siteId)) errors.push(`${label}.siteId must be a nonempty string`);
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
  if (row.siteId !== undefined && (typeof row.siteId !== 'string' || !row.siteId)) errors.push(`${label}.siteId must be a nonempty string`);
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
  if (row.siteId !== undefined && (typeof row.siteId !== 'string' || !row.siteId)) errors.push(`${label}.siteId must be a nonempty string`);
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
  if (row.siteId !== undefined && (typeof row.siteId !== 'string' || !row.siteId)) errors.push(`${label}.siteId must be a nonempty string`);
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
  row = stampSite(projectDir, row);
  validateCrosswalkRow(row);
  const before = await crosswalkFileStamp(crosswalkPath(projectDir));
  await appendNdjson(crosswalkPath(projectDir), row);
  await notifyCrosswalkChange(projectDir, { updates: [row], remove: [], before, after: await crosswalkFileStamp(crosswalkPath(projectDir)), dryRun: false });
  return row;
}

async function updateCrosswalkRows(projectDir, updates, { remove = [] } = {}) {
  updates = updates.map(row => stampSite(projectDir, row));
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
  const before = await crosswalkFileStamp(crosswalkPath(projectDir));
  const current = await loadCrosswalk(projectDir);
  for (const key of remove) delete current.bySource[key];
  for (const row of updates) current.bySource[row.sourceStableKey] = row;
  const rows = Object.values(current.bySource).sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey));
  await writeTextAtomic(crosswalkPath(projectDir), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  await rebuildCrosswalkIndexes(projectDir);
  await notifyCrosswalkChange(projectDir, { updates, remove, before, after: await crosswalkFileStamp(crosswalkPath(projectDir)), dryRun: false });
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

// The ONLY discriminator between the real ledger and the sample one is whether
// live writes occur — never whether a record limit is set. A caller passes `{ sample: true }`
// for a pass that writes nothing to the merchant's store; everything else, including a limited
// but real pass, lands in the real journal.
function attemptJournalPathFor(projectDir, { sample = false } = {}) {
  return sample ? sampleAttemptJournalPath(projectDir) : attemptJournalPath(projectDir);
}

async function loadAttemptJournal(projectDir, options = {}) {
  const raw = await readNdjson(attemptJournalPathFor(projectDir, options));
  // Tolerate the identifier-only-in-message class on READ too, the same way `appendAttempt`/
  // `markAttempt` already tolerate it on write -- a row written before this validator existed
  // (or by any path other than those two) must not wedge every future read of a journal that is
  // never rewritten or trimmed. Any OTHER validation failure still throws, unchanged.
  const rows = raw.map((row) => {
    const result = tolerateIdentifierOnlyMessage(row);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
    return result.row;
  });
  return { rows, byAttemptId: foldAttempts(rows) };
}

// Reads only the bytes appended since `offset`, validating each new row the same
// way `loadAttemptJournal` does (including the identifier-only-message tolerance), so a per-flush
// coverage check can stay cheap without re-parsing the whole journal every time. Scoped to the
// LIVE journal only -- never the sample one; the coverage check this exists for never reads
// the sample journal. Throws a typed error (`error.code`) the caller maps onto the coverage check's reasons:
// `JOURNAL_MISSING` (ENOENT), `JOURNAL_READ_FAILED` (any other read failure), or `JOURNAL_INVALID`
// (a complete line that is not JSON, or fails `validateAttemptRow`/its identifier-only tolerance).
async function readAttemptJournalSince(projectDir, offset = 0) {
  const filePath = attemptJournalPath(projectDir);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const err = new Error(`${filePath} does not exist`);
      err.code = 'JOURNAL_MISSING';
      throw err;
    }
    const err = new Error(error.message);
    err.code = 'JOURNAL_READ_FAILED';
    err.cause = error;
    throw err;
  }
  // A journal shorter than the cached offset was truncated or replaced underneath the cache: the
  // caller must drop whatever it folded so far and do one full read, never read a negative range.
  const truncated = stat.size < offset;
  const readFrom = truncated ? 0 : offset;
  const length = stat.size - readFrom;
  let text = '';
  if (length > 0) {
    let fh = null;
    try {
      fh = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(length);
      await fh.read(buffer, 0, length, readFrom);
      text = buffer.toString('utf8');
    } catch (error) {
      const err = new Error(error.message);
      err.code = 'JOURNAL_READ_FAILED';
      err.cause = error;
      throw err;
    } finally {
      if (fh) {
        await fh.close();
      }
    }
  }
  // A partial trailing line -- the writer appended only part of the next row -- is left for the
  // next read and never parsed as if it were complete.
  const lastNewline = text.lastIndexOf('\n');
  const completeText = lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
  const nextOffset = readFrom + Buffer.byteLength(completeText, 'utf8');
  const rows = [];
  if (completeText) {
    for (const rawLine of completeText.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        const err = new Error(`${filePath}: invalid NDJSON: ${error.message}`);
        err.code = 'JOURNAL_INVALID';
        err.line = line;
        throw err;
      }
      const result = tolerateIdentifierOnlyMessage(parsed);
      if (!result.ok) {
        const err = new Error(result.errors.join('; '));
        err.code = 'JOURNAL_INVALID';
        err.line = line;
        throw err;
      }
      rows.push(result.row);
    }
  }
  return { rows, nextOffset, size: stat.size, truncated };
}

// Append only. `appendNdjson` (-> fs.appendFile) is the only writer, and there is no flag, env
// var or mode that selects a truncating open against this path. Rotation and compaction are not
// permitted: a journal is never rewritten, folded in place, or trimmed.
async function appendAttempt(projectDir, row, options = {}) {
  row = stampSite(projectDir, row);
  const toWrite = withIdentifierRedactionRetry(row);
  await appendNdjson(attemptJournalPathFor(projectDir, options), toWrite);
  return toWrite;
}

// Latest row per source record, in file order. This is the fold that turns a
// per-ROW file into per-RECORD counts; grouping the same rows by `runId` gives the per-PASS
// counts instead. Both are derivable from the journal alone, which is the point.
function foldAttemptsBySourceKey(rows) {
  const bySource = new Map();
  for (const row of rows) {
    if (row && row.sourceStableKey) {
      bySource.set(row.sourceStableKey, row);
    }
  }
  return bySource;
}

// Rebuild `execution/unresolved-writes.ndjson` from the journal. Deleting this
// file loses nothing — it is a projection, never a source of truth — so it is rewritten whole
// and deterministically, and rebuilding it reproduces it byte for byte.
//
// A `deferred` row is NOT unresolved. Its next action is "reconsider once the blocker clears",
// not "read the target back", and a source-data-rule skip must never reach this queue.
async function rebuildUnresolvedWrites(projectDir) {
  const { rows } = await loadAttemptJournal(projectDir);
  const latest = foldAttemptsBySourceKey(rows);
  const queue = [];
  for (const row of latest.values()) {
    if (!UNRESOLVED_ATTEMPT_STATUSES.has(row.status)) {
      continue;
    }
    queue.push({
      schemaVersion: SCHEMA_VERSION,
      sourceStableKey: row.sourceStableKey,
      attemptId: row.attemptId,
      runId: row.runId,
      phase: row.phase,
      operation: row.operation,
      targetEntityType: row.targetEntityType,
      status: row.status,
      nextAction: 'read_target_back',
      failure: row.failure === undefined ? null : row.failure,
    });
  }
  queue.sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey));
  const text = queue.map((row) => JSON.stringify(row)).join('\n') + (queue.length ? '\n' : '');
  await writeTextAtomic(unresolvedWritesPath(projectDir), text);
  return queue;
}

async function loadUnresolvedWrites(projectDir) {
  return readNdjson(unresolvedWritesPath(projectDir));
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

async function markAttempt(projectDir, attemptId, patch, options = {}) {
  if (!attemptId || typeof attemptId !== 'string') {
    throw new Error('attemptId must be a non-empty string');
  }
  assertObject(patch, 'attempt patch');
  const journal = await loadAttemptJournal(projectDir, options);
  const current = journal.byAttemptId[attemptId];
  if (!current) {
    throw new Error(`unknown attemptId: ${attemptId}`);
  }
  // The follow-on row carries the `runId` and `phase` of the run APPENDING it,
  // which may differ from the row it supersedes. That is the point — it is how a later pass's
  // confirmation of an earlier pass's write stays legible.
  const row = {
    ...current,
    ...patch,
    attemptId,
  };
  const toWrite = withIdentifierRedactionRetry(row);
  await appendNdjson(attemptJournalPathFor(projectDir, options), toWrite);
  return toWrite;
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

// The READ side of the crosswalk, and the single place a ledger row becomes
// CMS-mirror item input. It lives here, once, rather than being re-derived inside every
// generated project, because that is the seam that makes the mirror's item shape enforceable
// instead of advisory.
//
// It is NOT a pass-through, and handing a raw ledger row to `buildImportCrosswalkItem` is a bug,
// not a shortcut: the ledger names the fields `sourceEntityType`/`targetEntityType`, while
// `buildImportCrosswalkItem` requires `entityType`/`targetType` and throws
// 'buildImportCrosswalkItem: entityType and sourceId are required' without the first of them.
//
// It deliberately composes NO id. The mirror item id is `buildImportCrosswalkItem`'s own
// `sourceStableKey`, with no project or source-instance prefix -- see the KNOWN, UNRESOLVED
// LIMITATION comment on `buildImportCrosswalkItem` in rp-target-wix/lib/wix-writers.js. That cross-project collision is left open on purpose; it needs an approved identity/schema
// decision of its own, not a prefix invented inside a writer or a projection.
//
// Layering: this module must not require rp-target-wix, so it returns the INPUTS
// `buildImportCrosswalkItem` takes, and the caller does the build.
function crosswalkRowsToMirrorItemInputs(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('crosswalkRowsToMirrorItemInputs: rows must be an array of crosswalk rows');
  }
  return rows.map((row, i) => {
    assertObject(row, `crosswalk row ${i}`);
    return {
      entityType: row.sourceEntityType,
      sourceId: row.sourceId,
      sourceStableKey: row.sourceStableKey,
      targetId: row.targetId,
      targetType: row.targetEntityType,
      updatedAt: row.updatedAt,
    };
  });
}

async function withStateLock(projectDir, fn, { script } = {}) {
  const lockPath = path.join(stateDir(projectDir), '.lock');
  await mkdirp(lockPath);
  const host = Buffer.from(require('node:os').hostname()).toString('base64url');
  // Unique claim files avoid deleting/replacing a directory another runner just acquired.
  // Publish the claim before scanning. Concurrent entrants see each other and at least
  // one backs off; a process that starts later always sees the active owner's claim.
  const claim = `${host}.${process.pid}.${require('node:crypto').randomUUID()}.owner`;
  const claimPath = path.join(lockPath, claim);
  // the claim used to carry only pid/host/acquiredAt, with no
  // record of WHICH script/writer acquired it. execution-health-check.js's hasLiveLocalProcess
  // trusted ANY live claim in the project as proof that the specific `--script` it was asked
  // about was alive -- a genuinely crashed run-import.js could be reported healthy merely because
  // an unrelated concurrent writer (e.g. run-extract.js) held its own live claim in the same
  // project. An explicit `script` identifies the claim; a caller that already knows its own
  // identity may pass it, and every current caller (product-import.js, contact-import.js) is
  // itself invoked from whichever file node is actually running as a script -- `process.argv[1]`
  // -- so that is the correct default with no call-site changes required.
  const scriptId = script || process.argv[1] || null;
  await fs.writeFile(claimPath, JSON.stringify({ pid: process.pid, host, acquiredAt: new Date().toISOString(), script: scriptId }), { flag: 'wx', mode: 0o600 });
  try {
    for (const entry of await fs.readdir(lockPath)) {
      if (entry === claim) continue;
      const match = /^([^.]+)\.(\d+)\.[a-f0-9-]+\.owner$/.exec(entry);
      if (!match || match[1] !== host) throw new Error(`state lock owner cannot be checked locally: ${path.join(lockPath, entry)}; confirm that importer is stopped before removing its claim`);
      // `kill(2)` errors are EINVAL/EPERM/ESRCH only -- never ENOENT -- so the shared
      // `isProcessAlive` correctly folds every other-than-EPERM error into "dead" here.
      if (!isProcessAlive(Number(match[2]))) { await fs.rm(path.join(lockPath, entry), { force: true }); continue; }
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
  onCrosswalkChange,
  SCHEMA_VERSION,
  stateDir,
  crosswalkPath,
  attemptJournalPath,
  sampleStateDir,
  sampleAttemptJournalPath,
  unresolvedWritesPath,
  ATTEMPT_STATUS,
  ATTEMPT_REQUIRED_FIELDS,
  UNRESOLVED_ATTEMPT_STATUSES,
  FAILURE_REQUIRED_STATUSES,
  foldAttemptsBySourceKey,
  rebuildUnresolvedWrites,
  loadUnresolvedWrites,
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
  readAttemptJournalSince,
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
  crosswalkRowsToMirrorItemInputs,
  withStateLock,
  isProcessAlive,
};
