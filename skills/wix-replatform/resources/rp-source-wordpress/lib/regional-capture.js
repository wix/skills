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
//
// A read that is denied, absent or malformed is an explicit unknown with a reason. It is never a
// discovery failure and never a guess: the currency is never taken from an order.

const { buildSourceRegional } = require('../../../lib/source-regional.js');
const { readStoreCurrency, resolveOrderCurrency } = require('./store-currency.js');

const GENERAL_ROUTE = '/wc/v3/settings/general';
const SITE_ROUTE = '/wp/v2/settings';
const ORDERS_ROUTE = '/wc/v3/orders';

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

function timeZoneInput(site) {
  const evidence = `${SITE_ROUTE} timezone`;
  if (!site || !site.ok) return { reason: site ? site.reason : 'not-exposed', evidence };
  const body = site.body || {};
  // `timezone_string` is the option's own name; the REST field is `timezone`. A site on a fixed
  // offset has neither, and an offset is not a zone.
  const zone = text(body.timezone_string !== undefined ? body.timezone_string : body.timezone);
  return zone ? { value: zone, evidence } : { reason: 'not-exposed', evidence };
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

function buildWordPressRegional({ general, site, ordersEntity = null, generatedAt } = {}) {
  const currency = currencyInput(general);
  return buildSourceRegional({
    adapter: 'wordpress',
    generatedAt,
    currency,
    timeZone: timeZoneInput(site),
    primaryLanguage: languageInput(site),
    country: countryInput(general),
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
  readFailureReason,
  readRegionalSettings,
  parseLanguageTag,
  orderCurrencyCounts,
  buildWordPressRegional,
  htmlLanguage,
  buildQuickWooCommerceRegional,
};
