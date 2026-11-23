#!/usr/bin/env node
'use strict';

// Toolkit integrity guard (H15/H50). The run supervisor calls the library itself; this
// script is for the import operator.
//
//   node skills/wix-replatform/scripts/toolkit-integrity.js check  --project-dir <dir>
//        Report changed toolkit files and drifted vendored copies; restores nothing.
//   node skills/wix-replatform/scripts/toolkit-integrity.js accept --project-dir <dir> --note "<what and why>"
//        A deliberate mid-run patch: the current toolkit and vendored copies become the baseline.
//        Listed in the completion report as an accepted patch.
//
// Nothing here writes to the site.

const path = require('node:path');
const integrity = require('../lib/toolkit-integrity.js');

function parseArgs(argv) {
  const args = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--project-dir') args.projectDir = path.resolve(argv[++i]);
    else if (flag === '--note') args.note = argv[++i];
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!['check', 'accept'].includes(args.command) || !args.projectDir) throw new Error('usage: toolkit-integrity.js check|accept --project-dir <dir> [--note <text>]');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'check') {
    if (!integrity.readIncidents) throw new Error('toolkit-integrity library missing');
    const report = integrity.checkAndRestore(args.projectDir, { stage: 'manual_check', restore: false });
    process.stdout.write(`${JSON.stringify(report || { changed: false }, null, 2)}\n`);
    return report ? 2 : 0;
  }
  const accepted = integrity.acceptCurrent(args.projectDir, { note: args.note });
  process.stdout.write(`${JSON.stringify({ accepted: true, toolkitChanges: accepted.toolkitChanges.length, vendoredChanges: accepted.vendoredChanges.length, acceptedVendored: accepted.acceptedVendored }, null, 2)}\n`);
  return 0;
}

try { process.exitCode = main(); } catch (error) { process.stderr.write(`toolkit-integrity: ${error.message}\n`); process.exitCode = 1; }
