'use strict';
// Operator waivers: import a record now without one link whose parent record did not land.
//
// A dependent record whose own parent is final (failed, unverified, not attempted, absent or
// owner-held) ends `dependency-parent-final` and is never written without its link by default.
// Its cutover task offers "fix and re-run" always, and "import now without the link" where target
// knowledge declares `dependencyFailureActions[ref]: 'offer-omit'`. On a `fix-only` link the
// cutover never offers that action; an explicit operator request is still honored after a clear
// warning, unless the target cannot hold the record without the link (`dependencyLinkRequired`),
// which is refused.
//
// A waiver names exact scopes: (site, task, dependent source key, ref, parent source key, parent
// status). It is used only while the parent still has that status; a parent that lands voids it and
// the record imports with its link. The gate applies a waiver through the existing omit path, so the
// landed record is listed in `omittedReferences` as written without the link.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = 'execution/link-waivers.json';
const DIAGNOSTIC = 'execution/dependency-readiness.json';
const nonEmpty = value => typeof value === 'string' && value.trim() !== '';
const scopeKey = row => [row.siteId, row.taskId, row.sourceStableKey, row.ref, row.dependencySourceKey, row.parentStatus].join('\n');

function readJson(projectDir, file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function readWaivers(projectDir) {
  const doc = readJson(projectDir, FILE, { schemaVersion: 1, waivers: [] });
  if (doc?.schemaVersion !== 1 || !Array.isArray(doc.waivers)) throw Object.assign(new Error('link waivers file invalid'), { code: 'dependency-link-waivers-invalid' });
  return doc;
}
// The gate's view: the current site's waivers, matched by exact scope.
function loadLinkWaivers(projectDir, siteId) {
  const byScope = new Map();
  for (const waiver of readWaivers(projectDir).waivers) if (waiver.siteId === siteId) byScope.set(scopeKey(waiver), waiver);
  return { match: scope => byScope.get(scopeKey({ siteId, ...scope })) || null, size: byScope.size };
}
function refuse(code, message, detail = {}) { return Object.assign(new Error(message), { code, detail }); }
// Records waivers for rows the gate currently projects as final (execution/dependency-readiness.json
// tasks[taskId].finalDeferrals). Every row is checked before anything is written.
function recordLinkWaiver({ projectDir, siteId, taskId, rows, decidedBy, reason, explicitRequest = false, warning = null, now = () => new Date().toISOString() }) {
  if (!projectDir || !nonEmpty(siteId) || !nonEmpty(taskId) || !Array.isArray(rows) || !rows.length) throw refuse('dependency-link-waiver-invalid', 'projectDir, siteId, taskId and at least one row are required');
  if (!nonEmpty(decidedBy) || !nonEmpty(reason)) throw refuse('dependency-link-waiver-invalid', 'decidedBy and reason are required: who chose to import without the link, and why');
  const task = readJson(projectDir, DIAGNOSTIC, { tasks: {} }).tasks?.[taskId];
  if (task?.siteId && task.siteId !== siteId) throw refuse('dependency-link-waiver-invalid', 'the diagnostic for this task belongs to another site');
  const finals = new Map((task?.finalDeferrals || []).map(row => [[row.sourceStableKey, row.ref, row.dependencySourceKey].join('\n'), row]));
  const accepted = [];
  for (const row of rows) {
    const current = finals.get([row.sourceStableKey, row.ref, row.dependencySourceKey].join('\n'));
    // Not final now: already imported, still able to land, or never deferred on this parent.
    if (!current) throw refuse('dependency-link-waiver-refused', `${row.sourceStableKey} is not waiting on a final ${row.ref} parent ${row.dependencySourceKey}; nothing to waive (it may already be imported, or its parent may still land)`, row);
    if (current.linkRequired) throw refuse('dependency-link-waiver-impossible', `${row.sourceStableKey} cannot exist on the target without its ${row.ref} link; fix ${row.dependencySourceKey} and re-run instead`, row);
    if (current.linkChoice !== 'offer-omit' && (explicitRequest !== true || !nonEmpty(warning))) throw refuse('dependency-link-waiver-refused', `importing ${row.sourceStableKey} without its ${row.ref} link changes money or meaning; it is done only on an explicit request after the warning was shown (explicitRequest and warning)`, row);
    accepted.push({ ...current, explicitRequest: current.linkChoice !== 'offer-omit' });
  }
  const doc = readWaivers(projectDir), byScope = new Map(doc.waivers.map(waiver => [scopeKey(waiver), waiver]));
  const recordedAt = now();
  for (const row of accepted) {
    const waiver = { id: crypto.randomUUID(), siteId, taskId, sourceStableKey: row.sourceStableKey, ref: row.ref, dependencySourceKey: row.dependencySourceKey, parentStatus: row.parentStatus, linkChoice: row.linkChoice, explicitRequest: row.explicitRequest, ...(row.explicitRequest ? { warning } : {}), decidedBy, reason, recordedAt };
    byScope.set(scopeKey(waiver), waiver);
  }
  doc.waivers = [...byScope.values()].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));
  const file = path.join(projectDir, FILE), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { recorded: accepted.length, waivers: accepted.map(row => ({ sourceStableKey: row.sourceStableKey, ref: row.ref, dependencySourceKey: row.dependencySourceKey, explicitRequest: row.explicitRequest })) };
}
module.exports = { FILE, loadLinkWaivers, recordLinkWaiver, readWaivers };
