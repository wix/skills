'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { POST_EXECUTION_HANDOFF_JSON, loadPostExecutionHandoff, readEntityMappings } = require('./website-handoff.js');
const { executionLogExists, EXECUTION_LOG_FILE } = require('./execution-log.js');
const { hashArtifact } = require('./artifact-freshness.js');
const { STATUS_FILE, discoveredSetStatusFreshness, deriveFinalStatus, inputDigests, checkResolutionPrefix } = require('./discovered-set-status.js');
const { ENTITY_QA_ATTESTATION_FILE, validateEntityQaAttestation } = require('./entity-qa-attestation.js');

const COMPLETION_FILE = 'completion/migration-completion.json';
const FRONTEND_COMPLETION_FILE = 'website/completion.json';
const BACKEND_COMPLETION_FILE = 'execution/completion-report.json';
const MAPPING_PLAN_FILE = 'mapping/mapping-plan.json';
const QUICK_MODE_PLAN_FILE = 'quick-mode/plan.json';
const COMPLETE_STATUSES = new Set(['complete', 'complete_with_warnings']);
const BACKEND_COMPLETE_STATUSES = new Set([
  'complete',
  'complete_with_warnings',
  'complete_with_recovered_records',
  'complete_with_deferred_records',
]);

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

// A parse failure on the entity-QA attestation (or on the independent mapped-entity
// source used to judge its coverage) must resolve exactly like a missing file -- never a thrown
// error that aborts finalization checking outright. This mirrors `orchestration-router.js`'s own
// `readJson` helper; it is intentionally NOT `readJsonIfExists` above, whose re-throw-on-parse-
// -failure behavior for every other artifact it already loads is unchanged.
async function readJsonTolerant(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// The independent coverage source `validateEntityQaAttestation` checks attestation coverage
// against -- never the completion report's own (possibly incomplete) `entityCompleteness[]`.
// Full mode: the entity rows of `mapping/mapping-plan.json`, read the same way
// `website-handoff.js`'s `readEntityMappings` already does. Quick mode: the `entities` array of
// `quick-mode/plan.json`, written at plan time before extraction or import ever runs.
async function readMappedEntities(projectDir, managementImportMode) {
  if (managementImportMode === 'quick') {
    const quickPlan = await readJsonTolerant(path.join(projectDir, QUICK_MODE_PLAN_FILE));
    return Array.isArray(quickPlan && quickPlan.entities) ? quickPlan.entities : [];
  }
  const mappingPlan = await readJsonTolerant(path.join(projectDir, MAPPING_PLAN_FILE));
  return readEntityMappings(mappingPlan);
}

// This compatibility receipt test deliberately uses only the original receipt fields.
// Later finalization requirements cannot prove that a legacy run really finished.
async function classifyFinalizedRun(projectDir, { decisions = {} } = {}) {
  const { getDecisionValue } = require('./orchestration-decisions.js');
  const receiptPath = path.join(projectDir, COMPLETION_FILE);
  try { await fs.access(receiptPath); } catch (error) { if (error.code === 'ENOENT') return { kind: 'none', errors: [] }; throw error; }
  const [receipt, report] = await Promise.all([readJsonTolerant(receiptPath), readJsonTolerant(path.join(projectDir, BACKEND_COMPLETION_FILE))]);
  if (receipt?.schemaVersion === 2) return { kind: 'current', errors: [] };
  const quick = getDecisionValue(decisions, 'managementImportMode') === 'quick';
  const reportIsObject = report && typeof report === 'object' && !Array.isArray(report);
  if ((quick && (!reportIsObject || report.managementImportMode !== 'quick')) || (!quick && report?.managementImportMode === 'quick')) return { kind: 'unverified-v1', reason: 'completion_mode_mismatch', errors: ['completion_mode_mismatch'] };
  const errors = [];
  const object = receipt && typeof receipt === 'object' && !Array.isArray(receipt);
  if (!object || receipt.schemaVersion !== 1) errors.push('schemaVersion');
  if (!object || !BACKEND_COMPLETE_STATUSES.has(receipt.status)) errors.push('status');
  if (typeof receipt?.finalizedAt !== 'string' || !Number.isFinite(Date.parse(receipt.finalizedAt))) errors.push('finalizedAt');
  const mode = getDecisionValue(decisions, 'deliveryMode');
  if (!['management','management_and_website'].includes(mode) || receipt?.deliveryMode !== mode) errors.push('deliveryMode');
  if (receipt?.backendCompletion !== BACKEND_COMPLETION_FILE) errors.push('backendCompletion');
  if (mode === 'management_and_website') {
    if (receipt?.frontendCompletion !== FRONTEND_COMPLETION_FILE || typeof receipt?.handoffFingerprint !== 'string' || !receipt.handoffFingerprint.trim()) errors.push('websiteBinding');
  } else if (receipt?.frontendCompletion !== null || receipt?.handoffFingerprint !== null) errors.push('websiteBinding');
  if (!reportIsObject || !BACKEND_COMPLETE_STATUSES.has(report.status) || receipt?.status !== report.status) errors.push('completionReport.status');
  if (report?.lastWriteAt && (!Number.isFinite(Date.parse(report.lastWriteAt)) || Date.parse(receipt?.finalizedAt) <= Date.parse(report.lastWriteAt))) errors.push('completionReport.lastWriteAt');
  if (errors.length) return { kind: 'unverified-v1', reason: quick ? 'quick_receipt_unverified' : 'finalized_receipt_unverified', errors: quick ? ['quick_receipt_unverified', ...errors] : errors };
  return { kind: quick ? 'quick' : 'valid-v1', errors: [] };
}

function validateFrontendCompletion(receipt, handoff, { requireHandoff = true } = {}) {
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, reason: 'frontend_completion_missing' };
  }
  if (receipt.schemaVersion !== 1) {
    return { ok: false, reason: 'frontend_completion_schema_invalid' };
  }
  if (!COMPLETE_STATUSES.has(receipt.status)) {
    return { ok: false, reason: receipt.status === 'blocked' ? 'frontend_blocked' : 'frontend_completion_incomplete', receipt };
  }
  if (requireHandoff && (!handoff || !handoff.handoffFingerprint || receipt.handoffFingerprint !== handoff.handoffFingerprint)) {
    return { ok: false, reason: 'frontend_completion_stale', receipt };
  }
  const gapAnalysis = receipt.gapAnalysis;
  if (!gapAnalysis || gapAnalysis.screenshotReview !== 'complete'
    || gapAnalysis.unresolvedCritical !== 0 || gapAnalysis.unresolvedHigh !== 0) {
    return { ok: false, reason: 'frontend_gap_analysis_incomplete', receipt };
  }
  if (!receipt.release || !['released', 'not_applicable'].includes(receipt.release.status)) {
    return { ok: false, reason: 'frontend_release_incomplete', receipt };
  }
  return { ok: true, receipt };
}

// "done" requires all four artifacts, and a requirement nothing checks is how three
// of them came to have no writer. Both delivery modes now need the post-execution handoff and the
// execution log -- `management` previously required no handoff at all, which is why a
// backend-only run could finalize with no account of the migration anywhere in the project.
function validateCompletionArtifacts({ postExecutionHandoff, executionLogPresent, backendCompletion }) {
  if (!executionLogPresent) {
    return { ok: false, reason: 'missing_execution_log' };
  }
  if (!postExecutionHandoff || typeof postExecutionHandoff !== 'object') {
    return { ok: false, reason: 'missing_post_execution_handoff' };
  }
  const lastWriteAt = backendCompletion && backendCompletion.lastWriteAt;
  if (!lastWriteAt) {
    return { ok: false, reason: 'completion_report_missing_last_write' };
  }
  // The generation timestamp must be later than the run's own last write. A handoff that
  // predates the import is exactly the artifact this check exists to stop.
  if (!postExecutionHandoff.generatedAt || Date.parse(postExecutionHandoff.generatedAt) <= Date.parse(lastWriteAt)) {
    return { ok: false, reason: 'post_execution_handoff_predates_last_write' };
  }
  return { ok: true };
}

function runEntityQaGate({ backendCompletion, entityQaAttestation, mappedEntities, reportDigest }) {
  return validateEntityQaAttestation({
    attestation: entityQaAttestation,
    report: backendCompletion,
    reportDigest,
    mappedEntities,
  });
}

function createMigrationCompletion({
  deliveryMode,
  backendCompletion,
  frontendCompletion = null,
  handoff = null,
  postExecutionHandoff = null,
  executionLogPresent = false,
  entityQaAttestation = null,
  mappedEntities = null,
  reportDigest = null,
  discoveredSetStatus = null, discoveredSetFreshness = null, discoveredSetDigest = null,
}) {
  if (!backendCompletion || typeof backendCompletion !== 'object' || !backendCompletion.status) {
    throw new Error('backend completion report is required');
  }
  if (!BACKEND_COMPLETE_STATUSES.has(backendCompletion.status)) {
    throw new Error(`backend completion is not successful: ${backendCompletion.status}`);
  }
  if (!['management', 'management_and_website'].includes(deliveryMode)) {
    throw new Error('aggregate migration completion requires management or management_and_website deliveryMode');
  }
  const artifacts = validateCompletionArtifacts({ postExecutionHandoff, executionLogPresent, backendCompletion });
  if (!artifacts.ok) throw new Error(`migration cannot complete: ${artifacts.reason}`);
  const quick = backendCompletion.managementImportMode === 'quick';
  if (!quick) {
    if (!discoveredSetStatus) throw Object.assign(new Error('missing_discovered_set_status'), { code: 'missing_discovered_set_status' });
    if (!discoveredSetFreshness?.ok) throw Object.assign(new Error('discovered_set_status_stale'), { code: 'discovered_set_status_stale', staleInputs: discoveredSetFreshness?.staleInputs || [] });
    if (discoveredSetStatus.inputs?.completionReport !== reportDigest) throw Object.assign(new Error('discovered_set_status_stale'), { code: 'discovered_set_status_stale', staleInputs: ['completionReport'] });
    if (!discoveredSetDigest || postExecutionHandoff?.discoveredSet?.sha256 !== discoveredSetDigest) throw Object.assign(new Error('handoff_discovered_set_stale'), { code: 'handoff_discovered_set_stale' });
  }
  const finalStatus = deriveFinalStatus(backendCompletion.status, quick ? null : discoveredSetStatus);
  if (postExecutionHandoff?.status !== finalStatus) throw Object.assign(new Error('handoff_status_mismatch'), { code: 'handoff_status_mismatch' });
  if (deliveryMode === 'management_and_website') {
    const validation = validateFrontendCompletion(frontendCompletion, handoff);
    if (!validation.ok) throw new Error(`website migration cannot complete: ${validation.reason}`);
  }
  // A run is not allowed to finish without a fresh, complete
  // entity-QA attestation. Missing, stale or failed refuses the same as any other
  // artifact gap above -- it is not a new kind of failure, just one more required artifact.
  const entityQa = runEntityQaGate({ backendCompletion, entityQaAttestation, mappedEntities, reportDigest });
  if (!entityQa.ok) throw new Error(`migration cannot complete: ${entityQa.reasons[0]}`);
  return {
    schemaVersion: 2,
    status: finalStatus,
    backendStatus: backendCompletion.status,
    discoveredSet: quick ? null : { path: STATUS_FILE, sha256: discoveredSetDigest, openCount: discoveredSetStatus.openCount, inputs: discoveredSetStatus.inputs },
    deliveryMode,
    backendCompletion: BACKEND_COMPLETION_FILE,
    frontendCompletion: deliveryMode === 'management_and_website' ? FRONTEND_COMPLETION_FILE : null,
    handoffFingerprint: deliveryMode === 'management_and_website' ? handoff.handoffFingerprint : null,
    postExecutionHandoff: POST_EXECUTION_HANDOFF_JSON,
    executionLog: EXECUTION_LOG_FILE,
    // `scope` says what was attested: import rows only. Not business setup, not launch
    // readiness. A hollow attestation that copies the report can still pass; the gate proves
    // freshness and coverage only.
    entityQaAttestation: {
      path: ENTITY_QA_ATTESTATION_FILE,
      completionReportDigest: entityQaAttestation.completionReportDigest,
      verifiedAt: entityQaAttestation.verifiedAt,
      scope: 'import-entity-coverage',
    },
    finalizedAt: new Date().toISOString(),
  };
}

async function loadMigrationCompletionInputs(projectDir) {
  const [backendCompletion, frontendCompletion, handoff, completion, postExecutionHandoff, executionLogPresent, entityQaAttestation] = await Promise.all([
    readJsonIfExists(path.join(projectDir, BACKEND_COMPLETION_FILE)),
    readJsonIfExists(path.join(projectDir, FRONTEND_COMPLETION_FILE)),
    readJsonIfExists(path.join(projectDir, 'website', 'handoff.json')),
    readJsonIfExists(path.join(projectDir, COMPLETION_FILE)),
    loadPostExecutionHandoff(projectDir),
    executionLogExists(projectDir),
    readJsonTolerant(path.join(projectDir, ENTITY_QA_ATTESTATION_FILE)),
  ]);
  const managementImportMode = backendCompletion && backendCompletion.managementImportMode === 'quick' ? 'quick' : 'full';
  const mappedEntities = await readMappedEntities(projectDir, managementImportMode);
  const reportDigest = hashArtifact(projectDir, BACKEND_COMPLETION_FILE);
  const discoveredSetStatus = managementImportMode === 'quick' ? null : await readJsonTolerant(path.join(projectDir, STATUS_FILE));
  const discoveredSetFreshness = discoveredSetStatus ? await discoveredSetStatusFreshness(projectDir, discoveredSetStatus) : null;
  const discoveredSetDigest = discoveredSetStatus ? hashArtifact(projectDir, STATUS_FILE) : null;
  const completionDiscoveredInputs = managementImportMode === 'quick' ? null : await inputDigests(projectDir);
  const resolutionsPrefixValid = completion?.discoveredSet?.inputs?.resolutions ? await checkResolutionPrefix(projectDir, completion.discoveredSet.inputs.resolutions) : false;
  return {
    discoveredSetStatus, discoveredSetFreshness, discoveredSetDigest, completionDiscoveredInputs, resolutionsPrefixValid,
    backendCompletion,
    frontendCompletion,
    handoff,
    completion,
    postExecutionHandoff,
    executionLogPresent,
    entityQaAttestation,
    mappedEntities,
    reportDigest,
  };
}

function validateMigrationCompletion(completion, {
  deliveryMode, backendCompletion, frontendCompletion, handoff, postExecutionHandoff, executionLogPresent,
  entityQaAttestation, mappedEntities, reportDigest,
  discoveredSetStatus = null, discoveredSetFreshness = null, discoveredSetDigest = null, completionDiscoveredInputs = null, resolutionsPrefixValid = false,
}) {
  if (!completion || typeof completion !== 'object') return { ok: false, reason: 'migration_completion_missing' };
  if (![1, 2].includes(completion.schemaVersion) || completion.deliveryMode !== deliveryMode) {
    return { ok: false, reason: 'migration_completion_invalid' };
  }
  const quick = backendCompletion?.managementImportMode === 'quick';
  if (!quick && completion.schemaVersion === 1) return { ok: false, reason: 'migration_completion_discovered_set_missing' };
  if (!quick) {
    if (!discoveredSetStatus || !completion.discoveredSet) return { ok: false, reason: 'missing_discovered_set_status' };
    if (!resolutionsPrefixValid) return { ok: false, reason: 'discovered_set_resolutions_rewritten' };
    if (!discoveredSetFreshness?.ok) return { ok: false, reason: 'discovered_set_status_stale', staleInputs: discoveredSetFreshness?.staleInputs || [] };
    for (const key of ['completionReport','reconciliation','approvalsMapping']) {
      if (!completionDiscoveredInputs || completion.discoveredSet.inputs?.[key] !== completionDiscoveredInputs[key]) return { ok: false, reason: 'discovered_set_status_stale', staleInputs: [key] };
    }
  }
  // Only a verified append may lower the live open count while preserving the historical
  // finalization. Without an append, derive status from the current report as usual.
  const resolutionsAppended = !quick && completionDiscoveredInputs?.resolutions?.lines > completion.discoveredSet?.inputs?.resolutions?.lines;
  if (resolutionsAppended && discoveredSetStatus.openCount > completion.discoveredSet.openCount) return { ok: false, reason: 'migration_completion_stale' };
  const statusAtFinalization = resolutionsAppended ? { openCount: completion.discoveredSet.openCount } : discoveredSetStatus;
  const expectedStatus = deriveFinalStatus(backendCompletion?.status, quick ? null : statusAtFinalization);
  if (postExecutionHandoff?.status !== expectedStatus) return { ok: false, reason: 'handoff_status_mismatch' };
  const artifacts = validateCompletionArtifacts({ postExecutionHandoff, executionLogPresent, backendCompletion });
  if (!artifacts.ok) return artifacts;
  if (!backendCompletion || !BACKEND_COMPLETE_STATUSES.has(backendCompletion.status) || completion.status !== expectedStatus) {
    return { ok: false, reason: 'migration_completion_stale' };
  }
  if (deliveryMode === 'management_and_website') {
    const frontend = validateFrontendCompletion(frontendCompletion, handoff);
    if (!frontend.ok) return frontend;
    if (completion.frontendCompletion !== FRONTEND_COMPLETION_FILE || completion.handoffFingerprint !== handoff.handoffFingerprint) {
      return { ok: false, reason: 'migration_completion_stale' };
    }
  }
  // The same existing gate call, handed the inputs it now also judges on -- not a
  // new router branch. See `orchestration-router.js`'s `determineNextStep`.
  const entityQa = runEntityQaGate({ backendCompletion, entityQaAttestation, mappedEntities, reportDigest });
  if (!entityQa.ok) {
    return {
      ok: false,
      reason: entityQa.reasons[0],
      entityQa: { qaStatus: entityQa.qaStatus, entities: entityQa.entities, recheck: entityQa.recheck },
    };
  }
  return { ok: true, completion };
}

module.exports = {
  classifyFinalizedRun,
  COMPLETION_FILE,
  FRONTEND_COMPLETION_FILE,
  BACKEND_COMPLETION_FILE,
  MAPPING_PLAN_FILE,
  QUICK_MODE_PLAN_FILE,
  BACKEND_COMPLETE_STATUSES,
  readJsonIfExists,
  readJsonTolerant,
  readMappedEntities,
  POST_EXECUTION_HANDOFF_JSON,
  EXECUTION_LOG_FILE,
  validateFrontendCompletion,
  validateCompletionArtifacts,
  createMigrationCompletion,
  loadMigrationCompletionInputs,
  validateMigrationCompletion,
};
