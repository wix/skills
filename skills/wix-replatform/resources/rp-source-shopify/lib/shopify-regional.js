'use strict';

// The store's regional facts -- payment currency, time zone, language, country -- as the
// adapter-neutral `source-locale.json` (lib/source-regional.js). Currency and time zone come
// from the `shop` singleton discovery already captured (no extra read); language and country are
// two small reads (REGIONAL_READS). Nothing here is guessed: a value Shopify did not give, or
// that the library's validators reject, is an explicit `unknown` with a reason.
//
// Order currencies are counted only when discovery saw every order. Discovery samples a few orders,
// so for a real store the counts stay `null` and presentment currencies `unknown`: a partial tally
// would read as the whole store's.

const fs = require('node:fs/promises');
const path = require('node:path');
const { buildSourceRegional, writeAdapterSourceRegional } = require('../../../lib/source-regional.js');
const { ShopifyCliError } = require('./shopify-cli.js');
const { REGIONAL_READS, at } = require('./discovery-reads.js');

const [LOCALES_READ, COUNTRY_READ] = REGIONAL_READS;

async function readCaptured(rawDir, entity) {
  try {
    return JSON.parse(await fs.readFile(path.join(rawDir, 'entities', `${entity}.json`), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// A throttled read is a failed read of that value (unknown), never a stopped discovery.
async function readQuery(execute, query) {
  try {
    return await execute(query);
  } catch (error) {
    if (error instanceof ShopifyCliError && error.code === 'shopify_throttled') {
      return { data: null, errors: [{ message: 'throttled', extensions: { code: 'shopify_throttled' } }] };
    }
    throw error;
  }
}

// Why a read gave no value: Shopify refusing the scope is `auth-gated`; any other error is `unreadable`.
function reasonFor(errors) {
  const gated = (errors || []).some((error) => {
    const code = error && ((error.extensions && error.extensions.code) || error.code);
    return code === 'ACCESS_DENIED' || /access denied|access scope|required access/i.test(String((error && error.message) || ''));
  });
  return gated ? 'auth-gated' : 'unreadable';
}

function unknownFrom(errors, evidence) {
  return { reason: reasonFor(errors), evidence };
}

// `he` -> language only; `pt-BR` -> language plus the locale tag. The language is handed over as
// Shopify wrote it: the library, not this code, decides whether it is a valid two-letter code.
function splitLocale(locale) {
  const text = typeof locale === 'string' ? locale : '';
  const [language, region] = text.split('-');
  return { language, locale: region ? text : undefined };
}

function localeFields(result) {
  const evidence = 'shopLocales[primary]';
  if (result.errors && result.errors.length) {
    const gated = unknownFrom(result.errors, evidence);
    return { primaryLanguage: gated };
  }
  const locales = result.data && Array.isArray(result.data.shopLocales) ? result.data.shopLocales : null;
  if (!locales) return { primaryLanguage: { reason: 'unreadable', evidence } };
  const primary = locales.find((entry) => entry && entry.primary === true);
  const { language, locale } = splitLocale(primary && primary.locale);
  return { primaryLanguage: primary && language ? { value: language, locale, evidence } : { reason: 'not-exposed', evidence } };
}

function countryField(result) {
  const evidence = 'shop.billingAddress.countryCodeV2';
  if (result.errors && result.errors.length) return unknownFrom(result.errors, evidence);
  const code = at(result.data, ['shop', 'billingAddress', 'countryCodeV2']);
  return code ? { value: code, evidence } : { reason: 'not-exposed', evidence };
}

// Counts orders by the currency of their `shopMoney` amounts -- the shop currency, which is what
// the import writes -- and lists the distinct currencies customers paid in (`presentmentCurrencyCode`).
// Counts only: no per-order record is kept.
function tallyOrderCurrencies(orders) {
  const counts = {};
  const presentment = new Set();
  for (const order of orders) {
    const shop = at(order, ['totalPriceSet', 'shopMoney', 'currencyCode']);
    if (typeof shop !== 'string' || !shop) return null;
    counts[shop] = (counts[shop] || 0) + 1;
    if (typeof order.presentmentCurrencyCode === 'string' && order.presentmentCurrencyCode) presentment.add(order.presentmentCurrencyCode);
  }
  return { counts, presentmentCurrencies: [...presentment].sort() };
}

function shopFields(record) {
  const shop = record && Array.isArray(record.samples) ? record.samples[0] : null;
  if (record && record.errors && record.errors.length) {
    return { currency: unknownFrom(record.errors, 'shop.currencyCode'), timeZone: unknownFrom(record.errors, 'shop.ianaTimezone') };
  }
  return {
    currency: shop && shop.currencyCode ? { value: shop.currencyCode, evidence: 'shop.currencyCode' } : { reason: 'not-exposed', evidence: 'shop.currencyCode' },
    timeZone: shop && shop.ianaTimezone ? { value: shop.ianaTimezone, evidence: 'shop.ianaTimezone' } : { reason: 'not-exposed', evidence: 'shop.ianaTimezone' },
  };
}

// Discovery step: reads the two regional queries, joins them with the recorded `shop` and `orders`
// captures, and writes `<raw dir>/source-locale.json` for promotion.
async function regionalStep(ctx) {
  const locales = await readQuery(ctx.execute, LOCALES_READ.query);
  const country = await readQuery(ctx.execute, COUNTRY_READ.query);
  const file = buildSourceRegional({
    adapter: 'shopify',
    generatedAt: ctx.now(),
    ...shopFields(await readCaptured(ctx.rawDir, 'shop')),
    ...localeFields(locales),
    country: countryField(country),
  });
  await writeAdapterSourceRegional(ctx.projectDir, 'shopify', file);
  const unknown = Object.entries(file).filter(([, row]) => row && row.state === 'unknown').map(([field, row]) => `${field}:${row.reason}`);
  return { file: 'source-locale.json', unknown };
}

module.exports = { regionalStep, tallyOrderCurrencies, reasonFor };
