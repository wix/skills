'use strict';

// Target knowledge that makes an executable mapping row unapprovable: an IMPORT_UNRELIABLE entity
// without its mapping-gaps acknowledgement. Census reconciliation reports these.
const crypto = require('node:crypto');
const proofs = require('./dependency-proofs');
const refPattern = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function deferredRefs(plan) {
  const scope = plan?.executionScope || {};
  // A checkpoint placeholder (no decisions, no blockers, no human subset) still becomes executable on approval.
  return new Set((scope.deferredEntities || []).filter(d => d?.decisionIds?.length || d?.blockedByEntityRefs?.length || Array.isArray(scope.provisionalEntityRefs)).map(d => d.entityRef));
}
function knowledge(ref) { try { return refPattern.test(ref) ? proofs.domain(ref) : null; } catch { return null; } }
// Each executable row's target writes as [targetRef, operation|null]: the row target with its preferred
// writer (or the knowledge default), plus every written output's own targetRef/writeOperation.
function executableTargets(plan) {
  const deferred = deferredRefs(plan), out = [];
  const selected = Array.isArray(plan?.executionScope?.selectedEntityRefs) ? new Set(plan.executionScope.selectedEntityRefs) : null;
  require('./website-handoff').readEntityMappings(plan).forEach((row, index) => {
    if (!row || row.targetClassification === 'manual-mapping' || ['excluded', 'rejected', 'deferred'].includes(row.status)) return;
    const ref = row.sourceEntityRef || row.sourceEntity || row.entityName || row.entity || row.entityKey;
    if (deferred.has(ref) || selected && !selected.has(ref)) return;
    const own = row.targetRef || (row.targetDomain && row.targetEntity ? `${row.targetDomain}/${row.targetEntity}` : null);
    const writes = [];
    if (own) writes.push([own, row.preferredWrite?.writerId || row.writeOperation || knowledge(own)?.preferredWrite?.writerId || null]);
    for (const d of row.fieldMappings || []) if (!['excluded', 'unresolved'].includes(d?.disposition)) for (const o of d?.outputs || []) if (o?.targetRef) writes.push([o.targetRef, o.writeOperation || null]);
    for (const [targetRef, operation] of writes) if (!out.some(t => t.planRow === index && t.targetRef === targetRef && t.operation === operation)) out.push({ planRow: index, entityRef: ref, targetRef, operation, rowTargetRef: own });
  });
  return out;
}
// Bind the rules, not just their current result. Includes targets with no rule yet, so an
// added restriction or reliability flag invalidates an old approval. Prose is not semantic.
function supportKnowledgeDigest(plan) {
  const targets = [...new Set(executableTargets(plan).map(t => t.targetRef))].sort();
  const semantic = targets.map(targetRef => {
    const k = knowledge(targetRef);
    return { targetRef, knowledge: k ? {
      importUnreliable: (k.reliability?.flags || []).includes('IMPORT_UNRELIABLE'),
      defaultWriter: k.preferredWrite?.writerId || null,
      importSafe: k.preferredWrite?.importSafe ?? null,
      alternates: (k.alternateWrites || []).filter(a => typeof a?.writerId === 'string')
        .map(a => ({ writerId: a.writerId, importSafe: a.importSafe ?? null, verification: a.verification ?? null }))
        .sort((a, b) => a.writerId.localeCompare(b.writerId)),
      operations: Object.fromEntries(Object.entries(k.operationContracts || {}).map(([name, contract]) => [name, {
        // unsupportedWhen is always null since safe mode was removed; kept so approvals made
        // before that change stay fresh for plans with no member write.
        aliases: [...(contract.aliases || [])].sort(), unsupportedWhen: null
      }]))
    } : null };
  });
  return crypto.createHash('sha256').update(proofs.canonical(semantic)).digest('hex');
}

function validAcknowledgement(gap) {
  return gap && !Array.isArray(gap) && [gap.gapType, gap.code].includes('IMPORT_UNRELIABLE') &&
    typeof gap.targetRef === 'string' && refPattern.test(gap.targetRef) && nonempty(gap.summary) &&
    [gap.fallback, gap.action, gap.reviewAction].some(nonempty);
}

// A native entity is written through a reviewed rp-target-wix writer for THAT entity: its
// default writer, a name, alias or auxiliary operation in its operation contracts (the set the
// dependency proofs accept), a function whose request mark names it (WRITE_BUILDERS_BY_ENTITY),
// or a reviewed helper listed for it (WRITE_HELPERS_BY_ENTITY).
// Another entity's writer is not one (the client refuses it), and neither is the direct-REST
// helper, whose unmarked requests the client refuses.
// A native entity with NO reviewed writer is written by guarded raw requests; the
// client checks each one. A reviewed writer always wins: an entity that has one cannot use them.
const DIRECT_REST_HELPERS = new Set(['sendDirectRest', 'buildDirectRestRequest', 'notifyMissingWriter']);
const RAW_REQUEST_OPERATIONS = new Set(['sendGuardedRawRequest', 'buildGuardedRawRequest']);
const writers = () => require('../resources/rp-target-wix/lib/wix-writers.js');
// The blog author helper lives beside the writers; a member contract names it.
const writerFunction = operation => typeof writers()[operation] === 'function' ||
  typeof require('../resources/rp-target-wix/lib/blog-author-attribution.js')[operation] === 'function';
function entityWriter(ref, k, operation) {
  if (!operation || DIRECT_REST_HELPERS.has(operation) || RAW_REQUEST_OPERATIONS.has(operation) || !writerFunction(operation)) return false;
  return operation === k.preferredWrite?.writerId || Boolean(proofs.operationContract(ref, operation)) ||
    Object.values(k.operationContracts || {}).some(contract => (contract.auxiliaryOperations || []).includes(operation)) ||
    (writers().WRITE_BUILDERS_BY_ENTITY[ref] || []).includes(operation) || (writers().WRITE_HELPERS_BY_ENTITY[ref] || []).includes(operation);
}
// The raw path also serves native-plus-cms entities (a native record plus CMS fields) with no writer.
const rawEligible = k => ['native', 'native-plus-cms'].includes(k.target?.classification) && !k.childOf;
function reviewedWriterExists(ref, k) { return entityWriter(ref, k, k.preferredWrite?.writerId) || Boolean((writers().WRITE_BUILDERS_BY_ENTITY[ref] || []).length); }
// A reviewed writer can cover only some records of its entity (preferredWrite.writerScope, e.g.
// item SEO for BLOG_POST only); the rest of that entity keeps the raw path. Never blocks.
const writerScope = k => k.preferredWrite?.writerScope && Array.isArray(k.preferredWrite.writerScope.covers) ? k.preferredWrite.writerScope : null;
// True when `ref` may be written by guarded raw requests: a native or native-plus-cms entity with no reviewed writer,
// or one whose reviewed writer is scoped (the request is then checked by rawScopeRefusal).
function rawRequestEntity(ref) { const k = knowledge(ref); return Boolean(k) && rawEligible(k) && (!reviewedWriterExists(ref, k) || Boolean(writerScope(k))); }
// For a scoped entity: null when this raw request is outside what the reviewed writer covers,
// otherwise the refusal reason. The scope value is read from both the body and the URL segment
// after `pathAfter`; a covered or refused value in either, a disagreement, or no readable value is
// refused. Tags named by `refusedTags` (identities from seo-tags.js) are refused in the body.
const SCOPE_VALUE = /^[A-Z][A-Z0-9_]*(?:-[A-Za-z0-9-]+)?$/;
function valuesAt(value, dotted) {
  return dotted.split('.').reduce((values, key) => values.flatMap(v => {
    const list = key.endsWith('[]'), next = v && typeof v === 'object' ? v[list ? key.slice(0, -2) : key] : undefined;
    return list ? (Array.isArray(next) ? next : []) : next === undefined ? [] : [next];
  }), [value]);
}
function rawScopeRefusal(ref, { url, body } = {}) {
  const k = knowledge(ref), scope = k && writerScope(k);
  if (!scope || !reviewedWriterExists(ref, k)) return null;
  const fromBody = scope.bodyPath && body && typeof body === 'object' ? body[scope.bodyPath] : undefined;
  let fromUrl;
  if (scope.pathAfter) {
    try { const segments = new URL(url).pathname.split('/'); const at = segments.indexOf(scope.pathAfter); if (at >= 0) fromUrl = segments[at + 1]; } catch { /* refused below */ }
  }
  const blocked = [...scope.covers.map(v => [v, 'reviewed-writer-covers']), ...(scope.rawRefused || []).map(v => [v, 'scope-refused'])];
  // Compared without case so a gateway that folds case cannot reach a covered type.
  for (const value of [fromBody, fromUrl]) {
    const hit = typeof value === 'string' && blocked.find(([name]) => name.toUpperCase() === value.toUpperCase());
    if (hit) return `${hit[1]}:${hit[0]}`;
  }
  // Scope values are upper-case enum names (BLOG_POST, STATIC_PAGE, WIX_DATA_PAGE_ITEM-{pageId}): a path word such as `set` is not one.
  const urlValue = typeof fromUrl === 'string' && SCOPE_VALUE.test(fromUrl) ? fromUrl : undefined;
  if (fromBody !== undefined && (typeof fromBody !== 'string' || !SCOPE_VALUE.test(fromBody))) return `scope-unknown:${scope.field}`;
  if (fromBody !== undefined && urlValue !== undefined && fromBody !== urlValue) return `scope-mismatch:${scope.field}`;
  if (fromBody === undefined && urlValue === undefined) return `scope-unknown:${scope.field}`;
  if (scope.refusedTags) {
    const { tagIdentity } = require('../resources/rp-target-wix/lib/seo-tags.js');
    const tags = scope.refusedTags.paths.flatMap(dotted => valuesAt(body, dotted)).flatMap(v => Array.isArray(v) ? v : []);
    const refused = tags.map(tag => { try { return tagIdentity(tag); } catch { return null; } }).find(id => scope.refusedTags.identities.includes(id));
    if (refused) return `tag-refused:${refused}`;
  }
  return null;
}
// True when `ref` has a reviewed writer of its own (the raw path is then refused).
function hasReviewedWriter(ref) { const k = knowledge(ref); return Boolean(k) && reviewedWriterExists(ref, k); }
// A writer the entity declares in `alternateWrites` counts only when it is an exported toolkit
// writer, import-safe and verified live, and the entity itself is not import-unsafe. `declared`
// is false when the operation is not one of this entity's alternates.
// An alternate's marked builder (`build<WriterId>Request`, listed for this entity) is the same
// alternate: naming the builder instead of the executor does not get around the rule.
const builderOf = writerId => `build${writerId.charAt(0).toUpperCase()}${writerId.slice(1)}Request`;
function alternateWriter(ref, k, operation) {
  const declared = (k.alternateWrites || []).find(a => a && typeof a.writerId === 'string' && (a.writerId === operation ||
    (builderOf(a.writerId) === operation && (writers().WRITE_BUILDERS_BY_ENTITY[ref] || []).includes(operation))));
  const refused = reason => ({ declared: true, ok: false, reason });
  if (!declared) return { declared: false, ok: false, reason: 'alternate-not-declared' };
  if (DIRECT_REST_HELPERS.has(operation) || RAW_REQUEST_OPERATIONS.has(operation)) return refused('alternate-helper-name');
  if (typeof writers()[operation] !== 'function') return refused('alternate-not-exported');
  if (otherEntityWriter(ref, operation)) return refused('alternate-other-entity');
  if (k.preferredWrite?.importSafe === false) return refused('entity-import-unsafe');
  if (declared.importSafe !== true) return refused('alternate-import-unsafe');
  if (declared.verification !== 'verified-live') return refused('alternate-unverified');
  return { declared: true, ok: true, reason: null };
}
// True when `operation` is another entity's default writer or marked builder: the client would
// refuse it for `ref` (DEPENDENCY_TASK_MISMATCH), so no alternate may name it.
function otherEntityWriter(ref, operation) {
  if (Object.entries(writers().WRITE_BUILDERS_BY_ENTITY).some(([other, names]) => other !== ref && names.includes(operation))) return true;
  const index = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../resources/rp-target-wix/domains/index.json'), 'utf8'));
  return Object.entries(index.domains || {}).some(([domain, row]) => Object.keys(row.entities || {}).some(entity => {
    const other = `${domain}/${entity}`;
    return other !== ref && knowledge(other)?.preferredWrite?.writerId === operation;
  }));
}
// Why `operation` is refused as a writer for `ref`, or null: the alternate's own reason and the
// default writer to use instead, for the gate message and the mapper.
function writerRefusal(ref, operation) {
  const k = knowledge(ref);
  if (!k || !operation || !writerMissing(ref, k, operation)) return null;
  const alternate = alternateWriter(ref, k, operation);
  const instead = k.preferredWrite?.writerId || (writers().WRITE_BUILDERS_BY_ENTITY[ref] || [])[0] || (rawRequestEntity(ref) ? 'sendGuardedRawRequest' : null);
  return { reason: alternate.declared ? alternate.reason : 'not-a-writer', instead };
}
// With no named operation, a writer-less native entity uses the raw path. A named operation must
// be the entity's own writer, or the raw path when the entity has no reviewed writer.
// The raw path is refused for any entity that is not a writer-less native or native-plus-cms
// entity (the client refuses it too). A named operation on either must be its own writer.
function writerMissing(ref, k, operation) {
  if (RAW_REQUEST_OPERATIONS.has(operation)) return !rawEligible(k) || (reviewedWriterExists(ref, k) && !writerScope(k));
  // A declared alternate is decided by its own rule, for native and native-plus-cms entities.
  if (operation && rawEligible(k)) { const alternate = alternateWriter(ref, k, operation); if (alternate.declared) return !alternate.ok; }
  if (!rawEligible(k)) return false;
  if (operation) return !entityWriter(ref, k, operation);
  return false;
}
function hasEntityWriter(ref, operation = null) { const k = knowledge(ref); return Boolean(k) && !writerMissing(ref, k, operation); }
function supportErrors({ plan, gaps = [] }) {
  const errors = [], acknowledged = new Set(gaps.filter(validAcknowledgement).map(g => g.targetRef));
  for (const t of executableTargets(plan)) {
    const k = knowledge(t.targetRef);
    if (!k) continue;
    const at = { planRow: `mapping-plan#${t.planRow}`, entityRef: t.entityRef, targetRef: t.targetRef };
    if ((k.reliability?.flags || []).includes('IMPORT_UNRELIABLE') && !acknowledged.has(t.targetRef) && !errors.some(e => e.code === 'import_unreliable_unacknowledged' && e.planRow === at.planRow && e.targetRef === t.targetRef)) errors.push({ code: 'import_unreliable_unacknowledged', ...at });
  }
  errors.push(...parentTaskErrors(plan));
  return errors;
}
// An entity written inside another entity's import task (knowledge `writtenInTaskOf`: an order's
// payment, refund and invoice are sent as ecom/order requests). Its own row would become its own
// task, pass every static gate, and have every write refused at send (DEPENDENCY_TASK_MISMATCH).
// It is mapped as outputs of the host's row instead, and the host's task writes it.
function writtenInTaskOf(ref) { const host = knowledge(ref)?.writtenInTaskOf; return typeof host === 'string' && refPattern.test(host) ? host : null; }
const parentTaskNext = (ref, host) => `Map ${ref} into the ${host} row (as outputs of that row), not as its own row: the ${host} import task writes it with the ${host} grant.`;
function parentTaskErrors(plan) {
  const errors = [];
  for (const t of executableTargets(plan)) {
    const host = writtenInTaskOf(t.targetRef);
    if (!host || t.rowTargetRef === host) continue;
    const at = { planRow: `mapping-plan#${t.planRow}`, entityRef: t.entityRef, targetRef: t.targetRef };
    if (!errors.some(e => e.planRow === at.planRow && e.targetRef === t.targetRef)) errors.push({ code: 'target_written_in_parent_task', ...at, parentRef: host, next: parentTaskNext(t.targetRef, host) });
  }
  return errors;
}
// An entity whose knowledge says importSafe === false (its writer has a side effect site
// mute cannot cover) is never imported. Returns the recorded reason, else null.
function knowledgeImportSafe(ref) { const v = knowledge(ref)?.preferredWrite?.importSafe; return typeof v === 'boolean' ? v : null; }
function importUnsafe(ref) {
  const pw = knowledge(ref)?.preferredWrite;
  if (pw?.importSafe !== false) return null;
  return { pitfall: pw.importSafeReason?.pitfall || null, summary: pw.importSafeReason?.summary || 'importSafe is false' };
}
// The pre-write gate: each import task's native entity needs a reviewed writer for that entity,
// and no import task may write an entity that is not import-safe.
function missingWriterErrors(manifest) {
  const errors = [];
  for (const task of (manifest?.tasks || []).filter(row => row.kind === 'import')) for (const ref of task.entityRefs || []) {
    const k = knowledge(ref);
    const operation = task.writeOperations?.[ref] || null;
    if (k && writerMissing(ref, k, operation)) {
      const alternate = alternateWriter(ref, k, operation), instead = k.preferredWrite?.writerId;
      errors.push(alternate.declared ? `MISSING_WRITER:${task.id}:${ref}:${alternate.reason}${instead ? `:use ${instead}` : ''}` : `MISSING_WRITER:${task.id}:${ref}`);
    }
    const unsafe = k && importUnsafe(ref);
    if (unsafe) errors.push(`IMPORT_UNSAFE:${task.id}:${ref}:${unsafe.pitfall || 'no-pitfall'}: ${unsafe.summary.replace(/;/g, ',')}`);
    const host = k && writtenInTaskOf(ref);
    if (host && !(task.entityRefs || []).includes(host)) errors.push(`PARENT_TASK_REQUIRED:${task.id}:${ref}:${host}: ${parentTaskNext(ref, host)}`);
  }
  return errors;
}
// Import-task entities written by guarded raw requests, for the plan shown before consent.
function rawRequestTargets(manifest) {
  const out = [];
  for (const task of (manifest?.tasks || []).filter(row => row.kind === 'import')) for (const ref of task.entityRefs || []) {
    const operation = task.writeOperations?.[ref] || null;
    if (rawRequestEntity(ref) && !importUnsafe(ref) && ((!operation && !hasReviewedWriter(ref)) || RAW_REQUEST_OPERATIONS.has(operation))) out.push({ taskId: task.id, entityRef: ref, writer: 'raw-request' });
  }
  return out;
}
module.exports = { executableTargets, supportErrors, missingWriterErrors, rawRequestTargets, rawRequestEntity, rawScopeRefusal, hasReviewedWriter, hasEntityWriter, writerRefusal, alternateWriter: (ref, operation) => { const k = knowledge(ref); return k ? alternateWriter(ref, k, operation) : null; }, importUnsafe, knowledgeImportSafe, supportKnowledgeDigest, RAW_REQUEST_OPERATIONS, writtenInTaskOf };
const assessments = require('./operation-assessments');
module.exports.supportErrors = options => options.projectDir ? assessments.withPlan(options.plan,options.projectDir,()=>supportErrors(options)) : supportErrors(options);
