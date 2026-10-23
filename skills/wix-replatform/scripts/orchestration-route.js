#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadArtifacts } = require('../lib/orchestration-state.js');
const { determineNextStep } = require('../lib/orchestration-router.js');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');

let progress;

// Telemetry safety net: record a resumed execution on a stale, open telemetry journal so
// nobody has to remember `start`. Required lazily inside the guard, so a missing or broken
// recorder can never fail the route; never touches stdout, stderr or the exit code. Only a
// resume, a busy lock or an error writes one progress line (team-only, when a progress log is
// configured); every other no-op is silent.
async function resumeStaleTelemetry(projectDir) {
  let telemetryResume;
  try {
    const { resumeIfStale } = require('../resources/rp-telemetry/lib/telemetry-recorder.js');
    telemetryResume = await resumeIfStale(projectDir, { trigger: 'route' });
  } catch (error) {
    telemetryResume = { resumed: false, reason: 'error', trigger: 'route', error: String((error && error.message) || error) };
  }
  try {
    const fields = { phase: 'orchestration', step: 'telemetry-resume', ...telemetryResume };
    if (telemetryResume.reason === 'resumed') {
      if (['partial', 'failed', 'deadline'].includes(telemetryResume.heal)) {
        progress.warn('Telemetry resumed a stale journal; BI heal incomplete', fields);
      } else {
        progress.progress('Telemetry resumed a stale journal', fields);
      }
    } else if (telemetryResume.reason === 'busy' || telemetryResume.reason === 'error') {
      progress.warn('Telemetry resume did not run', fields);
    }
  } catch {
    // A progress-log failure must not alter the route either.
  }
  return telemetryResume;
}

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
  await resumeStaleTelemetry(projectDir);
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
