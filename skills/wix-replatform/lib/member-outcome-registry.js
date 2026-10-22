'use strict';

// Every outcome and finding code the member pass can produce, and what each one means for the
// journal, the completion report, recovery and telemetry -- in one frozen place.
//
// The writer (rp-target-wix ensureMember), the contact builder (customer-member.js), the
// projection (member-completion.js) and the tests all import these constants. A code the writer
// can return and this file does not know is a record the report has nowhere to put, which is how
// a customer finishes a migration without a login and nothing says so. Same rule as
// payments-outcome-registry.js: both sides import one list, so neither can drift from the other.

// Primary outcomes: exactly one per customer handed to the member pass. They partition the
// population, so a new reason belongs HERE rather than folded into an existing bucket.
const MEMBER_OUTCOME = Object.freeze({
  WRITTEN: 'member-written',
  RECONCILED_EXISTING: 'member-reconciled-existing',
  NOT_WRITTEN_NO_EMAIL: 'member-not-written-no-email',
  RECONCILIATION_AMBIGUOUS: 'member-reconciliation-ambiguous',
  TARGET_READ_FAILED: 'member-target-read-failed',
  ALREADY_EXISTS_UNRECONCILED: 'member-already-exists-unreconciled',
  FAILED: 'member-failed',
});
const MEMBER_OUTCOMES = Object.freeze(Object.values(MEMBER_OUTCOME));

// Supplemental findings: zero or more per customer. They never change the primary outcome.
const MEMBER_FINDING = Object.freeze({
  PHONE_NOT_NORMALIZED: 'member-phone-not-normalized',
  PHONE_COLLISION_DROPPED: 'member-phone-collision-dropped',
  CREATE_RETRIED: 'member-create-retried-after-transient-error',
  CROSSWALK_ROW_STALE: 'member-crosswalk-row-stale',
});
const MEMBER_FINDINGS = Object.freeze(Object.values(MEMBER_FINDING));

// Where the member pass's journal rows live and what they are called. The projection folds only
// rows carrying both, so a customer key another entity also uses cannot bleed into the members row.
const MEMBER_TARGET_ENTITY_TYPE = 'members/member';
const MEMBER_OPERATION = 'ensure-member';
const MEMBER_ENTITY = 'members';

// The completion buckets a class can land in (the completion partition plus the unresolved counter).
const PROJECTION = Object.freeze({
  IMPORTED: 'imported',
  ALREADY_PRESENT: 'alreadyPresentByCrosswalk',
  DEFERRED: 'deferred',
  FAILED: 'failed',
  UNRESOLVED: 'unresolved',
});

// A primary outcome splits into a policy CLASS when one outcome code needs two treatments: a
// reconciliation by crosswalk versus by login email, and a member-failed that was definitely
// rejected versus one whose result is unknown. Each class has exactly one row.
const POLICY = Object.freeze({
  written: Object.freeze({
    outcome: MEMBER_OUTCOME.WRITTEN,
    journalStatus: 'imported',
    failureOutcome: null,
    projection: PROJECTION.IMPORTED,
    nextAction: null,
    selection: null,
    telemetry: null,
  }),
  'reconciled-crosswalk': Object.freeze({
    outcome: MEMBER_OUTCOME.RECONCILED_EXISTING,
    matchedBy: 'crosswalk',
    journalStatus: 'skipped_already_imported',
    failureOutcome: null,
    projection: PROJECTION.ALREADY_PRESENT,
    nextAction: null,
    selection: null,
    telemetry: null,
  }),
  'reconciled-login-email': Object.freeze({
    outcome: MEMBER_OUTCOME.RECONCILED_EXISTING,
    matchedBy: 'loginEmail',
    journalStatus: 'imported',
    failureOutcome: null,
    projection: PROJECTION.IMPORTED,
    reasonLine: 'adopted existing member by login email',
    nextAction: null,
    selection: null,
    telemetry: null,
  }),
  'no-email': Object.freeze({
    outcome: MEMBER_OUTCOME.NOT_WRITTEN_NO_EMAIL,
    journalStatus: 'deferred',
    failureOutcome: null,
    projection: PROJECTION.DEFERRED,
    nextAction: 'add the email at source, then re-run with --deferred-only',
    selection: 'deferred-only',
    telemetry: Object.freeze({ event_type: 'fidelity_loss', subtype: 'no_target', severity: 'degraded' }),
  }),
  ambiguous: Object.freeze({
    outcome: MEMBER_OUTCOME.RECONCILIATION_AMBIGUOUS,
    journalStatus: 'deferred',
    failureOutcome: null,
    projection: PROJECTION.DEFERRED,
    nextAction: 'record the chosen member id as the crosswalk row, then re-run with --deferred-only',
    selection: 'deferred-only',
    telemetry: Object.freeze({ event_type: 'manual_action_required', subtype: 'other', severity: 'degraded' }),
  }),
  'target-read-failed': Object.freeze({
    outcome: MEMBER_OUTCOME.TARGET_READ_FAILED,
    journalStatus: 'failed_retryable',
    failureOutcome: 'failed_retryable',
    projection: PROJECTION.FAILED,
    nextAction: 're-run with --failed-only; nothing was written',
    selection: 'failed-only',
    telemetry: Object.freeze({ event_type: 'error', subtype: null, severity: 'degraded' }),
  }),
  'already-exists-unreconciled': Object.freeze({
    outcome: MEMBER_OUTCOME.ALREADY_EXISTS_UNRECONCILED,
    journalStatus: 'succeeded_unverified',
    failureOutcome: 'unresolved',
    projection: PROJECTION.UNRESOLVED,
    nextAction: 're-run with --unresolved-only: reads the member back by login email',
    selection: 'unresolved-only',
    telemetry: Object.freeze({ event_type: 'error', subtype: null, severity: 'degraded' }),
  }),
  'failed-unknown': Object.freeze({
    outcome: MEMBER_OUTCOME.FAILED,
    journalStatus: 'succeeded_unverified',
    failureOutcome: 'unresolved',
    projection: PROJECTION.UNRESOLVED,
    nextAction: 're-run with --unresolved-only: reads the member back by login email',
    selection: 'unresolved-only',
    telemetry: Object.freeze({ event_type: 'error', subtype: null, severity: 'degraded' }),
  }),
  'failed-rejected': Object.freeze({
    outcome: MEMBER_OUTCOME.FAILED,
    journalStatus: 'failed_terminal',
    failureOutcome: 'failed_terminal',
    projection: PROJECTION.FAILED,
    nextAction: 'fix the source value, then re-run with --failed-only',
    selection: 'failed-only',
    telemetry: Object.freeze({ event_type: 'error', subtype: null, severity: 'degraded' }),
  }),
});
const POLICY_CLASSES = Object.freeze(Object.keys(POLICY));

// Supplemental finding policy. `droppedField` findings become a dropped-field line and a
// fidelity_loss event ONLY on a member that was actually written: no contact was sent otherwise.
const FINDING_POLICY = Object.freeze({
  [MEMBER_FINDING.PHONE_NOT_NORMALIZED]: Object.freeze({ droppedField: 'contact.phones' }),
  [MEMBER_FINDING.PHONE_COLLISION_DROPPED]: Object.freeze({ droppedField: 'contact.phones' }),
  [MEMBER_FINDING.CREATE_RETRIED]: Object.freeze({ droppedField: null }),
  [MEMBER_FINDING.CROSSWALK_ROW_STALE]: Object.freeze({ droppedField: null }),
});

// Pre-write population gate defects. Any one stops the whole pass before its first write.
const POPULATION_DEFECT = Object.freeze({
  MISSING_SOURCE_KEY: 'missing-source-key',
  DUPLICATE_SOURCE_KEY: 'duplicate-source-key',
  UNKNOWN_SOURCE_KEY: 'unknown-source-key',
});

const OPERATOR_ACTION_AMBIGUOUS = Object.freeze({
  code: MEMBER_OUTCOME.RECONCILIATION_AMBIGUOUS,
  severity: 'medium',
  action: 'For each listed customer, choose which existing Wix member is theirs, record that member id as the customer\'s crosswalk row, then re-run the member pass with --deferred-only.',
  deadlineReason: 'orders for these customers import without a member link until each is resolved',
});

function isMemberOutcome(code) {
  return MEMBER_OUTCOMES.includes(code);
}

function isMemberFinding(code) {
  return MEMBER_FINDINGS.includes(code);
}

// A member-failed whose result nobody knows: the target may or may not hold the member.
// Unknown = the client said so, no status arrived (transport), a 5xx survived the retry, or a
// 2xx came back without a member id. A readable 4xx is the target's own decision.
function memberFailureOutcomeUnknown(error) {
  if (!error || typeof error !== 'object') return true;
  if (error.outcomeKnown === false) return true;
  const status = error.status;
  if (status === null || status === undefined) return true;
  const n = Number(status);
  if (!Number.isFinite(n)) return true;
  return !(n >= 400 && n < 500);
}

// The one place a writer result turns into a policy class. Throws on a code the registry does
// not know: silently bucketing it is the defect this file exists to stop.
function classifyMemberResult(result) {
  const outcome = result && result.outcome;
  switch (outcome) {
    case MEMBER_OUTCOME.WRITTEN: return 'written';
    case MEMBER_OUTCOME.RECONCILED_EXISTING:
      if (result.matchedBy === 'crosswalk') return 'reconciled-crosswalk';
      if (result.matchedBy === 'loginEmail') return 'reconciled-login-email';
      throw new Error(`member-reconciled-existing needs matchedBy crosswalk or loginEmail, got ${JSON.stringify(result.matchedBy)}`);
    case MEMBER_OUTCOME.NOT_WRITTEN_NO_EMAIL: return 'no-email';
    case MEMBER_OUTCOME.RECONCILIATION_AMBIGUOUS: return 'ambiguous';
    case MEMBER_OUTCOME.TARGET_READ_FAILED: return 'target-read-failed';
    case MEMBER_OUTCOME.ALREADY_EXISTS_UNRECONCILED: return 'already-exists-unreconciled';
    case MEMBER_OUTCOME.FAILED: return memberFailureOutcomeUnknown(result.error) ? 'failed-unknown' : 'failed-rejected';
    default:
      throw new Error(`unknown member outcome: ${JSON.stringify(outcome)}`);
  }
}

// Error-code derivation. Applied to the final error and to the first error of a retry.
// Always a non-empty token of at most 48 characters with no whitespace, so it can be a
// telemetry error_code as-is. Nothing is parsed out of a message.
const ERROR_CODE_MAX = 48;
function sanitizeCode(value) {
  const token = String(value).trim().replace(/\s+/g, '_').slice(0, ERROR_CODE_MAX);
  return token || null;
}

function deriveMemberErrorCode(error) {
  const e = error && typeof error === 'object' ? error : {};
  if (e.createReturnedNoId === true) return 'create-returned-no-id';
  if (e.applicationErrorCode !== undefined && e.applicationErrorCode !== null && e.applicationErrorCode !== '') {
    const code = sanitizeCode(e.applicationErrorCode);
    if (code) return code;
  }
  const status = e.status === undefined || e.status === null ? null : Number(e.status);
  if (status !== null && Number.isFinite(status) && status >= 400) return String(status);
  if (status !== null && Number.isFinite(status) && status >= 200 && status < 300 && e.outcomeKnown === false) {
    return 'unparseable-2xx-response';
  }
  if (status === null || !Number.isFinite(status)) return 'transport-error';
  // A status below 400 with no other marker: the reply arrived and did not carry a member.
  return 'create-returned-no-id';
}

// Written/skipped tally, the shape the coupon and plan tallies share. Delegated here so the
// buckets come from the policy table rather than a hand-kept list of "written" codes.
function tallyMemberOutcomes(outcomes = []) {
  const written = new Set([MEMBER_OUTCOME.WRITTEN, MEMBER_OUTCOME.RECONCILED_EXISTING]);
  const skippedBy = {};
  let writtenCount = 0;
  for (const code of outcomes) {
    if (!isMemberOutcome(code)) throw new Error(`unknown member outcome: ${JSON.stringify(code)}`);
    if (written.has(code)) { writtenCount += 1; continue; }
    skippedBy[code] = (skippedBy[code] || 0) + 1;
  }
  return { 'members-written': writtenCount, 'members-skipped': outcomes.length - writtenCount, skippedBy };
}

module.exports = {
  MEMBER_OUTCOME,
  MEMBER_OUTCOMES,
  MEMBER_FINDING,
  MEMBER_FINDINGS,
  MEMBER_TARGET_ENTITY_TYPE,
  MEMBER_OPERATION,
  MEMBER_ENTITY,
  PROJECTION,
  POLICY,
  POLICY_CLASSES,
  FINDING_POLICY,
  POPULATION_DEFECT,
  OPERATOR_ACTION_AMBIGUOUS,
  ERROR_CODE_MAX,
  isMemberOutcome,
  isMemberFinding,
  memberFailureOutcomeUnknown,
  classifyMemberResult,
  deriveMemberErrorCode,
  tallyMemberOutcomes,
};
