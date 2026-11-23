'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateArtifacts, explicitRunBlocker } = require('./orchestration-state.js');
const { getCompletionDeliveryMode, getDecisionValue, getEffectiveDeliveryMode, isExplicitUserOneClick, isKnownSourceMode, requiresWebsiteContinuation } = require('./orchestration-decisions.js');
const { destinationGate, publicationRecheckGate } = require('./destination-route.js');
const { validateWebsiteHandoff } = require('./website-handoff.js');
const { statEnvKeys, readEnvFile } = require('./config-env.js');
const { hashArtifact } = require('./artifact-freshness.js');
const { validatePlanShape, validateSetupRequirementsShape, validateSetupVerification } = require('./setup-verification.js');
const { NOTIFICATION_MUTE_QUESTION, readNotificationMute, setupPlanMuteMismatch } = require('./notification-mute.js');
const { validateManifest } = require('./execution-manifest.js');
const { QUICK_IMPORT_STARTED_MARKER, validateQuickExecutionManifest } = require('../resources/rp-quick-runtime/lib/import-progress.js');
const { checkCmsFallbackFreshness } = require('./plugin-cms-fallback.js');
const {
  classifyFinalizedRun,
  loadMigrationCompletionInputs,
  validateFrontendCompletion,
  validateMigrationCompletion,
} = require('./migration-completion.js');
const siteRegional = require('./site-regional.js');
const { readReport: readMigrationReview, readLatestHandoff } = require('./migration-review.js');
const { pendingUserActionGate } = require('./user-actions.js');
const { localPreflightChecks } = require('./orchestration-preflight.js');
const { SESSION_RECEIPT_FILE } = require('./source-access.js');
const { validatePlanSafety } = require('./mapping-field-contract.js');

const { readReconciliation, censusReconciliationFreshness, mappingApprovalBound, reconcileSourceCoverageForMapping } = require('./census-reconciliation.js');
const { readCoverageContract, reconcileProject, SourceCoverageError } = require('./source-coverage.js');

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// A report written before a later accepted mapping decision is not terminal when it records
// rows the importer never attempted. Expected deferrals remain completion evidence; only the
// report's dedicated unexpected-skip counter reopens the import. The stale-mapping gate below
// then decides whether codegen/setup must refresh first or the journal-backed import can resume.
function unexpectedSkipsNeedResume(report, mappingApproval) {
  if (!Array.isArray(report?.entityCompleteness)
    || !report.entityCompleteness.some((row) => Number(row?.unexpectedSkipped) > 0)) return false;
  const reportAt = Date.parse(report.lastWriteAt);
  const approvalAt = Date.parse(mappingApproval?.decidedAt);
  return Number.isFinite(reportAt) && Number.isFinite(approvalAt) && approvalAt > reportAt;
}

// Rules for the two LLM-assisted outputs: parseable JSON whose top level is a
// non-array object. Nothing else is read (no versioned contract exists; mapping row shape is
// owned by the tolerant `readEntityMappings` consumer).
function validateSourceSchemaShape(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ok: true, errors: [] }
    : { ok: false, errors: ['source-schema.json must be a JSON object'] };
}

function validateMappingPlanShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['mapping/mapping-plan.json must be a JSON object'] };
  const safetyErrors = validatePlanSafety(value);
  return safetyErrors.length ? { ok: false, errors: safetyErrors } : { ok: true, errors: [] };
}

function setupPlanRule(value, projectDir) {
  const result = validatePlanShape(value, projectDir);
  return { ok: result.ok, errors: result.reasons };
}

// Reads each gated output at most once per route. `present: false` only for a missing file;
// anything that exists but cannot be parsed is present with `parseError`.
function createArtifactReader(projectDir) {
  const cache = new Map();
  return async function readArtifact(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    let entry;
    try {
      const raw = await fs.readFile(path.join(projectDir, relativePath), 'utf8');
      try {
        entry = { present: true, value: JSON.parse(raw) };
      } catch (error) {
        entry = { present: true, value: null, parseError: `invalid JSON: ${error.message}` };
      }
    } catch (error) {
      entry = error && error.code === 'ENOENT'
        ? { present: false, value: null }
        : { present: true, value: null, parseError: `unreadable: ${(error && error.code) || error}` };
    }
    cache.set(relativePath, entry);
    return entry;
  };
}

// Missing → `{ present: false }` (caller keeps its existing route). Present but
// failing its rule → `{ present: true, errors }`. Validation is skipped once backend
// accounting exists: upstream outputs are history then, and keep existence-only behavior.
async function checkGatedOutput(readArtifact, relativePath, rule, { validate }) {
  const entry = await readArtifact(relativePath);
  if (!entry.present) return { present: false, errors: null };
  if (!validate) return { present: true, errors: null };
  if (entry.parseError) return { present: true, errors: [entry.parseError] };
  const result = rule(entry.value);
  return { present: true, errors: result.ok ? null : result.errors };
}

// An agent's output that fails its schema goes back to the agent that wrote it, with the errors,
// like a missing output. It gets OUTPUT_REPAIR_PASSES rewrites (each new invalid version is a pass;
// a turn that rewrites nothing is the controller's no-progress stop). Still invalid after that, the
// run stops: every later step reads this file, so nothing after it can run. Review-only routes and
// a status display (observeOnly) count nothing.
const OUTPUT_REPAIR_PASSES = 2;
const OUTPUT_REPAIR_FILE = 'state/output-repair-passes.json';
const WRITER_STATE = new Map([
  ['resources/rp-discovery/', 'discovery_running'],
  ['resources/rp-mapper/', 'mapping_running'],
  ['resources/rp-setup-discovery/', 'setup_discovery_running'],
  ['resources/rp-import-codegen/', 'codegen_running'],
]);
function outputRepairPasses(projectDir, reason, file, { record }) {
  const store = path.join(projectDir, OUTPUT_REPAIR_FILE);
  let doc = {};
  try { doc = JSON.parse(require('node:fs').readFileSync(store, 'utf8')); } catch { doc = {}; }
  const key = `${reason}:${file}`;
  const versions = Array.isArray(doc.passes?.[key]) ? doc.passes[key] : [];
  let digest = null;
  try { digest = require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(path.join(projectDir, file))).digest('hex'); } catch { digest = null; }
  if (digest && !versions.includes(digest)) {
    versions.push(digest);
    if (record) {
      const next = { schemaVersion: 1, passes: { ...(doc.passes || {}), [key]: versions } };
      require('node:fs').mkdirSync(path.dirname(store), { recursive: true });
      require('node:fs').writeFileSync(`${store}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
      require('node:fs').renameSync(`${store}.tmp`, store);
    }
  }
  // The first invalid version is the agent's own write; each later one is a repair pass.
  return Math.max(0, versions.indexOf(digest) === -1 ? versions.length : versions.indexOf(digest));
}
function invalidOutputRoute(reason, nextResource, errors, ctx = {}) {
  const stop = { ok: true, nextState: 'blocked', nextResource, reason, errors, blocking: true };
  const nextState = ctx.nextState || WRITER_STATE.get(nextResource);
  if (!ctx.projectDir || !ctx.file || ctx.reviewOnly || !nextState) return stop;
  const passes = outputRepairPasses(ctx.projectDir, reason, ctx.file, { record: !ctx.observeOnly });
  if (passes >= OUTPUT_REPAIR_PASSES) return { ...stop, passes, blocker: { type: 'agent_output_invalid', artifact: ctx.file, requiredInput: `${ctx.file} is still invalid after ${OUTPUT_REPAIR_PASSES} repair passes; every later step reads it, so the run cannot go on. Fix the file and resume.` } };
  return { ok: true, nextState, nextResource, reason, errors, artifact: ctx.file, repairPass: passes + 1, repairPasses: OUTPUT_REPAIR_PASSES };
}

// The refusal the one-click mapping approval would get (the binding every approval writer uses,
// read only), or null when it would be recorded.
async function oneClickMappingRefusal(projectDir) {
  try {
    await require('./user-actions').approvalArtifactRefs(projectDir, { approvalType: 'mapping', status: 'approved', decidedBy: 'agent' });
    return null;
  } catch (error) {
    const details = error.errors || error.failures || error.staleInputs || [];
    return { errors: [error.code || error.message, ...details.map(d => (typeof d === 'string' ? d : [d.code, d.detail].filter(Boolean).join(':') || JSON.stringify(d)))] };
  }
}

// A stage may finish with an unresolved decision for an earlier stage.  The stage handoff is
// the durable source of that intent; do not let destination/publication or write gates turn it
// into forward progress.  Handoffs in the wild use either a top-level resource or a route on
// an individual blocker/open item, so accept both forms while restricting routes to known
// pipeline resources.
const PIPELINE_RESOURCES = new Map([
  ['resources/rp-discovery/', { order: 10, nextState: 'discovery_running' }],
  ['resources/rp-mapper/', { order: 20, nextState: 'mapping_running' }],
  ['resources/rp-setup-discovery/', { order: 30, nextState: 'setup_discovery_running' }],
  ['resources/rp-import-codegen/', { order: 40, nextState: 'codegen_running' }],
]);
const STAGE_HANDOFFS = [
  { path: 'setup/llm-handoff.json', order: 30, stage: 'setup' },
  { path: 'execution/llm-handoff.json', order: 40, stage: 'codegen' },
];
const CODEGEN_OWNERSHIP_HINT = /(?:rp-import-codegen|generated\s+(?:import\s+)?code|generated\s+importer|src\/import|run-import\.js|codegen)/i;
const CODEGEN_DONE_OUTCOMES = new Set(['done', 'passed', 'complete', 'completed', 'success']);

function normalizePipelineResource(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const aliases = {
    mapper: 'resources/rp-mapper/',
    'rp-mapper': 'resources/rp-mapper/',
    discovery: 'resources/rp-discovery/',
    'rp-discovery': 'resources/rp-discovery/',
    'setup-discovery': 'resources/rp-setup-discovery/',
    'rp-setup-discovery': 'resources/rp-setup-discovery/',
    codegen: 'resources/rp-import-codegen/',
    'rp-import-codegen': 'resources/rp-import-codegen/',
  };
  if (aliases[trimmed]) return aliases[trimmed];
  const withPrefix = trimmed.startsWith('resources/') ? trimmed : `resources/${trimmed.replace(/^\/+/, '')}`;
  const normalized = withPrefix.endsWith('/') ? withPrefix : `${withPrefix}/`;
  return PIPELINE_RESOURCES.get(normalized) ? normalized : null;
}

function handoffResources(handoff) {
  const values = [];
  const collect = (value) => {
    if (typeof value === 'string') values.push(value);
    else if (value && typeof value === 'object') {
      for (const key of ['resource', 'nextResource', 'route', 'nextRoute', 'requiredResource']) collect(value[key]);
    }
  };
  for (const key of ['resource', 'nextResource', 'route', 'nextRoute', 'requiredResource']) collect(handoff?.[key]);
  for (const key of ['blockers', 'unresolved', 'openItems']) {
    if (Array.isArray(handoff?.[key])) for (const item of handoff[key]) collect(item);
  }
  return [...new Set(values.map(normalizePipelineResource).filter(Boolean))];
}

function handoffText(value) {
  try { return JSON.stringify(value); } catch { return ''; }
}

const IMPORT_RESOURCE = 'resources/rp-execute-import/';
const CODEGEN_RESOURCE = 'resources/rp-import-codegen/';
const IMPORT_HANDOFF_STAGES = new Set(['execute-import', 'import']);
const CODEGEN_HANDOFF_STAGES = new Set(['import-codegen', 'codegen']);
const CODEGEN_CHECKPOINT_DONE = new Set(['complete', 'partial']);

// The pipeline resource a recorded run.json stop names. Writers use `nextResource`,
// `resource` or put the owning skill in `owner`; all three are the same hand-back.
function resumeFromResource(resumeFrom) {
  if (!resumeFrom || typeof resumeFrom !== 'object' || Array.isArray(resumeFrom)) return null;
  for (const key of ['nextResource', 'resource', 'owner']) {
    const resource = normalizePipelineResource(resumeFrom[key]);
    if (resource) return resource;
  }
  return null;
}

// Stage handoffs are named `<stage>-<round>.json` with a free-form stage, so classify them by
// the resource they record and fall back to the known stage names.
function handoffRole(value) {
  const resource = typeof value?.resource === 'string' ? value.resource.trim().replace(/\/?$/, '/') : null;
  if (resource === IMPORT_RESOURCE || IMPORT_HANDOFF_STAGES.has(value?.stage)) return 'import';
  if (resource === CODEGEN_RESOURCE || CODEGEN_HANDOFF_STAGES.has(value?.stage)) return 'codegen';
  return null;
}

function codegenOwnedImportSignal(signal) {
  if (signal.kind === 'resume') return true;
  const value = signal.value;
  if (!value || typeof value !== 'object' || !CODEGEN_OWNERSHIP_HINT.test(handoffText(value))) return false;
  if (signal.kind === 'qa') return value.verdict === 'fail' || value.status === 'failed';
  return signal.role === 'import' && ['needs_decision', 'resume_limit', 'qa_findings', 'failed'].includes(value.outcome);
}

function codegenDoneSignal(signal) {
  if (signal.kind === 'checkpoint') return true;
  return signal.kind === 'handoff' && signal.role === 'codegen' && CODEGEN_DONE_OUTCOMES.has(signal.value?.outcome);
}

async function importRepairSignals(projectDir, artifacts) {
  const signals = [];
  for (const [directory, kind, pattern] of [
    ['state/handoffs', 'handoff', /^[a-z0-9][a-z0-9-]*-\d+\.json$/i],
    ['state/qa', 'qa', /^execute-import-qa-\d+\.json$/],
  ]) {
    let names;
    try { names = await fs.readdir(path.join(projectDir, directory)); } catch { continue; }
    for (const name of names.filter((candidate) => pattern.test(candidate))) {
      const file = path.join(projectDir, directory, name);
      let value;
      try { value = JSON.parse(await fs.readFile(file, 'utf8')); } catch { continue; }
      const role = kind === 'handoff' ? handoffRole(value) : null;
      if (kind === 'handoff' && !role) continue;
      let stat;
      try { stat = await fs.stat(file); } catch { continue; }
      const declared = value && (value.writtenAt || value.createdAt || value.updatedAt);
      const timestamp = declared && Number.isFinite(Date.parse(declared)) ? Date.parse(declared) : stat.mtimeMs;
      signals.push({ file: path.relative(projectDir, file), kind, role, value, timestamp });
    }
  }
  // A recorded stop that names codegen is the most explicit hand-back. Its time is the stop
  // time stamped by transitionRun (resumeFrom.recordedAt).
  const resumeFrom = artifacts.run?.resumeFrom;
  const recordedAt = Date.parse(resumeFrom?.recordedAt);
  if (resumeFromResource(resumeFrom) === CODEGEN_RESOURCE && Number.isFinite(recordedAt)) {
    signals.push({ file: 'orchestration/run.json', kind: 'resume', role: 'import', value: resumeFrom, timestamp: recordedAt });
  }
  // Codegen records its finished run on its checkpoint even when it writes no handoff.
  const codegenCheckpoint = artifacts.checkpoints?.codegen;
  const checkpointAt = Date.parse(codegenCheckpoint?.updatedAt);
  if (CODEGEN_CHECKPOINT_DONE.has(codegenCheckpoint?.status) && Number.isFinite(checkpointAt)) {
    signals.push({ file: 'orchestration/checkpoints.json', kind: 'checkpoint', role: 'codegen', value: codegenCheckpoint, timestamp: checkpointAt });
  }
  return signals.sort((a, b) => a.timestamp - b.timestamp);
}

async function latestMappingRejectionAt(projectDir, approval) {
  let latest = approval?.status === 'rejected' ? Date.parse(approval.decidedAt) : NaN;
  try {
    const journal = await fs.readFile(path.join(projectDir, 'orchestration', 'events.jsonl'), 'utf8');
    for (const line of journal.split('\n')) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event?.type !== 'approval.updated'
        || event.payload?.approvalType !== 'mapping'
        || event.payload?.status !== 'rejected') continue;
      const timestamp = Date.parse(event.timestamp);
      if (Number.isFinite(timestamp) && (!Number.isFinite(latest) || timestamp > latest)) latest = timestamp;
    }
  } catch {}
  return Number.isFinite(latest) ? latest : null;
}

async function handoffTimestamp(projectDir, relativePath, value) {
  const declared = value && (value.writtenAt || value.createdAt || value.updatedAt || value.generatedAt);
  if (declared && Number.isFinite(Date.parse(declared))) return Date.parse(declared);
  try { return (await fs.stat(path.join(projectDir, relativePath))).mtimeMs; } catch { return null; }
}

// After a settled import repair: resume the import once (the deferred tasks are held by its
// dependency gate) unless a report newer than the settlement exists; then the ordinary flow goes on.
async function settledResume(projectDir, readArtifact, settledAt, options = {}) {
  const settlement = require('./route-settlement');
  if (settlement.importRepairResumed(projectDir)) return null;
  let reportAt = null;
  try { reportAt = (await fs.stat(path.join(projectDir, 'execution', 'completion-report.json'))).mtimeMs; } catch { reportAt = null; }
  const report = (await readArtifact('execution/completion-report.json')).value;
  if (reportAt !== null && reportAt > settledAt && !report?.interruption) return null;
  if (!options.observeOnly) settlement.markImportRepairResumed(projectDir);
  return { ok: true, nextState: 'executing_import', nextResource: IMPORT_RESOURCE, reason: 'import_repair_settled_resume', resumeSameImport: true, settlement: 'execution/route-settlements.json' };
}

// A hand-back to codegen (import QA, an import handoff or run.json resumeFrom) holds until
// codegen records newer finished work; only then does the same import resume. A later mapping
// rejection supersedes that repair cycle until mapping is approved again; its journal event
// keeps the old codegen signals retired after the current approval changes to pending/approved.
async function codegenOwnedImportRoute(projectDir, artifacts, readArtifact, mappingRejectionAt, options = {}) {
  const allSignals = await importRepairSignals(projectDir, artifacts);
  let signals = allSignals;
  if (mappingRejectionAt !== null) signals = signals.filter((signal) => signal.timestamp > mappingRejectionAt);
  // Hand-backs the run settled at the repair pass limit are retired (lib/route-settlement.js).
  const settlement = require('./route-settlement');
  const retiredBefore = settlement.importRepairRetiredBefore(projectDir);
  if (retiredBefore !== null) {
    const live = signals.filter((signal) => signal.timestamp > retiredBefore);
    // Nothing left codegen could unblock (every unfinished task is held): later hand-backs retire too.
    if ((!live.length || settlement.importRepairCovered(projectDir)) && signals.length) return settledResume(projectDir, readArtifact, retiredBefore, options);
    signals = live;
  }
  const latest = signals.at(-1);
  if (!latest) return signals.length < allSignals.length ? { supersededByMapping: true } : null;
  const fixRequiredRoute = (signal) => ({
    ok: true,
    nextState: 'codegen_running',
    nextResource: CODEGEN_RESOURCE,
    reason: 'import_codegen_fix_required',
    handoff: signal.file,
    handoffStage: signal.kind === 'handoff' ? signal.value.stage : signal.kind === 'resume' ? 'run-blocked' : 'execute-import',
    requestedResource: CODEGEN_RESOURCE,
    then: IMPORT_RESOURCE,
    resumeSameImport: true,
    handBackAt: signal.timestamp,
  });
  // Each hand-back is a codegen repair pass. Passes that leave the import where it was (no new
  // imported records) are counted; at the limit the unfinished tasks are deferred and the rest of
  // the import resumes. A status display (observeOnly) counts nothing and settles nothing.
  const fixRequired = async (signal) => {
    const route = fixRequiredRoute(signal);
    const codegenAt = [...signals].reverse().find((s) => s.timestamp < signal.timestamp && codegenDoneSignal(s))?.timestamp ?? null;
    const passes = await settlement.importRepairPasses(projectDir, { ...signal, codegenAt }, { record: !options.observeOnly });
    if (!passes.exhausted || options.observeOnly) return route;
    const settled = settlement.settleRoute(projectDir, route);
    if (!settled.settled) return route;
    return settledResume(projectDir, readArtifact, signal.timestamp, options);
  };
  const prior = (before) => [...signals].reverse().find((signal) => signal.timestamp < before.timestamp && codegenOwnedImportSignal(signal));

  if (latest.role === 'codegen') {
    if (!codegenDoneSignal(latest)) {
      if (latest.value.stage === 'import-codegen' || prior(latest)) return fixRequired(latest);
      // An unfinished forward round (any stage label) still owns the run: a partial manifest it
      // wrote must not open setup or import. A round that names an earlier stage goes there.
      const earlier = handoffResources(latest.value).some((resource) => (PIPELINE_RESOURCES.get(resource)?.order ?? Infinity) < PIPELINE_RESOURCES.get(CODEGEN_RESOURCE).order);
      return earlier ? null : { ok: true, nextState: 'codegen_running', nextResource: CODEGEN_RESOURCE, reason: 'codegen_round_unfinished', handoff: latest.file, handoffStage: latest.value.stage };
    }
    const handBack = prior(latest);
    if (!handBack) return null;
    const report = (await readArtifact('execution/completion-report.json')).value;
    const progress = await importProgressFields(projectDir);
    const reportNeedsResume = report && !['complete', 'complete_with_warnings', 'complete_with_recovered_records', 'complete_with_deferred_records'].includes(report.status);
    if (reportNeedsResume || progress.importProgress === 'interrupted') {
      return {
        ok: true,
        nextState: 'executing_import',
        nextResource: IMPORT_RESOURCE,
        reason: 'import_codegen_fixed_resume',
        repairedBy: latest.file,
        priorHandoff: handBack.file,
        resumeSameImport: true,
        handBackAt: handBack.timestamp,
      };
    }
    return null;
  }

  return codegenOwnedImportSignal(latest) ? fixRequired(latest) : null;
}

async function answeredMappingDeferralRepair(projectDir, readArtifact, { after = null, observeOnly = false } = {}) {
  let names;
  try { names = await fs.readdir(path.join(projectDir, 'orchestration', 'user-actions')); } catch { return null; }
  const answered = [];
  for (const name of names.filter((candidate) => candidate.endsWith('.json') && candidate !== 'index.json')) {
    let value;
    try { value = JSON.parse(await fs.readFile(path.join(projectDir, 'orchestration', 'user-actions', name), 'utf8')); } catch { continue; }
    const answeredAt = Date.parse(value?.answer?.answeredAt);
    if (value?.status === 'answered'
      && value.subject?.routerReason === 'mapping_deferral_report_missing_or_stale'
      && value.answer?.choice === 'fix-and-regenerate'
      && (after === null || (Number.isFinite(answeredAt) && answeredAt > after))) answered.push(value);
  }
  const action = answered.sort((a, b) => String(a.answer?.answeredAt || '').localeCompare(String(b.answer?.answeredAt || ''))).at(-1);
  if (!action) return null;

  const report = (await readArtifact('execution/completion-report.json')).value;
  const handoff = (await readArtifact('execution/review/migration-handoff.json')).value;
  const answeredAt = Date.parse(action.answer.answeredAt);
  const reportAt = report?.lastWriteAt ? Date.parse(report.lastWriteAt) : NaN;
  const handoffAt = handoff?.generatedAt ? Date.parse(handoff.generatedAt) : NaN;
  const stale = !report || !Number.isFinite(reportAt) || !handoff || !Number.isFinite(handoffAt)
    || handoffAt <= reportAt
    || (Number.isFinite(answeredAt) && (reportAt < answeredAt || handoffAt < answeredAt));
  if (!stale) return null;
  // Settled after the pass limit: the regeneration is a cutover task, not another import turn.
  const route = boundedMappingDeferralRegenerate(projectDir, { observeOnly });
  return route && { ...route, requestId: action.requestId };
}

// The regenerate route, at most IMPORT_REPAIR_PASSES failed passes per mapping plan; then it is
// settled (null: the run goes on). Both readers (the completion gate and an answered
// fix-and-regenerate) share this count and this settlement.
function boundedMappingDeferralRegenerate(projectDir, { observeOnly = false } = {}) {
  const settlement = require('./route-settlement');
  if (settlement.mappingDeferralReportSettled(projectDir)) return null;
  const route = mappingDeferralRegenerateRoute();
  const { exhausted } = settlement.mappingDeferralRegeneratePasses(projectDir, { record: !observeOnly });
  if (!exhausted || observeOnly) return route;
  return settlement.settleRoute(projectDir, route).settled ? null : route;
}

function mappingDeferralRegenerateRoute() {
  return {
    ok: true,
    nextState: 'executing_import',
    nextResource: IMPORT_RESOURCE,
    reason: 'mapping_deferral_report_regenerate',
    resumeSameImport: true,
    blocker: {
      type: 'mapping_deferral_evidence_required',
      artifact: 'execution/completion-report.json',
      requiredInput: 'Regenerate the existing report/handoff through shared writers using the importer mapping pin; retained counters must not be reported as completed.',
    },
  };
}

async function backwardHandoffRoute(projectDir, artifacts, readArtifact, options = {}) {
  const mappingRejectionAt = await latestMappingRejectionAt(projectDir, artifacts.approvals?.mapping);
  if (artifacts.approvals?.mapping?.status === 'rejected') {
    return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_rejected' };
  }
  for (const definition of STAGE_HANDOFFS) {
    const entry = await readArtifact(definition.path);
    if (!entry.present || entry.parseError || !entry.value || entry.value.needsLlm !== true) continue;
    const timestamp = await handoffTimestamp(projectDir, definition.path, entry.value);
    if (mappingRejectionAt !== null && Number.isFinite(timestamp) && mappingRejectionAt > timestamp) continue;
    const resources = handoffResources(entry.value);
    // A run resume record is also a durable route emitted by the supervisor.  It is only a
    // fallback: a handoff's explicit route always wins.
    if (!resources.length) {
      const resumeResource = resumeFromResource(artifacts.run?.resumeFrom);
      if (resumeResource) resources.push(resumeResource);
    }
    const earlier = resources
      .map((resource) => ({ resource, ...PIPELINE_RESOURCES.get(resource) }))
      .filter((candidate) => candidate.order < definition.order)
      .sort((a, b) => a.order - b.order)[0];
    if (earlier) {
      return {
        ok: true,
        nextState: earlier.nextState,
        nextResource: earlier.resource,
        reason: 'backward_handoff',
        handoff: definition.path,
        handoffStage: definition.stage,
        requestedResource: earlier.resource,
      };
    }
  }
  // A pending codegen hand-back wins over an answered report-repair action: that action resumes
  // rp-execute-import, which cannot repair generated code (the live loop on 2026-11-09).
  const importRepair = await codegenOwnedImportRoute(projectDir, artifacts, readArtifact, mappingRejectionAt, options);
  if (importRepair?.nextResource === CODEGEN_RESOURCE || importRepair?.nextResource === 'resources/rp-mapper/') return importRepair;
  const mappingDeferralRepair = await answeredMappingDeferralRepair(projectDir, readArtifact, { after: mappingRejectionAt, observeOnly: options.observeOnly });
  if (mappingDeferralRepair) return mappingDeferralRepair;
  if (importRepair?.supersededByMapping) return null;
  return importRepair;
}

const mappingPlanDigest = require('./mapping-plan-digest.js');

function downstreamMappingDigest(value, artifact) {
  if (!value || typeof value !== 'object') return null;
  if (artifact === 'setup') {
    return value.inputs?.mappingPlanDigest || value.inputs?.mappingPlanSha256 || value.mappingPlanDigest || value.mappingPlanSha256 || null;
  }
  return value.mappingPlanDigest || value.mappingPlanSha256 || null;
}

async function staleMappingBoundArtifactRoute(projectDir, readArtifact, { allowLegacyUnboundSetup = false } = {}) {
  const current = mappingPlanDigest.current(projectDir);
  if (!current) return null;
  const setupEntry = await readArtifact('setup/setup-plan.json');
  const setupDigest = setupEntry.present && !setupEntry.parseError
    ? downstreamMappingDigest(setupEntry.value, 'setup') : null;
  if (setupEntry.present && !setupEntry.parseError && !setupDigest && !allowLegacyUnboundSetup) {
    return {
      ok: true,
      nextState: 'setup_discovery_running',
      nextResource: 'resources/rp-setup-discovery/',
      reason: 'setup_plan_stale_mapping',
      staleArtifact: 'setup/setup-plan.json',
      expectedMappingPlanDigest: current,
      actualMappingPlanDigest: null,
    };
  }
  if (setupDigest && !mappingPlanDigest.matches(projectDir, setupDigest)) {
    return {
      ok: true,
      nextState: 'setup_discovery_running',
      nextResource: 'resources/rp-setup-discovery/',
      reason: 'setup_plan_stale_mapping',
      staleArtifact: 'setup/setup-plan.json',
      expectedMappingPlanDigest: current,
      actualMappingPlanDigest: setupDigest,
    };
  }
  const manifestEntry = await readArtifact('execution/execution-manifest.json');
  if (!manifestEntry.present || manifestEntry.parseError) return null;
  const manifestDigest = downstreamMappingDigest(manifestEntry.value, 'manifest');
  if (manifestDigest && !mappingPlanDigest.matches(projectDir, manifestDigest)) {
    return {
      ok: true,
      nextState: 'codegen_running',
      nextResource: 'resources/rp-import-codegen/',
      reason: 'execution_manifest_stale_mapping',
      staleArtifact: 'execution/execution-manifest.json',
      expectedMappingPlanDigest: current,
      actualMappingPlanDigest: manifestDigest,
    };
  }
  return null;
}

// The setup plan mutes exactly when the answer says so; otherwise setup discovery
// regenerates it before any setup write. A legacy run keeps the plan it already ran.
async function muteMismatchRoute(readArtifact, notificationMute) {
  if (notificationMute.source === 'legacy_config') return null;
  const mismatch = setupPlanMuteMismatch(notificationMute, (await readArtifact(path.join('setup', 'setup-plan.json'))).value);
  return mismatch ? { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: mismatch.code } : null;
}

async function nonEmptyFile(filePath, minBytes = 1) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size >= minBytes;
  } catch {
    return false;
  }
}

// Existence/size only — the router never reads or scans these files. Sample
// journals and a mirror-seeded crosswalk are deliberately not evidence.
const QUICK_CROSSWALKS = {
  woocommerce: 'state/crosswalk/quick-mode.json',
  shopify: 'state/crosswalk/quick-shopify.json',
};

async function importProgressFields(projectDir, { quickPlatform = null } = {}) {
  const evidence = [];
  if (quickPlatform) {
    if (await exists(path.join(projectDir, QUICK_IMPORT_STARTED_MARKER))) evidence.push(QUICK_IMPORT_STARTED_MARKER);
    const crosswalk = QUICK_CROSSWALKS[quickPlatform];
    // Legacy projects interrupted before the marker shipped: a checkpoint that is not `{}`.
    // The adapters write `{}` as `{}\n` (3 bytes), so the size test is "more than 3 bytes";
    // any checkpoint with one entry is far larger.
    if (crosswalk && await nonEmptyFile(path.join(projectDir, crosswalk), 4)) evidence.push(crosswalk);
  } else {
    for (const relativePath of ['state/attempts/write-attempts.ndjson', 'execution/unresolved-writes.ndjson']) {
      if (await nonEmptyFile(path.join(projectDir, relativePath))) evidence.push(relativePath);
    }
  }
  return evidence.length ? { importProgress: 'interrupted', recoveryArtifacts: evidence } : { importProgress: 'not_started' };
}

// A setup-verification.json that exists but doesn't validate (wrong schema, incomplete
// plan coverage, or a stale planDigest) is treated identically to one that doesn't exist —
// no separate router state, no fail-open branch.
async function isSetupVerified(projectDir, readArtifact) {
  const verificationPath = path.join(projectDir, 'setup', 'setup-verification.json');
  if (!(await exists(verificationPath))) return false;
  const verification = await readJson(verificationPath);
  const plan = (await readArtifact(path.join('setup', 'setup-plan.json'))).value;
  const planDigest = hashArtifact(projectDir, path.join('setup', 'setup-plan.json'));
  if (!validateSetupVerification({ verification, plan, planDigest, projectDir }).ok) return false;
  // The regional row is bound to the source file, the answers and the approved regional plan it
  // was produced under; a changed one makes the receipt stale, so setup re-reads the site.
  let hasRegionalStep = false;
  try { hasRegionalStep = siteRegional.planHasRegionalStep(projectDir); } catch { hasRegionalStep = false; }
  if (hasRegionalStep) {
    const siteId = siteRegional.destinationSiteId(projectDir);
    const row = (verification.requirements || []).find((item) => item && item.id === siteRegional.STEP_ID);
    if (!siteRegional.receiptIsCurrent(projectDir, siteId, verification, row)) return false;
  }
  return true;
}

// The regional settings route, evaluated before the execution-approval gate. While the owner's one question
// about an existing site's settings is open, nothing else proceeds -- in every mode, one-click included.
async function regionalRoute(projectDir) {
  // Once backend accounting exists, malformed historical setup output is handled by the
  // completion artifacts; do not let the regional side-check re-read it and crash routing.
  let hasRegionalStep = false;
  try { hasRegionalStep = siteRegional.planHasRegionalStep(projectDir); } catch { return null; }
  if (!hasRegionalStep) return null;
  const open = await siteRegional.listRegionalRequests(projectDir).catch(() => []);
  if (!open.length) return null;
  return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-execute-setup/', reason: 'site_regional_approval_pending', blocking: true, requestIds: open.map((request) => request.requestId) };
}

// A stamped project cannot leave mapping while any source-coverage row lacks
// exactly one valid disposition. An unstamped (pre-contract) project has no coverage record to
// check; the completion report carries that instead.
async function sourceCoverageGate(projectDir) {
  try {
    const contract = await readCoverageContract(projectDir);
    if (!contract.stamped) return { ok: true, failures: [] };
    const result = await reconcileProject(projectDir);
    return { ok: result.ok, failures: result.failures };
  } catch (error) {
    if (error instanceof SourceCoverageError) {
      return { ok: false, failures: error.failures.length ? error.failures : [{ code: 'invalid_coverage', coverageId: null, message: error.message, sources: [] }] };
    }
    throw error;
  }
}

// rp-preflight's contract: source configuration/credential blocks go back to rp-source-inputs and
// destination blocks to rp-destination; anything else (the Wix CLI) stays with rp-preflight. A
// source_env block whose key statuses no longer match the env file is stale: preflight runs again.
const PREFLIGHT_SOURCE_CHECKS = new Set(['source_mode', 'source_credentials', 'source_env', 'source_auth_intent', 'file_inputs']);
const PREFLIGHT_DESTINATION_CHECKS = new Set(['target_site_strategy', 'wix_env', 'wix_site_id']);

async function preflightBlockedRoute(projectDir, artifacts, sourcePlatform) {
  const preflight = artifacts.preflight;
  const blocked = (Array.isArray(preflight.checks) ? preflight.checks : []).filter((check) => check && check.status === 'blocked');
  const blockedChecks = blocked.map((check) => check.id);
  const sourceEnv = blocked.find((check) => check.id === 'source_env' && check.keyStatus && typeof check.keyStatus === 'object');
  if (sourceEnv && sourcePlatform) {
    const current = await statEnvKeys(path.join(projectDir, 'config', `source.${sourcePlatform}.env`), Object.keys(sourceEnv.keyStatus)).catch(() => null);
    if (current && Object.entries(sourceEnv.keyStatus).some(([key, status]) => current.keys[key] !== status)) {
      return { ok: true, nextState: 'preflight_running', nextResource: 'resources/rp-preflight/', reason: 'preflight_source_env_changed', blockedChecks };
    }
  }
  // Reuse preflight's rules, but only read local evidence here. A changed/removed blocker
  // dispatches the real preflight, which still owns live CLI/session verification. Never
  // probe a service or replay the telemetry journal on a router poll.
  if (blockedChecks.some((id) => PREFLIGHT_SOURCE_CHECKS.has(id) || PREFLIGHT_DESTINATION_CHECKS.has(id))) {
    const current = await localPreflightChecks(projectDir, artifacts, {
      probeShopifySession: async () => ({ receipt: await readJson(path.join(projectDir, SESSION_RECEIPT_FILE)) }),
    });
    if (blocked.some((check) => (PREFLIGHT_SOURCE_CHECKS.has(check.id) || PREFLIGHT_DESTINATION_CHECKS.has(check.id))
      && !current.some((item) => item.id === check.id && item.status === 'blocked'))) {
      return { ok: true, nextState: 'preflight_running', nextResource: 'resources/rp-preflight/', reason: 'preflight_inputs_changed', blockedChecks };
    }
  }
  const nextResource = blockedChecks.some((id) => PREFLIGHT_SOURCE_CHECKS.has(id))
    ? 'resources/rp-source-inputs/'
    : blockedChecks.some((id) => PREFLIGHT_DESTINATION_CHECKS.has(id)) ? 'resources/rp-destination/' : 'resources/rp-preflight/';
  return { ok: true, nextState: 'preflight_blocked', nextResource, reason: 'preflight_blocked', blockedChecks };
}
// The supported ways to clear an explicit `status: blocked` stop, surfaced on the route.
const RUN_BLOCKED_RESUME = 'replatform resume <project>, or orchestration-state.js transition --status running';

async function determineNextStepUnfiltered(projectDir, artifacts, { reviewOnly = false, ...options } = {}) {
  const validation = validateArtifacts(artifacts);
  if (!validation.ok) {
    return {
      ok: false,
      nextState: 'failed',
      nextResource: null,
      reason: 'invalid_orchestration_artifacts',
      errors: validation.errors,
    };
  }

  const outputCtx = (file, nextState) => ({ projectDir, file, nextState, reviewOnly, observeOnly: options.observeOnly });
  if (artifacts.run.status === 'cancel_requested') {
    return { ok: true, nextState: 'cancel_requested', nextResource: null, reason: 'cancellation_cleanup_required', blocking: true };
  }
  if (artifacts.run.status === 'canceled' || artifacts.run.status === 'interrupted') {
    return { ok: true, nextState: artifacts.run.status, nextResource: null, reason: artifacts.run.status, blocking: true };
  }
  // An explicitly recorded stop: something wrote run.json `status: blocked` (an operator or
  // agent via `orchestration-state.js transition --status blocked`). The router itself never
  // writes run.json, so its own derived blocks (preflight_blocked, *_invalid, ...) never land
  // here. Hold until a supported resume sets status back to running.
  if (artifacts.run.status === 'blocked') {
    return { ok: true, nextState: 'blocked', nextResource: null, reason: 'run_blocked', blocking: true, resumeFrom: artifacts.run.resumeFrom ?? null, resumeWith: RUN_BLOCKED_RESUME, blocker: explicitRunBlocker(artifacts.run.resumeFrom) };
  }

  const decisions = artifacts.decisions || {};
  const approvals = artifacts.approvals || {};
  const sourceUrl = getDecisionValue(decisions, 'sourceUrl');
  const sourceMode = getDecisionValue(decisions, 'sourceMode');
  const fileInputPaths = getDecisionValue(decisions, 'fileInputPaths');
  const hasFileInputs = Array.isArray(fileInputPaths) && fileInputPaths.length > 0;
  const deliveryMode = getEffectiveDeliveryMode(decisions);
  const isOneClick = isExplicitUserOneClick(decisions);
  const websiteScope = getDecisionValue(decisions, 'websiteScope');
  const targetSiteStrategy = getDecisionValue(decisions, 'targetSiteStrategy');
  const managementImportMode = getDecisionValue(decisions, 'managementImportMode') || 'standard';
  const sourcePlatform = getDecisionValue(decisions, 'sourcePlatform');
  const preflight = artifacts.preflight || null;
  const readArtifact = createArtifactReader(projectDir);
  const actionGate = await pendingUserActionGate(projectDir);
  if (actionGate?.route.reason === 'user_action_artifacts_unreadable') return actionGate.route;

  if (deliveryMode && !['management', 'website', 'management_and_website'].includes(deliveryMode)) {
    return { ok: false, nextState: 'failed', nextResource: 'resources/rp-project-intake/', reason: 'invalid_delivery_mode' };
  }

  if (!deliveryMode) {
    return { ok: true, nextState: 'awaiting_destination_strategy', nextResource: 'resources/rp-project-intake/', reason: 'missing_delivery_mode' };
  }

  if (managementImportMode && !['standard', 'quick'].includes(managementImportMode)) {
    return { ok: false, nextState: 'failed', nextResource: 'resources/rp-project-intake/', reason: 'invalid_management_import_mode' };
  }

  // Frontend-only work deliberately avoids the backend migration pipeline. The headless
  // skill owns its destination/project and terminal website artifacts in this mode.
  if (deliveryMode === 'website') {
    if (!sourceUrl) {
      return { ok: true, nextState: 'awaiting_source', nextResource: 'resources/rp-source-inputs/', reason: 'missing_source_url' };
    }
    const completionInputs = await loadMigrationCompletionInputs(projectDir);
    const frontend = validateFrontendCompletion(completionInputs.frontendCompletion, null, { requireHandoff: false });
    if (frontend.ok) {
      return { ok: true, nextState: 'completed', nextResource: null, reason: 'website_completion_present' };
    }
    return { ok: true, nextState: 'storefront_running', nextResource: 'resources/rp-website-continuation/', reason: 'website_only_frontend' };
  }

  // Rebuild what is derived from the mapping plan before any standard route can return (a
  // status read only observes). A finalized review-only run keeps its evidence as it is.
  if (managementImportMode !== 'quick' && !reviewOnly && !options.observeOnly) {
    // A refresh that cannot run leaves the files as they are; later gates still see them stale.
    const refreshed = await require('./refresh-derived.js').refreshDerived(projectDir).catch(() => ({ rebinds: [] }));
    // A re-bound approval is read from disk again; the loaded copy still pins the old bytes.
    if (refreshed.rebinds.some((move) => move.files.includes('orchestration/approvals.json'))) {
      Object.assign(approvals, await readJson(path.join(projectDir, 'orchestration', 'approvals.json')));
    }
  }

  // A later stage can explicitly hand work back to an earlier stage.  This must precede every
  // destination/publication and write decision, including one-click runs.
  const backwardHandoff = await backwardHandoffRoute(projectDir, artifacts, readArtifact, options);
  if (backwardHandoff) return backwardHandoff;

  if (!targetSiteStrategy) {
    return { ok: true, nextState: 'awaiting_destination_strategy', nextResource: 'resources/rp-destination/', reason: 'missing_target_site_strategy' };
  }

  // An existing site is muted only when the operator said so, asked here at
  // intake (before any write), never mid-import. A conflicting config stops the run.
  const notificationMute = await readNotificationMute(projectDir, { decisions });
  if (notificationMute.errors.length) {
    return { ok: false, nextState: 'failed', nextResource: 'resources/rp-project-intake/', reason: 'notification_mute_invalid', errors: notificationMute.errors };
  }
  if (notificationMute.needsAnswer) {
    return { ok: true, nextState: 'awaiting_destination_strategy', nextResource: 'resources/rp-project-intake/', reason: 'missing_notification_mute_decision', question: NOTIFICATION_MUTE_QUESTION };
  }

  // The decision above only records which strategy was CHOSEN — it says nothing about
  // whether the destination actually got provisioned. rp-destination persists the
  // metasite id into config/wix.env on success; if that never happened (a scaffold
  // failure, a 409, anything short of completion), targetSiteStrategy can still be set
  // while no destination exists. Without this check the router falls through toward
  // preflight, which reports the generic "wix.env is missing" — indistinguishable from a
  // run that never started — and there is no route back into destination creation for
  // the rest of the run. Applies to both strategies uniformly: rp-destination
  // is the one module responsible for resolving either, and "persist the metasite id" is
  // its stated postcondition for both, so this only re-verifies that postcondition rather
  // than re-deriving which strategy path was taken.
  //
  // nextState is 'destination_running', NOT 'awaiting_destination_strategy': the
  // decision is already made, so this is the agent actively retrying creation, not a
  // pause for a new user decision. orchestration-state.js requires needsUserInput=true
  // for every 'awaiting_*' state (isAwaitingState) — reusing that prefix here would
  // force a stop for input that was never needed and could wrongly halt 1-click
  // automation on a plain retry. 'destination_running' follows the same naming and
  // needsUserInput=false convention as the other in-progress states here
  // (preflight_running, discovery_running, etc.).
  // WIX_SCAFFOLD_STATUS must be read and classified *before* deciding whether
  // the missing-WIX_SITE_ID case is a clean first attempt or a durable, already-failed
  // one. The wrapper can leave
  // a durable in_progress/ambiguous marker behind with NO WIX_SITE_ID at all (an
  // interrupted or unconfirmed attempt); checking WIX_SITE_ID's presence first and
  // returning immediately, as a prior version of this router did, never looks at that
  // marker — every restart re-classifies it as a fresh, automatically-retryable
  // destination_running, rp-destination invokes the wrapper, the wrapper correctly
  // refuses again, and the router repeats the same non-decision forever. This is exactly
  // the no-progress loop the WIX_SITE_ID-present branch below already exists to prevent
  // for `incomplete` — it just wasn't extended to the no-site-id side.
  const wixEnvPath = path.join(projectDir, 'config', 'wix.env');
  const wixEnv = await statEnvKeys(wixEnvPath, ['WIX_SITE_ID']);
  const wixEnvValues = await readEnvFile(wixEnvPath).catch((error) => {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  });
  const scaffoldStatus = wixEnvValues.WIX_SCAFFOLD_STATUS;

  // Receipt-backed Editor destinations and the explicit new-site type choice.
  const destinationRoute = await destinationGate(projectDir, decisions, {
    targetSiteStrategy,
    siteIdValue: wixEnv.keys.WIX_SITE_ID === 'present' ? String(wixEnvValues.WIX_SITE_ID).trim() : null,
    scaffoldStatus,
  });
  if (destinationRoute) return destinationRoute;

  if (wixEnv.keys.WIX_SITE_ID !== 'present') {
    // No confirmed destination yet. Only a genuinely untouched wix.env (no status marker
    // at all) is a clean first attempt — anything the wrapper itself already recorded
    // here is a durable outcome of a real, failed attempt and must not be treated as one.
    if (scaffoldStatus === undefined) {
      return { ok: true, nextState: 'destination_running', nextResource: 'resources/rp-destination/', reason: 'destination_not_provisioned' };
    }
    if (scaffoldStatus === 'in_progress') {
      // An attempt was interrupted before it could record any outcome, and no local
      // receipt exists either — the wrapper itself now refuses to retry through this;
      // the router must not retry around it. 'blocked', not
      // 'destination_running': no repair path exists, so an auto-retryable state here
      // is a no-progress loop, exactly like the incomplete case below.
      return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-destination/', reason: 'destination_scaffold_interrupted' };
    }
    // Any other present value with no WIX_SITE_ID (ambiguous, or corrupted/unexpected
    // text) — the wrapper cannot confirm whether a destination exists in this state
    // either, and this router has no more information than the wrapper does.
    return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-destination/', reason: 'destination_scaffold_ambiguous' };
  }

  // WIX_SCAFFOLD_STATUS must also be consumed once WIX_SITE_ID is present, not
  // just written by the scaffold wrapper — otherwise a restarted run sees WIX_SITE_ID
  // present, advances past rp-destination, and never re-invokes the wrapper branch that
  // rejects an incomplete scaffold. Routes to 'blocked' (not 'destination_running'): there
  // is no repair path, so an automatically-retryable state here would be a
  // no-progress loop — 'blocked' is the one state orchestration-state.js's own
  // validateRun invariant structurally requires needsUserInput=true for.
  if (scaffoldStatus === 'incomplete') {
    return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-destination/', reason: 'destination_scaffold_incomplete' };
  }
  if (scaffoldStatus !== undefined && scaffoldStatus !== 'complete') {
    return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-destination/', reason: 'destination_scaffold_status_invalid' };
  }

  // A file-provided run (e.g. platform=csv) has no source URL to probe; its
  // input files stand in for one. Destination resolution has already happened,
  // so source readiness can now branch between file and URL inputs.
  if (sourceMode === 'files_only') {
    if (!hasFileInputs) {
      return { ok: true, nextState: 'awaiting_files', nextResource: 'resources/rp-source-inputs/', reason: 'missing_file_inputs' };
    }
  } else if (!sourceUrl && !hasFileInputs) {
    return { ok: true, nextState: 'awaiting_source', nextResource: 'resources/rp-source-inputs/', reason: 'missing_source_url' };
  }
  if (!sourceMode) {
    return { ok: true, nextState: 'awaiting_import_scope', nextResource: 'resources/rp-source-inputs/', reason: 'missing_source_mode' };
  }
  // A bad value already on disk (a run recorded before `decide` validated it, or a
  // hand-written decisions file) stops here, before any preflight result is read, so a
  // stale passing preflight.json cannot advance the run. Recording a canonical value
  // through `decide` replaces it.
  if (!isKnownSourceMode(sourceMode)) {
    return { ok: true, nextState: 'awaiting_import_scope', nextResource: 'resources/rp-source-inputs/', reason: 'invalid_source_mode' };
  }

  // Preserve the destination/acquisition guards above and fresh post-preflight stage
  // routing. Stale/unreadable requests still need repair after preflight has passed.
  if (actionGate && (actionGate.route.reason !== 'pending_user_action' || preflight?.status !== 'pass')) return actionGate.route;

  if (!preflight || !preflight.status || preflight.status === 'not_started') {
    return { ok: true, nextState: 'preflight_running', nextResource: 'resources/rp-preflight/', reason: 'preflight_missing' };
  }
  if (preflight.status === 'blocked') return preflightBlockedRoute(projectDir, artifacts, sourcePlatform);
  if (preflight.status === 'failed') {
    return { ok: false, nextState: 'failed', nextResource: null, reason: 'preflight_failed', errors: [] };
  }

  // Scope boundary: phase-output validation runs only before backend accounting.
  const completionReportPresent = await liveCompletionReportPresent(projectDir);
  const completionReport = await readJson(path.join(projectDir, 'execution', 'completion-report.json'));
  const unexpectedSkipResume = unexpectedSkipsNeedResume(completionReport, approvals.mapping);
  const resumableCompletionReport = !completionReportPresent || Boolean(completionReport?.interruption) || unexpectedSkipResume;
  // A recorded rejection is never an approval, in any mode (one-click included).
  const executionRejected = Boolean(approvals.execution && approvals.execution.status === 'rejected');
  const executionRejectedRoute = { ok: true, nextState: 'blocked', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_rejected', blocking: true };

  if (managementImportMode === 'quick') {
    if (!sourcePlatform) {
      return { ok: true, nextState: 'quick_mode_adapter_resolution_required', nextResource: 'resources/rp-source-inputs/', reason: 'quick_mode_platform_not_detected' };
    }
    const quickResources = {
      shopify: 'resources/rp-quick-shopify/',
      woocommerce: 'resources/rp-quick-woocommerce/',
    };
    const quickResource = quickResources[sourcePlatform];
    if (!quickResource) {
      return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-source-inputs/', reason: 'quick_mode_unsupported_platform', errors: [{ platform: sourcePlatform }] };
    }
    const quickPreflight = await readJson(path.join(projectDir, 'quick-mode', 'preflight.json'));
    if (!quickPreflight) {
      return { ok: true, nextState: 'quick_mode_preflight_required', nextResource: quickResource, reason: 'quick_mode_preflight_missing' };
    }
    if (quickPreflight.status !== 'passed') {
      return {
        ok: true,
        nextState: 'blocked',
        nextResource: quickResource,
        reason: 'quick_mode_preflight_blocked',
        errors: [{ status: quickPreflight.status || 'invalid' }],
      };
    }
    if (!(await exists(path.join(projectDir, 'quick-mode', 'plan.json')))) {
      return { ok: true, nextState: 'quick_mode_plan_required', nextResource: quickResource, reason: 'quick_mode_plan_missing' };
    }

    const quickSetupPlan = await checkGatedOutput(readArtifact, path.join('setup', 'setup-plan.json'), value=>setupPlanRule(value,projectDir), { validate: !completionReportPresent });
    const quickSetupRequirements = await checkGatedOutput(readArtifact, path.join('setup', 'setup-requirements.json'), validateSetupRequirementsShape, { validate: !completionReportPresent });
    if (!quickSetupPlan.present || !quickSetupRequirements.present) {
      return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'quick_mode_setup_plan_missing' };
    }
    if (quickSetupPlan.errors) return invalidOutputRoute('setup_plan_invalid', 'resources/rp-setup-discovery/', quickSetupPlan.errors, outputCtx('setup/setup-plan.json'));
    if (quickSetupRequirements.errors) return invalidOutputRoute('setup_requirements_invalid', 'resources/rp-setup-discovery/', quickSetupRequirements.errors, outputCtx('setup/setup-requirements.json'));

    const quickManifest = await checkGatedOutput(readArtifact, path.join('execution', 'execution-manifest.json'), validateQuickExecutionManifest, { validate: !completionReportPresent });
    if (!quickManifest.present) {
      return { ok: true, nextState: 'quick_mode_plan_required', nextResource: quickResource, reason: 'quick_mode_execution_manifest_missing' };
    }
    if (quickManifest.errors) return invalidOutputRoute('execution_manifest_invalid', quickResource, quickManifest.errors, outputCtx('execution/execution-manifest.json', 'quick_mode_plan_required'));

    if (executionRejected) return executionRejectedRoute;
    { const regional = await regionalRoute(projectDir); if (regional) return regional; }
    if (!isOneClick && approvals.execution && approvals.execution.status === 'pending') {
      return { ok: true, nextState: 'awaiting_execution_approval', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_pending' };
    }
    if (!completionReportPresent) { const mute = await muteMismatchRoute(readArtifact, notificationMute); if (mute) return mute; }
    if (!(await isSetupVerified(projectDir, readArtifact))) {
      return { ok: true, nextState: 'executing_setup', nextResource: 'resources/rp-execute-setup/', reason: 'missing_setup_verification' };
    }
    if (!completionReportPresent) {
      // A capacity blocker is a durable stop. The operator frees
      // categories (or stops); the re-run import rewrites this file as `passed`.
      const capacity = await readJson(path.join(projectDir, 'quick-mode', 'category-capacity.json'));
      if (capacity && capacity.status === 'blocked') {
        return {
          ok: true,
          nextState: 'blocked',
          nextResource: quickResource,
          reason: 'quick_mode_category_capacity_blocked',
          errors: [{ existingCount: capacity.existingCount, toCreate: capacity.toCreate, max: capacity.max }],
          choices: ['free_destination_categories_and_retry', 'stop'],
        };
      }
      return {
        ok: true,
        nextState: 'executing_import',
        nextResource: quickResource,
        reason: 'quick_mode_import_required',
        ...(await importProgressFields(projectDir, { quickPlatform: sourcePlatform })),
      };
    }
    // An operator-requested re-check of written-unverified products.
    // Without a request a partial report never loops back; once the receipt matches the request
    // it never fires again. A staged result for the request keeps the route alive even when the
    // completion report already shows an empty list (a crash between the report and the receipt).
    if (sourcePlatform === 'shopify') {
      const request = await readJson(path.join(projectDir, 'quick-mode', 'reverify-request.json'));
      if (request && request.requestId) {
        const receipt = await readJson(path.join(projectDir, 'quick-mode', 'reverification.json'));
        if (!receipt || receipt.requestId !== request.requestId) {
          const completion = await readJson(path.join(projectDir, 'execution', 'completion-report.json'));
          const listed = completion && completion.writtenUnverified && Array.isArray(completion.writtenUnverified.product) && completion.writtenUnverified.product.length > 0;
          const staged = await readJson(path.join(projectDir, 'quick-mode', 'reverification-staged.json'));
          if (listed || (staged && staged.requestId === request.requestId)) {
            return { ok: true, nextState: 'quick_mode_reverification_required', nextResource: quickResource, reason: 'quick_mode_written_unverified_reverify_requested' };
          }
        }
      }
    }
  }

  const validateOutputs = reviewOnly || !completionReportPresent;
  if (managementImportMode !== 'quick') {
    const sourceSchema = await checkGatedOutput(readArtifact, 'source-schema.json', validateSourceSchemaShape, { validate: validateOutputs });
    if (!sourceSchema.present) {
      return { ok: true, nextState: 'discovery_running', nextResource: 'resources/rp-discovery/', reason: 'missing_source_schema' };
    }
    if (sourceSchema.errors) return invalidOutputRoute('source_schema_invalid', 'resources/rp-discovery/', sourceSchema.errors, outputCtx('source-schema.json'));
    // Discovery promoted under the coverage contract must also have promoted the store's regional
    // settings; without them nothing can compare the destination's currency with the source's.
    if (await exists(path.join(projectDir, 'discovery', 'source-coverage.json')) && !(await exists(path.join(projectDir, 'discovery', 'source-locale.json')))) {
      return { ok: true, nextState: 'discovery_running', nextResource: 'resources/rp-discovery/', reason: 'source_regional_missing' };
    }
  }

  // CMS-fallback freshness chain (plugin coverage -> mapping plan -> setup plan). A plan built
  // before a CMS-fallback answer, a register change, or any change to what could resolve the
  // capability natively (target knowledge, the detected plugin's current profile, the other
  // signed registers) is treated as missing. Coverage and mapping are checked here, before the
  // mapping-plan, source-coverage and mapping-approval gates; the setup plan right after the
  // mapping approval (setup discovery requires an accepted mapping) and before every
  // setup/import step. Neither check is skipped for one-click runs.
  const freshness = managementImportMode !== 'quick'
    ? checkCmsFallbackFreshness(projectDir, {
      decisions,
      pluginsRoot: options.pluginsRoot,
      targetKnowledgeRoot: options.targetKnowledgeRoot,
    })
    : null;
  if (freshness && freshness.stale === 'coverage') {
    return { ok: true, nextState: 'discovery_running', nextResource: 'resources/rp-discovery/', reason: 'cms_fallback_inputs_changed' };
  }
  if (freshness && freshness.stale === 'mapping') {
    return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'mapping_plan_stale_cms_fallback' };
  }

  if (managementImportMode !== 'quick') {
    const mappingPlan = await checkGatedOutput(readArtifact, path.join('mapping', 'mapping-plan.json'), validateMappingPlanShape, { validate: validateOutputs });
    if (!mappingPlan.present) {
      return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'missing_mapping_plan' };
    }
    if (mappingPlan.errors) return invalidOutputRoute('mapping_plan_invalid', 'resources/rp-mapper/', mappingPlan.errors, outputCtx('mapping/mapping-plan.json'));
    if (reviewOnly) {
      const gaps = await readArtifact('mapping/review/mapping-gaps.json');
      if (gaps.present && (gaps.parseError || !gaps.value || typeof gaps.value !== 'object')) return invalidOutputRoute('mapping_plan_invalid', 'resources/rp-mapper/', ['mapping/review/mapping-gaps.json is invalid']);
    }

    // A rejected mapping returns to the mapper, which writes a new plan version
    // and resets mapping approval to pending. One-click does not skip a recorded rejection.
    if (approvals.mapping && approvals.mapping.status === 'rejected') {
      return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_rejected' };
    }
    // Before any mapping review or approval: an in-use entity left pending without a typed
    // reason goes back to the mapper in every mode, whatever approval or answer is recorded.
    // After the bounded refused passes it is a typed blocker naming the entities.
    if (!reviewOnly) {
      const { mappingCompleteness, recordMappingHandBack, clearMappingPasses, MAPPING_COMPLETION_PASSES } = require('./mapping-field-contract.js');
      const planValue = (await readArtifact(path.join('mapping', 'mapping-plan.json'))).value;
      let completeness = mappingCompleteness(projectDir, planValue);
      // Each hand-back is a counted pass; a status display (observeOnly) never counts one.
      if (!completeness.ok && !completeness.exhausted && !options.observeOnly) {
        recordMappingHandBack(projectDir, planValue, completeness.unmapped);
        completeness = mappingCompleteness(projectDir, planValue);
      } else if (completeness.ok && !options.observeOnly) clearMappingPasses(projectDir);
      // The passes ran out: the entities are settled (not imported, reported as cutover items) and
      // the run continues. A status display only shows the stop; it writes nothing.
      if (!completeness.ok && completeness.exhausted && !options.observeOnly) {
        require('./route-settlement').settleRoute(projectDir, { nextState: 'mapping_running', reason: 'mapping_incomplete', unmappedEntities: completeness.unmapped });
        completeness = mappingCompleteness(projectDir, planValue);
        if (completeness.ok) clearMappingPasses(projectDir);
      }
      if (!completeness.ok && completeness.exhausted) {
        return { ok: true, nextState: 'blocked', nextResource: null, blocking: true, reason: 'mapping_incomplete',
          blocker: { type: 'mapping_incomplete', artifact: 'mapping/mapping-plan.json', entities: completeness.unmapped, passes: completeness.passes,
            requiredInput: `Mapping did not converge after ${MAPPING_COMPLETION_PASSES} passes. Map each named in-use entity (native, extended field, then CMS) or record a typed limitation on its row, then approve the mapping again.` } };
      }
      if (!completeness.ok) {
        return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'mapping_incomplete', unmappedEntities: completeness.unmapped, passes: completeness.passes };
      }
      // Mapping never leaves its stage (and one-click never records its approval) while the
      // read-back check fails for an entity whose builder it has measured. Same verdict as
      // `read-back-gate.js validate`; only the missing named approval may remain.
      const readBack = await require('./read-back-validate').readBackFailures(projectDir);
      if (readBack.length) {
        return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'read_back_invalid', entities: readBack };
      }
    }
  }

  if (managementImportMode !== 'quick') {
    const bound = await mappingApprovalBound(projectDir, approvals.mapping);
    const coverageGate = bound ? await sourceCoverageGate(projectDir) : await reconcileSourceCoverageForMapping(projectDir, { mappingStatus: 'approved' });
    const coverageFailures = coverageGate.ok ? [] : require('./route-settlement').unsettledErrors(projectDir, 'source-coverage', coverageGate.failures);
    if (coverageFailures.length) {
      return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'source_coverage_unreconciled', errors: coverageFailures };
    }
  }

  if (managementImportMode !== 'quick') {
    const reconciliation = await readReconciliation(projectDir);
    const route = (reason, detail = {}) => ({ ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason, ...detail });
    if (!reconciliation) return route('census_reconciliation_missing');
    const freshness = await censusReconciliationFreshness(projectDir, reconciliation);
    if (!freshness.ok) return route('census_reconciliation_stale', { staleInputs: freshness.staleInputs });
    const censusErrors = require('./route-settlement').unsettledErrors(projectDir, 'census', reconciliation.errors);
    if (censusErrors?.length) return route('census_reconciliation_blocking', { errors: censusErrors });
    if (['approved','provisional'].includes(approvals.mapping?.status)) {
      const ref = approvals.mapping.artifactRefs?.find(ref => ref && typeof ref === 'object' && ref.kind === 'census-reconciliation' && ref.path === 'mapping/review/census-reconciliation.json' && /^[0-9a-f]{64}$/i.test(ref.sha256 || ''));
      if (!ref) return route('mapping_approval_missing_census');
      if (!(await mappingApprovalBound(projectDir, approvals.mapping))) return route('mapping_approval_stale_census');
    }
  }

  if (managementImportMode !== 'quick' && approvals.mapping && approvals.mapping.status === 'pending') {
    if (!isOneClick) return { ok: true, nextState: 'awaiting_mapping_approval', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_pending' };
    // One-click: the stage entry records this approval through the same binding, so a refusal
    // keeps mapping open instead of routing past an approval that can never be recorded.
    const refused = await oneClickMappingRefusal(projectDir);
    if (refused) return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_refused', ...refused };
  }

  if (managementImportMode !== 'quick') {
    const proposedPlan=await readJson(path.join(projectDir,'mapping/mapping-plan.json'));
    if (proposedPlan?.fieldContractVersion===1 && require('./mapping-omission-approval').candidates(proposedPlan).length) {
      try {require('./mapping-omission-approval').assertAuthorized(projectDir,proposedPlan);}
      catch {return {ok:true,nextState:'mapping_running',nextResource:'resources/rp-mapper/',reason:'mapping_omission_approval_missing_or_stale',requiredArtifacts:['orchestration/approvals.json','mapping/mapping-plan.json']};}
    }
  }

  if (freshness && freshness.stale === 'setup') {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'setup_plan_stale_cms_fallback' };
  }

  const setupPlan = await checkGatedOutput(readArtifact, path.join('setup', 'setup-plan.json'), value=>setupPlanRule(value,projectDir), { validate: validateOutputs });
  if (!setupPlan.present) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_plan' };
  }
  if (setupPlan.errors) return invalidOutputRoute('setup_plan_invalid', 'resources/rp-setup-discovery/', setupPlan.errors, outputCtx('setup/setup-plan.json'));

  const setupRequirements = await checkGatedOutput(readArtifact, path.join('setup', 'setup-requirements.json'), validateSetupRequirementsShape, { validate: validateOutputs });
  if (!setupRequirements.present) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_requirements' };
  }
  if (setupRequirements.errors) return invalidOutputRoute('setup_requirements_invalid', 'resources/rp-setup-discovery/', setupRequirements.errors, outputCtx('setup/setup-requirements.json'));

  // The mapping plan is the authority for every downstream plan.  A stale setup plan or
  // execution manifest must be regenerated in pipeline order before setup/import writes.
  if (resumableCompletionReport) {
    const staleMappingArtifact = await staleMappingBoundArtifactRoute(projectDir, readArtifact, {
      allowLegacyUnboundSetup: notificationMute.source === 'legacy_config',
    });
    if (staleMappingArtifact) return staleMappingArtifact;
  }

  if (requiresWebsiteContinuation(decisions) && deliveryMode === 'management_and_website' && !websiteScope && !isOneClick) {
    return { ok: true, nextState: 'awaiting_website_scope', nextResource: 'resources/rp-project-intake/', reason: 'missing_website_scope' };
  }

  if (requiresWebsiteContinuation(decisions)) {
    const handoffStatus = await validateWebsiteHandoff(projectDir);
    if (!handoffStatus.present) {
      return {
        ok: true,
        nextState: 'website_handoff_running',
        nextResource: 'resources/rp-website-continuation/',
        reason: 'missing_website_handoff',
      };
    }
    if (handoffStatus.stale) {
      return {
        ok: true,
        nextState: 'website_handoff_running',
        nextResource: 'resources/rp-website-continuation/',
        reason: 'stale_website_handoff',
        changes: handoffStatus.changes,
      };
    }

    if (!handoffStatus.ok) {
      return {
        ok: true,
        nextState: 'mapping_running',
        nextResource: 'resources/rp-mapper/',
        reason: 'invalid_website_handoff',
        errors: handoffStatus.blockingWarnings,
      };
    }
  }

  if (managementImportMode !== 'quick') {
    const manifest = await checkGatedOutput(readArtifact, path.join('execution', 'execution-manifest.json'), validateManifest, { validate: validateOutputs });
    if (!manifest.present) {
      return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'missing_execution_manifest' };
    }
    if (manifest.errors) return invalidOutputRoute('execution_manifest_invalid', 'resources/rp-import-codegen/', manifest.errors, outputCtx('execution/execution-manifest.json'));
    // The read-back check runs here, where the builders exist (codegen scaffold), for every plan
    // row that writes a product, contact, order or member: the toolkit builds each inventory and
    // validates it. Not checked is never passed: codegen stays open until every unit passes.
    if (!completionReportPresent) {
      // The source archive is fully planned by the toolkit: its task joins codegen's manifest here.
      await require('./codegen-scaffold').addSourceArchiveTask(projectDir);
      const readBack = await require('./read-back-validate').ensureReadBack(projectDir);
      if (readBack.length) return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'read_back_invalid', entities: readBack };
    }
  }

  // Sample-preview sub-gate: codegen emits the extractor, runs it in sample
  // mode, and records the user's validation in preview/preview-result.json.
  // Routing back into codegen while that is missing or pending is what enforces
  // the gate — the artifact is stage-local, so no orchestration phase or
  // schema change is involved. Projects that do not use the gate simply never
  // create the file and are unaffected.
  const previewResult = await readJson(path.join(projectDir, 'preview', 'preview-result.json'));
  if (managementImportMode !== 'quick' && previewResult && previewResult.status === 'pending') {
    return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'sample_preview_pending' };
  }

  if (executionRejected) return executionRejectedRoute;
  { const regional = await regionalRoute(projectDir); if (regional) return regional; }
  if (!isOneClick && approvals.execution && approvals.execution.status === 'pending') {
    return { ok: true, nextState: 'awaiting_execution_approval', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_pending' };
  }

  if (!completionReportPresent) { const mute = await muteMismatchRoute(readArtifact, notificationMute); if (mute) return mute; }
  if (!(await isSetupVerified(projectDir, readArtifact))) {
    return { ok: true, nextState: 'executing_setup', nextResource: 'resources/rp-execute-setup/', reason: 'missing_setup_verification' };
  }

  // A stopped run, or a pre-approval report with unexpected skips, is not completion: route the
  // same journal/crosswalk-backed import again, never finalizing the unattempted records.
  const interruptedReport = Boolean(completionReport?.interruption);
  if (!completionReportPresent || interruptedReport || unexpectedSkipResume) {
    const progress = await importProgressFields(projectDir);
    return {
      ok: true,
      nextState: 'executing_import',
      nextResource: 'resources/rp-execute-import/',
      reason: unexpectedSkipResume ? 'unexpected_skips_after_mapping_change'
        : interruptedReport ? 'import_interrupted' : 'missing_completion_report',
      ...(unexpectedSkipResume ? { resumeSameImport: true } : {}),
      ...progress,
      // A run killed before it could record its stop: write the aborted report from the journal
      // (scripts/interrupted-completion-report.js) so cutover sees the pause, then resume.
      ...(!completionReportPresent && progress.importProgress === 'interrupted' ? { interruptedReport: 'missing' } : {}),
    };
  }

  const completionInputs = await loadMigrationCompletionInputs(projectDir);
  // An Editor destination has no automatic frontend continuation: its backend import completes
  // the run and the website stays open as cutover tasks; never route into the Headless clone.
  const completionMode = getCompletionDeliveryMode(decisions);
  if (completionMode === 'management_and_website') {
    const frontend = validateFrontendCompletion(completionInputs.frontendCompletion, completionInputs.handoff);
    if (!frontend.ok) {
      return {
        ok: frontend.reason !== 'frontend_blocked',
        nextState: frontend.reason === 'frontend_blocked' ? 'blocked' : 'storefront_running',
        nextResource: 'resources/rp-website-continuation/',
        reason: frontend.reason,
        requiredArtifacts: ['website/handoff.json', 'website/completion.json'],
        blocking: frontend.reason === 'frontend_blocked',
      };
    }
  }

  const mappingPlan=await readJson(path.join(projectDir,'mapping/mapping-plan.json'));
  if (mappingPlan?.fieldContractVersion===1 && mappingPlan.executionScope?.deferredEntities?.length) {
    const {digest,canonical,deferredRunResult}=require('./mapping-field-contract.js');
    const report=completionInputs.backendCompletion,summary=completionInputs.postExecutionHandoff?.mappingSummary;
    // Finish the existing reports before stopping; never declare a partial scope complete.
    const retained=report?.mappingPlanDigest===digest(mappingPlan) &&
      canonical(report.executionScope)===canonical(mappingPlan.executionScope) &&
      summary?.mappingPlanDigest===digest(mappingPlan) &&
      canonical(summary.executionScope)===canonical(mappingPlan.executionScope) &&
      completionInputs.executionLogPresent && completionInputs.postExecutionHandoff.lastWriteAt===report.lastWriteAt;
    // A missing or stale report never stops a user run, and one-click never asks: regenerate it at
    // once (the same route an answered `fix-and-regenerate` takes). Still stale after the pass limit,
    // the run controller settles it (lib/route-settlement.js: a toolkit gap and an Import Operator
    // cutover task) and the run goes on to the ordinary completion gate. The router counts the
    // passes (the controller's same-route count resets when a regenerate turn writes progress).
    if (!retained) { const route = boundedMappingDeferralRegenerate(projectDir, options); if (route) return route; }
    // Mixed scopes have already retained their mapping evidence; resolved entities
    // continue through the ordinary completion gate. When every selected entity is
    // deferred, no importer can start, so every run mode retains a typed blocker.
    const deferred=deferredRunResult(mappingPlan);
    if (deferred) return {ok:true,nextState:'blocked',nextResource:null,reason:'mapping_scope_deferred',blocking:true,blocker:deferred.blocker};
  }
  const aggregate = validateMigrationCompletion(completionInputs.completion, {
    deliveryMode: completionMode,
    backendCompletion: completionInputs.backendCompletion,
    frontendCompletion: completionInputs.frontendCompletion,
    handoff: completionInputs.handoff,
    // The post-execution handoff and the execution log are part of what "finished" means.
    // This is NOT a new router gate -- it is the existing `validateMigrationCompletion` gate
    // being handed the inputs it now judges on. A gate given half its inputs passes on the half
    // it was given, which is how three required artifacts came to have no writer.
    postExecutionHandoff: completionInputs.postExecutionHandoff,
    executionLogPresent: completionInputs.executionLogPresent,
    // Same pattern again -- the entity-QA attestation gate, and the independent
    // mapped-entity coverage source it is judged against, are more inputs to this same existing
    // call, not a new router branch.
    entityQaAttestation: completionInputs.entityQaAttestation,
    mappedEntities: completionInputs.mappedEntities,
    reportDigest: completionInputs.reportDigest,
    discoveredSetStatus: completionInputs.discoveredSetStatus,
    discoveredSetFreshness: completionInputs.discoveredSetFreshness,
    discoveredSetDigest: completionInputs.discoveredSetDigest,
    completionDiscoveredInputs: completionInputs.completionDiscoveredInputs,
    resolutionsPrefixValid: completionInputs.resolutionsPrefixValid,
  });
  if (!aggregate.ok) {
    return {
      ok: true,
      nextState: 'finalizing',
      nextResource: 'resources/rp-execution-policy/',
      reason: aggregate.reason,
      requiredArtifacts: ['completion/migration-completion.json'],
      blocking: false,
      ...(aggregate.entityQa ? { entityQa: aggregate.entityQa } : {}),
    };
  }

  // A verified historical run is being refinalized locally, not republished to Wix.
  // Its aggregate checks above still apply; do not introduce a target-write stage.
  if (reviewOnly) return {ok:true,nextState:'completed',nextResource:null,reason:'migration_completion_present'};
  let migrationReview = null;
  try {
    migrationReview = await readMigrationReview(projectDir);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      return {
        ok: false,
        nextState: 'failed',
        nextResource: 'resources/rp-migration-review/',
        reason: error.code || 'invalid_migration_review',
        errors: [{ message: error.message }],
      };
    }
  }
  if (!migrationReview || !migrationReview.evidenceRevision) {
    return { ok: true, nextState: 'migration_review_running', nextResource: 'resources/rp-migration-review/', reason: 'migration_review_missing' };
  }
  const completionReportDigest = hashArtifact(projectDir, path.join('execution', 'completion-report.json'));
  if (!completionReportDigest || migrationReview.completionReportDigest !== completionReportDigest) {
    return { ok: true, nextState: 'migration_review_running', nextResource: 'resources/rp-migration-review/', reason: 'migration_review_stale' };
  }
  const reviewHandoff = await readLatestHandoff(projectDir);
  if (!reviewHandoff || reviewHandoff.evidenceRevision !== migrationReview.evidenceRevision || reviewHandoff.committedStateVersion !== migrationReview.stateVersion) {
    return { ok: true, nextState: 'migration_review_running', nextResource: 'resources/rp-migration-review/', reason: 'migration_review_handoff_missing_or_stale' };
  }

  return { ok: true, nextState: 'completed', nextResource: null, reason: 'migration_completion_present' };
}

const REVIEW_ONLY_MAPPING_REASONS = new Set(['mapping_approval_rejected', 'census_reconciliation_missing', 'census_reconciliation_stale', 'census_reconciliation_blocking', 'mapping_approval_missing_census', 'mapping_approval_stale_census']);
function applyReviewOnlyRoute(result) {
  const hold = (reason, detail = {}) => ({ ...result, ok: true, nextState: 'blocked', nextResource: null, reason, blocking: true, reviewOnly: true, ...detail });
  if (['missing_source_schema','source_schema_invalid','missing_mapping_plan','mapping_plan_invalid'].includes(result.reason)) return hold('review_only_input_unavailable', { errors: result.errors || [result.reason] });
  if (result.reason === 'source_coverage_unreconciled') return hold('review_only_source_coverage_unreconciled');
  if (REVIEW_ONLY_MAPPING_REASONS.has(result.reason) || result.reason === 'mapping_approval_pending' || ['finalizing','completed'].includes(result.nextState)) return { ...result, reviewOnly: true };
  return hold('review_only_unexpected_route', { wouldRoute: result.reason });
}
async function determineNextStepForMode(projectDir, artifacts, options, validation) {
  // Classification must precede every resource-bearing route, including intake and quick mode.
  if (!validation.ok || ['cancel_requested','canceled','interrupted','blocked'].includes(artifacts.run.status)) return determineNextStepUnfiltered(projectDir, artifacts, options);
  const finalized = await classifyFinalizedRun(projectDir, { decisions: artifacts.decisions || {} });
  if (finalized.kind === 'unverified-v1') return { ok: true, nextState: 'blocked', nextResource: null, reason: 'finalized_receipt_unverified', errors: finalized.errors, reviewOnly: true, blocking: true };
  // Keep the closed review-only route after v1 is archived and replaced by v2.
  // Checking only the current receipt would dispatch publication on the next resume.
  const archived = finalized.kind === 'current' ? await classifyFinalizedRun(projectDir, {
    decisions: artifacts.decisions || {}, receiptFile:'completion/migration-completion.v1.json'
  }) : null;
  if (archived?.kind === 'unverified-v1') return {ok:true,nextState:'blocked',nextResource:null,reason:'finalized_receipt_unverified',errors:archived.errors,reviewOnly:true,blocking:true};
  const reviewOnly = finalized.kind === 'valid-v1' || archived?.kind === 'valid-v1';
  const result = await determineNextStepUnfiltered(projectDir, artifacts, { ...options, reviewOnly });
  // A finalized review-only run must never dispatch destination work. Standard runs
  // still require master's fresh Editor publication readback before downstream work.
  return reviewOnly ? applyReviewOnlyRoute(result) : publicationRecheckGate(projectDir, result, options);
}

// A dry-run uses the normal report writer so its counters and gaps remain inspectable. That
// report is not backend accounting, though: the matching live-import summary is the durable
// marker that this run only prepared requests. Do not let it suppress the real import route.
async function liveCompletionReportPresent(projectDir) {
  const report = await readJson(path.join(projectDir, 'execution', 'completion-report.json'));
  if (!report) return false;
  const summary = await readJson(path.join(projectDir, 'execution', 'live-import-summary.json'));
  return !(summary && summary.runId === report.runId && summary.dryRun === true);
}

async function determineNextStep(projectDir, artifacts, options = {}) {
  const validation = validateArtifacts(artifacts);
  const result = await determineNextStepForMode(projectDir, artifacts, options, validation);
  // Preserve master's CMS-decision quarantine diagnostics on every route, including holds.
  return validation.quarantined?.length
    ? { ...result, validation: { quarantined: validation.quarantined } }
    : result;
}

module.exports = {
  applyReviewOnlyRoute,
  determineNextStep,
  validateMappingPlanShape,
  validateSourceSchemaShape,
};
