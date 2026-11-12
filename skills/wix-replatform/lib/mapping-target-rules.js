'use strict';
const {canonical,validateEntity}=require('./mapping-field-contract.js');
function validateMappingRules(rules, targetRef) {
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) return ['mappingRules must be an array'];
  const errors=[], ids=new Set();
  for (const rule of rules) {
    const a=rule.applicability;
    if (!rule.id || ids.has(rule.id)) errors.push('mappingRules requires unique stable IDs');
    ids.add(rule.id);
    if (!a?.sourceSystem || !a.sourceEntity || !Array.isArray(a.predicates) || !a.predicates.length ||
        a.predicates.some(p=>!p.path || !p.semantic || !p.type)) errors.push(`${rule.id}: source/schema/semantic predicates required`);
    const row={sourceEntity:rule.id,requiredSourceEntityRefs:[],fieldMappings:[rule],discoveryCoverage:{paths:rule.sourcePaths || [],
      sourceSnapshotDigest:'rule-template',inventoryDigest:'rule-template',uninspectedAreas:[],evidence:rule.evidence || []}};
    errors.push(...validateEntity(row));
    if ((rule.outputs || []).some(o=>o.targetRef!==targetRef)) errors.push(`${rule.id}: output targets a different entity`);
  }
  return errors;
}
function matchMappingRules(rules=[], {sourceSystem,sourceEntity,coverage}={}) {
  const matches=rules.filter(rule=>{
    const a=rule.applicability;
    return a?.sourceSystem===sourceSystem && a.sourceEntity===sourceEntity && a.predicates.every(p=>
      (coverage?.paths || []).some(leaf=>typeof leaf==='object' && Object.entries(p).every(([k,v])=>canonical(leaf[k])===canonical(v))));
  });
  const conflicts=[];
  for (let i=0;i<matches.length;i++) for (let j=i+1;j<matches.length;j++) {
    const a=matches[i],b=matches[j];
    if (a.sourcePaths.some(p=>b.sourcePaths.includes(p)) && canonical([a.outputs,a.transform,a.valuePolicy,a.referencePolicy || null])!==canonical([b.outputs,b.transform,b.valuePolicy,b.referencePolicy || null])) {
      conflicts.push({ruleIds:[a.id,b.id],sourcePaths:a.sourcePaths.filter(p=>b.sourcePaths.includes(p)),reason:'Incompatible reviewed rules; return to mapping.'});
    }
  }
  const conflicting=new Set(conflicts.flatMap(c=>c.ruleIds));
  const unique=new Map();
  for (const rule of matches.filter(m=>!conflicting.has(m.id)).sort((a,b)=>a.id.localeCompare(b.id))) {
    const signature=canonical([rule.sourcePaths,rule.outputs,rule.transform,rule.valuePolicy,rule.referencePolicy || null]);
    const prior=unique.get(signature);
    if (prior) prior.ruleRefs.push(rule.id);
    else unique.set(signature,{...structuredClone(rule),ruleRef:rule.id,ruleRefs:[rule.id]});
  }
  return {decisions:[...unique.values()],conflicts};
}
function choosePreservation({nativeCandidates=[],extended=null,cms=null}={}) {
  const support=require('./target-import-support.js');
  // The entity's knowledge decides import safety; the candidate's own flag only
  // counts for a target with no knowledge file.
  const safe=c=>(c.output?.targetRef && support.knowledgeImportSafe(c.output.targetRef)) ?? c.importSafe;
  const routable=c=>c.suitable===true && c.writable===true &&
    c.evidence?.length && c.output?.targetRef && c.output.writeOperation && c.output.writeInput && c.output.targetPath;
  const native=nativeCandidates.find(c=>routable(c) && safe(c)===true);
  const unsafe=!native && nativeCandidates.find(c=>routable(c) && support.importUnsafe(c.output.targetRef));
  if (unsafe) { const why=support.importUnsafe(unsafe.output.targetRef); return {disposition:'unresolved',outputs:[],reasonCode:'import-unsafe',importSafeReason:why,
    reason:`Native ${unsafe.output.targetRef} is not import-safe: ${why.summary}`}; }
  // A native target with no reviewed writer is written by guarded raw requests. Only a
  // write operation that is neither the entity's own writer nor the raw path is a gap; the import
  // client refuses the old direct-REST fallback, and a missing writer never routes to custom storage.
  if (native && !native.writerId && !support.hasEntityWriter(native.output.targetRef, native.output.writeOperation)) {
    const refusal=support.writerRefusal(native.output.targetRef, native.output.writeOperation);
    return {disposition:'unresolved',outputs:[],reasonCode:'missing-writer',missingWriter:true,refusalReason:refusal?.reason||'not-a-writer',
      reason:`Write operation ${native.output.writeOperation} is not an rp-target-wix writer for native ${native.output.targetRef} (${refusal?.reason||'not-a-writer'})${refusal?.instead?`; use ${refusal.instead}`:'; use its reviewed writer, or sendGuardedRawRequest when it has none'}.`};
  }
  if (native) return {disposition:'native',outputs:[native.output],evidence:native.evidence,...(support.rawRequestEntity(native.output.targetRef)?{writer:'raw-request'}:{})};
  const admitted=extended && ['ecom/order','stores/product','crm/contact'].includes(extended.targetRef) &&
    ['string','TEXT'].includes(extended.fieldType) && extended.permissionsPreset==='migration-internal' &&
    extended.namespace==='_user_fields' && !extended.targetNestedSubrecord && Number.isSafeInteger(extended.maxLength) && extended.maxLength>0 &&
    (extended.targetRef!=='crm/contact' || extended.contactsVersion==='contacts-v5' ||
      (extended.contactsVersion==='contacts-v4' && extended.explicitLegacyChoice===true));
  if (admitted && extended.output?.storage && extended.evidence?.length &&
      (!extended.existingDefinition || extended.compatibilityVerified===true)) {
    return {disposition:'extended-field',outputs:[extended.output],evidence:extended.evidence,
      setupRequirement:extended.setupRequirement};
  }
  if (cms?.output?.storage?.collectionId && cms.output.storage.fieldKey && cms.output.storage.fieldType &&
      cms.output.storage.permissionsPreset==='migration-internal' && cms.output.storage.parentLink && cms.evidence?.length &&
      (!cms.existingDefinition || cms.compatibilityVerified===true)) {
    return {disposition:'cms',outputs:[cms.output],evidence:cms.evidence,
      setupRequirement:{requirementClass:'create-cms-collections',...cms.setupRequirement}};
  }
  return {disposition:'unresolved',outputs:[],reason:'No suitable native operation or compatible admitted custom storage.'};
}
function assertKnownMappings(plan) {
  const fields=require('./mapping-field-contract'),proofs=require('./dependency-proofs');
  const semantics=d=>canonical({sourcePaths:d.sourcePaths,disposition:d.disposition,transform:d.transform,valuePolicy:d.valuePolicy,referencePolicy:d.referencePolicy || null,
    outputs:(d.outputs || []).map(({id,supersedes,verification,...binding})=>binding)});
  for(const row of fields.entityRows(plan)) {
    let knowledge;try{knowledge=proofs.domain(row.targetRef);}catch(error){if(error.code?.startsWith('mapping_assessment_'))throw error;continue;}
    if(!knowledge.mappingRules?.length)continue;
    const matched=matchMappingRules(knowledge.mappingRules,{sourceSystem:row.sourceSystem || plan.sourceSystem || plan.sourcePlatform || plan.source?.system,
      sourceEntity:row.sourceEntity,coverage:row.discoveryCoverage});
    if(matched.conflicts.length)throw Object.assign(new Error('mapping_known_rules_conflict'),{code:'mapping_known_rules_conflict',sourceEntity:row.sourceEntity});
    for(const rule of matched.decisions)if(!row.fieldMappings.some(d=>semantics(d)===semantics(rule)))throw Object.assign(new Error('mapping_known_rule_not_applied'),{code:'mapping_known_rule_not_applied',ruleId:rule.id,sourceEntity:row.sourceEntity});
  }
}
module.exports={validateMappingRules,matchMappingRules,choosePreservation,assertKnownMappings};
