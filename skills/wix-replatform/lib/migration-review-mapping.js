'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fields = require('./mapping-field-contract.js');
const PLAN = 'mapping/mapping-plan.json';
const LEDGER = 'mapping/review/mapping-gaps.json';
const CATEGORIES = ['source_scope', 'mapping_fidelity', 'execution_recovery', 'setup_plugin', 'explanations_checks'];
const hashBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)].sort();
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function mappingScope(sourceEntity) {
  if (typeof sourceEntity !== 'string' || !sourceEntity) fail('mapping_binding_required', 'source entity identity is required');
  return `mapping:${hashBytes(sourceEntity).slice(0,24)}`;
}
function mappingScopes(plan, entityRefs = plan.executionScope?.selectedEntityRefs) {
  if (!Array.isArray(entityRefs) || !entityRefs.length || entityRefs.some(ref => !plan.executionScope?.selectedEntityRefs?.includes(ref))) fail('mapping_binding_required', 'mapping scopes must name selected source entities');
  return unique(entityRefs.filter(ref=>fields.entityRows(plan).find(row=>fields.entityRef(row)===ref)?.targetClassification!=='manual-mapping').map(mappingScope));
}
async function readFrame(projectDir, expectedDigest) {
  const plan = JSON.parse(await fs.readFile(path.join(projectDir,PLAN),'utf8'));
  if (plan.fieldContractVersion !== 1 || !expectedDigest || fields.digest(plan) !== expectedDigest) fail('mapping_binding_required','current exact mapping authority must match the importer pin');
  const rows = fields.entityRows(plan), refs = rows.map(fields.entityRef), scope = plan.executionScope;
  if (!scope || !scope.selectedEntityRefs?.length || unique(refs).length !== refs.length || unique(scope.selectedEntityRefs).length !== scope.selectedEntityRefs.length || scope.selectedEntityRefs.some(ref=>!refs.includes(ref))) fail('mapping_binding_required','mapping execution scope is invalid');
  for (const row of rows) {
    const errors = fields.validateEntity(row); if (errors.length) fail('mapping_binding_required',errors.join('; '));
    if (row.targetClassification!=='manual-mapping') for (const d of row.fieldMappings) {
      const scope=fields.affectedScope(d.affectedScope,row.discoveryCoverage);
      if (scope.sourceSnapshotDigest!==row.discoveryCoverage.sourceSnapshotDigest || scope.inventoryDigest!==row.discoveryCoverage.inventoryDigest) fail('mapping_binding_required','decision scope proof belongs to a different source snapshot or inventory');
    }
  }
  const deferred = (scope.deferredEntities || []).map(d=>d.entityRef);
  if (!Array.isArray(scope.resolvedEntityRefs) || unique(deferred).length!==deferred.length || unique(scope.resolvedEntityRefs).length!==scope.resolvedEntityRefs.length || unique([...scope.resolvedEntityRefs,...deferred]).length !== scope.selectedEntityRefs.length || scope.selectedEntityRefs.some(ref=>scope.resolvedEntityRefs.includes(ref) === deferred.includes(ref))) fail('mapping_binding_required','resolved and deferred mapping scopes must partition selected entities');
  for (const ref of scope.resolvedEntityRefs) if (rows.find(row=>fields.entityRef(row)===ref).targetClassification!=='manual-mapping') fields.assertExecutionScope(plan,ref,expectedDigest,projectDir);
  const projected = fields.compareMappingProjections(projectDir,plan);
  if (!projected.ok) fail('mapping_binding_required',projected.errors.join('; '));
  const ledger = JSON.parse(await fs.readFile(path.join(projectDir,LEDGER),'utf8'));
  const gaps = Array.isArray(ledger) ? ledger : ledger.gaps;
  if (!Array.isArray(gaps)) fail('mapping_binding_required','field-gap ledger is missing');
  const active = rows.flatMap(fields.gapRows), activeGaps = [];
  for (const expected of active) {
    const matches = gaps.filter(g=>g.id===expected.id);
    if (matches.length!==1) fail('mapping_binding_required',`missing or duplicate gap ${expected.id}`);
    const actual=matches[0];
    for (const key of ['sourceEntity','decisionId','sourcePaths','disposition','storage','affectedScope','recovery']) {
      if (fields.canonical(actual[key])!==fields.canonical(expected[key])) fail('mapping_binding_required',`gap ${expected.id} has stale ${key}`);
    }
    activeGaps.push(actual);
  }
  const recovery = require('./mapping-recovery');
  // A mapping revision plans a repair; it cannot erase a still-unrepaired field.
  for (const gap of gaps.filter(g => g.recovery && !activeGaps.some(a => a.id === g.id))) {
    const verifiedSourceIds = recovery.verifiedIds(projectDir,gap);
    const complete = !gap.affectedScope.sourceIds.some(id => !verifiedSourceIds.includes(String(id)));
    if (!complete || gap.nativeBehaviorMissing?.length) activeGaps.push({...gap,verifiedSourceIds,recoveryStatus:complete?'verified':'pending'});
  }
  return {plan,ledger,rows,activeGaps,mappingPlanDigest:expectedDigest,gapLedgerDigest:fields.digest(ledger),executionScopeDigest:fields.digest(scope)};
}
function commonEvidence(frame,ref) {
  return {mappingPlanDigest:frame.mappingPlanDigest,gapLedgerDigest:frame.gapLedgerDigest,executionScopeDigest:frame.executionScopeDigest,sourceEntity:ref};
}
function facets(gap,row,authorizedOmissions=false) {
  const d=row.fieldMappings?.find(d=>d.id===gap.decisionId);
  if (gap.recovery) return [...(gap.recoveryStatus==='verified'?[]:['storage']),...(gap.nativeBehaviorMissing?.length?['behavior']:[])];
  // Mapping consent permits the write; it does not resolve an absent behavior.
  if (gap.gapKind==='excluded' && d && (!fields.pendingDecision(row,d) || authorizedOmissions)) return gap.nativeBehaviorMissing?.length ? ['behavior'] : [];
  if (gap.gapKind==='no-native-target') return ['storage',...(gap.nativeBehaviorMissing?.length ? ['behavior'] : [])];
  if (gap.gapKind==='setup-blocked') return ['setup'];
  return [gap.gapKind==='lossy' ? 'behavior' : 'decision'];
}
function finding(gap,facet) {
  const unknown = gap.affectedScope.countStatus!=='known';
  const native = (gap.nativeBehaviorMissing || []).join('; ');
  const consequence = facet==='behavior' ? native || gap.description : facet==='storage' ? 'Retained values require matching storage and write verification; native behavior is assessed separately.' : gap.description;
  return {findingKey:`${gap.id}:${facet}`,scopeKey:mappingScope(gap.sourceEntity),group:'Data',
    title:`${gap.sourceEntity}: ${facet}`,summary:gap.description,affected:gap.affectedScope.sourceIds || [],
    affectedCount:unknown ? null : gap.affectedScope.count,unknownAreas:unknown ? ['affected-count'] : [],
    intendedBehavior:fields.canonical({sourcePaths:gap.sourcePaths,targetRef:gap.targetRef,writeOperation:gap.writeOperation,storage:gap.storage,nativeBehaviorMissing:gap.nativeBehaviorMissing,limitation:gap.limitation,evidenceScopeDigest:fields.digest(gap.affectedScope)}),
    consequence,action:facet==='behavior' ? gap.nextAction?.cta || 'Review and explicitly accept or resolve the remaining behavior consequence.' : `Requires Import Operator: ${gap.nextAction?.cta || 'Inspect the referenced mapping/setup evidence and run the existing matching check.'}`,
    prerequisites:unique(gap.nextAction?.prerequisites || []),requirement:'required',
    verificationPolicy:facet==='behavior' ? 'manual' : 'machine_required',evidenceStatus:'unassessed',
    dismissalAcknowledgment:consequence};
}
function pinned(capture,frame,ref) {
  const evidence=capture.evidence;
  return evidence?.sourceEntity===ref && ['mappingPlanDigest','gapLedgerDigest','executionScopeDigest'].every(key=>evidence[key]===frame[key]);
}
async function outcomeEvidence(projectDir,artifact,sourceEntity) {
  if (typeof artifact!=='string' || path.isAbsolute(artifact)) fail('mapping_outcome_required','outcome artifact must be project-relative');
  let root,file,stat,bytes,row;
  try {
    root=await fs.realpath(projectDir);file=await fs.realpath(path.resolve(root,artifact));
    stat=await fs.stat(file);
    if (!file.startsWith(`${root}${path.sep}`)) fail('mapping_outcome_required','outcome artifact escapes the project');
    if (!stat.isFile() || stat.size>1024*1024) fail('mapping_outcome_required','outcome artifact must be a bounded final entity row');
    bytes=await fs.readFile(file);row=JSON.parse(bytes);
  } catch(cause) {
    if (cause.code==='mapping_outcome_required') throw cause;
    throw Object.assign(new Error('read the durable final outcome artifact before resuming mapping publication',{cause}),{code:'mapping_outcome_required'});
  }
  if (!row || typeof row!=='object' || row.sourceEntity!==sourceEntity || !row.outcomeCounters) fail('mapping_outcome_required','outcome artifact must bind the source entity and final counters');
  const counters={};
  for (const key of ['attempted','succeeded','failed','deferred','unresolved']) {
    const n=row.outcomeCounters[key];if (!Number.isSafeInteger(n) || n<0) fail('mapping_outcome_required',`outcome counter ${key} must be measured`);counters[key]=n;
  }
  return {outcomeCounters:counters,outcomeArtifact:{path:artifact,sha256:hashBytes(bytes)}};
}

// Registration belongs to the generated importer. All capture producers share its queue.
async function createMappingReviewAdapter({projectDir,producerId,executionId,migrationId,mappingPlanDigest,captureQueue,assessedSourceEntityRefs=null,repairOf=null,probeNonce=null,review=null}) {
  review=review || require('./migration-review.js');
  const frame=await readFrame(projectDir,mappingPlanDigest);
  const expectedScopes=mappingScopes(frame.plan,assessedSourceEntityRefs || frame.plan.executionScope.selectedEntityRefs);
  // An initial execution registers every selected scope, held ones included. Only a repair
  // naming an earlier import execution that registered the subset may assess fewer.
  if (fields.canonical(expectedScopes)!==fields.canonical(mappingScopes(frame.plan))) {
    const prior=repairOf && repairOf!==executionId ? await review.readExecutionEvidence(projectDir,repairOf).catch(()=>null) : null;
    if (!prior || prior.execution.producerId!==producerId || prior.execution.executionKind!=='import' || expectedScopes.some(s=>!prior.execution.assessedScope.includes(s))) fail('mapping_execution_required','an initial execution registers selected and held mapping scopes; a subset needs repairOf naming the earlier import execution that registered it');
  }
  async function current() {
    const next=await readFrame(projectDir,mappingPlanDigest);
    if (next.gapLedgerDigest!==frame.gapLedgerDigest) fail('mapping_binding_required','gap ledger changed; resume with explicit current mapping evidence');
    const retained=await review.readExecutionEvidence(projectDir,executionId);
    if (retained.execution.producerId!==producerId || retained.execution.executionKind!==(probeNonce ? 'probe' : 'import')) fail('mapping_execution_required','mapping evidence requires the stored canonical owner and explicit execution kind');
    if (fields.canonical(unique(retained.execution.assessedScope.filter(s=>s.startsWith('mapping:'))))!==fields.canonical(expectedScopes)) fail('mapping_execution_required','registered mapping scopes must match the explicit initial/repair assessment');
    if (retained.captures.some(c=>c.category==='mapping_fidelity' && !c.evidence.probeNonce && Object.hasOwn(c.evidence,'gapLedgerDigest') && c.evidence.gapLedgerDigest!==frame.gapLedgerDigest)) fail('mapping_binding_required','gap ledger changed; start an explicit repair execution and recapture current mapping evidence');
    const report=await review.readReport(projectDir);
    if (report.migrationId!==migrationId) fail('mapping_binding_required','review store belongs to a different migration');
    const selected=frame.plan.executionScope.selectedEntityRefs.filter(ref=>frame.rows.find(row=>fields.entityRef(row)===ref).targetClassification!=='manual-mapping' && retained.execution.assessedScope.includes(mappingScope(ref)));
    if (!selected.length) fail('mapping_execution_required','execution has no selected mapping scopes');
    return {...retained,selected,report};
  }
  await current();
  async function capture(ref,phase,evidence,sequence=0) {
    if (!captureQueue) fail('mapping_capture_queue_required','use the importer’s shared evidence capture queue');
    if (!Number.isSafeInteger(sequence) || sequence<0) fail('mapping_binding_required','capture sequence must be a nonnegative checkpoint ordinal');
    const state=await current();
    if (!state.selected.includes(ref)) fail('mapping_execution_required','entity is outside this execution’s registered mapping scope');
    if (probeNonce) evidence={...evidence,probeNonce};
    const identity=fields.digest({producerId,executionId,scope:mappingScope(ref),phase,sequence,evidence});
    return captureQueue({contractVersion:review.CONTRACT_VERSION,migrationId,executionId,requestId:`mapping-capture:${identity}`,captureId:`mapping-capture:${identity}`,category:'mapping_fidelity',scope:[mappingScope(ref)],phase,sequence,evidence});
  }
  async function captureBeforeWrite() {
    const state=await current(),receipts=[];
    for (const ref of state.selected) {
      const row=frame.rows.find(r=>fields.entityRef(r)===ref),deferred=frame.plan.executionScope.deferredEntities.find(d=>d.entityRef===ref);
      const unknownAreas=unique([...(row.discoveryCoverage?.uninspectedAreas || []).map(x=>typeof x==='string'?x:fields.canonical(x)),...(deferred ? ['deferred-mapping'] : [])]);
      const evidence={...commonEvidence(frame,ref),fieldGaps:frame.activeGaps.filter(g=>g.sourceEntity===ref),unknownAreas,
        ...(deferred ? {executionDisposition:'deferred',decisionIds:deferred.decisionIds,reason:deferred.reason,blockedByEntityRefs:deferred.blockedByEntityRefs} : {executionDisposition:'resolved'})};
      receipts.push(await capture(ref,'before-write',evidence));
    }
    return receipts;
  }
  async function captureWriteOutcome(sourceEntity,{outcomeArtifact,unknownAreas=[],sequence=0}) {
    if (!frame.plan.executionScope.resolvedEntityRefs.includes(sourceEntity)) fail('mapping_outcome_required','deferred mapping has no write outcome');
    if (!Array.isArray(unknownAreas) || unknownAreas.some(x=>typeof x!=='string')) fail('mapping_outcome_required','outcome unknown areas must be named');
    const {captures}=await current();
    if (!captures.some(c=>c.category==='mapping_fidelity' && c.phase==='before-write' && c.scope.includes(mappingScope(sourceEntity)) && pinned(c,frame,sourceEntity))) fail('mapping_outcome_required','capture current before-write mapping evidence before outcomes');
    const observed=await outcomeEvidence(projectDir,outcomeArtifact,sourceEntity);
    const evidence={...commonEvidence(frame,sourceEntity),...observed,unknownAreas:unique(unknownAreas),...(probeNonce ? {probeNonce} : {})};
    if (captures.some(c=>c.category==='mapping_fidelity' && c.phase==='write-outcome' && c.scope.includes(mappingScope(sourceEntity)) && pinned(c,frame,sourceEntity) && c.sequence===sequence && fields.canonical(c.evidence)!==fields.canonical(evidence))) fail('mapping_outcome_required','changed outcome evidence requires a new checkpoint ordinal');
    return capture(sourceEntity,'write-outcome',evidence,sequence);
  }
  async function publish({captureIds,completionReportDigest=null}={}) {
    if (probeNonce) fail('mapping_execution_required','isolated probe evidence cannot publish import mapping tasks');
    const state=await current(),all=state.captures;
    const ids=captureIds===undefined ? all.map(c=>c.captureId) : unique(captureIds);
    if (ids.some(id=>!all.some(c=>c.captureId===id))) fail('mapping_binding_required','publication references missing or foreign execution captures');
    const selected=all.filter(c=>ids.includes(c.captureId) && !c.evidence.probeNonce);
    const receipts=[];
    for (const ref of state.selected) {
      const scopeKey=mappingScope(ref);
      let scoped=selected.filter(c=>c.scope.includes(scopeKey));
      const outcomes=all.filter(c=>c.scope.includes(scopeKey) && !c.evidence.probeNonce && c.category==='mapping_fidelity' && c.phase==='write-outcome' && pinned(c,frame,ref));
      if (outcomes.length) {
        const latest=Math.max(...outcomes.map(c=>c.sequence));
        const final=outcomes.filter(c=>c.sequence===latest);
        if (unique(final.map(c=>fields.canonical(c.evidence))).length!==1) fail('mapping_outcome_required','final outcome checkpoint has conflicting evidence');
        const proof=final[0],actual=await outcomeEvidence(projectDir,proof.evidence.outcomeArtifact.path,ref);
        if (fields.canonical(actual.outcomeArtifact)!==fields.canonical(proof.evidence.outcomeArtifact) || fields.canonical(actual.outcomeCounters)!==fields.canonical(proof.evidence.outcomeCounters)) fail('mapping_outcome_required','durable outcome changed without a matching final capture');
        scoped=scoped.filter(c=>!outcomes.includes(c) || c.sequence===latest);
      }
      const unknown=unique(scoped.flatMap(c=>c.evidence.unknownAreas || c.evidence.unassessed || c.evidence.unknown || []));
      for (const phase of ['before-write','write-outcome']) {
        if (!scoped.some(c=>c.category==='mapping_fidelity' && c.phase===phase && pinned(c,frame,ref))) unknown.push(`mapping-boundary:${phase}`);
      }
      const complete=!unknown.length && CATEGORIES.every(category=>scoped.some(c=>c.category===category));
      const row=frame.rows.find(r=>fields.entityRef(r)===ref),gaps=frame.activeGaps.filter(g=>g.sourceEntity===ref);
      const authorizedOmissions=row.omissionReviewRequested && frame.plan.executionScope.resolvedEntityRefs.includes(ref); // readFrame already verified the exact approval
      const tasks=gaps.flatMap(g=>facets(g,row,authorizedOmissions).map(facet=>finding(g,facet)));
      for (const task of tasks.filter(t=>t.verificationPolicy==='machine_required' && !t.findingKey.endsWith(':decision'))) {
        const fingerprint=review.materialFingerprint(task);
        const proof=scoped.find(c=>c.category==='explanations_checks' && (c.evidence.checks || []).some(check=>check.findingKey===task.findingKey && check.materialFingerprint===fingerprint && check.kind==='machine' && check.status==='passed' && check.checkId && Number.isFinite(Date.parse(check.observedAt))));
        if (proof) Object.assign(task,{evidenceStatus:'verified',verificationCaptureId:proof.captureId});
      }
      const results=gaps.filter(g=>g.gapKind==='excluded' && (authorizedOmissions || !fields.pendingDecision(row,row.fieldMappings.find(d=>d.id===g.decisionId)))).map(g=>({resultKey:`${g.id}:decision`,scopeKey,group:'Data',title:`${ref}: exclusion recorded`,status:'notMigrated',summary:g.description,affectedCount:g.affectedScope.count,affected:g.affectedScope.sourceIds || [],intendedBehavior:fields.canonical({sourcePaths:g.sourcePaths,evidenceScopeDigest:fields.digest(g.affectedScope)})}));
      // Only explicit matching committed dispositions close historical facets. Omission never does.
      const changes=new Map();
      const oldTasks=state.report.tasks.filter(t=>t.producerId===producerId && t.scopeKey===scopeKey && t.findingKey.startsWith('field-gap:') && !tasks.some(n=>n.findingKey===t.findingKey));
      for (const task of oldTasks) for (const proof of scoped) for (const d of proof.evidence.dispositions || []) {
        if (d.findingKey!==task.findingKey || d.materialFingerprint!==task.materialFingerprint || !d.reason) continue;
        if (d.status==='not_applicable' || d.status==='superseded' && tasks.some(t=>t.findingKey===d.supersededBy && gaps.some(g=>t.findingKey.startsWith(`${g.id}:`) && g.supersedes?.some(old=>task.findingKey.startsWith(`${old}:`))))) {
          if (changes.has(d.findingKey) && fields.canonical(changes.get(d.findingKey))!==fields.canonical(d)) fail('mapping_binding_required','conflicting finding dispositions require explicit reconciliation');
          changes.set(d.findingKey,d);break;
        }
      }
      const applicabilityChanges=[...changes.values()].map(d=>({findingKey:d.findingKey,status:d.status,reason:d.reason,captureIds:scoped.filter(c=>(c.evidence.dispositions || []).some(x=>fields.canonical(x)===fields.canonical(d))).map(c=>c.captureId).sort(),...(d.supersededBy?{supersededBy:d.supersededBy}:{})}));
      const payload={contractVersion:review.CONTRACT_VERSION,migrationId,producerId,executionId,assessedScope:[scopeKey],captureIds:scoped.map(c=>c.captureId).sort(),coverage:{status:complete?'complete':'incomplete',unknownAreas:unique(unknown)},tasks,results,applicabilityChanges,...(completionReportDigest ? {completionReportDigest} : {})};
      const report=await review.readReport(projectDir);
      receipts.push(await review.publishEvidence(projectDir,{...payload,requestId:`mapping-publish:${fields.digest(payload)}`,expectedStateVersion:report.stateVersion}));
    }
    const report=await review.readReport(projectDir),overview=await review.overview(projectDir);
    return {status:'published',receipts,report,overview};
  }
  return {captureBeforeWrite,captureWriteOutcome,publish};
}
async function publishMappingReview(options,publication={}) {
  if (!options.executionId) {
    const frame=await readFrame(options.projectDir,options.mappingPlanDigest);
    if (frame.plan.executionScope.resolvedEntityRefs.some(ref=>frame.rows.find(row=>fields.entityRef(row)===ref).targetClassification!=='manual-mapping')) fail('mapping_execution_required','resolved mapping publication needs its actual importer execution');
    const fallback=fields.mappingReviewFallback(frame.plan,frame.ledger);
    fields.persistMappingReviewFallback(options.projectDir,fallback);
    return fallback;
  }
  return (await createMappingReviewAdapter(options)).publish(publication);
}
module.exports={mappingScope,mappingScopes,createMappingReviewAdapter,publishMappingReview};
