'use strict';

// The order-invoice field contract, read from the entity that setup discovery consumes.
//
// This adapter exists for two reasons, both found in review.
//
// LAYERING. The generic Data Extension Schema library loaded this eCommerce entity at module
// initialisation, so a malformed or missing invoice entity would have stopped `wix-writers.js`
// from loading at all -- taking every unrelated Wix writer with it. A domain file has no business
// being a load-time dependency of a domain-neutral utility.
//
// MUTABILITY. It exported the field array directly. Any in-process consumer could `pop()` it and
// silently weaken the writer's verification gate while setup discovery carried on emitting the
// full requirement -- two views of one contract, disagreeing, with nothing to notice.
//
// So: validate on read, freeze what goes out, and hand back clones where callers might mutate.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ENTITY_PATH = path.join(__dirname, '..', 'domains', 'ecom', 'entities', 'order-invoice-document.json');

// Semantic roles, so callers ask for "the field that holds the preserved file" rather than
// retyping a key. Every hardcoded key in a writer is a chance for the two to drift.
const ROLES = Object.freeze({
  number: 'replatformSourceInvoiceNumber',
  fileId: 'replatformSourceInvoiceFileId',
  url: 'replatformSourceInvoiceUrl',
});

let cached = null;

function load() {
  if (cached) return cached;
  const entity = JSON.parse(fs.readFileSync(ENTITY_PATH, 'utf8'));
  const requirement = (entity.setupRequirements || [])
    .find((entry) => entry && entry.kind === 'extendedFieldSchema');
  if (!requirement) {
    throw new Error('order-invoice-document.json declares no extendedFieldSchema setup requirement');
  }
  for (const role of Object.values(ROLES)) {
    if (!requirement.fields.some((field) => field.key === role)) {
      throw new Error(`order-invoice-document.json is missing the ${role} field; the writer requires it`);
    }
  }
  // The version comes from the GENERIC stamper, not a second algorithm here. Two implementations
  // of one hash is how the adapter and the shipped producer stamped the same contract differently
  // -- and a mismatched stamp fails exactly like a forged one, so the duplication was worse than
  // no stamp at all. What it covers, and why, is documented at that function.
  cached = Object.freeze({
    namespace: requirement.namespace,
    version: require('./data-extension-schema.js').extendedFieldContractVersion(requirement),
    fields: Object.freeze(requirement.fields.map((field) => Object.freeze({ ...field }))),
  });
  return cached;
}

// A fresh, independent copy every time -- the caller may do what it likes with it.
function requirement() {
  const entity = JSON.parse(fs.readFileSync(ENTITY_PATH, 'utf8'));
  const found = JSON.parse(JSON.stringify((entity.setupRequirements || [])
    .find((entry) => entry && entry.kind === 'extendedFieldSchema')));
  // Stamped, so everything downstream can be traced back to the contract that produced it.
  found.contractVersion = load().version;
  return found;
}

function version() {
  return load().version;
}

function fields() {
  return load().fields;
}

function writePaths(namespace) {
  const ns = namespace || load().namespace;
  return load().fields.map((field) => `extendedFields.namespaces.${ns}.${field.key}`);
}

// The declared cap for a role, so a writer never carries its own copy of a length.
function maxLengthFor(role) {
  const key = ROLES[role] || role;
  const field = load().fields.find((entry) => entry.key === key);
  if (!field) throw new Error(`no invoice field for role "${role}"`);
  return field.maxLength;
}

module.exports = { ROLES, fields, requirement, version, writePaths, maxLengthFor, ENTITY_PATH };
