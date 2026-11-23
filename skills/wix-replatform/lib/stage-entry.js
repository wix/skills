'use strict';

// Design v2 (G): what the toolkit does itself when a run enters a stage, before the stage's AI
// works. The route script and the run supervisor both call prepareStage with the router's
// result; it is idempotent, offline (no Wix, no source reads) and never changes the route.
//
//   mapping_running  the plan pre-fill (lib/plan-prefill.js) for every entity with ready-made
//                    suggestions: mapping/plan-prefill.json, and the pre-filled entities written
//                    into mapping/mapping-plan.json (a new plan is seeded with them). The mapper
//                    adds only operator changes and leftovers; its rows survive every re-run.
//   codegen_running  The codegen telemetry stage starts (when the run's telemetry is active).
//                    WordPress/WooCommerce: the fixed catalog extractor is installed (when the
//                    toolkit has it). Every entity on the fixed loop gets its import handler and
//                    hooks file (lib/codegen-scaffold.js); codegen fills only the hook bodies.
//   any stage past an approval gate, in a user-chosen one-click run: the mapping and execution
//                    approvals are recorded as approved by the agent (scripts/orchestration-state.js
//                    auto-approve) by this code, never by an agent call, so nothing turns into a
//                    mid-run question. A rejection still stops the route.
//
// A failure here is reported in the result (`errors`) and never stops the route: the stage's own
// checks still run.

const fs = require('node:fs');
const path = require('node:path');

const PLAN_PATH = 'mapping/mapping-plan.json';
const PREFILL_PATH = 'mapping/plan-prefill.json';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
function platformOf(projectDir, plan) {
  const schema = readJson(path.join(projectDir, 'source-schema.json'));
  return (schema && schema.platform) || (plan && (plan.sourcePlatform || plan.sourceSystem)) || null;
}

// Entity choices the run recorded (operator or AI) win over the suggestion's default of the same name.
function mergeChoices(prefilled, existing) {
  prefilled = Array.isArray(prefilled) ? prefilled : [];
  existing = Array.isArray(existing) ? existing : [];
  const run = existing.filter((c) => c && c.decidedBy && c.decidedBy !== 'suggestion');
  const names = new Set(run.map((c) => c.name));
  return [...prefilled.filter((c) => !names.has(c.name)), ...run];
}

// The plan with each pre-filled entity in place of the plan's own (the pre-fill already kept that
// entity's header fields and every row the run wrote). Returns null when nothing changes.
function mergePrefill(plan, entities) {
  const next = { ...plan, entities: Array.isArray(plan.entities) ? [...plan.entities] : [] };
  let changed = false;
  for (const entity of entities) {
    const at = next.entities.findIndex((e) => e && e.sourceEntity === entity.sourceEntity);
    const existing = at >= 0 ? next.entities[at] : null;
    const choices = mergeChoices(entity.choices, existing && existing.choices);
    const merged = { ...entity, ...(choices.length ? { choices } : {}) };
    if (!choices.length) delete merged.choices;
    if (existing && JSON.stringify(existing) === JSON.stringify(merged)) continue;
    if (at >= 0) next.entities[at] = merged; else next.entities.push(merged);
    changed = true;
  }
  // codegen derives its manifest from these (dependency-readiness validateAssociations).
  const bindings = require('./plan-prefill.js').dependencyBindings(plan.dependencyBindings, entities);
  if (JSON.stringify(bindings) !== JSON.stringify(plan.dependencyBindings || [])) { next.dependencyBindings = bindings; changed = true; }
  return changed ? next : null;
}

// What the run did to pre-filled rows since the last pre-fill (mapping/plan-prefill.json), kept as
// run rows so a re-run never undoes it:
// - a pre-filled row edited in place loses its `prefilled` marker: it is the run's row now;
// - a pre-filled row deleted from the plan becomes an `excluded` row with a recorded choice
//   (decidedBy "ai": the toolkit can't tell who deleted it). It is listed with the plan's choices,
//   so the end report shows the drop. A dropped reference link still needs the operator (B3).
const ARCHIVE_ROW_ID = 'source-archive';
function gapOf(gap) {
  const rule = gap && typeof gap.rule === 'string' && gap.rule.trim() ? gap.rule.trim() : null;
  const why = gap && typeof gap.why === 'string' && gap.why.trim() ? gap.why.trim() : null;
  return { toolkitGap: { rule, why } };
}
function keepRunEdits(plan, last) {
  const edits = [];
  if (!plan || !Array.isArray(plan.entities) || !last || !Array.isArray(last.entities)) return { plan, edits };
  const entities = plan.entities.map((entity) => {
    const before = last.entities.find((e) => e && entity && e.sourceEntity === entity.sourceEntity);
    if (!before || !Array.isArray(entity.fieldMappings) || entityDecided(entity, before)) return entity;
    const prior = new Map((before.fieldMappings || []).filter((r) => r && r.prefilled && r.id !== ARCHIVE_ROW_ID).map((r) => [r.id, r]));
    const rows = entity.fieldMappings.map((row) => {
      if (!row || !row.prefilled || row.id === ARCHIVE_ROW_ID) return row;
      const was = prior.get(row.id);
      if (was && JSON.stringify(was) === JSON.stringify(row)) return row;
      const { prefilled, toolkitGap, ...kept } = row;
      edits.push({ sourceEntity: entity.sourceEntity, rowId: row.id, kind: 'edited', ...gapOf(toolkitGap) });
      return kept;
    });
    const present = new Set(rows.map((r) => r && r.id));
    for (const [id, was] of prior) {
      if (present.has(id)) continue;
      const reason = `The run removed the pre-filled row ${id} from the plan; its source fields are not imported.`;
      rows.push({ id, sourcePaths: [...(was.sourcePaths || [])], disposition: 'excluded', reason, evidence: ['mapping/mapping-plan.json: row removed during mapping'],
        choice: { name: `drop-${id}`, value: true, default: null, reason, decidedBy: 'ai' } });
      edits.push({ sourceEntity: entity.sourceEntity, rowId: id, kind: 'deleted', ...gapOf(null) });
    }
    return edits.some((e) => e.sourceEntity === entity.sourceEntity) ? { ...entity, fieldMappings: rows } : entity;
  });
  return { plan: edits.length ? { ...plan, entities } : plan, edits };
}

// What the run decided about a whole pre-filled entity since the last pre-fill, kept on every
// re-run for every pre-filled entity (adapt rule 2: the AI or operator may decide otherwise):
// - removed: the last pre-fill merged it and the plan no longer has it. It is not re-added; the
//   census gate still asks for a decision on its records.
// - decided: its entity-level fields (ENTITY_DECISION_FIELDS: a set-aside, a status, inUse) differ
//   from what the last pre-fill wrote. The plan's entity is kept as it is.
// Without a last pre-fill nothing counts as decided (a first pre-fill seeds the plan).
const ENTITY_DECISION_FIELDS = ['fieldMappingStatus', 'limitation', 'inUse'];
function entityDecided(entity, before) {
  return ENTITY_DECISION_FIELDS.some((k) => JSON.stringify(entity[k] ?? null) !== JSON.stringify(before[k] ?? null));
}
function runEntityDecisions(plan, last) {
  if (!plan || !Array.isArray(plan.entities) || !last || !Array.isArray(last.entities)) return [];
  const out = [];
  for (const before of last.entities) {
    if (!before || !before.sourceEntity || (before.prefill && before.prefill.errors && before.prefill.errors.length)) continue;
    const entity = plan.entities.find((e) => e && e.sourceEntity === before.sourceEntity);
    if (!entity) out.push({ sourceEntity: before.sourceEntity, kind: 'removed' });
    else if (entityDecided(entity, before)) out.push({ sourceEntity: before.sourceEntity, kind: entity.limitation ? 'set-aside' : 'entity-changed' });
  }
  return out;
}

// Every changed or deleted pre-filled row is one toolkit gap (never a cutover task): the suggestion
// rule failed on these records. Rows accumulate across routes (edits show once, in the route that
// sees them). A missing reason is recorded as null and named in a notice; nothing is blocked.
function recordPrefillEdits(projectDir, edits) {
  if (!edits.length) return [];
  const gaps = require('./toolkit-gaps.js');
  const old = gaps.readToolkitGaps(projectDir).filter((g) => g.source === 'plan-prefill-edit');
  const fresh = edits.map((e) => ({ step: `${e.sourceEntity}.${e.rowId} ${e.kind}${e.toolkitGap.rule ? ` (rule ${e.toolkitGap.rule})` : ''}`, file: PLAN_PATH, why: e.toolkitGap.why, kind: 'prefill-edit' }));
  const keys = new Set(fresh.map((g) => g.step));
  gaps.recordToolkitGaps(projectDir, 'plan-prefill-edit', [...old.filter((g) => !keys.has(g.step)), ...fresh]);
  return edits.filter((e) => !e.toolkitGap.why).map((e) => `pre-filled row ${e.sourceEntity}.${e.rowId} was ${e.kind} without a toolkitGap reason; recorded as a toolkit gap with no reason`);
}

// The read-only source extract the pre-fill reads (lib/source-extract-background.js). Discovery
// capture starts it; the mapping entry starts it if it never ran (or failed) and waits for it.
// The run controller waits long (extractWaitMs); the route script, run by the agent, waits briefly
// and otherwise tells the agent to wait and route again.
const EXTRACT_WAIT_MS = 60000;
function awaitSourceExtract(projectDir, platform, waitMs) {
  const bg = require('./source-extract-background.js');
  const start = bg.startSourceExtract(projectDir, { platform, retry: true });
  const status = bg.waitForSourceExtract(projectDir, { timeoutMs: waitMs });
  return { start, status: status ? status.status : null, out: status && status.out };
}

function prepareMapping(projectDir, { extractWaitMs = EXTRACT_WAIT_MS } = {}) {
  const prefill = require('./plan-prefill.js');
  const planFile = path.join(projectDir, PLAN_PATH);
  const last = readJson(path.join(projectDir, PREFILL_PATH));
  const { plan, edits } = keepRunEdits(readJson(planFile), last);
  const entityDecisions = runEntityDecisions(plan, last);
  const decidedByRun = new Set(entityDecisions.map((d) => d.sourceEntity));
  const platform = platformOf(projectDir, plan);
  if (!platform || !prefill.loadSuggestions(platform).size) return { step: 'plan-prefill', skipped: 'no-suggestions', platform };
  const extract = awaitSourceExtract(projectDir, platform, extractWaitMs);
  if (['starting', 'running'].includes(extract.status)) {
    return { step: 'plan-prefill', skipped: 'source-extract-running', platform, sourceExtract: extract,
      notices: [`the toolkit's read-only source extract is still running (${require('./source-extract-background.js').STATUS}); do not start another one. Wait for it with \`node <toolkit>/scripts/wait-background.js --project <dir>\`, then route again.`] };
  }
  const extractNotices = extract.status === 'failed' || extract.status === 'partial'
    ? [`the toolkit's source extract ended ${extract.status}; the readers that failed are listed in ${extract.out}. The pre-fill used the records that were read.`] : [];
  const entities = prefill.prefillProject(projectDir, { platform, plan });
  if (!entities.length) return { step: 'plan-prefill', skipped: 'no-source-records', platform, sourceExtract: extract, ...(extractNotices.length ? { notices: extractNotices } : {}) };
  writeJson(path.join(projectDir, PREFILL_PATH), { schemaVersion: 1, prefillVersion: prefill.PREFILL_VERSION, platform, entities });
  const valid = entities.filter((e) => !e.prefill.errors.length && !decidedByRun.has(e.sourceEntity));
  const base = plan || { schemaVersion: 1, fieldContractVersion: 1, sourcePlatform: platform, sourceSystem: platform, entities: [] };
  const next = mergePrefill(base, valid) || (edits.length ? base : null);
  if (next) writeJson(planFile, next);
  // Bind the written plan to the plugin coverage, as the mapper's own write does, so the route does
  // not send the run back for a CMS-fallback digest the toolkit itself left out.
  const stamp = next ? safely('cms-fallback-stamp', () => require('./plugin-cms-fallback.js').stampPlanDigest(projectDir, 'mapping')) : null;
  const notices = [...extractNotices, ...recordPrefillEdits(projectDir, edits), ...(stamp && stamp.error ? [`the plan was not bound to the plugin coverage: ${stamp.error}`] : [])];
  return {
    ...(notices.length ? { notices } : {}),
    step: 'plan-prefill',
    platform,
    // An entity failing the plan contract is left as the plan has it; the mapper fixes the row named.
    entityErrors: entities.flatMap((e) => e.prefill.errors.map((m) => `plan-prefill ${e.sourceEntity} not merged: ${m}`)),
    plan: plan ? (next ? 'merged' : 'unchanged') : 'seeded',
    // Pre-filled rows the run edited (now run rows) or deleted (now recorded drops).
    runEdits: edits,
    // Pre-filled entities the run removed or decided at entity level: kept as the plan has them.
    ...(entityDecisions.length ? { runEntityDecisions: entityDecisions } : {}),
    sourceExtract: extract,
    file: PREFILL_PATH,
    entities: entities.map((e) => ({
      sourceEntity: e.sourceEntity,
      prefilledRows: e.prefill.rows.length,
      runRows: prefill.aiWrittenRows(e).map((d) => d.id),
      review: e.prefill.review.map((g) => g.group),
      errors: e.prefill.errors,
    })),
  };
}

function prepareExtract(projectDir) {
  const platform = platformOf(projectDir, readJson(path.join(projectDir, PLAN_PATH)));
  if (!['wordpress', 'woocommerce'].includes(platform)) return { step: 'extract-install', skipped: 'not-wordpress', platform };
  const handoff = require('./generated-plugin-handoff.js');
  if (typeof handoff.emitCatalogExtract !== 'function') return { step: 'extract-install', skipped: 'catalog-extractor-not-in-toolkit', platform };
  return { step: 'extract-install', platform, ...handoff.emitCatalogExtract(projectDir) };
}

// The codegen telemetry stage opens at stage entry, so the stage's time is measured from the
// route, not from whenever the agent remembers to call `stage start` (11-21: 9 min late). Only
// when the run's telemetry is active and no stage is open: a stage another agent left open is
// its own to end, with its own outcome. Telemetry never fails the stage.
function openStageTelemetry(projectDir, stageName) {
  const step = 'telemetry-stage-start';
  const recorder = require('../resources/rp-telemetry/lib/telemetry-recorder.js');
  const status = recorder.status(projectDir);
  if (!status || !status.active) return { step, skipped: 'no-telemetry-run' };
  if (status.open_stage === stageName) return { step, skipped: 'already-open' };
  if (status.open_stage) return { step, skipped: `stage-${status.open_stage}-open` };
  if (status.open_wait) return { step, skipped: 'wait-open' };
  return { step, ...recorder.stage(projectDir, 'start', stageName) };
}

function prepareCodegen(projectDir) {
  const out = [];
  for (const [step, run] of [['telemetry-stage-start', (dir) => openStageTelemetry(dir, 'codegen')], ['extract-install', prepareExtract], ['codegen-scaffold', (dir) => ({ step: 'codegen-scaffold', ...require('./codegen-scaffold.js').writeScaffold(dir) })]]) {
    try { out.push(run(projectDir)); } catch (error) { out.push({ step, error: String((error && error.message) || error) }); }
  }
  // A telemetry no-op (no run, already open, another stage open) is not reported.
  return out.filter((s) => !(s.step === 'telemetry-stage-start' && s.skipped));
}

// One-click never asks for an approval, and the agent never records one: an agent's own
// `auto-approve` call can be refused by the host's permission check ("undermining oversight"), and
// then the run asked. The router skips the mapping and execution gates for a user-chosen one-click
// run; this records each approval when the route enters a stage past its gate, through the same
// CLI (binding, event, decidedBy agent). The CLI still refuses an incomplete mapping or a stale
// census, and that refusal is listed in stagePrepared.errors. Interactive runs, an inferred
// one-click and a rejected or already decided approval are untouched; quick mode records its own.
const PAST_GATE = {
  mapping: new Set(['setup_discovery_running', 'website_handoff_running', 'codegen_running', 'executing_setup', 'executing_import']),
  execution: new Set(['executing_setup', 'executing_import']),
};
function recordOneClickApproval(projectDir, type) {
  const step = `one-click-${type}-approval`;
  const decisions = readJson(path.join(projectDir, 'orchestration', 'decisions.json')) || {};
  if (!require('./orchestration-decisions.js').isExplicitUserOneClick(decisions)) return { step, skipped: 'not-user-one-click' };
  const status = readJson(path.join(projectDir, 'orchestration', 'approvals.json'))?.[type]?.status;
  if (status !== 'pending') return { step, skipped: `${type}-${status || 'missing'}` };
  const cli = path.join(__dirname, '..', 'scripts', 'orchestration-state.js');
  require('node:child_process').execFileSync(process.execPath, [cli, 'auto-approve', '--project-dir', projectDir, '--type', type,
    '--notes', `One-click: ${type} approval recorded by the toolkit at stage entry, never asked.`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { step, recorded: true };
}
const recordOneClickExecutionApproval = (projectDir) => recordOneClickApproval(projectDir, 'execution');

// The CSV sample preview (rp-import-codegen "sample preview"): in one-click it is accepted here,
// not by the agent, when the sample produced records (at least one positive entity count) and
// listed no warnings. Otherwise it stays pending and the reason is listed: codegen fixes the
// extractor, and the next route checks again. Nothing is asked.
const PREVIEW_PATH = path.join('preview', 'preview-result.json');
function recordOneClickPreview(projectDir) {
  const step = 'one-click-sample-preview';
  const decisions = readJson(path.join(projectDir, 'orchestration', 'decisions.json')) || {};
  if (!require('./orchestration-decisions.js').isExplicitUserOneClick(decisions)) return { step, skipped: 'not-user-one-click' };
  const file = path.join(projectDir, PREVIEW_PATH);
  const preview = readJson(file);
  if (!preview || preview.status !== 'pending') return { step, skipped: `preview-${(preview && preview.status) || 'missing'}` };
  const counts = preview.entityCounts && typeof preview.entityCounts === 'object' ? Object.values(preview.entityCounts) : [];
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  if (!counts.some((n) => Number.isFinite(n) && n > 0)) return { step, error: 'sample preview has no records (entityCounts): fix the extractor and run the sample again' };
  if (warnings.length) return { step, error: `sample preview lists ${warnings.length} warning(s): fix them in the extractor and run the sample again` };
  writeJson(file, { ...preview, status: 'accepted', decidedAt: new Date().toISOString(), decidedBy: 'agent' });
  return { step, recorded: true };
}

function oneClickApprovals(projectDir, route) {
  if (!route || route.ok === false || String(route.reason || '').startsWith('quick_mode')) return [];
  const out = ['mapping', 'execution'].filter((type) => PAST_GATE[type].has(route.nextState))
    .map((type) => safely(`one-click-${type}-approval`, () => recordOneClickApproval(projectDir, type)));
  if (route.reason === 'sample_preview_pending') out.push(safely('one-click-sample-preview', () => recordOneClickPreview(projectDir)));
  // Only what was recorded or refused is reported; a no-op (interactive, already decided) is not.
  return out.filter((step) => !step.skipped);
}

// Mapping is finished once the route leaves it with the mapping approval recorded (by the user,
// or by the toolkit in one-click above). Nothing else marks the mapping checkpoint, so it is set
// here through the same CLI (journal event included): approved -> complete, provisional -> partial.
const MAPPING_DONE = { approved: 'complete', provisional: 'partial' };
const PAST_MAPPING = new Set([...PAST_GATE.mapping, 'awaiting_execution_approval']);
function markMappingCheckpoint(projectDir, route) {
  const step = 'mapping-checkpoint';
  if (!route || route.ok === false || String(route.reason || '').startsWith('quick_mode') || !PAST_MAPPING.has(route.nextState)) return { step, skipped: 'not-past-mapping' };
  const status = MAPPING_DONE[readJson(path.join(projectDir, 'orchestration', 'approvals.json'))?.mapping?.status];
  if (!status) return { step, skipped: 'mapping-not-approved' };
  if (readJson(path.join(projectDir, 'orchestration', 'checkpoints.json'))?.mapping?.status === status) return { step, skipped: `already-${status}` };
  const patch = { status, lastCompletedStep: 'mapping-approval', artifactRefs: ['mapping/mapping-plan.json', 'mapping/review/census-reconciliation.json', 'orchestration/approvals.json'] };
  const cli = path.join(__dirname, '..', 'scripts', 'orchestration-state.js');
  require('node:child_process').execFileSync(process.execPath, [cli, 'checkpoint', '--project-dir', projectDir, '--phase', 'mapping', '--patch', JSON.stringify(patch)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { step, recorded: status };
}

function safely(step, run) {
  try { return run(); } catch (error) { return { step, error: String((error && error.stderr) || (error && error.message) || error).trim() }; }
}

const STAGES = {
  // Pre-fill first, then the mechanical defaults on the plan it wrote (lib/mapping-defaults.js).
  mapping_running: (dir, options) => [prepareMapping(dir, options),
    safely('mapping-defaults', () => require('./mapping-defaults.js').prepareMappingDefaults(dir, platformOf(dir, readJson(path.join(dir, PLAN_PATH)))))],
  codegen_running: prepareCodegen,
};

// Discovery is over once its checkpoint is complete: any route from then on starts the background
// extract if capture did not (no wait). Nothing to do when it already ran or the platform has none.
function startExtractAfterDiscovery(projectDir, route) {
  const step = 'source-extract-start';
  if (!route || route.ok === false || route.nextState === 'mapping_running') return { step, skipped: 'not-needed' };
  if (readJson(path.join(projectDir, 'orchestration', 'checkpoints.json'))?.discovery?.status !== 'complete') return { step, skipped: 'discovery-not-complete' };
  const out = require('./source-extract-background.js').startSourceExtract(projectDir, { platform: platformOf(projectDir, readJson(path.join(projectDir, PLAN_PATH))) });
  return out.started ? { step, ...out } : { step, skipped: out.skipped };
}

// While the mapping approval is still pending: 'entering' on a mapping route, 'leaving' on a route
// past the mapping gate. Quick mode and failed routes build none.
function blockedDataDue(projectDir, route) {
  if (!route || route.ok === false || String(route.reason || '').startsWith('quick_mode')) return null;
  if (readJson(path.join(projectDir, 'orchestration', 'approvals.json'))?.mapping?.status !== 'pending') return null;
  if (route.nextState === 'mapping_running') return 'entering';
  return PAST_GATE.mapping.has(route.nextState) ? 'leaving' : null;
}

// Runs the toolkit's own work for the stage the route selected. Returns
// { stage, steps: [...], errors: [...], notices? } or null when the stage has none. A notice is
// something the stage's AI must act on that is not a failure (a listed patch the toolkit replaced).
function prepareStage(projectDir, route, options = {}) {
  // The mapping checkpoint follows the approvals: a one-click approval recorded above counts.
  // Blocked-data requests are built from the plan before the mapping approval is recorded on the
  // way out of mapping, and after the pre-fill on the way in.
  const blocked = (when) => (blockedDataDue(projectDir, route) === when ? [safely('blocked-data-requests', () => require('./blocked-data-entry.js').prepareBlockedDataRequests(projectDir))] : []);
  const approvals = [...blocked('leaving'), ...oneClickApprovals(projectDir, route), safely('mapping-checkpoint', () => markMappingCheckpoint(projectDir, route)),
    safely('source-extract-start', () => startExtractAfterDiscovery(projectDir, route))].filter((step) => !step.skipped);
  const run = route && route.ok !== false ? STAGES[route.nextState] : null;
  if (!run && !approvals.length) return null;
  let steps = [];
  if (run) { try { steps = run(projectDir, options); } catch (error) { steps = [{ step: route.nextState, error: String((error && error.message) || error) }]; } }
  steps = [...approvals, ...steps, ...blocked('entering').filter((step) => !step.skipped)];
  const notices = steps.flatMap((s) => (s.notices || []).map((text) => `${s.step}: ${text}`));
  return { stage: route.nextState, steps, errors: steps.flatMap((s) => [...(s.error ? [`${s.step}: ${s.error}`] : []), ...(s.entityErrors || [])]), ...(notices.length ? { notices } : {}) };
}

module.exports = { runEntityDecisions, entityDecided, prepareStage, platformOf, mergePrefill, keepRunEdits, prepareMapping, prepareCodegen, recordOneClickApproval, recordOneClickExecutionApproval, recordOneClickPreview, markMappingCheckpoint, STAGES };
