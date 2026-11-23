'use strict';

// Blocked-data requests the toolkit builds at the mapping stage entry (rp-mapper "Blocked source
// dependencies"), so the mapper never has to. Fully mechanical:
//   the plan's selected Wix targets x their authored `blockedSourceDependencies` (rp-target-wix
//   knowledge) x the plugins discovery found (census `plugin:<slug>` rows),
// minus a source entity the plan maps as its own entity (structure-bridge planning partition).
// Each source plugin's `blocked[].fulfillment` is offered only when its handler self-test passes.
// The stage entry never asks, so `askedInteractively` is false (a request already shown to a human
// keeps its true). Writes state/blocked-data-requests/<ref>.json and
// mapping/review/blocked-data-requests.md through lib/blocked-data-requests.js.
// The builder is async (handler self-tests), so the sync stage entry runs this file as a child.

const fs = require('node:fs');
const path = require('node:path');

const RESOURCES = path.join(__dirname, '..', 'resources');
const DOMAINS_DIR = path.join(RESOURCES, 'rp-target-wix', 'domains');
const PLUGINS_DIR = path.join(RESOURCES, 'rp-source-wordpress', 'plugins');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const pluginSlugOf = (sourceEntityRef) => String(sourceEntityRef).split('.')[1] || null;

// Every Wix target the plan writes or binds.
function planTargets(plan) {
  const refs = new Set();
  const add = (ref) => { if (typeof ref === 'string' && ref.includes('/')) refs.add(ref); };
  for (const e of [...(plan.entities || []), ...(plan.entityMappings || [])]) {
    if (!e || e.limitation) continue;
    add(e.targetRef);
    for (const row of e.fieldMappings || []) for (const out of (row && row.outputs) || []) add(out && out.targetRef);
  }
  for (const b of Array.isArray(plan.dependencyBindings) ? plan.dependencyBindings : []) add(b && b.ref);
  return refs;
}

function pluginsFound(census) {
  const slugs = new Set();
  for (const row of (census && census.rows) || []) {
    if (row && row.kind === 'plugin') slugs.add(String(row.censusId).replace(/^plugin:/, ''));
    for (const p of (row && row.plugins) || []) slugs.add(String(p).split('/')[0]);
  }
  return slugs;
}

// Source entities the plan maps as their own entity (not set aside): never also a blocked field.
function plannedSources(plan) {
  return (plan.entities || []).filter((e) => e && !e.limitation && (e.targetRef || (e.fieldMappings || []).length))
    .map((e) => ({ sourceEntityRef: e.sourceEntityRef || e.sourceEntity, supersedesBlockedDependencies: [] }));
}

async function buildStageBlockedDataRequests(projectDir) {
  const step = 'blocked-data-requests';
  const plan = readJson(path.join(projectDir, 'mapping', 'mapping-plan.json'));
  if (!plan) return { step, skipped: 'no-plan' };
  const found = pluginsFound(readJson(path.join(projectDir, 'discovery', 'census.json')));
  if (!found.size) return { step, skipped: 'no-plugins-found' };
  const { readEntityByRef } = require(path.join(RESOURCES, 'rp-target-wix', 'lib', 'domain-knowledge.js'));
  const targets = [];
  for (const ref of planTargets(plan)) {
    let entity;
    try { entity = readEntityByRef(DOMAINS_DIR, ref); } catch { continue; }
    const deps = (entity.blockedSourceDependencies || []).filter((d) => found.has(pluginSlugOf(d.sourceEntityRef)));
    if (deps.length) targets.push({ ...entity, ref, blockedSourceDependencies: deps });
  }
  if (!targets.length) return { step, skipped: 'no-blocked-dependencies' };
  const { partitionBlockedSourceDependencies } = require(path.join(RESOURCES, 'rp-mapper', 'lib', 'structure-bridge-planning.js'));
  const { targetEntities } = partitionBlockedSourceDependencies(targets, plannedSources(plan));
  const { loadProfiles } = require(path.join(RESOURCES, 'rp-source-wordpress', 'lib', 'plugin-knowledge.js'));
  const sourceEntitiesByRef = new Map();
  for (const profile of loadProfiles(PLUGINS_DIR)) {
    if (!found.has(profile.plugin)) continue;
    for (const e of profile.entities || []) sourceEntitiesByRef.set(`plugin.${profile.plugin}.${e.entity}`, e);
  }
  const blocked = require('./blocked-data-requests.js');
  const dir = path.join(projectDir, 'state', 'blocked-data-requests');
  const existingRequests = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((name) => name.endsWith('.json') && !name.includes('.extraction.v')).map((name) => readJson(path.join(dir, name))).filter(Boolean);
  const { fulfillmentReadiness } = require(path.join(RESOURCES, 'rp-source-wordpress', 'lib', 'blocked-data-handlers.js'));
  const requests = await blocked.buildBlockedDataRequests({ targetEntities, sourceEntitiesByRef, existingRequests, readiness: fulfillmentReadiness, askedInteractively: false });
  if (!requests.length) return { step, skipped: 'planned-as-entities' };
  await blocked.writeBlockedDataRequestArtifacts(projectDir, requests);
  return { step, requests: requests.map((r) => r.sourceEntityRef), file: 'mapping/review/blocked-data-requests.md' };
}

// Sync wrapper for the stage entry.
function prepareBlockedDataRequests(projectDir) {
  const out = require('node:child_process').execFileSync(process.execPath, [__filename, '--project-dir', projectDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

if (require.main === module) {
  const i = process.argv.indexOf('--project-dir');
  buildStageBlockedDataRequests(path.resolve(process.argv[i + 1]))
    .then((out) => process.stdout.write(`${JSON.stringify(out)}\n`))
    .catch((error) => { process.stderr.write(`${(error && error.message) || error}\n`); process.exit(1); });
}

module.exports = { buildStageBlockedDataRequests, prepareBlockedDataRequests, planTargets, pluginsFound };
