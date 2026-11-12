#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  buildDiscoveredSetStatus,
  resolveDiscoveredSet
} = require('../lib/discovered-set-status.js');
async function main() {
  const [command, project, ...rest] = process.argv.slice(2);
  if (!project || !['build', 'resolve'].includes(command)) throw new Error('Usage: discovered-set-status.js build|resolve <projectDir> [--census-id <id> --by merchant|cutover-operator --evidence <short non-record evidence>]');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) flags[rest[i]] = rest[i + 1];
  const projectDir = path.resolve(project);
  const result = command === 'build' ? await buildDiscoveredSetStatus(projectDir) : await resolveDiscoveredSet(projectDir, {
    censusId: flags['--census-id'],
    by: flags['--by'],
    evidence: flags['--evidence']
  });
  console.log(JSON.stringify({
    ok: true,
    status: result
  }, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || error.message,
    staleInputs: error.staleInputs,
    errors: error.errors
  }));
  process.exitCode = 1;
});
