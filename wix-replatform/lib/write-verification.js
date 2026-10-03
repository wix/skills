'use strict';
const { isDeepStrictEqual } = require('node:util');
const crypto = require('node:crypto');
const { contactId, opaqueId } = require('./entity-verification');
const email = value => typeof value === 'string' ? value.trim().toLowerCase() : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

// Expected fields come from the source projection. Extra server fields do not satisfy
// missing fields, and null/empty/false/zero remain distinct. No heuristic normalization.
function assertProjection(value, path = 'expected') {
  if (value === undefined) throw new Error(`Undefined verification value at ${path}; omit the key or supply an explicit JSON value`);
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) assertProjection(value[i], `${path}[${i}]`);
    else for (const [key, child] of Object.entries(value)) assertProjection(child, `${path}.${key}`);
  }
}
function compareProjection(expected, actual, { kind = '', path = '' } = {}) {
  assertProjection(expected);
  const checks = [];
  function compare(e, a, p, present) {
    if (kind === 'contact' && p === 'email.email') {
      checks.push({ path: p, matches: present && email(e) === email(a) });
    } else if (Array.isArray(e)) {
      checks.push({ path: p, matches: Array.isArray(a) && e.length === a.length });
      e.forEach((v, i) => compare(v, a?.[i], `${p}[${i}]`, Array.isArray(a) && i < a.length));
    } else if (e && typeof e === 'object') {
      if (!Object.keys(e).length) checks.push({ path: p, matches: present && isDeepStrictEqual(e, a) });
      else for (const [k, v] of Object.entries(e)) compare(v, a?.[k], p ? `${p}.${k}` : k, own(a, k));
    } else checks.push({ path: p, matches: present && isDeepStrictEqual(e, a) });
  }
  compare(expected, actual, path, actual !== undefined);
  return { verified: checks.length > 0 && checks.every(c => c.matches), checks };
}
function contactIdentity(expected, actual, id) {
  const checks = [{ path: 'id', matches: contactId(id) && actual?.id === id && !actual?._dryRunPlaceholder }];
  const hasExternal = typeof expected?.externalId === 'string' && expected.externalId.trim() !== '';
  const hasEmail = typeof expected?.email?.email === 'string' && email(expected.email.email) !== '';
  checks.push({ path: 'source-identity', matches: hasExternal || hasEmail });
  if (hasExternal) checks.push({ path: 'externalId', matches: actual?.externalId === expected.externalId });
  if (hasEmail) checks.push({ path: 'email.email', matches: email(actual?.email?.email) === email(expected.email.email) });
  return { verified: checks.every(c => c.matches), checks };
}
function verifyContact(expected, actual, id) {
  const identity = contactIdentity(expected, actual, id);
  const values = compareProjection(expected, actual, { kind: 'contact' });
  return { verified: identity.verified && values.verified, checks: [...identity.checks, ...values.checks] };
}
function subscriptionExpected(product) {
  const value = product?.subscriptionDetails;
  const entries = value?.subscriptions;
  if (!Array.isArray(entries) || !entries.length || entries.some(s => !s?.title) || new Set(entries.map(s => s.title)).size !== entries.length) {
    throw new Error('Subscription verification requires nonempty, uniquely titled subscriptions');
  }
  if (typeof value.allowOneTimePurchases !== 'boolean' || entries.some(s =>
    !['title', 'description', 'frequency', 'interval', 'autoRenewal'].every(k => own(s, k)))) {
    throw new Error('Subscription verification requires the complete expected field projection');
  }
  return JSON.parse(JSON.stringify(value));
}
function verifySubscriptionEvidence(evidence) {
  try {
    if (!evidence || evidence.dryRun || !opaqueId(evidence.targetId)) throw new Error('Invalid evidence');
    const expected = subscriptionExpected({ subscriptionDetails: evidence.expected });
    const actual = evidence.actual;
    const entries = actual?.subscriptionDetails?.subscriptions;
    const checks = [{ path: 'product.id', matches: actual?.id === evidence.targetId && !actual?._dryRunPlaceholder },
      { path: 'subscriptionDetails.subscriptions.length', matches: Array.isArray(entries) && entries.length === expected.subscriptions.length },
      { path: 'subscriptionDetails.allowOneTimePurchases', matches: actual?.subscriptionDetails?.allowOneTimePurchases === expected.allowOneTimePurchases }];
    for (const wanted of expected.subscriptions) {
      const matches = (entries || []).filter(s => s?.title === wanted.title);
      const entry = matches.length === 1 ? matches[0] : undefined;
      checks.push({ path: `subscriptions:${wanted.title}.id`, matches: matches.length === 1 && opaqueId(entry?.id) });
      checks.push(...compareProjection(wanted, entry, { path: `subscriptions:${wanted.title}` }).checks);
    }
    return { verified: checks.every(c => c.matches), checks };
  } catch { return { verified: false, checks: [{ path: 'evidence', matches: false }] }; }
}
function verifyProduct(expected, actual, id, { marker, variants = [] } = {}) {
  const checks = [{ path: 'id', matches: opaqueId(id) && actual?.id === id && !actual?._dryRunPlaceholder }];
  // Marker must have been selected from the source, not filled from the returned entity.
  checks.push({ path: 'source-marker', matches: Boolean(marker?.path) && marker.value !== undefined && marker.value !== '' });
  if (marker?.path) {
    const value = marker.path.split('.').reduce((v, k) => v?.[k], actual);
    checks.push({ path: marker.path, matches: isDeepStrictEqual(marker.value, value) });
  }
  checks.push(...compareProjection(expected, actual).checks);
  const targetVariants = actual?.variantsInfo?.variants;
  const seen = new Set();
  for (const v of variants) {
    const matches = (targetVariants || []).filter(t => t?.id === v.variantId);
    checks.push({ path: `variant:${v.variantId}`, matches: opaqueId(v.variantId) && !seen.has(v.variantId) && matches.length === 1 });
    seen.add(v.variantId);
    checks.push(...compareProjection(v.expected, matches[0]).checks);
  }
  return { verified: checks.every(c => c.matches), checks };
}
const CONTRACT_DIGEST = digest({ version: 1, contact: 'source-key/externalId+email/exact-values', product: 'source-marker/variant-id/exact-values' });
function receipt({ siteId, sourceKey, kind, expected, targetId, actual, marker, variants, operation, attempts = 1, dryRun = false }) {
  const comparison = kind === 'contact' ? verifyContact(expected, actual, targetId) : verifyProduct(expected, actual, targetId, { marker, variants });
  return { schemaVersion: 1, siteId, sourceKey, kind, targetId, expected, actual, marker, variants, operation, attempts, dryRun,
    payloadDigest: digest({ expected, marker, variants }), contractDigest: CONTRACT_DIGEST,
    ...comparison, verified: !dryRun && Boolean(siteId && sourceKey && operation) && comparison.verified };
}
function validReceipt(r, context = {}) {
  if (!r || r.schemaVersion !== 1 || !['contact', 'product'].includes(r.kind) || !r.verified || r.dryRun || r.contractDigest !== CONTRACT_DIGEST) return false;
  if (!r.expected || r.payloadDigest !== digest({ expected: r.expected, marker: r.marker, variants: r.variants })) return false;
  for (const key of ['siteId', 'sourceKey', 'targetId', 'payloadDigest', 'kind']) if (context[key] !== undefined && r[key] !== context[key]) return false;
  try { return receipt(r).verified; } catch { return false; }
}
module.exports = { assertProjection, email, digest, compareProjection, contactIdentity, verifyContact, subscriptionExpected,
  verifySubscriptionEvidence, verifyProduct, receipt, validReceipt, CONTRACT_DIGEST };
