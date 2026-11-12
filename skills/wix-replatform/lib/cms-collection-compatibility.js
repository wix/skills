'use strict';
const {canonical}=require('./mapping-field-contract.js');
function plannedMetadataMatches(actual,expected) {
  if (expected===undefined || expected===null) return true;
  if (Array.isArray(expected) || typeof expected!=='object') return canonical(actual)===canonical(expected);
  return actual && typeof actual==='object' && Object.entries(expected).every(([k,v])=>plannedMetadataMatches(actual[k],v));
}
// REST DataCollection/Field/Permissions shapes, not an SDK object or a list-ID hit.
function collectionCompatibility(actual, expected) {
  const problems=[];
  if (!actual || actual.id!==expected.id) problems.push('collection identity missing/mismatched');
  if (!actual?.permissions || !expected.permissions || ['read','insert','update','remove'].some(k=>!expected.permissions[k] || actual.permissions[k]!==expected.permissions[k])) problems.push('permissions missing/mismatched');
  const fields=new Map((actual?.fields || []).map(f=>[f.key,f]));
  for (const want of expected.fields || []) {
    const found=fields.get(want.key);
    if (!found || found.type!==want.type || Boolean(found.required)!==Boolean(want.required) || found.readOnly===true || found.immutable===true ||
      !plannedMetadataMatches(found.typeMetadata,want.typeMetadata)) problems.push(`field ${want.key} is missing/incompatible`);
  }
  if ((actual?.fields || []).some(f=>f.required && !f.systemField && !(expected.fields || []).some(w=>w.key===f.key))) problems.push('additional required fields need an explicit mapping');
  return {ok:problems.length===0,problems};
}
function assertCollectionCompatibility(actual, expected) {
  const result=collectionCompatibility(actual,expected);
  if (!result.ok) throw Object.assign(new Error(`CMS collection ${expected.id}: ${result.problems.join('; ')}`),{
    blockerCode:'CMS_COLLECTION_INCOMPATIBLE',recommendedAction:'Inspect the existing definition and revise mapping/setup through the current review. Do not delete or recreate the collection.'});
}
module.exports={collectionCompatibility,assertCollectionCompatibility};
