#!/usr/bin/env node
'use strict';

// Source-coverage reconcile check and decision writer.
//
//   node scripts/coverage-reconcile.js check <projectDir> [--json]
//   node scripts/coverage-reconcile.js decide <projectDir> --coverage-id <id> --value provided|declined [--rationale <text>]
//
// `check` joins discovery/source-coverage.json, mapping/review/mapping-gaps.json and
// orchestration/decisions.json by coverageId. Every coverage row needs exactly one valid
// disposition: a mapping-gaps.json entry carrying its coverageId, a `sourceCoverage:<coverageId>`
// decision, or (quick mode only) its declared exclusion.
//
// `decide` records a `sourceCoverage:<coverageId>` decision and removes that row's gap entries in
// the same write, so the normal recovery path never creates a disposition conflict.
//
// Exit codes: 0 every row reconciles; 2 a row has no, two, a stale or a mismatched disposition, a
// gap/decision names an unknown coverageId, or the coverage file is missing or malformed;
// 1 usage error.

const path = require('node:path');
const {
  reconcileProject,
  recordCoverageDecision,
  SourceCoverageError,
} = require('../../../lib/source-coverage.js');

function parseArgs(argv) {
  const args = { command: null, projectDir: null, coverageId: null, value: null, rationale: null, json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--coverage-id') { args.coverageId = argv[i + 1]; i += 1; }
    else if (arg === '--value') { args.value = argv[i + 1]; i += 1; }
    else if (arg === '--rationale') { args.rationale = argv[i + 1]; i += 1; }
    else if (arg === '--json') args.json = true;
    else positional.push(arg);
  }
  [args.command, args.projectDir] = positional;
  return args;
}

function usage() {
  return 'Usage: coverage-reconcile.js check <projectDir> [--json]\n'
    + '       coverage-reconcile.js decide <projectDir> --coverage-id <id> --value provided|declined [--rationale <text>]\n';
}

function report(failures, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, failures }, null, 2)}\n`);
    return;
  }
  if (!failures.length) {
    process.stdout.write('source coverage reconciles: every row has exactly one valid disposition\n');
    return;
  }
  for (const item of failures) process.stderr.write(`${item.code}: ${item.message}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['check', 'decide'].includes(args.command) || !args.projectDir) {
    process.stderr.write(usage());
    return 1;
  }
  const projectDir = path.resolve(args.projectDir);
  try {
    if (args.command === 'decide') {
      const result = await recordCoverageDecision(projectDir, { coverageId: args.coverageId, value: args.value, rationale: args.rationale });
      process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    }
    const result = await reconcileProject(projectDir);
    report(result.failures, args.json);
    return result.ok ? 0 : 2;
  } catch (error) {
    if (error instanceof SourceCoverageError) {
      const failures = error.failures.length ? error.failures : [{ code: 'invalid_coverage', coverageId: null, message: error.message, sources: [] }];
      report(failures, args.json);
      return 2;
    }
    throw error;
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
