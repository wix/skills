#!/usr/bin/env node
'use strict';

// Public-only Shopify quick-mode capture. It intentionally has no credential, browser, or
// endpoint-fallback path. All product-specific writes go through rp-target-wix.
const capabilities = require('../../../lib/execution-capability');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ADAPTER_DIR = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(ADAPTER_DIR, 'quick-mode.json');
const CONTRACT = require(CONTRACT_PATH);
const sourceCoverage = require(path.join(ADAPTER_DIR, '..', '..', 'lib', 'source-coverage.js'));
const { buildProduct, toWixSlug } = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-build.js'));
const inventory = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'stores-inventory.js'));
const recovery = require(path.join(ADAPTER_DIR, '..', 'rp-quick-runtime', 'lib', 'limit-recovery.js'));
const importProgress = require(path.join(ADAPTER_DIR, '..', 'rp-quick-runtime', 'lib', 'import-progress.js'));

const verification = require('../../rp-target-wix/lib/write-verification');
const verificationState = require('../../../lib/write-verification-state');
const PRODUCT_LIMIT = 250;
const MAX_DESCRIPTION_LENGTH = 16000;
// Requests stay serial and paced; a full catalog is a handful of pages, so a short delay is
// enough. Retries back off exponentially (or by retry-after) up to the cap below.
const SOURCE_REQUEST_DELAY_MS = 300;
// One first call plus at most six retries per request; every wait and every call is capped.
const SOURCE_MAX_RETRIES = 6;
const SOURCE_MAX_BACKOFF_MS = 30000;
const SOURCE_CALL_TIMEOUT_MS = 30000;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
async function writeNdjson(file, rows) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')); }
async function readNdjson(file) { const raw = await fs.readFile(file, 'utf8'); return raw.split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function sourceOrigin(value) { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('sourceUrl must use http or https'); return url.origin; }
function text(value) { return String(value == null ? '' : value).trim(); }
function validPrice(value) { const amount = Number(value); return Number.isFinite(amount) && amount >= 0; }
function file(projectDir, name) { return path.join(projectDir, 'data', 'source-extract', `${name}.ndjson`); }
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function context(projectDir) {
  const decisions = await readJson(path.join(projectDir, 'orchestration', 'decisions.json'));
  const sourceUrl = decisions.sourceUrl && decisions.sourceUrl.value;
  const platform = decisions.sourcePlatform && decisions.sourcePlatform.value;
  if (!sourceUrl) throw new Error('quick mode requires orchestration.decisions.sourceUrl');
  if (platform !== 'shopify') throw new Error(`quick Shopify adapter requires sourcePlatform=shopify (got ${platform || 'missing'})`);
  return { sourceUrl: sourceOrigin(sourceUrl) };
}

// Tokenless Storefront GraphQL. A single paginated product query carries each product's
// variants, images, and collection memberships, so membership costs no per-collection
// requests. Records are normalized to the storefront-JSON row shape the import consumes.
const STOREFRONT_API_VERSION = CONTRACT.storefrontApiVersion;
const PRODUCT_CONNECTION = 'variants(first: 100) { pageInfo { hasNextPage endCursor } nodes { id title sku availableForSale price { amount } compareAtPrice { amount } selectedOptions { name value } } }';
const IMAGE_CONNECTION = 'images(first: 20) { pageInfo { hasNextPage endCursor } nodes { url altText } }';
const MEMBERSHIP_CONNECTION = 'collections(first: 50) { pageInfo { hasNextPage endCursor } nodes { id } }';
const PRODUCTS_QUERY = `query QuickProducts($first: Int!, $after: String) { products(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id handle title vendor productType tags descriptionHtml publishedAt options { name optionValues { name } } ${IMAGE_CONNECTION} ${MEMBERSHIP_CONNECTION} ${PRODUCT_CONNECTION} } } }`;
const COLLECTIONS_QUERY = 'query QuickCollections($first: Int!, $after: String) { collections(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id handle title descriptionHtml updatedAt } } }';
// A product whose nested list exceeds the first page is completed through its own cursor.
const NESTED_QUERIES = {
  variants: 'query QuickVariants($id: ID!, $after: String) { product(id: $id) { variants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id title sku availableForSale price { amount } compareAtPrice { amount } selectedOptions { name value } } } } }',
  images: 'query QuickImages($id: ID!, $after: String) { product(id: $id) { images(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { url altText } } } }',
  collections: 'query QuickMemberships($id: ID!, $after: String) { product(id: $id) { collections(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } } }',
};
const RETRYABLE_GRAPHQL_CODES = new Set(['THROTTLED', 'INTERNAL_SERVER_ERROR']);
// Everything time- or network-dependent goes through `io` so tests can drive the retry contract
// with a fake clock and a scripted fetch instead of real waits.
const defaultIo = { fetch: (...args) => fetch(...args), sleep, now: () => Date.now(), timeoutMs: SOURCE_CALL_TIMEOUT_MS };

function storefrontEndpoint(origin) { return new URL(`/api/${STOREFRONT_API_VERSION}/graphql.json`, `${origin}/`).toString(); }
function legacyId(gid) { const match = /\/(\d+)$/.exec(text(gid)); return match ? match[1] : text(gid); }
function amount(money) { return money && money.amount != null ? String(money.amount) : null; }
// Wait before retry n (1..6): a server-requested wait (delta-seconds or HTTP-date) is honoured but
// clamped to [0, 30 s]; otherwise min(30 s, 1 s * 2^n). An unparseable header falls back to the latter.
function retryWaitMs(retry, retryAfterHeader, nowMs) {
  const exponential = Math.min(SOURCE_MAX_BACKOFF_MS, 1000 * 2 ** retry);
  const raw = retryAfterHeader == null ? '' : String(retryAfterHeader).trim();
  if (!raw) return exponential;
  let requested = null;
  if (/^\d+(\.\d+)?$/.test(raw)) requested = Number(raw) * 1000;
  else { const date = Date.parse(raw); if (Number.isFinite(date)) requested = date - nowMs; }
  return requested === null ? exponential : Math.min(SOURCE_MAX_BACKOFF_MS, Math.max(0, requested));
}
// Transient throttles, 5xx responses, dropped connections and hung calls are retried; anything else is data.
async function storefrontQuery(endpoint, query, variables, io = defaultIo) {
  let last = null;
  for (let attempt = 0; attempt <= SOURCE_MAX_RETRIES; attempt += 1) {
    if (attempt) await io.sleep(retryWaitMs(attempt, last.retryAfter, io.now()));
    let response;
    try { response = await io.fetch(endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(io.timeoutMs) }); } catch (error) { last = { ok: false, status: 0, responseShape: error && error.name === 'TimeoutError' ? 'timeout' : 'network_error', errorCodes: [], error: error && error.message, retryAfter: null, attempts: attempt + 1 }; continue; }
    let bodyText = ''; try { bodyText = await response.text(); } catch (error) { last = { ok: false, status: 0, responseShape: error && error.name === 'TimeoutError' ? 'timeout' : 'network_error', errorCodes: [], error: error && error.message, retryAfter: null, attempts: attempt + 1 }; continue; }
    let body = null; try { body = bodyText ? JSON.parse(bodyText) : null; } catch { /* shape checked below */ }
    const errorCodes = (body && Array.isArray(body.errors) ? body.errors : []).map((error) => error && error.extensions && error.extensions.code).filter(Boolean);
    const clean = response.ok && body && body.data && !errorCodes.length && !(body.errors || []).length;
    last = { ok: Boolean(clean), status: response.status, body, errorCodes, responseShape: body && body.data ? 'object.data' : typeof body, retryAfter: response.headers.get('retry-after'), attempts: attempt + 1 };
    if (last.ok) return last;
    const retryable = response.status === 429 || response.status >= 500 || errorCodes.some((code) => RETRYABLE_GRAPHQL_CODES.has(code));
    if (!retryable) break;
  }
  return { ...last, ok: false };
}
function blockedFetch(endpoint, key, page, result, records, pages) { return { ok: false, status: result.status, url: endpoint, responseShape: result.ok ? 'missing_connection' : result.responseShape, errorCodes: result.errorCodes || [], attempts: result.attempts, connection: key, page, records, pages }; }
async function fetchConnection(endpoint, query, key, first, io, variables = {}) {
  const records = []; const pages = []; let after = null;
  for (let page = 1; ; page += 1) {
    const result = await storefrontQuery(endpoint, query, { ...variables, first, after }, io);
    const connection = result.ok ? result.body.data[key] : null;
    if (!connection || !Array.isArray(connection.nodes)) return blockedFetch(endpoint, key, page, result, records, pages);
    records.push(...connection.nodes); pages.push({ page, count: connection.nodes.length, cost: result.body.extensions && result.body.extensions.cost ? result.body.extensions.cost.requestedQueryCost : null });
    if (!connection.pageInfo || !connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (page >= 10000) return { ok: false, status: 508, url: endpoint, responseShape: 'pagination_limit', errorCodes: [], attempts: 0, connection: key, page, records, pages };
    await io.sleep(SOURCE_REQUEST_DELAY_MS);
  }
  return { ok: true, url: endpoint, records, pages };
}
async function completeNested(endpoint, node, field, io) {
  const first = node[field];
  if (!first || !first.pageInfo || !first.pageInfo.hasNextPage) return { ok: true, nodes: first ? first.nodes : [] };
  const nodes = [...first.nodes]; let after = first.pageInfo.endCursor;
  while (after) {
    await io.sleep(SOURCE_REQUEST_DELAY_MS);
    const result = await storefrontQuery(endpoint, NESTED_QUERIES[field], { id: node.id, after }, io);
    const connection = result.ok && result.body.data.product ? result.body.data.product[field] : null;
    if (!connection) return { ok: false, status: result.status, responseShape: result.ok ? 'missing_connection' : result.responseShape, errorCodes: result.errorCodes || [], attempts: result.attempts };
    nodes.push(...connection.nodes); after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  }
  return { ok: true, nodes };
}
function toProductRow(node, variants, images) {
  const options = (node.options || []).map((option, index) => ({ name: option.name, position: index + 1, values: (option.optionValues || []).map((value) => value.name) }));
  return {
    id: legacyId(node.id), handle: node.handle, title: node.title, body_html: node.descriptionHtml || '', vendor: node.vendor, product_type: node.productType,
    tags: node.tags || [], published_at: node.publishedAt || null,
    images: images.map((image) => ({ src: image.url, alt: image.altText || null })),
    options,
    variants: variants.map((variant) => {
      const row = { id: legacyId(variant.id), title: variant.title, sku: variant.sku, price: amount(variant.price), compare_at_price: amount(variant.compareAtPrice), available: variant.availableForSale };
      options.forEach((option, index) => { const selected = (variant.selectedOptions || []).find((entry) => entry.name === option.name); row[`option${index + 1}`] = selected ? selected.value : null; });
      return row;
    }),
  };
}
async function captureSource(origin, io = defaultIo) {
  const endpoint = storefrontEndpoint(origin);
  const productNodes = await fetchConnection(endpoint, PRODUCTS_QUERY, 'products', PRODUCT_LIMIT, io);
  const memberships = []; const membershipChecks = [];
  const products = { ...productNodes, records: [] };
  // A blocked product read ends the capture: nothing downstream can be trusted, and the retry budget is spent.
  if (!productNodes.ok) return { products, collections: { ok: false, status: 0, url: endpoint, responseShape: 'not_attempted', errorCodes: [], attempts: 0, records: [], pages: [] }, memberships, membershipChecks };
  const collectionNodes = await fetchConnection(endpoint, COLLECTIONS_QUERY, 'collections', PRODUCT_LIMIT, io);
  for (const node of productNodes.records) {
    const [variants, images, collections] = [await completeNested(endpoint, node, 'variants', io), await completeNested(endpoint, node, 'images', io), await completeNested(endpoint, node, 'collections', io)];
    const incomplete = [['variants', variants], ['images', images], ['collections', collections]].filter(([, result]) => !result.ok);
    if (incomplete.length) { const [field, result] = incomplete[0]; membershipChecks.push({ productId: legacyId(node.id), ok: false, status: result.status, responseShape: `incomplete_${incomplete.map(([name]) => name).join('_')}`, errorCodes: result.errorCodes || [], attempts: result.attempts, connection: field }); continue; }
    products.records.push(toProductRow(node, variants.nodes, images.nodes));
    for (const collection of collections.nodes) memberships.push({ collectionId: legacyId(collection.id), productId: legacyId(node.id) });
  }
  const collections = { ...collectionNodes, records: collectionNodes.records.map((node) => ({ id: legacyId(node.id), handle: node.handle, title: node.title, body_html: node.descriptionHtml || '', updated_at: node.updatedAt || null })) };
  return { products, collections, memberships, membershipChecks };
}
// A blocked read is recorded with everything an operator needs: the connection, the page, the
// last status, the GraphQL error codes and how many calls were made.
function blockedDetail(source) { return { errorCodes: source.errorCodes || [], attempts: source.attempts == null ? 0 : source.attempts, connection: source.connection || null, page: source.page == null ? null : source.page }; }
async function preflight(projectDir, io = defaultIo) {
  const { sourceUrl } = await context(projectDir); const data = await captureSource(sourceUrl, io);
  const readCheck = (entity, source, shape) => ({ entity, ok: source.ok, status: source.status == null ? 200 : source.status, url: source.url || null, responseShape: source.ok ? shape : source.responseShape, ...(source.ok ? {} : blockedDetail(source)), pages: source.pages.length, records: source.records.length });
  const checks = [
    readCheck('product', data.products, 'data.products.nodes[]'),
    readCheck('collection', data.collections, 'data.collections.nodes[]'),
    { entity: 'collection_product', ok: data.products.ok && data.membershipChecks.every((check) => check.ok), status: data.products.status == null ? 200 : data.products.status, url: data.products.url || null, responseShape: 'data.products.nodes[].collections', records: data.memberships.length },
    ...data.membershipChecks.filter((check) => !check.ok).map((check) => ({ entity: 'product', ...check })),
  ];
  const adapter = { id: CONTRACT.id, version: CONTRACT.version, fingerprint: hash(CONTRACT) };
  const out = { schemaVersion: 1, generatedAt: new Date().toISOString(), adapter, sourceUrl, status: checks.every((check) => check.ok) ? 'passed' : 'blocked', checks };
  await writeJson(path.join(projectDir, 'quick-mode', 'preflight.json'), out);
  if (out.status === 'passed') await writeJson(path.join(projectDir, 'quick-mode', 'preflight-capture.json'), { schemaVersion: 1, generatedAt: out.generatedAt, adapter, sourceUrl, data });
  return out;
}
async function plan(projectDir) {
  const { sourceUrl } = await context(projectDir); const preflightResult = await readJson(path.join(projectDir, 'quick-mode', 'preflight.json'));
  if (preflightResult.status !== 'passed') throw new Error('quick mode preflight must pass before planning');
  const adapter = { id: CONTRACT.id, version: CONTRACT.version, fingerprint: hash(CONTRACT) };
  const generatedAt = new Date().toISOString();
  // Every excluded[] capability becomes a declared-exclusion coverage row, checked by the same
  // reconcile rule as a full run before the plan is written.
  const coverage = await sourceCoverage.writeQuickPlanCoverage(projectDir, CONTRACT, { rawText: await fs.readFile(CONTRACT_PATH, 'utf8'), generatedAt });
  const out = { schemaVersion: 1, generatedAt, managementImportMode: 'quick', adapter, sourceUrl, entities: CONTRACT.entities, requiredWixCapabilities: CONTRACT.requiredWixCapabilities, excluded: CONTRACT.excluded, excludedCapabilities: CONTRACT.excludedCapabilities, sourceAuth: 'none', sourceCoverageContract: coverage.sourceCoverageContract };
  await writeJson(path.join(projectDir, 'quick-mode', 'plan.json'), out);
  await fs.writeFile(path.join(projectDir, 'quick-mode', 'plan.md'), `# Shopify quick-mode plan\n\nAdapter: ${adapter.id} ${adapter.version}\n\nImported: collections, products, variants, tags, media, and collection membership.\n\nExcluded: ${CONTRACT.excluded.join(', ')}.\n`);
  await writeJson(path.join(projectDir, 'execution', 'execution-manifest.json'), { schemaVersion: 1, generatedAt: out.generatedAt, managementImportMode: 'quick', adapter, extractCommand: 'rp-quick-shopify extract', importCommand: 'rp-quick-shopify import', entities: CONTRACT.entities.map((entity) => entity.id) });
  return out;
}
async function extract(projectDir, io = defaultIo) {
  const { sourceUrl } = await context(projectDir); const planResult = await readJson(path.join(projectDir, 'quick-mode', 'plan.json'));
  if (planResult.adapter.fingerprint !== hash(CONTRACT)) throw new Error('quick adapter contract changed; re-run preflight and plan');
  let data;
  try {
    const capture = await readJson(path.join(projectDir, 'quick-mode', 'preflight-capture.json'));
    if (capture.adapter?.fingerprint === planResult.adapter.fingerprint && capture.sourceUrl === sourceUrl) data = capture.data;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data) data = await captureSource(sourceUrl, io);
  if (!data.products.ok || !data.collections.ok || !data.membershipChecks.every((check) => check.ok)) throw new Error('source changed after preflight; re-run preflight before extracting');
  await writeNdjson(file(projectDir, 'product'), data.products.records);
  const knownProductIds = new Set(data.products.records.map((row) => String(row.id)));
  const edges = data.memberships.filter((edge) => knownProductIds.has(edge.productId));
  // Only collections that contain an extracted product become categories: Wix Stores caps a
  // site at 1,000 categories, and an empty source collection would spend a slot on nothing.
  const populated = new Set(edges.map((edge) => edge.collectionId));
  const collections = data.collections.records.filter((row) => populated.has(String(row.id)));
  await writeNdjson(file(projectDir, 'collection'), collections);
  await writeNdjson(file(projectDir, 'collection_product'), edges);
  const entities = {
    product: { file: 'data/source-extract/product.ndjson', recordCount: data.products.records.length, pages: data.products.pages },
    collection: { file: 'data/source-extract/collection.ndjson', recordCount: collections.length, sourceCount: data.collections.records.length, excludedEmptyCount: data.collections.records.length - collections.length, excluded: data.collections.records.filter((row) => !populated.has(String(row.id))).map((row) => ({ sourceId: String(row.id), handle: row.handle, title: row.title })), pages: data.collections.pages },
    collection_product: { file: 'data/source-extract/collection_product.ndjson', recordCount: edges.length, sourceOnlyCount: data.memberships.length - edges.length },
  };
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter: planResult.adapter, sourceUrl, entities };
  await writeJson(path.join(projectDir, 'data', 'source-extract', 'manifest.json'), manifest); return manifest;
}
async function loadWixEnv(projectDir) { const values = {}; try { for (const line of (await fs.readFile(path.join(projectDir, 'config', 'wix.env'), 'utf8')).split(/\r?\n/)) { const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/); if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim(); } } catch (error) { if (error.code !== 'ENOENT') throw error; } return { ...values, ...process.env }; }
async function loadCrosswalk(projectDir) { try { return await readJson(path.join(projectDir, 'state', 'crosswalk', 'quick-shopify.json')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }
function canonicalProduct(row) {
  if (!text(row.id) || !text(row.title) || !text(row.handle)) throw new Error('missing product id, title, or handle');
  if (text(row.body_html).length > MAX_DESCRIPTION_LENGTH) throw new Error('description exceeds Wix limit');
  const names = (row.options || []).map((option) => text(option.name)).filter((name) => name && name.toLowerCase() !== 'title');
  if (names.length > 3) throw new Error('more than three options');
  const variants = (row.variants || []).map((variant) => {
    if (!text(variant.id) || !validPrice(variant.price)) throw new Error('invalid variant id or price');
    if (typeof variant.available !== 'boolean') throw new Error('variant availability must be explicit true or false');
    const choices = names.map((optionName, index) => ({ optionName, choiceName: text(variant[`option${index + 1}`]) })).filter((choice) => choice.choiceName);
    if (choices.length !== names.length) throw new Error('variant option values do not match product options');
    return { sku: text(variant.sku) || undefined, price: variant.price, compareAtPrice: validPrice(variant.compare_at_price) ? variant.compare_at_price : undefined, visible: variant.available !== false, inStock: variant.available, inventoryTracked: false, choices };
  });
  if (!variants.length) throw new Error('product has no variants');
  return { name: text(row.title), slug: toWixSlug(row.handle), description: text(row.body_html) || undefined, visible: Boolean(row.published_at), optionNames: names, variants, images: (row.images || []).map((image) => ({ url: image.src, altText: image.alt || undefined })).filter((image) => text(image.url)) };
}
// Correlate by option/choice names resolved through target IDs, never response position or SKU.
const { resolveInventoryRows } = require('../../rp-target-wix/lib/variant-correlation');

// LIVE-VERIFIED (2026-10-15): a product read immediately after its create can 404 although the
// product exists and is listed under the same id moments later. Retry only that 404, briefly;
// every other error, and a 404 that persists, still fails the row.
const READ_AFTER_CREATE_DELAYS_MS = [500, 1500, 3000];
async function readCreatedProduct(writers, wix, id, delays = READ_AFTER_CREATE_DELAYS_MS) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await writers.getStoresProductForVerification(wix, id); } catch (error) {
      if (!/\b404\b/.test(error.message) || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}

// Category capacity. Pure: callers decide where the answer is written.
// `existingCount` already includes the undeletable All Products category.
function categoryCapacity({ existingCount, rows, seen, existingSlugs }) {
  const toCreate = recovery.countCategoriesToCreate({ rows, seen, existingSlugs, slugOf: toWixSlug });
  return { toCreate, existingCount, max: recovery.STORES_CATEGORIES_MAX, exceeds: existingCount + toCreate > recovery.STORES_CATEGORIES_MAX };
}
// Live: the queried count, plus the built-in All Products category when the query did not return it
// under its canonical slug. If it comes back under another slug this refuses one slot early.
function liveExistingCount(existingCategories) { return existingCategories.size + (existingCategories.has('all-products') ? 0 : 1); }
function assertCategoryCapacity({ existingCount, rows, seen, existingSlugs }) {
  const capacity = categoryCapacity({ existingCount, rows, seen, existingSlugs });
  if (capacity.exceeds) throw new Error(`Wix Stores category limit: site has ${existingCount} categories and this import must create ${capacity.toCreate} more (max ${capacity.max} per site)`);
  return capacity.toCreate;
}

// The payload and read-back comparison the import and the re-check share, so a re-check applies
// exactly the same rules the import did.
function buildProductPayload(row, tagIds) {
  const canonical = canonicalProduct(row);
  const payload = buildProduct(canonical);
  const normalized = recovery.normalizeProduct({ sourceId: row.id, sku: payload.variantsInfo.variants[0]?.sku || '', tagIds: (row.tags || []).map((name) => tagIds.get(text(name).toLowerCase())).filter(Boolean) });
  payload.variantsInfo.variants.forEach((variant) => { if (variant.sku) variant.sku = recovery.truncate(variant.sku, recovery.STORES_SKU_MAX, `${row.id}:${variant.sku}`); });
  payload.tags = { publicTags: { tagIds: normalized.tagIds } };
  // This endpoint creates only the product. Stock is written by the reconciler.
  for (const variant of payload.variantsInfo.variants) delete variant.inventoryItem;
  return { canonical, payload, normalized };
}
function verifyWrittenProduct(writers, { row, canonical, payload, fullTarget, targetId, siteId }) {
  const correspondence = resolveInventoryRows(canonical, fullTarget);
  const expected = { ...writers.buildCreateStoresProductRequest(payload).body.product };
  delete expected.options; delete expected.variantsInfo;
  const variants = correspondence.map((entry, index) => {
    const fields = { ...payload.variantsInfo.variants[index] };
    delete fields.choices;
    return { variantId: entry.variantId, expected: fields };
  });
  const receipt = verification.receipt({ siteId, sourceKey: String(row.id), kind: 'product', expected, actual: fullTarget, targetId, marker: { path: 'slug', value: payload.slug }, variants, operation: 'quick-shopify-product' });
  return { receipt, correspondence };
}
const failedFieldsOf = (receipt) => [...new Set((receipt.checks || []).filter((check) => !check.matches).map((check) => check.path))];
function deriveStatus(summary) {
  if (summary.dryRun) return 'simulated';
  if (summary.inventory && summary.inventory.status === 'no-data') return 'no-data';
  return summary.inventory && summary.inventory.complete && Object.values(summary.skipped || {}).every((rows) => !rows.length) ? 'complete' : 'partial';
}

// ---- Re-check of written-unverified products ----
const QM_DIR = 'quick-mode';
const REVERIFY_REQUEST = `${QM_DIR}/reverify-request.json`;
const REVERIFY_RECEIPT = `${QM_DIR}/reverification.json`;
const REVERIFY_STAGED = `${QM_DIR}/reverification-staged.json`;
const COMPLETION_REPORT = 'execution/completion-report.json';
async function readJsonIfPresent(file) { try { return await readJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function writeJsonAtomic(file, value) { await recovery.writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`); }
async function removeIfPresent(file) { try { await fs.rm(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
// A staged result whose request has no matching receipt is unfinished publication.
async function pendingReverification(projectDir) {
  const request = await readJsonIfPresent(path.join(projectDir, REVERIFY_REQUEST));
  if (!request) return { request: null, receipt: null, staged: null, done: false };
  const receipt = await readJsonIfPresent(path.join(projectDir, REVERIFY_RECEIPT));
  const staged = await readJsonIfPresent(path.join(projectDir, REVERIFY_STAGED));
  return { request, receipt, staged, done: Boolean(receipt && receipt.requestId === request.requestId) };
}
async function requestReverify(projectDir) {
  const completion = await readJsonIfPresent(path.join(projectDir, COMPLETION_REPORT));
  if (!completion) throw new Error('no live completion report: nothing to re-check');
  const pending = await pendingReverification(projectDir);
  if (pending.request && !pending.done && pending.staged && pending.staged.requestId === pending.request.requestId) throw new Error('a re-check result is staged but not yet published: route the project first so it can finish');
  if (!((completion.writtenUnverified && completion.writtenUnverified.product) || []).length) throw new Error('the completion report lists no written-unverified products: nothing to re-check');
  await removeIfPresent(path.join(projectDir, REVERIFY_STAGED));
  const request = { schemaVersion: 1, requestId: crypto.randomUUID(), requestedAt: new Date().toISOString() };
  await writeJsonAtomic(path.join(projectDir, REVERIFY_REQUEST), request);
  return { status: 'requested', requestId: request.requestId };
}
// Pure replay of the staged result. Every step SETS values (never removes items), so running it
// again after a crash at any boundary converges on the same bytes. The receipt is last.
async function finalizeReverification(projectDir, staged, hooks = {}) {
  if (!staged.verificationProduct) throw new Error('staged re-check result omitted product verification evidence');
  const report = path.join(projectDir, COMPLETION_REPORT);
  const completion = await readJson(report);
  completion.writtenUnverified = { ...(completion.writtenUnverified || {}), product: staged.writtenUnverified };
  completion.skipped = { ...(completion.skipped || {}), product: staged.skippedProduct };
  completion.imported = { ...(completion.imported || {}), product: staged.importedProduct };
  completion.verification = { ...(completion.verification || {}), product: staged.verificationProduct };
  completion.status = staged.status;
  await writeJsonAtomic(report, completion);
  if (hooks.afterCompletionReport) await hooks.afterCompletionReport();
  await recovery.writeFinalReport(projectDir, completion, { dryRun: false });
  if (hooks.afterFinalReport) await hooks.afterFinalReport();
  await writeJsonAtomic(path.join(projectDir, REVERIFY_RECEIPT), { schemaVersion: 1, requestId: staged.requestId, completedAt: staged.completedAt, checked: staged.checked, cleared: staged.cleared, remaining: staged.remaining, errors: staged.errors });
  if (hooks.afterReceipt) await hooks.afterReceipt();
  await removeIfPresent(path.join(projectDir, REVERIFY_STAGED));
  return completion;
}
const httpStatusOf = (error) => { const match = /\b([1-5]\d\d)\b/.exec(error && error.message || ''); return match ? Number(match[1]) : 'error'; };
async function reverify(projectDir, { wix: injectedWix, writers: injectedWriters, hooks = {} } = {}) {
  const writers = injectedWriters || require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-writers.js'));
  const env = await loadWixEnv(projectDir);
  if (writers.createDryRunConfig(env, process.argv.slice(2)).dryRun) throw new Error('reverify refuses a dry run: it re-checks the live import');
  const pending = await pendingReverification(projectDir);
  if (!pending.request) throw new Error('no re-check requested: run request-reverify first');
  if (pending.done) { await removeIfPresent(path.join(projectDir, REVERIFY_STAGED)); return { status: 'already_done', requestId: pending.request.requestId }; }
  // A staged result for this request is the whole answer: publish it, read nothing from Wix.
  if (pending.staged && pending.staged.requestId === pending.request.requestId) { await finalizeReverification(projectDir, pending.staged, hooks); return { status: 'finalized', requestId: pending.request.requestId }; }
  if (!env.WIX_AUTH_TOKEN || !env.WIX_SITE_ID) throw new Error('WIX_AUTH_TOKEN and WIX_SITE_ID are required for a re-check');
  const completion = await readJson(path.join(projectDir, COMPLETION_REPORT));
  const listed = (completion.writtenUnverified && completion.writtenUnverified.product) || [];
  if (!listed.length) throw new Error('the completion report lists no written-unverified products: nothing to re-check');
  const wix = injectedWix || writers.createWixClient({ dryRun: false, authToken: env.WIX_AUTH_TOKEN, siteId: env.WIX_SITE_ID, projectDir });
  const crosswalk = await loadCrosswalk(projectDir);
  const tagIds = new Map(Object.entries(crosswalk.product_tag || {}).filter(([, id]) => id));
  const rows = new Map((await readNdjson(file(projectDir, 'product'))).map((row) => [String(row.id), row]));
  const refreshedVerification = new Map(((completion.verification && completion.verification.product && completion.verification.product.rows) || []).map((row) => [String(row.sourceKey), row]));
  const cleared = [], remaining = [], errors = [], kept = [];
  for (const entry of listed) {
    const sourceId = String(entry.sourceId);
    try {
      const row = rows.get(sourceId);
      if (!row) throw new Error('source product is no longer in the extract');
      const { canonical, payload } = buildProductPayload(row, tagIds);
      // The post-create 404 retry is deliberately not shared here: an operator-requested
      // re-check performs exactly one read per listed product.
      const fullTarget = await writers.getStoresProductForVerification(wix, entry.targetId);
      const { receipt } = verifyWrittenProduct(writers, { row, canonical, payload, fullTarget, targetId: entry.targetId, siteId: env.WIX_SITE_ID });
      refreshedVerification.set(sourceId, { sourceKey: sourceId, targetId: entry.targetId, receipt });
      if (receipt.verified) cleared.push(sourceId);
      else { remaining.push(sourceId); kept.push({ ...entry, failedFields: failedFieldsOf(receipt) }); }
    } catch (error) {
      remaining.push(sourceId); kept.push(entry); errors.push({ sourceId, status: httpStatusOf(error) });
      if (!refreshedVerification.has(sourceId)) refreshedVerification.set(sourceId, { sourceKey: sourceId, targetId: entry.targetId, outcome: 'needs_verification' });
    }
  }
  const skippedProduct = ((completion.skipped && completion.skipped.product) || []).filter((row) => !cleared.includes(String(row.sourceId)));
  const verificationProduct = verificationState.report([...refreshedVerification.values()], env.WIX_SITE_ID);
  const next = { ...completion, writtenUnverified: { ...(completion.writtenUnverified || {}), product: kept }, skipped: { ...(completion.skipped || {}), product: skippedProduct }, verification: { ...(completion.verification || {}), product: verificationProduct } };
  const staged = { schemaVersion: 1, requestId: pending.request.requestId, completedAt: new Date().toISOString(), checked: listed.map((entry) => String(entry.sourceId)), cleared, remaining, errors, writtenUnverified: kept, skippedProduct, importedProduct: ((completion.imported && completion.imported.product) || 0) + cleared.length, verificationProduct, status: deriveStatus(next) };
  if (hooks.beforeStaged) await hooks.beforeStaged();
  await writeJsonAtomic(path.join(projectDir, REVERIFY_STAGED), staged);
  if (hooks.afterStaged) await hooks.afterStaged();
  await finalizeReverification(projectDir, staged, hooks);
  return { status: 'rechecked', requestId: staged.requestId, cleared, remaining, errors };
}

async function importData(projectDir) {
  const planResult = await readJson(path.join(projectDir, 'quick-mode', 'plan.json')); const manifest = await readJson(path.join(projectDir, 'data', 'source-extract', 'manifest.json'));
  importProgress.assertQuickImportAdapter({ plan: planResult, manifest, current: { id: CONTRACT.id, version: CONTRACT.version, fingerprint: hash(CONTRACT) } });
  // Fail closed before any write: a stamped plan with a missing or unreconciled coverage file
  // must not produce a completion summary.
  await sourceCoverage.quickSummaryCoverage(projectDir);
  const productRows = await readNdjson(file(projectDir, 'product'));
  if (productRows.length !== manifest.entities?.product?.recordCount) throw new Error('Product extraction count differs from its manifest');
  const env = await loadWixEnv(projectDir); if (!env.WIX_AUTH_TOKEN || !env.WIX_SITE_ID) throw new Error('WIX_AUTH_TOKEN and WIX_SITE_ID are required for quick import');
  const writers = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-writers.js')); const dryRun = writers.createDryRunConfig(env, process.argv.slice(2)).dryRun;
  const quickRun = capabilities.startQuickRun({ projectDir, adapterId: 'quick-shopify', siteId: env.WIX_SITE_ID, dryRun });
  const clientFor = (id) => writers.createWixClient({ capability: capabilities.bindQuickEntity(quickRun, id), authToken: env.WIX_AUTH_TOKEN });
  let wix = clientFor('collection'); const crosswalk = await loadCrosswalk(projectDir);
  const remember = (entity, sourceId, targetId) => { if (!dryRun) { crosswalk[entity] ||= {}; crosswalk[entity][String(sourceId)] = targetId; } }; const seen = (entity, id) => crosswalk[entity]?.[String(id)];
  const checkpoint = async () => { if (!dryRun) await writeJson(path.join(projectDir, 'state', 'crosswalk', 'quick-shopify.json'), crosswalk); };
  const excludedCollections = manifest.entities?.collection?.excluded || [];
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter: planResult.adapter, dryRun, imported: {}, skipped: { product: [] }, recovered: 0, recoveryCounts: {}, excluded: CONTRACT.excluded, excludedCollections };
  const categoryIds = new Map(); const collectionRows = await readNdjson(file(projectDir, 'collection'));
  // Category capacity: decided before the first write. A dry run cannot see the
  // destination, so it applies the same rule with the built-in category as the floor.
  const existingCategories = dryRun ? new Map() : new Map((await writers.queryAllStoresCategories(wix)).map((category) => [category.slug, category]));
  const existingCount = dryRun ? 1 : liveExistingCount(existingCategories);
  const capacity = categoryCapacity({ existingCount, rows: collectionRows, seen: dryRun ? () => false : (id) => seen('collection', id), existingSlugs: existingCategories });
  const capacityRecord = { schemaVersion: 1, status: capacity.exceeds ? 'blocked' : dryRun ? 'passed_at_floor' : 'passed', existingCount, toCreate: capacity.toCreate, max: capacity.max, populatedSourceCount: collectionRows.length, ...(dryRun ? { existingCountBasis: 'built_in_floor', destinationHeadroom: 'unknown' } : { builtInCountedSeparately: !existingCategories.has('all-products') }) };
  await writeJson(path.join(projectDir, dryRun ? 'execution/dry-run-category-capacity.json' : 'quick-mode/category-capacity.json'), capacityRecord);
  if (capacity.exceeds) {
    if (!dryRun) throw new Error(`Wix Stores category limit: site has ${existingCount} categories and this import must create ${capacity.toCreate} more (max ${capacity.max} per site); free categories on the destination or stop`);
    Object.assign(summary, { status: 'blocked', reason: 'category_capacity', categoryCapacity: capacityRecord }); Object.assign(summary, await sourceCoverage.quickSummaryCoverage(projectDir));
    await recovery.writeFinalReport(projectDir, summary, { dryRun: true }); await writeJson(path.join(projectDir, 'execution', 'dry-run-completion-report.json'), summary); return summary;
  }
  // Durable pre-write evidence, before the first destination create. The
  // crosswalk is checkpointed only after a create succeeds, so it cannot serve as this.
  if (!dryRun) await importProgress.writeQuickImportStartedMarker(projectDir, planResult.adapter);
  for (const row of collectionRows) { try { const key = toWixSlug(row.handle); const target = seen('collection', row.id) ? { id: seen('collection', row.id) } : existingCategories.get(key) || await writers.createStoresCategory(wix, { name: text(row.title), slug: key, description: text(row.body_html).slice(0, 600) || undefined, treeReference: writers.STORES_TREE_REFERENCE }); categoryIds.set(String(row.id), target.id); remember('collection', row.id, target.id); await checkpoint(); } catch (error) { summary.skipped.collection ||= []; summary.skipped.collection.push({ sourceId: String(row.id), reason: error.message }); } }
  summary.imported.collection = categoryIds.size;
  capabilities.finishQuickEntity(quickRun, 'collection'); wix = clientFor('product');
  const existingTags = new Map(((await wix.send(writers.buildListStoresProductTagsRequest())).tags || []).map((tag) => [text(tag.name).toLowerCase(), tag]));
  const tagIds = new Map(); let tagLimitReached = false;
  for (const row of productRows) for (const name of (row.tags || [])) { const key = text(name).toLowerCase(); if (!key || tagIds.has(key)) continue; if (Object.prototype.hasOwnProperty.call(crosswalk.product_tag || {}, key)) { if (crosswalk.product_tag[key]) tagIds.set(key, crosswalk.product_tag[key]); continue; } if (tagLimitReached) { summary.skipped.product_tag ||= []; summary.skipped.product_tag.push({ sourceId: key, reason: 'destination_tag_limit_reached' }); remember('product_tag', key, null); await checkpoint(); continue; } try { const target = existingTags.get(key) || (await wix.send(writers.buildCreateStoresProductTagRequest(text(name)))).tag; tagIds.set(key, target.id); remember('product_tag', key, target.id); } catch (error) { if (!/TAG_NAME_ALREADY_EXISTS|TAGS_REACHED_LIMIT/.test(error.message)) throw error; tagLimitReached = /TAGS_REACHED_LIMIT/.test(error.message); summary.skipped.product_tag ||= []; summary.skipped.product_tag.push({ sourceId: key, reason: tagLimitReached ? 'destination_tag_limit_reached' : 'destination_tag_exists_but_is_not_returned_by_tag_list' }); remember('product_tag', key, null); } await checkpoint(); }
  const catalog = await writers.queryAllStoresProducts(wix);
  const existingProducts = new Map(catalog.map(product => [product.slug, product])); const productIds = new Map();
  // Resolve collisions across the whole source set before any candidate product write.
  // This pre-pass must call `toWixSlug` inside try/catch, like every other call site in this
  // file -- otherwise one product whose handle sanitizes to a degenerate slug (e.g. an
  // emoji/symbol-only handle, which `toWixSlug` rejects) crashes this `.map()` uncaught and
  // aborts the ENTIRE quick-import run instead of being skipped for just that one row, same as
  // every other per-row failure here.
  const slugErrors = new Map();
  const identities = productRows.map(row => {
    let slug = null;
    try {
      slug = toWixSlug(row.handle);
    } catch (error) {
      slugErrors.set(String(row.id), error.message);
    }
    return { sourceId: String(row.id), slug,
      targetId: seen('product', row.id) || seen('product_candidate', row.id) || (slug !== null ? existingProducts.get(slug)?.id : undefined) };
  });
  const ambiguousSources = new Set(identities.filter(identity =>
    identities.some(other => other !== identity && (other.sourceId === identity.sourceId || other.slug === identity.slug || (identity.targetId && other.targetId === identity.targetId))) ||
    catalog.filter(product => product.slug === identity.slug).length > 1
  ).map(identity => identity.sourceId));
  const inventoryRows = [], inventoryGaps = [], productVerification = [];
  // Products that exist on the target with uniquely correlated variants but failed a field
  // read-back (e.g. a description fragment Wix dropped). Stock and category membership depend
  // only on product and variant identity, so they still apply; the product stays reported.
  const unverifiedTargets = new Map();
  const expectedVariants = productRows.reduce((count, row) => count + Math.max(1, (row.variants || []).length), 0);
  for (const row of productRows) {
    let stockQueued = false;
    if (!dryRun && seen('product', row.id)) {
      remember('product_candidate', row.id, seen('product', row.id));
      delete crosswalk.product[String(row.id)];
      await checkpoint();
    }
    try {
      if (slugErrors.has(String(row.id))) throw new Error(slugErrors.get(String(row.id)));
      if (ambiguousSources.has(String(row.id))) throw new Error('Ambiguous source product marker or target identity');
      const { canonical, payload, normalized } = buildProductPayload(row, tagIds);
      const knownId = seen('product', row.id) || seen('product_candidate', row.id);
      const existing = knownId ? { id: knownId } : existingProducts.get(payload.slug);
      const target = existing || await writers.createStoresProduct(wix, payload);
      remember('product_candidate', row.id, target.id);
      if (!dryRun && crosswalk.product) delete crosswalk.product[String(row.id)];
      await checkpoint();
      if (normalized.recoveries.length) { if (!dryRun) await recovery.appendRecoveries(projectDir, planResult.adapter, row.id, normalized.recoveries); recovery.recordRecoveredRecord(summary, normalized.recoveries); }
      if (!dryRun) {
        // A post-write verification gate must not use the bare getStoresProduct read -- the same
        // rule as at its sibling call site in product-import.js's verifyProductCandidate. The
        // bare read omits plainDescription entirely and collapses media to `media.main` only (see
        // getStoresProductForVerification's own comment in wix-writers.js), so `receipt.verified`
        // below could never actually confirm either field, and a real loss there would pass
        // silently instead of throwing.
        const fullTarget = await readCreatedProduct(writers, wix, target.id);
        const { receipt, correspondence } = verifyWrittenProduct(writers, { row, canonical, payload, fullTarget, targetId: target.id, siteId: env.WIX_SITE_ID });
        writers.registerQuickInventoryScope(wix, canonical, fullTarget);
        productVerification.push({ sourceKey: String(row.id), targetId: target.id, receipt });
        if (!receipt.verified) {
          inventoryRows.push(...correspondence); stockQueued = true; unverifiedTargets.set(String(row.id), { targetId: target.id, name: canonical.name, failedFields: failedFieldsOf(receipt) });
          throw new Error('Product identity or values failed read-back');
        }
        inventoryRows.push(...correspondence);
      }
      productIds.set(String(row.id), target.id); remember('product', row.id, target.id); await checkpoint();
    } catch (error) {
      if (!productVerification.some(r => r.sourceKey === String(row.id))) productVerification.push({ sourceKey: String(row.id), outcome: 'needs_verification' });
      summary.skipped.product.push({ sourceId: String(row.id), reason: error.message });
      if (!stockQueued) for (const variant of row.variants?.length ? row.variants : [null]) inventoryGaps.push({ sourceProductId: String(row.id), sourceVariantId: variant ? String(variant.id) : null, reason: error.message });
    }
  }
  summary.verification = { product: dryRun ? { status: 'simulated' } : verificationState.report(productVerification, env.WIX_SITE_ID) };
  summary.inventory = dryRun ? { status: 'simulated', complete: false, intended: expectedVariants }
    : await inventory.reconcileInventory(wix, inventoryRows, { expectedCount: expectedVariants, gaps: inventoryGaps });
  await inventory.persistInventoryReport(path.join(projectDir, dryRun ? 'execution/dry-run-inventory-report.json' : 'state/inventory-report.json'), summary.inventory);
  summary.status = deriveStatus(summary);
  summary.imported.product = productIds.size;
  summary.writtenUnverified = { product: [...unverifiedTargets].map(([sourceId, entry]) => ({ sourceId, targetId: entry.targetId, name: entry.name, failedFields: entry.failedFields })) };
  capabilities.finishQuickEntity(quickRun, 'product'); wix = clientFor('collection_product');
  let memberships = 0; for (const edge of await readNdjson(file(projectDir, 'collection_product'))) { const categoryId = categoryIds.get(edge.collectionId); const productId = productIds.get(edge.productId) || unverifiedTargets.get(edge.productId)?.targetId; if (!categoryId || !productId) continue; const edgeId = `${edge.collectionId}:${edge.productId}`; if (!seen('collection_product', edgeId)) { await writers.bulkAddItemToCategories(wix, { productId, categoryIds: [categoryId] }); remember('collection_product', edgeId, productId); await checkpoint(); } memberships += 1; }
  capabilities.finishQuickEntity(quickRun, 'collection_product');
  summary.imported.collection_product = memberships; if (!dryRun) await checkpoint(); Object.assign(summary, await sourceCoverage.quickSummaryCoverage(projectDir)); await recovery.writeFinalReport(projectDir, summary, { dryRun }); await writeJson(path.join(projectDir, 'execution', dryRun ? 'dry-run-completion-report.json' : 'completion-report.json'), summary); return summary;
}
async function main() { const [command, projectDirArg] = process.argv.slice(2); if (!command || !projectDirArg || !['preflight', 'plan', 'extract', 'import', 'request-reverify', 'reverify'].includes(command)) throw new Error('Usage: quick-mode.js <preflight|plan|extract|import|request-reverify|reverify> <projectDir>'); const fn = { preflight, plan, extract, import: importData, 'request-reverify': requestReverify, reverify }[command]; const result = await fn(path.resolve(projectDirArg)); process.stdout.write(`${JSON.stringify({ ok: true, command, status: result.status || 'completed' })}\n`); }
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { canonicalProduct, resolveInventoryRows, assertCategoryCapacity, categoryCapacity, readCreatedProduct, importData, storefrontQuery, retryWaitMs, captureSource, preflight, extract, plan, requestReverify, reverify, finalizeReverification, deriveStatus };
