'use strict';

// Design v2 K3: back-in-stock requests run inside the shared loop (import-task-runner.js
// runRecordTask). Generated code gives only build(record, lookups):
//   { request: { email, catalogReference: { catalogItemId } }, loopInput: { notified } }
// with catalogItemId from lookups.ref('stores/product', …, 'request.catalogReference.catalogItemId').
// Which source rows are live, which statuses count as "already notified", and what to do with a
// variation-level subscription are plan choices. This file is the fixed part:
//   - itemDetails (name, price) is read from the imported Wix product at write time, unless the
//     build gives it, so the request shows what the shop now sells;
//   - create: createBackInStockRequest, which never makes a second request for the same shopper and
//     item (a known request id is read and reused; a 409 is matched client-side). Creating sends
//     no email;
//   - mark: a shopper the source already notified is marked "notification sent" offline (no email);
//     a mark not confirmed leaves the request imported with the step owed, resumed next pass;
//   - collection not started (setup step start-back-in-stock-collection missing) and an
//     unresolved duplicate become cutover items; nothing is guessed.
// The loop writes the crosswalk (`ownsCrosswalk: false`).

const STEP_DONE = 'done';
const writers = () => require('../resources/rp-target-wix/lib/wix-writers');

// Name and price of the imported product, read on the record's own client.
async function itemDetailsDefault(client, productId) {
  const w = writers();
  const product = await w.getStoresProduct(client, productId);
  const variants = await w.queryStoresProductVariants(client, { filter: { 'productData.productId': { $eq: productId } }, paging: { limit: 1 } });
  const price = variants?.[0]?.price?.actualPrice?.amount;
  return product?.name && price !== undefined ? { name: String(product.name), price: String(price) } : null;
}

const backInStock = {
  operation: 'createBackInStockRequest', steps: ['create', 'mark'], ownsCrosswalk: false,
  async send(client, payload, record, c) {
    const input = c.loopInput || {}, steps = {};
    const productId = payload?.request?.catalogReference?.catalogItemId;
    let itemDetails = payload?.itemDetails;
    if (!itemDetails) {
      try { itemDetails = await c.primitives.backInStockItemDetails(client, productId); }
      catch (error) { if (c.isInterruption?.(error)) throw error; itemDetails = null; }
      if (!itemDetails) return { base: { outcome: 'back-in-stock-item-details-unreadable', writeAttempted: false, error: Object.assign(new Error('the imported Wix product has no readable name or price for itemDetails'), { code: 'back-in-stock-item-details-unreadable' }) }, steps };
    }
    let result;
    try {
      result = await c.primitives.createBackInStockRequest(client, { ...payload, itemDetails, notified: Boolean(input.notified), knownRequestId: c.existingTargetId || null });
    } catch (error) {
      if (c.isInterruption?.(error)) throw error;
      if (error?.code === 'BACK_IN_STOCK_COLLECTION_DISABLED') {
        await c.recordGap('back-in-stock-collection-disabled', { severity: 'high',
          action: 'These back-in-stock requests were not written: the site is not collecting back-in-stock requests yet. Run the setup step start-back-in-stock-collection (it also shows "Notify When Available" on out-of-stock products), then rerun the back-in-stock import.',
          detail: {} });
        return { base: { outcome: 'back-in-stock-collection-disabled', writeAttempted: false, error }, steps };
      }
      // The request exists; only its offline mark failed with a known answer.
      if (error?.requestId) return { base: { targetId: String(error.requestId), outcome: 'back-in-stock-created' }, steps: { create: STEP_DONE, mark: 'mark-failed' } };
      throw error;
    }
    if (result?.outcome === 'deferred') {
      await c.recordGap('back-in-stock-duplicate-unresolved', { operatorRole: 'Cutover Operator', severity: 'low',
        action: 'Wix already holds a back-in-stock request for the same shopper and item, but it could not be matched to exactly one request. Nothing was written for these source requests. In Business Manager → Store → Back in stock, confirm the shopper is on the list for the item; no other action is needed.',
        detail: { reason: result.deferralReason || 'back-in-stock-duplicate-unresolved' } });
      return { deferred: result.deferralReason || 'back-in-stock-duplicate-unresolved' };
    }
    const requestId = result?.request?.id || result?.requestId;
    if (!requestId) return { base: { outcome: 'back-in-stock-no-id', unverified: true, error: Object.assign(new Error('back-in-stock create returned no request id'), { outcomeKnown: false }) }, steps };
    steps.create = STEP_DONE;
    steps.mark = result.outcome === 'mark-unverified' ? 'mark-unverified' : STEP_DONE;
    return { base: { targetId: String(requestId), outcome: result.outcome === 'reused' ? 'back-in-stock-reused' : 'back-in-stock-created' }, steps };
  },
};

const primitives = {
  createBackInStockRequest: (client, options) => writers().createBackInStockRequest(client, options),
  backInStockItemDetails: itemDetailsDefault,
};

module.exports = { COMPOSITES: { 'stores/back-in-stock-request': backInStock }, primitives };
