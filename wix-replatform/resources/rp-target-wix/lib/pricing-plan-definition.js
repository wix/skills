'use strict';

// Pricing-plan DEFINITIONS: a row-count gate, an unpurchasable write, and
// an honest "none found".
//
// Every store surveyed so far has zero plan-shaped rows (no subscription products, no membership
// CPT, no recurring-plan meta), so the first deliverable here is the gate and the wording: a store
// with nothing reports "no pricing plans found", never "pricing plans not supported" -- the
// must-not/cannot distinction this project has got backwards twice. When rows do exist, the
// definition lands PRIVATE and unbuyable, so it is on the site without becoming purchasable; the
// subscriptions themselves are phase 2.
//
// Pure: builds request bodies and decisions. The transport lives in wix-writers.js.

const crypto = require('node:crypto');

const SOURCES = Object.freeze(['B1', 'B2', 'B3']);
const SOURCE_LABELS = Object.freeze({
  B1: 'subscription products (product type + postmeta)',
  B2: 'membership plans (wps_membership* CPT)',
  B3: 'recurring plan definitions (WP Swings meta)',
});
const OUTCOMES = Object.freeze({
  NONE_FOUND: 'plans-none-found',
  WRITTEN: 'plan-written',
  RECONCILED: 'plan-reconciled-existing',
  AMBIGUOUS: 'plan-reconciliation-ambiguous',
  UNMAPPABLE: 'plan-unmappable',
  FAILED: 'plan-failed',
  TARGET_READ_FAILED: 'plan-target-read-failed',
});
// Wix's own limits (plan.json pitfalls, verified live 2026-08-16).
const LIMITS = Object.freeze({ name: 50, description: 450, minCycleDays: 7, maxPlanYears: 10, maxCycleCount: 2000, maxTrialDays: 999 });
// Conservative for the MAXIMUM check (31-day months, 366-day years): Wix's own rule is calendar
// arithmetic, and 121 monthly cycles at 30 days passed a 10-year test the API then refused.
const PERIOD_DAYS = Object.freeze({ DAY: 1, WEEK: 7, MONTH: 31, YEAR: 366 });
const PERIODS = Object.freeze({ day: 'DAY', week: 'WEEK', month: 'MONTH', year: 'YEAR' });

// The gate. Row counts, never plugin detection (PS-13). All three at zero -> the area does not run.
function evaluatePlanSources(rowCounts = {}) {
  const counts = {};
  for (const source of SOURCES) {
    const value = rowCounts[source];
    const n = value === undefined || value === null ? 0 : Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error(`plan source ${source} row count must be a non-negative integer, got ${JSON.stringify(value)}`);
    counts[source] = n;
  }
  const total = SOURCES.reduce((sum, s) => sum + counts[s], 0);
  return {
    counts,
    total,
    run: total > 0,
    outcome: total > 0 ? null : OUTCOMES.NONE_FOUND,
    // The wording is part of the contract: measured absence, not a missing capability.
    message: total > 0 ? `${total} plan definition(s) found across ${SOURCES.filter((s) => counts[s] > 0).join(', ')}` : 'no pricing plans found in the source (all three plan-shaped sources hold zero rows)',
  };
}

function uuidV5ish(name) {
  const hash = crypto.createHash('sha1').update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function truncate(text, limit, code, field, findings) {
  const value = text === undefined || text === null ? '' : String(text);
  if (value.length <= limit) return value;
  findings.push({ code, field, length: value.length, limit });
  return value.slice(0, limit);
}

// A normalized source offer -> the Plans V3 create body. The offer is source-agnostic:
//   { sourceId, name, description, amount, currency?, period: day|week|month|year, interval,
//     lengthCycles (0 = open-ended), trialDays, signupFee }
// Returns { plan, findings, unmappable } -- `unmappable` names the reason when no body can be built.
function buildPlanDefinition(offer = {}, { sourceSiteHost = 'source' } = {}) {
  const findings = [];
  if (!offer || typeof offer !== 'object') throw new Error('buildPlanDefinition needs a source offer object');
  if (offer.sourceId === undefined || offer.sourceId === null || String(offer.sourceId).trim() === '') {
    throw new Error('a plan offer needs a sourceId: the variant id and idempotency key derive from it');
  }
  const period = PERIODS[String(offer.period || '').toLowerCase()];
  const interval = Number(offer.interval === undefined || offer.interval === null ? 1 : offer.interval);
  if (!period) return { plan: null, findings, unmappable: { code: OUTCOMES.UNMAPPABLE, reason: 'unknown-period', period: offer.period } };
  if (!Number.isInteger(interval) || interval < 1) return { plan: null, findings, unmappable: { code: OUTCOMES.UNMAPPABLE, reason: 'invalid-interval', interval: offer.interval } };
  const cycleDays = PERIOD_DAYS[period] * interval;
  if (cycleDays < LIMITS.minCycleDays) {
    // Wix's billing cycle is at least 7 days. A source cadence of every 1-6 days cannot be recreated.
    return { plan: null, findings, unmappable: { code: OUTCOMES.UNMAPPABLE, reason: 'billing-cycle-under-7-days', cycleDays } };
  }
  if (cycleDays > LIMITS.maxPlanYears * 366) {
    // One cycle longer than the whole plan may be: no end type rescues it.
    return { plan: null, findings, unmappable: { code: OUTCOMES.UNMAPPABLE, reason: 'billing-cycle-over-10-years', cycleDays } };
  }
  const amount = offer.amount === undefined || offer.amount === null ? null : String(offer.amount).trim();
  if (amount === null || !/^\d+(\.\d{1,4})?$/.test(amount)) {
    return { plan: null, findings, unmappable: { code: OUTCOMES.UNMAPPABLE, reason: 'amount-not-decimal', amount: offer.amount } };
  }

  const name = truncate(offer.name || `Plan ${offer.sourceId}`, LIMITS.name, 'plan-name-truncated', 'name', findings);
  // The Stores-product linkage is severed by design; the source reference lives in the description.
  const sourceRef = `Source: ${sourceSiteHost} offer ${offer.sourceId}${offer.name ? ` (${offer.name})` : ''}`;
  const description = truncate([offer.description || '', sourceRef].filter(Boolean).join('\n'), LIMITS.description, 'plan-description-truncated', 'description', findings);

  const billingTerms = { billingCycle: { period, count: String(interval) }, startType: 'ON_PURCHASE' };
  const lengthCycles = Number(offer.lengthCycles === undefined || offer.lengthCycles === null ? 0 : offer.lengthCycles);
  if (!Number.isInteger(lengthCycles) || lengthCycles < 0) return { plan: null, findings, unmappable: { code: OUTCOMES.UNMAPPABLE, reason: 'invalid-length', lengthCycles: offer.lengthCycles } };
  if (lengthCycles === 0) {
    billingTerms.endType = 'UNTIL_CANCELLED';
  } else if (lengthCycles > LIMITS.maxCycleCount || cycleDays * lengthCycles > LIMITS.maxPlanYears * 366) {
    // Longer than Wix allows: open-ended, with the loss recorded.
    billingTerms.endType = 'UNTIL_CANCELLED';
    findings.push({ code: 'plan-duration-exceeds-limit', lengthCycles, cycleDays, note: 'imported as UNTIL_CANCELLED' });
  } else {
    billingTerms.endType = 'CYCLES_COMPLETED';
    billingTerms.cyclesCompletedDetails = { billingCycleCount: String(lengthCycles) };
  }

  const variant = {
    // Client-minted, preserved verbatim by Wix (verified live 2026-08-16), so it is stable per offer.
    id: uuidV5ish(`replatform:pricing-plan-variant:${sourceSiteHost}:${offer.sourceId}`),
    name: `${interval > 1 ? `Every ${interval} ${period.toLowerCase()}s` : `${period.charAt(0)}${period.slice(1).toLowerCase()}ly`}`.replace('Dayly', 'Daily').replace('Monthly', 'Monthly'),
    billingTerms,
    pricingStrategies: [{ flatRate: { amount } }],
  };
  const rawTrial = Number(offer.trialDays === undefined || offer.trialDays === null ? 0 : offer.trialDays);
  const trialDays = Number.isFinite(rawTrial) ? Math.floor(rawTrial) : 0;
  if (Number.isFinite(rawTrial) && rawTrial !== trialDays) findings.push({ code: 'plan-trial-rounded', trialDays: rawTrial, used: trialDays });
  if (Number.isInteger(trialDays) && trialDays > 0) {
    variant.freeTrialDays = Math.min(trialDays, LIMITS.maxTrialDays);
    if (trialDays > LIMITS.maxTrialDays) findings.push({ code: 'plan-trial-truncated', trialDays, limit: LIMITS.maxTrialDays });
  }
  const signupFee = offer.signupFee === undefined || offer.signupFee === null ? null : String(offer.signupFee).trim();
  if (signupFee && /^\d+(\.\d{1,4})?$/.test(signupFee) && Number(signupFee) > 0) {
    variant.fees = [{ name: 'Signup fee', priceType: 'FIXED_AMOUNT', fixedAmountOptions: { amount: signupFee }, appliedAt: 'FIRST_PAYMENT' }];
  }

  const plan = {
    name,
    description,
    // The two flags that keep an imported definition inert, plus the status
    // the API requires and the docs do not list (plan.json: status-required-on-create).
    visibility: 'PRIVATE',
    buyable: false,
    status: 'ACTIVE',
    buyerCanCancel: true,
    pricingVariants: [variant],
  };
  return { plan, findings, unmappable: null, idempotencyKey: uuidV5ish(`replatform:pricing-plan:${sourceSiteHost}:${offer.sourceId}`) };
}

// The two invariants a test pins on the request body, kept as a function so the writer can refuse
// a body that lost them between here and the send.
function assertInertPlan(plan) {
  if (!plan || plan.visibility !== 'PRIVATE' || plan.buyable !== false) {
    throw new Error('a migrated plan definition must be visibility PRIVATE and buyable false; anything else becomes purchasable on a live site');
  }
}

// Where ensurePlanDefinition's outcomes fold in the report: reconciled-existing is on the target,
// so it counts as written; everything else is skipped, reasons kept for the notes.
// Takes the writer's result objects (preferred) or bare outcome strings. A `plan-failed` whose
// purchasable plan could NOT be archived (`error.archived === false`) is a live-site hazard, counted
// on its own line so the report blocks on it -- review demonstrated the archive's 403 reported as
// "archived: true" while the plan stayed buyable.
function tallyPlanWriteOutcomes(results = []) {
  const outcomes = results.map((r) => (r && typeof r === 'object' ? r.outcome : r));
  const written = outcomes.filter((o) => o === OUTCOMES.WRITTEN || o === OUTCOMES.RECONCILED).length;
  const skippedBy = {};
  for (const o of outcomes) { if (o === OUTCOMES.WRITTEN || o === OUTCOMES.RECONCILED) continue; skippedBy[o] = (skippedBy[o] || 0) + 1; }
  const hazards = results.filter((r) => r && typeof r === 'object' && r.outcome === OUTCOMES.FAILED && r.error && r.error.cause === 'created-plan-not-inert' && r.error.archived === false).length;
  return { 'plans-written': written, 'plans-skipped': outcomes.length - written, 'plans-live-hazard': hazards, skippedBy };
}

module.exports = { SOURCES, SOURCE_LABELS, OUTCOMES, LIMITS, evaluatePlanSources, buildPlanDefinition, assertInertPlan, tallyPlanWriteOutcomes };
