'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  hashArtifact
} = require('./artifact-freshness');
const state = require('./read-back-state');
const {
  GUID
} = require('./operator-identity');
const DOMAINS = {
  order: 'ecom',
  member: 'members',
  contact: 'crm',
  product: 'stores'
};
const canonical = p => String(p).replace(/\[\d+\]/g, '[]');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const populated = v => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && Object.keys(v).length === 0);
const compareKeys = (a, b) => Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));
function entityKey(entity) {
  if (!Object.hasOwn(DOMAINS, entity)) throw new Error('Unsupported read-back entity');
  return entity;
}
function domainPath(entity) {
  return path.join(__dirname, '../resources/rp-target-wix/domains', DOMAINS[entityKey(entity)], 'entities', `${entity}.json`);
}
function domainContract(entity) {
  const file = domainPath(entity);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    intendedFields: d.intendedFields,
    readBackProjection: d.readBackProjection,
    domainDigest: hashArtifact(path.dirname(file), path.basename(file))
  };
}
function bindingPaths(entity) {
  entityKey(entity);
  return ['mapping/mapping-plan.json', `mapping/entity-decisions/${entity}.json`, 'mapping/mapping-resolution.json', `execution/read-back-inventory/${entity}.json`];
}
function bindings(projectDir, entity) {
  return Object.fromEntries(bindingPaths(entity).map(p => {
    const hash = hashArtifact(projectDir, p);
    if (!hash) throw new Error(`read-back binding missing: ${p}`);
    return [p, hash];
  }));
}
function leafPaths(value, prefix = '', out = new Set()) {
  if (!populated(value)) return out;
  if (Array.isArray(value)) {
    for (const item of value) leafPaths(item, `${prefix}[]`, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out.add(prefix);
  return out;
}
function valuesAt(value, dotted) {
  const tokens = canonical(dotted).replace(/\[\]/g, '.[]').split('.').filter(Boolean);
  let values = [value];
  for (const t of tokens) values = t === '[]' ? values.flatMap(v => Array.isArray(v) ? v : []) : values.map(v => v?.[t]);
  return values;
}
// The generated reader feeds its existing extract stream once. Values are not written to the inventory.
async function inventory(projectDir, entity, records, {
  sourceKey = r => r.id,
  buildWrite = r => r,
  rows = []
} = {}) {
  entityKey(entity);
  const preparationStarted = performance.now();
  const sourcePaths = Object.create(null),
    writePaths = Object.create(null),
    perRecord = [],
    seen = new Set();
  for await (const record of records) {
    const id = sourceKey(record);
    if (id === undefined || id === null || String(id) === '' || seen.has(String(id))) throw new Error('Read-back inventory requires unique stable source keys');
    seen.add(String(id));
    const source = leafPaths(record),
      sent = leafPaths(await buildWrite(record));
    const fields = [...new Set(rows.filter(row => (row.sourcePaths || []).some(p => valuesAt(record, p).some(populated)) || sent.has(row.writePath)).map(row => canonical(row.writePath)))].sort(compareKeys);
    for (const p of source) sourcePaths[p] = (sourcePaths[p] || 0) + 1;
    for (const p of fields) writePaths[p] = (writePaths[p] || 0) + 1;
    perRecord.push({
      sourceId: String(id),
      writePaths: fields
    });
  }
  perRecord.sort((a, b) => compareKeys(a.sourceId, b.sourceId));
  const result = {
    schemaVersion: 1,
    entity,
    sourcePaths,
    writePaths,
    records: perRecord
  };
  await state.atomic(projectDir, `execution/read-back-inventory/${entity}.json`, result);
  Object.defineProperty(result, 'preparationMs', {
    value: performance.now() - preparationStarted
  });
  return result;
}
function cover(inv, {
  ceiling = 10,
  existing = []
} = {}) {
  if (!Number.isInteger(ceiling) || ceiling < 10 || ceiling > 30) throw new Error('Canary ceiling must be a recorded user integer from 10 to 30');
  const records = [...inv.records].sort((a, b) => compareKeys(a.sourceId, b.sourceId));
  const universe = Object.keys(inv.writePaths).sort(compareKeys),
    left = new Set(universe),
    selected = [],
    coveredBy = {};
  const add = r => {
    selected.push(r.sourceId);
    for (const p of r.writePaths) if (left.delete(p)) coveredBy[p] = r.sourceId;
  };
  for (const id of existing) {
    const row = records.find(r => r.sourceId === id);
    if (!row) throw new Error('A previously written canary is missing from the inventory');
    add(row);
  }
  while (left.size) {
    const candidates = records.filter(r => !selected.includes(r.sourceId)).map(r => ({
      row: r,
      gain: r.writePaths.filter(p => left.has(p)).length
    })).sort((a, b) => b.gain - a.gain || compareKeys(a.row.sourceId, b.row.sourceId));
    if (!candidates[0]?.gain) break;
    add(candidates[0].row);
  }
  return {
    universeDigest: digest({
      universe,
      records
    }),
    ceiling,
    canarySourceIds: selected,
    coveredBy,
    requiredCount: selected.length,
    uncoveredPaths: selected.length > ceiling ? universe.filter(p => !selected.slice(0, ceiling).some(id => records.find(r => r.sourceId === id).writePaths.includes(p))) : [...left],
    status: selected.length > ceiling || left.size ? 'coverage-exceeds-ceiling' : 'covered'
  };
}
function mappingRows(plan, entity) {
  const raw = plan.entityMappings || plan.entityDecisions || plan.mappings || plan.entities || [];
  const entities = Array.isArray(raw) ? raw : Object.entries(raw).map(([key, v]) => ({
    sourceEntity: key,
    ...v
  }));
  const entry = entities.find(e => [e.entity, e.sourceEntity, e.name, e.target?.entity].includes(entity));
  return entry?.fieldMappings || entry?.fields || entry?.mappingRows || [];
}
function validApproval(approval, current, request) {
  return approval?.status === 'approved' && approval.decidedBy === 'user' && GUID.test(approval.approvedBy?.userId || '') && Boolean(approval.approvedBy?.displayName?.trim()) && approval.requestId === request?.requestId && ['pending', 'answered'].includes(request?.status) && Object.entries(current).every(([p, h]) => approval.bindingDigests?.[p] === h && request.artifactRefs?.some(r => r.path === p && String(r.sha256).replace(/^sha256:/, '') === h));
}
async function validate(projectDir, entity, {
  decision,
  plan,
  inv,
  approval,
  request
} = {}) {
  entityKey(entity);
  decision ||= await state.readJson(projectDir, `mapping/entity-decisions/${entity}.json`);
  plan ||= await state.readJson(projectDir, 'mapping/mapping-plan.json');
  inv ||= await state.readJson(projectDir, `execution/read-back-inventory/${entity}.json`);
  approval ||= (await state.readJson(projectDir, 'orchestration/approvals.json', {})).mapping;
  if (!request && approval?.requestId) {
    try {
      request = await require('./user-actions').readUserAction(projectDir, approval.requestId);
    } catch {/* invalid approval */}
  }
  const errors = [],
    contract = domainContract(entity),
    copied = decision.readBackContract;
  if (!copied || copied.domainDigest !== contract.domainDigest || digest(copied.intendedFields) !== digest(contract.intendedFields) || digest(copied.readBackProjection) !== digest(contract.readBackProjection)) errors.push('read-back domain contract stale or missing');
  if (!inv || inv.entity !== entity || !Array.isArray(inv.records)) errors.push('read-back inventory missing; check not run');
  const rows = mappingRows(plan, entity),
    dispositions = decision.fieldDispositions || [];
  const gate = await state.load(projectDir),
    history = [...gate.observedLosses, ...Object.values(gate.runs).flatMap(run => Object.values(run.entities || {}).flatMap(e => [...(e.attemptedPaths || []), ...(e.settlements || []).filter(s => s.status !== 'passed')]))];
  const requirements = [...Object.keys(inv?.sourcePaths || {}).map(p => ({
    kind: 'source',
    path: p
  })), ...(contract.intendedFields || []).filter(f => f.sourcePaths.some(p => Object.keys(inv?.sourcePaths || {}).some(k => k === p || k.startsWith(p + '.') || k.startsWith(p + '[]')))).map(f => ({
    kind: 'intended',
    path: f.targetPath
  }))];
  let current;
  try {
    current = bindings(projectDir, entity);
  } catch (e) {
    errors.push(e.message);
  }
  for (const requirement of requirements) {
    const matches = dispositions.filter(d => canonical(d.path || d.sourcePath || d.targetPath) === requirement.path && (!d.kind || d.kind === requirement.kind));
    if (matches.length !== 1) {
      errors.push(`Disposition missing or duplicate: ${requirement.kind}:${requirement.path}`);
      continue;
    }
    const d = matches[0];
    if (d.status === 'mapped') {
      const row = d.mappingRef === undefined || d.mappingRef === null ? null : rows.find((r, i) => r.id !== undefined && r.id === d.mappingRef || r.mappingRef !== undefined && r.mappingRef === d.mappingRef || String(i) === String(d.mappingRef));
      if (!row || (requirement.kind === 'source' ? !row.sourcePaths?.includes(requirement.path) : canonical(row.writePath) !== requirement.path) || !row.readPath && !row.unverifiableReason) errors.push(`Mapping does not cover ${requirement.path}`);
    } else if (d.status === 'notMigrated') {
      if (history.some(h => (!h.entity || h.entity === entity) && (h.sourcePaths?.includes(requirement.path) || h.writePath === requirement.path || h.intendedTargetPath === requirement.path))) errors.push(`Attempted or observed-loss path cannot be omitted: ${requirement.path}`);
      if (!current || !validApproval(approval, current, request)) errors.push(`Identified exact-binding approval missing: ${requirement.path}`);
    } else errors.push(`Unknown disposition: ${requirement.path}`);
  }
  const serverOwned = contract.readBackProjection?.serverOwned || [];
  for (const f of contract.intendedFields || []) if (serverOwned.some(p => (typeof p === 'string' ? p : p.path) === f.targetPath)) errors.push(`Intended field cannot be server-owned: ${f.targetPath}`);
  for (const r of rows) if (!r.sourcePaths?.length || !r.writePath || !r.readPath && !r.unverifiableReason) errors.push('Mapping row missing read-back declaration');
  return {
    valid: !errors.length,
    errors,
    contract,
    rows,
    inventory: inv,
    decision,
    approval,
    bindingDigests: current
  };
}
module.exports = {
  DOMAINS,
  entityKey,
  canonical,
  digest,
  populated,
  compareKeys,
  domainPath,
  domainContract,
  bindingPaths,
  bindings,
  leafPaths,
  valuesAt,
  inventory,
  cover,
  mappingRows,
  validApproval,
  validate
};
