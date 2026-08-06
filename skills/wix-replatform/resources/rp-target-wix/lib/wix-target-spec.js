'use strict';

// rp-target-wix — the DECLARATIVE Wix target spec.
//
// This module is the single source of truth for two things the pipeline used to re-derive with an
// LLM on every run:
//
//   1. CANONICAL_FIELDS — the vendor-neutral vocabulary a source adapter maps its columns onto.
//      A vendor overlay's `columnMap[].wixTarget` MUST name a field in here; anything else is a
//      typo or an unmodelled concept, and `validateCanonicalPath` catches it at load time instead
//      of at import time.
//
//   2. STORES_V3_TARGET — how each canonical field lands in a real Wix Stores V3 payload, plus
//      every trap learned by live call. This is vendor-independent: Shopify, WooCommerce, Magento
//      and BigCommerce all converge here, so it is written ONCE and tested ONCE.
//
// Why declarative: the mapping between a canonical field and a Wix payload path is data, and
// treating it as data means the resolver can compute coverage (which Wix fields are fed, which
// source columns are orphaned) BEFORE any code runs. That coverage report is what shrinks the
// agentic step from "author the whole mapping" to "decide the residue".
//
// Provenance markers carried per field:
//   verified   — exercised by a real successful write against a live site
//   unverified — shape derived from docs/schema only; must be surfaced in execution plans

// --- canonical vocabulary --------------------------------------------------
// `kind` drives deterministic coercion. `entity` says which canonical record holds it.
const CANONICAL_FIELDS = {
  // product scalars
  'product.name': { entity: 'product', kind: 'string', required: true },
  'product.description': { entity: 'product', kind: 'html' },
  'product.slug': { entity: 'product', kind: 'slug' },
  'product.brand': { entity: 'product', kind: 'string' },
  'product.visible': { entity: 'product', kind: 'boolean', default: true },
  'product.productType': { entity: 'product', kind: 'string' },
  'product.seoTitle': { entity: 'product', kind: 'string' },
  'product.seoDescription': { entity: 'product', kind: 'string' },
  'product.ribbon': { entity: 'product', kind: 'string' },
  // product collections
  'product.categoryPath': { entity: 'product', kind: 'string' },
  'product.tags': { entity: 'product', kind: 'stringList' },
  'product.images': { entity: 'product', kind: 'mediaList' },
  // variant scalars
  'variant.sku': { entity: 'variant', kind: 'string' },
  'variant.price': { entity: 'variant', kind: 'money', required: true },
  'variant.compareAtPrice': { entity: 'variant', kind: 'money' },
  'variant.cost': { entity: 'variant', kind: 'money' },
  'variant.barcode': { entity: 'variant', kind: 'string' },
  'variant.weight': { entity: 'variant', kind: 'weight' },
  'variant.weightUnit': { entity: 'variant', kind: 'string' },
  'variant.inventoryQuantity': { entity: 'variant', kind: 'integer' },
  'variant.inventoryPolicy': { entity: 'variant', kind: 'string' },
  'variant.inventoryTracked': { entity: 'variant', kind: 'boolean' },
  'variant.requiresShipping': { entity: 'variant', kind: 'boolean' },
  'variant.taxable': { entity: 'variant', kind: 'boolean' },
  'variant.visible': { entity: 'variant', kind: 'boolean', default: true },
  // variant options — positional in every vendor's flat CSV, normalized to choices[]
  'variant.option1.name': { entity: 'variant', kind: 'string', optionSlot: 1, role: 'optionName' },
  'variant.option1.value': { entity: 'variant', kind: 'string', optionSlot: 1, role: 'optionValue' },
  'variant.option2.name': { entity: 'variant', kind: 'string', optionSlot: 2, role: 'optionName' },
  'variant.option2.value': { entity: 'variant', kind: 'string', optionSlot: 2, role: 'optionValue' },
  'variant.option3.name': { entity: 'variant', kind: 'string', optionSlot: 3, role: 'optionName' },
  'variant.option3.value': { entity: 'variant', kind: 'string', optionSlot: 3, role: 'optionValue' },
  // identity — never a Wix field; carried for the crosswalk and dedupe
  'product.sourceId': { entity: 'product', kind: 'string', identity: true },
  'category.sourceId': { entity: 'category', kind: 'string', identity: true },
  'variant.parentRef': { entity: 'variant', kind: 'string', identity: true },
  // NORMALIZED adapter output, not a source column. The flat CSV carries positional option slots
  // (variant.option1.name/value …); the adapter collapses them into these two structures, which are
  // what the options/variants builders actually consume. They are never overlay-mappable — an
  // overlay that claimed them would be describing a column that does not exist.
  'product.optionNames': { entity: 'product', kind: 'stringList', normalized: true },
  'variant.choices': { entity: 'variant', kind: 'choiceList', normalized: true },
  // secondary description — vendors that ship both a long and a short body
  'product.shortDescription': { entity: 'product', kind: 'string' },
  // The vendor idiom for "price after discount". See STORES_V3_TARGET.priceResolution: Wix models
  // actualPrice (charged) + compareAtPrice (strike-through), so a regular/sale pair has to be
  // resolved into that shape rather than mapped field-for-field.
  'variant.discountedPrice': { entity: 'variant', kind: 'money' },
  'variant.inStock': { entity: 'variant', kind: 'boolean' },
  'variant.width': { entity: 'variant', kind: 'dimension' },
  'variant.height': { entity: 'variant', kind: 'dimension' },
  'variant.length': { entity: 'variant', kind: 'dimension' },
  'variant.image': { entity: 'variant', kind: 'string' },
  // image sub-record — assembles into product.images (kind mediaList)
  'image.url': { entity: 'image', kind: 'string', assemblesInto: 'product.images' },
  'image.altText': { entity: 'image', kind: 'string', assemblesInto: 'product.images' },
  'image.position': { entity: 'image', kind: 'integer', assemblesInto: 'product.images' },
  // tag sub-record
  'tag.name': { entity: 'tag', kind: 'string' },
  // category
  'category.name': { entity: 'category', kind: 'string', required: true },
  'category.description': { entity: 'category', kind: 'string' },
  'category.parentPath': { entity: 'category', kind: 'string' },
  'category.path': { entity: 'category', kind: 'string', identity: true },
  'category.visible': { entity: 'category', kind: 'boolean', default: true },
};

function validateCanonicalPath(path) {
  return Object.prototype.hasOwnProperty.call(CANONICAL_FIELDS, path);
}

function canonicalFieldsFor(entity) {
  return Object.entries(CANONICAL_FIELDS)
    .filter(([, def]) => def.entity === entity)
    .map(([path]) => path);
}

// --- Wix Stores V3 target --------------------------------------------------
// `payloadPath` is where the value lands in the create body. `via` names the structural builder
// when a field cannot be expressed as a plain path assignment (nested arrays, name-based choice
// references). Traps are recorded next to the field they bite.
const STORES_V3_TARGET = {
  entity: 'product',
  endpoint: 'POST /stores/v3/bulk/products-with-inventory/create',
  provenance: 'verified',
  // TRAP (verified 2026-07-29): the per-item results of this endpoint are nested under
  // `productResults`, unlike its flat sibling /stores/v3/bulk/products/create. Reading
  // `response.results` yields undefined AFTER the products are created.
  responseResultsPath: 'productResults.results',
  responseMetadataPath: 'productResults.bulkActionMetadata',
  fields: {
    'product.name': { payloadPath: 'name', provenance: 'verified' },
    'product.description': {
      payloadPath: 'plainDescription',
      provenance: 'verified',
      maxLength: 16000,
      // Lands as `plainDescription`, NOT `description`. Per the Products V3 schema
      // plainDescription is "Product description in HTML ... then converted to rich content" —
      // the same conversion the Ricos endpoint performed, run server-side for free. `description`
      // proper is a Ricos DOCUMENT OBJECT, so sending HTML there is a type error.
      //
      // TRAP: "plainDescription is ignored when a value is also passed to the description field."
      // Setting both is a silent no-op on a 200 response; the writer rejects it.
      // TRAP: hard cap of 16000 chars. The old Ricos path chunked at 28k and merged, so it was
      // effectively unbounded — long Woo/Magento bodies that used to survive now need truncation
      // or an info section, recorded in mapping-gaps.json.
      note: 'html-string-converted-to-ricos-by-wix',
    },
    'product.slug': { payloadPath: 'slug', provenance: 'verified', coerce: 'slug' },
    'product.brand': {
      payloadPath: 'brand',
      provenance: 'verified',
      wrap: (value) => ({ name: value }),
      note: 'brand is declared INLINE by name; bulk create resolves or creates it in the same request',
    },
    'product.visible': { payloadPath: 'visible', provenance: 'verified' },
    'product.seoTitle': { via: 'seoData', provenance: 'verified' },
    'product.seoDescription': { via: 'seoData', provenance: 'verified' },
    'product.images': { via: 'media', provenance: 'verified' },
    'variant.price': { via: 'variants', provenance: 'verified' },
    'variant.compareAtPrice': { via: 'variants', provenance: 'verified' },
    'variant.sku': { via: 'variants', provenance: 'verified' },
    'variant.weight': { via: 'variants', provenance: 'verified' },
    'variant.visible': { via: 'variants', provenance: 'verified' },
    'variant.option1.name': { via: 'options', provenance: 'verified' },
    'variant.option1.value': { via: 'options', provenance: 'verified' },
    'variant.option2.name': { via: 'options', provenance: 'verified' },
    'variant.option2.value': { via: 'options', provenance: 'verified' },
    'variant.option3.name': { via: 'options', provenance: 'verified' },
    'variant.option3.value': { via: 'options', provenance: 'verified' },
  },
  // Constants the API demands regardless of source.
  constants: {
    productType: 'PHYSICAL',
    // TRAP (verified): a PHYSICAL product requires an EMPTY physicalProperties object at product
    // level. Omitting it 400s.
    physicalProperties: {},
  },
  // Vendors express price as either (price, compareAt) like Shopify or (regular, sale) like Woo /
  // Magento / BigCommerce. Wix models `actualPrice` (what is charged) + `compareAtPrice` (the
  // strike-through), so the pair must be RESOLVED, not mapped field-for-field. Encoding the rule
  // here once removes the single most repeated per-run judgement call.
  priceResolution: {
    rule: 'when variant.discountedPrice is present and strictly less than variant.price, it becomes actualPrice and variant.price becomes compareAtPrice; otherwise variant.price is actualPrice and variant.compareAtPrice is the strike-through',
    dropCompareAtUnlessGreater: true,
    note: 'vendors write 0.00 (and Woo writes an empty sale price) to mean "no discount"; Wix rejects compareAtPrice <= actualPrice',
  },
  // Canonical fields Wix Stores V3 has no home for. Naming them here is what lets the resolver
  // report an honest "mapped but will not land" instead of silently dropping them.
  unsupported: {
    'product.tags': 'Wix Stores V3 has no product-tag field; a tag taxonomy must become categories or a CMS field.',
    'tag.name': 'Same as product.tags — no native product-tag target in Stores V3.',
    'product.sourceId': 'Identity only: tracked in the crosswalk, not written to Wix (no client-settable id).',
    'variant.parentRef': 'Identity only: used to attach a variation row to its parent during extract.',
    'product.shortDescription': 'Stores V3 has one description; a second body would need an info section (not modelled here).',
    'variant.inStock': 'Fed into inventoryItem.inStock by the variants builder rather than mapped directly.',
    'variant.image': 'Per-variant media needs Wix media ids, which only exist after ingestion; requires a follow-up patch.',
    'variant.width': 'Dimension fields on the V3 variant create shape are unverified; not mapped rather than guessed.',
    'variant.height': 'Dimension fields on the V3 variant create shape are unverified; not mapped rather than guessed.',
    'variant.length': 'Dimension fields on the V3 variant create shape are unverified; not mapped rather than guessed.',
    'image.url': 'Assembled into product.images by the adapter, then emitted via the media builder.',
    'image.altText': 'Assembled into product.images by the adapter, then emitted via the media builder.',
    'image.position': 'Ordering signal only: the first media item becomes the product main media.',
    'category.path': 'Identity only: the dedupe key and crosswalk key, not a Wix field.',
    'product.productType': 'Source product-type strings are a taxonomy, not the Wix productType enum (PHYSICAL/DIGITAL).',
    'product.ribbon': 'Ribbon is a separate inline entity; not modelled by this spec version.',
    'variant.cost': 'Cost sits behind the MERCHANT_DATA fieldset and is not settable on bulk create.',
    'variant.barcode': 'No barcode field on the V3 variant create shape.',
    'variant.inventoryPolicy': 'V3 models availability, not Shopify-style deny/continue policy.',
    'variant.requiresShipping': 'Implied by productType PHYSICAL; not separately settable.',
    'variant.taxable': 'Tax behaviour is a site-level/tax-group concern, not a variant field.',
    'variant.weightUnit': 'Weight is sent in the site weight unit; the source unit only drives conversion.',
    'variant.inventoryTracked': 'V3 inventory tracking is derived from the inventory item, not a flag.',
  },
};

const CATEGORY_TARGET = {
  entity: 'category',
  endpoint: 'POST /categories/v1/categories',
  provenance: 'verified',
  // TRAP (verified): treeReference is TOP-LEVEL, a sibling of `category`. Nesting it 400s
  // "treeReference must not be empty".
  treeReferenceIsTopLevel: true,
  fields: {
    'category.name': { payloadPath: 'name', provenance: 'verified' },
    'category.description': { payloadPath: 'description', provenance: 'verified' },
    'category.visible': { payloadPath: 'visible', provenance: 'verified' },
    'category.parentPath': {
      via: 'parentRef',
      provenance: 'verified',
      note: 'resolved through the crosswalk to parentCategory.id; requires depth-ascending create order',
    },
  },
  constants: {},
  unsupported: {},
};

const TARGETS = { product: STORES_V3_TARGET, category: CATEGORY_TARGET };

module.exports = {
  CANONICAL_FIELDS,
  STORES_V3_TARGET,
  CATEGORY_TARGET,
  TARGETS,
  validateCanonicalPath,
  canonicalFieldsFor,
};
