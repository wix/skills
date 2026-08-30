#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  createFreshnessMetadata,
  validateImportPlanFreshness,
  writeFreshnessMetadata,
  writeImportPlanDelta,
} = require('../lib/artifact-freshness.js');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/artifact-freshness.js write <projectDir> --domains-dir <domainsDir> [--metadata <path>]',
    '  node scripts/artifact-freshness.js check <projectDir> --domains-dir <domainsDir> [--metadata <path>] [--delta <path>]',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const projectDir = args._[1] ? path.resolve(args._[1]) : null;
  if (args.help) {
    process.stderr.write(`${usage()}\n`);
    process.exit(0);
  }
  if (!command || !projectDir || args.help) {
    process.stderr.write(`${usage()}\n`);
    process.exit(1);
  }
  const domainsDir = args.domainsDir ? path.resolve(args.domainsDir) : null;
  const metadataPath = args.metadata || 'execution/review/import-plan.freshness.json';
  if (command === 'write') {
    const metadata = createFreshnessMetadata({ projectDir, domainsDir });
    writeFreshnessMetadata(path.resolve(projectDir, metadataPath), metadata);
    process.stdout.write(`${JSON.stringify({ ok: true, metadataPath }, null, 2)}\n`);
    return;
  }
  if (command === 'check') {
    const result = validateImportPlanFreshness({ projectDir, domainsDir, metadataPath });
    if (!result.ok && args.delta) {
      writeImportPlanDelta(path.resolve(projectDir, args.delta), result);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
