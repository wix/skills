'use strict';

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

function createCompletionReport(input = {}) {
  const entityCompleteness = asArray(input.entityCompleteness, 'entityCompleteness')
    .map((row, index) => normalizeCompletenessRow(row, index));
  const mismatches = entityCompleteness.filter((row) => row.mismatch);
  const headline = entityCompleteness.map(headlineForRow).filter(Boolean);
  const warnings = asArray(input.warnings, 'warnings');
  const recoveryActions = asArray(input.recoveryActions, 'recoveryActions');
  const status = chooseCompletionStatus({
    statuses: input.statuses,
    aborted: input.aborted,
    hasMismatches: mismatches.length > 0,
    hasFailures: hasCount(entityCompleteness, 'failed'),
    hasDeferred: hasCount(entityCompleteness, 'deferred'),
    hasRecoveredRecords: recoveryActions.length > 0 || Boolean(input.hasRecoveredRecords),
    hasWarnings: warnings.length > 0 || Boolean(input.hasWarnings),
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
};
