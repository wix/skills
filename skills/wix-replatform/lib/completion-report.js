'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { verificationKind } = require('./entity-verification');
const { appendExecutionLog } = require('./execution-log.js');
const { validReceipt, email: normalizeEmail } = require('./write-verification');
const { OUTCOME_RANK, aggregateOutcome } = require('./blocked-data-requests.js');
const { PAYMENT_OUTCOMES, WRITER_OUTCOMES } = require('./payments-outcome-registry.js');
const memberRegistry = require('./member-outcome-registry.js');
const { SEO_OUTCOMES, SEO_ACCEPTED_OUTCOMES, SEO_OUTCOME_ACTIONS } = require('./seo-outcome-registry.js');
const { coverageDisagreements, describeCoverageMismatch, attemptTargetId, landedUnverified } = require('./import-recovery.js');
const { UNRESOLVED_ATTEMPT_STATUSES } = require('./local-state.js');
const { cmsFallbackOperatorActions } = require('./plugin-cms-fallback.js');
const { summarizeProjectCoverage } = require('./source-coverage.js');
const { readLinkAudit, linkOperatorActions, RELATIVE_PATH: LINK_AUDIT_PATH } = require('./link-audit.js');
const { projectDestinationOperatorActions } = require('./destination-handoff.js');
const { sourceAccessOperatorActions, withheldDetailsOperatorActions } = require('./source-access.js');
const { duplicateArchiveOperatorActions } = require('./cms-archive-duplicates.js');
const { evaluateGiftCardCutover, GIFT_CODES_COVERAGE_ID, GIFT_ACTION_CODE } = require('../resources/rp-source-shopify/lib/shopify-gift-cards.js');

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

// A structured reason entry is `{ outcome: 'deferred' | 'failed', code:
// non-empty string, count: positive integer }`. `code` is taken verbatim and compared
// case-sensitively -- there is no normalization, so `INTERNAL` and `internal` are distinct and
// cannot collide. A plain string entry is a legacy free-text note and is returned unchanged.
function normalizeReasonEntry(entry, label, index) {
  if (typeof entry === 'string') {
    return entry;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${label}.reasons[${index}] must be a string or a structured { outcome, code, count } object`);
  }
  if (entry.outcome !== 'deferred' && entry.outcome !== 'failed') {
    throw new Error(`${label}.reasons[${index}].outcome must be 'deferred' or 'failed'`);
  }
  const code = requireString(entry.code, `${label}.reasons[${index}].code`);
  if (!Number.isInteger(entry.count) || entry.count <= 0) {
    throw new Error(`${label}.reasons[${index}].count must be a positive integer`);
  }
  return { outcome: entry.outcome, code, count: entry.count };
}

// A structured entry is only ever trustworthy because the journal join can tie it back
// to the journal; with no `sourceKeys` there is nothing to join against, so a caller cannot hand
// `createCompletionReport` a fabricated counted tally with no journal backing at all -- the exact
// defect of "a count with no rows behind it". Also rejects a duplicate
// `(outcome, code)` pair and a structured sum for an outcome that exceeds that outcome's count.
function validateReasons(reasons, { entity, subtype, sourceKeys, deferred, failed }) {
  const label = `${entity}/${subtype}`;
  const hasStructured = reasons.some((entry) => typeof entry === 'object');
  if (hasStructured && (!sourceKeys || sourceKeys.length === 0)) {
    throw new Error(`${label}: a structured reason requires sourceKeys`);
  }
  const seen = new Set();
  const sums = { deferred: 0, failed: 0 };
  for (const entry of reasons) {
    if (typeof entry !== 'object') {
      continue;
    }
    const key = `${entry.outcome}\0${entry.code}`;
    if (seen.has(key)) {
      throw new Error(`${label}: duplicate reason (${entry.outcome}, ${entry.code})`);
    }
    seen.add(key);
    sums[entry.outcome] += entry.count;
  }
  if (sums.deferred > deferred) {
    throw new Error(`${label}: structured deferred reasons sum to ${sums.deferred}, more than deferred count ${deferred}`);
  }
  if (sums.failed > failed) {
    throw new Error(`${label}: structured failed reasons sum to ${sums.failed}, more than failed count ${failed}`);
  }
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
  // A write of unknown outcome: may or may not be on the merchant's store. Its own bucket, never
  // folded into `failed` and never left as an unexplained shortfall. Existing callers omit it.
  const unresolved = count(row.unresolved, `${entity}/${subtype}.unresolved`);
  const skippedOutOfScope = count(row.skippedOutOfScope, `${entity}/${subtype}.skippedOutOfScope`);
  const unexpectedSkipped = count(
    row.unexpectedSkipped === undefined ? row.skippedInScope : row.unexpectedSkipped,
    `${entity}/${subtype}.unexpectedSkipped`
  );
  const reconciled = imported + alreadyPresentByCrosswalk + deferred + failed + unresolved;
  const expectedReconciled = inScope;
  // The shipped reconciliation contract (rp-import-codegen/SKILL.md) requires
  // `inScope + skippedOutOfScope <= extracted` -- an excluded record must never also be counted
  // inside `inScope`. This is only detectable when the caller actually supplied `extracted`
  // (present, not defaulted by `count()` to 0 for an omitted or explicit `null` field); the raw
  // field is checked here, before `count()` erases that distinction. `scopeOverflow` names only
  // the exact, arithmetic-provable excess -- never a claimed count of overlapping records, since
  // an extracted record that belongs to neither bucket can make the true overlap larger than this
  // number (worked example: 10 extracted, 8 in-scope, 4 skipped, 1 in neither bucket --
  // true overlap could be 3 while counts exceed extracted by only 2).
  const extractedSupplied = row.extracted !== undefined && row.extracted !== null;
  const scopeOverflow = extractedSupplied && inScope + skippedOutOfScope > extracted
    ? inScope + skippedOutOfScope - extracted
    : 0;
  const mismatch = reconciled !== expectedReconciled || unexpectedSkipped > 0 || scopeOverflow > 0;
  const sourceKeys = Array.isArray(row.sourceKeys) ? row.sourceKeys : null;
  const reasons = (Array.isArray(row.reasons) ? row.reasons : [])
    .map((entry, entryIndex) => normalizeReasonEntry(entry, `${entity}/${subtype}`, entryIndex));
  validateReasons(reasons, { entity, subtype, sourceKeys, deferred, failed });

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
    unresolved,
    skippedOutOfScope,
    unexpectedSkipped,
    reconciled,
    expectedReconciled,
    scopeOverflow,
    mismatch,
    reasons,
    verificationKind: verificationKind(row),
    sourceKeys,
    // Journal evidence joined by attachAttemptReasons; absent when the caller did not join it.
    ...(Array.isArray(row.unresolvedRecords) ? { unresolvedRecords: row.unresolvedRecords } : {}),
    ...(Number.isInteger(row.journalAttempted) ? { journalAttempted: row.journalAttempted } : {}),
  };
}

// The post-import voucher reconciliation answer. Closed set, no default: a run that
// imported usage-limited coupons cannot report itself complete while staying silent about whether
// the reconciliation happened. The whole defect this guards is that "we never did this" and
// "there was nothing to do" used to be the same shape — an absent field.
const VOUCHER_RECONCILIATION = [
  'not-applicable',
  'reconciled',
  'plan-pending-owner',
  'remedied',
  'not-run',
];
// Both of these are money still live on the merchant's store, or possibly so. Neither is allowed
// to be a quiet line item: they reach the headline and they raise the final status.
const VOUCHER_RECONCILIATION_WARNING = new Set(['not-run', 'plan-pending-owner']);

const VOUCHER_RECONCILIATION_MESSAGE = {
  'not-run': 'vouchers: the post-import reconciliation was due and did not run. Run it BEFORE cutover — afterwards there is no fresh source read to compare against and the target exposes no redemption count, so which codes were already spent becomes unknowable',
  'plan-pending-owner': 'vouchers: a reconciliation plan is waiting on the owner\'s decision per code. Until each is decided and confirmed by a post-settle read-back, money spent at source is still redeemable on the target',
};

// The same two states also owe an urgent operator action, so the warning reaches the
// "Urgent Operator Actions" section of both the summary and the merchant handoff instead of only
// the headline. Fixed per state -- nothing is left for a renderer to invent.
const VOUCHER_RECONCILIATION_ACTION = {
  'not-run': {
    code: 'voucher-reconciliation-not-run',
    severity: 'critical',
    action: 'Run the post-import voucher reconciliation against a fresh source read before cutover.',
    deadlineReason: 'once the old platform stops being the system of record there is no fresh source read left to compare against, and which codes were already spent becomes permanently unknowable',
  },
  'plan-pending-owner': {
    code: 'voucher-reconciliation-plan-pending',
    severity: 'critical',
    action: 'Decide the remedy for each coupon on the pending reconciliation plan, then confirm each decision with a post-settle read-back.',
    deadlineReason: 'until every code is decided and confirmed, money already spent at source remains redeemable on the target',
  },
};

// Anchored at the end of the entity name, not a bare
// substring test. A bare `/coupon/i` also matches an entity whose name merely CONTAINS "coupon"
// as a qualifier for something else entirely -- for example
// `smart-coupons-extra-fields` (a per-coupon CMS-shadow metadata facet of the SAME coupon
// records, recordCount tied 1:1 to `coupon`, not a second population of coupons) matched the old
// regex and got summed into `affectedCount` alongside the real `coupon` row, inflating the
// voucher-reconciliation operator action to roughly double the real exposure. Anchoring to "coupon(s)" at the end of the name keeps matching a
// genuinely separate coupon population named with a suffix (`giftCoupons`, tested below) while
// excluding a differently-suffixed entity that merely mentions coupons in passing
// (`*-extra-fields`, `*-rule-definition`, etc.).
const isCouponRow = (row) => /coupons?$/i.test(row.entity);

// Confidentiality: the merchant handoff may carry the voucher urgency signal, but
// never a caller's free-text warning, which can hold names, emails or order contents. Only the
// fixed voucher messages above pass, rebuilt from constants so no caller-supplied field rides along.
const VOUCHER_MESSAGES = new Set(Object.values(VOUCHER_RECONCILIATION_MESSAGE));

function handoffVoucherSignal(report = {}) {
  const state = VOUCHER_RECONCILIATION.includes(report.voucherReconciliation) ? report.voucherReconciliation : null;
  const headline = (Array.isArray(report.headline) ? report.headline : [])
    .filter((row) => row && row.subtype === 'voucher-reconciliation' && VOUCHER_MESSAGES.has(row.message))
    .map((row) => ({ entity: 'coupons', subtype: 'voucher-reconciliation', message: row.message }));
  const warnings = (Array.isArray(report.warnings) ? report.warnings : [])
    .filter((message) => VOUCHER_MESSAGES.has(message));
  return { voucherReconciliation: state, headline, warnings };
}

// `affectedCount` counts from the same rows that decide whether the step is owed. With no coupon
// completeness row (only `usageLimitedCouponsInSource` triggered it) it is 0, meaning "no row to
// count from" -- never "no coupons affected", and never less urgent.
function voucherOperatorAction(voucherReconciliation, entityCompleteness) {
  const template = VOUCHER_RECONCILIATION_ACTION[voucherReconciliation];
  if (!template) return null;
  const affectedCount = entityCompleteness.filter(isCouponRow).reduce((sum, row) => sum + row.inScope, 0);
  return { ...template, entity: 'coupons', affectedCount };
}

// Is this run subject to the step at all? Either the caller says the source carried
// usage-limited coupons, or the run has an in-scope coupon entity row. Silence from a run that
// never touched coupons is not the defect; silence from a run that imported them is.
function voucherReconciliationRequired(input, entityCompleteness) {
  if (input.usageLimitedCouponsInSource === true) return true;
  return entityCompleteness.some((row) => isCouponRow(row) && row.inScope > 0);
}

function normalizeVoucherReconciliation(input, entityCompleteness) {
  const raw = input.voucherReconciliation;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'string' || !VOUCHER_RECONCILIATION.includes(raw)) {
      throw new Error(`voucherReconciliation must be one of ${VOUCHER_RECONCILIATION.join(', ')}`);
    }
    return raw;
  }
  // A missing answer is read as `not-run`, NEVER as `not-applicable`: defaulting an absent
  // answer to the benign value is exactly how a skipped step reported itself complete.
  return voucherReconciliationRequired(input, entityCompleteness) ? 'not-run' : null;
}

function headlineForRow(row) {
  const parts = [];
  // This fragment must name an actual reconciliation
  // shortfall, not merely `row.mismatch` -- `mismatch` can now also be forced by `scopeOverflow`
  // (a counting error, not a lost record) or by `unexpectedSkipped` alone, either of which can
  // leave `reconciled === expectedReconciled`. Gating on the real inequality avoids a
  // self-contradictory "mismatch N/N" once concatenated with the scopeOverflow headline below.
  if (row.reconciled !== row.expectedReconciled) {
    parts.push(`mismatch ${row.reconciled}/${row.expectedReconciled}`);
  }
  if (row.scopeOverflow > 0) {
    parts.push(`inScope + skippedOutOfScope exceeds extracted by ${row.scopeOverflow}; count exclusions outside inScope`);
  }
  if (row.deferred > 0) {
    parts.push(`${row.deferred} deferred`);
  }
  if (row.failed > 0) {
    parts.push(`${row.failed} failed`);
  }
  if (row.unresolved > 0) {
    parts.push(`${row.unresolved} unresolved`);
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

// A per-stage failure against a record the entity row already counts as `imported`.
//
// An order whose import succeeded and whose payment failed is a live order sitting unpaid on the
// merchant's store, and the completeness arithmetic cannot see it: that arithmetic partitions the
// POPULATION, and the order did import. So the report printed the failed payment and counted the
// run complete. This is the orthogonal axis, and it is never folded into `failed` -- doing that
// would break the `imported + alreadyPresentByCrosswalk + deferred + failed == inScope` identity
// the partition exists to protect.
//
// The outcome vocabulary comes from the registry both sides already import, so a stage cannot
// report a code the report has no line for.
const STAGE_RESIDUAL_OUTCOMES = new Set([...WRITER_OUTCOMES, ...PAYMENT_OUTCOMES, ...SEO_OUTCOMES]);
// Owner-dispositioned SEO rows stay visible as counts but are decisions, not open
// work, so they never block completion.
const ACCEPTED_STAGE_OUTCOMES = new Set(SEO_ACCEPTED_OUTCOMES);

function normalizeStageResidual(row, index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`stageResiduals[${index}] must be an object`);
  }
  const entity = requireString(row.entity, `stageResiduals[${index}].entity`);
  const stage = requireString(row.stage, `stageResiduals[${index}].stage`);
  const outcome = requireString(row.outcome, `stageResiduals[${index}].outcome`);
  if (!STAGE_RESIDUAL_OUTCOMES.has(outcome)) {
    throw new Error(`stageResiduals[${index}].outcome is invalid: ${outcome}`);
  }
  const rowCount = count(row.count, `stageResiduals[${index}].count`);
  const sourceKeys = asArray(row.sourceKeys, `stageResiduals[${index}].sourceKeys`)
    .map((key, keyIndex) => requireString(key, `stageResiduals[${index}].sourceKeys[${keyIndex}]`));
  return { entity, stage, outcome, count: rowCount, sourceKeys };
}

function stageResidualMessage(row) {
  const named = row.sourceKeys.length ? ` (${row.sourceKeys.join(', ')})` : '';
  if (SEO_OUTCOME_ACTIONS[row.outcome]) return `${row.entity}/${row.stage}: ${row.count} ${row.entity} ${row.outcome}${named}`;
  return `${row.entity}/${row.stage}: ${row.count} imported ${row.entity} still ${row.outcome}${named}`;
}

function stageResidualAction(row) {
  const named = row.sourceKeys.length ? ` (${row.sourceKeys.join(', ')})` : '';
  if (SEO_OUTCOME_ACTIONS[row.outcome]) return `${SEO_OUTCOME_ACTIONS[row.outcome]} Affected: ${row.count}${named}.`;
  return `Re-run the ${row.stage} stage for ${row.entity}${row.sourceKeys.length ? ` ${row.sourceKeys.join(', ')}` : ''}: ${row.count} imported ${row.entity} ${row.count === 1 ? 'is' : 'are'} ${row.outcome}.`;
}

// Consume the runner's final per-order outcomes, never recount API attempts or read a log.
// Keep only the last result for a source key so a recovery pass clears a resolved failure.
function collectOrderStageResiduals(results, { entity = 'order' } = {}) {
  if (!Array.isArray(results)) throw new Error('order history results must be an array');
  requireString(entity, 'order history entity');
  const latest = new Map();
  for (const row of results) {
    const sourceKey = requireString(row && row.sourceKey, 'order history sourceKey');
    if (!row.outcomes || !['order-imported', 'order-already-imported', 'order-import-failed', 'order-target-read-failed'].includes(row.outcomes.order)) {
      throw new Error(`order history ${sourceKey}: missing or invalid order outcome`);
    }
    latest.set(sourceKey, row.outcomes);
  }
  const groups = new Map();
  for (const [sourceKey, outcomes] of latest) {
    if (!['order-imported', 'order-already-imported'].includes(outcomes.order)) continue;
    const stages = [
      ['payment', outcomes.payment],
      ['invoice', outcomes.invoice],
      ...(outcomes.refunds || []).map((refund) => ['refund', refund.outcome]),
    ];
    for (const [stage, outcome] of stages) {
      if (!STAGE_RESIDUAL_OUTCOMES.has(outcome)) {
        throw new Error(`order history ${sourceKey}: missing or invalid ${stage} outcome`);
      }
      if (!outcome.endsWith('-failed') && outcome !== 'payment-reconciliation-ambiguous') continue;
      const key = `${stage}:${outcome}`;
      if (!groups.has(key)) groups.set(key, { entity, stage, outcome, sourceKeys: new Set() });
      groups.get(key).sourceKeys.add(sourceKey);
    }
  }
  return [...groups.values()].map((row) => ({
    ...row, count: row.sourceKeys.size, sourceKeys: [...row.sourceKeys],
  }));
}

const COMPLETION_REPORT_FILE = 'execution/completion-report.json';
const COMPLETION_SUMMARY_FILE = 'execution/review/completion-summary.md';

// There is no fourth shape and no bare free-text cause.
const CAUSE_CONFIDENCE = ['verified-source', 'verified-target', 'unverified'];

// `unverified` must not carry a cause string: a hypothesis rendered next to the
// word "unverified" is read as a finding by every reader who is skimming. In practice that
// turned "three products failed" into "the merchant's source data has duplicate slugs", which
// nobody had checked and which was false. Reject it at build time rather than dropping it
// quietly -- a row that meant to name a cause needs the check that establishes it, not silence.
function normalizeCauseAttribution(row, label) {
  const confidence = row.causeConfidence === undefined || row.causeConfidence === null
    ? 'unverified'
    : requireString(row.causeConfidence, `${label}.causeConfidence`);
  if (!CAUSE_CONFIDENCE.includes(confidence)) {
    throw new Error(`${label}.causeConfidence must be one of ${CAUSE_CONFIDENCE.join(', ')}`);
  }
  if (confidence === 'unverified') {
    if (row.cause !== undefined && row.cause !== null && row.cause !== '') {
      throw new Error(`${label}: causeConfidence 'unverified' must not carry a cause; name the destination-side check or leave the cause out`);
    }
    if (row.check !== undefined && row.check !== null) {
      throw new Error(`${label}: causeConfidence 'unverified' must not carry a check`);
    }
    return { causeConfidence: 'unverified', cause: null, check: null };
  }
  const cause = requireString(row.cause, `${label}.cause`);
  const check = row.check;
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    throw new Error(`${label}: causeConfidence '${confidence}' requires a recorded check { kind, target, result }`);
  }
  return {
    causeConfidence: confidence,
    cause,
    check: {
      kind: requireString(check.kind, `${label}.check.kind`),
      target: requireString(check.target, `${label}.check.target`),
      result: requireString(check.result, `${label}.check.result`),
    },
  };
}

// `info`: a cutover review item with no defect (a recorded choice to confirm).
const OPERATOR_ACTION_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// Anything the operator has to do by hand goes above the counts, with the
// deadline reason attached. The worked example is a large batch of discount codes
// with no redemption cap -- correctable only while the source is still the system of record.
// A run that stopped before its end. The report it leaves is `aborted`: never final,
// overwritten by the resumed run, and refused by aggregate completion. Only codes are kept --
// an error message can echo a record value.
const INTERRUPTION_KINDS = ['signal', 'error', 'wix_auth_expired'];
const IMPORT_INTERRUPTED_CODE = 'import-interrupted';

function normalizeInterruption(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('interruption must be an object');
  if (!INTERRUPTION_KINDS.includes(value.kind)) throw new Error(`interruption.kind must be one of ${INTERRUPTION_KINDS.join(', ')}`);
  const at = requireString(value.at, 'interruption.at');
  if (Number.isNaN(Date.parse(at))) throw new Error('interruption.at must be an ISO timestamp');
  const optional = (field) => (value[field] === undefined || value[field] === null ? null : requireString(value[field], `interruption.${field}`));
  return { kind: value.kind, signal: optional('signal'), code: optional('code'), at, rebuiltFromJournal: value.rebuiltFromJournal === true };
}

function interruptionOperatorAction(interruption) {
  const cause = interruption.kind === 'signal' ? `signal ${interruption.signal || 'unknown'}`
    : interruption.kind === 'wix_auth_expired' ? 'the Wix token could not be renewed (wix_auth_expired)'
      : `an error${interruption.code ? ` (${interruption.code})` : ''}`;
  const prompt = `The import stopped at ${interruption.at} because of ${cause}. In the original migration project, resolve that cause${interruption.kind === 'wix_auth_expired' ? ' (answer the pending wix_auth_expired action first)' : ''}, then resume the import with src/import/run-import.js. Do not start a new import: the attempt journal resumes it and reads uncertain writes back before any create.`;
  return {
    actionId: IMPORT_INTERRUPTED_CODE,
    code: IMPORT_INTERRUPTED_CODE,
    severity: 'critical',
    role: 'import-operator',
    action: `Requires Import Operator: the import was interrupted (${cause}) and has not finished. Counts below are what was known at the stop${interruption.rebuiltFromJournal ? ', rebuilt from the attempt journal; records the run never reached are not counted' : ''}. Resume the import.`,
    deadlineReason: 'Resolve before any cutover step; the new site is missing data until the import finishes.',
    affectedCount: null,
    importOperatorPrompt: prompt,
    artifactRefs: ['execution/completion-report.json', 'state/attempts/write-attempts.ndjson'],
    resolutionEvidence: 'A resumed run writes execution/completion-report.json with no interruption block and a status other than aborted.',
  };
}

// Marks an already-built report as this stop's: `aborted`, the interruption block, and the
// interruption action first. Used on a report written without it (an older generated importer)
// and by the writer's fence below.
function stampInterruption(report, interruption) {
  const normalized = normalizeInterruption(interruption);
  return { ...report, status: worseStatus(report.status, 'aborted'), interruption: normalized,
    operatorActions: [normalizeOperatorAction(interruptionOperatorAction(normalized), 0),
      ...(report.operatorActions || []).filter((row) => row.code !== IMPORT_INTERRUPTED_CODE)] };
}

// The stop latch of this process, as an interruption: a finalizer still running when SIGTERM
// arrives must not write a report that says the run finished.
function latchedInterruption(projectDir) {
  let latch = null;
  try { latch = require('./wix-auth.js').interruptionFor(projectDir); } catch (error) {
    if (!(error && error.code === 'MODULE_NOT_FOUND')) throw error;
  }
  if (!latch) return null;
  return latch.code === 'wix_auth_expired'
    ? { kind: 'wix_auth_expired', signal: null, code: latch.code, at: new Date().toISOString() }
    : { kind: 'signal', signal: latch.signal || null, code: null, at: new Date().toISOString() };
}

// import-contract-verify writes this before every import, so it is always the current code's.
const CODEGEN_FINDINGS_PATH = 'execution/codegen-findings.json';
function codegenFindingOperatorActions(projectDir) {
  let document = null;
  try { document = JSON.parse(require('node:fs').readFileSync(path.join(projectDir, CODEGEN_FINDINGS_PATH), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  // An in-run override is a toolkit gap (toolkitGaps), never this task; older files may still list it.
  const findings = (document?.schemaVersion === 1 && Array.isArray(document.findings) ? document.findings : []).filter((row) => row && row.code !== 'codegen_scaffold_override');
  const affectedIds = [...new Set(findings.map((row) => `${row.file}:${row.line}`))].sort();
  if (!affectedIds.length) return [];
  const codes = [...new Set(findings.map((row) => row.code))].sort();
  return [{
    actionId: 'codegen-findings-unfixed',
    code: 'codegen-findings-unfixed',
    severity: 'medium',
    role: 'import-operator',
    entity: null,
    action: `Requires Import Operator: ${affectedIds.length} place(s) in the generated importer do work the toolkit owns (${codes.join(', ')}), so failures there may not reach the journal. Fix them in codegen and re-run the affected entities.`,
    importOperatorPrompt: `Read ${CODEGEN_FINDINGS_PATH}. For each finding, change the generated code so it supplies only build (and send where no composite exists) to runRecordTask, re-run import-contract-verify until codegenFindings is empty, then re-run the import for the affected entities with --failed-only.`,
    deadlineReason: 'before switching traffic; records handled by this code may have failed without a journal row',
    affectedCount: affectedIds.length,
    affectedIds,
    artifactRefs: [CODEGEN_FINDINGS_PATH],
    prerequisites: ['The original migration environment (generated src/ and state/).'],
    resolutionEvidence: `import-contract-verify reports no codegenFindings and ${CODEGEN_FINDINGS_PATH} lists none.`,
  }];
}

function normalizeOperatorAction(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`operatorActions[${index}] must be an object`);
  }
  // Every row leaves structured (Elad, 11-15): a producer's missing actionId, role, affectedIds,
  // artifactRefs, prerequisites and resolution evidence are filled from the row's own facts.
  const row = require('./cutover-coverage').structureRow(input);
  const label = `operatorActions[${index}]`;
  const severity = requireString(row.severity, `${label}.severity`);
  if (!OPERATOR_ACTION_SEVERITIES.includes(severity)) {
    throw new Error(`${label}.severity must be one of ${OPERATOR_ACTION_SEVERITIES.join(', ')}`);
  }
  // structureRow always sets actionId, so every row validates and keeps the structured fields.
  const extended = row.actionId !== undefined && row.actionId !== null;
  const actionId = extended ? requireString(row.actionId, `${label}.actionId`) : null;
  const role = !extended || row.role === undefined || row.role === null ? null : requireString(row.role, `${label}.role`);
  if (role && !['import-operator', 'cutover-operator', 'site-owner'].includes(role)) {
    throw new Error(`${label}.role must be import-operator, cutover-operator, or site-owner`);
  }
  const importOperatorPrompt = !extended || row.importOperatorPrompt === undefined || row.importOperatorPrompt === null
    ? null : requireString(row.importOperatorPrompt, `${label}.importOperatorPrompt`);
  if (role === 'import-operator' && !importOperatorPrompt) throw new Error(`${label}.importOperatorPrompt is required for import-operator actions`);
  const stringArray = (field) => {
    if (!extended || row[field] === undefined || row[field] === null) return null;
    if (!Array.isArray(row[field])) throw new Error(`${label}.${field} must be an array`);
    return row[field].map((value, item) => requireString(value, `${label}.${field}[${item}]`));
  };
  const affectedIds = stringArray('affectedIds');
  const artifactRefs = stringArray('artifactRefs');
  if (artifactRefs && artifactRefs.some((ref) => path.isAbsolute(ref) || ref.split(/[\\/]/).includes('..'))) {
    throw new Error(`${label}.artifactRefs must contain project-relative paths`);
  }
  const prerequisites = stringArray('prerequisites');
  const resolutionEvidence = !extended || row.resolutionEvidence === undefined || row.resolutionEvidence === null
    ? null : requireString(row.resolutionEvidence, `${label}.resolutionEvidence`);
  return {
    code: requireString(row.code, `${label}.code`),
    severity,
    action: requireString(row.action, `${label}.action`),
    deadlineReason: requireString(row.deadlineReason, `${label}.deadlineReason`),
    entity: row.entity || null,
    affectedCount: row.affectedCount === null ? null : count(row.affectedCount, `${label}.affectedCount`),
    ...(actionId ? { actionId } : {}),
    ...(role ? { role } : {}),
    ...(importOperatorPrompt ? { importOperatorPrompt } : {}),
    ...(affectedIds ? { affectedIds } : {}),
    ...(artifactRefs ? { artifactRefs } : {}),
    ...(prerequisites ? { prerequisites } : {}),
    ...(resolutionEvidence ? { resolutionEvidence } : {}),
  };
}

// `createCompletionReport` never recomputes the check itself -- it only binds the
// already-computed block (from `live-import-summary.json`, via `writeLiveImportSummary`) to the
// run it is completing, and decides what that binding means for the final status and operator
// actions.
//
// `live-import-summary.json` is one file, fully overwritten on every flush, and interleaved
// run ids are allowed in the same project directory -- so the most recent `coverageCheck`
// read off disk is not necessarily about the run being completed. A supplied check is honored only
// when its own `runId` strictly equals `input.runId`; anything else (a different run's check, or
// one with no `runId` at all) is treated exactly like an omitted check.
function normalizeCoverageCheckInput(input) {
  const raw = input.coverageCheck;
  if (raw === undefined || raw === null) {
    return { coverageCheck: { supplied: false }, raw: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('coverageCheck must be an object');
  }
  requireString(input.runId, 'runId must be a non-empty string when coverageCheck is supplied');
  const matches = typeof raw.runId === 'string' && raw.runId === input.runId;
  return { coverageCheck: { ...raw, supplied: matches }, raw };
}

function coverageFirstDisagreeingEntity(coverageCheck) {
  const items = coverageDisagreements(coverageCheck);
  if (items.length) {
    return items[0].key;
  }
  return (coverageCheck.unmatched && coverageCheck.unmatched[0]) || null;
}

function coverageAffectedCount(coverageCheck) {
  return coverageDisagreements(coverageCheck).length
    + ((coverageCheck.unmatched && coverageCheck.unmatched.length) || 0)
    + ((coverageCheck.unmatchedJournalEntities && coverageCheck.unmatchedJournalEntities.length) || 0);
}

// The reason text for a `coverage_unchecked` operator action: whatever reason the writer itself
// recorded (or `has_unresolved`) when a run-matched check came back `unchecked`, or a
// reason naming why no run-matched check was honored at all, when one wasn't.
function coverageUncheckedReason(coverageCheck, raw, runId) {
  if (coverageCheck.supplied) {
    return coverageCheck.reason || 'unchecked';
  }
  if (!raw) {
    return 'omitted';
  }
  if (typeof raw.runId !== 'string' || !raw.runId) {
    return 'missing_run_id';
  }
  return `run_id_mismatch (coverageCheck.runId: ${raw.runId}, completing run: ${runId})`;
}

// The operator-action shape, with concrete values so `normalizeOperatorAction`'s required
// `code`/`action` never throw: both are built here, never left for a caller to invent.
function coverageOperatorActionRow(kind, { coverageCheck, raw, runId }) {
  if (kind === 'mismatch') {
    return {
      code: 'coverage_mismatch',
      severity: 'high',
      action: `Investigate the live-import count cross-check for run ${runId}: ${describeCoverageMismatch(coverageCheck)}. See the Import Operator prompt in the migration handoff.`,
      deadlineReason: 'before DNS change',
      entity: coverageFirstDisagreeingEntity(coverageCheck),
      affectedCount: coverageAffectedCount(coverageCheck),
    };
  }
  const reason = coverageUncheckedReason(coverageCheck, raw, runId);
  return {
    code: 'coverage_unchecked',
    severity: 'medium',
    action: `Confirm the live-import counts for run ${runId} before DNS: the completion report has no run-matched coverageCheck (reason: ${reason}). See the Import Operator prompt in the migration handoff.`,
    deadlineReason: 'before DNS change',
    entity: null,
    affectedCount: 0,
  };
}

// The omitted/rejected-run default escalation is bounded
// to runs that declare participation (`coverageCheckExpected: true` -- this run called
// `writeLiveImportSummary` with a `runId` at least once). A run that never adopted this contract
// never sets that flag, so a missing check there changes nothing, exactly as before.
function resolveCoverageCheckEffect(input) {
  const { coverageCheck, raw } = normalizeCoverageCheckInput(input);
  const coverageCheckExpected = input.coverageCheckExpected === true;
  let hasMismatch = false;
  let hasWarnings = false;
  let operatorActionRow = null;

  if (coverageCheck.supplied) {
    // Supplying a run-matched block at all is itself evidence of participation: its normal effect
    // applies regardless of `coverageCheckExpected`.
    if (coverageCheck.status === 'mismatch') {
      hasMismatch = true;
      operatorActionRow = coverageOperatorActionRow('mismatch', { coverageCheck, raw, runId: input.runId });
    } else if (coverageCheck.status === 'unchecked') {
      hasWarnings = true;
      operatorActionRow = coverageOperatorActionRow('unchecked', { coverageCheck, raw, runId: input.runId });
    }
  } else if (coverageCheckExpected) {
    hasWarnings = true;
    operatorActionRow = coverageOperatorActionRow('unchecked', { coverageCheck, raw, runId: input.runId });
  }

  return { coverageCheck, coverageCheckExpected, hasMismatch, hasWarnings, operatorActionRow };
}

// Four different things needing four different responses:
// a loss is not an exclusion, an orphan is not a loss, and a dropped field is the one that
// vanishes most easily because the record count reconciles perfectly. Rendered from these
// durable rows, never recounted (the rows themselves are the journal contract).
function normalizeCreditSubtype(row, label) {
  return row.subtype === undefined || row.subtype === null ? null : requireString(row.subtype, `${label}.subtype`);
}

function normalizeLoss(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`losses[${index}] must be an object`);
  const label = `losses[${index}]`;
  return {
    entity: requireString(row.entity, `${label}.entity`),
    // With a subtype, this credit covers only that entity/subtype's failed
    // shortfall; without one, it joins the entity's shared pool across its subtypes.
    subtype: normalizeCreditSubtype(row, label),
    reasonCode: requireString(row.reasonCode, `${label}.reasonCode`),
    count: count(row.count, `${label}.count`),
    whyNoRetry: requireString(row.whyNoRetry, `${label}.whyNoRetry`),
    sourceIds: Array.isArray(row.sourceIds) ? row.sourceIds : [],
    ...normalizeCauseAttribution(row, label),
  };
}

function normalizeExclusion(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`exclusions[${index}] must be an object`);
  const label = `exclusions[${index}]`;
  return {
    entity: requireString(row.entity, `${label}.entity`),
    ...(row.censusId !== undefined ? { censusId: requireString(row.censusId, `${label}.censusId`) } : {}),
    // With a subtype, this credit covers only that entity/subtype's deferred
    // shortfall; without one, it joins the entity's shared pool across its subtypes.
    subtype: normalizeCreditSubtype(row, label),
    reasonCode: requireString(row.reasonCode, `${label}.reasonCode`),
    count: count(row.count, `${label}.count`),
    rationale: requireString(row.rationale, `${label}.rationale`),
    // A choice is not a loss, and an undecided choice is not a decision: say whether a human
    // actually gated it rather than letting an unreviewed filter read as an approved one.
    operatorGateRecorded: Boolean(row.operatorGateRecorded),
  };
}

function normalizeUnresolved(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`unresolved[${index}] must be an object`);
  const label = `unresolved[${index}]`;
  const kind = requireString(row.kind, `${label}.kind`);
  if (!['orphaned_target', 'unmapped_source', 'mapping_without_record'].includes(kind)) {
    throw new Error(`${label}.kind must be orphaned_target, unmapped_source or mapping_without_record`);
  }
  return {
    entity: requireString(row.entity, `${label}.entity`),
    kind,
    count: count(row.count, `${label}.count`),
    targetIds: Array.isArray(row.targetIds) ? row.targetIds : [],
    sourceIds: Array.isArray(row.sourceIds) ? row.sourceIds : [],
    ...normalizeCauseAttribution(row, label),
  };
}

function normalizeDroppedField(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`droppedFields[${index}] must be an object`);
  const label = `droppedFields[${index}]`;
  return {
    entity: requireString(row.entity, `${label}.entity`),
    ...(row.subtype !== undefined ? { subtype: requireString(row.subtype, `${label}.subtype`) } : {}),
    field: requireString(row.field, `${label}.field`),
    recordCount: count(row.recordCount, `${label}.recordCount`),
    reasonCode: requireString(row.reasonCode, `${label}.reasonCode`),
  };
}

// What the source archive kept for reference, per entity. Informational: it never
// changes the run status. Built by the rp-target-wix source-archive module (keptForReferenceSummary),
// joined from execution/source-archive-plan.json by writeCompletionReport.
function normalizeKeptForReference(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('keptForReference must be an object');
  const entities = asArray(value.entities, 'keptForReference.entities').map((row, index) => {
    const label = `keptForReference.entities[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label} must be an object`);
    return {
      sourceEntity: requireString(row.sourceEntity, `${label}.sourceEntity`),
      collectionId: requireString(row.collectionId, `${label}.collectionId`),
      recordsArchived: count(row.recordsArchived, `${label}.recordsArchived`),
      items: count(row.items, `${label}.items`),
      groups: Array.isArray(row.groups) ? row.groups.map(String) : [],
      sameInEveryRecord: count(row.sameInEveryRecord || 0, `${label}.sameInEveryRecord`),
      notKept: count(row.notKept || 0, `${label}.notKept`),
      archiveOnly: row.archiveOnly === true,
    };
  });
  return {
    ...(value.applied === false ? { applied: false, writtenRows: count(value.writtenRows || 0, 'keptForReference.writtenRows'), unplannedRows: count(value.unplannedRows || 0, 'keptForReference.unplannedRows') } : {}),
    collectionName: requireString(value.collectionName, 'keptForReference.collectionName'),
    policyRef: value.policyRef ? String(value.policyRef) : null,
    totalItems: count(value.totalItems, 'keptForReference.totalItems'),
    heldItems: count(value.heldItems || 0, 'keptForReference.heldItems'),
    howToFind: requireString(value.howToFind, 'keptForReference.howToFind'),
    entities,
    optionalTasks: asArray(value.optionalTasks || [], 'keptForReference.optionalTasks').map((row, index) => {
      const label = `keptForReference.optionalTasks[${index}]`;
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label} must be an object`);
      if (row.optional !== true) throw new Error(`${label}.optional must be true`);
      return {
        code: requireString(row.code, `${label}.code`), optional: true,
        goLiveImpact: requireString(row.goLiveImpact, `${label}.goLiveImpact`),
        role: requireString(row.role, `${label}.role`),
        title: requireString(row.title, `${label}.title`),
        action: requireString(row.action, `${label}.action`),
        affected: asArray(row.affected || [], `${label}.affected`).map((a, i) => ({
          entity: requireString(a.entity, `${label}.affected[${i}].entity`), field: requireString(a.field, `${label}.affected[${i}].field`),
          recordCount: count(a.recordCount, `${label}.affected[${i}].recordCount`) })),
        importOperatorPrompt: requireString(row.importOperatorPrompt, `${label}.importOperatorPrompt`),
        resolutionEvidence: requireString(row.resolutionEvidence, `${label}.resolutionEvidence`),
      };
    }),
  };
}

// The member pass's per-reason breakdown. Every registry code carries a line,
// zeros included: an absent line is indistinguishable from a code nobody counted.
function normalizeMemberOutcomes(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('memberOutcomes must be an object');
  requireString(value.populationBasis, 'memberOutcomes.populationBasis');
  const lines = (field, codes) => {
    const source = value[field];
    if (!source || typeof source !== 'object') throw new Error(`memberOutcomes.${field} must be an object`);
    for (const key of Object.keys(source)) {
      if (!codes.includes(key)) throw new Error(`memberOutcomes.${field} has unknown code ${key}`);
    }
    return Object.fromEntries(codes.map((code) => {
      if (!(code in source)) throw new Error(`memberOutcomes.${field}.${code} is missing; every registry code carries a line`);
      return [code, count(source[code], `memberOutcomes.${field}.${code}`)];
    }));
  };
  const defect = value.populationDefect || {};
  return {
    ...value,
    entity: value.entity || memberRegistry.MEMBER_ENTITY,
    byOutcome: lines('byOutcome', memberRegistry.MEMBER_OUTCOMES),
    byFinding: lines('byFinding', memberRegistry.MEMBER_FINDINGS),
    populationDefect: {
      missingSourceKey: count(defect.missingSourceKey, 'memberOutcomes.populationDefect.missingSourceKey'),
      duplicateSourceKey: count(defect.duplicateSourceKey, 'memberOutcomes.populationDefect.duplicateSourceKey'),
      unknownSourceKey: count(defect.unknownSourceKey, 'memberOutcomes.populationDefect.unknownSourceKey'),
    },
    projectionErrors: asArray(value.projectionErrors, 'memberOutcomes.projectionErrors'),
  };
}

function memberHeadline(memberOutcomes) {
  if (!memberOutcomes) return [];
  const out = [];
  const d = memberOutcomes.populationDefect;
  if (d.missingSourceKey || d.duplicateSourceKey || d.unknownSourceKey) {
    out.push({ entity: memberOutcomes.entity, message: `${memberOutcomes.entity}: population gate refused the member pass (${d.missingSourceKey} missing, ${d.duplicateSourceKey} duplicate, ${d.unknownSourceKey} unknown source keys); no member was written` });
  }
  if (memberOutcomes.projectionErrors.length) {
    out.push({ entity: memberOutcomes.entity, message: `${memberOutcomes.entity}: ${memberOutcomes.projectionErrors.length} journal pairing error(s); member counts are not trustworthy until the journal is repaired` });
  }
  return out;
}

// `own(r, o)` -- the sum of a row's own structured entries for outcome `o`.
function ownTally(row, outcome) {
  return row.reasons
    .filter((entry) => typeof entry === 'object' && entry.outcome === outcome)
    .reduce((sum, entry) => sum + entry.count, 0);
}

// Exclusions credit only deferred; losses credit only failed. A record with a
// `subtype` covers only that entity/subtype; without one it joins the entity's shared pool.
function buildCreditPools(records) {
  const scoped = new Map();
  const pool = new Map();
  for (const record of records) {
    if (record.subtype) {
      const key = `${record.entity}\0${record.subtype}`;
      scoped.set(key, (scoped.get(key) || 0) + record.count);
    } else {
      pool.set(record.entity, (pool.get(record.entity) || 0) + record.count);
    }
  }
  return { scoped, pool };
}

function spendCredit(map, key, amount) {
  if (amount <= 0) return 0;
  const available = map.get(key) || 0;
  const spent = Math.min(available, amount);
  if (spent > 0) map.set(key, available - spent);
  return spent;
}

// For each row, apply its subtype-scoped credit first, then draw from the
// entity's shared pool -- but ONLY when the journal already attributes at least one reason of
// this outcome to this specific row (`own(r, o) > 0`), or this row is its entity's only row. A
// row whose own tally is exactly zero, in a multi-row entity, can be cleared only by a credit
// explicitly scoped to its own subtype: count alone cannot show the pool's records are really
// about this row, which is the "genuinely reason-less row" that must fail loudly.
// Returns a parallel array of { unexplainedDeferred, unexplainedFailed }, same order/length as
// `entityCompleteness`. Mutates nothing it is not given.
function allocateUnexplainedCounts(entityCompleteness, exclusions, losses, memberOutcomes) {
  const deferredCredit = buildCreditPools(exclusions);
  const failedCredit = buildCreditPools(losses);
  const countByEntity = new Map();
  for (const row of entityCompleteness) {
    countByEntity.set(row.entity, (countByEntity.get(row.entity) || 0) + 1);
  }

  return entityCompleteness.map((row) => {
    // The member entity's unexplained is 0 for both outcomes, as today -- the
    // member breakdown already names every failed member's reason and recovery path.
    if (memberOutcomes && row.entity === memberOutcomes.entity) {
      return { unexplainedDeferred: 0, unexplainedFailed: 0 };
    }
    const ownDeferred = ownTally(row, 'deferred');
    const ownFailed = ownTally(row, 'failed');
    let residualDeferred = Math.max(0, row.deferred - ownDeferred);
    let residualFailed = Math.max(0, row.failed - ownFailed);
    const scopeKey = `${row.entity}\0${row.subtype}`;

    residualDeferred -= spendCredit(deferredCredit.scoped, scopeKey, residualDeferred);
    residualFailed -= spendCredit(failedCredit.scoped, scopeKey, residualFailed);

    const isOnlyRow = countByEntity.get(row.entity) === 1;
    if ((ownDeferred > 0 || isOnlyRow) && residualDeferred > 0) {
      residualDeferred -= spendCredit(deferredCredit.pool, row.entity, residualDeferred);
    }
    if ((ownFailed > 0 || isOnlyRow) && residualFailed > 0) {
      residualFailed -= spendCredit(failedCredit.pool, row.entity, residualFailed);
    }
    return { unexplainedDeferred: residualDeferred, unexplainedFailed: residualFailed };
  });
}

// The join between a completeness row and the journal rows that back its deferred
// and failed counts: a completeness row cannot be identified by `targetEntityType` alone (two
// subtypes can share one target type), so the join key is the row's own `sourceKeys` list, which
// the codegen contract already asks every row to carry. Pure; returns a new rows array.
//
// `runIds` is required: a non-empty array of distinct, non-empty run id strings. An ordinary
// report passes `[runId]`; a cutover repair regeneration lists the original run's id plus every
// repair pass's own id, because a repair pass through the importer is a fresh process start and
// its rows land under a new `runId` that the append-only journal never retrofits onto the
// original run.
function attachAttemptReasons(entityCompleteness, journalRows, { runIds } = {}) {
  if (!Array.isArray(runIds) || runIds.length === 0 || runIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('attachAttemptReasons requires runIds: a non-empty array of non-empty run id strings');
  }
  const runIdSet = new Set(runIds);

  // One Map(sourceKey -> rowIndex). A key listed by two rows makes attribution ambiguous.
  const keyToIndex = new Map();
  entityCompleteness.forEach((row, index) => {
    for (const key of row.sourceKeys || []) {
      if (keyToIndex.has(key)) {
        throw new Error(`sourceKey ${key} is listed by ${keyToIndex.get(key)} and ${index}`);
      }
      keyToIndex.set(key, index);
    }
  });

  // One pass over journalRows: skip rows whose runId is not listed or whose sourceStableKey is
  // not in the map; keep the latest remaining row per key, in file order (same rule as
  // `foldAttemptsBySourceKey`, applied after the run filter) -- forward iteration with a Map
  // overwrite means the last (latest) row for a key always wins.
  const latestByKey = new Map();
  // A `started` row is the journal's record that a write was sent for that key in this run.
  const sentKeys = new Set();
  for (const row of journalRows || []) {
    if (!row || !runIdSet.has(row.runId)) continue;
    const key = row.sourceStableKey;
    if (!keyToIndex.has(key)) continue;
    latestByKey.set(key, row);
    if (row.status === 'started') sentKeys.add(key);
  }
  // Unresolved records keep their target identity: an uncertain create is read back by that id,
  // never re-sent, so the report must carry it rather than only a count.
  const unresolvedByRow = entityCompleteness.map(() => []);
  for (const [key, row] of latestByKey) {
    if (!UNRESOLVED_ATTEMPT_STATUSES.has(row.status) && !landedUnverified(row)) continue;
    unresolvedByRow[keyToIndex.get(key)].push({ sourceKey: key, status: row.status, runId: row.runId, targetId: attemptTargetId(row) });
  }
  // Every journal deferral, ordinary or uncertain without a target id: the caller's own `deferred`
  // count is credited against all of them before any gap is filled.
  const journalDeferredByRow = entityCompleteness.map(() => 0);
  for (const [key, row] of latestByKey) if (row.status === 'deferred' || (row.status === 'needs_verification' && !landedUnverified(row))) journalDeferredByRow[keyToIndex.get(key)] += 1;
  const sentByRow = entityCompleteness.map(() => 0);
  for (const key of sentKeys) sentByRow[keyToIndex.get(key)] += 1;

  const tallies = entityCompleteness.map(() => new Map());
  for (const [key, row] of latestByKey) {
    let outcome = null;
    let code = null;
    // A `needs_verification` row with no target id stays a deferral (import-recovery.js): it is
    // resumed by --deferred-only, so it is explained as deferred, with its recorded reason.
    if (row.status === 'deferred' || (row.status === 'needs_verification' && !landedUnverified(row))) {
      outcome = 'deferred';
      // The documented contract
      // (rp-import-codegen/SKILL.md's "Named reason" rule) is a top-level
      // `row.reason` string, but the real generated importer for that run wrote its
      // deferred rows' reason into `failure.errorCode` (the same field used for failed rows),
      // leaving `row.reason` absent on every one of its deferred rows. Preferring
      // `row.reason` keeps the documented contract authoritative when a future importer
      // actually writes it, while this fallback stops a real, already-recorded reason from
      // being silently dropped as "unexplained" just because it landed on the sibling field.
      // A gate- or quota-held deferral may record its code only under `deferral.reason` (the
      // structured deferral payload, e.g. cms-item-quota.js quotaDeferral); that is the same
      // recorded reason, not a guess.
      code = typeof row.reason === 'string' && row.reason ? row.reason
        : (row.deferral && typeof row.deferral.reason === 'string' && row.deferral.reason) || (row.failure && row.failure.errorCode);
    } else if (row.status === 'failed_retryable' || row.status === 'failed_terminal') {
      outcome = 'failed';
      code = row.failure && row.failure.errorCode;
    } else {
      continue;
    }
    if (typeof code !== 'string' || code === '') continue;
    const map = tallies[keyToIndex.get(key)];
    const tallyKey = `${outcome}\0${code}`;
    map.set(tallyKey, (map.get(tallyKey) || 0) + 1);
  }

  return entityCompleteness.map((row, index) => {
    if (!row.sourceKeys || !row.sourceKeys.length) {
      return row;
    }
    const structured = [...tallies[index].entries()]
      .map(([tallyKey, tallyCount]) => {
        const [outcome, code] = tallyKey.split('\0');
        return { outcome, code, count: tallyCount };
      })
      .sort((a, b) => (a.outcome === b.outcome ? (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) : (a.outcome < b.outcome ? -1 : 1)));
    const strings = (row.reasons || []).filter((entry) => typeof entry === 'string');
    const unresolvedRecords = unresolvedByRow[index].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
    return { ...raiseFromJournal(row, unresolvedRecords.length, journalDeferredByRow[index]), reasons: [...structured, ...strings], unresolvedRecords, journalAttempted: sentByRow[index] };
  });
}

// The journal is the record of what was sent. A caller that left an uncertain write out of every
// counter (an unverified write counted nowhere) leaves an in-scope gap; the journal's own
// unresolved, then uncertain-deferred, records fill that gap -- never more than the gap, so a
// caller's complete accounting is never double counted. Each fill is the journal's count minus
// what the caller already counted in that bucket.
function raiseFromJournal(row, journalUnresolved, journalDeferred) {
  if (!Number.isInteger(row.inScope)) return row;
  const n = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
  const present = row.alreadyPresentByCrosswalk === undefined ? row.alreadyPresent : row.alreadyPresentByCrosswalk;
  let gap = row.inScope - n(row.imported) - n(present) - n(row.deferred) - n(row.failed) - n(row.unresolved);
  const unresolved = Math.max(0, Math.min(journalUnresolved - n(row.unresolved), gap));
  gap -= unresolved;
  const deferred = Math.max(0, Math.min(journalDeferred - n(row.deferred), gap));
  if (!unresolved && !deferred) return row;
  return { ...row, ...(unresolved ? { unresolved: n(row.unresolved) + unresolved } : {}), ...(deferred ? { deferred: n(row.deferred) + deferred } : {}) };
}

// unresolved[] rows from the journal evidence attachAttemptReasons joined: a record with a known
// target id is written but unmapped (`orphaned_target`); one without is `unmapped_source`. Only
// for an entity the caller listed no unresolved rows for -- a caller's own rows are never replaced.
function journalUnresolvedRows(entityCompleteness, callerRows) {
  const listed = new Set(callerRows.map((row) => row.entity));
  const byEntity = new Map();
  for (const row of entityCompleteness) {
    if (!row.unresolved || listed.has(row.entity) || !Array.isArray(row.unresolvedRecords)) continue;
    if (!byEntity.has(row.entity)) byEntity.set(row.entity, []);
    byEntity.get(row.entity).push(...row.unresolvedRecords);
  }
  const out = [];
  for (const [entity, records] of byEntity) {
    for (const kind of ['orphaned_target', 'unmapped_source']) {
      const group = records.filter((record) => (kind === 'orphaned_target') === Boolean(record.targetId));
      if (!group.length) continue;
      out.push({ entity, kind, count: group.length, targetIds: group.map((record) => record.targetId).filter(Boolean), sourceIds: group.map((record) => record.sourceKey) });
    }
  }
  return out;
}

// CMS records this run wrote per approved fallback capability: { capability, collections[], count }.
function normalizeCmsFallbackWrites(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('cmsFallback.writes must be an array');
  return value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`cmsFallback.writes[${index}] must be an object`);
    return {
      capability: requireString(row.capability, `cmsFallback.writes[${index}].capability`),
      collections: Array.isArray(row.collections) ? row.collections.map(String) : [],
      count: count(row.count, `cmsFallback.writes[${index}].count`),
    };
  });
}

// The verification report for one completeness row, rebuilt from loaded write-verification state
// (`write-verification-state.load`): that entity's receipt kind and in-scope keys only. Absent
// state or no matching row returns undefined, so the existing "not recorded" gap still applies.
function persistedVerification(verificationState, row, siteId) {
  if (!verificationState?.rows || verificationState.siteId !== siteId || !Array.isArray(row.sourceKeys)) return undefined;
  const keys = new Set(row.sourceKeys);
  const rows = Object.values(verificationState.rows).filter(r => keys.has(r?.sourceKey) && r.receipt?.kind === row.verificationKind);
  return rows.length ? require('./write-verification-state').report(rows, siteId) : undefined;
}

// Receipts that share one contact id. A group whose receipts all name one email (normalized) is one
// person. A group with different emails may be two people: it does not block, but the caller lists
// it as a warning (contact id, emails, phones) for the merchant to check. A receipt without an email
// cannot show who it is, so such a group still blocks.
function sharedContactGroups(entries) {
  const byTarget = new Map();
  for (const r of entries) {
    if (!byTarget.has(r.targetId)) byTarget.set(r.targetId, []);
    byTarget.get(r.targetId).push(r);
  }
  const mixed = [];
  for (const [contactId, group] of byTarget) {
    if (group.length < 2) continue;
    const emails = group.map(r => normalizeEmail(r.receipt?.expected?.email?.email || ''));
    if (emails.includes('')) return { ok: false, mixed: [] };
    if (new Set(emails).size > 1) {
      const phones = group.map(r => r.receipt?.expected?.phone?.phone).filter(p => typeof p === 'string' && p);
      mixed.push({ contactId, sourceKeys: group.map(r => r.sourceKey).sort(), emails: [...new Set(emails)].sort(), phones: [...new Set(phones)].sort() });
    }
  }
  return { ok: true, mixed };
}

function createCompletionReport(input = {}) {
  const entityCompleteness = asArray(input.entityCompleteness, 'entityCompleteness')
    .map((row, index) => normalizeCompletenessRow(row, index));
  const verification = input.verification || {};
  const verificationGaps = [];
  const sharedContactWarnings = [];
  for (const row of entityCompleteness) {
    if (row.verificationKind === 'none') continue;
    // The toolkit writers persist their verification rows (state/write-verification);
    // a caller passes the loaded state as `verificationState` instead of carrying each report.
    const report = verification[row.entity] || persistedVerification(input.verificationState, row, input.siteId || input.destinations?.siteId);
    const entries = Array.isArray(report?.rows) ? report.rows : [];
    const unique = new Set(entries.map(r => r.sourceKey));
    const ids = entries.map(r => r.targetId);
    const kind = row.verificationKind;
    const expectedKeys = row.sourceKeys;
    // A held record was never written, so it has no receipt. When every deferred record carries a
    // typed reason (its own cutover task), only the written records need one. A row where every
    // record is held still blocks below; untyped deferrals keep the full-scope rule.
    const typedDeferred = row.reasons.filter(r => typeof r === 'object' && r.outcome === 'deferred').reduce((sum, r) => sum + r.count, 0);
    const typedHeld = row.deferred > 0 && row.deferred < row.inScope && typedDeferred === row.deferred ? row.deferred : 0;
    const needed = row.inScope - typedHeld;
    const scope = new Set(Array.isArray(expectedKeys) ? expectedKeys : []);
    const covered = Array.isArray(expectedKeys) && scope.size === row.inScope && expectedKeys.length === row.inScope && entries.every(r => scope.has(r.sourceKey)) && report?.siteId && report.siteId === (input.siteId || input.destinations?.siteId) && entries.every(r => typeof r.sourceKey === 'string' && r.sourceKey) && unique.size === entries.length && entries.length === needed;
    const verified = entries.filter(r => validReceipt(r.receipt, { siteId: report?.siteId, sourceKey: r.sourceKey, targetId: r.targetId, kind })).length;
    // Wix keeps one contact per person: a customer and the same person's guest orders land on one
    // contact. A shared contact passes only when every receipt on it names the same email; two
    // different emails may be two people. Other kinds keep one record per target.
    const shared = new Set(ids).size === ids.length ? { ok: true, mixed: [] } : kind === 'contact' ? sharedContactGroups(entries) : { ok: false, mixed: [] };
    const sharedTargetOk = shared.ok;
    const gapsBefore = verificationGaps.length;
    if ((row.inScope && (!covered || verified !== needed || !sharedTargetOk)) || entries.length !== needed) {
      // Absence stays exactly as blocking as a failed check; only the wording differs,
      // so a reader can tell "never supplied" from "supplied and failed".
      const absent = !Array.isArray(report?.rows) || report.rows.length === 0;
      // Every in-scope record held: nothing exists to verify, so say so instead of asking for
      // verification input. Still blocking -- a held row is not verified.
      const held = absent && row.inScope > 0 && row.deferred === row.inScope && row.attempted === 0;
      verificationGaps.push({
        entity: row.entity,
        message: held
          ? `${row.entity}: not attempted (${row.deferred} of ${row.inScope} in-scope records deferred); nothing was written, so there is nothing to verify -- resolve the deferral and import before completing`
          : absent
          ? `${row.entity}: verification not recorded; supply verification input before completing`
          : `${row.entity}: identity/value verification missing or invalid; reconcile source records before completing`,
      });
    }
    if (verificationGaps.length === gapsBefore) for (const group of shared.mixed) sharedContactWarnings.push({ entity: row.entity, ...group });
  }
  const mismatches = entityCompleteness.filter((row) => row.mismatch);
  const voucherReconciliation = normalizeVoucherReconciliation(input, entityCompleteness);
  const voucherHeadline = VOUCHER_RECONCILIATION_WARNING.has(voucherReconciliation)
    ? [{ entity: 'coupons', subtype: 'voucher-reconciliation', message: VOUCHER_RECONCILIATION_MESSAGE[voucherReconciliation] }]
    : [];
  // Missing accounting is not a clean payment history. Known order entities and mapped
  // order targets must explicitly pass the collected list, including [] when it is empty.
  const hasOrders = input.orderHistoryInScope === true || (input.entityCompleteness || []).some((row) =>
    row.inScope > 0 && [row.entity, row.targetEntityType].some((name) => /(^|[/:._-])orders?$/i.test(name || '')));
  if (hasOrders && !Array.isArray(input.stageResiduals)) {
    throw new Error('stageResiduals must be an array for order history; collect outcomes before completing');
  }
  const stageResiduals = asArray(input.stageResiduals, 'stageResiduals')
    .map((row, index) => normalizeStageResidual(row, index));
  // A gate that fires on zero is noise, so only a row that actually has records speaks.
  const openStageResiduals = stageResiduals.filter((row) => row.count > 0 && !ACCEPTED_STAGE_OUTCOMES.has(row.outcome));
  const acceptedStageOutcomes = stageResiduals.filter((row) => row.count > 0 && ACCEPTED_STAGE_OUTCOMES.has(row.outcome));
  const memberOutcomes = normalizeMemberOutcomes(input.memberOutcomes);
  const headline = [
    ...entityCompleteness.map(headlineForRow).filter(Boolean),
    ...memberHeadline(memberOutcomes),
    ...verificationGaps,
    ...voucherHeadline,
    ...openStageResiduals.map((row) => ({ entity: row.entity, stage: row.stage, message: stageResidualMessage(row) })),
  ];
  // A run-level `attempted` lower than the records the journal shows sent this run hides an
  // uncertain write from the count. Only an undercount is flagged: a caller that journals no
  // `started` rows cannot be checked this way.
  const attemptedUndercounts = entityCompleteness
    .filter((row) => Number.isInteger(row.journalAttempted) && row.journalAttempted > row.attempted)
    .map((row) => `${row.entity}/${row.subtype}: attempted ${row.attempted}, but the attempt journal shows ${row.journalAttempted} record(s) sent in this run`);
  const warnings = [...asArray(input.warnings, 'warnings'), ...voucherHeadline.map((row) => row.message), ...attemptedUndercounts,
    ...sharedContactWarnings.map((g) => `${g.entity}: Wix contact ${g.contactId} holds ${g.sourceKeys.length} source records with different emails (${g.emails.join(', ')}${g.phones.length ? `; phones ${g.phones.join(', ')}` : ''}; records ${g.sourceKeys.join(', ')}). Wix merged them into one contact. Check in Business Manager > Contacts whether this is one person; if not, split it by hand.`)];
  const recoveryActions = [
    ...asArray(input.recoveryActions, 'recoveryActions'),
    ...verificationGaps.map(g => ({ entity: g.entity, action: g.message })),
    // A landed-unverified create (`needs_verification` with a target id) is reported unresolved but
    // is selected by --deferred-only or a full resume, not --unresolved-only: say which, by id.
    ...entityCompleteness.flatMap((row) => (row.unresolvedRecords || []).filter((r) => r.status === 'needs_verification' && r.targetId).map((r) => ({
      entity: row.entity,
      action: `Requires Import Operator: read ${r.sourceKey} back by target ${r.targetId}, never resend; run the importer with --deferred-only or a full resume (--unresolved-only does not select needs_verification rows).`,
    }))),
    ...openStageResiduals.map((row) => ({
      entity: row.entity,
      stage: row.stage,
      action: stageResidualAction(row),
    })),
  ];
  const blockedDataRequests = asArray(input.blockedDataRequests, 'blockedDataRequests')
    .map((request, index) => normalizeBlockedDataRequest(request, index));
  const urlPreservation = normalizeUrlPreservation(input.urlPreservation);
  const interruption = input.interruption ? normalizeInterruption(input.interruption) : null;
  const operatorActions = asArray(input.operatorActions, 'operatorActions')
    .filter((row) => !interruption || !row || row.code !== IMPORT_INTERRUPTED_CODE)
    .map(normalizeOperatorAction);
  // First, so the handoff's urgent list opens with it.
  if (interruption) operatorActions.unshift(normalizeOperatorAction(interruptionOperatorAction(interruption), 0));
  for (const action of urlPreservation ? urlPreservation.operatorActions : []) {
    if (!operatorActions.some((row) => row.code === action.code)) {
      operatorActions.push(normalizeOperatorAction(action, operatorActions.length));
    }
  }
  // Folded once, at the source, so no caller has to remember it. A caller-supplied row with the
  // same code is authoritative; a derived duplicate would print the same urgent line twice.
  const voucherAction = voucherOperatorAction(voucherReconciliation, entityCompleteness);
  if (voucherAction && !operatorActions.some((row) => row.code === voucherAction.code)) {
    operatorActions.push(normalizeOperatorAction(voucherAction, operatorActions.length));
  }
  // Binds a supplied `coverageCheck` to `input.runId` and decides the escalation --
  // never recomputes the check itself.
  const coverageEffect = resolveCoverageCheckEffect(input);
  if (coverageEffect.operatorActionRow && !operatorActions.some((row) => row.code === coverageEffect.operatorActionRow.code)) {
    operatorActions.push(normalizeOperatorAction(coverageEffect.operatorActionRow, operatorActions.length));
  }
  // CMS fallback for recognized plugin capabilities: one action per approved fallback (feature
  // still absent), per undecided/declined eligible capability (records not migrated), per write
  // the write-time guard refused, and per capability whose earlier CMS records no longer have a
  // valid approval. `cmsFallbackWrites` is persisted so the next run can detect withdrawal.
  const cmsFallbackInput = input.cmsFallback || null;
  const cmsFallbackWrites = cmsFallbackInput ? normalizeCmsFallbackWrites(cmsFallbackInput.writes) : [];
  if (cmsFallbackInput) {
    const derived = cmsFallbackOperatorActions({
      coverage: cmsFallbackInput.coverage || null,
      refusals: Array.isArray(cmsFallbackInput.refusals) ? cmsFallbackInput.refusals : [],
      previousWrites: normalizeCmsFallbackWrites(cmsFallbackInput.previousWrites
        || (cmsFallbackInput.previousReport && cmsFallbackInput.previousReport.cmsFallbackWrites)),
      writes: cmsFallbackWrites,
    });
    for (const row of derived) {
      if (!operatorActions.some((existing) => existing.code === row.code && existing.entity === row.entity)) {
        operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
      }
    }
  }
  const losses = asArray(input.losses, 'losses').map(normalizeLoss);
  const exclusions = asArray(input.exclusions, 'exclusions').map(normalizeExclusion);
  const callerUnresolved = asArray(input.unresolved, 'unresolved');
  const unresolved = [...callerUnresolved, ...journalUnresolvedRows(entityCompleteness, callerUnresolved)].map(normalizeUnresolved);
  const droppedFields = asArray(input.droppedFields, 'droppedFields').map(normalizeDroppedField);
  const keptForReference = normalizeKeptForReference(input.keptForReference);

  // Where the durable rows are absent for an entity that reports a shortfall, the
  // section says the shortfall is unexplained and the final status carries the mismatch. An
  // entity that lost records with nothing on record explaining how is exactly the case this check
  // exists to stop from rendering as a clean, empty section.
  //
  // Dropped fields never explain a missing record -- they are about records that did
  // land -- so they are deliberately NOT in this set. `failed` is also no longer part of this
  // predicate: a failed row now gets its own counted guard entry below, never the bare
  // reconciliation message.
  const mismatchExplainedEntities = new Set([
    ...losses.map((row) => row.entity),
    ...exclusions.map((row) => row.entity),
    ...unresolved.map((row) => row.entity),
    // A scopeOverflow row already carries its own proof of why it mismatches
    // (the headline text plus the scopeOverflow count on its mismatches entry) -- exactly as
    // self-explaining as a caller-supplied losses/exclusions/unresolved row. Never fabricate a
    // synthetic entry in one of those arrays for it; that would misrepresent a counting-error
    // row as a deliberate loss or exclusion.
    ...entityCompleteness.filter((row) => row.scopeOverflow > 0).map((row) => row.entity),
    // The member breakdown names every failed member's reason and recovery path.
    ...(memberOutcomes ? [memberOutcomes.entity] : []),
  ]);
  const unexplainedShortfalls = entityCompleteness
    .filter((row) => (row.mismatch || row.unexpectedSkipped > 0) && !mismatchExplainedEntities.has(row.entity))
    .map((row) => ({
      entity: row.entity,
      subtype: row.subtype,
      shortfall: row.expectedReconciled - row.reconciled,
      message: `${row.entity}/${row.subtype}: shortfall unexplained -- no loss, exclusion or unresolved row accounts for it`,
    }));
  // Deferred and failed are counted, not just named. A row's deferred records
  // are explained only by its own journal-backed tally and by exclusions; its failed records only
  // by its own tally and by losses -- each capped at the row's actual residual, never spilling
  // into another row (except through the gated, provenance-checked shared pool above).
  const counts = allocateUnexplainedCounts(entityCompleteness, exclusions, losses, memberOutcomes);
  entityCompleteness.forEach((row, index) => {
    const { unexplainedDeferred, unexplainedFailed } = counts[index];
    if (unexplainedDeferred > 0) {
      unexplainedShortfalls.push({
        entity: row.entity,
        subtype: row.subtype,
        outcome: 'deferred',
        shortfall: unexplainedDeferred,
        message: `${row.entity}/${row.subtype}: ${unexplainedDeferred} deferred with no recorded reason`,
      });
    }
    if (unexplainedFailed > 0) {
      unexplainedShortfalls.push({
        entity: row.entity,
        subtype: row.subtype,
        outcome: 'failed',
        shortfall: unexplainedFailed,
        message: `${row.entity}/${row.subtype}: ${unexplainedFailed} failed with no recorded reason`,
      });
    }
  });
  // An `unresolved` counter must be matched by unresolved[] rows for that entity.
  for (const row of entityCompleteness) {
    if (!row.unresolved) continue;
    const listed = unresolved.filter((entry) => entry.entity === row.entity).reduce((sum, entry) => sum + entry.count, 0);
    if (listed < row.unresolved) {
      unexplainedShortfalls.push({
        entity: row.entity,
        subtype: row.subtype,
        shortfall: row.unresolved - listed,
        message: `${row.entity}/${row.subtype}: ${row.unresolved - listed} unresolved record(s) with no unresolved row naming them`,
      });
    }
  }

  const lastWriteAt = input.lastWriteAt === undefined || input.lastWriteAt === null
    ? null
    : requireString(input.lastWriteAt, 'lastWriteAt');

  const status = chooseCompletionStatus({
    statuses: input.statuses,
    aborted: input.aborted || Boolean(interruption),
    hasMismatches: mismatches.length > 0 || verificationGaps.length > 0 || unresolved.length > 0 || unexplainedShortfalls.length > 0
      || coverageEffect.hasMismatch,
    hasFailures: hasCount(entityCompleteness, 'failed') || losses.length > 0
      || openStageResiduals.length > 0
      || blockedDataRequests.some((request) => request.aggregateOutcome === 'failed'),
    hasDeferred: hasCount(entityCompleteness, 'deferred') || blockedDataRequests.some((request) => request.aggregateOutcome === 'deferred'),
    hasRecoveredRecords: recoveryActions.length > 0 || Boolean(input.hasRecoveredRecords),
    // A deliberate exclusion is a choice, not a loss -- but an exclusion nobody gated is an
    // unreviewed filter, and that is a warning.
    hasWarnings: warnings.length > 0 || Boolean(input.hasWarnings) || droppedFields.length > 0
      || exclusions.some((row) => !row.operatorGateRecorded)
      || blockedDataRequests.some((request) => request.aggregateOutcome === 'warning')
      || coverageEffect.hasWarnings,
  });

  return {
    schemaVersion: 1,
    runId: input.runId || null,
    status,
    ...(interruption ? { interruption } : {}),
    headline,
    voucherReconciliation,
    // The bound (or rejected/omitted) coverage check and whether this run declared
    // participation in the contract at all -- `website-handoff.js` uses both to decide whether its
    // "Count cross-check" section applies to this run.
    coverageCheck: coverageEffect.coverageCheck,
    coverageCheckExpected: coverageEffect.coverageCheckExpected,
    entityCompleteness,
    stageResiduals,
    acceptedStageOutcomes,
    verificationGaps,
    sharedContactWarnings,
    verification,
    mismatches: mismatches.map((row) => ({
      entity: row.entity,
      subtype: row.subtype,
      expectedReconciled: row.expectedReconciled,
      reconciled: row.reconciled,
      unexpectedSkipped: row.unexpectedSkipped,
      scopeOverflow: row.scopeOverflow,
    })).concat(verificationGaps.map(gap => ({ ...gap, type: 'identity_value_verification' }))),
    warnings,
    recoveryActions,
    blockedDataRequests,
    operatorActions,
    cmsFallbackWrites,
    losses,
    exclusions,
    unresolved,
    droppedFields,
    keptForReference,
    unexplainedShortfalls,
    memberOutcomes,
    // The handoff proves it postdates the import by comparing its own
    // `generatedAt` against this value -- never against a file mtime, which a copy refreshes.
    lastWriteAt,
    artifacts: input.artifacts || {},
    destinations: input.destinations || {},
    urlPreservation,
  };
}

const URL_PRESERVATION_STATUS = ['verified', 'action_required', 'pending_cutover_verification', 'pending_website_build'];

function normalizeUrlPreservation(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('urlPreservation must be an object');
  // Older callers passed the import-time policy object; keep it verbatim.
  if (value.status === undefined) return { ...value, operatorActions: [] };
  if (!URL_PRESERVATION_STATUS.includes(value.status)) {
    throw new Error(`urlPreservation.status must be one of ${URL_PRESERVATION_STATUS.join(', ')}`);
  }
  return { ...value, operatorActions: asArray(value.operatorActions, 'urlPreservation.operatorActions') };
}

function causeLine(row) {
  // `unverified` renders the words and nothing else. No cause text, no hypothesis.
  if (row.causeConfidence !== 'verified-source' && row.causeConfidence !== 'verified-target') {
    return 'cause unverified';
  }
  return `${row.cause} (${row.causeConfidence}; established by ${row.check.kind} on ${row.check.target} -> ${row.check.result})`;
}

// "Permanent Losses: None" must not read as "nothing permanent happened" while
// Deliberate Exclusions lists records that were permanently left out. Only claim the
// exclusions were reviewed when every row has an operator gate recorded.
function emptyPermanentLossesLine(exclusions = []) {
  if (!exclusions.length) return '- None.';
  return exclusions.every((row) => row.operatorGateRecorded)
    ? '- None (see Deliberate Exclusions below for permanent, operator-reviewed gaps).'
    : '- None (see Deliberate Exclusions below for permanent gaps; some are not operator-reviewed).';
}

// One line per outcome for a row with a nonzero count: the tallied reasons, and
// -- only when the tallies do not already cover the whole count -- the remainder with no
// recorded reason at all. `count` always comes from the row's own field (`deferred`/`failed`),
// never from the allocation/pool step, so this line is independent of whether an exclusion or
// loss credit later clears the row in "Unexplained Shortfalls".
function reasonLine(row, outcome, totalCount) {
  const tallies = row.reasons.filter((entry) => typeof entry === 'object' && entry.outcome === outcome);
  if (!tallies.length) {
    return `- ${row.entity}/${row.subtype}: ${totalCount} ${outcome} -- no recorded reason`;
  }
  const tallySum = tallies.reduce((sum, entry) => sum + entry.count, 0);
  const remainder = totalCount - tallySum;
  const tallyText = tallies.map((entry) => `${entry.code}: ${entry.count}`).join(', ');
  const remainderText = remainder > 0 ? `; ${remainder} with no recorded reason` : '';
  return `- ${row.entity}/${row.subtype}: ${totalCount} ${outcome} -- ${tallyText}${remainderText}`;
}

// The user-facing summary is RENDERED from the report object, never
// composed independently and never derived from `execution-log.md`.
function notificationMuteLine(mute) {
  if (mute.mutedRecorded) return 'all site notifications are muted and stay muted until someone unmutes them; ask the agent to unmute';
  if (mute.answer === 'off') return 'not muted, by the operator\'s choice; customers and the owner may have received emails for imported records';
  return 'no successful mute is recorded';
}

function renderCompletionSummary(report) {
  const lines = [
    '# Migration Completion Summary',
    '',
    `- Status: ${report.status}`,
    ...(report.interruption ? [`- Interrupted: ${report.interruption.kind}${report.interruption.signal ? ` ${report.interruption.signal}` : ''}${report.interruption.code ? ` (${report.interruption.code})` : ''} at ${report.interruption.at}; this report is not final`] : []),
    `- Run id: ${report.runId || 'not recorded'}`,
    `- Last write: ${report.lastWriteAt || 'not recorded'}`,
    ...(report.voucherReconciliation ? [`- Voucher reconciliation: ${report.voucherReconciliation}`] : []),
    ...(report.notificationMute ? [`- Notifications: ${notificationMuteLine(report.notificationMute)}`] : []),
    ...(report.headline || []).map((row) => `- ${row.message}`),
    '',
    '## Urgent Operator Actions',
    '',
  ];
  if (!report.operatorActions.length) {
    lines.push('- None.');
  } else {
    for (const action of report.operatorActions) {
      lines.push(`- [${action.severity}] ${action.code}: ${action.action} (${action.affectedCount === null ? 'affected count unknown' : `${action.affectedCount} affected`}; act now because ${action.deadlineReason})`);
    }
  }

  if (report.urlPreservation && report.urlPreservation.status) {
    const u = report.urlPreservation;
    const c = u.counts || {};
    lines.push('', '## Old Links', '', `- Status: ${u.status}${u.coverageComplete === false ? ' (source redirect discovery incomplete)' : ''}`);
    lines.push(`- Verified: ${(c.verified_direct || 0) + (c.verified_redirect || 0)}; not verified: ${c.not_verified || 0}; unresolved: ${c.unresolved || 0}; manual review: ${c.manual_review || 0}; failed: ${c.failed || 0}`);
    if (u.status !== 'verified') lines.push(`- Old emails and bookmarks using unconfirmed links may fail. Details: ${u.detailPath || 'execution/url-preservation-report.md'}`);
  }
  if (report.readBack) lines.push(...require('./read-back-summary').renderReadBackSummary(report.readBack));

  lines.push('', '## Per-Entity Reconciliation', '', '| Entity | Extracted | In scope | Landed | Unreconciled |', '| --- | --- | --- | --- | --- |');
  if (!report.entityCompleteness.length) {
    lines.push('| (none) | 0 | 0 | 0 | 0 |');
  } else {
    for (const row of report.entityCompleteness) {
      lines.push(`| ${row.entity}/${row.subtype} | ${row.extracted} | ${row.inScope} | ${row.imported + row.alreadyPresentByCrosswalk} | ${row.expectedReconciled - row.reconciled} |`);
    }
  }

  if (report.mappingRecovery) {
    const c=report.mappingRecovery.counts || {};
    lines.push('', '## Pending mapping work', '',
      `- Landed with pending fields: ${c['landed-with-pending-fields'] ?? 'unknown'}; not yet imported: ${c['not-yet-imported'] ?? 'unknown'}; needs reconciliation: ${c['needs-reconciliation'] ?? 'unknown'}.`,
      '- These fields and records are retained recovery work. They are not permanent exclusions or completed data.');
    if (report.mappingRecovery.unknownCounts) lines.push('- Recovery evidence is unavailable or inconsistent. Requires Import Operator: restore the named evidence before resolving these gaps.');
  }
  lines.push('', '## Permanent Losses', '');
  if (!report.losses.length) lines.push(emptyPermanentLossesLine(report.exclusions));
  else for (const row of report.losses) lines.push(`- ${row.entity}: ${row.count} lost (${row.reasonCode}); ${row.whyNoRetry}; ${causeLine(row)}`);

  lines.push('', '## Deliberate Exclusions', '');
  if (!report.exclusions.length) lines.push('- None.');
  else for (const row of report.exclusions) lines.push(`- ${row.entity}: ${row.count} excluded (${row.reasonCode}); ${row.rationale}; operator gate recorded: ${row.operatorGateRecorded}`);

  lines.push('', '## Unresolved And Orphaned', '');
  if (!report.unresolved.length) lines.push('- None.');
  else for (const row of report.unresolved) lines.push(`- ${row.entity}: ${row.count} ${row.kind}; ${causeLine(row)}`);

  lines.push('', '## Fields Dropped For The Destination', '');
  if (!report.droppedFields.length) lines.push('- None.');
  else for (const row of report.droppedFields) lines.push(`- ${row.entity}.${row.field}: ${row.recordCount} records (${row.reasonCode})`);

  if (report.keptForReference) {
    const k = report.keptForReference;
    if (k.applied === false) lines.push('', '## Kept For Reference', '', `- The archive plan was not applied by this run's importer (${k.writtenRows} archive rows journaled, ${k.unplannedRows} not in the plan). The archive holds what the importer wrote; the planned packing and the IP / user-agent drop are not confirmed for it.`);
    else lines.push('', '## Kept For Reference', '', `- ${k.collectionName}: ${k.totalItems} CMS items${k.heldItems ? `, ${k.heldItems} waiting for CMS item room` : ''}. Not used by the live site.`, `- How to find a record: ${k.howToFind}`);
    for (const row of k.entities) lines.push(`- ${row.sourceEntity} (\`${row.collectionId}\`): ${row.recordsArchived} records in ${row.items} items${row.archiveOnly ? ' (no Wix home; one row each)' : ''}${row.groups.length ? `; ${row.groups.join(', ')}` : ''}${row.notKept ? `; ${row.notKept} source fields not kept (see the #info row)` : ''}`);
    for (const task of k.optionalTasks || []) lines.push(`- ${task.title}. ${task.action}`, `  - To re-import (${task.role} asks): ${task.importOperatorPrompt}`);
  }

  if ((report.acceptedStageOutcomes || []).length) {
    lines.push('', '## Accepted And Materialized Gaps', '');
    for (const row of report.acceptedStageOutcomes) lines.push(`- ${stageResidualAction(row)}`);
  }

  if (report.memberOutcomes) {
    const m = report.memberOutcomes;
    lines.push('', '## Members', '', `- Population: ${m.populationBasis}`);
    for (const [cls, entry] of Object.entries(m.byClass || {})) {
      lines.push(`- ${entry.outcome}${cls !== entry.outcome && /^(failed-|reconciled-)/.test(cls) ? ` (${cls})` : ''}: ${entry.count}${entry.count && entry.nextAction ? ` -- ${entry.nextAction}` : ''}`);
    }
    if (m.danglingStarted) lines.push(`- write started, never concluded: ${m.danglingStarted}`);
    if (m.unexpectedSkipped) lines.push(`- no journal row: ${m.unexpectedSkipped}`);
    for (const [code, n] of Object.entries(m.byFinding)) lines.push(`- finding ${code}: ${n}`);
  }

  if (report.recoveryActions.length) {
    lines.push('', '## Recovery Actions', '');
    for (const row of report.recoveryActions) lines.push(`- ${row.action}`);
  }

  // Before "Unexplained Shortfalls": a reader sees why records did not land
  // without opening JSON, and sees the unexplained remainder on the same line.
  lines.push('', '## Why Records Did Not Land', '');
  const reasonRows = report.entityCompleteness.filter((row) => row.deferred > 0 || row.failed > 0);
  if (!reasonRows.length) {
    lines.push('- None.');
  } else {
    for (const row of reasonRows) {
      if (row.deferred > 0) lines.push(reasonLine(row, 'deferred', row.deferred));
      if (row.failed > 0) lines.push(reasonLine(row, 'failed', row.failed));
      for (const entry of row.reasons.filter((r) => typeof r === 'string')) {
        lines.push(`  - note: ${entry}`);
      }
    }
  }

  if (report.unexplainedShortfalls.length) {
    lines.push('', '## Unexplained Shortfalls', '');
    for (const row of report.unexplainedShortfalls) lines.push(`- ${row.message}`);
  }

  if (Array.isArray(report.toolkitGaps) && report.toolkitGaps.length) {
    lines.push('', '## Toolkit Gaps Worked Around In This Run', '');
    for (const row of report.toolkitGaps) lines.push(`- ${row.step} ${row.kind === 'patch' ? 'patched' : row.kind === 'prefill-edit' ? 'changed' : row.kind === 'extract-count-gap' ? 'count differs' : 'overridden'} in ${row.file}: ${row.why || 'no reason given'}. Fix in the toolkit; no action on the site.`);
  }

  // Only a joined (schema v2) report carries this; an un-joined in-memory report
  // renders exactly as before.
  if (Array.isArray(report.sourceCoverage)) {
    lines.push('', '## Not Migrated From The Source', '');
    if (report.sourceCoverageRecorded === false) lines.push('- Source coverage was not recorded for this run (discovery predates the coverage contract).');
    else if (!report.sourceCoverage.length) lines.push('- None.');
    else for (const row of report.sourceCoverage) lines.push(sourceCoverageLine(row));
  }

  return `${lines.join('\n')}\n`;
}

function sourceCoverageLine(row) {
  const label = row.capability || row.sourceEntity;
  return `- ${label} (${row.reason}; ${row.treatment}): ${row.cutoverAction}`;
}

async function writeFileAtomic(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, text, 'utf8');
  await fs.rename(tempPath, filePath);
}

// Before this, `createCompletionReport` built the object and nothing
// shipped wrote it: the codegen snippet told generated importers to "persist it using the shared
// runtime" and the shared runtime had no such function, so no non-quick-mode run ever produced
// the artifact its own completion gate keys on. One shared writer, and the summary rendered from
// the same object it just wrote.
//
// The source-coverage join happens HERE, inside the one writer, so status is
// computed once from everything. `createCompletionReport` already chose a status before this
// function sees the project; folding the coverage floor in with the same rank (`worseStatus`)
// equals a one-pass computation. The written artifact is schema v2.
async function joinSourceCoverage(projectDir, report) {
  if (Object.prototype.hasOwnProperty.call(report, 'sourceCoverage') || Object.prototype.hasOwnProperty.call(report, 'sourceCoverageRecorded')) {
    throw new Error('writeCompletionReport: the report already carries sourceCoverage; the writer owns that join and a caller cannot pre-empt it');
  }
  // Throws on a stamped project whose coverage file is missing, malformed or unreconciled.
  const coverage = await summarizeProjectCoverage(projectDir);
  const giftCards = await evaluateGiftCardCutover(projectDir);
  const operatorActions = [...asArray(report.operatorActions, 'operatorActions')].filter((row) => row.code !== GIFT_ACTION_CODE);
  for (const row of coverage.operatorActions) {
    operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
  }
  const linkAudit = await readLinkAudit(projectDir);
  for (const row of linkOperatorActions(linkAudit)) {
    if (!operatorActions.some((existing) => existing.code === row.code)) operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
  }
  const linkStatus = linkAudit && linkOperatorActions(linkAudit).length ? 'complete_with_warnings' : null;
  // Remaining Editor website/publication work. A caller-supplied row with the
  // same code is authoritative and is never duplicated.
  for (const row of await projectDestinationOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.code === row.code)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // The source archive plan: what was kept for reference. A caller-supplied block wins.
  // It is shown only when the journal proves the importer wrote the planned items; otherwise the
  // report says the plan was not applied instead of claiming its counts and drops.
  const archiveSummary = require('./source-archive-summary.js');
  const archivePlan = report.keptForReference ? null : archiveSummary.readArchivePlanSummary(projectDir);
  let keptForReference = report.keptForReference || null;
  if (archivePlan) {
    const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch((error) => { if (error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING') return { rows: [] }; throw error; });
    const check = archiveSummary.archivePlanApplied(archivePlan, rows);
    keptForReference = check.applied ? normalizeKeptForReference(archivePlan.keptForReference) : normalizeKeptForReference({
      collectionName: archivePlan.keptForReference.collectionName, policyRef: archivePlan.keptForReference.policyRef,
      applied: false, writtenRows: check.written, unplannedRows: check.unplanned, totalItems: 0, entities: [], optionalTasks: [],
      howToFind: archivePlan.keptForReference.howToFind,
    });
  }
  // A read-only CMS archive scan is durable evidence for the cutover operator. Join it here so
  // completion-report.json and the post-execution handoff carry the same cleanup item.
  for (const row of duplicateArchiveOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Generated code that did the toolkit's job and was still not fixed when the import ran
  // (import-contract-verify codegenFindings): a gap in the fixed code.
  for (const row of codegenFindingOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Source access that outlives the migration (the Shopify staff account) is an
  // operator action beside the coverage rows until its removal is confirmed. It is an action, not
  // a coverage gap, so status is unchanged.
  for (const row of sourceAccessOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.code === row.code && existing.entity === row.entity)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // A business-address issue setup reported instead of stopping (a read-back difference or an
  // unreadable source): a Business Manager task for the Cutover Operator.
  // Records held for a bad contact address shape (journal reason CONTACT_ADDRESS_SHAPE_INVALID).
  for (const row of [...require('./business-contact-setup.js').businessContactOperatorActions(projectDir),
    ...require('./contact-address-contract.js').contactAddressOperatorActions(report.entityCompleteness)]) {
    if (!operatorActions.some((existing) => existing.actionId === row.actionId)) operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
  }
  // Mapping may accept withheld Shopify details, but Shopify remains their only
  // copy until the merchant's export is confirmed after the latest read. This action is separate
  // from sourceCoverage's disposition and does not change report status.
  for (const row of withheldDetailsOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.code === row.code && existing.entity === row.entity)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // The store's currency, time zone and language: unknowns, questions, gate refusals and warnings.
  // Rows carry their own entity (the setting or the refused task), so none collapses under code + entity.
  const regional = require('./site-regional.js').regionalReportRows(projectDir);
  for (const row of regional.operatorActions) {
    if (!operatorActions.some((existing) => existing.code === row.code && existing.entity === row.entity)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Products and categories that were on the store before this import: seeded samples
  // setup could not delete, pre-existing items, and source records held on a collision with them.
  const catalog = require('./catalog-baseline.js').reportRows(projectDir);
  for (const row of catalog.operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Pricing-plan subscriptions: billing that no longer runs on its own, contracts kept as history,
  // and orders that did not land live or cleanly (execution/outcomes/plan-order.json).
  const planOrders = require('./plan-order-outcome-registry.js').reportRows(projectDir);
  for (const row of planOrders.operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // A plan change after import: records not yet updated, records whose plan is unknown, values
  // the plan stopped writing that stay on the site, and what was updated (lib/plan-update-pass.js).
  for (const row of require('./plan-update-pass.js').reportRows(projectDir).operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // The after-codegen dry run still disagreeing with the plan when the run is reported
  // (state/attempts/field-mapping-examples/<pass>.result.json for the current plan).
  for (const row of require('./field-mapping-examples.js').reportRows(projectDir).operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  const multilingual = require('./multilingual-public-report.js').multilingualReportRows(projectDir);
  for (const row of multilingual.operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Product videos: linked videos to add by hand, and planned video files not on their product.
  const productVideos = require('./product-videos.js').reportRows(projectDir);
  for (const row of productVideos.operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Toolkit files or vendored copies changed during the run and restored (or a patch accepted).
  for (const row of require('./toolkit-integrity.js').reportRows(projectDir).operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Fields left unmigrated by a read-back unit the run settled after its pass limit.
  for (const row of require('./route-settlement.js').reportRows(projectDir).operatorActions) {
    if (!operatorActions.some((existing) => existing.actionId && existing.actionId === row.actionId)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  if (giftCards.action) operatorActions.push(normalizeOperatorAction(giftCards.action, operatorActions.length));
  // Finished extracts whose count differs from the source's count (records changed during the read).
  const extractCountGaps = require('./extract-count.js').recordExtractCountGaps(projectDir);
  const toolkitGaps = require('./toolkit-gaps.js').readToolkitGaps(projectDir);
  const sourceCoverage = coverage.sourceCoverage.map((row) => (row.coverageId === GIFT_CODES_COVERAGE_ID
    ? { ...row, cutoverAction: giftCards.cutoverAction || row.cutoverAction }
    : row));
  const joinedStatus = multilingual.operatorActions.length
      ? worseStatus(linkStatus ? worseStatus(coverage.status ? worseStatus(report.status, coverage.status) : report.status, linkStatus)
        : coverage.status ? worseStatus(report.status, coverage.status) : report.status, 'complete_with_warnings')
      : linkStatus ? worseStatus(coverage.status ? worseStatus(report.status, coverage.status) : report.status, linkStatus)
        : coverage.status ? worseStatus(report.status, coverage.status) : report.status;
  // A sample a delete missed, a held collision, or a plan-order cutover item leaves work before go-live.
  const catalogWarns = catalog.operatorActions.some((row) => row.severity === 'high') || planOrders.operatorActions.some((row) => row.severity === 'high');
  return {
    ...report,
    schemaVersion: 2,
    status: catalogWarns ? worseStatus(joinedStatus, 'complete_with_warnings') : joinedStatus,
    headline: [...asArray(report.headline, 'headline'), ...coverage.headline, ...regional.headline, ...multilingual.headline],
    operatorActions,
    ...(linkAudit ? { linkAudit: {
      path: LINK_AUDIT_PATH, stage: linkAudit.stage, counts: linkAudit.counts, estimate: linkAudit.estimate || null,
      pendingOccurrenceIds: linkAudit.pendingDestinations.flatMap((row) => row.occurrenceIds),
      unresolvedOccurrenceIds: linkAudit.unresolved.flatMap((row) => row.occurrenceIds),
      pendingWriterFields: (linkAudit.writerIntegrations || []).filter((row) => row.status === 'pending').map((row) => row.field),
      missingCutoverUiIntegration: true,
    } } : {}),
    ...(catalog.destinationBaseline ? { destinationBaseline: catalog.destinationBaseline } : {}),
    keptForReference,
    sourceCoverageRecorded: coverage.sourceCoverageRecorded,
    ...(coverage.sourceCoverageReason ? { sourceCoverageReason: coverage.sourceCoverageReason } : {}),
    sourceCoverage,
    // In-run overrides (lib/toolkit-gaps.js): shown, never an operator action.
    ...(toolkitGaps.length ? { toolkitGaps } : {}),
    ...(extractCountGaps.length ? { extractCountGaps } : {}),
  };
}

// What the extract ledger repaired or could not (execution/extract-integrity.json). The latest
// event per extract decides: a re-extract that still lost fields, or a refused re-read, is an
// operator action; a clean repair is a recorded event only.
async function extractIntegrityActions(projectDir) {
  const latest = new Map();
  for (const event of await require('./extract-ledger').reportEvents(projectDir)) latest.set(event.extractPath, event);
  const result = [];
  for (const event of latest.values()) {
    if (event.action === 're-extracted' && event.lostPaths?.length) result.push({ code: 'source-extract-fields-lost', severity: 'warning', entity: event.entity,
      affectedCount: Math.max(...event.lostPaths.map(row => row.records)), cause: { extractPath: event.extractPath, lostPaths: event.lostPaths.map(row => row.path), before: event.before, after: event.after },
      deadlineReason: 'Resolve before launch; the import continued without these source fields.',
      action: `Requires Import Operator. Prerequisites: original migration project and source access. Copy prompt: execution/extract-integrity.json shows ${event.entity} re-extracted from the source with ${event.lostPaths.length} fields still missing on unchanged records (${event.extractPath}). Fix src/extract/run-extract.js so it keeps every source field, run it with --entity ${event.entity}, then rerun the import for ${event.entity}; already-imported records are updated, never duplicated.` });
    if (event.action === 'refused') result.push({ code: 'source-extract-unreadable', severity: 'blocker', entity: event.entity, affectedCount: event.before?.rows ?? null, cause: { extractPath: event.extractPath, reason: event.reason, trigger: event.trigger },
      deadlineReason: 'Resolve before launch; this entity was not imported because its source could not be re-read.',
      action: `Requires Import Operator. Prerequisites: original migration project and source access. Copy prompt: Re-extraction of ${event.entity} failed (${event.reason}; see execution/extract-integrity.json). Check source credentials, make src/extract/run-extract.js accept --entity ${event.entity}, run it, then rerun the import for ${event.entity}.` });
  }
  return result;
}
// Records an operator's source filter (plan entities[].sourceFilter) left out of the extract
// (data/source-extract/manifest.json rows written by rp-source-wordpress catalog-extractor.js).
// A filter is a choice, not a failure, but every record left behind is listed for the site owner.
async function sourceFilterActions(projectDir) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'data/source-extract/manifest.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return []; throw error; }
  const result = [];
  for (const row of Array.isArray(manifest.entities) ? manifest.entities : []) {
    if (!row?.filter || typeof row.filter !== 'object' || row.sample) continue;
    const left = Number.isInteger(row.unfilteredTotal) && Number.isInteger(row.sourceTotal) ? Math.max(0, row.unfilteredTotal - row.sourceTotal) : null;
    if (left === 0) continue;
    const filter = Object.entries(row.filter).map(([key, value]) => `${key}=${value}`).join(', ');
    result.push({ code: 'source-filter-excluded', severity: 'low', entity: row.entity, affectedCount: left,
      actionId: `source-filter-excluded:${row.entity}`, role: 'site-owner',
      cause: { filter: row.filter, extracted: row.sourceTotal ?? null, unfilteredTotal: row.unfilteredTotal ?? null },
      artifactRefs: ['data/source-extract/manifest.json', 'mapping/mapping-plan.json'],
      prerequisites: [],
      resolutionEvidence: 'The site owner confirms the records outside the filter are not needed, or the plan filter is removed and the entity is extracted and imported again.',
      deadlineReason: 'Confirm before launch; these source records were not migrated.',
      action: `${left === null ? 'Some' : left} ${row.entity} records were not migrated because the plan filter (${filter}) left them out of the extract. Confirm they are not needed on the new site. To bring them over, remove the filter in mapping/mapping-plan.json and run the extract and import for ${row.entity} again; already-imported records are not duplicated.` });
  }
  return result;
}
// Records the plan's record rule kept out of the import (runRecordTask journals each one
// `skipped_out_of_scope` with outOfScope.code 'skipped-by-plan'). One site-owner action per task:
// the store owner confirms the rule, or changes it and the import is rerun. The latest row per
// record decides, so a record the rule no longer matches drops out of the action.
async function planSkipActions(projectDir) {
  const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch(error => { if (error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING') return { rows: [] }; throw error; });
  const latest = new Map(rows.map(row => [`${row.writeSpecId}\n${row.sourceStableKey}`, row]));
  const byTask = new Map();
  for (const row of latest.values()) {
    if (row.status !== 'skipped_out_of_scope' || row.outOfScope?.code !== 'skipped-by-plan') continue;
    const group = byTask.get(row.writeSpecId) || { keys: [], rule: row.outOfScope.rule, reason: row.outOfScope.reason, entity: row.targetEntityType };
    group.keys.push(row.sourceStableKey); byTask.set(row.writeSpecId, group);
  }
  return [...byTask].map(([taskId, group]) => {
    const keys = group.keys.sort();
    return { actionId: `skipped-by-plan:${taskId}`, code: 'skipped-by-plan', severity: 'medium', role: 'site-owner', entity: taskId, affectedCount: keys.length, affectedIds: keys,
      action: `Site owner: ${keys.length} ${group.entity} record(s) were not imported because of the migration plan's record rule: ${group.rule} (${group.reason}). Confirm that is what you want. If some of them should be on the new site, ask the Import Operator to change or remove this record rule in the plan and rerun task ${taskId}; nothing needs to be removed.`,
      deadlineReason: 'Before launch: these records are deliberately not on the new site.',
      artifactRefs: ['mapping/mapping-plan.json', 'state/attempts/write-attempts.ndjson'], prerequisites: ['the migration plan\'s record rule for this entity'],
      resolutionEvidence: `The site owner confirms the rule, or a rerun of task ${taskId} after the rule changed imports the wanted records.` };
  });
}

// Entities the run selected for extraction that nothing could read: no catalog entry and no run
// extra (a plugin or custom route). The extract continues; each one is an Import Operator task.
async function sourceUnreadActions(projectDir) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'data/source-extract/manifest.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return []; throw error; }
  // An entity the plan already deferred has its own mapping-scope-deferred action; never two items.
  let plan = null;
  try { plan = JSON.parse(await fs.readFile(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const deferred = new Set((plan?.executionScope?.deferredEntities || []).map((row) => row?.entityRef));
  return (Array.isArray(manifest.entities) ? manifest.entities : []).filter((row) => row?.unread && !row.sample && !deferred.has(row.entity)).map((row) => ({
    code: 'source-entity-unread', severity: 'high', entity: row.entity, affectedCount: null,
    actionId: `source-entity-unread:${row.entity}`, role: 'import-operator',
    cause: { reason: row.unread },
    artifactRefs: ['data/source-extract/manifest.json', 'mapping/mapping-plan.json', 'source-schema.json'],
    prerequisites: ['Original migration project', 'Source access (config/source.wordpress.env)'],
    resolutionEvidence: `data/source-extract/manifest.json has a complete row for ${row.entity} and its records are imported, or the plan excludes ${row.entity} with a reason.`,
    deadlineReason: 'Resolve before launch; this entity was selected for migration but none of its records were read.',
    action: `Requires Import Operator. ${row.entity} was selected for migration, but no reader exists for it, so none of its records were read or imported.`,
    importOperatorPrompt: `In the migration project, ${row.entity} has no reader (data/source-extract/manifest.json row unread: ${row.unread}). Find its route in source-schema.json, add an entry for it to src/extract/reader-catalog.extra.json (or a reader module under src/extract/readers/ when the route is not a plain collection), run node src/extract/run-extract.js --entity ${row.entity}, then rerun the import for ${row.entity}.` }));
}
async function dependencyOperatorActions(projectDir) {
  let diagnostic;
  try { diagnostic = JSON.parse(await fs.readFile(path.join(projectDir, 'execution/dependency-readiness.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch(error => { if (error.code === 'ENOENT') return { rows: [] }; throw error; });
  const recovery = require('./dependency-recovery'), importRecovery = require('./import-recovery'), indexes = new Map(), result = [];
  let latestByKey;
  const latestAttempt = () => latestByKey ||= new Map(rows.map(row => [`${row.writeSpecId}\n${row.sourceStableKey}`, row]));
  for (const task of Object.values(diagnostic.tasks || {})) if (!indexes.has(task.siteId)) indexes.set(task.siteId, recovery.foldRecoveryAttempts(rows, task.siteId));
  for (const task of Object.values(diagnostic.tasks || {})) {
    const waiting = recovery.waitingForTask(indexes.get(task.siteId), task.taskId);
    const groups = new Map();
    for (const block of task.blocked || []) { if (block.ref === 'site/locale') continue; groups.set(`${block.ref}:${block.recovery}`, { ref: block.ref, recovery: block.recovery, count: task.affectedCount ?? null }); }
    // A record waiting on an owner-held record is its own item, with the hold as cause.
    const held = new Map(), finals = new Map();
    for (const row of waiting) {
      if (row.deferral?.final === true) {
        for (const cause of row.deferral.finalCauses || []) {
          const childStatus = String(cause.parentStatus || '').startsWith('child-');
          const key = `${cause.ref}\n${cause.parentStatus}`, group = finals.get(key) || { ref: cause.ref, parentStatus: cause.parentStatus, linkChoice: cause.linkChoice, linkRequired: Boolean(cause.linkRequired), producerTaskId: cause.producerTaskId ?? null, keys: new Set(), parents: new Set(), childDependencies: new Set(), dependencyKeys: new Set(), holdReasons: new Set() };
          group.keys.add(row.sourceStableKey);
          if (cause.parentSourceKey) group.parents.add(cause.parentSourceKey);
          else if (childStatus) group.childDependencies.add(cause.sourceStableKey);
          else group.parents.add(cause.sourceStableKey);
          group.dependencyKeys.add(cause.sourceStableKey);
          for (const reason of cause.holdReasons || []) group.holdReasons.add(reason); finals.set(key, group);
        }
        continue;
      }
      const causes = require('./dependency-readiness').holdCausesOf(row.deferral);
      for (const ref of new Set(causes.map(cause => cause.ref))) {
        const group = held.get(ref) || { ref, keys: new Set(), reasons: new Set(), count: 0 };
        for (const cause of causes.filter(cause => cause.ref === ref)) { group.keys.add(cause.sourceStableKey); for (const reason of cause.holdReasons || []) group.reasons.add(reason); }
        group.count++; held.set(ref, group);
      }
      // A record that also waits on something other than a hold keeps that recovery item too.
      if (row.deferral.reason === 'dependency-held') continue;
      // A plan hold (the builder held the record by a plan rule) is not a missing reference: its
      // own builder row or cutover-coverage records-deferred names it, with the hold reason.
      if (row.deferral.reason === 'builder-held' && !row.deferral.ref) continue;
      const ref = row.deferral.ref || row.deferral.reason, key = `${ref}:resume-deferred`; if (!groups.has(key)) groups.set(key, { ref, recovery: 'resume-deferred', count: 0, keys: new Set() }); groups.get(key).count++; groups.get(key).keys.add(row.sourceStableKey);
    }
    for (const group of finals.values()) {
      const parents = [...group.parents].sort(), dependencyKeys = [...group.dependencyKeys].sort(), keys = [...group.keys].sort(), heldParent = group.parentStatus === 'held';
      const parentRecovery = importRecovery.dependencyParentRecovery(group.parentStatus);
      const producerTask = group.producerTaskId || group.ref;
      const producerCommand = parentRecovery.flag ? `run-import:${producerTask} ${parentRecovery.flag}` : null;
      const sourceScope = parents.length
        ? `parent source key(s) ${parents.join(', ')}`
        : `child dependency source key(s) ${[...group.childDependencies].sort().join(', ')}; no verified parent source key is available`;
      const fix = heldParent
        ? `the owner hold on ${parents.join(', ')} (execution/read-back-inventory records[].held${group.holdReasons.size ? `; holds: ${[...group.holdReasons].sort().join(', ')}` : ''})`
        : `${sourceScope} (status ${group.parentStatus}); ${parentRecovery.prerequisite}${producerCommand ? `, then run its task with ${producerCommand}` : ''}`;
      const waiverCommand = `node skills/wix-replatform/scripts/link-waiver.js record --project-dir <project> --task ${task.taskId} --ref ${group.ref} --record <dependent source key> --parent <parent source key> --decided-by <who> --reason <why>`;
      result.push({ code: 'dependency-parent-final', severity: 'blocker', entity: task.taskId, affectedCount: keys.length, affectedSourceKeys: keys,
        cause: { ref: group.ref, parentStatus: group.parentStatus, parentSourceKeys: parents, ...(group.childDependencies.size || dependencyKeys.join() !== parents.join() ? { dependencySourceKeys: dependencyKeys } : {}), producerTaskId: group.producerTaskId, ...(group.holdReasons.size ? { holdReasons: [...group.holdReasons].sort() } : {}) }, linkChoice: group.linkChoice, ...(group.linkRequired ? { linkRequired: true } : {}),
        deadlineReason: 'Resolve before launch; these records are not on the new site because the parent record they link to did not land.',
        action: `Requires Import Operator. Prerequisites: original migration project, source snapshot and current-site access. Fix and re-run: fix ${fix}, then resume task ${task.taskId} with --deferred-only; the records import with their ${group.ref} link. Do not resend existing orders.`,
        ...(group.linkChoice === 'offer-omit' && !group.linkRequired ? { optInAction: `Import now without the ${group.ref === 'stores/product' ? 'product' : group.ref} link (explicit opt-in; the records stay on the new site without that link). Requires Import Operator: record the choice per record with ${waiverCommand}, then resume task ${task.taskId} with --deferred-only.` } : {}),
        withoutLinkOnRequest: group.linkRequired ? 'impossible' : group.linkChoice === 'offer-omit' ? 'offered' : 'warn-then-import' });
    }
    for (const group of held.values()) result.push({ code: 'dependency-held-record', severity: 'blocker', entity: task.taskId, affectedCount: group.count, cause: { ref: group.ref, heldSourceKeys: [...group.keys].sort(), holdReasons: [...group.reasons].sort() },
      deadlineReason: 'Resolve before DNS change or launch; these records wait on records the owner held and are not on the new site.',
      action: `Requires Import Operator. Prerequisites: original migration project and current-site access; retain existing owner approvals. Copy prompt: Inspect execution/dependency-readiness.json task ${task.taskId} heldDependencies for ${group.ref} and execution/read-back-inventory records[].held (holds: ${[...group.reasons].sort().join(', ')}). For each hold the owner has now resolved, update the mapping, rerun the inventory, get the mapping re-approved and import the released records; then resume task ${task.taskId} with --deferred-only. If the owner accepts the loss instead, record it as an approved omission. Do not resend existing orders.` });
    for (const group of groups.values()) result.push({ code: 'dependency-readiness-blocked', severity: 'blocker', entity: task.taskId, affectedCount: group.count,
      // The waiting records by source key (a task-level block has none: the task id names it).
      ...(group.keys?.size ? { affectedSourceKeys: [...group.keys].filter(Boolean).sort() } : {}), cause: { ref: group.ref },
      deadlineReason: 'Resolve before launch; affected dependent records have not finished importing.',
      action: `Requires Import Operator. Prerequisites: original migration project, source snapshot and current-site access; retain existing owner approvals. Copy prompt: Inspect execution/dependency-readiness.json task ${task.taskId} and ref ${group.ref}; resolve ${group.recovery}, re-evaluate and resume only eligible deferred records. Read back uncertain writes, never infer completion from old-site evidence and do not resend existing orders. Completion requires terminal outcomes for dependent records as well as repaired prerequisites.` });
    // A runtime gap: a record its transform deferred with a named reference blocker, or one the
    // shared runner wrote with a recorded loss. Kept in the runtime diagnostic, not the reviewed
    // mapping gaps.
    for (const gap of task.referenceGaps || []) {
      const records = gap.records || gap.affectedSourceKeys.map(sourceStableKey => ({ sourceStableKey }));
      // The text names at most 50 records; the structured `records` and the diagnostic keep all of them.
      const list = records.slice(0, 50).map(({ sourceStableKey, ...facts }) => `${sourceStableKey}${Object.keys(facts).length ? ` (${Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`).join('; ')
        + (records.length > 50 ? `; and ${records.length - 50} more (execution/dependency-readiness.json lists each)` : '');
      // A Cutover Operator gap is resolved in Business Manager on the landed records: no original
      // migration environment, so no Import Operator prompt.
      const cutover = gap.operatorRole === 'Cutover Operator';
      const prompt = `Requires Import Operator. Prerequisites: original migration project, source snapshot and current-site access; retain existing owner approvals. Copy prompt: Inspect execution/dependency-readiness.json task ${task.taskId} referenceGaps code ${gap.code}. ${gap.action} Records: ${list}.`;
      result.push({ code: 'dependency-reference-gap', severity: gap.severity || 'blocker', entity: task.taskId, affectedCount: records.length, affectedSourceKeys: records.map(r => r.sourceStableKey).sort(), records, reasonCode: gap.code,
        ...(cutover ? { operatorRole: 'Cutover Operator' } : {}),
        // The structured cutover form (actionId, role, prompt, ids, artifact, evidence).
        actionId: `dependency-reference-gap:${task.taskId}:${gap.code}`, role: cutover ? 'cutover-operator' : 'import-operator',
        ...(cutover ? {} : { importOperatorPrompt: prompt }),
        affectedIds: records.map(r => r.targetId).filter(id => typeof id === 'string' && id).sort(),
        artifactRefs: ['execution/dependency-readiness.json'],
        prerequisites: cutover ? ['Business Manager access to the new site'] : ['original migration project', 'source snapshot', 'current-site access'],
        resolutionEvidence: `execution/dependency-readiness.json task ${task.taskId} no longer lists referenceGaps code ${gap.code} for these records.`,
        deadlineReason: gap.written ? 'Resolve before launch; the affected records are on the new site with the recorded loss.' : 'Resolve before launch; the affected records were not written.',
        action: cutover
          ? `Cutover Operator, in Business Manager. ${gap.action} Records: ${list}.`
          : prompt });
    }
    // A within-write dependency (product media from URLs) the landed parent initiated but
    // read-back has not yet verified. The parent keeps its target ID; it is never recreated.
    const gaps = new Map();
    for (const gap of task.withinWriteGaps || []) { const key = `${gap.ref}:${gap.code}`; if (!gaps.has(key)) gaps.set(key, { ref: gap.ref, code: gap.code, keys: [] }); gaps.get(key).keys.push(gap.sourceStableKey); }
    for (const group of gaps.values()) result.push({ code: 'within-write-unverified', severity: 'blocker', entity: task.taskId, affectedCount: group.keys.length, affectedSourceKeys: group.keys.sort(), reasonCode: group.code,
      deadlineReason: 'Resolve before launch; the affected records landed but their within-write dependency is not verified.',
      action: `Requires Import Operator. Prerequisites: original migration project and current-site access. Copy prompt: Inspect execution/dependency-readiness.json task ${task.taskId} withinWriteGaps for ${group.ref}; read back each recorded target ID, record the gap resolved only when the current read-back verifies it, and otherwise follow the existing ${group.ref} recovery for that record. Do not recreate or resend the landed records; a timeout is not proof of permanent loss.` });
    // A record written without a dependency whose own record failed for good (a product image):
    // only rows whose record landed on this site are open items; the rest never reached the site.
    const omitted = new Map();
    for (const row of task.omittedReferences || []) {
      // The record's writer already reported this omission as its own cutover item.
      if (row.cutoverItem) continue;
      const latest = latestAttempt().get(`${task.taskId}\n${row.sourceStableKey}`);
      if (latest?.siteId !== undefined && latest.siteId !== row.siteId) continue;
      if (!['imported', 'skipped_already_imported'].includes(latest?.status)) continue;
      const group = omitted.get(row.ref) || { ref: row.ref, keys: new Set(), dependencyKeys: new Set() };
      group.keys.add(row.sourceStableKey); group.dependencyKeys.add(row.dependencySourceKey); omitted.set(row.ref, group);
    }
    for (const group of omitted.values()) result.push({ code: 'dependency-omitted-after-failure', severity: 'blocker', entity: task.taskId, affectedCount: group.keys.size, affectedSourceKeys: [...group.keys].sort(), cause: { ref: group.ref, failedSourceKeys: [...group.dependencyKeys].sort() },
      deadlineReason: 'Resolve before launch; these records are on the new site without some of their ' + group.ref + ' references.',
      action: `Requires Import Operator. Prerequisites: original migration project and current-site access. Copy prompt: Inspect execution/dependency-readiness.json task ${task.taskId} omittedReferences for ${group.ref}. Re-import each missing ${group.ref} record with its task's --failed-only (for an unchecked: key, first find the source record the unresolved id was meant to name), then run the media patch pass (omittedReady, gate the record with its full reference list, the reviewed update, recordOmissionsResolved); rows still listed after it need a manual fix. If the source file is gone, record the loss as an approved omission. Do not recreate or resend the landed records.` });
  }
  // The readiness diagnostic keeps its own 'blocker' severity; an operatorAction's scale is
  // OPERATOR_ACTION_SEVERITIES, so it is reported as 'critical' and normalizeOperatorAction keeps it.
  return result.map(action => (action.severity === 'blocker' ? { ...action, severity: 'critical' } : action));
}
// Persisted blocked-data requests the caller did not pass: a declined or missing
// request is an open blocker for cutover whether or not the importer remembered it. A request
// whose record is invalid is named in warnings instead of failing the whole report.
const BLOCKED_STATUS_EFFECT = { failed: 'incomplete_with_failures', deferred: 'complete_with_deferred_records', warning: 'complete_with_warnings' };
async function joinBlockedDataRequests(projectDir, report) {
  const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch((error) => { if (error.code === 'ENOENT') return { rows: [] }; throw error; });
  const listed = new Set((report.blockedDataRequests || []).map((row) => row.sourceEntityRef));
  const joined = [];
  for (const request of await require('./blocked-data-requests.js').completionReportInput(projectDir, rows)) {
    if (listed.has(request.sourceEntityRef)) continue;
    try { joined.push(normalizeBlockedDataRequest(request, joined.length)); } catch (error) {
      report.warnings = [...(report.warnings || []), `blocked-data request ${request.sourceEntityRef} could not be reported: ${error.message}`];
    }
  }
  if (!joined.length) return;
  report.blockedDataRequests = [...(report.blockedDataRequests || []), ...joined];
  for (const request of joined) if (BLOCKED_STATUS_EFFECT[request.aggregateOutcome] && STATUS_RANK.has(report.status)) report.status = worseStatus(report.status, BLOCKED_STATUS_EFFECT[request.aggregateOutcome]);
}

// Gated entities (read-back-contract DOMAINS) this run sent at least one write for, from the
// attempt journal, judged on each attempt's latest status (a `started` row its attempt later
// closed as skipped is not a write; a dangling `started` is). A deferral or any `skipped_*`
// outcome is not a write. A write row this cannot
// place (no manifest task, unknown target type) counts for every gated entity, which keeps the
// earlier `gate-not-run` behavior whenever the run's writes cannot be told apart.
const notAWrite = (status) => status === 'deferred' || /^skipped_/.test(String(status || ''));
async function gatedEntitiesWrittenInRun(projectDir, runId) {
  const { DOMAINS } = require('./read-back-contract');
  const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch((error) => { if (error.code === 'ENOENT') return { rows: [] }; throw error; });
  let manifest = null;
  try { manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const taskRefs = new Map((Array.isArray(manifest?.tasks) ? manifest.tasks : []).map((task) => [task.id, new Set(task.entityRefs || [])]));
  const names = Object.entries(DOMAINS).map(([entity, domain]) => [entity, `${domain}/${entity}`, new Set([entity, `${domain}/${entity}`, `${domain}-${entity}`, `${domain}.${entity}`])]);
  const latest = new Map();
  for (const row of rows) if (row.runId === runId) latest.set(row.attemptId || Symbol('unidentified'), { ...(latest.get(row.attemptId) || {}), ...row });
  const wrote = new Set();
  for (const row of latest.values()) {
    if (notAWrite(row.status)) continue;
    const refs = taskRefs.get(row.writeSpecId);
    const matched = names.filter(([, ref, types]) => types.has(row.targetEntityType) || types.has(row.writeSpecId) || refs?.has(ref));
    if (!refs && !matched.length) for (const [entity] of names) wrote.add(entity);
    for (const [entity] of matched) wrote.add(entity);
  }
  return wrote;
}

// Whole-kind coverage at the end of import: per source kind the plan imports (and per product
// subtype), source records vs records in Wix (the attempt journal's latest landed status). A kind
// with records and none in Wix is not a finished import, whatever the importer's own counters say:
// 11-18 all 81 variable products were held silently; run 7 left out all 267 orders. Partial plus
// held records is normal (their own rows report them). A kind the plan does not import on purpose
// is not counted: an operator skip, a typed limitation, a manual-mapping target, or records the
// operator's record rule leaves out. Same plan facts the mapping-exit check reads
// (mapping-field-contract outOfScopeEntities).
const SUBTYPE_FIELD = Object.freeze({ product: 'type' });
const IN_WIX_STATUSES = new Set(['imported', 'skipped_already_imported', 'succeeded_unverified']);
async function wholeKindCoverage(projectDir, plan) {
  const f = require('./mapping-field-contract.js');
  const rows = f.entityRows(plan || {});
  const scope = plan?.executionScope || {};
  const stated = new Set([...(scope.deferredEntities || []).filter((d) => d.limitation).map((d) => d.entityRef),
    ...(scope.skippedEntities || []).map((d) => d.entityRef)]);
  const refs = new Set(rows.map(f.entityRef));
  // A journal key is `<entity>:<id>` or `<system>:<entity>:<id>`; a derived entity may use a shorter
  // name (guest-buyer for guest-buyer-contact) only when no plan row has that exact name.
  const keyRef = (key) => {
    const parts = String(key).split(':');
    const kind = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    if (refs.has(kind)) return kind;
    return [...refs].find((ref) => ref.startsWith(`${kind}-`)) || kind;
  };
  let journal = [];
  try { ({ rows: journal } = await require('./local-state').loadAttemptJournal(projectDir)); } catch { journal = []; }
  const latest = new Map();
  for (const row of journal || []) if (row?.sourceStableKey) latest.set(`${keyRef(row.sourceStableKey)}\0${String(row.sourceStableKey).split(':').pop()}`, row.status);
  let manifest = null;
  try { manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8')); } catch { manifest = null; }
  const bindings = (manifest?.tasks || []).flatMap((task) => task?.sourceBindings || []);
  const kinds = [];
  for (const row of rows) {
    const ref = f.entityRef(row);
    if (row.inUse === false || row.sourceRecordCount === 0 || row.targetClassification === 'manual-mapping' || stated.has(ref)
      || f.operatorEntitySkip(row) || f.statedLimitation(row) || (row.fieldMappingStatus === 'pending' && row.limitation !== undefined)) continue;
    const extract = bindings.find((b) => b && b.role !== 'source-archive' && (b.sourceEntity === ref || b.sourceEntity === row.sourceEntity))?.extractPath || `data/source-extract/${ref}.ndjson`;
    let text;
    try { text = await fs.readFile(path.join(projectDir, extract), 'utf8'); } catch { continue; }
    const counts = new Map();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!f.keepsRecord(row, record)) continue;
      const subtype = SUBTYPE_FIELD[ref] && typeof record[SUBTYPE_FIELD[ref]] === 'string' ? record[SUBTYPE_FIELD[ref]] : 'all';
      // A derived record's id may be its whole key (replatform:guest-buyer:<hash>): match on the last part.
      const id = String(record.id ?? record.ID ?? record.sourceId).split(':').pop();
      const status = latest.get(`${ref}\0${id}`);
      if (status === 'skipped_out_of_scope') continue;
      const c = counts.get(subtype) || { source: 0, inWix: 0 };
      c.source += 1; if (IN_WIX_STATUSES.has(status)) c.inWix += 1;
      counts.set(subtype, c);
    }
    for (const [subtype, c] of counts) kinds.push({ entity: ref, subtype, sourceRecords: c.source, inWix: c.inWix, ...(c.inWix === 0 ? { wholeKindMissing: true } : {}) });
  }
  return kinds;
}
function wholeKindOperatorAction(kind, plan) {
  const label = kind.subtype === 'all' ? kind.entity : `${kind.entity} (${kind.subtype})`;
  const deferred = (plan?.executionScope?.deferredEntities || []).find((d) => d.entityRef === kind.entity);
  return {
    code: 'whole-kind-not-imported', severity: 'high', role: 'import-operator', entity: kind.entity,
    actionId: `whole-kind-not-imported:${kind.entity}:${kind.subtype}`,
    affectedCount: kind.sourceRecords,
    action: `Requires Import Operator. ${label}: ${kind.sourceRecords} records not imported (0 in Wix). Reason: ${deferred?.reason || 'none recorded; the import wrote no record of this kind.'} Fix the mapping or importer for ${kind.entity} in the original migration project and resume only that entity; the source records are in the local extract.`,
    importOperatorPrompt: `None of the ${kind.sourceRecords} ${label} source records reached Wix. Find why (execution scope in mapping/mapping-plan.json, held rows in state/attempts/write-attempts.ndjson), fix it, and resume only ${kind.entity}.`,
    deadlineReason: 'Resolve before launch: this kind of record is missing from the new site.',
    artifactRefs: ['execution/completion-report.json', 'mapping/mapping-plan.json', 'state/attempts/write-attempts.ndjson'],
    prerequisites: ['Original migration project and source extract'],
    resolutionEvidence: `kindCoverage in execution/completion-report.json shows ${label} with records in Wix.`,
  };
}

// A dry run is not backend accounting: its report goes under state/dry-run/, so it can never
// count as a finished import (the router and every completion gate read execution/ only).
const DRY_RUN_REPORT_FILE = 'state/dry-run/completion-report.json';
const DRY_RUN_SUMMARY_FILE = 'state/dry-run/completion-summary.md';
async function isDryRunPass(projectDir, dryRun) {
  if (typeof dryRun === 'boolean') return dryRun;
  try { return await require('./config-env.js').resolveDryRun(projectDir); } catch { return true; }
}
async function writeCompletionReport(projectDir, unjoinedReport, { runId = null, appendLog = true, mappingPlanDigest = null, dryRun = null } = {}) {
  if (!unjoinedReport || typeof unjoinedReport !== 'object' || !unjoinedReport.status) {
    throw new Error('writeCompletionReport requires a completion report object');
  }
  const censusReport = JSON.parse(JSON.stringify(unjoinedReport));
  // The runner's finalize has no lastWriteAt to pass, so a finished run takes it from the attempt
  // journal's latest successful write (the source the interrupted path already uses).
  if (!censusReport.lastWriteAt && !censusReport.dryRun) {
    const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch(error => { if (error.code === 'ENOENT') return { rows: [] }; throw error; });
    censusReport.lastWriteAt = rows.filter(row => ['imported', 'succeeded_unverified'].includes(row.status))
      .map(row => row.ts).filter(ts => typeof ts === 'string' && !Number.isNaN(Date.parse(ts))).sort().pop() || null;
  }
  if ((censusReport.exclusions || []).some(row => row.censusId)) {
    const { readReconciliation, ownerApprovedCensusIds } = require('./census-reconciliation.js');
    const reconciliation = await readReconciliation(projectDir);
    const approved = await ownerApprovedCensusIds(projectDir);
    for (const row of censusReport.exclusions) {
      if (!row.censusId) continue;
      if (!reconciliation?.rows?.some(entry => entry.censusId === row.censusId && ['excluded','unsupported'].includes(entry.state))) throw Object.assign(new Error('exclusion_census_id_invalid'), { code: 'exclusion_census_id_invalid' });
      row.operatorGateRecorded = approved.has(row.censusId);
      if (!row.operatorGateRecorded && censusReport.status === 'complete') censusReport.status = 'complete_with_warnings';
    }
  }
  await joinBlockedDataRequests(projectDir, censusReport);
  await require('./read-back-approval').recoverAcknowledgements(projectDir);
  const gateState = require('./read-back-state');
  const entities = await require('./read-back-approval').gatedEntities(projectDir);
  const gateRun = censusReport.runId || runId || 'unidentified-completion';
  // A run that sent no write for a gated entity records `not-run-no-writes`, so a
  // resume with nothing to write adds no new stop; an earlier run's gate result still decides.
  const wrote = entities.length ? await gatedEntitiesWrittenInRun(projectDir, gateRun) : new Set();
  if (entities.length) await gateState.update(projectDir, gate => {
    gate.runs[gateRun] ||= { entities: {} };
    for (const entity of entities) gate.runs[gateRun].entities[entity] ||= { status: 'unknown', stopReason: wrote.has(require('./read-back-contract').domainOf(entity)) ? 'gate-not-run' : 'not-run-no-writes', canaries: [] };
  });
  for (const entity of entities) await require('./read-back-approval').createAcknowledgement(projectDir, gateRun, entity);
  const gate = await gateState.load(projectDir);
  const readBack = require('./read-back-summary').projectReadBackSummary(gate);
  const gateActions = require('./read-back-gate').operatorActions(gate);
  const readinessActions = await dependencyOperatorActions(projectDir);
  gateActions.push(...readinessActions, ...await extractIntegrityActions(projectDir), ...await sourceFilterActions(projectDir), ...await sourceUnreadActions(projectDir), ...await planSkipActions(projectDir));
  const blocked = gateActions.some(a => ['read-back-gate-stopped', 'read-back-suspect-interval'].includes(a.code));
  const recordOnlyReadBack = gateActions.some(a => a.code === 'read-back-uncertain-write');
  let report = await joinSourceCoverage(projectDir, { ...censusReport,
    readBack,
    status: blocked ? worseStatus(censusReport.status, 'incomplete_with_failures') : recordOnlyReadBack ? worseStatus(censusReport.status, 'complete_with_warnings') : censusReport.status,
    operatorActions: [...(censusReport.operatorActions || []).filter(a => !a.code?.startsWith('read-back-')), ...gateActions] });
  const planFile=path.join(projectDir,'mapping/mapping-plan.json');
  let plan=null;try {plan=JSON.parse(await fs.readFile(planFile,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  if (plan?.fieldContractVersion===1) {
    const {digest,deferredRunResult,deferredMappingActions,mappingGapCutoverActions,mappingGapLedgerDigest,planChoiceActions,plannedDropRows}=require('./mapping-field-contract.js');
    const pin=mappingPlanDigest || report.mappingPlanDigest;
    const retainedHeadlines=(Array.isArray(report.headline)?report.headline:[]).filter(row=>!['MAPPING_REPORT_BINDING_REQUIRED','MAPPING_SCOPE_DEFERRED'].includes(row?.code));
    if (!pin || pin!==digest(plan) || !plan.executionScope) {
      report={...report,status:'blocked',headline:[{code:'MAPPING_REPORT_BINDING_REQUIRED',message:'Migration is blocked by missing or stale mapping/report binding; independent import counters are retained.'},...retainedHeadlines],blocker:{type:'mapping_report_binding_required',artifact:'mapping/mapping-plan.json',requiredInput:'Regenerate importer/report against its pinned canonical mapping before resuming.'}};
      delete report.mappingPlanDigest; delete report.executionScope;
    } else {
      let mappingLedger = [];
      try { mappingLedger = JSON.parse(await fs.readFile(path.join(projectDir, 'mapping/review/mapping-gaps.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const ledgerDigest = mappingGapLedgerDigest(mappingLedger, plan);
      if (plan.mappingGapLedgerDigest && plan.mappingGapLedgerDigest !== ledgerDigest) {
        report={...report,mappingPlanDigest:pin,executionScope:structuredClone(plan.executionScope),status:'blocked',headline:[{code:'MAPPING_GAP_LEDGER_BINDING_REQUIRED',message:'Migration is blocked because the retained mapping-gap ledger is stale; independent import counters are retained.'},...retainedHeadlines],blocker:{type:'mapping_gap_ledger_binding_required',artifact:'mapping/review/mapping-gaps.json',requiredInput:'Regenerate the mapping plan and completion report from the same current mapping-gap ledger before resuming.'}};
      } else {
        const mappingActions = [...deferredMappingActions(plan), ...mappingGapCutoverActions(mappingLedger, plan, { expectedLedgerDigest: plan.mappingGapLedgerDigest })];
        const actions = [...(report.operatorActions || [])];
        for (const action of mappingActions) if (!actions.some(existing => existing.code === action.code && existing.entity === action.entity)) actions.push(normalizeOperatorAction(action, actions.length));
        // Recorded choices (operator, one-click AI or suggestion) are cutover review items; one per decision.
        for (const action of planChoiceActions(plan)) if (!actions.some(existing => existing.actionId === action.actionId)) actions.push(normalizeOperatorAction(action, actions.length));
        // Fields the plan drops on purpose are reported as dropped, counted from the read-back inventory.
        const inventories = new Map();
        // The inventory is named by the read-back entity (crm/contact -> contact.json), not the plan's
        // source entity (customer); the same targetRef -> DOMAINS lookup readiness uses.
        const { DOMAINS } = require('./read-back-contract.js');
        const countAt = (_source, p, row) => {
          const domain = Object.keys(DOMAINS).find(name => `${DOMAINS[name]}/${name}` === row?.targetRef);
          const entity = domain && require('./mapping-field-contract.js').readBackKeyFor(plan, domain, row.sourceEntity);
          if (!entity) return null;
          if (!inventories.has(entity)) { let inv = null; try { inv = JSON.parse(require('node:fs').readFileSync(path.join(projectDir, 'execution/read-back-inventory', `${entity}.json`), 'utf8')); } catch { /* none measured */ } inventories.set(entity, inv); }
          const n = inventories.get(entity)?.sourcePaths?.[p]; return Number.isSafeInteger(n) ? n : null;
        };
        const dropped = [...(report.droppedFields || [])];
        for (const row of plannedDropRows(plan, countAt)) if (!dropped.some(d => d.entity === row.entity && d.field === row.field)) dropped.push(normalizeDroppedField(row, dropped.length));
        if (dropped.length !== (report.droppedFields || []).length) report = { ...report, droppedFields: dropped };
        report={...report,mappingPlanDigest:pin,executionScope:structuredClone(plan.executionScope),mappingGapLedgerDigest:ledgerDigest,operatorActions:actions};
        const deferred=deferredRunResult(plan);
        if (deferred) report={...report,status:'blocked',headline:[{code:'MAPPING_SCOPE_DEFERRED',message:'Migration remains blocked because every executable entity is deferred; the retained mapping gaps remain visible for recovery.'},...retainedHeadlines],blocker:deferred.blocker};
        else if (mappingActions.length) report={...report,status:worseStatus(report.status,'complete_with_deferred_records'),headline:[{code:'MAPPING_SCOPE_DEFERRED',message:'Some mapped entities remain deferred as cutover gaps; independent import outcomes are retained.'},...retainedHeadlines]};
      }
    }
  }
  let redirectReport = null;
  try {
    redirectReport = JSON.parse(await fs.readFile(path.join(projectDir, 'execution', 'url-rewrite-report.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (redirectReport) {
    const actions = Array.isArray(report.operatorActions) ? report.operatorActions : [];
    const known = new Set(actions.map((row) => `${row.code}\t${row.entity}`));
    const redirectSources = new Map((redirectReport.rules || []).map((row) => [row.sourceStableKey, row.source]));
    const urlVerificationOwned = new Set((report.urlPreservation?.urls || [])
      .filter((row) => !String(row.disposition).startsWith('verified_'))
      .map((row) => row.originalUrl));
    for (const action of redirectReport.operatorActions || []) {
      const source = redirectSources.get(action.entity);
      if (source && urlVerificationOwned.has(source) &&
        action.code === 'cutover_links_pending_verification') continue;
      const key = `${action.code}\t${action.entity}`;
      if (!known.has(key)) actions.push(normalizeOperatorAction(action, actions.length));
      known.add(key);
    }
    report = { ...report, operatorActions: actions };
  }
  // What was decided about notification mute, and the unmute reminder for cutover.
  const mute = await require('./notification-mute.js').completionReportMute(projectDir);
  const keptActions = (report.operatorActions || []).filter((row) => row.code !== 'notifications-muted');
  report = { ...report, notificationMute: mute.block,
    operatorActions: [...keptActions, ...mute.actions.map((row, index) => normalizeOperatorAction(row, keptActions.length + index))] };
  report = await require('./mapping-recovery').joinReport(projectDir, report);
  // Every remaining issue kind (failed/held/unresolved records, plan choices and drops, open
  // cutover user actions) becomes a structured cutover task; older rows get actionId and role.
  report = await require('./cutover-coverage').joinCutoverCoverage(projectDir, report, { plan, normalize: normalizeOperatorAction,
    worseStatus: (current, next) => (STATUS_RANK.has(current) ? worseStatus(current, next) : current) });
  // Whole kind at 0 in Wix: named in the top headline, with one cutover task
  // unless a deferred-mapping task already names that entity's records.
  if (plan?.fieldContractVersion === 1 && STATUS_RANK.has(report.status) && report.status !== 'aborted' && !(await isDryRunPass(projectDir, dryRun))) {
    const kindCoverage = await wholeKindCoverage(projectDir, plan);
    const missing = kindCoverage.filter((kind) => kind.wholeKindMissing);
    report = { ...report, kindCoverage };
    if (missing.length) {
      const actions = [...(report.operatorActions || [])];
      for (const kind of missing) {
        const named = actions.some((a) => a.entity === kind.entity && ['mapping-scope-deferred', 'whole-kind-not-imported'].includes(a.code) && (a.code !== 'whole-kind-not-imported' || a.actionId === `whole-kind-not-imported:${kind.entity}:${kind.subtype}`));
        if (!named) actions.push(normalizeOperatorAction(wholeKindOperatorAction(kind, plan), actions.length));
      }
      // Never blocks the run (writers never block): an existing non-blocking status, with the
      // shortfall as the top headline, never "succeeded" wording.
      report = { ...report, status: worseStatus(report.status, 'complete_with_deferred_records'), operatorActions: actions,
        headline: [{ code: 'WHOLE_KIND_NOT_IMPORTED', message: `Not everything was imported: ${missing.map((k) => `${k.subtype === 'all' ? k.entity : `${k.entity}/${k.subtype}`} 0 of ${k.sourceRecords}`).join(', ')}.` },
          ...(report.headline || []).filter((row) => row?.code !== 'WHOLE_KIND_NOT_IMPORTED')] };
    }
  }
  // Fence: checked last, so a stop that latched while this report was being joined still lands.
  if (!report.interruption) {
    const latched = latchedInterruption(projectDir);
    if (latched) report = stampInterruption(report, latched);
  }
  const dry = await isDryRunPass(projectDir, dryRun);
  if (dry) report = { ...report, dryRun: true };
  const reportPath = path.join(projectDir, dry ? DRY_RUN_REPORT_FILE : COMPLETION_REPORT_FILE);
  const summaryPath = path.join(projectDir, dry ? DRY_RUN_SUMMARY_FILE : COMPLETION_SUMMARY_FILE);
  const summary = renderCompletionSummary(report);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFileAtomic(summaryPath, summary);
  if (appendLog && !dry) {
    await appendExecutionLog(projectDir, {
      runId: runId || report.runId || 'unknown-run',
      phase: 'completion',
      event: 'completion_report_written',
      detail: `final outcome recorded with status ${report.status}`,
      artifacts: [COMPLETION_REPORT_FILE, COMPLETION_SUMMARY_FILE],
    });
  }
  return { reportPath, summaryPath, summary, report };
}

module.exports = {
  wholeKindCoverage,
  planSkipActions, dependencyOperatorActions,
  extractIntegrityActions,
  sourceFilterActions,
  sourceUnreadActions,
  COMPLETION_STATUS,
  VOUCHER_RECONCILIATION,
  handoffVoucherSignal,
  COMPLETION_REPORT_FILE,
  COMPLETION_SUMMARY_FILE,
  DRY_RUN_REPORT_FILE,
  CAUSE_CONFIDENCE,
  normalizeCauseAttribution,
  renderCompletionSummary,
  emptyPermanentLossesLine,
  writeCompletionReport,
  chooseCompletionStatus,
  createCompletionReport,
  normalizeCompletenessRow,
  normalizeBlockedDataRequest,
  normalizeOperatorAction,
  normalizeStageResidual,
  normalizeMemberOutcomes,
  collectOrderStageResiduals,
  attachAttemptReasons,
  INTERRUPTION_KINDS,
  IMPORT_INTERRUPTED_CODE,
  normalizeInterruption,
  interruptionOperatorAction,
  stampInterruption,
};
