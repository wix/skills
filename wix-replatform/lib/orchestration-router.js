'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateArtifacts } = require('./orchestration-state.js');
const { getDecisionValue, isExplicitUserOneClick } = require('./orchestration-decisions.js');
const { validateWebsiteHandoff } = require('./website-handoff.js');
const { statEnvKeys, readEnvFile } = require('./config-env.js');
const { hashArtifact } = require('./artifact-freshness.js');
const { validateSetupVerification } = require('./setup-verification.js');
const {
  loadMigrationCompletionInputs,
  validateFrontendCompletion,
  validateMigrationCompletion,
} = require('./migration-completion.js');

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

// A setup-verification.json that exists but doesn't validate (wrong schema, incomplete
// plan coverage, or a stale planDigest) is treated identically to one that doesn't exist —
// no separate router state, no fail-open branch. See
// specs/0081-setup-verification-fail-closed-receipt.md.
async function isSetupVerified(projectDir) {
  const verificationPath = path.join(projectDir, 'setup', 'setup-verification.json');
  if (!(await exists(verificationPath))) return false;
  const verification = await readJson(verificationPath);
  const plan = await readJson(path.join(projectDir, 'setup', 'setup-plan.json'));
  const planDigest = hashArtifact(projectDir, path.join('setup', 'setup-plan.json'));
  return validateSetupVerification({ verification, plan, planDigest }).ok;
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
  const sourceUrl = getDecisionValue(decisions, 'sourceUrl');
  const sourceMode = getDecisionValue(decisions, 'sourceMode');
  const fileInputPaths = getDecisionValue(decisions, 'fileInputPaths');
  const hasFileInputs = Array.isArray(fileInputPaths) && fileInputPaths.length > 0;
  const deliveryMode = getDecisionValue(decisions, 'deliveryMode');
  const isOneClick = isExplicitUserOneClick(decisions);
  const websiteScope = getDecisionValue(decisions, 'websiteScope');
  const targetSiteStrategy = getDecisionValue(decisions, 'targetSiteStrategy');
  const managementImportMode = getDecisionValue(decisions, 'managementImportMode') || 'standard';
  const sourcePlatform = getDecisionValue(decisions, 'sourcePlatform');
  const preflight = artifacts.preflight || null;

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

  if (!targetSiteStrategy) {
    return { ok: true, nextState: 'awaiting_destination_strategy', nextResource: 'resources/rp-destination/', reason: 'missing_target_site_strategy' };
  }

  // The decision above only records which strategy was CHOSEN — it says nothing about
  // whether the destination actually got provisioned. rp-destination persists the
  // metasite id into config/wix.env on success; if that never happened (a scaffold
  // failure, a 409, anything short of completion), targetSiteStrategy can still be set
  // while no destination exists. Without this check the router falls through toward
  // preflight, which reports the generic "wix.env is missing" — indistinguishable from a
  // run that never started — and there is no route back into destination creation for
  // the rest of the run (spec 0080). Applies to both strategies uniformly: rp-destination
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
  // spec 0085: WIX_SCAFFOLD_STATUS must be read and classified *before* deciding whether
  // the missing-WIX_SITE_ID case is a clean first attempt or a durable, already-failed
  // one — PR #184 review correction (round 7). The wrapper's own round-6 fix can now leave
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

  if (wixEnv.keys.WIX_SITE_ID !== 'present') {
    // No confirmed destination yet. Only a genuinely untouched wix.env (no status marker
    // at all) is a clean first attempt — anything the wrapper itself already recorded
    // here is a durable outcome of a real, failed attempt and must not be treated as one.
    if (scaffoldStatus === undefined) {
      return { ok: true, nextState: 'destination_running', nextResource: 'resources/rp-destination/', reason: 'destination_not_provisioned' };
    }
    if (scaffoldStatus === 'in_progress') {
      // An attempt was interrupted before it could record any outcome, and no local
      // receipt exists either — the wrapper itself now refuses to retry through this
      // (round 6); the router must not retry around it. 'blocked', not
      // 'destination_running': no repair path exists, so an auto-retryable state here
      // is a no-progress loop, exactly like the incomplete case below.
      return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-destination/', reason: 'destination_scaffold_interrupted' };
    }
    // Any other present value with no WIX_SITE_ID (ambiguous, or corrupted/unexpected
    // text) — the wrapper cannot confirm whether a destination exists in this state
    // either, and this router has no more information than the wrapper does.
    return { ok: true, nextState: 'blocked', nextResource: 'resources/rp-destination/', reason: 'destination_scaffold_ambiguous' };
  }

  // spec 0085: WIX_SCAFFOLD_STATUS must also be consumed once WIX_SITE_ID is present, not
  // just written by the scaffold wrapper — otherwise a restarted run sees WIX_SITE_ID
  // present, advances past rp-destination, and never re-invokes the wrapper branch that
  // rejects an incomplete scaffold. Routes to 'blocked' (not 'destination_running'): this
  // spec designs no repair path, so an automatically-retryable state here would be a
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

  if (!preflight || !preflight.status || preflight.status === 'not_started') {
    return { ok: true, nextState: 'preflight_running', nextResource: 'resources/rp-preflight/', reason: 'preflight_missing' };
  }
  if (preflight.status === 'blocked') {
    return { ok: true, nextState: 'preflight_blocked', nextResource: 'resources/rp-preflight/', reason: 'preflight_blocked' };
  }
  if (preflight.status === 'failed') {
    return { ok: false, nextState: 'failed', nextResource: null, reason: 'preflight_failed', errors: [] };
  }

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

    if (!(await exists(path.join(projectDir, 'setup', 'setup-plan.json'))) || !(await exists(path.join(projectDir, 'setup', 'setup-requirements.json')))) {
      return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'quick_mode_setup_plan_missing' };
    }

    if (!(await exists(path.join(projectDir, 'execution', 'execution-manifest.json')))) {
      return { ok: true, nextState: 'quick_mode_plan_required', nextResource: quickResource, reason: 'quick_mode_execution_manifest_missing' };
    }

    if (!isOneClick && approvals.execution && approvals.execution.status === 'pending') {
      return { ok: true, nextState: 'awaiting_execution_approval', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_pending' };
    }
    if (!(await isSetupVerified(projectDir))) {
      return { ok: true, nextState: 'executing_setup', nextResource: 'resources/rp-execute-setup/', reason: 'missing_setup_verification' };
    }
    if (!(await exists(path.join(projectDir, 'execution', 'completion-report.json')))) {
      return { ok: true, nextState: 'executing_import', nextResource: quickResource, reason: 'quick_mode_import_required' };
    }
  }

  if (managementImportMode !== 'quick' && !(await exists(path.join(projectDir, 'source-schema.json')))) {
    return { ok: true, nextState: 'discovery_running', nextResource: 'resources/rp-discovery/', reason: 'missing_source_schema' };
  }

  if (managementImportMode !== 'quick' && !(await exists(path.join(projectDir, 'mapping', 'mapping-plan.json')))) {
    return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'missing_mapping_plan' };
  }

  if (managementImportMode !== 'quick' && !isOneClick && approvals.mapping && approvals.mapping.status === 'pending') {
    return { ok: true, nextState: 'awaiting_mapping_approval', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_pending' };
  }

  if (!(await exists(path.join(projectDir, 'setup', 'setup-plan.json')))) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_plan' };
  }

  if (!(await exists(path.join(projectDir, 'setup', 'setup-requirements.json')))) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_requirements' };
  }

  if (deliveryMode === 'management_and_website' && !websiteScope && !isOneClick) {
    return { ok: true, nextState: 'awaiting_website_scope', nextResource: 'resources/rp-project-intake/', reason: 'missing_website_scope' };
  }

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

  if (managementImportMode !== 'quick' && !(await exists(path.join(projectDir, 'execution', 'execution-manifest.json')))) {
    return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'missing_execution_manifest' };
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

  if (!isOneClick && approvals.execution && approvals.execution.status === 'pending') {
    return { ok: true, nextState: 'awaiting_execution_approval', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_pending' };
  }

  if (!(await isSetupVerified(projectDir))) {
    return { ok: true, nextState: 'executing_setup', nextResource: 'resources/rp-execute-setup/', reason: 'missing_setup_verification' };
  }

  if (!(await exists(path.join(projectDir, 'execution', 'completion-report.json')))) {
    return { ok: true, nextState: 'executing_import', nextResource: 'resources/rp-execute-import/', reason: 'missing_completion_report' };
  }

  const completionInputs = await loadMigrationCompletionInputs(projectDir);
  if (deliveryMode === 'management_and_website') {
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

  const aggregate = validateMigrationCompletion(completionInputs.completion, {
    deliveryMode,
    backendCompletion: completionInputs.backendCompletion,
    frontendCompletion: completionInputs.frontendCompletion,
    handoff: completionInputs.handoff,
  });
  if (!aggregate.ok) {
    return {
      ok: true,
      nextState: 'finalizing',
      nextResource: 'resources/rp-execution-policy/',
      reason: aggregate.reason,
      requiredArtifacts: ['completion/migration-completion.json'],
      blocking: false,
    };
  }

  return { ok: true, nextState: 'completed', nextResource: null, reason: 'migration_completion_present' };
}

module.exports = {
  determineNextStep,
};
