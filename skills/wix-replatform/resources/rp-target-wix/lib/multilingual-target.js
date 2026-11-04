'use strict';

const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');

const ROUTES = Object.freeze({
  install: 'multilingual-app-install',
  mode: 'multilingual-mode-update',
  localeCreate: 'locale-bulk-create',
  localeRead: 'locale-query',
  collectionCreate: 'recovery-collection-create',
  collectionRead: 'recovery-collection-read',
  journalCreate: 'recovery-row-create',
  journalRead: 'recovery-row-read',
  journalUpdate: 'recovery-row-update',
  contentCreate: 'translation-content-create',
  contentUpdate: 'translation-content-update',
  contentRead: 'translation-content-read',
  collectionDelete: 'recovery-collection-delete',
});

function mutationError(route) {
  return Object.assign(new Error(`route ${route} lacks versioned disposable-site proof`), {
    code: 'LANG_TARGET_MUTATION_UNVERIFIED',
    route,
  });
}

function requireRouteProof(proof, route) {
  const row = proof?.routes?.[route];
  if (!row || row.verified !== true || typeof row.version !== 'string' || !row.version) throw mutationError(route);
  return row;
}

function matchingDecision(decisions, kind, action) {
  return (decisions || []).find((row) => row.kind === kind && row.actionId === action.actionId && row.scopeDigest === action.scopeDigest);
}

function setupProposal({ current = {}, additionalLocales = [], siteOrigin = 'existing' }) {
  const existingLocales = new Map((current.locales || []).map((row) => [row.locale, row]));
  const missingLocales = additionalLocales.filter((locale) => !existingLocales.has(locale)).sort();
  const proposal = {
    installMultilingual: current.appInstalled !== true,
    enableMultilingualMode: current.multilingualMode !== true,
    addHiddenLocales: missingLocales,
  };
  const changes = proposal.installMultilingual || proposal.enableMultilingualMode || proposal.addHiddenLocales.length > 0;
  const proposalDigest = core.digest(proposal);
  const action = {
    actionId: core.actionId('LANG_TARGET_SETUP_CONFIRMATION_REQUIRED', proposalDigest.slice(0, 24)),
    reasonCode: 'LANG_TARGET_SETUP_CONFIRMATION_REQUIRED',
    scopeDigest: proposalDigest,
    affectedIds: missingLocales,
  };
  return { siteOrigin, changes, proposal, proposalDigest, action };
}

async function executeSetup({ adapter, proof, current, additionalLocales, siteOrigin, decisions = [] }) {
  const planned = setupProposal({ current, additionalLocales, siteOrigin });
  if (!planned.changes) return { status: 'ready', requests: [], ...planned, after: current };
  if (siteOrigin !== 'created') {
    if (matchingDecision(decisions, 'decline-setup', planned.action)) return { status: 'declined', requests: [], ...planned, after: current };
    if (!matchingDecision(decisions, 'confirm-setup', planned.action)) return { status: 'confirmation-required', requests: [], ...planned, after: current };
  }
  const requests = [];
  const call = async (route, method, value) => {
    requireRouteProof(proof, route);
    if (typeof adapter[method] !== 'function') throw new Error(`multilingual target adapter lacks ${method}`);
    requests.push(route);
    return adapter[method](value);
  };
  try {
    if (planned.proposal.installMultilingual) await call(ROUTES.install, 'installMultilingualApp');
    if (planned.proposal.enableMultilingualMode) await call(ROUTES.mode, 'setMultilingualMode', true);
    if (planned.proposal.addHiddenLocales.length) {
      await call(ROUTES.localeCreate, 'createLocales', planned.proposal.addHiddenLocales.map((locale) => ({ locale, visibility: 'HIDDEN' })));
    }
    requireRouteProof(proof, ROUTES.localeRead);
    requests.push(ROUTES.localeRead);
    const after = await adapter.readLocaleState();
    for (const locale of planned.proposal.addHiddenLocales) {
      const row = (after.locales || []).find((item) => item.locale === locale);
      if (!row || row.visibility !== 'HIDDEN') throw Object.assign(new Error(`locale ${locale} was not read back hidden`), { code: 'LANG_TARGET_LOCALE_NOT_READY' });
    }
    for (const before of current.locales || []) {
      const afterRow = (after.locales || []).find((item) => item.locale === before.locale);
      if (!afterRow || afterRow.visibility !== before.visibility) throw Object.assign(new Error(`locale visibility changed for ${before.locale}`), { code: 'LANG_PUBLIC_READBACK_MISMATCH' });
    }
    return { status: 'ready', requests, ...planned, after };
  } catch (error) {
    error.requests = [...requests];
    throw error;
  }
}

async function ensureRecoveryJournal({ adapter, proof, onRequest = () => {} }) {
  if (typeof adapter.inspectRecoveryCollection !== 'function') throw new Error('multilingual target adapter lacks inspectRecoveryCollection');
  requireRouteProof(proof, ROUTES.collectionRead);
  onRequest(ROUTES.collectionRead);
  let state = await adapter.inspectRecoveryCollection();
  if (state.status === 'absent') {
    requireRouteProof(proof, ROUTES.collectionCreate);
    if (typeof adapter.createRecoveryCollection !== 'function') throw new Error('multilingual target adapter lacks createRecoveryCollection');
    onRequest(ROUTES.collectionCreate);
    await adapter.createRecoveryCollection({ id: 'ReplatformTranslationRecovery', permissions: 'administrator-only' });
    onRequest(ROUTES.collectionRead);
    state = await adapter.inspectRecoveryCollection();
  }
  if (state.status !== 'compatible' || state.permissions !== 'administrator-only' || state.readable !== true) {
    throw Object.assign(new Error('administrator-only recovery collection is not ready'), { code: 'LANG_RECOVERY_JOURNAL_NOT_READY', state });
  }
  return state;
}

function valueMatches(read, expected, published) {
  return read && core.canonical(read.value) === core.canonical(expected) && read.published === published;
}

function assertUnchangedGuards(read, row) {
  for (const field of ['unrelatedDigest', 'defaultDigest']) {
    if (row.target?.[field] && read?.[field] !== row.target[field]) {
      throw Object.assign(new Error(`${field} changed for ${row.rowId}`), { code: 'LANG_PUBLIC_READBACK_MISMATCH' });
    }
  }
}

function preparedJournalValid(journal, row) {
  return journal && journal.outcome === 'prepared'
    && journal.identityDigest === core.digest(row.identity)
    && journal.sourceDigest === core.digest(row.sourceValue)
    && journal.replacementDigest === row.replacementDigest;
}

function journalPayloadMatches(actual, expected) {
  if (!actual) return false;
  return Object.keys(expected).every((key) => core.canonical(actual[key]) === core.canonical(expected[key]));
}

function counter() {
  const requestsByRoute = {};
  const record = (route) => { requestsByRoute[route] = (requestsByRoute[route] || 0) + 1; };
  return { requestsByRoute, record };
}

function targetReference(row) {
  return { ...row.identity, ...(row.contentId ? { contentId: row.contentId } : {}) };
}

function durableOverwriteAction(row) {
  if (row.reasonCode !== 'LANG_TARGET_TRANSLATION_OVERWRITTEN') return null;
  return {
    actionId: core.actionId(row.reasonCode, row.rowId),
    reasonCode: row.reasonCode,
    scopeDigest: core.scopeDigest(row),
    affectedIds: [row.rowId],
  };
}

function durableChange(journal, row, verifiedAt) {
  return {
    recoveryRowId: journal.id,
    rowId: journal.rowId || row.rowId,
    locale: journal.locale || row.locale,
    identity: journal.identity,
    identityDigest: journal.identityDigest,
    sourceDigest: journal.sourceDigest,
    replacementDigest: journal.replacementDigest,
    priorState: journal.prior?.state || null,
    priorPublished: journal.prior?.published === true,
    decision: journal.decision,
    operatorAction: journal.operatorAction || null,
    outcome: 'verified',
    verifiedAt,
  };
}

async function executePlan({ projectDir, plan, adapter, proof, runId = core.stableId(Date.now(), process.pid), now = () => new Date().toISOString() }) {
  if (!plan || !Array.isArray(plan.rows)) throw new Error('multilingual plan rows are required');
  const started = Date.now();
  const count = counter();
  const writesFile = path.join(projectDir, 'state/multilingual-public/writes.ndjson');
  const changesFile = path.join(projectDir, 'state/multilingual-public/changes.ndjson');
  const receiptRows = [];
  const pathCounts = { alreadyPublishedChanged: 0, missingOrUnpublishedChanged: 0, equalUnpublished: 0, equalPublished: 0 };
  let journalReady = false;
  let activeRow = null;
  let activeRoute = null;
  let activeFieldOps = 0;
  let failure = null;
  let receipt;
  let cost;
  const call = async (route, method, ...args) => {
    activeRoute = route;
    requireRouteProof(proof, route);
    if (typeof adapter[method] !== 'function') throw new Error(`multilingual target adapter lacks ${method}`);
    count.record(route);
    return adapter[method](...args);
  };
  try {
    for (const row of plan.rows) {
    activeRow = row;
    activeRoute = null;
    activeFieldOps = 0;
    const rowCall = async (...args) => { activeFieldOps += 1; return call(...args); };
    const record = async (kind, status, extra = {}) => core.appendNdjson(writesFile, {
      at: now(),
      rowId: row.rowId,
      contentId: row.contentId || null,
      entityId: row.identity?.targetObjectId || null,
      kind,
      status,
      ...extra,
    });
    if (row.decision === 'skip-equal') {
      pathCounts.equalPublished += 1;
      receiptRows.push({ rowId: row.rowId, status: 'verified', writes: 0, state: row.state });
      continue;
    }
    if (['skip-unsupported', 'skip-absent-leave-target', 'blocked'].includes(row.decision)) {
      receiptRows.push({ rowId: row.rowId, status: 'attention-required', writes: 0, state: row.state, reasonCode: row.reasonCode });
      continue;
    }
    if (row.decision === 'finalize-prepared') {
      if (!journalReady) { await ensureRecoveryJournal({ adapter, proof, onRequest: count.record }); journalReady = true; }
      const journal = await rowCall(ROUTES.journalRead, 'readRecoveryRow', row.preparedRecovery);
      if (!preparedJournalValid(journal, row)) throw Object.assign(new Error(`prepared recovery row is stale for ${row.rowId}`), { code: 'LANG_RECOVERY_JOURNAL_NOT_READY' });
      if (journal.prior?.published === true) pathCounts.alreadyPublishedChanged += 1;
      else pathCounts.missingOrUnpublishedChanged += 1;
      const verified = { ...journal, outcome: 'verified', verifiedTargetDigest: row.replacementDigest, verifiedAt: now() };
      await rowCall(ROUTES.journalUpdate, 'updateRecoveryRow', verified);
      await core.appendNdjson(changesFile, durableChange(journal, row, verified.verifiedAt));
      receiptRows.push({ rowId: row.rowId, status: 'verified', writes: activeFieldOps, state: row.state, recoveryRowId: journal.id });
      continue;
    }
    if (row.decision === 'publish-only') {
      if (row.preparedRecovery) pathCounts.missingOrUnpublishedChanged += 1;
      else pathCounts.equalUnpublished += 1;
      let journal = null;
      if (row.preparedRecovery) {
        if (!journalReady) { await ensureRecoveryJournal({ adapter, proof, onRequest: count.record }); journalReady = true; }
        journal = await rowCall(ROUTES.journalRead, 'readRecoveryRow', row.preparedRecovery);
        if (!preparedJournalValid(journal, row)) throw Object.assign(new Error(`prepared recovery row is stale for ${row.rowId}`), { code: 'LANG_RECOVERY_JOURNAL_NOT_READY' });
      }
      await rowCall(ROUTES.contentUpdate, 'patchTranslationField', targetReference(row), { published: true });
      await record('publish', 'sent');
      const read = await rowCall(ROUTES.contentRead, 'readTranslationField', targetReference(row));
      if (!valueMatches(read, row.sourceValue, true)) throw Object.assign(new Error(`publication read-back failed for ${row.rowId}`), { code: 'LANG_PUBLIC_READBACK_MISMATCH' });
      assertUnchangedGuards(read, row);
      await record('publish', 'verified');
      if (journal) {
        const verified = { ...journal, outcome: 'verified', verifiedTargetDigest: row.replacementDigest, verifiedAt: now() };
        await rowCall(ROUTES.journalUpdate, 'updateRecoveryRow', verified);
        await core.appendNdjson(changesFile, durableChange(journal, row, verified.verifiedAt));
      }
      receiptRows.push({ rowId: row.rowId, status: 'verified', writes: activeFieldOps, state: row.state, ...(journal ? { recoveryRowId: journal.id } : {}) });
      continue;
    }
    if (!journalReady) {
      await ensureRecoveryJournal({ adapter, proof, onRequest: count.record });
      journalReady = true;
    }
    const alreadyPublished = row.target?.published === true;
    if (alreadyPublished) pathCounts.alreadyPublishedChanged += 1;
    else pathCounts.missingOrUnpublishedChanged += 1;
    let journal = {
      id: row.recovery,
      runId,
      rowId: row.rowId,
      sourceRowId: row.sourceRowId || null,
      locale: row.locale || row.identity?.locale || null,
      sourceObject: row.sourceObject || null,
      member: row.member || null,
      identity: row.identity,
      identityDigest: core.digest(row.identity),
      prior: row.target && Object.prototype.hasOwnProperty.call(row.target, 'value') ? { state: 'value', value: row.target.value, published: row.target.published === true } : { state: 'missing', published: false },
      priorDigest: row.priorDigest,
      replacementDigest: row.replacementDigest,
      sourceDigest: core.digest(row.sourceValue),
      decision: row.decision,
      operatorAction: durableOverwriteAction(row),
      outcome: 'prepared',
      preparedAt: now(),
      verifiedAt: null,
    };
    if (row.preparedRecovery) {
      journal = await rowCall(ROUTES.journalRead, 'readRecoveryRow', row.preparedRecovery);
      if (!preparedJournalValid(journal, row)) throw Object.assign(new Error(`prepared recovery row is stale for ${row.rowId}`), { code: 'LANG_RECOVERY_JOURNAL_NOT_READY' });
      await record('journal-resume', 'verified', { recoveryRowId: journal.id });
    } else {
      await rowCall(ROUTES.journalCreate, 'createRecoveryRow', journal);
      await record('journal-create', 'sent', { recoveryRowId: journal.id });
      const journalRead = await rowCall(ROUTES.journalRead, 'readRecoveryRow', journal.id);
      if (!journalPayloadMatches(journalRead, journal)) throw Object.assign(new Error(`recovery row read-back failed for ${row.rowId}`), { code: 'LANG_RECOVERY_JOURNAL_NOT_READY' });
      await record('journal-create', 'verified', { recoveryRowId: journal.id });
    }
    const initialPublished = alreadyPublished;
    const route = row.state === 'missing-record' ? ROUTES.contentCreate : ROUTES.contentUpdate;
    const method = row.state === 'missing-record' ? 'createTranslationField' : 'patchTranslationField';
    const created = await rowCall(route, method, targetReference(row), { value: row.sourceValue, published: initialPublished });
    if (!row.contentId && (created?.contentId || created?.id)) row.contentId = created.contentId || created.id;
    await record('value', 'sent', { recoveryRowId: journal.id, published: initialPublished });
    let read = await rowCall(ROUTES.contentRead, 'readTranslationField', targetReference(row));
    if (!valueMatches(read, row.sourceValue, initialPublished)) throw Object.assign(new Error(`value read-back failed for ${row.rowId}`), { code: 'LANG_PUBLIC_READBACK_MISMATCH' });
    assertUnchangedGuards(read, row);
    await record('value', 'verified', { recoveryRowId: journal.id, published: initialPublished });
    if (!alreadyPublished) {
      await rowCall(ROUTES.contentUpdate, 'patchTranslationField', targetReference(row), { published: true });
      await record('publish', 'sent', { recoveryRowId: journal.id });
      read = await rowCall(ROUTES.contentRead, 'readTranslationField', targetReference(row));
      if (!valueMatches(read, row.sourceValue, true)) throw Object.assign(new Error(`publication read-back failed for ${row.rowId}`), { code: 'LANG_PUBLIC_READBACK_MISMATCH' });
      assertUnchangedGuards(read, row);
      await record('publish', 'verified', { recoveryRowId: journal.id });
    }
    const verified = { ...journal, outcome: 'verified', verifiedTargetDigest: core.fieldStateDigest(row.sourceValue, true), verifiedAt: now() };
    await rowCall(ROUTES.journalUpdate, 'updateRecoveryRow', verified);
    await core.appendNdjson(changesFile, durableChange(journal, row, verified.verifiedAt));
    receiptRows.push({ rowId: row.rowId, status: 'verified', writes: activeFieldOps, state: row.state, recoveryRowId: journal.id });
    }
  } catch (error) {
    failure = error;
    const code = typeof error.code === 'string' ? error.code : 'LANG_TARGET_PLAN_BLOCKED';
    receiptRows.push({
      rowId: activeRow?.rowId || 'executor',
      status: 'attention-required',
      writes: activeFieldOps,
      state: activeRow?.state || 'failed',
      reasonCode: code,
      route: error.route || activeRoute || null,
    });
  } finally {
    for (const [route, retries] of Object.entries(adapter.metrics?.retryRequestsByRoute || {})) {
      count.requestsByRoute[route] = (count.requestsByRoute[route] || 0) + retries;
    }
    const routeTotal = Object.values(count.requestsByRoute).reduce((sum, value) => sum + value, 0);
    cost = {
    schemaVersion: 1,
    requestsByRoute: count.requestsByRoute,
    requestCount: routeTotal,
    batchSizes: adapter.metrics?.batchSizes || {},
    pathCounts,
    throttlingResponses: adapter.metrics?.throttlingResponses || 0,
    retries: adapter.metrics?.retries || 0,
    wallTimeMs: Date.now() - started,
    };
    receipt = {
    schemaVersion: 1,
    runId,
    planDigest: core.digest(plan),
    rows: receiptRows,
    zeroWriteRerun: !failure && receiptRows.every((row) => row.writes === 0),
    completedAt: now(),
    ...(failure ? { failure: { rowId: activeRow?.rowId || null, code: failure.code || 'LANG_TARGET_PLAN_BLOCKED', route: failure.route || activeRoute || null } } : {}),
    };
    await core.writeJsonAtomic(path.join(projectDir, 'state/multilingual-public/receipt.json'), receipt);
    await core.writeJsonAtomic(path.join(projectDir, 'state/multilingual-public/cost.json'), cost);
  }
  if (failure) throw failure;
  return { receipt, cost };
}

async function restore({ projectDir, adapter, proof, recoveryRowId, now = () => new Date().toISOString() }) {
  requireRouteProof(proof, ROUTES.journalRead);
  requireRouteProof(proof, ROUTES.contentRead);
  const journal = await adapter.readRecoveryRow(recoveryRowId);
  const refusal = async (reason) => {
    const row = { recoveryRowId, status: 'refused', reason, recordedAt: now() };
    await core.appendNdjson(path.join(projectDir, 'state/multilingual-public/restores.ndjson'), row);
    return row;
  };
  if (!journal || journal.outcome !== 'verified') return refusal('journal-row-not-verified');
  const live = await adapter.readTranslationField(journal.identity);
  if (core.fieldStateDigest(live?.value, live?.published) !== journal.replacementDigest) return refusal('live-replacement-digest-mismatch');
  if (journal.prior?.state === 'missing') return refusal('prior-state-missing-requires-owner-decision');
  requireRouteProof(proof, ROUTES.contentUpdate);
  requireRouteProof(proof, ROUTES.contentRead);
  await adapter.patchTranslationField(journal.identity, { value: journal.prior.value, published: journal.prior.published === true });
  const read = await adapter.readTranslationField(journal.identity);
  if (!valueMatches(read, journal.prior.value, journal.prior.published === true)) return refusal('restore-readback-mismatch');
  const row = { recoveryRowId, status: 'restored', priorDigest: journal.priorDigest, recordedAt: now() };
  await core.appendNdjson(path.join(projectDir, 'state/multilingual-public/restores.ndjson'), row);
  return row;
}

module.exports = {
  ROUTES,
  ensureRecoveryJournal,
  executePlan,
  executeSetup,
  matchingDecision,
  requireRouteProof,
  restore,
  setupProposal,
};
