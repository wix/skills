'use strict';

// A route the run controller would end as `blocked` after its pass limit (the same route twice
// with no durable progress, lib/run-controller.js) settles here instead, when it has a settler:
// the leftover becomes a toolkit gap (execution/toolkit-gaps.json, source `route-settlement`) and,
// where only a person can decide, a cutover task in the completion report. The source values stay
// in the local extract (the import binding's extractPath, named on each row). Every gate that would
// return the same route honors the settlement, so the run moves on and imports everything else.
//
// Writers never block; one-click never asks mid-run; no check may stop a user run. A loop still
// ends: a settlement must cover something not settled before, or the controller stops as before.
// Our test runs stop on the controller's `route_settled` event through the operator prompt, never here.
//
// Settlements bind the mapping plan digest: a new plan is checked again from the start.

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'execution/route-settlements.json';
const GAP_SOURCE = 'route-settlement';
// Read-back findings that name a field the import may not write (read-back-contract validate). Each
// settled one is a field-not-migrated cutover task; its source value stays in the local extract.
const FIELD_FINDINGS = [
  /^Identified exact-binding approval missing: (.+)$/,
  /^Mapping does not cover (.+)$/,
  /^Builder omits an applicable output: .+ at (.+) \(\d+ records\)$/,
  /^Disposition missing or duplicate: (?:source|intended):(.+)$/,
  /^Invalid recoverable deferral: (.+)$/,
  /^Attempted or observed-loss path cannot (?:become a deferred field|be omitted): (.+)$/,
  /^Unknown disposition: (.+)$/,
  /^Ambiguous intended item fields: (.+?) \(/,
];
function fieldOf(error) {
  for (const re of FIELD_FINDINGS) { const m = re.exec(String(error)); if (m) return m[1]; }
  return null;
}

function readJsonSafe(projectDir, rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, rel), 'utf8')); } catch { return fallback; }
}
function planDigest(projectDir) {
  const plan = readJsonSafe(projectDir, 'mapping/mapping-plan.json', null);
  return plan ? require('./mapping-field-contract').digest(plan) : null;
}
function allSettlements(projectDir) {
  const doc = readJsonSafe(projectDir, FILE, null);
  return doc?.schemaVersion === 1 && Array.isArray(doc.settlements) ? doc.settlements : [];
}
// The settlements of the current mapping plan.
function currentSettlements(projectDir) {
  const digest = planDigest(projectDir);
  return digest ? allSettlements(projectDir).filter(row => row.mappingPlanDigest === digest) : [];
}
function write(projectDir, settlements) {
  const file = path.join(projectDir, FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, settlements }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// Read-back units settled for the current plan: no gate waits on them (read-back-approval
// gatedEntities, read-back-validate readBackFailures), so the import writes them through the
// ordinary write path, without the read-back gate.
function settledReadBackUnits(projectDir) {
  return new Set(currentSettlements(projectDir).filter(row => row.kind === 'read-back').map(row => row.unit));
}
// One-click mapping-approval refusals settled for the current plan, as the router names them
// (`code:detail`). The approval binding (census-reconciliation bindCensusReconciliation) accepts a
// refusal whose every error is settled.
function settledApprovalErrors(projectDir) {
  return new Set(currentSettlements(projectDir).filter(row => row.kind === 'mapping-approval').flatMap(row => row.errors));
}

function extractOf(projectDir, unit) {
  try {
    const fields = require('./mapping-field-contract');
    const plan = readJsonSafe(projectDir, 'mapping/mapping-plan.json', {});
    const row = fields.readBackRow(plan, unit);
    const manifest = readJsonSafe(projectDir, 'execution/execution-manifest.json', {});
    const binding = (manifest.tasks || []).filter(task => task?.kind === 'import').flatMap(task => task.sourceBindings || [])
      .find(b => b && b.role !== 'source-archive' && row && (b.sourceEntity === row.sourceEntity || b.sourceEntity === fields.entityRef(row)));
    return binding?.extractPath || null;
  } catch { return null; }
}
function decisionFile(projectDir, unit) {
  try { return `mapping/entity-decisions/${require('./read-back-contract').decisionFileName(projectDir, unit)}`; } catch { return 'mapping/mapping-plan.json'; }
}

function settleReadBack(projectDir, route, digest, prior) {
  const settled = new Set(prior.filter(row => row.kind === 'read-back').map(row => row.unit));
  return (Array.isArray(route.entities) ? route.entities : []).filter(f => f?.entity && !settled.has(f.entity)).map(f => ({
    kind: 'read-back', route: `${route.nextState}:${route.reason}`, unit: f.entity, status: f.status || 'invalid',
    errors: (f.errors || []).map(String).slice(0, 50), notMigratedPaths: [...new Set((f.errors || []).map(fieldOf).filter(Boolean))],
    extractPath: extractOf(projectDir, f.entity), mappingPlanDigest: digest, settledAt: new Date().toISOString(),
  }));
}
// Only the dependency preflight's refusal settles: the import's own dependency gate still holds
// the dependent task and reports it (completion-report dependencyOperatorActions).
function settleApprovalRefusal(projectDir, route, digest, prior) {
  const errors = (route.errors || []).map(String);
  if (errors[0] !== 'dependency_preflight_blocking') return [];
  const settled = new Set(prior.filter(row => row.kind === 'mapping-approval').flatMap(row => row.errors));
  if (errors.every(e => settled.has(e))) return [];
  return [{ kind: 'mapping-approval', route: `${route.nextState}:${route.reason}`, errors, mappingPlanDigest: digest, settledAt: new Date().toISOString() }];
}

// In-use entities the mapper left unmapped after the completeness passes (the router settles
// these itself when its own pass count runs out). The plan's execution scope already defers a
// pending row (cutover action mapping-scope-deferred); a discovered entity with no plan row stays
// a not-decided census row (discovered-set status). Their records stay in the local extract.
function settleMappingIncomplete(projectDir, route, digest, prior) {
  const settled = new Set(prior.filter(row => row.kind === 'mapping-incomplete').map(row => row.unit));
  return (route.unmappedEntities || []).filter(u => u?.entityRef && !settled.has(u.entityRef)).map(u => ({
    kind: 'mapping-incomplete', route: `${route.nextState}:${route.reason}`, unit: u.entityRef, sourceRecordCount: u.sourceRecordCount ?? null,
    noPlanRow: u.noPlanRow === true, mappingPlanDigest: digest, settledAt: new Date().toISOString(),
  }));
}
// Census reconciliation errors and source-coverage failures the mapper could not clear: each is
// named by code and its census or coverage id. The router and the approval binding skip settled ones.
function errorKey(e) {
  if (typeof e === 'string') return e;
  return `${e?.code || 'error'}:${e?.censusId ?? e?.coverageId ?? e?.detail ?? ''}`;
}
function settleKeyed(kind) {
  return (projectDir, route, digest, prior) => {
    const settled = new Set(prior.filter(row => row.kind === kind).flatMap(row => row.errors));
    const keys = [...new Set((route.errors || []).map(errorKey))].filter(k => !settled.has(k));
    return keys.length ? [{ kind, route: `${route.nextState}:${route.reason}`, errors: keys, mappingPlanDigest: digest, settledAt: new Date().toISOString() }] : [];
  };
}
function settledErrorKeys(projectDir, kind) {
  return new Set(currentSettlements(projectDir).filter(row => row.kind === kind).flatMap(row => row.errors));
}
// The errors a gate still owes after settlements of `kind` (census, source-coverage).
function unsettledErrors(projectDir, kind, errors) {
  if (!Array.isArray(errors) || !errors.length) return errors;
  const settled = settledErrorKeys(projectDir, kind);
  return settled.size ? errors.filter(e => !settled.has(errorKey(e))) : errors;
}
function settledUnmappedEntities(projectDir) {
  return new Set(currentSettlements(projectDir).filter(row => row.kind === 'mapping-incomplete').map(row => row.unit));
}

// Import repair (codegen <-> import). An import task fails and goes back to codegen; codegen
// "fixes" it; the import fails again. Each hand-back is a codegen pass. When the import records no
// new progress (imported records, crosswalk rows) across IMPORT_REPAIR_PASSES codegen passes, the
// unfinished import tasks are deferred: each is held by the import's dependency gate
// (dependency-readiness codegenHolds), reported as a cutover task ("import of <task> failed: rerun
// after fix"), and the rest of the import resumes. The router counts the passes (it sees every
// hand-back); the run controller's no-progress stop uses the same settler.
const REPAIR_FILE = 'execution/import-repair-passes.json';
const IMPORT_REPAIR_PASSES = 2;
// A failure that changes each pass is codegen making headway (a new pre-write defect each time): it
// does not count against the limit above. This cap bounds that case too.
const IMPORT_REPAIR_CAP = 5;
const MANIFEST = 'execution/execution-manifest.json';
const PASSES_FILE = 'state/readiness/task-passes.ndjson';
function progressOf(checkpoint) { return JSON.stringify({ settled: checkpoint?.settled || {}, crosswalkRows: checkpoint?.crosswalkRows ?? 0 }); }
function importRepairSettlements(projectDir) {
  return currentSettlements(projectDir).filter(row => row.kind === 'import-repair');
}
// Hand-backs at or before this time are retired: the run settled them.
function importRepairRetiredBefore(projectDir) {
  const times = importRepairSettlements(projectDir).map(row => row.handBackAt).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}
// What a hand-back failed on, without the run ids, counts and dates that change on every run: its
// finding headings (`## ...` lines), else its whole text. Two hand-backs with the same fingerprint
// and no import progress are the same failure repeating.
function failureFingerprint(projectDir, file) {
  let text = '';
  try {
    if (file === 'orchestration/run.json') { const r = readJsonSafe(projectDir, file, {})?.resumeFrom || {}; text = `${r.reason || ''}\n${r.detail || ''}`; }
    else { const v = readJsonSafe(projectDir, file, null); text = v ? JSON.stringify(v.qaFindings ?? v.findings ?? v.errors ?? v) : ''; }
  } catch { text = ''; }
  const lines = text.split(/\\n|\n|","/);
  const headings = lines.filter(line => /^\s*"?##/.test(line));
  const norm = (headings.length ? headings : lines).join('\n').toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '').replace(/\b(?=[0-9a-f-]*\d)[0-9a-f-]{6,}\b/g, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return require('node:crypto').createHash('sha256').update(norm).digest('hex').slice(0, 16);
}
// Called by the router for each import hand-back to codegen. `record` is false for a status display.
async function importRepairPasses(projectDir, handBack, { record = true } = {}) {
  const checkpoint = await require('./subagent-handoff').checkpointOf(projectDir);
  const doc = readJsonSafe(projectDir, REPAIR_FILE, null);
  const retired = importRepairRetiredBefore(projectDir) ?? -Infinity;
  const handBacks = (doc?.schemaVersion === 1 && Array.isArray(doc.handBacks) ? doc.handBacks : []).filter(row => row.at > retired);
  const key = `${handBack.file}@${handBack.timestamp}`;
  // A new pass only when codegen finished work after the last counted hand-back; another signal
  // for the same failure (an import handoff and a recorded stop) is the same pass.
  const last = handBacks.at(-1);
  const samePass = last && !(Number(handBack.codegenAt) > last.at);
  if (!samePass && !handBacks.some(row => row.key === key)) {
    handBacks.push({ key, at: handBack.timestamp, progress: progressOf(checkpoint), failure: failureFingerprint(projectDir, handBack.file) });
    if (record) {
      const file = path.join(projectDir, REPAIR_FILE);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ schemaVersion: 1, handBacks }, null, 2)}\n`);
      fs.renameSync(`${file}.tmp`, file);
    }
  }
  // The hand-backs since the import last moved. A codegen pass did not help when the same failure
  // comes back; a new failure starts the count again (capped overall at IMPORT_REPAIR_CAP).
  const now = progressOf(checkpoint);
  let stalled = 0, same = 0;
  for (let i = handBacks.length - 1; i >= 0 && handBacks[i].progress === now; i -= 1) stalled += 1;
  const latest = handBacks.at(-1);
  for (let i = handBacks.length - 1; i >= 0 && handBacks[i].progress === now && handBacks[i].failure === latest?.failure; i -= 1) same += 1;
  const passes = Math.max(0, same - 1);
  return { passes, exhausted: passes >= IMPORT_REPAIR_PASSES || stalled > IMPORT_REPAIR_CAP };
}
function taskRow(task) {
  return { taskId: task.id, entityRefs: task.entityRefs || [], extractPaths: (task.sourceBindings || []).filter(b => b?.role !== 'source-archive' && b.extractPath).map(b => b.extractPath) };
}
// Import tasks with no finished live full pass (dependency-readiness finishTaskPass). A pass under an
// earlier manifest still counts: codegen rewrites the manifest on each fix, and a finished task's
// records are on the site (the crosswalk keeps a rerun from sending them again).
function unfinishedImportTasks(projectDir) {
  const manifest = readJsonSafe(projectDir, MANIFEST, null);
  const finished = new Set();
  try {
    for (const line of fs.readFileSync(path.join(projectDir, PASSES_FILE), 'utf8').split('\n')) {
      try { const row = JSON.parse(line); if (row?.selection?.mode === 'full' && !row.dryRun) finished.add(row.taskId); } catch { /* skip */ }
    }
  } catch { /* no passes yet */ }
  return (manifest?.tasks || []).filter(task => task?.kind === 'import' && task.id && !finished.has(task.id)).map(taskRow);
}
// The tasks to defer: only the unfinished import tasks the hand-back names (by task id or entity
// ref, e.g. `stores/coupon`); every other task resumes. A hand-back that names none (a crash before
// any task ran) defers every unfinished task, never the run. A finished task is not deferred: its
// failed records are already in the report.
function failingImportTasks(projectDir, handoff) {
  const unfinished = unfinishedImportTasks(projectDir);
  let text = '';
  try { text = !handoff ? '' : handoff === 'orchestration/run.json' ? JSON.stringify(readJsonSafe(projectDir, handoff, {})?.resumeFrom || {}) : fs.readFileSync(path.join(projectDir, handoff), 'utf8'); } catch { text = ''; }
  const word = (term) => new RegExp(`(^|[^A-Za-z0-9_/-])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_/-])`);
  const named = text ? unfinished.filter(task => [task.taskId, ...task.entityRefs].some(term => word(term).test(text))) : [];
  return named.length ? named : unfinished;
}
// Every unfinished task is held by a settlement: a later hand-back has nothing left codegen could
// unblock, so the router retires it at once instead of starting the passes again.
function importRepairCovered(projectDir) {
  if (!importRepairSettlements(projectDir).length) return false;
  const held = heldImportTasks(projectDir);
  return unfinishedImportTasks(projectDir).every(t => held.has(t.taskId));
}
// The import resumes once after a settlement (the deferred tasks held), then the ordinary flow goes on.
function importRepairResumed(projectDir) {
  const latest = importRepairSettlements(projectDir).sort((a, b) => a.handBackAt - b.handBackAt).at(-1);
  return Boolean(latest?.resumedAt);
}
function markImportRepairResumed(projectDir) {
  const all = allSettlements(projectDir);
  const digest = planDigest(projectDir);
  const rows = all.filter(r => r.kind === 'import-repair' && r.mappingPlanDigest === digest).sort((a, b) => a.handBackAt - b.handBackAt);
  const latest = rows.at(-1);
  if (!latest || latest.resumedAt) return;
  latest.resumedAt = new Date().toISOString();
  write(projectDir, all);
}
function settleImportRepair(projectDir, route, digest, prior) {
  const handBackAt = Number(route.handBackAt);
  if (!Number.isFinite(handBackAt)) return [];
  const settledRows = prior.filter(row => row.kind === 'import-repair');
  if (settledRows.some(row => row.handBackAt >= handBackAt)) return [];
  // Held now; a task released by a code fix can be settled again if it fails again.
  const held = new Set(heldImportTasks(projectDir).keys());
  const tasks = failingImportTasks(projectDir, route.handoff || route.priorHandoff || null).filter(t => !held.has(t.taskId));
  return [{ kind: 'import-repair', route: `${route.nextState}:${route.reason}`, handBackAt, handoff: route.handoff || route.priorHandoff || null, tasks,
    codeDigest: codeDigest(projectDir), mappingPlanDigest: digest, settledAt: new Date().toISOString() }];
}
// The generated code's identity (path, size, mtime of every file under src/). A fix, by codegen or
// by hand, changes it.
function codeDigest(projectDir) {
  const rows = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(projectDir, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(rel); }
      else if (entry.isFile()) { try { const st = fs.statSync(path.join(projectDir, rel)); rows.push(`${rel}:${st.size}:${st.mtimeMs}`); } catch { /* gone */ } }
    }
  };
  walk('src');
  return require('node:crypto').createHash('sha256').update(rows.sort().join('\n')).digest('hex');
}
// Tasks the dependency gate holds (dependency-readiness codegenHolds): never sent, reported. The
// hold lasts until the generated code changes: then the task can be rerun after the fix, as its
// cutover task says (and settled again if it still fails).
function heldImportTasks(projectDir) {
  const rows = new Map();
  const settlements = importRepairSettlements(projectDir);
  if (!settlements.length) return rows;
  const code = codeDigest(projectDir);
  for (const row of settlements) if (!row.codeDigest || row.codeDigest === code) for (const task of row.tasks) rows.set(task.taskId, row);
  return rows;
}

// Every router reason that can repeat until a check passes has a settler here. Reasons with no
// settler are listed, with why, in tests/orchestration/route-settlement-test.js (a new reason fails it).
const SETTLERS = {
  'codegen_running:read_back_invalid': settleReadBack,
  'mapping_running:read_back_invalid': settleReadBack,
  'mapping_running:mapping_approval_refused': settleApprovalRefusal,
  'mapping_running:mapping_incomplete': settleMappingIncomplete,
  'mapping_running:census_reconciliation_blocking': settleKeyed('census'),
  'mapping_running:source_coverage_unreconciled': settleKeyed('source-coverage'),
  'codegen_running:import_codegen_fix_required': settleImportRepair,
  'executing_import:import_codegen_fixed_resume': settleImportRepair,
  'executing_import:mapping_deferral_report_regenerate': settleMappingDeferralReport,
};

// Deferred-mapping report regeneration (router mapping_deferral_report_regenerate). The router sends
// the import back to rewrite a missing or stale completion report / handoff summary; still stale
// after the pass limit, it is settled once per mapping plan: the router stops sending it back, the
// run goes on, and an Import Operator cutover task asks for the regeneration.
const DEFERRAL_REPORT = 'mapping-deferral-report';
function mappingDeferralReportSettled(projectDir) {
  return currentSettlements(projectDir).some(row => row.kind === DEFERRAL_REPORT);
}
// Regenerate passes, counted by the router per mapping plan. The run controller's same-route stop
// cannot count them: a regenerate turn runs writers that grow the progress log, which resets its
// count. A pass is a new project state at a regenerate route: the report, the handoff or the
// progress log changed since the last one. The first is the stale state itself; each later one is a
// failed regeneration. A status display (record false) counts nothing.
const DEFERRAL_PASSES_FILE = 'execution/mapping-deferral-regenerate-passes.json';
function mappingDeferralRegeneratePasses(projectDir, { record = true } = {}) {
  const digest = planDigest(projectDir);
  if (!digest) return { passes: 0, exhausted: false };
  const read = (rel) => { try { return fs.readFileSync(path.join(projectDir, rel)); } catch { return ''; } };
  const { progressMark, projectProgressLog } = require('./progress-log');
  const state = require('node:crypto').createHash('sha256')
    .update(read('execution/completion-report.json')).update('\0').update(read('execution/review/migration-handoff.json'))
    .update('\0').update(String(progressMark(projectProgressLog(projectDir)))).digest('hex').slice(0, 16);
  const doc = readJsonSafe(projectDir, DEFERRAL_PASSES_FILE, null);
  const seen = doc?.schemaVersion === 1 && doc.mappingPlanDigest === digest && Array.isArray(doc.states) ? doc.states : [];
  if (!seen.includes(state)) {
    seen.push(state);
    if (record) {
      const file = path.join(projectDir, DEFERRAL_PASSES_FILE);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ schemaVersion: 1, mappingPlanDigest: digest, states: seen }, null, 2)}\n`);
      fs.renameSync(`${file}.tmp`, file);
    }
  }
  const passes = seen.indexOf(state);
  return { passes, exhausted: passes >= IMPORT_REPAIR_PASSES };
}
function settleMappingDeferralReport(projectDir, route, digest, prior) {
  if (prior.some(row => row.kind === DEFERRAL_REPORT)) return [];
  return [{ kind: DEFERRAL_REPORT, mappingPlanDigest: digest, unit: 'completion-report', settledAt: new Date().toISOString() }];
}

function gapRows(settlements) {
  return settlements.map(row => row.kind === DEFERRAL_REPORT
    ? { kind: 'override', step: 'deferred-mapping report', file: 'execution/completion-report.json',
      why: `completion report / handoff mapping summary still missing or stale for the current mapping plan after ${IMPORT_REPAIR_PASSES} regeneration passes; the run continued; cutover task: regenerate them` }
    : row.kind === 'import-repair'
    ? { kind: 'override', step: 'import repair', file: row.handoff || MANIFEST,
      why: `codegen could not fix the import after ${IMPORT_REPAIR_PASSES} passes with no new imported records; ${row.tasks.length ? `deferred task(s) ${row.tasks.map(t => t.taskId).join(', ')} (cutover task: rerun after fix)` : 'no unfinished task to defer'}; the rest of the import resumed; source records kept in the local extract` }
    : row.kind === 'mapping-incomplete'
    ? { kind: 'override', step: `mapping ${row.unit}`, file: 'mapping/mapping-plan.json',
      why: `in-use entity still unmapped after the completeness passes${row.sourceRecordCount != null ? ` (${row.sourceRecordCount} records)` : ''}; not imported, reported as a cutover item; source records kept in the local extract (data/source-extract/)` }
    : ['census', 'source-coverage'].includes(row.kind)
    ? { kind: 'override', step: row.kind === 'census' ? 'census reconciliation' : 'source coverage', file: row.kind === 'census' ? 'mapping/review/census-reconciliation.json' : 'source-schema.json',
      why: `still failing after the pass limit (${row.errors.slice(0, 4).join('; ')}${row.errors.length > 4 ? `; +${row.errors.length - 4} more` : ''}); the run continued, the rest imports` }
    : row.kind === 'read-back'
    ? { kind: 'override', step: `read-back ${row.unit}`, file: row.decisionFile || 'mapping/mapping-plan.json',
      why: `read-back check still ${row.status} after the pass limit (${row.errors.slice(0, 3).join('; ') || 'no detail'}); imported without the read-back gate${row.extractPath ? `; source values kept in ${row.extractPath}` : ''}` }
    : { kind: 'override', step: 'one-click mapping approval', file: 'mapping/review/dependency-preflight.json',
      why: `approval refusal kept after the pass limit (${row.errors.slice(0, 4).join('; ')}); approval recorded, the import's dependency gate holds the affected task` });
}

// Called by the run controller in place of ending the run `blocked` for no progress. Returns
// { settled: true, rows } when it recorded something new, else { settled: false }.
function settleRoute(projectDir, route) {
  const settler = SETTLERS[`${route?.nextState}:${route?.reason}`];
  const digest = planDigest(projectDir);
  if (!settler || !digest) return { settled: false };
  const all = allSettlements(projectDir), prior = all.filter(row => row.mappingPlanDigest === digest);
  const rows = settler(projectDir, route, digest, prior).map(row => row.kind === 'read-back' ? { ...row, decisionFile: decisionFile(projectDir, row.unit) } : row);
  if (!rows.length) return { settled: false };
  write(projectDir, [...all, ...rows]);
  require('./toolkit-gaps').recordToolkitGaps(projectDir, GAP_SOURCE, gapRows([...prior, ...rows]));
  return { settled: true, rows };
}

// Completion report: every field a settled read-back unit may not write (any field finding, see
// FIELD_FINDINGS) is a site-owner decision; its source value stays in the local extract. A finding
// with no field (a stale extract, an unparseable location) is a toolkit gap only.
function reportRows(projectDir) {
  const operatorActions = [];
  for (const row of currentSettlements(projectDir)) {
    if (row.kind !== 'read-back' || !row.notMigratedPaths?.length) continue;
    const paths = row.notMigratedPaths;
    operatorActions.push({
      actionId: `route-settlement:not-migrated:${row.unit}`, code: 'field-not-migrated', severity: 'medium', role: 'site-owner', entity: row.unit,
      action: `Site owner: ${paths.length} ${row.unit} field(s) were not imported: ${paths.slice(0, 10).join(', ')}${paths.length > 10 ? `, +${paths.length - 10} more` : ''}. The rest of each record was imported. Confirm these fields are not needed on the new site, or ask the Import Operator to map them and rerun the ${row.unit} import.`,
      importOperatorPrompt: `In the migration project, map these ${row.unit} fields in mapping/mapping-plan.json (or record each as a deliberate drop): ${paths.join(', ')}. Their source values are in ${row.extractPath || 'the local source extract (data/source-extract/)'}. Then rerun the ${row.unit} import task.`,
      deadlineReason: 'Before launch: these fields are not on the new site.',
      affectedCount: paths.length, affectedIds: paths, artifactRefs: [FILE, ...(row.extractPath ? [row.extractPath] : [])],
      prerequisites: ['Original migration project, for a rerun'],
      resolutionEvidence: `The site owner confirms the fields are not needed, or a rerun after the plan maps them imports them.`,
    });
  }
  // A deferred task stays a cutover task until it finishes a pass (a rerun after the fix).
  const unfinished = new Set(unfinishedImportTasks(projectDir).map(t => t.taskId));
  for (const row of importRepairSettlements(projectDir)) {
    for (const task of row.tasks.filter(t => unfinished.has(t.taskId))) {
      operatorActions.push({
        actionId: `route-settlement:import-failed:${task.taskId}`, code: 'import-task-failed', severity: 'high', role: 'import-operator', entity: task.entityRefs.join(', ') || null,
        action: `Requires Import Operator: import of ${task.taskId} (${task.entityRefs.join(', ') || 'no entity'}) failed and codegen could not fix it in ${IMPORT_REPAIR_PASSES} passes, so the task was not run. Every other task was imported. Rerun this task after the fix.`,
        importOperatorPrompt: `In the migration project, read ${row.handoff || 'the latest state/handoffs/import-*.json'} for the failure, fix the generated code for task ${task.taskId} (rp-import-codegen), then rerun only that task. Its source records are in ${task.extractPaths.join(', ') || 'the local source extract (data/source-extract/)'}.`,
        deadlineReason: 'Before launch: these records are not on the new site.',
        affectedCount: 1, affectedIds: [task.taskId], artifactRefs: [FILE, ...(row.handoff ? [row.handoff] : []), ...task.extractPaths],
        prerequisites: ['Original migration project (generated src/ and state/)'],
        resolutionEvidence: `A rerun of task ${task.taskId} finishes its pass and its records are imported.`,
      });
    }
  }
  for (const row of currentSettlements(projectDir).filter(r => r.kind === DEFERRAL_REPORT)) {
    operatorActions.push({
      actionId: `route-settlement:${DEFERRAL_REPORT}:${row.mappingPlanDigest}`, code: 'mapping-deferral-report-stale', severity: 'medium', role: 'import-operator', entity: null,
      action: `Requires Import Operator: the completion report and handoff mapping summary could not be regenerated for the current mapping plan (${IMPORT_REPAIR_PASSES} passes). The import itself is unchanged; deferred entities may be missing from these counts. Regenerate them before launch.`,
      importOperatorPrompt: 'In the migration project, regenerate execution/completion-report.json and execution/review/migration-handoff.json through the shared writers using the importer mapping pin (rp-execute-import, report-only; do not resend records). Retained counters must not be reported as completed.',
      deadlineReason: 'Before launch: the cutover list relies on these reports.',
      affectedCount: 1, affectedIds: ['execution/completion-report.json'], artifactRefs: [FILE, 'execution/completion-report.json', 'execution/review/migration-handoff.json'],
      prerequisites: ['Original migration project'],
      resolutionEvidence: 'The completion report and the handoff mapping summary carry the current mapping plan digest and execution scope.',
    });
  }
  return { operatorActions };
}

module.exports = { mappingDeferralReportSettled, mappingDeferralRegeneratePasses, DEFERRAL_PASSES_FILE, importRepairCovered, importRepairResumed, markImportRepairResumed, IMPORT_REPAIR_CAP, failureFingerprint, codeDigest, IMPORT_REPAIR_PASSES, REPAIR_FILE, importRepairPasses, importRepairRetiredBefore, heldImportTasks, unfinishedImportTasks, failingImportTasks, FIELD_FINDINGS, fieldOf, settledErrorKeys, FILE, GAP_SOURCE, SETTLERS, settleRoute, settledReadBackUnits, settledApprovalErrors, settledUnmappedEntities, unsettledErrors, errorKey, currentSettlements, reportRows };
