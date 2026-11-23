'use strict';

// WooCommerce shipping zone -> Wix delivery region (and the zone's methods -> shipping options),
// one export per fieldMappings row of shipping-zone.json. Each is `(record, { lookups, choices, args })`
// and returns `{ values }` or `{ hold: { code } }` (lib/plan-builder.js). The reviewed rules are
// rp-target-wix/lib/shipping-build.js planShippingZones (locations, method classification,
// free-shipping thresholds, defects), used here as-is.

const shipping = require('../../rp-target-wix/lib/shipping-build.js');

function plan(record) {
  return shipping.planShippingZones([record])[0] || null;
}
// shipping-zone-region: the zone's name and destinations. WooCommerce's unused catch-all zone (no
// locations, no methods) is not migrated; a zone whose locations are all postcodes has no Wix
// destination.
function zoneRegion(record) {
  const p = plan(record);
  if (!p) return { hold: { code: 'shipping-zone-empty' } };
  const { destinations, gaps } = shipping.normalizeZoneLocations(record.locations);
  if (!destinations.length) return { hold: { code: 'shipping-zone-no-wix-destination' } };
  const region = shipping.buildDeliveryRegionInput(record, destinations);
  return {
    values: { 'deliveryRegion.name': region.name, 'deliveryRegion.active': region.active, 'deliveryRegion.destinations': region.destinations },
    ...(gaps.length ? { findings: gaps.map((g) => ({ code: 'shipping-zone-location-not-carried', reason: g.reason })) } : {}),
  };
}
// shipping-zone-methods: the zone's enabled methods, resolved into Wix shipping options (written by
// the shipping-option stage, after the region exists).
function zoneShippingOptions(record) {
  const p = plan(record);
  if (!p) return undefined;
  const resolved = shipping.resolveZoneMethods((record.methods || []).map((method) => ({ method, classified: shipping.classifyMethod(method) })));
  // One title and one rate list per resolved option (outputs title, rates; writeInput shippingOption);
  // the whole option list stays for the shipping-option stage.
  const options = resolved.shippingOptions;
  return { values: { title: options.map((o) => o.classified.title), rates: options.map((o) => o.rates), shippingOptions: options }, ...(resolved.resolvedSourceDefects.length ? { findings: resolved.resolvedSourceDefects.map((d) => ({ code: 'shipping-method-collapsed', ...d })) } : {}) };
}

const ROW_EXPORTS = { 'shipping-zone-region': 'zoneRegion', 'shipping-zone-methods': 'zoneShippingOptions' };
module.exports = { zoneRegion, zoneShippingOptions, ROW_EXPORTS };
