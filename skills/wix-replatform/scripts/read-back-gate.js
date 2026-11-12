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
  if (!['contract', 'inventory', 'validate', 'summary', 'draft-stubs'].includes(command) || !directory || directory.startsWith('--')) throw problem('usage');
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const name = flags[i];
    if (!['--entity', '--extract', '--builder', '--source-key', '--format', '--omissions'].includes(name) || !flags[i + 1] || flags[i + 1].startsWith('--') || Object.hasOwn(options, name)) throw problem('usage');
    options[name] = flags[i + 1];
  }
  if (command !== 'summary' && !options['--entity']) throw problem('entity_required');
  if (options['--entity']) C.entityKey(options['--entity']);
  const allowed = command === 'inventory' ? ['--entity', '--extract', '--builder', '--source-key', '--format'] : command === 'contract' ? ['--entity','--omissions'] : ['--entity'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw problem('usage');
  if (options['--omissions'] && options['--omissions'] !== 'review') throw problem('usage');
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
function deferredMapping(plan, entity) {
  if (plan?.fieldContractVersion !== 1) return null;
  const exact = require('../lib/mapping-field-contract');
  const row = exact.entityRows(plan).find(candidate => exact.entityKeyMatches(candidate, entity));
  return row && plan.executionScope?.deferredEntities?.find(item => item.entityRef === exact.entityRef(row)) || null;
}
function inventorySummary(entity, inv) {
  return {
    entity,
    status: 'inventoried',
    recordCount: inv.records.length,
    sourcePaths: inv.sourcePaths,
    writePaths: inv.writePaths,
    ...(inv.heldRecords ? { heldRecords: inv.heldRecords } : {})
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
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
    const file = `mapping/entity-decisions/${C.decisionFileName(projectDir, entity)}`;
    const decision = await state.readJson(projectDir, file, {});
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw problem('entity_decision_invalid');
    if (plan.fieldContractVersion === 1) {
      const exact = require('../lib/mapping-field-contract');
      const entries = exact.entityRows(plan).filter(row => exact.entityKeyMatches(row, entity));
      if (entries.length !== 1) throw problem('entity_decision_invalid');
      entries[0].readBackContract = C.domainContract(entity);
      if (plan.entities && !Array.isArray(plan.entities)) {
        const key = Object.keys(plan.entities).find(key => exact.entityRef({sourceEntity: key, ...plan.entities[key]}) === exact.entityRef(entries[0]));
        plan.entities[key].readBackContract = entries[0].readBackContract;
      }
      // This CLI edits one entity; explicitly retain the other entities' current proposals.
      // One-click cannot approve omissions: a plain call clears leftover proposals (they defer).
      const selectedRef=exact.entityRef(entries[0]);
      const oneClick=require('../lib/mapping-omission-approval').mode(await state.readJson(projectDir,'orchestration/decisions.json',{}))==='one_click';
      const omissionReviewEntityRefs=oneClick ? [] : exact.entityRows(plan)
        .filter(row=>row.omissionReviewRequested===true && exact.entityRef(row)!==selectedRef).map(exact.entityRef);
      if (options['--omissions']==='review') omissionReviewEntityRefs.push(selectedRef);
      await exact.writeMappingAuthority(projectDir, plan, { provisionalEntityRefs: plan.executionScope?.provisionalEntityRefs ?? null,
        omissionReviewEntityRefs: omissionReviewEntityRefs.length ? omissionReviewEntityRefs : null });
    } else await state.atomic(projectDir, file, {
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
    // A deferred entity is a durable mapping/cutover gap, not an inventory failure.
    // Check the exact mapping before requiring an extract or builder: its source data
    // may be precisely what the mapper could not read.
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
    const deferred = deferredMapping(plan, entity);
    if (deferred) return { entity, status: 'deferred', code: 'mapping_scope_deferred', deferred, exitCode: 0 };
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
    // Refuse before loading: the pre-approval builder may not carry client/executor wiring.
    C.assertPureBuilder(await fs.readFile(builderPath, 'utf8'));
    const builderModule = await import(pathToFileURL(builderPath).href);
    const buildWrite = builderModule.buildWrite || builderModule.default?.buildWrite;
    if (typeof buildWrite !== 'function') throw problem('builder_export_missing');
    const rows = C.mappingRows(plan, entity);
    // The builder is pinned: a later change to it makes this inventory stale.
    const realProject = await fs.realpath(projectDir);
    const builder = { path: path.relative(realProject, builderPath).split(path.sep).join('/'), sha256: require('../lib/artifact-freshness').hashArtifact(realProject, path.relative(realProject, builderPath)) };
    // The toolkit records the extract version it inventories; a changed or field-losing version is refused.
    const ledger = require('../lib/extract-ledger');
    const extractPath = path.relative(realProject, await fs.realpath(file)).split(path.sep).join('/');
    // An unreadable record or key is reported by the inventory below, with its established code.
    // A changed or field-losing extract is re-read from the source and reported, never refused.
    let recorded = null, recordError = null;
    try { recorded = (await ledger.ensureExtract(realProject, { entity, extractPath, keyField: options['--source-key'] || 'id', recordedBy: 'read-back-inventory' })).row; }
    catch (error) { recordError = error.code || 'extract_unreadable'; }
    if (recordError === 'source_extract_unreadable') return { entity, status: 'not-run', code: recordError, next: [ledger.nextStep(recordError)], exitCode: 2 };
    if (recordError && !/^extract_/.test(recordError)) return { entity, status: 'invalid', errors: [`${recordError}:${extractPath}`], next: [ledger.nextStep(recordError)].filter(Boolean), exitCode: 2 };
    const inv = await C.inventory(projectDir, entity, readExtract(file, {
      format: options['--format'] || 'auto'
    }), {
      sourceKey: sourceKey(options['--source-key']),
      buildWrite,
      rows,
      templates: C.selectorTemplates(plan, entity),
      builder,
      extract: recorded ? { path: extractPath, sha256: recorded.sha256, ledgerHead: recorded.rowHash } : null
    });
    if (!recorded) return { entity, status: 'invalid', errors: [`${recordError}:${extractPath}`], exitCode: 2 };
    return {
      ...inventorySummary(entity, inv),
      preparationMs: inv.preparationMs
    };
  }
  if (command === 'validate') {
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json');
    const deferred = deferredMapping(plan, entity);
    if (deferred) return { entity, status: 'deferred', code: 'mapping_scope_deferred', deferred, exitCode: 0 };
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
    // Before approval the only permissible failure is the missing identified approval for
    // explicitly reviewed notMigrated paths; that state is named but still exits 2 (no writes).
    const awaiting = !result.valid && result.errors.every(e => /^Identified exact-binding approval missing: |^identified interactive omission approval required$|^omission approval request missing$/.test(e));
    return {
      entity,
      status: result.valid ? 'valid' : awaiting ? 'awaiting-approval' : 'invalid',
      errors: result.errors,
      ...(result.heldRecords ? { heldRecords: result.heldRecords } : {}),
      exitCode: result.valid ? 0 : 2
    };
  }
  if (command === 'draft-stubs') {
    // Read-only: proposes unresolved stubs for unclaimed descendants of selected metadata values.
    const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json');
    const inv = await state.readJson(projectDir, `execution/read-back-inventory/${entity}.json`);
    if (!inv) return { entity, status: 'not-run', code: 'inventory_missing', exitCode: 2 };
    return { entity, status: 'draft', stubs: C.draftSelectorDescendantStubs(plan, entity, inv) };
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
    const known = new Set(['usage', 'entity_required', 'project_file_required', 'entity_decision_invalid', 'source_key_invalid', 'source_key_missing', 'builder_required', 'builder_export_missing', 'builder_not_pure', 'source_location_invalid', 'selector_template_ambiguous', 'applies_when_invalid', 'builder_hold_invalid', 'builder_hold_unknown_decision', 'builder_hold_retired', 'extract_record_too_large', 'extract_record_invalid', 'extract_json_invalid', 'extract_json_trailing_data', 'extract_json_array_required', 'extract_json_incomplete', 'extract_options_invalid']);
    const result = {
      status: 'failed',
      code: known.has(error.code) ? error.code : 'read_back_command_failed',
      // Source ids and toolkit remediation only: never the builder's message (it may carry values).
      ...(error.code === 'builder_hold_retired' ? { retired: error.retired, remediation: error.remediation } : {})
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
