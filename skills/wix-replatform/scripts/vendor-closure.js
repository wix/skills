#!/usr/bin/env node
'use strict';
// Copies every toolkit file a project's vendored src/ requires but lacks (lib/vendor-closure.js),
// byte-identical at its mirrored path, to a fixed point. --check only lists the gaps (exit 2 if any).
// Usage: node scripts/vendor-closure.js <projectDir> [--check]
const path = require('node:path');
const { vendorGaps, vendorClosure } = require('../lib/vendor-closure.js');

function main(args = process.argv.slice(2)) {
  const [projectDir, flag] = args;
  if (!projectDir || (flag && flag !== '--check') || args.length > 2) {
    process.stderr.write('usage: vendor-closure.js <projectDir> [--check]\n'); process.exitCode = 2; return null;
  }
  const dir = path.resolve(projectDir);
  const result = flag === '--check' ? { copied: [], gaps: vendorGaps(dir) } : vendorClosure(dir);
  process.stdout.write(`${JSON.stringify({ status: result.gaps.length ? 'gaps' : 'complete', ...result }, null, 2)}\n`);
  process.exitCode = result.gaps.length ? 2 : 0;
  return result;
}
if (require.main === module) main();
module.exports = { main };
