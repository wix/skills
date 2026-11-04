'use strict';

// Does the site actually hold data for a profiled plugin?
//
// A profile says WHERE a plugin keeps its data. `dataPresence` says how to CHECK that this site
// has any. Without it, an installed plugin with nothing stored and a plugin we cannot read land
// in the same "pending" row and the owner is asked a question we could have answered.
//
// Three answers per check, and the third one is the safety: `present`, `absent`, `unknown`.
// `unknown` (no channel, a failed or truncated read) never becomes "empty". Only a capability
// whose every check is `absent` is reported as having nothing to move.
//
// Profile shape:
//   "dataPresence": { "require": "any" | "all", "checks": [ { "kind": "...", ... } ] }
//   require "any": present when any check is present (several places the plugin may write).
//   require "all": present only when every check is present (the plugin needs all of them to
//                  do anything, e.g. a shipping class AND an enabled shipping method).

const { phpUnserialize } = require('./wp-redirect-sources.js');

const PRESENCE_KINDS = Object.freeze({
  postMeta: ['key'],
  postType: ['type'],
  shippingClassProducts: ['slug'],
  shippingMethod: ['methodId'],
});
const REQUIRE_MODES = new Set(['any', 'all']);
const RESULTS = new Set(['present', 'absent', 'unknown']);
// A distinct-value sweep that is still paging after this many pages is reported as unknown,
// never as absent: a cap reached is a read we did not finish.
const MAX_META_VALUE_PAGES = 25;
const BRIDGE_PAGE_LIMIT = 200;

function checkTarget(check) {
  const fields = PRESENCE_KINDS[check?.kind] || [];
  return fields.map((field) => String(check[field])).join('|');
}

function checkId(plugin, check) {
  return `${plugin}::${check.kind}::${checkTarget(check)}`;
}

// Where a plugin keeps its data. An empty presence check means "no data" only for
// `wordpress`: a plugin may keep its records on the vendor's service, where a WordPress read
// sees nothing. `external` / `both` add a cutover task "Data lives in <service>" listing the
// options the profile knows for getting that data out (`options[]`), or "options unknown:
// research needed"; `unknown` (or no field) keeps the normal path and is never "no need".
const DATA_LOCATIONS = new Set(['wordpress', 'external', 'both', 'unknown']);

function validateDataLocation(dataLocation, label, errors, { required = false } = {}) {
  if (dataLocation === undefined) {
    if (required) errors.push(`${label}: a profile with dataPresence needs dataLocation { where, evidence } (where: ${[...DATA_LOCATIONS].join(', ')})`);
    return;
  }
  if (!dataLocation || typeof dataLocation !== 'object' || Array.isArray(dataLocation)) {
    errors.push(`${label}: dataLocation must be an object { where, service?, options?, evidence }`);
    return;
  }
  const extra = Object.keys(dataLocation).filter((key) => !['where', 'service', 'options', 'evidence'].includes(key));
  if (extra.length) errors.push(`${label}: dataLocation has unknown field(s) ${extra.join(', ')}`);
  if (!DATA_LOCATIONS.has(dataLocation.where)) errors.push(`${label}: dataLocation.where must be one of ${[...DATA_LOCATIONS].join(', ')}`);
  if (dataLocation.where !== 'unknown' && (typeof dataLocation.evidence !== 'string' || !dataLocation.evidence.trim())) {
    errors.push(`${label}: dataLocation.evidence is required (vendor docs or plugin source) unless where is unknown`);
  }
  const needsService = dataLocation.where === 'external' || dataLocation.where === 'both';
  if (needsService && (typeof dataLocation.service !== 'string' || !dataLocation.service.trim())) {
    errors.push(`${label}: dataLocation.service (the vendor service name) is required when where is ${dataLocation.where}`);
  }
  if (!needsService && dataLocation.service !== undefined) errors.push(`${label}: dataLocation.service only applies to external or both`);
  if (dataLocation.options !== undefined) {
    if (!needsService) errors.push(`${label}: dataLocation.options only applies to external or both`);
    else if (!Array.isArray(dataLocation.options) || dataLocation.options.length === 0
      || dataLocation.options.some((option) => typeof option !== 'string' || !option.trim())) {
      errors.push(`${label}: dataLocation.options must be a non-empty array of strings when present`);
    }
  }
}

const OPTIONS_UNKNOWN = 'options unknown: research needed';
function serviceTaskText(dataLocation) {
  const options = Array.isArray(dataLocation.options) ? dataLocation.options.filter((option) => typeof option === 'string' && option.trim()) : [];
  return `Data lives in ${dataLocation.service}: ${options.length ? options.join('; ') : OPTIONS_UNKNOWN}`;
}

function dataLocationOf(plugin) {
  const where = plugin?.dataLocation?.where;
  return DATA_LOCATIONS.has(where) ? where : 'unknown';
}

// Cutover items for plugins whose data lives (also) on a vendor service. Never a "no need":
// the row keeps its status and gets a named cutover task. Deliberately NOT a `blocked[]` entry:
// blockers feed the batched ask at discovery, and this must never stop or question the import.
function externalDataTasks(plugins) {
  const external = (plugins || []).filter((plugin) => ['external', 'both'].includes(dataLocationOf(plugin)));
  if (!external.length) return { externalData: [], cutoverTask: null };
  const externalData = external.map((plugin) => ({
    plugin: plugin.plugin,
    where: plugin.dataLocation.where,
    service: plugin.dataLocation.service,
    knownOptions: Array.isArray(plugin.dataLocation.options) ? [...plugin.dataLocation.options] : [],
  }));
  const services = [...new Set(external.map((plugin) => plugin.dataLocation.service))].join(', ');
  const texts = [...new Set(external.map((plugin) => serviceTaskText(plugin.dataLocation)))];
  return {
    externalData,
    cutoverTask: {
      workType: 'manual-setup',
      task: texts.join(' | '),
      doneWhen: `The ${services} data is with the Import Operator in a form the import can read, or the owner confirms in writing that this data is not needed on Wix.`,
    },
  };
}

function validateDataPresence(dataPresence, label, errors) {
  if (dataPresence === undefined) return;
  if (!dataPresence || typeof dataPresence !== 'object' || Array.isArray(dataPresence)) {
    errors.push(`${label}: dataPresence must be an object { require, checks }`);
    return;
  }
  const extra = Object.keys(dataPresence).filter((key) => !['require', 'checks', 'note'].includes(key));
  if (extra.length) errors.push(`${label}: dataPresence has unknown field(s) ${extra.join(', ')}`);
  if (!REQUIRE_MODES.has(dataPresence.require)) errors.push(`${label}: dataPresence.require must be any or all`);
  if (!Array.isArray(dataPresence.checks) || dataPresence.checks.length === 0) {
    errors.push(`${label}: dataPresence.checks must be a non-empty array`);
    return;
  }
  dataPresence.checks.forEach((check, index) => {
    const at = `${label}: dataPresence.checks[${index}]`;
    if (!check || typeof check !== 'object' || !Object.hasOwn(PRESENCE_KINDS, check.kind)) {
      errors.push(`${at}: kind must be one of ${Object.keys(PRESENCE_KINDS).join(', ')}`);
      return;
    }
    for (const field of PRESENCE_KINDS[check.kind]) {
      if (typeof check[field] !== 'string' || !check[field].trim()) errors.push(`${at}: ${check.kind} needs a non-empty ${field}`);
    }
    if (check.kind === 'postType' && check.statuses !== undefined
      && (!Array.isArray(check.statuses) || check.statuses.length === 0 || check.statuses.some((status) => typeof status !== 'string' || !status))) {
      errors.push(`${at}: postType statuses must be a non-empty array of strings when present`);
    }
    const allowed = new Set(['kind', 'note', 'statuses', ...PRESENCE_KINDS[check.kind]]);
    const unknownFields = Object.keys(check).filter((key) => !allowed.has(key));
    if (unknownFields.length) errors.push(`${at}: unknown field(s) ${unknownFields.join(', ')}`);
    if (check.kind !== 'postType' && check.statuses !== undefined) errors.push(`${at}: statuses only applies to postType`);
  });
}

// A meta value counts as empty when, once decoded, it holds nothing but empty strings, nulls
// or empty containers. `a:1:{i:0;s:0:"";}` (an array of one empty URL) is empty; that exact
// value sat on 382 products of one store and is the reason this exists.
function isEmptyDecoded(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(isEmptyDecoded);
  if (typeof value === 'object') return Object.values(value).every(isEmptyDecoded);
  return false; // numbers and booleans are values someone set
}

function isEmptyMetaValue(raw) {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== 'string') return isEmptyDecoded(raw);
  const text = raw.trim();
  if (text === '') return true;
  if (/^(a|s|i|d|b|N):/.test(text) || text === 'N;') {
    try { return isEmptyDecoded(phpUnserialize(text)); } catch { return false; }
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    try { return isEmptyDecoded(JSON.parse(text)); } catch { return false; }
  }
  return false;
}

function observation(plugin, check, result, extra = {}) {
  return { id: checkId(plugin, check), plugin, kind: check.kind, target: checkTarget(check), result, ...extra };
}

async function pagedBridgeRows(bridgeQuery, structureRequest, maxPages) {
  const rows = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await bridgeQuery(structureRequest, cursor, BRIDGE_PAGE_LIMIT);
    rows.push(...(response.rows || []));
    cursor = response.pagingMetadata?.cursors?.next || null;
    if (!cursor) return { rows, complete: true };
  }
  return { rows, complete: false };
}

async function observePostMeta(plugin, check, { bridgeQuery }) {
  if (!bridgeQuery) return observation(plugin, check, 'unknown', { reason: 'bridge-unavailable' });
  // Key-scoped distinct-value read: one row per distinct value with its count, so a key set
  // on thousands of products to the same empty default costs one page, not thousands of rows.
  const request = {
    table: 'postmeta',
    select: [{ column: 'meta_value' }, { column: 'meta_value', aggregate: 'count', as: 'n' }],
    where: [{ column: 'meta_key', op: 'in', value: [check.key] }],
    groupBy: ['meta_value'],
    orderBy: [{ column: 'meta_value', direction: 'asc' }],
  };
  try {
    const { rows, complete } = await pagedBridgeRows(bridgeQuery, request, MAX_META_VALUE_PAGES);
    let rowCount = 0;
    let nonEmpty = 0;
    for (const row of rows) {
      const n = Number(row.n);
      const count = Number.isFinite(n) ? n : 1;
      rowCount += count;
      if (!isEmptyMetaValue(row.meta_value)) nonEmpty += count;
    }
    if (nonEmpty > 0) return observation(plugin, check, 'present', { count: nonEmpty, rows: rowCount });
    if (!complete) return observation(plugin, check, 'unknown', { reason: 'read-truncated', rows: rowCount });
    return observation(plugin, check, 'absent', { count: 0, rows: rowCount });
  } catch (error) {
    return observation(plugin, check, 'unknown', { reason: `bridge-read-failed: ${error.message}` });
  }
}

async function observePostType(plugin, check, { bridgeQuery }) {
  if (!bridgeQuery) return observation(plugin, check, 'unknown', { reason: 'bridge-unavailable' });
  const where = [{ column: 'post_type', op: 'eq', value: check.type }];
  if (check.statuses) where.push({ column: 'post_status', op: 'in', value: check.statuses });
  const request = {
    table: 'posts',
    select: [{ column: 'post_type' }, { column: 'post_type', aggregate: 'count', as: 'n' }],
    where,
    groupBy: ['post_type'],
    orderBy: [{ column: 'post_type', direction: 'asc' }],
  };
  try {
    const { rows, complete } = await pagedBridgeRows(bridgeQuery, request, 2);
    const count = rows.reduce((total, row) => total + (Number(row.n) || 0), 0);
    if (count > 0) return observation(plugin, check, 'present', { count });
    if (!complete) return observation(plugin, check, 'unknown', { reason: 'read-truncated' });
    return observation(plugin, check, 'absent', { count: 0 });
  } catch (error) {
    return observation(plugin, check, 'unknown', { reason: `bridge-read-failed: ${error.message}` });
  }
}

async function observeShippingClassProducts(plugin, check, { fetchRest }) {
  if (!fetchRest) return observation(plugin, check, 'unknown', { reason: 'rest-unavailable' });
  try {
    const response = await fetchRest('/wc/v3/products/shipping_classes', { slug: check.slug, per_page: 100 });
    if (!response?.ok || !Array.isArray(response.json)) {
      return observation(plugin, check, 'unknown', { reason: `rest-read-failed: HTTP ${response?.status ?? 'n/a'}` });
    }
    const match = response.json.find((term) => term && term.slug === check.slug);
    if (!match) return observation(plugin, check, 'absent', { count: 0, reason: 'class-not-defined' });
    const count = Number(match.count);
    if (!Number.isFinite(count)) return observation(plugin, check, 'unknown', { reason: 'class-count-missing' });
    return observation(plugin, check, count > 0 ? 'present' : 'absent', { count });
  } catch (error) {
    return observation(plugin, check, 'unknown', { reason: `rest-read-failed: ${error.message}` });
  }
}

async function observeShippingMethod(plugin, check, { fetchRest }) {
  if (!fetchRest) return observation(plugin, check, 'unknown', { reason: 'rest-unavailable' });
  try {
    const zones = await fetchRest('/wc/v3/shipping/zones', {});
    if (!zones?.ok || !Array.isArray(zones.json)) {
      return observation(plugin, check, 'unknown', { reason: `rest-read-failed: HTTP ${zones?.status ?? 'n/a'}` });
    }
    const ids = Array.from(new Set([0, ...zones.json.map((zone) => zone?.id).filter((id) => Number.isInteger(id))]));
    let enabled = 0;
    let disabled = 0;
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const methods = await fetchRest(`/wc/v3/shipping/zones/${id}/methods`, {});
      if (!methods?.ok || !Array.isArray(methods.json)) {
        return observation(plugin, check, 'unknown', { reason: `rest-read-failed: zone ${id} HTTP ${methods?.status ?? 'n/a'}` });
      }
      for (const method of methods.json) {
        if (method?.method_id !== check.methodId) continue;
        if (method.enabled === true) enabled += 1; else disabled += 1;
      }
    }
    return observation(plugin, check, enabled > 0 ? 'present' : 'absent', { count: enabled, disabled });
  } catch (error) {
    return observation(plugin, check, 'unknown', { reason: `rest-read-failed: ${error.message}` });
  }
}

const OBSERVERS = {
  postMeta: observePostMeta,
  postType: observePostType,
  shippingClassProducts: observeShippingClassProducts,
  shippingMethod: observeShippingMethod,
};

// The profiles that need a check on this run: detected AND declaring dataPresence.
function presenceTargets(profiles, detection) {
  const detected = new Set((detection?.detected || []).map((plugin) => plugin.plugin));
  return (profiles || []).filter((profile) => detected.has(profile.plugin) && profile.dataPresence);
}

// Reads the site. `fetchRest(path, query)` -> { ok, status, json }; `bridgeQuery(request,
// cursor, limit)` -> { rows, pagingMetadata } (wix-wp-plugin-v2 queryStructure). Either may be
// null; checks that need it come back unknown.
async function collectPresenceObservations({ profiles, detection, fetchRest = null, bridgeQuery = null }) {
  const observations = [];
  for (const profile of presenceTargets(profiles, detection)) {
    for (const check of profile.dataPresence.checks) {
      // eslint-disable-next-line no-await-in-loop
      observations.push(await OBSERVERS[check.kind](profile.plugin, check, { fetchRest, bridgeQuery }));
    }
  }
  return observations;
}

function combine(results, require) {
  if (require === 'all') {
    if (results.some((result) => result === 'absent')) return 'absent';
    if (results.every((result) => result === 'present')) return 'present';
    return 'unknown';
  }
  if (results.some((result) => result === 'present')) return 'present';
  if (results.every((result) => result === 'absent')) return 'absent';
  return 'unknown';
}

function describeCheck(entry) {
  const counted = Number.isFinite(entry.count) ? entry.count : null;
  switch (entry.kind) {
    case 'postMeta':
      return entry.result === 'unknown'
        ? `product/post field ${entry.target}: could not be read`
        : `${counted} record(s) with a value in ${entry.target}${Number.isFinite(entry.rows) ? ` (of ${entry.rows} carrying the field)` : ''}`;
    case 'postType':
      return entry.result === 'unknown' ? `${entry.target} records: could not be counted` : `${counted} ${entry.target} record(s)`;
    case 'shippingClassProducts':
      return entry.result === 'unknown' ? `shipping class ${entry.target}: could not be read` : `${counted} product(s) in shipping class ${entry.target}`;
    case 'shippingMethod':
      return entry.result === 'unknown'
        ? `shipping method ${entry.target}: could not be read`
        : `${counted} enabled ${entry.target} shipping method(s)${entry.disabled ? `, ${entry.disabled} disabled` : ''}`;
    default:
      return `${entry.kind} ${entry.target}: ${entry.result}`;
  }
}

// Per detected plugin: { result, active, require, checks[] }. A profile that declares
// dataPresence but has no stored observation for a check gets `unknown` for it.
function presenceByPlugin({ profiles, detection, observations = [] }) {
  const byId = new Map((observations || []).map((entry) => [entry.id, entry]));
  const activeByPlugin = new Map((detection?.detected || []).map((plugin) => [plugin.plugin, plugin.active]));
  const out = new Map();
  for (const profile of presenceTargets(profiles, detection)) {
    const checks = profile.dataPresence.checks.map((check) => {
      const stored = byId.get(checkId(profile.plugin, check));
      const entry = stored && RESULTS.has(stored.result)
        ? stored
        : observation(profile.plugin, check, 'unknown', { reason: 'not-observed' });
      return { ...entry, summary: describeCheck(entry) };
    });
    out.set(profile.plugin, {
      plugin: profile.plugin,
      displayName: profile.displayName || profile.plugin,
      active: activeByPlugin.get(profile.plugin),
      require: profile.dataPresence.require,
      result: combine(checks.map((check) => check.result), profile.dataPresence.require),
      checks,
    });
  }
  return out;
}

// The verdict for one capability, over every detected plugin that declares it. Null means
// "no presence verdict": the capability takes its normal profile path.
// Both outcomes need every plugin's dataLocation to be `wordpress`.
//   no-data-found     every plugin's checks came back absent.
//   inactive-leftover nothing unknown, every plugin inactive, data present (product
//                     decision: don't move it, show it as leftover).
function capabilityPresence(plugins, presence) {
  if (!presence || presence.size === 0 || !plugins?.length) return null;
  const summaries = plugins.map((plugin) => presence.get(plugin.plugin));
  if (summaries.some((summary) => !summary)) return null;
  const checks = summaries.flatMap((summary) => summary.checks.map((check) => ({
    plugin: check.plugin, kind: check.kind, target: check.target, result: check.result,
    ...(Number.isFinite(check.count) ? { count: check.count } : {}),
    ...(check.reason ? { reason: check.reason } : {}),
    summary: check.summary,
  })));
  // An empty WordPress read says nothing about data kept elsewhere: only plugins that keep
  // their data in WordPress may be ruled "no data" or "leftover".
  if (plugins.some((plugin) => dataLocationOf(plugin) !== 'wordpress')) {
    return { outcome: null, checks, heldBack: 'data-location-not-wordpress' };
  }
  const evidence = summaries.map((summary) => summary.checks.map((check) => check.summary).join('; ')).join(' | ');
  const names = summaries.map((summary) => summary.displayName).join(', ');
  if (summaries.every((summary) => summary.result === 'absent')) {
    return {
      outcome: 'no-data-found',
      checks,
      rationale: `${names} is installed but holds no data on this site. Checked: ${evidence}.`,
    };
  }
  if (summaries.every((summary) => summary.result !== 'unknown')
    && summaries.every((summary) => summary.active === false)) {
    return {
      outcome: 'inactive-leftover',
      checks,
      rationale: `${names} is inactive — leftover data, not used by the store, so it is not moved. Found: ${evidence}.`,
    };
  }
  return { outcome: null, checks };
}

module.exports = {
  PRESENCE_KINDS,
  DATA_LOCATIONS,
  MAX_META_VALUE_PAGES,
  checkId,
  validateDataPresence,
  validateDataLocation,
  dataLocationOf,
  externalDataTasks,
  OPTIONS_UNKNOWN,
  isEmptyMetaValue,
  collectPresenceObservations,
  presenceByPlugin,
  capabilityPresence,
  combine,
};
