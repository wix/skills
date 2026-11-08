'use strict';

// The WordPress / WooCommerce store's regional facts -- payment currency, time zone, language,
// country -- mapped onto `buildSourceRegional`'s input. Pure except `readRegionalSettings`, whose
// transport is injected so a test never needs a network.
//
// Field names below come from the WordPress and WooCommerce REST schemas and from the existing
// settings capture, not from a live read of any particular store:
//   - `GET /wc/v3/settings/general` -> entries `{ id, value }`: `woocommerce_currency`,
//     `woocommerce_default_country` (`CC` or `CC:STATE`).
//   - `GET /wp/v2/settings` -> `timezone` (the `timezone_string` option; empty when the site uses
//     a fixed `gmt_offset`) and `language` (the locale tag, `he_IL`).
//   - `GET /wp-json/` (the public REST index discovery already reads) -> `timezone_string` and
//     `gmt_offset` (hours, e.g. `"0"`, `5.5`).
//
// A store on a fixed UTC offset has no named zone, and Wix needs one. Discovery then picks one
// from the store country (owner decision, 2026-11-03, option A): a country with one zone gets that
// zone even when the offset disagrees (UTC+0 is the WordPress default, i.e. usually never set); a
// country with several zones gets the single one whose standard or summer offset equals the fixed
// offset. The pick is written as `supplied` by `discovery-inference` with the offset and the reason.
// When no single zone fits, the field stays unknown but carries the same `inference` record
// (`basis: unresolved`); setup then keeps the site's own zone. Either way setup raises a cutover
// task to confirm the site time zone. Never asked mid-run.
//
// A read that is denied, absent or malformed is an explicit unknown with a reason. It is never a
// discovery failure and never a guess: the currency is never taken from an order.

const { readStoreCurrency, resolveOrderCurrency } = require('./store-currency.js');
const { buildSourceRegional, knownTimeZone, knownCountry } = require('../../../lib/source-regional.js');

const GENERAL_ROUTE = '/wc/v3/settings/general';
const SITE_ROUTE = '/wp/v2/settings';
const ORDERS_ROUTE = '/wc/v3/orders';
const INDEX_ROUTE = '/wp-json/';

// 401/403: the credential cannot read it. 404: the route does not exist on this site.
function readFailureReason(status) {
  if (status === 401 || status === 403) return 'auth-gated';
  if (status === 404) return 'not-exposed';
  return 'unreadable';
}

// One bounded GET per route; `fetchJson(baseUrl, route, options)` is wp-http's. Never throws.
async function readOne(fetchJson, baseUrl, route, options) {
  try {
    const response = await fetchJson(baseUrl, route, { ...options, method: 'GET' });
    if (response && response.ok && response.json !== undefined && response.json !== null) return { ok: true, body: response.json };
    return { ok: false, reason: readFailureReason(response && response.status), route };
  } catch {
    return { ok: false, reason: 'unreadable', route };
  }
}

// `capturedGeneral` is the array the store-settings capture already wrote (reused, not re-read).
async function readRegionalSettings({ baseUrl, headers, fetchJson, timeoutMs, progress = null, capturedGeneral = null }) {
  const options = { headers, timeoutMs, progress, progressContext: { step: 'regional-settings' } };
  const general = Array.isArray(capturedGeneral)
    ? { ok: true, body: capturedGeneral }
    : await readOne(fetchJson, baseUrl, GENERAL_ROUTE, options);
  const site = await readOne(fetchJson, baseUrl, SITE_ROUTE, options);
  return { general, site };
}

const settingEntry = (entries, id) => (Array.isArray(entries) ? entries.find((entry) => entry && entry.id === id) : undefined);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

function currencyInput(general) {
  const evidence = `${GENERAL_ROUTE} woocommerce_currency`;
  if (!general || !general.ok) return { reason: general ? general.reason : 'not-exposed', evidence };
  const code = readStoreCurrency(general.body);
  if (code) return { value: code, evidence };
  const entry = settingEntry(general.body, 'woocommerce_currency');
  // Present but not a code: pass the raw value so the library records it as unreadable.
  return text(entry && entry.value) ? { value: text(entry.value), evidence } : { reason: 'not-exposed', evidence };
}

function countryInput(general) {
  const evidence = `${GENERAL_ROUTE} woocommerce_default_country`;
  if (!general || !general.ok) return { reason: general ? general.reason : 'not-exposed', evidence };
  const entry = settingEntry(general.body, 'woocommerce_default_country');
  const country = text(entry && entry.value).split(':')[0].toUpperCase();
  return country ? { value: country, evidence } : { reason: 'not-exposed', evidence };
}

// The UTC offsets (hours) a zone uses in the given year: standard and summer time.
function zoneOffsets(zone, year) {
  const offsets = new Set();
  for (const month of [0, 6]) {
    try {
      const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(new Date(Date.UTC(year, month, 15))).find((part) => part.type === 'timeZoneName').value;
      const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
      if (match) offsets.add(match[1] ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) + Number(match[3]) / 60) : 0);
    } catch { /* runtime does not know the zone */ }
  }
  return [...offsets];
}

// The named zones the runtime lists for a country (`IL` -> [`Asia/Jerusalem`]); [] when it cannot say.
function countryZones(country) {
  try {
    const locale = new Intl.Locale(`und-${country}`);
    const zones = typeof locale.getTimeZones === 'function' ? locale.getTimeZones() : locale.timeZones;
    return Array.isArray(zones) ? zones.filter((zone) => knownTimeZone(zone)) : [];
  } catch {
    return [];
  }
}

function parseGmtOffset(value) {
  if (value === undefined || value === null || value === '') return null;
  const hours = Number(value);
  return Number.isFinite(hours) && Math.abs(hours) <= 14 ? hours : null;
}

const formatOffset = (hours) => {
  if (hours === 0) return 'UTC+0';
  const minutes = Math.round(Math.abs(hours) * 60);
  return `UTC${hours < 0 ? '-' : '+'}${Math.floor(minutes / 60)}${minutes % 60 ? `:${String(minutes % 60).padStart(2, '0')}` : ''}`;
};

// A named zone for a store with no named zone: from the store country, then the fixed offset.
// Returns the source-regional input: `supplied` + `inference` when one zone fits, else `unknown`
// (`ambiguous` / `not-exposed`) + `inference` with `basis: unresolved`, which setup turns into
// "keep the site's zone and confirm it at cutover" instead of a question.
function inferTimeZone({ country, gmtOffset, evidence, now = new Date() }) {
  const zones = country ? countryZones(country) : [];
  const offsetText = gmtOffset === null ? 'no fixed offset readable' : `fixed offset ${formatOffset(gmtOffset)}`;
  let value = null;
  let basis = null;
  let matching = [];
  if (zones.length === 1) {
    value = zones[0];
    basis = 'single-zone-country';
  } else if (zones.length > 1 && gmtOffset !== null) {
    matching = zones.filter((zone) => zoneOffsets(zone, now.getUTCFullYear()).includes(gmtOffset));
    if (matching.length === 1) { value = matching[0]; basis = 'country-zone-matching-offset'; }
  }
  if (!value) {
    const why = !country ? 'store country unknown'
      : zones.length === 0 ? `no time zone listed for store country ${country}`
        : gmtOffset === null ? `store country ${country} has ${zones.length} time zones and no offset to choose by`
          : matching.length === 0 ? `no ${country} time zone uses ${formatOffset(gmtOffset)}`
            : `${matching.length} ${country} time zones use ${formatOffset(gmtOffset)}`;
    return {
      reason: country && zones.length > 1 ? 'ambiguous' : 'not-exposed',
      evidence: `${evidence}; ${offsetText}, no named zone; ${why}`,
      inference: { basis: 'unresolved', country: country || null, gmtOffset, reason: why, confirm: 'cutover' },
    };
  }
  const why = basis === 'single-zone-country'
    ? `store country ${country} has one time zone`
    : `the only ${country} time zone that uses ${formatOffset(gmtOffset)}`;
  return {
    state: 'supplied',
    value,
    suppliedBy: 'discovery-inference',
    evidence: `${evidence}; ${offsetText}, no named zone; ${value}: ${why}`,
    inference: {
      basis,
      country,
      gmtOffset,
      offsetMatches: gmtOffset === null ? null : zoneOffsets(value, now.getUTCFullYear()).includes(gmtOffset),
      confirm: 'cutover',
    },
  };
}

// `index` is the public REST index body (`timezone_string`, `gmt_offset`), or null.
function timeZoneInput(site, { index = null, country = null } = {}) {
  const evidence = `${SITE_ROUTE} timezone`;
  const body = site && site.ok ? (site.body || {}) : {};
  // `timezone_string` is the option's own name; the REST field is `timezone`. A site on a fixed
  // offset has neither, and an offset is not a zone.
  const zone = text(body.timezone_string !== undefined ? body.timezone_string : body.timezone);
  if (zone) return { value: zone, evidence };
  const indexZone = text(index && index.timezone_string);
  if (indexZone) return { value: indexZone, evidence: `${INDEX_ROUTE} timezone_string` };
  const gmtOffset = parseGmtOffset(body.gmt_offset !== undefined ? body.gmt_offset : index && index.gmt_offset);
  // Nothing readable at all (settings denied and no index): an ordinary unknown.
  if ((!site || !site.ok) && !index) return { reason: site ? site.reason : 'not-exposed', evidence };
  return inferTimeZone({ country, gmtOffset, evidence: `${site && site.ok ? `${SITE_ROUTE} timezone=""` : `${SITE_ROUTE} ${site ? site.reason : 'not-exposed'}`}; ${INDEX_ROUTE} gmt_offset` });
}

// A locale tag (`he_IL`, `en-GB`, `de_DE_formal`) -> language + the language-COUNTRY locale when
// the tag carries a region. A 3-letter language is passed on as-is and refused by the library.
function parseLanguageTag(tag) {
  const match = /^([A-Za-z]{2,3})(?:[_-]([A-Za-z]{2}))?(?:[_-].*)?$/.exec(text(tag));
  if (!match) return null;
  const value = match[1].toLowerCase();
  return { value, ...(match[2] ? { locale: `${value}-${match[2].toUpperCase()}` } : {}) };
}

function languageInput(site) {
  const evidence = `${SITE_ROUTE} language`;
  if (!site || !site.ok) return { reason: site ? site.reason : 'not-exposed', evidence };
  const raw = text(site.body && site.body.language);
  if (!raw) return { reason: 'not-exposed', evidence };
  const parsed = parseLanguageTag(raw);
  return parsed ? { ...parsed, evidence } : { value: raw, evidence };
}

// Counts of the currency on every order -- only when the sampled orders ARE every order and each
// one resolves; a sample is not a census and a count that skips an order would understate it.
function orderCurrencyCounts(ordersEntity, storeCurrency) {
  if (!ordersEntity || !Array.isArray(ordersEntity.sampleRecords)) return null;
  if (!Number.isInteger(ordersEntity.recordCount) || ordersEntity.sampleRecords.length !== ordersEntity.recordCount) return null;
  const counts = {};
  for (const order of ordersEntity.sampleRecords) {
    const { currency } = resolveOrderCurrency(order, storeCurrency);
    if (!currency) return null;
    counts[currency] = (counts[currency] || 0) + 1;
  }
  return counts;
}

// The country a zone is picked from: the store's default country, else the language tag's region.
function inferenceCountry(country, language) {
  if (country && knownCountry(country.value)) return country.value;
  const region = language && typeof language.locale === 'string' ? language.locale.slice(3) : '';
  return knownCountry(region) ? region : null;
}

function buildWordPressRegional({ general, site, index = null, ordersEntity = null, generatedAt } = {}) {
  const currency = currencyInput(general);
  const country = countryInput(general);
  const language = languageInput(site);
  return buildSourceRegional({
    adapter: 'wordpress',
    generatedAt,
    currency,
    timeZone: timeZoneInput(site, { index, country: inferenceCountry(country, language) }),
    primaryLanguage: language,
    country,
  });
}

// --- quick WooCommerce (public reads only) -------------------------------------------------------

const STORE_API_PRODUCTS_ROUTE = '/wp-json/wc/store/v1/products';

// `<html lang="he-IL">` -> { value: 'he', locale: 'he-IL' }; null when there is no usable tag.
function htmlLanguage(html) {
  const match = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(typeof html === 'string' ? html.slice(0, 65536) : '');
  return match ? parseLanguageTag(match[1]) : null;
}

// `products` is the first Store API page (array) or null when it could not be read; `page` is
// `{ html }` or null. Time zone and country are not public, so they stay unknown.
function buildQuickWooCommerceRegional({ products = null, page = null, generatedAt } = {}) {
  const currencyEvidence = `${STORE_API_PRODUCTS_ROUTE} prices.currency_code`;
  const first = Array.isArray(products) ? products.find((product) => product && product.prices && product.prices.currency_code) : null;
  const currency = first
    ? { value: text(first.prices.currency_code).toUpperCase(), evidence: currencyEvidence }
    : { reason: Array.isArray(products) ? 'not-exposed' : 'unreadable', evidence: currencyEvidence };
  const languageEvidence = 'storefront page <html lang>';
  const language = htmlLanguage(page && page.html);
  return buildSourceRegional({
    adapter: 'quick-woocommerce',
    generatedAt,
    currency,
    primaryLanguage: language
      ? { ...language, evidence: languageEvidence }
      : { reason: page ? 'not-exposed' : 'unreadable', evidence: languageEvidence },
  });
}

module.exports = {
  GENERAL_ROUTE,
  SITE_ROUTE,
  ORDERS_ROUTE,
  INDEX_ROUTE,
  readFailureReason,
  inferTimeZone,
  countryZones,
  readRegionalSettings,
  parseLanguageTag,
  orderCurrencyCounts,
  buildWordPressRegional,
  htmlLanguage,
  buildQuickWooCommerceRegional,
};
