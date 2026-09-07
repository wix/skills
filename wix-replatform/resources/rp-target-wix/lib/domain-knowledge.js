'use strict';

const fs = require('node:fs');
const path = require('node:path');
const wixWriters = require('./wix-writers.js');

const CLASSIFICATIONS = new Set([
  'native',
  'cms',
  'native-plus-cms',
  'setup-config',
  'skip-by-default',
  'unsupported-native-gap',
  // For manual-mapping: a complete, decided mapping with no write for our code to make — the entity
  // carries `manualSteps` instead of a working `preferredWrite`. Deliberately not added to
  // NATIVE_CLASSIFICATIONS below: import codegen must never treat this as a write target.
  'manual-mapping',
]);
const ID_POLICIES = new Set(['client-assigned', 'server-assigned', 'natural-key', 'not-applicable']);
const VERIFICATIONS = new Set(['verified-live', 'docs', 'source-review', 'internal-only', 'unverified', 'none']);
const RELIABILITY = new Set(['reliable', 'partially-reliable', 'unreliable', 'unknown']);
const SURVEY_VERDICTS = new Set(['claimed', 'not-importable', 'not-relevant', 'gap', 'unreviewed']);
const NATIVE_CLASSIFICATIONS = new Set(['native', 'native-plus-cms']);
const SAFE_MODE_CONTACT_KINDS = new Set(['email', 'phone']);
const BLOCKED_DEPENDENCY_DEGRADATIONS = new Set(['warning', 'deferred']);
const MANUAL_STEP_ACTORS = new Set(['merchant', 'external', 'wix-automatable']);
const WRITER_IDS = new Set(Object.keys(wixWriters).filter((name) => typeof wixWriters[name] === 'function'));

function knowledgeRoot(rootDir = path.resolve(__dirname, '..')) {
  return path.join(rootDir, 'domains');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function entityRef(entity) {
  return `${entity.domain}/${entity.entity}`;
}

function listDomainDirs(domainsDir) {
  return fs
    .readdirSync(domainsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listEntityFiles(domainDir) {
  const entitiesDir = path.join(domainDir, 'entities');
  if (!fs.existsSync(entitiesDir)) return [];
  return fs
    .readdirSync(entitiesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

function loadDomain(domainsDir, domain) {
  return readJson(path.join(domainsDir, domain, 'domain.json'));
}

function loadEntity(domainsDir, domain, entity) {
  return readJson(path.join(domainsDir, domain, 'entities', `${entity}.json`));
}

function generateIndex(domainsDir) {
  const index = {
    schemaVersion: 1,
    domains: {},
    sourceAliasIndex: {},
    routeAliasIndex: {},
    capabilityIndex: {},
    flags: {},
  };

  for (const domain of listDomainDirs(domainsDir)) {
    const domainPath = path.join(domain, 'domain.json');
    const domainJson = loadDomain(domainsDir, domain);
    const entities = {};
    for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
      const entityId = fileName.replace(/\.json$/, '');
      const entityPath = path.join(domain, 'entities', fileName);
      const entity = readJson(path.join(domainsDir, entityPath));
      entities[entityId] = {
        path: `domains/${entityPath}`,
        displayName: entity.displayName,
        classification: entity.target && entity.target.classification,
        reliabilityStatus: entity.reliability && entity.reliability.status,
        reliabilityFlags: (entity.reliability && entity.reliability.flags) || [],
        summary: firstPitfallOrGuidance(entity),
      };
      if (entity.capability) {
        if (!index.capabilityIndex[entity.capability]) index.capabilityIndex[entity.capability] = [];
        index.capabilityIndex[entity.capability].push(`${domain}/${entityId}`);
      }
      for (const alias of entity.sourceAliases || []) {
        const key = `${alias.sourceSystem}:${alias.sourceEntity}`;
        if (!index.sourceAliasIndex[key]) index.sourceAliasIndex[key] = [];
        index.sourceAliasIndex[key].push(`${domain}/${entityId}`);
        for (const route of alias.routes || []) {
          if (!index.routeAliasIndex[route]) index.routeAliasIndex[route] = [];
          index.routeAliasIndex[route].push(`${domain}/${entityId}`);
        }
      }
      for (const flag of (entity.reliability && entity.reliability.flags) || []) {
        if (!index.flags[flag]) index.flags[flag] = [];
        index.flags[flag].push(`${domain}/${entityId}`);
      }
    }
    index.domains[domain] = {
      path: `domains/${domainPath}`,
      displayName: domainJson.displayName,
      ownerHint: domainJson.ownerHint,
      entities,
    };
  }

  for (const collection of [index.sourceAliasIndex, index.routeAliasIndex, index.capabilityIndex, index.flags]) {
    for (const key of Object.keys(collection)) collection[key] = Array.from(new Set(collection[key])).sort();
  }

  return index;
}

function firstPitfallOrGuidance(entity) {
  if (Array.isArray(entity.pitfalls) && entity.pitfalls[0] && entity.pitfalls[0].summary) {
    return entity.pitfalls[0].summary;
  }
  if (Array.isArray(entity.mappingGuidance) && entity.mappingGuidance[0]) return entity.mappingGuidance[0];
  return '';
}

function validateKnowledge(domainsDir) {
  const errors = [];
  const indexPath = path.join(domainsDir, 'index.json');
  const index = fs.existsSync(indexPath) ? readJson(indexPath) : null;
  const generated = generateIndex(domainsDir);

  if (!fs.existsSync(path.join(domainsDir, 'schema.json'))) {
    errors.push('domains/schema.json is missing');
  }

  for (const domain of listDomainDirs(domainsDir)) {
    const domainFile = path.join(domainsDir, domain, 'domain.json');
    if (!fs.existsSync(domainFile)) {
      errors.push(`${domain}: missing domain.json`);
      continue;
    }
    const domainJson = readJson(domainFile);
    requireFields(domainJson, ['schemaVersion', 'domain', 'displayName', 'ownerHint', 'defaultImportOrder', 'evidence'], `${domain}/domain.json`, errors);
    if (domainJson.schemaVersion !== 1) errors.push(`${domain}/domain.json: schemaVersion must be 1`);
    if (domainJson.domain !== domain) errors.push(`${domain}/domain.json: domain must match directory`);
    for (const entityId of domainJson.defaultImportOrder || []) {
      if (!fs.existsSync(path.join(domainsDir, domain, 'entities', `${entityId}.json`))) {
        errors.push(`${domain}/domain.json: defaultImportOrder references missing entity ${entityId}`);
      }
    }
    validateEvidence(domainJson.evidence || [], `${domain}/domain.json`, errors);

    for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
      const entityId = fileName.replace(/\.json$/, '');
      const entity = loadEntity(domainsDir, domain, entityId);
      const label = `${domain}/entities/${fileName}`;
      validateEntity(entity, domain, entityId, label, errors);
    }

    validateDocsSurvey(domainsDir, domain, domainJson, errors);
  }

  if (!index) {
    errors.push('domains/index.json is missing; run domain-knowledge-validate.js --write-index');
  } else {
    const current = JSON.stringify(index);
    const expected = JSON.stringify(generated);
    if (current !== expected) {
      errors.push('domains/index.json is stale; run domain-knowledge-validate.js --write-index');
    }
    validateIndexConsistency(index, domainsDir, errors);
  }

  validateDependsOn(domainsDir, errors);

  return { ok: errors.length === 0, errors, generatedIndex: generated };
}

// Spec 0041: the dependsOn graph across every entity that has it. Pure disk read, no validation —
// `validateDependsOn` (ref resolution, cycles) and `checkScope` (rp-mapper's review-gate check)
// both build on this so the graph is assembled exactly once, the same way, everywhere it's needed.
function buildDependsOnGraph(domainsDir) {
  const graph = new Map(); // ref -> dependsOn refs
  for (const domain of listDomainDirs(domainsDir)) {
    for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
      const entityId = fileName.replace(/\.json$/, '');
      const entity = loadEntity(domainsDir, domain, entityId);
      if (entity.dependsOn === undefined) continue;
      const ref = `${domain}/${entityId}`;
      graph.set(ref, Array.isArray(entity.dependsOn) ? entity.dependsOn : []);
    }
  }
  return graph;
}

// Spec 0041: dependsOn is optional (58 of 62 entities have never had it authored — see that
// spec's rollout), but when present it must resolve and the graph must stay acyclic. A cycle
// is a hard error (no import order could ever satisfy it); a missing field is not an error at
// all — see listMissingDependsOn for the non-blocking backlog view instead.
// Builds its own local graph rather than calling buildDependsOnGraph afterward — this function
// already reads and parses every entity file once for ref-resolution/array-type checks, so
// reusing that same read for cycle detection (instead of a second full read+parse pass) halves
// the I/O of every `domain-knowledge-validate.js` run.
function validateDependsOn(domainsDir, errors) {
  const graph = new Map();
  for (const domain of listDomainDirs(domainsDir)) {
    for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
      const entityId = fileName.replace(/\.json$/, '');
      const entity = loadEntity(domainsDir, domain, entityId);
      const label = `${domain}/entities/${fileName}`;
      if (entity.dependsOn === undefined) continue;
      if (!Array.isArray(entity.dependsOn)) {
        errors.push(`${label}: dependsOn must be an array when present`);
        continue;
      }
      graph.set(`${domain}/${entityId}`, entity.dependsOn);
      for (const dep of entity.dependsOn) {
        const segments = String(dep).split('/');
        const [depDomain, depEntity] = segments;
        if (segments.length !== 2 || !depDomain || !depEntity || !fs.existsSync(path.join(domainsDir, depDomain, 'entities', `${depEntity}.json`))) {
          errors.push(`${label}: dependsOn entry "${dep}" does not resolve to an entity file`);
        }
      }
    }
  }

  const cycle = findCycle(graph);
  if (cycle) errors.push(`dependsOn graph has a cycle: ${cycle.join(' -> ')}`);
}

function findCycle(graph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const stack = [];

  function visit(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      const state = color.get(next) || WHITE;
      if (state === GRAY) return [...stack, next];
      if (state === WHITE && graph.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of graph.keys()) {
    if ((color.get(node) || WHITE) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

// Every entity ref that actually exists on disk, regardless of whether it has dependsOn authored.
// checkScope needs this to tell "unknown ref" (not in this set) apart from "known but unreviewed"
// (in this set, absent from the dependsOn graph).
function listAllEntityRefs(domainsDir) {
  const refs = [];
  for (const domain of listDomainDirs(domainsDir)) {
    for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
      refs.push(`${domain}/${fileName.replace(/\.json$/, '')}`);
    }
  }
  return refs;
}

// Spec 0041's rp-mapper review-gate check, as a pure function (PR #142 review corrected the first
// implementation, which pushed transitive-closure computation onto the caller and silently passed
// both unknown refs and never-reviewed entities as though they were "reviewed, no dependencies").
// Given every real entity ref, the dependsOn graph, and the plan's own selected scope (only —
// the caller does not pre-expand anything), this walks dependsOn edges outward itself and reports
// three distinct, non-overlapping failure categories. `checkScope` below is the disk-reading
// wrapper `rp-mapper`/an agent/the CLI actually calls.
function computeScopeCheck(allRefs, graph, selectedRefs) {
  const selectedSet = new Set((selectedRefs || []).map((ref) => String(ref)));
  const unknownRefs = new Set(Array.from(selectedSet).filter((ref) => !allRefs.has(ref)));
  const validSelected = Array.from(selectedSet).filter((ref) => allRefs.has(ref));

  const visited = new Set();
  const queue = [...validSelected];
  const unreviewedRefs = [];
  const missingByRef = new Map();

  while (queue.length) {
    const ref = queue.shift();
    if (visited.has(ref)) continue;
    visited.add(ref);

    if (!allRefs.has(ref)) {
      // Reached only via a dependsOn edge (never itself in selectedRefs, or `selectedSet` would
      // already have caught it above) — a dangling/typo'd ref, not merely unreviewed.
      unknownRefs.add(ref);
      continue;
    }

    if (!graph.has(ref)) {
      // Reachable, resolves to a real entity, but dependsOn has never been authored at all —
      // fail-closed: "not yet reviewed" is not the same fact as "reviewed, no dependencies."
      unreviewedRefs.push(ref);
      continue;
    }

    const deps = graph.get(ref);
    const missing = deps.filter((dep) => !selectedSet.has(dep));
    if (missing.length) missingByRef.set(ref, missing);
    for (const dep of deps) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  const missingDependencies = Array.from(missingByRef.entries())
    .map(([ref, missing]) => ({ ref, missing }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  return {
    ok: unknownRefs.size === 0 && missingDependencies.length === 0 && unreviewedRefs.length === 0,
    unknownRefs: Array.from(unknownRefs).sort(),
    missingDependencies,
    unreviewedRefs: unreviewedRefs.sort(),
  };
}

// Disk-reading wrapper — this is what `domain-knowledge-validate.js --check-scope` and rp-mapper's
// review gate should call, passing only the plan's own selected scope. See computeScopeCheck for
// the pure algorithm and spec 0041's "Consumption" decision for why each failure category exists.
function checkScope(domainsDir, selectedRefs) {
  return computeScopeCheck(new Set(listAllEntityRefs(domainsDir)), buildDependsOnGraph(domainsDir), selectedRefs);
}

// Spec 0041's live backlog: every entity that has never had dependsOn authored at all (field
// absent, not merely empty). Non-blocking by design — this is a report, not a validation error.
// `node domain-knowledge-validate.js --list-missing-deps` is the intended way to read it, so the
// backlog never drifts out of sync with a hand-maintained list the way a markdown table would.
function listMissingDependsOn(domainsDir) {
  const missing = [];
  for (const domain of listDomainDirs(domainsDir)) {
    for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
      const entityId = fileName.replace(/\.json$/, '');
      const entity = loadEntity(domainsDir, domain, entityId);
      if (entity.dependsOn === undefined) missing.push(`${domain}/${entityId}`);
    }
  }
  return missing.sort();
}

// Spec 0020: every domain with entities carries a docs survey in which every
// docs-menu surface is triaged, and its native entities cite their object
// page. The backfill completed 2026-08-11, so a missing survey is an error.
function validateDocsSurvey(domainsDir, domain, domainJson, errors) {
  const surveyPath = path.join(domainsDir, domain, 'docs-survey.json');
  const hasEntities = listEntityFiles(path.join(domainsDir, domain)).length > 0;
  if (!fs.existsSync(surveyPath)) {
    if (hasEntities) errors.push(`${domain}: missing docs-survey.json; run docs-survey-sync.js ${domain} and triage`);
    return;
  }

  const label = `${domain}/docs-survey.json`;
  const survey = readJson(surveyPath);
  requireFields(survey, ['schemaVersion', 'domain', 'fetchedAt', 'roots', 'surfaces'], label, errors);
  if (survey.schemaVersion !== 1) errors.push(`${label}: schemaVersion must be 1`);
  if (survey.domain !== domain) errors.push(`${label}: domain must match directory`);

  const declaredRoots = JSON.stringify([...(domainJson.docsRoots || [])].sort());
  const surveyRoots = JSON.stringify([...(survey.roots || [])].sort());
  if (declaredRoots !== surveyRoots) {
    errors.push(`${label}: roots must match ${domain}/domain.json docsRoots; re-run docs-survey-sync.js ${domain}`);
  }

  for (const surface of survey.surfaces || []) {
    const surfaceLabel = `${label}: ${surface.id || '<missing id>'}`;
    requireFields(surface, ['id', 'title', 'url', 'verdict'], surfaceLabel, errors);
    if (surface.removed) {
      errors.push(`${surfaceLabel}: surface no longer in the docs menu; delete the entry or revisit the facts that cited it`);
      continue;
    }
    if (!SURVEY_VERDICTS.has(surface.verdict)) {
      errors.push(`${surfaceLabel}: invalid verdict ${surface.verdict}`);
      continue;
    }
    if (surface.verdict === 'unreviewed') {
      errors.push(`${surfaceLabel}: unreviewed surface; triage it (claimed / not-importable / not-relevant / gap)`);
      continue;
    }
    if (!surface.reviewedOn) errors.push(`${surfaceLabel}: triaged surface must carry reviewedOn`);
    if (surface.verdict === 'claimed') {
      if (!Array.isArray(surface.refs) || surface.refs.length === 0) {
        errors.push(`${surfaceLabel}: claimed surface must list refs[]`);
      } else {
        for (const ref of surface.refs) {
          const [refDomain, refEntity] = String(ref).split('/');
          if (!refDomain || !refEntity || !fs.existsSync(path.join(domainsDir, refDomain, 'entities', `${refEntity}.json`))) {
            errors.push(`${surfaceLabel}: claimed ref ${ref} does not resolve to an entity file`);
          }
        }
      }
    }
    if ((surface.verdict === 'not-importable' || surface.verdict === 'not-relevant') && !surface.reason) {
      errors.push(`${surfaceLabel}: ${surface.verdict} requires a reason`);
    }
    if (surface.verdict === 'gap' && (!surface.reason || !surface.tracking)) {
      errors.push(`${surfaceLabel}: gap requires reason and tracking`);
    }
  }

  for (const fileName of listEntityFiles(path.join(domainsDir, domain))) {
    const entityId = fileName.replace(/\.json$/, '');
    const entity = loadEntity(domainsDir, domain, entityId);
    if (!NATIVE_CLASSIFICATIONS.has(entity.target && entity.target.classification)) continue;
    const citesObjectPage = (entity.evidence || []).some(
      (item) => typeof item.url === 'string' && /-object$/.test(item.url.replace(/\.md$/, ''))
    );
    // A surface with no …-object reference page (e.g. Comments, which has no
    // REST reference at all) declares objectPageException with the reason —
    // explicit and greppable, never silent.
    const hasException = typeof entity.objectPageException === 'string' && entity.objectPageException.length > 0;
    if (!citesObjectPage && !hasException) {
      errors.push(`${domain}/entities/${fileName}: native target must cite its docs object page (…-object URL) in evidence[], or declare objectPageException with a reason`);
    }
  }
}

function requireFields(value, fields, label, errors) {
  for (const field of fields) {
    if (value[field] === undefined) errors.push(`${label}: missing required field ${field}`);
  }
}

function validateEntity(entity, domain, entityId, label, errors) {
  requireFields(entity, ['schemaVersion', 'domain', 'entity', 'displayName', 'target', 'sourceAliases', 'preferredWrite', 'reliability', 'pitfalls', 'mappingGuidance', 'evidence'], label, errors);
  if (entity.schemaVersion !== 1) errors.push(`${label}: schemaVersion must be 1`);
  if (entity.domain !== domain) errors.push(`${label}: domain must match file path`);
  if (entity.entity !== entityId) errors.push(`${label}: entity must match file path`);
  if (!CLASSIFICATIONS.has(entity.target && entity.target.classification)) errors.push(`${label}: invalid target.classification`);
  if (!ID_POLICIES.has(entity.target && entity.target.idPolicy)) errors.push(`${label}: invalid target.idPolicy`);
  if (typeof (entity.target && entity.target.crosswalkRequired) !== 'boolean') errors.push(`${label}: target.crosswalkRequired must be boolean`);
  if (!VERIFICATIONS.has(entity.preferredWrite && entity.preferredWrite.verification)) errors.push(`${label}: invalid preferredWrite.verification`);
  if (!RELIABILITY.has(entity.reliability && entity.reliability.status)) errors.push(`${label}: invalid reliability.status`);
  if (!Array.isArray(entity.reliability && entity.reliability.flags)) errors.push(`${label}: reliability.flags must be an array`);
  if (entity.preferredWrite && entity.preferredWrite.writerId !== null && !WRITER_IDS.has(entity.preferredWrite.writerId)) {
    errors.push(`${label}: writerId ${entity.preferredWrite.writerId} is not exported by wix-writers.js`);
  }
  if (entity.target && entity.target.classification !== 'cms' && entity.target.idPolicy === 'server-assigned' && entity.target.crosswalkRequired !== true) {
    errors.push(`${label}: server-assigned non-CMS targets must require crosswalk`);
  }
  for (const alias of entity.sourceAliases || []) {
    if (!alias.sourceSystem || !alias.sourceEntity) errors.push(`${label}: sourceAliases entries must include sourceSystem and sourceEntity`);
  }
  if (entity.target && entity.target.classification === 'manual-mapping') {
    validateManualMapping(entity, label, errors);
  } else if (entity.manualSteps !== undefined) {
    errors.push(`${label}: manualSteps is only allowed when target.classification is manual-mapping`);
  }
  validateSafeModeContactFields(entity.safeModeContactFields, label, errors);
  validateBlockedSourceDependencies(entity, label, errors);
  validateEvidence(entity.evidence || [], label, errors);
}

function validateBlockedSourceDependencies(entity, label, errors) {
  if (entity.blockedSourceDependencies === undefined) return;
  if (!Array.isArray(entity.blockedSourceDependencies)) {
    errors.push(`${label}: blockedSourceDependencies must be an array when present`);
    return;
  }
  const pitfallCodes = new Set((entity.pitfalls || []).map((pitfall) => pitfall.code));
  const seen = new Set();
  entity.blockedSourceDependencies.forEach((dependency, index) => {
    const dependencyLabel = `${label}: blockedSourceDependencies[${index}]`;
    if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
      errors.push(`${dependencyLabel} must be an object`);
      return;
    }
    for (const field of ['sourceEntityRef', 'degradedField', 'pitfallCode', 'degradation']) {
      if (!dependency[field] || typeof dependency[field] !== 'string') errors.push(`${dependencyLabel}.${field} must be a non-empty string`);
    }
    if (dependency.sourceEntityRef && !/^plugin\.[^.]+\.[^.]+$/.test(dependency.sourceEntityRef)) {
      errors.push(`${dependencyLabel}.sourceEntityRef must use plugin.<slug>.<entity>`);
    }
    if (dependency.pitfallCode && !pitfallCodes.has(dependency.pitfallCode)) {
      errors.push(`${dependencyLabel}.pitfallCode ${dependency.pitfallCode} does not resolve in this entity's pitfalls[]`);
    }
    if (dependency.degradation && !BLOCKED_DEPENDENCY_DEGRADATIONS.has(dependency.degradation)) {
      errors.push(`${dependencyLabel}.degradation must be warning or deferred`);
    }
    const key = `${dependency.sourceEntityRef}:${dependency.degradedField}`;
    if (seen.has(key)) errors.push(`${dependencyLabel} duplicates ${key}`);
    seen.add(key);
  });
}

// For manual-mapping: a manual-mapping entity performs no write, so its preferredWrite must
// be structurally inert (nothing for import codegen to accidentally call), and its manualSteps
// must actually contain a runbook — an empty or missing one would render nothing to the
// merchant, which is worse than not classifying it manual-mapping at all.
function validateManualMapping(entity, label, errors) {
  const pw = entity.preferredWrite || {};
  if (pw.endpoint !== null) errors.push(`${label}: manual-mapping requires preferredWrite.endpoint === null`);
  if (pw.writerId !== null) errors.push(`${label}: manual-mapping requires preferredWrite.writerId === null`);
  if (pw.verification !== 'none') errors.push(`${label}: manual-mapping requires preferredWrite.verification === 'none'`);
  if (pw.importSafe !== false) errors.push(`${label}: manual-mapping requires preferredWrite.importSafe === false`);
  if (pw.bulk !== false) errors.push(`${label}: manual-mapping requires preferredWrite.bulk === false`);

  const manualSteps = entity.manualSteps;
  if (!manualSteps || typeof manualSteps !== 'object') {
    errors.push(`${label}: manual-mapping requires a manualSteps object`);
    return;
  }
  if (!Array.isArray(manualSteps.steps) || manualSteps.steps.length === 0) {
    errors.push(`${label}: manualSteps.steps must be a non-empty array`);
    return;
  }
  manualSteps.steps.forEach((step, index) => {
    if (!step || !MANUAL_STEP_ACTORS.has(step.actor)) {
      errors.push(`${label}: manualSteps.steps[${index}].actor must be one of ${Array.from(MANUAL_STEP_ACTORS).join(', ')}`);
    }
    if (!step || typeof step.text !== 'string' || step.text.trim() === '') {
      errors.push(`${label}: manualSteps.steps[${index}].text must be a non-empty string`);
    }
  });
}

function validateSafeModeContactFields(fields, label, errors) {
  if (fields === undefined) return;
  if (!Array.isArray(fields)) {
    errors.push(`${label}: safeModeContactFields must be an array when present`);
    return;
  }
  for (const [index, field] of fields.entries()) {
    const fieldLabel = `${label}: safeModeContactFields[${index}]`;
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      errors.push(`${fieldLabel} must be an object`);
      continue;
    }
    if (!SAFE_MODE_CONTACT_KINDS.has(field.kind)) errors.push(`${fieldLabel}.kind must be email or phone`);
    if (!field.targetPath || typeof field.targetPath !== 'string') errors.push(`${fieldLabel}.targetPath must be a non-empty string`);
    if (!field.source || typeof field.source !== 'string') errors.push(`${fieldLabel}.source must be a non-empty string`);
  }
}

function validateEvidence(items, label, errors) {
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(`${label}: evidence must be a non-empty array`);
    return;
  }
  for (const item of items) {
    if (!item.url && !item.path) errors.push(`${label}: every evidence item must include url or path`);
  }
}

function validateIndexConsistency(index, domainsDir, errors) {
  const flagged = new Set(index.flags && index.flags.IMPORT_UNRELIABLE ? index.flags.IMPORT_UNRELIABLE : []);
  const entityFlagged = new Set();

  for (const [domain, domainEntry] of Object.entries(index.domains || {})) {
    if (!fs.existsSync(path.join(domainsDir, domain, 'domain.json'))) errors.push(`index: missing domain file for ${domain}`);
    for (const [entityId, entityEntry] of Object.entries(domainEntry.entities || {})) {
      const ref = `${domain}/${entityId}`;
      const entityPath = path.join(domainsDir, domain, 'entities', `${entityId}.json`);
      if (!fs.existsSync(entityPath)) {
        errors.push(`index: missing entity file for ${ref}`);
        continue;
      }
      const entity = readJson(entityPath);
      if ((entity.reliability.flags || []).includes('IMPORT_UNRELIABLE')) entityFlagged.add(ref);
      if (entityEntry.path !== `domains/${domain}/entities/${entityId}.json`) {
        errors.push(`index: invalid path for ${ref}`);
      }
    }
  }

  for (const ref of entityFlagged) {
    if (!flagged.has(ref)) errors.push(`index: ${ref} has IMPORT_UNRELIABLE but is missing from flags`);
  }
  for (const ref of flagged) {
    if (!entityFlagged.has(ref)) errors.push(`index: ${ref} is flagged IMPORT_UNRELIABLE but entity file is not`);
  }
}

function loadIndex(domainsDir) {
  return readJson(path.join(domainsDir, 'index.json'));
}

function listDomains(domainsDir) {
  const index = loadIndex(domainsDir);
  return Object.entries(index.domains || {}).map(([domain, info]) => ({
    domain,
    displayName: info.displayName,
    ownerHint: info.ownerHint,
    path: info.path,
  }));
}

function listEntities(domainsDir, domain) {
  const index = loadIndex(domainsDir);
  const domainInfo = index.domains && index.domains[domain];
  if (!domainInfo) throw new Error(`Unknown domain: ${domain}`);
  return Object.entries(domainInfo.entities || {}).map(([entity, info]) => ({
    ref: `${domain}/${entity}`,
    entity,
    displayName: info.displayName,
    classification: info.classification,
    reliabilityStatus: info.reliabilityStatus,
    reliabilityFlags: info.reliabilityFlags,
    path: info.path,
  }));
}

function readEntityByRef(domainsDir, ref) {
  const [domain, entity] = ref.split('/');
  if (!domain || !entity) throw new Error(`Invalid ref: ${ref}`);
  return loadEntity(domainsDir, domain, entity);
}

function resolveSource(domainsDir, { sourceSystem, sourceEntity, route }) {
  const index = loadIndex(domainsDir);
  const refs = new Set();
  if (sourceSystem && sourceEntity) {
    for (const ref of index.sourceAliasIndex[`${sourceSystem}:${sourceEntity}`] || []) refs.add(ref);
  }
  if (route) {
    for (const [pattern, patternRefs] of Object.entries(index.routeAliasIndex || {})) {
      if (route === pattern || routeMatches(pattern, route)) {
        for (const ref of patternRefs) refs.add(ref);
      }
    }
  }
  return Array.from(refs).sort().map((ref) => {
    const entity = readEntityByRef(domainsDir, ref);
    return {
      ref,
      confidence: bestAliasConfidence(entity, { sourceSystem, sourceEntity, route }),
      sourceAliases: (entity.sourceAliases || []).filter((alias) => aliasMatches(alias, { sourceSystem, sourceEntity, route })),
    };
  });
}

function routeMatches(pattern, route) {
  if (!pattern.includes('{') && !pattern.includes(':')) return false;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+').replace(/:[A-Za-z0-9_-]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`).test(route);
}

function aliasMatches(alias, query) {
  const sourceMatches = (!query.sourceSystem || alias.sourceSystem === query.sourceSystem) && (!query.sourceEntity || alias.sourceEntity === query.sourceEntity);
  const routeMatchesAlias = !query.route || (alias.routes || []).some((pattern) => query.route === pattern || routeMatches(pattern, query.route));
  return sourceMatches && routeMatchesAlias;
}

function bestAliasConfidence(entity, query) {
  const order = { high: 3, medium: 2, low: 1 };
  let best = 'low';
  for (const alias of entity.sourceAliases || []) {
    if (aliasMatches(alias, query) && (order[alias.confidence] || 0) > (order[best] || 0)) best = alias.confidence;
  }
  return best;
}

function listFlagged(domainsDir, flag) {
  const index = loadIndex(domainsDir);
  return (index.flags && index.flags[flag] ? index.flags[flag] : []).map((ref) => {
    const entity = readEntityByRef(domainsDir, ref);
    return {
      ref,
      displayName: entity.displayName,
      classification: entity.target.classification,
      reliabilityStatus: entity.reliability.status,
      summary: firstPitfallOrGuidance(entity),
    };
  });
}

function summarizeEntities(domainsDir, refs, { includeEvidence = false } = {}) {
  return refs.map((ref) => {
    const entity = readEntityByRef(domainsDir, ref);
    const summary = {
      ref,
      displayName: entity.displayName,
      target: entity.target,
      preferredWrite: entity.preferredWrite,
      reliability: entity.reliability,
      pitfalls: entity.pitfalls,
      mappingGuidance: entity.mappingGuidance,
      setupRequirements: entity.setupRequirements || [],
      fieldContracts: entity.fieldContracts || [],
      blockedSourceDependencies: entity.blockedSourceDependencies || [],
      extendedFields: entity.extendedFields || null,
    };
    if (includeEvidence) summary.evidence = entity.evidence;
    return summary;
  });
}

// Compact cross-adapter view consumed by the WordPress plugin knowledge base so plugin
// profiles can be validated against real Wix target refs and capability claims without
// each adapter re-reading the other's tree.
function knowledgeSummary(domainsDir) {
  const index = loadIndex(domainsDir);
  const knownRefs = new Set();
  const verificationByRef = new Map();
  // manual-mapping entities only — lets classifyCoverage tell a manual-mapping
  // target apart from a real write target using only this compact summary, with no need to
  // re-read the full rp-target-wix entity tree from the WordPress side.
  const manualStepsByRef = new Map();
  const blockedSourceDependenciesByRef = new Map();
  for (const [domain, domainEntry] of Object.entries(index.domains || {})) {
    for (const entityId of Object.keys(domainEntry.entities || {})) {
      const ref = `${domain}/${entityId}`;
      knownRefs.add(ref);
      const entity = loadEntity(domainsDir, domain, entityId);
      verificationByRef.set(ref, entity.preferredWrite && entity.preferredWrite.verification);
      if (entity.target && entity.target.classification === 'manual-mapping' && entity.manualSteps) {
        manualStepsByRef.set(ref, entity.manualSteps);
      }
      if (Array.isArray(entity.blockedSourceDependencies) && entity.blockedSourceDependencies.length > 0) {
        blockedSourceDependenciesByRef.set(ref, entity.blockedSourceDependencies);
      }
    }
  }
  const capabilityRefs = new Map(Object.entries(index.capabilityIndex || {}));
  return { knownRefs, capabilityRefs, verificationByRef, manualStepsByRef, blockedSourceDependenciesByRef };
}

module.exports = {
  knowledgeRoot,
  generateIndex,
  knowledgeSummary,
  validateKnowledge,
  validateEntity,
  validateBlockedSourceDependencies,
  buildDependsOnGraph,
  findCycle,
  listAllEntityRefs,
  computeScopeCheck,
  checkScope,
  listMissingDependsOn,
  writeJson,
  listDomains,
  listEntities,
  readEntityByRef,
  resolveSource,
  listFlagged,
  summarizeEntities,
};
