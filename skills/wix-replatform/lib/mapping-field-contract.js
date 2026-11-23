'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./source-location');
const Applicability = require('./output-applicability');
const { archiveCollectionIdMatchesSource, isWixCollectionId } = require('./cms-collection-id.js');
const { contactAddressTargetPathError } = require('./contact-address-contract.js');
const WriterShape = require('./writer-request-shape.js');
// Source entities the toolkit derives itself and binds on the contact task (order-buyer.js
// guestBuyerContactRows, review-import.js guestReviewContactRows; execution-manifest-generate.js
// DERIVED_ROLES). They follow the entities that need them and the order's guest-buyers choice.
const TOOLKIT_DERIVED_ENTITIES = Object.freeze(['guest-buyer-contact', 'guest-review-contact']);
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

// Native commerce records must never be reduced to a record-level CMS archive by a
// mapper that failed to load target knowledge. Field-level CMS preservation is valid, but
// an all-archive core row is an unusable mapping and must stop before approval or writes.
const CORE_COMMERCE_SOURCE = /(?:^|[_./-])(?:products?|contacts?|customers?|orders?)$/i;
function coreCommerceArchiveOnly(row) {
  if (!row || typeof row !== 'object') return false;
  const targetRef = row.targetRef || (row.targetDomain && row.targetEntity ? `${row.targetDomain}/${row.targetEntity}` : null);
  const source = entityRef(row);
  const coreSource = typeof source === 'string' && CORE_COMMERCE_SOURCE.test(source);
  const archiveTarget = row.targetClassification === 'cms' || targetRef === 'cms/data-item';
  const decisions = Array.isArray(row.fieldMappings) ? row.fieldMappings : [];
  if (coreSource && row.targetClassification === 'cms') return true;
  if (coreSource && archiveTarget && decisions.length > 0 && decisions.every(decision => decision?.disposition === 'cms')) return true;
  return false;
}
function validatePlanSafety(plan) {
  return entityRows(plan).filter(coreCommerceArchiveOnly).map(row => {
    const source = entityRef(row) || 'unknown source entity';
    const target = row.targetRef || (row.targetDomain && row.targetEntity ? `${row.targetDomain}/${row.targetEntity}` : 'cms/data-item');
    return `${source}: all-archive mapping for core commerce target ${target} is not approvable; resolve a native Wix target or leave the mapping pending`;
  });
}
// Read-back units are plan rows, not targets: several source populations may write one Wix
// entity (customers, guest buyers and guest reviewers all become crm/contact records). A unit's
// key is the gated entity name (`contact`) when exactly one row targets that entity, else
// `<entity>.<row file key>` (`contact.guest-buyer-contact`), one per row. Every read-back file
// and state entry is named by this key.
const READ_BACK_KEY = /^([a-z]+)(?:\.([a-z0-9]+(?:-[a-z0-9]+)*))?$/;
function splitReadBackKey(key) {
  const match = typeof key === 'string' ? READ_BACK_KEY.exec(key) : null;
  return match ? { entity: match[1], rowKey: match[2] || null } : null;
}
const rowFileKey = row => { try { return entityFileName(row).replace(/\.json$/, ''); } catch { return null; } };
// The plan rows a gated entity name matches (same identity set as entityKeyMatches).
function readBackRows(plan, entity) { return entityRows(plan || {}).filter(row => entityKeyMatches(row, entity)); }
// The unit keys of one gated entity in this plan (none when no row targets it).
function readBackKeys(plan, entity) {
  const rows = readBackRows(plan, entity);
  return rows.length <= 1 ? rows.map(() => entity) : rows.map(row => `${entity}.${rowFileKey(row)}`);
}
// The plan row of one unit key. A bare entity name that several rows match has no single row.
function readBackRow(plan, key) {
  const parts = splitReadBackKey(key);
  if (!parts) return null;
  const rows = readBackRows(plan, parts.entity);
  if (parts.rowKey) return rows.find(row => rowFileKey(row) === parts.rowKey) || null;
  if (rows.length > 1) fail(`entity decision identity is ambiguous: ${key}; use one of ${readBackKeys(plan, parts.entity).join(', ')}`);
  return rows[0] || null;
}
// The unit key of the plan row a source binding reads (its source entity), for one gated entity.
// With one row the key is the entity name whatever the binding calls its source.
function readBackKeyFor(plan, entity, sourceEntity) {
  const keys = readBackKeys(plan, entity);
  if (keys.length <= 1) return entity;
  return keys.find(key => { const row = readBackRow(plan, key); return row && (row.sourceEntity === sourceEntity || entityRef(row) === sourceEntity); }) || null;
}
// Resolve a read-back unit key (for example `contact`) to the decision projection
// written for its exact-plan source identity (for example `wc-v3-customers.json`).
// Legacy plans have no matching source row and retain their target-named filename.
function entityDecisionFileName(plan, key) {
  const row = readBackRow(plan, key);
  return row ? entityFileName(row) : `${key}.json`;
}
// Exact locations use the shared lossless grammar (lib/source-location.js). Legacy dotted
// paths of the former identifier-only grammar are already canonical and keep their meaning.
function exactPath(value) {
  return typeof value === 'string' && L.isExact(value);
}
// writeInput is legacy: the toolkit owns the request key. Absent is fine; present must still parse.
const optionalPath = value => value === undefined || exactPath(value);
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
// A populated exclusion awaits approval unless it is mandatory, measured empty, carried to cutover,
// or a deliberate drop that records its choice (design v2: the plan is the record of intent; the
// choice becomes a cutover action in the completion report).
function pendingDecision(row,d) {
  return d.disposition==='unresolved' || (d.disposition==='excluded' && !mandatoryExclusion(row,d) &&
    !measuredZeroExclusion(row,d) && !carriedToCutoverExclusion(row,d) && !deliberateDrop(d));
}
function mappingRunMode(projectDir) {
  return require('./orchestration-decisions.js').isExplicitUserOneClick(readOptional(path.join(projectDir,'orchestration/decisions.json'),{})) ? 'one_click':'interactive';
}
// Every in-use entity is mapped: native, else an admitted extended field, else CMS. The only
// alternative is one of these typed reasons on its pending row (`limitation`, the same field
// the gap ledger carries). It becomes that entity's Cutover item through the deferred scope
// (deferredMappingActions -> completion-report operatorActions) and mapping-gaps.json.
const SET_ASIDE_REASONS = Object.freeze({
  'source-read-failed': 'Its source records could not be read in full.',
  'missing-writer': 'No Wix write operation exists for it.',
  'missing-setup-step': 'Its Wix writes exist, but the toolkit has no setup step yet for what they need first, so a person sets it up in Business Manager.',
  'target-limitation': 'Wix cannot hold it natively, in an extended field or in CMS.',
});
const NOT_A_REASON = /\b(?:not (?:yet )?(?:mapped|reviewed|decided|inspected)|unmapped|undecided|unreviewed)\b/i;
// Refused completion attempts before an unmapped plan becomes a typed blocker instead of
// another return to the mapper.
const MAPPING_COMPLETION_PASSES = 2;
const COMPLETENESS_FILE = 'mapping/review/mapping-completeness.json';
function setAsideErrors(row) {
  const l = row?.limitation;
  if (l === undefined) return [];
  if (!l || typeof l !== 'object' || !Object.hasOwn(SET_ASIDE_REASONS, l.status)) return [`limitation.status must be one of ${Object.keys(SET_ASIDE_REASONS).join(', ')}`];
  if (typeof l.detail !== 'string' || !l.detail.trim() || NOT_A_REASON.test(l.detail)) return ['limitation.detail must say why this entity cannot be mapped; "not mapped yet" or "undecided" is not a reason'];
  return [];
}
function setAside(row) { return row?.fieldMappingStatus==='pending' && row.limitation!==undefined && !setAsideErrors(row).length ? row.limitation : null; }
function inUseEntity(row) { return row?.inUse !== false && row?.sourceRecordCount !== 0; }
// In-use entities left pending without a typed reason. Pending is never a reason on its own.
function unmappedEntities(plan) {
  return entityRows(plan || {}).filter(row => row.fieldMappingStatus==='pending' && inUseEntity(row) && !setAside(row))
    .map(row => ({ entityRef: entityRef(row), sourceRecordCount: Number.isSafeInteger(row.sourceRecordCount) ? row.sourceRecordCount : null }));
}
// A typed reason on a mapped (not pending) row: the mapper states why its records stay out.
function statedLimitation(row) { return row?.limitation !== undefined && !setAsideErrors(row).length ? row.limitation : null; }
// Whole-kind coverage at mapping exit: an in-use entity with records whose row is mapped but whose
// every record the execution scope leaves out (deriveExecutionScope, the same scope the import
// guard reads) with no stated reason. Run 7: order and product-review were deferred because a
// prerequisite (guest-buyer-contact, guest-review-contact) had no row; the rows were resolved, so
// mapping passed and 388 records were silently left out. Stated reasons: a typed `limitation` on
// the row, the operator's skip, or a prerequisite that is itself set aside with one (its cutover
// item explains the dependent). A deferral for the row's own unresolved decisions or record holds
// is already stated: each is a typed gap in mapping-gaps.json. A prerequisite deferral has no gap.
function outOfScopeEntities(plan) {
  let scope;
  try { scope = deriveExecutionScope(plan, { mode: 'one_click', omissionReview: true }); } catch { return []; }
  const byRef = new Map(entityRows(plan).map(row => [entityRef(row), row]));
  const deferred = new Map(scope.deferredEntities.map(d => [d.entityRef, d]));
  const explained = ref => deferred.get(ref)?.limitation || statedLimitation(byRef.get(ref));
  return scope.deferredEntities.filter(d => {
    const row = byRef.get(d.entityRef);
    if (!row || row.fieldMappingStatus === 'pending' || !inUseEntity(row) || d.limitation || statedLimitation(row)) return false;
    return d.blockedByEntityRefs.length > 0 && !d.blockedByEntityRefs.every(explained);
  }).map(d => ({ entityRef: d.entityRef, sourceRecordCount: Number.isSafeInteger(byRef.get(d.entityRef).sourceRecordCount) ? byRef.get(d.entityRef).sourceRecordCount : null,
    outOfScope: true, reason: d.reason, ...(d.blockedByEntityRefs.length ? { blockedByEntityRefs: d.blockedByEntityRefs } : {}) }));
}
// In-use entities discovery found (the census, discovery/census.json) with no plan row and no
// decided census disposition (a mapping-gaps.json entry naming its censusId). In one-click an
// open `pending` question is not a decision (nobody answers it); interactive mode asks it in the
// review. Same list the census reconciliation reads; no census, nothing here.
function undecidedDiscoveredEntities(projectDir, plan) {
  let census = null, gaps = null;
  try { census = readOptional(path.join(projectDir, 'discovery/census.json'), null); } catch { return []; }
  if (!Array.isArray(census?.rows)) return [];
  try { gaps = readOptional(path.join(projectDir, 'mapping/review/mapping-gaps.json'), null); } catch { gaps = null; }
  gaps = Array.isArray(gaps) ? gaps : Array.isArray(gaps?.gaps) ? gaps.gaps : [];
  const { planCensusIds } = require('./census-reconciliation.js');
  const oneClick = mappingRunMode(projectDir) === 'one_click';
  const planned = new Set(entityRows(plan).flatMap(row => planCensusIds(row, census.rows).ids));
  const decided = new Set(gaps.filter(g => g && g.censusId != null && typeof g.disposition === 'string' && (g.disposition !== 'pending' || !oneClick)).map(g => g.censusId));
  return census.rows.filter(row => row?.kind === 'entity' && row.decisionRow && Number.isSafeInteger(row.recordCount) && row.recordCount > 0
    && !planned.has(row.censusId) && !decided.has(row.censusId))
    .map(row => ({ entityRef: row.censusId, sourceRecordCount: row.recordCount, noPlanRow: true }));
}
function mappingCompleteness(projectDir, plan) {
  // Entities the run settled after the passes (lib/route-settlement.js) are reported, not returned.
  const settled = plan?.fieldContractVersion===1 ? require('./route-settlement').settledUnmappedEntities(projectDir) : new Set();
  const unmapped = plan?.fieldContractVersion===1 ? [...unmappedEntities(plan), ...outOfScopeEntities(plan), ...undecidedDiscoveredEntities(projectDir, plan)].filter(u => !settled.has(u.entityRef)) : [];
  let record = null;
  try { record = readOptional(path.join(projectDir, COMPLETENESS_FILE), null); } catch { record = null; }
  const passes = unmapped.length && Array.isArray(record?.refusedPasses) ? record.refusedPasses.length : 0;
  return { ok: unmapped.length===0, unmapped, passes, exhausted: passes >= MAPPING_COMPLETION_PASSES };
}
function priorPasses(file) {
  try { const rows = readOptional(file, {}).refusedPasses; return Array.isArray(rows) ? rows : []; } catch { return []; }
}
// The router's hand-back of an unmapped plan is a pass too, so interactive mode (where nobody
// approves an incomplete plan) is bounded. It joins the refused approval of the same plan
// digest that it follows, so one mapper pass is never counted twice.
// A complete plan drops a leftover count, so a later revision starts its own passes.
function clearMappingPasses(projectDir) {
  const file = path.join(projectDir, COMPLETENESS_FILE);
  if (fs.existsSync(file)) fs.rmSync(file);
}
function recordMappingHandBack(projectDir, plan, unmapped) {
  const file = path.join(projectDir, COMPLETENESS_FILE), refusedPasses = priorPasses(file), planDigest = digest(plan), last = refusedPasses.at(-1);
  if (last && last.source === 'approval' && last.planDigest === planDigest && !last.routed) last.routed = true;
  else refusedPasses.push({ planDigest, entityRefs: unmapped.map(u => u.entityRef), source: 'router', routed: true });
  atomicJson(file, { schemaVersion: 1, refusedPasses });
  return refusedPasses.length;
}
// Called by every mapping approval writer before approved/provisional. A refused attempt is a
// counted pass; a complete plan clears the count.
function assertMappingComplete(projectDir) {
  const file = path.join(projectDir, COMPLETENESS_FILE);
  const plan = readOptional(path.join(projectDir, 'mapping/mapping-plan.json'), null);
  const state = mappingCompleteness(projectDir, plan);
  if (state.ok) { clearMappingPasses(projectDir); return state; }
  const refusedPasses = [...priorPasses(file), { planDigest: digest(plan), entityRefs: state.unmapped.map(u => u.entityRef), source: 'approval' }];
  atomicJson(file, { schemaVersion: 1, refusedPasses });
  const outOfScope = state.unmapped.filter(u => u.outOfScope).map(u => `${u.entityRef} is mapped but none of its ${u.sourceRecordCount ?? ''} records would import: ${u.reason}`.replace(/  +/g, ' '));
  throw Object.assign(new Error(`mapping_incomplete: map ${state.unmapped.map(u => u.entityRef).join(', ')} (native, extended field, then CMS) or record a typed limitation on its row; deferring is not a reason${outOfScope.length ? `. ${outOfScope.join(' ')}` : ''}`), {
    code: 'mapping_incomplete', unmapped: state.unmapped, passes: refusedPasses.length });
}
// A writing decision's source leaves each feed one of its outputs (output inputs, applicability or
// reference input); a leaf it means to drop moves to an excluded/unresolved decision, which is a
// typed cutover gap. Target knowledge `sourceReferenceLeaves` names the leaves that carry a
// reference (an order's customer_id, a line's product and variation ids). Such a leaf, wherever the
// row claims it, must feed the reference path the dependency gate fills, judged by the same helper
// verifyGrant and the read-back canary use (dependency-readiness gateSuppliedReferences). Listing it
// beside an unrelated output (customer_id on buyerInfo.email) is a dropped reference.
const WRITING = ['native', 'extended-field'];
function unfedLeafErrors(row) {
  const errors = [], decisions = (row.fieldMappings || []).filter(d => d && Array.isArray(d.sourcePaths));
  const writing = decisions.filter(d => WRITING.includes(d.disposition) && Array.isArray(d.outputs));
  for (const d of writing) {
    let own, fed;
    try {
      own = decisionLocations(d);
      fed = new Set(d.outputs.flatMap(o => [...outputLocations(d, o), ...(o?.appliesWhen !== undefined ? Applicability.locations(o.appliesWhen) : [])]));
      if (d.referencePolicy?.input) fed.add(loc(d.referencePolicy.input));
    } catch { continue; }
    for (const p of own) if (!fed.has(p)) errors.push(`${d.id}: mapping-source-leaf-unfed: ${p} feeds no output; write it to an output, or move it to an excluded/unresolved decision so it becomes a cutover gap`);
  }
  const claimed = new Set(decisions.flatMap(d => { try { return decisionLocations(d); } catch { return []; } }));
  // A reference link the plan drops on purpose: the leaf sits only in an `excluded` decision whose
  // recorded choice the OPERATOR made. A link is never dropped by the one-click AI or a suggestion
  // (safest default until Elad decides): such a plan is refused here, the mapper keeps the link, and
  // a record whose parent cannot land is held at import and becomes a cutover item.
  const locs = d => { try { return decisionLocations(d); } catch { return []; } };
  const writingClaims = new Set(writing.flatMap(locs));
  const deliberate = new Set(decisions.filter(d => deliberateDrop(d) && d.choice.decidedBy === 'operator').flatMap(locs).filter(p => !writingClaims.has(p)));
  const targets = [...new Set(writing.flatMap(d => d.outputs.map(o => o?.targetRef)).filter(Boolean))];
  for (const targetRef of targets) {
    let leaves;
    try { leaves = require('./dependency-proofs').domain(targetRef).sourceReferenceLeaves; } catch { continue; }
    for (const [ref, paths] of Object.entries(leaves || {})) {
      if (!Array.isArray(paths)) continue;
      for (const leaf of paths.map(loc).filter(p => claimed.has(p) && !deliberate.has(p))) {
        const ok = writing.some(d => d.outputs.some(o => o?.targetRef === targetRef && exactPath(o.targetPath) && outputLocations(d, o).includes(leaf) &&
          require('./dependency-readiness').gateSuppliedReferences([targetRef], o.targetPath).some(x => x.kind === 'dependency' && x.ref === ref)));
        if (!ok) errors.push(`mapping-reference-leaf-dropped: ${leaf} carries the ${ref} reference but feeds no ${targetRef} output at its gate-filled path (${(require('./dependency-proofs').domain(targetRef).dependencyReferenceFields?.[ref] || []).join(' or ')}); map it there with a native output (the dependency gate writes the Wix id), or, only when the operator asked to drop the link, move it to an excluded decision whose choice is decidedBy operator`);
      }
    }
  }
  return errors;
}
// Transform kinds. The first four are the suggestion vocabulary; the rest are operator changes
// (design v2): add a prefix/suffix, set a constant, read another source field, or a plain-words
// instruction codegen implements. A value map is the existing `lookup` (cases + unknown).
// Operator kinds may layer on `base`, the suggested transform applied first, so a change keeps
// the suggestion it edits (for example a name prefix over the product name helper).
// "Drop a field" is not a transform: it is an `excluded` disposition.
const BASE_TRANSFORM_KINDS = ['identity', 'expression', 'lookup', 'helper'];
const OPERATOR_TRANSFORM_KINDS = ['affix', 'constant', 'source-field', 'instruction'];
const TRANSFORM_KINDS = [...BASE_TRANSFORM_KINDS, ...OPERATOR_TRANSFORM_KINDS];
const UNDECIDED_EXPRESSION = /chronology fields|see schema|as appropriate/i;
const UNDECIDED_TEXT = /chronology fields|see schema|as appropriate|\btbd\b|\btodo\b|to be decided|undecided/i;
function transformErrors(t, sourcePaths = [], depth = 0) {
  if (!t || typeof t !== 'object' || Array.isArray(t) || !TRANSFORM_KINDS.includes(t.kind)) return ['exact transform is required'];
  if (depth > 3) return ['transform base is nested too deep'];
  const errors = [], text = v => typeof v === 'string' && v.trim().length > 0;
  if (t.kind === 'expression' && (!t.expression || UNDECIDED_EXPRESSION.test(t.expression))) errors.push('undecided expression');
  if (t.kind === 'helper' && (!t.name || !t.revision || !t.arguments)) errors.push('helper requires name, revision and arguments');
  if (t.kind === 'lookup' && (!t.cases || !t.unknown)) errors.push('lookup requires cases and unknown handling');
  if (t.kind === 'affix') {
    for (const k of ['prefix', 'suffix']) if (t[k] !== undefined && typeof t[k] !== 'string') errors.push(`affix ${k} must be a string`);
    if (!text(t.prefix) && !text(t.suffix)) errors.push('affix requires a non-empty prefix or suffix');
  }
  if (t.kind === 'constant' && !Object.hasOwn(t, 'value')) errors.push('constant requires value');
  if (t.kind === 'source-field' && (!exactPath(t.sourcePath) || !sourcePaths.includes(t.sourcePath))) errors.push('source-field requires sourcePath, one of the decision sourcePaths');
  if (t.kind === 'instruction' && (!text(t.text) || UNDECIDED_TEXT.test(t.text))) errors.push('instruction requires plain-words text that decides the change');
  if (t.base !== undefined) {
    if (!OPERATOR_TRANSFORM_KINDS.includes(t.kind)) errors.push(`${t.kind} transform cannot have a base`);
    else if (t.kind === 'constant') errors.push('constant ignores its input and cannot have a base');
    else errors.push(...transformErrors(t.base, sourcePaths, depth + 1).map(m => `base: ${m}`));
  }
  return errors;
}
// A one-click choice the AI, the operator or the suggestion made; the end report lists them.
const CHOICE_DECIDERS = ['ai', 'operator', 'suggestion'];
function choiceErrors(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['choice must be an object'];
  const errors = [], text = v => typeof v === 'string' && v.trim().length > 0;
  if (!text(c.name)) errors.push('choice requires name');
  for (const k of ['value', 'default']) if (!Object.hasOwn(c, k)) errors.push(`choice requires ${k}`);
  if (!text(c.reason)) errors.push('choice requires reason');
  if (!CHOICE_DECIDERS.includes(c.decidedBy)) errors.push(`choice decidedBy must be one of ${CHOICE_DECIDERS.join(', ')}`);
  return errors;
}
// An entity the operator chose not to import: an entity-level choice with value "skip" decided by the
// operator. Only the operator skips a whole entity (safest default); an AI or suggestion skip stays a
// deferred mapping with its high cutover task.
function operatorEntitySkip(row) {
  return (Array.isArray(row?.choices) ? row.choices : []).find(c => !choiceErrors(c).length && c.value === 'skip' && c.decidedBy === 'operator') || null;
}
// A record rule: which source records of this entity the operator imports. `keepWhen` is the
// output-applicability grammar over the entity's inventoried locations (plus before/after on dates);
// a record for which it is false is skipped by plan (the runner journals it and the site owner gets
// one cutover task). Skipping records loses data, so only the operator sets one.
function recordRuleErrors(row) {
  const rule = row.recordRule, errors = [], ref = entityRef(row);
  // One plain sentence per problem: what is wrong, and what a valid rule looks like.
  const HOW = `A record rule is {keepWhen, choice}: keepWhen says which ${ref} records to import (ops ${Applicability.OPS.join(', ')}, over the entity's inventoried locations), and choice records the operator's decision.`;
  const invalid = m => errors.push(`mapping-record-rule-invalid: ${ref} record rule ${m}. ${HOW}`);
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) { invalid('is not an object'); return errors; }
  const extra = Object.keys(rule).filter(k => !['keepWhen', 'choice'].includes(k));
  if (extra.length) invalid(`has unsupported keys ${extra.join(', ')}`);
  let own = []; try { own = coverageLocations(row); } catch { /* reported by coverage */ }
  for (const m of Applicability.validate(rule.keepWhen, own)) invalid(`keepWhen is invalid (${m.replace(/^appliesWhen/, 'keepWhen').replace("decision's source locations", "entity's inventoried locations")})`);
  for (const m of choiceErrors(rule.choice)) invalid(`choice is invalid (${m})`);
  if (rule.choice && !choiceErrors(rule.choice).length && rule.choice.decidedBy !== 'operator') errors.push(`mapping-record-rule-needs-operator: skipping ${ref} records loses data, so only the operator may set this rule (choice.decidedBy is ${rule.choice.decidedBy}). Ask the operator, or remove the rule to import every record.`);
  return errors;
}
// Whether the plan imports this source record (true when the entity has no record rule).
function keepsRecord(row, record) {
  return !row?.recordRule || Applicability.evaluate(row.recordRule.keepWhen, record);
}
// An exclusion that records its choice is a deliberate drop every plan-following check accepts.
function deliberateDrop(d) { return d?.disposition === 'excluded' && d.choice !== undefined && !choiceErrors(d.choice).length; }
// The completion report's droppedFields rows for fields the plan drops on purpose. `countAt(entityRef,
// path)` returns the populated-record count the run measured (the read-back inventory), or null; the
// decision's known affectedScope count is the fallback. countAt also receives the plan row. A path with no known count is left to its
// cutover action (planChoiceActions), never reported as zero.
function plannedDropRows(plan, countAt = () => null) {
  const rows = [];
  for (const row of entityRows(plan)) for (const d of (row?.fieldMappings || []).filter(deliberateDrop)) for (const p of d.sourcePaths || []) {
    let known = null; try { const sc = d.affectedScope ? affectedScope(d.affectedScope, row.discoveryCoverage) : null; known = sc?.countStatus === 'known' ? sc.count : null; } catch { /* unknown */ }
    const measured = countAt(entityRef(row), p, row), recordCount = Number.isSafeInteger(measured) ? measured : known;
    if (Number.isSafeInteger(recordCount) && recordCount > 0 && !rows.some(r => r.entity === entityRef(row) && r.field === p)) rows.push({ entity: entityRef(row), field: p, recordCount, reasonCode: 'dropped-by-plan-choice' });
  }
  return rows;
}
// Every recorded choice in plan order, for the end report.
// Entity-level choices (`entities[].choices[]`) come first with decisionId null, then field choices.
function planChoices(plan) {
  return entityRows(plan).flatMap(row => [
    ...(Array.isArray(row?.choices) ? row.choices : []).map(c => ({ entityRef: entityRef(row), decisionId: null, ...c })),
    ...(row?.recordRule?.choice ? [{ entityRef: entityRef(row), decisionId: 'recordRule', ...row.recordRule.choice }] : []),
    ...(row?.fieldMappings || []).filter(d => d?.choice).map(d => ({ entityRef: entityRef(row), decisionId: d.id, ...d.choice }))]);
}
// Each recorded choice is a cutover task in the completion report (Elad 11-15: every AI-made
// choice, dropped field or operator change is reviewable at cutover). It never changes the run status.
function planChoiceActions(plan) {
  const shown = v => typeof v === 'string' ? JSON.stringify(v) : canonical(v);
  const severity = c => c.decidedBy === 'ai' && canonical(c.value) !== canonical(c.default) ? 'medium' : 'low';
  const entityActions = row => (Array.isArray(row?.choices) ? row.choices : []).filter(c => !choiceErrors(c).length).map(c => {
    const ref = entityRef(row);
    return {
      code: 'mapping-entity-choice-recorded', severity: severity(c), actionId: `mapping-choice:${ref}:entity:${c.name}`, role: 'cutover-operator', entity: ref,
      affectedCount: Number.isSafeInteger(row.sourceRecordCount) ? row.sourceRecordCount : null, affectedIds: [], artifactRefs: ['mapping/mapping-plan.json'], prerequisites: [],
      resolutionEvidence: `The ${c.name} choice for the ${ref} entity is recorded in mapping/mapping-plan.json.`,
      deadlineReason: 'Review before launch; the import already follows this choice.',
      action: `Requires Cutover Operator. ${ref} (whole entity): ${c.name} = ${shown(c.value)} (default ${shown(c.default)}), decided by ${c.decidedBy}: ${c.reason} Keep it, or ask the Import Operator to change it in the plan and re-run ${ref}.`,
    };
  });
  // A record rule has no action here: the runner journals each record it skips (skipped-by-plan)
  // and the completion report raises one measured site-owner action per task. A rule that skips
  // nothing needs no one's attention.
  return entityRows(plan).flatMap(row => [...entityActions(row), ...(row?.fieldMappings || []).filter(d => d?.choice && !choiceErrors(d.choice).length).map(d => {
    const ref = entityRef(row), c = d.choice, dropped = d.disposition === 'excluded';
    let count = null; try { const s = d.affectedScope ? affectedScope(d.affectedScope, row.discoveryCoverage) : null; count = s?.countStatus === 'known' ? s.count : null; } catch { /* unknown */ }
    return {
      code: dropped ? 'mapping-field-dropped-by-choice' : 'mapping-choice-recorded',
      severity: severity(c),
      actionId: `mapping-choice:${ref}:${d.id}`,
      role: 'cutover-operator',
      entity: ref,
      affectedCount: count,
      affectedIds: [],
      artifactRefs: ['mapping/mapping-plan.json'],
      prerequisites: [],
      resolutionEvidence: `The ${c.name} choice on ${ref} (decision ${d.id}) is recorded in mapping/mapping-plan.json.`,
      deadlineReason: 'Review before launch; the import already follows this choice.',
      action: `Requires Cutover Operator. ${ref}: ${c.name} = ${shown(c.value)} (default ${shown(c.default)}), decided by ${c.decidedBy}: ${c.reason}${dropped ? ` The source field${d.sourcePaths.length === 1 ? '' : 's'} ${d.sourcePaths.join(', ')} ${d.sourcePaths.length === 1 ? 'was' : 'were'} not imported.` : ''} Keep it, or ask the Import Operator to change it in the plan and re-run ${ref}.`,
    };
  })]);
}
function validateEntity(row) {
  if (!row || typeof row!=='object' || Array.isArray(row)) return ['entity must be an object'];
  const errors = [], ref = entityRef(row), ids = new Set(), writes = new Map();
  const error = m => errors.push(`${ref}: ${m}`);
  // Entity-level choices (for example a deferred entity's default and reason), any row status.
  if (row.choices !== undefined) {
    if (!Array.isArray(row.choices)) error('choices must be an array');
    else {
      const names = new Set();
      for (const c of row.choices) {
        for (const m of choiceErrors(c)) error(`entity choice: ${m}`);
        if (c?.name && names.has(c.name)) error(`entity choice ${c.name} is duplicated`); names.add(c?.name);
      }
    }
  }
  if (row.fieldMappingStatus==='pending') {
    if (!ref || !Array.isArray(row.fieldMappings) || row.fieldMappings.length || !Array.isArray(row.discoveryCoverage?.paths) || row.discoveryCoverage.paths.length || !row.discoveryCoverage?.uninspectedAreas?.length || !Array.isArray(row.requiredSourceEntityRefs)) error('pending field inventory needs explicit empty decisions/paths and disclosed uninspected scope');
    for (const m of setAsideErrors(row)) error(m);
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
  if (row.recordRule !== undefined) for (const m of recordRuleErrors(row)) error(m);
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
    if (d.choice!==undefined) for (const m of choiceErrors(d.choice)) error(`${d.id}: ${m}`);
    if (!Array.isArray(d.evidence) || !d.evidence.length) error(`${d.id}: missing evidence`);
    if (!d.reason) error(`${d.id}: missing reason`);
    if (d.disposition === 'deferred-field') {
      for (const m of require('./mapping-recovery').shape(row, d)) error(`${d.id}: ${m}`);
      if (!d.sourcePaths.length || d.outputs?.length || d.omittedOutputs?.length) error(`${d.id}: deferred fields retain source paths and cannot emit or exclude outputs`);
      continue;
    }
    if (d.omittedOutputs !== undefined && (!Array.isArray(d.omittedOutputs) || d.disposition!=='excluded' || d.omittedOutputs.some(o=>!o || !o.writeOperation || !optionalPath(o.writeInput) || !exactPath(o.targetPath)))) error(`${d.id}: invalid omitted intended output binding`);
    // Any gate-filled reference (target knowledge dependencyReferenceFields) dropped by a recorded
    // choice must be the operator's: the one-click AI or a suggestion never drops a link.
    else if (Array.isArray(d.omittedOutputs) && d.choice && d.choice.decidedBy !== 'operator') for (const o of d.omittedOutputs) {
      const refs = require('./dependency-readiness').gateSuppliedReferences([row.targetRef], WriterShape.recordPath({ targetRef: row.targetRef, writeOperation: o.writeOperation, writeInput: o.writeInput, targetPath: o.targetPath })).filter(x => x.kind === 'dependency');
      for (const x of refs) error(`${d.id}: mapping-reference-drop-needs-operator: ${o.targetPath} is the ${x.ref} link; only the operator can drop it (choice.decidedBy ${d.choice.decidedBy})`);
    }
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
    for (const m of transformErrors(d.transform, d.sourcePaths)) error(`${d.id}: ${m}`);
    // A value Wix refuses whatever the request (target knowledge valueContracts), answered at mapping time.
    for (const m of require('./target-value-contracts').valueContractErrors(d)) error(m);
    for (const key of ['missing', 'null', 'empty', 'zero', 'invalid', 'unknown']) {
      if (!d.valuePolicy?.[key]?.action || typeof d.valuePolicy[key].action!=='string') error(`${d.id}: missing ${key} value policy action`);
    }
    // Synthetic examples are optional (design v2 D1): the after-codegen dry run samples real source
    // records from data/source-extract. When an entity has no real records, they are its fallback.
    if (d.examples!==undefined && (!Array.isArray(d.examples) || d.examples.some(e => !e || !e.id || !Object.hasOwn(e, 'input') || (!Array.isArray(e.expected) || !e.expected.length)))) error(`${d.id}: malformed synthetic example`);
    if (!Array.isArray(d.outputs) || !d.outputs.length) error(`${d.id}: precise outputs required`);
    const outputIds = new Set();
    for (const o of d.outputs || []) {
      if (!o || typeof o!=='object') {error(`${d.id}: malformed output`);continue;}
      if (!o.id || outputIds.has(o.id)) error(`${d.id}: missing/duplicate output ID`); outputIds.add(o.id);
      if (!o.targetRef || !o.writeOperation || !optionalPath(o.writeInput) || !exactPath(o.targetPath)) error(`${d.id}:${o.id}: incomplete operation/path binding`);
      // targetPath must be a field the reviewed writer sends (writer-request-shape.js).
      else for (const m of WriterShape.outputErrors(o)) error(`${d.id}:${o.id}: ${m}`);
      if (o.targetRef === 'crm/contact' && optionalPath(o.writeInput) && exactPath(o.targetPath)) {
        const addressError = contactAddressTargetPathError(WriterShape.writePath(o));
        if (addressError) error(`${d.id}:${o.id}: ${addressError}`);
      }
      if (!Array.isArray(o.sourcePaths) || o.sourcePaths.some(p => !d.sourcePaths?.includes(p))) error(`${d.id}:${o.id}: output inputs must be explicit subsets`);
      // Applicability is a closed predicate over the decision's own canonical locations (A.2.2).
      if (o.appliesWhen!==undefined) {
        let own=[]; try {own=decisionLocations(d);} catch {/* reported above */}
        for (const m of Applicability.validate(o.appliesWhen,own)) error(`${d.id}:${o.id}: ${m}`);
      }
      const key = canonical([o.targetRef, o.writeOperation, WriterShape.writePath(o)]);
      if (writes.has(key) && !d.transform?.precedence) error(`${d.id}: conflicting output with ${writes.get(key)} requires precedence`);
      writes.set(key, d.id);
      if (['extended-field', 'cms'].includes(d.disposition) && !o.storage) error(`${d.id}:${o.id}: custom definition/collection and linkage required`);
      if (d.disposition === 'cms' && o.storage) {
        if (!isWixCollectionId(o.storage.collectionId)) error(`${d.id}:${o.id}: CMS collectionId must contain only letters, numbers, _ or - and be 1-36 characters`);
        else if (ref && !archiveCollectionIdMatchesSource(o.storage.collectionId, ref)) error(`${d.id}:${o.id}: CMS archive collectionId must be derived from source entity ${ref}`);
      }
    }
    for (const e of d.examples || []) for (const expected of (Array.isArray(e?.expected)?e.expected:[])) {
      // A no-write is explained by the finding the transform reports; the example runner requires it.
      if (expected?.noWrite===true && !(Array.isArray(expected.findingCodes) && expected.findingCodes.length)) error(`${d.id}: a noWrite expectation names its findingCodes`);
      if (!expected || [Object.hasOwn(expected,'value'),Array.isArray(expected.values),expected.omitted===true,expected.noWrite===true].filter(Boolean).length!==1 || !(d.outputs || []).some(o=>o?.id===expected.outputId && o.writeOperation===expected.writeOperation)) error(`${d.id}: expectation has no output/operation binding`);
    }
    if (d.referencePolicy && (!d.referencePolicy.cardinality || !d.referencePolicy.order || !d.referencePolicy.entityRef || !d.referencePolicy.input || !d.referencePolicy.targetPath || !d.referencePolicy.missing || !d.referencePolicy.ambiguous || !d.referencePolicy.orphan)) error(`${d.id}: incomplete reference policy`);
  }
  if (errors.some(e=>e.includes('malformed'))) return errors;
  for (const m of unfedLeafErrors(row)) error(m);
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
// The write path, not the legacy writeInput: an output remapped without writeInput keeps its identity.
function binding(o) { return [o.targetRef, o.writeOperation, WriterShape.writePath(o)]; }
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
  const deferred = new Map(), skipped = new Map();
  for (const ref of selectedEntityRefs) {
    const row = byRef.get(ref);
    // The operator chose not to import this entity: excluded on purpose, not an unfinished mapping.
    const skip = operatorEntitySkip(row);
    if (skip) { skipped.set(ref, { entityRef: ref, choice: skip.name, reason: skip.reason }); continue; }
    const measuredHolds = (row.fieldMappings || []).filter(d=>plan.recoveryPolicyVersion===1 && scopedRecordHold(row,d));
    const heldIds = new Set(measuredHolds.flatMap(d=>d.affectedScope.sourceIds));
    if (Number.isSafeInteger(row.sourceRecordCount) && row.sourceRecordCount>0 && heldIds.size===row.sourceRecordCount) {
      deferred.set(ref,{entityRef:ref,decisionIds:measuredHolds.map(d=>d.id),blockedByEntityRefs:[],reason:'Every source record has a measured unresolved mapping hold; retain the source and cutover gaps.'});
      continue;
    }
    const undecided = (row.fieldMappings || []).filter(d=>pendingDecision(row,d) && !(plan.recoveryPolicyVersion===1 && scopedRecordHold(row,d)) && !(omissionReview && row.omissionReviewRequested === true && d.disposition === 'excluded'));
    if (row.fieldMappingStatus==='pending' || undecided.length || (provisionalEntityRefs && !provisionalEntityRefs.includes(ref))) {
      const aside = setAside(row);
      deferred.set(ref, { entityRef: ref, decisionIds: row.fieldMappingStatus==='pending' ? ['field-inventory'] : undecided.map(d => d.id), blockedByEntityRefs: [], reason: aside ? `Cannot be mapped (${aside.status}): ${aside.detail}` : row.fieldMappingStatus==='pending' ? 'Source field inventory must be inspected by mapper.' : undecided.length ? 'Unresolved mapping or populated omission awaiting the shared approval contract.' : 'Explicitly deferred by human provisional scope.', ...(aside ? { limitation: { status: aside.status, detail: aside.detail } } : {}) });
    }
  }
  let changed;
  do {
    changed = false;
    for (const ref of selectedEntityRefs) {
      if (deferred.has(ref) || skipped.has(ref)) continue;
      // A toolkit-derived entity (TOOLKIT_DERIVED_ENTITIES) is never a plan prerequisite: the contact
      // task derives it from the extract. Named but not a plan row, it blocks nothing.
      const deps = (byRef.get(ref).requiredSourceEntityRefs || []).filter(d => selectedEntityRefs.includes(d) || !TOOLKIT_DERIVED_ENTITIES.includes(d));
      const blockedByEntityRefs = deps.filter(d => !selectedEntityRefs.includes(d) || skipped.has(d) || deferred.has(d) && !dependencyIsPerRecord(byRef.get(ref), d, byRef));
      const absent = blockedByEntityRefs.filter(d => !selectedEntityRefs.includes(d)), skippedDeps = blockedByEntityRefs.filter(d => skipped.has(d));
      // Fail closed, but name a likely stale mapper-authored prerequisite before codegen/canary.
      const reason = skippedDeps.length ? `Required source prerequisite ${skippedDeps.join(', ')} is not imported by the operator's choice. Drop the link to it (an excluded decision with the operator's choice) and remove it from requiredSourceEntityRefs, or import it.` : absent.length ? `Required source prerequisite ${absent.join(', ')} is absent from the mapped scope. requiredSourceEntityRefs lists retained-write prerequisites only; if every use is an omission in this review, it is stale: remove it and re-run contract. Otherwise map it.` : `Required source prerequisite ${blockedByEntityRefs.join(', ')} is deferred.`;
      if (blockedByEntityRefs.length) { deferred.set(ref, { entityRef: ref, decisionIds: [], blockedByEntityRefs, reason }); changed = true; }
    }
  } while (changed);
  if (provisionalEntityRefs && provisionalEntityRefs.some(ref=>!selectedEntityRefs.includes(ref) || deferred.has(ref) || skipped.has(ref))) fail('human provisional subset contains unresolved/unauthorized/dependent work');
  if (deferred.size && mode !== 'one_click' && !provisionalEntityRefs && plan.recoveryPolicyVersion!==1) {
    for (const ref of selectedEntityRefs) if (!deferred.has(ref) && !skipped.has(ref)) deferred.set(ref,{entityRef:ref,decisionIds:[],blockedByEntityRefs:[],reason:'Awaiting the customer mapping checkpoint; no provisional subset was authorized.'});
  }
  return { selectedEntityRefs: [...selectedEntityRefs], resolvedEntityRefs: selectedEntityRefs.filter(r => !deferred.has(r) && !skipped.has(r)), deferredEntities: selectedEntityRefs.filter(r => deferred.has(r)).map(r => deferred.get(r)),
    ...(skipped.size ? { skippedEntities: selectedEntityRefs.filter(r => skipped.has(r)).map(r => skipped.get(r)) } : {}),
    // Resolution is calculated; a provisional subset is an explicit mapper input.
    ...(provisionalEntityRefs !== null ? {provisionalEntityRefs:[...provisionalEntityRefs]} : {}),
    ...(omissionReview && rows.some(r=>!deferred.has(entityRef(r)) && r.omissionReviewRequested && r.fieldMappings?.some(d=>pendingDecision(r,d))) ?
      {omissionApprovalRequiredEntityRefs:rows.filter(r=>!deferred.has(entityRef(r)) && r.omissionReviewRequested && r.fieldMappings?.some(d=>pendingDecision(r,d))).map(entityRef)} : {}) };
}
function assertExecutionScope(plan, ref, expectedDigest, projectDir=null) {
  if (typeof ref !== 'string' || !ref) fail(`scope assertion has no source entity ref (got ${ref === '' ? 'an empty string' : String(ref)}); the generated handler must pass its task's source entity ref`);
  if (plan.fieldContractVersion !== 1) fail('revised mapping must be explicitly reconciled by mapper');
  const safetyErrors=validatePlanSafety(plan);
  if (safetyErrors.length) fail(safetyErrors.join('; '));
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
    // The same rule as the import-time edge (dependency-proofs edgeMode). A mapped dependency is
    // produced by its own import task unless its target is setup configuration.
    const proofs = require('./dependency-proofs');
    // A pair with no target dependency has no edge to wait on; it stays fail-closed here.
    if (!(proofs.domain(row.targetRef).dependsOn || []).includes(dependency.targetRef)) return false;
    const setup = proofs.bundledDomain(dependency.targetRef).target?.classification === 'setup-config';
    return proofs.edgeMode([row.targetRef], dependency.targetRef, { kind: setup ? 'setup-step' : 'import-task' }) === 'per-record';
  } catch {
    return false;
  }
}
function deferredRunResult(plan) {
  if (!plan.executionScope?.deferredEntities?.length) return null;
  // Keep the completion/router gate on the same derived scope as the direct
  // handler guard. A forged resolved list must not turn a pending entity into
  // an apparently runnable mixed-scope plan.
  let scopeMatchesAuthority = false;
  try {
    const calculated = deriveExecutionScope(plan, { mode: 'one_click' });
    scopeMatchesAuthority = canonical(calculated.selectedEntityRefs) === canonical(plan.executionScope.selectedEntityRefs)
      && canonical(calculated.resolvedEntityRefs) === canonical(plan.executionScope.resolvedEntityRefs)
      && canonical(calculated.deferredEntities) === canonical(plan.executionScope.deferredEntities);
  } catch {
    scopeMatchesAuthority = false;
  }
  // A deferred scope is a cutover gap, not a run-wide stop, when another executable
  // entity remains. The generated importer registers only resolved entities; its
  // dependency-readiness gate then applies per-record edges to dependents. Keep the
  // typed blocked result for an all-deferred plan, where no importer can start.
  const runnable = scopeMatchesAuthority ? (plan.executionScope.resolvedEntityRefs || []).filter(ref => {
    const row = entityRows(plan).find(candidate => entityRef(candidate) === ref);
    return row && row.targetClassification !== 'manual-mapping';
  }) : [];
  if (runnable.length) return null;
  return { outcome: 'blocked', blocker: { type: 'mapping_scope_deferred', artifact: 'mapping/mapping-plan.json',
    deferredEntities: plan.executionScope.deferredEntities, requiredInput: 'Resolve these field decisions in the next mapping session.' } };
}
function deferredMappingActions(plan) {
  const rows = new Map(entityRows(plan || {}).map(row => [entityRef(row), row]));
  // A mapped row whose records are all left out may state its typed reason on the row itself.
  return (plan?.executionScope?.deferredEntities || []).map(d => d.limitation || !statedLimitation(rows.get(d.entityRef)) ? d : { ...d, limitation: statedLimitation(rows.get(d.entityRef)) }).map(deferred => deferred.limitation ? {
    code: 'mapping-scope-deferred',
    severity: 'high',
    actionId: `mapping-scope-deferred:${deferred.entityRef}`,
    role: deferred.limitation.status === 'source-read-failed' ? 'import-operator' : 'cutover-operator',
    entity: deferred.entityRef,
    ...(deferred.limitation.status === 'source-read-failed' ? { importOperatorPrompt: `Resolve source-read-failed for ${deferred.entityRef}: ${deferred.limitation.detail} Fix source access, run the full read again, map ${deferred.entityRef} with rp-mapper (native, extended field, then CMS), re-approve the mapping and resume only that entity.` } : {}),
    affectedCount: entityRows(plan).find(row => entityRef(row) === deferred.entityRef)?.sourceRecordCount ?? null,
    artifactRefs: ['mapping/mapping-plan.json', 'mapping/review/mapping-gaps.json'],
    prerequisites: deferred.limitation.status === 'source-read-failed' ? ['Original migration project and source access'] : ['Wix Business Manager'],
    resolutionEvidence: `The ${deferred.limitation.status} reason for ${deferred.entityRef} is recorded in mapping/mapping-plan.json and mapping/review/mapping-gaps.json.`,
    deadlineReason: deferred.limitation.status === 'missing-setup-step'
      ? 'Do this before switching the domain; until then the site does not have it.'
      : 'Resolve before launch; this in-use entity was not imported.',
    // missing-setup-step: the detail is the toolkit's exact Business Manager steps, so no generic advice is added.
    action: deferred.limitation.status === 'source-read-failed'
      ? `Requires Import Operator. ${deferred.entityRef} was not imported: ${deferred.limitation.detail} Fix source access in the original migration project, re-read it in full, map it with rp-mapper and resume only that entity.`
      : deferred.limitation.status === 'missing-setup-step'
        ? `${deferred.entityRef} was not imported: ${deferred.limitation.detail}`
        : `${deferred.entityRef} was not imported: ${deferred.limitation.detail} ${SET_ASIDE_REASONS[deferred.limitation.status]} Recreate what the site needs from it in Business Manager, or replace it with a Wix app.`,
  } : ({
    code: 'mapping-scope-deferred',
    severity: 'high',
    actionId: `mapping-scope-deferred:${deferred.entityRef}`,
    role: 'cutover-operator',
    entity: deferred.entityRef,
    affectedCount: Number.isSafeInteger(rows.get(deferred.entityRef)?.sourceRecordCount) ? rows.get(deferred.entityRef).sourceRecordCount : null,
    artifactRefs: ['mapping/mapping-plan.json', 'mapping/review/mapping-gaps.json'],
    prerequisites: ['Original migration project and current mapping artifacts'],
    resolutionEvidence: `The deferred scope for ${deferred.entityRef} remains recorded in mapping/mapping-plan.json and mapping/review/mapping-gaps.json until a later mapping decision replaces it.`,
    deadlineReason: 'Resolve before launch; this mapped entity remains outside the executable import scope.',
    action: `Requires Import Operator. ${deferred.entityRef}: ${Number.isSafeInteger(rows.get(deferred.entityRef)?.sourceRecordCount) ? `${rows.get(deferred.entityRef).sourceRecordCount} ` : ''}records not imported. Reason: ${deferred.reason || 'deferred by the mapping'} Resolve the deferred mapping for ${deferred.entityRef} in the original migration project, regenerate and re-approve the exact mapping, then resume only that entity. Independent entities continue importing; do not invent source data or resend landed records.`,
  }));
}
function currentFieldGapRows(plan) {
  return entityRows(plan).flatMap(gapRows).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
function activeMappingGapLedgerRows(ledger, plan) {
  const rows = Array.isArray(ledger) ? ledger : Array.isArray(ledger?.gaps) ? ledger.gaps : [];
  const currentIds = new Set(currentFieldGapRows(plan).map(row => row.id));
  return rows.filter(row => row?.gapType === 'field-mapping' && currentIds.has(row.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
function mappingGapLedgerDigest(ledger, plan) {
  return digest(activeMappingGapLedgerRows(ledger, plan));
}
function mappingGapCutoverActions(ledger, plan, { expectedLedgerDigest = null } = {}) {
  const rows = Array.isArray(ledger) ? ledger : Array.isArray(ledger?.gaps) ? ledger.gaps : [];
  if (expectedLedgerDigest && mappingGapLedgerDigest(ledger, plan) !== expectedLedgerDigest) return [];
  const currentFieldGaps = currentFieldGapRows(plan);
  const currentFieldIds = new Set(currentFieldGaps.map(row => row.id));
  const activeEntityRefs = new Set(entityRows(plan).map(entityRef).filter(Boolean));
  const activeCensusIds = new Set([
    ...(Array.isArray(plan?.censusIds) ? plan.censusIds : []),
    ...entityRows(plan).flatMap(row => Array.isArray(row.censusIds) ? row.censusIds : []),
    ...[...activeEntityRefs].map(ref => `entity:${ref}`),
  ]);
  // Retained ledgers are historical append-only evidence. Only field rows still
  // represented by the current plan, and census rows still bound to a current
  // plan census ID/entity, may produce a Cutover action.
  const activeRows = rows.filter(row => row?.gapType === 'field-mapping'
    ? currentFieldIds.has(row.id)
    : Boolean((row?.censusId && activeCensusIds.has(row.censusId))
      || (row?.entityName && activeEntityRefs.has(row.entityName))
      || (row?.sourceEntity && activeEntityRefs.has(row.sourceEntity))));
  const deferredRefs = new Set((plan?.executionScope?.deferredEntities || []).map(row => row.entityRef));
  return activeRows.filter(row => {
    const ref = row.entityName || row.sourceEntity || row.censusId;
    if (!ref || row.disposition === 'excluded' || row.disposition === 'manual') return false;
    if (row.gapType === 'field-mapping') return !deferredRefs.has(ref);
    return row.disposition === 'pending' || row.disposition === 'no-data';
  }).map(row => {
    const entity = row.entityName || row.sourceEntity || row.censusId;
    const pending = row.disposition === 'pending' || row.gapKind === 'unresolved';
    return {
      code: 'mapping-gap-cutover',
      severity: pending ? 'high' : 'low',
      actionId: `mapping-gap:${row.censusId || row.id || entity}`,
      role: 'cutover-operator',
      entity,
      affectedCount: Number.isSafeInteger(row.count) ? row.count : null,
      artifactRefs: ['mapping/review/mapping-gaps.json', 'mapping/mapping-plan.json'],
      prerequisites: ['Current mapping review ledger'],
      resolutionEvidence: `The ${pending ? 'pending' : 'no-data'} census row for ${entity} remains in mapping/review/mapping-gaps.json; it is not an execution-manifest task.`,
      deadlineReason: pending ? 'Resolve or explicitly retain before launch; this entity has no executable import task.' : 'Retain the no-data evidence through cutover; no import task is required.',
      action: pending
        ? `Requires Cutover Operator. Review ${entity} using mapping/review/mapping-gaps.json, then either resolve its mapping in a later run or retain the source as a documented cutover item. Do not invent source data or block independent imports.`
        : `Requires Cutover Operator. Retain ${entity} as a documented no-data/reference item using mapping/review/mapping-gaps.json; do not create an import task.`,
    };
  });
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
    const key=canonical([o.writeOperation,WriterShape.writePath(o)]);
    const group=intended.get(key) || {decisions:[],item:{kind:'intended',path:WriterShape.writePath(o),writeOperation:o.writeOperation,
      status:'mapped',decisionRefs:[],mappingRefs:[],reason:d.reason}};
    group.decisions.push(d);group.item.decisionRefs.push(d.id);group.item.mappingRefs.push(`${d.id}:${o.id}`);intended.set(key,group);
  }
  for (const d of row.fieldMappings) if (d.disposition==='excluded') for (const omitted of d.omittedOutputs || []) {
    const o={targetRef:row.targetRef,...omitted};
    const key=canonical([o.writeOperation,WriterShape.writePath(o)]);
    if (intended.has(key)) fail('omitted intended output conflicts with a written output');
    intended.set(key,{decisions:[d],item:{kind:'intended',path:WriterShape.writePath(o),writeOperation:o.writeOperation,
      status:row.omissionReviewRequested || deliberateDrop(d) ? 'notMigrated':'pending',decisionRefs:[d.id],mappingRefs:[],reason:d.reason}});
  }
  const intendedRows=[...intended.values()].map(({decisions,item})=>({...item,affectedScope:contributingScope(row,decisions,`intended ${item.writeOperation}:${item.path}`)}));
  for (const d of row.fieldMappings.filter(d => d.disposition === 'deferred-field')) for (const p of d.recovery.createWithoutField.paths) {
    const c = d.recovery.createWithoutField, full = WriterShape.writePath({targetRef:c.targetRef, writeOperation:c.operation, writeInput:c.writeInput, targetPath:p});
    if (intendedRows.some(r => r.path === full)) fail('deferred intended output conflicts with a written output');
    intendedRows.push({kind:'intended', path:full, writeOperation:c.operation, status:'deferred', decisionRefs:[d.id], mappingRefs:[], reason:d.reason, affectedScope:affectedScope(d.affectedScope,row.discoveryCoverage)});
  }
  const verificationMappings = row.fieldMappings.flatMap(d => (d.outputs || []).map(o => ({
    canonicalField: `${d.id}:${o.id}`, decisionRef: d.id,
    sourcePaths: outputLocations(d,o), ...(d.selectors ? {selectors:d.selectors} : {}),
    targetRef:o.targetRef, writeOperation:o.writeOperation, writeInput:o.writeInput,
    writePath:WriterShape.writePath(o),
    ...(o.appliesWhen!==undefined ? {appliesWhen:o.appliesWhen} : {}),
    ...Object.fromEntries(['readPath','unverifiableReason','comparatorId','provenance'].filter(key=>o.verification?.[key] !== undefined).map(key=>[key,o.verification[key]]))
  })));
  return { ...row, verificationMappings, fieldDispositions: [...dispositions,...intendedRows.sort((a,b)=>canonical(a).localeCompare(canonical(b)))] };
}
function gapRows(row) {
  const ref = entityRef(row), gaps = [];
  const aside=setAside(row);
  const decisions=row.fieldMappingStatus==='pending' ? [aside ? {id:'field-inventory',sourcePaths:[],disposition:'unresolved',reason:`Cannot be mapped (${aside.status}): ${aside.detail}`,evidence:row.discoveryCoverage.evidence,limitation:{status:aside.status,detail:aside.detail},nextAction:{role:aside.status==='source-read-failed'?'Import Operator':'Cutover Operator',cta:SET_ASIDE_REASONS[aside.status]}} : {id:'field-inventory',sourcePaths:[],disposition:'unresolved',reason:'Source field inventory requires explicit mapper decisions.',evidence:row.discoveryCoverage.evidence,nextAction:{role:'Import Operator',cta:'Inspect the source inventory and resolve exact field mappings.'}}] : row.fieldMappings || [];
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
  if (['missing-writer','missing-setup-step'].includes(gap.limitation.status)) add('skill_coverage_gap','path_not_covered');
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
  return ['## Exact field mappings','', '| Entity | Decision | Source paths | Outcome | Operation / write path |', '| --- | --- | --- | --- | --- |',
    ...rows.flatMap(r=>(r.fieldMappings || []).map(d=>`| ${safe(entityRef(r))} | ${safe(d.id)} | ${safe(decisionLocations(d).map(L.readable).join(', '))} | ${d.disposition} | ${safe([...(d.outputs||[]).map(o=>`${o.writeOperation} / ${WriterShape.writePath(o)}${o.appliesWhen ? ` when ${Applicability.readable(o.appliesWhen)}` : ''}`),...(d.omittedOutputs||[]).map(o=>`omit ${o.writeOperation} / ${WriterShape.writePath({targetRef:r.targetRef,...o})}`)].join('; '))} |`)),
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
  const errors=[...validatePlanSafety(plan)];
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
  const derived=require('./refresh-derived'), derivedBefore=derived.snapshot(projectDir);
  const approval=readOptional(path.join(projectDir,'orchestration/approvals.json'),{}).mapping;
  if (['approved','provisional'].includes(approval?.status)) fail('reopen the existing mapping checkpoint before replacing authority');
  if (next.fieldContractVersion !== 1) fail('new/revised plan must declare fieldContractVersion:1; legacy decisions are not upgraded automatically');
  const safetyErrors=validatePlanSafety(next);
  if (safetyErrors.length) fail(safetyErrors.join('; '));
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
  // Bind to the plugin coverage here (what `cms-fallback.js stamp-plan --plan mapping` does), so
  // the resolution and every pin below are computed from the plan as finally written.
  let cmsFallbackDigest=null; try { cmsFallbackDigest=readOptional(path.join(projectDir,'discovery/plugin-coverage.json'),null)?.inputs?.cmsFallbackDigest; } catch {}
  if (typeof cmsFallbackDigest==='string') plan.inputs={...(plan.inputs || {}),cmsFallbackDigest};
  const gapFile=path.join(projectDir,'mapping/review/mapping-gaps.json'), existing=readOptional(gapFile,[]);
  const previousGaps=Array.isArray(existing)?existing:existing.gaps || [], byId=new Map(previousGaps.filter(g=>g.id).map(g=>[g.id,g]));
  const activeIds=new Set(projected.flatMap(gapRows).map(g=>g.id));
  for (const row of projected) for (const gap of gapRows(row)) {
    gap.supersedes=[...new Set([...gap.supersedes,...previousGaps.filter(p=>p.gapType==='field-mapping' && p.sourceEntity===gap.sourceEntity && p.decisionId===gap.decisionId && p.gapKind!==gap.gapKind && !activeIds.has(p.id)).map(p=>p.id)])].sort();
    const prior=byId.get(gap.id); if (prior && prior.preservationStatus !== 'planned' && canonical(prior.storage) === canonical(gap.storage) && canonical(prior.affectedScope) === canonical(gap.affectedScope)) { gap.preservationStatus=prior.preservationStatus; gap.resolutionEvidence=prior.resolutionEvidence; }
    byId.set(gap.id,gap);
  }
  const gaps=[...previousGaps.filter(g=>!g.id), ...byId.values()];
  const gapLedger = Array.isArray(existing) ? gaps : {...existing,gaps};
  // Pin the exact active projection that will be persisted in the retained ledger.
  // Completion hashes the same projection, including preserved resolution metadata,
  // so a legitimate rerun cannot reject itself while historical rows stay excluded.
  plan.mappingGapLedgerDigest = mappingGapLedgerDigest(gapLedger, plan);
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
  atomicJson(gapFile,gapLedger);
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
  let refresh;
  try { refresh=await derived.refreshDerived(projectDir,{before:derivedBefore,trigger:'mapping-authority'}); }
  catch(e) { refresh={ok:false,error:e.code || e.message}; }
  return { plan,gaps,telemetryFailures,refresh,blockedResult:mode==='one_click'?deferredRunResult(plan):null };
}
module.exports={TOOLKIT_DERIVED_ENTITIES,TRANSFORM_KINDS,OPERATOR_TRANSFORM_KINDS,CHOICE_DECIDERS,transformErrors,choiceErrors,planChoices,planChoiceActions,plannedDropRows,deliberateDrop,operatorEntitySkip,recordRuleErrors,keepsRecord,SET_ASIDE_REASONS,MAPPING_COMPLETION_PASSES,COMPLETENESS_FILE,setAsideErrors,unmappedEntities,outOfScopeEntities,statedLimitation,mappingCompleteness,assertMappingComplete,recordMappingHandBack,clearMappingPasses,measuredZeroExclusion,mandatoryExclusion,carriedToCutoverExclusion,CARRIED_POLICY,pendingDecision,mappingRunMode,GAP_KEYS,canonical,digest,entityRef,entityKeyMatches,entityFileName,entityRows,entityDecisionFileName,splitReadBackKey,readBackKeys,readBackRow,readBackKeyFor,validateEntity,validatePlanSafety,affectedScope,assertRemapIdentity,dependencyIsPerRecord,
  deriveExecutionScope,assertExecutionScope,deferredRunResult,deferredMappingActions,currentFieldGapRows,activeMappingGapLedgerRows,mappingGapLedgerDigest,mappingGapCutoverActions,mappingReviewFallback,persistMappingReviewFallback,projectEntity,gapRows,telemetryForGap,compareMappingProjections,writeMappingAuthority,
  exactPath,decisionLocations,outputLocations,coverageLocations};
