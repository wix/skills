'use strict';

// The deterministic destination coordinator. It creates at most one new
// site per project, persists the returned identifier before anything else, verifies the
// actual editor and that a new Editor site is unpublished, and turns every uncertain or
// failed outcome into a durable receipt plus one recovery request. It never publishes,
// unpublishes or deletes a site, and never retries a create whose outcome is unknown.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { readEnvFile, upsertEnvFile } = require('./config-env.js');
const { CallTimeoutError, boundedRequest, isTransientStatus, retryAfterMs } = require('./destination-http.js');

const {
  getDecisionValue,
  isEditorSiteType,
  isNewSiteStrategy,
  readSiteTypeDecision,
} = require('./orchestration-decisions.js');
const { loadArtifacts, writeJsonAtomic } = require('./orchestration-state.js');
const { createUserAction, readUserAction, listUserActions } = require('./user-actions.js');
const { editorWebsiteRequestInput, siteTypeRequestInput, KNOWN_BUSINESS_TYPES } = require('./destination-choice.js');

const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_STATUSES = Object.freeze(['in_progress', 'created', 'verified', 'failed_before_create', 'ambiguous', 'blocked']);

const BLANK_TEMPLATES = Object.freeze({
  studio: 'fe86a14e-ef67-49b4-a409-d086f3abaa1a',
  harmony: '91532250-8835-46ac-9666-e4db8770b275',
});
const EXPECTED_EDITOR = Object.freeze({ studio: 'WIX_STUDIO', harmony: 'ODEDITOR', headless: 'EDITORLESS' });

const URLS = Object.freeze({
  createFromTemplate: 'https://www.wixapis.com/msm/v1/meta-site/create-from-template',
  editorUrls: 'https://www.wixapis.com/editor-urls',
  publishedSiteUrls: 'https://www.wixapis.com/urls-server/v2/published-site-urls',
});

// Per-call timeouts, polling bounds and publication readback bounds.
const LIMITS = Object.freeze({
  createTimeoutMs: 60_000,
  editorTimeoutMs: 20_000,
  publicationTimeoutMs: 15_000,
  publicationAttempts: 3,
  publicationWaitsMs: [2_000, 8_000],
  publicationRetryAfterCapMs: 30_000,
  publicationBudgetMs: 90_000,
  publicationMinLeftMs: 1_000,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPORT_OPERATOR_PROMPT = 'Requires Import Operator. In the original migration workspace, reconcile the destination creation attempt against the intended account, preserve the returned metasite ID, rerun editor verification and the published-URLs readback, and resume only after recording the resolved receipt. Do not create a replacement site, and do not publish or unpublish it without an explicit human publication decision.';

function receiptPath(projectDir) { return path.join(projectDir, 'orchestration', 'destination.json'); }
function lockPath(projectDir) { return path.join(projectDir, 'orchestration', 'destination.lock'); }
function wixEnvPath(projectDir) { return path.join(projectDir, 'config', 'wix.env'); }

async function readReceipt(projectDir) {
  try {
    return JSON.parse(await fs.readFile(receiptPath(projectDir), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return { invalid: true, error: error.message };
    throw error;
  }
}

async function readWixEnv(projectDir) {
  try {
    return await readEnvFile(wixEnvPath(projectDir));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function validateReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || receipt.invalid) return ['orchestration/destination.json is not valid JSON'];
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) errors.push(`destination receipt schemaVersion must be ${RECEIPT_SCHEMA_VERSION}`);
  if (!RECEIPT_STATUSES.includes(receipt.status)) errors.push(`destination receipt status must be one of ${RECEIPT_STATUSES.join(', ')}`);
  if (!['headless', 'studio', 'harmony'].includes(receipt.requestedSiteType)) errors.push('destination receipt requestedSiteType is invalid');
  if (receipt.metaSiteId != null && !UUID_RE.test(String(receipt.metaSiteId))) errors.push('destination receipt metaSiteId is not a metasite id');
  return errors;
}

// 4–20 chars of [a-z0-9_-], ending in a letter, digit or underscore.
function normalizeSiteName(value, { fallback = 'replatform-site', suffix = '' } = {}) {
  const clean = (input) => String(input || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+/, '');
  let base = clean(value);
  const tail = suffix ? `-${clean(suffix).replace(/[-_]+$/, '')}` : '';
  base = base.slice(0, 20 - tail.length).replace(/-+$/, '');
  let name = `${base}${tail}`;
  if (name.length < 4) name = `${clean(fallback)}${tail}`.slice(0, 20);
  name = name.replace(/-+$/, '');
  while (name.length < 4) name += '0';
  return name;
}

function identityRef(identity) {
  return identity ? `sha256:${crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 16)}` : null;
}

function isoAt(clock) { return new Date(clock.now()).toISOString(); }

// --- lock -------------------------------------------------------------------------------

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error && error.code === 'EPERM'; }
}

async function readRaw(filePath) {
  try { return await fs.readFile(filePath, 'utf8'); } catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
}

function lockHolderAlive(raw) {
  let holder = null;
  try { holder = JSON.parse(raw); } catch { holder = null; }
  return Boolean(holder && pidAlive(holder.pid));
}

// Creates `filePath` with its full content in one atomic step (hard link of a private temp
// file), so no contender ever observes an empty or half-written lock. Returns false on EEXIST.
async function createExclusive(filePath, content) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, content, { flag: 'wx' });
  try {
    await fs.link(temp, filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') return false;
    throw error;
  } finally {
    await fs.rm(temp, { force: true });
  }
}

// Project-local exclusive lock. Every lock carries a unique owner token. A lock left by
// a dead process is reclaimed only under a second exclusive "reclaim" lock, and only if the
// lock file still holds the exact stale content this contender read, so two contenders can
// never both reclaim (or one delete the other's live lock). Release removes the lock only
// while it still holds this owner's token. A live holder, or a reclaim lock left by a dead
// process, makes this invocation stop without touching anything.
async function acquireLock(projectDir) {
  const filePath = lockPath(projectDir);
  const reclaimPath = `${filePath}.reclaim`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const token = crypto.randomUUID();
  const content = JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() });
  const release = async () => {
    if ((await readRaw(filePath)) === content) await fs.rm(filePath, { force: true });
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await createExclusive(filePath, content)) return release;
    const seen = await readRaw(filePath);
    if (seen === null) continue;
    if (lockHolderAlive(seen)) return null;
    if (attempt > 0) return null;
    const reclaimContent = JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() });
    if (!(await createExclusive(reclaimPath, reclaimContent))) return null;
    try {
      if ((await readRaw(filePath)) === seen) await fs.rm(filePath, { force: true });
    } finally {
      if ((await readRaw(reclaimPath)) === reclaimContent) await fs.rm(reclaimPath, { force: true });
    }
  }
  return null;
}

// --- receipt writes -----------------------------------------------------------------------

async function saveReceipt(projectDir, receipt, clock) {
  receipt.updatedAt = isoAt(clock);
  await writeJsonAtomic(receiptPath(projectDir), receipt);
  return receipt;
}

// Persists WIX_SITE_ID only after the receipt holds it, and never over a different value.
async function persistSiteBinding(projectDir, metaSiteId) {
  const env = await readWixEnv(projectDir);
  const current = env.WIX_SITE_ID && String(env.WIX_SITE_ID).trim();
  if (current && current !== 'REPLACE_WITH_REAL_VALUE' && current !== metaSiteId) {
    return { ok: false, conflict: current };
  }
  const updates = { WIX_SITE_ID: metaSiteId };
  if (!env.WIX_SITE_STRATEGY) updates.WIX_SITE_STRATEGY = 'new';
  if (current !== metaSiteId || updates.WIX_SITE_STRATEGY) await upsertEnvFile(wixEnvPath(projectDir), updates);
  return { ok: true };
}

// --- recovery requests --------------------------------------------------------------------

const RECOVERY = Object.freeze({
  failed_before_create: {
    title: 'Fix the site-creation prerequisite',
    choices: [{ id: 'retry_create', label: 'Prerequisite fixed — create the site', description: 'The stated cause (access, site limit, template or name) has been corrected; make one new creation attempt.' }],
  },
  ambiguous: {
    title: 'Reconcile an uncertain site creation',
    mode: 'text',
  },
  editor_unverified: {
    title: 'Editor verification did not pass',
    choices: [{ id: 'recheck', label: 'Re-run verification', description: 'Run one new editor readback and published-URLs readback for the saved site; no site is created.' }],
  },
  publication_unknown: {
    title: 'Publication state of the new site could not be read',
    choices: [{ id: 'recheck', label: 'Read the publication state again', description: 'The stated cause (for example access) is fixed; run one new published-URLs readback. No site is created, published or unpublished.' }],
  },
  publication_published: {
    title: 'The new site is already published',
    choices: [{ id: 'recheck_after_unpublish', label: 'Site unpublished in Wix — read again', description: 'A person has unpublished the site in Wix; run one new published-URLs readback. RePlatform never unpublishes it.' }],
  },
  ownership_unverified: {
    title: 'Confirm which account owns the new site',
    mode: 'text',
  },
});

function recoveryPrompt(kind, receipt) {
  const site = receipt.metaSiteId ? ` Site: ${receipt.metaSiteId}.` : '';
  const cause = receipt.error ? ` Cause: ${receipt.error.message}` : '';
  switch (kind) {
    case 'failed_before_create':
      return `The ${receipt.requestedSiteType} site was not created: the request was rejected before creation.${cause} Next: ${receipt.error ? receipt.error.nextAction : 'fix the prerequisite'}. Nothing was created, so one new attempt is safe after the fix.`;
    case 'ambiguous':
      return `The outcome of the site-creation attempt ${receipt.attemptId} is unknown; a site may or may not exist.${site}${cause} ${IMPORT_OPERATOR_PROMPT} Reply with the metasite ID of the site this attempt created (it is then verified before use), or with "none-created: <evidence>" when an independently verified account site list shows that no site was created. Names alone are not identity proof.`;
    case 'editor_unverified':
      return `The new site's editor could not be verified as ${EXPECTED_EDITOR[receipt.requestedSiteType]}.${site}${cause} The site is kept and import stays blocked. ${IMPORT_OPERATOR_PROMPT}`;
    case 'ownership_unverified':
      return `The new site was created, but its owner could not be matched to the confirmed Wix account.${site}${cause} The site is kept and not bound for import. ${IMPORT_OPERATOR_PROMPT} Reply "owner-verified: <evidence>" once the intended account's site list shows this site; editor verification and the published-URLs readback then run. Any other reply asks again. Names alone are not identity proof.`;
    case 'publication_unknown':
      return `The publication state of this new site could not be read.${site}${cause} Import stays blocked until a fresh readback shows the site unpublished; answering only triggers that readback.`;
    case 'publication_published':
      return `This new site is already published. RePlatform imports only into an unpublished new site.${site} A person may unpublish it in Wix (an explicit human publication decision); RePlatform never does. Answering only triggers a new readback.`;
    default:
      return 'Destination recovery is required.';
  }
}

async function raiseRecovery(projectDir, receipt, kind, clock, observation = null) {
  const spec = RECOVERY[kind];
  const request = await createUserAction(projectDir, {
    kind: 'manual_action',
    stage: 'destination',
    title: spec.title,
    prompt: recoveryPrompt(kind, receipt),
    response: { mode: spec.mode || 'choice', required: true },
    choices: spec.choices || [],
    subject: {
      type: 'destination_recovery',
      recovery: kind,
      attemptId: receipt.attemptId,
      metaSiteId: receipt.metaSiteId || null,
      ...(observation ? { observation } : {}),
    },
  });
  receipt.recovery = { kind, requestId: request.requestId, raisedAt: isoAt(clock) };
  return request;
}

async function readRecoveryAnswer(projectDir, receipt) {
  if (!receipt.recovery || !receipt.recovery.requestId) return null;
  let request;
  try { request = await readUserAction(projectDir, receipt.recovery.requestId); } catch { return null; }
  return request && request.status === 'answered' ? request : null;
}

// --- HTTP steps -------------------------------------------------------------------------

function errorFromCreateResponse(res) {
  const body = res.json || {};
  const detail = body.details && body.details.applicationError ? body.details.applicationError : {};
  const code = detail.code || body.code || null;
  const message = String(detail.description || body.message || `HTTP ${res.status}`).slice(0, 500);
  if (res.status === 401 || res.status === 403) return { code: 'access_denied', message, nextAction: 'Log the Wix CLI into the intended account with site-creation permission (access recovery).' };
  if (code === 'TOO_MANY_SITES_FOR_FREE_USER') return { code: 'site_limit', message, nextAction: 'Free a site slot or upgrade the account, then retry.' };
  if (code === 'NOT_A_TEMPLATE' || code === 'APP_NOT_ON_TEMPLATE') return { code: 'template_unavailable', message, nextAction: 'Template support is missing (capability recovery); do not switch editor or fall back to Headless.' };
  if (/name/i.test(message) || /NAME/.test(String(code))) return { code: 'name_rejected', message, nextAction: 'Choose another site name, then retry.' };
  return { code: code ? String(code).toLowerCase() : `http_${res.status}`, message, nextAction: 'Correct the rejected request, then retry.' };
}

async function createFromTemplate(deps, { accountToken, templateId, siteName }) {
  let res;
  try {
    res = await boundedRequest(deps, URLS.createFromTemplate, {
      method: 'POST',
      headers: { Authorization: bearer(accountToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ originTemplateId: templateId, siteName }),
    }, LIMITS.createTimeoutMs);
  } catch (error) {
    return { outcome: 'ambiguous', error: { code: error instanceof CallTimeoutError ? 'create_timeout' : 'create_transport', message: error.message } };
  }
  if (res.status === 200) {
    const metaSite = res.json && res.json.metaSite;
    const metaSiteId = metaSite && metaSite.metaSiteId;
    if (!metaSiteId || !UUID_RE.test(String(metaSiteId))) {
      return { outcome: 'ambiguous', error: { code: 'create_response_invalid', message: 'HTTP 200 without a valid metaSite.metaSiteId' } };
    }
    return { outcome: 'created', metaSiteId: String(metaSiteId), ownerId: metaSite.ownerId || null };
  }
  if (res.status >= 500 || res.status === 408) {
    return { outcome: 'ambiguous', error: { code: `create_http_${res.status}`, message: `HTTP ${res.status}; the remote outcome is unknown` } };
  }
  return { outcome: 'failed_before_create', error: errorFromCreateResponse(res) };
}

function bearer(token) {
  const text = String(token).trim();
  return /^Bearer\s/i.test(text) ? text : `Bearer ${text}`;
}

function siteHeaders(siteToken, metaSiteId) {
  return { Authorization: bearer(siteToken), 'wix-site-id': metaSiteId };
}

async function readEditor(deps, { siteToken, metaSiteId }) {
  try {
    const res = await boundedRequest(deps, URLS.editorUrls, { method: 'GET', headers: siteHeaders(siteToken, metaSiteId) }, LIMITS.editorTimeoutMs);
    const urls = res.json && res.json.urls;
    if (res.status !== 200 || !urls || typeof urls.editorType !== 'string') {
      return { ok: false, httpStatus: res.status, reason: res.status === 200 ? 'malformed_editor_readback' : `editor_readback_http_${res.status}` };
    }
    return { ok: true, httpStatus: 200, editorType: urls.editorType, editorUrl: typeof urls.editorUrl === 'string' ? urls.editorUrl : null };
  } catch (error) {
    return { ok: false, httpStatus: null, reason: error instanceof CallTimeoutError ? 'editor_readback_timeout' : 'editor_readback_transport' };
  }
}

// Returns the observation recorded in the receipt's `publication` field.
async function readPublication(deps, { siteToken, metaSiteId }) {
  const { clock } = deps;
  const startedAt = clock.now();
  const budgetEnd = startedAt + LIMITS.publicationBudgetMs;
  let attempts = 0;
  let lastStatus = null;
  const finish = (state, extra = {}) => ({
    state,
    checkedAt: new Date(clock.now()).toISOString(),
    httpStatus: lastStatus,
    urlCount: null,
    attempts,
    ...extra,
  });
  while (attempts < LIMITS.publicationAttempts) {
    const left = budgetEnd - clock.now();
    if (left < LIMITS.publicationMinLeftMs) return finish('unknown', { reason: 'readback_budget_exhausted' });
    attempts += 1;
    let retryAfter = null;
    try {
      const res = await boundedRequest(deps, URLS.publishedSiteUrls, { method: 'GET', headers: siteHeaders(siteToken, metaSiteId) }, Math.min(LIMITS.publicationTimeoutMs, left));
      lastStatus = res.status;
      if (res.status === 200) {
        const urls = res.json && res.json.urls;
        if (!Array.isArray(urls)) return finish('unknown', { reason: 'malformed_readback' });
        return finish(urls.length ? 'published' : 'unpublished', { urlCount: urls.length });
      }
      if (res.status === 401 || res.status === 403) {
        return finish('unknown', { reason: 'access_denied', accessNote: 'The site-scoped credential was refused; restore access for the bound site (access recovery), then recheck.' });
      }
      if (!isTransientStatus(res.status)) return finish('unknown', { reason: `readback_http_${res.status}` });
      retryAfter = retryAfterMs(res.retryAfter, clock.now());
    } catch {
      // Network failure or per-call timeout: transient, retried within the budget.
      lastStatus = null;
    }
    if (attempts >= LIMITS.publicationAttempts) break;
    const scheduled = LIMITS.publicationWaitsMs[attempts - 1] || 0;
    const wait = Math.max(scheduled, retryAfter === null ? 0 : Math.min(retryAfter, LIMITS.publicationRetryAfterCapMs));
    const remaining = budgetEnd - clock.now();
    await clock.sleep(Math.max(0, Math.min(wait, remaining)));
  }
  return finish('unknown', { reason: attempts >= LIMITS.publicationAttempts ? 'retries_exhausted' : 'readback_budget_exhausted' });
}

function clip(value, max) { return String(value).replace(/[\r\n]+/g, ' ').trim().slice(0, max); }

// Business context the run already has (type and the evidence behind it); it only pre-fills the
// site-type question and never reaches a Wix call.
async function readDestinationBrief(projectDir) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(projectDir, 'orchestration', 'destination-brief.json'), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// --- coordinator --------------------------------------------------------------------------

function newReceipt({ projectId, siteType, pair, clock, randomUUID }) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    projectId,
    attemptId: `dst_${randomUUID()}`,
    createdAt: isoAt(clock),
    updatedAt: isoAt(clock),
    strategy: 'new',
    requestedSiteType: siteType,
    decisionRef: 'orchestration/decisions.json#targetSiteType',
    businessType: pair.businessType || null,
    businessTypeSource: pair.businessTypeSource || null,
    status: 'in_progress',
    creationMethod: null,
    templateId: null,
    siteName: null,
    accountIdentityRef: null,
    intendedAccount: null,
    metaSiteId: null,
    ownerId: null,
    ownerCheck: null,
    observedEditorType: null,
    editorUrl: null,
    editorReadback: null,
    publication: null,
    error: null,
    recovery: null,
    attempts: [],
  };
}

async function pendingRequestFor(projectDir, predicate) {
  const pending = await listUserActions(projectDir, { status: 'pending' });
  for (const row of pending) {
    const request = await readUserAction(projectDir, row.requestId);
    if (predicate(request)) return request;
  }
  return null;
}

function result(outcome, receipt, extra = {}) {
  return { outcome, status: receipt ? receipt.status : null, metaSiteId: receipt ? receipt.metaSiteId : null, receipt, ...extra };
}

// Verification after a metasite ID is known: binding, site credential, editor, publication.
async function verifyCreatedSite(deps, projectDir, receipt) {
  const { clock } = deps;
  const binding = await persistSiteBinding(projectDir, receipt.metaSiteId);
  if (!binding.ok) {
    receipt.status = 'blocked';
    receipt.error = { code: 'binding_conflict', message: `config/wix.env names a different WIX_SITE_ID (${binding.conflict}); refusing to overwrite it.`, nextAction: 'Resolve which destination is authoritative; never retarget on a guess.' };
    await raiseRecovery(projectDir, receipt, 'editor_unverified', clock);
    await saveReceipt(projectDir, receipt, clock);
    return result('blocked', receipt);
  }
  receipt.envPersisted = true;
  let siteToken;
  try {
    siteToken = await deps.credentials.siteToken(receipt.metaSiteId);
  } catch (error) {
    siteToken = null;
  }
  if (!siteToken) {
    receipt.status = 'blocked';
    receipt.error = { code: 'site_credential_unavailable', message: 'A site-scoped credential could not be minted for the new site through the Wix CLI login.', nextAction: 'Confirm the Wix CLI is logged into the account that owns the site (access recovery), then recheck.' };
    await raiseRecovery(projectDir, receipt, 'editor_unverified', clock);
    await saveReceipt(projectDir, receipt, clock);
    return result('blocked', receipt);
  }
  const editor = await readEditor(deps, { siteToken, metaSiteId: receipt.metaSiteId });
  receipt.editorReadback = { checkedAt: isoAt(clock), httpStatus: editor.httpStatus, ...(editor.ok ? {} : { reason: editor.reason }) };
  receipt.observedEditorType = editor.ok ? editor.editorType : null;
  if (editor.ok && editor.editorUrl) receipt.editorUrl = editor.editorUrl;
  const expected = EXPECTED_EDITOR[receipt.requestedSiteType];
  if (!editor.ok || editor.editorType !== expected) {
    receipt.status = 'blocked';
    receipt.error = editor.ok
      ? { code: 'editor_mismatch', message: `The site's editor is ${editor.editorType}, not the requested ${expected}.`, nextAction: 'Keep the site; reconcile the choice with the Import Operator. Never create another site to fix this.' }
      : { code: 'editor_unverified', message: `Editor readback failed (${editor.reason}).`, nextAction: 'Fix the stated cause, then recheck.' };
    await raiseRecovery(projectDir, receipt, 'editor_unverified', clock);
    await saveReceipt(projectDir, receipt, clock);
    return result('blocked', receipt);
  }
  return checkPublication(deps, projectDir, receipt, siteToken);
}

async function checkPublication(deps, projectDir, receipt, siteToken, { recheckRequestId = null } = {}) {
  const { clock } = deps;
  const observation = await readPublication(deps, { siteToken, metaSiteId: receipt.metaSiteId });
  receipt.publication = { ...observation, ...(recheckRequestId ? { recheckRequestId } : {}) };
  if (observation.state === 'unpublished') {
    receipt.status = 'verified';
    receipt.error = null;
    receipt.recovery = null;
    await saveReceipt(projectDir, receipt, clock);
    return result('verified', receipt);
  }
  receipt.status = 'blocked';
  receipt.error = observation.state === 'published'
    ? { code: 'publication_published', message: `The published-URLs readback returned ${observation.urlCount} URL(s).`, nextAction: 'A person may unpublish the site in Wix; then recheck. RePlatform never unpublishes it.' }
    : { code: 'publication_unknown', message: `The published-URLs readback was not conclusive (${observation.reason}).${observation.accessNote ? ` ${observation.accessNote}` : ''}`, nextAction: 'Fix the stated cause, then recheck.' };
  await raiseRecovery(projectDir, receipt, observation.state === 'published' ? 'publication_published' : 'publication_unknown', clock, {
    state: observation.state, checkedAt: observation.checkedAt, httpStatus: observation.httpStatus, urlCount: observation.urlCount,
  });
  await saveReceipt(projectDir, receipt, clock);
  return result('blocked', receipt);
}

// One new readback for the bound site, minted fresh; no create call. Used by a recovery
// answer and by every resume of a `verified` receipt, so an earlier `unpublished` is never
// reused as proof before setup/import. Anything but a new `unpublished` blocks (fail-closed).
async function freshPublicationReadback(deps, projectDir, receipt, { recheckRequestId = null } = {}) {
  const { clock } = deps;
  let siteToken = null;
  try { siteToken = await deps.credentials.siteToken(receipt.metaSiteId); } catch { siteToken = null; }
  if (!siteToken) {
    // Being unable to obtain the readback is itself an `unknown` observation. Record it so
    // the receipt never keeps an earlier `unpublished` beside a publication_unknown block.
    receipt.status = 'blocked';
    receipt.publication = {
      state: 'unknown', checkedAt: isoAt(clock), httpStatus: null, urlCount: null, attempts: 0, reason: 'site_credential_unavailable',
      ...(recheckRequestId ? { recheckRequestId } : {}),
    };
    receipt.error = { code: 'site_credential_unavailable', message: 'A site-scoped credential could not be minted for the readback.', nextAction: 'Restore access, then recheck.' };
    await raiseRecovery(projectDir, receipt, 'publication_unknown', clock, {
      state: 'unknown', checkedAt: receipt.publication.checkedAt, httpStatus: null, urlCount: null,
    });
    await saveReceipt(projectDir, receipt, clock);
    return result('blocked', receipt);
  }
  return checkPublication(deps, projectDir, receipt, siteToken, { recheckRequestId });
}

// --- intended account (confirm the intended account before mutation) ----------------

const ACCOUNT_CONFIRMATION = 'destination_account_confirmation';
const EDITOR_LABEL = Object.freeze({ studio: 'Wix Studio', harmony: 'Wix Harmony' });

// The account the Wix CLI is logged into right now: the `whoami` identity (shown to the
// operator, stored only as a hash) and the login's user id, which the creation response's
// `metaSite.ownerId` is checked against.
async function readCurrentAccount(deps) {
  let identity = null;
  try { identity = await deps.credentials.identity(); } catch { identity = null; }
  if (!identity || !identity.authenticated || !identity.identity) {
    return { ok: false, error: { code: 'account_unconfirmed', message: 'The Wix CLI account identity could not be confirmed before creation.', nextAction: 'Log the Wix CLI into the intended account (replatform account), then retry.' } };
  }
  let userId = null;
  try { userId = deps.credentials.userId ? await deps.credentials.userId() : null; } catch { userId = null; }
  if (!userId || !UUID_RE.test(String(userId))) {
    return { ok: false, error: { code: 'account_unconfirmed', message: 'The Wix CLI login\'s user id could not be read, so the new site\'s ownership could not be checked.', nextAction: 'Log the Wix CLI into the intended account again (wix login), then retry.' } };
  }
  return { ok: true, identity: clip(identity.identity, 200), identityRef: identityRef(identity.identity), userId: String(userId).toLowerCase() };
}

function sameAccount(left, right) {
  return Boolean(left && right && left.identityRef === right.identityRef && left.userId === right.userId);
}

async function latestAccountConfirmation(projectDir) {
  const rows = await listUserActions(projectDir);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const request = await readUserAction(projectDir, rows[index].requestId);
    if (request.subject && request.subject.type === ACCOUNT_CONFIRMATION) return request;
  }
  return null;
}

// The operator confirms the account actually logged in, shown by name, before the first
// create. The newest confirmation request decides: pending waits; `confirm_account` binds the
// account it showed, but only while that same account is still logged in; anything else
// (switched login, `switched_account`) raises a new request that shows the current account.
async function confirmIntendedAccount(projectDir, receipt, account) {
  const latest = await latestAccountConfirmation(projectDir);
  if (latest && latest.status === 'pending') return { ok: false, awaiting: true, requestId: latest.requestId };
  if (latest && latest.status === 'answered' && latest.answer && latest.answer.choice === 'confirm_account' && sameAccount(latest.subject, account)) {
    return { ok: true, intended: { identityRef: account.identityRef, userId: account.userId, confirmationRequestId: latest.requestId, confirmedAt: latest.answer.answeredAt || null } };
  }
  const siteName = normalizeSiteName(receipt.siteName || receipt.projectId, { suffix: receipt.nameSuffix || '' });
  const request = await createUserAction(projectDir, {
    kind: 'question',
    stage: 'destination',
    title: 'Confirm the Wix account for the new site',
    prompt: `RePlatform is about to create the new ${EDITOR_LABEL[receipt.requestedSiteType]} site "${siteName}" in the Wix account the Wix CLI is logged into: ${account.identity}. Confirm that this is the intended account; nothing is created until you do. If it is not, log the Wix CLI into the intended account first, then choose "I switched accounts" so the account is shown again.`,
    response: { mode: 'choice', required: true },
    choices: [
      { id: 'confirm_account', label: 'Create the site in this account', description: 'This is the intended Wix account. The creation response must name this login as the site owner.' },
      { id: 'switched_account', label: 'I switched accounts — show it again', description: 'The Wix CLI is now logged into the intended account; show that account for confirmation. Nothing is created.' },
    ],
    subject: { type: ACCOUNT_CONFIRMATION, identityRef: account.identityRef, userId: account.userId, siteType: receipt.requestedSiteType },
  });
  return { ok: false, awaiting: true, requestId: request.requestId };
}

// Before any create: the logged-in account must be the confirmed intended account. With
// `confirm: false` it only re-checks a recorded binding.
async function requireAccount(deps, projectDir, receipt, { confirm = true } = {}) {
  const account = await readCurrentAccount(deps);
  if (!account.ok) return account;
  receipt.accountIdentityRef = account.identityRef;
  if (receipt.intendedAccount) {
    if (!sameAccount(receipt.intendedAccount, account)) {
      return { ok: false, error: { code: 'account_mismatch', message: 'The Wix CLI is logged into a different account from the one confirmed for this site.', nextAction: 'Log the Wix CLI back into the confirmed account, then retry. To use another account instead, retry while logged into it and confirm that account when asked.' } };
    }
  } else if (confirm) {
    const confirmation = await confirmIntendedAccount(projectDir, receipt, account);
    if (!confirmation.ok) return confirmation;
    receipt.intendedAccount = confirmation.intended;
  }
  let accountToken = null;
  try { accountToken = await deps.credentials.accountToken(); } catch { accountToken = null; }
  if (!accountToken) {
    return { ok: false, error: { code: 'account_credential_unavailable', message: 'No account credential is available from the Wix CLI login.', nextAction: 'Log the Wix CLI into the intended account, then retry.' } };
  }
  return { ok: true, accountToken };
}

function awaitingAccount(confirmation) {
  return { outcome: 'awaiting_account_confirmation', status: null, metaSiteId: null, receipt: null, requestId: confirmation.requestId };
}

async function failBeforeCreate(deps, projectDir, receipt, error) {
  receipt.status = 'failed_before_create';
  receipt.error = error;
  await raiseRecovery(projectDir, receipt, 'failed_before_create', deps.clock);
  await saveReceipt(projectDir, receipt, deps.clock);
  return result('failed_before_create', receipt);
}

async function markAmbiguous(deps, projectDir, receipt, error) {
  receipt.status = 'ambiguous';
  receipt.error = { ...error, nextAction: 'Reconcile with the Import Operator; never repeat the create.' };
  await raiseRecovery(projectDir, receipt, 'ambiguous', deps.clock);
  await saveReceipt(projectDir, receipt, deps.clock);
  return result('ambiguous', receipt);
}

async function createEditorSite(deps, projectDir, receipt, decisions) {
  const { clock } = deps;
  const account = await requireAccount(deps, projectDir, receipt);
  // Awaiting the account confirmation writes nothing: no receipt status changes, no attempt.
  if (!account.ok && account.awaiting) return awaitingAccount(account);
  if (!account.ok) return failBeforeCreate(deps, projectDir, receipt, account.error);
  receipt.attempts.push({ attemptId: receipt.attemptId, startedAt: isoAt(clock) });
  // Harmony and Studio sites are both created from the public blank template. Harmony's AI site
  // generation lives behind a private service with no stability promise, so it is not used.
  receipt.creationMethod = 'blank_template';
  receipt.templateId = BLANK_TEMPLATES[receipt.requestedSiteType];
  receipt.siteName = normalizeSiteName(receipt.siteName || receipt.projectId, { suffix: receipt.nameSuffix || '' });
  await saveReceipt(projectDir, receipt, clock);
  const created = await createFromTemplate(deps, { accountToken: account.accountToken, templateId: receipt.templateId, siteName: receipt.siteName });
  if (created.outcome === 'failed_before_create') return failBeforeCreate(deps, projectDir, receipt, created.error);
  if (created.outcome === 'ambiguous') return markAmbiguous(deps, projectDir, receipt, created.error);
  receipt.status = 'created';
  receipt.metaSiteId = created.metaSiteId;
  receipt.ownerId = created.ownerId;
  // The response's owner must be the confirmed account's login. A missing or different
  // owner keeps the site (ID saved above) but never binds it for import.
  const intendedUserId = receipt.intendedAccount && receipt.intendedAccount.userId;
  const owner = created.ownerId ? String(created.ownerId).toLowerCase() : null;
  receipt.ownerCheck = { state: !owner ? 'missing' : owner === intendedUserId ? 'matched' : 'mismatch', checkedAt: isoAt(clock) };
  if (receipt.ownerCheck.state !== 'matched') {
    receipt.status = 'blocked';
    receipt.error = owner
      ? { code: 'owner_mismatch', message: `The creation response names owner ${owner}, not the confirmed Wix CLI login.`, nextAction: 'Keep the site; reconcile its account with the Import Operator. Never create another site to fix this.' }
      : { code: 'owner_missing', message: 'The creation response did not name the new site\'s owner, so the intended account could not be checked.', nextAction: 'Keep the site; confirm its account with the Import Operator.' };
    await raiseRecovery(projectDir, receipt, 'ownership_unverified', clock);
    await saveReceipt(projectDir, receipt, clock);
    return result('blocked', receipt);
  }
  await saveReceipt(projectDir, receipt, clock);
  return verifyCreatedSite(deps, projectDir, receipt);
}

// Acts on an answered recovery request. Each answer triggers exactly one bounded step.
async function resumeFromRecovery(deps, projectDir, receipt, request, decisions) {
  const { clock } = deps;
  const kind = receipt.recovery.kind;
  const choice = request.answer && request.answer.choice;
  if (kind === 'failed_before_create' && choice === 'retry_create') {
    const previous = receipt.attempts.length;
    receipt.attemptId = `dst_${deps.randomUUID()}`;
    if (receipt.error && receipt.error.code === 'name_rejected') receipt.nameSuffix = String(previous + 1);
    // Retrying after a login change means the account must be confirmed again before a create.
    if (receipt.error && receipt.error.code === 'account_mismatch') receipt.intendedAccount = null;
    receipt.status = 'in_progress';
    receipt.error = null;
    receipt.recovery = null;
    return createEditorSite(deps, projectDir, receipt, decisions);
  }
  if (kind === 'ambiguous') {
    const text = String(request.answer && request.answer.text || '').trim();
    const idMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (/^none-created:\s*\S/i.test(text)) {
      // Explicit recovery decision with evidence that the prior request created nothing.
      receipt.attempts.push({ attemptId: receipt.attemptId, resolvedAt: isoAt(clock), resolution: 'none_created', evidence: clip(text.replace(/^none-created:\s*/i, ''), 500), requestId: request.requestId });
      receipt.attemptId = `dst_${deps.randomUUID()}`;
      receipt.status = 'in_progress';
      receipt.error = null;
      receipt.recovery = null;
      return createEditorSite(deps, projectDir, receipt, decisions);
    }
    if (idMatch) {
      receipt.attempts.push({ attemptId: receipt.attemptId, resolvedAt: isoAt(clock), resolution: 'adopted', requestId: request.requestId });
      receipt.metaSiteId = idMatch[0].toLowerCase();
      receipt.status = 'created';
      receipt.error = null;
      receipt.recovery = null;
      await saveReceipt(projectDir, receipt, clock);
      return verifyCreatedSite(deps, projectDir, receipt);
    }
    // Unusable answer: ask again; never guess.
    receipt.error = { code: 'reconciliation_answer_invalid', message: 'The reconciliation answer named neither a metasite ID nor "none-created: <evidence>".', nextAction: 'Answer the new reconciliation request.' };
    await raiseRecovery(projectDir, receipt, 'ambiguous', clock);
    await saveReceipt(projectDir, receipt, clock);
    return result('ambiguous', receipt);
  }
  if (kind === 'ownership_unverified') {
    const text = String(request.answer && request.answer.text || '').trim();
    if (/^owner-verified:\s*\S/i.test(text)) {
      receipt.ownerCheck = { ...receipt.ownerCheck, state: 'operator_verified', evidence: clip(text.replace(/^owner-verified:\s*/i, ''), 500), requestId: request.requestId, checkedAt: isoAt(clock) };
      receipt.status = 'created';
      receipt.error = null;
      receipt.recovery = null;
      await saveReceipt(projectDir, receipt, clock);
      return verifyCreatedSite(deps, projectDir, receipt);
    }
    receipt.error = { code: 'ownership_answer_invalid', message: 'The ownership answer was not "owner-verified: <evidence>".', nextAction: 'Answer the new ownership request.' };
    await raiseRecovery(projectDir, receipt, 'ownership_unverified', clock);
    await saveReceipt(projectDir, receipt, clock);
    return result('blocked', receipt);
  }
  if (kind === 'editor_unverified' && choice === 'recheck') {
    receipt.status = 'created';
    receipt.error = null;
    receipt.recovery = null;
    return verifyCreatedSite(deps, projectDir, receipt);
  }
  if ((kind === 'publication_unknown' && choice === 'recheck') || (kind === 'publication_published' && choice === 'recheck_after_unpublish')) {
    // The answer itself changes neither status nor `publication`; only the new readback can.
    return freshPublicationReadback(deps, projectDir, receipt, { recheckRequestId: request.requestId });
  }
  return result('blocked', receipt, { reason: 'unsupported_recovery_answer' });
}

async function runHeadless(deps, projectDir, receipt, clock) {
  receipt.creationMethod = 'headless_cli';
  await saveReceipt(projectDir, receipt, clock);
  const outcome = await deps.headless({ projectDir, businessName: receipt.projectId });
  const env = await readWixEnv(projectDir);
  const siteId = env.WIX_SITE_ID ? String(env.WIX_SITE_ID).trim() : '';
  // A truthy placeholder or malformed id is not a binding: only a UUID-shaped site id counts as created.
  if (outcome && outcome.ok && UUID_RE.test(siteId)) {
    receipt.status = 'created';
    receipt.metaSiteId = siteId;
    receipt.error = null;
  } else {
    // The wrapper's own WIX_SCAFFOLD_STATUS safeguards decide recovery; the receipt only records.
    receipt.status = 'blocked';
    receipt.error = { code: 'headless_scaffold_failed', message: clip(outcome && outcome.message ? outcome.message : 'headless scaffold did not confirm a destination', 500), nextAction: 'Follow the wrapper\'s WIX_SCAFFOLD_STATUS recovery; never retry blindly.' };
  }
  await saveReceipt(projectDir, receipt, clock);
  return result(receipt.status === 'created' ? 'created' : 'blocked', receipt);
}

// A Headless receipt is resumed through the wrapper's own WIX_SCAFFOLD_STATUS contract and is
// never a reason to delegate again: a confirmed site is adopted, and any status marker the
// wrapper left (in_progress, incomplete, ambiguous, ...) is that wrapper's recovery to own.
// Only an untouched wix.env (no WIX_SITE_ID, no marker), which the wrapper itself treats as
// "nothing was attempted" because it writes its marker before any create, allows one new
// delegation (for example after an operator cleared the marker per the wrapper's guidance).
async function resumeHeadless(deps, projectDir, receipt, env) {
  const { clock } = deps;
  const siteId = env.WIX_SITE_ID && env.WIX_SITE_ID !== 'REPLACE_WITH_REAL_VALUE' ? String(env.WIX_SITE_ID).trim() : null;
  const marker = env.WIX_SCAFFOLD_STATUS;
  if (siteId && (marker === undefined || marker === 'complete')) {
    if (receipt.status !== 'created' || receipt.metaSiteId !== siteId) {
      receipt.status = 'created';
      receipt.metaSiteId = UUID_RE.test(siteId) ? siteId : receipt.metaSiteId;
      receipt.error = null;
      await saveReceipt(projectDir, receipt, clock);
    }
    return result('created', receipt);
  }
  if (marker !== undefined) {
    return result('blocked', receipt, { reason: 'destination_scaffold_state_requires_recovery' });
  }
  return runHeadless(deps, projectDir, receipt, clock);
}

// Entry point. Returns `{ outcome, ... }` where outcome is one of: not_new_site,
// existing_destination, awaiting_site_type, awaiting_editor_website_decision,
// awaiting_account_confirmation, awaiting_recovery,
// verified, created, failed_before_create, ambiguous, blocked, locked, invalid.
async function ensureDestination(projectDir, deps) {
  const release = await acquireLock(projectDir);
  if (!release) {
    const reclaimLeft = (await readRaw(`${lockPath(projectDir)}.reclaim`)) !== null;
    return {
      outcome: 'locked',
      reason: reclaimLeft
        ? 'orchestration/destination.lock.reclaim exists: a lock reclamation did not finish. If no destination command is running, remove that file, then retry.'
        : 'another destination invocation holds orchestration/destination.lock',
    };
  }
  try {
    return await ensureDestinationLocked(projectDir, deps);
  } finally {
    await release();
  }
}

async function ensureDestinationLocked(projectDir, deps) {
  const { clock } = deps;
  const artifacts = await loadArtifacts(projectDir);
  if (!artifacts.decisions) return { outcome: 'invalid', reason: 'orchestration decisions are not initialized' };
  const decisions = artifacts.decisions;
  const strategy = getDecisionValue(decisions, 'targetSiteStrategy');
  // Recheck receipts and config while holding the lock, before every create.
  let receipt = await readReceipt(projectDir);
  const env = await readWixEnv(projectDir);
  if (receipt) {
    const errors = validateReceipt(receipt);
    if (errors.length) return { outcome: 'invalid', reason: 'destination_receipt_invalid', errors };
  }
  if (!isNewSiteStrategy(strategy) && !receipt) return { outcome: 'not_new_site' };

  const envSiteId = env.WIX_SITE_ID && env.WIX_SITE_ID !== 'REPLACE_WITH_REAL_VALUE' ? String(env.WIX_SITE_ID).trim() : null;
  if (!receipt && envSiteId) {
    // Authoritative existing or legacy destination: zero creates, no retroactive type gate.
    return { outcome: 'existing_destination', metaSiteId: envSiteId };
  }
  if (!receipt && env.WIX_SCAFFOLD_STATUS !== undefined) {
    // A prior Headless wrapper attempt left a marker: its own safeguards own recovery.
    return { outcome: 'blocked', reason: 'destination_scaffold_state_requires_recovery' };
  }

  const choice = readSiteTypeDecision(decisions);
  if (!receipt) {
    if (!choice) {
      const pending = await pendingRequestFor(projectDir, (request) => request.effect && request.effect.key === 'targetSiteType');
      if (pending) return { outcome: 'awaiting_site_type', requestId: pending.requestId };
      const brief = await readDestinationBrief(projectDir);
      const contextBusinessType = KNOWN_BUSINESS_TYPES.includes(brief.businessType) && brief.businessTypeEvidenceRef ? brief.businessType : null;
      // The account is confirmed by name in its own request just before the first create.
      const request = await createUserAction(projectDir, siteTypeRequestInput({
        contextBusinessType,
        evidenceRef: contextBusinessType ? clip(brief.businessTypeEvidenceRef, 200) : null,
        siteName: normalizeSiteName(artifacts.run && artifacts.run.projectId),
      }));
      return { outcome: 'awaiting_site_type', requestId: request.requestId };
    }
    if (choice.errors.length) return { outcome: 'invalid', reason: 'site_type_decision_invalid', errors: choice.errors };
  } else if (choice && !choice.errors.length && choice.siteType !== receipt.requestedSiteType) {
    // A decision change never retargets a bound attempt (body item 3).
    return { outcome: 'invalid', reason: 'destination_type_conflict', errors: [`receipt requested ${receipt.requestedSiteType}; decisions now say ${choice.siteType}`] };
  }

  const siteType = receipt ? receipt.requestedSiteType : choice.siteType;
  if (receipt && receipt.metaSiteId && envSiteId && envSiteId !== receipt.metaSiteId) {
    return { outcome: 'invalid', reason: 'destination_binding_conflict', errors: [`config/wix.env WIX_SITE_ID differs from the receipt's metaSiteId`] };
  }

  if (siteType === 'headless') {
    if (!receipt) {
      receipt = newReceipt({ projectId: (artifacts.run && artifacts.run.projectId) || path.basename(projectDir), siteType, pair: choice, clock, randomUUID: deps.randomUUID });
      return runHeadless(deps, projectDir, receipt, clock);
    }
    return resumeHeadless(deps, projectDir, receipt, env);
  }

  // Editor branch. Scope guard first, before any site exists.
  if (!receipt && getDecisionValue(decisions, 'deliveryMode') === 'management_and_website' && !getDecisionValue(decisions, 'editorWebsiteDecision')) {
    const pending = await pendingRequestFor(projectDir, (request) => request.effect && request.effect.key === 'editorWebsiteDecision');
    if (pending) return { outcome: 'awaiting_editor_website_decision', requestId: pending.requestId };
    const request = await createUserAction(projectDir, editorWebsiteRequestInput({ siteType }));
    return { outcome: 'awaiting_editor_website_decision', requestId: request.requestId };
  }

  if (!receipt) {
    receipt = newReceipt({ projectId: (artifacts.run && artifacts.run.projectId) || path.basename(projectDir), siteType, pair: choice, clock, randomUUID: deps.randomUUID });
    return createEditorSite(deps, projectDir, receipt, decisions);
  }

  switch (receipt.status) {
    case 'verified': {
      const binding = await persistSiteBinding(projectDir, receipt.metaSiteId);
      if (!binding.ok) return { outcome: 'invalid', reason: 'destination_binding_conflict', errors: [`config/wix.env WIX_SITE_ID differs from the receipt's metaSiteId`] };
      // A resume repeats the readback before setup/import; never recreates the site.
      return freshPublicationReadback(deps, projectDir, receipt);
    }
    case 'in_progress':
      // The attempt marker exists but no outcome was recorded: the request may have been sent.
      return markAmbiguous(deps, projectDir, receipt, { code: 'attempt_interrupted', message: 'A creation attempt was interrupted before its outcome was recorded.' });
    case 'created':
      // A receipt written by an older version that used Harmony site generation cannot be resumed:
      // the generation service is no longer called. Reconcile the site manually instead.
      if (receipt.creationMethod === 'harmony_generation' && !receipt.metaSiteId) {
        return markAmbiguous(deps, projectDir, receipt, { code: 'harmony_generation_unsupported', message: 'This destination was started with Harmony site generation, which RePlatform no longer uses, so the generation job cannot be resumed.' });
      }
      return verifyCreatedSite(deps, projectDir, receipt);
    case 'failed_before_create':
    case 'ambiguous':
    case 'blocked': {
      const answered = await readRecoveryAnswer(projectDir, receipt);
      if (!answered) return result('awaiting_recovery', receipt, { requestId: receipt.recovery ? receipt.recovery.requestId : null });
      return resumeFromRecovery(deps, projectDir, receipt, answered, decisions);
    }
    default:
      return { outcome: 'invalid', reason: 'destination_receipt_invalid' };
  }
}

module.exports = {
  BLANK_TEMPLATES,
  acquireLock,
  EXPECTED_EDITOR,
  LIMITS,
  RECEIPT_STATUSES,
  URLS,
  ensureDestination,
  normalizeSiteName,
  readPublication,
  readReceipt,
  receiptPath,
  validateReceipt,
};
