#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  COMPLETION_FILE,
  createMigrationCompletion,
  loadMigrationCompletionInputs,
} = require('../lib/migration-completion.js');
const { loadArtifacts, writeJsonAtomic } = require('../lib/orchestration-state.js');
const { getDecisionValue } = require('../lib/orchestration-decisions.js');

async function main() {
  const projectDirArg = process.argv[2];
  if (!projectDirArg) throw new Error('Usage: node scripts/migration-completion.js <projectDir>');
  const projectDir = path.resolve(projectDirArg);
  const artifacts = await loadArtifacts(projectDir);
  const deliveryMode = getDecisionValue(artifacts.decisions || {}, 'deliveryMode');
  const inputs = await loadMigrationCompletionInputs(projectDir);
  const completion = createMigrationCompletion({ deliveryMode, ...inputs });
  const outputPath = path.join(projectDir, COMPLETION_FILE);
  await writeJsonAtomic(outputPath, completion);
  console.log(JSON.stringify({ ok: true, outputPath, completion }, null, 2));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
