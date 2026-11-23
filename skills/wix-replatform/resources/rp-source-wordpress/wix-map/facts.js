'use strict';
// Source-pack facts for the condition grammar `{op:'fact', name, values}`
// (lib/output-applicability.js). A fact is a pure function of one source record that a
// condition cannot express with the plain leaf ops. The same function is imported by the
// builder, so a row's condition and the value the builder writes cannot disagree:
//   const { FACTS } = require('./facts.js');  FACTS['woo.onSale'].evaluate(record)
//
// Adding a fact is one entry in FACTS:
//   'woo.name': {
//     reads: ['sale_price', ...],   // canonical source locations (lib/source-location.js) it reads;
//                                   // locations() returns these, a decision must list them
//     values: [true, false],        // every scalar evaluate may return; validate refuses others
//     evaluate: (record, ctx) => true,  // pure, no I/O, never throws on a missing field; ctx.choices is the
//                                       // plan's choices by name, read with the same helper as the builder
//   }
// Entries are checked when this file loads.
const L = require('../../../lib/source-location');

const FACTS = {
  // The selection route of a variable product, from the same function the builder calls
  // (product.builder.js selectionRouteOf), under the plan's choice `product-options-over-limit`
  // (hold by default; `import` keeps the shipped route). 'held' means the product is not created
  // (over 6 options and the choice is hold, a contradicting variation, no variations); 'none' is a
  // product that is not variable.
  'woo.selectionRoute': {
    reads: ['type', '_variations[].id', '_variations[].menu_order', '_variations[].regular_price', '_variations[].sale_price',
      '_variations[].on_sale', '_variations[].sku', '_variations[].weight', '_variations[].manage_stock', '_variations[].stock_quantity',
      '_variations[].stock_status', '_variations[].attributes[].id', '_variations[].attributes[].name', '_variations[].attributes[].option',
      'attributes[].id', 'attributes[].name', 'attributes[].options[]', 'attributes[].variation'],
    values: ['none', 'variants', 'modifiers', 'hybrid', 'held'],
    // Lazy require: product.builder.js loads this file, so a top-level require would be circular.
    evaluate: (record, ctx) => {
      try { const b = require('./product.builder.js'); return b.selectionRouteOf(record, { overLimit: b.overLimitChoice(ctx?.choices) }).route; } catch { return 'held'; }
    },
  },
  // Whether the written simple product or bundle carries a compare-at price: the builder's own
  // pricing (product.builder.js simplePricing) keeps a sale only when it is above 0 and below the
  // price; a bundle's compare-at follows the plan's choice `woosb-compare-at`.
  'woo.onSale': {
    reads: ['type', 'regular_price', 'sale_price', 'on_sale', 'price'],
    values: [true, false],
    evaluate: (record, ctx) => {
      try { const b = require('./product.builder.js'); return !b.isVariable(record) && b.hasCompareAt(b.simplePricing(record, { choices: ctx?.choices })); } catch { return false; }
    },
  },
  // The same over the variations of a variable product: true when any variation is written with a
  // compare-at price (a variation with no regular price is never on sale).
  'woo.variationOnSale': {
    reads: ['type', '_variations[].regular_price', '_variations[].sale_price', '_variations[].on_sale'],
    values: [true, false],
    evaluate: record => {
      try { const b = require('./product.builder.js'); return b.isVariable(record) && (record._variations || []).some(v => !b.isBlank(v.regular_price) && b.hasCompareAt(b.price(v))); } catch { return false; }
    },
  },
};

// --- order line options -----------------------------------------------------------------------
// One function decides which line meta becomes a description line; the order builder calls it
// and the facts below count its result, so a condition and the written lines cannot disagree.
// Visible rule: key without a leading "_", and a plain text, number or true/false value
// (objects and arrays stay in the source archive). `extraKeys` (choice order-line-extra-display-keys)
// also shows listed keys that the visible rule would hide.
const { decodeHtmlEntities } = require('../../../lib/link-census.js');
const clean = v => { if (v === undefined || v === null) return null; const t = decodeHtmlEntities(String(v)).trim(); return t.length ? t : null; };
const plain = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? String(v) : null);
// The plan's choice `order-line-extra-display-keys` (a list of hidden keys to show too); the order
// builder and the fact below both read it here.
const extraDisplayKeys = choices => (Array.isArray(choices?.['order-line-extra-display-keys']) ? choices['order-line-extra-display-keys'] : []);
// The plan's choice `order-line-options`: lines are written only when it is 'description-lines'.
// Unset means order.json's default, as the order builder resolves it.
const LINE_OPTIONS_DEFAULT = require('./order.json').choices.find(c => c.name === 'order-line-options').default;
const showsDescriptionLines = choices => (choices?.['order-line-options'] ?? LINE_OPTIONS_DEFAULT) === 'description-lines';
function lineOptions(line, extraKeys = []) {
  const extra = new Set(Array.isArray(extraKeys) ? extraKeys.filter(k => typeof k === 'string') : []);
  return (Array.isArray(line?.meta_data) ? line.meta_data : [])
    .filter(m => m && typeof m.key === 'string' && (!m.key.startsWith('_') || extra.has(m.key)) && plain(m.display_value ?? m.value) !== null)
    .map(m => ({ name: clean(m.display_key ?? m.key), value: clean(plain(m.display_value ?? m.value)) }))
    .filter(m => m.name && m.value);
}
const lines = record => (Array.isArray(record?.line_items) ? record.line_items.filter(l => l && typeof l === 'object') : []);
const linked = line => Number(line.product_id) > 0;

FACTS['woo.lineHasVisibleOption'] = {
  reads: ['line_items[].meta_data[].key', 'line_items[].meta_data[].display_key', 'line_items[].meta_data[].display_value', 'line_items[].meta_data[].value'],
  values: [true, false],
  evaluate: (record, ctx) => showsDescriptionLines(ctx?.choices) && lines(record).some(l => lineOptions(l, extraDisplayKeys(ctx?.choices)).length > 0),
};
// A line with no catalog product (deleted at source, product_id 0) is imported unlinked: it has
// no product id, app id or variant. These facts hold when some line is linked / has a variation.
FACTS['woo.lineHasCatalogProduct'] = {
  reads: ['line_items[].product_id'],
  values: [true, false],
  evaluate: record => lines(record).some(linked),
};
FACTS['woo.lineHasVariation'] = {
  reads: ['line_items[].product_id', 'line_items[].variation_id'],
  values: [true, false],
  evaluate: record => lines(record).some(l => linked(l) && Number(l.variation_id) > 0),
};

// Whether the contact builder writes a subdivision on some address. It calls the builder's own
// contactAddresses, so a state that cannot become ISO 3166-2 (no country, or not a short code)
// is left out by both: the builder records its finding, and the condition does not expect it.
FACTS['woo.contactSubdivisionWritten'] = {
  reads: ['billing.address_1', 'billing.address_2', 'billing.city', 'billing.postcode', 'billing.country', 'billing.state',
    'shipping.address_1', 'shipping.address_2', 'shipping.city', 'shipping.postcode', 'shipping.country', 'shipping.state'],
  values: [true, false],
  // Lazy require, as above: the contact builder loads its suggestion file.
  evaluate: (record, ctx) => {
    try { return (require('./contact.build.js').contactAddresses(record, { choices: ctx?.choices }).record?.addresses || []).some(a => a.address?.subdivision); } catch { return false; }
  },
};

for (const [name, f] of Object.entries(FACTS)) {
  const ok = Array.isArray(f.reads) && f.reads.every(r => L.isCanonical(r))
    && Array.isArray(f.values) && f.values.length && typeof f.evaluate === 'function';
  if (!ok) throw new Error(`facts.js: fact ${name} needs reads[] of canonical locations, values[] and evaluate(record)`);
}
module.exports = { FACTS, lineOptions, extraDisplayKeys, showsDescriptionLines };
