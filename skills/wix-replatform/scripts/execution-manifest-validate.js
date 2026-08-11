#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateManifest } = require('../lib/execution-manifest.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

let progress;

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/replatform/scripts/execution-manifest-validate.js',
    ...parsed.progress,
  });
  progress.start('Execution manifest validation started', { phase: 'validation' });

  const manifestPathArg = parsed.args[0];
  if (!manifestPathArg) {
    console.error('Usage: node scripts/execution-manifest-validate.js <manifestPath> [--progress-log <path>]');
    progress.error('Missing manifest path', { phase: 'validation' });
    process.exit(1);
  }
  const manifestPath = path.resolve(manifestPathArg);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const result = validateManifest(manifest);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok) {
    progress.complete('Execution manifest validation completed', { phase: 'validation', artifact: manifestPath });
  } else {
    progress.error('Execution manifest validation failed', { phase: 'validation', artifact: manifestPath, count: result.errors.length, unit: 'errors' });
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Execution manifest validation failed', { phase: 'validation' });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
