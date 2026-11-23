'use strict';

// One rule for every gate that compares an extract's rowsWritten with its snapshotTotal.
//
// snapshotTotal is the count the source gave before the read; rowsWritten is what the read got.
// A record can be deleted or filtered between the two, or added (more rows than the count). A
// finished extract (`complete: true`, written only after its page loop ended) with a different
// count is still finished: the difference is a recorded gap, never a block. An unfinished
// extract (a sample, a partial read, a manifest with no `complete` flag) must still match.
//
// The gaps are listed in the completion report (extractCountGaps) and as toolkit gaps
// (execution/toolkit-gaps.json, source `extract-count`).

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'extract-count';
const EXTRACT_DIR = 'data/source-extract';
const isCount = (value) => Number.isInteger(value) && value >= 0;

// { finished, gap }: gap = rowsWritten - snapshotTotal (negative: records vanished after the count).
// Defined in the structure-bridge reader, which is copied into generated projects and needs it too.
const { extractCount } = require('../resources/rp-source-wordpress/lib/structure-bridge-reader.js');

// An EAV read plan's batches each carry their own first-page total; a finished batch may differ.
function eavBatchGap(manifest) {
  if (!manifest || manifest.kind !== 'eav-read-plan' || !Array.isArray(manifest.completedBatches)) return null;
  let read = 0, counted = 0;
  for (const batch of manifest.completedBatches) {
    if (!isCount(batch?.rowsRead) || !isCount(batch?.snapshotTotal)) return null;
    read += batch.rowsRead; counted += batch.snapshotTotal;
  }
  return { rowsWritten: read, snapshotTotal: counted, gap: read - counted };
}

// Every finished extract under data/source-extract whose count differs from the source count.
function listExtractCountGaps(projectDir) {
  const dir = path.join(projectDir, EXTRACT_DIR);
  let names;
  try { names = fs.readdirSync(dir).filter((name) => name.endsWith('.manifest.json')).sort(); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const rows = [];
  for (const name of names) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    const file = `${EXTRACT_DIR}/${name}`;
    const entity = manifest.entity || manifest.sourceEntityRef || name.replace(/\.manifest\.json$/, '');
    const eav = eavBatchGap(manifest);
    if (eav) { if (eav.gap !== 0) rows.push({ entity, manifest: file, ...eav }); continue; }
    const { finished, gap } = extractCount(manifest);
    if (finished && gap !== 0) rows.push({ entity, manifest: file, rowsWritten: manifest.rowsWritten, snapshotTotal: manifest.snapshotTotal, gap });
  }
  return rows;
}

// Rewrites this source's toolkit-gap rows from the extracts on disk; returns the gap rows.
function recordExtractCountGaps(projectDir) {
  const rows = listExtractCountGaps(projectDir);
  require('./toolkit-gaps.js').recordToolkitGaps(projectDir, SOURCE, rows.map((row) => ({
    kind: 'extract-count-gap',
    step: `extract ${row.entity}`,
    file: row.manifest,
    why: row.gap < 0
      ? `read ${row.rowsWritten} of the ${row.snapshotTotal} records the source counted before the read; ${-row.gap} vanished in between (deleted or filtered). The extract finished and its dependents ran`
      : `read ${row.rowsWritten} records but the source counted ${row.snapshotTotal} before the read; ${row.gap} appeared in between. The extract finished and its dependents ran`,
  })));
  return rows;
}

module.exports = { SOURCE, extractCount, eavBatchGap, listExtractCountGaps, recordExtractCountGaps };
