#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');

const BASELINE = 'state/multilingual-public/default-artifact-baseline.json';

async function run(projectDir, mode, files) {
  const current = await core.artifactDigests(projectDir, files);
  const baselineFile = path.join(projectDir, BASELINE);
  if (mode === 'capture') {
    await core.writeJsonAtomic(baselineFile, { schemaVersion: 1, files: current });
    return { captured: true, files: Object.keys(current).length };
  }
  if (mode !== 'verify') throw new Error('mode must be capture or verify');
  const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
  core.assertDefaultArtifactsUnchanged(baseline.files, current);
  return { verified: true, files: Object.keys(current).length };
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const mode = process.argv[3];
  const filesIndex = process.argv.indexOf('--files');
  const files = filesIndex < 0 ? [] : process.argv.slice(filesIndex + 1);
  if (!projectDir || !mode || !files.length) throw new Error('Usage: multilingual-default-invariance.js <projectDir> capture|verify --files <relative-path>...');
  const result = await run(projectDir, mode, files);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { BASELINE, run };
