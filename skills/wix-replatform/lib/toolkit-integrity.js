'use strict';

// Toolkit integrity guard (history classes H15 + H50).
//
// Generated code vendors toolkit libs into `src/lib` / `src/resources`, and agents under
// pressure have edited the installed toolkit or those copies (Tuti 11-15 rev 3 ran a
// hand-patched src/lib/dependency-readiness.js; s5-TX ran on stale copies of 7 libs).
// Nothing noticed. This guard:
// - at supervisor start, hashes the installed toolkit (this skill, plus any `.agents/skills`
//   and `.claude/skills` above the project) and keeps a content copy so it can restore;
// - at every stage boundary (after each agent turn), finds edited, added or deleted toolkit
//   files and vendored copies that differ from the toolkit file at the same path;
// - restores them (the changed copy is kept under quarantine, never lost) and appends an
//   incident; the completion report turns incidents into one operatorAction.
// A deliberate patch (an import operator fixing the toolkit mid-run) is accepted with
// `scripts/toolkit-integrity.js accept`, which re-baselines and is listed in the report.
// An agent that fixes a toolkit bug in the project's own vendored copy lists the fix in
// execution/toolkit-patches.md; a listed copy is kept (recorded, not restored) and each listed
// patch becomes a toolkit-patched-in-run action so it lands as a toolkit PR. The installed
// toolkit is always restored.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SKILL_ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join('state', 'runner', 'toolkit-integrity');
const BASELINE = path.join(STATE_DIR, 'baseline.json');
const INCIDENTS_PATH = 'execution/toolkit-integrity-incidents.ndjson';
const ACTION_CODE = 'toolkit-integrity-restored';
const ACCEPTED_CODE = 'toolkit-integrity-patch-accepted';
const GUARD_ERROR_CODE = 'toolkit-integrity-guard-error';
const PATCHES_PATH = 'execution/toolkit-patches.md';
const PATCHED_CODE = 'toolkit-patched-in-run';
const SKIP_DIRS = new Set(['node_modules', '.git']);
// Vendored copies live in the project under these prefixes and mirror the skill layout.
const VENDOR_PREFIXES = [['src/lib/', 'lib/'], ['src/resources/', 'resources/']];

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function disabled(env = process.env) { return /^(0|off|false|no)$/i.test(String(env.REPLATFORM_TOOLKIT_INTEGRITY || '')); }

function listFiles(root, base = root, out = []) {
  let entries;
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return out; throw error; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) listFiles(root, full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function hashTree(root) {
  const files = {};
  for (const rel of listFiles(root).sort()) files[rel] = sha256(fs.readFileSync(path.join(root, rel)));
  return files;
}

function realOrNull(dir) { try { return fs.realpathSync(dir); } catch { return null; } }

// The installed toolkit roots for a project: this skill, and every `.agents/skills` /
// `.claude/skills` from the project upward. Nested or duplicate (symlinked) roots are dropped.
function toolkitRoots(projectDir, { skillRoot = SKILL_ROOT } = {}) {
  const candidates = [];
  // Walk up to the checkout that holds the project (the first directory with `.git`), never
  // into the home directory: personal skills there are not the run's toolkit.
  const home = path.resolve(os.homedir());
  let dir = path.resolve(projectDir);
  while (dir !== home) {
    for (const name of ['.agents/skills', '.claude/skills']) candidates.push(path.join(dir, name));
    const parent = path.dirname(dir);
    if (fs.existsSync(path.join(dir, '.git')) || parent === dir) break;
    dir = parent;
  }
  // This skill counts when it is an installed copy (`<x>/.agents/skills/<skill>` or
  // `<x>/.claude/skills/<skill>`). A source checkout (the repo's `skills/` folder) is a
  // developer's working tree: it is the reference for vendored copies but never restored.
  const installed = realOrNull(skillRoot);
  if (installed && path.basename(path.dirname(installed)) === 'skills' && ['.agents', '.claude'].includes(path.basename(path.dirname(path.dirname(installed))))) candidates.push(skillRoot);
  const real = [...new Set(candidates.map(realOrNull).filter((item) => item && fs.statSync(item).isDirectory()))];
  return real.filter((root) => !real.some((other) => other !== root && root.startsWith(other + path.sep)));
}

// The toolkit file a vendored project path mirrors, from the root that holds this skill.
function vendoredSource(rel, skillRoot) {
  for (const [prefix, toolkitPrefix] of VENDOR_PREFIXES) {
    if (rel.startsWith(prefix)) {
      const file = path.join(skillRoot, toolkitPrefix + rel.slice(prefix.length));
      return fs.existsSync(file) ? file : null;
    }
  }
  return null;
}

// execution/toolkit-patches.md: one `## <project path>` heading per patched vendored file, then
// `- reason: ...`, `- unblocks: ...` and a ```diff block. Returns [{ path, reason, unblocks }].
function readPatchList(projectDir) {
  let text;
  try { text = fs.readFileSync(path.join(projectDir, PATCHES_PATH), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const patches = [];
  let current = null;
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = line.match(/^##\s+`?([^`\s]+)`?\s*$/);
    if (heading) { current = { path: heading[1].replace(/^\.\//, ''), reason: null, unblocks: null }; patches.push(current); continue; }
    const field = current && line.match(/^\s*[-*]\s*(reason|unblocks)\s*:\s*(.+)$/i);
    if (field) current[field[1].toLowerCase()] = field[2].trim();
  }
  return patches;
}

function readBaseline(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, BASELINE), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function storeBlob(projectDir, file, hash) {
  const blob = path.join(projectDir, STATE_DIR, 'blobs', hash);
  if (!fs.existsSync(blob)) { fs.mkdirSync(path.dirname(blob), { recursive: true }); fs.copyFileSync(file, blob); }
}

// Hash every installed toolkit root and keep a copy of each file to restore from.
function takeBaseline(projectDir, { runId = null, skillRoot = SKILL_ROOT, now = new Date(), reason = 'run_start', acceptedBy = null } = {}) {
  const roots = toolkitRoots(projectDir, { skillRoot }).map((root) => {
    const files = hashTree(root);
    for (const [rel, hash] of Object.entries(files)) storeBlob(projectDir, path.join(root, rel), hash);
    return { root, files };
  });
  const prior = readBaseline(projectDir);
  const baseline = { schemaVersion: 1, runId, takenAt: now.toISOString(), reason, skillRoot: realOrNull(skillRoot), roots, acceptedVendored: reason === 'accept' ? {} : (prior?.acceptedVendored || {}), patchedVendored: prior?.patchedVendored || {} };
  if (acceptedBy) baseline.acceptedBy = acceptedBy;
  writeJson(path.join(projectDir, BASELINE), baseline);
  return baseline;
}

function quarantine(projectDir, stamp, label, rel, sourceFile, keep = true) {
  if (!keep) return null;
  const target = path.join(projectDir, STATE_DIR, 'quarantine', stamp, label, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(sourceFile, target);
  return path.relative(projectDir, target).split(path.sep).join('/');
}

// Compare against the baseline, restore every difference, and return the incident (or null).
// With restore: false it only reports.
function checkAndRestore(projectDir, { runId = null, stage = null, now = new Date(), restore = true, skillRoot = SKILL_ROOT } = {}) {
  const baseline = readBaseline(projectDir);
  if (!baseline) return null;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const toolkitChanges = [];
  const vendoredChanges = [];
  const patchedChanges = [];
  let failure = null;
  const listed = new Set(readPatchList(projectDir).map((item) => item.path));
  // Each change is quarantined and restored on its own: one failure (a read-only file, a file
  // removed meanwhile) is recorded on that change and the rest still restore.
  const apply = (change, list, steps) => {
    list.push(change);
    try { steps(); } catch (error) { change.restoreError = String(error.message || error).slice(0, 300); }
  };
  try {
    baseline.roots.forEach((entry, index) => {
      const current = hashTree(entry.root);
      const label = `root-${index}`;
      for (const [rel, hash] of Object.entries(entry.files)) {
        const file = path.join(entry.root, rel);
        if (current[rel] === hash) continue;
        const change = { root: entry.root, path: rel, change: current[rel] ? 'modified' : 'deleted', quarantined: null };
        apply(change, toolkitChanges, () => {
          if (current[rel]) change.quarantined = quarantine(projectDir, stamp, label, rel, file, restore);
          if (restore) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.copyFileSync(path.join(projectDir, STATE_DIR, 'blobs', hash), file);
          }
        });
      }
      for (const rel of Object.keys(current)) {
        if (entry.files[rel]) continue;
        const file = path.join(entry.root, rel);
        const change = { root: entry.root, path: rel, change: 'added', quarantined: null };
        apply(change, toolkitChanges, () => {
          change.quarantined = quarantine(projectDir, stamp, label, rel, file, restore);
          if (restore) fs.rmSync(file, { force: true });
        });
      }
    });
    // Vendored copies: any project file under src/lib or src/resources that mirrors a toolkit
    // file must stay byte-identical to it (after the toolkit itself is restored above).
    const skill = baseline.skillRoot || realOrNull(skillRoot);
    for (const rel of listFiles(path.join(projectDir, 'src')).map((item) => `src/${item}`)) {
      const source = skill && vendoredSource(rel, skill);
      if (!source) continue;
      const file = path.join(projectDir, rel);
      let hash; let want;
      try { hash = sha256(fs.readFileSync(file)); want = sha256(fs.readFileSync(source)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (hash === want || baseline.acceptedVendored?.[rel] === hash) continue;
      if (listed.has(rel)) {
        // The agent's own listed fix: kept. Recorded once per content version.
        if (baseline.patchedVendored?.[rel] !== hash) patchedChanges.push({ path: rel, toolkitPath: path.relative(skill, source).split(path.sep).join('/'), change: 'patched-listed', sha256: hash });
        continue;
      }
      const change = { path: rel, toolkitPath: path.relative(skill, source).split(path.sep).join('/'), change: 'drifted', quarantined: null };
      apply(change, vendoredChanges, () => {
        change.quarantined = quarantine(projectDir, stamp, 'vendored', rel, file, restore);
        if (restore) fs.copyFileSync(source, file);
      });
    }
  } catch (error) {
    failure = String(error.message || error).slice(0, 300);
    throw error;
  } finally {
    if (restore && patchedChanges.length) {
      appendIncident(projectDir, { schemaVersion: 1, kind: 'patched', runId, stage, detectedAt: now.toISOString(), restored: false, vendoredChanges: patchedChanges, patchList: PATCHES_PATH });
      baseline.patchedVendored = { ...(baseline.patchedVendored || {}), ...Object.fromEntries(patchedChanges.map((change) => [change.path, change.sha256])) };
      writeJson(path.join(projectDir, BASELINE), baseline);
    }
    // Written even when the scan stops part-way, so every change seen so far is on record.
    if (restore && (toolkitChanges.length || vendoredChanges.length || failure)) {
      appendIncident(projectDir, { schemaVersion: 1, kind: 'restored', runId, stage, detectedAt: now.toISOString(), restored: true, toolkitChanges, vendoredChanges, ...(failure ? { error: failure } : {}) });
    }
  }
  if (!toolkitChanges.length && !vendoredChanges.length) return null;
  return { schemaVersion: 1, kind: 'restored', runId, stage, detectedAt: now.toISOString(), restored: restore, toolkitChanges, vendoredChanges };
}

// The guard itself failed (baseline or check). Recorded so the report says the run was not fully
// guarded; never throws.
function recordGuardError(projectDir, { runId = null, step, stage = null, error, now = new Date() } = {}) {
  try {
    appendIncident(projectDir, { schemaVersion: 1, kind: 'guard_error', runId, step, stage, detectedAt: now.toISOString(), error: String(error?.message || error).slice(0, 300) });
    return true;
  } catch { return false; }
}

function appendIncident(projectDir, incident) {
  const file = path.join(projectDir, INCIDENTS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(incident)}\n`);
}

// A deliberate mid-run patch: the current toolkit becomes the baseline, and the current
// vendored copies that differ from it are allowed. Listed in the report as accepted.
function acceptCurrent(projectDir, { note = null, runId = null, skillRoot = SKILL_ROOT, now = new Date() } = {}) {
  if (!note || !String(note).trim()) throw new Error('accept needs --note: say what was patched and why');
  const prior = readBaseline(projectDir);
  const changed = prior ? checkAndRestore(projectDir, { runId, stage: 'accept', now, restore: false, skillRoot }) : null;
  const baseline = takeBaseline(projectDir, { runId, skillRoot, now, reason: 'accept', acceptedBy: { note: String(note).trim() } });
  const skill = baseline.skillRoot;
  for (const rel of listFiles(path.join(projectDir, 'src')).map((item) => `src/${item}`)) {
    const source = skill && vendoredSource(rel, skill);
    if (!source) continue;
    const hash = sha256(fs.readFileSync(path.join(projectDir, rel)));
    if (hash !== sha256(fs.readFileSync(source))) baseline.acceptedVendored[rel] = hash;
  }
  writeJson(path.join(projectDir, BASELINE), baseline);
  const accepted = { schemaVersion: 1, kind: 'accepted', runId, stage: 'accept', detectedAt: now.toISOString(), note: String(note).trim(), toolkitChanges: changed?.toolkitChanges || [], vendoredChanges: changed?.vendoredChanges || [], acceptedVendored: Object.keys(baseline.acceptedVendored) };
  appendIncident(projectDir, accepted);
  return accepted;
}

function readIncidents(projectDir) {
  let text;
  try { text = fs.readFileSync(path.join(projectDir, INCIDENTS_PATH), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

// Completion-report rows (joined by completion-report.js like the other reportRows producers).
function reportRows(projectDir) {
  const incidents = readIncidents(projectDir);
  const operatorActions = [];
  const restored = incidents.filter((item) => item.kind === 'restored' && item.restored && (item.toolkitChanges.length || item.vendoredChanges.length));
  const restoredPaths = [...new Set(restored.flatMap((item) => [...item.toolkitChanges, ...item.vendoredChanges].filter((change) => !change.restoreError).map((change) => change.path)))].sort();
  if (restoredPaths.length) {
    const paths = restoredPaths;
    const stages = [...new Set(restored.map((item) => item.stage).filter(Boolean))];
    operatorActions.push({
      actionId: 'toolkit-integrity:restored', code: ACTION_CODE, severity: 'medium', role: 'import-operator', entity: null,
      action: `Requires Import Operator: ${paths.length} toolkit file(s) or vendored copies were changed during the run and were restored to the installed toolkit (${restored.length} time(s)${stages.length ? `, after: ${stages.join(', ')}` : ''}). Records written while the changed code ran may need a check. Paths in affectedIds; the changed copies are kept under ${STATE_DIR}/quarantine/.`,
      importOperatorPrompt: `Resolve ${ACTION_CODE}: read ${INCIDENTS_PATH}. For each restored path, compare the quarantined copy (${STATE_DIR}/quarantine/) with the toolkit file. If it was a needed fix to a vendored src/ copy, put it back and list it in ${PATCHES_PATH} (it is then kept). If it was a needed fix to the installed toolkit, report it to the toolkit maintainers, apply it, run \`node <skill>/scripts/toolkit-integrity.js accept --project-dir <project> --note "<what and why>"\`, and resume the affected stage. If not, confirm the stage outputs written after the change still pass their verify step.`,
      deadlineReason: 'before switching traffic; code that ran during the import differed from the reviewed toolkit',
      affectedCount: paths.length, affectedIds: paths, artifactRefs: [INCIDENTS_PATH],
      prerequisites: ['The run has stopped or finished.'],
      resolutionEvidence: 'Each restored path is either accepted with a note or its stage outputs re-verified after the restore.',
    });
  }
  const unrestored = restored.flatMap((item) => [...item.toolkitChanges, ...item.vendoredChanges].filter((change) => change.restoreError).map((change) => change.path));
  const guardErrors = incidents.filter((item) => item.kind === 'guard_error' || (item.kind === 'restored' && item.error));
  if (guardErrors.length || unrestored.length) {
    const stillChanged = [...new Set(unrestored)].sort();
    operatorActions.push({
      actionId: 'toolkit-integrity:guard-error', code: GUARD_ERROR_CODE, severity: 'high', role: 'import-operator', entity: null,
      action: `Requires Import Operator: the toolkit integrity guard did not finish ${guardErrors.length} time(s)${stillChanged.length ? ` and ${stillChanged.length} changed file(s) could not be restored (paths in affectedIds)` : ''}. Code that ran during the import may differ from the reviewed toolkit. Errors: ${[...new Set(guardErrors.map((item) => item.error))].slice(0, 3).join(' | ')}.`,
      importOperatorPrompt: `Resolve ${GUARD_ERROR_CODE}: read the guard_error and restoreError lines in ${INCIDENTS_PATH}. Fix the cause (for example file permissions on the installed toolkit), then run \`node <skill>/scripts/toolkit-integrity.js check --project-dir <project>\`. If it reports changes, reinstall the toolkit or accept a deliberate patch with \`accept --note\`, and re-verify the stages that ran while the guard was off.`,
      deadlineReason: 'before switching traffic; the run was not fully protected against toolkit changes',
      affectedCount: stillChanged.length, affectedIds: stillChanged, artifactRefs: [INCIDENTS_PATH],
      prerequisites: ['The run has stopped or finished.'],
      resolutionEvidence: '`toolkit-integrity.js check` reports no changes, and the affected stages re-verified.',
    });
  }
  const accepted = incidents.filter((item) => item.kind === 'accepted');
  if (accepted.length) {
    const paths = [...new Set(accepted.flatMap((item) => [...item.toolkitChanges.map((change) => change.path), ...item.vendoredChanges.map((change) => change.path), ...(item.acceptedVendored || [])]))].sort();
    operatorActions.push({
      actionId: 'toolkit-integrity:accepted', code: ACCEPTED_CODE, severity: 'low', role: 'cutover-operator', entity: null,
      action: `Cutover Operator: the import ran with ${paths.length} toolkit patch(es) the import operator accepted mid-run (notes: ${accepted.map((item) => item.note).join(' | ')}). No action on the site; keep this with the migration record.`,
      deadlineReason: 'for the record; the patched code differs from the published toolkit',
      affectedCount: paths.length, affectedIds: paths, artifactRefs: [INCIDENTS_PATH],
      resolutionEvidence: 'The note names each patch and why it was needed.',
    });
  }
  // One action per listed in-run patch, so each lands as a toolkit PR.
  const seen = new Map();
  for (const item of incidents.filter((incident) => incident.kind === 'patched')) for (const change of item.vendoredChanges) seen.set(change.path, change.toolkitPath);
  // A scaffold-written fixed file kept by its listed patch is reported as a toolkit gap by the
  // scaffold (lib/toolkit-gaps.js), not here.
  let fixedFiles = new Set();
  try { fixedFiles = new Set((JSON.parse(fs.readFileSync(path.join(projectDir, require('./codegen-scaffold.js').RECORD_PATH), 'utf8')).files || []).map((row) => row.path)); } catch { /* no scaffold record */ }
  for (const patch of readPatchList(projectDir)) {
    if (fixedFiles.has(patch.path)) continue;
    const toolkitPath = seen.get(patch.path) || null;
    operatorActions.push({
      actionId: `toolkit-patched-in-run:${patch.path}`, code: PATCHED_CODE, severity: 'medium', role: 'import-operator', entity: null,
      action: `Requires Import Operator: the run patched its own copy of a toolkit file, ${patch.path}${toolkitPath ? ` (toolkit ${toolkitPath})` : ''}, to get past a toolkit bug: ${patch.reason || 'no reason given'}${patch.unblocks ? `; unblocks ${patch.unblocks}` : ''}. Land the fix in the toolkit so the next run does not need it.`,
      importOperatorPrompt: `Resolve ${PATCHED_CODE} for ${patch.path}: read its entry (reason and diff) in ${PATCHES_PATH}. Check the fix against the toolkit file${toolkitPath ? ` ${toolkitPath}` : ''}, open a toolkit PR with the fix and a test for the case it unblocked, and link the PR here.`,
      deadlineReason: 'not blocking cutover; the import ran on this patched copy and every check ran after it',
      affectedCount: 1, affectedIds: [patch.path], artifactRefs: [PATCHES_PATH, INCIDENTS_PATH],
      resolutionEvidence: 'A toolkit PR that carries the fix and a test.',
    });
  }
  return { operatorActions };
}

module.exports = {
  SKILL_ROOT, STATE_DIR, BASELINE, INCIDENTS_PATH, ACTION_CODE, ACCEPTED_CODE, GUARD_ERROR_CODE, PATCHES_PATH, PATCHED_CODE,
  disabled, readPatchList, toolkitRoots, hashTree, takeBaseline, checkAndRestore, recordGuardError, acceptCurrent, readIncidents, reportRows,
};
