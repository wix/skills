#!/usr/bin/env node
'use strict';

// Fixed CSV extract: reads the files in source-schema.json (sourceMeta.sourceFiles) and writes
// data/source-extract (lib/csv-extractor.js; field names per vendor in reader-catalog.json).
// Usage: node csv-extract.js --project <dir> [--entity <id>]... [--sample] [--list]
// Exit: 0 ok, 1 a file failed, 2 usage.

const path = require('node:path');
const { createCsvExtractor } = require('../lib/csv-extractor.js');

async function main(argv) {
  const args = { entities: [], sample: false, list: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--entity') args.entities.push(argv[++i]);
    else if (a === '--sample') args.sample = true;
    else if (a === '--list') args.list = true;
    else { process.stderr.write(`unknown argument ${a}\n`); return 2; }
  }
  if (!args.project) { process.stderr.write('usage: csv-extract.js --project <dir> [--entity <id>] [--sample] [--list]\n'); return 2; }
  const ex = createCsvExtractor({ projectDir: path.resolve(args.project) });
  if (args.list) {
    process.stdout.write(`${JSON.stringify(ex.streams.map((s) => ({ role: s.role, vendor: s.vendor, platform: ex.platformOf(s), entities: ex.entitiesOf(s) })))}\n`);
    return 0;
  }
  const results = await ex.extractAll(args.entities.length ? args.entities : null, { sample: args.sample });
  process.stdout.write(`${JSON.stringify({ results })}\n`);
  return results.some((r) => r.status === 'failed') ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${error.code || 'csv_extract_failed'}: ${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
