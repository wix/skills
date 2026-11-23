#!/usr/bin/env node
'use strict';

// The field-mapping example pass (rp-import-codegen), run by the toolkit: real source records (or
// the plan's synthetic examples) through the importer's own build and the reviewed writers, on an
// isolated capture client. Writes the "Field mapping examples" section of
// execution/review/import-plan.md and the pass files under state/attempts/field-mapping-examples/.
// Offline: no configuration, credentials or Wix calls.
//
//   node scripts/field-mapping-examples.js --project <dir> [--digest <pinned mapping digest>]
// Prints { ok, counts, failures[], captureRef, toolkitGaps[] }; pass captureRef to
// `artifact-freshness.js write --example-capture`. Exit: 0 ok; 1 failed rows or mapping
// questions; 2 usage or setup error.

const path = require('node:path');
const { runProjectExamplePass } = require('../lib/field-mapping-example-execute.js');

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  if (!opt('--project')) { console.error('usage: field-mapping-examples.js --project <dir> [--digest <sha256>]'); return 2; }
  try {
    const summary = await runProjectExamplePass({ projectDir: path.resolve(opt('--project')), mappingPlanDigest: opt('--digest') });
    console.log(JSON.stringify(summary, null, 2));
    return summary.ok ? 0 : 1;
  } catch (error) {
    console.error(['EXAMPLE_PASS_NO_PIN', 'EXAMPLE_OVERRIDE_INVALID'].includes(error.code) ? error.message : (error.stack || error.message));
    return 2;
  }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { main };
