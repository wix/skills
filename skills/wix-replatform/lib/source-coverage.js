'use strict';

// Source coverage accountability.
//
// A capability a source adapter advertised or attempted but did not capture (a 401/403 entity, a
// data route skipped by rule, a route that failed, a quick-mode exclusion) never becomes a
// `source-schema.json` entity, so before this module nothing forced it into the mapping-gaps
// ledger or the completion report. It could disappear silently.
//
// This module owns the one schema for that record and the one join that decides what each row
// means for the run's outcome:
//
//   adapter -> data/<source>-discovery/source-coverage.json   (rows; written by the adapter)
//   rp-discovery promote -> discovery/source-coverage.json    (+ `sourceCoverageContract` stamp)
//   rp-mapper -> mapping/review/mapping-gaps.json rows carrying `coverageId`, or a
//                `sourceCoverage:<coverageId>` decision in orchestration/decisions.json
//   reconcile / summarize -> every row has exactly one valid disposition, or the run refuses
//   writeCompletionReport -> sourceCoverage[], status floor, headline, operatorActions
//
// Everything here is deterministic set/lookup work over adapter declarations and coverage rows.
// No model calls, no network, no per-record passes.

const fs = require('node:fs/promises');
const path = require('node:path');

const SOURCE_COVERAGE_SCHEMA_VERSION = 1;
const SOURCE_COVERAGE_CONTRACT = 1;

// Every bundled adapter must emit a coverage file. An adapter outside this set cannot promote
// discovery until it is added; there is no unstamped path for it.
const COVERAGE_EMITTERS = Object.freeze(['wordpress', 'csv', 'shopify', 'quick-woocommerce', 'quick-shopify']);
const QUICK_ADAPTERS = Object.freeze(['quick-woocommerce', 'quick-shopify']);

// Where each full adapter writes its raw capture; promotion reads the adapter file from here.
const ADAPTER_RAW_DIRS = Object.freeze({
  wordpress: 'data/wp-discovery',
  csv: 'data/csv-discovery',
  shopify: 'data/shopify-discovery',
});

const SOURCE_COVERAGE_FILE = 'discovery/source-coverage.json';
const ADAPTER_COVERAGE_FILE_NAME = 'source-coverage.json';
const SOURCE_SCHEMA_FILE = 'source-schema.json';
const QUICK_PLAN_FILE = 'quick-mode/plan.json';
const MAPPING_GAPS_FILE = 'mapping/review/mapping-gaps.json';
const DECISIONS_FILE = 'orchestration/decisions.json';
const APPROVALS_FILE = 'orchestration/approvals.json';

const COVERAGE_REASONS = Object.freeze([
  'auth-gated',
  'route-unsupported',
  'route-skipped-by-rule',
  'capture-failed',
  'adapter-excluded',
  'declared-not-observed',
]);
const RECOVERABILITY = Object.freeze(['import-operator', 'requires-development', 'not-recoverable']);
const GATES = Object.freeze(['exclusion', 'loss-accepted']);
const DECISION_VALUES = Object.freeze(['provided', 'declined']);
const DECISION_PREFIX = 'sourceCoverage:';
// Rows whose open state owes the Cutover Operator an urgent action: the source still holds the
// only copy and nobody decided to leave it behind.
const URGENT_REASONS = new Set(['auth-gated', 'capture-failed', 'declared-not-observed']);

// Status floors reuse the completion report's existing vocabulary and rank (completion-report.js
// COMPLETION_STATUS). Duplicated as strings, not imported, so this module stays a leaf.
const STATUS_FLOOR = Object.freeze({
  recovered: null,
  'gated-exclusion': null,
  'ungated-exclusion': 'complete_with_warnings',
  'accepted-loss': 'incomplete_with_failures',
  unresolved: 'incomplete_with_mismatches',
  'pre-contract': 'complete_with_warnings',
});
const STATUS_ORDER = [
  'aborted',
  'incomplete_with_mismatches',
  'incomplete_with_failures',
  'complete_with_deferred_records',
  'complete_with_recovered_records',
  'complete_with_warnings',
  'complete',
];

const PRE_CONTRACT_REASON = 'pre-contract-discovery';
const PRE_CONTRACT_HEADLINE = 'source coverage was not recorded for this run';

class SourceCoverageError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = 'SourceCoverageError';
    this.code = 'source_coverage_invalid';
    this.failures = failures;
  }
}

function worse(left, right) {
  if (!right) return left;
  if (!left) return right;
  return STATUS_ORDER.indexOf(left) <= STATUS_ORDER.indexOf(right) ? left : right;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireString(value, label) {
  if (!nonEmptyString(value)) throw new SourceCoverageError(`${label} must be a non-empty string`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Rows and the file envelope
// ---------------------------------------------------------------------------------------------

function coverageIdFor(platform, sourceEntity) {
  return `${platform}:${sourceEntity}`;
}

function normalizeEvidence(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceCoverageError(`${label}.evidence must be an object { artifact, pointer }`);
  }
  return {
    artifact: requireString(value.artifact, `${label}.evidence.artifact`),
    pointer: value.pointer === undefined || value.pointer === null ? null : String(value.pointer),
  };
}

function normalizeCoverageRow(row, index = 0, { platform = null } = {}) {
  const label = `rows[${index}]`;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new SourceCoverageError(`${label} must be an object`);
  const rowPlatform = requireString(row.platform, `${label}.platform`);
  if (platform && rowPlatform !== platform) {
    throw new SourceCoverageError(`${label}.platform ${rowPlatform} does not match the file platform ${platform}`);
  }
  const sourceEntity = requireString(row.sourceEntity, `${label}.sourceEntity`);
  const coverageId = requireString(row.coverageId, `${label}.coverageId`);
  if (coverageId !== coverageIdFor(rowPlatform, sourceEntity)) {
    throw new SourceCoverageError(`${label}.coverageId must be ${coverageIdFor(rowPlatform, sourceEntity)} (got ${coverageId})`);
  }
  const reason = requireString(row.reason, `${label}.reason`);
  if (!COVERAGE_REASONS.includes(reason)) {
    throw new SourceCoverageError(`${label}.reason must be one of ${COVERAGE_REASONS.join(', ')}`);
  }
  let capability = null;
  let capabilityUnregistered = false;
  if (row.capability === null || row.capability === undefined) {
    if (row.capabilityUnregistered !== true) {
      throw new SourceCoverageError(`${label}: a null capability requires capabilityUnregistered: true`);
    }
    capabilityUnregistered = true;
  } else {
    capability = requireString(row.capability, `${label}.capability`);
    capabilityUnregistered = row.capabilityUnregistered === true;
  }
  const routes = Array.isArray(row.routes) ? row.routes.map((route, i) => requireString(route, `${label}.routes[${i}]`)) : [];
  const recoverability = requireString(row.recoverability, `${label}.recoverability`);
  if (!RECOVERABILITY.includes(recoverability)) {
    throw new SourceCoverageError(`${label}.recoverability must be one of ${RECOVERABILITY.join(', ')}`);
  }
  let recoveryAction = null;
  if (recoverability === 'import-operator') {
    recoveryAction = requireString(row.recoveryAction, `${label}.recoveryAction`);
  }
  const disposition = row.disposition === undefined || row.disposition === null ? null : row.disposition;
  if (disposition !== null && disposition !== 'declared-exclusion') {
    // Every other disposition lives downstream (a gap entry or a decision); only a quick adapter's
    // declared exclusion is recorded on the row itself.
    throw new SourceCoverageError(`${label}.disposition may only be null or "declared-exclusion" in the coverage file`);
  }
  return {
    coverageId,
    platform: rowPlatform,
    capability,
    ...(capabilityUnregistered ? { capabilityUnregistered: true } : {}),
    sourceEntity,
    routes,
    reason,
    evidence: normalizeEvidence(row.evidence, label),
    recoverability,
    ...(recoveryAction ? { recoveryAction } : {}),
    ...(nonEmptyString(row.pluginCoverageRef) ? { pluginCoverageRef: row.pluginCoverageRef } : {}),
    disposition,
  };
}

function validateCoverageFile(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new SourceCoverageError('source-coverage.json must be an object { schemaVersion, platform, adapter, rows }');
  }
  if (file.schemaVersion !== SOURCE_COVERAGE_SCHEMA_VERSION) {
    throw new SourceCoverageError(`source-coverage.json schemaVersion must be ${SOURCE_COVERAGE_SCHEMA_VERSION}`);
  }
  const platform = requireString(file.platform, 'source-coverage.json platform');
  const adapter = requireString(file.adapter, 'source-coverage.json adapter');
  if (!COVERAGE_EMITTERS.includes(adapter)) {
    throw new SourceCoverageError(`source-coverage.json adapter ${adapter} is not a known coverage emitter (${COVERAGE_EMITTERS.join(', ')})`);
  }
  if (!Array.isArray(file.rows)) {
    throw new SourceCoverageError('source-coverage.json rows must be an array; an adapter with nothing to report writes rows: []');
  }
  const seen = new Set();
  const rows = file.rows.map((row, index) => {
    const normalized = normalizeCoverageRow(row, index, { platform });
    if (seen.has(normalized.coverageId)) {
      throw new SourceCoverageError(`source-coverage.json lists coverageId ${normalized.coverageId} twice`);
    }
    seen.add(normalized.coverageId);
    if (normalized.disposition === 'declared-exclusion' && !QUICK_ADAPTERS.includes(adapter)) {
      throw new SourceCoverageError(`${normalized.coverageId}: declared-exclusion is only a quick adapter's disposition`);
    }
    return normalized;
  });
  return { schemaVersion: SOURCE_COVERAGE_SCHEMA_VERSION, platform, adapter, rows };
}

function buildCoverageFile({ platform, adapter, rows = [], generatedAt = null }) {
  const file = validateCoverageFile({ schemaVersion: SOURCE_COVERAGE_SCHEMA_VERSION, platform, adapter, rows });
  return generatedAt ? { ...file, generatedAt } : file;
}

// ---------------------------------------------------------------------------------------------
// Adapter row builders
// ---------------------------------------------------------------------------------------------

const DATA_CATEGORIES = new Set(['backend_data', 'backend_metadata', 'public_commerce_data']);

// The OPTIONS probe is a metadata request: inspectEntity records its failure and still issues the
// data request. Only a failed data request (GET, a profile override, a bridge query) means the
// entity was not captured, so an OPTIONS-only 401 on a readable, empty entity produces no row.
function dataRequestErrors(entity) {
  return (entity.requestErrors || []).filter((error) => error && error.request !== 'OPTIONS');
}

function isAuthError(error) {
  return error.status === 401 || error.status === 403;
}

function sampledCount(entity) {
  if (Array.isArray(entity.sampleRecords) && entity.sampleRecords.length) return entity.sampleRecords.length;
  return Number.isInteger(entity.sampleRecordCount) ? entity.sampleRecordCount : 0;
}

// WordPress / WooCommerce. Inputs are the wp-discovery context the adapter already built:
// `entities` (inspected routes) and `classifications` (every candidate route's scope decision).
// A frontend/theme/admin/transient skip is route-scope evidence only and produces no row; a
// duplicate route is not a capability at all.
function buildWordPressCoverageRows({ entities = [], classifications = [], rawDir = 'data/wp-discovery', platform = 'wordpress' } = {}) {
  const rows = [];
  const seen = new Set();
  const push = (row) => {
    if (seen.has(row.coverageId)) return;
    seen.add(row.coverageId);
    rows.push(row);
  };
  for (const entity of entities) {
    if (!entity || !nonEmptyString(entity.entityName)) continue;
    if (sampledCount(entity) > 0) continue;
    const errors = dataRequestErrors(entity);
    if (!errors.length) continue;
    const authGated = errors.some(isAuthError);
    const status = errors.map((error) => error.status).filter((value) => value !== undefined).join(',');
    push({
      coverageId: coverageIdFor(platform, entity.entityName),
      platform,
      capability: null,
      capabilityUnregistered: true,
      sourceEntity: entity.entityName,
      routes: [entity.routePath].filter(nonEmptyString),
      reason: authGated ? 'auth-gated' : 'capture-failed',
      evidence: { artifact: `${rawDir}/${entity.fileName || 'README.md'}`, pointer: `requestErrors (status ${status || 'unknown'})` },
      recoverability: 'import-operator',
      recoveryAction: authGated
        ? `Supply credentials that can read ${entity.routePath} and re-run WordPress discovery for it.`
        : `Fix source access for ${entity.routePath} and re-run WordPress discovery for it.`,
      disposition: null,
    });
  }
  const unsupportedByNamespace = new Map();
  for (const classification of classifications) {
    if (!classification || classification.effectiveAction !== 'skip' || classification.includedByOverride) continue;
    if (DATA_CATEGORIES.has(classification.category)) {
      const sourceEntity = classification.routePath.replace(/^\/+/, '');
      push({
        coverageId: coverageIdFor(platform, sourceEntity),
        platform,
        capability: null,
        capabilityUnregistered: true,
        sourceEntity,
        routes: [classification.routePath],
        reason: 'route-skipped-by-rule',
        evidence: { artifact: `${rawDir}/skipped-routes.json`, pointer: `routes[routePath=${classification.routePath}]` },
        recoverability: 'import-operator',
        recoveryAction: `Re-run WordPress discovery with an audited --include-route override for ${classification.routePath} if this data is needed.`,
        disposition: null,
      });
    } else if (classification.category === 'excluded_credential_bearing') {
      // A source-data route the adapter deliberately never reads because its payload carries live
      // secrets (WooCommerce payment-gateway settings). Not an evidence-only skip: it stays
      // accountable. Not recoverable from the source by design -- the secrets are never read.
      const sourceEntity = classification.routePath.replace(/^\/+/, '');
      push({
        coverageId: coverageIdFor(platform, sourceEntity),
        platform,
        capability: null,
        capabilityUnregistered: true,
        sourceEntity,
        routes: [classification.routePath],
        reason: 'route-skipped-by-rule',
        evidence: { artifact: `${rawDir}/skipped-routes.json`, pointer: `routes[routePath=${classification.routePath}, category=excluded_credential_bearing]` },
        recoverability: 'not-recoverable',
        disposition: null,
      });
    } else if (classification.category === 'excluded_unsupported' && !classification.duplicateOf) {
      // A route the adapter does not support, grouped per namespace so a plugin-heavy site gets
      // one row per unsupported surface rather than one per route.
      const namespace = nonEmptyString(classification.namespace) ? classification.namespace : 'unknown-namespace';
      if (!unsupportedByNamespace.has(namespace)) unsupportedByNamespace.set(namespace, []);
      unsupportedByNamespace.get(namespace).push(classification.routePath);
    }
  }
  for (const [namespace, routes] of unsupportedByNamespace) {
    push({
      coverageId: coverageIdFor(platform, namespace),
      platform,
      capability: null,
      capabilityUnregistered: true,
      sourceEntity: namespace,
      routes: [...routes].sort(),
      reason: 'route-unsupported',
      evidence: { artifact: `${rawDir}/skipped-routes.json`, pointer: `routes[namespace=${namespace}, category=excluded_unsupported]` },
      recoverability: 'requires-development',
      disposition: null,
    });
  }
  return rows;
}

// CSV. An unknown file role and a halted layout are both things the adapter was handed and could
// not turn into entities; each gets a row so the decision the halt asks for cannot be skipped.
function buildCsvCoverageRows({ sourceFiles = [], streams = [], csvInputRoot = null, rawDir = 'data/csv-discovery', platform = 'csv' } = {}) {
  const rows = [];
  const seen = new Set();
  const rel = (file) => (csvInputRoot ? path.relative(csvInputRoot, file) || path.basename(file) : path.basename(file));
  for (const entry of sourceFiles) {
    if (!entry || entry.role !== 'unknown') continue;
    const sourceEntity = rel(entry.file);
    const coverageId = coverageIdFor(platform, sourceEntity);
    if (seen.has(coverageId)) continue;
    seen.add(coverageId);
    rows.push({
      coverageId,
      platform,
      capability: null,
      capabilityUnregistered: true,
      sourceEntity,
      routes: [sourceEntity],
      reason: 'route-unsupported',
      evidence: { artifact: `${rawDir}/fileset.json`, pointer: `sourceFiles[file=${sourceEntity}].role=unknown` },
      recoverability: 'import-operator',
      recoveryAction: `Identify what ${sourceEntity} holds and re-run CSV discovery with --role ${sourceEntity}:<role>.`,
      disposition: null,
    });
  }
  for (const stream of streams) {
    if (!stream || !stream.layout || stream.layout.halt !== true) continue;
    const sourceEntity = rel(stream.primary);
    const coverageId = coverageIdFor(platform, sourceEntity);
    if (seen.has(coverageId)) continue;
    seen.add(coverageId);
    rows.push({
      coverageId,
      platform,
      capability: null,
      capabilityUnregistered: true,
      sourceEntity,
      routes: [sourceEntity],
      reason: 'capture-failed',
      evidence: { artifact: `${rawDir}/fileset.json`, pointer: `streams[primary=${sourceEntity}].layout.halt` },
      recoverability: 'import-operator',
      recoveryAction: `Answer the layout question for ${sourceEntity} and re-run CSV discovery.`,
      disposition: null,
    });
  }
  return rows;
}

// Shopify (private data, read through the Shopify CLI). Inputs are the discovery capture's failed
// reads -- `{ entity, artifact, errors[] }` per entity whose count or sample read errored -- plus
// the rows other discovery steps already built. A failed read is a `capture-failed` row, never an
// empty entity. `capability` is the registry string where one exists, otherwise null.
const SHOPIFY_CAPABILITIES = Object.freeze({
  products: 'commerce.catalog-product',
  orders: 'commerce.orders',
  customers: 'crm.contact',
  'gift-cards': 'commerce.gift-cards',
  articles: 'content.blog-post',
  files: 'media.file',
  'inventory-items': 'commerce.inventory',
  'delivery-profiles': 'commerce.delivery-profiles',
});

function shopifyCapability(sourceEntity) {
  const capability = SHOPIFY_CAPABILITIES[sourceEntity];
  return capability ? { capability } : { capability: null, capabilityUnregistered: true };
}

function buildShopifyCoverageRows({ captureFailures = [], stepRows = [], rawDir = 'data/shopify-discovery', platform = 'shopify' } = {}) {
  const rows = [];
  const seen = new Set();
  const push = (row) => {
    if (seen.has(row.coverageId)) return;
    seen.add(row.coverageId);
    rows.push(row);
  };
  for (const failed of captureFailures) {
    if (!failed || !nonEmptyString(failed.entity)) continue;
    const codes = (failed.errors || []).map((error) => error && (error.code || error.class)).filter(nonEmptyString);
    push({
      coverageId: coverageIdFor(platform, failed.entity),
      platform,
      ...shopifyCapability(failed.entity),
      sourceEntity: failed.entity,
      routes: (failed.reads || []).filter(nonEmptyString),
      reason: 'capture-failed',
      evidence: { artifact: nonEmptyString(failed.artifact) ? failed.artifact : `${rawDir}/README.md`, pointer: `errors (${[...new Set(codes)].join(',') || 'unknown'})` },
      recoverability: 'import-operator',
      recoveryAction: `Fix the Shopify read of ${failed.entity} and re-run Shopify discovery with --reread ${failed.entity}.`,
      disposition: null,
    });
  }
  for (const row of stepRows) push(row);
  return rows;
}

// Quick mode. Every `excluded[]` entry is a declared exclusion under the existing quick-mode
// scope policy; the row keeps the source name and carries the committed capability translation.
function buildQuickCoverageRows(contract, { rawText = null } = {}) {
  const errors = validateQuickExcludedCapabilities(contract, { rawText });
  if (errors.length) throw new SourceCoverageError(`quick-mode.json excludedCapabilities is invalid: ${errors.join('; ')}`, errors.map((message) => ({ code: 'invalid_quick_contract', message })));
  return contract.excluded.map((sourceEntity) => ({
    coverageId: coverageIdFor(contract.platform, sourceEntity),
    platform: contract.platform,
    capability: contract.excludedCapabilities[sourceEntity],
    // Until the capability registry exists, a source-scope.* string is not registered anywhere.
    ...(contract.excludedCapabilities[sourceEntity].startsWith('source-scope.') ? { capabilityUnregistered: true } : {}),
    sourceEntity,
    routes: [],
    reason: 'adapter-excluded',
    evidence: { artifact: `resources/rp-${contract.id}/quick-mode.json`, pointer: `excluded[${contract.excluded.indexOf(sourceEntity)}]` },
    recoverability: 'not-recoverable',
    disposition: 'declared-exclusion',
  }));
}

// The committed quick-mode contract for a quick adapter id; what a declared exclusion is checked
// against. Read from the bundle, never from the project, so a stale or hand-edited coverage file
// or plan cannot vouch for itself.
function bundledQuickContract(adapter) {
  if (!QUICK_ADAPTERS.includes(adapter)) return null;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(__dirname, '..', 'resources', `rp-${adapter}`, 'quick-mode.json'));
}

let cachedCapabilityKeys = null;
function bundledCapabilityKeys() {
  if (!cachedCapabilityKeys) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const index = require(path.join(__dirname, '..', 'resources', 'rp-target-wix', 'domains', 'index.json'));
    cachedCapabilityKeys = new Set(Object.keys(index.capabilityIndex || {}));
  }
  return cachedCapabilityKeys;
}

// JSON.parse keeps the last of two equal keys, so a duplicate key in the committed file would be
// silently resolved by position. Scan the raw text of the (flat, string-valued) object instead.
function duplicateExcludedCapabilityKeys(text) {
  const start = text.indexOf('"excludedCapabilities"');
  if (start === -1) return [];
  const open = text.indexOf('{', start);
  const close = text.indexOf('}', open);
  if (open === -1 || close === -1) return [];
  const seen = new Set();
  const duplicates = new Set();
  for (const match of text.slice(open + 1, close).matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

// The committed translation from quick-mode source-scope names to capability strings. No
// translation is inferred: exactly one key per excluded[] entry, each value an existing target
// capability or `source-scope.<its own key>`.
function validateQuickExcludedCapabilities(contract, { capabilityKeys = bundledCapabilityKeys(), rawText = null } = {}) {
  const errors = rawText ? duplicateExcludedCapabilityKeys(rawText).map((key) => `excludedCapabilities lists key ${key} more than once`) : [];
  if (!contract || typeof contract !== 'object') return ['quick-mode contract must be an object'];
  const excluded = Array.isArray(contract.excluded) ? contract.excluded : null;
  if (!excluded) return ['excluded must be an array'];
  const map = contract.excludedCapabilities;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['excludedCapabilities must be an object with one key per excluded[] entry'];
  const seenExcluded = new Set();
  for (const name of excluded) {
    if (seenExcluded.has(name)) errors.push(`excluded[] lists ${name} twice`);
    seenExcluded.add(name);
    if (!Object.prototype.hasOwnProperty.call(map, name)) errors.push(`excludedCapabilities is missing ${name}`);
  }
  for (const [key, value] of Object.entries(map)) {
    if (!seenExcluded.has(key)) {
      errors.push(`excludedCapabilities has extra key ${key} that is not in excluded[]`);
      continue;
    }
    if (typeof value !== 'string' || !value) {
      errors.push(`excludedCapabilities.${key} must be a capability string`);
      continue;
    }
    if (value.startsWith('source-scope.')) {
      if (value !== `source-scope.${key}`) errors.push(`excludedCapabilities.${key}: a source-scope value must be source-scope.${key} (got ${value})`);
    } else if (!capabilityKeys.has(value)) {
      errors.push(`excludedCapabilities.${key}: ${value} is neither a target capability nor source-scope.${key}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// The join: exactly one valid disposition per row
// ---------------------------------------------------------------------------------------------

function readGapList(gaps) {
  if (Array.isArray(gaps)) return gaps;
  if (gaps && Array.isArray(gaps.gaps)) return gaps.gaps;
  return [];
}

function schemaEntityNames(sourceSchema) {
  const entities = sourceSchema && sourceSchema.entities;
  if (Array.isArray(entities)) {
    return new Set(entities.map((entity) => entity && (entity.name || entity.entityName || entity.sourceEntity)).filter(nonEmptyString));
  }
  if (entities && typeof entities === 'object') return new Set(Object.keys(entities));
  return new Set();
}

function registerEntry(registers, register, capability) {
  const list = registers && registers[register];
  if (!Array.isArray(list)) return null;
  return list.find((entry) => entry && entry.capability === capability && nonEmptyString(entry.decidedBy)) || null;
}

// Does the cited gate exist? This only validates; it never creates one.
function citedGateExists(gate, evidence, lazy) {
  if (!evidence || typeof evidence !== 'object') return false;
  if (nonEmptyString(evidence.register)) {
    if (gate === 'exclusion' && evidence.register !== 'no-migration-needed') return false;
    if (!['no-migration-needed', 'requires-development'].includes(evidence.register)) return false;
    return Boolean(registerEntry(lazy.registers(), evidence.register, evidence.capability));
  }
  if (gate === 'loss-accepted' && evidence.approval === 'mapping') {
    const approvals = lazy.approvals();
    const mapping = approvals && approvals.mapping;
    return Boolean(mapping && mapping.status === 'approved');
  }
  return false;
}

function failure(code, coverageId, message, sources = []) {
  return { code, coverageId, message, sources };
}

// Pure over its inputs. `sourceSchema`, `registers` and `approvals` may be values or thunks; they
// are only consulted for a `provided` decision or a cited gate, so the common case reads exactly
// the coverage, gaps and decisions files.
function reconcileSourceCoverage({ coverage, gaps, decisions, sourceSchema = null, registers = null, approvals = null, quickContract = null } = {}) {
  const file = validateCoverageFile(coverage);
  const once = (value) => {
    let loaded = false;
    let result;
    return () => {
      if (!loaded) { result = typeof value === 'function' ? value() : value; loaded = true; }
      return result;
    };
  };
  const lazy = {
    sourceSchema: once(sourceSchema),
    registers: once(registers),
    approvals: once(approvals),
    quickContract: once(quickContract || (() => bundledQuickContract(file.adapter))),
  };
  const failures = [];
  const rowsById = new Map(file.rows.map((row) => [row.coverageId, row]));
  const isQuick = QUICK_ADAPTERS.includes(file.adapter);

  const gapsById = new Map();
  readGapList(gaps).forEach((gap, index) => {
    if (!gap || !nonEmptyString(gap.coverageId)) return;
    if (!rowsById.has(gap.coverageId)) {
      failures.push(failure('unknown_coverage_id', gap.coverageId, `mapping-gaps.json entry ${index} references unknown coverageId ${gap.coverageId}`, [`gap[${index}]`]));
      return;
    }
    if (!gapsById.has(gap.coverageId)) gapsById.set(gap.coverageId, []);
    gapsById.get(gap.coverageId).push({ gap, index });
  });

  const decisionsById = new Map();
  for (const [key, entry] of Object.entries(decisions || {})) {
    if (!key.startsWith(DECISION_PREFIX)) continue;
    const coverageId = key.slice(DECISION_PREFIX.length);
    if (!rowsById.has(coverageId)) {
      failures.push(failure('unknown_coverage_id', coverageId, `decision ${key} references unknown coverageId ${coverageId}`, [`decision:${key}`]));
      continue;
    }
    const value = entry && typeof entry === 'object' ? entry.value : entry;
    if (!DECISION_VALUES.includes(value)) {
      failures.push(failure('invalid_decision', coverageId, `decision ${key} must be provided or declined (got ${JSON.stringify(value)})`, [`decision:${key}`]));
      continue;
    }
    decisionsById.set(coverageId, { key, value });
  }

  const resolved = [];
  for (const row of file.rows) {
    const rowGaps = gapsById.get(row.coverageId) || [];
    const decision = decisionsById.get(row.coverageId) || null;
    const declared = row.disposition === 'declared-exclusion';
    const sources = [
      ...rowGaps.map(({ index }) => `gap[${index}]`),
      ...(decision ? [`decision:${decision.key}`] : []),
      ...(declared ? ['declared-exclusion'] : []),
    ];
    if (sources.length === 0) {
      failures.push(failure('missing_disposition', row.coverageId, `${row.coverageId} has no disposition: record a mapping-gaps.json entry with this coverageId or a ${DECISION_PREFIX}${row.coverageId} decision`));
      continue;
    }
    if (sources.length > 1) {
      failures.push(failure('disposition_conflict', row.coverageId, `${row.coverageId} has ${sources.length} active dispositions (${sources.join(', ')}); exactly one is allowed`, sources));
      continue;
    }
    if (isQuick && row.reason !== 'adapter-excluded') {
      failures.push(failure('quick_reason_unsupported', row.coverageId, `${row.coverageId}: a quick adapter may only report adapter-excluded rows (got ${row.reason})`, sources));
      continue;
    }

    if (declared) {
      // Declared exclusion: only on an adapter-excluded row from a quick adapter, for a name that
      // adapter's committed contract lists in excluded[], carrying that contract's translation.
      // A stale or forged row has no status floor to fall back on, so it is refused here.
      if (row.reason !== 'adapter-excluded' || !isQuick) {
        failures.push(failure('gate_reason_mismatch', row.coverageId, `${row.coverageId}: declared-exclusion is valid only on a quick adapter's adapter-excluded row`, sources));
        continue;
      }
      const contract = lazy.quickContract();
      const excluded = contract && Array.isArray(contract.excluded) ? contract.excluded : [];
      if (!excluded.includes(row.sourceEntity)) {
        failures.push(failure('gate_reason_mismatch', row.coverageId, `${row.coverageId}: ${row.sourceEntity} is not in the ${file.adapter} contract's excluded[]; re-run quick-mode plan`, sources));
        continue;
      }
      const committed = contract.excludedCapabilities && contract.excludedCapabilities[row.sourceEntity];
      if (row.capability !== committed) {
        failures.push(failure('gate_reason_mismatch', row.coverageId, `${row.coverageId}: capability ${row.capability} does not match the committed translation ${committed || 'none'}; re-run quick-mode plan`, sources));
        continue;
      }
      resolved.push({ row, disposition: 'declared-exclusion', treatment: 'gated-exclusion', gate: null, gateEvidence: null, handling: null });
      continue;
    }

    if (decision) {
      if (decision.value === 'provided') {
        const names = schemaEntityNames(lazy.sourceSchema());
        if (!names.has(row.sourceEntity)) {
          failures.push(failure('disposition_stale', row.coverageId, `${row.coverageId}: decision is "provided" but ${row.sourceEntity} is not an entity in source-schema.json; re-run discovery or record "declined"`, sources));
          continue;
        }
        resolved.push({ row, disposition: 'recovered', treatment: 'recovered', gate: null, gateEvidence: null, handling: null });
      } else {
        resolved.push({
          row,
          disposition: 'declined',
          treatment: row.reason === 'adapter-excluded' ? 'ungated-exclusion' : 'unresolved',
          gate: null,
          gateEvidence: null,
          handling: null,
        });
      }
      continue;
    }

    const { gap } = rowGaps[0];
    const gate = gap.gate === undefined || gap.gate === null ? null : gap.gate;
    const handling = nonEmptyString(gap.recommendedHandling) ? gap.recommendedHandling : (nonEmptyString(gap.handling) ? gap.handling : null);
    if (gate === null) {
      resolved.push({ row, disposition: 'gap', treatment: row.reason === 'adapter-excluded' ? 'ungated-exclusion' : 'unresolved', gate: null, gateEvidence: null, handling });
      continue;
    }
    if (!GATES.includes(gate)) {
      failures.push(failure('invalid_gate', row.coverageId, `${row.coverageId}: gate must be one of ${GATES.join(', ')} (got ${JSON.stringify(gate)})`, sources));
      continue;
    }
    const evidence = gap.gateEvidence || null;
    if (gate === 'exclusion') {
      // A gated exclusion has no status floor, so it must be exactly what it claims: an
      // adapter exclusion backed by a signed no-migration-needed entry for this capability.
      const evidenceCapability = evidence && evidence.capability;
      if (row.reason !== 'adapter-excluded' || !row.capability || evidenceCapability !== row.capability || (evidence && evidence.register !== 'no-migration-needed')) {
        failures.push(failure('gate_reason_mismatch', row.coverageId, `${row.coverageId}: an exclusion gate is valid only on an adapter-excluded row whose no-migration-needed entry names its own capability (reason ${row.reason}, row capability ${row.capability}, cited ${evidenceCapability || 'none'})`, sources));
        continue;
      }
    }
    if (gate === 'loss-accepted' && evidence && nonEmptyString(evidence.register) && evidence.capability !== row.capability) {
      failures.push(failure('gate_reason_mismatch', row.coverageId, `${row.coverageId}: the cited ${evidence.register} entry names ${evidence.capability}, not this row's capability ${row.capability}`, sources));
      continue;
    }
    if (!citedGateExists(gate, evidence, lazy)) {
      failures.push(failure('gate_missing', row.coverageId, `${row.coverageId}: the cited ${gate} gate does not exist; reconcile never creates one`, sources));
      continue;
    }
    resolved.push({
      row,
      disposition: 'gap',
      treatment: gate === 'exclusion' ? 'gated-exclusion' : 'accepted-loss',
      gate,
      gateEvidence: evidence,
      handling,
    });
  }

  return { ok: failures.length === 0, adapter: file.adapter, platform: file.platform, failures, resolved };
}

// ---------------------------------------------------------------------------------------------
// Completion: status floor, headline, sourceCoverage[] and operator actions
// ---------------------------------------------------------------------------------------------

function labelOf(row) {
  return row.capability || row.sourceEntity;
}

// What the Cutover Operator reads about a row it can only act on in Wix. Source recovery is
// mentioned only for an `import-operator` row; a `not-recoverable` row (for example a
// credential-bearing route whose secrets are never read) or a `requires-development` row must
// never suggest that the source can still supply the data through an operator.
function sourceRecoveryNote(recoverability) {
  switch (recoverability) {
    case 'import-operator':
      return ' Recovering it from the source is Import Operator work before the source is retired.';
    case 'requires-development':
      return ' This migration cannot recover it from the source without new adapter development.';
    default:
      return ' This migration cannot recover it from the source.';
  }
}

function cutoverActionFor(treatment, label, recoverability) {
  switch (treatment) {
    case 'gated-exclusion':
      return `Excluded by the chosen scope: ${label} is not part of this migration. Set it up in Wix separately only if the business needs it.`;
    case 'ungated-exclusion':
      return `Excluded without a recorded review: confirm with the merchant whether ${label} needs to be set up in Wix.`;
    case 'accepted-loss':
      return `Accepted loss: ${label} was left behind by a recorded decision. Nothing to recreate unless that decision changes.`;
    default:
      return `Not migrated: recreate or confirm ${label} in Wix if the business still needs it.${sourceRecoveryNote(recoverability)}`;
  }
}

function headlineFor(treatment, label, reasons) {
  const reasonText = [...reasons].sort().join(', ');
  switch (treatment) {
    case 'ungated-exclusion':
      return `${label}: excluded from the source without a recorded gate (${reasonText})`;
    case 'accepted-loss':
      return `${label}: not migrated from the source; loss accepted (${reasonText})`;
    default:
      return `${label}: not migrated from the source (${reasonText})`;
  }
}

function preContractSummary() {
  return {
    sourceCoverageRecorded: false,
    sourceCoverageReason: PRE_CONTRACT_REASON,
    sourceCoverage: [],
    operatorActions: [],
    headline: [{ entity: 'source-coverage', subtype: 'source-coverage', message: PRE_CONTRACT_HEADLINE }],
    status: STATUS_FLOOR['pre-contract'],
  };
}

// The pure join. Throws on any reconcile failure, so a writer refuses instead of choosing a status.
// `coverage: null` means a pre-contract project (no stamp); the caller decides that, never this.
function summarizeSourceCoverage({ coverage, gaps, decisions, sourceSchema = null, registers = null, approvals = null, quickContract = null } = {}) {
  if (coverage === null) return preContractSummary();
  const result = reconcileSourceCoverage({ coverage, gaps, decisions, sourceSchema, registers, approvals, quickContract });
  if (!result.ok) {
    throw new SourceCoverageError(
      `source coverage does not reconcile: ${result.failures.map((item) => `${item.code} ${item.coverageId || ''}`.trim()).join('; ')}`,
      result.failures,
    );
  }

  let status = null;
  const sourceCoverage = [];
  const grouped = new Map();
  const gatedCapabilities = new Set();
  for (const item of result.resolved) {
    status = worse(status, STATUS_FLOOR[item.treatment]);
    if (item.treatment === 'recovered') continue;
    const label = labelOf(item.row);
    sourceCoverage.push({
      coverageId: item.row.coverageId,
      platform: item.row.platform,
      capability: item.row.capability,
      sourceEntity: item.row.sourceEntity,
      reason: item.row.reason,
      recoverability: item.row.recoverability,
      disposition: item.disposition,
      treatment: item.treatment,
      gate: item.gate,
      gateEvidence: item.gateEvidence,
      recommendedHandling: item.handling,
      cutoverAction: cutoverActionFor(item.treatment, label, item.row.recoverability),
    });
    if (item.treatment === 'gated-exclusion') {
      gatedCapabilities.add(label);
      continue;
    }
    const key = `${item.treatment}\0${label}`;
    if (!grouped.has(key)) grouped.set(key, { treatment: item.treatment, label, reasons: new Set(), urgent: false, sourceRecoverable: false });
    const group = grouped.get(key);
    group.reasons.add(item.row.reason);
    if (item.row.recoverability === 'import-operator') group.sourceRecoverable = true;
    if (item.treatment === 'unresolved' && URGENT_REASONS.has(item.row.reason)) group.urgent = true;
  }

  const headline = [];
  const operatorActions = [];
  for (const group of grouped.values()) {
    headline.push({ entity: group.label, subtype: 'source-coverage', message: headlineFor(group.treatment, group.label, group.reasons) });
    if (group.urgent) {
      operatorActions.push({
        code: 'source-capability-not-migrated',
        severity: 'high',
        action: `${group.label} was not migrated from the source (${[...group.reasons].sort().join(', ')}). Recreate or confirm it in Wix${group.sourceRecoverable ? '; recovering it from the source requires the Import Operator in the original migration environment' : ''}.`,
        deadlineReason: 'the source is still the only copy of this data',
        entity: group.label,
        affectedCount: 0,
      });
    }
  }
  if (gatedCapabilities.size) {
    headline.push({
      entity: 'source-coverage',
      subtype: 'source-coverage',
      message: `${gatedCapabilities.size} source capabilit${gatedCapabilities.size === 1 ? 'y' : 'ies'} excluded by the chosen scope`,
    });
  }

  return {
    sourceCoverageRecorded: true,
    sourceCoverageReason: null,
    sourceCoverage,
    operatorActions,
    headline,
    status,
  };
}

// ---------------------------------------------------------------------------------------------
// Project I/O: the stamp, the fail-closed loaders, and the decision writer
// ---------------------------------------------------------------------------------------------

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new SourceCoverageError(`${filePath} could not be read as JSON: ${error.message}`);
  }
}

function contractStampOf(document, label) {
  if (!document || typeof document !== 'object' || document.sourceCoverageContract === undefined) return null;
  if (document.sourceCoverageContract !== SOURCE_COVERAGE_CONTRACT) {
    throw new SourceCoverageError(`${label} carries unknown sourceCoverageContract ${JSON.stringify(document.sourceCoverageContract)}`);
  }
  return SOURCE_COVERAGE_CONTRACT;
}

// Full mode reads the stamp only from the project-root source-schema.json; quick mode only from
// quick-mode/plan.json. Never from anywhere else.
async function readCoverageContract(projectDir, { mode = 'full', readJson = readJsonFile } = {}) {
  const file = mode === 'quick' ? QUICK_PLAN_FILE : SOURCE_SCHEMA_FILE;
  const document = await readJson(path.join(projectDir, file));
  return { stamped: contractStampOf(document, file) === SOURCE_COVERAGE_CONTRACT, document: document || null, file };
}

async function loadRegisters() {
  const dir = path.join(__dirname, '..', 'resources', 'rp-source-wordpress', 'plugins');
  const read = async (name) => {
    const document = await readJsonFile(path.join(dir, `${name}.json`));
    return Array.isArray(document && document.capabilities) ? document.capabilities : [];
  };
  return { 'no-migration-needed': await read('no-migration-needed'), 'requires-development': await read('requires-development') };
}

// Loads the three named files (coverage, gaps, decisions), failing closed on a missing coverage
// file. The source schema, registers and approvals are read only when a row actually needs them.
async function loadCoverageInputs(projectDir, { readJson = readJsonFile } = {}) {
  const coverage = await readJson(path.join(projectDir, SOURCE_COVERAGE_FILE));
  if (coverage === undefined) {
    throw new SourceCoverageError(`${SOURCE_COVERAGE_FILE} is missing; it is never optional for a current adapter`, [
      { code: 'missing_coverage_file', coverageId: null, message: `${SOURCE_COVERAGE_FILE} is missing`, sources: [] },
    ]);
  }
  const gaps = (await readJson(path.join(projectDir, MAPPING_GAPS_FILE))) || [];
  const decisions = (await readJson(path.join(projectDir, DECISIONS_FILE))) || {};
  return { coverage, gaps, decisions };
}

function needsLazyInputs(inputs) {
  const gaps = readGapList(inputs.gaps);
  const anyProvided = Object.entries(inputs.decisions || {}).some(([key, entry]) => key.startsWith(DECISION_PREFIX) && entry && entry.value === 'provided');
  const anyRegister = gaps.some((gap) => gap && gap.coverageId && gap.gateEvidence && gap.gateEvidence.register);
  const anyApproval = gaps.some((gap) => gap && gap.coverageId && gap.gateEvidence && gap.gateEvidence.approval);
  return { anyProvided, anyRegister, anyApproval };
}

// Eagerly resolves the lazily-needed side inputs (async), but only those a row will consult.
async function resolveSideInputs(projectDir, inputs, { readJson = readJsonFile, registers = null } = {}) {
  const need = needsLazyInputs(inputs);
  return {
    sourceSchema: need.anyProvided ? (await readJson(path.join(projectDir, SOURCE_SCHEMA_FILE))) || null : null,
    registers: need.anyRegister ? (registers || (await loadRegisters())) : null,
    approvals: need.anyApproval ? (await readJson(path.join(projectDir, APPROVALS_FILE))) || null : null,
  };
}

async function reconcileProject(projectDir, { readJson = readJsonFile, registers = null } = {}) {
  const inputs = await loadCoverageInputs(projectDir, { readJson });
  const side = await resolveSideInputs(projectDir, inputs, { readJson, registers });
  return reconcileSourceCoverage({ ...inputs, ...side });
}

// The completion-time join for a project. `mode: 'quick'` reads the quick-mode plan stamp.
// The pre-contract exception is bounded to an unstamped full-mode source-schema.json; a quick
// plan written since Phase 1 always carries the stamp, so a missing or unstamped one refuses.
async function summarizeProjectCoverage(projectDir, { mode = 'full', readJson = readJsonFile, registers = null } = {}) {
  const contract = await readCoverageContract(projectDir, { mode, readJson });
  if (!contract.stamped && mode === 'quick') {
    const what = contract.document ? 'has no sourceCoverageContract stamp' : 'is missing';
    throw new SourceCoverageError(`${QUICK_PLAN_FILE} ${what}; re-run quick-mode plan before import`, [
      { code: 'quick_plan_unstamped', coverageId: null, message: `${QUICK_PLAN_FILE} ${what}`, sources: [] },
    ]);
  }
  if (!contract.stamped) return summarizeSourceCoverage({ coverage: null });
  const inputs = await loadCoverageInputs(projectDir, { readJson });
  const side = await resolveSideInputs(projectDir, inputs, { readJson, registers });
  return summarizeSourceCoverage({ ...inputs, ...side });
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, filePath);
}

// Promotion: validate the adapter's file, copy it to discovery/, and stamp the canonical
// project-root source-schema.json. Refuses for an unknown adapter, a missing adapter file or a
// missing source schema -- there is no unstamped path for a current adapter.
async function promoteSourceCoverage(projectDir, { adapter }) {
  if (!COVERAGE_EMITTERS.includes(adapter) || QUICK_ADAPTERS.includes(adapter)) {
    throw new SourceCoverageError(`adapter ${adapter} cannot promote discovery: full-discovery coverage emitters are ${Object.keys(ADAPTER_RAW_DIRS).join(', ')}`);
  }
  const adapterFile = path.join(projectDir, ADAPTER_RAW_DIRS[adapter], ADAPTER_COVERAGE_FILE_NAME);
  const raw = await readJsonFile(adapterFile);
  if (raw === undefined) {
    throw new SourceCoverageError(`${path.relative(projectDir, adapterFile)} is missing; the ${adapter} adapter must write it (rows: [] when there is nothing to report) before discovery is promoted`, [
      { code: 'missing_coverage_file', coverageId: null, message: 'adapter coverage file missing', sources: [] },
    ]);
  }
  const file = validateCoverageFile(raw);
  if (file.adapter !== adapter) throw new SourceCoverageError(`adapter coverage file names adapter ${file.adapter}, not ${adapter}`);
  const schemaPath = path.join(projectDir, SOURCE_SCHEMA_FILE);
  const schema = await readJsonFile(schemaPath);
  if (!schema || typeof schema !== 'object') {
    throw new SourceCoverageError(`${SOURCE_SCHEMA_FILE} must be synthesized before source coverage is promoted`);
  }
  await writeJsonAtomic(path.join(projectDir, SOURCE_COVERAGE_FILE), { ...file, ...(raw.generatedAt ? { generatedAt: raw.generatedAt } : {}) });
  await writeJsonAtomic(schemaPath, { ...schema, sourceCoverageContract: SOURCE_COVERAGE_CONTRACT });
  return { coveragePath: path.join(projectDir, SOURCE_COVERAGE_FILE), rows: file.rows.length };
}

// A coverage row first found after discovery (during the import) joins the adapter's raw file by
// coverageId -- a row with the same id is replaced, otherwise appended -- and the file is
// re-promoted, so the canonical record and the stamp come from the one promotion path. What the
// run does next is the general path for every source; this writes no gap, decision or approval.
async function upsertAdapterCoverageRows(projectDir, { adapter, rows, checkpoint = null }) {
  if (!COVERAGE_EMITTERS.includes(adapter) || QUICK_ADAPTERS.includes(adapter)) {
    throw new SourceCoverageError(`adapter ${adapter} has no adapter coverage file to update`);
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new SourceCoverageError('upsertAdapterCoverageRows needs at least one row');
  const adapterFile = path.join(projectDir, ADAPTER_RAW_DIRS[adapter], ADAPTER_COVERAGE_FILE_NAME);
  const raw = await readJsonFile(adapterFile);
  if (raw === undefined) {
    throw new SourceCoverageError(`${path.relative(projectDir, adapterFile)} is missing; discovery must have written it before a row can be added`, [
      { code: 'missing_coverage_file', coverageId: null, message: 'adapter coverage file missing', sources: [] },
    ]);
  }
  const file = validateCoverageFile(raw);
  if (file.adapter !== adapter) throw new SourceCoverageError(`adapter coverage file names adapter ${file.adapter}, not ${adapter}`);
  const merged = [...file.rows];
  let added = 0;
  let replaced = 0;
  for (const [index, candidate] of rows.entries()) {
    const normalized = normalizeCoverageRow(candidate, index, { platform: file.platform });
    const at = merged.findIndex((existing) => existing.coverageId === normalized.coverageId);
    if (at === -1) { merged.push(normalized); added += 1; } else { merged[at] = normalized; replaced += 1; }
  }
  const next = validateCoverageFile({ ...file, rows: merged });
  await writeJsonAtomic(adapterFile, { ...next, ...(raw.generatedAt ? { generatedAt: raw.generatedAt } : {}) });
  // Optional checkpoints let recovery tests stop between the two durable writes.
  if (typeof checkpoint === 'function') await checkpoint('after-row-upsert');
  await promoteSourceCoverage(projectDir, { adapter });
  if (typeof checkpoint === 'function') await checkpoint('after-re-promotion');
  return { added, replaced, rows: next.rows.length };
}

// The rp-mapper decision writer. Recording a `sourceCoverage:` decision removes that row's gap
// entries in the same write, so the normal recovery path never creates a disposition conflict.
// Gaps are written first: an interruption between the two writes leaves a row with no
// disposition (reconcile fails closed; re-running this fixes it), never a silent conflict.
async function recordCoverageDecision(projectDir, { coverageId, value, rationale = null, source = 'user', timestamp = new Date().toISOString() }) {
  requireString(coverageId, 'coverageId');
  if (!DECISION_VALUES.includes(value)) throw new SourceCoverageError(`decision value must be one of ${DECISION_VALUES.join(', ')}`);
  const inputs = await loadCoverageInputs(projectDir);
  const file = validateCoverageFile(inputs.coverage);
  if (!file.rows.some((row) => row.coverageId === coverageId)) {
    throw new SourceCoverageError(`unknown coverageId ${coverageId}`);
  }
  const gapsPath = path.join(projectDir, MAPPING_GAPS_FILE);
  const rawGaps = await readJsonFile(gapsPath);
  let removed = 0;
  if (rawGaps !== undefined) {
    const keep = (gap) => {
      if (gap && gap.coverageId === coverageId) { removed += 1; return false; }
      return true;
    };
    const next = Array.isArray(rawGaps) ? rawGaps.filter(keep)
      : rawGaps && Array.isArray(rawGaps.gaps) ? { ...rawGaps, gaps: rawGaps.gaps.filter(keep) } : rawGaps;
    if (removed) await writeJsonAtomic(gapsPath, next);
  }
  const decisionsPath = path.join(projectDir, DECISIONS_FILE);
  const decisions = (await readJsonFile(decisionsPath)) || {};
  decisions[`${DECISION_PREFIX}${coverageId}`] = { value, decidedAt: timestamp, source, rationale };
  await writeJsonAtomic(decisionsPath, decisions);
  return { coverageId, value, removedGaps: removed };
}

// Quick-mode `plan`: write the declared-exclusion rows, run the same reconcile check, and return
// the stamp the plan must carry. Throws (so the plan is not written) when either fails.
async function writeQuickPlanCoverage(projectDir, contract, { rawText = null, generatedAt = new Date().toISOString() } = {}) {
  const rows = buildQuickCoverageRows(contract, { rawText });
  const file = buildCoverageFile({ platform: contract.platform, adapter: contract.id, rows });
  const result = reconcileSourceCoverage({ coverage: file, gaps: [], decisions: {}, quickContract: contract });
  if (!result.ok) {
    throw new SourceCoverageError(`quick-mode source coverage does not reconcile: ${result.failures.map((item) => item.code).join(', ')}`, result.failures);
  }
  await writeJsonAtomic(path.join(projectDir, SOURCE_COVERAGE_FILE), { ...file, generatedAt });
  return { sourceCoverageContract: SOURCE_COVERAGE_CONTRACT, rows: rows.length };
}

// Quick-mode `import`: the completion summary carries the same sourceCoverage[] field and
// coverage status. Throws (so no summary is written) on a stamped plan with a missing or
// unreconciled coverage file.
async function quickSummaryCoverage(projectDir) {
  const summary = await summarizeProjectCoverage(projectDir, { mode: 'quick' });
  return {
    sourceCoverageRecorded: summary.sourceCoverageRecorded,
    ...(summary.sourceCoverageReason ? { sourceCoverageReason: summary.sourceCoverageReason } : {}),
    sourceCoverageStatus: summary.status,
    sourceCoverage: summary.sourceCoverage,
    sourceCoverageHeadline: summary.headline,
  };
}

module.exports = {
  writeQuickPlanCoverage,
  quickSummaryCoverage,
  SOURCE_COVERAGE_SCHEMA_VERSION,
  SOURCE_COVERAGE_CONTRACT,
  COVERAGE_EMITTERS,
  QUICK_ADAPTERS,
  ADAPTER_RAW_DIRS,
  SHOPIFY_CAPABILITIES,
  SOURCE_COVERAGE_FILE,
  ADAPTER_COVERAGE_FILE_NAME,
  SOURCE_SCHEMA_FILE,
  QUICK_PLAN_FILE,
  MAPPING_GAPS_FILE,
  DECISIONS_FILE,
  COVERAGE_REASONS,
  RECOVERABILITY,
  DECISION_PREFIX,
  PRE_CONTRACT_REASON,
  PRE_CONTRACT_HEADLINE,
  SourceCoverageError,
  coverageIdFor,
  normalizeCoverageRow,
  validateCoverageFile,
  buildCoverageFile,
  buildWordPressCoverageRows,
  buildCsvCoverageRows,
  buildShopifyCoverageRows,
  buildQuickCoverageRows,
  validateQuickExcludedCapabilities,
  duplicateExcludedCapabilityKeys,
  reconcileSourceCoverage,
  summarizeSourceCoverage,
  readCoverageContract,
  loadCoverageInputs,
  loadRegisters,
  reconcileProject,
  summarizeProjectCoverage,
  promoteSourceCoverage,
  upsertAdapterCoverageRows,
  recordCoverageDecision,
  writeJsonAtomic,
};
