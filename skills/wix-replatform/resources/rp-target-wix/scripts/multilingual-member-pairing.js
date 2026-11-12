#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');

async function run(projectDir, inputFile) {
  const [topology, bindings] = await Promise.all([
    fs.readFile(path.join(projectDir, 'discovery/public-source-languages.json'), 'utf8').then(JSON.parse),
    fs.readFile(inputFile, 'utf8').then(JSON.parse),
  ]);
  const rows = core.buildMemberPairings(bindings, (topology.additionalLocales || []).length);
  const output = path.join(projectDir, 'state/default-member-identity.ndjson');
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (!rows.length) {
    await fs.rm(output, { force: true });
    return rows;
  }
  await fs.writeFile(output, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return rows;
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const inputIndex = process.argv.indexOf('--input');
  if (!projectDir || inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error('Usage: multilingual-member-pairing.js <projectDir> --input <writer-readback-bindings.json>');
  const rows = await run(projectDir, path.resolve(process.argv[inputIndex + 1]));
  process.stdout.write(`${JSON.stringify({ rows: rows.length })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
