#!/usr/bin/env node
'use strict';

// Builds <project>/source-schema.json from the WordPress / WooCommerce capture in
// data/wp-discovery/ (and data/source-extract/ when the catalog extract has run), and copies
// discovery/plugin-coverage.json + discovery/entities/. Safe to re-run: keys the agent added to
// source-schema.json are kept. See lib/source-schema-builder.js.
//
//   node scripts/wp-source-schema.js <projectDir>

const path = require('node:path');
const { writeSourceSchema } = require('../lib/source-schema-builder.js');

function main(argv) {
  const projectDir = argv.find((a) => !a.startsWith('-'));
  if (!projectDir || argv.includes('--help')) {
    console.log('usage: node scripts/wp-source-schema.js <projectDir>');
    return projectDir ? 0 : 2;
  }
  try {
    const result = writeSourceSchema(path.resolve(projectDir));
    console.log(JSON.stringify({ ok: true, ...result }));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code || 'build_failed', message: error.message }));
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
