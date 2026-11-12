'use strict';

const { createHash } = require('node:crypto');
const { validateLinkAudit } = require('./link-audit.js');
const { writerGuard } = require('./internal-link-reconciliation.js');
const { expectedPath: pathFromPattern } = require('./app-page-routing.js');

function stableId(prefix, values) {
  return `${prefix}-${createHash('sha256').update(values.join('\0')).digest('hex').slice(0, 16)}`;
}

function lookupKey(path) {
  const hash = path.indexOf('#');
  return hash < 0 ? path : path.slice(0, hash);
}

function pathParts(value) {
  const url = new URL(value, 'https://link-audit.invalid');
  return { pathname: url.pathname, query: url.search, fragment: url.hash };
}

// Target rows come from a confirmed source identity -> target identity crosswalk and route
// read-back. Two records claiming the same old path are never silently collapsed.
function buildLinkPlan({ census, targets, samples = [], routes = [], ownershipDecisions = {}, activeWriters = [], previous = null, runId, sourceSnapshot, routeRevision, deploymentId = null, budgetDecision = null }) {
  if (!runId || !sourceSnapshot || !routeRevision) throw new Error('runId, sourceSnapshot and routeRevision required');
  const index = new Map();
  for (const target of targets) {
    if (!target.sourcePath || !target.targetRecordId || !target.pageFamily) throw new Error('target identity and sourcePath required');
    if (target.expectedPath) {
      const derived = target.readBackPattern && target.readBackSlug
        ? pathFromPattern(target.readBackPattern, target.readBackSlug)
        : target.fixedPageReadBackPath;
      if (!derived || derived !== target.expectedPath) throw new Error(`expected path for ${target.targetRecordId} lacks matching route and slug read-back`);
    }
    const key = lookupKey(target.sourcePath);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(target);
  }
  const pendingByTarget = new Map();
  const unresolved = [];
  const outcomes = [];
  const writerIntegrations = new Map();
  const recordWriter = (occurrence) => {
    const field = `${occurrence.recordType || 'unknown'}:${occurrence.field}`;
    const guard = writerGuard(field, activeWriters, occurrence.recordType);
    if (!writerIntegrations.has(field)) writerIntegrations.set(field, { field, status: guard.ok ? 'available' : 'pending', reason: guard.ok ? null : guard.reason, occurrenceIds: [] });
    writerIntegrations.get(field).occurrenceIds.push(occurrence.id);
  };
  for (const occurrence of census.occurrences) {
    if (occurrence.fragmentOnly) {
      unresolved.push({ id: stableId('unresolved', [occurrence.id]), occurrenceIds: [occurrence.id], reason: 'unsupported-family', detail: 'fragment-anchor-unverified', originalPath: occurrence.originalPath, candidateTargetIds: [] });
      continue;
    }
    if (occurrence.classification !== 'internal-navigation') {
      unresolved.push({ id: stableId('unresolved', [occurrence.id]), occurrenceIds: [occurrence.id], reason: occurrence.classification === 'stateful-navigation' ? 'unsupported-family' : 'ambiguous-target', detail: occurrence.classification, originalPath: occurrence.originalPath || occurrence.original || '', candidateTargetIds: [] });
      recordWriter(occurrence);
      continue;
    }
    const parts = pathParts(occurrence.originalPath);
    const exact = index.get(lookupKey(occurrence.originalPath)) || [];
    // A query permalink is resolved by its complete source identity. Falling back
    // to the path requires explicit per-target evidence for each query key.
    const queryKeys = [...new URLSearchParams(parts.query).keys()];
    const matches = exact.length ? exact : (index.get(parts.pathname) || []).filter((target) => !queryKeys.length || queryKeys.every((key) => (target.supportedQueryKeys || []).includes(key)));
    let unique = [...new Map(matches.map((target) => [`${target.targetRecordId}:${target.expectedPath || ''}`, target])).values()];
    const decision = ownershipDecisions[lookupKey(occurrence.originalPath)];
    if (unique.length > 1 && decision && decision.targetRecordId && decision.decisionRef) {
      const chosen = unique.filter((target) => target.targetRecordId === decision.targetRecordId);
      if (chosen.length === 1) unique = chosen;
    }
    let reason;
    if (queryKeys.length && !exact.length && !matches.length && index.has(parts.pathname)) reason = 'unsupported-family';
    else if (occurrence.sourceBroken === true) reason = 'source-broken';
    else if (occurrence.ambiguousTarget === true) reason = 'ambiguous-target';
    else if (!unique.length) reason = 'target-not-imported';
    else if (unique.length > 1) reason = 'collision';
    else if (!unique[0].expectedPath) reason = 'unsupported-family';
    if (reason) {
      unresolved.push({ id: stableId('unresolved', [occurrence.id]), occurrenceIds: [occurrence.id], reason, originalPath: occurrence.originalPath, candidateTargetIds: unique.map((target) => target.targetRecordId) });
      recordWriter(occurrence);
      continue;
    }
    const target = unique[0];
    const key = stableId('destination', [target.targetRecordId, target.expectedPath, target.pageFamily]);
    if (!pendingByTarget.has(key)) pendingByTarget.set(key, {
      id: key, targetRecordId: target.targetRecordId, expectedPath: target.expectedPath,
      pageFamily: target.pageFamily, occurrenceIds: [], status: 'pending',
      ...(decision && unique.length === 1 ? { ownershipDecisionRef: decision.decisionRef } : {}),
    });
    pendingByTarget.get(key).occurrenceIds.push(occurrence.id);
    recordWriter(occurrence);
  }
  const audit = {
    schemaVersion: 1, censusVersion: 4, runId, sourceSnapshot, routeRevision, deploymentId, stage: 'pending-frontend',
    manifest: census.manifest, counts: census.counts, occurrences: census.occurrences,
    pendingDestinations: [...pendingByTarget.values()], unresolved, outcomes,
    writerIntegrations: [...writerIntegrations.values()], samples, routes, postDnsStatus: previous && previous.postDnsStatus || 'pending',
    verification: { deploymentId: null, checkedAt: null },
  };
  if (previous && previous.runId === runId) {
    if (previous.sourceSnapshot === sourceSnapshot && previous.routeRevision === routeRevision) {
      audit.priorWriteIntents = { ...(previous.priorWriteIntents || {}) };
      for (const outcome of previous.outcomes || []) if (outcome.writeIntentKey) audit.priorWriteIntents[outcome.occurrenceId] = outcome.writeIntentKey;
    }
    audit.liveElapsedMs = previous.liveElapsedMs || 0;
    const sameVerificationInputs = previous.sourceSnapshot === sourceSnapshot && previous.routeRevision === routeRevision && previous.deploymentId === deploymentId;
    if (sameVerificationInputs && previous.calibration) {
      const currentDestinationIds = new Set(audit.pendingDestinations.map((row) => row.id));
      audit.calibration = {
        ...previous.calibration,
        results: Object.fromEntries(Object.entries(previous.calibration.results || {}).filter(([id]) => currentDestinationIds.has(id))),
      };
    }
    if (previous.estimate) audit.estimate = previous.estimate;
    if (sameVerificationInputs && previous.sampleResults) audit.sampleResults = previous.sampleResults;
    if (previous.budgetDecision) audit.budgetDecision = previous.budgetDecision;
    if (previous.stage === 'budget-hold' && !budgetDecision) audit.stage = 'budget-hold';
  }
  if (budgetDecision) {
    if (!previous || previous.runId !== runId || previous.stage !== 'budget-hold' || !budgetDecision.decisionRef || !Number.isFinite(budgetDecision.maxLiveMs) || budgetDecision.maxLiveMs < 30 * 60 * 1000 || !Number.isFinite(budgetDecision.maxExceptionTokens) || budgetDecision.maxExceptionTokens < 100000) {
      throw new Error('budget resume requires a recorded decision and explicit approved ceilings for the same held run');
    }
    audit.budgetDecision = budgetDecision;
    audit.stage = 'pending-frontend';
  }
  // Preserve final outcomes only when every provenance dimension still matches. The
  // destination queues are reconstructed from current source and route evidence.
  if (deploymentId && previous && previous.sourceSnapshot === sourceSnapshot && previous.routeRevision === routeRevision && previous.deploymentId === deploymentId) {
    const finished = new Map((previous.outcomes || []).map((row) => [row.occurrenceId, row]));
    for (const pending of audit.pendingDestinations) {
      pending.occurrenceIds = pending.occurrenceIds.filter((id) => {
        const done = finished.get(id);
        const target = targets.find((row) => row.targetRecordId === pending.targetRecordId && row.expectedPath === pending.expectedPath);
        const occurrence = audit.occurrences.find((row) => row.id === id);
        if (!done || !target || !occurrence?.targetContentRevision || done.contentRevision !== occurrence.targetContentRevision || done.containingRecordId !== occurrence.targetRecordId || done.targetRecordId !== pending.targetRecordId || done.expectedPath !== pending.expectedPath) return true;
        outcomes.push(done); return false;
      });
    }
    audit.pendingDestinations = audit.pendingDestinations.filter((row) => row.occurrenceIds.length);
    if (previous.stage === 'verified' && !audit.pendingDestinations.length && !audit.unresolved.length && audit.writerIntegrations.every((row) => row.occurrenceIds.every((id) => outcomes.some((outcome) => outcome.occurrenceId === id)))) {
      audit.stage = 'verified';
      audit.writerIntegrations.forEach((row) => { row.status = 'complete'; });
    }
  }
  return validateLinkAudit(audit);
}

module.exports = { buildLinkPlan };
