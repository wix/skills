'use strict';

// Sample builder for the WooCommerce product -> Wix Stores product suggestions in product.json.
//
// One export per fieldMappings row of product.json (ROW_EXPORTS). Each row names its export as a
// helper ("rp-source-wordpress/wix-map/product.builder.js#<export>"), and lib/plan-builder.js runs
// it from the plan: the parts it returns merge into one wix-build buildProduct call. An operator
// change is a plan row change (an affix over a row, a dropped row), never a change here. No client,
// network or file I/O.
//
// Input record: one WooCommerce wc/v3 product, with its wc/v3 variations joined on `_variations`.
// References the fixed loop owns arrive through `lookups`:
//   lookups.ref('stores/brand', 'product-brand:<id>', 'brand.id') -> Wix brand id, or undefined when
//     the brand cannot be linked (the shared loop lookup, import-task-runner lookupsFor). The
//     read-back build answers through import-task-runner readBackLookups: a brand still to be
//     imported resolves to a stand-in, so only a product whose brand is not in the source is held.
// Builders call only lookups the loop provides (tests/source-wordpress/wix-map-lookups-runtime-test.js).
// Each routed modifier carries a pending id (PENDING_CUSTOMIZATION + position); the product composite
// (lib/import-task-runner.js) writes its customization just before the product and puts the written
// one in its place.
// Tag ids, media ids and category membership are never emitted here: the dependency gate writes
// tag ids, and categories are attached after create (stores-category-attach.js).
//
// `build(record, lookups)` runs every row unchanged (reference and test material). It returns
// { product, findings, selectionRoute, operatorActions } or { status: 'held', holds: [{ decisionId, code }] }.

const { buildProduct, isPlaceholderDescription, composeProductDescription } = require('../../rp-target-wix/lib/wix-build.js');
const { routeSelections, routeRecord, foldSelectionOptionsNote } = require('../../rp-target-wix/lib/selection-route.js');
const { planProductSeo } = require('../../rp-target-wix/lib/product-seo.js');
const { wooSelectionAttributes } = require('../lib/woo-selection-attributes.js');
const yoast = require('../lib/yoast-product-seo-evidence.js');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'" };
function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => (Object.hasOwn(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : m));
}
const blank = (v) => v === undefined || v === null || v === '';
const text = (v) => (blank(v) ? undefined : decodeEntities(v).trim() || undefined);
const held = (decisionId, code) => ({ status: 'held', holds: [{ decisionId, code }] });

// Wix inventory quantity range (stores-inventory.js stockPayload).
const MAX_QUANTITY = 99999;
// Wix plainDescription cap (wix-target-spec STORES_V3_TARGET).
const MAX_DESCRIPTION = 16000;
// Cutover tasks list at most this many ids; affectedCount is always the full count.
const MAX_AFFECTED_IDS = 50;

// product-type (product.json recordFilters): which WooCommerce product types are written, and how.
const SUGGESTION = require('./product.json');
const TYPE_ROUTE = SUGGESTION.recordFilters.find((f) => f.id === 'product-type').cases;
// Each row's suggested arguments (for example the description order), as the plan carries them.
const ROW_ARGS = Object.fromEntries(SUGGESTION.fieldMappings.map((row) => [row.id, (row.transform && row.transform.arguments) || {}]));

// product-slug: percent-decoded (non-Latin slugs arrive encoded); empty -> product-<id>.
function decodeSlug(slug) {
  if (blank(slug)) return undefined;
  try { return decodeURIComponent(String(slug)); } catch { return String(slug); }
}

// Tracked: quantity, null -> 0, negative -> 0, over 99999 -> 99999. Untracked: inStock from
// stock_status (onbackorder counts as in stock). A variation with manage_stock "parent" shares the
// parent's pool, which is never copied onto several variants: it imports as stock status only.
function stock(src) {
  if (src.manage_stock === true) {
    const q = blank(src.stock_quantity) ? 0 : Number(src.stock_quantity);
    const quantity = Number.isInteger(q) ? Math.min(Math.max(q, 0), MAX_QUANTITY) : 0;
    return { inventoryTracked: true, inventoryQuantity: quantity };
  }
  return { inventoryTracked: false, inStock: src.stock_status !== 'outofstock' };
}

// The sale price applies only while the source says the product is on sale, and never when it is
// empty or "0"; wix-build drops a sale that is not below the regular price.
function price(src) {
  const onSale = src.on_sale !== false && !blank(src.sale_price) && Number(src.sale_price) > 0;
  return { price: src.regular_price, ...(onSale ? { discountedPrice: src.sale_price } : {}) };
}

// Wix keeps a sale only when the discounted price is above 0 and below the price (wix-build
// buildVariantPrice); the same test says whether a written price carries a compare-at price.
const isPositive = (v) => !blank(v) && Number(v) > 0;
const hasCompareAt = (p) => Boolean(p) && isPositive(p.discountedPrice) && Number(p.discountedPrice) < Number(p.price);

function variantFrom(src, choices) {
  return {
    sourceId: src.id,
    choices,
    ...price(src),
    ...(blank(src.sku) ? {} : { sku: String(src.sku) }),
    ...(blank(src.weight) ? {} : { weight: Number(src.weight) }),
    ...stock(src),
  };
}

const isVariable = (record) => record.type === 'variable';

// The plan's choice `woosb-compare-at` (product-price-simple part): 'none' (default) or 'regular'
// (the bundle's regular price is its compare-at price). Read here by the builder and the fact woo.onSale.
const woosbCompareAtChoice = (choices) => {
  const part = choices && choices['product-price-simple'];
  return part && part['woosb-compare-at'] === 'regular price as compare-at' ? 'regular' : 'none';
};

// What a simple product or bundle is written at, from the record and the plan's choices:
// { price, discountedPrice? }, { noPrice: true } (written hidden at 0), or undefined (type not written).
// A bundle (woosb) is sold at its own `price`; at 0 or below that is not a selling price, so it falls
// back to its sale price, then its regular price, each only when above 0 (product decision). A sale price at
// 0 or below is never a sale. Bundle compare-at: none by default; `regular` makes the regular price
// the compare-at price when it is above the selling price (D3).
function simplePricing(record, { choices } = {}) {
  const route = TYPE_ROUTE[record.type];
  if (route === 'write-at-price') {
    const selling = [record.price, record.sale_price, record.regular_price].find(isPositive);
    if (selling === undefined) return { noPrice: true };
    if (woosbCompareAtChoice(choices) === 'regular' && isPositive(record.regular_price) && Number(record.regular_price) > Number(selling)) return { price: record.regular_price, discountedPrice: selling };
    return { price: selling };
  }
  if (route !== 'write') return undefined;
  if (blank(record.regular_price)) return { noPrice: true };
  return price(record);
}

// The product composite's marker for a modifier whose customization it writes (import-task-runner
// PENDING_CUSTOMIZATION).
const PENDING_CUSTOMIZATION = 'pending-customization:';
function pendingConnectedModifiers(modifiers) {
  return modifiers.map((m, i) => ({
    id: `${PENDING_CUSTOMIZATION}${i}`,
    name: m.customizationName,
    modifierRenderType: 'TEXT_CHOICES',
    mandatory: m.mandatory,
    choicesSettings: { choices: m.choices.map((name) => ({ choiceType: 'CHOICE_TEXT', name })) },
  }));
}

// A product (or variation) with no price in the source: written hidden at price 0, so nothing is
// lost and nobody can buy it before the merchant sets a price (cutover task product-price-missing).
// The finding carries its cutover task, so the loop records it on the landed product
// (import-task-runner: a finding with an action becomes a task gap -> completion report).
const NO_PRICE = '0';
const NO_PRICE_TASK = SUGGESTION.findingCodes['product-price-missing'];
const noPriceFinding = { code: 'product-price-missing', action: NO_PRICE_TASK.action, operatorRole: 'Cutover Operator', severity: NO_PRICE_TASK.severity };
const hold = (code) => ({ hold: { code } });

// --- one export per plan row ------------------------------------------------------------------
// Each is `(record, { lookups, choices, args })` and returns what lib/plan-builder.js merges:
// `canonical` (into the wix-build canonical record; arrays of objects merge by index),
// `composeOptions` (to buildProduct), `record` (onto the body after buildProduct), `loopInput`,
// `canonicalField` (an operator affix applies to it before Wix's caps) or `hold: {code}`.
// An operator change replaces or drops the row in the plan; these functions never change.

// product-name
function productName(record) {
  const name = text(record.name);
  return name ? { canonical: { name }, canonicalField: 'name' } : hold('product-name-missing');
}

// product-description: the bodies named in args.order (default short, then long), joined by
// <hr /> (wix-build composeProductDescription); placeholder bodies are dropped there.
function productDescription(record, { args } = {}) {
  const order = (args && Array.isArray(args.order)) ? args.order : ['short_description', 'description'];
  const long = order.includes('description') && !blank(record.description) ? record.description : undefined;
  const short = order.includes('short_description') && !blank(record.short_description) ? record.short_description : undefined;
  const composed = composeProductDescription({ description: long, shortDescription: short });
  if (composed && composed.length > MAX_DESCRIPTION) return hold('product-description-too-long');
  return { canonical: { ...(long ? { description: long } : {}), ...(short ? { shortDescription: short } : {}) } };
}

// product-slug
function productSlug(record) {
  return { canonical: { slug: decodeSlug(record.slug) || `product-${record.id}` }, canonicalField: 'slug' };
}

// product-visible
function productVisible(record) {
  return { canonical: { visible: record.status === 'publish' && record.catalog_visibility !== 'hidden' } };
}

// product-media: full-size src, source order (the first is the main image).
// loopInput.pictureSourceIds names each gallery item's source media id (one per item, in order), so
// the loop's picture guard confirms each picture against the source media record before the create.
function productMedia(record) {
  const kept = (record.images || []).filter((i) => i && !blank(i.src));
  if (!kept.length) return undefined;
  const images = kept.map((i) => ({ url: i.src, altText: text(i.alt), displayName: text(i.name) }));
  return { canonical: { images }, loopInput: { pictureSourceIds: kept.map((i) => (blank(i.id) ? null : i.id)) } };
}

// product-price-simple: also the product-type record filter (product.json recordFilters), since
// its precedence is by type. woosb: the bundle's own selling `price`, never the sum of its parts.
function productPriceSimple(record, { choices } = {}) {
  const route = TYPE_ROUTE[record.type];
  if (!route) return hold('product-type-unknown');
  if (route.startsWith('hold:')) return hold(route.slice(5));
  if (isVariable(record)) return undefined;
  const priced = simplePricing(record, { choices });
  if (priced.noPrice) {
    return { canonical: { visible: false, optionNames: [], variants: [{ sourceId: record.id, choices: [], price: NO_PRICE }] }, findings: [noPriceFinding] };
  }
  return { canonical: { optionNames: [], variants: [{ sourceId: record.id, choices: [], ...priced }] } };
}

// product-sku-simple
function productSkuSimple(record) {
  if (isVariable(record) || blank(record.sku)) return undefined;
  return { canonical: { variants: [{ sku: String(record.sku) }] } };
}

// product-weight-simple
function productWeightSimple(record) {
  if (isVariable(record) || blank(record.weight)) return undefined;
  const weight = Number(record.weight);
  return Number.isFinite(weight) ? { canonical: { variants: [{ weight }] } } : hold('product-weight-invalid');
}

// product-stock-simple
function productStockSimple(record) {
  if (isVariable(record)) return undefined;
  return { canonical: { variants: [stock(record)] } };
}

// product-variants: options, modifiers ("Any" attributes) and per-variant price, SKU, weight and
// stock, through the shipped selection route. Connected modifiers come from the loop.
// The one selection-route call for a variable product, shared with the `woo.selectionRoute` fact
// (facts.js), so a plan row's condition and the written product cannot disagree.
// Returns { route: 'none'|'variants'|'modifiers'|'hybrid'|'held', holdCode?, routed?, unpriced? }.
// `overLimit` is the choice `product-options-over-limit`: 'hold' (default) or 'import'.
function selectionRouteOf(record, { overLimit = 'hold' } = {}) {
  if (!record || !isVariable(record)) return { route: 'none' };
  const variations = record._variations || [];
  if (!variations.length) return { route: 'held', holdCode: 'product-variations-missing' };
  const unpriced = variations.some((v) => blank(v.regular_price));
  const { selectionAttributes, records } = wooSelectionAttributes(record, variations);
  const byId = new Map(variations.map((v) => [v.id, v]));
  const canonical = {
    name: text(record.name) || String(record.id),
    sourceId: record.id,
    selectionAttributes,
    sourceDeclaredOptionNames: selectionAttributes.map((a) => a.name),
    variants: records.map((r) => {
      const v = byId.get(r.variationId);
      const priced = blank(v.regular_price) ? { ...v, regular_price: NO_PRICE, sale_price: '' } : v;
      return variantFrom(priced.manage_stock === 'parent' ? { ...priced, manage_stock: false } : priced, r.choices);
    }),
  };
  let routed;
  try {
    routed = routeSelections(canonical, { onOptionOverLimit: overLimit === 'import' ? 'import' : 'hold' });
  } catch (error) {
    if (error.code === 'SELECTION_ROUTE_CONTRADICTION') return { route: 'held', holdCode: 'selection-route-contradiction' };
    throw error;
  }
  if (routed.route === 'held') return { route: 'held', holdCode: routed.held };
  return { route: routed.route, routed, unpriced };
}

// The plan's choice for the over-limit case (product-variants part `product-options-over-limit`);
// the fact woo.selectionRoute reads it through this same function.
const overLimitChoice = (choices) => {
  const part = choices && choices['product-variants'];
  return part && part['product-options-over-limit'] === 'import' ? 'import' : 'hold';
};

// product-variants: options, modifiers ("Any" attributes) and per-variant price, SKU, weight and
// stock, through the shipped selection route. Connected modifiers come from the loop.
function productVariants(record, { lookups = {}, choices = {} } = {}) {
  if (!isVariable(record)) return undefined;
  const outcome = selectionRouteOf(record, { overLimit: overLimitChoice(choices) });
  if (outcome.route === 'held') return hold(outcome.holdCode);
  const { routed, unpriced } = outcome;
  const { name, sourceId, ...part } = routed.product;
  let connectedModifiers;
  if ((part.modifiers || []).length) {
    connectedModifiers = pendingConnectedModifiers(part.modifiers);
  }
  return {
    canonical: unpriced ? { ...part, visible: false } : part,
    ...(unpriced ? { findings: [noPriceFinding] } : {}),
    ...(connectedModifiers ? { composeOptions: { connectedModifiers } } : {}),
    loopInput: { selectionRoute: routed.route !== 'none' ? routeRecord(routed) : null, operatorActions: routed.operatorActions || [] },
  };
}

// product-brand: the crosswalked brand id from the loop's shared lookup (the stores/brand task's
// key prefix, product-brand:); the first brand only. A brand the lookup cannot link holds the
// product: it is never written without its brand by default (decision R3(b), 11-03).
function productBrand(record, { lookups = {} } = {}) {
  const brand = (record.brands || [])[0];
  if (!brand || blank(brand.id)) return undefined;
  const id = typeof lookups.ref === 'function' ? lookups.ref('stores/brand', `product-brand:${brand.id}`, 'brand.id') : null;
  return id ? { record: { brand: { id } } } : hold('product-brand-reference-missing');
}

// product-seo: only per-field Yoast overrides the source proves. The wc/v3 meta_data array is the
// read; a key absent from a present meta_data array means "no override" (inherit).
function productSeo(record) {
  if (!Array.isArray(record.meta_data)) return undefined;
  const meta = {};
  for (const key of yoast.ALLOWED_KEYS) meta[key] = '';
  for (const m of record.meta_data) if (m && yoast.ALLOWED_KEYS.includes(m.key)) meta[m.key] = m.value;
  const receipt = yoast.buildProductSeoReceipt({
    productId: record.id,
    capturedAt: 'source-extract',
    rest: yoast.restEvidence({ response: { meta }, path: 'meta_data' }),
    yoastHeadJson: record.yoast_head_json || null,
  });
  const seoEvidence = yoast.seoEvidenceFromReceipt(receipt, { yoastHeadJson: record.yoast_head_json || null, permalink: record.permalink || null });
  return { canonical: { seoEvidence }, composeOptions: { seoPlan: planProductSeo({ productId: record.id, seoEvidence }) } };
}

// Plan row id -> export. product-tags / product-categories are reference rows the toolkit fills
// (dependency gate, category attach); source-archive is written by the archive step.
const ROW_EXPORTS = {
  'product-name': 'productName',
  'product-description': 'productDescription',
  'product-slug': 'productSlug',
  'product-visible': 'productVisible',
  'product-media': 'productMedia',
  'product-price-simple': 'productPriceSimple',
  'product-sku-simple': 'productSkuSimple',
  'product-weight-simple': 'productWeightSimple',
  'product-stock-simple': 'productStockSimple',
  'product-variants': 'productVariants',
  'product-brand': 'productBrand',
  'product-seo': 'productSeo',
};

// Arrays of plain objects merge element by element (a simple product's one variant gets its
// price, SKU, weight and stock from four rows); everything else as lib/plan-builder.js merges.
function mergeCanonical(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v) && Array.isArray(target[k]) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      v.forEach((item, i) => { target[k][i] = target[k][i] && typeof target[k][i] === 'object' ? mergeCanonical({ ...target[k][i] }, item) : item; });
    } else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) mergeCanonical(target[k], v);
    else if (v !== undefined) target[k] = v;
  }
  return target;
}

// The whole suggested product with no operator change: every row export, in plan order, then
// one buildProduct call. Used as reference and test material; a run builds from its plan rows.
function build(record, lookups = {}, choices = {}) {
  const exportsByName = module.exports;
  const canonical = { sourceId: record.id };
  const composeOptions = {};
  const after = [];
  let loopInput = {};
  const rowFindings = [];
  for (const [rowId, fn] of Object.entries(ROW_EXPORTS)) {
    const result = exportsByName[fn](record, { lookups, choices, args: (ROW_ARGS[rowId] || {}) });
    if (!result) continue;
    if (result.hold) return held(rowId, result.hold.code);
    if (result.canonical) mergeCanonical(canonical, result.canonical);
    if (result.composeOptions) Object.assign(composeOptions, result.composeOptions);
    if (result.record) after.push(result.record);
    if (result.loopInput) loopInput = { ...loopInput, ...result.loopInput };
    if (result.findings) rowFindings.push(...result.findings);
  }
  canonical.optionNames = canonical.optionNames || [];
  foldSelectionOptionsNote(canonical);
  const findings = [...rowFindings];
  const product = buildProduct(canonical, { ...composeOptions, findings });
  for (const part of after) Object.assign(product, part);
  // As lib/plan-builder.js: row findings travel in loopInput.findings, where the loop records them.
  if (rowFindings.length) loopInput = { ...loopInput, findings: [...(loopInput.findings || []), ...rowFindings] };
  return {
    product,
    findings,
    selectionRoute: loopInput.selectionRoute || null,
    operatorActions: loopInput.operatorActions || [],
    loopInput,
  };
}

// Which suggested choices changed or dropped something in this record (owner rule: every choice,
// dropped field and fallback is a cutover task). A choice that only holds is reported through its
// hold code instead (HOLD_CHOICES). Each detector reads the source record and the build result.
const variations = (r) => (Array.isArray(r._variations) ? r._variations : []);
const stockRows = (r) => [r, ...variations(r)];
const metaKey = (r, key) => (r.meta_data || []).some((m) => m && m.key === key && !blank(m.value));
const CHOICE_DETECTORS = {
  'product-name-over-80': (r, x) => (x.findings || []).some((f) => f.code === 'product-name-truncated'),
  'product-description-compose': (r) => !blank(r.short_description) && !blank(r.description),
  'product-description-placeholder': (r) => [r.description, r.short_description].some((d) => !blank(d) && isPlaceholderDescription(d)),
  'product-slug-empty': (r) => blank(r.slug),
  'product-visible-status': (r) => r.status !== 'publish',
  'product-visible-catalog-visibility': (r) => ['catalog', 'search', 'hidden'].includes(r.catalog_visibility),
  'product-media-order': (r) => (r.images || []).length > 1,
  'variation-image': (r) => variations(r).some((v) => v.image && !blank(v.image.src)),
  'sale-price-zero': (r) => stockRows(r).some((v) => String(v.sale_price) === '0'),
  'sale-price-scheduled': (r) => stockRows(r).some((v) => Number(v.sale_price) > 0 && v.on_sale === false),
  'woosb-bundle': (r) => r.type === 'woosb',
  'woosb-compare-at': (r) => r.type === 'woosb' && (isPositive(r.sale_price) || (isPositive(r.regular_price) && Number(r.regular_price) > Number(r.price))),
  'weight-unit': (r) => stockRows(r).some((v) => !blank(v.weight)),
  'tracked-null-quantity': (r) => stockRows(r).some((v) => v.manage_stock === true && blank(v.stock_quantity)),
  'negative-quantity': (r) => stockRows(r).some((v) => v.manage_stock === true && (Number(v.stock_quantity) < 0 || Number(v.stock_quantity) > MAX_QUANTITY)),
  backorders: (r) => stockRows(r).some((v) => (v.backorders && v.backorders !== 'no') || v.stock_status === 'onbackorder'),
  'any-attribute': (r, x) => Boolean(x.product && (x.product.modifiers || []).length),
  'variation-shared-parent-stock': (r) => variations(r).some((v) => v.manage_stock === 'parent'),
  'brand-link': (r) => (r.brands || []).length > 0,
  'several-brands': (r) => (r.brands || []).length > 1,
  'seo-overrides': (r, x) => Boolean(x.product && x.product.seoData),
  'focus-keyword': (r) => metaKey(r, '_yoast_wpseo_focuskw'),
  'leftover-fields': () => true,
};
// Choices whose only effect is a hold: reported by their hold code (holdCodes), never twice.
// `seo-absent-key` writes nothing and changes nothing (the product inherits its template).
// `price-missing` / `variation-price-missing` are reported by their finding code (findingCodes).
const HOLD_CHOICES = ['product-description-over-16000', 'product-options-over-limit', 'price-missing', 'variation-price-missing', 'undeclared-variation-value',
  'external-product', 'grouped-product', 'gift-card-product', 'seo-absent-key'];
const MONEY_CHOICES = new Set(['sale-price-zero', 'sale-price-scheduled', 'woosb-bundle', 'woosb-compare-at']);

// A row's recorded choice (B1 `choice`); a row that decides several values keeps them as `parts`.
function suggestionChoices(suggestion) {
  return suggestion.fieldMappings.flatMap((row) => (row.choice ? (row.choice.parts || [row.choice]).map((c) => ({ row: row.id, choice: c })) : []));
}

// Every held product, every selection-route action and every applied choice, dropped field or
// fallback becomes a cutover task in the existing completion-report operatorActions[] (structured
// form), one per code. `results`: [{ sourceId, record, result }] where result is what build() returned.
function operatorActionsFor(results, suggestion = require('./product.json')) {
  const byCode = new Map();
  const add = (code, sourceId, task) => {
    if (!byCode.has(code)) byCode.set(code, { code, task, ids: [] });
    byCode.get(code).ids.push(String(sourceId));
  };
  const choices = suggestionChoices(suggestion);
  for (const { choice } of choices) {
    if (!CHOICE_DETECTORS[choice.name] && !HOLD_CHOICES.includes(choice.name)) throw new Error(`choice ${choice.name} has no cutover reporting rule`);
  }
  for (const { sourceId, record, result } of results) {
    if (result && result.status === 'held') {
      for (const hold of result.holds) {
        const task = suggestion.holdCodes[hold.code];
        if (!task) throw new Error(`product hold code ${hold.code} has no cutover task in product.json holdCodes`);
        add(hold.code, sourceId, task);
      }
      continue;
    }
    // A record written with a fallback (no price -> hidden at 0): its finding code names the task.
    for (const f of (result && result.findings) || []) {
      const task = (suggestion.findingCodes || {})[f.code];
      if (task) add(f.code, sourceId, task);
    }
    for (const a of (result && result.operatorActions) || []) {
      add(a.code, sourceId, { ...suggestion.routeActions, severity: a.severity || 'medium', action: `Check these product pages before launch: ${a.detail || a.code}.` });
    }
    if (!record) continue;
    for (const { row, choice } of choices) {
      const detect = CHOICE_DETECTORS[choice.name];
      if (!detect || !detect(record, result)) continue;
      add(`choice:${choice.name}`, sourceId, {
        role: 'cutover-operator',
        severity: MONEY_CHOICES.has(choice.name) ? 'medium' : 'low',
        action: `Products imported with a default choice (${row}): ${choice.name} = ${JSON.stringify(choice.value)} (decided by ${choice.decidedBy}). ${choice.reason} Check a few in Business Manager; if this is wrong, change the plan row and ask the Import Operator to re-import them.`,
        resolutionEvidence: 'The choice is accepted, or the plan row is changed and the listed products are re-imported.',
      });
    }
  }
  return [...byCode.values()].map(({ code, task, ids }) => ({
    actionId: `product:${code}`,
    code,
    entity: 'product',
    role: task.role,
    severity: task.severity,
    action: task.action,
    deadlineReason: 'before launch',
    affectedCount: ids.length,
    // One task per code for the whole entity. A long list keeps a sample here; the full set is
    // every source record with this outcome in the write-attempt journal (and, for a choice, in the extract).
    affectedIds: ids.slice(0, MAX_AFFECTED_IDS),
    artifactRefs: ['mapping/mapping-plan.json', ...(ids.length > MAX_AFFECTED_IDS ? ['state/attempts/write-attempts.ndjson', 'data/source-extract/product.ndjson'] : [])],
    prerequisites: [],
    resolutionEvidence: task.resolutionEvidence,
    ...(task.importOperatorPrompt ? { importOperatorPrompt: task.importOperatorPrompt } : {}),
  }));
}

module.exports = { build, mergeCanonical, ROW_EXPORTS, productName, productDescription, productSlug, productVisible, productMedia, productPriceSimple, productSkuSimple, productWeightSimple, productStockSimple, productVariants, selectionRouteOf, overLimitChoice, simplePricing, hasCompareAt, price, isVariable, isBlank: blank, productBrand, productSeo, operatorActionsFor, CHOICE_DETECTORS, HOLD_CHOICES, TYPE_ROUTE, PENDING_CUSTOMIZATION, MAX_QUANTITY, MAX_AFFECTED_IDS };
