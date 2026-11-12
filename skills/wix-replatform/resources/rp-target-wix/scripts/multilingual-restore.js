#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const target = require('../lib/multilingual-target.js');
const { loadAdapter } = require('./multilingual-execute.js');

async function run(projectDir, recoveryRowId, { adapterModule, proofFile }) {
  const proof = JSON.parse(await fs.readFile(proofFile, 'utf8'));
  const adapter = await loadAdapter(adapterModule, projectDir);
  return target.restore({ projectDir, adapter, proof, recoveryRowId });
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const recoveryRowId = process.argv[3];
  const adapterIndex = process.argv.indexOf('--adapter');
  const proofIndex = process.argv.indexOf('--proof');
  if (!projectDir || !recoveryRowId || adapterIndex < 0 || proofIndex < 0) throw new Error('Usage: multilingual-restore.js <projectDir> <recovery-row-id> --adapter <module.js> --proof <contract-evidence.json>');
  const result = await run(projectDir, recoveryRowId, { adapterModule: process.argv[adapterIndex + 1], proofFile: path.resolve(process.argv[proofIndex + 1]) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'restored') process.exitCode = 2;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
