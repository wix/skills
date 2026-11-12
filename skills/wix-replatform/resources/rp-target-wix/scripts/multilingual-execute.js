#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');
const target = require('../lib/multilingual-target.js');

async function loadAdapter(moduleFile, projectDir) {
  const loaded = require(path.resolve(moduleFile));
  const adapter = typeof loaded.createAdapter === 'function' ? await loaded.createAdapter({ projectDir }) : loaded;
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter module must export an adapter object or createAdapter()');
  return adapter;
}

async function run(projectDir, { adapterModule, proofFile }) {
  const plan = { schemaVersion: 1, rows: core.readNdjson(path.join(projectDir, 'mapping/multilingual-public-plan.ndjson')) };
  const proof = JSON.parse(await fs.readFile(proofFile, 'utf8'));
  const adapter = await loadAdapter(adapterModule, projectDir);
  return target.executePlan({ projectDir, plan, adapter, proof });
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const adapterIndex = process.argv.indexOf('--adapter');
  const proofIndex = process.argv.indexOf('--proof');
  if (!projectDir || adapterIndex < 0 || proofIndex < 0) throw new Error('Usage: multilingual-execute.js <projectDir> --adapter <module.js> --proof <contract-evidence.json>');
  const result = await run(projectDir, { adapterModule: process.argv[adapterIndex + 1], proofFile: path.resolve(process.argv[proofIndex + 1]) });
  process.stdout.write(`${JSON.stringify({ rows: result.receipt.rows.length, requests: result.cost.requestCount, zeroWriteRerun: result.receipt.zeroWriteRerun })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { loadAdapter, run };
