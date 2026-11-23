'use strict';

// Every issue a run can produce becomes a cutover task (Elad, 11-15): a structured row in
// execution/completion-report.json `operatorActions[]` (actionId, role, severity, action, ...).
//
// The specific producers (dependency readiness, read-back gate, mapping gaps, CMS fallback, URL
// preservation, ...) keep their own rows. This module covers what had no row, all read from the
// report and the plan the report is bound to, never from logs:
//   - records the journal shows failed, deferred (with a non-readiness reason), unresolved or
//     skipped unexpectedly (from the report's own entityCompleteness rows);
//   - every field the plan drops that loses real data (`disposition: excluded`, populated, not a
//     mandatory credential exclusion, not carried to cutover, and with no recorded choice), as
//     droppedFields plus one grouped action per entity;
// Recorded plan choices, including drops by choice, are mapping-field-contract planChoiceActions
// (mapping-choice:*), joined by completion-report; they are not listed again here.
//   - pending cutover-stage user actions (plugin skips, time-zone and payment confirmations);
// and it gives every older row an actionId and role so the whole list has one shape.
//
// ISSUE_KINDS is the class guard: each journal status and plan disposition must be classified
// here, and tests/orchestration/cutover-coverage-test.js fails when a new one is not.

const path = require('node:path');

// Journal statuses (local-state ATTEMPT_STATUS) → which cutover row covers them.
const JOURNAL_STATUS_KIND = Object.freeze({
  started: 'records-unresolved',
  succeeded_unverified: 'records-unresolved',
  needs_verification: 'records-unresolved',
  failed_retryable: 'records-failed',
  failed_terminal: 'records-failed',
  deferred: 'records-deferred',
  skipped_unexpected: 'records-skipped-unexpected',
  // Not an issue: the record is on the site, or excluded by an accepted rule (reported as an exclusion).
  imported: null,
  skipped_already_imported: null,
  skipped_out_of_scope: null,
  skipped_safe_mode_blocked: null,
});

// Plan field dispositions (mapping-field-contract DISPOSITIONS) → which cutover row covers them.
const DISPOSITION_KIND = Object.freeze({
  native: null,
  'extended-field': null,
  // The CMS source archive is reported in keptForReference and its own archive actions.
  cms: null,
  excluded: 'dropped-fields',
  // Unresolved and deferred fields are mapping gaps: deferredMappingActions / mappingGapCutoverActions.
  unresolved: 'mapping-gap',
  'deferred-field': 'mapping-gap',
});

const ISSUE_KINDS = Object.freeze([
  'records-failed', 'records-deferred', 'records-unresolved', 'records-skipped-unexpected',
  'dropped-fields', 'cutover-user-action', 'reconciliation-unresolved',
]);

const IMPORT_PREREQUISITES = ['original migration project', 'source snapshot', 'current-site access'];
// Deferrals the dependency-readiness actions already explain record by record.
// Also left to their own producers: plan-value holds (#716), the order currency gate (#708) and
// the fixed loop's incomplete-step rows (A1).
const READINESS_OWNED = /^dependency-|^readiness-|^REFERENCE_UNDECLARED$|^plan-value-held|^currency-gate:|^import-step-incomplete/;

function slug(value) { return String(value).replace(/[^A-Za-z0-9:_./-]+/g, '-').slice(0, 200); }

// The latest journal row per source key, grouped like completion-report attachAttemptReasons:
// `${entity}\t${outcome}\t${code}` -> sorted source keys. Lets each held reason name its records.
async function journalReasonKeys(projectDir, entityCompleteness) {
  const keyToEntity = new Map();
  for (const row of Array.isArray(entityCompleteness) ? entityCompleteness : []) for (const key of row.sourceKeys || []) keyToEntity.set(key, row.entity);
  if (!projectDir || !keyToEntity.size) return new Map();
  let rows = [];
  try { ({ rows } = await require('./local-state').loadAttemptJournal(projectDir)); } catch { return new Map(); }
  const latest = new Map();
  for (const row of rows || []) if (row && keyToEntity.has(row.sourceStableKey)) latest.set(row.sourceStableKey, row);
  const landed = (row) => { try { return require('./import-recovery').landedUnverified(row); } catch { return false; } };
  const out = new Map();
  for (const [key, row] of latest) {
    let outcome = null, code = null;
    if (row.status === 'deferred' || (row.status === 'needs_verification' && !landed(row))) {
      outcome = 'deferred';
      code = (typeof row.reason === 'string' && row.reason) || row.deferral?.reason || row.failure?.errorCode;
    } else if (row.status === 'failed_retryable' || row.status === 'failed_terminal') {
      outcome = 'failed'; code = row.failure?.errorCode;
    } else if (['started', 'succeeded_unverified'].includes(row.status) || landed(row)) {
      // An unknown outcome keeps its status and recorded reason (read-back mismatch, lost reply).
      outcome = 'unresolved'; code = `${row.status}:${row.failure?.errorCode || 'no-reason-recorded'}`;
    }
    if (!outcome || typeof code !== 'string' || !code) continue;
    const group = `${keyToEntity.get(key)}\t${outcome}\t${code}`;
    if (!out.has(group)) out.set(group, []);
    out.get(group).push(key);
  }
  for (const keys of out.values()) keys.sort();
  return out;
}

// Records another row already names (a builder hold's own row lists its product ids): by entity
// family (last path segment: 'stores/product' and 'product' are one) and by full key or bare id.
const family = (entity) => String(entity || '').split('/').pop();
const bareId = (key) => String(key).split(':').pop();
function namedRecords(existing) {
  const named = new Map();
  for (const a of existing || []) {
    if (!a || !Array.isArray(a.affectedIds)) continue;
    const f = family(a.entity);
    if (!named.has(f)) named.set(f, new Set());
    for (const id of a.affectedIds) { named.get(f).add(String(id)); named.get(f).add(bareId(id)); }
  }
  return named;
}

function recordActions(entityCompleteness, existing = [], reasonKeys = new Map()) {
  const actions = [];
  // A code another producer already lists for this entity is not listed twice.
  const owned = new Set((existing || []).flatMap(a => a ? [`${a.entity}\t${a.code}`, `${a.entity}\t${a.reasonCode}`] : []));
  const named = namedRecords(existing);
  for (const row of Array.isArray(entityCompleteness) ? entityCompleteness : []) {
    const entity = row.entity;
    for (const rawReason of row.reasons || []) {
      if (!rawReason || typeof rawReason !== 'object' || !Number.isInteger(rawReason.count) || rawReason.count < 1) continue;
      // The contact-address hold has its own, more specific row (contact-address-contract.js).
      // A plan-deferred entity has the plan's own mapping-scope-deferred action (mapping-field-contract.js).
      if (rawReason.code === 'CONTACT_ADDRESS_SHAPE_INVALID' || rawReason.code === 'mapping-scope-deferred' || owned.has(`${entity}\t${rawReason.code}`)) continue;
      // Name the records from the journal; drop those another row already names. When every
      // record is already named, the reason has its row.
      const keys = reasonKeys.get(`${entity}\t${rawReason.outcome}\t${rawReason.code}`);
      let reason = rawReason, ids = [entity];
      if (keys && keys.length) {
        const seen = named.get(family(entity));
        const left = seen ? keys.filter(key => !seen.has(key) && !seen.has(bareId(key))) : keys;
        if (!left.length) continue;
        reason = { ...rawReason, count: left.length };
        ids = left;
      }
      if (reason.outcome === 'failed') {
        actions.push({
          actionId: slug(`records-failed:${entity}:${reason.code}`), code: 'records-failed', role: 'import-operator', severity: 'high',
          entity, affectedCount: reason.count, affectedIds: ids, artifactRefs: ['execution/completion-report.json'],
          prerequisites: IMPORT_PREREQUISITES,
          action: `Requires Import Operator: ${reason.count} ${entity} record(s) failed with ${reason.code} and are not on the new site.`,
          importOperatorPrompt: `In the attempt journal, find the ${entity} rows whose failure.errorCode is ${reason.code}. Fix the cause (mapping, builder or toolkit), then rerun that task with --failed-only. Do not resend records that already imported.`,
          resolutionEvidence: `a later completion report shows no ${reason.code} failures for ${entity}`,
          deadlineReason: 'these records are not on the new site',
        });
      } else if (reason.outcome === 'deferred' && !READINESS_OWNED.test(reason.code)) {
        actions.push({
          actionId: slug(`records-deferred:${entity}:${reason.code}`), code: 'records-deferred', role: 'import-operator', severity: 'high',
          entity, affectedCount: reason.count, affectedIds: ids, artifactRefs: ['execution/completion-report.json'],
          prerequisites: IMPORT_PREREQUISITES,
          action: `Requires Import Operator: ${reason.count} ${entity} record(s) were held (${reason.code}) and are not on the new site.`,
          importOperatorPrompt: `In the attempt journal, find the deferred ${entity} rows with reason ${reason.code}. Resolve that hold, then rerun that task with --deferred-only. Do not resend records that already imported.`,
          resolutionEvidence: `a later completion report shows no ${reason.code} deferrals for ${entity}`,
          deadlineReason: 'these records are held and not on the new site',
        });
      }
    }
    const unresolvedKeys = (row.unresolvedRecords || []).map(r => r && r.sourceKey).filter(Boolean);
    const unresolved = Math.max(unresolvedKeys.length, Number.isInteger(row.unresolved) ? row.unresolved : 0);
    // One task per recorded reason (status:errorCode from the journal), so the operator sees why
    // each write is unknown; the rest stay in one task for the entity.
    const prefix = `${entity}\tunresolved\t`;
    const groups = [...reasonKeys.entries()].filter(([group]) => group.startsWith(prefix)).map(([group, keys]) => [group.slice(prefix.length), keys]);
    const grouped = new Set(groups.flatMap(([, keys]) => keys));
    const rest = unresolvedKeys.filter(key => !grouped.has(key));
    const restCount = Math.max(rest.length, unresolved - grouped.size);
    const unresolvedRow = (reason, keys, n) => ({
      actionId: slug(reason ? `records-unresolved:${entity}:${reason}` : `records-unresolved:${entity}`), code: 'records-unresolved', role: 'import-operator', severity: 'critical',
      entity, affectedCount: n, affectedIds: keys.length ? [...keys].sort() : [entity], artifactRefs: ['execution/completion-report.json'],
      ...(reason ? { reasonCode: reason } : {}),
      prerequisites: IMPORT_PREREQUISITES,
      action: `Requires Import Operator: ${n} ${entity} write(s) have an unknown outcome${reason ? ` (${reason})` : ''}; they may or may not be on the new site.`,
      importOperatorPrompt: `Read back each unresolved ${entity} record listed in this task's affectedIds (completion-report entityCompleteness unresolvedRecords), then rerun that task with --unresolved-only. Never resend before the read-back: that can create a duplicate.`,
      resolutionEvidence: `a later completion report shows 0 unresolved ${entity} records${reason ? ` with ${reason}` : ''}`,
      deadlineReason: 'an unknown write outcome can hide a missing or duplicate record',
    });
    if (unresolved > 0) {
      for (const [reason, keys] of groups) actions.push(unresolvedRow(reason, keys, keys.length));
      if (restCount > 0) actions.push(unresolvedRow(null, rest, restCount));
    }
    if (Number.isInteger(row.unexpectedSkipped) && row.unexpectedSkipped > 0) actions.push({
      actionId: slug(`records-skipped-unexpected:${entity}`), code: 'records-skipped-unexpected', role: 'import-operator', severity: 'high',
      entity, affectedCount: row.unexpectedSkipped, affectedIds: [entity], artifactRefs: ['execution/completion-report.json'],
      prerequisites: IMPORT_PREREQUISITES,
      action: `Requires Import Operator: ${row.unexpectedSkipped} ${entity} record(s) in scope were never sent.`,
      importOperatorPrompt: `Rerun the ${entity} task with --missing-only; the records in scope that never reached the journal are sent. Do not resend records that already imported.`,
      resolutionEvidence: `a later completion report shows 0 unexpected skips for ${entity}`,
      deadlineReason: 'these records are not on the new site',
    });
  }
  return actions;
}

// Report `unresolved[]` rows: a Wix record with no source (orphaned_target), a source with no
// mapping (unmapped_source) or a mapping row with no record (mapping_without_record).
// A record another row already names (records-unresolved lists the journal's unresolved writes,
// which the report also turns into orphaned_target rows) is not listed again.
function reconciliationActions(unresolved, existing = []) {
  const named = namedRecords(existing);
  return (Array.isArray(unresolved) ? unresolved : []).filter(row => row && Number.isInteger(row.count) && row.count > 0).flatMap((raw) => {
    const seen = named.get(family(raw.entity));
    if (!seen || !Array.isArray(raw.sourceIds) || !raw.sourceIds.length) return [raw];
    const keep = raw.sourceIds.map((id, i) => [String(id), raw.targetIds?.[i]]).filter(([id]) => !seen.has(id) && !seen.has(bareId(id)));
    if (!keep.length) return [];
    if (keep.length === raw.sourceIds.length) return [raw];
    // targetIds pair with sourceIds only when both lists are complete; otherwise they are kept.
    const paired = Array.isArray(raw.targetIds) && raw.targetIds.length === raw.sourceIds.length;
    const sourceIds = keep.map(([id]) => id), targetIds = paired ? keep.map(([, t]) => t) : raw.targetIds;
    return [{ ...raw, count: sourceIds.length, sourceIds, targetIds }];
  }).map(row => ({
    actionId: slug(`reconciliation-unresolved:${row.entity}:${row.kind}`), code: 'reconciliation-unresolved', role: 'import-operator', severity: 'high',
    entity: row.entity, affectedCount: row.count,
    affectedIds: [...(row.sourceIds || []), ...(row.targetIds || [])].map(String).sort().slice(0, 200),
    artifactRefs: ['execution/completion-report.json'], prerequisites: IMPORT_PREREQUISITES,
    action: `Requires Import Operator: ${row.count} ${row.entity} record(s) do not reconcile (${row.kind}).`,
    importOperatorPrompt: `Open completion-report unresolved[] for ${row.entity} (${row.kind}). For each id, decide from the source and the site whether it is a missing import, an extra Wix record or a stale mapping row; fix it, then rerun the reconciliation. Never delete a Wix record the merchant created.`,
    resolutionEvidence: `a later completion report has no ${row.kind} rows for ${row.entity}`,
    deadlineReason: 'records that do not reconcile can be missing or duplicated on the new site',
  }));
}

function planRows(plan) {
  if (!plan) return [];
  try { return require('./mapping-field-contract.js').entityRows(plan); } catch { return []; }
}
function rowRef(row) { return row.sourceEntityRef || row.sourceEntity || row.entity || 'unknown'; }

// A drop that loses source data and has no other cutover row: not a mandatory credential
// exclusion, not a measured-empty field, not carried to cutover, and not a recorded choice
// (planChoiceActions lists that one as mapping-field-dropped-by-choice).
function countedDrop(row, d) {
  if (!d || d.disposition !== 'excluded' || d.choice !== undefined) return false;
  const contract = require('./mapping-field-contract.js');
  try {
    if (contract.mandatoryExclusion(row, d) || contract.measuredZeroExclusion(row, d) || contract.carriedToCutoverExclusion(row, d)) return false;
  } catch { /* an unreadable predicate input counts the drop: never hide a loss */ }
  return true;
}
// Every field dropped on purpose: one droppedFields row per source path, one action per entity.
function dropRows(plan) {
  const droppedFields = [], actions = [];
  for (const row of planRows(plan)) {
    const drops = (row.fieldMappings || []).filter(d => countedDrop(row, d));
    if (!drops.length) continue;
    const entity = rowRef(row);
    const recordCount = Number.isInteger(row.sourceRecordCount) && row.sourceRecordCount >= 0 ? row.sourceRecordCount : 0;
    const fields = [];
    for (const d of drops) for (const field of (Array.isArray(d.sourcePaths) && d.sourcePaths.length ? d.sourcePaths : [d.id])) {
      fields.push(field);
      droppedFields.push({ entity, field: String(field), recordCount, reasonCode: d.reasonCode || d.policyRef || 'excluded-by-plan' });
    }
    actions.push({
      actionId: slug(`dropped-fields:${entity}`), code: 'dropped-fields', role: 'cutover-operator', severity: 'low',
      entity, affectedCount: fields.length, affectedIds: fields.map(String).sort(), artifactRefs: ['mapping/mapping-plan.json', 'execution/completion-report.json'],
      action: `Review the ${fields.length} ${entity} source field(s) not imported on purpose: ${fields.slice(0, 20).join(', ')}${fields.length > 20 ? ', ...' : ''}. To keep one, change its plan row; the update pass applies it.`,
      resolutionEvidence: 'the merchant accepts each dropped field, or its plan row is changed and the update pass reports it applied',
      deadlineReason: 'dropped source data is not on the new site',
    });
  }
  return { droppedFields, actions };
}

// Pending cutover-stage user actions (wp-discovery plugin skips, site-regional confirmations,
// CMS item quota): they live in orchestration/user-actions, which the report did not read.
async function userActionRows(projectDir) {
  const ua = require('./user-actions.js');
  let rows = [];
  try { rows = await ua.listUserActions(projectDir, { status: 'pending' }); } catch { return []; }
  const actions = [];
  for (const listed of rows) {
    let request;
    try { request = await ua.readUserAction(projectDir, listed.requestId); } catch { continue; }
    if (!ua.isCutoverUserAction(request)) continue;
    const count = Number.isInteger(request.subject?.count) ? request.subject.count : null;
    // A request may name the Import Operator (work that needs the migration environment).
    const importOperator = request.subject?.role === 'import-operator';
    const text = `${request.title ? `${request.title}. ` : ''}${request.prompt || ''}`.trim() || `Answer cutover request ${request.requestId}.`;
    actions.push({
      actionId: slug(`cutover-user-action:${request.requestId}`), code: 'cutover-user-action', role: importOperator ? 'import-operator' : 'cutover-operator', severity: 'medium',
      ...(importOperator ? { importOperatorPrompt: text } : {}),
      entity: request.subject?.type || null, affectedCount: count, affectedIds: [String(request.requestId)],
      artifactRefs: ['orchestration/user-actions'],
      action: text,
      resolutionEvidence: `user action ${request.requestId} is answered or resolved`,
      deadlineReason: 'a cutover task recorded during the run is still open',
    });
  }
  return actions;
}

// The structured fields every operatorActions row must carry (Elad, 11-15). Rows from older
// producers (dependency readiness, extract integrity, read-back, ...) are filled here, before
// completion-report normalizes them, from what the row itself states: its source keys, the
// artifacts its text names and its "Prerequisites: ..." sentence. A row's own values win.
const STRUCTURED_FIELDS = Object.freeze(['actionId', 'role', 'severity', 'action', 'affectedIds', 'artifactRefs', 'prerequisites', 'resolutionEvidence']);
const ARTIFACT_PATH = /\b(?:execution|setup|mapping|data|orchestration|src|cutover)\/[A-Za-z0-9_.\/-]*[A-Za-z0-9_]/g;
function strings(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : null;
}
function rowAffectedIds(row) {
  const recordKeys = Array.isArray(row.records) ? row.records.map(r => r && r.sourceStableKey) : null;
  for (const list of [row.affectedIds, row.affectedSourceKeys, row.sourceKeys, recordKeys, row.cause?.heldSourceKeys, row.cause?.parentSourceKeys]) {
    const ids = Array.isArray(list) ? list.filter(v => v !== null && v !== undefined && v !== '').map(String) : [];
    if (ids.length) return ids;
  }
  return [String(row.entity || row.code || 'run')];
}
function rowPrerequisites(row, importOperator) {
  const own = strings(row.prerequisites);
  if (own) return own;
  const stated = /Prerequisites?:\s*([^.]+)\./i.exec(String(row.action || ''));
  if (stated) return stated[1].split(/,\s*|\s+and\s+/).map(v => v.trim()).filter(Boolean);
  return importOperator ? [...IMPORT_PREREQUISITES] : [];
}
function structureRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const text = String(row.action || '');
  const role = row.role || (/Requires Import Operator/i.test(text) || row.operatorRole === 'Requires Import Operator' ? 'import-operator' : 'cutover-operator');
  const importOperator = role === 'import-operator';
  const scope = row.cause?.ref || row.reasonCode || null;
  const actionId = row.actionId || slug([row.code, row.entity || 'run', scope].filter(Boolean).join(':'));
  const named = [...new Set(text.match(ARTIFACT_PATH) || [])];
  // A row's own refs are kept as given: normalizeOperatorAction refuses a non-project path.
  const ownRefs = strings(row.artifactRefs);
  // An explicit null prompt is left to fail validation; only an absent one is filled from the text.
  const prompt = row.importOperatorPrompt !== undefined ? row.importOperatorPrompt : (importOperator ? (/Copy prompt:\s*([\s\S]+)/.exec(text)?.[1] || text) : undefined);
  return {
    ...row, actionId, role,
    ...(prompt !== undefined ? { importOperatorPrompt: prompt } : {}),
    affectedIds: rowAffectedIds(row),
    artifactRefs: ownRefs && ownRefs.length ? ownRefs : named.length ? named : ['execution/completion-report.json'],
    prerequisites: rowPrerequisites(row, importOperator),
    resolutionEvidence: typeof row.resolutionEvidence === 'string' && row.resolutionEvidence.trim() ? row.resolutionEvidence
      : `a later completion report no longer lists ${actionId}`,
  };
}
// The standing check: the rows that miss a structured field (empty list = every row is structured).
function unstructuredRows(actions) {
  return (actions || []).flatMap((row, index) => {
    const missing = STRUCTURED_FIELDS.filter(f => row?.[f] === undefined || row?.[f] === null || row?.[f] === ''
      || (f === 'affectedIds' && (!Array.isArray(row[f]) || !row[f].length)));
    if (row?.role === 'import-operator' && !row.importOperatorPrompt) missing.push('importOperatorPrompt');
    return missing.length ? [{ index, code: row?.code, missing }] : [];
  });
}

// Older producers write rows without actionId/role. Give each one, so the cutover list has one
// shape. Text that names the Import Operator keeps itself as the copyable prompt.
function structureLegacy(actions) {
  const seen = new Set();
  return actions.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const row = structureRow(raw);
    let id = row.actionId, n = 2;
    while (seen.has(id)) id = slug(`${row.actionId}:${n++}`);
    seen.add(id);
    return id === row.actionId ? row : { ...row, actionId: id };
  });
}

// Joined last by writeCompletionReport. `normalize` is completion-report's normalizeOperatorAction.
async function joinCutoverCoverage(projectDir, report, { plan = null, normalize, worseStatus } = {}) {
  const actions = [...(report.operatorActions || [])];
  const has = new Set(actions.map(a => a && a.actionId).filter(Boolean));
  const { droppedFields, actions: dropActions } = dropRows(plan);
  const records = recordActions(report.entityCompleteness, actions, await journalReasonKeys(projectDir, report.entityCompleteness));
  const added = [...records, ...reconciliationActions(report.unresolved, [...actions, ...records]), ...dropActions, ...await userActionRows(projectDir)];
  for (const row of added) if (!has.has(row.actionId)) { actions.push(normalize(row, actions.length)); has.add(row.actionId); }
  const knownDrops = new Set((report.droppedFields || []).map(r => `${r.entity}\t${r.field}`));
  const newDrops = droppedFields.filter(r => !knownDrops.has(`${r.entity}\t${r.field}`));
  return {
    ...report,
    status: newDrops.length && worseStatus ? worseStatus(report.status, 'complete_with_warnings') : report.status,
    droppedFields: [...(report.droppedFields || []), ...newDrops],
    operatorActions: structureLegacy(actions),
  };
}

module.exports = {
  JOURNAL_STATUS_KIND, DISPOSITION_KIND, ISSUE_KINDS,
  recordActions, journalReasonKeys, reconciliationActions, dropRows, countedDrop, userActionRows, structureLegacy, structureRow, unstructuredRows, STRUCTURED_FIELDS, joinCutoverCoverage,
  CUTOVER_COVERAGE_FILE: path.join('execution', 'completion-report.json'),
};
