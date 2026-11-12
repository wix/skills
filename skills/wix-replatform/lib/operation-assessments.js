'use strict';

// Mapper-owned, run-local supplements. Async context keeps concurrent projects isolated;
// nothing writes the bundled knowledge or installs a process-global contract override.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const artifactCache = new Map();
const REF = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const digest = v => crypto.createHash('sha256').update(stable(v) ?? 'undefined').digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function artifact(projectDir, ref) {
  if (!projectDir || !ref || typeof ref.artifact !== 'string' || !HASH.test(ref.sha256 || '')) fail('mapping_assessment_evidence_missing');
  const root = fs.realpathSync(projectDir), file = fs.realpathSync(path.resolve(root, ref.artifact));
  if (!file.startsWith(root + path.sep)) fail('mapping_assessment_evidence_outside_project');
  const stat = fs.statSync(file);
  const key = `${file}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${ref.sha256}`;
  if (artifactCache.has(key)) return artifactCache.get(key);
  const bytes = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== ref.sha256) fail('mapping_assessment_evidence_stale');
  if (artifactCache.size >= 32) artifactCache.delete(artifactCache.keys().next().value);
  artifactCache.set(key, bytes);
  return bytes;
}
function rows(plan) {
  for (const key of ['entities', 'entityMappings', 'entityDecisions', 'mappings']) {
    if (Array.isArray(plan?.[key])) return plan[key];
    if (key === 'entities' && plan?.entities && typeof plan.entities === 'object') return Object.entries(plan.entities).map(([sourceEntity, row]) => ({ sourceEntity, ...row }));
  }
  return [];
}
function mergeKnown(known, supplement, closed = false) {
  if (known === undefined) return structuredClone(supplement);
  if (known && supplement && typeof known === 'object' && typeof supplement === 'object' && !Array.isArray(known) && !Array.isArray(supplement)) {
    const result = structuredClone(known);
    for (const key of Object.keys(supplement)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('mapping_assessment_invalid');
      if (closed && !Object.hasOwn(known, key)) fail('mapping_assessment_known_rule_conflict');
      result[key] = mergeKnown(known[key], supplement[key], closed);
    }
    return result;
  }
  if (stable(known) !== stable(supplement)) fail('mapping_assessment_known_rule_conflict');
  return structuredClone(known);
}
function mergeContract(known, supplement) {
  for (const [ref, dependency] of Object.entries(supplement.dependencies || {})) {
    if (Object.hasOwn(known?.dependencies || {}, ref)) mergeKnown(known.dependencies[ref], dependency, true);
  }
  return mergeKnown(known, supplement);
}
function validateSourceScopes(selected, coverage) {
  if (!selected.length) fail('mapping_assessment_scope_stale');
  if (coverage.sourceScopes === undefined) {
    // Compatibility for single-source assessments; multiple sources must name every scope.
    if (selected.length !== 1 || !coverage.sourceSnapshotDigest || !coverage.inventoryDigest ||
        selected[0].discoveryCoverage?.sourceSnapshotDigest !== coverage.sourceSnapshotDigest ||
        selected[0].discoveryCoverage?.inventoryDigest !== coverage.inventoryDigest) fail('mapping_assessment_scope_stale');
    return;
  }
  const scopes = coverage.sourceScopes;
  const ref = require('./mapping-field-contract').entityRef;
  if (!Array.isArray(scopes) || scopes.length !== selected.length ||
      new Set(scopes.map(s => s?.sourceEntityRef)).size !== scopes.length ||
      new Set(selected.map(ref)).size !== selected.length || selected.some(row => {
        const scope = scopes.find(s => s?.sourceEntityRef && s.sourceEntityRef === ref(row));
        return !scope?.sourceSnapshotDigest || !scope.inventoryDigest ||
          scope.sourceSnapshotDigest !== row.discoveryCoverage?.sourceSnapshotDigest ||
          scope.inventoryDigest !== row.discoveryCoverage?.inventoryDigest;
      })) fail('mapping_assessment_scope_stale');
}
function validate(plan, projectDir) {
  const assessments = plan?.operationAssessments;
  if (assessments === undefined) return [];
  if (!Array.isArray(assessments)) fail('mapping_assessment_invalid');
  const keys = new Set();
  for (const a of assessments) {
    if (!a || !REF.test(a.targetRef || '') || !/^[A-Za-z][A-Za-z0-9]*$/.test(a.operation || '') ||
        !a.coverage || a.coverage.complete !== true || !Array.isArray(a.coverage.referencePaths) || !Array.isArray(a.evidence) || !a.evidence.length || !a.contract?.dependencies ||
        !Array.isArray(a.examples) || !a.examples.length) fail('mapping_assessment_invalid');
    const key = a.targetRef + ':' + a.operation;
    if (keys.has(key)) fail('mapping_assessment_duplicate');
    keys.add(key);
    const selected = rows(plan).filter(r => r.targetRef === a.targetRef);
    validateSourceScopes(selected, a.coverage);
    const bundled = require('./dependency-proofs').bundledDomain(a.targetRef);
    const known = Object.entries(bundled.operationContracts || {}).find(([name, c]) => name === a.operation || c.aliases?.includes(a.operation));
    mergeContract(known?.[1], a.contract);
    if (!a.evidence.some(e => e.kind === 'authoritative-schema' && typeof e.revision === 'string' && e.revision)) fail('mapping_assessment_schema_missing');
    for (const e of a.evidence) artifact(projectDir, e);
    if (!a.examples.every(e => e && typeof e.id === 'string' && e.id && e.input && typeof e.input === 'object' &&
      Object.hasOwn(e, 'expected'))) fail('mapping_assessment_examples_missing');
    for (const [ref, dep] of Object.entries(a.contract.dependencies)) {
      if (!REF.test(ref) || !dep || typeof dep !== 'object' ||
          (!dep.inapplicable && (!Array.isArray(dep.guardedPaths) || !dep.guardedPaths.length)) ||
          (dep.guardedPaths || []).some(p => typeof (typeof p === 'string' ? p : p?.path) !== 'string')) fail('mapping_assessment_reference_unknown');
      if (a.dependencyModes?.[ref] !== undefined && !['per-record', 'task-complete'].includes(a.dependencyModes[ref])) fail('mapping_assessment_mode_invalid');
    }
    if (Object.keys(a.dependencyModes || {}).some(ref => !a.contract.dependencies[ref])) fail('mapping_assessment_mode_invalid');
    const paths = Object.values(a.contract.dependencies).filter(d=>!d.inapplicable).flatMap(d=>d.guardedPaths.map(p=>typeof p==='string'?p:p.path));
    if (stable([...new Set(paths)].sort())!==stable([...new Set(a.coverage.referencePaths)].sort())) fail('mapping_assessment_reference_coverage_missing');
  }
  return assessments;
}
function withPlan(plan, projectDir, fn) {
  projectDir ||= context.getStore()?.projectDir;
  if (context.getStore()?.plan === plan && context.getStore()?.projectDir === projectDir) return fn();
  const assessments = plan?.operationAssessments || [];
  if (!Array.isArray(assessments) || assessments.some(a=>!a || !REF.test(a.targetRef || ''))) fail('mapping_assessment_invalid');
  // A bad assessment belongs to its target operation. Independent targets still get
  // their own normal checks; authority persistence separately validates the whole plan.
  return context.run({ plan, projectDir, assessments, validated:new Set() }, fn);
}
function withProject(projectDir, fn) {
  const file = path.join(projectDir, 'mapping/mapping-plan.json');
  // Old plans without supplements retain their prior behavior, including missing-file diagnostics.
  let plan;
  try { plan = require('./cached-json').readJson(file, {}); }
  catch(error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Keep each consumer's existing malformed-plan diagnostic. No local assessment is
    // installed; import/transport still re-read and validate their required plan themselves.
    return context.run({plan:{},projectDir,assessments:[]},fn);
  }
  return withPlan(plan, projectDir, fn);
}
function effectiveDomain(ref, bundled) {
  const scope=context.getStore();
  const assessments = (scope?.assessments || []).filter(a => a.targetRef === ref);
  if (!assessments.length) return bundled;
  if (!scope.validated.has(ref)) { validate({...scope.plan,operationAssessments:assessments},scope.projectDir); scope.validated.add(ref); }
  const result = structuredClone(bundled);
  result.operationContracts ||= {};
  for (const a of assessments) {
    const alias = Object.entries(result.operationContracts).find(([name, c]) => name === a.operation || c.aliases?.includes(a.operation));
    const name = alias?.[0] || a.operation;
    result.operationContracts[name] = mergeContract(alias?.[1], a.contract);
    if ((bundled.dependsOn || []).some(ref=>!result.operationContracts[name].dependencies?.[ref])) fail('mapping_assessment_reference_unknown');
    // The effective digest binds the used evidence as well as the contract semantics.
    result.operationContracts[name].assessmentBinding = digest({ coverage: a.coverage, evidence: a.evidence, examples: a.examples });
    result.dependencyModes = mergeKnown(result.dependencyModes || {}, a.dependencyModes || {});
    const referenceFields = {};
    for (const [dependency, d] of Object.entries(a.contract.dependencies)) if (!d.inapplicable) {
      // Discriminator guards are proof checks, not target identity locations.
      referenceFields[dependency] = d.guardedPaths.filter(p=>typeof p==='string' || p.equals===undefined).map(p=>typeof p==='string'?p:p.path);
    }
    result.operationContracts[name].assessmentReferenceFields=referenceFields;
  }
  return result;
}
module.exports = { validate, artifact, withPlan, withProject, effectiveDomain, mergeKnown, digest, current: () => context.getStore() };
