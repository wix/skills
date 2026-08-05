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
  ['/wc/v3/taxes*', 'wc.data.taxes', 'WooCommerce taxes are canonical store data'],
  ['/wc/v3/tax_classes*', 'wc.data.tax-classes', 'WooCommerce tax classes are canonical store data'],
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

const KNOWN_PLUGIN_DATA_RULES = [
  ['/ssp/v1/*', 'plugin.data.ssp', 'Seriously Simple Podcasting routes expose durable podcast records'],
  ['/tribe/events/v1/events', 'plugin.data.tribe-events', 'events routes expose durable event records'],
  ['/wp/v2/tribe_events', 'plugin.data.wp-tribe-events', 'event custom post type routes expose durable event records'],
];

const LEGACY_WC_PREFIXES = [
  '/wc/v1/products',
  '/wc/v1/coupons',
  '/wc/v1/orders',
  '/wc/v1/refunds',
  '/wc/v1/customers',
  '/wc/v1/taxes',
  '/wc/v1/tax_classes',
  '/wc/v2/products',
  '/wc/v2/coupons',
  '/wc/v2/orders',
  '/wc/v2/refunds',
  '/wc/v2/customers',
  '/wc/v2/taxes',
  '/wc/v2/tax_classes',
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

function classifyBaseRoute(candidate, routeSet, options = {}) {
  const routePath = candidate.routePath;
  const ruleGroups = [
    ['excluded_frontend', FRONTEND_RULES],
    ['excluded_template_editor', TEMPLATE_EDITOR_RULES],
    ['excluded_runtime_session', RUNTIME_RULES],
    ['excluded_admin_dashboard', ADMIN_RULES],
    ['excluded_marketplace_setup', MARKETPLACE_RULES],
    ['excluded_diagnostics', DIAGNOSTIC_RULES],
    ['excluded_integration', INTEGRATION_RULES],
  ];

  for (const [category, rules] of ruleGroups) {
    const rule = findMatchingRule(routePath, rules);
    if (rule) {
      return makeClassification(candidate, category, rule.reason, rule.ruleId);
    }
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

  const pluginRule = findMatchingRule(routePath, KNOWN_PLUGIN_DATA_RULES);
  if (pluginRule) {
    return makeClassification(candidate, 'backend_data', pluginRule.reason, pluginRule.ruleId);
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
  };
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
  summarizeSkippedByCategory,
};
