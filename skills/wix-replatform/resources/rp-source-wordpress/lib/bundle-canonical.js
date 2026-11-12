'use strict';

// WooCommerce bundle plugins -> the canonical product.bundle (rp-target-wix/lib/wix-target-spec.js
// validateCanonicalBundle). This file only reads how the plugins store a bundle. What Wix does with
// a bundle is decided on the target side (stores/product-bundle, lib/stores-bundle-cutover.js).
//
//   WPC Product Bundles   product type `woosb`, meta `woosb_ids`        -> kind fixed
//   WPC Composite Products product type `composite`, meta `wooco_components` -> kind configurable
//
// Input is one wc/v3/products record (its `meta_data` array). Output:
//   { hasBundleFields, bundle, unreadableReason }
// hasBundleFields: the record carries the plugin's composition meta. When it does, either `bundle`
// is set or `unreadableReason` says why not, so the contents are never dropped in silence.
// The bundle's price is never computed here: the record's own `price` is the product's price.
// The product type decides: meta left on a product whose type is no longer `woosb` / `composite`
// (it was changed, or the plugin is off and WooCommerce reports it as a plain product) is not a
// bundle, because the source sells it as a plain product. It is reported as `staleBundleMeta`.

const BUNDLE_META = Object.freeze(['woosb_ids']);
const COMPOSITE_META = Object.freeze(['wooco_components']);
// Every meta key the field contract carries to cutover for these plugins (A.2 of the bundle rule):
// the composition plus the pricing settings that only describe how the source priced it.
const CARRIED_META_KEYS = Object.freeze([
  'woosb_ids', 'woosb_disable_auto_price', 'woosb_discount', 'woosb_discount_amount', 'woosb_optional_products',
  'wooco_components', 'wooco_pricing', 'wooco_discount_percent', 'wooco_custom_price',
]);

function metaMap(record) {
  const out = new Map();
  for (const row of Array.isArray(record?.meta_data) ? record.meta_data : []) {
    if (row && typeof row.key === 'string') out.set(row.key, row.value);
  }
  return out;
}

const present = (value) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
  && !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

function positiveInt(value, fallback) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.round(n));
}

function idOf(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) && text !== '0' ? text : null;
}

const truthy = (value) => value === true || ['on', 'yes', '1', 'true'].includes(String(value ?? '').trim().toLowerCase());

// woosb_ids: current shape {<key>: {id, sku, qty}} (or an array of those); legacy 'id1/qty1,id2/qty2'.
function woosbComponents(raw) {
  let items;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try { return woosbComponents(JSON.parse(text)); } catch { throw new Error('woosb_ids is not valid JSON'); }
    }
    items = text.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [id, qty] = part.split('/');
      return { id, qty };
    });
  } else if (Array.isArray(raw)) items = raw;
  else if (raw && typeof raw === 'object') items = Object.values(raw);
  else throw new Error('woosb_ids has an unknown shape');
  const components = items.map((item, index) => {
    const id = idOf(item && item.id);
    if (!id) throw new Error(`woosb_ids item ${index} has no product id`);
    return { sourceProductId: id, sourceVariantId: null, quantity: positiveInt(item.qty, 1), optional: truthy(item.optional) };
  });
  if (!components.length) throw new Error('woosb_ids lists no products');
  return components;
}

function listOf(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean);
  return [];
}

// wooco_components: {<key>: {name, type, products, categories, tags, exclude, optional, min, max, ...}}.
// `type` names where the group's choices come from: products (an explicit list) or a category/tag
// rule. min/max are the group's quantity limits (empty max = no limit).
function woocoGroups(raw, { productsForRule } = {}) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('wooco_components is not valid JSON'); }
  }
  const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : null;
  if (!items || !items.length) throw new Error('wooco_components lists no components');
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`wooco_components item ${index} is not an object`);
    const type = String(item.type || 'products');
    const optional = truthy(item.optional);
    const min = optional ? 0 : positiveInt(item.min, 1);
    const maxRaw = String(item.max ?? '').trim();
    const max = maxRaw === '' ? null : Math.max(min || 1, positiveInt(maxRaw, 1));
    const exclude = listOf(item.exclude).map(idOf).filter(Boolean);
    let candidates = [];
    let candidateRule = null;
    if (type === 'products') {
      candidates = listOf(item.products).map(idOf).filter(Boolean).map((id) => ({ sourceProductId: id, sourceVariantId: null }));
      if (!candidates.length) throw new Error(`wooco_components item ${index} lists no products`);
    } else {
      const terms = listOf(item[type] ?? item.categories ?? item.tags).map(idOf).filter(Boolean);
      candidateRule = { source: type, termIds: terms, excludeProductIds: exclude };
      if (typeof productsForRule === 'function') {
        candidates = [...new Set((productsForRule(candidateRule) || []).map(idOf).filter(Boolean))]
          .filter((id) => !exclude.includes(id)).sort().map((id) => ({ sourceProductId: id, sourceVariantId: null }));
      }
    }
    return { label: typeof item.name === 'string' ? item.name : '', min, max, optional, candidates, candidateRule };
  });
}

function stockRuleOf(record) {
  return record && record.manage_stock === true ? 'own' : 'unknown';
}

// productsForRule(rule) may resolve a category/tag group to product ids from the extracted catalog.
function canonicalBundleFromWooProduct(record, { productsForRule } = {}) {
  const meta = metaMap(record);
  let woosb = BUNDLE_META.some((key) => present(meta.get(key)));
  let wooco = COMPOSITE_META.some((key) => present(meta.get(key)));
  const type = typeof record?.type === 'string' ? record.type : null;
  if (type && (woosb || wooco) && !((woosb && type === 'woosb') || (wooco && type === 'composite'))) {
    return { hasBundleFields: false, bundle: null, unreadableReason: null, staleBundleMeta: true };
  }
  if (type === 'woosb') wooco = false;
  if (!woosb && !wooco) return { hasBundleFields: false, bundle: null, unreadableReason: null };
  try {
    if (woosb) {
      const optional = truthy(meta.get('woosb_optional_products'));
      return {
        hasBundleFields: true,
        unreadableReason: null,
        bundle: {
          kind: 'fixed',
          components: woosbComponents(meta.get('woosb_ids')).map((part) => ({ ...part, optional: optional || part.optional })),
          groups: [],
          priceRule: truthy(meta.get('woosb_disable_auto_price')) ? 'fixed' : 'derived',
          stockRule: stockRuleOf(record),
          detectedBy: 'wordpress:woo-product-bundle',
        },
      };
    }
    const pricing = String(meta.get('wooco_pricing') ?? '').trim();
    return {
      hasBundleFields: true,
      unreadableReason: null,
      bundle: {
        kind: 'configurable',
        components: [],
        groups: woocoGroups(meta.get('wooco_components'), { productsForRule }),
        priceRule: pricing === 'only' ? 'fixed' : pricing ? 'derived' : 'unknown',
        stockRule: stockRuleOf(record),
        detectedBy: 'wordpress:wpc-composite-products',
      },
    };
  } catch (error) {
    return { hasBundleFields: true, bundle: null, unreadableReason: error.message };
  }
}

module.exports = { CARRIED_META_KEYS, canonicalBundleFromWooProduct };
