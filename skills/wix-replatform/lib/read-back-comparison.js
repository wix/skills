'use strict';

const {
  isDeepStrictEqual
} = require('node:util');
const {
  populated,
  domainContract
} = require('./read-back-contract');
// Target-side comparison paths are built from Wix response field names by concatenation;
// they keep the former display normalization (array positions as []), never the source grammar.
const canonical = p => String(p).replace(/\[\d+\]/g, '[]');
const old = require('./write-verification');
const { storesProductMediaItemLanded, normalizeV5AddressItem } = require('../resources/rp-target-wix/lib/wix-writers');
const empty = v => !populated(v);
function decimal(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(v));
  if (!m) return null;
  const whole = m[2].replace(/^0+(?=\d)/, ''),
    fraction = (m[3] || '').replace(/0+$/, '');
  return `${m[1] === '-' && (whole !== '0' || fraction) ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}
function memberProjection(value) {
  const m = value.member || value,
    c = value.contact;
  if (!c) return m;
  return {
    ...m,
    contact: {
      firstName: c.name?.first,
      lastName: c.name?.last,
      phones: [c.phone?.phone, ...(c.additionalPhones || []).map(p => p.phone)].filter(v => v !== undefined),
      addresses: (c.addresses || []).map(a => a.address),
      // Members v1 writes contact.company and contact.jobTitle as strings; Contacts V5 reads them
      // back as company { name, jobTitle }. Compared in the shape the member writer sent.
      ...(c.company !== undefined ? v5Company(c.company) : {})
    }
  };
}
function v5Company(company) {
  if (!company || typeof company !== 'object' || Array.isArray(company)) return { company };
  return { company: company.name, ...(company.jobTitle !== undefined ? { jobTitle: company.jobTitle } : {}) };
}
// Contacts V5 stores an address item as { tag, address: {...} }. The comparator preserves that
// shape so every check, loss and mapping binding names the accepted target path.
function contactProjection(value, { sent = false } = {}) {
  const c = value?.contact || value;
  if (!c || !Array.isArray(c.addresses)) return c;
  return { ...c, addresses: sent ? c.addresses.map(item => normalizeV5AddressItem(item)) : c.addresses };
}
// Variant choices read back as ids, and the stock flag read back as inventoryStatus.inStock, are
// compared through the same view the create verifier uses (write-verification.js
// variantComparisonView).
function productProjection(product) {
  const variants = product?.variantsInfo?.variants;
  if (!Array.isArray(variants)) return product;
  return {
    ...product,
    variantsInfo: {
      ...product.variantsInfo,
      variants: variants.map(v => old.variantComparisonView(v, product))
    }
  };
}
const leafPaths = (v, p) => v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).flatMap(([k, x]) => leafPaths(x, `${p}.${k}`)) : [p];
function plainCouponDiscount(value) {
  const coupon = value?.coupon;
  if (!coupon || coupon.id || !coupon.code) return null;
  return require('./order-loop-steps').plainDiscount(value.discountType, coupon.code, coupon.amount);
}
// Kept equal to order-history.js PLACEHOLDER_LINE_NAME (asserted by order-placeholder-line-test.js).
const ORDER_PLACEHOLDER_LINE_NAME = 'Items not recorded in source';
function compareEntity(entity, expected, rawActual) {
  const e = entity === 'contact' ? contactProjection(expected, { sent: true }) : expected[entity] || expected,
    a = entity === 'member' ? memberProjection(rawActual) : entity === 'product' ? productProjection(rawActual[entity] || rawActual) : entity === 'contact' ? contactProjection(rawActual) : rawActual[entity] || rawActual,
    checks = [];
  const readPath = p => {
    p = canonical(p);
    if (entity === 'contact') return p;
    if (entity !== 'member') return p;
    if (p === 'contact.firstName') return 'contact.name.first';
    if (p === 'contact.lastName') return 'contact.name.last';
    if (p === 'contact.company') return 'contact.company.name';
    if (p === 'contact.jobTitle') return 'contact.company.jobTitle';
    if (p.startsWith('contact.addresses[].')) return p.replace('contact.addresses[].', 'contact.addresses[].address.');
    return p.startsWith('contact.') ? p : `member.${p}`;
  };
  function add(p, wanted, actual, matches) {
    checks.push({
      writePath: canonical(`${entity}.${p}`),
      readPath: readPath(p),
      matches,
      kind: matches ? 'verified' : empty(actual) && !empty(wanted) ? 'dropped' : 'changed'
    });
  }
  const serverOwned = domainContract(entity).readBackProjection.serverOwned;
  function walk(wanted, actual, p) {
    const server = serverOwned.find(row => row.path === `${entity}.${canonical(p)}`);
    if (server) {
      checks.push({
        writePath: server.path,
        readPath: canonical(p),
        matches: true,
        kind: 'unverifiable',
        reason: server.reason
      });
      return;
    }
    // A tracked variant quantity is not on the Catalog V3 product read (it lives in Inventory
    // Items); verifyCatalogInventory (stores-inventory.js) reads and verifies it after the write.
    if (entity === 'product' && /^variantsInfo\.variants\[\d*\]\.inventoryItem\.quantity$/.test(canonical(p))) {
      checks.push({ writePath: canonical(`${entity}.${p}`), readPath: canonical(p), matches: true, kind: 'unverifiable',
        reason: 'Catalog V3 product read carries no tracked quantity; the inventory reconcile verifies it (Inventory Items API)' });
      return;
    }
    // A source order with no line items lands with the one approved placeholder line (order-history
    // withPlaceholderLineItem, a human-approved policy). Verified as exactly that line at the
    // order total, never as a changed field; anything else still fails.
    if (entity === 'order' && p === 'lineItems' && empty(wanted) && Array.isArray(actual) && actual.length) {
      const [line] = actual, total = e?.priceSummary?.total?.amount;
      const ok = actual.length === 1 && line?.productName?.original === ORDER_PLACEHOLDER_LINE_NAME && line.quantity === 1
        && decimal(line.price?.amount) !== null && decimal(line.price.amount) === decimal(total ?? '0');
      checks.push({ writePath: 'order.lineItems', readPath: 'lineItems', matches: ok, kind: ok ? 'verified' : 'changed',
        ...(ok ? { reason: 'approved placeholder line for a source order with no line items (order-line-items-not-recorded)' } : {}) });
      return;
    }
    if (empty(wanted)) {
      // Stores V3 derives shippingWeightRange beside the required empty physicalProperties.
      const serverDerived = entity === 'product' && p === 'physicalProperties' && old.onlyServerPhysical(actual);
      add(p, wanted, actual, empty(actual) || serverDerived);
      return;
    }
    if (Array.isArray(wanted) && /^media\.itemsInfo\.items$/.test(p) && entity === 'product') {
      const result = old.compareProjection(wanted, actual, {
        path: p
      });
      // Every sent item listed and ingested (an empty gallery is pending for the create check, not
      // landed: the gate's media settlement waits for it).
      const landed = Array.isArray(actual) && actual.length === wanted.length && actual.every(storesProductMediaItemLanded);
      add(p, wanted, actual, result.verified && landed);
      return;
    }
    if (p === 'plainDescription' && entity === 'product') {
      add(p, wanted, actual, old.compareProjection(wanted, actual, {
        path: p
      }).verified);
      return;
    }
    if (Array.isArray(wanted)) {
      if (!Array.isArray(actual)) {
        for (const item of wanted) walk(item, undefined, `${p}[]`);
        return;
      }
      if (entity === 'member' && p === 'contact.phones') {
        const left = [...new Set(wanted)].sort(),
          right = [...new Set(actual)].sort();
        add(p, wanted, actual, isDeepStrictEqual(left, right));
        return;
      }
      if (entity === 'contact' && p === 'addresses') {
        // One-to-one, order-free pairing shared with verifyContact.
        if (wanted.length !== actual.length) add(`${p}[]`, wanted, actual, false);
        // A candidate pair matches only if this walk itself verifies it; its trial checks are discarded.
        const verifies = (value, candidate) => {
          const mark = checks.length;
          walk(value, candidate, `${p}[]`);
          const ok = checks.slice(mark).every(check => check.matches);
          checks.length = mark;
          return ok;
        };
        for (const [value, match] of old.pairUnordered(wanted, actual, verifies)) walk(value, match, `${p}[]`);
        return;
      }
      if (entity === 'member' && p === 'contact.addresses' || entity === 'order' && p === 'appliedDiscounts') {
        const subset = (w, a) => w && typeof w === 'object' ? Array.isArray(w) ? Array.isArray(a) && w.length === a.length && w.every((v, i) => subset(v, a[i])) : Object.entries(w).every(([k, v]) => subset(v, a?.[k])) : isDeepStrictEqual(w, a);
        const remaining = [...actual];
        if (wanted.length !== actual.length) add(`${p}[]`, wanted, actual, false);
        for (const value of wanted) {
          const at = remaining.findIndex(candidate => subset(value, candidate));
          if (at < 0 && entity === 'order') {
            // A coupon code the source coupon list lacks is sent as a plain discount line with the
            // same type and amount (order-loop-steps applyCouponStep, gap order-coupon-not-in-source).
            const plain = plainCouponDiscount(value);
            const kept = plain ? remaining.findIndex(candidate => subset(plain, candidate)) : -1;
            if (kept >= 0) {
              remaining.splice(kept, 1);
              for (const leaf of leafPaths(value, `${p}[]`)) checks.push({ writePath: canonical(`${entity}.${leaf}`), readPath: canonical(leaf), matches: true, kind: 'verified',
                reason: 'coupon kept as a plain discount line with the same amount (order-coupon-not-in-source)' });
              continue;
            }
          }
          walk(value, at < 0 ? undefined : remaining.splice(at, 1)[0], `${p}[]`);
        }
        return;
      }
      if (entity === 'order' && p === 'lineItems') {
        // A sent line id pairs by id. The order builders send none: Wix numbers the lines itself
        // (00000000-…-0001, …), so an id-less line pairs one-to-one, order-free, with the read line
        // this walk verifies (same pairing as contact addresses); a missing line still fails.
        if (wanted.length !== actual.length) add(`${p}[]`, wanted, actual, false);
        const verifies = (value, candidate) => {
          const mark = checks.length;
          walk(value, candidate, `${p}[]`);
          const ok = checks.slice(mark).every(check => check.matches);
          checks.length = mark;
          return ok;
        };
        const unnumbered = wanted.filter(item => !item?.id);
        for (const item of wanted.filter(item => item?.id)) {
          const matches = actual.filter(x => x.id === item.id);
          if (matches.length !== 1) add(`${p}[]`, item, null, false);else walk(item, matches[0], `${p}[]`);
        }
        const free = actual.filter(x => !wanted.some(item => item?.id && item.id === x.id));
        for (const [value, match] of old.pairUnordered(unnumbered, free, verifies)) walk(value, match, `${p}[]`);
        return;
      }
      add(p, wanted, actual, wanted.length === actual.length);
      wanted.forEach((v, i) => walk(v, actual[i], `${p}[${i}]`));
      return;
    }
    if (wanted && typeof wanted === 'object') {
      for (const [k, v] of Object.entries(wanted)) walk(v, actual?.[k], p ? `${p}.${k}` : k);
      return;
    }
    let equal = isDeepStrictEqual(wanted, actual);
    if (/(^|\.)(loginEmail|email)$/.test(p)) equal = old.email(wanted) === old.email(actual);else if (/(Date|At)$/.test(p) && typeof wanted === 'string' && Number.isFinite(Date.parse(wanted))) equal = Number.isFinite(Date.parse(actual)) && Date.parse(wanted) === Date.parse(actual);else if (/(^|\.)(amount|price|priceBeforeDiscount|priceAfterDiscount|total|subtotal|taxAmount|discountAmount)$/.test(p) && decimal(wanted) !== null) equal = decimal(wanted) === decimal(actual);
    add(p, wanted, actual, equal);
  }
  walk(e, a, '');
  return {
    verified: checks.length > 0 && checks.every(c => c.matches),
    checks
  };
}
module.exports = {
  compareEntity,
  memberProjection,
  contactProjection,
  decimal
};
