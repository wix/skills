'use strict';

// Dependencies that need no separate producer.
//
// A target dependency is normally satisfied by a producer: an import task, setup steps, or an
// approved census disposition. Some are not produced separately at all: the related data is absent
// (`no-data`), the dependent write itself creates or resolves it (`within-write`), or the approved
// mapping writes none of its references (`not-referenced`). This module validates those proofs
// against the reviewed operation contract in target knowledge and resolves the whole dependency
// graph with one pure function, so the mapper (before approval), codegen (manifest) and the
// runtime gate apply the same rules. Bundled rules remain binding; mapper-authored, evidence-bound
// supplements can fill missing knowledge. Missing guards or evidence require investigation.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assessments = require('./operation-assessments');

const REASONS = new Set(['no-data', 'within-write', 'not-referenced']);
const ABSENCE_KINDS = new Set(['zero-row', 'zero-match', 'capability-absent']);
const PREDICATE_OPS = new Set(['equals', 'in', 'present', 'startsWith']);
// Producers whose dependent writes nothing through a transitive ref, or whose own task binds it.
const INHERITABLE = new Set(['import-task', 'disposition', 'no-producer', 'secondary-output', 'child-output', 'inherited']);
const refPattern = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const DOMAINS = path.join(__dirname, '../resources/rp-target-wix/domains');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
// The one loader for dependency knowledge, shared by the resolver and the runtime gate. Tests may
// point it at a fixture knowledge tree (the same idea as plugin-cms-fallback's targetKnowledgeRoot);
// the rules applied to whatever it loads never change.
let domainsRoot = DOMAINS;
function useTargetKnowledgeRoot(root) {
  const prior = domainsRoot;
  domainsRoot = root ? path.resolve(root) : DOMAINS;
  return () => { domainsRoot = prior; };
}
const MISSING = Object.freeze({ code: 'ENOENT' });
function bundledDomain(ref) {
  if (!refPattern.test(ref)) throw new Error(`entity_ref_unknown:${ref}`);
  // Parsed once per file version; callers get their own copy, as they did from a fresh parse.
  try { const found = require('./cached-json').readJson(path.join(domainsRoot, ref.split('/')[0], 'entities', ref.split('/')[1] + '.json'), MISSING); if (found === MISSING) throw MISSING; return structuredClone(found); }
  catch (error) { if (error.code?.startsWith('mapping_assessment_')) throw error; throw new Error(`entity_ref_unknown:${ref}`); }
}
function domain(ref) { return assessments.effectiveDomain(ref, bundledDomain(ref)); }
// The reviewed contract for one write operation, by name or alias. Null when knowledge has none.
function operationContract(entityRef, operation) {
  if (!operation) return null;
  const contracts = domain(entityRef).operationContracts || {};
  for (const [name, contract] of Object.entries(contracts)) if (name === operation || (contract.aliases || []).includes(operation)) return { name, contract };
  return null;
}
// Prose (evidence, notes) may change without invalidating a proof; every field a check reads does.
function contractDigest(contract) {
  const { evidence: _evidence, notes: _notes, ...semantic } = contract || {};
  return hash(canonical(semantic));
}
// The refs a write operation actually depends on: an operation contract may declare an entity-level
// edge inapplicable (Import Order carries no Shipping Options or delivery-profile reference).
function applicableDependsOn(entityRef, operation) {
  const deps = domain(entityRef).dependsOn || [];
  const found = operationContract(entityRef, operation);
  if (!found) return deps;
  return [...new Set([...deps,...Object.keys(found.contract.dependencies || {})])].filter(ref => !found.contract.dependencies?.[ref]?.inapplicable);
}
function inapplicableRefs(entityRef, operation) {
  const found = operationContract(entityRef, operation);
  return found ? Object.entries(found.contract.dependencies || {}).filter(([, dep]) => dep.inapplicable).map(([ref]) => ref) : [];
}
function guardPath(guard) { return typeof guard === 'string' ? guard : guard?.path; }
function discriminated(guard) { return typeof guard === 'object' && guard !== null && guard.equals !== undefined; }
function stripInput(targetPath, writeInput) {
  if (typeof targetPath !== 'string') return null;
  return writeInput && targetPath.startsWith(writeInput + '.') ? targetPath.slice(writeInput.length + 1) : targetPath;
}
// Path templates overlap when one is the other or an ancestor of it; `[]` and `[n]` compare equal.
function pathsOverlap(a, b) {
  const norm = value => value.replace(/\[\d*\]/g, '[]');
  const x = norm(a), y = norm(b);
  return x === y || y.startsWith(x + '.') || x.startsWith(y + '.') || y.startsWith(x + '[]') || x.startsWith(y + '[]');
}

// --- deterministic payload and record reads ---------------------------------------------------
function valuesAt(value, template) {
  const parts = template.split('.'), out = [];
  (function visit(node, index) {
    if (index === parts.length) { out.push(node); return; }
    if (node === null || typeof node !== 'object') return;
    const part = parts[index], array = part.endsWith('[]'), key = array ? part.slice(0, -2) : part;
    if (!Object.hasOwn(node, key)) return;
    if (array) { if (Array.isArray(node[key])) for (const entry of node[key]) visit(entry, index + 1); }
    else visit(node[key], index + 1);
  })(value, 0);
  return out;
}
// A guarded path is present when a payload carries a value there (and, for a discriminated guard,
// that value equals the discriminator). Presence contradicts a proof that no reference is written.
function guardHits(payload, guards) {
  const hits = [];
  for (const guard of guards || []) {
    const template = guardPath(guard);
    const values = valuesAt(payload, template).filter(value => value !== undefined && value !== null && value !== '');
    if (values.some(value => typeof guard === 'string' || guard.equals === undefined || value === guard.equals)) hits.push(template);
  }
  return hits;
}
function validatePredicate(predicate) {
  if (!predicate || typeof predicate !== 'object') return false;
  if (Array.isArray(predicate.any)) return predicate.any.length > 0 && predicate.any.every(validatePredicate);
  if (typeof predicate.path !== 'string' || !/^\w+(?:\[\])?(?:\.\w+(?:\[\])?)*$/.test(predicate.path) || !PREDICATE_OPS.has(predicate.op)) return false;
  if (predicate.op === 'in') return Array.isArray(predicate.values) && predicate.values.length > 0;
  if (predicate.op === 'equals' || predicate.op === 'startsWith') return predicate.value !== undefined && (predicate.op !== 'startsWith' || typeof predicate.value === 'string');
  return true;
}
function predicateMatches(record, predicate) {
  if (Array.isArray(predicate.any)) return predicate.any.some(clause => predicateMatches(record, clause));
  const values = valuesAt(record, predicate.path);
  if (predicate.op === 'present') return values.some(value => value !== undefined && value !== null && value !== '');
  if (predicate.op === 'equals') return values.some(value => value === predicate.value);
  if (predicate.op === 'in') return values.some(value => predicate.values.includes(value));
  return values.some(value => typeof value === 'string' && value.startsWith(predicate.value));
}

// --- mapping-plan reads -----------------------------------------------------------------------
function rowOutputs(row) {
  const outputs = [];
  for (const mapping of row.fieldMappings || []) for (const output of mapping.outputs || []) if (output && typeof output === 'object') outputs.push(output);
  return outputs;
}
// One exact write operation per dependent: the preferred writer, plus only the auxiliary operations
// its contract names. A single-create preference beside bulk-create outputs cannot share a proof.
function resolveRowOperation(row) {
  const primary = row.preferredWrite?.writerId || null;
  const ops = [...new Set(rowOutputs(row).filter(output => !output.targetRef || output.targetRef === row.targetRef).map(output => output.writeOperation).filter(Boolean))].sort();
  const found = primary ? operationContract(row.targetRef, primary) : (ops.length === 1 ? operationContract(row.targetRef, ops[0]) : null);
  if (!found) return { operation: primary || (ops.length === 1 ? ops[0] : null), contract: null, errors: [] };
  const allowed = new Set([found.name, ...(found.contract.aliases || []), ...(found.contract.auxiliaryOperations || [])]);
  const extra = ops.filter(op => !allowed.has(op));
  return { operation: found.name, contract: found.contract, errors: extra.length ? [`dependency_operation_mixed:${row.targetRef}:${found.name}:${extra.join(',')}`] : [] };
}
// Held or excluded scope is never an executable producer or writer.
const INACTIVE = new Set(['excluded', 'rejected', 'deferred']);
const activeRows = (plan, readEntityMappings) => readEntityMappings(plan).filter(row => row && !INACTIVE.has(row.status));
function rowsByTarget(plan, readEntityMappings) {
  const rows = new Map();
  for (const row of readEntityMappings(plan)) {
    if (!row?.targetRef || !refPattern.test(row.targetRef) || INACTIVE.has(row.status)) continue;
    if (!rows.has(row.targetRef)) rows.set(row.targetRef, []);
    rows.get(row.targetRef).push(row);
  }
  return rows;
}
// Paths the dependent's write sends: its own rows' outputs, plus any active output that names its
// write operation, whatever target it is labelled with — the operation decides the request body.
function mappedPaths(rows, targetRef, operation, contract, allRows = []) {
  const ops = new Set([operation, ...(contract?.aliases || [])]);
  const paths = [];
  const add = output => { const target = stripInput(output.targetPath, output.writeInput); if (target) paths.push(target); };
  for (const row of rows) for (const output of rowOutputs(row)) {
    if (output.targetRef && output.targetRef !== targetRef) continue;
    if (output.writeOperation && !ops.has(output.writeOperation)) continue;
    add(output);
  }
  for (const row of allRows) if (!rows.includes(row)) for (const output of rowOutputs(row)) if (ops.has(output.writeOperation)) add(output);
  return paths;
}
function mislabelled(plan, readEntityMappings, dependentRef, found) {
  const ops = new Set([found.name, ...(found.contract.aliases || [])]);
  for (const row of activeRows(plan, readEntityMappings)) for (const output of rowOutputs(row)) {
    const targetRef = output.targetRef || row?.targetRef;
    if (!ops.has(output.writeOperation) || targetRef === dependentRef) continue;
    let owned = null;
    try { owned = refPattern.test(targetRef || '') ? operationContract(targetRef, output.writeOperation) : null; } catch { owned = null; }
    if (!owned) return true;
  }
  return false;
}

// --- proof validation -------------------------------------------------------------------------
function proofKey(entityRef, operation, ref) { return `${entityRef}|${operation}|${ref}`; }
function insideProject(projectDir, file) {
  if (typeof file !== 'string' || !file) throw new Error('dependency_proof_evidence_path_invalid');
  const root = path.resolve(projectDir), absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) throw new Error('dependency_proof_evidence_path_invalid');
  return absolute;
}
// zero-match: a deterministic predicate over a complete, populated extract. Returns the measured
// count and the extract digest it was measured on; throws when the population is not complete.
// Before approval the extract must also be the census-measured population; at runtime a source
// catch-up extract is re-measured on its own completeness (the census predates it).
// Runtime re-validates before every batch, so a scan is cached per extract file identity and
// predicate: one full scan per distinct extract version, never one per batch, edge or record.
const scanCache = new Map(), scanTotals = { scans: 0, records: 0 };
function statKey(file) { const stat = fs.statSync(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
function extractDigest(file) {
  const key = 'digest:' + file, stamp = statKey(file), prior = scanCache.get(key);
  if (prior?.stamp === stamp) return prior.value;
  const value = hash(fs.readFileSync(file)); scanCache.set(key, { stamp, value }); return value;
}
function measureZeroMatch(projectDir, absence, censusRow, work, stage) {
  if (!censusRow) throw new Error('dependency_proof_absence_unmeasured');
  if (!Number.isInteger(censusRow.recordCount) || censusRow.recordCount <= 0) throw new Error('dependency_proof_population_empty');
  if (!validatePredicate(absence.predicate)) throw new Error('dependency_proof_predicate_invalid');
  const manifest = JSON.parse(fs.readFileSync(insideProject(projectDir, absence.manifestPath), 'utf8'));
  const extractFile = insideProject(projectDir, absence.extractPath);
  const key = 'scan:' + extractFile + ':' + canonical(absence.predicate), stamp = statKey(extractFile);
  let scan = scanCache.get(key)?.stamp === stamp ? scanCache.get(key).value : null;
  if (!scan) {
    const bytes = fs.readFileSync(extractFile), records = bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    scan = { matches: records.filter(record => predicateMatches(record, absence.predicate)).length, extractSha256: hash(bytes), population: records.length };
    scanCache.set(key, { stamp, value: scan }); scanTotals.scans++; scanTotals.records += records.length;
    if (work) { work.predicateScans++; work.recordsScanned += records.length; }
  }
  if (!Number.isInteger(manifest.rowsWritten) || manifest.rowsWritten !== manifest.snapshotTotal || scan.population !== manifest.rowsWritten || stage !== 'runtime' && scan.population !== censusRow.recordCount) throw new Error('dependency_proof_population_incomplete');
  return scan;
}
// Validate one proposed proof against the reviewed contract, the census and the mapping. `stage`
// 'mapping' and 'codegen' require bound evidence to be current; 'runtime' re-measures a changed
// extract instead (source catch-up) and reports a contradiction rather than throwing.
function validateProof(proof, { rows = new Map(), plan = null, readEntityMappings = () => [], projectDir = null, stage = 'mapping', work = null } = {}) {
  const errors = [], key = proof && typeof proof === 'object' ? `${proof.dependentRef}:${proof.ref}` : '<invalid>';
  const fail = code => { errors.push(`${code}:${key}`); return { ok: false, errors, proof }; };
  if (!proof || typeof proof !== 'object' || typeof proof.id !== 'string' || !proof.id || !refPattern.test(proof.dependentRef || '') || !refPattern.test(proof.ref || '') || typeof proof.operation !== 'string' || !REASONS.has(proof.reason)) return fail('dependency_proof_invalid');
  if (typeof proof.explanation !== 'string' || !proof.explanation.trim() || !Array.isArray(proof.evidenceRefs) || !proof.evidenceRefs.length || proof.evidenceRefs.some(ref => typeof ref !== 'string' || !ref)) return fail('dependency_proof_evidence_missing');
  let found;
  try { found = operationContract(proof.dependentRef, proof.operation); if (!(domain(proof.dependentRef).dependsOn || []).includes(proof.ref) && !Object.hasOwn(found?.contract.dependencies || {},proof.ref)) return fail('dependency_proof_not_a_dependency'); }
  catch (error) { return fail(error.message.split(':')[0]); }
  if (!found) return fail('dependency_proof_contract_unknown');
  const dep = found.contract.dependencies?.[proof.ref];
  if (!dep) return fail('dependency_proof_contract_unknown');
  if (dep.inapplicable) return fail('dependency_proof_inapplicable');
  if (proof.operation !== found.name) return fail('dependency_proof_operation_alias');
  if (proof.operationContractDigest !== contractDigest(found.contract)) return fail('dependency_proof_contract_stale');
  if (!Array.isArray(dep.guardedPaths) || !dep.guardedPaths.length) return fail('dependency_proof_guard_unknown');
  if (!equal(proof.guardedPaths, dep.guardedPaths)) return fail('dependency_proof_guard_mismatch');
  const targetRows = plan ? (rowsByTarget(plan, readEntityMappings).get(proof.dependentRef) || []) : [];
  if (plan) {
    if (!targetRows.length) return fail('dependency_proof_dependent_unmapped');
    for (const row of targetRows) { const resolved = resolveRowOperation(row); if (resolved.errors.length || resolved.operation !== found.name) return fail('dependency_proof_operation_mismatch'); }
  }
  // An output carrying the dependent's write operation under a target that does not own it would
  // hide its paths from the guard check below.
  if (plan && mislabelled(plan, readEntityMappings, proof.dependentRef, found)) return fail('dependency_proof_operation_mislabelled');
  const mapped = plan ? mappedPaths(targetRows, proof.dependentRef, found.name, found.contract, activeRows(plan, readEntityMappings)) : [];
  // A `{ path, equals }` guard matches one value at its path (the Gift Cards catalog appId). A plan
  // records which paths it writes, not their values, so mapping only refuses plain guards; the
  // runtime payload guards (guardHits) enforce the value on every record before it is sent.
  const guardMapped = () => mapped.some(target => dep.guardedPaths.some(guard => !discriminated(guard) && pathsOverlap(target, guardPath(guard))));
  let status = 'valid', measured = null;
  if (proof.reason === 'within-write') {
    if (!dep.withinWrite || !Array.isArray(dep.creatingPaths) || !dep.creatingPaths.length) return fail('dependency_proof_within_write_unsupported');
    if (!equal(proof.creatingPaths, dep.creatingPaths)) return fail('dependency_proof_creating_paths_mismatch');
    const keys = found.contract.recovery?.reconciliationKeys || [];
    if (!keys.length) return fail('dependency_proof_recovery_undefined');
    if (plan) {
      if (guardMapped()) return fail('dependency_proof_guard_mapped');
      if (!keys.some(entry => entry.clientAssigned || mapped.some(target => target.replace(/\[\d*\]/g, '[]') === entry.path))) return fail('dependency_proof_reconciliation_key_unmapped');
    }
  } else {
    if (dep.conditional !== true) return fail('dependency_proof_not_conditional');
    if (dep.nonReferencePrerequisite) return fail('dependency_proof_prerequisite_remains');
    if (plan && guardMapped()) return fail('dependency_proof_guard_mapped');
  }
  if (proof.reason === 'not-referenced' && plan && targetRows.some(row => row.fieldMappingStatus !== undefined && row.fieldMappingStatus !== 'resolved')) return fail('dependency_proof_mapping_incomplete');
  if (proof.reason === 'no-data') {
    const absence = proof.absence;
    if (!absence || !ABSENCE_KINDS.has(absence.kind)) return fail('dependency_proof_absence_unmeasured');
    try {
      if (absence.kind === 'zero-row') {
        if (!Array.isArray(absence.censusIds) || !absence.censusIds.length) return fail('dependency_proof_absence_unmeasured');
        for (const id of absence.censusIds) {
          const row = rows.get(id);
          if (!row || !Number.isInteger(row.recordCount)) return fail('dependency_proof_absence_unmeasured');
          if (row.recordCount !== 0 || row.state !== 'no-data') { if (stage === 'runtime') { status = 'contradicted'; break; } return fail('dependency_proof_absence_contradicted'); }
        }
      } else if (absence.kind === 'zero-match') {
        if (!projectDir) return fail('dependency_proof_absence_unmeasured');
        const current = extractDigest(insideProject(projectDir, absence.extractPath));
        if (current !== absence.extractSha256 && stage !== 'runtime') return fail('dependency_proof_evidence_stale');
        measured = measureZeroMatch(projectDir, absence, rows.get(absence.censusId), work, stage);
        if (measured.matches > 0) { if (stage === 'runtime') status = 'contradicted'; else return fail('dependency_proof_absence_contradicted'); }
      } else {
        if (!projectDir || typeof absence.capability !== 'string' || !absence.capability) return fail('dependency_proof_absence_unmeasured');
        const bytes = fs.readFileSync(insideProject(projectDir, absence.evidencePath));
        if (hash(bytes) !== absence.evidenceSha256) return fail('dependency_proof_evidence_stale');
        const evidence = JSON.parse(bytes.toString('utf8'));
        // Only an explicit, scoped absence counts; a missing or failed discovery response does not.
        if (evidence?.capability !== absence.capability || evidence.status !== 'absent' || typeof evidence.scope !== 'string' || !evidence.scope || !Number.isFinite(Date.parse(evidence.observedAt))) return fail('dependency_proof_absence_unmeasured');
      }
    } catch (error) {
      if (/^dependency_proof_/.test(error.message)) return fail(error.message);
      return fail(error.code === 'ENOENT' ? 'dependency_proof_evidence_missing' : 'dependency_proof_evidence_invalid');
    }
  }
  return { ok: true, errors, proof, status, measured, contractName: found.name };
}
function validateProofs(proofs, context = {}) {
  const valid = new Map(), errors = [];
  if (proofs !== undefined && !Array.isArray(proofs)) return { proofs: valid, errors: ['dependency_proofs_invalid'] };
  for (const proof of proofs || []) {
    const result = validateProof(proof, context);
    if (!result.ok) { errors.push(...result.errors); continue; }
    const key = proofKey(proof.dependentRef, proof.operation, proof.ref);
    if (valid.has(key)) { errors.push(`dependency_proof_duplicate:${proof.dependentRef}:${proof.ref}`); continue; }
    valid.set(key, { ...proof, status: result.status, measured: result.measured });
  }
  return { proofs: valid, errors };
}

// --- graph resolution -------------------------------------------------------------------------
// A setup step is never per-record: a ref that may come from either an import task or a setup step
// (a tax group) is per-record only when an import task produces it.
const SETUP_PRODUCERS = new Set(['setup-step', 'pending-setup']);
function edgeMode(entityRefs, ref, producer) {
  if (SETUP_PRODUCERS.has(producer?.kind)) return 'task-complete';
  return entityRefs.every(entity => domain(entity).dependencyModes?.[ref] === 'per-record') ? 'per-record' : 'task-complete';
}
// Every ref a dependent needs, operation-aware, with the parents each transitive ref was reached
// through. `operationFor(ref)` names the operation that produces an intermediate ref, if known.
// `adopted` names refs whose task only reads and verifies what already exists on the site (mapping
// `writeMode: 'adopt-only-no-writes'`): nothing is written through them, so their own write-time
// dependencies are not expanded, and the closure keeps the ref and stops there.
function dependencyClosure(entityRefs, operations, operationFor, adopted = new Set()) {
  const direct = new Map(), via = new Map(), cycles = [];
  for (const entity of entityRefs) for (const ref of applicableDependsOn(entity, operations[entity])) {
    // A ref this task writes itself is satisfied inside the task (its writer orders the writes);
    // binding it to the task would make the task wait on itself.
    if (entityRefs.includes(ref)) continue;
    if (!direct.has(ref)) direct.set(ref, []);
    direct.get(ref).push(entity);
  }
  const seen = new Set(direct.keys()), queue = [...direct.keys()];
  while (queue.length) {
    const parent = queue.shift();
    if (adopted.has(parent)) continue;
    for (const ref of applicableDependsOn(parent, operationFor(parent))) {
      if (entityRefs.includes(ref)) { cycles.push(ref); continue; }
      if (!direct.has(ref)) { if (!via.has(ref)) via.set(ref, new Set()); via.get(ref).add(parent); }
      if (!seen.has(ref)) { seen.add(ref); queue.push(ref); }
    }
  }
  return { direct, via, refs: [...seen].sort(), cycles: [...new Set(cycles)].sort() };
}
// Plan-side adopt-only evidence: a target is adopt-only only when every active mapping row for it says
// `writeMode: 'adopt-only-no-writes'`. A target with both kinds of row is `mixed` and refused, because
// the same task would both create and promise to write nothing.
const ADOPT_ONLY_WRITE_MODE = 'adopt-only-no-writes';
function adoptOnlyRefsOf(plan, readEntityMappings) {
  const rows = rowsByTarget(plan, readEntityMappings), refs = [], mixed = [];
  for (const [targetRef, targetRows] of rows) {
    const adopting = targetRows.filter(row => row.writeMode === ADOPT_ONLY_WRITE_MODE).length;
    if (adopting === targetRows.length) refs.push(targetRef); else if (adopting) mixed.push(targetRef);
  }
  return { refs: refs.sort(), mixed: mixed.sort() };
}
// Resolve producers for every dependent. One function serves mapping preflight and codegen; the
// stage adapters only supply who can produce what. A dependent marked `adoptOnly` is honoured only
// when the plan marks every ref it owns adopt-only (`adoptOnlyRefs`); the reverse also holds: a
// dependent owning a plan-adopt-only ref must carry the mark, so a task that omits it is never
// treated as a creating task silently. Either mismatch is an error, and the creating-task rules still
// run for that dependent, so the mark can never be used to skip a dependency. Setup at mapping time is `pending-setup`: it can
// pass structural readiness but is never a producer of record.
function resolveDependencyGraph({ dependents, imports, setupFor = () => null, dispositions = {}, proofs = new Map(), adoptOnlyRefs = [], adoptOnlyMixed = [] }) {
  const result = {}, errors = [], usedProofs = new Set();
  const approvedAdopt = new Set(adoptOnlyRefs), adopted = new Set(), adoptedTasks = new Set(), adoptErrors = new Map();
  for (const dependent of dependents) {
    const owned = dependent.entityRefs.filter(ref => approvedAdopt.has(ref)), mixed = dependent.entityRefs.filter(ref => adoptOnlyMixed.includes(ref));
    const problems = mixed.map(ref => `dependency_adopt_only_mixed:${dependent.id}:${ref}`);
    if (dependent.adoptOnly === true && owned.length === dependent.entityRefs.length && !problems.length) { adoptedTasks.add(dependent.id); dependent.entityRefs.forEach(ref => adopted.add(ref)); }
    else if (dependent.adoptOnly === true) problems.push(`dependency_adopt_only_unapproved:${dependent.id}`);
    else if (owned.length) problems.push(`dependency_adopt_only_unmarked:${dependent.id}`);
    if (problems.length) adoptErrors.set(dependent.id, problems);
  }
  const producerOf = new Map();
  for (const producer of imports) for (const ref of producer.entityRefs) if (!producerOf.has(ref)) producerOf.set(ref, producer);
  const operationFor = ref => producerOf.get(ref)?.operations?.[ref];
  const secondaryFor = (ref, selfId) => imports.filter(producer => producer.id !== selfId && producer.entityRefs.some(entity => operationContract(entity, producer.operations?.[entity])?.contract.secondaryOutputs?.[ref])).map(producer => ({ kind: 'secondary-output', taskId: producer.id, parentRef: producer.entityRefs.find(entity => operationContract(entity, producer.operations?.[entity])?.contract.secondaryOutputs?.[ref]) }));
  // A child entity (a product's variants) is created inside its parent's write. Its identities come
  // from the parent task whose reviewed operation declares them; with no such task nothing can name a
  // child, so the ref is inherited from the parent and any write of it is refused.
  const childOf = ref => { try { return domain(ref).childOf || null; } catch { return null; } };
  const childFor = (ref, selfId) => imports.filter(producer => producer.id !== selfId && producer.entityRefs.includes(childOf(ref)) && operationContract(childOf(ref), producer.operations?.[childOf(ref)])?.contract.childOutputs?.[ref]).map(producer => ({ kind: 'child-output', taskId: producer.id, parentRef: childOf(ref) }));
  // A child is never imported on its own: its identities exist only in the parent's verified receipt.
  for (const producer of imports) for (const ref of producer.entityRefs) if (childOf(ref)) errors.push(`dependency_child_standalone:${producer.id}:${ref}`);
  for (const dependent of dependents) {
    const taskErrors = [...(adoptErrors.get(dependent.id) || [])], edges = [], bound = new Map(), carried = new Set();
    // An adopt-only task writes nothing, so it needs no producer for any dependency of what it adopts.
    if (adoptedTasks.has(dependent.id)) { result[dependent.id] = { refs: [], edges: [], dependsOn: [], errors: taskErrors }; continue; }
    let closure;
    try { closure = dependencyClosure(dependent.entityRefs, dependent.operations || {}, operationFor, adopted); }
    catch (error) { errors.push(error.message); result[dependent.id] = { refs: [], edges: [], dependsOn: [], errors: [error.message] }; continue; }
    for (const ref of closure.cycles) taskErrors.push(`dependency_cycle:${dependent.id}:${ref}`);
    // Direct refs first, then transitive refs in an order where every parent is already bound.
    // A child ref is bound after its parent, whose producer decides the child's fallback.
    const order = [...closure.direct.keys()].sort((a, b) => Number(Boolean(childOf(a))) - Number(Boolean(childOf(b))) || a.localeCompare(b));
    const pending = closure.refs.filter(ref => !closure.direct.has(ref));
    while (pending.length) {
      const index = pending.findIndex(ref => [...closure.via.get(ref)].every(parent => !pending.includes(parent)));
      order.push(...pending.splice(index < 0 ? 0 : index, 1));
    }
    for (const ref of order) {
      const isDirect = closure.direct.has(ref), candidates = [];
      // Reached only through per-record parents: each dependent record waits for its own parent
      // record, whose write was already gated on this ref, so no task-wide wait is added.
      if (!isDirect && [...closure.via.get(ref)].every(parent => carried.has(parent))) {
        const producer = { kind: 'inherited', via: [...closure.via.get(ref)].sort() };
        bound.set(ref, producer); edges.push({ ref, mode: 'task-complete', producer }); carried.add(ref); continue;
      }
      // A task is never its own producer: the readiness gate would wait for a pass of itself.
      if (!childOf(ref)) for (const producer of imports) if (producer.id !== dependent.id && producer.entityRefs.includes(ref)) candidates.push({ kind: 'import-task', taskId: producer.id });
      const scoped = isDirect ? closure.direct.get(ref).map(entity => ({ entity, proof: proofs.get(proofKey(entity, dependent.operations?.[entity], ref)) })) : [];
      // Mapping-time `pending-setup` with no planned step is only a placeholder: it yields to a proof.
      const setup = setupFor(ref);
      if (setup && !(setup.kind === 'pending-setup' && !setup.stepId && scoped.some(row => row.proof))) candidates.push(setup);
      if (dispositions[ref]) candidates.push({ kind: 'disposition', censusIds: dispositions[ref].censusIds, reconciliationSha256: dispositions[ref].reconciliationSha256 });
      if (isDirect) {
        if (scoped.some(row => row.proof)) {
          if (!scoped.every(row => row.proof)) { taskErrors.push(`dependency_proof_scope_incomplete:${dependent.id}:${ref}`); continue; }
          for (const row of scoped) usedProofs.add(proofKey(row.entity, dependent.operations[row.entity], ref));
          candidates.push({ kind: 'no-producer', proofs: scoped.map(({ entity, proof }) => ({ entityRef: entity, operation: proof.operation, reason: proof.reason, proofId: proof.id, operationContractDigest: proof.operationContractDigest })) });
        }
        // A member task's verified contact identities can satisfy a contact reference only when no
        // other producer exists, so two producers never compete for the same reference.
        if (!candidates.length) candidates.push(...secondaryFor(ref, dependent.id));
        if (!candidates.length && childOf(ref)) candidates.push(...childFor(ref, dependent.id));
        if (!candidates.length && childOf(ref) && bound.has(childOf(ref))) candidates.push({ kind: 'inherited', via: [childOf(ref)] });
      } else if (!candidates.length) {
        const parents = [...closure.via.get(ref)].sort();
        if (parents.every(parent => INHERITABLE.has(bound.get(parent)?.kind))) candidates.push({ kind: 'inherited', via: parents });
      }
      // A proof that this operation writes no reference needs no producer, so a setup step (pending
      // at mapping, real at codegen) that makes the ref for other dependents never competes with it:
      // mapping and codegen then bind the same proof whether or not the plan has that step (an
      // add-on's optional tax group). An import task or a disposition still conflicts.
      if (candidates.some(candidate => candidate.kind === 'no-producer')) for (let i = candidates.length - 1; i >= 0; i--) if (['setup-step', 'pending-setup'].includes(candidates[i].kind)) candidates.splice(i, 1);
      if (candidates.length > 1 && candidates.some(candidate => candidate.kind === 'no-producer')) { taskErrors.push(`dependency_proof_conflict:${dependent.id}:${ref}`); continue; }
      if (candidates.length !== 1) { taskErrors.push(`dependency_${candidates.length ? 'multiply_bound' : 'unbound'}:${ref}`); continue; }
      const producer = candidates[0], mode = producer.kind === 'inherited' ? 'task-complete' : edgeMode(dependent.entityRefs, ref, producer);
      if (mode === 'per-record' && ['setup-step', 'pending-setup'].includes(producer.kind) || ['secondary-output', 'child-output'].includes(producer.kind) && mode !== 'per-record') taskErrors.push(`dependency_mode_invalid:${dependent.id}:${ref}`);
      bound.set(ref, producer); edges.push({ ref, mode, producer });
      // A proof that this operation writes no such reference carries nothing through it either:
      // the ref's own dependencies (a gift card product's media) add no task-wide wait.
      if (mode === 'per-record' || producer.kind === 'no-producer') carried.add(ref);
    }
    const dependsOn = [...new Set(edges.filter(edge => ['import-task', 'secondary-output', 'child-output'].includes(edge.producer.kind)).map(edge => edge.producer.taskId))].sort();
    result[dependent.id] = { refs: closure.refs, edges, dependsOn, errors: taskErrors };
    errors.push(...taskErrors);
  }
  for (const key of proofs.keys()) if (!usedProofs.has(key)) errors.push(`dependency_proof_unused:${key.split('|').join(':')}`);
  return { ok: errors.length === 0, errors, tasks: result };
}

// --- mapping preflight (before approval) ------------------------------------------------------
const NEXT_STEPS = {
  dependency_unbound: 'Import the dependency, record an approved exclusion, or propose a supported noProducer proof for the exact dependent operation.',
  dependency_multiply_bound: 'Keep exactly one producer for this dependency.',
  dependency_proof_conflict: 'A dependency with a real producer cannot also be explained as needing none; remove one.',
  dependency_operation_mixed: 'Resolve one write operation for this dependent; a single-create preference and bulk-create outputs cannot share a proof.',
  dependency_proof_guard_mapped: 'The approved mapping writes a guarded reference path; bind a real producer or stop writing the path.',
  dependency_proof_operation_mislabelled: 'A mapping output uses this write operation under a different target; label it with the entity that write creates.',
  dependency_proof_contract_stale: 'Target knowledge changed; recompute operationContractDigest and re-review the proof.',
  dependency_proof_evidence_stale: 'Source evidence changed; re-measure the proof on the current extract.',
  dependency_proof_absence_contradicted: 'The measured data contains the dependency; it is not absent.',
  setup_step_claims_import_entity: 'Drop the ref from the setup step; the import task that writes it owns it. A read-only prerequisite check lists no import-owned refs.',
  dependency_adopt_only_unapproved: 'The task is marked adopt-only but the approved mapping does not mark every ref it owns adopt-only; fix the mark or the mapping row.',
  dependency_adopt_only_unmarked: 'The approved mapping marks this ref adopt-only but the task is not marked adoptOnly: true; emit the mark (rp-import-codegen) or change the mapping row to create.',
  dependency_adopt_only_mixed: 'The mapping has adopt-only and creating rows for one target; split them or make every row the same write mode.',
  dependency_child_standalone: 'Map these source records into their parent entity; the parent write creates them and its verified receipt names them.',
  dependency_proof_expected: 'The mapping writes none of this conditional reference, so nothing has to produce it: add the suggestedProof to mapping-plan.json dependencyProofs. Setup only produces it when a mapped path references it.',
};
const UNPRODUCIBLE_NEXT = 'Nothing can produce this dependency: rp-target-wix has no writer for it and no setup step makes it, so it cannot be imported. Record an approved exclusion (census disposition) for it, or propose a supported noProducer proof for the exact dependent operation.';
// Whether the target has any way to be written: setup, a parent write, a registered writer, or
// guarded raw requests for a native entity with no writer.
// Unknown knowledge keeps the ordinary message.
function producible(ref) {
  let entity;
  try { entity = domain(ref); } catch { return true; }
  if (entity.setupProducible || entity.childOf) return true;
  const writers = require('../resources/rp-target-wix/lib/wix-writers.js');
  return [entity.preferredWrite?.writerId, ...Object.keys(entity.operationContracts || {})].some(name => typeof writers[name] === 'function') || Boolean(writers.WRITE_BUILDERS_BY_ENTITY[ref]?.length) || require('./target-import-support').rawRequestEntity(ref);
}
function diagnostic(code, dependent = null) {
  const [name, ...rest] = code.split(':'), detail = rest.join(':');
  const next = name === 'dependency_unbound' && !producible(detail) ? UNPRODUCIBLE_NEXT : NEXT_STEPS[name];
  return { code: name, ...(dependent ? { dependent } : {}), detail, next: next || 'Correct the named dependency evidence, then re-run the preflight.' };
}
// The not-referenced proof a dependent's mapping already satisfies for `ref`, or null.
function notReferencedProof(dependent, ref, context) {
  const operation = dependent?.operations?.[dependent.id], found = operationContract(dependent?.id, operation), dep = found?.contract.dependencies?.[ref];
  if (!dep || dep.conditional !== true || !Array.isArray(dep.guardedPaths) || !dep.guardedPaths.length) return null;
  const proof = { id: `${dependent.id.split('/')[1]}-${ref.split('/')[1]}`, dependentRef: dependent.id, operation: found.name, ref, reason: 'not-referenced',
    explanation: `The approved ${dependent.id} mapping writes none of ${dep.guardedPaths.map(guardPath).join(', ')}.`,
    evidenceRefs: [`mapping/mapping-plan.json#${dependent.id}`], operationContractDigest: contractDigest(found.contract), guardedPaths: dep.guardedPaths };
  return validateProof(proof, { ...context, stage: 'mapping' }).ok ? proof : null;
}
function preflightMapping({ plan, reconciliation, dispositions = {}, readEntityMappings, projectDir = null }) {
  const started = process.hrtime.bigint(), work = { predicateScans: 0, recordsScanned: 0, dependents: 0, edges: 0 };
  const rowsMap = new Map((reconciliation?.rows || []).map(row => [row.censusId, row]));
  const byTarget = rowsByTarget(plan, readEntityMappings), errors = [], dependents = [], imports = [];
  // The same plan-side evidence codegen reads: a target whose every row adopts what a quick pass made
  // is an adopt-only dependent, so mapper and codegen draw the same edges for it.
  const adoption = adoptOnlyRefsOf(plan, readEntityMappings);
  for (const [targetRef, rows] of byTarget) {
    let setupProducible = false;
    try { setupProducible = Boolean(domain(targetRef).setupProducible); } catch (error) { errors.push(error.message); continue; }
    const resolved = rows.map(resolveRowOperation), ops = [...new Set(resolved.map(row => row.operation))];
    for (const row of resolved) errors.push(...row.errors);
    if (ops.length > 1) errors.push(`dependency_operation_mixed:${targetRef}:${ops.join(',')}`);
    const producer = { id: targetRef, entityRefs: [targetRef], operations: ops.length === 1 && ops[0] ? { [targetRef]: ops[0] } : {}, ...(adoption.refs.includes(targetRef) ? { adoptOnly: true } : {}) };
    // Whether setup or an import writes a mapped setup-producible target is decided at codegen, so
    // here it stays pending setup as a producer; its own dependencies are still checked.
    if (!setupProducible) imports.push(producer);
    dependents.push(producer);
  }
  const setupFor = ref => {
    const planned = require('./setup-producers').plannedProducer(plan, ref, projectDir);
    if (planned) return planned;
    try { return domain(ref).setupProducible ? { kind:'pending-setup' } : null; } catch { return null; }
  };
  const validated = validateProofs(plan?.dependencyProofs, { rows: rowsMap, plan, readEntityMappings, projectDir, stage: 'mapping', work });
  errors.push(...validated.errors);
  const graph = resolveDependencyGraph({ dependents, imports, setupFor, dispositions, proofs: validated.proofs, adoptOnlyRefs: adoption.refs, adoptOnlyMixed: adoption.mixed });
  const taskErrors = new Set(Object.values(graph.tasks).flatMap(task => task.errors));
  errors.push(...graph.errors.filter(error => !taskErrors.has(error)));
  work.dependents = dependents.length; work.edges = Object.values(graph.tasks).reduce((sum, task) => sum + task.edges.length, 0);
  const diagnostics = [...new Set(errors)].map(code => diagnostic(code));
  for (const [id, task] of Object.entries(graph.tasks)) for (const code of new Set(task.errors)) diagnostics.push(diagnostic(code, id));
  // A setup-producible ref with no planned setup step and no mapping row of its own stays
  // `pending-setup` here, yet nothing will ever make it. When the dependent's reviewed contract makes
  // the ref conditional and the mapping writes none of its guarded paths, codegen would find no
  // producer (`dependency_unbound`): ask for the not-referenced proof now, ready to add.
  for (const [id, task] of Object.entries(graph.tasks)) for (const edge of task.edges) {
    if (edge.producer.kind !== 'pending-setup' || edge.producer.stepId || byTarget.has(edge.ref)) continue;
    const suggestedProof = notReferencedProof(dependents.find(row => row.id === id), edge.ref, { plan, readEntityMappings, rows: rowsMap, projectDir });
    if (suggestedProof) diagnostics.push({ ...diagnostic(`dependency_proof_expected:${edge.ref}`, id), suggestedProof });
  }
  // The same proof for a conditional ref nothing can produce here (a site's share image with no
  // media row): the blocking dependency_unbound row carries it, ready to add, so a mapping that
  // writes none of the guarded paths is fixed by the proof rather than by planning a producer.
  for (const row of diagnostics) if (row.code === 'dependency_unbound' && row.dependent) {
    let suggestedProof = null;
    try { suggestedProof = notReferencedProof(dependents.find(dependent => dependent.id === row.dependent), row.detail, { plan, readEntityMappings, rows: rowsMap, projectDir }); } catch { suggestedProof = null; }
    if (suggestedProof) Object.assign(row, { suggestedProof, next: `The mapping writes none of this conditional reference: add the suggestedProof to mapping-plan.json dependencyProofs, or map the producer of ${row.detail}.` });
  }
  const pendingSetup = [...new Set(Object.values(graph.tasks).flatMap(task => task.edges.filter(edge => edge.producer.kind === 'pending-setup').map(edge => edge.ref)))].sort();
  // A producer whose mapping rows still have an uninspected field inventory cannot run yet. When
  // every row of that target is pending it is not a producer at all (`deferred-mapping`); when only
  // some are, a dependent waits for the pending rows its retained writes name in
  // requiredSourceEntityRefs (the same prerequisites execution scope uses). Held dependents are
  // annotated too. Listed for the review, not a structural error, so an independent subset can
  // still be approved provisionally.
  const identities = row => [row.sourceEntityRef, row.sourceEntity, row.entityKey].filter(Boolean);
  const canonicalId = row => row.sourceEntityRef || row.sourceEntity || row.entityKey;
  const pendingRows = new Map();
  for (const [targetRef, rows] of byTarget) {
    const pending = rows.filter(row => row.fieldMappingStatus === 'pending');
    if (pending.length) pendingRows.set(targetRef, { all: pending.length === rows.length, rows: pending });
  }
  const waiting = [];
  for (const [id, task] of Object.entries(graph.tasks)) {
    const required = new Set((byTarget.get(id) || []).flatMap(row => row.requiredSourceEntityRefs || []));
    for (const edge of task.edges) {
      const held = edge.producer.kind === 'import-task' && pendingRows.get(edge.producer.taskId);
      if (!held) continue;
      const rows = held.all ? held.rows : held.rows.filter(row => identities(row).some(name => required.has(name)));
      if (!rows.length) continue;
      const sourceEntityRefs = [...new Set(rows.map(canonicalId))].sort();
      if (held.all) edge.producer = { kind: 'deferred-mapping', taskId: edge.producer.taskId, sourceEntityRefs };
      else edge.pendingSourceEntityRefs = sourceEntityRefs;
      waiting.push({ dependent: id, ref: edge.ref, mode: edge.mode, sourceEntityRefs, producerPartlyPending: !held.all,
        next: 'Finish the field mapping of the named source entities (for a plugin entity, its full read comes first: resources/rp-source-wordpress/scripts/plugin-full-read.js), or record an approved exclusion. Until then this dependent waits.' });
    }
  }
  return {
    schemaVersion: 1, stage: 'mapping', structuralReady: diagnostics.length === 0, executionReady: false,
    errors: diagnostics, pendingSetup, waiting,
    tasks: Object.fromEntries(Object.entries(graph.tasks).map(([id, task]) => [id, { operation: dependents.find(row => row.id === id)?.operations?.[id] || null, edges: task.edges }])),
    proofs: [...validated.proofs.values()].map(proof => ({ id: proof.id, dependentRef: proof.dependentRef, operation: proof.operation, ref: proof.ref, reason: proof.reason, status: proof.status })),
    work: { ...work, elapsedMs: Number((process.hrtime.bigint() - started) / 1000000n) },
  };
}

module.exports = {
  REASONS, canonical, domain, bundledDomain, useTargetKnowledgeRoot, contractDigest, operationContract, applicableDependsOn, inapplicableRefs, guardHits, guardPath, valuesAt,
  validatePredicate, predicateMatches, resolveRowOperation, validateProof, validateProofs, proofKey, dependencyClosure, adoptOnlyRefsOf,
  resolveDependencyGraph, preflightMapping, pathsOverlap, scanTotals: () => ({ ...scanTotals }),
};
for (const name of ['preflightMapping', 'resolveDependencyGraph']) {
  const run = module.exports[name];
  module.exports[name] = options => options.plan ? assessments.withPlan(options.plan, options.projectDir, () => run(options)) : run(options);
}
for (const name of ['validateProof', 'validateProofs']) {
  const run = module.exports[name];
  module.exports[name] = (proof, options = {}) => options.plan ? assessments.withPlan(options.plan, options.projectDir, () => run(proof, options)) : run(proof, options);
}
