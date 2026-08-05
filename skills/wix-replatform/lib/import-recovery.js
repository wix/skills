'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadAttemptJournal, loadCrosswalk } = require('./local-state.js');

const RECOVERY_SCHEMA_VERSION = 1;
const RECOVERY_MODES = ['partial', 'missing-only', 'failed-only', 'deferred-only', 'resumed'];
const RECOVERY_STATUSES = ['complete', 'partial', 'failed', 'blocked'];
const DEFERRED_ATTEMPT_STATUSES = new Set(['deferred', 'needs_verification']);

function executionDir(projectDir) {
  return path.join(projectDir, 'execution');
}

function recoveryLogPath(projectDir) {
  return path.join(executionDir(projectDir), 'recovery-log.json');
}

function liveImportSummaryPath(projectDir) {
  return path.join(executionDir(projectDir), 'live-import-summary.json');
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

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readJsonIfExists(filePath, fallback) {
  if (!(await pathExists(filePath))) {
    return fallback;
  }
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function requireString(value, field) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function count(value, field) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function sourceStableKey(sourceSystem, sourceEntityType, sourceId) {
  return `${sourceSystem}:${sourceEntityType}:${sourceId}`;
}

function defaultSourceId(record) {
  return record && (record.id ?? record.ID ?? record.sourceId);
}

function defaultSourceType(record) {
  return record && (record.sourceType ?? record.subtype ?? record.type);
}

function normalizeSelectionFilters(input = {}) {
  const filters = {
    entity: input.entity || input.sourceEntityType || null,
    sourceType: input.sourceType || input.source_type || null,
    missingOnly: Boolean(input.missingOnly || input['missing-only']),
    failedOnly: Boolean(input.failedOnly || input['failed-only']),
    deferredOnly: Boolean(input.deferredOnly || input['deferred-only']),
  };
  const exclusive = [filters.missingOnly, filters.failedOnly, filters.deferredOnly].filter(Boolean);
  if (exclusive.length > 1) {
    throw new Error('--missing-only, --failed-only, and --deferred-only are mutually exclusive');
  }
  return filters;
}

function foldAttemptsBySource(attemptRows = []) {
  const bySource = {};
  for (const row of attemptRows) {
    if (!row || !row.sourceStableKey) {
      continue;
    }
    bySource[row.sourceStableKey] = row;
  }
  return bySource;
}

function selectImportRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new Error('records must be an array');
  }
  const filters = normalizeSelectionFilters(options.filters || options);
  const sourceSystem = options.sourceSystem || 'wordpress';
  const sourceEntityType = requireString(filters.entity || options.sourceEntityType, 'selection entity');
  const getSourceId = options.getSourceId || defaultSourceId;
  const getSourceType = options.getSourceType || defaultSourceType;
  const crosswalkBySource = options.crosswalkBySource || {};
  const attemptsBySource = options.attemptsBySource || foldAttemptsBySource(options.attemptRows || []);

  const selected = [];
  const alreadyPresent = [];
  const excluded = [];
  const failed = [];
  const deferred = [];

  for (const record of records) {
    const sourceId = getSourceId(record);
    if (sourceId === undefined || sourceId === null || sourceId === '') {
      excluded.push({ record, reason: 'missing_source_id' });
      continue;
    }
    const stableKey = sourceStableKey(sourceSystem, sourceEntityType, String(sourceId));
    const sourceType = getSourceType(record);
    const existing = crosswalkBySource[stableKey] || null;
    const latestAttempt = attemptsBySource[stableKey] || null;

    if (filters.sourceType && String(sourceType) !== String(filters.sourceType)) {
      excluded.push({ sourceStableKey: stableKey, sourceType, reason: 'source_type_filter' });
      continue;
    }
    if (filters.missingOnly && existing) {
      alreadyPresent.push({ sourceStableKey: stableKey, targetId: existing.targetId, reason: 'crosswalk' });
      continue;
    }
    if (filters.failedOnly && (!latestAttempt || !String(latestAttempt.status).startsWith('failed'))) {
      excluded.push({ sourceStableKey: stableKey, reason: 'not_failed' });
      continue;
    }
    if (filters.deferredOnly && (!latestAttempt || !DEFERRED_ATTEMPT_STATUSES.has(latestAttempt.status))) {
      excluded.push({ sourceStableKey: stableKey, reason: 'not_deferred' });
      continue;
    }

    if (latestAttempt && String(latestAttempt.status).startsWith('failed')) {
      failed.push(stableKey);
    }
    if (latestAttempt && DEFERRED_ATTEMPT_STATUSES.has(latestAttempt.status)) {
      deferred.push(stableKey);
    }
    selected.push({ record, sourceStableKey: stableKey, sourceType, existing, latestAttempt });
  }

  return {
    filters,
    entity: sourceEntityType,
    selected,
    alreadyPresent,
    excluded,
    summary: {
      entity: sourceEntityType,
      sourceType: filters.sourceType || 'all',
      recordsRead: records.length,
      recordsSelected: selected.length,
      alreadyPresent: alreadyPresent.length,
      excluded: excluded.length,
      failedCandidates: failed.length,
      deferredCandidates: deferred.length,
    },
  };
}

async function selectImportRecordsFromState(projectDir, records, options = {}) {
  const crosswalk = await loadCrosswalk(projectDir);
  const attempts = await loadAttemptJournal(projectDir);
  return selectImportRecords(records, {
    ...options,
    crosswalkBySource: crosswalk.bySource,
    attemptRows: attempts.rows,
  });
}

function recoveryIdFor(entry) {
  if (entry.recoveryId) {
    return entry.recoveryId;
  }
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      timestamp: entry.timestamp,
      selectionFilters: entry.selectionFilters,
      reason: entry.reason,
      recordsSelected: entry.recordsSelected,
      recordsAttempted: entry.recordsAttempted,
    }))
    .digest('hex')
    .slice(0, 12);
  const stamp = String(entry.timestamp || new Date().toISOString()).replace(/[^0-9TZ]/g, '').slice(0, 15);
  return `recovery-${stamp}-${hash}`;
}

function normalizeRecoveryEntry(input = {}) {
  const mode = input.mode || (input.selectionFilters && (
    input.selectionFilters.missingOnly ? 'missing-only' :
      input.selectionFilters.failedOnly ? 'failed-only' :
        input.selectionFilters.deferredOnly ? 'deferred-only' : 'partial'
  ));
  if (!RECOVERY_MODES.includes(mode)) {
    throw new Error(`recovery mode must be one of: ${RECOVERY_MODES.join(', ')}`);
  }
  const status = input.status || 'partial';
  if (!RECOVERY_STATUSES.includes(status)) {
    throw new Error(`recovery status must be one of: ${RECOVERY_STATUSES.join(', ')}`);
  }
  const timestamp = input.timestamp || new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error('recovery timestamp must be an ISO timestamp');
  }
  const entry = {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    recoveryId: input.recoveryId || null,
    timestamp,
    mode,
    selectionFilters: input.selectionFilters || {},
    reason: requireString(input.reason || 'operator_requested_recovery', 'recovery reason'),
    recordsSelected: count(input.recordsSelected, 'recordsSelected'),
    recordsAttempted: count(input.recordsAttempted, 'recordsAttempted'),
    imported: count(input.imported, 'imported'),
    alreadyPresent: count(input.alreadyPresent, 'alreadyPresent'),
    failed: count(input.failed, 'failed'),
    deferred: count(input.deferred, 'deferred'),
    crosswalkChanges: input.crosswalkChanges || { before: 0, after: 0, added: 0, updated: 0 },
    summaryChanges: input.summaryChanges || {},
    outcome: requireString(input.outcome || status, 'recovery outcome'),
    status,
    logs: Array.isArray(input.logs) ? input.logs : [],
  };
  entry.recoveryId = recoveryIdFor(entry);
  return entry;
}

async function loadRecoveryLog(projectDir) {
  const rows = await readJsonIfExists(recoveryLogPath(projectDir), []);
  if (!Array.isArray(rows)) {
    throw new Error('execution/recovery-log.json must contain a JSON array');
  }
  return rows.map((row) => normalizeRecoveryEntry(row));
}

async function appendRecoveryLogEntry(projectDir, entry) {
  const existing = await loadRecoveryLog(projectDir);
  const normalized = normalizeRecoveryEntry(entry);
  if (existing.some((row) => row.recoveryId === normalized.recoveryId)) {
    throw new Error(`duplicate recoveryId: ${normalized.recoveryId}`);
  }
  const next = [...existing, normalized];
  await writeJsonAtomic(recoveryLogPath(projectDir), next);
  return normalized;
}

function diffCounts(before = {}, after = {}) {
  before = before || {};
  after = after || {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const diff = {};
  for (const key of keys) {
    if (Number.isInteger(before[key]) || Number.isInteger(after[key])) {
      diff[key] = (after[key] || 0) - (before[key] || 0);
    }
  }
  return diff;
}

async function writeLiveImportSummary(projectDir, summary, options = {}) {
  const before = await readJsonIfExists(liveImportSummaryPath(projectDir), null);
  const next = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(summary || {}),
  };
  await writeJsonAtomic(liveImportSummaryPath(projectDir), next);
  return {
    path: 'execution/live-import-summary.json',
    beforeExists: Boolean(before),
    changes: {
      imported: diffCounts(before && before.imported, next.imported),
      deferred: diffCounts(before && before.deferred, next.deferred),
      failed: diffCounts(before && before.failed, next.failed),
      ...(options.extraChanges || {}),
    },
  };
}

module.exports = {
  RECOVERY_SCHEMA_VERSION,
  recoveryLogPath,
  liveImportSummaryPath,
  normalizeSelectionFilters,
  foldAttemptsBySource,
  sourceStableKey,
  selectImportRecords,
  selectImportRecordsFromState,
  normalizeRecoveryEntry,
  loadRecoveryLog,
  appendRecoveryLogEntry,
  writeLiveImportSummary,
};
