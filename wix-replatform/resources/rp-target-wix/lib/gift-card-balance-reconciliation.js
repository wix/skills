'use strict';

const { isBlank } = require('./value-utils.js');

// rp-target-wix — spec 0042 Decision 5: balance-reconciliation REPORTING, not a write path.
//
// Wix's gift-cards API has no balance-increase/credit method (spec 0042's "no-credit-API
// finding": create, send-email, query/search, disable, find-by-email, redeem, void — nothing that
// raises a balance). The only correction for a card already created wrong is disable-and-replace,
// a code change that alters the customer-facing code and needs its own human sign-off (see
// gift-cards/gift-card.json's pitfalls) — never a silent balance patch. This module therefore only
// ever REPORTS drift; it never proposes "replay the difference," which is exactly the
// double-decrement risk spec 0042 Decision 5 rules out (a card must never be built by
// gift-card-build.js twice under different balance policies).
//
// BLOCKED the same way spec 0042 Decision 5 itself is: `sourceBalance` below is meant to come from
// spec 0040's bridge plugin, which is code-only and not yet installed/live-tested on any real
// site. This module is ready to consume that data the moment it exists.

function normalizeMoney(value) {
  if (isBlank(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

// One card's reconciliation row. `policy` records which spec 0042 Decision 5 policy the card was
// CREATED under — required, because the correct verdict for an identical mismatch differs by
// policy: under Policy A (face value, no replay) an overstatement is the known, accepted
// consequence of that choice; the same mismatch under Policy B (verified balance at creation) or
// Policy C (face value, then corrected by replaying real order-linked redemptions — see
// gift-card-redemption-build.js) means the card was born wrong, or its replay is incomplete/wrong,
// and needs investigation, not passive acceptance. Policy C is included here alongside B, not
// given its own "in-progress replay" leniency: a reconciliation check is the caller's to run only
// once replay is believed complete, not this module's to guess at.
function buildBalanceReconciliationRow({ sourceNumber, policy, sourceBalance, wixBalance } = {}) {
  if (isBlank(sourceNumber)) {
    return {
      sourceNumber: sourceNumber == null ? null : sourceNumber,
      ok: false,
      gap: { code: 'missing-source-number', summary: 'sourceNumber is required to report a reconciliation row against.' },
    };
  }
  if (policy !== 'A' && policy !== 'B' && policy !== 'C') {
    return {
      sourceNumber,
      ok: false,
      gap: { code: 'invalid-policy', summary: `policy must be "A", "B", or "C" (spec 0042 Decision 5) — got ${JSON.stringify(policy)}.` },
    };
  }

  const source = normalizeMoney(sourceBalance);
  if (source === null) {
    return {
      sourceNumber,
      ok: false,
      gap: { code: 'unavailable-source-balance', summary: `no verified current balance available for card ${sourceNumber} from the bridge plugin (spec 0040) — report this card as unreconciled rather than assuming it matches.` },
    };
  }
  const wix = normalizeMoney(wixBalance);
  if (wix === null) {
    return {
      sourceNumber,
      ok: false,
      gap: { code: 'unavailable-wix-balance', summary: `no Wix balance available for card ${sourceNumber} — read it back via Get Gift Card before reconciling.` },
    };
  }

  const drift = Math.round((wix - source) * 100) / 100;
  if (drift === 0) {
    return { sourceNumber, ok: true, policy, sourceBalance: source, wixBalance: wix, drift: 0, verdict: 'matches', action: 'none' };
  }

  if (policy === 'A' && drift > 0) {
    return {
      sourceNumber,
      ok: false,
      policy,
      sourceBalance: source,
      wixBalance: wix,
      drift,
      verdict: 'expected-overstatement',
      action: 'disable-and-replace-or-accept',
      summary: `card ${sourceNumber} shows ${wix} in Wix but ${source} at the source — the known, accepted overstatement of Policy A (face value at creation, no replay). Correcting it requires disabling and replacing the card (no balance-credit API exists), which changes the customer-facing code and needs its own human sign-off.`,
    };
  }

  // Any other direction/policy combination is not a shape any policy's documented behavior
  // produces on its own (e.g. Policy A showing a Wix balance BELOW the source, or any mismatch at
  // all under Policy B/C) — a real anomaly, not something to explain away.
  return {
    sourceNumber,
    ok: false,
    policy,
    sourceBalance: source,
    wixBalance: wix,
    drift,
    verdict: 'unexpected-drift',
    action: 'investigate',
    summary: `card ${sourceNumber} shows ${wix} in Wix vs ${source} at the source (drift ${drift}) under Policy ${policy} — not a shape any policy's documented behavior explains; investigate before accepting or correcting it.`,
  };
}

function buildBalanceReconciliationReport(cards) {
  const rows = (cards || []).map((card) => buildBalanceReconciliationRow(card));
  const mismatches = rows.filter((row) => !row.ok);
  return {
    totalCards: rows.length,
    matched: rows.length - mismatches.length,
    mismatches,
    rows,
  };
}

module.exports = {
  normalizeMoney,
  buildBalanceReconciliationRow,
  buildBalanceReconciliationReport,
};
