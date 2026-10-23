#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  pathToFileURL
} = require('node:url');
const C = require('../lib/read-back-contract');
const state = require('../lib/read-back-state');
const {
  readExtract
} = require('../lib/read-back-extract');
function problem(code) {
  return Object.assign(new Error(code), {
    code
  });
}
function parse(args) {
  const [command, directory, ...flags] = args;
  if (!['contract', 'inventory', 'validate', 'summary'].includes(command) || !directory || directory.startsWith('--')) throw problem('usage');
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const name = flags[i];
    if (!['--entity', '--extract', '--builder', '--source-key', '--format'].includes(name) || !flags[i + 1] || flags[i + 1].startsWith('--') || Object.hasOwn(options, name)) throw problem('usage');
    options[name] = flags[i + 1];
  }
  if (command !== 'summary' && !options['--entity']) throw problem('entity_required');
  if (options['--entity']) C.entityKey(options['--entity']);
  const allowed = command === 'inventory' ? ['--entity', '--extract', '--builder', '--source-key', '--format'] : ['--entity'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw problem('usage');
  return {
    command,
    projectDir: path.resolve(directory),
    entity: options['--entity'],
    options
  };
}
async function projectFile(projectDir, supplied) {
  const file = path.resolve(projectDir, supplied),
    relative = path.relative(projectDir, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw problem('project_file_required');
  const realProject = await fs.realpath(projectDir),
    real = await fs.realpath(file);
  const realRelative = path.relative(realProject, real);
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || realRelative === '..' || path.isAbsolute(realRelative)) throw problem('project_file_required');
  return real;
}
function sourceKey(dotted = 'id') {
  const keys = dotted.split('.');
  if (keys.some(key => !key || ['__proto__', 'prototype', 'constructor'].includes(key))) throw problem('source_key_invalid');
  return record => {
    let value = record;
    for (const key of keys) value = value && Object.hasOwn(value, key) ? value[key] : undefined;
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw problem('source_key_missing');
    return value;
  };
}
function inventorySummary(entity, inv) {
  return {
    entity,
    status: 'inventoried',
    recordCount: inv.records.length,
    sourcePaths: inv.sourcePaths,
    writePaths: inv.writePaths
  };
}
async function run(args) {
  const {
    command,
    projectDir,
    entity,
    options
  } = parse(args);
  if (command === 'contract') {
    const file = `mapping/entity-decisions/${entity}.json`;
    const decision = await state.readJson(projectDir, file, {});
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw problem('entity_decision_invalid');
    await state.atomic(projectDir, file, {
      ...decision,
      readBackContract: C.domainContract(entity)
    });
    return {
      entity,
      status: 'contract-copied',
      domainDigest: C.domainContract(entity).domainDigest
    };
  }
  if (command === 'inventory') {
    if (!options['--extract']) return {
      entity,
      status: 'not-run',
      code: 'extract_missing',
      exitCode: 2
    };
    let file;
    try {
      file = await projectFile(projectDir, options['--extract']);
    } catch (error) {
      if (error.code === 'ENOENT') return {
        entity,
        status: 'not-run',
        code: 'extract_missing',
        exitCode: 2
      };
      throw error;
    }
    if (!options['--builder']) throw problem('builder_required');
    const builderPath = await projectFile(projectDir, options['--builder']);
    const builderModule = await import(pathToFileURL(builderPath).href);
    const buildWrite = builderModule.buildWrite || builderModule.default?.buildWrite;
    if (typeof buildWrite !== 'function') throw problem('builder_export_missing');
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json');
    const rows = C.mappingRows(plan, entity);
    const inv = await C.inventory(projectDir, entity, readExtract(file, {
      format: options['--format'] || 'auto'
    }), {
      sourceKey: sourceKey(options['--source-key']),
      buildWrite,
      rows
    });
    return {
      ...inventorySummary(entity, inv),
      preparationMs: inv.preparationMs
    };
  }
  if (command === 'validate') {
    let result;
    try {
      result = await C.validate(projectDir, entity);
    } catch {
      return {
        entity,
        status: 'invalid',
        errors: ['Read-back validation could not read required artifacts or gate history.'],
        exitCode: 2
      };
    }
    return {
      entity,
      status: result.valid ? 'valid' : 'invalid',
      errors: result.errors,
      exitCode: result.valid ? 0 : 2
    };
  }
  return require('../lib/read-back-summary').projectReadBackSummary(await state.load(projectDir), { entity });
}
async function main(args = process.argv.slice(2)) {
  try {
    const {
      exitCode = 0,
      ...result
    } = await run(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCode;
    return result;
  } catch (error) {
    // A generated builder or JSON parser may include source values in its message.
    const known = new Set(['usage', 'entity_required', 'project_file_required', 'entity_decision_invalid', 'source_key_invalid', 'source_key_missing', 'builder_required', 'builder_export_missing', 'extract_record_too_large', 'extract_record_invalid', 'extract_json_invalid', 'extract_json_trailing_data', 'extract_json_array_required', 'extract_json_incomplete', 'extract_options_invalid']);
    const result = {
      status: 'failed',
      code: known.has(error.code) ? error.code : 'read_back_command_failed'
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 2;
    return result;
  }
}
if (require.main === module) main();
module.exports = {
  main,
  run,
  parse,
  sourceKey
};
