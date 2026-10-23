'use strict';

// Deterministic construction and reporting for a product gallery that the source
// media records could not confirm. Generated importers call these helpers instead of cloning the
// journal row and completion-action contracts into each project.

const { foldAttemptsBySourceKey } = require('./local-state.js');

const WRITE_SPEC_ID = 'stores-product-media-guard';
const OPERATION = 'confirm-product-pictures';
const ACTION_CODE = 'product-pictures-deferred';
const FAILURE_REASONS = new Set(['no-source-id', 'no-source-record', 'source-unreadable']);

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function buildProductMediaFailureRow({
  confirmation,
  attemptId,
  sourceStableKey,
  sourceId,
  targetId,
  runId,
  phase = 'import',
} = {}) {
  if (!confirmation || confirmation.confirmed !== false || !FAILURE_REASONS.has(confirmation.reason)) {
    throw new TypeError('buildProductMediaFailureRow: confirmation must be a failed confirmPictures result');
  }
  const reason = confirmation.reason;
  const source = requireString(String(sourceId == null ? '' : sourceId), 'sourceId');
  const target = requireString(String(targetId == null ? '' : targetId), 'targetId');
  return {
    schemaVersion: 1,
    attemptId: requireString(attemptId, 'attemptId'),
    sourceStableKey: requireString(sourceStableKey, 'sourceStableKey'),
    writeSpecId: WRITE_SPEC_ID,
    operation: OPERATION,
    targetEntityType: 'product',
    status: 'failed_retryable',
    runId: requireString(runId, 'runId'),
    phase: requireString(phase, 'phase'),
    failure: {
      sourceId: source,
      targetEntityId: target,
      operation: OPERATION,
      httpStatus: null,
      errorCode: null,
      scopeGroupName: null,
      outcome: 'failed_retryable',
      message: `Product media deferred: ${reason}`,
      reason,
    },
  };
}

function productPicturesDeferredAction(rows) {
  if (!Array.isArray(rows)) throw new TypeError('productPicturesDeferredAction: rows must be an array');
  const latest = foldAttemptsBySourceKey(rows);
  let affectedCount = 0;
  for (const row of latest.values()) {
    if (row.writeSpecId === WRITE_SPEC_ID && row.status === 'failed_retryable') affectedCount += 1;
  }
  if (affectedCount === 0) return null;
  return {
    code: ACTION_CODE,
    severity: 'medium',
    entity: 'products',
    affectedCount,
    deadlineReason: 'the source is the only place the original can be recovered while it is still the system of record',
    action: 'Requires Import Operator. For no-source-id and no-source-record, correct the picture at the source (upload the original, or attach it to the product so a media record exists) and re-run the product extract. For source-unreadable, wait until the source answers. Then resume with the failed-only selector. The rows and reasons are in the ledger.',
  };
}

function withProductPicturesDeferredAction(completionInput = {}, rows = []) {
  if (!completionInput || typeof completionInput !== 'object' || Array.isArray(completionInput)) {
    throw new TypeError('withProductPicturesDeferredAction: completionInput must be an object');
  }
  const existing = completionInput.operatorActions;
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new TypeError('withProductPicturesDeferredAction: operatorActions must be an array');
  }
  const operatorActions = (existing || []).filter((action) => !action || action.code !== ACTION_CODE);
  const action = productPicturesDeferredAction(rows);
  if (action) operatorActions.push(action);
  return { ...completionInput, operatorActions };
}

module.exports = {
  buildProductMediaFailureRow,
  productPicturesDeferredAction,
  withProductPicturesDeferredAction,
};
