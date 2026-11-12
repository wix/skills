'use strict';

// Wix site locale: payment currency, time zone, language and locale.
//
// A Wix price carries no currency of its own, so the site's payment currency is the only thing that says
// what a bare price means. This is a generic Wix-destination capability: each source adapter maps its own
// settings into `discovery/source-locale.json` (`source-regional.js`), and one setup entity -- after
// notification safety and before every other entity -- applies that file to the site. A site this run
// created, or an existing site with no orders and no products, is set directly; an existing site that
// holds any order or product needs the owner's
// single approval first. Every other entity builds on the step: a task that writes money (or a time of
// day) starts only when the step passed for this site, plan and source file and the value it depends on is
// confirmed. No site read happens at task time.
//
// The setup step, planner and probe live here; the task dependency check is in `site-regional-gate.js`
// and the completion-report rows in `site-regional-report.js`. Both are re-exported from here.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const sr = require('./source-regional.js');
const wixAuth = require('./wix-auth.js');

const SETTINGS = Object.freeze(['currency', 'timeZone', 'language', 'locale']);
const STEP_ID = 'import-site-locale';
const ENTITY_REF = 'site/locale';
const BEFORE_FILE = 'setup/site-locale-before.json';
const DECISION_KEY = 'siteLocaleDecision';
const ANSWER_EFFECT = 'site-locale-answer';
const ANSWER_CHOICES = Object.freeze(['change', 'keep']);

// --- which entities the gate guards -----------------------------------------------------------

// Explicit target-ref classification. Some domains contain both sensitive and neutral entities,
// so family-wide matching would hold categories, tags or RSVPs that carry neither amount nor local
// schedule. A task in both sensitive sets runs both checks.
const MONEY_BEARING_REFS = Object.freeze([
  'bookings/service', 'bookings/service-add-on',
  'ecom/discount-rule', 'ecom/order', 'ecom/order-applied-discount', 'ecom/order-invoice-document',
  'ecom/order-line-item', 'ecom/order-payment', 'ecom/order-refund', 'ecom/shipping-option',
  'events/ticket-definition', 'gift-cards/gift-card', 'gift-cards/gift-card-product',
  'pricing-plans/plan', 'pricing-plans/plan-order',
  'stores/coupon', 'stores/product', 'stores/product-customization', 'stores/product-variant', 'stores/promotion', 'stores/subscription-product',
]);
const WALL_CLOCK_REFS = Object.freeze(['bookings/booking', 'bookings/service', 'events/event']);
// Families in which every current entity is audited neutral; mixed-family neutral refs are listed
// separately. Coverage tests fail for every new target ref until it is classified.
const REGIONAL_NEUTRAL_FAMILIES = Object.freeze(['blog', 'cms', 'crm', 'forms', 'media', 'members', 'sales-channels', 'seo', 'site', 'tax']);
const REGIONAL_NEUTRAL_REFS = Object.freeze([
  'ecom/delivery-profile', 'ecom/order-line-item-options', 'ecom/order-merchant-note', 'ecom/pickup-location', 'ecom/wishlist-item',
  'events/category', 'events/registration-form', 'events/rsvp',
  'stores/back-in-stock-request', 'stores/brand', 'stores/category', 'stores/inventory-item', 'stores/product-bundle', 'stores/product-tag', 'stores/review',
]);

const refFamily = (ref) => String(ref).split('/')[0];
const isMoneyBearingRef = (ref) => MONEY_BEARING_REFS.includes(ref);
const isWallClockRef = (ref) => WALL_CLOCK_REFS.includes(ref);
const isRegionalNeutralRef = (ref) => REGIONAL_NEUTRAL_FAMILIES.includes(refFamily(ref)) || REGIONAL_NEUTRAL_REFS.includes(ref);
const classifiedRef = (ref) => isMoneyBearingRef(ref) || isWallClockRef(ref) || isRegionalNeutralRef(ref);

function partitionRefs(entityRefs) {
  const refs = [...new Set((entityRefs || []).filter((ref) => typeof ref === 'string'))].sort();
  return {
    moneyBearingRefs: refs.filter(isMoneyBearingRef),
    wallClockRefs: refs.filter(isWallClockRef),
    neutralRefs: refs.filter(isRegionalNeutralRef),
    unclassifiedRefs: refs.filter((ref) => !classifiedRef(ref)),
  };
}

// --- small file helpers ---------------------------------------------------------------------------

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function readJsonSync(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

function fileSha256(projectDir, relative) {
  try { return sha256(fs.readFileSync(path.join(projectDir, relative))); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function envValue(projectDir, key) {
  let raw;
  try { raw = fs.readFileSync(path.join(projectDir, 'config', 'wix.env'), 'utf8'); } catch { return null; }
  const match = raw.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).find((m) => m[1] === key);
  return match && match[2].trim() ? match[2].trim() : null;
}

const destinationSiteId = (projectDir) => envValue(projectDir, 'WIX_SITE_ID');

function setupPlan(projectDir) { return readJsonSync(path.join(projectDir, 'setup', 'setup-plan.json')); }

function priorRegionalReceipt(projectDir) {
  const verification = readJsonSync(path.join(projectDir, 'setup', 'setup-verification.json'));
  return (verification?.requirements || []).find((item) => item?.id === STEP_ID)?.regional || null;
}

function declaredRequirements(projectDir) {
  const declared = readJsonSync(path.join(projectDir, 'setup', 'setup-requirements.json'));
  return Array.isArray(declared) ? declared : (declared && declared.requirements) || [];
}

// The pairing predicate: the scheduling guard and the dispatcher share it, so they can never
// disagree about which steps count (the same rule as extended-field provisioning).
function stepConfiguresSiteRegional(step, declaredList) {
  if (!step) return false;
  if (step.id === STEP_ID) return true;
  if (step.kind === 'siteLocale') return true;
  return (declaredList || []).some((item) => item && item.kind === 'siteLocale' && (item.setupStepId === step.id || item.id === step.id));
}

function planHasRegionalStep(projectDir) {
  const plan = setupPlan(projectDir);
  const declared = declaredRequirements(projectDir);
  return Boolean(plan && Array.isArray(plan.steps) && plan.steps.some((step) => stepConfiguresSiteRegional(step, declared)));
}

// `created` only when the destination receipt says this run created exactly this site; anything
// else -- no receipt, another site, an unverified receipt -- is an existing site. Never inferred
// from the site strategy alone.
function siteOriginFor(projectDir, siteId) {
  const receipt = readJsonSync(path.join(projectDir, 'orchestration', 'destination.json'));
  return receipt && receipt.status === 'verified' && receipt.strategy === 'new' && siteId && receipt.metaSiteId === siteId ? 'created' : 'existing';
}

// The requirement `rp-setup-discovery` (and the quick setup generator) emit next to the step.
// `siteOrigin` here is informational; the executor recomputes it from the receipt at run time.
function buildRegionalRequirement({ projectDir, entityRefs }) {
  const refs = [...new Set((entityRefs || []).filter((ref) => typeof ref === 'string'))].sort();
  const { moneyBearingRefs, wallClockRefs, neutralRefs, unclassifiedRefs } = partitionRefs(refs);
  return {
    id: STEP_ID,
    kind: 'siteLocale',
    entityRefs: [ENTITY_REF],
    source: sr.SOURCE_REGIONAL_FILE,
    siteOrigin: siteOriginFor(projectDir, destinationSiteId(projectDir)),
    severity: 'blocker',
    automation: 'automatable',
    dependentEntityRefs: refs,
    moneyBearingRefs,
    wallClockRefs,
    neutralRefs,
    unclassifiedRefs,
  };
}

function buildRegionalStep() {
  return { id: STEP_ID, kind: 'siteLocale', entityRefs: [ENTITY_REF] };
}

// The entity refs a project will write, for the two kinds of plan: a quick run's adapter contract,
// or the approved mapping plan's targets. Conservative on purpose: a ref listed is a ref gated.
function entityRefsForProject(projectDir) {
  const refs = new Set();
  const quick = readJsonSync(path.join(projectDir, 'quick-mode', 'plan.json'));
  if (quick && Array.isArray(quick.entities)) {
    const contractFile = { 'quick-woocommerce': '../resources/rp-quick-woocommerce/quick-mode.json', 'quick-shopify': '../resources/rp-quick-shopify/quick-mode.json' }[quick.adapter];
    const contract = contractFile ? readJsonSync(path.resolve(__dirname, contractFile)) : null;
    const wanted = new Set(quick.entities.map((entity) => entity.id));
    for (const entity of (contract && contract.entities) || []) {
      if (!wanted.has(entity.id)) continue;
      for (const ref of [entity.target, ...(entity.auxiliaryTargets || [])]) if (ref) refs.add(ref);
    }
    return [...refs].sort();
  }
  const mapping = readJsonSync(path.join(projectDir, 'mapping', 'mapping-plan.json'));
  for (const row of require('./website-handoff.js').readEntityMappings(mapping)) {
    for (const ref of [row.targetRef, ...(Array.isArray(row.targetRefs) ? row.targetRefs : [])]) if (typeof ref === 'string' && ref.includes('/')) refs.add(ref);
  }
  return [...refs].sort();
}

// Writes the requirement/step pair after notification safety and before every install/provisioning
// step. Idempotent: a rerun replaces the pair.
async function emitRegionalSetup(projectDir, { entityRefs = null, order = null } = {}) {
  const planFile = path.join(projectDir, 'setup', 'setup-plan.json');
  const reqFile = path.join(projectDir, 'setup', 'setup-requirements.json');
  const plan = readJsonSync(planFile);
  const declared = readJsonSync(reqFile);
  if (!plan || !Array.isArray(plan.steps) || !declared) return { emitted: false, reason: 'setup-artifacts-missing' };
  const isArray = Array.isArray(declared);
  const list = (isArray ? declared : declared.requirements || []).filter((item) => !(item && item.id === STEP_ID));
  const steps = plan.steps.filter((step) => !(step && step.id === STEP_ID));
  const requirement = buildRegionalRequirement({ projectDir, entityRefs: entityRefs || entityRefsForProject(projectDir) });
  const withOrder = order === null ? {} : { order };
  const insertAfterMute = (rows, value) => {
    const index = rows.findIndex((row) => row && row.id === 'mute-site-notifications');
    rows.splice(index < 0 ? 0 : index + 1, 0, value);
  };
  insertAfterMute(steps, { ...buildRegionalStep(), action: STEP_ID, ...withOrder });
  insertAfterMute(list, { ...requirement, ...withOrder });
  await writeJsonAtomic(planFile, { ...plan, steps });
  await writeJsonAtomic(reqFile, isArray ? list : { ...declared, requirements: list });
  return { emitted: true, requirement };
}

// --- the owner's single approval ------------------------------------------------------------------

function readDecisions(projectDir) { return readJsonSync(path.join(projectDir, 'orchestration', 'decisions.json'), {}) || {}; }

const canonical = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

// Identifies exactly which changes were put to the owner: field, source value and pre-change site value.
function changesDigestOf(rows) {
  return sha256(canonical(rows.map((row) => [row.field, row.source, row.before ?? row.current])));
}

// SHA-256 of the owner's approval for this site, or of "none". A new answer or another destination moves it,
// which makes the setup receipt stale so the step re-runs.
function approvalDigest(projectDir, siteId = destinationSiteId(projectDir)) {
  const entry = readDecisions(projectDir)[DECISION_KEY];
  return sha256(canonical({ approval: entry && typeof entry === 'object' ? entry : null, siteId: siteId || null }));
}

// An answer survives partial apply: every still-differing row must be one of the immutable rows
// shown to the owner with the same source and same pre-change site value. Matching fields need no row.
function approvalIsValid(approval, { siteId, rows = [], changesDigest = null }) {
  if (!(approval && typeof approval === 'object' && ANSWER_CHOICES.includes(approval.value) && approval.siteId === siteId)) return false;
  if (Array.isArray(approval.rows)) {
    return rows.every((row) => approval.rows.some((saved) => saved && saved.field === row.field
      && saved.source === row.source && saved.before === row.current));
  }
  return Boolean(changesDigest && approval.changesDigest === changesDigest);
}

// --- the pure per-setting plan ---------------------------------------------------------------------------

function currentValueOf(properties, field) {
  if (!properties) return null;
  switch (field) {
    case 'currency': return properties.paymentCurrency || null;
    case 'timeZone': return properties.timeZone || null;
    case 'language': return properties.language || null;
    case 'locale': return properties.locale && properties.locale.languageCode && properties.locale.country
      ? `${properties.locale.languageCode}-${properties.locale.country}` : null;
    default: return null;
  }
}

const UNKNOWN_CODES = Object.freeze({ currency: 'SOURCE_CURRENCY_UNKNOWN', timeZone: 'SOURCE_TIME_ZONE_UNKNOWN' });
const KEEP_GATED_FIELDS = new Set(['currency', 'timeZone']);

// One row per setting; `action` is match | apply | skip-unknown | needs-approval | kept.
function planSiteRegional({ source, current, siteId = null, siteOrigin, siteState = null, approval = null, moneyBearingRefs = [], wallClockRefs = [] }) {
  const rows = SETTINGS.map((field) => {
    const gatedRefs = field === 'currency' ? [...moneyBearingRefs] : field === 'timeZone' ? [...wallClockRefs] : [];
    return { field, source: sr.settingValue(source, field), current: currentValueOf(current, field), action: null, gatedRefs };
  });
  const differing = rows.filter((row) => row.source !== null && !sr.sameValue(row.field, row.source, row.current));
  const needsApproval = siteOrigin === 'existing' && siteState !== 'existing-untouched' && differing.length > 0;
  const changesDigest = changesDigestOf(differing);
  const approved = approvalIsValid(approval, { siteId, rows: differing, changesDigest }) ? approval.value : null;
  for (const row of rows) {
    if (row.source === null) {
      row.action = 'skip-unknown';
      row.reason = sr.unknownReason(source, row.field) || 'not-exposed';
      if (row.gatedRefs.length && UNKNOWN_CODES[row.field]) row.code = UNKNOWN_CODES[row.field];
    } else if (!differing.includes(row)) {
      row.action = 'match';
    } else if (!needsApproval || approved === 'change') {
      row.action = 'apply';
      if (approved) row.decisionRef = approval.requestId || null;
    } else if (approved === 'keep') {
      row.decisionRef = approval.requestId || null;
      row.action = 'kept';
      if (KEEP_GATED_FIELDS.has(row.field)) row.code = 'SITE_LOCALE_KEPT';
    } else {
      row.action = 'needs-approval';
    }
  }
  return { rows, needsApproval, changesDigest, approved };
}

const pendingApproval = (rows) => rows.filter((row) => row.action === 'needs-approval');

// --- is an existing site untouched? ---------------------------------------------------------------

const APP_IDS = Object.freeze({
  stores: '215238eb-22a5-4c36-9e7b-e7c08025e04e',
  ecom: '1380b703-ce81-ff05-f115-39571d94dfcd',
});

const CATALOG_PAGE_LIMIT = 10; // pages of 100 -> 1,000 products

// The approved existing-site boundary is only orders or products. Installed-apps is the source
// of truth for a missing app; unreadable app state is unknown and asks.
const SITE_USE_FAMILIES = Object.freeze([
  { id: 'orders', appDefId: APP_IDS.ecom, probe: 'orders' },
  { id: 'catalog', appDefId: APP_IDS.stores, probe: 'catalog' },
]);

// `ignoreProductIds`: sample products this toolkit's own Stores install added. They are
// not merchant data, so a seeded item a delete missed never makes the site read as in use.
async function probeSiteUse({ wix, writers, ignoreProductIds = new Set() }) {
  const families = [];
  let installed;
  try { installed = await writers.getInstalledWixApps(wix); } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; return { state: 'existing-unknown', families: [{ id: 'apps', status: 'unreadable' }] }; }
  const installedIds = new Set((installed || []).map((app) => app && app.appDefId));
  for (const family of SITE_USE_FAMILIES) {
    if (!installedIds.has(family.appDefId)) { families.push({ id: family.id, status: 'not-installed' }); continue; }
    try {
      if (family.probe === 'orders') {
        const orders = await writers.queryOrders(wix, { paging: { limit: 1 } });
        families.push({ id: family.id, status: orders.length === 0 ? 'empty' : 'in-use' });
      } else {
        families.push({ id: family.id, status: await probeCatalog({ wix, writers, ignoreProductIds }) });
      }
    } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; families.push({ id: family.id, status: 'unreadable' }); }
  }
  const statuses = families.map((family) => family.status);
  const state = statuses.includes('in-use') ? 'existing-in-use'
    : statuses.some((status) => status === 'unreadable' || status === 'unknown') ? 'existing-unknown'
      : 'existing-untouched';
  return { state, families };
}

async function probeCatalog({ wix, writers, ignoreProductIds = new Set() }) {
  let cursor = null;
  for (let page = 0; page < CATALOG_PAGE_LIMIT; page += 1) {
    const response = await wix.send(writers.buildQueryStoresProductsRequest({ cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) } }));
    const products = ((response && response.products) || []).filter((product) => !(product && ignoreProductIds.has(product.id)));
    if (products.length) return 'in-use';
    const next = response && response.pagingMetadata && response.pagingMetadata.cursors && response.pagingMetadata.cursors.next;
    if (!(response && response.pagingMetadata && response.pagingMetadata.hasNext) || !next) return 'empty';
    cursor = next;
  }
  return 'unknown'; // more than the page limit: never reported untouched
}

// --- plain language ---------------------------------------------------------------------------------------

function displayName(type, code) {
  try { return new Intl.DisplayNames('en', { type }).of(code) || code; } catch { return code; }
}

function describeValue(field, value) {
  if (value === null || value === undefined) return 'not set';
  if (field === 'currency') return `${displayName('currency', value)} (${value})`;
  if (field === 'language') return `${displayName('language', value)} (${value})`;
  if (field === 'locale') {
    const parsed = sr.parseLocale(value);
    return parsed ? `${displayName('language', parsed.languageCode)}, ${displayName('region', parsed.country)} (${value})` : String(value);
  }
  return String(value);
}

const FIELD_LABEL = Object.freeze({ currency: 'Currency', timeZone: 'Time zone', language: 'Language', locale: 'Locale' });

// The execution-plan section. Reads the source file only: the site itself is read when setup runs.
function renderRegionalPreview(source) {
  const lines = ['Site settings, set first from the source store'];
  for (const field of SETTINGS) {
    const value = sr.settingValue(source, field);
    lines.push(value === null
      ? `${FIELD_LABEL[field]}: the source store's value could not be read (${sr.unknownReason(source, field) || 'not-exposed'}); left unchanged`
      : `${FIELD_LABEL[field]}: set to ${describeValue(field, value)} (from the store)`);
  }
  lines.push('A site created by this migration is set directly. An existing site with no orders and no products is set directly too; any order or product asks you first.');
  return lines.join('\n');
}

async function previewRegionalPlan(projectDir) {
  const requirement = declaredRequirements(projectDir).find((item) => item && item.kind === 'siteLocale');
  if (!requirement) return { applicable: false, reason: 'no-regional-step' };
  let source;
  try { source = await sr.readSourceRegional(projectDir); } catch (error) { return { applicable: true, ok: false, code: 'INVALID_SOURCE_REGIONAL', detail: error.message }; }
  if (!source) return { applicable: true, ok: false, code: 'INVALID_SOURCE_REGIONAL', detail: 'discovery/source-locale.json is missing' };
  return { applicable: true, ok: true, section: renderRegionalPreview(source) };
}

// --- the one durable question ---------------------------------------------------------------------------------

function questionText(rows, siteState) {
  const pairs = rows.map((row) => `${FIELD_LABEL[row.field].toLowerCase()}: the store uses ${describeValue(row.field, row.source)}, your site has ${describeValue(row.field, row.current)}`).join('; ');
  const holds = siteState === 'existing-in-use' ? 'Your site already holds at least one order or product.' : 'We could not prove that your site has no orders and no products.';
  const risk = rows.some((row) => row.field === 'currency') ? ' Changing the currency does not convert anything: existing prices and orders would be read in the new currency.' : '';
  const hours = rows.some((row) => row.field === 'timeZone') ? ' Changing the time zone changes the hour that bookings and events show.' : '';
  const kept = ' Keeping the site\'s settings means money-bearing data (and bookings and events, when the time zone is kept) is not imported in this migration; everything else still is.';
  return `${pairs}. ${holds}${risk}${hours}${kept}`;
}

function questionInput(rows, { siteId, siteState, changesDigest }) {
  const changes = rows.map((row) => ({ field: row.field, source: row.source, before: row.current }));
  return {
    kind: 'question',
    stage: 'setup',
    title: 'Change the site\'s currency, time zone and language to match the store?',
    prompt: questionText(rows, siteState),
    response: { mode: 'choice', required: true },
    choices: [
      { id: 'change', label: 'Change the site\'s settings to the store\'s' },
      { id: 'keep', label: 'Keep the site\'s settings' },
    ],
    effect: { kind: ANSWER_EFFECT, siteId, changesDigest },
    subject: { type: 'site-locale', siteId, changesDigest, siteState, changes },
  };
}

async function listRegionalRequests(projectDir, status = 'pending') {
  const ua = require('./user-actions.js');
  const rows = await ua.listUserActions(projectDir, { status });
  const out = [];
  for (const row of rows) {
    const request = await ua.readUserAction(projectDir, row.requestId);
    if (request.effect && request.effect.kind === ANSWER_EFFECT) out.push(request);
  }
  return out;
}

// Exactly one open request per set of changes on a site; a request about other changes is superseded.
async function raiseApprovalRequest(projectDir, rows, { siteId, siteState, changesDigest }) {
  const ua = require('./user-actions.js');
  const open = await listRegionalRequests(projectDir);
  const match = open.find((request) => request.subject && request.subject.siteId === siteId && request.subject.changesDigest === changesDigest);
  for (const request of open) if (request !== match) await ua.supersedeUserAction(projectDir, request.requestId);
  if (match) return match;
  return ua.createUserAction(projectDir, questionInput(pendingApproval(rows), { siteId, siteState, changesDigest }));
}

// Re-open the immutable rows from the current keep decision so the owner can replace it with
// change. This is an explicit operator action; unattended and one-click flows never call it.
async function reopenRegionalRequest(projectDir) {
  const decision = readDecisions(projectDir)[DECISION_KEY];
  if (!decision || decision.value !== 'keep' || !Array.isArray(decision.rows) || !decision.rows.length) {
    throw new Error('site/locale has no keep decision to reconsider');
  }
  if (decision.siteId !== destinationSiteId(projectDir)) throw new Error('site-locale decision names another destination');
  const rows = decision.rows.map((row) => ({ field: row.field, source: row.source, current: row.before, action: 'needs-approval' }));
  return raiseApprovalRequest(projectDir, rows, { siteId: decision.siteId, siteState: 'existing-in-use', changesDigest: decision.changesDigest });
}

// The one writer of the site-locale decision; both CLI entry points reach it through the effect dispatcher.
async function recordSiteRegionalApproval(projectDir, request, answer) {
  const effect = request.effect;
  if (!effect || effect.kind !== ANSWER_EFFECT) throw new Error('not a site-locale answer');
  if (!ANSWER_CHOICES.includes(answer.choice)) throw new Error('site-locale answer must be change or keep');
  if (effect.siteId !== destinationSiteId(projectDir)) throw new Error('site-locale request names another destination; it is superseded');
  const { loadArtifacts, writeJsonAtomic: writeOrchestrationJson } = require('./orchestration-state.js');
  const artifacts = await loadArtifacts(projectDir);
  const rows = ((request.subject && request.subject.changes) || []).map((row) => ({ field: row.field, source: row.source, before: row.before }));
  if (!rows.length || rows.some((row) => !SETTINGS.includes(row.field) || row.source == null || row.before == null)) throw new Error('site-locale request has no valid immutable rows');
  artifacts.decisions[DECISION_KEY] = {
    value: answer.choice,
    decidedAt: new Date().toISOString(),
    source: 'user',
    rationale: request.title,
    siteId: effect.siteId,
    changesDigest: effect.changesDigest,
    rows,
    requestId: request.requestId,
  };
  await writeOrchestrationJson(path.join(projectDir, 'orchestration', 'decisions.json'), artifacts.decisions);
}

// --- the setup step ---------------------------------------------------------------------------------------------

const REGIONAL_BLOCKERS = Object.freeze({
  INVALID_SOURCE_REGIONAL: 'discovery/source-locale.json is invalid. Re-run source discovery and promote, then re-run setup.',
  SOURCE_LOCALE_REQUIRED: 'The source locale is incomplete. Supply every missing value, promote discovery and re-run setup.',
  SITE_PROPERTIES_UNREADABLE: 'The site\'s settings could not be read, so nothing was planned or written. Re-run setup once the site answers.',
  SITE_REGIONAL_APPROVAL_PENDING: 'The site already holds orders or real products, so changing its settings needs the owner\'s approval. Answer the question (change or keep), then re-run setup.',
  SITE_REGIONAL_READBACK_MISMATCH: 'The site did not keep the value that was sent (or could not be read back). Check the site\'s settings in the dashboard, then re-run setup.',
  SITE_REGIONAL_WRITE_REJECTED: 'Wix refused the currency or time zone update. Check the value against the store, then re-run setup.',
});

function regionalBlocker(code, detail) {
  return Object.assign(new Error(detail || code), { blockerCode: code, recommendedAction: REGIONAL_BLOCKERS[code] || 'Investigate, then re-run setup.' });
}

// Applied rows, in this order: one business-region update, language, locale. Each mask is built from the keys sent.
function writesFor(rows) {
  const applied = rows.filter((row) => row.action === 'apply');
  const find = (field) => applied.find((row) => row.field === field);
  const region = {};
  if (find('currency')) region.paymentCurrency = find('currency').source;
  if (find('timeZone')) region.timeZone = find('timeZone').source;
  const writes = [];
  if (Object.keys(region).length) writes.push({ kind: 'region', payload: region, fields: ['currency', 'timeZone'].filter(find) });
  if (find('language')) writes.push({ kind: 'language', payload: find('language').source, fields: ['language'] });
  if (find('locale')) writes.push({ kind: 'locale', payload: sr.parseLocale(find('locale').source), fields: ['locale'] });
  return writes;
}

// The dry-run intent: the ordered list a live run would reduce to, from the source file alone.
function regionalDryRunIntent(source) {
  const region = {};
  const currency = sr.settingValue(source, 'currency');
  const timeZone = sr.settingValue(source, 'timeZone');
  if (currency) region.paymentCurrency = currency;
  if (timeZone) region.timeZone = timeZone;
  const steps = [{ op: 'get-properties' }];
  if (Object.keys(region).length) steps.push({ op: 'update-business-region', paths: Object.keys(region), values: region });
  if (sr.settingValue(source, 'language')) steps.push({ op: 'update-language', value: sr.settingValue(source, 'language') });
  if (sr.settingValue(source, 'locale')) steps.push({ op: 'update-locale', value: sr.settingValue(source, 'locale') });
  steps.push({ op: 'get-properties' });
  return steps;
}

async function readBefore(projectDir, siteId) {
  const file = readJsonSync(path.join(projectDir, BEFORE_FILE));
  return file && file.siteId === siteId ? file : null;
}

async function ensurePaymentMethodsAction(projectDir, { siteId, before, after }) {
  if (!before || !after || before === after) return null;
  const ua = require('./user-actions.js');
  const subject = { type: 'site-locale-payment-methods-confirmation', siteId, before, after };
  for (const row of await ua.listUserActions(projectDir)) {
    const request = await ua.readUserAction(projectDir, row.requestId);
    if (request.subject && canonical(request.subject) === canonical(subject)) return request;
  }
  return ua.createUserAction(projectDir, {
    kind: 'manual_action',
    stage: 'cutover',
    title: `Confirm connected payment methods accept ${after}`,
    prompt: `Before checkout is enabled, confirm in Business Manager that every connected payment method accepts ${after}.`,
    response: { mode: 'none', required: true },
    subject,
  });
}

// A time zone discovery inferred (no named zone at the source) is applied without asking and
// confirmed at cutover: one durable task per site + value. Never asked mid-run.
const TIME_ZONE_CONFIRMATION = 'site-locale-time-zone-confirmation';
async function ensureTimeZoneAction(projectDir, { siteId, row, siteValue }) {
  const ua = require('./user-actions.js');
  const inference = row.inference || {};
  const value = row.state === 'unknown' ? (siteValue || 'the site default') : row.value;
  const subject = { type: TIME_ZONE_CONFIRMATION, siteId, value, basis: inference.basis || null, gmtOffset: inference.gmtOffset ?? null };
  for (const listed of await ua.listUserActions(projectDir)) {
    const request = await ua.readUserAction(projectDir, listed.requestId);
    if (request.subject && canonical(request.subject) === canonical(subject)) return request;
  }
  return ua.createUserAction(projectDir, {
    kind: 'manual_action',
    stage: 'cutover',
    title: `Confirm the site time zone (${value})`,
    prompt: row.state === 'unknown'
      ? `The source store had no named time zone and none could be picked (${row.evidence}). The site kept its own zone, ${value}. Confirm it in Business Manager > Settings > Language & region, or change it there.`
      : `The source store had no named time zone (${row.evidence}). The migration set the site to ${value}. Confirm it in Business Manager > Settings > Language & region, or change it there.`,
    response: { mode: 'none', required: true },
    subject,
  });
}

// The setup step. `wix` is the capability-bound setup client; `writers` is the shared writers module
// (injected so a test never touches Wix). Returns the `regional` receipt object, or throws an error carrying
// `blockerCode` / `recommendedAction` for execute-setup to record.
async function executeRegionalStep({ projectDir, wix, writers, siteId, requirement = {} }) {
  const priorRegional = priorRegionalReceipt(projectDir);
  let source;
  try { source = await sr.readSourceRegional(projectDir); } catch (error) { throw regionalBlocker('INVALID_SOURCE_REGIONAL', error.message); }
  if (!source) throw regionalBlocker('INVALID_SOURCE_REGIONAL', 'discovery/source-locale.json is missing');
  // An unresolved fixed-offset time zone keeps the site's zone and is confirmed at cutover; never asked.
  const missing = SETTINGS.filter((field) => sr.settingValue(source, field) === null && !(field === 'timeZone' && sr.keepsSiteTimeZone(source)));
  if (missing.length) throw regionalBlocker('SOURCE_LOCALE_REQUIRED', `source locale requires supplied values for: ${missing.join(', ')}`);

  let properties;
  try { properties = await writers.getSiteProperties(wix); } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; throw regionalBlocker('SITE_PROPERTIES_UNREADABLE', `site properties could not be read: ${error.message}`); }
  if (!properties) throw regionalBlocker('SITE_PROPERTIES_UNREADABLE', 'site properties read returned nothing');

  const siteOrigin = siteOriginFor(projectDir, siteId);
  const moneyBearingRefs = requirement.moneyBearingRefs || [];
  const wallClockRefs = requirement.wallClockRefs || [];
  const siteState = siteOrigin === 'created' ? 'created' : (await probeSiteUse({ wix, writers, ignoreProductIds: require('./catalog-baseline').installSeededIds(projectDir) })).state;
  const decision = readDecisions(projectDir)[DECISION_KEY] || null;
  const planned = planSiteRegional({
    source, current: properties, siteId, siteOrigin, siteState, approval: decision,
    moneyBearingRefs, wallClockRefs,
  });
  const rows = planned.rows;

  if (pendingApproval(rows).length) {
    await raiseApprovalRequest(projectDir, rows, { siteId, siteState, changesDigest: planned.changesDigest });
    throw regionalBlocker('SITE_REGIONAL_APPROVAL_PENDING', `${pendingApproval(rows).map((row) => row.field).join(', ')} waiting for the owner's approval`);
  }
  const writes = writesFor(rows);
  // Remember each field immediately before this migration first attempts to write it. A later run
  // can add a newly differing field, so extend the artifact without changing values for fields an
  // earlier attempt already recorded.
  if (writes.length) {
    const priorBefore = await readBefore(projectDir, siteId);
    const attemptedFields = [...new Set(writes.flatMap((write) => write.fields))];
    const newlyAttempted = attemptedFields.filter((field) => !(priorBefore?.attemptedFields || []).includes(field));
    const values = { ...(priorBefore?.values || {}) };
    for (const field of newlyAttempted) values[field] = currentValueOf(properties, field);
    await writeJsonAtomic(path.join(projectDir, BEFORE_FILE), {
      schemaVersion: 1,
      siteId,
      at: priorBefore?.at || new Date().toISOString(),
      sourceDigest: priorBefore?.sourceDigest || fileSha256(projectDir, sr.SOURCE_REGIONAL_FILE),
      attemptedFields: [...new Set([...(priorBefore?.attemptedFields || []), ...attemptedFields])],
      values,
    });
  }

  for (const write of writes) {
    try {
      if (write.kind === 'region') await writers.updateBusinessRegion(wix, write.payload);
      else if (write.kind === 'language') await writers.updateSiteLanguage(wix, write.payload);
      else await writers.updateSiteLocale(wix, write.payload);
    } catch (error) {
      if (wixAuth.isRunInterruption(error)) throw error;
      throw regionalBlocker('SITE_REGIONAL_WRITE_REJECTED', `${write.kind} update failed: ${error.message}`);
    }
  }

  let after = properties;
  if (writes.length) {
    try { after = await writers.getSiteProperties(wix); } catch (error) { if (wixAuth.isRunInterruption(error)) throw error; throw regionalBlocker('SITE_REGIONAL_READBACK_MISMATCH', `read-back failed: ${error.message}`); }
    if (!after) throw regionalBlocker('SITE_REGIONAL_READBACK_MISMATCH', 'read-back returned nothing');
  }
  const before = (await readBefore(projectDir, siteId)) || { values: Object.fromEntries(SETTINGS.map((field) => [field, currentValueOf(properties, field)])) };
  const fields = {};
  for (const row of rows) {
    const field = row.field;
    const entry = { source: row.source, before: before.values[field] !== undefined ? before.values[field] : row.current, after: currentValueOf(after, field), action: null, verified: false };
    if (row.code) entry.code = row.code;
    if (row.gatedRefs.length && row.code) entry.gatedRefs = row.gatedRefs;
    if (row.decisionRef) entry.decisionRef = row.decisionRef;
    if (row.action === 'apply') {
      const stored = sr.sameValue(field, row.source, entry.after);
      if (stored) { entry.action = 'applied'; entry.verified = true; }
      else throw regionalBlocker('SITE_REGIONAL_READBACK_MISMATCH', `${field}: sent ${row.source}, read back ${entry.after}`);
    } else if (row.action === 'match') { entry.action = 'match'; entry.verified = true; }
    else if (row.action === 'skip-unknown' && field === 'timeZone' && sr.keepsSiteTimeZone(source)) {
      // Nothing was sent; the site keeps its own zone, read back unchanged. Confirmed at cutover.
      entry.action = 'kept-site-default'; entry.reason = row.reason; entry.verified = sr.sameValue(field, row.current, entry.after);
    } else if (row.action === 'skip-unknown') { entry.action = 'skipped-unknown'; entry.reason = row.reason; }
    else if (row.action === 'kept') { entry.action = 'kept'; entry.verified = sr.sameValue(field, row.current, entry.after); }
    fields[field] = entry;
  }
  const beforeArtifact = await readBefore(projectDir, siteId);
  let paymentMethodsConfirmationRequestId = null;
  if (beforeArtifact && (beforeArtifact.attemptedFields || []).includes('currency')
      && sr.sameValue('currency', sr.settingValue(source, 'currency'), currentValueOf(after, 'currency'))) {
    const request = await ensurePaymentMethodsAction(projectDir, {
      siteId,
      before: beforeArtifact.values.currency,
      after: currentValueOf(after, 'currency'),
    });
    paymentMethodsConfirmationRequestId = request && request.requestId;
  }
  let timeZoneConfirmationRequestId = null;
  if (source.timeZone?.inference && fields.timeZone?.verified && ['applied', 'match', 'kept-site-default'].includes(fields.timeZone.action)) {
    const request = await ensureTimeZoneAction(projectDir, { siteId, row: source.timeZone, siteValue: fields.timeZone.after });
    timeZoneConfirmationRequestId = request && request.requestId;
  }
  const keptFields = ['currency', 'timeZone'].filter((field) => fields[field]?.action === 'kept');
  let heldCatchUp = priorRegional?.heldCatchUp || null;
  if (keptFields.length) {
    const refs = new Set(requirement.unclassifiedRefs || []);
    if (keptFields.includes('currency')) for (const ref of requirement.moneyBearingRefs || []) refs.add(ref);
    if (keptFields.includes('timeZone')) for (const ref of requirement.wallClockRefs || []) refs.add(ref);
    heldCatchUp = { fields: keptFields, refs: [...refs].sort() };
  }
  const receipt = {
    siteOrigin,
    siteState,
    sourceDigest: fileSha256(projectDir, sr.SOURCE_REGIONAL_FILE),
    decisionDigest: approvalDigest(projectDir, siteId),
    fields,
    ...(heldCatchUp?.refs?.length ? { heldCatchUp } : {}),
    ...(paymentMethodsConfirmationRequestId ? { paymentMethodsConfirmationRequestId } : {}),
    ...(timeZoneConfirmationRequestId ? { timeZoneConfirmationRequestId } : {}),
  };
  return receipt;
}

module.exports = {
  SETTINGS,
  STEP_ID,
  ENTITY_REF,
  BEFORE_FILE,
  DECISION_KEY,
  ANSWER_EFFECT,
  ANSWER_CHOICES,
  TIME_ZONE_CONFIRMATION,
  MONEY_BEARING_REFS,
  WALL_CLOCK_REFS,
  REGIONAL_NEUTRAL_FAMILIES,
  REGIONAL_NEUTRAL_REFS,
  APP_IDS,
  SITE_USE_FAMILIES,
  isMoneyBearingRef,
  isWallClockRef,
  isRegionalNeutralRef,
  classifiedRef,
  partitionRefs,
  stepConfiguresSiteRegional,
  declaredRequirements,
  planHasRegionalStep,
  siteOriginFor,
  destinationSiteId,
  buildRegionalRequirement,
  buildRegionalStep,
  entityRefsForProject,
  emitRegionalSetup,
  readDecisions,
  approvalDigest,
  approvalIsValid,
  changesDigestOf,
  currentValueOf,
  planSiteRegional,
  pendingApproval,
  probeSiteUse,
  describeValue,
  renderRegionalPreview,
  previewRegionalPlan,
  questionInput,
  listRegionalRequests,
  raiseApprovalRequest,
  reopenRegionalRequest,
  recordSiteRegionalApproval,
  regionalDryRunIntent,
  executeRegionalStep,
  fileSha256,
  readJsonSync,
  writeJsonAtomic,
};

// The task dependency check and the report rows are separate files but one public module.
Object.assign(module.exports, require('./site-regional-gate.js'), require('./site-regional-report.js'));
