'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const capability = require('./execution-capability');
const local = require('./local-state');
const setup = require('./setup-verification');
const { SETUP_CHECK_METHODS } = require('./setup-check-methods.js');
const census = require('./census-reconciliation');
const recovery = require('./dependency-recovery');
const proofs = require('./dependency-proofs');
const assessments = require('./operation-assessments');
const { readEntityMappings } = require('./website-handoff');
const { requiredAppsFor } = require('./app-requirements');
const evaluations = new WeakMap();
const evaluationGenerations = new WeakMap();
const grants = new WeakMap();
const indexes = new Map();
const subscriptions = new Map();
const PASS_FILE = 'state/readiness/task-passes.ndjson';
const SELECTIVE = new Set(['full', 'entity', 'source-type', 'missing-only', 'failed-only', 'deferred-only', 'unresolved-only']);
// A finished producer releases its dependents; only records naming a parent that cannot land stop.
const SETTLED = new Set(['complete', 'complete-with-holds', 'finished-partial', 'empty', 'setup-passed', 'excluded-approved', 'proven', 'inherited']);
const PARENT_NOT_FINAL = new Set(['failed_retryable', 'started', 'deferred']);
function linkChoice(entityRefs, ref) {
  return entityRefs.every(entityRef => domain(entityRef).dependencyFailureActions?.[ref] === 'offer-omit') ? 'offer-omit' : 'fix-only';
}
function linkRequired(entityRefs, ref) {
  return entityRefs.some(entityRef => (domain(entityRef).dependencyLinkRequired || []).includes(ref));
}
const refPattern = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function evidenceReason(error) { return /^(?:dependency_|readiness_|mapping_plan_|entity_ref_|task_depends_on_|site_id_|plan_digest_)[a-zA-Z0-9_:\-/;,]+$/.test(error.message || '') ? error.message : error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING' ? 'dependency-evidence-missing' : 'dependency-evidence-invalid'; }
function read(projectDir, file, fallback) {
  try { return JSON.parse(fs.readFileSync(inside(projectDir, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && arguments.length === 3) return fallback; throw error; }
}
// Read-only inputs parsed once per on-disk identity (inode, size, mtime, ctime): a rewritten
// file re-parses, so the digests below still see every change.
function readCached(projectDir, file, fallback) { return require('./cached-json').readJson(inside(projectDir, file), fallback); }
function inside(projectDir, file) {
  const root = path.resolve(projectDir), absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) throw new Error('DEPENDENCY_PATH_OUTSIDE_PROJECT');
  return absolute;
}
const digestCache = new Map(), snapshotCache = new Map();
function fileDigest(projectDir, file) { const absolute = inside(projectDir, file), stamp = statKey(absolute), prior = digestCache.get(absolute); if (prior?.stamp === stamp) return prior.digest; const digest = hash(fs.readFileSync(absolute)); digestCache.set(absolute, { stamp, digest }); return digest; }
function domain(ref) {
  const result=proofs.domain(ref),plan=assessments.current()?.plan;
  if (!plan?.operationAssessments?.length) return result;
  const operations=[...new Set(readEntityMappings(plan).filter(r=>r.targetRef===ref).map(proofs.resolveRowOperation).map(r=>r.operation).filter(Boolean))];
  if(operations.length!==1)return result;
  const supplement=proofs.operationContract(ref,operations[0])?.contract.assessmentReferenceFields;
  if(!supplement)return result;
  result.dependsOn=proofs.applicableDependsOn(ref,operations[0]);
  result.dependencyReferenceFields ||= {};
  for(const [dependency,paths] of Object.entries(supplement)) result.dependencyReferenceFields[dependency]=[...new Set([...(result.dependencyReferenceFields[dependency] || []),...paths])];
  return result;
}
function edgeMode(task, ref, producer) {
  if (['setup-step', 'pending-setup'].includes(producer?.kind)) return 'task-complete';
  const modes = task.entityRefs.map(entity => domain(entity).dependencyModes?.[ref] || 'task-complete');
  return modes.every(mode => mode === 'per-record') ? 'per-record' : 'task-complete';
}
// Target knowledge's `legacyTaskCompleteEdges`: refs that became per-record after manifests had
// shipped them as task-complete. Such a manifest keeps its edge (from an import task, a disposition
// or a proof): it waits for at least as much, so the import it already ran is never refused. Any
// other stale mode is refused and regenerated. Secondary and child identities resolve
// only per record, so those edges always match exactly.
const PER_RECORD_ONLY = new Set(['secondary-output', 'child-output']);
function keptTaskEdge(task, ref, emitted, derived, producer) {
  return emitted === 'task-complete' && derived === 'per-record' && !PER_RECORD_ONLY.has(producer?.kind) && task.entityRefs.every(entity => (domain(entity).legacyTaskCompleteEdges || []).includes(ref));
}
function edgeModeAccepted(task, ref, emitted, derived, producer) { return emitted === derived || keptTaskEdge(task, ref, emitted, derived, producer); }
// The reference paths of such a kept task-complete edge were declared after its manifest was
// emitted, so its payloads are checked as they were then: not at those paths.
function checkedRefs(task) {
  return (task.dependencyRefs || []).filter(ref => { const edge = (task.dependencyEdges || []).find(row => row.ref === ref); return !(edge && keptTaskEdge(task, ref, edge.mode, edgeMode(task, ref, edge.producer), edge.producer)); });
}
// Producer-independent: a stale emitted mode fails before producers or dispositions load.
// Run with the project's mapping plan in scope: plan assessments can set dependencyModes.
function dependencyModeErrors(projectDir, manifest) {
  const errors = [];
  for (const task of (manifest.tasks || []).filter(row => row.kind === 'import')) for (const edge of task.dependencyEdges || []) {
    try { if (!edgeModeAccepted(task, edge.ref, edge.mode, edge.producer?.kind === 'inherited' ? 'task-complete' : edgeMode(task, edge.ref, edge.producer), edge.producer)) errors.push(`dependency_edge_mode_mismatch:${task.id}:${edge.ref}`); } catch (e) { errors.push(e.message); }
  }
  return errors;
}
// Every edge has exactly one producer: an import task, all bound setup steps, an approved census
// disposition, a validated noProducer proof for the exact dependent operation, a
// member task's verified secondary identities, a product task's verified child identities (its
// variants), or -- for a transitive ref, or a child ref with no child producer -- the dependency that
// carries it (`inherited`). The graph is resolved by the shared pure resolver the
// mapper preflight also uses; this adapter supplies the manifest's real tasks and setup steps.
function bindDependencyProducers({ manifest, setupPlan, dispositions = {}, proofs: validProofs = new Map(), scopeRefs = [], adoptOnlyRefs = [], adoptOnlyMixed = [] }) {
  const result = {}, errors = [], available = new Set(scopeRefs);
  for (const task of manifest.tasks || []) for (const ref of task.entityRefs || []) { available.add(ref); try { domain(ref); } catch (e) { errors.push(e.message); } }
  const imports = (manifest.tasks || []).filter(task => task.kind === 'import');
  for (const task of imports) if (task.writeOperations !== undefined && (!task.writeOperations || typeof task.writeOperations !== 'object' || Object.entries(task.writeOperations).some(([ref, op]) => !(task.entityRefs || []).includes(ref) || typeof op !== 'string' || !op))) errors.push(`task_write_operations_invalid:${task.id}`);
  const graph = resolveManifestGraph({ manifest, setupPlan, dispositions, proofs: validProofs, adoptOnlyRefs, adoptOnlyMixed });
  errors.push(...graph.errors.filter(error => !error.startsWith('entity_ref_unknown:')));
  for (const task of imports) {
    const resolved = graph.tasks[task.id] || { refs: [], edges: [], dependsOn: [] };
    if (!equal([...(task.dependencyRefs || [])].sort(), resolved.refs)) errors.push(`dependency_refs_mismatch:${task.id}`);
    for (const { ref, mode, producer } of resolved.edges) {
      result[ref] = producer;
      const emitted = (task.dependencyEdges || []).find(edge => edge.ref === ref);
      if (!emitted) errors.push(`dependency_edge_missing:${task.id}:${ref}`);
      else if (!edgeModeAccepted(task, ref, emitted.mode, mode, producer)) errors.push(`dependency_edge_mode_mismatch:${task.id}:${ref}`);
      else if (!equal(emitted.producer, producer)) errors.push(`dependency_edge_producer_mismatch:${task.id}:${ref}`);
    }
    if ((task.dependencyEdges || []).length !== resolved.refs.length) errors.push(`dependency_edge_coverage:${task.id}`);
    if (!equal([...(task.dependsOn || [])].sort(), resolved.dependsOn)) errors.push(`task_depends_on_mismatch:${task.id}`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], producers: result };
}
function resolveManifestGraph({ manifest, setupPlan, dispositions = {}, proofs: validProofs = new Map(), adoptOnlyRefs = [], adoptOnlyMixed = [] }) {
  const dependents = (manifest.tasks || []).filter(task => task.kind === 'import').map(task => ({ id: task.id, entityRefs: task.entityRefs || [], operations: task.writeOperations || {}, ...(task.adoptOnly === true ? { adoptOnly: true } : {}) }));
  // An entity an import task writes is owned by that import: a setup step may not also claim it.
  const importRefs = new Set(dependents.flatMap(task => task.entityRefs));
  const claims = (setupPlan.steps || []).flatMap(step => (step.entityRefs || []).filter(ref => importRefs.has(ref)).map(ref => `setup_step_claims_import_entity:${step.id}:${ref}`));
  const setupFor = ref => { if (importRefs.has(ref)) return null; const stepIds = (setupPlan.steps || []).filter(step => (step.entityRefs || []).includes(ref)).map(step => step.id).sort(); return stepIds.length ? { kind: 'setup-step', stepIds } : null; };
  const graph = proofs.resolveDependencyGraph({ dependents, imports: dependents, setupFor, dispositions, proofs: validProofs, adoptOnlyRefs, adoptOnlyMixed });
  return claims.length ? { ...graph, ok: false, errors: [...claims, ...graph.errors] } : graph;
}
// For codegen: the dependencyRefs/dependencyEdges/dependsOn each import task must emit, from the
// same resolver the manifest validator uses, so a generated manifest never hand-derives a producer.
async function deriveDependencyEdges(projectDir, manifest) {
  const adapter = await loadDependencyDispositions(projectDir);
  const graph = resolveManifestGraph({ manifest, setupPlan: read(projectDir, 'setup/setup-plan.json'), dispositions: adapter.dispositions, proofs: adapter.proofs, adoptOnlyRefs: adapter.adoptOnlyRefs, adoptOnlyMixed: adapter.adoptOnlyMixed });
  return { ok: graph.ok, errors: graph.errors, tasks: Object.fromEntries(Object.entries(graph.tasks).map(([id, task]) => [id, { dependencyRefs: task.refs, dependencyEdges: task.edges, dependsOn: task.dependsOn }])) };
}
function validateAssociations({ plan, reconciliation }) {
  const errors = [], bindings = new Map(), rows = new Map((reconciliation?.rows || []).map(row => [row.censusId, row]));
  for (const binding of plan?.dependencyBindings || []) {
    if (!refPattern.test(binding.ref) || bindings.has(binding.ref) || !Array.isArray(binding.censusIds) || !binding.censusIds.length || new Set(binding.censusIds).size !== binding.censusIds.length) {
      errors.push(`dependency_binding_invalid:${binding.ref}`); continue;
    }
    try { domain(binding.ref); } catch (e) { errors.push(e.message); }
    for (const id of binding.censusIds) if (!rows.has(id) || !rows.get(id).decisionRow) errors.push(`dependency_binding_census_unknown:${id}`);
    bindings.set(binding.ref, binding.censusIds);
  }
  for (const row of readEntityMappings(plan)) {
    const { ids } = census.planCensusIds(row, [...rows.values()]);
    if (!row.targetRef || !refPattern.test(row.targetRef)) { errors.push('dependency_target_ref_missing'); continue; }
    if (!bindings.has(row.targetRef) || ids.some(id => !bindings.get(row.targetRef).includes(id))) errors.push(`dependency_binding_incomplete:${row.targetRef}`);
  }
  const rules = [];
  for (const row of rows.values()) for (const rule of row.dependencyFieldRules || []) {
    const key = `${row.censusId}:${rule.dependentRef}:${rule.dependencyRef}:${rule.path}`;
    const valid = ['omit', 'defer'].includes(rule.action) && typeof rule.path === 'string' && /^\w+(?:\[\])?(?:\.\w+(?:\[\])?)*$/.test(rule.path);
    let known = false;
    try { const d = domain(rule.dependentRef); known = (d.dependsOn || []).includes(rule.dependencyRef) && (d.dependencyReferenceFields?.[rule.dependencyRef] || []).includes(rule.path); } catch {}
    if (!valid || !known || !bindings.get(rule.dependencyRef)?.includes(row.censusId) || rules.some(prior => prior.key.startsWith(`${row.censusId}:${rule.dependentRef}:${rule.dependencyRef}:`) && pathsOverlap(prior.path, rule.path))) errors.push(`dependency_field_rule_invalid:${key}`);
    rules.push({ ...rule, censusId: row.censusId, key });
  }
  return { ok: errors.length === 0, errors, bindings, rules };
}
function pathsOverlap(a, b) { return a === b || a.startsWith(b + '.') || b.startsWith(a + '.'); }
function pathMatches(template, concrete) {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[\\\]/g, '\\[\\d+\\]');
  return new RegExp('^' + escaped + '$').test(concrete);
}
async function loadDependencyDispositions(projectDir, { stage = 'codegen' } = {}) {
  const plan = readRequired(projectDir, 'mapping/mapping-plan.json');
  const reconciliation = await census.readReconciliation(projectDir);
  if (!reconciliation || reconciliation.reviewOnly || reconciliation.errors?.length || !(await census.censusReconciliationFreshness(projectDir, reconciliation)).ok) throw new Error('dependency_reconciliation_invalid');
  const validated = validateAssociations({ plan, reconciliation });
  if (!validated.ok) throw new Error(validated.errors.join(';'));
  const approved = await census.ownerApprovedCensusIds(projectDir), rows = new Map(reconciliation.rows.map(row => [row.censusId, row]));
  const reconciliationSha256 = fileDigest(projectDir, 'mapping/review/census-reconciliation.json');
  const dispositions = {};
  for (const [ref, ids] of validated.bindings) if (ids.every(id => rows.get(id).state === 'excluded')) dispositions[ref] = {
    censusIds: ids, reconciliationSha256, approved: ids.every(id => approved.has(id)),
    rules: validated.rules.filter(rule => ids.includes(rule.censusId) && approved.has(rule.censusId)),
  };
  const proven = proofs.validateProofs(plan.dependencyProofs, { rows, plan, readEntityMappings, projectDir, stage });
  if (proven.errors.length) throw new Error(proven.errors.join(';'));
  const adoption = proofs.adoptOnlyRefsOf(plan, readEntityMappings);
  return { dispositions, proofs: proven.proofs, ...validated, rows, approved, reconciliationSha256, adoptOnlyRefs: adoption.refs, adoptOnlyMixed: adoption.mixed };
}
// A plugin entity with a current read plan is read in full before the mapping checkpoint, so its
// row cannot stay pending for want of data. Pending stays legitimate only when a full read was
// attempted and failed: its typed extraction task carries the reason and operator action.
// Rows are matched by any identity they carry (a short entityKey/sourceEntity name may sit beside
// the canonical plugin reference), so every mapping-plan representation is covered.
async function pluginInventoryErrors(projectDir, plan) {
  const plans = require('../resources/rp-source-wordpress/lib/plugin-entity-read-plan.js');
  const planned = new Map(plans.plannedPluginEntities(projectDir).map(entity => [entity.sourceEntityRef, entity.planRef]));
  const pending = new Set();
  for (const row of readEntityMappings(plan)) {
    if (row?.fieldMappingStatus !== 'pending') continue;
    const ref = [row.sourceEntityRef, row.sourceEntity, row.entityKey, row.ref].find(id => planned.has(id));
    if (ref) pending.add(ref);
  }
  const errors = [];
  for (const ref of [...pending].sort()) {
    const { state } = await plans.pluginFullReadState(projectDir, ref, planned.get(ref));
    if (state === 'not-attempted' || state === 'stale') errors.push({ code: 'plugin_full_read_missing', detail: ref, next: `${state === 'stale' ? 'Its full-read evidence no longer verifies. ' : ''}Read the entity in full before the mapping checkpoint: node resources/rp-source-wordpress/scripts/plugin-full-read.js --project-dir <dir> --entity ${ref}. Then map its exact fields and re-run the preflight.` });
    else if (state === 'complete') errors.push({ code: 'plugin_inventory_unmapped', detail: ref, next: 'A complete full read exists; map the exact fields from data/source-extract/<entity>.ndjson and set fieldMappingStatus: resolved, then re-run the preflight.' });
    else if (state === 'components-complete') errors.push({ code: 'plugin_inventory_unmapped', detail: ref, next: 'Every component was read in full (data/source-extract/<entity>.components.json); its project-code assembly runs only after approval. Map the exact fields from those component outputs and set fieldMappingStatus: resolved, then re-run the preflight.' });
  }
  return errors;
}
// The same dependency rules, run by the mapper BEFORE mapping approval on proposed
// operations, census and source evidence -- no setup plan, execution manifest or payload capture is
// needed. Proposed exclusions count as dispositions here (approval binds them); setup-producible
// refs are `pending setup`, which can pass structural mapping readiness but never execution
// readiness. Written to mapping/review/dependency-preflight.json for the mapping review, without
// the `work` timing and counters: an approval request pins that file, so it must be byte-stable.
async function preflightMappingDependencies(projectDir, { write = true } = {}) {
  const plan = read(projectDir, 'mapping/mapping-plan.json');
  const reconciliation = await census.readReconciliation(projectDir);
  const errors = [];
  const validated = validateAssociations({ plan, reconciliation });
  errors.push(...validated.errors);
  const rows = new Map((reconciliation?.rows || []).map(row => [row.censusId, row]));
  const dispositions = {};
  for (const [ref, ids] of validated.bindings) if (ids.every(id => rows.get(id)?.state === 'excluded')) dispositions[ref] = { censusIds: ids, reconciliationSha256: null };
  const report = proofs.preflightMapping({ plan, reconciliation, dispositions, readEntityMappings, projectDir });
  report.errors.push(...(await pluginInventoryErrors(projectDir, plan)));
  if (report.errors.length) report.structuralReady = false;
  if (errors.length) { report.errors.unshift(...errors.map(code => ({ code: code.split(':')[0], detail: code.split(':').slice(1).join(':'), next: 'Correct the mapping dependency bindings, then re-run the preflight.' }))); report.structuralReady = false; }
  report.mappingPlanDigest = fileDigest(projectDir, 'mapping/mapping-plan.json');
  if (write) { const { work, ...persisted } = report; await require('./orchestration-state').writeJsonAtomic(inside(projectDir, 'mapping/review/dependency-preflight.json'), persisted); }
  return report;
}
function validateImportInputs(projectDir) {
  const manifest = readRequired(projectDir, 'execution/execution-manifest.json'), setupPlan = readRequired(projectDir, 'setup/setup-plan.json');
  const plan = readRequired(projectDir, 'mapping/mapping-plan.json');
  if (read(projectDir, 'orchestration/state.json', {})?.finalizedAt || read(projectDir, 'orchestration/website-handoff.json', {})?.finalizedAt) throw new Error('EXECUTION_REVIEW_ONLY');
  if (manifest.mappingPlanDigest !== fileDigest(projectDir, 'mapping/mapping-plan.json')) throw new Error('mapping_plan_digest_mismatch');
  let validation = validatedManifests.get(manifest);
  if (!validation) { validation = require('./execution-manifest').validateManifest(manifest); validatedManifests.set(manifest, validation); }
  if (!validation.ok) throw new Error(validation.errors.join(';'));
  return { manifest, setupPlan, plan };
}
const validatedManifests = new WeakMap(), planEvidenceFiles = new WeakMap(), manifestSourceFiles = new WeakMap();
function readRequired(projectDir, file) {
  const value = readCached(projectDir, file);
  if (value === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${inside(projectDir, file)}'`), { code: 'ENOENT' });
  return value;
}
// Called on every gated send, so the parsed plan and manifest and the paths derived from them are
// reused while those files are unchanged; every listed file is still re-stat'ed and re-hashed on change.
function fingerprint(ctx) {
  const files = ['execution/execution-manifest.json', 'mapping/mapping-plan.json', 'setup/setup-plan.json', 'setup/setup-verification.json', 'discovery/census.json', 'mapping/review/mapping-gaps.json', 'mapping/review/census-reconciliation.json', 'mapping/review/mapping-summary.md', 'orchestration/approvals.json'];
  const plan = readCached(ctx.projectDir, 'mapping/mapping-plan.json', {});
  let evidence = planEvidenceFiles.get(plan);
  if (!evidence) {
    evidence = [];
    for (const a of plan.operationAssessments || []) for (const e of a.evidence || []) evidence.push(e.artifact);
    for (const row of require('./mapping-field-contract').entityRows(plan)) for (const d of row.fieldMappings || []) if (d.recovery) evidence.push(d.recovery.source.artifact,d.recovery.membership.artifact,...d.recovery.evidence.map(e=>e.artifact));
    planEvidenceFiles.set(plan, evidence);
  }
  files.push(...evidence);
  let sources = manifestSourceFiles.get(ctx.manifest);
  if (!sources) {
    sources = [];
    for (const task of ctx.manifest.tasks.filter(task => task.kind === 'import')) for (const source of task.sourceBindings || []) sources.push(source.manifestPath, source.extractPath, ...(source.readPlanPath ? [source.readPlanPath] : []));
    manifestSourceFiles.set(ctx.manifest, sources);
  }
  files.push(...sources);
  // Held sets are readiness evidence: an inventory, its builder or the approval request changing
  // makes an earlier evaluation and its grants stale.
  for (const entity of Object.keys(require('./read-back-contract').DOMAINS)) {
    const inventory = `execution/read-back-inventory/${entity}.json`; files.push(inventory);
    try { const builder = readCached(ctx.projectDir, inventory).builder?.path; if (builder) files.push(builder); } catch {}
  }
  try { const requestId = readCached(ctx.projectDir, 'orchestration/approvals.json').mapping?.requestId; if (/^uar_[0-9a-f-]+$/.test(requestId || '')) files.push(`orchestration/user-actions/${requestId}.json`); } catch {}
  return hash(files.map(file => { try { return file + ':' + fileDigest(ctx.projectDir, file); } catch { return file + ':missing'; } }).join('\n'));
}
function statKey(file) { try { const stat = fs.statSync(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; } catch (e) { if (e.code === 'ENOENT') return 'missing'; throw e; } }
function ndjson(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
async function evidenceIndex(ctx) {
  const key = `${ctx.projectDir}:${ctx.siteId}:${ctx.dryRun}`, prior = indexes.get(key);
  if (!subscriptions.has(ctx.projectDir)) subscriptions.set(ctx.projectDir, local.onCrosswalkChange(ctx.projectDir, event => {
    for (const [cachedKey, cached] of indexes) if (cached.projectDir === ctx.projectDir && cached.dryRun === event.dryRun) {
      if (cached.crosswalkStamp !== event.before) { indexes.delete(cachedKey); continue; }
      for (const sourceKey of event.remove) { cached.crosswalk.delete(sourceKey); cached.changes.push(sourceKey); }
      for (const row of event.updates) { cached.crosswalk.set(row.sourceStableKey, structuredClone(row)); cached.changes.push(row.sourceStableKey); (cached.crosswalkPublished || (cached.crosswalkPublished = [])).push(row.sourceStableKey); }
      cached.crosswalkStamp = event.after;
    }
  }));
  const crosswalkFile = ctx.dryRun ? local.dryRunCrosswalkPath(ctx.projectDir) : local.crosswalkPath(ctx.projectDir);
  const crosswalkStamp = statKey(crosswalkFile), passStamp = statKey(inside(ctx.projectDir, PASS_FILE));
  const index = prior || { attempts: new Map(), offset: 0, changes: [], summaries: new Map(), projectDir: ctx.projectDir, dryRun: ctx.dryRun, recovery: recovery.createRecoveryIndex(ctx.siteId), work: { journalRowsApplied: 0, dependencyKeysChecked: 0, waitingKeysProjected: 0 } };
  let increment;
  try { increment = await local.readAttemptJournalSince(ctx.projectDir, index.offset); } catch (error) { if (error.code !== 'JOURNAL_MISSING' || index.offset) throw error; increment = { rows: [], nextOffset: 0, size: 0 }; }
  if (increment.truncated) { indexes.delete(key); return evidenceIndex(ctx); }
  for (const row of increment.rows) { index.work.journalRowsApplied++; local.validateAttemptRow(row); index.attempts.set(row.sourceStableKey, row); recovery.applyRecoveryAttempt(index.recovery, row); index.changes.push(row.sourceStableKey); }
  index.offset = increment.nextOffset;
  if (increment.nextOffset !== increment.size) throw new Error('readiness_journal_incomplete_tail');
  if (!prior || index.crosswalkStamp !== crosswalkStamp) {
    const rows = ndjson(crosswalkFile);
    for (const row of rows) (ctx.dryRun ? local.validateDryRunCrosswalkRow : local.validateCrosswalkRow)(row);
    index.summaries.clear();
    index.crosswalk = new Map(rows.map(row => [row.sourceStableKey, row])); index.crosswalkStamp = crosswalkStamp;
  }
  if (!prior || index.passStamp !== passStamp) { index.passes = ndjson(inside(ctx.projectDir, PASS_FILE)); index.passStamp = passStamp; for (const row of index.passes) validatePass(row); }
  indexes.set(key, index); return index;
}
function validatePass(row) {
  if (!row || row.schemaVersion !== 1 || !row.taskId || !row.runId || !row.siteId || !row.planVersion || !row.manifestDigest || !row.setupPlanDigest || !row.mappingPlanDigest || !row.sourceSnapshotDigests || !Array.isArray(row.entityRefs) || !SELECTIVE.has(row.selection?.mode) || typeof row.dryRun !== 'boolean' || !Number.isFinite(Date.parse(row.finishedAt))) throw new Error('readiness_pass_malformed');
  return row;
}
// A task's extract must be the version the toolkit recorded, with no fields lost. One the ledger
// has never seen is recorded here, before any write; the chain head a read-back inventory pinned
// must still be in the ledger, or the extract is re-read from the source.
async function recordedExtract(ctx, source) {
  const ledger = require('./extract-ledger');
  let pinned = null;
  try {
    const dir = path.join(ctx.projectDir, 'execution/read-back-inventory');
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith('.json')) : []) {
      const extract = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).extract;
      if (extract?.path === source.extractPath && extract.ledgerHead) pinned = extract.ledgerHead;
    }
  } catch { throw new Error('dependency_read_back_inventory_unreadable'); }
  // Never block: a changed or stripped extract is re-read from the source and reported. Only an
  // extract that cannot be re-read stops, and only this task.
  try { await ledger.ensureExtract(ctx.projectDir, { entity: source.sourceEntity, extractPath: source.extractPath, manifestPath: source.manifestPath, keyField: source.keyField, ledgerHead: pinned, recordedBy: 'import-gate' }); return null; }
  catch (error) {
    if (error.code !== 'source_extract_unreadable') throw new Error(`dependency_${error.code || 'source_extract_unreadable'}`);
    return { ref: source.ref, state: 'source-extract-unreadable', reasons: [error.reason || 'extractor_failed'], recovery: `re-extract:${source.sourceEntity}` };
  }
}
function snapshots(ctx, task) {
  const cacheKey = ctx.projectDir + ':' + task.id, stamp = JSON.stringify((task.sourceBindings || []).map(source => [source, statKey(inside(ctx.projectDir, source.manifestPath)), statKey(inside(ctx.projectDir, source.extractPath)), source.readPlanPath && statKey(inside(ctx.projectDir, source.readPlanPath))]));
  if (snapshotCache.get(cacheKey)?.stamp === stamp) return snapshotCache.get(cacheKey).value;
  if (!Array.isArray(task.sourceBindings) || !task.sourceBindings.length) throw new Error('dependency_source_binding_missing');
  const digests = {}, keys = new Set(), censusByKey = new Map(), sourceByKey = new Map(); let rowsWritten = 0, snapshotTotal = 0;
  for (const source of task.sourceBindings) {
    if (!(task.entityRefs || []).includes(source.ref) || !source.sourceEntity || !source.keyField || !source.keyPrefix) throw new Error('dependency_source_binding_invalid');
    const identity = JSON.stringify([source.ref, source.sourceEntity, source.censusId || `entity:${source.sourceEntity}`, source.keyField, source.keyPrefix, source.manifestPath, source.extractPath, source.readPlanPath || null]);
    if (Object.hasOwn(digests, identity)) throw new Error('dependency_source_binding_duplicate');
    const artifacts = { manifest: fileDigest(ctx.projectDir, source.manifestPath), extract: fileDigest(ctx.projectDir, source.extractPath), ...(source.readPlanPath ? { readPlan: fileDigest(ctx.projectDir, source.readPlanPath) } : {}) };
    const extract = read(ctx.projectDir, source.manifestPath);
    const records = ndjson(inside(ctx.projectDir, source.extractPath));
    let total = extract.snapshotTotal;
    if (extract.kind === 'eav-read-plan') {
      if (!source.readPlanPath) throw new Error('dependency_extract_read_plan_missing');
      const client = require('../resources/rp-source-wordpress/lib/wix-wp-plugin-v2-client');
      if (client.eavExtractionIsReusable(read(ctx.projectDir, source.readPlanPath), extract, { planFile: source.readPlanPath, ndjsonDigest: fileDigest(ctx.projectDir, source.extractPath), ndjsonRowCount: records.length }).length) throw new Error('dependency_extract_incomplete');
      total = extract.rowsWritten; artifacts.readPlan = fileDigest(ctx.projectDir, source.readPlanPath);
    }
    if (!Number.isInteger(extract.rowsWritten) || !Number.isInteger(total) || extract.rowsWritten !== total || extract.rowsWritten < 0) throw new Error('dependency_extract_incomplete');
    digests[identity] = artifacts;
    if (records.length !== extract.rowsWritten) throw new Error('dependency_extract_count_mismatch');
    for (const record of records) {
      const id = valueAt(record, source.keyField);
      if (id == null || typeof id === 'object') throw new Error('dependency_source_key_missing');
      const key = source.keyPrefix + String(id);
      if (keys.has(key)) throw new Error('dependency_source_key_duplicate');
      keys.add(key); censusByKey.set(key, source.censusId || `entity:${source.sourceEntity}`); sourceByKey.set(key, { ...source, sourceId: String(id) });
    }
    rowsWritten += extract.rowsWritten; snapshotTotal += total;
  }
  const orderedDigests = Object.fromEntries(Object.entries(digests).sort(([a], [b]) => a.localeCompare(b)));
  const value = { digests: orderedDigests, keys, censusByKey, sourceByKey, rowsWritten, snapshotTotal }; snapshotCache.set(cacheKey, { stamp, value }); return value;
}
function currentPass(ctx, task, snapshot, pass) {
  return pass.taskId === task.id && pass.siteId === ctx.siteId && pass.dryRun === ctx.dryRun &&
    pass.planVersion === ctx.manifest.planVersion && pass.manifestDigest === fileDigest(ctx.projectDir, 'execution/execution-manifest.json') &&
    pass.setupPlanDigest === fileDigest(ctx.projectDir, 'setup/setup-plan.json') && pass.mappingPlanDigest === fileDigest(ctx.projectDir, 'mapping/mapping-plan.json') &&
    equal(pass.sourceSnapshotDigests, snapshot.digests) && pass.selection.mode === 'full';
}
function finishedThisRun(ctx, index, task) {
  return index.passes.some(pass => pass.taskId === task.id && pass.runId === ctx.runId && pass.siteId === ctx.siteId && pass.dryRun === ctx.dryRun && pass.selection.mode === 'full');
}
// While a per-record producer is `in-progress`, a key counts once the producer wrote or re-checked
// it in this run, or once it already landed on this site in an earlier run (its latest attempt is a
// same-site imported/already-imported row and its same-site crosswalk row is imported). A resumed
// producer does not undo an earlier confirmed write; requiring a fresh write or check kept every
// dependent of a resumed producer waiting. keyReady still checks site and identity for each key; a
// key this run re-attempts is judged by that latest attempt; anything else waits.
const LANDED = new Set(['imported', 'skipped_already_imported']);
function producedThisRun(ctx, index, key, dep) {
  if (dep.state !== 'in-progress') return true;
  const attempt = index.attempts.get(key), row = index.crosswalk.get(key);
  if (attempt?.runId === ctx.runId) return true;
  return Boolean(attempt && row && LANDED.has(attempt.status) && attempt.siteId === ctx.siteId && row.siteId === ctx.siteId && row.status === 'imported');
}
// The crosswalk row is this source record's own, for its entity: shared by keyReady and the
// post-grant fallback in currentRecordTargetId so both apply one target contract.
function rowMatchesSource(row, source) {
  const types = source ? [source.ref, source.ref.split('/')[1], source.ref.replace('/', '-'), source.ref.replace('/', '.')] : [];
  return Boolean(source) && row.targetSystem === 'wix' && row.sourceEntityType === source.sourceEntity && String(row.sourceId) === source.sourceId && types.includes(row.targetEntityType);
}
function keyReady(ctx, index, key, owner) {
  index.work.dependencyKeysChecked++;
  const attempt = index.attempts.get(key), row = index.crosswalk.get(key);
  if ((attempt && attempt.siteId !== ctx.siteId) || (row && row.siteId !== ctx.siteId)) return { ready: false, foreign: true };
  if (!attempt || !row || row.status !== 'imported' || !['imported', 'skipped_already_imported'].includes(attempt.status)) return { ready: false };
  if (owner) {
    const source = owner.snapshot.sourceByKey.get(key);
    const types = source ? [source.ref, source.ref.split('/')[1], source.ref.replace('/', '-'), source.ref.replace('/', '.')] : [];
    if (!source || owner.ref && source.ref !== owner.ref || attempt.writeSpecId !== owner.task.id || !rowMatchesSource(row, source) || !types.includes(attempt.targetEntityType)) return { ready: false, identity: false };
  }
  return { ready: true, row };
}
// Why a key that is not ready will not land in this run, or null while it still may. While the
// producer is in progress only this run's terminal failure is final (an earlier run's may be retried).
// Once its pass is current, any key not ready and not held is final: its last status, `not-attempted`,
// or `not-in-source` when the producer's extract has no such record.
function failedForGood(ctx, index, key, dep, inSource) {
  const attempt = index.attempts.get(key);
  if (attempt && attempt.siteId !== ctx.siteId) return null;
  if (dep.state === 'in-progress') return attempt?.runId === ctx.runId && attempt.status === 'failed_terminal' ? attempt.status : null;
  if (!inSource) return 'not-in-source';
  return attempt?.status || 'not-attempted';
}
// An id the gate never resolved is never sent. For a ref the record can go without
// (`dependencyFailureActions: omit`) at a one-array path (a gallery item's id), the items carrying
// such ids are dropped, the rest keep their order, and each drop is recorded like a failed
// dependency; an id that is exactly one ready record's target is kept as that record's reference.
// Any other unresolved id defers the record (returns false).
function dropUnchecked(payload, references, entityRefs, ref, template, unresolved, lookup) {
  const parts = template.split('[]');
  if (parts.length !== 2 || !parts[1].startsWith('.') || !unresolved.every(concrete => failureOmits(entityRefs, ref, concrete))) return false;
  const arrayPath = parts[0], items = valueAt(payload, arrayPath);
  if (!Array.isArray(items)) return false;
  // An id that is exactly one ready record's target is that record's reference, not a drop.
  unresolved = unresolved.filter(concrete => { const key = lookup(ref, valueAt(payload, concrete)); if (key) references.push({ ref, sourceStableKey: key, path: concrete, targetId: valueAt(payload, concrete) }); return !key; });
  if (!unresolved.length) return true;
  const index = concrete => Number(concrete.slice(arrayPath.length + 1, concrete.indexOf(']', arrayPath.length)));
  const dropped = new Set(unresolved.map(index)), moved = new Map();
  for (let i = 0, kept = 0; i < items.length; i++) if (!dropped.has(i)) moved.set(i, kept++);
  for (const concrete of unresolved) references.push({ ref, sourceStableKey: null, path: concrete, action: 'omit-failed', dependencyStatus: 'unchecked-reference', uncheckedTargetId: String(valueAt(payload, concrete)) });
  // Granted references in the same array follow their item to its new index.
  for (const reference of references) {
    if (reference.action || !reference.path.startsWith(arrayPath + '[')) continue;
    const at = index(reference.path);
    if (moved.has(at)) reference.path = `${arrayPath}[${moved.get(at)}]` + reference.path.slice(reference.path.indexOf(']', arrayPath.length) + 1);
  }
  const keys = arrayPath.replace(/\[(\d+)\]/g, '.$1').split('.'), last = keys.pop(), parent = keys.reduce((value, key) => value?.[key], payload);
  parent[last] = items.filter((_, i) => !dropped.has(i));
  return true;
}
// Target knowledge's `dependencyFailureActions`: `omit` lets a record be written without a
// reference whose own dependency record failed. Every entity of the task must declare it at this path.
function failureOmits(entityRefs, ref, concrete) {
  return entityRefs.every(entityRef => domain(entityRef).dependencyFailureActions?.[ref] === 'omit') && declaresPath(entityRefs, ref, concrete);
}
// A producer key the owner intentionally held: its builder hold is in the current, approved
// read-back inventory. Such a key is settled for readiness, never missing; a
// held set that is not current honors no hold, so its keys stay not ready.
async function heldKeys(ctx, task, snapshot) {
  const keys = new Map(), errors = [], stamp = [];
  const readBack = require('./read-back-contract'), plan = read(ctx.projectDir, 'mapping/mapping-plan.json');
  for (const source of task.sourceBindings || []) {
    const entity = Object.keys(readBack.DOMAINS).find(name => `${readBack.DOMAINS[name]}/${name}` === source.ref);
    if (!entity) continue;
    const held = await readBack.approvedHeldRecords(ctx.projectDir, entity, plan);
    stamp.push([entity, held.ok, held.inventorySha256 || null]);
    if (!held.ok) { errors.push(held.reason); continue; }
    for (const [sourceId, reasons] of held.held) {
      const key = source.keyPrefix + sourceId;
      if (snapshot.sourceByKey.get(key)?.ref === source.ref) keys.set(key, reasons);
    }
  }
  return { keys, errors: [...new Set(errors)], stamp: JSON.stringify(stamp) };
}
function readinessSummary(ctx, index, task, snapshot, held) {
  let summary = index.summaries.get(task.id);
  const status = key => { const row = keyReady(ctx, index, key, { task, snapshot }); return !row.ready && !row.foreign && held.keys.has(key) ? { ...row, held: true } : row; };
  const add = (row, sign) => { summary.ready += sign * Number(row.ready); summary.foreign += sign * Number(Boolean(row.foreign)); summary.held += sign * Number(Boolean(row.held)); };
  if (!summary || summary.snapshot !== snapshot || summary.heldStamp !== held.stamp) {
    summary = { snapshot, heldStamp: held.stamp, ready: 0, foreign: 0, held: 0, statuses: new Map(), offset: index.changes.length };
    for (const key of snapshot.keys) { const row = status(key); summary.statuses.set(key, row); add(row, 1); }
    index.summaries.set(task.id, summary); return summary;
  }
  for (const key of new Set(index.changes.slice(summary.offset))) if (snapshot.keys.has(key)) {
    const after = status(key); add(summary.statuses.get(key), -1); add(after, 1); summary.statuses.set(key, after);
  }
  summary.offset = index.changes.length; return summary;
}
async function evaluateDependency({ ctx, ref, producer, mode, index, dispositions, proofs: validProofs = new Map() }) {
  const unknown = (reason, recovery) => ({ ref, producer, state: 'unknown', reasons: [reason], recovery });
  try {
    if (producer.kind === 'inherited') return { ref, producer, state: 'inherited', reasons: [] };
    if (producer.kind === 'no-producer') {
      // Re-validated against current knowledge and source evidence on every evaluation; a catch-up
      // extract that now contains the dependency contradicts the proof for referencing records.
      const current = producer.proofs.map(row => validProofs.get(proofs.proofKey(row.entityRef, row.operation, ref)));
      if (current.some((proof, i) => !proof || proof.id !== producer.proofs[i].proofId || proof.operationContractDigest !== producer.proofs[i].operationContractDigest)) return unknown('dependency_proof_not_current', `reverify-dependency-proof:${ref}`);
      return { ref, producer, state: current.some(proof => proof.status === 'contradicted') ? 'proof-contradicted' : 'proven', reasons: [], recovery: `reverify-dependency-proof:${ref}` };
    }
    if (!['import-task', 'secondary-output', 'child-output', 'setup-step', 'disposition'].includes(producer.kind)) return unknown('dependency_producer_unsupported', `regenerate-import:${ref}`);
    if (producer.kind === 'disposition') {
      const disposition = dispositions[ref];
      if (!disposition) return unknown('disposition_not_current', `obtain-disposition-approval:${ref}`);
      return { ref, producer, state: disposition.approved ? 'excluded-approved' : 'excluded-unapproved', reasons: [], recovery: `obtain-disposition-approval:${ref}` };
    }
    if (producer.kind === 'setup-step') {
      const receipt = read(ctx.projectDir, 'setup/setup-verification.json');
      const validation = setup.validateSetupVerification({ verification: receipt, plan: ctx.setupPlan, planDigest: fileDigest(ctx.projectDir, 'setup/setup-plan.json'), siteId: ctx.siteId, projectDir:ctx.projectDir });
      if (!validation.ok || receipt.dryRun !== ctx.dryRun) return unknown(validation.reasons.join(';') || 'dry_run_mismatch', `run-setup:${producer.stepIds[0]}`);
      return { ref, producer, state: 'setup-passed', reasons: [], receipt };
    }
    const task = ctx.manifest.tasks.find(row => row.id === producer.taskId), snapshot = snapshots(ctx, task);
    // A per-record edge does not wait for the producer's whole pass until that pass finishes in this
    // run (whose manifest and setup plan are fixed): each dependent record waits only for the keys it
    // references, and only keys the producer wrote or re-checked in this run count. A record that
    // references none sends. A full pass that finished and is no longer current stays `unknown`.
    const passed = index.passes.some(pass => currentPass(ctx, task, snapshot, pass));
    if (!passed && (mode !== 'per-record' || finishedThisRun(ctx, index, task))) return unknown('current_full_pass_missing', `run-import:${task.id}`);
    const held = await heldKeys(ctx, task, snapshot), summary = readinessSummary(ctx, index, task, snapshot, held);
    if (summary.foreign) return unknown('site_evidence_unbound_or_foreign', `reconcile-site:${task.id}`);
    // Every key not imported is an approved hold: settled, so task-complete dependents may run.
    // A current full pass that left other keys unlanded is settled. Dependents proceed and
    // records naming those keys become final instead of waiting forever.
    const state = !passed ? 'in-progress' : snapshot.rowsWritten === 0 && snapshot.snapshotTotal === 0 ? 'empty' : summary.ready === snapshot.keys.size ? 'complete' : summary.held && summary.ready + summary.held === snapshot.keys.size ? 'complete-with-holds' : 'finished-partial';
    return { ref, producer, state, reasons: held.errors, recovery: `run-import:${task.id} --failed-only`, snapshot, ...(summary.held ? { heldCount: summary.held, held: held.keys } : {}) };
  } catch (error) { return unknown(evidenceReason(error), producer.kind === 'setup-step' ? `run-setup:${producer.stepIds[0]}` : `run-import:${producer.taskId || ''}`); }
}
// execution/dependency-readiness.json is shared by task evaluation, the batch projection and
// within-write gap records, and observations run concurrently. Every read-modify-write of it runs
// through this per-file queue, so overlapping updates never drop one another's tasks or gaps.
// (In-process only; one importer process owns a project's execution state.)
const diagnosticQueues = new Map();
async function updateDiagnostic(projectDir, mutate) {
  const file = inside(projectDir, 'execution/dependency-readiness.json'), prior = diagnosticQueues.get(file) || Promise.resolve();
  let release; const turn = new Promise(resolve => { release = resolve; }), tail = prior.then(() => turn);
  diagnosticQueues.set(file, tail);
  await prior;
  try {
    const diagnostic = read(projectDir, 'execution/dependency-readiness.json', { schemaVersion: 1, tasks: {} });
    diagnostic.tasks = diagnostic.tasks || {};
    const result = await mutate(diagnostic);
    if (result !== false) await require('./orchestration-state').writeJsonAtomic(file, diagnostic);
    return result;
  } finally { release(); if (diagnosticQueues.get(file) === tail) diagnosticQueues.delete(file); }
}
// The holds a deferral waits on. A `dependency-held` row journaled before holdCauses existed names
// its one hold at the top level.
function holdCausesOf(deferral) {
  if (Array.isArray(deferral?.holdCauses)) return deferral.holdCauses;
  return deferral?.reason === 'dependency-held' && deferral.ref ? [{ ref: deferral.ref, sourceStableKey: deferral.sourceStableKey, holdReasons: deferral.holdReasons || [] }] : [];
}
// Dependents waiting on an owner-held record, grouped by the held ref: the cutover cause.
function heldDependencies(waiting) {
  const groups = new Map();
  for (const row of waiting || []) for (const ref of new Set(holdCausesOf(row.deferral).map(cause => cause.ref))) {
    const group = groups.get(ref) || { ref, heldSourceKeys: new Set(), holdReasons: new Set(), waitingCount: 0 };
    for (const cause of holdCausesOf(row.deferral).filter(cause => cause.ref === ref)) { group.heldSourceKeys.add(cause.sourceStableKey); for (const reason of cause.holdReasons || []) group.holdReasons.add(reason); }
    group.waitingCount++; groups.set(ref, group);
  }
  return [...groups.values()].sort((a, b) => a.ref.localeCompare(b.ref)).map(group => ({ ...group, heldSourceKeys: [...group.heldSourceKeys].sort(), holdReasons: [...group.holdReasons].sort() }));
}
function finalDeferrals(waiting) {
  const rows = [];
  for (const row of waiting || []) if (row.deferral?.final === true) for (const cause of row.deferral.finalCauses || []) rows.push({ sourceStableKey: row.sourceStableKey, ref: cause.ref, dependencySourceKey: cause.sourceStableKey, parentStatus: cause.parentStatus, linkChoice: cause.linkChoice, ...(cause.linkRequired ? { linkRequired: true } : {}), ...(cause.parentSourceKey ? { parentSourceKey: cause.parentSourceKey } : {}), ...(cause.holdReasons ? { holdReasons: cause.holdReasons } : {}), producerTaskId: cause.producerTaskId ?? null });
  return rows.sort((a, b) => (a.sourceStableKey + a.ref + a.dependencySourceKey).localeCompare(b.sourceStableKey + b.ref + b.dependencySourceKey));
}
function projectWaiting(ctx, index) {
  if (!index) return read(ctx.projectDir, 'execution/dependency-readiness.json', { tasks: {} }).tasks?.[ctx.taskId]?.waiting || [];
  index.work.waitingKeysProjected += index.recovery.byTask.get(ctx.taskId)?.size || 0;
  return recovery.waitingForTask(index.recovery, ctx.taskId);
}
function installReadBack(receipt, stepId, app) {
  const check = (receipt?.requirements || []).find(row => row?.id === stepId)?.verification;
  return check?.method === SETUP_CHECK_METHODS.INSTALLED_APPS_READ && check.observed?.appDefId === app.appDefId && check.observed.installed === true;
}
async function evaluateTask({ taskBinding }) {
  const ctx = capability.requireKind(taskBinding, 'import-task');
  const current = validateImportInputs(ctx.projectDir);
  if ((current.manifest !== ctx.manifest && !equal(current.manifest, ctx.manifest)) || (current.setupPlan !== ctx.setupPlan && !equal(current.setupPlan, ctx.setupPlan))) throw new Error('DEPENDENCY_INPUT_CHANGED');
  const sourceBlocks = [];
  for (const source of ctx.task.sourceBindings || []) { const block = await recordedExtract(ctx, source); if (block) sourceBlocks.push(block); }
  let adapter, index, inputError;
  try {
    adapter = await loadDependencyDispositions(ctx.projectDir, { stage: 'runtime' });
    const binding = bindDependencyProducers({ manifest: ctx.manifest, setupPlan: ctx.setupPlan, dispositions: adapter.dispositions, proofs: adapter.proofs, adoptOnlyRefs: adapter.adoptOnlyRefs, adoptOnlyMixed: adapter.adoptOnlyMixed });
    if (!binding.ok) throw new Error(binding.errors.join(';'));
    index = await evidenceIndex(ctx);
  } catch (error) { inputError = error; }
  const dependencies = [];
  for (const edge of ctx.task.dependencyEdges) dependencies.push(inputError ? { ...edge, state: 'unknown', reasons: [evidenceReason(inputError)], recovery: edge.producer.kind === 'setup-step' ? `run-setup:${edge.producer.stepIds[0]}` : edge.producer.kind === 'disposition' ? `obtain-disposition-approval:${edge.ref}` : `run-import:${edge.producer.taskId}` } : { ...await evaluateDependency({ ctx, ...edge, index, dispositions: adapter.dispositions, proofs: adapter.proofs }), mode: edge.mode });
  // An app the task's entities live in is a prerequisite the entity edges do not name: it must
  // be a scheduled setup step that passed, and that step's pass already includes the live read-back.
  for (const app of requiredAppsFor([...(ctx.task.entityRefs || []), ...(ctx.task.dependencyRefs || [])])) {
    const stepId = app.stepIds.find(id => (ctx.setupPlan.steps || []).some(step => step.id === id));
    const ref = `app:${app.app}`;
    if (!stepId) { dependencies.push({ ref, producer: { kind: 'setup-step', stepIds: [app.stepIds[0]] }, state: 'unknown', reasons: [`app_install_step_missing:${app.app}`], recovery: `add-setup-step:${app.stepIds[0]}`, mode: 'task-complete' }); continue; }
    const producer = { kind: 'setup-step', stepIds: [stepId] };
    if (inputError) { dependencies.push({ ref, producer, state: 'unknown', reasons: [evidenceReason(inputError)], recovery: `run-setup:${stepId}`, mode: 'task-complete' }); continue; }
    const dep = { ...await evaluateDependency({ ctx, ref, producer, index, dispositions: adapter.dispositions }), mode: 'task-complete' };
    // A passed receipt is not enough: the installer once passed this step after installing a
    // different app, and that receipt stays digest-valid. Only a live installed-apps read of this
    // app's id counts, so a receipt from before that fix reruns setup.
    if (dep.state === 'setup-passed' && !installReadBack(dep.receipt, stepId, app)) { dependencies.push({ ref, producer, state: 'unknown', reasons: [`app_install_not_read_back:${app.app}`], recovery: `run-setup:${stepId}`, mode: 'task-complete' }); continue; }
    dependencies.push(dep);
  }
  if (inputError && !dependencies.length) throw inputError;
  const blocked = dependencies.filter(dep => !SETTLED.has(dep.state) && !(['in-progress', 'proof-contradicted'].includes(dep.state) && dep.mode === 'per-record'));
  // Every other entity builds on the regional setup step (files only; the step already read the site).
  const regional = require('./site-regional').regionalDependency({ projectDir: ctx.projectDir, siteId: ctx.siteId, entityRefs: ctx.task.entityRefs || [] });
  if (regional.gated && !regional.ok) blocked.push({ ref: 'site/locale', state: 'locale-refused', reasons: [regional.code], recovery: 'site-locale-gate' });
  blocked.push(...sourceBlocks);
  const waiting = projectWaiting(ctx, index);
  const evaluation = Object.freeze({ taskId: ctx.taskId, blocked: blocked.map(({ receipt, snapshot, held, ...row }) => row), ok: blocked.length === 0, work: Object.freeze({ ...index?.work }) });
  const generation = (evaluationGenerations.get(taskBinding) || 0) + 1; evaluationGenerations.set(taskBinding, generation);
  evaluations.set(evaluation, { ctx, dependencies, index, adapter, stamp: fingerprint(ctx), taskBinding, generation });
  const finalRows = finalDeferrals(waiting);
  const diagnostic = { waiting, heldDependencies: heldDependencies(waiting), ...(finalRows.length ? { finalDeferrals: finalRows } : {}), schemaVersion: 1, siteId: ctx.siteId, taskId: ctx.taskId, blocked: evaluation.blocked,
    affectedCount: ctx.task.population ?? null, operatorRole: 'Requires Import Operator',
    action: `Inspect execution/dependency-readiness.json for task ${ctx.taskId}; resolve its prerequisite and resume only eligible deferred records. Do not resend existing orders.` };
  // Within-write gaps, reference gaps and omitted references are carried over from the current
  // file inside the same serialized update.
  await updateDiagnostic(ctx.projectDir, current => {
    const gaps = current.tasks[ctx.taskId]?.withinWriteGaps, referenceGaps = current.tasks[ctx.taskId]?.referenceGaps, omitted = current.tasks[ctx.taskId]?.omittedReferences;
    current.schemaVersion = 1; current.tasks[ctx.taskId] = { ...diagnostic, ...(gaps?.length ? { withinWriteGaps: gaps } : {}), ...(referenceGaps?.length ? { referenceGaps } : {}), ...(omitted?.length ? { omittedReferences: omitted } : {}) };
  });
  if (blocked.length) await require('./execution-log').appendExecutionLog(ctx.projectDir, { runId: ctx.runId, phase: 'import', event: 'dependency-readiness-blocked', detail: JSON.stringify({ taskId: ctx.taskId, blocked: evaluation.blocked }), artifacts: ['execution/dependency-readiness.json'] });
  return evaluation;
}
function expandPaths(payload, template) {
  const result = [];
  function visit(value, parts, prefix) {
    if (!parts.length) { result.push(prefix); return; }
    const [part, ...rest] = parts, array = part.endsWith('[]'), key = array ? part.slice(0, -2) : part;
    const next = prefix ? prefix + '.' + key : key;
    if (array) { if (Array.isArray(value?.[key])) value[key].forEach((entry, index) => visit(entry, rest, next + '[' + index + ']')); }
    else if (value && Object.hasOwn(value, key)) visit(value[key], rest, next);
  }
  visit(payload, template.split('.'), ''); return result;
}
// A runtime gap: a record the transform deferred with its own reason (a reference-fidelity or
// shipping-cardinality blocker), or one the shared runner wrote with a recorded loss (a missing
// parent link, a possible duplicate). It is kept in the runtime diagnostic, never in the reviewed
// mapping/review/mapping-gaps.json: that file is readiness and census-reconciliation evidence, so
// writing it mid-batch made every grant of the batch stale and the next send was refused.
const REFERENCE_GAP_ACTION = 'Review this source-key scope and the recorded reference-fidelity or shipping-cardinality blocker. Obtain the existing required owner decision or verified preserving mapping, regenerate and approve current mapping evidence, then resume only affected deferred records. Do not resend existing orders.';
// One row per code; each affected record keeps its own detail (target id, parent, prior attempt),
// so a cutover item never names only the first record.
// operatorRole 'Cutover Operator' marks a gap the Cutover Operator resolves in Business Manager
// (no original migration environment needed); the default stays the Import Operator.
const GAP_ROLES = new Set(['Requires Import Operator', 'Cutover Operator']), GAP_SEVERITIES = new Set(['blocker', 'high', 'medium', 'low']);
async function persistReferenceGap(ctx, sourceStableKey, code, { action = REFERENCE_GAP_ACTION, written = false, detail = {}, operatorRole = 'Requires Import Operator', severity = 'blocker' } = {}) {
  if (!GAP_ROLES.has(operatorRole) || !GAP_SEVERITIES.has(severity)) throw new Error('TASK_GAP_INVALID');
  await updateDiagnostic(ctx.projectDir, diagnostic => {
    const task = diagnostic.tasks[ctx.taskId] || (diagnostic.tasks[ctx.taskId] = { schemaVersion: 1, siteId: ctx.siteId, taskId: ctx.taskId, blocked: [], waiting: [] });
    const rows = task.referenceGaps || (task.referenceGaps = []);
    let row = rows.find(row => row.code === code);
    if (!row) rows.push(row = { code, taskId: ctx.taskId, siteId: ctx.siteId, severity, written, affectedSourceKeys: [], records: [], operatorRole, action });
    row.records = [...(row.records || []).filter(entry => entry.sourceStableKey !== sourceStableKey), { sourceStableKey, ...detail }].sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey));
    row.affectedSourceKeys = row.records.map(entry => entry.sourceStableKey);
    rows.sort((a, b) => a.code.localeCompare(b.code));
  });
}
// A gap on a record the shared runner wrote with a recorded loss: `action` is the per-code next
// step, `detail` this record's facts (no free text).
function assertTaskGap(code, action, detail) {
  if (typeof code !== 'string' || !/^[a-z0-9-]+$/.test(code) || typeof action !== 'string' || !action.trim() || !detail || typeof detail !== 'object') throw new Error('TASK_GAP_INVALID');
}
async function recordTaskGap({ taskBinding, sourceStableKey, code, action, detail = {}, operatorRole, severity }) {
  assertTaskGap(code, action, detail);
  return persistReferenceGap(capability.requireKind(taskBinding, 'import-task'), sourceStableKey, code, { action, written: true, detail, operatorRole, severity });
}
// The same, for a writer holding only the import client its task was bound to (createWixClient
// registers it; nothing else can produce one). Used by toolkit composites such as importOrderHistory.
async function recordClientTaskGap({ wixClient, sourceStableKey, code, action, detail = {}, operatorRole, severity }) {
  assertTaskGap(code, action, detail);
  const ctx = capability.clientContext(wixClient);
  if (!ctx || ctx.kind !== 'import-task') capability.fail('EXECUTION_CAPABILITY_REQUIRED');
  return persistReferenceGap(ctx, sourceStableKey, code, { action, written: true, detail, operatorRole, severity });
}
// Verified receipts live in protected state (state/write-verification.json and its checkpoint
// journal); crosswalk rows usually hold only a digest reference. A revocation can change that state
// without touching the crosswalk, so its stamp is part of every receipt cache key.
function receiptStateStamp(projectDir) {
  const dir = inside(projectDir, 'state/write-verification-journal');
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return [statKey(inside(projectDir, 'state/write-verification.json')), ...names.map(name => name + ':' + statKey(path.join(dir, name)))].join('|');
}
// The verified receipts of one producer task's rows for a ref, loaded once and kept until that
// task's crosswalk rows or the protected state change (dependent writes alone never reload it).
async function taskReceipts(ctx, index, task, ref, stamp) {
  const cache = index.receipts || (index.receipts = new Map()), snapshot = snapshots(ctx, task), cacheKey = task.id + ':' + ref, prior = cache.get(cacheKey);
  if (prior && prior.snapshot === snapshot && prior.crosswalk === index.crosswalk && prior.stamp === stamp && !index.changes.slice(prior.offset).some(key => snapshot.keys.has(key))) { prior.offset = index.changes.length; return prior; }
  const rows = [...snapshot.keys].filter(key => snapshot.sourceByKey.get(key).ref === ref).map(key => index.crosswalk.get(key)).filter(row => row?.verification);
  const entry = { snapshot, crosswalk: index.crosswalk, stamp, offset: index.changes.length, task, receipts: await require('./write-verification-state').verifiedReceipts(ctx.projectDir, rows), derived: new Map() };
  cache.set(cacheKey, entry); return entry;
}
// Every receipt-backed reference the batch may resolve: a verified producer's own rows, and the
// parent rows whose receipts name child identities (a product's variants), indexed by child key.
async function batchReceipts(ctx, index, dependencies) {
  const result = { stamp: receiptStateStamp(ctx.projectDir), parents: new Map(), children: new Map() };
  for (const dep of dependencies) {
    const task = ctx.manifest.tasks.find(row => row.id === dep.producer.taskId);
    if (dep.producer.kind === 'import-task' && task?.verificationLevel === 'verified' && ['crm/contact', 'stores/product'].includes(dep.ref)) result.parents.set(dep.ref, await taskReceipts(ctx, index, task, dep.ref, result.stamp));
    if (dep.producer.kind !== 'child-output') continue;
    const declared = proofs.operationContract(dep.producer.parentRef, task?.writeOperations?.[dep.producer.parentRef])?.contract.childOutputs?.[dep.ref];
    if (!task || declared?.verification !== 'write-verification-receipt' || !declared.receipt?.path) { result.children.set(dep.ref, { state: 'child-contract-missing' }); continue; }
    const entry = await taskReceipts(ctx, index, task, dep.producer.parentRef, result.stamp);
    if (!entry.derived.has(dep.ref)) {
      const owners = new Map();
      for (const [parentKey, receipt] of entry.receipts) for (const row of Array.isArray(receipt[declared.receipt.path]) ? receipt[declared.receipt.path] : []) {
        const key = row?.[declared.receipt.keyField];
        if (typeof key === 'string' && key) owners.set(key, [...(owners.get(key) || []), { parentKey, receipt, targetId: row[declared.receipt.idField] }]);
      }
      entry.derived.set(dep.ref, { snapshot: entry.snapshot, parentTask: task, owners });
    }
    result.children.set(dep.ref, entry.derived.get(dep.ref));
  }
  return result;
}
// Exactly one ready, same-site parent whose verified receipt names this child key exactly once.
function childIdentity(ctx, index, children, producer, key, dep = {}) {
  if (!children?.owners) return { state: children?.state || 'child-contract-missing' };
  const matches = children.owners.get(key) || [];
  if (new Set(matches.map(row => row.parentKey)).size > 1 || matches.length > 1) return { state: 'child-identity-ambiguous' };
  if (!matches.length) return { state: 'child-identity-missing' };
  const [match] = matches, parent = keyReady(ctx, index, match.parentKey, { task: children.parentTask, snapshot: children.snapshot, ref: producer.parentRef });
  if (!parent.ready || !producedThisRun(ctx, index, match.parentKey, dep)) return { state: 'parent-not-ready', parentKey: match.parentKey };
  if (!require('./write-verification').validReceipt(match.receipt, { siteId: ctx.siteId, sourceKey: match.parentKey, targetId: parent.row.targetId })) return { state: 'imported-unverified' };
  if (typeof match.targetId !== 'string' || !match.targetId) return { state: 'child-identity-ambiguous' };
  return { targetId: match.targetId, parentKey: match.parentKey, parentTargetId: parent.row.targetId };
}
// One written path may hold either of several refs (a coupon scope names a product or a category);
// only a ref that declares the path can cover it.
// Target knowledge's `sameTaskReferenceFields`: a reference to an entity this same task writes.
function sameTaskFields(entityRefs) {
  return entityRefs.flatMap(entityRef => Object.entries(domain(entityRef).sameTaskReferenceFields || {})
    .filter(([ref]) => entityRefs.includes(ref))
    .flatMap(([ref, templates]) => templates.map(template => ({ ref, template }))));
}
function declaresPath(entityRefs, ref, concrete) { return entityRefs.some(entityRef => (domain(entityRef).dependencyReferenceFields?.[ref] || []).some(template => pathMatches(template, concrete))); }
function valueAt(payload, concrete) { return concrete.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((value, key) => value?.[key], payload); }
function isCustomOrderLine(payload, concrete) {
  const match = /^lineItems\[(\d+)\]\.catalogReference\.catalogItemId$/.exec(concrete);
  if (!match) return false;
  const line = payload?.lineItems?.[Number(match[1])];
  return Boolean(line?.itemType?.custom) && !Object.hasOwn(line, 'catalogReference');
}
function omitAt(payload, concrete) { const keys = concrete.replace(/\[(\d+)\]/g, '.$1').split('.'); const key = keys.pop(); const parent = keys.reduce((value, part) => value?.[part], payload); if (parent) delete parent[key]; }
async function gateBatch({ evaluation, records }) {
  const state = evaluations.get(evaluation);
  if (!state || state.stamp !== fingerprint(state.ctx) || evaluationGenerations.get(state.taskBinding) !== state.generation) throw new Error('DEPENDENCY_EVALUATION_STALE');
  if (!evaluation.ok) throw Object.assign(new Error('DEPENDENCY_NOT_READY'), { diagnostic: evaluation });
  const { ctx, dependencies, index, adapter } = state, send = [], defer = [], allowed = new Set();
  const receipts = await batchReceipts(ctx, index, dependencies);
  // A parent the same task writes (a nested category) is never an edge; it resolves only from this
  // task's own landed row, so the journal is re-read once per batch: the previous depth level may
  // have just written it.
  const ownFields = sameTaskFields(ctx.task.entityRefs);
  const ownIndex = ownFields.length ? await evidenceIndex(ctx) : null, checked = checkedRefs(ctx.task);
  const waivers = require('./link-waivers').loadLinkWaivers(ctx.projectDir, ctx.siteId);
  // An id the payload carries without the gate (read from a crosswalk) that is exactly one ready
  // producer record's target counts as that record; it gets the same per-key checks as resolveReference.
  const byTarget = new Map();
  const lookup = (ref, targetId) => {
    const dep = dependencies.find(row => row.ref === ref), producerTask = dep?.producer.kind === 'import-task' && ctx.manifest.tasks.find(task => task.id === dep.producer.taskId);
    if (!producerTask || typeof targetId !== 'string') return null;
    const snapshot = snapshots(ctx, producerTask);
    if (!byTarget.has(ref)) { const found = new Map(); for (const row of index.crosswalk.values()) if (snapshot.sourceByKey.get(row.sourceStableKey)?.ref === ref) found.set(row.targetId, [...(found.get(row.targetId) || []), row.sourceStableKey]); byTarget.set(ref, found); }
    const keys = byTarget.get(ref).get(targetId) || [];
    if (keys.length !== 1 || !producedThisRun(ctx, index, keys[0], dep)) return null;
    const ready = keyReady(ctx, index, keys[0], { task: producerTask, snapshot, ref });
    return ready.ready && ready.row.targetId === targetId ? keys[0] : null;
  };
  for (const record of records) {
    if (!record.sourceStableKey) throw new Error('DEPENDENCY_SOURCE_KEY_REQUIRED');
    const references = [], omissions = [], holds = [], finals = [], orphans = [], customLineOmissions = []; let blocker;
    const finalOrWaived = (ref, key, concrete, dep, parentStatus, extra = {}) => {
      const waiver = waivers.match({ taskId: ctx.taskId, sourceStableKey: record.sourceStableKey, ref, dependencySourceKey: key, parentStatus });
      if (waiver && !linkRequired(ctx.task.entityRefs, ref) && (waiver.explicitRequest === true || linkChoice(ctx.task.entityRefs, ref) === 'offer-omit')) {
        references.push({ ref, sourceStableKey: key, path: concrete, action: 'omit-failed', dependencyStatus: 'waived', parentStatus, waiverId: waiver.id }); return true;
      }
      finals.push({ ref, sourceStableKey: key, dependencyState: dep.state, parentStatus, linkChoice: linkChoice(ctx.task.entityRefs, ref), ...(linkRequired(ctx.task.entityRefs, ref) ? { linkRequired: true } : {}), producerTaskId: dep.producer.taskId || null, ...extra });
      return false;
    };
    const parentFinal = (key, dep, inSource) => {
      if (!['import-task', 'child-output', 'secondary-output'].includes(dep.producer.kind) || !['finished-partial', 'complete', 'complete-with-holds'].includes(dep.state)) return null;
      const status = failedForGood(ctx, index, key, dep, inSource);
      if (status === 'deferred' && index.attempts.get(key)?.deferral?.final === true) return 'parent-final';
      return status && !PARENT_NOT_FINAL.has(status) ? status : null;
    };
    const resolve = (ref, key, concrete, mode) => {
      if (mode === 'same-task') {
        if (!ownFields.some(field => field.ref === ref && pathMatches(field.template, concrete))) throw new Error('REFERENCE_UNDECLARED');
        const target = keyReady(ctx, ownIndex, key, { task: ctx.task, snapshot: snapshots(ctx, ctx.task), ref });
        if (target.ready) { references.push({ ref, sourceStableKey: key, path: concrete, targetId: target.row.targetId, producerKind: 'same-task' }); return target.row.targetId; }
        blocker = { ref, sourceStableKey: key, dependencyState: 'same-task-parent-not-written' }; return undefined;
      }
      const fromSetup = mode === 'setup';
      const dep = dependencies.find(dep => dep.ref === ref);
      // A proof says this record writes no such reference; an inherited ref is never written directly.
      if (dep?.producer.kind === 'no-producer') throw new Error('dependency-proof-contradicted');
      if (dep && ['inherited', 'pending-setup'].includes(dep.producer.kind)) throw new Error('REFERENCE_UNDECLARED');
      // A child identity (a variant) is only ever resolved from its parent's verified receipt.
      if (dep && domain(ref).childOf && !['child-output', 'disposition'].includes(dep.producer.kind)) throw new Error('REFERENCE_UNDECLARED');
      // Code written for a task-complete edge may still call resolveTaskReference after the edge
      // became per-record: the key is then checked on its own, which is never weaker.
      const taskOnRecord = mode === 'task' && dep?.mode === 'per-record' && dep.producer.kind === 'import-task';
      if (!dep || (fromSetup ? dep.mode !== 'task-complete' || dep.producer.kind !== 'setup-step' : mode === 'task' && !taskOnRecord ? dep.mode !== 'task-complete' || dep.producer.kind !== 'import-task' || !['complete', 'complete-with-holds', 'finished-partial', 'empty'].includes(dep.state) : dep.mode !== 'per-record' || dep.producer.kind === 'setup-step')) throw new Error('REFERENCE_UNDECLARED');
      if (!fromSetup && mode !== 'task' && !ctx.task.entityRefs.some(entityRef => (domain(entityRef).dependencyReferenceFields?.[ref] || []).some(template => pathMatches(template, concrete)))) throw new Error('REFERENCE_UNDECLARED');
      if (fromSetup) {
        const entries = dep.receipt.requirements.filter(req => dep.producer.stepIds.includes(req.id)).flatMap(req => req.referenceBindings || []);
        const match = entries.find(binding => binding.ref === ref && binding.sourceStableKey === key && Object.keys(binding.values).some(template => pathMatches(template, concrete)));
        const template = match && Object.keys(match.values).find(template => pathMatches(template, concrete));
        if (!match || !template) { blocker = { ref, sourceStableKey: key, dependencyState: dep.state }; return undefined; }
        const value = match.values[template]; references.push({ ref, sourceStableKey: key, path: concrete, targetId: value, producerKind: 'setup-step' }); return value;
      }
      if (dep.state === 'empty') { blocker = { ref, sourceStableKey: key, dependencyState: 'unknown' }; return undefined; }
      if (dep.producer.kind === 'secondary-output') {
        // The parent (member) row must be ready for this key, and carry exactly one verified
        // secondary identity for this ref on this site. Nothing is inferred or recreated.
        const parentTask = ctx.manifest.tasks.find(task => task.id === dep.producer.taskId), parentSnapshot = parentTask && snapshots(ctx, parentTask);
        const parentSource = parentSnapshot?.sourceByKey.get(key);
        const parent = parentSource?.ref === dep.producer.parentRef && producedThisRun(ctx, index, key, dep) ? keyReady(ctx, index, key, { task: parentTask, snapshot: parentSnapshot, ref: dep.producer.parentRef }) : { ready: false };
        // The verification kind is whatever the parent's reviewed operation contract declares.
        const verification = proofs.operationContract(dep.producer.parentRef, parentTask?.writeOperations?.[dep.producer.parentRef])?.contract.secondaryOutputs?.[ref]?.verification;
        const identity = parent.ready ? local.verifiedSecondaryIdentity(parent.row, ref, ctx.siteId, verification) : null;
        // A parent (member) row that can no longer land in this run is a final cause, like any
        // other producer's: an owner hold, or failed / not attempted / absent after a finished pass.
        // A landed parent whose identity is unverified is not final; it waits for its read-back.
        if (!identity && !parent.ready) {
          const inSource = parentSource?.ref === dep.producer.parentRef, held = inSource && dep.held?.has(key);
          const status = held ? 'held' : parentFinal(key, dep, inSource);
          if (status) {
            if (finalOrWaived(ref, key, concrete, dep, status, { ...(held ? { holdReasons: dep.held.get(key) } : {}), path: concrete })) return undefined;
            // An owner hold is also a hold cause, as for any other producer: the hold decision is surfaced.
            if (held) holds.push({ ref, sourceStableKey: key, dependencyState: dep.state, holdReasons: dep.held.get(key) });
            return undefined;
          }
        }
        if (!identity) { blocker = { ref, sourceStableKey: key, dependencyState: parent.ready ? 'secondary-identity-unverified' : dep.state }; return undefined; }
        // Keep the owning parent: a payload that also references the parent ref must name this one.
        references.push({ ref, sourceStableKey: key, path: concrete, targetId: identity.targetId, producerKind: 'secondary-output', parentRef: dep.producer.parentRef, parentTargetId: parent.row.targetId }); return identity.targetId;
      }
      const producerTask = ctx.manifest.tasks.find(task => task.id === dep.producer.taskId);
      const snapshot = producerTask && snapshots(ctx, producerTask);
      let source, childState, childParent;
      if (dep.producer.kind === 'child-output') {
        // A variant: the one ready parent row whose verified receipt names this source key.
        const child = childIdentity(ctx, index, receipts.children.get(ref), dep.producer, key, dep);
        if (child.targetId) { references.push({ ref, sourceStableKey: key, path: concrete, targetId: child.targetId, producerKind: 'child-output', parentRef: dep.producer.parentRef, parentSourceKey: child.parentKey, parentTargetId: child.parentTargetId }); return child.targetId; }
        childState = child.state; childParent = child;
      } else {
        source = snapshot?.sourceByKey.get(key);
        const target = source?.ref === ref && producedThisRun(ctx, index, key, dep) ? keyReady(ctx, index, key, { task: producerTask, snapshot, ref }) : { ready: false };
        if (target.ready) {
          // The row usually holds a digest reference; the receipt itself comes from protected state.
          if (receipts.parents.has(ref) && !require('./write-verification').validReceipt(receipts.parents.get(ref).receipts.get(key), { siteId: ctx.siteId, sourceKey: key, targetId: target.row.targetId })) {
            blocker = { ref, sourceStableKey: key, dependencyState: 'imported-unverified' }; return undefined;
          }
          references.push({ ref, sourceStableKey: key, path: concrete, targetId: target.row.targetId }); return target.row.targetId;
        }
        // A dependency the record can go without (a product image) never makes it wait. The record is
        // written without it and the pair is recorded: with the reason the key cannot land in this run,
        // or `pending` / `held` while it still may. Once the key lands, omittedReady lists the record
        // and its verified media patch clears the row (recordOmissionsResolved).
        if (dep.mode === 'per-record' && dep.producer.kind === 'import-task' && failureOmits(ctx.task.entityRefs, ref, concrete)) {
          const status = source?.ref === ref && dep.held?.has(key) ? 'held' : failedForGood(ctx, index, key, dep, source?.ref === ref) || 'pending';
          const omission = { ref, sourceStableKey: key, path: concrete, action: 'omit-failed', dependencyStatus: status };
          // An order's product dependency is omittable only after its builder has deliberately
          // converted that line to a custom item. Ordinary catalog lines must keep waiting.
          if (ref === 'stores/product' && ctx.task.entityRefs.includes('ecom/order')) {
            customLineOmissions.push({ omission, blocker: { ref, sourceStableKey: key, dependencyState: dep.state } });
            return undefined;
          }
          references.push(omission); return undefined;
        }
        // The record names a record the owner held: it waits, with that hold as its cause.
        // Kept apart from `blocker` so a later unresolved reference never erases the hold cause.
        if (source?.ref === ref && dep.held?.has(key)) {
          if (finalOrWaived(ref, key, concrete, dep, 'held', { holdReasons: dep.held.get(key), path: concrete })) return undefined;
          holds.push({ ref, sourceStableKey: key, dependencyState: dep.state, holdReasons: dep.held.get(key) }); return undefined;
        }
      }
      const sourceTask = ctx.manifest.tasks.find(task => task.id === dep.producer.taskId);
      const sourceLinks = [...(sourceTask?.sourceBindings || []), ...(ctx.task.dependencySourceBindings || [])];
      const matches = sourceLinks.filter(source => source.ref === ref && typeof source.keyPrefix === 'string' && key.startsWith(source.keyPrefix));
      const censusId = (source?.ref === ref && snapshot.censusByKey.get(key)) || (matches.length === 1 ? matches[0].censusId || `entity:${matches[0].sourceEntity}` : null);
      const rule = adapter.rules.find(rule => rule.dependencyRef === ref && ctx.task.entityRefs.includes(rule.dependentRef) && rule.censusId === censusId && adapter.rows.get(censusId)?.state === 'excluded' && adapter.approved.has(censusId) && pathMatches(rule.path, concrete));
      if (rule?.action === 'omit') { omissions.push(concrete); references.push({ ref, sourceStableKey: key, path: concrete, action: 'omit' }); return undefined; }
      if (!rule && !dep.state.startsWith('excluded') && adapter.rows.get(censusId)?.state !== 'excluded') {
        if (dep.producer.kind === 'child-output') {
          const settled = ['finished-partial', 'complete', 'complete-with-holds'].includes(dep.state);
          const parentKey = childParent?.parentKey, parentHeld = parentKey && dep.held?.has(parentKey);
          if (settled && !parentKey && childState === 'child-identity-missing') { orphans.push({ ref, key, concrete, dep }); return undefined; }
          const status = !settled || !parentKey ? null : parentHeld ? 'held' : parentFinal(parentKey, dep, true);
          if (status) { finalOrWaived(ref, key, concrete, dep, status, { ...(parentKey ? { parentSourceKey: parentKey } : {}), ...(parentHeld ? { holdReasons: dep.held.get(parentKey) } : {}), path: concrete }); return undefined; }
        } else {
          const status = parentFinal(key, dep, source?.ref === ref);
          if (status) { finalOrWaived(ref, key, concrete, dep, status, { path: concrete }); return undefined; }
        }
      }
      blocker = { reason: rule?.action === 'defer' ? 'dependency-not-ready' : (dep.state.startsWith('excluded') || adapter.rows.get(censusId)?.state === 'excluded') ? 'dependency-disposition-rule-missing' : 'dependency-not-ready', ref, sourceStableKey: key, dependencyState: childState || dep.state };
      return undefined;
    };
    try {
      const payload = record.transform ? await record.transform({ resolveReference: (ref, key, concrete) => resolve(ref, key, concrete, 'record'), resolveTaskReference: (ref, key, concrete) => resolve(ref, key, concrete, 'task'), resolveSetupReference: (ref, key, concrete) => resolve(ref, key, concrete, 'setup'), resolveSameTaskReference: (ref, key, concrete) => resolve(ref, key, concrete, 'same-task') }) : record.payload;
      for (const candidate of customLineOmissions) {
        if (isCustomOrderLine(payload, candidate.omission.path)) references.push(candidate.omission);
        else blocker ||= candidate.blocker;
      }
      for (const orphan of orphans) {
        const entry = orphan.concrete.slice(0, orphan.concrete.indexOf(']') + 1), parentRef = orphan.dep.producer.parentRef;
        const parent = entry && finals.find(row => row.ref === parentRef && row.path?.startsWith(entry))
          || entry && references.find(row => row.ref === parentRef && row.action === 'omit-failed' && row.path?.startsWith(entry));
        finalOrWaived(orphan.ref, orphan.key, orphan.concrete, orphan.dep, parent?.parentStatus || 'child-identity-missing', { ...(parent ? { parentSourceKey: parent.sourceStableKey } : {}), ...(parent?.holdReasons ? { holdReasons: parent.holdReasons } : {}), path: orphan.concrete });
      }
      // A decided builder hold is never sent and is not a reference gap: it is already reviewed in
      // the read-back inventory. It defers here with its reasons, like any other deferral.
      const held = require('./read-back-contract').builderHold(payload);
      if (held) { defer.push({ ...record, deferral: { reason: 'builder-held', holds: held } }); continue; }
      require('./mapping-recovery').assertPayload(ctx.projectDir, assessments.current()?.plan || {}, ctx.task.entityRefs, payload, {sourceStableKey:record.sourceStableKey});
      if (payload?.deferred && typeof payload.reason === 'string') { blocker = { reason: payload.reason, dependencyState: 'unknown' }; await persistReferenceGap(ctx, record.sourceStableKey, payload.reason); }
      for (const concrete of omissions) if (valueAt(payload, concrete) !== undefined) throw new Error('dependency-excluded-reference-present');
      // Guarded paths come from the current reviewed operation contract: a payload that writes one
      // contradicts the proof (including a source catch-up record that now references the ref).
      for (const dep of dependencies.filter(dep => dep.producer.kind === 'no-producer')) for (const row of dep.producer.proofs) {
        const guards = proofs.operationContract(row.entityRef, row.operation)?.contract.dependencies?.[dep.ref]?.guardedPaths;
        if (!guards?.length || proofs.guardHits(payload, guards).length) throw new Error('dependency-proof-contradicted');
      }
      // A ref the task's operation does not depend on (declared inapplicable) has no reference template here.
      for (const targetRef of ctx.task.entityRefs) for (const [ref, templates] of Object.entries(domain(targetRef).dependencyReferenceFields || {})) if (checked.includes(ref)) for (const template of templates) {
        const unresolved = expandPaths(payload, template).filter(concrete => valueAt(payload, concrete) !== undefined && !references.some(reference => reference.path === concrete && !reference.action && declaresPath(ctx.task.entityRefs, reference.ref, concrete)));
        if (unresolved.length && !dropUnchecked(payload, references, ctx.task.entityRefs, ref, template, unresolved, lookup)) throw new Error('dependency-reference-unresolved');
      }
      // A same-task parent id comes only from resolveSameTaskReference, never from local evidence.
      for (const field of ownFields) for (const concrete of expandPaths(payload, field.template)) if (valueAt(payload, concrete) !== undefined && !references.some(reference => reference.producerKind === 'same-task' && reference.path === concrete)) throw new Error('dependency-reference-unresolved');
      // A reference resolved but not written (a buyer link dropped after corroboration) sends nothing.
      const used = references.filter(reference => reference.action || valueAt(payload, reference.path) !== undefined);
      for (const ref of used.filter(ref => !ref.action)) if (valueAt(payload, ref.path) !== ref.targetId) throw new Error('dependency-reference-payload-mismatch');
      if (identityPairMismatch(payload, used, ctx.task.entityRefs)) throw new Error('dependency-identity-pair-mismatch');
      const heldFinal = holds.filter(hold => !finals.some(row => row.ref === hold.ref && row.sourceStableKey === hold.sourceStableKey));
      if (blocker || heldFinal.length) defer.push({ ...record, deferral: { reason: blocker ? 'dependency-not-ready' : 'dependency-held', ...(blocker || heldFinal[0]), ...(holds.length ? { holdCauses: holds } : {}) } });
      else if (finals.length) defer.push({ ...record, deferral: { reason: 'dependency-parent-final', final: true, ...finals[0], finalCauses: finals, ...(holds.length ? { holdCauses: holds } : {}) } });
      else { allowed.add(record.sourceStableKey); send.push({ ...record, payload, references: used }); }
    } catch (error) { defer.push({ ...record, deferral: { ...(holds.length ? { holdCauses: holds } : {}), reason: ['REFERENCE_UNDECLARED', 'dependency-excluded-reference-present', 'dependency-reference-payload-mismatch', 'dependency-reference-unresolved', 'dependency-proof-contradicted', 'dependency-identity-pair-mismatch'].includes(error.message) ? error.message : 'dependency-transform-failed' } }); }
  }
  for (const record of defer) await local.appendAttempt(ctx.projectDir, { schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: record.sourceStableKey, writeSpecId: ctx.taskId, operation: 'create', targetEntityType: ctx.task.entityRefs[0], status: 'deferred', runId: ctx.runId, phase: 'import', ts: new Date().toISOString(), deferral: record.deferral });
  const omitted = send.flatMap(record => record.references.filter(reference => reference.action === 'omit-failed').map(reference => ({ ref: reference.ref, dependencySourceKey: reference.sourceStableKey ?? `unchecked:${reference.uncheckedTargetId}`, dependencyStatus: reference.dependencyStatus, sourceStableKey: record.sourceStableKey })));
  await updateDiagnostic(ctx.projectDir, async projection => {
    if (!projection.tasks[ctx.taskId]) return false;
    projection.tasks[ctx.taskId].waiting = projectWaiting(ctx, await evidenceIndex(ctx));
    projection.tasks[ctx.taskId].heldDependencies = heldDependencies(projection.tasks[ctx.taskId].waiting);
    const finalRows = finalDeferrals(projection.tasks[ctx.taskId].waiting);
    if (finalRows.length) projection.tasks[ctx.taskId].finalDeferrals = finalRows; else delete projection.tasks[ctx.taskId].finalDeferrals;
    // The record's own landed state, not a dependency key check (kept out of the scan counters).
    const current = await evidenceIndex(ctx), landed = key => { const attempt = current.attempts.get(key), row = current.crosswalk.get(key); return attempt?.siteId === ctx.siteId && row?.siteId === ctx.siteId && row.status === 'imported' && ['imported', 'skipped_already_imported'].includes(attempt.status); };
    const rows = mergeOmitted(projection.tasks[ctx.taskId].omittedReferences, send.map(record => record.sourceStableKey).filter(key => !landed(key)), omitted, ctx);
    if (rows.length) projection.tasks[ctx.taskId].omittedReferences = rows; else delete projection.tasks[ctx.taskId].omittedReferences;
  });
  const payloads = new Map(send.map(record => [record.sourceStableKey, record.references.map(reference => Object.freeze({ ...reference }))]));
  const grant = Object.freeze({ taskId: ctx.taskId, runId: ctx.runId, siteId: ctx.siteId });
  const proofGuards = dependencies.filter(dep => dep.producer.kind === 'no-producer').flatMap(dep => dep.producer.proofs.flatMap(row => proofs.operationContract(row.entityRef, row.operation)?.contract.dependencies?.[dep.ref]?.guardedPaths || []));
  grants.set(grant, { ctx, index, allowed, payloads, proofGuards, stamp: state.stamp, taskBinding: state.taskBinding, generation: state.generation, crosswalkPublishedOffset: (index.crosswalkPublished || []).length });
  return { send, defer, grant };
}
// One row per dependent record and dependency key it was sent without. A record admitted again
// before it landed replaces its rows (its image may have landed since); a landed record keeps them,
// since the live record still lacks what it was written without. The completion report turns rows whose record
// landed into cutover items.
function mergeOmitted(existing, admittedKeys, rows, ctx) {
  const admitted = new Set(admittedKeys);
  const byPair = new Map((existing || []).filter(row => !admitted.has(row.sourceStableKey)).map(row => [row.sourceStableKey + '\n' + row.dependencySourceKey, row]));
  // A writer that reports this omission as its own cutover item (every entity of the task declares it).
  const ownItem = ref => { const codes = ctx.task.entityRefs.map(entityRef => domain(entityRef).dependencyFailureCutoverItems?.[ref]); return codes.every(code => code && code === codes[0]) ? codes[0] : null; };
  for (const row of rows) byPair.set(row.sourceStableKey + '\n' + row.dependencySourceKey, { ...row, ...(ownItem(row.ref) ? { cutoverItem: ownItem(row.ref) } : {}), siteId: ctx.siteId, runId: ctx.runId, recordedAt: new Date().toISOString(),
    operatorRole: 'Requires Import Operator', action: row.dependencyStatus === 'waived'
      ? `${row.sourceStableKey} was imported without its ${row.ref} link (${row.dependencySourceKey}) by an operator waiver, because that record did not land. If the ${row.ref} record is fixed later, add the link to ${row.sourceStableKey} with a reviewed update; otherwise this loss is accepted. Do not recreate the record.`
      : row.dependencyStatus === 'unchecked-reference'
      ? `The importer built ${row.sourceStableKey} with a ${row.ref} id the dependency gate never resolved (${row.dependencySourceKey.slice('unchecked:'.length)}), so it was left out. Find the source ${row.ref} record that id was meant to name, import it through its task if it is missing, then add it to ${row.sourceStableKey} with a reviewed update. Do not recreate the record.`
      : `Re-import ${row.ref} ${row.dependencySourceKey} (run-import:${ctx.task.dependencyEdges.find(edge => edge.ref === row.ref)?.producer.taskId || row.ref} --failed-only) if it has not landed, then run the media patch pass, which adds it to ${row.sourceStableKey} through a verified update and clears this row. Do not recreate the record.` });
  return [...byPair.values()].sort((a, b) => (a.sourceStableKey + a.dependencySourceKey).localeCompare(b.sourceStableKey + b.dependencySourceKey));
}
// A secondary identity belongs to one parent (a contact to the member whose write created or
// matched it). When the same payload also carries a reference to that parent ref, both must name
// the same parent; two individually verified IDs for different people are refused.
// A child identity belongs to one parent too (a variant to its product), but per array entry: the
// parent reference in the same entry (the same order line's catalogItemId) must be present and name
// that parent.
function siblingPath(template, concrete) {
  const parts = template.split('.'), given = concrete.split('.'), out = [];
  for (const [i, part] of parts.entries()) {
    if (!part.endsWith('[]')) { out.push(part); continue; }
    const match = given[i] && /^(\w+)\[(\d+)\]$/.exec(given[i]);
    if (!match || match[1] !== part.slice(0, -2) || out.some((seg, j) => seg !== given[j])) return null;
    out.push(given[i]);
  }
  return out.join('.');
}
function identityPairMismatch(body, references, entityRefs, { partial = false } = {}) {
  for (const reference of references.filter(row => row.producerKind === 'child-output')) {
    if (partial && !Object.hasOwn(body || {}, reference.path.split(/[.\[]/)[0])) continue;
    const paths = entityRefs.flatMap(entityRef => (domain(entityRef).dependencyReferenceFields?.[reference.parentRef] || []).map(template => siblingPath(template, reference.path))).filter(Boolean);
    if (!paths.length || paths.some(sibling => valueAt(body, sibling) !== reference.parentTargetId)) return true;
  }
  for (const reference of references.filter(row => row.producerKind === 'secondary-output')) {
    for (const entityRef of entityRefs) for (const template of domain(entityRef).dependencyReferenceFields?.[reference.parentRef] || []) {
      if (partial && !Object.hasOwn(body || {}, template.split(/[.\[]/)[0])) continue;
      if (proofs.valuesAt(body, template).some(value => value !== undefined && value !== null && value !== '' && value !== reference.parentTargetId)) return true;
    }
  }
  return false;
}
// Bulk shapes whose items each belong to one source record. An unknown shape is refused, never
// checked as one body: the per-item key list must line up with the items the request writes.
const BULK_ITEMS = { 'crm/contact': body => body?.contacts, 'seo/item-seo-tags': body => body?.entries, 'stores/review': body => body?.reviews };
const bulkItems = (entityRefs, body) => { const shapes = entityRefs.map(ref => BULK_ITEMS[ref]).filter(Boolean); return shapes.length === 1 ? shapes[0](body) : undefined; };
// A record client writes one product through the bulk create (importProducts sends one row per
// record). That body is `{ products: [product] }`: the record's own product is its one item, and
// every check reads that item. Reading the wrapper found no tag at `tags.publicTags.tagIds[0]` and
// refused every tagged product.
const PRODUCT_BULK_CREATE = /^\/stores\/v3\/bulk\/products(?:-with-inventory)?\/create$/;
function singleBulkProduct(request) {
  if (typeof request?.url !== 'string' || !Array.isArray(request.body?.products) || request.body.products.length !== 1) return undefined;
  try { return PRODUCT_BULK_CREATE.test(new URL(request.url).pathname) ? request.body.products[0] : undefined; } catch { return undefined; }
}
function verifyGrant(grant, clientContext, sourceStableKey, request, { auxiliary = false, partial = false } = {}) {
  const stored = grants.get(grant);
  // A bulk body carries many records; only verifyBulkGrant may admit it, one key per item.
  if (stored && request && bulkItems(stored.ctx.task.entityRefs, request.body) !== undefined) return false;
  const bulkProduct = stored && request && stored.ctx.task.entityRefs.includes('stores/product') ? singleBulkProduct(request) : undefined;
  if (stored && request) {
    try { require('./mapping-recovery').assertPayload(stored.ctx.projectDir, assessments.current()?.plan || {}, stored.ctx.task.entityRefs, bulkProduct || request.body, {sourceStableKey}); } catch { return false; }
  }
  if (stored && request && !auxiliary) {
    const body = bulkProduct || request.body?.order || request.body?.product || request.body?.member || request.body?.contact || request.body?.specification || request.body?.discountRule || request.body?.category || request.body;
    // A partial write (a product PATCH) is checked on the top-level fields it actually sends.
    const guards = partial ? stored.proofGuards.filter(guard => Object.hasOwn(body || {}, proofs.guardPath(guard).split(/[.\[]/)[0])) : stored.proofGuards;
    if (proofs.guardHits(body, guards).length) return false;
    if (identityPairMismatch(body, stored.payloads.get(sourceStableKey) || [], stored.ctx.task.entityRefs, { partial })) return false;
    for (const reference of stored.payloads.get(sourceStableKey) || []) { if (partial && !Object.hasOwn(body || {}, reference.path.split(/[.\[]/)[0])) continue; if (reference.action === 'omit-failed') continue; const value = valueAt(body, reference.path); if (reference.action === 'omit' ? value !== undefined : value !== reference.targetId) return false; }
    // Every reference the outgoing body carries must be one the gate resolved at that exact path:
    // a line added or reordered after gating cannot carry an unchecked ID.
    const granted = stored.payloads.get(sourceStableKey) || [];
    for (const targetRef of stored.ctx.task.entityRefs) for (const [ref, templates] of Object.entries(domain(targetRef).dependencyReferenceFields || {})) if (checkedRefs(stored.ctx.task).includes(ref)) for (const template of templates) {
      if (partial && !Object.hasOwn(body || {}, template.split(/[.\[]/)[0])) continue;
      for (const concrete of expandPaths(body, template)) if (valueAt(body, concrete) !== undefined && !granted.some(row => row.path === concrete && !row.action && declaresPath(stored.ctx.task.entityRefs, row.ref, concrete))) return false;
    }
    for (const field of sameTaskFields(stored.ctx.task.entityRefs)) {
      if (partial && !Object.hasOwn(body || {}, field.template.split(/[.\[]/)[0])) continue;
      for (const concrete of expandPaths(body, field.template)) if (valueAt(body, concrete) !== undefined && !granted.some(row => row.producerKind === 'same-task' && row.path === concrete)) return false;
    }
  }
  return Boolean(stored && stored.ctx.taskId === clientContext.taskId && stored.ctx.runId === clientContext.runId && stored.ctx.siteId === clientContext.siteId && stored.allowed.has(sourceStableKey) && evaluationGenerations.get(stored.taskBinding) === stored.generation && stored.stamp === fingerprint(stored.ctx));
}
function verifyBulkGrant(grant, clientContext, sourceStableKeys, request, options = {}) {
  if (!request || request.sourceStableKey !== undefined || !Array.isArray(sourceStableKeys) || !sourceStableKeys.length) return false;
  const items = bulkItems(grants.get(grant)?.ctx.task.entityRefs || [], request.body);
  if (!Array.isArray(items) || items.length !== sourceStableKeys.length) return false;
  // Index loops, not some/every: those skip sparse holes, and a hole would send an unchecked item.
  const seen = new Set();
  for (let i = 0; i < sourceStableKeys.length; i++) {
    const key = sourceStableKeys[i];
    if (!Object.hasOwn(sourceStableKeys, i) || !Object.hasOwn(items, i) || typeof key !== 'string' || !key || seen.has(key)) return false;
    seen.add(key);
    if (!items[i] || typeof items[i] !== 'object' || !verifyGrant(grant, clientContext, key, { ...request, body: items[i] }, options)) return false;
  }
  return true;
}
function verifyReferenceTargets(grant, ctx, key, ref, ids) {
  const stored = grants.get(grant);
  if (!verifyGrant(grant, ctx, key) || !Array.isArray(ids)) return false;
  const expected = new Set((stored.payloads.get(key) || []).filter(row => row.ref === ref && !row.action).map(row => row.targetId));
  return ids.length === expected.size && new Set(ids).size === ids.length && ids.every(id => expected.has(id));
}
// One reference id the record was granted for `ref` (any of them, unlike verifyReferenceTargets).
function verifyReferenceMember(grant, ctx, key, ref, id) {
  const stored = grants.get(grant);
  if (!verifyGrant(grant, ctx, key) || typeof id !== 'string' || !id) return false;
  return (stored.payloads.get(key) || []).some(row => row.ref === ref && !row.action && row.targetId === id);
}
function currentRecordTargetId(grant, clientContext, sourceStableKey) {
  const stored = grants.get(grant);
  if (!verifyGrant(grant, clientContext, sourceStableKey)) return null;
  const current = keyReady(stored.ctx, stored.index, sourceStableKey, { task: stored.ctx.task, snapshot: snapshots(stored.ctx, stored.ctx.task) });
  if (current.ready) return current.row.targetId;
  // LIVE-FOUND: a record whose existing target this grant's own write reconciled and verified (a
  // product an earlier run created) is not ready in the index yet -- the journal is re-read only at
  // the next evaluation, so its latest attempt there is still the earlier one -- and its follow-up
  // writes (a media patch) were refused. Its crosswalk row is admitted only when the crosswalk
  // listener saw it published after this grant (crosswalk updates only: an attempt row never
  // counts), for this site and key, and carries a write-verification reference to the same target;
  // updateCrosswalkRows checked that receipt before publishing the row. Product tasks only: their
  // readers (recordProductMatches for media/tags/membership writes) are the ones this fixes; a review
  // or booking task's readers (recordOwnReview, recordSawTarget) keep the index-ready rule.
  if (!stored.ctx.task.entityRefs.includes('stores/product')) return null;
  const row = stored.index.crosswalk?.get(sourceStableKey), ref = row?.verification;
  const published = Number.isInteger(stored.crosswalkPublishedOffset) && (stored.index.crosswalkPublished || []).slice(stored.crosswalkPublishedOffset).includes(sourceStableKey);
  if (!published || !row || row.status !== 'imported' || row.siteId !== stored.ctx.siteId) return null;
  const source = snapshots(stored.ctx, stored.ctx.task).sourceByKey.get(sourceStableKey);
  return source?.ref === 'stores/product' && rowMatchesSource(row, source) && ref?.storage === 'write-verification' && ref.kind === 'product'
    && ref.sourceKey === sourceStableKey && ref.targetId === row.targetId && ref.siteId === stored.ctx.siteId ? row.targetId : null;
}
// A within-write dependency the containing write initiated but could not yet verify
// (late or dropped product media) stays visible against the landed parent's target ID, in the
// diagnostic completion and handoff already read. It never resends the parent. Both recording and
// clearing take the writer's registered observation: recording needs an unresolved/unverifiable one
// for this target, site and ref; clearing needs a later `verified` one for the same target, site,
// ref and intended items. Anything else keeps the gap and its operator action.
async function recordWithinWriteGap({ grant, taskBinding, sourceStableKey, ref, targetId, code, resolved = false, observation = null }) {
  // The grant that admitted this record's write identifies it (task, run, site, admitted key). A later
  // evaluation of the task -- the next batch, while this product's observation was still running --
  // must not make the outcome of an already-sent write unrecordable, so generation is not required.
  const stored = grants.get(grant), bound = capability.requireKind(taskBinding, 'import-task');
  if (!stored || stored.ctx.taskId !== bound.taskId || stored.ctx.runId !== bound.runId || stored.ctx.siteId !== bound.siteId || !stored.allowed.has(sourceStableKey)) throw new Error('DEPENDENCY_READINESS_REQUIRED');
  const edge = (stored.ctx.task.dependencyEdges || []).find(edge => edge.ref === ref);
  if (!edge || edge.producer.kind !== 'no-producer' || !edge.producer.proofs.some(row => row.reason === 'within-write')) throw new Error('WITHIN_WRITE_EDGE_REQUIRED');
  if (typeof targetId !== 'string' || !targetId || typeof code !== 'string' || !/^[a-z0-9-]+$/.test(code)) throw new Error('WITHIN_WRITE_GAP_INVALID');
  const evidence = require('../resources/rp-target-wix/lib/wix-writers').withinWriteObservation(observation);
  if (!evidence || evidence.ref !== ref || evidence.productId !== targetId || evidence.siteId !== stored.ctx.siteId) throw new Error('WITHIN_WRITE_EVIDENCE_INVALID');
  if (!resolved && !['unresolved', 'unverifiable'].includes(evidence.status)) throw new Error('WITHIN_WRITE_EVIDENCE_INVALID');
  let result;
  await updateDiagnostic(stored.ctx.projectDir, diagnostic => {
    const task = diagnostic.tasks[stored.ctx.taskId] || (diagnostic.tasks[stored.ctx.taskId] = { schemaVersion: 1, siteId: stored.ctx.siteId, taskId: stored.ctx.taskId, blocked: [], waiting: [] });
    const existing = (task.withinWriteGaps || []).find(row => row.sourceStableKey === sourceStableKey && row.ref === ref);
    if (resolved) {
      if (!existing) { result = task.withinWriteGaps || []; return false; }
      if (evidence.status !== 'verified' || existing.targetId !== targetId || existing.expectedDigest !== evidence.expectedDigest || !(Date.parse(evidence.observedAt) > Date.parse(existing.recordedAt))) throw new Error('WITHIN_WRITE_EVIDENCE_INVALID');
    }
    const gaps = (task.withinWriteGaps || []).filter(row => row !== existing);
    if (!resolved) gaps.push({ ref, sourceStableKey, targetId, code, siteId: stored.ctx.siteId, runId: stored.ctx.runId, expectedDigest: evidence.expectedDigest,
      observation: { status: evidence.status, reads: evidence.reads, reasons: evidence.reasons, observedAt: evidence.observedAt }, recordedAt: evidence.observedAt,
      operatorRole: 'Requires Import Operator', action: `Read back target ${targetId} for ${ref}; if it is still missing, follow the existing ${ref} recovery for this record. Do not recreate or resend the landed parent.` });
    result = task.withinWriteGaps = gaps.sort((a, b) => (a.sourceStableKey + a.ref).localeCompare(b.sourceStableKey + b.ref));
  });
  return result;
}
// The media patch pass (generic: any ref with `dependencyFailureActions: omit`). Records this task
// already wrote without a dependency that has since landed in this run, so the runner can gate each
// again with its full reference list and send the reviewed update (product media:
// patchStoresProductMediaVerified). Unchecked ids name no record and are never listed.
async function omittedReady({ taskBinding }) {
  const ctx = capability.requireKind(taskBinding, 'import-task'), index = await evidenceIndex(ctx);
  const rows = read(ctx.projectDir, 'execution/dependency-readiness.json', { tasks: {} }).tasks?.[ctx.taskId]?.omittedReferences || [];
  const landed = key => { const attempt = index.attempts.get(key), row = index.crosswalk.get(key); return attempt?.siteId === ctx.siteId && row?.siteId === ctx.siteId && row.status === 'imported' && ['imported', 'skipped_already_imported'].includes(attempt.status); };
  const result = new Map();
  for (const row of rows) {
    if (row.siteId !== ctx.siteId || !landed(row.sourceStableKey) || row.dependencySourceKey.startsWith('unchecked:') || row.dependencyStatus === 'waived') continue;
    const edge = ctx.task.dependencyEdges.find(edge => edge.ref === row.ref), producer = edge?.producer.kind === 'import-task' && ctx.manifest.tasks.find(task => task.id === edge.producer.taskId);
    if (!producer || index.attempts.get(row.dependencySourceKey)?.runId !== ctx.runId || !keyReady(ctx, index, row.dependencySourceKey, { task: producer, snapshot: snapshots(ctx, producer), ref: row.ref }).ready) continue;
    result.set(row.sourceStableKey, [...(result.get(row.sourceStableKey) || []), row.dependencySourceKey]);
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b)).map(([sourceStableKey, dependencySourceKeys]) => ({ sourceStableKey, dependencySourceKeys: dependencySourceKeys.sort() }));
}
// Clears the omission rows a verified update repaired. `readBack` is the trusted Wix read of the
// record after the update (patchStoresProductMediaVerified's `product`); a row clears only when the
// grant that admitted the update resolved its dependency key and that target id is on the read.
async function recordOmissionsResolved({ grant, taskBinding, sourceStableKey, readBack, targetId }) {
  const stored = grants.get(grant), bound = capability.requireKind(taskBinding, 'import-task');
  if (!stored || stored.ctx.taskId !== bound.taskId || stored.ctx.runId !== bound.runId || stored.ctx.siteId !== bound.siteId || !stored.allowed.has(sourceStableKey)) throw new Error('DEPENDENCY_READINESS_REQUIRED');
  if (!require('../resources/rp-target-wix/lib/wix-writers').validReadBackEvidence(readBack, { siteId: stored.ctx.siteId, targetId })) throw new Error('OMISSION_EVIDENCE_INVALID');
  const values = new Set(), visit = value => { if (typeof value === 'string') values.add(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
  visit(readBack);
  const repaired = new Set((stored.payloads.get(sourceStableKey) || []).filter(row => !row.action && values.has(row.targetId)).map(row => row.ref + '\n' + row.sourceStableKey));
  let remaining;
  await updateDiagnostic(stored.ctx.projectDir, diagnostic => {
    const task = diagnostic.tasks[stored.ctx.taskId];
    if (!task?.omittedReferences) { remaining = []; return false; }
    task.omittedReferences = task.omittedReferences.filter(row => row.sourceStableKey !== sourceStableKey || !repaired.has(row.ref + '\n' + row.dependencySourceKey));
    remaining = task.omittedReferences.filter(row => row.sourceStableKey === sourceStableKey);
    if (!task.omittedReferences.length) delete task.omittedReferences;
  });
  return remaining;
}
async function finishTaskPass({ taskBinding, selection = { mode: 'full' } }) {
  const ctx = capability.requireKind(taskBinding, 'import-task');
  if (!SELECTIVE.has(selection.mode)) throw new Error('readiness_selection_invalid');
  const snapshot = snapshots(ctx, ctx.task);
  const row = { schemaVersion: 1, taskId: ctx.taskId, entityRefs: ctx.task.entityRefs, runId: ctx.runId, planVersion: ctx.manifest.planVersion,
    manifestDigest: fileDigest(ctx.projectDir, 'execution/execution-manifest.json'), setupPlanDigest: fileDigest(ctx.projectDir, 'setup/setup-plan.json'),
    mappingPlanDigest: fileDigest(ctx.projectDir, 'mapping/mapping-plan.json'), siteId: ctx.siteId, sourceSnapshotDigests: snapshot.digests,
    selection, dryRun: ctx.dryRun, finishedAt: new Date().toISOString() };
  validatePass(row); const passPath = inside(ctx.projectDir, PASS_FILE); await fsp.mkdir(path.dirname(passPath), { recursive: true }); await fsp.appendFile(passPath, JSON.stringify(row) + '\n'); return row;
}
async function reconcileSiteEvidence({ taskBinding, readBack }) {
  const ctx = capability.requireKind(taskBinding, 'import-task'), index = await evidenceIndex(ctx), snapshot = snapshots(ctx, ctx.task);
  for (const key of snapshot.keys) {
    const row = index.crosswalk.get(key);
    if (!row || keyReady(ctx, index, key, { task: ctx.task, snapshot }).ready) continue;
    let matched = null;
    try { matched = await readBack({ targetId: row.targetId, sourceStableKey: key, siteId: ctx.siteId }); } catch {}
    if (!matched || matched.matchesRecordedWrite !== true || !require('../resources/rp-target-wix/lib/wix-writers').validReadBackEvidence(matched.result, { siteId: ctx.siteId, targetId: row.targetId })) continue;
    await local.updateCrosswalkRows(ctx.projectDir, [{ ...row, siteId: ctx.siteId, evidence: 'site-reconciled' }]);
    const previous = index.attempts.get(key);
    await local.appendAttempt(ctx.projectDir, { ...(previous || { schemaVersion: 1, sourceStableKey: key, writeSpecId: ctx.taskId, operation: 'create', targetEntityType: row.targetEntityType, runId: ctx.runId, phase: 'import' }), attemptId: crypto.randomUUID(), siteId: ctx.siteId, status: 'imported', evidence: 'site-reconciled', ts: new Date().toISOString() });
  }
}
module.exports = { startImportRun: capability.startImportRun, bindTask: capability.bindTask, bindDependencyProducers, resolveManifestGraph, dependencyModeErrors,
  validateImportInputs, validateAssociations, loadDependencyDispositions, preflightMappingDependencies, pluginInventoryErrors, deriveDependencyEdges, evaluateTask, gateBatch,
  verifyGrant, verifyBulkGrant, sameTaskReferenceFields: sameTaskFields, recordTaskGap, recordClientTaskGap, verifyReferenceTargets, verifyReferenceMember, holdCausesOf, finalDeferrals, linkChoice, linkRequired, currentRecordTargetId, recordWithinWriteGap, omittedReady, recordOmissionsResolved, finishTaskPass, reconcileSiteEvidence, validatePass, PASS_FILE, pathMatches, valueAt, expandPaths };
for (const name of ['deriveDependencyEdges', 'dependencyModeErrors', 'loadDependencyDispositions', 'preflightMappingDependencies', 'validateImportInputs']) {
  const run = module.exports[name];
  module.exports[name] = (projectDir, ...args) => assessments.withProject(projectDir, () => run(projectDir, ...args));
}
for (const name of ['bindDependencyProducers', 'resolveManifestGraph', 'validateAssociations']) {
  const run = module.exports[name];
  module.exports[name] = options => options.plan ? assessments.withPlan(options.plan, options.projectDir, () => run(options)) : run(options);
}
for (const name of ['evaluateTask', 'finishTaskPass', 'reconcileSiteEvidence']) {
  const run = module.exports[name];
  module.exports[name] = options => assessments.withProject(capability.requireKind(options.taskBinding, 'import-task').projectDir, () => run(options));
}
module.exports.gateBatch = options => {
  const state = evaluations.get(options.evaluation);
  return state ? assessments.withProject(state.ctx.projectDir, () => gateBatch(options)) : gateBatch(options);
};
for (const name of ['verifyGrant', 'verifyBulkGrant']) {
  const run = module.exports[name];
  module.exports[name] = (grant, ...args) => {
    const stored = grants.get(grant);
    if (!stored) return false;
    try { return assessments.withProject(stored.ctx.projectDir, () => run(grant, ...args)); } catch { return false; }
  };
}
