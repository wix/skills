'use strict';

// Exact generated wiring, not a JavaScript analyzer. Configuration comes from the
// canonical source/mapping artifacts, never from generated --describe output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VERSION = 1;
const FILES = ['src/import/plugin-handoff.js', 'src/import/run-import.js', 'src/extract/run-extract.js'];
const HELPERS = ['plugin-entity-read-plan.js', 'structure-bridge-reader.js', 'wix-wp-plugin-v2-client.js'];
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function canonicalEntities(projectDir) {
  const read = (name) => fs.existsSync(path.join(projectDir, name)) ? JSON.parse(fs.readFileSync(path.join(projectDir, name), 'utf8')) : {};
  const schema = read('source-schema.json');
  const mapping = read('mapping/mapping-plan.json');
  const rows = (value) => Array.isArray(value) ? value : Object.entries(value || {}).filter(([, row]) => row && typeof row === 'object').map(([key, row]) => ({ sourceEntityRef: key, ...row }));
  const sources = rows(schema.entities);
  const decisions = require('./website-handoff.js').readEntityMappings(mapping);
  const referenceOf = (row) => row.sourceEntityRef || row.ref || row.entity || row.sourceEntity || row.entityKey || (typeof row.source === 'string' ? row.source : null);
  const planned = new Set(decisions.filter((row) => row.targetRef && !['excluded', 'declined', 'pending', 'deferred', 'manual', 'blocked', 'unsupported'].includes(row.status))
    .map((row) => referenceOf(row)));
  const combined = new Map(sources.map((row) => [referenceOf(row), row]));
  for (const decision of decisions) {
    const key = referenceOf(decision);
    if (!key) throw new Error('mapping entity lacks identity');
    const source = combined.get(key) || {};
    combined.set(key, { ...source, ...decision, sourceMeta: { ...decision.sourceMeta, ...source.sourceMeta } });
  }
  return [...combined].filter(([key]) => key).map(([key, row]) => ({
    sourceEntityRef: key, sourceEntity: row.sourceEntity || row.entityKey || row.entity || (typeof row.source === 'string' ? row.source : key),
    sourceType: row.sourceType || null,
    sourceTypes: row.sourceTypes || null,
    bridgeDesignated: Boolean(row.bridgeDesignated || row.sourceMeta?.extractionPlan || row.fulfillment?.kind === 'structure-bridge-plugin'),
    sourceMeta: row.sourceMeta?.extractionPlan ? { extractionPlan: row.sourceMeta.extractionPlan } : {},
    sourcePrerequisites: row.sourcePrerequisites || [],
    importPlanned: planned.has(key),
  })).sort((a, b) => a.sourceEntityRef.localeCompare(b.sourceEntityRef));
}
function templates(entities) {
  const config = JSON.stringify({ version: VERSION, entities }, null, 2);
  const wiring = `'use strict';\nconst runtime = require('../lib/plugin-entity-read-plan.js');\nconst config = ${config};\nmodule.exports = { config, run: (kind, projectDir, args) => runtime.runGeneratedPluginEntrypoint({ kind, projectDir, entities: config.entities }, args) };\n`;
  const entry = (kind, directory) => `'use strict';\nconst path = require('node:path');\nconst handoff = require('${directory}plugin-handoff.js');\nhandoff.run('${kind}', path.resolve(__dirname, '../..'), process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });\n`;
  return { [FILES[0]]: wiring, [FILES[1]]: entry('import', './'), [FILES[2]]: entry('extract', '../import/') };
}
function moduleSourceDir() { return path.resolve(__dirname, '../resources/rp-source-wordpress/lib'); }
function vendorSharedDependencies(projectDir) {
  const visited = new Set();
  function copy(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const destination = noSymlinks(projectDir, `src/lib/${path.basename(file)}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    for (const match of source.matchAll(/require\(['"](.\/[^'"]+)['"]\)/g)) copy(require.resolve(path.resolve(path.dirname(file), match[1])));
  }
  copy(path.join(__dirname, 'import-recovery.js'));
  copy(path.join(__dirname, 'import-readiness-contract.js'));
}
function noSymlinks(projectDir, relativePath) {
  let cursor = path.resolve(projectDir);
  for (const token of relativePath.split('/')) {
    cursor = path.join(cursor, token);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('generated handoff symlink refused');
  }
  return cursor;
}
function validateDispatchMapping(projectDir) {
  const file = path.join(projectDir, 'mapping/mapping-plan.json');
  const mapping = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const rows = require('./website-handoff.js').readEntityMappings(mapping);
  for (const row of rows) {
    if (!row.targetRef && !['excluded', 'declined', 'pending', 'deferred', 'manual', 'blocked', 'unsupported'].includes(row.status)) {
      throw new Error('mapping targetRef is missing; normalize the declared legacy target before emitting dispatch, never drop its scope');
    }
  }
}
function emitPluginHandoff(projectDir) {
  const entities = canonicalEntities(projectDir);
  validateDispatchMapping(projectDir);
  if (!entities.some((entity) => entity.bridgeDesignated)) throw new Error('no canonical bridge entities');
  const emitted = templates(entities);
  // Inspect every destination before any mutation. Existing project entrypoints must be
  // deliberately adapted, never silently replaced by adding one bridge entity.
  for (const [name, expected] of Object.entries(emitted)) {
    const file = noSymlinks(projectDir, name);
    if (!fs.existsSync(file)) continue;
    const existing = fs.readFileSync(file, 'utf8');
    let owned = existing === expected;
    if (!owned && name === FILES[0]) {
      try {
        const match = existing.match(/const config = ([\s\S]*?);\nmodule.exports =/);
        const config = JSON.parse(match[1]);
        owned = config.version === VERSION && existing === templates(config.entities)[name];
      } catch { /* Unrecognized wiring belongs to the project. */ }
    }
    if (!owned) throw new Error(`refusing to overwrite non-template entrypoint: ${name}; preserve its ordering, self-check, heartbeat and ledger in the project adapter before deliberately replacing it`);
  }
  for (const [name, text] of Object.entries(emitted)) {
    const file = noSymlinks(projectDir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  for (const helper of HELPERS) {
    const file = noSymlinks(projectDir, `src/lib/${helper}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(moduleSourceDir(), helper), file);
  }
  vendorSharedDependencies(projectDir);
  return { version: VERSION, files: FILES };
}
function verifyPluginHandoff(projectDir, selection = {}) {
  const entities = canonicalEntities(projectDir);
  const selected = require(path.join(moduleSourceDir(), 'plugin-entity-read-plan.js')).selectPluginEntities(entities, selection);
  const byRef = new Map(entities.map((entity) => [entity.sourceEntityRef, entity]));
  const closure = new Map();
  const visit = (entity, stack = new Set()) => {
    if (stack.has(entity.sourceEntityRef)) throw new Error('cyclic source prerequisites');
    if (closure.has(entity.sourceEntityRef)) return;
    closure.set(entity.sourceEntityRef, entity);
    for (const ref of entity.sourcePrerequisites) {
      const source = byRef.get(ref);
      if (!source) throw new Error('missing canonical source prerequisite');
      visit(source, new Set([...stack, entity.sourceEntityRef]));
    }
  };
  selected.forEach((entity) => visit(entity));
  if (![...closure.values()].some((entity) => entity.bridgeDesignated)) return { applicable: false, entities: [] };
  validateDispatchMapping(projectDir);
  for (const [name, expected] of Object.entries(templates(entities))) {
    const file = noSymlinks(projectDir, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) throw new Error(`generated plugin handoff differs from committed template: ${name}`);
  }
  for (const helper of HELPERS) {
    const file = noSymlinks(projectDir, `src/lib/${helper}`);
    if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== digest(fs.readFileSync(path.join(moduleSourceDir(), helper)))) throw new Error(`changed vendored plugin helper: ${helper}`);
  }
  return { applicable: true, entities: [...closure.values()] };
}
module.exports = { VERSION, FILES, HELPERS, canonicalEntities, emitPluginHandoff, verifyPluginHandoff, templates };
