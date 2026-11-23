'use strict';

// Plan pre-fill.
//
// Writes the predictable part of a mapping plan entity from the ready-made suggestions of the
// source pack (`resources/rp-source-<platform>/wix-map/*.json`), so the mapping AI writes only
// operator changes and the leftovers that need judgment:
//   - fieldMappings: the suggestion rows, copied as they are (same row format as the plan)
//   - one source-archive row for every discovered leaf no other row claims (fixed rule)
//   - discoveryCoverage from the source records, with the selector declarations the rows use
//   - fieldDispositions and verificationMappings, projected by the plan contract (no AI)
//   - recorded choices: row choices stay on their rows; entity-level choices become `choices`
//     on the plan entity, all in the B1 shape (decidedBy "suggestion")
// Each pre-filled entity carries `prefill`: where its rows came from, and the `review` list the
// AI must look at (leftover leaves that are not in the suggestion's standard archive list, such as
// plugin fields). Suggestions never change by themselves; a run edits the copied plan rows.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const contract = require('./mapping-field-contract.js');
const L = require('./source-location.js');
const { buildCmsArchiveCollectionId } = require('./cms-collection-id.js');

const RESOURCES = path.join(__dirname, '..', 'resources');
const ARCHIVE_ROW_ID = 'source-archive';
const PREFILL_VERSION = 1;
// The archive row is not read back with the native entity: the archive step reads its own CMS
// items back. Every pre-filled archive output says so, or the read-back gate refuses the row.
const ARCHIVE_VERIFICATION = Object.freeze({ unverifiableReason: 'Written by the source-archive step (packed CMS items), not by the entity writer; the archive step reads its own items back.' });

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (text) => `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;

// --- suggestions ------------------------------------------------------------------------------

// Two shapes landed in parallel (C1: kind wix-map-suggestion + sourcePlatform; C2: kind
// wix-map-suggestions + sourceSystem + entity-level choices + leftovers). Both are read here.
function normalizeSuggestion(doc, file) {
  if (!doc || !['wix-map-suggestion', 'wix-map-suggestions'].includes(doc.kind)) return null;
  const platform = doc.sourcePlatform || doc.sourceSystem;
  if (!platform || !doc.sourceEntity || !doc.targetRef || !Array.isArray(doc.fieldMappings)) throw new Error(`${file}: suggestion needs sourcePlatform, sourceEntity, targetRef and fieldMappings`);
  const entityChoices = [
    ...(doc.recordFilters || []).flatMap((f) => (f.choices || []).map((c) => ({ ...c, decisionId: f.decisionId || null }))),
    ...(Array.isArray(doc.choices) ? doc.choices : []).map((c) => ({
      name: c.name || c.id,
      value: Object.hasOwn(c, 'value') ? c.value : c.default,
      default: c.default,
      reason: c.reason,
      decidedBy: 'suggestion',
      ...(c.question ? { question: c.question } : {}),
      ...(c.options ? { alternatives: c.options.filter((o) => o !== c.default) } : {}),
      ...(c.forElad !== undefined ? { forElad: c.forElad } : {}),
    })),
  ];
  if (doc.setAside !== undefined && (!doc.setAside || !Object.hasOwn(contract.SET_ASIDE_REASONS, doc.setAside.status) || typeof doc.setAside.action !== 'string' || !doc.setAside.action.trim())) {
    throw new Error(`${file}: setAside needs a status (${Object.keys(contract.SET_ASIDE_REASONS).join(', ')}) and the exact cutover action`);
  }
  return { file, platform, doc, entityChoices };
}

// One source pack serves a platform family: the WordPress adapter discovers a WooCommerce store
// (its source-schema says "wordpress") while the suggestions are written for "woocommerce", and a
// run may record either name. Suggestions match by family, so any name of the family pre-fills.
const PLATFORM_FAMILY = Object.freeze({ woocommerce: 'wordpress' });
const platformFamily = (platform) => PLATFORM_FAMILY[platform] || platform;
function loadSuggestions(platform, { dir = null } = {}) {
  const base = dir || path.join(RESOURCES, `rp-source-${platformFamily(platform)}`, 'wix-map');
  if (!fs.existsSync(base)) return new Map();
  const out = new Map();
  for (const name of fs.readdirSync(base).filter((n) => n.endsWith('.json')).sort()) {
    const s = normalizeSuggestion(JSON.parse(fs.readFileSync(path.join(base, name), 'utf8')), name);
    if (!s || platformFamily(s.platform) !== platformFamily(platform)) continue;
    if (out.has(s.doc.sourceEntity)) throw new Error(`two suggestion files for ${platform} ${s.doc.sourceEntity}: ${out.get(s.doc.sourceEntity).file}, ${name}`);
    out.set(s.doc.sourceEntity, s);
  }
  return out;
}

// --- source leaves ----------------------------------------------------------------------------

function selectorTemplates(rows) {
  const out = new Map();
  for (const row of rows) for (const sel of row.selectors || []) {
    if (!out.has(sel.path)) out.set(sel.path, { path: sel.path, keyPath: sel.keyPath });
  }
  return [...out.values()];
}

// Plain leaf locations over every record, plus, for each selector path the rows use, the keys
// observed with a populated scalar value. Leaves are walked with the same selector templates the
// read-back inventory uses (the coverage's dynamic entries), so a value that is an object or a
// list under a selected key is listed at the exact location the inventory names
// (`meta_data[key=K].value.x`), never as an unkeyed `meta_data[].value.x` the gate cannot match.
function discover(records, selectors) {
  const dynamic = selectors.map((sel) => {
    const t = L.template({ path: sel.path, selector: { keyPath: sel.keyPath } });
    const keys = new Set();
    for (const record of records) {
      for (const item of L.valuesAt(record, t.array)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const key = t.key.reduce((v, s) => (v == null ? undefined : v[s.key]), item);
        const value = item[t.value];
        if (L.scalar(key) && L.populated(value) && (typeof value !== 'object')) keys.add(key);
      }
    }
    return { path: sel.path, dynamic: true, selector: { keyPath: sel.keyPath }, observedKeys: [...keys].sort() };
  });
  // Only the entries that reach the coverage (observed keys) become inventory templates.
  const observed = dynamic.filter((d) => d.observedKeys.length);
  const templates = observed.map((d) => L.template(d));
  const selected = new Set(observed.flatMap((d, i) => d.observedKeys.map((k) => L.selected(templates[i], k))));
  const walked = new Set();
  for (const record of records) L.leafLocations(record, { templates }, walked);
  // A selected scalar value is the dynamic entry's own key, not a plain leaf.
  const leaves = [...walked].filter((p) => !selected.has(p)).sort();
  return { leaves, dynamic };
}

function topKey(location) {
  return L.parse(location)[0].key;
}
function reviewGroups(paths, standard, archiveSelectors) {
  const known = new Set([...standard].map(topKey).concat(['_links']));
  const groups = new Map();
  for (const p of paths) {
    const k = topKey(p);
    if (known.has(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = [...groups].map(([group, leaves]) => ({ group, leaves: leaves.length, sample: leaves.slice(0, 3) }));
  for (const s of archiveSelectors) out.push({ group: `${s.path} keys`, leaves: s.keys.length, sample: s.keys.slice(0, 5) });
  return out;
}

// --- one entity -------------------------------------------------------------------------------

function archiveRowFrom(suggestion, entityName) {
  const doc = suggestion.doc;
  const suggested = doc.fieldMappings.find((row) => row.id === ARCHIVE_ROW_ID);
  if (suggested) return clone(suggested);
  const leftovers = doc.leftovers || {};
  return {
    id: ARCHIVE_ROW_ID,
    sourcePaths: [],
    disposition: 'cms',
    reason: leftovers.reason || 'No native Wix field holds these source values; each is kept per field in the private source-archive CMS collection.',
    evidence: ['resources/rp-target-wix/lib/source-archive.js PACKED_ARCHIVE_FIELDS', `suggestion ${suggestion.file} leftovers`],
    transform: leftovers.transform || { kind: 'helper', name: 'source-archive.buildArchiveRecord', revision: 'source-archive-retention-v1', arguments: { sourceEntity: entityName, sourceKeyPath: doc.primaryKey || 'id' } },
    valuePolicy: { missing: { action: 'omit-output' }, null: { action: 'omit-output' }, empty: { action: 'omit-output' }, zero: { action: 'archive-as-is' }, invalid: { action: 'archive-as-is' }, unknown: { action: 'omit-output' } },
    examples: [{ id: `${entityName}-archive-1`, input: { id: 3 }, expected: [{ outputId: 'records', writeOperation: 'insertDataItem', values: [{ 3: { fields: {} } }] }] }],
    outputs: [{ id: 'records', sourcePaths: [], targetRef: 'cms/data-item', writeOperation: 'insertDataItem', targetPath: 'data.records', storage: {}, verification: { ...ARCHIVE_VERIFICATION } }],
  };
}

// A suggestion whose writes need something the toolkit cannot make yet (a setup step with no
// executor) declares `setAside: { status, action, listFields, maxListed? }`. An entity with
// records is then pre-filled as a typed set-aside (mapping-field-contract SET_ASIDE_REASONS): the
// run defers it up front, nothing plans its setup, and the completion report gives the Cutover
// Operator one task naming every record. Remove the declaration when the executor ships.
const SET_ASIDE_MAX_LISTED = 100;
function setAsideDetail(setAside, records, sourceFile) {
  const fields = Array.isArray(setAside.listFields) ? setAside.listFields : [];
  const max = Number.isSafeInteger(setAside.maxListed) ? setAside.maxListed : SET_ASIDE_MAX_LISTED;
  const line = (r) => fields.map((f) => { const v = L.valuesAt(r, f)[0]; if (v === undefined || v === null || v === '') return null; return typeof v === 'boolean' ? `${f} ${v ? 'yes' : 'no'}` : `${f} ${v}`; }).filter(Boolean).join(', ');
  const listed = records.slice(0, max).map((r, i) => `(${i + 1}) ${line(r) || `record ${i + 1}`}`);
  const more = records.length > max ? ` ...and ${records.length - max} more, listed in ${sourceFile || 'the source extract'}.` : '';
  return `${String(setAside.action).trim()} The ${records.length} source records: ${listed.join('; ')}.${more}`;
}
function setAsideEntity(suggestion, records, { entityName, sourceFile, header, operatorRows }) {
  const doc = suggestion.doc;
  const [targetDomain, targetEntity] = doc.targetRef.split('/');
  const entity = {
    sourceEntity: entityName,
    sourceSystem: suggestion.platform,
    targetRef: doc.targetRef,
    targetDomain,
    targetEntity,
    primaryKey: doc.primaryKey || (doc.matchKey && doc.matchKey.sourceKey) || 'id',
    sourceRecordCount: records.length,
    inUse: true,
    requiredSourceEntityRefs: [...(doc.requiredSourceEntityRefs || [])],
    ...header,
    fieldMappingStatus: 'pending',
    fieldMappings: [],
    discoveryCoverage: { paths: [], uninspectedAreas: [`Set aside by the toolkit (${doc.setAside.status}); the source records stay in ${sourceFile || 'the source extract'}.`], evidence: [sourceFile ? `${sourceFile} (${records.length} records)` : `${records.length} source records`] },
    limitation: { status: doc.setAside.status, detail: setAsideDetail(doc.setAside, records, sourceFile) },
  };
  const errors = contract.validateEntity(entity);
  const projected = errors.length ? entity : contract.projectEntity(entity);
  projected.prefill = { version: PREFILL_VERSION, suggestion: suggestion.file, setAside: doc.setAside.status, rows: [], operatorRows: [], aiRows: [],
    // Run rows cannot stay on a set-aside entity; they are listed so the drop is visible.
    skippedRows: operatorRows.map((d) => d.id), archivedLeaves: 0, review: [], errors };
  return projected;
}

function prefillEntity(suggestion, records, { entityName = suggestion.doc.sourceEntity, sourceFile = null, sourceDigest = null, header = {}, operatorRows = [] } = {}) {
  const doc = suggestion.doc;
  if (doc.setAside && records.length) return setAsideEntity(suggestion, records, { entityName, sourceFile, header, operatorRows });
  const replaced = new Set(operatorRows.map((d) => d.id));
  const suggested = clone(doc.fieldMappings.filter((row) => row.id !== ARCHIVE_ROW_ID && !replaced.has(row.id)));
  for (const row of suggested) row.prefilled = { suggestion: suggestion.file, rowId: row.id };
  // Operator rows come first in claims: a leaf an operator row decides (for example a dropped
  // field) never also goes to the archive.
  const rows = [...suggested, ...clone(operatorRows.filter((d) => d.id !== ARCHIVE_ROW_ID))];
  const selectors = selectorTemplates(rows);
  const { leaves, dynamic } = discover(records, selectors);
  const dynamicPaths = new Set(dynamic.map((d) => d.path));
  const discovered = new Set(leaves);

  // A suggestion row for data this store doesn't have is left out (for example brands on a store
  // without a brands plugin). It is listed, so the report shows why.
  const kept = [], skipped = [];
  for (const row of rows) {
    if (row.selectors) {
      for (const sel of row.selectors) sel.keys = sel.keys.filter((k) => dynamic.find((d) => d.path === sel.path).observedKeys.includes(k));
      row.selectors = row.selectors.filter((sel) => sel.keys.length);
      if (!row.selectors.length) { skipped.push(row.id); continue; }
    }
    const own = row.sourcePaths.filter((p) => discovered.has(p) || dynamicPaths.has(p));
    if (own.length || !row.prefilled) kept.push(row); else skipped.push(row.id);
  }

  // Leftovers: every discovered plain leaf no kept row claims, and every observed dynamic key no
  // kept row selects, goes to the one source-archive row.
  const claimed = new Set(kept.flatMap((row) => row.sourcePaths.filter((p) => !dynamicPaths.has(p))));
  const archive = archiveRowFrom(suggestion, entityName);
  const standard = new Set(archive.sourcePaths);
  const archivePlain = leaves.filter((p) => !claimed.has(p) && !dynamicPaths.has(p));
  archive.sourcePaths = archivePlain;
  const archiveSelectors = [];
  for (const d of dynamic) {
    const taken = new Set(kept.flatMap((row) => (row.selectors || []).filter((s) => s.path === d.path).flatMap((s) => s.keys)));
    const rest = d.observedKeys.filter((k) => !taken.has(k));
    if (rest.length) {
      archiveSelectors.push({ path: d.path, keyPath: d.selector.keyPath, keys: rest });
      if (!archive.sourcePaths.includes(d.path)) archive.sourcePaths.push(d.path);
    }
  }
  if (archiveSelectors.length) archive.selectors = archiveSelectors; else delete archive.selectors;
  const collectionId = buildCmsArchiveCollectionId(entityName);
  archive.transform = { ...archive.transform, arguments: { ...(archive.transform.arguments || {}), sourceEntity: entityName, collectionId } };
  archive.outputs = [{ ...archive.outputs[0], sourcePaths: [...archive.sourcePaths], storage: { ...(archive.outputs[0].storage || {}), collectionId },
    verification: archive.outputs[0].verification || { ...ARCHIVE_VERIFICATION } }];
  archive.prefilled = { suggestion: suggestion.file, rowId: ARCHIVE_ROW_ID, rule: 'every unclaimed discovered leaf' };
  const fieldMappings = [...kept, ...(archive.sourcePaths.length ? [archive] : [])];

  const coveragePaths = [...leaves.filter((p) => !dynamicPaths.has(p)), ...dynamic.filter((d) => d.observedKeys.length)];
  const coverage = {
    paths: coveragePaths,
    sourceSnapshotDigest: sourceDigest || sha256(JSON.stringify(records)),
    inventoryDigest: contract.digest(coveragePaths),
    uninspectedAreas: [],
    evidence: [sourceFile ? `${sourceFile} (${records.length} records)` : `${records.length} source records`],
  };
  const [targetDomain, targetEntity] = doc.targetRef.split('/');
  const entity = {
    sourceEntity: entityName,
    sourceSystem: suggestion.platform,
    targetRef: doc.targetRef,
    targetDomain,
    targetEntity,
    primaryKey: doc.primaryKey || (doc.matchKey && doc.matchKey.sourceKey) || 'id',
    sourceRecordCount: records.length,
    inUse: records.length > 0,
    requiredSourceEntityRefs: [...(doc.requiredSourceEntityRefs || [])],
    ...header,
    fieldMappingStatus: 'resolved',
    discoveryCoverage: coverage,
    fieldMappings,
    ...(suggestion.entityChoices.length ? { choices: clone(suggestion.entityChoices) } : {}),
  };
  const errors = contract.validateEntity(entity);
  const projected = errors.length ? entity : contract.projectEntity(entity);
  projected.prefill = {
    version: PREFILL_VERSION,
    suggestion: suggestion.file,
    rows: kept.filter((row) => row.prefilled).map((row) => row.id),
    operatorRows: operatorRows.filter(isOperatorRow).map((d) => d.id),
    aiRows: operatorRows.filter((d) => !isOperatorRow(d)).map((d) => d.id),
    skippedRows: skipped,
    archivedLeaves: archive.sourcePaths.length + archiveSelectors.reduce((n, s) => n + s.keys.length, 0),
    // Leftovers outside the suggestion's standard archive list (plugin fields, site-specific
    // keys), grouped by top-level source key. The AI reviews these; everything else is decided.
    review: reviewGroups(archivePlain.filter((p) => !standard.has(p)), standard, archiveSelectors),
    errors,
  };
  return projected;
}

// --- a project --------------------------------------------------------------------------------

function readNdjson(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Records as the mapper saw them: data/mapper-extract when present (children already joined),
// otherwise data/source-extract with the suggestion's declared children joined by parent key.
function recordsFor(projectDir, suggestion) {
  const entity = suggestion.doc.sourceEntity;
  for (const dir of ['data/mapper-extract', 'data/source-extract']) {
    const file = path.join(projectDir, dir, `${entity}.ndjson`);
    if (!fs.existsSync(file)) continue;
    const records = readNdjson(file);
    const children = (suggestion.doc.sourceShape && suggestion.doc.sourceShape.children) || {};
    for (const [key, child] of Object.entries(children)) {
      if (!child || typeof child !== 'object' || !child.extract || records.some((r) => Array.isArray(r[key]))) continue;
      const childFile = path.join(projectDir, dir, `${child.extract}.ndjson`);
      const byParent = new Map();
      if (fs.existsSync(childFile)) for (const c of readNdjson(childFile)) {
        const k = String(c[child.parentKey]);
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k).push(c);
      }
      for (const r of records) if (byParent.has(String(r.id))) r[key] = byParent.get(String(r.id));
    }
    const digest = sha256(fs.readFileSync(file));
    return { records, file: path.relative(projectDir, file), digest };
  }
  return null;
}

// A row the run wrote itself, kept on every re-run: an operator change (`choice.decidedBy:
// "operator"`, `operatorChange: true`, or an operator transform kind) or an AI decision on a
// leftover (`choice.decidedBy: "ai"` when it is a value choice). Anything without the `prefilled`
// marker is such a row. Pre-filled rows are rebuilt from the suggestions.
function isRunRow(d) {
  return Boolean(d && !d.prefilled);
}
function isOperatorRow(d) {
  return Boolean(d && (d.operatorChange === true || contract.OPERATOR_TRANSFORM_KINDS.includes(d.transform && d.transform.kind)
    || (d.choice && d.choice.decidedBy === 'operator')));
}

// Pre-fills every entity that has a suggestion and source records. With `plan`, an entity the
// plan already has keeps its header fields (crosswalk, urlPolicy, ...) and every row the run wrote
// (operator changes and AI leftover decisions); such a row replaces the suggestion row with the
// same id, and the archive never claims a leaf it decides.
function prefillProject(projectDir, { platform = 'woocommerce', plan = null, entities = null, suggestionsDir = null } = {}) {
  const suggestions = loadSuggestions(platform, { dir: suggestionsDir });
  const out = [];
  for (const [entity, suggestion] of suggestions) {
    if (entities && !entities.includes(entity)) continue;
    const source = recordsFor(projectDir, suggestion);
    if (!source) continue;
    const existing = plan ? contract.entityRows(plan).find((row) => row.sourceEntity === entity) : null;
    const header = existing ? Object.fromEntries(Object.entries(existing).filter(([k]) => !['fieldMappings', 'fieldDispositions', 'verificationMappings', 'discoveryCoverage', 'prefill', 'choices', 'fieldMappingStatus', 'limitation'].includes(k))) : {};
    const runRows = existing ? (existing.fieldMappings || []).filter(isRunRow) : [];
    out.push(prefillEntity(suggestion, source.records, { sourceFile: source.file, sourceDigest: source.digest, header, operatorRows: runRows }));
  }
  return out;
}

// The plan's dependencyBindings (rp-mapper "Target dependency associations") with one binding per
// pre-filled entity's targetRef, naming the entity's census id: its explicit `censusIds`, else the
// census's implicit `entity:<sourceEntity>`. Bindings the run wrote are kept; a missing id is added.
function dependencyBindings(existing, entities) {
  const out = (Array.isArray(existing) ? existing : []).map((b) => ({ ...b, censusIds: [...(b.censusIds || [])] }));
  for (const e of entities) {
    if (!e || typeof e.targetRef !== 'string') continue;
    const ids = Array.isArray(e.censusIds) && e.censusIds.length ? e.censusIds : [`entity:${e.sourceEntity}`];
    let b = out.find((x) => x.ref === e.targetRef);
    if (!b) { b = { ref: e.targetRef, censusIds: [] }; out.push(b); }
    for (const id of ids) if (!b.censusIds.includes(id)) b.censusIds.push(id);
  }
  return out.sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
}

// What the AI still writes for one pre-filled entity: rows that did not come from the pre-fill.
function aiWrittenRows(entity) {
  return (entity.fieldMappings || []).filter((d) => !d.prefilled);
}

module.exports = {
  platformFamily, isOperatorRow, isRunRow, PREFILL_VERSION, ARCHIVE_ROW_ID, normalizeSuggestion, loadSuggestions, discover, prefillEntity, prefillProject, recordsFor, aiWrittenRows, dependencyBindings };
