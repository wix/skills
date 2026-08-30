'use strict';

const { isBlank } = require('./value-utils.js');

// rp-target-wix — spec 0042 Decision 2: the `channelInfo` segment of a POST /ecom/v1/orders/import
// request body. A small, standalone builder rather than a full order-payload builder because full
// order assembly (line items, discounts, refunds, tax, shipping) is explicitly out of scope for
// spec 0042 (left for rp-import-codegen, not yet built) — this covers exactly the one piece spec
// 0042 Decision 2 designs: always setting a durable pointer back to the source order.
//
// `channelInfo.externalOrderId`/`externalOrderUrl` is a real, documented Wix order field
// ("Reference to an order ID from an external system" — dev.wix.com order object, verified
// 2026-08-17), not invented for this migration. It matters beyond idempotency: unlike the local
// crosswalk.ndjson, this is visible to the merchant and support staff directly on the
// order in the Wix dashboard.
//
// NOT runtime-verified: this builder has not itself been sent to a live Import Order call (spec
// 0042's own live verification exercised gift-card issuance/redemption, not channelInfo). The
// shape matches the documented field, but treat this the same as the rest of spec 0042's
// code-exists-not-runtime-verified pieces until a live Import Order call confirms it.

const CHANNEL_TYPE_OTHER_PLATFORM = 'OTHER_PLATFORM';

// `order` is the raw WooCommerce order (GET /wc/v3/orders/{id} shape) — only `order.id` is used.
// `options.externalOrderUrl`, if given, is passed through as-is. Deliberately NOT constructed
// here: a WooCommerce order's admin edit URL differs between legacy post-based storage
// (`post.php?post=<id>&action=edit`) and High-Performance Order Storage
// (`admin.php?page=wc-orders&action=edit&id=<id>`), and only the caller (which already knows the
// source site's admin base URL and storage mode) can tell which applies — guessing one would risk
// a dead link on the exact fact this field exists to make trustworthy. Per spec 0042 Decision 2,
// "if constructible" — omitting it here when the caller has nothing to pass is the correct,
// documented behavior, not a gap.
function buildChannelInfo(order, options) {
  const { externalOrderUrl } = options || {};
  const notes = [];

  if (order == null || isBlank(order.id)) {
    return {
      channelInfo: null,
      gaps: [{
        code: 'missing-external-order-id',
        summary: 'order.id is required to build channelInfo.externalOrderId — without it, this order has no durable pointer back to its source.',
      }],
      notes,
    };
  }

  const channelInfo = {
    type: CHANNEL_TYPE_OTHER_PLATFORM,
    externalOrderId: String(order.id),
  };

  if (!isBlank(externalOrderUrl)) {
    channelInfo.externalOrderUrl = externalOrderUrl;
  } else {
    notes.push('externalOrderUrl omitted — not constructible from the WooCommerce order alone (legacy post.php vs HPOS wc-orders admin URL shapes differ); pass options.externalOrderUrl when the caller can build it for this site.');
  }

  return { channelInfo, gaps: [], notes };
}

module.exports = {
  CHANNEL_TYPE_OTHER_PLATFORM,
  buildChannelInfo,
};
