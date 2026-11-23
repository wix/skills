#!/usr/bin/env node
'use strict';

// Promote a full adapter's source-coverage record into the canonical discovery artifacts.
//
//   node scripts/promote-source-coverage.js <projectDir> --adapter wordpress|csv|shopify
//
// Run after `source-schema.json` is synthesized. Validates
// `data/<source>-discovery/source-coverage.json`, writes `discovery/source-coverage.json`, and
// stamps `sourceCoverageContract: 1` on the project-root `source-schema.json` -- the only place any
// consumer reads that stamp from. Quick modes write their own coverage at `plan`.
//
// It also promotes the adapter's `source-locale.json` to `discovery/source-locale.json`
// (currency, time zone, language, country -- unknown values are explicit). A missing or invalid
// regional file refuses promotion exactly like a missing coverage file: there is no unstamped path.
//
// For WordPress it first adds what the WooCommerce reader catalog already knows and the synthesis
// left out (the product-variation child entity, the category parent self-relation and hierarchy
// flag); see rp-source-wordpress/lib/catalog-schema-defaults.js.
//
// Exit codes: 0 promoted; 2 refused (unknown adapter, adapter file missing or malformed, or no
// source-schema.json yet); 1 usage error.

const fs = require('node:fs');
const path = require('node:path');
const { promoteSourceCoverage, SourceCoverageError } = require('../../../lib/source-coverage.js');
const { promoteSourceRegional, SourceRegionalError } = require('../../../lib/source-regional.js');

async function main() {
  const argv = process.argv.slice(2);
  let adapter = null;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--adapter') { adapter = argv[i + 1]; i += 1; } else positional.push(argv[i]);
  }
  const [projectDirArg] = positional;
  if (!projectDirArg || !adapter) {
    process.stderr.write('Usage: promote-source-coverage.js <projectDir> --adapter wordpress|csv|shopify\n');
    return 1;
  }
  try {
    const projectDir = path.resolve(projectDirArg);
    const schemaFile = path.join(projectDir, 'source-schema.json');
    let catalogDefaults = [];
    if (adapter === 'wordpress' && fs.existsSync(schemaFile)) {
      const { applyCatalogSchemaDefaults } = require(path.join(__dirname, '..', '..', 'rp-source-wordpress', 'lib', 'catalog-schema-defaults.js'));
      const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
      catalogDefaults = applyCatalogSchemaDefaults(schema);
      if (catalogDefaults.length) {
        fs.writeFileSync(`${schemaFile}.writing`, `${JSON.stringify(schema, null, 2)}\n`);
        fs.renameSync(`${schemaFile}.writing`, schemaFile);
      }
    }
    const result = await promoteSourceCoverage(projectDir, { adapter });
    await promoteSourceRegional(projectDir, { adapter });
    process.stdout.write(`${JSON.stringify({ ok: true, adapter, rows: result.rows, artifact: 'discovery/source-coverage.json', locale: 'discovery/source-locale.json', catalogDefaults })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof SourceCoverageError || error instanceof SourceRegionalError) {
      process.stderr.write(`refused: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
