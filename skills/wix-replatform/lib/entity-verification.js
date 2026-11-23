'use strict';
const ZERO = '00000000-0000-0000-0000-000000000000';
const opaqueId = id => typeof id === 'string' && id.length > 0 && id.trim() === id && id !== ZERO && !/^dry[-_]run/i.test(id);
const contactId = id => opaqueId(id) && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
// The one list of declarable verification kinds. `import-contract-verify` checks generated code
// through `verificationKind` below, so it refuses exactly what the completion report would.
const VERIFICATION_KINDS = Object.freeze(['contact', 'product', 'none']);
// The accepted mapping declares this policy independently of source naming.
// Legacy inspected entity names remain compatible, but unknown names never opt out.
function verificationKind({ verificationKind, entity, targetEntityType } = {}) {
  if (verificationKind !== undefined) {
    if (!VERIFICATION_KINDS.includes(verificationKind)) throw new Error('verificationKind must be contact, product, or none');
    return verificationKind;
  }
  for (const name of [entity, targetEntityType]) {
    if (/^(contacts?|customers?|crm[./_-]contacts?)$/i.test(name || '')) return 'contact';
    if (/^(products?|stores[./_-]products?)$/i.test(name || '')) return 'product';
  }
  return 'required';
}
// The policy of a row the toolkit's own completion step builds for an import task's target ref.
// A task may declare it (`verificationKind`, as the source-archive task does). Otherwise a contact or
// product ref keeps its receipt kind, and every other ref is `none`: those writers verify each write
// themselves (their unverified writes count as unresolved) and no receipt kind exists for them, so
// `required` could never be met: every such kind of the completion report said "verification not
// recorded".
function importVerificationKind(ref, task = null) {
  if (task && task.verificationKind !== undefined) return verificationKind({ verificationKind: task.verificationKind });
  const kind = verificationKind({ targetEntityType: ref });
  return kind === 'required' ? 'none' : kind;
}
module.exports = { VERIFICATION_KINDS, opaqueId, contactId, verificationKind, importVerificationKind };
