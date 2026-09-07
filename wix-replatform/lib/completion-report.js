'use strict';

const { OUTCOME_RANK, aggregateOutcome } = require('./blocked-data-requests.js');

const COMPLETION_STATUS = [
  'aborted',
  'incomplete_with_mismatches',
  'incomplete_with_failures',
  'complete_with_deferred_records',
  'complete_with_recovered_records',
  'complete_with_warnings',
  'complete',
];

const STATUS_RANK = new Map(COMPLETION_STATUS.map((status, index) => [status, index]));

function count(value, field) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function requireString(value, field) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asArray(value, field) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value;
}

function hasCount(rows, field) {
  return rows.some((row) => row[field] > 0);
}

function worseStatus(left, right) {
  const leftRank = STATUS_RANK.has(left) ? STATUS_RANK.get(left) : STATUS_RANK.get('complete');
  const rightRank = STATUS_RANK.has(right) ? STATUS_RANK.get(right) : STATUS_RANK.get('complete');
  return leftRank <= rightRank ? left : right;
}

function chooseCompletionStatus(input = {}) {
  const statuses = asArray(input.statuses, 'statuses');
  let selected = input.defaultStatus || 'complete';
  if (!STATUS_RANK.has(selected)) {
    throw new Error(`unknown completion status: ${selected}`);
  }

  for (const status of statuses) {
    if (!STATUS_RANK.has(status)) {
      throw new Error(`unknown completion status: ${status}`);
    }
    selected = worseStatus(selected, status);
  }

  if (input.aborted) {
    selected = worseStatus(selected, 'aborted');
  }
  if (input.hasMismatches) {
    selected = worseStatus(selected, 'incomplete_with_mismatches');
  }
  if (input.hasFailures) {
    selected = worseStatus(selected, 'incomplete_with_failures');
  }
  if (input.hasDeferred) {
    selected = worseStatus(selected, 'complete_with_deferred_records');
  }
  if (input.hasRecoveredRecords) {
    selected = worseStatus(selected, 'complete_with_recovered_records');
  }
  if (input.hasWarnings) {
    selected = worseStatus(selected, 'complete_with_warnings');
  }

  return selected;
}

function normalizeCompletenessRow(row, index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`entityCompleteness[${index}] must be an object`);
  }

  const entity = requireString(row.entity, `entityCompleteness[${index}].entity`);
  const subtype = row.subtype === undefined || row.subtype === null ? 'all' : requireString(row.subtype, `entityCompleteness[${index}].subtype`);
  const extracted = count(row.extracted, `${entity}/${subtype}.extracted`);
  const inScope = count(row.inScope, `${entity}/${subtype}.inScope`);
  const attempted = count(row.attempted, `${entity}/${subtype}.attempted`);
  const imported = count(row.imported, `${entity}/${subtype}.imported`);
  const alreadyPresentByCrosswalk = count(
    row.alreadyPresentByCrosswalk === undefined ? row.alreadyPresent : row.alreadyPresentByCrosswalk,
    `${entity}/${subtype}.alreadyPresentByCrosswalk`
  );
  const deferred = count(row.deferred, `${entity}/${subtype}.deferred`);
  const failed = count(row.failed, `${entity}/${subtype}.failed`);
  const skippedOutOfScope = count(row.skippedOutOfScope, `${entity}/${subtype}.skippedOutOfScope`);
  const unexpectedSkipped = count(
    row.unexpectedSkipped === undefined ? row.skippedInScope : row.unexpectedSkipped,
    `${entity}/${subtype}.unexpectedSkipped`
  );
  const reconciled = imported + alreadyPresentByCrosswalk + deferred + failed;
  const expectedReconciled = inScope;
  const mismatch = reconciled !== expectedReconciled || unexpectedSkipped > 0;

  return {
    entity,
    subtype,
    extracted,
    inScope,
    attempted,
    imported,
    alreadyPresentByCrosswalk,
    deferred,
    failed,
    skippedOutOfScope,
    unexpectedSkipped,
    reconciled,
    expectedReconciled,
    mismatch,
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
  };
}

function headlineForRow(row) {
  const parts = [];
  if (row.mismatch) {
    parts.push(`mismatch ${row.reconciled}/${row.expectedReconciled}`);
  }
  if (row.deferred > 0) {
    parts.push(`${row.deferred} deferred`);
  }
  if (row.failed > 0) {
    parts.push(`${row.failed} failed`);
  }
  if (row.unexpectedSkipped > 0) {
    parts.push(`${row.unexpectedSkipped} unexpected skipped`);
  }
  if (!parts.length) {
    return null;
  }
  return {
    entity: row.entity,
    subtype: row.subtype,
    message: `${row.entity}/${row.subtype}: ${parts.join(', ')}`,
  };
}

function nextStepForBlockedRequest(request, snapshot, requestAggregateOutcome) {
  // A `fulfilled` request only means the source-side snapshot was captured cleanly — it says
  // nothing about whether any target field actually got written using it. Never let this
  // branch claim "no action is required" while a dependent's own write accounting says the
  // value was never applied (deferred/failed) or applied only via a degraded default
  // (warning); check the real per-dependent outcome, not the snapshot status alone.
  if (request.status === 'fulfilled' && (requestAggregateOutcome === 'deferred' || requestAggregateOutcome === 'failed')) {
    return 'The source data was captured successfully, but no target field has been written using it yet — capturing the definitions is not the same as completing the migration. See dependentOutcomes for which field(s) remain unattempted.';
  }
  if (request.status === 'fulfilled' && requestAggregateOutcome === 'warning') {
    return 'The source data was captured successfully, but at least one target field was written using its existing degraded default rather than this data — see dependentOutcomes for which field(s).';
  }
  if (request.status === 'fulfilled' && request.stale) {
    return `The import used data pulled ${snapshot.extractedAt} (snapshot v${snapshot.version}); verify no relevant source activity occurred after that date, or restore the ${request.fulfillment.kind} path and re-run to refresh.`;
  }
  if (request.status === 'fulfilled') return 'No action is required; the import used the recorded source-data snapshot.';
  if (request.status === 'invalid') {
    if (request.fulfillmentErrorCode === 'handler-not-registered') {
      return `Fulfillment handler ${request.fulfillment.handlerId} is not registered in this runner. This is a wiring bug in the import runner, not a data problem — register the handler and re-run.`;
    }
    return request.fulfillment.kind === 'csv-upload'
      ? `Correct the file at ${request.fulfillment.expectedInputPath} and re-run.`
      : 'The source bridge responded with unusable data; correct or reinstall it and re-run.';
  }
  if (request.status === 'declined') return 'Supply the blocked source data and re-run if you want to replace the degraded default.';
  if (request.lastError) return `The source namespace probe failed: ${request.lastError}. Fix source connectivity or authentication, then re-run.`;
  if (request.askedInteractively !== true) {
    return request.fulfillment.kind === 'csv-upload'
      ? `This run did not pause to ask. Supply ${request.fulfillment.expectedInputPath} and re-run.`
      : 'This run did not pause to ask. Install the production-ready source bridge and re-run when that option becomes available.';
  }
  return request.fulfillment.kind === 'csv-upload'
    ? `Supply ${request.fulfillment.expectedInputPath} and re-run.`
    : 'Install the production-ready source bridge and re-run when that option becomes available.';
}

function normalizeBlockedDataRequest(request, index = 0) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error(`blockedDataRequests[${index}] must be an object`);
  const sourceEntityRef = requireString(request.sourceEntityRef, `blockedDataRequests[${index}].sourceEntityRef`);
  const status = requireString(request.status, `blockedDataRequests[${index}].status`);
  if (!['offered', 'missing', 'declined', 'invalid', 'fulfilled'].includes(status)) throw new Error(`${sourceEntityRef}.status is invalid`);
  if (status === 'declined' && request.askedInteractively !== true) throw new Error(`${sourceEntityRef}: declined requires askedInteractively: true`);
  const snapshot = request.snapshot || {};
  if (status === 'fulfilled' && (!Number.isInteger(snapshot.version) || !snapshot.extractedAt || !snapshot.checksum)) {
    throw new Error(`${sourceEntityRef}: fulfilled requires snapshot version, extractedAt, and checksum`);
  }
  const dependentOutcomes = asArray(request.dependentOutcomes, `${sourceEntityRef}.dependentOutcomes`).map((dependent, dependentIndex) => {
    let recordOutcome = dependent.recordOutcome;
    if (recordOutcome === null || recordOutcome === undefined) {
      throw new Error(`${sourceEntityRef}.dependentOutcomes[${dependentIndex}].recordOutcome must be filled from write accounting`);
    }
    if (!OUTCOME_RANK.has(recordOutcome)) throw new Error(`${sourceEntityRef}.dependentOutcomes[${dependentIndex}].recordOutcome is invalid`);
    if (status !== 'fulfilled' && recordOutcome === 'fulfilled') {
      throw new Error(`${sourceEntityRef}.dependentOutcomes[${dependentIndex}] cannot be fulfilled without a fulfilled request`);
    }
    if (status === 'fulfilled' && request.stale && recordOutcome === 'fulfilled') recordOutcome = 'warning';
    const row = {
      targetEntity: requireString(dependent.targetEntity, `${sourceEntityRef}.dependentOutcomes[${dependentIndex}].targetEntity`),
      degradedField: requireString(dependent.degradedField, `${sourceEntityRef}.dependentOutcomes[${dependentIndex}].degradedField`),
      pitfallCode: dependent.pitfallCode || null,
      recordOutcome,
    };
    if (status === 'fulfilled') {
      row.snapshotVersion = snapshot.version;
      row.extractedAt = snapshot.extractedAt;
      row.checksum = snapshot.checksum;
    }
    return row;
  });
  const requestAggregateOutcome = aggregateOutcome(dependentOutcomes);
  return {
    sourceEntityRef,
    status,
    stale: Boolean(request.stale),
    snapshotVersion: status === 'fulfilled' ? snapshot.version : null,
    snapshotExtractedAt: status === 'fulfilled' ? snapshot.extractedAt : null,
    snapshotChecksum: status === 'fulfilled' ? snapshot.checksum : null,
    dependentOutcomes,
    aggregateOutcome: requestAggregateOutcome,
    consequenceIfMissing: request.consequenceIfMissing || null,
    whatUserCanDoNext: nextStepForBlockedRequest({ ...request, fulfillment: request.fulfillment || {} }, snapshot, requestAggregateOutcome),
  };
}

function createCompletionReport(input = {}) {
  const entityCompleteness = asArray(input.entityCompleteness, 'entityCompleteness')
    .map((row, index) => normalizeCompletenessRow(row, index));
  const mismatches = entityCompleteness.filter((row) => row.mismatch);
  const headline = entityCompleteness.map(headlineForRow).filter(Boolean);
  const warnings = asArray(input.warnings, 'warnings');
  const recoveryActions = asArray(input.recoveryActions, 'recoveryActions');
  const blockedDataRequests = asArray(input.blockedDataRequests, 'blockedDataRequests')
    .map((request, index) => normalizeBlockedDataRequest(request, index));
  const status = chooseCompletionStatus({
    statuses: input.statuses,
    aborted: input.aborted,
    hasMismatches: mismatches.length > 0,
    hasFailures: hasCount(entityCompleteness, 'failed') || blockedDataRequests.some((request) => request.aggregateOutcome === 'failed'),
    hasDeferred: hasCount(entityCompleteness, 'deferred') || blockedDataRequests.some((request) => request.aggregateOutcome === 'deferred'),
    hasRecoveredRecords: recoveryActions.length > 0 || Boolean(input.hasRecoveredRecords),
    hasWarnings: warnings.length > 0 || Boolean(input.hasWarnings) || blockedDataRequests.some((request) => request.aggregateOutcome === 'warning'),
  });

  return {
    schemaVersion: 1,
    runId: input.runId || null,
    status,
    headline,
    entityCompleteness,
    mismatches: mismatches.map((row) => ({
      entity: row.entity,
      subtype: row.subtype,
      expectedReconciled: row.expectedReconciled,
      reconciled: row.reconciled,
      unexpectedSkipped: row.unexpectedSkipped,
    })),
    warnings,
    recoveryActions,
    blockedDataRequests,
    artifacts: input.artifacts || {},
    destinations: input.destinations || {},
    urlPreservation: input.urlPreservation || null,
  };
}

module.exports = {
  COMPLETION_STATUS,
  chooseCompletionStatus,
  createCompletionReport,
  normalizeCompletenessRow,
  normalizeBlockedDataRequest,
};
