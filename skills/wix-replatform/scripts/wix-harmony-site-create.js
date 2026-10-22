#!/usr/bin/env node
'use strict';

// Entry point for the Harmony generation path. Generation, polling bounds and
// receipt handling live in the shared destination coordinator (lib/destination.js) so the
// lock, attempt marker, no-second-POST and publication rules are the same code for every
// editor. This script only refuses to run unless the recorded choice selects generation.
const path = require('node:path');
const { loadArtifacts } = require('../lib/orchestration-state.js');
const { readSiteTypeDecision } = require('../lib/orchestration-decisions.js');
const { KNOWN_BUSINESS_TYPES } = require('../lib/destination-choice.js');
const { main: destinationMain } = require('./wix-destination.js');

async function main(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--project-dir');
  if (index === -1 || !argv[index + 1]) {
    console.error('Usage: node scripts/wix-harmony-site-create.js --project-dir <dir>');
    return 1;
  }
  const projectDir = path.resolve(argv[index + 1]);
  const { decisions } = await loadArtifacts(projectDir);
  const choice = readSiteTypeDecision(decisions || {});
  if (!choice || choice.errors.length || choice.siteType !== 'harmony' || !KNOWN_BUSINESS_TYPES.includes(choice.businessType)) {
    console.error('The recorded decision does not select Harmony generation (targetSiteType=harmony with a known business type). Use scripts/wix-destination.js ensure.');
    return 1;
  }
  return destinationMain(['ensure', '--project-dir', projectDir]);
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { main };
