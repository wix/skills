'use strict';

// Spec 0124 A.2 and A.5: decide whether a source order evidences a payment, build the Add
// Payments record when it does, and reconcile against what the target already holds.
//
// This module is source-agnostic on purpose. It takes FACTS ("the source says the amount was
// 55.75 and it was paid at this instant"), never source key names -- WooCommerce's `_paid_date`
// / `payplus_transaction_uid` knowledge lives in rp-source-wordpress, so a CSV or Shopify source
// can reach the same target contract without teaching this file a second vocabulary.
//
// The existence gate is the whole point. An order total is not evidence of payment: on a
// measured live store it is present on every cancelled and failed order, so "create an APPROVED
// payment wherever a total exists" would mint approved payments for roughly a fifth of the store
// and reproduce the revenue overstatement this work exists to remove. A paid date is required.
// A transaction reference enriches a payment; it never creates one.
//
// SCHEMA DRIFT, re-checked against the live Add Payments schema 2026-09-03 (A.1 requires this
// before coding, and it found a real bug):
//
//   1. `status` is a PAYMENT-level field, sibling to `amount` and `createdDate`. It is NOT a
//      member of `regularPaymentDetails`, which is where wix-writers.js was putting it. A
//      request built the old way used a field the schema still carries as DEPRECATED, marked as
//      replaced by the top-level one -- so it was not ignored outright, but its behaviour is not
//      guaranteed to persist. Write the current field.
//   2. `providerTransactionId` and `gatewayTransactionId` are "not returned for offline
//      payments". Read-back verification must therefore skip the reference on a payment written
//      with `offlinePayment: true`, or every offline payment reads as drift.
//   3. The order's `paymentStatus` is recalculated ASYNCHRONOUSLY. Reading the order straight
//      after the write may still show the previous status, so no verification may assert on it
//      immediately.
//
// Confirmed by the same re-check: `createdDate` is settable and defaults to now when omitted
// (which is why "leave it undated" is not an option the API offers), `providerTransactionId` caps
// at 100, `userDefinedName.custom` at 150, `lastFourDigits` at 4, `brand` at 100, up to 50
// payments per call and 100 per order, and the whole call fails if any external transaction id
// already exists on the order.

const PAYMENT_STATUS = 'APPROVED';

const LIMITS = {
  providerTransactionId: 100,
  methodName: 150,
  lastFourDigits: 4,
  cardBrand: 100,
};

// Mutually exclusive per-order outcomes (A.7). Their sum must equal the discovered source-order
// population, so a new reason MUST be added here rather than folded into an existing one.
const OUTCOMES = {
  ELIGIBLE: 'eligible',
  NO_AMOUNT: 'payment-not-written-no-amount',
  NO_PAID_DATE: 'payment-not-written-no-paid-date',
  MULTI_PAYMENT: 'payment-not-written-multi-payment',
  CURRENCY_MISMATCH: 'payment-not-written-currency-mismatch',
};

function trimmed(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

// A decimal is canonicalized as a string, never through a float: "55.750" and "55.75" are the
// same payment and must fingerprint identically, but parsing money as a Number to achieve that
// invites the classic 0.1 + 0.2 rounding error into an amount comparison.
function canonicalizeDecimal(raw) {
  const text = trimmed(raw);
  if (text === null) return null;
  const normalized = text.replace(/^\+/, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  if (!normalized.includes('.')) return normalized.replace(/^(-?)0+(\d)/, '$1$2');
  let [whole, fraction] = normalized.split('.');
  fraction = fraction.replace(/0+$/, '');
  whole = whole.replace(/^(-?)0+(\d)/, '$1$2');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function isPositive(canonical) {
  return canonical !== null && !canonical.startsWith('-') && /[1-9]/.test(canonical);
}

// Source paid dates arrive in three shapes across WooCommerce versions and gateways: an epoch
// stamp, a full ISO instant, and a bare "YYYY-MM-DD HH:MM:SS" wall-clock string with no zone.
// Only the first two are unambiguous. The third is interpreted as UTC and COUNTED, because
// silently shifting a payment by the store's offset is a fidelity loss that should be visible in
// the report rather than discovered later by a merchant reconciling a tax period.
function normalizePaidDate(raw, { utcOffsetMinutes = null } = {}) {
  const text = trimmed(raw);
  if (text === null) return { instant: null, finding: null };

  if (/^\d+$/.test(text)) {
    const seconds = text.length >= 13 ? Number(text) / 1000 : Number(text);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return { instant: null, finding: 'paid-date-unparseable' };
    }
    // `toISOString()` THROWS on an out-of-range date, so a garbage epoch aborted the run instead
    // of producing the named outcome the accounting depends on.
    const stamped = new Date(seconds * 1000);
    if (Number.isNaN(stamped.getTime())) return { instant: null, finding: 'paid-date-unparseable' };
    return { instant: stamped.toISOString(), finding: null };
  }

  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return { instant: null, finding: 'paid-date-unparseable' };
    return { instant: parsed.toISOString(), finding: null };
  }

  const wallClock = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (wallClock) {
    const [, y, mo, d, h, mi, s] = wallClock;
    const millis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || '0'));
    if (Number.isNaN(millis)) return { instant: null, finding: 'paid-date-unparseable' };
    // Date.UTC ROLLS OVER rather than rejecting: "2024-02-31 25:99:99" silently becomes
    // 2024-03-03T02:40:39Z. A date that does not round-trip to the components it was written
    // with is not a date, and inventing a plausible instant from a corrupt one is worse than
    // reporting it -- this value is the whole basis for claiming when the order was paid.
    const roundTrip = new Date(millis);
    const sameInstant = roundTrip.getUTCFullYear() === Number(y)
      && roundTrip.getUTCMonth() === Number(mo) - 1
      && roundTrip.getUTCDate() === Number(d)
      && roundTrip.getUTCHours() === Number(h)
      && roundTrip.getUTCMinutes() === Number(mi)
      && roundTrip.getUTCSeconds() === Number(s || '0');
    if (!sameInstant) return { instant: null, finding: 'paid-date-unparseable' };
    if (utcOffsetMinutes === null) {
      return { instant: new Date(millis).toISOString(), finding: 'paid-date-timezone-assumed' };
    }
    return { instant: new Date(millis - utcOffsetMinutes * 60000).toISOString(), finding: null };
  }

  return { instant: null, finding: 'paid-date-unparseable' };
}

// The gate, in the order A.2 states it. Exactly one outcome comes back, because Decision 8's
// accounting requires the outcomes to partition the population -- an order that fails two checks
// is reported under the first, with the rest of its problems available as findings.
function evaluatePaymentEligibility({
  sourceAmount = null,
  paidDate = null,
  altPaidDate = null,
  distinctAmountCount = 1,
  sourceCurrency = null,
  targetCurrency = null,
  utcOffsetMinutes = null,
  sourceStatus = null,
  conflictingStatuses = ['cancelled', 'failed', 'pending', 'on-hold', 'refunded'],
} = {}) {
  const findings = [];
  const amount = canonicalizeDecimal(sourceAmount);

  if (!isPositive(amount)) {
    return { eligible: false, outcome: OUTCOMES.NO_AMOUNT, amount: null, createdDate: null, findings };
  }

  const primary = normalizePaidDate(paidDate, { utcOffsetMinutes });
  const secondary = normalizePaidDate(altPaidDate, { utcOffsetMinutes });
  if (primary.finding) findings.push({ code: primary.finding, field: 'paidDate' });
  if (secondary.finding && !primary.instant) findings.push({ code: secondary.finding, field: 'altPaidDate' });

  const createdDate = primary.instant || secondary.instant;
  if (!createdDate) {
    return { eligible: false, outcome: OUTCOMES.NO_PAID_DATE, amount, createdDate: null, findings };
  }
  if (primary.instant && secondary.instant && primary.instant !== secondary.instant) {
    findings.push({ code: 'paid-date-disagreement', preferred: primary.instant, rejected: secondary.instant });
  }

  if (Number(distinctAmountCount) > 1) {
    return { eligible: false, outcome: OUTCOMES.MULTI_PAYMENT, amount, createdDate, findings };
  }

  // Wix derives payment currency from the order -- a payment request has no currency field -- so
  // a currency mismatch cannot be expressed in the record and must stop the write instead.
  if (sourceCurrency && targetCurrency && trimmed(sourceCurrency).toUpperCase() !== trimmed(targetCurrency).toUpperCase()) {
    return { eligible: false, outcome: OUTCOMES.CURRENCY_MISMATCH, amount, createdDate, findings };
  }

  // A paid date on a cancelled or failed order is preserved, not discarded: payment followed by
  // cancellation is a real sequence, and the date is the stronger historical fact. The
  // contradiction is counted so an implausible volume of it is visible.
  const status = trimmed(sourceStatus);
  if (status && conflictingStatuses.some((needle) => status.toLowerCase().includes(needle))) {
    findings.push({ code: 'payment-status-conflict', sourceStatus: status });
  }

  return { eligible: true, outcome: OUTCOMES.ELIGIBLE, amount, createdDate, findings };
}

function capped(value, limit, code, field, findings) {
  const text = trimmed(value);
  if (text === null) return null;
  if (text.length > limit) {
    findings.push({ code, field, length: text.length, limit });
    return null;
  }
  return text;
}

// Builds the payment exactly as the re-checked schema shapes it: status and createdDate at
// payment level, everything method-shaped inside regularPaymentDetails. `savedPaymentMethod` is
// never written -- the field is writable but no reusable credential can accompany it, so setting
// it would assert a charging agreement that does not exist. `refundDisabled` stays unset until
// its interaction with external refunds is verified.
function buildPaymentRecord({
  amount,
  createdDate,
  methodName = null,
  providerTransactionId = null,
  offlinePayment = undefined,
  cardDisplay = null,
} = {}) {
  const findings = [];
  const details = {};

  const method = capped(methodName, LIMITS.methodName, 'method-name-over-length', 'paymentMethodName', findings);
  if (method) details.paymentMethodName = { userDefinedName: { custom: method } };

  const reference = capped(providerTransactionId, LIMITS.providerTransactionId, 'reference-over-length', 'providerTransactionId', findings);
  if (reference) details.providerTransactionId = reference;
  else if (trimmed(providerTransactionId) === null) findings.push({ code: 'no-transaction-reference' });

  if (typeof offlinePayment === 'boolean') details.offlinePayment = offlinePayment;

  if (cardDisplay) {
    const card = {};
    const lastFour = capped(cardDisplay.lastFourDigits, LIMITS.lastFourDigits, 'card-display-over-length', 'lastFourDigits', findings);
    const brand = capped(cardDisplay.brand, LIMITS.cardBrand, 'card-display-over-length', 'brand', findings);
    if (lastFour) card.lastFourDigits = lastFour;
    if (brand) card.brand = brand;
    if (Object.keys(card).length > 0) details.creditCardDetails = card;
  }

  return {
    payment: {
      amount: { amount },
      createdDate,
      status: PAYMENT_STATUS,
      regularPaymentDetails: details,
    },
    findings,
  };
}

// A.5's fallback identity for records with no provider reference. Deliberately built from the
// facts the source could supply, so a payment this migration wrote in an earlier run recognizes
// itself even when the crosswalk row is gone.
function paymentFingerprint(payment) {
  const details = (payment && payment.regularPaymentDetails) || {};
  const card = details.creditCardDetails || {};
  const method = details.paymentMethodName
    && details.paymentMethodName.userDefinedName
    && details.paymentMethodName.userDefinedName.custom;
  return JSON.stringify([
    canonicalizeDecimal(payment && payment.amount && payment.amount.amount),
    payment && payment.createdDate ? new Date(payment.createdDate).toISOString() : null,
    method ? String(method).trim().toLowerCase() : null,
    typeof details.offlinePayment === 'boolean' ? details.offlinePayment : null,
    trimmed(card.lastFourDigits),
    card.brand ? String(card.brand).trim().toLowerCase() : null,
  ]);
}

const RECONCILE = {
  CREATE: 'create',
  RECONCILED: 'payment-reconciled-existing',
  AMBIGUOUS: 'payment-reconciliation-ambiguous',
};

// Reconciliation is by identity, never by position. The defect this replaces picked "the first
// payment that is not refundDisabled", which matches an unrelated record -- including one the
// merchant created by hand in the Business Manager.
function reconcilePayment({ payment, existingPayments = [] } = {}) {
  const wanted = (payment && payment.regularPaymentDetails) || {};
  const reference = trimmed(wanted.providerTransactionId);

  // `providerTransactionId` and `gatewayTransactionId` are not returned for offline payments, so
  // on a re-run an offline payment we wrote WITH a reference reads back WITHOUT one. Matching by
  // reference there can only ever miss, and a miss means "create" -- the payment gets written a
  // second time. Offline payments are therefore matched on the fact fingerprint, which excludes
  // the reference and so matches either shape.
  const offline = wanted.offlinePayment === true;

  if (reference && !offline) {
    const matches = existingPayments.filter(
      (candidate) => trimmed(candidate && candidate.regularPaymentDetails && candidate.regularPaymentDetails.providerTransactionId) === reference,
    );
    if (matches.length === 1) return { outcome: RECONCILE.RECONCILED, match: matches[0], matchedBy: 'providerTransactionId' };
    if (matches.length > 1) return { outcome: RECONCILE.AMBIGUOUS, match: null, matchedBy: 'providerTransactionId', matchCount: matches.length };
    return { outcome: RECONCILE.CREATE, match: null, matchedBy: null };
  }

  const target = paymentFingerprint(payment);
  const matches = existingPayments.filter((candidate) => paymentFingerprint(candidate) === target);
  if (matches.length === 1) return { outcome: RECONCILE.RECONCILED, match: matches[0], matchedBy: 'fingerprint' };
  if (matches.length > 1) return { outcome: RECONCILE.AMBIGUOUS, match: null, matchedBy: 'fingerprint', matchCount: matches.length };
  return { outcome: RECONCILE.CREATE, match: null, matchedBy: null };
}

// Refund identity, and why it has to be a fingerprint.
//
// A source refund entity has a stable id, but the target Refund object has nowhere to put it: the
// only free-text field, `details.reason`, is customer-visible, so a source identifier must not go
// there. So a written refund is recognized by what it IS -- the payment it refunds, its amount,
// and the external marker -- exactly as an unreferenced payment is.
//
// Without this a clean re-run writes the same external refund again, and the order's balance
// reads as refunded twice.
function refundFingerprint({ paymentId, amount }) {
  return JSON.stringify([trimmed(paymentId), canonicalizeDecimal(amount), true]);
}

function existingRefundFingerprints(refunds = []) {
  const out = [];
  for (const refund of refunds) {
    for (const transaction of (refund && refund.transactions) || []) {
      // Only OUR kind of refund counts, and only one that did not fail: a FAILED refund
      // transaction means the money never moved, so it must not suppress a re-attempt.
      if (transaction.externalRefund !== true) continue;
      if (transaction.refundStatus === 'FAILED') continue;
      out.push({
        refundId: refund.id,
        fingerprint: refundFingerprint({
          paymentId: transaction.paymentId,
          amount: transaction.amount && transaction.amount.amount,
        }),
      });
    }
  }
  return out;
}

// No AMBIGUOUS member: with occurrence-aware identity there is no ambiguous case to report. The
// Nth source refund either finds N matches or it does not.
const RECONCILE_REFUND = {
  CREATE: 'create',
  RECONCILED: 'refund-reconciled-existing',
};

// Identity by facts alone is not identity: two DISTINCT source refunds can share a payment and
// an amount (a 10.00 refund issued twice), and treating the second as "already written" silently
// drops a real refund. So the caller states WHICH occurrence this is among the source refunds
// sharing these facts for this payment, and reconciliation compares counts rather than existence.
//
// occurrence 1 with 0 matches -> create. occurrence 2 with 1 match -> create (the second refund
// is still missing). occurrence 1 or 2 with 2 matches -> reconciled. That makes a re-run idempotent
// without collapsing duplicates that genuinely exist.
function reconcileRefund({ paymentId, amount, existingRefunds = [], sourceOccurrence = 1 } = {}) {
  const target = refundFingerprint({ paymentId, amount });
  const matches = existingRefundFingerprints(existingRefunds).filter((entry) => entry.fingerprint === target);
  const occurrence = Number.isInteger(sourceOccurrence) && sourceOccurrence > 0 ? sourceOccurrence : 1;

  if (matches.length >= occurrence) {
    return { outcome: RECONCILE_REFUND.RECONCILED, refundId: matches[occurrence - 1].refundId, matchCount: matches.length };
  }
  return { outcome: RECONCILE_REFUND.CREATE, refundId: null, matchCount: matches.length };
}

module.exports = {
  LIMITS,
  OUTCOMES,
  RECONCILE,
  PAYMENT_STATUS,
  canonicalizeDecimal,
  normalizePaidDate,
  evaluatePaymentEligibility,
  buildPaymentRecord,
  paymentFingerprint,
  reconcilePayment,
  refundFingerprint,
  reconcileRefund,
  RECONCILE_REFUND,
};
