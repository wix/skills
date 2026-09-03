#!/usr/bin/env node
'use strict';

// Public-only, read-only WooCommerce quick-mode capture. This deliberately contains no
// credentials, browser automation, or fallback endpoint guessing.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ADAPTER_DIR = path.resolve(__dirname, '..');
const CONTRACT = require(path.join(ADAPTER_DIR, 'quick-mode.json'));
const recovery = require(path.join(ADAPTER_DIR, '..', 'rp-quick-runtime', 'lib', 'limit-recovery.js'));

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}
async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function appendAudit(projectDir, entry) {
  const file = path.join(projectDir, 'logs', 'quick-mode-audit.ndjson');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, 'utf8');
}
function origin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('sourceUrl must use http or https');
  return url.origin;
}
function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function projectContext(projectDir) {
  const decisions = await readJson(path.join(projectDir, 'orchestration', 'decisions.json'));
  const sourceUrl = decisions.sourceUrl && decisions.sourceUrl.value;
  const sourcePlatform = decisions.sourcePlatform && decisions.sourcePlatform.value;
  if (!sourceUrl) throw new Error('quick mode requires orchestration.decisions.sourceUrl');
  if (sourcePlatform !== 'woocommerce') throw new Error(`quick WooCommerce adapter requires sourcePlatform=woocommerce (got ${sourcePlatform || 'missing'})`);
  return { sourceUrl: origin(sourceUrl), decisions };
}
async function fetchCollection(baseUrl, route) {
  const records = [];
  const pages = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(route, `${baseUrl}/`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok || !Array.isArray(body)) {
      return { ok: false, status: response.status, url: url.toString(), bodyType: Array.isArray(body) ? 'array' : typeof body, records, pages };
    }
    records.push(...body);
    pages.push({ page, count: body.length, url: url.toString() });
    const totalPages = Number(response.headers.get('x-wp-totalpages'));
    if (Number.isFinite(totalPages) ? page >= totalPages : body.length < 100) break;
  }
  return { ok: true, records, pages };
}
async function preflight(projectDir) {
  const { sourceUrl } = await projectContext(projectDir);
  const checks = [];
  for (const entity of CONTRACT.entities) {
    const result = await fetchCollection(sourceUrl, entity.route);
    checks.push({ entity: entity.id, route: entity.route, ok: result.ok, status: result.status || 200, url: result.url || result.pages[0]?.url || null, responseShape: result.ok ? 'array' : result.bodyType });
  }
  const out = { schemaVersion: 1, generatedAt: new Date().toISOString(), adapter: { id: CONTRACT.id, version: CONTRACT.version, fingerprint: fingerprint(CONTRACT) }, sourceUrl, status: checks.every((check) => check.ok) ? 'passed' : 'blocked', checks };
  await writeJson(path.join(projectDir, 'quick-mode', 'preflight.json'), out);
  return out;
}
async function plan(projectDir) {
  const { sourceUrl } = await projectContext(projectDir);
  const preflightResult = await readJson(path.join(projectDir, 'quick-mode', 'preflight.json'));
  if (preflightResult.status !== 'passed') throw new Error('quick mode preflight must pass before planning');
  const adapter = { id: CONTRACT.id, version: CONTRACT.version, fingerprint: fingerprint(CONTRACT) };
  const planResult = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter, sourceUrl, entities: CONTRACT.entities, requiredWixCapabilities: CONTRACT.requiredWixCapabilities, excluded: CONTRACT.excluded, sourceAuth: 'none' };
  await writeJson(path.join(projectDir, 'quick-mode', 'plan.json'), planResult);
  await writeJson(path.join(projectDir, 'execution', 'execution-manifest.json'), { schemaVersion: 1, generatedAt: planResult.generatedAt, managementImportMode: 'quick', adapter, extractCommand: 'rp-quick-woocommerce extract', importCommand: 'rp-quick-woocommerce import', entities: CONTRACT.entities.map((entity) => entity.id) });
  return planResult;
}
async function extract(projectDir) {
  const { sourceUrl } = await projectContext(projectDir);
  const planResult = await readJson(path.join(projectDir, 'quick-mode', 'plan.json'));
  if (planResult.adapter.fingerprint !== fingerprint(CONTRACT)) throw new Error('quick adapter contract changed; re-run preflight and plan');
  const entities = {};
  for (const entity of CONTRACT.entities) {
    const result = await fetchCollection(sourceUrl, entity.route);
    if (!result.ok) throw new Error(`${entity.id} extraction failed: ${result.status} ${result.url}`);
    const file = path.join(projectDir, 'data', 'source-extract', `${entity.id}.ndjson`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, result.records.map((record) => JSON.stringify(record)).join('\n') + (result.records.length ? '\n' : ''), 'utf8');
    entities[entity.id] = { file: path.relative(projectDir, file), route: entity.route, recordCount: result.records.length, pages: result.pages };
  }
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter: planResult.adapter, sourceUrl, entities };
  await writeJson(path.join(projectDir, 'data', 'source-extract', 'manifest.json'), manifest);
  return manifest;
}
function nonEmpty(value) { const text = value == null ? '' : String(value).trim(); return text || undefined; }
function text(value) { return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim(); }
function slug(value) { return nonEmpty(value)?.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || undefined; }
function price(value, minor = 2) { const n = Number(value); return Number.isFinite(n) ? (n / (10 ** Number(minor || 2))).toFixed(Number(minor || 2)) : '0.00'; }
async function readLines(filePath) { const raw = await fs.readFile(filePath, 'utf8'); return raw.split(/\r?\n/).filter(Boolean).map(JSON.parse); }
async function loadWixEnv(projectDir) {
  const values = {};
  try {
    for (const line of (await fs.readFile(path.join(projectDir, 'config', 'wix.env'), 'utf8')).split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/); if (m) values[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...values, ...process.env };
}
async function loadCrosswalk(projectDir) {
  try { return await readJson(path.join(projectDir, 'state', 'crosswalk', 'quick-mode.json')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function ensureFallbackAuthor(projectDir) {
  const env = await loadWixEnv(projectDir);
  if (env.WIX_BLOG_FALLBACK_MEMBER_ID) return { status: 'already_configured', memberId: env.WIX_BLOG_FALLBACK_MEMBER_ID };
  if (!env.WIX_AUTH_TOKEN || !env.WIX_SITE_ID) throw new Error('WIX_AUTH_TOKEN and WIX_SITE_ID are required to provision the Blog fallback author');
  const writers = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-writers.js'));
  const dryRun = writers.createDryRunConfig(env, process.argv.slice(2)).dryRun;
  if (dryRun) return { status: 'planned_dry_run', memberId: null };
  const wix = writers.createWixClient({ dryRun: false, authToken: env.WIX_AUTH_TOKEN, siteId: env.WIX_SITE_ID, projectDir });
  const projectId = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'migration';
  const email = `replatform+${projectId}@wix.com`;
  const listed = await writers.listMembers(wix, { limit: 100 });
  let member = (listed.members || []).find((item) => String(item.loginEmail || '').toLowerCase() === email);
  if (!member) member = await writers.createMember(wix, { email, name: 'Imported content', slug: `imported-content-${projectId}` });
  if (!member || !member.id) throw new Error('fallback Blog author was not created');
  const configPath = path.join(projectDir, 'config', 'wix.env');
  let raw = ''; try { raw = await fs.readFile(configPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${raw.replace(/\n?WIX_BLOG_FALLBACK_MEMBER_ID=.*(?:\n|$)/g, '\n').replace(/\s*$/, '\n')}WIX_BLOG_FALLBACK_MEMBER_ID=${member.id}\n`, 'utf8');
  return { status: 'provisioned', memberId: member.id };
}
async function importData(projectDir) {
  const planResult = await readJson(path.join(projectDir, 'quick-mode', 'plan.json'));
  const manifest = await readJson(path.join(projectDir, 'data', 'source-extract', 'manifest.json'));
  if (manifest.adapter.fingerprint !== planResult.adapter.fingerprint) throw new Error('extraction does not match quick plan; re-extract');
  const env = await loadWixEnv(projectDir);
  if (!env.WIX_AUTH_TOKEN || !env.WIX_SITE_ID) throw new Error('WIX_AUTH_TOKEN and WIX_SITE_ID are required for quick import');
  const writers = require(path.join(ADAPTER_DIR, '..', 'rp-target-wix', 'lib', 'wix-writers.js'));
  const dryRun = writers.createDryRunConfig(env, process.argv.slice(2)).dryRun;
  const wix = writers.createWixClient({ dryRun, authToken: env.WIX_AUTH_TOKEN, siteId: env.WIX_SITE_ID, projectDir });
  const sourceDir = path.join(projectDir, 'data', 'source-extract');
  const crosswalk = await loadCrosswalk(projectDir);
  const seen = (entity, sourceId) => crosswalk[entity] && crosswalk[entity][String(sourceId)];
  const remember = (entity, sourceId, targetId) => { if (!dryRun) { crosswalk[entity] ||= {}; crosswalk[entity][String(sourceId)] = targetId; } };
  const checkpointCrosswalk = async () => { if (!dryRun) await writeJson(path.join(projectDir, 'state', 'crosswalk', 'quick-mode.json'), crosswalk); };
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), managementImportMode: 'quick', adapter: planResult.adapter, dryRun, imported: {}, recovered: 0, recoveryCounts: {}, excluded: CONTRACT.excluded };
  const categoryIds = new Map(); const productTagIds = new Map(); const blogCategoryIds = new Map(); const blogTagIds = new Map();
  const existingCategories = new Map((await writers.queryAllStoresCategories(wix)).map((item) => [slug(item.slug), item]));
  for (const row of await readLines(path.join(sourceDir, 'product_category.ndjson'))) {
    if (seen('product_category', row.id)) { categoryIds.set(String(row.id), seen('product_category', row.id)); continue; }
    const sourceSlug = slug(row.slug); const existing = existingCategories.get(sourceSlug);
    const target = existing || await writers.createStoresCategory(wix, { name: text(row.name), slug: sourceSlug, description: nonEmpty(text(row.description).slice(0, 600)), treeReference: writers.STORES_TREE_REFERENCE }); categoryIds.set(String(row.id), target.id);
    remember('product_category', row.id, target.id); await checkpointCrosswalk();
  }
  summary.imported.product_category = categoryIds.size;
  const existingProductTags = new Map(((await writers.sendDirectRest(wix, { method: 'GET', path: '/tags/v1/tags?fqdn=wix.stores.catalog.v3.product' })).tags || []).map((item) => [slug(item.name), item]));
  for (const row of await readLines(path.join(sourceDir, 'product_tag.ndjson'))) {
    if (seen('product_tag', row.id)) { productTagIds.set(String(row.id), seen('product_tag', row.id)); continue; }
    const key = slug(row.name); const existing = existingProductTags.get(key);
    const response = existing || (await writers.sendDirectRest(wix, { method: 'POST', path: '/tags/v1/tags', body: { tag: { name: text(row.name), fqdn: 'wix.stores.catalog.v3.product' } } })).tag;
    productTagIds.set(String(row.id), response.id); remember('product_tag', row.id, response.id); await checkpointCrosswalk();
  }
  summary.imported.product_tag = productTagIds.size;
  const existingBlogCategories = new Map(((await writers.sendDirectRest(wix, { method: 'POST', path: '/blog/v3/categories/query', body: {} })).categories || []).map((item) => [slug(item.slug), item]));
  for (const row of await readLines(path.join(sourceDir, 'blog_category.ndjson'))) { if (seen('blog_category', row.id)) { blogCategoryIds.set(String(row.id), seen('blog_category', row.id)); continue; } const existing = existingBlogCategories.get(slug(row.slug)); const created = existing || await writers.createBlogCategory(wix, { label: text(row.name), slug: slug(row.slug), description: nonEmpty(text(row.description)) }); blogCategoryIds.set(String(row.id), created.id); remember('blog_category', row.id, created.id); await checkpointCrosswalk(); }
  summary.imported.blog_category = blogCategoryIds.size;
  for (const row of await readLines(path.join(sourceDir, 'blog_tag.ndjson'))) { if (seen('blog_tag', row.id)) { blogTagIds.set(String(row.id), seen('blog_tag', row.id)); continue; } const created = await writers.createBlogTag(wix, { label: text(row.name) }); blogTagIds.set(String(row.id), created.id); remember('blog_tag', row.id, created.id); }
  summary.imported.blog_tag = blogTagIds.size;
  const fallbackMemberId = env.WIX_BLOG_FALLBACK_MEMBER_ID;
  if (!fallbackMemberId) throw new Error('setup must provision WIX_BLOG_FALLBACK_MEMBER_ID before importing blog posts');
  let posts = 0;
  for (const row of await readLines(path.join(sourceDir, 'post.ndjson'))) {
    if (seen('post', row.id)) { posts += 1; continue; }
    await appendAudit(projectDir, { phase: 'post', sourceId: String(row.id), state: 'creating_draft' });
    const draft = await writers.createDraftPost(wix, { title: text(row.title?.rendered), memberId: fallbackMemberId, richContent: await writers.convertHtmlToRichContent(wix, row.content?.rendered || '<p></p>'), excerpt: text(row.excerpt?.rendered), slug: slug(row.slug), categoryIds: (row.categories || []).map((id) => blogCategoryIds.get(String(id))).filter(Boolean), tagIds: (row.tags || []).map((id) => blogTagIds.get(String(id))).filter(Boolean), firstPublishedDate: Number.isNaN(new Date(row.date).valueOf()) ? undefined : new Date(row.date).toISOString() });
    await appendAudit(projectDir, { phase: 'post', sourceId: String(row.id), state: 'publishing_draft', targetId: draft.id });
    if (!dryRun) await writers.publishDraftPost(wix, draft.id); remember('post', row.id, draft.id); posts += 1;
    await checkpointCrosswalk(); await appendAudit(projectDir, { phase: 'post', sourceId: String(row.id), state: 'completed', targetId: draft.id });
  }
  summary.imported.post = posts;
  let products = 0;
  // A process can stop after a product create succeeds but before the crosswalk is
  // checkpointed. Build a complete destination slug index up front so a resumed run
  // recovers that write instead of treating the source record as a new product.
  const existingProducts = new Map(
    (await writers.queryAllStoresProducts(wix)).map((item) => [slug(item.slug), item]),
  );
  const productRows = await readLines(path.join(sourceDir, 'product.ndjson'));
  const productSlugCounts = new Map();
  for (const row of productRows) {
    const key = slug(row.slug);
    productSlugCounts.set(key, (productSlugCounts.get(key) || 0) + 1);
  }
  for (const row of productRows) {
    if (seen('product', row.id)) { products += 1; continue; }
    const baseSlug = slug(row.slug);
    const sourceSlug = productSlugCounts.get(baseSlug) > 1 ? `${baseSlug}-${row.id}` : baseSlug;
    const actualPrice = price(row.prices?.price, row.prices?.currency_minor_unit); const regular = price(row.prices?.regular_price, row.prices?.currency_minor_unit);
    const normalized = recovery.normalizeProduct({ sourceId: row.id, sku: nonEmpty(row.sku) || '', tagIds: (row.tags || []).map((tag) => productTagIds.get(String(tag.id))).filter(Boolean) });
    const created = existingProducts.get(sourceSlug) || (productSlugCounts.get(baseSlug) > 1 && existingProducts.get(baseSlug)) || await writers.createStoresProduct(wix, { name: text(row.name), slug: sourceSlug, description: row.description || row.short_description || undefined, productType: 'PHYSICAL', visible: true, tags: { publicTags: { tagIds: normalized.tagIds } }, media: { itemsInfo: { items: (row.images || []).map((image) => image.src).filter(Boolean).map((url) => ({ url })) } }, variantsInfo: { variants: [{ visible: true, sku: normalized.sku || undefined, inStock: row.is_in_stock !== false, price: { actualPrice: { amount: actualPrice }, ...(Number(regular) > Number(actualPrice) ? { compareAtPrice: { amount: regular } } : {}) } }] } });
    if (normalized.recoveries.length) { await recovery.appendRecoveries(projectDir, planResult.adapter, row.id, normalized.recoveries); recovery.recordRecoveredRecord(summary, normalized.recoveries); }
    const targets = (row.categories || []).map((category) => categoryIds.get(String(category.id))).filter(Boolean); if (targets.length) await writers.bulkAddItemToCategories(wix, { productId: created.id, categoryIds: targets }); remember('product', row.id, created.id); products += 1;
  }
  summary.imported.product = products;
  if (!dryRun) await writeJson(path.join(projectDir, 'state', 'crosswalk', 'quick-mode.json'), crosswalk);
  await recovery.writeFinalReport(projectDir, summary);
  await writeJson(path.join(projectDir, 'execution', 'completion-report.json'), summary);
  return summary;
}
async function main() {
  const [command, projectDirArg] = process.argv.slice(2);
  if (!command || !projectDirArg || !['preflight', 'plan', 'setup-author', 'extract', 'import'].includes(command)) throw new Error('Usage: quick-mode.js <preflight|plan|setup-author|extract|import> <projectDir>');
  const result = await ({ preflight, plan, 'setup-author': ensureFallbackAuthor, extract, import: importData })[command](path.resolve(projectDirArg));
  process.stdout.write(`${JSON.stringify({ ok: true, command, status: result.status || 'completed' })}\n`);
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
