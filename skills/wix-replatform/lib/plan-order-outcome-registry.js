'use strict';

// Every outcome ensurePlanOrder can return, what each means for the journal, and the cutover items
// the plan-order pass hands to the completion report -- in one frozen place.
//
// The writer (rp-target-wix ensurePlanOrder) returns an outcome per source contract; the generated
// importer records each one here with recordPlanOrderOutcome, and canceled/expired source
// contracts (never written: Wix cannot hold them as orders) with recordPlanOrderHistoryOnly. The
// completion report joins reportRows(), so a subscription that did not land as a live order, or
// whose billing no longer runs on its own, is always a task for someone. Same rule as
// member-outcome-registry.js: a code this file does not know throws instead of being bucketed.

const fs = require('node:fs');
const path = require('node:path');

const PLAN_ORDER_OUTCOME = Object.freeze({
  WRITTEN: 'plan-order-written',
  RECONCILED_EXISTING: 'plan-order-reconciled-existing',
  EXISTING_NOT_LIVE: 'plan-order-existing-not-live',
  RECONCILIATION_AMBIGUOUS: 'plan-order-reconciliation-ambiguous',
  TARGET_READ_FAILED: 'plan-order-target-read-failed',
  FAILED: 'plan-order-failed',
  UNKNOWN_OUTCOME: 'plan-order-unknown-outcome',
  PAUSE_FAILED: 'plan-order-pause-failed',
  READBACK_FAILED: 'plan-order-readback-failed',
  READBACK_MISMATCH: 'plan-order-readback-mismatch',
});
const PLAN_ORDER_OUTCOMES = Object.freeze(Object.values(PLAN_ORDER_OUTCOME));
const HISTORY_ONLY = 'plan-order-history-only';

const ENTITY = 'pricing-plans/plan-order';
const OUTCOMES_PATH = 'execution/outcomes/plan-order.json';

// Cutover action per class. `null`: the order is live and nothing beyond the billing item is owed.
const CODE = Object.freeze({
  billing: 'plan-order-billing-restarts',
  historyOnly: 'plan-order-history-only',
  notLive: 'plan-order-existing-not-live',
  pauseFailed: 'plan-order-pause-failed',
  unknown: 'plan-order-unknown-outcome',
  review: 'plan-order-needs-review',
  sharedOrder: 'plan-order-shared-order',
});
// journalStatus: the attempt-journal status the importer writes for the record.
const POLICY = Object.freeze({
  [PLAN_ORDER_OUTCOME.WRITTEN]: Object.freeze({ journalStatus: 'imported', live: true, action: null }),
  [PLAN_ORDER_OUTCOME.RECONCILED_EXISTING]: Object.freeze({ journalStatus: 'skipped_already_imported', live: true, action: null }),
  [PLAN_ORDER_OUTCOME.EXISTING_NOT_LIVE]: Object.freeze({ journalStatus: 'failed_terminal', live: false, action: CODE.notLive }),
  [PLAN_ORDER_OUTCOME.PAUSE_FAILED]: Object.freeze({ journalStatus: 'needs_verification', live: true, action: CODE.pauseFailed }),
  [PLAN_ORDER_OUTCOME.UNKNOWN_OUTCOME]: Object.freeze({ journalStatus: 'succeeded_unverified', live: false, action: CODE.unknown }),
  [PLAN_ORDER_OUTCOME.RECONCILIATION_AMBIGUOUS]: Object.freeze({ journalStatus: 'deferred', live: false, action: CODE.review }),
  [PLAN_ORDER_OUTCOME.TARGET_READ_FAILED]: Object.freeze({ journalStatus: 'failed_retryable', live: false, action: CODE.review }),
  [PLAN_ORDER_OUTCOME.FAILED]: Object.freeze({ journalStatus: 'failed_terminal', live: false, action: CODE.review }),
  [PLAN_ORDER_OUTCOME.READBACK_FAILED]: Object.freeze({ journalStatus: 'needs_verification', live: true, action: CODE.review }),
  [PLAN_ORDER_OUTCOME.READBACK_MISMATCH]: Object.freeze({ journalStatus: 'needs_verification', live: true, action: CODE.review }),
  [HISTORY_ONLY]: Object.freeze({ journalStatus: 'skipped_out_of_scope', live: false, action: CODE.historyOnly }),
});

function classifyPlanOrderResult(result) {
  const outcome = result && result.outcome;
  if (!POLICY[outcome] || outcome === HISTORY_ONLY) throw new Error(`unknown plan-order outcome: ${JSON.stringify(outcome)}`);
  return POLICY[outcome];
}

function load(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, OUTCOMES_PATH), 'utf8')).records || []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
// Latest row per source key wins: a resumed pass replaces what an earlier pass recorded.
function save(projectDir, row) {
  const file = path.join(projectDir, OUTCOMES_PATH);
  const records = load(projectDir).filter((r) => r.sourceStableKey !== row.sourceStableKey);
  records.push(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, entity: ENTITY, records }, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return row;
}
function requireKey(sourceStableKey) {
  if (!sourceStableKey || typeof sourceStableKey !== 'string') throw new Error('a plan-order outcome needs its sourceStableKey');
  return sourceStableKey;
}

// One row per source contract handed to ensurePlanOrder. Returns the row (journalStatus included).
function recordPlanOrderOutcome(projectDir, { sourceStableKey, result }) {
  const policy = classifyPlanOrderResult(result);
  // A create the client refused before sending is retryable: nothing reached Wix.
  const notSent = result.outcome === PLAN_ORDER_OUTCOME.FAILED && result.error && result.error.requestSent === false;
  return save(projectDir, {
    sourceStableKey: requireKey(sourceStableKey), outcome: result.outcome, journalStatus: notSent ? 'failed_retryable' : policy.journalStatus,
    ...(notSent ? { requestSent: false } : {}),
    orderId: result.orderId || null, memberId: result.memberId || null, planId: result.planId || null,
    startDate: result.startDate || null, status: result.status || null,
  });
}
// A canceled or expired source contract: never written natively, kept as CMS history.
function recordPlanOrderHistoryOnly(projectDir, { sourceStableKey, sourceStatus }) {
  if (!['canceled', 'expired'].includes(sourceStatus)) throw new Error(`history-only plan orders are canceled or expired source contracts, got ${JSON.stringify(sourceStatus)}`);
  return save(projectDir, { sourceStableKey: requireKey(sourceStableKey), outcome: HISTORY_ONLY, journalStatus: POLICY[HISTORY_ONLY].journalStatus, sourceStatus, orderId: null });
}

const IMPORT_OPERATOR_PROMPT_UNKNOWN = `For each source key in affectedIds, read its row in ${OUTCOMES_PATH} (memberId, planId, startDate). List Pricing Plans orders for that member and plan (GET /pricing-plans/v2/orders?buyerIds=<memberId>&planIds=<planId>). If one order has that start date, write its id to the plan-order crosswalk for the source key. If none, re-run the plan-order import for that record only. Never create a second order by hand: orders cannot be deleted.`;
const IMPORT_OPERATOR_PROMPT_REVIEW = `For each source key in affectedIds, read its outcome in ${OUTCOMES_PATH}. Ambiguous: choose which listed order is the contract's and write its id to the crosswalk. Failed or read failed: fix the cause and re-run the plan-order import for those records. Read-back mismatch or failed: compare the order in Business Manager with the source contract and record the decision. Never create a second order for a key that has an orderId.`;
const IMPORT_OPERATOR_PROMPT_SHARED = `Two or more source contracts in ${OUTCOMES_PATH} were matched to the same Wix order (same member, plan and start date). For each order id in affectedIds, decide whether the source holds a duplicate; if not, re-run the plan-order import for the extra contract with a distinguishing start date chosen with the owner.`;

function reportRows(projectDir) {
  const rows = load(projectDir), operatorActions = [];
  const by = (code) => rows.filter((row) => POLICY[row.outcome] && POLICY[row.outcome].action === code);
  const keys = (list) => list.map((row) => row.sourceStableKey);
  const live = rows.filter((row) => POLICY[row.outcome] && POLICY[row.outcome].live && row.orderId);
  // One task row per Wix order: two contracts claiming one order are the shared-order item's concern.
  const liveOrders = [...new Set(live.map((row) => row.orderId))];
  if (liveOrders.length) operatorActions.push({
    actionId: 'plan-order:billing-restarts', code: CODE.billing, severity: 'high', role: 'cutover-operator', entity: ENTITY,
    action: `Cutover Operator: ${liveOrders.length} pricing-plan subscription(s) were imported as offline orders; Wix does not charge them automatically. Ask the owner how to collect from now on: mark each cycle paid offline in Business Manager > Pricing Plans, or ask subscribers to buy the plan again online. Record the choice.`,
    deadlineReason: 'before go-live; the next billing date of each subscription is unpaid otherwise', affectedCount: liveOrders.length, affectedIds: liveOrders,
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: "The owner's collection choice is recorded on this task.",
  });
  const history = by(CODE.historyOnly);
  if (history.length) operatorActions.push({
    actionId: 'plan-order:history-only', code: CODE.historyOnly, severity: 'low', role: 'cutover-operator', entity: ENTITY,
    action: `Cutover Operator: ${history.length} canceled or expired source subscription(s) were kept as history only; Wix cannot hold them as plan orders. No action unless the owner wants a subscriber re-added (Business Manager > Pricing Plans > Sell a plan).`,
    deadlineReason: 'information only; review before go-live', affectedCount: history.length, affectedIds: keys(history),
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: 'The owner has reviewed the list.',
  });
  const notLive = by(CODE.notLive);
  if (notLive.length) operatorActions.push({
    actionId: 'plan-order:existing-not-live', code: CODE.notLive, severity: 'high', role: 'cutover-operator', entity: ENTITY,
    action: `Cutover Operator: ${notLive.length} subscription(s) match an order on the site that is already canceled or ended, so the subscriber has no live plan. In Business Manager > Pricing Plans, re-add each subscriber to the plan (Sell a plan) if the source subscription is still active.`,
    deadlineReason: 'before go-live; these subscribers lose access', affectedCount: notLive.length, affectedIds: notLive.map((row) => row.orderId || row.sourceStableKey),
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: 'Each listed subscriber has a live order or the owner confirmed none is needed.',
  });
  const paused = by(CODE.pauseFailed);
  if (paused.length) operatorActions.push({
    actionId: 'plan-order:pause-failed', code: CODE.pauseFailed, severity: 'medium', role: 'cutover-operator', entity: ENTITY,
    action: `Cutover Operator: ${paused.length} subscription(s) paused on the source were imported but are not paused on Wix. In Business Manager > Pricing Plans, pause each listed order.`,
    deadlineReason: 'before go-live; these subscribers have access they paused', affectedCount: paused.length, affectedIds: paused.map((row) => row.orderId),
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: 'Each listed order reads back PAUSED.',
  });
  const unknown = by(CODE.unknown);
  if (unknown.length) operatorActions.push({
    actionId: 'plan-order:unknown-outcome', code: CODE.unknown, severity: 'high', role: 'import-operator', entity: ENTITY,
    action: `Requires Import Operator: ${unknown.length} subscription(s) may or may not have been created on Wix (the create reply was lost).`,
    importOperatorPrompt: IMPORT_OPERATOR_PROMPT_UNKNOWN,
    deadlineReason: 'before go-live; a subscriber may be missing', affectedCount: unknown.length, affectedIds: keys(unknown),
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: 'Each listed key has a crosswalk order id or a fresh written outcome.',
  });
  const review = by(CODE.review);
  if (review.length) operatorActions.push({
    actionId: 'plan-order:needs-review', code: CODE.review, severity: 'high', role: 'import-operator', entity: ENTITY,
    action: `Requires Import Operator: ${review.length} subscription(s) did not land cleanly (ambiguous match, failed write or read, or a read-back mismatch).`,
    importOperatorPrompt: IMPORT_OPERATOR_PROMPT_REVIEW,
    deadlineReason: 'before go-live; these subscribers may be missing or wrong', affectedCount: review.length, affectedIds: keys(review),
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: 'Each listed key has a written or reconciled outcome.',
  });
  // Two contracts adopting one order: the writer sees one contract at a time, so only here can it show.
  const owners = new Map();
  for (const row of rows) if (row.orderId) owners.set(row.orderId, [...(owners.get(row.orderId) || []), row.sourceStableKey]);
  const shared = [...owners.entries()].filter(([, list]) => list.length > 1).map(([orderId]) => orderId);
  if (shared.length) operatorActions.push({
    actionId: 'plan-order:shared-order', code: CODE.sharedOrder, severity: 'high', role: 'import-operator', entity: ENTITY,
    action: `Requires Import Operator: ${shared.length} Wix order(s) are claimed by more than one source subscription (same member, plan and start date).`,
    importOperatorPrompt: IMPORT_OPERATOR_PROMPT_SHARED,
    deadlineReason: 'before go-live; a subscription may be missing', affectedCount: shared.length, affectedIds: shared,
    artifactRefs: [OUTCOMES_PATH], resolutionEvidence: 'Each listed order is claimed by one source key.',
  });
  return { operatorActions };
}

module.exports = {
  PLAN_ORDER_OUTCOME, PLAN_ORDER_OUTCOMES, HISTORY_ONLY, CODE, POLICY, OUTCOMES_PATH, ENTITY,
  classifyPlanOrderResult, recordPlanOrderOutcome, recordPlanOrderHistoryOnly, reportRows,
};
