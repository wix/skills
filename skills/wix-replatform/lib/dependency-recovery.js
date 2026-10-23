'use strict';

// A prerequisite deferral owns recovery until a confirmed terminal success. Admission,
// retries and uncertain writes preserve its lineage; never infer success from disappearance
// of the latest row's `deferral` field. This reducer is shared by runtime and cutover.
function createRecoveryIndex(siteId) { return { siteId, byTask: new Map() }; }
function applyRecoveryAttempt(index, row) {
  if (row.siteId && index.siteId && row.siteId !== index.siteId) return;
  let task = index.byTask.get(row.writeSpecId);
  if (row.status === 'deferred' && row.deferral) {
    if (!task) { task = new Map(); index.byTask.set(row.writeSpecId, task); }
    task.set(row.sourceStableKey, { sourceStableKey: row.sourceStableKey, deferral: structuredClone(row.deferral), latestStatus: row.status });
  } else if (task?.has(row.sourceStableKey)) {
    if (['imported', 'skipped_already_imported'].includes(row.status) && (!index.siteId || row.siteId === index.siteId)) {
      task.delete(row.sourceStableKey); if (!task.size) index.byTask.delete(row.writeSpecId);
    } else task.get(row.sourceStableKey).latestStatus = row.status;
  }
}
function waitingForTask(index, taskId) { return [...(index.byTask.get(taskId)?.values() || [])].map(row => structuredClone(row)); }
function foldRecoveryAttempts(rows, siteId) { const index = createRecoveryIndex(siteId); for (const row of rows) applyRecoveryAttempt(index, row); return index; }
module.exports = { createRecoveryIndex, applyRecoveryAttempt, waitingForTask, foldRecoveryAttempts };
