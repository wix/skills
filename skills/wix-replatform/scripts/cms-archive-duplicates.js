#!/usr/bin/env node
'use strict';

// Read-only CMS archive duplicate report.
//
//   node skills/wix-replatform/scripts/cms-archive-duplicates.js \
//     --project-dir <dir> --collection <archive-id> [--collection <archive-id>]
//
// New archive rows use `sourceKey`. Older rows used `parentKey`, so the default
// report checks both fields and labels which one identified each duplicate group.
// This script never sends a CMS write or mutates the project.

const shared = require('../lib/cms-archive-duplicates.js');

async function main() {
  const args = shared.parseArgs(process.argv.slice(2));
  if (!args.projectDir || !args.collections.length) throw new Error('usage: cms-archive-duplicates.js --project-dir <dir> --collection <id> [--collection <id>] [--source-field sourceKey]');
  console.log(JSON.stringify({ readOnly: true, collections: await shared.report(args.projectDir, args.collections, { sourceFields: args.sourceFields }) }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message || error); process.exit(1); });
module.exports = shared;
