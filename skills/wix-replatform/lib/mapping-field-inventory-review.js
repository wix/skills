'use strict';

// A field-inventory review is a mapper input, not a free-standing conversation.
// Keep the answer beside the mapping authority so a later one-click pass can consume
// it without asking the same question again.
const fs = require('node:fs/promises');
const path = require('node:path');

const REVIEW_SUBJECT = 'mapping_field_inventory_review';
const ANSWER_LEDGER = 'mapping/review/field-inventory-answers.json';

function answerRef(requestId) {
  return `orchestration/user-actions/${requestId}.json`;
}

function isFieldInventoryReview(request) {
  return request?.subject?.type === REVIEW_SUBJECT
    || request?.effect?.kind === 'mapping-field-inventory-review';
}

function reviewBinding(request) {
  const subject = request?.subject || {};
  const scope = subject.scope || subject.executionScope || null;
  const entityRefs = Array.isArray(subject.entityRefs)
    ? subject.entityRefs
    : typeof subject.entityRef === 'string'
      ? [subject.entityRef]
      : Array.isArray(scope?.selectedEntityRefs) ? scope.selectedEntityRefs : [];
  const mappingPlanDigest = subject.mappingPlanDigest || subject.planDigest || null;
  const gapLedgerDigest = subject.gapLedgerDigest || subject.ledgerDigest || null;
  if (!entityRefs.length || !scope || typeof mappingPlanDigest !== 'string' || typeof gapLedgerDigest !== 'string') return null;
  return {
    entityRefs: [...new Set(entityRefs)].sort(),
    scope,
    mappingPlanDigest,
    gapLedgerDigest,
  };
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

function sameReview(request, answered) {
  if (!isFieldInventoryReview(request) || !isFieldInventoryReview(answered)) return false;
  if (request.subject?.type !== answered.subject?.type) return false;
  if (request.subject?.blockerCode !== answered.subject?.blockerCode) return false;
  const paths = (value) => (value.artifactRefs || []).map(ref => ref.path).sort();
  if (JSON.stringify(paths(request)) !== JSON.stringify(paths(answered))) return false;
  const requestBinding = reviewBinding(request);
  const answeredBinding = reviewBinding(answered);
  return Boolean(requestBinding && answeredBinding
    && require('./mapping-field-contract.js').canonical(requestBinding)
      === require('./mapping-field-contract.js').canonical(answeredBinding));
}

async function applyFieldInventoryReviewAnswerUnlocked(projectDir, request, answer) {
  if (!isFieldInventoryReview(request)) return false;
  if (typeof answer?.text !== 'string' || !answer.text.trim()) throw new Error('field inventory review requires text');

  const fields = require('./mapping-field-contract.js');
  const planFile = path.join(projectDir, 'mapping/mapping-plan.json');
  const plan = await readJson(planFile, null);
  if (!plan || plan.fieldContractVersion !== 1) throw new Error('mapping plan is unavailable for field inventory review');
  const binding = reviewBinding(request);
  if (!binding) throw new Error('field inventory review binding is missing entity scope and mapping fingerprints');
  const rows = fields.entityRows(plan);
  const pendingRefs = new Set((plan.executionScope?.deferredEntities || []).map(row => row.entityRef));
  const boundRows = rows.filter(row => binding.entityRefs.includes(fields.entityRef(row)));
  const scopedRows = pendingRefs.size
    ? boundRows.filter(row => pendingRefs.has(fields.entityRef(row)))
    : boundRows;
  if (!scopedRows.length) throw new Error('field inventory review binding names no current mapping entities');

  // Replaying an already-applied answer is a no-op. The answer changed the plan
  // digest when it was first persisted, so requiring the pre-answer digest again
  // would make ordinary resume/sync paths reject their own durable answer.
  const alreadyApplied = scopedRows.every(row => row.fieldInventoryReview?.requestId === request.requestId
    && fields.canonical(row.fieldInventoryReview.binding) === fields.canonical(binding));
  if (alreadyApplied) return true;

  const ledgerFile = path.join(projectDir, 'mapping/review/mapping-gaps.json');
  const ledger = await readJson(ledgerFile, []);
  if (fields.digest(plan) !== binding.mappingPlanDigest) {
    throw new Error('field inventory review binding has a stale mapping plan digest');
  }
  if (fields.canonical(plan.executionScope) !== fields.canonical(binding.scope)) {
    throw new Error('field inventory review binding has a stale execution scope');
  }
  if (fields.mappingGapLedgerDigest(ledger, plan) !== binding.gapLedgerDigest) {
    throw new Error('field inventory review binding has a stale gap ledger digest');
  }

  const now = new Date().toISOString();
  const review = {
    status: 'received',
    requestId: request.requestId,
    answerRef: answerRef(request.requestId),
    answeredAt: request.answer?.answeredAt || now,
    responseText: answer.text,
    artifactRefs: (request.artifactRefs || []).map(ref => ref.path),
    binding,
  };
  for (const row of scopedRows) {
    row.fieldInventoryReview = { ...review };
  }
  await writeJsonAtomic(planFile, plan);

  // Entity projections are a durable, read-friendly copy of the same mapper input.
  const { entityFileName, entityRef } = require('./mapping-field-contract.js');
  for (const row of scopedRows) {
    const file = path.join(projectDir, 'mapping/entity-decisions', entityFileName(row));
    const projection = await readJson(file, null);
    if (projection) await writeJsonAtomic(file, { ...projection, fieldInventoryReview: { ...review } });
  }

  const answerLedgerFile = path.join(projectDir, ANSWER_LEDGER);
  const answerLedger = await readJson(answerLedgerFile, { schemaVersion: 1, answers: [] });
  if (!Array.isArray(answerLedger.answers)) answerLedger.answers = [];
  const existing = answerLedger.answers.find(entry => entry.requestId === request.requestId);
  if (!existing) {
    answerLedger.answers.push({
      requestId: request.requestId,
      answeredAt: review.answeredAt,
      answerRef: review.answerRef,
      responseText: answer.text,
      subject: request.subject || { type: REVIEW_SUBJECT },
      artifactRefs: review.artifactRefs,
      binding,
      entities: scopedRows.map(entityRef).filter(Boolean).sort(),
    });
    await writeJsonAtomic(answerLedgerFile, answerLedger);
  }
  return true;
}

async function applyFieldInventoryReviewAnswer(projectDir, request, answer) {
  // Bind the current authority and retained gap ledger in one existing project
  // state lock, then perform no write until both fingerprints and scope match.
  return require('./read-back-state.js').locked(projectDir, () =>
    applyFieldInventoryReviewAnswerUnlocked(projectDir, request, answer));
}

async function syncAnsweredFieldInventoryReviews(projectDir) {
  const actionsDir = path.join(projectDir, 'orchestration/user-actions');
  let names;
  try { names = await fs.readdir(actionsDir); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const requests = [];
  for (const name of names.filter(entry => entry.endsWith('.json') && entry !== 'index.json')) {
    const request = await readJson(path.join(actionsDir, name));
    if (request?.status === 'answered' && isFieldInventoryReview(request) && request.answer?.text) {
      await applyFieldInventoryReviewAnswer(projectDir, request, request.answer);
      requests.push(request);
    }
  }
  if (!requests.length) return [];
  const { requestPath, rebuildIndex } = require('./user-actions.js');
  const answered = requests.sort((a, b) => (a.answer?.answeredAt || '').localeCompare(b.answer?.answeredAt || '')).at(-1);
  for (const name of names.filter(entry => entry.endsWith('.json') && entry !== 'index.json')) {
    const request = await readJson(path.join(actionsDir, name));
    if (request?.status === 'pending' && sameReview(request, answered)) {
      request.status = 'superseded';
      request.supersededAt = new Date().toISOString();
      request.supersededBy = answered.requestId;
      await writeJsonAtomic(requestPath(projectDir, request.requestId), request);
    }
  }
  await rebuildIndex(projectDir);
  return requests.map(request => request.requestId);
}

module.exports = {
  REVIEW_SUBJECT,
  ANSWER_LEDGER,
  answerRef,
  isFieldInventoryReview,
  applyFieldInventoryReviewAnswer,
  syncAnsweredFieldInventoryReviews,
};
