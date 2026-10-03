'use strict';

// rp-target-wix — verified-once Wix write primitives.
//
// The Wix API surface is identical for every migration regardless of source
// platform, so it is pre-built and verified HERE once rather than re-derived (and
// re-broken) by codegen on every run. `rp-import-codegen` vendors a copy of this
// module into the project (like the wp-http transport) and the generated writers
// call these primitives — they hold only per-project field maps, not API plumbing.
//
// Each call is split into a PURE request builder (`build*Request`, testable + usable
// by dry-runs) and an executor that sends it via the injected client.
//
// READ/RETURN CONTRACT for `query*` executors — every one of them (`queryStoresProducts`,
// `queryStoresCategories`, `queryContacts`, `queryCoupons`, `queryOrders`) UNWRAPS the
// response to the entity array and returns ONE PAGE, discarding `pagingMetadata`. Two
// consequences that generated code has repeatedly got wrong:
//   1. **The returned value IS the array.** Reading `.products` / `.categories` off it a
//      second time yields `undefined`, which `|| []` turns into an empty array — so a dedupe
//      index or an existing-entity safety net comes back EMPTY instead of failing. It looks
//      like a working sweep of a fresh site, and the import duplicates everything.
//   2. **A cursor loop cannot be built on these at all** — the cursor it would need is inside
//      the metadata they threw away. Use a `queryAll*` primitive where one exists
//      (`queryAllStoresCategories`, `queryAllStoresProducts`, `queryAllDataItems`); otherwise
//      send `wix.send(build<X>Request(body))` and read `pagingMetadata.cursors.next` off the
//      raw response.
// A partial sweep must THROW, never return what it has: "empty net" and "empty store" are
// indistinguishable downstream, and it is the latter that a caller assumes.
//
// Endpoints + request shapes marked `// VERIFIED:` were validated by REAL CALLS against
// a live Wix site (not just docs — see SKILL.md "Validate by real call"). Shapes marked
// `// UNVERIFIED:` are docs-schema/MCP-derived bootstrap primitives. They must be
// surfaced in execution plans until a live contract call promotes them to VERIFIED.

const fs = require('node:fs/promises');
const bulkResults = require('./bulk-results');
const path = require('node:path');
const crypto = require('node:crypto');
const paymentMapping = require('./order-payment-mapping.js');
const dataExtensionSchema = require('./data-extension-schema.js');
const invoiceContract = require('./order-invoice-contract.js');
const documentUrlGuard = require('../../../lib/document-url-guard.js');
const approvalStamp = require('../../../lib/preservation-approval-stamp.js');
const pricingPlanDefinition = require('./pricing-plan-definition.js');
const storesInventory = require('./stores-inventory.js');

const WIXAPIS = 'https://www.wixapis.com';

const SAFE_MODE_TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const SAFE_MODE_FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
const DEFAULT_SAFE_MODE_PHONE_NUMBER = '+972 50 0000000';
const NATIVE_EMAIL_FALLBACK_PATHS = [
  'info.emails.items[].email',
  'emails.items[].email',
  'buyerInfo.email',
  'billingInfo.email',
  'shippingInfo.email',
  'contact.email',
  'order.buyerInfo.email',
  'order.billingInfo.email',
  'order.shippingInfo.email',
  'member.loginEmail',
  'loginEmail',
  // Contacts V5 (GA) — flat contact shape; single create/update wraps as { contact },
  // bulk upsert wraps each item as { contact } under contacts[]
  'contact.email.email',
  'contact.additionalEmails[].email',
  'contacts[].contact.email.email',
  'contacts[].contact.additionalEmails[].email',
];
const NATIVE_PHONE_FALLBACK_PATHS = [
  'info.phones.items[].phone',
  'phones.items[].phone',
  'buyerInfo.phone',
  'billingInfo.phone',
  'shippingInfo.phone',
  'order.buyerInfo.phone',
  'order.billingInfo.phone',
  'order.shippingInfo.phone',
  // Import Order (POST /ecom/v1/orders/import) — contact details carry phone, not email
  'order.billingInfo.contactDetails.phone',
  'order.shippingInfo.logistics.shippingDestination.contactDetails.phone',
  'order.recipientInfo.contactDetails.phone',
  // Contacts V5 (GA) — flat contact shape; single create/update wraps as { contact },
  // bulk upsert wraps each item as { contact } under contacts[]
  'contact.phone.phone',
  'contact.additionalPhones[].phone',
  'contact.addresses[].recipient.phone',
  'contacts[].contact.phone.phone',
  'contacts[].contact.additionalPhones[].phone',
  'contacts[].contact.addresses[].recipient.phone',
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class SafeModeBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SafeModeBlockedError';
    this.code = 'SAFE_MODE_SUSPICIOUS_EMAIL';
    this.safeMode = true;
    this.blockedPaths = details.blockedPaths || [];
    this.sanitizerResult = details.sanitizerResult;
  }
}

function normalizeSafeModeValue(value, { defaultValue }) {
  if (value == null || String(value).trim() === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (SAFE_MODE_TRUE_VALUES.has(normalized)) return true;
  if (SAFE_MODE_FALSE_VALUES.has(normalized)) return false;
  throw new Error(`SAFE_MODE must be one of true, 1, yes, on, false, 0, no, off; got ${JSON.stringify(value)}`);
}

function normalizeDryRunValue(value, { defaultValue = false } = {}) {
  if (value == null || String(value).trim() === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (SAFE_MODE_TRUE_VALUES.has(normalized)) return true;
  if (SAFE_MODE_FALSE_VALUES.has(normalized)) return false;
  throw new Error(`DRY_RUN must be one of true, 1, yes, on, false, 0, no, off; got ${JSON.stringify(value)}`);
}

function createDryRunConfig(env = {}, argv = []) {
  let dryRun = normalizeDryRunValue(env.DRY_RUN, { defaultValue: false });
  for (const arg of argv || []) {
    if (arg === '--dry-run') dryRun = true;
    if (arg === '--no-dry-run') dryRun = false;
  }
  return { dryRun };
}

function createSafeModeConfig(env = {}) {
  const safeMode = normalizeSafeModeValue(env.SAFE_MODE, { defaultValue: true });
  const configuredPhone = env.SAFE_MODE_PHONE_NUMBER == null ? '' : String(env.SAFE_MODE_PHONE_NUMBER).trim();
  return {
    safeMode,
    safeModePhoneNumber: safeMode ? (configuredPhone || DEFAULT_SAFE_MODE_PHONE_NUMBER) : configuredPhone,
  };
}

function safeEmailLocalPartComponent(value, label, { allowHyphen = false } = {}) {
  const pattern = allowHyphen ? /[^a-z0-9-]+/g : /[^a-z0-9]+/g;
  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(pattern, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!normalized) throw new Error(`mockEmailForEntity: ${label} must normalize to a non-empty value`);
  return normalized;
}

function mockEmailForEntity(entityType, entityId) {
  const safeEntityType = safeEmailLocalPartComponent(entityType, 'entityType');
  const safeEntityId = safeEmailLocalPartComponent(entityId, 'entityId', { allowHyphen: true });
  return `replatform+${safeEntityType}_${safeEntityId}@wix.com`;
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map((item) => deepClone(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = deepClone(item);
    return out;
  }
  return value;
}

function parseSafeModePath(pathValue) {
  if (!pathValue || typeof pathValue !== 'string') {
    throw new Error('safe-mode replacement path must be a non-empty string');
  }
  return pathValue.split('.').map((rawSegment) => {
    const match = rawSegment.match(/^([A-Za-z0-9_$-]+)(\[\])?$/);
    if (!match) throw new Error(`invalid safe-mode replacement path segment: ${rawSegment}`);
    return { key: match[1], array: Boolean(match[2]) };
  });
}

function pathToString(segments) {
  return segments.map((segment) => `${segment.key}${segment.array ? '[]' : ''}`).join('.');
}

function setValuesAtPath(root, pathValue, replacement) {
  const segments = parseSafeModePath(pathValue);
  let changed = 0;
  function visit(node, index) {
    if (!node || typeof node !== 'object') return;
    const segment = segments[index];
    if (!(segment.key in node)) return;
    if (segment.array) {
      const items = node[segment.key];
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (index === segments.length - 1) {
          continue;
        }
        visit(item, index + 1);
      }
      return;
    }
    if (index === segments.length - 1) {
      // Primitive-only: a generic path like `contact.email` must not clobber the Contacts
      // V5 email OBJECT ({ email, subscriptionStatus }) with a mock string. Raw emails
      // left inside skipped objects are still caught by collectSuspiciousEmailPaths.
      const current = node[segment.key];
      if (current !== undefined && current !== null && typeof current !== 'object') {
        if (current !== replacement) {
          node[segment.key] = replacement;
          changed += 1;
        }
      }
      return;
    }
    visit(node[segment.key], index + 1);
  }
  visit(root, 0);
  return changed;
}

function collectSuspiciousEmailPaths(value, { mockEmail }) {
  const paths = [];
  function visit(node, segments) {
    if (typeof node === 'string') {
      if (node !== mockEmail && EMAIL_PATTERN.test(node.trim())) paths.push(pathToString(segments));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, segments.concat({ key: String(index), array: false })));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) visit(item, segments.concat({ key, array: false }));
    }
  }
  visit(value, []);
  return paths;
}

function normalizeReplacePaths(replacePaths = []) {
  if (!Array.isArray(replacePaths)) throw new Error('safeModeOptions.replacePaths must be an array');
  return replacePaths.map((entry) => {
    const kind = entry && entry.kind;
    const path = entry && (entry.path || entry.targetPath);
    if (kind !== 'email' && kind !== 'phone') throw new Error(`safe-mode replacement kind must be email or phone; got ${JSON.stringify(kind)}`);
    parseSafeModePath(path);
    return { kind, path };
  });
}

function isSafeModeEnabled(options = {}) {
  if (options.safeMode === undefined) return false;
  return normalizeSafeModeValue(options.safeMode, { defaultValue: true });
}

function sanitizeContactFieldsForSafeMode(value, options = {}) {
  if (!isSafeModeEnabled(options)) {
    return {
      value: deepClone(value),
      blocked: false,
      blockedPaths: [],
      emailFieldsReplaced: 0,
      phoneFieldsReplaced: 0,
    };
  }
  if (!options.entityType) throw new Error('safe mode requires origin entityType');
  if (!options.entityId) throw new Error('safe mode requires origin entityId');
  const safeModePhoneNumber = options.safeModePhoneNumber || DEFAULT_SAFE_MODE_PHONE_NUMBER;
  const mockEmail = mockEmailForEntity(options.entityType, options.entityId);
  const sanitized = deepClone(value);
  const replacePaths = normalizeReplacePaths(options.replacePaths || []);
  let emailFieldsReplaced = 0;
  let phoneFieldsReplaced = 0;

  for (const entry of replacePaths) {
    if (entry.kind === 'email') emailFieldsReplaced += setValuesAtPath(sanitized, entry.path, mockEmail);
    else phoneFieldsReplaced += setValuesAtPath(sanitized, entry.path, safeModePhoneNumber);
  }
  for (const pathValue of NATIVE_EMAIL_FALLBACK_PATHS) {
    emailFieldsReplaced += setValuesAtPath(sanitized, pathValue, mockEmail);
  }
  for (const pathValue of NATIVE_PHONE_FALLBACK_PATHS) {
    phoneFieldsReplaced += setValuesAtPath(sanitized, pathValue, safeModePhoneNumber);
  }

  const blockedPaths = collectSuspiciousEmailPaths(sanitized, { mockEmail });
  return {
    value: sanitized,
    blocked: blockedPaths.length > 0,
    blockedPaths,
    emailFieldsReplaced,
    phoneFieldsReplaced,
  };
}

function sanitizeWixRequestBody(body, options = {}) {
  return sanitizeContactFieldsForSafeMode(body, options);
}

function buildSafeModeEvidence(result, safeModeOptions) {
  if (!isSafeModeEnabled(safeModeOptions)) return null;
  return {
    enabled: true,
    entityType: safeModeOptions.entityType || null,
    entityId: safeModeOptions.entityId == null ? null : String(safeModeOptions.entityId),
    replacePathCount: normalizeReplacePaths(safeModeOptions.replacePaths || []).length,
    emailFieldsReplaced: result.emailFieldsReplaced,
    phoneFieldsReplaced: result.phoneFieldsReplaced,
    blockedPaths: result.blockedPaths.slice(),
  };
}

function applySafeModeToRequest(body, safeModeOptions) {
  const result = sanitizeWixRequestBody(body, safeModeOptions);
  if (result.blocked) {
    throw new SafeModeBlockedError('safe mode blocked suspicious non-replaced email value before Wix write', {
      blockedPaths: result.blockedPaths,
      sanitizerResult: result,
    });
  }
  return {
    body: result.value,
    safeMode: buildSafeModeEvidence(result, safeModeOptions),
  };
}

function applySafeModeToRequestBody(body, safeModeOptions) {
  return applySafeModeToRequest(body, safeModeOptions).body;
}

// --- client ----------------------------------------------------------------
// config: { authToken, siteId }. authToken is an OAuth access token / API key with
// scopes for the selected writers, for example Blog manage, Wix Data collections manage,
// media import, Contacts manage/schema, and Members manage.
//
// Auth scheme normalization: Wix API keys (`IST.…`) are sent RAW in the Authorization
// header; OAuth access tokens (e.g. a Wix CLI token from `npx @wix/cli@latest token --site …`)
// must be sent as `Bearer <token>`. Detect and prefix so both credential kinds work.
function authHeaderValue(token) {
  const t = String(token).trim();
  if (/^Bearer\s/i.test(t)) return t; // already carries a scheme
  if (/^IST\./.test(t)) return t; // Wix API key — sent as-is, no Bearer
  return `Bearer ${t}`; // OAuth / CLI access token
}

function stripWixOrigin(url) {
  const value = String(url || '');
  if (value.startsWith(WIXAPIS)) return value.slice(WIXAPIS.length) || '/';
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

function stableHash(value, length = 10) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function safePlaceholderPart(value, fallback = 'wix') {
  const normalized = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function dryRunPlaceholderId({ runId, entity, operation, sourceId, method, url, body }) {
  const entityPart = safePlaceholderPart(entity || 'wix');
  const hashInput = JSON.stringify({
    runId: runId || 'dry-run',
    entity: entity || null,
    operation: operation || null,
    sourceId: sourceId || null,
    method,
    endpoint: stripWixOrigin(url),
    body,
  });
  return `dry-run_${entityPart}_${stableHash(hashInput, 8)}`;
}

function responseShapeFromRequest(request) {
  if (request.responseShape) return request.responseShape;
  const url = String(request.url || '');
  const method = String(request.method || '').toUpperCase();
  if (url.includes('/ricos/v1/ricos-document/convert/to-ricos')) return { type: 'object', field: 'document' };
  if (url.includes('/site-media/v1/files/import')) return { type: 'object', field: 'file' };
  if (url.includes('/site-media/v1/files/') && method === 'GET') return { type: 'object', field: 'file' };
  if (url.includes('/blog/v3/categories')) return method === 'GET' || url.includes('/query') ? { type: 'array', field: 'categories' } : { type: 'object', field: 'category' };
  if (url.includes('/blog/v3/tags')) return method === 'GET' || url.includes('/query') ? { type: 'array', field: 'tags' } : { type: 'object', field: 'tag' };
  if (url.includes('/blog/v3/draft-posts') && url.includes('/publish')) return { type: 'raw' };
  if (url.includes('/blog/v3/draft-posts')) return { type: 'object', field: 'draftPost' };
  if (url.includes('/wix-data/v2/items/query')) return { type: 'array', field: 'dataItems' };
  if (url.includes('/wix-data/v2/items')) return { type: 'object', field: 'dataItem', idFields: ['id', '_id'] };
  if (url.includes('/stores/v3/bulk/products-with-inventory/create')) return { type: 'bulk-products-with-inventory' };
  if (url.includes('/stores/v3/products/query')) return { type: 'array', field: 'products' };
  if (url.includes('/stores/v3/products/slug/') || (url.includes('/stores/v3/products/') && method === 'GET')) return { type: 'object', field: 'product' };
  if (url.includes('/stores/v3/products')) return { type: 'object', field: 'product' };
  if (url.includes('/categories/v1/categories/query')) return { type: 'array', field: 'categories' };
  if (url.includes('/categories/v1/categories')) return { type: 'object', field: 'category' };
  if (url.includes('/categories/v1/bulk/categories/add-item')) return { type: 'raw' };
  if (url.includes('/stores/v3/inventory-items')) return { type: 'object', field: 'inventoryItem' };
  if (url.includes('/contacts/v5/bulk/contacts/upsert')) return { type: 'bulk-contacts-upsert' };
  if (url.includes('/contacts/v5/contacts/query') || url.includes('/contacts/v4/contacts/query')) return { type: 'array', field: 'contacts' };
  if (url.includes('/contacts/v5/contacts') || url.includes('/contacts/v4/contacts')) return { type: 'object', field: 'contact' };
  if (url.includes('/stores/v2/coupons/query')) return { type: 'array', field: 'coupons' };
  if (url.includes('/stores/v2/coupons')) return { type: 'object', field: 'coupon' };
  if (url.includes('/ecom/v1/orders/query')) return { type: 'array', field: 'orders' };
  if (url.includes('/ecom/v1/orders')) return { type: 'object', field: 'order' };
  if (url.includes('/members/v1/members') && method === 'GET') return { type: 'array', field: 'members' };
  if (url.includes('/members/v1/members')) return { type: 'object', field: 'member' };
  if (url.includes('/apps-installer-service/v1/app-instances')) return { type: 'array', field: 'appInstances' };
  if (url.includes('/apps-installer-service/v1/app-instance/install')) return { type: 'object', field: 'appInstance' };
  if (url.includes('/bookings/v2/resources/query')) return { type: 'array', field: 'resources' };
  if (url.includes('/bookings/v2/services/query')) return { type: 'array', field: 'services' };
  if (url.includes('/bookings/v2/services')) return { type: 'object', field: 'service', idFields: ['id'] };
  if (url.includes('/calendar/v3/events')) return { type: 'object', field: 'event', idFields: ['id'] };
  if (url.includes('/ecom/v1/discount-rules/query')) return { type: 'array', field: 'discountRules' };
  if (url.includes('/ecom/v1/discount-rules')) return { type: 'object', field: 'discountRule', idFields: ['id'] };
  // `nonEmptyItem`: this array must never placeholder-empty in dry-run — resolveManualTaxCalculatorAppId
  // (see the Tax section) filters this result for the non-Avalara entry and THROWS if it doesn't find
  // exactly one. An empty `[]` placeholder would make every dry run of a tax-region-creating path throw
  // before it ever reaches wix.send — the exact "crash instead of a usable placeholder" bug the
  // refund/discount-rule writer fix (an earlier writer-fix review) was written to catch, generalized here via the
  // shape descriptor itself rather than a one-off field-name check in placeholderPayload, so the next
  // array endpoint with this requirement only needs to set this property, not add a new branch.
  if (url.includes('/billing/v1/list-tax-calculators')) {
    return { type: 'array', field: 'taxCalculatorDetails', nonEmptyItem: { appId: 'dry-run-manual-tax-calculator-app-id', displayName: 'Wix Manual Tax Calculator', unsupportedCountries: [] } };
  }
  if (url.includes('/billing/v1/tax-groups/default-tax-groups')) return { type: 'array', field: 'taxGroups' };
  if (url.includes('/billing/v1/tax-groups/query')) return { type: 'array', field: 'taxGroups' };
  if (url.includes('/billing/v1/tax-groups')) return { type: 'object', field: 'taxGroup', idFields: ['id'] };
  if (url.includes('/billing/v1/tax-regions/query')) return { type: 'array', field: 'taxRegions' };
  if (url.includes('/billing/v1/tax-regions')) return { type: 'object', field: 'taxRegion', idFields: ['id'] };
  if (url.includes('/billing/v1/manual-tax-mappings/query')) return { type: 'array', field: 'manualTaxMappings' };
  if (url.includes('/billing/v1/manual-tax-mappings')) return { type: 'object', field: 'manualTaxMapping', idFields: ['id'] };
  if (url.includes('/billing/v1/tax-settings')) return { type: 'object', field: 'taxSettings' };
  // `nonEmptyItem`: this array must never placeholder-empty in dry-run — resolvePickupAppId
  // filters this result for the Pickup entry and THROWS if it doesn't find exactly one. An
  // empty `[]` placeholder would make every dry run of a path that resolves the Pickup appId
  // throw before it ever reaches wix.send, the same class of bug the refund/discount-rule
  // writer fix (an earlier writer-fix review) was written to catch, generalized here via the shape
  // descriptor's own `nonEmptyItem` property rather than a one-off field-name check.
  if (url.includes('/ecom/v1/delivery-profiles/installed-carriers')) {
    return { type: 'array', field: 'installedDeliveryCarriers', nonEmptyItem: { id: 'dry-run-pickup-carrier-app-id', displayName: 'Pickup', fallbackDefinitionMandatory: false } };
  }
  if (url.includes('/ecom/v1/delivery-profiles/query')) return { type: 'array', field: 'deliveryProfiles' };
  // add-delivery-region (POST .../{profileId}/delivery-region) and remove-delivery-region
  // (DELETE .../{profileId}/delivery-region/{regionId}) share a URL substring, distinguished
  // only by method — check DELETE first or the add-region branch below would swallow it too.
  if (url.includes('/delivery-region/') && method === 'DELETE') return { type: 'object', field: 'deliveryProfile', idFields: ['id'] };
  if (url.includes('/delivery-region') && method === 'POST') return { type: 'object', field: 'deliveryProfile', idFields: ['id'] };
  if (url.includes('/ecom/v1/delivery-profiles/add-delivery-carrier')) return { type: 'object', field: 'deliveryProfile', idFields: ['id'] };
  if (url.includes('/ecom/v1/delivery-profiles/remove-delivery-carrier')) return { type: 'object', field: 'deliveryProfile', idFields: ['id'] };
  if (url.includes('/ecom/v1/delivery-profiles/') && method === 'GET') return { type: 'object', field: 'deliveryProfile', idFields: ['id'] };
  if (url.includes('/ecom/v1/delivery-profiles')) return { type: 'object', field: 'deliveryProfile', idFields: ['id'] };
  if (url.includes('/site-properties/v4/properties/business-contact')) return { type: 'raw' };
  if (url.includes('/site-properties/v4/properties')) return { type: 'object', field: 'properties' };
  if (url.includes('/ecom/v1/shipping-options/query')) return { type: 'array', field: 'shippingOptions' };
  if (url.includes('/ecom/v1/shipping-options')) return { type: 'object', field: 'shippingOption', idFields: ['id'] };
  // Pickup Locations live on their own service host (www.wixapis.com/pickup-locations), not
  // under /ecom/ — check the query branch first so it isn't swallowed by the create/get branch.
  if (url.includes('/pickup-locations/v1/pickup-locations/query')) return { type: 'array', field: 'pickupLocations' };
  if (url.includes('/pickup-locations/v1/pickup-locations')) return { type: 'object', field: 'pickupLocation', idFields: ['id'] };
  if (url.includes('/ecom/v1/order-billing/refund-payments')) return { type: 'object', field: 'refund', idFields: ['id'] };
  if (url.includes('/ecom/v1/payments/orders/') && url.includes('/add-payment')) return { type: 'add-order-payment' };
  if (url.includes('/ecom/v1/payments/orders/')) return { type: 'object', field: 'orderTransactions' };
  return { type: 'raw' };
}

// Bulk endpoints return one per-item result per input, correlated by `itemMetadata.originalIndex`
// (bulkCreateStoresProductsWithInventory / bulkUpsertContacts both read that field — see their
// comments above). A single generic placeholder object is the wrong shape for these: without a
// per-item result the caller's correlation logic reports every input as "unaccounted", which a
// dry run then surfaces as a false unexpectedSkipped/mismatch rather than a clean dry-run pass.
function bulkPlaceholderResults(inputs, request, context, { withAction = false } = {}) {
  return inputs.map((_, index) => {
    const id = dryRunPlaceholderId({ ...request, ...context, sourceId: `${context.sourceId || 'bulk'}-${index}` });
    return {
      itemMetadata: { id, originalIndex: index, success: true },
      ...(withAction ? { action: 'CREATED' } : {}),
      item: { id, _dryRunPlaceholder: true },
    };
  });
}

function placeholderPayload(shape, request, context) {
  if (!shape || shape.type === 'raw') return {};
  if (shape.type === 'array') return { [shape.field]: shape.nonEmptyItem ? [shape.nonEmptyItem] : [] };
  if (shape.type === 'bulk-products-with-inventory') {
    const products = (request.body && Array.isArray(request.body.products)) ? request.body.products : [];
    const results = bulkPlaceholderResults(products, request, context);
    return {
      productResults: { results, bulkActionMetadata: { totalSuccesses: results.length, totalFailures: 0, undetailedFailures: 0 } },
      inventoryResults: null,
    };
  }
  if (shape.type === 'bulk-contacts-upsert') {
    const contacts = (request.body && Array.isArray(request.body.contacts)) ? request.body.contacts : [];
    const results = bulkPlaceholderResults(contacts, request, context, { withAction: true });
    return { results, bulkActionMetadata: { totalSuccesses: results.length, totalFailures: 0, undetailedFailures: 0 } };
  }
  // Real shape is `{orderTransactions, paymentsIds}` (VERIFIED live 2026-08-12) — addOrderPayment
  // reads `response.paymentsIds[0]` as the new payment's id, not a top-level `id`/`payment.id`,
  // so the generic object-with-idFields placeholder below would leave paymentId undefined.
  if (shape.type === 'add-order-payment') {
    const id = dryRunPlaceholderId({ ...request, ...context });
    return { paymentsIds: [id], orderTransactions: { payments: [{ id, _dryRunPlaceholder: true }] } };
  }
  const id = dryRunPlaceholderId({ ...request, ...context });
  const payload = { id, _dryRunPlaceholder: true };
  for (const field of shape.idFields || []) payload[field] = id;
  if (shape.field === 'document') return { document: { nodes: [], _dryRunPlaceholder: true } };
  if (shape.field === 'file') return { file: { id, operationStatus: 'PENDING', _dryRunPlaceholder: true } };
  // Bookings Create Service always returns an auto-created `schedule.id` (see createBookingsService
  // VERIFIED comment) that createCalendarEvent needs to build the session request — without a
  // placeholder here, a dry run of the event-plugin-rest path silently skips capturing the
  // session-create request entirely (no schedule.id to build it from).
  if (shape.field === 'service') payload.schedule = { id: `${id}-schedule` };
  return { [shape.field]: payload };
}

function redactHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/^authorization$/i.test(key)) continue;
    if (/cookie|token|api[-_]?key|secret/i.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /authorization|cookie|token|api[-_]?key|secret|password/i.test(key) ? '[REDACTED]' : redactSecrets(item);
    }
    return out;
  }
  return value;
}

async function appendJsonLine(filePath, row) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

async function defaultCaptureSink(capture, config) {
  if (typeof config.captureSink === 'function') {
    await config.captureSink(capture);
  }
  if (config.auditSink && typeof config.auditSink.appendRequestCapture === 'function') {
    await config.auditSink.appendRequestCapture(capture);
  } else if (typeof config.auditSink === 'function') {
    await config.auditSink(capture);
  }
  if (config.requestCapturePath) {
    await appendJsonLine(config.requestCapturePath, capture);
  } else if (config.projectDir) {
    await appendJsonLine(path.join(config.projectDir, 'state', 'attempts', 'wix-request-captures.ndjson'), capture);
  }
}

async function dryRunSend(request, config, defaultHeaders) {
  const method = String(request.method || '').toUpperCase();
  if (!method) throw new Error('wix.send: method is required');
  if (!request.url) throw new Error('wix.send: url is required');
  const headers = { ...defaultHeaders, ...(request.headers || {}) };
  const body = request.body === undefined ? undefined : request.body;
  const runId = config.runContext?.runId || config.runId || 'dry-run';
  const phase = request.phase || config.runContext?.phase || config.phase || 'import';
  const requestCaptureId = `reqcap_${stableHash(JSON.stringify({ runId, method, url: request.url, body, operation: request.operation, sourceId: request.sourceId }), 12)}`;
  const capture = {
    schemaVersion: 1,
    requestCaptureId,
    timestamp: new Date().toISOString(),
    runId,
    dryRun: true,
    phase,
    ...(request.entity ? { entity: request.entity } : {}),
    ...(request.operation ? { operation: request.operation } : {}),
    ...(request.sourceId ? { sourceId: String(request.sourceId) } : {}),
    method,
    endpoint: stripWixOrigin(request.url),
    headers: redactHeaders(headers),
    body: redactSecrets(body),
    verification: request.verification || request.verificationLevel || 'unverified',
    expectedLiveBehavior: request.expectedLiveBehavior || request.operation || method.toLowerCase(),
    result: 'dry_run_skipped_wix_call',
    authTokenStatus: config.authToken ? 'present' : 'would_block_live',
    siteIdStatus: config.siteId ? 'present' : 'would_block_live',
    ...(request.safeMode ? { safeMode: request.safeMode } : {}),
  };
  await defaultCaptureSink(capture, config);
  const shape = responseShapeFromRequest(request);
  return {
    dryRun: true,
    result: 'dry_run_skipped_wix_call',
    requestCaptureId,
    ...(shape.type === 'array' ? { stateKnown: false, kind: 'wix_call_skipped' } : {}),
    ...placeholderPayload(shape, request, {
      runId,
      entity: request.entity || shape.field,
      operation: request.operation || request.expectedLiveBehavior,
      sourceId: request.sourceId,
    }),
  };
}

function createWixClient(config) {
  const dryRun = normalizeDryRunValue(config && config.dryRun, { defaultValue: false });
  if (!dryRun && (!config || !config.authToken)) {
    throw new Error(
      'createWixClient: no Wix write credentials. Provide an OAuth access token / API ' +
        'key with the scopes required by the selected writers. In an autonomous run this ' +
        'is injected at provisioning time.',
    );
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(config && config.authToken ? { Authorization: authHeaderValue(config.authToken) } : {}),
    ...(config && config.siteId ? { 'wix-site-id': config.siteId } : {}),
  };
  const fetchImpl = config.fetch || fetch;
  return {
    async send(request) {
      if (dryRun) return dryRunSend(request, config, headers);
      const { method, url, body } = request;
      const requestHeaders = { ...headers, ...(request.headers || {}) };
      const res = await fetchImpl(url, { method, headers: requestHeaders, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        // The message is truncated for readability, so anything that needs to DECIDE on an error
        // must not parse it. Attach the status and the parsed body: a caller distinguishing a
        // transient refusal from a permanent one was reading a 400-character prefix, which fails
        // silently the day the provider reorders its own JSON.
        throw Object.assign(new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`), {
          status: res.status,
          body: json,
          applicationErrorCode: json && json.details && json.details.applicationError && json.details.applicationError.code,
          nonRefundableReason: json && json.details && json.details.applicationError
            && json.details.applicationError.data && json.details.applicationError.data.nonRefundableReason,
        });
      }
      return json;
    },
  };
}

function intentToWixRequest(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new Error('setup intent must be an object');
  }
  if (intent.type === 'rest') {
    return {
      method: intent.method,
      url: intent.url || `${WIXAPIS}${String(intent.path || '').startsWith('/') ? intent.path : `/${intent.path}`}`,
      body: intent.body,
      headers: intent.headers,
      phase: 'setup',
      operation: intent.operation,
      entity: intent.entity,
      sourceId: intent.sourceId,
      verification: intent.verification,
      expectedLiveBehavior: intent.expectedLiveBehavior,
      responseShape: intent.responseShape,
    };
  }
  return {
    method: intent.method || intent.type || 'SETUP',
    url: intent.url || `wix-${intent.type || 'setup'}:${intent.operation || intent.command || intent.tool || 'step'}`,
    body: intent.body || intent.args || intent.commandArgs || {},
    headers: intent.headers || {},
    phase: 'setup',
    operation: intent.operation || intent.command || intent.tool,
    entity: intent.entity,
    sourceId: intent.sourceId,
    verification: intent.verification,
    expectedLiveBehavior: intent.expectedLiveBehavior || intent.type,
    responseShape: intent.responseShape || { type: 'raw' },
  };
}

function createWixSetupExecutor(config = {}) {
  const dryRun = normalizeDryRunValue(config.dryRun, { defaultValue: false });
  let wixClient = config.wixClient || (dryRun ? createWixClient({
    ...config,
    dryRun,
    runContext: { ...(config.runContext || {}), phase: 'setup' },
  }) : null);
  const transports = config.transports || {};

  return {
    async executeSetupStep(step) {
      if (!step || typeof step !== 'object') {
        throw new Error('setup step must be an object');
      }
      const intent = step.intent || (typeof step.buildIntent === 'function' ? await step.buildIntent(step) : step);
      const request = intentToWixRequest(intent);
      if (dryRun) {
        const response = await wixClient.send(request);
        return {
          dryRun: true,
          status: 'planned_dry_run',
          stepId: step.id || intent.id || null,
          intent,
          requestCaptureId: response.requestCaptureId,
          result: response.result,
        };
      }
      if (intent.type === 'rest') {
        if (!wixClient) {
          wixClient = createWixClient({
            ...config,
            dryRun,
            runContext: { ...(config.runContext || {}), phase: 'setup' },
          });
        }
        return wixClient.send(request);
      }
      if (intent.type === 'mcp' && typeof transports.mcp === 'function') {
        return transports.mcp(intent);
      }
      if (intent.type === 'cli' && typeof transports.cli === 'function') {
        return transports.cli(intent);
      }
      if (intent.type === 'sdk' && typeof transports.sdk === 'function') {
        return transports.sdk(intent);
      }
      throw new Error(`unsupported setup transport: ${intent.type || '<missing>'}`);
    },
  };
}

// --- missing-writer bootstrap ---------------------------------------------
// Generated migrations use this when Wix has a native entity but rp-target-wix does not
// yet ship a dedicated writer primitive. This keeps the write path explicit and logged
// without pretending generic CMS is an acceptable substitute for a native Wix entity.
function buildDirectRestRequest({ method, path, url, body }, safeModeOptions) {
  if (!method) throw new Error('buildDirectRestRequest: method is required');
  if (!path && !url) throw new Error('buildDirectRestRequest: path or url is required');
  const prepared = applySafeModeToRequest(body, safeModeOptions);
  return {
    method,
    url: url || `${WIXAPIS}${path.startsWith('/') ? path : `/${path}`}`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function sendDirectRest(wix, request, safeModeOptions) {
  return wix.send(buildDirectRestRequest(request, safeModeOptions));
}
async function notifyMissingWriter({ sourceEntity, wixEntity, method, path, reason }) {
  // NOOP for now. Replace with Slack/Jira/telemetry once the RePlatform team chooses a
  // destination. Keep the return value structured so callers can log/report it.
  return {
    notified: false,
    noop: true,
    sourceEntity,
    wixEntity,
    method,
    path,
    reason,
  };
}

// --- slugs ------------------------------------------------------------------
// Slug sanitizing lives in `wix-build.js` (`toWixSlug`, applied automatically by the
// `coerce: 'slug'` rule on `product.slug` in wix-target-spec.js) — NOT here, and deliberately
// not inside normalizeStoresProductV3. Two reasons it stays in the build layer: URL preservation
// needs the caller to record the original source slug alongside the `plannedTargetSlug` it
// derived, which a silent rewrite inside the writer would falsify; and the build layer is where
// the canonical→Wix payload rules are regression-locked. Do not add a second copy here.

// --- rich content: HTML → Ricos document -----------------------------------
// VERIFIED: POST /ricos/v1/ricos-document/convert/to-ricos with HTML input.
// VERIFIED-TRAP: `options.plugins` enum values are UPPERCASE. The public
// docs example shows lowercase (["image","link"]); lowercase returns HTTP 400.
// VERIFIED-TRAP: `source.html` is capped at 30000 chars (400 MAX_LENGTH).
// `convertHtmlToRichContent` transparently chunks larger HTML and merges the Ricos
// node arrays, so callers never have to think about the cap.
const RICOS_PLUGINS = ['IMAGE', 'LINK', 'VIDEO', 'AUDIO', 'HEADING', 'DIVIDER', 'CODE_BLOCK', 'TABLE', 'GALLERY'];
const RICOS_HTML_CAP = 30000; // hard limit on source.html (400 MAX_LENGTH above this)
const RICOS_CHUNK_TARGET = 28000; // headroom under the cap
function buildConvertToRicosRequest(html, plugins = RICOS_PLUGINS) {
  return { method: 'POST', url: `${WIXAPIS}/ricos/v1/ricos-document/convert/to-ricos`, body: { html, options: { plugins } } };
}
// split HTML at block-level close tags so each chunk stays under the cap
// without slicing through an element. A single block bigger than `max` is hard-split
// as a last resort (rare; logged by the caller).
function splitHtmlIntoChunks(html, max = RICOS_CHUNK_TARGET) {
  if (html.length <= max) return [html];
  const parts = html.split(/(?<=<\/(?:p|div|section|article|h[1-6]|ul|ol|li|blockquote|pre|figure|table|tbody|thead|tr)>)/i);
  const chunks = [];
  let cur = '';
  for (const part of parts) {
    if (part.length > max) {
      if (cur) { chunks.push(cur); cur = ''; }
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + part.length > max) { chunks.push(cur); cur = ''; }
    cur += part;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
// OBSERVED (2026-07-29): this endpoint throttles a sustained burst with **403** (empty message,
// empty details) rather than 429. A 50-product bulk create converts one description per product,
// and the run died partway with 49 products unwritten; a single call and a burst of 12 succeeded
// moments later, so the condition is transient. Retry with backoff instead of failing the batch.
// A genuine permission 403 still surfaces, just after the attempts are exhausted.
const RICOS_RETRY_DELAYS_MS = [500, 1500, 4000, 9000, 20000];
function isRetryableRicosError(err) {
  return /\b(403|429|500|502|503|504)\b/.test(err && err.message ? err.message : '');
}
async function convertHtmlToRichContent(wix, html, { plugins, mediaBySourceUrl } = {}) {
  const chunks = splitHtmlIntoChunks(html || '');
  let merged = null;
  for (const chunk of chunks) {
    let document;
    for (let attempt = 0; ; attempt += 1) {
      try {
        ({ document } = await wix.send(buildConvertToRicosRequest(chunk, plugins)));
        break;
      } catch (err) {
        if (attempt >= RICOS_RETRY_DELAYS_MS.length || !isRetryableRicosError(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, RICOS_RETRY_DELAYS_MS[attempt]));
      }
    }
    if (!merged) merged = document;
    else merged.nodes = (merged.nodes || []).concat(document.nodes || []);
  }
  return mediaBySourceUrl ? rewriteInlineMedia(merged, mediaBySourceUrl) : merged;
}
// VERIFIED-TRAP (2026-08-04, live to-ricos call): the converter nests the media object
// under a type-named key — `imageData.image.src.url`, `videoData.video.src.url`,
// `audioData.audio.src.url`. The earlier `media.src` / bare `src` paths matched nothing,
// so inline rewrites were silently a no-op (posts kept hot-linking the source host).
function rewriteInlineMedia(ricosDocument, mediaBySourceUrl) {
  const MEDIA_KEYS = { imageData: 'image', videoData: 'video', audioData: 'audio' };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, inner] of Object.entries(MEDIA_KEYS)) {
      const holder = node[key]?.[inner] || node[key]?.media || node[key];
      const src = holder?.src?.url;
      if (src && mediaBySourceUrl.has(src)) {
        holder.src = { id: mediaBySourceUrl.get(src) };
      }
    }
    (node.nodes || []).forEach(visit);
  };
  (ricosDocument?.nodes || []).forEach(visit);
  return ricosDocument;
}

// --- media (import-from-URL) -----------------------------------------------
// VERIFIED: POST /site-media/v1/files/import. ASYNC — the response file has
// operationStatus PENDING. VERIFIED (2026-08-04, live): a PENDING id is immediately
// referenceable in BLOG content (heroImage.id + inline Ricos src.id) — create/publish
// succeed while PENDING, the reference survives, and the CDN URL serves pre-READY —
// so blog writers must NOT block on waitUntilFileReady per file. Poll only when the
// flow reads the descriptor back (dimensions land at READY) or must surface a FAILED
// import before content ships. Unverified for product media / CMS reference fields —
// keep the wait there (README Part 5 item 20).
function buildImportMediaRequest({ sourceUrl, displayName, mimeType, mediaType, wpId }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/site-media/v1/files/import`,
    body: {
      url: sourceUrl,
      displayName,
      mimeType: mimeType || undefined,
      mediaType: mediaType ? String(mediaType).toUpperCase() : undefined, // IMAGE | AUDIO | VIDEO | DOCUMENT
      externalInfo: wpId != null ? { origin: 'wordpress', externalId: String(wpId) } : undefined,
    },
  };
}
async function importMedia(wix, payload) {
  const { file } = await wix.send(buildImportMediaRequest(payload));
  return file; // { id, url, operationStatus, ... }
}
// VERIFIED: GET /site-media/v1/files/{id} returns the descriptor; poll until ready.
async function waitUntilFileReady(wix, fileId, { tries = 10, delayMs = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await wix.send({ method: 'GET', url: `${WIXAPIS}/site-media/v1/files/${fileId}` });
    const status = r?.file?.operationStatus;
    if (status === 'READY') return r.file;
    if (status === 'FAILED') {
      // Tagged, because the caller has to tell a genuinely failed import from a 429/503 on the
      // way to asking -- one is terminal, the other is worth retrying.
      throw Object.assign(new Error(`media import failed for ${fileId}`), { code: 'MEDIA_IMPORT_FAILED' });
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null; // caller decides whether to proceed with a still-PENDING file
}

// --- Data Extension Schema transport (spec 0058 phase 2) -------------------
// The decision logic is in data-extension-schema.js and is deliberately pure. This is the thin
// transport around it, plus one orchestrator so the sequence cannot be shortcut: LIST (including
// archived fields, or the collision check is blind) -> PLAN -> send -> RE-READ -> verify.
//
// The re-read is not ceremony. A create or update can report success without producing the field,
// and generated import code must not write a value into a field setup did not verify.
async function listDataExtensionSchemas(wix, { fqdn, namespace, includeArchived = true } = {}) {
  return wix.send(dataExtensionSchema.buildListDataExtensionSchemasRequest({ fqdn, namespace, includeArchived }));
}

async function createDataExtensionSchema(wix, payload) {
  return (await wix.send(dataExtensionSchema.buildCreateDataExtensionSchemaRequest(payload))).dataExtensionSchema;
}

async function updateDataExtensionSchema(wix, payload) {
  return (await wix.send(dataExtensionSchema.buildUpdateDataExtensionSchemaRequest(payload))).dataExtensionSchema;
}

async function provisionExtendedFieldSchema(wix, { requirement, dryRun = false, approvedBreakingChanges = false } = {}) {
  const { fqdn, namespace } = requirement;

  // The stamp is RECOMPUTED here from the requirement in hand, never copied off it. Copying is
  // what made the whole chain circular: the receipt said "contract X" because the requirement
  // claimed to be contract X, so a requirement edited after stamping produced a receipt that
  // vouched for fields nobody had checked. A stamp minted from the actual field set cannot lie
  // about which field set it describes, and one carried in that disagrees is a hard stop rather
  // than something to reconcile.
  const contractVersion = dataExtensionSchema.extendedFieldContractVersion(requirement);
  if (requirement.contractVersion && requirement.contractVersion !== contractVersion) {
    return {
      action: 'blocked',
      blocking: [{
        code: 'requirement-stamp-mismatch',
        detail: `the requirement is stamped ${requirement.contractVersion} but its fields hash to ${contractVersion}; it was edited after it was stamped`,
      }],
      verification: null,
    };
  }

  const listed = await listDataExtensionSchemas(wix, { fqdn, namespace });
  const existingSchema = dataExtensionSchema.selectUserFieldsSchema(listed, { fqdn, namespace });

  const plan = dataExtensionSchema.planDataExtensionSchemaProvisioning({ requirement, existingSchema, approvedBreakingChanges });
  if (plan.action === 'blocked') {
    return { action: 'blocked', blocking: plan.blocking, verification: null };
  }
  if (plan.action === 'noop') {
    // Already provisioned: still verify, so a run that changed nothing still records evidence
    // the writers can be checked against.
    const verification = dataExtensionSchema.verifyDataExtensionSchemaFields({ schema: existingSchema, fields: requirement.fields, contractVersion });
    return { action: 'noop', blocking: [], verification };
  }
  if (dryRun) {
    return { action: `planned_${plan.action}`, blocking: [], verification: null, request: plan.request };
  }

  if (plan.action === 'create') {
    await createDataExtensionSchema(wix, { fqdn, namespace, jsonSchema: plan.jsonSchema });
  } else {
    await updateDataExtensionSchema(wix, {
      schemaId: existingSchema.id,
      revision: existingSchema.revision,
      mergedSchema: plan.jsonSchema,
    });
  }

  // Re-read rather than trusting the write's own response -- but the re-read PROPAGATES.
  // LIVE-VERIFIED 2026-09-04: an immediate re-read after a successful create reported both fields
  // absent, while an order PATCH moments later accepted values for them, which it only does when
  // the schema contains them. So the write had landed and the read was stale. Verifying once
  // produced a false "not verified after write" that would block the invoice branch on every
  // fresh provision. Retry the read a bounded number of times before believing it.
  let verification = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const reread = await listDataExtensionSchemas(wix, { fqdn, namespace });
    const provisioned = dataExtensionSchema.selectUserFieldsSchema(reread, { fqdn, namespace });
    verification = dataExtensionSchema.verifyDataExtensionSchemaFields({ schema: provisioned, fields: requirement.fields, contractVersion });
    if (verification.passed) break;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  if (!verification.passed) {
    return {
      action: plan.action,
      blocking: [{
        code: 'extended-field-not-verified-after-write',
        detail: `the ${plan.action} reported success but these fields are absent on re-read: ${verification.missing.join(', ')}`,
      }],
      verification,
    };
  }
  return { action: plan.action, blocking: [], verification };
}

// --- private documents + order extendedFields (invoice preservation) --------
// Re-checked against the live schemas 2026-09-03.
//
// Import File takes `private: true`, which is what keeps a preserved tax document out of public
// reach. Two traps recorded from the same re-check:
//   * The response echoes `sourceUrl`. Persisting the descriptor therefore persists the raw
//     source URL -- a bearer link whose filename can carry the customer's name and the invoice
//     number. Only the `id` is ever kept.
//   * `displayName` shows in the merchant's Media Manager. It is built from the invoice number,
//     never from the source URL's filename, for the same reason.
//
// Generate File Download Url defaults `expirationInMinutes` to 600 -- ten hours. That is not
// "short-lived", so the expiry is always passed explicitly.
//
// Update Order accepts `extendedFields` (confirmed: it is in the updatable-fields list, and the
// call needs ECOM.ORDER_WRITE_ALL_EXTENDED_FIELDS / Manage Orders). PATCH replaces the object it
// is given and "to remove a field's value, pass null", so a partial `extendedFields` DROPS every
// other namespace. The merge below is mandatory for the same reason the Data Extension Schema
// merge is.
const INVOICE_DOWNLOAD_EXPIRY_MINUTES = 10;
// One folder, so preserved documents never mix with the merchant's own media.
const INVOICE_MEDIA_FOLDER = '/Imported invoices';

function buildImportPrivateDocumentRequest({ sourceUrl, invoiceNumber, orderId }) {
  if (!sourceUrl) throw new Error('importing a private document needs its source url');
  // Neutral, derived name only: never the source filename.
  const displayName = invoiceNumber
    ? `Source invoice ${String(invoiceNumber).slice(0, 64)}`
    : `Source invoice for order ${String(orderId || 'unknown').slice(0, 64)}`;
  return {
    method: 'POST',
    url: `${WIXAPIS}/site-media/v1/files/import`,
    body: {
      url: sourceUrl,
      private: true,
      mediaType: 'DOCUMENT',
      // A FOLDER, not the root. The Media Manager is the merchant's ACTUAL way in to these
      // documents -- the file id on the order is an opaque string they can do nothing with, so
      // finding "Source invoice 847" by name in Media Manager is the access path that works.
      // Which makes where they land a real decision: importing to `media-root` drops thousands of
      // PDFs into the library the merchant keeps their own photos in. `filePath` creates the
      // folder if it does not exist.
      filePath: INVOICE_MEDIA_FOLDER,
      displayName,
    },
  };
}

async function importPrivateDocument(wix, payload) {
  const { file } = await wix.send(buildImportPrivateDocumentRequest(payload));
  // Deliberately narrow: the descriptor carries sourceUrl and must not be handed on or stored.
  return { fileId: file && file.id, operationStatus: file && file.operationStatus, private: file && file.private };
}

function buildGenerateFileDownloadUrlRequest({ fileId, expirationInMinutes = INVOICE_DOWNLOAD_EXPIRY_MINUTES, contentDisposition = 'ATTACHMENT' }) {
  if (!fileId) throw new Error('generating a download url needs a fileId');
  if (!Number.isInteger(expirationInMinutes) || expirationInMinutes < 1) {
    throw new Error('expirationInMinutes must be a positive integer; the API default of 600 is not short-lived');
  }
  return {
    method: 'POST',
    url: `${WIXAPIS}/site-media/v1/files/generate-file-download-url`,
    body: { fileId, expirationInMinutes, contentDisposition },
  };
}

// Preserves every other namespace and every other key inside our own namespace.
function mergeOrderExtendedFields(currentExtendedFields, namespace, values) {
  const current = currentExtendedFields || {};
  const namespaces = current.namespaces || {};
  const mine = namespaces[namespace] || {};
  return {
    ...current,
    namespaces: {
      ...namespaces,
      [namespace]: { ...mine, ...values },
    },
  };
}

function buildUpdateOrderExtendedFieldsRequest({ orderId, currentExtendedFields = null, namespace = '_user_fields', values = {} }) {
  if (!orderId) throw new Error('updating order extended fields needs the order id');
  if (Object.keys(values).length === 0) throw new Error('updating order extended fields needs at least one value');
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`extended field "${key}" must be a non-empty string`);
    }
    // A URL belongs in exactly ONE field, the one named for it. Anywhere else it is a mistake:
    // a URL in the file-id field means the caller confused the durable copy with the pointer to
    // the original, which is the error this guard was written to catch and still catches.
    //
    // The URL field itself is deliberate, added 2026-09-05: the merchant already has that link on
    // their own store, our fields are readable by apps and users but NOT site visitors, and a
    // clickable pointer is worth having. It rots -- the label says so -- and it never replaces
    // the preserved copy.
    if (/^https?:\/\//i.test(value) && key !== invoiceContract.ROLES.url) {
      throw new Error(`extended field "${key}" looks like a URL; store the private file id there, and the source link only in replatformSourceInvoiceUrl`);
    }
  }
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/ecom/v1/orders/${encodeURIComponent(orderId)}`,
    body: { order: { extendedFields: mergeOrderExtendedFields(currentExtendedFields, namespace, values) } },
  };
}

async function updateOrderExtendedFields(wix, payload) {
  return (await wix.send(buildUpdateOrderExtendedFieldsRequest(payload))).order;
}

function buildGetOrderRequest(orderId) {
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/orders/${encodeURIComponent(orderId)}` };
}
async function getOrder(wix, orderId) {
  return (await wix.send(buildGetOrderRequest(orderId))).order;
}

// Preserve one source invoice document against one imported order.
//
// The order is its own record of what happened: an existing file id suppresses the import, which
// is what makes a re-run idempotent WITHOUT depending on the migration crosswalk. A crosswalk row
// may accelerate this, but correctness does not rest on it -- a lost crosswalk must not cause a
// second copy of a tax document to be imported.
async function preserveOrderInvoiceDocument(wix, {
  orderId,
  sourceUrl,
  invoiceNumber,
  namespace = '_user_fields',
  setupVerification = null,
  approval = null,
  pendingMediaFileId = null,
  // The source site's host, so this writer can tell a document that dies with the old store from
  // one living in a provider's archive. Omitted, everything reads as third-party and needs an
  // explicit opt-in -- conservative on purpose.
  sourceSiteHost = null,
} = {}) {
  if (!orderId) throw new Error('preserving an invoice document needs the order id');
  // A number that is not a string or a number is a caller bug, and String() would have written
  // "[object Object]" onto the merchant's order as their invoice number.
  if (invoiceNumber !== null && invoiceNumber !== undefined && typeof invoiceNumber !== 'string' && typeof invoiceNumber !== 'number') {
    throw new Error(`invoiceNumber must be a string or number, got ${JSON.stringify(invoiceNumber)}`);
  }

  // TWO gates, because this URL comes from source-site metadata and Wix will fetch it
  // server-side. Discovery classifying it is not enough: nothing forced a caller to route through
  // discovery, so this writer imported `https://169.254.169.254/latest/meta-data` when handed it
  // directly, and imported a third-party document with no merchant opt-in.
  //
  // 1. An approval from the preservation plan, naming this exact URL and an action that permits
  //    an import. `offer-preservation` only qualifies once the merchant opted in.
  if (!approval || approval.documentUrl !== sourceUrl) {
    return { outcome: 'invoice-preservation-not-approved', fileId: null, imported: false };
  }
  // `reference-only` is a legitimate approval that permits NO import: there is no document, and
  // the invoice number still has to be retained on the order.
  const wantsImport = approval.action !== 'reference-only';

  // 2. The URL is re-classified HERE, against the shared guard, and the DECISION is re-derived
  //    from that classification rather than read off the approval.
  //
  //    `action` is caller-supplied. Trusting it meant a caller could take a third-party document
  //    the planner had classified `offer-preservation`, hand it over as `{action: 'preserve'}`
  //    with no opt-in anywhere, and the writer imported it — a merchant's tax documents copied
  //    out of their provider's archive on nobody's authority. Re-deriving costs nothing: this
  //    call was already being made for safety.
  //
  //    With no `sourceSiteHost` the guard answers `third-party`, which is the conservative
  //    answer, so a caller who omits it needs an explicit opt-in rather than getting a free pass.
  let importPermitted = false;
  if (wantsImport && sourceUrl) {
    const classification = documentUrlGuard.classifyDocumentUrl(sourceUrl, { sourceSiteHost });
    if (!classification.safe) {
      return {
        outcome: 'invoice-document-url-unsafe',
        fileId: null,
        imported: false,
        reason: classification.reason,
        redactedUrl: documentUrlGuard.redactUrlForLog(sourceUrl),
      };
    }
    // Bytes that die with the source site are re-hosted without asking. Anything else is somebody
    // else's archive and needs the merchant to have said so.
    const onSourceSite = classification.location === 'wordpress';
    const permittedWithoutOptIn = onSourceSite && approval.action === 'preserve';
    // The opt-in is BELIEVED only when the planner stamped it. `merchantOptedIn: true` is a plain
    // boolean on a plain object, and review showed a hand-built approval carrying it reached the
    // Media import of a third-party document. A stamp from resolvePreservationPlan is the evidence
    // that the decision was made where the merchant actually made it -- the approval gate.
    const optedIn = approval.merchantOptedIn === true;
    if (!permittedWithoutOptIn && optedIn && !approvalStamp.verifyApprovalStamp(approval)) {
      return {
        outcome: 'invoice-preservation-not-approved',
        fileId: null,
        imported: false,
        reason: 'approval-not-stamped-by-plan',
      };
    }
    importPermitted = permittedWithoutOptIn
      || (optedIn && (approval.action === 'preserve' || approval.action === 'offer-preservation'));
    if (!importPermitted) {
      return {
        outcome: 'invoice-preservation-declined',
        fileId: null,
        imported: false,
        // Named, because "declined" otherwise reads as the merchant's choice when it was ours.
        reason: onSourceSite ? 'action-does-not-permit-import' : 'third-party-document-without-opt-in',
      };
    }
  } else if (wantsImport) {
    return { outcome: 'invoice-preservation-declined', fileId: null, imported: false, reason: 'no-document-url' };
  }

  // A value may not be written into an extended field that setup did not verify. This guard was
  // previously available and never called, so the rule existed only in prose.
  let overLengthUrl = null;
  const writePaths = invoiceContract.writePaths(namespace);
  const allowed = dataExtensionSchema.validateExtendedFieldWriterReferences({ writePaths, setupVerification, contractVersion: invoiceContract.version() });
  if (!allowed.valid) {
    return { outcome: 'invoice-fields-not-provisioned', fileId: null, imported: false, errors: allowed.errors };
  }

  // READ THE ORDER HERE, rather than trusting a caller-supplied copy. A stale copy is what makes
  // a second import of the same tax document possible, and patching a stale `extendedFields`
  // back would overwrite whatever landed in it since. This read is also what makes re-run safety
  // independent of the migration crosswalk.
  const order = await getOrder(wix, orderId);
  const fields = (order && order.extendedFields && order.extendedFields.namespaces && order.extendedFields.namespaces[namespace]) || {};
  const existingFileId = fields.replatformSourceInvoiceFileId;

  if (existingFileId) {
    return { outcome: 'invoice-already-preserved', fileId: existingFileId, imported: false };
  }

  const values = {};
  let fileId = null;
  if (sourceUrl) {
    // A previous run may have left an import in flight. Resuming it is the difference between
    // finishing that import and creating another private orphan on every retry.
    const imported = pendingMediaFileId
      ? { fileId: pendingMediaFileId, operationStatus: 'PENDING' }
      : await importPrivateDocument(wix, { sourceUrl, invoiceNumber, orderId });
    if (!imported.fileId) {
      // No file id means nothing to record. The raw url is NOT stored as a consolation.
      return { outcome: 'invoice-import-failed', fileId: null, imported: false };
    }

    // Media import is ASYNCHRONOUS: the response is normally PENDING and processing can fail
    // afterwards. Recording the id before it is READY is a trap that closes behind itself --
    // every later run sees a file id on the order and suppresses re-import, so a document that
    // never finished importing stays permanently recorded as preserved. Only READY is stored.
    // waitUntilFileReady THROWS on FAILED and returns null when it runs out of tries, so the two
    // outcomes have to be told apart -- a failed import and an import still in flight need
    // different reports, and flattening both to null called a failure "not ready".
    let status = imported.operationStatus;
    if (status !== 'READY') {
      try {
        const settled = await waitUntilFileReady(wix, imported.fileId);
        status = settled ? settled.operationStatus : 'PENDING';
      } catch (error) {
        // Only a tagged failure is terminal. A transport fault means we do not know yet, and
        // calling that FAILED would discard a file that may well be fine.
        status = error && error.code === 'MEDIA_IMPORT_FAILED' ? 'FAILED' : 'UNKNOWN';
      }
    }
    if (status !== 'READY') {
      const outcome = status === 'FAILED'
        ? 'invoice-import-failed'
        : (status === 'UNKNOWN' ? 'invoice-import-read-failed' : 'invoice-import-not-ready');
      return {
        outcome,
        fileId: null,
        imported: false,
        // Hand the id back so the next run can RESUME this import rather than start another.
        // Retryable only when the import itself has not failed.
        pendingMediaFileId: status === 'FAILED' ? null : imported.fileId,
        mediaFileId: imported.fileId,
      };
    }
    fileId = imported.fileId;
    values.replatformSourceInvoiceFileId = fileId;
  }
  if (invoiceNumber) values.replatformSourceInvoiceNumber = String(invoiceNumber);
  // The original link, stored ALONGSIDE the preserved copy and never instead of it. It is what a
  // merchant can actually click today; it is also the thing that rots, so its label says so. It is
  // only recorded when the document was classified safe -- an unsafe URL is reported, not stored.
  if (sourceUrl && importPermitted) {
    // NEVER truncate. A signed or query-bearing URL cut at 2048 is not a shorter link, it is a
    // broken one -- and it would be stored under a label promising the merchant it works, on an
    // order the report calls preserved. Over-length is reported and the field is left unset; the
    // preserved copy is unaffected, which is the point of it being the durable one.
    // The cap comes from the entity that declares the field, not from a number retyped here --
    // a writer carrying its own copy accepts 1500 characters the day the entity says 1024.
    const link = String(sourceUrl);
    const cap = invoiceContract.maxLengthFor('url');
    if (link.length <= cap) values[invoiceContract.ROLES.url] = link;
    else overLengthUrl = { length: link.length, limit: cap };
  }

  if (Object.keys(values).length === 0) {
    return { outcome: 'invoice-none-found', fileId: null, imported: false };
  }

  // The patch is the LAST step, after the file is already READY in Media. If it fails, the file id
  // must not be lost: nothing on the order records it yet, so a resume that started over would
  // import a second private copy of a tax document -- review demonstrated exactly that. The id is
  // handed back as `pendingMediaFileId`, and the next run resumes from it (the same path a
  // still-PENDING import uses) instead of importing again.
  try {
    await updateOrderExtendedFields(wix, {
      orderId,
      currentExtendedFields: order && order.extendedFields,
      namespace,
      values,
    });
  } catch (error) {
    return {
      outcome: 'invoice-fields-write-failed',
      fileId: null,
      imported: false,
      pendingMediaFileId: fileId || null,
      mediaFileId: fileId || null,
      error: { message: String((error && error.message) || error).slice(0, 300), ...(error && error.status ? { status: error.status } : {}) },
    };
  }
  if (overLengthUrl) {
    return { outcome: 'invoice-preserved', fileId, imported: Boolean(fileId), findings: [{ code: 'invoice-link-over-length', ...overLengthUrl }] };
  }

  return {
    outcome: fileId ? 'invoice-preserved' : 'invoice-number-only',
    fileId,
    imported: Boolean(fileId),
  };
}

// --- blog taxonomies -------------------------------------------------------
// VERIFIED: POST /blog/v3/categories with { category: { label, slug, description } }.
function buildCreateCategoryRequest({ label, slug, description }, safeModeOptions) {
  const prepared = applySafeModeToRequest({ category: { label, slug, description: description || '' } }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/categories`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createBlogCategory(wix, payload, safeModeOptions) {
  return (await wix.send(buildCreateCategoryRequest(payload, safeModeOptions))).category;
}
// VERIFIED: POST /blog/v3/tags. Body is TOP-LEVEL { label, language } — NOT
// { tag: { label, slug } }. `slug` is derived by Wix from the label.
function buildCreateTagRequest({ label, language = 'en' }, safeModeOptions) {
  const prepared = applySafeModeToRequest({ label, language }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/tags`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createBlogTag(wix, payload, safeModeOptions) {
  return (await wix.send(buildCreateTagRequest(payload, safeModeOptions))).tag;
}
// VERIFIED: GET /blog/v3/tags lists tags as { id, label, slug, ... }. Used to resolve a
// tag id after a 409 ALREADY_EXISTS so it can still be attached to a post.
async function listBlogTags(wix, { limit = 500 } = {}) {
  const r = await wix.send({ method: 'GET', url: `${WIXAPIS}/blog/v3/tags?paging.limit=${limit}` });
  return r.tags || [];
}

// --- blog posts ------------------------------------------------------------
// VERIFIED: POST /blog/v3/draft-posts then POST /blog/v3/draft-posts/{id}/publish.
// memberId is REQUIRED for 3rd-party app creates. Visible custom cover media requires
// BOTH `heroImage.id` and `media.{displayed,custom,wixMedia.image.id}` — `heroImage.id`
// alone leaves the cover hidden in Wix Blog.
// VERIFIED (2026-08-02): the site owner's auto-created user-member (present on our
// API-provisioned test site with zero Members-area interaction — single-site
// observation; resolve it via listMembers + loginEmail, never derive it from
// the account/user GUID — the observed id equality is undocumented) is accepted as
// memberId — attribute-to-owner needs no member provisioning. Author is re-assignable
// AFTER publish: PATCH
// /blog/v3/draft-posts/{id} { draftPost: { memberId } } then republish updates the
// published post (post id == draft id). Republish events are NOT suppressed by
// saveType=IMPORT — run author-upgrade passes inside the notification-mute window.
// VERIFIED (2026-06-10): tags attach via `tagIds` (array of tag GUIDs) on create — the
// builder must pass them or tags are created but never linked (postCount stays 0).
// VERIFIED-TRAP (2026-07-19): the draft-post REQUEST field for the slug is `seoSlug` —
// a `slug` key is silently ignored and Wix derives the slug from the title (only the
// RESPONSE carries `slug`). Fix-up after the fact: PATCH /blog/v3/draft-posts/{id} with
// { draftPost: { seoSlug } } then republish. Wix also reserves some slugs and coerces
// them (e.g. `pts` → `__pts`), which no request shape can override.
// VERIFIED-TRAP (2026-07-21, coffeeshop51): Wix rejects seoSlug whose percent-encoded
// form exceeds 100 chars (common for non-ASCII/Hebrew slugs: a 10-char Hebrew slug
// encodes to ~60 chars, so anything over ~15 chars blows the limit). Omit the slug
// when it is too long and let Wix derive it from the title.
function safeSeoslug(slug) {
  if (!slug) return undefined;
  try { return encodeURIComponent(slug).length <= 100 ? slug : undefined; } catch { return undefined; }
}
function toDraftPostBody({ title, memberId, richContent, excerpt, slug, categoryIds, tagIds, firstPublishedDate, heroImageId }) {
  return {
    title,
    memberId, // REQUIRED
    richContent, // Ricos document
    excerpt: excerpt || undefined,
    seoSlug: safeSeoslug(slug),
    categoryIds: categoryIds || [],
    tagIds: tagIds && tagIds.length ? tagIds : undefined,
    firstPublishedDate: firstPublishedDate || undefined,
    heroImage: heroImageId ? { id: heroImageId } : undefined,
    media: heroImageId ? { displayed: true, custom: true, wixMedia: { image: { id: heroImageId } } } : undefined,
  };
}
function buildCreateDraftPostRequest(payload) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/draft-posts`,
    body: { draftPost: toDraftPostBody(payload) },
  };
}
async function createDraftPost(wix, payload) {
  return (await wix.send(buildCreateDraftPostRequest(payload))).draftPost;
}
async function publishDraftPost(wix, draftPostId) {
  return wix.send({ method: 'POST', url: `${WIXAPIS}/blog/v3/draft-posts/${draftPostId}/publish`, body: {} });
}

// VERIFIED (docs): DELETE /blog/v3/draft-posts/{draftPostId}. Despite the path, this also
// deletes an already-published post by the same id (draft id === published post id — see
// the "AFTER publish" note above). Moves to trash by default; pass permanent: true to skip
// the trash bin, which is what a throwaway test/verification post should use.
function buildDeleteDraftPostRequest(draftPostId, { permanent = false } = {}) {
  const query = permanent ? '?permanent=true' : '';
  return { method: 'DELETE', url: `${WIXAPIS}/blog/v3/draft-posts/${draftPostId}${query}` };
}
async function deleteDraftPost(wix, draftPostId, options) {
  return wix.send(buildDeleteDraftPostRequest(draftPostId, options));
}

// UNVERIFIED: POST /blog/v3/bulk/draft-posts/create — bulk draft-post create, max 20
// posts per call (docs `draftPosts` validation: minItems 1, maxItems 20). Surfaced by the
// wix/skills `wix-manage` recipe (which recommends it "for any N ≥ 2", citing ~25–30s per
// single-post call) and confirmed against the public docs page; no live call yet, so per
// adapter policy it must be surfaced in the execution plan until the contract test
// promotes it. Whether the bulk create can publish directly (a `publish` flag) is
// unverified — publish remains per-post via publishDraftPost until proven otherwise.
const BLOG_BULK_CREATE_MAX = 20;
function buildBulkCreateDraftPostsRequest(payloads) {
  if (!Array.isArray(payloads) || payloads.length < 1 || payloads.length > BLOG_BULK_CREATE_MAX) {
    throw new Error(`buildBulkCreateDraftPostsRequest: expected 1..${BLOG_BULK_CREATE_MAX} payloads, got ${Array.isArray(payloads) ? payloads.length : typeof payloads}`);
  }
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/bulk/draft-posts/create`,
    body: { draftPosts: payloads.map(toDraftPostBody) },
  };
}
// Chunks any number of payloads into ≤20-post calls, sequentially, and returns the
// concatenated raw per-call responses (response item shape unverified — callers must
// inspect until the live contract call pins it down).
async function bulkCreateDraftPosts(wix, payloads) {
  const responses = [];
  for (let i = 0; i < payloads.length; i += BLOG_BULK_CREATE_MAX) {
    responses.push(await wix.send(buildBulkCreateDraftPostsRequest(payloads.slice(i, i + BLOG_BULK_CREATE_MAX))));
  }
  return responses;
}

// --- CMS items (Wix Data) --------------------------------------------------
// VERIFIED: POST /wix-data/v2/items with { dataCollectionId, dataItem: { data } }.
// Requires Wix Data enabled on the site (WDE0110 otherwise — see rp-execute-setup).
// `data` is project-specific (the generated writer supplies the field map).
// If the payload supplies `data._id`, Wix also requires `dataItem.id` to match.
//
// TRAP (found 2026-08-12 live run): when a caller sets a deterministic `data._id` (this
// project's cms.js does, for podcast/dinekit/job-type, so the CMS item id is traceable back to
// the source id), the live API 400s "WDE0080: dataItem id and data._id fields must match" unless
// `dataItem.id` is ALSO set to that same value — `dataItem.id` is the authoritative item id;
// `data._id` alone is not enough. Every insert in this project failed on this until fixed here.
function buildInsertItemRequest(collectionId, data, safeModeOptions) {
  const dataItem = { data };
  if (data && typeof data === 'object' && !Array.isArray(data) && data._id != null && String(data._id).trim() !== '') {
    dataItem.id = String(data._id);
  }
  const prepared = applySafeModeToRequest({ dataCollectionId: collectionId, dataItem }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/wix-data/v2/items`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function insertDataItem(wix, collectionId, data, safeModeOptions) {
  return (await wix.send(buildInsertItemRequest(collectionId, data, safeModeOptions))).dataItem;
}
// VERIFIED: POST /wix-data/v2/items/query with { dataCollectionId, query }. Paginates via
// query.paging {limit,offset}; returns dataItems[] (we return their `.data`). Required for
// optional CMS mirror fetch: only for pre-execution seeding when an existing-site flow has
// site-local reference data and valid local crosswalk state does not already exist. Runtime
// resume/idempotency is owned by state/crosswalk/crosswalk.ndjson, not CMS.
async function queryAllDataItems(wix, collectionId, { pageSize = 100 } = {}) {
  const out = [];
  let offset = 0;
  for (;;) {
    const r = await wix.send({ method: 'POST', url: `${WIXAPIS}/wix-data/v2/items/query`,
      body: { dataCollectionId: collectionId, query: { paging: { limit: pageSize, offset } } } });
    const items = (r.dataItems || []).map((d) => d.data);
    out.push(...items);
    if (items.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// --- Stores catalog (Catalog V3 ONLY) --------------------------------------
// Catalog V1 is NOT a supported destination: these primitives target V3 exclusively, there is
// no V1 fallback (it only masked real V3 errors as spurious 428s), and none should be added.
// Catalog V3 is guaranteed at provisioning for a site this run creates (see
// 0079-catalog-v3-guaranteed-retire-v1-gate.md), so callers need no pre-write check there; a
// pre-existing site this run did not create is the one remaining case that can still be V1 —
// see rp-execute-setup's "A V1_CATALOG verdict is terminal here". Wix Stores app id (installing it pulls in Wix
// eCommerce): 215238eb-…
const WIX_STORES_APP_ID = '215238eb-22a5-4c36-9e7b-e7c08025e04e';
// Categories V3 require a top-level treeReference; appNamespace is always "@wix/stores".
const STORES_TREE_REFERENCE = { appNamespace: '@wix/stores' };
const PRODUCT_NAME_MAX = 80;
const CHOICE_NAME_MAX = 50;
// Products V3 schema: plainDescription is `string, maxLength 16000`. Unlike the Ricos path — which
// chunked at 28k and merged node arrays, so it was effectively unbounded — this is a hard cap.
const PLAIN_DESCRIPTION_MAX = 16000;
const STORES_SUBSCRIPTION_DESCRIPTION_MAX = 60;
const STORES_SUBSCRIPTION_FREQUENCIES = ['DAY', 'WEEK', 'MONTH', 'YEAR'];
const STORES_SUBSCRIPTION_CONTRACT = {
  domain: 'stores',
  entity: 'product',
  surface: 'catalog-v3',
  operation: 'createProduct',
  path: 'product.subscriptionDetails',
  verificationLevel: 'live-create-and-readback',
  lastVerified: '2026-07-26',
  verifiedBy: 'migration-20260726-01',
  requiredPaths: [
    'product.subscriptionDetails.allowOneTimePurchases',
    'product.subscriptionDetails.subscriptions[]',
    'product.subscriptionDetails.subscriptions[].title',
    'product.subscriptionDetails.subscriptions[].description',
    'product.subscriptionDetails.subscriptions[].frequency',
    'product.subscriptionDetails.subscriptions[].interval',
    'product.subscriptionDetails.subscriptions[].autoRenewal',
  ],
  constraints: [
    {
      path: 'product.subscriptionDetails.subscriptions[].description',
      maxLength: STORES_SUBSCRIPTION_DESCRIPTION_MAX,
      source: 'live-validation',
    },
    {
      path: 'product.subscriptionDetails.subscriptions[].frequency',
      enum: STORES_SUBSCRIPTION_FREQUENCIES,
      source: 'live-create',
    },
    {
      path: 'product.subscriptionDetails.subscriptions[].interval',
      minimum: 1,
      integer: true,
      source: 'live-create',
    },
  ],
  readback: {
    'product.subscriptionDetails': 'returned-after-create',
    'product.subscriptionDetails.subscriptions[].id': 'server-assigned',
    'product.subscriptionDetails.subscriptions[].title': 'preserved',
    'product.subscriptionDetails.subscriptions[].description': 'preserved',
    'product.subscriptionDetails.subscriptions[].frequency': 'preserved',
    'product.subscriptionDetails.subscriptions[].interval': 'preserved',
    'product.subscriptionDetails.subscriptions[].autoRenewal': 'preserved',
  },
};

function omitEmptyStringFields(input, fields) {
  const out = { ...input };
  for (const field of fields) {
    if (typeof out[field] === 'string' && out[field].trim() === '') delete out[field];
  }
  return out;
}

// Normalize a Catalog V3 product payload so callers never hit the known create traps.
// All rules below are VERIFIED by live calls (2026-07-05, ilovecupcakes + suteka2):
//  - product name is capped at 80 chars; longer names 400 MAX_LENGTH.
//  - productType PHYSICAL requires a product-level physicalProperties object present
//    (400 ONE_OF_ALIGNMENT otherwise), even though the docs create example omits it.
//  - Option choice `name` is capped at 50 chars; option and variant choice names must be
//    truncated IDENTICALLY or the variant fails MISSING_VARIANT_OPTION_CHOICE.
//  - Variant optionChoiceNames require a `renderType` (default TEXT_CHOICES); omitting it
//    428s MISSING_VARIANT_OPTION_CHOICE.
//  - compareAtPrice must be strictly greater than actualPrice; drop it otherwise (Wix
//    rejects a compare-at <= the actual price).
function clampChoiceName(name) {
  const s = String(name);
  return s.length > CHOICE_NAME_MAX ? s.slice(0, CHOICE_NAME_MAX) : s;
}
function clampProductName(name) {
  const s = String(name || '');
  return s.length > PRODUCT_NAME_MAX ? s.slice(0, PRODUCT_NAME_MAX) : s;
}
function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
// Per-item limits from the Catalog V3 spec (component ProductMedia). altText is clamped rather
// than dropped: a truncated description still helps a screen reader, an absent one helps nobody.
const MEDIA_ALT_TEXT_MAX = 1000;
const MEDIA_DISPLAY_NAME_MAX = 80;

function clampMediaText(value, max) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// Spec 0106: this used to rebuild every item as a bare { url } / { id }, which silently threw
// away altText that buildMedia had set — on create AND on patch, since normalizeStoresProductV3
// re-runs this on whatever media it is handed. Alt text is a product's accessibility and search
// text; losing it without an error is worse than rejecting it.
//
// TRAP: displayName is only accepted on url-set items. Wix rejects it alongside an `id`, so it is
// attached to the url branch only, never carried across.
function normalizeStoresProductMediaItems(items = []) {
  return items
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return isPublicHttpUrl(item) ? { url: item } : { id: item };
      }

      const altText = clampMediaText(item.altText, MEDIA_ALT_TEXT_MAX);
      const withAlt = (base) => (altText === undefined ? base : { ...base, altText });

      if (item.id) return withAlt({ id: item.id });
      if (item.mediaId) return withAlt({ id: item.mediaId });
      if (item.url && isPublicHttpUrl(item.url)) {
        const displayName = clampMediaText(item.displayName, MEDIA_DISPLAY_NAME_MAX);
        const base = { url: item.url };
        if (displayName !== undefined) base.displayName = displayName;
        return withAlt(base);
      }
      if (item.image?.id) return withAlt({ id: item.image.id });
      return null;
    })
    .filter(Boolean);
}
function buildStoresProductMedia(items = []) {
  const normalizedItems = normalizeStoresProductMediaItems(items);
  return normalizedItems.length ? { itemsInfo: { items: normalizedItems } } : undefined;
}
function compactText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function clampStoresSubscriptionDescription(value) {
  const text = compactText(value);
  if (text.length <= STORES_SUBSCRIPTION_DESCRIPTION_MAX) return text;
  return `${text.slice(0, STORES_SUBSCRIPTION_DESCRIPTION_MAX - 3).trimEnd()}...`;
}
function normalizeStoresSubscriptionFrequency(value) {
  if (value == null) return value;
  const frequency = String(value).trim().toUpperCase();
  return STORES_SUBSCRIPTION_FREQUENCIES.includes(frequency) ? frequency : value;
}
function normalizeStoresSubscriptionInterval(value) {
  if (value == null || value === '') return value;
  const interval = Number(value);
  return Number.isInteger(interval) && interval >= 1 ? interval : value;
}
function synthesizeStoresSubscriptionDescription(subscription) {
  if (subscription.description) return subscription.description;
  if (subscription.title) return subscription.title;
  const interval = normalizeStoresSubscriptionInterval(subscription.interval);
  const frequency = normalizeStoresSubscriptionFrequency(subscription.frequency);
  if (Number.isInteger(interval) && STORES_SUBSCRIPTION_FREQUENCIES.includes(frequency)) {
    const unit = frequency.toLowerCase();
    return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  }
  return 'Subscription';
}
function normalizeStoresProductSubscriptions(subscriptionDetails) {
  if (!subscriptionDetails || typeof subscriptionDetails !== 'object') return subscriptionDetails;
  const normalized = { ...subscriptionDetails };
  if (typeof normalized.allowOneTimePurchases !== 'boolean') normalized.allowOneTimePurchases = Boolean(normalized.allowOneTimePurchases);
  if (Array.isArray(subscriptionDetails.subscriptions)) {
    normalized.subscriptions = subscriptionDetails.subscriptions
      .filter(Boolean)
      .map((subscription) => ({
        ...subscription,
        description: clampStoresSubscriptionDescription(synthesizeStoresSubscriptionDescription(subscription)),
        frequency: normalizeStoresSubscriptionFrequency(subscription.frequency),
        interval: normalizeStoresSubscriptionInterval(subscription.interval),
      }));
  }
  return normalized;
}
function validateStoresProductSubscriptionDetails(product) {
  const details = product && product.subscriptionDetails;
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message });
  if (!details || typeof details !== 'object') return { ok: true, errors };
  if (typeof details.allowOneTimePurchases !== 'boolean') {
    add('product.subscriptionDetails.allowOneTimePurchases', 'required_boolean', 'allowOneTimePurchases must be boolean');
  }
  if (!Array.isArray(details.subscriptions) || details.subscriptions.length === 0) {
    add('product.subscriptionDetails.subscriptions[]', 'required_array', 'subscriptions must contain at least one entry');
    return { ok: false, errors };
  }
  details.subscriptions.forEach((subscription, index) => {
    const base = `product.subscriptionDetails.subscriptions[${index}]`;
    if (!compactText(subscription.title)) add(`${base}.title`, 'required', 'title is required');
    if (!compactText(subscription.description)) {
      add(`${base}.description`, 'required', 'description is required');
    } else if (compactText(subscription.description).length > STORES_SUBSCRIPTION_DESCRIPTION_MAX) {
      add(`${base}.description`, 'max_length', `description must be at most ${STORES_SUBSCRIPTION_DESCRIPTION_MAX} characters`);
    }
    if (!STORES_SUBSCRIPTION_FREQUENCIES.includes(subscription.frequency)) {
      add(`${base}.frequency`, 'enum', `frequency must be one of ${STORES_SUBSCRIPTION_FREQUENCIES.join(', ')}`);
    }
    if (!Number.isInteger(subscription.interval) || subscription.interval < 1) {
      add(`${base}.interval`, 'minimum', 'interval must be an integer >= 1');
    }
    if (typeof subscription.autoRenewal !== 'boolean') add(`${base}.autoRenewal`, 'required_boolean', 'autoRenewal must be boolean');
  });
  return { ok: errors.length === 0, errors };
}
// VERIFIED-TRAP (2026-07-19, nopong migration): variant `price` must be a MONEY OBJECT
// ({ actualPrice: { amount: "14.95" } }) — a bare string/number 400s "Expected an object".
// Generated transforms kept emitting scalars, so coerce here instead of failing at create.
function toMoneyObject(price) {
  if (price == null || typeof price === 'object') return price;
  return { actualPrice: { amount: String(price) } };
}
function normalizeStoresProductV3(input) {
  const product = { ...input };
  if (product.name != null) product.name = clampProductName(product.name);

  // A `description` STRING is HTML that belongs in plainDescription; `description` proper is a
  // Ricos document object. Callers that hand-build a product (or predate the plainDescription
  // switch) still pass the string, so route it here rather than sending HTML where an object
  // is expected.
  if (typeof product.description === 'string') {
    const html = product.description.trim();
    delete product.description;
    if (html && product.plainDescription == null) product.plainDescription = html;
  }
  // TRAP (Products V3 schema): "plainDescription is ignored when a value is also passed to the
  // description field." Sending both is a SILENT failure — a 200 with an empty description — so
  // it is rejected here rather than discovered on a live site.
  if (product.plainDescription != null && product.description != null) {
    throw new Error(
      `normalizeStoresProductV3: "${product.name}" sets both description and plainDescription; Wix ignores plainDescription when description is present. Set exactly one.`,
    );
  }
  if (typeof product.plainDescription === 'string' && product.plainDescription.length > PLAIN_DESCRIPTION_MAX) {
    throw new Error(
      `normalizeStoresProductV3: "${product.name}" has a ${product.plainDescription.length}-character plainDescription; Wix caps it at ${PLAIN_DESCRIPTION_MAX}. Truncate it or move the overflow into an info section, and record the loss in mapping-gaps.json.`,
    );
  }
  if (product.productType) product.productType = String(product.productType).toUpperCase();
  if (product.subscriptionDetails) {
    // Catalog V3 carries recurring offers directly on the product object. Keep the
    // nested shape stable here so create/patch flows preserve subscription payloads
    // instead of relying on incidental shallow-copy behavior.
    product.subscriptionDetails = normalizeStoresProductSubscriptions(product.subscriptionDetails);
  }

  const topLevelPrice = product.price;
  const topLevelSku = product.sku;
  const topLevelPhysicalProperties = product.physicalProperties;
  delete product.price;
  delete product.sku;
  if (product.media && Array.isArray(product.media.itemsInfo?.items || product.media.items)) {
    product.media = buildStoresProductMedia(product.media.itemsInfo?.items || product.media.items);
  }

  if (!product.variantsInfo && (topLevelPrice || topLevelSku || topLevelPhysicalProperties)) {
    product.variantsInfo = {
      variants: [{
        visible: product.visible !== false,
        ...(topLevelSku ? { sku: topLevelSku } : {}),
        ...(topLevelPrice ? { price: toMoneyObject(topLevelPrice) } : {}),
        ...(topLevelPhysicalProperties ? { physicalProperties: topLevelPhysicalProperties } : {}),
      }],
    };
  }

  if (String(product.productType || '').toUpperCase() === 'PHYSICAL') {
    product.physicalProperties = {};
  }
  if (Array.isArray(product.options)) {
    product.options = product.options.map((o) => ({
      ...o,
      optionRenderType: o.optionRenderType || 'TEXT_CHOICES',
      choicesSettings: o.choicesSettings && Array.isArray(o.choicesSettings.choices)
        // VERIFIED-TRAP (2026-07-21, coffeeshop51): `choiceType` is required on every choice — omitting it returns PRODUCT_OPTION_CHOICE_NAME_AND_TYPE_REQUIRED.
        ? { ...o.choicesSettings, choices: o.choicesSettings.choices.map((c) => ({ ...c, name: clampChoiceName(c.name), choiceType: c.choiceType || 'CHOICE_TEXT' })) }
        : o.choicesSettings,
    }));
  }
  const variants = product.variantsInfo && Array.isArray(product.variantsInfo.variants) ? product.variantsInfo.variants : null;
  if (variants) {
    product.variantsInfo = {
      ...product.variantsInfo,
      variants: variants.map((v) => {
        const nv = { ...v };
        if (nv.price != null) nv.price = toMoneyObject(nv.price);
        const price = nv.price;
        if (price && price.compareAtPrice && price.actualPrice) {
          const cmp = Number(price.compareAtPrice.amount);
          const act = Number(price.actualPrice.amount);
          if (!(cmp > act)) { const { compareAtPrice, ...rest } = price; nv.price = rest; }
        }
        if (Array.isArray(nv.choices)) {
          nv.choices = nv.choices.map((ch) => ch.optionChoiceNames
            ? { ...ch, optionChoiceNames: { renderType: 'TEXT_CHOICES', ...ch.optionChoiceNames, choiceName: clampChoiceName(ch.optionChoiceNames.choiceName) } }
            : ch);
        }
        return nv;
      }),
    };
  }
  return product;
}

// VERIFIED (Products V3 schema): `plainDescription` is a STRING of HTML (max 16000) that Wix
// converts to rich content SERVER-SIDE. It is not a plain-text flattening and costs no fidelity
// against `description` — it is the same conversion, just not ours to run.
//
// So an HTML string never routes through /ricos/v1/... on the product path. That matters at
// scale: the previous behaviour converted one description PER PRODUCT before a bulk create, so a
// 100-product batch was 100 serial round-trips plus the bulk call, and that burst is exactly what
// the endpoint throttles with a 403 (see convertHtmlToRichContent above). It is now one call.
// convertHtmlToRichContent stays for the blog path, where `richContent` really is a Ricos document.
//
// `wix` is retained (unused) so the (wix, input) call shape stays valid: flipping the signature
// would make an existing `f(wix, product)` call normalize the CLIENT object and silently return
// garbage. Now synchronous — `await` on the result is harmless.
// eslint-disable-next-line no-unused-vars
function normalizeStoresProductV3ForCreate(wix, input) {
  return normalizeStoresProductV3(input);
}

// VERIFIED (2026-07-05): POST /stores/v3/products with { product } (+ optional fields[]).
function buildCreateStoresProductRequest(product, safeModeOptions, fields) {
  const prepared = applySafeModeToRequest({ product: normalizeStoresProductV3(product) }, safeModeOptions);
  const body = prepared.body;
  if (fields) body.fields = fields;
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v3/products`,
    body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createStoresProduct(wix, product, safeModeOptions, fields) {
  const normalized = normalizeStoresProductV3ForCreate(wix, product);
  return (await wix.send(buildCreateStoresProductRequest(normalized, safeModeOptions, fields))).product;
}
// --- bulk product create (the scale path) ----------------------------------
// UNVERIFIED: POST /stores/v3/bulk/products-with-inventory/create — up to 100 products with
// their options, variants, inline brand/ribbon/infoSections AND per-variant inventory items
// in ONE request. This is the path a migration of any real size must use; creating products
// one at a time is only acceptable for a handful.
//
// PER-REQUEST LIMITS (all of them, simultaneously — exceeding ANY ONE rejects the whole
// request, so batch with ndjson.readBatchesByLimits, not on record count alone):
//   products                 <= 100
//   variantsInfo.variants    <= 1000   (total across the request)
//   options                  <= 100    (total; 2 options per product caps a batch at 50)
//   modifiers                <= 100    (total)
//   infoSections             <= 100    (total)
// BULK_LIMITS below is the machine-readable copy — use it rather than re-typing the numbers.
//
// TRAP: bulk is NOT atomic. Each item succeeds or fails independently via
// `results[i].itemMetadata.success`; a 200 response can still contain failures. Callers MUST
// walk the per-item results and never infer success from the HTTP status.
//
// TRAP: `itemMetadata.originalIndex` correlates a result back to the request array. Do not
// assume the response preserves request order. Missing or ambiguous indexes must
// remain unresolved; this endpoint declares no positional fallback.
//
// TRAP: `bulkActionMetadata.undetailedFailures` counts failures whose detail was dropped
// because the threshold was exceeded. Ignoring it silently loses failed records.
//
// `returnEntity: false` (the default) still returns `itemMetadata.id`, which is all a
// crosswalk needs — pass `returnEntity: true` only when the caller must inspect the created
// entity (e.g. a contract probe verifying variant counts), because the payload is large.
const BULK_PRODUCT_LIMITS = { records: 100, variants: 1000, options: 100, modifiers: 100, infoSections: 100 };

// Cost of one product against those limits, for readBatchesByLimits.
function storesProductBulkCost(product) {
  const v = product && product.variantsInfo && product.variantsInfo.variants;
  return {
    variants: Array.isArray(v) ? Math.max(1, v.length) : 1,
    options: Array.isArray(product && product.options) ? product.options.length : 0,
    modifiers: Array.isArray(product && product.modifiers) ? product.modifiers.length : 0,
    infoSections: Array.isArray(product && product.infoSections) ? product.infoSections.length : 0,
  };
}

function buildBulkCreateStoresProductsRequest(products, { returnEntity = false, fields } = {}) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('buildBulkCreateStoresProductsRequest: products must be a non-empty array');
  }
  if (products.length > BULK_PRODUCT_LIMITS.records) {
    throw new Error(
      `buildBulkCreateStoresProductsRequest: ${products.length} products exceeds the per-request limit of ${BULK_PRODUCT_LIMITS.records}. ` +
        'Batch with ndjson.readBatchesByLimits using BULK_PRODUCT_LIMITS.',
    );
  }
  const body = { products: products.map((p) => normalizeStoresProductV3(p)), returnEntity };
  if (fields) body.fields = fields;
  return { method: 'POST', url: `${WIXAPIS}/stores/v3/bulk/products-with-inventory/create`, body };
}

// Normalizes each product, sends ONE bulk request, and returns a per-item outcome list already
// correlated back to the input index. Callers get a flat shape they cannot accidentally read as
// all-or-nothing.
//
// Normalization is local — HTML descriptions travel as `plainDescription` and Wix converts them
// server-side, so this is one HTTP call, not one-per-product plus the bulk call.
async function bulkCreateStoresProductsWithInventory(wix, products, { returnEntity = false, fields } = {}) {
  const normalized = products.map((product) => normalizeStoresProductV3ForCreate(wix, product));

  const response = await wix.send(buildBulkCreateStoresProductsRequest(normalized, { returnEntity, fields }));
  // This endpoint declares productResults; the sibling flat envelope is not a fallback.
  return { ...bulkResults.normalizeBulk(response, products, 'products'),
    inventoryResults: response?.inventoryResults || null };
}

function buildQueryStoresProductsRequest(query = { paging: { limit: 100 } }, fields) {
  const body = { query };
  if (fields) body.fields = fields;
  return { method: 'POST', url: `${WIXAPIS}/stores/v3/products/query`, body };
}
// ONE PAGE, unwrapped to the products array, pagingMetadata discarded — see the READ/RETURN
// CONTRACT at the top of this file. Do not build a dedupe index or a safety net on this.
async function queryStoresProducts(wix, query, fields) {
  return (await wix.send(buildQueryStoresProductsRequest(query, fields))).products || [];
}
// OBSERVED (2026-07-29, shopify-mysite1): the only correct way to sweep the catalog, and the
// primitive any crosswalk-recovery / name-match safety net must use. The unwrapping executor
// above cannot be cursor-paged (it discards the cursor), and the hand-rolled loop that reads
// `.products` off its already-unwrapped return value produces an EMPTY set — which reads as
// "the store is empty" and is exactly the state under which an import re-creates the whole
// catalog it already imported. Hence: throw on an incomplete sweep, never return a partial index.
//
// VERIFIED (2026-08-12, the reference store catalog backfill): cursorPaging from the very first page works
// live against /stores/v3/products/query (confirms the "documented Wix convention" note below
// by real call). `fields: ['DIRECT_CATEGORIES_INFO', 'MEDIA_ITEMS_INFO']` on the request body
// (sibling of `query`, not nested inside it) returns `directCategoriesInfo.categories[]` and
// `media.itemsInfo.items[]` per product — a plain query/get omits both (categories entirely;
// media collapses to `media.main` only), mirroring the GET-product MEDIA_ITEMS_INFO trap noted
// on buildMedia() in wix-build.js.
async function queryAllStoresProducts(wix, { pageSize = 100, maxPages = 200, fields } = {}) {
  const all = [];
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const query = cursor ? { cursorPaging: { limit: pageSize, cursor } } : { cursorPaging: { limit: pageSize } };
    const response = await wix.send(buildQueryStoresProductsRequest(query, fields));
    for (const product of response.products || []) {
      if (product && !seen.has(product.id)) { seen.add(product.id); all.push(product); }
    }
    const meta = response.pagingMetadata || {};
    cursor = (meta.cursors && meta.cursors.next) || null;
    pages += 1;
  } while (cursor && pages < maxPages);
  if (cursor) throw new Error(`queryAllStoresProducts: still paging after ${maxPages} pages; refusing to return a partial product index.`);
  return all;
}
// VERIFIED (migration-20260715-01): PATCH /stores/v3/products/{id} with
// { product: { revision, media: { itemsInfo: { items: [{id}|{url}] } } } } updates
// product gallery media. Prefer external URLs here when the source media is publicly
// reachable: the Stores product API ingests them in the background, which avoids the
// slower, heavily-throttled Media Manager pre-import path.
function buildPatchStoresProductMediaRequest({ productId, revision, items = [] }) {
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/stores/v3/products/${productId}`,
    body: {
      product: {
        revision,
        media: buildStoresProductMedia(items),
      },
    },
  };
}
async function patchStoresProductMedia(wix, payload) {
  return wix.send(buildPatchStoresProductMediaRequest(payload));
}

// VERIFIED (2026-09-01, live over 398 products): the 200 above is a QUEUE ACKNOWLEDGEMENT, not a
// delivery. Wix echoes the item back as `mediaType: "UNKNOWN_MEDIA_TYPE"` with an `uploadId` and
// fetches the URL afterwards, on its own side, with no callback and no status endpoint.
//
// TRAP, and it is the expensive one: `media.itemsInfo.items` is a FULL REPLACE, so the product's
// existing image is discarded the instant the PATCH is accepted. If the background fetch then
// fails, Wix DROPS the item and the product is left with an EMPTY gallery — 200 on the write, no
// error anywhere, and the old picture already gone. Observed on a valid, publicly reachable
// 2048x2048 JPEG that ingested fine on the very next attempt, so there is nothing about the file
// or the request to validate up front. Reading the product back is the only signal that exists.
//
// Scale of it, measured on one live catalog: 65 of 383 items (17%) had not ingested 60s after an
// accepted write. A second identical PATCH fixed all but one, and a third fixed that. So a miss
// is "not yet known", never "failed" — the loop is what establishes the outcome.
//
// This is the writer to reach for whenever media correctness matters. `patchStoresProductMedia`
// stays for callers batching thousands of writes who verify in their own sweep afterwards.
const STORES_MEDIA_INGEST_SETTLE_MS = 60000;
const STORES_MEDIA_INGEST_ROUNDS = 4;

// Reading media back REQUIRES the fields parameter. A plain GET returns only `media.main`, so an
// unverified read looks empty on a perfectly healthy product and would report every write failed.
function buildGetStoresProductWithMediaRequest(id) {
  return {
    method: 'GET',
    url: `${WIXAPIS}/stores/v3/products/${encodeURIComponent(id)}?fields=MEDIA_ITEMS_INFO`,
  };
}
async function getStoresProductWithMedia(wix, id) {
  return (await wix.send(buildGetStoresProductWithMediaRequest(id))).product;
}

// An item that carries no `image.id` is either still in flight or already dropped, and ONE read
// cannot tell those apart. Both mean "not landed"; only re-sending distinguishes them.
function storesProductMediaLanded(product, expectedCount) {
  const items = product?.media?.itemsInfo?.items || [];
  const ingested = items.filter((item) => item?.image?.id);
  return ingested.length === expectedCount && expectedCount > 0;
}

async function patchStoresProductMediaVerified(
  wix,
  { productId, items = [] },
  {
    settleMs = STORES_MEDIA_INGEST_SETTLE_MS,
    // Separate knob from settleMs on purpose: they wait for different things. settleMs waits for
    // an ACCEPTED write to finish ingesting; retryDelayMs waits for a REFUSED write's rate limit
    // to lift. They default to the same number only because the observed edge 429 and the
    // observed ingest both need about a minute.
    retryDelayMs = STORES_MEDIA_INGEST_SETTLE_MS,
    rounds = STORES_MEDIA_INGEST_ROUNDS,
    sleep = (ms) => new Promise((res) => setTimeout(res, ms)),
  } = {},
) {
  const expected = normalizeStoresProductMediaItems(items).length;
  if (expected === 0) throw new Error(`patchStoresProductMediaVerified: refusing to replace ${productId}'s gallery with nothing`);

  const attempts = [];
  for (let round = 1; round <= rounds; round += 1) {
    // TWO DIFFERENT FAILURES, ONE RETRY LIST. A write REFUSED (this endpoint
    // rate-limits at the edge with a 429 whose body is an HTML page, and it outlasts a short
    // in-request backoff) leaves the OLD image in place. A write ACCEPTED but never ingested
    // leaves NOTHING. Both mean "not verified", so both belong in the next round — which is why
    // every call in this body is inside the try. Letting a throw escape the loop was the actual
    // bug: 12 of 395 writes on a live catalog hit that 429, and each one would have aborted the
    // helper on its first round while reporting nothing about the state it left behind.
    try {
      // Re-read the revision every round. An accepted-but-not-ingested write still incremented it,
      // so reusing the previous round's value 400s on the retry that was supposed to save us.
      const before = await getStoresProductWithMedia(wix, productId);
      await patchStoresProductMedia(wix, { productId, revision: before.revision, items });
      await sleep(settleMs);
      const after = await getStoresProductWithMedia(wix, productId);
      const landed = storesProductMediaLanded(after, expected);
      attempts.push({ round, landed });
      if (landed) return { productId, landed: true, rounds: round, attempts, product: after };
    } catch (error) {
      // Record what went wrong and go round again. The error is kept per attempt rather than
      // thrown, because the caller's decision is the same either way — this product is not
      // verified — and because the message is the only clue about WHICH failure it was.
      attempts.push({ round, landed: false, error: String((error && error.message) || error).slice(0, 300) });
      // BACK OFF BEFORE RETRYING. A round that throws skips the settle wait above, so without
      // this the loop retries instantly and burns every round inside a few milliseconds — which
      // is worthless against the condition it is retrying, an edge 429 that outlasts tens of
      // seconds of backoff. Nothing to wait for after the last round, so that one returns
      // immediately rather than making the caller pay for a delay it cannot use.
      if (round < rounds) await sleep(retryDelayMs);
    }
  }
  // Out of rounds. The product is in one of two states and this function cannot tell which: the
  // gallery is EMPTY (accepted, never ingested) or it still holds the OLD image (never written).
  // Both need a human, so both are reported the same way — by name, never summarised into a
  // count. `errors` is surfaced separately so a caller can tell a rate-limited run (retry later,
  // nothing lost) from an ingest that keeps failing (the gallery is empty right now).
  return {
    productId,
    landed: false,
    rounds,
    attempts,
    product: null,
    errors: attempts.map((attempt) => attempt.error).filter(Boolean),
  };
}

// VERIFIED (2026-08-12, the reference store catalog backfill): PATCH /stores/v3/products/{id} with
// { product: { revision, tags: { publicTags: { tagIds: [...] } } } } attaches EXISTING Wix
// Tag ids (from POST /tags/v1/tags) to a product. Confirmed live: 200, tags echoed back on
// the response's `product.tags`, revision incremented as normal.
//
// TRAP (found live 2026-08-12): the shape that 400s the WHOLE bulk product-create request
// ("Expected an object") is `tags: { publicTags: [...] }` — publicTags as a bare array. The
// product object's `tags.publicTags` / `tags.privateTags` are each a `TagList` object wrapping
// `tagIds: string[]`, per the Products V3 product-object docs — NOT an array of tag objects.
// This PATCH is a full-replace of tags.publicTags.tagIds, not a merge/add: callers must send
// the complete desired tagIds set (union with anything that must be preserved), same as
// patchStoresProductMedia is a full-replace of media.itemsInfo.items.
function buildPatchStoresProductTagsRequest({ productId, revision, tagIds = [] }) {
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/stores/v3/products/${productId}`,
    body: {
      product: {
        revision,
        tags: { publicTags: { tagIds } },
      },
    },
  };
}
async function patchStoresProductTags(wix, payload) {
  return wix.send(buildPatchStoresProductTagsRequest(payload));
}

// UNVERIFIED: GET /stores/v3/products/{id} and GET /stores/v3/products/slug/{slug}.
// Used by upsert flows to check whether a product already exists before creating it.
// Both return 404 when the product is not found — callers should catch and treat as null.
function buildGetStoresProductRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/stores/v3/products/${encodeURIComponent(id)}` };
}
async function getStoresProduct(wix, id) {
  return (await wix.send(buildGetStoresProductRequest(id))).product;
}
function buildGetStoresProductBySlugRequest(slug) {
  return { method: 'GET', url: `${WIXAPIS}/stores/v3/products/slug/${encodeURIComponent(slug)}` };
}
async function getStoresProductBySlug(wix, slug) {
  return (await wix.send(buildGetStoresProductBySlugRequest(slug))).product;
}
function buildDeleteStoresProductRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/stores/v3/products/${encodeURIComponent(id)}` };
}
async function deleteStoresProduct(wix, id) {
  return wix.send(buildDeleteStoresProductRequest(id));
}

// UNVERIFIED (endpoint VERIFIED via patchStoresProductMedia): PATCH /stores/v3/products/{id}
// with arbitrary product fields. The `revision` from the existing product is required.
// A string `description` is moved to `plainDescription` by normalizeStoresProductV3 (same as
// createStoresProduct); Wix converts that HTML to rich content server-side.
// Do not use this for media-only updates — patchStoresProductMedia is the verified path for that.
function buildPatchStoresProductRequest({ productId, revision, ...productFields }, safeModeOptions) {
  const prepared = applySafeModeToRequest({ product: { revision, ...normalizeStoresProductV3(productFields) } }, safeModeOptions);
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/stores/v3/products/${productId}`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function patchStoresProduct(wix, { productId, revision, ...productFields }, safeModeOptions) {
  // No description handling here: buildPatchStoresProductRequest runs normalizeStoresProductV3,
  // which moves a string `description` to `plainDescription` for Wix to convert server-side.
  return (await wix.send(buildPatchStoresProductRequest({ productId, revision, ...productFields }, safeModeOptions))).product;
}

// UNVERIFIED: POST /categories/v1/categories/query returns ONE PAGE of Stores categories —
// NOT all of them, whatever this comment used to say. treeReference is TOP-LEVEL (same trap as
// create). Used to seed a name→id cache for upsert flows so existing categories are reused
// instead of duplicated — which means the cache must be built with queryAllStoresCategories,
// since a truncated cache duplicates exactly the categories it failed to read.
function buildQueryStoresCategoriesRequest(query = { paging: { limit: 100 } }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/categories/v1/categories/query`,
    body: { query, treeReference: STORES_TREE_REFERENCE },
  };
}
// ONE PAGE, unwrapped to the categories array, pagingMetadata discarded — see the READ/RETURN
// CONTRACT at the top of this file. Use queryAllStoresCategories below for any dedupe index.
async function queryStoresCategories(wix, query) {
  return (await wix.send(buildQueryStoresCategoriesRequest(query))).categories || [];
}
// OBSERVED (2026-07-29): `queryStoresCategories` returns ONE PAGE (100 max) and, by unwrapping to
// the array, discards the pagingMetadata needed to fetch the rest. A dedupe index built from it is
// silently truncated once a site passes 100 categories — a site with 119 read as 100, which would
// duplicate the missing 19 on the next import. Any upsert/dedupe flow must use this instead.
async function queryAllStoresCategories(wix, { pageSize = 100, maxPages = 200 } = {}) {
  const all = [];
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const query = cursor ? { cursorPaging: { limit: pageSize, cursor } } : { cursorPaging: { limit: pageSize } };
    const response = await wix.send(buildQueryStoresCategoriesRequest(query));
    for (const category of response.categories || []) {
      if (category && !seen.has(category.id)) { seen.add(category.id); all.push(category); }
    }
    const meta = response.pagingMetadata || {};
    cursor = (meta.cursors && meta.cursors.next) || null;
    pages += 1;
  } while (cursor && pages < maxPages);
  if (cursor) throw new Error(`queryAllStoresCategories: still paging after ${maxPages} pages; refusing to return a partial category index.`);
  return all;
}

// VERIFIED (2026-07-05): POST /categories/v1/categories with { category, treeReference }.
// treeReference is TOP-LEVEL (sibling of category), NOT a category property — nesting it
// 400s "treeReference must not be empty".
function buildCreateStoresCategoryRequest(category, safeModeOptions) {
  const prepared = applySafeModeToRequest({
    category: omitEmptyStringFields(category, ['description']),
    treeReference: STORES_TREE_REFERENCE,
  }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/categories/v1/categories`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createStoresCategory(wix, category, safeModeOptions) {
  return (await wix.send(buildCreateStoresCategoryRequest(category, safeModeOptions))).category;
}

// VERIFIED (2026-07-05): add one product to categories in bulk —
// POST /categories/v1/bulk/categories/add-item with
// { item:{ catalogItemId, appId }, categoryIds[], treeReference }. catalogItemId is the Wix
// product id; appId is the Wix Stores app id.
function buildBulkAddItemToCategoriesRequest({ productId, categoryIds }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/categories/v1/bulk/categories/add-item`,
    body: { item: { catalogItemId: productId, appId: WIX_STORES_APP_ID }, categoryIds, treeReference: STORES_TREE_REFERENCE },
  };
}
async function bulkAddItemToCategories(wix, payload) {
  return wix.send(buildBulkAddItemToCategoriesRequest(payload));
}

// --- Contacts --------------------------------------------------------------
// Contacts V5 is GA (verified in public docs 2026-08-04). The GA contract
// is FLAT: one main `email`/`phone` (matching + subscription live on the main entries),
// `additionalEmails`/`additionalPhones` arrays, an `addresses` array with the postal
// fields NESTED under `address`, and `company: { name, jobTitle }`. There is no `info`
// wrapper and no V4-style `emails.items` list wrapper anywhere in V5 requests. Create and
// update both take `{ contact, allowDuplicates }`; update requires the current `revision`
// and has no fieldMask. Live create/query/update verification is still pending a token
// with Contacts permissions (the 2026-07-26 probe got 403), so writers stay UNVERIFIED
// until a contract test promotes them — but the target shape is now the documented GA one.
//
// Custom fields: the GA V5 contact carries `extendedFields.namespaces.<ns>` and the V5
// docs route field DEFINITIONS through the Data Extension Schema API with FQDN
// `wix.contacts.*.contact` (values under the `_user_fields` namespace). The V4 Contacts
// Extended Fields API (`POST /contacts/v4/extended-fields`, values under
// `info.extendedFields`) still exists but pairs with the V4 write surface only — do not
// mix the two. Labels are likewise a V4 concept; V5 exposes `tags.privateTags.tagIds`
// managed through the Tags API (same FQDN). NOTE: the Data Extension Schema intro's
// supported-objects table does not list contacts yet — docs inconsistency at GA cutover;
// treat the V5 contact-object statement as authoritative but verify live during setup.
const V5_CONTACT_PHONE_TAGS = new Set(['OTHER', 'MAIN', 'HOME', 'MOBILE', 'WORK', 'FAX']);
const V5_CONTACT_ADDRESS_TAGS = new Set(['OTHER', 'HOME', 'WORK', 'BILLING', 'SHIPPING']);
function normalizeV5PhoneTag(tag) {
  const normalized = String(tag || '').trim().toUpperCase();
  if (!normalized) return undefined;
  if (V5_CONTACT_PHONE_TAGS.has(normalized)) return normalized;
  if (normalized === 'PRIMARY' || normalized === 'SOURCE_PRIMARY' || normalized === 'BILLING') return 'MAIN';
  if (normalized === 'SHIPPING') return 'HOME';
  return 'OTHER';
}
function normalizeV5AddressTag(tag) {
  const normalized = String(tag || '').trim().toUpperCase();
  if (!normalized) return undefined;
  return V5_CONTACT_ADDRESS_TAGS.has(normalized) ? normalized : 'OTHER';
}
// GA ContactAddress keeps postal fields nested under `address`; anything else found flat
// on the item (city, country, streetAddress, …) is moved into `address` so legacy flat
// items survive the shape change.
const V5_ADDRESS_ITEM_KEYS = new Set(['id', 'tag', 'address', 'defaultAddress', 'recipient']);
function normalizeV5AddressItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = {};
  const address = item.address && typeof item.address === 'object' && !Array.isArray(item.address)
    ? { ...item.address }
    : {};
  for (const [key, value] of Object.entries(item)) {
    if (key === 'address') continue;
    if (V5_ADDRESS_ITEM_KEYS.has(key)) out[key] = value;
    else address[key] = value;
  }
  const tag = normalizeV5AddressTag(out.tag);
  if (tag) out.tag = tag;
  if (Object.keys(address).length) out.address = address;
  return out;
}
function normalizeV5Contact(contact = {}) {
  const normalized = { ...contact };
  if (normalized.phone && typeof normalized.phone === 'object') {
    const tag = normalizeV5PhoneTag(normalized.phone.tag);
    normalized.phone = { ...normalized.phone, ...(tag ? { tag } : {}) };
  }
  if (Array.isArray(normalized.additionalPhones)) {
    normalized.additionalPhones = normalized.additionalPhones.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const tag = normalizeV5PhoneTag(item.tag);
      return { ...item, ...(tag ? { tag } : {}) };
    });
  }
  if (Array.isArray(normalized.addresses)) {
    normalized.addresses = normalized.addresses.map((item) => normalizeV5AddressItem(item));
  }
  return normalized;
}
// Legacy V4-style `info` payloads (pre-GA generated transforms) convert through this
// STRICT whitelist: unknown keys throw instead of silently dropping source data.
// `extendedFields` and `labelKeys` throw because they have no mechanical V5 equivalent —
// V5 custom fields live under extendedFields.namespaces (Data Extension Schema) and
// labels became tags (Tags API); both need a setup-time decision, not a converter guess.
const V4_INFO_CONVERTIBLE_KEYS = new Set([
  'name', 'emails', 'phones', 'addresses', 'company', 'jobTitle', 'birthdate', 'locale',
]);
function contactListItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  return [];
}
function pickMainListItem(items) {
  if (!items.length) return { main: undefined, rest: [] };
  const mainIndex = Math.max(0, items.findIndex((item) => item
    && typeof item === 'object'
    && (item.primary === true || String(item.tag || '').trim().toUpperCase() === 'MAIN')));
  return { main: items[mainIndex], rest: items.filter((_, index) => index !== mainIndex) };
}
function contactInfoToV5Contact(info = {}) {
  const unknownKeys = Object.keys(info).filter((key) => !V4_INFO_CONVERTIBLE_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(
      `contactInfoToV5Contact: cannot convert V4-style info key(s) ${JSON.stringify(unknownKeys)} to the GA Contacts V5 contact shape. `
      + 'extendedFields values belong under contact.extendedFields.namespaces (Data Extension Schema, FQDN wix.contacts.*.contact); '
      + 'labels became tags (Tags API). Regenerate the transform against the flat GA contact shape.',
    );
  }
  const contact = {};
  if (info.name !== undefined) contact.name = info.name;
  const emails = pickMainListItem(contactListItems(info.emails));
  if (emails.main) contact.email = { email: emails.main.email };
  if (emails.rest.length) contact.additionalEmails = emails.rest.map((item) => ({ email: item.email }));
  const phones = pickMainListItem(contactListItems(info.phones));
  if (phones.main) {
    const tag = normalizeV5PhoneTag(phones.main.tag);
    contact.phone = { phone: phones.main.phone, ...(tag ? { tag } : {}) };
  }
  if (phones.rest.length) {
    contact.additionalPhones = phones.rest.map((item) => {
      const tag = normalizeV5PhoneTag(item.tag);
      return { phone: item.phone, ...(tag ? { tag } : {}) };
    });
  }
  const addresses = contactListItems(info.addresses);
  if (addresses.length) contact.addresses = addresses.map((item) => normalizeV5AddressItem(item));
  if (info.company !== undefined || info.jobTitle !== undefined) {
    contact.company = {
      ...(info.company !== undefined ? { name: info.company } : {}),
      ...(info.jobTitle !== undefined ? { jobTitle: info.jobTitle } : {}),
    };
  }
  if (info.birthdate !== undefined) contact.birthdate = info.birthdate;
  if (info.locale !== undefined) contact.locale = info.locale;
  return contact;
}
function toEpochMilliseconds(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1e12 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) return value;
  return parsed;
}
function normalizeCouponSpecification(specification = {}) {
  const normalized = { ...specification };
  normalized.startTime = toEpochMilliseconds(specification.startTime);
  normalized.expirationTime = toEpochMilliseconds(specification.expirationTime);
  if (specification.moneyOffRate != null && specification.percentOffRate == null) {
    normalized.percentOffRate = specification.moneyOffRate;
    delete normalized.moneyOffRate;
  }
  if (normalized.percentOffRate != null) {
    normalized.percentOffRate = Number(normalized.percentOffRate);
  }
  if (normalized.moneyOffAmount != null && typeof normalized.moneyOffAmount === 'object') {
    normalized.moneyOffAmount = Number(normalized.moneyOffAmount.amount);
  } else if (normalized.moneyOffAmount != null) {
    normalized.moneyOffAmount = Number(normalized.moneyOffAmount);
  }
  if (normalized.fixedPriceAmount != null && typeof normalized.fixedPriceAmount === 'object') {
    normalized.fixedPriceAmount = Number(normalized.fixedPriceAmount.amount);
  } else if (normalized.fixedPriceAmount != null) {
    normalized.fixedPriceAmount = Number(normalized.fixedPriceAmount);
  }
  if (normalized.minimumSubtotal != null) {
    normalized.minimumSubtotal = Number(normalized.minimumSubtotal);
  }
  if (normalized.usageLimit != null) {
    normalized.usageLimit = Number(normalized.usageLimit);
  }
  if (normalized.limitPerCustomer != null) {
    normalized.limitPerCustomer = Number(normalized.limitPerCustomer);
  }
  if (normalized.scope && Object.keys(normalized.scope).length === 0) {
    delete normalized.scope;
  }
  return normalized;
}
// GA request: POST /contacts/v5/contacts { contact: <flat contact>, allowDuplicates }.
// Accepts the flat GA `contact` directly; a legacy V4-style `info` payload is converted
// via contactInfoToV5Contact (strict — throws on non-mechanical keys). At least one of
// name.first, name.last, email.email, or phone.phone is required by the API.
function buildCreateContactRequest({ contact, info, allowDuplicates = false }, safeModeOptions) {
  if (contact !== undefined && info !== undefined) {
    throw new Error('buildCreateContactRequest: pass either the flat GA `contact` or a legacy `info`, not both');
  }
  const flatContact = info !== undefined ? contactInfoToV5Contact(info) : contact;
  if (!flatContact || typeof flatContact !== 'object' || Array.isArray(flatContact)) {
    throw new Error('buildCreateContactRequest: contact must be a flat GA Contacts V5 contact object');
  }
  const safeModeEnabled = isSafeModeEnabled(safeModeOptions);
  const prepared = applySafeModeToRequest({
    contact: normalizeV5Contact(flatContact),
    allowDuplicates: safeModeEnabled ? true : allowDuplicates,
  }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v5/contacts`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createContact(wix, payload, safeModeOptions) {
  return (await wix.send(buildCreateContactRequest(payload, safeModeOptions))).contact;
}

// Evidence: safe-mode bulk upsert and query-back exercised basic contact fields.
// Member updates, real contact values and extensions are not thereby verified. Endpoint: POST
// /contacts/v5/bulk/contacts/upsert — the CONT-01 import path: 1-100 contacts per call,
// synchronous, per-item results. Contact matching includes externalId, email and phone; V5 can match phone even with email present.
// Use the verified contact importer for prewrite identity checks; `externalId`
// (set-once, max 100 chars) carries the source-system id for the crosswalk.
// `upsertMode`: OVERWRITE (default) | APPEND | OVERWRITE_APPEND_ARRAYS.
// Contacts use the same flat GA shape as createContact; each array item wraps as
// `{ contact }`.
const CONTACTS_BULK_UPSERT_MAX = 100;
function buildBulkUpsertContactsRequest(contacts, { upsertMode, returnEntity = false, updateMember } = {}, safeModeOptions) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error('buildBulkUpsertContactsRequest: contacts must be a non-empty array');
  }
  if (contacts.length > CONTACTS_BULK_UPSERT_MAX) {
    throw new Error(
      `buildBulkUpsertContactsRequest: ${contacts.length} contacts exceeds the per-request limit of ${CONTACTS_BULK_UPSERT_MAX} — batch upstream`,
    );
  }
  const prepared = applySafeModeToRequest({
    contacts: contacts.map((contact) => ({ contact: normalizeV5Contact(contact) })),
    ...(upsertMode ? { upsertMode } : {}),
    ...(returnEntity ? { returnEntity: true } : {}),
    ...(typeof updateMember === 'boolean' ? { updateMember } : {}),
  }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v5/bulk/contacts/upsert`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
// Returns per-item outcomes correlated back to the input index — the same flat shape as
// bulkCreateStoresProductsWithInventory, so callers cannot misread partial failure as
// all-or-nothing.
async function bulkUpsertContacts(wix, contacts, options = {}, safeModeOptions) {
  const response = await wix.send(buildBulkUpsertContactsRequest(contacts, options, safeModeOptions));
  return bulkResults.normalizeBulk(response, contacts, 'contacts');
}
function buildQueryContactsRequest(query = { paging: { limit: 100, offset: 0 } }) {
  return { method: 'POST', url: `${WIXAPIS}/contacts/v5/contacts/query`, body: { query } };
}
// ONE PAGE, unwrapped to the contacts array — see the READ/RETURN CONTRACT at the top of this
// file. Contacts pages by `paging.{limit,offset}`, so a full sweep advances the offset off the
// raw response rather than following a cursor; there is no queryAll* helper yet.
async function queryContacts(wix, query) {
  return (await wix.send(buildQueryContactsRequest(query))).contacts || [];
}
function buildGetContactRequest(contactId) {
  if (!contactId) throw new Error('buildGetContactRequest: contactId is required');
  return { method: 'GET', url: `${WIXAPIS}/contacts/v5/contacts/${contactId}` };
}
async function getContact(wix, contactId) {
  return (await wix.send(buildGetContactRequest(contactId))).contact;
}
// GA request: PATCH /contacts/v5/contacts/{id} { contact: { id, revision, <flat fields> },
// allowDuplicates? }. The current revision is REQUIRED (optimistic concurrency); there is
// no fieldMask in the GA contract — passing one throws so stale pre-GA call sites fail
// loudly instead of sending an unrecognized parameter.
function buildUpdateContactRequest({ contactId, revision, contact, info, allowDuplicates, fieldMask }) {
  if (fieldMask !== undefined) {
    throw new Error('buildUpdateContactRequest: GA Contacts V5 update has no fieldMask; send the flat fields to change on `contact`');
  }
  if (contact !== undefined && info !== undefined) {
    throw new Error('buildUpdateContactRequest: pass either the flat GA `contact` or a legacy `info`, not both');
  }
  const id = contactId || contact?.id;
  if (!id) throw new Error('buildUpdateContactRequest: contactId is required');
  const rev = revision ?? contact?.revision;
  if (rev === undefined || rev === null) {
    throw new Error('buildUpdateContactRequest: revision is required (read the contact first and pass its current revision)');
  }
  const flatContact = info !== undefined ? contactInfoToV5Contact(info) : (contact || {});
  const nextContact = {
    ...normalizeV5Contact(flatContact),
    id,
    revision: rev,
  };
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/contacts/v5/contacts/${id}`,
    body: {
      contact: nextContact,
      ...(allowDuplicates !== undefined ? { allowDuplicates } : {}),
    },
  };
}
async function updateContact(wix, payload) {
  return (await wix.send(buildUpdateContactRequest(payload))).contact;
}
// V4-surface setup helper. Find Or Create Extended Field defines V4 `info.extendedFields`
// custom fields and pairs with V4 contact writers only. For the GA V5 surface, custom
// field definitions go through the Data Extension Schema API (FQDN wix.contacts.*.contact)
// and values are written under `contact.extendedFields.namespaces._user_fields`.
function buildFindOrCreateContactExtendedFieldRequest({ displayName, dataType = 'TEXT' }) {
  if (!displayName) throw new Error('buildFindOrCreateContactExtendedFieldRequest: displayName is required');
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v4/extended-fields`,
    body: { displayName, dataType },
  };
}
async function findOrCreateContactExtendedField(wix, payload) {
  return (await wix.send(buildFindOrCreateContactExtendedFieldRequest(payload))).field;
}

// --- Coupons ---------------------------------------------------------------
// VERIFIED live 2026-09-02: create, query and delete all return 200 on a Catalog V3 site.
// The earlier "app-not-installed/unauthorized" note here was a STALE TOKEN, not a missing
// app — that 401 message names the app and reads like a setup problem. Re-mint first.
// The specification must contain exactly one coupon type; generated code must decide per
// source coupon whether native Wix Coupons can represent the source coupon exactly. CMS is
// not a fallback for a missing writer; it is only for coupons whose semantics do not fit
// Wix Coupons. See domains/stores/entities/coupon.json for the scope rules — in particular
// that `scope: {namespace: "stores"}` is a valid storewide scope, and that a product scope
// requires a VISIBLE product (a hidden one is rejected as `entityId not found`; V3 product
// ids themselves resolve fine).
function buildCreateCouponRequest(specification, safeModeOptions) {
  const prepared = applySafeModeToRequest({ specification: normalizeCouponSpecification(specification) }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v2/coupons`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createCoupon(wix, specification, safeModeOptions) {
  const response = await wix.send(buildCreateCouponRequest(specification, safeModeOptions));
  // LIVE 2026-09-05 (two fresh sites): Create Coupon answers `{ id }` -- the id alone, no coupon
  // object -- exactly as the docs' response shape says. The branch below that expected
  // `response.coupon` never matched, so every create fell through to a query-by-code that the
  // not-readable-immediately lag defeated four times out of five, and the writer returned
  // undefined for coupons that were on the site. Take the documented shape first.
  if (typeof response?.id === 'string' && response.id) return { id: response.id, specification };
  if (response?.coupon?.id) return response.coupon;
  const code = String(specification?.code || '').trim();
  if (code) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const coupons = await queryCoupons(wix, { paging: { limit: 200, offset: 0 } });
      const matched = coupons.find((coupon) => String(coupon?.specification?.code || '').trim() === code);
      if (matched?.id) return matched;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  }
  return response.coupon;
}
// --- coupons: batch create, and field-level update ---------------------------------------
// MEASURED LIVE, and both facts below are why this is not a thin wrapper.
//
// BATCH CREATE. `POST /stores/v2/bulk/coupons/create`, body key `specifications` (sending
// `coupons` is a 400 naming the field), max 100 per call. The response is
// `{ results: [{ itemMetadata: { id, originalIndex, success, error } }], bulkActionMetadata }`.
//
//   TRAP 1 -- it is ALL-OR-NOTHING and its per-item errors are not per-item. A batch of five
//   with ONE invalid specification came back 200 with totalFailures 5, the SAME error text
//   against all five, and created none of them. So a failure must never be believed per item:
//   the batch is re-sent as individual creates, which both finds the real culprit and lets the
//   other 99 land. Bulk DELETE does not share this -- there a bad id fails alone -- so the two
//   verbs are handled separately and never by one helper.
//
//   TRAP 2 -- `originalIndex` is OMITTED on result 0 (a zero-value omission, not a missing
//   field). Reading it as "cannot correlate" mis-attributes the first coupon of every batch, and
//   defaulting it to -1 silently drops one per hundred. It is read as `originalIndex ?? 0`, and
//   the result count is checked against the request count.
const BULK_COUPON_BATCH = 100;

// TRAP 6, MEASURED LIVE and the reason this helper refuses a tagged specification: the BULK
// create silently DROPS `tags`. Same specification, same session, both 200 -- the single create
// round-trips the tags and the bulk create reads back `tags: undefined`. Found by importing a
// real batch, not by any unit test, because a mocked transport cannot drop a field the server
// drops. Refusing loudly is the only safe behaviour: a batch that quietly wrote a hundred
// untagged coupons is indistinguishable from success, and nothing on the coupon afterwards says
// which migration created it.
function assertBulkCreateCannotLoseFields(specifications) {
  const tagged = specifications.filter((spec) => spec && Array.isArray(spec.tags) && spec.tags.length > 0);
  if (tagged.length > 0) {
    const codes = tagged.slice(0, 3).map((spec) => spec.code).join(', ');
    throw new Error(`bulk coupon create silently discards \`tags\`, and ${tagged.length} of these specifications carry them (${codes}${tagged.length > 3 ? ', …' : ''}). Write tagged coupons with createCoupon, or create them untagged here and apply tags with updateCouponFields afterwards -- never send them through the batch and assume they landed.`);
  }
}

function buildBulkCreateCouponsRequest(specifications, safeModeOptions) {
  if (!Array.isArray(specifications) || specifications.length === 0) throw new Error('bulkCreateCoupons needs a non-empty array of specifications');
  assertBulkCreateCannotLoseFields(specifications);
  if (specifications.length > BULK_COUPON_BATCH) throw new Error(`bulk coupon create takes at most ${BULK_COUPON_BATCH} specifications per call, got ${specifications.length}`);
  const prepared = applySafeModeToRequest({ specifications: specifications.map(normalizeCouponSpecification) }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v2/bulk/coupons/create`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}

// Returns one outcome per INPUT specification, in input order. Never fewer, never reordered.
async function bulkCreateCoupons(wix, specifications, { safeModeOptions, onFallback } = {}) {
  const outcomes = new Array(specifications.length).fill(null);
  let response;
  try {
    response = await wix.send(buildBulkCreateCouponsRequest(specifications, safeModeOptions));
  } catch (error) {
    // A transport-level failure tells us nothing about individual specifications either.
    return retryBatchIndividually(wix, specifications, outcomes, { safeModeOptions, onFallback, reason: `batch request failed: ${String(error && error.message).slice(0, 200)}` });
  }
  const results = (response && response.results) || [];
  if (results.length !== specifications.length) {
    return retryBatchIndividually(wix, specifications, outcomes, { safeModeOptions, onFallback, reason: `batch returned ${results.length} results for ${specifications.length} specifications` });
  }
  // TRAP 4: the reported indexes must be a one-to-one cover of the request before ANY of them is
  // believed. Two results that both omit `originalIndex` both resolve to 0, so the second id
  // overwrites the first and one input is left with no outcome at all -- a coupon id attached to
  // the wrong code, which is the identity-corruption class this whole helper exists to avoid.
  // Nothing here guesses: a malformed cover means per-coupon reconciliation, not a best effort.
  const indexes = results.map((r) => ((r && r.itemMetadata) || {}).originalIndex ?? 0);
  const badIndex = indexes.find((i) => !Number.isInteger(i) || i < 0 || i >= specifications.length);
  if (badIndex !== undefined) {
    return retryBatchIndividually(wix, specifications, outcomes, { safeModeOptions, onFallback, reason: `batch reported originalIndex ${JSON.stringify(badIndex)}, which is not an index into a ${specifications.length}-item request` });
  }
  if (new Set(indexes).size !== specifications.length) {
    return retryBatchIndividually(wix, specifications, outcomes, { safeModeOptions, onFallback, reason: `batch reported indexes [${indexes.join(', ')}] for ${specifications.length} specifications -- not a one-to-one cover, so no result can be attributed to an input` });
  }
  let anyFailure = false;
  for (let i = 0; i < results.length; i += 1) {
    const meta = (results[i] && results[i].itemMetadata) || {};
    // `?? 0` -- see TRAP 2. Correlate by the index the server reports, not by position here.
    const index = indexes[i];
    if (meta.id && meta.error === undefined) {
      outcomes[index] = { outcome: 'coupon-written', couponId: String(meta.id), code: specifications[index] && specifications[index].code };
    } else {
      anyFailure = true;
    }
  }
  // TRAP 1: any failure invalidates the WHOLE batch's verdicts, including the successes, because
  // nothing was created and the errors name the wrong rows.
  if (anyFailure) {
    return retryBatchIndividually(wix, specifications, new Array(specifications.length).fill(null), { safeModeOptions, onFallback, reason: 'the batch reported at least one failure; per-item errors from a failed batch are not per-item' });
  }
  return outcomes;
}

// TRAP 5: a batch can COMMIT and still not answer -- a timeout, a dropped connection, a 5xx after
// the write. The retries then hit "code already exists" for coupons that are on the target, and
// reporting those as failed loses the crosswalk row that historical orders referencing the code
// need. So the fallback RECONCILES by exact code rather than blind-creating, and a code that is
// neither readable nor creatable is UNKNOWN, never failed: this surface's read lag makes "absent
// right now" indistinguishable from "never written", and only a later re-read separates them.
async function reconcileCouponByCode(wix, code) {
  if (!code) return null;
  const matches = await queryCouponsByCode(wix, code);
  return matches.length === 1 ? matches[0] : null;
}

async function retryBatchIndividually(wix, specifications, outcomes, { safeModeOptions, onFallback, reason } = {}) {
  if (typeof onFallback === 'function') onFallback({ reason, count: specifications.length });
  for (let i = 0; i < specifications.length; i += 1) {
    if (outcomes[i]) continue;
    const code = specifications[i] && specifications[i].code;
    try {
      const created = await createCoupon(wix, specifications[i], safeModeOptions);
      const couponId = typeof created === 'string' ? created : created && created.id;
      if (couponId) {
        outcomes[i] = { outcome: 'coupon-written', couponId: String(couponId), code, viaFallback: true };
        continue;
      }
      const reconciled = await reconcileCouponByCode(wix, code);
      outcomes[i] = reconciled
        ? { outcome: 'coupon-reconciled-existing', couponId: String(reconciled.id), code, viaFallback: true }
        : { outcome: 'coupon-write-unknown', couponId: null, code, viaFallback: true, reason: 'the create returned no id and the code is not readable yet; re-read before re-writing' };
    } catch (error) {
      const message = String(error && error.message);
      // "already exists" means the coupon IS on the target -- from this batch's own committed
      // write, or from an earlier run. Recover its id rather than calling it a failure.
      if (/already exists|ALREADY_EXISTS|duplicate/i.test(message)) {
        let reconciled = null;
        try { reconciled = await reconcileCouponByCode(wix, code); } catch { reconciled = null; }
        outcomes[i] = reconciled
          ? { outcome: 'coupon-reconciled-existing', couponId: String(reconciled.id), code, viaFallback: true, matchedAfter: 'duplicate-rejection' }
          : { outcome: 'coupon-write-unknown', couponId: null, code, viaFallback: true, reason: 'the code already exists but is not readable yet, so its id is unknown; re-read rather than re-writing' };
        continue;
      }
      outcomes[i] = {
        outcome: 'coupon-failed', couponId: null, code, viaFallback: true,
        error: { message: message.slice(0, 300), status: error && error.status },
      };
    }
  }
  return outcomes;
}

// FIELD-LEVEL UPDATE. `PATCH /stores/v2/coupons/{id}` with a specification carrying ONLY the
// changed fields plus a field mask naming them.
//
//   TRAP 3 -- sending the WHOLE specification alongside a narrow mask returns 200 with an empty
//   body and writes NOTHING. Measured: unchanged at +15s, +45s and +150s, far past this surface's
//   own read lag. That is the shape everyone writes first (read it, spread it, change one field),
//   and it answers with success. So this builder takes a CHANGE SET and refuses anything that
//   looks like a whole coupon; there is deliberately no way to pass a full specification through.
const COUPON_UPDATABLE_FIELDS = Object.freeze(['active', 'tags', 'name', 'expirationTime', 'startTime', 'usageLimit', 'limitPerCustomer', 'limitedToOneItem', 'appliesToSubscriptions']);

function buildUpdateCouponRequest(couponId, changes) {
  if (!couponId) throw new Error('updateCouponFields needs a coupon id');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('updateCouponFields needs a change set object');
  const paths = Object.keys(changes);
  if (paths.length === 0) throw new Error('updateCouponFields needs at least one field to change; an empty field mask is rejected by the API');
  const unknown = paths.filter((f) => !COUPON_UPDATABLE_FIELDS.includes(f));
  if (unknown.length > 0) throw new Error(`updateCouponFields does not update ${unknown.join(', ')}. Pass only the fields being changed -- sending a whole specification returns 200 and writes nothing`);
  if (paths.includes('code') || paths.includes('type')) throw new Error('coupon code and type are not updatable');
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/stores/v2/coupons/${encodeURIComponent(couponId)}`,
    // Mask paths are bare specification field names; a `specification.` prefix returns 500.
    body: { specification: { ...changes }, fieldMask: { paths } },
  };
}

// Applies the change and VERIFIES IT BY READ-BACK. A 2xx is not evidence on this surface (TRAP 3),
// so an unconfirmed update is reported `coupon-update-unverified`, never as applied.
async function updateCouponFields(wix, couponId, changes, { settleMs = 8000, sleep } = {}) {
  const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let status = null;
  try {
    await wix.send(buildUpdateCouponRequest(couponId, changes));
    status = 200;
  } catch (error) {
    return { outcome: 'coupon-update-failed', couponId, error: { message: String(error && error.message).slice(0, 300), status: error && error.status } };
  }
  await wait(settleMs);
  let readBack = null;
  try {
    readBack = await getCoupon(wix, couponId);
  } catch {
    return { outcome: 'coupon-update-unverified', couponId, status, reason: 'the read-back failed, so the change is unknown; re-read rather than re-sending' };
  }
  const spec = (readBack && (readBack.specification || readBack)) || null;
  if (!spec) return { outcome: 'coupon-update-unverified', couponId, status, reason: 'the coupon did not read back; absent is unknown on this surface, never "changed"' };
  const mismatched = Object.keys(changes).filter((field) => JSON.stringify(spec[field]) !== JSON.stringify(changes[field]));
  if (mismatched.length > 0) {
    return { outcome: 'coupon-update-unverified', couponId, status, mismatched, reason: `returned ${status} but ${mismatched.join(', ')} did not change -- the signature of a full-specification PATCH being ignored. Re-send with ONLY the changed fields` };
  }
  return { outcome: 'coupon-updated', couponId, changed: Object.keys(changes) };
}

function buildGetCouponRequest(couponId) {
  return { method: 'GET', url: `${WIXAPIS}/stores/v2/coupons/${encodeURIComponent(couponId)}` };
}
async function getCoupon(wix, couponId) {
  const response = await wix.send(buildGetCouponRequest(couponId));
  return (response && (response.coupon || response)) || null;
}

function buildQueryCouponsRequest(query = { paging: { limit: 100, offset: 0 } }) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v2/coupons/query`, body: { query } };
}
// ONE PAGE, unwrapped to the coupons array — see the READ/RETURN CONTRACT at the top of this file.
async function queryCoupons(wix, query) {
  return (await wix.send(buildQueryCouponsRequest(query))).coupons || [];
}

// --- eCom Discount Rules ("Automatic Discounts" in the dashboard) ----------------------------
// DOCS-VERIFIED, not yet live-verified (authored 2026-08-12 from Create Discount Rule's own
// request/response schema — no `…-object` reference page exists for this entity, see
// discount-rule.json's objectPageException). Distinct from the Coupons API: a discount rule
// applies automatically when its trigger is met, no customer-entered code. Promote to
// verified-live in discount-rule.json once a real rule has been created and re-queried.
function buildCreateDiscountRuleRequest(discountRule) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/discount-rules`, body: { discountRule } };
}
async function createDiscountRule(wix, discountRule) {
  return (await wix.send(buildCreateDiscountRuleRequest(discountRule))).discountRule;
}
function buildQueryDiscountRulesRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/discount-rules/query`, body: { query } };
}
async function queryDiscountRules(wix, query) {
  return (await wix.send(buildQueryDiscountRulesRequest(query))).discountRules || [];
}
function buildDeleteDiscountRuleRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/ecom/v1/discount-rules/${encodeURIComponent(id)}` };
}
async function deleteDiscountRule(wix, id) {
  return wix.send(buildDeleteDiscountRuleRequest(id));
}

// --- Tax (Tax Groups / Tax Regions / Manual Tax Mappings) -------------------
// VERIFIED (2026-08-12): real calls against the live reference store. All three APIs live under
// `/billing/v1/...`, NOT `/ecom/v1/...` — a naming trap, since discount-rules/coupons above are
// `/ecom/v1/...`/`/stores/v2/...`. Cooperating model (dev.wix.com "About the Tax APIs"):
//   - Tax Group: a bucket of products with the same tax treatment. Carries NO rate itself.
//     Every site already HAS default groups (Products, Shipping and delivery, Services,
//     Cancellation fees, the reference store's own live ids as of 2026-08-12) — `listDefaultTaxGroups`
//     returns those; `queryTaxGroups` returns ONLY custom groups a site created, never the
//     defaults (the "most common mistake" per Wix's own docs). A product joins a group via
//     the Stores Catalog V3 product's own `taxGroupId` field (Update Product), not any call
//     in this file — that's a plain Stores product write, already covered by the product
//     writer's PATCH path.
//   - Tax Region: a country[/subdivision] bound to ONE tax calculator app (`appId`). NEVER
//     hardcode the appId — it is installation-scoped. Resolve it live via `listTaxCalculators`
//     first. On the reference store (2026-08-12) the two installed calculators were "Wix Manual Tax
//     Calculator" (appId 57d13128-4a4c-494b-80b3-a6fb2e28018d) and "Avalara Tax Calculator"
//     (7516f85b-0868-4c23-9fcb-cea7784243df) — pick the one whose `displayName` contains
//     "Manual"/doesn't contain "Avalara" for a manually-transcribed rate; never assume a fixed
//     appId across sites. `subdivision` is ISO 3166-2 WITHOUT the country prefix (`NY`, not
//     `US-NY`) and only valid for AU/BR/CA/FR/DE/IN/IT/MX/NL/PT/ES/AE/GB/US — omit it (or `*`)
//     for any other country, matching the same "store the ISO code, not a display name" trap
//     Bookings hit for `locations[].custom.address.country`.
//   - Manual Tax Mapping: the actual rate for ONE (taxGroupId, taxRegionId) pair, only
//     meaningful for the "Wix manual tax calculator" region (Avalara computes its own rates
//     externally — no manual mapping needed or usable there). `taxRate` is a decimal-STRING
//     FRACTION ("0.07" for 7%), never a number/integer/percent-string, up to 6 decimal places.
//   - LIVE-VERIFIED FINDING (2026-08-12, not documented explicitly): a tax group with NO
//     manual tax mapping for a matched region calculates to EXACTLY ZERO tax
//     (taxAmount/taxableAmount both "0", empty taxBreakdown[]) — confirmed via a real
//     `calculateTax` call against the reference store with a genuinely mapping-less group next to a 7%-
//     mapped control group in the same request/region. This is the correct, simpler primitive
//     for "this product is tax-exempt" (WooCommerce `tax_status: "none"`): create ONE tax
//     group for it and DO NOT create any manual tax mapping for that group in any region — no
//     need to enumerate every country/region the exempt product might ship to.
function buildCreateTaxGroupRequest(taxGroup) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-groups`, body: { taxGroup } };
}
async function createTaxGroup(wix, taxGroup) {
  return (await wix.send(buildCreateTaxGroupRequest(taxGroup))).taxGroup;
}
function buildQueryTaxGroupsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-groups/query`, body: { query } };
}
// Returns ONLY custom tax groups this site created — NEVER the built-in defaults (Products,
// Shipping and delivery, ...). Call `listDefaultTaxGroups` for those. See the READ/RETURN
// CONTRACT at the top of this file: ONE PAGE, unwrapped to the array.
async function queryTaxGroups(wix, query) {
  return (await wix.send(buildQueryTaxGroupsRequest(query))).taxGroups || [];
}
function buildListDefaultTaxGroupsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/billing/v1/tax-groups/default-tax-groups` };
}
async function listDefaultTaxGroups(wix) {
  return (await wix.send(buildListDefaultTaxGroupsRequest())).taxGroups || [];
}
function buildDeleteTaxGroupRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/billing/v1/tax-groups/${encodeURIComponent(id)}` };
}
async function deleteTaxGroup(wix, id) {
  return wix.send(buildDeleteTaxGroupRequest(id));
}
function buildListTaxCalculatorsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/billing/v1/list-tax-calculators` };
}
async function listTaxCalculators(wix) {
  return (await wix.send(buildListTaxCalculatorsRequest())).taxCalculatorDetails || [];
}
// Convenience: resolve the manual calculator's appId live rather than hardcoding it (calculator
// appIds are installation-scoped and differ per site — see the comment block above). Picks the
// calculator whose displayName does NOT mention "Avalara"; throws if none/more than one match so
// a codegen caller notices a genuinely ambiguous site rather than silently picking the wrong one.
async function resolveManualTaxCalculatorAppId(wix) {
  const calculators = await listTaxCalculators(wix);
  const manual = calculators.filter((c) => !/avalara/i.test(String(c?.displayName || '')));
  if (manual.length !== 1) {
    throw new Error(`resolveManualTaxCalculatorAppId: expected exactly 1 non-Avalara calculator, found ${manual.length} (${JSON.stringify(calculators)})`);
  }
  return manual[0].appId;
}
function buildCreateTaxRegionRequest(taxRegion) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-regions`, body: { taxRegion } };
}
async function createTaxRegion(wix, taxRegion) {
  return (await wix.send(buildCreateTaxRegionRequest(taxRegion))).taxRegion;
}
function buildQueryTaxRegionsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-regions/query`, body: { query } };
}
// ONE PAGE, unwrapped to the taxRegions array — see the READ/RETURN CONTRACT at the top of this file.
async function queryTaxRegions(wix, query) {
  return (await wix.send(buildQueryTaxRegionsRequest(query))).taxRegions || [];
}
function buildDeleteTaxRegionRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/billing/v1/tax-regions/${encodeURIComponent(id)}` };
}
async function deleteTaxRegion(wix, id) {
  return wix.send(buildDeleteTaxRegionRequest(id));
}
function buildCreateManualTaxMappingRequest(manualTaxMapping) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/manual-tax-mappings`, body: { manualTaxMapping } };
}
async function createManualTaxMapping(wix, manualTaxMapping) {
  return (await wix.send(buildCreateManualTaxMappingRequest(manualTaxMapping))).manualTaxMapping;
}
function buildQueryManualTaxMappingsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/manual-tax-mappings/query`, body: { query } };
}
// ONE PAGE, unwrapped to the manualTaxMappings array — see the READ/RETURN CONTRACT at the top of this file.
async function queryManualTaxMappings(wix, query) {
  return (await wix.send(buildQueryManualTaxMappingsRequest(query))).manualTaxMappings || [];
}
function buildDeleteManualTaxMappingRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/billing/v1/manual-tax-mappings/${encodeURIComponent(id)}` };
}
async function deleteManualTaxMapping(wix, id) {
  return wix.send(buildDeleteManualTaxMappingRequest(id));
}
// Site-level, single-resource settings (one per site, not a crosswalked entity) — the direct
// counterpart of WooCommerce's `GET /wc/v3/settings/tax` `woocommerce_prices_include_tax`.
// VERIFIED live 2026-08-12: the reference store's default `taxIncludedInItemPrices: false` already matches
// its WooCommerce `woocommerce_prices_include_tax: "no"`, so no live update call was needed for
// this project — Upsert is still implemented for a source site where the two differ.
function buildGetTaxSettingsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/billing/v1/tax-settings` };
}
async function getTaxSettings(wix) {
  return (await wix.send(buildGetTaxSettingsRequest())).taxSettings;
}
function buildUpsertTaxSettingsRequest(taxSettings) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-settings`, body: { taxSettings } };
}
async function upsertTaxSettings(wix, taxSettings) {
  return (await wix.send(buildUpsertTaxSettingsRequest(taxSettings))).taxSettings;
}

// --- Delivery Profiles / Delivery Regions / Delivery Carriers ---------------
// VERIFIED (2026-08-12): real calls against the live reference store. All under `/ecom/v1/...`.
// Model (dev.wix.com "Delivery Profiles"): a DeliveryProfile is a named bundle of
// DeliveryRegions; every site has exactly one `default: true` profile, auto-created when Wix
// Stores/Bookings/Events/Restaurants is installed (the reference store's is "General profile", pre-existing
// with "Domestic"/"International" regions from that auto-creation, NOT from any WooCommerce
// data — do not assume default-profile regions already reflect the source site's real zones).
// A DeliveryRegion matches on `destinations[]` (country/subdivision only — no continent, no
// postcode) and carries `deliveryCarriers[]`, each ONE app (`appId`) + a `backupRate` (used
// whenever the carrier doesn't return its own live rate, or unconditionally when
// `backupRate.active: true` — this is the mechanism for a flat/free rate with no real courier
// integration). `listInstalledDeliveryCarriers` (VERIFIED live 2026-08-12 on the reference store) returned:
// "Pickup", "Basic Shipping" (id 45c44b27-..., a fixed cross-site constant — see
// shipping-build.js), "Calculated by USPS" (real carrier calc, no data equivalent), "Local
// delivery". `addDeliveryCarrier` REQUIRES `backupRate.amount` even for a real-carrier app.
// REVISION GOTCHA (hit live 2026-08-12 migrating the reference store): EVERY mutating call against a
// delivery profile — addDeliveryRegion AND addDeliveryCarrier, not just the region call — bumps
// `revision` and returns the new one on `deliveryProfile.revision`. A caller doing several
// region/carrier writes in sequence must carry that returned revision into the NEXT
// addDeliveryRegion/removeDeliveryRegion call, not re-use the value from the original
// queryDeliveryProfiles — passing a stale revision 409s with INVALID_REVISION. (addDeliveryCarrier
// itself does not take a revision parameter, so this only bites the next add/removeDeliveryRegion
// call after one or more addDeliveryCarrier calls.)
function buildCreateDeliveryProfileRequest(deliveryProfile) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles`, body: { deliveryProfile } };
}
async function createDeliveryProfile(wix, deliveryProfile) {
  return (await wix.send(buildCreateDeliveryProfileRequest(deliveryProfile))).deliveryProfile;
}
function buildGetDeliveryProfileRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/delivery-profiles/${encodeURIComponent(id)}` };
}
async function getDeliveryProfile(wix, id) {
  return (await wix.send(buildGetDeliveryProfileRequest(id))).deliveryProfile;
}
function buildQueryDeliveryProfilesRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles/query`, body: { query } };
}
// ONE PAGE, unwrapped to the deliveryProfiles array — see the READ/RETURN CONTRACT at the top of
// this file. Includes the site's default profile — filter on `.default` yourself if you need
// only custom ones.
async function queryDeliveryProfiles(wix, query) {
  return (await wix.send(buildQueryDeliveryProfilesRequest(query))).deliveryProfiles || [];
}
// NOTE the URL shape here is a path param (.../{deliveryProfileId}/delivery-region), unlike
// add-delivery-carrier/remove-delivery-carrier below which are flat URLs with body params —
// a real, verified API inconsistency, not a typo. `revision` is optional (the delivery
// profile's current `revision`, for optimistic-concurrency conflict detection) but recommended
// when the caller already has it from a preceding query/get.
function buildAddDeliveryRegionRequest(deliveryProfileId, deliveryRegion, revision) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/delivery-profiles/${encodeURIComponent(deliveryProfileId)}/delivery-region`,
    body: { deliveryRegion, ...(revision !== undefined ? { revision } : {}) },
  };
}
// Returns the UPDATED delivery profile, not just the new region — find it by matching `name`
// (regions carry a server-assigned `id` you don't have until this call returns). `deliveryRegion`
// may include `deliveryCarriers[]` inline (per dev.wix.com's own worked example) to create the
// region and its carrier(s) in one call instead of a separate addDeliveryCarrier.
async function addDeliveryRegion(wix, deliveryProfileId, deliveryRegion, revision) {
  return (await wix.send(buildAddDeliveryRegionRequest(deliveryProfileId, deliveryRegion, revision))).deliveryProfile;
}
function buildRemoveDeliveryRegionRequest(deliveryProfileId, deliveryRegionId, revision) {
  const url = new URL(`${WIXAPIS}/ecom/v1/delivery-profiles/${encodeURIComponent(deliveryProfileId)}/delivery-region/${encodeURIComponent(deliveryRegionId)}`);
  if (revision !== undefined) url.searchParams.set('revision', revision);
  return { method: 'DELETE', url: url.toString() };
}
async function removeDeliveryRegion(wix, deliveryProfileId, deliveryRegionId, revision) {
  return (await wix.send(buildRemoveDeliveryRegionRequest(deliveryProfileId, deliveryRegionId, revision))).deliveryProfile;
}
function buildAddDeliveryCarrierRequest(deliveryRegionId, deliveryCarrier) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles/add-delivery-carrier`, body: { deliveryRegionId, deliveryCarrier } };
}
async function addDeliveryCarrier(wix, deliveryRegionId, deliveryCarrier) {
  return (await wix.send(buildAddDeliveryCarrierRequest(deliveryRegionId, deliveryCarrier))).deliveryProfile;
}
function buildRemoveDeliveryCarrierRequest(deliveryRegionId, appId) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles/remove-delivery-carrier`, body: { deliveryRegionId, appId } };
}
async function removeDeliveryCarrier(wix, deliveryRegionId, appId) {
  return (await wix.send(buildRemoveDeliveryCarrierRequest(deliveryRegionId, appId))).deliveryProfile;
}
function buildListInstalledDeliveryCarriersRequest() {
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/delivery-profiles/installed-carriers` };
}
async function listInstalledDeliveryCarriers(wix) {
  return (await wix.send(buildListInstalledDeliveryCarriersRequest())).installedDeliveryCarriers || [];
}
// Convenience: resolve the Pickup carrier's appId live rather than hardcoding it — unlike
// Basic Shipping (a doc-example-corroborated fixed constant, see shipping-build.js), Pickup has
// no such corroboration, so this resolves an installation-scoped id live by matching displayName,
// the same pattern as the tax domain's resolveManualTaxCalculatorAppId.
async function resolvePickupAppId(wix) {
  const installed = await listInstalledDeliveryCarriers(wix);
  const pickup = installed.filter((c) => /pickup/i.test(String(c?.displayName || '')));
  if (pickup.length !== 1) {
    throw new Error(`resolvePickupAppId: expected exactly 1 Pickup carrier, found ${pickup.length} (${JSON.stringify(installed)})`);
  }
  return pickup[0].id;
}

// --- Shipping Options --------------------------------------------------------
// CRITICAL, LIVE-DISCOVERED 2026-08-15 (not documented on the Delivery Profile/Delivery Carrier
// pages at all — found via dev.wix.com's "Fix Shipping Coverage Gaps" skill article, a totally
// different doc tree than delivery-profiles/*): a deliveryCarrier's `backupRate` (what
// buildDeliveryCarrierInput above builds) is NOT what makes a region show a working rate at
// checkout or clears Wix's own "This region is missing rates" dashboard warning. That is driven
// by a SEPARATE resource, ShippingOption (`/ecom/v1/shipping-options`), keyed by
// `deliveryRegionId`, with its own `rates[]` (amount + conditions). VERIFIED on the reference store: the two
// regions Wix auto-created at Stores install ("Domestic"/"International") each already had a
// real ShippingOption ("Free shipping", $0); the two regions this pipeline created via
// addDeliveryRegion/addDeliveryCarrier ("Europe"/"Israel") had backupRate set correctly but NO
// ShippingOption at all — confirmed via listDeliveryCarriers' dashboardTables (the same view
// backing the dashboard's own warning) showing zero rows for those two regions despite a
// correctly-shaped, active backupRate existing on the DeliveryCarrier object. A delivery-region
// migration is INCOMPLETE without a matching ShippingOption per region — backupRate alone
// silently produces a checkout-blocking region despite a fully successful, correctly-shaped API
// write. See delivery-profile.json's shipping-options-not-backup-rate-drive-checkout pitfall.
function buildCreateShippingOptionRequest(shippingOption) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/shipping-options`, body: { shippingOption } };
}
async function createShippingOption(wix, shippingOption) {
  return (await wix.send(buildCreateShippingOptionRequest(shippingOption))).shippingOption;
}
function buildQueryShippingOptionsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/shipping-options/query`, body: { query } };
}
// ONE PAGE, unwrapped to the shippingOptions array — see the READ/RETURN CONTRACT at the top of
// this file. Filter on `.deliveryRegionId` yourself to find what's already covering a region.
async function queryShippingOptions(wix, query) {
  return (await wix.send(buildQueryShippingOptionsRequest(query))).shippingOptions || [];
}

// --- Site Properties (Business Info) -----------------------------------------
// The site's own public business information — the values a merchant edits under
// Settings > Business Info. A site-wide singleton, not a per-record import: apply at the
// setup gate. See domains/site/entities/business-contact.json.
//
// DESTRUCTIVE FIELD MASK — the one trap here that loses data instead of failing loudly.
// `fields.paths[]` semantics, verbatim from the method schema: "Properties not explicitly
// specified here are ignored. Properties included here but excluded from `businessContact`
// are CLEARED." So a path you list but do not send is wiped. Wix's own documented example
// demonstrates the hazard rather than the safe pattern — it lists `businessSchedule` in
// paths while sending none, which by that rule clears the site's business hours.
//
// buildUpdateBusinessContactRequest therefore DERIVES the mask from the payload's own keys
// and refuses a caller-supplied one. A caller that genuinely wants to clear a property must
// send it explicitly as null via `clearPaths`, so that erasing data is always something the
// call site said out loud.
const SITE_PROPERTIES_BASE = `${WIXAPIS}/site-properties/v4/properties`;
function buildUpdateBusinessContactRequest(businessContact, { clearPaths = [] } = {}) {
  if (!businessContact || typeof businessContact !== 'object' || Array.isArray(businessContact)) {
    throw new Error('buildUpdateBusinessContactRequest: businessContact object is required');
  }
  const sentPaths = Object.keys(businessContact).filter((key) => businessContact[key] !== undefined);
  if (sentPaths.length === 0 && clearPaths.length === 0) {
    throw new Error('buildUpdateBusinessContactRequest: nothing to update — an empty payload with an empty mask is a no-op, and with a non-empty mask it would clear fields');
  }
  const overlap = clearPaths.filter((path) => sentPaths.includes(path));
  if (overlap.length > 0) {
    throw new Error(`buildUpdateBusinessContactRequest: ${overlap.join(', ')} appears in both the payload and clearPaths — decide whether to set it or clear it`);
  }
  return {
    method: 'POST',
    url: `${SITE_PROPERTIES_BASE}/business-contact`,
    body: { businessContact, fields: { paths: [...sentPaths, ...clearPaths] } },
  };
}
// Returns nothing useful — the API's response body is `{}`. A 200 proves the request was
// accepted, not that the value landed; pair every write with getSiteProperties and compare.
async function updateBusinessContact(wix, businessContact, options) {
  return wix.send(buildUpdateBusinessContactRequest(businessContact, options));
}
function buildGetSitePropertiesRequest() {
  return { method: 'GET', url: SITE_PROPERTIES_BASE };
}
// An absent business address is the normal starting state of a fresh site (live-observed:
// only locale/currency/timezone present), NOT evidence that an earlier write failed.
async function getSiteProperties(wix) {
  return (await wix.send(buildGetSitePropertiesRequest())).properties;
}

// --- Pickup Locations --------------------------------------------------------
// Collection points are their OWN entity — not a ShippingOption and not a DeliveryCarrier.
// Writing a source `local_pickup` method as either one puts a 0-priced *delivery* row next to
// the real paid delivery, which is how collection ends up looking like free shipping to the
// buyer. See shipping-build.js's buildPickupLocationInput and ecom/pickup-location.json.
//
// Its own service host: `www.wixapis.com/pickup-locations`, NOT under `/ecom/` like the rest of
// this section — same per-service-host pattern as form-schema-service/apps-installer-service
// above. Permission ECOM.PICKUP_LOCATION_CREATE. `address` is required by the create call;
// WooCommerce's local_pickup method carries none, so the caller supplies it.
//
// `shippingRuleId` is deliberately never sent: deprecated, marked internal, replaced by
// `deliveryRegionIds`, with a removal target already in the past. The Wix dashboard's own
// front-end still sends it — not a reason for a migration to.
// HOST — LIVE-VERIFIED 2026-09-01, and NOT what the service's own documentation says.
// Its documentation.yaml declares `host: www.wixapis.com/pickup-locations`, but every path
// under that host returns 404 with a valid site token: the service is BETA and simply is not
// exposed on the public gateway yet. The route that works today is the dashboard proxy,
// `manage.wix.com/_api/pickup-locations/...`, which accepts the same CLI-minted site token.
// Both are kept and the public one is tried FIRST, so the day Wix exposes it this silently
// starts using it instead of a proxy — resolvePickupLocationsBase probes once and caches.
const PICKUP_LOCATIONS_PUBLIC_BASE = `${WIXAPIS}/pickup-locations/v1/pickup-locations`;
const PICKUP_LOCATIONS_PROXY_BASE = 'https://manage.wix.com/_api/pickup-locations/v1/pickup-locations';
const PICKUP_LOCATIONS_BASE = PICKUP_LOCATIONS_PROXY_BASE;

// Probes the public host with a harmless query and falls back to the proxy on 404. Any other
// error (401/403) is a real problem and is rethrown rather than being hidden behind a fallback.
// Cached on the client so a run pays for the probe once.
async function resolvePickupLocationsBase(wix) {
  if (wix && wix.__pickupLocationsBase) return wix.__pickupLocationsBase;
  let base = PICKUP_LOCATIONS_PROXY_BASE;
  try {
    await wix.send({ method: 'POST', url: `${PICKUP_LOCATIONS_PUBLIC_BASE}/query`, body: { query: { cursorPaging: { limit: 1 } } } });
    base = PICKUP_LOCATIONS_PUBLIC_BASE;
  } catch (error) {
    if (!/\b404\b/.test(String(error && error.message))) throw error;
  }
  if (wix) wix.__pickupLocationsBase = base;
  return base;
}

function buildCreatePickupLocationRequest(pickupLocation, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'POST', url: baseUrl, body: { pickupLocation } };
}
async function createPickupLocation(wix, pickupLocation) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildCreatePickupLocationRequest(pickupLocation, { baseUrl }))).pickupLocation;
}
function buildGetPickupLocationRequest(id, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'GET', url: `${baseUrl}/${encodeURIComponent(id)}` };
}
async function getPickupLocation(wix, id) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildGetPickupLocationRequest(id, { baseUrl }))).pickupLocation;
}
function buildQueryPickupLocationsRequest(query = { cursorPaging: { limit: 100 } }, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'POST', url: `${baseUrl}/query`, body: { query } };
}
// ONE PAGE, unwrapped to the pickupLocations array — see the READ/RETURN CONTRACT at the top of
// this file. Filter on `.deliveryRegionIds` yourself to find what already covers a region.
async function queryPickupLocations(wix, query) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildQueryPickupLocationsRequest(query, { baseUrl }))).pickupLocations || [];
}
function buildDeletePickupLocationRequest(id, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'DELETE', url: `${baseUrl}/${encodeURIComponent(id)}` };
}
async function deletePickupLocation(wix, id) {
  return wix.send(buildDeletePickupLocationRequest(id, { baseUrl: await resolvePickupLocationsBase(wix) }));
}
// Region membership is NOT editable through Update — the service says so explicitly ("Delivery
// regions cannot be updated using this method, use AddDeliveryRegion and RemoveDeliveryRegion
// instead"). These two are the only way to move a pickup location between regions after create.
// Note the name collision with the Delivery Profiles section's addDeliveryRegion above: that one
// adds a REGION TO A PROFILE, this one adds a PICKUP LOCATION TO A REGION.
// These two take the same `baseUrl` option as create/get/query/delete, and their executors resolve
// it the same way. They used to interpolate PICKUP_LOCATIONS_BASE directly, so two of the six
// pickup calls kept hitting the dashboard proxy after the public-API probe had already succeeded —
// the automatic switchover resolvePickupLocationsBase exists to provide, silently not applied.
function buildAddPickupLocationDeliveryRegionRequest(pickupLocationId, deliveryRegionId, revision, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return {
    method: 'POST',
    url: `${baseUrl}/${encodeURIComponent(pickupLocationId)}/add-delivery-region`,
    body: { deliveryRegionId, ...(revision !== undefined ? { revision } : {}) },
  };
}
async function addPickupLocationDeliveryRegion(wix, pickupLocationId, deliveryRegionId, revision) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildAddPickupLocationDeliveryRegionRequest(pickupLocationId, deliveryRegionId, revision, { baseUrl }))).pickupLocation;
}
function buildRemovePickupLocationDeliveryRegionRequest(pickupLocationId, deliveryRegionId, revision, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return {
    method: 'POST',
    url: `${baseUrl}/${encodeURIComponent(pickupLocationId)}/remove-delivery-region`,
    body: { deliveryRegionId, ...(revision !== undefined ? { revision } : {}) },
  };
}
async function removePickupLocationDeliveryRegion(wix, pickupLocationId, deliveryRegionId, revision) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildRemovePickupLocationDeliveryRegionRequest(pickupLocationId, deliveryRegionId, revision, { baseUrl }))).pickupLocation;
}

// --- eCom orders -----------------------------------------------------------
// WARNING — createOrder is NOT for import. POST /ecom/v1/orders is the LIVE-commerce
// Create Order (ECOM-02 in the owner tracker: Not import-suited): it decrements catalog
// inventory, emails the buyer a confirmation, and auto-creates a contact. Historical
// orders MUST go through importOrder below. createOrder remains only for creating a
// genuine live/test order on purpose.
function buildCreateOrderRequest(order, safeModeOptions) {
  const prepared = applySafeModeToRequest({ order }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/orders`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createOrder(wix, order, safeModeOptions) {
  return (await wix.send(buildCreateOrderRequest(order, safeModeOptions))).order;
}
function buildQueryOrdersRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/orders/query`, body: { query } };
}
// ONE PAGE, unwrapped to the orders array — see the READ/RETURN CONTRACT at the top of this file.
async function queryOrders(wix, query) {
  return (await wix.send(buildQueryOrdersRequest(query))).orders || [];
}

// VERIFIED LIVE writer — 2026-08-12 (the reference store run, 5 orders) and re-verified 2026-08-16
// (applied discounts, line-item descriptionLines/catalogReference.options, merchant-note
// follow-up). Endpoint: POST /ecom/v1/orders/import — the dedicated migration path (Beta,
// scope SCOPE.ECOM.IMPORT-ORDERS, ECOM-01 in the owner tracker).
// LIVE-FOUND TRAPS the builder does NOT yet normalize (see ecom/order.json pitfalls):
//   - `number` must be numeric — a prefixed source order number fails the whole call with a
//     bare 400 {"message":"Not a numeric value"} and no field path.
//   - merchantDiscount.amount must be a Price OBJECT; a bare string 400s "Expected an object".
//   - appliedDiscounts[] comes back REORDERED — correlate by content, never by index.
//   - lineItems[].id is client-settable and preserved, which is what makes the
//     lineItemDiscounts[].id linkage resolvable within a single payload.
// Values are stored AS-IS (no total/status recalculation). No side effects: no
// buyer notifications, no inventory adjustment, no contact/invoice/receipt/subscription
// creation; standard order webhooks don't fire — a single `OrderImported` event is emitted
// instead (that event has exactly one consumer, so imported orders stay invisible to
// contacts/loyalty and other event-driven views; see ECOM-01).
// Required: lineItems (1-300; each needs quantity, productName.original, itemType, price,
// and catalogItemId+appId when catalogReference is present), billingInfo.contactDetails,
// channelInfo (no SHOPIFY/WOOCOMMERCE enum values — use OTHER_PLATFORM), priceSummary,
// status, paymentStatus (full enum, incl. PAID without a real payment).
// History: purchasedDate/number are settable; createdDate is NOT (live-verified 2026-09-05 — it reads back as the import moment) on import (immutable after).
// Re-runs: sending an existing imported order's `id` fully replaces it; overwriting a
// non-imported order fails with CANNOT_OVERWRITE_NON_IMPORTED_ORDER. Cleanup exists via
// Bulk Delete Imported Orders; live-order numbering continues via Set Order Number Counter.
// The two fields a real run got wrong. NOT a validator: Import Order requires plenty more
// (line items, price summary, channel), and this checks none of it, so passing here is not a
// promise the request will be accepted. It is named for the traps it knows because implying
// completeness would be worse than checking nothing.
//
// LIVE-FOUND 2026-09-05, on the first end-to-end: an order with neither `status` nor
// `billingInfo.contactDetails` is rejected with a 400 that names both -- but only once you have
// already sent it, fifteen times, one per order. A billing ADDRESS does not satisfy contactDetails.
// Neither field is implied by anything else in the shape, so a caller assembling an order from a
// source record omits them without noticing. Refuse locally instead: the same information, before
// the network, naming the order so the caller knows which one.
function assertKnownImportOrderTraps(order) {
  const missing = [];
  if (!order || typeof order !== 'object') missing.push('the order itself');
  else {
    if (!order.status) missing.push('status');
    const contactDetails = order.billingInfo && order.billingInfo.contactDetails;
    if (!contactDetails || Object.keys(contactDetails).length === 0) {
      missing.push('billingInfo.contactDetails (a billing address alone is not enough)');
    }
  }
  if (missing.length > 0) {
    const which = order && order.number ? ` (source order ${order.number})` : '';
    throw new Error(`Import Order requires ${missing.join(' and ')}${which}; it would be rejected with a 400`);
  }
}

function buildImportOrderRequest(order, safeModeOptions) {
  assertKnownImportOrderTraps(order);
  const prepared = applySafeModeToRequest({ order }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/orders/import`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function importOrder(wix, order, safeModeOptions) {
  return (await wix.send(buildImportOrderRequest(order, safeModeOptions))).order;
}

// --- Order Transactions / Order Billing (VERIFIED 2026-08-12) ---------------------------------
// Historical refunds need TWO calls, neither of which moves real money — both are pure
// record-keeping (per dev.wix.com: "This does NOT perform the actual charging"/"does NOT call
// payment providers"). `Import Order` does not create any payment transaction record on its own
// (verified live: a freshly-imported order's `/ecom/v1/payments/orders/{id}` reads back
// `payments: []`), so a refund has nothing to reference without step 1 first.
//
// 1. Add Payments — POST /ecom/v1/payments/orders/{orderId}/add-payment. Records that the order
//    was paid (regularPaymentDetails.offlinePayment: true, status: APPROVED) without charging
//    anything. Returns the new payment's `id`, needed as `paymentId` in step 2.
// 2. Refund Payments — POST /ecom/v1/order-billing/refund-payments. `paymentRefunds[].
//    externalRefund: true` is the load-bearing field: "Marks the payment as refunded without
//    calling the provider's API" — this is what makes it importSafe, unlike the previously
//    assumed path through the live-commerce `createOrder`/checkout flow. `sideEffects` is
//    intentionally omitted (no inventory restock, no customer email) for historical data.
// Re-checked against the live Add Payments schema 2026-09-03: at most 50 payments per call, at
// most 100 payment records per order, and the ENTIRE call fails if any external transaction id
// already exists on the order -- which is why reconciliation runs before every create.
const ADD_PAYMENTS_MAX_PER_CALL = 50;
const ORDER_PAYMENTS_MAX_PER_ORDER = 100;

function buildListOrderTransactionsRequest(orderId) {
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/payments/orders/${encodeURIComponent(orderId)}` };
}
async function listOrderTransactions(wix, orderId) {
  return (await wix.send(buildListOrderTransactionsRequest(orderId))).orderTransactions;
}
// Takes a MAPPED payment record and sends it as-is. There are deliberately no
// defaults here any more. The previous signature defaulted `offlinePayment: true`, `status:
// APPROVED` and an amount sized to the order total, which is how a card payment made years ago
// became an approved offline payment dated migration day. Build the record with
// `order-payment-mapping.js` (which enforces the existence gate) and pass it in, or pass nothing.
//
// It also fixes a placement bug found by re-checking the live schema on 2026-09-03: `status` is a
// PAYMENT-level field, not a member of `regularPaymentDetails`. Sent the old way, the API never
// still carries as DEPRECATED and marks as replaced by the top-level one -- not ignored
// outright, but not a shape to keep writing.
function buildAddOrderPaymentRequest({ orderId, payment, payments }) {
  const records = payments || (payment ? [payment] : []);
  if (records.length === 0) {
    throw new Error('buildAddOrderPaymentRequest requires a mapped payment record; it will not invent one');
  }
  if (records.length > ADD_PAYMENTS_MAX_PER_CALL) {
    throw new Error(`Add Payments accepts at most ${ADD_PAYMENTS_MAX_PER_CALL} payments per call; got ${records.length}`);
  }
  for (const record of records) {
    if (!record || !record.amount || !record.amount.amount) {
      throw new Error('a payment record needs an amount; the existence gate must run first');
    }
    if (!record.createdDate) {
      throw new Error('a payment record needs a createdDate; omitting it silently stamps migration day');
    }
    if (record.regularPaymentDetails && 'savedPaymentMethod' in record.regularPaymentDetails) {
      throw new Error('savedPaymentMethod must never be set: no reusable credential can accompany it');
    }
  }
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/payments/orders/${encodeURIComponent(orderId)}/add-payment`,
    body: { payments: records },
  };
}
async function addOrderPayment(wix, payload) {
  const response = await wix.send(buildAddOrderPaymentRequest(payload));
  const ids = response.paymentsIds || [];
  return { paymentId: ids[0], orderTransactions: response.orderTransactions };
}
function buildRefundOrderPaymentRequest({ orderId, paymentId, amount, reason }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/order-billing/refund-payments`,
    body: {
      orderId,
      paymentRefunds: [{ paymentId, amount: { amount: String(amount) }, externalRefund: true }],
      ...(reason ? { customerReason: String(reason).slice(0, 200) } : {}),
    },
  };
}
async function refundOrderPayment(wix, payload) {
  return (await wix.send(buildRefundOrderPaymentRequest(payload))).refund;
}
// The target read that must happen before every payment create.
//
// A crosswalk row may narrow the expected match but may never suppress this read: the migration's
// own record of created IDs does not survive "Wix write succeeded, crosswalk write failed", and it
// is blind to payments created outside the migration -- by the merchant in the Business Manager,
// or by an earlier tool.
//
// The one safety property this pacer exists to guarantee: exhaustion, throttling and permanent
// failure all resolve to `payment-target-read-failed`, and NONE of them resolves to "create". An
// importer that treats a failed read as an empty order duplicates every payment on the next run,
// and Add Payments fails the entire call when a duplicate external transaction id is present.
const TRANSIENT_READ_STATUSES = new Set([429, 500, 502, 503, 504]);

function isTransientReadError(error) {
  const status = error && (error.status || error.statusCode || (error.response && error.response.status));
  return TRANSIENT_READ_STATUSES.has(Number(status));
}

function createTargetReadPacer({ minIntervalMs = 0, maxAttempts = 3, backoffMs = 250, sleep, now } = {}) {
  const clock = now || (() => Date.now());
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stats = { reads: 0, retries: 0, failures: 0, elapsedMs: 0 };
  let lastReadAt = null;

  return {
    stats: () => ({ ...stats }),
    async read(fn) {
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (minIntervalMs > 0 && lastReadAt !== null) {
          const since = clock() - lastReadAt;
          if (since < minIntervalMs) await wait(minIntervalMs - since);
        }
        const startedAt = clock();
        try {
          const value = await fn();
          stats.reads += 1;
          stats.elapsedMs += clock() - startedAt;
          lastReadAt = clock();
          return { ok: true, value };
        } catch (error) {
          stats.reads += 1;
          stats.elapsedMs += clock() - startedAt;
          lastReadAt = clock();
          lastError = error;
          if (attempt < maxAttempts && isTransientReadError(error)) {
            stats.retries += 1;
            await wait(backoffMs * attempt);
            continue;
          }
          break;
        }
      }
      stats.failures += 1;
      return { ok: false, error: lastError };
    },
  };
}

// One process-wide pacer, used whenever a caller does not supply its own.
//
// `pacer` defaulted to null everywhere and was constructed only by tests, so the rate-pacing and
// bounded retry the spec promises did not happen on a real run: a large store issued thousands of
// unpaced single-order reads. Sharing one instance is what makes the spacing meaningful -- a
// per-call pacer paces nothing.
let defaultTargetReadPacer = null;
function sharedTargetReadPacer() {
  if (!defaultTargetReadPacer) {
    defaultTargetReadPacer = createTargetReadPacer({ minIntervalMs: 60, maxAttempts: 3, backoffMs: 250 });
  }
  return defaultTargetReadPacer;
}

async function reconcileOrderPaymentTarget(wix, { orderId, payment = null, pacer = null } = {}) {
  const readOnce = () => listOrderTransactions(wix, orderId);
  const effectivePacer = pacer || sharedTargetReadPacer();
  const result = effectivePacer
    ? await effectivePacer.read(readOnce)
    : await (async () => {
      try {
        return { ok: true, value: await readOnce() };
      } catch (error) {
        return { ok: false, error };
      }
    })();

  // Every shape this returns carries the binding, including the failures: a pre-read that failed
  // is still a pre-read for THIS order and payment, and the writers refuse one without it.
  const binding = { forOrderId: String(orderId), forPaymentFingerprint: payment ? paymentMapping.paymentFingerprint(payment) : null };
  if (!result.ok) {
    return { outcome: 'payment-target-read-failed', paymentId: null, existingPayments: [], error: result.error, ...binding };
  }

  const existingPayments = (result.value && result.value.payments) || [];
  const existingRefunds = (result.value && result.value.refunds) || [];
  if (!payment) {
    return { outcome: 'target-read', paymentId: null, existingPayments, existingRefunds, ...binding };
  }

  const reconciled = paymentMapping.reconcilePayment({ payment, existingPayments });
  return {
    outcome: reconciled.outcome,
    paymentId: reconciled.match ? reconciled.match.id : null,
    matchedBy: reconciled.matchedBy || null,
    existingPayments,
    existingRefunds,
    // What this read was FOR, so a writer handed it as a pre-read can refuse one taken for another
    // order or another payment (review passed one for an unrelated payment and suppressed a real
    // write without a single target call).
    ...binding,
  };
}

// A pre-read must be THIS order's and THIS payment's, or it reconciles against the wrong identity.
function assertReconciledBinding(reconciled, { orderId, payment }, caller) {
  if (!reconciled || typeof reconciled !== 'object') throw new Error(`${caller}: reconciled must be the result of reconcileOrderPaymentTarget`);
  const fingerprint = paymentMapping.paymentFingerprint(payment);
  if (reconciled.forOrderId !== String(orderId) || reconciled.forPaymentFingerprint !== fingerprint) {
    throw new Error(`${caller}: the reconciled read was taken for order ${reconciled.forOrderId} / payment ${reconciled.forPaymentFingerprint}, not for order ${orderId} / this payment; take a fresh read`);
  }
}

// The payment-write path a generated importer calls per eligible order. Ineligible orders must
// not reach this function at all -- applying the source gate first is what keeps the target reads
// proportional to evidenced payments rather than to the whole order population.
// `reconciled`: a reconciliation read this caller has ALREADY taken for this order and
// this payment, so the composite can read the order's payments once and feed both the payment and
// the refund path. Omitted, the writer reads for itself, exactly as before. It must be the result
// of `reconcileOrderPaymentTarget` for the SAME payment -- a read taken for a different record
// reconciles against the wrong identity, so the composite is the only intended caller.
async function writeOrderPayment(wix, { orderId, payment, pacer = null, reconciled = null } = {}) {
  if (!payment) {
    throw new Error('writeOrderPayment requires a mapped payment record; run the existence gate first');
  }
  if (reconciled === null) reconciled = await reconcileOrderPaymentTarget(wix, { orderId, payment, pacer });
  else assertReconciledBinding(reconciled, { orderId, payment }, 'writeOrderPayment');

  if (reconciled.outcome === paymentMapping.RECONCILE.RECONCILED) {
    return { outcome: 'payment-reconciled-existing', paymentId: reconciled.paymentId, matchedBy: reconciled.matchedBy };
  }
  if (reconciled.outcome !== paymentMapping.RECONCILE.CREATE) {
    return { outcome: reconciled.outcome, paymentId: null, error: reconciled.error };
  }

  const added = await addOrderPayment(wix, { orderId, payment });
  return { outcome: 'payment-written', paymentId: added.paymentId };
}

// A refund the provider has not finished settling is a WAIT, not a failure. Distinguished from
// every other PAYMENT_NOT_REFUNDABLE reason, which are genuine refusals.
//
// Decided on the STRUCTURED error, not the message. The message is truncated at 400 characters
// for readability, so a reason that appears after the cut -- or a provider that reorders its own
// JSON -- would silently turn a transient refusal into a fatal one, losing the refund the retry
// exists to save. The string check remains only as a fallback for transports that lose the body.
function isPendingRefund(error) {
  if (!error) return false;
  if (error.nonRefundableReason === 'PENDING_REFUND') return true;
  if (error.body) {
    const applicationError = error.body.details && error.body.details.applicationError;
    if (applicationError && applicationError.data && applicationError.data.nonRefundableReason === 'PENDING_REFUND') return true;
  }
  return /PENDING_REFUND/.test(error.message || '');
}

// The historical-refund path, with the fabrication removed.
//
// What this replaces: the wrapper used to select a payment with
// `(existing.payments || []).find((p) => !p.refundDisabled)?.id` and, failing that, CREATE one
// sized to the order total. Both halves were wrong. The selector is identity-free, so it happily
// matches an unrelated record -- including a payment the merchant entered by hand in the Business
// Manager -- and attaches someone else's refund to it. The fallback invented an approved payment
// for an order that may never have been paid, which is the revenue overstatement 0124 exists to
// remove.
//
// Now: pass the MAPPED payment (from `order-payment-mapping.js`) when the source evidences one.
// The order's real payments are read first, reconciled by identity, and a payment is created only
// when reconciliation says no matching record exists. When the source evidences no payment, this
// refuses and reports rather than inventing one -- an unrefundable refund is a reportable gap, not
// a reason to fabricate its counterpart.
//
// Returns an outcome rather than throwing, because Decision 8 requires every order to land in
// exactly one counted bucket.
async function ensureOrderPaymentAndRefund(wix, { orderId, payment = null, refundAmount, reason, sourceRefundId = null, sourceOccurrence = 1, pacer = null, reconciled = null }) {
  // WITHOUT a mapped payment there is nothing to resolve BY IDENTITY, so there is nothing to
  // refund. An earlier version fell back to "the order carries exactly one payment, so use it",
  // which is selection by count, not by identity: given a source refund with no defensible
  // payment and one unrelated payment the merchant entered by hand, it attached the historical
  // refund to that payment. Unambiguous is not the same as correct. The read is also skipped
  // entirely, because an ineligible source order must cost no target read.
  if (!payment) {
    return { refund: null, paymentId: null, outcome: 'refund-without-payment' };
  }

  // Same `reconciled` contract as writeOrderPayment: a pre-read taken for THIS payment, or null.
  if (reconciled === null) reconciled = await reconcileOrderPaymentTarget(wix, { orderId, payment, pacer });
  else assertReconciledBinding(reconciled, { orderId, payment }, 'ensureOrderPaymentAndRefund');
  if (reconciled.outcome === 'payment-target-read-failed') {
    return { refund: null, paymentId: null, outcome: 'payment-target-read-failed' };
  }
  if (reconciled.outcome === paymentMapping.RECONCILE.AMBIGUOUS) {
    return { refund: null, paymentId: null, outcome: 'payment-reconciliation-ambiguous' };
  }

  let paymentId = reconciled.paymentId;
  if (reconciled.outcome === paymentMapping.RECONCILE.CREATE) {
    const added = await addOrderPayment(wix, { orderId, payment });
    paymentId = added.paymentId;
  }
  if (!paymentId) {
    return { refund: null, paymentId: null, outcome: 'refund-without-payment' };
  }

  // A refund carries no place for the source id -- the only free-text field is customer-visible --
  // so a re-run recognizes its own work by the refund's facts. Without this a clean re-run writes
  // the same external refund twice and the order reads as refunded twice over.
  const refundCheck = paymentMapping.reconcileRefund({
    paymentId,
    amount: refundAmount,
    existingRefunds: reconciled.existingRefunds || [],
    sourceOccurrence,
  });
  if (refundCheck.outcome === paymentMapping.RECONCILE_REFUND.RECONCILED) {
    return { refund: null, paymentId, sourceRefundId, outcome: 'refund-reconciled-existing', refundId: refundCheck.refundId };
  }
  // A refund does not settle instantly. LIVE-VERIFIED 2026-09-05: writing a second refund against
  // the same payment while the first is still processing is refused with
  // `428 PAYMENT_NOT_REFUNDABLE / nonRefundableReason: PENDING_REFUND`. That is precisely the
  // shape the occurrence model exists for -- two equal refunds on one payment -- so failing here
  // would lose the second refund of every such pair. Wait for the first to settle and retry.
  let refund = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      refund = await refundOrderPayment(wix, { orderId, paymentId, amount: refundAmount, reason });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!isPendingRefund(error) || attempt === 6) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  if (lastError) {
    if (isPendingRefund(lastError)) {
      return { refund: null, paymentId, sourceRefundId, outcome: 'refund-still-settling' };
    }
    throw lastError;
  }
  return { refund, paymentId, sourceRefundId, outcome: 'refund-written' };
}

// --- Stores inventory (Catalog V3 Inventory Items API) ----------------------
// VERIFIED: POST /stores/v3/inventory-items creates one inventory item per variant.
// Single-create and read-back exercised with synthetic hidden products. Bulk imports and
// reruns use storesInventory.reconcileInventory for comparison, revisioned repair and verification.
// Standalone product create does not seed inventory. Use explicit inventory writes
// or include per-variant inventory in the product-with-inventory bulk create.
// To mark a variant as in stock without quantity tracking: set `inStock: true`.
// Omit `locationId` to target the default location (the one Wix's standard checkout
// deducts from). The combination of variantId + locationId must be unique.
//
// How to determine variantIds: `createStoresProduct` returns the full product object;
// the variant IDs are at `product.variantsInfo.variants[].id`.
function buildCreateInventoryItemRequest({ variantId, productId, locationId, inStock, quantity, trackQuantity, preorderInfo }) {
  const item = {
    variantId,
    productId,
    ...(locationId ? { locationId } : {}),
    ...storesInventory.stockPayload({ ...(inStock !== undefined ? { inStock } : {}), ...(quantity !== undefined ? { quantity } : {}), ...(trackQuantity !== undefined ? { trackQuantity } : {}) }),
    ...(preorderInfo ? { preorderInfo } : {}),
  };
  return { method: 'POST', url: `${WIXAPIS}/stores/v3/inventory-items`, body: { inventoryItem: item } };
}
async function createInventoryItem(wix, payload) {
  return (await wix.send(buildCreateInventoryItemRequest(payload))).inventoryItem;
}
// Convenience: mark all variants of a product as in stock (untracked mode) at the
// default location. Pass the product object returned by `createStoresProduct`.
async function setProductVariantsInStock(wix, { productId, variantIds, locationId } = {}) {
  const results = [];
  for (const variantId of (variantIds || [])) {
    results.push(await createInventoryItem(wix, { variantId, productId, inStock: true, locationId }));
  }
  return results;
}

// --- coupons: reconcile by code, then create --------------------------
// The crosswalk is an accelerator, never the authority: a coupon is reconciled against the TARGET
// by code before it is created. Zero matches permits creation, exactly one reconciles, more than
// one is ambiguous and creates nothing. The read is paced and retried, because a write on this
// surface is not readable immediately (stores/coupon pitfall) and a missed read must never become
// permission to create.
function buildQueryCouponsByCodeRequest(code) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v2/coupons/query`, body: { query: { filter: JSON.stringify({ 'specification.code': { $eq: String(code) } }), paging: { limit: 10, offset: 0 } } } };
}
async function queryCouponsByCode(wix, code) {
  const response = await wix.send(buildQueryCouponsByCodeRequest(code));
  const list = (response && response.coupons) || [];
  // Codes are case- and space-sensitive on Wix; the filter is exact, this is belt-and-braces.
  return list.filter((c) => String(((c.specification || c).code) || '') === String(code));
}
function buildDeleteCouponRequest(couponId) {
  return { method: 'DELETE', url: `${WIXAPIS}/stores/v2/coupons/${encodeURIComponent(couponId)}` };
}
async function deleteCoupon(wix, couponId) {
  return wix.send(buildDeleteCouponRequest(couponId));
}
async function ensureCoupon(wix, { specification, pacer = null, safeModeOptions } = {}) {
  if (!specification || !specification.code) throw new Error('ensureCoupon needs a mapped coupon specification with a code');
  const effectivePacer = pacer || sharedTargetReadPacer();
  const read = await effectivePacer.read(() => queryCouponsByCode(wix, specification.code));
  if (!read.ok) return { outcome: 'coupon-target-read-failed', couponId: null, error: read.error };
  if (read.value.length === 1) return { outcome: 'coupon-reconciled-existing', couponId: read.value[0].id };
  if (read.value.length > 1) return { outcome: 'coupon-reconciliation-ambiguous', couponId: null, matchCount: read.value.length };
  try {
    const created = await createCoupon(wix, specification, safeModeOptions);
    // LIVE 2026-09-05: createCoupon hands back the bare id string (Create Coupon answers `{ id }`
    // and the writer unwraps it). Reading `.id` off a string reported every successful create as
    // "no id" while the coupons were in fact on the site -- the first sentinel run refuted five
    // writes that had all landed. Accept the string, an `{ id }`, or an `{ coupon: { id } }`.
    const couponId = typeof created === 'string' ? created : created && (created.id || (created.coupon && created.coupon.id));
    if (!couponId) return { outcome: 'coupon-failed', couponId: null, error: { message: `Create Coupon returned no id: ${String(JSON.stringify(created) ?? 'undefined').slice(0, 120)}` } };
    return { outcome: 'coupon-written', couponId: String(couponId) };
  } catch (error) {
    // A duplicate the read missed (the write-then-read lag): adopt it rather than fail the run.
    if (/already exists|ALREADY_EXISTS|duplicate/i.test(String(error && error.message))) {
      const again = await effectivePacer.read(() => queryCouponsByCode(wix, specification.code));
      if (again.ok && again.value.length === 1) return { outcome: 'coupon-reconciled-existing', couponId: again.value[0].id, matchedAfter: 'duplicate-rejection' };
    }
    return { outcome: 'coupon-failed', couponId: null, error: { message: String(error && error.message).slice(0, 300), status: error && error.status } };
  }
}

// --- pricing plans: definitions only, inert --------------------------
// POST /pricing-plans/v3/plans, verified live 2026-08-16 (plan.json). The body comes from
// pricing-plan-definition.js and is refused here unless it is PRIVATE and unbuyable: that pair is
// what keeps a migrated definition off the live site's Plans page and out of self-purchase.
const WIX_PRICING_PLANS_APP_DEF_ID = '1522827f-c56c-a5c9-2ac9-00f9e6ae12d3';
const PLAN_WRITE_MIN_INTERVAL_MS = 1000; // the documented import flow requires >= 1s between requests

// `idempotencyKey` is a BODY field beside `plan` (Create Plan docs: request parameter, GUID
// format), not a header. The first implementation sent a header, which the API ignored, so the
// documented duplicate guard was void while the test pinned the wrong contract (review).
function buildCreatePlanRequest(plan, { idempotencyKey = null } = {}) {
  pricingPlanDefinition.assertInertPlan(plan);
  return {
    method: 'POST',
    url: `${WIXAPIS}/pricing-plans/v3/plans`,
    body: { plan, ...(idempotencyKey ? { idempotencyKey: String(idempotencyKey) } : {}) },
  };
}
async function createPlan(wix, plan, options) {
  return (await wix.send(buildCreatePlanRequest(plan, options))).plan;
}
function buildQueryPlansByNameRequest(name) {
  return { method: 'POST', url: `${WIXAPIS}/pricing-plans/v3/plans/query`, body: { query: { filter: { name: { $eq: String(name) } }, cursorPaging: { limit: 50 } } } };
}
async function queryPlansByName(wix, name) {
  return ((await wix.send(buildQueryPlansByNameRequest(name))) || {}).plans || [];
}
// Plans V3 has no archive; the V2 call is the working one (plan.json: no-archive-on-v3).
function buildArchivePlanRequest(planId) {
  return { method: 'POST', url: `${WIXAPIS}/pricing-plans/v2/plans/${encodeURIComponent(planId)}/archive`, body: {} };
}
async function archivePlan(wix, planId) {
  return wix.send(buildArchivePlanRequest(planId));
}
function buildGetPlanRequest(planId) {
  return { method: 'GET', url: `${WIXAPIS}/pricing-plans/v3/plans/${encodeURIComponent(planId)}` };
}
async function getPlan(wix, planId) {
  return ((await wix.send(buildGetPlanRequest(planId))) || {}).plan || null;
}
// The reconciliation IDENTITY is the client-minted variant id: derived from the source offer,
// preserved verbatim by Wix (plan.json, verified live 2026-08-16), and unique per offer. A name is
// not: it is truncated to 50 characters, so two offers can share one, and review demonstrated the
// second offer adopting the first's PUBLIC, buyable plan by name. A plan is "ours" only when it
// carries one of our variant ids.
function planVariantIds(plan) {
  const ids = (plan && Array.isArray(plan.pricingVariants) ? plan.pricingVariants : [])
    .map((v) => v && v.id).filter((id) => typeof id === 'string' && id.trim() !== '');
  if (ids.length === 0) throw new Error('ensurePlanDefinition needs pricingVariants[].id: the client-minted, offer-derived variant id is the reconciliation identity (buildPlanDefinition mints it)');
  return ids;
}
function carriesVariant(candidate, ids) {
  const have = (candidate && Array.isArray(candidate.pricingVariants) ? candidate.pricingVariants : []).map((v) => v && v.id);
  return ids.some((id) => have.includes(id));
}
// Every adopted plan is READ and its state reported, never taken on faith from a crosswalk row.
// One that is ours but no longer inert is left as found (the merchant may have published it on
// purpose) and reported, so the report never says "inert" about a purchasable plan.
function adoptPlan(candidate, matchedBy) {
  const inert = candidate.visibility === 'PRIVATE' && candidate.buyable === false;
  const result = { outcome: 'plan-reconciled-existing', planId: String(candidate.id), matchedBy, visibility: candidate.visibility, buyable: candidate.buyable, findings: [] };
  if (!inert) result.findings.push({ code: 'plan-reconciled-not-inert', planId: String(candidate.id), visibility: candidate.visibility, buyable: candidate.buyable, note: 'a plan this migration wrote is now purchasable on the target; left as found, reported' });
  return result;
}
let lastPlanWriteAt = 0;
// Crosswalk first (read back and verified), then the target by name filtered to OUR variant id,
// then create -- >= 1s apart.
async function ensurePlanDefinition(wix, { plan, idempotencyKey = null, knownPlanId = null, pacer = null, sleep = null } = {}) {
  pricingPlanDefinition.assertInertPlan(plan);
  const ids = planVariantIds(plan);
  const effectivePacer = pacer || sharedTargetReadPacer();
  const findings = [];
  if (knownPlanId) {
    // A crosswalk row is a claim, not a fact: the plan may have been deleted (review demonstrated
    // "reconciled" with no target call at all), archived, or the row may point at somebody else's
    // plan. Gone or foreign -> the row is stale and the name path decides; archived -> not the plan.
    const known = await effectivePacer.read(() => getPlan(wix, knownPlanId));
    if (!known.ok && !(known.error && known.error.status === 404)) return { outcome: 'plan-target-read-failed', planId: null, error: known.error };
    const candidate = known.ok ? known.value : null;
    if (candidate && candidate.archived !== true && carriesVariant(candidate, ids)) return adoptPlan(candidate, 'crosswalk');
    findings.push({ code: 'plan-crosswalk-row-stale', knownPlanId: String(knownPlanId), reason: !candidate ? 'not-found' : candidate.archived === true ? 'archived' : 'not-this-offer' });
  }
  const read = await effectivePacer.read(() => queryPlansByName(wix, plan.name));
  if (!read.ok) return { outcome: 'plan-target-read-failed', planId: null, error: read.error, findings };
  // An ARCHIVED plan of that name is not the plan: adopting it would leave nothing active on the
  // target while reporting reconciled. The V3 filter table has no `archived`, so post-filter.
  // A live plan of that name that does NOT carry our variant id is somebody else's (or another
  // offer's, truncated to the same name) and is neither adopted nor an obstacle.
  const ours = read.value.filter((p) => p && p.archived !== true && carriesVariant(p, ids));
  if (ours.length === 1) { const adopted = adoptPlan(ours[0], 'variant-id'); return { ...adopted, findings: [...findings, ...adopted.findings] }; }
  if (ours.length > 1) return { outcome: 'plan-reconciliation-ambiguous', planId: null, matchCount: ours.length, findings };
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const since = Date.now() - lastPlanWriteAt;
  if (since < PLAN_WRITE_MIN_INTERVAL_MS) await wait(PLAN_WRITE_MIN_INTERVAL_MS - since);
  try {
    const created = await createPlan(wix, plan, { idempotencyKey });
    lastPlanWriteAt = Date.now();
    if (!created || !created.id) return { outcome: 'plan-failed', planId: null, error: { message: 'Create Plan returned no id' }, findings };
    // The RESULT is checked too, not only the request: a plan that came back purchasable is a
    // live-site hazard, so it is archived at once and reported as failed rather than written.
    if (created.visibility !== 'PRIVATE' || created.buyable !== false) {
      // The archive's own failure is REPORTED, not swallowed: review demonstrated a 403 here
      // reported as `archived: true` while the purchasable plan stayed live. `archived: false` is
      // the live-site hazard the report blocks on (plans-live-hazard).
      let archived = true;
      let archiveError = null;
      try { await archivePlan(wix, created.id); } catch (error) { archived = false; archiveError = { message: String(error && error.message).slice(0, 300), status: error && error.status }; }
      return { outcome: 'plan-failed', planId: created.id, error: { cause: 'created-plan-not-inert', visibility: created.visibility, buyable: created.buyable, archived, ...(archiveError ? { archiveError } : {}) }, findings };
    }
    return { outcome: 'plan-written', planId: created.id, visibility: created.visibility, buyable: created.buyable, findings };
  } catch (error) {
    lastPlanWriteAt = Date.now();
    return { outcome: 'plan-failed', planId: null, error: { message: String(error && error.message).slice(0, 300), status: error && error.status }, findings };
  }
}

// --- members ---------------------------------------------------------------
// VERIFIED: GET /members/v1/members (reconcile), POST /members/v1/members (create).
// Dedup by loginEmail — gated PII; null email cannot dedup/create (use a fallback).
// DOCUMENTED: no bulk create; >=1s spacing between Create Member calls is the
// documented rate-limit floor — space sequential creates and resume via crosswalk.
// DOCUMENTED: create sends no email and does not fire the signup automations
// trigger — member import is silent by default. Passwords are NEVER imported
// (project decision 2026-08-03). Activation (decided): passwordless members
// complete the standard forgot-password flow (confirmed 2026-08-03); delivery is
// a post-import label-wave automation (owner-created, label-added trigger,
// branded email pointing at Log in -> Forgot password; importer labels contacts
// in API batches), enabled only after the import window. There is deliberately
// no send-set-password-email writer here: its link dies in 3h and mass-sending
// it is the exact notification-blast this lib exists to avoid.
// VERIFIED-TRAP (2026-07-19): the default (PUBLIC) fieldset OMITS loginEmail, which
// silently breaks dedupe-by-loginEmail; request fieldsets=FULL so the field is present.
// VERIFIED (2026-08-02, single-site observation): the member list can already contain
// AUTO-CREATED user-members for the site owner / contributing Wix users (status
// APPROVED) even on an API-provisioned site nobody ever visited — seen on our test
// site. Never dedupe or reconcile these against source-site
// members. The owner's user-member is a valid blog author memberId — attribute-to-owner
// blog imports need no member provisioning. Resolve it from THIS list by loginEmail:
// the observed id equality (member id == account GUID) is n=1 on a solo account and
// undocumented — never construct a memberId from the account/user id.
async function listMembers(wix, { limit = 50 } = {}) {
  return wix.send({ method: 'GET', url: `${WIXAPIS}/members/v1/members?fieldsets=FULL&paging.limit=${limit}` });
}
function buildCreateMemberRequest({ email, name, slug }, safeModeOptions) {
  if (!email) return { skipped: true, reason: 'no email — gated PII; authenticated source re-run required' };
  const prepared = applySafeModeToRequest({ member: { loginEmail: email, contact: { firstName: name }, profile: { nickname: name, slug } } }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/members/v1/members`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createMember(wix, payload, safeModeOptions) {
  const request = buildCreateMemberRequest(payload, safeModeOptions);
  if (request.skipped) return request;
  return (await wix.send(request)).member;
}

// --- members: full-fidelity create/reconcile, with the phone-collision guard --------------
// The member/contact split from the member entity's own docs (0089): buildMemberContact
// (customer-member.js) maps a source customer into Member.contact; this is the write side --
// reconcile by loginEmail (or a corroborated crosswalk row), and never send a phone the target
// already has on file for someone else.
const MEMBER_WRITE_MIN_INTERVAL_MS = 1000; // documented Create Member floor: >=1s apart.
let lastMemberWriteAt = 0;
function buildGetMemberRequest(memberId) {
  return { method: 'GET', url: `${WIXAPIS}/members/v1/members/${encodeURIComponent(memberId)}?fieldsets=FULL` };
}
async function getMember(wix, memberId) {
  return ((await wix.send(buildGetMemberRequest(memberId))) || {}).member || null;
}
function buildQueryMembersByLoginEmailRequest(loginEmail) {
  return { method: 'POST', url: `${WIXAPIS}/members/v1/members/query`, body: { fieldsets: ['FULL'], query: { filter: { loginEmail: String(loginEmail) } } } };
}
async function queryMembersByLoginEmail(wix, loginEmail) {
  return ((await wix.send(buildQueryMembersByLoginEmailRequest(loginEmail))) || {}).members || [];
}
// VERIFIED LIVE 2026-09-06: Contacts dedupe on phone, and Create Member REUSES whatever contact
// already carries a matching phone -- a second, unrelated member created with the same phone
// adopted the first member's contactId (even after the first member was deleted; a deleted
// member's contact is NOT deleted). Query before every create that carries a phone; a match means
// the phone belongs to somebody else's identity already, so it is dropped rather than risking a
// silent merge of two different source customers.
function buildQueryContactsByPhoneRequest(phone) {
  return { method: 'POST', url: `${WIXAPIS}/contacts/v5/contacts/query`, body: { query: { filter: { 'phone.phone': { $eq: String(phone) } } } } };
}
async function queryContactsByPhone(wix, phone) {
  return ((await wix.send(buildQueryContactsByPhoneRequest(phone))) || {}).contacts || [];
}
function normalizeLoginEmailForCompare(email) {
  return String(email || '').trim().toLowerCase();
}
// Crosswalk first (read back and verified, like ensurePlanDefinition), then Query Members by
// loginEmail -- one match reconciles, more than one is ambiguous and creates nothing -- then
// Create Member >=1s apart, with the phone-collision guard immediately before the write.
async function ensureMember(wix, { loginEmail, contact = {}, knownMemberId = null, pacer = null, sleep = null } = {}) {
  const email = normalizeLoginEmailForCompare(loginEmail);
  if (!email) return { outcome: 'member-not-written-no-email', memberId: null, findings: [] };
  const findings = [];
  const effectivePacer = pacer || sharedTargetReadPacer();
  if (knownMemberId) {
    const known = await effectivePacer.read(() => getMember(wix, knownMemberId));
    if (!known.ok && !(known.error && known.error.status === 404)) return { outcome: 'member-target-read-failed', memberId: null, error: known.error, findings };
    const candidate = known.ok ? known.value : null;
    if (candidate && normalizeLoginEmailForCompare(candidate.loginEmail) === email) {
      return { outcome: 'member-reconciled-existing', memberId: String(candidate.id), contactId: candidate.contactId ? String(candidate.contactId) : null, matchedBy: 'crosswalk', findings };
    }
    findings.push({ code: 'member-crosswalk-row-stale', knownMemberId: String(knownMemberId), reason: !candidate ? 'not-found' : 'not-this-email' });
  }
  const read = await effectivePacer.read(() => queryMembersByLoginEmail(wix, email));
  if (!read.ok) return { outcome: 'member-target-read-failed', memberId: null, error: read.error, findings };
  const matches = read.value.filter((m) => m && normalizeLoginEmailForCompare(m.loginEmail) === email);
  if (matches.length === 1) return { outcome: 'member-reconciled-existing', memberId: String(matches[0].id), contactId: matches[0].contactId ? String(matches[0].contactId) : null, matchedBy: 'loginEmail', findings };
  if (matches.length > 1) return { outcome: 'member-reconciliation-ambiguous', memberId: null, matchCount: matches.length, findings };

  // Review (2026-09-06): checking only phones[0] would leave a second entry un-guarded, reopening
  // the exact hole this check exists for. Every phone in the array is checked; a collision on ANY
  // of them drops the whole array (never a partial one — a "safe" and a "colliding" phone side by
  // side on the created contact would still let the colliding one merge two customers).
  let effectiveContact = contact;
  const phones = contact && Array.isArray(contact.phones) ? contact.phones : [];
  if (phones.length > 0) {
    let collided = false;
    for (const phone of phones) {
      const collision = await effectivePacer.read(() => queryContactsByPhone(wix, phone));
      if (!collision.ok) return { outcome: 'member-target-read-failed', memberId: null, error: collision.error, findings };
      if (collision.value.length > 0) {
        findings.push({ code: 'member-phone-collision-dropped', phoneDropped: true, existingContactId: String(collision.value[0].id) });
        collided = true;
      }
    }
    if (collided) {
      const { phones: _dropped, ...rest } = contact;
      effectiveContact = rest;
    }
  }

  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const since = Date.now() - lastMemberWriteAt;
  if (since < MEMBER_WRITE_MIN_INTERVAL_MS) await wait(MEMBER_WRITE_MIN_INTERVAL_MS - since);
  try {
    const body = { member: { loginEmail, ...(Object.keys(effectiveContact || {}).length > 0 ? { contact: effectiveContact } : {}), privacyStatus: 'PRIVATE' } };
    const created = await wix.send({ method: 'POST', url: `${WIXAPIS}/members/v1/members`, body });
    lastMemberWriteAt = Date.now();
    const member = created && created.member;
    if (!member || !member.id) return { outcome: 'member-failed', memberId: null, error: { message: 'Create Member returned no id' }, findings };
    return { outcome: 'member-written', memberId: String(member.id), contactId: member.contactId ? String(member.contactId) : null, findings };
  } catch (error) {
    lastMemberWriteAt = Date.now();
    // VERIFIED LIVE 2026-09-06: Query Members by loginEmail is eventually consistent -- up to ~5s
    // after Create Member before a fresh member is findable, while Create Member's own loginEmail
    // uniqueness check is immediate (a same-email create in a different case 409s right away). So a
    // fast re-run (a resumed migration within that window) can reconcile-query too early, see zero
    // matches, and then hit exactly this 409 for a member that in fact already exists. Reported as
    // MEMBER-ALREADY-EXISTS-UNRECONCILED, not the generic member-failed: the caller's crosswalk
    // will pick it up on the NEXT run once the query catches up, so this is not data loss, but it
    // is not silent success either.
    if (error && error.status === 409 && /already exists/i.test(String(error.message))) {
      return { outcome: 'member-already-exists-unreconciled', memberId: null, error: { message: String(error.message).slice(0, 300), status: error.status }, findings };
    }
    return { outcome: 'member-failed', memberId: null, error: { message: String(error && error.message).slice(0, 300), status: error && error.status }, findings };
  }
}

// --- site notifications mute (Notification Preferences V1) ------------------
// VERIFIED (2026-08-04, full cycle live on a test target): mute → state read →
// idempotent re-mute → unmute → state restored, all HTTP 200. All three calls
// return { siteMuteState: { muted, reason?, mutedBy: { wixUserId } } } — the
// executors unwrap to `siteMuteState`.
// Scope (proto doc comment, confirmed by Ping): mutes ALL notifications of the site
// in context, for all recipients and all channels — sendability is denied regardless
// of recipient-level preferences.
// Spec 0012 hard invariant: when mute is in effect (always for new sites; explicit
// opt-in for existing), a failed mute call means the run NEVER proceeds to import
// writes — halt, no degraded mode.
// AUTH TRAP (verified 2026-08-04): the permission grant covers USER tokens only.
// The CLI-minted OauthNG site token (WIX_AUTH_TOKEN from config/wix.env) works; an
// account API key gets a uniform empty-body 403 on all three endpoints.
// IDEMPOTENCY TRAP (verified 2026-08-04): re-muting an already-muted site succeeds
// but OVERWRITES `reason` (last caller wins) — the import preflight's re-call must
// pass the same project-identifying reason as setup, or the audit trail degrades.
// `unmuteSiteNotifications` is NEVER called by the flow itself — explicit owner
// request only; after an on-request unmute, confirm with
// getSiteMuteState (muted: false).
const SITE_MUTE_REASON_MAX = 500;
function buildMuteSiteNotificationsRequest({ reason } = {}) {
  const body = reason ? { reason: String(reason).slice(0, SITE_MUTE_REASON_MAX) } : {};
  return { method: 'POST', url: `${WIXAPIS}/notification-preferences/v1/site-mute/mute`, body };
}
async function muteSiteNotifications(wix, payload) {
  return (await wix.send(buildMuteSiteNotificationsRequest(payload))).siteMuteState;
}
function buildUnmuteSiteNotificationsRequest() {
  return { method: 'POST', url: `${WIXAPIS}/notification-preferences/v1/site-mute/unmute`, body: {} };
}
async function unmuteSiteNotifications(wix) {
  return (await wix.send(buildUnmuteSiteNotificationsRequest())).siteMuteState;
}
function buildGetSiteMuteStateRequest() {
  return { method: 'GET', url: `${WIXAPIS}/notification-preferences/v1/site-mute` };
}
async function getSiteMuteState(wix) {
  return (await wix.send(buildGetSiteMuteStateRequest())).siteMuteState;
}

// --- Bookings (VERIFIED 2026-08-12) -----------------------------------------------------
// Wix Bookings is NOT automatically present on a fresh headless site, and the absence is easy
// to miss: `/bookings/v2/services` and `/bookings/v2/resources/query` both answer with ordinary
// 200s/validation errors (never an "app not installed" error) even when the Bookings app
// instance does not exist in `GET /apps-installer-service/v1/app-instances` — so a plausible
// response from either endpoint is NOT proof the app is installed. Confirmed live on this site:
// Create Service failed with `form Form with id 00000000-0000-0000-0000-000000000000 doesn't
// exist` (Clone Form on that same id also 404s `FORM_NOT_FOUND`) until the app instance was
// installed via installWixApp below; installing it auto-provisions BOTH the default booking
// form at that same all-zero id AND one default "Business Owner" staff resource, so no
// form-cloning step is needed in the normal path (buildCloneBookingFormRequest/cloneBookingForm
// are kept below only for the custom-booking-form scenario in the Wix Forms Integration docs,
// not part of ensureBookingsProvisioned's default flow).
const WIX_BOOKINGS_APP_DEF_ID = '13d21c63-b5ec-5912-8397-c3a5ddb27a97';
const DEFAULT_BOOKING_FORM_ID = '00000000-0000-0000-0000-000000000000';

// VERIFIED (2026-08-12): body shape matches rp-execute-setup's already-verified Install App
// contract (SKILL.md "Installing / enabling Wix apps IS automatable") — all four top-level
// fields are required, confirmed by live 400s on other apps. Idempotent in practice: installing
// an already-installed app instance does not error or duplicate the instance.
function buildInstallWixAppRequest({ appDefId, siteId }) {
  if (!appDefId) throw new Error('buildInstallWixAppRequest: appDefId is required');
  return {
    method: 'POST',
    url: `${WIXAPIS}/apps-installer-service/v1/app-instance/install`,
    body: {
      appInstance: { appDefId, enabled: true },
      tenant: { tenantType: 'SITE', id: siteId },
      installType: 'INSTALL_TYPE_SITE',
      appsInstallOptions: {},
    },
  };
}
async function installWixApp(wix, { appDefId, siteId }) {
  return wix.send(buildInstallWixAppRequest({ appDefId, siteId }));
}
function buildGetInstalledWixAppsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/apps-installer-service/v1/app-instances` };
}
// ONE PAGE, unwrapped to the appInstances array — see the READ/RETURN CONTRACT note at the top
// of this file. No cursor has been observed on this endpoint across any site seen so far, but
// treat the unwrap the same cautious way as the other query* helpers here.
async function getInstalledWixApps(wix) {
  return (await wix.send(buildGetInstalledWixAppsRequest())).appInstances || [];
}
async function isWixAppInstalled(wix, appDefId) {
  const apps = await getInstalledWixApps(wix);
  return apps.some((a) => a && a.appDefId === appDefId);
}

// VERIFIED (2026-08-12): POST /form-schema-service/v4/forms/{formId}/clone with an EMPTY body
// clones the named form and inherits its namespace. Creating a form directly in the
// `wix.bookings.v2.bookings` namespace via the generic Create Form call 400s
// `UNSUPPORTED_FORM_NAMESPACE` even with the Bookings app installed — namespace-owned forms
// must be cloned from the app's own default/existing form, never authored fresh. Not needed for
// a stock booking form (see ensureBookingsProvisioned); use this only to build a CUSTOM form per
// the Wix Forms Integration flow (clone, then edit fields, then pass the new id as
// `service.form.id` on create).
function buildCloneBookingFormRequest(sourceFormId = DEFAULT_BOOKING_FORM_ID) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/form-schema-service/v4/forms/${sourceFormId}/clone`,
    body: {},
  };
}
async function cloneBookingForm(wix, sourceFormId) {
  return (await wix.send(buildCloneBookingFormRequest(sourceFormId))).form;
}

// VERIFIED (2026-08-12): POST /bookings/v2/resources/query. Installing Bookings auto-provisions
// one default staff resource named "Business Owner" — its id is what a CLASS/COURSE session's
// `resources[]` must reference (see createCalendarEvent below); there is no way to create a
// session with zero resources.
function buildQueryBookingsResourcesRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/resources/query`, body: { query } };
}
// ONE PAGE, unwrapped to the resources array — see the READ/RETURN CONTRACT note at the top of
// this file.
async function queryBookingsResources(wix, query) {
  return (await wix.send(buildQueryBookingsResourcesRequest(query))).resources || [];
}

// VERIFIED (2026-08-12): POST /bookings/v2/services. Real shape traps found bisecting on a live
// site:
// 1. `payment.options` has no default — omitting it 400s "It is mandatory to specify either
//    payment.options.online or payment.options.inPerson as true", even for a NO_FEE service.
// 2. `service.form` defaults to the all-zero form id when omitted entirely, and THAT default
//    400s "doesn't exist" on a site where Bookings was never installed — see the app-install
//    note above; once installed, omitting `form` resolves to the real auto-provisioned default
//    and needs no explicit id.
// 3. `locations[].type: 'CUSTOM'` accepts a free-text `custom.address.formattedAddress` and
//    `city`; `country` validates as an ISO-3166-1 alpha-2 code (`IL`, not `Israel`) — an
//    unmapped/invalid code is rejected, so callers must convert or omit it, never pass the
//    source's country name through unchecked.
// 4. `defaultCapacity` must be `1` for `type: 'APPOINTMENT'` and `> 1` for `CLASS`/`COURSE`.
function buildCreateBookingsServiceRequest(service, safeModeOptions) {
  const prepared = applySafeModeToRequest({ service }, safeModeOptions);
  return {
    method: 'POST',
    url: `${WIXAPIS}/bookings/v2/services`,
    body: prepared.body,
    ...(prepared.safeMode ? { safeMode: prepared.safeMode } : {}),
  };
}
async function createBookingsService(wix, service, safeModeOptions) {
  return (await wix.send(buildCreateBookingsServiceRequest(service, safeModeOptions))).service;
}
function buildQueryBookingsServicesRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/services/query`, body: { query } };
}
// ONE PAGE, unwrapped to the services array — see the READ/RETURN CONTRACT note at the top of
// this file.
async function queryBookingsServices(wix, query) {
  return (await wix.send(buildQueryBookingsServicesRequest(query))).services || [];
}
function buildDeleteBookingsServiceRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/bookings/v2/services/${encodeURIComponent(id)}` };
}
async function deleteBookingsService(wix, id) {
  return wix.send(buildDeleteBookingsServiceRequest(id));
}

// VERIFIED (2026-08-12): a Bookings Service's one-time (or recurring) date/time is NOT written
// through a dedicated "Bookings session" endpoint at all — it is an ordinary Calendar V3 event
// (`POST /calendar/v3/events`) on the schedule the service auto-created
// (`service.schedule.id` from the Create Service response). Real shape traps:
// 1. `start.localDate` / `end.localDate` are LOCAL date-time strings with NO offset/zone suffix
//    (`2026-09-01T14:00:00`), paired with a separate `timeZone` (IANA tz id) — the same
//    `{seconds,nanos}`/offset-string trap documented for Wix Events applies here too.
// 2. `event.type` must equal the owning service's `type` (e.g. `CLASS`) or the create 400s
//    "type must match the service type".
// 3. A `CLASS`/`COURSE` event additionally 400s "resources must have at least 1 resource for
//    class events" unless `resources: [{ id, permissionRole: 'WRITER' }]` names a real Bookings
//    resource (see queryBookingsResources) — `COMMENTER` is the only other valid
//    `permissionRole`, but it is read-mostly and not appropriate for the owning write.
// `title`, `totalCapacity`, and `location` are inherited from the service/schedule when omitted
// (see the response's `inheritedFields`) — omit them so the session mirrors the service by
// construction instead of risking drift between the two.
function buildCreateCalendarEventRequest(event) {
  return { method: 'POST', url: `${WIXAPIS}/calendar/v3/events`, body: { event } };
}
async function createCalendarEvent(wix, event) {
  return (await wix.send(buildCreateCalendarEventRequest(event))).event;
}
function buildDeleteCalendarEventRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/calendar/v3/events/${encodeURIComponent(id)}` };
}
async function deleteCalendarEvent(wix, id) {
  return wix.send(buildDeleteCalendarEventRequest(id));
}

// Composite provisioning helper: idempotently ensures Bookings is installed and returns the
// default staff resource id every CLASS/COURSE session needs. Cheap enough to call once per run
// (an install-status GET, an install POST only when missing, and a resources GET), but callers
// should still call it once per run rather than once per record.
async function ensureBookingsProvisioned(wix, { siteId } = {}) {
  const installed = await isWixAppInstalled(wix, WIX_BOOKINGS_APP_DEF_ID);
  if (!installed) {
    await installWixApp(wix, { appDefId: WIX_BOOKINGS_APP_DEF_ID, siteId });
  }
  // The default "Business Owner" resource is auto-provisioned as a side effect of the install
  // above, not synchronously guaranteed by the install response — read-after-write race, same
  // shape as createCoupon's query-back retry elsewhere in this file. Only retry right after a
  // fresh install; an already-installed site's resources are stable and querying once is enough.
  let resources = await queryBookingsResources(wix);
  if (!resources.length && !installed) {
    for (let attempt = 0; attempt < 4 && !resources.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      resources = await queryBookingsResources(wix);
    }
  }
  const defaultResource = resources[0];
  return {
    alreadyInstalled: installed,
    defaultResourceId: defaultResource && defaultResource.id,
    formId: DEFAULT_BOOKING_FORM_ID,
  };
}

module.exports = {
  WIXAPIS,
  RICOS_PLUGINS,
  RICOS_HTML_CAP,
  DEFAULT_SAFE_MODE_PHONE_NUMBER,
  SafeModeBlockedError,
  createSafeModeConfig,
  createDryRunConfig,
  normalizeDryRunValue,
  createWixSetupExecutor,
  mockEmailForEntity,
  sanitizeContactFieldsForSafeMode,
  sanitizeWixRequestBody,
  createWixClient,
  buildDirectRestRequest,
  sendDirectRest,
  notifyMissingWriter,
  buildConvertToRicosRequest,
  splitHtmlIntoChunks,
  convertHtmlToRichContent,
  rewriteInlineMedia,
  buildImportMediaRequest,
  importMedia,
  waitUntilFileReady,
  buildCreateCategoryRequest,
  createBlogCategory,
  buildCreateTagRequest,
  createBlogTag,
  listBlogTags,
  buildCreateDraftPostRequest,
  createDraftPost,
  publishDraftPost,
  buildDeleteDraftPostRequest,
  deleteDraftPost,
  BLOG_BULK_CREATE_MAX,
  buildBulkCreateDraftPostsRequest,
  bulkCreateDraftPosts,
  buildInsertItemRequest,
  insertDataItem,
  queryAllDataItems,
  WIX_STORES_APP_ID,
  STORES_TREE_REFERENCE,
  STORES_SUBSCRIPTION_CONTRACT,
  STORES_SUBSCRIPTION_DESCRIPTION_MAX,
  STORES_SUBSCRIPTION_FREQUENCIES,
  normalizeStoresProductV3,
  normalizeStoresProductV3ForCreate,
  normalizeStoresProductMediaItems,
  normalizeStoresProductSubscriptions,
  clampStoresSubscriptionDescription,
  validateStoresProductSubscriptionDetails,
  buildStoresProductMedia,
  buildCreateStoresProductRequest,
  createStoresProduct,
  BULK_PRODUCT_LIMITS,
  storesProductBulkCost,
  buildBulkCreateStoresProductsRequest,
  bulkCreateStoresProductsWithInventory,
  buildQueryStoresProductsRequest,
  queryStoresProducts,
  queryAllStoresProducts,
  buildPatchStoresProductMediaRequest,
  patchStoresProductMedia,
  patchStoresProductMediaVerified,
  buildGetStoresProductWithMediaRequest,
  getStoresProductWithMedia,
  storesProductMediaLanded,
  STORES_MEDIA_INGEST_SETTLE_MS,
  STORES_MEDIA_INGEST_ROUNDS,
  buildPatchStoresProductTagsRequest,
  patchStoresProductTags,
  buildGetStoresProductRequest,
  getStoresProduct,
  buildGetStoresProductBySlugRequest,
  getStoresProductBySlug,
  buildDeleteStoresProductRequest,
  deleteStoresProduct,
  buildPatchStoresProductRequest,
  patchStoresProduct,
  buildQueryStoresCategoriesRequest,
  queryStoresCategories,
  queryAllStoresCategories,
  buildCreateStoresCategoryRequest,
  createStoresCategory,
  buildBulkAddItemToCategoriesRequest,
  bulkAddItemToCategories,
  buildCreateInventoryItemRequest,
  createInventoryItem,
  setProductVariantsInStock,
  reconcileInventory: storesInventory.reconcileInventory,
  normalizeV5Contact,
  contactInfoToV5Contact,
  buildCreateContactRequest,
  createContact,
  CONTACTS_BULK_UPSERT_MAX,
  buildBulkUpsertContactsRequest,
  bulkUpsertContacts,
  buildQueryContactsRequest,
  queryContacts,
  buildGetContactRequest,
  getContact,
  buildUpdateContactRequest,
  updateContact,
  buildFindOrCreateContactExtendedFieldRequest,
  findOrCreateContactExtendedField,
  buildCreateCouponRequest,
  createCoupon,
  buildQueryCouponsRequest,
  queryCoupons, buildQueryCouponsByCodeRequest, queryCouponsByCode, buildDeleteCouponRequest, deleteCoupon, ensureCoupon, WIX_PRICING_PLANS_APP_DEF_ID, PLAN_WRITE_MIN_INTERVAL_MS, buildCreatePlanRequest, createPlan, buildQueryPlansByNameRequest, queryPlansByName, buildGetPlanRequest, getPlan, buildArchivePlanRequest, archivePlan, ensurePlanDefinition,
  buildCreateDiscountRuleRequest,
  createDiscountRule,
  buildQueryDiscountRulesRequest,
  queryDiscountRules,
  buildDeleteDiscountRuleRequest,
  deleteDiscountRule,
  buildCreateTaxGroupRequest,
  createTaxGroup,
  buildQueryTaxGroupsRequest,
  queryTaxGroups,
  buildListDefaultTaxGroupsRequest,
  listDefaultTaxGroups,
  buildDeleteTaxGroupRequest,
  deleteTaxGroup,
  buildListTaxCalculatorsRequest,
  listTaxCalculators,
  resolveManualTaxCalculatorAppId,
  buildCreateTaxRegionRequest,
  createTaxRegion,
  buildQueryTaxRegionsRequest,
  queryTaxRegions,
  buildDeleteTaxRegionRequest,
  deleteTaxRegion,
  buildCreateManualTaxMappingRequest,
  createManualTaxMapping,
  buildQueryManualTaxMappingsRequest,
  queryManualTaxMappings,
  buildDeleteManualTaxMappingRequest,
  deleteManualTaxMapping,
  buildGetTaxSettingsRequest,
  getTaxSettings,
  buildUpsertTaxSettingsRequest,
  upsertTaxSettings,
  buildCreateDeliveryProfileRequest,
  createDeliveryProfile,
  buildGetDeliveryProfileRequest,
  getDeliveryProfile,
  buildQueryDeliveryProfilesRequest,
  queryDeliveryProfiles,
  buildAddDeliveryRegionRequest,
  addDeliveryRegion,
  buildRemoveDeliveryRegionRequest,
  removeDeliveryRegion,
  buildAddDeliveryCarrierRequest,
  addDeliveryCarrier,
  buildRemoveDeliveryCarrierRequest,
  removeDeliveryCarrier,
  buildListInstalledDeliveryCarriersRequest,
  listInstalledDeliveryCarriers,
  resolvePickupAppId,
  buildCreateShippingOptionRequest,
  createShippingOption,
  buildQueryShippingOptionsRequest,
  queryShippingOptions,
  buildUpdateBusinessContactRequest,
  updateBusinessContact,
  buildGetSitePropertiesRequest,
  getSiteProperties,
  PICKUP_LOCATIONS_PUBLIC_BASE,
  PICKUP_LOCATIONS_PROXY_BASE,
  resolvePickupLocationsBase,
  buildCreatePickupLocationRequest,
  createPickupLocation,
  buildGetPickupLocationRequest,
  getPickupLocation,
  buildQueryPickupLocationsRequest,
  queryPickupLocations,
  buildDeletePickupLocationRequest,
  deletePickupLocation,
  buildAddPickupLocationDeliveryRegionRequest,
  addPickupLocationDeliveryRegion,
  buildRemovePickupLocationDeliveryRegionRequest,
  removePickupLocationDeliveryRegion,
  buildCreateOrderRequest,
  createOrder,
  buildBulkCreateCouponsRequest,
  assertBulkCreateCannotLoseFields,
  bulkCreateCoupons,
  buildUpdateCouponRequest,
  updateCouponFields,
  buildGetCouponRequest,
  getCoupon,
  BULK_COUPON_BATCH,
  COUPON_UPDATABLE_FIELDS,
  buildImportOrderRequest,
  importOrder,
  buildQueryOrdersRequest,
  queryOrders,
  buildListOrderTransactionsRequest,
  listOrderTransactions,
  INVOICE_DOWNLOAD_EXPIRY_MINUTES,
  dataExtensionSchema,
  listDataExtensionSchemas,
  createDataExtensionSchema,
  updateDataExtensionSchema,
  provisionExtendedFieldSchema,
  buildGetOrderRequest,
  getOrder,
  buildImportPrivateDocumentRequest,
  INVOICE_MEDIA_FOLDER,
  importPrivateDocument,
  buildGenerateFileDownloadUrlRequest,
  mergeOrderExtendedFields,
  buildUpdateOrderExtendedFieldsRequest,
  updateOrderExtendedFields,
  preserveOrderInvoiceDocument,
  ADD_PAYMENTS_MAX_PER_CALL,
  createTargetReadPacer,
  sharedTargetReadPacer,
  reconcileOrderPaymentTarget,
  writeOrderPayment,
  ORDER_PAYMENTS_MAX_PER_ORDER,
  paymentMapping,
  buildAddOrderPaymentRequest,
  addOrderPayment,
  buildRefundOrderPaymentRequest,
  refundOrderPayment,
  ensureOrderPaymentAndRefund,
  listMembers,
  buildCreateMemberRequest,
  createMember,
  buildGetMemberRequest, getMember, buildQueryMembersByLoginEmailRequest, queryMembersByLoginEmail,
  buildQueryContactsByPhoneRequest, queryContactsByPhone, ensureMember,
  SITE_MUTE_REASON_MAX,
  buildMuteSiteNotificationsRequest,
  muteSiteNotifications,
  buildUnmuteSiteNotificationsRequest,
  unmuteSiteNotifications,
  buildGetSiteMuteStateRequest,
  getSiteMuteState,
  WIX_BOOKINGS_APP_DEF_ID,
  DEFAULT_BOOKING_FORM_ID,
  buildInstallWixAppRequest,
  installWixApp,
  buildGetInstalledWixAppsRequest,
  getInstalledWixApps,
  isWixAppInstalled,
  buildCloneBookingFormRequest,
  cloneBookingForm,
  buildQueryBookingsResourcesRequest,
  queryBookingsResources,
  buildCreateBookingsServiceRequest,
  createBookingsService,
  buildQueryBookingsServicesRequest,
  queryBookingsServices,
  buildDeleteBookingsServiceRequest,
  deleteBookingsService,
  buildCreateCalendarEventRequest,
  createCalendarEvent,
  buildDeleteCalendarEventRequest,
  deleteCalendarEvent,
  ensureBookingsProvisioned,
};
