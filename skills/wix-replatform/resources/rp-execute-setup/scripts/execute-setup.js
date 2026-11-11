#!/usr/bin/env node
'use strict';

const capabilities = require('../../../lib/execution-capability');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {assertCollectionCompatibility}=require('../../../lib/cms-collection-compatibility.js');
const { normalizeCmsCollectionDefinition } = require('../../../lib/cms-collection-request.js');
const REAL_WRITERS = require('../../rp-target-wix/lib/wix-writers.js');
const { SCHEMA_KIND: CONTACT_V4_SCHEMA_KIND } = require('../../rp-target-wix/lib/contact-extended-fields.js');
const { hashArtifact } = require('../../../lib/artifact-freshness.js');
const { validatePlanShape, validateSetupVerification } = require('../../../lib/setup-verification.js');
const { SETUP_CHECK_METHODS } = require('../../../lib/setup-check-methods.js');
const siteRegional = require('../../../lib/site-regional.js');
const catalogBaseline = require('../../../lib/catalog-baseline.js');
const wixAuth = require('../../../lib/wix-auth.js');
const { HARMONY_EDITOR_TYPE } = require('../../../lib/editor-type.js');

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

// Any other app needs no line here: a step that carries its own app id installs it,
// `{ "id": "<any unique id>", "kind": "installApp", "appDefId": "<app id>" }`. The lines above stay as
// names the planner and the dependency gate already use.
const APP_DEF_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function appIdForStep(step) {
  if (step.kind === 'installApp') return APP_DEF_ID.test(step.appDefId) ? step.appDefId.toLowerCase() : null;
  return APPS[step.id] || INSTALL_STEPS[step.id] || null;
}

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
  return { method: created ? SETUP_CHECK_METHODS.MEMBER_CREATE_RESPONSE : SETUP_CHECK_METHODS.MEMBER_READ, observed: { memberId: member.id } };
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

  const fieldSchema = requirement.fieldSchemaPerCollection;
  const fields = Array.isArray(fieldSchema) ? fieldSchema.map((f) => ({
    key: f?.key,
    type: f?.type,
    displayName: f?.displayName,
    ...(f?.required ? { required: true } : {}),
    ...(f?.typeMetadata ? {typeMetadata:f.typeMetadata} : {}),
  })) : fieldSchema;

  if (!Array.isArray(requirement.collections)) {
    throw new Error('create-cms-collections requirement has no collections array');
  }
  // Normalize and validate every definition before the first create request. In
  // particular, mapping permission presets are expanded to the object required by
  // Wix Data, while malformed field/permission values fail with their exact path.
  const expectedCollections = requirement.collections.map((collection, index) => normalizeCmsCollectionDefinition({
    id: collection?.id,
    displayName: collection?.displayName,
    fields: collection?.fields || fields,
    permissions: collection?.permissions || requirement.permissions,
  }, { path: `collections[${index}]` }));

  const existing = await wix.send(writers.buildListCmsCollectionsRequest());
  const existingIds = new Set((existing.collections || []).map((c) => c.id));

  for (const expected of expectedCollections) {
    if (!existingIds.has(expected.id)) {
      try {
        await writers.ensureCmsCollection(wix, expected);
      } catch(error) {
        if (wixAuth.isRunInterruption(error)) throw error;
        if (error.status!==409 && error.statusCode!==409) throw error;
        // A concurrent create is not evidence of compatible fields or permissions.
      }
    }
    const current=await wix.send(writers.buildGetCmsCollectionRequest(expected.id));
    assertCollectionCompatibility(current.collection,expected);
  }
  return { method: SETUP_CHECK_METHODS.COLLECTION_READ, observed: { collections: expectedCollections.map(c => c.id) } };
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

// --- Harmony: any app through the editor's installation service ------------------------------
// The generic app installer leaves a Harmony site without the pages an app adds. On a Harmony site
// setup installs every app (and the companion apps its widgets need) through the editor's own
// installation service. See EDITOR_INSTALL_COMPANIONS in wix-writers.js for the companion table.
const EDITOR_INSTALL_RETRY_STATUS = new Set([409, 428, 503]);
const EDITOR_INSTALL_BUSY = /progress|busy|outdated|not ready/i;
const EDITOR_INSTALL_RETRIES = 3;
const EDITOR_INSTALL_DEADLINE_MS = 200_000; // the service's own time budget is 180 s
const EDITOR_READ_ATTEMPTS = 3;
const READBACK_POLLS = 8;
const READBACK_WAIT_MS = 10_000;
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function blockerError(blockerCode, message, recommendedAction, diagnostic) {
  return Object.assign(new Error(message), { blockerCode, recommendedAction, ...(diagnostic ? { diagnostic } : {}) });
}

// An install that Wix has not proven stops the run and asks the user. Setup never retries by itself: it
// runs again only when the user says so. `diagnostic` is one findable record of the stop (the blocker
// file and the setup result carry it; the skill tells the agent to quote it): the step, the apps, the
// site, which installer, which stage, the HTTP status and Wix's own words.
const ASK_RETRY = "Ask the user whether to retry the install, and run setup again only when they say so. They can say retry, or add the app themselves from the Business Manager app market or the editor's normal Add Apps flow. Do not add an app's pages by hand.";
// Names come from the install steps ('install-wix-gift-cards' reads "Wix gift cards"); a few read better by hand.
const APP_LABELS = Object.freeze({
  ...Object.fromEntries(Object.entries(INSTALL_STEPS).map(([step, id]) => [id, step.replace(/^install-/, '').replace(/-/g, ' ').replace(/^wix /, 'Wix ')])),
  [catalogBaseline.STORES_APP_DEF_ID]: 'Wix Stores',
  [REAL_WRITERS.RICH_TEXT_VIEWER_APP_DEF_ID]: 'the rich-text viewer app',
  [REAL_WRITERS.WIX_BOOKINGS_APP_DEF_ID]: 'Wix Bookings',
});
const labelled = (apps) => apps.map((id) => (APP_LABELS[id] ? `${APP_LABELS[id]} (${id})` : id)).join(', ');
function installStop({ code, stepId, apps, siteId, what, route, stage, http = null, serviceError = null }) {
  // What the user is told depends on what stopped: a record that could not be written means nothing was sent;
  // on the editor route the list can show an app that was never installed; on the ordinary route it cannot.
  const message = stage === 'record'
    ? `${stepId}: setup could not write its record of this install, so it did not send this call for ${labelled(apps)}: ${what}. Ask the user whether to retry the install.`
    : `${stepId}: Wix did not confirm that ${labelled(apps)} was installed: ${what}.${route === 'editor-installation' ? " The app may be missing from Business Manager and the editor even if the site's app list shows it." : ''} Ask the user whether to retry the install.`;
  return blockerError(code, message, ASK_RETRY,
    { step: stepId, apps, site: siteId, route, stage, http, serviceError: serviceError ? String(serviceError).replace(/\s+/g, ' ').slice(0, 300) : null });
}

// The wix client has no deadline for writes; a call the service never answers must end the step
// with an uncertain outcome, not hang setup. The listing is read first on a re-run.
function withDeadline(promise, ms, onExpire) {
  let timer;
  const expiry = new Promise((_, reject) => { timer = setTimeout(() => reject(onExpire()), ms); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

// The editor the destination step recorded for this project's site, or null. A record that names
// another site than the one being set up is a leftover and is not trusted.
async function recordedEditorType(dir, siteId) {
  const record = await readJsonIfExists(path.join(dir, 'orchestration', 'destination.json')).catch(() => null);
  if (!record || typeof record.observedEditorType !== 'string' || !record.observedEditorType) return null;
  if (record.metaSiteId && siteId && record.metaSiteId !== siteId) return null;
  return record.observedEditorType;
}

// Which editor the destination opens in: the site itself (a few reads, with short waits between
// them), then the destination step's record. Unknown from both blocks: guessing "not Harmony" would
// install the app the way that leaves a Harmony site without pages.
async function resolveEditorType(dir, wix, writers, stepId, sleep, siteId) {
  if (typeof writers.getEditorType !== 'function') throw new Error(`${stepId}: the writer set has no getEditorType; the step cannot choose its install route`);
  let cause = 'the answer named no editor';
  for (let attempt = 1; attempt <= EDITOR_READ_ATTEMPTS; attempt += 1) {
    try {
      const editorType = await writers.getEditorType(wix);
      if (editorType) return editorType;
    } catch (error) {
      if (error.blockerCode || wixAuth.isRunInterruption(error)) throw error;
      cause = error.status ? `HTTP ${error.status}` : String(error.message || error).slice(0, 120);
      // A refused or missing answer does not change on a second try.
      if ([401, 403, 404].includes(error.status)) break;
    }
    if (attempt < EDITOR_READ_ATTEMPTS) await sleep(2000 * attempt);
  }
  const recorded = await recordedEditorType(dir, siteId);
  if (recorded) return recorded;
  throw blockerError('EDITOR_TYPE_UNKNOWN', `${stepId}: the site's editor type could not be read (${cause}) and the destination step recorded none`,
    'Re-run setup. Apps are installed differently on a Harmony site, so setup does not guess the editor. If the read keeps failing, run the destination step so the site\'s editor is recorded, or check that the Wix CLI login can read the site.');
}

// One read of the installed-apps list (the client paces every read), tested locally.
async function listedApps(wix, writers, ids) {
  const apps = await writers.getInstalledWixApps(wix);
  const listed = new Set((apps || []).filter((app) => app && app.enabled !== false).map((app) => app.appDefId));
  return new Set(ids.filter((id) => listed.has(id)));
}

// Setup cannot read a Harmony site's pages. This durable record (setup/harmony-app-pages.json) names
// the apps installed on the Harmony route whose pages were not read (`apps`), the apps the service said
// have no editor part (`noEditorPart`, so a re-run does not turn them into pages to confirm), and the
// apps it refused (`deferred`: no longer written; a refused app is installed with the ordinary installer
// and recorded under `apps`), and the apps whose install call is not proven yet (`unconfirmed`: written
// before the call is sent and cleared once proven, so any stop leaves it and the next run sends the app
// again even when the list shows it). It survives the per-run rewrite of the setup receipt, so the owner's items
// cannot vanish because a later setup run blocked. Only `unconfirmed` rows are removed (once proven);
// the owner's confirmation of `apps` is never inferred.
const APP_PAGES_RECORD = path.join('setup', 'harmony-app-pages.json');
async function readAppPages(dir, siteId) {
  // Only a missing file means "no record"; an unreadable one fails loudly instead of being rewritten.
  const prior = await readJsonIfExists(path.join(dir, APP_PAGES_RECORD));
  const same = Boolean(prior) && prior.siteId === siteId;
  const list = (key) => (same && Array.isArray(prior[key]) ? prior[key] : []);
  return { apps: list('apps'), noEditorPart: list('noEditorPart'), deferred: list('deferred'), unconfirmed: list('unconfirmed') };
}
async function writePages(dir, siteId, prior, next) {
  if (['apps', 'noEditorPart', 'deferred', 'unconfirmed'].every((key) => JSON.stringify(next[key]) === JSON.stringify(prior[key]))) return prior;
  await publishAtomically(path.join(dir, APP_PAGES_RECORD), `${JSON.stringify({ schemaVersion: 1, siteId, appPages: 'not-read', ...next }, null, 2)}\n`);
  return next;
}
// The record without these apps in any list: an app lives in one list only.
const withoutApps = (record, appDefIds) => {
  const ids = new Set(appDefIds);
  return {
    apps: record.apps.filter((row) => !ids.has(row.appDefId)),
    noEditorPart: record.noEditorPart.filter((id) => !ids.has(id)),
    deferred: record.deferred.filter((row) => !ids.has(row.appDefId)),
    unconfirmed: record.unconfirmed.filter((row) => !ids.has(row.appDefId)),
  };
};
// `outcome` is where the step's app belongs: 'apps' or 'noEditorPart' ('deferred' is no longer written).
// Returns the record as written.
async function recordAppPages(dir, siteId, prior, { appDefId, stepId, outcome }) {
  const next = withoutApps(prior, [appDefId]);
  if (outcome === 'noEditorPart') next.noEditorPart.push(appDefId); else next[outcome].push({ appDefId, stepId });
  return writePages(dir, siteId, prior, next);
}
// Written BEFORE an editor call is sent, in one write for every app of the call; an app already unconfirmed keeps its row.
async function markUnconfirmed(dir, siteId, prior, appDefIds, stepId, reason) {
  const kept = prior.unconfirmed.filter((row) => appDefIds.includes(row.appDefId));
  const fresh = appDefIds.filter((id) => !kept.some((row) => row.appDefId === id)).map((appDefId) => ({ appDefId, stepId, reason }));
  // Only `unconfirmed` changes: the owner's "confirm each app's pages" rows stay until the step passes and refiles the app.
  return writePages(dir, siteId, prior, { ...prior, unconfirmed: [...prior.unconfirmed.filter((row) => !appDefIds.includes(row.appDefId)), ...kept, ...fresh] });
}
// Cleared once the apps are proven: Wix's answer and the list (or the ordinary installer and the list).
async function clearUnconfirmed(dir, siteId, prior, appDefIds) {
  return writePages(dir, siteId, prior, { ...prior, unconfirmed: prior.unconfirmed.filter((row) => !appDefIds.includes(row.appDefId)) });
}

// Installs every missing app of `wanted` in one batch, then reads the listing back until all of
// `wanted` are listed and enabled. The listing lags the install, so an app the service already
// reported as installed is never sent again, whatever the listing says. Returns `sent` (the apps this
// run sent through the editor route and the service reported as installed), `noEditorPart` (apps
// the service says have no editor part) and `refused` (apps it refused for a known reason); the caller
// installs both the ordinary way and reads the list back.
async function installOnHarmony({ stepId, wanted, siteId, dir, pages, wix, writers, timing }) {
  const sleep = timing.sleep || realSleep;
  const deadlineMs = timing.installDeadlineMs ?? EDITOR_INSTALL_DEADLINE_MS;
  const sent = new Set();
  const noEditorPart = new Set();
  const refused = new Set();
  const stop = (code, apps, what, stage, { http = null, serviceError = null } = {}) =>
    installStop({ code, stepId, apps, siteId, what, route: 'editor-installation', stage, http, serviceError });
  const refuse = (apps, what, extra) => stop('APP_INSTALL_NOT_VERIFIED', apps, `the editor installation service answered: ${what}`, 'editor-call', extra);
  const uncertain = (apps, why, http, serviceError) => stop('APP_INSTALL_OUTCOME_UNCERTAIN', apps, `${why}, so the outcome is unknown`, 'editor-call', { http, serviceError });
  // Write-ahead: every app of a call is written down as unconfirmed BEFORE the call is sent and leaves the record
  // only once it is proven (the caller clears it after the list read-back). So every stop, a killed process
  // included, leaves the app recorded, and the next run sends it again even when the list shows it. A record
  // that cannot be written means the call is not sent.
  const unconfirmed = new Set(pages.record.unconfirmed.map((row) => row.appDefId));
  const writeAhead = async (apps) => {
    try {
      pages.record = await markUnconfirmed(dir, siteId, pages.record, apps, stepId, 'the install call was sent and is not proven yet');
    } catch (writeError) {
      throw stop('APP_INSTALL_NOT_VERIFIED', apps, `the record file could not be written (${writeError.code || 'write error'})`, 'record');
    }
    for (const id of apps) unconfirmed.add(id);
  };
  for (let attempt = 0; ; attempt += 1) {
    const listed = await listedApps(wix, writers, wanted);
    const missing = wanted.filter((id) => (!listed.has(id) || unconfirmed.has(id)) && !sent.has(id) && !noEditorPart.has(id) && !refused.has(id));
    if (!missing.length) break;
    // true = wait and go round again; false = out of retries.
    const again = async () => {
      if (attempt >= EDITOR_INSTALL_RETRIES) return false;
      await sleep(5000 * (attempt + 1));
      return true;
    };
    await writeAhead(missing);
    let reply;
    try {
      reply = await withDeadline(writers.installEditorApps(wix, { appDefIds: missing, siteId }), deadlineMs,
        () => uncertain(missing, `the editor installation service did not answer within ${Math.round(deadlineMs / 1000)} s`));
    } catch (error) {
      if (error.blockerCode || wixAuth.isRunInterruption(error)) throw error;
      if (EDITOR_INSTALL_RETRY_STATUS.has(error.status) && await again()) continue;
      // A gateway timeout, any other 5xx, or a reply nobody can classify may still have installed.
      if (error.outcomeKnown === false || error.status >= 500) throw uncertain(missing, `the install call failed with ${error.status || 'a transport error'}`, error.status ?? null, error.message);
      throw refuse(missing, `HTTP ${error.status ?? 'error'}`, { http: error.status ?? null, serviceError: error.message });
    }
    if (!reply || !Array.isArray(reply.results)) throw refuse(missing, 'the reply had no results list');
    const allFailures = reply.results.filter((row) => !row || row.success !== true)
      .map((row) => ({ appDefId: row?.appDefId ?? null, error: String(row?.error ?? 'install reported no success') }));
    // An app the service says has no editor part is not a failure: it adds no pages, and the caller
    // installs it with the generic installer.
    // An app the service refuses for a known reason (a page-path conflict, a missing editor component) is
    // not a failure either: the caller installs it with the generic installer and the list read-back
    // decides. Any other failure (busy, a timeout, a permission error, an unnamed row) behaves as before.
    const isNoEditorPart = (row) => Boolean(row.appDefId) && REAL_WRITERS.NO_EDITOR_PART_ERROR.test(row.error);
    const isRefusal = (row) => missing.includes(row.appDefId) && !isNoEditorPart(row)
      && (REAL_WRITERS.PAGE_PATH_CONFLICT_ERROR.test(row.error) || REAL_WRITERS.EDITOR_COMPONENT_MISSING_ERROR.test(row.error));
    for (const row of allFailures) {
      if (isNoEditorPart(row)) noEditorPart.add(row.appDefId);
      else if (isRefusal(row)) refused.add(row.appDefId);
    }
    const failures = allFailures.filter((row) => !isNoEditorPart(row) && !isRefusal(row));
    // An app counts as sent only when the reply has a success row naming it; a row without an app id,
    // or an app with no row at all, is never read as success.
    const okIds = new Set(reply.results.filter((row) => row && row.success === true && row.appDefId).map((row) => row.appDefId));
    const failedIds = new Set(allFailures.map((row) => row.appDefId).filter(Boolean));
    for (const id of missing) if (okIds.has(id)) sent.add(id);
    // A failure row that names no app speaks for every app that has no row of its own.
    const unaccounted = failures.some((row) => !row.appDefId) ? [] : missing.filter((id) => !okIds.has(id) && !failedIds.has(id));
    if (failures.length || unaccounted.length) {
      const busyOnly = failures.every((row) => EDITOR_INSTALL_BUSY.test(row.error)) && !unaccounted.length;
      if (busyOnly && await again()) continue;
      const said = [...failures.map((row) => `${row.appDefId || 'unnamed'}: ${row.error.slice(0, 200)}`), ...unaccounted.map((id) => `${id}: the reply had no row for it`)].join('; ');
      const failedApps = [...new Set([...failures.map((row) => row.appDefId).filter(Boolean), ...unaccounted])];
      throw refuse(failedApps.length ? failedApps : missing, said.slice(0, 200), { serviceError: said });
    }
    break;
  }
  // The listing lags the install: poll before calling an app missing.
  const toVerify = wanted.filter((id) => !noEditorPart.has(id) && !refused.has(id));
  let absent = toVerify;
  for (let poll = 1; poll <= READBACK_POLLS; poll += 1) {
    const listed = await listedApps(wix, writers, toVerify);
    absent = toVerify.filter((id) => !listed.has(id));
    if (!absent.length) break;
    if (poll < READBACK_POLLS) await sleep(timing.readbackWaitMs ?? READBACK_WAIT_MS);
  }
  if (absent.length) {
    throw stop('APP_INSTALL_NOT_VERIFIED', absent, 'the install call returned but the app is not listed as installed and enabled on the site', 'read-back');
  }
  return { sent: [...sent], noEditorPart: [...noEditorPart], refused: [...refused] };
}

// Returns the check that actually ran: `{ method, observed }` (see SETUP_CHECK_METHODS in
// lib/setup-check-methods.js). The caller stamps `checkedAt` once it returns. An install with no
// read-back records `install-response` -- what was observed, never a claimed read.
// An install call that returns 200 proves nothing about the site: the step passes only when the
// installed-apps list read back afterwards names the app and it is enabled. An app that is listed and not
// recorded as unproven is a pass without a second install call; a recorded one is sent again.
async function installAndVerifyApp(stepId, appDefId, { dir, env, wix, writers, catalogSettle = {} }) {
  const listed = async (id = appDefId) => (writers.isWixAppInstalled ? writers.isWixAppInstalled(wix, id) : false);
  // Any app takes the editor route; `companions` are the extra apps a particular app's widgets need.
  const companions = REAL_WRITERS.editorInstallCompanions(appDefId);
  const installed = await listed();
  // The record is read once (on Harmony) and shared by the step; an app in it is not proven.
  const pages = { record: { apps: [], noEditorPart: [], deferred: [], unconfirmed: [] } };
  let editorType;
  try {
    editorType = await resolveEditorType(dir, wix, writers, stepId, catalogSettle.sleep || realSleep, env.WIX_SITE_ID);
  } catch (error) {
    // An app that is already listed needs no install, so an unreadable editor does not block it; only
    // the Harmony companion repair is skipped, and the record says the route was not determined. An app the
    // record names as unproven is the exception: it cannot pass on the list alone.
    if (error.blockerCode !== 'EDITOR_TYPE_UNKNOWN' || !installed) throw error;
    if ((await readAppPages(dir, env.WIX_SITE_ID)).unconfirmed.some((row) => row.appDefId === appDefId)) throw error;
    editorType = null;
  }
  const harmony = editorType === HARMONY_EDITOR_TYPE;
  // The record is Harmony's: other editors never read or write it.
  if (harmony) pages.record = await readAppPages(dir, env.WIX_SITE_ID);
  const recorded = pages.record.unconfirmed.some((row) => row.appDefId === appDefId);
  // The ordinary install: one call, then the listing must name the app.
  const genericInstall = async (id, { poll = false } = {}) => {
    try {
      await writers.installWixApp(wix, { appDefId: id, siteId: env.WIX_SITE_ID });
    } catch (error) {
      // Only Wix's answer or a lost connection is an unproven install; a defect of our own surfaces as it always did.
      const fromWix = error.status !== undefined || error.outcomeKnown === false || /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|fetch failed|network/i.test(String(error.message));
      if (error.blockerCode || wixAuth.isRunInterruption(error) || (!poll && !fromWix)) throw error;
      throw installStop({ code: 'APP_INSTALL_NOT_VERIFIED', stepId, apps: [id], siteId: env.WIX_SITE_ID, what: poll ? 'the editor installer refused the app and the ordinary install failed' : 'the ordinary install call failed', route: 'app-installer', stage: poll ? 'fallback-call' : 'install-call', http: error.status ?? null, serviceError: error.message });
    }
    // The listing lags an install, so the fallback (the editor route's own rule) polls before it calls the app missing.
    for (let read = 1; poll && read < 3 && !(await listed(id)); read += 1) await (catalogSettle.sleep || realSleep)(catalogSettle.readbackWaitMs ?? READBACK_WAIT_MS);
    if (!(await listed(id))) {
      throw installStop({ code: 'APP_INSTALL_NOT_VERIFIED', stepId, apps: [id], siteId: env.WIX_SITE_ID, what: 'the install call returned but the app is not listed as installed and enabled on the site', route: 'app-installer', stage: 'read-back' });
    }
  };
  // Harmony: the app and its companions in one batch (the service installs the app's own dependencies).
  // An app the service says has no editor part is installed the ordinary way.
  let sentViaEditor = [];
  let noEditorPart = [];
  let refused = [];
  const harmonyInstall = async () => {
    const wanted = [...companions, appDefId];
    const result = await installOnHarmony({ stepId, wanted, siteId: env.WIX_SITE_ID, dir, pages, wix, writers, timing: catalogSettle });
    sentViaEditor = result.sent;
    noEditorPart = result.noEditorPart;
    refused = result.refused;
    for (const id of noEditorPart) await genericInstall(id);
    for (const id of refused) await genericInstall(id, { poll: true });
    // Every app of this call is now proven (Wix's answer or the ordinary installer, and the list), so none is
    // unconfirmed any more, whatever the rest of the step does. The step's own app is filed below.
    pages.record = await clearUnconfirmed(dir, env.WIX_SITE_ID, pages.record, wanted);
  };
  const install = harmony ? harmonyInstall : () => genericInstall(appDefId);
  // On a Harmony site that already lists the app, only the missing companions are installed, and
  // before the catalog baseline is read so the baseline sees the final catalog.
  // An app written down as unconfirmed is sent again even though the list shows it, and the catalog
  // baseline is told it was not installed before this step, so it reuses the first attempt's record.
  const unconfirmedSelf = harmony && recorded;
  if (harmony && installed && !unconfirmedSelf && companions.length) await harmonyInstall();
  // Wix Stores adds sample products when it installs. The catalog is read around the install, the
  // items it added are deleted, and the rest is recorded so no importer takes them over.
  let catalog = {};
  if (appDefId === catalogBaseline.STORES_APP_DEF_ID) {
    let baseline, unchanged;
    try {
      ({ baseline, unchanged } = await catalogBaseline.captureAroundInstall({ projectDir: dir, wix, writers, installed: installed && !unconfirmedSelf, install, siteOrigin: siteRegional.siteOriginFor(dir, env.WIX_SITE_ID), ...catalogSettle }));
    } catch (error) {
      if (error.blockerCode || wixAuth.isRunInterruption(error)) throw error;
      throw Object.assign(new Error(`${stepId}: the Stores catalog could not be read around the install: ${error.message}`), {
        blockerCode: 'CATALOG_BASELINE_UNREADABLE',
        recommendedAction: 'Re-run setup. Import cannot start until setup has recorded which products were on the store before it.',
      });
    }
    catalog = { catalogBaseline: { artifact: catalogBaseline.BASELINE_PATH, sha256: catalogBaseline.digest(dir), unchanged, ...catalogBaseline.summarize(baseline) } };
  } else if (!installed || unconfirmedSelf) await install();
  // An app the service says has no editor part (this run, or an earlier one on record) adds no pages,
  // so none are unconfirmed. An app it refused was installed with the ordinary installer: its step reports
  // `installed: true` and the owner's 'confirm each app's pages' item covers it.
  let viaEditor = false;
  if (harmony) {
    const prior = pages.record;
    const wasRefused = refused.includes(appDefId);
    // "Nothing to add" for an app that was unconfirmed means the first send may have finished late, so the
    // app keeps its "confirm each app's pages" item: it is filed under `apps`, never `noEditorPart`.
    viaEditor = unconfirmedSelf || (!noEditorPart.includes(appDefId) && !prior.noEditorPart.includes(appDefId));
    // A refused app is installed, but its editor pages are unconfirmed, so it is an `apps` row too.
    await recordAppPages(dir, env.WIX_SITE_ID, prior, { appDefId, stepId, outcome: viaEditor ? 'apps' : 'noEditorPart' });
    if (wasRefused) return { method: SETUP_CHECK_METHODS.INSTALLED_APPS_READ, observed: { appDefId, installed: true, installCall: 'succeeded', ...catalog, route: 'app-installer', reason: 'editor_refused' } };
  }
  // `installCall` only when this run installed the app itself.
  const ranInstall = harmony ? [...sentViaEditor, ...noEditorPart].includes(appDefId) : !installed;
  const route = viaEditor ? { route: 'editor-installation', appPages: 'not-read' }
    : harmony ? { route: 'app-installer', reason: 'no_editor_part' }
      : editorType ? { route: 'app-installer', reason: `editor_${editorType}` } : { route: 'not-determined' };
  return { method: SETUP_CHECK_METHODS.INSTALLED_APPS_READ, observed: { appDefId, installed: true, ...(ranInstall ? { installCall: 'succeeded' } : {}), ...catalog, ...route } };
}

async function runStep(step, { dir, env, wix, writers, priorExtendedFieldVerification = null, catalogSettle }) {
  if (await isRegionalStep(step, dir)) {
    const requirements = await readJsonIfExists(path.join(dir, 'setup', 'setup-requirements.json'));
    const list = Array.isArray(requirements) ? requirements : requirements?.requirements;
    const requirement = (list || []).find((item) => item && item.kind === 'siteLocale') || {};
    const regional = await siteRegional.executeRegionalStep({ projectDir: dir, wix, writers, siteId: env.WIX_SITE_ID, requirement });
    // The receipt's fields are the read-back this step performed; the check records what was observed.
    return { method: SETUP_CHECK_METHODS.SITE_PROPERTIES_READ, observed: { fields: Object.fromEntries(Object.entries(regional.fields || {}).map(([field, row]) => [field, row.action])) }, regional };
  }
  if (step.id === 'mute-site-notifications') {
    const state = await writers.muteSiteNotifications(wix, { reason: `RePlatform migration — ${path.basename(dir)}` });
    if (!state?.muted) throw new Error('notification mute verification failed');
    const read = await writers.getSiteMuteState(wix);
    if (read?.muted !== true) throw new Error('notification mute verification failed: status read is not muted');
    return { method: SETUP_CHECK_METHODS.STATUS_READ, observed: { muted: true } };
  }
  if (step.id === 'start-back-in-stock-collection') {
    await wix.send(writers.buildStartBackInStockCollectionRequest());
    const read = await wix.send(writers.buildGetBackInStockSettingsRequest());
    const stores = (read?.settings?.collectionStates || []).find((row) => row.appId === catalogBaseline.STORES_APP_DEF_ID);
    if (stores?.collectingRequests !== true) throw new Error('back-in-stock collection verification failed: settings read does not show collecting for Wix Stores');
    return { method: SETUP_CHECK_METHODS.SETTINGS_READ, observed: { collectingRequests: true } };
  }
  if (step.kind === 'installApp' && !appIdForStep(step)) {
    throw blockerError('INSTALL_APP_ID_INVALID', `${step.id}: an installApp step needs "appDefId" set to the app's id (a GUID)`, 'Fix the step in the setup plan and re-run setup.');
  }
  const appDefId = appIdForStep(step);
  if (appDefId) return installAndVerifyApp(step.id, appDefId, { dir, env, wix, writers, catalogSettle });
  if (await isExtendedFieldStep(step, dir)) {
    const verifications = await provisionExtendedFieldsStep({ dir, wix, writers, dryRun: false, priorVerification: priorExtendedFieldVerification });
    return { method: SETUP_CHECK_METHODS.EXTENDED_FIELD_VERIFICATION, observed: { verifications: verifications.length } };
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
    return { method: SETUP_CHECK_METHODS.CATALOG_VERSION_READ, observed: { catalogVersion: result.catalogVersion } };
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
      return { method: SETUP_CHECK_METHODS.REFERENCE_READ_BACK, observed: { writerId: step.intent.writerId, readWriterId: step.intent.readWriterId } };
    }
    return { method: SETUP_CHECK_METHODS.WRITER_RESPONSE, observed: { writerId: step.intent.writerId } };
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

// A dry run cannot install. The route it expects comes from the destination step's record, never from a
// call to the editor: the live run reads the site again, so the intent says what its basis is. For
// Stores it also states the sample-product rule it would apply (and makes no delete call).
async function appDryRunIntent(dir, siteId, appDefId) {
  const recorded = await recordedEditorType(dir, siteId);
  const route = !recorded ? { route: 'decided-at-run-time', routeBasis: 'no destination record' }
    : recorded === HARMONY_EDITOR_TYPE ? { route: 'editor-installation', routeBasis: 'destination record; the live run reads the site again' }
      : { route: 'app-installer', routeBasis: 'destination record; the live run reads the site again' };
  if (appDefId !== catalogBaseline.STORES_APP_DEF_ID) return route;
  const prior = catalogBaseline.loadBaseline(dir);
  return prior
    ? { catalogBaseline: 'recorded', wouldDelete: prior.products.concat(prior.categories).filter((row) => row.kind === 'install_seeded' && row.status !== 'deleted').map((row) => row.id), ...route }
    : { catalogBaseline: 'read before and after the install; delete only items the install adds', wouldDelete: 'unknown until install', ...route };
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
        : appIdForStep(step) ? await appDryRunIntent(dir, env.WIX_SITE_ID, appIdForStep(step)) : null;
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
        ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
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
  if (result.blocker) throw new Error(result.blocker.diagnostic ? `${result.blocker.description}\nDIAGNOSTIC ${JSON.stringify(result.blocker.diagnostic)}` : result.blocker.description);
  console.log(JSON.stringify({ ok: true, dryRun }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { executeSetup, runStep };
