'use strict';
// Source-neutral route for selection attributes: which declared attributes become
// Wix variants and which become modifiers. Reads only canonical fields, so any source adapter that
// fills `product.selectionAttributes` gets the same route:
//
//   product.selectionAttributes: [{ name, choices: [string], priceStockScope?, required? }]
//   product.variants: the source's sellable records in matching precedence (first match wins).
//     Each record's `choices` lists only the attributes it FIXES; an attribute it leaves open
//     (WooCommerce "Any") is simply absent. Price, sale price, SKU and stock fields are the usual
//     canonical variant fields.
//
// Rules:
// - A `shared` attribute (no record can give it a different price or stock) becomes a mandatory
//   modifier; it is never enumerated, so Wix's option/variant limits do not apply to it.
// - Every other attribute becomes a variant option. Open records are expanded over the declared
//   choices with first-match precedence, within Wix limits.
// - A tracked quantity is a pool. It is never copied onto several variants: an open record that
//   tracks quantity and covers several variants imports as stock status only, with a
//   high-severity operator action (owner-approved policy).
// - Over the limits with per-choice price/stock: attributes that move price/stock stay variants
//   when they fit, the rest become modifiers; otherwise one default variant at the lowest source
//   price, every attribute a modifier, and an operator action listing the prices (owner-approved policy).
// - Never throws for a shape it can represent; throws only for contradictory input (a scope the
//   records disprove, a choice the attribute does not declare), which the caller reports as a gap.

const LIMITS = Object.freeze({ options: 6, variants: 1000, choicesPerOption: 100 });
const SCOPES = new Set(['shared', 'partial', 'per-choice']);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const fixedChoice = (record, name) => (record.choices || []).find((c) => c.optionName === name);
const tracksQuantity = (record) => record.inventoryTracked === true
  || (own(record, 'inventoryQuantity') && record.inventoryQuantity != null && record.inventoryQuantity !== '' && record.inventoryTracked !== false);
const actualPrice = (record) => {
  const list = Number(record.price);
  const sale = Number(record.discountedPrice);
  return Number.isFinite(sale) && sale > 0 && sale < list ? sale : list;
};
const signature = (record) => JSON.stringify([record.price ?? null, record.discountedPrice ?? null,
  tracksQuantity(record) ? ['q', Number(record.inventoryQuantity)] : ['s', record.inStock ?? null]]);

function fail(product, message) {
  const error = new Error(`selection route: "${product.name}" (${product.sourceId}) ${message}`);
  error.code = 'SELECTION_ROUTE_CONTRADICTION';
  throw error;
}

// Checks the input and returns a copy keyed by unique labels. Attributes are identified by position:
// two attributes may share a label, and the later ones get a deterministic suffix ("Flavor (2)")
// used as their option or modifier name. A record choice names its attribute by `attributeIndex`
// when set, otherwise by a label that must be unique.
function normalize(product) {
  const attributes = product.selectionAttributes;
  if (!Array.isArray(attributes)) fail(product, 'selectionAttributes must be an array');
  for (const a of attributes) {
    if (!a || typeof a.name !== 'string' || !a.name.trim()) fail(product, 'has a selection attribute without a name');
    if (!Array.isArray(a.choices) || !a.choices.length || a.choices.some((c) => typeof c !== 'string' || !c.trim())) fail(product, `attribute "${a.name}" needs a non-empty list of choice names`);
    if (new Set(a.choices).size !== a.choices.length) fail(product, `attribute "${a.name}" repeats a choice`);
    if (a.priceStockScope != null && !SCOPES.has(a.priceStockScope)) fail(product, `attribute "${a.name}" has unknown priceStockScope "${a.priceStockScope}"`);
  }
  const declared = product.sourceDeclaredOptionNames;
  if (Array.isArray(declared) && (declared.length !== attributes.length || declared.some((n, i) => n !== attributes[i].name))) {
    fail(product, 'sourceDeclaredOptionNames must name the selection attributes in the same order');
  }
  const taken = new Set(attributes.map((a) => a.name));
  const seen = new Set();
  const labels = attributes.map((a) => {
    if (!seen.has(a.name)) { seen.add(a.name); return a.name; }
    let label;
    for (let n = 2; taken.has(label = `${a.name} (${n})`); n++);
    taken.add(label);
    return label;
  });
  const variants = (product.variants || []).map((record) => {
    const fixed = new Set();
    const choices = (record.choices || []).map((c) => {
      let at;
      if (c.attributeIndex != null) {
        at = c.attributeIndex;
        if (!Number.isInteger(at) || !attributes[at] || attributes[at].name !== c.optionName) fail(product, `has a record choice whose attributeIndex ${at} is not attribute "${c.optionName}"`);
      } else {
        const matches = attributes.map((x, i) => (x.name === c.optionName ? i : -1)).filter((i) => i >= 0);
        if (!matches.length) fail(product, `has a record fixing undeclared attribute "${c.optionName}"`);
        if (matches.length > 1) fail(product, `has a record fixing "${c.optionName}", which is declared twice, without attributeIndex`);
        [at] = matches;
      }
      if (fixed.has(at)) fail(product, `has a record fixing attribute "${c.optionName}" twice`);
      fixed.add(at);
      if (!attributes[at].choices.includes(c.choiceName)) fail(product, `has a record with choice "${c.choiceName}" that attribute "${c.optionName}" does not declare`);
      return { optionName: labels[at], choiceName: c.choiceName };
    });
    return { ...record, choices };
  });
  return {
    product: { ...product, selectionAttributes: attributes.map((a, i) => ({ ...a, name: labels[i] })), variants },
    renamed: attributes.map((a, i) => ({ attributeIndex: i, sourceName: a.name, name: labels[i] })).filter((r) => r.sourceName !== r.name),
  };
}

// The effective scope from the records. An explicit scope the records contradict is refused.
// Only an explicit `shared` is modifier-eligible: an unset scope with open records is expanded
// into variants, never guessed into a modifier.
function effectiveScope(product, attribute) {
  const records = product.variants || [];
  const fixed = records.filter((r) => fixedChoice(r, attribute.name)).length;
  if (attribute.priceStockScope === 'shared') {
    if (fixed) fail(product, `attribute "${attribute.name}" is declared shared but ${fixed} record(s) fix it`);
    return 'shared';
  }
  if (attribute.priceStockScope === 'per-choice' && fixed !== records.length) fail(product, `attribute "${attribute.name}" is declared per-choice but some records leave it open`);
  return fixed === records.length ? 'per-choice' : 'partial';
}

// Product of choice counts, stopping as soon as the limit is passed (never builds the set).
function boundedCount(attributes, limit) {
  let count = 1;
  for (const a of attributes) { count *= a.choices.length; if (count > limit) return limit + 1; }
  return count;
}

function fits(attributes) {
  return attributes.length <= LIMITS.options
    && attributes.every((a) => a.choices.length <= LIMITS.choicesPerOption)
    && boundedCount(attributes, LIMITS.variants) <= LIMITS.variants;
}

function* combinations(attributes) {
  const index = attributes.map(() => 0);
  if (!attributes.length) return;
  while (true) {
    yield attributes.map((a, i) => ({ optionName: a.name, choiceName: a.choices[index[i]] }));
    let i = attributes.length - 1;
    while (i >= 0 && ++index[i] === attributes[i].choices.length) { index[i] = 0; i--; }
    if (i < 0) return;
  }
}

function statusOnly(record) {
  const out = { ...record, inventoryTracked: false, inStock: Number(record.inventoryQuantity) > 0 };
  delete out.inventoryQuantity;
  return out;
}

// Expand records over the variant attributes, first match wins. A combination no record matches
// is not sellable in the source and gets no variant.
function expand(product, variantAttributes, operatorActions) {
  const records = product.variants || [];
  const matched = records.map(() => []);
  for (const combo of combinations(variantAttributes)) {
    const at = records.findIndex((r) => combo.every((c) => {
      const f = fixedChoice(r, c.optionName);
      return !f || f.choiceName === c.choiceName;
    }));
    if (at >= 0) matched[at].push(combo);
  }
  const variants = [];
  records.forEach((record, at) => {
    const pooled = tracksQuantity(record) && matched[at].length > 1;
    if (pooled) {
      operatorActions.push({
        code: 'shared-stock-pool-not-tracked',
        severity: 'high',
        sourceId: product.sourceId,
        sourceRecord: record.sourceId ?? at,
        quantity: Number(record.inventoryQuantity),
        variantCount: matched[at].length,
        detail: 'one source stock pool covers several Wix variants; imported as stock status only. Set stock tracking by hand before launch.',
      });
    }
    // One source record can cover several Wix variants: `variantKey` is unique per Wix variant
    // (the record id, plus the choices when the record was expanded), for variant expectations
    // and the crosswalk. `sourceId` stays the source record's id.
    const recordKey = String(record.sourceId ?? at);
    for (const combo of matched[at]) {
      const variantKey = matched[at].length > 1 ? `${recordKey}#${combo.map((c) => c.choiceName).join('|')}` : recordKey;
      variants.push({ ...(pooled ? statusOnly(record) : record), choices: combo, variantKey });
    }
  });
  return variants;
}

// An attribute moves price/stock when two records that fix it to different values differ in
// price, sale price or stock. Over-counts (safe: more variants, fewer modifiers).
function movesPriceOrStock(product, attribute) {
  const records = (product.variants || []).filter((r) => fixedChoice(r, attribute.name));
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (fixedChoice(records[i], attribute.name).choiceName !== fixedChoice(records[j], attribute.name).choiceName
        && signature(records[i]) !== signature(records[j])) return true;
    }
  }
  return false;
}

function modifierFor(attribute) {
  return { name: attribute.name, customizationName: attribute.name, choices: [...attribute.choices], mandatory: attribute.required !== false };
}

function dropChoices(record, names) {
  return { ...record, choices: (record.choices || []).filter((c) => !names.has(c.optionName)) };
}

// Returns { product, route, decision, renamed, operatorActions }. `product` is a copy carrying optionNames, variants,
// modifiers and sourceDeclaredOptionNames, ready for buildProduct. Products without
// selectionAttributes are returned unchanged with route 'none'.
function routeSelections(product) {
  if (!product || !Array.isArray(product.selectionAttributes) || !product.selectionAttributes.length) {
    return { product, route: 'none', operatorActions: [] };
  }
  const normalized = normalize(product);
  product = normalized.product;
  const attributes = product.selectionAttributes;
  const records = product.variants || [];
  if (!records.length) fail(product, 'declares selection attributes but has no sellable record');
  const operatorActions = [];
  const shared = attributes.filter((a) => effectiveScope(product, a) === 'shared');
  let variantAttributes = attributes.filter((a) => !shared.includes(a));
  let modifierAttributes = [...shared];
  let variants;
  let decision = null;

  if (!variantAttributes.length) {
    // Every attribute is shared: one default variant. Only the first record can ever match.
    variants = [{ ...records[0], choices: [], variantKey: String(records[0].sourceId ?? 0) }];
  } else if (fits(variantAttributes)) {
    variants = expand(product, variantAttributes, operatorActions);
  } else {
    decision = 'B';
    const moving = variantAttributes.filter((a) => movesPriceOrStock(product, a));
    if (moving.length && fits(moving)) {
      const demoted = new Set(variantAttributes.filter((a) => !moving.includes(a)).map((a) => a.name));
      modifierAttributes = attributes.filter((a) => shared.includes(a) || demoted.has(a.name));
      variantAttributes = moving;
      variants = expand({ ...product, variants: records.map((r) => dropChoices(r, demoted)) }, variantAttributes, operatorActions);
      operatorActions.push({
        code: 'selection-over-variant-limits',
        severity: 'medium',
        sourceId: product.sourceId,
        modifierAttributes: [...demoted],
        detail: 'over Wix variant limits; attributes that do not change price or stock became modifiers. Check the product page before launch.',
      });
    } else {
      const cheapest = records.reduce((best, r) => (actualPrice(r) < actualPrice(best) ? r : best), records[0]);
      const anyTracked = records.some(tracksQuantity);
      const base = anyTracked ? { ...statusOnly(cheapest), inStock: records.some((r) => (tracksQuantity(r) ? Number(r.inventoryQuantity) > 0 : r.inStock !== false)) } : cheapest;
      variants = [{ ...base, choices: [], variantKey: String(cheapest.sourceId ?? records.indexOf(cheapest)) }];
      modifierAttributes = [...attributes];
      variantAttributes = [];
      operatorActions.push({
        code: 'selection-prices-not-represented',
        severity: 'high',
        sourceId: product.sourceId,
        importedPrice: cheapest.price,
        sourcePrices: records.map((r, at) => ({ sourceRecord: r.sourceId ?? at, choices: r.choices || [], price: r.price, discountedPrice: r.discountedPrice ?? null })),
        stockTrackingDropped: anyTracked,
        detail: 'per-choice prices exceed Wix variant limits; imported at the lowest source price with every attribute as a modifier. Set prices by hand before launch.',
      });
    }
  }

  // Labels are unique per product (normalize), so each modifier has its own customization name.
  const modifiers = attributes.filter((a) => modifierAttributes.includes(a)).map(modifierFor);
  const route = !modifiers.length ? 'variants' : !variantAttributes.length ? 'modifiers' : 'hybrid';
  return {
    product: {
      ...product,
      sourceDeclaredOptionNames: attributes.map((a) => a.name),
      optionNames: variantAttributes.map((a) => a.name),
      variants,
      modifiers,
    },
    route,
    decision,
    renamed: normalized.renamed,
    operatorActions,
  };
}

// The per-product route record the importer persists with the product's verification row, so the
// cutover storefront check can list modifier-route products from an artifact, not from chat.
function routeRecord(routed) {
  return {
    route: routed.route,
    decision: routed.decision ?? null,
    modifiers: (routed.product.modifiers || []).map((m) => m.customizationName),
    renamed: routed.renamed || [],
    operatorActions: (routed.operatorActions || []).map((a) => a.code),
  };
}

function choicesKey(choices) { return JSON.stringify(choices); }

// Catalog-wide customization names. Wix keeps one customization per name (and refuses a
// same-named group with different settings), so a label reused with a different choice list gets
// a deterministic suffix in catalog order. Same label and same choices share one customization.
// Mutates each routed product's modifiers[].customizationName; returns the customizations to write.
function planSelectionCustomizations(routedProducts) {
  const byKey = new Map();
  const taken = new Set();
  const customizations = [];
  for (const product of routedProducts) {
    const seenInProduct = new Map();
    for (const m of product.modifiers || []) {
      const base = m.customizationName || m.name;
      const occurrence = (seenInProduct.get(base + choicesKey(m.choices)) || 0) + 1;
      seenInProduct.set(base + choicesKey(m.choices), occurrence);
      const key = JSON.stringify([base, m.choices, occurrence]);
      if (!byKey.has(key)) {
        let name = base;
        for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
        taken.add(name);
        byKey.set(key, name);
        customizations.push(customizationPayload({ ...m, customizationName: name }));
      }
      m.customizationName = byKey.get(key);
    }
  }
  return customizations;
}

// The standalone customization create body for one modifier (stores/product-customization).
function customizationPayload(modifier) {
  return {
    customization: {
      name: modifier.customizationName,
      customizationType: 'MODIFIER',
      customizationRenderType: 'TEXT_CHOICES',
      choicesSettings: { choices: modifier.choices.map((name) => ({ choiceType: 'CHOICE_TEXT', name })) },
    },
  };
}

// The read-back expectation for a built product's modifiers, derived from what the source
// declared (the routed canonical product), not from the submitted body.
function modifierExpectation(routedProduct, connectedModifiers) {
  return (routedProduct.modifiers || []).map((m, i) => ({
    id: connectedModifiers[i].id,
    name: m.customizationName,
    mandatory: m.mandatory,
    choicesSettings: { choices: m.choices.map((name) => ({ name })) },
  }));
}

module.exports = { LIMITS, routeSelections, routeRecord, planSelectionCustomizations, customizationPayload, modifierExpectation };
