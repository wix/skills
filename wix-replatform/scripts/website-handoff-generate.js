#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createProgressLogger, parseProgressArgs } = require('../lib/progress-log.js');
const { generateWebsiteHandoff } = require('../lib/website-handoff.js');

let progress;

async function main() {
  const parsed = parseProgressArgs(process.argv.slice(2));
  progress = createProgressLogger({
    script: 'skills/wix-replatform/scripts/website-handoff-generate.js',
    ...parsed.progress,
  });
  progress.start('Website handoff generation started', { phase: 'orchestration', step: 'website-handoff' });

  const projectDirArg = parsed.args[0];
  if (!projectDirArg) {
    console.error('Usage: node scripts/website-handoff-generate.js <projectDir> [--progress-log <path>]');
    progress.error('Missing project directory', { phase: 'orchestration', step: 'website-handoff' });
    process.exit(1);
  }

  const projectDir = path.resolve(projectDirArg);
  const result = await generateWebsiteHandoff(projectDir);
  console.log(JSON.stringify({
    ok: true,
    handoffPath: path.relative(projectDir, result.handoffPath).replace(/\\/g, '/'),
    summaryPath: path.relative(projectDir, result.summaryPath).replace(/\\/g, '/'),
    allowedNow: result.handoff.frontendPhase.allowedNow,
    dynamicRouteCount: result.handoff.routeIntent.dynamicRoutes.length,
    collectionCount: result.handoff.bindings.cmsCollections.length,
    wixAppCount: result.handoff.bindings.wixApps.length,
  }, null, 2));
  progress.complete('Website handoff generation completed', {
    phase: 'orchestration',
    step: 'website-handoff',
    artifact: projectDir,
  });
}

main().catch((error) => {
  if (progress) {
    progress.error(error && error.message ? error.message : 'Website handoff generation failed', {
      phase: 'orchestration',
      step: 'website-handoff',
    });
  }
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
