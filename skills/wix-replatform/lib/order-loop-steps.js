'use strict';

// Design v2: the order steps the fixed loop (runRecordTask) runs on every order after the generated
// build. The currency check (#708), shipping readiness (#711), the guest buyer pass, the buyer
// resolution and the setup receipt (#715) are the order composite's own; this file adds only what they do not:
//
// Currency fill. #708 checks that the store, the site and every order agree on one currency, but a
// body the build wrote without `currency` (the source sends a symbol such as Tuti's "&#8362;", which
// the C2 suggestion builder leaves to the loop) would still reach Import Order with none, and Import
// Order may store an empty currency. The loop fills the store currency, the one #708 matched to the
// site. A body whose currency differs from the store's waits (never sent with the wrong money).
//
// Coupons:
// - The build writes coupon entries by code ({ discountType, coupon: { code, name, amount } }); the
//   C2 suggestion builder does. The loop gives each its id from the coupon task, through the gated
//   lookup, by the coupon's source key (found from its code in the coupon extract: reading the
//   source is the loop's job).
// - When the build wrote no appliedDiscounts and the order has coupon lines, the toolkit's
//   buildCouponAppliedDiscounts is the default, with the same lookup.
// - A code the coupon extract does not have (the coupon was deleted on the source) can never be
//   linked: it stays a plain discount line (merchantDiscount) with the same amount, so the money is
//   kept and no coupon id is invented. A coupon that exists but has not landed waits, as any
//   dependency does (the gate decides).
// - A coupon the coupon task held for good (its last attempt on this site is a builder hold: the
//   plan cannot write it, e.g. a WooCommerce coupon type Wix has no match for) will never land, so
//   the order does not wait for it (run 09895795: 600 orders on 73 held coupons). It goes in like a
//   deleted code: a plain discount line with the same amount, and a cutover item. A changed plan
//   that later imports the coupon does not relink these orders.
// The coupon ref is the one the order entity's knowledge binds to appliedDiscounts[].coupon.id.

const fs = require('node:fs');
const path = require('node:path');
const { buildCouponAppliedDiscounts } = require('../resources/rp-target-wix/lib/order-applied-discount-build.js');

const MANIFEST = 'execution/execution-manifest.json';
const TEMPLATE = 'appliedDiscounts[].coupon.id';

function readNdjson(file) { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }

function couponRefFor(orderRef) {
  try {
    const fields = require('./dependency-proofs').domain(orderRef).dependencyReferenceFields || {};
    return Object.keys(fields).find(ref => (fields[ref] || []).includes(TEMPLATE)) || null;
  } catch { return null; }
}

// The coupon task's source key for each code, from its own extract.
function couponKeysByCode(projectDir, couponRef) {
  const keys = new Map();
  let tasks = [];
  try { tasks = JSON.parse(fs.readFileSync(path.join(projectDir, MANIFEST), 'utf8')).tasks || []; } catch { tasks = []; }
  for (const task of tasks) for (const binding of task.sourceBindings || []) {
    if (binding.ref !== couponRef || !binding.extractPath || !fs.existsSync(path.join(projectDir, binding.extractPath))) continue;
    for (const row of readNdjson(path.join(projectDir, binding.extractPath))) {
      const code = row?.code === undefined || row.code === null ? '' : String(row.code).trim().toLowerCase();
      if (code) keys.set(code, `${binding.keyPrefix || ''}${row[binding.keyField || 'id']}`);
    }
  }
  return keys;
}

// The coupon keys the coupon task held for good on this site: their last attempt is a builder hold.
function heldCouponKeys(projectDir, couponRef, siteId) {
  const held = new Set();
  let tasks = [], rows = [];
  try { tasks = JSON.parse(fs.readFileSync(path.join(projectDir, MANIFEST), 'utf8')).tasks || []; } catch { return held; }
  const taskIds = new Set(tasks.filter(task => (task.sourceBindings || []).some(b => b.ref === couponRef)).map(task => task.id));
  if (!taskIds.size) return held;
  try { rows = readNdjson(require('./local-state').attemptJournalPath(projectDir)); } catch { return held; }
  const last = new Map();
  for (const row of rows) if (taskIds.has(row?.writeSpecId) && (!siteId || !row.siteId || row.siteId === siteId)) last.set(row.sourceStableKey, row);
  for (const [key, row] of last) if (row.status === 'deferred' && row.deferral?.reason === 'builder-held') held.add(key);
  return held;
}

// The store currency, read as #708's check reads it (discovery/source-locale.json).
function storeCurrency(projectDir) {
  try { const sr = require('./source-regional.js'); return sr.settingValue(sr.readSourceRegionalSync(projectDir), 'currency') || null; } catch { return null; }
}

function orderStepContext({ projectDir, orderRef = 'ecom/order', siteId = null }) {
  const couponRef = couponRefFor(orderRef);
  return { currency: storeCurrency(projectDir), couponRef, couponKeys: couponRef ? couponKeysByCode(projectDir, couponRef) : new Map(),
    heldCoupons: couponRef ? heldCouponKeys(projectDir, couponRef, siteId) : new Set() };
}

// Member link (#715's prepare resolves the stamped buyer): the member id rides on the gated body so
// the grant covers it, and importOrderHistory gets the body without it (it refuses one that carries
// a member id and sets it itself from the buyer). An order the buyer could not link to its member is
// a cutover item; it still imports, linked to the contact.
function bodyForImport(order) {
  if (!order?.buyerInfo?.memberId) return order;
  const { memberId: _member, ...buyerInfo } = order.buyerInfo;
  return { ...order, buyerInfo };
}
function buyerFindings(buyer) {
  return (buyer?.findings || []).filter(f => FINDING_GAPS[f?.code]).map(f => ({ code: f.code }));
}

// Returns the body to send, or `{ deferred, reason }` (the gate records it as a reference gap).
function fillCurrency(body, steps) {
  const order = body && typeof body === 'object' ? body.order : null;
  if (!steps?.currency || !order || typeof order !== 'object') return body;
  if (order.currency === undefined || order.currency === null || order.currency === '') { order.currency = steps.currency; return body; }
  return String(order.currency).toUpperCase() === steps.currency ? body : { deferred: true, reason: 'order-currency-differs-from-store' };
}

const plainDiscount = (discountType, code, amount) => ({ discountType: discountType || 'GLOBAL', merchantDiscount: { description: `Coupon ${code}`.slice(0, 200), amount } });

// Runs on the built body inside the gate transform; returns the findings the loop journals.
function applyCouponStep(record, body, lookups, steps) {
  const findings = [];
  const order = body && typeof body === 'object' ? body.order : null;
  const couponLines = Array.isArray(record?.coupon_lines) ? record.coupon_lines : [];
  if (!steps?.couponRef || !order || typeof order !== 'object' || !couponLines.length) return findings;
  const keyOf = code => steps.couponKeys.get(String(code || '').trim().toLowerCase());
  // A deleted code or a coupon held for good never gets an id: its line stays a plain discount.
  const unlinkable = code => { const key = keyOf(code); return !key ? 'order-coupon-not-in-source' : steps.heldCoupons?.has(key) ? 'order-coupon-held' : null; };
  if (Array.isArray(order.appliedDiscounts)) {
    order.appliedDiscounts = order.appliedDiscounts.map((discount, index) => {
      const coupon = discount?.coupon;
      if (!coupon || coupon.id || !coupon.code) return discount;
      const why = unlinkable(coupon.code);
      if (why) { findings.push({ code: why }); return plainDiscount(discount.discountType, coupon.code, coupon.amount); }
      const id = lookups.ref(steps.couponRef, keyOf(coupon.code), `appliedDiscounts[${index}].coupon.id`);
      return id ? { ...discount, coupon: { ...coupon, id } } : discount;
    });
    return findings;
  }
  let written = 0;
  const built = buildCouponAppliedDiscounts({ couponLines, resolveCoupon: code => {
    const id = unlinkable(code) ? undefined : lookups.ref(steps.couponRef, keyOf(code), `appliedDiscounts[${written}].coupon.id`);
    if (!id) return null;
    written += 1;
    return { id };
  } });
  const unlinked = built.unresolved.filter(miss => unlinkable(miss.code) && miss.amount && Number(miss.amount) > 0)
    .map(miss => plainDiscount('GLOBAL', miss.code, { amount: miss.amount }));
  const all = [...built.appliedDiscounts, ...unlinked];
  if (all.length) order.appliedDiscounts = all;
  for (const miss of built.unresolved) { const why = unlinkable(miss.code); if (why) findings.push({ code: why }); }
  return findings;
}

// The cutover item for a coupon the loop could not link (recordTaskGap in the runner).
const FINDING_GAPS = Object.freeze({
  'buyer-member-email-mismatch': { severity: 'medium', action: 'These orders belong to a customer whose site member has a different login email than the order\'s billing email, so the order was not linked to the member (a wrong link would show one person\'s order to another). The order is linked to the contact. Link it in Business Manager > Orders if the member is the same person.' },
  'buyer-email-unusable': { severity: 'low', action: 'These orders carry a billing email that is not a usable address, so the buyer could not be matched to a member by email. The order is linked by contact only.' },
  'order-coupon-not-in-source': { severity: 'low', action: 'These orders used a coupon code that is not in the WooCommerce coupon list (deleted there). The discount is kept as a plain discount line with the same amount, not linked to a Wix coupon. No action unless coupon reports matter.' },
  'order-coupon-held': { severity: 'low', action: 'These orders used a coupon that was not imported to Wix (it is held: see the coupon cutover items for why). The discount is kept as a plain discount line with the same amount, not linked to a Wix coupon. No action unless coupon reports matter; creating the coupon in Wix later does not link these orders.' },
});
function findingGap(finding) { return FINDING_GAPS[finding?.code] ? { code: finding.code, ...FINDING_GAPS[finding.code] } : null; }

module.exports = { orderStepContext, plainDiscount, fillCurrency, storeCurrency, applyCouponStep, bodyForImport, buyerFindings, couponKeysByCode, heldCouponKeys, couponRefFor, findingGap, FINDING_GAPS };
