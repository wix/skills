#!/usr/bin/env node
'use strict';

// Public-only Shopify quick-mode capture. It intentionally has no credential, browser, or
// endpoint-fallback path. All product-specific writes go through rp-target-wix.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ADAPTER_DIR = path.resolve(__dirname, '..');
const CONTRACT = require(path.join(ADAPTER_DIR, 'quick-mode.json'));
const { buildProduct, toWixSlug } = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-build.js'));
const inventory = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'stores-inventory.js'));
const recovery = require(path.join(ADAPTER_DIR, '..', 'rp-quick-runtime', 'lib', 'limit-recovery.js'));

const verification = require('../../rp-target-wix/lib/write-verification');
const verificationState = require('../../../lib/write-verification-state');
const PRODUCT_LIMIT = 250;
const MAX_DESCRIPTION_LENGTH = 16000;
// Collection membership can require many public requests. Stay below the conservative
// storefront throttle instead of making parallel requests or treating a transient 429 as data.
const SOURCE_REQUEST_DELAY_MS = 750;
const SOURCE_MAX_RETRIES = 4;
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

async function fetchPage(origin, pathname, page) {
  const url = new URL(pathname, `${origin}/`);
  url.searchParams.set('limit', String(PRODUCT_LIMIT));
  url.searchParams.set('page', String(page));
  for (let attempt = 0; attempt <= SOURCE_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const bodyText = await response.text();
    let body = null; try { body = bodyText ? JSON.parse(bodyText) : null; } catch { /* shape checked below */ }
    if (response.status !== 429 || attempt === SOURCE_MAX_RETRIES) return { ok: response.ok, status: response.status, url: url.toString(), body, attempts: attempt + 1 };
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
  }
  throw new Error('unreachable retry state');
}
async function fetchCollection(origin, pathname, key) {
  const records = []; const pages = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(origin, pathname, page);
    const rows = result.body && result.body[key];
    if (!result.ok || !Array.isArray(rows)) return { ok: false, status: result.status, url: result.url, responseShape: Array.isArray(rows) ? 'array' : typeof rows, records, pages };
    records.push(...rows); pages.push({ page, count: rows.length, url: result.url });
    await sleep(SOURCE_REQUEST_DELAY_MS);
    if (rows.length < PRODUCT_LIMIT) break;
    if (page >= 10000) return { ok: false, status: 508, url: result.url, responseShape: 'pagination_limit', records, pages };
  }
  return { ok: true, records, pages };
}
function collectionPath(handle) { return `/collections/${encodeURIComponent(handle)}/products.json`; }
async function captureSource(origin) {
  const products = await fetchCollection(origin, '/products.json', 'products');
  const collections = await fetchCollection(origin, '/collections.json', 'collections');
  const memberships = [];
  const membershipChecks = [];
  if (collections.ok) {
    for (const collection of collections.records) {
      const handle = text(collection.handle);
      if (!handle) { membershipChecks.push({ collectionId: collection.id, ok: false, status: 422, responseShape: 'missing_handle' }); continue; }
      const result = await fetchCollection(origin, collectionPath(handle), 'products');
      membershipChecks.push({ collectionId: collection.id, handle, ok: result.ok, status: result.status || 200, url: result.url || result.pages[0]?.url || null, responseShape: result.ok ? 'object.products[]' : result.responseShape, pages: result.pages.length });
      if (result.ok) for (const product of result.records) memberships.push({ collectionId: String(collection.id), productId: String(product.id) });
    }
  }
  return { products, collections, memberships, membershipChecks };
}
async function preflight(projectDir) {
  const { sourceUrl } = await context(projectDir); const data = await captureSource(sourceUrl);
  const checks = [
    { entity: 'product', ok: data.products.ok, status: data.products.status || 200, url: data.products.url || data.products.pages[0]?.url || null, responseShape: data.products.ok ? 'object.products[]' : data.products.responseShape, pages: data.products.pages.length },
    { entity: 'collection', ok: data.collections.ok, status: data.collections.status || 200, url: data.collections.url || data.collections.pages[0]?.url || null, responseShape: data.collections.ok ? 'object.collections[]' : data.collections.responseShape, pages: data.collections.pages.length },
    ...data.membershipChecks.map((check) => ({ entity: 'collection_product', ...check })),
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
  const out = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter, sourceUrl, entities: CONTRACT.entities, requiredWixCapabilities: CONTRACT.requiredWixCapabilities, excluded: CONTRACT.excluded, sourceAuth: 'none' };
  await writeJson(path.join(projectDir, 'quick-mode', 'plan.json'), out);
  await fs.writeFile(path.join(projectDir, 'quick-mode', 'plan.md'), `# Shopify quick-mode plan\n\nAdapter: ${adapter.id} ${adapter.version}\n\nImported: collections, products, variants, tags, media, and collection membership.\n\nExcluded: ${CONTRACT.excluded.join(', ')}.\n`);
  await writeJson(path.join(projectDir, 'execution', 'execution-manifest.json'), { schemaVersion: 1, generatedAt: out.generatedAt, managementImportMode: 'quick', adapter, extractCommand: 'rp-quick-shopify extract', importCommand: 'rp-quick-shopify import', entities: CONTRACT.entities.map((entity) => entity.id) });
  return out;
}
async function extract(projectDir) {
  const { sourceUrl } = await context(projectDir); const planResult = await readJson(path.join(projectDir, 'quick-mode', 'plan.json'));
  if (planResult.adapter.fingerprint !== hash(CONTRACT)) throw new Error('quick adapter contract changed; re-run preflight and plan');
  let data;
  try {
    const capture = await readJson(path.join(projectDir, 'quick-mode', 'preflight-capture.json'));
    if (capture.adapter?.fingerprint === planResult.adapter.fingerprint && capture.sourceUrl === sourceUrl) data = capture.data;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data) data = await captureSource(sourceUrl);
  if (!data.products.ok || !data.collections.ok || !data.membershipChecks.every((check) => check.ok)) throw new Error('source changed after preflight; re-run preflight before extracting');
  await writeNdjson(file(projectDir, 'product'), data.products.records);
  await writeNdjson(file(projectDir, 'collection'), data.collections.records);
  const knownProductIds = new Set(data.products.records.map((row) => String(row.id)));
  const edges = data.memberships.filter((edge) => knownProductIds.has(edge.productId));
  await writeNdjson(file(projectDir, 'collection_product'), edges);
  const entities = {
    product: { file: 'data/source-extract/product.ndjson', recordCount: data.products.records.length, pages: data.products.pages },
    collection: { file: 'data/source-extract/collection.ndjson', recordCount: data.collections.records.length, pages: data.collections.pages },
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
function resolveInventoryRows(canonical, target) {
  if (!target || !target.id || !Array.isArray(target.variantsInfo?.variants)) throw new Error('Target product omitted variant identities');
  const key = (choices) => JSON.stringify(choices.map(c => [c.optionName, c.choiceName]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const targetByChoices = new Map();
  for (const variant of target.variantsInfo.variants) {
    if (!variant.id) throw new Error('Target variant omitted identity');
    const choices = (variant.choices || []).map(c => {
      if (c.optionChoiceNames) return c.optionChoiceNames;
      const options = (target.options || []).filter(o => o.id === c.optionChoiceIds?.optionId);
      if (options.length !== 1) throw new Error('Target option identity is missing or ambiguous');
      const values = (options[0].choicesSettings?.choices || []).filter(v => v.choiceId === c.optionChoiceIds.choiceId);
      if (values.length !== 1) throw new Error('Target choice identity is missing or ambiguous');
      return { optionName: options[0].name, choiceName: values[0].name };
    });
    const identity = key(choices);
    if (targetByChoices.has(identity)) throw new Error('Ambiguous target variant choices');
    targetByChoices.set(identity, variant.id);
  }
  const matched = new Set();
  return canonical.variants.map(variant => {
    const variantId = targetByChoices.get(key(variant.choices));
    if (!variantId || matched.has(variantId)) throw new Error('Source variant has no unique target match');
    matched.add(variantId);
    return { productId: target.id, variantId, inventory: { inStock: variant.inStock } };
  });
}

async function importData(projectDir) {
  const planResult = await readJson(path.join(projectDir, 'quick-mode', 'plan.json')); const manifest = await readJson(path.join(projectDir, 'data', 'source-extract', 'manifest.json'));
  if (manifest.adapter.fingerprint !== planResult.adapter.fingerprint) throw new Error('extraction does not match quick plan; re-extract');
  const productRows = await readNdjson(file(projectDir, 'product'));
  if (productRows.length !== manifest.entities?.product?.recordCount) throw new Error('Product extraction count differs from its manifest');
  const env = await loadWixEnv(projectDir); if (!env.WIX_AUTH_TOKEN || !env.WIX_SITE_ID) throw new Error('WIX_AUTH_TOKEN and WIX_SITE_ID are required for quick import');
  const writers = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-writers.js')); const dryRun = writers.createDryRunConfig(env, process.argv.slice(2)).dryRun;
  const wix = writers.createWixClient({ dryRun, authToken: env.WIX_AUTH_TOKEN, siteId: env.WIX_SITE_ID, projectDir }); const crosswalk = await loadCrosswalk(projectDir);
  const remember = (entity, sourceId, targetId) => { if (!dryRun) { crosswalk[entity] ||= {}; crosswalk[entity][String(sourceId)] = targetId; } }; const seen = (entity, id) => crosswalk[entity]?.[String(id)];
  const checkpoint = async () => { if (!dryRun) await writeJson(path.join(projectDir, 'state', 'crosswalk', 'quick-shopify.json'), crosswalk); };
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter: planResult.adapter, dryRun, imported: {}, skipped: { product: [] }, recovered: 0, recoveryCounts: {}, excluded: CONTRACT.excluded };
  const categoryIds = new Map(); const existingCategories = new Map((await writers.queryAllStoresCategories(wix)).map((category) => [category.slug, category]));
  for (const row of await readNdjson(file(projectDir, 'collection'))) { try { const key = toWixSlug(row.handle); const target = seen('collection', row.id) ? { id: seen('collection', row.id) } : existingCategories.get(key) || await writers.createStoresCategory(wix, { name: text(row.title), slug: key, description: text(row.body_html).slice(0, 600) || undefined, treeReference: writers.STORES_TREE_REFERENCE }); categoryIds.set(String(row.id), target.id); remember('collection', row.id, target.id); await checkpoint(); } catch (error) { summary.skipped.collection ||= []; summary.skipped.collection.push({ sourceId: String(row.id), reason: error.message }); } }
  summary.imported.collection = categoryIds.size;
  const existingTags = new Map(((await writers.sendDirectRest(wix, { method: 'GET', path: '/tags/v1/tags?fqdn=wix.stores.catalog.v3.product' })).tags || []).map((tag) => [text(tag.name).toLowerCase(), tag]));
  const tagIds = new Map(); let tagLimitReached = false;
  for (const row of productRows) for (const name of (row.tags || [])) { const key = text(name).toLowerCase(); if (!key || tagIds.has(key)) continue; if (Object.prototype.hasOwnProperty.call(crosswalk.product_tag || {}, key)) { if (crosswalk.product_tag[key]) tagIds.set(key, crosswalk.product_tag[key]); continue; } if (tagLimitReached) { summary.skipped.product_tag ||= []; summary.skipped.product_tag.push({ sourceId: key, reason: 'destination_tag_limit_reached' }); remember('product_tag', key, null); await checkpoint(); continue; } try { const target = existingTags.get(key) || (await writers.sendDirectRest(wix, { method: 'POST', path: '/tags/v1/tags', body: { tag: { name: text(name), fqdn: 'wix.stores.catalog.v3.product' } } })).tag; tagIds.set(key, target.id); remember('product_tag', key, target.id); } catch (error) { if (!/TAG_NAME_ALREADY_EXISTS|TAGS_REACHED_LIMIT/.test(error.message)) throw error; tagLimitReached = /TAGS_REACHED_LIMIT/.test(error.message); summary.skipped.product_tag ||= []; summary.skipped.product_tag.push({ sourceId: key, reason: tagLimitReached ? 'destination_tag_limit_reached' : 'destination_tag_exists_but_is_not_returned_by_tag_list' }); remember('product_tag', key, null); } await checkpoint(); }
  const catalog = await writers.queryAllStoresProducts(wix);
  const existingProducts = new Map(catalog.map(product => [product.slug, product])); const productIds = new Map();
  // Resolve collisions across the whole source set before any candidate product write.
  const identities = productRows.map(row => ({ sourceId: String(row.id), slug: toWixSlug(row.handle),
    targetId: seen('product', row.id) || seen('product_candidate', row.id) || existingProducts.get(toWixSlug(row.handle))?.id }));
  const ambiguousSources = new Set(identities.filter(identity =>
    identities.some(other => other !== identity && (other.sourceId === identity.sourceId || other.slug === identity.slug || (identity.targetId && other.targetId === identity.targetId))) ||
    catalog.filter(product => product.slug === identity.slug).length > 1
  ).map(identity => identity.sourceId));
  const inventoryRows = [], inventoryGaps = [], productVerification = [];
  const expectedVariants = productRows.reduce((count, row) => count + Math.max(1, (row.variants || []).length), 0);
  for (const row of productRows) {
    if (!dryRun && seen('product', row.id)) {
      remember('product_candidate', row.id, seen('product', row.id));
      delete crosswalk.product[String(row.id)];
      await checkpoint();
    }
    try {
      if (ambiguousSources.has(String(row.id))) throw new Error('Ambiguous source product marker or target identity');
      const canonical = canonicalProduct(row);
      const payload = buildProduct(canonical);
      const normalized = recovery.normalizeProduct({ sourceId: row.id, sku: payload.variantsInfo.variants[0]?.sku || '', tagIds: (row.tags || []).map((name) => tagIds.get(text(name).toLowerCase())).filter(Boolean) });
      payload.variantsInfo.variants.forEach((variant) => { if (variant.sku) variant.sku = recovery.truncate(variant.sku, recovery.STORES_SKU_MAX, `${row.id}:${variant.sku}`); });
      payload.tags = { publicTags: { tagIds: normalized.tagIds } };
      // This endpoint creates only the product. Stock is written by the reconciler below.
      for (const variant of payload.variantsInfo.variants) delete variant.inventoryItem;
      const knownId = seen('product', row.id) || seen('product_candidate', row.id);
      const existing = knownId ? { id: knownId } : existingProducts.get(payload.slug);
      const target = existing || await writers.createStoresProduct(wix, payload);
      remember('product_candidate', row.id, target.id);
      if (!dryRun && crosswalk.product) delete crosswalk.product[String(row.id)];
      await checkpoint();
      if (normalized.recoveries.length) { await recovery.appendRecoveries(projectDir, planResult.adapter, row.id, normalized.recoveries); recovery.recordRecoveredRecord(summary, normalized.recoveries); }
      if (!dryRun) {
        const fullTarget = await writers.getStoresProduct(wix, target.id);
        const correspondence = resolveInventoryRows(canonical, fullTarget);
        const expected = { ...writers.buildCreateStoresProductRequest(payload).body.product };
        delete expected.options; delete expected.variantsInfo;
        const variants = correspondence.map((entry, index) => {
          const fields = { ...payload.variantsInfo.variants[index] };
          delete fields.choices;
          return { variantId: entry.variantId, expected: fields };
        });
        const receipt = verification.receipt({ siteId: env.WIX_SITE_ID, sourceKey: String(row.id), kind: 'product', expected,
          actual: fullTarget, targetId: target.id, marker: { path: 'slug', value: payload.slug }, variants, operation: 'quick-shopify-product' });
        productVerification.push({ sourceKey: String(row.id), targetId: target.id, receipt });
        if (!receipt.verified) throw new Error('Product identity or values failed read-back');
        inventoryRows.push(...correspondence);
      }
      productIds.set(String(row.id), target.id); remember('product', row.id, target.id); await checkpoint();
    } catch (error) {
      if (!productVerification.some(r => r.sourceKey === String(row.id))) productVerification.push({ sourceKey: String(row.id), outcome: 'needs_verification' });
      summary.skipped.product.push({ sourceId: String(row.id), reason: error.message });
      for (const variant of row.variants?.length ? row.variants : [null]) inventoryGaps.push({ sourceProductId: String(row.id), sourceVariantId: variant ? String(variant.id) : null, reason: error.message });
    }
  }
  summary.verification = { product: dryRun ? { status: 'simulated' } : verificationState.report(productVerification, env.WIX_SITE_ID) };
  summary.inventory = dryRun ? { status: 'simulated', complete: false, intended: expectedVariants }
    : await inventory.reconcileInventory(wix, inventoryRows, { expectedCount: expectedVariants, gaps: inventoryGaps });
  await inventory.persistInventoryReport(path.join(projectDir, dryRun ? 'execution/dry-run-inventory-report.json' : 'state/inventory-report.json'), summary.inventory);
  summary.status = dryRun ? 'simulated' : summary.inventory.status === 'no-data' ? 'no-data'
    : summary.inventory.complete && Object.values(summary.skipped).every(rows => !rows.length) ? 'complete' : 'partial';
  summary.imported.product = productIds.size;
  let memberships = 0; for (const edge of await readNdjson(file(projectDir, 'collection_product'))) { const categoryId = categoryIds.get(edge.collectionId); const productId = productIds.get(edge.productId); if (!categoryId || !productId) continue; const edgeId = `${edge.collectionId}:${edge.productId}`; if (!seen('collection_product', edgeId)) { await writers.bulkAddItemToCategories(wix, { productId, categoryIds: [categoryId] }); remember('collection_product', edgeId, productId); await checkpoint(); } memberships += 1; }
  summary.imported.collection_product = memberships; if (!dryRun) await checkpoint(); await recovery.writeFinalReport(projectDir, summary); await fs.appendFile(path.join(projectDir, summary.finalReport), `\n## Inventory\n\nStatus: ${summary.inventory.status}. Verified complete: ${summary.inventory.complete}. See ${dryRun ? 'execution/dry-run-inventory-report.json' : 'state/inventory-report.json'}.\n`); await writeJson(path.join(projectDir, 'execution', 'completion-report.json'), summary); return summary;
}
async function main() { const [command, projectDirArg] = process.argv.slice(2); if (!command || !projectDirArg || !['preflight', 'plan', 'extract', 'import'].includes(command)) throw new Error('Usage: quick-mode.js <preflight|plan|extract|import> <projectDir>'); const fn = { preflight, plan, extract, import: importData }[command]; const result = await fn(path.resolve(projectDirArg)); process.stdout.write(`${JSON.stringify({ ok: true, command, status: result.status || 'completed' })}\n`); }
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { canonicalProduct, resolveInventoryRows, importData };
