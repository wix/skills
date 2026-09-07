'use strict';

// Generic pagination + bounded batching for the $SAMPLED_IDS mechanism (spec 0044): a
// profile-declared requestOverride body may reference another route's FULL id
// list via "$SAMPLED_IDS:<route>". That dependency route can hold an unknown, unbounded number
// of records (e.g. an entire product catalog), so this module never assumes the id list fits
// on one page or that the dependent query can carry every id in a single request:
//
//   1. paginate the dependency route to exhaustion, collecting every record's id;
//   2. split that id list into bounded batches;
//   3. issue one dependent-route request per batch, with the placeholder resolved to just
//      that batch's ids;
//   4. normalize each batch's response (caller-supplied, since response shape is a per-profile
//      concern) and merge, deduplicating by a caller-supplied record key;
//   5. stop and report the exact failure on the first page or batch that cannot be read,
//      rather than returning a partial/undercounted result silently.
//
// wp-discovery.js and any rp-import-codegen-generated reader for a requestOverride entity with
// a $SAMPLED_IDS placeholder both drive this same algorithm, so "does this mechanism scale past
// a handful of records" has exactly one implementation to get right.

const { fetchJson, shouldContinueCollectionPaging } = require('./wp-http.js');

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_BATCH_SIZE = 50;

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

// Pages a plain GET collection route to exhaustion, collecting `idField` off every record.
// Returns { ok: true, ids } or { ok: false, ids, failure }. On failure, `ids` holds whatever
// was collected before the failing page, but callers must treat a failed run as unusable —
// never as "the true, if undercounted, id list" — a partial id list understates the dependent
// query rather than correctly reporting it as unknown.
async function collectAllIds({
  baseUrl, headers, route, idField = 'id', pageSize = DEFAULT_PAGE_SIZE,
  query = {}, timeoutMs, progress, fetchJsonFn = fetchJson,
}) {
  const ids = [];
  let page = 1;
  for (;;) {
    const response = await fetchJsonFn(baseUrl, route, {
      headers,
      method: 'GET',
      query: { ...query, page, per_page: pageSize },
      timeoutMs,
      progress,
      progressContext: { step: 'paginate-dependency', entity: route, page },
    });
    if (!response.ok) {
      return { ok: false, ids, failure: { route, page, status: response.status, statusText: response.statusText } };
    }
    const items = Array.isArray(response.json) ? response.json : [];
    for (const item of items) {
      const id = item && item[idField];
      if (id !== undefined && id !== null) ids.push(id);
    }
    if (!shouldContinueCollectionPaging({ responseHeaders: response.headers, page, perPage: pageSize, itemCount: items.length })) {
      return { ok: true, ids };
    }
    page += 1;
  }
}

// Deduplicates `records` by `recordKeyField`, preserving first-seen order. A record missing
// the key field is kept as-is (never dropped) since there is nothing to dedupe it against.
function dedupeByKey(records, recordKeyField) {
  if (!recordKeyField) return records;
  const seen = new Set();
  const deduped = [];
  for (const record of records) {
    const key = record && record[recordKeyField];
    if (key === undefined || key === null) {
      deduped.push(record);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

// Splits `ids` into bounded batches and issues one request per batch against `route`, building
// each batch's body with `buildBody(batchIds)` and normalizing its RAW, unmodified JSON
// response with `normalizeBatch(rawJson, { batchIndex })` — envelope resolution / fragment
// reassembly are left to the caller so this module stays agnostic of any one profile's response
// shape, but that only works if this module hands over the real payload rather than coercing
// it: a batch response wrapped in a responseEnvelope is an OBJECT, not an array, and
// pre-coercing it to `[]` here would silently discard it before normalizeBatch ever saw it.
// `normalizeBatch` must return `{ ok, records }` — `ok: false` means the response did not
// resolve to a usable shape (not merely "resolved to zero records", which is a legitimate `ok:
// true` outcome for a batch whose ids simply have no matches) and is treated exactly like an
// HTTP failure: stop and defer, discarding merged batches from this run, rather than counting
// it as zero. Dedupes across all successful batches. Stops and reports the exact failure on the
// first batch that cannot be read or normalized; already-merged batches from that run must be
// discarded by the caller, not reported as a partial count.
async function queryInBatches({
  baseUrl, headers, route, method, buildBody, ids, batchSize = DEFAULT_BATCH_SIZE,
  normalizeBatch = (records) => (Array.isArray(records) ? { ok: true, records } : { ok: false, records: [] }),
  recordKeyField = 'id', timeoutMs, progress, fetchJsonFn = fetchJson,
}) {
  const batches = chunk(ids, batchSize);
  const merged = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batchIds = batches[batchIndex];
    // `headers` is a real Headers instance (wp-http.js buildHeaders) — spreading it would
    // silently drop every entry including Authorization, since Headers is not a plain object.
    const withBody = new Headers(headers);
    withBody.set('content-type', 'application/json');
    const response = await fetchJsonFn(baseUrl, route, {
      headers: withBody,
      method,
      body: JSON.stringify(buildBody(batchIds)),
      timeoutMs,
      progress,
      progressContext: { step: 'query-dependent-batch', entity: route, batch: batchIndex + 1, total: batches.length },
    });
    if (!response.ok) {
      return {
        ok: false,
        records: merged,
        failure: { route, batchIndex, batchSize: batchIds.length, status: response.status, statusText: response.statusText, reason: 'http-error' },
      };
    }
    const normalized = normalizeBatch(response.json, { batchIndex });
    if (!normalized.ok) {
      return {
        ok: false,
        records: merged,
        failure: { route, batchIndex, batchSize: batchIds.length, status: response.status, statusText: response.statusText, reason: 'invalid-shape' },
      };
    }
    merged.push(...normalized.records);
  }
  return { ok: true, records: dedupeByKey(merged, recordKeyField) };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  DEFAULT_BATCH_SIZE,
  collectAllIds,
  queryInBatches,
  dedupeByKey,
  chunk,
};
