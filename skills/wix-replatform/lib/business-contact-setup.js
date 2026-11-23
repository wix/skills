'use strict';

// The source store's business address, applied to the Wix site as one setup step
// (`import-business-contact`, entity `site/business-contact`).
//
// rp-execute-setup's SKILL.md has long required this write, but nothing scheduled it: setup discovery
// never emitted a step and the executor had none, so runs either stopped or hand-wrote the plan. The
// pair is now emitted by the same deterministic call that emits the site-locale pair
// (`scripts/site-regional.js emit`, run by rp-setup-discovery before it stamps the plan), so the approved
// plan carries it and every reader of the plan agrees. The step runs in execute-setup.js.
//
// The step: read data/store-settings-general.json (capturing it from the WordPress source first when it
// is missing), build the address with store-config-build.js, read the site, write only when the site's
// address differs, read again and compare. The comparison is against `properties.address` of
// GET /site-properties/v4/properties -- the read has no `businessContact` object. Every field the run
// sent must come back equal; fields it did not send are ignored (Wix returns them as empty strings).
// A source with no address is a recorded no-op, not a failure.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const STEP_ID = 'import-business-contact';
const KIND = 'businessContact';
const ENTITY_REF = 'site/business-contact';
const CAPTURE_FILE = path.join('data', 'store-settings-general.json');
const SOURCE_CONFIG = path.join('config', 'source.woocommerce.env');

function readJsonSync(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

// Only a WordPress/WooCommerce source has this capture. Any other source gets no step.
function applies(projectDir) {
  return fs.existsSync(path.join(projectDir, SOURCE_CONFIG)) || fs.existsSync(path.join(projectDir, CAPTURE_FILE));
}

function stepConfiguresBusinessContact(step) {
  return Boolean(step) && (step.id === STEP_ID || step.kind === KIND);
}

function buildBusinessContactStep() {
  return { id: STEP_ID, kind: KIND, entityRefs: [ENTITY_REF] };
}

function buildBusinessContactRequirement() {
  return { id: STEP_ID, kind: KIND, entityRefs: [ENTITY_REF], source: CAPTURE_FILE.split(path.sep).join('/'), severity: 'blocker', automation: 'automatable',
    expected: "the site's business address equals the source store's address, or the source has none" };
}

// Adds the requirement/step pair right after the site-locale pair (else after notification safety).
// Idempotent: a re-run replaces the pair. A project whose source has no store settings gets none, and
// an earlier pair is removed.
async function emitBusinessContactSetup(projectDir) {
  const planFile = path.join(projectDir, 'setup', 'setup-plan.json');
  const reqFile = path.join(projectDir, 'setup', 'setup-requirements.json');
  const plan = readJsonSync(planFile);
  const declared = readJsonSync(reqFile);
  if (!plan || !Array.isArray(plan.steps) || !declared) return { emitted: false, reason: 'setup-artifacts-missing' };
  const isArray = Array.isArray(declared);
  const list = (isArray ? declared : declared.requirements || []).filter((item) => !(item && item.id === STEP_ID));
  const steps = plan.steps.filter((step) => !(step && step.id === STEP_ID));
  const emitted = applies(projectDir);
  if (emitted) {
    const insert = (rows, value) => {
      let index = rows.findIndex((row) => row && row.id === 'import-site-locale');
      if (index < 0) index = rows.findIndex((row) => row && row.id === 'mute-site-notifications');
      rows.splice(index < 0 ? 0 : index + 1, 0, value);
    };
    insert(steps, { ...buildBusinessContactStep(), action: STEP_ID });
    insert(list, buildBusinessContactRequirement());
  }
  await writeJsonAtomic(planFile, { ...plan, steps });
  await writeJsonAtomic(reqFile, isArray ? list : { ...declared, requirements: list });
  return { emitted, ...(emitted ? {} : { reason: 'no-store-settings-source' }) };
}

// Every field the run sent must read back equal. Fields it did not send are not compared.
function addressMismatches(actual, expected) {
  return Object.keys(expected || {}).filter((key) => (actual || {})[key] !== expected[key]).sort();
}

// A business-address issue the Cutover Operator fixes in Business Manager (no migration
// environment needed). Kept on the step's verification so the completion report joins it.
function businessAddressAction(code, why, todo) {
  return {
    actionId: `${code}:${STEP_ID}`,
    code,
    role: 'cutover-operator',
    severity: 'medium',
    entity: ENTITY_REF,
    affectedCount: 1,
    affectedIds: [ENTITY_REF],
    artifactRefs: ['setup/setup-verification.json', CAPTURE_FILE],
    prerequisites: ['Business Manager access to the new site'],
    action: `Cutover Operator, in Business Manager: ${todo}`,
    resolutionEvidence: 'Business Info shows the store address the merchant expects',
    deadlineReason: `Resolve before launch: ${why}.`,
  };
}

// Operator-action rows for completion-report.json, from the business-contact step's recorded
// verification. Never throws for a missing or damaged file.
function businessContactOperatorActions(projectDir) {
  const verification = readJsonSync(path.join(projectDir, 'setup', 'setup-verification.json'));
  const rows = Array.isArray(verification?.requirements) ? verification.requirements : [];
  return rows.filter((row) => row && row.id === STEP_ID && row.verification?.observed?.operatorAction)
    .map((row) => row.verification.observed.operatorAction);
}

// `capture` reads the source (WordPress application password); injectable for tests.
async function executeBusinessContactStep({ projectDir, wix, writers, capture = null }) {
  const storeConfig = require('../resources/rp-target-wix/lib/store-config-build.js');
  let settings = readJsonSync(path.join(projectDir, CAPTURE_FILE));
  let captured = false;
  if (!settings) {
    if (!fs.existsSync(path.join(projectDir, SOURCE_CONFIG))) return { action: 'no-source-capture', addressFields: [], notes: ['The source has no store settings to read; nothing to write.'] };
    const run = capture || require('../resources/rp-source-wordpress/scripts/capture-store-settings.js').captureStoreSettings;
    try { settings = (await run(projectDir)).settings; captured = true; } catch (error) {
      // The business address is one site setting, not a prerequisite of any record: report it
      // as a cutover task and let setup continue.
      if (error && error.interruption === true) throw error;
      return { action: 'source-capture-failed', addressFields: [], notes: [`The source store settings could not be read: ${String(error.message || error).slice(0, 300)}`],
        operatorAction: businessAddressAction('business-address-not-imported', 'the source store settings could not be read, so the site has no business address from the source',
          'Enter the store\'s business address in Business Manager > Settings > Business Info.') };
    }
  }
  const { businessContact, notes } = storeConfig.buildBusinessContactInput(settings);
  if (!businessContact) return { action: 'no-source-address', addressFields: [], notes, ...(captured ? { captured: true } : {}) };
  const expected = businessContact.address;
  const before = await writers.getSiteProperties(wix);
  let action = 'already-matched';
  let after = before;
  // A write is never a no-op on Site Properties (it bumps the site version), so an equal address is not re-sent.
  if (addressMismatches(before?.address, expected).length) {
    await writers.updateBusinessContact(wix, businessContact);
    after = await writers.getSiteProperties(wix);
    action = 'updated';
  }
  const mismatched = addressMismatches(after?.address, expected);
  // A read-back difference is reported, not a stop: no record depends on the business address.
  const operatorAction = mismatched.length ? businessAddressAction('business-address-readback-mismatch',
    `after the write, the site's business address differs from the source in: ${mismatched.join(', ')}`,
    `Compare Business Manager > Settings > Business Info with ${CAPTURE_FILE} and correct these fields: ${mismatched.join(', ')}.`) : null;
  return { action, addressFields: Object.keys(expected).sort(), notes, ...(captured ? { captured: true } : {}),
    ...(mismatched.length ? { readbackMismatch: mismatched, operatorAction } : {}) };
}

module.exports = {
  STEP_ID,
  KIND,
  ENTITY_REF,
  CAPTURE_FILE,
  applies,
  stepConfiguresBusinessContact,
  buildBusinessContactStep,
  buildBusinessContactRequirement,
  emitBusinessContactSetup,
  addressMismatches,
  executeBusinessContactStep,
  businessContactOperatorActions,
};
