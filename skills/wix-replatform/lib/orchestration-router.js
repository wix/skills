'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateArtifacts } = require('./orchestration-state.js');
const { getDecisionValue, isEditorSiteType, isExplicitUserOneClick, isKnownSourceMode } = require('./orchestration-decisions.js');
const { destinationGate, publicationRecheckGate } = require('./destination-route.js');
const { validateWebsiteHandoff } = require('./website-handoff.js');
const { statEnvKeys, readEnvFile } = require('./config-env.js');
const { hashArtifact } = require('./artifact-freshness.js');
const { validatePlanShape, validateSetupRequirementsShape, validateSetupVerification } = require('./setup-verification.js');
const { validateManifest } = require('./execution-manifest.js');
const { QUICK_IMPORT_STARTED_MARKER, validateQuickExecutionManifest } = require('../resources/rp-quick-runtime/lib/import-progress.js');
const { checkCmsFallbackFreshness } = require('./plugin-cms-fallback.js');
const {
  classifyFinalizedRun,
  loadMigrationCompletionInputs,
  validateFrontendCompletion,
  validateMigrationCompletion,
} = require('./migration-completion.js');
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

// Rules for the two LLM-assisted outputs: parseable JSON whose top level is a
// non-array object. Nothing else is read (no versioned contract exists; mapping row shape is
// owned by the tolerant `readEntityMappings` consumer).
function validateSourceSchemaShape(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ok: true, errors: [] }
    : { ok: false, errors: ['source-schema.json must be a JSON object'] };
}

function validateMappingPlanShape(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ok: true, errors: [] }
    : { ok: false, errors: ['mapping/mapping-plan.json must be a JSON object'] };
}

function setupPlanRule(value) {
  const result = validatePlanShape(value);
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

function invalidOutputRoute(reason, nextResource, errors) {
  return { ok: true, nextState: 'blocked', nextResource, reason, errors, blocking: true };
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
  return validateSetupVerification({ verification, plan, planDigest }).ok;
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

  if (artifacts.run.status === 'cancel_requested') {
    return { ok: true, nextState: 'cancel_requested', nextResource: null, reason: 'cancellation_cleanup_required', blocking: true };
  }
  if (artifacts.run.status === 'canceled' || artifacts.run.status === 'interrupted') {
    return { ok: true, nextState: artifacts.run.status, nextResource: null, reason: artifacts.run.status, blocking: true };
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
  const readArtifact = createArtifactReader(projectDir);

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

  if (!preflight || !preflight.status || preflight.status === 'not_started') {
    return { ok: true, nextState: 'preflight_running', nextResource: 'resources/rp-preflight/', reason: 'preflight_missing' };
  }
  if (preflight.status === 'blocked') {
    return { ok: true, nextState: 'preflight_blocked', nextResource: 'resources/rp-preflight/', reason: 'preflight_blocked' };
  }
  if (preflight.status === 'failed') {
    return { ok: false, nextState: 'failed', nextResource: null, reason: 'preflight_failed', errors: [] };
  }

  // Scope boundary: phase-output validation runs only before backend accounting.
  const completionReportPresent = await exists(path.join(projectDir, 'execution', 'completion-report.json'));
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

    const quickSetupPlan = await checkGatedOutput(readArtifact, path.join('setup', 'setup-plan.json'), setupPlanRule, { validate: !completionReportPresent });
    const quickSetupRequirements = await checkGatedOutput(readArtifact, path.join('setup', 'setup-requirements.json'), validateSetupRequirementsShape, { validate: !completionReportPresent });
    if (!quickSetupPlan.present || !quickSetupRequirements.present) {
      return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'quick_mode_setup_plan_missing' };
    }
    if (quickSetupPlan.errors) return invalidOutputRoute('setup_plan_invalid', 'resources/rp-setup-discovery/', quickSetupPlan.errors);
    if (quickSetupRequirements.errors) return invalidOutputRoute('setup_requirements_invalid', 'resources/rp-setup-discovery/', quickSetupRequirements.errors);

    const quickManifest = await checkGatedOutput(readArtifact, path.join('execution', 'execution-manifest.json'), validateQuickExecutionManifest, { validate: !completionReportPresent });
    if (!quickManifest.present) {
      return { ok: true, nextState: 'quick_mode_plan_required', nextResource: quickResource, reason: 'quick_mode_execution_manifest_missing' };
    }
    if (quickManifest.errors) return invalidOutputRoute('execution_manifest_invalid', quickResource, quickManifest.errors);

    if (executionRejected) return executionRejectedRoute;
    if (!isOneClick && approvals.execution && approvals.execution.status === 'pending') {
      return { ok: true, nextState: 'awaiting_execution_approval', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_pending' };
    }
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
    if (sourceSchema.errors) return invalidOutputRoute('source_schema_invalid', 'resources/rp-discovery/', sourceSchema.errors);
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
    if (mappingPlan.errors) return invalidOutputRoute('mapping_plan_invalid', 'resources/rp-mapper/', mappingPlan.errors);
    if (reviewOnly) {
      const gaps = await readArtifact('mapping/review/mapping-gaps.json');
      if (gaps.present && (gaps.parseError || !gaps.value || typeof gaps.value !== 'object')) return invalidOutputRoute('mapping_plan_invalid', 'resources/rp-mapper/', ['mapping/review/mapping-gaps.json is invalid']);
    }

    // A rejected mapping returns to the mapper, which writes a new plan version
    // and resets mapping approval to pending. One-click does not skip a recorded rejection.
    if (approvals.mapping && approvals.mapping.status === 'rejected') {
      return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_rejected' };
    }
  }

  if (managementImportMode !== 'quick') {
    const bound = await mappingApprovalBound(projectDir, approvals.mapping);
    const coverageGate = bound ? await sourceCoverageGate(projectDir) : await reconcileSourceCoverageForMapping(projectDir, { mappingStatus: 'approved' });
    if (!coverageGate.ok) {
      return { ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason: 'source_coverage_unreconciled', errors: coverageGate.failures };
    }
  }

  if (managementImportMode !== 'quick') {
    const reconciliation = await readReconciliation(projectDir);
    const route = (reason, detail = {}) => ({ ok: true, nextState: 'mapping_running', nextResource: 'resources/rp-mapper/', reason, ...detail });
    if (!reconciliation) return route('census_reconciliation_missing');
    const freshness = await censusReconciliationFreshness(projectDir, reconciliation);
    if (!freshness.ok) return route('census_reconciliation_stale', { staleInputs: freshness.staleInputs });
    if (reconciliation.errors?.length) return route('census_reconciliation_blocking', { errors: reconciliation.errors });
    if (['approved','provisional'].includes(approvals.mapping?.status)) {
      const ref = approvals.mapping.artifactRefs?.find(ref => ref && typeof ref === 'object' && ref.kind === 'census-reconciliation' && ref.path === 'mapping/review/census-reconciliation.json' && /^[0-9a-f]{64}$/i.test(ref.sha256 || ''));
      if (!ref) return route('mapping_approval_missing_census');
      if (!(await mappingApprovalBound(projectDir, approvals.mapping))) return route('mapping_approval_stale_census');
    }
  }

  if (managementImportMode !== 'quick' && !isOneClick && approvals.mapping && approvals.mapping.status === 'pending') {
    return { ok: true, nextState: 'awaiting_mapping_approval', nextResource: 'resources/rp-mapper/', reason: 'mapping_approval_pending' };
  }

  if (freshness && freshness.stale === 'setup') {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'setup_plan_stale_cms_fallback' };
  }

  const setupPlan = await checkGatedOutput(readArtifact, path.join('setup', 'setup-plan.json'), setupPlanRule, { validate: validateOutputs });
  if (!setupPlan.present) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_plan' };
  }
  if (setupPlan.errors) return invalidOutputRoute('setup_plan_invalid', 'resources/rp-setup-discovery/', setupPlan.errors);

  const setupRequirements = await checkGatedOutput(readArtifact, path.join('setup', 'setup-requirements.json'), validateSetupRequirementsShape, { validate: validateOutputs });
  if (!setupRequirements.present) {
    return { ok: true, nextState: 'setup_discovery_running', nextResource: 'resources/rp-setup-discovery/', reason: 'missing_setup_requirements' };
  }
  if (setupRequirements.errors) return invalidOutputRoute('setup_requirements_invalid', 'resources/rp-setup-discovery/', setupRequirements.errors);

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

  if (!handoffStatus.ok) {
    return {
      ok: true,
      nextState: 'mapping_running',
      nextResource: 'resources/rp-mapper/',
      reason: 'invalid_website_handoff',
      errors: handoffStatus.blockingWarnings,
    };
  }

  if (managementImportMode !== 'quick') {
    const manifest = await checkGatedOutput(readArtifact, path.join('execution', 'execution-manifest.json'), validateManifest, { validate: validateOutputs });
    if (!manifest.present) {
      return { ok: true, nextState: 'codegen_running', nextResource: 'resources/rp-import-codegen/', reason: 'missing_execution_manifest' };
    }
    if (manifest.errors) return invalidOutputRoute('execution_manifest_invalid', 'resources/rp-import-codegen/', manifest.errors);
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
  if (!isOneClick && approvals.execution && approvals.execution.status === 'pending') {
    return { ok: true, nextState: 'awaiting_execution_approval', nextResource: 'resources/rp-execution-policy/', reason: 'execution_approval_pending' };
  }

  if (!(await isSetupVerified(projectDir, readArtifact))) {
    return { ok: true, nextState: 'executing_setup', nextResource: 'resources/rp-execute-setup/', reason: 'missing_setup_verification' };
  }

  if (!completionReportPresent) {
    return {
      ok: true,
      nextState: 'executing_import',
      nextResource: 'resources/rp-execute-import/',
      reason: 'missing_completion_report',
      ...(await importProgressFields(projectDir)),
    };
  }

  const completionInputs = await loadMigrationCompletionInputs(projectDir);
  if (deliveryMode === 'management_and_website') {
    const frontend = validateFrontendCompletion(completionInputs.frontendCompletion, completionInputs.handoff);
    // An Editor destination has no automatic frontend continuation. The website
    // obligation stays outstanding as a handoff; never route into the Headless clone.
    if (!frontend.ok && isEditorSiteType(getDecisionValue(decisions, 'targetSiteType'))) {
      return {
        ok: true,
        nextState: 'blocked',
        nextResource: 'resources/rp-website-continuation/',
        reason: 'editor_website_handoff_outstanding',
        requiredArtifacts: ['website/completion.json'],
        blocking: true,
      };
    }
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

  return { ok: true, nextState: 'completed', nextResource: null, reason: 'migration_completion_present' };
}

const REVIEW_ONLY_MAPPING_REASONS = new Set(['mapping_approval_rejected', 'census_reconciliation_missing', 'census_reconciliation_stale', 'census_reconciliation_blocking', 'mapping_approval_missing_census', 'mapping_approval_stale_census']);
function applyReviewOnlyRoute(result) {
  const hold = (reason, detail = {}) => ({ ...result, ok: true, nextState: 'blocked', nextResource: null, reason, blocking: true, reviewOnly: true, ...detail });
  if (['missing_source_schema','source_schema_invalid','missing_mapping_plan','mapping_plan_invalid'].includes(result.reason)) return hold('review_only_input_unavailable', { errors: result.errors || [result.reason] });
  if (result.reason === 'source_coverage_unreconciled') return hold('review_only_source_coverage_unreconciled');
  if (REVIEW_ONLY_MAPPING_REASONS.has(result.reason) || result.reason === 'mapping_approval_pending' || result.nextState === 'finalizing') return { ...result, reviewOnly: true };
  return hold('review_only_unexpected_route', { wouldRoute: result.reason });
}
async function determineNextStepForMode(projectDir, artifacts, options, validation) {
  // Classification must precede every resource-bearing route, including intake and quick mode.
  if (!validation.ok || ['cancel_requested','canceled','interrupted'].includes(artifacts.run.status)) return determineNextStepUnfiltered(projectDir, artifacts, options);
  const finalized = await classifyFinalizedRun(projectDir, { decisions: artifacts.decisions || {} });
  if (finalized.kind === 'unverified-v1') return { ok: true, nextState: 'blocked', nextResource: null, reason: 'finalized_receipt_unverified', errors: finalized.errors, reviewOnly: true, blocking: true };
  const reviewOnly = finalized.kind === 'valid-v1';
  const result = await determineNextStepUnfiltered(projectDir, artifacts, { ...options, reviewOnly });
  // A finalized review-only run must never dispatch destination work. Standard runs
  // still require master's fresh Editor publication readback before downstream work.
  return reviewOnly ? applyReviewOnlyRoute(result) : publicationRecheckGate(projectDir, result, options);
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
