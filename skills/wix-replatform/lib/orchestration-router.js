'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateArtifacts } = require('./orchestration-state.js');

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

async function determineNextStep(projectDir, artifacts) {
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

  const decisions = artifacts.decisions || {};
  const approvals = artifacts.approvals || {};
  const sourceUrl = decisions.sourceUrl && decisions.sourceUrl.value;
  const sourceMode = decisions.sourceMode && decisions.sourceMode.value;
  const fileInputPaths = decisions.fileInputPaths && decisions.fileInputPaths.value;
  const hasFileInputs = Array.isArray(fileInputPaths) && fileInputPaths.length > 0;
  const deliveryMode = decisions.deliveryMode && decisions.deliveryMode.value;
  const targetSiteStrategy = decisions.targetSiteStrategy && decisions.targetSiteStrategy.value;
  const preflight = artifacts.preflight || null;

  // A file-provided run (e.g. platform=csv) has no source URL to probe; its
  // input files stand in for one. URL-based runs are unaffected: they never
  // carry sourceMode=files_only, so they still fall through to the checks below
  // in the original order.
  if (sourceMode === 'files_only') {
    if (!hasFileInputs) {
      return { ok: true, nextState: 'awaiting_files', nextResource: null, reason: 'missing_file_inputs' };
    }
  } else if (!sourceUrl && !hasFileInputs) {
    return { ok: true, nextState: 'awaiting_source', nextResource: null, reason: 'missing_source_url' };
  }
  if (!sourceMode) {
    return { ok: true, nextState: 'awaiting_import_scope', nextResource: null, reason: 'missing_source_mode' };
  }
  if (!deliveryMode || !targetSiteStrategy) {
    return { ok: true, nextState: 'awaiting_destination_strategy', nextResource: null, reason: 'missing_destination_strategy' };
  }

  if (!preflight || !preflight.status || preflight.status === 'not_started') {
    return { ok: true, nextState: 'preflight_running', nextResource: null, reason: 'preflight_missing' };
  }
  if (preflight.status === 'blocked') {
    return { ok: true, nextState: 'preflight_blocked', nextResource: null, reason: 'preflight_blocked' };
  }
  if (preflight.status === 'failed') {
    return { ok: false, nextState: 'failed', nextResource: null, reason: 'preflight_failed', errors: [] };
  }

  if (!(await exists(path.join(projectDir, 'source-schema.json')))) {
    return { ok: true, nextState: 'discovery_running', nextResource: 'resources/rp-discovery/', reason: 'missing_source_schema' };
  }

  if (!(await exists(path.join(projectDir, 'mapping', 'mapping-plan.json')))) {
    return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'missing_mapping_plan' };
  }

  if (approvals.mapping && approvals.mapping.status === 'pending') {
    return { ok: true, nextState: 'awaiting_mapping_approval', nextResource: null, reason: 'mapping_approval_pending' };
  }

  if (!(await exists(path.join(projectDir, 'setup', 'setup-plan.json')))) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_plan' };
  }

  if (!(await exists(path.join(projectDir, 'execution', 'execution-manifest.json')))) {
    return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'missing_execution_manifest' };
  }

  // Sample-preview sub-gate: codegen emits the extractor, runs it in sample
  // mode, and records the user's validation in preview/preview-result.json.
  // Routing back into codegen while that is missing or pending is what enforces
  // the gate — the artifact is stage-local, so no orchestration phase or
  // schema change is involved. Projects that do not use the gate simply never
  // create the file and are unaffected.
  const previewResult = await readJson(path.join(projectDir, 'preview', 'preview-result.json'));
  if (previewResult && previewResult.status === 'pending') {
    return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'sample_preview_pending' };
  }

  if (approvals.execution && approvals.execution.status === 'pending') {
    return { ok: true, nextState: 'awaiting_execution_approval', nextResource: null, reason: 'execution_approval_pending' };
  }

  if (!(await exists(path.join(projectDir, 'setup', 'setup-verification.json')))) {
    return { ok: true, nextState: 'executing_setup', nextResource: 'resources/rp-execute-setup/', reason: 'missing_setup_verification' };
  }

  if (!(await exists(path.join(projectDir, 'execution', 'completion-report.json')))) {
    return { ok: true, nextState: 'executing_import', nextResource: 'resources/rp-execute-import/', reason: 'missing_completion_report' };
  }

  return { ok: true, nextState: 'completed', nextResource: null, reason: 'completion_report_present' };
}

module.exports = {
  determineNextStep,
};
