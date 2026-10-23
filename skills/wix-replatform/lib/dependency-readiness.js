'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const capability = require('./execution-capability');
const local = require('./local-state');
const setup = require('./setup-verification');
const census = require('./census-reconciliation');
const recovery = require('./dependency-recovery');
const { readEntityMappings } = require('./website-handoff');
const evaluations = new WeakMap();
const evaluationGenerations = new WeakMap();
const grants = new WeakMap();
const indexes = new Map();
const subscriptions = new Map();
const PASS_FILE = 'state/readiness/task-passes.ndjson';
const MODES = new Set(['task-complete', 'per-record']);
const SELECTIVE = new Set(['full', 'entity', 'source-type', 'missing-only', 'failed-only', 'deferred-only', 'unresolved-only']);
const refPattern = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function evidenceReason(error) { return /^(?:dependency_|readiness_|mapping_plan_|entity_ref_|task_depends_on_|site_id_|plan_digest_)[a-zA-Z0-9_:\-/;,]+$/.test(error.message || '') ? error.message : error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING' ? 'dependency-evidence-missing' : 'dependency-evidence-invalid'; }
function read(projectDir, file, fallback) {
  try { return JSON.parse(fs.readFileSync(inside(projectDir, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && arguments.length === 3) return fallback; throw error; }
}
function inside(projectDir, file) {
  const root = path.resolve(projectDir), absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) throw new Error('DEPENDENCY_PATH_OUTSIDE_PROJECT');
  return absolute;
}
const digestCache = new Map(), snapshotCache = new Map();
function fileDigest(projectDir, file) { const absolute = inside(projectDir, file), stamp = statKey(absolute), prior = digestCache.get(absolute); if (prior?.stamp === stamp) return prior.digest; const digest = hash(fs.readFileSync(absolute)); digestCache.set(absolute, { stamp, digest }); return digest; }
function domain(ref) {
  if (!refPattern.test(ref)) throw new Error(`entity_ref_unknown:${ref}`);
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../resources/rp-target-wix/domains', ref.split('/')[0], 'entities', ref.split('/')[1] + '.json'))); }
  catch { throw new Error(`entity_ref_unknown:${ref}`); }
}
function transitiveRefs(refs, result = new Set()) {
  for (const ref of refs) for (const dep of domain(ref).dependsOn || []) {
    if (!result.has(dep)) { result.add(dep); transitiveRefs([dep], result); }
  }
  return [...result].sort();
}
function edgeMode(task, ref) {
  const modes = task.entityRefs.map(entity => domain(entity).dependencyModes?.[ref] || 'task-complete');
  return modes.every(mode => mode === 'per-record') ? 'per-record' : 'task-complete';
}
function bindDependencyProducers({ manifest, setupPlan, dispositions = {}, scopeRefs = [] }) {
  const result = {}, errors = [], available = new Set(scopeRefs);
  for (const task of manifest.tasks || []) for (const ref of task.entityRefs || []) { available.add(ref); try { domain(ref); } catch (e) { errors.push(e.message); } }
  const imports = (manifest.tasks || []).filter(task => task.kind === 'import');
  for (const task of imports) {
    const refs = transitiveRefs(task.entityRefs || []);
    if (!equal([...(task.dependencyRefs || [])].sort(), refs)) errors.push(`dependency_refs_mismatch:${task.id}`);
    const edges = [];
    for (const ref of refs) {
      const producers = [];
      for (const producer of imports) if ((producer.entityRefs || []).includes(ref)) producers.push({ kind: 'import-task', taskId: producer.id });
      const stepIds = (setupPlan.steps || []).filter(step => (step.entityRefs || []).includes(ref)).map(step => step.id).sort();
      if (stepIds.length) producers.push({ kind: 'setup-step', stepIds });
      if (dispositions[ref]) producers.push({ kind: 'disposition', censusIds: dispositions[ref].censusIds, reconciliationSha256: dispositions[ref].reconciliationSha256 });
      if (producers.length !== 1) { errors.push(`dependency_${producers.length ? 'multiply_bound' : 'unbound'}:${ref}`); continue; }
      const mode = edgeMode(task, ref), producer = producers[0];
      if (!MODES.has(mode) || mode === 'per-record' && producer.kind === 'setup-step') errors.push(`dependency_mode_invalid:${task.id}:${ref}`);
      edges.push({ ref, mode, producer }); result[ref] = producer;
      const emitted = (task.dependencyEdges || []).find(edge => edge.ref === ref);
      if (!emitted) errors.push(`dependency_edge_missing:${task.id}:${ref}`);
      else if (emitted.mode !== mode) errors.push(`dependency_edge_mode_mismatch:${task.id}:${ref}`);
      else if (!equal(emitted.producer, producer)) errors.push(`dependency_edge_producer_mismatch:${task.id}:${ref}`);
    }
    if ((task.dependencyEdges || []).length !== refs.length) errors.push(`dependency_edge_coverage:${task.id}`);
    const taskIds = [...new Set(edges.filter(edge => edge.producer.kind === 'import-task').map(edge => edge.producer.taskId))].sort();
    if (!equal([...(task.dependsOn || [])].sort(), taskIds)) errors.push(`task_depends_on_mismatch:${task.id}`);
  }
  return { ok: errors.length === 0, errors, producers: result };
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
    const ids = row.censusIds || (row.sourceEntity ? [`entity:${row.sourceEntity}`] : []);
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
async function loadDependencyDispositions(projectDir) {
  const plan = read(projectDir, 'mapping/mapping-plan.json');
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
  return { dispositions, ...validated, rows, approved, reconciliationSha256 };
}
function validateImportInputs(projectDir) {
  const manifest = read(projectDir, 'execution/execution-manifest.json'), setupPlan = read(projectDir, 'setup/setup-plan.json');
  const plan = read(projectDir, 'mapping/mapping-plan.json');
  if (read(projectDir, 'orchestration/state.json', {})?.finalizedAt || read(projectDir, 'orchestration/website-handoff.json', {})?.finalizedAt) throw new Error('EXECUTION_REVIEW_ONLY');
  if (manifest.mappingPlanDigest !== fileDigest(projectDir, 'mapping/mapping-plan.json')) throw new Error('mapping_plan_digest_mismatch');
  const validation = require('./execution-manifest').validateManifest(manifest);
  if (!validation.ok) throw new Error(validation.errors.join(';'));
  return { manifest, setupPlan, plan };
}
function fingerprint(ctx) {
  const files = ['execution/execution-manifest.json', 'mapping/mapping-plan.json', 'setup/setup-plan.json', 'setup/setup-verification.json', 'discovery/census.json', 'mapping/review/mapping-gaps.json', 'mapping/review/census-reconciliation.json', 'mapping/review/mapping-summary.md', 'orchestration/approvals.json'];
  for (const task of ctx.manifest.tasks.filter(task => task.kind === 'import')) for (const source of task.sourceBindings || []) files.push(source.manifestPath, source.extractPath, ...(source.readPlanPath ? [source.readPlanPath] : []));
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
      for (const row of event.updates) { cached.crosswalk.set(row.sourceStableKey, structuredClone(row)); cached.changes.push(row.sourceStableKey); }
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
function keyReady(ctx, index, key, owner) {
  index.work.dependencyKeysChecked++;
  const attempt = index.attempts.get(key), row = index.crosswalk.get(key);
  if ((attempt && attempt.siteId !== ctx.siteId) || (row && row.siteId !== ctx.siteId)) return { ready: false, foreign: true };
  if (!attempt || !row || row.status !== 'imported' || !['imported', 'skipped_already_imported'].includes(attempt.status)) return { ready: false };
  if (owner) {
    const source = owner.snapshot.sourceByKey.get(key);
    const types = source ? [source.ref, source.ref.split('/')[1], source.ref.replace('/', '-'), source.ref.replace('/', '.')] : [];
    if (!source || owner.ref && source.ref !== owner.ref || attempt.writeSpecId !== owner.task.id || row.targetSystem !== 'wix' || row.sourceEntityType !== source.sourceEntity || String(row.sourceId) !== source.sourceId || !types.includes(row.targetEntityType) || !types.includes(attempt.targetEntityType)) return { ready: false, identity: false };
  }
  return { ready: true, row };
}
function readinessSummary(ctx, index, task, snapshot) {
  let summary = index.summaries.get(task.id);
  if (!summary || summary.snapshot !== snapshot) {
    summary = { snapshot, ready: 0, foreign: 0, statuses: new Map(), offset: index.changes.length };
    for (const key of snapshot.keys) { const status = keyReady(ctx, index, key, { task, snapshot }); summary.statuses.set(key, status); summary.ready += Number(status.ready); summary.foreign += Number(Boolean(status.foreign)); }
    index.summaries.set(task.id, summary); return summary;
  }
  for (const key of new Set(index.changes.slice(summary.offset))) if (snapshot.keys.has(key)) {
    const before = summary.statuses.get(key), after = keyReady(ctx, index, key, { task, snapshot });
    summary.ready += Number(after.ready) - Number(before.ready); summary.foreign += Number(Boolean(after.foreign)) - Number(Boolean(before.foreign)); summary.statuses.set(key, after);
  }
  summary.offset = index.changes.length; return summary;
}
async function evaluateDependency({ ctx, ref, producer, index, dispositions }) {
  const unknown = (reason, recovery) => ({ ref, producer, state: 'unknown', reasons: [reason], recovery });
  try {
    if (producer.kind === 'disposition') {
      const disposition = dispositions[ref];
      if (!disposition) return unknown('disposition_not_current', `obtain-disposition-approval:${ref}`);
      return { ref, producer, state: disposition.approved ? 'excluded-approved' : 'excluded-unapproved', reasons: [], recovery: `obtain-disposition-approval:${ref}` };
    }
    if (producer.kind === 'setup-step') {
      const receipt = read(ctx.projectDir, 'setup/setup-verification.json');
      const validation = setup.validateSetupVerification({ verification: receipt, plan: ctx.setupPlan, planDigest: fileDigest(ctx.projectDir, 'setup/setup-plan.json'), siteId: ctx.siteId });
      if (!validation.ok || receipt.dryRun !== ctx.dryRun) return unknown(validation.reasons.join(';') || 'dry_run_mismatch', `run-setup:${producer.stepIds[0]}`);
      return { ref, producer, state: 'setup-passed', reasons: [], receipt };
    }
    const task = ctx.manifest.tasks.find(row => row.id === producer.taskId), snapshot = snapshots(ctx, task);
    if (!index.passes.some(pass => currentPass(ctx, task, snapshot, pass))) return unknown('current_full_pass_missing', `run-import:${task.id}`);
    const summary = readinessSummary(ctx, index, task, snapshot);
    if (summary.foreign) return unknown('site_evidence_unbound_or_foreign', `reconcile-site:${task.id}`);
    return { ref, producer, state: snapshot.rowsWritten === 0 && snapshot.snapshotTotal === 0 ? 'empty' : summary.ready === snapshot.keys.size ? 'complete' : 'partial',
      reasons: [], recovery: `run-import:${task.id} --failed-only`, snapshot };
  } catch (error) { return unknown(evidenceReason(error), `run-import:${producer.taskId || ''}`); }
}
function projectWaiting(ctx, index) {
  if (!index) return read(ctx.projectDir, 'execution/dependency-readiness.json', { tasks: {} }).tasks?.[ctx.taskId]?.waiting || [];
  index.work.waitingKeysProjected += index.recovery.byTask.get(ctx.taskId)?.size || 0;
  return recovery.waitingForTask(index.recovery, ctx.taskId);
}
async function evaluateTask({ taskBinding }) {
  const ctx = capability.requireKind(taskBinding, 'import-task');
  const current = validateImportInputs(ctx.projectDir);
  if (!equal(current.manifest, ctx.manifest) || !equal(current.setupPlan, ctx.setupPlan)) throw new Error('DEPENDENCY_INPUT_CHANGED');
  let adapter, index, inputError;
  try {
    adapter = await loadDependencyDispositions(ctx.projectDir);
    const binding = bindDependencyProducers({ manifest: ctx.manifest, setupPlan: ctx.setupPlan, dispositions: adapter.dispositions });
    if (!binding.ok) throw new Error(binding.errors.join(';'));
    index = await evidenceIndex(ctx);
  } catch (error) { inputError = error; }
  const dependencies = [];
  for (const edge of ctx.task.dependencyEdges) dependencies.push(inputError ? { ...edge, state: 'unknown', reasons: [evidenceReason(inputError)], recovery: edge.producer.kind === 'setup-step' ? `run-setup:${edge.producer.stepIds[0]}` : edge.producer.kind === 'disposition' ? `obtain-disposition-approval:${edge.ref}` : `run-import:${edge.producer.taskId}` } : { ...await evaluateDependency({ ctx, ...edge, index, dispositions: adapter.dispositions }), mode: edge.mode });
  if (inputError && !dependencies.length) throw inputError;
  const blocked = dependencies.filter(dep => !['complete', 'empty', 'setup-passed', 'excluded-approved'].includes(dep.state) && !(dep.state === 'partial' && dep.mode === 'per-record'));
  const waiting = projectWaiting(ctx, index);
  const evaluation = Object.freeze({ taskId: ctx.taskId, blocked: blocked.map(({ receipt, snapshot, ...row }) => row), ok: blocked.length === 0, work: Object.freeze({ ...index?.work }) });
  const generation = (evaluationGenerations.get(taskBinding) || 0) + 1; evaluationGenerations.set(taskBinding, generation);
  evaluations.set(evaluation, { ctx, dependencies, index, adapter, stamp: fingerprint(ctx), taskBinding, generation });
  const diagnostic = { waiting, schemaVersion: 1, siteId: ctx.siteId, taskId: ctx.taskId, blocked: evaluation.blocked,
    affectedCount: ctx.task.population ?? null, operatorRole: 'Requires Import Operator',
    action: `Inspect execution/dependency-readiness.json for task ${ctx.taskId}; resolve its prerequisite and resume only eligible deferred records. Do not resend existing orders.` };
  const diagnosticFile = inside(ctx.projectDir, 'execution/dependency-readiness.json');
  const previous = read(ctx.projectDir, 'execution/dependency-readiness.json', { tasks: {} });
  await require('./orchestration-state').writeJsonAtomic(diagnosticFile, { schemaVersion: 1, tasks: { ...previous.tasks, [ctx.taskId]: diagnostic } });
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
async function persistReferenceGap(ctx, sourceStableKey, code) {
  const file = 'mapping/review/mapping-gaps.json', existing = read(ctx.projectDir, file, { gaps: [] });
  const rows = Array.isArray(existing) ? existing : existing.gaps;
  if (!Array.isArray(rows)) throw new Error('mapping_gaps_malformed');
  const row = rows.find(row => row.code === code && row.taskId === ctx.taskId);
  if (row) row.affectedSourceKeys = [...new Set([...(row.affectedSourceKeys || []), sourceStableKey])].sort();
  else rows.push({ code, reasonCode: code, taskId: ctx.taskId, severity: 'blocker', affectedSourceKeys: [sourceStableKey],
    action: 'Requires Import Operator. Review this source-key scope and the recorded reference-fidelity or shipping-cardinality blocker. Obtain the existing required owner decision or verified preserving mapping, regenerate and approve current mapping evidence, then resume only affected deferred records. Do not resend existing orders.' });
  await require('./orchestration-state').writeJsonAtomic(inside(ctx.projectDir, file), existing);
}
function valueAt(payload, concrete) { return concrete.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((value, key) => value?.[key], payload); }
function omitAt(payload, concrete) { const keys = concrete.replace(/\[(\d+)\]/g, '.$1').split('.'); const key = keys.pop(); const parent = keys.reduce((value, part) => value?.[part], payload); if (parent) delete parent[key]; }
async function gateBatch({ evaluation, records }) {
  const state = evaluations.get(evaluation);
  if (!state || state.stamp !== fingerprint(state.ctx) || evaluationGenerations.get(state.taskBinding) !== state.generation) throw new Error('DEPENDENCY_EVALUATION_STALE');
  if (!evaluation.ok) throw Object.assign(new Error('DEPENDENCY_NOT_READY'), { diagnostic: evaluation });
  const { ctx, dependencies, index, adapter } = state, send = [], defer = [], allowed = new Set();
  for (const record of records) {
    if (!record.sourceStableKey) throw new Error('DEPENDENCY_SOURCE_KEY_REQUIRED');
    const references = [], omissions = []; let blocker;
    const resolve = (ref, key, concrete, mode) => {
      const fromSetup = mode === 'setup';
      const dep = dependencies.find(dep => dep.ref === ref);
      if (!dep || (fromSetup ? dep.mode !== 'task-complete' || dep.producer.kind !== 'setup-step' : mode === 'task' ? dep.mode !== 'task-complete' || dep.producer.kind !== 'import-task' || !['complete', 'empty'].includes(dep.state) : dep.mode !== 'per-record' || dep.producer.kind === 'setup-step')) throw new Error('REFERENCE_UNDECLARED');
      if (!fromSetup && mode !== 'task' && !ctx.task.entityRefs.some(entityRef => (domain(entityRef).dependencyReferenceFields?.[ref] || []).some(template => pathMatches(template, concrete)))) throw new Error('REFERENCE_UNDECLARED');
      if (fromSetup) {
        const entries = dep.receipt.requirements.filter(req => dep.producer.stepIds.includes(req.id)).flatMap(req => req.referenceBindings || []);
        const match = entries.find(binding => binding.ref === ref && binding.sourceStableKey === key && Object.keys(binding.values).some(template => pathMatches(template, concrete)));
        const template = match && Object.keys(match.values).find(template => pathMatches(template, concrete));
        if (!match || !template) { blocker = { ref, sourceStableKey: key, dependencyState: dep.state }; return undefined; }
        const value = match.values[template]; references.push({ ref, sourceStableKey: key, path: concrete, targetId: value, producerKind: 'setup-step' }); return value;
      }
      if (dep.state === 'empty') { blocker = { ref, sourceStableKey: key, dependencyState: 'unknown' }; return undefined; }
      const producerTask = ctx.manifest.tasks.find(task => task.id === dep.producer.taskId);
      const snapshot = producerTask && snapshots(ctx, producerTask);
      const source = snapshot?.sourceByKey.get(key);
      const target = source?.ref === ref ? keyReady(ctx, index, key, { task: producerTask, snapshot, ref }) : { ready: false };
      if (target.ready) {
        if (producerTask?.verificationLevel === 'verified' && ['crm/contact', 'stores/product'].includes(ref) && !require('./write-verification').validReceipt(target.row.verification, { siteId: ctx.siteId, sourceKey: key, targetId: target.row.targetId })) {
          blocker = { ref, sourceStableKey: key, dependencyState: 'imported-unverified' }; return undefined;
        }
        references.push({ ref, sourceStableKey: key, path: concrete, targetId: target.row.targetId }); return target.row.targetId;
      }
      const sourceTask = ctx.manifest.tasks.find(task => task.id === dep.producer.taskId);
      const sourceLinks = [...(sourceTask?.sourceBindings || []), ...(ctx.task.dependencySourceBindings || [])];
      const matches = sourceLinks.filter(source => source.ref === ref && typeof source.keyPrefix === 'string' && key.startsWith(source.keyPrefix));
      const censusId = (source?.ref === ref && snapshot.censusByKey.get(key)) || (matches.length === 1 ? matches[0].censusId || `entity:${matches[0].sourceEntity}` : null);
      const rule = adapter.rules.find(rule => rule.dependencyRef === ref && ctx.task.entityRefs.includes(rule.dependentRef) && rule.censusId === censusId && adapter.rows.get(censusId)?.state === 'excluded' && adapter.approved.has(censusId) && pathMatches(rule.path, concrete));
      if (rule?.action === 'omit') { omissions.push(concrete); references.push({ ref, sourceStableKey: key, path: concrete, action: 'omit' }); return undefined; }
      blocker = { reason: rule?.action === 'defer' ? 'dependency-not-ready' : (dep.state.startsWith('excluded') || adapter.rows.get(censusId)?.state === 'excluded') ? 'dependency-disposition-rule-missing' : 'dependency-not-ready', ref, sourceStableKey: key, dependencyState: dep.state };
      return undefined;
    };
    try {
      const payload = record.transform ? await record.transform({ resolveReference: (ref, key, concrete) => resolve(ref, key, concrete, 'record'), resolveTaskReference: (ref, key, concrete) => resolve(ref, key, concrete, 'task'), resolveSetupReference: (ref, key, concrete) => resolve(ref, key, concrete, 'setup') }) : record.payload;
      if (payload?.deferred && typeof payload.reason === 'string') { blocker = { reason: payload.reason, dependencyState: 'unknown' }; await persistReferenceGap(ctx, record.sourceStableKey, payload.reason); }
      for (const concrete of omissions) if (valueAt(payload, concrete) !== undefined) throw new Error('dependency-excluded-reference-present');
      for (const targetRef of ctx.task.entityRefs) for (const [ref, templates] of Object.entries(domain(targetRef).dependencyReferenceFields || {})) for (const template of templates) for (const concrete of expandPaths(payload, template)) if (valueAt(payload, concrete) !== undefined && !references.some(reference => reference.ref === ref && reference.path === concrete)) throw new Error('dependency-reference-unresolved');
      for (const ref of references.filter(ref => !ref.action)) if (valueAt(payload, ref.path) !== ref.targetId) throw new Error('dependency-reference-payload-mismatch');
      if (blocker) defer.push({ ...record, deferral: { reason: 'dependency-not-ready', ...blocker } });
      else { allowed.add(record.sourceStableKey); send.push({ ...record, payload, references }); }
    } catch (error) { defer.push({ ...record, deferral: { reason: ['REFERENCE_UNDECLARED', 'dependency-excluded-reference-present', 'dependency-reference-payload-mismatch', 'dependency-reference-unresolved'].includes(error.message) ? error.message : 'dependency-transform-failed' } }); }
  }
  for (const record of defer) await local.appendAttempt(ctx.projectDir, { schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: record.sourceStableKey, writeSpecId: ctx.taskId, operation: 'create', targetEntityType: ctx.task.entityRefs[0], status: 'deferred', runId: ctx.runId, phase: 'import', ts: new Date().toISOString(), deferral: record.deferral });
  const projection = read(ctx.projectDir, 'execution/dependency-readiness.json', { tasks: {} });
  if (projection.tasks?.[ctx.taskId]) { const currentIndex = await evidenceIndex(ctx); projection.tasks[ctx.taskId].waiting = projectWaiting(ctx, currentIndex); await require('./orchestration-state').writeJsonAtomic(inside(ctx.projectDir, 'execution/dependency-readiness.json'), projection); }
  const payloads = new Map(send.map(record => [record.sourceStableKey, record.references.map(reference => Object.freeze({ ...reference }))]));
  const grant = Object.freeze({ taskId: ctx.taskId, runId: ctx.runId, siteId: ctx.siteId });
  grants.set(grant, { ctx, index, allowed, payloads, stamp: state.stamp, taskBinding: state.taskBinding, generation: state.generation });
  return { send, defer, grant };
}
function verifyGrant(grant, clientContext, sourceStableKey, request, { auxiliary = false, partial = false } = {}) {
  const stored = grants.get(grant);
  if (stored && request && !auxiliary) {
    const body = request.body?.order || request.body?.product || request.body?.contact || request.body;
    for (const reference of stored.payloads.get(sourceStableKey) || []) { if (partial && !Object.hasOwn(body || {}, reference.path.split(/[.\[]/)[0])) continue; const value = valueAt(body, reference.path); if (reference.action === 'omit' ? value !== undefined : value !== reference.targetId) return false; }
  }
  return Boolean(stored && stored.ctx.taskId === clientContext.taskId && stored.ctx.runId === clientContext.runId && stored.ctx.siteId === clientContext.siteId && stored.allowed.has(sourceStableKey) && evaluationGenerations.get(stored.taskBinding) === stored.generation && stored.stamp === fingerprint(stored.ctx));
}
function verifyReferenceTargets(grant, ctx, key, ref, ids) {
  const stored = grants.get(grant);
  if (!verifyGrant(grant, ctx, key) || !Array.isArray(ids)) return false;
  const expected = new Set((stored.payloads.get(key) || []).filter(row => row.ref === ref && !row.action).map(row => row.targetId));
  return ids.length === expected.size && new Set(ids).size === ids.length && ids.every(id => expected.has(id));
}
function currentRecordTargetId(grant, clientContext, sourceStableKey) {
  const stored = grants.get(grant);
  if (!verifyGrant(grant, clientContext, sourceStableKey)) return null;
  const current = keyReady(stored.ctx, stored.index, sourceStableKey, { task: stored.ctx.task, snapshot: snapshots(stored.ctx, stored.ctx.task) });
  return current.ready ? current.row.targetId : null;
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
module.exports = { startImportRun: capability.startImportRun, bindTask: capability.bindTask, bindDependencyProducers,
  validateImportInputs, validateAssociations, loadDependencyDispositions, evaluateTask, gateBatch,
  verifyGrant, verifyReferenceTargets, currentRecordTargetId, finishTaskPass, reconcileSiteEvidence, validatePass, PASS_FILE, pathMatches, valueAt, expandPaths };
