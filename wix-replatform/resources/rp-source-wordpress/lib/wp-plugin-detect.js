'use strict';

// Pure plugin detection, generic derivation, and coverage classification.
//
// Everything here is a pure function over already-fetched inputs (REST index, plugin list,
// types/taxonomies, sampled records) so the whole surface is fixture-testable with no live
// WordPress site. Network fetching lives in scripts/wp-plugin-inventory.js.
//
// Classification: every installed plugin lands in exactly
// one of the five statuses in COVERAGE_STATUSES, every status produces a row the user sees, and
// rows state whether the plugin was `recognized` (a profile matched) and whether the mapping is
// `confirmed` (authored by a human) or `proposed` (derived; approved at the mapping review).

const { patternMatchesRoute } = require('./plugin-knowledge.js');
const { childRouteAdvertised } = require('./wp-route-classifier.js');

const CONFIDENCE_ORDER = { high: 3, medium: 2, low: 1 };

// Signal strength, strongest first.
const SIGNAL_CONFIDENCE = {
  'wp.v2.plugins': 'high',
  route: 'high',
  'rest-base': 'medium',
  'record-property': 'medium',
  namespace: 'low',
  'asset-path': 'low',
};

// The five statuses of the plugin-classification scheme (+ manual-mapping). Every installed plugin lands
// in exactly one, every status is a sentence a merchant can act on, and there is no second
// internal vocabulary.
//
//   migration-planned    - "this comes across", via `api` (native Wix entity) or via `cms`
//                          (kept as data with its original IDs). `confidence` states whether a
//                          human authored the mapping (confirmed) or we derived it (proposed).
//   manual-mapping       - "Wix can do this — here are the exact steps you take yourself".
//                          A complete, decided mapping with no write for our code to make: no
//                          `preferredWrite` call exists, only a `manualSteps` runbook (row.
//                          manualSteps). Unlike `pending`, nothing here is undecided — it needs
//                          no human sign-off gate, only the merchant's own follow-through.
//   no-need-to-migrate   - "nothing to move": Wix already does it, it was never data, or it is
//                          a setting you reconfigure once in Wix. Two sources: the slug list
//                          (`basis: list`, unprofiled plugins) and the human-signed
//                          per-capability register (`basis: decision`, profiled plugins).
//   pending              - "we do not know how to migrate this yet". OUR open item, decided at
//                          the mapping review; never a statement about the source or about Wix.
//   requires-development - "Wix has no surface for this; build it first". Reachable ONLY from
//                          the human-signed register — automation may never conclude
//                          impossibility. Two agent-made impossibility claims (gift cards,
//                          events) were already wrong; both had a create API.
//
// Blocked — recoverable is deliberately NOT here: a failed or unavailable read attaches to the
// row as `blocked[]` and never becomes a mapping decision (see CHANNEL_BLOCKERS).
const COVERAGE_STATUSES = new Set([
  'migration-planned',
  'manual-mapping',
  'no-need-to-migrate',
  'pending',
  'requires-development',
]);

// A channel that cannot be read today attaches a blocker to the row: fix and re-run. This is
// what keeps a db-only gift-card balance "Migration planned + blocked", not "pending" —
// unreadable today, recoverable by an export, and never reported as a limitation of Wix.
const CHANNEL_BLOCKERS = {
  'needs-export-file': {
    kind: 'user-file',
    resolution: 'Provide the plugin export file produced on the source site; only you can produce it (Application Passwords never reach wp-admin).',
  },
  unavailable: {
    kind: 'user-file',
    resolution: 'The plugin keeps this data in its own database tables; provide a database export or a source-side bridge.',
  },
  'needs-user-transcription': {
    kind: 'user-file',
    resolution: 'The plugin exposes this configuration only in wp-admin; transcribe it or provide screenshots from an authenticated browser session.',
  },
  'route-absent': {
    kind: 'surface-changed',
    resolution: 'The profile declares a route this site does not expose; the profile may be stale or the plugin version differs.',
  },
  'property-absent': {
    kind: 'surface-changed',
    resolution: 'The profile declares an embedded property the sampled records do not carry; the profile may be stale or the plugin version differs.',
  },
  'api-below-min-version': {
    kind: 'surface-changed',
    resolution: 'The installed plugin version predates the REST surface this profile reads; upgrade the plugin or supply an export file.',
  },
};

function blockersForEntities(entities) {
  const blocked = [];
  for (const entity of entities) {
    const declared = (entity.pitfalls || []).flatMap((pitfall) => pitfall.blocked || []);
    if (declared.length > 0) {
      for (const blocker of declared) {
        blocked.push({
          ...blocker,
          entity: entity.entity,
          channel: entity.channel,
          declined: blocker.declined === true,
        });
      }
      continue;
    }
    const spec = CHANNEL_BLOCKERS[entity.channelStatus];
    if (!spec) continue;
    blocked.push({
      kind: spec.kind,
      entity: entity.entity,
      channel: entity.channel,
      resolution: spec.resolution,
      declined: false,
    });
  }
  return blocked;
}

const CHANNEL_AVAILABILITY = {
  'plugin-rest': 'available',
  'core-cpt': 'available',
  'core-embedded': 'available',
  'core-meta': 'available',
  'plugin-rest-child': 'available',
  'export-file': 'needs-export-file',
  'db-only': 'unavailable',
  'admin-page-only': 'needs-user-transcription',
};

function bestConfidence(signals) {
  let best = null;
  for (const signal of signals) {
    const kind = String(signal).split(':')[0];
    const confidence = SIGNAL_CONFIDENCE[kind] || 'low';
    if (!best || CONFIDENCE_ORDER[confidence] > CONFIDENCE_ORDER[best]) best = confidence;
  }
  return best || 'low';
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function routeSet(restIndex) {
  return new Set(Object.keys(restIndex?.routes || {}));
}

function namespaceSet(restIndex) {
  return new Set(Array.isArray(restIndex?.namespaces) ? restIndex.namespaces : []);
}

function restBaseSet(types, taxonomies) {
  const bases = new Set();
  for (const collection of [types, taxonomies]) {
    for (const entry of Object.values(collection || {})) {
      if (entry && entry.rest_base) bases.add(entry.rest_base);
      if (entry && entry.slug) bases.add(entry.slug);
    }
  }
  return bases;
}

// Plugin file ids look like "the-events-calendar/the-events-calendar.php". The list endpoint
// returns them without the ".php" on some versions, so compare on the directory segment too.
function pluginFileVariants(pluginFileId) {
  const variants = new Set([pluginFileId]);
  variants.add(pluginFileId.replace(/\.php$/, ''));
  const dir = pluginFileId.split('/')[0];
  if (dir) variants.add(dir);
  return variants;
}

// VERIFIED LIVE 2026-07-30: a plugin's main file basename frequently differs from its
// directory — real ids include `wordpress-seo/wp-seo`, `woo-custom-product-addons/start`,
// `chaty/cht-icons`, `print-google-cloud-print-gcp-woocommerce/index`. A profile author
// writing the conventional `dir/dir.php` guess must still match, so compare the two id
// variant SETS (which both include the bare directory) rather than comparing each declared
// string against the other's set — the latter never intersects on the directory token.
// Plugin directories are unique per install, so directory-level matching cannot collide.
function matchInstalled(profile, installed) {
  const declared = profile.detect?.pluginFileIds || [];
  if (declared.length === 0) return null;
  const declaredVariants = declared.map((declaredId) => pluginFileVariants(declaredId));
  for (const entry of installed) {
    const candidates = pluginFileVariants(String(entry.plugin || ''));
    for (const variants of declaredVariants) {
      for (const variant of variants) {
        if (candidates.has(variant)) return entry;
      }
    }
  }
  return null;
}

function detectPlugins({
  profiles = [],
  restIndex = null,
  pluginList = null,
  types = null,
  taxonomies = null,
  htmlSources = [],
  sampledRecordProperties = [],
  // The fingerprint alias map ({ aliases: { token: { displayName, slug } } }).
  fingerprintAliases = null,
} = {}) {
  const routes = routeSet(restIndex);
  const rawRoutes = restIndex?.routes || {};
  const namespaces = namespaceSet(restIndex);
  const bases = restBaseSet(types, taxonomies);
  const properties = new Set(sampledRecordProperties);
  const html = htmlSources.join('\n');
  const installed = Array.isArray(pluginList) ? pluginList : [];
  const pluginListAvailable = Array.isArray(pluginList);

  const detected = [];
  const claimedInstalled = new Set();

  for (const profile of profiles) {
    const signals = [];
    const detect = profile.detect || {};

    const installedEntry = matchInstalled(profile, installed);
    if (installedEntry) {
      signals.push('wp.v2.plugins');
      claimedInstalled.add(installedEntry.plugin);
    }
    for (const route of detect.routes || []) {
      if (routes.has(route)) signals.push(`route:${route}`);
    }
    for (const entity of profile.entities || []) {
      if (entity.route && routes.has(entity.route)) signals.push(`route:${entity.route}`);
    }
    for (const base of detect.restBases || []) {
      if (bases.has(base)) signals.push(`rest-base:${base}`);
    }
    for (const property of detect.recordProperties || []) {
      if (properties.has(property)) signals.push(`record-property:${property}`);
    }
    for (const entity of profile.entities || []) {
      if ((entity.channel === 'core-embedded' || entity.channel === 'core-meta') && entity.propertyPath && properties.has(entity.propertyPath)) {
        signals.push(`record-property:${entity.propertyPath}`);
      }
    }
    for (const namespace of detect.restNamespaces || []) {
      if (namespaces.has(namespace)) signals.push(`namespace:${namespace}`);
    }
    for (const slug of detect.assetPathSlugs || []) {
      if (html.includes(`/wp-content/plugins/${slug}/`)) signals.push(`asset-path:${slug}`);
    }

    if (signals.length === 0) continue;

    const uniqueSignals = Array.from(new Set(signals)).sort();
    const version = installedEntry?.version || null;
    // A version below the profile's documented REST threshold means the capability is
    // present but this profile's read contract does not apply. Saying so is more useful
    // than either claiming a readable entity or dropping the plugin entirely.
    const apiBelowMinVersion = Boolean(
      detect.minVersion && version && compareVersions(version, detect.minVersion) < 0,
    );

    detected.push({
      plugin: profile.plugin,
      displayName: profile.displayName,
      version,
      active: installedEntry ? installedEntry.status === 'active' : null,
      distribution: profile.distribution || 'unknown',
      confidence: bestConfidence(uniqueSignals),
      signals: uniqueSignals,
      capabilities: [...(profile.capabilities || [])],
      profileVersion: profile.profileVersion,
      apiBelowMinVersion,
      minVersion: detect.minVersion || null,
      entities: (profile.entities || []).map((entity) => describeProfiledEntity(entity, {
        routes,
        rawRoutes,
        properties,
        apiBelowMinVersion,
      })),
    });
  }

  const profiledNamespaces = new Set();
  const profiledRoutePatterns = [];
  for (const profile of profiles) {
    for (const namespace of profile.detect?.restNamespaces || []) profiledNamespaces.add(namespace);
    for (const entity of profile.entities || []) {
      if (entity.route) profiledRoutePatterns.push(entity.route);
    }
    for (const rule of profile.dataRoutePatterns || []) profiledRoutePatterns.push(rule.pattern);
  }

  const installedButUnprofiled = installed
    .filter((entry) => !claimedInstalled.has(entry.plugin))
    .map((entry) => ({
      plugin: entry.plugin,
      name: entry.name || null,
      version: entry.version || null,
      active: entry.status === 'active',
      textdomain: entry.textdomain || null,
    }))
    .sort((a, b) => String(a.plugin).localeCompare(String(b.plugin)));

  const fingerprinted = collectFingerprints({
    namespaces,
    html,
    profiles,
    installed,
    aliases: fingerprintAliases?.aliases || {},
  });

  return {
    pluginListAvailable,
    detected: detected.sort((a, b) => a.plugin.localeCompare(b.plugin)),
    installedButUnprofiled,
    fingerprinted,
    profiledNamespaces: Array.from(profiledNamespaces).sort(),
    profiledRoutePatterns: profiledRoutePatterns.sort(),
  };
}

// The fingerprinted tier: public evidence of plugins nothing else claimed.
// wp-content/plugins/<slug> asset paths and unrecognized REST namespaces are read and named
// through the alias map instead of thrown away. Names only: the tier makes no completeness
// claim (the incomplete-list warning stands unchanged) and never feeds route selection — it
// is inventory, not scope. Verified against a live WordPress installation: unauthenticated,
// dozens of plugins publicly self-announced while the function returned 1 detected + 0 unprofiled.
// Platform namespaces that are the host or the commerce platform, not a plugin: WordPress
// core, the WordPress.com hosting layer, and WooCommerce's own admin/telemetry surfaces
// (VERIFIED LIVE 2026-08-10: a stock WooCommerce store advertises eight wc-* namespaces
// that would otherwise read as eight unknown plugins). A row for one of these would tell
// the user to worry about their own platform.
const CORE_FINGERPRINT_TOKENS = new Set([
  'wp', 'wc', 'oembed', 'wp-block-editor', 'wp-site-health', 'wp-abilities', 'mcp',
  'wpcom', 'wpcomsh', 'help-center',
  'woocommerce', 'wc-admin', 'wc-admin-email', 'wc-analytics', 'wc-push-notifications',
  'wc-telemetry', 'wccom-site', 'woocommerce-email-editor',
]);

function collectFingerprints({ namespaces, html, profiles, installed, aliases }) {
  const claimed = new Set(CORE_FINGERPRINT_TOKENS);
  for (const profile of profiles) {
    for (const slug of profile.detect?.assetPathSlugs || []) claimed.add(slug);
    for (const namespace of profile.detect?.restNamespaces || []) claimed.add(namespace.split('/')[0]);
    claimed.add(profile.plugin);
  }
  // A plugin already on the installed list is inventory we hold with certainty; its public
  // fingerprint adds nothing and must not produce a second row. Match fuzzily, the same way
  // namespace attribution does — a namespace token is often a shortening of the directory
  // (acme-shop vs acme-shop-vouchers) — because the tier's claim is precision, and a
  // duplicate row costs more than a missed name.
  const installedTokens = new Set();
  for (const entry of installed) {
    const dir = String(entry.plugin || '').split('/')[0];
    if (dir) installedTokens.add(normalizeToken(dir));
    if (entry.textdomain) installedTokens.add(normalizeToken(entry.textdomain));
  }
  // VERIFIED against live WordPress installations: a fingerprint token is frequently a cryptic internal
  // namespace (wpjm-internal, fb_api, wc-facebook, mc4wp, zprint, yoast) that fails the fuzzy
  // token match above even though the alias map already resolves it to an exact installed
  // slug (wp-job-manager, facebook-for-woocommerce, mailchimp-for-wp,
  // print-google-cloud-print-gcp-woocommerce, wordpress-seo) — that is the whole reason an
  // alias exists. Skipping this check produced a second, confusing per-plugin row for five
  // different already-installed plugins in one real run, each showing both "fingerprinted"
  // and "installed but unprofiled" text glued together.
  const matchesInstalled = (token) => {
    const normalized = normalizeToken(token);
    if (!normalized) return false;
    const aliasSlug = aliases[token]?.slug;
    if (aliasSlug && installedTokens.has(normalizeToken(aliasSlug))) return true;
    for (const installedToken of installedTokens) {
      if (installedToken.includes(normalized) || normalized.includes(installedToken)) return true;
    }
    return false;
  };

  const byToken = new Map();
  const consider = (token, evidence) => {
    if (!token || claimed.has(token) || matchesInstalled(token)) return;
    if (!byToken.has(token)) byToken.set(token, { token, evidence: new Set() });
    byToken.get(token).evidence.add(evidence);
  };

  for (const namespace of namespaces) consider(namespace.split('/')[0], `namespace:${namespace}`);
  for (const match of html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//g)) {
    consider(match[1], `asset-path:${match[1]}`);
  }

  return Array.from(byToken.values())
    .map((entry) => {
      const alias = aliases[entry.token] || null;
      return {
        token: entry.token,
        evidence: Array.from(entry.evidence).sort(),
        displayName: alias?.displayName || null,
        slug: alias?.slug || entry.token,
        aliasMatched: Boolean(alias),
      };
    })
    .sort((a, b) => a.token.localeCompare(b.token));
}

// Channel status describes only whether the SOURCE exposes this entity. Credential state is
// deliberately not encoded here: it is resolved in classifyCoverage against the credentials
// actually granted for the run, so granting one later cannot leave a stale entity status.
function describeProfiledEntity(entity, { routes, rawRoutes, properties, apiBelowMinVersion }) {
  let channelStatus = CHANNEL_AVAILABILITY[entity.channel] || 'unavailable';

  if (channelStatus === 'available') {
    // plugin-rest-child's route is a {parentId} template, never a literal index route — it is
    // checked below, against both the parent collection and the templated child route.
    if (entity.channel !== 'plugin-rest-child' && entity.route && !routes.has(entity.route) && !entity.route.includes('*')) {
      channelStatus = 'route-absent';
    }
    if ((entity.channel === 'core-embedded' || entity.channel === 'core-meta') && entity.propertyPath && !properties.has(entity.propertyPath)) {
      channelStatus = 'property-absent';
    }
    if (entity.channel === 'plugin-rest-child') {
      // Presence only: the parent collection is in scope AND the site's REST index
      // advertises a sub-resource shaped like the entity's route template. Whether any real
      // parent record actually has data there is a live, per-parent question answered later
      // by wp-discovery.js's representative sample — never assumed here.
      const parentAvailable = Boolean(entity.parentRoute) && routes.has(entity.parentRoute);
      const childAdvertised = Boolean(entity.route) && childRouteAdvertised(rawRoutes, entity.route);
      if (!parentAvailable || !childAdvertised) {
        channelStatus = 'route-absent';
      }
    }
  }
  if (apiBelowMinVersion && channelStatus === 'available') channelStatus = 'api-below-min-version';

  return {
    entity: entity.entity,
    capability: entity.capability || null,
    channel: entity.channel,
    channelStatus,
    route: entity.route || null,
    parentRoute: entity.parentRoute || null,
    embeddedIn: entity.embeddedIn || null,
    propertyPath: entity.propertyPath || null,
    context: entity.context || null,
    requiresParent: entity.requiresParent || null,
    hierarchical: entity.hierarchical === true,
    // Read-mechanics fields (spec 0044/0045) that rp-import-codegen's sourceMeta contract
    // depends on — dropping them here would leave the documented contract with nothing to
    // copy from, since this is the structured (non-prose) per-entity description that
    // detection writes to disk.
    requestMethod: entity.requestMethod || null,
    requestBody: entity.requestBody || null,
    responseFragmentGroupSize: entity.responseFragmentGroupSize || null,
    candidateTargetRefs: [...(entity.candidateTargetRefs || [])],
    pitfalls: entity.pitfalls || [],
  };
}

// Unprofiled REST namespaces, so heuristic acceptance is visible rather than
// indistinguishable from known-good coverage.
function collectUnprofiledRoutes({ classifications = [], detection }) {
  const profiledPatterns = detection?.profiledRoutePatterns || [];
  const byNamespace = new Map();

  for (const classification of classifications) {
    if (classification.effectiveAction !== 'sample') continue;
    // Core WordPress and WooCommerce families are covered by the classifier's own
    // allowlist; they are not "unprofiled plugins". Profile-matched routes are filtered
    // below by pattern, not by rule id — the generic fallback rule id also begins with
    // "plugin.", so a prefix test would wrongly hide heuristic acceptances.
    if (/^(wp|wc)\./.test(classification.ruleId || '')) continue;
    if (profiledPatterns.some((pattern) => patternMatchesRoute(pattern, classification.routePath))) continue;

    const namespace = classification.namespace || classification.routePath.split('/').slice(1, 3).join('/');
    if (!byNamespace.has(namespace)) {
      byNamespace.set(namespace, { namespace, routes: [], ruleIds: new Set() });
    }
    const entry = byNamespace.get(namespace);
    entry.routes.push(classification.routePath);
    entry.ruleIds.add(classification.ruleId);
  }

  return Array.from(byNamespace.values())
    .map((entry) => ({
      namespace: entry.namespace,
      routes: entry.routes.sort(),
      ruleIds: Array.from(entry.ruleIds).sort(),
      read: true,
      reason: 'no plugin profile matched; accepted by generic collection-shape classification',
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

// Collection-shaped routes in namespaces we do not recognize that were NOT read. Verified
// live: the REST index advertises no per-route schema, so these never reach `sample`. They
// are reported rather than sampled so the coverage report can say "this plugin looks like it
// holds records we did not read" instead of omitting it.
const CORE_NAMESPACE_PREFIXES = ['wp/v2', 'wc/v1', 'wc/v2', 'wc/v3', 'wc/store', 'oembed/1.0'];

function collectCandidateNamespaces({ classifications = [], candidates = [], detection = null }) {
  const profiledPatterns = detection?.profiledRoutePatterns || [];
  const shaped = new Map(candidates.map((candidate) => [candidate.routePath, candidate]));
  const byNamespace = new Map();

  for (const classification of classifications) {
    if (classification.effectiveAction !== 'skip') continue;
    // Only the "we had no rule for it" bucket. Anything a deliberate exclusion family
    // caught (admin, runtime, diagnostics, integration…) stays out of scope by design.
    if (classification.ruleId !== 'unsupported.default') continue;
    const candidate = shaped.get(classification.routePath);
    const hasShape = Boolean(candidate?.getEndpoint?.args?.page || candidate?.getEndpoint?.args?.per_page);
    if (!hasShape) continue;
    if (CORE_NAMESPACE_PREFIXES.some((prefix) => classification.routePath.startsWith(`/${prefix}/`))) continue;
    if (profiledPatterns.some((pattern) => patternMatchesRoute(pattern, classification.routePath))) continue;

    const namespace = classification.namespace || classification.routePath.split('/').slice(1, 3).join('/');
    if (!byNamespace.has(namespace)) byNamespace.set(namespace, { namespace, routes: [] });
    byNamespace.get(namespace).routes.push(classification.routePath);
  }

  return Array.from(byNamespace.values())
    .map((entry) => ({
      namespace: entry.namespace,
      routes: entry.routes.sort(),
      read: false,
      reason: 'collection-shaped routes in an unrecognized namespace; not read by default',
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

// Tier B: derive entities for unprofiled, REST-visible plugin post types and taxonomies.
// Built from /wp/v2/types and /wp/v2/taxonomies, which is what makes broad coverage the
// default rather than a per-plugin achievement.
const CORE_POST_TYPES = new Set(['post', 'page', 'attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_font_family', 'wp_font_face', 'wp_global_styles', 'product', 'product_variation', 'shop_order', 'shop_coupon']);
const CORE_TAXONOMIES = new Set(['category', 'post_tag', 'nav_menu', 'link_category', 'post_format', 'wp_pattern_category', 'product_cat', 'product_tag', 'product_brand']);

const GENERIC_TARGET_REFS = ['cms/collection', 'cms/data-item'];

function deriveGenericEntities({
  types = null,
  taxonomies = null,
  classifications = [],
  detection = null,
  sampledByRoute = new Map(),
} = {}) {
  const profiledPatterns = detection?.profiledRoutePatterns || [];
  const sampledRoutes = new Set(
    classifications
      .filter((classification) => ['sample', 'metadata'].includes(classification.effectiveAction))
      .map((classification) => classification.routePath),
  );
  const entities = [];

  const consider = (kind, key, entry) => {
    const restBase = entry?.rest_base || entry?.slug || key;
    if (!restBase) return;
    if (entry?.show_in_rest === false) return;
    if (kind === 'post-type' && CORE_POST_TYPES.has(key)) return;
    if (kind === 'taxonomy' && CORE_TAXONOMIES.has(key)) return;

    const namespace = entry?.rest_namespace || 'wp/v2';
    const route = `/${namespace}/${restBase}`;
    if (profiledPatterns.some((pattern) => patternMatchesRoute(pattern, route))) return;
    // Scope containment: only routes the 0005 classifier already accepted may be derived.
    // The generic path must never resurrect an excluded route family.
    if (!sampledRoutes.has(route)) return;

    const sampled = sampledByRoute.get(route) || null;
    entities.push({
      entity: restBase,
      origin: kind === 'taxonomy' ? 'generic-taxonomy' : 'generic-post-type',
      recognized: false,
      channel: 'core-cpt',
      route,
      restBase,
      sourcePostType: kind === 'post-type' ? key : null,
      sourceTaxonomy: kind === 'taxonomy' ? key : null,
      displayName: entry?.name || restBase,
      hierarchical: entry?.hierarchical === true,
      attachedToTypes: Array.isArray(entry?.types) ? [...entry.types] : [],
      recordCount: sampled ? sampled.recordCount : null,
      inUse: sampled ? sampled.inUse : null,
      candidateTargetRefs: [...GENERIC_TARGET_REFS],
      proposedCapability: proposeCapability(kind, key, restBase, entry),
      capabilityConfidence: 'proposed',
      notes: buildGenericNotes(kind, entry),
    });
  };

  for (const [key, entry] of Object.entries(types || {})) consider('post-type', key, entry);
  for (const [key, entry] of Object.entries(taxonomies || {})) consider('taxonomy', key, entry);

  return entities.sort((a, b) => a.route.localeCompare(b.route));
}

// A proposal, never a decision: it is recorded with unverified confidence and reviewed by
// the user at the existing mapping-review checkpoint. Native selection still requires a
// target-KB match (see classifyCoverage), so a wrong guess here cannot cause a bad write.
function proposeCapability(kind, key, restBase, entry) {
  const haystack = [key, restBase, entry?.name, ...(entry?.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const rules = [
    [/(event|calendar|webinar)/, 'content.events'],
    [/(course|lesson|lms|quiz)/, 'content.courses'],
    [/(booking|appointment|reservation)/, 'commerce.bookings'],
    [/(testimonial|review|rating)/, 'content.reviews'],
    [/(portfolio|project|gallery|album)/, 'content.portfolio'],
    // Jobs before listings: "jobs_listing" contains both, and the job reading is the
    // specific one. Rule order is the tie-breaker, so keep specific before generic.
    [/(job|vacancy|career|resume)/, 'content.jobs'],
    [/(listing|directory|property|realestate)/, 'content.listings'],
    [/(recipe|menu|dish)/, 'content.recipes'],
    [/(podcast|episode)/, 'content.podcast'],
    [/(faq|question)/, 'content.faq'],
    [/(team|staff|person|member-profile)/, 'content.people'],
    [/(form|entry|submission)/, 'content.form-submissions'],
    [/(donation|campaign|fundrais)/, 'commerce.donations'],
    [/(membership|subscriber|plan)/, 'commerce.memberships'],
    [/(location|store-locator|branch)/, 'business.locations'],
  ];
  for (const [pattern, capability] of rules) {
    if (pattern.test(haystack)) return capability;
  }
  return kind === 'taxonomy' ? 'content.custom-taxonomy' : 'content.custom-records';
}

function buildGenericNotes(kind, entry) {
  const notes = [];
  if (kind === 'taxonomy' && entry?.hierarchical === true) {
    notes.push('Hierarchical source taxonomy: mapping must record a faithfulness-ledger entry if the chosen Wix target is flat.');
  }
  notes.push('Derived structurally without a plugin profile; unregistered post meta (show_in_rest absent) is not readable over REST and is therefore not included.');
  return notes;
}

// Coverage rows: one per capability, the user-facing answer to "what happens to my plugins".
//
// Row shape. Common fields: capability,
// recognized, basis ('profile' | 'list' | 'proposed' | 'decision'), plugins[], sourceEntities[],
// channels[], recordCounts, profileVersion, blocked[], userImpact, action. Status-specific
// fields:
//   migration-planned    - via ('api' | 'cms'), confidence ('confirmed' | 'proposed'), targetRefs[]
//   manual-mapping        - via ('manual'), confidence ('confirmed'), targetRefs[], manualSteps
//                          (the rp-target-wix entity's manualSteps object, verbatim)
//   no-need-to-migrate   - reason ('platform-does-it' | 'not-needed' | 'reconfigure-in-wix'),
//                          replacedBy, rationale (required); plus decidedBy/decidedOn when
//                          basis is 'decision' (the signed per-capability register)
//   pending              - reason (including 'cannot-tell'), searched[]
//   requires-development - decidedBy, decidedOn, evidence[]

// For manual-mapping: every one of `refs` resolves to a manual-mapping target (never a mix — a
// capability with some manual and some automated targets is a KB authoring error, not
// something this layer should silently resolve one way or the other). Returns the first
// manualSteps object to attach to the row, or null when `refs` is empty or not entirely
// manual-mapping.
function resolveManualMapping(refs, targetKnowledge) {
  const manualStepsByRef = targetKnowledge && targetKnowledge.manualStepsByRef;
  if (!manualStepsByRef || !refs || refs.length === 0) return null;
  const steps = refs.map((ref) => manualStepsByRef.get(ref)).filter(Boolean);
  return steps.length === refs.length ? steps[0] : null;
}

function classifyCoverage({
  detection = null,
  genericEntities = [],
  unprofiledRoutes = [],
  targetKnowledge = null,
  entityStatsByRoute = new Map(),
  // The human-signed register (capabilities-without-native-target.json). The ONLY source of
  // requires-development. Entries carry decidedBy/decidedOn/evidence; a bare Set of capability
  // strings is also accepted.
  humanRuledOutCapabilities = new Set(),
  requiresDevelopmentEntries = [],
  // Working notes for profiled capabilities we have not placed (capabilities-pending-decision.json).
  pendingNotes = [],
  // The no-migration-needed file, both tiers:
  //   hints[]        - installed plugins with no data to move at all. A hit here is strong
  //                    evidence, not the final answer — the agent confirms it during classification and
  //                    records the rationale; the row is marked `basis: list` so an
  //                    unconfirmed hit is auditable.
  //   capabilities[] - human-signed per-capability verdicts on PROFILED plugins, the only way
  //                    a profiled capability reaches no-need-to-migrate. `basis: decision`.
  noMigrationNeeded = null,
} = {}) {
  const rows = [];
  const knownRefs = targetKnowledge?.knownRefs || new Set();
  const capabilityRefs = targetKnowledge?.capabilityRefs || new Map();

  const ruledOut = new Map();
  for (const entry of requiresDevelopmentEntries) {
    if (entry && entry.capability) ruledOut.set(entry.capability, entry);
  }
  for (const capability of humanRuledOutCapabilities) {
    if (!ruledOut.has(capability)) ruledOut.set(capability, null);
  }
  const pendingByCapability = new Map(
    pendingNotes.filter((entry) => entry && entry.capability).map((entry) => [entry.capability, entry]),
  );
  const hintsBySlug = new Map();
  for (const hint of noMigrationNeeded?.hints || []) {
    if (hint && hint.slug) hintsBySlug.set(hint.slug, hint);
  }
  // Only a SIGNED entry grants the verdict. An unsigned one is ignored here rather than
  // trusted, so a stale or hand-edited copy of the register cannot let automation decide a
  // customer has nothing to move; the validator rejects it in the repo, and the row falls
  // through to pending at runtime, which is the safe direction.
  const noNeedByCapability = new Map();
  for (const entry of noMigrationNeeded?.capabilities || []) {
    if (entry && entry.capability && entry.decidedBy && entry.decidedOn) {
      noNeedByCapability.set(entry.capability, entry);
    }
  }

  const byCapability = new Map();
  for (const plugin of detection?.detected || []) {
    for (const capability of plugin.capabilities) {
      if (!byCapability.has(capability)) byCapability.set(capability, []);
      byCapability.get(capability).push(plugin);
    }
  }

  // Recognized capabilities are classified independently. A resolved target is migration-planned
  // even when its source channel is blocked; an unresolved capability remains pending.
  for (const [capability, plugins] of byCapability) {
    const entities = plugins.flatMap((plugin) => {
      const hasAttribution = plugin.entities.some((entity) => entity.capability);
      return hasAttribution
        ? plugin.entities.filter((entity) => entity.capability === capability)
        : plugin.entities;
    });
    const refs = Array.from(new Set(entities.flatMap((entity) => entity.candidateTargetRefs)))
      .filter((ref) => knownRefs.has(ref));
    const nativeRefs = capabilityRefs.get(capability) || [];
    const recordCounts = {};
    for (const entity of entities) {
      const stats = entity.route ? entityStatsByRoute.get(entity.route) : null;
      if (stats && stats.recordCount !== null) recordCounts[entity.entity] = stats.recordCount;
    }

    const channels = Array.from(new Set(entities.map((entity) => entity.channel))).sort();
    const base = {
      capability,
      recognized: true,
      basis: 'profile',
      plugins: plugins.map((plugin) => plugin.plugin).sort(),
      sourceEntities: entities.map((entity) => entity.entity).sort(),
      recordCounts,
      channels,
      channel: channels.length === 1 ? channels[0] : channels.join('+'),
      profileVersion: Array.from(new Set(plugins.map((plugin) => plugin.profileVersion).filter(Boolean))).join('+') || null,
      pitfalls: entities.flatMap((entity) => entity.pitfalls),
      blocked: blockersForEntities(entities),
    };

    let row;
    const verdict = ruledOut.get(capability);
    const nativeRefsManualSteps = resolveManualMapping(nativeRefs, targetKnowledge);
    const refsManualSteps = resolveManualMapping(refs, targetKnowledge);
    if (ruledOut.has(capability)) {
      // Only reachable from the human-signed register.
      row = {
        ...base,
        status: 'requires-development',
        basis: 'decision',
        decidedBy: verdict?.decidedBy || null,
        decidedOn: verdict?.decidedOn || null,
        evidence: [...(verdict?.evidence || [])],
        targetRefs: [],
      };
    } else if (nativeRefs.length > 0 && nativeRefsManualSteps) {
      // For manual-mapping: every target ref this capability resolved to is manual-mapping — there is
      // nothing for our code to call, only a runbook to hand the merchant.
      row = {
        ...base,
        status: 'manual-mapping',
        via: 'manual',
        confidence: 'confirmed',
        targetRefs: [...nativeRefs].sort(),
        manualSteps: nativeRefsManualSteps,
      };
    } else if (nativeRefs.length > 0) {
      // How well the target entity is exercised is our problem, not the customer's: verified
      // and unverified native targets classify identically.
      row = { ...base, status: 'migration-planned', via: 'api', confidence: 'confirmed', targetRefs: [...nativeRefs].sort() };
    } else if (refs.length > 0 && refsManualSteps) {
      row = {
        ...base,
        status: 'manual-mapping',
        via: 'manual',
        confidence: 'confirmed',
        targetRefs: refs.sort(),
        manualSteps: refsManualSteps,
      };
    } else if (refs.length > 0) {
      const via = refs.every((ref) => ref.startsWith('cms/')) ? 'cms' : 'api';
      row = { ...base, status: 'migration-planned', via, confidence: 'confirmed', targetRefs: refs.sort() };
    } else if (noNeedByCapability.has(capability)) {
      // A human decided this profiled capability has nothing to move. Not impossibility
      // — the outcome exists in Wix, or was never data — but still a decision about
      // what the customer does not get, so it is signed and it is persistent: without this
      // exit the row re-lands as pending on every run and the verdict has nowhere to live.
      const decision = noNeedByCapability.get(capability);
      row = {
        ...base,
        status: 'no-need-to-migrate',
        basis: 'decision',
        reason: normalizeNoMigrationReason(decision.reason),
        replacedBy: decision.replacedBy || null,
        rationale: decision.rationale || null,
        decidedBy: decision.decidedBy,
        decidedOn: decision.decidedOn,
        targetRefs: [],
        // Nothing to move means nothing is blocked. An unreadable channel on a capability
        // that is not being migrated is not something to ask the user to fix.
        blocked: [],
      };
    } else {
      // A profiled capability we have not placed. Pending is a statement about OUR knowledge;
      // the working note carries what we searched and what we suspect, with no authority.
      const note = pendingByCapability.get(capability);
      row = {
        ...base,
        status: 'pending',
        reason: note?.reason || 'no Wix target resolved for this capability yet',
        searched: note?.searched ? [note.searched] : [],
        targetRefs: [],
      };
    }
    row.userImpact = describeImpact(row, entities);
    row.action = describeAction(row);
    rows.push(row);
  }

  // Attribute generic entities to an installed-but-unprofiled plugin BEFORE the shape-only
  // grouping below, and only when its slug/textdomain genuinely prefixes the entity's own
  // rest_base/slug. Two unrelated plugins that both register "a custom post type" or "a
  // custom taxonomy" must never end up sharing one row: a shared shape-bucket row attributed
  // wholesale to whichever plugin matched first previously let Disclaimer Popup (a site
  // popup) absorb Jetpack Pay's own order/product entities, MailPoet's post type, Npcink
  // Ad's promotions, and a duplicate of The Events Calendar's organizer/venue entities, while
  // DineKit absorbed an unrelated knowledge-base taxonomy (verified against a live WordPress installation).
  // An entity with no confidently-matched owner stays in the shape bucket, unattributed —
  // visible at the mapping review, credited to no one, which is honest; false attribution is
  // not.
  const MIN_OWNER_TOKEN_LENGTH = 4;
  const ownedEntityKeys = new Set();
  const attributed = new Set();
  for (const installed of detection?.installedButUnprofiled || []) {
    const tokens = pluginTokens(installed).filter((token) => token.length >= MIN_OWNER_TOKEN_LENGTH);
    const ownedEntities = genericEntities.filter((entity) => {
      const normalizedEntity = normalizeToken(entity.entity);
      return tokens.some((token) => normalizedEntity.startsWith(token));
    });
    if (ownedEntities.length === 0) continue;

    for (const entity of ownedEntities) ownedEntityKeys.add(entity.entity);
    const recordCounts = {};
    for (const entity of ownedEntities) {
      if (entity.recordCount !== null) recordCounts[entity.entity] = entity.recordCount;
    }
    const nativeRefs = Array.from(new Set(ownedEntities.map((entity) => entity.proposedCapability)))
      .flatMap((capability) => capabilityRefs.get(capability) || []);
    const via = nativeRefs.length > 0 ? 'api' : 'cms';
    const names = ownedEntities.map((entity) => entity.displayName).join(', ');
    rows.push({
      capability: `derived:${installed.plugin}`,
      recognized: false,
      basis: 'proposed',
      plugins: [installed.plugin],
      sourceEntities: ownedEntities.map((entity) => entity.entity).sort(),
      recordCounts,
      channels: Array.from(new Set(ownedEntities.map((entity) => entity.channel))).sort(),
      channel: 'core-cpt',
      profileVersion: null,
      status: 'migration-planned',
      via,
      confidence: 'proposed',
      targetRefs: via === 'api' ? Array.from(new Set(nativeRefs)).sort() : [...GENERIC_TARGET_REFS],
      pitfalls: [],
      blocked: [],
      hierarchicalEntities: ownedEntities.filter((entity) => entity.hierarchical).map((entity) => entity.entity),
      userImpact: via === 'api'
        ? `${names} appears to match a native Wix entity. We derived this mapping rather than authored it, so it is proposed and needs your confirmation at the mapping review.`
        : `${names} will come across as CMS collections, keeping original record IDs. We derived this mapping rather than authored it, so review it at the mapping review.`,
      action: null,
    });
    attributed.add(installed.plugin);
  }

  // Derived (unrecognized but readable) entities with no confidently-matched plugin owner,
  // grouped by proposed capability so the report stays one row per capability rather than one
  // row per derived post type. The proposal is matched against the domain KB: a confirmed
  // match maps via API, the same as a profiled plugin — but as `proposed`, decided at the
  // mapping review, never by automation alone.
  const genericByCapability = new Map();
  for (const entity of genericEntities) {
    if (ownedEntityKeys.has(entity.entity)) continue;
    if (!genericByCapability.has(entity.proposedCapability)) genericByCapability.set(entity.proposedCapability, []);
    genericByCapability.get(entity.proposedCapability).push(entity);
  }
  for (const [capability, group] of genericByCapability) {
    const recordCounts = {};
    for (const entity of group) {
      if (entity.recordCount !== null) recordCounts[entity.entity] = entity.recordCount;
    }
    const nativeRefs = capabilityRefs.get(capability) || [];
    const via = nativeRefs.length > 0 ? 'api' : 'cms';
    const names = group.map((entity) => entity.displayName).join(', ');
    rows.push({
      capability,
      recognized: false,
      basis: 'proposed',
      plugins: [],
      sourceEntities: group.map((entity) => entity.entity).sort(),
      recordCounts,
      channels: Array.from(new Set(group.map((entity) => entity.channel))).sort(),
      channel: 'core-cpt',
      profileVersion: null,
      status: 'migration-planned',
      via,
      confidence: 'proposed',
      targetRefs: via === 'api' ? [...nativeRefs].sort() : [...GENERIC_TARGET_REFS],
      pitfalls: [],
      blocked: [],
      hierarchicalEntities: group.filter((entity) => entity.hierarchical).map((entity) => entity.entity),
      userImpact: via === 'api'
        ? `${names} appears to match a native Wix entity. We derived this mapping rather than authored it, so it is proposed and needs your confirmation at the mapping review.`
        : `${names} will come across as CMS collections, keeping original record IDs. We derived this mapping rather than authored it, so review it at the mapping review.`,
      action: null,
    });
  }

  for (const unprofiled of unprofiledRoutes) {
    const read = unprofiled.read !== false;
    rows.push(read ? {
      capability: `unknown:${unprofiled.namespace}`,
      recognized: false,
      basis: 'proposed',
      plugins: [],
      sourceEntities: unprofiled.routes,
      recordCounts: {},
      channels: ['plugin-rest'],
      channel: 'plugin-rest',
      profileVersion: null,
      status: 'migration-planned',
      via: 'cms',
      confidence: 'proposed',
      targetRefs: [...GENERIC_TARGET_REFS],
      pitfalls: [],
      blocked: [],
      userImpact: `Records under ${unprofiled.namespace} look durable but we do not recognise the plugin that owns them. They were accepted by shape and will map to CMS collections unless you exclude them.`,
      action: null,
    } : {
      // Collection-shaped routes in an unrecognized namespace, deliberately not read (reading
      // them speculatively pulled in cookie-consent and object-cache config on a real store).
      // They surface as Pending so silence cannot read as "this plugin has nothing".
      capability: `unknown:${unprofiled.namespace}`,
      recognized: false,
      basis: 'proposed',
      plugins: [],
      sourceEntities: unprofiled.routes,
      recordCounts: {},
      channels: ['plugin-rest'],
      channel: 'plugin-rest',
      profileVersion: null,
      status: 'pending',
      reason: 'collection-shaped routes in an unrecognized namespace; not read by default',
      searched: [],
      targetRefs: [],
      pitfalls: [],
      blocked: [],
      userImpact: `${unprofiled.namespace} exposes ${unprofiled.routes.length} collection-style route(s) that look like they hold records, but we do not recognise this plugin and did not read them. If this plugin holds data you need, tell us and we will add support.`,
      action: 'Confirm whether this plugin holds data you need migrated.',
    });
  }

  // An installed-but-unprofiled plugin whose namespace IS being read is not unreadable — it is
  // unrecognized but covered by the generic tier. Attribute it to that row instead of emitting
  // a second, contradictory row that tells the user their data will not migrate when it will.
  // Runs unconditionally (not gated on the ownership attribution above): a plugin can genuinely
  // own both a generic CPT/taxonomy AND a separate unread custom namespace at once (MailPoet:
  // `mailpoet_email` CPT is owned and readable, `mailpoet/v1`'s 9 routes are a distinct,
  // unread namespace) — both facts belong on its row, not just whichever attributed first.
  for (const installed of detection?.installedButUnprofiled || []) {
    const tokens = pluginTokens(installed);
    const namespaceRow = unprofiledRoutes.find((entry) => tokens.some((token) => normalizeToken(entry.namespace.split('/')[0]) === token));
    if (namespaceRow) {
      const row = rows.find((candidate) => candidate.capability === `unknown:${namespaceRow.namespace}`);
      if (row) {
        row.plugins.push(installed.plugin);
        attributed.add(installed.plugin);
      }
    }
  }

  for (const installed of detection?.installedButUnprofiled || []) {
    if (attributed.has(installed.plugin)) continue;
    const slug = String(installed.plugin || '').split('/')[0];
    const hint = hintsBySlug.get(slug);
    if (hint) {
      // The no-migration-needed list: nothing to move. The row carries its rationale and is
      // marked `basis: list`, so the mapping review can see the answer came from the list
      // (the agent confirms it there — a list hit alone is evidence, not the decision).
      rows.push({
        capability: `no-migration-needed:${slug}`,
        recognized: false,
        basis: 'list',
        plugins: [installed.plugin],
        sourceEntities: [],
        recordCounts: {},
        channels: [],
        channel: null,
        profileVersion: null,
        status: 'no-need-to-migrate',
        reason: normalizeNoMigrationReason(hint.reason || hint.disposition),
        replacedBy: hint.replacedBy || null,
        rationale: [hint.does, hint.provenance ? `(${hint.provenance})` : null].filter(Boolean).join(' ')
          || 'Listed on the no-migration-needed list.',
        targetRefs: [],
        pitfalls: [],
        blocked: [],
        userImpact: hint.replacedBy || `${installed.name || slug} needs no data migration: ${hint.does || 'nothing to move'}.`,
        action: null,
      });
      continue;
    }
    // "cannot tell": an unrecognized plugin we can read no intent from. This is a
    // statement about OUR knowledge — the honest exit that stops classification from becoming
    // a silent way to drop data. Decided by a human at the mapping review, the only exit from
    // Pending. Deliberately says "could not identify", not "exposes no data": without a
    // profile we cannot tell whether it has no readable data or data we failed to attribute.
    rows.push({
      capability: `unknown-plugin:${installed.plugin}`,
      recognized: false,
      basis: 'proposed',
      plugins: [installed.plugin],
      sourceEntities: [],
      recordCounts: {},
      channels: [],
      channel: null,
      profileVersion: null,
      status: 'pending',
      reason: 'cannot-tell',
      searched: [],
      targetRefs: [],
      pitfalls: [],
      blocked: [],
      userImpact: `${installed.name || installed.plugin} is installed but we could not identify any migratable data for it. If it holds data you need, it will not migrate as things stand.`,
      action: 'Tell us if this plugin holds data you need; it may need an export file or plugin support added.',
    });
  }

  // Fingerprinted plugins — public evidence only, so typically an unauthenticated run
  // (detectPlugins already deduplicates against the installed list). Each classifies exactly
  // like an installed-but-unrecognized plugin: the no-migration-needed list can
  // clear it, otherwise it is Pending — never silently fine, and never a route in scope.
  for (const print of detection?.fingerprinted || []) {
    const hint = hintsBySlug.get(print.slug) || hintsBySlug.get(print.token);
    const name = print.displayName || print.token;
    if (hint) {
      rows.push({
        capability: `no-migration-needed:${print.slug}`,
        recognized: false,
        basis: 'list',
        plugins: [print.slug],
        sourceEntities: [],
        recordCounts: {},
        channels: [],
        channel: null,
        profileVersion: null,
        status: 'no-need-to-migrate',
        reason: normalizeNoMigrationReason(hint.reason || hint.disposition),
        replacedBy: hint.replacedBy || null,
        rationale: [hint.does, hint.provenance ? `(${hint.provenance})` : null].filter(Boolean).join(' ')
          || 'Listed on the no-migration-needed list.',
        targetRefs: [],
        pitfalls: [],
        blocked: [],
        fingerprintEvidence: print.evidence,
        userImpact: hint.replacedBy || `${name} needs no data migration: ${hint.does || 'nothing to move'}.`,
        action: null,
      });
      continue;
    }
    rows.push({
      capability: `fingerprinted:${print.token}`,
      recognized: false,
      basis: 'proposed',
      plugins: [print.slug],
      sourceEntities: [],
      recordCounts: {},
      channels: [],
      channel: null,
      profileVersion: null,
      status: 'pending',
      reason: 'cannot-tell',
      searched: [],
      targetRefs: [],
      pitfalls: [],
      blocked: [],
      fingerprintEvidence: print.evidence,
      userImpact: `${name} is visible on the site (public fingerprint) but we could not read what it holds${print.aliasMatched ? '' : ' and do not recognise it'}. If it holds data you need, it will not migrate as things stand.`,
      action: 'Tell us if this plugin holds data you need; an administrator credential or plugin support may be required.',
    });
  }

  for (const row of rows) row.plugins = Array.from(new Set(row.plugins)).sort();
  return rows.sort((a, b) => a.capability.localeCompare(b.capability));
}

const NO_MIGRATION_REASONS = new Set(['platform-does-it', 'not-needed', 'reconfigure-in-wix']);

// Accept the legacy `platform-replaced` value so a stale vendored list cannot crash a run;
// the shipped list uses the spec vocabulary.
function normalizeNoMigrationReason(value) {
  if (NO_MIGRATION_REASONS.has(value)) return value;
  if (value === 'platform-replaced') return 'platform-does-it';
  return 'not-needed';
}

function normalizeToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Identity tokens for an installed plugin: its directory slug and its textdomain. Both are
// conventionally derived from the same name, which is what makes namespace correlation work.
function pluginTokens(installed) {
  const tokens = new Set();
  const dir = String(installed.plugin || '').split('/')[0];
  if (dir) tokens.add(normalizeToken(dir));
  if (installed.textdomain) tokens.add(normalizeToken(installed.textdomain));
  return Array.from(tokens).filter(Boolean);
}

function describeImpact(row, entities) {
  // A signed "nothing to move" row is not a loss report: whatever its entities' pitfalls say
  // about unmovable fields, the decision already accounts for them. The verdict is what the
  // customer reads, and the rationale on the row carries the detail.
  if (row.status === 'no-need-to-migrate') {
    return [
      row.replacedBy
        ? `${row.capability} needs no data migration: ${row.replacedBy}.`
        : `${row.capability} needs no data migration.`,
      row.decidedBy ? `Decided by ${row.decidedBy}${row.decidedOn ? ` on ${row.decidedOn}` : ''}.` : null,
    ].filter(Boolean).join(' ');
  }
  const blockers = entities.flatMap((entity) => entity.pitfalls).filter((pitfall) => pitfall.severity === 'blocker');
  if (blockers.length > 0) return blockers[0].summary;
  switch (row.status) {
    case 'migration-planned':
      return row.via === 'api'
        ? `${row.capability} comes across into a native Wix entity.`
        : `${row.capability} comes across into Wix CMS collections, keeping original record IDs. Wix has no matching feature, so the data is preserved but nothing acts on it until a page is built against it.`;
    case 'manual-mapping':
      return `${row.capability} is a complete, decided mapping — Wix can do this, but reaching it takes a few steps you click through yourself, not something our code writes for you.`;
    case 'requires-development':
      return `${row.capability} has no Wix surface today; someone has to build it before this data can move.${row.decidedBy ? ` Decided by ${row.decidedBy}.` : ''}`;
    case 'pending':
      return `${row.capability} is not resolved yet — we do not know how to migrate it. Our open item, pending our review; never a statement that Wix cannot do it.`;
    default:
      return `${row.capability} coverage status: ${row.status}.`;
  }
}

function describeAction(row) {
  if (row.status === 'pending') {
    return 'Tell us if this capability is needed for your migration so we can prioritise resolving it.';
  }
  return null;
}

function coverageSummary(rows) {
  const byStatus = {};
  const byVia = {};
  const byConfidence = {};
  let recognized = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.recognized) recognized += 1;
    if (row.status === 'migration-planned') {
      byVia[row.via] = (byVia[row.via] || 0) + 1;
      byConfidence[row.confidence] = (byConfidence[row.confidence] || 0) + 1;
    }
  }
  return {
    capabilities: rows.length,
    recognized,
    byStatus: Object.fromEntries(Object.entries(byStatus).sort(([a], [b]) => a.localeCompare(b))),
    byVia: Object.fromEntries(Object.entries(byVia).sort(([a], [b]) => a.localeCompare(b))),
    byConfidence: Object.fromEntries(Object.entries(byConfidence).sort(([a], [b]) => a.localeCompare(b))),
    // The batched blocked-but-recoverable ask (J1 step 9): everything here is asked once,
    // individually skippable, and never a mapping decision.
    blocked: rows
      .filter((row) => (row.blocked || []).length > 0)
      .map((row) => ({ capability: row.capability, status: row.status, blocked: row.blocked })),
  };
}

function summarizeDetection(inventory) {
  return {
    pluginListAvailable: Boolean(inventory.pluginListAvailable),
    detected: (inventory.detected || []).map((plugin) => ({
      plugin: plugin.plugin,
      confidence: plugin.confidence,
      capabilities: plugin.capabilities,
      channels: Array.from(new Set((plugin.entities || []).map((entity) => entity.channel))).sort(),
    })),
    unprofiledNamespaces: (inventory.unprofiled || []).map((entry) => entry.namespace),
    installedButUnprofiledCount: (inventory.installedButUnprofiled || []).length,
    fingerprintedCount: (inventory.fingerprinted || []).length,
  };
}

// Collect record property keys from sampled entities so core-embedded and core-meta plugins
// — the ones that add no REST route at all — are detectable at all. Top-level keys catch
// core-embedded injections (e.g. yoast_head_json). Registered postmeta (core-meta) is a
// different shape: WooCommerce/WordPress expose it as entries inside a `meta_data` array
// (`[{key, value}, ...]`), not as a literal top-level property — several major WooCommerce
// extensions (Meta for WooCommerce's `_wc_facebook_*` keys, Discount Rules' `_wdr_discounts`)
// store their data exactly this way, so meta_data keys are collected into the same set a
// core-meta profile's recordProperties/propertyPath is checked against.
//
// An order's own meta_data is one layer; WooCommerce order LINE ITEMS carry their own,
// nested one layer deeper still (VERIFIED 2026-08-11 against the woo-discount-rules plugin
// source: it writes `_wdr_discounts` to the order item via `setOrderItemMeta`, not just to
// the order). Same failure shape as the order-level case, one layer in — so line_items[]
// meta_data is scanned too, or a per-item-only key would stay invisible to detection.
function collectRecordProperties(entities) {
  const properties = new Set();
  const collectMetaDataKeys = (record) => {
    if (!record || typeof record !== 'object' || !Array.isArray(record.meta_data)) return;
    for (const meta of record.meta_data) {
      if (meta && typeof meta.key === 'string') properties.add(meta.key);
    }
  };
  for (const entity of entities || []) {
    for (const record of entity.sampleRecords || []) {
      if (!record || typeof record !== 'object') continue;
      for (const key of Object.keys(record)) properties.add(key);
      collectMetaDataKeys(record);
      if (Array.isArray(record.line_items)) {
        for (const lineItem of record.line_items) collectMetaDataKeys(lineItem);
      }
    }
  }
  return Array.from(properties).sort();
}

module.exports = {
  COVERAGE_STATUSES,
  SIGNAL_CONFIDENCE,
  GENERIC_TARGET_REFS,
  detectPlugins,
  describeProfiledEntity,
  collectUnprofiledRoutes,
  collectCandidateNamespaces,
  deriveGenericEntities,
  proposeCapability,
  classifyCoverage,
  coverageSummary,
  summarizeDetection,
  collectRecordProperties,
  compareVersions,
};
