'use strict';

// The entity-QA attestation gate on migration finalization.
//
// An entity-by-entity QA pass is mandatory before an import phase counts as done
// (`rp-execute-import/SKILL.md`), but only in prose -- nothing checked that it happened, or
// that it checked the report that actually shipped. This module is the check: a pure validator
// (`validateEntityQaAttestation`) that mirrors `setup-verification.js`'s `isSetupVerified`
// pattern -- fail closed, and judge coverage against an INDEPENDENT list the attestation
// cannot have produced itself (`mappedEntities`, resolved by the caller from
// `mapping/mapping-plan.json` or, for quick mode, `quick-mode/plan.json` -- never from the
// completion report or the attestation under test).
//
// The gate proves freshness and coverage, not that the QA pass actually happened. A hollow attestation that copies the report's own
// counts and marks every blocked row reverified still passes. That is an accepted limit, not
// a defect -- `isSetupVerified` has the identical limit already.

const SCHEMA_VERSION = 1;

const ENTITY_QA_ATTESTATION_FILE = 'execution/qa/entity-qa-attestation.json';

// The ten fields `completion-report.js`'s `normalizeCompletenessRow` writes to every
// `entityCompleteness[]` row. `reconciled`/`expectedReconciled`/`mismatch` are pure functions
// of these and are deliberately not attested separately.
const FULL_MODE_FIELDS = [
  'extracted',
  'inScope',
  'attempted',
  'imported',
  'alreadyPresentByCrosswalk',
  'deferred',
  'failed',
  'unresolved',
  'skippedOutOfScope',
  'unexpectedSkipped',
];

const QUICK_MODE_FIELDS = ['imported', 'skipped'];

function entityKey(entity, subtype) {
  return `${entity}/${subtype || 'all'}`;
}

// Normalizes whatever shape the caller's independent mapped-entity source carries (full mode:
// `website-handoff.js`'s `readEntityMappings` rows, keyed by `sourceEntity`; quick mode:
// `quick-mode/plan.json`'s own `entities` rows, keyed by `id`) into a `key -> {entity,
// subtype}` map. Rows with no recognizable entity name are dropped, never counted as coverage.
// Returns `null` when the input itself isn't a usable array at all (as opposed to a usable,
// but empty-after-normalization, array) -- both cases resolve to "unavailable" one level up,
// but keeping them distinct helps a caller that wants to know which happened.
function normalizeMappedEntities(mappedEntities) {
  if (!Array.isArray(mappedEntities)) return null;
  const map = new Map();
  for (const row of mappedEntities) {
    if (!row || typeof row !== 'object') continue;
    const entity = firstNonEmptyString(row.entity, row.sourceEntity, row.id);
    if (!entity) continue;
    const subtype = typeof row.subtype === 'string' && row.subtype ? row.subtype : 'all';
    map.set(entityKey(entity, subtype), { entity, subtype });
  }
  return map;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

// Indexes a full-mode report's `entityCompleteness[]` rows by `entity/subtype`. A row missing
// `entity` entirely can never be matched against anything and is dropped, same as
// `normalizeMappedEntities`.
function indexFullModeReportRows(report) {
  const map = new Map();
  const rows = report && Array.isArray(report.entityCompleteness) ? report.entityCompleteness : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !row.entity) continue;
    const subtype = row.subtype || 'all';
    map.set(entityKey(row.entity, subtype), row);
  }
  return map;
}

function numericFieldValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Quick mode's `imported`/`skipped` maps are keyed by plain entity id (no subtype). `skipped`
// may be an array of per-record skip reasons (as `rp-quick-shopify` writes) or entirely absent
// (as `rp-quick-woocommerce`'s summary is) -- either resolves to a count, and an absent map
// resolves to 0 for every entity, never a mismatch (the WooCommerce quick-mode case).
function quickModeCount(container, entity) {
  if (!container || typeof container !== 'object') return 0;
  const value = container[entity];
  if (Array.isArray(value)) return value.length;
  return numericFieldValue(value);
}

function quickModeEntityPresent(container, entity) {
  return !!(container && typeof container === 'object' && Object.prototype.hasOwnProperty.call(container, entity));
}

// A duplicate `entity/subtype` row must not silently let the
// last one win -- `setup-verification.js`'s `isSetupVerified`, which this validator mirrors,
// flags a duplicate requirement id instead of dropping it quietly (`normalizeIds`'s
// `onDuplicate`). `duplicateKeys` collects every key seen more than once so the caller can
// raise a finding for it.
//
// `normalizeIds` keeps the FIRST occurrence of
// a duplicate id for everything downstream (`seen.has(id)` short-circuits every later one via
// `continue`, before it can overwrite anything) -- it does not compare values at all, but the
// keep-first discipline is the behavior this mirrors. This indexer now keeps the first
// occurrence of a duplicate key too (the finding is raised regardless, and a duplicate already
// fails the gate on its own either way, but the row used for the count comparison -- and
// reported in `entities` -- is now deterministically the first one seen, not the last).
function indexAttestationEntities(attestation) {
  const map = new Map();
  const duplicateKeys = new Set();
  for (const row of attestation.entities) {
    if (!row || typeof row !== 'object' || !row.entity) continue;
    const subtype = row.subtype || 'all';
    const key = entityKey(row.entity, subtype);
    if (map.has(key)) {
      duplicateKeys.add(key);
      continue;
    }
    map.set(key, row);
  }
  return { map, duplicateKeys };
}

// `validateEntityQaAttestation({ attestation, report, reportDigest, mappedEntities })`.
//
// Returns `{ ok, reasons, qaStatus, entities, recheck }`.
//   - `qaStatus`: 'missing' | 'stale' | 'failed' | 'attested'. Precedence: missing wins over
//     stale, stale wins over failed -- a stale record's per-entity findings describe an old
//     report, so they are never computed or listed.
//   - `entities`: for `qaStatus: 'failed'`, one entry per affected `{entity, subtype, reasons}`.
//     Empty for every other status.
//   - `recheck`: 'full' for missing/stale, 'entities' for failed, `null` once attested.
function validateEntityQaAttestation({ attestation, report, reportDigest, mappedEntities }) {
  // 1. The attestation file itself: missing (or unreadable -- a malformed file is handed in by
  // the caller's tolerant load as `null`, same as a missing one) or
  // schema-invalid.
  if (!attestation || typeof attestation !== 'object') {
    return { ok: false, reasons: ['entity_qa_attestation_missing'], qaStatus: 'missing', entities: [], recheck: 'full' };
  }
  if (attestation.schemaVersion !== SCHEMA_VERSION || !Array.isArray(attestation.entities)) {
    return { ok: false, reasons: ['entity_qa_attestation_schema_invalid'], qaStatus: 'missing', entities: [], recheck: 'full' };
  }

  // 2. There must be a usable completion report and a digest to compare against -- never
  // "nothing to cover".
  if (!report || typeof report !== 'object' || !reportDigest) {
    return { ok: false, reasons: ['entity_qa_report_unavailable'], qaStatus: 'missing', entities: [], recheck: 'full' };
  }

  // 3. The independent coverage source must itself be usable. An empty list is exactly as
  // unusable as a missing one -- it is never a legitimate "nothing was mapped".
  const mapped = normalizeMappedEntities(mappedEntities);
  if (!mapped || mapped.size === 0) {
    return { ok: false, reasons: ['entity_qa_mapped_entities_unavailable'], qaStatus: 'missing', entities: [], recheck: 'full' };
  }

  // 4. Freshness: the attestation must name the digest of the report that is actually
  // shipping. A later report rewrite reopens the whole review -- no per-entity findings are
  // computed for a stale record, since they would describe a report that no longer exists.
  if (attestation.completionReportDigest !== reportDigest) {
    return { ok: false, reasons: ['entity_qa_attestation_stale'], qaStatus: 'stale', entities: [], recheck: 'full' };
  }

  // 5. Coverage and counts, judged two ways that together close two different gaps (see the comment above `reportRowsByBaseEntity` below for the second
  // half). Neither judgment is against the attestation's or report's own entity list taken
  // alone -- both comparands (`mapped` and, for full mode, the report's own
  // `entityCompleteness`) are sources the attestation under test cannot have produced itself.
  //
  // `mapped` keys are always `<entity>/all`: `mapping-plan.json`'s schema (`readEntityMappings`
  // in website-handoff.js) documents entities, not write-path subtypes -- subtyping is an
  // execution/reporting concern that `rp-import-codegen/SKILL.md` requires only "whenever
  // source records with the same entity map through materially different write paths or
  // deferral rules, for example simple vs subscription Stores products". A full-mode run that
  // legitimately splits a mapped entity's `entityCompleteness` rows by subtype therefore
  // produces attested rows like `product/simple` and `product/subscription` that can never
  // exact-key-match the plan's `product/all` -- comparing exact keys would flag such a row as
  // BOTH missing (`product/all` absent) and unexpected (`product/simple` not in the plan)
  // simultaneously, permanently blocking a correct migration. Coverage against `mapped`
  // and uniqueness are therefore judged at the base-entity level: `mapped` only decides WHICH
  // BASE ENTITIES are in scope at all, never which subtypes are required (the plan doesn't
  // know). Which subtypes are required is then judged separately, against the report itself
  // (below) -- closing the gap where an attestation that covers only some of an in-scope
  // entity's real subtype rows used to read as fully covered. Only the per-row count
  // comparison uses the full `entity/subtype` key, matching whatever subtype breakdown the
  // attestation and report actually carry.
  const isQuickMode = report.managementImportMode === 'quick';
  const { map: attested, duplicateKeys } = indexAttestationEntities(attestation);
  const fullModeReportRows = isQuickMode ? null : indexFullModeReportRows(report);

  const findings = new Map(); // key -> { entity, subtype, reasons: [] }
  const findingsFor = (key, entity, subtype) => {
    if (!findings.has(key)) findings.set(key, { entity, subtype, reasons: [] });
    return findings.get(key);
  };

  // A duplicate attested row for the same entity/subtype is a finding, not a silent
  // last-one-wins resolution.
  for (const key of duplicateKeys) {
    const row = attested.get(key);
    findingsFor(key, row.entity, row.subtype || 'all').reasons.push(`entity_qa_duplicate_attestation:${key}`);
  }

  const mappedBaseEntities = new Set([...mapped.values()].map(({ entity }) => entity));
  const attestedByBaseEntity = new Map(); // entity -> [{ key, subtype }]
  for (const [key, row] of attested) {
    const subtype = row.subtype || 'all';
    if (!attestedByBaseEntity.has(row.entity)) attestedByBaseEntity.set(row.entity, []);
    attestedByBaseEntity.get(row.entity).push({ key, subtype });
  }

  // The base-entity grouping above fixes a case (a legitimate
  // subtype split must not be flagged as both missing and unexpected against a plan that only
  // knows base entities) but, left as-is, opened a new gap -- an attestation covering only
  // SOME of a mapped entity's real subtype rows read as fully covered, because "missing" was
  // judged as "at least one attested row for this base entity" rather than "every subtype row
  // that actually exists". A QA agent could silently omit an inconvenient subtype from
  // `--entities-file` and the gate would still pass. Close it by indexing which subtype rows
  // the full-mode report itself actually carries per base entity -- the report, not the plan,
  // is authoritative on which subtypes exist (the plan never carries subtypes at all).
  const reportRowsByBaseEntity = new Map(); // entity -> [{ key, subtype }]
  if (!isQuickMode) {
    for (const [key, row] of fullModeReportRows) {
      const subtype = row.subtype || 'all';
      if (!reportRowsByBaseEntity.has(row.entity)) reportRowsByBaseEntity.set(row.entity, []);
      reportRowsByBaseEntity.get(row.entity).push({ key, subtype });
    }
  }

  // Missing: for each mapped (in-scope) base entity, every subtype row the report actually
  // carries for it must have a matching attested row -- this is what closes the partial-subtype gap,
  // using the report (never the plan) to decide which subtypes are required. When the report
  // carries no rows at all for a mapped entity (quick mode, which has no subtype concept and no
  // `entityCompleteness`, or a full-mode entity the report's completeness data never touched),
  // fall back to requiring at least one attested row under `entity/all` -- the original
  // behavior, still needed so a genuinely-never-attested entity is still caught.
  for (const entity of mappedBaseEntities) {
    const reportRows = !isQuickMode ? reportRowsByBaseEntity.get(entity) : null;
    const attestedRows = attestedByBaseEntity.get(entity) || [];

    if (reportRows && reportRows.length > 0) {
      const attestedKeys = new Set(attestedRows.map((row) => row.key));
      for (const { key, subtype } of reportRows) {
        if (!attestedKeys.has(key)) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_missing_entity:${key}`);
        }
      }
    } else if (attestedRows.length === 0) {
      const key = entityKey(entity, 'all');
      findingsFor(key, entity, 'all').reasons.push(`entity_qa_missing_entity:${key}`);
    }
  }
  // Unexpected: an attested row whose base entity was never mapped at all -- a subtype split
  // under a mapped entity is never flagged here, only an entity absent from the plan entirely.
  for (const [entity, rows] of attestedByBaseEntity) {
    if (mappedBaseEntities.has(entity)) continue;
    for (const { key, subtype } of rows) {
      findingsFor(key, entity, subtype).reasons.push(`entity_qa_unexpected_entity:${key}`);
    }
  }

  // Only attested rows under a mapped base entity ever reach a count comparison -- a
  // missing/unexpected row already has its own finding above. A plain (unsubtyped) entity
  // compares its single `entity/all` row, same as before; a subtype-split entity compares each
  // of its subtype rows independently against the matching report row.
  for (const entity of mappedBaseEntities) {
    const rows = attestedByBaseEntity.get(entity);
    if (!rows || rows.length === 0) continue;

    for (const { key, subtype } of rows) {
      const attestedRow = attested.get(key);

      if (isQuickMode) {
        if (!quickModeEntityPresent(report.imported, entity)) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_report_entity_missing:${key}`);
          continue;
        }
        const reportImported = quickModeCount(report.imported, entity);
        const reportSkipped = quickModeCount(report.skipped, entity);
        const attestedImported = numericFieldValue(attestedRow.imported);
        const attestedSkipped = numericFieldValue(attestedRow.skipped);
        if (attestedImported !== reportImported) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_count_mismatch:${key}:imported`);
        }
        if (attestedSkipped !== reportSkipped) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_count_mismatch:${key}:skipped`);
        }
        if (attestedSkipped > 0 && attestedRow.blockedReasonsReverified !== true) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_blocked_reasons_not_reverified:${key}`);
        }
      } else {
        const reportRow = fullModeReportRows.get(key);
        if (!reportRow) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_report_entity_missing:${key}`);
          continue;
        }
        for (const field of FULL_MODE_FIELDS) {
          const attestedValue = numericFieldValue(attestedRow[field]);
          const reportValue = numericFieldValue(reportRow[field]);
          if (attestedValue !== reportValue) {
            findingsFor(key, entity, subtype).reasons.push(`entity_qa_count_mismatch:${key}:${field}`);
          }
        }
        const blocked = numericFieldValue(attestedRow.deferred) > 0
          || numericFieldValue(attestedRow.failed) > 0
          || numericFieldValue(attestedRow.unresolved) > 0
          || numericFieldValue(attestedRow.skippedOutOfScope) > 0;
        if (blocked && attestedRow.blockedReasonsReverified !== true) {
          findingsFor(key, entity, subtype).reasons.push(`entity_qa_blocked_reasons_not_reverified:${key}`);
        }
      }
    }
  }

  if (findings.size > 0) {
    const entities = [...findings.values()];
    const reasons = entities.flatMap((entry) => entry.reasons);
    return { ok: false, reasons, qaStatus: 'failed', entities, recheck: 'entities' };
  }

  return { ok: true, reasons: [], qaStatus: 'attested', entities: [], recheck: null };
}

module.exports = {
  SCHEMA_VERSION,
  ENTITY_QA_ATTESTATION_FILE,
  FULL_MODE_FIELDS,
  QUICK_MODE_FIELDS,
  normalizeMappedEntities,
  validateEntityQaAttestation,
};
