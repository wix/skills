'use strict';

// rp-target-wix — the DETERMINISTIC canonical -> Wix payload builder.
//
// Replaces the per-project, LLM-authored `src/import/transforms/to-wix.js`. Everything in here is
// vendor-independent: it consumes a CANONICAL record (see wix-target-spec.js CANONICAL_FIELDS) and
// emits a Wix Stores V3 create body. Nothing about Shopify, Woo, Magento or BigCommerce appears —
// that asymmetry is exactly why this layer never needed to be regenerated per run.
//
// Scalar placement is driven by the spec (payloadPath / wrap / coerce). The four structural
// builders — variants, options, media, seoData — are spec-*declared* (`via`) but hand-implemented,
// because a fully declarative encoding of "variants reference option choices BY NAME" would be a
// worse artifact than the twenty lines it replaces. The spec still owns WHICH canonical fields
// route through them, so coverage reporting stays complete.

const { STORES_V3_TARGET, CATEGORY_TARGET, CANONICAL_FIELDS } = require('./wix-target-spec.js');

// --- coercion --------------------------------------------------------------
// Money must be an OBJECT ({ amount: '20.00' }); a bare number 400s. Decimal STRINGS avoid float
// drift on amounts that came out of a CSV as text in the first place.
function money(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error(`money: "${amount}" is not a finite number`);
  return { amount: n.toFixed(2) };
}

// Wix rejects a slug containing ^!“”$%&'*+,.:;<>=?@\/()[]{}_|` ~#. Vendors mint illegal ones
// routinely — Shopify turns a decimal size into an underscore (ph-5_5), which 400s the whole
// bulk batch, so this runs on EVERY slug rather than being a vendor quirk.
function toWixSlug(raw) {
  const slug = String(raw == null ? '' : raw)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`toWixSlug: "${raw}" sanitizes to an empty slug`);
  return slug;
}

function coerceBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return fallback;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active', 'published', 'enabled', 'visible'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'draft', 'archived', 'disabled', 'hidden'].includes(s)) return false;
  return fallback;
}

const COERCE = { slug: toWixSlug, money, boolean: coerceBoolean };

function isBlank(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

// --- structural builders ---------------------------------------------------
// Option definitions are derived from the variants' own choices, so a value that never occurs
// cannot produce a phantom choice. Order is first-seen, which preserves the source's ordering.
function buildOptions(product) {
  const names = product.optionNames || [];
  return names.map((name) => {
    const seen = new Map();
    for (const variant of product.variants || []) {
      for (const choice of variant.choices || []) {
        if (choice.optionName === name && !seen.has(choice.choiceName)) {
          seen.set(choice.choiceName, { choiceType: 'CHOICE_TEXT', name: choice.choiceName });
        }
      }
    }
    return { name, optionRenderType: 'TEXT_CHOICES', choicesSettings: { choices: [...seen.values()] } };
  });
}

// A variant references its option choices BY NAME; the API returns server-assigned choice ids.
// An empty `choices: []` is the correct encoding of "this product has no real options" — it must
// produce a single default variant, never a synthetic one-choice option.
function buildVariants(product, { inStock = true } = {}) {
  return (product.variants || []).map((variant) => {
    const out = {
      visible: coerceBoolean(variant.visible, true),
      choices: (variant.choices || []).map((choice) => ({
        optionChoiceNames: {
          optionName: choice.optionName,
          choiceName: choice.choiceName,
          renderType: 'TEXT_CHOICES',
        },
      })),
      price: buildVariantPrice(variant),
      inventoryItem: { inStock },
    };
    if (!isBlank(variant.sku)) out.sku = String(variant.sku);
    // Weight is expected already converted to the site's unit by the adapter; the canonical field
    // carries a number, not a unit-bearing string.
    if (!isBlank(variant.weight)) out.physicalProperties = { weight: Number(variant.weight) };
    return out;
  });
}

// Implements STORES_V3_TARGET.priceResolution.
//
// Two vendor idioms converge here. Shopify ships (price, compareAtPrice); Woo / Magento /
// BigCommerce ship (regular price, sale price) — which the overlays map to
// (variant.price, variant.discountedPrice). Wix models `actualPrice` (charged) plus
// `compareAtPrice` (strike-through), so a sale price has to be PROMOTED to actualPrice and the
// regular price demoted to the strike-through. Getting this backwards silently overcharges every
// discounted product, which is why the rule lives in the spec instead of being re-decided per run.
//
// TRAP (verified): Wix rejects compareAtPrice <= actualPrice. Vendors write 0.00 — and Woo writes
// an empty cell — to mean "no discount", so a not-strictly-greater compare-at is DROPPED.
function buildVariantPrice(variant) {
  const listPrice = Number(variant.price);
  const discounted = variant.discountedPrice;

  let actual = listPrice;
  let compare = variant.compareAtPrice;
  if (!isBlank(discounted) && Number(discounted) > 0 && Number(discounted) < listPrice) {
    actual = Number(discounted);
    compare = listPrice;
  }

  const out = { actualPrice: money(actual) };
  if (!isBlank(compare) && Number(compare) > actual) out.compareAtPrice = money(compare);
  return out;
}

// External URLs on media.itemsInfo.items[] are the preferred path: Wix ingests them server-side in
// the background, avoiding the throttled Media Manager pre-import. The FIRST item becomes the
// product's main media, so caller-side ordering matters.
// TRAP: reading these back needs `?fields=MEDIA_ITEMS_INFO`; a plain GET returns only media.main
// and looks empty even on a successful ingest.
function buildMedia(product) {
  const items = (product.images || [])
    .filter((image) => image && image.fetchable !== false && !isBlank(image.url))
    .map((image) => ({ url: image.url, ...(isBlank(image.altText) ? {} : { altText: image.altText }) }));
  return items.length ? { itemsInfo: { items } } : null;
}

// Emit a title tag only when it differs from the product name — a duplicate tag says nothing and
// is pure noise in the payload.
function buildSeoData(product) {
  const tags = [];
  if (!isBlank(product.seoTitle) && String(product.seoTitle).trim() !== String(product.name || '').trim()) {
    tags.push({ type: 'title', children: String(product.seoTitle) });
  }
  if (!isBlank(product.seoDescription)) {
    tags.push({ type: 'meta', props: { name: 'description', content: String(product.seoDescription) } });
  }
  return tags.length ? { tags } : null;
}

// --- product ---------------------------------------------------------------
function setPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor[parts[i]] = cursor[parts[i]] || {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

// Builds the Stores V3 create body from a canonical product record.
// `options.inStock` exists because availability is frequently the ONLY importable inventory signal
// (most vendor exports carry no quantity column); sending quantity 0 would mark a whole catalog
// out of stock, so the caller states the intent explicitly.
function buildProduct(product, { inStock = true, target = STORES_V3_TARGET } = {}) {
  if (isBlank(product.name)) throw new Error('buildProduct: product.name is required');
  const body = { ...target.constants };

  // Spec-driven scalars.
  for (const [canonicalPath, fieldSpec] of Object.entries(target.fields)) {
    if (!fieldSpec.payloadPath) continue; // structural: handled below
    const key = canonicalPath.replace(/^product\./, '');
    let value = product[key];
    const def = CANONICAL_FIELDS[canonicalPath] || {};
    if (isBlank(value) && def.default !== undefined) value = def.default;
    if (isBlank(value) && typeof value !== 'boolean') continue;
    if (fieldSpec.coerce && COERCE[fieldSpec.coerce]) value = COERCE[fieldSpec.coerce](value);
    else if (def.kind === 'boolean') value = coerceBoolean(value, def.default);
    // A spec-declared length cap is enforced here rather than truncated: silently shortening a
    // description is exactly the invisible data loss this pipeline exists to avoid, and the caller
    // is the one who can decide between truncating, splitting into an info section, or skipping.
    if (fieldSpec.maxLength && typeof value === 'string' && value.length > fieldSpec.maxLength) {
      throw new Error(
        `buildProduct: "${product.name}" has a ${value.length}-character ${canonicalPath} but Wix caps ${fieldSpec.payloadPath} at ${fieldSpec.maxLength}. Truncate it, move the overflow into an info section, or skip the field — and record the loss in mapping-gaps.json.`,
      );
    }
    setPath(body, fieldSpec.payloadPath, fieldSpec.wrap ? fieldSpec.wrap(value) : value);
  }

  // Structural builders, declared in the spec via `via`.
  const options = buildOptions(product);
  if (options.length) body.options = options;
  const media = buildMedia(product);
  if (media) body.media = media;
  const seoData = buildSeoData(product);
  if (seoData) body.seoData = seoData;
  body.variantsInfo = { variants: buildVariants(product, { inStock }) };
  if (!body.variantsInfo.variants.length) {
    throw new Error(`buildProduct: "${product.name}" produced no variant; every Wix product needs at least one`);
  }
  return body;
}

// --- category --------------------------------------------------------------
// Categories are created depth-ascending so a parent id is always resolvable. Dedupe against a
// live site must key on name + PARENT, never name alone: a real tree repeats a name at different
// depths (e.g. "Shampoo & Conditioner" under two different parents).
function buildCategory(category, { categoryIdByPath = new Map(), target = CATEGORY_TARGET } = {}) {
  if (isBlank(category.name)) throw new Error('buildCategory: category.name is required');
  const body = { ...target.constants };
  for (const [canonicalPath, fieldSpec] of Object.entries(target.fields)) {
    if (!fieldSpec.payloadPath) continue;
    const key = canonicalPath.replace(/^category\./, '');
    let value = category[key];
    const def = CANONICAL_FIELDS[canonicalPath] || {};
    if (isBlank(value) && def.default !== undefined) value = def.default;
    if (isBlank(value) && typeof value !== 'boolean') continue;
    if (def.kind === 'boolean') value = coerceBoolean(value, def.default);
    setPath(body, fieldSpec.payloadPath, value);
  }
  const parentId = category.parentPath ? categoryIdByPath.get(category.parentPath) : null;
  if (parentId) body.parentCategory = { id: parentId };
  return body;
}

module.exports = {
  money,
  toWixSlug,
  coerceBoolean,
  buildOptions,
  buildVariants,
  buildVariantPrice,
  buildMedia,
  buildSeoData,
  buildProduct,
  buildCategory,
};
