'use strict';

// Builds migrations/<project>/source-schema.json from the WordPress / WooCommerce raw capture.
//
// Before this module the skill told the agent to "synthesize" the file, so each run wrote its own
// script and picked its own entity keys.
// The capture shape is ours, so the toolkit owns the build:
//   - one entity per sampled route file in data/wp-discovery/*.md (routes that became a
//     source-coverage row are evidence, not entities, and are listed in sourceMeta instead);
//   - stable keys: reader-catalog id (product, product-category, post, ...), then the plugin
//     profile ref `plugin.<slug>.<entity>`, then the plugin-coverage generic entity name, then
//     `store-api-<catalog id>` for a public Store API duplicate (`store-api.<name>` when the
//     catalog has no twin), else the raw file's base name;
//   - fields from the route's OPTIONS schema plus the first sample record; example values only
//     for non-personal scalars that are not secret-shaped;
//   - relations from the record's `_links`, then the reader-catalog defaults
//     (catalog-schema-defaults.js);
//   - counts and observed meta keys from data/source-extract when the catalog extract has run.
// The agent adds only what the toolkit cannot know (assumptions, unknowns, notes, entities from
// other evidence). Those additions survive a rebuild: mergeAgentAdditions keeps every key the
// builder does not produce.

const fs = require('node:fs');
const path = require('node:path');
const { loadCatalog } = require('./reader-catalog.js');
const { applyCatalogSchemaDefaults } = require('./catalog-schema-defaults.js');
const { isSecretShaped } = require('./secret-value-guard.js');

const RAW_DIR = 'data/wp-discovery';
const EXTRACT_DIR = 'data/source-extract';
const PROFILES_DIR = path.join(__dirname, '..', 'plugins');
const BUILDER = 'rp-source-wordpress/scripts/wp-source-schema.js';

const PII_ENTITY = /customer|order|refund|subscriber|review|comment|contact|feedback|user|entry|booking/i;
const PII_FIELD = /email|phone|address|billing|shipping|first_name|last_name|username|name$|author_name|reviewer|ip|user_agent|customer|password|token|key|secret|avatar|company|postcode|city|note/i;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function escapeRe(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function bulletValue(md, label) {
  const m = md.match(new RegExp(`^- ${escapeRe(label)}: \`([^\`]*)\``, 'm'));
  return m ? m[1] : null;
}

function section(md, title) {
  const start = md.indexOf(`\n## ${title}`);
  if (start < 0) return '';
  const rest = md.slice(start + title.length + 4);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
}

function jsonBlock(text) {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (m) { try { return JSON.parse(m[1]); } catch { return null; } }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { return JSON.parse(trimmed); } catch { return null; } }
  return null;
}

// Reads one entity file written by wp-discovery.js renderEntityFile (plus its optional
// "Source binding" block for bridge entities).
function parseEntityFile(md) {
  const countRaw = bulletValue(md, 'Record count');
  const inUseRaw = bulletValue(md, 'In use');
  const recordCount = countRaw && /^\d+$/.test(countRaw) ? Number(countRaw) : null;
  let inUse = null;
  if (inUseRaw === 'yes') inUse = true;
  else if (inUseRaw && inUseRaw.startsWith('no')) inUse = false;
  else if (recordCount === 0) inUse = false;
  const samplesRaw = jsonBlock(section(md, 'Sample Records'));
  const samples = (Array.isArray(samplesRaw) ? samplesRaw : samplesRaw ? [samplesRaw] : [])
    .filter((s) => s && typeof s === 'object' && !Array.isArray(s));
  const relationships = [];
  for (const line of section(md, 'Relationships').split('\n')) {
    const m = line.match(/^- `([^`]+)`(?: \(embeddable\))? → (.*)$/);
    if (m) relationships.push({ rel: m[1], hrefs: m[2].split(', ').filter(Boolean) });
  }
  return {
    name: (md.match(/^# (.+)$/m) || [])[1] || null,
    namespace: bulletValue(md, 'Namespace'),
    route: bulletValue(md, 'Route'),
    category: bulletValue(md, 'Discovery category'),
    rule: bulletValue(md, 'Discovery rule'),
    reason: (md.match(/^- Discovery reason: (.+)$/m) || [])[1] || null,
    includedByOverride: bulletValue(md, 'Included by override') === 'yes',
    recordCount,
    inUse,
    schema: jsonBlock(section(md, 'Schema')),
    samples,
    relationships,
    notes: section(md, 'Notes').split('\n').filter((l) => l.startsWith('- ') && l !== '- None').map((l) => l.slice(2)),
    binding: jsonBlock(section(md, 'Source binding')),
  };
}

function typeOf(t) {
  if (Array.isArray(t)) return t.filter((x) => x !== 'null').join('|') || 'null';
  return t || 'unknown';
}

function sampleType(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function exampleOf(value, key, piiEntity) {
  if (piiEntity || PII_FIELD.test(key)) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length > 0 && value.length <= 80 && !/<|https?:/.test(value) && !isSecretShaped(value)) return value;
  return undefined;
}

// Bridge entities (wix-wp-plugin-v2) describe a database table: { table, columns: [{ name, type,
// nullable, key }] }. Read it as a property map so both shapes build the same field rows.
function dbType(sqlType) {
  const t = String(sqlType || '').toLowerCase();
  if (/^(tiny|small|medium|big)?int\b|^int\(/.test(t)) return 'integer';
  if (/^(decimal|float|double|numeric)/.test(t)) return 'number';
  return 'string';
}

function propertiesOf(schema) {
  if (schema && Array.isArray(schema.columns)) {
    return Object.fromEntries(schema.columns.filter((c) => c && c.name).map((c) => [c.name, {
      type: dbType(c.type), dbType: c.type, required: c.nullable === false, primary: c.key === 'primary',
    }]));
  }
  return (schema && schema.properties) || {};
}

function primaryKeyOf(schema, samples) {
  if (schema && Array.isArray(schema.columns)) {
    const primary = schema.columns.find((c) => c && c.key === 'primary');
    if (primary) return primary.name;
  }
  if (schema && schema.properties && schema.properties.id) return 'id';
  return samples[0] && 'id' in samples[0] ? 'id' : null;
}

function buildFields(schema, samples, piiEntity) {
  const props = propertiesOf(schema);
  const sample = samples[0] || null;
  const keys = new Set(Object.keys(props));
  if (sample) for (const k of Object.keys(sample)) if (k !== '_links' && k !== '_embedded') keys.add(k);
  const fields = {};
  for (const k of keys) {
    const p = props[k] || {};
    const field = { type: p.type ? typeOf(p.type) : (sample && k in sample ? sampleType(sample[k]) : 'unknown') };
    if (p.required === true) field.required = true;
    if (p.readonly === true) field.readonly = true;
    if (p.dbType) field.dbType = p.dbType;
    if (p.format) field.format = p.format;
    if (Array.isArray(p.enum) && p.enum.length <= 30) field.enum = p.enum;
    if (p.description) field.description = String(p.description).slice(0, 160);
    if (!props[k]) field.inSchema = false;
    if (k === 'id' || p.primary) field.identifier = true;
    if (/content|description|excerpt|caption/.test(k)) field.richText = true;
    const sub = p.properties || (p.items && p.items.properties);
    if (sub) field.subfields = Object.fromEntries(Object.entries(sub).map(([sk, sv]) => [sk, typeOf(sv && sv.type)]));
    if (sample && k in sample) {
      const example = exampleOf(sample[k], k, piiEntity);
      if (example !== undefined) field.example = example;
    }
    fields[k] = field;
  }
  return fields;
}

const LINK_RELATIONS = {
  author: ['author', 'user', 'many-to-one'],
  replies: ['id', 'comment', 'one-to-many'],
  'wp:attachment': ['id', 'media', 'one-to-many'],
  'wp:featuredmedia': ['featured_media', 'media', 'many-to-one'],
  up: ['parent', null, 'many-to-one'],
};

function buildRelations(relationships, selfKey) {
  const out = [];
  for (const { rel, hrefs } of relationships) {
    if (rel === 'wp:term') {
      for (const href of hrefs) {
        const m = href.match(/wp\/v2\/([a-z0-9_-]+)\?post=/i);
        if (!m) continue;
        const tax = m[1];
        const target = tax === 'categories' ? 'category' : tax === 'tags' ? 'tag' : tax;
        out.push({ field: tax, targetEntity: target, cardinality: 'many-to-many', evidence: '_links.wp:term' });
      }
      continue;
    }
    const known = LINK_RELATIONS[rel];
    if (known) out.push({ field: known[0], targetEntity: known[1] || selfKey, cardinality: known[2], evidence: `_links.${rel}` });
  }
  return out;
}

function loadProfiles(dir = PROFILES_DIR) {
  const byRoute = new Map();
  if (!fs.existsSync(dir)) return byRoute;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const profile = readJson(path.join(dir, file));
    if (!profile || !profile.plugin || !Array.isArray(profile.entities)) continue;
    for (const entity of profile.entities) {
      if (entity && typeof entity.route === 'string' && !byRoute.has(entity.route)) byRoute.set(entity.route, { profile, entity });
    }
  }
  return byRoute;
}

function observedMetaKeys(file) {
  if (!fs.existsSync(file)) return null;
  const counts = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    for (const m of Array.isArray(record && record.meta_data) ? record.meta_data : []) {
      if (m && typeof m.key === 'string') counts.set(m.key, (counts.get(m.key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
}

function extractEntities(manifest) {
  const out = new Map();
  const visit = (rows) => {
    for (const row of rows || []) {
      if (!row || !row.entity) continue;
      out.set(row.entity, row);
      visit(row.children);
    }
  };
  visit(manifest && manifest.entities);
  return out;
}

function buildSourceSchema(projectDir, options = {}) {
  const raw = path.join(projectDir, RAW_DIR);
  if (!fs.existsSync(raw)) {
    const error = new Error(`no WordPress capture at ${RAW_DIR}/; run wp-discovery.js first`);
    error.code = 'capture_missing';
    throw error;
  }
  const catalog = options.catalog || loadCatalog();
  const profiles = options.profiles || loadProfiles();
  const coverage = readJson(path.join(raw, 'plugin-coverage.json'), {}) || {};
  const sourceCoverage = readJson(path.join(raw, 'source-coverage.json'), { rows: [] }) || { rows: [] };
  const extractDir = path.join(projectDir, EXTRACT_DIR);
  const manifest = readJson(path.join(extractDir, 'manifest.json'));
  const extracted = extractEntities(manifest);

  const coverageFiles = new Set((sourceCoverage.rows || [])
    .map((r) => String((r.evidence && r.evidence.artifact) || '').split('/').pop()).filter(Boolean));
  const capabilityByEntity = new Map();
  for (const c of coverage.capabilities || []) for (const se of c.sourceEntities || []) if (!capabilityByEntity.has(se)) capabilityByEntity.set(se, c);
  const genericByRoute = new Map((coverage.genericEntities || []).filter((g) => g && g.route).map((g) => [g.route, g]));
  const catalogByRoute = new Map((catalog.entities || []).filter((e) => e.route).map((e) => [e.route, e]));

  const entities = {};
  const excluded = [];
  const files = fs.readdirSync(raw).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  for (const file of files) {
    if (coverageFiles.has(file)) { excluded.push({ file, reason: 'source-coverage row' }); continue; }
    const parsed = parseEntityFile(fs.readFileSync(path.join(raw, file), 'utf8'));
    const { route, namespace } = parsed;
    const cat = route ? catalogByRoute.get(route) : null;
    const prof = route ? profiles.get(route) : null;
    const gen = route ? genericByRoute.get(route) : null;
    const binding = parsed.binding && parsed.binding.sourceEntityRef ? parsed.binding : null;
    const storeCanonical = namespace === 'wc/store' && route ? catalogByRoute.get(route.replace('/wc/store/v1/', '/wc/v3/')) : null;
    const base = file.replace(/\.md$/, '');
    let key;
    if (binding) key = binding.sourceEntityRef;
    else if (cat) key = cat.id;
    else if (prof) key = `plugin.${prof.profile.plugin}.${prof.entity.entity}`;
    else if (gen && gen.entity) key = gen.entity;
    else if (storeCanonical) key = `store-api-${storeCanonical.id}`;
    else if (namespace === 'wc/store' && route) key = `store-api.${route.split('/').filter(Boolean).pop()}`;
    else key = base;
    if (entities[key]) key = base;

    const piiEntity = PII_ENTITY.test(key) || PII_ENTITY.test(route || '');
    const row = {
      name: parsed.name,
      rawFile: file,
      route,
      recordCount: parsed.recordCount,
      inUse: parsed.inUse,
      primaryKey: primaryKeyOf(parsed.schema, parsed.samples),
      fields: buildFields(parsed.schema, parsed.samples, piiEntity),
      relations: buildRelations(parsed.relationships, key),
      sourceMeta: { restNamespace: namespace, discoveryCategory: parsed.category, discoveryRule: parsed.rule },
    };
    const meta = row.sourceMeta;
    if (parsed.includedByOverride) Object.assign(meta, { includedByOverride: true, originalDiscoveryCategory: parsed.category, overrideReason: parsed.reason });
    if (parsed.notes.length) meta.notes = parsed.notes;
    if (parsed.inUse === false) meta.flag = 'advertised-but-empty';
    if (cat) {
      meta.readerCatalogId = cat.id;
      if (cat.target) meta.candidateTargetRefs = [cat.target];
    }
    if (storeCanonical) meta.publicDuplicateOf = storeCanonical.id;
    if (prof) {
      const cap = capabilityByEntity.get(prof.entity.entity);
      Object.assign(meta, {
        plugin: prof.profile.plugin,
        recognized: true,
        profileVersion: prof.profile.profileVersion || null,
        channel: prof.entity.channel || null,
        capability: cap ? cap.capability : null,
        candidateTargetRefs: prof.entity.candidateTargetRefs || (cap && cap.targetRefs) || [],
      });
      // rp-import-codegen's read contract finds a declared non-GET / fragmented read only here.
      for (const k of ['requestMethod', 'requestBody', 'responseFragmentGroupSize']) if (prof.entity[k] !== undefined) meta[k] = prof.entity[k];
    }
    if (gen) {
      Object.assign(meta, {
        origin: gen.origin,
        recognized: false,
        channel: gen.channel,
        sourcePostType: gen.sourcePostType,
        sourceTaxonomy: gen.sourceTaxonomy,
        displayName: gen.displayName,
        attachedToTypes: gen.attachedToTypes,
        capability: gen.proposedCapability,
        capabilityConfidence: gen.capabilityConfidence,
        candidateTargetRefs: gen.candidateTargetRefs || [],
      });
      if (gen.hierarchical) row.hierarchical = true;
    }
    if (binding) {
      row.sourceEntityRef = binding.sourceEntityRef;
      row.bridgeDesignated = true;
      Object.assign(meta, binding.sourceMeta || {});
    }
    if (row.fields.parent && parsed.samples.some((s) => Number(s.parent) > 0)) row.hierarchical = true;
    const ex = extracted.get(key);
    if (ex) {
      meta.catalogExtract = { entity: ex.entity, count: ex.count ?? null, sourceTotal: ex.sourceTotal ?? null, complete: ex.complete ?? null, file: ex.file ? path.posix.join(EXTRACT_DIR, path.basename(ex.file)) : null };
    }
    if (row.fields.meta_data) {
      const extractKeys = observedMetaKeys(path.join(extractDir, `${key}.ndjson`));
      const sampleKeys = [...new Set(parsed.samples.flatMap((s) => (Array.isArray(s.meta_data) ? s.meta_data : []).map((m) => m && m.key).filter((k) => typeof k === 'string')))];
      Object.assign(row.fields.meta_data, {
        path: 'meta_data[].value',
        dynamic: true,
        selector: { keyPath: 'meta_data[].key' },
        observedKeys: extractKeys || sampleKeys,
        observedKeysBasis: extractKeys ? 'catalog-extract (all records)' : 'discovery samples',
      });
    }
    entities[key] = row;
  }

  const schema = {
    platform: 'wordpress',
    platformVersion: null,
    sourceUrl: coverage.baseUrl || null,
    capturedAt: coverage.generatedAt || sourceCoverage.generatedAt || null,
    rawDiscovery: `${RAW_DIR}/`,
    builtBy: BUILDER,
    sourceMeta: {
      woocommerce: Object.values(entities).some((e) => /^wc\//.test(e.sourceMeta.restNamespace || '')),
      pluginListAvailable: coverage.pluginListAvailable ?? null,
      catalogExtract: manifest ? `${EXTRACT_DIR}/manifest.json` : null,
      excludedFromEntities: excluded,
    },
    entities,
    assumptions: [],
    unknowns: [],
  };
  const catalogDefaults = applyCatalogSchemaDefaults(schema, catalog);
  // Catalog children (product-variation) are added by the defaults without counts; the extract has them.
  for (const [key, row] of Object.entries(schema.entities)) {
    if (row.recordCount !== null || row.sourceMeta?.origin !== 'reader-catalog-child') continue;
    const ex = extracted.get(key);
    if (!ex || typeof ex.count !== 'number') continue;
    row.recordCount = ex.count;
    row.inUse = ex.count > 0;
    const keys = observedMetaKeys(path.join(extractDir, `${key}.ndjson`));
    if (keys) row.sourceMeta.observedMetaKeys = keys;
  }
  return { schema, report: { entities: Object.keys(schema.entities).length, excluded: excluded.length, catalogDefaults } };
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// Keeps what the agent added to an earlier source-schema.json: every key the builder does not
// produce (top level, per entity, per field, in sourceMeta), extra entities, and the union of
// assumptions / unknowns. Values the builder produces always come from the capture.
function mergeAgentAdditions(built, previous) {
  if (!isPlainObject(previous)) return built;
  const merged = { ...built };
  for (const [k, v] of Object.entries(previous)) {
    if (k === 'entities') continue;
    if (k === 'assumptions' || k === 'unknowns') {
      const seen = new Set((built[k] || []).map((x) => JSON.stringify(x)));
      merged[k] = [...(built[k] || []), ...(Array.isArray(v) ? v : []).filter((x) => !seen.has(JSON.stringify(x)))];
    } else if (!(k in built)) merged[k] = v;
    else if (isPlainObject(built[k]) && isPlainObject(v)) merged[k] = { ...v, ...built[k] };
  }
  const prevEntities = isPlainObject(previous.entities) ? previous.entities : {};
  merged.entities = { ...built.entities };
  for (const [key, prevRow] of Object.entries(prevEntities)) {
    const row = built.entities[key];
    if (!row) { merged.entities[key] = prevRow; continue; }
    if (!isPlainObject(prevRow)) continue;
    const out = { ...prevRow, ...row };
    out.fields = { ...(prevRow.fields || {}) };
    for (const [f, def] of Object.entries(row.fields || {})) out.fields[f] = isPlainObject(prevRow.fields?.[f]) ? { ...prevRow.fields[f], ...def } : def;
    out.sourceMeta = { ...(prevRow.sourceMeta || {}), ...(row.sourceMeta || {}) };
    const relKey = (r) => `${r && r.field}|${r && r.targetEntity}`;
    const builtRels = new Set((row.relations || []).map(relKey));
    out.relations = [...(row.relations || []), ...(Array.isArray(prevRow.relations) ? prevRow.relations : []).filter((r) => !builtRels.has(relKey(r)))];
    merged.entities[key] = out;
  }
  return merged;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// Writes source-schema.json (merged with agent additions) plus the two discovery artifacts that
// are plain copies / projections of it: discovery/plugin-coverage.json (verbatim) and
// discovery/entities/<key>.json summaries.
function writeSourceSchema(projectDir, options = {}) {
  const target = path.join(projectDir, 'source-schema.json');
  const previous = readJson(target);
  const { schema, report } = buildSourceSchema(projectDir, options);
  const merged = mergeAgentAdditions(schema, previous);
  writeJsonAtomic(target, merged);
  const written = ['source-schema.json'];
  const coverage = path.join(projectDir, RAW_DIR, 'plugin-coverage.json');
  if (fs.existsSync(coverage)) {
    fs.mkdirSync(path.join(projectDir, 'discovery'), { recursive: true });
    fs.copyFileSync(coverage, path.join(projectDir, 'discovery', 'plugin-coverage.json'));
    written.push('discovery/plugin-coverage.json');
  }
  for (const [key, e] of Object.entries(merged.entities)) {
    const meta = e.sourceMeta || {};
    writeJsonAtomic(path.join(projectDir, 'discovery', 'entities', `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`), {
      entity: key, route: e.route || null, rawFile: e.rawFile || null, recordCount: e.recordCount ?? null, inUse: e.inUse ?? null,
      hierarchical: Boolean(e.hierarchical), fields: Object.keys(e.fields || {}), relations: e.relations || [],
      candidateTargetRefs: meta.candidateTargetRefs || [], plugin: meta.plugin || null, capability: meta.capability || null, origin: meta.origin || null,
    });
  }
  written.push('discovery/entities/');
  return { ...report, kept: previous ? Object.keys(merged.entities).length - Object.keys(schema.entities).length : 0, written };
}

module.exports = { parseEntityFile, buildSourceSchema, mergeAgentAdditions, writeSourceSchema, loadProfiles };
