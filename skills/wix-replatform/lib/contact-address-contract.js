'use strict';

// Contacts V5 keeps postal fields nested under the `address` object. These keys
// belong to the address item itself and are therefore the only keys allowed
// beside `address` in a V5 address item.
const V5_ADDRESS_ITEM_KEYS = new Set(['id', 'tag', 'address', 'defaultAddress', 'recipient']);
const V5_ADDRESS_KEYS = new Set([
  'addressLine', 'addressLine2', 'streetAddress', 'city', 'subdivision', 'subdivisions', 'country', 'postalCode',
]);
const V5_STREET_ADDRESS_KEYS = new Set(['number', 'name', 'apt']);

const acceptedAddressLeaves = () => [...V5_ADDRESS_KEYS].join(', ');
function invalidAddressLeaf(writePath, leaf) {
  const replacement = leaf === 'addressLine1' ? ' Use contact.addresses[].address.addressLine instead.' : '';
  return `${writePath}: "${leaf}" is not a Contacts V5 address field.${replacement} `
    + `Accepted address fields: ${acceptedAddressLeaves()}.`;
}

function contactAddressTargetPathError(writePath) {
  if (typeof writePath !== 'string') return null;
  const canonicalPath = writePath.replace(/\[\d+\]/g, '[]');
  const match = /(?:^|\.)contact\.addresses\[\]\.(.+)$/.exec(canonicalPath);
  if (!match) return null;
  const parts = match[1].split('.').map(part => part.replace(/\[\]$/, ''));
  if (!V5_ADDRESS_ITEM_KEYS.has(parts[0])) {
    return `${writePath}: Contacts V5 postal fields must be under contact.addresses[].address.*; `
      + `flat address-item field "${parts[0]}" is not an accepted target`;
  }
  if (parts[0] !== 'address' || parts.length === 1) return null;
  if (!V5_ADDRESS_KEYS.has(parts[1])) return invalidAddressLeaf(writePath, parts[1]);
  if (parts[1] === 'streetAddress') {
    if (parts.length === 2) return null;
    if (!V5_STREET_ADDRESS_KEYS.has(parts[2]) || parts.length > 3) {
      return `${writePath}: "${parts.slice(2).join('.')}" is not a Contacts V5 streetAddress field. `
        + `Accepted streetAddress fields: ${[...V5_STREET_ADDRESS_KEYS].join(', ')}.`;
    }
    return null;
  }
  return parts.length > 2 ? invalidAddressLeaf(writePath, parts.slice(1).join('.')) : null;
}

// A bad address shape is a fact about one record, found before anything is sent. The error says
// so (`requestSent: false`, a stable code), so callers hold that record with this reason and keep
// going instead of treating it as a possibly-written request or a task-wide crash.
const CONTACT_ADDRESS_SHAPE_INVALID = 'CONTACT_ADDRESS_SHAPE_INVALID';
function shapeError(message) {
  return Object.assign(new Error(message), { code: CONTACT_ADDRESS_SHAPE_INVALID, requestSent: false, outcomeKnown: true });
}

function assertContactAddressShape(contact, context = 'contact') {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact) || !Array.isArray(contact.addresses)) return contact;
  for (const [index, item] of contact.addresses.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw shapeError(`${context}.addresses[${index}] must be an object with postal fields under address`);
    }
    const flat = Object.keys(item).filter(key => !V5_ADDRESS_ITEM_KEYS.has(key));
    if (flat.length) {
      throw shapeError(
        `${context}.addresses[${index}] has flat postal field(s) ${JSON.stringify(flat)}; `
        + 'Contacts V5 requires them under addresses[].address.*',
      );
    }
    if (Object.hasOwn(item, 'address')) {
      if (!item.address || typeof item.address !== 'object' || Array.isArray(item.address)) {
        throw shapeError(`${context}.addresses[${index}].address must be an object`);
      }
      const unknownAddressKeys = Object.keys(item.address).filter(key => !V5_ADDRESS_KEYS.has(key));
      if (unknownAddressKeys.length) {
        const leaf = unknownAddressKeys[0];
        throw shapeError(invalidAddressLeaf(`${context}.addresses[${index}].address.${leaf}`, leaf));
      }
      if (Object.hasOwn(item.address, 'streetAddress')) {
        const street = item.address.streetAddress;
        if (!street || typeof street !== 'object' || Array.isArray(street)) {
          throw shapeError(`${context}.addresses[${index}].address.streetAddress must be an object`);
        }
        const unknownStreetKeys = Object.keys(street).filter(key => !V5_STREET_ADDRESS_KEYS.has(key));
        if (unknownStreetKeys.length) {
          throw shapeError(
            `${context}.addresses[${index}].address.streetAddress has unknown field(s) ${JSON.stringify(unknownStreetKeys)}; `
            + `accepted fields are ${[...V5_STREET_ADDRESS_KEYS].join(', ')}`,
          );
        }
      }
    }
  }
  return contact;
}

// The same check without throwing: the reason, or null when the shape is valid.
function contactAddressShapeError(contact, context = 'contact') {
  try { assertContactAddressShape(contact, context); return null; }
  catch (error) { if (error.code === CONTACT_ADDRESS_SHAPE_INVALID) return error.message; throw error; }
}

// One cutover item per report row whose records were held for a bad address shape (the journal
// reason the runner records). Read from the completion report's own entity rows.
function contactAddressOperatorActions(entityCompleteness) {
  return (Array.isArray(entityCompleteness) ? entityCompleteness : []).flatMap((row) => {
    const held = (row?.reasons || []).filter((reason) => reason && reason.code === CONTACT_ADDRESS_SHAPE_INVALID)
      .reduce((sum, reason) => sum + (Number.isInteger(reason.count) ? reason.count : 0), 0);
    if (!held) return [];
    return [{
      actionId: `contact-address-shape-invalid:${row.entity}`,
      code: 'contact-address-shape-invalid',
      role: 'import-operator',
      severity: 'high',
      entity: row.entity,
      affectedCount: held,
      affectedIds: [row.entity],
      artifactRefs: ['execution/completion-report.json', 'state/attempt-journal'],
      prerequisites: ['original migration project', 'source snapshot', 'current-site access'],
      action: `Requires Import Operator: ${held} ${row.entity} record(s) were held because their address is not in the Contacts V5 shape (addresses[].address.*); nothing was sent for them.`,
      importOperatorPrompt: `In the attempt journal, find the ${row.entity} rows with failure.errorCode ${CONTACT_ADDRESS_SHAPE_INVALID}. Fix the address mapping so postal fields go under addresses[].address (addressLine, not addressLine1), then rerun that task with --failed-only. Do not resend contacts that already imported.`,
      resolutionEvidence: `a later completion report shows no ${CONTACT_ADDRESS_SHAPE_INVALID} failures for ${row.entity}`,
      deadlineReason: 'these contacts are not on the new site',
    }];
  });
}

module.exports = {
  CONTACT_ADDRESS_SHAPE_INVALID,
  contactAddressOperatorActions,
  V5_ADDRESS_ITEM_KEYS,
  V5_ADDRESS_KEYS,
  V5_STREET_ADDRESS_KEYS,
  contactAddressTargetPathError,
  assertContactAddressShape,
  contactAddressShapeError,
};
