'use strict';

const { isBlank } = require('./value-utils.js');

// rp-target-wix — the DETERMINISTIC WooCommerce store-settings -> Wix Site Properties builder.
// Companion to tax-build.js/shipping-build.js; implements domains/site/entities/
// business-contact.json's mappingGuidance as code.
//
// Input is the raw WooCommerce shape from GET /wc/v3/settings/general: a flat array of
// {id, label, value, ...} records. Already-fetched — per this codebase's "transform takes shaped
// input, fetching is the caller's job" convention.
//
// That route is NOT part of the default discovery sweep: it classifies as a setup surface, so it
// is only read deliberately. It also needs the WordPress application password rather than the
// store's own consumer key.

const ZIP_MAX_LENGTH = 20;

function settingsToMap(settings) {
  const map = {};
  for (const setting of settings || []) {
    if (!setting || typeof setting.id !== 'string') continue;
    map[setting.id] = setting.value;
  }
  return map;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// WooCommerce packs country and state into ONE setting: `woocommerce_default_country` is either
// `IL` or `COUNTRY:STATE` (e.g. `US:CA`) — the same encoding a shipping zone's `state`-type
// location uses. Wix takes them as two separate fields, and storing `US:CA` as `country` does not
// error; it just matches nothing. Splitting is not optional.
function splitDefaultCountry(value) {
  const raw = trimmed(value);
  if (!raw) return { country: '', state: '' };
  const [country, state] = raw.split(':');
  return { country: trimmed(country).toUpperCase(), state: trimmed(state).toUpperCase() };
}

// --- WooCommerce general settings -> Wix businessContact.address --------------------------------
// Deliberately NOT done here:
//   - Splitting a house number out of the address line. The source field is one free-text value
//     with no structure guarantee — some shops put the number first, some last, some have none at
//     all. Wix has a separate `streetNumber`, which is exactly the invitation to guess. A wrong
//     split is worse than no split: it looks deliberate. The whole line goes in `street`.
//   - Geocoding. `coordinates` and `googleFormattedAddress` are real fields with no source
//     counterpart; inventing a latitude asserts a precision the source never had.
function buildBusinessAddress(settings) {
  const map = settingsToMap(settings);
  const notes = [];

  const street = trimmed(map.woocommerce_store_address);
  const apartmentNumber = trimmed(map.woocommerce_store_address_2);
  const city = trimmed(map.woocommerce_store_city);
  const { country, state } = splitDefaultCountry(map.woocommerce_default_country);
  let zip = trimmed(map.woocommerce_store_postcode);

  if (zip.length > ZIP_MAX_LENGTH) {
    notes.push(`Source postcode "${zip}" exceeds Wix's ${ZIP_MAX_LENGTH}-character limit for zip and was dropped rather than truncated — a truncated postcode is wrong data that looks right. Set it by hand.`);
    zip = '';
  }
  if (!country) {
    notes.push('Source has no store country (woocommerce_default_country is empty) — Wix needs an ISO 3166-1 alpha-2 country code, and there is nothing to derive one from.');
  }
  if (!street && !city && !zip) {
    notes.push('Source has no street, city or postcode — there is no address here to migrate.');
  }

  const address = {
    ...(street ? { street } : {}),
    ...(apartmentNumber ? { apartmentNumber } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(country ? { country } : {}),
    ...(zip ? { zip } : {}),
    isPhysical: true,
  };

  const hasAnything = Boolean(street || city || zip || country);
  return { address: hasAnything ? address : null, notes };
}

// The payload for wix-writers.js's updateBusinessContact. Only `address` is ever populated here:
// WooCommerce's general settings carry no business email/phone/fax, and the writer derives its
// field mask from the payload's own keys — so an address-only payload can never clear the
// merchant's own contact details. That is the whole reason this returns a narrow object rather
// than a full BusinessContactData with empty strings in it.
function buildBusinessContactInput(settings) {
  const { address, notes } = buildBusinessAddress(settings);
  if (!address) return { businessContact: null, notes };
  return { businessContact: { address }, notes };
}

// --- Report-only settings ----------------------------------------------------------------------
// Each of these changes what a buyer can do, and none is written by this pipeline. Surfacing them
// with the source value beside the destination's current value is what turns "we didn't migrate
// it" from an invisible omission into a decision the merchant can make in one look.
const REPORT_ONLY_SETTINGS = [
  ['woocommerce_currency', 'Store currency', 'Wix prices in the site\'s payment currency; a mismatch means every price is displayed in a currency the merchant never chose.'],
  ['woocommerce_allowed_countries', 'Which countries may buy', 'Combined with the specific-countries list below. A store that sells to one country only will otherwise become a store that sells everywhere.'],
  ['woocommerce_specific_allowed_countries', 'Specific selling countries', 'Only meaningful when the setting above is "specific".'],
  ['woocommerce_ship_to_countries', 'Which countries may be shipped to', 'Empty means "inherit the selling countries". Interacts with the delivery regions built from the source shipping zones.'],
  ['woocommerce_calc_taxes', 'Tax calculation on/off', 'A source with tax calculation OFF should not arrive with tax being calculated, and vice versa.'],
  ['woocommerce_enable_coupons', 'Coupons on/off', 'A store with coupons disabled at source should not arrive accepting them.'],
  ['woocommerce_currency_pos', 'Currency symbol position', 'Display only.'],
  ['woocommerce_price_thousand_sep', 'Thousands separator', 'Display only.'],
  ['woocommerce_price_decimal_sep', 'Decimal separator', 'Display only.'],
  ['woocommerce_price_num_decimals', 'Decimal places', 'Display only.'],
];

function collectReportOnlySettings(settings) {
  const map = settingsToMap(settings);
  const rows = [];
  for (const [id, label, why] of REPORT_ONLY_SETTINGS) {
    if (!(id in map)) continue;
    const value = map[id];
    if (isBlank(value) && id !== 'woocommerce_ship_to_countries') continue;
    rows.push({ id, label, sourceValue: String(value ?? ''), why });
  }
  return rows;
}

module.exports = {
  ZIP_MAX_LENGTH,
  REPORT_ONLY_SETTINGS,
  settingsToMap,
  splitDefaultCountry,
  buildBusinessAddress,
  buildBusinessContactInput,
  collectReportOnlySettings,
};
