'use strict';

// The execution manifest's mechanical part, generated from the codegen scaffold record and the
// approved mapping plan, so codegen never hand-writes it (a hand-written keyField `id` on an
// entity keyed by `slug` reached QA on 11-21). One import task per scaffolded entity:
//
//   id, artifactRefs     the scaffold record's taskId, handler and hooks paths
//   entityRefs           the entity's targetRef (+ refs its composite writes, COMPANION_REFS)
//   sourceBindings       the entity's extract, keyField = the plan's primaryKey, keyPrefix `<entity>:`;
//                        the toolkit's derived guest-contact entities are bound on the contact task
//                        with their fixed role and prefix (DERIVED_KEY_PREFIXES), from the plan's
//                        scope and the order's guest-buyers choice (derivedGuestEntities)
//   writeOperations      the plan's write operation for the targetRef when it has a reviewed contract
//   urlPreservation      for an entity whose plan urlPolicy is public
//   dependency fields    copied from deriveDependencyEdges (the validator's own resolver)
//   mappingPlanDigest    digest(plan), the importer's pin
//
// Choices stay with the agent: it edits the written file (extra entityRefs, tasks for entities
// outside the scaffold, the source-archive task), then validates as before. The validators are
// unchanged; an existing manifest is never overwritten without `force`.

const fs = require('node:fs');
const path = require('node:path');
const { createManifest, DERIVED_KEY_PREFIXES } = require('./execution-manifest.js');

const MANIFEST_PATH = 'execution/execution-manifest.json';
// The toolkit's derived contact entities (order-buyer.js, review-import.js) and their binding role.
const DERIVED_ROLES = Object.freeze({ 'guest-buyer-contact': 'derived-guest-buyer-contact', 'guest-review-contact': 'derived-guest-review-contact' });
// Refs a composite writes beside its own entity: the product composite writes the selection
// customizations its modifiers connect to (the product task must own them, or the writes are
// refused as DEPENDENCY_TASK_MISMATCH). Added only when no other task owns the ref.
const COMPANION_REFS = Object.freeze({ 'stores/product': ['stores/product-customization'] });
const STATE = Object.freeze({ crosswalkAuthority: 'local', crosswalkPath: 'state/crosswalk/crosswalk.ndjson', attemptJournalPath: 'state/attempts/write-attempts.ndjson', cmsMirror: { mode: 'none' } });
const URL_PRESERVATION = Object.freeze({ enabled: true, basePathsPath: 'state/url-preservation/base-paths.json', ledgerPath: 'state/url-preservation/url-ledger.ndjson',
  redirectsPath: 'state/url-preservation/redirects.ndjson', unresolvedPath: 'state/url-preservation/unresolved.ndjson', applyRedirects: false });

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const extractPaths = (sourceEntity) => ({ manifestPath: `data/source-extract/${sourceEntity}.manifest.json`, extractPath: `data/source-extract/${sourceEntity}.ndjson` });

function binding(planEntity, row) {
  const role = DERIVED_ROLES[row.sourceEntity];
  return role
    // Derived rows carry the toolkit's own `id` (the codegen contract's fixed binding).
    ? { ref: row.targetRef, sourceEntity: row.sourceEntity, role, keyField: 'id', keyPrefix: DERIVED_KEY_PREFIXES[role], ...extractPaths(row.sourceEntity) }
    : { ref: row.targetRef, sourceEntity: row.sourceEntity, keyField: (planEntity && planEntity.primaryKey) || 'id', keyPrefix: `${row.sourceEntity}:`, ...extractPaths(row.sourceEntity) };
}

// The derived guest contacts the contact task binds. They are never plan entities: the toolkit
// derives them from the order and review extracts (reader-catalog `deriver`), so they follow the
// entities that need them and the operator's choice, never a plan row:
//   guest-buyer-contact   when order is in scope and its `guest-buyers` choice is import-as-contacts
//                         (the default); email-only and not-imported bind none
//   guest-review-contact  when product-review is in scope
// Only when the extract exists. An older plan that still has a guest entity row is read the same way.
const GUEST_BUYERS_DEFAULT = 'import-as-contacts';
function guestBuyersChoice(plan) {
  const entities = Array.isArray(plan && plan.entities) ? plan.entities : [];
  const order = entities.find((e) => e && e.sourceEntity === 'order');
  const value = order ? require('./output-applicability.js').planChoiceValues(order)['guest-buyers'] : undefined;
  return value == null ? GUEST_BUYERS_DEFAULT : value;
}
function derivedGuestEntities(projectDir, plan, entities) {
  const resolved = Array.isArray(plan && plan.executionScope && plan.executionScope.resolvedEntityRefs) ? new Set(plan.executionScope.resolvedEntityRefs) : null;
  const inScope = (name) => (resolved ? resolved.has(name) : entities.some((e) => e && e.sourceEntity === name && e.inUse !== false));
  const has = (name) => fs.existsSync(path.join(projectDir, extractPaths(name).extractPath));
  return [
    ...(inScope('order') && guestBuyersChoice(plan) === GUEST_BUYERS_DEFAULT && has('guest-buyer-contact') ? ['guest-buyer-contact'] : []),
    ...(inScope('product-review') && has('guest-review-contact') ? ['guest-review-contact'] : []),
  ];
}

// The plan's write operations for the entity's own targetRef that have a reviewed operation contract.
function writeOperationsOf(planEntity) {
  const { operationContract } = require('./dependency-proofs.js');
  const ops = new Set();
  for (const decision of (planEntity && planEntity.fieldMappings) || []) {
    if (decision.disposition === 'excluded') continue;
    for (const output of decision.outputs || []) if (output.targetRef === planEntity.targetRef && output.writeOperation) ops.add(output.writeOperation);
  }
  const reviewed = [...ops].filter((op) => { try { return Boolean(operationContract(planEntity.targetRef, op)); } catch { return false; } });
  return reviewed.length === 1 ? { [planEntity.targetRef]: reviewed[0] } : null;
}

// The manifest object (not written). `derive` is deriveDependencyEdges, injectable for tests.
async function generateManifest(projectDir, { plan = readJson(path.join(projectDir, 'mapping/mapping-plan.json')),
  scaffold = readJson(path.join(projectDir, 'execution/codegen-scaffold.json')), derive = null } = {}) {
  const { digest } = require('./mapping-field-contract.js');
  // The scaffold names plan entities by sourceEntity (raw `entities[]`, else the legacy containers).
  const entities = Array.isArray(plan.entities) ? plan.entities : require('./website-handoff.js').readEntityMappings(plan);
  const planEntity = (name) => entities.find((e) => e && [e.sourceEntity, e.sourceEntityRef, e.entityKey].includes(name)) || null;
  const rows = (scaffold.entities || []).filter((row) => row && row.sourceEntity && row.taskId && row.targetRef);
  // Derived guest contacts ride on the contact task; with no other contact entity, the first one hosts.
  // A plan row for a derived entity (older plans) still binds it, except guest buyers the choice turns off.
  const offByChoice = guestBuyersChoice(plan) !== GUEST_BUYERS_DEFAULT ? ['guest-buyer-contact'] : [];
  const wanted = [...new Set([...derivedGuestEntities(projectDir, plan, entities), ...rows.filter((row) => DERIVED_ROLES[row.sourceEntity]).map((row) => row.sourceEntity)])]
    .filter((name) => !offByChoice.includes(name));
  const scaffoldRows = rows.filter((row) => !DERIVED_ROLES[row.sourceEntity] || wanted.includes(row.sourceEntity));
  const host = scaffoldRows.find((row) => row.targetRef === 'crm/contact' && !DERIVED_ROLES[row.sourceEntity]) || scaffoldRows.find((row) => DERIVED_ROLES[row.sourceEntity]);
  const derivedRows = wanted.map((name) => scaffoldRows.find((row) => row.sourceEntity === name) || { sourceEntity: name, targetRef: 'crm/contact' });
  const tasks = [];
  for (const row of scaffoldRows) {
    if (DERIVED_ROLES[row.sourceEntity] && row !== host) continue;
    const entity = planEntity(row.sourceEntity);
    const bindings = [binding(entity, row)];
    if (row === host) for (const derived of derivedRows) if (derived.sourceEntity !== row.sourceEntity) bindings.push(binding(planEntity(derived.sourceEntity), derived));
    const writeOperations = writeOperationsOf(entity);
    tasks.push({ id: row.taskId, kind: 'import', status: 'pending', entityRefs: [row.targetRef], dependsOn: [], dependencyRefs: [], dependencyEdges: [],
      artifactRefs: [row.handlerPath, row.hooksPath].filter(Boolean), sourceBindings: bindings, state: structuredClone(STATE),
      ...(writeOperations ? { writeOperations } : {}),
      ...(entity && entity.urlPolicy && entity.urlPolicy.public ? { urlPreservation: { ...URL_PRESERVATION } } : {}) });
  }
  const owned = new Set(tasks.flatMap((t) => t.entityRefs));
  for (const task of tasks) for (const ref of COMPANION_REFS[task.entityRefs[0]] || []) if (!owned.has(ref)) { task.entityRefs.push(ref); owned.add(ref); }
  const mappingPlanDigest = digest(plan);
  const generatedArtifacts = [...new Set([...((scaffold.handoff && scaffold.handoff.files) || []), ...(scaffold.files || []).map((f) => f.path), ...tasks.flatMap((t) => t.artifactRefs)])];
  const manifest = createManifest({ projectId: path.basename(path.resolve(projectDir)), planVersion: `mapping-${mappingPlanDigest.slice(0, 12)}`, tasks, mappingPlanDigest,
    generatedArtifacts, llmHandoff: 'execution/llm-handoff.json' });
  manifest.taskOrchestration = 'shared-v1';
  const derived = await (derive || require('./dependency-readiness.js').deriveDependencyEdges)(projectDir, manifest);
  for (const task of manifest.tasks) if (derived.tasks && derived.tasks[task.id]) Object.assign(task, derived.tasks[task.id]);
  return { manifest, derivedOk: derived.ok, derivedErrors: derived.errors || [] };
}

// Writes execution/execution-manifest.json. An existing file is the agent's edited copy: kept
// unless `force`.
async function writeGeneratedManifest(projectDir, { force = false, ...options } = {}) {
  const file = path.join(projectDir, MANIFEST_PATH);
  if (fs.existsSync(file) && !force) return { written: false, reason: 'exists', path: MANIFEST_PATH };
  const result = await generateManifest(projectDir, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(result.manifest, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { written: true, path: MANIFEST_PATH, tasks: result.manifest.tasks.length, derivedOk: result.derivedOk, derivedErrors: result.derivedErrors };
}

module.exports = { generateManifest, writeGeneratedManifest, MANIFEST_PATH, DERIVED_ROLES, guestBuyersChoice, derivedGuestEntities };
