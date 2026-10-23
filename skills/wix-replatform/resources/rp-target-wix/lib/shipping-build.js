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
// built from that zone's *locations* — two different WooCommerce arrays fan into two different
// Wix arrays on the same region, not a 1:1 field rename.
//
// Input is the raw WooCommerce shape from GET /wc/v3/shipping/zones (zone), .../locations
// (zone.locations[], each {code, type}), and .../methods (zone.methods[], each {method_id,
// enabled, settings: {cost, ...}}) — already-fetched, per this codebase's "transform takes
// shaped input, fetching is the caller's job" convention (see tax-build.js).
//
// ONE ZONE METHOD IS NOT ONE CHECKOUT CHOICE. A WooCommerce zone lists every shipping
// *behaviour* as its own method row, because WooCommerce has nowhere else to put them: a
// minimum-order free-shipping threshold and a coupon-gated free shipping are both rows, and
// neither is something a buyer picks. Writing one Wix ShippingOption per zone method therefore
// reproduces — and multiplies — a display defect the source already has. This builder resolves
// zone methods to the merchant's actual policy first (see planShippingZones), and reports every
// resolution it made so a human can confirm the intent was read correctly.

// "Basic Shipping" is Wix's own first-party, non-carrier-integration delivery app — the direct
// equivalent of WooCommerce's flat_rate/free_shipping (a merchant-set price, no real courier
// calculation). Per dev.wix.com's own Add Delivery Carrier example (not a placeholder GUID — the
// docs' worked example uses this exact id) and confirmed installed on a live site under
// displayName "Basic Shipping". Same "fixed platform constant" reasoning as discount-rule-build.js's
// WIX_STORES_APP_ID: apps Wix itself created keep one appId across every site. Still overridable.
const BASIC_SHIPPING_APP_ID = '45c44b27-ca7b-4891-8c0d-1747d588b835';

// WooCommerce's own continent -> member-country-code table (plugins/woocommerce/i18n/
// continents.php, github.com/woocommerce/woocommerce, fetched 2026-08-12), needed because a WC
// zone location can be `type: "continent"` (e.g. `EU`) but Wix's Destination object has no
// continent concept — only countryCode (+ optional subdivisions). A continent-type location is
// expanded to one Destination per member country. Only continents with a real zone hit in
// practice need to be complete here; unlisted continent codes fall through to a flagged gap
// rather than silently matching nothing.
const CONTINENT_COUNTRIES = {
  EU: ['AD', 'AL', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SJ', 'SK', 'SM', 'TR', 'UA', 'VA', 'XK'],
};

function isNumericString(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function toAmountString(value) {
  return String(Number(value));
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

// --- Conditional rates -------------------------------------------------------------------------
// ShippingOption.rates and PickupLocation.rates are the SAME type: ConditionalRates, from
// com.wix.ecom.delivery.rates.v1. Shape (authoritative, read off the service definition, not
// the public docs):
//   ConditionalRates { conditions[0..10], amount (decimal string >= 0, max 3 dp), multiplyByQuantity }
//   Condition        { type: BY_TOTAL_WEIGHT|BY_TOTAL_PRICE|BY_TOTAL_QUANTITY, value, operator: EQ|GT|GTE|LT|LTE }
// Conditions AND together; an empty conditions[] means "always applies". The runtime rule,
// verbatim from the definition: "at runtime for a given shipment input, up to one rate (price)
// should be returned in an option. If more than one rate is valid then we return the lowest one."
//
// This is what makes a source minimum-order free-shipping threshold migratable rather than a gap.
//
// LIVE-VERIFIED 2026-09-16: the explicit two-way LT/GTE partition below
// (priceThresholdRates) was originally written on the theory that it would make the merchant's
// dashboard show the same two bands the source had. That theory was never live-checked and is
// WRONG: the Wix dashboard's own rate editor renders it as "Rate by price" mode with invalid,
// unfillable "From"/"Up to" range fields (confirmed via screenshot — a merchant opening this
// rate sees validation errors), even though the write succeeds and the checkout economics are
// correct. The combination that renders correctly, as the dashboard's simpler "Flat rate" mode
// with its "Offer free shipping when customers purchase a certain amount" checkbox (confirmed
// live), is `[unconditionalRate(paidAmount), ...freeAboveThresholdRates(thresholdAmount)]` —
// i.e. LEANING ON the lowest-wins tiebreak this comment used to say to avoid.
// resolveZoneMethods uses that combination, not priceThresholdRates, for exactly this reason.
// priceThresholdRates is kept below (still schema-valid, still economically correct — the
// dashboard-editability problem is cosmetic, not a data-correctness one) for any caller that
// only needs the rates[] shape and does not need it to open cleanly in the dashboard's own
// editor; do not reach for it as the default without re-verifying that live first.
const CONDITION_BY_TOTAL_PRICE = 'BY_TOTAL_PRICE';

function unconditionalRate(amount) {
  return { conditions: [], amount: String(amount), multiplyByQuantity: false };
}

function priceThresholdRates(paidAmount, thresholdAmount) {
  return [
    { conditions: [{ type: CONDITION_BY_TOTAL_PRICE, operator: 'LT', value: String(thresholdAmount) }], amount: String(paidAmount), multiplyByQuantity: false },
    { conditions: [{ type: CONDITION_BY_TOTAL_PRICE, operator: 'GTE', value: String(thresholdAmount) }], amount: '0', multiplyByQuantity: false },
  ];
}

function freeAboveThresholdRates(thresholdAmount) {
  return [
    { conditions: [{ type: CONDITION_BY_TOTAL_PRICE, operator: 'GTE', value: String(thresholdAmount) }], amount: '0', multiplyByQuantity: false },
  ];
}

// The one thing the service definition does NOT settle: whether BY_TOTAL_PRICE is measured
// before or after cart discounts. WooCommerce's own free_shipping has an `ignore_discounts`
// setting for exactly this, so the two platforms can disagree. Ship the threshold as written,
// carry this note on every option built from one, and confirm it at the first live checkout —
// it is a decision, not a measurement, and must never be reported as verified.
function thresholdDiscountBasisNote(ignoreDiscounts) {
  const sourceBasis = String(ignoreDiscounts) === 'yes' ? 'the pre-discount subtotal' : 'the post-discount subtotal';
  return `Threshold basis unverified: WooCommerce compares ${sourceBasis} (ignore_discounts="${ignoreDiscounts ?? 'no'}"); Wix's BY_TOTAL_PRICE does not document which side it uses. Shipped as written — confirm at the first live checkout, and do not report this rate as verified until then.`;
}

// --- WC shipping method -> a classification ----------------------------------------------------
// Kinds, and why each exists:
//   'carrier'       — a real buyer-facing delivery choice with a price. carrierRole 'basic'.
//   'threshold'     — NOT a choice. A minimum-order free-shipping rule that belongs ON the paid
//                     options in the same zone (see planShippingZones), never as its own row.
//   'coupon-domain' — NOT a choice, and NOT a shipping setting at all. Coupon-gated free shipping
//                     lives entirely on the Wix coupon; the WooCommerce zone row exists only
//                     because WooCommerce needs one to switch the behaviour on.
//   'pickup'        — NOT a shipping option. A Wix PickupLocation (see buildPickupLocationInput);
//                     writing it as a ShippingOption puts a 0-priced *delivery* next to the real
//                     paid one, which is how collection ends up looking like free shipping.
//   'gap'           — no data equivalent; reported, never guessed at.
//
// Confidence, verified against WooCommerce core's own shipping method implementations
// (plugins/woocommerce/includes/shipping/class-wc-shipping-{flat-rate,free-shipping,local-pickup}.php):
//   - HIGH: flat_rate's base `cost` setting -> a paid option. Real, always-applied.
//   - HIGH: free_shipping's `requires` decides everything. Empty means genuinely always free —
//     the ONE case where an unconditional 0 is correct.
//   - HIGH: local_pickup / pickup_location -> a Wix PickupLocation.
//   - GAP, no calculation engine to replicate: any other method_id (e.g. a real-carrier plugin
//     like a UPS/FedEx integration) — carrier-calculated rates have no data equivalent.
//   - Per-shipping-class cost overrides (flat_rate's `class_cost_*` settings) are a known,
//     flagged gap: Wix's additionalCharges apply to every order in the region, not conditionally
//     per product shipping class, so mapping a class-specific cost there would overcharge every
//     other class. Recorded in `notes[]`, never auto-applied.
function classifyMethod(method) {
  const methodId = String(method?.method_id || '').trim();
  const enabled = method?.enabled !== false;
  const title = String(method?.settings?.title?.value || method?.method_title || methodId).trim();
  const notes = [];

  const classCostKeys = Object.keys(method?.settings || {}).filter((key) => /^class_cost_\d+$/.test(key) && !isBlank(method.settings[key]?.value));
  if (classCostKeys.length > 0) {
    notes.push(`Per-shipping-class cost overrides present (${classCostKeys.join(', ')}) — not applied; Wix additionalCharges are unconditional per-order, not per-product-class, so mapping these would overcharge every other class. Verify manually.`);
  }

  if (methodId === 'flat_rate') {
    const cost = method?.settings?.cost?.value;
    if (!isNumericString(cost)) {
      return { kind: 'gap', enabled, title, reason: `flat_rate cost "${cost}" is not a plain numeric value (formula costs like "10 * [qty]" have no static Wix equivalent)`, notes };
    }
    return { kind: 'carrier', carrierRole: 'basic', enabled, title, amount: toAmountString(cost), notes };
  }

  if (methodId === 'free_shipping') {
    const requires = String(method?.settings?.requires?.value || '').trim();
    const minAmount = method?.settings?.min_amount?.value;
    const ignoreDiscounts = method?.settings?.ignore_discounts?.value;

    if (requires === '') {
      // Genuinely unconditional. The only shape where a 0-amount, condition-free option is right.
      return { kind: 'carrier', carrierRole: 'basic', enabled, title, amount: '0', notes };
    }
    if (requires === 'coupon') {
      notes.push('Coupon-gated free shipping has no Wix delivery-settings counterpart: at checkout the buyer sees the normal delivery price and the coupon removes it. Handled entirely in the coupon domain — see resolveFreeShippingCouponCoverage. Nothing is lost, so this is NOT an unmigrated gap.');
      return { kind: 'coupon-domain', enabled, title, notes };
    }
    if (requires === 'both') {
      // "minimum order AND a coupon". Wix rate conditions can express the amount but have no
      // coupon term, so a threshold-only migration would hand out free shipping the source
      // withheld. Being MORE generous than the source is the same class of defect as being
      // unconditional — report it, never guess it.
      return {
        kind: 'gap',
        enabled,
        title,
        reason: `free_shipping requires="both" needs a minimum order (${minAmount}) AND a coupon; a Wix rate condition can carry the amount but has no coupon term, so migrating the threshold alone would give free shipping the source withholds. Needs a merchant decision — reconfigure-in-wix.`,
        notes,
      };
    }
    if (requires === 'min_amount' || requires === 'either') {
      if (!isNumericString(minAmount)) {
        return { kind: 'gap', enabled, title, reason: `free_shipping requires="${requires}" but min_amount "${minAmount}" is not numeric — there is no threshold to build`, notes };
      }
      if (requires === 'either') {
        notes.push(`free_shipping requires="either" means the minimum order OR a coupon. The ${minAmount} threshold migrates here; the coupon half is a coupon-domain concern (a Wix freeShipping coupon covers it).`);
      }
      notes.push(thresholdDiscountBasisNote(ignoreDiscounts));
      return { kind: 'threshold', enabled, title, thresholdAmount: toAmountString(minAmount), amount: '0', notes };
    }
    return { kind: 'gap', enabled, title, reason: `free_shipping requires="${requires}" is not a recognized WooCommerce value`, notes };
  }

  if (methodId === 'local_pickup' || methodId === 'pickup_location') {
    const cost = method?.settings?.cost?.value;
    const amount = isNumericString(cost) ? toAmountString(cost) : '0';
    if (!isBlank(cost) && !isNumericString(cost)) {
      notes.push(`local_pickup cost "${cost}" is not a plain numeric value — the pickup location is created at 0 instead. Verify manually.`);
    }
    return { kind: 'pickup', enabled, title, amount, notes };
  }

  return { kind: 'gap', enabled, title, reason: `method_id "${methodId}" has no calculation engine to replicate — likely a real-carrier integration; carrier-calculated rates have no Wix data equivalent (reconfigure-in-wix)`, notes };
}

// --- Delivery carrier ---------------------------------------------------------------------------
// `appId` resolved live by the caller (see resolveBasicShippingAppId/resolvePickupAppId in
// wix-writers.js) — required, never silently defaulted to undefined.
//
// A carrier attaches an APP to a region and supplies a fallback price; it is not the rate the
// buyer sees (that is the ShippingOption).
//
// PICKUP IS THE EXCEPTION, and it cuts both ways — LIVE-LEARNED 2026-09-01, both halves the
// hard way. An ACTIVE Pickup backupRate renders as a 0-priced DELIVERY row beside the paid
// one. But removing the Pickup carrier ENTIRELY made the collection point vanish from
// checkout, even with a live, active PickupLocation bound to the region. The region needs the
// app attached in order to render collection at all. So a pickup gets a carrier via
// buildPickupCarrierInput below — amount '0', active FALSE — never through this function, and
// never with an active rate.
function buildDeliveryCarrierInput(classified, { appId }) {
  if (!appId) throw new Error('buildDeliveryCarrierInput: appId is required (resolve live for non-Basic-Shipping carriers)');
  if (classified.kind !== 'carrier') throw new Error(`buildDeliveryCarrierInput: called on a non-carrier classification (${classified.kind}) — only a real paid/free delivery choice gets an active carrier; pickup uses buildPickupCarrierInput (inactive rate) and a threshold folds into a sibling option`);
  return {
    appId,
    backupRate: {
      title: classified.title || 'Shipping',
      amount: classified.amount,
      active: true,
    },
  };
}

// The Pickup carrier attachment: present so the region can RENDER collection, with an
// INACTIVE backup rate so the carrier itself never becomes a delivery row. Both halves matter
// and each was learned by breaking a live store in the opposite direction. `appId` is
// installation-scoped — resolve it live with wix-writers.js's resolvePickupAppId, never
// hardcode it. The PickupLocation is still what describes the actual collection point.
function buildPickupCarrierInput(classified, { appId }) {
  if (!appId) throw new Error('buildPickupCarrierInput: appId is required (resolve the Pickup app live with resolvePickupAppId)');
  if (classified.kind !== 'pickup') throw new Error(`buildPickupCarrierInput: called on a non-pickup classification (${classified.kind})`);
  return {
    appId,
    backupRate: {
      title: classified.title || 'Pickup',
      amount: '0',
      // NEVER true. An active pickup backup rate is a 0-priced delivery row beside the paid one.
      active: false,
    },
  };
}

// --- Shipping option ----------------------------------------------------------------------------
// LIVE-DISCOVERED: a deliveryCarrier's backupRate (buildDeliveryCarrierInput above) does NOT make
// Wix consider a region as having a working rate at checkout, and does NOT clear Wix's own "This
// region is missing rates" dashboard warning. That is driven by a SEPARATE resource,
// ShippingOption (`/ecom/v1/shipping-options`). A region migration needs BOTH — never one
// without the other, for every 'carrier'-kind method.
//
// FIELD NAMES, read off the service definition (wix-private/ecom shipping_option.proto):
//   - `estimatedDeliveryTime` (field 12, `estimated_delivery_time`, max 500). The proto's
//     `translatable` annotation names it `estimate_delivery_time` -- a key in the translation
//     system, NOT a request field. Wix accepts the misspelled `estimateDeliveryTime` with a 200 and
//     silently drops it; that is how every migrated option lost its delivery time unnoticed. The
//     builder never emits the misspelled key.
//   - `deliveryRegionIds` (plural). The singular `deliveryRegionId` is deprecated with a removal
//     target already in the past. Both are sent: the plural is what is honoured going forward,
//     the singular keeps older reads/tooling working until it is actually removed.
// There is NO default estimate here. The text is resolved per option by resolveDeliveryEstimate
// (merchant > source > a reviewed default in the DESTINATION site's language > none), so an
// English promise can never reach a non-English checkout by falling through a default argument.
const ESTIMATED_DELIVERY_TIME_MAX = 500;
function buildShippingOptionInput(classified, { deliveryRegionId, estimatedDeliveryTime, estimateDeliveryTime, rates } = {}) {
  if (!deliveryRegionId) throw new Error('buildShippingOptionInput: deliveryRegionId is required');
  if (classified.kind !== 'carrier') throw new Error(`buildShippingOptionInput: called on a non-carrier classification (${classified.kind}) — a pickup method must become a PickupLocation, not a shipping option`);
  // The legacy (wrong) key is accepted as an input alias for one release so an older caller keeps
  // working -- but it is translated, never emitted, and a conflicting pair is a caller bug.
  if (estimatedDeliveryTime !== undefined && estimateDeliveryTime !== undefined && estimatedDeliveryTime !== estimateDeliveryTime) {
    throw new Error('buildShippingOptionInput: estimatedDeliveryTime and the legacy estimateDeliveryTime were both given with different values');
  }
  const estimate = estimatedDeliveryTime !== undefined ? estimatedDeliveryTime : estimateDeliveryTime;
  if (estimate !== undefined && estimate !== null && typeof estimate !== 'string') {
    throw new Error('buildShippingOptionInput: estimatedDeliveryTime must be a string');
  }
  if (typeof estimate === 'string' && estimate.length > ESTIMATED_DELIVERY_TIME_MAX) {
    throw new Error(`buildShippingOptionInput: estimatedDeliveryTime is ${estimate.length} characters; the service maximum is ${ESTIMATED_DELIVERY_TIME_MAX} (never truncated)`);
  }
  const resolvedRates = Array.isArray(rates) && rates.length > 0 ? rates : [unconditionalRate(classified.amount)];
  return {
    title: classified.title || 'Shipping',
    ...(typeof estimate === 'string' && estimate !== '' ? { estimatedDeliveryTime: estimate } : {}),
    deliveryRegionId,
    deliveryRegionIds: [deliveryRegionId],
    rates: resolvedRates,
  };
}

// --- Pickup location ----------------------------------------------------------------------------
// A Wix PickupLocation is its own entity, not a shipping option and not a delivery carrier.
// POST https://www.wixapis.com/pickup-locations/v1/pickup-locations, permission
// ECOM.PICKUP_LOCATION_CREATE. `address` is REQUIRED by the create call.
//
// The address is supplied by the caller, because where it comes from depends on the source
// shape — see resolvePickupAddressSource above. A source using Blocks Local Pickup already has
// real addresses; a source using the LEGACY local_pickup method has none anywhere, and only the
// merchant knows. Throwing here is deliberate either way: a silently address-less pickup
// location fails server-side with far less context, and inventing one is worse than stopping.
//
// `shippingRuleId` is deliberately NOT sent. It is deprecated and marked internal, replaced by
// `deliveryRegionIds`, with a removal target already in the past — the Wix dashboard still sends
// it, which is not a reason for a migration to.
//
// `amount` overrides the classification's fee, and exists because the two pickup shapes keep the
// fee in different places. LEGACY local_pickup carries it on the zone method, so
// classifyZoneMethod already has it. BLOCKS pickup carries it once, globally, in
// `pickup_location_settings.cost` — which the zone method does not have and the classification
// therefore reads as 0. A Blocks caller passes the resolved location's `amount` here; a legacy
// caller passes nothing and keeps the classified value.
function buildPickupLocationInput(classified, { deliveryRegionIds, address, deliveryTime, instructions, active = true, amount } = {}) {
  if (classified.kind !== 'pickup') throw new Error(`buildPickupLocationInput: called on a non-pickup classification (${classified.kind})`);
  if (!Array.isArray(deliveryRegionIds) || deliveryRegionIds.length === 0) {
    throw new Error('buildPickupLocationInput: deliveryRegionIds is required (a pickup location must be bound to at least one delivery region)');
  }
  if (!address || isBlank(address.country)) {
    throw new Error('buildPickupLocationInput: address with a country is required — WooCommerce\'s local_pickup method carries no address, so the caller must supply one from the store address or the merchant');
  }
  const name = classified.title || 'Pickup';
  return {
    name,
    address,
    ...(isBlank(deliveryTime) ? {} : { deliveryTime: String(deliveryTime) }),
    ...(isBlank(instructions) ? {} : { instructions: String(instructions) }),
    active,
    rates: [unconditionalRate(isBlank(amount) ? (classified.amount || '0') : String(amount))],
    deliveryRegionIds: [...deliveryRegionIds],
  };
}

// --- Where a collection address actually comes from ---------------------------------------------
// WooCommerce has TWO local-pickup implementations, and they differ on the one thing that
// matters here — whether an address exists in the source at all:
//
//   1. BLOCKS Local Pickup (`pickup_location` method). Real locations WITH addresses, stored as
//      WordPress options and exposed on `GET /wp/v2/settings` as `pickup_locations[]`:
//        { name, address: { address_1, city, state, postcode, country }, details, enabled }
//      plus `pickup_location_settings` = { enabled, title, tax_status, cost }. Note the address
//      shape here keeps `state` SEPARATE from `country` — unlike the store address's
//      `woocommerce_default_country`, which packs both into one COUNTRY:STATE string.
//
//   2. LEGACY `local_pickup` zone method. Settings are only { title, tax_status, cost }. There is
//      no address, no linked record, nothing to read. The town is often named in the method's own
//      title text — that is a label, not an address, and must never be parsed as one.
//
// So "the source has no pickup address" is true only for the legacy shape. Check the Blocks
// locations FIRST; a store using them needs no human input at all.
// WooCommerce writes option booleans as the strings 'yes'/'no', but the same field arrives as a
// real boolean on some routes and is simply absent on others. Absent means "not configured", which
// for a global feature switch has to read as ON — a store with pickup locations and no explicit
// flag is using them. Only an explicit no/false turns it off.
function isExplicitlyDisabled(value) {
  if (value === false) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'no' || normalized === 'false' || normalized === '0' || normalized === 'off';
}

// `pickup_location_settings` is the GLOBAL half of Blocks Local Pickup and it owns two things no
// individual location carries:
//
//   enabled — the master switch. Every location can be individually `enabled: true` while pickup
//             as a whole is off, and reading only the per-location flag then re-enables a
//             fulfillment method the merchant deliberately turned off.
//   cost    — the collection fee, set ONCE for all locations. Blocks pickup has no per-zone cost
//             field, so `method.settings.cost` (which classifyZoneMethod reads, correctly, for the
//             LEGACY local_pickup zone method) is absent for this shape. Without reading it here
//             the fee silently becomes 0 and every pickup order loses it.
//
// Both fields sit in the payload the default discovery sweep already captures, so nothing extra
// has to be fetched — they simply have to be read.
function pickupLocationsFromWpSettings(wpSettings) {
  const raw = wpSettings?.pickup_locations;
  if (!Array.isArray(raw)) return [];
  const globalSettings = wpSettings?.pickup_location_settings;
  // The option is an object when configured; WooCommerce serializes an unconfigured one as [].
  const global = globalSettings && typeof globalSettings === 'object' && !Array.isArray(globalSettings) ? globalSettings : {};
  const globallyDisabled = isExplicitlyDisabled(global.enabled);
  const globalCost = global.cost;
  const amount = isNumericString(String(globalCost ?? '')) ? toAmountString(globalCost) : '0';
  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const source = entry.address || {};
      const address = {
        ...(isBlank(source.country) ? {} : { country: String(source.country).trim().toUpperCase() }),
        ...(isBlank(source.state) ? {} : { subdivision: String(source.state).trim() }),
        ...(isBlank(source.city) ? {} : { city: String(source.city).trim() }),
        ...(isBlank(source.postcode) ? {} : { postalCode: String(source.postcode).trim() }),
        // address_1 is one free-text line and Wix's addressLine is the matching free-text field.
        // Same discipline as the store address: never parse a house number out of it.
        ...(isBlank(source.address_1) ? {} : { addressLine: String(source.address_1).trim() }),
      };
      return {
        name: isBlank(entry.name) ? '' : String(entry.name).trim(),
        address: Object.keys(address).length > 0 ? address : null,
        instructions: isBlank(entry.details) ? '' : String(entry.details).trim(),
        // Both gates must pass. The master switch cannot be overridden by a per-location flag.
        active: !globallyDisabled && entry.enabled !== false,
        // The global fee, carried per location so the caller passes it straight to
        // buildPickupLocationInput's `amount` without having to know where it came from.
        amount,
        ...(globallyDisabled ? { globallyDisabled: true } : {}),
      };
    });
}

// A pickup location with NO street address is a real merchant choice, not a failure. Plenty of
// shops coordinate collection by phone and deliberately do not publish a street — the source
// method's own title usually says so ("contact us to arrange collection"). Wix's create call
// REQUIRES the `address` object, so "blank" cannot mean absent; the honest minimum is the one
// part we genuinely know — the country, taken from the delivery region this pickup is bound to.
//
// Derived, never guessed: if the region's destinations span more than one country there is no
// single answer and this throws rather than picking one.
function buildMinimalPickupAddress(destinations) {
  const countries = [...new Set((destinations || []).map((d) => String(d?.countryCode || '').trim().toUpperCase()).filter(Boolean))];
  if (countries.length === 0) {
    throw new Error('buildMinimalPickupAddress: the delivery region has no destination country to derive a minimal address from');
  }
  if (countries.length > 1) {
    throw new Error(`buildMinimalPickupAddress: the delivery region spans ${countries.length} countries (${countries.join(', ')}) — there is no single country for a collection point; ask the merchant`);
  }
  return { country: countries[0] };
}

// Resolves the address question for a zone's pickup methods, in the order that avoids asking a
// human anything the source already answered:
//   'blocks'   — the source carries real pickup locations with addresses. Build them directly.
//   'minimal'  — the merchant was asked and declined to publish a street address. Country only,
//                derived from the region; the location's NAME carries where and how to collect.
//                An explicit choice, only ever reached via `addressDeclined`.
//   'proposal' — legacy method only. Nothing in the source has an address, so the store's own
//                address (see store-config-build.js) is offered for a human to CONFIRM or
//                replace. It is a starting point, never an answer: a shop's registered address
//                and its collection point are routinely different places.
//   'ask'      — legacy method and no store address captured either. Ask outright.
// The caller never invents an address in any branch.
function resolvePickupAddressSource({ pickupPlans = [], wpSettings = null, storeAddress = null, addressDeclined = false, destinations = [] } = {}) {
  const blocks = pickupLocationsFromWpSettings(wpSettings).filter((location) => location.address);
  if (blocks.length > 0) {
    return { strategy: 'blocks', locations: blocks, needsConfirmation: false };
  }
  if ((pickupPlans || []).length === 0) {
    return { strategy: 'none', locations: [], needsConfirmation: false };
  }
  if (addressDeclined) {
    return {
      strategy: 'minimal',
      locations: [],
      minimalAddress: buildMinimalPickupAddress(destinations),
      needsConfirmation: false,
      note: 'Address deliberately left incomplete at the merchant\'s request: country only, derived from the delivery region. The location name is what tells buyers where and how to collect. Wix accepts this because only the address OBJECT is required, not its parts — but a country-only collection point has not been verified for how it renders at checkout, so look at it once live.',
    };
  }
  if (storeAddress) {
    return {
      strategy: 'proposal',
      locations: [],
      proposedAddress: storeAddress,
      needsConfirmation: true,
      question: 'The source has a legacy pickup method, which carries no address. The store\'s own registered address is proposed below — confirm it is where customers collect, or replace it. These are routinely different places.',
    };
  }
  return {
    strategy: 'ask',
    locations: [],
    needsConfirmation: true,
    question: 'The source has a legacy pickup method, which carries no address, and no store address was captured either. Ask the merchant where customers collect.',
  };
}

// --- Coupon-gated free shipping: look first, create last -----------------------------------------
// Decision: coupon-gated free shipping is carried by a coupon, so *something* has to exist — but
// this pipeline never invents one. Resolution order:
//   1. source  — the source already has coupons carrying the free-shipping flag; the coupon
//                pipeline is already moving them. Create nothing, record which codes cover it.
//   2. target  — already present on the destination (a re-run, a partial earlier run, or a
//                coupon the merchant made by hand). Create nothing.
//   3. none    — report it. A dead source setting or a coupon discovery missed. The merchant
//                decides; a migration does not conjure a discount code nobody asked for.
// `targetCoupons: null` means step 2 has not been run yet — the caller must do that live read
// before treating a 'none' as final, which is why the un-run state has its own value.
// A Wix coupon read back from the API nests its fields under `specification` — the query response
// is `{ coupon: { id, specification: { code, freeShipping, ... } } }`, which wix-writers.js's own
// post-create lookup already relies on (`coupon?.specification?.code`). Reading the flat shape
// only meant an existing target coupon came back as coverage 'none' on every re-run.
// Both shapes are accepted rather than one: a caller may hand over already-unwrapped
// specifications, and rejecting those would trade one wrong answer for another.
function couponSpec(coupon) {
  if (!coupon || typeof coupon !== 'object') return {};
  return coupon.specification && typeof coupon.specification === 'object' ? coupon.specification : coupon;
}

function resolveFreeShippingCouponCoverage({ sourceCoupons = [], targetCoupons = null } = {}) {
  const sourceMatches = (sourceCoupons || []).filter((coupon) => coupon?.free_shipping === true);
  if (sourceMatches.length > 0) {
    return { coverage: 'source', codes: sourceMatches.map((coupon) => coupon.code).filter(Boolean), createCoupon: false };
  }
  if (targetCoupons === null || targetCoupons === undefined) {
    return { coverage: 'unchecked', codes: [], createCoupon: false, reason: 'no free-shipping coupon in the source; query the destination for coupons with freeShipping=true before concluding anything' };
  }
  const targetMatches = (targetCoupons || []).filter((coupon) => couponSpec(coupon).freeShipping === true);
  if (targetMatches.length > 0) {
    return { coverage: 'target', codes: targetMatches.map((coupon) => couponSpec(coupon).code).filter(Boolean), createCoupon: false };
  }
  return {
    coverage: 'none',
    codes: [],
    createCoupon: false,
    reason: 'a coupon-gated free-shipping method exists but no coupon carries the behaviour, in the source or on the destination — either a dead source setting or a coupon the discovery missed. Report for a merchant decision; do not create one.',
  };
}

// A source coupon may set the free-shipping flag AND a discount amount at once. Wix's
// `freeShipping` is its own coupon type and cannot also carry a value, so one half has to go.
// Decision: keep freeShipping, report the dropped amount with its code and value — the merchant
// re-creates a plain discount coupon in a minute, but the free-shipping behaviour has no other
// expression in Wix. Reported with both values so the call is reversible coupon by coupon.
function findFreeShippingCouponConflicts(sourceCoupons) {
  return (sourceCoupons || [])
    .filter((coupon) => coupon?.free_shipping === true && isNumericString(String(coupon?.amount ?? '')) && Number(coupon.amount) > 0)
    .map((coupon) => ({
      code: coupon.code,
      discountType: coupon.discount_type,
      droppedAmount: String(coupon.amount),
      keeping: 'freeShipping',
      reason: 'Wix coupons cannot carry freeShipping and a discount amount at once. Keeping freeShipping; the amount above is not migrated. Re-create it as a separate discount coupon if the merchant wants both.',
    }));
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

// A zone whose destinations resolve to a real region but which ends up with no way for a buyer
// to receive the order creates a Wix Delivery Region every matching buyer hits a dead end on.
// Three kinds count as coverage, and the last two are why this is not simply "has a carrier":
//   - 'carrier'   — a delivery choice, obviously.
//   - 'pickup'    — collection is a real way to receive an order; it just never becomes a carrier.
//   - 'threshold' — with no paid sibling to fold onto it still yields a conditioned free option.
// The authoritative signal for the alert is the RESOLVED output (see planShippingZones), because
// a method can classify as coverage and still be folded away; this predicate stays exported for
// callers reasoning about a method list they have not resolved yet.
function hasWorkingCarrier(methodPlans) {
  const covering = new Set(['carrier', 'pickup', 'threshold']);
  return (methodPlans || []).some(({ classified }) => covering.has(classified.kind) && classified.enabled === true);
}

// --- Option identity ------------------------------------------------------------
// One Wix option can come from several source methods (a threshold folded onto a paid rate, or
// two identical rows collapsed), so its identity is the SET of source method instance ids, not a
// title. Sorted numerically and de-duplicated, so the same zone always yields the same key.
function sortInstanceIds(ids) {
  const unique = [...new Set((ids || []).filter((id) => id !== undefined && id !== null && id !== '').map(String))];
  return unique.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

function methodInstanceIds(...plans) {
  return sortInstanceIds(plans.filter(Boolean).map(({ method }) => (method ? (method.instance_id ?? method.id) : undefined)));
}

function shippingOptionKey(zoneId, option) {
  if (zoneId === undefined || zoneId === null || zoneId === '') throw new Error('shippingOptionKey: zoneId is required');
  const ids = sortInstanceIds(option && option.sourceMethodInstanceIds);
  if (ids.length === 0) throw new Error(`shippingOptionKey: option in zone ${zoneId} carries no sourceMethodInstanceIds`);
  return `${zoneId}:${ids.join('+')}`;
}

function ratesKey(rates) {
  return JSON.stringify(rates || []);
}

// --- Resolving a zone's methods to the merchant's actual policy ---------------------------------
// This is the step that stops the pipeline photocopying the source's own display defect.
//
//   1. Enabled 'threshold' methods are removed as rows and folded onto the paid 'carrier' options
//      in the same zone, as an explicit LT/GTE price partition. Several thresholds -> the LOWEST
//      one wins, matching WooCommerce showing free shipping as soon as any threshold is met.
//   2. A zone with a threshold and no paid option to fold onto keeps the threshold as its own
//      option, carrying the GTE condition. Never as an unconditional 0.
//   3. Identical survivors (same title, same rates) collapse to one.
// Every removal is recorded in resolvedSourceDefects[] with what was collapsed and why —
// a silent collapse is indistinguishable from never having noticed.
function resolveZoneMethods(methodPlans) {
  const enabledPlans = (methodPlans || []).filter(({ classified }) => classified.enabled === true);
  const thresholds = enabledPlans.filter(({ classified }) => classified.kind === 'threshold');
  const carriers = enabledPlans.filter(({ classified }) => classified.kind === 'carrier');
  const pickups = enabledPlans.filter(({ classified }) => classified.kind === 'pickup');
  const couponDomain = enabledPlans.filter(({ classified }) => classified.kind === 'coupon-domain');

  const resolvedSourceDefects = [];
  const lowestThresholdPlan = [...thresholds]
    .sort((a, b) => Number(a.classified.thresholdAmount) - Number(b.classified.thresholdAmount))[0];
  const lowestThreshold = lowestThresholdPlan ? lowestThresholdPlan.classified : undefined;

  const paidCarriers = carriers.filter(({ classified }) => Number(classified.amount) > 0);

  const optionPlans = carriers.map((plan) => {
    const { classified } = plan;
    const isPaid = Number(classified.amount) > 0;
    if (lowestThreshold && isPaid) {
      return {
        classified,
        // LIVE-VERIFIED 2026-09-16: priceThresholdRates' explicit LT/GTE
        // two-band partition is REJECTED by the Wix dashboard's own rate editor -- it renders
        // as "Rate by price" mode with invalid, unfillable "From"/"Up to" boundary fields (a
        // merchant opening it sees validation errors), even though the API accepts the write
        // and the underlying checkout economics were confirmed correct by
        // verifyShippingEconomics. Switching to an unconditional base rate PLUS a separate
        // GTE-threshold free rate -- relying on the service's own documented "more than one
        // valid rate: return the lowest" tiebreak, exactly what freeAboveThresholdRates is for
        // -- rendered correctly as "Flat rate" mode with the "Offer free shipping when
        // customers purchase a certain amount" checkbox, confirmed live by the user. This is
        // the correct encoding for a paid-carrier-plus-threshold fold; priceThresholdRates
        // itself is kept (still schema-valid, still economically correct) but is no longer
        // used here, and should not be reached for by new code without re-verifying the
        // dashboard editor first.
        rates: [unconditionalRate(classified.amount), ...freeAboveThresholdRates(lowestThreshold.thresholdAmount)],
        notes: [...classified.notes, ...lowestThreshold.notes],
        sourceMethodTitles: [classified.title, lowestThreshold.title],
        sourceMethodInstanceIds: methodInstanceIds(plan, lowestThresholdPlan),
      };
    }
    return { classified, rates: [unconditionalRate(classified.amount)], notes: [...classified.notes], sourceMethodTitles: [classified.title], sourceMethodInstanceIds: methodInstanceIds(plan) };
  });

  if (lowestThreshold) {
    if (paidCarriers.length > 0) {
      resolvedSourceDefects.push({
        kind: 'threshold-folded',
        removedOption: lowestThreshold.title,
        foldedOnto: paidCarriers.map(({ classified }) => classified.title),
        summary: `The source lists "${lowestThreshold.title}" as its own delivery choice, but it is a minimum-order rule, not a choice — WooCommerce shows it alongside the paid option, so buyers see the same delivery offered twice. Migrated as a price band on ${paidCarriers.length === 1 ? 'that option' : 'those options'} instead: full price under ${lowestThreshold.thresholdAmount}, free at ${lowestThreshold.thresholdAmount} and above.`,
      });
    } else {
      optionPlans.push({
        classified: { kind: 'carrier', carrierRole: 'basic', enabled: true, title: lowestThreshold.title, amount: '0', notes: lowestThreshold.notes },
        rates: freeAboveThresholdRates(lowestThreshold.thresholdAmount),
        notes: [...lowestThreshold.notes, 'No paid option in this zone to fold the threshold onto, so it stays a standalone option — conditioned, never unconditional.'],
        sourceMethodTitles: [lowestThreshold.title],
        sourceMethodInstanceIds: methodInstanceIds(lowestThresholdPlan),
      });
    }
    for (const extra of thresholds.map(({ classified }) => classified).filter((c) => c !== lowestThreshold)) {
      resolvedSourceDefects.push({
        kind: 'threshold-superseded',
        removedOption: extra.title,
        summary: `A second minimum-order free-shipping rule at ${extra.thresholdAmount} is superseded by the lower ${lowestThreshold.thresholdAmount} threshold, which is already met first. Not migrated as a separate row.`,
      });
    }
  }

  for (const { classified } of couponDomain) {
    resolvedSourceDefects.push({
      kind: 'coupon-domain-removed',
      removedOption: classified.title,
      summary: `"${classified.title}" is coupon-gated free shipping. In Wix that lives entirely on the coupon — checkout shows the normal delivery price and the coupon removes it — so it is not a delivery setting and produces no shipping row. Nothing is lost.`,
    });
  }

  const deduped = [];
  const seen = new Map();
  for (const option of optionPlans) {
    const key = `${option.classified.title}\u0000${ratesKey(option.rates)}`;
    if (seen.has(key)) {
      const kept = seen.get(key);
      kept.sourceMethodTitles.push(...option.sourceMethodTitles);
      kept.sourceMethodInstanceIds = sortInstanceIds([...kept.sourceMethodInstanceIds, ...option.sourceMethodInstanceIds]);
      resolvedSourceDefects.push({
        kind: 'duplicate-collapsed',
        removedOption: option.classified.title,
        summary: `The source has more than one method producing an identical "${option.classified.title}" option at the same price, so buyers see the same delivery choice listed twice. Migrated once.`,
      });
      continue;
    }
    seen.set(key, option);
    deduped.push(option);
  }

  return { shippingOptions: deduped, pickups, couponDomain, resolvedSourceDefects };
}

// A zone with empty locations AND empty methods is WooCommerce's unused default "catch-all"
// (id 0, "Locations not covered by your other zones" on a fresh install) — never migrate it
// speculatively; only zones the merchant actually configured produce a plan.
function planShippingZones(zones, { sourceCoupons = [], targetCoupons = null } = {}) {
  const plans = [];
  for (const zone of zones || []) {
    const hasLocations = Array.isArray(zone.locations) && zone.locations.length > 0;
    const hasMethods = Array.isArray(zone.methods) && zone.methods.length > 0;
    if (!hasLocations && !hasMethods) continue;

    const { destinations, gaps: locationGaps } = normalizeZoneLocations(zone.locations);
    const methodPlans = (zone.methods || []).map((method) => ({ method, classified: classifyMethod(method) }));
    const resolved = resolveZoneMethods(methodPlans);

    const plan = {
      zone,
      destinations,
      locationGaps,
      methodPlans,
      shippingOptions: resolved.shippingOptions,
      pickups: resolved.pickups,
      resolvedSourceDefects: resolved.resolvedSourceDefects,
      couponCoverage: resolved.couponDomain.length > 0
        ? resolveFreeShippingCouponCoverage({ sourceCoupons, targetCoupons })
        : null,
    };
    // Judged on the RESOLVED output, not on the raw method list: a zone can look covered
    // method-by-method and still resolve to nothing a buyer can pick.
    if (destinations.length > 0 && plan.shippingOptions.length === 0 && plan.pickups.length === 0) {
      plan.alert = MISSING_RATES_ALERT;
    }
    plans.push(plan);
  }
  return plans;
}

function shouldSkipShippingDomain(zones) {
  return planShippingZones(zones).length === 0;
}

// --- Verification: check the money, not the row count -------------------------------------------
// "3 options created" passed while a live store was broken in three different ways at once, so
// the shipping verification asserts economics against what was actually read back:
//   (a) nothing is free-and-unconditional while something else on the same region costs money —
//       the exact shape of "a dropped condition turned 'free above X' into 'free always'";
//   (b) no shipping option was created for a source pickup method;
//   (c) every carrier's appId matches the role it was classified as;
//   (d) no two options on one region are identical.
// Returns violations[]; an empty array is the only passing result.
function verifyShippingEconomics({ regionName, shippingOptions = [], carriers = [], pickupTitles = [], expectedCarrierAppIds = {} } = {}) {
  const violations = [];
  const where = regionName ? ` on region "${regionName}"` : '';

  const isUnconditionalFree = (option) => (option.rates || []).some((rate) => Number(rate.amount) === 0 && (rate.conditions || []).length === 0);
  const anyPaid = shippingOptions.some((option) => (option.rates || []).some((rate) => Number(rate.amount) > 0));
  if (anyPaid) {
    for (const option of shippingOptions.filter(isUnconditionalFree)) {
      violations.push({
        check: 'unconditional-free-alongside-paid',
        severity: 'blocker',
        summary: `"${option.title}"${where} is free with no condition while another option costs money. Buyers will always pick the free one, so the paid rate is unreachable — this is what a dropped source condition looks like.`,
      });
    }
  }

  const pickupSet = new Set(pickupTitles.map((title) => String(title)));
  for (const option of shippingOptions) {
    if (pickupSet.has(String(option.title))) {
      violations.push({
        check: 'shipping-option-for-a-pickup-method',
        severity: 'blocker',
        summary: `"${option.title}"${where} came from a source pickup method but was written as a shipping option. Collection then shows as a 0-priced delivery next to the paid one. It must be a PickupLocation.`,
      });
    }
  }

  for (const carrier of carriers) {
    const expected = expectedCarrierAppIds[carrier.role];
    if (expected && carrier.appId !== expected) {
      violations.push({
        check: 'carrier-app-id-does-not-match-role',
        severity: 'blocker',
        summary: `A carrier classified "${carrier.role}"${where} read back with appId ${carrier.appId}, expected ${expected}.`,
      });
    }
  }

  const seen = new Set();
  for (const option of shippingOptions) {
    const key = `${option.title}\u0000${ratesKey(option.rates)}`;
    if (seen.has(key)) {
      violations.push({
        check: 'duplicate-option',
        severity: 'blocker',
        summary: `"${option.title}"${where} exists more than once with identical rates — the same delivery choice is listed twice at checkout.`,
      });
      continue;
    }
    seen.add(key);
  }

  return violations;
}

// =================================================================================================
// The delivery estimate: resolution, verified-write accounting, follow-up items.
// Everything below is pure except applyTargetMissingDecision/auditShippingEstimates, which READ
// the destination (GET only) and never write to it.
// =================================================================================================

// The reviewed defaults. Adding a language means adding a reviewed row here first;
// an unlisted language gets NO estimate and a merchant item, never English.
const DEFAULT_ESTIMATE_BY_LANGUAGE = Object.freeze({
  en: '5-7 business days',
  he: '5–7 ימי עסקים',
  es: '5-7 días hábiles',
  fr: '5 à 7 jours ouvrés',
  de: '5–7 Werktage',
  it: '5-7 giorni lavorativi',
  pt: '5 a 7 dias úteis',
  nl: '5-7 werkdagen',
});

const SHIPPING_OPTION_ENTITY = 'shipping-option';
const SHIPPING_OPTION_TARGET_TYPE = 'ecom/shipping-option';
const SHIPPING_OPTION_OPERATION = 'createShippingOptionVerified';
const SHIPPING_ESTIMATES_FILE = 'execution/shipping-estimates.json';
const ORCHESTRATION_STATE_CLI = 'skills/wix-replatform/scripts/orchestration-state.js';
const SHIPPING_ESTIMATE_AUDIT_CLI = 'skills/wix-replatform/resources/rp-execute-import/scripts/shipping-estimate-audit.js';
const SHIPPING_COMPLETION_CODES = Object.freeze([
  'shipping-estimate-default',
  'shipping-estimate-missing',
  'shipping-estimate-legacy-blank',
  'shipping-option-reconcile',
  'shipping-option-target-missing',
]);
const ACTION_LIST_LIMIT = 15;

function textOf(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

// The DESTINATION site's language, from a Site Properties read. `null` (a failed read, or nothing
// set) is treated as an unsupported language by resolveDeliveryEstimate.
function siteLanguageFromProperties(properties) {
  const raw = textOf(properties && properties.language) || textOf(properties && properties.locale && properties.locale.languageCode);
  return raw ? raw.toLowerCase() : null;
}

function primaryLanguage(siteLanguage) {
  const raw = textOf(siteLanguage).toLowerCase();
  return raw ? raw.split(/[-_]/)[0] : null;
}

function resolveDeliveryEstimate({ sourceText, merchantText, siteLanguage } = {}) {
  const merchant = textOf(merchantText);
  if (merchant) return { text: merchant, origin: 'merchant' };
  const source = textOf(sourceText);
  if (source) return { text: source, origin: 'source' };
  const language = primaryLanguage(siteLanguage);
  if (language && Object.prototype.hasOwnProperty.call(DEFAULT_ESTIMATE_BY_LANGUAGE, language)) {
    return { text: DEFAULT_ESTIMATE_BY_LANGUAGE[language], origin: 'default' };
  }
  return { text: '', origin: 'missing' };
}

// Only a `source: "user"` decision is the merchant's own words. Anything else is listed, never used.
function userDecision(decisions, key) {
  const entry = decisions && typeof decisions === 'object' ? decisions[key] : undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { entry: null, ignored: null };
  if (entry.source === 'user') return { entry, ignored: null };
  return { entry: null, ignored: { key, source: entry.source === undefined ? null : entry.source } };
}

function planShippingEstimates({ zonePlans = [], decisions = {}, siteLanguage = null } = {}) {
  const options = [];
  const ignoredDecisions = [];
  const ignoredKeys = new Set();
  for (const plan of zonePlans || []) {
    const zone = plan.zone || {};
    const zoneId = String(zone.id);
    const decisionKey = `shipping-delivery-estimate:${zoneId}`;
    const { entry, ignored } = userDecision(decisions, decisionKey);
    if (ignored && !ignoredKeys.has(decisionKey)) {
      ignoredKeys.add(decisionKey);
      ignoredDecisions.push(ignored);
    }
    const sourceText = textOf(zone.deliveryEstimate);
    const merchantText = entry ? textOf(entry.value) : '';
    for (const option of plan.shippingOptions || []) {
      const { text, origin } = resolveDeliveryEstimate({ sourceText, merchantText, siteLanguage });
      options.push({
        optionKey: shippingOptionKey(zoneId, option),
        zoneId,
        zoneName: textOf(zone.name),
        title: option.classified.title || 'Shipping',
        sourceText,
        merchantText,
        text,
        origin,
      });
    }
  }
  return { schemaVersion: 1, siteLanguage: siteLanguage || null, options, ignoredDecisions, legacy: [] };
}

// --- Read-back verification -----------------------------------------------------
function canonicalCondition(condition) {
  return JSON.stringify([textOf(condition && condition.type), textOf(condition && condition.operator), Number(condition && condition.value)]);
}

function canonicalRate(rate) {
  return JSON.stringify([
    Number(rate && rate.amount),
    (Array.isArray(rate && rate.conditions) ? rate.conditions : []).map(canonicalCondition).sort(),
    Boolean(rate && rate.multiplyByQuantity),
  ]);
}

function ratesEqual(sentRates, storedRates) {
  const a = (Array.isArray(sentRates) ? sentRates : []).map(canonicalRate).sort();
  const b = (Array.isArray(storedRates) ? storedRates : []).map(canonicalRate).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function storedEstimate(option) {
  return typeof (option && option.estimatedDeliveryTime) === 'string' ? option.estimatedDeliveryTime : '';
}

function verifyShippingOptionReadBack(sent, stored, { ignoreEstimate = false } = {}) {
  const mismatched = [];
  if (!stored || typeof stored !== 'object') return { ok: false, mismatched: ['title', 'estimatedDeliveryTime', 'rates'] };
  if ((sent && sent.title) !== stored.title) mismatched.push('title');
  if (!ignoreEstimate && storedEstimate(sent) !== storedEstimate(stored)) mismatched.push('estimatedDeliveryTime');
  if (!ratesEqual(sent && sent.rates, stored.rates)) mismatched.push('rates');
  return { ok: mismatched.length === 0, mismatched };
}

// --- Accounting: one result -> the exact journal/crosswalk rows ------------------
const OUTCOME_ROWS = {
  'shipping-option-created': { status: 'imported' },
  'shipping-option-unverified': { status: 'succeeded_unverified', errorCode: 'READ_BACK_MISMATCH' },
  'shipping-option-unknown': { status: 'succeeded_unverified', errorCode: 'OUTCOME_UNKNOWN' },
  'shipping-option-ambiguous': { status: 'succeeded_unverified', errorCode: 'AMBIGUOUS_MATCH' },
  'shipping-option-absent': { status: 'failed_retryable', errorCode: 'KNOWN_ABSENT' },
  'shipping-option-not-found': { status: 'failed_terminal', errorCode: 'NOT_FOUND' },
  'shipping-option-not-attempted': { status: 'failed_retryable' },
};

function failedStatusFor(httpStatus) {
  return httpStatus === 429 || (Number.isInteger(httpStatus) && httpStatus >= 500) ? 'failed_retryable' : 'failed_terminal';
}

// The message is prose only: every identifier lives in a structured field.
function outcomeMessage(result, status) {
  switch (result.outcome) {
    case 'shipping-option-unverified':
      return result.reason || `read-back did not match what was sent (${(result.mismatched || []).join(', ') || 'unknown fields'})`;
    case 'shipping-option-unknown':
      return `create outcome unknown (${result.reason || 'no readable reply'}); reconcile by reading the region back, never re-send`;
    case 'shipping-option-ambiguous':
      return `several options match after an unknown outcome (${(result.candidateTargetIds || []).length} candidates); a recorded shipping-option-adopt decision is required`;
    case 'shipping-option-absent':
      return 'reconciliation found no option this run created; the next normal pass may create it';
    case 'shipping-option-not-found':
      return 'the recorded target returned 404; never re-created automatically';
    case 'shipping-option-not-attempted':
      return result.reason || 'not attempted';
    case 'shipping-option-failed':
      return `create rejected with HTTP ${result.httpStatus === null || result.httpStatus === undefined ? 'unknown' : result.httpStatus}${result.errorCode ? ` (${result.errorCode})` : ''}`;
    default:
      return status;
  }
}

function shippingOptionWriteRecord(result, ctx = {}) {
  if (!result || typeof result.outcome !== 'string') throw new Error('shippingOptionWriteRecord: result.outcome is required');
  for (const field of ['attemptId', 'sourceSystem', 'sourceId', 'sourceStableKey', 'writeSpecId', 'runId', 'phase']) {
    if (!ctx[field] || typeof ctx[field] !== 'string') throw new Error(`shippingOptionWriteRecord: ctx.${field} is required`);
  }
  let status;
  let errorCode = null;
  if (result.outcome === 'shipping-option-failed') {
    status = failedStatusFor(result.httpStatus);
    errorCode = result.errorCode || null;
  } else if (OUTCOME_ROWS[result.outcome]) {
    status = OUTCOME_ROWS[result.outcome].status;
    errorCode = result.errorCode || OUTCOME_ROWS[result.outcome].errorCode || null;
  } else {
    throw new Error(`shippingOptionWriteRecord: unknown outcome ${result.outcome}`);
  }
  const id = result.id || null;
  const baseReconcile = ctx.reconcile && typeof ctx.reconcile === 'object' ? ctx.reconcile : null;
  const candidateTargetIds = Array.isArray(result.candidateTargetIds) && result.candidateTargetIds.length > 0 ? [...result.candidateTargetIds] : null;
  const reconcile = baseReconcile || candidateTargetIds
    ? { ...(baseReconcile || {}), ...(candidateTargetIds ? { candidateTargetIds } : {}) }
    : undefined;
  const attempt = {
    schemaVersion: 1,
    attemptId: ctx.attemptId,
    sourceSystem: ctx.sourceSystem,
    sourceEntityType: SHIPPING_OPTION_ENTITY,
    sourceId: ctx.sourceId,
    sourceStableKey: ctx.sourceStableKey,
    writeSpecId: ctx.writeSpecId,
    runId: ctx.runId,
    phase: ctx.phase,
    operation: SHIPPING_OPTION_OPERATION,
    targetEntityType: SHIPPING_OPTION_TARGET_TYPE,
    status,
    ...(status === 'imported' ? { targetId: id } : {}),
    ...(result.estimateKept ? { estimateKept: result.estimateKept } : {}),
    ...(reconcile ? { reconcile } : {}),
    updatedAt: ctx.now || new Date().toISOString(),
  };
  if (status !== 'imported') {
    attempt.failure = {
      sourceId: ctx.sourceId,
      targetEntityId: id,
      operation: SHIPPING_OPTION_OPERATION,
      httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
      errorCode,
      scopeGroupName: null,
      outcome: { failed_retryable: 'failed_retryable', failed_terminal: 'failed_terminal', succeeded_unverified: 'unresolved' }[status],
      ...(Array.isArray(result.mismatched) && result.mismatched.length ? { mismatched: [...result.mismatched] } : {}),
      message: outcomeMessage(result, status),
    };
  }
  const crosswalk = status === 'imported'
    ? {
      schemaVersion: 1,
      sourceSystem: ctx.sourceSystem,
      sourceEntityType: SHIPPING_OPTION_ENTITY,
      sourceId: ctx.sourceId,
      sourceStableKey: ctx.sourceStableKey,
      targetSystem: 'wix',
      targetEntityType: SHIPPING_OPTION_TARGET_TYPE,
      targetId: id,
      status: 'imported',
      updatedAt: attempt.updatedAt,
    }
    : null;
  return { attempt, crosswalk };
}

// --- Linked targets: missing-target decisions and the read-only audit --------
function isNotFound(error) {
  return Boolean(error && error.status === 404 && error.outcomeKnown !== false);
}

async function readShippingOption(wix, id) {
  const { getShippingOption } = require('./wix-writers.js');
  try {
    const option = await getShippingOption(wix, id);
    // A 2xx without the requested option is an unknown read, never evidence: no blank-estimate
    // conclusion and no crosswalk adoption may follow from it.
    if (!option || typeof option !== 'object' || Array.isArray(option) || option.id !== id) {
      return { ok: false, notFound: false, malformed: true };
    }
    return { ok: true, option };
  } catch (error) {
    return { ok: false, notFound: isNotFound(error), error };
  }
}

// One shared applier for the shipping stage and the finished-project audit, so a recorded
// `shipping-option-target-missing:<optionKey>` decision behaves identically in both. It never
// writes to Wix; a changed adoption returns ONE replacement crosswalk row for the caller to upsert.
async function applyTargetMissingDecision(wix, { crosswalkRow, decisions = {}, now } = {}) {
  if (!crosswalkRow || !crosswalkRow.sourceId) throw new Error('applyTargetMissingDecision: crosswalkRow is required');
  const key = `shipping-option-target-missing:${crosswalkRow.sourceId}`;
  const { entry, ignored } = userDecision(decisions, key);
  const value = entry ? textOf(entry.value) : '';
  if (!entry || !value) return { state: 'open', ...(ignored ? { ignoredDecision: ignored } : {}) };
  if (value === 'retired') return { state: 'retired' };
  const match = /^recreated:(.+)$/.exec(value);
  if (!match) return { state: 'open', invalidDecision: { key, value } };
  const newTargetId = match[1].trim();
  if (crosswalkRow.targetId === newTargetId && crosswalkRow.provenance === 'operator-recreated') {
    // Already adopted by an earlier run: no mutation, so a decision that stays in decisions.json
    // can never grow or rewrite the crosswalk.
    return { state: 'adopted', auditRow: crosswalkRow };
  }
  const read = await readShippingOption(wix, newTargetId);
  if (!read.ok && read.notFound) return { state: 'recorded-id-missing', newTargetId };
  if (!read.ok) return { state: 'open', readError: true, newTargetId };
  const replacement = {
    ...crosswalkRow,
    targetId: newTargetId,
    provenance: 'operator-recreated',
    updatedAt: now || new Date().toISOString(),
  };
  delete replacement.verification;
  return { state: 'adopted', crosswalkUpsert: replacement, auditRow: replacement, option: read.option };
}

function fixedWriterTargetIds(attemptRows) {
  const ids = new Set();
  for (const row of attemptRows || []) {
    if (row && row.status === 'imported' && row.operation === SHIPPING_OPTION_OPERATION && row.targetId) ids.add(row.targetId);
  }
  return ids;
}

function resolutionByKey(resolution) {
  const map = new Map();
  for (const option of (resolution && Array.isArray(resolution.options) ? resolution.options : [])) map.set(option.optionKey, option);
  return map;
}

function optionLabel(optionKey, resolution) {
  const resolved = resolutionByKey(resolution).get(optionKey);
  return resolved ? `${resolved.zoneName} → ${resolved.title} [${optionKey}]` : `option ${optionKey}`;
}

// Read-only. Processes the EFFECTIVE crosswalk (one row per source key), so each source option gets
// at most one GET, one result and one contribution per run. Returns what the fragment needs:
//   readBack       — optionKey -> stored option, for targets the fixed writer created (or an
//                    adopted operator-recreated target), feeding -default / -missing;
//   legacyBlank    — earlier-migration options still showing no estimate (report only);
//   targetMissing  — linked targets that 404 (either provenance), with no valid user decision;
//   crosswalkUpserts — replacement rows for a changed `recreated:<id>` adoption.
async function auditShippingEstimates(wix, { crosswalkBySource = {}, attemptRows = [], resolution = null, decisions = {}, now } = {}) {
  if (Array.isArray(crosswalkBySource)) throw new Error('auditShippingEstimates: pass the effective crosswalk bySource map, never raw crosswalk history');
  const fixedIds = fixedWriterTargetIds(attemptRows);
  const resolved = resolutionByKey(resolution);
  const out = { readBack: {}, recreated: {}, legacyBlank: [], targetMissing: [], crosswalkUpserts: [], retired: [], gets: 0 };
  const rows = Object.values(crosswalkBySource)
    .filter((row) => row && row.targetEntityType === SHIPPING_OPTION_TARGET_TYPE)
    .sort((a, b) => String(a.sourceStableKey).localeCompare(String(b.sourceStableKey)));
  for (const linked of rows) {
    const optionKey = linked.sourceId;
    const label = optionLabel(optionKey, resolution);
    const decision = await applyTargetMissingDecision(wix, { crosswalkRow: linked, decisions, now });
    if (decision.state === 'retired') {
      out.retired.push(optionKey);
      continue;
    }
    if (decision.state === 'recorded-id-missing') {
      out.targetMissing.push({
        optionKey, targetId: linked.targetId, provenance: fixedIds.has(linked.targetId) ? 'fixed-writer' : 'earlier-migration',
        label, recordedIdMissing: true, newTargetId: decision.newTargetId,
      });
      continue;
    }
    const row = decision.state === 'adopted' ? decision.auditRow : linked;
    if (decision.crosswalkUpsert) out.crosswalkUpserts.push(decision.crosswalkUpsert);
    let option = decision.option;
    if (!option) {
      out.gets += 1;
      const read = await readShippingOption(wix, row.targetId);
      if (!read.ok && read.notFound) {
        out.targetMissing.push({
          optionKey, targetId: row.targetId, provenance: fixedIds.has(row.targetId) ? 'fixed-writer' : 'earlier-migration', label,
        });
        continue;
      }
      if (!read.ok) continue; // unknown read: nothing is concluded, nothing is written
      option = read.option;
    } else {
      out.gets += 1;
    }
    if (row.provenance === 'operator-recreated') {
      out.recreated[optionKey] = option;
      continue;
    }
    if (fixedIds.has(row.targetId)) {
      out.readBack[optionKey] = option;
      continue;
    }
    // Earlier-migration evidence: report a blank estimate, never edit it.
    if (storedEstimate(option) === '') {
      const proposal = resolved.get(optionKey);
      out.legacyBlank.push({
        optionKey,
        targetId: row.targetId,
        title: option && option.title ? option.title : (proposal ? proposal.title : null),
        label: proposal ? `${proposal.zoneName} → ${proposal.title}` : `option ${optionKey}`,
        proposedText: proposal && proposal.text ? proposal.text : null,
        proposedOrigin: proposal ? proposal.origin : 'unknown',
      });
    }
  }
  return out;
}

// --- The completion fragment ----------------------------------------------------
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function listItems(items) {
  const shown = items.slice(0, ACTION_LIST_LIMIT);
  const more = items.length - shown.length;
  return `${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}`;
}

function relayPrompt(code, count, projectDirArg) {
  if (count <= ACTION_LIST_LIMIT) return '';
  return ` Then list every option in ${SHIPPING_ESTIMATES_FILE} with code ${code} and send it to the Cutover Operator: \`node ${SHIPPING_ESTIMATE_AUDIT_CLI} --project-dir ${projectDirArg} --list ${code}\`.`;
}

function actionRow({ code, severity, bmStep, items, prompt, deadlineReason, projectDirArg }) {
  return {
    code,
    severity,
    action: `${bmStep} Affected: ${listItems(items)}. Requires Import Operator: ${prompt}${relayPrompt(code, items.length, projectDirArg)}`,
    deadlineReason,
    entity: SHIPPING_OPTION_ENTITY,
    affectedCount: items.length,
  };
}

function rerunSentence(projectDirArg) {
  return `rerun the shipping stage, or for a finished project \`node ${SHIPPING_ESTIMATE_AUDIT_CLI} --project-dir ${projectDirArg}\``;
}

function decideCommand(projectDirArg, key, value) {
  return `\`node ${ORCHESTRATION_STATE_CLI} decide --project-dir ${projectDirArg} --key ${shellQuote(key)} --value ${shellQuote(value)} --source user\``;
}

// Builds the five shipping operatorActions from the CURRENT state, not just this run's events,
// and also returns the per-option `items` written to execution/shipping-estimates.json.
function shippingEstimateCompletionFragment({ resolution = null, readBack = {}, latestAttempts = {}, audit = null, projectDir = null } = {}) {
  const projectDirArg = projectDir ? shellQuote(projectDir) : '<projectDir>';
  const operatorActions = [];
  const items = [];
  const resolved = resolution && Array.isArray(resolution.options) ? resolution.options : [];
  const resolvedByKey = resolutionByKey(resolution);
  const effectiveAudit = audit || { recreated: {}, legacyBlank: [], targetMissing: [] };

  // -default: the migration's default is still what checkout shows.
  const defaults = resolved.filter((option) => option.origin === 'default'
    && readBack[option.optionKey] && storedEstimate(readBack[option.optionKey]) === option.text);
  if (defaults.length) {
    const zones = [...new Map(defaults.map((option) => [option.zoneId, option])).values()];
    const commands = zones.map((option) => decideCommand(projectDirArg, `shipping-delivery-estimate:${option.zoneId}`, option.text));
    operatorActions.push(actionRow({
      code: 'shipping-estimate-default',
      severity: 'medium',
      bmStep: 'Business Manager: ask the merchant to confirm the delivery time shown on each listed option, or enter theirs (Settings → Shipping & delivery).',
      items: defaults.map((option) => `${option.zoneName} → ${option.title} (proposed: "${option.text}")`),
      prompt: `if the merchant confirms the default unchanged, record it for each listed zone: ${commands.join('; ')}; then ${rerunSentence(projectDirArg)}. A changed value entered in Business Manager clears this item on that rerun.`,
      deadlineReason: 'Checkout promises a window the store never stated',
      projectDirArg,
    }));
    for (const option of defaults) items.push({ code: 'shipping-estimate-default', optionKey: option.optionKey, label: `${option.zoneName} → ${option.title}`, proposedText: option.text });
  }

  // -missing: a fixed-writer (or hand-recreated) option still blank at checkout.
  const missing = [];
  for (const [optionKey, stored] of Object.entries(readBack)) {
    if (storedEstimate(stored) !== '') continue;
    const option = resolvedByKey.get(optionKey);
    missing.push({ optionKey, label: option ? `${option.zoneName} → ${option.title}` : `option ${optionKey}`, proposedText: null });
  }
  for (const [optionKey, stored] of Object.entries(effectiveAudit.recreated || {})) {
    if (storedEstimate(stored) !== '') continue;
    const option = resolvedByKey.get(optionKey);
    missing.push({ optionKey, label: `${option ? `${option.zoneName} → ${option.title}` : `option ${optionKey}`} (recreated by hand)`, proposedText: null });
  }
  missing.sort((a, b) => a.optionKey.localeCompare(b.optionKey));
  if (missing.length) {
    operatorActions.push(actionRow({
      code: 'shipping-estimate-missing',
      severity: 'high',
      bmStep: 'Business Manager: ask the merchant for a delivery time and enter it on each listed option (Settings → Shipping & delivery).',
      items: missing.map((entry) => entry.label),
      prompt: `after the delivery times are entered, ${rerunSentence(projectDirArg)} so the read-back clears this item.`,
      deadlineReason: 'Checkout shows no delivery time',
      projectDirArg,
    }));
    for (const entry of missing) items.push({ code: 'shipping-estimate-missing', ...entry });
  }

  // -reconcile: every latest folded row still AMBIGUOUS_MATCH, until a recorded choice resolves it.
  const ambiguous = Object.values(latestAttempts || {})
    .filter((row) => row && row.sourceEntityType === SHIPPING_OPTION_ENTITY && row.status === 'succeeded_unverified'
      && row.failure && row.failure.errorCode === 'AMBIGUOUS_MATCH')
    .sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId)));
  if (ambiguous.length) {
    const commands = ambiguous.map((row) => decideCommand(projectDirArg, `shipping-option-adopt:${row.sourceId}`, '<targetId>'));
    operatorActions.push(actionRow({
      code: 'shipping-option-reconcile',
      severity: 'high',
      bmStep: 'Business Manager: open the listed candidate options and identify which one, if any, the migration created. Do not delete any yet.',
      items: ambiguous.map((row) => `${optionLabel(row.sourceId, resolution)} (candidates: ${((row.reconcile && row.reconcile.candidateTargetIds) || []).join(', ')})`),
      prompt: `record the choice: ${commands.join('; ')} (or --value none when none of them is the migration's), then run the import with --unresolved-only.`,
      deadlineReason: "A write's outcome is unknown and several options match; nothing more is created until this is recorded",
      projectDirArg,
    }));
    for (const row of ambiguous) items.push({ code: 'shipping-option-reconcile', optionKey: row.sourceId, candidateTargetIds: [...((row.reconcile && row.reconcile.candidateTargetIds) || [])] });
  }

  // -target-missing: a crosswalked option that 404s. Never recreated automatically.
  const targetMissing = [...(effectiveAudit.targetMissing || [])].sort((a, b) => a.optionKey.localeCompare(b.optionKey));
  if (targetMissing.length) {
    const commands = targetMissing.map((entry) => `${decideCommand(projectDirArg, `shipping-option-target-missing:${entry.optionKey}`, 'recreated:<newTargetId>')} (or --value retired)`);
    operatorActions.push(actionRow({
      code: 'shipping-option-target-missing',
      severity: 'high',
      bmStep: 'Business Manager: these shipping options no longer exist. Ask the merchant whether each should be offered again; if yes, create it in Settings → Shipping & delivery and note its id.',
      items: targetMissing.map((entry) => `${entry.label} (was ${entry.targetId}, created by ${entry.provenance === 'fixed-writer' ? 'the fixed writer' : 'an earlier migration'})${entry.recordedIdMissing ? ` — the recorded new id was not found (${entry.newTargetId})` : ''}`),
      prompt: `record the outcome: ${commands.join('; ')}. Then ${rerunSentence(projectDirArg)}.`,
      deadlineReason: 'A shipping choice the migration created is gone from checkout; the migration will not recreate it',
      projectDirArg,
    }));
    for (const entry of targetMissing) items.push({ code: 'shipping-option-target-missing', optionKey: entry.optionKey, targetId: entry.targetId, provenance: entry.provenance, label: entry.label, ...(entry.recordedIdMissing ? { recordedIdMissing: true } : {}) });
  }

  // -legacy-blank: an earlier migration's option, report only.
  const legacy = [...(effectiveAudit.legacyBlank || [])].sort((a, b) => a.optionKey.localeCompare(b.optionKey));
  if (legacy.length) {
    operatorActions.push(actionRow({
      code: 'shipping-estimate-legacy-blank',
      severity: 'medium',
      bmStep: 'Business Manager: ask the merchant for a delivery time and enter it on each listed option (Settings → Shipping & delivery); the proposed text is listed.',
      items: legacy.map((entry) => `${entry.label} (proposed: ${entry.proposedText ? `"${entry.proposedText}"` : 'none — ask the merchant'})`),
      prompt: `after entry, rerun \`node ${SHIPPING_ESTIMATE_AUDIT_CLI} --project-dir ${projectDirArg}\` so the read-back clears this item.`,
      deadlineReason: 'Created before the field fix; the shopper sees no delivery time',
      projectDirArg,
    }));
    for (const entry of legacy) items.push({ code: 'shipping-estimate-legacy-blank', ...entry });
  }

  return { operatorActions, items };
}

// Each run REPLACES the previous run's shipping items, so a resolved item drops out on the next run.
function mergeShippingEstimateCompletion(completionInput = {}, fragment = { operatorActions: [] }) {
  const codes = new Set(SHIPPING_COMPLETION_CODES);
  return {
    ...completionInput,
    operatorActions: [
      ...(completionInput.operatorActions || []).filter((row) => !codes.has(row && row.code)),
      ...((fragment && fragment.operatorActions) || []),
    ],
  };
}

module.exports = {
  BASIC_SHIPPING_APP_ID,
  CONTINENT_COUNTRIES,
  MISSING_RATES_ALERT,
  CONDITION_BY_TOTAL_PRICE,
  normalizeZoneLocations,
  classifyMethod,
  hasWorkingCarrier,
  unconditionalRate,
  priceThresholdRates,
  freeAboveThresholdRates,
  buildDeliveryCarrierInput,
  buildPickupCarrierInput,
  buildShippingOptionInput,
  buildPickupLocationInput,
  buildDeliveryRegionInput,
  deliveryRegionDedupeKey,
  resolveZoneMethods,
  pickupLocationsFromWpSettings,
  buildMinimalPickupAddress,
  resolvePickupAddressSource,
  resolveFreeShippingCouponCoverage,
  findFreeShippingCouponConflicts,
  planShippingZones,
  shouldSkipShippingDomain,
  verifyShippingEconomics,
  // Delivery estimate: resolution, verified write, follow-up items
  ESTIMATED_DELIVERY_TIME_MAX,
  DEFAULT_ESTIMATE_BY_LANGUAGE,
  SHIPPING_COMPLETION_CODES,
  SHIPPING_ESTIMATES_FILE,
  SHIPPING_OPTION_OPERATION,
  SHIPPING_OPTION_TARGET_TYPE,
  shippingOptionKey,
  siteLanguageFromProperties,
  resolveDeliveryEstimate,
  planShippingEstimates,
  verifyShippingOptionReadBack,
  shippingOptionWriteRecord,
  applyTargetMissingDecision,
  auditShippingEstimates,
  shippingEstimateCompletionFragment,
  mergeShippingEstimateCompletion,
  shellQuote,
};
