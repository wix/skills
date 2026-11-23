'use strict';

// WooCommerce tax classes and tax rates -> Wix tax groups and manual tax mappings, one export per
// fieldMappings row of tax-class.json and tax-rate.json. Each is `(record, { lookups, choices, args })`
// and returns `{ values }` or `{ hold: { code } }` (lib/plan-builder.js). Rules: rp-target-wix/lib/tax-build.js.
// Lookups: lookups.ref('tax/tax-group', 'tax-class:<slug>') (custom classes). Tax
// regions and default groups are resolved by the tax composite at send time.

const tax = require('../../rp-target-wix/lib/tax-build.js');

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

// tax-class-name: a custom class becomes a Wix tax group. "standard" is Wix's default groups,
// which already exist, so nothing is created for it.
function taxGroupName(record) {
  if (String(record.slug || '').trim() === 'standard') return { hold: { code: 'tax-class-standard-uses-default-groups' } };
  if (blank(record.name)) return { hold: { code: 'tax-class-name-missing' } };
  return { values: { name: tax.buildTaxGroupInput({ name: record.name }).name } };
}

// tax-rate-mapping: the rate's manual tax mapping(s). Wix regions are country or
// subdivision only, and Wix has no compound rates: those rows hold (one cutover task).
// The body carries taxRate, taxName and, for a custom class, its own tax group. The region and,
// for a standard (or blank) class rate, the site's default groups are per-site ids the tax
// composite (lib/import-composites-tax.js) finds or creates at send time, from loopInput:
//   { region: { country, subdivision? }, defaultGroups: true, shipping } for a standard rate
//     (Products, Additional fees, and Shipping and delivery only when the rate says shipping yes), or
//   { region } for a custom class rate.
function taxRateMapping(record, { lookups } = {}) {
  if ((record.postcodes || []).length || (record.cities || []).length || !blank(record.postcode) || !blank(record.city)) return { hold: { code: 'tax-rate-postcode-or-city' } };
  if (record.compound === true) return { hold: { code: 'tax-rate-compound' } };
  if (blank(record.country)) return { hold: { code: 'tax-rate-country-missing' } };
  if (tax.isEmbargoedCountry(record.country)) return { hold: { code: 'tax-rate-country-not-supported' } };
  let rate;
  try { rate = tax.toWixTaxRateFraction(record.rate); } catch { return { hold: { code: 'tax-rate-invalid' } }; }
  const country = String(record.country).trim().toUpperCase();
  const subdivision = tax.normalizeSubdivision(country, record.state);
  const region = { country, ...(subdivision ? { subdivision } : {}) };
  const values = { taxRate: rate, ...(blank(record.name) ? {} : { taxName: String(record.name).trim() }) };
  const taxClass = String(record.class || '').trim() || 'standard';
  if (taxClass === 'standard') return { values, loopInput: { region, defaultGroups: true, shipping: record.shipping !== false } };
  const resolve = typeof lookups?.ref === 'function' ? lookups.ref : () => undefined;
  const id = resolve('tax/tax-group', `tax-class:${taxClass}`, 'taxGroupId');
  if (!id) return { hold: { code: 'tax-group-not-ready' } };
  return { values: { ...values, taxGroupId: id }, loopInput: { region } };
}

const ROW_EXPORTS = { 'tax-class-name': 'taxGroupName', 'tax-rate-mapping': 'taxRateMapping' };
module.exports = { taxGroupName, taxRateMapping, ROW_EXPORTS };
