'use strict';

// The source-archive import task (rp-import-codegen "CMS item quota and the source archive"). The
// archive is fully planned by the toolkit (resources/rp-target-wix/lib/source-archive.js
// planSourceArchive): this module plans the items from the mapping plan, each entity's extract and
// the crosswalk (an item names its records' Wix ids, so the task runs after the entity tasks),
// writes them as the task's own extract (the dependency gate reads it like any source), and sends
// one CMS item per planned item through the fixed loop (runRecordTask). The item key is its source
// key (`archive:<itemKey>`), so a re-run skips what landed. The codegen scaffold writes the handler
// that calls `run`, and adds the task to the manifest (lib/codegen-scaffold.js addSourceArchiveTask).

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ENTITY = 'source-archive';
const at = (record, dotted) => String(dotted).split('.').reduce((value, key) => (value == null ? undefined : value[key]), record);
function readNdjson(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : null;
}
function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

// Every planned item, with its entity's ImportArchive_* collection id.
async function plannedItems(projectDir, plan, manifest) {
  const archive = require('../resources/rp-target-wix/lib/source-archive.js');
  const bindings = ((manifest && manifest.tasks) || []).filter((task) => task && task.kind === 'import').flatMap((task) => task.sourceBindings || [])
    .filter((b) => b && b.role !== 'source-archive' && b.sourceEntity !== SOURCE_ENTITY);
  const bindingOf = (sourceEntity) => bindings.find((b) => b.sourceEntity === sourceEntity) || null;
  let bySource = {};
  try { bySource = (await require('./local-state.js').loadCrosswalk(projectDir)).bySource; } catch { bySource = {}; }
  const { entities } = archive.planSourceArchive({
    plan,
    readRecords: (sourceEntity) => {
      const binding = bindingOf(sourceEntity);
      return readNdjson(path.join(projectDir, binding ? binding.extractPath : path.join('data', 'source-extract', `${sourceEntity}.ndjson`)));
    },
    identity: (row, record) => {
      const binding = bindingOf(row.sourceEntity);
      const id = binding ? at(record, binding.keyField || 'id') : undefined;
      if (id === undefined || id === null) return null;
      const landed = bySource[`${binding.keyPrefix}${id}`];
      return { sourceKey: String(id), wixId: landed && landed.targetId ? String(landed.targetId) : null };
    },
  });
  return entities.flatMap((entity) => entity.items.map((item) => ({ ...item, collectionId: entity.collectionId })));
}

async function run(ctx, { projectDir }) {
  const plan = ctx.mappingPlan || JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping/mapping-plan.json'), 'utf8'));
  const binding = (ctx.task.sourceBindings || []).find((row) => row.sourceEntity === SOURCE_ENTITY);
  if (!binding) throw Object.assign(new Error(`task ${ctx.taskId} has no source binding for ${SOURCE_ENTITY}`), { code: 'SOURCE_BINDING_MISSING' });
  const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'execution/execution-manifest.json'), 'utf8'));
  const items = await plannedItems(projectDir, plan, manifest);
  const extract = path.join(projectDir, binding.extractPath), extractManifest = path.join(projectDir, binding.manifestPath);
  const changed = writeIfChanged(extract, items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : ''));
  if (changed || !fs.existsSync(extractManifest)) {
    writeIfChanged(extractManifest, `${JSON.stringify({ schemaVersion: 1, entity: SOURCE_ENTITY, file: binding.extractPath, rowsWritten: items.length, snapshotTotal: items.length, complete: true, extractedAt: new Date().toISOString() }, null, 2)}\n`);
  }
  const selection = typeof ctx.selectRecords === 'function' ? await ctx.selectRecords(ctx, items, binding) : { mode: 'full', filter: () => true };
  const writers = require('../resources/rp-target-wix/lib/wix-writers');
  return require('./import-task-runner.js').runRecordTask({
    taskBinding: ctx.taskBinding, wix: ctx.wix, sourceEntity: SOURCE_ENTITY, records: items, sourceSystem: plan.sourceSystem || plan.sourcePlatform || 'source',
    build: (item) => { const { collectionId, ...data } = item; return { collectionId, dataItem: { data } }; },
    send: async (client, payload) => ({ targetId: writers.dataItemId(await writers.insertDataItem(client, payload.collectionId, payload.dataItem.data)) }),
    stopRequested: ctx.stopRequested, selectionMode: selection.mode, recordFilter: selection.filter,
  });
}

module.exports = { run, plannedItems, SOURCE_ENTITY };
