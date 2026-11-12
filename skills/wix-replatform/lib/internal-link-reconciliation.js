'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

function exactHosts(hosts) {
  return new Set((hosts || []).map((host) => new URL(`https://${host}`).host.toLowerCase()));
}

function classifyNavigation(value, containingUrl, { sourceHosts = [], destinationHosts = [] } = {}) {
  if (typeof value !== 'string' || !value) return { kind: 'invalid' };
  if (/^(?:javascript|data|mailto|tel):/i.test(value)) return { kind: 'action', value };
  let url;
  try { url = new URL(value, containingUrl); } catch { return { kind: 'invalid', value }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { kind: 'external', value };
  const hosts = exactHosts([...sourceHosts, ...destinationHosts]);
  if (!hosts.has(url.host.toLowerCase())) return { kind: 'external', value };
  const path = `${url.pathname}${url.search}${url.hash}`;
  const stateful = /^\/(?:wp-admin|wp-login|account\/login|checkout\/order-pay)(?:\/|$)/i.test(url.pathname)
    || [...url.searchParams.keys()].some((key) => /^(?:nonce|_wpnonce|token|auth|session|add-to-cart|remove_item|order-pay)$/i.test(key));
  if (stateful) return { kind: 'stateful', original: value, path, host: url.host.toLowerCase() };
  return { kind: 'internal', original: value, path, lookupPath: `${url.pathname}${url.search}`, host: url.host.toLowerCase(), fragmentOnly: value.startsWith('#') };
}

function occurrenceId({ sourceFile, sourceRecordId = '', field, location, original }) {
  return createHash('sha256').update([sourceFile, sourceRecordId, field, location, original].join('\0')).digest('hex').slice(0, 24);
}

function verifiedDestination(row) {
  if (!row || !row.targetRecordId || !row.path || !row.pageFamily || !row.deploymentId || !row.routeRevision || !row.checkedAt || row.identityMatched !== true || row.rendered !== true) {
    throw new Error('verified destination requires target identity, served path and current deployment evidence');
  }
  if (!row.path.startsWith('/') || row.path.startsWith('//')) throw new Error('verified path must be root-relative');
  return row;
}

function writerGuard(field, activeWriters, recordType) {
  if (recordType === 'blog-post') return { ok: false, reason: 'blog-writer-integration-pending' };
  if (!activeWriters || activeWriters.complete !== true || !Array.isArray(activeWriters.writers) || activeWriters.writers.some((row) => !row || !Array.isArray(row.fields))) {
    return { ok: false, reason: 'unknown-writer-contract' };
  }
  const touching = activeWriters.writers.filter((row) => row.fields.includes(field));
  if (touching.length !== 1 || touching[0].writer !== 'internal-link-reconciler' || touching[0].compatible !== true || touching[0].runsAfter !== 'post-frontend-verification') {
    return { ok: false, reason: 'incompatible-writer-contract' };
  }
  return { ok: true };
}

// Mutation is per logical record. A guarded field may proceed while another field is held.
// The adapter owns native field serialization; this function never edits blog post fields.
async function reconcileRecord({ recordId, recordType, fields, destinations, activeWriters, destinationState, adapter, journal, intentKey = null, priorIntentKeys = [] }) {
  if (!adapter || typeof adapter.patchField !== 'function' || !journal || !recordId) throw new Error('record, structured patch adapter and journal required');
  if (destinationState !== 'migration-not-live') throw new Error('content writes require a confirmed non-live migration destination');
  const blocked = [];
  const eligible = [];
  for (const field of fields) {
    const guard = writerGuard(`${recordType}:${field.name}`, activeWriters, recordType);
    if (!guard.ok) { blocked.push({ field: field.name, occurrenceIds: field.occurrenceIds, reason: guard.reason }); continue; }
    const destination = field.patches ? null : destinations[field.destinationId];
    if (field.patches) {
      if (!field.patches.length || field.patches.some((patch) => {
        try { verifiedDestination(destinations[patch.destinationId]); return false; } catch { return true; }
      })) {
        blocked.push({ field: field.name, occurrenceIds: field.occurrenceIds, reason: 'destination-unverified' }); continue;
      }
      eligible.push({ field, destination: null });
      continue;
    }
    if (field.unresolvedNormalization === true) {
      if (!destination || !destination.path || !destination.path.startsWith('/') || destination.path.startsWith('//')) {
        blocked.push({ field: field.name, occurrenceIds: field.occurrenceIds, reason: 'unresolved-original-path-invalid' }); continue;
      }
    } else {
      try { verifiedDestination(destination); } catch {
        blocked.push({ field: field.name, occurrenceIds: field.occurrenceIds, reason: 'destination-unverified' }); continue;
      }
    }
    eligible.push({ field, destination });
  }
  if (!eligible.length) return { recordId, blocked, written: [] };
  const current = await adapter.read(recordId);
  if (!current || !current.revision) throw new Error('content read needs revision');
  if (intentKey && typeof journal.findCompleted === 'function') {
    const completed = await journal.findCompleted(recordId, intentKey);
    if (completed) {
      if (!completed.changes.every((change) => isDeepStrictEqual(current.fields[change.name], change.after))) throw new Error('completed link repair conflicts with changed content');
      return { recordId, blocked, written: completed.changes.map((change) => change.name), resumed: true, contentRevision: current.revision };
    }
  }
  if (intentKey && typeof journal.findOpen === 'function') {
    const open = await journal.findOpen(recordId, intentKey);
    if (open) {
      if (open.changes.every((change) => isDeepStrictEqual(current.fields[change.name], change.after))) {
        await journal.complete(open);
        return { recordId, blocked, written: open.changes.map((change) => change.name), resumed: true, contentRevision: current.revision };
      }
      if (current.revision !== open.baseRevision) throw new Error('uncertain write conflicts with changed content');
      await adapter.write(recordId, Object.fromEntries(open.changes.map((change) => [change.name, change.after])), current.revision);
      const readBack = await adapter.read(recordId);
      if (!open.changes.every((change) => isDeepStrictEqual(readBack.fields[change.name], change.after))) throw new Error('content write read-back mismatch');
      await journal.complete(open);
      return { recordId, blocked, written: open.changes.map((change) => change.name), resumed: true, contentRevision: readBack.revision };
    }
  }
  // A frontend redeploy invalidates served-link evidence, not a completed content write.
  // Reuse the exact journaled after-image only when it still matches the current record.
  if (typeof journal.findCompleted === 'function') {
    for (const priorKey of priorIntentKeys) {
      const completed = await journal.findCompleted(recordId, priorKey);
      if (!completed || !eligible.every(({ field }) => completed.changes.some((change) =>
        change.name === field.name && field.occurrenceIds.every((id) => change.occurrenceIds.includes(id)))) ||
          !completed.changes.every((change) => isDeepStrictEqual(current.fields[change.name], change.after))) continue;
      return { recordId, blocked, written: eligible.map(({ field }) => field.name), resumed: true, contentRevision: current.revision, priorIntentKey: priorKey };
    }
  }
  for (const { field } of eligible) {
    if (field.expectedRevision && field.expectedRevision !== current.revision) {
      blocked.push({ field: field.name, occurrenceIds: field.occurrenceIds, reason: 'concurrent-edit' });
    }
  }
  if (blocked.some((row) => row.reason === 'concurrent-edit')) return { recordId, blocked, written: [] };
  const intended = eligible.map(({ field, destination }) => {
    const baseValue = field.baseValue === undefined ? current.fields[field.name] : field.baseValue;
    let patch;
    if (field.patches) {
      const ordered = [...field.patches].sort((a, b) => {
        const offset = (row) => Number(/char:(\d+)/.exec(row.occurrence.location || '')?.[1] || 0);
        return offset(b) - offset(a);
      });
      patch = { value: baseValue, preservedUnrelated: true, changedLocations: [] };
      for (const row of ordered) {
        const next = adapter.patchField(patch.value, row.occurrence, row.path);
        if (!next || next.preservedUnrelated !== true || !next.changedLocations?.length) throw new Error(`field ${field.name} lacks a verified structured link patch`);
        patch = { value: next.value, preservedUnrelated: true, changedLocations: [...patch.changedLocations, ...next.changedLocations] };
      }
    } else patch = adapter.patchField(baseValue, field, destination.path);
    if (!patch || patch.preservedUnrelated !== true || !Array.isArray(patch.changedLocations) || !patch.changedLocations.length) {
      throw new Error(`field ${field.name} lacks a verified structured link patch`);
    }
    return { name: field.name, before: baseValue, after: patch.value, occurrenceIds: field.occurrenceIds, changedLocations: patch.changedLocations };
  });
  const attempt = intentKey ? null : await journal.find(recordId, intended);
  if (attempt && intended.every((change) => isDeepStrictEqual(current.fields[change.name], change.after))) {
    await journal.complete(attempt);
    return { recordId, blocked, written: intended.map((change) => change.name), resumed: true };
  }
  if (attempt && current.revision !== attempt.baseRevision) throw new Error('uncertain write conflicts with changed content');
  const changes = [];
  for (const { field, destination } of eligible) {
    if (!isDeepStrictEqual(current.fields[field.name], field.baseValue === undefined ? current.fields[field.name] : field.baseValue)) {
      blocked.push({ field: field.name, occurrenceIds: field.occurrenceIds, reason: 'concurrent-edit' });
    } else {
      const intendedChange = intended.find((row) => row.name === field.name);
      if (!isDeepStrictEqual(current.fields[field.name], intendedChange.after)) changes.push(intendedChange);
    }
  }
  if (!changes.length) return { recordId, blocked, written: [] };
  const started = attempt || await journal.start(recordId, current.revision, changes, intentKey);
  await adapter.write(recordId, Object.fromEntries(changes.map((change) => [change.name, change.after])), current.revision);
  const readBack = await adapter.read(recordId);
  if (!changes.every((change) => isDeepStrictEqual(readBack.fields[change.name], change.after))) throw new Error('content write read-back mismatch');
  await journal.complete(started);
  return { recordId, blocked, written: changes.map((change) => change.name), contentRevision: readBack.revision };
}

module.exports = { classifyNavigation, occurrenceId, verifiedDestination, writerGuard, reconcileRecord };
