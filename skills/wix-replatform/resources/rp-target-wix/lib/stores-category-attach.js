'use strict';

// Product category attachment: write, then verify -- the identical discipline
// stores-inventory.js already applies to stock, now applied to the category-membership link.
//
// THE FAILURE THIS GUARDS AGAINST: a generated importer's call site passed
// `bulkAddItemToCategories(wix, categoryIds, [productId])` -- THREE positional arguments to a
// function declared `(wix, payload)`. JS drops the extra argument silently, so `payload` became
// the bare `categoryIds` array; destructuring `{ productId, categoryIds }` off an array yields
// `undefined` for both fields on every single call. Every request this importer ever sent to
// `/categories/v1/bulk/categories/add-item` carried two undefined required fields. Wix almost
// certainly rejected every one, and the call site's own `catch {}` swallowed every failure with a
// comment that falsely claimed it was "reported via completion mismatch" -- nothing tracked this
// step at all, so the loss was invisible end to end: no retro, no QA, no completion-report
// mismatch, ever. This file exists so that failure mode cannot recur unseen: the write call below
// takes the exact shape the writer declares, and nothing is marked attached until a fresh read
// confirms it.
//
// `bulkAddItemToCategories` is an ADD, not a replace/set -- a product may legitimately carry other
// category memberships from elsewhere (or from an earlier partial run). The read-back check below
// only ever confirms "every expected categoryId is present in the actual set", never exact
// equality; never do a set-equality check here.

const w = require('./wix-writers.js');

const OUTCOMES = ['category-attach-written', 'category-attach-reconciled-existing', 'category-attach-unverified', 'category-attach-failed'];

function identity(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Category attachment requires ${name}`);
  return value;
}

// A row exists only for a product that needs at least one category attached. A product with
// nothing to attach is never given a row at all -- it is not a gap, there is nothing orthogonal
// to track -- so an empty/missing categoryIds array is a caller bug, not a valid empty state.
function categoryIdsOf(value) {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Category attachment requires at least one categoryId; a product with nothing to attach should not be passed as a row');
  }
  return [...new Set(value.map((id, index) => identity(id, `categoryIds[${index}]`)))];
}

function hasAllCategories(actual, expected) {
  if (!actual) return false;
  return expected.every((id) => actual.has(id));
}

// VERIFIED (2026-08-12, wix-writers.js queryAllStoresProducts): `fields: ['DIRECT_CATEGORIES_INFO']`
// as a sibling of `query` (not nested inside it) on POST /stores/v3/products/query returns
// `directCategoriesInfo.categories[]` per product; a plain query omits categories entirely. The
// per-item shape of that array is not itself pinned down by that verification, so this treats an
// entry as either a bare category-id string or an `{ id }` object and takes whichever is present
// -- defensive, not a guess that silently drops a real id either way.
async function queryOneProductCategories(wix, productId) {
  const response = await wix.send(w.buildQueryStoresProductsRequest(
    { filter: { id: { $eq: productId } }, cursorPaging: { limit: 1 } },
    ['DIRECT_CATEGORIES_INFO'],
  ));
  if (!response || !Array.isArray(response.products)) throw new Error('Malformed category query response');
  const product = response.products.find((p) => p && p.id === productId);
  if (!product) return null;
  const categories = (product.directCategoriesInfo && Array.isArray(product.directCategoriesInfo.categories))
    ? product.directCategoriesInfo.categories : [];
  return new Set(categories.map((c) => (typeof c === 'string' ? c : c && c.id)).filter(Boolean));
}

// Best-effort only: a failed or inconclusive pre-read never blocks the write path, it only costs
// the no-write optimization below. Correctness lives entirely in the post-write verify step.
async function preCheckExisting(wix, rows) {
  const pending = rows.slice();
  let index = 0;
  async function worker() {
    while (index < pending.length) {
      const row = pending[index++];
      try {
        const actual = await queryOneProductCategories(wix, row.productId);
        if (hasAllCategories(actual, row.categoryIds)) row.alreadySatisfied = true;
      } catch { /* unknown -- fall through to the write path */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
}

// A write receipt is never proof -- see stores-inventory.js's verifyCatalogInventory for the same
// discipline applied to stock. Bounded retries, worker-pool concurrency, independent per product.
async function verifyCategoryAttachment(wix, rows, { verifyAttempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const pending = rows.slice();
  let index = 0;
  async function worker() {
    while (index < pending.length) {
      const row = pending[index++];
      for (let attempt = 0; attempt < verifyAttempts; attempt++) {
        try {
          const actual = await queryOneProductCategories(wix, row.productId);
          if (hasAllCategories(actual, row.categoryIds)) {
            row.outcome = 'category-attach-written';
            delete row.error;
            break;
          }
          row.outcome = 'category-attach-unverified';
          row.error = actual ? 'Category read-back is missing one or more expected categoryIds' : 'Product missing from category read-back';
        } catch (error) {
          row.outcome = 'category-attach-unverified';
          row.error = error.message;
        }
        if (attempt + 1 < verifyAttempts) await sleep(250 * (attempt + 1));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
}

// rows: [{ productId, categoryIds, sourceKey? }] -- one row per product needing at least one
// category attached. Never swallows a write error silently: every per-row failure is caught,
// recorded with its message, and left `failed` rather than disappearing into a wrapping catch.
async function reconcileCategoryAttachment(wix, rows, { verifyAttempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!Array.isArray(rows)) throw new Error('Category attachment rows must be an array');
  if (!Number.isInteger(verifyAttempts) || verifyAttempts < 1 || verifyAttempts > 5) throw new Error('verifyAttempts must be 1-5');
  const seen = new Set();
  const normalized = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Category attachment rows[${index}] must be an object`);
    const productId = identity(row.productId, 'productId');
    if (seen.has(productId)) throw new Error('Duplicate input product identity');
    seen.add(productId);
    const categoryIds = categoryIdsOf(row.categoryIds);
    const sourceKey = row.sourceKey === undefined || row.sourceKey === null ? null : identity(row.sourceKey, 'sourceKey');
    return { productId, categoryIds, sourceKey, outcome: 'category-attach-unverified' };
  });
  if (!normalized.length) return buildCategoryAttachReport(normalized);

  // Step 1: skip the write for a product whose existing categories already satisfy the intended
  // set -- the "reconciled-existing" twin of stores-inventory's no-write rerun.
  await preCheckExisting(wix, normalized);
  const pending = [];
  for (const row of normalized) {
    if (row.alreadySatisfied) { row.outcome = 'category-attach-reconciled-existing'; delete row.alreadySatisfied; }
    else pending.push(row);
  }

  // Step 2: write. The endpoint takes exactly ONE item plus its category ids -- never a batch of
  // products -- so a per-row try/catch IS the correlation; there is no bulk response to misread.
  // This is the exact call the failure above got wrong: { productId, categoryIds }, nothing else.
  const written = [];
  for (const row of pending) {
    try {
      await w.bulkAddItemToCategories(wix, { productId: row.productId, categoryIds: row.categoryIds });
      written.push(row);
    } catch (error) {
      row.outcome = 'category-attach-failed';
      row.error = error.message;
    }
  }

  // Step 3: read-back verify. Never mark a row attached off the write call's own success alone.
  await verifyCategoryAttachment(wix, written, { verifyAttempts, sleep });

  return buildCategoryAttachReport(normalized);
}

function buildCategoryAttachReport(rows) {
  const counts = Object.fromEntries(OUTCOMES.map((key) => [key, 0]));
  for (const row of rows) {
    if (!OUTCOMES.includes(row.outcome)) throw new Error('Unknown category-attach outcome');
    counts[row.outcome]++;
  }
  return {
    rows,
    counts,
    complete: rows.length > 0 && counts['category-attach-failed'] === 0 && counts['category-attach-unverified'] === 0,
    status: rows.length === 0 ? 'no-data' : (counts['category-attach-failed'] || counts['category-attach-unverified']) ? 'partial' : 'complete',
  };
}

async function persistCategoryAttachReport(file, report) {
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

// Turns a buildCategoryAttachReport() result into stageResiduals[] rows -- the orthogonal-axis
// mechanism completion-report.js already applies to orders' payment/refund/invoice sub-stages
// (see its doctrine comment above STAGE_RESIDUAL_OUTCOMES). A product whose import the entity row
// already counts as `imported` can still carry zero of its categories; the completeness arithmetic
// cannot see that on its own, so this is what makes it visible. Only ever emitted for the two
// failure-shaped outcomes -- a product that attached cleanly, or already carried its categories,
// contributes no residual row at all.
//
// `sourceKey` is optional on an input row (see reconcileCategoryAttachment's normalization), but a
// residual group must always carry SOME identifier a human/operator can act on -- a nonzero
// `count` with an empty `sourceKeys[]` is unactionable. `productId` is always present on every
// row (it is required, never optional), so it is the fallback identifier when no sourceKey was
// supplied: a target id is still enough to act on, and silently dropping it would be strictly
// worse.
function collectCategoryAttachStageResiduals(report, { entity = 'product', stage = 'category-attach' } = {}) {
  if (!report || !Array.isArray(report.rows)) throw new Error('category-attach report rows must be an array');
  const groups = new Map();
  for (const row of report.rows) {
    if (row.outcome !== 'category-attach-unverified' && row.outcome !== 'category-attach-failed') continue;
    if (!groups.has(row.outcome)) groups.set(row.outcome, { entity, stage, outcome: row.outcome, count: 0, sourceKeys: new Set() });
    const group = groups.get(row.outcome);
    group.count += 1;
    group.sourceKeys.add(row.sourceKey || row.productId);
  }
  return [...groups.values()].map((row) => ({ ...row, sourceKeys: [...row.sourceKeys] }));
}

module.exports = {
  OUTCOMES,
  hasAllCategories,
  queryOneProductCategories,
  reconcileCategoryAttachment,
  buildCategoryAttachReport,
  persistCategoryAttachReport,
  collectCategoryAttachStageResiduals,
};
