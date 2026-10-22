#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadArtifacts, writeJsonAtomic } = require('../lib/orchestration-state.js');
const { runPreflight, recoverTelemetryJournal, telemetryDimsFromDecisions } = require('../lib/orchestration-preflight.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

let progress;

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/orchestration-preflight.js',
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
  await recoverTelemetry(projectDir, artifacts, result);
  await writeJsonAtomic(path.join(projectDir, 'orchestration', 'preflight.json'), result);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'pass') {
    progress.complete('Orchestration preflight completed', { phase: 'preflight', artifact: projectDir });
  } else {
    progress.error('Orchestration preflight did not pass', { phase: 'preflight', artifact: projectDir, status: result.status });
  }
  process.exit(result.status === 'pass' ? 0 : 1);
}

// The read-only check has reported what it found; this step recovers. It adds its
// details to the same `telemetry_journal` check, keeping the original reading, and writes one
// progress line. It never changes `result.status`, so the verdict and exit code stay exactly as
// the other checks made them. A failed recovery is recorded here for the RePlatform team only;
// nothing is printed for the person running the migration.
async function recoverTelemetry(projectDir, artifacts, result) {
  const check = result.checks.find((entry) => entry.id === 'telemetry_journal');
  if (!check) return;
  const details = await recoverTelemetryJournal(projectDir, check, telemetryDimsFromDecisions(artifacts.decisions || {}));
  Object.assign(check, details);
  const fields = { phase: 'preflight', step: 'telemetry-recovery', journal: check.journal, ...details };
  if (details.recovery === 'failed') {
    progress.warn('Telemetry recovery failed; the run continues without recording', fields);
  } else {
    progress.progress(`Telemetry recovery: ${details.recovery}`, fields);
  }
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Orchestration preflight failed', { phase: 'preflight' });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
