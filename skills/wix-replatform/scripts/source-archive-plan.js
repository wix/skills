#!/usr/bin/env node
'use strict';

// The source archive plan, offline. Reads mapping/mapping-plan.json and the source
// extract (data/source-extract/<entity>.ndjson); prints the expected CMS item count per entity and
// the "Kept for reference" block. Never reads or writes Wix.
//
//   node skills/wix-replatform/scripts/source-archive-plan.js --project-dir <dir> [--write]
//
// --write saves the counts-only summary to execution/source-archive-plan.json (no field values).
// The completion report joins that file as its "Kept For Reference" section, and its
// `expectedRows` is the archive count for `cms-item-quota.js plan --expected-rows`.
// The importer writes the items from the same `planSourceArchive` call (rp-import-codegen).

const fs = require('node:fs');
const path = require('node:path');
const A = require('../resources/rp-target-wix/lib/source-archive.js');

function readNdjson(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function planProject(projectDir, { ownerKeeps = [] } = {}) {
  const plan = JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping', 'mapping-plan.json'), 'utf8'));
  return A.planSourceArchive({
    plan,
    ownerKeeps,
    readRecords: (sourceEntity) => readNdjson(path.join(projectDir, 'data', 'source-extract', `${sourceEntity}.ndjson`)),
  });
}

function main(argv) {
  const at = argv.indexOf('--project-dir');
  if (at < 0 || !argv[at + 1]) throw new Error('usage: source-archive-plan.js --project-dir <dir> [--write]');
  const projectDir = path.resolve(argv[at + 1]);
  const { summary } = planProject(projectDir);
  if (argv.includes('--write')) A.writeArchivePlanSummary(projectDir, summary);
  console.log(JSON.stringify({ expectedRows: summary.expectedRows, entities: summary.entities.map((e) => ({
    sourceEntity: e.sourceEntity, collectionId: e.collectionId, records: e.recordCount, items: e.expectedRows, archiveOnly: e.archiveOnly,
  })), skipped: summary.skipped, ...(argv.includes('--write') ? { wrote: A.SUMMARY_PATH } : {}) }, null, 2));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message || error); process.exit(1); }
}
module.exports = { planProject };
