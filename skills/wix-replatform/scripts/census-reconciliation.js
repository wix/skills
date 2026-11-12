#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  buildReconciliation
} = require('../lib/census-reconciliation.js');
async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== 'build') throw new Error('Usage: census-reconciliation.js build <projectDir>');
  const result = await buildReconciliation(path.resolve(args[1]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errors.length) process.exitCode = 1;
  return result;
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || 'census_reconciliation_failed',
    message: error.message
  })}\n`);
  process.exitCode = 1;
});
module.exports = {
  main
};
