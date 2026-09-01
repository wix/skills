'use strict';

// rp-mapper — DETERMINISTIC mapping resolution.
//
// Joins three inputs that are all already data:
//
//   discovered header set  ×  vendor overlay columnMap  ×  Wix target spec
//
// and answers, with no LLM involved:
//
//   - which source columns map to which canonical field, and by which alias (auditable)
//   - which source columns NOTHING claims                  -> `residue.unmappedColumns`
//   - which mapped columns have no Wix home                -> `residue.unsupportedTargets`
//   - which REQUIRED Wix inputs nothing feeds              -> `residue.unfilledRequired`
//   - which overlay entries reference a column not present  -> `overlayDrift`
//
// The agent's job collapses to the `residue` object. Everything else is computed, repeatable, and
// diffable between runs — which is the point: an identical export must not produce a differently
// worded mapping plan just because a model sampled differently.
//
// The overlay stays ADVISORY in the sense that matters: the authoritative column list is the header
// row read at discovery time. An overlay can only claim columns that actually exist, and a column
// the overlay does not know is surfaced, never dropped.

const path = require('path');
const fs = require('fs');
const { CANONICAL_FIELDS, TARGETS, validateCanonicalPath } = require('../../rp-target-wix/lib/wix-target-spec.js');

const VENDORS_DIR = path.join(__dirname, '..', '..', 'rp-source-csv', 'vendors');

// Column identity is the NORMALIZED name: lowercase, NFKC, punctuation and whitespace stripped.
// `Body (HTML)` -> `bodyhtml`, and `Option1 Name` === `Option 1 Name`. This absorbs vendor casing
// and punctuation churn without a code change.
function normalizeColumnName(name) {
  return String(name == null ? '' : name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function loadVendorOverlay(vendor) {
  const file = path.join(VENDORS_DIR, `${vendor}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listVendors() {
  return fs
    .readdirSync(VENDORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/**
 * Resolve a mapping deterministically.
 *
 * @param {object} input
 * @param {string[]} input.headers    the header row AS READ at discovery time (authoritative)
 * @param {string}  input.vendor      detected vendor, or 'custom' for no overlay
 * @param {object}  [input.overlay]   pre-loaded overlay (tests inject; otherwise loaded by vendor)
 * @param {string[]} [input.targets]  which target entities to check coverage for
 */
function resolveMapping({ headers, vendor, overlay, targets = ['product', 'category'] }) {
  const overlayDoc = overlay !== undefined ? overlay : loadVendorOverlay(vendor);
  const headerByNormalized = new Map();
  const duplicateColumns = [];
  for (const header of headers || []) {
    const key = normalizeColumnName(header);
    if (!key) continue;
    if (headerByNormalized.has(key)) duplicateColumns.push(header);
    else headerByNormalized.set(key, header);
  }

  const fieldMappings = [];
  const claimedColumns = new Set();
  const overlayDrift = [];
  const canonicalErrors = [];

  for (const entry of (overlayDoc && overlayDoc.columnMap) || []) {
    if (!validateCanonicalPath(entry.wixTarget)) {
      // A typo or an unmodelled concept in the overlay. Fail loudly at resolve time rather than
      // silently producing a mapping that targets a field nothing can consume.
      canonicalErrors.push({ wixTarget: entry.wixTarget, reason: 'not a known canonical field' });
      continue;
    }
    // Aliases are ordered by preference; first present alias wins, and which one matched is
    // recorded so a reviewer can see WHY a column was claimed.
    let matched = null;
    for (const alias of entry.aliases || []) {
      const key = normalizeColumnName(alias);
      if (headerByNormalized.has(key)) {
        matched = { column: headerByNormalized.get(key), alias };
        break;
      }
    }
    if (!matched) {
      overlayDrift.push({ wixTarget: entry.wixTarget, aliasesTried: entry.aliases || [], reason: 'no alias present in header' });
      continue;
    }
    claimedColumns.add(normalizeColumnName(matched.column));
    const def = CANONICAL_FIELDS[entry.wixTarget];
    fieldMappings.push({
      sourceColumn: matched.column,
      matchedAlias: matched.alias,
      canonicalField: entry.wixTarget,
      entity: def.entity,
      kind: def.kind,
      required: Boolean(def.required),
      decisionProvenance: 'source_platform_rule',
    });
  }

  // --- derived entities ----------------------------------------------------
  // A `derived` entry synthesizes an entity from the DISTINCT VALUES of one column — this is how
  // categories and tags arrive in every named vendor's export. Such an entity's name/path is fed
  // by derivation, not by a column mapping, so crediting it here is what keeps `category.name`
  // from being reported as an unfilled required field on a perfectly complete export.
  const derivedEntities = [];
  for (const entry of (overlayDoc && overlayDoc.derived) || []) {
    const key = normalizeColumnName(entry.fromColumn);
    const present = headerByNormalized.has(key);
    if (present) claimedColumns.add(key);
    derivedEntities.push({
      entity: entry.entity,
      fromColumn: present ? headerByNormalized.get(key) : entry.fromColumn,
      present,
      hierarchical: Boolean(entry.hierarchical),
      linkPolicy: entry.linkPolicy || null,
      // A hierarchical source taxonomy mapped to a flat target triggers rp-mapper's mandatory
      // faithfulness-ledger entry; surfacing the flag here is what makes that data-driven.
      requiresFaithfulnessLedgerEntry: Boolean(entry.hierarchical),
      fills: present ? [`${entry.entity}.name`, `${entry.entity}.path`].filter(validateCanonicalPath) : [],
    });
  }
  const derivedFilled = new Set(derivedEntities.flatMap((d) => d.fills));

  // --- coverage against the Wix targets ------------------------------------
  const unsupportedTargets = [];
  const supportedByTarget = new Map();
  for (const targetName of targets) {
    const target = TARGETS[targetName];
    if (!target) continue;
    supportedByTarget.set(targetName, new Set(Object.keys(target.fields)));
  }
  for (const mapping of fieldMappings) {
    const target = TARGETS[mapping.entity === 'variant' ? 'product' : mapping.entity];
    if (!target) continue;
    if (target.fields[mapping.canonicalField]) continue;
    const reason = target.unsupported && target.unsupported[mapping.canonicalField];
    unsupportedTargets.push({
      sourceColumn: mapping.sourceColumn,
      canonicalField: mapping.canonicalField,
      reason: reason || 'no Wix target field is declared for this canonical field',
      declared: Boolean(reason),
    });
  }

  // Required canonical inputs that nothing feeds. These are hard blockers, not review items.
  const mappedFields = new Set(fieldMappings.map((m) => m.canonicalField));
  const unfilledRequired = Object.entries(CANONICAL_FIELDS)
    .filter(([fieldPath, def]) => {
      if (!def.required || mappedFields.has(fieldPath) || derivedFilled.has(fieldPath)) return false;
      const target = TARGETS[def.entity === 'variant' ? 'product' : def.entity];
      return Boolean(target && target.fields[fieldPath]);
    })
    .map(([fieldPath]) => fieldPath);

  // Source columns nothing claimed. THIS is the agent's queue.
  const unmappedColumns = [...headerByNormalized.entries()]
    .filter(([key]) => !claimedColumns.has(key))
    .map(([, original]) => original);

  const totalColumns = headerByNormalized.size;
  return {
    vendor: vendor || 'custom',
    overlayVersion: (overlayDoc && overlayDoc.profileVersion) || null,
    overlayPresent: Boolean(overlayDoc),
    fieldMappings,
    coverage: {
      totalColumns,
      mappedColumns: claimedColumns.size,
      unmappedColumns: unmappedColumns.length,
      // The honest headline number: of the columns the overlay claimed, how many actually land in
      // Wix. A column mapped to an unsupported canonical field is NOT coverage.
      landingInWix: fieldMappings.length - unsupportedTargets.length,
      ratio: totalColumns ? Number((claimedColumns.size / totalColumns).toFixed(4)) : 0,
    },
    derivedEntities,
    residue: { unmappedColumns, unsupportedTargets, unfilledRequired },
    overlayDrift,
    canonicalErrors,
    duplicateColumns,
  };
}

// Applies a resolved mapping to one raw source row -> a flat canonical field bag.
// Deliberately NOT the whole record assembler: grouping rows into products, deriving categories
// from a column's values, and unit conversion are adapter concerns (rp-source-csv owns them).
// This is the field-level half, and it is the half that was being hand-written per project.
function applyMapping(row, resolved) {
  const out = {};
  for (const mapping of resolved.fieldMappings) {
    const raw = row[mapping.sourceColumn];
    if (raw === undefined) continue;
    out[mapping.canonicalField] = raw;
  }
  return out;
}

module.exports = {
  normalizeColumnName,
  loadVendorOverlay,
  listVendors,
  resolveMapping,
  applyMapping,
  VENDORS_DIR,
};
