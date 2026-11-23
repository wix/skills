'use strict';

// Builds execution/read-back-inventory/<entity>.json with the reviewed builder over the recorded
// extract. The `read-back-gate.js inventory` CLI and the gate's own refresh of a stale inventory
// (runGatedEntity) share this one implementation, so a refreshed inventory is the CLI's inventory.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('./read-back-contract');
const state = require('./read-back-state');
const { readExtract } = require('./read-back-extract');
const { joinChildExtracts } = require('./child-extracts');

function problem(code) { return Object.assign(new Error(code), { code }); }
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
// The child extracts the entity's plan suggestion declares, beside the parent extract (the
// generated handler's default path): the import loop joins these before build.
function declaredChildExtracts(projectDir, plan, sourceEntity, parentExtractPath) {
  const entity = require('./mapping-field-contract').readBackRow(plan || {}, sourceEntity);
  if (!entity) return [];
  const { childExtractsFor, sourcePlatform } = require('./codegen-scaffold');
  return childExtractsFor(sourcePlatform(projectDir, plan), entity).map(child => ({
    extractPath: path.posix.join(path.posix.dirname(parentExtractPath), `${child.sourceEntity}.ndjson`), parentField: child.parentField, as: child.as }));
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

async function buildInventory(projectDir, entity, { plan = null, extract, builder, sourceKey: key, format } = {}) {
  plan ||= await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
  let file;
  try {
    file = await projectFile(projectDir, extract);
  } catch (error) {
    if (error.code === 'ENOENT') return { entity, status: 'not-run', code: 'extract_missing', exitCode: 2 };
    throw error;
  }
  if (!builder) throw problem('builder_required');
  const builderPath = await projectFile(projectDir, builder);
  // Refuse before loading: the pre-approval builder may not carry client/executor wiring.
  C.assertPureBuilder(await fs.readFile(builderPath, 'utf8'));
  const builderModule = await import(pathToFileURL(builderPath).href);
  const buildWrite = builderModule.buildWrite || builderModule.default?.buildWrite;
  if (typeof buildWrite !== 'function') throw problem('builder_export_missing');
  const rows = C.mappingRows(plan, entity);
  // The builder is pinned: a later change to it makes this inventory stale.
  const realProject = await fs.realpath(projectDir);
  const pinned = { path: path.relative(realProject, builderPath).split(path.sep).join('/'), sha256: require('./artifact-freshness').hashArtifact(realProject, path.relative(realProject, builderPath)) };
  // The toolkit records the extract version it inventories; a changed or field-losing version is refused.
  const ledger = require('./extract-ledger');
  const extractPath = path.relative(realProject, await fs.realpath(file)).split(path.sep).join('/');
  // An unreadable record or key is reported by the inventory below, with its established code.
  // A changed or field-losing extract is re-read from the source and reported, never refused.
  let recorded = null, recordError = null;
  try { recorded = (await ledger.ensureExtract(realProject, { entity, extractPath, keyField: key || 'id', recordedBy: 'read-back-inventory' })).row; }
  catch (error) { recordError = error.code || 'extract_unreadable'; }
  if (recordError === 'source_extract_unreadable') return { entity, status: 'not-run', code: recordError, next: [ledger.nextStep(recordError)], exitCode: 2 };
  if (recordError && !/^extract_/.test(recordError)) return { entity, status: 'invalid', errors: [`${recordError}:${extractPath}`], next: [ledger.nextStep(recordError)].filter(Boolean), exitCode: 2 };
  // The same record the import step builds: the parent row with its child extracts joined.
  // Each child file is pinned too, so a changed child makes this inventory stale.
  const children = declaredChildExtracts(realProject, plan, entity, extractPath);
  const parents = readExtract(file, { format: format || 'auto' }), childPins = [];
  // Read errors still surface inside the inventory's own read, with their established codes.
  const records = !children.length ? parents : (async function* () { yield* joinChildExtracts(realProject, await Array.fromAsync(parents), key || 'id', children); })();
  if (children.length) {
    for (const child of children) childPins.push({ path: child.extractPath, sha256: await ledger.fileDigest(realProject, child.extractPath).catch(() => null) });
  }
  const inv = await C.inventory(projectDir, entity, records, {
    sourceKey: sourceKey(key),
    buildWrite,
    rows,
    templates: C.selectorTemplates(plan, entity),
    builder: pinned,
    extract: recorded ? { path: extractPath, sha256: recorded.sha256, ledgerHead: recorded.rowHash, ...(childPins.length ? { children: childPins } : {}) } : null,
    inputs: { ...(key ? { sourceKey: key } : {}), ...(format ? { format } : {}) }
  });
  if (!recorded) return { entity, status: 'invalid', errors: [`${recordError}:${extractPath}`], exitCode: 2 };
  return {
    ...inventorySummary(entity, inv),
    preparationMs: inv.preparationMs
  };
}

// Validation errors that only say the inventory no longer describes the current builder or extract.
// Rebuilding it from the paths it recorded answers them; any other error is a mapping/builder finding.
const STALE = [/^read-back inventory stale /, /^source_extract_changed_since_inventory:/, /^read-back inventory has no recorded source extract;/, /^read-back inventory held summary does not match its records;/];
function staleOnly(errors) { return Array.isArray(errors) && errors.length > 0 && errors.every(error => STALE.some(pattern => pattern.test(error))); }

// The gate's refresh: a stale-only inventory is rebuilt with the builder and extract it recorded
// (and its recorded source key and format). Returns { inv, refreshed: { reasons } } or the inventory as it was.
async function refreshIfStale(projectDir, entity, inv) {
  if (!inv?.builder?.path || !inv?.extract?.path) return { inv, refreshed: null };
  const checked = await C.validate(projectDir, entity, { inv });
  if (checked.valid || !staleOnly(checked.errors)) return { inv, refreshed: null };
  const result = await buildInventory(projectDir, entity, { extract: inv.extract.path, builder: inv.builder.path, sourceKey: inv.inputs?.sourceKey, format: inv.inputs?.format });
  if (result.status !== 'inventoried') return { inv, refreshed: { reasons: checked.errors, failed: result.code || (result.errors || []).join('; ') || result.status } };
  return { inv: await state.readJson(projectDir, `execution/read-back-inventory/${entity}.json`, null), refreshed: { reasons: checked.errors } };
}

module.exports = { buildInventory, refreshIfStale, staleOnly, sourceKey, projectFile, declaredChildExtracts };
