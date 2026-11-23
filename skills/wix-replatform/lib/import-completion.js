'use strict';

// Builds the generic entity-completeness input for generated importers. The append-only attempt
// journal is authoritative: a task that was never reached gets one `skipped_unexpected` count per
// in-scope source key, and a record deferred by the readiness gate stays deferred until a later
// terminal row in the same run supersedes it. Source-archive-only tasks are deliberately excluded;
// they are durable preservation output, not mapped import entities. An entity the mapping plan
// deferred (executionScope.deferredEntities) has no task; it gets one row of its own, every
// extracted record deferred with reason `mapping-scope-deferred`.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const local = require('./local-state.js');
const { importVerificationKind } = require('./entity-verification.js');
const { valuesAt } = require('./source-location.js');

function sourceBindings(task) {
  return (task?.sourceBindings || []).filter(binding => binding && binding.role !== 'source-archive');
}

function mappedTaskRefs(task) {
  const bindings = sourceBindings(task);
  const refs = bindings.map(binding => binding.ref).filter(Boolean);
  return [...new Set(refs.length ? refs : (task?.entityRefs || []))];
}

async function readNdjson(projectDir, relativePath) {
  if (!relativePath) return [];
  const file = path.join(projectDir, relativePath);
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1} is not valid NDJSON: ${error.message}`); }
  });
}

function bindingRecords(recordsByTask, taskId, ref, binding) {
  const taskRecords = recordsByTask?.[taskId];
  if (taskRecords && !Array.isArray(taskRecords) && Array.isArray(taskRecords[ref])) return taskRecords[ref];
  if (Array.isArray(taskRecords)) return taskRecords;
  return null;
}

function sourceKey(binding, record) {
  const [value] = valuesAt(record, binding.keyField || 'id');
  return value === undefined || value === null ? null : `${binding.keyPrefix || ''}${value}`;
}

function latestRowsForTask(journalRows, runId, taskId, keys) {
  const wanted = new Set(keys);
  const latest = new Map();
  for (const row of journalRows || []) {
    if (!row || row.runId !== runId || row.writeSpecId !== taskId || !wanted.has(row.sourceStableKey)) continue;
    const previous = latest.get(row.sourceStableKey);
    latest.set(row.sourceStableKey, { latest: row, attempted: Boolean(previous?.attempted || row.status === 'started') });
  }
  return latest;
}

// Crosswalk row for a binding key. Some writers key their own rows by `<sourceSystem>:<entity>:<id>`
// (order history) rather than the binding's `keyPrefix + id`, so fall back to source entity + id.
function crosswalkLookup(crosswalk, bindings) {
  const byId = new Map();
  for (const row of Object.values(crosswalk?.bySource || {})) if (row?.sourceEntityType && row.sourceId != null) byId.set(`${row.sourceEntityType}\0${row.sourceId}`, row);
  return key => crosswalk?.bySource?.[key] || bindings.filter(b => b.sourceEntity && key.startsWith(b.keyPrefix || '')).map(b => byId.get(`${b.sourceEntity}\0${key.slice((b.keyPrefix || '').length)}`)).find(Boolean);
}

function classify(key, latest, crosswalk, siteId) {
  const entry = latest.get(key);
  const row = entry?.latest;
  if (row) {
    if (row.status === 'imported') return 'imported';
    if (row.status === 'skipped_already_imported') return 'alreadyPresentByCrosswalk';
    if (row.status === 'deferred') return 'deferred';
    if (row.status === 'needs_verification') return row.targetId ? 'unresolved' : 'deferred';
    if (row.status === 'failed_retryable' || row.status === 'failed_terminal') return 'failed';
    if (row.status === 'succeeded_unverified' || row.status === 'started') return 'unresolved';
    if (row.status === 'skipped_unexpected' || /^skipped_/.test(String(row.status || ''))) return 'unexpectedSkipped';
  }
  const existing = crosswalk(key);
  if (existing?.status === 'imported' && (!existing.siteId || existing.siteId === siteId)) return 'alreadyPresentByCrosswalk';
  return 'unexpectedSkipped';
}

async function ensureMissingRows({ projectDir, task, ref, keys, latest, crosswalk, siteId, runId, persist }) {
  for (const key of keys) {
    if (latest.has(key)) continue;
    const existing = crosswalk(key);
    const already = existing?.status === 'imported' && (!existing.siteId || existing.siteId === siteId);
    const row = { schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: key,
      writeSpecId: task.id, operation: task.writeOperations?.[ref] || 'create', targetEntityType: ref,
      status: already ? 'skipped_already_imported' : 'skipped_unexpected', runId, phase: 'import',
      ts: new Date().toISOString(), siteId, ...(already ? { targetId: existing.targetId } : { reason: 'task-not-attempted-in-run' }) };
    if (persist) await local.appendAttempt(projectDir, row);
    latest.set(key, { latest: row, attempted: false });
  }
}

function oneRow({ task, ref, extractedKeys, inScopeKeys, latest, crosswalk, siteId }) {
  const counts = { imported: 0, alreadyPresentByCrosswalk: 0, deferred: 0, failed: 0, unresolved: 0, unexpectedSkipped: 0, attempted: 0 };
  const wanted = new Set(inScopeKeys);
  for (const key of wanted) {
    const outcome = classify(key, latest, crosswalk, siteId);
    counts[outcome] += 1;
    if (latest.get(key)?.attempted) counts.attempted += 1;
  }
  return {
    entity: ref,
    subtype: 'all',
    extracted: extractedKeys.length,
    inScope: inScopeKeys.length,
    attempted: counts.attempted,
    imported: counts.imported,
    alreadyPresentByCrosswalk: counts.alreadyPresentByCrosswalk,
    deferred: counts.deferred,
    failed: counts.failed,
    unresolved: counts.unresolved,
    skippedOutOfScope: Math.max(0, extractedKeys.length - inScopeKeys.length),
    unexpectedSkipped: counts.unexpectedSkipped,
    verificationKind: importVerificationKind(ref, task),
    sourceKeys: inScopeKeys,
  };
}

/**
 * Return one journal-backed row for each mapped entity represented by an import task.
 * `recordsByTask` is an optional generated-code input for handlers that transform a combined
 * extract; when omitted the first source binding's extract is read from the project.
 * `inScopeKeysByTask` may be supplied when the accepted scope excludes records from the extract.
 * `plan` (the mapping plan) is read from mapping/mapping-plan.json when omitted.
 */
async function buildImportCompletenessRows({
  projectDir,
  manifest,
  runId,
  siteId = null,
  journalRows,
  crosswalk,
  recordsByTask = {},
  inScopeKeysByTask = {},
  persistUnattempted = true,
  dryRun = false,
  plan,
} = {}) {
  if (!projectDir || !manifest || typeof runId !== 'string' || !runId) throw new Error('buildImportCompletenessRows requires projectDir, manifest and runId');
  const journal = journalRows || (await local.loadAttemptJournal(projectDir).catch(error => error.code === 'ENOENT' ? { rows: [] } : Promise.reject(error))).rows;
  const cw = crosswalk || await local.loadCrosswalk(projectDir).catch(error => error.code === 'ENOENT' ? { bySource: {} } : Promise.reject(error));
  const rows = [];

  for (const task of (Array.isArray(manifest.tasks) ? manifest.tasks : []).filter(task => task?.kind === 'import')) {
    const bindings = sourceBindings(task);
    if (!bindings.length) continue;
    const refs = mappedTaskRefs(task);
    for (const ref of refs) {
      const refBindings = bindings.filter(binding => binding.ref === ref);
      const selectedBindings = refBindings.length ? refBindings : [bindings[0]];
      const extractedKeys = [];
      const extractedKeySet = new Set();
      for (const binding of selectedBindings) {
        const supplied = bindingRecords(recordsByTask, task.id, ref, binding);
        const loaded = supplied || await readNdjson(projectDir, binding.extractPath);
        for (const record of loaded) {
          const key = sourceKey(binding, record);
          if (key && !extractedKeySet.has(key)) {
            extractedKeySet.add(key);
            extractedKeys.push(key);
          }
        }
      }
      const suppliedScope = inScopeKeysByTask?.[task.id];
      const inScopeKeys = Array.isArray(suppliedScope?.[ref]) ? [...new Set(suppliedScope[ref])] : extractedKeys;
      const latest = latestRowsForTask(journal, runId, task.id, inScopeKeys);
      // Missing current-run rows are materialized in the same journal format when persistence is
      // enabled, and always represented in memory so counts remain complete in dry-run mode.
      const lookup = crosswalkLookup(cw, selectedBindings);
      await ensureMissingRows({ projectDir, task, ref, keys: inScopeKeys, latest, crosswalk: lookup, siteId, runId, persist: persistUnattempted && !dryRun });
      rows.push(oneRow({ task, ref, extractedKeys, inScopeKeys, latest, crosswalk: lookup, siteId }));
    }
  }
  rows.push(...await deferredEntityRows({ projectDir, manifest, plan, runId, siteId, journal, persist: persistUnattempted && !dryRun }));
  return rows;
}

const MAPPING_SCOPE_DEFERRED = 'mapping-scope-deferred';
async function readJson(projectDir, relativePath) {
  try { return JSON.parse(await fs.readFile(path.join(projectDir, relativePath), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// One row per entity the plan deferred, so entity QA finds a row for every mapped entity. The row
// is keyed by target ref with the source entity as subtype (two sources can share a target). Keys
// come from the plan entity's extract and its key column (the plan's primaryKey, else the extract
// manifest's identity column, else `id`). Each key gets one `deferred` journal row per run, so the
// count has its reason; nothing is sent. An entity with no extract gets a zero row: its count is on
// the plan's own mapping-scope-deferred cutover action. An entity a task already binds is skipped.
async function deferredEntityRows({ projectDir, manifest, plan, runId, siteId, journal, persist }) {
  const mapping = plan === undefined ? await readJson(projectDir, 'mapping/mapping-plan.json') : plan;
  const scope = mapping?.executionScope;
  const deferred = Array.isArray(scope?.deferredEntities) ? scope.deferredEntities : [];
  if (!deferred.length) return [];
  const bound = new Set((manifest.tasks || []).flatMap(task => (task?.sourceBindings || []).map(binding => binding?.sourceEntity)).filter(Boolean));
  const rows = [];
  for (const { entityRef, decisionIds } of deferred) {
    const entity = (mapping.entities || []).find(row => row && [row.entityKey, row.sourceEntityRef, row.sourceEntity].includes(entityRef));
    if (!entity?.targetRef || bound.has(entityRef)) continue;
    const extractPath = entity.sourceExtract?.ndjson;
    const manifestPath = entity.sourceExtract?.manifest;
    const keyField = entity.primaryKey || (manifestPath && (await readJson(projectDir, manifestPath))?.assembly?.identityColumn) || 'id';
    const keys = [...new Set((await readNdjson(projectDir, extractPath)).map(record => sourceKey({ keyField, keyPrefix: `${entityRef}:` }, record)).filter(Boolean))];
    const writeSpecId = `${MAPPING_SCOPE_DEFERRED}:${entityRef}`;
    const journaled = new Set((journal || []).filter(row => row?.runId === runId && row.writeSpecId === writeSpecId && row.status === 'deferred').map(row => row.sourceStableKey));
    for (const key of keys) {
      if (journaled.has(key)) continue;
      const row = { schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: key, writeSpecId, operation: 'none', targetEntityType: entity.targetRef,
        status: 'deferred', reason: MAPPING_SCOPE_DEFERRED, deferral: { reason: MAPPING_SCOPE_DEFERRED, final: true, sourceEntityRef: entityRef, decisionIds: decisionIds || [] },
        runId, phase: 'import', ts: new Date().toISOString(), ...(siteId ? { siteId } : {}) };
      if (persist) await local.appendAttempt(projectDir, row);
      if (journal) journal.push(row);
    }
    rows.push({ entity: entity.targetRef, subtype: entityRef, extracted: keys.length, inScope: keys.length, attempted: 0, imported: 0, alreadyPresentByCrosswalk: 0,
      deferred: keys.length, failed: 0, unresolved: 0, skippedOutOfScope: 0, unexpectedSkipped: 0, verificationKind: importVerificationKind(entity.targetRef), sourceKeys: keys });
  }
  return rows;
}

module.exports = { buildImportCompletenessRows, mappedTaskRefs, readNdjson, MAPPING_SCOPE_DEFERRED };
