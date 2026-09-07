'use strict';

const fs = require('fs');
const path = require('path');
const w = require('./wix-writers');

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
    createdProduct = (await wix.send(createRequest)).product;
    artifact.probeRecordId = createdProduct && createdProduct.id;
    if (!artifact.probeRecordId) throw new Error('create response did not include product.id');

    const getRequest = w.buildGetStoresProductRequest(artifact.probeRecordId);
    artifact.readback = { endpoint: getRequest.url, method: getRequest.method };
    const readProduct = (await wix.send(getRequest)).product;
    artifact.verifiedPaths = verifyPaths({ product: readProduct }, DEFAULT_VERIFIED_SUBSCRIPTION_PATHS);
    artifact.constraintsDiscovered = w.STORES_SUBSCRIPTION_CONTRACT.constraints.map((constraint) => ({ ...constraint }));
    artifact.status = artifact.verifiedPaths.every((entry) => entry.present) ? 'passed' : 'failed';
    if (artifact.status === 'failed') {
      artifact.warnings.push('Subscription readback did not include every expected nested path.');
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
};
