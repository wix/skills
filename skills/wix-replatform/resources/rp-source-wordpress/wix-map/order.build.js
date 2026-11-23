'use strict';

// Sample builders for the WooCommerce order -> Wix order suggestions (order.json).
//
// Each exported row helper takes one WooCommerce order (GET /wc/v3/orders shape) and a context
//   { choices, resolveReference(entityRef, sourceKey, targetPath) -> wixId|null, storeCurrency,
//     contactKeyPrefix }
// and returns `{ record, findings, hold }`: the part of the Import Order body the row writes, the
// per-record notes, and a hold `{ code }` when the order must be held. `resolveReference` is the
// fixed loop's lookup (lib/import-task-runner.js hands it to build()); these builders never look
// anything up themselves. `buildOrder` merges every row; `orderHistoryEvidence` is the evidence
// for importOrderHistory (payments and refunds). Value choices come from `choices`, defaulting to
// order.json's `choices[].default`. An operator change goes into the plan, not into this file.

const { decodeHtmlEntities } = require('../../../lib/link-census.js');
const { resolveOrderCurrency } = require('../lib/store-currency.js');
const { resolveOfflinePayment, resolveTransactionReference } = require('../lib/gateway-source-keys.js');
const { qualifyRefund } = require('../lib/refund-corroboration.js');
const { buildChannelInfo } = require('../../rp-target-wix/lib/order-channel-build.js');
const { canonicalAmount } = require('../../rp-target-wix/lib/order-applied-discount-build.js');
const paymentMapping = require('../../rp-target-wix/lib/order-payment-mapping.js');
const { orderBuyerContact } = require('../../rp-target-wix/lib/order-buyer.js');
const { subdivision, buildCutoverActions } = require('./contact.build.js');
const suggestions = require('./order.json');
const { lineOptions, extraDisplayKeys, showsDescriptionLines } = require('./facts.js');

const WIX_STORES_APP_ID = '215238eb-22a5-4c36-9e7b-e7c08025e04e';
const { suggestionChoices } = require('./contact.build.js');
const ALL_CHOICES = Object.freeze(suggestionChoices(suggestions));
const DEFAULT_CHOICES = Object.freeze(Object.fromEntries(ALL_CHOICES.map((c) => [c.name, c.default])));

function text(value) {
  if (value === undefined || value === null) return null;
  const out = decodeHtmlEntities(String(value)).trim();
  return out.length ? out : null;
}
const choicesOf = (ctx) => ({ ...DEFAULT_CHOICES, ...((ctx && ctx.choices) || {}) });
// A finding with a cutover task carries it (action, operatorRole, severity), so the loop records it
// on the landed record (recordTaskGap) and it reaches the completion report in a real run.
const withTask = (f) => (f && FINDING_ACTIONS[f.code] && !f.action ? { ...f, operatorRole: 'Cutover Operator', ...FINDING_ACTIONS[f.code] } : f);
const result = (record = {}, findings = [], hold = null) => ({ record, findings: findings.map(withTask), hold });
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
// Money as cents, so sums never pick up float noise. Source amounts are decimal strings or numbers.
const cents = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const amount = (c) => (c / 100).toFixed(2);
// The fixed loop's lookup: `ctx.lookups.ref` (plan-builder, runRecordTask), or `ctx.resolveReference`.
// Keys carry the producing task's key prefix (the manifest's sourceBindings[].keyPrefix).
const resolver = (ctx) => {
  const fn = ctx && ctx.lookups && typeof ctx.lookups.ref === 'function' ? ctx.lookups.ref
    : ctx && typeof ctx.resolveReference === 'function' ? ctx.resolveReference : null;
  return fn || (() => null);
};
const hasLookup = (ctx) => Boolean(ctx && ((ctx.lookups && typeof ctx.lookups.ref === 'function') || typeof ctx.resolveReference === 'function'));
const KEY_PREFIXES = Object.freeze({ 'crm/contact': 'customer:', 'stores/product': 'product:', 'stores/product-variant': 'product-variation:' });
const keyFor = (ctx, ref, id) => `${((ctx && ctx.keyPrefixes) || {})[ref] ?? KEY_PREFIXES[ref]}${id}`;

function orderNumber(order) {
  const raw = text(order.number);
  if (raw !== null && /^\d+$/.test(raw)) return result({ number: raw });
  // Import Order refuses a non-numeric number with a bare 400 (order.json pitfall).
  const digits = raw === null ? '' : raw.replace(/\D/g, '');
  if (digits) return result({ number: digits }, [{ code: 'order-number-digits-only', sourceNumber: raw }]);
  return result({}, [{ code: 'order-number-not-numeric' }], { code: 'order-number-not-numeric' });
}

// Same rule as order.json mappingRules "order-purchase-date-from-declared-utc-creation".
function orderPurchaseDate(order) {
  const raw = text(order.date_created_gmt);
  if (raw !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}Z`))) return result({ purchasedDate: `${raw}Z` });
  return result({}, [{ code: 'MAPPING_DECISION_REQUIRED', field: 'date_created_gmt' }], { code: 'order-purchase-date-invalid' });
}

function orderStatus(order, ctx) {
  const map = choicesOf(ctx)['order-status-map'];
  const status = text(order.status);
  if (status !== null && Object.hasOwn(map, status)) return result({ status: map[status] });
  return result({}, [{ code: 'order-status-unknown', sourceStatus: status }], { code: 'order-status-unknown' });
}

function refundedCents(order) {
  return (Array.isArray(order.refunds) ? order.refunds : []).reduce((sum, r) => sum + Math.abs(cents(r && r.total) || 0), 0);
}

// Set at import; Wix recalculates it once payment records are added (order-payment.json pitfall).
function orderPaymentStatus(order) {
  const refunded = refundedCents(order), total = cents(order.total) || 0;
  if (refunded > 0) return result({ paymentStatus: refunded >= total ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED' });
  return result({ paymentStatus: text(order.date_paid_gmt) ? 'PAID' : 'NOT_PAID' });
}

// A symbol that belongs to exactly one currency. "$" (USD, CAD, AUD, ...) and "¥" (JPY, CNY) are
// not here: they are left to the fixed loop, which fills the checked store currency.
const UNIQUE_SYMBOLS = Object.freeze({ ILS: ['₪', '&#8362;', '&#x20aa;', 'nis'], EUR: ['€', '&#8364;', '&#x20ac;'], GBP: ['£', '&#163;', '&#xa3;'] });
// An ISO code on the order is written. A unique symbol (Tuti sends "&#8362;") gives its currency; the
// fixed loop still checks every order against the store and site currency (#708) and refuses a body
// whose currency differs from the store's. Anything else is left to the loop's currency fill; a caller
// that knows the store currency may pass it.
function orderCurrency(order, ctx) {
  const resolved = resolveOrderCurrency(order, ctx && ctx.storeCurrency);
  if (!resolved.currency && !(ctx && ctx.storeCurrency) && resolved.finding.code === 'currency-unresolvable') {
    const declared = String(order.currency || '').trim().toLowerCase();
    const codes = Object.keys(UNIQUE_SYMBOLS).filter((code) => UNIQUE_SYMBOLS[code].includes(declared));
    if (codes.length === 1) return result({ currency: codes[0] }, [{ code: 'order-currency-from-symbol', declared: order.currency }]);
    return result({}, [{ code: 'order-currency-from-loop-gate' }]);
  }
  if (!resolved.currency) return result({}, [resolved.finding], { code: resolved.finding.code });
  return result({ currency: resolved.currency }, resolved.finding ? [resolved.finding] : []);
}

function orderTaxIncluded(order) {
  return typeof order.prices_include_tax === 'boolean' ? result({ taxIncludedInPrices: order.prices_include_tax }) : result();
}

function orderChannel(order) {
  const built = buildChannelInfo(order);
  return built.channelInfo ? result({ channelInfo: built.channelInfo }) : result({}, built.gaps, { code: 'missing-external-order-id' });
}

function orderBuyer(order, ctx) {
  const email = text(order.billing && order.billing.email);
  const resolve = resolver(ctx);
  const customerId = Number(order.customer_id) > 0 ? String(order.customer_id) : null;
  // The operator's guest-buyers choice: not-imported holds a guest order with a reason (rule 3).
  if (!customerId && choicesOf(ctx)['guest-buyers'] === 'not-imported') return result({}, [], { code: 'guest-buyer-not-imported' });
  // A guest buyer's contact (guestBuyerContactKey) is filled by the fixed loop (lib/order-loop-steps.js)
  // when the contact task binds the guest buyers (guest-buyers import-as-contacts); email-only sends the email alone.
  const contactId = customerId ? resolve('crm/contact', keyFor(ctx, 'crm/contact', customerId), 'buyerInfo.contactId') : null;
  const findings = contactId || !customerId ? [] : [{ code: 'order-buyer-contact-unresolved' }];
  return result({ buyerInfo: compact({ email, contactId: contactId || null }) }, findings);
}

function orderBuyerNote(order) {
  const note = text(order.customer_note);
  return note === null ? result() : result({ buyerNote: note });
}

function addressOf(source, part, findings) {
  const country = text(source && source.country);
  return compact({
    addressLine: text(source && source.address_1),
    addressLine2: text(source && source.address_2),
    city: text(source && source.city),
    postalCode: text(source && source.postcode),
    country: country ? country.toUpperCase() : null,
    subdivision: subdivision(country ? country.toUpperCase() : null, text(source && source.state), findings, part),
  });
}
function contactDetailsOf(source) {
  return compact({
    firstName: text(source && source.first_name),
    lastName: text(source && source.last_name),
    phone: text(source && source.phone),
    company: text(source && source.company),
  });
}

// Same rule as order.json mappingRules "order-billing-street-from-declared-first-line": copied
// unchanged, never truncated; a value Import Order would refuse returns to mapping.
function orderBillingStreet(order) {
  const raw = order.billing ? order.billing.address_1 : undefined;
  if (raw === undefined || raw === null || raw === '') return result();
  if (typeof raw !== 'string' || raw.length > 150) return result({}, [{ code: 'MAPPING_DECISION_REQUIRED', field: 'billing.address_1' }], { code: 'order-billing-street-invalid' });
  return result({ billingInfo: { address: { addressLine: raw } } });
}

// Import Order needs billingInfo.contactDetails, non-empty. They come from the billing block, else the
// shipping block (orderBuyerContact, the toolkit's one rule; never hold a guest order because its
// billing block is empty). An order with only its email sends that email as contactDetails.firstName,
// since contactDetails has no email field and Wix refuses it empty (T-findings 10: 168 Poratus
// orders). No email either holds the order.
function orderBilling(order) {
  const findings = [];
  // The street line is its own row (orderBillingStreet, the target rule).
  const { addressLine: _street, ...address } = addressOf(order.billing, 'billing', findings);
  const buyer = orderBuyerContact(order);
  if (buyer.held) return result({}, [{ code: buyer.reason }], { code: buyer.reason });
  if (buyer.part !== 'billing') findings.push({ code: 'order-billing-contact-from', part: buyer.part });
  const contactDetails = buyer.part === 'email' ? { firstName: buyer.email } : contactDetailsOf(order[buyer.part]);
  return result({ billingInfo: compact({ address: Object.keys(address).length ? address : null, contactDetails }) }, findings);
}

function orderShipping(order, ctx) {
  const findings = [];
  const shippingInfo = {};
  const address = addressOf(order.shipping, 'shipping', findings);
  if (Object.keys(address).some((k) => k !== 'country')) {
    shippingInfo.logistics = { shippingDestination: { address, contactDetails: contactDetailsOf(order.shipping) } };
  }
  const lines = Array.isArray(order.shipping_lines) ? order.shipping_lines : [];
  if (lines.length) {
    const mode = choicesOf(ctx)['order-shipping-lines'];
    const used = mode === 'first' ? lines.slice(0, 1) : lines;
    if (lines.length > 1) findings.push({ code: mode === 'first' ? 'order-extra-shipping-lines-not-sent' : 'order-shipping-lines-combined', lines: lines.length });
    const title = used.map((l) => text(l.method_title)).filter(Boolean).join(' + ');
    const cost = used.reduce((s, l) => s + (cents(l.total) || 0), 0);
    if (title) shippingInfo.title = title;
    shippingInfo.cost = { price: { amount: amount(cost) } };
  }
  return result(Object.keys(shippingInfo).length ? { shippingInfo } : {}, findings);
}

// Line meta as description lines. A number or a true/false value is kept as text (a WooCommerce
// add-on quantity or a yes/no option). Import Order takes at most 20 lines per line item, a name of
// 100 characters and a value of 600 (ecom/order-line-item-options knowledge); extra lines are cut,
// with a cutover finding.
const MAX_DESCRIPTION_LINES = 20;
function descriptionLines(line, extraKeys) {
  const all = lineOptions(line, extraKeys)
    .map((m) => ({ name: { original: m.name.slice(0, 100) }, plainText: { original: m.value.slice(0, 600) } }));
  return { lines: all.slice(0, MAX_DESCRIPTION_LINES), cut: Math.max(0, all.length - MAX_DESCRIPTION_LINES) };
}

// Import Order refuses a line taxDetails without a taxRate (a decimal fraction >= 0, at most 6
// places). WooCommerce keeps a line's tax amount, not its rate, and its line `total` excludes tax,
// so the rate is total_tax / total. A line whose rate can't be derived (no tax amount, or tax on a
// zero total) sends no taxDetails; its tax stays in the order's priceSummary.tax.
function lineTaxDetails(line) {
  const tax = cents(line.total_tax);
  const total = cents(line.total);
  if (tax === null || tax < 0) return null;
  if (tax === 0) return { taxRate: '0', totalTax: { amount: amount(0) } };
  if (!(total > 0)) return null;
  return { taxRate: String(Number((tax / total).toFixed(6))), totalTax: { amount: amount(tax) } };
}

function orderLineItems(order, ctx) {
  const choices = choicesOf(ctx);
  const resolve = resolver(ctx);
  const findings = [];
  let hold = null;
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  const lineItems = lines.map((line, i) => {
    const quantity = Number(line.quantity);
    const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    const item = {
      productName: { original: text(line.name) || `Item ${i + 1}` },
      quantity: qty,
      itemType: { preset: 'PHYSICAL' },
      price: { amount: amount(Math.round((cents(line.total) || 0) / qty)) },
      priceBeforeDiscounts: { amount: amount(Math.round((cents(line.subtotal) || 0) / qty)) },
    };
    const taxDetails = lineTaxDetails(line);
    if (taxDetails) item.taxDetails = taxDetails;
    const sku = text(line.sku);
    if (sku) item.physicalProperties = { sku };
    if (showsDescriptionLines(choices)) {
      const desc = descriptionLines(line, extraDisplayKeys(choices));
      if (desc.lines.length) item.descriptionLines = desc.lines;
      if (desc.cut) findings.push({ code: 'order-line-description-lines-cut', line: i, cut: desc.cut });
    }
    const productId = Number(line.product_id) > 0 ? String(line.product_id) : null;
    // No lookup (the after-codegen canary's pure build): the line keeps its Stores app id; the gate
    // adds the catalog item id later. With a lookup, an unresolved product leaves a plain line.
    if (productId && !hasLookup(ctx)) { item.catalogReference = { appId: WIX_STORES_APP_ID }; return item; }
    const catalogItemId = productId ? resolve('stores/product', keyFor(ctx, 'stores/product', productId), `lineItems[${i}].catalogReference.catalogItemId`) : null;
    if (catalogItemId) {
      item.catalogReference = { catalogItemId, appId: WIX_STORES_APP_ID };
      const variationId = Number(line.variation_id) > 0 ? String(line.variation_id) : null;
      const variantId = variationId ? resolve('stores/product-variant', keyFor(ctx, 'stores/product-variant', variationId), `lineItems[${i}].catalogReference.options.variantId`) : null;
      if (variantId) item.catalogReference.options = { variantId };
      else if (variationId) findings.push({ code: 'order-line-variant-not-linked', line: i });
    } else {
      findings.push({ code: productId ? 'order-line-product-not-linked' : 'order-line-product-deleted-at-source', line: i });
      if (choices['order-line-missing-product'] === 'hold') hold = hold || { code: 'order-line-product-missing' };
    }
    return item;
  });
  // An order with no lines is completed by importOrderHistory's placeholder line (with a cutover item).
  return result(lineItems.length ? { lineItems } : {}, findings, hold);
}

function feeLines(order) {
  return Array.isArray(order.fee_lines) ? order.fee_lines : [];
}

function orderFees(order) {
  const fees = feeLines(order).map((f) => ({ name: text(f.name) || 'Fee', price: { amount: amount(cents(f.total) || 0) } }));
  return result(fees.length ? { additionalFees: fees } : {});
}

function orderTotals(order) {
  const lines = Array.isArray(order.line_items) ? order.line_items : [];
  const subtotal = lines.reduce((s, l) => s + (cents(l.subtotal) || 0), 0);
  const fees = feeLines(order).reduce((s, f) => s + (cents(f.total) || 0), 0);
  const priceSummary = {
    subtotal: { amount: amount(subtotal) },
    shipping: { amount: amount(cents(order.shipping_total) || 0) },
    tax: { amount: amount(cents(order.total_tax) || 0) },
    discount: { amount: amount(cents(order.discount_total) || 0) },
    total: { amount: amount(cents(order.total) || 0) },
  };
  if (fees) priceSummary.totalAdditionalFees = { amount: amount(fees) };
  return result({ priceSummary });
}

// Coupon entries by code. The fixed loop links each one to the imported Wix coupon (by the code's
// source key, through the gated lookup), and turns a code the source no longer has into a plain
// discount line with the same amount (lib/order-loop-steps.js). No coupon id is chosen here.
function orderDiscounts(order, ctx) {
  const discountType = choicesOf(ctx)['order-coupon-discount-type'];
  const couponLines = Array.isArray(order.coupon_lines) ? order.coupon_lines : [];
  const findings = [];
  const appliedDiscounts = [];
  for (const line of couponLines) {
    const code = text(line && line.code);
    const value = canonicalAmount(line && line.discount);
    if (!code) { findings.push({ code: 'coupon-line-without-code' }); continue; }
    if (value === null) continue;
    appliedDiscounts.push({ discountType, coupon: { code, name: code, amount: { amount: value } } });
  }
  if (!couponLines.length && (cents(order.discount_total) || 0) > 0) findings.push({ code: 'order-discount-without-coupon-line' });
  return result(appliedDiscounts.length ? { appliedDiscounts } : {}, findings);
}

// The evidence importOrderHistory takes. Payments and refunds are Wix records only: no money moves
// (order-payment.json, wix-writers.js refund notes) and the site stays muted.
function orderHistoryEvidence(order, ctx) {
  const choices = choicesOf(ctx);
  const findings = [];
  const currency = resolveOrderCurrency(order, ctx && ctx.storeCurrency).currency;
  if (choices['order-payment-records'] !== 'write') {
    findings.push({ code: 'order-payment-records-skipped-by-choice' });
    return { evidence: compact({ currency }), findings };
  }
  const paymentMethod = text(order.payment_method);
  const offline = resolveOfflinePayment(paymentMethod);
  findings.push(...offline.findings);
  const meta = Object.fromEntries((Array.isArray(order.meta_data) ? order.meta_data : []).filter((m) => m && typeof m.key === 'string').map((m) => [m.key, m.value]));
  if (text(order.transaction_id)) meta._transaction_id = text(order.transaction_id);
  const reference = resolveTransactionReference({ meta, paymentMethod });
  const refunds = [];
  if (choices['order-refund-records'] === 'write') {
    for (const r of Array.isArray(order.refunds) ? order.refunds : []) {
      const q = qualifyRefund({ refundEntity: { id: r.id, amount: canonicalAmount(r.total) }, orderStatus: order.status });
      if (q.qualified) refunds.push(compact({ sourceId: q.sourceId, amount: q.amount, reason: text(r.reason) }));
      else findings.push(...q.findings);
    }
  } else if (Array.isArray(order.refunds) && order.refunds.length) findings.push({ code: 'order-refund-records-skipped-by-choice' });
  const evidence = compact({
    amount: text(order.total),
    paidDate: text(order.date_paid_gmt),
    paidDateZone: 'utc',
    currency,
    status: text(order.status),
    methodName: text(order.payment_method_title),
    offlinePayment: offline.offlinePayment,
    providerTransactionId: reference.reference || null,
    refunds: refunds.length ? refunds : null,
  });
  return { evidence, findings };
}

// A preview of what importOrderHistory would write, from the same gate and builder it uses.
function orderPayments(order, ctx) {
  const { evidence, findings } = orderHistoryEvidence(order, ctx);
  const gate = paymentMapping.evaluatePaymentEligibility({
    sourceAmount: evidence.amount ?? null, paidDate: evidence.paidDate ?? null, paidDateZone: 'utc',
    sourceCurrency: evidence.currency ?? null, targetCurrency: evidence.currency ?? null, sourceStatus: evidence.status ?? null,
  });
  findings.push(...(gate.findings || []));
  if (!gate.eligible) {
    if (evidence.refunds) findings.push({ code: 'order-refund-without-payment', refunds: evidence.refunds.length });
    return result({}, findings);
  }
  const built = paymentMapping.buildPaymentRecord({ amount: gate.amount, createdDate: gate.createdDate, methodName: evidence.methodName ?? null,
    providerTransactionId: evidence.providerTransactionId ?? null, offlinePayment: evidence.offlinePayment });
  findings.push(...(built.findings || []));
  const record = { payments: [built.payment] };
  if (evidence.refunds) record.refunds = evidence.refunds.map((r) => compact({ amount: { amount: r.amount }, reason: r.reason }));
  return result(record, findings);
}

// The Import Order body rows. Payments and refunds are not part of the body; see orderPayments.
const ROW_HELPERS = {
  'order-number': orderNumber,
  'order-purchase-date': orderPurchaseDate,
  'order-status': orderStatus,
  'order-payment-status': orderPaymentStatus,
  'order-currency': orderCurrency,
  'order-tax-included': orderTaxIncluded,
  'order-channel': orderChannel,
  'order-buyer': orderBuyer,
  'order-buyer-note': orderBuyerNote,
  'order-billing-street': orderBillingStreet,
  'order-billing': orderBilling,
  'order-shipping': orderShipping,
  'order-line-items': orderLineItems,
  'order-fees': orderFees,
  'order-totals': orderTotals,
  'order-discounts': orderDiscounts,
};
const PREVIEW_HELPERS = { 'order-payments-refunds': orderPayments };

function deepMerge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) deepMerge(into[k], v);
    else into[k] = v;
  }
  return into;
}

function buildOrder(order, ctx = {}, rows = Object.keys(ROW_HELPERS)) {
  const body = {}, findings = [];
  let hold = null;
  for (const id of rows) {
    const out = ROW_HELPERS[id](order, ctx);
    deepMerge(body, out.record);
    findings.push(...out.findings);
    hold = hold || out.hold;
  }
  return { order: body, findings, hold };
}

// Cutover rule (Elad 11-15): see contact.build.js buildCutoverActions.
const FINDING_ACTIONS = Object.freeze({
  'order-line-description-lines-cut': { severity: 'low', action: 'These order lines had more than 20 option or add-on values; Wix keeps 20 per line, so the rest are not on the Wix order. They stay in the source export. No action unless those values matter.' },
  'order-line-product-deleted-at-source': { severity: 'low', action: 'These orders have lines whose product was deleted on WooCommerce. They were imported without a catalog link (name, price, quantity and SKU kept). No action unless a product should be relinked.' },
  'order-line-product-not-linked': { severity: 'medium', action: 'These orders have lines whose product is not in Wix, so the line has no catalog link. Check the product import for these product ids, then re-run the order step to relink.' },
  'order-line-variant-not-linked': { severity: 'low', action: 'These orders have lines linked to the product but not to its variant. Check the variant import if variant reports matter.' },
  'order-refund-without-payment': { severity: 'medium', action: 'These refunded orders had no paid date on WooCommerce, so Wix has no payment or refund record for them; the payment status still shows refunded. Check the totals in Business Manager > Orders if refund reports matter.' },
  'order-shipping-lines-combined': { severity: 'low', action: 'These orders had several shipping lines; Wix holds one, so titles were joined and costs added. No action needed.' },
  'order-extra-shipping-lines-not-sent': { severity: 'medium', action: 'These orders had several shipping lines and only the first was sent (plan choice). Check the shipping totals in Business Manager > Orders.' },
  'order-billing-contact-from': { severity: 'low', action: 'These orders had no name, phone or company in the billing block. Wix needs billing contact details, so they came from the shipping block, or, with no shipping contact either, the order email was put in the first-name field. No action unless the buyer name matters on the order.' },
  'order-number-digits-only': { severity: 'low', action: 'These order numbers had letters; Wix keeps only the digits. The full source number is in the source archive.' },
  'order-discount-without-coupon-line': { severity: 'low', action: 'These orders have a discount with no coupon line (a plugin discount). The amount is in the order totals; there is no discount line.' },
});

const HOLD_ACTIONS = Object.freeze({
  'order-number-not-numeric': { severity: 'high', action: 'These orders have no digits in their number, and Import Order needs a numeric one. Set a number rule in the plan (for example the source id) and re-run.' },
  'order-purchase-date-invalid': { severity: 'high', action: 'These orders have no valid UTC creation date. Decide the date source in the plan and re-run.' },
  'order-status-unknown': { severity: 'high', action: 'These orders have a status the status map does not cover. Add it to the order-status-map choice and re-run.' },
  'currency-unresolvable': { severity: 'high', action: 'The currency of these orders cannot be read. Confirm the store currency and re-run.' },
  'order-currency-contradicts-store': { severity: 'high', action: 'These orders show a currency that disagrees with the store currency. Confirm which is right before importing money.' },
  'order-currency-unknown': { severity: 'high', action: 'These orders carry a currency code neither side supports. Confirm the currency before importing money.' },
  'missing-external-order-id': { severity: 'high', action: 'These orders have no source id. Check the extract.' },
  'order-billing-street-invalid': { severity: 'medium', action: 'These orders have a billing street Wix will not accept (over 150 characters). Decide in the plan how to shorten or drop it and re-run.' },
  'guest-buyer-not-imported': { severity: 'medium', action: 'These guest orders (placed without an account) were held and are not in Wix, because the plan choice guest-buyers is "not-imported". To fix: set guest-buyers to "import-as-contacts" (each guest buyer becomes a Wix contact) and re-run the order step for these orders. Or, to import them without the buyer link: set guest-buyers to "email-only" (the order keeps the buyer email, no contact) and re-run. Or accept them as not migrated.' },
  'order-line-product-missing': { severity: 'medium', action: 'These orders were held because a line product is not in Wix (plan choice "hold"). Import the products, or switch the choice to "unlinked", and re-run.' },
});

function cutoverActions({ results = [], choices = {}, archivedFields = [], artifactRefs } = {}) {
  return buildCutoverActions({ entity: 'order', step: 'order step', results, findingActions: FINDING_ACTIONS, holdActions: HOLD_ACTIONS,
    choiceList: ALL_CHOICES, usedChoices: choicesOf({ choices }), archivedFields, artifactRefs });
}

module.exports = {
  ALL_CHOICES, WIX_STORES_APP_ID, FINDING_ACTIONS, HOLD_ACTIONS, cutoverActions, DEFAULT_CHOICES, ROW_HELPERS, PREVIEW_HELPERS, buildOrder, orderHistoryEvidence,
  orderNumber, orderPurchaseDate, orderStatus, orderPaymentStatus, orderCurrency, orderTaxIncluded, orderChannel,
  orderBuyer, orderBuyerNote, orderBillingStreet, orderBilling, orderShipping, orderLineItems, orderFees, orderTotals, orderDiscounts, orderPayments,
};
