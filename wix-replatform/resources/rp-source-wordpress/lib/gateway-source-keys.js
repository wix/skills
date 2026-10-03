'use strict';

// The deterministic half of spec 0124 A.3: given one order's source meta and its payment-method
// slug, decide which value — if any — may be written as the payment's provider transaction
// reference, and report every candidate that may not.
//
// The registry (gateway-source-keys.json) holds the evidence; this module holds only the rules.
// Two measured facts shape those rules, and both refute an obvious design:
//
//   1. The method slug names the checkout plugin, not necessarily the processor. Orders whose
//      method is one gateway are observed carrying another gateway's reference key, while orders
//      whose method IS that second gateway carry none. So attribution cannot be driven from the
//      slug alone -- a registry entry keyed on "matching names" would never fire.
//   2. Key presence is not attribution either. Many orders carry two families' keys at once, and
//      an offline (cash-on-delivery) order is observed carrying a gateway-shaped key. So "first
//      populated key wins" invents a precedence the data does not support.
//
// What survives both is: verified field semantics AND a registry-recognized relationship between
// the field's producer and the order's method, where that relationship may be direct or a
// separately verified layered integration. Everything else is reported, never written. A reported
// candidate is never truncated to fit, and never becomes evidence that a payment exists -- that
// gate is A.2's and needs a paid date.

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, 'gateway-source-keys.json');

function loadRegistry(registryPath = REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

// A meta value counts as populated only when it survives trimming. WooCommerce stores empty
// strings for keys a gateway touched but never filled, and an empty string is not a reference.
function populated(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function matchesSlug(slug, direct) {
  if (!slug) return false;
  const slugs = (direct && direct.slugs) || [];
  const prefixes = (direct && direct.slugPrefixes) || [];
  return slugs.includes(slug) || prefixes.some((prefix) => slug.startsWith(prefix));
}

// Recognition is the whole safeguard, so it is deliberately narrow: a direct method match, or a
// layered integration whose `verified` flag is literally true. An unverified layered entry is
// present in the registry so the relationship can be REPRESENTED without being trusted.
function recognizesMethod(family, paymentMethod) {
  if (!paymentMethod) return false;
  if (matchesSlug(paymentMethod, family.methodRelationships && family.methodRelationships.direct)) {
    return true;
  }
  const layered = (family.methodRelationships && family.methodRelationships.layered) || [];
  return layered.some(
    (entry) => entry.verified === true && (entry.frontEndMethodSlugs || []).includes(paymentMethod),
  );
}

function classifyMethod(paymentMethod, registry = loadRegistry()) {
  const rules = registry.methodClassification;
  if (!paymentMethod) return 'unknown';
  if (rules.offlineSlugs.includes(paymentMethod)) return 'offline';
  if (rules.onlineSlugs.includes(paymentMethod)) return 'online';
  if (rules.onlineSlugPrefixes.some((prefix) => paymentMethod.startsWith(prefix))) return 'online';
  return 'unknown';
}

// A.2 maps this onto the request: true for known offline, false for known online, and OMITTED
// when unknown. Omission is not a synonym for false -- guessing "offline" for an unrecognised
// slug is how a card payment ends up labelled as cash.
function resolveOfflinePayment(paymentMethod, registry = loadRegistry()) {
  const classification = classifyMethod(paymentMethod, registry);
  if (classification === 'offline') return { offlinePayment: true, findings: [] };
  if (classification === 'online') return { offlinePayment: false, findings: [] };
  return {
    offlinePayment: undefined,
    findings: [{ code: 'unclassified-method', paymentMethod: paymentMethod || null }],
  };
}

function referenceLimit(registry) {
  return registry.targetLimits.providerTransactionId;
}

// Why every populated family candidate on an order was or was not eligible, independent of
// whether one of them won.
function familyCandidateFindings(meta, paymentMethod, registry, limit) {
  const findings = [];
  for (const family of registry.families) {
    const recognized = recognizesMethod(family, paymentMethod);
    for (const field of family.referenceFields) {
      const value = populated(meta[field]);
      if (!value) continue;
      if (family.evidence !== 'verified') findings.push({ code: 'unverified-gateway-key', family: family.family, field, paymentMethod });
      if (!recognized) findings.push({ code: 'incompatible-gateway-metadata', family: family.family, field, paymentMethod });
      if (value.length > limit) findings.push({ code: 'reference-over-length', family: family.family, field, length: value.length, limit });
    }
  }
  return findings;
}

function resolveTransactionReference({ meta = {}, paymentMethod = null, registry = loadRegistry() } = {}) {
  const findings = [];
  const limit = referenceLimit(registry);

  // Step 1: the canonical WooCommerce reference, valid for any method. An over-length canonical
  // value does not short-circuit the search -- it is reported and the family candidates still run.
  for (const field of registry.canonicalReference.referenceFields) {
    const value = populated(meta[field]);
    if (!value) continue;
    if (value.length > limit) {
      findings.push({ code: 'reference-over-length', family: registry.canonicalReference.family, field, length: value.length, limit });
      continue;
    }
    // Report the other populated candidates too. Returning bare here hid every unverified or
    // incompatible gateway key on the order, so a store's verification backlog looked smaller
    // than it is purely because the canonical field happened to be filled in.
    return {
      reference: value,
      source: { family: registry.canonicalReference.family, field },
      findings: [...findings, ...familyCandidateFindings(meta, paymentMethod, registry, limit)],
    };
  }

  // Step 2: gateway-specific candidates. Every disqualifying reason is reported, not just the
  // first one, because "unverified semantics" and "unrecognized method relationship" are separate
  // pieces of work and a run that hides one of them understates what verification would buy.
  const eligible = [];
  for (const family of registry.families) {
    const recognized = recognizesMethod(family, paymentMethod);
    if (family.evidence === 'unmapped' && recognized) {
      findings.push({ code: 'unmapped-gateway-family', family: family.family, paymentMethod });
    }
    for (const field of family.referenceFields) {
      const value = populated(meta[field]);
      if (!value) continue;
      const reasons = [];
      if (family.evidence !== 'verified') reasons.push('unverified-gateway-key');
      if (!recognized) reasons.push('incompatible-gateway-metadata');
      if (value.length > limit) reasons.push('reference-over-length');
      if (reasons.length > 0) {
        for (const code of reasons) {
          findings.push({ code, family: family.family, field, paymentMethod });
        }
        continue;
      }
      eligible.push({ family: family.family, field, value });
    }
  }

  const distinct = [...new Set(eligible.map((candidate) => candidate.value))];
  if (distinct.length === 1) {
    const winner = eligible.find((candidate) => candidate.value === distinct[0]);
    return { reference: winner.value, source: { family: winner.family, field: winner.field }, findings };
  }
  if (distinct.length > 1) {
    findings.push({
      code: 'ambiguous-transaction-reference',
      families: [...new Set(eligible.map((candidate) => candidate.family))],
      distinctValues: distinct.length,
    });
    return { reference: null, source: null, findings };
  }

  findings.push({ code: 'no-transaction-reference', paymentMethod });
  return { reference: null, source: null, findings };
}

// Card brand and last four ride the same recognition rule as the reference. They are display
// details only: nothing here implies Wix holds a chargeable credential.
function resolveCardDisplay({ meta = {}, paymentMethod = null, registry = loadRegistry() } = {}) {
  const findings = [];
  const limits = registry.targetLimits;
  for (const family of registry.families) {
    const fields = family.cardDisplayFields || {};
    const lastFourField = fields.lastFourDigits;
    const brandField = fields.brand;
    if (!lastFourField && !brandField) continue;

    const lastFour = lastFourField ? populated(meta[lastFourField]) : null;
    const brand = brandField ? populated(meta[brandField]) : null;
    if (!lastFour && !brand) continue;

    const recognized = recognizesMethod(family, paymentMethod);
    if (family.evidence !== 'verified' || !recognized) {
      findings.push({ code: 'incompatible-gateway-metadata', family: family.family, fields: [lastFourField, brandField].filter(Boolean), paymentMethod });
      continue;
    }

    const cardDisplay = {};
    if (lastFour) {
      if (lastFour.length <= limits.lastFourDigits) cardDisplay.lastFourDigits = lastFour;
      // Dropped silently, an over-length card field is indistinguishable from an absent one.
      else findings.push({ code: 'card-display-over-length', family: family.family, field: lastFourField, length: lastFour.length, limit: limits.lastFourDigits });
    }
    if (brand) {
      if (brand.length <= limits.cardBrand) cardDisplay.brand = brand;
      else findings.push({ code: 'card-display-over-length', family: family.family, field: brandField, length: brand.length, limit: limits.cardBrand });
    }
    if (Object.keys(cardDisplay).length > 0) return { cardDisplay, family: family.family, findings };
  }
  return { cardDisplay: null, family: null, findings };
}

// Candidate coverage and defensible coverage are separate report lines by decision: a run that
// reports "94.8% of orders carry a reference" when it can only write three quarters of them has
// misdescribed its own fidelity. Callers surface BOTH.
function summarizeReferenceCoverage(orders = [], registry = loadRegistry()) {
  const knownFields = new Set([
    ...registry.canonicalReference.referenceFields,
    ...registry.families.flatMap((family) => family.referenceFields),
  ]);
  const summary = { orders: orders.length, candidates: 0, defensible: 0, findings: {} };
  for (const order of orders) {
    const meta = order.meta || {};
    if ([...knownFields].some((field) => populated(meta[field]))) summary.candidates += 1;
    const resolved = resolveTransactionReference({ meta, paymentMethod: order.paymentMethod, registry });
    if (resolved.reference) summary.defensible += 1;
    for (const finding of resolved.findings) {
      summary.findings[finding.code] = (summary.findings[finding.code] || 0) + 1;
    }
  }
  return summary;
}

// The read manifest for the payments import (A.7: read only what an approved outcome needs).
// Returned sorted and de-duplicated so a generated read plan is stable across runs -- an unstable
// key order changes the plan hash and makes integrity verification report false tampering.
function paymentReadKeys(registry = loadRegistry()) {
  const keys = new Set(registry.paymentReadKeys.core);
  for (const field of registry.canonicalReference.referenceFields) keys.add(field);
  for (const family of registry.families) {
    for (const field of family.referenceFields) keys.add(field);
    for (const field of Object.values(family.cardDisplayFields || {})) keys.add(field);
  }
  return [...keys].sort();
}

module.exports = {
  REGISTRY_PATH,
  loadRegistry,
  paymentReadKeys,
  classifyMethod,
  resolveOfflinePayment,
  resolveTransactionReference,
  resolveCardDisplay,
  summarizeReferenceCoverage,
  recognizesMethod,
};
