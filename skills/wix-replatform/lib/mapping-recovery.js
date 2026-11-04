'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./source-location');
const A = require('./operation-assessments');
const LEDGER = 'mapping/review/mapping-gaps.json';
const validatedSources = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const read = (root, file, fallback) => {
  try { return require('./cached-json').readJson(path.join(root, file), fallback); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
};
function shape(row, d) {
  const r = d?.recovery, errors = [];
  if (d?.disposition !== 'deferred-field' && !(d?.disposition === 'unresolved' && r)) return errors;
  const held = d.disposition === 'unresolved' && r?.scope === 'record';
  if (!r || (r.scope !== 'field' && !held) || !r.source || !r.membership || !Array.isArray(r.evidence) || !r.evidence.length) return ['deferral needs recoverable source, membership and evidence'];
  if (!held) {
  if (!r.createWithoutField || !r.correction) return ['deferred field needs eligibility and correction evidence'];
  if (r.createWithoutField.optional !== true || r.createWithoutField.noMaterialBehaviorChange !== true || !r.createWithoutField.reason) errors.push('deferral requires optionality and unchanged material behavior');
  const create = r.createWithoutField;
  if (!create.operation || !create.targetRef || !create.writeInput || !Array.isArray(create.paths) || !create.paths.length || create.paths.some(p => !L.isExact(p))) errors.push('deferral requires exact withheld create fields');
  if (r.correction.mutable !== true || !r.correction.operation || !r.correction.targetRef || !r.correction.writeInput ||
      !Array.isArray(r.correction.paths) || !r.correction.paths.length || r.correction.paths.some(p => !L.isExact(p))) errors.push('deferral requires a supported exact correction path');
  }
  if (!row.discoveryCoverage?.sourceSnapshotDigest || r.sourceSnapshotDigest !== row.discoveryCoverage.sourceSnapshotDigest ||
      r.inventoryDigest !== row.discoveryCoverage.inventoryDigest) errors.push('deferral source scope is stale');
  if (!d.affectedScope?.sourceIdsComplete || d.affectedScope.countStatus !== 'known' || !Array.isArray(d.affectedScope.sourceIds)) errors.push('deferral needs complete measured affected membership');
  if (!d.nextAction?.cta || d.nextAction.requiresImportOperator !== true || !d.nextAction.prompt) errors.push('deferral requires an actionable Import Operator handoff');
  if (d.sourcePaths?.some(p => /password|credential|secret|access_token|refresh_token/i.test(p))) errors.push('restricted source data cannot be retained for deferred repair');
  if (row.discoveryCoverage?.paths?.some(p => p?.retentionClass === 'credential' && d.sourcePaths.some(s=>L.within(s,p.path) || L.within(p.path,s)))) errors.push('restricted source data cannot be retained for deferred repair');
  return errors;
}
function validate(projectDir, row, d) {
  const errors = shape(row, d);
  if (errors.length) fail('mapping_recovery_invalid');
  if (!d.recovery) return;
  const r = d.recovery;
  const bytes = A.artifact(projectDir, r.source), memberBytes = A.artifact(projectDir, r.membership);
  for (const e of r.evidence) A.artifact(projectDir, e);
  const cacheKey = A.digest([r,d.affectedScope,d.sourcePaths]);
  if (validatedSources.get(bytes)?.has(cacheKey)) return validatedSources.get(bytes).get(cacheKey);
  const records = bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const membership = JSON.parse(memberBytes);
  const ids = d.affectedScope.sourceIds.map(String).sort();
  if (!Array.isArray(membership) || membership.some(m => typeof m.sourceId !== 'string' || typeof m.sourceStableKey !== 'string' || !m.sourceStableKey) ||
      A.digest(membership.map(m => m.sourceId).sort()) !== A.digest(ids) || new Set(membership.map(m => m.sourceStableKey)).size !== ids.length ||
      ids.length !== d.affectedScope.count || new Set(ids).size !== ids.length) fail('mapping_recovery_membership_invalid');
  if (!r.sourceIdPath || !L.isExact(r.sourceIdPath)) fail('mapping_recovery_identity_missing');
  const byId = new Map();
  for (const record of records) {
    const values = L.valuesAt(record, r.sourceIdPath);
    // Source identity is deliberately scalar; never infer identity from array position.
    if (values.length !== 1 || !['string','number'].includes(typeof values[0])) fail('mapping_recovery_identity_ambiguous');
    const id = values[0];
    if (id !== undefined) {
      if (byId.has(String(id))) fail('mapping_recovery_identity_ambiguous');
      byId.set(String(id), record);
    }
  }
  if (ids.some(id => !byId.has(id))) fail('mapping_recovery_source_missing');
  if (ids.some(id => d.sourcePaths.some(p => !L.valuesAt(byId.get(id), p).length))) fail('mapping_recovery_source_field_missing');
  for (const e of r.evidence) A.artifact(projectDir, e);
  if (r.scope === 'field' && !r.evidence.some(e => e.kind === 'authoritative-schema' && e.revision)) fail('mapping_recovery_schema_missing');
  const result = { ids, byId, membership };
  if (!validatedSources.has(bytes)) validatedSources.set(bytes, new Map());
  validatedSources.get(bytes).set(cacheKey, result);
  return result;
}
function validatePlan(projectDir, plan, sourceEntityRefs = null) {
  const fields = require('./mapping-field-contract');
  for (const row of fields.entityRows(plan).filter(r=>!sourceEntityRefs || sourceEntityRefs.includes(fields.entityRef(r)))) for (const d of row.fieldMappings || []) if (d.recovery) validate(projectDir, row, d);
}
function ledger(projectDir) {
  const value = read(projectDir, LEDGER, []);
  const gaps = Array.isArray(value) ? value : value?.gaps;
  if (!Array.isArray(gaps)) fail('mapping_recovery_ledger_invalid');
  return { value, gaps };
}
function assertPersisted(projectDir, plan, sourceEntityRefs = null) {
  validatePlan(projectDir, plan, sourceEntityRefs);
  const fields = require('./mapping-field-contract');
  const { gaps } = ledger(projectDir);
  for (const ref of (plan.recoveryGapRefs || []).filter(r=>!sourceEntityRefs || sourceEntityRefs.includes(r.sourceEntity))) {
    const g = gaps.find(g=>g.id===ref.id);
    if (!g || A.digest([g.recovery,g.affectedScope])!==ref.recoveryDigest) fail('mapping_recovery_gap_not_persisted');
  }
  for (const row of fields.entityRows(plan).filter(r=>!sourceEntityRefs || sourceEntityRefs.includes(fields.entityRef(r)))) for (const expected of fields.gapRows(row).filter(g => g.recovery)) {
    const stored = gaps.find(g => g.id === expected.id);
    if (!stored || A.digest(stored.recovery) !== A.digest(expected.recovery) || A.digest(stored.affectedScope) !== A.digest(expected.affectedScope)) fail('mapping_recovery_gap_not_persisted');
  }
}
function assertPayload(projectDir, plan, targetRefs, payload, { writeInput = null, sourceStableKey } = {}) {
  const fields = require('./mapping-field-contract');
  const relevant = fields.entityRows(plan).filter(r=>targetRefs.includes(r.targetRef) || r.fieldMappings?.some(d=>targetRefs.includes(d.recovery?.createWithoutField?.targetRef))).map(fields.entityRef);
  assertPersisted(projectDir, plan, relevant);
  for (const row of require('./mapping-field-contract').entityRows(plan)) for (const d of row.fieldMappings || []) {
    if (d.disposition === 'unresolved' && d.recovery?.scope === 'record' && targetRefs.includes(row.targetRef)) {
      const members = JSON.parse(A.artifact(projectDir,d.recovery.membership));
      if (!sourceStableKey || members.some(m=>m.sourceStableKey===sourceStableKey)) fail('mapping_recovery_record_held');
    }
    if (d.disposition !== 'deferred-field' || !targetRefs.includes(d.recovery.createWithoutField.targetRef)) continue;
    const members = JSON.parse(A.artifact(projectDir, d.recovery.membership));
    if (!sourceStableKey) fail('mapping_recovery_identity_required');
    if (!members.some(m => m.sourceStableKey === sourceStableKey)) continue;
    const input = d.recovery.createWithoutField.writeInput;
    const body = writeInput ? payload?.[writeInput] : payload && Object.hasOwn(payload,input) ? payload[input] : payload;
    for (const p of d.recovery.createWithoutField.paths) {
      const relative = p.startsWith(input + '.') ? p.slice(input.length + 1) : p;
      if (L.valuesAt(body, relative).some(v => v !== undefined)) fail('mapping_recovery_deferred_field_written');
    }
  }
}
function permitsDisposition(projectDir, plan, row, disposition) {
  if (disposition.status !== 'deferred' || !disposition.decisionRefs?.length) return false;
  try {
    assertPersisted(projectDir, plan, [require('./mapping-field-contract').entityRef(row)]);
    const expected = require('./mapping-field-contract').projectEntity(row).fieldDispositions.find(d => d.kind === disposition.kind && d.path === disposition.path && d.writeOperation === disposition.writeOperation);
    return expected?.status === 'deferred' && A.digest(expected) === A.digest(disposition);
  } catch { return false; }
}
function pendingSummary(projectDir) {
  const { gaps } = ledger(projectDir);
  return gaps.filter(g => g.recovery).map(g => ({
    gapId: g.id, entity: g.sourceEntity, decisionId: g.decisionId, affectedScope: g.affectedScope,
    source: g.recovery.source, correction: g.recovery.correction, scope:g.recovery.scope,
    status: 'pending', nextAction: g.nextAction, membership: g.recovery.membership,
    resolvedSourceIds: verifiedIds(projectDir, g),
  })).filter(g => g.affectedScope.sourceIds.some(id => !g.resolvedSourceIds.includes(String(id))));
}
// The ledger is a projection. Only append-only, source-bound repair evidence closes membership.
function decisionDigest(row, decision) {
  const { id, sourcePaths, selectors, disposition, transform, valuePolicy, referencePolicy, outputs, affectedScope, affectedScopes } = decision;
  return A.digest({ targetRef: row.targetRef, sourceSnapshotDigest: row.discoveryCoverage?.sourceSnapshotDigest,
    inventoryDigest: row.discoveryCoverage?.inventoryDigest,
    id, sourcePaths, selectors, disposition, transform, valuePolicy, referencePolicy, outputs, affectedScope, affectedScopes });
}
function verifiedIds(projectDir, gap) {
  try { A.artifact(projectDir,gap.recovery.source); A.artifact(projectDir,gap.recovery.membership); for(const e of gap.recovery.evidence)A.artifact(projectDir,e); }
  catch { return []; }
  const journal = require('./local-state').attemptJournalPath(projectDir);
  let lines;
  try { lines = fs.readFileSync(journal, 'utf8'); } catch(e) { if(e.code === 'ENOENT') return []; throw e; }
  const fields = require('./mapping-field-contract'), plan = read(projectDir,'mapping/mapping-plan.json',{});
  const row = fields.entityRows(plan).find(r=>fields.entityRef(r)===gap.sourceEntity);
  const decision = row?.fieldMappings?.find(d=>d.id===gap.decisionId || d.supersedes?.includes(gap.decisionId));
  const required = gap.recovery.scope === 'field' ? gap.recovery.correction.paths : decision?.outputs?.map(o=>o.targetPath);
  if (!required?.length || !decision?.outputs?.length) return [];
  let journalRows;try {journalRows=lines.split(/\r?\n/).filter(Boolean).map(JSON.parse);}catch{return [];}
  const verified = journalRows.filter(r => r.status === 'imported' &&
    r.mappingRepair?.gapId === gap.id && r.mappingRepair.sourceDigest === gap.recovery.source.sha256 &&
    r.mappingRepair.membershipDigest === gap.recovery.membership.sha256 && r.mappingRepair.observedDigest &&
    (r.mappingRepair.decisionDigest ? r.mappingRepair.decisionDigest === decisionDigest(row, decision) :
      r.mappingRepair.mappingPlanDigest === fields.digest(plan)) && r.targetId);
  return [...new Set(verified.map(r=>r.mappingRepair.sourceId))].filter(id=>required.every(p=>verified.some(r=>r.mappingRepair.sourceId===id && r.mappingRepair.targetPath===p)));
}
async function joinReport(projectDir, report) {
  const plan = read(projectDir,'mapping/mapping-plan.json',{}), saved = ledger(projectDir);
  const missing = (plan.recoveryGapRefs || []).filter(ref=>!saved.gaps.some(g=>g.id===ref.id && A.digest([g.recovery,g.affectedScope])===ref.recoveryDigest));
  if (missing.length) return {...report,status:report.status==='aborted'?'aborted':'blocked',mappingRecovery:{unknownCounts:true,missingGapIds:missing.map(g=>g.id)},
    operatorActions:[...(report.operatorActions || []),{code:'mapping-recovery-ledger-missing',severity:'high',action:'Requires Import Operator: restore the pinned mapping gap ledger from the original migration artifacts before continuing or declaring completion.',deadlineReason:'Before continuing import or launch.',affectedCount:null,artifactRefs:[LEDGER]}]};
  const pending = pendingSummary(projectDir);
  if (!pending.length) {
    if (!plan.recoveryGapRefs?.length) return report;
    const {pendingFields:_pending,mappingRecovery:_recovery,...rest}=report;
    return {...rest,operatorActions:(report.operatorActions || []).filter(a=>a.code!=='mapping-field-pending')};
  }
  const actions = (report.operatorActions || []).filter(a => a.code !== 'mapping-field-pending');
  for (const g of pending) actions.push({ code: 'mapping-field-pending', entity: g.entity, severity: 'high',
    reason: g.scope === 'record' ? 'Records remain pending a mapping decision; retained source data has not been accepted as loss.' : 'Imported fields do not complete this record: retained source fields still need a mapping decision and verified repair.',
    action: `Requires Import Operator: ${g.nextAction?.prompt || 'Resolve the pending mapping and repair existing target identities.'}`,
    affectedCount: g.affectedScope.sourceIds.length - g.resolvedSourceIds.length, deadlineReason: 'Before launch or relying on the pending field.',
    actionId: g.gapId, role: 'import-operator', importOperatorPrompt: g.nextAction.prompt,
    affectedIds: g.affectedScope.sourceIds.filter(id => !g.resolvedSourceIds.includes(String(id))), artifactRefs: [LEDGER, g.source.artifact],
    prerequisites: ['Current retained source', 'Approved revised mapping', 'Verified target identity and current target state'],
    resolutionEvidence: 'Read-back of the repaired field bound to source, target and mapping decision.' });
  const local = require('./local-state');
  let unknownCounts = false;
  const crosswalk = await local.loadCrosswalk(projectDir).catch(()=>{unknownCounts=true;return {bySource:{}};});
  const journal = await local.loadAttemptJournal(projectDir).catch(()=>{unknownCounts=true;return {rows:[]};});
  const attemptsByKey = new Map();
  for(const r of journal.rows) {if(!attemptsByKey.has(r.sourceStableKey))attemptsByKey.set(r.sourceStableKey,[]);attemptsByKey.get(r.sourceStableKey).push(r);}
  const records = new Map();
  for (const g of pending) {
   let members;
   try {A.artifact(projectDir,g.source);members=JSON.parse(A.artifact(projectDir,g.membership));}
   catch {unknownCounts=true;members=g.affectedScope.sourceIds.map(sourceId=>({sourceId,sourceStableKey:null}));}
   for (const m of members) {
    if (g.resolvedSourceIds.includes(m.sourceId)) continue;
    const cw = crosswalk.bySource[m.sourceStableKey];
    const attempts = attemptsByKey.get(m.sourceStableKey) || [];
    const status = !m.sourceStableKey || unknownCounts ? 'needs-reconciliation' : cw?.targetId ? 'landed-with-pending-fields' : attempts.some(r => !['deferred','skipped_safe_mode_blocked','skipped_out_of_scope','skipped_unexpected'].includes(r.status)) ? 'needs-reconciliation' : 'not-yet-imported';
    records.set(m.sourceStableKey || `${g.entity}:${m.sourceId}`, { sourceStableKey: m.sourceStableKey, status, targetId: cw?.targetId || null });
   }
  }
  const counts = Object.fromEntries(['landed-with-pending-fields','not-yet-imported','needs-reconciliation'].map(s => [s, [...records.values()].filter(r => r.status === s).length]));
  // Crosswalk identity proves a parent landed; it does not prove full fidelity. Use the
  // existing completeness totals as the base and keep a null when that base is unavailable.
  const landed = report.entityCompleteness?.reduce((n,r)=>n+(r.imported || 0)+(r.alreadyPresentByCrosswalk || 0),0);
  const fullyImported = Number.isSafeInteger(landed) && landed>=counts['landed-with-pending-fields'] && !unknownCounts && !counts['needs-reconciliation'] ? landed-counts['landed-with-pending-fields'] : null;
  return { ...report, status: report.status === 'aborted' ? 'aborted' : 'blocked', pendingFields: pending,
    mappingRecovery: { counts:{...counts,fullyImported}, records: [...records.values()], unknownCounts }, operatorActions: actions };
}
// Repair is ordinary generated execution: the mapper supplies the revised exact binding and
// caller uses the existing guarded writer. No callback chooses a mapping or a target identity.
async function repair({ projectDir, gapId, sourceId, targetId, mappingPlanDigest, outputId, expected,
  readTarget, writeTarget, verify, runId, taskId, siteId }) {
  const fields = require('./mapping-field-contract');
  const plan = read(projectDir, 'mapping/mapping-plan.json');
  if (!plan || fields.digest(plan) !== mappingPlanDigest) fail('mapping_repair_mapping_stale');
  const { gaps } = ledger(projectDir), gap = gaps.find(g => g.id === gapId);
  if (!gap?.recovery || !gap.affectedScope?.sourceIds?.map(String).includes(String(sourceId))) fail('mapping_repair_scope_invalid');
  const row = fields.entityRows(plan).find(r => fields.entityRef(r) === gap.sourceEntity);
  fields.assertExecutionScope(plan, gap.sourceEntity, mappingPlanDigest, projectDir);
  const approval=read(projectDir,'orchestration/approvals.json',{}).mapping;
  if (approval?.status!=='approved' || approval.decidedBy!=='user' || !await require('./census-reconciliation').mappingApprovalBound(projectDir,approval)) fail('mapping_repair_approval_required');
  const d = row.fieldMappings.find(d => d.id === gap.decisionId || d.supersedes?.includes(gap.decisionId));
  const output = d?.outputs?.find(o => o.id === outputId);
  const fieldRepair = gap.recovery.scope === 'field';
  if (!output || ['unresolved','deferred-field','excluded'].includes(d.disposition) || fieldRepair && (output.writeOperation !== gap.recovery.correction.operation ||
      output.targetRef !== gap.recovery.correction.targetRef || !gap.recovery.correction.paths.includes(output.targetPath))) fail('mapping_repair_requires_mapping');
  // Actual target identity must come from the journal/crosswalk adapter, not a caller-made ID.
  if (!targetId || !runId || !taskId || !siteId || typeof verify !== 'function') fail('mapping_repair_identity_required');
  const local = require('./local-state');
  const member = JSON.parse(A.artifact(projectDir, gap.recovery.membership)).find(m => m.sourceId === String(sourceId));
  const crosswalk = await local.loadCrosswalk(projectDir);
  const identity = member && crosswalk.bySource[member.sourceStableKey];
  if (!identity || identity.targetId !== targetId || identity.targetEntityType !== output.targetRef || identity.siteId !== siteId) fail('mapping_repair_identity_conflict');
  if (row.discoveryCoverage.sourceSnapshotDigest !== gap.recovery.sourceSnapshotDigest || row.discoveryCoverage.inventoryDigest !== gap.recovery.inventoryDigest) fail('mapping_repair_source_stale');
  const attemptId = crypto.randomUUID();
  const mappingRepair = { gapId, sourceId: String(sourceId), mappingPlanDigest, decisionDigest:decisionDigest(row,d), outputId, targetPath:output.targetPath,
    sourceDigest: gap.recovery.source.sha256, membershipDigest: gap.recovery.membership.sha256 };
  const recordAttempt = (status, extra = {}) => local.appendAttempt(projectDir, {schemaVersion:1, attemptId,
    sourceStableKey:member.sourceStableKey, writeSpecId:taskId, operation:'update', targetEntityType:output.targetRef,
    targetId, siteId, runId, phase:'import', ts:new Date().toISOString(), status, mappingRepair:{...mappingRepair,...extra}});
  const retained = validate(projectDir,row,{disposition:fieldRepair?'deferred-field':'unresolved',sourcePaths:gap.sourcePaths,
    recovery:gap.recovery,affectedScope:gap.affectedScope,nextAction:gap.nextAction});
  const sourceRecord=retained.byId.get(String(sourceId));
  if (!sourceRecord) fail('mapping_repair_source_missing');
  if (d.affectedScope?.sourceIdsComplete && !d.affectedScope.sourceIds?.map(String).includes(String(sourceId))) fail('mapping_repair_scope_invalid');
  if (output.appliesWhen && !require('./output-applicability').evaluate(output.appliesWhen,sourceRecord)) fail('mapping_repair_scope_invalid');
  const actual = await readTarget({ targetId, output });
  if (!fieldRepair && A.digest(actual) !== A.digest(expected)) fail('mapping_repair_created_record_unverified');
  const journal = await local.loadAttemptJournal(projectDir);
  const prior = journal.rows.filter(r => r.status === 'imported' && r.targetId === targetId && r.siteId === siteId &&
    r.targetEntityType === output.targetRef && r.sourceStableKey === member.sourceStableKey &&
    r.mappingRepair?.gapId === gapId && r.mappingRepair.sourceId === String(sourceId) &&
    r.mappingRepair.sourceDigest === gap.recovery.source.sha256 && r.mappingRepair.membershipDigest === gap.recovery.membership.sha256 &&
    r.mappingRepair.targetPath === output.targetPath && r.mappingRepair.observedDigest).at(-1);
  // The initial supported state is absence: this field was deliberately withheld. Later
  // baselines come only from verified journal evidence, never a caller's claimed value.
  const previousDigest = prior?.mappingRepair.observedDigest || A.digest(undefined);
  if (A.digest(actual) !== previousDigest && A.digest(actual) !== A.digest(expected)) fail('mapping_repair_target_conflict');
  if (A.digest(actual) !== A.digest(expected)) {
    await recordAttempt('started');
    await writeTarget({ targetId, output, expected });
  }
  const observed = await readTarget({ targetId, output });
  if (!(await verify({ expected, observed, output }))) fail('mapping_repair_unverified');
  await recordAttempt('imported', {observedDigest:A.digest(observed)});
  let telemetryPending = false;
  try {
    const recorder = require('../resources/rp-telemetry/lib/telemetry-recorder');
    await recorder.record(projectDir, require('../resources/rp-telemetry/lib/knowledge-observation').event({findingClass:'missing-knowledge',
      targetRef:output.targetRef,operation:output.writeOperation,toolkitVersion:recorder.resolveSkillsVersion() || 'unknown',
      outcome:'verified-repair',verificationLevel:'read-back',affectedCount:1}));
  } catch { telemetryPending = true; }
  return { verified: true, targetId, gapId, sourceId: String(sourceId), mappingPlanDigest, outputId, observedDigest: A.digest(observed), telemetryPending };
}
module.exports = { shape, validate, validatePlan, assertPersisted, assertPayload, permitsDisposition, pendingSummary, joinReport, repair, verifiedIds };
