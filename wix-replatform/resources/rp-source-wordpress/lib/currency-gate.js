'use strict';

// Currency is validated against the site, never written.
//
// Two facts, kept separate because conflating them produced an earlier, wrong "currency is a payment
// field" row: (a) a Wix payment record has no currency, so the only available action is to
// validate the source history against the target site's currency and REPORT; (b) multi-currency
// history is a real gap with no workaround, and the honest handling is to HALT before any order
// write rather than import a mixed history at face value. No store surveyed so far has one --
// one reference store's 7,283 orders were all ILS despite two configured currencies -- so this gate is what
// lets a single-currency store proceed and stops a multi-currency one.
//
// Everything here is pure. The caller supplies the settings currency (read from
// wc/v3/settings/general through store-currency.js, never from an order), the per-order currency
// values (already resolved through resolveOrderCurrency, which decodes `&#8362;` and refuses a
// symbol that contradicts the store), and the target site's currency.

const { ISO_4217 } = require('./store-currency.js');

const OUTCOMES = Object.freeze({
  VALIDATED: 'currency-validated',
  MISMATCH: 'currency-mismatch',
  MULTI: 'currency-multi-detected',
  UNRESOLVED: 'currency-unresolved',
});

function normalizeCode(value) {
  const text = value === undefined || value === null ? '' : String(value).trim().toUpperCase();
  return ISO_4217.test(text) ? text : null;
}

// `orderCurrencies` is either an array of resolved codes (one per order; null for unresolved) or a
// map { CODE: count }. Counts are what the report needs; the array form is accepted so a caller
// can hand over resolveOrderCurrency's results one by one.
function tallyOrderCurrencies(orderCurrencies) {
  const counts = new Map();
  let unresolved = 0;
  const add = (code, n) => {
    const key = normalizeCode(code);
    if (!key) { unresolved += n; return; }
    counts.set(key, (counts.get(key) || 0) + n);
  };
  if (Array.isArray(orderCurrencies)) {
    for (const code of orderCurrencies) add(code, 1);
  } else if (orderCurrencies && typeof orderCurrencies === 'object') {
    for (const [code, n] of Object.entries(orderCurrencies)) {
      const count = Number(n);
      if (!Number.isInteger(count) || count < 0) throw new Error(`currency count for ${code} must be a non-negative integer`);
      add(code, count);
    }
  } else {
    throw new Error('orderCurrencies must be an array of codes or a { CODE: count } map');
  }
  return { counts, unresolved };
}

// The decision. `halt` is true whenever an order write must not proceed.
function evaluateCurrencyGate({ settingsCurrency, orderCurrencies, targetSiteCurrency, configuredCurrencies = [] } = {}) {
  const findings = [];
  const store = normalizeCode(settingsCurrency);
  const target = normalizeCode(targetSiteCurrency);
  const { counts, unresolved } = tallyOrderCurrencies(orderCurrencies || []);
  const distinct = [...counts.keys()].sort();
  const totalOrders = [...counts.values()].reduce((a, b) => a + b, 0) + unresolved;

  // Configuration is reported, never decided on: two configured currencies with a single-currency
  // history is a shape seen on a real store, and it proceeds.
  const configured = [...new Set((configuredCurrencies || []).map(normalizeCode).filter(Boolean))].sort();
  if (configured.length > 1) findings.push({ code: 'currency-multi-configured', currencies: configured });

  if (!store) {
    return {
      outcome: OUTCOMES.UNRESOLVED, halt: true, storeCurrency: null, targetCurrency: target,
      distinctOrderCurrencies: distinct, orderCurrencyCounts: Object.fromEntries(counts), unresolvedOrders: unresolved, totalOrders,
      findings: [...findings, { code: 'store-currency-unreadable', note: 'wc/v3/settings/general did not yield an ISO 4217 code; the order field is not a substitute' }],
    };
  }
  if (!target) {
    // The comparison Decision 5 asks for is against the TARGET SITE. Without its currency there is
    // nothing to validate against, and "validated" would report a comparison that never happened.
    return {
      outcome: OUTCOMES.UNRESOLVED, halt: true, storeCurrency: store, targetCurrency: null,
      distinctOrderCurrencies: distinct, orderCurrencyCounts: Object.fromEntries(counts), unresolvedOrders: unresolved, totalOrders,
      findings: [...findings, { code: 'target-currency-unknown', note: 'read the target site currency before validating; the gate cannot pass without it' }],
    };
  }
  if (unresolved > 0) {
    // An order whose currency could not be resolved is money we cannot place. Not a mismatch, not
    // a multi-currency store -- an unknown, and unknown halts.
    findings.push({ code: 'order-currency-unresolved', count: unresolved });
  }

  let outcome;
  if (distinct.length > 1) {
    outcome = OUTCOMES.MULTI;
    findings.push({ code: 'currency-multi-detected', currencies: distinct, counts: Object.fromEntries(counts) });
  } else if (store !== target) {
    outcome = OUTCOMES.MISMATCH;
    findings.push({ code: 'currency-mismatch', storeCurrency: store, targetCurrency: target });
  } else if (distinct.length === 1 && distinct[0] !== store) {
    // Every order agrees with itself but not with the settings: the settings changed after the
    // history was written, or the settings read is wrong. Either way the history and the target
    // disagree, and that is a mismatch.
    outcome = OUTCOMES.MISMATCH;
    findings.push({ code: 'currency-mismatch', storeCurrency: store, orderCurrency: distinct[0], targetCurrency: target });
  } else if (unresolved > 0) {
    outcome = OUTCOMES.UNRESOLVED;
  } else {
    outcome = OUTCOMES.VALIDATED;
  }

  return {
    outcome,
    halt: outcome !== OUTCOMES.VALIDATED,
    storeCurrency: store,
    targetCurrency: target,
    distinctOrderCurrencies: distinct,
    orderCurrencyCounts: Object.fromEntries(counts),
    unresolvedOrders: unresolved,
    totalOrders,
    findings,
  };
}

module.exports = { OUTCOMES, evaluateCurrencyGate, tallyOrderCurrencies };
