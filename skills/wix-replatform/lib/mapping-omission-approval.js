'use strict';
// Shared approval of an exact, proposed omission scope. A proposal grants no write permission.
const fs=require('node:fs'),path=require('node:path');
const fields=require('./mapping-field-contract');
const {hashArtifact}=require('./artifact-freshness');
const {GUID}=require('./operator-identity');
const read=(dir,file)=>{try{return JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));}catch{throw new Error('omission approval artifact unreadable');}};
const mode=decisions=>require('./orchestration-decisions').getDecisionValue(decisions,'automationMode') === 'one_click' ? 'one_click':'interactive';
function omissions(row) {
  const excluded=new Set((row.fieldMappings || []).filter(d=>d.disposition==='excluded' && fields.pendingDecision(row,d)).map(d=>d.id));
  if (!excluded.size) return [];
  return fields.projectEntity(row).fieldDispositions.filter(d=>d.status==='notMigrated' && d.decisionRefs?.some(id=>excluded.has(id))).map(d=>({
    kind:d.kind,path:d.path,writeOperation:d.writeOperation || null,decisionRefs:[...d.decisionRefs].sort(),
    reason:d.reason,affectedScope:d.affectedScope
  })).sort((a,b)=>fields.canonical(a).localeCompare(fields.canonical(b)));
}
function candidates(plan) {
  return fields.entityRows(plan).filter(row=>row.omissionReviewRequested && plan.executionScope?.resolvedEntityRefs?.includes(fields.entityRef(row)) && omissions(row).length);
}
// One digest per entity plus one per canonical (selector-qualified) location, so an approval
// names exactly which location/scope it covers and a change to any one location is detected.
function dispositionDigests(plan) {
  return candidates(plan).map(row=>{
    const rows=omissions(row);
    return {entity:fields.entityRef(row),digest:fields.digest(rows),
      locations:rows.map(o=>({kind:o.kind,path:o.path,writeOperation:o.writeOperation,digest:fields.digest(o)}))};
  }).sort((a,b)=>a.entity.localeCompare(b.entity));
}
function changedLocations(approved,expected) {
  const key=l=>fields.canonical([l.kind,l.path,l.writeOperation]);
  const before=new Map((approved || []).flatMap(e=>(e.locations || []).map(l=>[`${e.entity}|${key(l)}`,l.digest])));
  const after=new Map((expected || []).flatMap(e=>(e.locations || []).map(l=>[`${e.entity}|${key(l)}`,l.digest])));
  return [...new Set([...before.keys(),...after.keys()])].filter(k=>before.get(k)!==after.get(k)).sort();
}
function bindings(dir,row) {
  const entity=row.sourceEntity || row.entity;
  const C=require('./read-back-contract');
  const paths=Object.hasOwn(C.DOMAINS,entity) ? C.bindingPaths(entity) :
    ['mapping/mapping-plan.json',`mapping/entity-decisions/${fields.entityFileName(row)}`,'mapping/mapping-resolution.json'];
  return Object.fromEntries(paths.map(file=>{const hash=hashArtifact(dir,file);if(!hash)throw new Error(`omission approval binding missing: ${file}`);return [file,hash];}));
}
function requestMatches(request,current) {
  return Object.entries(current).every(([file,hash])=>request.artifactRefs?.some(ref=>ref?.path===file && String(ref.sha256).replace(/^sha256:/,'')===hash));
}
function context(dir) {
  const siteId=require('./config-env').parseEnvText(fs.readFileSync(path.join(dir,'config/wix.env'),'utf8')).WIX_SITE_ID;
  const projectId=read(dir,'orchestration/run.json').projectId;
  if (!siteId || !projectId) throw new Error('omission approval requires project and destination identity');
  return {automationMode:'interactive',projectId,siteId};
}
function validateEvidence(dir,row) {
  const C=require('./read-back-contract'),entity=row.sourceEntity || row.entity;
  const inv=Object.hasOwn(C.DOMAINS,entity) ? read(dir,`execution/read-back-inventory/${entity}.json`) : null;
  if (inv && (inv.schemaVersion!==C.INVENTORY_SCHEMA_VERSION || inv.locationEncoding!==require('./source-location').ENCODING)) throw new Error('omission inventory stale (location encoding); rerun inventory');
  const inventoryIds=inv ? new Set(inv.records.map(r=>r.sourceId)) : null;
  for (const omission of omissions(row)) {
    const scope=omission.affectedScope;
    if (!scope.sourceSnapshotDigest || !scope.inventoryDigest || scope.sourceSnapshotDigest!==row.discoveryCoverage?.sourceSnapshotDigest || scope.inventoryDigest!==row.discoveryCoverage?.inventoryDigest) throw new Error('omission source evidence changed');
    if (scope.sourceIdsComplete && (!Array.isArray(scope.sourceIds) || fields.digest(scope.sourceIds)!==scope.sourceIdsDigest)) throw new Error('omission complete source-ID digest changed');
    if (inv && scope.countStatus==='known' && omission.kind==='source' && scope.count!==(inv.sourcePaths[omission.path] || 0)) throw new Error('omission count differs from populated inventory');
    if (inv && scope.sourceIds?.some(id=>!inventoryIds.has(id))) throw new Error('omission source IDs are outside inventory');
    // A complete per-location membership must be the inventory's measured record set there.
    if (inv && scope.countStatus==='known' && scope.sourceIdsComplete && omission.kind==='source' && scope.sourceIdsDigest!==(inv.sourceIdsDigests?.[omission.path] || fields.digest([]))) throw new Error(`omission membership differs from populated inventory at ${omission.path}`);
  }
}
function assertAuthorized(dir,plan,rows=candidates(plan)) {
  if (!rows.length) return;
  if (!dir) throw new Error('omission authorization requires the original project context');
  const approval=read(dir,'orchestration/approvals.json').mapping;
  if (!/^uar_[a-zA-Z0-9-]+$/.test(approval?.requestId || '')) throw new Error('omission approval request missing');
  const request=approval?.requestId && read(dir,`orchestration/user-actions/${approval.requestId}.json`);
  if (mode(read(dir,'orchestration/decisions.json'))!=='interactive' || approval?.omissionApprovalContext?.automationMode!=='interactive' ||
      request?.omissionApprovalContext?.automationMode!=='interactive' || approval?.status!=='approved' || approval.decidedBy!=='user' ||
      !GUID.test(approval.approvedBy?.userId || '') || !approval.approvedBy?.displayName?.trim() || request?.status!=='answered' || request.requestId!==approval.requestId || request.kind!=='approval' || request.response?.mode!=='choice' ||
      request.effect?.kind!=='approval' || request.effect.approvalType!=='mapping' || !['approved','approve'].includes(request.answer?.choice)) throw new Error('identified interactive omission approval required');
  if (fields.digest(plan)!==fields.digest(read(dir,'mapping/mapping-plan.json'))) throw new Error('omission authority changed');
  if (fields.canonical(approval.omissionApprovalContext)!==fields.canonical(context(dir)) || fields.canonical(request.omissionApprovalContext)!==fields.canonical(context(dir))) throw new Error('omission project or destination changed');
  const expected=dispositionDigests(plan);
  if (fields.canonical(approval.fieldDispositionDigests)!==fields.canonical(expected) || fields.canonical(request.fieldDispositionDigests)!==fields.canonical(expected)) {
    const changed=changedLocations(approval.fieldDispositionDigests,expected);
    throw new Error(`omission scope digest changed${changed.length ? `: ${changed.slice(0,5).join(', ')}${changed.length>5?' …':''}` : ''}`);
  }
  if (!fields.compareMappingProjections(dir,plan).ok) throw new Error('omission mapping projections changed');
  for (const row of rows) {
    validateEvidence(dir,row);
    const current=bindings(dir,row);
    if (!requestMatches(request,current) || Object.entries(current).some(([file,hash])=>approval.bindingDigests?.[file]!==hash)) throw new Error('omission artifact binding changed');
  }
}
module.exports={changedLocations,validateEvidence,context,mode,omissions,candidates,dispositionDigests,bindings,requestMatches,assertAuthorized};
