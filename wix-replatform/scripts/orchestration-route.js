#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadArtifacts } = require('../lib/orchestration-state.js');
const { determineNextStep } = require('../lib/orchestration-router.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

let progress;

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/orchestration-route.js',
    ...parsed.progress,
  });
  progress.start('Orchestration route started', { phase: 'orchestration' });

  const projectDirArg = parsed.args[0];
  if (!projectDirArg) {
    console.error('Usage: node scripts/orchestration-route.js <projectDir> [--progress-log <path>]');
    progress.error('Missing project directory', { phase: 'orchestration' });
    process.exit(1);
  }
  const projectDir = path.resolve(projectDirArg);
  const artifacts = await loadArtifacts(projectDir);
  if (!artifacts.run) {
    throw new Error(`orchestration artifacts not initialized under ${projectDir}`);
  }
  const result = await determineNextStep(projectDir, artifacts);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok) {
    progress.complete('Orchestration route completed', { phase: 'orchestration', artifact: projectDir });
  } else {
    progress.error('Orchestration route failed', { phase: 'orchestration', artifact: projectDir });
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Orchestration route failed', { phase: 'orchestration' });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
