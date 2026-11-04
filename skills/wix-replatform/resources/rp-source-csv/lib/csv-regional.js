'use strict';

// The CSV adapter's regional facts. A CSV carries no store settings, so the person supplies the
// currency, time zone, primary language and country at intake; an input they did not give is an
// explicit unknown, never a guess. A per-row currency column is evidence only: it feeds
// Currency-column counts remain CSV discovery evidence and never become the locale value.

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  buildSourceRegional,
  knownCurrency,
  validateSourceRegional,
  writeAdapterSourceRegional,
  ADAPTER_FILE_NAME,
} = require('../../../lib/source-regional.js');
const { ADAPTER_RAW_DIRS } = require('../../../lib/source-coverage.js');
const { normalizeHeaderName } = require('./csv-parse.js');

const INTAKE_EVIDENCE = 'intake';
// Normalized header names that hold a per-row currency code.
const CURRENCY_COLUMNS = new Set([
  'currency', 'currencycode', 'ordercurrency', 'pricecurrency', 'presentmentcurrency', 'currencyiso', 'iso4217',
]);

// Indexes of the header's currency columns (normalized, exact match).
function currencyColumnIndexes(header) {
  const indexes = [];
  (header || []).forEach((name, index) => {
    if (CURRENCY_COLUMNS.has(normalizeHeaderName(name))) indexes.push(index);
  });
  return indexes;
}

// Streaming counter: `add(values)` per row, `counts()` at the end. `null` when the file has no
// currency column; a blank or non-code cell is not counted (counts hold valid ISO codes only).
function createCurrencyCounter(header) {
  const indexes = currencyColumnIndexes(header);
  const counts = {};
  return {
    hasColumn: indexes.length > 0,
    add(values) {
      for (const index of indexes) {
        const code = String(values[index] === undefined ? '' : values[index]).trim().toUpperCase();
        if (knownCurrency(code)) counts[code] = (counts[code] || 0) + 1;
      }
    },
    counts() { return indexes.length > 0 ? { ...counts } : null; },
  };
}

// Sum the per-file counts; `null` when no file had a currency column.
function mergeCurrencyCounts(list) {
  let merged = null;
  for (const counts of list) {
    if (!counts) continue;
    merged = merged || {};
    for (const [code, n] of Object.entries(counts)) merged[code] = (merged[code] || 0) + n;
  }
  return merged;
}

// A person-typed value, trimmed and case-folded to the shape the validators expect. Anything that
// still fails validation stays an `unreadable` unknown; nothing is repaired beyond case and space.
function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function supplied(value, evidence = INTAKE_EVIDENCE, extra = {}) {
  return value === '' ? undefined : { state: 'supplied', value, evidence, ...extra };
}

// `supplied`: { currency, timeZone, language, country } -- all optional strings (a `he-IL` language
// supplies the locale tag too). Currency-column counts stay in CSV discovery evidence.
function buildCsvSourceRegional({ supplied: input = {}, generatedAt } = {}) {
  const currency = clean(input.currency).toUpperCase();
  const timeZone = clean(input.timeZone);
  const country = clean(input.country).toUpperCase();
  const languageInput = clean(input.language);
  const tag = /^([A-Za-z]{2})[-_]([A-Za-z]{2})$/.exec(languageInput);
  const language = tag ? tag[1].toLowerCase() : languageInput.toLowerCase();
  const locale = tag ? `${tag[1].toLowerCase()}-${tag[2].toUpperCase()}` : undefined;
  return buildSourceRegional({
    adapter: 'csv',
    generatedAt,
    currency: supplied(currency),
    timeZone: supplied(timeZone),
    primaryLanguage: supplied(language, INTAKE_EVIDENCE, locale ? { locale } : {}),
    country: supplied(country),
  });
}

// Writes `<outDir>/source-locale.json`. The library writer takes the project directory, so it is
// used when the capture directory is the adapter's raw directory; any other directory gets the same
// validated file written directly.
async function writeCsvSourceRegional(outDir, file) {
  const rawDir = path.resolve(outDir);
  const suffix = path.sep + path.normalize(ADAPTER_RAW_DIRS.csv);
  if (rawDir.endsWith(suffix)) {
    return writeAdapterSourceRegional(rawDir.slice(0, rawDir.length - suffix.length), 'csv', file);
  }
  const result = validateSourceRegional(file);
  if (!result.ok) throw new Error(`source regional file is invalid: ${result.errors.join('; ')}`);
  await fs.mkdir(rawDir, { recursive: true });
  const target = path.join(rawDir, ADAPTER_FILE_NAME);
  await fs.writeFile(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  return target;
}

module.exports = {
  CURRENCY_COLUMNS,
  currencyColumnIndexes,
  createCurrencyCounter,
  mergeCurrencyCounts,
  buildCsvSourceRegional,
  writeCsvSourceRegional,
};
