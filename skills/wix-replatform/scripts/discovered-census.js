#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  buildCensus,
  rolloutScan
} = require('../lib/discovered-census.js');
async function main(args = process.argv.slice(2)) {
  const [command, dir] = args;
  if (!['build', 'rollout-scan'].includes(command) || !dir || args.length !== 2) throw new Error('Usage: discovered-census.js build <projectDir> | rollout-scan <migrations-root>');
  const result = command === 'build' ? await buildCensus(path.resolve(dir)) : await rolloutScan(path.resolve(dir));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || 'census_build_failed',
    message: error.message
  })}\n`);
  process.exitCode = 1;
});
module.exports = {
  main
};
