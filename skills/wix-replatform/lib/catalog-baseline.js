'use strict';

// The Wix Stores catalog that existed on the destination before this run's import wrote anything.
// Installing Wix Stores adds sample products and categories that no Wix marker
// identifies, so they are told apart by provenance only: ids that appear between the setup step's
// read just before the install and its reads just after it are `install_seeded`. Everything a run
// finds on a store it did not install is `pre_existing`. Names, dates and revisions are never used.
//
// Setup deletes `install_seeded` items on a site this run created (owner decision 2026-10-26). Every item still present --
// pre-existing, or seeded but not deleted -- is *protected*: no importer may take it over by slug
// or marker, and counts report it apart from what the run wrote.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const wixAuth = require('./wix-auth.js');

const BASELINE_PATH = 'setup/destination-catalog-baseline.json';
const COLLISIONS_PATH = 'execution/target-baseline-collisions.json';
const STORES_APP_DEF_ID = '215238eb-22a5-4c36-9e7b-e7c08025e04e';
const COLLISION_CODE = 'TARGET_BASELINE_COLLISION';
const NOT_DELETED_CODE = 'STORES_INSTALL_SEEDED_NOT_DELETED';
const PRE_EXISTING_CODE = 'STORES_PRE_EXISTING_CATALOG';
const ENTITY = { products: 'stores/product', categories: 'stores/category' };

// Wix may add the samples a moment after the install call returns: read until two consecutive
// reads hold the same ids, at least SETTLE_MIN_READS times.
const SETTLE_MIN_READS = 3;
const SETTLE_MAX_READS = 10;
const SETTLE_DELAY_MS = 3000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (items) => items.map((item) => item.id).sort();
const sameIds = (a, b) => JSON.stringify(ids(a.products)) === JSON.stringify(ids(b.products)) && JSON.stringify(ids(a.categories)) === JSON.stringify(ids(b.categories));

async function readCatalog(wix, writers) {
  const products = await writers.queryAllStoresProducts(wix);
  const categories = await writers.queryAllStoresCategories(wix);
  const slim = (item) => ({ id: item.id, slug: item.slug ?? null });
  return { products: products.filter((item) => item && item.id).map(slim), categories: categories.filter((item) => item && item.id).map(slim) };
}

async function settledCatalog(wix, writers, { sleep = pause, delayMs = SETTLE_DELAY_MS } = {}) {
  let previous = null;
  for (let read = 1; read <= SETTLE_MAX_READS; read += 1) {
    if (read > 1) await sleep(delayMs);
    const current = await readCatalog(wix, writers);
    if (previous && read >= SETTLE_MIN_READS && sameIds(previous, current)) return { catalog: current, reads: read, settled: true };
    previous = current;
  }
  return { catalog: previous, reads: SETTLE_MAX_READS, settled: false };
}

function rows(items, kind, reason = null) {
  return items.map((item) => ({ id: item.id, slug: item.slug, kind, status: 'present', ...(reason ? { reason } : {}) }));
}

// Deletes exactly the seeded rows, products first (a category delete leaves its products), then
// reads the catalog again: an id still listed is `delete_failed`, whatever the delete call said.
// The built-in All Products category appears with the store, so the diff calls it seeded; it is
// Wix's own category, never a sample.
async function markBuiltInCategory(baseline, wix, writers) {
  let allProductsId = null;
  try { allProductsId = await writers.getAllProductsCategoryId(wix); } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; /* fall back to the canonical slug below */ }
  for (const row of baseline.categories) {
    if (row.kind === 'install_seeded' && (row.id === allProductsId || row.slug === 'all-products')) Object.assign(row, { kind: 'pre_existing', reason: 'built_in_all_products_category' });
  }
}

async function clearSeeded(baseline, wix, writers) {
  for (const [collection, build] of [['products', writers.buildDeleteInstallSeededProductRequest], ['categories', writers.buildDeleteInstallSeededCategoryRequest]]) {
    for (const row of baseline[collection].filter((item) => item.kind === 'install_seeded' && item.status !== 'deleted')) {
      delete row.deleteError;
      try { await wix.send(build(row.id)); } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; row.deleteError = String(error.message || error).slice(0, 200); }
    }
  }
  const after = await readCatalog(wix, writers);
  const appeared = { products: [], categories: [] };
  for (const collection of ['products', 'categories']) {
    const present = new Set(after[collection].map((item) => item.id));
    for (const row of baseline[collection].filter((item) => item.kind === 'install_seeded')) row.status = present.has(row.id) ? 'delete_failed' : 'deleted';
    const known = new Set(baseline[collection].map((row) => row.id));
    appeared[collection] = after[collection].filter((item) => !known.has(item.id));
  }
  baseline.verifiedAt = new Date().toISOString();
  return appeared;
}

// Each collection is read on its own, so a failed category read never discards a product read
// that succeeded. A collection whose read failed is `null`: unknown, never empty.
async function readBefore(wix, writers) {
  const before = { products: null, categories: null };
  for (const [collection, read] of [['products', writers.queryAllStoresProducts], ['categories', writers.queryAllStoresCategories]]) {
    try { before[collection] = (await read(wix)).filter((item) => item && item.id).map((item) => ({ id: item.id, slug: item.slug ?? null })); } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; /* unknown */ }
  }
  return before;
}

function notSettled(baseline) {
  return Object.assign(new Error('The Stores catalog kept changing after the install, so setup cannot tell which items the install added'), {
    blockerCode: 'CATALOG_NOT_SETTLED',
    recommendedAction: 'Re-run setup in a few minutes. It reads the catalog again and finishes the record; import cannot start until it does.',
    baseline,
  });
}

// Classify a settled post-install catalog against the pre-install ids. `preInstall` is already
// resolved (see captureAroundInstall): a collection that is `null` there is unknown, so every item
// of it is `pre_existing`. Known rows -- the pre-install items and anything an earlier attempt
// recorded -- keep their record, listed or not.
function classify(catalog, preInstall, known = { products: [], categories: [] }) {
  const out = {};
  for (const collection of ['products', 'categories']) {
    const before = preInstall[collection];
    const kept = new Map(known[collection].map((row) => [row.id, row]));
    out[collection] = catalog[collection].map((item) => {
      const row = kept.get(item.id);
      if (row) return row.status === 'deleted' ? { ...row, status: 'present' } : row;
      if (before === null) return { id: item.id, slug: item.slug, kind: 'pre_existing', status: 'present', reason: 'pre_install_catalog_unreadable' };
      return { id: item.id, slug: item.slug, kind: before.some((old) => old.id === item.id) ? 'pre_existing' : 'install_seeded', status: 'present' };
    });
    for (const row of known[collection]) if (!out[collection].some((item) => item.id === row.id)) out[collection].push(row);
  }
  return out;
}

// Deletes happen only on a site this run created, on the first install of Stores there. On any
// other site, or when Stores is installed again after an earlier setup, Stores may bring back an
// earlier catalog -- the owner's or this run's own import -- and that looks exactly like samples.
const mayDelete = (baseline) => baseline.siteOrigin === 'created' && !baseline.reinstall;

// Deletes, when allowed, then persists. The record is written BEFORE any delete call, so a crash
// or a failed verification read never loses which items the install added.
// `detectNew` only while the install is still being recorded (import cannot have run yet): on a later
// re-run, new ids are this run's own import and must never be read as samples.
async function finish(projectDir, baseline, wix, writers, { detectNew = true } = {}) {
  if (baseline.categories.some((row) => row.kind === 'install_seeded')) await markBuiltInCategory(baseline, wix, writers);
  const seeded = baseline.products.concat(baseline.categories).filter((row) => row.kind === 'install_seeded' && row.status !== 'deleted');
  if (!mayDelete(baseline)) for (const row of seeded) row.reason = baseline.reinstall ? 'reinstall_not_deleted' : 'existing_site_not_deleted';
  writeBaseline(projectDir, baseline);
  if (!seeded.length || !mayDelete(baseline)) return;
  const appeared = await clearSeeded(baseline, wix, writers);
  let changed = false;
  if (detectNew) {
    // Something new showed up while deleting: record it as seeded and stop; the re-run finishes.
    // A collection whose pre-install read is unknown never yields seeded items.
    for (const collection of ['products', 'categories']) for (const item of appeared[collection]) {
      const unknown = baseline.preInstall?.[collection] == null;
      baseline[collection].push({ id: item.id, slug: item.slug, kind: unknown ? 'pre_existing' : 'install_seeded', status: 'present', reason: unknown ? 'pre_install_catalog_unreadable' : 'appeared_during_cleanup' });
      if (!unknown) changed = true;
    }
  }
  if (changed) {
    baseline.settled = false;
    writeBaseline(projectDir, baseline);
    throw notSettled(baseline);
  }
  writeBaseline(projectDir, baseline);
}

// The Stores install step. Returns the baseline it wrote. `installed` says whether Stores was
// listed before this step; `install` performs and verifies the install.
async function captureAroundInstall({ projectDir, wix, writers, installed, install, siteOrigin, sleep, delayMs }) {
  const prior = loadBaseline(projectDir);
  if (installed && prior) {
    // A re-run of setup keeps the first run's record: anything added since may be this run's own
    // import. An unsettled record (the install ran but was not fully recorded) is read again and
    // finished; seeded items an earlier delete missed are tried again.
    if (prior.settled === false) {
      const { catalog, reads, settled } = await settledCatalog(wix, writers, { sleep, delayMs });
      const next = { ...prior, phase: 'installed', ...classify(catalog, prior.preInstall || { products: null, categories: null }, prior), postInstallReads: reads, settled };
      if (!settled) { writeBaseline(projectDir, next); throw notSettled(next); }
      await finish(projectDir, next, wix, writers);
      return { baseline: next, unchanged: false };
    }
    if (!mayDelete(prior) || !prior.products.concat(prior.categories).some((row) => row.kind === 'install_seeded' && row.status !== 'deleted')) return { baseline: prior, unchanged: true };
    await finish(projectDir, prior, wix, writers, { detectNew: false });
    return { baseline: prior, unchanged: false };
  }
  const header = { schemaVersion: 1, appDefId: STORES_APP_DEF_ID, siteOrigin, storesInstalledBeforeRun: installed, startedAt: new Date().toISOString() };
  if (installed) {
    const catalog = await readCatalog(wix, writers);
    const baseline = { ...header, products: rows(catalog.products, 'pre_existing', 'stores_installed_before_run'), categories: rows(catalog.categories, 'pre_existing', 'stores_installed_before_run'), settled: true };
    writeBaseline(projectDir, baseline);
    return { baseline, unchanged: false };
  }
  // A prior record whose install completed means Stores was removed and is being installed again.
  const reinstall = Boolean(prior && (prior.reinstall || prior.phase !== 'pre_install'));
  const read = await readBefore(wix, writers);
  // An unreadable collection counts as empty only on the first setup of a site this run created
  // (no store there yet, so nothing to lose); otherwise it stays unknown. A retry of an install that
  // never completed reuses the first attempt's pre-install read.
  const preInstall = {};
  for (const collection of ['products', 'categories']) {
    const retried = reinstall ? undefined : prior?.preInstall?.[collection];
    preInstall[collection] = read[collection] ?? retried ?? (siteOrigin === 'created' && !prior ? [] : null);
  }
  const known = { products: [...(prior?.products || [])], categories: [...(prior?.categories || [])] };
  for (const collection of ['products', 'categories']) {
    for (const row of rows(preInstall[collection] || [], 'pre_existing', 'pre_install')) if (!known[collection].some((old) => old.id === row.id)) known[collection].push(row);
  }
  // Recorded before the install call: if a read after it fails, the retry still knows the
  // pre-install ids and classifies against them instead of calling the samples pre-existing.
  const baseline = { ...header, ...(reinstall ? { reinstall: true } : {}), preInstall, ...known, phase: 'pre_install', settled: false };
  writeBaseline(projectDir, baseline);
  await install();
  baseline.phase = 'installed';
  writeBaseline(projectDir, baseline);
  const { catalog, reads, settled } = await settledCatalog(wix, writers, { sleep, delayMs });
  Object.assign(baseline, classify(catalog, preInstall, known), { postInstallReads: reads, settled });
  // Still changing after every read: record what is known and stop before deleting anything.
  if (!settled) { writeBaseline(projectDir, baseline); throw notSettled(baseline); }
  await finish(projectDir, baseline, wix, writers);
  return { baseline, unchanged: false };
}

function writeBaseline(projectDir, baseline) {
  const file = path.join(projectDir, BASELINE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(baseline, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// Missing means "no baseline recorded" (a run that never installed Stores through setup). A file
// that exists but cannot be read fails: treating it as absent would unprotect every item in it.
function loadBaseline(projectDir) {
  let bytes;
  try { bytes = fs.readFileSync(path.join(projectDir, BASELINE_PATH), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const baseline = JSON.parse(bytes);
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline.products) || !Array.isArray(baseline.categories)) throw new Error(`${BASELINE_PATH} is not a valid catalog baseline`);
  return baseline;
}

function digest(projectDir) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(projectDir, BASELINE_PATH))).digest('hex'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const stillPresent = (row) => row.status !== 'deleted';

// Ids no importer may take over: every baseline item still on the site.
function protectedIds(projectDir) {
  const baseline = loadBaseline(projectDir);
  const pick = (collection) => new Set((baseline?.[collection] || []).filter(stillPresent).map((row) => row.id));
  return { products: pick('products'), categories: pick('categories') };
}

// Seeded ids only: the "is the site in use" probe ignores these, so a seeded item a delete missed
// never reads as merchant data.
function installSeededIds(projectDir) {
  const baseline = loadBaseline(projectDir);
  return new Set((baseline?.products || []).filter((row) => row.kind === 'install_seeded').map((row) => row.id));
}

function summarize(baseline) {
  if (!baseline) return null;
  const count = (collection, test) => baseline[collection].filter(test).length;
  const block = (collection) => ({
    installSeeded: count(collection, (row) => row.kind === 'install_seeded'),
    deleted: count(collection, (row) => row.kind === 'install_seeded' && row.status === 'deleted'),
    deleteFailed: count(collection, (row) => row.kind === 'install_seeded' && row.status === 'delete_failed'),
    preExisting: count(collection, (row) => row.kind === 'pre_existing'),
    protected: count(collection, stillPresent),
  });
  return { products: block('products'), categories: block('categories') };
}

// Split a catalog read into the items an importer may match and the protected ones.
function partition(items, protectedSet) {
  const open = [], held = [];
  for (const item of items || []) (item && protectedSet.has(item.id) ? held : open).push(item);
  return { open, held };
}

function collisionError(entity, targetId) {
  return Object.assign(new Error(`${COLLISION_CODE}: ${entity} ${targetId} was on the destination before this import; it is neither taken over nor duplicated`), { code: COLLISION_CODE, targetId });
}

// Durable record of every held collision, read by the completion report. One row per entity and
// exact source key; a re-run updates it in place. Each writer clears only the keys it records
// (the read-back gate uses its own `read-back:<entity>:<id>` keys).
const sameRecord = (row, entity, sourceKey) => row.entity === entity && row.sourceKey === String(sourceKey);

function recordCollision(projectDir, { entity, sourceKey, targetId, slug = null }) {
  const file = path.join(projectDir, COLLISIONS_PATH);
  let doc = { schemaVersion: 1, collisions: [] };
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  doc.collisions = (doc.collisions || []).filter((row) => !sameRecord(row, entity, sourceKey));
  doc.collisions.push({ entity, sourceKey: String(sourceKey), targetId, slug, recordedAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// A held record that later imports and verifies is no longer a collision.
function clearCollision(projectDir, entity, sourceKey) {
  const file = path.join(projectDir, COLLISIONS_PATH);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const kept = (doc.collisions || []).filter((row) => !sameRecord(row, entity, sourceKey));
  if (kept.length === (doc.collisions || []).length) return;
  doc.collisions = kept;
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function loadCollisions(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, COLLISIONS_PATH), 'utf8')).collisions || []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

// Completion-report rows: the cutover items this feature owns, plus the `destinationBaseline` block.
function reportRows(projectDir) {
  const baseline = loadBaseline(projectDir);
  // Only collisions whose blocking item is still on the site are open; once setup deleted it, the
  // record imports on the next run and the import's own accounting covers it.
  const held = protectedIds(projectDir);
  const collisions = loadCollisions(projectDir).filter((row) => (row.entity === ENTITY.categories ? held.categories : held.products).has(row.targetId));
  const operatorActions = [];
  if (baseline) {
    const failed = [...baseline.products, ...baseline.categories].filter((row) => row.kind === 'install_seeded' && row.status !== 'deleted');
    if (failed.length) {
      const why = failed.some((row) => row.status === 'delete_failed') ? 'that setup could not delete' : 'that setup left in place because this run did not create the site or Stores was installed again (check each is a sample, not an earlier product of the owner or of this import)';
      operatorActions.push({
        actionId: 'catalog-baseline:seeded-not-deleted', code: NOT_DELETED_CODE, severity: 'high', role: 'cutover-operator', entity: 'stores/product',
        action: `Cutover Operator: in Business Manager > Store Products (and Categories), delete the ${failed.length} item(s) that appeared when Wix Stores was installed and ${why} (ids in affectedIds).`,
        deadlineReason: 'before switching traffic; customers would see sample products', affectedCount: failed.length, affectedIds: failed.map((row) => row.id),
        artifactRefs: [BASELINE_PATH], resolutionEvidence: 'A catalog read no longer lists these ids.',
      });
    }
    const pre = baseline.products.filter((row) => row.kind === 'pre_existing');
    if (pre.length) {
      operatorActions.push({
        actionId: 'catalog-baseline:pre-existing', code: PRE_EXISTING_CODE, severity: 'low', role: 'site-owner', entity: 'stores/product',
        action: `Site owner: ${pre.length} product(s) were on the store before this migration. RePlatform did not change or delete them; keep or remove them as you choose.`,
        deadlineReason: 'information only; review before go-live', affectedCount: pre.length, affectedIds: pre.map((row) => row.id), artifactRefs: [BASELINE_PATH],
        resolutionEvidence: 'The owner has reviewed the listed products.',
      });
    }
  }
  // Keyed by the blocking Wix item: the importer and the read-back gate name the same source record
  // with different key formats, so counting source keys would count one record twice.
  for (const entity of [...new Set(collisions.map((row) => row.entity))].sort()) {
    const targets = [...new Set(collisions.filter((row) => row.entity === entity).map((row) => row.targetId))];
    operatorActions.push({
      actionId: `catalog-baseline:collision:${entity}`, code: COLLISION_CODE, severity: 'high', role: 'import-operator', entity,
      action: `Requires Import Operator: ${targets.length} ${entity} item(s) that were on the store before this import match source records, so those records were not written (target ids in affectedIds).`,
      importOperatorPrompt: `Resolve ${COLLISION_CODE} for ${entity}: for each row in ${COLLISIONS_PATH}, remove or rename the listed Wix item (target id), then resume the import for that source record.`,
      deadlineReason: 'before switching traffic; these records are missing from the new store', affectedCount: targets.length, affectedIds: targets,
      artifactRefs: [COLLISIONS_PATH, ...(baseline ? [BASELINE_PATH] : [])], resolutionEvidence: 'Each listed source record has a verified read-back.',
    });
  }
  const summary = summarize(baseline);
  return { operatorActions, destinationBaseline: summary ? { path: BASELINE_PATH, ...summary, collisions: new Set(collisions.map((row) => `${row.entity}\u0000${row.targetId}`)).size } : null };
}

// Quick-mode summaries are their own completion reports and never pass through
// completion-report.js, so the same rows are attached here: structured operator actions (merged by
// actionId) and the destinationBaseline block.
function quickReport(projectDir, summary) {
  const { operatorActions, destinationBaseline } = reportRows(projectDir);
  if (destinationBaseline) summary.destinationBaseline = destinationBaseline;
  const others = (summary.operatorActions || []).filter((row) => !String(row.actionId || '').startsWith('catalog-baseline:'));
  if (operatorActions.length || summary.operatorActions) summary.operatorActions = [...others, ...operatorActions];
  // Same rule as completion-report.js: an open high-severity catalog item is never a clean `complete`.
  // A summary with no status of its own (WooCommerce) gets one: held records make it `partial`.
  const high = operatorActions.some((row) => row.severity === 'high');
  if (!summary.status && operatorActions.some((row) => row.code === COLLISION_CODE)) summary.status = 'partial';
  else if ((!summary.status || summary.status === 'complete') && high) summary.status = 'complete_with_warnings';
  return summary;
}

module.exports = {
  BASELINE_PATH, COLLISIONS_PATH, COLLISION_CODE, NOT_DELETED_CODE, PRE_EXISTING_CODE, STORES_APP_DEF_ID, ENTITY,
  readCatalog, settledCatalog, captureAroundInstall, loadBaseline, writeBaseline, digest, protectedIds, installSeededIds,
  summarize, partition, collisionError, recordCollision, clearCollision, loadCollisions, reportRows, quickReport,
};
