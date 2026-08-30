'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

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
const REDIRECT_STATUS = new Set(['planned']);
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

module.exports = {
  SCHEMA_VERSION,
  urlPreservationDir,
  basePathsPath,
  urlLedgerPath,
  redirectsPath,
  unresolvedPath,
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
  loadUnresolved,
  initUrlPreservationState,
};
