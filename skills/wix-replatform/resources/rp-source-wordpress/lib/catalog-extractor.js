'use strict';

// The fixed WooCommerce/WordPress extractor. It runs reader-catalog entries (plus a run's own
// extra entries for plugin and custom routes) through wp-http.js and writes data/source-extract
// in the same format generated readers wrote: <entity>.ndjson, child files (product variations),
// one shared manifest.json row per entity, and an extract-ledger record per file.
//
// Fixed here, the same every run: auth choice and fallback, paging, dedupe by key, child reads,
// enrichment, atomic files, manifest, ledger, the derived guest-buyer file, and the plan filter
// allow-list. The AI supplies only what the catalog lacks: an extra entry, and, when a route is
// not a plain collection, a small reader module (src/extract/readers/<id>.js exporting read(ctx)).
// The operator supplies filters in the plan: entities[].sourceFilter.query, limited per entry to
// its filterParams.
//
// Requires stay relative, so the same file works from the toolkit and from a vendored copy
// (src/resources/rp-source-wordpress/lib beside src/lib and src/resources/rp-target-wix/lib).

const fs = require('node:fs');
const path = require('node:path');
const http = require('./wp-http.js');
const { loadCatalog, validateCatalog, resolveEntry, orderEntries } = require('./reader-catalog.js');
const ndjson = require('../../rp-target-wix/lib/ndjson.js');

const OUT_DIR = 'data/source-extract';
const EXTRA_CATALOG = 'src/extract/reader-catalog.extra.json';
const READERS_DIR = 'src/extract/readers';
const DEFAULT_SAMPLE_SIZE = 5;
const NOOP_PROGRESS = { start() {}, progress() {}, warn() {}, error() {}, complete() {}, withHeartbeat: (_ctx, fn) => fn() };

function codedError(code, message, extra = {}) {
  return Object.assign(new Error(`${code}: ${message}`), { code, ...extra });
}

function readJsonIfExists(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function rel(projectDir, file) {
  return path.relative(projectDir, file).split(path.sep).join('/');
}

// Catalog + the run's extra entries. An extra entry may not reuse a catalog id: changing a
// catalog reader is a toolkit change (reviewed PR), not a per-run patch.
function mergeCatalog(catalog, extra) {
  if (!extra) return catalog;
  if (extra.schemaVersion !== 1 || !Array.isArray(extra.entities)) throw codedError('reader_catalog_extra_invalid', `${EXTRA_CATALOG} needs schemaVersion 1 and entities[]`);
  const known = new Set(catalog.entities.flatMap((e) => [e.id, ...(e.children || []).map((c) => c.id)]));
  for (const entry of extra.entities) {
    if (known.has(entry.id)) throw codedError('reader_catalog_extra_overrides', `extra entry ${entry.id} reuses a catalog id`);
  }
  return { ...catalog, entities: [...catalog.entities, ...extra.entities] };
}

// The operator's filter for one entry, from the plan. Only the entry's filterParams may be set.
function planFilter(plan, entry) {
  const rows = Array.isArray(plan?.entities) ? plan.entities : Object.entries(plan?.entities || {}).map(([k, v]) => ({ sourceEntityRef: k, ...v }));
  const row = rows.find((r) => (r.sourceEntityRef || r.sourceEntity) === entry.id);
  const query = row?.sourceFilter?.query;
  if (query === undefined || query === null) return {};
  if (typeof query !== 'object' || Array.isArray(query)) throw codedError('source_filter_invalid', `${entry.id}: sourceFilter.query must be an object`);
  const allowed = new Set(entry.filterParams || []);
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key)) throw codedError('source_filter_param_not_allowed', `${entry.id}: ${key} is not one of ${[...allowed].join(', ') || '(none)'}`);
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw codedError('source_filter_invalid', `${entry.id}: ${key} must be a string, number or boolean`);
  }
  return { ...query };
}

// The plan's value for one entity choice (entities[].choices[] with that name), or undefined.
function planChoice(plan, entityId, name) {
  const rows = Array.isArray(plan?.entities) ? plan.entities : Object.entries(plan?.entities || {}).map(([k, v]) => ({ sourceEntityRef: k, ...v }));
  const row = rows.find((r) => (r.sourceEntityRef || r.sourceEntity) === entityId);
  const choice = (Array.isArray(row?.choices) ? row.choices : []).find((c) => c && c.name === name);
  return choice && Object.hasOwn(choice, 'value') ? choice.value : undefined;
}

function readRows(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}

function fillRoute(route, record) {
  return route.replace(/\{id\}/g, encodeURIComponent(String(record.id)));
}

function matchesWhen(when, record) {
  return !when || record?.[when.field] === when.equals;
}

// Derived entities: built locally from another entity's extract, never read from the source.
const DERIVERS = {
  'guest-buyer-contacts': ({ projectDir, outDir, sourceSystem }) => {
    const { guestBuyerContactRows } = require('../../rp-target-wix/lib/order-buyer.js');
    const file = path.join(outDir, 'order.ndjson');
    const orders = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((line) => { const order = JSON.parse(line); return { ...order, sourceStableKey: `order:${order.id}` }; });
    const { rows, held } = guestBuyerContactRows(orders, { sourceSystem });
    return { rows, extra: { heldOrders: held.length } };
  },
  // Design v2 K2 (H37): one contact per reviewer email that no customer or guest buyer has, so every
  // review has an author contact. Rows from review-import.js guestReviewContactRows; `id` is the
  // row's sourceKey after `replatform:guest-review:` (the contact task's keyField; that prefix is the
  // binding's keyPrefix, so the crosswalk key is the contact's externalId). A review with no email gives no row (the
  // review import holds it with a cutover item).
  'guest-review-contacts': ({ outDir, sourceSystem }) => {
    const { guestReviewContactRows } = require('../../rp-target-wix/lib/review-import.js');
    const { guestBuyerContactRows } = require('../../rp-target-wix/lib/order-buyer.js');
    const read = (name) => { const file = path.join(outDir, `${name}.ndjson`); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : []; };
    const norm = (value) => String(value || '').trim().toLowerCase();
    const known = new Set([...read('customer').map((c) => norm(c.email || c.billing?.email)),
      ...guestBuyerContactRows(read('order'), { sourceSystem }).rows.map((r) => norm(r.contact?.email?.email))].filter(Boolean));
    const reviews = read('product-review').filter((r) => norm(r.reviewer_email) && !known.has(norm(r.reviewer_email)))
      .map((r) => ({ sourceStableKey: `product-review:${r.id}`, reviewerEmail: norm(r.reviewer_email), reviewerName: r.reviewer }));
    const { rows } = guestReviewContactRows(reviews, { sourceSystem });
    return { rows: rows.map((row) => ({ id: row.sourceKey.replace(/^replatform:guest-review:/, ''), ...row })), extra: {} };
  },
};

function rowStatus(row) {
  return row.unread ? 'unread' : row.absent ? 'absent' : 'extracted';
}

function createCatalogExtractor({
  projectDir,
  env = {},
  catalog = loadCatalog(),
  extraCatalog,
  plan,
  progress = null,
  ledger = require('../../../lib/extract-ledger.js'),
  sampleSize = DEFAULT_SAMPLE_SIZE,
  rateLimitRpm = 120,
  maxRetries = 5,
  timeoutMs = 60000,
  sourceSystem = 'woocommerce',
  now = () => new Date(),
} = {}) {
  if (!projectDir) throw codedError('extract_project_required', 'projectDir is required');
  projectDir = path.resolve(projectDir);
  const extra = extraCatalog !== undefined ? extraCatalog : readJsonIfExists(path.join(projectDir, EXTRA_CATALOG));
  const merged = mergeCatalog(catalog, extra);
  const errors = validateCatalog(merged);
  if (errors.length) throw codedError('reader_catalog_invalid', errors.join('; '), { errors });
  const thePlan = plan !== undefined ? plan : readJsonIfExists(path.join(projectDir, 'mapping', 'mapping-plan.json'));
  const entries = orderEntries(merged.entities).map((e) => resolveEntry(merged, e));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const parentOfChild = new Map(entries.flatMap((e) => (e.children || []).map((c) => [c.id, e.id])));
  const log = progress || NOOP_PROGRESS;
  const outDir = path.join(projectDir, OUT_DIR);
  const failures = [];
  let source = null;

  function connect() {
    if (source) return source;
    const missing = ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD'].filter((k) => !env[k]);
    if (missing.length) throw codedError('source_config_missing', `missing source config keys: ${missing.join(', ')}`);
    http.configureRateLimit({ rateLimitRpm, maxRetries });
    const wordpress = http.buildHeaders({ username: env.WP_USERNAME, applicationPassword: env.WP_APPLICATION_PASSWORD });
    const store = env.WC_CONSUMER_KEY && env.WC_CONSUMER_SECRET
      ? http.buildHeaders({ username: env.WC_CONSUMER_KEY, applicationPassword: env.WC_CONSUMER_SECRET })
      : wordpress;
    source = { baseUrl: env.WP_BASE_URL, headers: { wordpress, store } };
    return source;
  }

  // One GET. A store-key 401/403 retries once with the application password (narrowly scoped keys).
  async function get(route, query, auth = 'store') {
    const s = connect();
    const call = (headers) => http.fetchJson(s.baseUrl, route, { headers, query, progress, timeoutMs });
    let res = await call(s.headers[auth]);
    if (!res.ok && [401, 403].includes(res.status) && auth === 'store' && s.headers.store !== s.headers.wordpress) res = await call(s.headers.wordpress);
    if (!res.ok) throw codedError('source_read_failed', `GET ${route} failed: HTTP ${res.status} ${res.statusText}`, { status: res.status, body: res.json });
    return res;
  }

  // Pages to exhaustion: stop on X-WP-TotalPages, else on the first short page.
  async function* pages(route, query, { paging = { kind: 'pages', perPage: 100 }, auth = 'store', limit = null } = {}) {
    const perPage = Math.min(paging.perPage || 100, limit || Infinity);
    for (let page = 1; ; page += 1) {
      const q = paging.kind === 'none' ? { ...query } : { ...query, page, per_page: perPage };
      const res = await get(route, q, auth);
      const items = Array.isArray(res.json) ? res.json : (res.json && typeof res.json === 'object' && paging.kind === 'none' ? [res.json] : null);
      if (!items) throw codedError('source_read_failed', `GET ${route} returned a non-array body`);
      const total = page === 1 ? http.parseTotalHeader(res.headers, 'x-wp-total') : null;
      const totalPages = http.parseTotalPagesHeader(res.headers);
      yield { items, page, total };
      if (paging.kind === 'none') return;
      if (totalPages !== null ? page >= totalPages : items.length < perPage) return;
    }
  }

  function customReader(entry) {
    const file = path.resolve(projectDir, entry.reader);
    if (!file.startsWith(path.join(projectDir, READERS_DIR) + path.sep)) throw codedError('reader_outside_project', `${entry.id}: reader must live in ${READERS_DIR}/`);
    const mod = require(file);
    if (typeof mod.read !== 'function') throw codedError('reader_invalid', `${entry.id}: reader must export read(ctx)`);
    return mod.read;
  }

  async function* records(entry, query, sample) {
    if (entry.reader) {
      const read = customReader(entry);
      const result = await read({ entry, query, sample, sampleSize, get: (route, q, auth = entry.auth) => get(route, q, auth), pages: (route, q, opts = {}) => pages(route, q, { auth: entry.auth, ...opts }) });
      if (result && typeof result[Symbol.asyncIterator] === 'function') { for await (const rec of result) yield { items: [rec], page: 1, total: null }; return; }
      if (!Array.isArray(result)) throw codedError('reader_invalid', `${entry.id}: read(ctx) must return an array or async iterable`);
      yield { items: result, page: 1, total: null };
      return;
    }
    yield* pages(entry.route, query, { paging: entry.paging, auth: entry.auth, limit: sample ? sampleSize : null });
  }

  function loadManifest() {
    return readJsonIfExists(path.join(outDir, 'manifest.json')) || { schemaVersion: 1, entities: [] };
  }

  function writeManifestRow(row) {
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = loadManifest();
    const order = entries.map((e) => e.id);
    manifest.entities = [...manifest.entities.filter((e) => e.entity !== row.entity), row]
      .sort((a, b) => (order.indexOf(a.entity) + 1 || Infinity) - (order.indexOf(b.entity) + 1 || Infinity));
    manifest.updatedAt = now().toISOString();
    const file = path.join(outDir, 'manifest.json');
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(`${file}.tmp`, file);
  }

  // Per-entity manifests (<entity>.manifest.json) that readiness and dependency proofs read
  // (a complete extract may differ from snapshotTotal: a recorded gap, lib/extract-count.js).
  function writeEntityManifests(row) {
    const files = [{ entity: row.entity, file: row.file, rowsWritten: row.count, snapshotTotal: row.sourceTotal !== null ? row.sourceTotal : row.count },
      ...row.children.map((c) => ({ entity: c.entity, file: c.file, rowsWritten: c.count, snapshotTotal: c.count }))];
    for (const f of files) {
      const target = path.join(projectDir, f.file.replace(/\.ndjson$/, '.manifest.json'));
      const body = { schemaVersion: 1, entity: f.entity, file: f.file, rowsWritten: f.rowsWritten, snapshotTotal: f.snapshotTotal, complete: row.complete, ...(row.filter ? { filter: row.filter } : {}), extractedAt: row.extractedAt };
      fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(body, null, 2)}\n`);
      fs.renameSync(`${target}.tmp`, target);
    }
  }

  async function recordLedger(row) {
    for (const t of [{ entity: row.entity, file: row.file }, ...row.children.map((c) => ({ entity: c.entity, file: c.file }))]) {
      await ledger.recordExtract(projectDir, { entity: t.entity, extractPath: t.file, keyField: byId.get(row.entity)?.keyField || 'id', recordedBy: 'catalog-extractor', now: now() });
    }
  }

  async function extractRest(entry, { sample }) {
    const dir = sample ? path.join(outDir, 'sample') : outDir;
    fs.mkdirSync(dir, { recursive: true });
    const filter = planFilter(thePlan, entry);
    const query = { ...entry.query, ...filter };
    const final = path.join(dir, `${entry.id}.ndjson`);
    const part = `${final}.part`;
    fs.rmSync(part, { force: true });
    const out = ndjson.createAppender(part);
    const kids = entry.children.map((c) => ({ c, final: path.join(dir, `${c.id}.ndjson`), part: path.join(dir, `${c.id}.ndjson.part`), n: 0 }));
    for (const k of kids) { fs.rmSync(k.part, { force: true }); k.out = ndjson.createAppender(k.part); }
    const seen = new Set();
    let sourceTotal = null;
    let absent = false;
    try {
      for await (const { items, page, total } of records(entry, query, sample)) {
        if (page === 1 && total !== null) sourceTotal = total;
        for (const rec of items) {
          const key = rec && rec[entry.keyField] !== undefined ? String(rec[entry.keyField]) : null;
          if (key !== null) { if (seen.has(key)) continue; seen.add(key); }
          for (const e of entry.enrich) rec[e.field] = (await get(fillRoute(e.route, rec), {}, entry.auth)).json;
          out.append(rec);
          for (const k of kids) {
            if (!matchesWhen(k.c.when, rec)) continue;
            for await (const sub of pages(fillRoute(k.c.route, rec), k.c.query || {}, { paging: k.c.paging || entry.paging, auth: entry.auth })) {
              for (const child of sub.items) { k.out.append(child); k.n += 1; }
            }
          }
          if (sample && out.written() >= sampleSize) break;
        }
        log.progress(`extracted page ${page} of ${entry.id}`, { phase: 'extract', currentEntity: entry.id, count: out.written() });
        if (sample && out.written() >= sampleSize) break;
      }
    } catch (error) {
      // An optional route that does not exist on this store (plugin not installed) has no records.
      if (!(entry.optional && error.status === 404 && out.written() === 0)) {
        for (const p of [part, ...kids.map((k) => k.part)]) fs.rmSync(p, { force: true });
        throw error;
      }
      absent = true;
    }
    // With a filter, one extra 1-record read gives the unfiltered total, so the end report can say
    // how many records the filter left behind.
    let unfilteredTotal = null;
    if (Object.keys(filter).length && !absent && !entry.reader && entry.paging.kind === 'pages') {
      const res = await get(entry.route, { ...entry.query, page: 1, per_page: 1 }, entry.auth);
      unfilteredTotal = http.parseTotalHeader(res.headers, 'x-wp-total');
    }
    if (!fs.existsSync(part)) fs.writeFileSync(part, '');
    fs.renameSync(part, final);
    for (const k of kids) { if (!fs.existsSync(k.part)) fs.writeFileSync(k.part, ''); fs.renameSync(k.part, k.final); }
    const count = out.written();
    return {
      entity: entry.id,
      route: entry.reader ? `reader:${entry.reader}` : entry.route,
      namespace: entry.namespace || (entry.route ? entry.route.split('/').slice(1, 3).join('/') : null),
      file: rel(projectDir, final),
      count,
      sourceTotal: sourceTotal !== null ? sourceTotal : (entry.paging.kind === 'none' || absent ? count : null),
      children: kids.map((k) => ({ entity: k.c.id, file: rel(projectDir, k.final), count: k.n })),
      complete: !sample,
      sample,
      ...(Object.keys(filter).length ? { filter, unfilteredTotal } : {}),
      ...(absent ? { absent: 'route-not-found' } : {}),
      extractedAt: now().toISOString(),
    };
  }

  async function extractDerived(entry) {
    const fromRow = loadManifest().entities.find((e) => e.entity === entry.from);
    if (!fromRow || fromRow.complete !== true) return null;
    const derive = DERIVERS[entry.deriver];
    if (!derive) throw codedError('deriver_unknown', `${entry.id}: unknown deriver ${entry.deriver}`);
    const { rows, extra: more } = derive({ projectDir, outDir, sourceSystem });
    const final = path.join(outDir, `${entry.id}.ndjson`);
    fs.writeFileSync(`${final}.part`, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    fs.renameSync(`${final}.part`, final);
    return { entity: entry.id, route: `derived:${entry.from}`, namespace: 'derived', file: rel(projectDir, final), count: rows.length, sourceTotal: rows.length,
      children: [], complete: true, sample: false, derivedFrom: entry.from, ...more, extractedAt: fromRow.extractedAt || now().toISOString() };
  }

  // An entry's `referencedRecords` (catalog): records another entity points at that the entry's own
  // list did not return (an order's customer_id for a WordPress user whose role is not customer).
  // Read by id once `from` is extracted, only when the plan's choice says so, and appended to the
  // entry's file and manifest. Without the choice nothing is read and the import holds those
  // records' dependents as before (interactive mode asks then). A 404 id is listed, not read.
  async function extractReferenced(target) {
    const refd = target.referencedRecords;
    if (planChoice(thePlan, target.id, refd.choice) !== refd.readWhen) return null;
    const targetRow = loadManifest().entities.find((e) => e.entity === target.id);
    if (!targetRow || targetRow.complete !== true || !targetRow.file) return null;
    if (loadManifest().entities.find((e) => e.entity === refd.from)?.complete !== true) return null;
    const file = path.join(projectDir, targetRow.file);
    const have = new Set(readRows(file).map((r) => String(r?.[target.keyField])));
    const ids = [...new Set(readRows(path.join(outDir, `${refd.from}.ndjson`)).map((r) => r?.[refd.field])
      .filter((v) => v !== undefined && v !== null && !/^0*$/.test(String(v).trim())).map(String))]
      .filter((id) => !have.has(id)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const rows = [];
    const notFound = [];
    for (const id of ids) {
      try {
        const res = await get(fillRoute(refd.route, { id }), {}, target.auth);
        if (res.json && typeof res.json === 'object' && !Array.isArray(res.json) && String(res.json[target.keyField]) === id) rows.push(res.json); else notFound.push(id);
      } catch (error) { if (error.status === 404) { notFound.push(id); continue; } throw error; }
    }
    if (rows.length) {
      fs.writeFileSync(`${file}.part`, fs.readFileSync(file, 'utf8') + rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      fs.renameSync(`${file}.part`, file);
    }
    const prior = targetRow.referencedRecords?.ids || [];
    const row = { ...targetRow, count: targetRow.count + rows.length, sourceTotal: targetRow.sourceTotal !== null ? targetRow.sourceTotal + rows.length : null,
      referencedRecords: { from: refd.from, field: refd.field, choice: refd.choice, ids: [...prior, ...rows.map((r) => String(r[target.keyField]))], notFound } };
    await recordLedger(row); writeEntityManifests(row); writeManifestRow(row);
    log.progress(`read ${rows.length} ${target.id} records referenced by ${refd.from}`, { phase: 'extract', currentEntity: target.id, count: row.count });
    return row;
  }

  async function afterFrom(id) {
    // After `from` (the usual order), or after the entry itself when `from` is already extracted.
    for (const target of entries.filter((e) => e.referencedRecords && (e.referencedRecords.from === id || e.id === id))) {
      try { await extractReferenced(target); } catch (error) { failures.push({ entity: target.id, code: error.code || 'referenced_read_failed', error: String(error.message).slice(0, 200) }); }
    }
  }

  // Extract one entry (a child id extracts its parent). Returns the manifest row, or null when a
  // derived entry's source is not extracted yet.
  async function extract(id, { sample = false } = {}) {
    const entry = byId.get(parentOfChild.get(id) || id);
    if (!entry) {
      // Nothing reads this entity yet (a plugin or custom route outside the catalog). The run
      // goes on; the manifest row becomes a cutover item (completion-report source-entity-unread).
      const row = { entity: id, route: null, namespace: null, file: null, count: 0, sourceTotal: null, children: [], complete: false, sample, unread: 'no-reader', extractedAt: now().toISOString() };
      if (!sample) writeManifestRow(row);
      return row;
    }
    if (entry.kind === 'derived') {
      if (sample) return null;
      const row = await extractDerived(entry);
      if (row) { await recordLedger(row); writeEntityManifests(row); writeManifestRow(row); }
      return row;
    }
    const row = await extractRest(entry, { sample });
    if (!sample) { await recordLedger(row); writeEntityManifests(row); writeManifestRow(row); await afterFrom(entry.id); }
    return row;
  }

  // Ids in dependency order; derived entries run once their source is extracted.
  async function extractAll(ids = entries.filter((e) => !e.optional || e.kind === 'derived').map((e) => e.id), { sample = false } = {}) {
    const wanted = new Set(ids.map((id) => parentOfChild.get(id) || id));
    // An entry read for another one (`extractWith`: the store's tax settings with the tax rates) is
    // extracted whenever that one is, so a plan-scoped run never leaves it out.
    for (const entry of entries) if (entry.extractWith && wanted.has(entry.extractWith)) wanted.add(entry.id);
    const results = [];
    log.start('extract started', { phase: 'extract' });
    for (const entry of entries) {
      if (!wanted.has(entry.id)) continue;
      try {
        const row = await extract(entry.id, { sample });
        results.push(row ? { status: rowStatus(row), entity: entry.id, count: row.count, sourceTotal: row.sourceTotal } : { status: 'skipped', entity: entry.id, reason: 'source-not-extracted' });
      } catch (error) {
        const message = String(error.message).slice(0, 200);
        failures.push({ entity: entry.id, code: error.code || 'source_read_failed', error: message });
        log.warn(`extract failed for ${entry.id}`, { phase: 'extract', currentEntity: entry.id, error: message });
        results.push({ status: 'failed', entity: entry.id, code: error.code || 'source_read_failed', error: message });
      }
    }
    for (const id of wanted) if (!byId.has(id)) { const row = await extract(id, { sample }); results.push({ status: rowStatus(row), entity: id, reason: row.unread }); }
    if (results.some((r) => r.status === 'failed')) log.error('extract finished with failures', { phase: 'extract', failures });
    else log.complete('extract complete', { phase: 'extract' });
    return results;
  }

  // Project-adapter functions the generated plugin handoff calls (src/project/plugin-runtime.js).
  async function extractNative({ entity }) {
    const ref = entity.sourceEntityRef;
    try {
      const row = await extract(ref);
      if (!row) return { status: 'skipped', sourceEntityRef: ref, reason: 'source-not-extracted' };
      if (row.unread) return { status: 'unread', sourceEntityRef: ref, reason: row.unread };
      return { status: rowStatus(row), sourceEntityRef: ref, count: row.count, sourceTotal: row.sourceTotal, file: row.file };
    } catch (error) {
      const message = String(error.message).slice(0, 200);
      failures.push({ entity: ref, code: error.code || 'source_read_failed', error: message });
      log.warn(`extract failed for ${ref}`, { phase: 'extract', currentEntity: ref, error: message });
      return { status: 'failed', sourceEntityRef: ref, error: message };
    }
  }

  function preview(entity) {
    const file = path.join(outDir, 'sample', `${entity.sourceEntityRef}.ndjson`);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, sampleSize).map((line) => JSON.parse(line));
  }

  // After the native entities: derived entries whose source is now extracted.
  async function afterExtraction() {
    for (const entry of entries.filter((e) => e.kind === 'derived')) {
      try { await extract(entry.id); } catch (error) { failures.push({ entity: entry.id, code: error.code || 'deriver_failed', error: String(error.message).slice(0, 200) }); }
    }
    if (failures.length) { log.error('extract finished with failures', { phase: 'extract', failures }); process.exitCode = 1; }
    return { failures: [...failures] };
  }

  return { entries, extract, extractAll, extractNative, preview, afterExtraction, failures, progress: log, planFilter: (id) => planFilter(thePlan, byId.get(id)) };
}

const SOURCE_KEYS = ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD', 'WC_CONSUMER_KEY', 'WC_CONSUMER_SECRET'];

// Source credentials: config/source.wordpress.env, then config/source.woocommerce.env, then the
// process environment for keys still missing. Values are never printed.
async function loadSourceEnv(projectDir, processEnv = process.env) {
  const { readEnvFile } = require('../../../lib/config-env.js');
  const env = {};
  for (const name of ['source.wordpress.env', 'source.woocommerce.env']) {
    let values = {};
    try { values = await readEnvFile(path.join(projectDir, 'config', name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const [key, value] of Object.entries(values || {})) if (value && !env[key]) env[key] = value;
  }
  for (const key of SOURCE_KEYS) if (!env[key] && processEnv[key]) env[key] = processEnv[key];
  return env;
}

// The extract functions the generated plugin handoff calls (plugin-entity-read-plan.js uses these
// when src/project/plugin-runtime.js does not define them, which is the default for WordPress):
// extractNative, preview, sourceTransport (the Wix WP plugin bridge) and afterExtraction.
// The extractor is created on first use, so loading the adapter has no side effects.
function projectAdapter(projectDir, options = {}) {
  projectDir = path.resolve(projectDir);
  let made = null;
  const get = async (runId) => {
    if (made) return made;
    let progress = options.progress || null;
    if (!progress) {
      const { parseProgressArgs, createProgressLogger } = require('../../../lib/progress-log.js');
      const { progress: p } = parseProgressArgs(process.argv.slice(2));
      progress = createProgressLogger({ script: 'run-extract', progressLog: p.progressLog || path.join(projectDir, 'execution', 'progress.ndjson'), runId: p.runId || runId, parentRunId: p.parentRunId });
      progress.start('extract started', { phase: 'extract' });
    }
    made = createCatalogExtractor({ projectDir, env: options.env || await loadSourceEnv(projectDir), progress, ...options });
    return made;
  };
  // Bridge reads (wix-wp-plugin v2) are counted for the source-read telemetry record.
  const reads = { discovery_queries: 0, scoped_queries: 0, tier_refusals: 0, redacted_values: 0, discovery_tables: new Set(), scoped_tables: new Set() };
  async function sourceTransport({ siteBaseUrl, runId }) {
    await get(runId);
    const env = options.env || await loadSourceEnv(projectDir);
    const headers = http.buildHeaders({ username: env.WP_USERNAME, applicationPassword: env.WP_APPLICATION_PASSWORD });
    const call = async (route, init, step) => {
      const response = await http.fetchJson(siteBaseUrl, route, { headers, timeoutMs: 60000, progress: made.progress, progressContext: { step }, ...init });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} ${response.statusText}`), { status: response.status });
      return { data: response.json };
    };
    const httpClient = {
      get: (_url, { params } = {}) => call('/wix-wp-plugin/v2/structure', { method: 'GET', query: params }, 'structure-bridge-discover'),
      post: (_url, { body } = {}) => call('/wix-wp-plugin/v2/query/admin-key', { method: 'POST', body }, 'structure-bridge-query'),
    };
    const onSourceRead = (counts) => {
      for (const key of ['discovery_queries', 'scoped_queries', 'tier_refusals', 'redacted_values']) reads[key] += counts[key] || 0;
      for (const table of counts.discovery_tables || []) reads.discovery_tables.add(table);
      for (const table of counts.scoped_tables || []) reads.scoped_tables.add(table);
    };
    return { httpClient, siteBaseUrl, auth: undefined, structureMethod: 'GET', queryRoute: '/wix-wp-plugin/v2/query/admin-key', onSourceRead };
  }
  return {
    extractNative: async (args) => (await get(args.runId)).extractNative(args),
    preview: (entity) => {
      const file = path.join(projectDir, OUT_DIR, 'sample', `${entity.sourceEntityRef}.ndjson`);
      if (!fs.existsSync(file)) return null;
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, options.sampleSize || DEFAULT_SAMPLE_SIZE).map((line) => JSON.parse(line));
    },
    sourceTransport,
    afterExtraction: async (args = {}) => {
      const result = await (await get(args.runId)).afterExtraction(args);
      const payload = { ...reads, discovery_tables: [...reads.discovery_tables].sort(), scoped_tables: [...reads.scoped_tables].sort() };
      if (['discovery_queries', 'scoped_queries', 'tier_refusals', 'redacted_values'].some((key) => payload[key] > 0)) {
        require('../../rp-telemetry/lib/telemetry-recorder.js').sourceRead(projectDir, payload);
      }
      if (!result.failures.length) made.progress?.complete?.('extract complete', { phase: 'extract' });
      return result;
    },
  };
}

// The run's extract entrypoint when no plugin handoff is generated (src/extract/run-extract.js is
// the fixed template from generated-plugin-handoff.js emitCatalogExtract):
//   run-extract.js [--entity a,b] [--sample] [--progress-log <path>] [--run-id <id>]
// Default ids: the plan's executionScope.resolvedEntityRefs (else selectedEntityRefs), then derived
// entries. An id with no reader is recorded as unread (a cutover item), never a stop.
async function runCli(projectDir, argv, { env, stdout = process.stdout } = {}) {
  projectDir = path.resolve(projectDir);
  const { parseProgressArgs, createProgressLogger } = require('../../../lib/progress-log.js');
  const { args: rest, progress: p } = parseProgressArgs(argv);
  const opts = { entity: null, sample: false };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--entity') opts.entity = String(rest[++i] || '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (rest[i] === '--sample') opts.sample = true;
    else throw codedError('extract_usage', `unknown argument: ${rest[i]}`);
  }
  const progress = createProgressLogger({ script: 'run-extract', progressLog: p.progressLog || path.join(projectDir, 'execution', 'progress.ndjson'), runId: p.runId, parentRunId: p.parentRunId });
  const extractor = createCatalogExtractor({ projectDir, env: env || await loadSourceEnv(projectDir), progress });
  let ids = opts.entity;
  if (!ids) {
    const plan = readJsonIfExists(path.join(projectDir, 'mapping', 'mapping-plan.json'));
    const scope = plan?.executionScope?.resolvedEntityRefs || plan?.executionScope?.selectedEntityRefs || null;
    ids = scope ? [...scope, ...extractor.entries.filter((e) => e.kind === 'derived').map((e) => e.id)] : undefined;
  }
  const results = await extractor.extractAll(ids, { sample: opts.sample });
  stdout.write(`${JSON.stringify({ results })}\n`);
  return { code: results.some((r) => r.status === 'failed') ? 1 : 0, results };
}

module.exports = { OUT_DIR, EXTRA_CATALOG, READERS_DIR, DERIVERS, SOURCE_KEYS, mergeCatalog, planFilter, createCatalogExtractor, loadSourceEnv, projectAdapter, runCli };
