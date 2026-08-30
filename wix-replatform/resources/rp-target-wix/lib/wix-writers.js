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
const path = require('node:path');
const crypto = require('node:crypto');

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
// header; OAuth access tokens (e.g. a Wix CLI token from `npx @wix/cli token --site …`)
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
  if (url.includes('/ecom/v1/shipping-options/query')) return { type: 'array', field: 'shippingOptions' };
  if (url.includes('/ecom/v1/shipping-options')) return { type: 'object', field: 'shippingOption', idFields: ['id'] };
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
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
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
    if (status === 'FAILED') throw new Error(`media import failed for ${fileId}`);
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null; // caller decides whether to proceed with a still-PENDING file
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
function normalizeStoresProductMediaItems(items = []) {
  return items
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return isPublicHttpUrl(item) ? { url: item } : { id: item };
      }
      if (item.id) return { id: item.id };
      if (item.mediaId) return { id: item.mediaId };
      if (item.url && isPublicHttpUrl(item.url)) return { url: item.url };
      if (item.image?.id) return { id: item.image.id };
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
// assume the response preserves request order — key on originalIndex, and fall back to
// position only when it is absent.
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
  // VERIFIED (2026-07-29) against the BulkCreateProductsWithInventoryResponse schema:
  // TRAP: products-with-inventory nests the per-item results ONE LEVEL DEEPER than its
  // sibling /stores/v3/bulk/products/create. Here they are `productResults.results` +
  // `productResults.bulkActionMetadata`; only `inventoryResults` is top-level. Reading
  // `response.results` yields undefined, which the unaccounted guard correctly reports as a
  // correlation failure AFTER the products have already been created. The flat fallback keeps
  // this tolerant of the sibling envelope.
  const productResults = (response && response.productResults) || {};
  const rawResults = productResults.results || (response && response.results) || [];
  const meta = productResults.bulkActionMetadata || (response && response.bulkActionMetadata) || {};

  const results = rawResults.map((r, position) => {
    const im = (r && r.itemMetadata) || {};
    // originalIndex is authoritative; position is the documented fallback only.
    const index = Number.isInteger(im.originalIndex) ? im.originalIndex : position;
    return {
      index,
      inputProduct: products[index],
      success: im.success === true,
      productId: im.id || (r.item && r.item.id) || null,
      revision: (r.item && r.item.revision) || null,
      product: r.item || null,
      errorCode: im.error && im.error.code ? im.error.code : null,
      errorDescription: im.error && im.error.description ? im.error.description : null,
    };
  });

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const undetailedFailures = meta.undetailedFailures || 0;

  // A result set that does not account for every input is a correlation bug, not a partial
  // success — surface it rather than silently crosswalking the wrong ids.
  const unaccounted = products.length - results.length - undetailedFailures;

  return {
    results,
    succeeded,
    failed,
    totalSuccesses: meta.totalSuccesses !== undefined ? meta.totalSuccesses : succeeded.length,
    totalFailures: meta.totalFailures !== undefined ? meta.totalFailures : failed.length,
    undetailedFailures,
    unaccounted: unaccounted > 0 ? unaccounted : 0,
    inventoryResults: (response && response.inventoryResults) || null,
  };
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

// UNVERIFIED writer (no live run yet). DOCUMENTED endpoint: POST
// /contacts/v5/bulk/contacts/upsert — the CONT-01 import path: 1-100 contacts per call,
// synchronous, per-item results. Contact matching (main email, or main phone when no
// email) decides create vs update, so re-runs upsert instead of duplicating; `externalId`
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
  const rawResults = (response && response.results) || [];
  const meta = (response && response.bulkActionMetadata) || {};
  const results = rawResults.map((r, position) => {
    const im = (r && r.itemMetadata) || {};
    // originalIndex is authoritative; position is the documented fallback only.
    const index = Number.isInteger(im.originalIndex) ? im.originalIndex : position;
    return {
      index,
      inputContact: contacts[index],
      success: im.success === true,
      contactId: im.id || (r.item && r.item.id) || null,
      action: r.action || null, // CREATED | UPDATED
      contact: r.item || null, // populated only with returnEntity: true
      errorCode: im.error && im.error.code ? im.error.code : null,
      errorDescription: im.error && im.error.description ? im.error.description : null,
    };
  });
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const undetailedFailures = meta.undetailedFailures || 0;
  // A result set that does not account for every input is a correlation bug, not a partial
  // success — surface it rather than silently crosswalking the wrong ids.
  const unaccounted = contacts.length - results.length - undetailedFailures;
  return {
    results,
    succeeded,
    failed,
    totalSuccesses: meta.totalSuccesses !== undefined ? meta.totalSuccesses : succeeded.length,
    totalFailures: meta.totalFailures !== undefined ? meta.totalFailures : failed.length,
    undetailedFailures,
    unaccounted: unaccounted > 0 ? unaccounted : 0,
  };
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
// UNVERIFIED: read-only probe showed /stores/v2/coupons/query reaches the Coupons service
// but returned app-not-installed/unauthorized on the target site. The specification must
// contain exactly one coupon type; generated code must decide per source coupon whether
// native Wix Coupons can represent the source coupon exactly. CMS is not a fallback for a
// missing writer; it is only for coupons whose semantics do not fit Wix Coupons.
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
// History: purchasedDate/createdDate/number are settable on import (immutable after).
// Re-runs: sending an existing imported order's `id` fully replaces it; overwriting a
// non-imported order fails with CANNOT_OVERWRITE_NON_IMPORTED_ORDER. Cleanup exists via
// Bulk Delete Imported Orders; live-order numbering continues via Set Order Number Counter.
function buildImportOrderRequest(order, safeModeOptions) {
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
function buildListOrderTransactionsRequest(orderId) {
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/payments/orders/${encodeURIComponent(orderId)}` };
}
async function listOrderTransactions(wix, orderId) {
  return (await wix.send(buildListOrderTransactionsRequest(orderId))).orderTransactions;
}
function buildAddOrderPaymentRequest({ orderId, amount, offlinePayment = true, status = 'APPROVED' }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/payments/orders/${encodeURIComponent(orderId)}/add-payment`,
    body: { payments: [{ regularPaymentDetails: { offlinePayment, status }, amount: { amount: String(amount) } }] },
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
// Convenience wrapper for the historical-refund path: ensures a payment record exists (adding one
// sized to the order total if the order has none yet — Import Order never creates one), then
// refunds the requested amount against it, externally.
async function ensureOrderPaymentAndRefund(wix, { orderId, orderTotal, refundAmount, reason }) {
  const existing = await listOrderTransactions(wix, orderId);
  let paymentId = (existing.payments || []).find((p) => !p.refundDisabled)?.id;
  if (!paymentId) {
    const added = await addOrderPayment(wix, { orderId, amount: orderTotal });
    paymentId = added.paymentId;
  }
  return refundOrderPayment(wix, { orderId, paymentId, amount: refundAmount, reason });
}

// --- Stores inventory (Catalog V3 Inventory Items API) ----------------------
// UNVERIFIED: POST /stores/v3/inventory-items creates one inventory item per variant.
// Inventory items are NOT created automatically when a product is created — a separate
// call is required for each variant (per productId + variantId combination).
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
    ...(typeof inStock === 'boolean' ? { inStock } : {}),
    ...(quantity != null ? { quantity } : {}),
    ...(typeof trackQuantity === 'boolean' ? { trackQuantity } : {}),
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
  queryCoupons,
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
  buildCreateOrderRequest,
  createOrder,
  buildImportOrderRequest,
  importOrder,
  buildQueryOrdersRequest,
  queryOrders,
  buildListOrderTransactionsRequest,
  listOrderTransactions,
  buildAddOrderPaymentRequest,
  addOrderPayment,
  buildRefundOrderPaymentRequest,
  refundOrderPayment,
  ensureOrderPaymentAndRefund,
  listMembers,
  buildCreateMemberRequest,
  createMember,
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
