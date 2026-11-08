'use strict';

// The source store's locale facts -- payment currency, time zone, language and locale -- as one
// adapter-neutral file. Every adapter writes the same shape; full adapters promote it and quick/public
// adapters write it directly to `discovery/source-locale.json`, where setup, the import gate and the
// completion report read it.
//
// A value the source does not expose is an explicit `unknown` with a reason -- never a silent guess
// and never a default. The one exception is an adapter's recorded inference (`supplied` by
// `discovery-inference`, with an `inference` basis), which setup confirms through a cutover task. A value that fails validation is `unknown` / `unreadable`, never coerced: the
// Wix settings call stores whatever it is sent (a made-up currency, a made-up time zone, a
// three-letter language), so the only protection is refusing to send one.
//
// Comparison is exact everywhere (plan, read-back, gate); there is no alias canonicalisation.
// Runtimes disagree on legacy time zone names and Wix's preferred spelling is not verified, so a
// legacy alias that differs from the site's name is a difference, never silently equal.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { ADAPTER_RAW_DIRS } = require('./source-coverage.js');

const SCHEMA_VERSION = 1;
const SOURCE_REGIONAL_FILE = 'discovery/source-locale.json';
const ADAPTER_FILE_NAME = 'source-locale.json';
const STATES = Object.freeze(['known', 'unknown', 'supplied']);
const UNKNOWN_REASONS = Object.freeze(['auth-gated', 'not-exposed', 'unreadable', 'ambiguous']);
const SCALAR_FIELDS = Object.freeze(['paymentCurrency', 'timeZone', 'language', 'locale']);
const FIELDS = SCALAR_FIELDS;
// Fields a gate or a setup row is about; the rest are context.
const SETTING_FIELDS = Object.freeze(['currency', 'timeZone', 'language', 'locale']);
const ADAPTERS = Object.freeze(['shopify', 'wordpress', 'csv', 'quick-shopify', 'quick-woocommerce', 'sfcc']);
const TIME_ZONE_MAX = 30; // Update Business Region: timeZone maxLength 30.

class SourceRegionalError extends Error {
  constructor(code, message, errors = []) {
    super(message);
    this.name = 'SourceRegionalError';
    this.code = code;
    this.errors = errors;
  }
}

let currencySet = null;
function knownCurrency(code) {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return false;
  if (!currencySet) currencySet = new Set(Intl.supportedValuesOf('currency'));
  return currencySet.has(code);
}

function knownTimeZone(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > TIME_ZONE_MAX) return false;
  // Wix stores this string verbatim. Require an IANA-shaped, case-preserving name before asking
  // Intl whether the runtime knows it: offsets and lower-case lookalikes must never reach Wix.
  if (name !== 'UTC' && !/^[A-Z][A-Za-z_]*(\/[A-Z][A-Za-z0-9_+-]*)+$/.test(name)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: name }); return true; } catch { return false; }
}

const knownLanguage = (code) => typeof code === 'string' && /^[a-z]{2}$/.test(code);
const knownCountry = (code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code);
const knownLocaleTag = (tag) => typeof tag === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(tag);

// --- comparison (A.3): the only definition of "same" -----------------------------------------

const upper = (v) => (typeof v === 'string' ? v.toUpperCase() : v);
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

function parseLocale(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    return { languageCode: lower(value.languageCode), country: upper(value.country) };
  }
  const match = /^([A-Za-z]{2})[-_]([A-Za-z]{2})$/.exec(String(value));
  return match ? { languageCode: lower(match[1]), country: upper(match[2]) } : null;
}

function sameValue(field, a, b) {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  switch (field) {
    case 'currency': return upper(a) === upper(b);
    case 'timeZone': return a === b;
    case 'language': return lower(a) === lower(b);
    case 'locale': {
      const x = parseLocale(a); const y = parseLocale(b);
      return Boolean(x && y && x.languageCode === y.languageCode && x.country === y.country);
    }
    default: return a === b;
  }
}

// --- field constructors ------------------------------------------------------------------------

const knownField = (value, evidence, extra = {}) => ({ state: 'known', value, evidence, ...extra });
const suppliedField = (value, evidence, extra = {}) => ({ state: 'supplied', value, evidence, suppliedBy: 'intake', ...extra });
const unknownField = (reason, evidence = undefined) => ({ state: 'unknown', reason, ...(evidence ? { evidence } : {}) });

function validValue(field, value) {
  switch (field) {
    case 'paymentCurrency': return knownCurrency(value);
    case 'timeZone': return knownTimeZone(value);
    case 'language': return knownLanguage(value);
    case 'locale': return knownLocaleTag(value);
    case 'country': return knownCountry(value); // adapter input used to construct locale
    default: return false;
  }
}

const validInference = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.basis === 'string');
// An unknown time zone the adapter already recorded as "keep the site's zone, confirm at cutover"
// (no named zone at the source and none inferable). Setup does not ask for it.
const keepsSiteTimeZone = (file) => Boolean(file && file.timeZone && file.timeZone.state === 'unknown'
  && validInference(file.timeZone.inference) && file.timeZone.inference.basis === 'unresolved');

// An adapter hands over `{ value, evidence }` (or `{ reason }` / nothing); this decides what is
// written. Invalid values are `unknown` / `unreadable`, absent ones `unknown` / `not-exposed`.
function normalizeField(field, input) {
  if (input === undefined || input === null) return unknownField('not-exposed');
  if (input.state === 'unknown' || (input.value === undefined && input.reason)) {
    const row = unknownField(UNKNOWN_REASONS.includes(input.reason) ? input.reason : 'not-exposed', input.evidence);
    return validInference(input.inference) ? { ...row, inference: input.inference } : row;
  }
  if (input.value === undefined || input.value === null || input.value === '') return unknownField('not-exposed', input.evidence);
  if (!validValue(field, input.value)) return unknownField('unreadable', input.evidence);
  // A value discovery inferred (e.g. a named zone for a fixed offset) says so: `suppliedBy` names
  // the inference and `inference` carries its basis, which setup turns into a cutover task.
  const extra = {};
  if (input.state === 'supplied' && typeof input.suppliedBy === 'string' && input.suppliedBy) extra.suppliedBy = input.suppliedBy;
  if (validInference(input.inference)) extra.inference = input.inference;
  const evidence = typeof input.evidence === 'string' && input.evidence ? input.evidence : 'adapter';
  return input.state === 'supplied'
    ? suppliedField(input.value, evidence, extra)
    : knownField(input.value, evidence, extra);
}

// What every adapter calls. `adapter` is one of ADAPTERS; every other key is optional.
function buildSourceRegional({ adapter, generatedAt, ...inputs } = {}) {
  if (!ADAPTERS.includes(adapter)) throw new SourceRegionalError('source_regional_invalid', `unknown adapter ${adapter}`);
  const file = { schemaVersion: SCHEMA_VERSION, adapter };
  file.paymentCurrency = normalizeField('paymentCurrency', inputs.paymentCurrency ?? inputs.currency);
  file.timeZone = normalizeField('timeZone', inputs.timeZone);
  const languageInput = inputs.language ?? inputs.primaryLanguage;
  file.language = normalizeField('language', languageInput);
  let localeInput = inputs.locale;
  if (!localeInput && knownLocaleTag(languageInput?.locale) && languageInput.locale.slice(0, 2) === languageInput.value) {
    localeInput = { state: languageInput.state, value: languageInput.locale, evidence: languageInput.evidence };
  }
  if (!localeInput) {
    const country = normalizeField('country', inputs.country);
    if (isSet(file.language) && isSet(country)) {
      localeInput = {
        state: file.language.state === 'supplied' || country.state === 'supplied' ? 'supplied' : 'known',
        value: `${file.language.value}-${country.value}`,
        evidence: [file.language.evidence, country.evidence].filter(Boolean).join('; '),
      };
    } else {
      localeInput = { state: 'unknown', reason: !isSet(file.language) ? file.language.reason : country.reason, evidence: country.evidence || file.language.evidence };
    }
  }
  file.locale = normalizeField('locale', localeInput);
  if (generatedAt) file.generatedAt = generatedAt;
  return file;
}

// --- validation of a written file ---------------------------------------------------------------

function validateFieldShape(field, row, errors) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`${field}: must be an object`); return; }
  if (!STATES.includes(row.state)) { errors.push(`${field}: state must be one of ${STATES.join(', ')}`); return; }
  if (row.state === 'unknown') {
    if (!UNKNOWN_REASONS.includes(row.reason)) errors.push(`${field}: unknown requires reason in ${UNKNOWN_REASONS.join(', ')}`);
    if (Object.hasOwn(row, 'value')) errors.push(`${field}: unknown must not carry a value`);
    return;
  }
  if (!validValue(field, row.value)) errors.push(`${field}: value is not valid`);
  if (typeof row.evidence !== 'string' || !row.evidence) errors.push(`${field}: evidence is required`);
  if (row.state === 'supplied' && (typeof row.suppliedBy !== 'string' || !row.suppliedBy)) errors.push(`${field}: supplied requires suppliedBy`);
}

function validateSourceRegional(file) {
  const errors = [];
  if (!file || typeof file !== 'object' || Array.isArray(file)) return { ok: false, errors: ['file must be an object'] };
  if (file.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!ADAPTERS.includes(file.adapter)) errors.push(`adapter must be one of ${ADAPTERS.join(', ')}`);
  for (const field of FIELDS) validateFieldShape(field, file[field], errors);
  const allowed = new Set(['schemaVersion', 'adapter', ...FIELDS, 'generatedAt']);
  for (const key of Object.keys(file)) if (!allowed.has(key)) errors.push(`${key}: is not part of the source locale record`);
  return { ok: errors.length === 0, errors };
}

// --- what a consumer reads -----------------------------------------------------------------------

const isSet = (row) => Boolean(row && (row.state === 'known' || row.state === 'supplied'));

// The comparable value of one setting, or null when the source does not give one.
// `locale` is derived: the tag when it carries a region, else language + country; null when neither.
function settingValue(file, setting) {
  if (!file) return null;
  switch (setting) {
    case 'currency': return isSet(file.paymentCurrency) ? file.paymentCurrency.value : null;
    case 'timeZone': return isSet(file.timeZone) ? file.timeZone.value : null;
    case 'language': return isSet(file.language) ? file.language.value : null;
    case 'locale': return isSet(file.locale) ? file.locale.value : null;
    default: return null;
  }
}

// Why a setting has no value, for the unknown rows the receipt and the report carry.
function unknownReason(file, setting) {
  const row = setting === 'currency' ? file.paymentCurrency : file[setting];
  return row && row.state === 'unknown' ? row.reason : null;
}

// --- files ---------------------------------------------------------------------------------------

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, file);
}

async function readJsonIfExists(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function assertValid(file, label) {
  const result = validateSourceRegional(file);
  if (!result.ok) throw new SourceRegionalError('source_regional_invalid', `${label} is invalid: ${result.errors.join('; ')}`, result.errors);
}

// A person-supplied value outlives a re-capture: when the fresh capture of a field is unknown and
// the file already on disk holds that field as `supplied`, the supplied row is kept. Anything the
// source now exposes replaces it.
async function keepSupplied(target, file) {
  const prior = await readJsonIfExists(target);
  if (!prior || typeof prior !== 'object') return file;
  const merged = { ...file };
  for (const field of FIELDS) {
    if (file[field] && file[field].state === 'unknown' && prior[field] && prior[field].state === 'supplied' && validValue(field, prior[field].value)) merged[field] = prior[field];
  }
  return merged;
}

// Full adapters write their raw capture here; promotion reads it from here.
async function writeAdapterSourceRegional(projectDir, adapter, file) {
  if (!Object.hasOwn(ADAPTER_RAW_DIRS, adapter)) throw new SourceRegionalError('source_regional_invalid', `adapter ${adapter} has no raw discovery directory`);
  assertValid(file, 'source regional file');
  const target = path.join(projectDir, ADAPTER_RAW_DIRS[adapter], ADAPTER_FILE_NAME);
  await writeJsonAtomic(target, await keepSupplied(target, file));
  return target;
}

// Quick adapters and the SFCC public technique have no promote step; they write the canonical file.
async function writeSourceRegional(projectDir, file) {
  assertValid(file, 'source regional file');
  const target = path.join(projectDir, SOURCE_REGIONAL_FILE);
  await writeJsonAtomic(target, await keepSupplied(target, file));
  return target;
}

async function promoteSourceRegional(projectDir, { adapter }) {
  if (!Object.hasOwn(ADAPTER_RAW_DIRS, adapter)) throw new SourceRegionalError('source_regional_invalid', `adapter ${adapter} cannot promote a regional file`);
  const adapterFile = path.join(projectDir, ADAPTER_RAW_DIRS[adapter], ADAPTER_FILE_NAME);
  const raw = await readJsonIfExists(adapterFile);
  if (raw === undefined) {
    throw new SourceRegionalError('source_regional_missing', `${path.relative(projectDir, adapterFile)} is missing; the ${adapter} adapter must write it (unknown values are explicit) before discovery is promoted`);
  }
  if (raw === null) throw new SourceRegionalError('source_regional_invalid', `${path.relative(projectDir, adapterFile)} is not valid JSON`);
  assertValid(raw, path.relative(projectDir, adapterFile));
  if (raw.adapter !== adapter) throw new SourceRegionalError('source_regional_invalid', `regional file names adapter ${raw.adapter}, not ${adapter}`);
  await writeJsonAtomic(path.join(projectDir, SOURCE_REGIONAL_FILE), raw);
  return { path: path.join(projectDir, SOURCE_REGIONAL_FILE) };
}

// null when the run has no regional file; throws when one exists and is unusable.
async function readSourceRegional(projectDir) {
  const raw = await readJsonIfExists(path.join(projectDir, SOURCE_REGIONAL_FILE));
  if (raw === undefined) return null;
  if (raw === null) throw new SourceRegionalError('source_regional_invalid', `${SOURCE_REGIONAL_FILE} is not valid JSON`);
  assertValid(raw, SOURCE_REGIONAL_FILE);
  return raw;
}

// Synchronous read for file-only checks (the task dependency check): null when absent; throws when unusable.
function readSourceRegionalSync(projectDir) {
  let text;
  try { text = require('node:fs').readFileSync(path.join(projectDir, SOURCE_REGIONAL_FILE), 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let raw;
  try { raw = JSON.parse(text); } catch { throw new SourceRegionalError('source_regional_invalid', `${SOURCE_REGIONAL_FILE} is not valid JSON`); }
  assertValid(raw, SOURCE_REGIONAL_FILE);
  return raw;
}

async function sourceRegionalDigest(projectDir) {
  try {
    return crypto.createHash('sha256').update(await fs.readFile(path.join(projectDir, SOURCE_REGIONAL_FILE))).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

module.exports = {
  SCHEMA_VERSION,
  SOURCE_REGIONAL_FILE,
  ADAPTER_FILE_NAME,
  ADAPTERS,
  FIELDS,
  SETTING_FIELDS,
  STATES,
  UNKNOWN_REASONS,
  SourceRegionalError,
  knownCurrency,
  knownTimeZone,
  knownLanguage,
  knownCountry,
  knownLocaleTag,
  parseLocale,
  sameValue,
  knownField,
  suppliedField,
  unknownField,
  buildSourceRegional,
  validateSourceRegional,
  settingValue,
  unknownReason,
  isSet,
  keepsSiteTimeZone,
  writeAdapterSourceRegional,
  writeSourceRegional,
  promoteSourceRegional,
  readSourceRegional,
  readSourceRegionalSync,
  sourceRegionalDigest,
};
