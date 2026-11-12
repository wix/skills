#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');

async function run(projectDir, inputFile) {
  const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));
  const topology = core.normalizeTopology(input.topology);
  const content = core.normalizeContentRows(input.content || [], topology);
  await core.writeJsonAtomic(path.join(projectDir, 'discovery/public-source-languages.json'), topology);
  const output = path.join(projectDir, 'discovery/public-multilingual-content.ndjson');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, content.map((row) => JSON.stringify(row)).join('\n') + (content.length ? '\n' : ''));
  return { topology, rows: content.length };
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const flag = process.argv.indexOf('--input');
  if (!projectDir || flag < 0 || !process.argv[flag + 1]) throw new Error('Usage: public-multilingual.js <projectDir> --input <adapter-output.json>');
  const result = await run(projectDir, path.resolve(process.argv[flag + 1]));
  process.stdout.write(`${JSON.stringify({ mode: result.topology.mode, rows: result.rows })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
