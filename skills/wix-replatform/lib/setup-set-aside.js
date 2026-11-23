'use strict';

// A setup step that only serves entities the mapping set aside (a typed `limitation`, for example
// tax rates while no tax-region executor exists) is not run: nothing imported needs it, and its
// cutover task already exists. Setup records it as passed with method `set-aside-not-needed`, and
// the shared receipt validator recomputes this same rule, so a step any imported entity needs
// can never be skipped this way.
//
// "Serves" = the entity's targetRef plus everything it dependsOn (rp-target-wix entity
// definitions, transitively) and what its own import task writes for it (TASK_COMPANION_HOSTS). A step is skipped only when every one of its entityRefs is served
// by a set-aside entity and by no other entity in the plan.

const fs = require('node:fs');
const path = require('node:path');

const DOMAINS = path.join(__dirname, '..', 'resources', 'rp-target-wix', 'domains');
let dependsOnCache;
function dependsOn(ref) {
  if (!dependsOnCache) dependsOnCache = new Map();
  if (!dependsOnCache.has(ref)) {
    const [domain, entity] = String(ref).split('/');
    let deps = [];
    try { deps = JSON.parse(fs.readFileSync(path.join(DOMAINS, domain, 'entities', `${entity}.json`), 'utf8')).dependsOn || []; } catch { deps = []; }
    dependsOnCache.set(ref, Array.isArray(deps) ? deps.filter((d) => typeof d === 'string') : []);
  }
  return dependsOnCache.get(ref);
}
// Refs only an entity's own import task writes for it: its TASK_COMPANION_HOSTS companions that
// setup cannot make (not `setupProducible`; e.g. a tax rate's region, whose appId is read live in
// the task). A companion setup can make too (a shipping option) keeps its setup step.
function setupProducible(ref) {
  const [domain, entity] = String(ref).split('/');
  try { return JSON.parse(fs.readFileSync(path.join(DOMAINS, domain, 'entities', `${entity}.json`), 'utf8')).setupProducible === true; } catch { return false; }
}
function importOnlyHosts() {
  const hosts = require('../resources/rp-target-wix/lib/wix-writers.js').TASK_COMPANION_HOSTS;
  return Object.fromEntries(Object.entries(hosts).filter(([companion]) => !setupProducible(companion)));
}
function companions(ref) {
  const hosts = importOnlyHosts();
  return Object.keys(hosts).filter((companion) => hosts[companion] === ref);
}
function closure(refs) {
  const out = new Set(), todo = [...refs];
  while (todo.length) { const ref = todo.pop(); if (!ref || out.has(ref)) continue; out.add(ref); todo.push(...dependsOn(ref), ...companions(ref)); }
  return out;
}

function readPlan(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, 'mapping', 'mapping-plan.json'), 'utf8')); } catch { return null; }
}

// Returns { setAsideEntityRefs } when the step only serves set-aside entities, else null.
function setAsideOnlyStep(step, projectDir, plan = readPlan(projectDir)) {
  const refs = Array.isArray(step?.entityRefs) ? step.entityRefs : [];
  if (!refs.length || !plan) return null;
  const contract = require('./mapping-field-contract.js');
  const rows = contract.entityRows(plan).filter((row) => row && typeof row.targetRef === 'string');
  const isAside = (row) => row.fieldMappingStatus === 'pending' && row.limitation !== undefined && !contract.setAsideErrors(row).length;
  const aside = rows.filter(isAside);
  if (!aside.length) return null;
  const served = closure(aside.map((row) => row.targetRef));
  const needed = closure(rows.filter((row) => !isAside(row)).map((row) => row.targetRef));
  if (!refs.every((ref) => served.has(ref) && !needed.has(ref))) return null;
  return { setAsideEntityRefs: aside.filter((row) => refs.some((ref) => closure([row.targetRef]).has(ref))).map((row) => contract.entityRef(row)) };
}

// A step none of whose refs setup has to make: an import task writes each one itself inside its own
// task and setup cannot (importOnlyHosts: a tax rate's region, whose appId is read live in the
// tax-rate task), and that host entity is mapped and not set aside.
// Returns { importTaskRefs } (the hosts), else null. Setup records it as passed with method
// `import-task-writes-it`, and the receipt validator recomputes this rule.
function importOwnedStep(step, projectDir, plan = readPlan(projectDir)) {
  const refs = Array.isArray(step?.entityRefs) ? step.entityRefs : [];
  if (!refs.length || !plan) return null;
  const hosts = importOnlyHosts();
  const contract = require('./mapping-field-contract.js');
  const mapped = new Set(contract.entityRows(plan).filter((row) => row && typeof row.targetRef === 'string' && row.fieldMappingStatus !== 'pending' && row.limitation === undefined).map((row) => row.targetRef));
  if (!refs.every((ref) => Object.hasOwn(hosts, ref) && mapped.has(hosts[ref]))) return null;
  return { importTaskRefs: [...new Set(refs.map((ref) => hosts[ref]))].sort() };
}

module.exports = { setAsideOnlyStep, importOwnedStep };
