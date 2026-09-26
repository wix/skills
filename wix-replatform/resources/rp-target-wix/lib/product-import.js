'use strict';
const w = require('./wix-writers');
const v = require('./write-verification');
const stateIO = require('../../../lib/write-verification-state');
const local = require('../../../lib/local-state');
const at = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Match source-fixed variant projections, never the order of a returned array. The
// mapper chooses unique SKU/choice projections before execution; ambiguity is a gap.
function resolveVariants(expectations, product) {
  const seen = new Set();
  return expectations.map(row => {
    if (!row.sourceKey || !row.expected || !Object.keys(row.expected).length) throw new Error('Source variant correspondence is required');
    const matches = (product?.variantsInfo?.variants || []).filter(variant => v.compareProjection(row.expected, variant).verified);
    if (matches.length !== 1 || !matches[0].id || seen.has(matches[0].id)) throw new Error('Ambiguous source-to-target variant correspondence');
    seen.add(matches[0].id);
    return { ...row, variantId: matches[0].id };
  });
}
async function verifyProductCandidate(wix, { siteId, sourceKey, expected, targetId, marker, variantExpectations, verifyAttempts = 3, sleep = pause }) {
  let receipt, error;
  for (let attempt = 1; attempt <= verifyAttempts; attempt++) {
    try {
      const actual = await w.getStoresProduct(wix, targetId);
      const identityConflict = actual?.id !== targetId || at(actual, marker.path) !== marker.value;
      if (identityConflict) return { sourceKey, targetId, identityConflict: true, outcome: 'needs_verification', error: 'Product identity does not agree' };
      const variants = resolveVariants(variantExpectations, actual);
      receipt = v.receipt({ siteId, sourceKey, kind: 'product', expected, targetId, actual, marker, variants, operation: 'product-import', attempts: attempt });
      if (receipt.verified) return { targetId, sourceKey, receipt, outcome: 'verified', variants };
    } catch (e) { error = e.message; }
    if (attempt < verifyAttempts) await sleep(100 * attempt);
  }
  return { sourceKey, targetId, receipt, outcome: 'needs_verification', error: error || 'Product identity or values do not agree' };
}
async function importProducts(wix, { projectDir, siteId, rows, verifyAttempts = 3, sleep = pause, dryRun = false }) {
  if (!siteId || !projectDir || !Array.isArray(rows) || !Number.isInteger(verifyAttempts) || verifyAttempts < 1 || verifyAttempts > 5) throw new Error('Invalid product import arguments');
  if (rows.some(r => !r.sourceKey || !r.expected || !Object.keys(r.expected).length || !r.marker?.path || r.marker.value == null || r.marker.value === '' || !Array.isArray(r.variantExpectations) || !r.variantExpectations.length) || new Set(rows.map(r => r.sourceKey)).size !== rows.length) throw new Error('Product source identity, projection and variant expectations are required');
  // A caller cannot omit a submitted field from verification merely to make it pass.
  for (const row of rows) {
    v.assertProjection(row.expected);
    for (const variant of row.variantExpectations) v.assertProjection(variant.expected, 'variant.expected');
    for (const key of Object.keys(row.product || {})) if (key !== 'variantsInfo' && !Object.prototype.hasOwnProperty.call(row.expected, key)) throw new Error(`Missing product verification field: ${key}`);
    const sourceVariants = row.product?.variantsInfo?.variants;
    if (!Array.isArray(sourceVariants) || sourceVariants.length !== row.variantExpectations.length || new Set(row.variantExpectations.map(r => r.sourceKey)).size !== sourceVariants.length) throw new Error('Complete source variant expectations required');
    sourceVariants.forEach((variant, index) => {
      for (const key of Object.keys(variant)) if (key !== 'inventoryItem' && !Object.prototype.hasOwnProperty.call(row.variantExpectations[index].expected, key)) throw new Error(`Missing variant verification field: ${key}`);
    });
  }
  if (dryRun) return { siteId, intended: rows.length, status: 'simulated', verified: 0, rows: [] };
  return local.withStateLock(projectDir, async () => {
    const state = await stateIO.load(projectDir, siteId), crosswalk = await local.loadCrosswalk(projectDir);
    const work = rows.map(r => ({ ...r, baseline: crosswalk.bySource[r.sourceKey] || state.rows[r.sourceKey]?.baseline || null, targetId: state.rows[r.sourceKey]?.targetId || crosswalk.bySource[r.sourceKey]?.targetId, uncertain: state.rows[r.sourceKey]?.uncertain }));
    let catalog;
    try { catalog = await w.queryAllStoresProducts(wix); }
    catch (e) { for (const r of work) r.error = `Product reconciliation read failed: ${e.message}`; }
    for (const r of work) {
      if (r.error) continue;
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
        uncertain: Boolean(r.uncertain), outcome: r.outcome || 'needs_verification', error: r.error || null, receipt: r.receipt || null, lastVerifiedReceipt };
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
      } catch (e) { for (const r of group) { r.error = e.message; save(r); } }
      await stateIO.checkpoint(projectDir, state, group);
    }
    for (const r of work) if (r.targetId && work.some(other => other !== r && other.targetId === r.targetId)) { r.error = 'Distinct source keys share a target product'; r.identityConflict = true; }
    const publications = [];
    let verifiedBatch = [];
    for (const r of work) {
      if (!r.error && r.targetId) Object.assign(r, await verifyProductCandidate(wix, { ...r, siteId, verifyAttempts, sleep }));
      save(r);
      if (r.receipt?.verified && !r.error) publications.push({ row: { schemaVersion: 1, sourceSystem: r.sourceSystem || 'source', sourceEntityType: 'product', sourceId: r.sourceId || r.sourceKey,
        sourceStableKey: r.sourceKey, targetSystem: 'wix', targetEntityType: 'product', targetId: r.targetId, status: 'imported' }, receipt: r.receipt, options: r });
      verifiedBatch.push(r);
      if (verifiedBatch.length === 100) { await stateIO.checkpoint(projectDir, state, verifiedBatch); verifiedBatch = []; }
    }
    await stateIO.checkpoint(projectDir, state, verifiedBatch);
    await stateIO.persist(projectDir, state);
    await stateIO.publishMany(projectDir, publications, work.filter(r => r.identityConflict).map(r => r.sourceKey));
    return stateIO.report(work.map(r => state.rows[r.sourceKey]), siteId);
  });
}
module.exports = { resolveVariants, verifyProductCandidate, importProducts };
