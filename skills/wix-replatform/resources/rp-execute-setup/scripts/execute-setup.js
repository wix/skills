#!/usr/bin/env node
'use strict';

const capabilities = require('../../../lib/execution-capability');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const REAL_WRITERS = require('../../rp-target-wix/lib/wix-writers.js');
const { SCHEMA_KIND: CONTACT_V4_SCHEMA_KIND } = require('../../rp-target-wix/lib/contact-extended-fields.js');
const { hashArtifact } = require('../../../lib/artifact-freshness.js');
const { validatePlanShape, validateSetupVerification } = require('../../../lib/setup-verification.js');

// NOTE: 'wix-stores' intentionally still maps to 1380b703-... (Wix eCommerce, not Wix
// Stores) here — a separate, independently-tracked defect, not part of this change. See
// wix-writers.js's WIX_STORES_APP_ID (215238eb-...) for the correct id.
const APPS = { 'wix-stores': '1380b703-ce81-ff05-f115-39571d94dfcd', 'wix-blog': '14bcded7-0066-7c35-14d7-466cb3f09103' };

// Additional app-install step ids, added for projects whose setup plan needs apps this
// executor previously had no executor for at all (a plan naming any of these used to fail
// closed with NO_EXECUTOR_FOR_REQUIREMENT). Ids verified live against dev.wix.com's "Apps
// Created by Wix" reference table, 2026-08-29 -- not from a docs example, and not reusing
// the known-wrong 'wix-stores' id above. Idempotent: an app already installed is a pass,
// not a redundant install call (see the isWixAppInstalled check in runStep below).
const INSTALL_STEPS = {
  'install-wix-stores': '215238eb-22a5-4c36-9e7b-e7c08025e04e',
  'install-wix-gift-cards': 'd80111c5-a0f4-47a8-b63a-65b54d774a27',
  'install-wix-blog': '14bcded7-0066-7c35-14d7-466cb3f09103',
  'install-wix-events': '140603ad-af8d-84a5-2c80-a0f60cb47351',
  'install-wix-data': 'e593b0bd-b783-45b8-97c2-873d42aacaf4',
};

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readJsonIfExists(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readEnv(dir) {
  const raw = await fs.readFile(path.join(dir, 'config', 'wix.env'), 'utf8');
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()]),
  );
}

async function fallbackAuthor(dir, wix, writers) {
  const id = path.basename(dir);
  const email = `replatform-${id}@example.com`;
  const listed = await writers.listMembers(wix, { limit: 100 });
  let member = (listed.members || []).find((item) => String(item.loginEmail || '').toLowerCase() === email);
  if (!member) member = await (writers.ensureBlogFallbackAuthor || writers.createMember)(wix, { email, name: 'Imported content', slug: `imported-content-${id}` });
  if (!member?.id) throw new Error('fallback Blog author was not created');
  const file = path.join(dir, 'config', 'wix.env');
  const raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    `${raw.replace(/\n?WIX_BLOG_FALLBACK_MEMBER_ID=.*(?:\n|$)/g, '\n').replace(/\s*$/, '\n')}WIX_BLOG_FALLBACK_MEMBER_ID=${member.id}\n`,
  );
}

// Creates one Wix Data collection via the real, verified request shape (top-level key is
// `collection`, NOT `dataCollection` — confirmed live 2026-08-29 against a 400 "collection
// must not be empty" response from the wrong key, and against CreateDataCollectionRequest's
// real schema). Idempotent: a collection id that already exists (409 or an existing-id list
// hit) is a pass, never a delete-and-recreate — matches this skill's own "never delete or
// recreate an entity to fix a mismatch" rule.
async function createCmsCollectionsStep({ dir, wix, writers }) {
  const requirements = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
  const list = Array.isArray(requirements) ? requirements : requirements?.requirements;
  const requirement = (list || []).find((item) => item && item.id === 'create-cms-collections');
  if (!requirement) throw new Error('setup-requirements.json has no create-cms-collections requirement');

  const existing = await wix.send(writers.buildListCmsCollectionsRequest());
  const existingIds = new Set((existing.collections || []).map((c) => c.id));

  const fields = (requirement.fieldSchemaPerCollection || []).map((f) => ({
    key: f.key,
    type: f.type,
    displayName: f.displayName,
    ...(f.required ? { required: true } : {}),
  }));

  for (const collection of requirement.collections || []) {
    if (existingIds.has(collection.id)) continue; // already provisioned, not a redo
    await writers.ensureCmsCollection(wix, { id: collection.id, displayName: collection.displayName, fields, permissions: requirement.permissions });
  }
}

// Runs one setup-plan step. Throws (with `blockerCode`/`recommendedAction` attached where
// the failure is a recognized, expected condition rather than a genuinely unexpected one)
// on anything short of full success — the caller records the failure and stops the run
// rather than letting a step's exception propagate past a recorded outcome.
// Provisions every `extendedFieldSchema` requirement in the plan before any
// writer can put a value in one. Blocked reasons become setup blockers rather than being retried
// or worked around: a breaking schema change and an archived-key collision are both decisions for
// a human, not for this executor.
// A step is a provisioning step if it SAYS so, not only if it happens to be spelled
// `provision-extended-fields`. Recognising one literal id meant discovery emitting a valid
// requirement under any other natural id -- `setup-order-extended-fields`, say -- failed closed
// with NO_EXECUTOR_FOR_REQUIREMENT and produced no receipt at all.
const EXTENDED_FIELD_STEP_ID = 'provision-extended-fields';

// A step provisions extended fields if it SAYS so -- by the conventional id, by declaring the
// kind, or by a requirement naming it. Matching one literal id meant a requirement scheduled
// under any other natural id (`setup-order-extended-fields`, say) was both reported as
// unscheduled AND unexecutable. The scheduling guard and the dispatcher share this predicate so
// they can never disagree about which steps count.
function stepProvisionsExtendedFields(step, declaredList) {
  if (!step) return false;
  if (step.id === EXTENDED_FIELD_STEP_ID) return true;
  if (step.kind === 'extendedFieldSchema') return true;
  return (declaredList || []).some((item) => item
    && item.kind === 'extendedFieldSchema'
    && (item.setupStepId === step.id || item.id === step.id));
}

async function isExtendedFieldStep(step, dir) {
  const requirements = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
  const list = Array.isArray(requirements) ? requirements : requirements?.requirements;
  return stepProvisionsExtendedFields(step, list);
}

// Blocker codes that name their own remedy. Everything else stays EXTENDED_FIELD_SCHEMA_BLOCKED.
const EXTENDED_FIELD_BLOCKERS = {
  CONTACTS_V5_DES_UNVERIFIED: 'The Contacts V5 Data Extension Schema path is not verified on this site. Wait until it is verified, or explicitly route the mapping to contactWriteSurface "contacts-v4" (legacy), then re-run setup. Setup does not fall back automatically.',
  EXTENDED_FIELD_SCHEMA_CONFLICT_EXHAUSTED: 'Another change kept updating this schema while setup ran. Re-run setup once the concurrent edits stop; nothing was overwritten.',
  'schema-budget-exceeded': 'The namespace byte budget cannot hold these fields. Route the excess fields to a CMS collection instead of extended fields, then re-run setup.',
  'contact-extended-field-mismatch': 'A legacy contact extended field on the site does not match what the migration needs (another type or namespace, or a key different from the one an earlier run verified). Wix keys cannot change, and approving a migration action cannot repair this. Decide with the site owner how to handle the existing field; do not create a second field for the same data. Then re-run setup.',
};

// Lower-case writer codes that get their own blocker code rather than the generic one.
const EXTENDED_FIELD_BLOCKER_CODES = {
  'contact-extended-field-mismatch': 'CONTACT_EXTENDED_FIELD_MISMATCH',
};

function extendedFieldBlockerCode(code) {
  if (EXTENDED_FIELD_BLOCKER_CODES[code]) return EXTENDED_FIELD_BLOCKER_CODES[code];
  return EXTENDED_FIELD_BLOCKERS[code] && /^[A-Z0-9_]+$/.test(code) ? code : 'EXTENDED_FIELD_SCHEMA_BLOCKED';
}

async function provisionExtendedFieldsStep({ dir, wix, writers, dryRun, priorVerification = null }) {
  const requirements = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
  const list = Array.isArray(requirements) ? requirements : requirements?.requirements;
  const schemaRequirements = (list || []).filter((item) => item && item.kind === 'extendedFieldSchema');
  if (schemaRequirements.length === 0) {
    throw new Error('setup-requirements.json has no extendedFieldSchema requirement');
  }

  const verifications = [];
  for (const requirement of schemaRequirements) {
    // Routed by the requirement's own schemaKind (DES for orders/products/contacts-v5, CRM
    // Extended Fields for contacts-v4). Older writer fixtures expose only the DES entry point.
    const provision = writers.provisionExtendedFieldRequirement || writers.provisionExtendedFieldSchema;
    // eslint-disable-next-line no-await-in-loop
    const result = await provision(wix, { requirement, dryRun, priorVerification });
    if (result.blocking.length > 0) {
      const first = result.blocking[0];
      const named = EXTENDED_FIELD_BLOCKERS[first.code];
      const where = requirement.fqdn ? `${requirement.fqdn} ${requirement.namespace}` : `${requirement.schemaKind} ${requirement.contactWriteSurface || ''}`.trim();
      throw Object.assign(new Error(`${where}: ${first.detail}`), {
        blockerCode: extendedFieldBlockerCode(first.code),
        recommendedAction: named || 'Resolve the schema conflict on the destination site, or approve the migration action explicitly, then re-run setup.',
      });
    }
    if (result.verification) verifications.push(result.verification);
  }

  if (!dryRun) {
    // The writer guard reads this: a value write is refused unless setup verified that field.
    await publishAtomically(
      path.join(dir, 'setup', 'extended-field-verification.json'),
      `${JSON.stringify({ schemaVersion: 1, verifications }, null, 2)}\n`,
    );
  }
  return verifications;
}

async function runStep(step, { dir, env, wix, writers, priorExtendedFieldVerification = null }) {
  if (step.id === 'mute-site-notifications') {
    const state = await writers.muteSiteNotifications(wix, { reason: `RePlatform migration — ${path.basename(dir)}` });
    if (!state?.muted) throw new Error('notification mute verification failed');
    return;
  }
  if (APPS[step.id]) {
    await writers.installWixApp(wix, { appDefId: APPS[step.id], siteId: env.WIX_SITE_ID });
    return;
  }
  if (INSTALL_STEPS[step.id]) {
    const appDefId = INSTALL_STEPS[step.id];
    // isWixAppInstalled is optional (older writers fixtures/tests for the APPS path above
    // don't provide it) -- fall back to an unconditional install when it's unavailable.
    const alreadyInstalled = writers.isWixAppInstalled ? await writers.isWixAppInstalled(wix, appDefId) : false;
    if (!alreadyInstalled) await writers.installWixApp(wix, { appDefId, siteId: env.WIX_SITE_ID });
    return;
  }
  if (await isExtendedFieldStep(step, dir)) {
    await provisionExtendedFieldsStep({ dir, wix, writers, dryRun: false, priorVerification: priorExtendedFieldVerification });
    return;
  }
  if (step.id === 'create-cms-collections') {
    await createCmsCollectionsStep({ dir, wix, writers });
    return;
  }
  if (step.id === 'stores-catalog-v3') {
    const result = await wix.send(writers.buildGetStoresCatalogVersionRequest());
    if (result.catalogVersion !== 'V3_CATALOG') {
      throw Object.assign(new Error(`Catalog V3 required (got ${result.catalogVersion || 'unknown'})`), {
        blockerCode: 'CATALOG_V1',
        recommendedAction: 'Use a destination site provisioned with Catalog V3, or omit Stores from this migration.',
      });
    }
    return;
  }
  if (step.id === 'blog-fallback-author') {
    await fallbackAuthor(dir, wix, writers);
    return;
  }
  if (step.intent?.writerId) {
    const executor = writers.createWixSetupExecutor({ wixClient: wix });
    await executor.executeSetupStep(step);
    // A declared reference is verified through its registered read builder, once per setup target.
    if (step.referenceKeys?.length) {
      const read = writers[step.intent.readWriterId];
      if (typeof read !== 'function' || !/^build(Get|Query)/.test(step.intent.readWriterId || '')) throw new Error('setup_reference_readback_missing');
      await wix.send(read(...(step.intent.readArgs || [])));
    }
    return;
  }
  throw Object.assign(new Error(`No executor implements setup step "${step.id}"`), {
    blockerCode: 'NO_EXECUTOR_FOR_REQUIREMENT',
    recommendedAction: 'Add an executor for this step id in execute-setup.js, or remove it from the setup plan.',
  });
}

async function writeBlockers(setupDir, generatedAt, blockers) {
  await fs.writeFile(
    path.join(setupDir, 'setup-blockers.json'),
    `${JSON.stringify({ schemaVersion: 1, generatedAt, blockers }, null, 2)}\n`,
  );
}

// Writes the final file via a temp-then-rename so a crash mid-write can never leave a
// corrupt or partial receipt where a trusted one is expected — the rename is atomic on the
// same filesystem/directory.
async function publishAtomically(filePath, contents) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, contents);
  await fs.rename(tmpPath, filePath);
}

// Core logic, independent of the CLI entry point below so tests can inject a fake
// `writers` module instead of making real Wix API calls. Performs every file write itself
// (the receipt, the blockers file) and returns a summary rather than throwing on a
// recognized blocker — `main()` decides how to surface that to the process exit code.
async function executeSetup({ dir, dryRun = false, writers = REAL_WRITERS }) {
  const env = await readEnv(dir);
  if (!env.WIX_SITE_ID || !env.WIX_AUTH_TOKEN) throw new Error('WIX_SITE_ID and WIX_AUTH_TOKEN are required');

  const setupDir = path.join(dir, 'setup');
  const verificationPath = path.join(setupDir, 'setup-verification.json');
  const plan = await readJsonIfExists(path.join(setupDir, 'setup-plan.json'));
  const generatedAt = new Date().toISOString();

  // Read BEFORE the receipt is invalidated below: the legacy contacts-v4 path must prove a field's
  // key did not change since an earlier verified run (Wix keys cannot change). Only used for that
  // comparison, never as evidence that anything is provisioned now.
  // Only a missing file means "no earlier run". A receipt that exists but cannot be read or
  // parsed may hold keys a legacy contacts-v4 write already used; treating it as absent would let
  // Find Or Create accept a different key and split old and new values across two fields.
  let priorExtendedFieldVerification = null;
  let priorReceiptError = null;
  try {
    priorExtendedFieldVerification = await readJsonIfExists(path.join(setupDir, 'extended-field-verification.json'));
  } catch (error) {
    priorReceiptError = error;
  }
  if (priorReceiptError) {
    const declaredForPrior = await readJsonIfExists(path.join(setupDir, 'setup-requirements.json'));
    const declaredPriorList = Array.isArray(declaredForPrior) ? declaredForPrior : declaredForPrior?.requirements;
    const needsPriorKeys = (declaredPriorList || []).some((item) => item && item.kind === 'extendedFieldSchema' && item.schemaKind === CONTACT_V4_SCHEMA_KIND);
    if (needsPriorKeys) {
      const blocker = {
        code: 'PRIOR_EXTENDED_FIELD_RECEIPT_UNREADABLE',
        severity: 'blocker',
        requirementId: null,
        description: `setup/extended-field-verification.json exists but could not be read: ${String(priorReceiptError.message).slice(0, 200)}`,
        whyBlocked: 'the legacy contact extended-field keys an earlier run verified cannot be checked, so a changed key could split contact values across two fields',
        recommendedAction: 'Restore setup/extended-field-verification.json from the earlier run (it was left in place). Remove it only if no earlier import wrote legacy contact extended-field values. Then re-run setup.',
      };
      // Leave the unreadable receipt where it is for recovery; only the setup receipt is invalidated.
      if (!dryRun) {
        await fs.rm(verificationPath, { force: true });
        await writeBlockers(setupDir, generatedAt, [blocker]);
      }
      return { ok: false, dryRun, requirements: [], blocker };
    }
    // DES-only runs never read prior keys, so an unreadable earlier receipt is simply replaced.
  }

  if (!dryRun) {
    // Invalidate any prior receipt the instant a new live attempt begins — before we even
    // know whether this attempt will succeed. A crash partway through this run (or a
    // failure to reach the blocker-write below) must never leave an earlier, possibly
    // no-longer-true success receipt sitting there looking trusted.
    await fs.rm(verificationPath, { force: true });
    // Same reasoning for the extended-field receipt: the writers consult it before putting a
    // value in one of those fields, so a receipt from an earlier run must not outlive it.
    await fs.rm(path.join(setupDir, 'extended-field-verification.json'), { force: true });
  }

  const planShape = validatePlanShape(plan);
  if (!planShape.ok) {
    const blocker = {
      code: 'INVALID_SETUP_PLAN',
      severity: 'blocker',
      requirementId: null,
      description: `setup-plan.json is invalid: ${planShape.reasons.join(', ')}`,
      whyBlocked: planShape.reasons.join(', '),
      recommendedAction: 'Regenerate setup/setup-plan.json with a valid schemaVersion, a steps array, and unique, non-empty step ids.',
    };
    if (dryRun) throw new Error(blocker.description);
    await writeBlockers(setupDir, generatedAt, [blocker]);
    return { ok: false, dryRun: false, requirements: [], blocker };
  }

  const planDigest = hashArtifact(dir, path.join('setup', 'setup-plan.json'));
  const setupRun = capabilities.startSetupRun({ projectDir: dir, siteId: env.WIX_SITE_ID, dryRun });

  // A requirement nobody scheduled provisions nothing. The writers that need those fields then
  // refuse their writes, which is safe but fails late and for a reason that points at the wrong
  // place -- so the mismatch is caught here, where the plan and the requirements are both in hand.
  const declared = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
  const declaredList = Array.isArray(declared) ? declared : declared?.requirements;
  const needsExtendedFields = (declaredList || []).some((item) => item && item.kind === 'extendedFieldSchema');
  const schedulesExtendedFields = ((plan && plan.steps) || []).some((step) => stepProvisionsExtendedFields(step, declaredList));
  if (needsExtendedFields && !schedulesExtendedFields) {
    const blocker = {
      code: 'EXTENDED_FIELD_REQUIREMENT_UNSCHEDULED',
      severity: 'blocker',
      requirementId: null,
      description: 'setup-requirements.json declares an extendedFieldSchema requirement but setup-plan.json has no provision-extended-fields step',
      whyBlocked: 'the fields would never be provisioned, and every writer that needs them would refuse its write later in the run',
      recommendedAction: 'Add a "provision-extended-fields" step to the setup plan, or remove the extendedFieldSchema requirement.',
    };
    // A dry run reports; it does not leave artifacts behind. Writing the blockers file here made
    // `dryRun: true` mutate the project and report itself as a live run.
    if (!dryRun) await writeBlockers(path.join(dir, 'setup'), new Date().toISOString(), [blocker]);
    return { ok: false, dryRun, requirements: [], blocker };
  }

  const requirements = [];
  let blocker = null;

  for (const step of plan.steps) {
    if (dryRun) {
      requirements.push({ id: step.id, status: 'planned_dry_run' });
      continue;
    }
    try {
      const stepCapability = capabilities.bindSetupStep(setupRun, step.id);
      const wix = writers.createWixClient({ capability: stepCapability, authToken: env.WIX_AUTH_TOKEN });
      await runStep(step, { dir, env, wix, writers, priorExtendedFieldVerification });
      const referenceBindings = step.referenceKeys?.length ? writers.captureSetupReferenceBindings(wix, step) : undefined;
      requirements.push({ id: step.id, status: 'passed', ...(referenceBindings ? { referenceBindings } : {}) });
    } catch (error) {
      requirements.push({ id: step.id, status: 'blocked', detail: error.message });
      blocker = {
        code: error.blockerCode || 'UNEXPECTED_SETUP_ERROR',
        severity: 'blocker',
        requirementId: step.id,
        description: error.message,
        whyBlocked: error.message,
        recommendedAction: error.recommendedAction || 'Investigate the underlying error and re-run setup once resolved.',
      };
      break; // Stop at the first failure — later steps were never attempted, not skipped.
    }
  }

  if (dryRun) {
    await fs.writeFile(
      path.join(setupDir, 'setup-dry-run.json'),
      `${JSON.stringify({ schemaVersion: 1, generatedAt, dryRun: true, requirements }, null, 2)}\n`,
    );
    return { ok: true, dryRun: true, requirements, blocker: null };
  }

  if (blocker) {
    // The old receipt (if any) was already removed above, before this attempt began.
    await writeBlockers(setupDir, generatedAt, [blocker]);
    return { ok: false, dryRun: false, requirements, blocker };
  }

  // Full success: every planned requirement passed. Self-check the candidate against the
  // exact same validator the router uses before publishing it — there must be exactly one
  // definition of "valid", shared, never re-implemented separately here.
  const candidate = { schemaVersion: 1, generatedAt, siteId: env.WIX_SITE_ID, dryRun: false, planDigest, requirements };
  const selfCheck = validateSetupVerification({ verification: candidate, plan, planDigest, siteId: env.WIX_SITE_ID });
  if (!selfCheck.ok) {
    const internalBlocker = {
      code: 'INTERNAL_VALIDATION_FAILURE',
      severity: 'blocker',
      requirementId: null,
      description: `execute-setup.js produced a receipt that failed its own validator: ${selfCheck.reasons.join(', ')}`,
      whyBlocked: selfCheck.reasons.join(', '),
      recommendedAction: 'This indicates a bug in execute-setup.js itself — investigate rather than retrying.',
    };
    await writeBlockers(setupDir, generatedAt, [internalBlocker]);
    return { ok: false, dryRun: false, requirements, blocker: internalBlocker };
  }

  await writeBlockers(setupDir, generatedAt, []);
  await publishAtomically(verificationPath, `${JSON.stringify(candidate, null, 2)}\n`);
  return { ok: true, dryRun: false, requirements, blocker: null };
}

async function main() {
  const dir = process.argv[2] && path.resolve(process.argv[2]);
  if (!dir) throw new Error('Usage: execute-setup.js <projectDir> [--dry-run]');
  const dryRun = process.argv.includes('--dry-run');
  const result = await executeSetup({ dir, dryRun });
  if (result.blocker) throw new Error(result.blocker.description);
  console.log(JSON.stringify({ ok: true, dryRun }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { executeSetup, runStep };
