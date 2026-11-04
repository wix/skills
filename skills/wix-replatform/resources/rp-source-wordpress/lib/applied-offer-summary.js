'use strict';

// Cart-offer plugins (e.g. WM Cart Benefits) keep their offer definitions where no
// channel reaches them, but every order line an offer added carries the offer id as line meta. The
// orders already extracted are therefore enough to tell the merchant which offers were live, on
// which products, at what price and how often, so each can be re-created as a Wix Automatic
// Discount. The markers come from the profiles' `appliedOffers`; a new cart-offer plugin is data.
// Pure: the caller passes the extracted wc/v3/orders rows. Ids, prices and counts only.

function metaValue(metaData, key) {
  for (const entry of Array.isArray(metaData) ? metaData : []) {
    if (entry && entry.key === key && entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== '') return String(entry.value).trim();
  }
  return null;
}

function defaultMarkers() {
  // eslint-disable-next-line global-require
  return require('./plugin-knowledge.js').buildAppliedOfferMarkers();
}

// -> [{ plugin, displayName, offerId, orders, lines, products: [{ productId, unitPrices: [..] }],
//       grantsFreeShipping, firstSeen, lastSeen }]   (each product also carries the line's `name`)
function summarizeAppliedOffers({ orders = [], markers = null } = {}) {
  const list = Array.isArray(markers) ? markers : defaultMarkers();
  const offers = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const created = order && (order.date_created_gmt || order.date_created) ? String(order.date_created_gmt || order.date_created).slice(0, 10) : null;
    for (const marker of list) {
      const seenHere = new Set();
      for (const line of (order && order.line_items) || []) {
        const offerId = metaValue(line.meta_data, marker.lineMetaKey);
        if (!offerId) continue;
        const key = `${marker.plugin}\u0000${offerId}`;
        if (!offers.has(key)) offers.set(key, { plugin: marker.plugin, displayName: marker.displayName, offerId, orders: 0, lines: 0, products: new Map(), grantsFreeShipping: false, firstSeen: null, lastSeen: null });
        const offer = offers.get(key);
        offer.lines += 1;
        const productId = String(line.variation_id || line.product_id || '');
        const quantity = Number(line.quantity) || 1;
        const unit = Number(line.subtotal);
        const unitPrice = Number.isFinite(unit) ? (unit / quantity).toFixed(2) : null;
        if (!offer.products.has(productId)) offer.products.set(productId, { name: line.name ? String(line.name) : null, prices: new Set() });
        if (unitPrice !== null) offer.products.get(productId).prices.add(unitPrice);
        if (!seenHere.has(key)) {
          seenHere.add(key);
          offer.orders += 1;
          if (created) {
            if (!offer.firstSeen || created < offer.firstSeen) offer.firstSeen = created;
            if (!offer.lastSeen || created > offer.lastSeen) offer.lastSeen = created;
          }
        }
      }
      if (marker.orderFreeShippingMetaKey) {
        const shippingOfferId = metaValue(order && order.meta_data, marker.orderFreeShippingMetaKey);
        const offer = shippingOfferId && offers.get(`${marker.plugin}\u0000${shippingOfferId}`);
        if (offer) offer.grantsFreeShipping = true;
      }
    }
  }
  return [...offers.values()]
    .map((offer) => ({ ...offer, products: [...offer.products.entries()].map(([productId, { name, prices }]) => ({ productId, name, unitPrices: [...prices].sort() })).sort((a, b) => a.productId.localeCompare(b.productId)) }))
    .sort((a, b) => a.plugin.localeCompare(b.plugin) || a.offerId.localeCompare(b.offerId));
}

// The completion report keeps an action's text, not its free-form fields, so what the operator needs
// to re-create each offer is written into the action itself. Bounded: a store with many offers lists
// the busiest and counts the rest.
const OFFERS_IN_TEXT = 20;
function describeOffer(offer) {
  const products = offer.products.map((p) => `${p.name ? `"${p.name}" ` : ''}(source #${p.productId})${p.unitPrices.length ? ` at ${p.unitPrices.join(' / ')}` : ''}`).join(', ');
  const seen = offer.firstSeen ? `, ${offer.firstSeen === offer.lastSeen ? offer.firstSeen : `${offer.firstSeen} to ${offer.lastSeen}`}` : '';
  return `offer ${offer.offerId}: ${products || 'no product recorded'}; ${offer.orders} order(s)${seen}${offer.grantsFreeShipping ? '; also gave free shipping' : ''}`;
}

// One completion-report operatorActions row per plugin: re-create each listed offer as a Wix
// Automatic Discount, or mark it not needed. Merge by `code` into createCompletionReport() input.
function appliedOfferOperatorActions({ orders = [], markers = null } = {}) {
  const offers = summarizeAppliedOffers({ orders, markers });
  const byPlugin = new Map();
  for (const offer of offers) {
    if (!byPlugin.has(offer.plugin)) byPlugin.set(offer.plugin, []);
    byPlugin.get(offer.plugin).push(offer);
  }
  return [...byPlugin.entries()].map(([plugin, rows]) => ({
    code: 'cart-offer-recreate-in-wix',
    actionId: `cart-offer-recreate-in-wix:${plugin}`,
    severity: 'medium',
    entity: 'ecom/discount-rule',
    role: 'cutover-operator',
    action: `${rows[0].displayName || plugin} gave these cart offers on the old store. They do not move automatically. In Business Manager → Marketing → Automatic Discounts, create one discount per offer, or mark it not needed. Wix applies the price at checkout; it does not show the offer inside the cart. ${[...rows].sort((a, b) => b.orders - a.orders || a.offerId.localeCompare(b.offerId)).slice(0, OFFERS_IN_TEXT).map(describeOffer).join('. ')}.${rows.length > OFFERS_IN_TEXT ? ` And ${rows.length - OFFERS_IN_TEXT} more offer(s), listed by id.` : ''}`,
    consequence: 'Until re-created, these offer prices are not available on Wix.',
    deadlineReason: 'Before the DNS switch.',
    resolutionEvidence: 'An automatic discount exists for each offer, or the operator records it as not needed.',
    affectedCount: rows.length,
    affectedIds: rows.map((row) => row.offerId),
    details: rows.map(({ offerId, orders: orderCount, lines, products, grantsFreeShipping, firstSeen, lastSeen }) => ({ offerId, orders: orderCount, lines, products, grantsFreeShipping, firstSeen, lastSeen })),
  }));
}

module.exports = { summarizeAppliedOffers, appliedOfferOperatorActions };
