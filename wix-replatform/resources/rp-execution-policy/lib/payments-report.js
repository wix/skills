'use strict';

// The payments section of the plan report, and the accounting rules
// that decide whether it can be approved at all.
//
// Three properties this module exists to guarantee, each of which a hand-written report has got
// wrong before:
//
//   1. THE OUTCOMES PARTITION THE POPULATION. Every source order lands in exactly one bucket, and
//      the buckets sum to the denominator. A report whose numbers do not add up is not a report
//      with a rounding problem, it is a report that is hiding orders -- so a mismatch BLOCKS the
//      approval gate rather than printing a caveat.
//   2. ZERO IS A RESULT. Every outcome and every count is emitted even when it is zero. "0 refunds
//      found" is reviewable at a glance and is the cheapest place to catch a mis-mapped source
//      field; a missing line is indistinguishable from a line nobody computed.
//   3. CANDIDATE COVERAGE IS NOT WRITABLE COVERAGE. On the measured store 6,905 of 7,285 orders
//      carry some reference-shaped value but only ~5,394 are currently defensible. Reporting the
//      first number as though it were the second overstates fidelity by roughly 1,500 orders, so
//      the two are separate lines and the report refuses to collapse them.
//
// The denominator gets its own guard. A prior survey's narrower "card order" count must never
// stand in for the run's own reconciled read: the two differ (7,281 versus 7,285 on the measured
// store) and Decision 8's completeness claim is only as good as what it counted.

// The codes come from one frozen registry shared with the writers, not from a list kept here and
// not from scraping the writer source. A hand-maintained list drifted four times; the scraper that
// replaced it missed an outcome produced by a ternary, which is a green test over a real gap.
const registry = require('../../../lib/payments-outcome-registry.js');

const PAYMENT_OUTCOMES = registry.PAYMENT_OUTCOMES;
const ADDITIONAL_COUNTS = registry.REPORTABLE;

// False for records, and therefore prohibited: changing payment provider does not lose payment
// history, because these records are provider-independent.
// Mirrors invoice-discovery's STRATEGIES. A store-wide strategy, never a per-document action.
const INVOICE_STRATEGIES = ['none-found', 'number-only', 'wordpress-hosted', 'third-party-hosted', 'mixed'];

const PROHIBITED_PHRASES = ['lose your history', 'lose their history', 'loses your history'];

// A count is a non-negative integer. Coercing anything else let a report with `sourceOrders: -1`
// and `payment-written: -1` come back approvable -- the sum check passes and the numbers are
// nonsense, which is worse than a missing line.
function asCount(value, code, label, blocking) {
  if (value === undefined || value === null) return 0;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    if (blocking) {
      blocking.push({ code: code || 'invalid-count', detail: `${label} must be a non-negative integer, got ${JSON.stringify(value)}` });
    }
    return 0;
  }
  return numeric;
}

function buildPaymentsReport({
  denominator = {},
  outcomes = {},
  counts = {},
  referenceCoverage = {},
  providers = null,
  providerParity = {},
  invoiceStrategy = null,
  notes = [],
} = {}) {
  const blocking = [];
  const lines = [];

  const sourceOrders = asCount(denominator.sourceOrders, 'invalid-denominator', 'denominator.sourceOrders', blocking);
  const priorSurvey = denominator.priorSurveyCount === undefined || denominator.priorSurveyCount === null
    ? null
    : asCount(denominator.priorSurveyCount, 'invalid-count', 'denominator.priorSurveyCount', blocking);

  if (denominator.from !== 'run-reconciled-read') {
    blocking.push({
      code: 'denominator-not-from-reconciled-read',
      detail: 'the denominator must come from this run\'s own reconciled source reads, not from a prior survey or a remembered constant',
    });
  }
  // A stored count differing from a fresh one is NOT a defect. MEASURED 2026-09-05: the surveyed
  // store trades at roughly six orders a day, so two counts taken hours apart legitimately differ
  // and no amount of reconciling makes them agree. Blocking on it would block every run on any
  // live store. It is reported as drift, for context, and the run's own read is authoritative.
  if (priorSurvey !== null && priorSurvey !== sourceOrders) {
    lines.push({
      code: 'denominator-drift',
      label: 'Change since the prior survey (expected on a trading store)',
      value: sourceOrders - priorSurvey,
    });
  }

  lines.push({ code: 'source-orders', label: 'Source orders discovered', value: sourceOrders });
  if (priorSurvey !== null) {
    lines.push({ code: 'prior-survey-orders', label: 'Prior survey count (not the denominator)', value: priorSurvey });
  }

  let outcomeTotal = 0;
  for (const code of PAYMENT_OUTCOMES) {
    const value = asCount(outcomes[code], 'invalid-count', `outcome ${code}`, blocking);
    outcomeTotal += value;
    lines.push({ code, label: code, value, partitioning: true });
  }

  // The buyer outcomes are a second partition. Optional as a whole (older runs report
  // none), but once any is present they must account for every source order, or the report is
  // hiding orders the same way a short payment partition would.
  const buyerCodes = Object.keys(outcomes).filter((code) => registry.BUYER_OUTCOMES.includes(code));
  if (buyerCodes.length > 0) {
    let buyerTotal = 0;
    for (const code of registry.BUYER_OUTCOMES) buyerTotal += asCount(outcomes[code], 'invalid-count', `outcome ${code}`, blocking);
    if (buyerTotal !== sourceOrders) {
      blocking.push({ code: 'buyer-outcome-sum-mismatch', detail: `the buyer outcomes sum to ${buyerTotal} but the run discovered ${sourceOrders} source orders` });
    }
  }
  const unknownOutcomes = Object.keys(outcomes).filter((code) => !PAYMENT_OUTCOMES.includes(code) && !registry.BUYER_OUTCOMES.includes(code));
  if (unknownOutcomes.length > 0) {
    blocking.push({
      code: 'unknown-payment-outcome',
      detail: `these outcomes are not declared as partitioning buckets, so the sum cannot be trusted: ${unknownOutcomes.join(', ')}`,
    });
  }
  if (outcomeTotal !== sourceOrders) {
    blocking.push({
      code: 'payment-outcome-sum-mismatch',
      detail: `the payment outcomes sum to ${outcomeTotal} but the run discovered ${sourceOrders} source orders; ${Math.abs(sourceOrders - outcomeTotal)} order(s) have no reported outcome`,
    });
  }
  lines.push({ code: 'payment-outcome-total', label: 'Payment outcomes total', value: outcomeTotal });

  // Both coverage numbers, always, and never one in place of the other.
  const candidates = asCount(referenceCoverage.candidates, 'invalid-count', 'referenceCoverage.candidates', blocking);
  const defensible = asCount(referenceCoverage.defensible, 'invalid-count', 'referenceCoverage.defensible', blocking);
  lines.push({ code: 'reference-candidates', label: 'Orders carrying a reference-shaped candidate', value: candidates });
  lines.push({ code: 'reference-defensible', label: 'Orders with a defensible provider reference', value: defensible });
  lines.push({ code: 'reference-not-defensible', label: 'Orders whose candidate could not be attributed', value: Math.max(candidates - defensible, 0) });
  if (defensible > candidates) {
    blocking.push({
      code: 'reference-coverage-impossible',
      detail: `defensible references (${defensible}) exceed candidates (${candidates}), so one of the two was miscomputed`,
    });
  }

  for (const code of ADDITIONAL_COUNTS) {
    // Buyer outcomes arrive under `outcomes` (they partition); everything else under `counts`.
    const source = registry.BUYER_OUTCOMES.includes(code) ? outcomes : counts;
    lines.push({ code, label: code, value: asCount(source[code], 'invalid-count', `count ${code}`, blocking) });
  }

  // Same provenance rule as the invoice strategy: an absent inventory is missing discovery, not a
  // store with no providers. Rendering "none found" for something nobody looked for is the exact
  // confusion this report exists to prevent.
  if (providers === null || providers === undefined) {
    blocking.push({
      code: 'provider-discovery-missing',
      detail: 'no provider inventory was supplied; a store with genuinely no providers must pass an empty array',
    });
  }
  const providerLines = (providers || []).map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    enabled: Boolean(provider.enabled),
  }));
  for (const provider of providers || []) {
    for (const forbidden of ['secret', 'key', 'token', 'password', 'credential']) {
      for (const [field, value] of Object.entries(provider)) {
        if (field.toLowerCase().includes(forbidden) && value !== undefined && value !== null && value !== '') {
          blocking.push({
            code: 'provider-inventory-carries-credential-shaped-field',
            detail: `provider ${provider.id} exposes "${field}" in the report; the inventory carries identifier, display name and enabled state only`,
          });
        }
      }
    }
  }

  const parity = {
    country: providerParity.country || null,
    currency: providerParity.currency || null,
    supported: providerParity.supported || [],
    confidence: providerParity.providerIdentityExposed === true ? 'verified-provider-parity' : 'unverified-provider-parity',
  };

  // A missing strategy is missing DISCOVERY, not an empty result -- reporting it as "none-found"
  // makes "we looked and there is nothing" indistinguishable from "we never looked". And the
  // value must be one of the strategies, not an action: `reference-only` is what happens to one
  // document, and it passed silently as a store-wide strategy.
  const strategy = invoiceStrategy === null || invoiceStrategy === undefined ? null : String(invoiceStrategy);
  if (strategy === null) {
    blocking.push({ code: 'invoice-discovery-missing', detail: 'no invoice strategy was reported; discovery must run before the plan is approved' });
  } else if (!INVOICE_STRATEGIES.includes(strategy)) {
    blocking.push({ code: 'invalid-invoice-strategy', detail: `"${strategy}" is not an invoice strategy; expected one of ${INVOICE_STRATEGIES.join(', ')}` });
  }
  lines.push({ code: 'invoice-strategy', label: 'Invoice strategy', value: strategy === null ? 'not-reported' : strategy });

  const rendered = renderPaymentsReport({ lines, providers: providerLines, parity, notes });
  const lowered = rendered.toLowerCase();
  for (const phrase of PROHIBITED_PHRASES) {
    if (lowered.includes(phrase)) {
      blocking.push({
        code: 'prohibited-phrase',
        detail: `the report contains "${phrase}", which is false for payment records: they are provider-independent and survive a provider change`,
      });
    }
  }

  return { lines, providers: providerLines, parity, blocking, rendered, approvable: blocking.length === 0 };
}

function renderPaymentsReport({ lines, providers, parity, notes = [] }) {
  const out = ['Payments, refunds and invoice documents', ''];

  out.push('Source payment providers found:');
  if (providers.length === 0) {
    out.push('  none found');
  } else {
    for (const provider of providers) {
      out.push(`  ${provider.id} — ${provider.displayName} — ${provider.enabled ? 'enabled' : 'disabled'}`);
    }
  }
  out.push('  no credential value was read or retained');
  out.push('');

  out.push(`Provider availability for ${parity.country || 'unknown country'} / ${parity.currency || 'unknown currency'}: ${parity.confidence}`);
  if (parity.supported.length > 0) out.push(`  supported: ${parity.supported.join(', ')}`);
  out.push('');

  for (const line of lines) {
    out.push(`  ${line.label}: ${line.value}`);
  }

  if (notes.length > 0) {
    out.push('');
    for (const note of notes) out.push(`  note: ${note}`);
  }
  return out.join('\n');
}

module.exports = {
  PAYMENT_OUTCOMES,
  ADDITIONAL_COUNTS,
  PROHIBITED_PHRASES,
  INVOICE_STRATEGIES,
  buildPaymentsReport,
  renderPaymentsReport,
};
