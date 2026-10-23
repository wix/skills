'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { auditPath: linkAuditPath, readLinkAudit, writeLinkAudit, validateLinkAudit } = require('./link-audit.js');

const SCHEMA_VERSION = 1;

const URL_STATUS = new Set([
  'preserved',
  'redirect_required',
  'pending_target_route',
  'source_url_missing',
  'target_url_missing',
  'not_public',
  'manual_review',
]);
const UNRESOLVED_STATUS = new Set(['open', 'resolved', 'manual_review']);
const REDIRECT_STATUS = new Set(['planned', 'retired']);
const BASE_PATH_STATUS = new Set(['planned', 'verified', 'unverified', 'manual_review']);

function urlPreservationDir(projectDir) {
  return path.join(projectDir, 'state', 'url-preservation');
}

function basePathsPath(projectDir) {
  return path.join(urlPreservationDir(projectDir), 'base-paths.json');
}

function urlLedgerPath(projectDir) {
  return path.join(urlPreservationDir(projectDir), 'url-ledger.ndjson');
}

function redirectsPath(projectDir) {
  return path.join(urlPreservationDir(projectDir), 'redirects.ndjson');
}

function unresolvedPath(projectDir) {
  return path.join(urlPreservationDir(projectDir), 'unresolved.ndjson');
}

// Post-build redirect application/verification state. `redirects.ndjson` stays the import's
// plan record; these files carry the stronger claims (installed, verified) separately.
const EXTENDED_FILES = Object.freeze({
  sourceRedirects: 'source-redirects.ndjson',
  sourceRedirectCoverage: 'source-redirect-coverage.json',
  sourceDomains: 'source-domains.json',
  finalRoutes: 'final-routes.json',
  launchPlan: 'launch-plan.json',
  redirectPlan: 'redirect-plan.json',
  redirectExecution: 'redirect-execution.ndjson',
  urlVerification: 'url-verification.ndjson',
  applyStatus: 'redirect-apply-status.json',
});

function statePath(projectDir, name) {
  if (!EXTENDED_FILES[name]) throw new Error(`unknown url-preservation state file: ${name}`);
  return path.join(urlPreservationDir(projectDir), EXTENDED_FILES[name]);
}

function relativeStatePath(name) {
  return `state/url-preservation/${EXTENDED_FILES[name]}`;
}

async function mkdirp(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function ensureEmptyNdjson(filePath) {
  await mkdirp(path.dirname(filePath));
  if (!(await pathExists(filePath))) {
    await fs.writeFile(filePath, '', 'utf8');
    return true;
  }
  return false;
}

async function writeJsonAtomic(filePath, data) {
  await mkdirp(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function appendNdjson(filePath, row) {
  await mkdirp(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

async function readNdjson(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const rows = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${filePath}:${index + 1} invalid NDJSON: ${error.message}`);
    }
  }
  return rows;
}

function assertObject(row, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(row, field, label, errors) {
  if (!row[field] || typeof row[field] !== 'string') {
    errors.push(`${label}.${field} must be a non-empty string`);
  }
}

function validateTimestamp(row, field, label, errors) {
  if (row[field] !== undefined && Number.isNaN(Date.parse(row[field]))) {
    errors.push(`${label}.${field} must be an ISO timestamp when present`);
  }
}

function validateUrlStatus(row, label, errors) {
  if (row.urlStatus && !URL_STATUS.has(row.urlStatus)) {
    errors.push(`${label}.urlStatus must be one of: ${Array.from(URL_STATUS).join(', ')}`);
  }
}

function validateRow(row, { allowThrow = true, label = 'row', required = [], validate = null } = {}) {
  const errors = [];
  try {
    assertObject(row, label);
  } catch (error) {
    if (allowThrow) {
      throw error;
    }
    return { ok: false, errors: [error.message] };
  }
  if (row.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${label}.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  for (const field of required) {
    requireString(row, field, label, errors);
  }
  validateTimestamp(row, 'createdAt', label, errors);
  validateTimestamp(row, 'updatedAt', label, errors);
  if (validate) {
    validate(row, label, errors);
  }
  if (errors.length && allowThrow) {
    throw new Error(errors.join('; '));
  }
  return { ok: errors.length === 0, errors };
}

function validateLedgerRow(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'URL ledger row',
    allowThrow: options.allowThrow,
    required: [
      'sourceSystem',
      'sourceEntityType',
      'sourceStableKey',
      'targetSystem',
      'targetEntityType',
      'sourceRelativeUrl',
      'urlStatus',
    ],
    validate: validateUrlStatus,
  });
}

function validateRedirectRow(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'redirect row',
    allowThrow: options.allowThrow,
    required: [
      'sourceStableKey',
      'sourceRelativeUrl',
      'targetRelativeUrl',
      'status',
    ],
    validate: (candidate, label, errors) => {
      if (candidate.httpStatus !== 301) {
        errors.push(`${label}.httpStatus must be 301`);
      }
      if (candidate.status && !REDIRECT_STATUS.has(candidate.status)) {
        errors.push(`${label}.status must be one of: ${Array.from(REDIRECT_STATUS).join(', ')}`);
      }
    },
  });
}

function validateUnresolvedRow(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'unresolved row',
    allowThrow: options.allowThrow,
    required: [
      'sourceSystem',
      'sourceEntityType',
      'sourceStableKey',
      'targetSystem',
      'targetEntityType',
      'sourceRelativeUrl',
      'urlStatus',
      'status',
    ],
    validate: (candidate, label, errors) => {
      validateUrlStatus(candidate, label, errors);
      if (candidate.status && !UNRESOLVED_STATUS.has(candidate.status)) {
        errors.push(`${label}.status must be one of: ${Array.from(UNRESOLVED_STATUS).join(', ')}`);
      }
    },
  });
}

function validateBasePathEntry(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'base path entry',
    allowThrow: options.allowThrow,
    required: [
      'sourceSystem',
      'sourceEntityType',
      'targetSystem',
      'targetEntityType',
      'sourceBasePath',
      'sourceUrlPattern',
      'status',
    ],
    validate: (candidate, label, errors) => {
      if (typeof candidate.public !== 'boolean') {
        errors.push(`${label}.public must be a boolean`);
      }
      if (candidate.preserveBasePath !== undefined && typeof candidate.preserveBasePath !== 'boolean') {
        errors.push(`${label}.preserveBasePath must be a boolean when present`);
      }
      if (candidate.preserveSlug !== undefined && typeof candidate.preserveSlug !== 'boolean') {
        errors.push(`${label}.preserveSlug must be a boolean when present`);
      }
      if (candidate.status && !BASE_PATH_STATUS.has(candidate.status)) {
        errors.push(`${label}.status must be one of: ${Array.from(BASE_PATH_STATUS).join(', ')}`);
      }
    },
  });
}

function ledgerKey(row) {
  return `${row.sourceStableKey}\t${row.sourceRelativeUrl}`;
}

function redirectKey(row) {
  return `${row.sourceRelativeUrl}\t${row.targetRelativeUrl}\t${row.httpStatus}`;
}

function unresolvedKey(row) {
  return `${row.sourceStableKey}\t${row.sourceRelativeUrl}\t${row.urlStatus}`;
}

function foldRows(rows, keyFor) {
  const latestByKey = {};
  for (const row of rows) {
    latestByKey[keyFor(row)] = row;
  }
  return latestByKey;
}

async function appendUrlLedgerRow(projectDir, row) {
  validateLedgerRow(row);
  await appendNdjson(urlLedgerPath(projectDir), row);
  return row;
}

async function appendRedirectRow(projectDir, row) {
  validateRedirectRow(row);
  await appendNdjson(redirectsPath(projectDir), row);
  return row;
}

async function appendUnresolvedRow(projectDir, row) {
  validateUnresolvedRow(row);
  await appendNdjson(unresolvedPath(projectDir), row);
  return row;
}

async function loadUrlLedger(projectDir) {
  const rows = await readNdjson(urlLedgerPath(projectDir));
  for (const row of rows) {
    validateLedgerRow(row);
  }
  return { rows, byKey: foldRows(rows, ledgerKey) };
}

async function loadRedirects(projectDir) {
  const rows = await readNdjson(redirectsPath(projectDir));
  for (const row of rows) {
    validateRedirectRow(row);
  }
  return { rows, byKey: foldRows(rows, redirectKey) };
}

// The generated importer's historical redirect file can contain source-rule rows rather
// than keyed URL-preservation rows. Planning must retain each such address for manual
// review without letting one incompatible row abort the rest of the report.
async function loadRedirectsForPlanning(projectDir) {
  let raw;
  try {
    raw = await fs.readFile(redirectsPath(projectDir), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { byKey: {}, rejected: [] };
    throw error;
  }
  const valid = [];
  const rejected = [];
  for (const [index, text] of raw.split(/\r?\n/).entries()) {
    if (!text.trim()) continue;
    let row;
    try { row = JSON.parse(text); } catch { row = null; }
    const checked = validateRedirectRow(row, { allowThrow: false });
    const sourceRuleFields = row && typeof row === 'object' &&
      ['statusCode', 'enabled', 'recordedAt'].some((key) => Object.hasOwn(row, key));
    if (checked.ok && !sourceRuleFields) valid.push(row);
    else rejected.push({
      line: index + 1,
      sourceRelativeUrl: row && typeof row.sourceRelativeUrl === 'string' ? row.sourceRelativeUrl : null,
      reason: sourceRuleFields ? 'import_redirect_source_rule_shape' : 'import_redirect_invalid_row',
      recordedDestination: row && typeof row.targetRelativeUrl === 'string' ? row.targetRelativeUrl : null,
      recordedStatus: row ? { status: typeof row.status === 'string' ? row.status : null, statusCode: Number.isInteger(row.statusCode) ? row.statusCode : null, enabled: typeof row.enabled === 'boolean' ? row.enabled : null } : null,
    });
  }
  return { byKey: Object.fromEntries(Object.entries(foldRows(valid, redirectKey))
    .filter(([, row]) => row.status === 'planned')), rejected };
}

async function loadUnresolved(projectDir) {
  const rows = await readNdjson(unresolvedPath(projectDir));
  for (const row of rows) {
    validateUnresolvedRow(row);
  }
  return { rows, byKey: foldRows(rows, unresolvedKey) };
}

async function writeBasePaths(projectDir, entries) {
  if (!Array.isArray(entries)) {
    throw new Error('base path entries must be an array');
  }
  for (const entry of entries) {
    validateBasePathEntry(entry);
  }
  await writeJsonAtomic(basePathsPath(projectDir), {
    schemaVersion: SCHEMA_VERSION,
    entries,
  });
  return entries;
}

async function loadBasePaths(projectDir) {
  let raw;
  try {
    raw = await fs.readFile(basePathsPath(projectDir), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries)) {
    throw new Error('base-paths.json entries must be an array');
  }
  for (const entry of entries) {
    validateBasePathEntry(entry);
  }
  return { schemaVersion: parsed.schemaVersion || SCHEMA_VERSION, entries };
}

async function initUrlPreservationState(projectDir) {
  await mkdirp(urlPreservationDir(projectDir));
  const actions = [];
  if (!(await pathExists(basePathsPath(projectDir)))) {
    await writeJsonAtomic(basePathsPath(projectDir), {
      schemaVersion: SCHEMA_VERSION,
      entries: [],
    });
    actions.push({ action: 'initialized_url_base_paths', path: 'state/url-preservation/base-paths.json' });
  }
  for (const [filePath, action, relativePath] of [
    [urlLedgerPath(projectDir), 'initialized_url_ledger', 'state/url-preservation/url-ledger.ndjson'],
    [redirectsPath(projectDir), 'initialized_url_redirects', 'state/url-preservation/redirects.ndjson'],
    [unresolvedPath(projectDir), 'initialized_url_unresolved', 'state/url-preservation/unresolved.ndjson'],
  ]) {
    const created = await ensureEmptyNdjson(filePath);
    actions.push({ action: created ? action : action.replace('initialized', 'kept'), path: relativePath });
  }
  await loadBasePaths(projectDir);
  await loadUrlLedger(projectDir);
  await loadRedirects(projectDir);
  await loadUnresolved(projectDir);
  return actions;
}

// --- post-build redirect state (apply/verify) --------------------------------------------

const SOURCE_RULE_MATCH = new Set(['exact', 'prefix', 'regex', 'contains', 'suffix', 'other']);
const COVERAGE_STATUS = new Set(['extracted', 'confirmed_empty', 'unreadable', 'unsupported']);
const ORIGIN_ROLES = new Set(['production', 'alias']);
const CUTOVER_STATUS = new Set(['source_serving', 'destination_serving']);
const READINESS = new Set(['ready', 'pending', 'unknown']);
const FRONTEND_REDIRECT_SUPPORT = new Set(['honors_wix_redirects', 'unverified', 'unsupported']);
const EXECUTION_DISPOSITIONS = new Set([
  'write_intent', 'installed', 'already_present', 'failed', 'outcome_unknown', 'manual_review',
]);
const VERIFICATION_STAGES = new Set(['preparation', 'verified_public']);
const VERIFICATION_RESULTS = new Set(['verified_direct', 'verified_redirect', 'failed', 'not_verified']);

function validateSourceRedirectRow(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'source redirect row',
    allowThrow: options.allowThrow,
    required: ['ruleKey', 'provider', 'stableId', 'source', 'matchType'],
    validate: (candidate, label, errors) => {
      if (typeof candidate.enabled !== 'boolean') errors.push(`${label}.enabled must be a boolean`);
      if (!SOURCE_RULE_MATCH.has(candidate.matchType)) errors.push(`${label}.matchType must be one of: ${[...SOURCE_RULE_MATCH].join(', ')}`);
      if (!candidate.storage || typeof candidate.storage !== 'object' || !candidate.storage.kind) errors.push(`${label}.storage.kind is required (provenance)`);
      if (candidate.statusCode !== null && candidate.statusCode !== undefined && !Number.isInteger(candidate.statusCode)) errors.push(`${label}.statusCode must be an integer or null`);
    },
  });
}

function validateCoverage(doc) {
  assertObject(doc, 'source-redirect-coverage.json');
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new Error(`source-redirect-coverage.json schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(doc.providers)) throw new Error('source-redirect-coverage.json providers must be an array');
  for (const [index, row] of doc.providers.entries()) {
    const label = `source-redirect-coverage.providers[${index}]`;
    assertObject(row, label);
    if (!row.provider || typeof row.provider !== 'string') throw new Error(`${label}.provider is required`);
    if (!COVERAGE_STATUS.has(row.status)) throw new Error(`${label}.status must be one of: ${[...COVERAGE_STATUS].join(', ')}`);
  }
  return doc;
}

function normalizeOrigin(origin, label) {
  assertObject(origin, label);
  if (origin.scheme !== 'http' && origin.scheme !== 'https') throw new Error(`${label}.scheme must be http or https`);
  if (!origin.hostname || typeof origin.hostname !== 'string') throw new Error(`${label}.hostname is required`);
  let hostname;
  try {
    hostname = new URL(`${origin.scheme}://${origin.hostname}`).hostname;
  } catch {
    throw new Error(`${label}.hostname is not a valid hostname`);
  }
  // IDN input is accepted and stored in its ASCII (punycode) form.
  const defaultPort = origin.scheme === 'https' ? 443 : 80;
  const effectivePort = origin.effectivePort === undefined ? defaultPort : origin.effectivePort;
  if (!Number.isInteger(effectivePort) || effectivePort < 1 || effectivePort > 65535) throw new Error(`${label}.effectivePort must be a TCP port`);
  if (!ORIGIN_ROLES.has(origin.role)) throw new Error(`${label}.role must be one of: ${[...ORIGIN_ROLES].join(', ')}`);
  if (!CUTOVER_STATUS.has(origin.cutoverStatus)) throw new Error(`${label}.cutoverStatus must be one of: ${[...CUTOVER_STATUS].join(', ')}`);
  return { scheme: origin.scheme, hostname, effectivePort, role: origin.role, cutoverStatus: origin.cutoverStatus };
}

function originKey(origin) {
  return `${origin.scheme}://${origin.hostname}:${origin.effectivePort}`;
}

// Minimal declared-origin schema. Aliases are never synthesized: only what is listed here is
// an origin of the production site.
function validateSourceDomains(doc) {
  assertObject(doc, 'source-domains.json');
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new Error(`source-domains.json schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(doc.origins) || doc.origins.length === 0) throw new Error('source-domains.json origins must be a non-empty array');
  const origins = doc.origins.map((origin, index) => normalizeOrigin(origin, `source-domains.origins[${index}]`));
  const keys = new Set();
  for (const origin of origins) {
    const key = originKey(origin);
    if (keys.has(key)) throw new Error(`source-domains.json declares ${key} twice`);
    keys.add(key);
  }
  if (!origins.some((origin) => origin.role === 'production')) throw new Error('source-domains.json needs one production origin');
  const productionHosts = new Set(origins.filter((o) => o.role === 'production').map((o) => o.hostname));
  if (productionHosts.size !== 1) throw new Error('source-domains.json production origins must share one hostname');
  if (doc.domains !== undefined && !Array.isArray(doc.domains)) {
    throw new Error('source-domains.json domains must be an array when present');
  }
  return { schemaVersion: SCHEMA_VERSION, productionHostname: [...productionHosts][0], origins,
    ...(doc.domains ? { domains: doc.domains } : {}) };
}

function validateFinalRoutes(doc) {
  assertObject(doc, 'final-routes.json');
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new Error(`final-routes.json schemaVersion must be ${SCHEMA_VERSION}`);
  for (const field of ['siteId', 'deploymentId']) {
    if (!doc[field] || typeof doc[field] !== 'string') throw new Error(`final-routes.json ${field} is required`);
  }
  if (!Array.isArray(doc.routes)) throw new Error('final-routes.json routes must be an array');
  doc.routes.forEach((route, index) => {
    const label = `final-routes.routes[${index}]`;
    assertObject(route, label);
    for (const field of ['sourceKey', 'targetEntityType', 'targetEntityId', 'relativeUrl', 'pageMarker']) {
      if (!route[field] || typeof route[field] !== 'string') throw new Error(`${label}.${field} is required`);
    }
    if (!route.relativeUrl.startsWith('/')) throw new Error(`${label}.relativeUrl must be site-relative`);
  });
  return doc;
}

function validateLaunchPlan(doc) {
  assertObject(doc, 'launch-plan.json');
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new Error(`launch-plan.json schemaVersion must be ${SCHEMA_VERSION}`);
  for (const field of ['siteId', 'deploymentId', 'productionHostname']) {
    if (!doc[field] || typeof doc[field] !== 'string') throw new Error(`launch-plan.json ${field} is required`);
  }
  for (const field of ['domainAssociation', 'https']) {
    if (!READINESS.has(doc[field])) throw new Error(`launch-plan.json ${field} must be one of: ${[...READINESS].join(', ')}`);
  }
  assertObject(doc.frontend, 'launch-plan.json frontend');
  if (!doc.frontend.model || typeof doc.frontend.model !== 'string') throw new Error('launch-plan.json frontend.model is required');
  if (!FRONTEND_REDIRECT_SUPPORT.has(doc.frontend.redirectSupport)) {
    throw new Error(`launch-plan.json frontend.redirectSupport must be one of: ${[...FRONTEND_REDIRECT_SUPPORT].join(', ')}`);
  }
  if (doc.frontend.redirectSupport === 'honors_wix_redirects' && !doc.frontend.evidenceRef) {
    throw new Error('launch-plan.json frontend.evidenceRef is required when redirectSupport is honors_wix_redirects');
  }
  if (doc.dnsInstructions !== undefined) {
    assertObject(doc.dnsInstructions, 'launch-plan.json dnsInstructions');
    if (doc.dnsInstructions.registrarTransferRequired === true || doc.dnsInstructions.changesMailRecords === true) {
      throw new Error('launch-plan.json website DNS instructions must not require a registrar transfer or mail-record changes');
    }
  }
  return doc;
}

function validateExecutionRow(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'redirect execution row',
    allowThrow: options.allowThrow,
    required: ['runId', 'planDigest', 'deploymentId', 'siteId', 'ruleKey', 'from', 'to', 'disposition', 'recordedAt'],
    validate: (candidate, label, errors) => {
      if (!EXECUTION_DISPOSITIONS.has(candidate.disposition)) errors.push(`${label}.disposition must be one of: ${[...EXECUTION_DISPOSITIONS].join(', ')}`);
      if (!Array.isArray(candidate.origins)) errors.push(`${label}.origins must be an array`);
      if (!Array.isArray(candidate.reasonCodes)) errors.push(`${label}.reasonCodes must be an array`);
      if (candidate.disposition === 'write_intent' && !candidate.inventoryDigest) errors.push(`${label}.inventoryDigest is required on write_intent`);
      validateTimestamp(candidate, 'recordedAt', label, errors);
    },
  });
}

function validateVerificationRow(row, options = {}) {
  return validateRow(row, {
    label: options.label || 'url verification row',
    allowThrow: options.allowThrow,
    required: ['checkpointKey', 'obligationKey', 'planDigest', 'deploymentId', 'stage', 'effectiveEndpoint', 'originalUrl', 'result', 'checkedAt'],
    validate: (candidate, label, errors) => {
      if (!VERIFICATION_STAGES.has(candidate.stage)) errors.push(`${label}.stage must be one of: ${[...VERIFICATION_STAGES].join(', ')}`);
      if (!VERIFICATION_RESULTS.has(candidate.result)) errors.push(`${label}.result must be one of: ${[...VERIFICATION_RESULTS].join(', ')}`);
      if (!Array.isArray(candidate.trace)) errors.push(`${label}.trace must be an array`);
      validateTimestamp(candidate, 'checkedAt', label, errors);
    },
  });
}

// Durable append: the row is on disk before the caller does the I/O it announces.
async function appendNdjsonDurable(filePath, row) {
  await mkdirp(path.dirname(filePath));
  const handle = await fs.open(filePath, 'a+');
  try {
    // A crash can leave a torn final line; start on a fresh line so the new row stays valid.
    const { size } = await handle.stat();
    let prefix = '';
    if (size > 0) {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = '\n';
    }
    await handle.write(`${prefix}${JSON.stringify(row)}\n`);
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

// Latest-valid-row reader for execution/verification logs: a torn trailing line (crash mid-
// append) or a malformed row is rejected and reported, never folded and never fatal.
async function readValidatedNdjson(filePath, validate) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { rows: [], rejected: [] };
    throw error;
  }
  const rows = [];
  const rejected = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      rejected.push({ line: index + 1, reason: `invalid JSON: ${error.message}` });
      return;
    }
    const result = validate(parsed, { allowThrow: false });
    if (result.ok) rows.push(parsed);
    else rejected.push({ line: index + 1, reason: result.errors.join('; ') });
  });
  return { rows, rejected };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadSourceRedirects(projectDir) {
  const rows = await readNdjson(statePath(projectDir, 'sourceRedirects'));
  for (const row of rows) validateSourceRedirectRow(row);
  const byKey = foldRows(rows, (row) => row.ruleKey);
  return { rows, byKey, latest: Object.values(byKey) };
}

async function appendSourceRedirectRow(projectDir, row) {
  validateSourceRedirectRow(row);
  await appendNdjson(statePath(projectDir, 'sourceRedirects'), row);
  return row;
}

async function loadRedirectExecution(projectDir) {
  const { rows, rejected } = await readValidatedNdjson(statePath(projectDir, 'redirectExecution'), validateExecutionRow);
  return { rows, rejected, byKey: foldRows(rows, (row) => row.ruleKey) };
}

async function appendRedirectExecutionRow(projectDir, row) {
  validateExecutionRow(row);
  await appendNdjsonDurable(statePath(projectDir, 'redirectExecution'), row);
  return row;
}

async function loadUrlVerification(projectDir) {
  const { rows, rejected } = await readValidatedNdjson(statePath(projectDir, 'urlVerification'), validateVerificationRow);
  return { rows, rejected, byCheckpoint: foldRows(rows, (row) => row.checkpointKey) };
}

async function appendUrlVerificationRow(projectDir, row) {
  validateVerificationRow(row);
  await appendNdjsonDurable(statePath(projectDir, 'urlVerification'), row);
  return row;
}

async function writeStateJson(projectDir, name, doc) {
  await writeJsonAtomic(statePath(projectDir, name), doc);
  return doc;
}

async function loadStateJson(projectDir, name) {
  const doc = await readJsonIfPresent(statePath(projectDir, name));
  if (doc === null) return null;
  if (name === 'sourceDomains') return validateSourceDomains(doc);
  if (name === 'finalRoutes') return validateFinalRoutes(doc);
  if (name === 'launchPlan') return validateLaunchPlan(doc);
  if (name === 'sourceRedirectCoverage') return validateCoverage(doc);
  return doc;
}

module.exports = {
  SCHEMA_VERSION,
  urlPreservationDir,
  basePathsPath,
  urlLedgerPath,
  redirectsPath,
  unresolvedPath,
  linkAuditPath,
  readLinkAudit,
  writeLinkAudit,
  validateLinkAudit,
  ledgerKey,
  redirectKey,
  unresolvedKey,
  validateBasePathEntry,
  validateLedgerRow,
  validateRedirectRow,
  validateUnresolvedRow,
  writeBasePaths,
  loadBasePaths,
  appendUrlLedgerRow,
  appendRedirectRow,
  appendUnresolvedRow,
  loadUrlLedger,
  loadRedirects,
  loadRedirectsForPlanning,
  loadUnresolved,
  initUrlPreservationState,
  EXTENDED_FILES,
  statePath,
  relativeStatePath,
  originKey,
  validateSourceRedirectRow,
  validateCoverage,
  validateSourceDomains,
  validateFinalRoutes,
  validateLaunchPlan,
  validateExecutionRow,
  validateVerificationRow,
  loadSourceRedirects,
  appendSourceRedirectRow,
  loadRedirectExecution,
  appendRedirectExecutionRow,
  loadUrlVerification,
  appendUrlVerificationRow,
  writeStateJson,
  loadStateJson,
};
