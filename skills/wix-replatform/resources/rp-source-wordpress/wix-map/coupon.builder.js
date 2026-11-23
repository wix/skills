'use strict';

// WooCommerce coupon -> Wix coupon, one export per fieldMappings row of coupon.json.
// Each export is `(record, { lookups, choices, args })` and returns `{ values: { <targetPath>: v } }`
// or `{ hold: { code } }` (lib/plan-builder.js). Every row reads the same reviewed mapping,
// rp-source-wordpress/lib/coupon-discovery.js mapCouponToWix (one specification per coupon), and
// writes only its own fields, so an operator can change or drop a row in the plan.
// A coupon the mapping refuses (an unmappable type, a scope or restriction Wix cannot hold, a money
// amount Wix cannot represent, undecidable usage) is held: written without the rule it would be
// more generous than the merchant published.
// Lookups (from the loop): lookups.ref('stores/product', 'product:<id>', SCOPE_PATH) and
// lookups.ref('stores/category', 'product-category:<id>', SCOPE_PATH) -> Wix id or undefined. The gate
// refuses a lookup without the target path the id is written at (REFERENCE_UNDECLARED).

const { mapCouponToWix, OUTCOMES } = require('../lib/coupon-discovery.js');

// One mapping per record and lookups (every row of one build shares it).
const memo = new WeakMap();
// Where the scope id is written: stores/coupon dependencyReferenceFields in target knowledge.
const SCOPE_PATH = 'scope.group.entityId';
const NO_LOOKUPS = {};
function mapped(record, lookups = NO_LOOKUPS) {
  const key = lookups || NO_LOOKUPS;
  if (!memo.has(record)) memo.set(record, new WeakMap());
  const byLookups = memo.get(record);
  if (byLookups.has(key)) return byLookups.get(key);
  const ref = typeof lookups.ref === 'function' ? lookups.ref : () => undefined;
  // Only a coupon with no code holds as coupon-code-missing. Any other error (a refused lookup, a
  // mapper defect) is thrown, so the runner records it under its own cause instead of "no code".
  const code = record && record.code != null ? String(record.code).trim() : '';
  const result = !code
    ? { outcome: 'coupon-code-missing', specification: null, findings: [], reason: { error: 'a coupon needs a code' } }
    : mapCouponToWix(record, {
      resolveProduct: (id) => ref('stores/product', `product:${id}`, SCOPE_PATH) || null,
      resolveCategory: (id) => ref('stores/category', `product-category:${id}`, SCOPE_PATH) || null,
    });
  byLookups.set(key, result);
  return result;
}
// A refused coupon holds from every row (the same code), so it is held whichever rows stay.
function slice(record, lookups, pick) {
  const m = mapped(record, lookups);
  if (m.outcome !== OUTCOMES.MAPPED || !m.specification) return { hold: { code: m.outcome } };
  const values = {};
  for (const [path, value] of Object.entries(pick(m.specification))) if (value !== undefined) values[path] = value;
  return { values, ...(m.findings && m.findings.length ? { findings: m.findings } : {}) };
}

// coupon-code: the code is also the coupon's name.
const couponCode = (record, { lookups } = {}) => slice(record, lookups, (s) => ({ code: s.code, name: s.name }));
// coupon-type-amount: percent / fixed amount / free shipping.
const couponType = (record, { lookups } = {}) => slice(record, lookups, (s) => ({ percentOffRate: s.percentOffRate, moneyOffAmount: s.moneyOffAmount, freeShipping: s.freeShipping }));
// coupon-dates: start (creation or a plugin start date) and expiry, epoch milliseconds UTC.
const couponDates = (record, { lookups } = {}) => slice(record, lookups, (s) => ({ startTime: s.startTime, expirationTime: s.expirationTime }));
// coupon-usage: remaining uses, active (an exhausted code is imported switched off), per customer.
const couponUsage = (record, { lookups } = {}) => slice(record, lookups, (s) => ({
  usageLimit: s.usageLimit, usageUnlimited: s.usageUnlimited, active: s.active, limitPerCustomer: s.limitPerCustomer, appliesToSubscriptions: s.appliesToSubscriptions, tags: s.tags,
}));
// coupon-minimum: minimum spend on an unscoped coupon.
const couponMinimum = (record, { lookups } = {}) => slice(record, lookups, (s) => ({ minimumSubtotal: s.minimumSubtotal }));
// coupon-scope: storewide, one product, or one category (target id from the gate lookup).
const couponScope = (record, { lookups } = {}) => slice(record, lookups, (s) => (s.scope ? {
  'scope.namespace': s.scope.namespace, 'scope.group.name': s.scope.group && s.scope.group.name, 'scope.group.entityId': s.scope.group && s.scope.group.entityId,
} : {}));

const ROW_EXPORTS = {
  'coupon-code': 'couponCode',
  'coupon-type-amount': 'couponType',
  'coupon-dates': 'couponDates',
  'coupon-usage': 'couponUsage',
  'coupon-minimum': 'couponMinimum',
  'coupon-scope': 'couponScope',
};

// The whole suggested coupon (reference and test material): the specification the rows write.
function build(record, lookups = {}) {
  const spec = {};
  for (const [rowId, fn] of Object.entries(ROW_EXPORTS)) {
    const r = module.exports[fn](record, { lookups });
    if (r.hold) return { status: 'held', holds: [{ decisionId: rowId, code: r.hold.code }] };
    for (const [path, value] of Object.entries(r.values)) setPath(spec, path.replace(/\[\]$/, ''), value);
  }
  return { specification: spec, findings: mapped(record, lookups).findings || [] };
}
function setPath(target, path, value) {
  const parts = path.split('.');
  let at = target;
  for (const p of parts.slice(0, -1)) at = (at[p] = at[p] || {});
  at[parts[parts.length - 1]] = value;
}

module.exports = { couponCode, couponType, couponDates, couponUsage, couponMinimum, couponScope, ROW_EXPORTS, build };
