'use strict';
const ZERO = '00000000-0000-0000-0000-000000000000';
const opaqueId = id => typeof id === 'string' && id.length > 0 && id.trim() === id && id !== ZERO && !/^dry[-_]run/i.test(id);
const contactId = id => opaqueId(id) && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
// The accepted mapping declares this policy independently of source naming.
// Legacy inspected entity names remain compatible, but unknown names never opt out.
function verificationKind({ verificationKind, entity, targetEntityType } = {}) {
  if (verificationKind !== undefined) {
    if (!['contact', 'product', 'none'].includes(verificationKind)) throw new Error('verificationKind must be contact, product, or none');
    return verificationKind;
  }
  for (const name of [entity, targetEntityType]) {
    if (/^(contacts?|customers?|crm[./_-]contacts?)$/i.test(name || '')) return 'contact';
    if (/^(products?|stores[./_-]products?)$/i.test(name || '')) return 'product';
  }
  return 'required';
}
module.exports = { opaqueId, contactId, verificationKind };
