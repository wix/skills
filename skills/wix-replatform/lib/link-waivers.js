'use strict';

// Per-record operator choice to import a dependent without a parent link. A waiver is scoped to
// the exact site, task, dependent key, parent key, and current parent status.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FILE = 'execution/link-waivers.json';
const DIAGNOSTIC = 'execution/dependency-readiness.json';
const nonEmpty = value => typeof value === 'string' && value.trim() !== '';
const scopeKey = row => [row.siteId, row.taskId, row.sourceStableKey, row.ref, row.dependencySourceKey, row.parentStatus].join('\n');
function readJson(projectDir, file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function readWaivers(projectDir) {
  const doc = readJson(projectDir, FILE, { schemaVersion: 1, waivers: [] });
  if (doc?.schemaVersion !== 1 || !Array.isArray(doc.waivers)) throw Object.assign(new Error('link waivers file invalid'), { code: 'dependency-link-waivers-invalid' });
  return doc;
}
function loadLinkWaivers(projectDir, siteId) {
  const byScope = new Map();
  for (const waiver of readWaivers(projectDir).waivers) if (waiver.siteId === siteId) byScope.set(scopeKey(waiver), waiver);
  return { match: scope => byScope.get(scopeKey({ siteId, ...scope })) || null };
}
function refuse(code, message, detail = {}) { return Object.assign(new Error(message), { code, detail }); }
function recordLinkWaiver({ projectDir, siteId, taskId, rows, decidedBy, reason, explicitRequest = false, warning = null, now = () => new Date().toISOString() }) {
  if (!projectDir || !nonEmpty(siteId) || !nonEmpty(taskId) || !Array.isArray(rows) || !rows.length || !nonEmpty(decidedBy) || !nonEmpty(reason)) throw refuse('dependency-link-waiver-invalid', 'projectDir, siteId, taskId, rows, decidedBy and reason are required');
  const task = readJson(projectDir, DIAGNOSTIC, { tasks: {} }).tasks?.[taskId];
  if (task?.siteId && task.siteId !== siteId) throw refuse('dependency-link-waiver-invalid', 'the diagnostic for this task belongs to another site');
  const finals = new Map((task?.finalDeferrals || []).map(row => [[row.sourceStableKey, row.ref, row.dependencySourceKey].join('\n'), row]));
  const accepted = [];
  for (const row of rows) {
    const current = finals.get([row.sourceStableKey, row.ref, row.dependencySourceKey].join('\n'));
    if (!current) throw refuse('dependency-link-waiver-refused', `${row.sourceStableKey} is not waiting on a final ${row.ref} parent ${row.dependencySourceKey}`, row);
    if (current.linkRequired) throw refuse('dependency-link-waiver-impossible', `${row.sourceStableKey} cannot exist without its ${row.ref} link; fix ${row.dependencySourceKey} and re-run instead`, row);
    if (current.linkChoice !== 'offer-omit' && (explicitRequest !== true || !nonEmpty(warning))) throw refuse('dependency-link-waiver-refused', `importing without ${row.ref} requires an explicit request and warning`, row);
    accepted.push({ ...current, explicitRequest: current.linkChoice !== 'offer-omit' });
  }
  const doc = readWaivers(projectDir), byScope = new Map(doc.waivers.map(waiver => [scopeKey(waiver), waiver])), recordedAt = now();
  for (const row of accepted) byScope.set(scopeKey({ siteId, taskId, ...row }), { id: crypto.randomUUID(), siteId, taskId, sourceStableKey: row.sourceStableKey, ref: row.ref, dependencySourceKey: row.dependencySourceKey, parentStatus: row.parentStatus, linkChoice: row.linkChoice, explicitRequest: row.explicitRequest, ...(row.explicitRequest ? { warning } : {}), decidedBy, reason, recordedAt });
  const file = path.join(projectDir, FILE), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, waivers: [...byScope.values()].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b))) }, null, 2)}\n`); fs.renameSync(tmp, file);
  return { recorded: accepted.length };
}
module.exports = { FILE, loadLinkWaivers, recordLinkWaiver, readWaivers };
