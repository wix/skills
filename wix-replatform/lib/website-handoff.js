'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { readEnvFile } = require('./config-env.js');
const { getDecisionValue, isExplicitUserOneClick } = require('./orchestration-decisions.js');
const { hashArtifact } = require('./artifact-freshness.js');

const SCHEMA_VERSION = 2;
const FRESHNESS_SCHEMA_VERSION = 1;
const HANDOFF_ARTIFACTS = {
  decisions: 'orchestration/decisions.json',
  sourceSchema: 'source-schema.json',
  mappingPlan: 'mapping/mapping-plan.json',
  mappingGaps: 'mapping/review/mapping-gaps.json',
  setupPlan: 'setup/setup-plan.json',
  setupRequirements: 'setup/setup-requirements.json',
  setupBlockers: 'setup/setup-blockers.json',
  wixEnv: 'config/wix.env',
  frontendConfig: 'frontend/wix.config.json',
  completionReport: 'execution/completion-report.json',
};

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readEnvIfExists(filePath) {
  try {
    return await readEnvFile(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function rel(projectDir, targetPath) {
  return path.relative(projectDir, targetPath).replace(/\\/g, '/');
}

function inferMigrationProjectRoot(projectDir) {
  const normalized = path.resolve(projectDir);
  const parent = path.dirname(normalized);
  if (path.basename(parent) === 'migrations') {
    return `migrations/${path.basename(normalized)}`;
  }
  return path.basename(normalized);
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

function handoffFingerprint(inputFreshness) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(inputFreshness)).digest('hex')}`;
}

function uniqueBy(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeSiteStrategy(value) {
  if (value === 'new_site' || value === 'new') return 'new';
  if (value === 'existing_site' || value === 'existing') return 'existing';
  return value || null;
}

function normalizeScopeValue(value) {
  if (typeof value === 'string' && value.trim()) {
    return { scope: value.trim(), explicitUrls: [] };
  }
  if (value && typeof value === 'object') {
    return {
      scope: firstNonEmptyString(value.scope, value.selectedScope),
      explicitUrls: ensureArray(value.explicitUrls).filter((item) => typeof item === 'string' && item.trim()),
    };
  }
  return { scope: null, explicitUrls: [] };
}

function chooseAutoScope(scopeSuggestions) {
  const items = ensureArray(scopeSuggestions);
  const available = new Set(
    items
      .map((item) => (item && typeof item.scope === 'string' ? item.scope.trim() : ''))
      .filter(Boolean),
  );
  for (const scope of ['full', 'ecommerce', 'blog', 'home']) {
    if (available.has(scope)) {
      return scope;
    }
  }
  return 'home';
}

function readEntityMappings(mappingPlan) {
  if (!mappingPlan || typeof mappingPlan !== 'object') return [];
  if (Array.isArray(mappingPlan.entityMappings)) return mappingPlan.entityMappings;
  if (Array.isArray(mappingPlan.mappings)) return mappingPlan.mappings;
  if (mappingPlan.entities && typeof mappingPlan.entities === 'object') {
    return Object.entries(mappingPlan.entities).map(([sourceEntity, value]) => ({
      sourceEntity,
      ...(value || {}),
    }));
  }
  return [];
}

function readSetupRequirements(setupRequirements) {
  if (Array.isArray(setupRequirements)) return setupRequirements;
  if (!setupRequirements || typeof setupRequirements !== 'object') return [];
  if (Array.isArray(setupRequirements.requirements)) return setupRequirements.requirements;
  if (Array.isArray(setupRequirements.items)) return setupRequirements.items;
  return [];
}

function readSetupBlockers(setupBlockers) {
  if (Array.isArray(setupBlockers)) return setupBlockers;
  if (!setupBlockers || typeof setupBlockers !== 'object') return [];
  if (Array.isArray(setupBlockers.blockers)) return setupBlockers.blockers;
  if (Array.isArray(setupBlockers.items)) return setupBlockers.items;
  return [];
}

function readMappingGaps(mappingPlan, mappingGaps) {
  if (Array.isArray(mappingGaps)) return mappingGaps;
  if (mappingGaps && Array.isArray(mappingGaps.gaps)) return mappingGaps.gaps;
  if (mappingPlan && Array.isArray(mappingPlan.faithfulnessLedger)) return mappingPlan.faithfulnessLedger;
  return [];
}

function normalizeAppRequirement(item) {
  if (!item || typeof item !== 'object') return null;
  const appName = firstNonEmptyString(item.appName, item.name, item.app, item.displayName);
  if (!appName) return null;
  return {
    appName,
    appDefId: firstNonEmptyString(item.appDefId, item.appId, item.id),
    purpose: firstNonEmptyString(item.purpose, item.reason, item.description),
    requiredByEntities: ensureArray(item.requiredByEntities || item.requiredBy || item.entities),
    status: firstNonEmptyString(item.status, item.requirementStatus),
    automation: firstNonEmptyString(item.automation, item.automationMode),
    verificationSource: firstNonEmptyString(item.verificationSource, item.source),
  };
}

function normalizeCollectionRequirement(item) {
  if (!item || typeof item !== 'object') return null;
  const collectionName = firstNonEmptyString(item.collectionName, item.name, item.collectionId);
  if (!collectionName) return null;
  return {
    collectionName,
    collectionId: firstNonEmptyString(item.collectionId, item.dataCollectionId),
    collectionPurpose: firstNonEmptyString(item.collectionPurpose, item.purpose, item.description),
    requiredByEntities: ensureArray(item.requiredByEntities || item.requiredBy || item.entities),
    fields: ensureArray(item.fields),
    references: ensureArray(item.references),
    automation: firstNonEmptyString(item.automation, item.automationMode),
    verificationSource: firstNonEmptyString(item.verificationSource, item.source),
  };
}

function routeKindForEntity(mapping) {
  const explicit = firstNonEmptyString(mapping.routeKind, mapping.templateKind);
  if (explicit) return explicit;
  if (mapping.targetStrategy === 'static_page') return 'static';
  if (mapping.targetDomain === 'cms' || mapping.targetDomain === 'stores' || mapping.targetDomain === 'blog') return 'dynamic';
  return 'dynamic';
}

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeRouteIntent(entityMappings) {
  const staticRoutes = [];
  const dynamicRoutes = [];
  const redirectIntents = [];
  const slugPolicies = [];
  const nativeDataSources = [];

  for (const mapping of entityMappings) {
    const urlPolicy = mapping && typeof mapping.urlPolicy === 'object'
      ? mapping.urlPolicy
      : (mapping && typeof mapping.urlPreservation === 'object' ? mapping.urlPreservation : null);
    if (!urlPolicy || urlPolicy.public !== true) {
      continue;
    }

    const route = {
      sourceEntity: firstNonEmptyString(mapping.sourceEntity, mapping.entityName),
      sourceSemantics: firstNonEmptyString(mapping.sourceSemantics),
      targetRef: firstNonEmptyString(mapping.targetRef),
      targetDomain: firstNonEmptyString(mapping.targetDomain),
      targetEntity: firstNonEmptyString(mapping.targetEntity),
      targetClassification: firstNonEmptyString(mapping.targetClassification),
      sourceBasePath: firstNonEmptyString(urlPolicy.sourceBasePath),
      sourceSlugField: firstNonEmptyString(urlPolicy.sourceSlugField),
      sourceUrlField: firstNonEmptyString(urlPolicy.sourceUrlField),
      targetBasePath: firstNonEmptyString(urlPolicy.targetBasePath),
      targetSlugField: firstNonEmptyString(urlPolicy.targetSlugField),
      preserveBasePath: normalizeBoolean(urlPolicy.preserveBasePath),
      preserveSlug: normalizeBoolean(urlPolicy.preserveSlug),
      redirectMode: firstNonEmptyString(urlPolicy.redirectMode),
      routeKind: routeKindForEntity(mapping),
    };

    if (route.routeKind === 'static') {
      staticRoutes.push(route);
    } else {
      dynamicRoutes.push(route);
      nativeDataSources.push({
        sourceEntity: route.sourceEntity,
        targetRef: route.targetRef,
        targetDomain: route.targetDomain,
        targetEntity: route.targetEntity,
        targetClassification: route.targetClassification,
        routeKind: route.routeKind,
        sourceBasePath: route.sourceBasePath,
        targetBasePath: route.targetBasePath,
        preserveSlug: route.preserveSlug,
      });
    }

    slugPolicies.push({
      sourceEntity: route.sourceEntity,
      sourceBasePath: route.sourceBasePath,
      sourceSlugField: route.sourceSlugField,
      targetBasePath: route.targetBasePath,
      targetSlugField: route.targetSlugField,
      preserveBasePath: route.preserveBasePath,
      preserveSlug: route.preserveSlug,
    });

    if (route.redirectMode && route.redirectMode !== 'none') {
      redirectIntents.push({
        sourceEntity: route.sourceEntity,
        sourceBasePath: route.sourceBasePath,
        targetBasePath: route.targetBasePath,
        redirectMode: route.redirectMode,
      });
    }
  }

  return {
    routeIntent: {
      staticRoutes,
      dynamicRoutes,
      redirectIntents,
      slugPolicies,
    },
    nativeDataSources: uniqueBy(nativeDataSources, (item) =>
      [item.targetRef, item.sourceEntity, item.sourceBasePath].filter(Boolean).join('|')),
  };
}

function normalizeRequirementBinding(requirement) {
  if (!requirement || typeof requirement !== 'object') return null;
  return {
    requirementId: firstNonEmptyString(requirement.requirementId, requirement.id),
    requirementClass: firstNonEmptyString(requirement.requirementClass, requirement.class),
    name: firstNonEmptyString(requirement.name),
    requiredBy: ensureArray(requirement.requiredBy),
    expectedState: requirement.expectedState || null,
    automation: firstNonEmptyString(requirement.automation, requirement.automationMode),
    verificationStatus: firstNonEmptyString(requirement.verificationStatus, requirement.status),
    dependencyIds: ensureArray(requirement.dependencyIds),
    notes: firstNonEmptyString(requirement.notes),
  };
}

function extractCmsCollections(setupPlan, setupRequirements) {
  const fromPlan = ensureArray(setupPlan && setupPlan.requiredCollections)
    .map(normalizeCollectionRequirement)
    .filter(Boolean);
  const fromRequirements = readSetupRequirements(setupRequirements)
    .filter((item) => {
      const klass = firstNonEmptyString(item.requirementClass, item.class, item.type);
      return klass && /collection/i.test(klass);
    })
    .map((item) => normalizeCollectionRequirement({
      collectionName: firstNonEmptyString(
        item.collectionName,
        item.name,
        item.expectedState && (item.expectedState.collectionName || item.expectedState.collectionId),
      ),
      collectionId: item.expectedState && firstNonEmptyString(item.expectedState.collectionId),
      collectionPurpose: firstNonEmptyString(item.notes),
      requiredByEntities: ensureArray(item.requiredBy),
      fields: ensureArray(item.expectedState && item.expectedState.fields),
      references: ensureArray(item.expectedState && item.expectedState.references),
      automation: firstNonEmptyString(item.automation, item.automationMode),
      verificationSource: firstNonEmptyString(item.verificationStatus, item.source),
    }))
    .filter(Boolean);
  return uniqueBy([...fromPlan, ...fromRequirements], (item) => item.collectionId || item.collectionName);
}

function extractManualBlockers(setupRequirements, setupBlockers) {
  const blockers = readSetupBlockers(setupBlockers).map((item) => ({
    code: firstNonEmptyString(item.code),
    severity: firstNonEmptyString(item.severity),
    requirementId: firstNonEmptyString(item.requirementId),
    description: firstNonEmptyString(item.description),
    whyBlocked: firstNonEmptyString(item.whyBlocked),
    recommendedAction: firstNonEmptyString(item.recommendedAction),
  }));
  const manualRequirements = readSetupRequirements(setupRequirements)
    .filter((item) => {
      const automation = firstNonEmptyString(item.automation, item.automationMode);
      const verificationStatus = firstNonEmptyString(item.verificationStatus, item.status);
      return automation === 'manual' || automation === 'blocked' || verificationStatus === 'blocked';
    })
    .map((item) => ({
      code: firstNonEmptyString(item.requirementClass, item.class, item.type),
      severity: firstNonEmptyString(item.severity, 'blocker'),
      requirementId: firstNonEmptyString(item.requirementId, item.id),
      description: firstNonEmptyString(item.name, item.notes),
      whyBlocked: firstNonEmptyString(item.notes),
      recommendedAction: firstNonEmptyString(item.recommendedAction),
    }));
  return uniqueBy([...blockers, ...manualRequirements], (item) =>
    item.requirementId || `${item.code || 'blocker'}|${item.description || ''}`);
}

function extractMappingSummary(entityMappings, mappingPlan, mappingGaps) {
  const entities = entityMappings.map((mapping) => ({
    sourceEntity: firstNonEmptyString(mapping.sourceEntity, mapping.entityName),
    sourceSemantics: firstNonEmptyString(mapping.sourceSemantics),
    targetRef: firstNonEmptyString(mapping.targetRef),
    targetDomain: firstNonEmptyString(mapping.targetDomain),
    targetEntity: firstNonEmptyString(mapping.targetEntity),
    targetClassification: firstNonEmptyString(mapping.targetClassification),
    status: firstNonEmptyString(mapping.status),
    urlPolicy: mapping.urlPolicy || null,
  }));
  const gaps = readMappingGaps(mappingPlan, mappingGaps).map((gap) => ({
    code: firstNonEmptyString(gap.code),
    severity: firstNonEmptyString(gap.severity),
    entityName: firstNonEmptyString(gap.entityName, gap.sourceEntity),
    gapType: firstNonEmptyString(gap.gapType),
    description: firstNonEmptyString(gap.description),
    recommendedHandling: firstNonEmptyString(gap.recommendedHandling),
  }));
  return { entities, gaps };
}

function extractLocale(sourceSchema) {
  return firstNonEmptyString(
    sourceSchema && sourceSchema.locale,
    sourceSchema && sourceSchema.language,
    sourceSchema && sourceSchema.sourceMeta && sourceSchema.sourceMeta.locale,
    sourceSchema && sourceSchema.sourceMeta && sourceSchema.sourceMeta.language,
  );
}

function extractDirection(sourceSchema) {
  return firstNonEmptyString(
    sourceSchema && sourceSchema.direction,
    sourceSchema && sourceSchema.sourceMeta && sourceSchema.sourceMeta.direction,
  );
}

function inferWebsiteScopeOptions(routeIntent, mappingSummary) {
  const suggestions = [{ scope: 'home', reason: 'Always available as the minimum storefront continuation scope.' }];
  const dynamicRoutes = ensureArray(routeIntent && routeIntent.dynamicRoutes);
  const sourceEntities = new Set(dynamicRoutes.map((route) => route.sourceEntity).filter(Boolean));
  const mappedEntities = new Set(ensureArray(mappingSummary && mappingSummary.entities).map((entity) => entity.sourceEntity).filter(Boolean));

  const hasEcommerce = sourceEntities.has('product') || sourceEntities.has('product_category');
  const hasBlog = sourceEntities.has('post') || sourceEntities.has('blog_category') || sourceEntities.has('blog_tag');
  const hasCms = Array.from(mappedEntities).some((name) => /^page$|cms|resource|guide/i.test(String(name)));

  if (hasEcommerce) {
    suggestions.push({ scope: 'ecommerce', reason: 'Stores product and/or category routes were discovered in the migration mapping.' });
  }
  if (hasBlog) {
    suggestions.push({ scope: 'blog', reason: 'Blog or knowledge-base post routes were discovered in the migration mapping.' });
  }
  if (hasEcommerce || hasBlog || hasCms) {
    suggestions.push({ scope: 'full', reason: 'Multiple public route families were discovered, so a fuller storefront clone may be appropriate.' });
  }
  suggestions.push({ scope: 'specific', reason: 'Use explicit URLs when the user wants a curated subset of pages instead of a broad area.' });
  return uniqueBy(suggestions, (item) => item.scope);
}

function buildFrontendProjectDir(projectDir, frontendConfigPath) {
  if (frontendConfigPath) {
    return rel(projectDir, path.dirname(frontendConfigPath));
  }
  return 'frontend';
}

function createInputFreshness(projectDir) {
  const artifacts = {};
  for (const [name, relativePath] of Object.entries(HANDOFF_ARTIFACTS)) {
    artifacts[name] = {
      path: relativePath,
      sha256: hashArtifact(projectDir, relativePath),
    };
  }
  return {
    schemaVersion: FRESHNESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifacts,
  };
}

function compareInputFreshness(current, recorded) {
  const changes = [];
  if (!recorded || typeof recorded !== 'object') {
    return { ok: false, stale: true, changes: [{ field: 'inputFreshness', reason: 'missing' }] };
  }
  if (recorded.schemaVersion !== FRESHNESS_SCHEMA_VERSION) {
    changes.push({
      field: 'inputFreshness.schemaVersion',
      expected: recorded.schemaVersion,
      actual: FRESHNESS_SCHEMA_VERSION,
    });
  }
  for (const [name, currentEntry] of Object.entries(current.artifacts || {})) {
    const recordedEntry = (recorded.artifacts && recorded.artifacts[name]) || {};
    if (currentEntry.sha256 !== recordedEntry.sha256) {
      changes.push({
        field: `inputFreshness.artifacts.${name}.sha256`,
        path: currentEntry.path,
        expected: recordedEntry.sha256 || null,
        actual: currentEntry.sha256 || null,
      });
    }
  }
  return {
    ok: changes.length === 0,
    stale: changes.length > 0,
    changes,
  };
}

function renderSummary(handoff) {
  const lines = [
    '# Website Handoff Summary',
    '',
    `Generated: ${handoff.generatedAt}`,
    '',
    `- Delivery mode: ${handoff.deliveryMode}`,
    `- Website scope: ${handoff.websiteScope.selectedScope || 'not yet selected'}`,
    `- Destination strategy: ${handoff.destination.siteStrategy || 'unknown'}`,
    `- Destination site id: ${handoff.destination.siteId || 'not yet resolved'}`,
    `- Frontend phase allowed now: ${handoff.frontendPhase.allowedNow}`,
    '',
    '## Scope Suggestions',
    '',
  ];

  if (handoff.websiteScope.scopeSuggestions.length === 0) {
    lines.push('- None.');
  } else {
    for (const suggestion of handoff.websiteScope.scopeSuggestions) {
      lines.push(`- ${suggestion.scope}: ${suggestion.reason}`);
    }
  }

  lines.push(
    '',
    '## Dynamic Route Families',
    '',
  );

  if (handoff.routeIntent.dynamicRoutes.length === 0) {
    lines.push('- None declared yet.');
  } else {
    for (const route of handoff.routeIntent.dynamicRoutes) {
      lines.push(
        `- ${route.sourceEntity || 'unknown'} -> ${route.targetRef || [route.targetDomain, route.targetEntity].filter(Boolean).join('/')} ` +
        `(source base path: ${route.sourceBasePath || 'n/a'}, target base path: ${route.targetBasePath || 'deferred'})`,
      );
    }
  }

  lines.push('', '## Wix Bindings', '');
  if (handoff.bindings.wixApps.length === 0) {
    lines.push('- No Wix app bindings declared.');
  } else {
    for (const app of handoff.bindings.wixApps) {
      lines.push(`- ${app.appName}${app.appDefId ? ` (${app.appDefId})` : ''}`);
    }
  }

  lines.push('', '## CMS Collections', '');
  if (handoff.bindings.cmsCollections.length === 0) {
    lines.push('- No CMS collections declared.');
  } else {
    for (const collection of handoff.bindings.cmsCollections) {
      lines.push(`- ${collection.collectionName}`);
    }
  }

  lines.push('', '## Manual Blockers', '');
  if (handoff.setupContract.manualBlockers.length === 0) {
    lines.push('- None.');
  } else {
    for (const blocker of handoff.setupContract.manualBlockers) {
      lines.push(`- ${blocker.requirementId || blocker.code || 'blocker'}: ${blocker.description || blocker.whyBlocked || 'see setup artifacts'}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function writeFileAtomic(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, text, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function generateWebsiteHandoff(projectDir) {
  const handoffDir = path.join(projectDir, 'website');
  const decisionsPath = path.join(projectDir, HANDOFF_ARTIFACTS.decisions);
  const sourceSchemaPath = path.join(projectDir, HANDOFF_ARTIFACTS.sourceSchema);
  const mappingPlanPath = path.join(projectDir, HANDOFF_ARTIFACTS.mappingPlan);
  const mappingGapsPath = path.join(projectDir, HANDOFF_ARTIFACTS.mappingGaps);
  const setupPlanPath = path.join(projectDir, HANDOFF_ARTIFACTS.setupPlan);
  const setupRequirementsPath = path.join(projectDir, HANDOFF_ARTIFACTS.setupRequirements);
  const setupBlockersPath = path.join(projectDir, HANDOFF_ARTIFACTS.setupBlockers);
  const wixEnvPath = path.join(projectDir, HANDOFF_ARTIFACTS.wixEnv);
  const frontendConfigPath = path.join(projectDir, HANDOFF_ARTIFACTS.frontendConfig);
  const completionReportPath = path.join(projectDir, HANDOFF_ARTIFACTS.completionReport);

  const decisions = await readJsonIfExists(decisionsPath);
  let sourceSchema = await readJsonIfExists(sourceSchemaPath);
  let mappingPlan = await readJsonIfExists(mappingPlanPath);
  const quickPlan = await readJsonIfExists(path.join(projectDir, 'quick-mode', 'plan.json'));
  const mappingGaps = await readJsonIfExists(mappingGapsPath);
  const setupPlan = await readJsonIfExists(setupPlanPath);
  const setupRequirements = await readJsonIfExists(setupRequirementsPath);
  const setupBlockers = await readJsonIfExists(setupBlockersPath);
  const wixEnv = await readEnvIfExists(wixEnvPath);
  const frontendConfig = await readJsonIfExists(frontendConfigPath);
  const completionReportExists = await pathExists(completionReportPath);

  const deliveryMode = firstNonEmptyString(
    getDecisionValue(decisions || {}, 'deliveryMode'),
    wixEnv.WIX_DELIVERY_MODE,
  );
  if (!deliveryMode) {
    throw new Error('website handoff requires deliveryMode to be decided');
  }
  if (!sourceSchema && quickPlan) sourceSchema = { sourceUrl: quickPlan.sourceUrl, platform: quickPlan.adapter?.id?.replace(/^quick-/, '') };
  if (!mappingPlan && quickPlan) mappingPlan = { entities: (quickPlan.entities || []).map((entity) => ({ sourceEntity: entity.id, target: entity.target })) };
  if (!sourceSchema) {
    throw new Error('website handoff requires source-schema.json');
  }
  if (!mappingPlan) {
    throw new Error('website handoff requires mapping/mapping-plan.json');
  }
  if (!setupPlan) {
    throw new Error('website handoff requires setup/setup-plan.json');
  }
  if (!setupRequirements) {
    throw new Error('website handoff requires setup/setup-requirements.json');
  }

  const entityMappings = readEntityMappings(mappingPlan);
  const apps = uniqueBy(
    ensureArray(setupPlan.requiredApps).map(normalizeAppRequirement).filter(Boolean),
    (item) => item.appDefId || item.appName,
  );
  const { routeIntent, nativeDataSources } = normalizeRouteIntent(entityMappings);
  const cmsCollections = extractCmsCollections(setupPlan, setupRequirements);
  const mappingSummary = extractMappingSummary(entityMappings, mappingPlan, mappingGaps);
  const manualBlockers = extractManualBlockers(setupRequirements, setupBlockers);
  const frontendConfigAbsolute = frontendConfig ? frontendConfigPath : null;
  const inputFreshness = createInputFreshness(projectDir);
  const automationMode = isExplicitUserOneClick(decisions || {}) ? 'one_click' : 'manual';
  const faceliftMode = getDecisionValue(decisions || {}, 'faceliftMode');
  const scopeDecision = normalizeScopeValue(getDecisionValue(decisions || {}, 'websiteScope'));
  const scopeSuggestions = inferWebsiteScopeOptions(routeIntent, mappingSummary);
  const autoSelectedScope = !scopeDecision.scope && deliveryMode === 'management_and_website' && automationMode === 'one_click'
    ? chooseAutoScope(scopeSuggestions)
    : null;
  const selectedScope = scopeDecision.scope || autoSelectedScope;

  const handoff = {
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    generatedAt: new Date().toISOString(),
    migrationProject: {
      name: path.basename(projectDir),
      root: inferMigrationProjectRoot(projectDir),
    },
    source: {
      url: firstNonEmptyString(
        sourceSchema.sourceUrl,
        getDecisionValue(decisions || {}, 'sourceUrl'),
      ),
      platform: firstNonEmptyString(
        sourceSchema.platform,
        getDecisionValue(decisions || {}, 'sourcePlatform'),
      ),
      locale: extractLocale(sourceSchema),
      direction: extractDirection(sourceSchema),
    },
    deliveryMode,
    automationMode: automationMode || 'manual',
    facelift: {
      requested: faceliftMode === 'requested',
      requestedBy: faceliftMode === 'requested' ? 'user' : null,
      constraints: ['preserve_brand_identity', 'preserve_site_structure', 'preserve_content'],
    },
    websiteScope: {
      selectedScope,
      explicitUrls: scopeDecision.explicitUrls,
      scopeSuggestions,
      selectedFromDecision: Boolean(scopeDecision.scope),
      autoSelectedInOneClickMode: Boolean(autoSelectedScope),
      defaultStandaloneScope: 'home',
    },
    destination: {
      siteStrategy: normalizeSiteStrategy(
        firstNonEmptyString(
          getDecisionValue(decisions || {}, 'targetSiteStrategy'),
          wixEnv.WIX_SITE_STRATEGY,
        ),
      ),
      siteId: firstNonEmptyString(wixEnv.WIX_SITE_ID),
      appId: firstNonEmptyString(
        frontendConfig && (frontendConfig.appId || frontendConfig.applicationId),
        wixEnv.WIX_APP_ID,
      ),
      frontendProjectDir: buildFrontendProjectDir(projectDir, frontendConfigAbsolute),
    },
    frontendPhase: {
      allowedNow: completionReportExists ? 'build' : 'plan',
      buildAllowedAfter: 'backend-import-complete',
      parallelPlanAllowed: true,
      recommendedParallelExecution: 'subagent_after_handoff',
    },
    routeIntent,
    bindings: {
      wixApps: apps,
      cmsCollections,
      nativeDataSources,
    },
    setupContract: {
      requiredApps: apps,
      collections: cmsCollections,
      manualBlockers,
    },
    mappingSummary,
    artifacts: {
      mappingPlan: HANDOFF_ARTIFACTS.mappingPlan,
      setupRequirements: HANDOFF_ARTIFACTS.setupRequirements,
      setupPlan: HANDOFF_ARTIFACTS.setupPlan,
      urlPreservationState: 'state/url-preservation/',
    },
    inputFreshness,
    handoffFingerprint: handoffFingerprint(inputFreshness),
  };

  const summary = renderSummary(handoff);
  const handoffPath = path.join(handoffDir, 'handoff.json');
  const summaryPath = path.join(handoffDir, 'handoff-summary.md');
  await writeFileAtomic(handoffPath, `${stableJson(handoff)}\n`);
  await writeFileAtomic(summaryPath, summary);

  return {
    handoffPath,
    summaryPath,
    handoff,
  };
}

async function validateWebsiteHandoff(projectDir) {
  const handoffPath = path.join(projectDir, 'website', 'handoff.json');
  const handoff = await readJsonIfExists(handoffPath);
  if (!handoff) {
    return {
      ok: false,
      present: false,
      stale: true,
      changes: [{ field: 'website/handoff.json', reason: 'missing' }],
      handoff: null,
    };
  }
  const current = createInputFreshness(projectDir);
  const comparison = compareInputFreshness(current, handoff.inputFreshness);
  return {
    ok: comparison.ok,
    present: true,
    stale: comparison.stale,
    changes: comparison.changes,
    handoff,
    current,
  };
}

module.exports = {
  SCHEMA_VERSION,
  HANDOFF_ARTIFACTS,
  handoffFingerprint,
  createInputFreshness,
  compareInputFreshness,
  generateWebsiteHandoff,
  validateWebsiteHandoff,
};
