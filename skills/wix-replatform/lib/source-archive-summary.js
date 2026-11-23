'use strict';
// The source archive's counts-only run summary (no field values). scripts/source-archive-plan.js
// --write, or the importer, saves it; the completion report joins it as "Kept For Reference".
// Built by resources/rp-target-wix/lib/source-archive.js planSourceArchive.
const fs = require('node:fs');
const path = require('node:path');

const SUMMARY_PATH = 'execution/source-archive-plan.json';

function readArchivePlanSummary(projectDir) {
  const file = path.join(projectDir, SUMMARY_PATH);
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return value && value.schemaVersion === 1 && value.keptForReference ? value : null;
}

function writeArchivePlanSummary(projectDir, summary) {
  const file = path.join(projectDir, SUMMARY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(summary, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

// Whether this run's importer wrote the planned archive: every journaled source-archive row
// (cms/data-item) carries a planned `archive:<itemKey>` key, and at least one does. A run whose
// generated code hand-rolled its archive (other keys) or wrote none did not apply the plan, so
// the report must not claim the lean archive.
function archivePlanApplied(summary, journalRows) {
  const planned = new Set((summary?.entities || []).flatMap((e) => (e.itemKeys || []).map((key) => `archive:${key}`)));
  const written = new Set((journalRows || []).filter((row) => row && row.targetEntityType === 'cms/data-item' && typeof row.sourceStableKey === 'string')
    .map((row) => row.sourceStableKey));
  const unplanned = [...written].filter((key) => !planned.has(key));
  return { applied: written.size > 0 && unplanned.length === 0, written: written.size, unplanned: unplanned.length };
}

module.exports = { SUMMARY_PATH, readArchivePlanSummary, writeArchivePlanSummary, archivePlanApplied };
