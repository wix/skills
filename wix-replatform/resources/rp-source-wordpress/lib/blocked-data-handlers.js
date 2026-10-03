'use strict';

const checkoutFieldCsvParser = require('./checkout-field-csv-parser.js');
const wixWpPluginV2Client = require('./wix-wp-plugin-v2-client.js');

const handlers = Object.freeze({
  // wix-wp-plugin-v2 (spec 0101) is the only bridge-plugin-style handler this repo ships --
  // the earlier per-case fixed adapters are fully retired from the skill. One handler,
  // reusable across ANY db-only or admin-page-only entity that has no
  // REST route at all: a profile's fulfillment supplies its own `table`, not its own
  // handler. Exposes both of wix-wp-plugin-v2's routes -- discoverStructure (schema only)
  // and queryStructure (real row data) -- see wix-wp-plugin-v2-client.js's header comment
  // for why pulling real row data through this handler is still a separate per-entity
  // decision, not implied by schema-discoverability.
  'wix-wp-plugin-v2': Object.freeze({
    kind: 'structure-bridge-plugin',
    version: wixWpPluginV2Client.HANDLER_VERSION,
    discoverStructure: wixWpPluginV2Client.discoverStructure,
    queryStructure: wixWpPluginV2Client.queryStructure,
    // What a caller needs to build a legal request against a key/value table: every value
    // column that stays unreachable until its own key column is pinned (spec 0122 §2).
    guardedValueColumns: wixWpPluginV2Client.guardedValueColumns,
    selfTest: require('./wix-wp-plugin-v2-client.test-fixture.js'),
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
    // The whole handler is passed, not one arbitrarily-chosen capability, so a self-test
    // can exercise every capability its handler actually offers (e.g. wix-wp-plugin-v2's
    // discoverStructure AND queryStructure) -- a self-test that only ever received
    // discoverStructure would report readiness even if queryStructure were broken.
    const passed = await handler.selfTest(handler);
    return passed === true ? { ready: true, reason: null } : { ready: false, reason: 'handler-self-test-failed' };
  } catch (error) {
    return { ready: false, reason: 'handler-self-test-failed', error: error.message };
  }
}

async function testHandler(handlerId) {
  const handler = getHandler(handlerId);
  return handler ? testOne(handler) : { ready: false, reason: 'handler-not-registered' };
}

// wix-wp-plugin-v2 (structure-bridge-plugin) has no manifest/case/productionReady concept
// to check against (spec 0101's own table allowlist was removed entirely) -- a passing
// self-test IS readiness. This is the only bridge-plugin-style kind this repo has left, so
// there is no other branch here; a future second such kind would add its own, not overload
// this one.
async function fulfillmentReadiness(fulfillment, { registry = handlers } = {}) {
  const handler = fulfillment && registry[fulfillment.handlerId];
  if (!handler) return { ready: false, reason: 'handler-not-registered' };
  if (handler.kind !== fulfillment.kind) return { ready: false, reason: 'handler-kind-mismatch' };
  return testOne(handler);
}

module.exports = { handlers, getHandler, testHandler, fulfillmentReadiness };
