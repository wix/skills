'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const CLASSES = ['missing-knowledge','missing-writer','target-limitation','source-ambiguity','conflicting-knowledge'];
const OUTCOMES = ['resolved-mapping','deferred-field','deferred-record','verified-repair'];
const LEVELS = ['schema-reviewed','mapping-examples','read-back','not-verified'];
const KEYS = ['findingClass','targetRef','operation','toolkitVersion','outcome','verificationLevel','affectedCount'];
function publicOperation(targetRef, operation) {
  if (targetRef === 'unregistered' && operation === 'unregistered') return true;
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(targetRef || '')) return false;
  let k;
  try { const [domain,entity] = targetRef.split('/'); k = JSON.parse(fs.readFileSync(path.join(__dirname,'../../rp-target-wix/domains',domain,'entities',entity+'.json'))); } catch { return false; }
  const writers = require('../../rp-target-wix/lib/wix-writers');
  return operation === k.preferredWrite?.writerId || (writers.WRITE_BUILDERS_BY_ENTITY[targetRef] || []).includes(operation) ||
    Object.entries(k.operationContracts || {}).some(([name,c]) => name === operation || c.aliases?.includes(operation)) ||
    (['sendGuardedRawRequest','buildGuardedRawRequest'].includes(operation) && require('../../../lib/target-import-support').rawRequestEntity(targetRef)) ||
    require('../../../lib/target-import-support').alternateWriter(targetRef, operation)?.ok === true;
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !KEYS.includes(k)) || KEYS.some(k => !Object.hasOwn(input,k)) ||
      !CLASSES.includes(input.findingClass) || !OUTCOMES.includes(input.outcome) || !LEVELS.includes(input.verificationLevel) ||
      !publicOperation(input.targetRef,input.operation) || !/^(unknown|\d+\.\d+\.\d+)$/.test(input.toolkitVersion) ||
      !(input.affectedCount === null || Number.isSafeInteger(input.affectedCount) && input.affectedCount >= 0) ||
      (input.outcome === 'verified-repair' && input.verificationLevel !== 'read-back')) throw new Error('knowledge_observation_invalid');
  const result = Object.fromEntries(KEYS.map(k => [k,input[k]]));
  return {...result, schemaVersion:1, signature:crypto.createHash('sha256').update(JSON.stringify([result.findingClass,result.targetRef,result.operation])).digest('hex')};
}
function event(input) {
  const safe = {...input};
  if (!publicOperation(safe.targetRef,safe.operation)) { safe.targetRef='unregistered'; safe.operation='unregistered'; }
  return {event_type:'skill_coverage_gap',subtype:safe.findingClass==='conflicting-knowledge'?'ambiguous_instruction':'path_not_covered',
    stage:safe.outcome==='verified-repair'?'import':'mapping',skill:safe.outcome==='verified-repair'?'rp-execute-import':'rp-mapper',severity:'degraded',
    what_happened:'A mapping knowledge observation was recorded.',knowledge_observation:safe};
}
module.exports = {validate,event,publicOperation};
