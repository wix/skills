#!/usr/bin/env node
'use strict';

// Plan pre-fill. Offline: reads the source extract and the source pack's map
// suggestions; never reads or writes Wix.
//
//   node skills/wix-replatform/scripts/plan-prefill.js --project-dir <dir> [--platform woocommerce]
//        [--entities product,customer,order] [--measure]
//
// Writes mapping/plan-prefill.json: one complete plan entity per suggested source entity
// (fieldMappings copied from the suggestions, the source-archive row for every other discovered
// leaf, coverage, projected fieldDispositions, recorded choices). When mapping/mapping-plan.json
// already has the entity, its header fields and its operator rows are kept. The mapper copies
// these entities into the plan and writes only operator changes and the `prefill.review` leftovers.
// Rows the run wrote (no `prefilled` marker: operator changes and AI leftover decisions) are kept.
// --measure pre-fills fresh, ignoring the plan's rows, and prints per entity the bytes and rows of
// the existing plan entity (the baseline, for example an older AI-written plan) against the rows
// the AI still writes after the pre-fill.

const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/plan-prefill.js');

function arg(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}
const bytes = (value) => Buffer.byteLength(JSON.stringify(value === undefined ? null : value));

function main(argv) {
  const dir = arg(argv, '--project-dir');
  if (!dir) throw new Error('usage: plan-prefill.js --project-dir <dir> [--platform woocommerce] [--entities a,b] [--measure]');
  const projectDir = path.resolve(dir);
  const planFile = path.join(projectDir, 'mapping', 'mapping-plan.json');
  const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : null;
  const platform = arg(argv, '--platform') || (plan && (plan.sourcePlatform || plan.sourceSystem)) || 'woocommerce';
  const entities = arg(argv, '--entities') ? arg(argv, '--entities').split(',') : null;
  // --measure compares a fresh pre-fill (no run rows) with the existing plan as the baseline.
  const measure = argv.includes('--measure');
  const rows = P.prefillProject(projectDir, { platform, plan: measure ? null : plan, entities });
  const out = { schemaVersion: 1, prefillVersion: P.PREFILL_VERSION, platform, generatedAt: new Date().toISOString(), entities: rows };
  fs.mkdirSync(path.join(projectDir, 'mapping'), { recursive: true });
  const tmp = path.join(projectDir, 'mapping', `.plan-prefill.json.${process.pid}`);
  fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`);
  fs.renameSync(tmp, path.join(projectDir, 'mapping', 'plan-prefill.json'));
  const summary = rows.map((e) => {
    const ai = P.aiWrittenRows(e);
    const row = {
      sourceEntity: e.sourceEntity,
      records: e.sourceRecordCount,
      rows: e.fieldMappings.length,
      skippedRows: e.prefill.skippedRows,
      archivedLeaves: e.prefill.archivedLeaves,
      review: e.prefill.review.map((g) => `${g.group} (${g.leaves})`),
      operatorRows: e.prefill.operatorRows || [],
      aiLeftoverRows: e.prefill.aiRows || [],
      errors: e.prefill.errors,
      aiRows: ai.length,
    };
    if (measure && plan) {
      const before = (plan.entities || []).find((x) => x.sourceEntity === e.sourceEntity);
      if (before) {
        row.measure = {
          before: { rows: (before.fieldMappings || []).length, bytes: bytes(before.fieldMappings) + bytes(before.fieldDispositions) + bytes(before.discoveryCoverage) + bytes(before.verificationMappings) },
          after: { rows: ai.length, bytes: bytes(ai) },
        };
      }
    }
    return row;
  });
  console.log(JSON.stringify({ file: 'mapping/plan-prefill.json', entities: summary }, null, 2));
  return rows.some((e) => e.prefill.errors.length) ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { main };
