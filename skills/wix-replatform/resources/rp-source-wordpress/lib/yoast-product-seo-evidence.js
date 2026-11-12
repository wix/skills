'use strict';

// Per-field Yoast override evidence for WooCommerce products.
//
// `yoast_head_json` is Yoast's RENDERED output: it can carry a title for every product while the
// raw override meta holds none. Importing the rendered text turns an inherited template into
// hundreds of hard per-product overrides. So this module
// decides, per product and per field, whether the SOURCE proves an override, and records how it
// knows. Rendered output alone is never proof; it only supplies the decoded value once the raw
// meta has proven the field was overridden.
//
// Deterministic by design. The only I/O is the caller-supplied `queryPage` (a bound
// wix-wp-plugin-v2 `queryStructure`), so every branch is unit-testable offline.

const FIELD_KEYS = Object.freeze({
  title: '_yoast_wpseo_title',
  description: '_yoast_wpseo_metadesc',
  focusKeyword: '_yoast_wpseo_focuskw',
});
// Exact allow-list; never widened by key discovery.
const ALLOWED_KEYS = Object.freeze(Object.values(FIELD_KEYS));
const SEO_FIELDS = Object.freeze(Object.keys(FIELD_KEYS));
const HEAD_FIELD = Object.freeze({ title: 'title', description: 'description' });
const STATES = Object.freeze(['override', 'inherit', 'unknown']);

// A post_id list is sent inline in the `where` clause, so keep one batch well inside a request.
const DEFAULT_BRIDGE_BATCH = 50;
const MAX_BRIDGE_BATCH = 200;
const MAX_BRIDGE_PAGES = 1000;

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«',
  raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
});

// Exactly ONE decoding pass. `&amp;amp;` becomes `&amp;`, never `&`: decoding repeatedly would
// corrupt a title that legitimately contains an entity-looking string.
function decodeEntitiesOnce(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function sanitizeRendered(value) {
  if (typeof value !== 'string') return null;
  const decoded = decodeEntitiesOnce(value).trim();
  return decoded === '' ? null : decoded;
}

// Channel 1: the product post's REST `meta` object. A key counts only when `meta` contains it;
// a response without the key (not registered for the product type, or unauthenticated) leaves
// that key unresolved -- never "no override" -- so it can fall through to the bridge.
function restEvidence({ response, path = null } = {}) {
  const meta = response && typeof response.meta === 'object' && !Array.isArray(response.meta) ? response.meta : null;
  const out = {};
  for (const key of ALLOWED_KEYS) {
    if (meta && Object.prototype.hasOwnProperty.call(meta, key)) {
      out[key] = { resolved: true, raw: meta[key], evidenceRef: { path, keyPresentInMeta: true } };
    } else {
      out[key] = { resolved: false, reason: meta ? 'key-absent-from-rest-meta' : 'rest-meta-unavailable', evidenceRef: { path } };
    }
  }
  return out;
}

function pinnedKeysOf(eavAccess, keyColumn) {
  if (!eavAccess) return null;
  const pairs = [eavAccess, ...(eavAccess.additionalPairs || [])];
  const pair = pairs.find((p) => p && p.keyColumn === keyColumn);
  if (!pair || pair.tier !== 'key-scoped' || !Array.isArray(pair.pinnedKeys)) return null;
  return pair.pinnedKeys;
}

// Channel 2: wix-wp-plugin-v2 key-scoped postmeta read, paginated to exhaustion.
// `queryPage({ structureRequest, cursor })` resolves to queryStructure's `{ rows, pagingMetadata,
// eavAccess }`. A batch is COMPLETE only when every page succeeded, the response proved a
// key-scoped read of every queried key, and the last page reported no next cursor. Anything else
// leaves the batch incomplete -- and only that batch.
async function readBridgeEvidence({ queryPage, table, productIds, keys = ALLOWED_KEYS, batchSize = DEFAULT_BRIDGE_BATCH, keyColumn = 'meta_key', valueColumn = 'meta_value', idColumn = 'post_id', orderColumn = 'meta_id' } = {}) {
  if (typeof queryPage !== 'function') throw new Error('readBridgeEvidence: queryPage is required');
  if (!table || typeof table !== 'string') throw new Error('readBridgeEvidence: table (the prefixed postmeta table) is required');
  if (!Array.isArray(productIds)) throw new Error('readBridgeEvidence: productIds must be an array');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BRIDGE_BATCH) {
    throw new Error(`readBridgeEvidence: batchSize must be 1..${MAX_BRIDGE_BATCH}`);
  }
  const wanted = [...new Set(keys)];
  if (!wanted.length || wanted.some((key) => !ALLOWED_KEYS.includes(key))) {
    throw new Error(`readBridgeEvidence: keys must be a non-empty subset of ${ALLOWED_KEYS.join(', ')}`);
  }
  const ids = [...new Set(productIds.map(String))];
  const batches = [];
  for (let start = 0, index = 0; start < ids.length; start += batchSize, index += 1) {
    const batchIds = ids.slice(start, start + batchSize);
    const structureRequest = {
      table,
      select: [{ column: orderColumn }, { column: idColumn }, { column: keyColumn }, { column: valueColumn }],
      where: [
        { column: keyColumn, op: 'in', value: wanted },
        { column: idColumn, op: 'in', value: batchIds.map((id) => (/^\d+$/.test(id) ? Number(id) : id)) },
      ],
      orderBy: [{ column: orderColumn, direction: 'asc' }],
    };
    const batch = { batchId: `yoast-bridge-${index}`, productIds: batchIds, keys: wanted, pageCount: 0, complete: false, finalHasNext: null, reason: null, failedPage: null, rows: [] };
    let cursor;
    for (;;) {
      if (batch.pageCount >= MAX_BRIDGE_PAGES) { batch.reason = 'page-limit-exceeded'; break; }
      let page;
      try {
        page = await queryPage({ structureRequest, cursor });
      } catch (error) {
        batch.failedPage = batch.pageCount + 1;
        batch.reason = `page ${batch.failedPage} failed: ${error && error.message ? error.message : String(error)}`;
        break;
      }
      batch.pageCount += 1;
      const pinned = pinnedKeysOf(page && page.eavAccess, keyColumn);
      if (!pinned || wanted.some((key) => !pinned.includes(key))) {
        batch.failedPage = batch.pageCount;
        batch.reason = `page ${batch.pageCount} did not prove a key-scoped read of every queried key`;
        break;
      }
      if (!page || !Array.isArray(page.rows) || !page.pagingMetadata || typeof page.pagingMetadata.hasNext !== 'boolean') {
        batch.failedPage = batch.pageCount;
        batch.reason = `page ${batch.pageCount} had no rows/pagingMetadata`;
        break;
      }
      for (const row of page.rows) {
        batch.rows.push({ productId: String(row[idColumn]), key: row[keyColumn], value: row[valueColumn] });
      }
      batch.finalHasNext = page.pagingMetadata.hasNext;
      if (!page.pagingMetadata.hasNext) { batch.complete = true; break; }
      const next = page.pagingMetadata.cursors && page.pagingMetadata.cursors.next;
      if (!next) { batch.reason = `page ${batch.pageCount} reported hasNext without a cursor (truncated)`; break; }
      cursor = next;
    }
    batches.push(batch);
  }
  return batches;
}

function resolveOverrideValue(field, raw, yoastHeadJson) {
  if (field === 'focusKeyword') return { value: String(raw).trim() };
  const rendered = sanitizeRendered(yoastHeadJson && yoastHeadJson[HEAD_FIELD[field]]);
  if (rendered !== null) return { value: rendered };
  const trimmed = String(raw).trim();
  if (!trimmed.includes('%%')) return { value: trimmed };
  return { unknown: 'override-has-yoast-variables-and-no-resolved-value' };
}

// The per-product audit receipt. It is stored with the extraction and is NOT hashed as a
// whole; only `seoHashProjection` (rp-target-wix/lib/product-seo.js) feeds the source hash.
function buildProductSeoReceipt({ productId, capturedAt, rest = null, bridgeBatch = null, yoastHeadJson = null } = {}) {
  if (productId == null || String(productId) === '') throw new Error('buildProductSeoReceipt: productId is required');
  if (!capturedAt) throw new Error('buildProductSeoReceipt: capturedAt is required');
  const id = String(productId);
  const fields = {};
  for (const field of SEO_FIELDS) {
    const key = FIELD_KEYS[field];
    const failures = [];
    let raw;
    let provenance = null;
    const restKey = rest && rest[key];
    if (restKey && restKey.resolved) {
      raw = restKey.raw;
      provenance = { channel: 'rest', readComplete: true, evidenceRef: { path: restKey.evidenceRef.path, keyPresentInMeta: true } };
    } else {
      failures.push(restKey ? `rest: ${restKey.reason}` : 'rest: not read');
      if (bridgeBatch && bridgeBatch.complete && bridgeBatch.productIds.includes(id) && bridgeBatch.keys.includes(key)) {
        const row = bridgeBatch.rows.find((r) => r.productId === id && r.key === key);
        raw = row ? row.value : undefined;
        provenance = {
          channel: 'bridge',
          readComplete: true,
          evidenceRef: { batchId: bridgeBatch.batchId, productIds: bridgeBatch.productIds, pageCount: bridgeBatch.pageCount, finalHasNext: false, rowPresent: Boolean(row) },
        };
      } else {
        failures.push(!bridgeBatch ? 'bridge: unavailable' : `bridge: ${bridgeBatch.reason || 'key not read for this product'}`);
      }
    }
    if (!provenance) {
      fields[field] = { state: 'unknown', rawPresent: false, provenance: { channel: 'none', readComplete: false, evidenceRef: { failures } } };
      continue;
    }
    const rawPresent = raw !== undefined && raw !== null;
    if (!rawPresent || isBlank(raw)) {
      fields[field] = { state: 'inherit', rawPresent, provenance };
      continue;
    }
    const resolved = resolveOverrideValue(field, raw, yoastHeadJson);
    if (resolved.unknown) {
      fields[field] = { state: 'unknown', rawPresent, provenance: { ...provenance, evidenceRef: { ...provenance.evidenceRef, failures: [resolved.unknown] } } };
    } else {
      fields[field] = { state: 'override', rawPresent, value: resolved.value, provenance };
    }
  }
  return { productId: id, capturedAt, fields };
}

// Receipts for a whole extraction. `products` rows: { id, yoast_head_json?, restResponse?,
// restPath? }. `bridgeBatches` is readBridgeEvidence's output (or [] when the bridge is absent).
function buildProductSeoReceipts({ products, bridgeBatches = [], capturedAt } = {}) {
  if (!Array.isArray(products)) throw new Error('buildProductSeoReceipts: products must be an array');
  const batchFor = new Map();
  for (const batch of bridgeBatches || []) for (const id of batch.productIds) batchFor.set(String(id), batch);
  return products.map((product) => buildProductSeoReceipt({
    productId: product.id,
    capturedAt,
    rest: product.restResponse ? restEvidence({ response: product.restResponse, path: product.restPath || null }) : null,
    bridgeBatch: batchFor.get(String(product.id)) || null,
    yoastHeadJson: product.yoast_head_json || null,
  }));
}

// Canonical-record projection of a receipt (`product.seoEvidence`). `rendered` carries the
// sanitized rendered title/description ONLY so an owner's `materialize` choice has a value to
// write; it is never proof and never written without that choice.
function seoEvidenceFromReceipt(receipt, { yoastHeadJson = null, permalink = null } = {}) {
  const out = {};
  for (const field of SEO_FIELDS) {
    const f = receipt.fields[field];
    out[field] = f.state === 'override' ? { state: 'override', value: f.value } : { state: f.state };
  }
  out.rendered = {
    title: sanitizeRendered(yoastHeadJson && yoastHeadJson.title),
    description: sanitizeRendered(yoastHeadJson && yoastHeadJson.description),
  };
  out.canonical = classifyProductCanonical(yoastHeadJson, permalink);
  return out;
}

// A computed self-canonical (the product's own source permalink) is never written: Wix
// generates its own. A canonical pointing anywhere else may be intentional, but REST cannot prove
// it and no policy for foreign canonicals is approved, so it is flagged, never written.
function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    return `${url.host.toLowerCase()}${decodeURI(url.pathname).replace(/\/+$/, '')}`;
  } catch (e) {
    return null;
  }
}
function classifyProductCanonical(yoastHeadJson, permalink) {
  const canonical = yoastHeadJson && yoastHeadJson.canonical;
  if (isBlank(canonical)) return 'none';
  if (permalink && normalizeUrl(canonical) && normalizeUrl(canonical) === normalizeUrl(permalink)) return 'self';
  return 'pending_policy';
}

module.exports = {
  FIELD_KEYS,
  ALLOWED_KEYS,
  SEO_FIELDS,
  STATES,
  DEFAULT_BRIDGE_BATCH,
  decodeEntitiesOnce,
  restEvidence,
  readBridgeEvidence,
  buildProductSeoReceipt,
  buildProductSeoReceipts,
  seoEvidenceFromReceipt,
  classifyProductCanonical,
};
