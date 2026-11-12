'use strict';

// One rule for every writer that creates a base record and then runs further steps on it (an
// order and its payments, refunds and invoice; a post and its media; a product and its
// inventory): what the attempt journal says once the steps have run.
//
//   - The base record exists on the target (the writer holds its target id): the record is
//     `imported`, with that id and the crosswalk row the writer kept. A later step that failed is
//     a FINDING on that row, marked retryable -- never `failed_terminal`, which would report a
//     record lost while it exists, and make a rerun of failed records send the create again.
//   - The base record was not created: no `targetId`. An id the writer meant to use (a derived
//     one) is not evidence of a record and goes in `failure.intendedTargetId` only, so a read-back
//     can look for it. The status comes from the error the writer kept:
//       writeAttempted: false  -> failed_retryable (the writer stopped before its create)
//       requestSent: false     -> failed_retryable (refused before the network; nothing written)
//       outcomeKnown: false    -> succeeded_unverified (the reply was lost: read back, never resend blind)
//       4xx other than 408/429 -> failed_terminal (the target refused this body)
//       anything else          -> failed_retryable (429, 408, 5xx, a read that could not decide)
//
// Pure: it decides the row's status, targetId, findings and failure; the caller journals them.

const RETRYABLE_4XX = new Set([408, 429]);
const AUTH_EXPIRED_REASON = 'auth_expired';

function requireString(value, label) {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} must be a nonempty string`);
  return value;
}

function baseFailureOutcome(error, { writeAttempted = true } = {}) {
  if (!writeAttempted) return 'failed_retryable';
  if (error && error.requestSent === false) return 'failed_retryable';
  if (error && (error.authExpired === true || error.reason === AUTH_EXPIRED_REASON || error.code === AUTH_EXPIRED_REASON)) return 'failed_retryable';
  if (error && error.outcomeKnown === false) return 'unresolved';
  const status = error && Number.isInteger(error.status) ? error.status : null;
  if (status !== null && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) return 'failed_terminal';
  return 'failed_retryable';
}

const STATUS_FOR_OUTCOME = Object.freeze({
  failed_retryable: 'failed_retryable',
  failed_terminal: 'failed_terminal',
  unresolved: 'succeeded_unverified',
});

// base:     { targetId, outcome, error, intendedTargetId, writeAttempted } -- targetId only when the target holds it
// subSteps: [{ stage, outcome, failed, error }]            -- ignored unless the base exists
function classifyMultiStepAttempt({ sourceStableKey, operation, base, subSteps = [], findings = [] } = {}) {
  requireString(sourceStableKey, 'sourceStableKey');
  requireString(operation, 'operation');
  if (!base || typeof base !== 'object') throw new Error('base must describe the base record step');
  requireString(base.outcome, 'base.outcome');
  if (!Array.isArray(subSteps)) throw new Error('subSteps must be an array');
  const rowFindings = [...findings];

  if (base.targetId) {
    for (const step of subSteps) {
      if (!step || !step.failed) continue;
      rowFindings.push({
        code: 'sub-step-failed',
        stage: requireString(step.stage, 'subSteps[].stage'),
        outcome: requireString(step.outcome, 'subSteps[].outcome'),
        retryable: true,
        ...(step.error && step.error.status ? { httpStatus: step.error.status } : {}),
      });
    }
    return { status: 'imported', targetId: String(base.targetId), findings: rowFindings, failure: undefined };
  }

  const error = base.error || null;
  const outcome = baseFailureOutcome(error, { writeAttempted: base.writeAttempted !== false });
  const status = Number.isInteger(error && error.status) ? error.status : null;
  const authExpired = Boolean(error && (error.authExpired === true || error.reason === AUTH_EXPIRED_REASON || error.code === AUTH_EXPIRED_REASON));
  return {
    status: STATUS_FOR_OUTCOME[outcome],
    targetId: undefined,
    findings: rowFindings,
    failure: {
      sourceId: sourceStableKey,
      targetEntityId: null,
      ...(base.intendedTargetId ? { intendedTargetId: String(base.intendedTargetId) } : {}),
      operation,
      httpStatus: status,
      errorCode: authExpired ? AUTH_EXPIRED_REASON : (error && (error.applicationErrorCode || error.code)) || base.outcome,
      scopeGroupName: null,
      outcome,
      message: String((error && error.message) || base.outcome).slice(0, 300),
      ...(authExpired ? { reason: AUTH_EXPIRED_REASON } : {}),
      ...(error && error.requestSent === false ? { requestSent: false } : {}),
    },
  };
}

module.exports = { classifyMultiStepAttempt, baseFailureOutcome };
