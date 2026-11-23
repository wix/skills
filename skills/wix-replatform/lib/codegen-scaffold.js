'use strict';

// Design v2 (G): the codegen scaffold. When a run enters codegen, the toolkit writes the import
// handler for every entity on the fixed loop, so the AI never writes it:
//
//   src/import/handlers/import-<entity>.js  fixed: runRecordTask + buildFromPlan(plan entity)
//   src/import/hooks/<entity>.js            one empty function per plan row the toolkit can't
//                                           build (instruction rows and leftovers); the AI fills
//                                           only the code between each hook's markers
//
// and vendors the runner, the plan interpreter and the suggestion helpers the plan names into
// src/. Entities with no toolkit composite keep today's path (A5).
//
// It also writes the run's fixed startup files, so codegen never writes them:
//
//   src/project/plugin-runtime.js           WordPress: the project adapter, lib/project-adapter.js;
//                                           src/project/overrides.js is its override slot
//   src/import/plugin-handoff.js, run-import.js, src/extract/run-extract.js
//                                           WordPress: the plugin handoff entrypoints
//                                           (generated-plugin-handoff.js); with no bridge
//                                           entity run-extract.js stays the catalog entry
//   src/setup/run-setup.js                  the setup entrypoint (execute-setup.js runCli)
//   src/import/handlers/import-<entity>.js  an entity the plan marks not in use: the empty,
//                                           journaled task (a record there is refused)
//
// verifyScaffold compares the files with the scaffold outside the hook bodies. The first change
// is a codegen finding (one fix attempt). A change still there on the next check is replaced by
// the toolkit's version, keeping the hook bodies, and stays listed as a finding, so it reaches
// the completion report as a cutover task. Changed fixed code never runs.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCAFFOLD_VERSION = 4;
// The handler's path to the vendored runtime (src/lib), from src/import/handlers/.
const VENDORED_LIB = '../../lib';
const SKILL_ROOT = path.resolve(__dirname, '..');
const RECORD_PATH = 'execution/codegen-scaffold.json';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const writeJson = (file, value) => writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);

// --- which entities ---------------------------------------------------------------------------

// Targets the fixed loop writes with toolkit code: a composite (products, contacts, orders,
// coupons, posts, reviews, tax rates) or a fixed send (lib/record-sends.js: categories, tags,
// brands, media, tax groups, shipping zones).
function compositeRefs() {
  return [...Object.keys(require('./import-task-runner.js').COMPOSITES), ...Object.keys(require('./record-sends.js').SENDS)];
}
function sourcePlatform(projectDir, plan) {
  const schema = readJson(path.join(projectDir, 'source-schema.json'));
  return (schema && schema.platform) || (plan && (plan.sourcePlatform || plan.sourceSystem)) || null;
}
// Entities on the fixed loop: a toolkit composite or a fixed send writes their records.
// A toolkit-derived guest entity (TOOLKIT_DERIVED_ENTITIES) an agent added as a plan row gets no
// handler of its own while another contact entity is scaffolded: the manifest generator binds it on
// that contact task, so its own task would only conflict (codegen_scaffold_task_id).
function newPathEntities(plan) {
  const refs = new Set(compositeRefs());
  const { TOOLKIT_DERIVED_ENTITIES } = require('./mapping-field-contract.js');
  const all = (plan && Array.isArray(plan.entities) ? plan.entities : [])
    .filter((e) => e && typeof e.sourceEntity === 'string' && refs.has(e.targetRef) && Array.isArray(e.fieldMappings) && e.fieldMappings.length && e.inUse !== false);
  const derived = (e) => TOOLKIT_DERIVED_ENTITIES.includes(e.sourceEntity);
  const hosted = all.some((e) => !derived(e) && e.targetRef === 'crm/contact');
  return hosted ? all.filter((e) => !derived(e)) : all;
}
const taskIdFor = (sourceEntity) => `import-${sourceEntity}`;
const safeName = (sourceEntity) => {
  // Plugin entities are dotted (plugin.<plugin>.<entity>); `..` never reaches a path.
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(sourceEntity) || sourceEntity.includes('..')) throw new Error(`codegen scaffold: unsupported source entity name ${JSON.stringify(sourceEntity)}`);
  return sourceEntity;
};

// The child extracts the suggestion joins before build (WooCommerce variations). The suggestion
// is the one the entity was pre-filled from (`prefill.suggestion`), else the one for its name.
function childExtractsFor(platform, entity) {
  let suggestion = null;
  try {
    const all = require('./plan-prefill.js').loadSuggestions(platform || entity.sourceSystem);
    const file = entity.prefill && entity.prefill.suggestion;
    suggestion = (file && [...all.values()].find((s) => s.file === file)) || all.get(entity.sourceEntity) || null;
  } catch { suggestion = null; }
  const children = (suggestion && suggestion.doc.sourceShape && suggestion.doc.sourceShape.children) || {};
  return Object.entries(children)
    .filter(([, child]) => child && typeof child === 'object' && child.extract && child.parentKey)
    .map(([as, child]) => ({ sourceEntity: child.extract, parentField: child.parentKey, as }));
}

// --- rendering --------------------------------------------------------------------------------

const comment = (text) => String(text === undefined || text === null ? '' : text).replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim().slice(0, 400);
const START = (id) => `    // >>> hook:${id}`;
const END = (id) => `    // <<< hook:${id}`;
const STUB = (id) => `    throw Object.assign(new Error(${JSON.stringify(`hook ${id} is not filled`)}), { code: 'HOOK_NOT_FILLED' });`;

function renderHandler({ sourceEntity, targetRef, childExtracts }) {
  return `'use strict';
// Toolkit-generated import handler (codegen scaffold v${SCAFFOLD_VERSION}) for ${sourceEntity} -> ${targetRef}.
// Do not edit this file. The toolkit builds every plan row (lib/plan-builder.js) and runs the
// fixed loop (lib/import-task-runner.js runRecordTask): lookups, waits, gates, journal, retries.
// To change a value, change the plan row; for an instruction or leftover row, fill its hook in
// ../hooks/${sourceEntity}.js. import-contract-verify reports any change here, and a change still
// there on the next check is replaced by this version.
const fs = require('node:fs');
const path = require('node:path');
const { runRecordTask } = require('${VENDORED_LIB}/import-task-runner.js');
const { buildFromPlan } = require('${VENDORED_LIB}/plan-builder.js');
const { sendFor } = require('${VENDORED_LIB}/record-sends.js');
const { HOOKS } = require('../hooks/${sourceEntity}.js');

const SOURCE_ENTITY = ${JSON.stringify(sourceEntity)};
const TARGET_REF = ${JSON.stringify(targetRef)};
const CHILD_EXTRACTS = ${JSON.stringify(childExtracts)};
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, relative), 'utf8'));

function entityPlan(plan) {
  const entity = (plan.entities || []).find((row) => row.sourceEntity === SOURCE_ENTITY);
  if (!entity) throw Object.assign(new Error(\`the mapping plan has no entity \${SOURCE_ENTITY}\`), { code: 'PLAN_ENTITY_MISSING' });
  return entity;
}
// The entity's recorded choices as { name: value } (operator and AI values over the suggestion
// defaults) for the builder helpers and the hooks. buildFromPlan adds the rows' own choices.
function choicesOf(entity) {
  const named = (c) => (c && typeof c.name === 'string' && Object.hasOwn(c, 'value') ? [[c.name, c.value]] : []);
  return Object.fromEntries((Array.isArray(entity.choices) ? entity.choices : []).flatMap(named));
}
function buildFor(plan, options = {}) {
  const entity = entityPlan(plan);
  return buildFromPlan(entity, { hooks: HOOKS, ...options, choices: { ...choicesOf(entity), ...(options.choices || {}) } });
}
function sourceSiteHost() {
  try { return new URL(readJson('source-schema.json').sourceUrl).host || null; } catch { return null; }
}
// A child extract (WooCommerce variations) comes from the task's own binding for it, else it sits
// beside the parent's extract. No source path is written into this file.
function childExtractPath(task, binding, childEntity) {
  const own = (task.sourceBindings || []).find((row) => row.sourceEntity === childEntity && row.extractPath);
  return own ? own.extractPath : path.posix.join(path.posix.dirname(binding.extractPath), \`\${childEntity}.ndjson\`);
}
function readRecords(extractPath) {
  return fs.readFileSync(path.join(PROJECT_DIR, extractPath), 'utf8').split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function run(ctx) {
  const plan = ctx.mappingPlan || readJson('mapping/mapping-plan.json');
  const entity = entityPlan(plan);
  const binding = (ctx.task.sourceBindings || []).find((row) => row.sourceEntity === SOURCE_ENTITY && row.role !== 'source-archive');
  if (!binding) throw Object.assign(new Error(\`task \${ctx.taskId} has no source binding for \${SOURCE_ENTITY}\`), { code: 'SOURCE_BINDING_MISSING' });
  const records = readRecords(binding.extractPath);
  const selection = typeof ctx.selectRecords === 'function' ? await ctx.selectRecords(ctx, records, binding) : { mode: 'full', filter: () => true };
  // The toolkit's fixed writer call for a target with no composite (null: the composite sends).
  const fixed = sendFor(TARGET_REF);
  const result = await runRecordTask({
    taskBinding: ctx.taskBinding, wix: ctx.wix, sourceEntity: SOURCE_ENTITY, records, sourceSystem: entity.sourceSystem,
    build: buildFor(plan), stopRequested: ctx.stopRequested, selectionMode: selection.mode, recordFilter: selection.filter,
    childExtracts: CHILD_EXTRACTS.map((child) => ({ extractPath: childExtractPath(ctx.task, binding, child.sourceEntity), parentField: child.parentField, as: child.as })),
    sourceSiteHost: ctx.sourceSiteHost || sourceSiteHost(),
    ...(fixed ? { send: fixed.send, reconcile: fixed.reconcile } : {}),
  });
  return fixed && fixed.after ? fixed.after(ctx, result, { projectDir: PROJECT_DIR, sourceSystem: entity.sourceSystem }) : result;
}

module.exports = { run, buildFor, choicesOf, SOURCE_ENTITY, SCAFFOLD_VERSION: ${SCAFFOLD_VERSION} };
`;
}

function hookDescription(row, reason) {
  const t = row.transform || {};
  const instruction = t.kind === 'instruction' ? (t.instruction || t.text || (t.arguments && t.arguments.instruction) || row.instruction || '') : '';
  const targets = (row.outputs || []).map((o) => o.targetPath).filter(Boolean);
  return [
    `Row ${row.id} (${reason})${instruction ? `: ${comment(instruction)}` : ''}`,
    `Source: ${comment((row.sourcePaths || []).join(', ') || '-')} -> target: ${comment(targets.join(', ') || '-')}`,
    ...(row.reason ? [`Why: ${comment(row.reason)}`] : []),
  ];
}

function renderHooks({ sourceEntity, hooks }, bodies = {}) {
  // Each hook's description (plan prose) goes in the header comment, which the readiness contract
  // reads as prose, not code.
  const about = hooks.flatMap(({ description }) => description.map((line) => `// ${line}`));
  const entries = hooks.map(({ id }) => [
    `  ${JSON.stringify(id)}: async (record, { row, lookups, choices, outputs, body }) => {`,
    START(id),
    bodies[id] !== undefined ? bodies[id] : STUB(id),
    END(id),
    '  },',
  ].join('\n'));
  return `'use strict';
// Hooks for ${sourceEntity} (codegen scaffold v${SCAFFOLD_VERSION}). The toolkit builds every other plan
// row. Fill ONLY the code between each hook's >>> and <<< markers; the rest of this file is fixed.
// A hook gets (record, { row, lookups, choices, outputs, body }) and returns the value of its one
// output, { values: { <targetPath>: value } }, { record: <partial Wix body> } or { hold: { code } }.
// Take every target id from lookups.ref(ref, sourceStableKey, path). No writes, retries or catches.
${about.length ? `//\n${about.join('\n')}\n` : ''}// eslint-disable-next-line no-unused-vars
const HOOKS = {
${entries.join('\n')}
};

module.exports = { HOOKS };
`;
}

// The hook bodies in a hooks file, by id; a hook with broken markers has no body here.
function hookBodies(text, ids) {
  const bodies = {};
  for (const id of ids) {
    const start = text.indexOf(`${START(id)}\n`);
    const end = text.indexOf(`\n${END(id)}`, start);
    if (start >= 0 && end > start) bodies[id] = text.slice(start + START(id).length + 1, end);
  }
  return bodies;
}
// A hooks file with every hook body blanked: equal to the scaffold's exactly when only bodies changed.
function frameOf(text, ids) {
  let out = text;
  for (const id of ids) {
    const start = out.indexOf(`${START(id)}\n`);
    const end = out.indexOf(`\n${END(id)}`, start);
    if (start >= 0 && end > start) out = out.slice(0, start + START(id).length + 1) + out.slice(end);
  }
  return out;
}

// --- fixed startup files -------------------------------------------------------------------------

const OVERRIDES_PATH = 'src/project/overrides.js';
const ADAPTER_PATH = 'src/project/plugin-runtime.js';
const SETUP_PATH = 'src/setup/run-setup.js';

function renderAdapter() {
  return `'use strict';
// Toolkit-generated project adapter (codegen scaffold v${SCAFFOLD_VERSION}). Do not edit this file. The
// plugin handoff (src/import/plugin-handoff.js) calls it; lib/project-adapter.js reads the execution
// manifest and the mapping plan when the import runs (task order, selection, ledger, review,
// dispatch to src/import/handlers/<taskId>.js, the completion report).
// To change one step for this run, export it from ./overrides.js as
// (args..., toolkitDefault) => result, with why: { <step>: '<reason>' }. Every override is
// recorded as a toolkit gap in the completion report (never a cutover task).
const fs = require('node:fs');
const path = require('node:path');

const OVERRIDES = path.join(__dirname, 'overrides.js');
module.exports = require('../lib/project-adapter.js').createProjectAdapter({
  projectDir: path.resolve(__dirname, '..', '..'),
  overrides: fs.existsSync(OVERRIDES) ? require(OVERRIDES) : {},
});
`;
}

function renderSetup() {
  return `'use strict';
// Toolkit-generated setup entrypoint (codegen scaffold v${SCAFFOLD_VERSION}). Do not edit this file. It runs
// setup/setup-plan.json through the toolkit's setup runtime.
// Usage: node src/setup/run-setup.js [--dry-run]
const path = require('node:path');

require('../resources/rp-execute-setup/scripts/execute-setup.js').runCli(path.resolve(__dirname, '..', '..'), process.argv.slice(2));
`;
}

function renderNotInUse({ sourceEntity, targetRef }) {
  return `'use strict';
// Toolkit-generated import handler (codegen scaffold v${SCAFFOLD_VERSION}) for ${sourceEntity} -> ${targetRef || '-'}.
// Do not edit this file. The plan marks this entity not in use, so nothing is sent. The task still
// runs (runRecordTask) so its pass is finished and journaled; a record here means the plan is
// stale, and build refuses it.
const fs = require('node:fs');
const path = require('node:path');
const { runRecordTask } = require('${VENDORED_LIB}/import-task-runner.js');

const SOURCE_ENTITY = ${JSON.stringify(sourceEntity)};
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');
const notInUse = () => { throw Object.assign(new Error(\`\${SOURCE_ENTITY} is not in use in the mapping plan; re-plan it before importing its records\`), { code: 'PLAN_ENTITY_NOT_IN_USE' }); };

async function run(ctx) {
  const plan = ctx.mappingPlan || JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'mapping/mapping-plan.json'), 'utf8'));
  const entity = (plan.entities || []).find((row) => row.sourceEntity === SOURCE_ENTITY) || {};
  const binding = (ctx.task.sourceBindings || []).find((row) => row.sourceEntity === SOURCE_ENTITY && row.role !== 'source-archive');
  if (!binding) throw Object.assign(new Error(\`task \${ctx.taskId} has no source binding for \${SOURCE_ENTITY}\`), { code: 'SOURCE_BINDING_MISSING' });
  const file = path.join(PROJECT_DIR, binding.extractPath);
  const records = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\\r?\\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  const selection = typeof ctx.selectRecords === 'function' ? await ctx.selectRecords(ctx, records, binding) : { mode: 'full', filter: () => true };
  return runRecordTask({
    taskBinding: ctx.taskBinding, wix: ctx.wix, sourceEntity: SOURCE_ENTITY, records, sourceSystem: entity.sourceSystem || plan.sourceSystem,
    build: notInUse, send: notInUse, stopRequested: ctx.stopRequested, selectionMode: selection.mode, recordFilter: selection.filter,
  });
}

module.exports = { run, SOURCE_ENTITY, SCAFFOLD_VERSION: ${SCAFFOLD_VERSION} };
`;
}

// --- source archive ---------------------------------------------------------------------------

// The source archive (resources/rp-target-wix/lib/source-archive.js planSourceArchive) is fully
// planned by the toolkit, so its task is toolkit code too: one fixed handler, and one manifest task
// the toolkit adds when codegen's manifest has none (addSourceArchiveTask).
const ARCHIVE_ENTITY = 'source-archive';
const ARCHIVE_TASK_ID = 'import-source-archive';
const ARCHIVE_BINDING = Object.freeze({ ref: 'cms/data-item', role: 'source-archive', sourceEntity: ARCHIVE_ENTITY, keyField: 'itemKey', keyPrefix: 'archive:',
  manifestPath: 'data/source-extract/source-archive.manifest.json', extractPath: 'data/source-extract/source-archive.ndjson' });
// The plan archives something: a resolved row with a `cms` field decision (planSourceArchive's rule).
function plansSourceArchive(plan) {
  const resolved = Array.isArray(plan && plan.executionScope && plan.executionScope.resolvedEntityRefs) ? new Set(plan.executionScope.resolvedEntityRefs) : null;
  const rows = plan && (plan.entityMappings || plan.entities);
  return (Array.isArray(rows) ? rows : []).some((row) => row && (row.fieldMappings || []).some((d) => d && d.disposition === 'cms')
    && (!resolved || resolved.has(row.sourceEntityRef || row.sourceEntity) || resolved.has(row.sourceEntity)));
}
function renderSourceArchive() {
  return `'use strict';
// Toolkit-generated source-archive task (codegen scaffold v${SCAFFOLD_VERSION}). Do not edit this file. The
// toolkit plans every archive item (lib/source-archive-task.js, planSourceArchive) and sends one
// CMS item per planned item through the fixed loop, after the entity tasks.
const path = require('node:path');
const archiveTask = require('${VENDORED_LIB}/source-archive-task.js');

const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');

module.exports = { run: (ctx) => archiveTask.run(ctx, { projectDir: PROJECT_DIR }), SOURCE_ENTITY: archiveTask.SOURCE_ENTITY, SCAFFOLD_VERSION: ${SCAFFOLD_VERSION} };
`;
}
// The manifest's archive task, added by the toolkit when the plan archives something and no task
// binds the archive yet (codegen's own archive task is kept). Its edges and dependsOn come from the
// shared resolver codegen uses (dependency-readiness deriveDependencyEdges: the CMS collection setup
// step); the import runs archive tasks after every other task (project-adapter entityOrder), since
// the archive reads their target ids. Returns true when the manifest changed.
async function addSourceArchiveTask(projectDir, { plan = readJson(path.join(projectDir, 'mapping', 'mapping-plan.json')) } = {}) {
  const file = path.join(projectDir, 'execution', 'execution-manifest.json');
  const manifest = readJson(file);
  const record = readJson(path.join(projectDir, RECORD_PATH));
  if (!manifest || !Array.isArray(manifest.tasks) || !plansSourceArchive(plan)) return false;
  if (!((record && record.files) || []).some((row) => row.kind === 'source-archive' && !row.existing)) return false;
  if (manifest.tasks.some((task) => task && (task.sourceBindings || []).some((b) => b && (b.role === 'source-archive' || b.sourceEntity === ARCHIVE_ENTITY)))) return false;
  const task = { id: ARCHIVE_TASK_ID, kind: 'import', entityRefs: ['cms/data-item'], dependsOn: [], artifactRefs: [], dependencyEdges: [], dependencyRefs: [],
    verificationKind: 'none', sourceBindings: [{ ...ARCHIVE_BINDING }] };
  manifest.tasks.push(task);
  const derived = await require('./dependency-readiness.js').deriveDependencyEdges(projectDir, manifest).catch(() => null);
  const own = derived && derived.tasks && derived.tasks[ARCHIVE_TASK_ID];
  if (own) Object.assign(task, { dependencyRefs: own.dependencyRefs, dependencyEdges: own.dependencyEdges, dependsOn: own.dependsOn });
  writeJson(file, manifest);
  return true;
}

const RENDER = { adapter: renderAdapter, setup: renderSetup, 'not-in-use': renderNotInUse, 'source-archive': renderSourceArchive };
const isWordPress = (platform) => ['wordpress', 'woocommerce'].includes(platform);

// The fixed files this project gets: the adapter (WordPress), the setup entrypoint, and one empty
// task per not-in-use plan entity.
function fixedFileSpecs(projectDir, plan) {
  const out = [];
  if (isWordPress(sourcePlatform(projectDir, plan))) out.push({ path: ADAPTER_PATH, kind: 'adapter' });
  out.push({ path: SETUP_PATH, kind: 'setup' });
  for (const entity of (plan && Array.isArray(plan.entities) ? plan.entities : [])) {
    if (!entity || entity.inUse !== false || typeof entity.sourceEntity !== 'string') continue;
    out.push({ path: `src/import/handlers/${taskIdFor(safeName(entity.sourceEntity))}.js`, kind: 'not-in-use', sourceEntity: entity.sourceEntity, targetRef: entity.targetRef || null, taskId: taskIdFor(entity.sourceEntity) });
  }
  if (plansSourceArchive(plan)) out.push({ path: `src/import/handlers/${ARCHIVE_TASK_ID}.js`, kind: 'source-archive', taskId: ARCHIVE_TASK_ID });
  return out;
}
const renderFixed = (spec) => RENDER[spec.kind](spec);

// Writes each fixed file. A file the toolkit did not write (codegen's or an older run's) is left
// alone and listed (`existing`). A fixed file the run patched and listed in
// execution/toolkit-patches.md is kept too (`patched`), like a listed vendored copy, and recorded
// as a toolkit gap; verify and restore skip both.
function writeFixedFiles(projectDir, plan, previous) {
  const prior = new Map(((previous && previous.files) || []).map((row) => [row.path, row]));
  const patches = new Map(require('./toolkit-integrity.js').readPatchList(projectDir).map((item) => [item.path, item]));
  const listed = new Set(patches.keys());
  const rows = fixedFileSpecs(projectDir, plan).map((spec) => {
    const text = renderFixed(spec);
    const file = path.join(projectDir, spec.path);
    const known = prior.get(spec.path);
    const changed = fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text;
    if (changed && !known) return { ...spec, existing: true };
    if (changed && listed.has(spec.path)) return { ...spec, patched: true };
    if (!fs.existsSync(file) || changed) writeFileAtomic(file, text);
    return { ...spec, sha256: sha(text), check: known && known.check ? known.check : { failures: 0, restored: false } };
  });
  // A kept patch is a toolkit gap (never an operator task); toolkit-integrity skips these paths.
  require('./toolkit-gaps.js').recordToolkitGaps(projectDir, 'codegen-scaffold-patched', rows.filter((row) => row.patched)
    .map((row) => ({ kind: 'patch', step: `${row.kind} file`, file: row.path, why: patches.get(row.path).reason })));
  return rows;
}

// WordPress: the plugin handoff entrypoints. A hand-written entrypoint is refused by the emitter
// and kept (that project keeps its own).
function writeHandoff(projectDir, plan) {
  if (!isWordPress(sourcePlatform(projectDir, plan)) || !fs.existsSync(path.join(projectDir, 'source-schema.json'))) return null;
  try { return { ok: true, ...require('./generated-plugin-handoff.js').emitPluginHandoff(projectDir, { allowNoBridge: true }) }; } catch (error) { return { ok: false, error: String((error && error.message) || error) }; }
}

// --- vendoring --------------------------------------------------------------------------------

function resolveModule(base) {
  return ['', '.js', '.cjs', '.json', '/index.js'].map((ext) => base + ext).find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}
// The toolkit files `entries` need, following literal relative requires inside the skill.
function closure(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (!/\.(c?js)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) {
      const found = resolveModule(path.resolve(path.dirname(file), match[2]));
      if (found && found.startsWith(`${SKILL_ROOT}${path.sep}`)) stack.push(found);
    }
    // Data a module reads by its own path (`path.join(__dirname, 'registry.json')`).
    for (const match of text.matchAll(/\bpath\.(?:join|resolve)\(\s*__dirname\s*,((?:\s*(['"])[^'"]+\2\s*,?)+)\s*\)/g)) {
      const parts = [...match[1].matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]);
      const found = path.resolve(path.dirname(file), ...parts);
      if (found.startsWith(`${SKILL_ROOT}${path.sep}`) && fs.existsSync(found) && fs.statSync(found).isFile()) stack.push(found);
    }
  }
  return [...seen].sort();
}
// Suggestion helpers a plan row names as `<resources path>#<export>` (transform, builder, a nested
// base or argument), for every plan entity: plan-builder requires them from <lib>/../resources, and
// a handler for any entity (scaffolded or not) builds through it.
function helperModules(entities) {
  const out = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      const match = /^([\w./-]+\.c?js)#\w+$/.exec(value);
      const found = match && resolveModule(path.resolve(SKILL_ROOT, 'resources', match[1]));
      if (found && found.startsWith(`${SKILL_ROOT}${path.sep}`)) out.add(found);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const entity of entities) visit(entity && entity.fieldMappings);
  return [...out];
}
// The target knowledge the runner and the readiness gate read by path (entity refs, references).
function knowledgeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file); else if (entry.name.endsWith('.json')) out.push(file);
    }
  };
  walk(path.join(SKILL_ROOT, 'resources', 'rp-target-wix', 'domains'));
  // The source archive's per-source drop rules (source-archive.js finds them by a computed path):
  // without them the vendored archive keeps what the plan drops and grows past expectedRows.
  for (const entry of fs.readdirSync(path.join(SKILL_ROOT, 'resources'), { withFileTypes: true })) {
    const file = path.join(SKILL_ROOT, 'resources', entry.name, 'archive-fields.v1.json');
    if (entry.isDirectory() && fs.existsSync(file)) out.push(file);
  }
  // Every source's sub-part registry: the vendored census (lib/discovered-census.js) reads
  // ../resources/rp-source-<platform>/sub-parts.json, and a missing one leaves the census stale.
  for (const dir of fs.readdirSync(path.join(SKILL_ROOT, 'resources'))) {
    const file = path.join(SKILL_ROOT, 'resources', dir, 'sub-parts.json');
    if (dir.startsWith('rp-source-') && fs.existsSync(file)) out.push(file);
  }
  return out;
}
// A vendored copy the run patched and listed in execution/toolkit-patches.md is kept while the
// toolkit file it was copied from is unchanged (`vendoredFrom`, the toolkit hash at the last copy).
// When the toolkit file changed since, the new toolkit file is copied in, the patched copy is
// saved under execution/codegen-scaffold-replaced/, and a notice says so: an old patch never runs
// over newer toolkit code, and a fix is never dropped silently. The notice repeats on every
// round (`pendingPatches` in the record) while the path is still listed, its saved copy exists and
// the patch is not re-applied: the runner and the route script both prepare the stage, and the
// agent must see it on the call it reads.
function vendor(projectDir, entities, { vendoredFrom: previousFrom = {}, pendingPatches: previousPending = {} } = {}) {
  const entries = ['lib/import-task-runner.js', 'lib/plan-builder.js', 'lib/record-sends.js', 'lib/project-adapter.js', 'resources/rp-execute-setup/scripts/execute-setup.js', 'lib/source-archive-task.js'].map((file) => path.join(SKILL_ROOT, file));
  const files = [...new Set([...closure([...entries, ...helperModules(entities)]), ...knowledgeFiles()])];
  const listed = new Set(require('./toolkit-integrity.js').readPatchList(projectDir).map((item) => item.path));
  const vendoredFrom = {};
  const keptPatches = [];
  const replacedPatches = [];
  const pendingPatches = {};
  let written = 0;
  for (const file of files) {
    const rel = `src/${path.relative(SKILL_ROOT, file).split(path.sep).join('/')}`;
    const target = path.join(projectDir, rel);
    const text = fs.readFileSync(file);
    const toolkitSha = sha(text);
    vendoredFrom[rel] = toolkitSha;
    const exists = fs.existsSync(target);
    if (exists && fs.readFileSync(target).equals(text)) {
      const copy = previousPending[rel];
      if (copy && listed.has(rel) && fs.existsSync(path.join(projectDir, copy))) pendingPatches[rel] = copy;
      continue;
    }
    if (exists && listed.has(rel)) {
      const base = previousFrom[rel];
      if (!base || base === toolkitSha) { keptPatches.push(rel); continue; }
      const copy = `execution/codegen-scaffold-replaced/${path.basename(rel)}.${Date.now()}.txt`;
      writeFileAtomic(path.join(projectDir, copy), fs.readFileSync(target));
      replacedPatches.push({ path: rel, copy });
      pendingPatches[rel] = copy;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    written += 1;
  }
  const notices = Object.entries(pendingPatches).map(([rel, copy]) => `toolkit file changed under a listed patch: ${rel} now holds the new toolkit version; the patched copy is saved at ${copy}. Re-check the patch against the new file: re-apply it if still needed, or remove its entry from execution/toolkit-patches.md.`);
  return { files: files.length, written, keptPatches, replacedPatches, notices, vendoredFrom, pendingPatches };
}

// A hooks file the toolkit replaces while some hook's markers are broken would lose that body. The
// file is copied first (execution/codegen-scaffold-replaced/), and the ids are reported.
function keepReplaced(projectDir, relative, text, ids) {
  const lost = ids.filter((id) => text.includes(`hook:${id}`) && hookBodies(text, [id])[id] === undefined);
  if (!lost.length) return { lost, copy: null };
  const copy = `execution/codegen-scaffold-replaced/${path.basename(relative)}.${Date.now()}.txt`;
  writeFileAtomic(path.join(projectDir, copy), text);
  return { lost, copy };
}

// --- write ------------------------------------------------------------------------------------

function entitySpec(projectDir, plan, entity) {
  const { planBuilderCoverage } = require('./plan-builder.js');
  const sourceEntity = safeName(entity.sourceEntity);
  const coverage = planBuilderCoverage(entity);
  const byId = new Map((entity.fieldMappings || []).map((row) => [row.id, row]));
  const hooks = coverage.missing.map(({ id, reason }) => ({ id, reason, prefilled: Boolean(byId.get(id) && byId.get(id).prefilled), description: hookDescription(byId.get(id) || { id }, reason) }));
  return {
    sourceEntity,
    targetRef: entity.targetRef,
    taskId: taskIdFor(sourceEntity),
    childExtracts: childExtractsFor(sourcePlatform(projectDir, plan), entity),
    hooks,
    interpretedRows: coverage.interpreted.length,
    handlerPath: `src/import/handlers/${taskIdFor(sourceEntity)}.js`,
    hooksPath: `src/import/hooks/${sourceEntity}.js`,
  };
}

// Writes (or refreshes) the scaffold for every new-path entity. Hook bodies already written are
// kept when the plan still has the row. A handler the toolkit did not write is left alone and
// listed (`existingHandler`): that entity keeps today's path.
function writeScaffold(projectDir, { plan = readJson(path.join(projectDir, 'mapping', 'mapping-plan.json')) } = {}) {
  if (!plan) return { ok: false, reason: 'missing_mapping_plan', entities: [] };
  const entities = newPathEntities(plan);
  const previous = readJson(path.join(projectDir, RECORD_PATH));
  const prior = new Map(((previous && previous.entities) || []).map((row) => [row.sourceEntity, row]));
  const out = [];
  for (const entity of entities) {
    const spec = entitySpec(projectDir, plan, entity);
    const handlerFile = path.join(projectDir, spec.handlerPath);
    const hooksFile = path.join(projectDir, spec.hooksPath);
    const handler = renderHandler(spec);
    const known = prior.get(spec.sourceEntity);
    // Released by codegen (releaseScaffold): its own handler stays, and every verify lists it.
    if (known && known.released) { out.push(known); continue; }
    if (fs.existsSync(handlerFile) && !known && fs.readFileSync(handlerFile, 'utf8') !== handler) {
      out.push({ sourceEntity: spec.sourceEntity, taskId: spec.taskId, existingHandler: spec.handlerPath });
      continue;
    }
    const oldText = fs.existsSync(hooksFile) ? fs.readFileSync(hooksFile, 'utf8') : '';
    const bodies = hookBodies(oldText, [...new Set([...(known ? known.hooks.map((h) => h.id) : []), ...spec.hooks.map((h) => h.id)])]);
    const hooksText = renderHooks(spec, bodies);
    if (!fs.existsSync(handlerFile) || fs.readFileSync(handlerFile, 'utf8') !== handler) writeFileAtomic(handlerFile, handler);
    // A hook whose markers are broken would lose its body: the file is left as written, the hooks
    // are listed (brokenHooks), and verifyScaffold reports the file as changed.
    const brokenHooks = (known ? known.hooks.map((h) => h.id) : []).filter((id) => oldText.includes(`hook:${id}`) && bodies[id] === undefined);
    if (!brokenHooks.length && oldText !== hooksText) writeFileAtomic(hooksFile, hooksText);
    const ids = spec.hooks.map((h) => h.id);
    out.push({
      sourceEntity: spec.sourceEntity, targetRef: spec.targetRef, taskId: spec.taskId,
      handlerPath: spec.handlerPath, hooksPath: spec.hooksPath, childExtracts: spec.childExtracts,
      interpretedRows: spec.interpretedRows,
      hooks: spec.hooks.map(({ id, reason, prefilled, description }) => ({ id, reason, prefilled, description })),
      handlerSha256: sha(handler), hooksFrameSha256: sha(frameOf(hooksText, ids)),
      filled: ids.filter((id) => bodies[id] !== undefined && bodies[id] !== STUB(id)),
      ...(brokenHooks.length ? { brokenHooks } : {}),
      check: known && known.check ? known.check : { failures: 0, restored: false },
    });
  }
  const { vendoredFrom, pendingPatches, notices, ...vendored } = vendor(projectDir, plan.entities || [], previous || {});
  const handoff = writeHandoff(projectDir, plan);
  const files = writeFixedFiles(projectDir, plan, previous);
  const record = { schemaVersion: 1, scaffoldVersion: SCAFFOLD_VERSION, entities: out, files, vendoredFrom, ...(Object.keys(pendingPatches).length ? { pendingPatches } : {}), ...(handoff ? { handoff } : {}) };
  writeJson(path.join(projectDir, RECORD_PATH), record);
  writeReadBackBuilders(projectDir);
  return { ok: true, record: RECORD_PATH, vendored, notices, entities: out, files, ...(handoff ? { handoff } : {}) };
}

// --- read-back builders ------------------------------------------------------------------------

// The read-back check (lib/read-back-validate.js ensureReadBack) measures each gated plan row with
// the same pure body the import loop's read-back gate expects: the scaffold's build with the
// read-back lookups (import-task-runner pureBuild, readBackLookups). One builder per scaffolded entity the gate checks. The
// handler and hooks digests are part of the file, so a filled hook makes the inventory stale.
const READ_BACK_DIR = 'src/import/read-back';
function renderReadBackBuilder({ sourceEntity, targetRef, handlerPath, inputs }) {
  return `'use strict';
// Toolkit-generated read-back builder (codegen scaffold v${SCAFFOLD_VERSION}) for ${sourceEntity} -> ${targetRef}.
// Do not edit this file. The pure record -> request body the read-back gate compares (the plan build
// with the read-back lookups), for the read-back inventory. The toolkit rewrites it when its inputs change.
// Inputs: ${inputs}
const fs = require('node:fs');
const path = require('node:path');
const { buildFor } = require('../handlers/${path.posix.basename(handlerPath)}');
const { pureBuild } = require('${VENDORED_LIB}/import-task-runner.js');

const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');
const context = { projectDir: PROJECT_DIR, targetRef: '${targetRef}' };
let build = null;
async function buildWrite(record) {
  build = build || buildFor(JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'mapping/mapping-plan.json'), 'utf8')));
  return pureBuild(build, record, context);
}

module.exports = { buildWrite };
`;
}
// Writes the builder of every scaffolded entity whose target the read-back gate checks; returns
// { <sourceEntity>: builderPath }. A released entity has no toolkit builder.
function writeReadBackBuilders(projectDir) {
  const record = readJson(path.join(projectDir, RECORD_PATH));
  const gated = new Set(Object.keys(require('./import-task-runner.js').GATED_ENTITIES));
  const out = {};
  for (const row of (record && record.entities) || []) {
    if (!row.handlerPath || row.released || !gated.has(row.targetRef)) continue;
    const text = (relative) => { try { return fs.readFileSync(path.join(projectDir, relative), 'utf8'); } catch { return ''; } };
    const inputs = `handler ${sha(text(row.handlerPath)).slice(0, 16)}, hooks ${sha(text(row.hooksPath)).slice(0, 16)}`;
    const builderPath = `${READ_BACK_DIR}/build-${safeName(row.sourceEntity)}.js`;
    const builder = renderReadBackBuilder({ ...row, inputs });
    const file = path.join(projectDir, builderPath);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== builder) writeFileAtomic(file, builder);
    out[row.sourceEntity] = builderPath;
  }
  return out;
}

// --- verify -----------------------------------------------------------------------------------

function finding(code, file, message) {
  return { code, file, line: 1, call: 'scaffold', message: `${file}: ${message}` };
}

// Findings (import-contract-verify codegenFindings shape) for scaffold files changed outside the
// hook bodies, and for an execution manifest whose task for a scaffolded entity has another id.
// The first change is reported; a change still there on the next check is replaced by the
// toolkit's version (hook bodies kept), reported as restored, and stays reported for the run.
function verifyScaffold(projectDir, { repair = true } = {}) {
  const recordFile = path.join(projectDir, RECORD_PATH);
  const record = readJson(recordFile);
  if (!record || !Array.isArray(record.entities)) return [];
  const plan = readJson(path.join(projectDir, 'mapping', 'mapping-plan.json'));
  const manifest = readJson(path.join(projectDir, 'execution', 'execution-manifest.json'));
  const findings = [];
  let changedRecord = false;
  for (const row of record.entities) {
    if (!row.handlerPath) continue;
    if (row.released) {
      findings.push(finding('codegen_scaffold_released', row.handlerPath, `the toolkit's scaffold for ${row.sourceEntity} was replaced by generated code (released by codegen: ${row.released.reason}). That code is not the toolkit's tested loop; the reason is a toolkit gap to fix.`));
      continue;
    }
    const ids = row.hooks.map((h) => h.id);
    const handlerFile = path.join(projectDir, row.handlerPath);
    const hooksFile = path.join(projectDir, row.hooksPath);
    const handlerText = fs.existsSync(handlerFile) ? fs.readFileSync(handlerFile, 'utf8') : null;
    const hooksText = fs.existsSync(hooksFile) ? fs.readFileSync(hooksFile, 'utf8') : null;
    const changed = [];
    if (handlerText === null || sha(handlerText) !== row.handlerSha256) changed.push(row.handlerPath);
    if (hooksText === null || sha(frameOf(hooksText, ids)) !== row.hooksFrameSha256) changed.push(row.hooksPath);
    const check = { failures: 0, restored: false, ...(row.check || {}) };
    if (changed.length) {
      if (repair) check.failures += 1;
      if (repair && check.failures >= 2) {
        const spec = { sourceEntity: row.sourceEntity, targetRef: row.targetRef, childExtracts: row.childExtracts || [], hooks: row.hooks };
        writeFileAtomic(handlerFile, renderHandler(spec));
        const replaced = keepReplaced(projectDir, row.hooksPath, hooksText || '', ids);
        writeFileAtomic(hooksFile, renderHooks(spec, hookBodies(hooksText || '', ids)));
        if (replaced.lost.length) check.lostHooks = [...new Set([...(check.lostHooks || []), ...replaced.lost])], check.replacedCopy = replaced.copy;
        check.restored = true;
        check.restoredFiles = [...new Set([...(check.restoredFiles || []), ...changed])];
      } else {
        for (const file of changed) {
          findings.push(finding('codegen_scaffold_changed', file, `changed outside the hook bodies. This file is the toolkit's scaffold for ${row.sourceEntity}: change the plan row, or fill only the code between a hook's >>> and <<< markers. Restore it now (node <toolkit>/scripts/codegen-scaffold.js --project <dir> --restore); a change still there on the next check is replaced by the toolkit's version.`));
        }
      }
      if (repair) { row.check = check; changedRecord = true; }
    }
    if (check.restored) {
      for (const file of check.restoredFiles || []) {
        const lost = check.lostHooks && check.lostHooks.length && file === row.hooksPath
          ? ` The markers of ${check.lostHooks.join(', ')} were broken, so those bodies are empty again (the replaced file is ${check.replacedCopy}); re-fill them.` : '';
        findings.push(finding('codegen_scaffold_restored', file, `was changed outside the hook bodies after one fix attempt, so the toolkit replaced it with the scaffold for ${row.sourceEntity} (hook bodies kept).${lost} Records of ${row.sourceEntity} ran with the toolkit's code; a hold or failure caused by the dropped change is in the journal.`));
      }
    }
    const tasks = ((manifest && manifest.tasks) || []).filter((task) => task && task.kind === 'import' && (task.sourceBindings || []).some((b) => b.sourceEntity === row.sourceEntity && b.role !== 'source-archive'));
    for (const task of tasks) {
      if (task.id !== row.taskId) findings.push(finding('codegen_scaffold_task_id', 'execution/execution-manifest.json', `import task ${task.id} reads ${row.sourceEntity}, but its scaffolded handler is ${row.handlerPath}; name the task ${row.taskId}.`));
    }
    const planEntity = plan && (plan.entities || []).find((e) => e.sourceEntity === row.sourceEntity);
    if (planEntity) {
      const { planBuilderCoverage } = require('./plan-builder.js');
      const needed = planBuilderCoverage(planEntity).missing.map((m) => m.id).sort();
      if (JSON.stringify(needed) !== JSON.stringify([...ids].sort())) findings.push(finding('codegen_scaffold_stale', row.hooksPath, `the plan's hook rows (${needed.join(', ') || 'none'}) differ from the scaffold's (${ids.join(', ') || 'none'}); re-run the scaffold (node <toolkit>/scripts/codegen-scaffold.js --project <dir>).`));
    }
  }
  if (verifyFixedFiles(projectDir, record, manifest, findings, repair)) changedRecord = true;
  if (changedRecord) writeJson(recordFile, record);
  return findings;
}

// The fixed startup files: the same one-fix-then-restore rule as the handlers. An override in
// src/project/overrides.js is not a finding here: the adapter records it as a toolkit gap
// (lib/toolkit-gaps.js) and throws on a broken overrides file.
function verifyFixedFiles(projectDir, record, manifest, findings, repair) {
  let changedRecord = false;
  for (const row of (record.files || [])) {
    if (row.existing || !row.sha256) continue;
    const file = path.join(projectDir, row.path);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const check = { failures: 0, restored: false, ...(row.check || {}) };
    if (text === null || sha(text) !== row.sha256) {
      if (repair) check.failures += 1;
      if (repair && check.failures >= 2) { writeFileAtomic(file, renderFixed(row)); check.restored = true; }
      else findings.push(finding('codegen_scaffold_changed', row.path, `changed. This file is fixed toolkit code (${row.kind}); ${row.kind === 'adapter' ? `put a run-specific step in ${OVERRIDES_PATH} instead` : 'change the plan instead'}. Restore it now (node <toolkit>/scripts/codegen-scaffold.js --project <dir> --restore); a change still there on the next check is replaced by the toolkit's version.`));
      if (repair) { row.check = check; changedRecord = true; }
    }
    if (check.restored) findings.push(finding('codegen_scaffold_restored', row.path, `was changed after one fix attempt, so the toolkit replaced it with its own version (${row.kind}).`));
    if (row.kind === 'not-in-use') {
      for (const task of ((manifest && manifest.tasks) || []).filter((t) => t && t.kind === 'import' && (t.sourceBindings || []).some((b) => b.sourceEntity === row.sourceEntity && b.role !== 'source-archive'))) {
        if (task.id !== row.taskId) findings.push(finding('codegen_scaffold_task_id', 'execution/execution-manifest.json', `import task ${task.id} reads ${row.sourceEntity}, but its scaffolded handler is ${row.path}; name the task ${row.taskId}.`));
      }
    }
  }
  return changedRecord;
}

// Restores every scaffold file now (hook bodies kept). For codegen's own fix.
function restoreScaffold(projectDir) {
  const record = readJson(path.join(projectDir, RECORD_PATH));
  if (!record) return { restored: [] };
  const restored = [];
  for (const row of record.entities) {
    if (!row.handlerPath || row.released) continue;
    const ids = row.hooks.map((h) => h.id);
    const spec = { sourceEntity: row.sourceEntity, targetRef: row.targetRef, childExtracts: row.childExtracts || [], hooks: row.hooks };
    const hooksFile = path.join(projectDir, row.hooksPath);
    const hooksText = fs.existsSync(hooksFile) ? fs.readFileSync(hooksFile, 'utf8') : '';
    writeFileAtomic(path.join(projectDir, row.handlerPath), renderHandler(spec));
    const replaced = keepReplaced(projectDir, row.hooksPath, hooksText, ids);
    writeFileAtomic(hooksFile, renderHooks(spec, hookBodies(hooksText, ids)));
    restored.push({ sourceEntity: row.sourceEntity, ...(replaced.lost.length ? { lostHooks: replaced.lost, replacedCopy: replaced.copy } : {}) });
  }
  for (const row of (record.files || [])) {
    if (row.existing || !row.sha256) continue;
    writeFileAtomic(path.join(projectDir, row.path), renderFixed(row));
    restored.push({ path: row.path });
  }
  return { restored };
}

// The escape hatch: when an entity's scaffolded handler fails its checks for a reason no hook can
// fix, codegen may replace it. Releasing it records why; the toolkit then never restores or
// rewrites that handler, and every verify reports it (codegen_scaffold_released), which reaches
// the completion report as a toolkit finding. Returns the released row, or null.
function releaseScaffold(projectDir, sourceEntity, reason) {
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('releaseScaffold needs a reason');
  const recordFile = path.join(projectDir, RECORD_PATH);
  const record = readJson(recordFile);
  const row = record && (record.entities || []).find((e) => e.sourceEntity === sourceEntity && e.handlerPath);
  if (!row) return null;
  row.released = { reason: reason.trim(), at: new Date().toISOString() };
  writeJson(recordFile, record);
  return row;
}

module.exports = {
  releaseScaffold, SCAFFOLD_VERSION, RECORD_PATH, newPathEntities, taskIdFor, writeScaffold, verifyScaffold, restoreScaffold,
  renderHandler, renderHooks, hookBodies, writeReadBackBuilders, READ_BACK_DIR, addSourceArchiveTask, plansSourceArchive, ARCHIVE_TASK_ID, ARCHIVE_BINDING, frameOf, closure, childExtractsFor, sourcePlatform, fixedFileSpecs, renderFixed, OVERRIDES_PATH,
};
