#!/usr/bin/env node
'use strict';

// Mapping dependency preflight, before mapping approval:
//
//   node scripts/dependency-preflight.js --project-dir <dir>
//       Resolves every proposed dependent operation's dependencies from the mapping plan, census
//       and source evidence (no setup plan or execution manifest needed), validates noProducer
//       proofs, and writes mapping/review/dependency-preflight.json. Exit 2 when the mapping is not
//       structurally ready; each diagnostic names the dependent edge and the next step.
//   node scripts/dependency-preflight.js --project-dir <dir> --contract-digest <entityRef> <operation>
//       Prints the operationContractDigest a proof for that operation must bind.

const path = require('node:path');
const readiness = require('../lib/dependency-readiness.js');
const proofs = require('../lib/dependency-proofs.js');

async function main(argv) {
  const index = argv.indexOf('--project-dir');
  const digestAt = argv.indexOf('--contract-digest');
  if (digestAt >= 0) {
    const resolve = () => proofs.operationContract(argv[digestAt + 1], argv[digestAt + 2]);
    const found = index >= 0 && argv[index+1] ? require('../lib/operation-assessments').withProject(path.resolve(argv[index+1]),resolve) : resolve();
    if (!found) { console.error(`no reviewed operation contract for ${argv[digestAt + 1]} ${argv[digestAt + 2]}`); return 2; }
    console.log(JSON.stringify({ entityRef: argv[digestAt + 1], operation: found.name, operationContractDigest: proofs.contractDigest(found.contract), dependencies: found.contract.dependencies }, null, 2));
    return 0;
  }
  if (index < 0 || !argv[index + 1]) { console.error('usage: dependency-preflight.js --project-dir <dir> [--contract-digest <entityRef> <operation>]'); return 1; }
  const report = await readiness.preflightMappingDependencies(path.resolve(argv[index + 1]));
  console.log(JSON.stringify({ structuralReady: report.structuralReady, executionReady: report.executionReady, pendingSetup: report.pendingSetup, errors: report.errors, work: report.work }, null, 2));
  return report.structuralReady ? 0 : 2;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
