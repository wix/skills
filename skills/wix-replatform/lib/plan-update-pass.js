'use strict';

// The update pass: the plan changed after records were imported (a prefix added to product
// names, a different value map). For each record this task already imported on this site, the
// pass compares the plan rows the record was written with against the current rows, and sends
// only the outputs whose rows changed. It never creates: a record is found through its crosswalk
// row, so it cannot duplicate.
//
// - Which plan wrote a record: runRecordTask stamps `planRowsDigest` on each `imported` journal
//   row and keeps those rows in execution/plan-rows/<digest>.json. A record imported before that
//   stamp uses the caller's `baselinePlan`; with neither, it is listed, never guessed.
// - Journal rules as for creates: a `started` row before each send and a terminal row after it.
//   The rows go to their own journal (execution/plan-update-journal.ndjson), so a failed patch
//   never makes an imported record look missing in the import journal. An update is the same
//   patch every time, so one with an unknown outcome is simply sent again on the next pass.
// - Every record the pass could not bring up to date, and every output the plan stopped writing,
//   becomes a structured cutover task (reportRows, joined into completion-report operatorActions).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readiness = require('./dependency-readiness');
const capability = require('./execution-capability');
const local = require('./local-state');
const { readEntityMappings } = require('./website-handoff');
const { recordPath } = require('./writer-request-shape');

const ROWS_DIR = 'execution/plan-rows';
const JOURNAL = 'execution/plan-update-journal.ndjson';
const SUMMARY = 'execution/plan-update.json';
const UNKNOWN_OUTCOME = new Set(['started', 'succeeded_unverified']);
// What changes the written value. Prose (reason, evidence, examples) and read-back paths do not.
const ROW_FIELDS = ['sourcePaths', 'disposition', 'transform', 'valuePolicy', 'appliesWhen'];
const OUTPUT_FIELDS = ['sourcePaths', 'targetRef', 'writeOperation', 'writeInput', 'targetPath', 'appliesWhen'];

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
const pick = (object, fields) => Object.fromEntries(fields.filter(f => object?.[f] !== undefined).map(f => [f, object[f]]));
const at = (record, dotted) => String(dotted).split('.').reduce((value, key) => value?.[key], record);
function setAt(body, dotted, value) {
  const keys = String(dotted).split('.'), last = keys.pop();
  let cursor = body;
  for (const key of keys) cursor = cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : (cursor[key] = {});
  cursor[last] = value;
}

// The task binding's entity in the plan (the same row runRecordTask's hierarchy reads).
function entityPlanOf(plan, binding) {
  return readEntityMappings(plan || {}).find(row => row.sourceEntity === binding.sourceEntity && (row.targetRef || binding.ref) === binding.ref) || null;
}
// One fingerprint per written field (its record path): every row and output that writes it.
// An excluded or unresolved row writes nothing, so it has no fingerprint.
function outputFingerprints(entityPlan) {
  const parts = new Map();
  for (const row of entityPlan?.fieldMappings || []) {
    if (['excluded', 'unresolved', 'deferred'].includes(row.disposition)) continue;
    for (const output of row.outputs || []) {
      const field = recordPath(output);
      if (typeof field !== 'string' || !field) continue;
      parts.set(field, [...(parts.get(field) || []), canonical({ row: pick(row, ROW_FIELDS), output: pick(output, OUTPUT_FIELDS) })]);
    }
  }
  return new Map([...parts].map(([field, list]) => [field, sha(list.sort().join('\n')).slice(0, 16)]));
}
function planRowsDigest(entityPlan) {
  return sha(canonical([...outputFingerprints(entityPlan)].sort(([a], [b]) => a.localeCompare(b)))).slice(0, 24);
}
// Keep the rows a record was written with, once per digest, so a later pass can compare.
function rememberPlanRows(projectDir, entityPlan) {
  if (!entityPlan) return null;
  const digest = planRowsDigest(entityPlan), file = path.join(projectDir, ROWS_DIR, `${digest}.json`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, digest, sourceEntity: entityPlan.sourceEntity, targetRef: entityPlan.targetRef, outputs: Object.fromEntries(outputFingerprints(entityPlan)) }, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }
  return digest;
}
function rememberedOutputs(projectDir, digest) {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(projectDir, ROWS_DIR, `${digest}.json`), 'utf8')).outputs)); }
  catch { return null; }
}
// Fields whose rows changed or were added, and fields the plan no longer writes.
function changedOutputs(before, after) {
  const changed = [...after].filter(([field, print]) => before.get(field) !== print).map(([field]) => field).sort();
  const removed = [...before.keys()].filter(field => !after.has(field)).sort();
  return { changed, removed };
}
// The changed fields out of the built body. The body may be the record itself or a request that
// wraps it under one key ({ category: {...} }); the root where most fields resolve is used.
function patchOf(payload, fields) {
  const roots = [{ prefix: null, body: payload }, ...Object.entries(payload && typeof payload === 'object' ? payload : {})
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)).map(([prefix, body]) => ({ prefix, body }))];
  const score = root => fields.filter(field => at(root.body, field) !== undefined).length;
  const root = roots.reduce((best, candidate) => (score(candidate) > score(best) ? candidate : best), roots[0]);
  const patch = {}, omitted = [];
  for (const field of fields) { const value = at(root.body, field); if (value === undefined) omitted.push(field); else setAt(patch, field, value); }
  return { patch: root.prefix ? { [root.prefix]: patch } : patch, omitted };
}
function sentOutcome(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408) return { status: status === 429 ? 'failed_retryable' : 'failed_terminal', httpStatus: status };
  return { status: 'succeeded_unverified', httpStatus: Number.isInteger(status) ? status : null };
}

function readJournal(projectDir) {
  try { return fs.readFileSync(path.join(projectDir, JOURNAL), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function appendJournal(projectDir, row) {
  local.validateAttemptRow(row);
  fs.mkdirSync(path.join(projectDir, 'execution'), { recursive: true });
  fs.appendFileSync(path.join(projectDir, JOURNAL), JSON.stringify(row) + '\n');
  return row;
}
function readSummary(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, SUMMARY), 'utf8')); } catch { return { schemaVersion: 1, tasks: {} }; }
}
function writeSummary(projectDir, taskId, entry) {
  const summary = readSummary(projectDir);
  summary.tasks = { ...(summary.tasks || {}), [taskId]: entry };
  const file = path.join(projectDir, SUMMARY), tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(summary, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

async function runPlanUpdatePassUnlocked({
  taskBinding, wix, bindRecord, sourceEntity, records, build, update, baselinePlan,
  batchSize = 50, stopRequested = () => false, isInterruption = error => require('./wix-auth').isRunInterruption(error),
} = {}) {
  if (typeof build !== 'function') throw new Error('runPlanUpdatePass requires build');
  if (update !== undefined && typeof update !== 'function') throw new Error('runPlanUpdatePass: update must be a function');
  const ctx = capability.requireKind(taskBinding, 'import-task');
  const { projectDir, runId, siteId, task, taskId } = ctx;
  if (ctx.dryRun === true) return { taskId, status: 'dry-run', counts: {} };
  const bindings = (task.sourceBindings || []).filter(binding => binding.role !== 'source-archive' && (!sourceEntity || binding.sourceEntity === sourceEntity));
  if (bindings.length !== 1) throw new Error(`runPlanUpdatePass: task ${taskId} needs exactly one source binding${sourceEntity ? ` for ${sourceEntity}` : ''} (found ${bindings.length}); pass sourceEntity`);
  const [binding] = bindings, ref = binding.ref, keyField = binding.keyField || 'id';
  const keyOf = record => `${binding.keyPrefix}${at(record, keyField)}`;
  const entityPlan = entityPlanOf(ctx.plan, binding);
  const counts = { imported: 0, upToDate: 0, updated: 0, notApplied: 0, failed: 0, unresolved: 0, unknownBaseline: 0 };
  if (!entityPlan) return { taskId, status: 'no-plan-rows', counts };
  const current = outputFingerprints(entityPlan), toDigest = rememberPlanRows(projectDir, entityPlan);
  const baseline = baselinePlan ? outputFingerprints(entityPlanOf(baselinePlan, binding)) : null;
  const bind = bindRecord || ((grant, key) => require('../resources/rp-target-wix/lib/wix-writers').bindRecordClient(wix, { readinessGrant: grant, sourceStableKey: key }));

  const attempts = (await local.loadAttemptJournal(projectDir).catch(error => { if (error.code === 'ENOENT' || error.code === 'JOURNAL_MISSING') return { rows: [] }; throw error; })).rows;
  const importedRow = new Map(), latestAttempt = new Map();
  for (const row of attempts) {
    if (row?.writeSpecId !== taskId) continue;
    latestAttempt.set(row.sourceStableKey, row);
    if (row.status === 'imported') importedRow.set(row.sourceStableKey, row);
  }
  const updates = new Map();
  for (const row of readJournal(projectDir)) if (row.writeSpecId === taskId && row.siteId === siteId) updates.set(row.sourceStableKey, row);
  const crosswalk = await local.loadCrosswalk(projectDir);

  // What each landed record was written with, and what changed since.
  const queue = [], unknown = [], removed = new Set(), notApplied = [], omitted = [];
  const all = records || fs.readFileSync(path.join(projectDir, binding.extractPath), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const record of all) {
    const key = keyOf(record), landed = crosswalk.bySource[key];
    if (!landed || landed.status !== 'imported' || (landed.siteId && landed.siteId !== siteId)) continue;
    counts.imported += 1;
    const lastUpdate = updates.get(key);
    const fromDigest = lastUpdate?.status === 'imported' ? lastUpdate.toDigest : importedRow.get(key)?.planRowsDigest;
    const before = (fromDigest && rememberedOutputs(projectDir, fromDigest)) || baseline;
    if (!before) { counts.unknownBaseline += 1; unknown.push(key); continue; }
    const diff = changedOutputs(before, current);
    for (const field of diff.removed) removed.add(field);
    if (!diff.changed.length) { counts.upToDate += 1; continue; }
    queue.push({ record, key, targetId: String(landed.targetId), fields: diff.changed, fromDigest: fromDigest || 'baseline-plan' });
  }
  const skip = (key, reason, fields) => { counts.notApplied += 1; notApplied.push({ sourceStableKey: key, reason, fields }); };

  let stopped = false;
  if (!update) for (const item of queue) skip(item.key, 'no-update-writer', item.fields);
  else for (let offset = 0; offset < queue.length && !stopped; offset += batchSize) {
    if (stopRequested()) { stopped = true; break; }
    const batch = queue.slice(offset, offset + batchSize), byKey = new Map(batch.map(item => [item.key, item]));
    const evaluation = await readiness.evaluateTask({ taskBinding });
    if (!evaluation.ok) { for (const item of batch) skip(item.key, 'dependency-not-ready', item.fields); continue; }
    // The same gate as a create: references resolve through it and a builder hold stays held.
    const gated = await readiness.gateBatch({ evaluation, records: batch.map(item => ({ sourceStableKey: item.key, transform: resolvers => build(item.record, resolvers) })) });
    for (const row of gated.defer) {
      const item = byKey.get(row.sourceStableKey);
      skip(item.key, row.deferral?.reason || 'deferred', item.fields);
      // The gate journals its deferral in the import journal; the record is still imported there.
      const prior = latestAttempt.get(item.key);
      if (prior?.status === 'imported') await local.appendAttempt(projectDir, { ...prior, attemptId: crypto.randomUUID(), ts: new Date().toISOString() });
    }
    for (const sent of gated.send) {
      if (stopRequested()) { stopped = true; break; }
      const item = byKey.get(sent.sourceStableKey), key = item.key;
      let recordClient;
      try { recordClient = bind(gated.grant, key); }
      catch (error) { if (error?.code !== 'DEPENDENCY_READINESS_REQUIRED') throw error; skip(key, 'readiness-grant-refused', item.fields); continue; }
      const { patch, omitted: empty } = patchOf(sent.payload, item.fields);
      // A field the new plan leaves empty for this record is not cleared on the site.
      if (empty.length) omitted.push({ sourceStableKey: key, fields: empty });
      const fields = item.fields.filter(field => !empty.includes(field));
      if (!fields.length) continue;
      const row = (status, extra = {}) => ({ schemaVersion: 1, attemptId: crypto.randomUUID(), sourceStableKey: key, writeSpecId: taskId, operation: 'plan-update', targetEntityType: ref,
        status, runId, phase: 'plan-update', ts: new Date().toISOString(), siteId, targetId: item.targetId, fromDigest: item.fromDigest, toDigest, fields, ...extra });
      const prior = updates.get(key);
      const started = appendJournal(projectDir, row('started', prior && UNKNOWN_OUTCOME.has(prior.status) ? { resendOf: prior.attemptId } : {}));
      try {
        const result = await update(recordClient, { targetId: item.targetId, patch, fields, payload: sent.payload, record: item.record });
        appendJournal(projectDir, { ...row('imported'), attemptId: started.attemptId, ...(result?.revision !== undefined ? { targetRevision: String(result.revision) } : {}) });
        counts.updated += 1;
      } catch (error) {
        if (isInterruption(error)) throw error;
        const outcome = error?.requestSent === false ? { status: 'failed_retryable', httpStatus: null } : sentOutcome(error);
        appendJournal(projectDir, { ...row(outcome.status), attemptId: started.attemptId, failure: { sourceId: key, targetEntityId: item.targetId, scopeGroupName: null, operation: 'plan-update', errorCode: String(error?.code || 'update-failed'),
          outcome: outcome.status === 'succeeded_unverified' ? 'unresolved' : outcome.status, httpStatus: outcome.httpStatus, message: String(error?.message || 'update failed').slice(0, 300) } });
        if (outcome.status === 'succeeded_unverified') counts.unresolved += 1; else counts.failed += 1;
        notApplied.push({ sourceStableKey: key, reason: outcome.status === 'succeeded_unverified' ? 'update-outcome-unknown' : 'update-failed', fields });
      }
    }
  }
  if (stopped) for (const item of queue) if (!notApplied.some(row => row.sourceStableKey === item.key) && !updates.has(item.key)) skip(item.key, 'stopped', item.fields);
  const changedFields = [...new Set(queue.flatMap(item => item.fields))].sort();
  writeSummary(projectDir, taskId, { taskId, ref, siteId, runId, toDigest, changedFields, removedFields: [...removed].sort(), counts,
    notApplied: notApplied.sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey)), unknownBaseline: unknown.sort(),
    leftEmpty: omitted.sort((a, b) => a.sourceStableKey.localeCompare(b.sourceStableKey)), finishedAt: new Date().toISOString() });
  const status = stopped ? 'stopped' : notApplied.length || unknown.length ? 'incomplete' : 'complete';
  return { taskId, status, counts, changedFields, removedFields: [...removed].sort() };
}

const slug = value => String(value).toLowerCase().replace(/[^a-z0-9:._/-]+/g, '-');
const ndjson = file => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch { return []; } };
// A plan change the pass has not run for, found without the pass: each imported record's last
// plan stamp (import journal, then this pass's own journal) against the current plan's rows.
// The pass's summary covers a task only when it ran for the current rows.
function unappliedWithoutPass(projectDir, summary) {
  let plan;
  try { plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8')); } catch { return []; }
  const last = new Map(), id = row => `${row.writeSpecId}\u0000${row.sourceStableKey}`;
  for (const row of ndjson(require('./local-state').attemptJournalPath(projectDir))) if (row?.status === 'imported' && row.planRowsDigest) last.set(id(row), { task: row.writeSpecId, key: row.sourceStableKey, digest: row.planRowsDigest });
  for (const row of ndjson(path.join(projectDir, JOURNAL))) if (row?.status === 'imported' && row.toDigest && last.has(id(row))) last.get(id(row)).digest = row.toDigest;
  const byTask = new Map(), current = new Map();
  for (const { task, key, digest } of last.values()) {
    if (!current.has(digest)) {
      let snap = null;
      try { snap = JSON.parse(fs.readFileSync(path.join(projectDir, ROWS_DIR, `${digest}.json`), 'utf8')); } catch { /* no snapshot: the pass lists it as an unknown baseline */ }
      const entityPlan = snap && entityPlanOf(plan, { sourceEntity: snap.sourceEntity, ref: snap.targetRef });
      current.set(digest, entityPlan ? { ref: snap.targetRef, to: planRowsDigest(entityPlan), fields: changedOutputs(new Map(Object.entries(snap.outputs || {})), outputFingerprints(entityPlan)) } : null);
    }
    const now = current.get(digest);
    if (!now || now.to === digest || summary.tasks?.[task]?.toDigest === now.to) continue;
    const entry = byTask.get(task) || { task, ref: now.ref, ids: [], fields: new Set() };
    entry.ids.push(key);
    for (const field of [...now.fields.changed, ...now.fields.removed]) entry.fields.add(field);
    byTask.set(task, entry);
  }
  return [...byTask.values()];
}
// The cutover tasks a plan change after import leaves, in the structured operatorAction shape.
function reportRows(projectDir) {
  const summary = readSummary(projectDir), operatorActions = [];
  for (const entry of unappliedWithoutPass(projectDir, summary)) {
    const fields = [...entry.fields].sort();
    operatorActions.push({ actionId: slug(`plan-update-not-applied:${entry.task}:pass-not-run`), code: 'plan-update-not-applied', role: 'import-operator', severity: 'high', entity: entry.task,
      affectedCount: entry.ids.length, affectedIds: entry.ids.sort(),
      action: `The plan changed after these ${entry.ref} records were imported, and the update pass has not run for the current plan, so the change is not on the site yet (fields: ${fields.join(', ') || 'none written'}; reasons: pass-not-run). The records still show the old values.`,
      deadlineReason: 'Resolve before launch; the site shows values the current plan no longer writes.',
      importOperatorPrompt: `Requires Import Operator. In the original migration project, run task ${entry.task} again (runRecordTask runs the update pass for records already imported), or run runPlanUpdatePass for it. It sends only the changed fields and never creates records.`,
      artifactRefs: ['mapping/mapping-plan.json', ROWS_DIR, JOURNAL], prerequisites: ['original migration project', 'current-site access'],
      resolutionEvidence: `${SUMMARY} tasks.${entry.task}.toDigest matches the current plan rows, or each record's last plan stamp does` });
  }
  for (const entry of Object.values(summary.tasks || {})) {
    const task = entry.taskId, prompt = action => `Requires Import Operator. In the original migration project, ${action} Then run the update pass for task ${task} again (runPlanUpdatePass); it sends only the changed fields and never creates records.`;
    const refs = [SUMMARY, JOURNAL];
    if (entry.notApplied?.length) {
      const reasons = [...new Set(entry.notApplied.map(row => row.reason))].sort();
      operatorActions.push({ actionId: slug(`plan-update-not-applied:${task}`), code: 'plan-update-not-applied', role: 'import-operator', severity: 'high', entity: task,
        affectedCount: entry.notApplied.length, affectedIds: entry.notApplied.map(row => row.sourceStableKey),
        action: `The plan changed after these ${entry.ref} records were imported, and the change is not on the site yet (fields: ${[...new Set(entry.notApplied.flatMap(row => row.fields))].sort().join(', ')}; reasons: ${reasons.join(', ')}). The records still show the old values.`,
        deadlineReason: 'Resolve before launch; the site shows values the current plan no longer writes.',
        importOperatorPrompt: prompt(`read ${SUMMARY} tasks.${task}.notApplied and fix each reason (${reasons.join(', ')}).`),
        artifactRefs: refs, prerequisites: ['original migration project', 'current-site access'], resolutionEvidence: `${SUMMARY} tasks.${task}.notApplied is empty after a new pass` });
    }
    if (entry.unknownBaseline?.length) operatorActions.push({ actionId: slug(`plan-update-baseline-unknown:${task}`), code: 'plan-update-baseline-unknown', role: 'import-operator', severity: 'high', entity: task,
      affectedCount: entry.unknownBaseline.length, affectedIds: entry.unknownBaseline,
      action: `These ${entry.ref} records were imported before the toolkit recorded which plan wrote them, so the update pass cannot tell which of their fields the plan change affects. They were not updated.`,
      deadlineReason: 'Resolve before launch; these records may show values the current plan no longer writes.',
      importOperatorPrompt: prompt('find the mapping plan these records were imported with (git history of mapping/mapping-plan.json or the run backup) and pass it as baselinePlan.'),
      artifactRefs: refs, prerequisites: ['original migration project', 'the mapping plan used for the first import'], resolutionEvidence: `${SUMMARY} tasks.${task}.unknownBaseline is empty after a new pass` });
    // Default: values are never cleared on the site by a plan change (no silent loss).
    const empty = [...new Set([...(entry.removedFields || []), ...(entry.leftEmpty || []).flatMap(row => row.fields)])].sort();
    if (empty.length) operatorActions.push({ actionId: slug(`plan-update-values-kept:${task}`), code: 'plan-update-values-kept', role: 'cutover-operator', severity: 'low', entity: task,
      affectedCount: entry.leftEmpty?.length ? entry.leftEmpty.length : entry.counts?.imported || 0, ...(entry.leftEmpty?.length ? { affectedIds: entry.leftEmpty.map(row => row.sourceStableKey) } : {}),
      action: `The current plan no longer writes ${empty.join(', ')} on ${entry.ref}${entry.leftEmpty?.length ? ' for the listed records' : ''}, but the values imported earlier are still on the site; the toolkit does not clear them. If they should go, clear them in Business Manager.`,
      deadlineReason: 'Review before launch; old values stay visible until cleared.',
      artifactRefs: refs, prerequisites: ['Business Manager access'], resolutionEvidence: 'The fields are cleared in Business Manager, or the owner keeps them' });
    if (entry.counts?.updated) operatorActions.push({ actionId: slug(`plan-update-applied:${task}:${entry.toDigest}`), code: 'plan-update-applied', role: 'cutover-operator', severity: 'low', entity: task,
      affectedCount: entry.counts.updated,
      action: `The plan changed after import; ${entry.counts.updated} ${entry.ref} records were updated on the site (fields: ${entry.changedFields.join(', ')}). Spot-check a few in Business Manager.`,
      deadlineReason: 'For review; no action needed unless a value looks wrong.',
      artifactRefs: refs, resolutionEvidence: `${JOURNAL} rows with status imported for task ${task}` });
  }
  return { operatorActions };
}

module.exports = { runPlanUpdatePassUnlocked, reportRows, outputFingerprints, planRowsDigest, rememberPlanRows, changedOutputs, patchOf, entityPlanOf, JOURNAL, SUMMARY, ROWS_DIR };
