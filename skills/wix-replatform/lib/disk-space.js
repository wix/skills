'use strict';
// H49: a run that fills the disk dies mid-write (three runs lost ~15 min + a resume each). Check
// free space before the source extract (preflight) and before an import run starts. The need is a
// fixed floor plus an estimate from the census record counts (extract, journal and crosswalk).
const fs = require('node:fs');
const path = require('node:path');

const MB = 1024 * 1024;
const FLOOR_BYTES = 1024 * MB; // 1 GB always kept free.
const BYTES_PER_RECORD = 64 * 1024; // extract row + attempt rows + crosswalk + read-back, generous.

function floorBytes(env = process.env) {
  const mb = Number(env.RP_DISK_MIN_FREE_MB);
  return Number.isFinite(mb) && mb >= 0 ? Math.round(mb * MB) : FLOOR_BYTES;
}

// Total source records the census counted, or 0 when there is no census yet.
function censusRecordCount(projectDir) {
  try {
    const census = JSON.parse(fs.readFileSync(path.join(projectDir, 'discovery/census.json'), 'utf8'));
    return (census.rows || []).filter((row) => row && row.kind === 'entity' && Number.isInteger(row.recordCount) && row.recordCount > 0)
      .reduce((sum, row) => sum + row.recordCount, 0);
  } catch { return 0; }
}

function freeBytes(dir) {
  let at = path.resolve(dir);
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const stats = fs.statfsSync(at);
  return Number(stats.bavail) * Number(stats.bsize);
}

const gb = (bytes) => `${(bytes / (1024 * MB)).toFixed(1)} GB`;

// { ok, freeBytes, neededBytes, records, message }. `ok: true` with `unknown: true` when the
// free space cannot be read: the check never stops a run on its own failure.
function checkDiskSpace(projectDir, { env = process.env, statFree = freeBytes } = {}) {
  const records = censusRecordCount(projectDir);
  const neededBytes = floorBytes(env) + records * BYTES_PER_RECORD;
  let free;
  try { free = statFree(projectDir); } catch { return { ok: true, unknown: true, freeBytes: null, neededBytes, records, message: 'free disk space could not be read; continuing' }; }
  const ok = free >= neededBytes;
  const message = ok
    ? `${gb(free)} free; about ${gb(neededBytes)} needed`
    : `Not enough free disk space: ${gb(free)} free where the migration folder is, about ${gb(neededBytes)} needed (${records} source records plus a ${gb(floorBytes(env))} reserve). Free up space on that disk (or move the migration folder to a larger one), then run again. Nothing was written.`;
  return { ok, freeBytes: free, neededBytes, records, message };
}

class DiskSpaceError extends Error {
  constructor(result) { super(result.message); this.code = 'DISK_SPACE_LOW'; this.diskSpace = result; }
}

function assertDiskSpace(projectDir, options) {
  const result = checkDiskSpace(projectDir, options);
  if (!result.ok) throw new DiskSpaceError(result);
  return result;
}

module.exports = { FLOOR_BYTES, BYTES_PER_RECORD, checkDiskSpace, assertDiskSpace, censusRecordCount, DiskSpaceError };
