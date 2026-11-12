'use strict';

// The per-record import pass every store shares. Generated code supplies only the
// store-specific parts -- `build` (the reviewed pure mapping), `send` (the reviewed writer call)
// and, where the target can be searched, `reconcile` -- and this runner does the rest the same
// way for every store:
//
// - A decided builder hold (`{ status: 'held', holds }`) is deferred by the gate with its reasons
//   and never sent; it cannot crash the pass or make the batch's grants stale.
// - A same-entity tree (target knowledge `sameTaskReferenceFields`, e.g. a category's
//   `parentCategory.id`) runs one depth level at a time, parents first. The parent's source field
//   comes from the accepted mapping output for that target path, and its Wix id only from the
//   gate's same-task resolver, i.e. from this task's own landed crosswalk row. A child whose
//   parent did not land (missing, failed, held, on a cycle) still imports, without the parent
//   link, recorded as a finding and a cutover item. It is never held or refused for it.
// - An earlier attempt whose outcome is unknown (`started` with no terminal row, or
//   `succeeded_unverified`) is looked up first and adopted when exactly one match is found.
//   Otherwise it is created; when the lookup could not rule the earlier write out, the possible
//   duplicate is recorded as a finding and a cutover item. It is never parked.
// - Every attempted record leaves a terminal journal row. A refusal before any byte left is a
//   known non-write; an error after the request may have left is unresolved, never a failure, so
//   a resume reads it back instead of creating a duplicate.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readiness = require('./dependency-readiness');
const capability = require('./execution-capability');
const local = require('./local-state');
const { builderHold } = require('./read-back-contract');
const { readEntityMappings } = require('./website-handoff');
const { depthLevels } = require('../resources/rp-target-wix/lib/same-entity-hierarchy');

const UNKNOWN_OUTCOME = new Set(['started', 'succeeded_unverified']);

function at(record, dotted) { return String(dotted).split('.').reduce((value, key) => value?.[key], record); }
function setAt(body, dotted, value) {
  const keys = String(dotted).split('.'), last = keys.pop();
  let cursor = body;
  for (const key of keys) cursor = cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : (cursor[key] = {});
  cursor[last] = value;
}
const noParent = value => value === undefined || value === null || value === '' || value === 0 || value === '0';

// Target stores whose records can be found again by what was sent. Each returns
// { targetId } when exactly one match exists, null only when none can exist, undefined when it
// cannot tell.
const RECONCILERS = {
  'stores/category': async (recordClient, payload) => {
    const writers = require('../resources/rp-target-wix/lib/wix-writers');
    const want = payload?.category || payload || {};
    const parent = want.parentCategory?.id || null;
    const named = (await writers.queryAllStoresCategories(recordClient)).filter(c => c.name === want.name);
    const hits = named.filter(c => (c.parentCategory?.id || null) === parent);
    if (hits.length === 1) return { targetId: hits[0].id };
    // Absence is proven only when no category has this name: a same-name category under another
    // parent may be this record written earlier without its link.
    return named.length ? undefined : null;
  },
};

// The one same-task parent field of this task's entity, and the source path the accepted mapping
// feeds it from. No mapped source path means the records are written flat (no parent is sent).
// Two mapped source fields cannot be ordered: the records are written flat and each record with a
// parent value is recorded as unlinked (`ambiguous` lists the candidates).
function hierarchyOf(task, binding, plan) {
  const fields = readiness.sameTaskReferenceFields(task.entityRefs).filter(field => field.ref === binding.ref);
  if (!fields.length) return null;
  const row = readEntityMappings(plan || {}).find(row => row.sourceEntity === binding.sourceEntity && (row.targetRef || binding.ref) === binding.ref);
  const mapped = [];
  for (const field of fields) for (const decision of row?.fieldMappings || []) for (const output of decision.outputs || []) {
    if (output.targetRef !== field.ref || ![output.targetPath, [output.writeInput, output.targetPath].filter(Boolean).join('.')].includes(field.template)) continue;
    const sourcePath = (output.sourcePaths || decision.sourcePaths || [])[0];
    if (sourcePath) mapped.push({ ...field, sourcePath });
  }
  const unique = [...new Map(mapped.map(field => [`${field.template}\u0000${field.sourcePath}`, field])).values()];
  if (unique.length > 1) return { ambiguous: unique };
  return unique[0] || null;
}

function readExtract(projectDir, extractPath) {
  return fs.readFileSync(path.join(projectDir, extractPath), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function failure(key, operation, { errorCode, outcome, message, httpStatus = null, targetEntityId = null }) {
  return { sourceId: key, targetEntityId, operation, httpStatus, errorCode, scopeGroupName: null, outcome, message };
}
// After a request may have left: a 4xx other than 408/429 was rejected and not applied; a 429 was
// not applied; anything else (5xx, timeout, reset) may have landed and is unresolved.
function sentOutcome(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408) return { status: status === 429 ? 'failed_retryable' : 'failed_terminal', httpStatus: status };
  return { status: 'succeeded_unverified', httpStatus: Number.isInteger(status) ? status : null };
}

async function runRecordTask({
  taskBinding, wix, sourceEntity, records, sourceSystem, build, send, reconcile,
  operation, batchSize = 50, stopRequested = () => false, selectionMode = 'full', recordFilter = () => true,
  bindRecord, isInterruption = error => require('./wix-auth').isRunInterruption(error),
} = {}) {
  if (typeof build !== 'function' || typeof send !== 'function') throw new Error('runRecordTask requires build and send');
  if (typeof sourceSystem !== 'string' || !sourceSystem) throw new Error('runRecordTask requires sourceSystem (the crosswalk source system)');
  if (!wix && typeof bindRecord !== 'function') throw new Error('runRecordTask requires wix (the task client) or bindRecord');
  const ctx = capability.requireKind(taskBinding, 'import-task');
  const { projectDir, runId, siteId, task, taskId } = ctx, dryRun = ctx.dryRun === true;
  const bindings = (task.sourceBindings || []).filter(binding => binding.role !== 'source-archive' && (!sourceEntity || binding.sourceEntity === sourceEntity));
  if (bindings.length !== 1) throw new Error(`runRecordTask: task ${taskId} needs exactly one source binding${sourceEntity ? ` for ${sourceEntity}` : ''} (found ${bindings.length}); pass sourceEntity`);
  const [binding] = bindings, ref = binding.ref, keyField = binding.keyField || 'id';
  const op = operation || (typeof task.writeOperations?.[ref] === 'string' ? task.writeOperations[ref] : 'create');
  const keyOf = record => `${binding.keyPrefix}${at(record, keyField)}`;
  const bind = bindRecord || ((grant, key) => require('../resources/rp-target-wix/lib/wix-writers').bindRecordClient(wix, { readinessGrant: grant, sourceStableKey: key }));
  const findExisting = reconcile || RECONCILERS[ref];
  const journalOptions = dryRun ? { sample: true } : {};
  const row = (key, status, extra = {}) => ({ schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: key, writeSpecId: taskId, operation: op, targetEntityType: ref, status, runId, phase: 'import', ts: new Date().toISOString(), siteId, ...extra });
  const journal = value => local.appendAttempt(projectDir, value, journalOptions);
  const counts = { attempted: 0, imported: 0, alreadyPresent: 0, deferred: 0, failed: 0, unresolved: 0 };
  const defer = async (key, reason, extra = {}) => { counts.deferred += 1; await journal(row(key, 'deferred', { deferral: { reason, ...extra } })); };
  const landed = async (key, record, result, attemptId, findings) => {
    if (!dryRun) await local.appendCrosswalkRow(projectDir, { schemaVersion: 1, sourceSystem, sourceEntityType: binding.sourceEntity, sourceId: String(at(record, keyField)), sourceStableKey: key,
      targetSystem: 'wix', targetEntityType: ref, targetId: String(result.targetId), status: 'imported', updatedAt: new Date().toISOString(),
      ...(result.revision !== undefined ? { targetRevision: String(result.revision) } : {}), ...(result.crosswalkExtra || {}) });
    counts.imported += 1;
    await journal(row(key, 'imported', { attemptId, targetId: String(result.targetId), findings }));
  };

  // A recorded loss on a landed record becomes a cutover item (completion report
  // `dependency-reference-gap`), so it is never only a line in the journal.
  const recordFindingGap = async (key, finding, targetId) => {
    if (finding.code === 'same-task-parent-unlinked') await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: finding.reason,
      action: `These ${ref} records were imported without their parent link (${finding.reason}). Once each parent exists on the site, set it as the record's parent (${tree?.template || 'the parent field'}), then confirm the hierarchy in Business Manager.`,
      detail: { targetId, ...(finding.parentSourceKey ? { parentSourceKey: finding.parentSourceKey } : {}) } });
    if (finding.code === 'unknown-outcome-recreated') await readiness.recordTaskGap({ taskBinding, sourceStableKey: key, code: 'possible-duplicate-after-unknown-outcome',
      action: `An earlier create of each of these ${ref} records had no recorded outcome and could not be ruled out, so it was created again. Look for another ${ref} matching each source record on the site; if one exists, keep the listed targetId and delete the other.`,
      detail: { targetId, priorAttemptId: finding.priorAttemptId, lookup: finding.lookup } });
  };
  const all = records || readExtract(projectDir, binding.extractPath);
  const mapped = hierarchyOf(task, binding, ctx.plan), tree = mapped && !mapped.ambiguous ? mapped : null;
  const { levels, unplaceable } = tree ? depthLevels(all, { idOf: record => at(record, keyField), parentIdOf: record => at(record, tree.sourcePath) }) : { levels: [all], unplaceable: [] };
  // Why a record is written without its parent link, decided before it is built.
  const unlinked = new Map();
  for (const record of unplaceable) unlinked.set(keyOf(record), 'same-task-parent-cycle');
  if (mapped?.ambiguous) for (const record of all) if (mapped.ambiguous.some(field => !noParent(at(record, field.sourcePath)))) unlinked.set(keyOf(record), 'same-task-parent-field-ambiguous');
  if (unplaceable.length) levels.push(unplaceable);
  const parentKeyOf = record => (tree && !noParent(at(record, tree.sourcePath)) ? `${binding.keyPrefix}${at(record, tree.sourcePath)}` : null);
  const unlinkedFinding = (key, record) => unlinked.has(key) ? [{ code: 'same-task-parent-unlinked', reason: unlinked.get(key), ...(parentKeyOf(record) ? { parentSourceKey: parentKeyOf(record) } : {}) }] : [];

  const latest = local.foldAttemptsBySourceKey((await local.loadAttemptJournal(projectDir, journalOptions).catch(error => { if (error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING') return { rows: [] }; throw error; })).rows.filter(r => r.writeSpecId === taskId));
  let stopped = false;
  for (const level of levels) {
    for (let offset = 0; offset < level.length && !stopped; offset += batchSize) {
      if (stopRequested()) { stopped = true; break; }
      const crosswalk = dryRun ? { bySource: {} } : await local.loadCrosswalk(projectDir);
      const batch = [];
      for (const record of level.slice(offset, offset + batchSize)) {
        const key = keyOf(record);
        if (!recordFilter(key)) continue;
        const existing = crosswalk.bySource[key];
        if (existing && existing.status === 'imported' && (!existing.siteId || existing.siteId === siteId)) { counts.alreadyPresent += 1; await journal(row(key, 'skipped_already_imported', { targetId: existing.targetId })); continue; }
        batch.push(record);
      }
      if (!batch.length) continue;
      // One evaluation per batch: the previous level's rows have just landed.
      const evaluation = await readiness.evaluateTask({ taskBinding });
      if (!evaluation.ok) {
        const reason = `dependency-not-ready:${[...new Set(evaluation.blocked.map(b => b.ref))].sort().join(',')}`.slice(0, 200);
        for (const record of batch) await defer(keyOf(record), reason);
        continue;
      }
      const byKey = new Map(batch.map(record => [keyOf(record), record]));
      const gateRecords = records => readiness.gateBatch({ evaluation, records: records.map(record => ({ sourceStableKey: keyOf(record), transform: async resolvers => {
        const body = await build(record, resolvers);
        const parentKey = parentKeyOf(record);
        if (builderHold(body) || !parentKey || unlinked.has(keyOf(record))) return body;
        const parentId = resolvers.resolveSameTaskReference(ref, parentKey, tree.template);
        if (parentId !== undefined) setAt(body, tree.template, parentId);
        return body;
      } })) });
      const first = await gateRecords(batch);
      const sends = first.send.map(item => ({ item, grant: first.grant }));
      // A child whose parent has not landed (missing from the source, failed, held) is written
      // without the link in the same batch. Its parent's level already ran, so waiting gains nothing.
      const orphans = first.defer.filter(row => row.deferral?.dependencyState === 'same-task-parent-not-written');
      let deferred = first.defer.length - orphans.length;
      if (orphans.length) {
        for (const row of orphans) unlinked.set(row.sourceStableKey, 'same-task-parent-not-written');
        const second = await gateRecords(orphans.map(row => byKey.get(row.sourceStableKey)));
        sends.push(...second.send.map(item => ({ item, grant: second.grant })));
        deferred += second.defer.length;
      }
      counts.deferred += deferred; // the gate journals its own deferrals
      for (const { item, grant } of sends) {
        if (stopRequested()) { stopped = true; break; }
        const key = item.sourceStableKey, record = byKey.get(key);
        // Bind before any started row: a refused binding sends nothing and leaves no orphan row.
        let recordClient;
        try { recordClient = bind(grant, key); }
        catch (error) { if (error?.code !== 'DEPENDENCY_READINESS_REQUIRED') throw error; await defer(key, 'readiness-grant-refused'); continue; }
        const findings = unlinkedFinding(key, record);
        const prior = latest.get(key);
        if (prior && UNKNOWN_OUTCOME.has(prior.status) && !dryRun) {
          // Look it up; adopt exactly one match. Anything else creates: the record is never parked.
          let found;
          try { found = findExisting ? await findExisting(recordClient, item.payload, record) : undefined; } catch (error) { if (isInterruption(error)) throw error; found = undefined; }
          if (found && found.targetId) {
            await landed(key, record, found, prior.attemptId, [...findings, { code: 'adopted-after-read-back' }]);
            for (const finding of findings) await recordFindingGap(key, finding, String(found.targetId));
            continue;
          }
          if (found === null) {
            // The read proved the earlier request never landed: close it, then create.
            await journal(row(key, 'failed_retryable', { attemptId: prior.attemptId, requestSent: false, failure: failure(key, op, { errorCode: 'not-found-on-read-back', outcome: 'failed_retryable', message: 'read-back found no target; the earlier request did not land' }) }));
          } else {
            findings.push({ code: 'unknown-outcome-recreated', priorAttemptId: prior.attemptId, lookup: findExisting ? 'inconclusive' : 'no-reader' });
          }
        }
        const started = await journal(row(key, 'started'));
        counts.attempted += 1;
        if (dryRun) { await defer(key, 'dry-run-would-send'); continue; }
        try {
          const result = await send(recordClient, item.payload, record);
          if (!result || typeof result.targetId !== 'string' || !result.targetId) {
            counts.unresolved += 1;
            await journal(row(key, 'succeeded_unverified', { attemptId: started.attemptId, failure: failure(key, op, { errorCode: 'no-target-id', outcome: 'unresolved', message: 'write returned no target id' }) }));
            continue;
          }
          await landed(key, record, result, started.attemptId, [...findings, ...(result.findings || [])]);
          for (const finding of findings) await recordFindingGap(key, finding, String(result.targetId));
        } catch (error) {
          if (isInterruption(error)) throw error;
          if (error && error.requestSent === false) {
            counts.failed += 1;
            await journal(row(key, 'failed_retryable', { attemptId: started.attemptId, requestSent: false, failure: failure(key, op, { errorCode: error.code || 'refused-before-send', outcome: 'failed_retryable', message: 'refused before sending' }) }));
            continue;
          }
          const outcome = sentOutcome(error);
          if (outcome.status === 'succeeded_unverified') counts.unresolved += 1; else counts.failed += 1;
          await journal(row(key, outcome.status, { attemptId: started.attemptId, failure: failure(key, op, { errorCode: error?.code ? String(error.code) : null, httpStatus: outcome.httpStatus, outcome: outcome.status === 'succeeded_unverified' ? 'unresolved' : outcome.status, message: 'write failed' }) }));
        }
      }
    }
    if (stopped) break;
  }
  if (!stopped) await readiness.finishTaskPass({ taskBinding, selection: { mode: selectionMode } });
  const status = stopped ? 'stopped' : counts.failed || counts.unresolved || counts.deferred ? 'incomplete' : 'complete';
  return { taskId, sourceEntity: binding.sourceEntity, status, counts };
}

module.exports = { runRecordTask, RECONCILERS, hierarchyOf };
