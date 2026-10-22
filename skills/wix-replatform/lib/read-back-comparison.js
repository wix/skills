'use strict';

const {
  isDeepStrictEqual
} = require('node:util');
const {
  canonical,
  populated,
  domainContract
} = require('./read-back-contract');
const old = require('./write-verification');
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
      addresses: (c.addresses || []).map(a => a.address)
    }
  };
}
function compareEntity(entity, expected, rawActual) {
  const e = expected[entity] || expected,
    a = entity === 'member' ? memberProjection(rawActual) : rawActual[entity] || rawActual,
    checks = [];
  const readPath = p => {
    p = canonical(p);
    if (entity !== 'member') return p;
    if (p === 'contact.firstName') return 'contact.name.first';
    if (p === 'contact.lastName') return 'contact.name.last';
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
    if (empty(wanted)) {
      add(p, wanted, actual, empty(actual));
      return;
    }
    if (Array.isArray(wanted) && /^media\.itemsInfo\.items$/.test(p) && entity === 'product') {
      const result = old.compareProjection(wanted, actual, {
        path: p
      });
      const landed = Array.isArray(actual) && actual.every(item => item?.image?.id && item.mediaType !== 'UNKNOWN_MEDIA_TYPE');
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
      if (entity === 'member' && p === 'contact.addresses' || entity === 'order' && p === 'appliedDiscounts') {
        const subset = (w, a) => w && typeof w === 'object' ? Array.isArray(w) ? Array.isArray(a) && w.length === a.length && w.every((v, i) => subset(v, a[i])) : Object.entries(w).every(([k, v]) => subset(v, a?.[k])) : isDeepStrictEqual(w, a);
        const remaining = [...actual];
        if (wanted.length !== actual.length) add(`${p}[]`, wanted, actual, false);
        for (const value of wanted) {
          const at = remaining.findIndex(candidate => subset(value, candidate));
          walk(value, at < 0 ? undefined : remaining.splice(at, 1)[0], `${p}[]`);
        }
        return;
      }
      if (entity === 'order' && p === 'lineItems') {
        for (const item of wanted) {
          const matches = actual.filter(x => x.id === item.id);
          if (!item.id || matches.length !== 1) add(`${p}[]`, item, null, false);else walk(item, matches[0], `${p}[]`);
        }
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
  decimal
};
