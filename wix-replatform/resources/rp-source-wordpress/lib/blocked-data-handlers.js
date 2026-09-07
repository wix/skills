'use strict';

const giftCardsClient = require('./pw-gift-cards-client.js');
const checkoutFieldCsvParser = require('./checkout-field-csv-parser.js');

const handlers = Object.freeze({
  'wix-migration-helper-pw-gift-cards': Object.freeze({
    kind: 'bridge-plugin',
    version: giftCardsClient.HANDLER_VERSION,
    extract: giftCardsClient.extract,
    selfTest: require('./pw-gift-cards-client.test-fixture.js'),
  }),
  // Generic across any checkout-field-editor-style WooCommerce plugin (ThemeHigh's
  // Checkout Field Editor today, any other vendor tomorrow) — the parser only validates
  // this pipeline's own canonical CSV shape, never a vendor-specific export format or
  // meta-key convention. A second such plugin's profile can point its own
  // blocked[].fulfillment.handlerId at this same id and reuse it unchanged.
  'checkout-field-csv': Object.freeze({
    kind: 'csv-upload',
    version: checkoutFieldCsvParser.HANDLER_VERSION,
    parse: checkoutFieldCsvParser.parse,
    selfTest: require('./checkout-field-csv-parser.test-fixture.js'),
  }),
});

function getHandler(handlerId) {
  return handlers[handlerId] || null;
}

async function testOne(handler) {
  if (typeof handler.selfTest !== 'function') return { ready: false, reason: 'handler-self-test-missing' };
  try {
    const passed = await handler.selfTest(handler.extract || handler.parse);
    return passed === true ? { ready: true, reason: null } : { ready: false, reason: 'handler-self-test-failed' };
  } catch (error) {
    return { ready: false, reason: 'handler-self-test-failed', error: error.message };
  }
}

async function testHandler(handlerId) {
  const handler = getHandler(handlerId);
  return handler ? testOne(handler) : { ready: false, reason: 'handler-not-registered' };
}

async function fulfillmentReadiness(fulfillment, { manifest, registry = handlers } = {}) {
  const handler = fulfillment && registry[fulfillment.handlerId];
  if (!handler) return { ready: false, reason: 'handler-not-registered' };
  if (handler.kind !== fulfillment.kind) return { ready: false, reason: 'handler-kind-mismatch' };
  const tested = await testOne(handler);
  if (!tested.ready) return tested;
  if (fulfillment.kind !== 'bridge-plugin') return tested;
  const manifestCase = (manifest && manifest.cases || []).find((item) => item.caseId === fulfillment.manifestCaseId);
  if (!manifestCase) return { ready: false, reason: 'manifest-case-missing' };
  if (manifestCase.handlerId !== fulfillment.handlerId) return { ready: false, reason: 'manifest-handler-mismatch' };
  if (manifestCase.productionReady !== true) return { ready: false, reason: 'manifest-not-production-ready' };
  return tested;
}

module.exports = { handlers, getHandler, testHandler, fulfillmentReadiness };
