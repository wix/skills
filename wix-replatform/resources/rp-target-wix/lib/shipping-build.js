'use strict';

const { isBlank } = require('./value-utils.js');

// rp-target-wix — the DETERMINISTIC WooCommerce shipping-zone -> Wix Delivery Profile payload
// builder. Companion to tax-build.js/discount-rule-build.js; implements domains/ecom/entities/
// delivery-profile.json's mappingGuidance as code.
//
// Model mismatch (why this needs its own file, not a small addition to tax-build.js):
// WooCommerce zones are (locations[] match rule) + (methods[], each independently priced).
// Wix delivery regions are (destinations[] match rule) + (deliveryCarriers[], each an APP with
// one backupRate). A WooCommerce zone's *methods* become Wix *delivery carriers* on the region
// built from that zone's *locations* — two different WC arrays fan into two different Wix arrays
// on the same region, not a 1:1 field rename.
//
// Input is the raw WooCommerce shape from GET /wc/v3/shipping/zones (zone), .../locations
// (zone.locations[], each {code, type}), and .../methods (zone.methods[], each {method_id,
// enabled, settings: {cost, ...}}) — already-fetched, per this codebase's "transform takes
// shaped input, fetching is the caller's job" convention (see tax-build.js).

// "Basic Shipping" is Wix's own first-party, non-carrier-integration delivery app — the direct
// equivalent of WooCommerce's flat_rate/free_shipping (a merchant-set price, no real courier
// calculation). Per dev.wix.com's own Add Delivery Carrier example (not a placeholder GUID — the
// docs' worked example uses this exact id) and confirmed installed on the reference store (2026-08-12) under
// displayName "Basic Shipping". Same "fixed platform constant" reasoning as discount-rule-build.js's
// WIX_STORES_APP_ID: apps Wix itself created keep one appId across every site. Still overridable.
const BASIC_SHIPPING_APP_ID = '45c44b27-ca7b-4891-8c0d-1747d588b835';

// WooCommerce's own continent -> member-country-code table (plugins/woocommerce/i18n/
// continents.php, github.com/woocommerce/woocommerce, fetched 2026-08-12), needed because a WC
// zone location can be `type: "continent"` (e.g. `EU`) but Wix's Destination object has no
// continent concept — only countryCode (+ optional subdivisions). A continent-type location is
// expanded to one Destination per member country. Only continents with a real zone hit in
// practice need to be complete here; unlisted continent codes fall through to
// UNRESOLVED_CONTINENT_CODES with a flagged gap rather than silently matching nothing.
const CONTINENT_COUNTRIES = {
  EU: ['AD', 'AL', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SJ', 'SK', 'SM', 'TR', 'UA', 'VA', 'XK'],
};

function isNumericString(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

// --- WC zone locations -> Wix destinations --------------------------------------------------
// WC location.code shapes, per WC_Shipping_Zone::get_zone_locations(): type "country" -> "US";
// type "state" -> "US:CA" (country-colon-state); type "continent" -> "EU"; type "postcode" ->
// a literal postcode/pattern, which Wix's Destination has no equivalent for at all (country/
// subdivision only) and is always a gap.
function normalizeZoneLocations(locations) {
  const destinations = [];
  const gaps = [];
  for (const location of locations || []) {
    const type = String(location?.type || '').trim();
    const code = String(location?.code || '').trim();
    if (!code) continue;
    if (type === 'country') {
      destinations.push({ countryCode: code.toUpperCase() });
    } else if (type === 'state') {
      const [country, state] = code.split(':');
      if (!country || !state) {
        gaps.push({ location, reason: `state-type location code "${code}" did not parse as COUNTRY:STATE` });
        continue;
      }
      destinations.push({ countryCode: country.toUpperCase(), subdivisions: [`${country.toUpperCase()}-${state.toUpperCase()}`] });
    } else if (type === 'continent') {
      const countries = CONTINENT_COUNTRIES[code.toUpperCase()];
      if (!countries) {
        gaps.push({ location, reason: `continent code "${code}" has no country table here (add it to CONTINENT_COUNTRIES if this recurs)` });
        continue;
      }
      for (const countryCode of countries) destinations.push({ countryCode });
    } else if (type === 'postcode') {
      gaps.push({ location, reason: 'postcode/postal-pattern zone matching has no Wix Destination equivalent (country/subdivision only) — reconfigure-in-wix' });
    } else {
      gaps.push({ location, reason: `unrecognized WooCommerce zone-location type "${type}"` });
    }
  }
  return { destinations, gaps };
}

// --- WC shipping method -> Wix delivery carrier -----------------------------------------------
// Confidence, verified against WooCommerce core's own shipping method implementations
// (plugins/woocommerce/includes/shipping/class-wc-shipping-{flat-rate,free-shipping,local-pickup}.php):
//   - HIGH: flat_rate's base `cost` setting -> backupRate.amount. Real, always-applied, no
//     conditions in the free/core method.
//   - HIGH: free_shipping -> backupRate.amount "0", active. The `requires`/`min_amount`/coupon
//     condition WooCommerce itself evaluates at checkout has NO Wix Delivery Profile equivalent
//     (a Wix delivery carrier's backupRate is unconditional once active) — always noted as a gap,
//     never silently dropped, matching the tax domain's own "never speculative" discipline.
//   - HIGH: local_pickup / pickup_location -> Wix's own "Pickup" carrier app is the direct
//     equivalent, but its appId is resolved live (see resolvePickupAppId below), not hardcoded —
//     unlike Basic Shipping, this has no doc-example corroboration as a fixed cross-site constant.
//   - GAP, no calculation engine to replicate: any other method_id (e.g. a real-carrier plugin
//     like WooCommerce Shipping/UPS/FedEx integrations) — carrier-calculated rates have no data
//     equivalent, per delivery-profile.json's own pre-existing "zone-model-mismatch" pitfall.
//   - Per-shipping-class cost overrides (flat_rate's `class_cost_*` settings) are a known,
//     flagged gap: Wix's additionalCharges apply to every order in the region, not conditionally
//     per product shipping class, so mapping a class-specific cost there would overcharge every
//     other class. Recorded in `notes[]`, never auto-applied.
function classifyMethod(method) {
  const methodId = String(method?.method_id || '').trim();
  const enabled = method?.enabled !== false;
  const title = String(method?.settings?.title?.value || method?.method_title || methodId).trim();
  const notes = [];

  const classCostKeys = Object.keys(method?.settings || {}).filter((key) => /^class_cost_\d+$/.test(key));
  if (classCostKeys.length > 0) {
    notes.push(`Per-shipping-class cost overrides present (${classCostKeys.join(', ')}) — not applied; Wix additionalCharges are unconditional per-order, not per-product-class, so mapping these would overcharge every other class. Verify manually.`);
  }

  if (methodId === 'flat_rate') {
    const cost = method?.settings?.cost?.value;
    if (!isNumericString(cost)) {
      return { kind: 'gap', enabled, title, reason: `flat_rate cost "${cost}" is not a plain numeric value (formula costs like "10 * [qty]" have no static Wix equivalent)`, notes };
    }
    return { kind: 'carrier', carrierRole: 'basic', enabled, title, amount: String(Number(cost)), notes };
  }
  if (methodId === 'free_shipping') {
    const requires = method?.settings?.requires?.value;
    if (requires && requires !== '') {
      notes.push(`free_shipping requires="${requires}"${method?.settings?.min_amount?.value ? ` (min_amount ${method.settings.min_amount.value})` : ''} — WooCommerce's condition is evaluated at checkout; Wix's backupRate is unconditional once active, so this becomes "always free" in this region, not "free above a threshold". Verify this is the intended merchant policy.`);
    }
    return { kind: 'carrier', carrierRole: 'basic', enabled, title, amount: '0', notes };
  }
  if (methodId === 'local_pickup' || methodId === 'pickup_location') {
    return { kind: 'carrier', carrierRole: 'pickup', enabled, title, amount: '0', notes };
  }
  return { kind: 'gap', enabled, title, reason: `method_id "${methodId}" has no calculation engine to replicate — likely a real-carrier integration; carrier-calculated rates have no Wix data equivalent (reconfigure-in-wix)`, notes };
}

// `appId` resolved live by the caller (see resolveBasicShippingAppId/resolvePickupAppId in
// wix-writers.js) — required, never silently defaulted to undefined.
function buildDeliveryCarrierInput(classified, { appId }) {
  if (!appId) throw new Error('buildDeliveryCarrierInput: appId is required (resolve live for non-Basic-Shipping carriers)');
  if (classified.kind !== 'carrier') throw new Error(`buildDeliveryCarrierInput: called on a non-carrier classification (${classified.kind})`);
  return {
    appId,
    backupRate: {
      title: classified.title || 'Shipping',
      amount: classified.amount,
      active: true,
    },
  };
}

// LIVE-DISCOVERED 2026-08-15: a deliveryCarrier's backupRate (buildDeliveryCarrierInput above)
// does NOT make Wix consider a region as having a working rate at checkout, and does NOT clear
// Wix's own "This region is missing rates" dashboard warning. That is driven by a SEPARATE
// resource, ShippingOption (`/ecom/v1/shipping-options`, keyed by `deliveryRegionId`) — found via
// dev.wix.com's "Fix Shipping Coverage Gaps" skill article, not documented on the Delivery
// Profile/Delivery Carrier pages at all. VERIFIED on the reference store: the two regions Wix auto-created at
// Stores install ("Domestic"/"International") each already had a real ShippingOption; the two
// regions this pipeline created ("Europe"/"Israel") had a correctly-shaped, active backupRate but
// NO ShippingOption, and Wix's dashboard still showed them as missing rates. A region migration
// needs BOTH buildDeliveryCarrierInput (the carrier attachment + fallback) AND this builder (the
// actual rate customers see) — never one without the other.
function buildShippingOptionInput(classified, { deliveryRegionId, estimatedDeliveryTime = '5-7 business days' } = {}) {
  if (!deliveryRegionId) throw new Error('buildShippingOptionInput: deliveryRegionId is required');
  if (classified.kind !== 'carrier') throw new Error(`buildShippingOptionInput: called on a non-carrier classification (${classified.kind})`);
  return {
    title: classified.title || 'Shipping',
    estimatedDeliveryTime,
    deliveryRegionId,
    rates: [{ amount: classified.amount, conditions: [], multiplyByQuantity: false }],
  };
}

function buildDeliveryRegionInput(zone, destinations) {
  if (isBlank(zone?.name)) throw new Error('buildDeliveryRegionInput: zone.name is required');
  return {
    name: String(zone.name).trim(),
    active: true,
    destinations,
  };
}

function deliveryRegionDedupeKey(destinations) {
  return [...(destinations || [])]
    .map((d) => `${String(d.countryCode || '').toUpperCase()}:${[...(d.subdivisions || [])].sort().join(',')}`)
    .sort()
    .join('|');
}

// Wix's own checkout-blocking warning text (Tax/Delivery Locations UI), verbatim — reused here so
// the pipeline surfaces the exact same wording at the execution approval gate, not a paraphrase.
const MISSING_RATES_ALERT = 'This region is missing rates. Add them so customers can complete checkout.';

// A zone whose destinations resolve to a real region but which ends up with NO enabled carrier
// (every method disabled, or every method a `kind: 'gap'` — carrier-calculated, non-numeric
// flat_rate cost, unrecognized method_id — or the zone has no methods at all) creates a Wix
// Delivery Region with zero working delivery carriers. Every buyer matching that region hits a
// dead end at checkout — this is Wix's own live-verified UI warning for exactly that state (see
// delivery-profile.json's checkout-blocking-region-with-no-working-carrier pitfall), distinct
// from a routine per-method `notes[]` gap and surfaced loudly here rather than buried in one.
function hasWorkingCarrier(methodPlans) {
  return (methodPlans || []).some(({ classified }) => classified.kind === 'carrier' && classified.enabled === true);
}

// A zone with empty locations AND empty methods is WooCommerce's unused default "catch-all"
// (id 0, "Locations not covered by your other zones" on a fresh install) — never migrate it
// speculatively; only zones the merchant actually configured (has locations, or is the sole
// remaining zone acting as a real rest-of-world catch-all) produce a plan.
function planShippingZones(zones) {
  const plans = [];
  for (const zone of zones || []) {
    const hasLocations = Array.isArray(zone.locations) && zone.locations.length > 0;
    const hasMethods = Array.isArray(zone.methods) && zone.methods.length > 0;
    if (!hasLocations && !hasMethods) continue;

    const { destinations, gaps: locationGaps } = normalizeZoneLocations(zone.locations);
    const methodPlans = (zone.methods || []).map((method) => ({ method, classified: classifyMethod(method) }));
    const plan = {
      zone,
      destinations,
      locationGaps,
      methodPlans,
    };
    if (destinations.length > 0 && !hasWorkingCarrier(methodPlans)) {
      plan.alert = MISSING_RATES_ALERT;
    }
    plans.push(plan);
  }
  return plans;
}

function shouldSkipShippingDomain(zones) {
  return planShippingZones(zones).length === 0;
}

module.exports = {
  BASIC_SHIPPING_APP_ID,
  CONTINENT_COUNTRIES,
  MISSING_RATES_ALERT,
  normalizeZoneLocations,
  classifyMethod,
  hasWorkingCarrier,
  buildDeliveryCarrierInput,
  buildShippingOptionInput,
  buildDeliveryRegionInput,
  deliveryRegionDedupeKey,
  planShippingZones,
  shouldSkipShippingDomain,
};
