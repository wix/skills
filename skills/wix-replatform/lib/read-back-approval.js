'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const state = require('./read-back-state');
const contract = require('./read-back-contract');
const { hashArtifact } = require('./artifact-freshness');
const {
  requireOperatorIdentity
} = require('./operator-identity');
const {
  loadArtifacts,
  updateApprovalObject
} = require('./orchestration-state');
// The read-back units of this project: one per plan row that writes a gated Wix entity
// (lib/mapping-field-contract.js readBackKeys), with its decision projection. Exact plans gate
// every resolved unit the toolkit builds (or the mapper checked); the domain contract is the
// checked-in one whether or not the mapper copied it (read-back-contract validate). A deferred or excluded unit is a cutover gap, not a gate input:
// its inventory is intentionally absent. Legacy plans gate the target-named decisions that carry a
// copied contract. `copiedOnly` keeps only units whose decision carries the copied contract: the
// ones the mapper checked before approval, which the mapping approval binds.
const toolkitBuilt = row => Object.hasOwn(require('./import-task-runner').COMPOSITES, row?.targetRef);
async function gatedEntities(projectDir, { copiedOnly = false } = {}) {
  let files;
  try {
    files = await fs.readdir(path.join(projectDir, 'mapping/entity-decisions'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
  const exact = plan.fieldContractVersion === 1 ? require('./mapping-field-contract') : null;
  const resolved = exact && new Set(plan.executionScope?.resolvedEntityRefs || []);
  const result = [];
  const candidates = exact
    ? Object.keys(contract.DOMAINS).flatMap(entity => exact.readBackKeys(plan, entity).map(key => ({ key, row: exact.readBackRow(plan, key) })))
      .map(({ key, row }) => ({ key, row, name: contract.decisionFileName(projectDir, key) }))
    : files.filter(name => name.endsWith('.json') && Object.hasOwn(contract.DOMAINS, name.slice(0, -5)))
      .map(name => ({ key: name.slice(0, -5), name }));
  // A unit the run settled after its pass limit (lib/route-settlement.js) is not gated: the import
  // writes it without the read-back gate, and its leftover is a toolkit gap or cutover task.
  const settled = require('./route-settlement').settledReadBackUnits(projectDir);
  for (const { key, row, name } of candidates) if (files.includes(name) && !settled.has(key)) {
    if (exact && !resolved.has(exact.entityRef(row))) continue;
    const d = await state.readJson(projectDir, `mapping/entity-decisions/${name}`);
    // Without a copied contract, a row is gated where the toolkit has its builder: a target the
    // fixed loop writes (products, contacts, orders). Members keep the mapper-run check.
    if (d.readBackContract || exact && !copiedOnly && toolkitBuilt(row)) result.push(key);
  }
  return result.sort();
}
async function applyApproval(projectDir, request, answer, {
  identity = requireOperatorIdentity
} = {}) {
  const type = request.effect?.approvalType;
  const status = require('./approval-choices.js').approvalStatus(answer.choice);
  if (!['mapping', 'execution'].includes(type) || !status) throw new Error('Unsupported approval choice/type');
  return state.locked(projectDir, async () => {
    const artifacts = await loadArtifacts(projectDir);
    const exact=require('./mapping-omission-approval');
    const plan=type==='mapping' ? await state.readJson(projectDir,'mapping/mapping-plan.json',{}) : {};
    // The units the mapper checked before approval (copied contract); the toolkit checks the rest
    // at codegen, where their builders exist (read-back-validate ensureReadBack).
    const entities = type === 'mapping' ? await gatedEntities(projectDir, { copiedOnly: true }) : [];
    const omissionRows=plan.fieldContractVersion===1 ? exact.candidates(plan) : [];
    let hasOmissions=omissionRows.length>0;
    if (status==='approved' && omissionRows.length && !require('./mapping-field-contract').compareMappingProjections(projectDir,plan).ok) throw new Error('omission projections must match canonical authority');
    const bindingDigests = {};
    if (status === 'approved') for (const entity of entities) {
      Object.assign(bindingDigests, contract.bindings(projectDir, entity));
      const decision = await state.readJson(projectDir, `mapping/entity-decisions/${contract.decisionFileName(projectDir, entity)}`);
      const omissions = (decision.fieldDispositions || []).filter(d => d.status === 'notMigrated');
      const canonicalRow=plan.fieldContractVersion===1 ? require('./mapping-field-contract').readBackRow(plan,entity) : null;
      hasOmissions ||= canonicalRow ? exact.omissions(canonicalRow).length>0 : omissions.length>0;
      const gate = await state.load(projectDir);
      const history = [...gate.observedLosses, ...Object.values(gate.runs).flatMap(r => Object.values(r.entities || {}).flatMap(e => [...(e.attemptedPaths || []), ...(e.settlements || []).filter(x => x.status !== 'passed')]))];
      for (const d of omissions) if (history.some(h => (!h.entity || h.entity === entity) && [...(h.sourcePaths || []), h.writePath, h.intendedTargetPath].includes(d.path || d.sourcePath || d.targetPath))) throw new Error('Attempted or observed loss cannot become approved omission');
    }
    if (status==='approved' && hasOmissions && exact.mode(artifacts.decisions)==='one_click') throw new Error('one-click approvals cannot authorize field omissions');
    if (status==='approved') for (const row of omissionRows) {exact.validateEvidence(projectDir,row);Object.assign(bindingDigests,exact.bindings(projectDir,row));}
    for (const [p, h] of Object.entries(bindingDigests)) if (!request.artifactRefs?.some(r => r.path === p && String(r.sha256).replace(/^sha256:/, '') === h)) throw new Error(`Missing or stale read-back approval reference: ${p}`);
    const artifactRefs = await require('./user-actions').approvalArtifactRefs(projectDir, { approvalType: type, status, decidedBy: 'user', artifactRefs: request.artifactRefs, requireRequestRef: true });
    // Freshness is checked again under the state lock, not just by the caller's earlier check.
    if (!(type === 'mapping' && status === 'rejected') && require('./user-actions').staleArtifactRefs(projectDir, request).length) throw new Error('user_action_stale: approval inputs changed');
    const approvedBy = status === 'approved' && (entities.length || omissionRows.length) ? identity() : null;
    updateApprovalObject(artifacts.approvals, type, status, {
      artifactRefs,
      notes: request.title,
      decidedBy: 'user'
    });
    if (approvedBy) Object.assign(artifacts.approvals[type], {
      approvedBy,
      requestId: request.requestId,
      bindingDigests
    });
    if (status==='approved' && hasOmissions) {
      if (!require('./operator-identity').GUID.test(approvedBy?.userId || '') || !approvedBy.displayName?.trim()) throw new Error('identified operator required for omission approval');
      const omissionApprovalContext=omissionRows.length ? exact.context(projectDir) : {automationMode:'interactive'};
      const fieldDispositionDigests=exact.dispositionDigests(plan);
      Object.assign(artifacts.approvals[type],{omissionApprovalContext,fieldDispositionDigests});
      // answerUserAction writes this same request after the effect. Persist context here
      // too; execution still requires the final answered record, including after a crash.
      Object.assign(request,{omissionApprovalContext,fieldDispositionDigests});
      await state.atomic(projectDir,path.relative(projectDir,require('./user-actions').requestPath(projectDir,request.requestId)),request);
    }
    await state.atomic(projectDir, 'orchestration/approvals.json', artifacts.approvals);
    return artifacts.approvals[type];
  });
}
function omissionDigest(omissions) {
  return contract.digest(omissions.map(({
    path,
    kind,
    recordCount,
    approvedBy
  }) => ({
    path,
    kind,
    recordCount,
    approvedBy
  })));
}
async function acknowledge(projectDir, request, answer, {
  identity = requireOperatorIdentity
} = {}) {
  if (request.effect?.kind !== 'read-back-omission-ack' || request.kind !== 'manual_action' || request.response?.mode !== 'none' || answer.acknowledged !== true) throw new Error('Invalid omission acknowledgement');
  const {
    runId,
    entity,
    omissionSetDigest
  } = request.effect;
  contract.entityKey(entity);
  return state.update(projectDir, async gate => {
    const omissions = gate.runs[runId]?.entities?.[entity]?.approvedOmissions;
    if (!omissions || omissionDigest(omissions) !== omissionSetDigest || omissions.some(o => o.merchantAcknowledgement?.requestId !== request.requestId)) throw new Error('Omission acknowledgement binding changed');
    const pending = omissions.filter(o => o.merchantAcknowledgement.status !== 'acknowledged');
    if (!pending.length) return;
    // The listed evidence must still be exactly the gate's omission set, affected records included.
    const evidenceRef = (request.artifactRefs || []).find(r => r?.path === evidencePath(entity, request.requestId));
    if (evidenceRef) {
      let evidence = null;
      try { evidence = await state.readJson(projectDir, evidenceRef.path); } catch { evidence = null; }
      if (evidence?.requestId !== request.requestId || evidence.omissionSetDigest !== omissionSetDigest || !Array.isArray(evidence.omissions)
        || contract.digest(evidence.omissions) !== contract.digest(evidenceOmissions(omissions))) throw new Error('Omission acknowledgement binding changed');
    }
    if (require('./user-actions').staleArtifactRefs(projectDir, request).length) throw new Error('Omission acknowledgement artifact binding changed');
    const recordedBy = identity();
    for (const o of pending) o.merchantAcknowledgement = {
      status: 'acknowledged',
      requestId: request.requestId,
      answeredAt: new Date().toISOString(),
      recordedBy,
      ...(answer.note ? {
        note: answer.note
      } : {})
    };
  });
}
// Called at gate load and report generation to heal effect-before-answer crash/restore windows.
async function recoverAcknowledgements(projectDir, options = {}) {
  const {
    listUserActions,
    readUserAction
  } = require('./user-actions');
  const rows = await listUserActions(projectDir, {
    status: 'answered'
  });
  for (const row of rows) {
    const r = await readUserAction(projectDir, row.requestId);
    if (r.effect?.kind === 'read-back-omission-ack') await acknowledge(projectDir, r, r.answer, options);
  }
}
// The complete approved set is evidence, not prompt text: hundreds of field locations cannot fit the
// user-action prompt cap. Each request writes its own list once, pinned by sha256 in artifactRefs, so
// an answer after the list changed is refused. Acknowledging records that the merchant was told; the
// omissions stay approved omissions (open gaps), never resolved by the answer.
const PROMPT_MAX = 4000; // user-actions' prompt cap
const evidencePath = (entity, requestId) => `execution/review/read-back-omissions-${entity}-${requestId}.json`;
const evidenceOmissions = omissions => omissions.map(({ merchantAcknowledgement, ...o }) => o);
const countText = o => o.recordCount == null ? 'unknown count' : `${o.recordCount} records`;
function acknowledgementPrompt(entity, omissions, file, digest) {
  const inline = `Tell the merchant these fields were not migrated before launch: ${omissions.map(o => `${o.path} (${countText(o)})`).join(', ')}`;
  if (inline.length <= PROMPT_MAX) return inline;
  const head = `Tell the merchant these ${omissions.length} approved ${entity} field locations were not migrated before launch. Acknowledging records that the merchant was told; it does not resolve the gaps, which stay open until fixed or dismissed at Cutover. The complete list (location, record count and affected source records for each) is ${file} (sha256 pinned in this request; omission-set digest ${digest.slice(0, 12)}). First locations: `;
  let listed = '', shown = 0;
  for (const o of omissions) {
    const next = `${shown ? ', ' : ''}${o.path} (${countText(o)})`;
    if (head.length + listed.length + next.length + 40 > PROMPT_MAX) break;
    listed += next; shown++;
  }
  return `${head}${listed}${shown < omissions.length ? `, and ${omissions.length - shown} more in the file.` : '.'}`;
}
async function buildAcknowledgement(projectDir, runId, entity, item, requestId) {
  const omissions = item.approvedOmissions,
    omissionSetDigest = omissionDigest(omissions),
    file = evidencePath(entity, requestId);
  await state.atomic(projectDir, file, { schemaVersion: 1, requestId, runId, entity, omissionSetDigest, count: omissions.length, omissions: evidenceOmissions(omissions) });
  return {
    requestId,
    kind: 'manual_action',
    stage: 'completion',
    title: `Acknowledge omitted ${entity} fields`,
    prompt: acknowledgementPrompt(entity, omissions, file, omissionSetDigest),
    response: {
      mode: 'none'
    },
    artifactRefs: [...Object.entries(item.bindingDigests || contract.bindings(projectDir, entity)).map(([p, sha256]) => ({
      path: p,
      sha256
    })), { path: file, mediaType: 'application/json', sha256: hashArtifact(projectDir, file) }],
    effect: {
      kind: 'read-back-omission-ack',
      runId,
      entity,
      omissionSetDigest
    }
  };
}
function bindAcknowledgement(item, req) {
  item.pendingAcknowledgementRequest = req;
  for (const o of item.approvedOmissions) o.merchantAcknowledgement = { status: 'pending', requestId: req.requestId };
}
async function ensureAcknowledgementRequest(projectDir, req) {
  const actions = require('./user-actions');
  try { return await actions.readUserAction(projectDir, req.requestId); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  return actions.createUserAction(projectDir, req);
}
async function createAcknowledgement(projectDir, runId, entity) {
  return state.locked(projectDir, async () => {
    const gate = await state.load(projectDir), item = gate.runs[runId]?.entities?.[entity];
    if (!item?.approvedOmissions?.length || item.approvedOmissions.every(o => o.merchantAcknowledgement?.status === 'acknowledged')) return;
    const previous = item.pendingAcknowledgementRequest;
    if (previous) try {
      await require('./user-actions').readUserAction(projectDir, previous.requestId);
      return;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    // A request not yet shown keeps the identity already checkpointed on its omissions.
    const requestId = previous?.requestId || item.approvedOmissions[0].merchantAcknowledgement?.requestId || `uar_${require('node:crypto').randomUUID()}`;
    const req = await buildAcknowledgement(projectDir, runId, entity, item, requestId);
    bindAcknowledgement(item, req);
    await state.atomic(projectDir, state.FILE, gate);
    return ensureAcknowledgementRequest(projectDir, req);
  });
}

// Only the producer can move request-ID bindings and regenerate its per-request evidence.
// Checkpoint before publishing the replacement; retries finish that same request after a crash.
async function recoverStaleAcknowledgement(projectDir, requestId) {
  return state.locked(projectDir, async () => {
    const actions = require('./user-actions');
    const old = await actions.readUserAction(projectDir, requestId);
    if (old.effect?.kind !== 'read-back-omission-ack') throw new Error('Not an omission acknowledgement');
    if (old.status === 'superseded' && old.supersededBy) return actions.readUserAction(projectDir, old.supersededBy);
    if (old.status !== 'pending' || !actions.staleArtifactRefs(projectDir, old).length) throw new Error('Recovery requires a stale pending omission acknowledgement');
    const { runId, entity, omissionSetDigest } = old.effect;
    const gate = await state.load(projectDir), item = gate.runs[runId]?.entities?.[entity];
    const resuming = item?.acknowledgementRecovery?.fromRequestId === requestId;
    const boundId = resuming ? item.acknowledgementRecovery.toRequestId : requestId;
    if (!item?.approvedOmissions?.length || omissionDigest(item.approvedOmissions) !== omissionSetDigest
      || item.pendingAcknowledgementRequest?.requestId !== boundId
      || item.approvedOmissions.some(o => !(resuming ? ['pending', 'acknowledged'] : ['pending']).includes(o.merchantAcknowledgement?.status) || o.merchantAcknowledgement.requestId !== boundId)) {
      throw new Error('Omission acknowledgement binding changed; restore the producing read-back gate before recovery');
    }
    // Evidence can be rebuilt from the gate, but changed mapping/import inputs need their
    // producing stage's validation. Never refresh those hashes to bless outdated approvals.
    const refs = [...old.artifactRefs.filter(r => r.path !== evidencePath(entity, requestId)),
      ...Object.entries(item.bindingDigests || {}).map(([path, sha256]) => ({ path, sha256 }))];
    if (actions.staleArtifactRefs(projectDir, { artifactRefs: refs }).length) {
      throw new Error('Read-back inputs changed; revalidate the producing mapping/import stage before acknowledgement recovery');
    }
    let req = item.pendingAcknowledgementRequest;
    if (!resuming) {
      req = await buildAcknowledgement(projectDir, runId, entity, item, `uar_${require('node:crypto').randomUUID()}`);
      bindAcknowledgement(item, req);
      item.acknowledgementRecovery = { fromRequestId: requestId, toRequestId: req.requestId };
      await state.atomic(projectDir, state.FILE, gate);
    }
    const replacement = await ensureAcknowledgementRequest(projectDir, req);
    const answered = replacement.status === 'answered' && replacement.answer?.acknowledged === true
      && item.approvedOmissions.every(o => o.merchantAcknowledgement.status === 'acknowledged');
    if (!answered && (replacement.status !== 'pending' || actions.staleArtifactRefs(projectDir, replacement).length)) throw new Error('Recovery replacement must remain fresh and pending');
    await actions.supersedeUserAction(projectDir, requestId, { replacementId: replacement.requestId });
    return replacement;
  });
}
module.exports = {
  applyApproval,
  gatedEntities,
  acknowledge,
  recoverAcknowledgements,
  createAcknowledgement,
  recoverStaleAcknowledgement,
  omissionDigest,
  evidencePath
};
