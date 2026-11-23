'use strict';

// The one read-back validation verdict for an entity. The `read-back-gate.js validate` CLI and
// the orchestration router both call this, so the mapper's own check and the route agree.
const C = require('./read-back-contract');
const state = require('./read-back-state');

function deferredMapping(plan, entity) {
  if (plan?.fieldContractVersion !== 1) return null;
  const exact = require('./mapping-field-contract');
  const row = exact.readBackRow(plan, entity);
  return row && plan.executionScope?.deferredEntities?.find(item => item.entityRef === exact.entityRef(row)) || null;
}

// Before approval the only permissible failure is the missing identified approval for explicitly
// reviewed notMigrated paths; that state is named (awaiting-approval) but still exits 2.
const AWAITING = /^Identified exact-binding approval missing: |^identified interactive omission approval required$|^omission approval request missing$/;

async function validateStatus(projectDir, entity) {
  const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json');
  const deferred = deferredMapping(plan, entity);
  if (deferred) return { entity, status: 'deferred', code: 'mapping_scope_deferred', deferred, exitCode: 0 };
  let result;
  try {
    result = await C.validate(projectDir, entity);
  } catch {
    return { entity, status: 'invalid', errors: ['Read-back validation could not read required artifacts or gate history.'], exitCode: 2 };
  }
  const awaiting = !result.valid && result.errors.every(e => AWAITING.test(e));
  return {
    entity,
    status: result.valid ? 'valid' : awaiting ? 'awaiting-approval' : 'invalid',
    errors: result.errors,
    ...(result.heldRecords ? { heldRecords: result.heldRecords } : {}),
    ...(result.declarationGaps?.length ? { declarationGaps: result.declarationGaps } : {}),
    exitCode: result.valid ? 0 : 2
  };
}

// Statuses that let mapping leave its stage: nothing left to fix before the named approval.
const PASSING = new Set(['valid', 'awaiting-approval', 'deferred']);

// Every entity with a builder-pinned inventory (the mapper's read-back check has started for it)
// must pass. Returns the failures, without source values: errors name paths and counts only.
async function readBackFailures(projectDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(projectDir, 'execution', 'read-back-inventory');
  let names;
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort(); } catch { return []; }
  const failures = [], settled = require('./route-settlement').settledReadBackUnits(projectDir);
  for (const name of names) {
    const entity = name.slice(0, -'.json'.length);
    if (settled.has(entity)) continue;
    let inv = null;
    try { inv = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { /* unreadable: validate reports it */ }
    if (inv && !inv.builder) continue;
    let result;
    try {
      C.entityKey(entity);
      result = await validateStatus(projectDir, entity);
    } catch (error) {
      result = { status: 'failed', errors: [error.code || 'read_back_command_failed'] };
    }
    if (!PASSING.has(result.status)) failures.push({ entity, status: result.status, errors: result.errors || [] });
  }
  return failures;
}

// The toolkit's own read-back check, run where the builders exist: the codegen scaffold writes a
// pure builder per gated plan row (lib/codegen-scaffold.js writeReadBackBuilders). For every gated
// unit (lib/read-back-approval.js gatedEntities: one per resolved plan row that writes a product,
// contact, order or member) it builds the inventory over the import binding's extract when there is
// none or only a stale one, then validates. A unit with no builder, binding or inventory is
// `not-checked`, never passed. Returns the failures (paths and counts, never source values).
async function ensureReadBack(projectDir) {
  const units = await require('./read-back-approval').gatedEntities(projectDir);
  if (!units.length) return [];
  const plan = await state.readJson(projectDir, 'mapping/mapping-plan.json', {});
  const manifest = await state.readJson(projectDir, 'execution/execution-manifest.json', {});
  const fields = require('./mapping-field-contract');
  const inventory = require('./read-back-inventory');
  let builders = {};
  try { builders = require('./codegen-scaffold').writeReadBackBuilders(projectDir); } catch { /* reported per unit as not-checked */ }
  const failures = [], gaps = [];
  for (const entity of units) {
    let result = await validateStatus(projectDir, entity);
    const noteGaps = () => { for (const why of result.declarationGaps || []) gaps.push({ kind: 'read-back-declaration', step: `read-back ${entity}`, file: `mapping/entity-decisions/${C.decisionFileName(projectDir, entity)}`, why }); };
    if (PASSING.has(result.status) && result.status !== 'awaiting-approval') { noteGaps(); continue; }
    const inv = await state.readJson(projectDir, `execution/read-back-inventory/${entity}.json`, null);
    // A missing inventory is built; a stale one is rebuilt before its other findings are judged.
    if (!inv || (result.errors || []).some(error => inventory.staleOnly([error]))) {
      const row = fields.readBackRow(plan, entity);
      const binding = (manifest?.tasks || []).filter(task => task?.kind === 'import').flatMap(task => task.sourceBindings || [])
        .find(b => b && b.role !== 'source-archive' && row && (b.sourceEntity === row.sourceEntity || b.sourceEntity === fields.entityRef(row)));
      const builder = (row && builders[row.sourceEntity]) || inv?.builder?.path;
      if (!binding || !builder) {
        failures.push({ entity, status: 'not-checked', errors: [!binding ? `no import task binds ${row ? fields.entityRef(row) : entity}; the read-back check needs its extract` : `no read-back builder for ${fields.entityRef(row)}: run the codegen scaffold, or build the inventory with read-back-gate.js inventory --builder`] });
        continue;
      }
      let built;
      try { built = await inventory.buildInventory(projectDir, entity, { plan, extract: binding.extractPath, builder, sourceKey: binding.keyField || 'id' }); }
      catch (error) { built = { status: 'failed', code: error.code || 'read_back_command_failed' }; }
      if (built.status !== 'inventoried') {
        failures.push({ entity, status: 'not-checked', errors: [built.code || (built.errors || []).join('; ') || built.status] });
        continue;
      }
      result = await validateStatus(projectDir, entity);
    }
    noteGaps();
    // After approval nothing can still approve an omission: awaiting-approval fails here.
    if (!PASSING.has(result.status) || result.status === 'awaiting-approval') failures.push({ entity, status: result.status, errors: result.errors || [] });
  }
  // The plan-shape gaps reach the completion report as toolkit gaps (never a cutover task).
  require('./toolkit-gaps').recordToolkitGaps(projectDir, 'read-back-check', gaps);
  return failures;
}

module.exports = { validateStatus, readBackFailures, ensureReadBack, deferredMapping };
