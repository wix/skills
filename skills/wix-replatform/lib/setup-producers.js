'use strict';

// A pending producer proves executable setup exists, never that setup has already run.
function plannedProducer(plan, ref, projectDir) {
  const A = require('./operation-assessments');
  const requirements = [...(plan.setupRequirements || []), ...require('./mapping-field-contract').entityRows(plan).flatMap(r => r.setupRequirements || [])];
  for (const r of requirements) {
    if (!r || !Array.isArray(r.entityRefs) || !r.entityRefs.includes(ref) || !Array.isArray(r.evidence) || !r.evidence.length) continue;
    for (const e of r.evidence) A.artifact(projectDir, e);
    if (r.id === 'create-cms-collections' && ref === 'cms/collection' && r.collections?.length && r.collections.every(c => c.id && Array.isArray(c.fields) && c.permissions)) {
      return {kind:'pending-setup', stepId:r.id, executor:'create-cms-collections'};
    }
    const writers = require('../resources/rp-target-wix/lib/wix-writers');
    if (r.id && (writers.WRITE_BUILDERS_BY_ENTITY[ref] || []).includes(r.intent?.writerId) &&
        /^build(Get|Query)/.test(r.intent?.readWriterId || '') && typeof writers[r.intent.readWriterId] === 'function') {
      return {kind:'pending-setup', stepId:r.id, executor:r.intent.writerId};
    }
  }
  return null;
}
module.exports = {plannedProducer};
