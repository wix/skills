'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

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
    if (!isApproval && !isImportModeDecision && !isSiteTypeDecision && !isEditorWebsiteDecision && !isReadBackAck) throw new Error('unsupported user-action effect');
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

async function readUserAction(projectDir, requestId) {
  if (!/^uar_[0-9a-f-]+$/.test(requestId)) throw new Error('invalid request id');
  return JSON.parse(await fs.readFile(requestPath(projectDir, requestId), 'utf8'));
}

async function listUserActions(projectDir, { status = null } = {}) {
  const rows = await rebuildIndex(projectDir);
  return status ? rows.filter((row) => row.status === status) : rows;
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
  listUserActions,
  answerUserAction,
  rebuildIndex,
  staleArtifactRefs,
  UserActionStaleError,
};
