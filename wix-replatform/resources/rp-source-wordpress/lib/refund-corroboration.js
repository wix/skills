'use strict';

// The deterministic half of spec 0124 A.4: does the source actually evidence a refund, and if so
// what is its amount and its stable identity?
//
// The rule this encodes is narrow for a measured reason. On a live production store the field
// `payplus_refunded` reads like "amount refunded" and actually holds the amount still AVAILABLE
// to refund: its value equals the full order total on 556 of the 557 orders that carry it. A
// mapper trusting the name would mark essentially that whole gateway's revenue as refunded. Its
// sibling `payplus_status` is the constant `approved` on all 557, so it discriminates nothing.
// Field names are not evidence.
//
// What IS evidence is a canonical WooCommerce refund entity: it has its own identity and its own
// amount, so it is the refund record itself rather than a hint that one exists. An earlier draft
// of this rule required a second, independently-produced signal even for those entities -- which
// would have refused all 18 real refund entities found on the other surveyed store, since both
// available core signals (`shop_order_refund` and the `refunded` order status) come from the same
// producer. Corroboration is required only when existence is being INFERRED from flags, statuses
// or gateway metadata; it is not required to believe a record that is itself the refund.
//
// This module reports the amount as the raw source string. Canonicalizing money is the target
// mapping's job (order-payment-mapping.js), so there is exactly one decimal implementation in the
// write path.

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, 'refund-corroboration.json');

function loadRegistry(registryPath = REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function trimmed(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

// Only enough parsing to decide qualification. The value handed on is the original string.
function positiveAmount(raw) {
  const text = trimmed(raw);
  if (text === null) return null;
  if (!/^\+?\d+(\.\d+)?$/.test(text)) return null;
  return /[1-9]/.test(text) ? text : null;
}

function excludedKeyFindings(gatewayFields, registry) {
  const findings = [];
  const names = Object.keys(gatewayFields || {});
  for (const rule of registry.excludedKeys) {
    if (rule.key) {
      if (trimmed(gatewayFields[rule.key]) !== null) {
        findings.push({ code: 'refund-weak-signal', field: rule.key, exclusion: rule.exclusion });
      }
      continue;
    }
    if (rule.keyPattern) {
      const prefix = rule.keyPattern.replace(/\*$/, '');
      for (const name of names) {
        if (name.startsWith(prefix) && trimmed(gatewayFields[name]) !== null) {
          findings.push({ code: 'refund-weak-signal', field: name, exclusion: rule.exclusion });
        }
      }
    }
  }
  return findings;
}

// `payplus_response` is declared unreadable rather than "to be pattern-matched later": it is a
// raw provider blob on a live store whose sibling fields carry customer name, phone and email. A
// refund contract that requires parsing unstructured PII is not one that can be honoured safely,
// so this function must never look inside it. Asserted by the test.
// Derived from the registry rather than duplicated here, so the declaration has one home.
function neverReadKeys(registry = loadRegistry()) {
  return registry.excludedKeys
    .filter((rule) => rule.exclusion === 'never-read' && rule.key)
    .map((rule) => rule.key);
}

// A read plan that names an unreadable field is refused before it is executed, not filtered after
// the response comes back -- by then the blob is already in the run's working data.
function assertNoNeverReadKeys(keys = [], registry = loadRegistry()) {
  const forbidden = new Set(neverReadKeys(registry));
  const violations = keys.filter((key) => forbidden.has(key));
  if (violations.length > 0) {
    throw new Error(
      `these source keys are declared unreadable and must not appear in a read plan: ${violations.join(', ')}`,
    );
  }
  return true;
}

function qualifyRefund({
  refundEntity = null,
  orderStatus = null,
  gatewayFields = {},
  registry = loadRegistry(),
} = {}) {
  const findings = excludedKeyFindings(gatewayFields, registry);

  for (const key of neverReadKeys(registry)) {
    if (Object.prototype.hasOwnProperty.call(gatewayFields, key)) {
      findings.push({ code: 'redacted-source-values', field: key, exclusion: 'never-read' });
    }
  }

  const status = trimmed(orderStatus);
  const statusCorroborates = status !== null && status.toLowerCase().includes('refunded');

  if (refundEntity) {
    const sourceId = trimmed(refundEntity.id);
    const amount = positiveAmount(refundEntity.amount);

    if (!sourceId) {
      findings.push({ code: 'refund-weak-signal', reason: 'refund entity has no stable source id' });
      return { qualified: false, amount: null, sourceId: null, evidence: null, findings };
    }
    if (!amount) {
      // An order-level `refunded` status can corroborate an entity but cannot supply its amount,
      // and the order total is never a substitute.
      findings.push({ code: 'refund-weak-signal', reason: 'refund entity has no parseable positive amount', sourceId });
      return { qualified: false, amount: null, sourceId, evidence: null, findings };
    }

    if (Array.isArray(refundEntity.lineItems) && refundEntity.lineItems.length > 0) {
      findings.push({ code: 'refund-line-detail-not-preserved', sourceId, lines: refundEntity.lineItems.length });
    }
    findings.push({ code: 'refund-date-not-preserved', sourceId });

    return {
      qualified: true,
      amount,
      sourceId,
      evidence: 'woocommerce-refund-entity',
      corroboratedByStatus: statusCorroborates,
      findings,
    };
  }

  if (statusCorroborates) {
    findings.push({ code: 'refund-weak-signal', reason: 'refunded order status with no refund entity supplies no amount', sourceStatus: status });
  }

  return { qualified: false, amount: null, sourceId: null, evidence: null, findings };
}

// Every source order gets one refund outcome, so a run can state "0 refunds found; N orders carry
// an uncorroborated gateway refund field" rather than reporting silence.
function summarizeRefundEvidence(orders = [], registry = loadRegistry()) {
  const summary = { orders: orders.length, qualified: 0, weakSignalOrders: 0, findings: {} };
  for (const order of orders) {
    const result = qualifyRefund({ ...order, registry });
    if (result.qualified) summary.qualified += 1;
    if (!result.qualified && result.findings.some((f) => f.code === 'refund-weak-signal')) {
      summary.weakSignalOrders += 1;
    }
    for (const finding of result.findings) {
      summary.findings[finding.code] = (summary.findings[finding.code] || 0) + 1;
    }
  }
  return summary;
}

// Occurrence numbers for a single order's qualified refunds.
//
// Target-side identity is the refund's facts plus WHICH occurrence of those facts this refund is,
// because two distinct source refunds can carry the same payment and amount. Nothing computed
// that number, so every caller got the default of 1 and the second identical refund reconciled
// against the first and was silently dropped. Phase 1 writes one payment per order, so grouping
// by amount within the order is the same grouping the target reconciler uses.
//
// Ordering is by stable source id so a re-run assigns the same numbers to the same refunds.
function assignRefundOccurrences(qualifiedRefunds = []) {
  const seen = new Map();
  return [...qualifiedRefunds]
    .sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)))
    .map((refund) => {
      const key = String(refund.amount);
      const occurrence = (seen.get(key) || 0) + 1;
      seen.set(key, occurrence);
      return { ...refund, sourceOccurrence: occurrence };
    });
}

module.exports = {
  REGISTRY_PATH,
  neverReadKeys,
  assertNoNeverReadKeys,
  loadRegistry,
  qualifyRefund,
  assignRefundOccurrences,
  summarizeRefundEvidence,
};
