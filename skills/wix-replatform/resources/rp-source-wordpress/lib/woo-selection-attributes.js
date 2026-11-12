'use strict';
// WooCommerce-only part of the selection route: read "Any" and turn it into the source-neutral canonical
// facts that rp-target-wix/lib/selection-route.js routes on. No routing decision is made here.
//
// WooCommerce stores one record per variation, with one price and one stock. A variation
// attribute set to "Any" is either omitted from the variation or present with an empty `option`.
// So an attribute that is "Any" in EVERY variation can never change price or stock: `shared`.
// Fixed in every variation: `per-choice`. Fixed in some, "Any" in others: `partial`.
// WooCommerce sells the first matching variation in menu order (then id), so records are returned
// in that order. Only the parent's `variation: true` attributes are selectors; descriptive
// attributes are ignored. Every attribute must be chosen before add to cart: `required: true`.
//
// Variation values are often term slugs ("1-קג"), not the parent's display names ("1 ק\"ג"). Each value
// resolves to the parent's declared choice: exact, then percent-decoded, then a unique slug match.
// A value that still does not resolve is left as is; the route refuses it (a gap), it never guesses.
//
// Two parent attributes may share a label. Attributes are matched by position: a variation
// attribute matches by id when both ids are set, otherwise by name, and each one is used once.
// Every record choice carries `attributeIndex` (the parent selector position) so the route never
// relies on the label.
//
// Input: the WC REST product (`attributes[]`) and its variations (`attributes[]`, `menu_order`, `id`).
// Output: { selectionAttributes, records: [{ variationId, choices: [{ optionName, choiceName, attributeIndex }] }] }.
// The caller maps each record's price, sale price, SKU and stock as it already does and puts
// `choices` on the canonical variant.

const blank = (value) => value == null || String(value).trim() === '';

function selectorAttributes(parent) {
  return (parent?.attributes || []).filter((a) => a && a.variation === true && !blank(a.name));
}

function sameAttribute(parentAttribute, variationAttribute) {
  if (Number(parentAttribute.id) > 0 && Number(variationAttribute.id) > 0) return Number(parentAttribute.id) === Number(variationAttribute.id);
  return String(parentAttribute.name).trim().toLowerCase() === String(variationAttribute.name || '').trim().toLowerCase();
}

function menuOrder(variations) {
  return [...(variations || [])].sort((a, b) => (Number(a.menu_order) || 0) - (Number(b.menu_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
}

// WooCommerce's term slug shape: lower case, quotes dropped, spaces and underscores to one dash.
function termSlug(text) {
  return String(text).trim().toLowerCase().replace(/["'״׳`]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

function resolveChoice(value, choices) {
  const raw = String(value);
  if (choices.includes(raw)) return raw;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* not percent-encoded */ }
  if (choices.includes(decoded)) return decoded;
  const matches = choices.filter((c) => termSlug(c) === termSlug(decoded));
  return matches.length === 1 ? matches[0] : raw;
}

function wooSelectionAttributes(parent, variations) {
  const selectors = selectorAttributes(parent);
  const declared = selectors.map((a) => (a.options || []).map(String));
  const ordered = menuOrder(variations);
  const records = ordered.map((variation) => {
    const values = (variation.attributes || []).filter(Boolean);
    const used = new Set();
    const choices = [];
    selectors.forEach((attribute, attributeIndex) => {
      const at = values.findIndex((v, i) => !used.has(i) && sameAttribute(attribute, v));
      if (at < 0) return;
      used.add(at);
      if (blank(values[at].option)) return;
      choices.push({ optionName: attribute.name, choiceName: resolveChoice(values[at].option, declared[attributeIndex]), attributeIndex });
    });
    return { variationId: variation.id, choices };
  });
  const selectionAttributes = selectors.map((attribute, attributeIndex) => {
    const fixed = records.filter((r) => r.choices.some((c) => c.attributeIndex === attributeIndex)).length;
    const priceStockScope = !records.length ? undefined : fixed === 0 ? 'shared' : fixed === records.length ? 'per-choice' : 'partial';
    return {
      name: attribute.name,
      choices: declared[attributeIndex],
      ...(priceStockScope ? { priceStockScope } : {}),
      required: true,
    };
  });
  return { selectionAttributes, records };
}

module.exports = { wooSelectionAttributes, resolveChoice, termSlug };
