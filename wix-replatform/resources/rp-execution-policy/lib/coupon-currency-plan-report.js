'use strict';

// The coupons / currency / plan-definitions section of the
// plan report, with the same accounting discipline as payments-report.js:
//
//   1. Every line is emitted WITH its count, including zero. A missing line is indistinguishable
//      from a line nobody computed.
//   2. Per area, written + excluded + skipped = discovered, or the report is not approvable.
//   3. The report never says "imported N coupons": the codes are overwhelmingly auto-generated
//      single-use promos, and the redeemability breakdown is the honest count.
//   4. "none found" is never phrased as "not supported": a store with zero plan rows has nothing
//      to import, which is a measured fact, not a missing capability.

const LINES = Object.freeze([
  'coupons-source-total', 'coupons-not-published', 'coupons-discovered', 'coupons-written',
  'coupons-redeemable', 'coupons-expired', 'coupons-exhausted', 'coupons-no-expiry',
  'coupon-type-unmappable', 'coupon-scope-unmappable', 'coupons-usage-limit-unresolved', 'coupons-skipped',
  'coupon-usage-surface', 'coupon-usage-written', 'coupon-usage-unresolved',
  // Spec 0142. `coupons-spent-after-capture` and `coupons-partially-used-limit-reduced` are
  // sub-counts of `coupons-written`, NOT terms in the identity: both describe a coupon that WAS
  // created, just not as the source snapshot described it. `coupons-face-value-precision-unsupported`
  // is a real identity term — that coupon is refused, and a report that hid it would read as
  // "we imported every redeemable one".
  'coupons-spent-after-capture', 'coupons-partially-used-limit-reduced',
  'coupons-face-value-precision-unsupported',
  'voucher-drift-reconciled', 'voucher-drift-remedy-pending',
  // Non-count: the money still redeemable twice, as "<amount> <currency> across <n> codes".
  'voucher-liability-live',
  'currency-validated', 'currency-mismatch', 'currency-multi-detected', 'currency-unresolved',
  'plans-source-total', 'plans-written', 'plan-description-truncated', 'plans-skipped', 'plans-live-hazard',
]);
const TEXT_LINES = Object.freeze(['coupon-usage-surface', 'voucher-liability-live']);
const COUNT_LINES = Object.freeze(LINES.filter((l) => !TEXT_LINES.includes(l)));
const PROHIBITED = Object.freeze([/\bimported \d[\d,]* coupon/i, /not supported/i]);

function asCount(value, code, blocking) {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) { blocking.push({ code: 'invalid-count', detail: `${code} must be a non-negative integer, got ${JSON.stringify(value)}` }); return 0; }
  return n;
}

function buildCouponCurrencyPlanReport({ counts = {}, notPublishedByStatus = {}, couponUsageSurface = null, voucherLiabilityLive = null, currencyOutcome = null, planSources = null, notes = [] } = {}) {
  const blocking = [];
  const lines = [];
  const c = {};
  for (const code of COUNT_LINES) c[code] = asCount(counts[code], code, blocking);
  for (const code of Object.keys(counts)) {
    if (code === 'skippedBy') continue; // the per-reason breakdown ridealong from tallyCouponWriteOutcomes; rendered as notes below
    if (!LINES.includes(code)) blocking.push({ code: 'unknown-report-line', detail: `${code} is not an Appendix D line, so the report has nowhere to put it` });
  }
  const skippedBy = counts.skippedBy && typeof counts.skippedBy === 'object' ? counts.skippedBy : {};
  const skippedNotes = Object.entries(skippedBy).map(([reason, n]) => `coupons-skipped: ${n} × ${reason}`);

  // Coupons: discovered = written + type-unmappable + scope-unmappable + usage-limit-unresolved
  //                       + face-value-precision-unsupported + skipped.   (the last is spec 0142)
  const couponAccounted = c['coupons-written'] + c['coupon-type-unmappable'] + c['coupon-scope-unmappable'] + c['coupons-usage-limit-unresolved'] + c['coupons-face-value-precision-unsupported'] + c['coupons-skipped'];
  if (couponAccounted !== c['coupons-discovered']) {
    blocking.push({ code: 'coupon-accounting-mismatch', detail: `written ${c['coupons-written']} + type-unmappable ${c['coupon-type-unmappable']} + scope-unmappable ${c['coupon-scope-unmappable']} + usage-limit-unresolved ${c['coupons-usage-limit-unresolved']} + face-value-precision-unsupported ${c['coupons-face-value-precision-unsupported']} + skipped ${c['coupons-skipped']} = ${couponAccounted}, but ${c['coupons-discovered']} were discovered` });
  }
  if (c['coupons-face-value-precision-unsupported'] > 0) {
    blocking.push({ code: 'coupon-face-value-precision-unsupported', detail: `${c['coupons-face-value-precision-unsupported']} coupon(s) were refused because their face value carries more precision than the target can hold. Rounding them would put a different amount on the target while every check reported a match — decide per coupon before approving` });
  }
  // Spec 0142 Decision 7: a pending remedy means money is redeemable a second time on the
  // merchant's live store. It halts approval, and the halt names the money, not just the count.
  if (c['voucher-drift-remedy-pending'] > 0) {
    blocking.push({ code: 'voucher-drift-remedy-pending', detail: `${c['voucher-drift-remedy-pending']} bearer voucher(s) were spent at source and are still redeemable on the target${voucherLiabilityLive ? ` (${voucherLiabilityLive})` : ''}. Remedy: deactivate each in place and tag it Already_Used — the record, the code and the amount all survive. It needs the owner's decision per code, and a 2xx never counts as applied without a read-back` });
  }
  // Source total = discovered + not published; a DB total above REST is the EXPECTED shape.
  if (c['coupons-source-total'] !== c['coupons-discovered'] + c['coupons-not-published']) {
    blocking.push({ code: 'coupon-denominator-mismatch', detail: `source total ${c['coupons-source-total']} != discovered ${c['coupons-discovered']} + not published ${c['coupons-not-published']}` });
  }
  const redeemPartition = c['coupons-redeemable'] + c['coupons-expired'] + c['coupons-exhausted'] + c['coupons-usage-limit-unresolved'];
  if (redeemPartition !== c['coupons-discovered']) {
    blocking.push({ code: 'coupon-redeemability-mismatch', detail: `redeemable + expired + exhausted + usage-limit-unresolved = ${redeemPartition}, discovered ${c['coupons-discovered']}` });
  }
  // Plans: source total = written + skipped (unmappable, reconciled, failed all land in skipped).
  if (c['plans-source-total'] !== c['plans-written'] + c['plans-skipped']) {
    blocking.push({ code: 'plan-accounting-mismatch', detail: `plans written ${c['plans-written']} + skipped ${c['plans-skipped']} != source total ${c['plans-source-total']}` });
  }
  // A purchasable plan that landed and could not be archived is live on the merchant's site now.
  if (c['plans-live-hazard'] > 0) {
    blocking.push({ code: 'plan-live-hazard', detail: `${c['plans-live-hazard']} plan(s) came back purchasable and the archive call failed; archive them by hand (Pricing Plans V2 archive) before this report is approved` });
  }
  // Currency: exactly one of the four outcomes carries 1. `currency-unresolved` is its own line
  // (the settings, the target or individual orders could not be read), not a generic "missing".
  const currencyFlags = c['currency-validated'] + c['currency-mismatch'] + c['currency-multi-detected'] + c['currency-unresolved'];
  if (currencyFlags !== 1) blocking.push({ code: 'currency-outcome-missing', detail: `exactly one currency outcome must be reported, got ${currencyFlags}` });
  if (c['currency-mismatch'] > 0 || c['currency-multi-detected'] > 0) {
    blocking.push({ code: 'currency-halt', detail: 'order import must not proceed: the source history is not in the target site currency, or spans more than one currency' });
  }
  if (c['currency-unresolved'] > 0) {
    blocking.push({ code: 'currency-halt', detail: 'order import must not proceed: the store currency, the target site currency, or the currency of some orders could not be resolved (see the gate\'s findings)' });
  }
  if (couponUsageSurface === null || couponUsageSurface === undefined) {
    blocking.push({ code: 'coupon-usage-surface-missing', detail: 'the discovery must name which surface carried coupon usage (rest-order-coupon-lines, wc_order_coupon_lookup, or none-found)' });
  }

  for (const code of LINES) {
    if (code === 'coupon-usage-surface') lines.push({ code, label: code, value: couponUsageSurface === null || couponUsageSurface === undefined ? 'not-reported' : String(couponUsageSurface) });
    else if (code === 'voucher-liability-live') lines.push({ code, label: code, value: voucherLiabilityLive === null || voucherLiabilityLive === undefined ? 'none' : String(voucherLiabilityLive) });
    else lines.push({ code, label: code, value: c[code] });
  }
  for (const [status, n] of Object.entries(notPublishedByStatus || {})) {
    lines.push({ code: `coupons-not-published:${status}`, label: `coupons-not-published (${status}, deliberately excluded)`, value: asCount(n, `coupons-not-published:${status}`, blocking) });
  }
  if (planSources) {
    for (const [source, n] of Object.entries(planSources)) lines.push({ code: `plans-source-total:${source}`, label: `plans-source-total (${source})`, value: asCount(n, `plans-source-total:${source}`, blocking) });
  }

  const rendered = renderCouponCurrencyPlanReport({ lines, notes: [...skippedNotes, ...notes], counts: c, currencyOutcome, voucherLiabilityLive });
  for (const pattern of PROHIBITED) {
    if (pattern.test(rendered)) blocking.push({ code: 'prohibited-phrase', detail: `the report matches ${pattern}: counts must carry the redeemability breakdown, and absence is "none found", never "not supported"` });
  }
  return { lines, blocking, rendered, approvable: blocking.length === 0 };
}

function renderCouponCurrencyPlanReport({ lines, notes = [], counts = {}, currencyOutcome = null, voucherLiabilityLive = null }) {
  const out = ['Coupons, currency and pricing-plan definitions', ''];
  // The honest headline, never "imported N coupons".
  out.push(`  ${counts['coupons-discovered'] || 0} published coupon codes discovered: ${counts['coupons-redeemable'] || 0} redeemable, ${counts['coupons-expired'] || 0} expired, ${counts['coupons-exhausted'] || 0} fully redeemed, ${counts['coupons-no-expiry'] || 0} with no expiry`);
  // Spec 0142: money redeemable twice is the one thing that must not be a line item to scroll past.
  if ((counts['voucher-drift-remedy-pending'] || 0) > 0) {
    out.push(`  ⚠️ ${counts['voucher-drift-remedy-pending']} bearer voucher(s) spent at source are still redeemable on the target${voucherLiabilityLive ? `: ${voucherLiabilityLive}` : ''}`);
  }
  if ((counts['coupons-spent-after-capture'] || 0) > 0) {
    out.push(`  ${counts['coupons-spent-after-capture']} coupon(s) were used up at source between the read and the write, and were created switched off`);
  }
  if ((counts['coupons-face-value-precision-unsupported'] || 0) > 0) {
    out.push(`  ⚠️ ${counts['coupons-face-value-precision-unsupported']} coupon(s) carry a face value the target cannot hold and were NOT created — reported rather than rounded`);
  }
  if ((counts['coupons-partially-used-limit-reduced'] || 0) > 0) {
    out.push(`  ${counts['coupons-partially-used-limit-reduced']} coupon(s) were partly used at source and carry only the uses the holder has left`);
  }
  if ((counts['plans-source-total'] || 0) === 0) out.push('  no pricing plans found in the source (all plan-shaped sources hold zero rows)');
  if (currencyOutcome) out.push(`  currency: ${currencyOutcome}`);
  out.push('');
  for (const line of lines) out.push(`  ${line.label}: ${line.value}`);
  if (notes.length > 0) { out.push(''); for (const note of notes) out.push(`  note: ${note}`); }
  return out.join('\n');
}

module.exports = { LINES, COUNT_LINES, TEXT_LINES, buildCouponCurrencyPlanReport, renderCouponCurrencyPlanReport };
