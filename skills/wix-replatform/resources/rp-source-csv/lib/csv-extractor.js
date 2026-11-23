'use strict';

// Fixed CSV extractor. Reads the files source-schema.json lists (sourceMeta.csvInputRoot +
// sourceFiles, with each file's role, vendor and layout from discovery) through csv-parse.js and
// writes data/source-extract the way the platform's API reader does: the same entity files and,
// for a known vendor, the same field names (reader-catalog.json, data). A vendor with no catalog
// entry is read by the generic reader: one record per row group, columns kept verbatim.
//
// Records stream to <entity>.ndjson.part and are renamed when the role is complete, so a failed
// read keeps the previous file. Each entity gets <entity>.manifest.json (rowsWritten ==
// snapshotTotal: the file is the source), a shared manifest.json row and an extract-ledger row.

const fs = require('node:fs');
const path = require('node:path');
const { streamRows, normalizeHeaderName, EMPTY_POLICY } = require('./csv-parse.js');
const { splitMultiValue } = require('./csv-layout.js');
const ndjson = require('../../rp-target-wix/lib/ndjson.js');

const CATALOG_FILE = path.join(__dirname, '..', 'reader-catalog.json');
const OUT_DIR = 'data/source-extract';
const DEFAULT_SAMPLE_SIZE = 5;
const AS = new Set(['string', 'int', 'bool', 'map', 'list', 'images', 'refs']);
const TRUE = new Set(['1', 'yes', 'true']);
const FALSE = new Set(['0', 'no', 'false']);

function codedError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function loadCsvCatalog(file = CATALOG_FILE) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateCsvCatalog(catalog);
  if (errors.length) throw codedError('csv_reader_catalog_invalid', errors.join('; '), { errors });
  return catalog;
}

function validateCsvCatalog(catalog) {
  const errors = [];
  if (!catalog || catalog.schemaVersion !== 1) errors.push('catalog: schemaVersion must be 1');
  for (const [vendor, v] of Object.entries(catalog?.vendors || {})) {
    if (typeof v.platform !== 'string') errors.push(`${vendor}: platform required`);
    for (const [role, r] of Object.entries(v.roles || {})) {
      const where = `${vendor}.${role}`;
      if (r.shape !== 'per-row') errors.push(`${where}: shape must be per-row`);
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(r.entity || '')) errors.push(`${where}: entity id invalid`);
      const tos = new Set();
      for (const f of r.fields || []) {
        if (typeof f.to !== 'string' || !f.to) errors.push(`${where}: field needs to`);
        if (tos.has(f.to)) errors.push(`${where}: duplicate field ${f.to}`);
        tos.add(f.to);
        if (!Array.isArray(f.from) || !f.from.length) errors.push(`${where}.${f.to}: from must list header aliases`);
        if (f.as !== undefined && !AS.has(f.as)) errors.push(`${where}.${f.to}: unknown as ${f.as}`);
        if (f.as === 'map' && (typeof f.values !== 'object' || !f.values)) errors.push(`${where}.${f.to}: map needs values`);
      }
      if (r.child && (!r.child.entity || !r.child.discriminator?.from || !r.child.parentRef?.field)) errors.push(`${where}: child needs entity, discriminator and parentRef`);
      for (const d of r.derived || []) if (!d.entity || !d.field || !Array.isArray(d.from)) errors.push(`${where}: derived needs entity, field and from`);
    }
  }
  return errors;
}

function setPath(record, dotted, value) {
  const parts = dotted.split('.');
  let node = record;
  for (const p of parts.slice(0, -1)) node = node[p] && typeof node[p] === 'object' ? node[p] : (node[p] = {});
  node[parts.at(-1)] = value;
}

function split(cell, separators) {
  let parts = [String(cell)];
  for (const sep of [].concat(separators || ',')) parts = parts.flatMap((p) => splitMultiValue(p, sep));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function convert(field, raw) {
  switch (field.as || 'string') {
    case 'int': return /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    case 'bool': { const v = raw.trim().toLowerCase(); return TRUE.has(v) ? true : FALSE.has(v) ? false : raw; }
    case 'map': return Object.prototype.hasOwnProperty.call(field.values, raw.trim()) ? field.values[raw.trim()] : raw;
    case 'list': return split(raw, field.separator);
    case 'images': return split(raw, field.separator).map((src, position) => ({ src, position }));
    case 'refs': return split(raw, field.separator).map((ref) => ref.replace(/^id:/i, ''));
    default: return raw;
  }
}

// Header index by normalized name; the first alias present wins.
function indexHeader(header) {
  const byName = new Map();
  header.forEach((name, i) => { const n = normalizeHeaderName(name); if (!byName.has(n)) byName.set(n, i); });
  return (aliases) => {
    for (const a of [].concat(aliases)) { const i = byName.get(normalizeHeaderName(a)); if (i !== undefined) return i; }
    return -1;
  };
}

// Reads one cell; null when the cell is absent (blank, unless the file quotes present empties).
function cellReader(policy) {
  return (row, i) => {
    if (i < 0 || i >= row.values.length) return null;
    const v = row.values[i];
    if (v !== '') return v;
    return policy === EMPTY_POLICY.PRESENT_IF_QUOTED && row.quoted?.[i] ? '' : null;
  };
}

// Compiles a vendor role into a row -> record function plus the columns it consumes.
function compileRole(role, header, policy) {
  const find = indexHeader(header);
  const cell = cellReader(policy);
  const used = new Set();
  const fields = role.fields.map((f) => { const i = find(f.from); if (i >= 0) used.add(i); return { f, i }; });
  const attrs = [];
  if (role.attributes) {
    for (let n = 1; ; n += 1) {
      const col = (key) => (role.attributes[key] ? find(role.attributes[key].replace('{n}', n)) : -1);
      const a = { name: col('name'), values: col('values'), visible: col('visible'), global: col('global'), default: col('default'), position: n - 1 };
      if (a.name < 0) break;
      for (const k of ['name', 'values', 'visible', 'global', 'default']) if (a[k] >= 0) used.add(a[k]);
      attrs.push(a);
    }
  }
  const meta = role.meta ? header.map((h, i) => (String(h).startsWith(role.meta.prefix) ? { key: String(h).slice(role.meta.prefix.length), i } : null)).filter(Boolean) : [];
  for (const m of meta) used.add(m.i);
  const derived = (role.derived || []).map((d) => { const i = find(d.from); if (i >= 0) used.add(i); return { d, i }; });
  const disc = role.child ? find(role.child.discriminator.from) : -1;
  const parentRef = role.child ? find(role.child.parentRef.from) : -1;
  if (disc >= 0) used.add(disc);
  if (parentRef >= 0) used.add(parentRef);
  const childValues = new Set((role.child?.discriminator.values || []).map((v) => String(v).toLowerCase()));

  function isChild(row) { const v = cell(row, disc); return v !== null && childValues.has(v.trim().toLowerCase()); }

  function build(row, { child = false } = {}) {
    const rec = {};
    for (const { f, i } of fields) {
      const raw = cell(row, i);
      if (raw === null) continue;
      if (child && f.childTo) {
        if (f.childAs === 'first-image') { const [first] = convert({ ...f, as: 'images' }, raw); if (first) setPath(rec, f.childTo, { src: first.src }); }
        else setPath(rec, f.childTo, convert(f, raw));
        continue;
      }
      if (raw === '' && (f.as || 'string') !== 'string') continue;
      setPath(rec, f.to, convert(f, raw));
      for (const [k, v] of Object.entries(f.alsoSet || {})) setPath(rec, k, v);
    }
    if (attrs.length) {
      const list = [];
      const sep = role.attributes.separator;
      for (const a of attrs) {
        const name = cell(row, a.name);
        if (!name) continue;
        const values = cell(row, a.values);
        if (child) { list.push({ name, option: values || '' }); continue; }
        const item = { name, position: a.position, options: values ? split(values, sep) : [] };
        const visible = cell(row, a.visible);
        if (visible !== null && visible !== '') item.visible = convert({ as: 'bool' }, visible);
        const global = cell(row, a.global);
        if (global !== null && global !== '') item.global = convert({ as: 'bool' }, global);
        const def = cell(row, a.default);
        if (def) item.default = def;
        list.push(item);
      }
      if (list.length) setPath(rec, role.attributes.to, list);
    }
    const metaRows = meta.map((m) => ({ key: m.key, value: cell(row, m.i) })).filter((m) => m.value !== null && m.value !== '');
    if (metaRows.length) setPath(rec, role.meta.to, metaRows);
    const extra = {};
    header.forEach((h, i) => { if (!used.has(i)) { const v = cell(row, i); if (v !== null && v !== '') extra[h] = v; } });
    if (Object.keys(extra).length) rec._csv = extra;
    return rec;
  }

  return { build, isChild, parentRef: (row) => { const v = cell(row, parentRef); return v ? v.trim().replace(/^id:/i, '') : null; }, derived, cell };
}

// Distinct values of a taxonomy column: categories with ancestors (depth-ascending), tags once
// each (case-insensitive, first spelling kept). Records are keyed by path / name.
function createTaxonomy(d) {
  const byKey = new Map();
  return {
    d,
    add(raw) {
      const links = [];
      for (const value of split(raw, d.separator)) {
        if (d.hierarchy) {
          const parts = value.split(d.hierarchy).map((p) => p.trim()).filter(Boolean);
          for (let i = 0; i < parts.length; i += 1) {
            const key = parts.slice(0, i + 1).join(` ${d.hierarchy} `);
            if (!byKey.has(key)) byKey.set(key, { id: key, name: parts[i], parent: i ? parts.slice(0, i).join(` ${d.hierarchy} `) : null, depth: i });
          }
          if (parts.length) { const leaf = byKey.get(parts.join(` ${d.hierarchy} `)); links.push({ id: leaf.id, name: leaf.name }); }
        } else {
          const key = value.toLowerCase();
          if (!byKey.has(key)) byKey.set(key, { id: value, name: value });
          const rec = byKey.get(key);
          links.push({ id: rec.id, name: rec.name });
        }
      }
      return links;
    },
    records() {
      return [...byKey.values()].sort((a, b) => (a.depth || 0) - (b.depth || 0)).map(({ depth, ...rec }) => rec);
    },
  };
}

function readJsonIfExists(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function createCsvExtractor({ projectDir, schema, catalog = loadCsvCatalog(), sampleSize = DEFAULT_SAMPLE_SIZE, ledger = require('../../../lib/extract-ledger.js'), now = () => new Date() } = {}) {
  if (!projectDir) throw codedError('extract_project_required', 'projectDir is required');
  projectDir = path.resolve(projectDir);
  const theSchema = schema || readJsonIfExists(path.join(projectDir, 'source-schema.json'));
  const meta = theSchema?.sourceMeta;
  if (!meta || !Array.isArray(meta.sourceFiles)) throw codedError('csv_source_files_missing', 'source-schema.json has no sourceMeta.sourceFiles');
  const inputRoot = path.resolve(projectDir, meta.csvInputRoot || 'inputs');
  const dialect = meta.dialect || {};

  // One logical stream per primary file: its own path plus the parts that continue it (partOf).
  const streams = meta.sourceFiles.filter((f) => !f.partOf).map((f) => ({
    role: f.role,
    vendor: f.vendor || meta.vendor?.name || 'custom',
    layout: f.layout || { pattern: 'flat' },
    files: [f, ...meta.sourceFiles.filter((p) => p.partOf === f.file)].map((p) => path.join(inputRoot, p.file)),
  }));

  function roleReader(stream) {
    const v = catalog.vendors?.[stream.vendor];
    const role = v?.roles?.[stream.role];
    return role ? { platform: v.platform, role } : null;
  }

  async function* rows(stream) {
    for (const file of stream.files) {
      let header = null;
      for await (const row of streamRows(file, { delimiter: dialect.delimiter || null, encoding: dialect.encoding || null, trackQuoted: dialect.emptyPolicy === EMPTY_POLICY.PRESENT_IF_QUOTED })) {
        if (!header) { header = row.values; continue; }
        yield { header, row };
      }
    }
  }

  function outputs(dir, ids) {
    fs.mkdirSync(dir, { recursive: true });
    const out = {};
    for (const id of ids) { const final = path.join(dir, `${id}.ndjson`); fs.rmSync(`${final}.part`, { force: true }); out[id] = { final, writer: ndjson.createAppender(`${final}.part`) }; }
    return out;
  }
  function commit(out) {
    for (const o of Object.values(out)) { if (!fs.existsSync(`${o.writer.file}`)) fs.writeFileSync(o.writer.file, ''); fs.renameSync(o.writer.file, o.final); }
  }
  function discard(out) { for (const o of Object.values(out)) fs.rmSync(o.writer.file, { force: true }); }

  // A known vendor role: one record per row; child rows (Woo variations) go to the child entity
  // with their parent id. A Parent cell may name the parent by id or by SKU, and a child may come
  // before its parent, so a first pass indexes parents and their children.
  async function readVendorRole(stream, { role }, { sample }) {
    const dir = path.join(projectDir, OUT_DIR, ...(sample ? ['sample'] : []));
    const childId = role.child?.entity;
    const derivedIds = (role.derived || []).map((d) => d.entity);
    const out = outputs(dir, [role.entity, ...(childId ? [childId] : []), ...derivedIds]);
    try {
      let compiled = null;
      let lastHeader = null;
      const compile = (header) => { if (header !== lastHeader) { compiled = compileRole(role, header, dialect.emptyPolicy); lastHeader = header; } return compiled; };
      const skuToId = new Map();
      const childrenOf = new Map();
      if (role.child) {
        const parents = [];
        for await (const { header, row } of rows(stream)) {
          const c = compile(header);
          const rec = c.build(row, { child: c.isChild(row) });
          if (c.isChild(row)) parents.push([c.parentRef(row), rec[role.keyField]]);
          else if (rec.sku) skuToId.set(String(rec.sku), rec[role.keyField]);
        }
        for (const [ref, id] of parents) {
          const parentKey = ref === null ? null : skuToId.has(ref) ? String(skuToId.get(ref)) : ref;
          if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
          childrenOf.get(parentKey).push(id);
        }
      }
      const taxonomies = (role.derived || []).map((d) => createTaxonomy(d));
      const keep = sample ? new Set() : null;
      const counts = Object.fromEntries(Object.keys(out).map((k) => [k, 0]));
      for await (const { header, row } of rows(stream)) {
        const c = compile(header);
        if (role.child && c.isChild(row)) {
          const rec = c.build(row, { child: true });
          const ref = c.parentRef(row);
          const parentId = ref === null ? null : skuToId.has(ref) ? skuToId.get(ref) : (/^\d+$/.test(ref) ? Number(ref) : ref);
          if (sample && !keep.has(String(parentId))) continue;
          setPath(rec, role.child.parentRef.field, parentId);
          out[childId].writer.append(rec); counts[childId] += 1;
          continue;
        }
        if (sample && keep.size >= sampleSize) continue;
        const rec = c.build(row);
        for (const [i, t] of taxonomies.entries()) {
          const raw = c.cell(row, c.derived[i].i);
          if (raw) setPath(rec, t.d.field, t.add(raw));
        }
        if (role.child?.listField) {
          const kids = childrenOf.get(String(rec[role.keyField])) || (rec.sku ? childrenOf.get(String(rec.sku)) : null);
          if (kids?.length) setPath(rec, role.child.listField, kids);
        }
        if (sample) keep.add(String(rec[role.keyField]));
        out[role.entity].writer.append(rec); counts[role.entity] += 1;
      }
      for (const t of taxonomies) { const recs = t.records(); out[t.d.entity].writer.appendAll(recs); counts[t.d.entity] += recs.length; }
      commit(out);
      return { files: Object.fromEntries(Object.entries(out).map(([k, o]) => [k, o.final])), counts, keyField: role.keyField };
    } catch (error) { discard(out); throw error; }
  }

  // Unknown vendor: one record per row group, columns verbatim (blank cells omitted); a grouped
  // layout's continuation rows ride on the head record as `rows`.
  async function readGeneric(stream, { sample }) {
    const dir = path.join(projectDir, OUT_DIR, ...(sample ? ['sample'] : []));
    const entity = stream.role;
    const out = outputs(dir, [entity]);
    const layout = stream.layout;
    const keyField = layout.pattern === 'grouped-by-key' ? layout.groupKey : '_row';
    try {
      let current = null, previousKey = null, n = 0, rowNo = 0;
      const flush = () => { if (current && !(sample && n >= sampleSize)) { out[entity].writer.append(current); n += 1; } current = null; };
      for await (const { header, row } of rows(stream)) {
        rowNo += 1;
        const rec = {};
        header.forEach((h, i) => { const v = row.values[i]; if (v !== undefined && v !== '') rec[h] = v; });
        if (layout.pattern === 'grouped-by-key') {
          const ki = header.indexOf(layout.groupKey);
          const key = ki >= 0 ? row.values[ki] || '' : '';
          const starts = layout.continuation === 'blank-key' ? key !== '' : key !== previousKey;
          previousKey = key;
          if (starts || !current) { flush(); current = rec; continue; }
          (current.rows ||= []).push(rec);
          continue;
        }
        flush();
        current = { _row: rowNo, ...rec };
      }
      flush();
      commit(out);
      return { files: { [entity]: out[entity].final }, counts: { [entity]: n }, keyField };
    } catch (error) { discard(out); throw error; }
  }

  function writeManifests(stream, result, platform) {
    const sharedFile = path.join(projectDir, OUT_DIR, 'manifest.json');
    const shared = readJsonIfExists(sharedFile) || { schemaVersion: 1, entities: [] };
    const at = now().toISOString();
    const rows = Object.entries(result.files).map(([entity, file]) => ({
      entity, route: `csv:${stream.role}`, namespace: 'csv', file: path.relative(projectDir, file), count: result.counts[entity], sourceTotal: result.counts[entity],
      children: [], complete: true, sample: false, vendor: stream.vendor, platform: platform || null, sourceFiles: stream.files.map((f) => path.relative(projectDir, f)), extractedAt: at,
    }));
    for (const row of rows) {
      const target = path.join(projectDir, row.file.replace(/\.ndjson$/, '.manifest.json'));
      fs.writeFileSync(`${target}.tmp`, `${JSON.stringify({ schemaVersion: 1, entity: row.entity, file: row.file, rowsWritten: row.count, snapshotTotal: row.count, complete: true, extractedAt: at }, null, 2)}\n`);
      fs.renameSync(`${target}.tmp`, target);
    }
    const names = new Set(rows.map((r) => r.entity));
    shared.entities = [...shared.entities.filter((e) => !names.has(e.entity)), ...rows];
    shared.updatedAt = at;
    fs.writeFileSync(`${sharedFile}.tmp`, `${JSON.stringify(shared, null, 2)}\n`);
    fs.renameSync(`${sharedFile}.tmp`, sharedFile);
    return rows;
  }

  // Every entity a role writes, for --entity and the plan's scope.
  function entitiesOf(stream) {
    const r = roleReader(stream);
    if (!r) return [stream.role];
    return [r.role.entity, ...(r.role.child ? [r.role.child.entity] : []), ...(r.role.derived || []).map((d) => d.entity)];
  }

  async function extractStream(stream, { sample = false } = {}) {
    const reader = roleReader(stream);
    const result = reader ? await readVendorRole(stream, reader, { sample }) : await readGeneric(stream, { sample });
    if (sample) return Object.entries(result.counts).map(([entity, count]) => ({ entity, count, sample: true }));
    const rowsOut = writeManifests(stream, result, reader?.platform);
    for (const row of rowsOut) {
      await ledger.recordExtract(projectDir, { entity: row.entity, extractPath: row.file, keyField: row.entity === reader?.role.entity || row.entity === reader?.role.child?.entity ? result.keyField : (reader ? 'id' : result.keyField), recordedBy: 'csv-extractor', now: now() });
    }
    return rowsOut;
  }

  // ids: entity ids to (re)write; a role is read once when any of its entities is wanted.
  async function extractAll(ids = null, { sample = false } = {}) {
    const results = [];
    for (const stream of streams) {
      const mine = entitiesOf(stream);
      if (ids && !mine.some((id) => ids.includes(id))) continue;
      try {
        for (const row of await extractStream(stream, { sample })) results.push({ status: 'extracted', entity: row.entity, count: row.count });
      } catch (error) {
        for (const entity of mine) results.push({ status: 'failed', entity, code: error.code || 'csv_read_failed', error: String(error.message).slice(0, 200) });
      }
    }
    return results;
  }

  return { streams, entitiesOf, extractAll, platformOf: (stream) => roleReader(stream)?.platform || null };
}

module.exports = { CATALOG_FILE, loadCsvCatalog, validateCsvCatalog, createCsvExtractor, compileRole };
