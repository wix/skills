'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./source-location');
const Applicability = require('./output-applicability');
const DISPOSITIONS = ['native', 'extended-field', 'cms', 'excluded', 'unresolved', 'deferred-field'];
const GAP_KEYS = ['id', 'gapKind', 'sourceEntity', 'decisionId', 'sourcePaths', 'targetRef',
  'writeOperation', 'disposition', 'storage', 'limitation', 'searchEvidence', 'knowledgeEvidence',
  'nativeBehaviorMissing', 'preservationStatus', 'affectedScope', 'nextAction', 'resolutionEvidence', 'supersedes', 'recovery'];
function canonical(value) {
  // Match JSON persistence (undefined object members disappear; array holes become null).
  const serialized=JSON.stringify(value);
  if (serialized===undefined) return undefined;
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v==='object') return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  return stable(JSON.parse(serialized));
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function fail(message) { throw Object.assign(new Error(message), { code: 'mapping_field_contract' }); }
function entityRef(row) { return row?.sourceEntityRef || row?.sourceEntity || row?.entityName || row?.entity || row?.entityKey; }
// An entity decision file is named from the target-domain entity in some legacy
// plans and from the source identity in exact plans.  Gates must use the same
// identity set when joining a plan row to a decision file.
function entityKeyMatches(row, key) {
  if (!row || typeof key !== 'string' || !key) return false;
  const targetEntity = typeof row.targetRef === 'string' ? row.targetRef.split('/').at(-1) : null;
  let sourceFileKey = null;
  try { sourceFileKey = entityFileName(row).replace(/\.json$/, ''); } catch { /* malformed rows fail through their own validation */ }
  return [row.entity, row.sourceEntity, row.sourceEntityRef, row.name, row.target?.entity, targetEntity, sourceFileKey]
    .filter(value => typeof value === 'string' && value).includes(key);
}
function entityFileName(row) {
  const identity=row.sourceEntity || row.entityKey || entityRef(row);
  if (typeof identity!=='string' || !identity) fail('entity filename identity missing');
  return `${identity.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}.json`;
}
function entityRows(plan) {
  if (Array.isArray(plan)) return plan;
  for (const key of ['entities', 'entityDecisions', 'entityMappings', 'mappings']) {
    if (Array.isArray(plan[key])) return plan[key];
    if (key === 'entities' && plan[key] && typeof plan[key] === 'object') {
      return Object.entries(plan[key]).map(([ref, row]) => ({ sourceEntity: ref, ...row }));
    }
  }
  return [];
}
// Resolve a gated target entity (for example `contact`) to the decision projection
// written for its exact-plan source identity (for example `wc-v3-customers.json`).
// Legacy plans have no matching source row and retain their target-named filename.
function entityDecisionFileName(plan, key) {
  const matches = entityRows(plan).filter(row => entityKeyMatches(row, key));
  if (matches.length > 1) fail(`entity decision identity is ambiguous: ${key}`);
  return matches.length ? entityFileName(matches[0]) : `${key}.json`;
}
// Exact locations use the shared lossless grammar (lib/source-location.js). Legacy dotted
// paths of the former identifier-only grammar are already canonical and keep their meaning.
function exactPath(value) {
  return typeof value === 'string' && L.isExact(value);
}
const loc = p => L.canonicalize(p);
// A decision's exact consumed locations. A legacy selector on a dynamic base path
// ({path, keyPath, keys}) replaces that base path with one selector-qualified location per key.
function selectorLocations(sel) {
  const t = L.template({ path: sel.path, selector: { keyPath: sel.keyPath } });
  return (sel.keys || []).map(k => L.selected(t, k));
}
function expandLocations(paths, selectors) {
  const bySel = new Map();
  for (const sel of selectors || []) {
    const p = loc(sel.path);
    bySel.set(p, [...(bySel.get(p) || []), ...selectorLocations(sel)]);
  }
  return [...new Set((paths || []).flatMap(p => bySel.get(loc(p)) || [loc(p)]))];
}
const decisionLocations = d => expandLocations(d?.sourcePaths, d?.selectors);
const outputLocations = (d, o) => expandLocations(o?.sourcePaths, d?.selectors);
// Coverage locations: a dynamic entry stands for its observed selector-qualified keys.
function coverageLocations(row) {
  return [...new Set((row.discoveryCoverage?.paths || []).flatMap(item => {
    if (typeof item === 'string') return [loc(item)];
    if (item?.dynamic === true) {
      const t = L.template(item);
      return (item.observedKeys || []).map(k => L.selected(t, k));
    }
    return [loc(item?.path)];
  }))];
}
function coverageItems(row) {
  return (row.discoveryCoverage?.paths || []).filter(item => item && typeof item === 'object' && item.dynamic !== true)
    .map(item => ({ ...item, path: loc(item.path) }));
}
function scopeUnknown(coverage = {}) {
  return { sourceSnapshotDigest: coverage.sourceSnapshotDigest || null,
    inventoryDigest: coverage.inventoryDigest || null, sourceIds: null, sourceIdsComplete: false,
    sourceIdsDigest: null, count: null, countStatus: 'unknown' };
}
function affectedScope(scope, coverage) {
  const s = { ...scopeUnknown(coverage), ...scope };
  if (!['known', 'unknown'].includes(s.countStatus)) fail('invalid countStatus');
  if (s.countStatus === 'unknown') {
    if (s.count !== null || s.sourceIds !== null) fail('unknown coverage requires null count and sourceIds');
  } else {
    if (!Number.isSafeInteger(s.count) || s.count < 0) fail('known count must be a nonnegative integer');
    if (s.sourceIds !== null && (!Array.isArray(s.sourceIds) || s.sourceIds.some(x => typeof x !== 'string'))) fail('sourceIds must be strings or null');
    if (s.sourceIds) {
      s.sourceIds = [...new Set(s.sourceIds)].sort();
      if (s.sourceIds.length > s.count || (s.sourceIdsComplete && s.sourceIds.length !== s.count)) fail('affected IDs disagree with count');
    }
  }
  return s;
}
// Existing source/member policies exclude credentials, never ordinary business fields.
// The inventory must classify the same bounded paths; a reference or reason alone cannot
// authorize a populated omission. No new user-approved omission contract is implemented here.
const CREDENTIAL_KEY=/^(?:credentials|password|password_hash|user_pass|application_password|api_key|api_secret|consumer_key|consumer_secret|access_token|refresh_token)$/i;
function credentialRoot(parent) {
  try {
    const segs=L.parse(parent);
    let i=segs.length-1;
    if (segs[i].each && !segs[i].where) i-=1;
    return i>=0 && segs[i].key!==undefined && CREDENTIAL_KEY.test(segs[i].key);
  } catch { return false; }
}
const within=(parent,p,strict=false)=>L.within(parent,p,{strict});
function mandatoryExclusion(row, decision) {
  if (decision?.policyRef!=='mandatory-no-credentials' || !decision.sourcePaths?.length) return false;
  const paths=row.discoveryCoverage?.paths || [];
  return decision.sourcePaths.every(parent=>credentialRoot(parent) && paths.some(leaf=>
    leaf && typeof leaf==='object' && leaf.retentionClass==='credential' && within(parent,leaf.path)) &&
    paths.filter(leaf=>within(parent,typeof leaf==='string'?leaf:leaf?.path))
      .every(leaf=>typeof leaf==='object' && leaf.retentionClass==='credential'));
}
// Subtree claims exist only for the mandatory credential policy (descendants strictly below).
const credentialSubtree=(row,d,p)=>d?.disposition==='excluded' && d.excludeSubtree===true && mandatoryExclusion(row,d) && Array.isArray(d.sourcePaths) && d.sourcePaths.some(parent=>within(parent,p,true));
// A zero is a measurement only when the complete empty population is bound to the
// same inspected snapshot/inventory. Unknown, truncated or stale scope cannot authorize loss.
function measuredZeroExclusion(row,decision) {
  const s=decision?.affectedScope,c=row?.discoveryCoverage;
  return Boolean(decision?.disposition==='excluded' && s?.countStatus==='known' && s.count===0 &&
    s.sourceIdsComplete===true && Array.isArray(s.sourceIds) && s.sourceIds.length===0 &&
    s.sourceIdsDigest===digest([]) && typeof c?.sourceSnapshotDigest==='string' && c.sourceSnapshotDigest.length &&
    typeof c.inventoryDigest==='string' && c.inventoryDigest.length &&
    s.sourceSnapshotDigest===c.sourceSnapshotDigest && s.inventoryDigest===c.inventoryDigest);
}
// Source fields whose content is carried, not dropped: a source adapter turns them into one
// structural canonical field (for example product.bundle) that a manual-mapping target entity
// hands to the operator (its runbook plus one cutover task per record). Excluding them from the
// write is therefore not an omission and does not hold the record. Valid only when the canonical
// field is normalized, the carrier is a manual-mapping entity with a runbook that declares it
// `carries` that field, and the row's own target is one the carrier depends on (the bundle
// carrier depends on stores/product, so the policy cannot release a field of any other entity).
// This bounds the policy by entity, not by source path: which source paths feed the canonical
// field is the adapter's knowledge and is reviewed in the mapping. That a given record emitted the
// canonical field is the adapter's contract (it returns the field or an unreadable reason); the
// cutover producer rejects a bundle record that has neither.
const CARRIED_POLICY = 'carried-to-cutover';
function carriedToCutoverExclusion(row, decision) {
  if (decision?.disposition!=='excluded' || decision.policyRef!==CARRIED_POLICY || !decision.sourcePaths?.length) return false;
  return carriedToCutoverErrors(row, decision).length===0;
}
function carriedToCutoverErrors(row, decision) {
  const errors=[];
  const { CANONICAL_FIELDS } = require('../resources/rp-target-wix/lib/wix-target-spec.js');
  if (typeof decision.canonicalField!=='string' || !Object.hasOwn(CANONICAL_FIELDS, decision.canonicalField) || CANONICAL_FIELDS[decision.canonicalField].normalized!==true) errors.push('canonicalField must name a normalized canonical field');
  let carrier=null;
  if (typeof decision.carriedBy==='string' && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(decision.carriedBy)) {
    try { carrier=require('./dependency-proofs.js').bundledDomain(decision.carriedBy); } catch { carrier=null; }
  }
  if (!carrier) { errors.push('carriedBy must name a target entity'); return errors; }
  if (carrier.target?.classification!=='manual-mapping' || !carrier.manualSteps?.steps?.length) errors.push('carriedBy must be a manual-mapping entity with a runbook');
  if (!Array.isArray(carrier.carries) || !carrier.carries.includes(decision.canonicalField)) errors.push(`carriedBy does not carry ${decision.canonicalField}`);
  const target=row?.targetRef || (row?.targetDomain && row?.targetEntity ? `${row.targetDomain}/${row.targetEntity}` : null);
  if (!target || !(carrier.dependsOn || []).includes(target)) errors.push(`carriedBy does not carry fields of ${target || 'an entity without a target'}`);
  return errors;
}
function pendingDecision(row,d) {
  return d.disposition==='unresolved' || (d.disposition==='excluded' && !mandatoryExclusion(row,d) &&
    !measuredZeroExclusion(row,d) && !carriedToCutoverExclusion(row,d));
}
function mappingRunMode(projectDir) {
  return require('./orchestration-decisions.js').isExplicitUserOneClick(readOptional(path.join(projectDir,'orchestration/decisions.json'),{})) ? 'one_click':'interactive';
}
function validateEntity(row) {
  if (!row || typeof row!=='object' || Array.isArray(row)) return ['entity must be an object'];
  const errors = [], ref = entityRef(row), ids = new Set(), writes = new Map();
  const error = m => errors.push(`${ref}: ${m}`);
  if (row.fieldMappingStatus==='pending') {
    if (!ref || !Array.isArray(row.fieldMappings) || row.fieldMappings.length || !Array.isArray(row.discoveryCoverage?.paths) || row.discoveryCoverage.paths.length || !row.discoveryCoverage?.uninspectedAreas?.length || !Array.isArray(row.requiredSourceEntityRefs)) error('pending field inventory needs explicit empty decisions/paths and disclosed uninspected scope');
    return errors;
  }
  if (row.exampleBase!==undefined && (!row.exampleBase || typeof row.exampleBase!=='object' || Array.isArray(row.exampleBase))) error('exampleBase must be one synthetic source record');
  if (row.targetClassification==='manual-mapping') {
    if (!row.manualSteps?.steps?.length) error('manual mapping needs its complete runbook');
    if (Array.isArray(row.fieldMappings) && row.fieldMappings.some(d=>d?.outputs?.length)) error('manual mapping cannot invent a write');
    return errors;
  }
  const coverage = row.discoveryCoverage;
  if (!ref) error('source identity is missing');
  if (row.omissionReviewRequested !== undefined && typeof row.omissionReviewRequested!=='boolean') error('omission review marker must be boolean');
  if (!coverage || !Array.isArray(coverage.paths) || !Array.isArray(coverage.uninspectedAreas) || !Array.isArray(coverage.evidence)) error('discoveryCoverage needs paths, uninspectedAreas and evidence');
  if (coverage && Array.isArray(coverage.paths) && (coverage.paths.some(p=>p && typeof p==='object' && p.dynamic===true && (!p.selector || !Array.isArray(p.observedKeys))) || !coverage.sourceSnapshotDigest || !coverage.inventoryDigest)) error('coverage needs snapshot/inventory digests and observed selectors for dynamic keys');
  if (!Array.isArray(row.requiredSourceEntityRefs)) error('requiredSourceEntityRefs must explicitly declare reviewed dependencies, even when empty');
  if (!Array.isArray(row.fieldMappings)) error('fieldMappings must be an array');
  if (errors.length) return errors;
  let dynamicTemplates=[];
  try {
    dynamicTemplates=coverage.paths.filter(p=>p && typeof p==='object' && p.dynamic===true).map(L.template);
    for (const item of coverage.paths) {
      const p=typeof item==='string' ? item : item?.path;
      if (!exactPath(p) || (item?.dynamic===true && (!exactPath(item.selector?.keyPath) || item.observedKeys.some(k=>!L.scalar(k))))) {error(`inventory path ${typeof p==='string'?p:JSON.stringify(p)} is not exact`); return errors;}
    }
  } catch(e) {error(`invalid dynamic coverage selector: ${e.message}`); return errors;}
  for (const d of row.fieldMappings) {
    if (!d || typeof d!=='object' || !Array.isArray(d.sourcePaths) || (d.outputs!==undefined && !Array.isArray(d.outputs)) || (d.examples!==undefined && !Array.isArray(d.examples))) {error('malformed field decision'); continue;}
    if (!d.id || ids.has(d.id)) error('missing/duplicate decision ID'); ids.add(d.id);
    if (!Array.isArray(d.sourcePaths) || d.sourcePaths.some(p => !exactPath(p))) {error(`${d.id}: sourcePaths must be exact leaf paths`); continue;}
    if (d.selectors!==undefined) {
      const declared=new Set(dynamicTemplates.map(t=>canonical([t.path,t.keyPath])));
      if (!Array.isArray(d.selectors) || d.selectors.some(sel=>{
        if (!sel || !exactPath(sel.path) || !exactPath(sel.keyPath) || !Array.isArray(sel.keys) || !sel.keys.length || sel.keys.some(k=>!L.scalar(k)) || !d.sourcePaths.some(p=>loc(p)===loc(sel.path))) return true;
        try {const t=L.template({path:sel.path,selector:{keyPath:sel.keyPath}});return !declared.has(canonical([t.path,t.keyPath]));} catch {return true;}
      })) {error(`${d.id}: selectors must name a declared dynamic path, its key path and observed scalar keys`); continue;}
    }
    if (d.affectedScopes!==undefined) {
      const own=new Set(decisionLocations(d));
      if (!d.affectedScopes || typeof d.affectedScopes!=='object' || Array.isArray(d.affectedScopes)) error(`${d.id}: affectedScopes must map locations to scopes`);
      else for (const [p,s] of Object.entries(d.affectedScopes)) {
        if (!exactPath(p) || !own.has(p)) error(`${d.id}: affectedScopes names ${p}, which is not one of its canonical locations`);
        try {affectedScope(s,coverage);} catch(e) {error(`${d.id}: affectedScopes ${p}: ${e.message}`);}
      }
      // The decision-level scope is the union of its locations' memberships.
      const parts=Object.values(d.affectedScopes || {}).map(s=>{try{return affectedScope(s,coverage);}catch{return null;}});
      const whole=d.affectedScope ? (()=>{try{return affectedScope(d.affectedScope,coverage);}catch{return null;}})() : null;
      if (whole?.sourceIdsComplete && parts.length===own.size && parts.every(s=>s?.sourceIdsComplete && Array.isArray(s.sourceIds)) &&
        canonical([...new Set(parts.flatMap(s=>s.sourceIds))].sort())!==canonical(whole.sourceIds)) error(`${d.id}: decision affected IDs differ from the union of its per-location memberships`);
    }
    if (!DISPOSITIONS.includes(d.disposition)) error(`${d.id}: invalid disposition`);
    if (!Array.isArray(d.evidence) || !d.evidence.length) error(`${d.id}: missing evidence`);
    if (!d.reason) error(`${d.id}: missing reason`);
    if (d.disposition === 'deferred-field') {
      for (const m of require('./mapping-recovery').shape(row, d)) error(`${d.id}: ${m}`);
      if (!d.sourcePaths.length || d.outputs?.length || d.omittedOutputs?.length) error(`${d.id}: deferred fields retain source paths and cannot emit or exclude outputs`);
      continue;
    }
    if (d.omittedOutputs !== undefined && (!Array.isArray(d.omittedOutputs) || d.disposition!=='excluded' || d.omittedOutputs.some(o=>!o || !o.writeOperation || !exactPath(o.writeInput) || !exactPath(o.targetPath)))) error(`${d.id}: invalid omitted intended output binding`);
    if (['excluded', 'unresolved'].includes(d.disposition)) {
      if (d.recovery) for (const m of require('./mapping-recovery').shape(row,d)) error(`${d.id}: ${m}`);
      if (d.policyRef===CARRIED_POLICY) {
        if (d.disposition!=='excluded') error(`${d.id}: ${CARRIED_POLICY} is an exclusion policy`);
        for (const m of carriedToCutoverErrors(row, d)) error(`${d.id}: ${m}`);
      }
      if (!d.sourcePaths?.length) error(`${d.id}: exclusion/question needs source paths`);
      if (d.outputs?.length) error(`${d.id}: excluded/unresolved decision cannot write outputs`);
      continue;
    }
    if (!d.transform || !['identity', 'expression', 'lookup', 'helper'].includes(d.transform.kind)) error(`${d.id}: exact transform is required`);
    if (d.transform?.kind === 'expression' && (!d.transform.expression || /chronology fields|see schema|as appropriate/i.test(d.transform.expression))) error(`${d.id}: undecided expression`);
    if (d.transform?.kind === 'helper' && (!d.transform.name || !d.transform.revision || !d.transform.arguments)) error(`${d.id}: helper requires name, revision and arguments`);
    if (d.transform?.kind === 'lookup' && (!d.transform.cases || !d.transform.unknown)) error(`${d.id}: lookup requires cases and unknown handling`);
    for (const key of ['missing', 'null', 'empty', 'zero', 'invalid', 'unknown']) {
      if (!d.valuePolicy?.[key]?.action || typeof d.valuePolicy[key].action!=='string') error(`${d.id}: missing ${key} value policy action`);
    }
    if (!Array.isArray(d.examples) || !d.examples.length || d.examples.some(e => !e || !e.id || !Object.hasOwn(e, 'input') || (!Array.isArray(e.expected) || !e.expected.length))) error(`${d.id}: independently expected examples required`);
    if (!Array.isArray(d.outputs) || !d.outputs.length) error(`${d.id}: precise outputs required`);
    const outputIds = new Set();
    for (const o of d.outputs || []) {
      if (!o || typeof o!=='object') {error(`${d.id}: malformed output`);continue;}
      if (!o.id || outputIds.has(o.id)) error(`${d.id}: missing/duplicate output ID`); outputIds.add(o.id);
      if (!o.targetRef || !o.writeOperation || !exactPath(o.writeInput) || !exactPath(o.targetPath)) error(`${d.id}:${o.id}: incomplete operation/input/path binding`);
      if (!Array.isArray(o.sourcePaths) || o.sourcePaths.some(p => !d.sourcePaths?.includes(p))) error(`${d.id}:${o.id}: output inputs must be explicit subsets`);
      // Applicability is a closed predicate over the decision's own canonical locations (A.2.2).
      if (o.appliesWhen!==undefined) {
        let own=[]; try {own=decisionLocations(d);} catch {/* reported above */}
        for (const m of Applicability.validate(o.appliesWhen,own)) error(`${d.id}:${o.id}: ${m}`);
      }
      const key = canonical([o.targetRef, o.writeOperation, o.writeInput, o.targetPath]);
      if (writes.has(key) && !d.transform?.precedence) error(`${d.id}: conflicting output with ${writes.get(key)} requires precedence`);
      writes.set(key, d.id);
      if (['extended-field', 'cms'].includes(d.disposition) && !o.storage) error(`${d.id}:${o.id}: custom definition/collection and linkage required`);
    }
    for (const e of d.examples || []) for (const expected of (Array.isArray(e?.expected)?e.expected:[])) {
      // A no-write is explained by the finding the transform reports; the example runner requires it.
      if (expected?.noWrite===true && !(Array.isArray(expected.findingCodes) && expected.findingCodes.length)) error(`${d.id}: a noWrite expectation names its findingCodes`);
      if (!expected || [Object.hasOwn(expected,'value'),Array.isArray(expected.values),expected.omitted===true,expected.noWrite===true].filter(Boolean).length!==1 || !(d.outputs || []).some(o=>o?.id===expected.outputId && o.writeOperation===expected.writeOperation)) error(`${d.id}: expectation has no output/operation binding`);
    }
    if (d.referencePolicy && (!d.referencePolicy.cardinality || !d.referencePolicy.order || !d.referencePolicy.entityRef || !d.referencePolicy.input || !d.referencePolicy.targetPath || !d.referencePolicy.missing || !d.referencePolicy.ambiguous || !d.referencePolicy.orphan)) error(`${d.id}: incomplete reference policy`);
  }
  if (errors.some(e=>e.includes('malformed'))) return errors;
  // Every discovered location, including each observed selector key, needs its own claim.
  const claims=row.fieldMappings.map(d=>{try {return new Set(decisionLocations(d));} catch {return new Set();}});
  for (const item of coverage.paths) {
    const dynamic=item && typeof item==='object' && item.dynamic===true;
    const locations=dynamic ? item.observedKeys.map(k=>L.selected(L.template(item),k)) : [loc(typeof item==='string' ? item : item.path)];
    for (const p of locations) {
      const claimed=row.fieldMappings.some((d,i)=>claims[i].has(p) || credentialSubtree(row,d,p) || (dynamic && credentialSubtree(row,d,loc(item.path))));
      if (!claimed) error(dynamic ? `unclaimed observed dynamic key at ${L.readable(p)}` : `unclaimed discovered path ${p}`);
    }
  }
  if (!errors.length) {
    try {projectEntity(row);} catch(e) {error(e.message);}
  }
  return errors;
}
function binding(o) { return [o.targetRef, o.writeOperation, o.writeInput, o.targetPath]; }
// Identity uses expanded canonical locations, so a legacy {path, selectors} decision and the
// same decision written with selector-qualified locations keep one identity.
function signature(d) {
  let locations;
  try {locations=decisionLocations(d).sort();} catch {locations=[[...(d.sourcePaths || [])].sort(), d.selectors || null];}
  return canonical([locations, (d.outputs || []).map(binding).sort((a,b)=>canonical(a).localeCompare(canonical(b)))]);
}
function assertRemapIdentity(previous, next) {
  const before = new Map(entityRows(previous).map(r => [entityRef(r), r]));
  for (const row of entityRows(next)) {
    const old = before.get(entityRef(row)); if (!old) continue;
    const used = new Set();
    for (const d of row.fieldMappings || []) {
      const matches = (old.fieldMappings || []).filter(x => x.id && signature(x) === signature(d));
      if (matches.length > 1 && !d.reconciles?.length) fail(`${entityRef(row)}: ambiguous remap identity`);
      for (const prior of matches) {
        if (used.has(prior.id)) fail('remap duplicates a prior decision'); used.add(prior.id);
        if (d.id !== prior.id && (!d.supersedes?.includes(prior.id) || gapRows(old).filter(g=>g.decisionId===prior.id).some(g=>!d.supersedes?.includes(g.id)))) fail(`${d.id}: remap must retain IDs or explicitly supersede the prior decision and gaps`);
        for (const o of d.outputs || []) {
          const oldOutput = prior.outputs?.find(x => canonical(binding(x)) === canonical(binding(o)));
          if (oldOutput && o.id !== oldOutput.id && !o.supersedes?.includes(oldOutput.id)) fail(`${d.id}: output ID changed`);
        }
      }
    }
  }
}
function scopedRecordHold(row,d) {
  return d.disposition==='unresolved' && d.recovery?.scope==='record' && require('./mapping-recovery').shape(row,d).length===0;
}
function deriveExecutionScope(plan, { mode = 'interactive', provisionalEntityRefs = null, omissionReview = false } = {}) {
  if (provisionalEntityRefs !== null && !Array.isArray(provisionalEntityRefs)) fail('human provisional subset must be an explicit array');
  const rows = entityRows(plan), selectedEntityRefs = plan.executionScope?.selectedEntityRefs || rows.map(entityRef);
  const byRef = new Map(rows.map(r => [entityRef(r), r]));
  if (new Set(selectedEntityRefs).size !== selectedEntityRefs.length || selectedEntityRefs.some(r => !byRef.has(r))) fail('selected execution scope is invalid');
  const deferred = new Map();
  for (const ref of selectedEntityRefs) {
    const row = byRef.get(ref);
    const measuredHolds = (row.fieldMappings || []).filter(d=>plan.recoveryPolicyVersion===1 && scopedRecordHold(row,d));
    const heldIds = new Set(measuredHolds.flatMap(d=>d.affectedScope.sourceIds));
    if (Number.isSafeInteger(row.sourceRecordCount) && row.sourceRecordCount>0 && heldIds.size===row.sourceRecordCount) {
      deferred.set(ref,{entityRef:ref,decisionIds:measuredHolds.map(d=>d.id),blockedByEntityRefs:[],reason:'Every source record has a measured unresolved mapping hold; retain the source and cutover gaps.'});
      continue;
    }
    const undecided = (row.fieldMappings || []).filter(d=>pendingDecision(row,d) && !(plan.recoveryPolicyVersion===1 && scopedRecordHold(row,d)) && !(omissionReview && row.omissionReviewRequested === true && d.disposition === 'excluded'));
    if (row.fieldMappingStatus==='pending' || undecided.length || (provisionalEntityRefs && !provisionalEntityRefs.includes(ref))) {
      deferred.set(ref, { entityRef: ref, decisionIds: row.fieldMappingStatus==='pending' ? ['field-inventory'] : undecided.map(d => d.id), blockedByEntityRefs: [], reason: row.fieldMappingStatus==='pending' ? 'Source field inventory must be inspected by mapper.' : undecided.length ? 'Unresolved mapping or populated omission awaiting the shared approval contract.' : 'Explicitly deferred by human provisional scope.' });
    }
  }
  let changed;
  do {
    changed = false;
    for (const ref of selectedEntityRefs) {
      if (deferred.has(ref)) continue;
      const deps = byRef.get(ref).requiredSourceEntityRefs || [];
      const blockedByEntityRefs = deps.filter(d => !selectedEntityRefs.includes(d) || deferred.has(d) && !dependencyIsPerRecord(byRef.get(ref), d, byRef));
      const absent = blockedByEntityRefs.filter(d => !selectedEntityRefs.includes(d));
      // Fail closed, but name a likely stale mapper-authored prerequisite before codegen/canary.
      const reason = absent.length ? `Required source prerequisite ${absent.join(', ')} is absent from the mapped scope. requiredSourceEntityRefs lists retained-write prerequisites only; if every use is an omission in this review, it is stale: remove it and re-run contract. Otherwise map it.` : `Required source prerequisite ${blockedByEntityRefs.join(', ')} is deferred.`;
      if (blockedByEntityRefs.length) { deferred.set(ref, { entityRef: ref, decisionIds: [], blockedByEntityRefs, reason }); changed = true; }
    }
  } while (changed);
  if (provisionalEntityRefs && provisionalEntityRefs.some(ref=>!selectedEntityRefs.includes(ref) || deferred.has(ref))) fail('human provisional subset contains unresolved/unauthorized/dependent work');
  if (deferred.size && mode !== 'one_click' && !provisionalEntityRefs && plan.recoveryPolicyVersion!==1) {
    for (const ref of selectedEntityRefs) if (!deferred.has(ref)) deferred.set(ref,{entityRef:ref,decisionIds:[],blockedByEntityRefs:[],reason:'Awaiting the customer mapping checkpoint; no provisional subset was authorized.'});
  }
  return { selectedEntityRefs: [...selectedEntityRefs], resolvedEntityRefs: selectedEntityRefs.filter(r => !deferred.has(r)), deferredEntities: selectedEntityRefs.filter(r => deferred.has(r)).map(r => deferred.get(r)),
    // Resolution is calculated; a provisional subset is an explicit mapper input.
    ...(provisionalEntityRefs !== null ? {provisionalEntityRefs:[...provisionalEntityRefs]} : {}),
    ...(omissionReview && rows.some(r=>!deferred.has(entityRef(r)) && r.omissionReviewRequested && r.fieldMappings?.some(d=>pendingDecision(r,d))) ?
      {omissionApprovalRequiredEntityRefs:rows.filter(r=>!deferred.has(entityRef(r)) && r.omissionReviewRequested && r.fieldMappings?.some(d=>pendingDecision(r,d))).map(entityRef)} : {}) };
}
function assertExecutionScope(plan, ref, expectedDigest, projectDir=null) {
  if (plan.fieldContractVersion !== 1) fail('revised mapping must be explicitly reconciled by mapper');
  if (!expectedDigest || digest(plan) !== expectedDigest) fail('mapping scope binding missing or stale');
  const scope = plan.executionScope;
  let scopeConflict = null;
  if (scope) {
    // Validate an explicitly provisional subset as authored. For ordinary exact
    // plans, retain that same closed-scope check so forged resolved rows still
    // reach the unauthorized-decision guard below. A mixed plan with a deferred
    // per-record prerequisite is the one exception: the resolved subset is not a
    // valid provisional input because it removes the prerequisite from the graph.
    let calculated;
    try {
      calculated=deriveExecutionScope(plan,{mode:'one_click',
        provisionalEntityRefs:scope.provisionalEntityRefs ?? scope.resolvedEntityRefs,
        omissionReview:true});
    } catch (error) {
      const byRef=new Map(entityRows(plan).map(row=>[entityRef(row),row]));
      const deferredRefs=new Set((scope.deferredEntities || []).map(row=>row.entityRef));
      const perRecordDependent=scope.provisionalEntityRefs === undefined && entityRows(plan).some(row =>
        scope.resolvedEntityRefs?.includes(entityRef(row)) && (row.requiredSourceEntityRefs || []).some(dep =>
          deferredRefs.has(dep) && dependencyIsPerRecord(row,dep,byRef)));
      if (perRecordDependent && /human provisional subset contains/.test(error.message)) {
        calculated=deriveExecutionScope(plan,{mode:'one_click',omissionReview:true});
      } else if (scope.provisionalEntityRefs !== undefined) throw error;
      else scopeConflict=error;
    }
    if (calculated && (canonical(calculated.resolvedEntityRefs)!==canonical(scope.resolvedEntityRefs) ||
        new Set(scope.resolvedEntityRefs).size!==scope.resolvedEntityRefs.length)) scopeConflict=new Error('resolved scope conflicts with decision/dependency closure');
  }
  if (!scope || !scope.selectedEntityRefs?.includes(ref) || !scope.resolvedEntityRefs?.includes(ref) ||
      (!scopeConflict && scope.deferredEntities?.some(d=>d.entityRef===ref))) fail(`${ref}: outside resolved execution scope`);
  const row = entityRows(plan).find(r => entityRef(r) === ref);
  const errors = row ? validateEntity(row) : ['entity absent'];
  if (errors.length) fail(errors.join('; '));
  if (plan.recoveryGapRefs?.length || row.fieldMappings.some(d => d.recovery)) require('./mapping-recovery').assertPersisted(projectDir, plan, [ref]);
  if (row.fieldMappingStatus==='pending') fail('field inventory is pending mapping');
  if (row.targetClassification==='manual-mapping') fail('manual mapping has no import writer');
  if (row.fieldMappings.some(d=>pendingDecision(row,d) && !(plan.recoveryPolicyVersion===1 && scopedRecordHold(row,d)) && !(row.omissionReviewRequested === true && d.disposition === 'excluded'))) fail('unresolved decisions/unauthorized omissions cannot write');
  if (scopeConflict) fail('resolved scope conflicts with decision/dependency closure');
  const conditional=entityRows(plan).filter(r=>scope.resolvedEntityRefs.includes(entityRef(r)) && r.omissionReviewRequested && r.fieldMappings?.some(d=>pendingDecision(r,d)));
  if (conditional.length) require('./mapping-omission-approval').assertAuthorized(projectDir,plan,conditional);
}
function dependencyIsPerRecord(row, dependencyRef, byRef) {
  const dependency = byRef.get(dependencyRef);
  if (!dependency?.targetRef || !row?.targetRef) return false;
  try {
    const knowledge = require('./dependency-proofs').domain(row.targetRef);
    return knowledge.dependencyModes?.[dependency.targetRef] === 'per-record';
  } catch {
    return false;
  }
}
function deferredRunResult(plan) {
  if (!plan.executionScope?.deferredEntities?.length) return null;
  // A deferred scope is a cutover gap, not a run-wide stop, when another executable
  // entity remains. The generated importer registers only resolved entities; its
  // dependency-readiness gate then applies per-record edges to dependents. Keep the
  // typed blocked result for an all-deferred plan, where no importer can start.
  const runnable = (plan.executionScope.resolvedEntityRefs || []).filter(ref => {
    const row = entityRows(plan).find(candidate => entityRef(candidate) === ref);
    return row && row.targetClassification !== 'manual-mapping';
  });
  if (runnable.length) return null;
  return { outcome: 'blocked', blocker: { type: 'mapping_scope_deferred', artifact: 'mapping/mapping-plan.json',
    deferredEntities: plan.executionScope.deferredEntities, requiredInput: 'Resolve these field decisions in the next mapping session.' } };
}
function deferredMappingActions(plan) {
  return (plan?.executionScope?.deferredEntities || []).map(deferred => ({
    code: 'mapping-scope-deferred',
    severity: 'high',
    entity: deferred.entityRef,
    affectedCount: null,
    deadlineReason: 'Resolve before launch; this mapped entity remains outside the executable import scope.',
    action: `Requires Import Operator. Resolve the deferred mapping for ${deferred.entityRef} in the original migration project, regenerate and re-approve the exact mapping, then resume only that entity. Independent entities continue importing; do not invent source data or resend landed records.`,
  }));
}
// A row's scope is the measured membership of that exact location: a contributor's
// per-location affectedScopes entry, else its decision scope. Known measurements must agree;
// a contributor without a measurement (unknown) never replaces a known one.
function contributingScope(row,decisions,location,at=null) {
  const scopes=decisions.map(d=>affectedScope(at!==null && d.affectedScopes && Object.hasOwn(d.affectedScopes,at) ? d.affectedScopes[at] : d.affectedScope,row.discoveryCoverage));
  const known=scopes.filter(s=>s.countStatus==='known');
  const scope=known[0] || scopes[0] || affectedScope(null,row.discoveryCoverage);
  if (known.some(s=>canonical(s)!==canonical(scope)) || (!known.length && scopes.some(s=>canonical(s)!==canonical(scope)))) fail(`${entityRef(row)}: conflicting affected scopes at ${location}; reconcile contributing decisions ${decisions.map(d=>d.id).join(', ')}`);
  return scope;
}
function projectEntity(row) {
  if (row.fieldMappingStatus==='pending') return {...row,fieldDispositions:[]};
  if (row.targetClassification==='manual-mapping') return {...row,fieldDispositions:row.fieldDispositions || []};
  // One coverage row per canonical location; selector-qualified keys never share a row.
  const paths = new Set(coverageLocations(row));
  const claims = new Map((row.fieldMappings || []).map(d => [d, new Set(decisionLocations(d))]));
  for (const set of claims.values()) for (const p of set) paths.add(p);
  const dispositions = [...paths].sort().map(p => {
    const ds = row.fieldMappings.filter(d => claims.get(d).has(p) || credentialSubtree(row,d,p));
    return { kind: 'source', path: p, status: ds.some(d=>pendingDecision(row,d) && !scopedRecordHold(row,d) && !(row.omissionReviewRequested && d.disposition==='excluded')) ? 'pending' : ds.some(d=>d.disposition==='deferred-field' || scopedRecordHold(row,d)) ? 'deferred' : ds.some(d=>d.outputs?.length) ? 'mapped' : 'notMigrated',
      decisionRefs: ds.map(d=>d.id).sort(), mappingRefs: ds.flatMap(d=>(d.outputs || []).filter(o=>outputLocations(d,o).includes(p)).map(o=>`${d.id}:${o.id}`)).sort(),
      reason: ds.map(d=>d.reason).join('; '), affectedScope: contributingScope(row,ds,`source ${p}`,p) };
  });
  const intended = new Map();
  for (const d of row.fieldMappings) for (const o of d.outputs || []) {
    const key=canonical([o.writeOperation,o.writeInput,o.targetPath]);
    const group=intended.get(key) || {decisions:[],item:{kind:'intended',path:L.join(o.writeInput,o.targetPath),writeOperation:o.writeOperation,
      status:'mapped',decisionRefs:[],mappingRefs:[],reason:d.reason}};
    group.decisions.push(d);group.item.decisionRefs.push(d.id);group.item.mappingRefs.push(`${d.id}:${o.id}`);intended.set(key,group);
  }
  for (const d of row.fieldMappings) if (d.disposition==='excluded') for (const o of d.omittedOutputs || []) {
    const key=canonical([o.writeOperation,o.writeInput,o.targetPath]);
    if (intended.has(key)) fail('omitted intended output conflicts with a written output');
    intended.set(key,{decisions:[d],item:{kind:'intended',path:L.join(o.writeInput,o.targetPath),writeOperation:o.writeOperation,
      status:row.omissionReviewRequested ? 'notMigrated':'pending',decisionRefs:[d.id],mappingRefs:[],reason:d.reason}});
  }
  const intendedRows=[...intended.values()].map(({decisions,item})=>({...item,affectedScope:contributingScope(row,decisions,`intended ${item.writeOperation}:${item.path}`)}));
  for (const d of row.fieldMappings.filter(d => d.disposition === 'deferred-field')) for (const p of d.recovery.createWithoutField.paths) {
    const c = d.recovery.createWithoutField, full = L.join(c.writeInput, p);
    if (intendedRows.some(r => r.path === full)) fail('deferred intended output conflicts with a written output');
    intendedRows.push({kind:'intended', path:full, writeOperation:c.operation, status:'deferred', decisionRefs:[d.id], mappingRefs:[], reason:d.reason, affectedScope:affectedScope(d.affectedScope,row.discoveryCoverage)});
  }
  const verificationMappings = row.fieldMappings.flatMap(d => (d.outputs || []).map(o => ({
    canonicalField: `${d.id}:${o.id}`, decisionRef: d.id,
    sourcePaths: outputLocations(d,o), ...(d.selectors ? {selectors:d.selectors} : {}),
    targetRef:o.targetRef, writeOperation:o.writeOperation, writeInput:o.writeInput,
    writePath:L.join(o.writeInput,o.targetPath),
    ...(o.appliesWhen!==undefined ? {appliesWhen:o.appliesWhen} : {}),
    ...Object.fromEntries(['readPath','unverifiableReason','comparatorId','provenance'].filter(key=>o.verification?.[key] !== undefined).map(key=>[key,o.verification[key]]))
  })));
  return { ...row, verificationMappings, fieldDispositions: [...dispositions,...intendedRows.sort((a,b)=>canonical(a).localeCompare(canonical(b)))] };
}
function gapRows(row) {
  const ref = entityRef(row), gaps = [];
  const decisions=row.fieldMappingStatus==='pending' ? [{id:'field-inventory',sourcePaths:[],disposition:'unresolved',reason:'Source field inventory requires explicit mapper decisions.',evidence:row.discoveryCoverage.evidence,nextAction:{role:'Import Operator',cta:'Inspect the source inventory and resolve exact field mappings.'}}] : row.fieldMappings || [];
  for (const d of decisions) {
    const kinds = ['unresolved','deferred-field'].includes(d.disposition) ? ['unresolved'] : d.disposition === 'excluded' ? ['excluded'] : ['extended-field', 'cms'].includes(d.disposition) ? ['no-native-target'] : [];
    if (d.lossy) kinds.push('lossy'); if (d.setupBlocked) kinds.push('setup-blocked');
    for (const kind of kinds) gaps.push({ id: `field-gap:${digest([ref, d.id, kind])}`, gapKind: kind, code: `FIELD_MAPPING_${kind.toUpperCase().replace(/-/g,'_')}`,
      entityName: ref, gapType: 'field-mapping', description: d.reason, recommendedHandling: d.nextAction?.cta || d.reason,
      severity: ['unresolved', 'setup-blocked'].includes(kind) || pendingDecision(row,d) ? 'blocker' : d.disposition==='excluded' && (mandatoryExclusion(row,d) || carriedToCutoverExclusion(row,d)) ? 'info' : 'warning',
      sourceEntity: ref, decisionId: d.id, sourcePaths: d.sourcePaths, targetRef: d.outputs?.[0]?.targetRef || d.recovery?.createWithoutField?.targetRef || (d.recovery ? row.targetRef : null) || null, writeOperation: d.outputs?.[0]?.writeOperation || d.recovery?.createWithoutField?.operation || null,
      disposition: d.disposition, storage: (d.outputs || []).map(o=>({ outputId: o.id, targetRef:o.targetRef, writeOperation:o.writeOperation, writeInput:o.writeInput, targetPath:o.targetPath, ...(o.storage ? { definition:o.storage } : {}) })),
      limitation: d.limitation || { status: 'unknown' }, searchEvidence: d.searchEvidence || [], knowledgeEvidence: d.evidence,
      nativeBehaviorMissing: d.nativeBehaviorMissing || [], preservationStatus: d.outputs?.length ? 'planned' : 'unknown',
      affectedScope: affectedScope(d.affectedScope, row.discoveryCoverage), nextAction: d.nextAction || null, resolutionEvidence: d.resolutionEvidence || [],
      supersedes: d.supersedes?.filter(x=>x.startsWith('field-gap:')) || [], ...(d.recovery ? {recovery:structuredClone(d.recovery)} : {}) });
  }
  return gaps;
}
function telemetryForGap(gap) {
  const events = [], add = (event_type, subtype, extra={}) => events.push({ event_type, subtype,
    stage:'mapping',skill:'rp-mapper',severity:gap.severity==='blocker'?'blocking':'degraded',
    what_happened:`Field mapping ${gap.gapKind}; preservation ${gap.preservationStatus}; affected count ${gap.affectedScope.countStatus}.`,
    evidence_refs:[{artifact:'mapping/review/mapping-gaps.json',locator:gap.id}],...extra });
  if (gap.gapKind === 'excluded' && gap.affectedScope.countStatus === 'known' && gap.affectedScope.count > 0) add('fidelity_loss','dropped_field');
  if (gap.gapKind === 'lossy') add('fidelity_loss','coerced_value');
  if (gap.gapKind === 'no-native-target' && gap.nativeBehaviorMissing.length) add('fidelity_loss','no_target');
  if (gap.gapKind === 'unresolved') add('skill_coverage_gap', gap.limitation.status === 'conflicting-knowledge' ? 'ambiguous_instruction' : 'path_not_covered');
  if (gap.limitation.status === 'missing-writer') add('skill_coverage_gap','path_not_covered');
  if (['missing_capability','missing_api','internal_only'].includes(gap.limitation.status) && gap.limitation.wix_api_surface && gap.limitation.signature) {
    add('api_gap',gap.limitation.status,{wix_api_surface:gap.limitation.wix_api_surface,actual:canonical({signature:gap.limitation.signature})});
  }
  return [...new Map(events.map(e=>[canonical([e.event_type,e.subtype,e.wix_api_surface]),e])).values()];
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true}); const staging = `${file}.writing`;
  fs.writeFileSync(staging, `${JSON.stringify(value,null,2)}\n`); fs.renameSync(staging,file);
}
function readOptional(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : fallback; }
function fieldSection(rows) {
  const safe = s => String(s ?? '').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
  return ['## Exact field mappings','', '| Entity | Decision | Source paths | Outcome | Operation / input / path |', '| --- | --- | --- | --- | --- |',
    ...rows.flatMap(r=>(r.fieldMappings || []).map(d=>`| ${safe(entityRef(r))} | ${safe(d.id)} | ${safe(decisionLocations(d).map(L.readable).join(', '))} | ${d.disposition} | ${safe([...(d.outputs||[]).map(o=>`${o.writeOperation} / ${o.writeInput} / ${o.targetPath}${o.appliesWhen ? ` when ${Applicability.readable(o.appliesWhen)}` : ''}`),...(d.omittedOutputs||[]).map(o=>`omit ${o.writeOperation} / ${o.writeInput} / ${o.targetPath}`)].join('; '))} |`)),
    '', '### Mapping gaps and consequences', '',
    '| Entity | Source paths | Handling | Affected records | Reason / missing behavior | Next action |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.flatMap(gapRows).map(g=>`| ${safe(g.sourceEntity)} | ${safe(g.sourcePaths.join(', '))} | ${g.gapKind} | ${g.affectedScope.countStatus==='known' ? g.affectedScope.count : 'unknown'} | ${safe([g.description,...g.nativeBehaviorMissing].join('; '))} | ${safe(g.nextAction?.cta || g.recommendedHandling)} |`),
    ...omissionReviewSection(rows,safe)
  ].join('\n');
}
// Plain-text omission review: one line per selector-qualified location with its own measured
// count, plus each contributing decision's union count. Source values are never shown.
function omissionReviewSection(rows,safe) {
  const count=s=>s?.countStatus==='known' ? String(s.count) : 'unknown';
  const lines=rows.flatMap(r=>{
    const byId=new Map((r.fieldMappings || []).map(d=>[d.id,d]));
    return (r.fieldDispositions || []).filter(d=>d.status!=='mapped').map(d=>`| ${safe(entityRef(r))} | ${safe(d.kind==='intended' ? `${d.writeOperation}: ${d.path}` : L.readable(d.path))} | ${d.status} | ${count(d.affectedScope)} | ${safe(d.decisionRefs.map(id=>`${id} (${count(affectedScope(byId.get(id)?.affectedScope,r.discoveryCoverage))} records across its locations)`).join('; '))} |`);
  });
  if (!lines.length) return [];
  return ['', '### Not migrated or pending, by source location', '',
    'Each location is counted separately; a record can appear under several locations. The decision count is the union across that decision\'s locations.', '',
    '| Entity | Location | Status | Records at this location | Decision (records across its locations) |', '| --- | --- | --- | --- | --- |', ...lines];
}
function replaceSection(text, section) {
  const start='<!-- exact-field-mapping:start -->', end='<!-- exact-field-mapping:end -->';
  const block=`${start}\n${section}\n${end}`;
  if (text.includes(start) && text.includes(end)) return text.slice(0,text.indexOf(start))+block+text.slice(text.indexOf(end)+end.length);
  return `${text.trimEnd()}\n\n${block}\n`;
}
// No importer exists for a plan without any resolved automatic scope. Keep the explicit
// unavailable result in existing mapping reports and project it into the existing handoff.
function mappingReviewFallback(plan,ledger) {
  if (plan?.fieldContractVersion!==1 || !plan.executionScope?.selectedEntityRefs?.length || !Array.isArray(plan.executionScope.resolvedEntityRefs)) return null;
  const {selectedEntityRefs,resolvedEntityRefs,deferredEntities}=plan.executionScope;
  if (!Array.isArray(deferredEntities) || selectedEntityRefs.some(ref=>resolvedEntityRefs.includes(ref)===deferredEntities.some(d=>d.entityRef===ref))) return null;
  if (resolvedEntityRefs.some(ref=>entityRows(plan).find(row=>entityRef(row)===ref)?.targetClassification!=='manual-mapping')) return null;
  return {status:'unavailable',reason:'no-importer-execution',mappingPlanDigest:digest(plan),gapLedgerDigest:digest(ledger),
    artifacts:['mapping/mapping-plan.json','mapping/review/mapping-gaps.json','mapping/review/mapping-summary.md','mapping/review/mapping-plan.md'],
    deferredEntities:plan.executionScope.deferredEntities || [],
    requiredInput:'Requires Import Operator: resolve deferred field decisions or follow the retained manual runbooks; recapture and publish under the next actual importer execution.'};
}
function persistMappingReviewFallback(projectDir,publication) {
  const start='<!-- mapping-review-publication:start -->',end='<!-- mapping-review-publication:end -->';
  const block=publication ? `${start}\n## Migration review publication\n\nCurrent-run Migration review publication is unavailable. No importer execution or published Data tasks are claimed.\n\n\`\`\`json\n${JSON.stringify({reviewPublication:publication},null,2)}\n\`\`\`\n${end}` : '';
  for (const name of ['mapping-summary.md','mapping-plan.md']) {
    const file=path.join(projectDir,'mapping/review',name);
    let text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
    if (text.includes(start) && text.includes(end)) text=text.slice(0,text.indexOf(start))+text.slice(text.indexOf(end)+end.length);
    const next=`${text.trimEnd()}${block ? `\n\n${block}` : ''}\n`;
    if (next!==text) {fs.mkdirSync(path.dirname(file),{recursive:true});const staging=`${file}.writing`;fs.writeFileSync(staging,next);fs.renameSync(staging,file);}
  }
}
function compareMappingProjections(projectDir, plan) {
  const errors=[];
  for (const row of entityRows(plan)) {
    const invalid=validateEntity(row);
    if (invalid.length) {errors.push(...invalid);continue;}
    const expected=projectEntity(row);
    if (canonical(row.fieldDispositions || [])!==canonical(expected.fieldDispositions)) errors.push(`${entityRef(row)}: authority dispositions conflict with field decisions`);
    const actual=readOptional(path.join(projectDir,'mapping/entity-decisions',entityFileName(row)),null);
    if (!actual || canonical(actual)!==canonical({...expected,executionScope:plan.executionScope})) errors.push(`${entityRef(row)}: missing/conflicting entity projection`);
  }
  if (!errors.length && plan?.fieldContractVersion===1) errors.push(...require('./mapping-resolution').compare(projectDir,plan).errors);
  return {ok:errors.length===0,errors};
}
async function writeMappingAuthority(projectDir, next, { provisionalEntityRefs=null, recordTelemetry=null, omissionReviewEntityRefs=null } = {}) {
  const mode=mappingRunMode(projectDir);
  const planFile=path.join(projectDir,'mapping/mapping-plan.json'), previous=readOptional(planFile,{});
  const approval=readOptional(path.join(projectDir,'orchestration/approvals.json'),{}).mapping;
  if (['approved','provisional'].includes(approval?.status)) fail('reopen the existing mapping checkpoint before replacing authority');
  if (next.fieldContractVersion !== 1) fail('new/revised plan must declare fieldContractVersion:1; legacy decisions are not upgraded automatically');
  if (omissionReviewEntityRefs !== null && !Array.isArray(omissionReviewEntityRefs)) fail('omission review entities must be an array');
  if (omissionReviewEntityRefs && require('./mapping-omission-approval').mode(readOptional(path.join(projectDir,'orchestration/decisions.json'),{}))==='one_click') fail('omission review requires interactive mode');
  const candidate=structuredClone(next);
  const rows=entityRows(candidate).map(row=>{
    const legacy=readOptional(path.join(projectDir,'mapping/entity-decisions',entityFileName(row)),{});
    delete legacy.executionScope;
    const merged={...legacy,...row};
    // A proposal is a per-call choice, never inherited from either authority projection.
    delete merged.omissionReviewRequested;
    if (omissionReviewEntityRefs?.includes(entityRef(row))) merged.omissionReviewRequested=true;
    return merged;
  });
  const errors=rows.flatMap(validateEntity);
  if (!rows.length || errors.length) fail(errors.join('; ') || 'empty authority');
  require('./operation-assessments').validate(candidate, projectDir);
  require('./operation-assessments').withPlan(candidate,projectDir,()=>require('./mapping-target-rules').assertKnownMappings(candidate));
  for (const row of rows) for (const d of row.fieldMappings || []) if (d.recovery) require('./mapping-recovery').validate(projectDir, row, d);
  assertRemapIdentity(previous,next);
  const slugs=rows.map(entityFileName);
  if (new Set(slugs).size!==slugs.length) fail('entity filenames collide; reconcile source identities');
  const projected = rows.map(projectEntity);
  const plan=candidate;
  // Keep the producer's existing container vocabulary, including object-keyed entities.
  for (const key of ['entities','entityDecisions','entityMappings','mappings']) {
    if (Array.isArray(plan[key])) { plan[key]=projected; break; }
    if (key==='entities' && plan[key] && typeof plan[key]==='object') { plan[key]=Object.fromEntries(Object.entries(plan[key]).map(([k,row])=>[k,projected.find(r=>entityRef(r)===entityRef({sourceEntity:k,...row}))])); break; }
  }
  if (!plan.executionScope && previous.executionScope) plan.executionScope={selectedEntityRefs:previous.executionScope.selectedEntityRefs};
  plan.executionScope=deriveExecutionScope(plan,{mode,provisionalEntityRefs,omissionReview:mode!=='one_click'});
  const gapFile=path.join(projectDir,'mapping/review/mapping-gaps.json'), existing=readOptional(gapFile,[]);
  const previousGaps=Array.isArray(existing)?existing:existing.gaps || [], byId=new Map(previousGaps.filter(g=>g.id).map(g=>[g.id,g]));
  const activeIds=new Set(projected.flatMap(gapRows).map(g=>g.id));
  for (const row of projected) for (const gap of gapRows(row)) {
    gap.supersedes=[...new Set([...gap.supersedes,...previousGaps.filter(p=>p.gapType==='field-mapping' && p.sourceEntity===gap.sourceEntity && p.decisionId===gap.decisionId && p.gapKind!==gap.gapKind && !activeIds.has(p.id)).map(p=>p.id)])].sort();
    const prior=byId.get(gap.id); if (prior && prior.preservationStatus !== 'planned' && canonical(prior.storage) === canonical(gap.storage) && canonical(prior.affectedScope) === canonical(gap.affectedScope)) { gap.preservationStatus=prior.preservationStatus; gap.resolutionEvidence=prior.resolutionEvidence; }
    byId.set(gap.id,gap);
  }
  const gaps=[...previousGaps.filter(g=>!g.id), ...byId.values()];
  const recoveryRefs = new Map((previous.recoveryGapRefs || []).map(r=>[r.id,r]));
  for (const g of gaps.filter(g=>g.recovery)) recoveryRefs.set(g.id,{id:g.id,sourceEntity:g.sourceEntity,
    recoveryDigest:require('./operation-assessments').digest([g.recovery,g.affectedScope])});
  if (recoveryRefs.size) plan.recoveryGapRefs=[...recoveryRefs.values()];
  // The approval-bound resolution is a projection of this authority (any source); a CSV
  // resolver seed is retained. Computed before persistence so a failure changes nothing.
  const resolutionLib=require('./mapping-resolution');
  const seed=resolutionLib.seedOf(readOptional(path.join(projectDir,resolutionLib.FILE),null));
  if (seed?.provenance?.tampered) fail('mapping resolution seed was edited after projection; rerun the resolver, then the mapping contract');
  const resolution=resolutionLib.project(plan,{seed});
  // Commit authority first. A crash during projections is recovered by re-running from it.
  atomicJson(planFile,plan);
  for (const row of projected) {
    const file=path.join(projectDir,'mapping/entity-decisions',entityFileName(row));
    atomicJson(file,{...row,executionScope:plan.executionScope});
  }
  atomicJson(gapFile,Array.isArray(existing)?gaps:{...existing,gaps});
  atomicJson(path.join(projectDir,resolutionLib.FILE),resolution);
  const section=fieldSection(projected)+`\n\nExecution scope: ${canonical(plan.executionScope)}\n\nField gaps: ${gaps.filter(g=>g.gapType==='field-mapping').map(g=>`${g.id} (${g.preservationStatus}; ${g.affectedScope.countStatus} affected count)`).join('; ') || 'none'}.\n`;
  for (const name of ['mapping-plan.md','mapping-summary.md']) {
    const file=path.join(projectDir,`mapping/review/${name}`); fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,replaceSection(fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',section));
  }
  persistMappingReviewFallback(projectDir,mappingReviewFallback(plan,Array.isArray(existing)?gaps:{...existing,gaps}));
  const telemetryFailures=[];
  const record = recordTelemetry || (event=>require('../resources/rp-telemetry/lib/telemetry-recorder.js').record(projectDir,event));
  const observations = require('../resources/rp-telemetry/lib/knowledge-observation');
  const toolkitVersion = require('../resources/rp-telemetry/lib/telemetry-recorder').resolveSkillsVersion() || 'unknown';
  for (const assessment of plan.operationAssessments || []) {
    if ((previous.operationAssessments || []).some(a=>digest(a)===digest(assessment))) continue;
    try { await record(observations.event({findingClass:'missing-knowledge',targetRef:assessment.targetRef,operation:assessment.operation,
      toolkitVersion,outcome:'resolved-mapping',verificationLevel:'mapping-examples',affectedCount:null})); }
    catch(e) { telemetryFailures.push({reason:e.code || 'telemetry_failed'}); }
  }
  for (const row of projected) for (const d of row.fieldMappings || []) if (d.knowledgeFinding && d.outputs?.length) {
    const prior=entityRows(previous).find(r=>entityRef(r)===entityRef(row))?.fieldMappings?.find(p=>p.id===d.id);
    if (prior && digest(prior)===digest(d)) continue;
    for(const output of [...new Map(d.outputs.map(o=>[canonical([o.targetRef,o.writeOperation]),o])).values()]) {
      try {await record(observations.event({findingClass:d.knowledgeFinding,targetRef:output.targetRef,operation:output.writeOperation,
        toolkitVersion,outcome:'resolved-mapping',verificationLevel:'mapping-examples',affectedCount:d.affectedScope?.countStatus==='known'?d.affectedScope.count:null}));}
      catch(e) {telemetryFailures.push({decisionId:d.id,reason:e.code || 'telemetry_failed'});}
    }
  }
  for (const g of gaps.filter(g=>g.gapType==='field-mapping')) {
    if (previousGaps.some(p=>p.id===g.id && digest(p)===digest(g))) continue;
    for (const event of telemetryForGap(g)) { try { await record(event); } catch(e) {telemetryFailures.push({gapId:g.id,reason:e.code||'telemetry_failed'});} }
    if (g.gapKind === 'unresolved') {
      const findingClass = ['missing-writer','source-ambiguity','conflicting-knowledge','target-limitation'].includes(g.limitation?.status) ? g.limitation.status : 'missing-knowledge';
      try { await record(observations.event({findingClass,targetRef:g.recovery?.createWithoutField?.targetRef || g.targetRef,
        operation:g.recovery?.createWithoutField?.operation || g.writeOperation,toolkitVersion,
        outcome:g.disposition==='deferred-field'?'deferred-field':'deferred-record',verificationLevel:g.recovery?'schema-reviewed':'not-verified',
        affectedCount:g.affectedScope.countStatus==='known'?g.affectedScope.count:null})); }
      catch(e) {telemetryFailures.push({gapId:g.id,reason:e.code||'telemetry_failed'});}
    }
  }
  return { plan,gaps,telemetryFailures,blockedResult:mode==='one_click'?deferredRunResult(plan):null };
}
module.exports={measuredZeroExclusion,mandatoryExclusion,carriedToCutoverExclusion,CARRIED_POLICY,pendingDecision,mappingRunMode,GAP_KEYS,canonical,digest,entityRef,entityKeyMatches,entityFileName,entityRows,entityDecisionFileName,validateEntity,affectedScope,assertRemapIdentity,
  deriveExecutionScope,assertExecutionScope,deferredRunResult,deferredMappingActions,mappingReviewFallback,persistMappingReviewFallback,projectEntity,gapRows,telemetryForGap,compareMappingProjections,writeMappingAuthority,
  exactPath,decisionLocations,outputLocations,coverageLocations};
