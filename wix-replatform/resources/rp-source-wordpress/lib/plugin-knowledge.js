'use strict';

// Plugin profile knowledge base: load, validate, index, and resolve WordPress plugin profiles.
//
// THIS FILE IS THE AUTHORITY on a profile's shape. There is deliberately no schema.json: a
// second, non-enforcing definition of the same contract only drifts out of sync. The human
// field reference lives in plugins/README.md and cites this validator. Mirrors rp-target-wix/lib/domain-knowledge.js so both knowledge bases have the
// same shape, the same generated+checked-in index, and the same validate/read split.
//
// Profiles are ADVISORY. They identify a plugin and declare where its data lives; the live
// OPTIONS/GET probe in wp-discovery.js remains authoritative for what a route actually
// returns. A stale profile can therefore only reduce detection completeness.

const fs = require('node:fs');
const path = require('node:path');

const CHANNELS = new Set([
  'plugin-rest',
  'core-cpt',
  'core-embedded',
  'core-meta',
  'plugin-rest-child',
  'export-file',
  'db-only',
  'admin-page-only',
]);
const ROUTE_CHANNELS = new Set(['plugin-rest', 'core-cpt']);
// A {parentId} placeholder in `route` — never a literal REST index route, so
// plugin-rest-child stays out of ROUTE_CHANNELS (which feeds classifier data rules matched
// against literal candidate routes; a templated route never appears as one).
const CHILD_ROUTE_PLACEHOLDER = '{parentId}';
const DISTRIBUTIONS = new Set(['wordpress-org', 'premium-or-unlisted', 'unknown']);
const SEVERITIES = new Set(['blocker', 'warning', 'info']);
const CONTEXTS = new Set(['view', 'edit', 'both']);
const REQUEST_METHODS = new Set(['GET', 'POST']);
const BLOCKED_KINDS = new Set(['user-file', 'bridge-plugin']);
const FULFILLMENT_KINDS = new Set(['csv-upload', 'bridge-plugin']);

const RESERVED_FILES = new Set([
  'schema.json',
  'index.json',
  'requires-development.json',
  'capabilities-pending-decision.json',
  'no-migration-needed.json',
  'fingerprint-aliases.json',
]);
const NO_MIGRATION_REASONS = new Set(['platform-does-it', 'not-needed', 'reconfigure-in-wix']);
// Namespaces every WordPress or WooCommerce site advertises. Using one as a detection
// signal makes a profile match every such site, which is a false positive, not a detection.
const SHARED_NAMESPACES = new Set(['wp/v2', 'wc/v3', 'wc/v2', 'wc/v1', 'wc/store', 'wc/store/v1', 'oembed/1.0']);

function pluginsRoot(rootDir = path.resolve(__dirname, '..')) {
  return path.join(rootDir, 'plugins');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function listProfileFiles(pluginsDir) {
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !RESERVED_FILES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function loadProfiles(pluginsDir) {
  return listProfileFiles(pluginsDir).map((fileName) => readJson(path.join(pluginsDir, fileName)));
}

// The no-migration-needed file: plugins with nothing to move. Two
// tiers live here — `hints[]`, the cheap slug lookup for plugins that never get a profile,
// and `capabilities[]`, the human-signed per-capability register below.
function loadNoMigrationNeeded(pluginsDir) {
  const filePath = path.join(pluginsDir, 'no-migration-needed.json');
  if (!fs.existsSync(filePath)) return { hints: [], capabilities: [] };
  const file = readJson(filePath);
  return { hints: [], capabilities: [], ...file };
}

// The signed no-need-to-migrate register: per-CAPABILITY verdicts on PROFILED plugins, where
// the slug list cannot reach (a slug with a profile is rejected there, and rightly — the two
// would disagree). "Nothing to move" is not impossibility, but it is still a verdict about
// what the customer loses, so it is human-signed exactly like requires-development: without
// it, a decided capability re-lands as pending on every run and the decision has no home.
function loadNoMigrationCapabilities(pluginsDir) {
  return loadNoMigrationNeeded(pluginsDir).capabilities || [];
}

function loadPendingDecisions(pluginsDir) {
  const filePath = path.join(pluginsDir, 'capabilities-pending-decision.json');
  if (!fs.existsSync(filePath)) return { capabilities: [] };
  return readJson(filePath);
}

// The Requires development register: human-signed verdicts only.
function loadRequiresDevelopment(pluginsDir) {
  const filePath = path.join(pluginsDir, 'requires-development.json');
  if (!fs.existsSync(filePath)) return { capabilities: [] };
  return readJson(filePath);
}

// The fingerprint alias map: public evidence token -> plugin name. Names only —
// no entities, no channels, no target refs.
function loadFingerprintAliases(pluginsDir) {
  const filePath = path.join(pluginsDir, 'fingerprint-aliases.json');
  if (!fs.existsSync(filePath)) return { aliases: {} };
  return readJson(filePath);
}

// A wildcard route pattern must keep at least two concrete leading segments. This is what
// stops a profile from writing "/yoast/*" and silently reopening a whole excluded route
// family, while still allowing the legitimate "/ssp/v1/*" namespace-wide data case.
function wildcardKeepsScope(pattern) {
  if (!pattern.includes('*')) return true;
  const concrete = pattern.slice(0, pattern.indexOf('*')).split('/').filter(Boolean);
  return concrete.length >= 2;
}

function entityRouteOf(entity) {
  return ROUTE_CHANNELS.has(entity.channel) ? entity.route : null;
}

function generateIndex(pluginsDir) {
  const index = {
    schemaVersion: 1,
    plugins: {},
    routeIndex: {},
    namespaceIndex: {},
    restBaseIndex: {},
    recordPropertyIndex: {},
    capabilityIndex: {},
    channels: {},
  };

  for (const fileName of listProfileFiles(pluginsDir)) {
    const profile = readJson(path.join(pluginsDir, fileName));
    const slug = fileName.replace(/\.json$/, '');

    index.plugins[slug] = {
      path: `plugins/${fileName}`,
      displayName: profile.displayName,
      profileVersion: profile.profileVersion,
      distribution: profile.distribution || 'unknown',
      capabilities: [...(profile.capabilities || [])].sort(),
      entityCount: (profile.entities || []).length,
      channels: Array.from(new Set((profile.entities || []).map((entity) => entity.channel))).sort(),
      requiresCredentials: (profile.credentials || []).length > 0,
    };

    const push = (collection, key, value) => {
      if (!key) return;
      if (!collection[key]) collection[key] = [];
      collection[key].push(value);
    };

    for (const route of profile.detect?.routes || []) push(index.routeIndex, route, slug);
    for (const entity of profile.entities || []) {
      push(index.routeIndex, entityRouteOf(entity), slug);
      push(index.channels, entity.channel, slug);
      for (const property of entity.channel === 'core-embedded' && entity.propertyPath ? [entity.propertyPath] : []) {
        push(index.recordPropertyIndex, property, slug);
      }
    }
    for (const pattern of (profile.dataRoutePatterns || []).map((rule) => rule.pattern)) {
      push(index.routeIndex, pattern, slug);
    }
    for (const namespace of profile.detect?.restNamespaces || []) push(index.namespaceIndex, namespace, slug);
    for (const restBase of profile.detect?.restBases || []) push(index.restBaseIndex, restBase, slug);
    for (const property of profile.detect?.recordProperties || []) push(index.recordPropertyIndex, property, slug);
    for (const capability of profile.capabilities || []) push(index.capabilityIndex, capability, slug);
  }

  for (const collection of [
    index.routeIndex,
    index.namespaceIndex,
    index.restBaseIndex,
    index.recordPropertyIndex,
    index.capabilityIndex,
    index.channels,
  ]) {
    for (const key of Object.keys(collection)) {
      collection[key] = Array.from(new Set(collection[key])).sort();
    }
  }

  return index;
}

function requireFields(value, fields, label, errors) {
  for (const field of fields) {
    if (value[field] === undefined) errors.push(`${label}: missing required field ${field}`);
  }
}

function validateEntity(entity, label, errors, seenEntities) {
  requireFields(entity, ['entity', 'channel', 'candidateTargetRefs'], label, errors);
  if (!CHANNELS.has(entity.channel)) {
    errors.push(`${label}: invalid channel ${entity.channel}`);
  }
  if (entity.entity) {
    if (seenEntities.has(entity.entity)) errors.push(`${label}: duplicate entity id ${entity.entity}`);
    seenEntities.add(entity.entity);
  }
  if (ROUTE_CHANNELS.has(entity.channel)) {
    if (!entity.route) {
      errors.push(`${label}: channel ${entity.channel} requires route`);
    } else if (!entity.route.startsWith('/')) {
      errors.push(`${label}: route must start with /`);
    } else if (!wildcardKeepsScope(entity.route)) {
      errors.push(`${label}: route pattern ${entity.route} is too broad; keep at least two concrete leading segments before a wildcard`);
    }
  }
  if (entity.channel === 'core-embedded') {
    if (!Array.isArray(entity.embeddedIn) || entity.embeddedIn.length === 0) {
      errors.push(`${label}: core-embedded requires a non-empty embeddedIn`);
    }
    if (!entity.propertyPath) errors.push(`${label}: core-embedded requires propertyPath`);
  }
  if (entity.channel === 'core-meta' && !entity.propertyPath) {
    errors.push(`${label}: core-meta requires propertyPath`);
  }
  if (entity.channel === 'plugin-rest-child') {
    if (!entity.route || !entity.route.startsWith('/')) {
      errors.push(`${label}: plugin-rest-child requires route`);
    } else if (!entity.route.includes(CHILD_ROUTE_PLACEHOLDER)) {
      errors.push(`${label}: plugin-rest-child route must contain a ${CHILD_ROUTE_PLACEHOLDER} placeholder, e.g. /wc/v3/orders/${CHILD_ROUTE_PLACEHOLDER}/notes`);
    }
    if (!entity.parentRoute) {
      errors.push(`${label}: plugin-rest-child requires parentRoute — the already-sampled collection route that supplies parent ids (e.g. /wc/v3/orders)`);
    } else if (!entity.parentRoute.startsWith('/') || entity.parentRoute.includes(CHILD_ROUTE_PLACEHOLDER)) {
      errors.push(`${label}: parentRoute must be a literal collection route, not a template`);
    }
  }
  if (entity.responseEnvelope !== undefined) {
    if (!ROUTE_CHANNELS.has(entity.channel)) {
      errors.push(`${label}: responseEnvelope only applies to route-bearing channels (${[...ROUTE_CHANNELS].join(', ')})`);
    }
    const itemsPath = entity.responseEnvelope && entity.responseEnvelope.itemsPath;
    if (typeof itemsPath !== 'string' || itemsPath.length === 0) {
      errors.push(`${label}: responseEnvelope requires itemsPath — the dot-path to the array of records within the response body, e.g. "data.items"`);
    }
    const countPath = entity.responseEnvelope && entity.responseEnvelope.countPath;
    if (countPath !== undefined && (typeof countPath !== 'string' || countPath.length === 0)) {
      errors.push(`${label}: responseEnvelope.countPath must be a non-empty string dot-path when present`);
    }
  }
  if (entity.responseFragmentGroupSize !== undefined) {
    if (!ROUTE_CHANNELS.has(entity.channel)) {
      errors.push(`${label}: responseFragmentGroupSize only applies to route-bearing channels (${[...ROUTE_CHANNELS].join(', ')})`);
    }
    if (!Number.isInteger(entity.responseFragmentGroupSize) || entity.responseFragmentGroupSize < 2) {
      errors.push(`${label}: responseFragmentGroupSize must be an integer >= 2 — the number of flat array entries that reassemble into one record`);
    }
  }
  if (entity.requestMethod !== undefined || entity.requestBody !== undefined) {
    if (!ROUTE_CHANNELS.has(entity.channel)) {
      errors.push(`${label}: requestMethod/requestBody only apply to route-bearing channels (${[...ROUTE_CHANNELS].join(', ')})`);
    }
    if (entity.requestMethod !== undefined && !REQUEST_METHODS.has(entity.requestMethod)) {
      errors.push(`${label}: invalid requestMethod ${entity.requestMethod} (expected one of ${[...REQUEST_METHODS].join(', ')})`);
    }
    if (entity.requestMethod === 'GET' && entity.requestBody !== undefined) {
      errors.push(`${label}: requestBody is not meaningful with requestMethod GET`);
    }
    if (entity.requestMethod && entity.requestMethod !== 'GET' && entity.requestBody === undefined) {
      errors.push(`${label}: requestMethod ${entity.requestMethod} requires requestBody`);
    }
    if (entity.requestBody !== undefined && entity.requestMethod === undefined) {
      errors.push(`${label}: requestBody requires an explicit non-GET requestMethod — a body with no declared method is not a real request override`);
    }
    if (entity.requestBody !== undefined && (typeof entity.requestBody !== 'object' || entity.requestBody === null || Array.isArray(entity.requestBody))) {
      errors.push(`${label}: requestBody must be a plain JSON object`);
    }
  }
  if (entity.context !== undefined && !CONTEXTS.has(entity.context)) {
    errors.push(`${label}: invalid context ${entity.context}`);
  }
  if (!Array.isArray(entity.candidateTargetRefs)) {
    errors.push(`${label}: candidateTargetRefs must be an array`);
  } else if (entity.candidateTargetRefs.length === 0 && (entity.pitfalls || []).length === 0) {
    errors.push(`${label}: an entity with no candidateTargetRefs must record a pitfall explaining the gap`);
  }
  for (const pitfall of entity.pitfalls || []) {
    if (!SEVERITIES.has(pitfall.severity)) errors.push(`${label}: invalid pitfall severity ${pitfall.severity}`);
    if (!pitfall.code || !pitfall.summary) errors.push(`${label}: pitfalls need code and summary`);
  }
  validateBlockedEntries(entity.blocked, label, errors);
  for (const [index, pitfall] of (entity.pitfalls || []).entries()) {
    validateBlockedEntries(pitfall.blocked, `${label} pitfalls[${index}]`, errors);
  }
}

function validateBlockedEntries(blocked, label, errors) {
  if (blocked === undefined) return;
  if (!Array.isArray(blocked) || blocked.length === 0) {
    errors.push(`${label}: blocked must be a non-empty array when present`);
    return;
  }
  blocked.forEach((entry, index) => {
    const entryLabel = `${label} blocked[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${entryLabel} must be an object`);
      return;
    }
    if (!BLOCKED_KINDS.has(entry.kind)) errors.push(`${entryLabel}.kind must be one of ${[...BLOCKED_KINDS].join(', ')}`);
    if (!entry.resolution || typeof entry.resolution !== 'string') errors.push(`${entryLabel}.resolution must be a non-empty string`);
    if (typeof entry.declined !== 'boolean') errors.push(`${entryLabel}.declined must be boolean`);
    if (entry.fulfillment === undefined) return;
    const fulfillment = entry.fulfillment;
    if (!fulfillment || typeof fulfillment !== 'object' || Array.isArray(fulfillment)) {
      errors.push(`${entryLabel}.fulfillment must be an object`);
      return;
    }
    if (!FULFILLMENT_KINDS.has(fulfillment.kind)) errors.push(`${entryLabel}.fulfillment.kind must be csv-upload or bridge-plugin`);
    if (!fulfillment.handlerId || typeof fulfillment.handlerId !== 'string') errors.push(`${entryLabel}.fulfillment.handlerId must be a non-empty string`);
    if (fulfillment.freshnessWindowHours !== undefined && (!Number.isFinite(fulfillment.freshnessWindowHours) || fulfillment.freshnessWindowHours < 0)) {
      errors.push(`${entryLabel}.fulfillment.freshnessWindowHours must be a non-negative number`);
    }
    if (fulfillment.kind === 'csv-upload' && (!fulfillment.expectedInputPath || typeof fulfillment.expectedInputPath !== 'string')) {
      errors.push(`${entryLabel}.fulfillment.expectedInputPath is required for csv-upload`);
    }
    if (fulfillment.kind === 'bridge-plugin') {
      for (const field of ['manifestCaseId', 'expectedNamespace', 'extractionRoute']) {
        if (!fulfillment[field] || typeof fulfillment[field] !== 'string') errors.push(`${entryLabel}.fulfillment.${field} is required for bridge-plugin`);
      }
      if (fulfillment.extractionRoute && !fulfillment.extractionRoute.startsWith('/')) errors.push(`${entryLabel}.fulfillment.extractionRoute must start with /`);
    }
  });
}

function blockedEntriesOf(entity) {
  return [
    ...(entity.blocked || []),
    ...(entity.pitfalls || []).flatMap((pitfall) => pitfall.blocked || []),
  ];
}

function validateProfile(profile, slug, label, errors) {
  requireFields(
    profile,
    ['schemaVersion', 'plugin', 'displayName', 'profileVersion', 'sourceOfTruth', 'capabilities', 'detect', 'entities'],
    label,
    errors,
  );
  if (profile.schemaVersion !== 1) errors.push(`${label}: schemaVersion must be 1`);
  if (profile.plugin !== slug) errors.push(`${label}: plugin must match the filename slug (${slug})`);
  if (profile.distribution !== undefined && !DISTRIBUTIONS.has(profile.distribution)) {
    errors.push(`${label}: invalid distribution ${profile.distribution}`);
  }
  if (!Array.isArray(profile.capabilities) || profile.capabilities.length === 0) {
    errors.push(`${label}: capabilities must be a non-empty array`);
  }
  if (profile.dispositionHint !== undefined) {
    errors.push(`${label}: dispositionHint is retired — a plugin either has a profile (data to read) or an entry on the no-migration-needed list, never a hint on the profile`);
  }

  const detect = profile.detect || {};
  for (const namespace of detect.restNamespaces || []) {
    if (SHARED_NAMESPACES.has(namespace)) {
      errors.push(`${label}: detect.restNamespaces must not contain the shared namespace ${namespace} — it identifies WordPress/WooCommerce, not this plugin. Use a specific route instead.`);
    }
  }
  const signalCount = ['pluginFileIds', 'routes', 'restNamespaces', 'restBases', 'recordProperties', 'assetPathSlugs']
    .reduce((total, key) => total + (Array.isArray(detect[key]) ? detect[key].length : 0), 0);
  if (signalCount === 0) errors.push(`${label}: detect must declare at least one signal`);

  if (!Array.isArray(profile.entities) || profile.entities.length === 0) {
    errors.push(`${label}: entities must be a non-empty array`);
  } else {
    const seenEntities = new Set();
    profile.entities.forEach((entity, i) => {
      validateEntity(entity, `${label} entities[${i}]`, errors, seenEntities);
    });
    for (const entity of profile.entities) {
      if (entity.requiresParent && !seenEntities.has(entity.requiresParent)) {
        errors.push(`${label}: entity ${entity.entity} requiresParent ${entity.requiresParent} which is not declared in this profile`);
      }
    }

    const declaredCapabilities = Array.isArray(profile.capabilities) ? profile.capabilities : [];
    const attributedEntities = profile.entities.filter((entity) => entity.capability !== undefined);
    if (attributedEntities.length > 0 && attributedEntities.length !== profile.entities.length) {
      errors.push(`${label}: when one entity declares capability, every entity must declare capability so coverage cannot leak targets across rows`);
    }
    for (const entity of attributedEntities) {
      if (!declaredCapabilities.includes(entity.capability)) {
        errors.push(`${label}: entity ${entity.entity} capability ${entity.capability} is not declared in profile.capabilities`);
      }
    }
    if (attributedEntities.length > 0) {
      for (const capability of declaredCapabilities) {
        if (!attributedEntities.some((entity) => entity.capability === capability)) {
          errors.push(`${label}: capability ${capability} has no attributed entity`);
        }
      }
    }
  }

  for (const rule of profile.dataRoutePatterns || []) {
    if (!rule.pattern || !rule.reason) errors.push(`${label}: dataRoutePatterns entries need pattern and reason`);
    if (rule.pattern && !wildcardKeepsScope(rule.pattern)) {
      errors.push(`${label}: dataRoutePatterns pattern ${rule.pattern} is too broad; keep at least two concrete leading segments before a wildcard`);
    }
  }
  for (const rule of profile.excludeRoutes || []) {
    if (!rule.route || !rule.reason) errors.push(`${label}: excludeRoutes entries need route and reason`);
  }
  for (const credential of profile.credentials || []) {
    if (!credential.key || !credential.description) {
      errors.push(`${label}: credentials entries need key and description`);
    }
  }
}

// Cross-adapter integrity: candidateTargetRefs must resolve in the Wix target knowledge
// base, and every capability must either be claimed by a target entity or be explicitly
// allowlisted. This is the check that keeps the two knowledge homes from drifting apart.
//
// $bridgeManifest is caller-supplied (already-parsed JSON), never resolved from a path by this
// function itself: the wix-migration-helper plugin lives at repo-root plugins/, outside this
// skill's own published bundle (skills/wix-replatform/), and a skill lib must never hardcode a
// path reaching outside its own folder -- see tests/lib/paths.js's documented rule. Passing
// `null`/omitting it simply skips the bridge-manifest-specific checks below; the two-of-three
// tests that need them (tests/source-wordpress/blocked-data-validation-test.js) load and pass
// the real manifest themselves.
function validateAgainstTargets(profiles, pluginsDir, targetKnowledge, errors, bridgeManifest = null, bridgeManifestRoot = null) {
  if (!targetKnowledge) return;
  const { knownRefs, capabilityRefs } = targetKnowledge;
  const allowlist = new Set(
    (loadRequiresDevelopment(pluginsDir).capabilities || []).map((entry) => entry.capability),
  );
  const pendingFile = loadPendingDecisions(pluginsDir);
  const pending = new Set((pendingFile.capabilities || []).map((entry) => entry.capability));
  const profileEntityByRef = new Map();
  for (const profile of profiles) {
    for (const entity of profile.entities || []) profileEntityByRef.set(`plugin.${profile.plugin}.${entity.entity}`, entity);
  }

  let handlerRegistry = {};
  try { handlerRegistry = require('./blocked-data-handlers.js').handlers; }
  catch (error) { errors.push(`blocked data handler registry could not be loaded: ${error.message}`); }

  // schemaVersion 2 added `area`-keyed cases alongside the original bridge-plugin shape: they
  // are not (yet) cross-referenced against a plugin profile's blocked[].fulfillment (that wiring
  // is deliberately deferred to whoever builds the Wix-side signing service), so they carry no
  // sourceEntityRef; an area with no shipped adapter yet also carries no handlerId/module.
  if (bridgeManifest) {
    if (![1, 2].includes(bridgeManifest.schemaVersion)) errors.push('bridge manifest: schemaVersion must be 1 or 2');
    if (!Array.isArray(bridgeManifest.cases)) errors.push('bridge manifest: cases must be an array');
    const seenManifestCases = new Set();
    for (const [index, manifestCase] of (bridgeManifest.cases || []).entries()) {
      const label = `bridge manifest cases[${index}]`;
      const isAreaCase = typeof manifestCase.area === 'string' && manifestCase.area !== '';
      const requiredFields = isAreaCase ? ['caseId'] : ['caseId', 'sourceEntityRef', 'handlerId', 'module'];
      for (const field of requiredFields) {
        if (!manifestCase[field] || typeof manifestCase[field] !== 'string') errors.push(`${label}.${field} must be a non-empty string`);
      }
      if (isAreaCase) {
        // An unshipped area (e.g. blocked on an open issue) has no adapter yet: both fields are
        // null together, never just one — a handlerId with no module (or vice versa) is a real
        // inconsistency, not a legitimate "not built yet" state.
        const handlerIdPresent = manifestCase.handlerId !== null && manifestCase.handlerId !== undefined;
        const modulePresent = manifestCase.module !== null && manifestCase.module !== undefined;
        if (handlerIdPresent !== modulePresent) errors.push(`${label}: handlerId and module must both be set, or both be null`);
        if (handlerIdPresent && typeof manifestCase.handlerId !== 'string') errors.push(`${label}.handlerId must be a non-empty string or null`);
        if (modulePresent && typeof manifestCase.module !== 'string') errors.push(`${label}.module must be a non-empty string or null`);
      }
      if (seenManifestCases.has(manifestCase.caseId)) errors.push(`${label}.caseId ${manifestCase.caseId} is duplicated`);
      seenManifestCases.add(manifestCase.caseId);
      if (typeof manifestCase.productionReady !== 'boolean') errors.push(`${label}.productionReady must be boolean`);
      if (manifestCase.module && bridgeManifestRoot && !fs.existsSync(path.resolve(bridgeManifestRoot, manifestCase.module))) {
        errors.push(`${label}.module ${manifestCase.module} does not exist`);
      }
    }
  }
  const manifestCases = new Map(((bridgeManifest && bridgeManifest.cases) || []).map((entry) => [entry.caseId, entry]));
  const referencedSourceRefs = new Set();
  for (const [targetRef, dependencies] of targetKnowledge.blockedSourceDependenciesByRef || []) {
    for (const dependency of dependencies) {
      referencedSourceRefs.add(dependency.sourceEntityRef);
      const sourceEntity = profileEntityByRef.get(dependency.sourceEntityRef);
      if (!sourceEntity) {
        errors.push(`${targetRef}: blockedSourceDependencies sourceEntityRef ${dependency.sourceEntityRef} does not resolve to a plugin profile entity`);
        continue;
      }
      const fulfillments = blockedEntriesOf(sourceEntity).map((entry) => entry.fulfillment).filter(Boolean);
      if (fulfillments.length === 0) {
        errors.push(`${targetRef}: ${dependency.sourceEntityRef} has no matching blocked[].fulfillment`);
      }
    }
  }
  for (const [sourceEntityRef, sourceEntity] of profileEntityByRef) {
    const fulfillments = blockedEntriesOf(sourceEntity).map((entry) => entry.fulfillment).filter(Boolean);
    if (fulfillments.length > 0 && !referencedSourceRefs.has(sourceEntityRef)) {
      errors.push(`${sourceEntityRef}: blocked[].fulfillment is not referenced by any target blockedSourceDependencies entry`);
    }
    for (const fulfillment of fulfillments) {
      const handler = handlerRegistry[fulfillment.handlerId];
      if (!handler) errors.push(`${sourceEntityRef}: fulfillment handlerId ${fulfillment.handlerId} is not registered`);
      else if (handler.kind !== fulfillment.kind) errors.push(`${sourceEntityRef}: handler ${fulfillment.handlerId} kind ${handler.kind} does not match ${fulfillment.kind}`);
      // Only checked when the caller actually supplied a bridge manifest -- without one, this
      // plugin-knowledge validation still checks handler registration above, just not the
      // manifest-specific fields (see this function's own doc comment on `bridgeManifest`).
      if (fulfillment.kind === 'bridge-plugin' && bridgeManifest) {
        const manifestCase = manifestCases.get(fulfillment.manifestCaseId);
        if (!manifestCase) errors.push(`${sourceEntityRef}: manifestCaseId ${fulfillment.manifestCaseId} is missing from the bridge manifest`);
        else {
          if (manifestCase.sourceEntityRef !== sourceEntityRef) errors.push(`${sourceEntityRef}: manifest case sourceEntityRef does not match`);
          if (manifestCase.handlerId !== fulfillment.handlerId) errors.push(`${sourceEntityRef}: manifest case handlerId does not match fulfillment`);
        }
      }
    }
  }

  // "Wix cannot do this" is a human-only verdict. Automation may say profiled or pending and
  // nothing else, because a wrong impossibility tells a customer to abandon migratable data.
  for (const entry of loadRequiresDevelopment(pluginsDir).capabilities || []) {
    const label = `requires-development.json[${entry.capability}]`;
    if (!entry.reason) errors.push(`${label}: needs a reason`);
    if (!entry.searched) errors.push(`${label}: needs the recorded search`);
    if (!entry.decidedBy) {
      errors.push(`${label}: needs decidedBy — a named human. An agent may not conclude that Wix cannot do something; record it in capabilities-pending-decision.json instead.`);
    }
    if (!entry.decidedOn) errors.push(`${label}: needs decidedOn`);
    if (capabilityRefs.has(entry.capability)) {
      errors.push(`${label}: a Wix target entity now claims this capability; remove this entry`);
    }
    if (pending.has(entry.capability)) {
      errors.push(`${label}: also listed as pending — a capability is either human-decided or pending, never both`);
    }
  }
  for (const entry of pendingFile.capabilities || []) {
    const label = `capabilities-pending-decision.json[${entry.capability}]`;
    if (!entry.capability) errors.push('capabilities-pending-decision.json: every entry needs a capability');
    if (!entry.reason) errors.push(`${label}: needs a reason`);
    if (!entry.searched) errors.push(`${label}: needs the recorded search`);
    if (!['target-exists', 'no-target'].includes(entry.suspected)) {
      errors.push(`${label}: suspected must be target-exists or no-target`);
    }
    if (entry.suspected === 'target-exists' && !entry.plannedTarget) {
      errors.push(`${label}: suspected target-exists requires plannedTarget — the ref a human should author`);
    }
    if (capabilityRefs.has(entry.capability)) {
      errors.push(`${label}: a Wix target entity now claims this capability; remove the pending entry and let it resolve`);
    }
  }

  for (const profile of profiles) {
    const label = `plugins/${profile.plugin}.json`;
    for (const entity of profile.entities || []) {
      for (const ref of entity.candidateTargetRefs || []) {
        if (!knownRefs.has(ref)) {
          errors.push(`${label}: candidateTargetRefs ${ref} does not resolve in rp-target-wix/domains/index.json`);
        }
      }
    }
    for (const capability of profile.capabilities || []) {
      // Deliberately NOT an error: a capability with no target is PENDING, which is a valid
      // default state. Coverage reports it and a human decides; blocking here would push
      // authors toward inventing a verdict just to make validation pass.
      void capability;
    }
  }

  for (const entry of loadRequiresDevelopment(pluginsDir).capabilities || []) {
    if (!entry.reason) {
      errors.push(`requires-development.json: ${entry.capability} needs a reason`);
    }
    if (capabilityRefs.has(entry.capability)) {
      errors.push(`requires-development.json: ${entry.capability} is allowlisted but a Wix target entity now claims it; remove the allowlist entry`);
    }
  }
}

// The signed per-capability tier of no-migration-needed.json. Pure over its inputs, like
// validateEntity, so every rule is directly testable without staging a whole KB on disk.
function validateNoMigrationCapabilities({
  entries = [],
  requiresDevelopmentCapabilities = new Set(),
  pendingCapabilities = new Set(),
  // The Wix target KB's capability -> refs map, or null when it could not be loaded.
  capabilityRefs = null,
} = {}, errors) {
  const seen = new Set();

  for (const entry of entries) {
    const label = `no-migration-needed.json capabilities[${entry && entry.capability}]`;
    if (!entry || !entry.capability) {
      errors.push('no-migration-needed.json: every capabilities[] entry needs a capability');
      continue;
    }
    if (seen.has(entry.capability)) errors.push(`${label}: duplicate capability`);
    seen.add(entry.capability);
    if (!NO_MIGRATION_REASONS.has(entry.reason)) {
      errors.push(`${label}: invalid reason ${entry.reason} — one of ${[...NO_MIGRATION_REASONS].join(', ')}`);
    }
    if (!entry.replacedBy) errors.push(`${label}: needs replacedBy so the customer is told what covers it`);
    if (!entry.rationale) errors.push(`${label}: needs a rationale — every no-need-to-migrate row requires one`);
    // The signature is the whole point of this register. Unsigned, it would let automation
    // decide there is nothing to move, which is a decision about what the customer loses.
    if (!entry.decidedBy) {
      errors.push(`${label}: needs decidedBy — a named human. Automation may not decide a profiled capability has nothing to move; record it in capabilities-pending-decision.json instead.`);
    }
    if (!entry.decidedOn) errors.push(`${label}: needs decidedOn`);
    // Three capability registers, mutually exclusive: a capability is decided
    // no-need, decided requires-development, or pending — never two of the three.
    if (requiresDevelopmentCapabilities.has(entry.capability)) {
      errors.push(`${label}: also listed in requires-development.json — "nothing to move" and "Wix has no surface" are contradictory verdicts; keep one`);
    }
    if (pendingCapabilities.has(entry.capability)) {
      errors.push(`${label}: also listed as pending — a capability is either human-decided or pending, never both`);
    }
    // A signed "nothing to move" verdict and a Wix target entity claiming the same capability
    // are a direct contradiction: the target says the data has somewhere to go. The register
    // entry is the one that loses — the KB grew, so the verdict is stale and must be re-taken.
    if (capabilityRefs && capabilityRefs.has(entry.capability)) {
      errors.push(`${label}: a Wix target entity now claims this capability; the signed no-need verdict contradicts it and must be re-decided`);
    }
  }
}

// The no-migration-needed list is the cheap tier: nothing-to-move plugins that do not warrant
// a full profile. A slug must not appear in both tiers, or the two could disagree.
function validateNoMigrationNeeded(pluginsDir, profiles, errors) {
  const file = loadNoMigrationNeeded(pluginsDir);
  const seen = new Set();
  const profileSlugs = new Set(profiles.map((profile) => profile.plugin));
  for (const hint of file.hints || []) {
    const label = `no-migration-needed.json[${hint && hint.slug}]`;
    if (!hint || !hint.slug) {
      errors.push('no-migration-needed.json: every entry needs a slug');
      continue;
    }
    if (seen.has(hint.slug)) errors.push(`${label}: duplicate slug`);
    seen.add(hint.slug);
    if (!NO_MIGRATION_REASONS.has(hint.reason)) {
      errors.push(`${label}: invalid reason ${hint.reason} — one of ${[...NO_MIGRATION_REASONS].join(', ')}`);
    }
    if (!hint.does) errors.push(`${label}: needs a plain-language "does"`);
    if (!hint.replacedBy) errors.push(`${label}: needs replacedBy so the customer is told what covers it`);
    if (!hint.provenance) errors.push(`${label}: needs provenance (observed:<host>-<date> or expected:not-yet-observed)`);
    if (profileSlugs.has(hint.slug)) {
      errors.push(`${label}: this slug also has a full profile; keep the verdict in one place`);
    }
  }
}

// The alias map carries names only: a token maps to a displayName + wordpress.org
// slug, nothing more — an alias must never smuggle in detection or mapping behavior.
function validateFingerprintAliases(pluginsDir, errors) {
  const file = loadFingerprintAliases(pluginsDir);
  for (const [token, alias] of Object.entries(file.aliases || {})) {
    const label = `fingerprint-aliases.json[${token}]`;
    if (!alias || typeof alias.displayName !== 'string' || alias.displayName.length === 0) {
      errors.push(`${label}: needs a displayName`);
      continue;
    }
    if (!alias.slug) errors.push(`${label}: needs the plugin directory slug`);
    const extra = Object.keys(alias).filter((key) => !['displayName', 'slug'].includes(key));
    if (extra.length > 0) {
      errors.push(`${label}: carries ${extra.join(', ')} — the alias map is names only; entities, channels, and target refs belong in a profile`);
    }
  }
}

function validateKnowledge(pluginsDir, { targetKnowledge = null, bridgeManifest = null, bridgeManifestRoot = null } = {}) {
  const errors = [];
  const profiles = [];

  let corePatterns = new Set();
  try {
    corePatterns = require('./wp-route-classifier.js').coreRulePatterns();
  } catch (error) {
    errors.push(`could not load classifier core rule patterns for collision checks: ${error.message}`);
  }

  const routeOwners = new Map();
  for (const fileName of listProfileFiles(pluginsDir)) {
    const slug = fileName.replace(/\.json$/, '');
    const label = `plugins/${fileName}`;
    let profile;
    try {
      profile = readJson(path.join(pluginsDir, fileName));
    } catch (error) {
      errors.push(`${label}: not valid JSON (${error.message})`);
      continue;
    }
    profiles.push(profile);
    validateProfile(profile, slug, label, errors);

    const routes = [
      ...(profile.entities || []).map(entityRouteOf).filter(Boolean),
      ...(profile.dataRoutePatterns || []).map((rule) => rule.pattern),
    ];
    const overridingEntities = new Set(
      (profile.entities || []).filter((entity) => entity.overridesCoreRule === true).map(entityRouteOf),
    );
    for (const route of routes) {
      if (routeOwners.has(route) && routeOwners.get(route) !== slug) {
        errors.push(`${label}: route ${route} is already claimed by plugin ${routeOwners.get(route)}`);
      }
      routeOwners.set(route, slug);
      // A profile route that shadows a classifier-owned pattern must say so explicitly,
      // so an accidental shadow cannot silently change core scope.
      if (corePatterns.has(route) && !overridingEntities.has(route)) {
        errors.push(`${label}: route ${route} shadows a classifier core rule; set "overridesCoreRule": true on that entity if this is intended`);
      }
    }
  }

  validateNoMigrationNeeded(pluginsDir, profiles, errors);
  validateNoMigrationCapabilities({
    entries: loadNoMigrationCapabilities(pluginsDir),
    requiresDevelopmentCapabilities: new Set(
      (loadRequiresDevelopment(pluginsDir).capabilities || []).map((entry) => entry.capability),
    ),
    pendingCapabilities: new Set(
      (loadPendingDecisions(pluginsDir).capabilities || []).map((entry) => entry.capability),
    ),
    capabilityRefs: targetKnowledge?.capabilityRefs || null,
  }, errors);
  validateFingerprintAliases(pluginsDir, errors);
  validateAgainstTargets(profiles, pluginsDir, targetKnowledge, errors, bridgeManifest, bridgeManifestRoot);

  const generated = generateIndex(pluginsDir);
  const indexPath = path.join(pluginsDir, 'index.json');
  if (!fs.existsSync(indexPath)) {
    errors.push('plugins/index.json is missing; run plugin-knowledge-validate.js --write-index');
  } else if (JSON.stringify(readJson(indexPath)) !== JSON.stringify(generated)) {
    errors.push('plugins/index.json is stale; run plugin-knowledge-validate.js --write-index');
  }

  return { ok: errors.length === 0, errors, generatedIndex: generated, profileCount: profiles.length };
}

function loadIndex(pluginsDir) {
  return readJson(path.join(pluginsDir, 'index.json'));
}

function listPlugins(pluginsDir) {
  const index = loadIndex(pluginsDir);
  return Object.entries(index.plugins || {}).map(([plugin, info]) => ({ plugin, ...info }));
}

function readProfile(pluginsDir, slug) {
  const filePath = path.join(pluginsDir, `${slug}.json`);
  if (!fs.existsSync(filePath)) throw new Error(`Unknown plugin profile: ${slug}`);
  return readJson(filePath);
}

function patternMatchesRoute(pattern, routePath) {
  if (pattern.endsWith('/*')) return routePath.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith('*')) return routePath.startsWith(pattern.slice(0, -1));
  return pattern === routePath;
}

function resolveRoute(pluginsDir, routePath) {
  const index = loadIndex(pluginsDir);
  const matches = [];
  for (const [pattern, slugs] of Object.entries(index.routeIndex || {})) {
    if (patternMatchesRoute(pattern, routePath)) {
      for (const slug of slugs) matches.push({ plugin: slug, pattern });
    }
  }
  return matches.sort((a, b) => a.plugin.localeCompare(b.plugin) || a.pattern.localeCompare(b.pattern));
}

function resolveFromIndexKey(pluginsDir, collectionName, key) {
  const index = loadIndex(pluginsDir);
  return [...((index[collectionName] || {})[key] || [])];
}

function listCapabilities(pluginsDir) {
  const index = loadIndex(pluginsDir);
  const allowlist = new Set(
    (loadRequiresDevelopment(pluginsDir).capabilities || []).map((entry) => entry.capability),
  );
  return Object.entries(index.capabilityIndex || {}).map(([capability, plugins]) => ({
    capability,
    plugins,
    hasNativeTarget: !allowlist.has(capability),
  }));
}

// Route rules consumed by wp-route-classifier.js. Built from profiles so adding a plugin
// never means editing classifier code.
function buildRouteRules(pluginsDir) {
  const dataRules = [];
  const excludeRules = [];

  for (const fileName of listProfileFiles(pluginsDir)) {
    const profile = readJson(path.join(pluginsDir, fileName));
    const slug = profile.plugin;

    for (const rule of profile.excludeRoutes || []) {
      excludeRules.push([rule.route, `plugin.${slug}.exclude`, rule.reason]);
    }
    for (const entity of profile.entities || []) {
      const route = entityRouteOf(entity);
      if (route) {
        dataRules.push([
          route,
          `plugin.${slug}.${entity.entity}`,
          `${profile.displayName} ${entity.entity} records are durable plugin data`,
        ]);
      }
    }
    for (const rule of profile.dataRoutePatterns || []) {
      dataRules.push([rule.pattern, `plugin.${slug}.namespace`, rule.reason]);
    }
  }

  // Longest pattern first so a specific route beats a namespace-wide pattern from the same
  // or another profile.
  dataRules.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  excludeRules.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  return { dataRules, excludeRules };
}

// Route -> { itemsPath, countPath } for entities whose profile declares a non-standard
// response envelope (e.g. MailPoet's `{ data: { items: [...], meta: { count } } }` instead of
// a flat array + X-WP-Total header). Built from profiles, like buildRouteRules, so adding a
// plugin with a wrapped response never means editing the sampler.
function buildResponseEnvelopes(pluginsDir) {
  const envelopes = new Map();
  for (const fileName of listProfileFiles(pluginsDir)) {
    const profile = readJson(path.join(pluginsDir, fileName));
    for (const entity of profile.entities || []) {
      const route = entityRouteOf(entity);
      if (route && entity.responseEnvelope) {
        envelopes.set(route, entity.responseEnvelope);
      }
    }
  }
  return envelopes;
}

// Route -> { method, body } for entities whose only read path is not a plain GET
// collection (e.g. a plugin that implements "list" as a POST with a JSON body instead of
// query params — spec 0044). Built from profiles, like buildResponseEnvelopes, so any
// future waitlist-shaped plugin needs only a profile entry, never a sampler change.
// `body` may contain the placeholder string "$SAMPLED_IDS:<route>" on any leaf value,
// resolved at sample time (wp-discovery.js resolveRequestBody) to the ids already
// collected for that route earlier in the same discovery run — generic across any
// entity/route pair, not hardcoded to one plugin's id field.
function buildRequestOverrides(pluginsDir) {
  const overrides = new Map();
  for (const fileName of listProfileFiles(pluginsDir)) {
    const profile = readJson(path.join(pluginsDir, fileName));
    for (const entity of profile.entities || []) {
      const route = entityRouteOf(entity);
      if (route && entity.requestMethod && entity.requestMethod !== 'GET') {
        overrides.set(route, { method: entity.requestMethod, body: entity.requestBody || {} });
      }
    }
  }
  return overrides;
}

// Route -> N for entities whose profile declares that each logical record arrives as N
// separate flat array entries instead of one object (e.g. Back In Stock Notifier's
// list_subscriber, verified live 2026-08-19: 4 single-key entries per subscriber). Built
// from profiles, like buildResponseEnvelopes/buildRequestOverrides, so any future
// fragmented-response plugin needs only a profile entry, never a sampler change.
// Route -> recordKeyField for entities that declare one. Used to dedupe merged batch results
// in the $SAMPLED_IDS pagination/batching mechanism (spec 0044) — a profile whose records key
// on something other than `id` (e.g. subscriptions-for-woocommerce's `subscription_id`) would
// otherwise silently dedupe on the wrong field, or not at all. Built from profiles, like the
// other route-level lookups in this file.
function buildRecordKeyFields(pluginsDir) {
  const keyFields = new Map();
  for (const fileName of listProfileFiles(pluginsDir)) {
    const profile = readJson(path.join(pluginsDir, fileName));
    for (const entity of profile.entities || []) {
      const route = entityRouteOf(entity);
      if (route && entity.recordKeyField) {
        keyFields.set(route, entity.recordKeyField);
      }
    }
  }
  return keyFields;
}

function buildResponseFragmentGroups(pluginsDir) {
  const groups = new Map();
  for (const fileName of listProfileFiles(pluginsDir)) {
    const profile = readJson(path.join(pluginsDir, fileName));
    for (const entity of profile.entities || []) {
      const route = entityRouteOf(entity);
      if (route && entity.responseFragmentGroupSize) {
        groups.set(route, entity.responseFragmentGroupSize);
      }
    }
  }
  return groups;
}

module.exports = {
  CHANNELS,
  ROUTE_CHANNELS,
  CHILD_ROUTE_PLACEHOLDER,
  validateEntity,
  validateProfile,
  validateBlockedEntries,
  blockedEntriesOf,
  validateNoMigrationCapabilities,
  pluginsRoot,
  listProfileFiles,
  loadProfiles,
  loadRequiresDevelopment,
  loadFingerprintAliases,
  loadPendingDecisions,
  loadNoMigrationNeeded,
  loadNoMigrationCapabilities,
  generateIndex,
  validateKnowledge,
  writeJson,
  loadIndex,
  listPlugins,
  readProfile,
  resolveRoute,
  resolveFromIndexKey,
  listCapabilities,
  buildRouteRules,
  buildResponseEnvelopes,
  buildResponseFragmentGroups,
  buildRecordKeyFields,
  buildRequestOverrides,
  patternMatchesRoute,
  wildcardKeepsScope,
  entityRouteOf,
};
