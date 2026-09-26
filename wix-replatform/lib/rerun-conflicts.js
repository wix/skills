'use strict';

// Spec 0140 §3/§4 and A.3 — what happens when a rerun's update collides with a change somebody
// made in Wix since the previous import.
//
// The whole point of this module is that it CANNOT resolve a conflict on its own. There is no
// "fetch the latest revision and retry" function here, deliberately: that is the one behaviour
// the spec forbids outright, because it silently overwrites a merchant's own edit with source
// data and leaves no trace that a decision was ever made. Every path out of a conflict runs
// through a recorded user answer, including in one-click mode.

const crypto = require('node:crypto');

// A.3: "Do not label every HTTP 409 or validation/auth error a revision conflict." A 409 on this
// platform also means ALREADY_EXISTS (product tags) and other non-revision states, so the code
// is what classifies, not the status.
//
// ONLY live-observed codes belong here. `INVALID_REVISION` is the one this repo has actually
// seen: spec 0065 recorded a real 409 INVALID_REVISION from addDeliveryRegion on a stale
// delivery-profile revision, and wix-writers.js:2859 documents it. Codes for Products v3 and
// Contacts v5 conflicts have NOT been observed, so they are deliberately absent rather than
// guessed — a guessed allowlist is untestable (every test would feed it a code it already
// contains) and silently downgrades a real conflict to an ordinary failure.
//
// Two things make an incomplete list safe rather than catastrophic:
//   1. `revisionConflictCodes` is injectable, so the entity's declared classification (A.3:
//      "The accepted mapping declares ... conflict-error classification per entity") drives it.
//   2. An UNRECOGNIZED failure on a revision-carrying update is classified
//      `possible_revision_conflict`, never `other`. It goes to a human instead of being
//      swallowed. That is the fail-safe for exactly the case a test cannot predict.
const OBSERVED_REVISION_CONFLICT_CODES = new Set(['INVALID_REVISION']);

// Kept as the historical export name; now sourced from the observed set only.
const REVISION_CONFLICT_CODES = OBSERVED_REVISION_CONFLICT_CODES;

const CONFLICT_CHOICES = new Set(['override', 'keep']);

// Spec 0140 §5 and A.3 — enforcement, not documentation. "Each entity needs a verified update
// operation and conflict protection; if either is unavailable, report the changed record for
// review rather than overwriting it through its create/import operation."
//
// Orders are named explicitly because the failure mode is silent data loss, and the spec's own
// A.5 evidence recorded it: Update Order exposes a restricted field set with no general revision
// parameter, and re-sending Import Order with the same id REPLACES the whole body, clearing
// omitted fields. A future importer must not be able to route a changed order through this flow
// just because the prose said not to.
const UPDATE_DENIED_ENTITIES = new Map([
  ['ecom/order', 'Update Order exposes a restricted field set and no general revision parameter, and a same-id Import Order is an unguarded whole-body replacement that clears omitted fields (spec 0140 A.5). Report the changed order for review.'],
  ['ecom/order-line-item', 'Written through the parent order, which has no revision-protected update path.'],
  ['ecom/order-line-item-options', 'Written through the parent order, which has no revision-protected update path.'],
  ['ecom/order-applied-discount', 'Written through the parent order, which has no revision-protected update path.'],
  ['ecom/order-merchant-note', 'Written through the parent order, which has no revision-protected update path.'],
  ['ecom/order-refund', 'Written through the parent order, which has no revision-protected update path.'],
]);

// `declaredUpdateWriters` comes from the accepted mapping: { 'stores/product': { writerId,
// revisionParam } }. An entity absent from it has no verified update path as far as this run is
// concerned, which is a review outcome — never a create/import fallback.
function updateSupportFor(entityRef, { declaredUpdateWriters = {} } = {}) {
  if (!entityRef || typeof entityRef !== 'string') {
    return { supported: false, action: 'report_for_review', reason: 'no_entity_ref' };
  }
  if (UPDATE_DENIED_ENTITIES.has(entityRef)) {
    return {
      supported: false,
      action: 'report_for_review',
      reason: 'update_path_unsafe_for_entity',
      detail: UPDATE_DENIED_ENTITIES.get(entityRef),
      neverFallBackToCreate: true,
    };
  }
  const declared = declaredUpdateWriters[entityRef];
  if (!declared || !declared.writerId) {
    return { supported: false, action: 'report_for_review', reason: 'no_verified_update_writer' };
  }
  if (!declared.revisionParam) {
    // A verified writer with no revision parameter has no conflict protection, which the spec
    // requires alongside the writer itself.
    return { supported: false, action: 'report_for_review', reason: 'no_conflict_protection' };
  }
  return {
    supported: true,
    action: 'update',
    writerId: declared.writerId,
    revisionParam: declared.revisionParam,
  };
}

function errorCodeOf(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const details = error.details || (error.body && error.body.details) || {};
  const applicationError = details.applicationError || {};
  return (
    applicationError.code
    || error.code
    || (error.body && error.body.code)
    || null
  );
}

function httpStatusOf(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return error.status ?? error.httpStatus ?? error.statusCode ?? null;
}

// Returns the classification only — never a remedy.
//
// `entityConflictCodes` lets the accepted mapping declare this entity's real conflict codes
// (A.3). `sentRevision` says whether the failed call actually carried a revision: when it did,
// an unrecognized failure that could plausibly be a concurrency error becomes
// `possible_revision_conflict` and goes to a human, because classifying it `other` would skip
// the override/keep flow that is this spec's whole point.
function classifyUpdateError(error, { entityConflictCodes = null, sentRevision = false } = {}) {
  const code = errorCodeOf(error);
  const status = httpStatusOf(error);
  const upper = code ? String(code).toUpperCase() : null;
  const known = new Set([
    ...OBSERVED_REVISION_CONFLICT_CODES,
    ...(Array.isArray(entityConflictCodes) ? entityConflictCodes.map((c) => String(c).toUpperCase()) : []),
  ]);
  if (upper && known.has(upper)) {
    return { kind: 'revision_conflict', code, httpStatus: status, matchedBy: OBSERVED_REVISION_CONFLICT_CODES.has(upper) ? 'observed' : 'declared' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', code, httpStatus: status };
  }
  if (status === 404) {
    return { kind: 'not_found', code, httpStatus: status };
  }
  // A 409 on a revision-carrying update is the ambiguous case the allowlist cannot settle. It is
  // NOT auto-treated as a conflict (that would let a real ALREADY_EXISTS drive an override), and
  // NOT dropped to `other` either. It is surfaced for review with its real code intact.
  if (status === 409 && sentRevision) {
    return {
      kind: 'possible_revision_conflict',
      code,
      httpStatus: status,
      needsHumanClassification: true,
      note: 'A 409 on a revision-carrying update whose code is not in the observed or declared conflict list. Do not auto-retry; classify it, then add the code to the entity\'s declared conflict codes.',
    };
  }
  if (status === 400 || status === 422 || status === 428) {
    return { kind: 'validation', code, httpStatus: status };
  }
  // Everything else keeps its real API error and stays an ordinary failure.
  return { kind: 'other', code, httpStatus: status };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fingerprint(parts) {
  return crypto.createHash('sha256').update(stableStringify(parts)).digest('hex').slice(0, 32);
}

// §3: what the user is shown. Identity, the real error, both revisions, the source version, and
// the fields that would change — including whole-array replacements, which are the ones most
// likely to destroy Wix-only data (A.3: "For Products, arrays require complete intended
// contents").
function buildConflictReview({
  sourceStableKey,
  targetId,
  entity,
  error,
  savedTargetRevision = null,
  currentTargetRevision = null,
  sourceVersion = null,
  sourceHash = null,
  proposedFields = {},
  currentTargetValues = {},
  entityConflictCodes = null,
  sentRevision = true,
} = {}) {
  if (!sourceStableKey || !targetId) {
    throw new Error('buildConflictReview: sourceStableKey and targetId are required');
  }
  // A review is only ever built for a call that carried a revision, so sentRevision defaults true.
  const classification = classifyUpdateError(error, { entityConflictCodes, sentRevision });
  const changes = [];
  for (const key of Object.keys(proposedFields).sort()) {
    const to = proposedFields[key];
    const from = currentTargetValues[key];
    const replacesArray = Array.isArray(to);
    if (stableStringify(from) === stableStringify(to)) {
      continue;
    }
    changes.push({
      field: key,
      currentWixValue: from,
      proposedValue: to,
      // Flagged because an array write is a replacement, not a merge: anything present in Wix
      // and absent from `to` disappears.
      replacesEntireArray: replacesArray,
    });
  }
  const review = {
    entity: entity || null,
    sourceStableKey,
    targetId,
    classification,
    error: {
      code: classification.code,
      httpStatus: classification.httpStatus,
      message: (error && (error.message || error.msg)) || null,
    },
    savedTargetRevision: savedTargetRevision || null,
    reviewedTargetRevision: currentTargetRevision || null,
    sourceVersion: sourceVersion ?? null,
    sourceHash: sourceHash ?? null,
    changes,
    // A.3: approval binds to the source values, the proposed writes AND the reviewed Wix
    // revision together. Any of the three moving invalidates it.
    bindingFingerprint: fingerprint({
      sourceStableKey,
      targetId,
      sourceVersion: sourceVersion ?? null,
      sourceHash: sourceHash ?? null,
      proposedFields,
      reviewedTargetRevision: currentTargetRevision || null,
    }),
  };
  return review;
}

// §3/§4: record the user's answer. `choice` is asked once for the presented record, never per
// field. No answer at all is not modelled here on purpose — an unanswered conflict stays
// unresolved, which is the absence of a record rather than a third choice.
function recordConflictDecision({ review, choice, decidedBy = null, decidedAt = null } = {}) {
  if (!review || !review.bindingFingerprint) {
    throw new Error('recordConflictDecision: a review from buildConflictReview is required');
  }
  if (!CONFLICT_CHOICES.has(choice)) {
    throw new Error(`recordConflictDecision: choice must be one of ${Array.from(CONFLICT_CHOICES).join(', ')}`);
  }
  return {
    kind: 'rerun_conflict_decision',
    choice,
    sourceStableKey: review.sourceStableKey,
    targetId: review.targetId,
    entity: review.entity,
    sourceVersion: review.sourceVersion,
    sourceHash: review.sourceHash,
    reviewedTargetRevision: review.reviewedTargetRevision,
    bindingFingerprint: review.bindingFingerprint,
    decidedBy: decidedBy || null,
    decidedAt: decidedAt || null,
  };
}

// §4: an approval authorizes exactly the write that was reviewed. Re-checked immediately before
// the retry — if the source changed again, or Wix moved again, or the proposed body differs, the
// answer no longer applies and the user is asked again.
function approvalApplies({ decision, review } = {}) {
  if (!decision || !review) {
    return { applies: false, reason: 'missing_decision_or_review' };
  }
  if (decision.sourceStableKey !== review.sourceStableKey || decision.targetId !== review.targetId) {
    return { applies: false, reason: 'different_record' };
  }
  if (decision.bindingFingerprint !== review.bindingFingerprint) {
    return { applies: false, reason: 'reviewed_state_changed' };
  }
  return { applies: true, reason: 'binding_matches', choice: decision.choice };
}

// §4: the override write plan. It uses the revision the user actually reviewed — never an
// omitted revision, and never a freshly fetched one the user never saw.
function buildOverrideWritePlan({ decision, review } = {}) {
  const check = approvalApplies({ decision, review });
  if (!check.applies) {
    return { ok: false, reason: check.reason, askAgain: true };
  }
  if (decision.choice !== 'override') {
    return { ok: false, reason: 'not_an_override_decision', askAgain: false };
  }
  if (!review.reviewedTargetRevision) {
    // Without a reviewed revision there is nothing to write against, and omitting the revision
    // is exactly the unguarded overwrite A.3 forbids.
    return { ok: false, reason: 'no_reviewed_revision', askAgain: true };
  }
  return {
    ok: true,
    targetId: review.targetId,
    revision: review.reviewedTargetRevision,
    fields: review.changes.reduce((acc, change) => {
      acc[change.field] = change.proposedValue;
      return acc;
    }, {}),
  };
}

// §4/A.3: a keep-Wix answer is remembered against the exact source change and the exact Wix
// state that were reviewed — and it lives in the recovery log, NOT as a crosswalk baseline,
// because the source version was never applied to Wix. Reusing it more broadly would silently
// swallow a later, different change.
function keepDecisionApplies({ decision, sourceVersion = null, sourceHash = null, currentTargetRevision = null } = {}) {
  if (!decision || decision.choice !== 'keep') {
    return { applies: false, reason: 'not_a_keep_decision' };
  }
  const sameSourceChange = stableStringify(decision.sourceVersion ?? null) === stableStringify(sourceVersion ?? null)
    && stableStringify(decision.sourceHash ?? null) === stableStringify(sourceHash ?? null);
  if (!sameSourceChange) {
    return { applies: false, reason: 'new_source_change' };
  }
  if (stableStringify(decision.reviewedTargetRevision ?? null) !== stableStringify(currentTargetRevision ?? null)) {
    return { applies: false, reason: 'wix_changed_again' };
  }
  return { applies: true, reason: 'same_source_change_and_wix_state' };
}

module.exports = {
  REVISION_CONFLICT_CODES,
  OBSERVED_REVISION_CONFLICT_CODES,
  UPDATE_DENIED_ENTITIES,
  updateSupportFor,
  CONFLICT_CHOICES,
  classifyUpdateError,
  buildConflictReview,
  recordConflictDecision,
  approvalApplies,
  buildOverrideWritePlan,
  keepDecisionApplies,
};
