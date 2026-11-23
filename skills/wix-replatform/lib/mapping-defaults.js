'use strict';

// Mechanical mapping rows the toolkit writes at the mapping stage entry, so the AI only decides
// what needs judgment.
//
// (a) Default set-aside: an in-use discovered entity (census entity row with records) that has no
//     plan row, no decided census disposition, no ready-made suggestion and NO source reader
//     cannot be read in full, so nothing can import it (platforms name which entities qualify:
//     WordPress plugin, custom-type and custom-route entities). It gets a typed `source-read-failed`
//     limitation (mapping-field-contract SET_ASIDE_REASONS). An entity that has a reader is never
//     defaulted: its Wix target may be import-safe (the guarded raw path), so it stays the AI's.
// (b) Factual census decisions, never judgments:
//     - no-data: a census entity row the discovery counted with 0 records;
//     - covered by a planned entity: a sub-part row (order/coupons) whose evidence fields a planned
//       row of its parent entity maps (not the archive row). Its id joins the parent's censusIds.
//     Reference-only, duplicates and plugin capabilities stay with the AI.
// The AI may change any default. A changed default entity is recorded as a toolkit gap
// (source plan-default-edit), like a changed pre-filled row. Defaults are kept in
// mapping/plan-defaults.json and listed by the plan (the limitation is the cutover task).

const fs = require('node:fs');
const path = require('node:path');

const PLAN = 'mapping/mapping-plan.json';
const GAPS = 'mapping/review/mapping-gaps.json';
const CENSUS = 'discovery/census.json';
const DEFAULTS = 'mapping/plan-defaults.json';
const ARCHIVE_ROW_ID = 'source-archive';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

// Platform family -> the source entity ids a reader exists for, and the hint for adding one.
// A platform not listed gets no default rows (the AI keeps writing them).
const READERS = Object.freeze({
  wordpress: {
    ids(projectDir) {
      const { createCatalogExtractor } = require('../resources/rp-source-wordpress/lib/catalog-extractor.js');
      const plans = require('../resources/rp-source-wordpress/lib/plugin-entity-read-plan.js');
      return new Set([
        ...createCatalogExtractor({ projectDir, env: {} }).entries.map((e) => e.id),
        ...plans.plannedPluginEntities(projectDir).map((e) => e.sourceEntityRef),
      ]);
    },
    // Only plugin, custom-type and custom-route entities. A core entity with no reader is mostly
    // a reference list (countries, order statuses, a duplicate view): reference-only is a judgment.
    defaultable: (name) => /^(plugin|generic|route)\./.test(name),
    hint: 'add a reader extra for its route (src/extract/reader-catalog.extra.json, rp-source-wordpress "Read contract"), extract it, then map it',
  },
});

const entityName = (row) => row.sourceEntityRef || row.entity || String(row.censusId).replace(/^entity:/, '');
function extracted(projectDir, name) {
  return ['data/source-extract', 'data/mapper-extract'].some((dir) => fs.existsSync(path.join(projectDir, dir, `${name}.ndjson`)));
}
function readGaps(projectDir) {
  const doc = readJson(path.join(projectDir, GAPS));
  return { doc, gaps: Array.isArray(doc) ? doc : Array.isArray(doc?.gaps) ? doc.gaps : [] };
}
function writeGaps(projectDir, doc, gaps) {
  writeJson(path.join(projectDir, GAPS), Array.isArray(doc) || !doc ? gaps : { ...doc, gaps });
}

function defaultEntity(row, platform, hint) {
  const name = entityName(row);
  return {
    sourceEntity: name,
    sourceSystem: platform,
    primaryKey: 'id',
    sourceRecordCount: row.recordCount,
    inUse: true,
    requiredSourceEntityRefs: [],
    fieldMappingStatus: 'pending',
    fieldMappings: [],
    discoveryCoverage: { paths: [], uninspectedAreas: [`Not read in full: the toolkit has no source reader for ${name}.`], evidence: [`${CENSUS} (${row.censusId}, ${row.recordCount} records)`] },
    limitation: {
      status: 'source-read-failed',
      detail: `Not read in full: the toolkit has no source reader for ${name}, so its ${row.recordCount} records were not imported. Requires Import Operator: ${hint}.`,
    },
    prefill: { default: 'no-reader', decidedBy: 'toolkit' },
  };
}

// Default entities the run changed since the toolkit wrote them: each is one toolkit gap.
function recordDefaultEdits(projectDir, plan, last) {
  const byName = new Map((plan.entities || []).map((e) => [e && e.sourceEntity, e]));
  const fresh = [];
  for (const d of (last && last.entities) || []) {
    const now = byName.get(d.sourceEntity);
    if (!now || (now.limitation?.status === d.limitation.status && !(now.fieldMappings || []).length)) continue;
    const gap = now.toolkitGap && typeof now.toolkitGap === 'object' ? now.toolkitGap : {};
    fresh.push({ step: `${d.sourceEntity} default set-aside changed`, file: PLAN, why: typeof gap.why === 'string' && gap.why.trim() ? gap.why.trim() : null, kind: 'default-edit' });
  }
  if (!fresh.length) return [];
  const gaps = require('./toolkit-gaps.js');
  const keys = new Set(fresh.map((g) => g.step));
  const old = gaps.readToolkitGaps(projectDir).filter((g) => g.source === 'plan-default-edit' && !keys.has(g.step));
  gaps.recordToolkitGaps(projectDir, 'plan-default-edit', [...old, ...fresh]);
  return fresh.map((g) => g.step);
}

function prepareMappingDefaults(projectDir, platform) {
  const step = 'mapping-defaults';
  const census = readJson(path.join(projectDir, CENSUS));
  if (!Array.isArray(census?.rows)) return { step, skipped: 'no-census' };
  const { planCensusIds } = require('./census-reconciliation.js');
  const contract = require('./mapping-field-contract.js');
  const planFile = path.join(projectDir, PLAN);
  const plan = readJson(planFile) || { schemaVersion: 1, fieldContractVersion: 1, sourcePlatform: platform, sourceSystem: platform, entities: [] };
  plan.entities = Array.isArray(plan.entities) ? plan.entities : [];
  const last = readJson(path.join(projectDir, DEFAULTS));
  const edited = recordDefaultEdits(projectDir, plan, last);
  const { doc: gapsDoc, gaps } = readGaps(projectDir);
  const planned = new Set(plan.entities.flatMap((e) => planCensusIds(e, census.rows).ids));
  const decided = new Set(gaps.filter((g) => g && g.censusId != null && typeof g.disposition === 'string' && g.disposition !== 'pending').map((g) => g.censusId));
  const anyGap = new Set(gaps.filter((g) => g && g.censusId != null).map((g) => g.censusId));
  const open = (row) => row && row.decisionRow && !planned.has(row.censusId) && !decided.has(row.censusId);

  // (a) default set-asides.
  const family = require('./plan-prefill.js').platformFamily(platform);
  const readers = READERS[family];
  const suggested = new Set(platform ? require('./plan-prefill.js').loadSuggestions(platform).keys() : []);
  const ids = readers ? readers.ids(projectDir) : null;
  const defaults = [];
  if (ids) {
    for (const row of census.rows) {
      if (row?.kind !== 'entity' || !open(row) || !Number.isSafeInteger(row.recordCount) || row.recordCount <= 0) continue;
      const name = entityName(row);
      if (!readers.defaultable(name) || suggested.has(name) || ids.has(name) || extracted(projectDir, name) || anyGap.has(row.censusId)) continue;
      const entity = defaultEntity(row, platform, readers.hint);
      if (contract.validateEntity(entity).length) continue;
      plan.entities.push(contract.projectEntity(entity));
      defaults.push({ sourceEntity: name, censusId: row.censusId, limitation: entity.limitation });
    }
  }

  // (b) census: covered sub-parts join their planned parent; 0-record entity rows are no-data.
  const covered = [];
  const parents = new Set();
  for (const row of census.rows) {
    if (row?.kind !== 'sub-part' || !open(row) || anyGap.has(row.censusId)) continue;
    const parent = plan.entities.find((e) => e && e.sourceEntity === row.entity);
    const fields = Array.isArray(row.evidenceFields) ? row.evidenceFields : [];
    if (!parent || !fields.length) continue;
    const named = planCensusIds(parent, census.rows);
    if (named.ambiguous) continue;
    const roots = new Set((parent.fieldMappings || []).filter((r) => r && r.id !== ARCHIVE_ROW_ID && r.disposition !== 'excluded')
      .flatMap((r) => (r.sourcePaths || []).map((p) => String(p).split(/[.[]/)[0])));
    if (!fields.every((f) => roots.has(f))) continue;
    parent.censusIds = [...new Set([...named.ids, row.censusId])];
    covered.push(row.censusId);
    parents.add(parent);
  }
  // The dependency binding of a parent names its census ids too (plan-prefill dependencyBindings).
  if (parents.size) plan.dependencyBindings = require('./plan-prefill.js').dependencyBindings(plan.dependencyBindings, [...parents]);
  const noData = census.rows.filter((row) => row?.kind === 'entity' && open(row) && row.recordCount === 0 && !anyGap.has(row.censusId))
    .map((row) => ({ id: `census:${row.censusId}`, gapType: 'census', censusId: row.censusId, disposition: 'no-data', severity: 'info', decidedBy: 'toolkit',
      rationale: 'Discovery counted 0 records.', summary: `${row.censusId}: no records in the source` }));

  if (defaults.length || covered.length) writeJson(planFile, plan);
  if (noData.length) writeGaps(projectDir, gapsDoc, [...gaps, ...noData]);
  const kept = [...((last && last.entities) || []).filter((d) => !defaults.some((n) => n.sourceEntity === d.sourceEntity)), ...defaults];
  if (defaults.length) writeJson(path.join(projectDir, DEFAULTS), { schemaVersion: 1, entities: kept });
  if (!defaults.length && !covered.length && !noData.length && !edited.length) return { step, skipped: ids ? 'nothing-to-default' : 'no-reader-list-for-platform', platform };
  return { step, platform, defaultSetAside: defaults.map((d) => d.sourceEntity), censusCovered: covered, censusNoData: noData.map((g) => g.censusId), defaultEdits: edited, file: DEFAULTS };
}

module.exports = { prepareMappingDefaults, READERS, DEFAULTS };
