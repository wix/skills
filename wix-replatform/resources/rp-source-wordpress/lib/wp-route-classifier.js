'use strict';

const ROUTE_CATEGORIES = new Set([
  'backend_data',
  'backend_metadata',
  'public_commerce_data',
  'excluded_frontend',
  'excluded_template_editor',
  'excluded_runtime_session',
  'excluded_admin_dashboard',
  'excluded_diagnostics',
  'excluded_integration',
  'excluded_marketplace_setup',
  'excluded_unsupported',
]);

const FRONTEND_RULES = [
  ['/wp/v2/pages', 'wp.frontend.pages', 'site composition pages are outside backend data scope'],
  ['/wp/v2/navigation', 'wp.frontend.navigation', 'navigation is site composition, not backend data'],
  ['/wp/v2/menus', 'wp.frontend.menus', 'menus are site composition, not backend data'],
  ['/wp/v2/menu-items', 'wp.frontend.menu-items', 'menu items are site composition, not backend data'],
  ['/wp/v2/menu-locations', 'wp.frontend.menu-locations', 'menu locations are presentation configuration'],
  ['/wp/v2/search', 'wp.frontend.search', 'search is a frontend lookup helper'],
  ['/oembed/1.0/*', 'wp.frontend.oembed', 'oEmbed routes are frontend embedding helpers'],
];

const TEMPLATE_EDITOR_RULES = [
  ['/wp/v2/templates*', 'wp.editor.templates', 'templates are theme/editor construction state'],
  ['/wp/v2/template-parts*', 'wp.editor.template-parts', 'template parts are theme/editor construction state'],
  ['/wp/v2/blocks', 'wp.editor.blocks', 'blocks are editor construction state'],
  ['/wp/v2/block-types', 'wp.editor.block-types', 'block types are editor metadata'],
  ['/wp/v2/block-directory/*', 'wp.editor.block-directory', 'block directory routes are editor helpers'],
  ['/wp/v2/block-patterns/*', 'wp.editor.block-patterns', 'block pattern routes are editor helpers'],
  ['/wp/v2/pattern-directory/*', 'wp.editor.pattern-directory', 'pattern directory routes are editor helpers'],
  ['/wp/v2/wp_pattern_category', 'wp.editor.pattern-category', 'pattern categories are editor helpers'],
  ['/wp-block-editor/*', 'wp.editor.namespace', 'block editor namespace is outside backend data scope'],
  ['/wp/v2/widgets', 'wp.editor.widgets', 'widgets are presentation configuration'],
  ['/wp/v2/widget-types', 'wp.editor.widget-types', 'widget types are presentation metadata'],
  ['/wp/v2/sidebars', 'wp.editor.sidebars', 'sidebars are presentation configuration'],
  ['/wp/v2/themes', 'wp.editor.themes', 'themes are presentation configuration'],
  ['/wp/v2/font-*', 'wp.editor.fonts', 'font routes describe presentation assets'],
  ['/wp/v2/icons', 'wp.editor.icons', 'icons describe presentation assets'],
];

const RUNTIME_RULES = [
  ['/wc/store/cart*', 'wc.runtime.cart', 'store cart routes are customer-session state'],
  ['/wc/store/checkout*', 'wc.runtime.checkout', 'store checkout routes are customer-session state'],
  ['/wc/store/v1/cart*', 'wc.runtime.v1.cart', 'store cart routes are customer-session state'],
  ['/wc/store/v1/checkout*', 'wc.runtime.v1.checkout', 'store checkout routes are customer-session state'],
];

const ADMIN_RULES = [
  ['/wc-admin/*', 'wc.admin.namespace', 'WooCommerce admin routes are dashboard surfaces'],
  ['/wc-analytics/*', 'wc.admin.analytics', 'WooCommerce analytics routes are dashboard/reporting surfaces'],
  ['/wc/v1/reports*', 'wc.admin.reports.v1', 'WooCommerce reports are analytics surfaces'],
  ['/wc/v2/reports*', 'wc.admin.reports.v2', 'WooCommerce reports are analytics surfaces'],
  ['/wc/v3/reports*', 'wc.admin.reports.v3', 'WooCommerce reports are analytics surfaces'],
];

const MARKETPLACE_RULES = [
  ['/wc/v3/marketplace/*', 'wc.setup.marketplace', 'WooCommerce marketplace routes are setup surfaces'],
  ['/wc/v3/system_status*', 'wc.setup.system-status', 'WooCommerce system status routes are operational diagnostics'],
  ['/wc/v3/settings', 'wc.setup.settings', 'WooCommerce settings are setup/configuration surfaces'],
  ['/wc/v3/wc_paypal/*', 'wc.setup.paypal', 'WooCommerce PayPal routes are provider setup surfaces'],
  ['/wc/v3/wc_stripe/*', 'wc.setup.stripe', 'WooCommerce Stripe routes are provider setup surfaces'],
  ['/wccom-site/*', 'wc.setup.wccom-site', 'WooCommerce.com routes are marketplace/setup surfaces'],
  ['/wc/gla/*', 'wc.setup.google-listings', 'Google Listings and Ads routes are setup/reporting surfaces'],
];

const DIAGNOSTIC_RULES = [
  ['/wp-site-health/*', 'wp.diagnostics.site-health', 'site health routes are diagnostics'],
  ['/wp-abilities/*', 'wp.diagnostics.abilities', 'abilities routes are capability discovery'],
  ['/serviceapp/*', 'wp.diagnostics.serviceapp', 'service app routes are operational surfaces'],
  ['/vip/*', 'wp.diagnostics.vip', 'VIP routes are operational surfaces'],
];

const INTEGRATION_RULES = [
  ['/jetpack/*', 'wp.integration.jetpack', 'Jetpack routes are external service or site operations surfaces'],
  ['/post-smtp/*', 'wp.integration.post-smtp', 'SMTP routes are mail operations surfaces'],
  ['/redirection/*', 'wp.integration.redirection', 'redirection routes are operational helper surfaces'],
  ['/yoast/*', 'wp.integration.yoast', 'SEO helper routes are outside backend data scope'],
  ['/klaviyo/*', 'wp.integration.klaviyo', 'marketing integration routes are outside backend data scope'],
  ['/kb-fluentcrm/*', 'wp.integration.fluentcrm', 'marketing integration routes are outside backend data scope'],
  ['/kb-getresponse/*', 'wp.integration.getresponse', 'marketing integration routes are outside backend data scope'],
  ['/kb-mailerlite/*', 'wp.integration.mailerlite', 'marketing integration routes are outside backend data scope'],
  ['/kb-design-library/*', 'wp.integration.design-library', 'design library routes are presentation helpers'],
  ['/kbp/*', 'wp.integration.kbp', 'AI or pattern helper routes are outside backend data scope'],
];

const BACKEND_DATA_RULES = [
  ['/wp/v2/posts', 'wp.data.posts', 'posts are durable content records'],
  ['/wp/v2/media', 'wp.data.media', 'media are durable asset records'],
  ['/wp/v2/categories', 'wp.data.categories', 'categories are durable taxonomy records'],
  ['/wp/v2/tags', 'wp.data.tags', 'tags are durable taxonomy records'],
  ['/wp/v2/comments', 'wp.data.comments', 'comments are durable content records'],
  ['/wc/v3/products/attributes*', 'wc.data.product-attributes', 'WooCommerce product attributes are canonical store data'],
  ['/wc/v3/products/categories*', 'wc.data.product-categories', 'WooCommerce product categories are canonical store data'],
  ['/wc/v3/products/tags*', 'wc.data.product-tags', 'WooCommerce product tags are canonical store data'],
  ['/wc/v3/products/shipping_classes*', 'wc.data.shipping-classes', 'WooCommerce shipping classes are canonical store data'],
  ['/wc/v3/products*', 'wc.data.products', 'WooCommerce products are canonical store data'],
  ['/wc/v3/coupons*', 'wc.data.coupons', 'WooCommerce coupons are canonical store data'],
  ['/wc/v3/orders*', 'wc.data.orders', 'WooCommerce orders are canonical store data'],
  ['/wc/v3/refunds*', 'wc.data.refunds', 'WooCommerce refunds are canonical store data'],
  ['/wc/v3/customers*', 'wc.data.customers', 'WooCommerce customers are canonical store data'],
  // Must precede /wc/v3/taxes* (first-match-wins) — it's a prefix of that route.
  ['/wc/v3/taxes/classes*', 'wc.data.tax-classes', 'WooCommerce tax classes are canonical store data'],
  ['/wc/v3/taxes*', 'wc.data.taxes', 'WooCommerce taxes are canonical store data'],
  ['/wc/v3/shipping/zones', 'wc.data.shipping-zones', 'WooCommerce shipping zones are canonical store configuration'],
  ['/wc/v3/shipping_methods', 'wc.data.shipping-method-types', 'WooCommerce shipping method types are canonical store configuration'],
];

const BACKEND_METADATA_RULES = [
  {
    pattern: '/wc/v3/data/currencies*',
    ruleId: 'wc.metadata.currencies',
    reason: 'currency metadata may be needed to interpret WooCommerce records',
    requiredPatterns: ['/wc/v3/products*', '/wc/v3/orders*', '/wc/v3/coupons*'],
  },
  {
    pattern: '/wc/v3/data/countries*',
    ruleId: 'wc.metadata.countries',
    reason: 'country metadata may be needed to interpret WooCommerce tax and customer records',
    requiredPatterns: ['/wc/v3/customers*', '/wc/v3/taxes*', '/wc/v3/orders*'],
  },
];

// Route -> extra query parameters the sampler must send to see the WHOLE collection.
//
// A WP REST collection route is free to apply a default filter when the caller sends no
// parameters, and several do. Discovery samples with `per_page` and nothing else, so it
// silently sees the filtered subset and the plan under-counts — the entity looks smaller
// than it is and the hidden records never reach the mapper. This is a CLASS of bug, not one
// route: any route with a defaulted status/type/scope filter has it.
//
// The fix is a table, not a special case in the sampler: add the route and the parameters
// that turn the filter off, with the reason. Kept next to the other route pattern tables
// (BACKEND_DATA_RULES et al.) because these are facts about core routes; patterns use the
// same `*` suffix matching, longest pattern wins, and a route with no entry gets `{}`.
const ROUTE_DEFAULT_QUERY_RULES = [
  [
    '/wc/v3/products/reviews*',
    { status: 'all' },
    'WooCommerce defaults product reviews to status=approved, hiding hold/spam/trash rows; observed live 2026-08-16 on the reference store as 114 of 120 reviews (6 on hold invisible to the plan)',
  ],
];

function defaultQueryRuleFor(routePath) {
  const normalized = normalizeRoutePath(routePath);
  return ROUTE_DEFAULT_QUERY_RULES
    .filter(([pattern]) => routeMatchesPattern(normalized, pattern))
    .sort((a, b) => b[0].length - a[0].length)[0] || null;
}

// The query parameters to add when sampling `routePath`, or {} when the route has no
// documented default filter. Copied so a caller cannot mutate the rule table; callers merge
// their own paging parameters over the result.
function defaultQueryFor(routePath) {
  const rule = defaultQueryRuleFor(routePath);
  return rule ? { ...rule[1] } : {};
}

// The human-readable reason a default query applies, for the discovery note that tells a
// reader why this route was sampled with extra parameters. Null when none applies.
function defaultQueryReasonFor(routePath) {
  const rule = defaultQueryRuleFor(routePath);
  return rule ? rule[2] : null;
}

// Plugin route rules are DATA, not code: they come from the declarative profiles under
// plugins/. Adding or correcting a plugin is a JSON edit plus a fixture, never a change
// here. Loaded once and memoized; tests inject rules directly via overrides.pluginRules.
let memoizedPluginRules = null;

function defaultPluginRules() {
  if (memoizedPluginRules) return memoizedPluginRules;
  try {
    // Required lazily so this module stays usable (with no plugin rules) if the profile
    // directory is absent, e.g. a partial install.
    const { pluginsRoot, buildRouteRules } = require('./plugin-knowledge.js');
    memoizedPluginRules = buildRouteRules(pluginsRoot());
  } catch (error) {
    memoizedPluginRules = { dataRules: [], excludeRules: [], loadError: error.message };
  }
  return memoizedPluginRules;
}

function resetPluginRuleCache() {
  memoizedPluginRules = null;
}

const LEGACY_WC_PREFIXES = [
  '/wc/v1/products',
  '/wc/v1/coupons',
  '/wc/v1/orders',
  '/wc/v1/refunds',
  '/wc/v1/customers',
  '/wc/v1/taxes',
  '/wc/v1/taxes/classes',
  '/wc/v2/products',
  '/wc/v2/coupons',
  '/wc/v2/orders',
  '/wc/v2/refunds',
  '/wc/v2/customers',
  '/wc/v2/taxes',
  '/wc/v2/taxes/classes',
];

function normalizeRoutePath(routePath) {
  if (typeof routePath !== 'string' || routePath.length === 0) {
    return '/';
  }
  return routePath.startsWith('/') ? routePath : `/${routePath}`;
}

function routeMatchesPattern(routePath, pattern) {
  const route = normalizeRoutePath(routePath);
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1);
    return route.startsWith(prefix);
  }
  if (pattern.endsWith('*')) {
    return route.startsWith(pattern.slice(0, -1));
  }
  return route === pattern;
}

// A WP REST index parameterized route looks like /wc/v3/orders/(?P<id>[\d]+)/notes.
// Normalizing every parameter segment to the same {parentId} placeholder a plugin-rest-child
// entity's `route` template uses lets that template be checked against the index without
// needing to know (or match) the parameter's name.
function normalizeIndexRouteTemplate(routePath) {
  return routePath.replace(/\(\?P<[^>]+>[^)]*\)/g, '{parentId}');
}

// Whether the site's REST index advertises a route matching a plugin-rest-child entity's
// templated route (e.g. /wc/v3/orders/{parentId}/notes). This is a presence check only — it
// says the sub-resource exists on this site, not that any parent record actually has data
// there; that requires a live per-parent sample (see wp-discovery.js sampleChildEntities).
function childRouteAdvertised(restIndexRoutes, template) {
  const routes = restIndexRoutes && typeof restIndexRoutes === 'object' ? Object.keys(restIndexRoutes) : [];
  return routes.some((route) => normalizeIndexRouteTemplate(route) === template);
}

function findMatchingRule(routePath, rules) {
  for (const rule of rules) {
    const [pattern, ruleId, reason] = rule;
    if (routeMatchesPattern(routePath, pattern)) {
      return { ruleId, reason };
    }
  }
  return null;
}

function actionForCategory(category) {
  if (category === 'backend_data' || category === 'public_commerce_data') {
    return 'sample';
  }
  if (category === 'backend_metadata') {
    return 'metadata';
  }
  return 'skip';
}

function makeClassification(candidate, category, reason, ruleId, extra = {}) {
  return {
    routePath: candidate.routePath,
    namespace: candidate.namespace,
    category,
    reason,
    ruleId,
    sampleByDefault: category === 'backend_data',
    canIncludeByOverride: category !== 'backend_data',
    includedByOverride: false,
    excludedByOverride: false,
    effectiveAction: actionForCategory(category),
    ...extra,
  };
}

function candidateHasCollectionShape(candidate) {
  return Boolean(candidate.supportsPagination || candidate.getEndpoint?.args?.per_page || candidate.getEndpoint?.args?.page);
}

function hasSchema(candidate) {
  return Boolean(candidate.getEndpoint?.schema || candidate.routeDefinition?.schema);
}

function classifyStoreCatalogRoute(candidate, routeSet, options = {}) {
  const routePath = candidate.routePath;
  let canonicalRoute = null;
  let ruleId = null;
  let reason = null;

  if (routeMatchesPattern(routePath, '/wc/store/v1/products/categories*')) {
    canonicalRoute = '/wc/v3/products/categories';
    ruleId = 'wc.public-store.product-categories';
    reason = 'WooCommerce Store API product categories expose durable public commerce taxonomy data';
  } else if (routeMatchesPattern(routePath, '/wc/store/v1/products*')) {
    canonicalRoute = '/wc/v3/products';
    ruleId = 'wc.public-store.products';
    reason = 'WooCommerce Store API products expose durable public commerce catalog data';
  } else {
    return null;
  }

  const commerceMode = options.commerceMode || 'authenticated';
  if (commerceMode !== 'public' && routeSet.has(canonicalRoute)) {
    return makeClassification(
      candidate,
      'excluded_unsupported',
      `duplicated by canonical ${canonicalRoute} for authenticated/private commerce reads`,
      'wc.public-store.duplicate',
      { duplicateOf: canonicalRoute },
    );
  }

  return makeClassification(candidate, 'public_commerce_data', reason, ruleId, {
    canonicalRoute: routeSet.has(canonicalRoute) ? canonicalRoute : null,
    commerceMode,
  });
}

function classifyLegacyWooCommerceRoute(candidate, routeSet) {
  const routePath = candidate.routePath;
  const legacyPrefix = LEGACY_WC_PREFIXES.find((prefix) => routeMatchesPattern(routePath, `${prefix}*`));
  if (!legacyPrefix) {
    return null;
  }

  const canonicalRoute = routePath.replace(/^\/wc\/v[12]\//, '/wc/v3/');
  if (routeSet.has(canonicalRoute)) {
    return makeClassification(
      candidate,
      'excluded_unsupported',
      `duplicated by canonical ${canonicalRoute}`,
      'wc.duplicate.legacy-version',
      { duplicateOf: canonicalRoute },
    );
  }

  return makeClassification(
    candidate,
    'backend_data',
    'legacy WooCommerce data route accepted because wc/v3 equivalent is unavailable',
    'wc.data.legacy',
  );
}

const EXCLUSION_RULE_GROUPS = [
  ['excluded_frontend', FRONTEND_RULES],
  ['excluded_template_editor', TEMPLATE_EDITOR_RULES],
  ['excluded_runtime_session', RUNTIME_RULES],
  ['excluded_admin_dashboard', ADMIN_RULES],
  ['excluded_marketplace_setup', MARKETPLACE_RULES],
  ['excluded_diagnostics', DIAGNOSTIC_RULES],
  ['excluded_integration', INTEGRATION_RULES],
];

function findExclusion(routePath) {
  for (const [category, rules] of EXCLUSION_RULE_GROUPS) {
    const rule = findMatchingRule(routePath, rules);
    if (rule) return { category, ...rule };
  }
  return null;
}

// Every route pattern owned by the classifier itself. Exported so the plugin knowledge
// validator can refuse a profile route that silently shadows a core rule.
function coreRulePatterns() {
  const patterns = new Set();
  for (const [, rules] of EXCLUSION_RULE_GROUPS) {
    for (const [pattern] of rules) patterns.add(pattern);
  }
  for (const [pattern] of BACKEND_DATA_RULES) patterns.add(pattern);
  for (const rule of BACKEND_METADATA_RULES) patterns.add(rule.pattern);
  return patterns;
}

function classifyBaseRoute(candidate, routeSet, options = {}) {
  const routePath = candidate.routePath;
  const pluginRules = options.pluginRules || { dataRules: [], excludeRules: [] };

  // Precedence: profile excludeRoutes > profile data routes > existing
  // category rules > collection-shape fallback > unsupported.default. Profile data routes
  // beat exclusion families because an explicitly listed route IS the per-capability
  // opt-in; profiles cannot use a broad wildcard to reopen a family (validator enforces
  // at least two concrete leading segments).
  const pluginExclusion = findMatchingRule(routePath, pluginRules.excludeRules);
  if (pluginExclusion) {
    const existing = findExclusion(routePath);
    return makeClassification(
      candidate,
      existing ? existing.category : 'excluded_unsupported',
      pluginExclusion.reason,
      pluginExclusion.ruleId,
    );
  }

  const pluginData = findMatchingRule(routePath, pluginRules.dataRules);
  if (pluginData) {
    return makeClassification(candidate, 'backend_data', pluginData.reason, pluginData.ruleId);
  }

  const exclusion = findExclusion(routePath);
  if (exclusion) {
    return makeClassification(candidate, exclusion.category, exclusion.reason, exclusion.ruleId);
  }

  const storeCatalogClassification = classifyStoreCatalogRoute(candidate, routeSet, options);
  if (storeCatalogClassification) {
    return storeCatalogClassification;
  }

  const legacyWooCommerce = classifyLegacyWooCommerceRoute(candidate, routeSet);
  if (legacyWooCommerce) {
    return legacyWooCommerce;
  }

  const dataRule = findMatchingRule(routePath, BACKEND_DATA_RULES);
  if (dataRule) {
    return makeClassification(candidate, 'backend_data', dataRule.reason, dataRule.ruleId);
  }

  const metadataRule = BACKEND_METADATA_RULES.find((rule) => routeMatchesPattern(routePath, rule.pattern));
  if (metadataRule) {
    return makeClassification(candidate, 'backend_metadata', metadataRule.reason, metadataRule.ruleId, {
      requiredPatterns: metadataRule.requiredPatterns,
    });
  }

  // Registered non-core post types and taxonomies are persisted-record collections by
  // definition, so /wp/v2/types + /wp/v2/taxonomies are positive evidence rather than a
  // heuristic. This is the rule that makes custom post types discoverable at all:
  // VERIFIED LIVE 2026-07-30 that the WordPress REST index advertises `schema` on ZERO
  // routes (0 of 957 on a real site), so the collection-shape fallbacks below — which
  // require hasSchema() — never fire in production. Without this rule a plugin CPT is
  // invisible unless someone hardcodes its route.
  const registered = options.registeredRestBases instanceof Map
    ? options.registeredRestBases.get(routePath)
    : null;
  if (registered) {
    return makeClassification(
      candidate,
      'backend_data',
      `${registered.kind === 'taxonomy' ? 'taxonomy' : 'post type'} "${registered.slug}" is registered and REST-visible, so its collection holds persisted records`,
      'wp.data.registered-type',
      { registeredType: registered.slug, registeredKind: registered.kind, hierarchical: registered.hierarchical === true },
    );
  }

  if (candidate.namespace === 'wp/v2' && candidateHasCollectionShape(candidate) && hasSchema(candidate)) {
    return makeClassification(
      candidate,
      'backend_data',
      'wp/v2 collection route has persisted-record shape and is not otherwise excluded',
      'wp.data.custom-collection',
    );
  }

  if (candidateHasCollectionShape(candidate) && hasSchema(candidate)) {
    return makeClassification(
      candidate,
      'backend_data',
      'collection route has persisted-record REST shape and is not otherwise excluded',
      'plugin.data.collection-shape',
    );
  }

  return makeClassification(
    candidate,
    'excluded_unsupported',
    'route is not in the backend data allowlist and does not have an accepted collection shape',
    'unsupported.default',
  );
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(Boolean).map(String);
}

function normalizeOverrides(overrides = {}) {
  return {
    includeRoutes: normalizeList(overrides.includeRoutes).map(normalizeRoutePath),
    includeNamespaces: normalizeList(overrides.includeNamespaces),
    includeExcludedCategories: normalizeList(overrides.includeExcludedCategories),
    excludeRoutes: normalizeList(overrides.excludeRoutes).map(normalizeRoutePath),
    overrideReason: overrides.overrideReason ? String(overrides.overrideReason) : null,
    commerceMode: overrides.commerceMode === 'public' ? 'public' : 'authenticated',
    // Tests and callers may inject rules; otherwise the checked-in profiles are used.
    pluginRules: overrides.pluginRules || defaultPluginRules(),
    registeredRestBases: overrides.registeredRestBases instanceof Map ? overrides.registeredRestBases : null,
  };
}

// Build the route -> registered-type lookup consumed by the wp.data.registered-type rule.
// Core types/taxonomies are excluded: they already have explicit allowlist rules, or are
// deliberately excluded site-composition surfaces.
const CORE_POST_TYPE_SLUGS = new Set([
  'post', 'page', 'attachment', 'nav_menu_item', 'wp_block', 'wp_template',
  'wp_template_part', 'wp_navigation', 'wp_font_family', 'wp_font_face', 'wp_global_styles',
  'product', 'product_variation', 'shop_order', 'shop_order_refund', 'shop_coupon',
]);
const CORE_TAXONOMY_SLUGS = new Set([
  'category', 'post_tag', 'nav_menu', 'link_category', 'post_format', 'wp_pattern_category',
  'product_cat', 'product_tag', 'product_brand', 'product_shipping_class', 'product_type', 'product_visibility',
]);

function buildRegisteredRestBases({ types = null, taxonomies = null } = {}) {
  const map = new Map();
  const add = (kind, slug, entry, coreSlugs) => {
    if (!entry || coreSlugs.has(slug)) return;
    if (entry.show_in_rest === false) return;
    const restBase = entry.rest_base || entry.slug || slug;
    if (!restBase) return;
    const namespace = entry.rest_namespace || 'wp/v2';
    map.set(`/${namespace}/${restBase}`, {
      kind,
      slug,
      restBase,
      hierarchical: entry.hierarchical === true,
      attachedToTypes: Array.isArray(entry.types) ? [...entry.types] : [],
    });
  };
  for (const [slug, entry] of Object.entries(types || {})) add('post-type', slug, entry, CORE_POST_TYPE_SLUGS);
  for (const [slug, entry] of Object.entries(taxonomies || {})) add('taxonomy', slug, entry, CORE_TAXONOMY_SLUGS);
  return map;
}

function isIncludedCategory(category, includeExcludedCategories) {
  return includeExcludedCategories.includes(category) || includeExcludedCategories.includes('all');
}

function finalizeMetadataActions(classifications) {
  const sampledRoutes = classifications
    .filter((classification) => classification.effectiveAction === 'sample')
    .map((classification) => classification.routePath);

  return classifications.map((classification) => {
    if (classification.category !== 'backend_metadata' || classification.includedByOverride || classification.excludedByOverride) {
      return classification;
    }

    const requiredPatterns = Array.isArray(classification.requiredPatterns) ? classification.requiredPatterns : [];
    const hasRelatedSampledRoute = requiredPatterns.some((pattern) =>
      sampledRoutes.some((routePath) => routeMatchesPattern(routePath, pattern)));

    if (hasRelatedSampledRoute) {
      return { ...classification, effectiveAction: 'metadata' };
    }

    return {
      ...classification,
      effectiveAction: 'skip',
      sampleByDefault: false,
      reason: `${classification.reason}; no related sampled backend route is in scope`,
    };
  });
}

function classifyRoutes(candidates, overrides = {}) {
  const normalizedOverrides = normalizeOverrides(overrides);
  const routeSet = new Set(candidates.map((candidate) => candidate.routePath));
  let classifications = candidates.map((candidate) => {
    const classification = classifyBaseRoute(candidate, routeSet, normalizedOverrides);

    if (normalizedOverrides.excludeRoutes.includes(candidate.routePath)) {
      return {
        ...classification,
        excludedByOverride: true,
        includedByOverride: false,
        effectiveAction: 'skip',
        sampleByDefault: false,
        overrideReason: normalizedOverrides.overrideReason,
      };
    }

    const includeRoute = normalizedOverrides.includeRoutes.includes(candidate.routePath);
    const includeCategory = isIncludedCategory(classification.category, normalizedOverrides.includeExcludedCategories);
    if (includeRoute || includeCategory) {
      return {
        ...classification,
        includedByOverride: true,
        effectiveAction: 'sample',
        overrideReason: normalizedOverrides.overrideReason,
      };
    }

    return classification;
  });

  classifications = finalizeMetadataActions(classifications);
  return classifications.sort((a, b) => a.routePath.localeCompare(b.routePath));
}

function summarizeSkippedByCategory(classifications) {
  const summary = {};
  for (const classification of classifications) {
    if (classification.effectiveAction !== 'skip') {
      continue;
    }
    summary[classification.category] = (summary[classification.category] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([a], [b]) => a.localeCompare(b)));
}

module.exports = {
  ROUTE_CATEGORIES,
  classifyRoutes,
  normalizeOverrides,
  routeMatchesPattern,
  childRouteAdvertised,
  summarizeSkippedByCategory,
  coreRulePatterns,
  ROUTE_DEFAULT_QUERY_RULES,
  defaultQueryFor,
  defaultQueryReasonFor,
  defaultPluginRules,
  resetPluginRuleCache,
  buildRegisteredRestBases,
  CORE_POST_TYPE_SLUGS,
  CORE_TAXONOMY_SLUGS,
};
