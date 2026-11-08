'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const { hashArtifact } = require('./artifact-freshness.js');
const { isValidSiteTypeEffect, isValidEditorWebsiteEffect } = require('./destination-choice.js');

const SCHEMA_VERSION = 1;
const KINDS = new Set(['question', 'review', 'approval', 'manual_action']);
const RESPONSE_MODES = new Set(['choice', 'text', 'none']);

function userActionsDir(projectDir) {
  return path.join(projectDir, 'orchestration', 'user-actions');
}

function requestPath(projectDir, requestId) {
  return path.join(userActionsDir(projectDir), `${requestId}.json`);
}

function newRequestId() {
  return `uar_${crypto.randomUUID()}`;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function assertSafeText(value, label, { max = 4000, required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty text`);
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`);
  if (/\x00/.test(value)) throw new Error(`${label} contains a null byte`);
  return value;
}

function normalizeArtifact(projectDir, ref) {
  if (!ref || typeof ref !== 'object') throw new Error('artifactRef must be an object');
  const relativePath = assertSafeText(ref.path, 'artifactRef.path', { max: 512 });
  const resolved = path.resolve(projectDir, relativePath);
  const root = `${path.resolve(projectDir)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('artifactRef.path must remain inside project');
  if (relativePath.split(/[\\/]/).includes('..')) throw new Error('artifactRef.path must not traverse parent directories');
  if (ref.kind !== undefined && ref.kind !== 'census-reconciliation') throw new Error('artifactRef.kind is unsupported');
  if (ref.kind === 'census-reconciliation' && !/^[0-9a-f]{64}$/i.test(ref.sha256 || '')) throw new Error('census reconciliation artifact requires sha256');
  return {
    ...(ref.kind ? { kind: ref.kind } : {}),
    path: relativePath.replaceAll('\\', '/'),
    mediaType: assertSafeText(ref.mediaType || 'text/plain', 'artifactRef.mediaType', { max: 100 }),
    ...(ref.sha256 ? { sha256: assertSafeText(ref.sha256, 'artifactRef.sha256', { max: 128 }) } : {}),
  };
}

// Optional machine-readable context a deterministic producer attaches so it can find its own
// request again (for example, the destination recovery request records the metasite ID and
// the observation it was raised for). Plain JSON only; never credentials.
function normalizeSubject(subject) {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) throw new Error('subject must be an object');
  const text = JSON.stringify(subject);
  if (text.length > 4000) throw new Error('subject exceeds 4000 characters');
  assertSafeText(subject.type, 'subject.type', { max: 100 });
  return JSON.parse(text);
}

function normalizeRequest(projectDir, input = {}) {
  const kind = input.kind;
  if (!KINDS.has(kind)) throw new Error(`invalid user action kind: ${kind}`);
  const response = input.response || {};
  const mode = response.mode || 'choice';
  if (!RESPONSE_MODES.has(mode)) throw new Error(`invalid response mode: ${mode}`);
  const choices = Array.isArray(input.choices) ? input.choices.map((choice) => ({
    id: assertSafeText(choice && choice.id, 'choice.id', { max: 100 }),
    label: assertSafeText(choice && choice.label, 'choice.label', { max: 200 }),
    ...(choice.description ? { description: assertSafeText(choice.description, 'choice.description', { max: 500 }) } : {}),
  })) : [];
  if (mode === 'choice' && choices.length === 0) throw new Error('choice response requires choices');
  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) throw new Error('choice ids must be unique');
  if (mode !== 'choice' && choices.length) throw new Error('only choice responses may declare choices');
  const artifactRefs = Array.isArray(input.artifactRefs) ? input.artifactRefs.map((ref) => normalizeArtifact(projectDir, ref)) : [];
  const requestId = input.requestId || newRequestId();
  if (!/^uar_[0-9a-f-]+$/.test(requestId)) throw new Error('invalid request id');
  if (input.effect) {
    const isApproval = input.effect.kind === 'approval' && ['mapping', 'execution'].includes(input.effect.approvalType);
    const isImportModeDecision = input.effect.kind === 'decision'
      && input.effect.key === 'managementImportMode'
      && input.effect.choices
      && typeof input.effect.choices === 'object'
      && !Array.isArray(input.effect.choices)
      && Object.keys(input.effect.choices).length > 0
      && Object.entries(input.effect.choices).every(([choice, value]) => choices.some((item) => item.id === choice) && ['standard', 'quick'].includes(value));
    const isReadBackAck = input.effect.kind === 'read-back-omission-ack' && kind === 'manual_action' && mode === 'none'
      && ['order', 'member', 'contact', 'product'].includes(input.effect.entity) && typeof input.effect.runId === 'string'
      && /^[a-f0-9]{64}$/.test(input.effect.omissionSetDigest);
    // The combined site-type choice and the Editor website scope guard.
    const isSiteTypeDecision = isValidSiteTypeEffect(input.effect, choices);
    const isEditorWebsiteDecision = isValidEditorWebsiteEffect(input.effect, choices);
    // One durable question when an existing site holding orders or real products would have its settings changed.
    const isSiteRegionalAnswer = input.effect.kind === 'site-locale-answer' && kind === 'question' && mode === 'choice'
      && typeof input.effect.siteId === 'string' && input.effect.siteId && /^[0-9a-f]{64}$/.test(input.effect.changesDigest || '')
      && choices.length === 2 && choices.every((item) => ['change', 'keep'].includes(item.id));
    const isNotificationMuteDecision = kind === 'question' && mode === 'choice' && require('./notification-mute.js').isValidNotificationMuteEffect(input.effect, choices);
    if (!isApproval && !isImportModeDecision && !isSiteTypeDecision && !isEditorWebsiteDecision && !isReadBackAck && !isSiteRegionalAnswer && !isNotificationMuteDecision) throw new Error('unsupported user-action effect');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId,
    status: 'pending',
    kind,
    stage: assertSafeText(input.stage, 'stage', { max: 100 }),
    title: assertSafeText(input.title, 'title', { max: 200 }),
    prompt: assertSafeText(input.prompt, 'prompt', { max: 4000 }),
    response: { mode, required: response.required !== false },
    choices,
    artifactRefs,
    ...(input.effect ? { effect: input.effect } : {}),
    ...(input.subject ? { subject: normalizeSubject(input.subject) } : {}),
    createdAt: new Date().toISOString(),
    answer: null,
  };
}

async function rebuildIndex(projectDir) {
  const dir = userActionsDir(projectDir);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'index.json') continue;
    const value = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8'));
    try {
      if (!value || value.schemaVersion !== SCHEMA_VERSION || `${value.requestId}.json` !== entry.name
        || !['pending', 'answered', 'superseded'].includes(value.status) || typeof value.createdAt !== 'string') throw new Error();
      normalizeRequest(projectDir, value);
    } catch {
      throw new Error('invalid durable user-action artifact');
    }
    rows.push({ requestId: value.requestId, status: value.status, kind: value.kind, title: value.title, createdAt: value.createdAt, answeredAt: value.answer?.answeredAt || null });
  }
  rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await writeJsonAtomic(path.join(dir, 'index.json'), { schemaVersion: SCHEMA_VERSION, actions: rows });
  return rows;
}

async function createUserAction(projectDir, input) {
  const request = normalizeRequest(projectDir, input);
  await fs.mkdir(userActionsDir(projectDir), { recursive: true });
  const filePath = requestPath(projectDir, request.requestId);
  try {
    await fs.access(filePath);
    throw new Error(`user action already exists: ${request.requestId}`);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  await writeJsonAtomic(filePath, request);
  await rebuildIndex(projectDir);
  return request;
}

// A request whose subject no longer matches the world (another site, other values, another policy)
// is closed rather than answered; the person never sees a question about something that changed.
async function supersedeUserAction(projectDir, requestId, { replacementId } = {}) {
  const request = await readUserAction(projectDir, requestId);
  if (request.status !== 'pending') return request;
  request.status = 'superseded';
  request.supersededAt = new Date().toISOString();
  if (replacementId) request.supersededBy = replacementId;
  await writeJsonAtomic(requestPath(projectDir, requestId), request);
  await rebuildIndex(projectDir);
  return request;
}

async function readUserAction(projectDir, requestId) {
  if (!/^uar_[0-9a-f-]+$/.test(requestId)) throw new Error('invalid request id');
  return JSON.parse(await fs.readFile(requestPath(projectDir, requestId), 'utf8'));
}

async function listUserActions(projectDir, { status = null } = {}) {
  const rows = await rebuildIndex(projectDir);
  return status ? rows.filter((row) => row.status === status) : rows;
}

// Cutover actions remain open for the Cutover Operator, but they are not a reason to
// interrupt import routing. Keep this predicate shared by every pending-action consumer so
// the router, supervisor, and status surface agree while `listUserActions` still exposes them.
function isCutoverUserAction(request) {
  return request?.stage === 'cutover' || request?.kind === 'cutover';
}

// Read the same blocking set for every consumer that can stop import progress. The public
// list remains unfiltered so cutover work stays visible and answerable.
async function listPendingBlockingUserActions(projectDir) {
  const rows = await listUserActions(projectDir, { status: 'pending' });
  const requests = [];
  for (const row of rows) {
    const request = await readUserAction(projectDir, row.requestId);
    if (!isCutoverUserAction(request)) requests.push(request);
  }
  return requests;
}

// Shared by interactive routing and the CLI supervisor. Do not turn an unreadable
// request/index into permission to proceed, and never ask for an answer we will reject.
async function pendingUserActionGate(projectDir) {
  try {
    const requests = await listPendingBlockingUserActions(projectDir);
    if (!requests.length) return null;
    const stale = [];
    for (const request of requests) {
      if (staleArtifactRefs(projectDir, request).length) stale.push(request.requestId);
    }
    if (stale.length) return { route: {
      ok: true, nextState: 'user_action_recovery_running', reason: 'user_action_stale',
      nextResource: 'resources/rp-user-action-recovery/', requestIds: stale,
    } };
    return { request: requests[0], route: {
      ok: true, nextState: 'awaiting_user_action', nextResource: null,
      reason: 'pending_user_action', blocking: true, requestIds: requests.map((request) => request.requestId),
    } };
  } catch {
    // JSON parse errors can include artifact content. Expose a stable code, never that text.
    return { route: {
      ok: true, nextState: 'blocked', nextResource: null, blocking: true,
      reason: 'user_action_artifacts_unreadable',
      errors: ['Repair unreadable orchestration/user-actions artifacts before resuming; preserve pending requests.'],
    } };
  }
}

// Recovery must leave a fresh human checkpoint in place, never silently grant approval.
async function supersedeStaleUserAction(projectDir, requestId, replacementId) {
  const request = await readUserAction(projectDir, requestId);
  const replacement = await readUserAction(projectDir, replacementId);
  if (request.status === 'superseded' && request.supersededBy === replacementId) return request;
  if (request.effect?.kind === 'read-back-omission-ack') throw new Error('Use recover-omission-ack so the producer can rebind acknowledgement evidence');
  if (requestId === replacementId || request.status !== 'pending' || !staleArtifactRefs(projectDir, request).length) {
    throw new Error('supersede requires a stale pending request and a different replacement');
  }
  const scope = (effect) => {
    if (!effect) return null;
    const { changesDigest, omissionSetDigest, ...identity } = effect;
    return identity;
  };
  if (replacement.status !== 'pending' || staleArtifactRefs(projectDir, replacement).length
    || replacement.kind !== request.kind || replacement.stage !== request.stage
    || !isDeepStrictEqual(scope(replacement.effect), scope(request.effect))
    || !isDeepStrictEqual(replacement.subject || null, request.subject || null)
    || request.artifactRefs.some((ref) => ref.sha256 && !replacement.artifactRefs.some((next) => next.path === ref.path && next.kind === ref.kind && next.sha256))) {
    throw new Error('replacement must be a fresh pending request for the same stage, effect and pinned artifacts');
  }
  return supersedeUserAction(projectDir, requestId, { replacementId });
}

// A ref recorded with `sha256` pins the artifact the person reviewed. Answering
// after that artifact changed (or disappeared) would approve something nobody looked at, so
// the answer is refused and the request stays pending. Refs without `sha256` are unchecked.
// Accepts a bare hex digest or a `sha256:`-prefixed one.
function staleArtifactRefs(projectDir, request) {
  const stale = [];
  for (const ref of Array.isArray(request.artifactRefs) ? request.artifactRefs : []) {
    if (!ref || !ref.sha256) continue;
    const expected = String(ref.sha256).trim().toLowerCase().replace(/^sha256:/, '');
    let actual = null;
    try {
      actual = hashArtifact(projectDir, ref.path);
    } catch {
      actual = null;
    }
    if (actual !== expected) stale.push({ path: ref.path, expected, actual });
  }
  return stale;
}

class UserActionStaleError extends Error {
  constructor(requestId, stale) {
    super(`user_action_stale: ${stale.map((entry) => entry.path).join(', ')} changed since request ${requestId} was created; the answer was not recorded. Regenerate the request from the current artifacts and ask again.`);
    this.code = 'user_action_stale';
    this.requestId = requestId;
    this.staleArtifacts = stale;
  }
}

async function answerUserAction(projectDir, requestId, answer, { applyEffect } = {}) {
  const request = await readUserAction(projectDir, requestId);
  const mode = request.response?.mode;
  let normalized;
  if (answer.choice !== undefined) {
    if (mode !== 'choice') throw new Error('this request does not accept a choice');
    if (!request.choices.some((choice) => choice.id === answer.choice)) throw new Error('choice is not allowed for this request');
    const note = assertSafeText(answer.note, 'answer note', { max: 10000, required: false });
    normalized = { choice: answer.choice, ...(note ? { note } : {}) };
  } else if (answer.text !== undefined) {
    if (mode !== 'text') throw new Error('this request does not accept text');
    normalized = { text: assertSafeText(answer.text, 'answer text', { max: 10000 }) };
  } else if (answer.acknowledged === true) {
    if (mode !== 'none' || request.kind !== 'manual_action') throw new Error('only a manual action with response mode none accepts acknowledgement');
    const note = assertSafeText(answer.note, 'acknowledgement note', { max: 10000, required: false });
    normalized = { acknowledged: true, ...(note ? { note } : {}) };
  } else {
    throw new Error('answer requires choice, text, or acknowledgement');
  }
  if (request.status === 'answered') {
    const existing = request.answer && (request.answer.choice ? { choice: request.answer.choice, ...(request.answer.note ? { note: request.answer.note } : {}) } : request.answer.text ? { text: request.answer.text } : { acknowledged: request.answer.acknowledged === true, ...(request.answer.note ? { note: request.answer.note } : {}) });
    if (JSON.stringify(existing) === JSON.stringify(normalized)) {
      if (request.effect?.kind === 'read-back-omission-ack' && typeof applyEffect === 'function') await applyEffect(request, normalized);
      return request;
    }
    throw new Error('user action already has a different answer');
  }
  if (request.status !== 'pending') throw new Error(`user action is not pending: ${request.status}`);
  const stale = staleArtifactRefs(projectDir, request);
  const mappingApproval = request.effect?.kind === 'approval' && request.effect.approvalType === 'mapping';
  const rejectingMapping = mappingApproval && ['declined', 'reject'].includes(normalized.choice);
  // The mapping binder owns census-reference refusal ordering (missing, stale inputs,
  // then stale request). Other pinned artifacts retain the generic freshness gate.
  const unboundStale = mappingApproval && typeof applyEffect === 'function'
    ? stale.filter(entry => !request.artifactRefs.some(ref => ref.kind === 'census-reconciliation' && ref.path === entry.path))
    : stale;
  if (!rejectingMapping && unboundStale.length) throw new UserActionStaleError(requestId, unboundStale);
  if (request.effect && typeof applyEffect === 'function') await applyEffect(request, normalized);
  request.status = 'answered';
  request.answer = { ...normalized, answeredAt: new Date().toISOString() };
  await writeJsonAtomic(requestPath(projectDir, requestId), request);
  await rebuildIndex(projectDir);
  return request;
}

// Every public approval dispatcher uses this disk-bound reference builder.
async function approvalArtifactRefs(projectDir, { approvalType, status, decidedBy, artifactRefs = [], requireRequestRef = false }) {
  const requestRef = artifactRefs.find(ref => ref && typeof ref === 'object' && ref.kind === 'census-reconciliation') || null;
  const { bindCensusReconciliation } = require('./census-reconciliation.js');
  const bound = await bindCensusReconciliation(projectDir, { approvalType, status, decidedBy, requestRef: requireRequestRef ? requestRef : null });
  if (!bound.ok) throw Object.assign(new Error(bound.code), bound);
  if (bound.ref && requireRequestRef && !requestRef) throw Object.assign(new Error('approval_missing_census_reference'), { code: 'approval_missing_census_reference' });
  const refs = artifactRefs.filter(ref => !ref || typeof ref !== 'object' || ref.kind !== 'census-reconciliation').map(ref => typeof ref === 'object' ? ref.path : ref);
  return bound.ref ? [...refs, bound.ref] : refs;
}

module.exports = {
  approvalArtifactRefs,
  normalizeArtifact,
  SCHEMA_VERSION,
  userActionsDir,
  requestPath,
  createUserAction,
  readUserAction,
  supersedeUserAction,
  listUserActions,
  listPendingBlockingUserActions,
  pendingUserActionGate,
  supersedeStaleUserAction,
  answerUserAction,
  rebuildIndex,
  isCutoverUserAction,
  staleArtifactRefs,
  UserActionStaleError,
};
