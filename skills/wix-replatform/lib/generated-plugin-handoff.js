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
  const entry = (kind, directory) => `'use strict';\nconst path = require('node:path');\nconst handoff = require('${directory}plugin-handoff.js');\nhandoff.run('${kind}', path.resolve(__dirname, '../..'), process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1; });\n`;
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
  // The entrypoint's stop handling and the wix_auth_expired exit code.
  copy(path.join(__dirname, 'import-interruption.js'));
  copy(path.join(__dirname, 'wix-auth.js'));
  // The shared task loop the plugin dispatch runs through (per-entity isolation).
  copy(path.join(__dirname, 'import-task-orchestrator.js'));
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
// The fixed WordPress extractor, vendored NESTED (src/lib, src/resources/<res>/lib, mirroring the
// toolkit) so its relative requires resolve unchanged, plus the reader catalog it loads by path.
const TOOLKIT_ROOT = path.resolve(__dirname, '..');
const CATALOG_EXTRACTOR = 'resources/rp-source-wordpress/lib/catalog-extractor.js';
const CATALOG_DATA = ['resources/rp-source-wordpress/reader-catalog.json'];
function vendorCatalogExtractor(projectDir) {
  const visited = new Set();
  const copy = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const destination = noSymlinks(projectDir, `src/${path.relative(TOOLKIT_ROOT, file).split(path.sep).join('/')}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    if (!file.endsWith('.js')) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
      let target = path.resolve(path.dirname(file), match[1]);
      if (!/\.(c?js|json|mjs)$/.test(target)) target += '.js';
      if (fs.existsSync(target) && target.startsWith(TOOLKIT_ROOT + path.sep)) copy(target);
    }
  };
  copy(path.join(TOOLKIT_ROOT, CATALOG_EXTRACTOR));
  for (const data of CATALOG_DATA) copy(path.join(TOOLKIT_ROOT, data));
  return visited.size;
}
const CATALOG_ENTRY = `'use strict';\n// Fixed extract entrypoint (generated-plugin-handoff.js emitCatalogExtract); not edited per run.\n// Readers the catalog lacks go in src/extract/reader-catalog.extra.json and src/extract/readers/.\nconst path = require('node:path');\nrequire('../resources/rp-source-wordpress/lib/catalog-extractor.js').runCli(path.resolve(__dirname, '../..'), process.argv.slice(2))\n  .then(({ code }) => { process.exitCode = code; }, (error) => { console.error(error.message); process.exitCode = 2; });\n`;
// A WordPress run's extract stage: vendor the catalog extractor and, unless the plugin handoff
// owns src/extract/run-extract.js (bridge entities; its extract path falls back to the same
// extractor), write the fixed entrypoint. A hand-written entrypoint is refused, never replaced.
function emitCatalogExtract(projectDir) {
  const vendored = vendorCatalogExtractor(projectDir);
  const file = noSymlinks(projectDir, FILES[2]);
  const handoff = templates([])[FILES[2]];
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing === handoff) return { entrypoint: 'plugin-handoff', vendored };
    if (existing !== CATALOG_ENTRY) throw new Error(`refusing to overwrite non-template entrypoint: ${FILES[2]}; WordPress readers are catalog entries now (src/extract/reader-catalog.extra.json)`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, CATALOG_ENTRY);
  return { entrypoint: 'catalog', vendored };
}
// `allowNoBridge` (the codegen scaffold): a WordPress project with no bridge entity gets the same
// entrypoints, so its importer is the toolkit's too (lib/project-adapter.js).
// The entrypoints a project gets. With no bridge entity the extract entry stays the fixed catalog
// entry (catalog-extractor runCli: --sample slice, progress args, non-zero exit on a failed read);
// only the import side runs through the handoff.
function expectedFiles(entities) {
  const out = templates(entities);
  if (!entities.some((entity) => entity.bridgeDesignated)) out[FILES[2]] = CATALOG_ENTRY;
  return out;
}
function emitPluginHandoff(projectDir, { allowNoBridge = false } = {}) {
  const entities = canonicalEntities(projectDir);
  validateDispatchMapping(projectDir);
  if (!allowNoBridge && !entities.some((entity) => entity.bridgeDesignated)) throw new Error('no canonical bridge entities');
  const emitted = expectedFiles(entities);
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
    // The fixed catalog entrypoint and the handoff extract entry are both ours.
    if (!owned && name === FILES[2] && [CATALOG_ENTRY, templates(entities)[FILES[2]]].includes(existing)) owned = true;
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
  // The handoff's extract path uses the fixed catalog extractor when the adapter defines no readers.
  if (fs.existsSync(path.join(projectDir, 'source-schema.json')) && ['wordpress', 'woocommerce'].includes(JSON.parse(fs.readFileSync(path.join(projectDir, 'source-schema.json'), 'utf8')).platform)) vendorCatalogExtractor(projectDir);
  return { version: VERSION, files: FILES };
}
// The project's src/import/plugin-handoff.js is the template wiring (any version of its config).
function ownsWiring(projectDir) {
  const file = noSymlinks(projectDir, FILES[0]);
  if (!fs.existsSync(file)) return false;
  try {
    const existing = fs.readFileSync(file, 'utf8');
    const config = JSON.parse(existing.match(/const config = ([\s\S]*?);\nmodule.exports =/)[1]);
    return existing === templates(config.entities)[FILES[0]];
  } catch { return false; }
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
  // No bridge entity selected: the handoff still applies when the project runs on it (the scaffold
  // wrote its entrypoints), and then its exact bytes are checked the same way.
  if (![...closure.values()].some((entity) => entity.bridgeDesignated) && !ownsWiring(projectDir)) return { applicable: false, entities: [] };
  validateDispatchMapping(projectDir);
  for (const [name, expected] of Object.entries(expectedFiles(entities))) {
    const file = noSymlinks(projectDir, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) throw new Error(`generated plugin handoff differs from committed template: ${name}`);
  }
  for (const helper of HELPERS) {
    const file = noSymlinks(projectDir, `src/lib/${helper}`);
    if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== digest(fs.readFileSync(path.join(moduleSourceDir(), helper)))) throw new Error(`changed vendored plugin helper: ${helper}`);
  }
  return { applicable: true, entities: [...closure.values()] };
}
module.exports = { VERSION, FILES, HELPERS, CATALOG_ENTRY, canonicalEntities, emitPluginHandoff, emitCatalogExtract, expectedFiles, vendorCatalogExtractor, verifyPluginHandoff, templates };
