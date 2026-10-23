'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDecisionValue, isExplicitUserOneClick } = require('./orchestration-decisions.js');
const { ensureLedger } = require('./expectations-ledger.js');
const cmsFallback = require('./plugin-cms-fallback.js');

const SCHEMA_VERSION = 1;

const RUN_STATUS = new Set(['running', 'completed', 'partial', 'blocked', 'failed', 'cancel_requested', 'canceled', 'interrupted']);
const ACTIVE_PHASE = new Set(['orchestration', 'discovery', 'mapping', 'setup', 'codegen', 'execution']);
const ORCHESTRATION_STATES = new Set([
  'initialized',
  'awaiting_source',
  'awaiting_import_scope',
  'awaiting_credentials',
  'awaiting_files',
  'awaiting_destination_strategy',
  'destination_running',
  'preflight_running',
  'preflight_blocked',
  'quick_mode_adapter_resolution_required',
  'quick_mode_preflight_required',
  'quick_mode_plan_required',
  'quick_mode_reverification_required',
  'discovery_running',
  'discovery_complete',
  'mapping_running',
  'awaiting_mapping_approval',
  'mapping_approved',
  'setup_discovery_running',
  'awaiting_website_scope',
  'website_handoff_running',
  'setup_complete',
  'codegen_running',
  'awaiting_execution_approval',
  'execution_approved',
  'executing_setup',
  'executing_import',
  'storefront_running',
  'finalizing',
  'completed',
  'partial',
  'blocked',
  'failed',
  'cancel_requested',
  'canceled',
  'interrupted',
]);
const PHASE_STATUS = new Set(['not_started', 'running', 'complete', 'partial', 'blocked', 'failed']);
const EXECUTION_ITEM_STATUS = new Set(['not_started', 'running', 'complete', 'partial', 'blocked', 'failed', 'skipped']);
const APPROVAL_STATUS = new Set(['pending', 'approved', 'rejected', 'provisional']);
const APPROVAL_ACTOR = new Set(['user', 'system', 'agent', null]);
// `context` and `not_asked` are the business-type sources; other keys keep using the first three.
const DECISION_SOURCE = new Set(['user', 'deterministic_inference', 'prior_artifact', 'context', 'not_asked']);

function nowIso(date = new Date()) {
  return date.toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function orchestrationDir(projectDir) {
  return path.join(projectDir, 'orchestration');
}

function phaseStatusTemplate(timestamp) {
  return {
    status: 'not_started',
    lastCompletedStep: null,
    artifactRefs: [],
    updatedAt: timestamp,
  };
}

function executionStatusTemplate(timestamp) {
  return {
    ...phaseStatusTemplate(timestamp),
    setupStatus: 'not_started',
    importStatus: 'not_started',
    lastCheckpointId: null,
  };
}

function createRun(projectId, timestamp = nowIso()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    status: 'running',
    currentState: 'initialized',
    activePhase: 'orchestration',
    startedAt: timestamp,
    updatedAt: timestamp,
    sourcePlatform: null,
    sourceMode: null,
    resumeFrom: null,
    needsUserInput: false,
    needsLlm: false,
    lastEventId: null,
  };
}

function createCheckpoints(timestamp = nowIso()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    discovery: phaseStatusTemplate(timestamp),
    mapping: phaseStatusTemplate(timestamp),
    setup: phaseStatusTemplate(timestamp),
    codegen: phaseStatusTemplate(timestamp),
    execution: executionStatusTemplate(timestamp),
  };
}

function createApprovals() {
  return {
    schemaVersion: SCHEMA_VERSION,
    mapping: {
      status: 'pending',
      decidedAt: null,
      artifactRefs: [],
      notes: null,
      decidedBy: null,
    },
    execution: {
      status: 'pending',
      decidedAt: null,
      artifactRefs: [],
      notes: null,
      decidedBy: null,
    },
  };
}

function createDecisions() {
  return {
    schemaVersion: SCHEMA_VERSION,
  };
}

function createPreflight(timestamp = nowIso()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'not_started',
    updatedAt: timestamp,
    checks: [],
  };
}

async function mkdirp(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath, data) {
  const dirPath = path.dirname(filePath);
  await mkdirp(dirPath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function maybeReadJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function reasonRef(code, message, artifactRefs = []) {
  return { code, message, artifactRefs };
}

function pushError(errors, code, message) {
  errors.push(reasonRef(code, message));
}

function requireSetMember(errors, code, value, allowed, label) {
  if (!allowed.has(value)) {
    pushError(errors, code, `${label} must be one of: ${Array.from(allowed).join(', ')} (got: ${value})`);
  }
}

function isAwaitingState(state) {
  return typeof state === 'string' && state.startsWith('awaiting_');
}

function validateRun(run, errors) {
  if (!run || typeof run !== 'object') {
    pushError(errors, 'run_missing', 'run.json is missing or not an object');
    return;
  }
  if (run.schemaVersion !== SCHEMA_VERSION) {
    pushError(errors, 'run_schema_version', `run.json schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!run.projectId || typeof run.projectId !== 'string') {
    pushError(errors, 'run_project_id', 'run.json projectId must be a non-empty string');
  }
  requireSetMember(errors, 'run_status', run.status, RUN_STATUS, 'run.json status');
  requireSetMember(errors, 'run_current_state', run.currentState, ORCHESTRATION_STATES, 'run.json currentState');
  requireSetMember(errors, 'run_active_phase', run.activePhase, ACTIVE_PHASE, 'run.json activePhase');
  if (run.resumeFrom !== null && typeof run.resumeFrom !== 'object') {
    pushError(errors, 'run_resume_from', 'run.json resumeFrom must be null or a reasonRef object');
  }
  if ((isAwaitingState(run.currentState) || run.currentState === 'blocked') && run.needsUserInput !== true) {
    pushError(errors, 'run_needs_user_input', 'needsUserInput must be true for awaiting_* and blocked states');
  }
  if (['cancel_requested', 'canceled', 'interrupted'].includes(run.currentState) &&
      !['cancel_requested', 'canceled', 'interrupted'].includes(run.status)) {
    pushError(errors, 'run_cancellation_status', `${run.currentState} requires matching cancellation status`);
  }
}

function validateCheckpoints(checkpoints, errors) {
  if (!checkpoints || typeof checkpoints !== 'object') {
    pushError(errors, 'checkpoints_missing', 'checkpoints.json is missing or not an object');
    return;
  }
  if (checkpoints.schemaVersion !== SCHEMA_VERSION) {
    pushError(errors, 'checkpoints_schema_version', `checkpoints.json schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const phase of ['discovery', 'mapping', 'setup', 'codegen']) {
    const item = checkpoints[phase];
    if (!item || typeof item !== 'object') {
      pushError(errors, `checkpoint_${phase}_missing`, `${phase} checkpoint is missing`);
      continue;
    }
    requireSetMember(errors, `checkpoint_${phase}_status`, item.status, PHASE_STATUS, `${phase} checkpoint status`);
    if (!Array.isArray(item.artifactRefs)) {
      pushError(errors, `checkpoint_${phase}_artifact_refs`, `${phase} checkpoint artifactRefs must be an array`);
    }
  }
  const execution = checkpoints.execution;
  if (!execution || typeof execution !== 'object') {
    pushError(errors, 'checkpoint_execution_missing', 'execution checkpoint is missing');
    return;
  }
  requireSetMember(errors, 'checkpoint_execution_status', execution.status, PHASE_STATUS, 'execution checkpoint status');
  requireSetMember(errors, 'checkpoint_execution_setup_status', execution.setupStatus, EXECUTION_ITEM_STATUS, 'execution.setupStatus');
  requireSetMember(errors, 'checkpoint_execution_import_status', execution.importStatus, EXECUTION_ITEM_STATUS, 'execution.importStatus');
}

function validateApprovals(approvals, errors) {
  if (!approvals || typeof approvals !== 'object') {
    pushError(errors, 'approvals_missing', 'approvals.json is missing or not an object');
    return;
  }
  if (approvals.schemaVersion !== SCHEMA_VERSION) {
    pushError(errors, 'approvals_schema_version', `approvals.json schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const approvalType of ['mapping', 'execution']) {
    const item = approvals[approvalType];
    if (!item || typeof item !== 'object') {
      pushError(errors, `approval_${approvalType}_missing`, `${approvalType} approval is missing`);
      continue;
    }
    requireSetMember(errors, `approval_${approvalType}_status`, item.status, APPROVAL_STATUS, `${approvalType} approval status`);
    requireSetMember(errors, `approval_${approvalType}_decided_by`, item.decidedBy, APPROVAL_ACTOR, `${approvalType} approval decidedBy`);
    if (!Array.isArray(item.artifactRefs)) {
      pushError(errors, `approval_${approvalType}_artifact_refs`, `${approvalType} approval artifactRefs must be an array`);
    }
    if (Array.isArray(item.artifactRefs)) {
      for (const ref of item.artifactRefs) {
        if (typeof ref === 'string' && ref.length) continue;
        if (!ref || typeof ref !== 'object' || Array.isArray(ref) || ref.kind !== 'census-reconciliation' || ref.path !== 'mapping/review/census-reconciliation.json' || !/^[0-9a-f]{64}$/i.test(ref.sha256 || '')) {
          pushError(errors, `approval_${approvalType}_artifact_ref_invalid`, `${approvalType} approval contains an invalid artifact reference`);
        }
      }
    }
    if (approvalType === 'execution' && item.status === 'provisional') {
      pushError(errors, 'approval_execution_provisional', 'execution approval must not be provisional');
    }
  }
}

// `quarantined` collects malformed `pluginCmsFallback:*` entries. That one family (exact,
// case-sensitive prefix) is never honored when malformed and never fails the run: the entry
// counts as "no valid answer" everywhere and the capability is asked again at the mapping
// review. Every other key keeps the fail-closed checks below.
function validateDecisions(decisions, errors, quarantined = []) {
  if (!decisions || typeof decisions !== 'object') {
    pushError(errors, 'decisions_missing', 'decisions.json is missing or not an object');
    return;
  }
  if (decisions.schemaVersion !== SCHEMA_VERSION) {
    pushError(errors, 'decisions_schema_version', `decisions.json schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const [key, value] of Object.entries(decisions)) {
    if (key === 'schemaVersion') {
      continue;
    }
    if (cmsFallback.isCmsFallbackDecisionKey(key)) {
      const shape = cmsFallback.cmsFallbackDecisionShape(key, value);
      if (!shape.ok) quarantined.push({ key, problem: shape.problem });
      continue;
    }
    if (!value || typeof value !== 'object') {
      pushError(errors, 'decision_entry_invalid', `decision ${key} must be an object`);
      continue;
    }
    requireSetMember(errors, `decision_${key}_source`, value.source, DECISION_SOURCE, `decision ${key} source`);
  }
}

function isObjectValue(value) {
  return Boolean(value) && typeof value === 'object';
}

// Each check reads only its own sub-object and is skipped when that sub-object is
// missing: the per-file validators already report it (`*_missing`), and reading
// `.status` of a missing entry would throw instead of returning the error list.
function validateCrossArtifactInvariants(artifacts, errors) {
  const { run, checkpoints, approvals } = artifacts;
  if (!run || !checkpoints || !approvals) {
    return;
  }
  const mappingCheckpoint = isObjectValue(checkpoints.mapping) ? checkpoints.mapping : null;
  const mappingApproval = isObjectValue(approvals.mapping) ? approvals.mapping : null;
  const executionApproval = isObjectValue(approvals.execution) ? approvals.execution : null;
  if (run.currentState === 'preflight_running' || run.currentState === 'preflight_blocked' || run.currentState === 'awaiting_destination_strategy' || run.currentState === 'destination_running') {
    if (run.activePhase !== 'orchestration') {
      pushError(errors, 'state_phase_preflight', `${run.currentState} requires activePhase=orchestration`);
    }
  }
  if (run.currentState === 'mapping_running' && mappingCheckpoint && mappingCheckpoint.status === 'not_started') {
    pushError(errors, 'state_mapping_checkpoint', 'mapping_running requires mapping checkpoint status to be started');
  }
  if (run.currentState === 'awaiting_mapping_approval' && mappingApproval && mappingApproval.status !== 'pending') {
    pushError(errors, 'state_mapping_approval_pending', 'awaiting_mapping_approval requires approvals.mapping.status=pending');
  }
  if (run.currentState === 'mapping_approved' && mappingApproval && !['approved', 'provisional'].includes(mappingApproval.status)) {
    pushError(errors, 'state_mapping_approved', 'mapping_approved requires approvals.mapping.status=approved|provisional');
  }
  if (run.currentState === 'awaiting_execution_approval' && executionApproval && executionApproval.status !== 'pending') {
    pushError(errors, 'state_execution_approval_pending', 'awaiting_execution_approval requires approvals.execution.status=pending');
  }
  if (['execution_approved', 'executing_setup', 'executing_import', 'completed'].includes(run.currentState) &&
      executionApproval && executionApproval.status !== 'approved') {
    pushError(errors, 'state_execution_approved', `${run.currentState} requires approvals.execution.status=approved`);
  }
}

function validateArtifacts(artifacts) {
  const errors = [];
  const quarantined = [];
  validateRun(artifacts.run, errors);
  validateCheckpoints(artifacts.checkpoints, errors);
  validateApprovals(artifacts.approvals, errors);
  validateDecisions(artifacts.decisions, errors, quarantined);
  validateCrossArtifactInvariants(artifacts, errors);
  return {
    ok: errors.length === 0,
    errors,
    quarantined,
  };
}

async function appendEvent(projectDir, event) {
  const dirPath = orchestrationDir(projectDir);
  await mkdirp(dirPath);
  const filePath = path.join(dirPath, 'events.jsonl');
  const line = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...event })}\n`;
  await fs.appendFile(filePath, line, 'utf8');
}

async function initArtifacts(projectDir, { projectId = path.basename(projectDir), timestamp = nowIso() } = {}) {
  await ensureLedger(projectDir);
  const dirPath = orchestrationDir(projectDir);
  await mkdirp(dirPath);
  const run = createRun(projectId, timestamp);
  const checkpoints = createCheckpoints(timestamp);
  const decisions = createDecisions();
  const approvals = createApprovals();
  const preflight = createPreflight(timestamp);
  await writeJsonAtomic(path.join(dirPath, 'run.json'), run);
  await writeJsonAtomic(path.join(dirPath, 'checkpoints.json'), checkpoints);
  await writeJsonAtomic(path.join(dirPath, 'decisions.json'), decisions);
  await writeJsonAtomic(path.join(dirPath, 'approvals.json'), approvals);
  await writeJsonAtomic(path.join(dirPath, 'preflight.json'), preflight);
  const eventId = randomId('evt');
  await appendEvent(projectDir, {
    id: eventId,
    timestamp,
    phase: 'orchestration',
    state: 'initialized',
    type: 'orchestration.initialized',
    payload: { projectId },
  });
  run.lastEventId = eventId;
  await writeJsonAtomic(path.join(dirPath, 'run.json'), run);
  return loadArtifacts(projectDir);
}

async function loadArtifacts(projectDir) {
  const dirPath = orchestrationDir(projectDir);
  return {
    run: await maybeReadJson(path.join(dirPath, 'run.json')),
    checkpoints: await maybeReadJson(path.join(dirPath, 'checkpoints.json')),
    decisions: await maybeReadJson(path.join(dirPath, 'decisions.json')),
    approvals: await maybeReadJson(path.join(dirPath, 'approvals.json')),
    preflight: await maybeReadJson(path.join(dirPath, 'preflight.json')),
  };
}

function updateDecisionObject(decisions, key, value, { source = 'user', rationale = null, timestamp = nowIso(), evidenceRef = null } = {}) {
  assertGenericDecisionKey(key);
  if (!DECISION_SOURCE.has(source)) {
    throw new Error(`invalid decision source: ${source}`);
  }
  decisions[key] = {
    value,
    decidedAt: timestamp,
    source,
    rationale,
    ...(evidenceRef ? { evidenceRef } : {}),
  };
  return decisions;
}

function assertGenericDecisionKey(key) {
  if (cmsFallback.isCmsFallbackDecisionKey(key)) {
    throw new Error(`${key} is a CMS-fallback answer and is written only by \`orchestration-state.js decide-cms-fallback\` (it binds the answer to the exact proposal shown); the generic decide command cannot record it`);
  }
}

/**
 * The only writer of `pluginCmsFallback:<capability>`. Reads the proposal from the capability's
 * current plugin-coverage row — the exact text shown at the mapping review — and binds the
 * answer to it. In the same save it resets the mapping approval to pending, so the router
 * regenerates the plan; it never deletes artifacts. Mutates `artifacts` and returns the event
 * to append.
 */
function recordPluginCmsFallbackDecision(artifacts, {
  capability,
  value,
  approvedBy,
  coverageRow,
  registerEntry = undefined,
  pluginsRoot = undefined,
  rationale = null,
  timestamp = nowIso(),
} = {}) {
  if (!artifacts || !artifacts.decisions || !artifacts.approvals) {
    throw new Error('artifacts.decisions and artifacts.approvals are required');
  }
  // One-click/unattended runs never record this answer, approval or decline. Any
  // automationMode that normalizes to one_click blocks it, whatever its source, so the row
  // stays pending with zero CMS writes.
  if (getDecisionValue(artifacts.decisions, 'automationMode') === 'one_click') {
    throw new Error('decide-cms-fallback is not allowed in a one-click/unattended run (automationMode=one_click): the CMS-fallback row stays pending and is reported for cutover');
  }
  if (!capability || typeof capability !== 'string') throw new Error('decide-cms-fallback requires --capability');
  if (!cmsFallback.DECISION_VALUES.has(value)) {
    throw new Error(`decide-cms-fallback --value must be approved or declined (got: ${value})`);
  }
  if (typeof approvedBy !== 'string' || approvedBy.trim().length === 0) {
    throw new Error('decide-cms-fallback requires a non-empty --approved-by naming who answered');
  }
  const row = coverageRow;
  if (!row || row.capability !== capability || !cmsFallback.isEligibleCmsFallbackRow(row)
      || !(row.status === 'pending' || cmsFallback.isApprovedCmsFallbackRow(row))) {
    throw new Error(`no eligible CMS-fallback row for ${capability} in plugin-coverage.json; there is nothing to approve or decline`);
  }
  const entry = registerEntry !== undefined
    ? registerEntry
    : cmsFallback.eligibilityByCapability(cmsFallback.loadCmsFallbackRegisters(pluginsRoot).cmsFallbackEligible).get(capability) || null;
  if (!entry) {
    throw new Error(`${capability} has no signed entry in cms-fallback-eligible.json; rerun reclassification first`);
  }
  const proposal = cmsFallback.proposalFromRow(row);
  const proposalDigest = cmsFallback.cmsFallbackProposalDigest({ capability, ...proposal });
  const currentDigest = cmsFallback.cmsFallbackProposalDigest(entry);
  if (row.cmsFallback.proposalDigest !== currentDigest || proposalDigest !== currentDigest) {
    throw new Error(`plugin-coverage.json is stale for ${capability}: its proposal differs from the current cms-fallback-eligible.json entry; rerun reclassification (wp-discovery.js --reclassify-coverage) and ask again`);
  }
  const key = cmsFallback.decisionKey(capability);
  artifacts.decisions[key] = {
    value,
    decidedAt: timestamp,
    source: 'user',
    rationale: rationale || null,
    approvedBy: approvedBy.trim(),
    proposal,
    proposalDigest,
  };
  if (artifacts.approvals.mapping && artifacts.approvals.mapping.status !== 'pending') {
    updateApprovalObject(artifacts.approvals, 'mapping', 'pending', {
      artifactRefs: artifacts.approvals.mapping.artifactRefs || [],
      notes: `${key} changed`,
      timestamp,
    });
  }
  return {
    key,
    event: {
      id: randomId('evt'),
      timestamp,
      phase: artifacts.run ? artifacts.run.activePhase : 'mapping',
      state: artifacts.run ? artifacts.run.currentState : null,
      type: 'decision.recorded',
      payload: { key, value },
    },
  };
}

function updateApprovalObject(approvals, approvalType, status, { artifactRefs = [], notes = null, decidedBy = 'user', timestamp = nowIso() } = {}) {
  if (!approvals[approvalType]) {
    throw new Error(`unknown approval type: ${approvalType}`);
  }
  if (!APPROVAL_STATUS.has(status)) {
    throw new Error(`invalid approval status: ${status}`);
  }
  if (approvalType === 'execution' && status === 'provisional') {
    throw new Error('execution approval cannot be provisional');
  }
  approvals[approvalType] = {
    status,
    decidedAt: status === 'pending' ? null : timestamp,
    artifactRefs,
    notes,
    decidedBy: status === 'pending' ? null : decidedBy,
  };
  return approvals;
}

function isOneClickArtifacts(artifacts) {
  return isExplicitUserOneClick(artifacts && artifacts.decisions ? artifacts.decisions : {});
}

function autoApproveOneClick(artifacts, approvalType, { artifactRefs = [], notes = null, timestamp = nowIso() } = {}) {
  if (!artifacts || !artifacts.approvals) {
    throw new Error('artifacts.approvals is required');
  }
  const automationMode = getDecisionValue(artifacts.decisions || {}, 'automationMode');
  if (automationMode === 'one_click' && !isOneClickArtifacts(artifacts)) {
    return { ok: false, changed: false, reason: 'automation_mode_not_explicit_user_one_click' };
  }
  if (!isOneClickArtifacts(artifacts)) {
    return { ok: false, changed: false, reason: 'automation_mode_not_one_click' };
  }
  const current = artifacts.approvals[approvalType];
  if (!current) {
    throw new Error(`unknown approval type: ${approvalType}`);
  }
  if (current.status === 'rejected') {
    return { ok: false, changed: false, reason: 'approval_rejected' };
  }
  if (current.status === 'approved') {
    return { ok: true, changed: false, reason: 'already_approved' };
  }
  updateApprovalObject(artifacts.approvals, approvalType, 'approved', {
    artifactRefs,
    notes,
    decidedBy: 'agent',
    timestamp,
  });
  return { ok: true, changed: true, reason: 'auto_approved' };
}

function updateCheckpointObject(checkpoints, phase, patch, timestamp = nowIso()) {
  if (!checkpoints[phase]) {
    throw new Error(`unknown checkpoint phase: ${phase}`);
  }
  checkpoints[phase] = {
    ...checkpoints[phase],
    ...patch,
    updatedAt: timestamp,
  };
  return checkpoints;
}

function transitionRun(run, { state, activePhase, status = run.status, needsUserInput = run.needsUserInput, needsLlm = run.needsLlm, resumeFrom = run.resumeFrom, timestamp = nowIso() }) {
  if (!ORCHESTRATION_STATES.has(state)) {
    throw new Error(`invalid state: ${state}`);
  }
  if (!ACTIVE_PHASE.has(activePhase)) {
    throw new Error(`invalid active phase: ${activePhase}`);
  }
  if (!RUN_STATUS.has(status)) {
    throw new Error(`invalid run status: ${status}`);
  }
  return {
    ...run,
    currentState: state,
    activePhase,
    status,
    needsUserInput,
    needsLlm,
    resumeFrom,
    updatedAt: timestamp,
  };
}

module.exports = {
  SCHEMA_VERSION,
  orchestrationDir,
  nowIso,
  randomId,
  reasonRef,
  createRun,
  createCheckpoints,
  createApprovals,
  createDecisions,
  createPreflight,
  writeJsonAtomic,
  readJson,
  maybeReadJson,
  loadArtifacts,
  initArtifacts,
  validateArtifacts,
  appendEvent,
  updateDecisionObject,
  assertGenericDecisionKey,
  recordPluginCmsFallbackDecision,
  updateApprovalObject,
  autoApproveOneClick,
  isOneClickArtifacts,
  updateCheckpointObject,
  transitionRun,
};
