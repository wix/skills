'use strict';
// refresh-derived: one deterministic step that rebuilds every file derived from the mapping plan.
// writeMappingAuthority runs it after each write and the router runs it before routing, so a
// mapping edit never leaves a derived digest for an agent to rebuild by hand.
//
//   rebuilt here:   mapping/mapping-resolution.json, mapping/review/census-reconciliation.json,
//                   execution/discovered-set-status.json (when present)
//   re-bound here:  sha pins on these files in approvals, approval requests and the import-plan
//                   freshness record, only when the content they pinned is unchanged
//   checked only:   setup/setup-plan.json and execution/execution-manifest.json mapping pins
//                   (rebuilt by rp-setup-discovery and rp-import-codegen; the router routes them)
// The CMS-fallback digest is stamped by writeMappingAuthority itself, never here: a plan built
// before a coverage change must go back to the mapper.
const fs = require('node:fs');
const path = require('node:path');
const { hashArtifact } = require('./artifact-freshness');
const mappingPlanDigest = require('./mapping-plan-digest');

const STATE_FILE = 'state/derived-refresh.json';
const PLAN = mappingPlanDigest.PLAN;
const RECONCILIATION = 'mapping/review/census-reconciliation.json';
const DECISIONS_DIR = 'mapping/entity-decisions';

function fields() { return require('./mapping-field-contract'); }
function readJson(projectDir, file) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')); } catch { return null; }
}
function writeJson(projectDir, file, value) {
  const target = path.join(projectDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.writing`;
  fs.writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(staging, target);
}

// Census inputs that pin another file's bytes. In the content key each becomes that file's
// content digest while it still matches the current bytes, so a byte-only rewrite keeps the key
// and any real change to an input (an edited plan included) changes it.
const RECONCILIATION_INPUT_FILES = { census: 'discovery/census.json', mappingPlan: PLAN, mappingGaps: 'mapping/review/mapping-gaps.json',
  finalizedAssignments: 'mapping/review/finalized-census-assignments.json' };

// What an approval of each pinned file reviewed.
function contentKey(projectDir, file) {
  if (file === DECISIONS_DIR) {
    let names;
    try { names = fs.readdirSync(path.join(projectDir, file)).filter(n => !n.startsWith('.')).sort(); } catch { return null; }
    return fields().digest(names.map(n => [n, readJson(projectDir, `${file}/${n}`)]));
  }
  const value = readJson(projectDir, file);
  if (value === null) return null;
  if (file === RECONCILIATION && value?.inputs && typeof value.inputs === 'object') {
    const inputs = Object.fromEntries(Object.entries(value.inputs).map(([name, pin]) => {
      const input = RECONCILIATION_INPUT_FILES[name], key = input && pin ? contentKey(projectDir, input) : null;
      return [name, key && (pin === key || pin === hashArtifact(projectDir, input)) ? `content:${key}` : pin];
    }));
    return fields().digest({ ...value, inputs });
  }
  return fields().digest(value);
}
function boundFiles(projectDir) {
  let decisions = [];
  try { decisions = fs.readdirSync(path.join(projectDir, DECISIONS_DIR)).filter(n => n.endsWith('.json')).map(n => `${DECISIONS_DIR}/${n}`); } catch {}
  return [PLAN, 'mapping/mapping-resolution.json', RECONCILIATION, 'mapping/review/mapping-gaps.json', DECISIONS_DIR, ...decisions];
}
function snapshot(projectDir) {
  return Object.fromEntries(boundFiles(projectDir).map(file => [file, { sha256: hashArtifact(projectDir, file), key: contentKey(projectDir, file) }]));
}

const bare = sha => String(sha || '').replace(/^sha256:/, '').toLowerCase();
function moveRefs(refs, moves) {
  let changed = false;
  for (const ref of Array.isArray(refs) ? refs : []) {
    const move = ref && typeof ref === 'object' && moves.find(m => m.path === ref.path && bare(ref.sha256) === m.from);
    if (move) { ref.sha256 = String(ref.sha256).startsWith('sha256:') ? `sha256:${move.to}` : move.to; changed = true; }
  }
  return changed;
}
// Move every pin on old bytes to the new bytes of the same content. Content-addressed: a pin on
// any other version is left as it is, and stays stale.
function rebind(projectDir, before, after) {
  const moves = Object.keys(after).filter(file => before[file]?.sha256 && after[file].sha256 && before[file].sha256 !== after[file].sha256
    && before[file].key !== null && before[file].key === after[file].key).map(file => ({ path: file, from: before[file].sha256, to: after[file].sha256 }));
  if (!moves.length) return [];
  const touched = [];
  const approvals = readJson(projectDir, 'orchestration/approvals.json');
  if (approvals && typeof approvals === 'object') {
    let changed = false;
    for (const approval of Object.values(approvals)) {
      if (!approval || typeof approval !== 'object') continue;
      if (moveRefs(approval.artifactRefs, moves)) changed = true;
      for (const move of moves) if (approval.bindingDigests && bare(approval.bindingDigests[move.path]) === move.from) { approval.bindingDigests[move.path] = move.to; changed = true; }
    }
    if (changed) { writeJson(projectDir, 'orchestration/approvals.json', approvals); touched.push('orchestration/approvals.json'); }
  }
  let names = [];
  try { names = fs.readdirSync(path.join(projectDir, 'orchestration/user-actions')).filter(n => n.endsWith('.json') && n !== 'index.json'); } catch {}
  for (const name of names) {
    const file = `orchestration/user-actions/${name}`, request = readJson(projectDir, file);
    if (request && moveRefs(request.artifactRefs, moves)) { writeJson(projectDir, file, request); touched.push(file); }
  }
  const freshnessFile = 'execution/review/import-plan.freshness.json', freshness = readJson(projectDir, freshnessFile);
  if (freshness?.artifacts && moveRefs(Object.values(freshness.artifacts), moves)) { writeJson(projectDir, freshnessFile, freshness); touched.push(freshnessFile); }
  return touched.length ? moves.map(move => ({ ...move, files: touched })) : [];
}

async function refreshDerived(projectDir, { before = null, trigger = 'router' } = {}) {
  const start = before || snapshot(projectDir);
  const plan = readJson(projectDir, PLAN);
  if (!plan) return { ok: true, steps: [], rebinds: [] };
  const steps = [];
  const note = (file, status, detail = {}) => steps.push({ file, status, ...detail });

  if (plan.fieldContractVersion === 1) {
    const R = require('./mapping-resolution');
    const existing = readJson(projectDir, R.FILE);
    const seed = existing ? R.seedOf(existing) : null;
    if (!existing) { writeJson(projectDir, R.FILE, R.project(plan, { seed: null })); note(R.FILE, 'rebuilt'); }
    else if (seed?.provenance?.tampered) note(R.FILE, 'stale', { reason: 'seed_changed_after_projection' });
    else if (!R.compare(projectDir, plan).ok) { writeJson(projectDir, R.FILE, R.project(plan, { seed })); note(R.FILE, 'rebuilt'); }
  }

  const C = require('./census-reconciliation');
  let reconciliation = null;
  try { reconciliation = await C.readReconciliation(projectDir); } catch {}
  if (!reconciliation) {
    if (!readJson(projectDir, 'discovery/census.json')) note(RECONCILIATION, 'stale', { reason: 'census_missing' });
    else { await C.buildReconciliation(projectDir); note(RECONCILIATION, 'rebuilt'); }
  } else {
    const freshness = await C.censusReconciliationFreshness(projectDir, reconciliation);
    // A stale census is discovery's to rebuild; the reconciliation would only record the error.
    if (!freshness.ok && freshness.staleInputs.includes('census')) note(RECONCILIATION, 'stale', { reason: 'census_stale' });
    else if (!freshness.ok) { await C.buildReconciliation(projectDir); note(RECONCILIATION, 'rebuilt', { staleInputs: freshness.staleInputs }); }
  }

  const rebinds = rebind(projectDir, start, snapshot(projectDir));

  const D = require('./discovered-set-status');
  const status = readJson(projectDir, D.STATUS_FILE);
  if (status && !(await D.discoveredSetStatusFreshness(projectDir, status)).ok) {
    try { await D.buildDiscoveredSetStatus(projectDir); note(D.STATUS_FILE, 'rebuilt'); }
    catch (error) { note(D.STATUS_FILE, 'stale', { reason: error.code || 'rebuild_refused' }); }
  }

  const setupPlan = readJson(projectDir, 'setup/setup-plan.json');
  const setupPin = setupPlan?.inputs?.mappingPlanDigest || setupPlan?.inputs?.mappingPlanSha256;
  if (setupPin && !mappingPlanDigest.matches(projectDir, setupPin)) note('setup/setup-plan.json', 'stale', { owner: 'resources/rp-setup-discovery/' });
  const manifestPin = readJson(projectDir, 'execution/execution-manifest.json')?.mappingPlanDigest;
  if (manifestPin && !mappingPlanDigest.matches(projectDir, manifestPin)) note('execution/execution-manifest.json', 'stale', { owner: 'resources/rp-import-codegen/' });

  const result = { ok: !steps.some(step => step.status === 'stale' && !step.owner), steps, rebinds };
  if (rebinds.length || steps.some(step => step.status === 'rebuilt')) {
    writeJson(projectDir, STATE_FILE, { schemaVersion: 1, trigger, refreshedAt: new Date().toISOString(), mappingPlanDigest: mappingPlanDigest.current(projectDir), ...result });
  }
  return result;
}

module.exports = { STATE_FILE, snapshot, rebind, refreshDerived };
