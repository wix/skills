#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { appendExpectation } = require('../lib/expectations-ledger.js');
const { loadArtifacts } = require('../lib/orchestration-state.js');

function parseArgs(argv) {
  const args = { artifactRef: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (key === 'artifactRef') args.artifactRef.push(value);
    else args[key] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectDir || !args.expectation) {
    throw new Error('Usage: expectations-ledger.js --project-dir <migration-dir> --expectation <note> [--artifact-ref <project-relative-path>]');
  }
  const projectDir = path.resolve(args.projectDir);
  const artifacts = await loadArtifacts(projectDir);
  const result = await appendExpectation(projectDir, args.expectation, {
    phase: args.phase || artifacts.run?.activePhase,
    state: args.state || artifacts.run?.currentState,
    resource: args.resource,
    source: args.source,
    target: args.target,
    decision: args.decision,
    artifactRefs: args.artifactRef,
  });
  console.log(JSON.stringify({ ok: true, expectationId: result.id, file: result.file, redacted: result.redacted }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
