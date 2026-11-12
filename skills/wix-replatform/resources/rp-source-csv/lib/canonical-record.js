'use strict';

// rp-source-csv — reader shape -> CANONICAL record.
//
// This closes the seam between the two deterministic halves:
//
//   csv rows --[reader]--> reader-shaped record --[HERE]--> canonical record --[wix-build]--> Wix
//
// A reader names fields the way its vendor thinks (`bodyHtml`, `vendor`, `weightKg`); `wix-build.js`
// consumes the vendor-neutral vocabulary from `wix-target-spec.js` (`description`, `brand`,
// `weight`). Without this module that rename is hand-written per project — which is exactly the
// improvisation the deterministic pipeline exists to remove.
//
// The maps are DATA, per vendor, so adding a vendor is a data edit plus a fixture.
//
// Longer term the readers should emit canonical records directly and this module becomes a no-op
// identity map. It is deliberately a separate step rather than being folded into the reader, so the
// change can happen per vendor without a flag day.

const { validateCanonicalPath } = require('../../rp-target-wix/lib/wix-target-spec.js');

// `rename` moves a value unchanged. `derive` computes one from the whole record — kept to genuine
// multi-field logic, because a derive that only reads one field should be a rename.
const READER_FIELD_MAPS = {
  shopify: {
    product: {
      rename: {
        title: 'name',
        bodyHtml: 'description',
        slug: 'slug',
        vendor: 'brand',
        seoTitle: 'seoTitle',
        seoDescription: 'seoDescription',
        images: 'images',
        optionNames: 'optionNames',
        categoryPath: 'categoryPath',
        tags: 'tags',
        sourceId: 'sourceId',
      },
      derive: {
        // Shopify carries BOTH a lifecycle status and a publish flag; a product is visible only
        // when both agree. Collapsing to either one alone silently publishes drafts.
        visible: (record) => record.status === 'active' && record.published !== false,
      },
    },
    variant: {
      rename: {
        sku: 'sku',
        price: 'price',
        compareAtPrice: 'compareAtPrice',
        // The reader has already converted grams to the site's weight unit; the canonical field
        // carries a bare number, so the converted value is the one that travels.
        weightKg: 'weight',
        barcode: 'barcode',
        cost: 'cost',
        choices: 'choices',
      },
      derive: {
        visible: () => true,
      },
    },
    category: {
      rename: { name: 'name', parentPath: 'parentPath', path: 'path', sourceId: 'sourceId' },
      derive: { visible: () => true },
    },
  },
};

// woocommerce / magento / bigcommerce readers are not built yet. Registering them explicitly as
// absent is better than falling back to shopify's map and silently mis-renaming fields.
const SUPPORTED_VENDORS = Object.keys(READER_FIELD_MAPS);

function mapEntity(record, entityMap) {
  const out = {};
  for (const [readerKey, canonicalKey] of Object.entries(entityMap.rename || {})) {
    const value = record[readerKey];
    if (value !== undefined && value !== null) out[canonicalKey] = value;
  }
  for (const [canonicalKey, fn] of Object.entries(entityMap.derive || {})) {
    out[canonicalKey] = fn(record);
  }
  return out;
}

function mapFor(vendor, entity) {
  const vendorMap = READER_FIELD_MAPS[vendor];
  if (!vendorMap) {
    throw new Error(
      `canonical-record: no reader field map for vendor "${vendor}". ` +
        `Known: ${SUPPORTED_VENDORS.join(', ')}. Add one in READER_FIELD_MAPS rather than reusing another vendor's.`,
    );
  }
  const entityMap = vendorMap[entity];
  if (!entityMap) throw new Error(`canonical-record: vendor "${vendor}" has no map for entity "${entity}"`);
  return entityMap;
}

function toCanonicalProduct(record, { vendor = 'shopify' } = {}) {
  const product = mapEntity(record, mapFor(vendor, 'product'));
  const variantMap = mapFor(vendor, 'variant');
  product.variants = (record.variants || []).map((variant) => mapEntity(variant, variantMap));
  return product;
}

function toCanonicalCategory(record, { vendor = 'shopify' } = {}) {
  return mapEntity(record, mapFor(vendor, 'category'));
}

// Self-check: every canonical key a map produces must be a real canonical field. Runs at require
// time so a typo in the map is a load error, not a field that silently never lands in Wix.
function validateMaps() {
  const problems = [];
  for (const [vendor, entities] of Object.entries(READER_FIELD_MAPS)) {
    for (const [entity, entityMap] of Object.entries(entities)) {
      const keys = [...Object.values(entityMap.rename || {}), ...Object.keys(entityMap.derive || {})];
      for (const key of keys) {
        // Canonical paths are `<entity>.<field>`; the maps hold the bare field name.
        if (!validateCanonicalPath(`${entity}.${key}`)) problems.push(`${vendor}.${entity} -> ${entity}.${key}`);
      }
    }
  }
  return problems;
}

const MAP_PROBLEMS = validateMaps();
if (MAP_PROBLEMS.length) {
  throw new Error(`canonical-record: map targets are not canonical fields: ${MAP_PROBLEMS.join(', ')}`);
}

module.exports = {
  READER_FIELD_MAPS,
  SUPPORTED_VENDORS,
  toCanonicalProduct,
  toCanonicalCategory,
  validateMaps,
};
