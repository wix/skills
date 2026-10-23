'use strict';

const state = require('./read-back-state');
const FIELD_CATEGORIES = ['verified', 'changed', 'dropped', 'refused', 'unverifiable', 'guardDropped', 'notExercised'];
const numeric = (object, keys) => Object.fromEntries(keys.filter(key => typeof object?.[key] === 'number' && Number.isFinite(object[key])).map(key => [key, Math.max(0, object[key])]));
function identity(value) {
  if (!value) return null;
  return { userId: value.userId || null, displayName: value.displayName || null, source: value.source || null, observedAt: value.observedAt || null };
}
function acknowledgement(value) {
  if (!value) return { status: 'pending' };
  return { status: value.status, requestId: value.requestId || null, answeredAt: value.answeredAt || null, recordedBy: identity(value.recordedBy) };
}
function currentEntries(gate) {
  return Object.entries(gate.runs || {}).flatMap(([runId, run]) => Object.entries(run.entities || {}).filter(([entity, item]) => !(item.supersededBy && gate.runs[item.supersededBy]?.entities?.[entity])).map(([entity, item]) => ({ runId, entity, item })));
}
function projectReadBackSummary(gate, { entity: filter } = {}) {
  const runs = new Map();
  let observedLossCount = 0;
  for (const { runId, entity, item } of currentEntries(gate)) {
    if (filter && filter !== entity) continue;
    if (!runs.has(runId)) runs.set(runId, []);
    if (item.gated === false) {
      const declared = require('./read-back-gate').declaration(entity, item);
      if (declared.gated) throw new Error('Gated entity cannot be reported as a non-gated declaration');
      runs.get(runId).push({ ...declared, status: 'not-covered' });
      continue;
    }
    const guardDropped = item.guardDropped || [];
    const guardPaths = [...new Set(guardDropped.map(row => row.path).filter(Boolean))].sort();
    const fieldCounts = Object.fromEntries(FIELD_CATEGORIES.map(kind => [kind, kind === 'guardDropped' ? guardPaths.length : new Set(item.paths?.[kind] || []).size]));
    const losses = (gate.observedLosses || []).filter(row => row.entity === entity);
    observedLossCount += losses.length;
    runs.get(runId).push({
      entity, gated: true, status: item.status, stopReason: item.stopReason || null,
      canaryCount: item.canaries?.length || 0, endOfRunVerified: item.endOfRunVerified === true,
      fieldCounts, observedPathCounts: fieldCounts,
      guardDropped: { recordCount: new Set(guardDropped.map(row => row.sourceId)).size, paths: guardPaths },
      observedLossCount: losses.length,
      approvedOmissions: (item.approvedOmissions || []).map(row => ({ path: row.path, kind: row.kind, recordCount: row.recordCount, approvedBy: identity(row.approvedBy), merchantAcknowledgement: acknowledgement(row.merchantAcknowledgement) })),
      pendingSettlementCount: (item.settlements || []).filter(row => row.status !== 'passed').length,
      timing: numeric(item.timing, ['elapsedMs', 'preparationMs', 'writeMs', 'activeReadMs']),
      retryStats: numeric(item.retryStats, ['attempts', 'timeouts', 'readMs', 'pacingMs', 'retryMs', 'settlementMs', 'remainingMs'])
    });
  }
  return { schemaVersion: 1, status: runs.size ? 'recorded' : 'not-run', observedLossCount, runs: [...runs].map(([runId, entities]) => ({ runId, entities: entities.sort((a, b) => a.entity.localeCompare(b.entity)) })) };
}
async function recordDeclaration(projectDir, runId, entity, options) {
  const declared = require('./read-back-gate').declaration(entity, options);
  if (declared.gated) throw new Error('Gated entity requires ReadBackGate; a declaration cannot bypass it');
  if (typeof runId !== 'string' || !runId.trim() || typeof entity !== 'string' || !entity.trim()) throw new Error('Declaration requires run and entity');
  return state.update(projectDir, gate => {
    // Never overwrite earlier gate evidence, including a stopped or superseded row.
    const history = Object.values(gate.runs).flatMap(run => Object.entries(run.entities || {})).filter(([name]) => name === entity);
    if (history.some(([, item]) => item.gated !== false || item.status !== 'not-covered')) throw new Error('Declaration cannot replace existing gate history');
    for (const [previousId, previous] of Object.entries(gate.runs)) {
      if (previousId !== runId && Object.hasOwn(previous.entities || {}, entity)) previous.entities[entity].supersededBy = runId;
    }
    const run = Object.hasOwn(gate.runs, runId) ? gate.runs[runId] : { entities: {} };
    gate.runs = { ...gate.runs, [runId]: { ...run, entities: { ...run.entities, [entity]: { ...declared, status: 'not-covered' } } } };
    return declared;
  });
}
function renderReadBackSummary(summary) {
  const lines = ['', '## Read-Back Verification', '', `- Status: ${summary.status}.`];
  for (const run of summary.runs) for (const item of run.entities) {
    lines.push('', `### ${item.entity} (${run.runId})`, '');
    if (!item.gated) {
      lines.push(`- Outside the four-entity field gate; verification: ${item.verificationKind}; reason: ${item.reason}.`);
      continue;
    }
    lines.push(`- Gate: ${item.status}; final record verified: ${item.endOfRunVerified ? 'yes' : 'no'}${item.stopReason ? `; reason: ${item.stopReason}` : ''}.`);
    lines.push(`- Field counts: ${Object.entries(item.fieldCounts).map(([key, value]) => `${key}: ${value}`).join('; ')}.`);
    lines.push(`- Guard-dropped: ${item.guardDropped.recordCount} records; ${item.guardDropped.paths.length} paths. Pending settlements: ${item.pendingSettlementCount}.`);
    lines.push(`- Timing: ${Object.entries(item.timing).map(([key, value]) => `${key}: ${value} ms`).join('; ') || 'not recorded'}.`);
    lines.push(`- Read activity: ${Object.entries(item.retryStats).map(([key, value]) => `${key}: ${value}`).join('; ') || 'not recorded'}.`);
    for (const omission of item.approvedOmissions) lines.push(`- Approved omission: ${omission.path} (${omission.kind}, ${omission.recordCount == null ? 'unknown' : omission.recordCount} records); approved by ${omission.approvedBy?.displayName || 'not recorded'} (${omission.approvedBy?.userId || 'no stable id'}); merchant acknowledgement: ${omission.merchantAcknowledgement.status}.`);
  }
  return lines;
}
module.exports = { FIELD_CATEGORIES, currentEntries, projectReadBackSummary, recordDeclaration, renderReadBackSummary };
