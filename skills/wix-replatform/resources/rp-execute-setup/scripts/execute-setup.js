#!/usr/bin/env node
'use strict';

const capabilities = require('../../../lib/execution-capability');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {assertCollectionCompatibility}=require('../../../lib/cms-collection-compatibility.js');
const REAL_WRITERS = require('../../rp-target-wix/lib/wix-writers.js');
const { SCHEMA_KIND: CONTACT_V4_SCHEMA_KIND } = require('../../rp-target-wix/lib/contact-extended-fields.js');
const { hashArtifact } = require('../../../lib/artifact-freshness.js');
const { validatePlanShape, validateSetupVerification } = require('../../../lib/setup-verification.js');
const siteRegional = require('../../../lib/site-regional.js');
const catalogBaseline = require('../../../lib/catalog-baseline.js');
const wixAuth = require('../../../lib/wix-auth.js');

// 'wix-stores' is the quick-mode step id; it is Wix Stores (215238eb-...), the same app as
// `install-wix-stores` below. 1380b703-... is Wix eCommerce, which Stores installs as its own
// dependency: installing it alone leaves the site without Stores.
const APPS = { 'wix-stores': '215238eb-22a5-4c36-9e7b-e7c08025e04e', 'wix-blog': '14bcded7-0066-7c35-14d7-466cb3f09103' };

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
  // Verified live 2026-10-27: the APIs name these ids when the app is missing.
  'install-wix-reviews': 'a95a5fce-e370-4402-9ce4-96956acc747d',
  'install-wix-back-in-stock': '16be6c71-d061-4f56-8cda-c6aa911d1832',
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
  const created = !(listed.members || []).includes(member);
  const file = path.join(dir, 'config', 'wix.env');
  const raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    `${raw.replace(/\n?WIX_BLOG_FALLBACK_MEMBER_ID=.*(?:\n|$)/g, '\n').replace(/\s*$/, '\n')}WIX_BLOG_FALLBACK_MEMBER_ID=${member.id}\n`,
  );
  return { method: created ? 'member-create-response' : 'member-read', observed: { memberId: member.id } };
}

// Creates one Wix Data collection via the real, verified request shape (top-level key is
// `collection`, NOT `dataCollection` — confirmed live 2026-08-29 against a 400 "collection
// must not be empty" response from the wrong key, and against CreateDataCollectionRequest's
// real schema). Idempotent: a collection id that already exists (409 or an existing-id list
// hit) requires a full compatible definition read, never a delete-and-recreate — matches this skill's own "never delete or
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
    ...(f.typeMetadata ? {typeMetadata:f.typeMetadata} : {}),
  }));

  for (const collection of requirement.collections || []) {
    const expected={id:collection.id,displayName:collection.displayName,fields:collection.fields || fields,
      permissions:collection.permissions || requirement.permissions};
    if (!existingIds.has(collection.id)) {
      try {
        await writers.ensureCmsCollection(wix, expected);
      } catch(error) {
        if (error.status!==409 && error.statusCode!==409) throw error;
        // A concurrent create is not evidence of compatible fields or permissions.
      }
    }
    const current=await wix.send(writers.buildGetCmsCollectionRequest(collection.id));
    assertCollectionCompatibility(current.collection,expected);
  }
  return { method: 'collection-read', observed: { collections: (requirement.collections || []).map(c => c.id) } };
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

// The regional step reads the site, decides each setting, applies the ones the plan approved, reads
// them back and returns the receipt object recorded on its requirement row.
async function isRegionalStep(step, dir) {
  const requirements = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
  const list = Array.isArray(requirements) ? requirements : requirements?.requirements;
  return siteRegional.stepConfiguresSiteRegional(step, list);
}

// Returns the check that actually ran: `{ method, observed }` (see SETUP_CHECK_METHODS in
// lib/setup-verification.js). The caller stamps `checkedAt` once it returns. An install with no
// read-back records `install-response` -- what was observed, never a claimed read.
// An install call that returns 200 proves nothing about the site: the step passes only when the
// installed-apps list read back afterwards names the app and it is enabled. An app that is
// already listed is a pass without a second install call.
async function installAndVerifyApp(stepId, appDefId, { dir, env, wix, writers, catalogSettle = {} }) {
  const listed = async () => (writers.isWixAppInstalled ? writers.isWixAppInstalled(wix, appDefId) : false);
  const install = async () => {
    await writers.installWixApp(wix, { appDefId, siteId: env.WIX_SITE_ID });
    if (!(await listed())) {
      throw Object.assign(new Error(`${stepId}: install call returned but app ${appDefId} is not listed as installed and enabled on the site`), {
        blockerCode: 'APP_INSTALL_NOT_VERIFIED',
        recommendedAction: 'Re-run setup; if the app is still missing from GET /apps-installer-service/v1/app-instances, install it from the Wix dashboard (Add Apps) and re-run setup.',
      });
    }
  };
  const installed = await listed();
  // Wix Stores adds sample products when it installs. The catalog is read around the install, the
  // items it added are deleted, and the rest is recorded so no importer takes them over.
  if (appDefId === catalogBaseline.STORES_APP_DEF_ID) {
    let baseline, unchanged;
    try {
      ({ baseline, unchanged } = await catalogBaseline.captureAroundInstall({ projectDir: dir, wix, writers, installed, install, siteOrigin: siteRegional.siteOriginFor(dir, env.WIX_SITE_ID), ...catalogSettle }));
    } catch (error) {
      if (error.blockerCode || wixAuth.isRunInterruption(error)) throw error;
      throw Object.assign(new Error(`${stepId}: the Stores catalog could not be read around the install: ${error.message}`), {
        blockerCode: 'CATALOG_BASELINE_UNREADABLE',
        recommendedAction: 'Re-run setup. Import cannot start until setup has recorded which products were on the store before it.',
      });
    }
    const catalog = { artifact: catalogBaseline.BASELINE_PATH, sha256: catalogBaseline.digest(dir), unchanged, ...catalogBaseline.summarize(baseline) };
    return { method: 'installed-apps-read', observed: { appDefId, installed: true, ...(installed ? {} : { installCall: 'succeeded' }), catalogBaseline: catalog } };
  }
  if (installed) return { method: 'installed-apps-read', observed: { appDefId, installed: true } };
  await install();
  return { method: 'installed-apps-read', observed: { appDefId, installed: true, installCall: 'succeeded' } };
}

async function runStep(step, { dir, env, wix, writers, priorExtendedFieldVerification = null, catalogSettle }) {
  if (await isRegionalStep(step, dir)) {
    const requirements = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
    const list = Array.isArray(requirements) ? requirements : requirements?.requirements;
    const requirement = (list || []).find((item) => item && item.kind === 'siteLocale') || {};
    const regional = await siteRegional.executeRegionalStep({ projectDir: dir, wix, writers, siteId: env.WIX_SITE_ID, requirement });
    // The receipt's fields are the read-back this step performed; the check records what was observed.
    return { method: 'site-properties-read', observed: { fields: Object.fromEntries(Object.entries(regional.fields || {}).map(([field, row]) => [field, row.action])) }, regional };
  }
  if (step.id === 'mute-site-notifications') {
    const state = await writers.muteSiteNotifications(wix, { reason: `RePlatform migration — ${path.basename(dir)}` });
    if (!state?.muted) throw new Error('notification mute verification failed');
    const read = await writers.getSiteMuteState(wix);
    if (read?.muted !== true) throw new Error('notification mute verification failed: status read is not muted');
    return { method: 'status-read', observed: { muted: true } };
  }
  if (step.id === 'start-back-in-stock-collection') {
    await wix.send(writers.buildStartBackInStockCollectionRequest());
    const read = await wix.send(writers.buildGetBackInStockSettingsRequest());
    const stores = (read?.settings?.collectionStates || []).find((row) => row.appId === catalogBaseline.STORES_APP_DEF_ID);
    if (stores?.collectingRequests !== true) throw new Error('back-in-stock collection verification failed: settings read does not show collecting for Wix Stores');
    return { method: 'settings-read', observed: { collectingRequests: true } };
  }
  if (APPS[step.id] || INSTALL_STEPS[step.id]) return installAndVerifyApp(step.id, APPS[step.id] || INSTALL_STEPS[step.id], { dir, env, wix, writers, catalogSettle });
  if (await isExtendedFieldStep(step, dir)) {
    const verifications = await provisionExtendedFieldsStep({ dir, wix, writers, dryRun: false, priorVerification: priorExtendedFieldVerification });
    return { method: 'extended-field-verification', observed: { verifications: verifications.length } };
  }
  if (step.id === 'create-cms-collections') {
    return createCmsCollectionsStep({ dir, wix, writers });
  }
  if (step.id === 'stores-catalog-v3') {
    const result = await wix.send(writers.buildGetStoresCatalogVersionRequest());
    if (result.catalogVersion !== 'V3_CATALOG') {
      throw Object.assign(new Error(`Catalog V3 required (got ${result.catalogVersion || 'unknown'})`), {
        blockerCode: 'CATALOG_V1',
        recommendedAction: 'Use a destination site provisioned with Catalog V3, or omit Stores from this migration.',
      });
    }
    return { method: 'catalog-version-read', observed: { catalogVersion: result.catalogVersion } };
  }
  if (step.id === 'blog-fallback-author') {
    return fallbackAuthor(dir, wix, writers);
  }
  if (step.intent?.writerId) {
    const executor = writers.createWixSetupExecutor({ wixClient: wix });
    await executor.executeSetupStep(step);
    // A declared reference is verified through its registered read builder, once per setup target.
    if (step.referenceKeys?.length) {
      const read = writers[step.intent.readWriterId];
      if (typeof read !== 'function' || !/^build(Get|Query)/.test(step.intent.readWriterId || '')) throw new Error('setup_reference_readback_missing');
      await wix.send(read(...(step.intent.readArgs || [])));
      return { method: 'reference-read-back', observed: { writerId: step.intent.writerId, readWriterId: step.intent.readWriterId } };
    }
    return { method: 'writer-response', observed: { writerId: step.intent.writerId } };
  }
  throw Object.assign(new Error(`No executor implements setup step "${step.id}"`), {
    blockerCode: 'NO_EXECUTOR_FOR_REQUIREMENT',
    recommendedAction: 'Add an executor for this step id in execute-setup.js, or remove it from the setup plan.',
  });
}

async function regionalDryRunIntent(dir) {
  const source = await require('../../../lib/source-regional.js').readSourceRegional(dir).catch(() => null);
  return source ? siteRegional.regionalDryRunIntent(source) : [];
}

// A dry run cannot install, so it cannot know which samples the install would add; it states the
// rule it would apply and makes no delete call.
function storesDryRunIntent(dir) {
  const prior = catalogBaseline.loadBaseline(dir);
  return prior
    ? { catalogBaseline: 'recorded', wouldDelete: prior.products.concat(prior.categories).filter((row) => row.kind === 'install_seeded' && row.status !== 'deleted').map((row) => row.id) }
    : { catalogBaseline: 'read before and after the install; delete only items the install adds', wouldDelete: 'unknown until install' };
}

async function writeBlockers(setupDir, generatedAt, blockers, replaces = null) {
  await fs.writeFile(
    path.join(setupDir, 'setup-blockers.json'),
    `${JSON.stringify({ schemaVersion: 1, generatedAt, replaces, blockers }, null, 2)}\n`,
  );
}

async function replacedReceipt(setupDir) {
  let bytes;
  try { bytes = await fs.readFile(path.join(setupDir, 'setup-verification.json')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { return JSON.parse(await fs.readFile(path.join(setupDir, 'setup-blockers.json'), 'utf8')).replaces ?? null; } catch (error) { return error.code === 'ENOENT' ? null : { sha256: null, generatedAt: null }; }
  }
  let generatedAt = null;
  try { generatedAt = JSON.parse(bytes).generatedAt ?? null; } catch { /* unreadable: no trusted time */ }
  return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), generatedAt };
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
// `catalogSettle` ({ sleep, delayMs }) only shortens the post-install catalog re-reads in tests.
async function executeSetup({ dir, dryRun = false, writers = REAL_WRITERS, catalogSettle = {} }) {
  const env = await readEnv(dir);
  if (!env.WIX_SITE_ID || !env.WIX_AUTH_TOKEN) throw new Error('WIX_SITE_ID and WIX_AUTH_TOKEN are required');

  const setupDir = path.join(dir, 'setup');
  const verificationPath = path.join(setupDir, 'setup-verification.json');
  const plan = await readJsonIfExists(path.join(setupDir, 'setup-plan.json'));
  const generatedAt = new Date().toISOString();
  // The receipt this attempt replaces, carried through failed attempts in setup-blockers.json, so
  // import-plan freshness can tell the approved setup's first receipt from a later re-run.
  const replaces = await replacedReceipt(setupDir);

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
        await writeBlockers(setupDir, generatedAt, [blocker], replaces);
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

  const planShape = validatePlanShape(plan, dir);
  if (!planShape.ok) {
    const blocker = {
      code: 'INVALID_SETUP_PLAN',
      severity: 'blocker',
      requirementId: null,
      description: `setup-plan.json is invalid: ${planShape.reasons.join(', ')}`,
      whyBlocked: planShape.reasons.join(', '),
      recommendedAction: 'Regenerate setup/setup-plan.json with a valid schemaVersion, a steps array, unique, non-empty step ids, and the entityRefs each named step writes (create-cms-collections lists cms/collection).',
    };
    if (dryRun) throw new Error(blocker.description);
    await writeBlockers(setupDir, generatedAt, [blocker], replaces);
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
    if (!dryRun) await writeBlockers(path.join(dir, 'setup'), new Date().toISOString(), [blocker], replaces);
    return { ok: false, dryRun, requirements: [], blocker };
  }

  // Same pairing rule for the site regional settings: a requirement with no step changes nothing,
  // and a step with no requirement has nothing to compare against.
  const needsRegional = (declaredList || []).some((item) => item && item.kind === 'siteLocale');
  const schedulesRegional = ((plan && plan.steps) || []).some((step) => siteRegional.stepConfiguresSiteRegional(step, declaredList));
  if (needsRegional !== schedulesRegional) {
    const blocker = {
      code: 'SITE_REGIONAL_REQUIREMENT_UNSCHEDULED',
      severity: 'blocker',
      requirementId: null,
      description: 'setup-requirements.json and setup-plan.json disagree about import-site-locale: it must be in both or in neither',
      whyBlocked: 'a requirement with no step never changes the site, and a step with no requirement has no source values or entity lists to act on',
      recommendedAction: 'Regenerate the setup plan and requirements together (rp-setup-discovery), or remove the stray one.',
    };
    if (!dryRun) await writeBlockers(path.join(dir, 'setup'), new Date().toISOString(), [blocker]);
    return { ok: false, dryRun, requirements: [], blocker };
  }

  const requirements = [];
  let blocker = null;
  // One renewing token for every step: setup also runs long enough to outlive a token.
  const tokenSource = dryRun ? null : wixAuth.createWixTokenSource({ projectDir: dir, siteId: env.WIX_SITE_ID });

  for (const step of plan.steps) {
    if (dryRun) {
      const intent = siteRegional.stepConfiguresSiteRegional(step, declaredList) ? await regionalDryRunIntent(dir)
        : (APPS[step.id] || INSTALL_STEPS[step.id]) === catalogBaseline.STORES_APP_DEF_ID ? storesDryRunIntent(dir) : null;
      requirements.push({ id: step.id, status: 'planned_dry_run', ...(intent ? { intent } : {}) });
      continue;
    }
    try {
      const stepCapability = capabilities.bindSetupStep(setupRun, step.id);
      const wix = writers.createWixClient({ capability: stepCapability, tokenSource });
      const { method, observed, regional } = await runStep(step, { dir, env, wix, writers, priorExtendedFieldVerification, catalogSettle });
      const verification = { method, checkedAt: new Date().toISOString(), observed };
      const referenceBindings = step.referenceKeys?.length ? writers.captureSetupReferenceBindings(wix, step) : undefined;
      requirements.push({ id: step.id, status: 'passed', verification, ...(referenceBindings ? { referenceBindings } : {}), ...(regional ? { regional } : {}) });
    } catch (caught) {
      // A step helper may wrap the interruption in its own error; the project's latch is the
      // authority that this step stopped on an expired token.
      const error = wixAuth.interruptionFor(dir) || caught;
      requirements.push({ id: step.id, status: 'blocked', detail: error.message });
      blocker = {
        code: error.blockerCode || (wixAuth.isRunInterruption(error) ? wixAuth.WIX_AUTH_EXPIRED : 'UNEXPECTED_SETUP_ERROR'),
        severity: 'blocker',
        requirementId: step.id,
        description: error.message,
        whyBlocked: error.message,
        recommendedAction: error.recommendedAction || (wixAuth.isRunInterruption(error) ? error.message : 'Investigate the underlying error and re-run setup once resolved.'),
        ...(error.awaitingOwner ? { awaitingOwner: true } : {}),
        ...(wixAuth.isRunInterruption(error) ? { reason: error.reason } : {}),
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
    await writeBlockers(setupDir, generatedAt, [blocker], replaces);
    return { ok: false, dryRun: false, requirements, blocker };
  }

  // Full success: every planned requirement passed. Self-check the candidate against the
  // exact same validator the router uses before publishing it — there must be exactly one
  // definition of "valid", shared, never re-implemented separately here.
  const candidate = { schemaVersion: 1, generatedAt, siteId: env.WIX_SITE_ID, dryRun: false, planDigest, replaces, requirements };
  const selfCheck = validateSetupVerification({ verification: candidate, plan, planDigest, siteId: env.WIX_SITE_ID, projectDir:dir });
  if (!selfCheck.ok) {
    const internalBlocker = {
      code: 'INTERNAL_VALIDATION_FAILURE',
      severity: 'blocker',
      requirementId: null,
      description: `execute-setup.js produced a receipt that failed its own validator: ${selfCheck.reasons.join(', ')}`,
      whyBlocked: selfCheck.reasons.join(', '),
      recommendedAction: 'This indicates a bug in execute-setup.js itself — investigate rather than retrying.',
    };
    await writeBlockers(setupDir, generatedAt, [internalBlocker], replaces);
    return { ok: false, dryRun: false, requirements, blocker: internalBlocker };
  }

  await writeBlockers(setupDir, generatedAt, [], replaces);
  await publishAtomically(verificationPath, `${JSON.stringify(candidate, null, 2)}\n`);
  return { ok: true, dryRun: false, requirements, blocker: null };
}

async function main() {
  const dir = process.argv[2] && path.resolve(process.argv[2]);
  if (!dir) throw new Error('Usage: execute-setup.js <projectDir> [--dry-run]');
  const dryRun = process.argv.includes('--dry-run');
  const result = await executeSetup({ dir, dryRun });
  if (result.blocker?.code === wixAuth.WIX_AUTH_EXPIRED) {
    console.error(result.blocker.description);
    process.exit(await wixAuth.stopExitCode(Object.assign(new wixAuth.WixAuthInterruption(result.blocker.reason), { siteId: (await readEnv(dir)).WIX_SITE_ID }), dir));
  }
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
