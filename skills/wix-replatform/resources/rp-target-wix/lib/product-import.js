'use strict';

const wixAuth = require('../../../lib/wix-auth.js');
const w = require('./wix-writers');
const v = require('./write-verification');
const stateIO = require('../../../lib/write-verification-state');
const local = require('../../../lib/local-state');
const seo = require('./product-seo');
const catalogBaseline = require('../../../lib/catalog-baseline');
const at = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Match source-fixed variant projections, never the order of a returned array. The
// mapper chooses unique SKU/choice projections before execution; ambiguity is a gap. Returned
// choice ids are resolved to names through the product's option dictionary before comparison.
function resolveVariants(expectations, product) {
  const seen = new Set();
  return expectations.map(row => {
    if (!row.sourceKey || !row.expected || !Object.keys(row.expected).length) throw new Error('Source variant correspondence is required');
    const matches = (product?.variantsInfo?.variants || []).filter(variant => v.compareProjection(row.expected, v.variantComparisonView(variant, product)).verified);
    if (matches.length !== 1 || !matches[0].id || seen.has(matches[0].id)) throw new Error('Ambiguous source-to-target variant correspondence');
    seen.add(matches[0].id);
    return { ...row, variantId: matches[0].id };
  });
}
async function verifyProductCandidate(wix, { siteId, sourceKey, expected, targetId, marker, variantExpectations, verifyAttempts = 3, sleep = pause }) {
  let receipt, error;
  for (let attempt = 1; attempt <= verifyAttempts; attempt++) {
    try {
      // getStoresProduct's bare GET omits plainDescription entirely and collapses media to
      // `media.main` only (see getStoresProductForVerification's comment in wix-writers.js) --
      // a verification read needs both fields or it can never confirm what create actually wrote.
      const actual = await w.getStoresProductForVerification(wix, targetId);
      const identityConflict = actual?.id !== targetId || at(actual, marker.path) !== marker.value;
      if (identityConflict) return { sourceKey, targetId, identityConflict: true, outcome: 'needs_verification', error: 'Product identity does not agree' };
      const variants = resolveVariants(variantExpectations, actual);
      receipt = v.receipt({ siteId, sourceKey, kind: 'product', expected, targetId, actual, marker, variants, operation: 'product-import', attempts: attempt });
      if (receipt.verified) return { targetId, sourceKey, receipt, outcome: 'verified', variants };
    } catch (e) { if (wixAuth.isRunInterruption(e)) throw e; error = e.message; }
    if (attempt < verifyAttempts) await sleep(100 * attempt);
  }
  return { sourceKey, targetId, receipt, outcome: 'needs_verification', error: error || 'Product identity or values do not agree' };
}
// A row saved by an older toolkit kept `uncertain` on a create that never ran: the send was
// refused before any byte left (DEPENDENCY_READINESS_REQUIRED), or Wix answered 429, which it does
// before processing. That saved error proves nothing was written, so a resume creates the product instead
// of holding it as uncertain forever. The catalog sweep still adopts one that exists by marker.
const NOT_WRITTEN_ERROR = /^(?:DEPENDENCY_READINESS_REQUIRED$|POST https:\/\/www\.wixapis\.com\/stores\/v3\/bulk\/products-with-inventory\/create → 429:)/;
const savedUncertain = row => Boolean(row?.uncertain) && !(!row.targetId && NOT_WRITTEN_ERROR.test(String(row.error || '')));
async function importProducts(wix, { projectDir, siteId, rows, verifyAttempts = 3, sleep = pause, dryRun = false, seoConflictDecisions = {}, seoSleep = null, seoPacer = null }) {
  if (!siteId || !projectDir || !Array.isArray(rows) || !Number.isInteger(verifyAttempts) || verifyAttempts < 1 || verifyAttempts > 5) throw new Error('Invalid product import arguments');
  if (rows.some(r => !r.sourceKey || !r.expected || !Object.keys(r.expected).length || !r.marker?.path || r.marker.value == null || r.marker.value === '' || !Array.isArray(r.variantExpectations) || !r.variantExpectations.length) || new Set(rows.map(r => r.sourceKey)).size !== rows.length) throw new Error('Product source identity, projection and variant expectations are required');
  // A caller cannot omit a submitted field from verification merely to make it pass.
  for (const row of rows) {
    v.assertProjection(row.expected);
    for (const variant of row.variantExpectations) v.assertProjection(variant.expected, 'variant.expected');
    // A row carrying an SEO plan has its seoData verified per field by the SEO stage
    // (product read-back AND resolvedTags), so it is kept out of the generic comparator: a create
    // that drops seoData must not fail catalog identity, it must be reconciled by a guarded PATCH.
    if (row.seo) {
      if (!row.seo.fields || !Array.isArray(row.seo.tags)) throw new Error('row.seo must be a planProductSeo() plan');
      if (Object.prototype.hasOwnProperty.call(row.expected, 'seoData')) throw new Error('seoData is verified by the SEO stage; omit it from expected when row.seo is set');
      if (seo.canonicalJson(row.product?.seoData?.tags || []) !== seo.canonicalJson(row.seo.tags)) throw new Error('product.seoData must equal the SEO plan tags');
    }
    for (const key of Object.keys(row.product || {})) if (key !== 'variantsInfo' && !(key === 'seoData' && row.seo) && !Object.prototype.hasOwnProperty.call(row.expected, key)) throw new Error(`Missing product verification field: ${key}`);
    // A product written with modifiers carries its selection route, persisted on its verification
    // row so the cutover storefront check can list modifier-route products.
    const modifierCount = Array.isArray(row.product?.modifiers) ? row.product.modifiers.length : 0;
    if (row.selectionRoute != null || modifierCount) {
      const sr = row.selectionRoute;
      if (!sr || !['none', 'variants', 'modifiers', 'hybrid'].includes(sr.route) || !Array.isArray(sr.modifiers) || sr.modifiers.length !== modifierCount
        || (modifierCount > 0) !== (sr.route === 'modifiers' || sr.route === 'hybrid')) throw new Error('row.selectionRoute must be the routeRecord() of the product (route and one entry per modifier)');
    }
    const sourceVariants = row.product?.variantsInfo?.variants;
    if (!Array.isArray(sourceVariants) || sourceVariants.length !== row.variantExpectations.length || new Set(row.variantExpectations.map(r => r.sourceKey)).size !== sourceVariants.length) throw new Error('Complete source variant expectations required');
    sourceVariants.forEach((variant, index) => {
      for (const key of Object.keys(variant)) if (key !== 'inventoryItem' && !Object.prototype.hasOwnProperty.call(row.variantExpectations[index].expected, key)) throw new Error(`Missing variant verification field: ${key}`);
    });
  }
  if (dryRun) {
    const seoRows = rows.filter(r => r.seo).map(r => ({ sourceKey: r.sourceKey, plan: r.seo }));
    const seoPreview = seoRows.length ? seo.previewProductSeo(seoRows, await seo.loadSeoState(projectDir, siteId)) : [];
    return { siteId, intended: rows.length, status: 'simulated', verified: 0, rows: [], seoPreview };
  }
  return local.withStateLock(projectDir, async () => {
    const state = await stateIO.load(projectDir, siteId), crosswalk = await local.loadCrosswalk(projectDir);
    // A product this record's own earlier create left under a Wix-minted slug: adopt it (the writer
    // admits it only for this record client, unclaimed, never verified, revision 1, same name) and
    // set its slug to the marker, so the reconciliation below finds it by marker instead of
    // reporting an identity conflict on every resume. Never creates a product.
    for (const r of rows) {
      const saved = state.rows[r.sourceKey];
      if (!saved?.identityConflict || !saved.targetId || crosswalk.bySource[r.sourceKey] || r.marker?.path !== 'slug' || !r.marker.value) continue;
      let adopted = null;
      try { adopted = await w.admitSavedProductTarget(wix, { projectDir, siteId, expectedName: r.product?.name }); }
      catch (e) { if (e?.code === 'CAPABILITY_ENTITY_MISMATCH') continue; throw e; }
      if (!adopted || adopted.id !== saved.targetId || adopted.name !== r.product?.name) continue;
      if (adopted.slug !== r.marker.value) await w.patchStoresProduct(wix, { productId: adopted.id, revision: adopted.revision, slug: r.marker.value });
      r.adoptedSavedTarget = adopted.id;
    }
    const work = rows.map(r => ({ ...r, baseline: crosswalk.bySource[r.sourceKey] || state.rows[r.sourceKey]?.baseline || null, targetId: state.rows[r.sourceKey]?.targetId || crosswalk.bySource[r.sourceKey]?.targetId, uncertain: savedUncertain(state.rows[r.sourceKey]) }));
    let catalog;
    try { catalog = await w.queryAllStoresProducts(wix); }
    catch (e) { if (wixAuth.isRunInterruption(e)) throw e; for (const r of work) r.error = `Product reconciliation read failed: ${e.message}`; }
    // A product that was on the store before this import is never a match: taking it
    // over would report a sample or merchant product as this source record.
    const baselineIds = catalogBaseline.protectedIds(projectDir).products;
    for (const r of work) {
      if (r.error) continue;
      // A saved target id (crosswalk or state) is checked too: an earlier run may have adopted one.
      const held = (r.targetId && baselineIds.has(r.targetId) ? catalog.find(p => p.id === r.targetId) || { id: r.targetId } : null)
        || catalog.find(p => baselineIds.has(p.id) && at(p, r.marker.path) === r.marker.value);
      if (held) { r.error = catalogBaseline.collisionError('stores/product', held.id).message; r.identityConflict = true; catalogBaseline.recordCollision(projectDir, { entity: 'stores/product', sourceKey: r.sourceKey, targetId: held.id, slug: held.slug ?? null }); continue; }
      const matches = catalog.filter(p => at(p, r.marker.path) === r.marker.value);
      if (matches.length > 1 || (r.targetId && matches.some(p => p.id !== r.targetId))) { r.error = 'Ambiguous product marker or crosswalk'; r.identityConflict = true; }
      else if (!r.targetId && matches.length) r.targetId = matches[0].id;
      else if (!r.targetId && r.uncertain) r.error = 'Previous product write is uncertain; reconcile before retry';
      if (work.some(other => other !== r && other.marker.path === r.marker.path && other.marker.value === r.marker.value)) { r.error = 'Duplicate source product marker'; r.identityConflict = true; }
      if (r.targetId && crosswalk.rows.some(c => c.sourceStableKey !== r.sourceKey && c.targetSystem === 'wix' && c.targetId === r.targetId)) { r.error = 'Product target belongs to another source key'; r.identityConflict = true; }
    }
    for (const r of work) if (r.targetId && work.some(other => other !== r && other.targetId === r.targetId)) { r.error = 'Distinct source keys share a target product'; r.identityConflict = true; }
    const save = r => {
      const previous = state.rows[r.sourceKey];
      const lastVerifiedReceipt = v.validReceipt(previous?.receipt) ? previous.receipt : previous?.lastVerifiedReceipt || null;
      state.rows[r.sourceKey] = { sourceKey: r.sourceKey, targetId: r.targetId || null, baseline: r.baseline, identityConflict: Boolean(r.identityConflict),
        uncertain: Boolean(r.uncertain), outcome: r.outcome || 'needs_verification', error: r.error || null, receipt: r.receipt || null, lastVerifiedReceipt,
        ...(r.selectionRoute ? { selectionRoute: r.selectionRoute } : {}) };
    };
    for (const r of work) save(r);
    await stateIO.checkpoint(projectDir, state, work);
    // Batch by every API cap, not only product count.
    const batches = []; let batch = [], cost = {};
    for (const r of work.filter(r => !r.error && !r.targetId)) {
      const next = { records: 1, ...w.storesProductBulkCost(r.product) };
      if (Object.entries(next).some(([key, n]) => n > w.BULK_PRODUCT_LIMITS[key])) { r.error = 'Product exceeds bulk limits'; continue; }
      if (batch.length && Object.entries(next).some(([key, n]) => (cost[key] || 0) + n > w.BULK_PRODUCT_LIMITS[key])) { batches.push(batch); batch = []; cost = {}; }
      batch.push(r); for (const [key, n] of Object.entries(next)) cost[key] = (cost[key] || 0) + n;
    }
    if (batch.length) batches.push(batch);
    for (const group of batches) {
      for (const r of group) { r.uncertain = true; save(r); }
      await stateIO.checkpoint(projectDir, state, group);
      try {
        const result = await w.bulkCreateStoresProductsWithInventory(wix, group.map(r => r.product));
        for (const outcome of result.results) if (outcome.correlated) {
          const r = group[outcome.index];
          if (outcome.success) { r.targetId = outcome.productId; r.uncertain = false; r.confirmedCreate = true; }
          else { r.error = outcome.errorCode || 'Product create failed'; r.uncertain = false; }
          save(r);
        }
        for (const index of result.unresolvedIndexes) { group[index].error = 'Unresolved bulk product result'; save(group[index]); }
      } catch (e) {
        if (wixAuth.isRunInterruption(e)) throw e;
        for (const r of group) {
          r.error = e.message;
          // Refused before sending (one bulk request): nothing was written, so nothing is uncertain.
          if (e && e.requestSent === false) r.uncertain = false;
          // Still rate-limited after the client's retries: Wix refused it before processing.
          if (e && e.requestApplied === false) r.uncertain = false;
          save(r);
        }
      }
      await stateIO.checkpoint(projectDir, state, group);
    }
    for (const r of work) if (r.targetId && work.some(other => other !== r && other.targetId === r.targetId)) { r.error = 'Distinct source keys share a target product'; r.identityConflict = true; }
    const publications = [];
    let verifiedBatch = [];
    for (const r of work) {
      if (!r.error && r.targetId) Object.assign(r, await verifyProductCandidate(wix, { ...r, siteId, verifyAttempts, sleep }));
      save(r);
      if (r.receipt?.verified && !r.error) catalogBaseline.clearCollision(projectDir, 'stores/product', r.sourceKey);
      if (r.receipt?.verified && !r.error) publications.push({ row: { schemaVersion: 1, sourceSystem: r.sourceSystem || 'source', sourceEntityType: r.sourceEntityType || 'product', sourceId: stateIO.crosswalkSourceId(r),
        sourceStableKey: r.sourceKey, targetSystem: 'wix', targetEntityType: 'product', targetId: r.targetId, status: 'imported' }, receipt: r.receipt, options: r });
      verifiedBatch.push(r);
      if (verifiedBatch.length === 100) { await stateIO.checkpoint(projectDir, state, verifiedBatch); verifiedBatch = []; }
    }
    await stateIO.checkpoint(projectDir, state, verifiedBatch);
    await stateIO.persist(projectDir, state);
    await stateIO.publishMany(projectDir, publications, work.filter(r => r.identityConflict).map(r => r.sourceKey));
    const report = stateIO.report(work.map(r => state.rows[r.sourceKey]), siteId);
    // Product SEO after the product exists and its identity is verified. SEO
    // failures add stage residuals; they never un-import the product.
    const seoRows = work.filter(r => r.seo && !r.error && r.targetId && r.receipt?.verified).map(r => ({
      sourceKey: r.sourceKey, targetId: r.targetId, plan: r.seo,
      // The revision this import owns: a product created or first adopted in this run starts from
      // its verified read; a previously imported one from its crosswalk baseline (none = review).
      savedRevision: r.confirmedCreate || !r.baseline ? r.receipt.actual?.revision ?? null : r.baseline.targetRevision ?? null,
    }));
    if (work.some(r => r.seo)) {
      report.seo = seoRows.length ? await seo.reconcileProductSeo({ projectDir, siteId, rows: seoRows, conflictDecisions: seoConflictDecisions, sleep: seoSleep || sleep, pacer: seoPacer || w.sharedTargetReadPacer(),
        readProduct: id => w.getStoresProductForVerification(wix, id),
        patchProduct: payload => w.patchStoresProduct(wix, payload),
        readItemSeoTags: id => w.getItemSeoTags(wix, seo.STORES_PRODUCT_ITEM_TYPE, id) }) : { siteId, results: [], stageResiduals: [] };
      // Products whose identity did not verify still owe their held/accepted SEO rows.
      const reconciled = new Set(seoRows.map(r => r.sourceKey));
      const unreconciled = work.filter(r => r.seo && !reconciled.has(r.sourceKey)).map(r => ({ sourceKey: r.sourceKey, residuals: r.seo.residuals }));
      report.seo.stageResiduals = seo.collectSeoStageResiduals([...report.seo.results, ...unreconciled]);
    }
    return report;
  });
}
module.exports = { resolveVariants, verifyProductCandidate, importProducts };
