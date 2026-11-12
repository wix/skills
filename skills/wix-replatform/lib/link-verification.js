'use strict';

const { validateLinkAudit } = require('./link-audit.js');
const { verifiedDestination, writerGuard, reconcileRecord } = require('./internal-link-reconciliation.js');

const MAX_LIVE_MS = 30 * 60 * 1000;
const CALIBRATION_MS = 2 * 60 * 1000;
const MAX_CALIBRATION_CHECKS = 20;
const MAX_EXCEPTION_TOKENS = 100000;
const READ_TIMEOUT_MS = 10000;

async function boundedRead(callback, row, options = {}) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      callback(row, { ...options, signal: controller.signal }),
      new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('destination read timed out')); }, READ_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timeout); }
}

function estimateCost(audit, { checkMs, checkSource = 'measured', readBackMs = checkMs, writeMs = 1500, writeSource = 'assumed-default', sessionCount = 0, retryRatio = 0, concurrency = 1, calibrationMs = 0, calibratedCount = 0, exceptionTokens = 0 } = {}) {
  if (!Number.isFinite(checkMs) || checkMs < 0 || !Number.isFinite(calibrationMs)) throw new Error('measured check and calibration time required');
  const count = audit.pendingDestinations.length;
  const sampleCount = (audit.samples || []).length;
  const writableIds = new Set((audit.writerIntegrations || []).filter((row) => row.status === 'available').flatMap((row) => row.occurrenceIds));
  const writes = new Set((audit.occurrences || []).filter((row) => writableIds.has(row.id)).map((row) => `${row.recordType || 'unknown'}:${row.targetRecordId || row.id}`)).size;
  const renderedLinkChecks = (audit.pendingDestinations || []).reduce((sum, row) => sum + row.occurrenceIds.filter((id) => writableIds.has(id)).length, 0);
  const predictedMs = calibrationMs + Math.ceil((Math.max(0, count - calibratedCount) + sampleCount) / concurrency) * checkMs * (1 + retryRatio) + writes * (writeMs + readBackMs) + renderedLinkChecks * readBackMs + sessionCount * 3000;
  return {
    kind: 'estimate', predictedMs, exceptionTokens, withinBudget: predictedMs <= (audit.budgetDecision?.maxLiveMs || MAX_LIVE_MS) && exceptionTokens <= (audit.budgetDecision?.maxExceptionTokens || MAX_EXCEPTION_TOKENS),
    inputs: { distinctDestinations: count, calibratedCount, familySamples: sampleCount, writes, renderedLinkChecks, concurrency, retryRatio, checkMs, checkSource, readBackMs, writeMs, writeSource, sessionCount, sessionMs: 3000, calibrationMs },
    uncertainty: 'Destination retries, session behavior, content write latency and operator exception review may differ from inputs.',
  };
}

async function calibrate(audit, check, { now = () => Date.now(), prior = null } = {}) {
  if (typeof check !== 'function') throw new Error('read-only check required');
  const start = now();
  const results = { ...(prior && prior.results || {}) };
  for (const row of audit.pendingDestinations.slice(0, MAX_CALIBRATION_CHECKS)) {
    if (results[row.id] && results[row.id].result && results[row.id].result.reason !== 'read-unavailable') continue;
    if (!results[row.id] && Object.keys(results).length >= MAX_CALIBRATION_CHECKS) break;
    if ((prior && prior.elapsedMs || 0) + now() - start >= CALIBRATION_MS - READ_TIMEOUT_MS) break;
    const before = now();
    let result;
    try { result = await boundedRead(check, row, { readOnly: true }); }
    catch (error) { result = { reason: 'read-unavailable', errorCode: error.code || 'read-error' }; }
    results[row.id] = { result, elapsedMs: now() - before };
  }
  const elapsedMs = now() - start;
  const values = Object.values(results).map((entry) => entry.elapsedMs);
  return { results, elapsedMs: (prior && prior.elapsedMs || 0) + elapsedMs, checkMs: values.length ? Math.max(1, values.reduce((sum, value) => sum + value, 0) / values.length) : 2000, checkSource: values.length ? 'measured' : 'assumed-default' };
}

async function verifyLinkAudit(audit, { deploymentId, destinationState, activeWriters, checkDestination, checkSample, checkRenderedLink, checkFragment, recordAdapter, journal, repair, normalizeUnresolved, readBackMs, writeMs, writeSource, sessionCount = 0, exceptionTokens = 0, now = () => Date.now(), onCheckpoint = async () => {} }) {
  validateLinkAudit(audit);
  if (!deploymentId || typeof checkDestination !== 'function' || typeof checkSample !== 'function') throw new Error('deployment and read-only check callbacks required');
  if (destinationState !== 'migration-not-live') throw new Error('post-frontend repairs require a confirmed non-live migration destination');
  if (audit.deploymentId && audit.deploymentId !== deploymentId) throw new Error('deployment changed; replan and invalidate prior verification first');
  if (audit.stage === 'budget-hold') throw new Error('budget hold requires a recorded human decision and re-plan before verification resumes');
  const liveLimitMs = audit.budgetDecision?.maxLiveMs || MAX_LIVE_MS;
  // Re-evaluate the active contracts at the actual write boundary. A plan from an earlier
  // build or an adjacent writer revision is not permission to mutate content.
  for (const integration of audit.writerIntegrations || []) {
    const recordType = integration.field.split(':', 1)[0];
    const guard = writerGuard(integration.field, activeWriters, recordType);
    integration.status = guard.ok ? 'available' : 'pending';
    integration.reason = guard.ok ? null : guard.reason;
  }
  const started = now();
  const priorElapsedMs = audit.liveElapsedMs || 0;
  const spentMs = () => priorElapsedMs + now() - started;
  const checkpoint = async () => { audit.liveElapsedMs = spentMs(); await onCheckpoint(audit); };
  audit.deploymentId = deploymentId;
  const calibration = await calibrate(audit, checkDestination, { now, prior: audit.calibration });
  audit.calibration = calibration;
  audit.estimate = estimateCost(audit, { checkMs: calibration.checkMs, checkSource: calibration.checkSource, readBackMs, writeMs, writeSource, sessionCount, calibrationMs: spentMs(), calibratedCount: Object.keys(calibration.results).length, exceptionTokens });
  audit.liveStartedAt = new Date().toISOString();
  if (!audit.estimate.withinBudget || spentMs() > liveLimitMs) {
    audit.stage = 'budget-hold';
    await checkpoint();
    return audit;
  }
  const familyResults = new Map();
  audit.sampleResults ||= {};
  for (const sample of audit.samples || []) {
    const sampleId = JSON.stringify([sample.pageFamily, sample.targetRecordId, deploymentId, audit.routeRevision]);
    if (audit.sampleResults[sampleId]?.passed) {
      familyResults.set(sample.pageFamily, (familyResults.get(sample.pageFamily) !== false) && audit.sampleResults[sampleId].passed);
      continue;
    }
    if (spentMs() >= liveLimitMs) { audit.stage = 'budget-hold'; await checkpoint(); return audit; }
    let result;
    try { result = await boundedRead(checkSample, sample, { readOnly: true }); }
    catch { result = { reason: 'sample-unavailable' }; }
    const passed = result.identityMatched === true && result.generatedUrlMatched === true;
    audit.sampleResults[sampleId] = { passed, checkedAt: new Date().toISOString() };
    familyResults.set(sample.pageFamily, (familyResults.get(sample.pageFamily) !== false) && passed);
    await checkpoint();
  }
  const queue = [...audit.pendingDestinations];
  audit.pendingDestinations = [];
  const verifiedRows = new Map();
  for (let index = 0; index < queue.length; index += 1) {
    const destination = queue[index];
    if (spentMs() >= liveLimitMs) { audit.pendingDestinations.push(...queue.slice(index)); break; }
    if (familyResults.get(destination.pageFamily) !== true) {
      destination.reason = 'family-sample-unverified'; audit.pendingDestinations.push(destination); continue;
    }
    const cached = calibration.results[destination.id];
    let check;
    if (cached && cached.result && cached.result.reason !== 'read-unavailable') check = cached.result;
    else try { check = await boundedRead(checkDestination, destination, { readOnly: true }); }
      catch { check = { reason: 'read-unavailable' }; }
    if (!check || check.identityMatched !== true || check.generatedUrlMatched !== true || check.rendered !== true || check.deploymentId !== deploymentId || check.path !== destination.expectedPath) {
      destination.reason = check && check.reason || 'served-route-unverified'; audit.pendingDestinations.push(destination); continue;
    }
    const verified = verifiedDestination({ ...check, targetRecordId: destination.targetRecordId, pageFamily: destination.pageFamily });
    if (recordAdapter) {
      for (const id of destination.occurrenceIds) verifiedRows.set(id, { destination, verified });
      audit.pendingDestinations.push(destination);
      const completedPrefix = audit.pendingDestinations;
      audit.pendingDestinations = [...completedPrefix, ...queue.slice(index + 1)];
      await checkpoint();
      audit.pendingDestinations = completedPrefix;
      continue;
    }
    let held = false;
    for (const id of destination.occurrenceIds) {
      const occurrence = audit.occurrences.find((row) => row.id === id);
      if (occurrence.classification !== 'internal-navigation') continue;
      const field = `${occurrence.recordType || 'unknown'}:${occurrence.field}`;
      const integration = (audit.writerIntegrations || []).find((row) => row.field === field);
      if (!integration || integration.status !== 'available' || typeof repair !== 'function') { held = true; continue; }
      const original = new URL(occurrence.originalPath, 'https://link-audit.invalid');
      const repairedPath = `${verified.path}${original.search}${original.hash}`;
      const result = await repair(occurrence, { ...verified, repairedPath });
      if (!result || result.status !== 'read-back-verified' || result.rendered !== true) { held = true; continue; }
      audit.outcomes.push({ occurrenceId: id, status: 'verified', targetRecordId: destination.targetRecordId, expectedPath: destination.expectedPath, deploymentId, contentRevision: result.contentRevision || null, checkedAt: verified.checkedAt });
    }
    if (held) audit.pendingDestinations.push({ ...destination, occurrenceIds: destination.occurrenceIds.filter((id) => !audit.outcomes.some((row) => row.occurrenceId === id)), reason: 'writer-or-link-verification-pending' });
    // Include the unprocessed queue in the durable checkpoint, without duplicating any
    // occurrence that has already reached an outcome.
    const completedPrefix = audit.pendingDestinations;
    audit.pendingDestinations = [...completedPrefix, ...queue.slice(index + 1)];
    await checkpoint();
    audit.pendingDestinations = completedPrefix;
  }
  if (recordAdapter) {
    if (!journal || typeof recordAdapter.read !== 'function' || typeof recordAdapter.write !== 'function' || typeof recordAdapter.patchField !== 'function' || typeof checkRenderedLink !== 'function') {
      throw new Error('guarded record adapter, journal and rendered-link check required');
    }
    const groups = new Map();
    for (const [id, row] of verifiedRows) {
      const occurrence = audit.occurrences.find((item) => item.id === id);
      if (!occurrence || !occurrence.targetRecordId || !occurrence.recordType) continue;
      const key = `${occurrence.recordType}\0${occurrence.targetRecordId}`;
      if (!groups.has(key)) groups.set(key, { recordId: occurrence.targetRecordId, recordType: occurrence.recordType, rows: [] });
      groups.get(key).rows.push({ occurrence, ...row });
    }
    for (const group of groups.values()) {
      if (spentMs() >= liveLimitMs) break;
      const byField = new Map();
      const destinations = {};
      for (const row of group.rows) {
        const fieldName = row.occurrence.field;
        const fieldKey = `${group.recordType}:${fieldName}`;
        if (!audit.writerIntegrations.some((item) => item.field === fieldKey && item.status === 'available')) continue;
        if (!row.occurrence.targetContentRevision) {
          const pending = audit.pendingDestinations.find((item) => item.occurrenceIds.includes(row.occurrence.id));
          if (pending) pending.reason = 'missing-content-revision';
          continue;
        }
        if (audit.pendingDestinations.some((item) => item.occurrenceIds.some((id) => {
          const occurrence = audit.occurrences.find((candidate) => candidate.id === id);
          return occurrence && occurrence.targetRecordId === group.recordId && occurrence.recordType === group.recordType && occurrence.field === fieldName && !verifiedRows.has(id);
        }))) continue;
        if (!byField.has(fieldName)) byField.set(fieldName, { name: fieldName, occurrenceIds: [], patches: [], expectedRevision: row.occurrence.targetContentRevision });
        if (byField.get(fieldName).expectedRevision !== row.occurrence.targetContentRevision) throw new Error('inconsistent planned content revisions');
        const original = new URL(row.occurrence.originalPath, 'https://link-audit.invalid');
        const repairedPath = `${row.verified.path}${original.search}${original.hash}`;
        byField.get(fieldName).occurrenceIds.push(row.occurrence.id);
        byField.get(fieldName).patches.push({ occurrence: row.occurrence, destinationId: row.destination.id, path: repairedPath });
        destinations[row.destination.id] = row.verified;
      }
      if (!byField.size) continue;
      const fields = [...byField.values()];
      const intentKey = JSON.stringify([audit.runId, audit.sourceSnapshot, audit.routeRevision, deploymentId, group.recordType, group.recordId, fields.flatMap((field) => field.occurrenceIds).sort()]);
      let result;
      try {
        const priorIntentKeys = [...new Set(group.rows.map((row) => audit.priorWriteIntents?.[row.occurrence.id]).filter(Boolean))];
        result = await reconcileRecord({ recordId: group.recordId, recordType: group.recordType, fields, destinations, activeWriters, destinationState, adapter: recordAdapter, journal, intentKey, priorIntentKeys });
      } catch (error) {
        for (const row of group.rows) {
          const pending = audit.pendingDestinations.find((item) => item.occurrenceIds.includes(row.occurrence.id));
          if (pending) pending.reason = error.message === 'uncertain write conflicts with changed content' ? 'concurrent-edit' : 'writer-or-link-verification-pending';
        }
        await checkpoint();
        continue;
      }
      for (const blocked of result.blocked || []) {
        for (const pending of audit.pendingDestinations) {
          if (pending.occurrenceIds.some((id) => blocked.occurrenceIds.includes(id))) pending.reason = blocked.reason;
        }
      }
      // A successful backend write remains reusable even if this deployment has not
      // rendered it yet. The journal after-image is checked again on the next plan.
      if (result.written.length) {
        audit.priorWriteIntents ||= {};
        for (const row of group.rows) if (result.written.includes(row.occurrence.field)) {
          audit.priorWriteIntents[row.occurrence.id] = result.priorIntentKey || intentKey;
        }
        await checkpoint();
      }
      for (const row of group.rows) {
        if (spentMs() >= liveLimitMs) break;
        if (!result.written.includes(row.occurrence.field)) continue;
        const original = new URL(row.occurrence.originalPath, 'https://link-audit.invalid');
        const repairedPath = `${row.verified.path}${original.search}${original.hash}`;
        let rendered;
        try { rendered = await boundedRead(checkRenderedLink, row.occurrence, { readOnly: true, repairedPath, deploymentId }); }
        catch { rendered = null; }
        if (!rendered || rendered.rendered !== true || rendered.path !== repairedPath) continue;
        audit.outcomes.push({ occurrenceId: row.occurrence.id, status: 'verified', targetRecordId: row.destination.targetRecordId, containingRecordId: group.recordId, expectedPath: row.destination.expectedPath, deploymentId, contentRevision: result.contentRevision, writeIntentKey: result.priorIntentKey || intentKey, checkedAt: row.verified.checkedAt });
        for (const pending of audit.pendingDestinations) pending.occurrenceIds = pending.occurrenceIds.filter((id) => id !== row.occurrence.id);
      }
      audit.pendingDestinations = audit.pendingDestinations.filter((row) => row.occurrenceIds.length);
      await checkpoint();
    }
  }
  // Same-page fragments are checked as anchors and never passed to a destination writer.
  for (const unresolved of [...audit.unresolved]) {
    if (unresolved.detail !== 'fragment-anchor-unverified' || typeof checkFragment !== 'function') continue;
    const occurrence = audit.occurrences.find((row) => row.id === unresolved.occurrenceIds[0]);
    let result;
    try { result = await boundedRead(checkFragment, occurrence, { readOnly: true, deploymentId }); } catch { result = null; }
    if (!result || result.anchorExists !== true || result.deploymentId !== deploymentId) continue;
    audit.unresolved = audit.unresolved.filter((row) => row !== unresolved);
    audit.outcomes.push({ occurrenceId: occurrence.id, status: 'verified-fragment', deploymentId, checkedAt: new Date().toISOString() });
    await checkpoint();
  }
  for (const unresolved of audit.unresolved) {
    if (spentMs() >= liveLimitMs) break;
    if (!unresolved.originalPath || !unresolved.originalPath.startsWith('/') || unresolved.originalPath.startsWith('//')) continue;
    for (const id of unresolved.occurrenceIds) {
      const occurrence = audit.occurrences.find((row) => row.id === id);
      if (occurrence.classification !== 'internal-navigation') continue;
      const field = `${occurrence.recordType || 'unknown'}:${occurrence.field}`;
      const integration = (audit.writerIntegrations || []).find((row) => row.field === field);
      if (!integration || integration.status !== 'available' || typeof normalizeUnresolved !== 'function') continue;
      const result = await normalizeUnresolved(occurrence, unresolved.originalPath);
      if (result && result.status === 'read-back-verified') {
        unresolved.normalizationStatus = 'read-back-verified';
        unresolved.normalizedPath = unresolved.originalPath;
        await checkpoint();
      }
    }
  }
  audit.verification = { deploymentId, checkedAt: new Date().toISOString(), elapsedMs: spentMs(), exceptionTokens };
  for (const integration of audit.writerIntegrations || []) {
    if (integration.status === 'available' && integration.occurrenceIds.every((id) => audit.outcomes.some((row) => row.occurrenceId === id && row.status === 'verified') || audit.unresolved.some((row) => row.normalizationStatus === 'read-back-verified' && row.occurrenceIds.includes(id)))) {
      integration.status = 'complete';
    }
  }
  audit.stage = audit.pendingDestinations.length || audit.unresolved.length ? 'incomplete' : 'verified';
  if (spentMs() >= liveLimitMs) audit.stage = 'budget-hold';
  validateLinkAudit(audit);
  await checkpoint();
  return audit;
}

module.exports = { MAX_LIVE_MS, MAX_EXCEPTION_TOKENS, estimateCost, calibrate, verifyLinkAudit };
