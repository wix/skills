'use strict';

// Coupon usage per order, as the imported order's appliedDiscounts.
//
// There is no standalone write: an applied discount rides in the Import Order body (entity
// ecom/order-applied-discount, preferredWrite importOrder). So this module turns a source order's
// coupon lines into `appliedDiscounts[]` entries for the order body, resolving each code through
// the coupon crosswalk. A code the crosswalk cannot resolve produces NO entry and one unresolved
// report line -- a dangling reference would name a coupon that does not exist on the target.
//
// Every entry is the `coupon` one-of variant, which is the only honest one here: the discount
// genuinely was a coupon redemption. The plugin-computed `merchantDiscount` variant is a
// different entity (ecom/discount-rule's records) and is not this module's business.
//
// Pure. Amounts are kept as the source recorded them; Import Order stores money as-is and never
// recalculates, so the caller's priceSummary must already agree with these.

const OUTCOMES = Object.freeze({
  WRITTEN: 'coupon-usage-written',
  UNRESOLVED: 'coupon-usage-unresolved',
  NONE: 'coupon-usage-none',
});

function canonicalAmount(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Math.abs(Number(text));
  return n.toFixed(2);
}

// `couponLines`: WooCommerce order `coupon_lines[]` ({ code, discount, discount_tax }) or any
// { code, discount } shape. `resolveCoupon(code)` -> { id, name? } | null (the coupon crosswalk).
function buildCouponAppliedDiscounts({ couponLines = [], resolveCoupon, includeTax = false } = {}) {
  if (typeof resolveCoupon !== 'function') throw new Error('buildCouponAppliedDiscounts needs resolveCoupon(code) backed by the coupon crosswalk');
  if (!Array.isArray(couponLines)) throw new Error('couponLines must be an array');
  const appliedDiscounts = [];
  const unresolved = [];
  const findings = [];
  for (const line of couponLines) {
    const code = line && line.code !== undefined && line.code !== null ? String(line.code).trim() : '';
    if (!code) { findings.push({ code: 'coupon-line-without-code' }); continue; }
    let amount = canonicalAmount(line.discount);
    if (amount === null) { unresolved.push({ code, reason: 'amount-not-decimal', discount: line.discount }); continue; }
    if (includeTax) {
      const tax = canonicalAmount(line.discount_tax);
      if (tax !== null) amount = (Number(amount) + Number(tax)).toFixed(2);
    }
    const resolved = resolveCoupon(code);
    if (!resolved || !resolved.id) {
      unresolved.push({ code, reason: 'coupon-not-imported', amount });
      continue;
    }
    appliedDiscounts.push({
      // Order-level: WooCommerce records a coupon's total discount against the order, not per line.
      discountType: 'GLOBAL',
      coupon: { id: String(resolved.id), code, name: resolved.name ? String(resolved.name) : code, amount: { amount } },
    });
  }
  const outcome = couponLines.length === 0 ? OUTCOMES.NONE : (appliedDiscounts.length > 0 ? OUTCOMES.WRITTEN : OUTCOMES.UNRESOLVED);
  return { appliedDiscounts, unresolved, findings, outcome, counts: { written: appliedDiscounts.length, unresolved: unresolved.length } };
}

module.exports = { OUTCOMES, buildCouponAppliedDiscounts, canonicalAmount };
