'use strict';

const crypto = require('node:crypto');

// The Data Extension Schema (DES) path for the three objects the supported-target matrix
// admits -- eCommerce ORDER (shipped first), stores PRODUCT, and CRM CONTACT on the default
// Contacts V5 surface -- and nothing else. Checkout, Bookings, Booking Services and every nested
// order subrecord are refused before any network call: add one only when a mapping needs it and
// it has been verified live the way the order path was. The legacy Contacts V4 path is a
// different API (CRM Extended Fields) and lives in contact-extended-fields.js; the two surfaces
// are never mixed.
//
// Contacts caveat: the DES supported-objects table still omits contacts, so the V5 contact target
// is marked `requiresLiveVerification`. The transport fails closed with CONTACTS_V5_DES_UNVERIFIED
// when the gating List call is refused, and never falls back to V4.
//
// WHY A MERGE HELPER EXISTS AT ALL. Re-checked against the live schema 2026-09-03: Update Data
// Extension Schema is a PUT that, in the API's own words, "updates a user-defined data extension
// schema, OVERRIDING the existing data". `jsonSchema` is required and replaces what was there. So
// a setup step that PUTs only the fields the migration needs DELETES every field the merchant
// created. Merging is not a refinement of this contract, it is the contract -- and the failure it
// prevents is silent, permanent and on the merchant's own data.
//
// The rest of the shape, same re-check:
//   * List is GET /schema-service/v1/schemas?fqdn=&namespaces=&fields=ARCHIVED, and it returns
//     GLOBAL and user-defined schemas together, so the `_user_fields` one must be selected by
//     namespace rather than by position.
//   * Archived fields are hidden unless `fields=ARCHIVED` is requested. A key that collides with
//     an archived field cannot be reused, so the read must ask for them or the collision check is
//     blind.
//   * Update requires `id` and the CURRENT `revision`; id, fqdn and namespace are immutable.
//   * The namespace carries a byte budget: `maxLimitBytes` (10,000 observed) against
//     `currentSizeBytes`, shared with whatever the merchant already stores there.
//   * The eCommerce order object does NOT support filtering (the supported-objects table says so
//     for `wix.ecom.*.order`), so `x-wix-filterable` is refused for it rather than passed through.

const SCHEMA_SERVICE = 'https://www.wixapis.com/schema-service/v1/schemas';

const USER_FIELDS_NAMESPACE = '_user_fields';

// The supported target matrix, no more. `supportsFiltering` follows the DES
// supported-objects table (Products: yes; Orders: no). Contacts are absent from that table, so
// filtering is treated as unsupported rather than assumed.
const CONTACTS_FQDN = 'wix.contacts.*.contact';
const SUPPORTED_TARGETS = {
  'wix.ecom.*.order': { targetRef: 'ecom/order', supportsFiltering: false },
  'wix.stores.catalog.*.product': { targetRef: 'stores/product', supportsFiltering: true },
  [CONTACTS_FQDN]: { targetRef: 'crm/contact', supportsFiltering: false, contactWriteSurface: 'contacts-v5', requiresLiveVerification: true },
};

// Known DES objects that are deliberately OUT of this phase. Named so the refusal says why.
const OUT_OF_SCOPE_TARGETS = new Set([
  'wix.ecom.*.checkout',
  'wix.bookings.*.booking',
  'wix.bookings.services.*.service',
]);

// Deliberately just `string`. The full Wix JSON Schema type and format table has not been
// re-verified for this slice, and shipping a guessed type list is how an unsupported type reaches
// a live setup call. Widening this set means reading the JSON Schema article first.
const VERIFIED_FIELD_TYPES = new Set(['string']);

// Same reasoning as the type set: the format table has not been re-verified, so nothing is
// accepted until it is. The two order invoice fields are plain strings and need no format.
const VERIFIED_STRING_FORMATS = new Set();

const PERMISSION_IDENTITIES = new Set(['apps', 'owning-app', 'users', 'users-of-users']);

const PERMISSION_PRESETS = {
  // A migration-owned field is not visitor-facing: `users-of-users` is site visitors, and this
  // data exists for the merchant and the migration, so it is left out.
  'migration-internal': { read: ['apps', 'users'], write: ['users'] },
};

function fail(errors, code, detail) {
  errors.push({ code, detail });
  return errors;
}

function validateExtendedFieldIntent(field, { fqdn } = {}) {
  const errors = [];
  if (!field || typeof field !== 'object') {
    return { valid: false, errors: fail([], 'field-not-an-object', 'a field intent must be an object') };
  }
  if (!field.key || typeof field.key !== 'string') {
    fail(errors, 'missing-field-key', 'a field intent needs a key');
  } else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field.key)) {
    fail(errors, 'invalid-field-key', `"${field.key}" is not a usable JSON Schema property name`);
  }
  if (!field.fieldType) {
    fail(errors, 'missing-field-type', `field "${field.key}" has no fieldType`);
  } else if (!VERIFIED_FIELD_TYPES.has(field.fieldType)) {
    fail(errors, 'unverified-field-type', `fieldType "${field.fieldType}" is not verified for this slice; only ${[...VERIFIED_FIELD_TYPES].join(', ')} is`);
  }
  if (field.format) {
    if (field.fieldType !== 'string') {
      fail(errors, 'format-type-mismatch', `format "${field.format}" cannot apply to fieldType "${field.fieldType}"`);
    } else if (!VERIFIED_STRING_FORMATS.has(field.format)) {
      // Accepting any string as a format let an unsupported one reach a live setup call.
      fail(errors, 'unverified-field-format', `format "${field.format}" is not verified for this slice`);
    }
  }
  if (field.filterable === true) {
    const target = SUPPORTED_TARGETS[fqdn];
    if (!target || target.supportsFiltering === false) {
      fail(errors, 'filterable-unsupported-target', `${fqdn || 'this target'} does not support filtering, so x-wix-filterable cannot be requested`);
    }
  }
  // LIVE-VERIFIED 2026-09-04: the API rejects a string field with no `maxLength` --
  // `MANDATORY_FIELD_MISSING: <key>.maxLength`. It is required, not optional, so a field intent
  // without one cannot be provisioned at all.
  if (field.fieldType === 'string' && field.maxLength === undefined) {
    fail(errors, 'missing-max-length', `field "${field.key}" needs a maxLength; the API rejects a string field without one`);
  }
  if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1)) {
    fail(errors, 'invalid-max-length', `field "${field.key}" has a non-positive maxLength`);
  }

  const permissions = resolvePermissions(field);
  if (!permissions) {
    fail(errors, 'unknown-permissions-preset', `field "${field.key}" names no known permissionsPreset and supplies no explicit permissions`);
  } else {
    for (const identity of [...(permissions.read || []), ...(permissions.write || [])]) {
      if (!PERMISSION_IDENTITIES.has(identity)) {
        fail(errors, 'unknown-permission-identity', `"${identity}" is not a permission identity`);
      }
    }
    // Reading as a visitor without reading as a user is incoherent, and the asymmetry is how a
    // field ends up visible on a storefront but invisible to the merchant who owns it.
    if ((permissions.read || []).includes('users-of-users') && !(permissions.read || []).includes('users')) {
      fail(errors, 'visitor-read-without-user-read', `field "${field.key}" grants users-of-users read without users read`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function resolvePermissions(field) {
  if (field.permissions) return field.permissions;
  if (field.permissionsPreset) return PERMISSION_PRESETS[field.permissionsPreset] || null;
  return null;
}

function buildExtendedFieldSchemaProperty(field) {
  const property = { type: field.fieldType };
  if (field.maxLength !== undefined) property.maxLength = field.maxLength;
  if (field.format) property.format = field.format;
  if (field.description) property.description = field.description;
  const permissions = resolvePermissions(field);
  if (permissions) property['x-wix-permissions'] = { read: [...permissions.read], write: [...permissions.write] };
  if (field.pii === true) property['x-wix-pii'] = true;
  if (field.filterable === true) property['x-wix-filterable'] = true;
  // Business Manager lists these as toggleable order columns, so the KEY becomes the column
  // heading unless something friendlier is supplied. `replatformSourceInvoiceFileId` is not a
  // heading a merchant should have to read.
  //
  // LIVE-VERIFIED 2026-09-05: the display keyword is plain JSON Schema `title`/`description`.
  // The `x-wix-display` object the docs' own vocabulary defines -- with `label`, `hint` and
  // `placeholder` -- is REJECTED outright by the schema service:
  // `UNKNOWN_KEYWORD_AT_THIS_LEVEL: <field>.x-wix-display.label`. Do not reinstate it from the
  // documentation; it does not work on a user-defined schema.
  if (field.displayName) property.title = field.displayName;
  if (field.hint) property.description = field.hint;
  return property;
}

function buildDataExtensionSchema({ fields = [] } = {}) {
  const properties = {};
  for (const field of fields) properties[field.key] = buildExtendedFieldSchemaProperty(field);
  return { type: 'object', additionalProperties: false, properties };
}

function validateDataExtensionSchemaRequirement(requirement) {
  const errors = [];
  if (!requirement || requirement.kind !== 'extendedFieldSchema') {
    fail(errors, 'not-an-extended-field-requirement', 'requirement.kind must be "extendedFieldSchema"');
    return { valid: false, errors };
  }
  if (requirement.schemaKind !== 'data-extension-schema') {
    fail(errors, 'unsupported-schema-kind', `this helper implements data-extension-schema only, not "${requirement.schemaKind}"`);
  }
  const target = SUPPORTED_TARGETS[requirement.fqdn];
  if (!target) {
    const why = OUT_OF_SCOPE_TARGETS.has(requirement.fqdn)
      ? 'it is a known Data Extension Schema object but outside the supported target matrix'
      : 'it is not a verified Data Extension Schema target';
    fail(errors, 'unsupported-target-object', `${requirement.fqdn} is refused: ${why}`);
  } else if (requirement.extensionPoint) {
    // Nested subrecord fields need an extension point nobody has verified yet.
    fail(errors, 'unsupported-target-object', `${requirement.fqdn} extension point "${requirement.extensionPoint}" is a nested subrecord, which this phase does not provision`);
  }
  if (requirement.targetRef && target && requirement.targetRef !== target.targetRef) {
    fail(errors, 'target-ref-mismatch', `targetRef "${requirement.targetRef}" does not match ${requirement.fqdn} (${target.targetRef})`);
  }
  // Surfaces must not be mixed: a DES requirement is the V5 contact surface or no contact at all.
  if (requirement.contactWriteSurface !== undefined) {
    if (requirement.fqdn !== CONTACTS_FQDN) {
      fail(errors, 'contact-surface-on-non-contact', `contactWriteSurface is only meaningful for ${CONTACTS_FQDN}`);
    } else if (requirement.contactWriteSurface !== 'contacts-v5') {
      fail(errors, 'contact-surface-mismatch', `a data-extension-schema contact requirement is the contacts-v5 surface; "${requirement.contactWriteSurface}" belongs to crm-contact-extended-field`);
    }
  }
  // A migration-owned field belongs in the site-owner namespace. An app namespace would need a
  // declared app-defined schema dependency, and this slice creates no app.
  if (requirement.namespace !== USER_FIELDS_NAMESPACE) {
    fail(errors, 'namespace-not-user-fields', `migration-owned fields live in ${USER_FIELDS_NAMESPACE}, not "${requirement.namespace}"`);
  }
  if (!Array.isArray(requirement.fields) || requirement.fields.length === 0) {
    fail(errors, 'no-fields-declared', 'a requirement with no fields provisions nothing');
  } else {
    for (const field of requirement.fields) {
      const result = validateExtendedFieldIntent(field, { fqdn: requirement.fqdn });
      for (const error of result.errors) errors.push(error);
      const expectedWritePath = `extendedFields.namespaces.${requirement.namespace}.${field.key}`;
      if (field.writePath && field.writePath !== expectedWritePath) {
        fail(errors, 'write-path-mismatch', `field "${field.key}" declares writePath "${field.writePath}" but its value lands at "${expectedWritePath}"`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function buildListDataExtensionSchemasRequest({ fqdn, namespace = USER_FIELDS_NAMESPACE, includeArchived = true } = {}) {
  const params = new URLSearchParams();
  params.set('fqdn', fqdn);
  if (namespace) params.append('namespaces', namespace);
  // Archived fields are hidden by default, and an archived key cannot be reused -- so the
  // collision check is only meaningful when they are requested.
  if (includeArchived) params.append('fields', 'ARCHIVED');
  return { method: 'GET', url: `${SCHEMA_SERVICE}?${params.toString()}` };
}

// List returns global schemas alongside user-defined ones. Selecting by position would merge the
// migration's fields into somebody else's schema.
function selectUserFieldsSchema(response, { fqdn, namespace = USER_FIELDS_NAMESPACE } = {}) {
  const schemas = (response && response.dataExtensionSchemas) || [];
  return schemas.find((schema) => schema.fqdn === fqdn && schema.namespace === namespace) || null;
}

function archivedKeys(jsonSchema) {
  const properties = (jsonSchema && jsonSchema.properties) || {};
  return Object.keys(properties).filter((key) => properties[key] && properties[key]['x-wix-archived'] === true);
}

function detectDataExtensionSchemaBreakingChanges(existingJsonSchema, fields = []) {
  const existing = (existingJsonSchema && existingJsonSchema.properties) || {};
  const archived = new Set(archivedKeys(existingJsonSchema));
  const changes = [];

  for (const field of fields) {
    if (archived.has(field.key)) {
      changes.push({ code: 'archived-key-collision', key: field.key, detail: `"${field.key}" exists as an archived field and its key cannot be reused` });
      continue;
    }
    const current = existing[field.key];
    if (!current) continue;

    if (current.type !== field.fieldType) {
      changes.push({ code: 'field-type-change', key: field.key, detail: `"${field.key}" exists as ${current.type} and the requirement asks for ${field.fieldType}` });
    }
    if (field.pii === true && current['x-wix-pii'] !== true) {
      changes.push({ code: 'pii-added-to-existing-field', key: field.key, detail: `"${field.key}" already exists without a PII classification, which cannot be added afterwards` });
    }
    if (typeof current.maxLength === 'number' && typeof field.maxLength === 'number' && field.maxLength < current.maxLength) {
      changes.push({ code: 'validation-tightened', key: field.key, detail: `"${field.key}" would narrow maxLength from ${current.maxLength} to ${field.maxLength}, which can invalidate stored values` });
    }
  }
  return { breaking: changes.length > 0, changes };
}

// The merge. Every existing property survives untouched -- including archived ones and anything
// the merchant added -- and only absent keys are introduced.
function mergeDataExtensionSchema(existingJsonSchema, fields = []) {
  const existing = (existingJsonSchema && existingJsonSchema.properties) || {};
  const merged = { ...existing };
  const added = [];
  const unchanged = [];
  const relabelled = [];

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(existing, field.key)) {
      // The field is already there. Its TYPE and constraints stay exactly as stored -- changing
      // those is a breaking change and is refused elsewhere -- but display metadata is
      // presentation only, and a label added after the field was created must still reach it.
      // Without this the merge could never improve a column heading it had already written.
      const wanted = buildExtendedFieldSchemaProperty(field);
      const current = existing[field.key];
      const displayOf = (property) => JSON.stringify([property.title || null, property.description || null]);
      if ((wanted.title || wanted.description) && displayOf(current) !== displayOf(wanted)) {
        merged[field.key] = { ...current, ...(wanted.title ? { title: wanted.title } : {}), ...(wanted.description ? { description: wanted.description } : {}) };
        relabelled.push(field.key);
      } else {
        unchanged.push(field.key);
      }
      continue;
    }
    merged[field.key] = buildExtendedFieldSchemaProperty(field);
    added.push(field.key);
  }

  const preserved = Object.keys(existing);
  // Carry the WHOLE existing schema forward and touch only `properties`. Rebuilding it from
  // `type` + `properties` dropped every other top-level keyword -- `required`, `$schema`, `$id`,
  // `title` -- and forced `additionalProperties: false` over whatever was there. Since Update is
  // a PUT that overrides stored data, that is the same clobber this merge exists to prevent, one
  // level up from the fields.
  const base = existingJsonSchema ? { ...existingJsonSchema } : {};
  base.properties = merged;
  if (base.type === undefined) base.type = 'object';
  if (base.additionalProperties === undefined) base.additionalProperties = false;
  return {
    jsonSchema: base,
    added,
    unchanged,
    relabelled,
    preserved,
  };
}

function buildCreateDataExtensionSchemaRequest({ fqdn, namespace = USER_FIELDS_NAMESPACE, jsonSchema }) {
  return {
    method: 'POST',
    url: SCHEMA_SERVICE,
    body: { dataExtensionSchema: { fqdn, namespace, jsonSchema } },
  };
}

function buildUpdateDataExtensionSchemaRequest({ schemaId, revision, mergedSchema }) {
  if (!schemaId) throw new Error('updating a data extension schema needs its id');
  if (revision === undefined || revision === null || revision === '') {
    // Without the current revision the PUT either fails or clobbers a concurrent change.
    throw new Error('updating a data extension schema needs the CURRENT revision; the API uses it to reject conflicting changes');
  }
  if (!mergedSchema || !mergedSchema.properties) {
    throw new Error('updating a data extension schema needs the full merged jsonSchema; this PUT overrides whatever is stored');
  }
  return {
    method: 'PUT',
    url: SCHEMA_SERVICE,
    body: { dataExtensionSchema: { id: schemaId, revision: String(revision), jsonSchema: mergedSchema } },
  };
}

// One decision function, so the caller cannot accidentally skip the collision or budget checks.
function planDataExtensionSchemaProvisioning({ requirement, existingSchema = null, approvedBreakingChanges = false } = {}) {
  const validation = validateDataExtensionSchemaRequirement(requirement);
  if (!validation.valid) {
    return { action: 'blocked', blocking: validation.errors, request: null };
  }

  const fields = requirement.fields;
  if (!existingSchema) {
    const jsonSchema = buildDataExtensionSchema({ fields });
    // No schema yet means no listed `maxLimitBytes` to check against, so the create path uses the
    // limit observed on the live API. Without this an oversized first schema reached POST.
    const budget = checkSizeBudget({ maxLimitBytes: OBSERVED_NAMESPACE_MAX_LIMIT_BYTES, currentSizeBytes: 0 }, jsonSchema);
    if (budget) {
      return { action: 'blocked', blocking: [budget], request: null };
    }
    return {
      action: 'create',
      blocking: [],
      added: fields.map((field) => field.key),
      unchanged: [],
      preserved: [],
      jsonSchema,
      request: buildCreateDataExtensionSchemaRequest({ fqdn: requirement.fqdn, namespace: requirement.namespace, jsonSchema }),
    };
  }

  const breaking = detectDataExtensionSchemaBreakingChanges(existingSchema.jsonSchema, fields);
  if (breaking.breaking && approvedBreakingChanges !== true) {
    return {
      action: 'blocked',
      blocking: breaking.changes.map((change) => ({ code: change.code, detail: change.detail })),
      request: null,
    };
  }

  const merged = mergeDataExtensionSchema(existingSchema.jsonSchema, fields);

  // Idempotency: a repeated run with the same requirements changes nothing.
  if (merged.added.length === 0 && merged.relabelled.length === 0) {
    return { action: 'noop', blocking: [], added: [], unchanged: merged.unchanged, relabelled: [], preserved: merged.preserved, jsonSchema: merged.jsonSchema, request: null };
  }

  const budget = checkSizeBudget(existingSchema, merged.jsonSchema);
  if (budget) {
    return { action: 'blocked', blocking: [budget], request: null };
  }

  return {
    action: 'update',
    blocking: [],
    added: merged.added,
    unchanged: merged.unchanged,
    relabelled: merged.relabelled,
    preserved: merged.preserved,
    jsonSchema: merged.jsonSchema,
    request: buildUpdateDataExtensionSchemaRequest({
      schemaId: existingSchema.id,
      revision: existingSchema.revision,
      mergedSchema: merged.jsonSchema,
    }),
  };
}

// The `_user_fields` namespace limit observed on the live Data Extension Schema API (2026-09-03).
// Used only when there is no existing schema whose listed `maxLimitBytes` could be read instead.
const OBSERVED_NAMESPACE_MAX_LIMIT_BYTES = 10000;

// The namespace is a shared byte budget, so the migration's fields can be refused by what the
// merchant already stores. Better to say so at setup than to fail mid-import.
function checkSizeBudget(existingSchema, mergedJsonSchema) {
  const limit = Number(existingSchema.maxLimitBytes);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const projected = Buffer.byteLength(JSON.stringify(mergedJsonSchema), 'utf8');
  if (projected > limit) {
    return {
      // Code `schema-budget-exceeded`. The fix is to route excess fields to CMS,
      // never to guess which fields to drop.
      code: 'schema-budget-exceeded',
      detail: `the merged schema is about ${projected} bytes against a ${limit}-byte namespace limit (currently ${existingSchema.currentSizeBytes} bytes used)`,
    };
  }
  return null;
}

// Step 7: re-read and record evidence. A create/update that reported success but did not produce
// the field is the case this catches.
// What a receipt has to have checked for its contract stamp to mean anything.
//
// This used to compare `property.type` and nothing else, while the stamp hashed maxLength,
// format, PII, filterability and permissions. So a schema could carry the right keys and types
// with WRONG permissions -- visitor-readable, say -- and the receipt would still say the private
// invoice contract passed. The `noop` path made that reachable without anyone tampering: an
// existing schema with matching keys is never rewritten, only verified.
//
// Presentation is deliberately absent, exactly as it is from the hash: `title` and `description`
// are the merchant's column headings and changing one must not invalidate receipts in flight.
function comparableProperty(property) {
  if (!property || typeof property !== 'object') return null;
  const permissions = property['x-wix-permissions'];
  return {
    type: property.type,
    maxLength: property.maxLength,
    format: property.format,
    pii: property['x-wix-pii'] === true,
    filterable: property['x-wix-filterable'] === true,
    permissions: permissions
      ? { read: [...(permissions.read || [])].sort(), write: [...(permissions.write || [])].sort() }
      : null,
  };
}

// A field intent, expressed the same way, so the two can be compared directly.
function expectedComparableProperty(field) {
  return comparableProperty(buildExtendedFieldSchemaProperty(field));
}

function describeFieldMismatch(field, property) {
  const expected = expectedComparableProperty(field);
  const actual = comparableProperty(property);
  if (!actual) return 'the field is not on the schema';
  const differences = [];
  for (const aspect of ['type', 'maxLength', 'format', 'pii', 'filterable', 'permissions']) {
    // An aspect the requirement does not state must be ABSENT from the schema, not merely
    // unexamined. The stamp hashes the empty value just as it hashes a set one, so a `format` the
    // requirement never asked for is a constraint outside the contract the receipt describes --
    // and it can reject writes the contract says are fine.
    if (JSON.stringify(expected[aspect]) !== JSON.stringify(actual[aspect])) {
      differences.push(`${aspect}: expected ${JSON.stringify(expected[aspect])}, schema has ${JSON.stringify(actual[aspect])}`);
    }
  }
  return differences.length > 0 ? differences.join('; ') : null;
}

function verifyDataExtensionSchemaFields({ schema, fields = [], contractVersion = null } = {}) {
  const properties = (schema && schema.jsonSchema && schema.jsonSchema.properties) || {};
  const verified = [];
  const missing = [];
  const mismatched = [];
  for (const field of fields) {
    const property = properties[field.key];
    if (!property) {
      missing.push(field.key);
      continue;
    }
    const difference = describeFieldMismatch(field, property);
    if (difference) {
      // Present but not what was asked for. Reported apart from `missing`, because "the field is
      // not there" and "the field is there and readable by the wrong people" are different
      // problems and only one of them is fixed by provisioning again.
      mismatched.push({ key: field.key, difference });
      continue;
    }
    verified.push({
      key: field.key,
      fieldType: property.type,
      maxLength: property.maxLength,
      writePath: `extendedFields.namespaces.${schema.namespace}.${field.key}`,
    });
  }
  return {
    verified,
    missing,
    mismatched,
    passed: missing.length === 0 && mismatched.length === 0,
    evidence: {
      schemaId: schema && schema.id,
      fqdn: schema && schema.fqdn,
      namespace: schema && schema.namespace,
      revision: schema && schema.revision,
      verifiedAt: null,
    },
    // Which contract this receipt was made against. A receipt that verified an earlier set of
    // fields is structurally identical to one that verified the current set; without this a
    // consumer cannot tell them apart, which is how a two-of-three receipt read as provisioned.
    contractVersion: contractVersion || null,
  };
}

// The writer-side guard: generated import code may write an extended field only
// after setup verification passed for that exact field.
// The executor persists `{schemaVersion, verifications: [...]}` -- one entry per requirement --
// while a single verification result is `{passed, verified}`. This accepted only the latter, so
// handing it the actual on-disk receipt refused every write as unprovisioned. Both shapes are
// normalized here, because the caller reading a file should not have to know which one it holds.
function normalizeSetupVerification(setupVerification) {
  if (!setupVerification) return [];
  if (Array.isArray(setupVerification.verifications)) return setupVerification.verifications;
  if (Array.isArray(setupVerification)) return setupVerification;
  return [setupVerification];
}

// The contract version for an extendedFieldSchema requirement, computed from the requirement
// itself so ANY producer of one stamps the same value for the same contract.
//
// It lives here rather than in a domain adapter because the shipped producer is generic:
// `domain-knowledge.js` copies `setupRequirements` out of whatever entity it is summarising and
// knows nothing about invoices. While the stamp existed only on the invoice adapter, the real path
// emitted unstamped requirements and the writer refused every invoice — the guard worked and the
// chain did not reach it.
//
// Hashed over what a CONSUMER'S BEHAVIOUR depends on: where the fields live, what they are called,
// their types and caps, whether they are PII or filterable, and who may read and write them. A
// permission or format change alters whether storing a value is safe, so it must invalidate a
// receipt; labels and hints are presentation and deliberately excluded, so improving a column
// heading does not invalidate every receipt in flight.
function extendedFieldContractVersion(requirement) {
  if (!requirement || !Array.isArray(requirement.fields)) return null;
  // The legacy V4 contact path has no fqdn/key/fieldType to hash; it stamps its own material.
  if (requirement.schemaKind === 'crm-contact-extended-field') {
    // eslint-disable-next-line global-require
    return require('./contact-extended-fields.js').contactExtendedFieldContractVersion(requirement);
  }
  const material = [
    requirement.fqdn || '',
    requirement.namespace || '',
    ...requirement.fields.map((field) => [
      field.key,
      field.fieldType,
      field.maxLength,
      field.format || '',
      field.pii === true ? 'pii' : '',
      field.filterable === true ? 'filterable' : '',
      JSON.stringify(resolvePermissions(field) || null),
      field.writePath || '',
    ].join(':')).sort(),
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

function stampRequirement(requirement) {
  if (!requirement || requirement.kind !== 'extendedFieldSchema') return requirement;
  return { ...requirement, contractVersion: extendedFieldContractVersion(requirement) };
}

function validateExtendedFieldWriterReferences({ writePaths = [], setupVerification = null, contractVersion = null } = {}) {
  const errors = [];
  const results = normalizeSetupVerification(setupVerification);

  // Provenance, not just shape. A receipt made against an older contract passes every structural
  // check and still leaves fields unprovisioned, so the caller states which contract it is
  // writing under and a receipt from any other one is refused.
  // A path counts only if the entry that verified it is ITSELF stamped with the contract being
  // written. Checking the receipt as a whole was not enough: the paths were unioned across every
  // entry, so one stamped-but-empty verification legitimised an unstamped entry that supplied all
  // of them. A receipt is a bag of independent claims, and provenance belongs to each claim rather
  // than to the bag.
  //
  // One setup receipt covers several targets (an Order contract and a Product contract, say), so
  // an entry stamped with a DIFFERENT contract is another requirement's claim, not a conflict: it
  // is ignored rather than rejected. Only the entries on the writer's own contract count, and
  // only their paths -- paths are never unioned across contracts. A receipt with no entry on this
  // contract is refused, naming the stale contract when one is present.
  let accepted = results;
  if (contractVersion) {
    accepted = results.filter((result) => result && result.contractVersion === contractVersion);
    if (results.length > 0 && accepted.length === 0) {
      const others = results.filter((result) => result && result.contractVersion);
      if (others.length > 0) {
        fail(errors, 'setup-receipt-contract-mismatch',
          `no verification was produced against contract ${contractVersion} (the receipt has ${others.map((r) => r.contractVersion).join(', ')}); re-run setup`);
      } else {
        fail(errors, 'setup-receipt-unstamped',
          'no verification in the receipt carries this contract version, so none of it can be shown to match the fields being written; re-run setup');
      }
    }
  }
  const verified = new Set(accepted.flatMap((result) => ((result && result.verified) || []).map((entry) => entry.writePath)));
  // Every verification on this contract must have passed: one failed requirement invalidates the
  // fields it was responsible for, and they are not distinguishable from here.
  const passed = accepted.length > 0 && accepted.every((result) => result && result.passed === true);
  for (const writePath of writePaths) {
    if (!passed) {
      fail(errors, 'writes-before-verified-setup', `"${writePath}" would be written before setup verification passed`);
      continue;
    }
    if (!verified.has(writePath)) {
      fail(errors, 'write-path-not-verified', `"${writePath}" is not among the fields setup verified`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// Revision-conflict recovery. Update carries the listed revision; a concurrent
// merchant or app edit between List and Update makes it stale. Wix answers a stale revision with a
// 409 (other revisioned services name it INVALID_REVISION), so either signal counts. Anything else
// is a real failure and is not retried here.
const MAX_SCHEMA_WRITE_ATTEMPTS = 3;
const CONFLICT_EXHAUSTED_CODE = 'EXTENDED_FIELD_SCHEMA_CONFLICT_EXHAUSTED';
const CONTACTS_V5_UNVERIFIED_CODE = 'CONTACTS_V5_DES_UNVERIFIED';

function isRevisionConflict(error) {
  if (!error) return false;
  if (error.status === 409) return true;
  const text = [error.code, error.applicationErrorCode, error.message].filter(Boolean).join(' ');
  return /INVALID_REVISION|REVISION_MISMATCH|revision.*(conflict|stale|mismatch)/i.test(text);
}

module.exports = {
  SCHEMA_SERVICE,
  CONTACTS_FQDN,
  OUT_OF_SCOPE_TARGETS,
  MAX_SCHEMA_WRITE_ATTEMPTS,
  OBSERVED_NAMESPACE_MAX_LIMIT_BYTES,
  CONFLICT_EXHAUSTED_CODE,
  CONTACTS_V5_UNVERIFIED_CODE,
  isRevisionConflict,
  USER_FIELDS_NAMESPACE,
  SUPPORTED_TARGETS,
  VERIFIED_FIELD_TYPES,
  VERIFIED_STRING_FORMATS,
  PERMISSION_PRESETS,
  validateExtendedFieldIntent,
  buildExtendedFieldSchemaProperty,
  buildDataExtensionSchema,
  validateDataExtensionSchemaRequirement,
  buildListDataExtensionSchemasRequest,
  selectUserFieldsSchema,
  archivedKeys,
  detectDataExtensionSchemaBreakingChanges,
  mergeDataExtensionSchema,
  buildCreateDataExtensionSchemaRequest,
  buildUpdateDataExtensionSchemaRequest,
  planDataExtensionSchemaProvisioning,
  verifyDataExtensionSchemaFields,
  normalizeSetupVerification,
  extendedFieldContractVersion,
  stampRequirement,
  validateExtendedFieldWriterReferences,
};
