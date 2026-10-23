'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { verificationKind } = require('./entity-verification');
const { appendExecutionLog } = require('./execution-log.js');
const { validReceipt } = require('./write-verification');
const { OUTCOME_RANK, aggregateOutcome } = require('./blocked-data-requests.js');
const { PAYMENT_OUTCOMES, WRITER_OUTCOMES } = require('./payments-outcome-registry.js');
const memberRegistry = require('./member-outcome-registry.js');
const { SEO_OUTCOMES, SEO_ACCEPTED_OUTCOMES, SEO_OUTCOME_ACTIONS } = require('./seo-outcome-registry.js');
const { coverageDisagreements, describeCoverageMismatch } = require('./import-recovery.js');
const { cmsFallbackOperatorActions } = require('./plugin-cms-fallback.js');
const { summarizeProjectCoverage } = require('./source-coverage.js');
const { readLinkAudit, linkOperatorActions, RELATIVE_PATH: LINK_AUDIT_PATH } = require('./link-audit.js');
const { projectDestinationOperatorActions } = require('./destination-handoff.js');
const { sourceAccessOperatorActions, withheldDetailsOperatorActions } = require('./source-access.js');
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

const OPERATOR_ACTION_SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Anything the operator has to do by hand goes above the counts, with the
// deadline reason attached. The worked example is a large batch of discount codes
// with no redemption cap -- correctable only while the source is still the system of record.
function normalizeOperatorAction(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`operatorActions[${index}] must be an object`);
  }
  const label = `operatorActions[${index}]`;
  const severity = requireString(row.severity, `${label}.severity`);
  if (!OPERATOR_ACTION_SEVERITIES.includes(severity)) {
    throw new Error(`${label}.severity must be one of ${OPERATOR_ACTION_SEVERITIES.join(', ')}`);
  }
  return {
    code: requireString(row.code, `${label}.code`),
    severity,
    action: requireString(row.action, `${label}.action`),
    deadlineReason: requireString(row.deadlineReason, `${label}.deadlineReason`),
    entity: row.entity || null,
    affectedCount: row.affectedCount === null ? null : count(row.affectedCount, `${label}.affectedCount`),
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
  for (const row of journalRows || []) {
    if (!row || !runIdSet.has(row.runId)) continue;
    const key = row.sourceStableKey;
    if (!keyToIndex.has(key)) continue;
    latestByKey.set(key, row);
  }

  const tallies = entityCompleteness.map(() => new Map());
  for (const [key, row] of latestByKey) {
    let outcome = null;
    let code = null;
    if (row.status === 'deferred') {
      outcome = 'deferred';
      // The documented contract
      // (rp-import-codegen/SKILL.md's "Named reason" rule) is a top-level
      // `row.reason` string, but the real generated importer for that run wrote its
      // deferred rows' reason into `failure.errorCode` (the same field used for failed rows),
      // leaving `row.reason` absent on every one of its deferred rows. Preferring
      // `row.reason` keeps the documented contract authoritative when a future importer
      // actually writes it, while this fallback stops a real, already-recorded reason from
      // being silently dropped as "unexplained" just because it landed on the sibling field.
      code = typeof row.reason === 'string' && row.reason ? row.reason : row.failure && row.failure.errorCode;
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
    return { ...row, reasons: [...structured, ...strings] };
  });
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

function createCompletionReport(input = {}) {
  const entityCompleteness = asArray(input.entityCompleteness, 'entityCompleteness')
    .map((row, index) => normalizeCompletenessRow(row, index));
  const verification = input.verification || {};
  const verificationGaps = [];
  for (const row of entityCompleteness) {
    if (row.verificationKind === 'none') continue;
    const report = verification[row.entity];
    const entries = Array.isArray(report?.rows) ? report.rows : [];
    const unique = new Set(entries.map(r => r.sourceKey));
    const ids = entries.map(r => r.targetId);
    const kind = row.verificationKind;
    const expectedKeys = row.sourceKeys;
    const covered = Array.isArray(expectedKeys) && new Set(expectedKeys).size === row.inScope && expectedKeys.length === row.inScope && expectedKeys.every(k => unique.has(k)) && report?.siteId && report.siteId === (input.siteId || input.destinations?.siteId) && entries.every(r => typeof r.sourceKey === 'string' && r.sourceKey) && unique.size === entries.length && entries.length === row.inScope;
    const verified = entries.filter(r => validReceipt(r.receipt, { siteId: report?.siteId, sourceKey: r.sourceKey, targetId: r.targetId, kind })).length;
    if ((row.inScope && (!covered || verified !== row.inScope || new Set(ids).size !== ids.length)) || entries.length !== row.inScope) {
      // Absence stays exactly as blocking as a failed check; only the wording differs,
      // so a reader can tell "never supplied" from "supplied and failed".
      const absent = !Array.isArray(report?.rows) || report.rows.length === 0;
      verificationGaps.push({
        entity: row.entity,
        message: absent
          ? `${row.entity}: verification not recorded; supply verification input before completing`
          : `${row.entity}: identity/value verification missing or invalid; reconcile source records before completing`,
      });
    }
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
  const warnings = [...asArray(input.warnings, 'warnings'), ...voucherHeadline.map((row) => row.message)];
  const recoveryActions = [
    ...asArray(input.recoveryActions, 'recoveryActions'),
    ...verificationGaps.map(g => ({ entity: g.entity, action: g.message })),
    ...openStageResiduals.map((row) => ({
      entity: row.entity,
      stage: row.stage,
      action: stageResidualAction(row),
    })),
  ];
  const blockedDataRequests = asArray(input.blockedDataRequests, 'blockedDataRequests')
    .map((request, index) => normalizeBlockedDataRequest(request, index));
  const urlPreservation = normalizeUrlPreservation(input.urlPreservation);
  const operatorActions = asArray(input.operatorActions, 'operatorActions').map(normalizeOperatorAction);
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
  const unresolved = asArray(input.unresolved, 'unresolved').map(normalizeUnresolved);
  const droppedFields = asArray(input.droppedFields, 'droppedFields').map(normalizeDroppedField);

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
    aborted: input.aborted,
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
function renderCompletionSummary(report) {
  const lines = [
    '# Migration Completion Summary',
    '',
    `- Status: ${report.status}`,
    `- Run id: ${report.runId || 'not recorded'}`,
    `- Last write: ${report.lastWriteAt || 'not recorded'}`,
    ...(report.voucherReconciliation ? [`- Voucher reconciliation: ${report.voucherReconciliation}`] : []),
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
  // Source access that outlives the migration (the Shopify staff account) is an
  // operator action beside the coverage rows until its removal is confirmed. It is an action, not
  // a coverage gap, so status is unchanged.
  for (const row of sourceAccessOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.code === row.code && existing.entity === row.entity)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  // Mapping may accept withheld Shopify details, but Shopify remains their only
  // copy until the merchant's export is confirmed after the latest read. This action is separate
  // from sourceCoverage's disposition and does not change report status.
  for (const row of withheldDetailsOperatorActions(projectDir)) {
    if (!operatorActions.some((existing) => existing.code === row.code && existing.entity === row.entity)) {
      operatorActions.push(normalizeOperatorAction(row, operatorActions.length));
    }
  }
  if (giftCards.action) operatorActions.push(normalizeOperatorAction(giftCards.action, operatorActions.length));
  const sourceCoverage = coverage.sourceCoverage.map((row) => (row.coverageId === GIFT_CODES_COVERAGE_ID
    ? { ...row, cutoverAction: giftCards.cutoverAction || row.cutoverAction }
    : row));
  return {
    ...report,
    schemaVersion: 2,
    status: linkStatus ? worseStatus(coverage.status ? worseStatus(report.status, coverage.status) : report.status, linkStatus)
      : coverage.status ? worseStatus(report.status, coverage.status) : report.status,
    headline: [...asArray(report.headline, 'headline'), ...coverage.headline],
    operatorActions,
    ...(linkAudit ? { linkAudit: {
      path: LINK_AUDIT_PATH, stage: linkAudit.stage, counts: linkAudit.counts, estimate: linkAudit.estimate || null,
      pendingOccurrenceIds: linkAudit.pendingDestinations.flatMap((row) => row.occurrenceIds),
      unresolvedOccurrenceIds: linkAudit.unresolved.flatMap((row) => row.occurrenceIds),
      pendingWriterFields: (linkAudit.writerIntegrations || []).filter((row) => row.status === 'pending').map((row) => row.field),
      missingCutoverUiIntegration: true,
    } } : {}),
    sourceCoverageRecorded: coverage.sourceCoverageRecorded,
    ...(coverage.sourceCoverageReason ? { sourceCoverageReason: coverage.sourceCoverageReason } : {}),
    sourceCoverage,
  };
}

async function dependencyOperatorActions(projectDir) {
  let diagnostic;
  try { diagnostic = JSON.parse(await fs.readFile(path.join(projectDir, 'execution/dependency-readiness.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const { rows } = await require('./local-state').loadAttemptJournal(projectDir).catch(error => { if (error.code === 'ENOENT') return { rows: [] }; throw error; });
  const recovery = require('./dependency-recovery'), indexes = new Map(), result = [];
  for (const task of Object.values(diagnostic.tasks || {})) if (!indexes.has(task.siteId)) indexes.set(task.siteId, recovery.foldRecoveryAttempts(rows, task.siteId));
  for (const task of Object.values(diagnostic.tasks || {})) {
    const waiting = recovery.waitingForTask(indexes.get(task.siteId), task.taskId);
    const groups = new Map();
    for (const block of task.blocked || []) groups.set(`${block.ref}:${block.recovery}`, { ref: block.ref, recovery: block.recovery, count: task.affectedCount ?? null });
    for (const row of waiting) { const ref = row.deferral.ref || row.deferral.reason, key = `${ref}:resume-deferred`; if (!groups.has(key)) groups.set(key, { ref, recovery: 'resume-deferred', count: 0 }); groups.get(key).count++; }
    for (const group of groups.values()) result.push({ code: 'dependency-readiness-blocked', severity: 'blocker', entity: task.taskId, affectedCount: group.count,
      deadlineReason: 'Resolve before launch; affected dependent records have not finished importing.',
      action: `Requires Import Operator. Prerequisites: original migration project, source snapshot and current-site access; retain existing owner approvals. Copy prompt: Inspect execution/dependency-readiness.json task ${task.taskId} and ref ${group.ref}; resolve ${group.recovery}, re-evaluate and resume only eligible deferred records. Read back uncertain writes, never infer completion from old-site evidence and do not resend existing orders. Completion requires terminal outcomes for dependent records as well as repaired prerequisites.` });
  }
  return result;
}
async function writeCompletionReport(projectDir, unjoinedReport, { runId = null, appendLog = true } = {}) {
  if (!unjoinedReport || typeof unjoinedReport !== 'object' || !unjoinedReport.status) {
    throw new Error('writeCompletionReport requires a completion report object');
  }
  const censusReport = JSON.parse(JSON.stringify(unjoinedReport));
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
  await require('./read-back-approval').recoverAcknowledgements(projectDir);
  const gateState = require('./read-back-state');
  const entities = await require('./read-back-approval').gatedEntities(projectDir);
  const gateRun = censusReport.runId || runId || 'unidentified-completion';
  if (entities.length) await gateState.update(projectDir, gate => {
    gate.runs[gateRun] ||= { entities: {} };
    for (const entity of entities) gate.runs[gateRun].entities[entity] ||= { status: 'unknown', stopReason: 'gate-not-run', canaries: [] };
  });
  for (const entity of entities) await require('./read-back-approval').createAcknowledgement(projectDir, gateRun, entity);
  const gate = await gateState.load(projectDir);
  const readBack = require('./read-back-summary').projectReadBackSummary(gate);
  const gateActions = require('./read-back-gate').operatorActions(gate);
  const readinessActions = await dependencyOperatorActions(projectDir);
  gateActions.push(...readinessActions);
  const blocked = gateActions.some(a => ['read-back-gate-stopped', 'read-back-suspect-interval'].includes(a.code));
  let report = await joinSourceCoverage(projectDir, { ...censusReport,
    readBack,
    status: blocked ? worseStatus(censusReport.status, 'incomplete_with_failures') : censusReport.status,
    operatorActions: [...(censusReport.operatorActions || []).filter(a => !a.code?.startsWith('read-back-')), ...gateActions] });
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
  const reportPath = path.join(projectDir, COMPLETION_REPORT_FILE);
  const summaryPath = path.join(projectDir, COMPLETION_SUMMARY_FILE);
  const summary = renderCompletionSummary(report);
  await writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFileAtomic(summaryPath, summary);
  if (appendLog) {
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
  dependencyOperatorActions,
  COMPLETION_STATUS,
  VOUCHER_RECONCILIATION,
  handoffVoucherSignal,
  COMPLETION_REPORT_FILE,
  COMPLETION_SUMMARY_FILE,
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
};
