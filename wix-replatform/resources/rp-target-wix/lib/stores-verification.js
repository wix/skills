'use strict';

const fs = require('fs');
const path = require('path');
const w = require('./wix-writers');
const verification = require('./write-verification');

const DEFAULT_VERIFIED_SUBSCRIPTION_PATHS = [
  'product.subscriptionDetails',
  'product.subscriptionDetails.allowOneTimePurchases',
  'product.subscriptionDetails.subscriptions[]',
  'product.subscriptionDetails.subscriptions[].id',
  'product.subscriptionDetails.subscriptions[].title',
  'product.subscriptionDetails.subscriptions[].description',
  'product.subscriptionDetails.subscriptions[].frequency',
  'product.subscriptionDetails.subscriptions[].interval',
  'product.subscriptionDetails.subscriptions[].autoRenewal',
];

function timestamp() {
  return new Date().toISOString();
}

function defaultProbeProduct({ marker, name } = {}) {
  const suffix = marker || `rp-probe-${Date.now()}`;
  return {
    name: name || `RePlatform subscription probe ${suffix}`,
    productType: 'PHYSICAL',
    visible: false,
    sku: suffix,
    price: { actualPrice: { amount: '1.00' } },
    subscriptionDetails: {
      allowOneTimePurchases: true,
      subscriptions: [{
        title: 'Monthly delivery',
        description: 'Ships every month',
        frequency: 'MONTH',
        interval: 1,
        autoRenewal: true,
      }],
    },
  };
}

function artifactBase({ command, siteId, endpoint, method }) {
  return {
    schemaVersion: 1,
    command,
    targetSiteIdentifier: siteId || null,
    endpoint,
    method,
    status: 'unknown',
    verifiedPaths: [],
    constraintsDiscovered: [],
    probeRecordId: null,
    cleanup: { attempted: false, status: 'not_applicable' },
    warnings: [],
    recoveryInstructions: [],
    timestamp: timestamp(),
  };
}

function valueAtPath(root, pathExpr) {
  const parts = String(pathExpr).split('.');
  let values = [root];
  for (const part of parts) {
    const arrayPart = part.endsWith('[]') ? part.slice(0, -2) : null;
    const key = arrayPart || part;
    const next = [];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const child = value[key];
      if (arrayPart) {
        if (Array.isArray(child)) next.push(...child);
      } else {
        next.push(child);
      }
    }
    values = next;
  }
  return values.filter((value) => value !== undefined && value !== null);
}

function verifyPaths(root, paths) {
  return paths.map((pathExpr) => ({
    path: pathExpr,
    present: valueAtPath(root, pathExpr).length > 0,
  }));
}

function queryFilterByMarker({ markerPath, markerValue }) {
  if (!markerPath || markerValue == null) {
    throw new Error('product-by-source-marker requires --marker-path and --marker-value');
  }
  return {
    filter: { [markerPath]: { $eq: markerValue } },
    paging: { limit: 100, offset: 0 },
  };
}

async function writeArtifact(file, result) {
  if (!file) return result;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function verifyStoresSubscriptionCreate({ wix, siteId, artifactPath, probeProduct, marker, cleanup = true } = {}) {
  const createRequest = w.buildCreateStoresProductRequest(probeProduct || defaultProbeProduct({ marker }));
  const artifact = artifactBase({
    command: 'stores subscription-create',
    siteId,
    endpoint: createRequest.url,
    method: createRequest.method,
  });

  let createdProduct;
  try {
    const expected = verification.subscriptionExpected(createRequest.body.product);
    createdProduct = (await wix.send(createRequest)).product;
    artifact.probeRecordId = createdProduct && createdProduct.id;
    if (!require('./bulk-results').opaqueId(artifact.probeRecordId) || createdProduct._dryRunPlaceholder) throw new Error('create response did not include a live product.id');
    artifact.valueEvidence = { expected, targetId: artifact.probeRecordId, actual: null };
    await writeArtifact(artifactPath, artifact);

    const getRequest = w.buildGetStoresProductRequest(artifact.probeRecordId);
    artifact.readback = { endpoint: getRequest.url, method: getRequest.method };
    const readProduct = (await wix.send(getRequest)).product;
    artifact.verifiedPaths = verifyPaths({ product: readProduct }, DEFAULT_VERIFIED_SUBSCRIPTION_PATHS);
    artifact.constraintsDiscovered = w.STORES_SUBSCRIPTION_CONTRACT.constraints.map((constraint) => ({ ...constraint }));
    artifact.valueEvidence.actual = readProduct;
    artifact.comparison = verification.verifySubscriptionEvidence(artifact.valueEvidence);
    artifact.status = artifact.comparison.verified ? 'passed' : 'failed';
    if (artifact.status === 'failed') {
      artifact.warnings.push('Subscription readback identity or values do not match the submitted product.');
    }
  } catch (error) {
    artifact.status = 'failed';
    artifact.error = error && error.message ? error.message : String(error);
  } finally {
    if (cleanup && artifact.probeRecordId) {
      artifact.cleanup.attempted = true;
      artifact.cleanup.endpoint = w.buildDeleteStoresProductRequest(artifact.probeRecordId).url;
      artifact.cleanup.method = 'DELETE';
      try {
        await wix.send(w.buildDeleteStoresProductRequest(artifact.probeRecordId));
        artifact.cleanup.status = 'deleted';
      } catch (error) {
        artifact.cleanup.status = 'failed';
        artifact.cleanup.error = error && error.message ? error.message : String(error);
        artifact.warnings.push(`Probe product cleanup failed for ${artifact.probeRecordId}.`);
        artifact.recoveryInstructions.push(
          `Delete probe product ${artifact.probeRecordId} from Wix Stores or run: verify stores delete-probe --product-id ${artifact.probeRecordId}`,
        );
      }
    }
  }

  return writeArtifact(artifactPath, artifact);
}

async function verifyStoresProductCount({ wix, siteId, artifactPath, query = { paging: { limit: 1, offset: 0 } } } = {}) {
  const request = w.buildQueryStoresProductsRequest(query);
  const artifact = artifactBase({
    command: 'stores product-count',
    siteId,
    endpoint: request.url,
    method: request.method,
  });
  try {
    const response = await wix.send(request);
    const products = response.products || [];
    artifact.count = Number.isInteger(response.totalCount) ? response.totalCount : products.length;
    artifact.status = 'passed';
  } catch (error) {
    artifact.status = 'failed';
    artifact.error = error && error.message ? error.message : String(error);
  }
  return writeArtifact(artifactPath, artifact);
}

async function verifyStoresProductBySourceMarker({ wix, siteId, artifactPath, markerPath, markerValue } = {}) {
  const query = queryFilterByMarker({ markerPath, markerValue });
  const request = w.buildQueryStoresProductsRequest(query);
  const artifact = artifactBase({
    command: 'stores product-by-source-marker',
    siteId,
    endpoint: request.url,
    method: request.method,
  });
  artifact.marker = { path: markerPath, value: markerValue };
  try {
    const response = await wix.send(request);
    artifact.products = (response.products || []).map((product) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      revision: product.revision,
    }));
    artifact.count = artifact.products.length;
    artifact.status = 'passed';
  } catch (error) {
    artifact.status = 'failed';
    artifact.error = error && error.message ? error.message : String(error);
  }
  return writeArtifact(artifactPath, artifact);
}

async function verifyStoresDeleteProbe({ wix, siteId, artifactPath, productId } = {}) {
  if (!productId) throw new Error('delete-probe requires --product-id');
  const request = w.buildDeleteStoresProductRequest(productId);
  const artifact = artifactBase({
    command: 'stores delete-probe',
    siteId,
    endpoint: request.url,
    method: request.method,
  });
  artifact.probeRecordId = productId;
  artifact.cleanup = { attempted: true, endpoint: request.url, method: request.method, status: 'unknown' };
  try {
    await wix.send(request);
    artifact.cleanup.status = 'deleted';
    artifact.status = 'passed';
  } catch (error) {
    artifact.cleanup.status = 'failed';
    artifact.status = 'failed';
    artifact.error = error && error.message ? error.message : String(error);
    artifact.warnings.push(`Probe product cleanup failed for ${productId}.`);
    artifact.recoveryInstructions.push(`Delete probe product ${productId} manually in Wix Stores and keep this artifact with the cleanup evidence.`);
  }
  return writeArtifact(artifactPath, artifact);
}

// Runs only against an explicitly selected, already-muted test target. All products are
// synthetic and hidden. The artifact is saved as IDs are acquired so cleanup is recoverable.
async function verifyStoresInventoryImport({ wix, siteId, artifactPath } = {}) {
  const inventory = require('./stores-inventory.js');
  const build = require('./wix-build.js');
  const artifact = artifactBase({ command: 'stores inventory-import', siteId, endpoint: '/stores/v3/bulk/inventory-items/create', method: 'POST' });
  artifact.probeProductIds = [];
  artifact.checks = [];
  let stockWrites = 0;
  const client = wix;
  wix = { ...client, send(request) {
    if (request.method !== 'GET' && /\/inventory-items(?:\/|$)/.test(request.url) && !request.url.endsWith('/query')) stockWrites++;
    return client.send(request);
  } };
  const check = (name, passed, detail) => {
    artifact.checks.push({ name, passed, detail });
    writeArtifact(artifactPath, artifact);
    if (!passed) throw new Error(`Inventory probe failed: ${name}`);
  };
  const marker = `inventory-probe-${Date.now()}`;
  const payload = (index, stock) => build.buildProduct({ name: `${marker}-${index}`, visible: false, productType: 'PHYSICAL', variants: [{ price: 1, ...(stock || {}) }] });
  try {
    const mute = await w.getSiteMuteState(wix);
    if (!mute || mute.muted !== true) throw new Error('Inventory probe requires an already-muted disposable test target');
    const locationId = await inventory.resolveInventoryLocation(wix);
    const rows = [];
    for (const [index, state] of [{ inStock: true }, { inStock: false }, { quantity: 0 }, { quantity: 7 }].entries()) {
      const product = await w.createStoresProduct(wix, payload(index));
      if (!product || !product.id) throw new Error('Probe product create returned no identity');
      artifact.probeProductIds.push(product.id); writeArtifact(artifactPath, artifact);
      const variants = product.variantsInfo && product.variantsInfo.variants;
      if (!Array.isArray(variants) || variants.length !== 1 || !variants[0].id) throw new Error('Probe product did not return one variant identity');
      rows.push({ productId: product.id, variantId: variants[0].id, inventory: state });
    }
    const created = await inventory.reconcileInventory(wix, rows, { locationId, expectedCount: 4, verifyAttempts: 5 });
    check('mixed stock create and read-back', created.complete && created.counts.created === 4, created);
    const changed = rows.map((r, i) => ({ ...r, inventory: i % 2 ? { inStock: false } : { quantity: 3 } }));
    const updated = await inventory.reconcileInventory(wix, changed, { locationId, expectedCount: 4, verifyAttempts: 5 });
    check('revisioned updates and tracking-mode changes', updated.complete && updated.counts.updated === 3, updated);
    const beforeRerun = stockWrites;
    const rerun = await inventory.reconcileInventory(wix, changed, { locationId, expectedCount: 4 });
    check('matching rerun performs no stock writes', rerun.complete && rerun.counts.reconciled === 4 && stockWrites === beforeRerun, { ...rerun, observedStockWrites: stockWrites - beforeRerun });
    const singleProduct = await w.createStoresProduct(wix, payload('single'));
    if (!singleProduct || !singleProduct.id) throw new Error('Single probe missing product identity');
    artifact.probeProductIds.push(singleProduct.id); writeArtifact(artifactPath, artifact);
    const singleRow = { productId: singleProduct.id, variantId: singleProduct.variantsInfo.variants[0].id, inventory: { inStock: false } };
    await w.createInventoryItem(wix, { productId: singleRow.productId, variantId: singleRow.variantId, inStock: false, trackQuantity: false });
    const single = await inventory.reconcileInventory(wix, [singleRow], { locationId, expectedCount: 1 });
    check('single-create helper and read-back', single.complete && single.counts.reconciled === 1, single);
    const bulk = await w.bulkCreateStoresProductsWithInventory(wix, [payload('inline-false', { inStock: false }), payload('inline-quantity', { inventoryTracked: true, inventoryQuantity: 5 })], { returnEntity: true });
    for (const result of bulk.results) if (result.success && result.productId) artifact.probeProductIds.push(result.productId);
    writeArtifact(artifactPath, artifact);
    check('inline bulk product creation', bulk.succeeded.length === 2 && bulk.unaccounted === 0, { successes: bulk.succeeded.length, unaccounted: bulk.unaccounted });
    const inlineRows = bulk.succeeded.map((r) => {
      const variants = r.product && r.product.variantsInfo && r.product.variantsInfo.variants;
      if (!variants || variants.length !== 1 || !variants[0].id) throw new Error('Inline probe missing variant identity');
      return { productId: r.productId, variantId: variants[0].id, inventory: r.inputProduct.variantsInfo.variants[0].inventoryItem };
    });
    const inline = await inventory.reconcileInventory(wix, inlineRows, { locationId, expectedCount: 2 });
    check('inline stock persisted without repair', inline.complete && inline.counts.reconciled === 2, inline);
    artifact.status = 'passed';
  } catch (error) { artifact.status = 'failed'; artifact.error = error.message; }
  finally {
    artifact.cleanup = { attempted: artifact.probeProductIds.length > 0, status: artifact.probeProductIds.length ? 'deleted' : 'not_applicable', failedProductIds: [] };
    for (const id of artifact.probeProductIds) {
      try { await w.deleteStoresProduct(wix, id); }
      catch (_) { artifact.cleanup.failedProductIds.push(id); }
    }
    if (artifact.cleanup.failedProductIds.length) {
      artifact.cleanup.status = 'failed'; artifact.status = 'failed';
      artifact.recoveryInstructions.push('Delete only the probe product IDs listed in cleanup.failedProductIds.');
    }
  }
  return writeArtifact(artifactPath, artifact);
}

module.exports = {
  DEFAULT_VERIFIED_SUBSCRIPTION_PATHS,
  defaultProbeProduct,
  queryFilterByMarker,
  valueAtPath,
  verifyPaths,
  verifyStoresSubscriptionCreate,
  verifyStoresProductCount,
  verifyStoresProductBySourceMarker,
  verifyStoresDeleteProbe,
  verifyStoresInventoryImport,
};
