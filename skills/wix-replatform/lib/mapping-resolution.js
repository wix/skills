'use strict';
// Source-independent producer of mapping/mapping-resolution.json.
//
// The read-back and omission approvals bind this artifact. It is a deterministic projection of
// the reviewed mapping authority (mapping/mapping-plan.json, fieldContractVersion 1) and the
// source inventory coverage it records: which exact canonical source location each decision
// claims, its disposition and output bindings, the dynamic selector templates and the
// snapshot/inventory digests. It is written by writeMappingAuthority for every source
// (WordPress/REST, CSV, ...). A CSV resolver seed (rp-mapper/scripts/resolve-mapping.js output)
// is retained: its top-level keys stay where existing readers expect them and its provenance is
// recorded under `seed`. Nothing here is a placeholder: an entity without inspected fields is
// listed with status pending-inventory, and unclaimed locations are listed, never hidden.
const fs = require('node:fs');
const path = require('node:path');
const L = require('./source-location');

const FILE = 'mapping/mapping-resolution.json';
const GENERATOR = 'wix-replatform/lib/mapping-resolution.js';
const SCHEMA_VERSION = 2;
const SEED_GENERATOR = 'rp-mapper/resolve-mapping.js';
const SEED_KEYS = ['vendor', 'overlayVersion', 'overlayPresent', 'fieldMappings', 'coverage', 'derivedEntities', 'residue', 'overlayDrift', 'canonicalErrors', 'duplicateColumns'];

function fields() { return require('./mapping-field-contract'); }
// The seed is the CSV resolver's own output, or the seed already retained by a prior projection.
function seedOf(existing) {
  if (!existing || typeof existing !== 'object') return null;
  if (existing.generator === SEED_GENERATOR) {
    const body = Object.fromEntries(SEED_KEYS.filter(k => Object.hasOwn(existing, k)).map(k => [k, existing[k]]));
    return { body, provenance: { generator: existing.generator, schemaVersion: existing.schemaVersion ?? null, generatedAt: existing.generatedAt ?? null, digest: fields().digest(body) } };
  }
  if (existing.generator === GENERATOR && existing.seed) {
    const body = Object.fromEntries(SEED_KEYS.filter(k => Object.hasOwn(existing, k)).map(k => [k, existing[k]]));
    if (fields().digest(body) !== existing.seed.digest) return { body, provenance: { ...existing.seed, digest: fields().digest(body), tampered: true } };
    return { body, provenance: existing.seed };
  }
  return null;
}
function entityResolution(row) {
  const F = fields(), ref = F.entityRef(row);
  if (row.fieldMappingStatus === 'pending') return { sourceEntity: ref, status: 'pending-inventory', decisions: [], unclaimed: [] };
  if (row.targetClassification === 'manual-mapping') return { sourceEntity: ref, status: 'manual', decisions: [], unclaimed: [] };
  const decisions = (row.fieldMappings || []).map(d => ({
    id: d.id,
    disposition: d.disposition,
    pending: F.pendingDecision(row, d),
    ...(d.disposition === 'deferred-field' ? {pendingRestoration:true, recovery:d.recovery} : {}),
    locations: F.decisionLocations(d).sort(),
    outputs: (d.outputs || []).map(o => ({ ref: `${d.id}:${o.id}`, targetRef: o.targetRef, writeOperation: o.writeOperation, writePath: L.join(o.writeInput, o.targetPath), sourceLocations: F.outputLocations(d, o).sort(), ...(o.appliesWhen !== undefined ? { appliesWhen: o.appliesWhen } : {}) })),
    omittedOutputs: (d.omittedOutputs || []).map(o => ({ writeOperation: o.writeOperation, writePath: L.join(o.writeInput, o.targetPath) }))
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const claimed = new Set(decisions.flatMap(d => d.locations));
  const coverage = F.coverageLocations(row);
  return {
    sourceEntity: ref,
    status: decisions.some(d => d.pending) ? 'pending-decisions' : 'resolved',
    sourceSnapshotDigest: row.discoveryCoverage?.sourceSnapshotDigest || null,
    inventoryDigest: row.discoveryCoverage?.inventoryDigest || null,
    selectors: (row.discoveryCoverage?.paths || []).filter(p => p && typeof p === 'object' && p.dynamic === true)
      .map(p => { const t = L.template(p); return { array: t.array, keyPath: t.keyPath, valuePath: t.path, observedKeys: [...p.observedKeys].map(String).sort() }; }),
    coverageLocations: coverage.length,
    decisions,
    unclaimed: coverage.filter(p => !claimed.has(p)).sort()
  };
}
// Pure: same plan + seed always yields the same bytes.
function project(plan, { seed = null } = {}) {
  const F = fields();
  if (plan?.fieldContractVersion !== 1) throw Object.assign(new Error('mapping resolution requires a fieldContractVersion:1 authority'), { code: 'mapping_resolution_invalid' });
  const entities = F.entityRows(plan).map(entityResolution).sort((a, b) => a.sourceEntity < b.sourceEntity ? -1 : a.sourceEntity > b.sourceEntity ? 1 : 0);
  return {
    ...(seed ? seed.body : {}),
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    deterministic: true,
    locationEncoding: L.ENCODING,
    authority: { path: 'mapping/mapping-plan.json', fieldContractVersion: 1, digest: F.digest(plan) },
    source: { platform: plan.sourcePlatform || null, kind: seed ? 'csv-resolver-seed' : 'reviewed-authority' },
    seed: seed ? seed.provenance : null,
    entities
  };
}
function readExisting(projectDir) {
  const file = path.join(projectDir, FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function expected(projectDir, plan) {
  return project(plan, { seed: seedOf(readExisting(projectDir)) });
}
function compare(projectDir, plan) {
  const actual = readExisting(projectDir);
  if (!actual) return { ok: false, errors: [`${FILE} missing; rerun the mapping contract`] };
  if (actual.seed?.tampered) return { ok: false, errors: [`${FILE} seed changed after projection; rerun the resolver and contract`] };
  const want = expected(projectDir, plan);
  return fields().canonical(actual) === fields().canonical(want) ? { ok: true, errors: [] } : { ok: false, errors: [`${FILE} is stale or conflicts with the mapping authority; rerun the mapping contract`] };
}
module.exports = { FILE, GENERATOR, SCHEMA_VERSION, SEED_GENERATOR, SEED_KEYS, seedOf, project, expected, compare };
