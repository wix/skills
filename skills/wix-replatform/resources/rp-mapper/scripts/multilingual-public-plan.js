#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function run(projectDir) {
  const topology = await readJson(path.join(projectDir, 'discovery/public-source-languages.json'), null);
  if (!topology) throw new Error('discovery/public-source-languages.json is required');
  const contentRows = core.readNdjson(path.join(projectDir, 'discovery/public-multilingual-content.ndjson'));
  const objectPairings = core.readNdjson(path.join(projectDir, 'state/default-object-identity.ndjson'));
  const pairings = core.readNdjson(path.join(projectDir, 'state/default-member-identity.ndjson'));
  const capabilities = await readJson(path.join(projectDir, 'mapping/multilingual-public-capabilities.json'), { fields: [], contents: [] });
  const output = path.join(projectDir, 'mapping/multilingual-public-plan.ndjson');
  const priorPlanRows = core.readNdjson(output);
  const journalRows = [...(capabilities.recoveryRows || []), ...core.readNdjson(path.join(projectDir, 'state/multilingual-public/changes.ndjson'))];
  const plan = core.buildPlan({ topology, contentRows, objectPairings, pairings, capabilities, liveContents: capabilities.contents || [], journalRows, priorPlanRows });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, plan.rows.map((row) => JSON.stringify(row)).join('\n') + (plan.rows.length ? '\n' : ''));
  await core.writeJsonAtomic(path.join(projectDir, 'state/multilingual-public/plan.json'), {
    schemaVersion: 1,
    inputDigest: plan.inputDigest,
    capabilityDigest: capabilities.digest || core.digest(capabilities),
    counts: plan.rows.reduce((counts, row) => ({ ...counts, [row.state]: (counts[row.state] || 0) + 1 }), {}),
  });
  return plan;
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  if (!projectDir) throw new Error('Usage: multilingual-public-plan.js <projectDir>');
  const plan = await run(projectDir);
  process.stdout.write(`${JSON.stringify({ rows: plan.rows.length, inputDigest: plan.inputDigest })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
