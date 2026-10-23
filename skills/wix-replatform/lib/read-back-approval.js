'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const state = require('./read-back-state');
const contract = require('./read-back-contract');
const {
  requireOperatorIdentity
} = require('./operator-identity');
const {
  loadArtifacts,
  updateApprovalObject
} = require('./orchestration-state');
async function gatedEntities(projectDir) {
  let files;
  try {
    files = await fs.readdir(path.join(projectDir, 'mapping/entity-decisions'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const result = [];
  for (const name of files) if (name.endsWith('.json') && Object.hasOwn(contract.DOMAINS, name.slice(0, -5))) {
    const d = await state.readJson(projectDir, `mapping/entity-decisions/${name}`);
    if (d.readBackContract) result.push(name.slice(0, -5));
  }
  return result.sort();
}
async function applyApproval(projectDir, request, answer, {
  identity = requireOperatorIdentity
} = {}) {
  const type = request.effect?.approvalType;
  const status = {
    approved: 'approved',
    approve: 'approved',
    declined: 'rejected',
    reject: 'rejected'
  }[answer.choice];
  if (!['mapping', 'execution'].includes(type) || !status) throw new Error('Unsupported approval choice/type');
  return state.locked(projectDir, async () => {
    const artifacts = await loadArtifacts(projectDir);
    const entities = type === 'mapping' ? await gatedEntities(projectDir) : [];
    const bindingDigests = {};
    if (status === 'approved') for (const entity of entities) {
      Object.assign(bindingDigests, contract.bindings(projectDir, entity));
      const decision = await state.readJson(projectDir, `mapping/entity-decisions/${entity}.json`);
      const omissions = (decision.fieldDispositions || []).filter(d => d.status === 'notMigrated');
      const gate = await state.load(projectDir);
      const history = [...gate.observedLosses, ...Object.values(gate.runs).flatMap(r => Object.values(r.entities || {}).flatMap(e => [...(e.attemptedPaths || []), ...(e.settlements || []).filter(x => x.status !== 'passed')]))];
      for (const d of omissions) if (history.some(h => (!h.entity || h.entity === entity) && [...(h.sourcePaths || []), h.writePath, h.intendedTargetPath].includes(d.path || d.sourcePath || d.targetPath))) throw new Error('Attempted or observed loss cannot become approved omission');
    }
    for (const [p, h] of Object.entries(bindingDigests)) if (!request.artifactRefs?.some(r => r.path === p && String(r.sha256).replace(/^sha256:/, '') === h)) throw new Error(`Missing or stale read-back approval reference: ${p}`);
    const artifactRefs = await require('./user-actions').approvalArtifactRefs(projectDir, { approvalType: type, status, decidedBy: 'user', artifactRefs: request.artifactRefs, requireRequestRef: true });
    // Freshness is checked again under the state lock, not just by the caller's earlier check.
    if (!(type === 'mapping' && status === 'rejected') && require('./user-actions').staleArtifactRefs(projectDir, request).length) throw new Error('user_action_stale: approval inputs changed');
    const approvedBy = status === 'approved' && entities.length ? identity() : null;
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
async function createAcknowledgement(projectDir, runId, entity) {
  const gate = await state.load(projectDir),
    item = gate.runs[runId]?.entities?.[entity];
  if (!item?.approvedOmissions?.length || item.approvedOmissions.every(o => o.merchantAcknowledgement?.status === 'acknowledged')) return;
  const {
      createUserAction,
      readUserAction
    } = require('./user-actions'),
    {
      randomUUID
    } = require('node:crypto');
  let req = item.pendingAcknowledgementRequest;
  if (!req) {
    const requestId = item.approvedOmissions[0].merchantAcknowledgement?.requestId || `uar_${randomUUID()}`,
      omissions = item.approvedOmissions;
    req = {
      requestId,
      kind: 'manual_action',
      stage: 'completion',
      title: `Acknowledge omitted ${entity} fields`,
      prompt: `Tell the merchant these fields were not migrated before launch: ${omissions.map(o => `${o.path} (${o.recordCount} records)`).join(', ')}`,
      response: {
        mode: 'none'
      },
      artifactRefs: Object.entries(item.bindingDigests || contract.bindings(projectDir, entity)).map(([p, sha256]) => ({
        path: p,
        sha256
      })),
      effect: {
        kind: 'read-back-omission-ack',
        runId,
        entity,
        omissionSetDigest: omissionDigest(omissions)
      }
    };
    await state.update(projectDir, g => {
      const e = g.runs[runId].entities[entity];
      e.pendingAcknowledgementRequest = req;
      for (const o of e.approvedOmissions) o.merchantAcknowledgement = {
        status: 'pending',
        requestId
      };
    });
  }
  try {
    await readUserAction(projectDir, req.requestId);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await createUserAction(projectDir, req);
  }
}
module.exports = {
  applyApproval,
  gatedEntities,
  acknowledge,
  recoverAcknowledgements,
  createAcknowledgement,
  omissionDigest
};
