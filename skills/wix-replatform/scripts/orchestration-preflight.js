#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadArtifacts, writeJsonAtomic } = require('../lib/orchestration-state.js');
const { runPreflight } = require('../lib/orchestration-preflight.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

let progress;

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/replatform/scripts/orchestration-preflight.js',
    ...parsed.progress,
  });
  progress.start('Orchestration preflight started', { phase: 'preflight' });

  const projectDirArg = parsed.args[0];
  if (!projectDirArg) {
    console.error('Usage: node scripts/orchestration-preflight.js <projectDir> [--progress-log <path>]');
    progress.error('Missing project directory', { phase: 'preflight' });
    process.exit(1);
  }
  const projectDir = path.resolve(projectDirArg);
  const artifacts = await loadArtifacts(projectDir);
  if (!artifacts.run) {
    throw new Error(`orchestration artifacts not initialized under ${projectDir}`);
  }

  const result = await runPreflight(projectDir, artifacts, { progress });
  await writeJsonAtomic(path.join(projectDir, 'orchestration', 'preflight.json'), result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'pass') {
    progress.complete('Orchestration preflight completed', { phase: 'preflight', artifact: projectDir });
  } else {
    progress.error('Orchestration preflight did not pass', { phase: 'preflight', artifact: projectDir, status: result.status });
  }
  process.exit(result.status === 'pass' ? 0 : 1);
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Orchestration preflight failed', { phase: 'preflight' });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
