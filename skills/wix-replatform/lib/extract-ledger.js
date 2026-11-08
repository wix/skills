'use strict';

// The toolkit's own record of every source extract version.
//
// An extract and its manifest are written by generated project code, so a manifest digest proves
// nothing: the same code can rewrite the file and re-stamp it. This ledger records each version
// the toolkit sees: its digest, row count and, per source record, the set of field names it
// carries (never values). Gates then refuse an extract that changed after it was recorded, and a
// version in which a record lost fields it had in an earlier version while the source did not
// change that record. Dropping source data to get past a gate is detected, not trusted; a field
// with no home is kept by the mapping, never stripped.
//
// Tamper evidence: rows are hash-chained (`prev`, `rowHash`), each row pins its shapes file by
// digest, and lost fields are recomputed from the shapes files rather than read from the row. The
// read-back inventory pins the chain head. The ledger is kept twice: under state/ and beside the
// extracts it describes (data/source-extract/.extract-ledger/), so deleting either copy is
// detected and repaired from the other.
//
// Never block: a changed, field-losing or unverifiable extract is re-extracted from the source
// (`src/extract/run-extract.js --entity <entity>`), the new version is recorded, and what happened
// -- old and new version, fields still lost -- is written to execution/extract-integrity.json for
// the run report. Only an extract that cannot be re-read from the source is refused, for that
// entity alone, with its next step.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { readExtract } = require('./read-back-extract');

const LEDGER = 'state/source-extract-ledger.ndjson';
const SHAPES_DIR = 'state/source-extract-ledger';
const MIRROR = 'data/source-extract/.extract-ledger/ledger.ndjson';
const MIRROR_SHAPES_DIR = 'data/source-extract/.extract-ledger/shapes';
const REPORT = 'execution/extract-integrity.json';
const EXTRACTOR = 'src/extract/run-extract.js';
const SCHEMA_VERSION = 2;
// Source fields that change whenever the source changes a record. A record whose marker differs
// between two versions was edited at the source, so a field it no longer has is not a strip.
const CHANGE_MARKERS = ['date_modified_gmt', 'date_modified', 'updated_at', 'updatedAt', 'modified_gmt', 'modified'];

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function fail(code) { return Object.assign(new Error(code), { code }); }
function inside(projectDir, file) {
  const root = path.resolve(projectDir), absolute = path.resolve(root, typeof file === 'string' ? file : '');
  if (typeof file !== 'string' || !file || !absolute.startsWith(root + path.sep)) throw fail('extract_path_outside_project');
  return absolute;
}
const relative = (projectDir, file) => path.relative(path.resolve(projectDir), inside(projectDir, file)).split(path.sep).join('/');
const valueAt = (record, dotted) => dotted.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), record);

// Field names a record carries: object keys as dotted paths, arrays as `[]`, and for an array of
// `{ key, value }` items (WordPress meta) each item's key as `[key="…"]`, so a dropped meta key
// is a lost field even though `meta_data[].value` remains.
function shapePaths(record, out = new Set(), base = '') {
  if (Array.isArray(record)) {
    for (const item of record) {
      if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.key === 'string') out.add(`${base}[key=${JSON.stringify(item.key)}]`);
      shapePaths(item, out, `${base}[]`);
    }
  } else if (record && typeof record === 'object') {
    for (const [key, value] of Object.entries(record)) {
      const next = base ? `${base}.${key}` : key;
      out.add(next);
      shapePaths(value, out, next);
    }
  }
  return out;
}

async function fileDigest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// One streamed pass: per record its field-name set (deduplicated by shape) and change marker.
// Parse failures surface as typed codes only, never source text.
async function measure(projectDir, extractPath, { keyField = 'id' } = {}) {
  const file = inside(projectDir, extractPath), shapes = [], shapeIndex = new Map(), records = {};
  let rows = 0;
  try {
    for await (const record of readExtract(file)) {
      rows += 1;
      const key = valueAt(record, keyField);
      if (key === undefined || key === null || typeof key === 'object' || String(key) === '') throw fail('extract_record_key_missing');
      if (Object.hasOwn(records, String(key))) throw fail('extract_record_key_duplicate');
      const paths = [...shapePaths(record)].sort(), id = canonical(paths);
      if (!shapeIndex.has(id)) { shapeIndex.set(id, shapes.length); shapes.push(paths); }
      const marker = CHANGE_MARKERS.map(name => record[name]).find(value => typeof value === 'string' || typeof value === 'number');
      records[String(key)] = marker === undefined ? [shapeIndex.get(id)] : [shapeIndex.get(id), String(marker)];
    }
  } catch (error) {
    throw fail(typeof error.code === 'string' && /^extract_/.test(error.code) ? error.code : 'extract_unreadable');
  }
  return { sha256: await fileDigest(file), rows, keyField, shapes, records };
}

function rowHash(row) { const { rowHash: _omit, ...rest } = row; return sha(canonical(rest)); }
function readChain(file) {
  if (!fs.existsSync(file)) return { rows: [], present: false, broken: false };
  const rows = [];
  let prev = 'genesis', broken = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { broken = true; break; }
    if (row.schemaVersion !== SCHEMA_VERSION || row.prev !== prev || row.rowHash !== rowHash(row) || row.seq !== rows.length + 1) { broken = true; break; }
    rows.push(row); prev = row.rowHash;
  }
  return { rows, present: true, broken };
}
const isPrefix = (short, long) => short.every((row, i) => long[i]?.rowHash === row.rowHash);
// The longer intact copy is authoritative. A copy that is missing, broken, behind or divergent is
// reported (`issues`) and rewritten from it, so one deleted or edited copy never hides history.
function readLedger(projectDir) {
  const copies = [LEDGER, MIRROR].map(rel => ({ rel, ...readChain(path.join(projectDir, rel)) }));
  const [main, mirror] = copies;
  const rows = main.rows.length >= mirror.rows.length ? main.rows : mirror.rows;
  const issues = [];
  for (const copy of copies) {
    if (copy.broken) issues.push(`source_extract_ledger_broken:${copy.rel}`);
    else if (!copy.present && rows.length) issues.push(`source_extract_ledger_missing:${copy.rel}`);
    else if (!isPrefix(copy.rows, rows)) issues.push(`source_extract_ledger_diverged:${copy.rel}`);
  }
  return { rows, issues, errors: [] };
}
function writeLedger(projectDir, rows) {
  for (const rel of [LEDGER, MIRROR]) {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), rows.map(row => JSON.stringify(row) + '\n').join(''));
  }
}
function entries(projectDir, extractPath) {
  const wanted = extractPath === undefined ? null : relative(projectDir, extractPath);
  return readLedger(projectDir).rows.filter(row => wanted === null || row.extractPath === wanted);
}
const head = projectDir => readLedger(projectDir).rows.at(-1)?.rowHash || null;

const shapeSnapshotName = (entity, extractPath, keyField, digest) =>
  `${sha(canonical({ entity, extractPath, keyField }))}-${digest}.json`;
const mirrorShapes = row => `${MIRROR_SHAPES_DIR}/${path.basename(row.shapesPath)}`;
function readShapes(projectDir, row) {
  let changed = false;
  for (const rel of [row.shapesPath, mirrorShapes(row)]) {
    let text;
    try { text = fs.readFileSync(inside(projectDir, rel), 'utf8'); } catch { continue; }
    if (sha(text) === row.shapesSha256) return JSON.parse(text);
    changed = true;
  }
  throw fail(changed ? 'source_extract_shapes_changed' : 'source_extract_shapes_missing');
}
// Fields a record carried in an earlier version and no longer carries, for every record present in
// both whose change marker did not move. Every earlier version counts, so a stripped version
// followed by any later re-extract stays lost. A record the source deleted or edited is not a loss.
function lostSince(earlier, after) {
  const lost = new Map();
  for (const [key, [shape, marker]] of Object.entries(after.records)) {
    const now = new Set(after.shapes[shape]), gone = new Set();
    for (const before of earlier) {
      const prior = before.records[key];
      if (!prior || prior[1] !== marker) continue;
      for (const p of before.shapes[prior[0]]) if (!now.has(p)) gone.add(p);
    }
    for (const p of gone) lost.set(p, (lost.get(p) || 0) + 1);
  }
  return [...lost.keys()].sort().map(p => ({ path: p, records: lost.get(p) }));
}

// Record the extract's current version, unless it is already the latest one. Both ledger copies
// are brought to the authoritative chain first.
async function recordExtract(projectDir, { entity, extractPath, keyField = 'id', recordedBy = 'toolkit', replacesHead = null, now = new Date() }) {
  if (typeof entity !== 'string' || !entity) throw fail('extract_entity_required');
  const ledger = readLedger(projectDir);
  const extract = relative(projectDir, extractPath), prior = ledger.rows.filter(row => row.extractPath === extract);
  const measured = await measure(projectDir, extract, { keyField });
  const latest = prior.at(-1);
  if (ledger.issues.length) writeLedger(projectDir, ledger.rows);
  // A re-read from the source is always its own row, even when it matches: it settles the loss check.
  if (latest?.sha256 === measured.sha256 && !replacesHead && (recordedBy !== 're-extract' || latest.recordedBy === 're-extract')) return latest;
  const shapes = { sha256: measured.sha256, keyField, shapes: measured.shapes, records: measured.records }, shapesText = canonical(shapes);
  const snapshotName = shapeSnapshotName(entity, extract, keyField, measured.sha256);
  const shapesPath = `${SHAPES_DIR}/${snapshotName}`;
  for (const rel of [shapesPath, `${MIRROR_SHAPES_DIR}/${snapshotName}`]) {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), shapesText);
  }
  let earlier = [];
  try { earlier = prior.map(row => readShapes(projectDir, row)); } catch { /* unverifiable history: reported by extractErrors */ }
  const row = { schemaVersion: SCHEMA_VERSION, seq: ledger.rows.length + 1, prev: ledger.rows.at(-1)?.rowHash || 'genesis', entity, extractPath: extract, sha256: measured.sha256, rows: measured.rows, keyField,
    shapesPath, shapesSha256: sha(shapesText), lostPaths: lostSince(earlier, shapes), version: prior.length + 1, recordedBy, ...(replacesHead ? { replacesHead } : {}), recordedAt: now.toISOString() };
  row.rowHash = rowHash(row);
  writeLedger(projectDir, [...ledger.rows, row]);
  return row;
}

// Errors for the extract as it is now. `ledgerHead` is the chain head an inventory pinned; the
// ledger must still contain it. Lost fields are recomputed from the pinned shapes files.
async function extractErrors(projectDir, extractPath, { sha256 = null, ledgerHead = null } = {}) {
  let extract;
  try { extract = relative(projectDir, extractPath); } catch (error) { return [error.code]; }
  const ledger = readLedger(projectDir);
  if (ledger.issues.length) return ledger.issues.map(code => `${code.split(':')[0]}:${extract}`);
  // A re-extract that replaced a lost head satisfies it: the extract was re-read from the source.
  if (ledgerHead && !ledger.rows.some(row => row.rowHash === ledgerHead || row.replacesHead === ledgerHead)) return [`source_extract_ledger_head_missing:${extract}`];
  const prior = ledger.rows.filter(row => row.extractPath === extract), latest = prior.at(-1);
  if (!latest) return [`source_extract_unrecorded:${extract}`];
  let current;
  try { current = await fileDigest(inside(projectDir, extract)); } catch { return [`source_extract_unreadable:${extract}`]; }
  const errors = [];
  if (current !== latest.sha256) errors.push(`source_extract_changed_since_recorded:${extract}`);
  else if (sha256 && sha256 !== current) errors.push(`source_extract_changed_since_inventory:${extract}`);
  try {
    const lost = lostSince(prior.slice(0, -1).map(row => readShapes(projectDir, row)), readShapes(projectDir, latest));
    // Loss that remains after a re-read from the source is reported (extract-integrity.json), not retried.
    if (lost.length && latest.recordedBy !== 're-extract') errors.push(`source_extract_paths_lost:${extract}:${lost.length}`);
  } catch (error) { errors.push(`${error.code || 'source_extract_shapes_missing'}:${extract}`); }
  return errors;
}

// --- never block: repair, report, continue ----------------------------------------------------
function appendReport(projectDir, event) {
  const file = path.join(projectDir, REPORT);
  let report = { schemaVersion: 1, events: [] };
  try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first event */ }
  report.events.push(event);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}
// A hung source read cannot stall the task forever. Read per call so an operator can raise it.
const TIMEOUT_MS = 30 * 60 * 1000;
function runExtractor(projectDir, entity, { timeoutMs = Number(process.env.RP_REEXTRACT_TIMEOUT_MS) || TIMEOUT_MS } = {}) {
  const script = path.join(projectDir, EXTRACTOR);
  if (!fs.existsSync(script)) return Promise.resolve('extractor_missing');
  return new Promise(resolve => {
    // Output is not kept: it may carry source values.
    const child = spawn(process.execPath, [script, '--entity', entity], { cwd: projectDir, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('extractor_timeout'); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve('extractor_failed'); });
    child.on('exit', code => { clearTimeout(timer); resolve(code === 0 ? null : 'extractor_failed'); });
  });
}
// The suspect extract and its manifest (and any partial `.tmp`) are moved aside before the re-read,
// so an extractor that reuses a final file whose manifest matches cannot hand the same bytes back.
// On a failed re-read they are put back: the run keeps what it had, and only this entity stops.
function siblingManifest(extract) {
  const dir = path.posix.dirname(extract), base = path.posix.basename(extract).replace(/\.(ndjson|json)$/, '');
  return `${dir}/${base}.manifest.json`;
}
function moveAside(projectDir, extract, manifestPath, tag) {
  const moved = [];
  for (const rel of [...new Set([extract, `${extract}.tmp`, manifestPath || siblingManifest(extract)])]) {
    const file = inside(projectDir, rel);
    if (!fs.existsSync(file)) continue;
    const aside = `${file}.suspect-${tag}`;
    fs.renameSync(file, aside);
    moved.push({ file, aside });
  }
  return moved;
}
function putBack(moved) {
  for (const { file, aside } of moved) { try { fs.rmSync(file, { force: true }); fs.renameSync(aside, file); } catch { /* left aside, named in the report */ } }
}
const version = row => (row ? { version: row.version, sha256: row.sha256, rows: row.rows } : null);
const RESTORE_ONLY = new Set(['source_extract_ledger_missing']);

// Make the extract trustworthy without blocking: record a first-seen extract, restore a missing
// ledger copy, and re-extract from the source when the extract changed, lost fields or its
// history cannot be verified. Fields still lost after re-extraction are reported and the run
// continues. Throws only `source_extract_unreadable` (re-extraction failed), for this entity.
async function ensureExtract(projectDir, { entity, extractPath, manifestPath = null, keyField = 'id', ledgerHead = null, sha256 = null, recordedBy = 'toolkit', now = () => new Date() }) {
  const extract = relative(projectDir, extractPath);
  const before = entries(projectDir, extract).at(-1) || null;
  let problems = await extractErrors(projectDir, extract, { ledgerHead, sha256 });
  if (problems.length === 1 && problems[0].startsWith('source_extract_unrecorded:')) {
    await recordExtract(projectDir, { entity, extractPath: extract, keyField, recordedBy, now: now() });
    problems = await extractErrors(projectDir, extract, { ledgerHead, sha256 });
  }
  if (problems.length && problems.every(code => RESTORE_ONLY.has(code.split(':')[0]))) {
    writeLedger(projectDir, readLedger(projectDir).rows);
    appendReport(projectDir, { at: now().toISOString(), entity, extractPath: extract, trigger: problems.map(code => code.split(':')[0]), action: 'ledger-restored', before: version(before), after: version(entries(projectDir, extract).at(-1)), lostPaths: [] });
    problems = await extractErrors(projectDir, extract, { ledgerHead, sha256 });
  }
  // A changed extract is a new version; only lost fields or unverifiable history need the source.
  if (problems.length === 1 && problems[0].startsWith('source_extract_changed_since_recorded:')) {
    await recordExtract(projectDir, { entity, extractPath: extract, keyField, recordedBy, now: now() });
    problems = await extractErrors(projectDir, extract, { ledgerHead, sha256 });
  }
  if (!problems.length) return { row: entries(projectDir, extract).at(-1), repaired: false };
  const trigger = [...new Set(problems.map(code => code.split(':')[0]))];
  const suspect = entries(projectDir, extract).at(-1) || before;
  const moved = moveAside(projectDir, extract, manifestPath, (suspect?.sha256 || 'unrecorded').slice(0, 12));
  let failure = await runExtractor(projectDir, entity);
  if (!failure && !fs.existsSync(inside(projectDir, extract))) failure = 'extractor_no_output';
  if (failure) putBack(moved);
  else for (const { aside } of moved) fs.rmSync(aside, { force: true });
  if (failure) {
    appendReport(projectDir, { at: now().toISOString(), entity, extractPath: extract, trigger, action: 'refused', reason: failure, before: version(suspect), after: null, lostPaths: [], next: NEXT.source_extract_unreadable });
    throw Object.assign(fail('source_extract_unreadable'), { reason: failure });
  }
  const row = await recordExtract(projectDir, { entity, extractPath: extract, keyField, recordedBy: 're-extract', replacesHead: trigger.includes('source_extract_ledger_head_missing') ? ledgerHead : null, now: now() });
  appendReport(projectDir, { at: now().toISOString(), entity, extractPath: extract, trigger, action: 're-extracted', before: version(suspect), after: version(row),
    lostPaths: row.lostPaths || [], ...(row.lostPaths?.length ? { next: NEXT.source_extract_fields_still_lost } : {}) });
  return { row, repaired: true };
}
async function reportEvents(projectDir) {
  try { return JSON.parse(await fs.promises.readFile(path.join(projectDir, REPORT), 'utf8')).events || []; } catch { return []; }
}

const NEXT = {
  source_extract_unreadable: 'Requires Import Operator. Re-extraction from the source failed for this entity only; the rest of the import continues. Check source access, make src/extract/run-extract.js accept --entity <entity>, then rerun the import for this entity.',
  source_extract_fields_still_lost: 'Requires Import Operator. The extract was re-read from the source and some unchanged records still lack fields an earlier extract had: the extractor drops them. Fix src/extract/run-extract.js to keep every source field, re-extract this entity and rerun its import.',
  source_extract_unrecorded: 'Record the extract with `node scripts/extract-ledger.js record` right after writing it (the read-back inventory records it too).',
  source_extract_changed_since_recorded: 'The extract file changed after the toolkit recorded it. Re-extract from the source and record it; never edit an extract in place.',
  source_extract_changed_since_inventory: 'Rerun the read-back inventory on the current extract.',
  source_extract_paths_lost: 'Records the source did not change lost fields since the previous extract. Re-extract from the source without dropping fields; a field with no target is kept by the mapping (extended field or CMS), never stripped.',
  source_extract_ledger_broken: 'The extract ledger was edited. Restore it from the run; it is append-only toolkit state.',
  source_extract_ledger_corrupt: 'The extract ledger was edited. Restore it from the run; it is append-only toolkit state.',
  source_extract_ledger_missing: 'One ledger copy was deleted; it is restored from the other.',
  source_extract_ledger_diverged: 'A ledger copy was edited; the extract is re-read from the source.',
  source_extract_ledger_head_missing: 'The extract ledger no longer contains the version the read-back inventory recorded. Restore the ledger, or re-extract from the source and rerun the inventory.',
  source_extract_shapes_missing: 'A recorded extract version lost its field record. Restore state/source-extract-ledger/ from the run.',
  source_extract_shapes_changed: 'A recorded extract field record was edited. Restore state/source-extract-ledger/ from the run.',
};
const nextStep = code => NEXT[String(code).split(':')[0]] || null;

module.exports = { TIMEOUT_MS, LEDGER, SHAPES_DIR, MIRROR, REPORT, EXTRACTOR, CHANGE_MARKERS, shapePaths, measure, entries, head, recordExtract, extractErrors, ensureExtract, reportEvents, nextStep, fileDigest: (projectDir, file) => fileDigest(inside(projectDir, file)) };
