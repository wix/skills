'use strict';

// Wix apps an import task cannot run without, by entity-ref prefix. Entity domain files only
// say "Wix Stores app" in prose; this is the machine-readable form the dependency check reads.
// An app is required when a task writes, adopts or depends on one of its entities: orders reach
// Stores through their `stores/product` and `stores/coupon` dependencies.
const APP_REQUIREMENTS = Object.freeze([
  Object.freeze({
    app: 'wix-stores',
    name: 'Wix Stores',
    appDefId: '215238eb-22a5-4c36-9e7b-e7c08025e04e',
    refPrefixes: Object.freeze(['stores/']),
    // `wix-stores` is the quick-mode step id, `install-wix-stores` the standard one.
    stepIds: Object.freeze(['install-wix-stores', 'wix-stores']),
  }),
  // reviews and back-in-stock requests also need their own app (verified live).
  Object.freeze({
    app: 'wix-reviews',
    name: 'Wix Reviews',
    appDefId: 'a95a5fce-e370-4402-9ce4-96956acc747d',
    refPrefixes: Object.freeze(['stores/review']),
    stepIds: Object.freeze(['install-wix-reviews']),
  }),
  Object.freeze({
    app: 'wix-back-in-stock',
    name: 'Back in Stock',
    appDefId: '16be6c71-d061-4f56-8cda-c6aa911d1832',
    refPrefixes: Object.freeze(['stores/back-in-stock-request']),
    stepIds: Object.freeze(['install-wix-back-in-stock']),
  }),
]);

function requiredAppsFor(refs) {
  return APP_REQUIREMENTS.filter((entry) => (refs || []).some((ref) => entry.refPrefixes.some((prefix) => String(ref).startsWith(prefix))));
}

module.exports = { APP_REQUIREMENTS, requiredAppsFor };
