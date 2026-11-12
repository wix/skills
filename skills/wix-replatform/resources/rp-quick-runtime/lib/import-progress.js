'use strict';

// Shared by both rp-quick-<platform> adapters (producers) and by
// lib/orchestration-router.js (consumer), so the quick manifest rule and the start-marker
// path live in one place.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const QUICK_IMPORT_STARTED_MARKER = 'state/quick-import-started.json';
const MARKER_SCHEMA_VERSION = 1;

// The quick manifest written by `quick-mode.js plan`. It is deliberately not the full-mode
// `validateManifest` shape (no projectId/planVersion/tasks).
function validateQuickExecutionManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['quick execution manifest must be an object'] };
  }
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) errors.push('schemaVersion must be absent or 1');
  if (manifest.managementImportMode !== 'quick') errors.push("managementImportMode must be 'quick'");
  if (typeof manifest.importCommand !== 'string' || !manifest.importCommand.trim()) errors.push('importCommand must be a non-empty string');
  if (!Array.isArray(manifest.entities)) errors.push('entities must be an array');
  return { ok: errors.length === 0, errors };
}

// Before the marker or any destination write, the loaded plan's adapter must be
// exactly the adapter's current contract `{ id, version, fingerprint }`, and the extract
// manifest must carry that same adapter. This is what makes the marker's copied `adapter` the
// current adapter-contract identity rather than whatever a stale or edited plan says.
const ADAPTER_KEYS = ['id', 'version', 'fingerprint'];
function sameAdapter(left, right) {
  return Boolean(left && typeof left === 'object' && right && typeof right === 'object')
    && ADAPTER_KEYS.every((key) => typeof left[key] === 'string' && left[key] !== '' && left[key] === right[key]);
}
function assertQuickImportAdapter({ plan, manifest, current }) {
  if (!sameAdapter(current, current)) throw new Error('quick adapter contract is missing id, version, or fingerprint');
  if (!sameAdapter(plan && plan.adapter, current)) throw new Error('quick adapter contract changed; re-run preflight and plan');
  if (!sameAdapter(manifest && manifest.adapter, current)) throw new Error('extraction does not match quick plan; re-extract');
}

// Durable pre-write evidence that a live quick import began. Written once, before the first
// destination create/update, never on a dry run, and never rewritten on resume: an existing
// marker keeps describing the first live attempt. `adapter` is the plan's own
// `{ id, version, fingerprint }`, already checked by `assertQuickImportAdapter` to equal the
// loaded adapter contract, copied verbatim.
//
// Publication is atomic and no-replace: the complete JSON is written and fsynced to a
// uniquely named temp file, then hard-linked to the marker path. `link` fails with EEXIST
// when a marker already exists, so concurrent first attempts cannot replace each other and
// a reader never sees a partial marker. The loser is an unchanged resume.
async function writeQuickImportStartedMarker(projectDir, adapter) {
  const markerPath = path.join(projectDir, QUICK_IMPORT_STARTED_MARKER);
  const unchanged = { written: false, path: QUICK_IMPORT_STARTED_MARKER };
  try {
    await fs.access(markerPath);
    return unchanged;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  const { id, version, fingerprint } = adapter || {};
  const marker = { schemaVersion: MARKER_SCHEMA_VERSION, adapter: { id, version, fingerprint }, startedAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  const tempPath = `${markerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(tempPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.link(tempPath, markerPath);
    return { written: true, path: QUICK_IMPORT_STARTED_MARKER };
  } catch (error) {
    if (error && error.code === 'EEXIST') return unchanged;
    throw error;
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

module.exports = {
  QUICK_IMPORT_STARTED_MARKER,
  assertQuickImportAdapter,
  validateQuickExecutionManifest,
  writeQuickImportStartedMarker,
};
