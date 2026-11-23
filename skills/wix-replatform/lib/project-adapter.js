'use strict';

// The project adapter the plugin handoff calls (src/import/plugin-handoff.js ->
// src/project/plugin-runtime.js). The codegen scaffold writes
// src/project/plugin-runtime.js as a fixed file that calls createProjectAdapter; this file is
// vendored into src/lib.
//
// Everything comes from the run's own files, read when the import runs:
//   execution/execution-manifest.json  tasks, their order (dependsOn) and dependency edges
//   mapping/mapping-plan.json          scope, digest, source system
//   src/import/plugin-handoff.js       the entities the handoff dispatches
//   src/import/handlers/<taskId>.js    the task code (scaffolded, or codegen's for other entities)
//
// The override slot: src/project/overrides.js may export any of describeImport,
// preflight, importEntity, finalizeImport, migrationReviewProbe, selectRecords. Each is called with
// the step's own arguments plus the toolkit's version last: override(...args, toolkitDefault).
// `why: { <step>: '<reason>' }` in the same file says why. Every override is recorded as one toolkit
// gap (lib/toolkit-gaps.js -> execution/toolkit-gaps.json -> the completion report's toolkitGaps),
// never as a cutover or operator task: the run goes on, and the gap is fixed here. An overrides
// file that exports anything else (a misspelled step, a non-function) throws, so an override is
// never silently dropped.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OVERRIDABLE = ['describeImport', 'preflight', 'importEntity', 'finalizeImport', 'migrationReviewProbe', 'selectRecords'];
const ARCHIVE_ENTITY = 'source-archive';
const ZERO = { attempted: 0, imported: 0, alreadyPresent: 0, deferred: 0, failed: 0, unresolved: 0 };

const OVERRIDES_FILE = 'src/project/overrides.js';

function checkOverrides(overrides) {
  if (overrides === null || typeof overrides !== 'object') throw new Error(`${OVERRIDES_FILE} must export an object of step overrides`);
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'why') {
      if (value === null || typeof value !== 'object') throw new Error(`${OVERRIDES_FILE}: why must be an object of { <step>: '<reason>' }`);
      continue;
    }
    if (!OVERRIDABLE.includes(key)) throw new Error(`${OVERRIDES_FILE}: unknown step ${key}; the steps are ${OVERRIDABLE.join(', ')}`);
    if (typeof value !== 'function') throw new Error(`${OVERRIDES_FILE}: ${key} must be a function (...args, toolkitDefault)`);
  }
}

function createProjectAdapter({ projectDir, overrides = {} }) {
  checkOverrides(overrides);
  const why = overrides.why || {};
  require('./toolkit-gaps.js').recordToolkitGaps(projectDir, 'project-adapter', OVERRIDABLE.filter((name) => typeof overrides[name] === 'function').map((step) => ({ step, file: OVERRIDES_FILE, why: why[step] })));
  const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(projectDir, relative), 'utf8'));
  const plan = () => readJson('mapping/mapping-plan.json');
  const manifest = () => readJson('execution/execution-manifest.json');
  const importTasks = () => require('./import-task-orchestrator.js').importTasks(manifest());
  const bindingsOf = (task) => (task.sourceBindings || []).filter((b) => b && b.role !== 'source-archive' && b.sourceEntity !== ARCHIVE_ENTITY);
  const isArchiveTask = (task) => (task.sourceBindings || []).some((b) => b && (b.sourceEntity === ARCHIVE_ENTITY || b.role === 'source-archive'));
  const handoffEntities = () => {
    try { return require(path.join(projectDir, 'src/import/plugin-handoff.js')).config.entities; } catch { return []; }
  };
  const envOf = () => require('./config-env.js').readEnvFile(path.join(projectDir, 'config', 'wix.env'));

  // The task that writes a source entity: the task that binds it, else (a CMS row with no task of
  // its own) the source-archive task.
  function taskFor(sourceEntity, current = plan()) {
    const tasks = importTasks();
    const own = tasks.find((task) => bindingsOf(task).some((b) => b.sourceEntity === sourceEntity));
    if (own) return own;
    const entity = (current.entities || []).find((e) => e.sourceEntity === sourceEntity);
    return entity && entity.targetRef === 'cms/data-item' ? tasks.find(isArchiveTask) || null : null;
  }

  // Every planned handoff entity once, in task order (dependsOn waves); the source archive last,
  // because it reads the other entities' target ids.
  function entityOrder() {
    const known = new Set(handoffEntities().map((e) => e.sourceEntityRef));
    const waves = require('./import-task-orchestrator.js').planImportTaskWaves({ tasks: importTasks() });
    const tasks = waves.flat();
    const ordered = [...tasks.filter((t) => !isArchiveTask(t)), ...tasks.filter(isArchiveTask)];
    const order = [];
    const add = (ref) => { if (known.has(ref) && !order.includes(ref)) order.push(ref); };
    const current = plan();
    for (const task of ordered) {
      for (const b of bindingsOf(task)) add(b.sourceEntity);
      if (isArchiveTask(task)) for (const e of current.entities || []) if (taskFor(e.sourceEntity, current) === task) add(e.sourceEntity);
    }
    // A planned entity no task writes still has a place: importEntity holds it with a reason.
    for (const e of handoffEntities()) if (e.importPlanned) add(e.sourceEntityRef);
    return order;
  }

  function describeImport() {
    const recovery = require('./import-recovery.js');
    const current = plan();
    const descriptor = {
      contractVersion: recovery.GENERATED_IMPORTER_CONTRACT_VERSION,
      runIdSource: 'process-start',
      selectionModes: [...recovery.REQUIRED_SELECTION_MODES],
      ledger: { ...recovery.REQUIRED_LEDGER_PATHS, appendOnly: true },
      migrationReview: require('./migration-review.js').generatedImporterReviewContract(),
      entityOrder: entityOrder(),
      dependencyReadiness: {
        tasks: importTasks().map((task) => ({ taskId: task.id, edges: (task.dependencyEdges || []).map(({ ref, mode }) => ({ ref, mode })) })),
      },
    };
    if (current.fieldContractVersion === 1) {
      Object.assign(descriptor, {
        // The plan's canonical digest; the handoff's contract check and scope guard compare it.
        mappingPlanDigest: require('./mapping-field-contract.js').digest(current),
        resolvedEntityRefs: (current.executionScope && current.executionScope.resolvedEntityRefs) || [],
        mappingScopeAssertion: 'assertExecutionScope',
      });
    }
    return descriptor;
  }

  // ---- migration review ------------------------------------------------------------------------
  const reviewScopes = (current) => require('./migration-review-mapping.js').mappingScopes(current);
  async function openReview({ dir, identity, executionId, executionKind, scopes, nonce }) {
    const review = require('./migration-review.js');
    const init = await review.initialize(dir, { contractVersion: review.CONTRACT_VERSION, ...identity });
    const migrationId = init.identity.migrationId;
    await review.registerExecution(dir, {
      contractVersion: review.CONTRACT_VERSION, migrationId, requestId: `register:${executionId}`,
      expectedStateVersion: init.state.stateVersion, executionId, executionKind, producerId: 'generated-importer', assessedScope: scopes,
    });
    const queue = review.createEvidenceCaptureQueue(dir);
    const captureIds = [];
    const capture = async (category, phase, evidence, key) => {
      const id = `${key || category}:${phase}:${crypto.createHash('sha256').update(JSON.stringify([executionId, category, phase, evidence])).digest('hex').slice(0, 16)}`;
      await queue({ contractVersion: review.CONTRACT_VERSION, migrationId, executionId, requestId: id, captureId: id, category, scope: scopes, phase, evidence: { ...evidence, ...(nonce ? { probeNonce: nonce } : {}) } });
      captureIds.push(id);
    };
    const writeRecovery = review.createWriteRecovery({ captureQueue: queue, migrationId, executionId, scope: scopes, probeNonce: nonce || null });
    return { review, migrationId, executionId, capture, captureIds, recovery: writeRecovery, identity, scopes };
  }
  async function publishReview(handle, dir, { results = [], coverage = 'complete', unknownAreas = [] } = {}) {
    const { review, migrationId, executionId } = handle;
    const version = (await review.initialize(dir, { contractVersion: review.CONTRACT_VERSION, ...handle.identity })).state.stateVersion;
    return review.publishEvidence(dir, {
      contractVersion: review.CONTRACT_VERSION, migrationId, requestId: `publish:${executionId}:${handle.captureIds.length}`,
      expectedStateVersion: version, producerId: 'generated-importer', executionId, assessedScope: handle.scopes,
      coverage: { status: coverage, unknownAreas }, captureIds: [...handle.captureIds], results,
    });
  }

  async function migrationReviewProbe({ probeProjectDir }) {
    const nonce = process.env.MIGRATION_REVIEW_PROBE_NONCE;
    if (!nonce || path.resolve(probeProjectDir) !== path.resolve(process.env.MIGRATION_REVIEW_PROBE_PROJECT || '')) throw new Error('the review probe runs only through the isolated verifier');
    const scopes = reviewScopes(plan());
    const identity = { migrationId: `probe_${nonce}`, source: { identity: `probe_${nonce}` }, destination: { siteId: 'probe-site' } };
    const executionId = `probe-exec-${nonce}`;
    const handle = await openReview({ dir: probeProjectDir, identity, executionId, executionKind: 'probe', scopes, nonce });
    await handle.capture('source_scope', 'before-write', { acceptedScopes: scopes, kind: 'probe' });
    await handle.capture('mapping_fidelity', 'before-write', { kind: 'probe' });
    await handle.capture('setup_plugin', 'before-write', { kind: 'probe' });
    await handle.capture('explanations_checks', 'before-write', { kind: 'probe' });
    await handle.capture('execution_recovery', 'write-outcome', { kind: 'probe-outcome' }, 'outcome');
    await handle.recovery.probeFailure();
    const failure = (await handle.review.readExecutionEvidence(probeProjectDir, executionId)).captures.filter((row) => row.evidence.kind === 'write-failure').map((row) => row.captureId);
    handle.captureIds.push(...failure.filter((id) => !handle.captureIds.includes(id)));
    await publishReview(handle, probeProjectDir, { results: [{ resultKey: 'probe-result', scopeKey: scopes[0], probeNonce: nonce, title: 'Isolated probe', summary: 'Synthetic capture and publication proof.' }] });
    process.stdout.write(`${JSON.stringify({ executionId })}\n`);
  }

  // ---- the run: started once, before the first ready write ----------------------------------------
  let run = null;
  async function startRun({ runId, dryRun }) {
    if (run && run.runId === runId) return run;
    const env = await envOf();
    if (!dryRun && !env.WIX_SITE_ID) throw new Error('WIX_SITE_ID is required in config/wix.env');
    const siteId = env.WIX_SITE_ID || 'dry-run-site';
    const tokenSource = dryRun ? null : require('./wix-auth.js').createWixTokenSource({ projectDir, siteId });
    const runCapability = require('./dependency-readiness.js').startImportRun({ projectDir, siteId, runId, dryRun });
    const flag = { stopped: false };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { flag.stopped = true; });
    run = { runId, dryRun, siteId, tokenSource, runCapability, review: null, outcomes: [], tasks: new Map(), orderHistory: [], stageResiduals: [], stopRequested: () => flag.stopped };
    return run;
  }

  async function preflight({ runId }) {
    const dryRun = await require('./config-env.js').resolveDryRun(projectDir, { argv: process.argv.slice(2) });
    const approvals = readJson('orchestration/approvals.json');
    if (!['approved', 'provisional'].includes(approvals.mapping && approvals.mapping.status)) throw new Error('mapping approval is required before import');
    if (!dryRun) {
      // The site stays muted: a run never writes to a site whose notifications are not muted.
      const env = await envOf();
      const writers = require('../resources/rp-target-wix/lib/wix-writers.js');
      const tokenSource = require('./wix-auth.js').createWixTokenSource({ projectDir, siteId: env.WIX_SITE_ID });
      const state = await writers.getSiteMuteState(writers.createWixClient({ siteId: env.WIX_SITE_ID, tokenSource }));
      if (!state || state.muted !== true) throw Object.assign(new Error('the destination site is not muted; run the setup mute step before importing'), { code: 'SITE_NOT_MUTED' });
    }
    return { runId, dryRun };
  }

  // Record selection: the toolkit's recovery selectors over recorded outcomes and the attempt
  // journal, as the runner's { mode, filter } over its `<keyPrefix><id>` keys.
  function selectRecords(selection, sourceSystem) {
    return async (ctx, records, binding) => {
      const recovery = require('./import-recovery.js');
      const modes = ['missingOnly', 'failedOnly', 'deferredOnly', 'unresolvedOnly'].filter((key) => selection[key]);
      if (!modes.length && !selection.rerun) return { mode: 'full', filter: () => true };
      const keyField = binding.keyField || 'id';
      const idOf = (record) => String(record[keyField]);
      const options = { sourceSystem, entity: binding.sourceEntity, getSourceId: idOf, filters: selection };
      const picked = new Set();
      const add = (entry) => {
        const id = entry && entry.record ? idOf(entry.record) : entry && entry.sourceStableKey ? String(entry.sourceStableKey).split(':').slice(2).join(':') : null;
        if (id !== null) picked.add(id);
      };
      if (selection.rerun) {
        const result = await recovery.selectRerunRecordsFromState(projectDir, records, options);
        for (const bucket of ['create', 'update', 'unknown']) (result[bucket] || []).forEach(add);
      } else {
        (await recovery.selectImportRecordsFromState(projectDir, records, options)).selected.forEach(add);
      }
      return { mode: selection.rerun ? 'rerun' : modes[0], filter: (key) => picked.has(String(key).slice((binding.keyPrefix || '').length)) };
    };
  }

  async function runTask(state, task, sourceEntity, selection, current) {
    const handlerPath = path.join(projectDir, 'src/import/handlers', `${task.id}.js`);
    if (!fs.existsSync(handlerPath)) throw Object.assign(new Error(`task ${task.id} has no handler (src/import/handlers/${task.id}.js)`), { code: 'plugin-entity-failed' });
    const readiness = require('./dependency-readiness.js');
    const taskBinding = readiness.bindTask({ runCapability: state.runCapability, taskId: task.id });
    const wix = require('../resources/rp-target-wix/lib/wix-writers.js').createWixClient({ capability: taskBinding, siteId: state.siteId, ...(state.tokenSource ? { tokenSource: state.tokenSource } : {}) });
    const entity = (current.entities || []).find((row) => row.sourceEntity === sourceEntity);
    const sourceSystem = (entity && entity.sourceSystem) || current.sourceSystem || current.sourcePlatform || 'wordpress';
    const result = await require(handlerPath).run({
      projectDir, runId: state.runId, task, taskId: task.id, taskBinding, wix, mappingPlan: current, sourceEntity,
      stopRequested: state.stopRequested, selectRecords: callable('selectRecords', [selection || {}, sourceSystem]),
    });
    state.orderHistory.push(...(Array.isArray(result && result.orderHistory) ? result.orderHistory : []));
    state.stageResiduals.push(...(Array.isArray(result && result.stageResiduals) ? result.stageResiduals : []));
    if (state.review) await state.review.capture('execution_recovery', 'write-outcome', { kind: 'task-outcome', taskId: task.id, sourceEntity, counts: (result && result.counts) || null, status: (result && result.status) || null }, `outcome:${task.id}:${sourceEntity}`);
    return result || { taskId: task.id, status: 'complete', counts: ZERO };
  }

  // One planned entity. A task binding several entities (forms, CMS rows) runs once per run; the
  // other entities report that task's result.
  async function importEntity({ entity, selection, runId, dryRun }) {
    const current = plan();
    const sourceEntity = entity.sourceEntity || entity.sourceEntityRef;
    const task = taskFor(sourceEntity, current);
    if (!task) throw Object.assign(new Error(`no import task serves ${sourceEntity}`), { code: 'plugin-entity-failed' });
    const state = await startRun({ runId, dryRun });
    if (!state.review && !dryRun) {
      const scopes = reviewScopes(current);
      state.review = await openReview({ dir: projectDir, identity: {}, executionId: `import:${runId}`, executionKind: 'import', scopes });
      const evidence = { planDigest: require('./mapping-field-contract.js').digest(current), selection: { ...selection }, tasks: manifest().tasks.length };
      await state.review.capture('source_scope', 'before-write', { ...evidence, acceptedScopes: scopes });
      await state.review.capture('mapping_fidelity', 'before-write', evidence);
      await state.review.capture('setup_plugin', 'before-write', evidence);
      await state.review.capture('explanations_checks', 'before-write', evidence);
    }
    const first = !state.tasks.has(task.id);
    if (first) state.tasks.set(task.id, runTask(state, task, sourceEntity, selection, current));
    const result = await state.tasks.get(task.id);
    state.outcomes.push({ taskId: task.id, sourceEntity, status: (result && result.status) || 'unknown' });
    return first ? result : { taskId: task.id, sourceEntity, status: result.status, counts: ZERO, hostedBy: task.id };
  }

  async function finalizeImport({ results, interruption, runId, deferredExtraction }) {
    const completion = require('./import-completion.js');
    const report = require('./completion-report.js');
    const dryRun = await require('./config-env.js').resolveDryRun(projectDir, { argv: process.argv.slice(2) });
    const env = await envOf();
    const current = plan();
    const rows = await completion.buildImportCompletenessRows({ projectDir, manifest: manifest(), runId, siteId: env.WIX_SITE_ID, dryRun });
    const journal = await completion.readNdjson(projectDir, 'state/attempts/write-attempts.ndjson');
    const entityCompleteness = report.attachAttemptReasons(rows, journal, { runIds: [runId] });
    // The verified writers persist their receipts (state/write-verification); the report reads the
    // contact and product rows' receipts from there, so a verified run is not "not recorded".
    const verificationState = !dryRun && env.WIX_SITE_ID ? await require('./write-verification-state.js').load(projectDir, env.WIX_SITE_ID).catch(() => null) : null;
    // Partial state is fine (a stop, a task that never ran): collect what exists.
    const state = run && run.runId === runId ? run : null;
    const stageResiduals = [...report.collectOrderStageResiduals((state && state.orderHistory) || [], { entity: 'order' }), ...((state && state.stageResiduals) || [])];
    const built = report.createCompletionReport({
      runId, siteId: env.WIX_SITE_ID, entityCompleteness, stageResiduals, ...(verificationState ? { verificationState } : {}),
      ...(interruption ? { interruption } : {}),
      operatorActions: (deferredExtraction && deferredExtraction.operatorActions) || [], statuses: (deferredExtraction && deferredExtraction.statuses) || [],
    });
    await report.writeCompletionReport(projectDir, built, { runId, mappingPlanDigest: require('./mapping-field-contract.js').digest(current), dryRun });
    if (state && state.review) {
      const failed = (results || []).some((row) => row && row.status === 'failed');
      await publishReview(state.review, projectDir, { coverage: failed || interruption ? 'incomplete' : 'complete', unknownAreas: failed ? ['import:failed-entities'] : [] });
    }
    return built;
  }

  const defaults = { describeImport, preflight, importEntity, finalizeImport, migrationReviewProbe, selectRecords };
  function callable(name, args) {
    const own = typeof overrides[name] === 'function' ? overrides[name] : null;
    return own ? own(...args, defaults[name]) : defaults[name](...args);
  }
  const adapter = Object.fromEntries(OVERRIDABLE.filter((n) => n !== 'selectRecords').map((name) => [name, (...args) => callable(name, args)]));
  return { ...adapter, overridden: OVERRIDABLE.filter((name) => typeof overrides[name] === 'function') };
}

module.exports = { createProjectAdapter, OVERRIDABLE };
