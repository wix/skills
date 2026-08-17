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
]);
const ID_POLICIES = new Set(['client-assigned', 'server-assigned', 'natural-key', 'not-applicable']);
const VERIFICATIONS = new Set(['verified-live', 'docs', 'source-review', 'internal-only', 'unverified', 'none']);
const RELIABILITY = new Set(['reliable', 'partially-reliable', 'unreliable', 'unknown']);
const SAFE_MODE_CONTACT_KINDS = new Set(['email', 'phone']);
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

  for (const collection of [index.sourceAliasIndex, index.routeAliasIndex, index.flags]) {
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

  return { ok: errors.length === 0, errors, generatedIndex: generated };
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
  validateSafeModeContactFields(entity.safeModeContactFields, label, errors);
  validateEvidence(entity.evidence || [], label, errors);
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
    };
    if (includeEvidence) summary.evidence = entity.evidence;
    return summary;
  });
}

module.exports = {
  knowledgeRoot,
  generateIndex,
  validateKnowledge,
  writeJson,
  listDomains,
  listEntities,
  readEntityByRef,
  resolveSource,
  listFlagged,
  summarizeEntities,
};
