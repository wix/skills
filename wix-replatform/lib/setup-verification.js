'use strict';

// Shared by execute-setup.js (which writes setup/setup-verification.json and self-checks
// its own output before publishing it) and orchestration-router.js (which gates on it). A
// candidate file is trusted only if it passes every check here — schema shape, a genuinely
// usable plan to compare against, full coverage with no duplicate or missing ids, and a
// plan-digest match — so a hand-authored, partial, malformed, or stale file can never be
// mistaken for a genuine success receipt. See
// specs/0081-setup-verification-fail-closed-receipt.md.

const SCHEMA_VERSION = 1;

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
  return { ok: reasons.length === 0, reasons, stepIds };
}

function validateSetupVerification({ verification, plan, planDigest }) {
  if (!verification || typeof verification !== 'object') {
    return { ok: false, reasons: ['missing_or_invalid_verification'] };
  }

  const reasons = [];

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

  return { ok: reasons.length === 0, reasons };
}

module.exports = { SCHEMA_VERSION, validatePlanShape, validateSetupVerification };
