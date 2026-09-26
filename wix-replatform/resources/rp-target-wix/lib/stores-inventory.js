'use strict';

const BASE = 'https://www.wixapis.com/stores/v3';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const BATCH_LIMIT = 1000;
const OUTCOMES = ['reconciled', 'created', 'updated', 'failed', 'unverified'];

// Inventory's tracking method is a oneof. trackQuantity is derived, never writable.
function stockPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventory needs an explicit tracking method');
  if (Object.keys(value).some((key) => !['inStock', 'quantity', 'trackQuantity'].includes(key))) throw new Error('Unsupported inventory stock field');
  const hasStock = own(value, 'inStock');
  const hasQuantity = own(value, 'quantity');
  if (hasStock === hasQuantity) throw new Error('Inventory needs exactly one of inStock or quantity');
  if (hasStock && typeof value.inStock !== 'boolean') throw new Error('inStock must be boolean');
  if (hasQuantity && (!Number.isInteger(value.quantity) || value.quantity < 0 || value.quantity > 99999)) {
    throw new Error('Inventory quantity must be an integer from 0 to 99999');
  }
  if (own(value, 'trackQuantity') && value.trackQuantity !== hasQuantity) throw new Error('Conflicting trackQuantity');
  return hasStock ? { inStock: value.inStock } : { quantity: value.quantity };
}

function inventoryForVariant(variant, { inStock } = {}) {
  const has = (key) => own(variant, key) && variant[key] != null && variant[key] !== '';
  if (has('inventoryTracked') && typeof variant.inventoryTracked !== 'boolean') throw new Error('inventoryTracked must be boolean');
  if (has('inStock') && typeof variant.inStock !== 'boolean') throw new Error('inStock must be boolean');
  if (variant.inventoryTracked === true || (has('inventoryQuantity') && variant.inventoryTracked !== false)) {
    const result = stockPayload({ quantity: variant.inventoryQuantity });
    if (has('inStock') && variant.inStock !== (result.quantity > 0)) throw new Error('Conflicting inventory status and quantity');
    return result;
  }
  if (variant.inventoryTracked === false && has('inventoryQuantity')) throw new Error('Untracked inventory cannot carry a quantity');
  if (has('inStock')) return stockPayload({ inStock: variant.inStock });
  if (variant.inventoryTracked === false) throw new Error('Untracked inventory needs explicit inStock');
  if (inStock !== undefined) return stockPayload({ inStock });
  return null;
}

function identity(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Inventory requires ${name}`);
  return value;
}

async function resolveInventoryLocationDetails(wix, locationId) {
  const filter = locationId ? { id: identity(locationId, 'locationId') } : { defaultLocation: true };
  const response = await wix.send({ method: 'POST', url: `${BASE}/locations/query`, body: { query: { filter, cursorPaging: { limit: 2 } } } });
  const rows = response && response.storesLocations;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].id ||
      (locationId ? rows[0].id !== locationId : rows[0].defaultLocation !== true)) {
    throw new Error('Inventory location must resolve to exactly one matching Stores location');
  }
  if (typeof rows[0].defaultLocation !== 'boolean') throw new Error('Stores location omitted its default-location status');
  return rows[0];
}

async function resolveInventoryLocation(wix, locationId) {
  return (await resolveInventoryLocationDetails(wix, locationId)).id;
}

// Complete, bounded read: missing payloads and repeating cursors never mean an empty target.
async function readInventory(wix, rows, locationId) {
  const wanted = new Map(rows.map((r) => [r.variantId, r]));
  const found = new Map();
  const cursors = new Set();
  let cursor;
  do {
    const response = await wix.send({ method: 'POST', url: `${BASE}/inventory-items/query`, body: {
      query: { ...(!cursor ? { filter: { variantId: { $in: [...wanted.keys()] }, locationId } } : {}), cursorPaging: { limit: BATCH_LIMIT, ...(cursor ? { cursor } : {}) } },
    } });
    if (!response || !Array.isArray(response.inventoryItems) || !response.pagingMetadata || typeof response.pagingMetadata !== 'object') throw new Error('Malformed inventory query response');
    for (const item of response.inventoryItems) {
      const expected = wanted.get(item.variantId);
      if (!expected || item.productId !== expected.productId || item.locationId !== locationId || !item.id) {
        throw new Error('Inventory query returned a mismatched identity');
      }
      if (found.has(item.variantId)) throw new Error('Duplicate inventory identity');
      found.set(item.variantId, item);
    }
    cursor = response.pagingMetadata && response.pagingMetadata.cursors && response.pagingMetadata.cursors.next;
    if (response.pagingMetadata.hasNext === true && !cursor) throw new Error('Inventory query omitted its next cursor');
    if (cursor && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('Invalid inventory paging cursor');
    if (cursor) cursors.add(cursor);
    // At most one row per requested variant/location. A full extra page cannot be legitimate.
    if (cursors.size > rows.length + 1) throw new Error('Inventory query exceeded its bounded population');
  } while (cursor);
  return found;
}

function matchesInventory(item, inventory) {
  if (!item || (item.preorderInfo && item.preorderInfo.enabled)) return false;
  const tracked = own(inventory, 'quantity');
  const available = tracked ? inventory.quantity > 0 : inventory.inStock;
  return item.trackQuantity === tracked &&
    (tracked ? item.quantity === inventory.quantity : item.inStock === inventory.inStock) &&
    item.availabilityStatus === (available ? 'IN_STOCK' : 'OUT_OF_STOCK');
}

// Catalog is a separate event-driven projection of default-location inventory.
// Check exact variant IDs even on no-write reruns; never rewrite stock to force propagation.
async function verifyCatalogInventory(wix, rows, { verifyAttempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!['reconciled', 'created', 'updated'].includes(row.outcome)) continue;
    if (!groups.has(row.productId)) groups.set(row.productId, []);
    groups.get(row.productId).push({ row, inventoryOutcome: row.outcome });
  }
  const pending = [...groups.entries()];
  let index = 0;
  async function worker() {
    while (index < pending.length) {
      const [productId, entries] = pending[index++];
      for (let attempt = 0; attempt < verifyAttempts; attempt++) {
        try {
          const response = await wix.send({ method: 'GET', url: `${BASE}/products/${encodeURIComponent(productId)}` });
          const product = response && response.product;
          if (!product || product.id !== productId || !product.variantsInfo || !Array.isArray(product.variantsInfo.variants)) {
            throw new Error('Catalog read omitted the expected product/variants');
          }
          const variants = new Map();
          for (const variant of product.variantsInfo.variants) {
            if (!variant.id || variants.has(variant.id)) throw new Error('Catalog read returned invalid or duplicate variant identity');
            variants.set(variant.id, variant);
          }
          for (const { row, inventoryOutcome } of entries) {
            const variant = variants.get(row.variantId);
            const expected = own(row.inventory, 'quantity') ? row.inventory.quantity > 0 : row.inventory.inStock;
            const status = variant && variant.inventoryStatus;
            const matches = status && status.inStock === expected && status.preorderEnabled === false;
            row.catalogVerification = { status: matches ? 'verified' : 'unverified', expectedInStock: expected,
              actualInStock: status && typeof status.inStock === 'boolean' ? status.inStock : null };
            row.outcome = matches ? inventoryOutcome : 'unverified';
            if (matches) delete row.error;
            else row.error = 'Catalog variant availability does not confirm default-location inventory';
          }
          if (entries.every(({ row }) => row.catalogVerification.status === 'verified')) break;
        } catch (error) {
          for (const { row } of entries) Object.assign(row, { outcome: 'unverified', error: error.message, catalogVerification: { status: 'unverified' } });
        }
        if (attempt + 1 < verifyAttempts) await sleep(500 * (attempt + 1));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
  return rows;
}

function correlateBulk(response, input) {
  const bulk = require('./bulk-results');
  const result = bulk.correlateBulk(response, input, bulk.adapters.inventory);
  if (result.defects.length || result.unaccounted || result.undetailedFailures) {
    throw new Error('Inventory bulk response has invalid correlation or does not account for every input');
  }
  return result.results.map(r => ({ row: r.input, success: r.success, error: r.raw.itemMetadata.error || null }));
}

function buildInventoryReport(rows, gaps = []) {
  const counts = Object.fromEntries(OUTCOMES.map((key) => [key, 0]));
  for (const row of rows) {
    if (!OUTCOMES.includes(row.outcome)) throw new Error('Unknown inventory outcome');
    counts[row.outcome]++;
  }
  counts['decision-needed'] = gaps.length;
  return { rows, gaps, counts, intended: rows.length + gaps.length,
    complete: rows.length > 0 && counts.failed === 0 && counts.unverified === 0 && gaps.length === 0,
    status: rows.length + gaps.length === 0 ? 'no-data' : counts.failed || counts.unverified || gaps.length ? 'partial' : 'complete' };
}

async function persistInventoryReport(file, report) {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const crypto = require('node:crypto');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

// Input IDs come from the product/variant crosswalk, including products created on earlier runs.
// Query and verify even after inline product/inventory create; a product receipt isn't stock proof.
async function reconcileInventory(wix, input, { locationId, gaps = [], expectedCount, verifyAttempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!Array.isArray(input) || !Array.isArray(gaps)) throw new Error('Inventory rows and gaps must be arrays');
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount !== input.length + gaps.length) {
    throw new Error('Inventory rows and gaps must account for the explicit source-variant expectedCount');
  }
  if (!Number.isInteger(verifyAttempts) || verifyAttempts < 1 || verifyAttempts > 5) throw new Error('verifyAttempts must be 1–5');
  const seen = new Set();
  const rows = input.map((row) => {
    const productId = identity(row.productId, 'productId');
    const variantId = identity(row.variantId, 'variantId');
    if (seen.has(variantId)) throw new Error('Duplicate input variant identity');
    seen.add(variantId);
    return { productId, variantId, inventory: stockPayload(row.inventory), outcome: 'unverified' };
  });
  if (!rows.length) return buildInventoryReport(rows, gaps);
  let resolved, isDefault;
  try { const location = await resolveInventoryLocationDetails(wix, locationId); resolved = location.id; isDefault = location.defaultLocation; }
  catch (error) { return buildInventoryReport(rows.map((r) => ({ ...r, outcome: 'failed', error: error.message })), gaps); }
  for (let start = 0; start < rows.length; start += BATCH_LIMIT) {
    const batch = rows.slice(start, start + BATCH_LIMIT);
    let existing;
    try { existing = await readInventory(wix, batch, resolved); }
    catch (error) { for (const row of batch) Object.assign(row, { outcome: 'failed', error: error.message }); continue; }
    const create = [], update = [];
    for (const row of batch) {
      row.locationId = resolved;
      const item = existing.get(row.variantId);
      if (item && item.preorderInfo && item.preorderInfo.enabled) {
        Object.assign(row, { outcome: 'failed', error: 'Existing preorder policy requires a mapping decision' });
      } else if (matchesInventory(item, row.inventory)) {
        Object.assign(row, { outcome: 'reconciled', inventoryItemId: item.id });
      } else if (!item) create.push(row);
      else if (item.revision == null) Object.assign(row, { outcome: 'failed', error: 'Inventory update needs a current revision' });
      else { row.inventoryItemId = item.id; row.revision = item.revision; update.push(row); }
    }
    for (const [operation, pending] of [['create', create], ['update', update]]) {
      if (!pending.length) continue;
      try {
        const inventoryItems = pending.map((row) => operation === 'create'
          ? { productId: row.productId, variantId: row.variantId, locationId: resolved, ...row.inventory }
          : { inventoryItem: { id: row.inventoryItemId, revision: row.revision, ...row.inventory } });
        const response = await wix.send({ method: 'POST', url: `${BASE}/bulk/inventory-items/${operation}`, body: { inventoryItems, returnEntity: false } });
        for (const result of correlateBulk(response, pending)) {
          if (result.success) result.row.writeOutcome = operation === 'create' ? 'created' : 'updated';
          else Object.assign(result.row, { outcome: 'failed', error: result.error || 'Inventory item write failed' });
        }
      } catch (error) { for (const row of pending) Object.assign(row, { outcome: 'failed', error: error.message }); }
    }
    const written = batch.filter((r) => r.writeOutcome && r.outcome !== 'failed');
    if (!written.length) continue;
    for (let attempt = 0; attempt < verifyAttempts; attempt++) {
      try {
        const back = await readInventory(wix, written, resolved);
        for (const row of written) {
          const item = back.get(row.variantId);
          if (matchesInventory(item, row.inventory)) { Object.assign(row, { outcome: row.writeOutcome, inventoryItemId: item.id }); delete row.error; delete row.inventoryVerification; }
          else Object.assign(row, { outcome: 'unverified', error: item ? 'Inventory read-back differs from intended tracking, stock or availability' : 'Inventory item missing from read-back', inventoryVerification: { expected: row.inventory, actual: item ? { trackQuantity: item.trackQuantity, inStock: item.inStock, quantity: item.quantity, availabilityStatus: item.availabilityStatus } : null } });
        }
        if (written.every((r) => r.outcome !== 'unverified')) break;
      } catch (error) { for (const row of written) Object.assign(row, { outcome: 'unverified', error: error.message }); }
      if (attempt + 1 < verifyAttempts) await sleep(250 * (attempt + 1));
    }
  }
  if (isDefault) await verifyCatalogInventory(wix, rows, { verifyAttempts, sleep });
  else for (const row of rows) row.catalogVerification = { status: 'not-applicable', reason: 'non-default-location' };
  return buildInventoryReport(rows, gaps);
}

module.exports = { stockPayload, inventoryForVariant, resolveInventoryLocation, readInventory, matchesInventory, verifyCatalogInventory, correlateBulk, reconcileInventory, buildInventoryReport, persistInventoryReport, BATCH_LIMIT };
