'use strict';

// Coupons: one discovery surface, redeemability classification, and a
// mapping that reports rather than approximates.
//
// The traps this module exists for are about COUNTING, not writing:
//   * `wc/v3/coupons` returns published coupons; the `posts` table also holds drafts. A run that
//     takes its denominator from the database and writes from REST books a permanent shortfall
//     (4,287 vs 4,224 on one reference store). Here the REST set is the discovered set, and the database
//     count is a reconciliation check whose difference is reported as deliberately excluded.
//   * `usage_limit: 0` (or empty) means UNLIMITED in WooCommerce. Read as a real limit it
//     classified 60 live coupons as exhausted.
//   * "imported 4,224 coupons" is a claim of substance the run does not have: they are mostly
//     auto-generated single-use codes. The report carries the redeemability breakdown instead.
//
// Pure. The caller reads REST and the database; this module classifies, counts and maps.

const OUTCOMES = Object.freeze({
  AMOUNT_PRECISION_UNSUPPORTED: 'coupon-amount-precision-unsupported',
  MAPPED: 'coupon-mapped',
  TYPE_UNMAPPABLE: 'coupon-type-unmappable',
  SCOPE_UNMAPPABLE: 'coupon-scope-unmappable',
  // `usage_limit` / `usage_count` that are not integers: redeemability cannot be decided, so the
  // coupon is not written (review: "1.5" read as unlimited made a malformed row redeemable).
  USAGE_LIMIT_UNRESOLVED: 'coupon-usage-limit-unresolved',
});
// WooCommerce discount types with a Wix coupon type. Anything else is REPORTED, never defaulted:
// a coerced free-gift coupon would start discounting money.
const TYPE_MAP = Object.freeze({
  percent: 'percentOffRate',
  fixed_cart: 'moneyOffAmount',
  fixed_product: 'moneyOffAmount',
});
// A monetary value the target cannot represent is REFUSED, for every coupon, not only for the
// single-use bearer instruments that earn a fresh pre-write read. Rounding 19.999 to 20.00 puts a
// different amount on the target from the one the merchant published, and every later check then
// agrees the two sides match -- false verified equality on money. The target holds two decimal
// places; more than that is not a rounding decision we get to make on the merchant's behalf.
const TARGET_DECIMALS = 2;
function moneyPrecision(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;              // not a number: a different refusal
  const frac = (text.split('.')[1] || '').replace(/0+$/, '');   // trailing zeros are formatting
  return frac.length;
}

const FINDINGS = Object.freeze([
  'coupon-free-shipping-amount-dropped',
  'coupon-individual-use-implicit',
  'coupon-exhausted-imported-inactive',
  'coupon-partially-used-limit-reduced',
  'coupon-expired-imported',
]);

function toInstant(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  // WooCommerce REST gives naive ISO for `_gmt` fields; treat those as UTC.
  const iso = /Z$|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// A usage LIMIT: 0 / "" / null is UNLIMITED (WooCommerce), a positive integer is the limit, and
// anything else ("1.5", "abc") is `invalid` -- it is neither, and reading it as unlimited made a
// malformed row redeemable (review).
function usageLimitOf(value) {
  if (value === undefined || value === null || value === '') return { limit: null, invalid: false };
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^\d+$/.test(text)) return { limit: null, invalid: true };
  const n = Number(text);
  return { limit: n === 0 ? null : n, invalid: false };
}
// A usage COUNT: absent is zero, a non-negative integer is the count, anything else is invalid
// (`Number("abc")` is NaN, and `NaN >= limit` is false, which read "used an unknown number of
// times" as "never used").
function usageCountOf(value) {
  if (value === undefined || value === null || value === '') return { count: 0, invalid: false };
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^\d+$/.test(text)) return { count: null, invalid: true };
  return { count: Number(text), invalid: false };
}

// Decision 2: redeemable iff not expired AND not usage-exhausted. `usage_limit` 0/empty = unlimited.
// `unresolved` when the usage fields cannot be read: then it is neither redeemable nor exhausted,
// and the mapper refuses it rather than writing a coupon whose redeemability nobody decided.
function classifyCoupon(coupon, { now = Date.now() } = {}) {
  const expiresAt = toInstant(coupon.date_expires_gmt || coupon.date_expires);
  const { limit: usageLimit, invalid: limitInvalid } = usageLimitOf(coupon.usage_limit);
  const { count: usageCount, invalid: countInvalid } = usageCountOf(coupon.usage_count);
  // `usage_limit_per_user` decides nothing about redeemability, but it is a usage field the mapper
  // writes (limitPerCustomer). It is validated HERE, not only in the mapper: the summary counts the
  // unresolved bucket from this classification and checks it against the mapper's refusals, and a
  // per-user value refused only by the mapper made the two disagree and the summary throw (review).
  const { limit: usageLimitPerUser, invalid: perUserInvalid } = usageLimitOf(coupon.usage_limit_per_user);
  const unresolved = limitInvalid || countInvalid || perUserInvalid;
  const expired = expiresAt !== null && expiresAt <= now;
  const exhausted = !unresolved && usageLimit !== null && usageCount >= usageLimit;
  // What the HOLDER can still do, which is the only number that should reach the target. The
  // target starts its own usage count at zero, so writing the source's ORIGINAL limit hands back
  // every redemption already spent: a coupon with limit 6 and 4 uses gone becomes 6 fresh uses
  // instead of the 2 the holder is owed. `null` means unlimited (or undecidable), never zero.
  const remainingUses = unresolved || usageLimit === null ? null : Math.max(0, usageLimit - usageCount);
  return {
    expired,
    noExpiry: expiresAt === null,
    usageUnlimited: !unresolved && usageLimit === null,
    exhausted,
    remainingUses,
    partiallyUsed: remainingUses !== null && remainingUses > 0 && usageCount > 0,
    unresolved,
    ...(unresolved ? { unresolvedFields: [...(limitInvalid ? ['usage_limit'] : []), ...(countInvalid ? ['usage_count'] : []), ...(perUserInvalid ? ['usage_limit_per_user'] : [])] } : {}),
    redeemable: !unresolved && !expired && !exhausted,
    usageLimit,
    usageCount,
    usageLimitPerUser,
  };
}

// Decision 1 and the accounting identity. `restCoupons` is the exhaustive REST sweep;
// `postsByStatus` is the `posts` count by post_status (publish, draft, auto-draft, ...).
// Where ensureCoupon's outcomes fold in the report: a coupon the target already holds IS on the
// target, so `coupon-reconciled-existing` counts as written; everything that left no coupon behind
// is skipped, with its reason kept alongside for the notes.
function tallyCouponWriteOutcomes(outcomes = []) {
  const written = outcomes.filter((o) => o === 'coupon-written' || o === 'coupon-reconciled-existing').length;
  const skippedBy = {};
  for (const o of outcomes) {
    if (o === 'coupon-written' || o === 'coupon-reconciled-existing') continue;
    skippedBy[o] = (skippedBy[o] || 0) + 1;
  }
  return { 'coupons-written': written, 'coupons-skipped': outcomes.length - written, skippedBy };
}

function summarizeCoupons({ restCoupons = [], postsByStatus = null, now = Date.now(), mappings = null, writeOutcomes = null } = {}) {
  if (!Array.isArray(restCoupons)) throw new Error('restCoupons must be an array (the exhaustive wc/v3/coupons sweep)');
  const discovered = restCoupons.length;
  const classes = restCoupons.map((c) => classifyCoupon(c, { now }));
  // The partition: usage-unresolved first (nothing about such a row is decided, expiry included),
  // then expired, then exhausted-but-not-expired, then redeemable.
  const counts = {
    'coupons-discovered': discovered,
    'coupons-redeemable': classes.filter((c) => c.redeemable).length,
    'coupons-expired': classes.filter((c) => c.expired && !c.unresolved).length,
    'coupons-exhausted': classes.filter((c) => c.exhausted && !c.expired).length,
    'coupons-usage-limit-unresolved': classes.filter((c) => c.unresolved).length,
    'coupons-no-expiry': classes.filter((c) => c.noExpiry).length,
  };
  const findings = [];
  let sourceTotal = null;
  let notPublished = null;
  if (postsByStatus && typeof postsByStatus === 'object') {
    sourceTotal = 0;
    notPublished = {};
    for (const [status, n] of Object.entries(postsByStatus)) {
      const count = Number(n);
      if (!Number.isInteger(count) || count < 0) throw new Error(`posts count for ${status} must be a non-negative integer`);
      sourceTotal += count;
      if (status !== 'publish') notPublished[status] = count;
    }
    const excluded = Object.values(notPublished).reduce((a, b) => a + b, 0);
    const published = Number(postsByStatus.publish || 0);
    // The reconciliation: published rows in the DB should equal what REST returned. A DB total
    // EXCEEDING REST by exactly the non-published rows is the expected shape, not a shortfall.
    if (published !== discovered) {
      findings.push({ code: 'coupon-count-reconciliation-drift', publishedInDatabase: published, discoveredViaRest: discovered });
    }
    counts['coupons-source-total'] = sourceTotal;
    counts['coupons-not-published'] = excluded;
  } else {
    counts['coupons-source-total'] = discovered;
    counts['coupons-not-published'] = 0;
    findings.push({ code: 'coupon-database-count-unavailable', note: 'reconciliation against the posts table was not performed; the REST sweep stands alone' });
  }
  // Redeemability partition: redeemable + expired + (exhausted, not expired) + unresolved = discovered.
  const partition = counts['coupons-redeemable'] + counts['coupons-expired'] + counts['coupons-exhausted'] + counts['coupons-usage-limit-unresolved'];
  if (partition !== discovered) throw new Error(`coupon redeemability does not partition: ${partition} != ${discovered}`);

  const byType = {};
  for (const c of restCoupons) {
    const type = String(c.discount_type || '(none)');
    byType[type] = (byType[type] || 0) + 1;
  }
  const unmappableTypes = Object.fromEntries(Object.entries(byType).filter(([type]) => !TYPE_MAP[type]));
  // ONE surface owns the numerator classes. `mappings` is the per-coupon mapCouponToWix result
  // (same order as restCoupons); when it is supplied the unmappable counts come from it, because
  // the mapper refuses more than the type table does (a zero amount, a percentage over 100, a
  // scope Wix cannot hold). Deriving them from discount_type alone let a mapper refusal and a
  // type-table count cancel each other into a balanced, wrong report (review).
  if (Array.isArray(mappings)) {
    if (mappings.length !== restCoupons.length) throw new Error(`mappings (${mappings.length}) must align one-to-one with restCoupons (${restCoupons.length})`);
    counts['coupon-type-unmappable'] = mappings.filter((m) => m && m.outcome === OUTCOMES.TYPE_UNMAPPABLE).length;
    counts['coupon-scope-unmappable'] = mappings.filter((m) => m && m.outcome === OUTCOMES.SCOPE_UNMAPPABLE).length;
    const unresolvedByMapper = mappings.filter((m) => m && m.outcome === OUTCOMES.USAGE_LIMIT_UNRESOLVED).length;
    if (unresolvedByMapper !== counts['coupons-usage-limit-unresolved']) throw new Error(`the mapper refused ${unresolvedByMapper} coupons as usage-unresolved but the classification counts ${counts['coupons-usage-limit-unresolved']}; the mappings do not describe these coupons`);
  } else {
    counts['coupon-type-unmappable'] = Object.values(unmappableTypes).reduce((a, b) => a + b, 0);
    counts['coupon-scope-unmappable'] = 0;
    findings.push({ code: 'coupon-unmappable-counts-preliminary', note: 'derived from discount_type only; pass the per-coupon mappings for the report' });
  }
  if (Array.isArray(writeOutcomes)) Object.assign(counts, tallyCouponWriteOutcomes(writeOutcomes));
  return {
    counts,
    byType,
    unmappableTypes,
    notPublished: notPublished || {},
    findings,
    // Honest count language (Decision 2): never the bare "imported N coupons".
    summary: `${discovered} published coupon codes discovered (${counts['coupons-redeemable']} redeemable, ${counts['coupons-expired']} expired, ${counts['coupons-exhausted']} fully redeemed${counts['coupons-usage-limit-unresolved'] > 0 ? `, ${counts['coupons-usage-limit-unresolved']} with unreadable usage fields` : ''}, ${counts['coupons-no-expiry']} with no expiry)`,
  };
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Decision 3 + Appendix A + stores/coupon entity guidance -> one Wix coupon specification.
// `resolveProduct(sourceProductId)` and `resolveCategory(sourceCategoryId)` map through the
// catalog crosswalks (target ids); either may be omitted, in which case a scoped coupon is
// reported as scope-unmappable rather than widened to the whole store.
function mapCouponToWix(coupon, { now = Date.now(), resolveProduct = null, resolveCategory = null } = {}) {
  const findings = [];
  const code = coupon && coupon.code !== undefined && coupon.code !== null ? String(coupon.code).trim() : '';
  if (!code) throw new Error('a coupon needs a code');
  const type = String(coupon.discount_type || '');
  const classification = classifyCoupon(coupon, { now });
  // WooCommerce REST sends a boolean; a CSV export sends "yes"/"true". Never a truthy string test,
  // which would read "no" as true.
  const freeShipping = coupon.free_shipping === true || /^(yes|true)$/i.test(String(coupon.free_shipping || ''));

  // Usage fields that cannot be read decide nothing, so nothing is written: `active` below is
  // derived from `exhausted`, and an undecidable coupon written active is a giveaway. This comes
  // BEFORE the type check because the summary's two identities share one line
  // (`coupons-usage-limit-unresolved`): the redeemability partition counts it from the
  // classification, the write accounting from this outcome, and a row that is both unresolved and
  // type-unmappable must land in the same bucket on both sides or the summary refuses to add up
  // (review: one such row threw the whole store's summary). The unmappable type is
  // still named in the reason.
  if (classification.unresolved) {
    return { outcome: OUTCOMES.USAGE_LIMIT_UNRESOLVED, specification: null, classification, findings, reason: { fields: classification.unresolvedFields, usageLimit: coupon.usage_limit, usageCount: coupon.usage_count, usageLimitPerUser: coupon.usage_limit_per_user, note: 'usage_limit / usage_count / usage_limit_per_user are not integers; redeemability cannot be decided', ...(TYPE_MAP[type] ? {} : { discountType: type || '(none)', alsoTypeUnmappable: true }) } };
  }
  // Then the TYPE. A free-gift coupon that also grants free shipping is still a free-gift coupon:
  // writing it as a bare freeShipping coupon would drop the gift silently and count it as mapped
  // (review finding).
  if (!TYPE_MAP[type]) {
    return { outcome: OUTCOMES.TYPE_UNMAPPABLE, specification: null, classification, findings, reason: { discountType: type || '(none)', ...(freeShipping ? { note: 'carries free_shipping too; the gift semantics have no Wix type' } : {}) } };
  }

  // Then PRECISION, before anything is built. This gate is here rather than beside the bearer
  // -voucher fresh read because it has nothing to do with usage: a fixed-money coupon with a
  // usage limit of 6, or a percentage of 12.3456, is not a bearer instrument and skips that read
  // entirely, and it would still put an amount on the target that differs from the source.
  // A free-shipping coupon carries no amount, so it is not subject to this.
  if (!freeShipping) {
    const decimals = moneyPrecision(coupon.amount);
    if (decimals !== null && decimals > TARGET_DECIMALS) {
      return {
        outcome: OUTCOMES.AMOUNT_PRECISION_UNSUPPORTED,
        specification: null,
        classification,
        findings,
        reason: {
          amount: String(coupon.amount),
          decimals,
          maxDecimals: TARGET_DECIMALS,
          note: 'the target holds two decimal places; report this coupon rather than rounding it, which would put a different amount on the target while every check reported a match',
        },
      };
    }
  }

  const spec = {
    name: code,
    code,
    // An exhausted single-use code imported ACTIVE would become redeemable again on Wix, because
    // Wix starts its own usage count at zero. Imported inactive, it is a record of the promotion
    // and not a second giveaway. (The contract says import and classify; what
    // `active` should be is this module's recorded assumption.)
    active: !classification.exhausted,
    startTime: toInstant(coupon.date_created_gmt || coupon.date_created) || now,
    // Always explicit: unsent, Wix derives it from which branch of scope-or-minimum was taken.
    appliesToSubscriptions: false,
  };
  if (classification.exhausted) findings.push({ code: 'coupon-exhausted-imported-inactive', couponCode: code, usageCount: classification.usageCount, usageLimit: classification.usageLimit });
  const expiresAt = toInstant(coupon.date_expires_gmt || coupon.date_expires);
  if (expiresAt !== null) {
    spec.expirationTime = expiresAt;
    if (classification.expired) findings.push({ code: 'coupon-expired-imported', couponCode: code, expiredAt: new Date(expiresAt).toISOString() });
  }
  // Every coupon a migration writes says so, and one whose usage we changed says why -- a
  // merchant reading a reduced limit has nothing else on the coupon to explain it. The vocabulary
  // is frozen in rp-target-wix/lib/coupon-redemption-drift.js; it is repeated as literals here
  // rather than imported, because a source adapter must not depend on a target adapter.
  // `Disabled_At_Source` is in the vocabulary but has no WooCommerce signal: this discovery only
  // takes published coupons, and WooCommerce has no separate enabled flag. A source that does
  // have one sets it from its own adapter.
  spec.tags = ['Imported'];
  if (classification.exhausted) spec.tags.push('Already_Used');

  // The REMAINING uses, never the source's original limit -- see classifyCoupon's remainingUses.
  // An exhausted coupon keeps its original limit here and is carried by `active: false` instead:
  // `usageLimit: 0` is rejected by the target (it validates "more than 0"), and a record of the
  // promotion is worth more than a number nobody can act on.
  if (classification.usageLimit !== null) {
    spec.usageLimit = classification.exhausted ? classification.usageLimit : classification.remainingUses;
    if (classification.partiallyUsed) {
      spec.tags.push('Partially_Used');
      findings.push({
        code: 'coupon-partially-used-limit-reduced',
        couponCode: code,
        sourceUsageLimit: classification.usageLimit,
        sourceUsageCount: classification.usageCount,
        writtenUsageLimit: classification.remainingUses,
      });
    }
  }
  // Validated by classifyCoupon (an invalid value returned above as unresolved).
  if (classification.usageLimitPerUser !== null) spec.limitPerCustomer = classification.usageLimitPerUser;
  const minimum = money(coupon.minimum_amount);

  // Type. Free shipping is its own Wix type and carries no value; the amount half is dropped and
  // reported per coupon (entity pitfall: the two cannot coexist).
  const amount = money(coupon.amount);
  if (freeShipping) {
    spec.freeShipping = true;
    if (minimum !== null) spec.minimumSubtotal = minimum; // optional on free shipping (docs)
    if (amount !== null && TYPE_MAP[type]) findings.push({ code: 'coupon-free-shipping-amount-dropped', couponCode: code, discountType: type, amount: String(coupon.amount) });
  } else if (TYPE_MAP[type] === 'percentOffRate') {
    if (amount === null) return { outcome: OUTCOMES.TYPE_UNMAPPABLE, specification: null, classification, findings, reason: { discountType: type, amount: coupon.amount, note: 'no positive amount' } };
    if (amount > 100) return { outcome: OUTCOMES.TYPE_UNMAPPABLE, specification: null, classification, findings, reason: { discountType: type, amount: coupon.amount, note: 'a percentage above 100' } };
    spec.percentOffRate = amount;
  } else {
    if (amount === null) return { outcome: OUTCOMES.TYPE_UNMAPPABLE, specification: null, classification, findings, reason: { discountType: type, amount: coupon.amount, note: 'no positive amount' } };
    spec.moneyOffAmount = amount;
  }

  // Scope. Wix holds at most ONE scope group. Storewide is the faithful mapping for an
  // unrestricted coupon; a single product or single category maps when its target id resolves;
  // anything wider is reported, not widened.
  const products = Array.isArray(coupon.product_ids) ? coupon.product_ids : [];
  const categories = Array.isArray(coupon.product_categories) ? coupon.product_categories : [];
  const exclusions = [...(coupon.excluded_product_ids || []), ...(coupon.excluded_product_categories || [])];
  if (!freeShipping) {
    if (type === 'fixed_product' && products.length === 0 && categories.length === 0) {
      // WooCommerce takes the amount off EVERY qualifying unit in the cart; Wix's moneyOffAmount
      // takes it off the order once (or off the one lowest-priced item). Neither shape is the
      // promotion the merchant published, and an active coupon with the wrong value is not made
      // safe by a finding beside it (review: it was written storewide, one-per-order).
      return { outcome: OUTCOMES.TYPE_UNMAPPABLE, specification: null, classification, findings, reason: { discountType: type, scope: 'unrestricted', note: 'a per-unit fixed amount on every product has no Wix coupon shape; moneyOffAmount discounts the order once' } };
    }
    if (products.length === 0 && categories.length === 0) {
      // LIVE 2026-09-05: a coupon sent with BOTH `scope` and `minimumSubtotal` reads back with the
      // scope and no minimum -- the minimum is silently dropped. Storewide is implied when no
      // scope is sent, and `minimumSubtotal` alone satisfies the scope-or-minimum rule, so an
      // unrestricted coupon with a minimum spend carries the minimum and no scope.
      if (minimum !== null) spec.minimumSubtotal = minimum;
      else spec.scope = { namespace: 'stores' };
    } else if (products.length === 1 && categories.length === 0) {
      const target = resolveProduct ? resolveProduct(products[0]) : null;
      if (!target) return { outcome: OUTCOMES.SCOPE_UNMAPPABLE, specification: null, classification, findings, reason: { scope: 'product', sourceProductId: products[0], note: resolveProduct ? 'product not in crosswalk' : 'no product crosswalk supplied' } };
      spec.scope = { namespace: 'stores', group: { name: 'product', entityId: String(target) } };
    } else if (categories.length === 1 && products.length === 0) {
      const target = resolveCategory ? resolveCategory(categories[0]) : null;
      if (!target) return { outcome: OUTCOMES.SCOPE_UNMAPPABLE, specification: null, classification, findings, reason: { scope: 'collection', sourceCategoryId: categories[0], note: resolveCategory ? 'category not in crosswalk' : 'no category crosswalk supplied' } };
      spec.scope = { namespace: 'stores', group: { name: 'collection', entityId: String(target) } };
    } else {
      return { outcome: OUTCOMES.SCOPE_UNMAPPABLE, specification: null, classification, findings, reason: { scope: 'multiple', products: products.length, categories: categories.length } };
    }
  }
  // Constraints Wix cannot hold are REFUSALS, never findings beside an active coupon: each one,
  // dropped, makes the coupon MORE generous than the merchant published -- it discounts excluded
  // products or categories, sale items, carts under the minimum spend, uncapped amounts, or
  // shoppers the code was never issued to (review: exclusion-bearing coupons were written storewide
  // with a finding, which the entity contract forbids). An exact coupon or none.
  const constraints = [];
  if (exclusions.length > 0) constraints.push({ constraint: 'exclusions', excluded: exclusions.length });
  if (coupon.exclude_sale_items === true) constraints.push({ constraint: 'sale-items-excluded' });
  if (money(coupon.maximum_amount) !== null) constraints.push({ constraint: 'maximum-amount', maximumAmount: String(coupon.maximum_amount) });
  if (Array.isArray(coupon.email_restrictions) && coupon.email_restrictions.length > 0) constraints.push({ constraint: 'email-restrictions', emails: coupon.email_restrictions.length });
  if (minimum !== null && spec.scope) constraints.push({ constraint: 'scope-with-minimum', minimumAmount: String(coupon.minimum_amount), note: 'a product/collection scope and a minimum spend cannot both be expressed (the write drops the minimum)' });
  if (constraints.length > 0) {
    return { outcome: OUTCOMES.SCOPE_UNMAPPABLE, specification: null, classification, findings, reason: { scope: 'constraints', constraints, note: 'the source coupon carries eligibility constraints Wix cannot express; written without them it would be more generous than published' } };
  }
  // Wix allows one coupon per order regardless, so individual_use is implicit: counted once, not per coupon.
  if (coupon.individual_use === true) findings.push({ code: 'coupon-individual-use-implicit', couponCode: code });

  return { outcome: OUTCOMES.MAPPED, specification: spec, classification, findings, reason: null };
}

// Decision 1's exhaustive sweep. `fetchPage(page)` -> { items, total } where `total` is the
// X-WP-Total header; runs until an EMPTY page (or, with the header present, a short one), and
// refuses to report a denominator that disagrees with the header -- a one-page sweep reporting 100
// is the failure this exists for.
async function sweepCoupons(fetchPage, { perPage = 100, maxPages = 1000 } = {}) {
  if (typeof fetchPage !== 'function') throw new Error('sweepCoupons needs fetchPage(page) -> { items, total }');
  const all = [];
  let headerTotal = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const { items, total } = await fetchPage(page);
    if (!Array.isArray(items)) throw new Error(`fetchPage(${page}) returned no items array`);
    if (total !== undefined && total !== null && headerTotal === null) {
      // The header is the denominator's witness, so it is READ, not coerced: `Number("garbage")`
      // is NaN, a NaN header let a short first page end the sweep and skipped the reconciliation
      // that exists to catch exactly that (review). A header that is not a non-negative integer
      // is refused outright; a caller whose server sends none passes null.
      const text = String(total).trim();
      if (!/^\d+$/.test(text)) throw new Error(`fetchPage(${page}) reported a malformed total ${JSON.stringify(total)}; X-WP-Total must be a non-negative integer, and the sweep refuses an unreadable denominator (pass null when the server sends no header)`);
      headerTotal = Number(text);
    }
    all.push(...items);
    if (items.length === 0) break;
    // A short page ends the sweep only when the header is there to confirm the total. A server
    // that caps the page size below `perPage` and sends no X-WP-Total returns a short page that
    // is FULL (review demonstrated two rows accepted as the whole list); without the header the
    // sweep runs on to an empty page.
    if (items.length < perPage && headerTotal !== null) break;
    if (page === maxPages) throw new Error(`coupon sweep exceeded ${maxPages} pages; refusing to report a partial denominator`);
  }
  // De-duplicate by id FIRST: a store trading mid-sweep can shift a row onto a second page, and
  // that row counted twice is not a denominator error. A count that still disagrees with the
  // header after de-duplication is -- a row was missed, or appeared, and the sweep cannot vouch.
  const seen = new Set();
  const unique = all.filter((c) => { const id = String(c.id); if (seen.has(id)) return false; seen.add(id); return true; });
  if (headerTotal !== null && Number.isFinite(headerTotal) && headerTotal !== unique.length) {
    throw new Error(`coupon sweep collected ${unique.length} distinct coupons but X-WP-Total says ${headerTotal}; the denominator cannot be trusted`);
  }
  return { coupons: unique, headerTotal, duplicatesDropped: all.length - unique.length };
}

module.exports = { OUTCOMES, TYPE_MAP, FINDINGS, classifyCoupon, summarizeCoupons, mapCouponToWix, sweepCoupons, tallyCouponWriteOutcomes };
