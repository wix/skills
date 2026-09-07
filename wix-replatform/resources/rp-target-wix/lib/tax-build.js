'use strict';

const { isBlank } = require('./value-utils.js');

// rp-target-wix — the DETERMINISTIC WooCommerce tax-rate -> Wix Tax payload builder.
//
// Mirrors wix-build.js's role for Stores products: everything here implements, as plain code,
// the mapping rules already recorded as prose in domains/tax/{domain.json,entities/*.json}. Do
// not re-derive these rules by LLM judgement per project — read them here, and if a rule changes,
// change it here and in the domain JSON's mappingGuidance together, since they must stay the same
// fact stated twice (once for humans, once as code).
//
// Scope: Tax Groups / Tax Regions / Manual Tax Mappings only. Tax Settings is a single
// site-level upsert (see domains/tax/entities/tax-settings.json) with no payload-shaping
// logic worth a builder — just a boolean passthrough.

// ISO 3166-1 alpha-2 countries Wix accepts a `subdivision` for (dev.wix.com Tax Region object,
// verified live 2026-08-12 on the reference store). Any other country must omit subdivision (or pass '*').
const SUBDIVISION_ELIGIBLE_COUNTRIES = new Set([
  'AU', 'BR', 'CA', 'FR', 'DE', 'IN', 'IT', 'MX', 'NL', 'PT', 'ES', 'AE', 'GB', 'US',
]);

// Countries Tax Region create rejects outright (dev.wix.com, "embargoed-countries-rejected").
const EMBARGOED_COUNTRIES = new Set(['CU', 'IR', 'KP', 'SY']);

// WooCommerce's `state` column format varies by version/site — sometimes bare ("NY"), sometimes
// country-prefixed ("US-NY"). Wix stores ISO 3166-2 WITHOUT the country prefix. Never invent a
// subdivision for a country outside the eligible set — pass none (country-level region) instead.
function normalizeSubdivision(country, rawState) {
  const countryCode = String(country || '').trim().toUpperCase();
  if (isBlank(rawState)) return undefined;
  if (!SUBDIVISION_ELIGIBLE_COUNTRIES.has(countryCode)) return undefined;
  const raw = String(rawState).trim().toUpperCase();
  const prefix = `${countryCode}-`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

// WooCommerce `rate` is a PERCENTAGE (e.g. "7.5000"). Wix `taxRate` is a decimal-string FRACTION
// with at most 6 decimal places (e.g. "0.075"). A number, integer, or percent-string all 400.
function toWixTaxRateFraction(percentage) {
  const n = Number(percentage);
  if (!Number.isFinite(n)) {
    throw new Error(`toWixTaxRateFraction: "${percentage}" is not a finite number`);
  }
  let fixed = (n / 100).toFixed(6);
  if (fixed.includes('.')) {
    fixed = fixed.replace(/0+$/, '');
    if (fixed.endsWith('.')) fixed += '0';
  }
  return fixed;
}

// One Wix Tax Region per distinct (country, subdivision) pair — a source can have several rate
// rows (standard/reduced/zero) sharing one region, which fan out to separate Manual Tax Mappings
// against that ONE region rather than one region each.
function groupTaxRatesByRegion(taxRates) {
  const regions = new Map();
  for (const rate of taxRates || []) {
    const country = String(rate.country || '').trim().toUpperCase();
    if (!country) continue;
    const subdivision = normalizeSubdivision(country, rate.state);
    const key = taxRegionDedupeKey({ country, subdivision });
    if (!regions.has(key)) {
      regions.set(key, { country, subdivision, rates: [] });
    }
    regions.get(key).rates.push(rate);
  }
  return [...regions.values()];
}

function taxRegionDedupeKey({ country, subdivision }) {
  return `${String(country || '').trim().toUpperCase()}|${subdivision || ''}`;
}

function isEmbargoedCountry(country) {
  return EMBARGOED_COUNTRIES.has(String(country || '').trim().toUpperCase());
}

// `appId` must be resolved live per site via listTaxCalculators/resolveManualTaxCalculatorAppId
// in wix-writers.js — never hardcoded here, since it's installation-scoped and differs per site.
function buildTaxRegionInput({ country, subdivision }, { appId, taxIncludedInPrice = false }) {
  if (!appId) throw new Error('buildTaxRegionInput: appId is required (resolve live, never hardcode)');
  const taxRegion = { country: String(country).trim().toUpperCase(), appId, taxIncludedInPrice };
  if (subdivision) taxRegion.subdivision = subdivision;
  return taxRegion;
}

function buildTaxGroupInput({ name }) {
  if (isBlank(name)) throw new Error('buildTaxGroupInput: name is required');
  return { name: String(name).trim() };
}

// `taxGroupId`/`taxRegionId` must already exist — resolve both from their own crosswalks before
// calling. `taxName` is cosmetic (shown at checkout) and never affects the calculated amount.
function buildManualTaxMappingInput(rate, { taxGroupId, taxRegionId }) {
  if (!taxGroupId) throw new Error('buildManualTaxMappingInput: taxGroupId is required');
  if (!taxRegionId) throw new Error('buildManualTaxMappingInput: taxRegionId is required');
  const mapping = {
    taxGroupId,
    taxRegionId,
    taxRate: toWixTaxRateFraction(rate.rate),
  };
  if (!isBlank(rate.name)) mapping.taxName = String(rate.name).trim();
  return mapping;
}

// Create Manual Tax Mapping 409s on a duplicate (taxRegionId, taxGroupId, taxName, taxType,
// jurisdiction, jurisdictionType) — dedupe on that composite key before creating, since
// WooCommerce rows differing only in `priority` (no Wix equivalent) would otherwise re-collide.
//
// LIVE-VERIFIED 2026-08-15: Query Manual Tax Mapping returns the STRING "UNDEFINED" for an unset
// `jurisdictionType` (not "" and not the field's absence), while a freshly-built mappingInput that
// never sets the field is plain JS `undefined` — so comparing a fetched mapping against a
// newly-built one for the same (region, group) 409'd instead of correctly deduping. Normalize both
// "" and "UNDEFINED" to the same bucket so a fetched existing mapping and a freshly-built one that
// both mean "no jurisdictionType" produce the same key.
function normalizeDedupeField(value) {
  const s = String(value || '').trim();
  return s === 'UNDEFINED' ? '' : s;
}
function manualTaxMappingDedupeKey({ taxRegionId, taxGroupId, taxName, taxType, jurisdiction, jurisdictionType }) {
  return [
    taxRegionId,
    taxGroupId,
    normalizeDedupeField(taxName),
    normalizeDedupeField(taxType),
    normalizeDedupeField(jurisdiction),
    normalizeDedupeField(jurisdictionType),
  ].join('|');
}

// The four Wix "default" tax groups every site has (VERIFIED live 2026-08-12 on the reference store via
// List Default Tax Groups: "Shipping and delivery", "Products", "Services", "Cancellation
// fees" — see tax-group.json's query-tax-groups-excludes-defaults pitfall). WooCommerce has no
// equivalent split: a `class: "standard"` rate (or a blank class) is the store's ONE general
// rate, not a products-only rate — WooCommerce's own `shipping` boolean on a tax rate row
// exists specifically because the rate is meant to reach beyond products. Wix's
// Products/Shipping and delivery/Services/Cancellation fees groups are BILLING categories, not
// TAX-RATE categories, so mapping a standard rate to "Products" only silently zero-rates every
// other category in that region — a group with no manual tax mapping calculates to EXACTLY
// ZERO tax (VERIFIED live 2026-08-12, see manual-tax-mapping.json's
// unmapped-tax-group-calculates-to-exactly-zero-tax finding). That is undercharging, not a
// faithful migration, so a standard-class rate must get one mapping per default group.
const DEFAULT_GROUP_NAMES = ['Products', 'Shipping and delivery', 'Services', 'Cancellation fees'];

// Which already-created Wix tax groups a WooCommerce rate's Manual Tax Mapping(s) should
// target. `defaultGroups` is List Default Tax Groups' result; `customGroups` is this project's
// own created-group tracking, each carrying the `sourceTaxClass` it was created for (from
// planCustomTaxGroups's plan — a plain Query Tax Groups result has no such field, since Wix
// itself doesn't know why a custom group exists).
//
// A `standard` (or blank) class rate targets every DEFAULT group — never a class-specific
// custom group (a reduced-rate/zero-rate group exists so a product TAGGED with that class gets
// a different rate than the store's general one, not the same rate broadened everywhere), and
// never the Tax Exempt group (no mapping is how exempt is represented at all — this falls out
// naturally here since Tax Exempt's `sourceTaxClass` is null and no rate's class is ever null).
// A non-standard class rate targets ONLY its own matching custom group.
//
// List Default Tax Groups' own schema (dev.wix.com, checked 2026-08-15) has no locale-invariant
// key for "which billing category is this" — a TaxGroup is only {id, name, revision, dates}, and
// the docs' own worked example returns a completely different default set ("Standard Tax") than
// the reference store's real one, confirming `name` genuinely varies per site/locale and isn't a fixed
// constant. `name` is matched here anyway because it's the ONLY field the API offers for this —
// but matching zero (or some but not all four) of DEFAULT_GROUP_NAMES on a translated or
// differently-configured site must never fall through to a silent partial fan-out: that would
// reproduce the exact silent-undercharging bug this function exists to fix, just triggered by
// site language/config instead of an incomplete implementation. Fail loudly instead, so a human
// resolves the real name mismatch before any mapping is created.
function groupsForRate(rate, { defaultGroups = [], customGroups = [] } = {}) {
  const taxClass = String(rate?.class || 'standard').trim() || 'standard';
  if (taxClass === 'standard') {
    const matched = defaultGroups.filter((group) => DEFAULT_GROUP_NAMES.includes(String(group?.name || '').trim()));
    if (matched.length !== DEFAULT_GROUP_NAMES.length) {
      const foundNames = matched.map((group) => group.name);
      const missing = DEFAULT_GROUP_NAMES.filter((name) => !foundNames.includes(name));
      throw new Error(
        `groupsForRate: expected all ${DEFAULT_GROUP_NAMES.length} default tax groups (${DEFAULT_GROUP_NAMES.join(', ')}), `
        + `found only ${matched.length} (missing: ${missing.join(', ')}). This site's default tax group names may be `
        + 'translated or otherwise non-standard -- resolve the real names via List Default Tax Groups before mapping, '
        + 'do not silently map to a partial set.',
      );
    }
    return matched;
  }
  return customGroups.filter((group) => group?.sourceTaxClass === taxClass);
}

// Only create a custom tax group when a real per-product signal exists — never speculatively,
// just because wc/v3/taxes/classes lists WooCommerce's unused defaults (reduced-rate/zero-rate).
// `products` here is the discovered wc/v3/products record shape (`tax_class`, `tax_status`).
function planCustomTaxGroups(products) {
  const plans = [];
  const classesInUse = new Set();
  let hasExempt = false;
  for (const product of products || []) {
    const taxClass = String(product.tax_class || 'standard').trim() || 'standard';
    if (taxClass !== 'standard') classesInUse.add(taxClass);
    if (String(product.tax_status || 'taxable').trim() === 'none') hasExempt = true;
  }
  for (const taxClass of classesInUse) {
    plans.push({ name: taxClass, sourceTaxClass: taxClass, reason: 'non-default WooCommerce tax_class actually assigned to at least one product' });
  }
  if (hasExempt) {
    plans.push({ name: 'Tax Exempt', sourceTaxClass: null, exempt: true, reason: 'at least one product has tax_status=none — dedicated group, deliberately no manual tax mapping in any region' });
  }
  return plans;
}

// "No source has any tax-rate rows" is the majority case (the reference store, 2026-08-12: 0 rows) — the
// correct action is to create nothing speculative, not to pre-create empty regions/mappings.
function shouldSkipTaxDomain(taxRates) {
  return !Array.isArray(taxRates) || taxRates.length === 0;
}

module.exports = {
  SUBDIVISION_ELIGIBLE_COUNTRIES,
  EMBARGOED_COUNTRIES,
  normalizeSubdivision,
  toWixTaxRateFraction,
  groupTaxRatesByRegion,
  taxRegionDedupeKey,
  isEmbargoedCountry,
  buildTaxRegionInput,
  buildTaxGroupInput,
  buildManualTaxMappingInput,
  manualTaxMappingDedupeKey,
  DEFAULT_GROUP_NAMES,
  groupsForRate,
  planCustomTaxGroups,
  shouldSkipTaxDomain,
};
