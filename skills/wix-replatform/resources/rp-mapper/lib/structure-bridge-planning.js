'use strict';

// Mapping-stage planning for structure-bridge-plugin entities .
//
// A plugin entity whose only read path is wix-wp-plugin-v2's /query is two different things,
// and this module keeps them apart:
//
//   - A PLANNED ENTITY: the profile proposes a Wix target (`candidateTargetRefs[]`), so the table
//     becomes a migration entity in its own right. It gets `mapping/entity-decisions/<entity>.json`
//     and a row in `mapping/mapping-plan.json`, under the same mapping-review gate as a REST
//     entity, and rp-import-codegen generates a normal incremental reader for it
//     (rp-source-wordpress/lib/structure-bridge-reader.js).
//   - A BLOCKED-FIELD SOURCE: no candidate target; the data only fills a field on a target that
//     is planned through another source (for example gift-card balance). That stays on the
//     blockedSourceDependencies / blocked-data-requests.js path, unchanged.
//
// A target entity may declare a blockedSourceDependency on a source that is ALSO planned here
// as its own entity (ecom/discount-rule on discount-rule-definition). Routing it through both
// paths would offer the same table as a one-shot blocked-data request that can never resolve,
// so partitionBlockedSourceDependencies() removes that dependency before the blocked-data
// builder runs and records it on the planned entity's decision instead.
//
// Readiness is the only thing checked through blocked-data-handlers.js; data is never resolved
// through blocked-data-requests.js's snapshot mechanism.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { fulfillmentReadiness } = require('../../rp-source-wordpress/lib/blocked-data-handlers.js');
const { readEntityByRef } = require('../../rp-target-wix/lib/domain-knowledge.js');
const { verifyEavReadPlanIntegrity } = require('../../rp-source-wordpress/lib/wix-wp-plugin-v2-client.js');

const DEFAULT_DOMAINS_DIR = path.join(__dirname, '..', '..', 'rp-target-wix', 'domains');
const REVIEW_GATE = Object.freeze({ artifact: 'orchestration/approvals.json', field: 'mapping.status' });
const PLAN_ROW_KEYS = ['entityMappings', 'entityDecisions', 'mappings', 'entities'];

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
}

function sourceEntityRefOf(plugin, entity) {
  return `plugin.${plugin}.${entity}`;
}

function structureBridgeFulfillment(entity) {
  const blockers = [...(entity.blocked || []), ...((entity.pitfalls || []).flatMap((p) => p.blocked || []))];
  const hit = blockers.find((b) => b.fulfillment && b.fulfillment.kind === 'structure-bridge-plugin');
  return hit ? hit.fulfillment : null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** A discovery artifact that is not valid JSON is a pending reason, not a crashed mapping run. */
async function readArtifact(filePath, fileName, pendingReasons) {
  try {
    return await readJsonIfExists(filePath);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    pendingReasons.push(`discovery artifact ${fileName} is not valid JSON -- re-run discovery for this table`);
    return null;
  }
}

/** Why an EAV read plan cannot drive extraction, or null. Mirrors the reader's own checks. */
function eavPlanIntegrityReason(plan, planFile) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return `read plan ${planFile} is not an object -- re-run discovery for this table`;
  let problem;
  try { problem = verifyEavReadPlanIntegrity(plan); } catch (error) { problem = error.message; }
  if (!Array.isArray(plan.pairs)) problem = problem || 'it has no pairs array';
  return problem ? `read plan ${planFile} fails its integrity check, so extraction would defer: ${problem}` : null;
}

function loadTarget(domainsDir, ref) {
  try { return readEntityByRef(domainsDir, ref); } catch { return null; }
}

/**
 * Classify every structure-bridge-plugin entity of the detected plugins.
 *
 * @param plugins   [{ plugin, entities: [...] }] -- profiles or wp-plugin-detect's detected list
 * @param dataDir   the project's `data/` directory (discovery sidecars live in wp-discovery/)
 * @param readiness optional override of blocked-data-handlers.js's fulfillmentReadiness
 * @returns { decisions, blockedFieldSources }
 */
async function planStructureBridgeEntities({ plugins = [], sourceEntities = null, dataDir, readiness = fulfillmentReadiness, domainsDir = DEFAULT_DOMAINS_DIR } = {}) {
  if (!dataDir) throw new Error('planStructureBridgeEntities needs dataDir');
  if (sourceEntities === null) {
    const schema = await readJsonIfExists(path.join(path.dirname(path.resolve(dataDir)), 'source-schema.json'));
    sourceEntities = Array.isArray(schema?.entities) ? schema.entities
      : Object.entries(schema?.entities || {}).map(([key, row]) => ({ sourceEntityRef: key, ...row }));
  }
  const decisions = [];
  const blockedFieldSources = [];
  const boundRefs = new Set();
  const bound = require('../../rp-source-wordpress/lib/plugin-entity-read-plan.js');
  for (const entity of sourceEntities) {
    const planRef = entity.sourceMeta?.extractionPlan;
    if (!planRef && !entity.bridgeDesignated) continue;
    const sourceEntityRef = entity.sourceEntityRef;
    boundRefs.add(sourceEntityRef);
    const pendingReasons = [];
    let plan;
    try { plan = bound.loadPlan({ projectDir: path.dirname(dataDir), sourceEntityRef, planRef }); }
    catch (error) {
      pendingReasons.push(error.message);
      bound.recordPluginExtractionDeferral({ projectDir: path.dirname(dataDir), sourceEntityRef, planRef, code: error.code || 'plan-invalid', reason: error.message });
    }
    const candidates = entity.candidateTargetRefs || entity.sourceMeta?.candidateTargetRefs || [];
    if (!candidates.length) {
      blockedFieldSources.push({ sourceEntityRef, sourceEntity: entity.entity || sourceEntityRef, table: plan?.components.length === 1 ? plan.components[0].table : null, route: 'blocked-source-dependency' });
      continue;
    }
    const targetRef = candidates[0];
    const target = loadTarget(domainsDir, targetRef);
    if (!target) pendingReasons.push(`candidate target ${targetRef} is not in the Wix domain knowledge`);
    decisions.push({ schemaVersion: 1, sourceEntityRef, sourceEntity: sourceEntityRef,
      sourcePlugin: sourceEntityRef.split('.')[1], sourceMeta: { ...entity.sourceMeta }, bridgeDesignated: true,
      sourceType: entity.sourceType || null, sourcePrerequisites: entity.sourcePrerequisites || [],
      resolution: 'structure-bridge-reader', fulfillment: { kind: 'structure-bridge-plugin', handlerId: 'wix-wp-plugin-v2' },
      targetRef, targetDomain: targetRef.split('/')[0], targetEntity: targetRef.split('/')[1], targetClassification: target?.target?.classification || null, candidateTargetRefs: candidates,
      confidence: 'proposed', status: pendingReasons.length ? 'pending' : 'migration-planned', pendingReasons,
      readiness: { ready: Boolean(plan), reason: pendingReasons.join('; ') || null }, readVariant: 'entity-plan',
      readArtifacts: { extractionPlan: planRef || null },
      sourceExtract: { ndjson: `data/source-extract/${sourceEntityRef}.ndjson`, manifest: `data/source-extract/${sourceEntityRef}.manifest.json` },
      supersedesBlockedDependencies: [], reviewGate: { ...REVIEW_GATE } });
  }
  for (const plugin of plugins) {
    for (const entity of plugin.entities || []) {
      const fulfillment = structureBridgeFulfillment(entity);
      if (!fulfillment) continue;
      const sourceEntityRef = sourceEntityRefOf(plugin.plugin, entity.entity);
      if (boundRefs.has(sourceEntityRef)) continue;
      const candidateTargetRefs = [...(entity.candidateTargetRefs || [])];
      if (candidateTargetRefs.length === 0) {
        blockedFieldSources.push({ sourceEntityRef, sourceEntity: entity.entity, table: fulfillment.table, route: 'blocked-source-dependency' });
        continue;
      }

      const requestFile = `wix-wp-plugin-v2--${slugify(fulfillment.table)}.structure-request.json`;
      const planFile = `wix-wp-plugin-v2--${slugify(fulfillment.table)}.eav-read-plan.json`;
      const artifactReasons = [];
      // eslint-disable-next-line no-await-in-loop
      const [request, plan, ready] = await Promise.all([
        readArtifact(path.join(dataDir, 'wp-discovery', requestFile), requestFile, artifactReasons),
        readArtifact(path.join(dataDir, 'wp-discovery', planFile), planFile, artifactReasons),
        readiness(fulfillment),
      ]);
      const targetRef = candidateTargetRefs[0];
      const target = loadTarget(domainsDir, targetRef);
      const pendingReasons = [...artifactReasons];
      if (!ready || ready.ready !== true) pendingReasons.push(`handler not ready: ${(ready && ready.reason) || 'unknown'}`);
      if (!target) pendingReasons.push(`candidate target ${targetRef} is not in the Wix domain knowledge`);
      if (!request && !plan && artifactReasons.length === 0) pendingReasons.push(`discovery produced no read artifact (${requestFile}) -- the table was not sampled successfully`);
      const integrity = plan ? eavPlanIntegrityReason(plan, planFile) : null;
      if (integrity) pendingReasons.push(integrity);
      if (plan && Array.isArray(plan.droppedIdentityColumns) && plan.droppedIdentityColumns.length > 0) {
        pendingReasons.push(`read plan drops identity column(s) ${plan.droppedIdentityColumns.join(', ')}; complete identity is required -- narrow the mapping or redesign the read plan`);
      }
      if (plan && plan.keysTruncated) pendingReasons.push('read plan key list is truncated, so the extraction cannot be whole-table');

      decisions.push({
        schemaVersion: 1,
        sourceEntity: entity.entity,
        sourceEntityRef,
        sourcePlugin: plugin.plugin,
        capability: entity.capability || null,
        channel: entity.channel || null,
        resolution: 'structure-bridge-reader',
        fulfillment: { kind: fulfillment.kind, handlerId: fulfillment.handlerId, table: fulfillment.table },
        readiness: { ready: Boolean(ready && ready.ready), reason: (ready && ready.reason) || null },
        targetRef,
        targetDomain: targetRef.split('/')[0],
        targetEntity: targetRef.split('/')[1],
        targetClassification: target && target.target ? target.target.classification : null,
        candidateTargetRefs,
        confidence: 'proposed',
        status: pendingReasons.length === 0 ? 'migration-planned' : 'pending',
        pendingReasons,
        readVariant: plan ? 'eav' : 'single-request',
        readArtifacts: {
          structureRequest: request ? `data/wp-discovery/${requestFile}` : null,
          eavReadPlan: plan ? `data/wp-discovery/${planFile}` : null,
        },
        sourceExtract: {
          ndjson: `data/source-extract/${entity.entity}.ndjson`,
          manifest: `data/source-extract/${entity.entity}.manifest.json`,
        },
        supersedesBlockedDependencies: [],
        reviewGate: { ...REVIEW_GATE },
      });
    }
  }
  return { decisions, blockedFieldSources };
}

/**
 * Remove blockedSourceDependencies whose source is planned as its own entity, so the
 * blocked-data builder never also requests it. Returns new target objects (inputs untouched) and
 * records each removed dependency on the matching decision.
 */
function partitionBlockedSourceDependencies(targetEntities = [], decisions = []) {
  const byRef = new Map(decisions.map((d) => [d.sourceEntityRef, d]));
  const targets = targetEntities.map((target) => {
    const deps = Array.isArray(target.blockedSourceDependencies) ? target.blockedSourceDependencies : [];
    const kept = [];
    for (const dep of deps) {
      const decision = byRef.get(dep.sourceEntityRef);
      if (!decision) { kept.push(dep); continue; }
      const targetEntity = target.ref || `${target.domain}/${target.entity}`;
      if (!decision.supersedesBlockedDependencies.some((s) => s.targetEntity === targetEntity && s.degradedField === dep.degradedField)) {
        decision.supersedesBlockedDependencies.push({ targetEntity, degradedField: dep.degradedField, pitfallCode: dep.pitfallCode });
      }
    }
    return { ...target, blockedSourceDependencies: kept };
  });
  return { targetEntities: targets, decisions };
}

// Fields rp-mapper or the operator may already have set on a row, which a planning rerun keeps.
// Everything else planning emits is bridge-owned structure (target, readiness, read variant,
// artifacts, planner-owned status) and is refreshed; fields planning never emits -- field mappings,
// transformations, relationships, notes, operator edits -- are always preserved.
const PRESERVED_WHEN_SET = ['confidence'];

/** Merge a bridge decision into an existing row without erasing the mapping work on it. */
function mergeBridgeRow(existing, decision) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return { ...decision };
  const merged = { ...existing, ...decision };
  // Only the planner's own provisional states may refresh. Reviewed exclusions,
  // manual routing and other mapping decisions retain their status and reason.
  if (existing.status && !['pending', 'migration-planned'].includes(existing.status)) merged.status = existing.status;
  if (decision.readVariant === 'entity-plan' && existing.targetRef) {
    for (const key of ['targetRef', 'targetDomain', 'targetEntity', 'targetClassification']) {
      if (existing[key] !== undefined) merged[key] = existing[key];
    }
  }
  for (const key of PRESERVED_WHEN_SET) {
    if (existing[key] !== undefined && existing[key] !== null) merged[key] = existing[key];
  }
  return merged;
}

function upsertPlanRows(plan, decisions) {
  if (plan.entities && typeof plan.entities === 'object' && !Array.isArray(plan.entities)
    && !PLAN_ROW_KEYS.some((k) => Array.isArray(plan[k]))) {
    for (const d of decisions) plan.entities[d.sourceEntity] = mergeBridgeRow(plan.entities[d.sourceEntity], d);
    return plan;
  }
  const key = PLAN_ROW_KEYS.find((k) => Array.isArray(plan[k])) || 'entityDecisions';
  const rows = Array.isArray(plan[key]) ? plan[key] : [];
  for (const d of decisions) {
    const index = rows.findIndex((row) => row && (row.sourceEntityRef === d.sourceEntityRef || (row.sourceEntity || row.entityName || row.entityKey) === d.sourceEntity));
    const decision = key === 'entities' ? { entityKey: index >= 0 ? rows[index].entityKey || d.sourceEntity : d.sourceEntity, ...d } : d;
    if (index >= 0) rows[index] = mergeBridgeRow(rows[index], decision); else rows.push(mergeBridgeRow(null, decision));
  }
  plan[key] = rows;
  return plan;
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const staging = `${filePath}.writing`;
  await fsp.writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(staging, filePath);
}

/**
 * Write the planned entities into the mapping artifacts. Refuses once the mapping review has
 * been approved: adding an entity after the gate would skip the review it depends on.
 */
async function writeStructureBridgePlanning(projectDir, decisions) {
  if (!projectDir) throw new Error('writeStructureBridgePlanning needs projectDir');
  const approvals = await readJsonIfExists(path.join(projectDir, 'orchestration', 'approvals.json'));
  const gate = approvals && approvals.mapping && approvals.mapping.status;
  if (gate === 'approved' || gate === 'provisional') {
    throw new Error(`mapping review is already ${gate}; re-open the mapping review before adding structure-bridge-plugin entities`);
  }
  const decisionPaths = [];
  for (const decision of decisions) {
    const filePath = path.join(projectDir, 'mapping', 'entity-decisions', `${slugify(decision.sourceEntity)}.json`);
    // eslint-disable-next-line no-await-in-loop
    await writeJson(filePath, mergeBridgeRow(await readJsonIfExists(filePath), decision));
    decisionPaths.push(filePath);
  }
  const planPath = path.join(projectDir, 'mapping', 'mapping-plan.json');
  const plan = (await readJsonIfExists(planPath)) || {};
  await writeJson(planPath, upsertPlanRows(plan, decisions));
  return { decisionPaths, planPath };
}

module.exports = {
  REVIEW_GATE,
  planStructureBridgeEntities,
  partitionBlockedSourceDependencies,
  writeStructureBridgePlanning,
  sourceEntityRefOf,
};
