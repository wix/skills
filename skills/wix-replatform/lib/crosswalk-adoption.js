'use strict';

// Seeds the standard crosswalk (state/crosswalk/crosswalk.ndjson) from a quick-mode crosswalk
// (state/crosswalk/<adapter id>.json: `{ <section>: { <source id>: <Wix id> } }`) so an adopt-only
// import task (mapping `writeMode: "adopt-only-no-writes"`) resolves the products/categories the
// quick pass already created instead of re-creating them.
//
// Deterministic and idempotent: a row already present is never overwritten (same target = already
// adopted, different target = reported conflict), and a Wix id claimed by two source ids is reported
// and not written. A seeded row asserts only "the quick pass recorded this id"; the adopt-only task
// verifies each one with a read by id before it reports the key ready. Nothing here reads or writes
// the source or Wix.

const fs = require('node:fs');
const path = require('node:path');
const local = require('./local-state');
const { readEntityMappings } = require('./website-handoff');

const ADOPT_ONLY = 'adopt-only-no-writes';
const SECTION_SUFFIX = '_candidate';
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
};

// `gid://<app>/<Type>/<id>[?query]` -> `<id>`; any other id is kept as a string.
function normalizeSourceId(id) {
  const text = String(id);
  const match = /^gid:\/\/[^/]+\/[^/]+\/([^/?]+)(?:\?.*)?$/.exec(text);
  return match ? match[1] : text;
}

// One binding per adopted ref: the quick sections that hold its rows and the exact key the standard
// importer uses for it (`keyPrefix + id`, as the readiness gate builds it from the task's source binding).
function deriveBindings(projectDir, { contract, sourceSystem } = {}) {
  const plan = readJson(path.join(projectDir, 'mapping', 'mapping-plan.json'));
  const manifest = readJson(path.join(projectDir, 'execution', 'execution-manifest.json'), { tasks: [] });
  const bound = new Map();
  for (const task of manifest.tasks || []) if (task.adoptOnly === true) for (const source of task.sourceBindings || []) bound.set(source.ref, source);
  const platform = readJson(path.join(projectDir, 'source-schema.json'), {}).platform;
  const bindings = [];
  for (const row of readEntityMappings(plan)) {
    if (row.writeMode !== ADOPT_ONLY || typeof row.targetRef !== 'string' || typeof row.sourceEntity !== 'string') continue;
    const entity = (contract?.entities || []).find(candidate => candidate.target === row.targetRef);
    if (!entity) continue;
    // The manifest's binding wins when codegen has run; before that the convention `<sourceEntity>:` applies.
    const source = bound.get(row.targetRef);
    bindings.push({
      ref: row.targetRef, sections: [entity.id, entity.id + SECTION_SUFFIX],
      sourceSystem: sourceSystem || platform || 'source', sourceEntityType: source?.sourceEntity || row.sourceEntity,
      targetEntityType: row.targetRef.split('/')[1], keyPrefix: source?.keyPrefix || `${row.sourceEntity}:`,
    });
  }
  return bindings;
}

function entries(crosswalk, binding) {
  const found = new Map(), candidateOnly = new Set(); let skippedEmpty = 0;
  for (const [index, section] of (binding.sections || []).entries()) {
    for (const [rawId, targetId] of Object.entries(crosswalk[section] || {})) {
      if (typeof targetId !== 'string' || !targetId) { skippedEmpty++; continue; }
      const id = normalizeSourceId(rawId);
      if (found.has(id)) { if (found.get(id) !== targetId) found.set(id, null); continue; }
      found.set(id, targetId); if (index > 0) candidateOnly.add(id);
    }
  }
  return { found, candidateOnly, skippedEmpty };
}

async function adoptCrosswalk({ projectDir, sourceFile, bindings, siteId, dryRun = false, adoptedFrom = 'quick-mode', now = new Date() }) {
  if (!projectDir || !sourceFile || !Array.isArray(bindings) || !bindings.length) throw new Error('crosswalk_adoption_input_invalid');
  if (!dryRun && !siteId) throw new Error('crosswalk_adoption_site_required');
  const crosswalk = readJson(sourceFile, undefined);
  const existing = await local.loadCrosswalk(projectDir);
  const claimed = new Map(existing.rows.map(row => [row.targetId, row.sourceStableKey]));
  const rows = [], summary = { dryRun, adoptedFrom, bindings: [], conflicts: [] };
  for (const binding of bindings) {
    for (const field of ['ref', 'sourceSystem', 'sourceEntityType', 'targetEntityType', 'keyPrefix']) if (typeof binding[field] !== 'string' || !binding[field]) throw new Error(`crosswalk_adoption_binding_invalid:${field}`);
    const { found, candidateOnly, skippedEmpty } = entries(crosswalk, binding);
    const sharedTarget = new Map(); for (const targetId of found.values()) if (targetId) sharedTarget.set(targetId, (sharedTarget.get(targetId) || 0) + 1);
    const count = { ref: binding.ref, keyPrefix: binding.keyPrefix, seeded: 0, alreadyAdopted: 0, candidateOnly: 0, skippedEmpty, conflicts: 0 };
    for (const [id, targetId] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
      const sourceStableKey = binding.keyPrefix + id, present = existing.bySource[sourceStableKey];
      const conflict = !targetId ? 'source_section_disagree' : sharedTarget.get(targetId) > 1 ? 'target_shared_by_sources'
        : present && present.targetId !== targetId ? 'existing_row_differs' : !present && claimed.has(targetId) ? 'target_claimed_by_other_row' : null;
      if (conflict) { count.conflicts++; summary.conflicts.push({ ref: binding.ref, sourceStableKey, reason: conflict }); continue; }
      if (present) { count.alreadyAdopted++; continue; }
      count.seeded++; if (candidateOnly.has(id)) count.candidateOnly++;
      claimed.set(targetId, sourceStableKey);
      rows.push({ schemaVersion: 1, sourceSystem: binding.sourceSystem, sourceEntityType: binding.sourceEntityType, sourceId: id, sourceStableKey,
        targetSystem: 'wix', targetEntityType: binding.targetEntityType, targetId, status: 'imported', ...(siteId ? { siteId } : {}),
        updatedAt: now.toISOString(), adoptedFrom, adoptedSection: candidateOnly.has(id) ? binding.sections[1] : binding.sections[0] });
    }
    summary.bindings.push(count);
  }
  if (!dryRun && rows.length) await local.updateCrosswalkRows(projectDir, rows);
  summary.seeded = rows.length; summary.wrote = !dryRun && rows.length > 0; summary.ok = summary.conflicts.length === 0;
  return summary;
}

module.exports = { adoptCrosswalk, deriveBindings, normalizeSourceId };
