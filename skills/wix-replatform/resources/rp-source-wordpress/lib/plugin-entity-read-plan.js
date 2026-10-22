'use strict';

// Project-local bridge recipes. Storage judgment belongs to discovery; execution only
// consumes pinned inputs, using the existing resumable transport/reader for every stream.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const client = require('./wix-wp-plugin-v2-client.js');
const TABLE = /^[A-Za-z0-9_]+$/;
const TOKEN = /^[a-z0-9_-]+$/;
const ENTITY = /^plugin\.[a-z0-9_-]+\.[a-z0-9_-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const KIND = 'structure-bridge-deferred-extraction';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function fail(message, code = 'plan-invalid') { throw Object.assign(new Error(message), { code }); }

function sourceIdentity(url) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail('source must be a credential-free base URL');
  return parsed.href.replace(/\/+$/, '');
}
function sourceEntityRef(plugin, entity) {
  if (!TOKEN.test(plugin) || !TOKEN.test(entity)) fail('plugin/entity must use inventory tokens');
  return `plugin.${plugin}.${entity}`;
}
function safeFile(projectDir, relativePath, roots = ['data/wp-discovery', 'data/source-extract', 'src/extract', 'src/lib']) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)
    || relativePath.includes('\\') || relativePath.split('/').some((part) => !part || part === '..' || part === '.')) fail('artifact path must be contained and project-relative');
  if (!roots.some((root) => relativePath.startsWith(`${root}/`))) fail('artifact path outside permitted directories');
  const root = fs.realpathSync(projectDir);
  const absolute = path.resolve(root, relativePath);
  let cursor = root;
  for (const part of relativePath.split('/')) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) fail('symlink artifact paths are not permitted');
  }
  return absolute;
}
function checkedFile(projectDir, reference, roots) {
  if (!reference || !HASH.test(reference.sha256)) fail('artifact reference needs sha256');
  const file = safeFile(projectDir, reference.path, roots);
  if (!fs.existsSync(file) || sha(fs.readFileSync(file)) !== reference.sha256) fail(`missing or changed artifact: ${reference.path}`);
  return file;
}
function atomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.writing`, bytes);
  fs.renameSync(`${file}.writing`, file);
}
function writeJson(projectDir, relativePath, value) {
  const file = safeFile(projectDir, relativePath);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  atomic(file, bytes);
  return { path: relativePath, sha256: sha(bytes) };
}
function referenceFor(projectDir, relativePath) {
  const file = safeFile(projectDir, relativePath);
  return { path: relativePath, sha256: sha(fs.readFileSync(file)) };
}
function entityPaths(projectDir, entity) {
  if (!ENTITY.test(entity)) fail('invalid canonical plugin entity');
  const base = `data/source-extract/${entity}`;
  return Object.fromEntries(['ndjson', 'manifest.json', 'deferred.json'].map((suffix) => [suffix, safeFile(projectDir, `${base}.${suffix}`)]));
}
function validatePlan(projectDir, plan, expectedEntity, siteBaseUrl) {
  if (!plan || plan.schemaVersion !== 1 || !ENTITY.test(plan.sourceEntityRef)) fail('invalid entity plan version or identity');
  if (expectedEntity && expectedEntity !== plan.sourceEntityRef) fail('entity-plan identity mismatch');
  if (sourceIdentity(plan.sourceIdentity) !== sourceIdentity(siteBaseUrl || plan.sourceIdentity)) fail('entity-plan source mismatch');
  if (!Array.isArray(plan.evidenceRefs) || !plan.evidenceRefs.length) fail('storage evidence is required');
  plan.evidenceRefs.forEach((ref) => checkedFile(projectDir, ref, ['data/wp-discovery']));
  if (!Array.isArray(plan.components) || !plan.components.length) fail('components are required');
  const roots = plan.components.filter((component) => !component.scope?.parent);
  if (roots.length !== 1) fail('plan requires exactly one root');
  const ids = new Set();
  for (const component of plan.components) {
    if (!TOKEN.test(component.id) || ids.has(component.id) || !TABLE.test(component.table)) fail('invalid component identity/table');
    ids.add(component.id);
    if (!['single-request', 'eav'].includes(component.variant)) fail('unknown component variant');
    const parent = component.scope?.parent;
    if (parent && (parent.component !== roots[0].id || parent.component === component.id || !TABLE.test(parent.column) || !TABLE.test(parent.parentColumn))) fail('only direct root-child relationships are supported');
    client.validateEavScope(component.scope?.where || [], (parent ? 1 : 0) + (component.variant === 'eav' ? 1 : 0));
    if (!parent && !component.scope?.where?.length && (client.SHARED_CORE_TABLES_REQUIRING_WHERE.has(component.table) || ['postmeta', 'commentmeta', 'termmeta'].includes(component.table))) fail('shared table requires an explicit entity scope');
    if (!component.schema || !Array.isArray(component.schema.columns) || component.schema.table !== component.table) fail('component schema evidence is required');
    const refs = component.readArtifacts;
    if (!refs || Object.keys(refs).some((key) => !['structureRequest', 'eavReadPlan'].includes(key))) fail('explicit component read artifacts required');
    const key = component.variant === 'eav' ? 'eavReadPlan' : 'structureRequest';
    const artifact = json(checkedFile(projectDir, refs[key], ['data/wp-discovery']));
    if (artifact.table !== component.table) fail('component physical table mismatch');
    const where = component.scope?.where || [];
    if (component.variant === 'eav') {
      const problem = client.verifyEavReadPlanIntegrity(artifact);
      if (problem) fail(problem);
      if (artifact.keysTruncated || artifact.droppedIdentityColumns?.length) fail('incomplete EAV keys/identity');
      if (!component.schema.eavPair) fail('EAV schema pair is required');
      for (const batch of client.eavReadPlanBatches(artifact)) {
        client.validateStructureRequest(batch.structureRequest);
        if (batch.structureRequest.table !== component.table || !where.every((condition) => batch.structureRequest.where?.some((c) => same(c, condition)))) fail('EAV table/scope mismatch');
      }
    } else {
      client.validateStructureRequest(artifact);
      if (!same(artifact.where || [], where)) fail('request scope mismatch');
    }
  }
  const assembly = plan.assembly;
  if (!assembly || !['identity', 'eav-pivot-v1', 'module'].includes(assembly.kind) || !TABLE.test(assembly.identityColumn)) fail('assembly needs explicit identity');
  if (assembly.kind === 'module') {
    checkedFile(projectDir, assembly.module, ['src/extract', 'src/lib']);
    if (!TABLE.test(assembly.export)) fail('assembly export is required');
  }
  if (assembly.kind === 'identity' && plan.components.length !== 1) fail('identity assembly cannot discard child components');
  if (assembly.kind === 'eav-pivot-v1' && !assembly.keyColumn) {
    const children = assembly.children || [];
    if (children.length !== plan.components.length - 1 || new Set(children.map((child) => child.component)).size !== children.length) fail('pivot must name every child exactly once');
    for (const child of children) {
      const component = plan.components.find((item) => item.id === child.component);
      if (!component?.scope?.parent || component.scope.parent.column !== child.foreignKey || component.scope.parent.parentColumn !== assembly.identityColumn
        || component.schema.eavPair?.keyColumn !== child.keyColumn || component.schema.eavPair?.valueColumn !== child.valueColumn) fail('pivot relationship must match component schema/scope');
    }
  }
  if (!plan.cost || typeof plan.cost !== 'object' || !Object.keys(plan.cost).length) fail('plan cost/unknowns are required');
  return plan;
}
function loadPlan({ projectDir, sourceEntityRef: entity, planRef, siteBaseUrl }) {
  if (!planRef) fail('discovery has not produced an entity plan', 'plan-unavailable');
  const plan = json(checkedFile(projectDir, planRef, ['data/wp-discovery']));
  return validatePlan(projectDir, plan, entity, siteBaseUrl);
}
function assertCanonicalBinding({ projectDir, sourceEntityRef: entity, planRef, siteBaseUrl }) {
  const schemaPath = path.join(projectDir, 'source-schema.json');
  if (fs.lstatSync(schemaPath, { throwIfNoEntry: false })?.isSymbolicLink()) fail('source schema cannot be a symlink');
  const schema = json(schemaPath);
  const rows = Array.isArray(schema.entities) ? schema.entities : Object.entries(schema.entities || {}).map(([key, row]) => ({ sourceEntityRef: key, ...row }));
  const source = rows.find((row) => row.sourceEntityRef === entity);
  if (!source?.sourceMeta?.extractionPlan || !planRef) fail('current canonical entity plan is unavailable', 'plan-unavailable');
  if (!source || !same(source.sourceMeta?.extractionPlan, planRef)) fail('canonical source binding changed or is unavailable');
  if (siteBaseUrl && sourceIdentity(schema.sourceUrl || schema.source?.url) !== sourceIdentity(siteBaseUrl)) fail('canonical source URL changed');
}
function invalidatePluginEntityReadPlan({ projectDir, sourceEntityRef: entity }) {
  const file = path.join(projectDir, 'source-schema.json');
  if (!fs.existsSync(file)) return;
  if (fs.lstatSync(file).isSymbolicLink()) fail('source schema cannot be a symlink');
  const schema = json(file);
  const rows = Array.isArray(schema.entities) ? schema.entities : Object.entries(schema.entities || {}).map(([key, row]) => Object.assign(row, { sourceEntityRef: row.sourceEntityRef || key }));
  const row = rows.find((item) => item.sourceEntityRef === entity);
  if (row) {
    row.sourceMeta = { ...row.sourceMeta, extractionPlan: null };
    row.bridgeDesignated = true;
    atomic(file, `${JSON.stringify(schema, null, 2)}\n`);
  }
}
function writePluginEntityReadPlan({ projectDir, plan, sourceEntity = null, siteBaseUrl }) {
  validatePlan(projectDir, plan, sourceEntity?.sourceEntityRef, siteBaseUrl);
  const reference = writeJson(projectDir, `data/wp-discovery/entity-read-plans/${sha(plan.sourceEntityRef)}.json`, plan);
  const extractionPlan = { schemaVersion: 1, ...reference };
  if (sourceEntity) {
    sourceEntity.sourceEntityRef = plan.sourceEntityRef;
    sourceEntity.bridgeDesignated = true;
    sourceEntity.sourceMeta = { ...sourceEntity.sourceMeta, extractionPlan };
    const schemaPath = path.join(projectDir, 'source-schema.json');
    if (fs.existsSync(schemaPath)) {
      if (fs.lstatSync(schemaPath).isSymbolicLink()) fail('source schema cannot be a symlink');
      const schema = json(schemaPath);
      if (Array.isArray(schema.entities)) {
        const index = schema.entities.findIndex((row) => row.sourceEntityRef === plan.sourceEntityRef);
        if (index < 0) schema.entities.push(sourceEntity);
        else schema.entities[index] = { ...schema.entities[index], ...sourceEntity, sourceMeta: { ...schema.entities[index].sourceMeta, ...sourceEntity.sourceMeta } };
      } else {
        schema.entities ||= {};
        const key = Object.keys(schema.entities).find((name) => schema.entities[name].sourceEntityRef === plan.sourceEntityRef) || plan.sourceEntityRef;
        schema.entities[key] = { ...schema.entities[key], ...sourceEntity, sourceMeta: { ...schema.entities[key]?.sourceMeta, ...sourceEntity.sourceMeta } };
      }
      atomic(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
    }
  }
  return extractionPlan;
}
function recordPluginExtractionDeferral({ projectDir, sourceEntityRef: entity, plan = null, planRef = null, code, reason, recovery: componentRecovery = null, expectedTotal = null, producer = 'rp-source-wordpress/lib/plugin-entity-read-plan.js', resolution = null }) {
  const file = entityPaths(projectDir, entity)['deferred.json'];
  let previous = null;
  try { previous = fs.existsSync(file) ? json(file) : null; } catch { /* A malformed task is not extraction or target evidence. */ }
  const at = new Date().toISOString();
  if (resolution) {
    if (previous) atomic(file, `${JSON.stringify({ ...previous, status: 'resolved', resolvedAt: at, resolution }, null, 2)}\n`);
    return;
  }
  const actions = {
    'plan-unavailable': 'Inspect the entity storage/REST evidence and prepare a validated project-local read plan; identify missing capability support if a plan cannot be produced. An identical discovery rerun is insufficient.',
    'plan-invalid': 'Repair the named artifact, scope, source/table binding or unsupported relationship in its discovery/codegen producer; validate the plan and refresh mapping/execution review when changed.',
    'full-extraction-unavailable': 'Run full extraction for the affected entity using its current validated plan; retain and follow any component restart/resume instructions.',
    'full-extraction-stale': 'Rerun full extraction for the affected entity to reconcile current plan, component and output evidence; retain and follow any component restart/resume instructions.',
    'assembly-failed': 'Correct the verified identity, key/cardinality or pinned assembler; rerun affected extraction under its recorded restart policy. Do not guess joins or drop records.',
  };
  const action = actions[code] || componentRecovery?.action || 'Resolve the named component read failure using its retained diagnostic and restart/resume instruction, then rerun the affected extraction.';
  const check = `Current full ${entity}.manifest.json and component evidence reconcile against the approved plan and NDJSON, then this record is resolved.`;
  const record = {
    schemaVersion: 2, kind: KIND, status: 'open', producer, entity, sourceEntityRef: entity,
    table: plan?.components.length === 1 ? plan.components[0].table : null,
    components: (plan?.components || []).map(({ id, table }) => ({ id, table })), planRef,
    code, reasons: [reason || code], firstDeferredAt: previous?.firstDeferredAt || at, lastDeferredAt: at,
    attempts: (previous?.attempts || 0) + 1,
    affectedRecords: { entity, expectedTotal: Number.isInteger(expectedTotal) && expectedTotal >= 0 ? expectedTotal : null },
    owner: 'Import Operator', requiresImportOperator: true, action,
    consequence: 'Affected new writes remain held; existing target identities are retained.',
    prerequisites: ['Original migration project and source access', 'Configured bridge credential; never paste credentials into the task', 'Verified storage evidence and applicable mapping approval'],
    timing: 'Before dependent import/cutover and source retirement', resolutionCheck: check,
    resumable: { restartRequired: componentRecovery?.restart === true },
    copyPromptForImportOperator: `Requires Import Operator: inspect data/source-extract/${entity}.deferred.json. ${action} Verify complete extraction, then resume only affected scopes. Done when ${check}`,
    cutoverIntegration: 'pending: shared Cutover integration; retained in completion operatorActions and website handoff',
  };
  atomic(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
async function validatePluginExtractionReadiness(options) {
  const { projectDir, sourceEntityRef: entity, phase = 'import' } = options;
  let plan;
  let checkingExtraction = false;
  try {
    assertCanonicalBinding(options);
    plan = loadPlan(options);
    if (phase === 'preparation') return { ready: true, plan };
    if (phase !== 'import') fail('unknown readiness phase');
    checkingExtraction = true;
    const paths = entityPaths(projectDir, entity);
    const manifest = json(paths['manifest.json']);
    if (manifest.mode !== 'full' || manifest.sourceEntityRef !== entity || !same(manifest.planRef, options.planRef)
      || manifest.sourceIdentity !== plan.sourceIdentity || !same(manifest.assembly, plan.assembly)) fail('current full entity manifest required');
    const stats = await require('./structure-bridge-reader.js').fileStats(paths.ndjson);
    if (!stats.exists || stats.digest !== manifest.ndjsonDigest || stats.lines !== manifest.rowsWritten) fail('full output digest/count mismatch');
    if (!Array.isArray(manifest.components) || !manifest.components.length) fail('component evidence required');
    const seen = new Set();
    for (const component of manifest.components) {
      if (!plan.components.some((c) => c.id === component.id)) fail('unknown manifest component');
      seen.add(component.id);
      const prefix = `data/source-extract/${entity}.${options.planRef.sha256}.${component.id}.`;
      if (!component.manifest?.path.startsWith(prefix) || !component.output?.path.startsWith(prefix)) fail('component evidence namespace mismatch');
      const componentManifest = json(checkedFile(projectDir, component.manifest, ['data/source-extract']));
      if (componentManifest.kind !== 'eav-read-plan' && componentManifest.rowsWritten !== componentManifest.snapshotTotal) fail('component count unreconciled');
      const data = await require('./structure-bridge-reader.js').fileStats(checkedFile(projectDir, component.output, ['data/source-extract']));
      if (data.digest !== componentManifest.ndjsonDigest || data.lines !== componentManifest.rowsWritten) fail('component output mismatch');
      for (const reference of component.readArtifacts) checkedFile(projectDir, reference, ['data/wp-discovery']);
      if (componentManifest.kind === 'eav-read-plan') {
        const reference = component.readArtifacts.find((ref) => json(checkedFile(projectDir, ref)).planVersion);
        if (!reference) fail('component EAV evidence missing');
        const eavPlan = json(checkedFile(projectDir, reference));
        const errors = client.reconcileEavReadPlan(eavPlan, { planHash: componentManifest.planHash, batches: componentManifest.completedBatches, rowsWritten: componentManifest.rowsWritten });
        if (errors.some((message) => !message.includes('best-effort'))) fail('component EAV reconciliation failed');
      }
    }
    for (const component of plan.components) if (!seen.has(component.id)) fail('incomplete component set');
    if (!Array.isArray(manifest.materializations)) fail('materialization evidence is required');
    for (const reference of manifest.materializations) checkedFile(projectDir, reference, ['data/wp-discovery']);
    const root = plan.components.find((component) => !component.scope?.parent);
    let rootRows;
    for (const component of plan.components.filter((item) => item.scope?.parent)) {
      const parentPath = `data/wp-discovery/entity-read-plans/${sha(entity)}/${options.planRef.sha256}/${component.id}/parent-ids.json`;
      const parentRef = manifest.materializations.find((ref) => ref.path === parentPath);
      if (!parentRef) fail('full parent-ID materialization missing');
      rootRows ||= manifest.components.filter((item) => item.id === root.id).flatMap((item) => readRows(checkedFile(projectDir, item.output, ['data/source-extract'])));
      const column = component.scope.parent.parentColumn;
      const expectedIds = [...new Map(rootRows.map((row) => [rowIdentity(row, column), row[column]])).values()].sort((a, b) => String(a).localeCompare(String(b)));
      if (!same(json(checkedFile(projectDir, parentRef)), expectedIds)) fail('materialized parent IDs differ from complete root');
    }
    recordPluginExtractionDeferral({ ...options, resolution: { status: 'verified-full', manifestPath: rel(projectDir, paths['manifest.json']), rowsWritten: manifest.rowsWritten, planRef: options.planRef } });
    return { ready: true, plan, manifest };
  } catch (error) {
    // Readiness observes extraction failure; it must not rewrite the original repair
    // task or erase a component's restart policy when that task belongs to this plan.
    if (checkingExtraction) {
      let previous;
      try { previous = json(entityPaths(projectDir, entity)['deferred.json']); } catch { /* No usable prior task. */ }
      if (previous?.status === 'open' && previous.sourceEntityRef === entity && same(previous.planRef, options.planRef)) {
        return { ready: false, code: previous.code, reasons: previous.reasons, resumable: previous.resumable };
      }
    }
    const code = checkingExtraction ? (error.code === 'ENOENT' ? 'full-extraction-unavailable' : 'full-extraction-stale')
      : error.code === 'plan-unavailable' ? error.code : 'plan-invalid';
    let reason = error.message;
    for (const root of new Set([path.resolve(projectDir), fs.realpathSync(projectDir)])) reason = reason.split(`${root}${path.sep}`).join('');
    recordPluginExtractionDeferral({ ...options, plan, code, reason });
    return { ready: false, code, reasons: [reason] };
  }
}
function readRows(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
function rowIdentity(row, column) {
  const value = row[column];
  if (!['string', 'number'].includes(typeof value) || value === '') fail(`missing source identity ${column}`, 'assembly-failed');
  return `${typeof value}:${value}`;
}
function pivot(rows, config) {
  const groups = new Map();
  for (const row of rows) {
    const identity = rowIdentity(row, config.identityColumn);
    if (!Object.hasOwn(config.keys || {}, row[config.keyColumn])) fail('unexpected metadata key', 'assembly-failed');
    const key = row[config.keyColumn];
    const cardinality = config.keys[key];
    if (!['scalar', 'array'].includes(cardinality)) fail('metadata cardinality required', 'assembly-failed');
    const group = groups.get(identity) || { [config.identityColumn]: row[config.identityColumn], meta: Object.create(null) };
    if (cardinality === 'array') (group.meta[key] ||= []).push(row[config.valueColumn]);
    else {
      if (Object.hasOwn(group.meta, key)) fail(`duplicate scalar metadata key ${key}`, 'assembly-failed');
      group.meta[key] = row[config.valueColumn];
    }
    groups.set(identity, group);
  }
  return groups;
}
function assemble(plan, streams, projectDir) {
  const config = plan.assembly;
  const root = plan.components.find((c) => !c.scope?.parent);
  let rows = streams[root.id];
  if (config.kind === 'module') {
    const file = checkedFile(projectDir, config.module, ['src/extract', 'src/lib']);
    delete require.cache[require.resolve(file)];
    rows = require(file)[config.export]({ components: streams });
    if (!Array.isArray(rows)) fail('assembly module must return records', 'assembly-failed');
  } else if (config.kind === 'eav-pivot-v1') {
    if (config.keyColumn) rows = [...pivot(rows, config).values()];
    else {
      const rootIds = new Set(rows.map((row) => rowIdentity(row, config.identityColumn)));
      const maps = (config.children || []).map((child) => {
        if (!streams[child.component]) fail('unknown pivot child', 'assembly-failed');
        const groups = pivot(streams[child.component], { ...child, identityColumn: child.foreignKey });
        for (const key of groups.keys()) if (!rootIds.has(key)) fail('orphan required relationship', 'assembly-failed');
        return { child, groups };
      });
      rows = rows.map((row) => {
        const value = { ...row };
        for (const { child, groups } of maps) {
          const group = groups.get(rowIdentity(row, config.identityColumn));
          if (!group && child.required) fail('missing required child', 'assembly-failed');
          Object.defineProperty(value, child.outputField || child.component, { value: group?.meta || {}, enumerable: true, configurable: true, writable: true });
        }
        return value;
      });
    }
  }
  const identities = new Set();
  for (const row of rows) {
    const identity = rowIdentity(row, config.identityColumn);
    if (identities.has(identity)) fail('duplicate logical identity', 'assembly-failed');
    identities.add(identity);
  }
  return rows;
}
async function extractBoundPluginEntity(options) {
  const { projectDir, sourceEntityRef: entity, transport, planRef, sample = false, sampleRecords = null, restart = false } = options;
  if (sample) return { status: 'preview', rows: sampleRecords, unavailable: !sampleRecords }; // never promotes
  const ready = await validatePluginExtractionReadiness({ ...options, siteBaseUrl: transport?.siteBaseUrl, phase: 'preparation' });
  if (!ready.ready) return { status: 'deferred', ...ready };
  const { plan } = ready;
  const streams = Object.create(null);
  const components = [];
  const materializations = [];
  const reader = require('./structure-bridge-reader.js');
  let activeComponent = null;
  try {
    const root = plan.components.find((c) => !c.scope?.parent);
    for (const component of [root, ...plan.components.filter((c) => c !== root)]) {
      activeComponent = component.id;
      streams[component.id] = [];
      const parent = component.scope?.parent;
      let chunks = [null];
      let parentRef = null;
      const namespace = `data/wp-discovery/entity-read-plans/${sha(entity)}/${planRef.sha256}/${component.id}`;
      if (parent) {
        const ids = [...new Map(streams[root.id].map((row) => [rowIdentity(row, parent.parentColumn), row[parent.parentColumn]])).values()].sort((a, b) => String(a).localeCompare(String(b)));
        parentRef = writeJson(projectDir, `${namespace}/parent-ids.json`, ids);
        materializations.push(parentRef);
        chunks = [];
        for (let i = 0; i < ids.length; i += client.MAX_IN_VALUES) chunks.push(ids.slice(i, i + client.MAX_IN_VALUES));
      }
      // Empty root still has explicit completed child evidence, without an unrestricted query.
      if (!chunks.length) {
        const emptyData = `data/source-extract/${entity}.${planRef.sha256}.${component.id}.empty.ndjson`;
        atomic(safeFile(projectDir, emptyData), '');
        const manifest = writeJson(projectDir, `${emptyData}.manifest.json`, { rowsWritten: 0, snapshotTotal: 0, ndjsonDigest: sha('') });
        components.push({ id: component.id, manifest, output: referenceFor(projectDir, emptyData), readArtifacts: [] });
      }
      for (const [index, ids] of chunks.entries()) {
        let artifacts = component.readArtifacts;
        if (ids) {
          const where = [...(component.scope?.where || []), { column: parent.column, op: 'in', value: ids }];
          client.validateEavScope(where, component.variant === 'eav' ? 1 : 0);
          const base = `${namespace}/${parentRef.sha256}/${index}`;
          const savedPath = `${base}/${component.variant}.json`;
          const absolute = safeFile(projectDir, savedPath);
          if (!fs.existsSync(absolute) || restart) {
            let request;
            if (component.variant === 'eav') {
              const pairs = [component.schema.eavPair, ...(component.schema.eavPair.additionalPairs || [])];
              const keysByPair = {}; const countsByPair = {}; let truncated = false;
              for (const pair of pairs) {
                const keys = await client.discoverEavKeys({ ...transport, table: component.table, keyColumn: pair.keyColumn, scope: where });
                keysByPair[pair.keyColumn] = keys.keys; countsByPair[pair.keyColumn] = keys.keyCounts;
                truncated ||= keys.truncated;
              }
              request = client.buildEavReadPlan({ table: component.table, eavPair: component.schema.eavPair, schemaColumns: component.schema.columns, keysByPair, countsByPair, scope: where, truncated });
            } else request = { ...json(checkedFile(projectDir, component.readArtifacts.structureRequest)), where };
            writeJson(projectDir, savedPath, request);
          }
          artifacts = { [component.variant === 'eav' ? 'eavReadPlan' : 'structureRequest']: referenceFor(projectDir, savedPath) };
          materializations.push(...Object.values(artifacts));
        }
        const componentEntity = `${entity}.${planRef.sha256}.${component.id}.${parentRef?.sha256 || 'root'}.${index}`;
        const result = await reader.extractStructureBridgeEntity({ dataDir: path.join(projectDir, 'data'), entity: componentEntity, table: component.table, transport, expectEav: component.variant === 'eav', readArtifacts: artifacts, restart, recordDeferred: false });
        if (result.status === 'deferred') {
          const error = Object.assign(new Error(`${component.id}: ${result.code}; ${result.reasons.join('; ')}; retained component state data/source-extract/${componentEntity}.ndjson.tmp.cursor.json`), { code: result.code, recovery: result.recovery });
          throw error;
        }
        const manifest = referenceFor(projectDir, rel(projectDir, result.manifestPath));
        const output = referenceFor(projectDir, rel(projectDir, result.finalPath));
        components.push({ id: component.id, manifest, output, readArtifacts: Object.values(artifacts) });
        for (const row of readRows(result.finalPath)) streams[component.id].push(row);
      }
    }
    activeComponent = null;
    const rows = assemble(plan, streams, projectDir);
    assertCanonicalBinding({ ...options, siteBaseUrl: transport.siteBaseUrl });
    loadPlan({ ...options, siteBaseUrl: transport.siteBaseUrl }); // re-hash all governing inputs before promotion
    materializations.forEach((ref) => checkedFile(projectDir, ref));
    components.forEach((entry) => { checkedFile(projectDir, entry.manifest); checkedFile(projectDir, entry.output); });
    const paths = entityPaths(projectDir, entity);
    const bytes = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
    atomic(paths.ndjson, bytes);
    const manifest = { schemaVersion: 1, mode: 'full', sourceEntityRef: entity, sourceIdentity: plan.sourceIdentity, planRef, components, materializations, assembly: plan.assembly, rowsWritten: rows.length, ndjsonDigest: sha(bytes) };
    atomic(paths['manifest.json'], `${JSON.stringify(manifest, null, 2)}\n`);
    recordPluginExtractionDeferral({ ...options, resolution: { manifestPath: rel(projectDir, paths['manifest.json']), rowsWritten: rows.length, planRef } });
    return { status: 'promoted', rowsWritten: rows.length, manifestPath: paths['manifest.json'], finalPath: paths.ndjson };
  } catch (error) {
    const code = error.code || 'assembly-failed';
    recordPluginExtractionDeferral({ ...options, plan, code, recovery: error.recovery, reason: `${activeComponent || 'assembly'}: ${error.message}` });
    return { status: 'deferred', code, reasons: [error.message] };
  }
}
// Preserve the adapter's existing target dependency order; enforce transitive source
// prerequisites within that order as well. Validate the whole graph before any handler.
function dependencyOrderedEntities(entities, entityOrder) {
  const explicitOrder = entityOrder !== undefined;
  entityOrder ??= entities.map((entity) => entity.sourceEntityRef);
  const byRef = new Map(entities.map((entity) => [entity.sourceEntityRef, entity]));
  if (!Array.isArray(entityOrder) || new Set(entityOrder).size !== entityOrder.length
    || entityOrder.some((ref) => !byRef.has(ref)) || entities.some((entity) => entity.importPlanned && !entityOrder.includes(entity.sourceEntityRef))) fail('adapter entityOrder must include every planned entity exactly once');
  const ordered = []; const visited = new Set(); const active = new Set();
  const visit = (ref) => {
    if (active.has(ref)) fail('cyclic source prerequisites');
    const entity = byRef.get(ref);
    if (!entity) fail('missing source prerequisite');
    if (visited.has(ref)) return;
    active.add(ref);
    for (const prerequisite of entity.sourcePrerequisites || []) visit(prerequisite);
    active.delete(ref); visited.add(ref); ordered.push(entity);
  };
  for (const ref of [...entityOrder, ...byRef.keys()]) visit(ref);
  if (explicitOrder && !same(ordered.filter((entity) => entityOrder.includes(entity.sourceEntityRef)).map((entity) => entity.sourceEntityRef), entityOrder)) fail('adapter dependency order conflicts with source prerequisites; repair codegen ordering before import');
  return ordered;
}
async function dispatchWithPluginExtractionReadiness({ entities, selection, projectDir, siteBaseUrl, entityOrder }, handlers) {
  const results = [];
  const checks = new Map();
  const selected = selectPluginEntities(dependencyOrderedEntities(entities, entityOrder), selection).filter((entity) => entity.dispatchSelected !== false);
  for (const entity of selected) {
    const required = [];
    const visit = (source, stack = new Set()) => {
      if (!source || stack.has(source.sourceEntityRef)) fail('missing/cyclic source prerequisite');
      if (required.includes(source)) return;
      required.push(source);
      for (const ref of source.sourcePrerequisites || []) visit(entities.find((row) => row.sourceEntityRef === ref), new Set([...stack, source.sourceEntityRef]));
    };
    visit(entity);
    let blocked = false;
    for (const source of required) {
      if (!source.bridgeDesignated && !source.sourceMeta?.extractionPlan) continue;
      const options = { projectDir, sourceEntityRef: source.sourceEntityRef, planRef: source.sourceMeta?.extractionPlan, siteBaseUrl };
      let fingerprint;
      try { fingerprint = readinessFingerprint(options); } catch { fingerprint = 'invalid'; }
      if (!checks.has(source.sourceEntityRef) || checks.get(source.sourceEntityRef).fingerprint !== fingerprint) {
        checks.set(source.sourceEntityRef, { fingerprint, result: await validatePluginExtractionReadiness(options) });
      }
      if (!checks.get(source.sourceEntityRef).result.ready) blocked = true;
    }
    if (blocked) results.push({ sourceEntityRef: entity.sourceEntityRef, status: 'deferred' });
    else {
      if (typeof handlers[entity.sourceEntityRef] !== 'function') fail('selected import handler missing');
      results.push(await handlers[entity.sourceEntityRef](entity, selection));
    }
  }
  return results;
}
function selectPluginEntities(entities, selection = {}) {
  // Record status filters are deliberately left to the existing per-record selectors AFTER
  // source readiness. An entity without extracted rows cannot disappear from this inventory.
  const filters = recovery().normalizeSelectionFilters(selection);
  return entities.filter((entity) => (!filters.entity || filters.entity === entity.sourceEntityRef || filters.entity === entity.sourceEntity)
    && (!filters.sourceType || (!entity.sourceType && !entity.sourceTypes?.length)
      || filters.sourceType === entity.sourceType || entity.sourceTypes?.includes(filters.sourceType)));
}
function selectExtractionEntities(entities, selection) {
  const byRef = new Map(entities.map((entity) => [entity.sourceEntityRef, entity]));
  const approved = new Map();
  const visit = (entity, into, stack = new Set()) => {
    if (!entity || stack.has(entity.sourceEntityRef)) fail('missing/cyclic extraction prerequisite');
    if (into.has(entity.sourceEntityRef)) return;
    into.set(entity.sourceEntityRef, entity);
    for (const ref of entity.sourcePrerequisites || []) visit(byRef.get(ref), into, new Set([...stack, entity.sourceEntityRef]));
  };
  entities.filter((entity) => entity.importPlanned).forEach((entity) => visit(entity, approved));
  const selected = new Map();
  selectPluginEntities([...approved.values()], selection).forEach((entity) => visit(entity, selected));
  return [...selected.values()];
}
function planFreshnessReferences({ projectDir, entities }) {
  const refs = new Map();
  for (const entity of entities) {
    const reference = entity.sourceMeta?.extractionPlan;
    if (!reference) continue;
    safeFile(projectDir, reference.path, ['data/wp-discovery']);
    refs.set(reference.path, reference);
    let plan;
    try { plan = loadPlan({ projectDir, sourceEntityRef: entity.sourceEntityRef, planRef: reference }); }
    catch { continue; } // Invalid preparation is held by per-entity readiness, not a global crash.
    const all = [reference, ...plan.evidenceRefs, ...plan.components.flatMap((component) => Object.values(component.readArtifacts)), ...(plan.assembly.module ? [plan.assembly.module] : [])];
    for (const ref of all) refs.set(ref.path, ref);
  }
  return [...refs.values()].sort((a, b) => a.path.localeCompare(b.path));
}
function readinessFingerprint({ projectDir, sourceEntityRef: entity, planRef }) {
  const files = new Set([path.join(projectDir, 'source-schema.json')]);
  const add = (ref) => { if (ref?.path) files.add(safeFile(projectDir, ref.path)); };
  const paths = entityPaths(projectDir, entity);
  files.add(paths.ndjson); files.add(paths['manifest.json']); add(planRef);
  try {
    const plan = json(checkedFile(projectDir, planRef));
    for (const reference of [...plan.evidenceRefs, ...plan.components.flatMap((component) => Object.values(component.readArtifacts)), ...(plan.assembly.module ? [plan.assembly.module] : [])]) add(reference);
    const manifest = json(paths['manifest.json']);
    for (const component of manifest.components) { add(component.manifest); add(component.output); component.readArtifacts.forEach(add); }
    manifest.materializations.forEach(add);
  } catch { /* Missing/invalid files force the full validator; they never become evidence. */ }
  return sha(JSON.stringify([...files].sort().map((file) => {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    return [file, stat?.size, stat?.mtimeMs, stat?.ctimeMs, stat?.ino];
  })));
}
function recovery() {
  return require(fs.existsSync(path.join(__dirname, 'import-recovery.js')) ? './import-recovery.js' : '../../../lib/import-recovery.js');
}
function parseSelectionArgs(args) {
  const raw = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (['--entity', '--source-type'].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) fail(`value required for ${key}`);
      raw[key === '--entity' ? 'entity' : 'sourceType'] = value;
    } else if (['--missing-only', '--failed-only', '--deferred-only', '--unresolved-only'].includes(key)) raw[key.slice(2)] = true;
    else if (['--sample', '--dry-run', '--rerun', '--describe'].includes(key)) raw[key.slice(2)] = true;
    else fail(`unsupported selection argument ${key}`);
  }
  return { ...raw, ...recovery().normalizeSelectionFilters(raw) };
}
function entryDescriptor(runtime, entities, projectDir) {
  if (typeof runtime.describeImport !== 'function') fail('project adapter must describe its actual importer contract');
  const descriptor = runtime.describeImport();
  recovery().assertGeneratedImporterContract(descriptor);
  const readiness = require(fs.existsSync(path.join(__dirname, 'import-readiness-contract.js')) ? './import-readiness-contract.js' : '../../../lib/import-readiness-contract.js').verifyReadinessContract(projectDir, descriptor);
  if (!readiness.ok) fail(readiness.errors.join(';'));
  if (!Array.isArray(descriptor.entityOrder)) fail('project adapter must declare its existing dependency order in entityOrder');
  dependencyOrderedEntities(entities, descriptor.entityOrder);
  return descriptor;
}
async function runGeneratedPluginEntrypoint({ kind, projectDir, entities }, args) {
  // A wrapper cannot vouch for a project's ledger or selectors. Keep the existing
  // importer self-check against the adapter's real configuration before any I/O hooks.
  const adapter = () => require(path.join(projectDir, 'src/project/plugin-runtime.js'));
  const descriptor = kind === 'import' ? entryDescriptor(adapter(), entities, projectDir) : null;
  const runId = crypto.randomUUID();
  const selection = parseSelectionArgs(args);
  if (selection.describe) {
    if (!descriptor) fail('describe is supported only by the import entrypoint');
    process.stdout.write(`${JSON.stringify(descriptor)}\n`); return;
  }
  const schema = json(path.join(projectDir, 'source-schema.json'));
  const siteBaseUrl = sourceIdentity(schema.sourceUrl || schema.source?.url);
  // Loading the adapter/its pure descriptor must have no side effects. Target hooks
  // remain behind readiness; the adapter retains ledger/idempotency/record selectors.
  let results;
  if (selection.sample) {
    results = selectPluginEntities(entities, selection).map((entity) => ({ status: 'preview', sourceEntityRef: entity.sourceEntityRef, rows: adapter().preview?.(entity) || null }));
  } else if (kind === 'import') {
    const approvalsPath = path.join(projectDir, 'orchestration/approvals.json');
    const approval = fs.existsSync(approvalsPath) ? json(approvalsPath) : {};
    if (!['approved', 'provisional'].includes(approval.mapping?.status)) fail('existing mapping review approval is required before import');
    const runtime = adapter();
    if (typeof runtime.preflight !== 'function' || typeof runtime.finalizeImport !== 'function' || typeof runtime.importEntity !== 'function') fail('generated adapter must retain existing preflight, import and finalization');
    const selectedEntities = selectPluginEntities(entities.filter((entity) => entity.importPlanned), selection);
    let preflight;
    const handlers = Object.fromEntries(entities.map((entity) => [entity.sourceEntityRef,
      async (row, filters) => {
        // Run-scoped authorization/mute checks happen once, before the first ready write.
        preflight ||= Promise.resolve().then(() => runtime.preflight({ entities: selectedEntities, selection: filters, projectDir, runId }));
        await preflight;
        return runtime.importEntity({ entity: row, selection: filters, projectDir, runId, dryRun: Boolean(selection['dry-run'] || process.env.DRY_RUN === 'true') });
      }]));
    // Keep the complete source inventory for prerequisite lookup; select only mapped target
    // scopes for dispatch. Discovery alone never grants permission to write that entity.
    const plannedEntities = entities.filter((entity) => entity.importPlanned);
    const selectedRefs = new Set(selectPluginEntities(plannedEntities, selection).map((entity) => entity.sourceEntityRef));
    const dispatchEntities = entities.map((entity) => ({ ...entity, dispatchSelected: selectedRefs.has(entity.sourceEntityRef) }));
    results = await dispatchWithPluginExtractionReadiness({ entities: dispatchEntities, selection, projectDir, siteBaseUrl, entityOrder: descriptor.entityOrder }, handlers);
    if (typeof runtime.finalizeImport !== 'function') fail('generated adapter must retain existing finalization');
    const reader = require('./structure-bridge-reader.js');
    const deferredExtraction = reader.deferredExtractionReportInput(await reader.collectDeferredExtractions(path.join(projectDir, 'data')));
    await runtime.finalizeImport({ results, selection, projectDir, runId, deferredExtraction });
  } else {
    results = [];
    for (const entity of selectExtractionEntities(entities, selection)) {
      if (!entity.bridgeDesignated) { results.push(await adapter().extractNative({ entity, selection, projectDir, runId })); continue; }
      const preparation = await validatePluginExtractionReadiness({ projectDir, sourceEntityRef: entity.sourceEntityRef, planRef: entity.sourceMeta?.extractionPlan, siteBaseUrl, phase: 'preparation' });
      if (!preparation.ready) { results.push({ status: 'deferred', ...preparation }); continue; }
      const transport = await adapter().sourceTransport({ entity, projectDir, siteBaseUrl, runId });
      results.push(await extractBoundPluginEntity({ projectDir, sourceEntityRef: entity.sourceEntityRef, planRef: entity.sourceMeta.extractionPlan, transport }));
    }
    try { await adapter().afterExtraction?.({ results, selection, projectDir, runId }); }
    catch { process.stderr.write('Source-read telemetry could not be filed; extraction evidence is retained.\n'); }
  }
  process.stdout.write(`${JSON.stringify({ runId, results })}\n`);
  return results;
}
module.exports = { sourceIdentity, sourceEntityRef, sha, safeFile, checkedFile, referenceFor, writeJson, writePluginEntityReadPlan, invalidatePluginEntityReadPlan, loadPlan, validatePlan, recordPluginExtractionDeferral, validatePluginExtractionReadiness, extractBoundPluginEntity, dispatchWithPluginExtractionReadiness, selectPluginEntities, planFreshnessReferences, assemble, parseSelectionArgs, runGeneratedPluginEntrypoint };
