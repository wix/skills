'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const COMPLETION_FILE = 'completion/migration-completion.json';
const FRONTEND_COMPLETION_FILE = 'website/completion.json';
const BACKEND_COMPLETION_FILE = 'execution/completion-report.json';
const COMPLETE_STATUSES = new Set(['complete', 'complete_with_warnings']);

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
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

function createMigrationCompletion({ deliveryMode, backendCompletion, frontendCompletion = null, handoff = null }) {
  if (!backendCompletion || typeof backendCompletion !== 'object' || !backendCompletion.status) {
    throw new Error('backend completion report is required');
  }
  if (!['management', 'management_and_website'].includes(deliveryMode)) {
    throw new Error('aggregate migration completion requires management or management_and_website deliveryMode');
  }
  if (deliveryMode === 'management_and_website') {
    const validation = validateFrontendCompletion(frontendCompletion, handoff);
    if (!validation.ok) throw new Error(`website migration cannot complete: ${validation.reason}`);
  }
  return {
    schemaVersion: 1,
    status: backendCompletion.status,
    deliveryMode,
    backendCompletion: BACKEND_COMPLETION_FILE,
    frontendCompletion: deliveryMode === 'management_and_website' ? FRONTEND_COMPLETION_FILE : null,
    handoffFingerprint: deliveryMode === 'management_and_website' ? handoff.handoffFingerprint : null,
    finalizedAt: new Date().toISOString(),
  };
}

async function loadMigrationCompletionInputs(projectDir) {
  const [backendCompletion, frontendCompletion, handoff, completion] = await Promise.all([
    readJsonIfExists(path.join(projectDir, BACKEND_COMPLETION_FILE)),
    readJsonIfExists(path.join(projectDir, FRONTEND_COMPLETION_FILE)),
    readJsonIfExists(path.join(projectDir, 'website', 'handoff.json')),
    readJsonIfExists(path.join(projectDir, COMPLETION_FILE)),
  ]);
  return { backendCompletion, frontendCompletion, handoff, completion };
}

function validateMigrationCompletion(completion, { deliveryMode, backendCompletion, frontendCompletion, handoff }) {
  if (!completion || typeof completion !== 'object') return { ok: false, reason: 'migration_completion_missing' };
  if (completion.schemaVersion !== 1 || completion.deliveryMode !== deliveryMode) {
    return { ok: false, reason: 'migration_completion_invalid' };
  }
  if (!backendCompletion || completion.status !== backendCompletion.status) {
    return { ok: false, reason: 'migration_completion_stale' };
  }
  if (deliveryMode === 'management_and_website') {
    const frontend = validateFrontendCompletion(frontendCompletion, handoff);
    if (!frontend.ok) return frontend;
    if (completion.frontendCompletion !== FRONTEND_COMPLETION_FILE || completion.handoffFingerprint !== handoff.handoffFingerprint) {
      return { ok: false, reason: 'migration_completion_stale' };
    }
  }
  return { ok: true, completion };
}

module.exports = {
  COMPLETION_FILE,
  FRONTEND_COMPLETION_FILE,
  BACKEND_COMPLETION_FILE,
  readJsonIfExists,
  validateFrontendCompletion,
  createMigrationCompletion,
  loadMigrationCompletionInputs,
  validateMigrationCompletion,
};
