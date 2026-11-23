#!/usr/bin/env node
'use strict';

// Writes execution/execution-manifest.json from the codegen scaffold record and the mapping plan
// (lib/execution-manifest-generate.js). Run it after the scaffold, then edit only real choices and
// validate as before. An existing manifest is kept unless --force.
//
//   node scripts/execution-manifest-generate.js --project <dir> [--force]

const path = require('node:path');
const { writeGeneratedManifest } = require('../lib/execution-manifest-generate.js');

async function main() {
  const args = process.argv.slice(2);
  const at = Math.max(args.indexOf('--project'), args.indexOf('--project-dir'));
  if (at === -1 || !args[at + 1]) {
    console.error('Usage: node scripts/execution-manifest-generate.js --project <dir> [--force]');
    process.exit(2);
  }
  const result = await writeGeneratedManifest(path.resolve(args[at + 1]), { force: args.includes('--force') });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.written && result.derivedOk !== false ? 0 : 1);
}

main().catch((error) => { console.error(error && error.message ? error.message : error); process.exit(1); });
