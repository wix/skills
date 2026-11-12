#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../../../lib/multilingual-public.js');
const { loadAdapter } = require('./multilingual-execute.js');

const CAPABILITIES = 'mapping/multilingual-public-capabilities.json';

function recoveryInventoryError(message, cause) {
  return Object.assign(new Error(message), {
    code: 'LANG_RECOVERY_JOURNAL_NOT_READY',
    route: 'recovery-row-query',
    rowId: 'inventory',
    ...(cause ? { cause } : {}),
  });
}

async function persistFailure(projectDir, error) {
  await core.writeJsonAtomic(path.join(projectDir, CAPABILITIES), {
    schemaVersion: 1,
    fields: [],
    contents: [],
    recoveryRows: [],
    failure: { rowId: error.rowId || 'inventory', code: error.code, route: error.route || null },
  });
}

async function run(projectDir, adapterModule) {
  const adapter = await loadAdapter(adapterModule, projectDir);
  try {
    if (typeof adapter.queryRecoveryRows !== 'function') {
      throw recoveryInventoryError('target adapter must implement queryRecoveryRows(cursor)');
    }
    const [localeSettings, locales, schemas, contents, recoveryRows] = await Promise.all([
      adapter.readLocaleSettings(),
      core.collectPages((cursor) => adapter.queryLocales(cursor), 'locales'),
      core.collectPages((cursor) => adapter.queryTranslationSchemas(cursor), 'translation schemas'),
      core.collectPages((cursor) => adapter.queryTranslationContents(cursor), 'translation content'),
      core.collectPages((cursor) => adapter.queryRecoveryRows(cursor), 'translation recovery rows')
        .catch((error) => { throw recoveryInventoryError('translation recovery rows could not be inventoried', error); }),
    ]);
    const manifest = core.buildCapabilityManifest({ localeSettings, locales, schemas, contents, recoveryRows });
    await core.writeJsonAtomic(path.join(projectDir, CAPABILITIES), manifest);
    return manifest;
  } catch (error) {
    if (error.code === 'LANG_RECOVERY_JOURNAL_NOT_READY') await persistFailure(projectDir, error);
    throw error;
  }
}

async function main() {
  const projectDir = process.argv[2] && path.resolve(process.argv[2]);
  const adapterIndex = process.argv.indexOf('--adapter');
  if (!projectDir || adapterIndex < 0 || !process.argv[adapterIndex + 1]) throw new Error('Usage: multilingual-inventory.js <projectDir> --adapter <module.js>');
  const result = await run(projectDir, process.argv[adapterIndex + 1]);
  process.stdout.write(`${JSON.stringify({ schemas: result.schemas.length, fields: result.fields.length, contents: result.contents.length })}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
