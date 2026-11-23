'use strict';

const COLLECTION_PERMISSION_KEYS = Object.freeze(['read', 'insert', 'update', 'remove']);
const { archiveCollectionIdMatchesSource, isWixCollectionId } = require('./cms-collection-id.js');

// Mapping uses a named preset, while Wix Data's REST API requires the expanded
// permissions object. Keep the translation at the request boundary so every
// collection kind gets the same wire shape, including older generated plans.
const CMS_PERMISSION_PRESETS = Object.freeze({
  'migration-internal': Object.freeze({ read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' }),
});

function valueKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function invalidCollectionRequest(path, errors) {
  const message = `CMS collection request invalid: ${errors.join('; ')}`;
  return Object.assign(new Error(message), {
    code: 'CMS_COLLECTION_REQUEST_INVALID',
    blockerCode: 'CMS_COLLECTION_REQUEST_INVALID',
    recommendedAction: 'Regenerate the CMS collection requirement with an object-shaped permissions and field definition, then re-run setup.',
    fields: errors.map((error) => `${path || 'collection'}: ${error}`),
  });
}

function normalizePermissions(value, path) {
  if (typeof value === 'string') {
    const preset = CMS_PERMISSION_PRESETS[value];
    if (preset) return { ...preset };
    throw invalidCollectionRequest(path, [`${path}: expected an object or known preset "migration-internal", received string "${value}"`]);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidCollectionRequest(path, [`${path}: expected an object with read, insert, update and remove, received ${valueKind(value)}`]);
  }
  const missing = COLLECTION_PERMISSION_KEYS.filter((key) => typeof value[key] !== 'string' || !value[key].trim());
  if (missing.length) {
    throw invalidCollectionRequest(path, [`${path}: missing or invalid permission field(s): ${missing.join(', ')}`]);
  }
  return Object.fromEntries(COLLECTION_PERMISSION_KEYS.map((key) => [key, value[key]]));
}

function normalizeField(field, path) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw invalidCollectionRequest(path, [`${path}: expected an object, received ${valueKind(field)}`]);
  }
  if (typeof field.key !== 'string' || !field.key.trim()) {
    throw invalidCollectionRequest(path, [`${path}.key: expected a non-empty string`]);
  }
  const hasType = Object.hasOwn(field, 'type');
  const hasFieldType = Object.hasOwn(field, 'fieldType');
  if (hasType && hasFieldType && field.type !== field.fieldType) {
    throw invalidCollectionRequest(path, [`${path}.type and ${path}.fieldType: expected matching values`]);
  }
  const type = hasType ? field.type : field.fieldType;
  if (typeof type !== 'string' || !type.trim()) {
    throw invalidCollectionRequest(path, [`${path}.type: expected a non-empty string`]);
  }
  if (field.displayName !== undefined && typeof field.displayName !== 'string') {
    throw invalidCollectionRequest(path, [`${path}.displayName: expected a string, received ${valueKind(field.displayName)}`]);
  }
  if (field.required !== undefined && typeof field.required !== 'boolean') {
    throw invalidCollectionRequest(path, [`${path}.required: expected a boolean, received ${valueKind(field.required)}`]);
  }
  if (field.typeMetadata !== undefined && (!field.typeMetadata || typeof field.typeMetadata !== 'object' || Array.isArray(field.typeMetadata))) {
    throw invalidCollectionRequest(path, [`${path}.typeMetadata: expected an object, received ${valueKind(field.typeMetadata)}`]);
  }
  const { fieldType: _fieldType, ...normalized } = field;
  return { ...normalized, type };
}

function normalizeCmsCollectionDefinition(collection, { path = 'collection', sourceEntity = null } = {}) {
  if (!collection || typeof collection !== 'object' || Array.isArray(collection)) {
    throw invalidCollectionRequest(path, [`${path}: expected an object, received ${valueKind(collection)}`]);
  }
  if (!isWixCollectionId(collection.id)) {
    throw invalidCollectionRequest(path, [`${path}.id: expected 1-36 letters, numbers, _ or -, received ${JSON.stringify(collection.id)}`]);
  }
  if (typeof sourceEntity === 'string' && sourceEntity.trim() && !archiveCollectionIdMatchesSource(collection.id, sourceEntity)) {
    throw invalidCollectionRequest(path, [`${path}.id: must be derived from source entity ${sourceEntity}`]);
  }
  if (collection.displayName !== undefined && typeof collection.displayName !== 'string') {
    throw invalidCollectionRequest(path, [`${path}.displayName: expected a string, received ${valueKind(collection.displayName)}`]);
  }
  if (!Array.isArray(collection.fields)) {
    throw invalidCollectionRequest(path, [`${path}.fields: expected an array, received ${valueKind(collection.fields)}`]);
  }
  const fields = collection.fields.map((field, index) => normalizeField(field, `${path}.fields[${index}]`));
  const permissions = normalizePermissions(collection.permissions, `${path}.permissions`);
  return { ...collection, fields, permissions };
}

module.exports = { CMS_PERMISSION_PRESETS, normalizeCmsCollectionDefinition, isWixCollectionId };
