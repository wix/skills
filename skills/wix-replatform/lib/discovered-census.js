'use strict';

// Deterministic metadata-only discovered-set census. Raw records are never read.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const coverage = require('./source-coverage.js');
const CENSUS_FILE = 'discovery/census.json';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function readJson(projectDir, file) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir, file), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function fileDigest(projectDir, file) {
  try {
    return hash(await fs.readFile(path.join(projectDir, file)));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
const digestJson = value => hash(JSON.stringify(sorted(value)));
const slugOf = value => String(value || '').split('/')[0];
const countOf = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
function entityEntries(schema) {
  const entities = schema && schema.entities;
  if (Array.isArray(entities)) return entities.map(row => [row.name || row.entityName || row.sourceEntity, row]);
  return Object.entries(entities || {});
}
function fieldNames(fields) {
  if (Array.isArray(fields)) return fields.map(field => typeof field === 'string' ? field : field && (field.name || field.path || field.field)).filter(Boolean);
  return Object.keys(fields || {});
}
async function registryPath(projectDir, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'subPartRegistryPath')) return options.subPartRegistryPath;
  const schema = await readJson(projectDir, 'source-schema.json');
  const decisions = await readJson(projectDir, 'orchestration/decisions.json');
  const adapter = schema && (schema.platform || schema.sourcePlatform) || decisions && decisions.sourcePlatform && decisions.sourcePlatform.value;
  if (!adapter || !/^[a-z0-9-]+$/i.test(adapter)) return null;
  return path.join(__dirname, '..', 'resources', `rp-source-${adapter}`, 'sub-parts.json');
}
async function censusInputs(projectDir, options = {}) {
  const registry = await registryPath(projectDir, options);
  const contract = await coverage.readCoverageContract(projectDir);
  return {
    sourceSchema: await fileDigest(projectDir, 'source-schema.json'),
    pluginCoverage: await fileDigest(projectDir, 'discovery/plugin-coverage.json'),
    sourceCoverage: contract.stamped ? await fileDigest(projectDir, coverage.SOURCE_COVERAGE_FILE) : null,
    subPartRegistry: registry ? await fileDigest('', registry) : null
  };
}
function validateRegistry(registry) {
  for (const [entity, subtypes] of Object.entries(registry || {})) {
    const fields = new Set();
    for (const [subtype, entry] of Object.entries(subtypes)) {
      if (!entry || !Array.isArray(entry.evidenceFields) || !entry.evidenceFields.length) throw new Error(`invalid_sub_part_registry: ${entity}/${subtype}`);
      for (const field of entry.evidenceFields) {
        if (typeof field !== 'string' || fields.has(field)) throw new Error(`duplicate_sub_part_field: ${entity}/${field}`);
        fields.add(field);
      }
    }
  }
}
async function buildCensus(projectDir, options = {}) {
  const schema = await readJson(projectDir, 'source-schema.json');
  if (!schema || !schema.entities || typeof schema.entities !== 'object') throw new Error('source_schema_missing');
  const plugins = await readJson(projectDir, 'discovery/plugin-coverage.json');
  const regPath = await registryPath(projectDir, options);
  const registry = regPath ? await readJson('', regPath) : null;
  validateRegistry(registry);
  const rows = [];
  for (const [entity, value] of entityEntries(schema)) {
    if (!entity || !value || typeof value !== 'object') throw new Error('source_entity_invalid');
    rows.push({
      censusId: `entity:${entity}`,
      kind: 'entity',
      decisionRow: true,
      entity,
      subtype: 'all',
      recordCount: countOf(value.recordCount),
      inUse: value.inUse == null ? null : value.inUse
    });
    const fields = new Set(fieldNames(value.fields));
    for (const [subtype, entry] of Object.entries(registry && registry[entity] || {})) {
      if (!entry.evidenceFields.some(field => fields.has(field))) continue;
      rows.push({
        censusId: `entity:${entity}/${subtype}`,
        kind: 'sub-part',
        decisionRow: true,
        entity,
        subtype,
        recordCount: null,
        evidenceFields: entry.evidenceFields,
        label: entry.label || subtype
      });
    }
  }
  const capabilities = new Map();
  for (const row of plugins && plugins.capabilities || []) {
    if (!row || typeof row.capability !== 'string' || !row.capability) throw new Error('capability_invalid');
    if (!capabilities.has(row.capability)) capabilities.set(row.capability, []);
    capabilities.get(row.capability).push(row);
  }
  for (const [capability, sources] of capabilities) {
    const selected = sources.find(row => row.recognized === true) || sources[0];
    const union = key => [...new Map(sources.flatMap(row => row[key] || []).map(value => [JSON.stringify(sorted(value)), value])).values()];
    rows.push({
      censusId: `capability:${capability}`,
      kind: 'capability',
      decisionRow: true,
      capability,
      coverageStatus: selected.status,
      plugins: union('plugins'),
      sourceEntities: union('sourceEntities'),
      blocked: union('blocked'),
      recordCounts: selected.recordCounts || {},
      basis: selected.basis || null,
      rationale: selected.rationale || null
    });
  }
  for (const plugin of plugins && plugins.perPlugin || []) {
    const slug = slugOf(plugin.plugin);
    if (!slug) throw new Error('plugin_invalid');
    const linkedCapabilities = [...capabilities.keys()].filter(capability => (plugin.capabilities || []).includes(capability) || capabilities.get(capability).some(row => (row.plugins || []).some(p => slugOf(p) === slug))).map(key => `capability:${key}`).sort();
    rows.push({
      censusId: `plugin:${slug}`,
      kind: 'plugin',
      decisionRow: linkedCapabilities.length === 0,
      pluginStatus: plugin.status,
      linkedCapabilities
    });
  }
  const contract = await coverage.readCoverageContract(projectDir);
  if (contract.stamped) {
    const inputs = await coverage.loadCoverageInputs(projectDir);
    const validation = coverage.validateCoverageFile(inputs.coverage);
    for (const row of validation.rows) rows.push({
      censusId: `coverage:${row.coverageId}`,
      kind: 'source-coverage',
      decisionRow: false,
      coverageId: row.coverageId,
      capability: row.capability,
      sourceEntity: row.sourceEntity,
      reason: row.reason
    });
  }
  rows.sort((a, b) => a.censusId.localeCompare(b.censusId));
  if (new Set(rows.map(row => row.censusId)).size !== rows.length) throw new Error('duplicate_census_id');
  const result = {
    schemaVersion: 1,
    inputs: await censusInputs(projectDir, options),
    rows
  };
  if (options.write !== false) await coverage.writeJsonAtomic(path.join(projectDir, CENSUS_FILE), result);
  return result;
}
async function readCensus(projectDir) {
  return readJson(projectDir, CENSUS_FILE);
}
async function censusFreshness(projectDir, census, options = {}) {
  if (!census) return {
    ok: false,
    staleInputs: ['census']
  };
  try {
    const current = await censusInputs(projectDir, options);
    const staleInputs = Object.keys(current).filter(key => !census.inputs || current[key] !== census.inputs[key]);
    // A malformed or hand-edited projection is not accepted merely because input hashes match.
    const rebuilt = await buildCensus(projectDir, {
      ...options,
      write: false
    });
    if (digestJson(census.rows) !== digestJson(rebuilt.rows) || census.schemaVersion !== 1) staleInputs.push('rows');
    return {
      ok: staleInputs.length === 0,
      staleInputs
    };
  } catch {
    return {
      ok: false,
      staleInputs: ['census']
    };
  }
}
async function rolloutScan(root, options = {}) {
  const classify = options.classifyFinalizedRun || require('./migration-completion.js').classifyFinalizedRun;
  const result = {
    reviewOnly: [],
    held: []
  };
  for (const entry of await fs.readdir(root, {
    withFileTypes: true
  })) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(root, entry.name);
    const classification = await classify(projectDir, {
      decisions: (await readJson(projectDir, 'orchestration/decisions.json')) || {}
    });
    if (classification.kind === 'valid-v1') result.reviewOnly.push({
      projectDir,
      reason: 'mapping_approval_missing_census'
    });
    if (classification.kind === 'unverified-v1') result.held.push({
      projectDir,
      reason: classification.reason || 'finalized_receipt_unverified',
      errors: classification.errors || []
    });
  }
  return result;
}
module.exports = {
  CENSUS_FILE,
  buildCensus,
  readCensus,
  censusFreshness,
  censusInputs,
  rolloutScan,
  readJson,
  fileDigest,
  digestJson,
  sorted
};
