'use strict';

// Shared by execute-setup.js (which writes setup/setup-verification.json and self-checks
// its own output before publishing it) and orchestration-router.js (which gates on it). A
// candidate file is trusted only if it passes every check here — schema shape, a genuinely
// usable plan to compare against, full coverage with no duplicate or missing ids, and a
// plan-digest match — so a hand-authored, partial, malformed, or stale file can never be
// mistaken for a genuine success receipt.

const SCHEMA_VERSION = 1;
const fs = require('node:fs');
const path = require('node:path');
let reviewedReferencePaths;
function knownReferencePath(ref, targetPath) {
  if (!reviewedReferencePaths) {
    reviewedReferencePaths = new Map(); const root = path.join(__dirname, '../resources/rp-target-wix/domains');
    for (const domain of fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const entities = path.join(root, domain.name, 'entities'); if (!fs.existsSync(entities)) continue;
      for (const file of fs.readdirSync(entities).filter(file => file.endsWith('.json'))) { const definition = JSON.parse(fs.readFileSync(path.join(entities, file))); for (const [dependencyRef, paths] of Object.entries(definition.dependencyReferenceFields || {})) { if (!reviewedReferencePaths.has(dependencyRef)) reviewedReferencePaths.set(dependencyRef, new Set()); for (const value of paths) reviewedReferencePaths.get(dependencyRef).add(value); } }
    }
  }
  return reviewedReferencePaths.get(ref)?.has(targetPath) === true;
}

// Collects each item's `id`, flagging (via callbacks, not thrown errors — callers decide how
// severe a given issue is) any item with a missing/non-string id or a duplicate of an id
// already seen. Duplicate ids are dropped from the returned list entirely, never silently
// treated as "one occurrence satisfies both".
function normalizeIds(items, { onMissing, onDuplicate }) {
  const ids = [];
  const seen = new Set();
  for (const item of items) {
    const id = item && item.id;
    if (!id || typeof id !== 'string') {
      onMissing(item);
      continue;
    }
    if (seen.has(id)) {
      onDuplicate(id);
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// A plan with no genuinely usable `steps` array (missing entirely, not an array, or the
// plan itself isn't an object) can never be treated as "zero requirements" — that would let
// a malformed plan vacuously satisfy an empty receipt. Reject it outright instead.
function validatePlanShape(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) {
    return { ok: false, reasons: ['plan_missing_or_invalid'], stepIds: [] };
  }
  const reasons = [];
  if (plan.schemaVersion !== SCHEMA_VERSION) reasons.push('plan_schema_version_mismatch');
  const stepIds = normalizeIds(plan.steps, {
    onMissing: () => reasons.push('plan_step_missing_id'),
    onDuplicate: (id) => reasons.push(`plan_duplicate_step_id:${id}`),
  });
  const allKeys = new Set();
  for (const step of plan.steps) for (const key of step.referenceKeys || []) for (const targetPath of key.paths || []) { const identity = key.ref + ':' + key.sourceStableKey + ':' + targetPath; if (!(step.entityRefs || []).includes(key.ref) || !knownReferencePath(key.ref, targetPath) || allKeys.has(identity)) reasons.push('plan_reference_invalid:' + step.id); allKeys.add(identity); }
  return { ok: reasons.length === 0, reasons, stepIds };
}

// `rp-execute-setup/scripts/execute-setup.js` reads requirements at every
// consumer as `Array.isArray(x) ? x : x?.requirements`, so exactly two shapes are usable: a
// bare array, or a non-array object whose `requirements` is an array. Anything else (an
// object carrying only `items`, or neither key) is one the executor silently treats as "no
// requirements"; the router blocks it instead. `schemaVersion` is not read.
function validateSetupRequirementsShape(value) {
  if (Array.isArray(value)) return { ok: true, errors: [] };
  if (value && typeof value === 'object' && Array.isArray(value.requirements)) return { ok: true, errors: [] };
  return { ok: false, errors: ['setup requirements must be an array or an object with a requirements array'] };
}

function validateSetupVerification({ verification, plan, planDigest, siteId }) {
  if (!verification || typeof verification !== 'object') {
    return { ok: false, reasons: ['missing_or_invalid_verification'] };
  }

  const reasons = [];
  if (siteId && !verification.siteId) reasons.push('site_id_missing');
  else if (siteId && verification.siteId !== siteId) reasons.push('site_id_mismatch');

  if (verification.schemaVersion !== SCHEMA_VERSION) {
    reasons.push('schema_version_mismatch');
  }
  if (!Array.isArray(verification.requirements)) {
    return { ok: false, reasons: [...reasons, 'missing_requirements_array'] };
  }

  const planShape = validatePlanShape(plan);
  if (planShape.reasons.includes('plan_missing_or_invalid')) {
    // No usable plan to compare coverage against at all — never fall back to "nothing was
    // required, so an empty receipt counts as full coverage".
    return { ok: false, reasons: [...reasons, ...planShape.reasons] };
  }
  reasons.push(...planShape.reasons);

  const nonPassed = verification.requirements.filter((requirement) => !requirement || requirement.status !== 'passed');
  for (const requirement of nonPassed) {
    reasons.push(`non_passed_requirement:${(requirement && requirement.id) || 'unknown'}`);
  }

  const verifiedIds = normalizeIds(verification.requirements, {
    onMissing: () => reasons.push('verification_requirement_missing_id'),
    onDuplicate: (id) => reasons.push(`duplicate_verification_requirement:${id}`),
  });

  const planIdSet = new Set(planShape.stepIds);
  const verifiedIdSet = new Set(verifiedIds);
  for (const id of planIdSet) {
    if (!verifiedIdSet.has(id)) reasons.push(`missing_requirement:${id}`);
  }
  for (const id of verifiedIdSet) {
    if (!planIdSet.has(id)) reasons.push(`unexpected_requirement:${id}`);
  }

  if (!planDigest) {
    reasons.push('plan_digest_unavailable');
  } else if (verification.planDigest !== planDigest) {
    reasons.push('plan_digest_mismatch');
  }

  for (const step of plan.steps) {
    const requirement = verification.requirements.find(row => row.id === step.id);
    reasons.push(...validateReferenceBindings(step, requirement?.referenceBindings));
  }
  return { ok: reasons.length === 0, reasons };
}

function validateReferenceBindings(step, bindings) {
  const declarations = step.referenceKeys || [], errors = [], seen = new Set();
  if (!Array.isArray(declarations) || bindings !== undefined && !Array.isArray(bindings)) return ['setup_reference_shape_invalid'];
  for (const declaration of declarations) {
    if (!(step.entityRefs || []).includes(declaration.ref) || !declaration.sourceStableKey || !Array.isArray(declaration.paths) || !declaration.paths.length || new Set(declaration.paths).size !== declaration.paths.length) errors.push('setup_reference_declaration_invalid:' + step.id);
    const matches = (bindings || []).filter(row => row.ref === declaration.ref && row.sourceStableKey === declaration.sourceStableKey);
    if (matches.length !== 1) { errors.push('setup_reference_coverage:' + step.id); continue; }
    const row = matches[0];
    if (typeof row.targetId !== 'string' || !row.targetId || !row.values || JSON.stringify(Object.keys(row.values).sort()) !== JSON.stringify([...declaration.paths].sort()) || Object.values(row.values).some(value => typeof value !== 'string' || !value)) errors.push('setup_reference_values_invalid:' + step.id);
    for (const targetPath of declaration.paths) { if (!knownReferencePath(declaration.ref, targetPath)) errors.push('setup_reference_path_unknown:' + step.id); const key = declaration.ref + ':' + declaration.sourceStableKey + ':' + targetPath; if (seen.has(key)) errors.push('setup_reference_duplicate:' + step.id); seen.add(key); }
  }
  for (const binding of bindings || []) if (!declarations.some(row => row.ref === binding.ref && row.sourceStableKey === binding.sourceStableKey)) errors.push('setup_reference_unexpected:' + step.id);
  return errors;
}

module.exports = { validateReferenceBindings, SCHEMA_VERSION, validatePlanShape, validateSetupRequirementsShape, validateSetupVerification };
