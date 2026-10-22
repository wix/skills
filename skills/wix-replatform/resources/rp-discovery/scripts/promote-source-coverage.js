#!/usr/bin/env node
'use strict';

// Promote a full adapter's source-coverage record into the canonical discovery artifacts.
//
//   node scripts/promote-source-coverage.js <projectDir> --adapter wordpress|csv|shopify
//
// Run after `source-schema.json` is synthesized. Validates
// `data/<source>-discovery/source-coverage.json`, writes `discovery/source-coverage.json`, and
// stamps `sourceCoverageContract: 1` on the project-root `source-schema.json` -- the only place any
// consumer reads that stamp from. Quick modes write their own coverage at `plan`.
//
// Exit codes: 0 promoted; 2 refused (unknown adapter, adapter file missing or malformed, or no
// source-schema.json yet); 1 usage error.

const path = require('node:path');
const { promoteSourceCoverage, SourceCoverageError } = require('../../../lib/source-coverage.js');

async function main() {
  const argv = process.argv.slice(2);
  let adapter = null;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--adapter') { adapter = argv[i + 1]; i += 1; } else positional.push(argv[i]);
  }
  const [projectDirArg] = positional;
  if (!projectDirArg || !adapter) {
    process.stderr.write('Usage: promote-source-coverage.js <projectDir> --adapter wordpress|csv|shopify\n');
    return 1;
  }
  try {
    const result = await promoteSourceCoverage(path.resolve(projectDirArg), { adapter });
    process.stdout.write(`${JSON.stringify({ ok: true, adapter, rows: result.rows, artifact: 'discovery/source-coverage.json' })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof SourceCoverageError) {
      process.stderr.write(`refused: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
