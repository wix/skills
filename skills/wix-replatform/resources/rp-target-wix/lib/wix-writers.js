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
const { normalizeCmsCollectionDefinition } = require('../../../lib/cms-collection-request.js');
const contactExtendedFields = require('./contact-extended-fields.js');
const invoiceContract = require('./order-invoice-contract.js');
const documentUrlGuard = require('../../../lib/document-url-guard.js');
const { editorTypeFromUrls } = require('../../../lib/editor-type.js');
const approvalStamp = require('../../../lib/preservation-approval-stamp.js');
const pricingPlanDefinition = require('./pricing-plan-definition.js');
const productSeo = require('./product-seo.js');
const seoTags = require('./seo-tags.js');
const dryRunTarget = require('./dry-run-target.js');
const { MEMBER_OUTCOME: MO, MEMBER_FINDING: MF } = require('../../../lib/member-outcome-registry.js');
const { PLAN_ORDER_OUTCOME: PO } = require('../../../lib/plan-order-outcome-registry.js');
const storesInventory = require('./stores-inventory.js');
const confirmedPictures = require('../../../lib/confirmed-pictures.js');

const executionCapability = require('../../../lib/execution-capability');
const { egressFetch } = require('../../../lib/egress-proxy.js');
const wixAuth = require('../../../lib/wix-auth.js');
const cmsItemQuota = require('./cms-item-quota.js');
const requestMarks = new WeakMap();
const responseEvidence = new WeakMap();
const clientReadResponses = new WeakMap();
function rethrowRunStop(error) {
  if (wixAuth.isRunInterruption(error)) throw error;
}
function markRequest(request, mark) {
  requestMarks.set(request, { ...mark, digest: executionCapability.digest(JSON.stringify([request.method, request.url, request.body, request.headers])) });
  return request;
}
function requestMark(request) {
  const mark = requestMarks.get(request);
  return mark && mark.digest === executionCapability.digest(JSON.stringify([request.method, request.url, request.body, request.headers])) ? mark : null;
}

const WIXAPIS = 'https://www.wixapis.com';

const FLAG_TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FLAG_FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function normalizeDryRunValue(value, { defaultValue = false } = {}) {
  if (value == null || String(value).trim() === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (FLAG_TRUE_VALUES.has(normalized)) return true;
  if (FLAG_FALSE_VALUES.has(normalized)) return false;
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

function deepClone(value) {
  if (Array.isArray(value)) return value.map((item) => deepClone(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = deepClone(item);
    return out;
  }
  return value;
}

// Request bodies are copies: a builder never hands the caller's own objects to the send path.
function copyRequestBody(body) {
  return deepClone(body);
}

// --- client ----------------------------------------------------------------
// config: { authToken, siteId }. authToken is an OAuth access token / API key with
// scopes for the selected writers, for example Blog manage, Wix Data collections manage,
// media import, Contacts manage/schema, and Members manage.
//
// Auth scheme normalization: Wix API keys (`IST.…`) are sent RAW in the Authorization
// header; OAuth access tokens (e.g. a Wix CLI token from `npx --no-install wix token --site …`)
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
  if (url.includes('/site-media/v1/files/generate-upload-url')) return { type: 'upload-url', field: 'file' };
  if (url.includes('/site-media/v1/files/') && method === 'GET') return { type: 'object', field: 'file' };
  if (/\/reviews\/v1\/reviews\/[^/?]+(?:\/reply)?(?:\?|$)/.test(url) && (method === 'GET' || method === 'PATCH')) return { type: 'object', field: 'review' };
  if (url.includes('/blog/v3/categories')) return method === 'GET' || url.includes('/query') ? { type: 'array', field: 'categories' } : { type: 'object', field: 'category' };
  if (url.includes('/blog/v3/tags')) return method === 'GET' || url.includes('/query') ? { type: 'array', field: 'tags' } : { type: 'object', field: 'tag' };
  if (url.includes('/tags/v1/tags')) return method === 'GET' || url.includes('/query') ? { type: 'array', field: 'tags' } : { type: 'object', field: 'tag' };
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
  if (url.includes('/editor-platform-installation/v1/install')) return { type: 'array', field: 'results' };
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
  // Generate File Upload URL answers `{ uploadUrl }`. A dry run must still hand the caller a URL
  // and a file id, but nothing is ever uploaded to it (the caller skips the PUT when dry-running).
  if (shape.type === 'upload-url') {
    const id = dryRunPlaceholderId({ ...request, ...context });
    return { uploadUrl: 'https://dry-run.invalid/upload', file: { id, operationStatus: 'PENDING', private: true, _dryRunPlaceholder: true } };
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

// A dry run sends nothing, so it never waits on pacing floors, settle delays, retry backoff or
// ready polls: those exist for the live service, and in a dry run they only stall the pass.
function pauseFor(wix, sleep) {
  if (wix && wix.dryRun === true) return async () => {};
  return typeof sleep === 'function' ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}
async function dryRunSend(request, config, defaultHeaders, capturePhase = null) {
  const method = String(request.method || '').toUpperCase();
  if (!method) throw new Error('wix.send: method is required');
  if (!request.url) throw new Error('wix.send: url is required');
  const headers = { ...defaultHeaders, ...(request.headers || {}) };
  const body = request.body === undefined ? undefined : request.body;
  const issued = executionCapability.inspect(config.capability);
  const runId = issued?.runId || config.runId || 'dry-run';
  const phase = capturePhase || (issued?.kind === 'setup-step' ? 'setup' : issued?.kind?.startsWith('quick') ? 'quick' : 'import');
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
  };
  await defaultCaptureSink(capture, config);
  // Writers that read back what they wrote (events, forms, gift cards, add-ons, bookings, plan
  // orders, labels, member Abouts, SEO) get answers from this dry run's own writes.
  const simulated = request.responseShape ? null : dryRunTarget.respond(request, {
    scope: `${issued?.projectDir || ''}|${config.siteId || ''}|${runId}`,
    placeholderId: () => dryRunPlaceholderId({ runId, entity: request.entity, operation: request.operation, sourceId: request.sourceId, method, url: request.url, body }),
  });
  if (simulated) return { dryRun: true, result: 'dry_run_skipped_wix_call', requestCaptureId, ...simulated };
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

// Synthetic codegen examples capture prepared requests only. This client has no transport,
// live capability, credentials or configurable sink, and cannot be promoted to a live client.
function createWixCaptureClient({ requestCapturePath, runId } = {}) {
  if (!requestCapturePath || !runId) throw new Error('Synthetic capture requires a path and run ID');
  return Object.freeze({dryRun: true, send: request => dryRunSend(request, {requestCapturePath,runId}, {}, 'codegen')});
}

// Only these POSTs are read-only queries used by bounded verification: identity lookups, and the
// Stores inventory read (Get Product V3 returns no variant inventory).
const BOUNDED_READ_QUERY_PATHS = new Set([
  '/members/v1/members/query',
  '/stores/v3/products/query',
  '/stores/v3/inventory-items/query',
  '/stores/v3/locations/query',
]);

function boundedReadTimeout(request) {
  const hasTimeout = Object.prototype.hasOwnProperty.call(request, 'readTimeoutMs');
  const hasReadOnly = Object.prototype.hasOwnProperty.call(request, 'readOnly');
  if (!hasTimeout && !hasReadOnly) return null;
  let queryRead = false;
  try {
    const endpoint = new URL(request.url);
    queryRead = endpoint.origin === WIXAPIS && !endpoint.username && !endpoint.password
      && BOUNDED_READ_QUERY_PATHS.has(endpoint.pathname);
  } catch (_) { /* Not a recognized query endpoint. */ }
  if (request.readOnly !== true || !Number.isFinite(request.readTimeoutMs)
    || request.readTimeoutMs <= 0 || request.readTimeoutMs > 10000
    || !(request.method === 'GET' || (request.method === 'POST' && queryRead))) {
    throw new Error('Bounded reads require readOnly:true and readTimeoutMs in (0,10000] on GET or an allowed lookup query');
  }
  return request.readTimeoutMs;
}

function buildBoundedReadRequest(request, readTimeoutMs = request.readTimeoutMs) {
  const candidate = { ...request, readOnly: true, readTimeoutMs };
  boundedReadTimeout(candidate);
  const endpoint = new URL(candidate.url);
  if (endpoint.origin !== WIXAPIS || endpoint.username || endpoint.password || candidate.method === 'GET' && !/^\/(?:contacts\/v5\/contacts|contacts\/v4\/contacts|members\/v1\/members|stores\/v3\/products|ecom\/v1\/orders|site-media\/v1\/files)\/[^/]+$/.test(endpoint.pathname)) throw new Error('Bounded read endpoint is not registered');
  return markRequest(candidate, { read: true });
}
function sanitizedRetryAfterMs(response, now) {
  let value;
  try { value = response && response.headers && response.headers.get('Retry-After'); }
  catch (_) { return null; }
  if (typeof value !== 'string') return null;
  value = value.trim();
  if (/^\d+$/.test(value)) return Math.min(30000, Number(value) * 1000);
  // Accept HTTP-date's three specified formats, not Date.parse's permissive numeric,
  // ISO, timezone-offset or invalid-calendar extensions.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  let day, month, year, hour, minute, second, weekday;
  if (match) {
    [, weekday, day, month, year, hour, minute, second] = match;
    weekday = shortDays.indexOf(weekday);
  } else {
    match = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
    if (match) {
      [, weekday, day, month, year, hour, minute, second] = match;
      weekday = fullDays.indexOf(weekday);
      const currentYear = new Date(now).getUTCFullYear();
      year = Math.floor(currentYear / 100) * 100 + Number(year);
      if (year > currentYear + 50) year -= 100;
    } else {
      match = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value);
      if (!match) return null;
      [, weekday, month, day, hour, minute, second, year] = match;
      weekday = shortDays.indexOf(weekday);
    }
  }
  const date = new Date(0);
  date.setUTCFullYear(Number(year), months.indexOf(month), Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (!Number.isFinite(now) || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== months.indexOf(month) || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute)
    || date.getUTCSeconds() !== Number(second) || date.getUTCDay() !== weekday) return null;
  return Math.min(30000, Math.max(0, Math.floor(date.getTime() - now)));
}

// Wix refuses a rate-limited request with 429 before processing it (the edge's reply is often an
// HTML page), so sending the same request again is safe, for any API, read or write, single or
// bulk. Every request goes through `send`, so this is the one place it is handled: the client waits
// (Retry-After, else jittered exponential backoff) and sends the same request again. A 429 reaches
// the caller only after `maxRetries` more tries, marked `requestApplied: false`: it is a refusal,
// never an unknown outcome, whether or not its body could be read.
//
// The pacing it learns is per endpoint (site + method + path with ids folded) and shared by every
// client in the process, because Wix limits the site's API, not one client: a 429 widens that
// endpoint's spacing and a Retry-After holds it shut until then; each clean reply narrows it again.
const RATE_LIMIT_POLICY = Object.freeze({ maxRetries: 5, baseMs: 1000, maxMs: 30000, minGapMs: 250, maxGapMs: 2000 });
const endpointPacing = new Map();
function rateLimitEndpoint(siteId, request) {
  let pathname = '';
  try { pathname = new URL(request.url).pathname; } catch { pathname = String(request.url || ''); }
  // An id segment (a GUID, a number, a media id) would make every record its own endpoint.
  const isId = (part) => /^\d+$/.test(part) || /[0-9a-f]{8}-[0-9a-f]{4}/i.test(part) || part.includes('~') || (part.length >= 16 && /\d/.test(part));
  const folded = pathname.split('/').map((part) => isId(part) ? ':id' : part).join('/');
  return `${siteId || ''} ${String(request.method || 'GET').toUpperCase()} ${folded}`;
}
function createRateLimitThrottle({ maxRetries = RATE_LIMIT_POLICY.maxRetries, baseMs = RATE_LIMIT_POLICY.baseMs, maxMs = RATE_LIMIT_POLICY.maxMs, sleep = null, random = Math.random, now = Date.now, pacing = endpointPacing } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stats = { limited: 0, retries: 0, waitMs: 0, endpoints: {} };
  const state = (endpoint) => { if (!pacing.has(endpoint)) pacing.set(endpoint, { gapMs: 0, nextAt: 0 }); return pacing.get(endpoint); };
  return {
    maxRetries,
    stats,
    async pace(endpoint) {
      const pace = pacing.get(endpoint);
      if (!pace || (!pace.gapMs && pace.nextAt <= now())) return;
      const t = now(), start = Math.max(t, pace.nextAt);
      pace.nextAt = start + pace.gapMs;
      if (start > t) { stats.waitMs += start - t; await wait(start - t); }
    },
    passed(endpoint) {
      const pace = pacing.get(endpoint);
      if (!pace) return;
      pace.gapMs = pace.gapMs > 50 ? Math.floor(pace.gapMs * 0.9) : 0;
      if (!pace.gapMs && pace.nextAt <= now()) pacing.delete(endpoint);
    },
    async limited(endpoint, retry, retryAfterMs) {
      const pace = state(endpoint);
      stats.limited += 1; stats.endpoints[endpoint] = (stats.endpoints[endpoint] || 0) + 1;
      pace.gapMs = Math.min(RATE_LIMIT_POLICY.maxGapMs, Math.max(RATE_LIMIT_POLICY.minGapMs, pace.gapMs * 2));
      const backoff = Math.min(maxMs, baseMs * 2 ** retry);
      // Jitter keeps callers that were limited together from retrying together.
      const ms = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs + Math.floor(random() * 250) : Math.floor(backoff / 2 + random() * (backoff / 2));
      // Retry-After is the site's own answer: every caller of this endpoint waits it out.
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) pace.nextAt = Math.max(pace.nextAt, now() + retryAfterMs);
      stats.retries += 1; stats.waitMs += ms;
      await wait(ms);
    },
  };
}

function cmsItemQuotaRefusal(text) {
  try { return cmsItemQuota.isCmsItemQuotaError({ body: JSON.parse(text) }); } catch { return false; }
}

function createWixClient(config) {
  config = config || {};
  if (Object.hasOwn(config, 'runContext') || Object.hasOwn(config, 'phase')) executionCapability.fail('CALLER_PHASE_REFUSED');
  const authority = executionCapability.inspect(config.capability);
  if (config.capability && !authority) executionCapability.fail('EXECUTION_CAPABILITY_REQUIRED');
  if (authority && config.siteId && config.siteId !== authority.siteId) executionCapability.fail('CAPABILITY_SITE_MISMATCH');
  if (authority?.kind === 'import-run') executionCapability.fail('DEPENDENCY_TASK_REQUIRED');
  const dryRun = authority ? authority.dryRun : normalizeDryRunValue(config.dryRun, { defaultValue: false });
  config = {
    ...config,
    dryRun,
    ...(authority ? { siteId: authority.siteId, ...(authority.projectDir ? { projectDir: authority.projectDir } : {}) } : {}),
  };
  // A `tokenSource` (lib/wix-auth.js) renews a short-lived CLI token for this same site.
  // Refresh is opt-in because an explicit `authToken` may come from process.env or a
  // caller-provided --wix-env file rather than this project's config/wix.env. The caller that
  // owns project-config provenance must construct and pass the token source explicitly.
  const tokenSource = config.tokenSource || null;
  if (tokenSource && config.siteId && tokenSource.siteId !== config.siteId) executionCapability.fail('CAPABILITY_SITE_MISMATCH');
  if (!dryRun && !config.authToken && !tokenSource) {
    throw new Error(
      'createWixClient: no Wix write credentials. Provide an OAuth access token / API ' +
        'key with the scopes required by the selected writers. In an autonomous run this ' +
        'is injected at provisioning time.',
    );
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(config.authToken && !tokenSource ? { Authorization: authHeaderValue(config.authToken) } : {}),
    ...(config.siteId ? { 'wix-site-id': config.siteId } : {}),
  };
  const fetchImpl = config.fetch || egressFetch;
  const throttle = createRateLimitThrottle({ ...(config.now ? { now: config.now } : {}), ...(config.rateLimit || {}) });
  const client = {
    dryRun,
    rateLimitStats: throttle.stats,
    async send(request) {
      // Every refusal below happens before any byte leaves: its outcome is known (nothing was
      // sent), so a caller must never record the record as possibly written.
      let mark, readTimeoutMs;
      try {
        if ((authority?.siteId || config.siteId) && Object.entries(request.headers || {}).some(([key, value]) => key.toLowerCase() === 'wix-site-id' && value !== (authority?.siteId || config.siteId))) executionCapability.fail('CAPABILITY_SITE_MISMATCH');
        mark = requestMark(request);
        const phase = authority?.kind?.startsWith('setup') ? 'setup' : authority?.kind === 'import-task' ? 'import' : authority?.kind?.startsWith('quick') ? 'quick' : 'probe';
        if (authority && request.phase && request.phase !== phase) executionCapability.fail('REQUEST_PHASE_MISMATCH');
        if (!mark?.read) {
          if (!authority) executionCapability.fail('EXECUTION_CAPABILITY_REQUIRED');
          if (authority.kind === 'import-task') {
            // An adopt-only task is exempt from write-time dependencies because it writes nothing.
            if (authority.task.adoptOnly === true) executionCapability.fail('ADOPT_ONLY_TASK_WRITE_REFUSED');
            if (!mark?.entity) executionCapability.fail('DEPENDENCY_READINESS_REQUIRED');
            const productTask = authority.task.entityRefs.includes('stores/product');
            if (mark?.entity && !mark.auxiliary && !authority.task.entityRefs.includes(mark.entity)) executionCapability.fail('DEPENDENCY_TASK_MISMATCH');
            if (mark?.partial && !productTask && !authority.task.entityRefs.includes('bookings/service-add-on') || mark?.productMembership && !productTask && !authority.task.entityRefs.includes('stores/category-membership') || mark?.inventoryOperation && !productTask && !authority.task.entityRefs.includes('stores/inventory-item') || mark?.auxiliary && ['ecom/order', 'forms/form-submission', 'stores/back-in-stock-request', 'stores/review'].includes(mark.entity) && !authority.task.entityRefs.includes(mark.entity)) executionCapability.fail('DEPENDENCY_TASK_MISMATCH');
            if (authority.task.entityRefs.includes('stores/product') && /\/stores\/v3\/(?:bulk\/)?inventory-items(?:\/|$)/.test(request.url) && !mark?.inventoryOperation) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            if (mark?.productMembership && authority.task.entityRefs.includes('stores/product') && (!recordProductMatches(client, request, request.body?.item?.catalogItemId) || !require('../../../lib/dependency-readiness').verifyReferenceTargets(request.readinessGrant, authority, request.sourceStableKey, 'stores/category', request.body?.categoryIds))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            if (mark?.partial && authority.task.entityRefs.includes('stores/product') && !recordProductMatches(client, request, mark.productId)) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            // An event's category assignment names only this record's own event and exactly the categories its grant resolved.
            if (mark?.eventCategoryMembership && (!authority.task.entityRefs.includes('events/event') || !Array.isArray(request.body?.eventId) || request.body.eventId.length !== 1 || !recordProductMatches(client, request, request.body.eventId[0], 'events/event') || !require('../../../lib/dependency-readiness').verifyReferenceTargets(request.readinessGrant, authority, request.sourceStableKey, 'events/category', request.body?.categoryId))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            // A bookings add-on group call places this record's own add-on in a service the record was granted;
            // a booking follow-up (confirm, cancel) acts only on this record's own booking.
            if (mark?.addOnGroup && (!authority.task.entityRefs.includes('bookings/service-add-on') || !(request.body?.addOnIds || request.body?.addOnGroup?.addOnIds || []).some(id => recordSawTarget(client, request, 'bookings/service-add-on', id)) || !require('../../../lib/dependency-readiness').verifyReferenceMember(request.readinessGrant, authority, request.sourceStableKey, 'bookings/service', request.body?.serviceId))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            // A merchant reply goes only on this record's own review.
            if (mark?.reviewReply !== undefined && (!authority.task.entityRefs.includes('stores/review') || decodeURIComponent(new URL(request.url).pathname.split('/')[4] || '') !== mark.reviewReply || !recordOwnReview(client, request, mark.reviewReply))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            if (mark?.bookingFollowUp && (!authority.task.entityRefs.includes('bookings/booking') || !recordSawTarget(client, request, 'bookings/booking', decodeURIComponent(new URL(request.url).pathname.split('/')[4] || '')))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            // A site-tags PATCH is a partial write (fieldMask tags); an og:image in it is the site's own or this record's granted image.
            if (mark?.entity === 'seo/site-seo-tags' && (!mark.siteTags || !siteShareImageAdmitted(client, request, mark, authority, dryRun))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            if (mark?.entity === 'stores/inventory-item' && authority.task.entityRefs.includes('stores/product')) validateImportInventoryWrite(client, request, mark);
            if (mark?.planOrderId !== undefined && !recordPlanOrderMatches(client, request, mark.planOrderId)) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            // A member's own contact, updated from the member task: only the contact of the member
            // this record created (or already owns), as named by that member's own response.
            if (mark?.memberContact && (!authority.task.entityRefs.includes('members/member') || !recordMemberContactMatches(client, request, decodeURIComponent(new URL(request.url).pathname.split('/')[4] || '')))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            if (request.entity && !authority.task.entityRefs.includes(request.entity) && !(mark?.inventoryOperation && authority.task.entityRefs.includes('stores/product'))) executionCapability.fail('DEPENDENCY_TASK_MISMATCH');
            const gate = require('../../../lib/dependency-readiness'), gateOptions = { auxiliary: mark?.auxiliary === true, partial: mark?.partial === true || mark?.siteTags === true };
            // A bulk request names one source key per item; each item is checked against its own key.
            if (request.sourceStableKeys !== undefined ? !gate.verifyBulkGrant(request.readinessGrant, authority, request.sourceStableKeys, request, gateOptions) : !gate.verifyGrant(request.readinessGrant, authority, request.sourceStableKey, request, gateOptions)) executionCapability.fail('DEPENDENCY_READINESS_REQUIRED');
          } else if (authority.kind === 'setup-step') {
            if (!mark || !(mark.setupOperation || (authority.step.entityRefs || []).includes(mark.entity))) executionCapability.fail('SETUP_WRITE_OUT_OF_STEP');
          } else if (authority.kind === 'quick-entity') {
            if (!mark || !(mark.entity === authority.target || authority.auxiliaryTargets.includes(mark.entity))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
            if (mark.entity === 'stores/inventory-item') validateQuickInventoryWrite(client, request, mark);
          } else if (authority.kind === 'quick-setup') {
            if (mark?.setupOperation !== authority.operation) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
          } else if (authority.kind !== 'dev-probe') executionCapability.fail('EXECUTION_CAPABILITY_REQUIRED');
        }
        readTimeoutMs = boundedReadTimeout(request);
      } catch (e) {
        if (e && typeof e === 'object') e.requestSent = false;
        throw e;
      }
      // A response is evidence of what this record wrote or read: follow-up checks (a booking's
      // confirm, an add-on's group, a plan order's pause, an event's categories) look for it.
      // A dry-run placeholder is recorded the same way, so a dry run takes the live path.
      const keepEvidence = (json, siteId) => {
        const receivedAt = new Date().toISOString();
        responseEvidence.set(json, { client, request, mark, siteId, receivedAt, digest: executionCapability.digest(JSON.stringify(json)) });
        for (const value of Object.values(json)) if (value && typeof value === 'object') responseEvidence.set(value, { client, request, mark, siteId, receivedAt, digest: executionCapability.digest(JSON.stringify(value)) });
        if (mark?.read) { if (!clientReadResponses.has(client)) clientReadResponses.set(client, []); clientReadResponses.get(client).push(json); }
        if ((['stores/product', 'bookings/service-add-on', 'bookings/booking', 'pricing-plans/plan-order'].includes(mark?.entity) || ['events/event', 'members/member'].includes(mark?.entity) && !mark.auxiliary) && !mark.read) { if (!clientReadResponses.has(client)) clientReadResponses.set(client, []); clientReadResponses.get(client).push(json); }
        recordInventoryResponse(client, json, mark, request);
      };
      if (dryRun) {
        const json = await dryRunSend(request, config, headers);
        if (authority?.kind === 'import-task' && json && typeof json === 'object') keepEvidence(json, { ...headers, ...(request.headers || {}) }['wix-site-id']);
        return json;
      }
      // A CMS item create spends the site's plan-wide item quota. While the shared hold
      // is open it is refused here, before sending (typed `quotaHold`); every other write passes.
      const quotaGate = cmsItemQuota.consumesItemQuota(request)
        ? cmsItemQuota.quotaGate({ projectDir: authority?.projectDir || config.projectDir || null, siteId: authority?.siteId || config.siteId || null, ...(config.now ? { now: config.now } : {}) })
        : null;
      if (quotaGate) await quotaGate.admit({ request, readUsage: () => cmsItemQuota.readCmsItemQuota(client, { consistentRead: true, ...(config.now ? { now: config.now } : {}) }) });
      const { method, url, body } = request;
      if (tokenSource?.interruption) throw tokenSource.interruption;
      let sentToken = null;
      const authorized = async () => {
        if (!tokenSource) return {};
        sentToken = await tokenSource.current();
        return { Authorization: authHeaderValue(sentToken) };
      };
      let requestHeaders = { ...headers, ...(await authorized()), ...(request.headers || {}) };
      // A REJECTED write and a write of UNKNOWN outcome are different results, and the reply is
      // read in that order: status first, parse second. Parsing first is what produced a bare
      // `SyntaxError: Unexpected token '<'` whenever a gateway or protection layer answered ahead
      // of the service with an HTML error page -- no status, no body, nothing naming which system
      // replied. A caller cannot tell "the target refused this" from "nobody knows whether this
      // was applied", and recording the second as the first is how a record lands on a live site
      // that no later pass can see.
      const exchange = async () => {
        let res = null;
        let text = null;
        let retryAfterMs = null;
        let timer;
        let expired = false;
        const controller = readTimeoutMs === null ? null : new AbortController();
        try {
          const consume = async () => {
            const response = await fetchImpl(url, {
              method, headers: requestHeaders, body: body ? JSON.stringify(body) : undefined,
              ...(controller ? { signal: controller.signal } : {}),
            });
            // An abort-ignoring transport may finish later. It cannot publish a response
            // after the caller's deadline, nor should its late body be consumed.
            if (expired) return undefined;
            res = response;
            if (!res.ok) retryAfterMs = sanitizedRetryAfterMs(res, (config.now || Date.now)());
            return res.text();
          };
          if (controller) {
            const deadline = new Promise((resolve, reject) => {
              timer = setTimeout(() => {
                expired = true;
                controller.abort();
                reject(Object.assign(new Error('Wix read timed out'), { readTimedOut: true }));
              }, readTimeoutMs);
            });
            text = await Promise.race([consume(), deadline]);
          } else {
            text = await consume();
          }
        } catch (transportError) {
          // Headers may already have arrived; preserve their status/retry metadata even
          // when consuming the body failed. A timeout never proves a write refusal.
          throw Object.assign(
            transportError instanceof Error ? transportError : new Error(String(transportError)),
            { status: res ? res.status : null, body: null, outcomeKnown: false, retryAfterMs },
          );
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
        return { res, text, retryAfterMs };
      };
      // An expired token is refused before the service sees the request, so the same request is
      // sent once more with a renewed token; a second refusal interrupts the run instead of
      // becoming the record's outcome. The refusal is judged against the token that was SENT,
      // and a refusal whose body could not be read is still a refusal (its status arrived).
      const expiryRefusal = (status) => Boolean(tokenSource) && tokenSource.isExpiryRefusal(status, sentToken);
      const attempt = async () => {
        try {
          const exchanged = await exchange();
          return exchanged.res.ok || !expiryRefusal(exchanged.res.status) ? exchanged : { refusedStatus: exchanged.res.status };
        } catch (error) {
          if (expiryRefusal(error.status)) return { refusedStatus: error.status };
          throw error;
        }
      };
      const sendOnce = async () => {
        await throttle.pace(endpoint);
        let exchanged = await attempt();
        if (exchanged.refusedStatus !== undefined) {
          // Another request may already have renewed the token this one was sent with.
          if (!tokenSource.replaced(sentToken)) await tokenSource.renew();
          requestHeaders = { ...headers, ...(await authorized()), ...(request.headers || {}) };
          exchanged = await attempt();
          if (exchanged.refusedStatus !== undefined) throw tokenSource.fail('still_rejected', { httpStatus: exchanged.refusedStatus });
        }
        return exchanged;
      };
      const endpoint = rateLimitEndpoint(config.siteId, request);
      let exchanged;
      for (let retry = 0; ; retry += 1) {
        let limitedAfterMs;
        try {
          exchanged = await sendOnce();
          if (exchanged.res.status !== 429) { throttle.passed(endpoint); break; }
          // The CMS item quota (WDE0195) also answers 429, but waiting never frees it: it goes
          // straight to the quota hold below, and the endpoint's pacing is left alone.
          if (quotaGate && cmsItemQuotaRefusal(exchanged.text)) break;
          limitedAfterMs = exchanged.retryAfterMs;
        } catch (error) {
          // A 429 whose body could not be read is still a 429; a timeout is not.
          if (!(error && error.status === 429 && !error.readTimedOut)) throw error;
          if (retry >= throttle.maxRetries) throw Object.assign(error, { requestApplied: false });
          exchanged = null;
          limitedAfterMs = error.retryAfterMs;
        }
        if (retry >= throttle.maxRetries) break;
        await throttle.limited(endpoint, retry, limitedAfterMs);
      }
      const { res, text, retryAfterMs } = exchanged;
      let json = null;
      let parsed = true;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (parseError) {
          parsed = false;
          json = null;
        }
      }
      // An empty body on a 2xx is NOT unparseable -- several Wix deletes answer exactly that way.
      if (!res.ok) {
        // The message is truncated for readability, so anything that needs to DECIDE on an error
        // must not parse it. Attach the status and the parsed body: a caller distinguishing a
        // transient refusal from a permanent one was reading a 400-character prefix, which fails
        // silently the day the provider reorders its own JSON.
        const refusal = Object.assign(new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`), {
          status: res.status,
          retryAfterMs,
          // Wix refuses a 429 before processing it, even when the edge's reply is an HTML page.
          ...(res.status === 429 ? { requestApplied: false } : {}),
          body: json,
          // A rejection we could read is a DECISION the target made and stands behind. One we
          // could not read is an open question, and the report has to say so.
          outcomeKnown: parsed,
          ...(parsed ? {} : { rawBody: text.slice(0, 400) }),
          applicationErrorCode: json && json.details && json.details.applicationError && json.details.applicationError.code,
          nonRefundableReason: json && json.details && json.details.applicationError
            && json.details.applicationError.data && json.details.applicationError.data.nonRefundableReason,
        });
        // WDE0195 is the item quota, not a rate limit: open the shared hold and type the refusal
        // so the caller journals a deferral (or the operator's recorded skip). Nothing was written.
        if (quotaGate && cmsItemQuota.isCmsItemQuotaError(refusal)) {
          quotaGate.opened({ request, error: refusal });
          Object.assign(refusal, quotaGate.refusalFields(request));
        }
        throw refusal;
      }
      if (!parsed) {
        // A 2xx whose body does not parse usually means the request never reached the service at
        // all. Returning `null` here is how an unwritten record becomes a written one in the
        // report, so it throws -- carrying the status and the unknown-outcome marker.
        throw Object.assign(new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`), {
          status: res.status,
          body: null,
          rawBody: text.slice(0, 400),
          outcomeKnown: false,
        });
      }
      if (quotaGate) quotaGate.passed(request);
      if (json && typeof json === 'object') keepEvidence(json, requestHeaders['wix-site-id']);
      return json;
    },
  };
  // A guarded raw request is sent only by an import task, re-checked on the outgoing
  // request, and journaled around the send. A `started` row with no outcome is an unknown outcome
  // that is never retried automatically; the normal task and grant checks still run.
  // The checks, the journal and the send all use one private snapshot taken here: a caller that
  // edits its request object after calling send cannot change what is sent.
  const transmit = client.send;
  client.send = async function send(input) {
    const mark = requestMark(input);
    if (!mark?.raw) return transmit(input);
    const request = { ...input, ...(input.headers ? { headers: { ...input.headers } } : {}),
      ...(input.body !== undefined ? { body: JSON.parse(JSON.stringify(input.body)) } : {}),
      ...(Array.isArray(input.sourceStableKeys) ? { sourceStableKeys: [...input.sourceStableKeys] } : {}) };
    markRequest(request, mark);
    try {
      if (authority?.kind !== 'import-task') executionCapability.fail('RAW_REQUEST_REFUSED');
      rawGuard().assertAllowed({ entityRef: mark.entity, method: request.method, url: request.url, body: request.body });
      if (!dryRun) rawGuard().assertWritable(authority, mark.entity, request);
    } catch (e) {
      if (e && typeof e === 'object') e.requestSent = false;
      throw e;
    }
    if (dryRun) return transmit(request);
    const callId = rawGuard().journalStarted(authority, mark.entity, request);
    try {
      const json = await transmit(request);
      rawGuard().journalOutcome(authority, callId, mark.entity, 'succeeded');
      return json;
    } catch (e) {
      // An auth interruption or a stop request says the request was never applied.
      if (e?.requestSent === false || e?.requestApplied === false) rawGuard().journalOutcome(authority, callId, mark.entity, 'refused', { code: e.code || null });
      else if (e?.outcomeKnown === true) rawGuard().journalOutcome(authority, callId, mark.entity, 'failed', { httpStatus: e.status ?? null });
      throw e;
    }
  };
  executionCapability.registerClient(client, config.capability);
  return client;
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
  const authority = config.wixClient ? executionCapability.clientContext(config.wixClient) : executionCapability.inspect(config.capability);
  if (!authority || authority.kind !== 'setup-step') executionCapability.fail('EXECUTION_CAPABILITY_REQUIRED');
  const wixClient = config.wixClient || createWixClient(config);
  return { async executeSetupStep(step) {
    if (!step || step.id !== authority.stepId) executionCapability.fail('SETUP_WRITE_OUT_OF_STEP');
    const intent = authority.step.intent;
    if (!intent) executionCapability.fail('SETUP_WRITE_OUT_OF_STEP');
    // Generated setup must use a reviewed registered writer, never an arbitrary REST intent.
    const writer = module.exports[intent.writerId];
    if (typeof writer !== 'function' || !/^build/.test(intent.writerId || '')) executionCapability.fail('SETUP_WRITE_OUT_OF_STEP');
    const response = await wixClient.send(writer(...(intent.args || [])));
    return authority.dryRun ? { dryRun: true, status: 'planned_dry_run', stepId: step.id, intent, requestCaptureId: response.requestCaptureId, result: response.result } : response;
  } };
}

// --- direct REST (dev probes only) -----------------------------------------
// These requests carry no request mark, so an import, setup or quick client refuses them as
// writes. They exist for dev-probe capabilities only. A native entity with no
// reviewed writer here uses the guarded raw requests below, never a direct-REST import.
function buildDirectRestRequest({ method, path, url, body }) {
  if (!method) throw new Error('buildDirectRestRequest: method is required');
  if (!path && !url) throw new Error('buildDirectRestRequest: path or url is required');
  return {
    method,
    url: url || `${WIXAPIS}${path.startsWith('/') ? path : `/${path}`}`,
    body: copyRequestBody(body),
  };
}
async function sendDirectRest(wix, request) {
  return wix.send(buildDirectRestRequest(request));
}
// --- guarded raw requests ---------------------------------------
// A native entity with no reviewed writer here is written by raw requests the agent shapes, and
// the import client guards: the task's own entity, POST/PUT/PATCH on www.wixapis.com, never
// DELETE, never another entity's reviewed-writer URL or a toolkit-only service. Each call is
// journaled; the first record is read back (verifyGuardedRawCanary) before any other is written.
// A reviewed writer always wins: an entity that has one cannot be written this way.
const rawGuard = () => require('../../../lib/raw-request-guard');
function buildGuardedRawRequest({ entityRef, method, path, url, body }) {
  const request = buildDirectRestRequest({ method: String(method || '').toUpperCase(), path, url, body });
  rawGuard().assertAllowed({ entityRef, method: request.method, url: request.url, body: request.body });
  return markRequest(request, { entity: entityRef, raw: true });
}
async function sendGuardedRawRequest(wix, request) {
  return wix.send(buildGuardedRawRequest(request));
}
// A GET on www.wixapis.com for a raw-request entity: the canary read-back and lookups.
function buildGuardedRawReadRequest({ entityRef, path, url }) {
  const request = buildDirectRestRequest({ method: 'GET', path, url });
  rawGuard().assertAllowed({ entityRef, method: 'GET', url: request.url }, { read: true });
  return markRequest(request, { read: true });
}
// Records the first record's read-back verdict. `body` is the request body that was sent (the
// journal binds it by digest), `readBack` a response object (or one of its top-level values)
// this client read, unmodified. `sentPath` picks the part of the body to compare, e.g. 'brand'.
// A mismatch holds the entity for the rest of the run (RAW_REQUEST_ENTITY_HELD).
function verifyGuardedRawCanary(wix, { entityRef, sourceStableKey, body, sentPath = null, readBack, ignorePaths = [] }) {
  const base = recordClients.get(wix)?.wix || wix;
  const ctx = executionCapability.clientContext(base);
  if (ctx?.kind !== 'import-task' || !ctx.task.entityRefs.includes(entityRef)) executionCapability.fail('DEPENDENCY_TASK_MISMATCH');
  if (base.dryRun) return { entityRef, sourceStableKey, verdict: 'dry-run', mismatches: [] };
  const evidence = readBack && typeof readBack === 'object' ? responseEvidence.get(readBack) : null;
  if (!evidence?.mark?.read || evidence.client !== base || evidence.digest !== executionCapability.digest(JSON.stringify(readBack))) executionCapability.fail('RAW_REQUEST_CANARY_INVALID');
  return rawGuard().recordCanary(ctx, entityRef, { sourceStableKey, sentBody: body, sentPath, readBack, ignorePaths });
}
const rawRequestSummary = projectDir => rawGuard().summary(projectDir);
const resolveRawRequestOutcome = (projectDir, resolution) => rawGuard().resolveUnknownOutcome(projectDir, resolution);

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
function _buildConvertToRicosRequest(html, plugins = RICOS_PLUGINS) {
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
// empty details) rather than 429. A large bulk create converts one description per product,
// and could die partway with products unwritten; a single call and a small burst succeeded
// moments later, so the condition is transient. Retry with backoff instead of failing the batch.
// A genuine permission 403 still surfaces, just after the attempts are exhausted.
const RICOS_RETRY_DELAYS_MS = [500, 1500, 4000, 9000, 20000];
// Endpoint-specific, and deliberately NOT `isTransientWixError`: the 403 below is this one
// endpoint's observed throttle, while a 403 anywhere else is a real permission failure. Read off
// the STRUCTURED status -- matching the number inside a 400-character body prefix or inside the
// URL is a false positive, and a number the body never prints is a false negative.
const RICOS_RETRY_STATUSES = new Set([403, 429, 500, 502, 503, 504]);
function isRetryableRicosError(err) {
  return RICOS_RETRY_STATUSES.has(Number(err && err.status));
}
async function convertHtmlToRichContent(wix, html, { plugins, mediaBySourceUrl, sleep } = {}) {
  const chunks = splitHtmlIntoChunks(html || '');
  let merged = null;
  for (const chunk of chunks) {
    let document;
    for (let attempt = 0; ; attempt += 1) {
      try {
        ({ document } = await wix.send(buildConvertToRicosRequest(chunk, plugins)));
        break;
      } catch (err) {
        rethrowRunStop(err);
        if (attempt >= RICOS_RETRY_DELAYS_MS.length || !isRetryableRicosError(err)) throw err;
        await pauseFor(wix, sleep)(RICOS_RETRY_DELAYS_MS[attempt]);
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
// so waiting is never needed just to make the reference valid. Poll only when the
// flow reads the descriptor back (dimensions land at READY) or must surface a FAILED
// import before content ships. Unverified for product media / CMS reference fields —
// keep the wait there (README Part 5 item 20). The blog importer IS the second case:
// its failure policy keeps a post pending until every medium is READY, so it settles
// through blog-post-media.js rather than writing on a PENDING id.
function _buildImportMediaRequest({ sourceUrl, displayName, mimeType, mediaType, wpId }) {
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
    const r = await wix.send(markRequest({ method: 'GET', url: `${WIXAPIS}/site-media/v1/files/${fileId}` }, { read: true }));
    const status = r?.file?.operationStatus;
    if (status === 'READY') return r.file;
    if (status === 'FAILED') {
      // Tagged, because the caller has to tell a genuinely failed import from a 429/503 on the
      // way to asking -- one is terminal, the other is worth retrying.
      throw Object.assign(new Error(`media import failed for ${fileId}`), { code: 'MEDIA_IMPORT_FAILED' });
    }
    // A dry-run file never becomes READY: one captured read, then the still-pending answer.
    if (wix.dryRun === true) return null;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null; // caller decides whether to proceed with a still-PENDING file
}

// --- Data Extension Schema transport -------------------
// The decision logic is in data-extension-schema.js and is deliberately pure. This is the thin
// transport around it, plus one orchestrator so the sequence cannot be shortcut: LIST (including
// archived fields, or the collision check is blind) -> PLAN -> send -> RE-READ -> verify.
//
// The re-read is not ceremony. A create or update can report success without producing the field,
// and generated import code must not write a value into a field setup did not verify.
async function listDataExtensionSchemas(wix, { fqdn, namespace, includeArchived = true } = {}) {
  return wix.send(markRequest(dataExtensionSchema.buildListDataExtensionSchemasRequest({ fqdn, namespace, includeArchived }), { read: true }));
}

async function createDataExtensionSchema(wix, payload) {
  return (await wix.send(markRequest(dataExtensionSchema.buildCreateDataExtensionSchemaRequest(payload), { setupOperation: 'provision-extended-fields' }))).dataExtensionSchema;
}

async function updateDataExtensionSchema(wix, payload) {
  return (await wix.send(markRequest(dataExtensionSchema.buildUpdateDataExtensionSchemaRequest(payload), { setupOperation: 'provision-extended-fields' }))).dataExtensionSchema;
}

async function provisionExtendedFieldSchema(wix, { requirement, dryRun = false, approvedBreakingChanges = false, rereadDelayMs = 400 } = {}) {
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

  // An unsupported target (Checkout, Bookings, a nested subrecord), a mixed contact
  // surface, or an intent-level permission error is refused BEFORE any network call, not left to
  // fail live. The planner re-runs the same validation; this just moves it ahead of the List.
  const preflight = dataExtensionSchema.validateDataExtensionSchemaRequirement(requirement);
  if (!preflight.valid) {
    return { action: 'blocked', blocking: preflight.errors, verification: null };
  }

  const target = dataExtensionSchema.SUPPORTED_TARGETS[fqdn];
  const list = async () => {
    try {
      return await listDataExtensionSchemas(wix, { fqdn, namespace });
    } catch (error) {
      rethrowRunStop(error);
      // Contacts V5 is fail-closed, not fallback: the supported-objects table omits contacts, so
      // a refused List is the answer to "does DES accept this FQDN here?". Never retry on V4.
      if (target && target.requiresLiveVerification) {
        throw Object.assign(new Error('contacts-v5 gate'), {
          gate: {
            code: dataExtensionSchema.CONTACTS_V5_UNVERIFIED_CODE,
            detail: `List Data Extension Schemas for ${fqdn} failed (${error && error.status ? `HTTP ${error.status}: ` : ''}${String(error && error.message).slice(0, 200)}); `
              + 'the Contacts V5 DES path is unverified on this site. Wait for it to be verified, or explicitly route the mapping to contactWriteSurface "contacts-v4". No automatic fallback was attempted.',
          },
        });
      }
      throw error;
    }
  };

  let listed;
  try {
    listed = await list();
  } catch (error) {
    if (error && error.gate) return { action: 'blocked', blocking: [error.gate], verification: null };
    throw error;
  }

  // Bounded revision-conflict recovery: each attempt plans against a FRESH list, so a concurrent
  // merchant/app edit is merged in (and breaking-change and budget rules re-checked against it)
  // rather than overwritten by a PUT built from a stale read.
  let existingSchema = null;
  let plan = null;
  let lastConflict = null;
  let written = false;
  for (let attempt = 1; attempt <= dataExtensionSchema.MAX_SCHEMA_WRITE_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      try {
        listed = await list();
      } catch (error) {
        if (error && error.gate) return { action: 'blocked', blocking: [error.gate], verification: null };
        throw error;
      }
    }
    existingSchema = dataExtensionSchema.selectUserFieldsSchema(listed, { fqdn, namespace });
    plan = dataExtensionSchema.planDataExtensionSchemaProvisioning({ requirement, existingSchema, approvedBreakingChanges });
    if (plan.action === 'blocked') {
      return { action: 'blocked', blocking: plan.blocking, verification: null };
    }
    if (plan.action === 'noop') {
      // Already provisioned (possibly by the concurrent write we just lost to): still verify, so a
      // run that changed nothing still records evidence the writers can be checked against.
      const verification = dataExtensionSchema.verifyDataExtensionSchemaFields({ schema: existingSchema, fields: requirement.fields, contractVersion });
      return { action: 'noop', blocking: [], verification, attempts: attempt };
    }
    if (dryRun) {
      return { action: `planned_${plan.action}`, blocking: [], verification: null, request: plan.request };
    }
    try {
      if (plan.action === 'create') {
        await createDataExtensionSchema(wix, { fqdn, namespace, jsonSchema: plan.jsonSchema });
      } else {
        await updateDataExtensionSchema(wix, {
          schemaId: existingSchema.id,
          revision: existingSchema.revision,
          mergedSchema: plan.jsonSchema,
        });
      }
      written = true;
      break;
    } catch (error) {
      // A concurrent create answers 409 too; the re-list then turns it into an update.
      if (!dataExtensionSchema.isRevisionConflict(error)) throw error;
      lastConflict = error;
    }
  }
  if (!written) {
    return {
      action: 'blocked',
      blocking: [{
        code: dataExtensionSchema.CONFLICT_EXHAUSTED_CODE,
        detail: `${dataExtensionSchema.MAX_SCHEMA_WRITE_ATTEMPTS} consecutive ${plan.action} attempts on ${fqdn} ${namespace} were rejected as revision conflicts (last: ${String(lastConflict && lastConflict.message).slice(0, 200)}); nothing was overwritten`,
      }],
      verification: null,
    };
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
    if (attempt < 5 && rereadDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, rereadDelayMs * attempt));
  }
  if (!verification.passed) {
    return {
      action: plan.action,
      blocking: [{
        code: 'extended-field-not-verified-after-write',
        detail: `the ${plan.action} reported success but these fields are absent or wrong on re-read: ${[...verification.missing, ...verification.mismatched.map((m) => m.key)].join(', ')}`,
      }],
      verification,
    };
  }
  return { action: plan.action, blocking: [], verification };
}

// Legacy Contacts V4 path: Find Or Create each field by display name, then READ IT
// BACK by the returned key and verify key, namespace and type. Only reached for a requirement that
// explicitly chose `contactWriteSurface: "contacts-v4"`; never tried as a V5 fallback, and it
// never writes anything under `extendedFields.namespaces`.
async function provisionContactExtendedFields(wix, { requirement, dryRun = false, priorVerification = null } = {}) {
  const validation = contactExtendedFields.validateContactExtendedFieldRequirement(requirement);
  if (!validation.valid) return { action: 'blocked', blocking: validation.errors, verification: null };
  const contractVersion = contactExtendedFields.contactExtendedFieldContractVersion(requirement);
  if (requirement.contractVersion && requirement.contractVersion !== contractVersion) {
    return {
      action: 'blocked',
      blocking: [{ code: 'requirement-stamp-mismatch', detail: `the requirement is stamped ${requirement.contractVersion} but its fields hash to ${contractVersion}; it was edited after it was stamped` }],
      verification: null,
    };
  }
  if (dryRun) {
    return {
      action: 'planned_find_or_create',
      blocking: [],
      verification: null,
      requests: requirement.fields.map((field) => contactExtendedFields.buildFindOrCreateContactExtendedFieldRequest(field)),
    };
  }
  const priorKeys = contactExtendedFields.priorContactFieldKeys(priorVerification);
  const verified = [];
  const missing = [];
  const mismatched = [];
  let created = 0;
  for (const field of requirement.fields) {
    const identity = contactExtendedFields.contactFieldIdentity(field);
    const found = contactExtendedFields.normalizeContactExtendedFieldResult(
      await wix.send(markRequest(contactExtendedFields.buildFindOrCreateContactExtendedFieldRequest(field), { setupOperation: 'provision-extended-fields' })),
    );
    const foundDifference = contactExtendedFields.describeContactFieldMismatch(field, found, { priorKey: priorKeys.get(identity) || null });
    if (foundDifference) {
      mismatched.push({ key: (found && found.key) || field.displayName, difference: foundDifference });
      continue;
    }
    if (found.newField === true) created += 1;
    let reread = null;
    try {
      reread = contactExtendedFields.normalizeContactExtendedFieldResult(
        await wix.send(markRequest(contactExtendedFields.buildGetContactExtendedFieldRequest({ key: found.key }), { read: true })),
      );
    } catch (error) {
      rethrowRunStop(error);
      if (!error || error.status !== 404) throw error;
    }
    if (!reread || !reread.key) {
      missing.push(found.key);
      continue;
    }
    const rereadDifference = contactExtendedFields.describeContactFieldMismatch(field, reread, { priorKey: found.key });
    if (rereadDifference) {
      mismatched.push({ key: found.key, difference: rereadDifference });
      continue;
    }
    verified.push({
      key: reread.key,
      displayName: field.displayName,
      dataType: reread.dataType,
      namespace: reread.namespace,
      writePath: contactExtendedFields.contactFieldWritePath(reread.key),
    });
  }
  const passed = missing.length === 0 && mismatched.length === 0;
  const verification = {
    schemaKind: contactExtendedFields.SCHEMA_KIND,
    contactWriteSurface: contactExtendedFields.CONTACT_WRITE_SURFACE,
    verified,
    missing,
    mismatched,
    passed,
    evidence: { api: 'Contacts Extended Fields V4', verifiedAt: null },
    contractVersion,
  };
  const action = created > 0 ? 'create' : 'noop';
  if (!passed) {
    return {
      action,
      blocking: [{
        code: missing.length > 0 ? 'extended-field-not-verified-after-write' : 'contact-extended-field-mismatch',
        detail: [
          missing.length > 0 ? `Find Or Create returned these keys but a read-back does not find them: ${missing.join(', ')}` : null,
          ...mismatched.map((m) => `${m.key}: ${m.difference}`),
        ].filter(Boolean).join('; '),
      }],
      verification,
    };
  }
  return { action, blocking: [], verification };
}

// One entry point so a requirement is routed by its own declared surface: data-extension-schema
// (orders, products, contacts-v5) or crm-contact-extended-field (contacts-v4). Neither route is
// attempted for the other's requirement, and there is no fallback between them.
async function provisionExtendedFieldRequirement(wix, { requirement, ...options } = {}) {
  if (requirement && requirement.schemaKind === contactExtendedFields.SCHEMA_KIND) {
    return provisionContactExtendedFields(wix, { requirement, dryRun: options.dryRun, priorVerification: options.priorVerification });
  }
  return provisionExtendedFieldSchema(wix, { requirement, ...options });
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

function _buildImportPrivateDocumentRequest({ sourceUrl, invoiceNumber, orderId }) {
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
      // Which makes where they land a real decision: importing to `media-root` can drop thousands of
      // PDFs into the library the merchant keeps their own photos in. `filePath` creates the
      // folder if it does not exist.
      filePath: INVOICE_MEDIA_FOLDER,
      displayName,
    },
  };
}

// NOT used by the invoice flow: `files/import` makes Wix fetch the URL server-side. Untrusted
// source-site URLs go through `uploadPrivateDocument` below instead.
async function importPrivateDocument(wix, payload) {
  const { file } = await wix.send(buildImportPrivateDocumentRequest(payload));
  // Deliberately narrow: the descriptor carries sourceUrl and must not be handed on or stored.
  return { fileId: file && file.id, operationStatus: file && file.operationStatus, private: file && file.private };
}

// WHY THIS DOES NOT USE Media's `files/import`: that call makes Wix fetch the URL server-side, and
// the URL here comes from source-site metadata. A public hostname that rebinds or redirects to an
// internal address would be fetched from inside Wix's network, and nothing we check on our side
// can bound a request we do not make. So WE fetch the bytes (`fetchPublicDocument`: resolved
// address pinned, every redirect hop re-validated, size capped) and upload them through Media's
// fixed upload endpoint. Wix never receives the URL.
//
// `wix.fetchDocumentBytes` and `wix.putUpload` let a caller that owns the network (an offline test)
// stand in for the fetch and the signed-URL PUT; production never sets them.
const INVOICE_UPLOAD_MIME_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/html': 'html',
});

function _buildGenerateUploadUrlRequest({ mimeType, fileName, sizeInBytes }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/site-media/v1/files/generate-upload-url`,
    body: {
      mimeType,
      fileName,
      sizeInBytes: String(sizeInBytes),
      private: true,
      filePath: INVOICE_MEDIA_FOLDER,
    },
  };
}

async function defaultPutUpload(uploadUrl, bytes, { mimeType, fileName }) {
  const target = new URL(uploadUrl);
  target.searchParams.set('filename', fileName);
  const response = await egressFetch(target, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: bytes });
  if (!response.ok) throw new Error(`document upload failed with HTTP ${response.status}`);
  return response.json();
}

async function uploadPrivateDocument(wix, { sourceUrl, invoiceNumber, orderId }) {
  if (!sourceUrl) throw new Error('importing a private document needs its source url');
  const baseName = invoiceNumber
    ? `Source invoice ${String(invoiceNumber).slice(0, 64)}`
    : `Source invoice for order ${String(orderId || 'unknown').slice(0, 64)}`;
  // A dry run makes no network call of any kind: no fetch of the source document, no upload. It
  // still records the request it would send so the plan shows the upload.
  if (wix && wix.dryRun) {
    const planned = await wix.send(buildGenerateUploadUrlRequest({ mimeType: 'application/pdf', fileName: `${baseName}.pdf`, sizeInBytes: 0 }));
    const file = planned && planned.file;
    return { fileId: file && file.id, operationStatus: file && file.operationStatus, private: true, dryRun: true };
  }
  const fetchBytes = (wix && wix.fetchDocumentBytes) || documentUrlGuard.fetchPublicDocument;
  const document = await fetchBytes(sourceUrl);
  if (!document || !document.ok) {
    return { refused: { unsafe: Boolean(document && document.unsafe), reason: (document && document.reason) || 'document-fetch-failed' } };
  }
  // A PDF served as octet-stream is still a PDF; anything else must name a type we preserve.
  let mimeType = document.contentType;
  if ((!mimeType || mimeType === 'application/octet-stream') && document.bytes.subarray(0, 4).toString('latin1') === '%PDF') mimeType = 'application/pdf';
  const extension = INVOICE_UPLOAD_MIME_TYPES[mimeType];
  if (!extension) return { refused: { unsafe: false, reason: 'unsupported-document-type' } };
  // Neutral, derived name only: never the source filename.
  const fileName = `${baseName}.${extension}`;
  const generated = await wix.send(buildGenerateUploadUrlRequest({ mimeType, fileName, sizeInBytes: document.bytes.length }));
  if (!generated || !generated.uploadUrl) throw new Error('Media did not return an upload url');
  const put = (wix && wix.putUpload) || defaultPutUpload;
  const uploaded = await put(generated.uploadUrl, document.bytes, { mimeType, fileName });
  const file = uploaded && uploaded.file;
  // Deliberately narrow, like importPrivateDocument: nothing derived from the source URL is kept.
  return { fileId: file && file.id, operationStatus: file && file.operationStatus, private: file && file.private };
}

function _buildGenerateFileDownloadUrlRequest({ fileId, expirationInMinutes = INVOICE_DOWNLOAD_EXPIRY_MINUTES, contentDisposition = 'ATTACHMENT' }) {
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

function _buildUpdateOrderExtendedFieldsRequest({ orderId, currentExtendedFields = null, namespace = '_user_fields', values = {} }) {
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

// VERIFIED LIVE 2026-08-16 (ecom/order-merchant-note): POST /ecom/v1/orders/{orderId}/activities/add
// created a MERCHANT_COMMENT that Get Order returned verbatim. One order per request, up to 300
// activities, message 1-5000 chars. Wix stamps createdDate and authorEmail (the token holder) at
// call time; the caller carries source author/date in the message text. `orderId` is sent in the
// body as well as the path (as the docs example does) so the readiness grant checks the granted
// order target at send time. Not idempotent: after an unknown outcome, read the order back and
// match MERCHANT_COMMENT messages before resending.
const ORDER_MERCHANT_NOTES_MAX_PER_CALL = 300;
const ORDER_MERCHANT_NOTE_MAX_LENGTH = 5000;
function _buildAddOrderMerchantNotesRequest({ orderId, messages }) {
  if (!orderId) throw new Error('adding order merchant notes needs the order id');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('adding order merchant notes needs at least one message');
  if (messages.length > ORDER_MERCHANT_NOTES_MAX_PER_CALL) throw new Error(`adding order merchant notes takes at most ${ORDER_MERCHANT_NOTES_MAX_PER_CALL} messages per order call`);
  for (const message of messages) {
    // Truncation or splitting is a mapping decision recorded in the ledger, never done here.
    if (typeof message !== 'string' || message.trim() === '') throw new Error('an order merchant note must be a non-empty string');
    if (message.length > ORDER_MERCHANT_NOTE_MAX_LENGTH) throw new Error(`an order merchant note must be at most ${ORDER_MERCHANT_NOTE_MAX_LENGTH} characters`);
  }
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/orders/${encodeURIComponent(orderId)}/activities/add`,
    body: { orderId, orderActivities: messages.map(message => ({ activityType: 'MERCHANT_COMMENT', merchantComment: { message } })) },
  };
}
async function addOrderMerchantNotes(wix, payload) {
  return (await wix.send(buildAddOrderMerchantNotesRequest(payload))).activityIds || [];
}

function _buildGetOrderRequest(orderId) {
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
  let overLengthNumber = null;
  const writePaths = invoiceContract.writePaths(namespace);
  const allowed = dataExtensionSchema.validateExtendedFieldWriterReferences({ writePaths, setupVerification, contractVersion: invoiceContract.version() });
  if (!allowed.valid) {
    return { outcome: 'invoice-fields-not-provisioned', fileId: null, imported: false, errors: allowed.errors };
  }

  // The number and the link are decided BEFORE the order is read, so an order that is already
  // preserved still reports what could never be stored on it: a rerun or a resume returns early
  // below, and reporting zero there would hide a number that is still missing.
  const values = {};
  if (invoiceNumber) {
    // NEVER truncate the legal identifier either. LIVE-VERIFIED 2026-10-27: Update Order answers
    // 200 and silently DROPS a value longer than the field's maxLength, so an unchecked number
    // vanished from the order while this writer reported it preserved. Over-length is reported and
    // the field left unset; the file and the link are still written.
    const number = String(invoiceNumber);
    const cap = invoiceContract.maxLengthFor('number');
    if (number.length <= cap) values[invoiceContract.ROLES.number] = number;
    else overLengthNumber = { length: number.length, limit: cap };
  }
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

  const findings = [];
  if (overLengthUrl) findings.push({ code: 'invoice-link-over-length', ...overLengthUrl });
  if (overLengthNumber) findings.push({ code: 'invoice-number-over-length', ...overLengthNumber });
  const withFindings = (result) => (findings.length ? { ...result, findings } : result);

  // READ THE ORDER HERE, rather than trusting a caller-supplied copy. A stale copy is what makes
  // a second import of the same tax document possible, and patching a stale `extendedFields`
  // back would overwrite whatever landed in it since. This read is also what makes re-run safety
  // independent of the migration crosswalk.
  const order = await getOrder(wix, orderId);
  const fields = (order && order.extendedFields && order.extendedFields.namespaces && order.extendedFields.namespaces[namespace]) || {};
  const existingFileId = fields.replatformSourceInvoiceFileId;

  if (existingFileId) {
    return withFindings({ outcome: 'invoice-already-preserved', fileId: existingFileId, imported: false });
  }

  let fileId = null;
  if (sourceUrl) {
    // A previous run may have left an import in flight. Resuming it is the difference between
    // finishing that import and creating another private orphan on every retry.
    const imported = pendingMediaFileId
      ? { fileId: pendingMediaFileId, operationStatus: 'PENDING' }
      : await uploadPrivateDocument(wix, { sourceUrl, invoiceNumber, orderId });
    if (imported.refused) {
      return withFindings({
        outcome: imported.refused.unsafe ? 'invoice-document-url-unsafe' : 'invoice-import-failed',
        fileId: null,
        imported: false,
        reason: imported.refused.reason,
        redactedUrl: documentUrlGuard.redactUrlForLog(sourceUrl),
      });
    }
    if (!imported.fileId) {
      // No file id means nothing to record. The raw url is NOT stored as a consolation.
      return withFindings({ outcome: 'invoice-import-failed', fileId: null, imported: false });
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
        rethrowRunStop(error);
        // Only a tagged failure is terminal. A transport fault means we do not know yet, and
        // calling that FAILED would discard a file that may well be fine.
        status = error && error.code === 'MEDIA_IMPORT_FAILED' ? 'FAILED' : 'UNKNOWN';
      }
    }
    if (status !== 'READY') {
      const outcome = status === 'FAILED'
        ? 'invoice-import-failed'
        : (status === 'UNKNOWN' ? 'invoice-import-read-failed' : 'invoice-import-not-ready');
      return withFindings({
        outcome,
        fileId: null,
        imported: false,
        // Hand the id back so the next run can RESUME this import rather than start another.
        // Retryable only when the import itself has not failed.
        pendingMediaFileId: status === 'FAILED' ? null : imported.fileId,
        mediaFileId: imported.fileId,
      });
    }
    fileId = imported.fileId;
    values.replatformSourceInvoiceFileId = fileId;
  }

  if (Object.keys(values).length === 0) {
    return withFindings({ outcome: 'invoice-none-found', fileId: null, imported: false });
  }

  // The patch is the LAST step, after the file is already READY in Media. If it fails, the file id
  // must not be lost: nothing on the order records it yet, so a resume that started over would
  // import a second private copy of a tax document -- review demonstrated exactly that. The id is
  // handed back as `pendingMediaFileId`, and the next run resumes from it (the same path a
  // still-PENDING import uses) instead of importing again.
  let updated;
  try {
    updated = await updateOrderExtendedFields(wix, {
      orderId,
      currentExtendedFields: order && order.extendedFields,
      namespace,
      values,
    });
  } catch (error) {
    rethrowRunStop(error);
    return withFindings({
      outcome: 'invoice-fields-write-failed',
      fileId: null,
      imported: false,
      pendingMediaFileId: fileId || null,
      mediaFileId: fileId || null,
      error: { message: String((error && error.message) || error).slice(0, 300), ...(error && error.status ? { status: error.status } : {}) },
    });
  }

  // The 200 alone does not prove the values landed (see the number check above), so the returned
  // order is compared with what was sent. Only ABSENCE counts as a drop: a value Wix stored in a
  // normalized form is still stored. A response without extendedFields says nothing either way.
  const stored = updated && updated.extendedFields
    ? ((updated.extendedFields.namespaces && updated.extendedFields.namespaces[namespace]) || {})
    : null;
  const dropped = stored ? Object.keys(values).filter((key) => stored[key] === undefined || stored[key] === null) : [];
  for (const key of dropped) findings.push({ code: 'invoice-field-dropped', field: key });
  // A dropped file id leaves nothing on the order to suppress a re-import, so it is a failed
  // write: the id rides back for the resume, exactly as when the patch itself fails.
  if (fileId && dropped.includes(invoiceContract.ROLES.fileId)) {
    return withFindings({ outcome: 'invoice-fields-write-failed', fileId: null, imported: false, pendingMediaFileId: fileId, mediaFileId: fileId });
  }

  return withFindings({
    outcome: fileId ? 'invoice-preserved' : 'invoice-number-only',
    fileId,
    imported: Boolean(fileId),
  });
}

// --- blog taxonomies -------------------------------------------------------
// VERIFIED: POST /blog/v3/categories with { category: { label, slug, description } }.
function _buildCreateCategoryRequest({ label, slug, description }) {
  const body = copyRequestBody({ category: { label, slug, description: description || '' } });
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/categories`,
    body,
  };
}
async function createBlogCategory(wix, payload) {
  return (await wix.send(buildCreateCategoryRequest(payload))).category;
}
// VERIFIED: POST /blog/v3/tags. Body is TOP-LEVEL { label, language } — NOT
// { tag: { label, slug } }. `slug` is derived by Wix from the label.
function _buildCreateTagRequest({ label, language = 'en' }) {
  const body = copyRequestBody({ label, language });
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/tags`,
    body,
  };
}
async function createBlogTag(wix, payload) {
  return (await wix.send(buildCreateTagRequest(payload))).tag;
}
// VERIFIED: GET /blog/v3/tags lists tags as { id, label, slug, ... }. Used to resolve a
// tag id after a 409 ALREADY_EXISTS so it can still be attached to a post.
async function listBlogTags(wix, { limit = 500 } = {}) {
  const r = await wix.send(markRequest({ method: 'GET', url: `${WIXAPIS}/blog/v3/tags?paging.limit=${limit}` }, { read: true }));
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
// memberId. CORRECTED (2026-10-05, blog author attribution fix): this is a valid
// FALLBACK memberId for a post with no real source author to attribute, never a reason
// to skip author resolution altogether -- see the members section below for why
// attribute-to-owner was wrongly treated as the default for every blog import. Author
// is re-assignable AFTER publish: PATCH
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
// VERIFIED-TRAP (2026-07-21): Wix rejects seoSlug whose percent-encoded
// form exceeds 100 chars (common for non-ASCII/Hebrew slugs: a 10-char Hebrew slug
// encodes to ~60 chars, so anything over ~15 chars blows the limit). Omit the slug
// when it is too long and let Wix derive it from the title.
function safeSeoslug(slug) {
  if (!slug) return undefined;
  try { return encodeURIComponent(slug).length <= 100 ? slug : undefined; } catch { return undefined; }
}
function toDraftPostBody({ title, memberId, richContent, excerpt, slug, categoryIds, tagIds,
  firstPublishedDate, heroImageId, seoData }) {
  return {
    title,
    memberId, // REQUIRED
    richContent, // Ricos document
    excerpt: excerpt || undefined,
    seoSlug: safeSeoslug(slug),
    categoryIds: categoryIds || [],
    tagIds: tagIds && tagIds.length ? tagIds : undefined,
    firstPublishedDate: firstPublishedDate || undefined,
    seoData: seoData || undefined,
    heroImage: heroImageId ? { id: heroImageId } : undefined,
    media: heroImageId ? { displayed: true, custom: true, wixMedia: { image: { id: heroImageId } } } : undefined,
  };
}
function _buildCreateDraftPostRequest(payload) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/blog/v3/draft-posts`,
    body: { draftPost: toDraftPostBody(payload) },
  };
}
async function createDraftPost(wix, payload) {
  return (await wix.send(buildCreateDraftPostRequest(payload))).draftPost;
}
// The blog build client's own requests (blog-post-build-client.js). Create and update send the
// whole build projection with the RICH_CONTENT and URL fieldsets, marked as blog/post writes so an
// import task's client admits them; draft and post GETs are marked reads.
const BLOG_BUILD_FIELDSETS = Object.freeze(['RICH_CONTENT', 'URL']);
function buildCreateBuildDraftPostRequest(draftPost) {
  return markRequest({ method: 'POST', url: `${WIXAPIS}/blog/v3/draft-posts`,
    body: { draftPost, fieldsets: [...BLOG_BUILD_FIELDSETS] } }, { entity: 'blog/post' });
}
function buildUpdateBuildDraftPostRequest(id, projection) {
  if (!id) throw new Error('buildUpdateBuildDraftPostRequest: draft id is required');
  return markRequest({ method: 'PATCH', url: `${WIXAPIS}/blog/v3/draft-posts/${encodeURIComponent(id)}`,
    body: { action: 'UPDATE', draftPost: { id, ...projection }, fieldsets: [...BLOG_BUILD_FIELDSETS] } }, { entity: 'blog/post' });
}
function buildBlogBuildReadRequest(url) {
  if (!/^https:\/\/www\.wixapis\.com\/blog\/v3\/(?:draft-posts|posts)(?:[/?]|$)/.test(String(url))) throw new Error('buildBlogBuildReadRequest: not a Blog draft-posts or posts read');
  return markRequest({ method: 'GET', url }, { read: true });
}
async function publishDraftPost(wix, draftPostId) {
  return wix.send(markRequest({ method: 'POST', url: `${WIXAPIS}/blog/v3/draft-posts/${draftPostId}/publish`, body: {} }, { entity: 'blog/post' }));
}

// VERIFIED-TRAP (2026-10-05, live test matrix): Wix's own docs say DELETE
// /blog/v3/draft-posts/{draftPostId} "also deletes an already-published post by the same id
// (draft id === published post id)". Live-tested and FALSE: an unpublished
// draft deletes only via draft-posts/{id} (no `permanent`); once PUBLISHED, that same path 404s
// "Entity not found" no matter what, and the entity is only reachable at /blog/v3/posts/{id}
// (which does support permanent=true there). The draft-posts surface simply stops recognizing
// the id after publish — there is no single path that works for both states. Since no caller
// tracks whether its post is currently published, deleteDraftPost below tries draft-posts first
// and falls back to posts/{id} on a 404, rather than requiring callers to pass that information.
function _buildDeleteDraftPostRequest(draftPostId, { permanent = false } = {}) {
  const query = permanent ? '?permanent=true' : '';
  return { method: 'DELETE', url: `${WIXAPIS}/blog/v3/draft-posts/${draftPostId}${query}` };
}
// VERIFIED (same live test matrix as above): DELETE /blog/v3/posts/{postId} is the surface a
// PUBLISHED post actually lives on, and the only one of the two that honours permanent=true for
// a published post (draft-posts/{id}?permanent=true 404s regardless of publish state).
function _buildDeletePostRequest(postId, { permanent = false } = {}) {
  const query = permanent ? '?permanent=true' : '';
  return { method: 'DELETE', url: `${WIXAPIS}/blog/v3/posts/${postId}${query}` };
}
async function deletePost(wix, postId, options) {
  return wix.send(buildDeletePostRequest(postId, options));
}
// Drop-in for every existing caller: none of them track whether their post is still an
// unpublished draft or has since been published, and this is a rare cleanup path rather than a
// hot one, so the extra round trip on fallback is an acceptable cost for correctness. Tries the
// draft-posts surface first (the only path that works for a genuine, still-unpublished draft);
// on a structured 404 there, retries via the published-post surface before giving up. A 404 from
// BOTH attempts means the id is genuinely gone (or never existed), and that original draft-posts
// 404 is what surfaces — the fallback is not allowed to hide a real not-found behind its own.
async function deleteDraftPost(wix, draftPostId, options) {
  try {
    return await wix.send(buildDeleteDraftPostRequest(draftPostId, options));
  } catch (draftError) {
    rethrowRunStop(draftError);
    if (!(draftError && draftError.status === 404)) throw draftError;
    try {
      return await wix.send(buildDeletePostRequest(draftPostId, options));
    } catch (postError) {
      rethrowRunStop(postError);
      if (postError && postError.status === 404) throw draftError;
      throw Object.assign(
        new Error(`deleteDraftPost: draft-posts delete 404'd and posts/{id} fallback also failed: ${postError && postError.message}`),
        { status: postError && postError.status, cause: postError, draftError },
      );
    }
  }
}

// UNVERIFIED: POST /blog/v3/bulk/draft-posts/create — bulk draft-post create, max 20
// posts per call (docs `draftPosts` validation: minItems 1, maxItems 20). Surfaced by the
// wix/skills `wix-manage` recipe (which recommends it "for any N ≥ 2", citing ~25–30s per
// single-post call) and confirmed against the public docs page; no live call yet, so per
// adapter policy it must be surfaced in the execution plan until the contract test
// promotes it. Whether the bulk create can publish directly (a `publish` flag) is
// unverified — publish remains per-post via publishDraftPost until proven otherwise.
const BLOG_BULK_CREATE_MAX = 20;
function _buildBulkCreateDraftPostsRequest(payloads) {
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
// TRAP (found 2026-08-12, live): when a caller sets a deterministic `data._id` (a
// generated CMS importer does, so the CMS item id is traceable back to
// the source id), the live API 400s "WDE0080: dataItem id and data._id fields must match" unless
// `dataItem.id` is ALSO set to that same value — `dataItem.id` is the authoritative item id;
// `data._id` alone is not enough. Every insert failed on this until fixed here.
function _buildInsertItemRequest(collectionId, data) {
  const dataItem = { data };
  if (data && typeof data === 'object' && !Array.isArray(data) && data._id != null && String(data._id).trim() !== '') {
    dataItem.id = String(data._id);
  }
  const body = copyRequestBody({ dataCollectionId: collectionId, dataItem });
  return {
    method: 'POST',
    url: `${WIXAPIS}/wix-data/v2/items`,
    body,
  };
}
// VERIFIED (docs): PUT /wix-data/v2/items/{dataItem.id} with { dataCollectionId, dataItem: { id, data } }.
// Replaces the payload of an item that must already exist; a missing id FAILS (never creates), so it
// spends no CMS item quota and the quota hold does not refuse it. Use it to re-save an item whose id
// the crosswalk already holds; insert would create it twice and `save` would re-create a deleted one.
function _buildUpdateDataItemRequest(collectionId, id, data) {
  if (id == null || String(id).trim() === '') throw new Error('buildUpdateDataItemRequest: an existing item id is required');
  const itemId = String(id);
  if (data && typeof data === 'object' && !Array.isArray(data) && data._id != null && String(data._id) !== itemId) {
    throw new Error('buildUpdateDataItemRequest: data._id differs from the item id');
  }
  return {
    method: 'PUT',
    url: `${WIXAPIS}/wix-data/v2/items/${encodeURIComponent(itemId)}`,
    body: copyRequestBody({ dataCollectionId: collectionId, dataItem: { id: itemId, data } }),
  };
}
async function updateDataItem(wix, collectionId, id, data) {
  return (await wix.send(buildUpdateDataItemRequest(collectionId, id, data))).dataItem;
}
// VERIFIED (docs): GET /wix-data/v1/site-data-usage/v1/site-data-usage → siteDataUsage
// { itemCountLimit, totalUsedLive: { items } }. A read: any client may send it.
const buildGetSiteDataUsageRequest = (options) => markRequest(cmsItemQuota.buildGetSiteDataUsageRequest(options), { read: true });
async function insertDataItem(wix, collectionId, data) {
  return (await wix.send(buildInsertItemRequest(collectionId, data))).dataItem;
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
// VERIFIED: POST /wix-data/v2/bulk/items/save, 1-1000 dataItems per call. Upserts by id: no id
// creates, a not-yet-existing id creates WITH that id, an existing id is FULLY REPLACED (not
// merged) -- callers that need a merge must read-then-write, this helper does not.
const CMS_BULK_SAVE_MAX = 1000;
function _buildBulkSaveDataItemsRequest(collectionId, items, { returnEntity = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('buildBulkSaveDataItemsRequest: items must be a non-empty array');
  }
  if (items.length > CMS_BULK_SAVE_MAX) {
    throw new Error(`buildBulkSaveDataItemsRequest: ${items.length} exceeds the per-request limit of ${CMS_BULK_SAVE_MAX} -- batch upstream`);
  }
  return {
    method: 'POST',
    url: `${WIXAPIS}/wix-data/v2/bulk/items/save`,
    body: {
      dataCollectionId: collectionId,
      dataItems: items,
      ...(returnEntity ? { returnEntity: true } : {}),
    },
  };
}
async function bulkSaveDataItems(wix, collectionId, items, options) {
  const response = await wix.send(buildBulkSaveDataItemsRequest(collectionId, items, options));
  return { results: response.results || [], bulkActionMetadata: response.bulkActionMetadata || {} };
}

// --- Import Crosswalk CMS mirror --------------------------------------------
// OPTIONAL compact CMS mirror of this project's local sourceId->targetId crosswalk (local state/crosswalk/ is the sole runtime authority; this is a post-run reference snapshot
// only, never depended on for resume/idempotency correctness -- see rp-execute-setup/SKILL.md's
// "Import crosswalk CMS mirror" for when to provision/use it).
//
// Item id is the row's own `sourceStableKey`, matching the download/dedupe contract exactly
// (rp-import-codegen's CMS-seed path already dedupes downloaded rows by `sourceStableKey` +
// newest valid `updatedAt`, with no other identity concept). The id deliberately carries no
// project/source-instance namespace: that would be a persistent schema field the download-side
// dedupe does not consume (a downloaded row is only ever matched by sourceStableKey there), so the
// two sides of the mirror would disagree about identity. A namespaced id would also need its own
// encoding/length decision (raw concatenation of two unescaped fields can itself collide, and a
// combined id can exceed Wix Data's 128-char item-id limit).
// KNOWN LIMITATION: this mirror is not safe to enable for two different migration
// projects/source instances that share a source system and can produce overlapping
// sourceStableKey values (rare for two independent WordPress sites' numeric ids, but not
// impossible): two projects importing the same entityType+sourceId produce the identical
// sourceStableKey, and Bulk Save's full-replace-by-id semantics means the second project's
// mirror write would silently erase the first project's row. Closing that gap needs an explicit
// identity/schema decision (stable derivation, encoding, legacy-row handling, and matching
// download-side dedupe semantics), not an ad hoc prefix invented inside this writer.
function buildImportCrosswalkItem({ entityType, sourceId, sourceStableKey, targetId, targetType, updatedAt }) {
  if (!entityType || sourceId === undefined || sourceId === null) {
    throw new Error('buildImportCrosswalkItem: entityType and sourceId are required');
  }
  if (!sourceStableKey) {
    throw new Error('buildImportCrosswalkItem: sourceStableKey is required (it is the mirror item id -- entityType+sourceId alone can collide across source systems)');
  }
  return {
    id: sourceStableKey,
    data: {
      entityType,
      sourceId: String(sourceId),
      sourceStableKey,
      targetId: targetId != null ? String(targetId) : '',
      targetType: targetType || '',
      updatedAt: updatedAt || new Date().toISOString(),
    },
  };
}
async function syncImportCrosswalk(wix, rows, { collectionId = 'ImportCrosswalk' } = {}) {
  const items = rows.map(buildImportCrosswalkItem);
  let totalSuccesses = 0;
  let totalFailures = 0;
  const errors = [];
  for (let i = 0; i < items.length; i += CMS_BULK_SAVE_MAX) {
    const { results, bulkActionMetadata } = await bulkSaveDataItems(wix, collectionId, items.slice(i, i + CMS_BULK_SAVE_MAX));
    totalSuccesses += bulkActionMetadata.totalSuccesses || 0;
    totalFailures += bulkActionMetadata.totalFailures || 0;
    for (const r of results) {
      if (!r.itemMetadata || !r.itemMetadata.success) errors.push(r);
    }
  }
  return { totalSuccesses, totalFailures, errors };
}

// --- Stores catalog (Catalog V3 ONLY) --------------------------------------
// Catalog V1 is NOT a supported destination: these primitives target V3 exclusively, there is
// no V1 fallback (it only masked real V3 errors as spurious 428s), and none should be added.
// Catalog V3 is guaranteed at provisioning for a site this run creates, so callers need no pre-write check there; a
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
  verifiedBy: 'live-verification',
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
// All rules below are VERIFIED by live calls (2026-07-05):
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
// The same cut as wix-build.js truncateCodePoints (kept local: wix-writers is vendored without it):
// whole characters within 80 UTF-16 units, so a name wix-build already shortened passes unchanged
// and an astral character is never split into a lone surrogate.
function clampProductName(name) {
  const s = String(name || '');
  if (s.length <= PRODUCT_NAME_MAX) return s;
  let out = '';
  for (const ch of s) { if (out.length + ch.length > PRODUCT_NAME_MAX) break; out += ch; }
  return out.trimEnd();
}
// These URLs come from source-site metadata and Wix Media fetches them server-side, so the host must
// not be loopback, private, link-local (cloud metadata) or local by definition. This is the shared
// LEXICAL guard (see lib/document-url-guard.js): it does not resolve DNS, so it narrows the SSRF
// surface rather than closing it.
function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'http:' || url.protocol === 'https:') && !documentUrlGuard.isPrivateHostname(url.hostname);
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

// This must not rebuild every item as a bare { url } / { id }, which would silently throw
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
  let normalizedItems = normalizeStoresProductMediaItems(items);
  if (confirmedPictures.declareMediaSource.requiresConfirmation()
    && normalizedItems.some((item) => Object.prototype.hasOwnProperty.call(item, 'url'))) {
    if (!confirmedPictures.isConfirmedGallery(items)) {
      throw new Error('buildStoresProductMedia: WordPress product URL media must come from confirmPictures');
    }
    // Normalization necessarily creates new item objects. Register only the exact same ordered
    // URL list; deriveConfirmed rejects a subset, extension, reorder or hand-built clone.
    normalizedItems = confirmedPictures.deriveConfirmed(items, normalizedItems);
  }
  return normalizedItems.length ? { itemsInfo: { items: normalizedItems } } : undefined;
}

// Generated importers declare and confirm through the exact confirmedPictures instance exported
// by this writer module. This assertion is deliberately separate from declaration so a startup
// that accidentally declared a second vendored/toolkit copy fails closed before its first write.
function assertProductMediaGuardActive() {
  if (!confirmedPictures.declareMediaSource.requiresConfirmation()) {
    throw new Error('assertProductMediaGuardActive: the writer\'s WordPress product-media guard is not active');
  }
  return true;
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
// VERIFIED-TRAP (2026-07-19): variant `price` must be a MONEY OBJECT
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
        // VERIFIED-TRAP (2026-07-21): `choiceType` is required on every choice — omitting it returns PRODUCT_OPTION_CHOICE_NAME_AND_TYPE_REQUIRED.
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
// Code generated before safe mode was removed passes (product, safeModeOptions, fields): the
// field list is the first array argument, and anything else is ignored.
function _buildCreateStoresProductRequest(product, ...rest) {
  const fields = rest.find(Array.isArray);
  const body = copyRequestBody({ product: normalizeStoresProductV3(product) });
  if (fields) body.fields = fields;
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v3/products`,
    body,
  };
}
async function createStoresProduct(wix, product, ...rest) {
  const normalized = normalizeStoresProductV3ForCreate(wix, product);
  return (await wix.send(buildCreateStoresProductRequest(normalized, ...rest))).product;
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

function _buildBulkCreateStoresProductsRequest(products, { returnEntity = false, fields } = {}) {
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

function _buildQueryStoresProductsRequest(query = { paging: { limit: 100 } }, fields) {
  const body = { query };
  if (fields) body.fields = fields;
  return { method: 'POST', url: `${WIXAPIS}/stores/v3/products/query`, body };
}
// ONE PAGE, unwrapped to the products array, pagingMetadata discarded — see the READ/RETURN
// CONTRACT at the top of this file. Do not build a dedupe index or a safety net on this.
async function queryStoresProducts(wix, query, fields) {
  return (await wix.send(buildQueryStoresProductsRequest(query, fields))).products || [];
}
// OBSERVED (2026-07-29): the only correct way to sweep the catalog, and the
// primitive any crosswalk-recovery / name-match safety net must use. The unwrapping executor
// above cannot be cursor-paged (it discards the cursor), and the hand-rolled loop that reads
// `.products` off its already-unwrapped return value produces an EMPTY set — which reads as
// "the store is empty" and is exactly the state under which an import re-creates the whole
// catalog it already imported. Hence: throw on an incomplete sweep, never return a partial index.
//
// VERIFIED (2026-08-12, catalog backfill): cursorPaging from the very first page works
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
// VERIFIED live: PATCH /stores/v3/products/{id} with
// { product: { revision, media: { itemsInfo: { items: [{id}|{url}] } } } } updates
// product gallery media. Prefer external URLs here when the source media is publicly
// reachable: the Stores product API ingests them in the background, which avoids the
// slower, heavily-throttled Media Manager pre-import path.
function _buildPatchStoresProductMediaRequest({ productId, revision, items = [] }) {
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

// VERIFIED (2026-09-01, live): the 200 above is a QUEUE ACKNOWLEDGEMENT, not a
// delivery. Wix echoes the item back as `mediaType: "UNKNOWN_MEDIA_TYPE"` with an `uploadId` and
// fetches the URL afterwards, on its own side, with no callback and no status endpoint.
//
// TRAP, and it is the expensive one: `media.itemsInfo.items` is a FULL REPLACE, so the product's
// existing image is discarded the instant the PATCH is accepted. If the background fetch then
// fails, Wix DROPS the item and the product is left with an EMPTY gallery — 200 on the write, no
// error anywhere, and the old picture already gone. Observed on a valid, publicly reachable
// JPEG that ingested fine on the very next attempt, so there is nothing about the file
// or the request to validate up front. Reading the product back is the only signal that exists.
//
// Scale of it: a noticeable share of items had not ingested 60s after an accepted write, and a
// second identical PATCH usually fixed them, with the occasional straggler needing a third. So a
// miss is "not yet known", never "failed" — the loop is what establishes the outcome.
//
// This is the writer to reach for whenever media correctness matters. `patchStoresProductMedia`
// stays for callers batching thousands of writes who verify in their own sweep afterwards.
const STORES_MEDIA_INGEST_SETTLE_MS = 60000;
const STORES_MEDIA_INGEST_ROUNDS = 4;

// `getStoresProductWithMedia`, `getStoresProductForVerification`
// and the bare `getStoresProduct` below were three near-identical clones differing only in a
// hardcoded `fields=` query string. Names and signatures below are kept exactly as they were --
// tests and every already-vendored migration project (e.g. `attach-product-tags.js`) call these
// by name -- but all three now build their request through this one parameterized builder, so a
// future caller needing yet another field combination passes an array instead of cloning a
// fourth near-identical function.
//
// Getting more than one `fields` value in one call needs the query param REPEATED, not
// comma-joined -- `?fields=MEDIA_ITEMS_INFO,PLAIN_DESCRIPTION` 400s ("Failed to parse...");
// `?fields=MEDIA_ITEMS_INFO&fields=PLAIN_DESCRIPTION` is what actually returns both
// (LIVE-VERIFIED 2026-09-27).
function buildGetStoresProductRequestWithFields(id, fields = []) {
  const query = fields.length ? `?${fields.map((field) => `fields=${encodeURIComponent(field)}`).join('&')}` : '';
  return { method: 'GET', url: `${WIXAPIS}/stores/v3/products/${encodeURIComponent(id)}${query}` };
}

// Reading media back REQUIRES the fields parameter. A plain GET returns only `media.main`, so an
// unverified read looks empty on a perfectly healthy product and would report every write failed.
function _buildGetStoresProductWithMediaRequest(id) {
  return buildGetStoresProductRequestWithFields(id, ['MEDIA_ITEMS_INFO']);
}
async function getStoresProductWithMedia(wix, id) {
  return (await wix.send(buildGetStoresProductWithMediaRequest(id))).product;
}

// LIVE-VERIFIED (2026-09-27): the same "plain GET returns a
// stripped-down product" trap documented above for media ALSO applies to `plainDescription` --
// a bare GET or a GET with only `fields=MEDIA_ITEMS_INFO` omits it entirely (the key is simply
// absent, not empty), so a byte-for-byte verification comparing against it always sees
// `undefined` and never confirms, no matter what was actually written. This is the read a
// product-verification caller needs; `getStoresProduct`'s bare GET is not enough to verify
// description or media.
function _buildGetStoresProductForVerificationRequest(id) {
  return buildGetStoresProductRequestWithFields(id, ['MEDIA_ITEMS_INFO', 'PLAIN_DESCRIPTION']);
}
async function getStoresProductForVerification(wix, id) {
  return (await wix.send(buildGetStoresProductForVerificationRequest(id))).product;
}

// An item has landed when Wix ingested it as its own type: an image carries `image.id`, a video
// (`mediaType: "VIDEO"`) carries `video.id`. A queued (`UNKNOWN_MEDIA_TYPE`) or id-less item is
// either still in flight or already dropped, and ONE read cannot tell those apart. Both mean
// "not landed"; only re-sending distinguishes them.
function storesProductMediaItemLanded(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.mediaType === 'VIDEO') return Boolean(item.video?.id);
  return (item.mediaType === undefined || item.mediaType === 'IMAGE') && Boolean(item.image?.id);
}
function storesProductMediaLanded(product, expectedCount) {
  const items = product?.media?.itemsInfo?.items || [];
  const ingested = items.filter(storesProductMediaItemLanded);
  return ingested.length === expectedCount && expectedCount > 0;
}

// Media sent as URLs on Create Product is ingested AFTER the 200, so a product
// whose media dependency is proven `within-write` verifies it by OBSERVATION only -- reads, never a
// resend of the landed product. The policy is pinned: at most one initial read plus four more, at
// least 15s apart, inside a 60s window per product. It is a cap, not a promise that ingestion
// finishes in 60s: an item still missing is `unresolved` (a per-record gap the caller records
// against the landed target ID), never proof of permanent loss.
//
// Verification correlates the INTENDED items (the sent `{ url, altText, displayName }` list) slot by
// slot through write-verification's correlateProductMedia; a matching count, a wrong image or one
// image substituted into two slots never verifies. Items with no surviving identity evidence are
// `unverifiable` at once rather than polled.
//
// Scheduling: the observer does not hold a request slot while it waits. Each read goes through the
// client's existing pacing; between reads the observer only sleeps, so the caller starts every
// product's observation without waiting for the previous one and lets the waits overlap. End-to-end
// time is therefore about one 60s window plus the total read service time spread over the
// client's concurrency, not 60s per product per slot.
//
// The result is registered evidence (`withinWriteObservation`): only an observation this module
// produced, for this client's site, can record or clear a within-write gap. Its inputs are trusted
// the same way: every product it judges -- a caller's `initialProduct` (the create response or an
// earlier read) and each read it makes -- must be an unmodified Wix response this process received
// for this product id on the same site. Its `observedAt` is the receive time of the response that
// decided the outcome, so a cached response from before a gap can never clear it.
const STORES_MEDIA_CREATE_OBSERVATION = Object.freeze({ maxReads: 5, minSpacingMs: 15000, windowMs: 60000 });
const withinWriteObservations = new WeakSet();
function withinWriteObservation(value) { return value && typeof value === 'object' && withinWriteObservations.has(value) ? value : null; }
async function observeStoresProductMediaIngest(
  wix,
  { productId, expectedItems, initialProduct = null },
  { sleep = (ms) => new Promise((res) => setTimeout(res, ms)), now = () => Date.now(), policy = STORES_MEDIA_CREATE_OBSERVATION } = {},
) {
  if (!productId) throw new Error('observeStoresProductMediaIngest: productId is required');
  if (!Array.isArray(expectedItems) || !expectedItems.length) throw new Error('observeStoresProductMediaIngest: expectedItems (the sent media items) is required');
  if (policy.maxReads > STORES_MEDIA_CREATE_OBSERVATION.maxReads || policy.minSpacingMs < STORES_MEDIA_CREATE_OBSERVATION.minSpacingMs || policy.windowMs > STORES_MEDIA_CREATE_OBSERVATION.windowMs) throw new Error('observeStoresProductMediaIngest: policy exceeds the reviewed observation bound');
  const { correlateProductMedia, digest } = require('../../../lib/write-verification');
  const clientSite = executionCapability.clientContext(wix)?.siteId || null;
  let site = clientSite;
  const trusted = value => {
    const evidence = value && typeof value === 'object' ? responseEvidence.get(value) : null;
    if (!evidence || evidence.digest !== executionCapability.digest(JSON.stringify(value)) || String(value.id) !== String(productId) || !evidence.siteId || !evidence.receivedAt) return null;
    if (site && evidence.siteId !== site) return null;
    site = evidence.siteId;
    return evidence;
  };
  let decidedBy = null;
  const finish = (status, reads, correlation, timing) => {
    const observation = Object.freeze({ ref: 'media/media-file', status, productId: String(productId), siteId: site,
      expectedDigest: digest(expectedItems), expectedCount: expectedItems.length, reads, reasons: Object.freeze([...correlation.reasons]),
      mediaIds: status === 'verified' ? Object.freeze([...correlation.mediaIds]) : undefined, observedAt: decidedBy.receivedAt, timing: Object.freeze(timing) });
    withinWriteObservations.add(observation);
    return observation;
  };
  const started = now();
  let reads = 0, product = null, waitedMs = 0;
  // A response the caller already has (the create response or a scheduled verification read)
  // counts as the first read, but only if it is a trusted response for this product and site.
  if (initialProduct) {
    if (!trusted(initialProduct)) throw new Error('observeStoresProductMediaIngest: initialProduct is not a trusted Wix response for this product and site');
    reads = 1; product = initialProduct;
  }
  for (;;) {
    if (!product) {
      product = await getStoresProductWithMedia(wix, productId); reads += 1;
      if (!trusted(product)) throw new Error('observeStoresProductMediaIngest: read did not return a trusted response for this product and site');
    }
    decidedBy = responseEvidence.get(product);
    const correlation = correlateProductMedia(expectedItems, product?.media?.itemsInfo?.items);
    const timing = { elapsedMs: now() - started, waitedMs };
    if (correlation.verified) return finish('verified', reads, correlation, timing);
    if (!correlation.correlatable) return finish('unverifiable', reads, correlation, timing);
    if (reads >= policy.maxReads || now() - started + policy.minSpacingMs > policy.windowMs) return finish('unresolved', reads, correlation, timing);
    await pauseFor(wix, sleep)(policy.minSpacingMs); waitedMs += policy.minSpacingMs;
    product = null;
  }
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
  // Run the shared confirmation guard before the first GET. patchStoresProductMediaVerified
  // otherwise reads the target revision before reaching patchStoresProductMedia, which would
  // violate the fail-before-any-request boundary for an unconfirmed gallery.
  const guardedMedia = buildStoresProductMedia(items);
  const expected = guardedMedia?.itemsInfo?.items?.length || 0;
  if (expected === 0) throw new Error(`patchStoresProductMediaVerified: refusing to replace ${productId}'s gallery with nothing`);

  const attempts = [];
  for (let round = 1; round <= rounds; round += 1) {
    // TWO DIFFERENT FAILURES, ONE RETRY LIST. A write REFUSED (this endpoint
    // rate-limits at the edge with a 429 whose body is an HTML page, and it outlasts a short
    // in-request backoff) leaves the OLD image in place. A write ACCEPTED but never ingested
    // leaves NOTHING. Both mean "not verified", so both belong in the next round — which is why
    // every call in this body is inside the try. Letting a throw escape the loop was the actual
    // bug: on a live catalog some writes hit that 429, and each one would have aborted the
    // helper on its first round while reporting nothing about the state it left behind.
    try {
      // Re-read the revision every round. An accepted-but-not-ingested write still incremented it,
      // so reusing the previous round's value 400s on the retry that was supposed to save us.
      const before = await getStoresProductWithMedia(wix, productId);
      await patchStoresProductMedia(wix, { productId, revision: before.revision, items });
      await pauseFor(wix, sleep)(settleMs);
      const after = await getStoresProductWithMedia(wix, productId);
      const landed = storesProductMediaLanded(after, expected);
      attempts.push({ round, landed });
      if (landed) return { productId, landed: true, rounds: round, attempts, product: after };
    } catch (error) {
      rethrowRunStop(error);
      // Record what went wrong and go round again. The error is kept per attempt rather than
      // thrown, because the caller's decision is the same either way — this product is not
      // verified — and because the message is the only clue about WHICH failure it was.
      attempts.push({ round, landed: false, error: String((error && error.message) || error).slice(0, 300) });
      // BACK OFF BEFORE RETRYING. A round that throws skips the settle wait above, so without
      // this the loop retries instantly and burns every round inside a few milliseconds — which
      // is worthless against the condition it is retrying, an edge 429 that outlasts tens of
      // seconds of backoff. Nothing to wait for after the last round, so that one returns
      // immediately rather than making the caller pay for a delay it cannot use.
      if (round < rounds) await pauseFor(wix, sleep)(retryDelayMs);
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

// Product videos. A video goes to Wix Media first (import as VIDEO, wait for READY),
// then onto the product as `{ id }` AFTER its images. Never as a `{ url }` in the image list: a
// `.mov` there emptied the galleries of a whole 94-product batch with a 200. VERIFIED live (2026-10-20): Media import, READY file id,
// attach after the verified create.
//
// `media.itemsInfo.items` is a FULL REPLACE, so the current gallery is re-sent by file id. A
// gallery with an item that has not landed yet (still ingesting, or dropped) is never replaced:
// the call returns `deferred` and the caller tries again later.
//
// Re-runs never add a second copy. A video may carry the `fileId` an earlier run recorded
// (lib/product-videos.js `videosWithRecordedFiles`): if that id is already a landed VIDEO on the
// product it is skipped; if it is not on the product it is re-attached from Wix Media without a
// new import. With no recorded ids at all, a product that already has as many landed videos as
// requested is `already-attached`.
const STORES_PRODUCT_MEDIA_MAX_ITEMS = 15;
async function attachStoresProductVideos(
  wix,
  { productId, videos = [] },
  { importTries = 40, importDelayMs = 3000, ...patchOptions } = {},
) {
  if (!productId) throw new Error('attachStoresProductVideos: productId is required');
  const wanted = (videos || []).filter((video) => video && typeof video.url === 'string' && isPublicHttpUrl(video.url));
  if (!wanted.length) return { productId, status: 'nothing-to-attach', videos: [] };

  const before = await getStoresProductWithMedia(wix, productId);
  const existing = before?.media?.itemsInfo?.items || [];
  const landedVideos = existing.filter((item) => item?.mediaType === 'VIDEO' && item.video?.id);
  const landedIds = new Set(landedVideos.map((item) => item.video.id));
  const anyRecorded = wanted.some((video) => typeof video.fileId === 'string' && video.fileId);
  if (!anyRecorded && landedVideos.length >= wanted.length) {
    return { productId, status: 'already-attached', videos: landedVideos.map((item) => ({ fileId: item.video.id, status: 'landed' })) };
  }
  const onProduct = wanted.filter((video) => landedIds.has(video.fileId));
  const pending = wanted.filter((video) => !landedIds.has(video.fileId));
  const skipped = onProduct.map((video) => ({ url: video.url, fileId: video.fileId, status: 'landed' }));
  if (!pending.length) return { productId, status: 'already-attached', videos: skipped };
  const kept = existing.map((item) => {
    if (item?.mediaType === 'VIDEO') return item.video?.id ? { id: item.video.id } : null;
    if ((item?.mediaType === undefined || item?.mediaType === 'IMAGE') && item?.image?.id) {
      return { id: item.image.id, ...(typeof item.altText === 'string' && item.altText ? { altText: item.altText } : {}) };
    }
    return null;
  });
  if (kept.some((item) => item === null)) {
    return { productId, status: 'deferred', reason: 'gallery-not-settled', videos: [] };
  }
  if (kept.length + pending.length > STORES_PRODUCT_MEDIA_MAX_ITEMS) {
    return { productId, status: 'failed', reason: 'media-item-limit', limit: STORES_PRODUCT_MEDIA_MAX_ITEMS, videos: [] };
  }

  const results = [];
  for (const video of pending) {
    try {
      // A file an earlier run already put in Wix Media is re-used, not imported again.
      // eslint-disable-next-line no-await-in-loop
      const file = video.fileId ? { id: video.fileId } : await importMedia(wix, {
        sourceUrl: video.url,
        displayName: video.displayName || decodeURIComponent(String(video.url).split('/').pop() || 'product video'),
        mediaType: 'VIDEO',
      });
      // eslint-disable-next-line no-await-in-loop
      const ready = file?.id ? await waitUntilFileReady(wix, file.id, { tries: importTries, delayMs: importDelayMs }) : null;
      results.push(ready?.id
        ? { url: video.url, fileId: ready.id, status: 'ready' }
        : { url: video.url, fileId: file?.id || null, status: 'not-ready' });
    } catch (error) {
      rethrowRunStop(error);
      results.push({ url: video.url, fileId: null, status: 'import-failed', error: String(error?.message || error).slice(0, 300) });
    }
  }
  const ready = results.filter((result) => result.status === 'ready');
  if (!ready.length) return { productId, status: 'failed', reason: 'video-import', videos: [...skipped, ...results] };

  const items = [...kept, ...ready.map((result) => ({ id: result.fileId }))];
  const patched = await patchStoresProductMediaVerified(wix, { productId, items }, patchOptions);
  const status = !patched.landed ? 'unverified' : (ready.length === pending.length ? 'attached' : 'partial');
  return {
    productId,
    status,
    videos: [...skipped, ...results],
    patch: { landed: patched.landed, rounds: patched.rounds, ...(patched.errors?.length ? { errors: patched.errors } : {}) },
  };
}

// VERIFIED (2026-08-12, catalog backfill): PATCH /stores/v3/products/{id} with
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
function _buildPatchStoresProductTagsRequest({ productId, revision, tagIds = [] }) {
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
function _buildGetStoresProductRequest(id) {
  return buildGetStoresProductRequestWithFields(id, []);
}
async function getStoresProduct(wix, id) {
  return (await wix.send(buildGetStoresProductRequest(id))).product;
}
function _buildGetStoresProductBySlugRequest(slug) {
  return { method: 'GET', url: `${WIXAPIS}/stores/v3/products/slug/${encodeURIComponent(slug)}` };
}
async function getStoresProductBySlug(wix, slug) {
  return (await wix.send(buildGetStoresProductBySlugRequest(slug))).product;
}
function _buildDeleteStoresProductRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/stores/v3/products/${encodeURIComponent(id)}` };
}
async function deleteStoresProduct(wix, id) {
  return wix.send(buildDeleteStoresProductRequest(id));
}

// Setup-only deletes of the sample catalog the Wix Stores install itself added. The
// caller (lib/catalog-baseline.js) passes only ids it proved appeared between its pre- and
// post-install reads; these builders are marked as that setup operation, never as an import write.
// Delete Category: DELETE /categories/v1/categories/{id} with the Stores tree as a query parameter.
function _buildDeleteInstallSeededProductRequest(id) {
  if (!id) throw new Error('buildDeleteInstallSeededProductRequest: id is required');
  return _buildDeleteStoresProductRequest(id);
}
function _buildDeleteInstallSeededCategoryRequest(id) {
  if (!id) throw new Error('buildDeleteInstallSeededCategoryRequest: id is required');
  return { method: 'DELETE', url: `${WIXAPIS}/categories/v1/categories/${encodeURIComponent(id)}?treeReference.appNamespace=${encodeURIComponent(STORES_TREE_REFERENCE.appNamespace)}` };
}
// GET /stores/v3/all-products-category -> { categoryId, treeReference }: the built-in category
// every product belongs to. Wix creates it with the store; it is never a sample to delete.
function _buildGetAllProductsCategoryRequest() {
  return { method: 'GET', url: `${WIXAPIS}/stores/v3/all-products-category` };
}
async function getAllProductsCategoryId(wix) {
  return (await wix.send(buildGetAllProductsCategoryRequest())).categoryId || null;
}

// UNVERIFIED (endpoint VERIFIED via patchStoresProductMedia): PATCH /stores/v3/products/{id}
// with arbitrary product fields. The `revision` from the existing product is required.
// A string `description` is moved to `plainDescription` by normalizeStoresProductV3 (same as
// createStoresProduct); Wix converts that HTML to rich content server-side.
// Do not use this for media-only updates — patchStoresProductMedia is the verified path for that.
function _buildPatchStoresProductRequest({ productId, revision, ...productFields }) {
  const body = copyRequestBody({ product: { revision, ...normalizeStoresProductV3(productFields) } });
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/stores/v3/products/${productId}`,
    body,
  };
}
async function patchStoresProduct(wix, { productId, revision, ...productFields }) {
  // No description handling here: buildPatchStoresProductRequest runs normalizeStoresProductV3,
  // which moves a string `description` to `plainDescription` for Wix to convert server-side.
  return (await wix.send(buildPatchStoresProductRequest({ productId, revision, ...productFields }))).product;
}

// Item SEO Tags (Developer Preview). Product SEO is WRITTEN through product.seoData
// only; this service is used to READ `resolvedTags` for verification, and its bulk writer is
// refused for STORES_PRODUCT (2026-08-27: per-entry success, nothing persisted). The 2026-08-27
// notes also record a 404 from this single-item GET; a canary is still needed to confirm today's read.
function buildGetItemSeoTagsRequest(itemType, itemId) {
  if (!itemType || !itemId) throw new Error('buildGetItemSeoTagsRequest: itemType and itemId are required');
  // A read: the product SEO stage's resolution check runs under an import-task capability.
  return markRequest({ method: 'GET', url: `${WIXAPIS}/promote/seo/v1/item-seo-tags/${encodeURIComponent(itemType)}/${encodeURIComponent(itemId)}` }, { read: true });
}
async function getItemSeoTags(wix, itemType, itemId) {
  return (await wix.send(buildGetItemSeoTagsRequest(itemType, itemId))).itemSeoTags;
}
// the seo/item-seo-tags writer covers BLOG_POST only. Other item types follow the
// no-writer path; STORES_PRODUCT keeps its own refusal. `preservedTags[i]` are entry i's tags as
// Wix already holds them, so a full-replacement write may carry an existing robots or canonical
// back unchanged; only setItemSeoTags supplies them (the registry builder drops the option).
function _buildBulkSetItemSeoTagsRequest(itemType, entries, { publish = false, returnEntity = true, preservedTags = [] } = {}) {
  productSeo.assertNotStoresProductBulkSeo(itemType);
  if (!seoTags.ITEM_SEO_ITEM_TYPES.includes(itemType)) throw new Error(`buildBulkSetItemSeoTagsRequest: item type ${itemType} has no reviewed writer (reviewed for ${seoTags.ITEM_SEO_ITEM_TYPES.join(', ')})`);
  if (publish !== false) throw new Error('buildBulkSetItemSeoTagsRequest: publish is not used for BLOG_POST and is refused');
  const limit = seoTags.ITEM_SEO_BULK_LIMITS[itemType] || 100;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > limit) throw new Error(`buildBulkSetItemSeoTagsRequest: 1..${limit} entries required for ${itemType}`);
  const body = entries.map((entry, i) => {
    const { itemId, itemSeoTags = {}, fieldMask } = entry || {};
    if (typeof itemId !== 'string' || !itemId) throw new Error(`buildBulkSetItemSeoTagsRequest: entries[${i}].itemId (the Wix item id) is required`);
    if (itemSeoTags.language !== undefined) throw new Error('buildBulkSetItemSeoTagsRequest: language is read-only (primary language only)');
    const mask = (Array.isArray(fieldMask) ? fieldMask : String(fieldMask || Object.keys(itemSeoTags).filter(k => ['tags', 'focusKeywords'].includes(k)).join(',')).split(',')).map(x => x.trim()).filter(Boolean);
    if (!mask.length || mask.some(x => !['tags', 'focusKeywords'].includes(x))) throw new Error(`buildBulkSetItemSeoTagsRequest: entries[${i}].fieldMask names tags and/or focusKeywords`);
    const out = {};
    if (mask.includes('tags')) { seoTags.assertItemTags(itemSeoTags.tags, { preserved: preservedTags[i] }); out.tags = itemSeoTags.tags; }
    if (mask.includes('focusKeywords')) {
      if (!Array.isArray(itemSeoTags.focusKeywords) || itemSeoTags.focusKeywords.length > seoTags.ITEM_SEO_MAX_FOCUS_KEYWORDS) throw new Error(`buildBulkSetItemSeoTagsRequest: focusKeywords must be an array of at most ${seoTags.ITEM_SEO_MAX_FOCUS_KEYWORDS}`);
      out.focusKeywords = itemSeoTags.focusKeywords;
    }
    // Per-entry fieldMask is a comma-separated string, and the payload nests under itemSeoTags
    // (2026-08-27 probe: historical-request-shape-traps).
    return { itemId, itemSeoTags: out, fieldMask: mask.join(',') };
  });
  return { method: 'POST', url: `${WIXAPIS}/promote/seo/v1/bulk/item-seo-tags/set`, body: { itemType, entries: body, publish, returnEntity } };
}
// A success response from this call is untrusted until an independent read-back confirms it.
async function bulkSetItemSeoTags(wix, itemType, entries, options) {
  return wix.send(buildBulkSetItemSeoTagsRequest(itemType, entries, options));
}
const ITEM_SEO_WHOLE_CALL_CODES = new Set(['UNSUPPORTED_ITEM_TYPE', 'BULK_NOT_SUPPORTED_FOR_ITEM_TYPE', 'BULK_CHUNK_SIZE_EXCEEDED']);
// The seo/item-seo-tags writer. entries: [{ itemId, tags?, focusKeywords? }] in the order of
// `sourceStableKeys` (one per entry; required in an import task). Per entry it reads the item,
// merges (writes replace in full), strips robots and canonicals into `exclusions`, writes in
// chunks, and reads back. Only `verified` is a landed write.
async function setItemSeoTags(wix, { itemType = 'BLOG_POST', entries = [] } = {}, { readinessGrant, sourceStableKeys } = {}) {
  if (!seoTags.ITEM_SEO_ITEM_TYPES.includes(itemType)) throw new Error(`setItemSeoTags: item type ${itemType} has no reviewed writer`);
  if (sourceStableKeys !== undefined && (!Array.isArray(sourceStableKeys) || sourceStableKeys.length !== entries.length)) throw new Error('setItemSeoTags: one sourceStableKey per entry');
  const results = entries.map((entry, index) => ({ index, itemId: entry && entry.itemId, outcome: null, exclusions: [] }));
  const prepared = [];
  for (const [index, entry] of entries.entries()) {
    let current;
    // One unreadable item (a 404 post) fails that entry only; a refused request is not a read failure.
    try { current = await getItemSeoTags(wix, itemType, entry.itemId); } catch (error) {
      rethrowRunStop(error);
      if (error && error.requestSent === false) throw error;
      Object.assign(results[index], { outcome: 'failed', error: memberErrorFields(error) });
      continue;
    }
    const ownTags = (current && current.tags) || [];
    const split = seoTags.splitItemExclusions(entry.tags);
    results[index].exclusions = split.exclusions;
    const itemSeoTags = {}, mask = [];
    if (entry.tags !== undefined) { itemSeoTags.tags = seoTags.mergeTags(ownTags, split.tags); mask.push('tags'); }
    if (entry.focusKeywords !== undefined) { itemSeoTags.focusKeywords = entry.focusKeywords; mask.push('focusKeywords'); }
    if (!mask.length || (entry.tags !== undefined && !split.tags.length && entry.focusKeywords === undefined)) { results[index].outcome = 'nothing-to-write'; continue; }
    prepared.push({ index, written: split.tags, entry: { itemId: entry.itemId, itemSeoTags, fieldMask: mask.join(',') }, preserved: ownTags });
  }
  const limit = seoTags.ITEM_SEO_BULK_LIMITS[itemType] || 100;
  for (let at = 0; at < prepared.length; at += limit) {
    const chunk = prepared.slice(at, at + limit);
    let request = markRequest(_buildBulkSetItemSeoTagsRequest(itemType, chunk.map(p => p.entry), { preservedTags: chunk.map(p => p.preserved) }), { entity: 'seo/item-seo-tags' });
    if (sourceStableKeys !== undefined) request = withBulkReadinessGrant(request, { readinessGrant, sourceStableKeys: chunk.map(p => sourceStableKeys[p.index]) });
    let response = null, failure = null;
    try { response = await wix.send(request); } catch (error) { rethrowRunStop(error); failure = error; }
    if (failure && failure.requestSent === false) throw failure;
    if (failure && failure.outcomeKnown !== false && ITEM_SEO_WHOLE_CALL_CODES.has(failure.applicationErrorCode)) {
      // Whole-call rejection: no per-entry results exist. Reported once for the batch.
      for (const p of chunk) Object.assign(results[p.index], { outcome: 'failed-whole-call', error: memberErrorFields(failure) });
      continue;
    }
    const perEntry = new Map(((response && response.results) || []).map(r => [r && r.itemMetadata && r.itemMetadata.originalIndex, r]));
    for (const [i, p] of chunk.entries()) {
      const meta = perEntry.get(i) && perEntry.get(i).itemMetadata;
      if (!failure && meta && meta.success === false) { Object.assign(results[p.index], { outcome: 'failed', error: meta.error || null }); continue; }
      // Success, a missing result, or an unknown outcome: only the read-back decides.
      let readBack = null;
      try { readBack = await getItemSeoTags(wix, itemType, p.entry.itemId); } catch (error) { rethrowRunStop(error); Object.assign(results[p.index], { outcome: failure ? 'unknown' : 'unverified-after-success', error: memberErrorFields(error) }); continue; }
      const failures = seoTags.checkItemReadBack(readBack, p.written, p.entry.itemSeoTags.focusKeywords);
      Object.assign(results[p.index], failures.length ? { outcome: failure ? 'not-landed' : 'unverified-after-success', failures } : { outcome: 'verified' });
      if (failure && failures.length) results[p.index].error = memberErrorFields(failure);
    }
  }
  return { itemType, results };
}

// SEO Pattern V1. A pattern applies to every item of its page type that has no
// override, and has no revision: read immediately before writing.
const SEO_PATTERNS_URL = pageType => `${WIXAPIS}/promote/seo/v1/seo-patterns/${encodeURIComponent(pageType)}`;
function seoPatternPageType(pageType, where) {
  if (typeof pageType !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(pageType)) throw new Error(`${where}: pageType is required`);
  if (pageType.startsWith('WIX_DATA_PAGE_ITEM')) throw new Error(`${where}: WIX_DATA_PAGE_ITEM patterns have no reviewed writer`);
  return pageType;
}
function buildGetSeoPatternRequest(pageType) {
  return markRequest({ method: 'GET', url: SEO_PATTERNS_URL(seoPatternPageType(pageType, 'buildGetSeoPatternRequest')) }, { read: true });
}
function buildListSeoPatternVariablesRequest(pageType) {
  return markRequest({ method: 'GET', url: `${SEO_PATTERNS_URL(seoPatternPageType(pageType, 'buildListSeoPatternVariablesRequest'))}/variables` }, { read: true });
}
function _seoPatternBody(pageType, tags, preservedTags, where) {
  seoPatternPageType(pageType, where);
  seoTags.assertPatternTags(tags, { preserved: preservedTags });
  return { seoPattern: { pattern: { tags } } };
}
function _buildCreateSeoPatternRequest({ pageType, tags, preservedTags = [] }) {
  return { method: 'POST', url: SEO_PATTERNS_URL(pageType), body: _seoPatternBody(pageType, tags, preservedTags, 'buildCreateSeoPatternRequest') };
}
function _buildSetSeoPatternRequest({ pageType, tags, preservedTags = [] }) {
  return { method: 'PATCH', url: SEO_PATTERNS_URL(pageType), body: { ..._seoPatternBody(pageType, tags, preservedTags, 'buildSetSeoPatternRequest'), fieldMask: 'pattern' } };
}
const seoPatternError = (error, code) => error && error.outcomeKnown !== false && error.applicationErrorCode === code;
// The seo/seo-pattern writer. a site-owned pattern is overwritten for the identities the
// source brings, and the old pattern is returned as `previousSitePattern` for restore.
async function ensureSeoPattern(wix, { pageType, tags } = {}) {
  const split = seoTags.splitPatternExclusions(tags);
  const result = { pageType, outcome: null, exclusions: split.exclusions, defaultPattern: null, previousSitePattern: null };
  if (!split.tags.length) return { ...result, outcome: 'nothing-to-write' };
  let current;
  try { current = (await wix.send(buildGetSeoPatternRequest(pageType))).seoPattern || {}; } catch (error) {
    rethrowRunStop(error);
    if (seoPatternError(error, 'PAGE_TYPE_NOT_ON_SITE')) return { ...result, outcome: 'setup-missing-app', error: memberErrorFields(error) };
    if (seoPatternError(error, 'UNSUPPORTED_PAGE_TYPE')) return { ...result, outcome: 'unsupported-page-type', error: memberErrorFields(error) };
    throw error;
  }
  const listed = await wix.send(buildListSeoPatternVariablesRequest(pageType));
  const allowed = seoTags.allowedVariables(listed);
  // A dry run cannot read the site's variables, so it leaves this check to the live run.
  const unknown = listed && listed.dryRun === true && listed.stateKnown === false ? [] : seoTags.patternVariables(split.tags).filter(name => !allowed.has(name));
  if (unknown.length) return { ...result, outcome: 'invalid-variable', unknownVariables: unknown, allowedVariables: [...allowed].sort() };
  for (let attempt = 0; attempt < 2; attempt++) {
    const own = current.source === seoTags.PATTERN_SOURCE_USER;
    const base = own ? (current.pattern && current.pattern.tags) || [] : (current.defaultPattern && current.defaultPattern.tags) || [];
    const merged = seoTags.mergeTags(base, split.tags);
    result.defaultPattern = current.defaultPattern || null;
    result.previousSitePattern = own ? current.pattern || null : null;
    // Compared by identity and value: Wix echoes stored tags with default fields (custom, disabled).
    if (own && !seoTags.checkStoredTags(base, split.tags).length) return { ...result, outcome: 'already-present' };
    const args = { pageType, tags: merged, preservedTags: seoTags.preservedRobots(base) };
    try {
      await wix.send(own ? markRequest(_buildSetSeoPatternRequest(args), { entity: 'seo/seo-pattern' }) : markRequest(_buildCreateSeoPatternRequest(args), { entity: 'seo/seo-pattern' }));
    } catch (error) {
      rethrowRunStop(error);
      // The other verb is never retried blindly: re-read, then decide again once.
      if (attempt === 0 && (seoPatternError(error, 'PATTERN_ALREADY_EXISTS') || seoPatternError(error, 'PATTERN_NOT_FOUND') || error.status === 409)) { current = (await wix.send(buildGetSeoPatternRequest(pageType))).seoPattern || {}; continue; }
      if (seoPatternError(error, 'INVALID_PATTERN')) return { ...result, outcome: 'invalid-variable', error: memberErrorFields(error) };
      if (error.requestSent === false || error.outcomeKnown !== false) throw error;
      result.error = memberErrorFields(error);
    }
    const after = (await wix.send(buildGetSeoPatternRequest(pageType))).seoPattern || {};
    const missing = after.source === seoTags.PATTERN_SOURCE_USER ? seoTags.checkStoredTags(after.pattern && after.pattern.tags, split.tags) : split.tags.map(tag => ({ identity: seoTags.tagIdentity(tag) }));
    return { ...result, outcome: missing.length ? (result.error ? 'unknown' : 'unverified-after-success') : 'verified', ...(missing.length ? { failures: missing } : {}) };
  }
  return { ...result, outcome: 'unknown' };
}

// Site SEO Tags V1. Verification tags, plus the source share image (og:image) from this record's
// own imported image; robots is never written and a robots tag the site already has is sent back
// verbatim, because leaving it out of the full-replacement PATCH would change indexing. embedTags
// are never written.
function buildGetSiteSeoTagsRequest() {
  return markRequest({ method: 'GET', url: `${WIXAPIS}/promote/seo/v1/site-seo-tags` }, { read: true });
}
function _buildSetSiteSeoTagsRequest({ tags, preservedTags = [] }) {
  seoTags.assertSiteTags(tags, { preserved: preservedTags });
  return { method: 'PATCH', url: `${WIXAPIS}/promote/seo/v1/site-seo-tags`, body: { siteSeoTags: { tags }, fieldMask: 'tags' } };
}
// The share image's own media file, read by its granted id: the og:image URL is that file's url.
function buildGetSiteShareImageFileRequest(mediaId) {
  if (typeof mediaId !== 'string' || !mediaId) throw new Error('site share image: mediaId is required');
  return markRequest({ method: 'GET', url: `${WIXAPIS}/site-media/v1/files/${encodeURIComponent(mediaId)}` }, { read: true });
}
const isShareImageTag = tag => { try { return seoTags.tagIdentity(tag) === 'meta:property:og:image'; } catch { return false; } };
// An og:image in a site-tags PATCH is admitted only when it is the site's own (identical to one this
// record read from the site) or the URL of the granted media file this record read. In a dry run
// nothing leaves, so the read evidence is not required; the granted id still is.
function siteShareImageAdmitted(wix, request, mark, authority, dryRun) {
  const images = (request.body?.siteSeoTags?.tags || []).filter(isShareImageTag);
  if (images.length > 1) return false;
  if (!images.length) return true;
  const content = seoTags.tagValue(images[0]);
  const reads = (clientReadResponses.get(wix) || []).filter(value => {
    const proof = responseEvidence.get(value);
    return proof && proof.request.sourceStableKey === request.sourceStableKey && proof.request.readinessGrant === request.readinessGrant && proof.digest === executionCapability.digest(JSON.stringify(value));
  });
  if (reads.some(value => (value.siteSeoTags?.tags || []).some(tag => isShareImageTag(tag) && seoTags.tagValue(tag) === content))) return true;
  const image = mark.shareImage;
  if (!image || content !== image.url) return false;
  if (!require('../../../lib/dependency-readiness').verifyReferenceMember(request.readinessGrant, authority, request.sourceStableKey, 'media/media-file', image.mediaId)) return false;
  return dryRun || reads.some(value => value.file?.id === image.mediaId && value.file?.url === image.url && value.file?.operationStatus === 'READY');
}
// The share image, after the verification tags and in its own PATCH, so a missing or failed image
// never holds them. Not written (any cause) is the cutover action site-share-image-not-written.
async function writeSiteShareImage(wix, { mediaId, sourceUrl }) {
  const notWritten = (cause, extra = {}) => ({ outcome: 'not-written', cause, sourceUrl, ...(mediaId ? { mediaId } : {}), ...extra });
  if (!mediaId) return notWritten('media-not-imported');
  let file;
  try { file = (await wix.send(buildGetSiteShareImageFileRequest(mediaId))).file; }
  catch (error) { rethrowRunStop(error); if (error.requestSent === false) throw error; return notWritten('media-read-failed', { error: memberErrorFields(error) }); }
  const dryRun = file?._dryRunPlaceholder === true;
  const url = dryRun ? `https://static.wixstatic.com/media/${encodeURIComponent(mediaId)}` : file?.url;
  if (!dryRun) {
    if (file?.operationStatus === 'FAILED') return notWritten('media-failed');
    if (file?.id !== mediaId || file?.operationStatus !== 'READY' || !/^https:\/\/static\.wixstatic\.com\//.test(url || '')) return notWritten('media-not-ready');
  }
  const tag = { type: 'meta', props: { property: 'og:image', content: url } };
  const current = ((await wix.send(buildGetSiteSeoTagsRequest())).siteSeoTags || {}).tags || [];
  if (!seoTags.checkStoredTags(current, [tag]).length) return { outcome: 'already-present', mediaId, url, sourceUrl };
  const replacedTags = current.filter(isShareImageTag);
  let error = null;
  try {
    await wix.send(markRequest(_buildSetSiteSeoTagsRequest({ tags: seoTags.mergeTags(current, [tag]), preservedTags: current }), { entity: 'seo/site-seo-tags', siteTags: true, shareImage: { mediaId, url } }));
  } catch (caught) {
    rethrowRunStop(caught);
    if (caught.requestSent === false) throw caught;
    if (caught.outcomeKnown !== false) return notWritten('write-rejected', { url, error: memberErrorFields(caught) });
    error = memberErrorFields(caught);
  }
  if (dryRun) return { outcome: 'dry-run', mediaId, url, sourceUrl };
  // Some SEO writes succeed silently without storing: only a read-back counts.
  const after = ((await wix.send(buildGetSiteSeoTagsRequest())).siteSeoTags || {}).tags || [];
  if (seoTags.checkStoredTags(after, [tag]).length) return notWritten('read-back-missing', { url, ...(error ? { error } : {}) });
  return { outcome: 'verified', mediaId, url, sourceUrl, ...(replacedTags.length ? { replacedTags } : {}) };
}
async function setSiteSeoTags(wix, { tags = [], shareImage } = {}) {
  if (shareImage !== undefined && (!shareImage || typeof shareImage !== 'object' || typeof shareImage.sourceUrl !== 'string' || !shareImage.sourceUrl || (shareImage.mediaId !== undefined && (typeof shareImage.mediaId !== 'string' || !shareImage.mediaId)))) {
    throw Object.assign(new Error('site SEO tags: shareImage must be { mediaId (from resolveReference("media/media-file", ...), absent when the image did not land), sourceUrl }'), { code: 'site_share_image_invalid', requestSent: false, outcomeKnown: true });
  }
  const split = seoTags.splitSiteExclusions(tags);
  // Indexing is a launch decision on every run that writes site tags, whatever the source had.
  const result = { outcome: null, exclusions: split.exclusions, operatorActions: [{ reasonCode: 'site-indexing-launch-decision' }] };
  const finish = async tagResult => {
    const out = { ...result, ...tagResult };
    if (shareImage) {
      out.shareImage = await writeSiteShareImage(wix, shareImage);
      if (out.shareImage.outcome === 'not-written') out.exclusions = [...out.exclusions, { reasonCode: 'site-og-image-not-written', cause: out.shareImage.cause, tag: { type: 'meta', props: { property: 'og:image', content: shareImage.sourceUrl } } }];
      if (!split.tags.length && ['verified', 'already-present', 'dry-run'].includes(out.shareImage.outcome)) out.outcome = out.shareImage.outcome === 'dry-run' ? 'verified' : out.shareImage.outcome;
    }
    if (out.exclusions.some(e => e.reasonCode === 'site-og-image-not-written')) out.operatorActions = [...out.operatorActions, { reasonCode: 'site-share-image-not-written' }];
    return out;
  };
  if (!split.tags.length) return finish({ outcome: 'nothing-to-write' });
  const current = ((await wix.send(buildGetSiteSeoTagsRequest())).siteSeoTags || {}).tags || [];
  const merged = seoTags.mergeTags(current, split.tags);
  if (!seoTags.checkStoredTags(current, split.tags).length) return finish({ outcome: 'already-present' });
  // A verification tag the source replaces is returned, so the old property can be restored.
  const incoming = new Set(split.tags.map(seoTags.tagIdentity));
  const tagResult = { replacedTags: current.filter(tag => !seoTags.isRobots(tag) && incoming.has(seoTags.tagIdentity(tag))) };
  try {
    await wix.send(markRequest(_buildSetSiteSeoTagsRequest({ tags: merged, preservedTags: current }), { entity: 'seo/site-seo-tags', siteTags: true }));
  } catch (error) {
    rethrowRunStop(error);
    if (error.requestSent === false || error.outcomeKnown !== false) throw error;
    tagResult.error = memberErrorFields(error);
  }
  const after = ((await wix.send(buildGetSiteSeoTagsRequest())).siteSeoTags || {}).tags || [];
  const missing = seoTags.checkStoredTags(after, split.tags);
  const robotsKept = seoTags.tagsEqual(seoTags.preservedRobots(current), seoTags.preservedRobots(after));
  return finish({ ...tagResult, outcome: missing.length || !robotsKept ? (tagResult.error ? 'unknown' : 'unverified-after-success') : 'verified', ...(missing.length ? { failures: missing } : {}), ...(robotsKept ? {} : { robotsChanged: true }) });
}

// UNVERIFIED: POST /categories/v1/categories/query returns ONE PAGE of Stores categories —
// NOT all of them, whatever this comment used to say. treeReference is TOP-LEVEL (same trap as
// create). Used to seed a name→id cache for upsert flows so existing categories are reused
// instead of duplicated — which means the cache must be built with queryAllStoresCategories,
// since a truncated cache duplicates exactly the categories it failed to read.
function _buildQueryStoresCategoriesRequest(query = { paging: { limit: 100 } }) {
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
// silently truncated once a site passes 100 categories — a larger site reads as 100, which would
// duplicate the rest on the next import. Any upsert/dedupe flow must use this instead.
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
function _buildCreateStoresCategoryRequest(category) {
  const body = copyRequestBody({
    category: omitEmptyStringFields(category, ['description']),
    treeReference: STORES_TREE_REFERENCE,
  });
  return {
    method: 'POST',
    url: `${WIXAPIS}/categories/v1/categories`,
    body,
  };
}
async function createStoresCategory(wix, category) {
  return (await wix.send(buildCreateStoresCategoryRequest(category))).category;
}

// VERIFIED (2026-07-05): add one product to categories in bulk —
// POST /categories/v1/bulk/categories/add-item with
// { item:{ catalogItemId, appId }, categoryIds[], treeReference }. catalogItemId is the Wix
// product id; appId is the Wix Stores app id.
function _buildBulkAddItemToCategoriesRequest({ productId, categoryIds }) {
  return {
    method: 'POST',
    url: `${WIXAPIS}/categories/v1/bulk/categories/add-item`,
    body: { item: { catalogItemId: productId, appId: WIX_STORES_APP_ID }, categoryIds, treeReference: STORES_TREE_REFERENCE },
  };
}
async function bulkAddItemToCategories(wix, payload) {
  const request = buildBulkAddItemToCategoriesRequest(payload);
  const ctx = executionCapability.clientContext(wix);
  if (ctx?.kind === 'quick-entity' && ctx.adapterId === 'quick-woocommerce' && ctx.entityId === 'product') markRequest(request, { entity: 'stores/product', productMembership: true, auxiliary: true });
  return wix.send(request);
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
// COUPON SCOPE. `specification.scope` is `{namespace, group?: {name, entityId}}`, and the
// target's enumeration is of PAIRS, not of two independent lists. Five pairs, all measured
// (coupon.json `storewide-scope-is-valid-and-needs-no-group`):
//
//   stores + (no group)  storewide     stores + product     stores + collection
//   forms  + (no group)  forms-wide    forms  + form
//
// MEASURED LIVE: a scope sent with an EMPTY `namespace` is rejected 400 with
// "The provided combination of scope and coupon type is invalid. Provided combination:
// namespace=, group=<product|collection>, entityId=<...>" -- a message that names NO missing
// field and reads as a type/scope incompatibility. Coupons were permanently not written
// to a live store because that message was believed. Anyone reading an error of that shape
// should check for an empty `namespace` first.
//
// The namespace is DERIVED from the group name, never defaulted: `form` pairs with `forms`, so
// a flat `'stores'` constant manufactures `{namespace: 'stores', group: {name: 'form'}}` -- the
// identical class of invalid pair this gate exists to stop.
const COUPON_SCOPE_GROUP_NAMESPACE = Object.freeze({ product: 'stores', collection: 'stores', form: 'forms' });
const COUPON_SCOPE_NAMESPACES = Object.freeze(['stores', 'forms']);
const blankScopeValue = (value) => value === undefined || value === null || value === '';
function couponScopeRefusal(field, received, why) {
  return new Error(
    `normalizeCouponSpecification: ${field} ${JSON.stringify(received) ?? 'undefined'} ${why}. `
    + 'Accepted scope pairs: namespace "stores" with no group (storewide), with scope.group.name '
    + '"product", or with "collection"; namespace "forms" with no group (forms-wide) or with '
    + 'scope.group.name "form". A group also needs scope.group.entityId. A source platform\'s '
    + '"category" is the target\'s "collection"; the verified mapping is '
    + 'rp-source-wordpress/lib/coupon-discovery.js mapCouponToWix, which already emits the '
    + 'target\'s own vocabulary -- do not hand-roll the specification.',
  );
}
// THROW, DO NOT DROP. A silently removed bad scope produces a STOREWIDE coupon -- more generous
// than the merchant published, and the same defect class as dropping the restriction outright.
// The refusal has to be loud, and it has to name the field, the value and the accepted values,
// so the caller's mistake fails on our machine with an instruction instead of on the merchant's
// store with a riddle.
//
// This gate does NOT translate. Rewriting a source platform's word into the target's would
// quietly take over the mapping job, and the caller's bug would survive unrecorded until the
// next platform whose vocabulary we have not special-cased. The message carries the hint; the
// hint never becomes a silent substitution.
function normalizeCouponScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw couponScopeRefusal('scope', scope, 'is not a coupon scope object');
  }
  const namespace = scope.namespace;
  const group = scope.group;
  if (!blankScopeValue(group)) {
    if (typeof group !== 'object' || Array.isArray(group)) {
      throw couponScopeRefusal('scope.group', group, 'is not a coupon scope group object');
    }
    if (blankScopeValue(group.name)) {
      throw couponScopeRefusal('scope.group.name', group.name, 'is missing, so the scope names no kind of thing to restrict to');
    }
    const derived = COUPON_SCOPE_GROUP_NAMESPACE[group.name];
    if (!derived) {
      throw couponScopeRefusal('scope.group.name', group.name, 'is not a coupon scope group on the target');
    }
    if (blankScopeValue(group.entityId)) {
      throw couponScopeRefusal('scope.group.entityId', group.entityId, `is missing, and a "${group.name}" scope restricts the coupon to exactly one target`);
    }
    // Completion, not a default. The pair table gives each group name exactly one
    // namespace, so a wrong value is not reachable here -- only a missing one.
    if (blankScopeValue(namespace)) return { ...scope, namespace: derived };
    if (namespace !== derived) {
      throw couponScopeRefusal('scope', { namespace, group: { name: group.name } }, `is not an accepted pair -- scope.group.name "${group.name}" pairs only with namespace "${derived}"`);
    }
    return scope;
  }
  // No group: storewide (stores) or forms-wide (forms). BOTH no-group rows are reachable, so
  // "no group" is never on its own a reason to refuse -- a four-row reading of the table
  // refuses a legitimately accepted forms-wide coupon, which is the opposite of the intent.
  if (blankScopeValue(namespace)) {
    throw couponScopeRefusal('scope.namespace', namespace, 'is missing on a scope that carries no group, so nothing determines it');
  }
  if (!COUPON_SCOPE_NAMESPACES.includes(namespace)) {
    throw couponScopeRefusal('scope.namespace', namespace, 'is not a coupon scope namespace on the target');
  }
  return scope;
}

// Redeemability is a DECISION, and an undecided coupon is refused before anything
// is sent. Both fields are optional on the API, and the target resolves each omission in the
// most expensive direction: an absent `active` reads as switched ON, and the target starts its
// own usage count at zero so nothing seeds a prior redemption. A hand-rolled specification that
// simply never mentioned them therefore wrote live, uncapped money instruments and returned 200
// for every one of them. There is no post-write check available either -- the target exposes no
// redemption count on any surface (`wix-exposes-no-redemption-count-for-a-coupon`) -- so
// write-time correctness is the only correctness this entity has.
//
// CREATE ONLY. `buildUpdateCouponRequest` must never acquire this guard: a PATCH carrying a whole
// specification alongside a narrow field mask returns 200 and writes NOTHING
// (`full-specification-patch-returns-200-and-writes-nothing`), so demanding a complete
// redeemability statement on an update would turn every correction into a silent no-op and every
// voucher remedy pass into a false pass on money.
//
// `usageUnlimited` is a DIRECTIVE, not an API field: it says "the source imposes no limit", and
// `normalizeCouponSpecification` strips it before the body is built. The word is the one
// `classifyPreWriteDrift` already returns in its verdict; one concept keeps one name.
// `usageLimit: 0` is not a way to say unlimited -- the target validates "more than 0" and rejects
// it -- which is why the unlimited case needs a directive rather than a sentinel number.
function assertCouponRedeemabilityDecided(specification) {
  if (!specification || typeof specification !== 'object' || Array.isArray(specification)) {
    throw new Error('a coupon specification must be an object; redeemability cannot be decided from ' + String(JSON.stringify(specification) ?? typeof specification).slice(0, 80));
  }
  const code = String(specification.code == null ? '' : specification.code);
  if (typeof specification.active !== 'boolean') {
    throw new Error(`coupon "${code}": redeemability was never decided -- \`active\` is not set. A coupon specification must come from rp-source-wordpress/lib/coupon-discovery.js mapCouponToWix, which decides it from the source usage count. Do not hand-roll one.`);
  }
  if (specification.usageUnlimited === true) return;
  const limit = specification.usageLimit;
  const asNumber = typeof limit === 'number' ? limit : (typeof limit === 'string' && limit.trim() !== '' ? Number(limit) : NaN);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error(`coupon "${code}": usage allowance was never decided -- set \`usageLimit\` (a positive integer, the uses the holder has LEFT) or \`usageUnlimited: true\` if the source imposes no limit. Omitting it is not the same as unlimited.`);
  }
}
function normalizeCouponSpecification(specification = {}) {
  assertCouponRedeemabilityDecided(specification);
  const normalized = { ...specification };
  // A directive for this guard, never an API field -- it must not reach the wire.
  delete normalized.usageUnlimited;
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
  // An empty `{}` scope is DELETED, not refused -- existing behaviour, deliberately preserved.
  // Anything else that is present goes through the pair gate above.
  if (normalized.scope && typeof normalized.scope === 'object' && !Array.isArray(normalized.scope) && Object.keys(normalized.scope).length === 0) {
    delete normalized.scope;
  } else if (normalized.scope !== undefined && normalized.scope !== null) {
    normalized.scope = normalizeCouponScope(normalized.scope);
  }
  return normalized;
}
// GA request: POST /contacts/v5/contacts { contact: <flat contact>, allowDuplicates }.
// Accepts the flat GA `contact` directly; a legacy V4-style `info` payload is converted
// via contactInfoToV5Contact (strict — throws on non-mechanical keys). At least one of
// name.first, name.last, email.email, or phone.phone is required by the API.
function _buildCreateContactRequest({ contact, info, allowDuplicates = false }) {
  if (contact !== undefined && info !== undefined) {
    throw new Error('buildCreateContactRequest: pass either the flat GA `contact` or a legacy `info`, not both');
  }
  const flatContact = info !== undefined ? contactInfoToV5Contact(info) : contact;
  if (!flatContact || typeof flatContact !== 'object' || Array.isArray(flatContact)) {
    throw new Error('buildCreateContactRequest: contact must be a flat GA Contacts V5 contact object');
  }
  const body = copyRequestBody({
    contact: normalizeV5Contact(flatContact),
    allowDuplicates,
  });
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v5/contacts`,
    body,
  };
}
async function createContact(wix, payload) {
  return (await wix.send(buildCreateContactRequest(payload))).contact;
}

// Evidence: bulk upsert and query-back exercised basic contact fields with mock values.
// Member updates, real contact values and extensions are not thereby verified. Endpoint: POST
// /contacts/v5/bulk/contacts/upsert — the contact import path: 1-100 contacts per call,
// synchronous, per-item results. Contact matching includes externalId, email and phone; V5 can match phone even with email present.
// Use the verified contact importer for prewrite identity checks; `externalId`
// (set-once, max 100 chars) carries the source-system id for the crosswalk.
// `upsertMode`: OVERWRITE (default) | APPEND | OVERWRITE_APPEND_ARRAYS.
// Contacts use the same flat GA shape as createContact; each array item wraps as
// `{ contact }`.
const CONTACTS_BULK_UPSERT_MAX = 100;
function _buildBulkUpsertContactsRequest(contacts, { upsertMode, returnEntity = false, updateMember } = {}) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error('buildBulkUpsertContactsRequest: contacts must be a non-empty array');
  }
  if (contacts.length > CONTACTS_BULK_UPSERT_MAX) {
    throw new Error(
      `buildBulkUpsertContactsRequest: ${contacts.length} contacts exceeds the per-request limit of ${CONTACTS_BULK_UPSERT_MAX} — batch upstream`,
    );
  }
  const body = copyRequestBody({
    contacts: contacts.map((contact) => ({ contact: normalizeV5Contact(contact) })),
    ...(upsertMode ? { upsertMode } : {}),
    ...(returnEntity ? { returnEntity: true } : {}),
    ...(typeof updateMember === 'boolean' ? { updateMember } : {}),
  });
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v5/bulk/contacts/upsert`,
    body,
  };
}
// Returns per-item outcomes correlated back to the input index — the same flat shape as
// bulkCreateStoresProductsWithInventory, so callers cannot misread partial failure as
// all-or-nothing.
async function bulkUpsertContacts(wix, contacts, options = {}) {
  const response = await wix.send(buildBulkUpsertContactsRequest(contacts, options));
  return bulkResults.normalizeBulk(response, contacts, 'contacts');
}
function _buildQueryContactsRequest(query = { paging: { limit: 100, offset: 0 } }) {
  return { method: 'POST', url: `${WIXAPIS}/contacts/v5/contacts/query`, body: { query } };
}
// ONE PAGE, unwrapped to the contacts array — see the READ/RETURN CONTRACT at the top of this
// file. Contacts pages by `paging.{limit,offset}`, so a full sweep advances the offset off the
// raw response rather than following a cursor; there is no queryAll* helper yet.
async function queryContacts(wix, query) {
  return (await wix.send(buildQueryContactsRequest(query))).contacts || [];
}
function _buildGetContactRequest(contactId) {
  if (!contactId) throw new Error('buildGetContactRequest: contactId is required');
  return { method: 'GET', url: `${WIXAPIS}/contacts/v5/contacts/${contactId}` };
}
async function getContact(wix, contactId) {
  return (await wix.send(buildGetContactRequest(contactId))).contact;
}
// Create Member creates OR matches a contact and returns member.contactId.
// Before that contact can satisfy another record's reference (an order's buyerInfo.contactId), read
// the member back and require it to still point at exactly that contact, then read the contact.
// The result is the secondary identity the member's crosswalk row records; `outcome` stays
// 'unknown' unless the caller has evidence that distinguishes a new contact from a matched one.
async function verifyMemberContactIdentity(wix, { memberId, contactId, siteId, outcome = 'unknown' }) {
  if (!memberId || !contactId || !siteId) throw new Error('verifyMemberContactIdentity: memberId, contactId and siteId are required');
  if (!['created', 'matched', 'unknown'].includes(outcome)) throw new Error('verifyMemberContactIdentity: outcome must be created, matched or unknown');
  const member = await getMember(wix, memberId);
  const contact = member && String(member.id) === String(memberId) && String(member.contactId || '') === String(contactId) ? await getContact(wix, contactId) : null;
  const verified = Boolean(contact && String(contact.id) === String(contactId));
  return {
    verified,
    identity: verified ? { ref: 'crm/contact', targetId: String(contactId), parentTargetId: String(memberId), siteId: String(siteId), outcome,
      verification: { kind: 'member-contact-read-back', verified: true, parentTargetId: String(memberId), identityTargetId: String(contactId), verifiedAt: new Date().toISOString() } } : null,
  };
}
// GA request: PATCH /contacts/v5/contacts/{id} { contact: { id, revision, <flat fields> },
// allowDuplicates? }. The current revision is REQUIRED (optimistic concurrency); there is
// no fieldMask in the GA contract — passing one throws so stale pre-GA call sites fail
// loudly instead of sending an unrecognized parameter.
function _buildUpdateContactRequest({ contactId, revision, contact, info, allowDuplicates, fieldMask }) {
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
// The builder lives in contact-extended-fields.js with the rest of the V4 path.
const { buildFindOrCreateContactExtendedFieldRequest } = contactExtendedFields;
async function findOrCreateContactExtendedField(wix, payload) {
  return (await wix.send(buildFindOrCreateContactExtendedFieldRequest(payload))).field;
}

// --- Contact labels (crm/label) and labels on contacts (crm/contact-label) -------------------
// VERIFIED LIVE 2026-10-27: POST /contacts/v4/labels { displayName } finds
// the label with that name or creates it, and says which (`newLabel`), so a retry or an unknown
// outcome is safe to resend. The V4 label IS the V5 contact private tag: the response carries
// `label.tagId` (5 chars), which V5 `tags.privateTags.tagIds` accepts and V4 shows back as the
// label key. The crosswalk target for a label is that tagId.
function _buildFindOrCreateContactLabelRequest({ displayName }) {
  if (typeof displayName !== 'string' || displayName.trim() === '') throw new Error('finding or creating a contact label needs a non-empty displayName');
  const body = copyRequestBody({ displayName });
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v4/labels`,
    body,
  };
}
function _buildGetContactLabelRequest(key) {
  if (!key) throw new Error('reading a contact label needs its key');
  return { method: 'GET', url: `${WIXAPIS}/contacts/v4/labels/${encodeURIComponent(key)}` };
}
// A pre-send refusal (createWixClient) is a known outcome: nothing reached Wix. The flag and code
// ride on the writer's error so the journal records the row not sent (failed_retryable).
const notSentFields = error => (error && error.requestSent === false ? { requestSent: false, code: error.code === undefined ? null : error.code } : {});
async function findOrCreateContactLabel(wix, { displayName } = {}) {
  let found;
  try {
    found = await wix.send(buildFindOrCreateContactLabelRequest({ displayName }));
  } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'label-failed', tagId: null, labelKey: null, error: { message: String(error && error.message).slice(0, 300), status: error && error.status, outcomeKnown: error && error.outcomeKnown, ...notSentFields(error) } };
  }
  const label = found && found.label;
  if (!label || !label.key || !label.tagId) return { outcome: 'label-failed', tagId: null, labelKey: null, error: { message: 'Find or Create Label returned no label key or tagId' } };
  // Read back by key: the label exists under this name, and its tag id is the one we record.
  let read;
  try { read = (await wix.send(buildGetContactLabelRequest(label.key))).label; } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'label-unverified', tagId: label.tagId, labelKey: label.key, error: { message: String(error && error.message).slice(0, 300), status: error && error.status } };
  }
  if (!read || read.tagId !== label.tagId || read.displayName !== label.displayName) return { outcome: 'label-unverified', tagId: label.tagId, labelKey: label.key, error: { message: 'label read-back does not match the label written' } };
  return { outcome: found.newLabel === true ? 'label-written' : 'label-reconciled-existing', tagId: label.tagId, labelKey: label.key, displayName: label.displayName };
}

// VERIFIED LIVE 2026-10-27: POST /contacts/v5/contacts/{id}/update-tags
// { assignTags: { privateTags: { tagIds } } } adds tags and keeps the contact's others; a repeat
// is harmless (revision only), so an unknown outcome is safe to resend. Assign-only: this writer
// never unassigns. Traps: Wix ACCEPTS a tag id that does not exist (it is stored on the contact),
// so tag ids come only from read-back labels via the readiness grant; and the PATH wins when the
// body's contactId differs, so the path is built from the same contactId the grant checks in the
// body. Do not send tags inside the contact upsert: the default OVERWRITE upsert replaces a
// matched contact's existing tags.
const CONTACT_TAG_ID_MAX_LENGTH = 5;
const CONTACT_TAG_IDS_MAX_PER_CALL = 1000; // Update Contact Tags schema: tagIds maxItems 1000
function _buildUpdateContactTagsRequest({ contactId, tagIds }) {
  if (!contactId) throw new Error('labelling a contact needs the contact id');
  if (!Array.isArray(tagIds) || tagIds.length === 0) throw new Error('labelling a contact needs at least one tag id');
  if (tagIds.length > CONTACT_TAG_IDS_MAX_PER_CALL) throw new Error(`labelling a contact takes at most ${CONTACT_TAG_IDS_MAX_PER_CALL} tag ids per call`);
  for (const tagId of tagIds) if (typeof tagId !== 'string' || !tagId || tagId.length > CONTACT_TAG_ID_MAX_LENGTH) throw new Error(`a contact tag id must be a label tagId of 1-${CONTACT_TAG_ID_MAX_LENGTH} characters, not a label key`);
  return {
    method: 'POST',
    url: `${WIXAPIS}/contacts/v5/contacts/${encodeURIComponent(contactId)}/update-tags`,
    body: { contactId, assignTags: { privateTags: { tagIds: [...tagIds] } } },
  };
}
function _buildGetContactTagsRequest(contactId) {
  if (!contactId) throw new Error('reading contact tags needs the contact id');
  return { method: 'GET', url: `${WIXAPIS}/contacts/v5/contacts/${encodeURIComponent(contactId)}?fields=TAGS` };
}
async function assignContactLabels(wix, { contactId, tagIds } = {}) {
  const request = buildUpdateContactTagsRequest({ contactId, tagIds });
  try { await wix.send(request); } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'contact-labels-failed', contactId, tagIds, error: { message: String(error && error.message).slice(0, 300), status: error && error.status, outcomeKnown: error && error.outcomeKnown, ...notSentFields(error) } };
  }
  let have;
  try { have = ((await wix.send(buildGetContactTagsRequest(contactId))).contact || {}).tags?.privateTags?.tagIds || []; } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'contact-labels-unverified', contactId, tagIds, error: { message: String(error && error.message).slice(0, 300), status: error && error.status } };
  }
  const missing = tagIds.filter(tagId => !have.includes(tagId));
  return missing.length ? { outcome: 'contact-labels-unverified', contactId, tagIds, missing } : { outcome: 'contact-labels-assigned', contactId, tagIds };
}

// --- Email Subscriptions ----------------------------------------------------
// A dedicated resource keyed by EMAIL ADDRESS, not contactId -- so it covers guest-checkout
// emails with no Contact behind them just as well as known contacts. Per Wix's own docs, a
// write here is reflected into the site's contact list automatically (same underlying status
// as contact.email.subscriptionStatus). Endpoint: POST /email-marketing/v1/email-subscriptions/bulk
// (SCOPE.DC-MANAGE.EMAIL-SUBSCRIPTIONS), 1-100 items per call, per-item results. This sets a
// status only -- it does not itself send any confirmation/marketing email -- so it is safe to
// run while the site is muted. Only ever set SUBSCRIBED from real consent evidence (e.g. a
// checkout opt-in flag on the source order); see domains/crm/entities/email-subscription.json's
// consent-proof-required pitfall.
const EMAIL_SUBSCRIPTIONS_BULK_MAX = 100;
function _buildBulkUpsertEmailSubscriptionsRequest(subscriptions) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    throw new Error('buildBulkUpsertEmailSubscriptionsRequest: subscriptions must be a non-empty array');
  }
  if (subscriptions.length > EMAIL_SUBSCRIPTIONS_BULK_MAX) {
    throw new Error(`buildBulkUpsertEmailSubscriptionsRequest: ${subscriptions.length} exceeds the per-request limit of ${EMAIL_SUBSCRIPTIONS_BULK_MAX} -- batch upstream`);
  }
  for (const s of subscriptions) {
    if (!s || !s.email) throw new Error('buildBulkUpsertEmailSubscriptionsRequest: every subscription needs an email');
  }
  return {
    method: 'POST',
    url: `${WIXAPIS}/email-marketing/v1/email-subscriptions/bulk`,
    body: { subscriptions },
  };
}
async function bulkUpsertEmailSubscriptions(wix, subscriptions) {
  const response = await wix.send(buildBulkUpsertEmailSubscriptionsRequest(subscriptions));
  return { results: response.results || [], metadata: response.metadata || {} };
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
function _buildCreateCouponRequest(specification) {
  const body = copyRequestBody({ specification: normalizeCouponSpecification(specification) });
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v2/coupons`,
    body,
  };
}
async function createCoupon(wix, specification) {
  const response = await wix.send(buildCreateCouponRequest(specification));
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
        await pauseFor(wix)(750);
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

function _buildBulkCreateCouponsRequest(specifications) {
  if (!Array.isArray(specifications) || specifications.length === 0) throw new Error('bulkCreateCoupons needs a non-empty array of specifications');
  assertBulkCreateCannotLoseFields(specifications);
  if (specifications.length > BULK_COUPON_BATCH) throw new Error(`bulk coupon create takes at most ${BULK_COUPON_BATCH} specifications per call, got ${specifications.length}`);
  const body = copyRequestBody({ specifications: specifications.map(normalizeCouponSpecification) });
  return {
    method: 'POST',
    url: `${WIXAPIS}/stores/v2/bulk/coupons/create`,
    body,
  };
}

// LOCAL PARTITION, before anything is sent. A specification the writer can refuse on its own --
// a malformed scope -- is set aside here and reported as a refusal, and only the survivors go on
// the wire. Nothing is rescued by this that the existing fallback would have lost: a throw from
// request-building is already caught below, and `retryBatchIndividually` re-creates the other 99
// one at a time. What the partition buys is COST and ATTRIBUTION -- one caller typo otherwise
// converts a single bulk call into a failed bulk call plus a hundred individual creates, and the
// fallback records `reason: 'batch request failed: ...'`, fires `onFallback`, and marks all 99
// healthy coupons `viaFallback: true`. A deterministic local refusal reported as a batch or
// transport failure, and 99 coupons reported as having survived one, is not what happened.
//
// Deliberately NOT folded into any whole-batch guard that sits before this: those refuse the
// caller's whole batch on purpose. This pass disposes of its refusals PER COUPON.
function partitionRefusableCoupons(specifications, outcomes) {
  const sent = [];
  const map = [];
  // Out-of-range batches keep the existing route: the builder refuses the whole call below.
  if (!Array.isArray(specifications) || specifications.length === 0 || specifications.length > BULK_COUPON_BATCH) {
    const length = Array.isArray(specifications) ? specifications.length : 0;
    for (let i = 0; i < length; i += 1) { sent.push(specifications[i]); map.push(i); }
    return { sent, map };
  }
  for (let i = 0; i < specifications.length; i += 1) {
    try {
      normalizeCouponSpecification(specifications[i]);
      sent.push(specifications[i]);
      map.push(i);
    } catch (error) {
      outcomes[i] = {
        outcome: 'coupon-scope-shape-invalid',
        couponId: null,
        code: specifications[i] && specifications[i].code,
        error: { message: String(error && error.message).slice(0, 300) },
      };
    }
  }
  return { sent, map };
}

// Returns one outcome per INPUT specification, in input order. Never fewer, never reordered.
async function bulkCreateCoupons(wix, specifications, { onFallback } = {}) {
  // The batch is all-or-nothing and its per-item errors are the SAME error repeated
  // against every row, so one undecided specification has to be named locally, by code, before
  // the first request. Outside the try below deliberately: this is a caller bug, not a transport
  // failure, and retrying it one coupon at a time would spend a call per coupon to learn it again.
  if (Array.isArray(specifications)) specifications.forEach(assertCouponRedeemabilityDecided);
  const outcomes = new Array(specifications.length).fill(null);
  const { sent, map } = partitionRefusableCoupons(specifications, outcomes);
  // Every specification was refused locally: there is nothing to send, and no failure to report.
  if (sent.length === 0 && specifications.length > 0) return outcomes;
  // `sent` is what the server sees, so every index it reports is an index into `sent`. Results
  // are mapped back to input positions here and nowhere else.
  const merge = (sub) => { for (let i = 0; i < map.length; i += 1) outcomes[map[i]] = sub[i]; return outcomes; };
  const fallback = async (reason) => merge(await retryBatchIndividually(wix, sent, new Array(sent.length).fill(null), { onFallback, reason }));
  let response;
  try {
    response = await wix.send(buildBulkCreateCouponsRequest(sent));
  } catch (error) {
    rethrowRunStop(error);
    // A transport-level failure tells us nothing about individual specifications either.
    return fallback(`batch request failed: ${String(error && error.message).slice(0, 200)}`);
  }
  const results = (response && response.results) || [];
  if (results.length !== sent.length) {
    return fallback(`batch returned ${results.length} results for ${sent.length} specifications`);
  }
  // TRAP 4: the reported indexes must be a one-to-one cover of the request before ANY of them is
  // believed. Two results that both omit `originalIndex` both resolve to 0, so the second id
  // overwrites the first and one input is left with no outcome at all -- a coupon id attached to
  // the wrong code, which is the identity-corruption class this whole helper exists to avoid.
  // Nothing here guesses: a malformed cover means per-coupon reconciliation, not a best effort.
  const indexes = results.map((r) => ((r && r.itemMetadata) || {}).originalIndex ?? 0);
  const badIndex = indexes.find((i) => !Number.isInteger(i) || i < 0 || i >= sent.length);
  if (badIndex !== undefined) {
    return fallback(`batch reported originalIndex ${JSON.stringify(badIndex)}, which is not an index into a ${sent.length}-item request`);
  }
  if (new Set(indexes).size !== sent.length) {
    return fallback(`batch reported indexes [${indexes.join(', ')}] for ${sent.length} specifications -- not a one-to-one cover, so no result can be attributed to an input`);
  }
  const sub = new Array(sent.length).fill(null);
  let anyFailure = false;
  for (let i = 0; i < results.length; i += 1) {
    const meta = (results[i] && results[i].itemMetadata) || {};
    // `?? 0` -- see TRAP 2. Correlate by the index the server reports, not by position here.
    const index = indexes[i];
    if (meta.id && meta.error === undefined) {
      sub[index] = { outcome: 'coupon-written', couponId: String(meta.id), code: sent[index] && sent[index].code };
    } else {
      anyFailure = true;
    }
  }
  // TRAP 1: any failure invalidates the WHOLE batch's verdicts, including the successes, because
  // nothing was created and the errors name the wrong rows.
  if (anyFailure) {
    return fallback('the batch reported at least one failure; per-item errors from a failed batch are not per-item');
  }
  return merge(sub);
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

function couponErrorFields(error) {
  return {
    message: String(error && error.message).slice(0, 300),
    status: error && error.status,
    ...(wixAuth.isAuthExpired(error) ? { code: 'auth_expired', reason: 'auth_expired' } : {}),
  };
}

async function retryBatchIndividually(wix, specifications, outcomes, { onFallback, reason } = {}) {
  if (typeof onFallback === 'function') onFallback({ reason, count: specifications.length });
  for (let i = 0; i < specifications.length; i += 1) {
    if (outcomes[i]) continue;
    const code = specifications[i] && specifications[i].code;
    try {
      const created = await createCoupon(wix, specifications[i]);
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
      rethrowRunStop(error);
      const message = String(error && error.message);
      // "already exists" means the coupon IS on the target -- from this batch's own committed
      // write, or from an earlier run. Recover its id rather than calling it a failure.
      if (/already exists|ALREADY_EXISTS|duplicate/i.test(message)) {
        let reconciled = null;
        try { reconciled = await reconcileCouponByCode(wix, code); } catch (error) { rethrowRunStop(error); reconciled = null; }
        outcomes[i] = reconciled
          ? { outcome: 'coupon-reconciled-existing', couponId: String(reconciled.id), code, viaFallback: true, matchedAfter: 'duplicate-rejection' }
          : { outcome: 'coupon-write-unknown', couponId: null, code, viaFallback: true, reason: 'the code already exists but is not readable yet, so its id is unknown; re-read rather than re-writing' };
        continue;
      }
      outcomes[i] = {
        outcome: 'coupon-failed', couponId: null, code, viaFallback: true,
        error: couponErrorFields(error),
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

function _buildUpdateCouponRequest(couponId, changes) {
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
  const wait = pauseFor(wix, sleep);
  let status = null;
  try {
    await wix.send(buildUpdateCouponRequest(couponId, changes));
    status = 200;
  } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'coupon-update-failed', couponId, error: { message: String(error && error.message).slice(0, 300), status: error && error.status } };
  }
  await wait(settleMs);
  let readBack = null;
  try {
    readBack = await getCoupon(wix, couponId);
  } catch (error) {
    rethrowRunStop(error);
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

function _buildGetCouponRequest(couponId) {
  return { method: 'GET', url: `${WIXAPIS}/stores/v2/coupons/${encodeURIComponent(couponId)}` };
}
async function getCoupon(wix, couponId) {
  const response = await wix.send(buildGetCouponRequest(couponId));
  return (response && (response.coupon || response)) || null;
}

function _buildQueryCouponsRequest(query = { paging: { limit: 100, offset: 0 } }) {
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
function _buildCreateDiscountRuleRequest(discountRule) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/discount-rules`, body: { discountRule } };
}
async function createDiscountRule(wix, discountRule) {
  return (await wix.send(buildCreateDiscountRuleRequest(discountRule))).discountRule;
}
function _buildQueryDiscountRulesRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/discount-rules/query`, body: { query } };
}
async function queryDiscountRules(wix, query) {
  return (await wix.send(buildQueryDiscountRulesRequest(query))).discountRules || [];
}
function _buildDeleteDiscountRuleRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/ecom/v1/discount-rules/${encodeURIComponent(id)}` };
}
async function deleteDiscountRule(wix, id) {
  return wix.send(buildDeleteDiscountRuleRequest(id));
}

// --- Tax (Tax Groups / Tax Regions / Manual Tax Mappings) -------------------
// VERIFIED (2026-08-12): real calls against a live site. All three APIs live under
// `/billing/v1/...`, NOT `/ecom/v1/...` — a naming trap, since discount-rules/coupons above are
// `/ecom/v1/...`/`/stores/v2/...`. Cooperating model (dev.wix.com "About the Tax APIs"):
//   - Tax Group: a bucket of products with the same tax treatment. Carries NO rate itself.
//     Every site already HAS default groups (Products, Shipping and delivery, Services,
//     Cancellation fees; their ids are per site) — `listDefaultTaxGroups`
//     returns those; `queryTaxGroups` returns ONLY custom groups a site created, never the
//     defaults (the "most common mistake" per Wix's own docs). A product joins a group via
//     the Stores Catalog V3 product's own `taxGroupId` field (Update Product), not any call
//     in this file — that's a plain Stores product write, already covered by the product
//     writer's PATCH path.
//   - Tax Region: a country[/subdivision] bound to ONE tax calculator app (`appId`). NEVER
//     hardcode the appId — it is installation-scoped. Resolve it live via `listTaxCalculators`
//     first. Verified 2026-08-12: the two installed calculators were "Wix Manual Tax
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
//     `calculateTax` call against a live site with a genuinely mapping-less group next to a 7%-
//     mapped control group in the same request/region. This is the correct, simpler primitive
//     for "this product is tax-exempt" (WooCommerce `tax_status: "none"`): create ONE tax
//     group for it and DO NOT create any manual tax mapping for that group in any region — no
//     need to enumerate every country/region the exempt product might ship to.
function _buildCreateTaxGroupRequest(taxGroup) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-groups`, body: { taxGroup } };
}
async function createTaxGroup(wix, taxGroup) {
  return (await wix.send(buildCreateTaxGroupRequest(taxGroup))).taxGroup;
}
function _buildQueryTaxGroupsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-groups/query`, body: { query } };
}
// Returns ONLY custom tax groups this site created — NEVER the built-in defaults (Products,
// Shipping and delivery, ...). Call `listDefaultTaxGroups` for those. See the READ/RETURN
// CONTRACT at the top of this file: ONE PAGE, unwrapped to the array.
async function queryTaxGroups(wix, query) {
  return (await wix.send(buildQueryTaxGroupsRequest(query))).taxGroups || [];
}
function _buildListDefaultTaxGroupsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/billing/v1/tax-groups/default-tax-groups` };
}
async function listDefaultTaxGroups(wix) {
  return (await wix.send(buildListDefaultTaxGroupsRequest())).taxGroups || [];
}
function _buildDeleteTaxGroupRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/billing/v1/tax-groups/${encodeURIComponent(id)}` };
}
async function deleteTaxGroup(wix, id) {
  return wix.send(buildDeleteTaxGroupRequest(id));
}
function _buildListTaxCalculatorsRequest() {
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
function _buildCreateTaxRegionRequest(taxRegion) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-regions`, body: { taxRegion } };
}
async function createTaxRegion(wix, taxRegion) {
  return (await wix.send(buildCreateTaxRegionRequest(taxRegion))).taxRegion;
}
function _buildQueryTaxRegionsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-regions/query`, body: { query } };
}
// ONE PAGE, unwrapped to the taxRegions array — see the READ/RETURN CONTRACT at the top of this file.
async function queryTaxRegions(wix, query) {
  return (await wix.send(buildQueryTaxRegionsRequest(query))).taxRegions || [];
}
function _buildDeleteTaxRegionRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/billing/v1/tax-regions/${encodeURIComponent(id)}` };
}
async function deleteTaxRegion(wix, id) {
  return wix.send(buildDeleteTaxRegionRequest(id));
}
function _buildCreateManualTaxMappingRequest(manualTaxMapping) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/manual-tax-mappings`, body: { manualTaxMapping } };
}
async function createManualTaxMapping(wix, manualTaxMapping) {
  return (await wix.send(buildCreateManualTaxMappingRequest(manualTaxMapping))).manualTaxMapping;
}
function _buildQueryManualTaxMappingsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/manual-tax-mappings/query`, body: { query } };
}
// ONE PAGE, unwrapped to the manualTaxMappings array — see the READ/RETURN CONTRACT at the top of this file.
async function queryManualTaxMappings(wix, query) {
  return (await wix.send(buildQueryManualTaxMappingsRequest(query))).manualTaxMappings || [];
}
function _buildDeleteManualTaxMappingRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/billing/v1/manual-tax-mappings/${encodeURIComponent(id)}` };
}
async function deleteManualTaxMapping(wix, id) {
  return wix.send(buildDeleteManualTaxMappingRequest(id));
}
// Site-level, single-resource settings (one per site, not a crosswalked entity) — the direct
// counterpart of WooCommerce's `GET /wc/v3/settings/tax` `woocommerce_prices_include_tax`.
// VERIFIED live 2026-08-12: a fresh site's default `taxIncludedInItemPrices: false` matches
// WooCommerce `woocommerce_prices_include_tax: "no"`, so no update call is needed when the source
// uses "no" — Upsert is still implemented for a source site where the two differ.
function _buildGetTaxSettingsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/billing/v1/tax-settings` };
}
async function getTaxSettings(wix) {
  return (await wix.send(buildGetTaxSettingsRequest())).taxSettings;
}
function _buildUpsertTaxSettingsRequest(taxSettings) {
  return { method: 'POST', url: `${WIXAPIS}/billing/v1/tax-settings`, body: { taxSettings } };
}
async function upsertTaxSettings(wix, taxSettings) {
  return (await wix.send(buildUpsertTaxSettingsRequest(taxSettings))).taxSettings;
}

// --- Delivery Profiles / Delivery Regions / Delivery Carriers ---------------
// VERIFIED (2026-08-12): real calls against a live site. All under `/ecom/v1/...`.
// Model (dev.wix.com "Delivery Profiles"): a DeliveryProfile is a named bundle of
// DeliveryRegions; every site has exactly one `default: true` profile, auto-created when Wix
// Stores/Bookings/Events/Restaurants is installed (a fresh site's is "General profile", pre-existing
// with "Domestic"/"International" regions from that auto-creation, NOT from any WooCommerce
// data — do not assume default-profile regions already reflect the source site's real zones).
// A DeliveryRegion matches on `destinations[]` (country/subdivision only — no continent, no
// postcode) and carries `deliveryCarriers[]`, each ONE app (`appId`) + a `backupRate` (used
// whenever the carrier doesn't return its own live rate, or unconditionally when
// `backupRate.active: true` — this is the mechanism for a flat/free rate with no real courier
// integration). `listInstalledDeliveryCarriers` (VERIFIED live 2026-08-12) returned:
// "Pickup", "Basic Shipping" (id 45c44b27-..., a fixed cross-site constant — see
// shipping-build.js), "Calculated by USPS" (real carrier calc, no data equivalent), "Local
// delivery". `addDeliveryCarrier` REQUIRES `backupRate.amount` even for a real-carrier app.
// REVISION GOTCHA (hit live 2026-08-12): EVERY mutating call against a
// delivery profile — addDeliveryRegion AND addDeliveryCarrier, not just the region call — bumps
// `revision` and returns the new one on `deliveryProfile.revision`. A caller doing several
// region/carrier writes in sequence must carry that returned revision into the NEXT
// addDeliveryRegion/removeDeliveryRegion call, not re-use the value from the original
// queryDeliveryProfiles — passing a stale revision 409s with INVALID_REVISION. (addDeliveryCarrier
// itself does not take a revision parameter, so this only bites the next add/removeDeliveryRegion
// call after one or more addDeliveryCarrier calls.)
// FIELD NAME, LIVE-VERIFIED 2026-09-27: a DeliveryProfile's region list is `deliveryRegions` on
// every real API response — there is no `.regions` field at all. Documenting that in a pitfall
// (domains/ecom/entities/delivery-profile.json) stopped THIS file's own callers from repeating
// the mistake, but did nothing for a future caller — generated or hand-written — who reaches for
// `.regions` without having read that doc first; they would silently get `undefined`/`[]` again,
// the exact failure this pitfall exists to prevent. Every function here
// that returns a DeliveryProfile therefore normalizes it through this helper, which adds a
// `regions` alias mirroring `deliveryRegions` — so EITHER name works, and the mistake this
// pitfall documents cannot recur through this library's own return values, only through a caller
// reading the raw HTTP response directly (which none of this file's callers should ever do).
function withRegionsAlias(deliveryProfile) {
  if (!deliveryProfile || typeof deliveryProfile !== 'object') return deliveryProfile;
  // BUG FIX: the guard used to check only that the `deliveryRegions` KEY
  // is present, not that its value is an array. A `deliveryRegions: null` response (a plausible
  // protobuf-JSON encoding of an empty repeated field on a freshly created/empty profile, not
  // covered by the tests, which only exercise the key being fully absent) fell through to
  // spreading null below, throwing `TypeError: null is not iterable` instead of returning the
  // profile untouched.
  if ('regions' in deliveryProfile || !Array.isArray(deliveryProfile.deliveryRegions)) return deliveryProfile;
  // BUG FIX: a bare `regions: deliveryProfile.deliveryRegions` aliases the
  // SAME array object -- the two names are only safely interchangeable for reads. A caller doing
  // `profile.regions.push(newRegion)` instead of reassigning the property would also mutate
  // `deliveryRegions` in place, silently breaking the "either name works" guarantee this helper
  // documents. A shallow copy of the array is cheap (every caller here is a single fresh network
  // response, never a hot loop) and makes the two names genuinely independent, closing the gap
  // outright rather than just documenting it as read-only.
  // BUG FIX: the array-container copy above still shared each REGION
  // object (and its own `deliveryCarriers` array) by reference between `.regions` and
  // `.deliveryRegions` -- `profile.regions[0].name = 'x'` or
  // `profile.regions.find(...).deliveryCarriers.push(x)` would still silently mutate
  // `deliveryRegions` too. Clone each region one level deep, and its `deliveryCarriers` array if
  // present, closing the two mutation shapes this helper's own comment already promises are
  // independent -- still cheap for the same reason (one fresh response, at most ~100
  // regions/profile per the cap documented in delivery-profile.json).
  return {
    ...deliveryProfile,
    regions: deliveryProfile.deliveryRegions.map((region) => {
      if (!region || typeof region !== 'object') return region;
      return Array.isArray(region.deliveryCarriers)
        ? { ...region, deliveryCarriers: [...region.deliveryCarriers] }
        : { ...region };
    }),
  };
}
function _buildCreateDeliveryProfileRequest(deliveryProfile) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles`, body: { deliveryProfile } };
}
async function createDeliveryProfile(wix, deliveryProfile) {
  return withRegionsAlias((await wix.send(buildCreateDeliveryProfileRequest(deliveryProfile))).deliveryProfile);
}
function _buildGetDeliveryProfileRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/delivery-profiles/${encodeURIComponent(id)}` };
}
async function getDeliveryProfile(wix, id) {
  return withRegionsAlias((await wix.send(buildGetDeliveryProfileRequest(id))).deliveryProfile);
}
function _buildQueryDeliveryProfilesRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles/query`, body: { query } };
}
// ONE PAGE, unwrapped to the deliveryProfiles array — see the READ/RETURN CONTRACT at the top of
// this file. Includes the site's default profile — filter on `.default` yourself if you need
// only custom ones.
async function queryDeliveryProfiles(wix, query) {
  return ((await wix.send(buildQueryDeliveryProfilesRequest(query))).deliveryProfiles || []).map(withRegionsAlias);
}
// NOTE the URL shape here is a path param (.../{deliveryProfileId}/delivery-region), unlike
// add-delivery-carrier/remove-delivery-carrier below which are flat URLs with body params —
// a real, verified API inconsistency, not a typo. `revision` is optional (the delivery
// profile's current `revision`, for optimistic-concurrency conflict detection) but recommended
// when the caller already has it from a preceding query/get.
function _buildAddDeliveryRegionRequest(deliveryProfileId, deliveryRegion, revision) {
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
// FIELD NAME, LIVE-VERIFIED 2026-09-27: the returned deliveryProfile's regions array is
// `deliveryRegions`, not `regions` -- there is no `.regions` field on the real API response at
// all. That failure (addDeliveryRegion returned 200, the region existed,
// and the very next line's `profile.regions.find(...)` came back empty) is why this return value
// is normalized through `withRegionsAlias` below -- a caller reading either name now works.
async function addDeliveryRegion(wix, deliveryProfileId, deliveryRegion, revision) {
  return withRegionsAlias((await wix.send(buildAddDeliveryRegionRequest(deliveryProfileId, deliveryRegion, revision))).deliveryProfile);
}
// LIVE-VERIFIED 2026-09-27: removing a region cascades its own carriers -- a
// bare removeDeliveryRegion(profileId, regionId, revision) call on a region that still has an
// active deliveryCarrier (e.g. an auto-created placeholder region bound to Basic Shipping)
// returns 200 and the returned profile has BOTH the region and its carrier gone, in one call. A
// separate removeDeliveryCarrier call first is not required (this was previously an open
// question -- see ecom-delivery-profile.json's revision-sequencing note).
function _buildRemoveDeliveryRegionRequest(deliveryProfileId, deliveryRegionId, revision) {
  const url = new URL(`${WIXAPIS}/ecom/v1/delivery-profiles/${encodeURIComponent(deliveryProfileId)}/delivery-region/${encodeURIComponent(deliveryRegionId)}`);
  if (revision !== undefined) url.searchParams.set('revision', revision);
  return { method: 'DELETE', url: url.toString() };
}
async function removeDeliveryRegion(wix, deliveryProfileId, deliveryRegionId, revision) {
  return withRegionsAlias((await wix.send(buildRemoveDeliveryRegionRequest(deliveryProfileId, deliveryRegionId, revision))).deliveryProfile);
}
// UPDATE one region in place. LIVE-VERIFIED 2026-10-28 on a throwaway site: renames a
// region and replaces its destinations; its carriers and shipping options are untouched (they have
// their own calls). `revision` is the profile's current revision.
function _buildUpdateDeliveryRegionRequest(deliveryProfileId, deliveryRegion, revision) {
  if (!deliveryRegion || !deliveryRegion.id) throw new Error('buildUpdateDeliveryRegionRequest: deliveryRegion.id is required');
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/ecom/v1/delivery-profiles/${encodeURIComponent(deliveryProfileId)}/delivery-region/${encodeURIComponent(deliveryRegion.id)}`,
    body: { deliveryRegion, ...(revision !== undefined ? { revision } : {}) },
  };
}
async function updateDeliveryRegion(wix, deliveryProfileId, deliveryRegion, revision) {
  return withRegionsAlias((await wix.send(buildUpdateDeliveryRegionRequest(deliveryProfileId, deliveryRegion, revision))).deliveryProfile);
}

// DESTINATIONS_COLLISION, LIVE-VERIFIED 2026-10-28 on a throwaway site. Inside one
// profile Wix refuses (428) a region that repeats a destination another region already has: the
// same whole country twice, or the same subdivision twice. A subdivision inside a country another
// region covers whole is accepted, and the rest-of-world region (no destinations) collides with
// nothing. A new site's default profile already holds the site's own country whole ("Domestic")
// plus a rest-of-world region, each with a carrier and an unconditional "Free shipping" option, so
// a source zone for the store's home country ALWAYS collided on a plain addDeliveryRegion (a live
// migration on 2026-10-28, IL).
function destinationAtoms(destinations) {
  const atoms = new Map();
  for (const destination of destinations || []) {
    const country = String((destination && destination.countryCode) || '').toUpperCase();
    if (!country) continue;
    const subdivisions = (destination.subdivisions || []).map(String);
    for (const subdivision of subdivisions.length ? subdivisions : [null]) {
      const key = `${country}:${subdivision || '*'}`;
      atoms.set(key, { key, countryCode: country, subdivision });
    }
  }
  return atoms;
}
function destinationsFromAtoms(atoms) {
  const byCountry = new Map();
  for (const atom of atoms) {
    if (!byCountry.has(atom.countryCode)) byCountry.set(atom.countryCode, []);
    if (atom.subdivision) byCountry.get(atom.countryCode).push(atom.subdivision);
  }
  return [...byCountry].map(([countryCode, subdivisions]) => ({ countryCode, subdivisions }));
}
const describeAtom = (atom) => atom.subdivision || atom.countryCode;

// Pure: what ensureDeliveryRegion writes for `deliveryRegion` on `profile`, never a colliding add.
//   - a region with exactly these destinations: reuse it (update only a differing name/active);
//   - one region that collides and covers nothing beyond these destinations: update it to them;
//   - otherwise add a region with the destinations nobody covers yet, or, when every destination is
//     already covered, reuse the region covering most of them.
// Destinations left on another region are listed in `coveredElsewhere`; nothing is ever narrowed
// or removed, so no buyer loses a delivery route the site already had.
function planDeliveryRegionWrite(profile, deliveryRegion) {
  if (!deliveryRegion || !Array.isArray(deliveryRegion.destinations)) throw new Error('planDeliveryRegionWrite: deliveryRegion.destinations is required');
  const want = destinationAtoms(deliveryRegion.destinations);
  const regions = (profile && (profile.deliveryRegions || profile.regions)) || [];
  const named = (region) => ({
    id: region.id,
    name: deliveryRegion.name || region.name,
    active: deliveryRegion.active === undefined ? region.active : deliveryRegion.active,
  });
  const sameKeys = (a, b) => a.size === b.size && [...a.keys()].every((key) => b.has(key));
  if (want.size) {
    const exact = regions.find((region) => sameKeys(destinationAtoms(region.destinations), want));
    if (exact) {
      const changed = (deliveryRegion.name && deliveryRegion.name !== exact.name) || (deliveryRegion.active !== undefined && deliveryRegion.active !== exact.active);
      return { action: changed ? 'update' : 'reuse', regionId: exact.id, region: changed ? { ...named(exact), destinations: exact.destinations } : null, coveredElsewhere: [] };
    }
  }
  const colliders = regions
    .map((region) => {
      const atoms = destinationAtoms(region.destinations);
      return { region, atoms, overlap: [...want.values()].filter((atom) => atoms.has(atom.key)) };
    })
    .filter((entry) => entry.overlap.length);
  if (!colliders.length) return { action: 'add', regionId: null, region: { ...deliveryRegion }, coveredElsewhere: [] };
  if (colliders.length === 1 && [...colliders[0].atoms.keys()].every((key) => want.has(key))) {
    const { region } = colliders[0];
    return { action: 'update', regionId: region.id, region: { ...named(region), destinations: deliveryRegion.destinations }, coveredElsewhere: [] };
  }
  const taken = new Set(colliders.flatMap((entry) => entry.overlap.map((atom) => atom.key)));
  const free = [...want.values()].filter((atom) => !taken.has(atom.key));
  if (free.length) {
    const coveredElsewhere = colliders.flatMap((entry) => entry.overlap.map((atom) => ({ destination: describeAtom(atom), regionId: entry.region.id, regionName: entry.region.name || null })));
    return { action: 'add', regionId: null, region: { ...deliveryRegion, destinations: destinationsFromAtoms(free) }, coveredElsewhere };
  }
  // Every destination is covered. Prefer the region an earlier run added for this zone (all its
  // destinations inside the zone), then one with the zone's name, then the widest overlap, so a
  // rerun resolves the zone to the same region it did the first time.
  const inside = (entry) => [...entry.atoms.keys()].every((key) => want.has(key));
  const rank = (entry) => [inside(entry) ? 1 : 0, deliveryRegion.name && entry.region.name === deliveryRegion.name ? 1 : 0, entry.overlap.length];
  const better = (a, b) => { const [x, y] = [rank(a), rank(b)]; for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  const best = colliders.reduce((top, entry) => (better(entry, top) ? entry : top));
  const coveredElsewhere = colliders.filter((entry) => entry !== best)
    .flatMap((entry) => entry.overlap.map((atom) => ({ destination: describeAtom(atom), regionId: entry.region.id, regionName: entry.region.name || null })));
  const widerBy = [...best.atoms.values()].filter((atom) => !want.has(atom.key)).map(describeAtom);
  return { action: 'reuse', regionId: best.region.id, region: null, coveredElsewhere, widerBy };
}

const DELIVERY_REGION_RETRY_CODES = new Set(['DESTINATIONS_COLLISION', 'INVALID_REVISION']);
function deliveryRegionErrorCode(error) {
  const code = error && (error.applicationErrorCode || (error.body && error.body.details && error.body.details.applicationError && error.body.details.applicationError.code));
  if (code) return code;
  const match = /"code"\s*:\s*"([A-Z_]+)"/.exec(String((error && error.message) || ''));
  return match ? match[1] : null;
}

// The reviewed delivery-region writer: reads the profile, then reuses, updates or adds per
// planDeliveryRegionWrite. A collision or stale revision re-reads and re-plans once (the plan is
// rebuilt from the fresh profile, so nobody's newer edit is overwritten blindly); a collision that
// survives returns `collision-unresolved` with a finding instead of throwing, so one zone never
// stops the import. Any other error is thrown as before.
// Returns { action: added|updated|reused|collision-unresolved, deliveryProfileId, deliveryRegionId,
//   deliveryRegion, coveredElsewhere[], existingShippingOptions[], findings[] }. A reused or
// updated region may already carry options the source never had (a new site's "Free shipping");
// they are listed here, never deleted; the shipping stage decides (runShippingOptionStage).
async function ensureDeliveryRegion(wix, deliveryRegion, { deliveryProfileId = null } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const profiles = await queryDeliveryProfiles(wix);
    const profile = deliveryProfileId ? profiles.find((p) => p.id === deliveryProfileId) : (profiles.find((p) => p.default) || profiles[0]);
    if (!profile) throw new Error(`ensureDeliveryRegion: ${deliveryProfileId ? `delivery profile ${deliveryProfileId} not found` : 'the site has no delivery profile'}`);
    const plan = planDeliveryRegionWrite(profile, deliveryRegion);
    let out;
    try {
      if (plan.action === 'reuse') out = profile;
      else if (plan.action === 'update') out = await updateDeliveryRegion(wix, profile.id, plan.region, profile.revision);
      else out = await addDeliveryRegion(wix, profile.id, plan.region, profile.revision);
    } catch (error) {
      if (!DELIVERY_REGION_RETRY_CODES.has(deliveryRegionErrorCode(error))) throw error;
      lastError = error;
      continue;
    }
    const regions = (out && (out.deliveryRegions || out.regions)) || [];
    const addedKey = plan.action === 'add' ? [...destinationAtoms(plan.region.destinations).keys()].sort().join('|') : null;
    const region = plan.regionId
      ? regions.find((r) => r.id === plan.regionId)
      : regions.find((r) => [...destinationAtoms(r.destinations).keys()].sort().join('|') === addedKey && r.name === plan.region.name)
        || regions.find((r) => [...destinationAtoms(r.destinations).keys()].sort().join('|') === addedKey);
    const action = { add: 'added', update: 'updated', reuse: 'reused' }[plan.action];
    const findings = [];
    let existingShippingOptions = [];
    if (region && plan.action !== 'add') {
      const scan = await queryAllShippingOptions(wix, { deliveryRegionId: region.id });
      existingShippingOptions = scan.options.map((option) => ({ id: option.id, title: option.title || null }));
      if (existingShippingOptions.length || !scan.complete) {
        findings.push({ code: 'delivery-region-has-existing-options', regionId: region.id, options: existingShippingOptions, complete: scan.complete,
          message: `Region "${region.name}" already had ${existingShippingOptions.map((o) => `"${o.title}"`).join(', ') || 'options that could not be listed'} when this zone was written. The shipping stage tells the migration's own options from the rest.` });
      }
    }
    if (plan.action !== 'add' && region) findings.push({ code: 'delivery-region-reused', regionId: region.id, previousName: (profile.deliveryRegions || profile.regions || []).find((r) => r.id === region.id)?.name || null, action,
      message: `The site already covered ${(deliveryRegion.destinations || []).map((d) => d.countryCode).join(', ')}; the zone uses existing region "${region.name}" instead of adding a second one.` });
    if (plan.widerBy && plan.widerBy.length) findings.push({ code: 'delivery-region-shared-with-wider-region', regionId: plan.regionId, widerBy: plan.widerBy,
      message: `Region "${region ? region.name : plan.regionId}" also covers ${plan.widerBy.join(', ')}; the zone's rates apply there too.` });
    if (plan.coveredElsewhere.length) findings.push({ code: 'delivery-region-destinations-covered-elsewhere', coveredElsewhere: plan.coveredElsewhere,
      message: `Already covered by other regions, so the zone's rates do not apply there: ${plan.coveredElsewhere.map((c) => `${c.destination} (${c.regionName || c.regionId})`).join(', ')}.` });
    return { action, deliveryProfileId: profile.id, deliveryRegionId: region ? region.id : null, deliveryRegion: region || null,
      coveredElsewhere: plan.coveredElsewhere, existingShippingOptions, findings };
  }
  const code = deliveryRegionErrorCode(lastError);
  return { action: 'collision-unresolved', deliveryProfileId: null, deliveryRegionId: null, deliveryRegion: null, coveredElsewhere: [], existingShippingOptions: [],
    findings: [{ code: 'delivery-region-collision-unresolved', errorCode: code,
      message: `Wix refused the region twice (${code}) after a fresh read; nothing was added. Add the zone's rates by hand in Settings → Shipping & delivery.` }] };
}
function _buildAddDeliveryCarrierRequest(deliveryRegionId, deliveryCarrier) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles/add-delivery-carrier`, body: { deliveryRegionId, deliveryCarrier } };
}
async function addDeliveryCarrier(wix, deliveryRegionId, deliveryCarrier) {
  return withRegionsAlias((await wix.send(buildAddDeliveryCarrierRequest(deliveryRegionId, deliveryCarrier))).deliveryProfile);
}
function _buildRemoveDeliveryCarrierRequest(deliveryRegionId, appId) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/delivery-profiles/remove-delivery-carrier`, body: { deliveryRegionId, appId } };
}
async function removeDeliveryCarrier(wix, deliveryRegionId, appId) {
  return withRegionsAlias((await wix.send(buildRemoveDeliveryCarrierRequest(deliveryRegionId, appId))).deliveryProfile);
}
function _buildListInstalledDeliveryCarriersRequest() {
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
// `deliveryRegionId`, with its own `rates[]` (amount + conditions). VERIFIED live: the two
// regions Wix auto-created at Stores install ("Domestic"/"International") each already had a
// real ShippingOption ("Free shipping", $0); the regions this pipeline created via
// addDeliveryRegion/addDeliveryCarrier had backupRate set correctly but NO
// ShippingOption at all — confirmed via listDeliveryCarriers' dashboardTables (the same view
// backing the dashboard's own warning) showing zero rows for those regions despite a
// correctly-shaped, active backupRate existing on the DeliveryCarrier object. A delivery-region
// migration is INCOMPLETE without a matching ShippingOption per region — backupRate alone
// silently produces a checkout-blocking region despite a fully successful, correctly-shaped API
// write. See delivery-profile.json's shipping-options-not-backup-rate-drive-checkout pitfall.
function _buildCreateShippingOptionRequest(shippingOption) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/shipping-options`, body: { shippingOption } };
}
async function createShippingOption(wix, shippingOption) {
  return (await wix.send(buildCreateShippingOptionRequest(shippingOption))).shippingOption;
}
function _buildQueryShippingOptionsRequest(query = { cursorPaging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/shipping-options/query`, body: { query } };
}
// ONE PAGE, unwrapped to the shippingOptions array — see the READ/RETURN CONTRACT at the top of
// this file. Filter on `.deliveryRegionId` yourself to find what's already covering a region.
async function queryShippingOptions(wix, query) {
  return (await wix.send(buildQueryShippingOptionsRequest(query))).shippingOptions || [];
}

// --- Shipping Options: verified create, exhaustive scan, recovery ----------------
// A 200 from create proves the request was accepted, not that every field landed: the misspelled
// `estimateDeliveryTime` was accepted and dropped on every migration until the field fix. So a write
// counts only when its read-back matches, and an unknown outcome is reconciled, never re-sent.
function _buildGetShippingOptionRequest(id) {
  if (!id) throw new Error('buildGetShippingOptionRequest: id is required');
  return { method: 'GET', url: `${WIXAPIS}/ecom/v1/shipping-options/${encodeURIComponent(id)}` };
}
// Returns the stored option only when the 2xx body is the REQUESTED option. An absent, non-object
// or different-id body is null -- an unknown read -- so no caller can verify, PATCH or crosswalk a
// different option than the one it asked for.
async function getShippingOption(wix, id) {
  const reply = await wix.send(buildGetShippingOptionRequest(id));
  const option = reply && reply.shippingOption;
  if (!option || typeof option !== 'object' || Array.isArray(option) || option.id !== id) return null;
  return option;
}
// Estimate-only update: the one known loss signature is repaired with exactly this field, never a
// re-send of rates or title.
function _buildUpdateShippingOptionEstimateRequest({ id, revision, estimatedDeliveryTime }) {
  if (!id) throw new Error('buildUpdateShippingOptionEstimateRequest: id is required');
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/ecom/v1/shipping-options/${encodeURIComponent(id)}`,
    body: { shippingOption: { id, ...(revision !== undefined && revision !== null ? { revision } : {}), estimatedDeliveryTime } },
  };
}

// LIVE-VERIFIED 2026-10-28 on a throwaway site: DELETE returns 200 {}; a read-back and a second
// delete both return 404 NOT_FOUND. A 404 is reported as already gone, not as a failure.
function _buildDeleteShippingOptionRequest(id) {
  if (!id) throw new Error('buildDeleteShippingOptionRequest: id is required');
  return { method: 'DELETE', url: `${WIXAPIS}/ecom/v1/shipping-options/${encodeURIComponent(id)}` };
}
async function deleteShippingOption(wix, id) {
  try {
    await wix.send(buildDeleteShippingOptionRequest(id));
    return { deleted: true, alreadyGone: false };
  } catch (error) {
    rethrowRunStop(error);
    if (error && error.status === 404) return { deleted: false, alreadyGone: true };
    throw error;
  }
}

const SHIPPING_OPTION_PAGE_LIMIT = 100;
const SHIPPING_OPTION_MAX_PAGES = 1000;
function shippingOptionInRegion(option, deliveryRegionId) {
  if (!deliveryRegionId) return true;
  if (option && option.deliveryRegionId === deliveryRegionId) return true;
  return Array.isArray(option && option.deliveryRegionIds) && option.deliveryRegionIds.includes(deliveryRegionId);
}
// Cursor to exhaustion. Any failed page makes the whole scan INCOMPLETE ({ complete: false }) -- a
// partial snapshot cannot prove which options already existed, so callers must not write on it.
// The region filter is applied client-side on the full listing: the snapshot's correctness then
// does not depend on a server-side filter name for the repeated field.
async function queryAllShippingOptions(wix, { deliveryRegionId = null, limit = SHIPPING_OPTION_PAGE_LIMIT } = {}) {
  const options = [];
  const seenCursors = new Set();
  let cursor = null;
  let pages = 0;
  for (;;) {
    if (pages >= SHIPPING_OPTION_MAX_PAGES) return { complete: false, options, pages, reason: 'page limit reached' };
    let reply;
    try {
      reply = await wix.send(buildQueryShippingOptionsRequest({ cursorPaging: { limit, ...(cursor ? { cursor } : {}) } }));
    } catch (error) {
      rethrowRunStop(error);
      return { complete: false, options, pages, reason: `page ${pages + 1} failed: ${error && error.message ? String(error.message).slice(0, 200) : 'unknown error'}`, error };
    }
    pages += 1;
    if (!reply || !Array.isArray(reply.shippingOptions)) return { complete: false, options, pages, reason: `page ${pages} had no shippingOptions array` };
    for (const option of reply.shippingOptions) if (shippingOptionInRegion(option, deliveryRegionId)) options.push(option);
    const next = reply.pagingMetadata && reply.pagingMetadata.cursors && reply.pagingMetadata.cursors.next;
    if (!next) return { complete: true, options, pages };
    if (seenCursors.has(next)) return { complete: false, options, pages, reason: 'repeated cursor' };
    seenCursors.add(next);
    cursor = next;
  }
}

function shippingOptionErrorFields(error) {
  return {
    httpStatus: error && Number.isInteger(error.status) ? error.status : null,
    errorCode: (error && (error.applicationErrorCode || (error.body && error.body.details && error.body.details.applicationError && error.body.details.applicationError.code))) || null,
  };
}

// Verify a stored option against what was sent; repair ONLY a blank estimate with everything else
// matching (one PATCH, then read back again). `merchantKeeps` is the recovery rule: a non-empty,
// different stored estimate is the merchant's and is kept.
async function verifyOrRepairShippingOption(wix, sent, stored, { merchantKeeps = false } = {}) {
  const { verifyShippingOptionReadBack } = require('./shipping-build.js');
  const id = stored && stored.id;
  if (!id) return { outcome: 'shipping-option-unverified', id: null, mismatched: [], reason: 'read-back failed', stored };
  const others = verifyShippingOptionReadBack(sent, stored, { ignoreEstimate: true });
  if (!others.ok) {
    const full = verifyShippingOptionReadBack(sent, stored);
    return { outcome: 'shipping-option-unverified', id, mismatched: full.mismatched, reason: `read-back mismatch: ${full.mismatched.join(', ')}`, stored };
  }
  const sentEstimate = typeof sent.estimatedDeliveryTime === 'string' ? sent.estimatedDeliveryTime : '';
  const storedEstimate = typeof stored.estimatedDeliveryTime === 'string' ? stored.estimatedDeliveryTime : '';
  if (sentEstimate === storedEstimate) return { outcome: 'shipping-option-created', id, stored };
  if (storedEstimate !== '') {
    if (merchantKeeps) return { outcome: 'shipping-option-created', id, estimateKept: 'merchant', stored };
    return { outcome: 'shipping-option-unverified', id, mismatched: ['estimatedDeliveryTime'], reason: 'read-back mismatch: estimatedDeliveryTime', stored };
  }
  // The one known loss signature: a blank stored estimate, everything else matching.
  try {
    await wix.send(buildUpdateShippingOptionEstimateRequest({ id, revision: stored.revision, estimatedDeliveryTime: sentEstimate }));
  } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'shipping-option-unverified', id, mismatched: ['estimatedDeliveryTime'], reason: 'estimate repair PATCH failed', stored };
  }
  let reread;
  try {
    reread = await getShippingOption(wix, id);
  } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'shipping-option-unverified', id, mismatched: [], reason: 'read-back failed after estimate repair', stored };
  }
  if (!reread) return { outcome: 'shipping-option-unverified', id, mismatched: [], reason: 'read-back failed after estimate repair', stored };
  const check = verifyShippingOptionReadBack(sent, reread);
  return check.ok
    ? { outcome: 'shipping-option-created', id, repaired: 'estimatedDeliveryTime', stored: reread }
    : { outcome: 'shipping-option-unverified', id, mismatched: check.mismatched, reason: `read-back mismatch after estimate repair: ${check.mismatched.join(', ')}`, stored: reread };
}

// Never throws; every path returns a result for shippingOptionWriteRecord.
async function createShippingOptionVerified(wix, shippingOption) {
  let created;
  try {
    created = await createShippingOption(wix, shippingOption);
  } catch (error) {
    rethrowRunStop(error);
    // Refused before sending: known, nothing reached Wix, so never "unknown" (read back forever).
    if (error && error.requestSent === false) {
      return { outcome: 'shipping-option-failed', id: null, httpStatus: null, errorCode: error.code ? String(error.code) : null, requestSent: false };
    }
    if (error && error.outcomeKnown === true) {
      return { outcome: 'shipping-option-failed', id: null, ...shippingOptionErrorFields(error) };
    }
    return { outcome: 'shipping-option-unknown', id: null, reason: error && error.status ? `unreadable reply (HTTP ${error.status})` : 'no reply (transport failure)', ...shippingOptionErrorFields(error) };
  }
  if (!created || !created.id) return { outcome: 'shipping-option-unknown', id: null, reason: 'create replied 2xx without shippingOption.id', httpStatus: null, errorCode: null };
  let stored;
  try {
    stored = await getShippingOption(wix, created.id);
  } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'shipping-option-unverified', id: created.id, mismatched: [], reason: 'read-back failed' };
  }
  if (!stored) return { outcome: 'shipping-option-unverified', id: created.id, mismatched: [], reason: 'read-back failed' };
  return verifyOrRepairShippingOption(wix, shippingOption, stored, { merchantKeeps: false });
}

function userDecisionValue(decisions, key) {
  const entry = decisions && typeof decisions === 'object' ? decisions[key] : undefined;
  if (!entry || typeof entry !== 'object' || entry.source !== 'user') return null;
  const value = entry.value;
  return value === undefined || value === null ? null : String(value).trim();
}

// Recovery for a row --unresolved-only selects (`started` / `succeeded_unverified`). It never
// POSTs. An incomplete region scan returns `shipping-option-recovery-incomplete`: the caller
// writes nothing, so the row stays unresolved exactly as it was.
async function recoverShippingOption(wix, attemptRow, expectedInput, { decisions = {} } = {}) {
  if (!attemptRow || !expectedInput) throw new Error('recoverShippingOption: attemptRow and expectedInput are required');
  const { verifyShippingOptionReadBack } = require('./shipping-build.js');
  const failure = attemptRow.failure || {};
  const reconcile = attemptRow.reconcile || {};
  const optionKey = attemptRow.sourceId || failure.sourceId;
  const verifyCandidate = async (id) => {
    let stored;
    try {
      stored = await getShippingOption(wix, id);
    } catch (error) {
      rethrowRunStop(error);
      if (error && error.status === 404 && error.outcomeKnown !== false) return { outcome: 'shipping-option-not-found', id, httpStatus: 404, errorCode: 'NOT_FOUND' };
      return { outcome: 'shipping-option-recovery-incomplete', id, reason: 'read-back failed' };
    }
    if (!stored) return { outcome: 'shipping-option-recovery-incomplete', id, reason: 'read-back failed' };
    return verifyOrRepairShippingOption(wix, expectedInput, stored, { merchantKeeps: true });
  };

  // A recorded operator choice is the only way out of ambiguity.
  if (failure.errorCode === 'AMBIGUOUS_MATCH') {
    const candidates = Array.isArray(reconcile.candidateTargetIds) ? reconcile.candidateTargetIds : [];
    const choice = userDecisionValue(decisions, `shipping-option-adopt:${optionKey}`);
    if (choice === 'none') return { outcome: 'shipping-option-absent', id: null };
    if (choice && candidates.includes(choice)) return verifyCandidate(choice);
    if (choice) return { outcome: 'shipping-option-ambiguous', id: null, candidateTargetIds: candidates, rejectedChoice: true };
    if (!failure.targetEntityId) {
      // Without a decision the row stays ambiguous; a re-run never adopts on its own.
      return { outcome: 'shipping-option-ambiguous', id: null, candidateTargetIds: candidates };
    }
  }

  if (failure.targetEntityId) return verifyCandidate(failure.targetEntityId);

  // Unknown outcome: reconcile by the natural key over a COMPLETE scan of the region.
  const regionId = expectedInput.deliveryRegionIds && expectedInput.deliveryRegionIds[0] ? expectedInput.deliveryRegionIds[0] : expectedInput.deliveryRegionId;
  const scan = await queryAllShippingOptions(wix, { deliveryRegionId: regionId });
  if (!scan.complete) return { outcome: 'shipping-option-recovery-incomplete', id: null, reason: scan.reason };
  const matches = scan.options.filter((option) => verifyShippingOptionReadBack(expectedInput, option, { ignoreEstimate: true }).ok).map((option) => option.id);
  if (!Array.isArray(reconcile.preWriteTargetIds)) {
    // No snapshot: nothing can be proven, so any match is ambiguous and never adopted.
    return matches.length ? { outcome: 'shipping-option-ambiguous', id: null, candidateTargetIds: matches } : { outcome: 'shipping-option-absent', id: null };
  }
  const before = new Set(reconcile.preWriteTargetIds);
  const candidates = matches.filter((id) => !before.has(id));
  if (candidates.length === 0) return { outcome: 'shipping-option-absent', id: null };
  if (candidates.length > 1) return { outcome: 'shipping-option-ambiguous', id: null, candidateTargetIds: candidates };
  return verifyCandidate(candidates[0]);
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
function _buildUpdateBusinessContactRequest(businessContact, { clearPaths = [] } = {}) {
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
// --- Regional settings (payment currency, time zone, language, locale) -------------------------
//
// Two different calls. Payment currency and time zone go through Update Business Region
// (documented, `fields.paths` names TOP-LEVEL fields). Language and locale go through a PATCH on
// the Site Properties root; each has its own call, because setting `language` leaves `locale`
// untouched and Update Business Region rejects both. Every mask is DERIVED from the payload's own
// keys: a path named but not sent is cleared.
//
// The API stores whatever it is sent: a made-up currency, a made-up time zone and a three-letter
// language all answered 200 and were stored. So every builder refuses a value the source-regional
// validators refuse -- the importer is the only validation there is -- and every write must be
// followed by getSiteProperties and a comparison. A write is also never a no-op: an identical
// update still bumps the site version, so a caller reads, compares and skips instead of re-sending.
const REGION_FIELDS = ['paymentCurrency', 'timeZone'];
function _buildUpdateBusinessRegionRequest(businessRegion) {
  const regional = require('../../../lib/source-regional.js');
  if (!businessRegion || typeof businessRegion !== 'object' || Array.isArray(businessRegion)) {
    throw new Error('buildUpdateBusinessRegionRequest: businessRegion object is required');
  }
  const unknown = Object.keys(businessRegion).filter((key) => !REGION_FIELDS.includes(key));
  if (unknown.length) throw new Error(`buildUpdateBusinessRegionRequest: ${unknown.join(', ')} is not a business region field (language and locale have their own calls)`);
  const sentPaths = REGION_FIELDS.filter((key) => businessRegion[key] !== undefined);
  if (sentPaths.length === 0) throw new Error('buildUpdateBusinessRegionRequest: nothing to update — an empty mask is refused by the API');
  if (businessRegion.paymentCurrency !== undefined && !regional.knownCurrency(businessRegion.paymentCurrency)) {
    throw new Error(`buildUpdateBusinessRegionRequest: "${businessRegion.paymentCurrency}" is not a currency; the API would store it anyway`);
  }
  if (businessRegion.timeZone !== undefined && !regional.knownTimeZone(businessRegion.timeZone)) {
    throw new Error(`buildUpdateBusinessRegionRequest: "${businessRegion.timeZone}" is not a time zone; the API would store it anyway`);
  }
  const body = {};
  for (const key of sentPaths) body[key] = businessRegion[key];
  return { method: 'POST', url: `${SITE_PROPERTIES_BASE}/business-region`, body: { businessRegion: body, fields: { paths: sentPaths } } };
}
function _buildUpdateSiteLanguageRequest(language) {
  if (!require('../../../lib/source-regional.js').knownLanguage(language)) {
    throw new Error(`buildUpdateSiteLanguageRequest: "${language}" is not a two-letter language code; the API stores three letters as sent`);
  }
  return { method: 'PATCH', url: SITE_PROPERTIES_BASE, body: { properties: { language }, fields: { paths: ['language'] } } };
}
function _buildUpdateSiteLocaleRequest(locale) {
  const regional = require('../../../lib/source-regional.js');
  if (!locale || !regional.knownLanguage(locale.languageCode) || !regional.knownCountry(locale.country)) {
    throw new Error('buildUpdateSiteLocaleRequest: locale needs a two-letter languageCode and a two-letter uppercase country');
  }
  return { method: 'PATCH', url: SITE_PROPERTIES_BASE, body: { properties: { locale: { languageCode: locale.languageCode, country: locale.country } }, fields: { paths: ['locale'] } } };
}
// Update Business Region answers `{}`; language and locale answer `{ version }`. None of them proves
// the value landed.
async function updateBusinessRegion(wix, businessRegion) {
  return wix.send(buildUpdateBusinessRegionRequest(businessRegion));
}
async function updateSiteLanguage(wix, language) {
  return wix.send(buildUpdateSiteLanguageRequest(language));
}
async function updateSiteLocale(wix, locale) {
  return wix.send(buildUpdateSiteLocaleRequest(locale));
}
function _buildGetSitePropertiesRequest() {
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
    rethrowRunStop(error);
    // An UNKNOWN outcome is not a 404. Falling back on a guess abandons a host that works, so it
    // is rethrown; only a structured 404 the target actually sent takes the fallback.
    if (error && error.outcomeKnown === false) throw error;
    if (!(error && error.status === 404)) throw error;
  }
  if (wix) wix.__pickupLocationsBase = base;
  return base;
}

function _buildCreatePickupLocationRequest(pickupLocation, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'POST', url: baseUrl, body: { pickupLocation } };
}
async function createPickupLocation(wix, pickupLocation) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildCreatePickupLocationRequest(pickupLocation, { baseUrl }))).pickupLocation;
}
function _buildGetPickupLocationRequest(id, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'GET', url: `${baseUrl}/${encodeURIComponent(id)}` };
}
async function getPickupLocation(wix, id) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildGetPickupLocationRequest(id, { baseUrl }))).pickupLocation;
}
function _buildQueryPickupLocationsRequest(query = { cursorPaging: { limit: 100 } }, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
  return { method: 'POST', url: `${baseUrl}/query`, body: { query } };
}
// ONE PAGE, unwrapped to the pickupLocations array — see the READ/RETURN CONTRACT at the top of
// this file. Filter on `.deliveryRegionIds` yourself to find what already covers a region.
async function queryPickupLocations(wix, query) {
  const baseUrl = await resolvePickupLocationsBase(wix);
  return (await wix.send(buildQueryPickupLocationsRequest(query, { baseUrl }))).pickupLocations || [];
}
function _buildDeletePickupLocationRequest(id, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
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
function _buildAddPickupLocationDeliveryRegionRequest(pickupLocationId, deliveryRegionId, revision, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
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
function _buildRemovePickupLocationDeliveryRegionRequest(pickupLocationId, deliveryRegionId, revision, { baseUrl = PICKUP_LOCATIONS_BASE } = {}) {
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
// Create Order (not import-suited): it decrements catalog
// inventory, emails the buyer a confirmation, and auto-creates a contact. Historical
// orders MUST go through importOrder below. createOrder remains only for creating a
// genuine live/test order on purpose.
function _buildCreateOrderRequest(order) {
  const body = copyRequestBody({ order });
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/orders`,
    body,
  };
}
async function createOrder(wix, order) {
  return (await wix.send(buildCreateOrderRequest(order))).order;
}
function _buildQueryOrdersRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/ecom/v1/orders/query`, body: { query } };
}
// ONE PAGE, unwrapped to the orders array — see the READ/RETURN CONTRACT at the top of this file.
async function queryOrders(wix, query) {
  return (await wix.send(buildQueryOrdersRequest(query))).orders || [];
}

// VERIFIED LIVE writer — 2026-08-12 and re-verified 2026-08-16
// (applied discounts, line-item descriptionLines/catalogReference.options, merchant-note
// follow-up). Endpoint: POST /ecom/v1/orders/import — the dedicated migration path (Beta,
// scope SCOPE.ECOM.IMPORT-ORDERS).
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
// contacts/loyalty and other event-driven views).
// Required: lineItems (1-300; each needs quantity, productName.original, itemType, price,
// and catalogItemId+appId when catalogReference is present), billingInfo.contactDetails,
// channelInfo (no SHOPIFY/WOOCOMMERCE enum values — use OTHER_PLATFORM), priceSummary,
// status, paymentStatus (full enum, incl. PAID without a real payment).
// History: purchasedDate/number are settable; createdDate is NOT (live-verified 2026-09-05 — it reads back as the import moment) on import (immutable after).
// Re-runs: sending an existing imported order's `id` fully replaces it; overwriting a
// non-imported order fails with CANNOT_OVERWRITE_NON_IMPORTED_ORDER. Cleanup exists via
// Bulk Delete Imported Orders; live-order numbering continues via Set Order Number Counter.
// The two fields callers most often get wrong. NOT a validator: Import Order requires plenty more
// (line items, price summary, channel), and this checks none of it, so passing here is not a
// promise the request will be accepted. It is named for the traps it knows because implying
// completeness would be worse than checking nothing.
//
// LIVE-FOUND 2026-09-05, on the first end-to-end: an order with neither `status` nor
// `billingInfo.contactDetails` is rejected with a 400 that names both -- but only once you have
// already sent it, once per order. A billing ADDRESS does not satisfy contactDetails.
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

// lineItems[].image is an Image object on Import Order. A bare URL string is refused for the whole
// order with 400 "Expected an object" (observed in a live run: every order). The URL is
// what a source carries, so it is wrapped, never dropped: the order imports with its picture.
function normalizeImportOrderLineItemImages(order) {
  if (!order || !Array.isArray(order.lineItems)) return order;
  for (const item of order.lineItems) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.image === 'string') {
      if (item.image.trim()) item.image = { url: item.image.trim() };
      else delete item.image;
    }
  }
  return order;
}

function _buildImportOrderRequest(order) {
  assertKnownImportOrderTraps(order);
  const body = copyRequestBody({ order });
  normalizeImportOrderLineItemImages(body.order);
  return {
    method: 'POST',
    url: `${WIXAPIS}/ecom/v1/orders/import`,
    body,
  };
}
async function importOrder(wix, order) {
  return (await wix.send(buildImportOrderRequest(order))).order;
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

function _buildListOrderTransactionsRequest(orderId) {
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
function _buildAddOrderPaymentRequest({ orderId, payment, payments }) {
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
function _buildRefundOrderPaymentRequest({ orderId, paymentId, amount, reason }) {
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
//
// ONE test decides "is this condition likely to clear", and this is it. It was correct and
// unexported for reads only while four generated importers each carried a private copy that
// tested the error's WORDING -- for the wording of a different client entirely, so none of them
// could ever match. Keyed on the target's own numeric status and on nothing else: it must not
// test `applicationErrorCode`, neither requiring one nor requiring its absence. The reviewed
// run's failures were all `status: 500` WITH `applicationErrorCode: 'INTERNAL'`, so "a 5xx
// carrying no application error code" would have matched none of them and shipped dead a second
// time. 403 stays OUT: the Ricos endpoint throttles with it, but a 403 anywhere else is a
// credential problem, and a shared predicate that retries it hides every one of them.
//
// It answers "is this likely to clear". It does NOT answer "is it safe to try again" -- only the
// call site knows whether a second attempt can duplicate a record.
const TRANSIENT_WIX_STATUSES = new Set([429, 500, 502, 503, 504]);

function isTransientWixError(error) {
  // An expired token interrupts the run; retrying the record cannot clear it.
  if (error && error.interruption === true) return false;
  const status = error && (error.status || error.statusCode || (error.response && error.response.status));
  // The transport threw before any response arrived: no status to key on, and the condition is
  // exactly the kind that clears. An unparseable response that DID arrive carries its status and
  // is already covered by the set.
  if (error && error.outcomeKnown === false && (status === null || status === undefined)) return true;
  return TRANSIENT_WIX_STATUSES.has(Number(status));
}

// Every attempt -- a first try or a transient retry -- reserves its start slot
// SYNCHRONOUSLY, before any await, as max(now, previousSlot + minIntervalMs, lastCompletedAt +
// minIntervalMs). Checking and updating a timestamp inside each concurrent read() let three
// callers entering together all start in the same millisecond (observed 0 ms gaps).
// Reserving the slot first keeps any two starts through one pacer >= minIntervalMs apart however
// many callers are in flight; the lastCompletedAt term keeps today's end-to-start spacing for
// serial callers. A transient retry waits its backoff first, then reserves a new slot.
//
// A reserved slot is a plan, not a guarantee: timers wake late under load, and several sleepers
// whose slots have all passed can wake in the same tick (e.g. two sleepers whose slots passed can be released
// together, giving starts at 0, 200, 200). So after waking, an attempt re-checks the clock
// against the latest ACTUAL start and, if it is too close, re-reserves the remaining gap before
// starting. The check and the start record happen with no await between them, so two woken
// callers can never start inside one interval. On an accurate clock the re-check never waits.
//
// stats() reports two separate waits, never added to wall-clock: pacingWaitMs is the SUM over
// every attempt of (slot - now) at reservation, plus any re-reserved gap after a late wake --
// concurrent callers' waits overlap, so it can exceed elapsed time -- and backoffWaitMs is the
// sum of the sleeps between transient attempts.
function createTargetReadPacer({ minIntervalMs = 0, maxAttempts = 3, backoffMs = 250, sleep, now } = {}) {
  const clock = now || (() => Date.now());
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stats = { reads: 0, retries: 0, failures: 0, elapsedMs: 0, pacingWaitMs: 0, backoffWaitMs: 0 };
  let previousSlot = null;
  let lastCompletedAt = null;
  let lastStartedAt = null;

  const reserve = () => {
    const at = clock();
    let slot = at;
    if (minIntervalMs > 0) {
      if (previousSlot !== null) slot = Math.max(slot, previousSlot + minIntervalMs);
      if (lastCompletedAt !== null) slot = Math.max(slot, lastCompletedAt + minIntervalMs);
    }
    previousSlot = slot;
    stats.pacingWaitMs += slot - at;
    return slot - at;
  };

  return {
    stats: () => ({ ...stats }),
    async read(fn) {
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const pacingWait = reserve();
        if (pacingWait > 0) await wait(pacingWait);
        // Re-check after waking (see above): loop, because another late waker may start first.
        for (;;) {
          if (!(minIntervalMs > 0) || lastStartedAt === null) break;
          const gap = lastStartedAt + minIntervalMs - clock();
          if (gap <= 0) break;
          stats.pacingWaitMs += gap;
          await wait(gap);
        }
        const startedAt = clock();
        lastStartedAt = Math.max(lastStartedAt ?? -Infinity, startedAt);
        try {
          const value = await fn();
          stats.reads += 1;
          stats.elapsedMs += clock() - startedAt;
          lastCompletedAt = Math.max(lastCompletedAt ?? -Infinity, clock());
          return { ok: true, value };
        } catch (error) {
          rethrowRunStop(error);
          stats.reads += 1;
          stats.elapsedMs += clock() - startedAt;
          lastCompletedAt = Math.max(lastCompletedAt ?? -Infinity, clock());
          lastError = error;
          if (attempt < maxAttempts && isTransientWixError(error)) {
            stats.retries += 1;
            const backoff = backoffMs * attempt;
            stats.backoffWaitMs += backoff;
            await wait(backoff);
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
// bounded retry the spec promises did not happen: a large store could issue thousands of
// unpaced single-order reads. Sharing one instance is what makes the spacing meaningful -- a
// per-call pacer paces nothing.
let defaultTargetReadPacer = null;
// A dry run sends nothing, so its reads are neither spaced nor backed off: same attempts, no waits.
const dryRunTargetReadPacer = createTargetReadPacer({ minIntervalMs: 0, maxAttempts: 3, backoffMs: 0, sleep: async () => {} });
const isDryRunClient = wix => Boolean(wix) && (wix.dryRun === true || recordClients.get(wix)?.wix?.dryRun === true);
function sharedTargetReadPacer(wix) {
  if (isDryRunClient(wix)) return dryRunTargetReadPacer;
  if (!defaultTargetReadPacer) {
    defaultTargetReadPacer = createTargetReadPacer({ minIntervalMs: 60, maxAttempts: 3, backoffMs: 250 });
  }
  return defaultTargetReadPacer;
}

async function reconcileOrderPaymentTarget(wix, { orderId, payment = null, pacer = null } = {}) {
  const readOnce = () => listOrderTransactions(wix, orderId);
  const effectivePacer = pacer || sharedTargetReadPacer(wix);
  const result = effectivePacer
    ? await effectivePacer.read(readOnce)
    : await (async () => {
      try {
        return { ok: true, value: await readOnce() };
      } catch (error) {
        rethrowRunStop(error);
        return { ok: false, error };
      }
    })();

  // Every shape this returns carries the binding, including the failures: a pre-read that failed
  // is still a pre-read for THIS order and payment, and the writers refuse one without it.
  const binding = { forOrderId: String(orderId), forPaymentFingerprint: payment ? paymentMapping.paymentFingerprint(payment) : null };
  if (!result.ok) {
    rethrowRunStop(result.error);
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
// for an order that may never have been paid, which is the revenue overstatement this guard exists to
// prevent.
//
// Now: pass the MAPPED payment (from `order-payment-mapping.js`) when the source evidences one.
// The order's real payments are read first, reconciled by identity, and a payment is created only
// when reconciliation says no matching record exists. When the source evidences no payment, this
// refuses and reports rather than inventing one -- an unrefundable refund is a reportable gap, not
// a reason to fabricate its counterpart.
//
// Returns an outcome rather than throwing, because every order must land in
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
      rethrowRunStop(error);
      lastError = error;
      if (!isPendingRefund(error) || attempt === 6) break;
      await pauseFor(wix)(1000 * attempt);
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
function _buildCreateInventoryItemRequest({ variantId, productId, locationId, inStock, quantity, trackQuantity, preorderInfo }) {
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
function _buildQueryCouponsByCodeRequest(code) {
  return { method: 'POST', url: `${WIXAPIS}/stores/v2/coupons/query`, body: { query: { filter: JSON.stringify({ 'specification.code': { $eq: String(code) } }), paging: { limit: 10, offset: 0 } } } };
}
async function queryCouponsByCode(wix, code) {
  const response = await wix.send(buildQueryCouponsByCodeRequest(code));
  const list = (response && response.coupons) || [];
  // Codes are case- and space-sensitive on Wix; the filter is exact, this is belt-and-braces.
  return list.filter((c) => String(((c.specification || c).code) || '') === String(code));
}
function _buildDeleteCouponRequest(couponId) {
  return { method: 'DELETE', url: `${WIXAPIS}/stores/v2/coupons/${encodeURIComponent(couponId)}` };
}
async function deleteCoupon(wix, couponId) {
  return wix.send(buildDeleteCouponRequest(couponId));
}
// `scopeTarget` is the CALLER'S verdict on the thing the coupon is restricted to, in three
// states: `{visible: true}`, `{visible: false}`, or omitted.
//
// MEASURED LIVE (8 for 8): a coupon scoped to a product with `visible: false` is rejected 400
// "entityId '<id>' not found" -- a visibility rule reported as a missing id. `active: false`
// relaxes nothing; the scope is validated at creation, not at redemption.
//
// The writer does NOT read the target itself, deliberately: the caller already holds the
// crosswalk and has usually just read the product, and a per-coupon read here would add a round
// trip per scoped coupon on an import that routinely runs to several thousand. The price of
// accepting the caller's verdict is that a caller can skip it -- which is exactly what the
// `unchecked` marker is for. An unchecked write is NOT an error and must never be reported as
// one; it is a coupon that may still fail live, and the marker is what lets a report say so
// honestly rather than presenting it as verified.
//
// A hidden target is REFUSED WHOLE. Never widen the scope to storewide, never substitute a
// `minimumSubtotal`, never import it switched off to switch on later, and never change the
// product's visibility to admit the coupon -- that is a storefront change and the owner's call.
async function ensureCoupon(wix, { specification, pacer = null, scopeTarget } = {}) {
  if (!specification || !specification.code) throw new Error('ensureCoupon needs a mapped coupon specification with a code');
  // BEFORE the paced query-by-code below, so a caller that never decided redeemability
  // pays a local error instead of spending a live call to find out.
  assertCouponRedeemabilityDecided(specification);
  const scopeGroup = specification.scope && specification.scope.group;
  if (scopeGroup && scopeTarget && scopeTarget.visible === false) {
    return {
      outcome: 'coupon-scope-target-hidden',
      couponId: null,
      code: specification.code,
      scopeGroup: { name: scopeGroup.name, entityId: scopeGroup.entityId },
    };
  }
  // Nothing to check on a storewide or unscoped coupon, so no marker for one.
  const unchecked = Boolean(scopeGroup) && (scopeTarget === undefined || scopeTarget === null);
  const mark = (result) => (unchecked ? { ...result, scopeTargetVisibility: 'coupon-scope-target-visibility-unchecked' } : result);
  const effectivePacer = pacer || sharedTargetReadPacer(wix);
  const read = await effectivePacer.read(() => queryCouponsByCode(wix, specification.code));
  if (!read.ok) { rethrowRunStop(read.error); return mark({ outcome: 'coupon-target-read-failed', couponId: null, error: read.error }); }
  if (read.value.length === 1) return mark({ outcome: 'coupon-reconciled-existing', couponId: read.value[0].id });
  if (read.value.length > 1) return mark({ outcome: 'coupon-reconciliation-ambiguous', couponId: null, matchCount: read.value.length });
  try {
    const created = await createCoupon(wix, specification);
    // LIVE 2026-09-05: createCoupon hands back the bare id string (Create Coupon answers `{ id }`
    // and the writer unwraps it). Reading `.id` off a string reported every successful create as
    // "no id" while the coupons were in fact on the site -- the first sentinel run refuted five
    // writes that had all landed. Accept the string, an `{ id }`, or an `{ coupon: { id } }`.
    const couponId = typeof created === 'string' ? created : created && (created.id || (created.coupon && created.coupon.id));
    if (!couponId) return mark({ outcome: 'coupon-failed', couponId: null, error: { message: `Create Coupon returned no id: ${String(JSON.stringify(created) ?? 'undefined').slice(0, 120)}` } });
    return mark({ outcome: 'coupon-written', couponId: String(couponId) });
  } catch (error) {
    rethrowRunStop(error);
    // A duplicate the read missed (the write-then-read lag): adopt it rather than fail the run.
    if (/already exists|ALREADY_EXISTS|duplicate/i.test(String(error && error.message))) {
      const again = await effectivePacer.read(() => queryCouponsByCode(wix, specification.code));
      if (again.ok && again.value.length === 1) return mark({ outcome: 'coupon-reconciled-existing', couponId: again.value[0].id, matchedAfter: 'duplicate-rejection' });
    }
    // A single write lets a scope refusal propagate to here: there is no batch to protect.
    return mark({ outcome: 'coupon-failed', couponId: null, error: couponErrorFields(error) });
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
function _buildCreatePlanRequest(plan, { idempotencyKey = null } = {}) {
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
function _buildQueryPlansByNameRequest(name) {
  return { method: 'POST', url: `${WIXAPIS}/pricing-plans/v3/plans/query`, body: { query: { filter: { name: { $eq: String(name) } }, cursorPaging: { limit: 50 } } } };
}
async function queryPlansByName(wix, name) {
  return ((await wix.send(buildQueryPlansByNameRequest(name))) || {}).plans || [];
}
// Plans V3 has no archive; the V2 call is the working one (plan.json: no-archive-on-v3).
function _buildArchivePlanRequest(planId) {
  return { method: 'POST', url: `${WIXAPIS}/pricing-plans/v2/plans/${encodeURIComponent(planId)}/archive`, body: {} };
}
async function archivePlan(wix, planId) {
  return wix.send(buildArchivePlanRequest(planId));
}
function _buildGetPlanRequest(planId) {
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
  const effectivePacer = pacer || sharedTargetReadPacer(wix);
  const findings = [];
  if (knownPlanId) {
    // A crosswalk row is a claim, not a fact: the plan may have been deleted (review demonstrated
    // "reconciled" with no target call at all), archived, or the row may point at somebody else's
    // plan. Gone or foreign -> the row is stale and the name path decides; archived -> not the plan.
    const known = await effectivePacer.read(() => getPlan(wix, knownPlanId));
    if (!known.ok) { rethrowRunStop(known.error); if (!(known.error && known.error.status === 404 && known.error.outcomeKnown !== false)) return { outcome: 'plan-target-read-failed', planId: null, error: known.error }; }
    const candidate = known.ok ? known.value : null;
    if (candidate && candidate.archived !== true && carriesVariant(candidate, ids)) return adoptPlan(candidate, 'crosswalk');
    findings.push({ code: 'plan-crosswalk-row-stale', knownPlanId: String(knownPlanId), reason: !candidate ? 'not-found' : candidate.archived === true ? 'archived' : 'not-this-offer' });
  }
  const read = await effectivePacer.read(() => queryPlansByName(wix, plan.name));
  if (!read.ok) { rethrowRunStop(read.error); return { outcome: 'plan-target-read-failed', planId: null, error: read.error, findings }; }
  // An ARCHIVED plan of that name is not the plan: adopting it would leave nothing active on the
  // target while reporting reconciled. The V3 filter table has no `archived`, so post-filter.
  // A live plan of that name that does NOT carry our variant id is somebody else's (or another
  // offer's, truncated to the same name) and is neither adopted nor an obstacle.
  const ours = read.value.filter((p) => p && p.archived !== true && carriesVariant(p, ids));
  if (ours.length === 1) { const adopted = adoptPlan(ours[0], 'variant-id'); return { ...adopted, findings: [...findings, ...adopted.findings] }; }
  if (ours.length > 1) return { outcome: 'plan-reconciliation-ambiguous', planId: null, matchCount: ours.length, findings };
  const wait = pauseFor(wix, sleep);
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
      try { await archivePlan(wix, created.id); } catch (error) { rethrowRunStop(error); archived = false; archiveError = { message: String(error && error.message).slice(0, 300), status: error && error.status }; }
      return { outcome: 'plan-failed', planId: created.id, error: { cause: 'created-plan-not-inert', visibility: created.visibility, buyable: created.buyable, archived, ...(archiveError ? { archiveError } : {}) }, findings };
    }
    return { outcome: 'plan-written', planId: created.id, visibility: created.visibility, buyable: created.buyable, findings };
  } catch (error) {
    rethrowRunStop(error);
    lastPlanWriteAt = Date.now();
    return { outcome: 'plan-failed', planId: null, error: { message: String(error && error.message).slice(0, 300), status: error && error.status }, findings };
  }
}

// --- pricing plans: orders (a member's subscription to a plan) ----------------
// POST /pricing-plans/v2/checkout/orders/offline, verified live 2026-08-16 (plan-order.json). The
// body is only planId, memberId, paid and startDate: a couponCode would use the coupon up again,
// and submissionId names a source form submission Wix does not have. Status is read-only: a past
// or present startDate lands ACTIVE, a future one PENDING; a paused source contract is created
// ACTIVE and then paused (only ACTIVE orders can be paused). Canceled and expired contracts are
// never written here (CMS history). Orders cannot be deleted, so a duplicate is permanent:
// crosswalk first (read back), then the member's orders for the plan matched on startDate, then
// create; after an unknown outcome the orders are listed again and a match adopted, never re-sent.
const PLAN_ORDER_PAID_SETTLE_READS = 5;
const PLAN_ORDER_PAID_SETTLE_MS = 1000;
function _buildCreateOfflinePlanOrderRequest({ planId, memberId, paid = false, startDate } = {}) {
  if (!planId) throw new Error('creating a plan order needs the plan id');
  if (!memberId) throw new Error('creating a plan order needs the member id');
  // The start date is the duplicate-check identity and keeps the billing anniversary: never defaulted.
  if (!startDate || Number.isNaN(Date.parse(startDate))) throw new Error('creating a plan order needs the source start date');
  return {
    method: 'POST',
    url: `${WIXAPIS}/pricing-plans/v2/checkout/orders/offline`,
    body: { planId: String(planId), memberId: String(memberId), paid: paid === true, startDate: new Date(startDate).toISOString() },
  };
}
async function createOfflinePlanOrder(wix, payload) {
  return ((await wix.send(buildCreateOfflinePlanOrderRequest(payload))) || {}).order || null;
}
function _buildPausePlanOrderRequest(orderId) {
  if (!orderId) throw new Error('pausing a plan order needs the order id');
  return { method: 'POST', url: `${WIXAPIS}/pricing-plans/v2/orders/${encodeURIComponent(orderId)}/pause`, body: {} };
}
async function pausePlanOrder(wix, orderId) {
  return wix.send(buildPausePlanOrderRequest(orderId));
}
function _buildListPlanOrdersRequest({ memberId, planId }) {
  if (!memberId || !planId) throw new Error('listing plan orders needs the member id and the plan id');
  const query = new URLSearchParams({ buyerIds: String(memberId), planIds: String(planId), limit: '50' });
  return { method: 'GET', url: `${WIXAPIS}/pricing-plans/v2/orders?${query}` };
}
async function listPlanOrders(wix, filter) {
  return ((await wix.send(buildListPlanOrdersRequest(filter))) || {}).orders || [];
}
function _buildGetPlanOrderRequest(orderId) {
  return { method: 'GET', url: `${WIXAPIS}/pricing-plans/v2/orders/${encodeURIComponent(orderId)}` };
}
async function getPlanOrder(wix, orderId) {
  return ((await wix.send(buildGetPlanOrderRequest(orderId))) || {}).order || null;
}
const sameInstant = (a, b) => Boolean(a && b) && Date.parse(a) === Date.parse(b);
function planOrderIsFor(order, { planId, memberId }) {
  return Boolean(order) && order.planId === planId && (order.buyer && order.buyer.memberId) === memberId;
}
function planOrderError(error) {
  return { message: String(error && error.message).slice(0, 300), status: error && error.status, outcomeKnown: error && error.outcomeKnown === false ? false : true,
    ...(error && error.requestSent === false ? { requestSent: false, code: error.code === undefined ? null : error.code } : {}) };
}
// An order settles after the create returns (verified live 2026-10-27): the create reply says
// status DRAFT and lastPaymentStatus UNPAID; moments later Get Order says ACTIVE/PENDING and PAID.
// So an order is re-read a few times before it is paused or judged.
async function settledPlanOrder(wix, orderId, paid, { pacer, wait }) {
  let order = null;
  for (let attempt = 0; attempt < PLAN_ORDER_PAID_SETTLE_READS; attempt += 1) {
    if (attempt) await wait(PLAN_ORDER_PAID_SETTLE_MS);
    const read = await pacer.read(() => getPlanOrder(wix, orderId));
    if (!read.ok) { rethrowRunStop(read.error); return { ok: false, error: planOrderError(read.error) }; }
    order = read.value;
    if (order && order.status !== 'DRAFT' && !(paid && order.lastPaymentStatus === 'UNPAID')) break;
  }
  return { ok: true, order };
}
// Read back what was written. planDescription is never read (the order snapshots the plan NAME there).
async function readBackPlanOrder(wix, orderId, { planId, memberId, startDate, paid, paused }, options) {
  const settled = await settledPlanOrder(wix, orderId, paid, options);
  if (!settled.ok) return settled;
  const { order } = settled;
  const expectedStatus = paused ? 'PAUSED' : Date.parse(startDate) > Date.now() ? 'PENDING' : 'ACTIVE';
  const mismatches = [];
  if (!order) mismatches.push({ field: 'order', expected: orderId, actual: null });
  else {
    if (order.planId !== planId) mismatches.push({ field: 'planId', expected: planId, actual: order.planId });
    if ((order.buyer && order.buyer.memberId) !== memberId) mismatches.push({ field: 'buyer.memberId', expected: memberId, actual: order.buyer && order.buyer.memberId });
    if (!sameInstant(order.startDate, startDate)) mismatches.push({ field: 'startDate', expected: startDate, actual: order.startDate });
    if (order.status !== expectedStatus) mismatches.push({ field: 'status', expected: expectedStatus, actual: order.status });
    if (paid && !['PAID', 'NOT_APPLICABLE'].includes(order.lastPaymentStatus)) mismatches.push({ field: 'lastPaymentStatus', expected: 'PAID', actual: order.lastPaymentStatus });
  }
  return { ok: true, order, mismatches };
}
// One source contract -> at most one order. Returns { outcome, orderId, subscriptionId, planId,
// memberId, startDate, ... }; outcomes are PLAN_ORDER_OUTCOME (plan-order-outcome-registry.js),
// which the importer records for the journal and the cutover items. A non-null orderId always goes
// to the crosswalk, whatever the outcome, because it cannot be undone.
async function ensurePlanOrder(wix, { planId, memberId, startDate, paid = false, paused = false, knownOrderId = null, pacer = null, sleep = null } = {}) {
  const body = _buildCreateOfflinePlanOrderRequest({ planId, memberId, paid, startDate }).body;
  const want = { planId: body.planId, memberId: body.memberId, startDate: body.startDate, paid: body.paid, paused: paused === true };
  const result = await planOrderPass(wix, want, { knownOrderId, pacer: pacer || sharedTargetReadPacer(wix), sleep });
  return { ...result, planId: want.planId, memberId: want.memberId, startDate: want.startDate };
}
const PLAN_ORDER_RATE_LIMIT_WAIT_MS = 1000;
async function planOrderPass(wix, want, { knownOrderId, pacer, sleep }) {
  const effectivePacer = pacer || sharedTargetReadPacer();
  const wait = pauseFor(wix, sleep);
  const findings = [];
  const ids = (order) => ({ orderId: String(order.id), subscriptionId: order.subscriptionId || null });
  // Pause (when asked) and read back an order this contract owns.
  const finish = async (order, outcome, extra = {}) => {
    if (want.paused && order.status === 'DRAFT') {
      const settled = await settledPlanOrder(wix, order.id, false, { pacer: effectivePacer, wait });
      if (!settled.ok) return { outcome: PO.READBACK_FAILED, ...ids(order), ...extra, error: settled.error, findings };
      order = settled.order || order;
    }
    if (want.paused && order.status !== 'PAUSED') {
      if (order.status !== 'ACTIVE') {
        findings.push({ code: 'plan-order-pause-not-possible', orderId: String(order.id), status: order.status, note: 'only ACTIVE orders can be paused; left as found' });
        return { outcome: PO.PAUSE_FAILED, ...ids(order), ...extra, findings };
      }
      try { await pausePlanOrder(wix, order.id); } catch (error) {
        rethrowRunStop(error);
        return { outcome: PO.PAUSE_FAILED, ...ids(order), ...extra, error: planOrderError(error), findings };
      }
    }
    const back = await readBackPlanOrder(wix, order.id, want, { pacer: effectivePacer, wait });
    if (!back.ok) return { outcome: PO.READBACK_FAILED, ...ids(order), ...extra, error: back.error, findings };
    if (back.mismatches.length) return { outcome: PO.READBACK_MISMATCH, ...ids(order), ...extra, mismatches: back.mismatches, findings };
    return { outcome, ...ids(order), status: back.order.status, lastPaymentStatus: back.order.lastPaymentStatus, ...extra, findings };
  };
  const matches = async () => {
    const read = await effectivePacer.read(() => listPlanOrders(wix, want));
    return read.ok ? { ok: true, value: read.value.filter((order) => planOrderIsFor(order, want) && sameInstant(order.startDate, want.startDate)) } : read;
  };
  const adopt = async (found, matchedBy) => {
    if (found.length > 1) return { outcome: PO.RECONCILIATION_AMBIGUOUS, orderId: null, matchCount: found.length, orderIds: found.map((order) => String(order.id)), findings };
    // An order of ours that someone canceled or that ended is still ours: never mint a second, but
    // the subscriber has no live plan -- its own outcome, a cutover item, not a success.
    if (['CANCELED', 'ENDED'].includes(found[0].status)) return { outcome: PO.EXISTING_NOT_LIVE, ...ids(found[0]), matchedBy, status: found[0].status, findings };
    return finish(found[0], PO.RECONCILED_EXISTING, { matchedBy });
  };
  if (knownOrderId) {
    // A crosswalk row is a claim: read it back. Gone or someone else's -> stale, the list decides.
    const known = await effectivePacer.read(() => getPlanOrder(wix, knownOrderId));
    if (!known.ok) { rethrowRunStop(known.error); if (!(known.error && known.error.status === 404 && known.error.outcomeKnown !== false)) return { outcome: PO.TARGET_READ_FAILED, orderId: null, error: planOrderError(known.error), findings }; }
    if (known.ok && planOrderIsFor(known.value, want) && sameInstant(known.value.startDate, want.startDate)) return adopt([known.value], 'crosswalk');
    findings.push({ code: 'plan-order-crosswalk-row-stale', knownOrderId: String(knownOrderId), reason: known.ok && known.value ? 'not-this-contract' : 'not-found' });
  }
  const before = await matches();
  if (!before.ok) { rethrowRunStop(before.error); return { outcome: PO.TARGET_READ_FAILED, orderId: null, error: planOrderError(before.error), findings }; }
  if (before.value.length) return adopt(before.value, 'member-plan-start');
  let created;
  try {
    try { created = await createOfflinePlanOrder(wix, want); } catch (error) {
      rethrowRunStop(error);
      // A 429 is refused before processing: one wait and one more try is safe.
      if (!(error && Number(error.status) === 429)) throw error;
      await wait(error.retryAfterMs || PLAN_ORDER_RATE_LIMIT_WAIT_MS);
      created = await createOfflinePlanOrder(wix, want);
    }
  } catch (error) {
    rethrowRunStop(error);
    // A readable 4xx is Wix's decision. An unreadable reply or a 5xx may have landed: look once,
    // adopt a match, otherwise stop -- a resend could duplicate. (Never a retry.)
    if (!(error && (error.outcomeKnown === false || Number(error.status) >= 500))) return { outcome: PO.FAILED, orderId: null, error: planOrderError(error), findings };
    const after = await matches();
    if (after.ok && after.value.length) return adopt(after.value, 'after-unknown-outcome');
    return { outcome: PO.UNKNOWN_OUTCOME, orderId: null, error: planOrderError(error), findings };
  }
  if (!created || !created.id) return { outcome: PO.UNKNOWN_OUTCOME, orderId: null, error: { message: 'Create Offline Order returned no order id', outcomeKnown: false }, findings };
  return finish(created, PO.WRITTEN);
}

// --- members ---------------------------------------------------------------
// VERIFIED: GET /members/v1/members (reconcile), POST /members/v1/members (create).
// Dedup by loginEmail — gated PII; null email cannot dedup/create (use a fallback).
// DOCUMENTED: no bulk create; >=1s spacing between Create Member calls is the
// documented rate-limit floor — space sequential creates and resume via crosswalk.
// DOCUMENTED: create sends no email and does not fire the signup automations
// trigger — member import is silent by default. Passwords are NEVER imported
// (project decision, 2026-08-03). Activation (decided): passwordless members
// complete the standard forgot-password flow (confirmed 2026-08-03); delivery is
// a post-import label-wave automation (owner-created, label-added trigger,
// branded email pointing at Log in -> Forgot password; importer labels contacts
// one at a time with assignContactLabels), enabled only after the import window. There is deliberately
// no send-set-password-email writer here: its link dies in 3h and mass-sending
// it is the exact notification-blast this lib exists to avoid.
// VERIFIED-TRAP (2026-07-19): the default (PUBLIC) fieldset OMITS loginEmail, which
// silently breaks dedupe-by-loginEmail; request fieldsets=FULL so the field is present.
// VERIFIED (2026-08-02, single-site observation): the member list can already contain
// AUTO-CREATED user-members for the site owner / contributing Wix users (status
// APPROVED) even on an API-provisioned site nobody ever visited — seen on our test
// site. Never dedupe or reconcile these against source-site
// members. The owner's user-member is a valid blog author memberId, but ONLY as the
// fallback used when a post genuinely carries no source author information.
// CORRECTED (2026-10-05): an earlier version of this comment claimed "attribute-to-owner
// blog imports need no member provisioning" for every blog import -- wrong, and found
// live: every post, regardless of its real WordPress author, was
// attributed to this one owner member, discarding the distinct authors the source
// data actually carried (`_embedded.author`). Wix's own "How to Create Blog Posts" skill
// doc (dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts,
// "Part 0: Get an Author/Member ID") sanctions the fix directly: when there is no existing
// member to reuse for an author, CREATE one -- its `profile.nickname` (derived from
// `contact.firstName`) is the name the blog displays, so pass the real author's name when
// the source names one. See `blog-author-attribution.js`'s `resolveBlogAuthorMemberId`,
// which creates one member per distinct source author (never per post) and falls back to
// this owner memberId only when a post has no source author data at all. Resolve the
// owner fallback from THIS list by loginEmail: the observed id equality (member id ==
// account GUID) is a single observation and undocumented — never construct a memberId
// from the account/user id.
async function listMembers(wix, { limit = 50 } = {}) {
  return wix.send(markRequest({ method: 'GET', url: `${WIXAPIS}/members/v1/members?fieldsets=FULL&paging.limit=${limit}` }, { read: true }));
}
function _buildCreateMemberRequest({ email, name, slug }) {
  if (!email) return { skipped: true, reason: 'no email — gated PII; authenticated source re-run required' };
  const body = copyRequestBody({ member: { loginEmail: email, contact: { firstName: name }, profile: { nickname: name, slug } } });
  return {
    method: 'POST',
    url: `${WIXAPIS}/members/v1/members`,
    body,
  };
}
async function createMember(wix, payload) {
  const request = buildCreateMemberRequest(payload);
  if (request.skipped) return request;
  return (await wix.send(request)).member;
}

// --- members: full-fidelity create/reconcile, with the phone-collision guard --------------
// The member/contact split from the member entity's own docs: buildMemberContact
// (customer-member.js) maps a source customer into Member.contact; this is the write side --
// reconcile by loginEmail (or a corroborated crosswalk row), and never send a phone the target
// already has on file for someone else.
const MEMBER_WRITE_MIN_INTERVAL_MS = 1000; // documented Create Member floor: >=1s apart.
let lastMemberWriteAt = 0;
// Shared pacer entry point for any Create Member caller OTHER than ensureMember's own create
// path below (e.g. blog-author-attribution.js's resolveBlogAuthorMemberId). FIXED: a prior version let that caller pace off its own independent,
// module-private timestamp, which never saw this module's writes and vice versa -- so two
// Create Member calls issued moments apart from different passes in the SAME generated-import
// process (rp-import-codegen/SKILL.md runs passes sequentially in one process) could land under
// the documented >=1s floor, which is a constraint on the Wix API endpoint itself, not on
// whichever function happens to call it. `pacedCreateMember` reads and stamps the SAME
// `lastMemberWriteAt` clock ensureMember's own create path uses, so every Create Member call in
// the process is correctly spaced against every other one, regardless of caller. Any future
// caller that creates members outside ensureMember should go through this rather than calling
// `createMember` directly.
// Older callers pass (wix, payload, safeModeOptions, sleep): sleep is the first function argument.
async function pacedCreateMember(wix, payload, ...rest) {
  const wait = pauseFor(wix, rest.find((arg) => typeof arg === 'function'));
  const since = Date.now() - lastMemberWriteAt;
  if (since < MEMBER_WRITE_MIN_INTERVAL_MS) await wait(MEMBER_WRITE_MIN_INTERVAL_MS - since);
  try {
    return await createMember(wix, payload);
  } finally {
    lastMemberWriteAt = Date.now();
  }
}
function _buildGetMemberRequest(memberId) {
  return { method: 'GET', url: `${WIXAPIS}/members/v1/members/${encodeURIComponent(memberId)}?fieldsets=FULL` };
}
async function getMember(wix, memberId) {
  return ((await wix.send(buildGetMemberRequest(memberId))) || {}).member || null;
}
// Updates the contact of a member from the member task. The member is read first and must still
// point at exactly this contact; a stale or foreign id is refused before any write is sent.
async function updateMemberContact(wix, { memberId, contactId, revision, contact }) {
  if (!memberId || !contactId) throw new Error('updateMemberContact: memberId and contactId are required');
  const member = await getMember(wix, memberId);
  if (!member || member.contactId !== contactId) throw Object.assign(new Error('updateMemberContact: the member does not point at this contact'), { code: 'MEMBER_CONTACT_MISMATCH', requestSent: false });
  return (await wix.send(buildUpdateMemberContactRequest({ contactId, revision, contact }))).contact;
}
function _buildQueryMembersByLoginEmailRequest(loginEmail) {
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
function _buildQueryContactsByPhoneRequest(phone) {
  return { method: 'POST', url: `${WIXAPIS}/contacts/v5/contacts/query`, body: { query: { filter: { 'phone.phone': { $eq: String(phone) } } } } };
}
async function queryContactsByPhone(wix, phone) {
  return ((await wix.send(buildQueryContactsByPhoneRequest(phone))) || {}).contacts || [];
}
function normalizeLoginEmailForCompare(email) {
  return String(email || '').trim().toLowerCase();
}
// Members v1 loginEmail has format EMAIL. A structural check, not a full RFC parser (Wix accepts
// unusual TLDs): one @, no whitespace, a local part of at most 64 chars with no leading or trailing
// dot and no "..", and a dotted domain. LIVE-FOUND: a local part starting with "." is refused with
// 400 "email is invalid", a terminal failure for a member that could never be created.
function isValidLoginEmail(email) {
  const e = String(email || '').trim();
  if (!e || e.length > 254 || /\s/.test(e)) return false;
  const parts = e.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && !domain.includes('..') && !/[^\p{L}\p{Nd}.-]/u.test(domain);
}
// Create Member refuses contact.company: every create that carried it failed with 400 "Unexpected
// value for StringValue" (live, 57 of 57), though the docs type it as a string. company/jobTitle
// are kept off the create and written afterwards through Contacts V5 (company { name, jobTitle }).
function splitMemberCreateContact(contact) {
  const { company, jobTitle, ...rest } = contact || {};
  const name = typeof company === 'string' ? company.trim() : (company && typeof company === 'object' ? String(company.name || '').trim() : '');
  const title = typeof jobTitle === 'string' ? jobTitle.trim() : (company && typeof company === 'object' ? String(company.jobTitle || '').trim() : '');
  const later = name || title ? { company: { ...(name ? { name: name.slice(0, 100) } : {}), ...(title ? { jobTitle: title.slice(0, 100) } : {}) } } : null;
  return { createContact: rest, later };
}
// Never fails the member: the member exists either way, and the outcome is a finding.
async function writeMemberCompanyAfterCreate(wix, { memberId, contactId, later }) {
  try {
    const current = await getContact(wix, contactId);
    await updateMemberContact(wix, { memberId, contactId, revision: current.revision, contact: later });
    return { code: MF.COMPANY_WRITTEN_AFTER_CREATE };
  } catch (error) {
    rethrowRunStop(error);
    if (String(error?.code || '').startsWith('target_operation_')) throw error;
    return { code: MF.COMPANY_NOT_WRITTEN, status: error && error.status !== undefined ? error.status : null, requestSent: !(error && error.requestSent === false), errorCode: (error && (error.applicationErrorCode || error.code)) || null };
  }
}
// Crosswalk first (read back and verified, like ensurePlanDefinition), then Query Members by
// loginEmail -- one match reconciles, more than one is ambiguous and creates nothing -- then
// Create Member >=1s apart, with the phone-collision guard immediately before the write.
// The writer returns the error's decision-relevant facts as fields, copied from the thrown error
// BEFORE the message is shortened: the caller has to tell a definite rejection (a readable 4xx)
// from a write of unknown outcome (5xx, transport, unparseable reply), and the message is a
// 300-character prefix it must never parse. Observability only -- no request changes.
function memberErrorFields(error, extra = {}) {
  const e = error && typeof error === 'object' ? error : {};
  return {
    message: String(e.message !== undefined ? e.message : error).slice(0, 300),
    status: e.status === undefined ? null : e.status,
    applicationErrorCode: e.applicationErrorCode === undefined || e.applicationErrorCode === '' ? null : e.applicationErrorCode,
    outcomeKnown: e.outcomeKnown === undefined ? null : e.outcomeKnown,
    // A pre-send refusal (createWixClient) is a known outcome: nothing reached Wix.
    ...(e.requestSent === false ? { requestSent: false, code: e.code === undefined ? null : e.code } : {}),
    ...extra,
  };
}
async function ensureMember(wix, { loginEmail, contact = {}, knownMemberId = null, pacer = null, sleep = null } = {}) {
  const email = normalizeLoginEmailForCompare(loginEmail);
  if (!email) return { outcome: MO.NOT_WRITTEN_NO_EMAIL, memberId: null, findings: [] };
  // An email Wix refuses is no usable login email: the same deferred outcome as a missing one,
  // nothing sent, instead of a terminal 400. The customer's contact is unaffected.
  if (!isValidLoginEmail(loginEmail)) return { outcome: MO.NOT_WRITTEN_NO_EMAIL, memberId: null, findings: [{ code: MF.LOGIN_EMAIL_INVALID }] };
  const findings = [];
  const effectivePacer = pacer || sharedTargetReadPacer(wix);
  if (knownMemberId) {
    const known = await effectivePacer.read(() => getMember(wix, knownMemberId));
    if (!known.ok) { rethrowRunStop(known.error); if (!(known.error && known.error.status === 404 && known.error.outcomeKnown !== false)) return { outcome: MO.TARGET_READ_FAILED, memberId: null, error: memberErrorFields(known.error), wixApiSurface: 'members/v1', findings }; }
    const candidate = known.ok ? known.value : null;
    if (candidate && normalizeLoginEmailForCompare(candidate.loginEmail) === email) {
      return { outcome: MO.RECONCILED_EXISTING, memberId: String(candidate.id), contactId: candidate.contactId ? String(candidate.contactId) : null, matchedBy: 'crosswalk', findings };
    }
    findings.push({ code: MF.CROSSWALK_ROW_STALE, knownMemberId: String(knownMemberId), reason: !candidate ? 'not-found' : 'not-this-email' });
  }
  const read = await effectivePacer.read(() => queryMembersByLoginEmail(wix, email));
  if (!read.ok) { rethrowRunStop(read.error); return { outcome: MO.TARGET_READ_FAILED, memberId: null, error: memberErrorFields(read.error), wixApiSurface: 'members/v1', findings }; }
  const matches = read.value.filter((m) => m && normalizeLoginEmailForCompare(m.loginEmail) === email);
  if (matches.length === 1) return { outcome: MO.RECONCILED_EXISTING, memberId: String(matches[0].id), contactId: matches[0].contactId ? String(matches[0].contactId) : null, matchedBy: 'loginEmail', findings };
  if (matches.length > 1) return { outcome: MO.RECONCILIATION_AMBIGUOUS, memberId: null, matchCount: matches.length, findings };

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
      if (!collision.ok) { rethrowRunStop(collision.error); return { outcome: MO.TARGET_READ_FAILED, memberId: null, error: memberErrorFields(collision.error), wixApiSurface: 'contacts/v5', findings }; }
      if (collision.value.length > 0) {
        findings.push({ code: MF.PHONE_COLLISION_DROPPED, phoneDropped: true, existingContactId: String(collision.value[0].id) });
        collided = true;
      }
    }
    if (collided) {
      const { phones: _dropped, ...rest } = contact;
      effectiveContact = rest;
    }
  }

  const { createContact, later } = splitMemberCreateContact(effectiveContact);
  effectiveContact = createContact;
  const wait = pauseFor(wix, sleep);
  // LIVE-FOUND: in a large sequential batch, with the documented spacing floor already
  // enforced, a small fraction of otherwise-valid creates failed on the first attempt and
  // succeeded immediately when the exact same call was retried moments later -- transient, not
  // a validation problem (the loginEmail/contact bodies were unchanged). Retry Create Member
  // itself once, after a short backoff, for anything that isn't the already-exists race (handled
  // separately below) or a 4xx (a validation error will not fix itself). Reported as
  // member-failed only if BOTH attempts fail.
  async function attemptCreate() {
    const body = { member: { loginEmail, ...(Object.keys(effectiveContact || {}).length > 0 ? { contact: effectiveContact } : {}), privacyStatus: 'PRIVATE' } };
    return wix.send(markRequest({ method: 'POST', url: `${WIXAPIS}/members/v1/members`, body }, { entity: 'members/member' }));
  }
  const since = Date.now() - lastMemberWriteAt;
  if (since < MEMBER_WRITE_MIN_INTERVAL_MS) await wait(MEMBER_WRITE_MIN_INTERVAL_MS - since);
  try {
    let created;
    try {
      created = await attemptCreate();
    } catch (firstError) {
      rethrowRunStop(firstError);
      if (String(firstError?.code || '').startsWith('target_operation_')) throw firstError;
      // Refused before sending: the same request would be refused again, and nothing landed.
      if (firstError?.requestSent === false) throw firstError;
      const status = firstError && firstError.status;
      const isAlreadyExists = status === 409 && /already exists/i.test(String(firstError.message));
      if (isAlreadyExists || (status && status >= 400 && status < 500)) throw firstError;
      findings.push({
        code: MF.CREATE_RETRIED,
        firstErrorMessage: String(firstError && firstError.message).slice(0, 300),
        firstErrorStatus: status === undefined ? null : status,
        firstErrorApplicationCode: (firstError && firstError.applicationErrorCode) || null,
        firstErrorOutcomeKnown: firstError && firstError.outcomeKnown !== undefined ? firstError.outcomeKnown : null,
      });
      await wait(2000);
      created = await attemptCreate();
    }
    lastMemberWriteAt = Date.now();
    const member = created && created.member;
    // A 2xx that carried no member: the member may exist, so the outcome is unknown, not rejected.
    if (!member || !member.id) return { outcome: MO.FAILED, memberId: null, error: { message: 'Create Member returned no id', status: null, applicationErrorCode: null, outcomeKnown: false, createReturnedNoId: true }, wixApiSurface: 'members/v1', findings };
    if (later && member.contactId) findings.push(await writeMemberCompanyAfterCreate(wix, { memberId: String(member.id), contactId: String(member.contactId), later }));
    else if (later) findings.push({ code: MF.COMPANY_NOT_WRITTEN, status: null, requestSent: false, errorCode: 'no-contact-id' });
    return { outcome: MO.WRITTEN, memberId: String(member.id), contactId: member.contactId ? String(member.contactId) : null, findings };
  } catch (error) {
    rethrowRunStop(error);
    // Local support refusals precede HTTP. Preserve the typed blocker for the operator;
    // retrying or recording an unknown Create Member outcome would invent a sent write.
    if (String(error?.code || '').startsWith('target_operation_')) throw error;
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
      return { outcome: MO.ALREADY_EXISTS_UNRECONCILED, memberId: null, error: memberErrorFields(error), wixApiSurface: 'members/v1', findings };
    }
    // The first create was sent and its outcome is unknown; a refused retry does not make it known.
    if (error && error.requestSent === false && findings.some((f) => f.code === MF.CREATE_RETRIED)) {
      return { outcome: MO.FAILED, memberId: null, error: memberErrorFields({ ...error, message: error.message, requestSent: undefined, outcomeKnown: false }), wixApiSurface: 'members/v1', findings };
    }
    return { outcome: MO.FAILED, memberId: null, error: memberErrorFields(error), wixApiSurface: 'members/v1', findings };
  }
}

// --- members: About (members/member-about) ---------------------------------
// VERIFIED LIVE 2026-08-16 and 2026-10-27: one About per member (a second
// create answers 409 ALREADY_EXISTS on memberId); PATCH needs the current revision (a stale one
// answers 409 INVALID_REVISION); deleting the member leaves the About. Wix ALSO creates an About
// for a memberId that does not exist, so the memberId comes only from the readiness grant
// (`memberAbout.memberId` is the per-record members/member reference). The writer upserts:
// query by memberId, PATCH the one found, else create -- so an unknown outcome is safe to retry.
function memberAboutContentFromText(text) {
  const paragraphs = String(text ?? '').split(/\r?\n\s*\r?\n/).map(part => part.trim()).filter(Boolean);
  if (!paragraphs.length) return null; // an empty bio is skipped, never written
  return { nodes: paragraphs.map((part, index) => ({ type: 'PARAGRAPH', id: `p${index + 1}`, paragraphData: {}, nodes: [{ type: 'TEXT', id: '', nodes: [], textData: { text: part, decorations: [] } }] })) };
}
function assertMemberAboutContent(content) {
  if (!content || !Array.isArray(content.nodes) || content.nodes.length === 0) throw new Error('a member About needs Ricos content with at least one node (memberAboutContentFromText wraps plain text)');
}
function _buildCreateMemberAboutRequest({ memberId, content }) {
  if (!memberId) throw new Error('creating a member About needs the member id');
  assertMemberAboutContent(content);
  const body = copyRequestBody({ memberAbout: { memberId, content } });
  return { method: 'POST', url: `${WIXAPIS}/members/v2/abouts`, body };
}
function _buildUpdateMemberAboutRequest({ id, revision, memberId, content }) {
  if (!id || revision === undefined || revision === null || !memberId) throw new Error('updating a member About needs its id, revision and member id');
  assertMemberAboutContent(content);
  const body = copyRequestBody({ memberAbout: { id, revision, memberId, content } });
  return { method: 'PATCH', url: `${WIXAPIS}/members/v2/abouts/${encodeURIComponent(id)}`, body };
}
function _buildQueryMemberAboutsRequest(memberId) {
  if (!memberId) throw new Error('querying member Abouts needs the member id');
  return { method: 'POST', url: `${WIXAPIS}/members/v2/abouts/query`, body: { query: { filter: { memberId } } } };
}
function _buildGetMemberAboutRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/members/v2/abouts/${encodeURIComponent(id)}` };
}
const aboutText = content => JSON.stringify((content?.nodes || []).flatMap(node => (node.nodes || []).map(child => child.textData?.text ?? null)));
async function upsertMemberAbout(wix, { memberId, content } = {}) {
  const failed = (error, extra = {}) => ({ outcome: 'member-about-failed', memberId, aboutId: null, ...extra, error: { message: String(error && error.message).slice(0, 300), status: error && error.status, code: error && error.applicationErrorCode, outcomeKnown: error && error.outcomeKnown, ...notSentFields(error) } });
  const find = async () => ((await wix.send(buildQueryMemberAboutsRequest(memberId))).memberAbouts || []).filter(about => about.memberId === memberId);
  let written, outcome, request;
  try {
    for (let attempt = 0; attempt < 2 && !written; attempt++) {
      const found = await find();
      if (found.length > 1) return { outcome: 'member-about-ambiguous', memberId, aboutId: null, matchCount: found.length };
      request = found.length === 1
        ? buildUpdateMemberAboutRequest({ id: found[0].id, revision: found[0].revision, memberId, content })
        : buildCreateMemberAboutRequest({ memberId, content });
      outcome = found.length === 1 ? 'member-about-updated' : 'member-about-written';
      try {
        written = (await wix.send(request)).memberAbout;
      } catch (error) {
        rethrowRunStop(error);
        // Another write landed between the query and ours (ALREADY_EXISTS, INVALID_REVISION): query once more.
        if (attempt === 0 && error && error.status === 409 && ['ALREADY_EXISTS', 'INVALID_REVISION'].includes(error.applicationErrorCode)) continue;
        return failed(error);
      }
    }
  } catch (error) { rethrowRunStop(error); return failed(error); }
  if (!written || !written.id) return failed(new Error('member About write returned no id'));
  let read;
  try { read = (await wix.send(buildGetMemberAboutRequest(written.id))).memberAbout; } catch (error) {
    rethrowRunStop(error);
    return { outcome: 'member-about-unverified', memberId, aboutId: written.id, error: { message: String(error && error.message).slice(0, 300), status: error && error.status } };
  }
  // Compared with the body actually sent.
  if (!read || read.memberId !== memberId || aboutText(read.content) !== aboutText(request.body.memberAbout.content)) return { outcome: 'member-about-unverified', memberId, aboutId: written.id };
  return { outcome, memberId, aboutId: written.id, revision: read.revision };
}

// --- site notifications mute (Notification Preferences V1) ------------------
// VERIFIED (2026-08-04, full cycle live on a test target): mute → state read →
// idempotent re-mute → unmute → state restored, all HTTP 200. All three calls
// return { siteMuteState: { muted, reason?, mutedBy: { wixUserId } } } — the
// executors unwrap to `siteMuteState`.
// Scope (proto doc comment): mutes ALL notifications of the site
// in context, for all recipients and all channels — sendability is denied regardless
// of recipient-level preferences.
// Hard invariant: when mute is in effect (always for new sites; explicit
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
function _buildMuteSiteNotificationsRequest({ reason } = {}) {
  const body = reason ? { reason: String(reason).slice(0, SITE_MUTE_REASON_MAX) } : {};
  return { method: 'POST', url: `${WIXAPIS}/notification-preferences/v1/site-mute/mute`, body };
}
async function muteSiteNotifications(wix, payload) {
  return (await wix.send(buildMuteSiteNotificationsRequest(payload))).siteMuteState;
}
function _buildUnmuteSiteNotificationsRequest() {
  return { method: 'POST', url: `${WIXAPIS}/notification-preferences/v1/site-mute/unmute`, body: {} };
}
async function unmuteSiteNotifications(wix) {
  return (await wix.send(buildUnmuteSiteNotificationsRequest())).siteMuteState;
}
function _buildGetSiteMuteStateRequest() {
  return { method: 'GET', url: `${WIXAPIS}/notification-preferences/v1/site-mute` };
}
async function getSiteMuteState(wix) {
  return (await wix.send(buildGetSiteMuteStateRequest())).siteMuteState;
}

// --- Wix Events (VERIFIED LIVE 2026-10-27 on a throwaway site) -------------------------
// What the writers below rely on:
// - Categories are flat and names are NOT unique (two "Probe Jazz" were both created). Query
//   Categories returns no rows unless `paging` is sent, and ignores a `name` filter: list with
//   paging and match in code.
// - Create Event accepts past dates (draft or published) and silently DROPS `categories` on create,
//   so assignment is its own write (Bulk Assign Events, one event to all its categories).
//   Query Events never returns drafts, so a draft whose create response was lost cannot be
//   found again: the importer holds it rather than resending.
// - Ticket definitions attach to past ticketing events. Only the alias host is used
//   (`canonical-vs-alias-path`).
// - RSVPs need a PUBLISHED RSVP event (a draft is EVENT_NOT_FOUND). A past event needs
//   `ignoreResponseStatus` (`ignoreLimits` alone still 428 RSVPS_CLOSED). A repeated email with
//   both overrides is ACCEPTED (a second RSVP), so the importer dedupes by email per event and
//   recovers a lost response by listing the event's RSVPs (`email` is not filterable).
const EVENT_INITIAL_TYPES = Object.freeze(['RSVP', 'TICKETING']);
const EVENT_READ_FIELDS = Object.freeze(['DETAILS', 'REGISTRATION', 'CATEGORIES']);
const EVENT_CATEGORY_ASSIGN_MAX = 100;
const EVENT_TICKET_NAME_MAX = 30;
const EVENT_TICKET_PAID_FEE_TYPES = Object.freeze(['FEE_INCLUDED', 'FEE_ADDED_AT_CHECKOUT']);
const EVENT_RSVP_STATUSES = Object.freeze(['YES', 'NO', 'WAITLIST']);
const EVENT_RSVP_READ_FIELDS = Object.freeze(['DETAILS', 'CONTACT_DETAILS']);
const eventFieldsQuery = fields => fields.map(field => `fields=${field}`).join('&');

function _buildCreateEventCategoryRequest({ name } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('events category requires a non-empty name');
  return { method: 'POST', url: `${WIXAPIS}/events/v1/categories`, body: { category: { name, states: ['MANUAL'] } } };
}
async function createEventCategory(wix, payload) {
  return (await wix.send(buildCreateEventCategoryRequest(payload))).category;
}
function _buildQueryEventCategoriesRequest({ limit = 100, offset = 0 } = {}) {
  return { method: 'POST', url: `${WIXAPIS}/events/v1/categories/query`, body: { query: { paging: { limit, offset } } } };
}
// Every category on the site; a lost create response is resolved by exact name over this list.
async function queryAllEventCategories(wix, { limit = 100, maxPages = 50 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const r = await wix.send(buildQueryEventCategoriesRequest({ limit, offset: page * limit }));
    const rows = r.categories || [];
    all.push(...rows);
    if (rows.length < limit) return all;
  }
  throw new Error(`queryAllEventCategories: still paging after ${maxPages} pages; refusing to return a partial category index.`);
}
async function findEventCategoriesByName(wix, name) {
  return (await queryAllEventCategories(wix)).filter(category => category.name === name);
}

// `draft` is required, never defaulted: the event's status comes from the source .
function _buildCreateEventRequest({ event, draft } = {}) {
  if (!event || typeof event !== 'object') throw new Error('events event requires an event object');
  if (typeof draft !== 'boolean') throw new Error('events event requires an explicit draft boolean');
  if (typeof event.title !== 'string' || !event.title.trim()) throw new Error('events event requires a title');
  if (!event.location?.name) throw new Error('events event requires location.name (use an explicit placeholder for a source event with no venue)');
  if (!event.dateAndTimeSettings) throw new Error('events event requires dateAndTimeSettings');
  if (!EVENT_INITIAL_TYPES.includes(event.registration?.initialType)) throw new Error('events event requires registration.initialType RSVP or TICKETING');
  if (event.categories !== undefined) throw new Error('events event: categories are dropped on create; assign them with assignEventToCategories');
  // An imported image is referenced by its media id only: the readiness gate checks
  // event.mainImage.id per record, and a URL would skip that check. Refused before send.
  if (event.mainImage !== undefined && event.mainImage !== null) {
    const image = event.mainImage;
    if (typeof image !== 'object' || typeof image.id !== 'string' || !image.id) {
      throw Object.assign(new Error('events event: mainImage needs the imported media id (mainImage.id from resolveReference("media/media-file", ...)); a mainImage with a url and no id is refused, because the per-record media check reads only mainImage.id'), { code: 'event_main_image_id_required', requestSent: false, outcomeKnown: true });
    }
    event = { ...event, mainImage: { id: image.id, ...(typeof image.altText === 'string' && image.altText ? { altText: image.altText } : {}) } };
  }
  return { method: 'POST', url: `${WIXAPIS}/events/v3/events`, body: { event, draft, fields: [...EVENT_READ_FIELDS] } };
}
async function createEvent(wix, payload) {
  return (await wix.send(buildCreateEventRequest(payload))).event;
}
function _buildGetEventRequest(eventId) {
  if (!eventId) throw new Error('getEvent requires an event id');
  return { method: 'GET', url: `${WIXAPIS}/events/v3/events/${encodeURIComponent(eventId)}?${eventFieldsQuery(EVENT_READ_FIELDS)}` };
}
async function getEvent(wix, eventId) {
  return (await wix.send(buildGetEventRequest(eventId))).event;
}
function _buildQueryEventsRequest({ filter = {}, limit = 100, offset = 0 } = {}) {
  return { method: 'POST', url: `${WIXAPIS}/events/v3/events/query`, body: { query: { filter, paging: { limit, offset } }, fields: [...EVENT_READ_FIELDS] } };
}
// Published events only (Query Events never returns drafts). Matches title and start date as
// instants: Wix reads dates back as second-precision UTC, whatever form the source sent.
async function findPublishedEvents(wix, { title, startDate }) {
  const r = await wix.send(buildQueryEventsRequest({ filter: { title } }));
  const wanted = startDate ? Date.parse(startDate) : null;
  if (startDate && Number.isNaN(wanted)) throw new Error('findPublishedEvents: startDate is not a date');
  return (r.events || []).filter(event => event.title === title && (wanted === null || Date.parse(event.dateAndTimeSettings?.startDate) === wanted));
}
// After a lost create of a published event: one match is read by id on the record's own client and
// adopted (that read is what lets the record's category assignment name the event); none means
// resend; several are held. Outcomes: adopted (with `event`) | none | ambiguous (with `candidateIds`).
async function adoptPublishedEvent(wix, { title, startDate }) {
  const found = await findPublishedEvents(wix, { title, startDate });
  if (!found.length) return { outcome: 'none', event: null };
  if (found.length > 1) return { outcome: 'ambiguous', event: null, candidateIds: found.map(event => event.id) };
  return { outcome: 'adopted', event: await getEvent(wix, found[0].id) };
}

// One event to all of its categories in one call; `categoryId` is checked against the record's
// readiness grant and `eventId` against the record's own event before the request is sent.
function _buildAssignEventToCategoriesRequest({ eventId, categoryIds } = {}) {
  if (!eventId) throw new Error('events category assignment requires an event id');
  if (!Array.isArray(categoryIds) || !categoryIds.length) throw new Error('events category assignment requires at least one category id');
  if (categoryIds.length > EVENT_CATEGORY_ASSIGN_MAX) throw new Error(`events category assignment takes at most ${EVENT_CATEGORY_ASSIGN_MAX} categories`);
  return { method: 'POST', url: `${WIXAPIS}/events/v1/bulk/categories/events`, body: { categoryId: [...categoryIds], eventId: [eventId] } };
}
async function assignEventToCategories(wix, payload) {
  return wix.send(buildAssignEventToCategoriesRequest(payload));
}
function _buildListEventCategoriesRequest(eventId) {
  if (!eventId) throw new Error('listEventCategories requires an event id');
  return { method: 'GET', url: `${WIXAPIS}/events/v1/categories/${encodeURIComponent(eventId)}` };
}
async function listEventCategories(wix, eventId) {
  return (await wix.send(buildListEventCategoriesRequest(eventId))).categories || [];
}

// A paid ticket's feeType comes from the source or the approved mapping review ;
// the builder never picks one.
function _buildCreateTicketDefinitionRequest(ticketDefinition = {}) {
  const { eventId, name, pricingMethod, feeType } = ticketDefinition;
  if (!eventId) throw new Error('events ticket definition requires eventId');
  if (typeof name !== 'string' || !name.trim() || name.length > EVENT_TICKET_NAME_MAX) throw new Error(`events ticket definition name must be 1-${EVENT_TICKET_NAME_MAX} characters; truncate in the mapping and record it`);
  if (!pricingMethod || typeof pricingMethod !== 'object') throw new Error('events ticket definition requires pricingMethod');
  const fixed = pricingMethod.fixedPrice?.value, free = pricingMethod.free === true || (fixed !== undefined && Number(fixed) === 0);
  if (free ? feeType !== 'NO_FEE' : !EVENT_TICKET_PAID_FEE_TYPES.includes(feeType)) throw new Error(free ? 'a free ticket uses feeType NO_FEE' : 'a paid ticket requires feeType FEE_INCLUDED or FEE_ADDED_AT_CHECKOUT from the source or the mapping review');
  return { method: 'POST', url: `${WIXAPIS}/events/v3/ticket-definitions`, body: { ticketDefinition } };
}
async function createTicketDefinition(wix, payload) {
  return (await wix.send(buildCreateTicketDefinitionRequest(payload))).ticketDefinition;
}
function _buildGetTicketDefinitionRequest(id) {
  if (!id) throw new Error('getTicketDefinition requires an id');
  return { method: 'GET', url: `${WIXAPIS}/events/v3/ticket-definitions/${encodeURIComponent(id)}` };
}
async function getTicketDefinition(wix, id) {
  return (await wix.send(buildGetTicketDefinitionRequest(id))).ticketDefinition;
}
function _buildQueryTicketDefinitionsRequest({ eventId, limit = 100 } = {}) {
  if (!eventId) throw new Error('queryTicketDefinitions requires an event id');
  return { method: 'POST', url: `${WIXAPIS}/events/v3/ticket-definitions/query`, body: { query: { filter: { eventId }, cursorPaging: { limit } } } };
}
async function findTicketDefinitionsByName(wix, { eventId, name }) {
  const r = await wix.send(buildQueryTicketDefinitionsRequest({ eventId }));
  return (r.ticketDefinitions || []).filter(row => row.eventId === eventId && row.name === name);
}

// disableNotifications is always set; the two registration overrides default on so a historical
// guest list loads into a closed or full event (disclosed as a cutover item). The form's email
// input is rebuilt from rsvp.email, so the two never disagree.
function _buildCreateRsvpRequest({ rsvp, options = {} } = {}) {
  if (!rsvp || typeof rsvp !== 'object') throw new Error('events rsvp requires an rsvp object');
  if (!rsvp.eventId) throw new Error('events rsvp requires eventId');
  if (typeof rsvp.email !== 'string' || !rsvp.email.trim()) throw new Error('events rsvp requires an email');
  if (!EVENT_RSVP_STATUSES.includes(rsvp.status)) throw new Error('events rsvp status must be YES, NO or WAITLIST');
  const inputs = rsvp.form?.inputValues || [];
  const emailInputs = inputs.filter(input => input.inputName === 'email');
  const withoutEmailInputs = rsvp.form ? { ...rsvp, form: { ...rsvp.form, inputValues: inputs.filter(input => input.inputName !== 'email') } } : rsvp;
  const body = copyRequestBody({
    rsvp: { ...withoutEmailInputs, disableNotifications: true },
    options: { ignoreResponseStatus: true, ignoreLimits: true, ...options },
  });
  if (emailInputs.length) body.rsvp.form.inputValues = [...body.rsvp.form.inputValues, ...emailInputs.map(() => ({ inputName: 'email', value: body.rsvp.email }))];
  return { method: 'POST', url: `${WIXAPIS}/events/v2/rsvps`, body };
}
async function createRsvp(wix, payload) {
  return (await wix.send(buildCreateRsvpRequest(payload))).rsvp;
}
function _buildGetRsvpRequest(id) {
  if (!id) throw new Error('getRsvp requires an id');
  return { method: 'GET', url: `${WIXAPIS}/events/v2/rsvps/${encodeURIComponent(id)}?${eventFieldsQuery(EVENT_RSVP_READ_FIELDS)}` };
}
async function getRsvp(wix, id) {
  return (await wix.send(buildGetRsvpRequest(id))).rsvp;
}
function _buildQueryRsvpsRequest({ eventId, cursor = null, limit = 100 } = {}) {
  if (!eventId) throw new Error('queryRsvps requires an event id');
  return { method: 'POST', url: `${WIXAPIS}/events/v2/rsvps/query`, body: { query: { ...(cursor ? {} : { filter: { eventId } }), cursorPaging: { limit, ...(cursor ? { cursor } : {}) } }, fields: [...EVENT_RSVP_READ_FIELDS] } };
}
// `email` is not filterable on Query Rsvps: list the event's RSVPs and match in code.
async function findRsvpsByEmail(wix, { eventId, email, maxPages = 100 }) {
  const wanted = String(email).trim().toLowerCase(), found = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const r = await wix.send(buildQueryRsvpsRequest({ eventId, cursor }));
    found.push(...(r.rsvps || []).filter(row => row.eventId === eventId && String(row.email || '').toLowerCase() === wanted));
    cursor = r.pagingMetadata?.hasNext ? r.pagingMetadata.cursors?.next : null;
    if (!cursor) return found;
  }
  throw new Error(`findRsvpsByEmail: still paging after ${maxPages} pages; refusing a partial answer.`);
}

// --- Bookings (VERIFIED 2026-08-12) -----------------------------------------------------
// Wix Bookings is NOT automatically present on a fresh headless site, and the absence is easy
// to miss: `/bookings/v2/services` and `/bookings/v2/resources/query` both answer with ordinary
// 200s/validation errors (never an "app not installed" error) even when the Bookings app
// instance does not exist in `GET /apps-installer-service/v1/app-instances` — so a plausible
// response from either endpoint is NOT proof the app is installed. Confirmed live on a fresh site:
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
function _buildInstallWixAppRequest({ appDefId, siteId }) {
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
function _buildGetInstalledWixAppsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/apps-installer-service/v1/app-instances` };
}
// ONE PAGE, unwrapped to the appInstances array — see the READ/RETURN CONTRACT note at the top
// of this file. No cursor has been observed on this endpoint, but
// treat the unwrap the same cautious way as the other query* helpers here.
async function getInstalledWixApps(wix) {
  return (await wix.send(buildGetInstalledWixAppsRequest())).appInstances || [];
}
async function isWixAppInstalled(wix, appDefId) {
  const apps = await getInstalledWixApps(wix);
  return apps.some((a) => a && a.appDefId === appDefId && a.enabled !== false);
}

// --- Install through the editor's own installation service (Harmony sites) -------------------
// The generic app installer lists an app on a Harmony site, but the editor then lacks the pages
// the app adds. The editor-platform installation service adds them as part of the install.
// LIVE-VERIFIED on throwaway Harmony sites: it accepts the Wix CLI site token through the
// dashboard proxy (same kind of host as the pickup-locations route below), needs no editor session,
// and returns `{ results: [{ appDefId, success, error }] }`. It takes any app id; an app with no
// editor part is answered with NO_EDITOR_PART_ERROR, and the caller then uses the generic installer.
const EDITOR_INSTALL_URL = 'https://manage.wix.com/_api/editor-platform-installation/v1/install';
const { STORES_APP_DEF_ID } = require('../../../lib/catalog-baseline.js');
const RICH_TEXT_VIEWER_APP_DEF_ID = '61270055-5726-4cb1-9a7a-467bbbaf465f';
const NO_EDITOR_PART_ERROR = /no EDITOR_INSTALLATION component found|No actions were added to the transaction/i;
// The installer refuses an app whose page path another app already took (Wix bug: it fails where the
// legacy installer renamed the page). The failed app is rolled back.
const PAGE_PATH_CONFLICT_ERROR = /pageUriSEO is invalid: not unique across site/i;
// TEMPORARY. `EDITOR_INSTALL_EXPERIMENTS` are Conductor overrides that a server-to-server call
// leaves off, sent with every editor install: the eCommerce feature that adds the side-cart
// lightbox is closed for Harmony, and any app that pulls in eCommerce fails with "component not found"
// without it. Each must be "B" ("true" is silently ignored). Re-test,
// and empty this list, once that feature is open for Harmony again.
const EDITOR_INSTALL_EXPERIMENTS = Object.freeze(['ecomSideCartAndSuccessPopupLightboxExtensions']);
// Optional per-app data. The service installs an app's own dependencies, so nothing here names
// them, but not the apps its editor widgets need. `companions` are
// those apps, sent first in the same call; an app with no entry installs alone.
// LIVE-TESTED: Stores installed without the rich-text viewer app leaves the editor reporting
// `Component "ricosEditorElements.Viewer" is not found in ClientSpecMap` for its description widgets.
const EDITOR_INSTALL_COMPANIONS = Object.freeze({
  [STORES_APP_DEF_ID]: Object.freeze([RICH_TEXT_VIEWER_APP_DEF_ID]),
});
function editorInstallCompanions(appDefId) {
  return EDITOR_INSTALL_COMPANIONS[appDefId] || [];
}
function editorInstallCookie() {
  const specs = EDITOR_INSTALL_EXPERIMENTS;
  return ['XSRF-TOKEN=nocheck', ...(specs.length ? [`petri_ovr=${specs.map((spec) => `${spec}#B`).join('|')}`] : [])].join('; ');
}
function _buildInstallEditorAppsRequest({ appDefIds, siteId }) {
  if (!Array.isArray(appDefIds) || !appDefIds.length) throw new Error('buildInstallEditorAppsRequest: appDefIds is required');
  if (!siteId) throw new Error('buildInstallEditorAppsRequest: siteId is required');
  return {
    method: 'POST',
    url: EDITOR_INSTALL_URL,
    headers: {
      accept: 'application/json',
      'wix-site-id': siteId,
      'x-wix-meta-site-id': siteId,
      'x-xsrf-token': 'nocheck',
      'x-time-budget': '180000',
      cookie: editorInstallCookie(),
    },
    body: { apps: appDefIds.map((appDefId) => ({ appDefId })) },
  };
}
// Returns the reply: `{ results: [{ appDefId, success, error }] }`. A 200 with `success: false` for
// an app is that app's failure.
async function installEditorApps(wix, { appDefIds, siteId }) {
  return wix.send(buildInstallEditorAppsRequest({ appDefIds, siteId }));
}
// Bounded (10 s) read of which editor the site opens in; null when the answer is malformed.
function _buildGetEditorUrlsRequest() {
  return { method: 'GET', url: `${WIXAPIS}/editor-urls`, readOnly: true, readTimeoutMs: 10000 };
}
async function getEditorType(wix) {
  return editorTypeFromUrls(await wix.send(buildGetEditorUrlsRequest()));
}

// VERIFIED (2026-08-12): POST /form-schema-service/v4/forms/{formId}/clone with an EMPTY body
// clones the named form and inherits its namespace. Creating a form directly in the
// `wix.bookings.v2.bookings` namespace via the generic Create Form call 400s
// `UNSUPPORTED_FORM_NAMESPACE` even with the Bookings app installed — namespace-owned forms
// must be cloned from the app's own default/existing form, never authored fresh. Not needed for
// a stock booking form (see ensureBookingsProvisioned); use this only to build a CUSTOM form per
// the Wix Forms Integration flow (clone, then edit fields, then pass the new id as
// `service.form.id` on create).
function _buildCloneBookingFormRequest(sourceFormId = DEFAULT_BOOKING_FORM_ID) {
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
function _buildQueryBookingsResourcesRequest(query = { paging: { limit: 100 } }) {
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
function _buildCreateBookingsServiceRequest(service) {
  const body = copyRequestBody({ service });
  return {
    method: 'POST',
    url: `${WIXAPIS}/bookings/v2/services`,
    body,
  };
}
async function createBookingsService(wix, service) {
  return (await wix.send(buildCreateBookingsServiceRequest(service))).service;
}
function _buildQueryBookingsServicesRequest(query = { paging: { limit: 100 } }) {
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/services/query`, body: { query } };
}
// ONE PAGE, unwrapped to the services array — see the READ/RETURN CONTRACT note at the top of
// this file.
async function queryBookingsServices(wix, query) {
  return (await wix.send(buildQueryBookingsServicesRequest(query))).services || [];
}
function _buildDeleteBookingsServiceRequest(id) {
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
function _buildCreateCalendarEventRequest(event) {
  return { method: 'POST', url: `${WIXAPIS}/calendar/v3/events`, body: { event } };
}
async function createCalendarEvent(wix, event) {
  return (await wix.send(buildCreateCalendarEventRequest(event))).event;
}
function _buildDeleteCalendarEventRequest(id) {
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
      await pauseFor(wix)(750);
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


// --- gift cards --------------------------------------------------------------
// VERIFIED LIVE (2026-10-27, disposable site): see domains/gift-cards/entities/*.json.
// - A site holds ONE gift card product, and installing the Gift Cards app seeds a default one a
//   few seconds later. So the product writer ENSURES: query, create only when none exists, and
//   on 409 GIFT_CARD_PRODUCT_ALREADY_EXISTS re-query and update the one that is there.
// - Card codes are unique per site. A repeated create answers 409 ALREADY_EXISTS on `code`, even
//   with the same idempotencyKey (the key does not replay the first answer). The card writer
//   therefore reconciles by looking the card up by its FULL code, which Query Gift Cards accepts.
// - `idempotencyKey` is a request parameter beside `giftCard`, not a card field.
// - `notificationInfo` is never sent: an import copies cards, it does not sell them.
const GIFT_CARD_CODE_PATTERN = /^[A-Za-z0-9]{8,20}$/;
const GIFT_CARD_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const GIFT_CARD_PRODUCT_LIMITS = Object.freeze({ name: 55, description: 3000, presetVariants: 200 });

function _buildCreateGiftCardRequest({ giftCard, idempotencyKey } = {}) {
  if (!giftCard || typeof giftCard !== 'object') throw new Error('createGiftCard: giftCard is required.');
  const { notificationInfo, idempotencyKey: nestedKey, ...card } = giftCard;
  const key = idempotencyKey != null ? idempotencyKey : nestedKey;
  if (card.source !== 'MANUAL') throw new Error('createGiftCard: source must be MANUAL for an imported card.');
  if (!GIFT_CARD_CODE_PATTERN.test(String(card.code || ''))) throw new Error('createGiftCard: code must be 8-20 letters or digits (it is how the card is reconciled).');
  if (!GIFT_CARD_AMOUNT_PATTERN.test(String(card.initialValue && card.initialValue.amount))) throw new Error('createGiftCard: initialValue.amount must be a decimal string with at most 2 decimal places.');
  if (!/^[A-Z]{3}$/.test(String(card.currency || ''))) throw new Error('createGiftCard: currency must be a 3-letter ISO 4217 code beside initialValue.');
  if (key != null && (String(key).length < 1 || String(key).length > 100)) throw new Error('createGiftCard: idempotencyKey must be 1-100 characters.');
  return {
    method: 'POST',
    url: `${WIXAPIS}/gift-cards/v1/gift-cards`,
    body: { giftCard: card, ...(key != null ? { idempotencyKey: String(key) } : {}) },
  };
}
function _buildQueryGiftCardsByCodeRequest(code) {
  return { method: 'POST', url: `${WIXAPIS}/gift-cards/v1/gift-cards/query`, body: { query: { filter: { code: String(code) } } } };
}
async function findGiftCardByCode(wix, code) {
  const r = await wix.send(buildQueryGiftCardsByCodeRequest(code));
  return ((r && r.giftCards) || [])[0] || null;
}
function sameGiftCard(sent, found) {
  const sameTime = (a, b) => (a == null && b == null) || (a != null && b != null && Date.parse(a) === Date.parse(b));
  return Number(found.initialValue && found.initialValue.amount) === Number(sent.initialValue.amount)
    && found.currency === sent.currency && sameTime(sent.expirationDate, found.expirationDate);
}
// A client refusal (nothing sent) or a run stop / token expiry (the run is recording what it knows)
// is not this record's outcome: rethrow it so no failed row is written for an unsent card.
function rethrowGiftCardUnsent(error) {
  if (error && (error.requestSent === false || require('../../../lib/wix-auth').isRunInterruption(error))) throw error;
}
function giftCardErrorFields(error) {
  return { message: String(error && error.message).slice(0, 300), status: (error && error.status) || null,
    applicationErrorCode: (error && error.applicationErrorCode) || null, outcomeKnown: error && error.outcomeKnown !== undefined ? error.outcomeKnown : null };
}
// Outcomes: created | adopted (the card was already there with our values) | conflict (a card with
// this code holds other values) | failed. The code in the result is the one we sent; the response's
// own `code` is masked.
async function createGiftCard(wix, payload) {
  const request = buildCreateGiftCardRequest(payload);
  const sent = request.body.giftCard;
  const findings = payload.giftCard.notificationInfo ? [{ code: 'gift-card-notification-not-sent' }] : [];
  const done = (outcome, card, extra = {}) => ({ outcome, id: card ? card.id : null, code: sent.code, ...extra, findings });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let error;
    try {
      const card = (await wix.send(attempt ? buildCreateGiftCardRequest(payload) : request) || {}).giftCard;
      if (card && card.id) return done('created', card);
      error = { message: 'Create Gift Card returned no id', outcomeKnown: false };
    } catch (e) {
      rethrowGiftCardUnsent(e);
      error = e;
    }
    const duplicate = error.status === 409 && error.applicationErrorCode === 'ALREADY_EXISTS';
    const unknown = error.outcomeKnown === false || error.status == null || error.status >= 500 || error.status === 408;
    if (!duplicate && !unknown) return done('failed', null, { error: giftCardErrorFields(error) });
    let found;
    try { found = await findGiftCardByCode(wix, sent.code); } catch (readError) {
      rethrowGiftCardUnsent(readError);
      return done('failed', null, { error: giftCardErrorFields(error), readError: giftCardErrorFields(readError) });
    }
    if (found) return sameGiftCard(sent, found) ? done('adopted', found) : done('conflict', found, { error: giftCardErrorFields(error) });
    if (duplicate) return done('failed', null, { error: giftCardErrorFields(error) });
  }
  return done('failed', null, { error: { message: 'Create Gift Card outcome still unknown after one resend', outcomeKnown: false } });
}

function giftCardProductFields(product) {
  if (!product || typeof product !== 'object') throw new Error('ensureGiftCardProduct: product is required.');
  if ('variants' in product) throw new Error('ensureGiftCardProduct: denominations go in presetVariants, not variants.');
  const { name, description, image, expirationType, fixedExpirationDate, relativeExpirationDate, presetVariants, customVariant } = product;
  if (typeof name !== 'string' || !name.trim() || name.length > GIFT_CARD_PRODUCT_LIMITS.name) throw new Error('ensureGiftCardProduct: name must be 1-55 characters.');
  if (description != null && String(description).length > GIFT_CARD_PRODUCT_LIMITS.description) throw new Error('ensureGiftCardProduct: description must be at most 3000 characters.');
  if (presetVariants != null && (!Array.isArray(presetVariants) || presetVariants.length > GIFT_CARD_PRODUCT_LIMITS.presetVariants)) throw new Error('ensureGiftCardProduct: presetVariants must be an array of at most 200.');
  if (!(presetVariants && presetVariants.length) && !customVariant) throw new Error('ensureGiftCardProduct: at least one preset variant or a customVariant is required.');
  for (const v of presetVariants || []) if (!GIFT_CARD_AMOUNT_PATTERN.test(String(v && v.price && v.price.amount)) || !GIFT_CARD_AMOUNT_PATTERN.test(String(v && v.value && v.value.amount))) throw new Error('ensureGiftCardProduct: each preset variant needs price.amount and value.amount.');
  if (image != null && !(image.id && image.width && image.height)) throw new Error('ensureGiftCardProduct: image needs a Media Manager id, width and height.');
  if (expirationType === 'FIXED' && !(fixedExpirationDate && Date.parse(fixedExpirationDate) > Date.now())) throw new Error('ensureGiftCardProduct: FIXED expiration needs a future fixedExpirationDate.');
  if (expirationType === 'RELATIVE' && !(relativeExpirationDate && relativeExpirationDate.value >= 1 && relativeExpirationDate.period)) throw new Error('ensureGiftCardProduct: RELATIVE expiration needs relativeExpirationDate { value, period }.');
  const fields = { name };
  for (const [key, value] of Object.entries({ description, image, expirationType, presetVariants, customVariant })) if (value != null) fields[key] = value;
  if (expirationType === 'FIXED') fields.fixedExpirationDate = fixedExpirationDate;
  if (expirationType === 'RELATIVE') fields.relativeExpirationDate = relativeExpirationDate;
  return fields;
}
function _buildCreateGiftCardProductRequest(product) {
  return { method: 'POST', url: `${WIXAPIS}/gift-cards/v1/gift-card-products`, body: { giftCardProduct: giftCardProductFields(product) } };
}
function _buildUpdateGiftCardProductRequest({ id, revision, ...product } = {}) {
  if (!id || revision == null) throw new Error('updateGiftCardProduct: id and the current revision are required.');
  return {
    method: 'PATCH',
    url: `${WIXAPIS}/gift-cards/v1/gift-card-products/${encodeURIComponent(id)}`,
    // presetVariants are replaced whole and kept when omitted, so a custom-range-only source sends [].
    body: { giftCardProduct: { id, revision: String(revision), presetVariants: [], ...giftCardProductFields(product) } },
  };
}
function _buildQueryGiftCardProductsRequest() {
  return { method: 'POST', url: `${WIXAPIS}/gift-cards/v1/gift-card-products/query`, body: { query: {} } };
}
function _buildGetGiftCardProductRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/gift-cards/v1/gift-card-products/${encodeURIComponent(id)}` };
}
async function queryGiftCardProducts(wix) {
  return ((await wix.send(buildQueryGiftCardProductsRequest())) || {}).giftCardProducts || [];
}
// Does the product on the site already carry every field we would send?
function giftCardProductMatches(fields, found) {
  const amounts = (variants) => (variants || []).map(v => [Number(v.price.amount), Number(v.value.amount)]);
  const range = (c) => c ? [Number(c.minValue && c.minValue.amount), Number(c.maxValue && c.maxValue.amount)] : null;
  return found.name === fields.name
    && (fields.description == null || found.description === fields.description)
    && (fields.image == null || (found.image && found.image.id) === fields.image.id)
    && (fields.expirationType == null || found.expirationType === fields.expirationType)
    && JSON.stringify(amounts(found.presetVariants)) === JSON.stringify(amounts(fields.presetVariants))
    && (fields.customVariant == null || JSON.stringify(range(found.customVariant)) === JSON.stringify(range(fields.customVariant)));
}
function giftCardProductSnapshot(found) {
  const { id, revision, name, description, image, expirationType, fixedExpirationDate, relativeExpirationDate, presetVariants, customVariant } = found;
  return structuredClone({ id, revision, name, description, image, expirationType, fixedExpirationDate, relativeExpirationDate, presetVariants, customVariant });
}
// Outcomes: created | adopted (the one product already carries our values) | updated-existing-product
// (`previous` holds the replaced values, for the journal) | failed. Safe to run again after any
// unknown outcome: it always converges on the one product carrying the source values.
async function ensureGiftCardProduct(wix, product) {
  const fields = giftCardProductFields(product);
  const findings = [];
  const fail = (error, extra = {}) => ({ outcome: 'failed', id: null, error: giftCardErrorFields(error), ...extra, findings });
  let existing;
  try {
    existing = await queryGiftCardProducts(wix);
    if (!existing.length) {
      try {
        const created = (await wix.send(buildCreateGiftCardProductRequest(product)) || {}).giftCardProduct;
        if (created && created.id) return { outcome: 'created', id: created.id, revision: created.revision, findings };
      } catch (error) {
        rethrowGiftCardUnsent(error);
        const seeded = error.status === 409 && error.applicationErrorCode === 'GIFT_CARD_PRODUCT_ALREADY_EXISTS';
        if (!seeded && error.outcomeKnown !== false && !(error.status >= 500)) return fail(error);
      }
      existing = await queryGiftCardProducts(wix);
      if (!existing.length) return fail({ message: 'No gift card product found after the create', outcomeKnown: false });
    }
  } catch (error) {
    rethrowGiftCardUnsent(error);
    return fail(error);
  }
  if (existing.length > 1) return fail({ message: `Found ${existing.length} gift card products; a site holds one`, outcomeKnown: true });
  const found = existing[0];
  if (giftCardProductMatches(fields, found)) return { outcome: 'adopted', id: found.id, revision: found.revision, findings };
  if (found.customVariant && !fields.customVariant) findings.push({ code: 'gift-card-product-custom-variant-kept' });
  try {
    const updated = (await wix.send(buildUpdateGiftCardProductRequest({ ...product, id: found.id, revision: found.revision })) || {}).giftCardProduct;
    const readBack = (await wix.send(buildGetGiftCardProductRequest(found.id)) || {}).giftCardProduct;
    if (!readBack || !giftCardProductMatches(fields, readBack)) return fail({ message: 'Gift card product read-back does not match the update', outcomeKnown: true }, { id: found.id, previous: giftCardProductSnapshot(found) });
    return { outcome: 'updated-existing-product', id: found.id, revision: (readBack || updated).revision, previous: giftCardProductSnapshot(found), findings };
  } catch (error) {
    rethrowGiftCardUnsent(error);
    return fail(error, { id: found.id, previous: giftCardProductSnapshot(found) });
  }
}

// --- Bookings add-ons and bookings (VERIFIED LIVE 2026-10-27) -----------------
// Probed on a throwaway site. What the live calls showed, beyond the docs:
// 1. Create Add On ACCEPTS a body with both durationInMinutes and maxQuantity (200) and silently
//    keeps only durationInMinutes. The builder refuses both, so a dropped field is never silent.
// 2. price.value comes back normalized ("10.50" -> "10.5"): read-back compares numbers.
// 3. Wix stores any currency it is given (EUR on a USD site); the caller sends the site currency.
// 4. Duplicate add-ons (same name, price, kind) are allowed, so the exact-field lookup can find
//    several; more than one match is ambiguous and creates nothing.
// 5. A group with 8 add-ons 400s "addOnIds has size 8, expected 7 or less". A 4th group on one
//    service was accepted, despite the documented 3-group limit; the writer keeps one group per
//    service, so it never relies on either way.
// 6. A booked add-on needs a valid groupId GUID (400 without one, even with skipAddOnValidation).
// 7. Past-dated slots are accepted with skipAvailabilityValidation; without it, 428
//    SLOT_NOT_AVAILABLE. paymentStatus is ignored at create; Confirm Booking sets it from CREATED.
// 8. A CONFIRMED booking's revision moves on its own (the calendar event is attached after the
//    response), so every follow-up re-reads the revision first. Cancelling a past booking needs
//    flowControlSettings.ignoreCancellationPolicy (else BOOKING_POLICY_VIOLATION).
// 9. contactDetails.contactId of an existing contact creates no contact. externalUserId is stored,
//    echoed and filterable in Query Extended Bookings, and NOT unique: it is the writer's
//    client-assigned reconciliation key, derived from the source key.
// Get Booking is not public (404); bookings are read through Query Extended Bookings.
const BOOKINGS_ADD_ON_GROUP_MAX_ADD_ONS = 7;
const BOOKINGS_ADD_ON_NAME_MAX = 100;
const BOOKINGS_ADD_ON_DEFAULT_GROUP_NAME = 'Add-ons';
const DECIMAL_2 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

// The Add On create body, refused (never repaired) where Wix would reject it or silently drop a
// field. Truncation, the both-kinds split and the currency choice are mapping decisions.
function bookingsAddOnBody(addOn) {
  const { name, durationInMinutes, maxQuantity, price, taxGroup } = addOn || {};
  if (typeof name !== 'string' || !name.trim() || name.length > BOOKINGS_ADD_ON_NAME_MAX) throw new Error(`a bookings add-on needs a name of 1-${BOOKINGS_ADD_ON_NAME_MAX} characters`);
  const hasDuration = durationInMinutes !== undefined && durationInMinutes !== null, hasQuantity = maxQuantity !== undefined && maxQuantity !== null;
  if (hasDuration === hasQuantity) throw new Error('a bookings add-on is either duration-based or quantity-based, never both or neither');
  if (hasDuration && !(Number.isInteger(durationInMinutes) && durationInMinutes >= 1 && durationInMinutes <= 1440)) throw new Error('a bookings add-on durationInMinutes must be an integer 1-1440');
  if (hasQuantity && !(Number.isInteger(maxQuantity) && maxQuantity >= 1 && maxQuantity <= 9999)) throw new Error('a bookings add-on maxQuantity must be an integer 1-9999');
  if (!price || typeof price.value !== 'string' || !DECIMAL_2.test(price.value)) throw new Error('a bookings add-on price.value must be a decimal string with at most 2 decimals');
  if (typeof price.currency !== 'string' || !/^[A-Z]{3}$/.test(price.currency)) throw new Error('a bookings add-on price.currency must be the ISO 4217 site currency');
  return { name, ...(hasDuration ? { durationInMinutes } : { maxQuantity }), price: { value: price.value, currency: price.currency }, ...(taxGroup ? { taxGroup } : {}) };
}
function _buildCreateBookingsAddOnRequest(addOn) {
  return { method: 'POST', url: `${WIXAPIS}/addons/v1/add-ons`, body: { addOn: bookingsAddOnBody(addOn) } };
}
function _buildGetBookingsAddOnRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/addons/v1/add-ons/${encodeURIComponent(id)}` };
}
function _buildQueryBookingsAddOnsRequest(filter) {
  return { method: 'POST', url: `${WIXAPIS}/addons/v1/add-ons/query`, body: { query: { filter, cursorPaging: { limit: 100 } } } };
}
// Rollback only. Deleting an add-on also removes it from every group that holds it.
function _buildDeleteBookingsAddOnRequest(id) {
  return { method: 'DELETE', url: `${WIXAPIS}/addons/v1/add-ons/${encodeURIComponent(id)}` };
}
function addOnGroupIds(addOnIds) {
  if (!Array.isArray(addOnIds) || !addOnIds.length || addOnIds.length > BOOKINGS_ADD_ON_GROUP_MAX_ADD_ONS || addOnIds.some(id => typeof id !== 'string' || !id)) throw new Error(`an add-on group holds 1-${BOOKINGS_ADD_ON_GROUP_MAX_ADD_ONS} add-on ids`);
  return [...addOnIds];
}
function _buildCreateBookingsAddOnGroupRequest({ serviceId, name = BOOKINGS_ADD_ON_DEFAULT_GROUP_NAME, addOnIds }) {
  if (!serviceId) throw new Error('an add-on group needs its service id');
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/services/add-on-groups/create`, body: { addOnGroup: { name, addOnIds: addOnGroupIds(addOnIds) }, serviceId } };
}
// Replaces the group's list; the order is the customer-facing display order.
function _buildSetBookingsAddOnGroupAddOnsRequest({ serviceId, groupId, addOnIds }) {
  if (!serviceId || !groupId) throw new Error('setting a group\'s add-ons needs the service id and the group id');
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/services/add-on-groups/set-add-ons-for-group`, body: { serviceId, groupId, addOnIds: addOnGroupIds(addOnIds) } };
}
function _buildListBookingsAddOnGroupsRequest(serviceId) {
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/services/add-on-groups/list-add-on-groups-by-service-id`, body: { serviceId } };
}
function _buildDeleteBookingsAddOnGroupRequest({ serviceId, groupId }) {
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/services/add-on-groups/delete`, body: { addOnGroupId: groupId, serviceId } };
}
async function listBookingsAddOnGroups(wix, serviceId) {
  return (await wix.send(buildListBookingsAddOnGroupsRequest(serviceId))).addOnGroupsDetails || [];
}
function sameAddOn(found, wanted) {
  return Boolean(found) && found.name === wanted.name && Number(found.price?.value) === Number(wanted.price.value) && found.price?.currency === wanted.price.currency &&
    (found.durationInMinutes ?? null) === (wanted.durationInMinutes ?? null) && (found.maxQuantity ?? null) === (wanted.maxQuantity ?? null) && (found.taxGroup || null) === (wanted.taxGroup || null);
}
function bookingsWriteError(error) {
  const e = error && typeof error === 'object' ? error : {};
  return { message: String(e.message !== undefined ? e.message : error).slice(0, 300), status: e.status ?? null, applicationErrorCode: e.applicationErrorCode || null, outcomeKnown: e.outcomeKnown ?? null };
}
const localRefusal = error => String(error?.code || '').startsWith('target_operation_') || error?.requestSent === false;

// One source extra -> one Wix add-on, then that add-on placed in the import group of every
// service the extra belongs to. `serviceIds` are the record's granted
// bookings/service targets; records run in source order, so appending keeps the source order.
// A service whose group is full (7) leaves the add-on ungrouped there: reported, not hidden.
// Re-run safe: crosswalk id first, then an exact-field lookup before any create.
async function importBookingsAddOn(wix, { addOn, serviceIds = [], groupName = BOOKINGS_ADD_ON_DEFAULT_GROUP_NAME, knownAddOnId = null } = {}) {
  const wanted = bookingsAddOnBody(addOn), findings = [];
  let id = null, matchedBy = null;
  if (knownAddOnId) {
    // The crosswalk add-on with other values is drift (the source extra changed after import):
    // report it and write nothing, never mint a second add-on.
    try { const known = (await wix.send(buildGetBookingsAddOnRequest(knownAddOnId))).addOn; if (sameAddOn(known, wanted)) { id = known.id; matchedBy = 'crosswalk'; } else if (known?.id) return { outcome: 'target-drift', addOnId: known.id, findings }; else findings.push({ code: 'crosswalk-row-stale', knownAddOnId }); }
    catch (error) { rethrowRunStop(error); if (error?.status !== 404 || error.outcomeKnown === false) return { outcome: 'target-read-failed', addOnId: null, error: bookingsWriteError(error), findings }; findings.push({ code: 'crosswalk-row-stale', knownAddOnId }); }
  }
  const lookup = async () => ((await wix.send(buildQueryBookingsAddOnsRequest({ name: wanted.name }))).addOns || []).filter(found => sameAddOn(found, wanted));
  if (!id) {
    let matches;
    try { matches = await lookup(); } catch (error) { rethrowRunStop(error); return { outcome: 'target-read-failed', addOnId: null, error: bookingsWriteError(error), findings }; }
    if (matches.length > 1) return { outcome: 'reconciliation-ambiguous', addOnId: null, matchCount: matches.length, candidateIds: matches.map(row => row.id), findings };
    if (matches.length === 1) { id = matches[0].id; matchedBy = 'fields'; }
  }
  if (!id) {
    try { id = (await wix.send(buildCreateBookingsAddOnRequest(wanted))).addOn?.id || null; }
    catch (error) {
      rethrowRunStop(error);
      if (localRefusal(error)) throw error;
      if (error?.outcomeKnown !== false) return { outcome: 'failed', addOnId: null, error: bookingsWriteError(error), findings };
      let matches = [];
      try { matches = await lookup(); } catch (error) { rethrowRunStop(error); /* still unknown */ }
      if (matches.length !== 1) return { outcome: 'unknown-outcome', addOnId: null, matchCount: matches.length, candidateIds: matches.map(row => row.id), error: bookingsWriteError(error), findings };
      id = matches[0].id; matchedBy = 'unknown-outcome-lookup';
    }
    if (!id) return { outcome: 'unknown-outcome', addOnId: null, error: { message: 'Create Add On returned no id', outcomeKnown: false }, findings };
    if (!sameAddOn((await wix.send(buildGetBookingsAddOnRequest(id))).addOn, wanted)) return { outcome: 'read-back-mismatch', addOnId: id, findings };
  }
  const groups = [], ungroupedServiceIds = [], groupFailures = [];
  for (const serviceId of [...new Set(serviceIds)]) {
    let placed;
    // The add-on exists now: a failed placement never loses its id. The record is
    // partially-written, and a re-run finds the add-on and places it again.
    try { placed = await placeAddOnInServiceGroup(wix, { serviceId, addOnId: id, groupName }); } catch (error) {
      rethrowRunStop(error);
      groupFailures.push({ serviceId, error: { ...bookingsWriteError(error), ...(error?.requestSent === false ? { requestSent: false, code: error.code ?? null } : {}) } });
      continue;
    }
    if (placed.groupId) groups.push({ serviceId, groupId: placed.groupId }); else { ungroupedServiceIds.push(serviceId); findings.push({ code: 'add-on-group-full', serviceId, max: BOOKINGS_ADD_ON_GROUP_MAX_ADD_ONS }); }
  }
  if (groupFailures.length) return { outcome: 'partially-written', addOnId: id, ...(matchedBy ? { matchedBy } : {}), groups, ungroupedServiceIds, groupFailures, error: groupFailures[0].error, findings };
  return { outcome: matchedBy ? 'reconciled-existing' : 'written', addOnId: id, ...(matchedBy ? { matchedBy } : {}), groups, ungroupedServiceIds, findings };
}
// List -> create/set -> read back is a read-modify-write of one service's group, so records of the
// same service never run it at once: parallel records would each create a group, or each set
// `current + own` and drop the other's add-on. One chain per service id, in this process.
const addOnGroupLocks = new Map();
function placeAddOnInServiceGroup(wix, options) {
  const previous = addOnGroupLocks.get(options.serviceId) || Promise.resolve();
  const run = previous.catch((error) => { rethrowRunStop(error); }).then(() => placeAddOnInServiceGroupNow(wix, options));
  const settled = run.catch(() => {});
  addOnGroupLocks.set(options.serviceId, settled);
  settled.then(() => { if (addOnGroupLocks.get(options.serviceId) === settled) addOnGroupLocks.delete(options.serviceId); });
  return run;
}
async function placeAddOnInServiceGroupNow(wix, { serviceId, addOnId, groupName }) {
  const details = await listBookingsAddOnGroups(wix, serviceId);
  const holding = details.find(group => (group.addOns || []).some(row => row.addOnId === addOnId));
  if (holding) return { groupId: holding.groupId };
  // An imported service starts with no groups, so the first group is the import's own.
  const group = details[0];
  let result;
  if (!group) result = (await wix.send(buildCreateBookingsAddOnGroupRequest({ serviceId, name: groupName, addOnIds: [addOnId] }))).addOnGroup;
  else {
    const current = (group.addOns || []).map(row => row.addOnId);
    if (current.length >= BOOKINGS_ADD_ON_GROUP_MAX_ADD_ONS) return { groupId: null };
    result = (await wix.send(buildSetBookingsAddOnGroupAddOnsRequest({ serviceId, groupId: group.groupId, addOnIds: [...current, addOnId] }))).addOnGroup;
  }
  const after = await listBookingsAddOnGroups(wix, serviceId);
  if (!after.some(row => row.groupId === result?.id && (row.addOns || []).some(item => item.addOnId === addOnId))) throw Object.assign(new Error(`add-on ${addOnId} is not in a group of service ${serviceId} after grouping`), { code: 'add-on-group-read-back-mismatch', outcomeKnown: true });
  return { groupId: result.id };
}

// Bookings. The body always sets the import controls: no availability, business-confirmation or
// payment-option validation (these are settled historical records), no participant message and no
// SMS reminder. The status and payment status are replayed after create.
const BOOKING_PAYMENT_STATUSES = new Set(['NOT_PAID', 'PAID', 'PARTIALLY_PAID', 'REFUNDED', 'EXEMPT']);
function bookingExternalKey(sourceStableKey) {
  const h = crypto.createHash('sha256').update('rp-booking:' + String(sourceStableKey)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function _buildCreateBookingRequest({ booking, externalKey, confirmLater = false }) {
  const entity = booking?.bookedEntity;
  if (!entity || Boolean(entity.slot) === Boolean(entity.schedule)) throw new Error('a booking books either a slot (appointment, class) or a schedule (course)');
  // A class booking names a calendar session (slot.eventId) that no import entity produces yet, so
  // the id could not be checked against a granted target; importBooking holds such records.
  if (entity.slot?.eventId) throw new Error('a class-session booking (slot.eventId) is not imported; the writer holds it as class-session-missing');
  if (entity.slot && !(entity.slot.serviceId && entity.slot.startDate && entity.slot.endDate)) throw new Error('an appointment booking needs slot.serviceId, startDate and endDate');
  if (entity.schedule && !(entity.schedule.serviceId && entity.schedule.scheduleId)) throw new Error('a course booking needs schedule.serviceId and scheduleId');
  if (!booking.contactDetails?.contactId) throw new Error('a booking needs the imported contact id, so Wix matches the contact instead of creating one');
  if (!Number.isInteger(booking.totalParticipants) || booking.totalParticipants < 1) throw new Error('a booking needs totalParticipants >= 1');
  if (!externalKey) throw new Error('a booking needs its external key');
  const { status: _status, paymentStatus: _payment, ...rest } = booking;
  const addOns = Array.isArray(rest.bookedAddOns) && rest.bookedAddOns.length > 0;
  return {
    method: 'POST',
    url: `${WIXAPIS}/bookings/v2/bookings`,
    body: {
      booking: { ...rest, status: confirmLater ? 'CREATED' : 'CONFIRMED', selectedPaymentOption: rest.selectedPaymentOption || 'OFFLINE', externalUserId: externalKey },
      participantNotification: { notifyParticipants: false },
      sendSmsReminder: false,
      flowControlSettings: { skipAvailabilityValidation: true, skipBusinessConfirmation: true, skipSelectedPaymentOptionValidation: true, ...(addOns ? { skipAddOnValidation: true } : {}) },
    },
  };
}
function _buildConfirmBookingRequest({ bookingId, revision, paymentStatus }) {
  if (!bookingId || !revision) throw new Error('confirming a booking needs its id and current revision');
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/bookings/${encodeURIComponent(bookingId)}/confirm`, body: { revision, ...(paymentStatus ? { paymentStatus } : {}), participantNotification: { notifyParticipants: false }, sendSmsReminder: false } };
}
function _buildCancelBookingRequest({ bookingId, revision }) {
  if (!bookingId || !revision) throw new Error('cancelling a booking needs its id and current revision');
  return { method: 'POST', url: `${WIXAPIS}/bookings/v2/bookings/${encodeURIComponent(bookingId)}/cancel`, body: { revision, flowControlSettings: { ignoreCancellationPolicy: true }, participantNotification: { notifyParticipants: false } } };
}
function _buildQueryBookingsRequest(filter) {
  return { method: 'POST', url: `${WIXAPIS}/bookings/bookings-reader/v2/extended-bookings/query`, body: { query: { filter, cursorPaging: { limit: 100 } } } };
}
async function queryBookings(wix, filter) {
  return ((await wix.send(buildQueryBookingsRequest(filter))).extendedBookings || []).map(row => row.booking).filter(Boolean);
}
function bookingMatches(found, booking) {
  const slot = booking.bookedEntity.slot, schedule = booking.bookedEntity.schedule, got = found?.bookedEntity || {};
  if (found?.contactDetails?.contactId !== booking.contactDetails.contactId) return false;
  if (schedule) return got.schedule?.scheduleId === schedule.scheduleId && got.schedule?.serviceId === schedule.serviceId;
  return got.slot?.serviceId === slot.serviceId && sameInstant(got.slot?.startDate || found.startDate, slot.startDate) && sameInstant(got.slot?.endDate || found.endDate, slot.endDate);
}
// One source booking -> one Wix booking in its final status. `booking` is the mapped Create
// Booking `booking` object (service, contact, slot or schedule, participants, add-ons); the
// add-on groupIds are filled here from the service's groups. `paymentStatus` other than
// UNDEFINED is replayed by create-as-CREATED then Confirm; `canceled` cancels after that.
// Resume: the crosswalk id, else the externalUserId key; each step runs only if not yet done.
async function importBooking(wix, { booking, sourceStableKey, paymentStatus = null, canceled = false, knownBookingId = null } = {}) {
  if (paymentStatus !== null && !BOOKING_PAYMENT_STATUSES.has(paymentStatus)) throw new Error(`a booking paymentStatus is one of ${[...BOOKING_PAYMENT_STATUSES].join(', ')}`);
  if (booking?.bookedEntity?.slot?.eventId) return { outcome: 'class-session-missing', bookingId: null, findings: [] };
  const findings = [], externalKey = bookingExternalKey(sourceStableKey ?? recordSourceKey(wix));
  // Identity is the crosswalk id or the external key alone. A booking found that way with another
  // service, contact or slot is drift (a source reschedule or contact change after import): it is
  // reported and nothing is written, never a second booking under the same key.
  const read = filter => queryBookings(wix, filter);
  let current = null, matchedBy = null;
  try {
    if (knownBookingId) { [current] = await read({ id: knownBookingId }); if (current) matchedBy = 'crosswalk'; else findings.push({ code: 'crosswalk-row-stale', knownBookingId }); }
    if (!current) {
      const matches = await read({ externalUserId: externalKey });
      if (matches.length > 1) return { outcome: 'reconciliation-ambiguous', bookingId: null, matchCount: matches.length, candidateIds: matches.map(row => row.id), findings };
      if (matches.length === 1) { current = matches[0]; matchedBy = 'external-key'; }
    }
  } catch (error) { rethrowRunStop(error); return { outcome: 'target-read-failed', bookingId: null, error: bookingsWriteError(error), findings }; }
  if (current && !bookingMatches(current, booking)) return { outcome: 'target-drift', bookingId: current.id, matchedBy, findings };
  const payload = await withAddOnGroups(wix, booking, findings);
  if (payload.error) return { outcome: 'failed', bookingId: null, error: payload.error, findings };
  if (!current) {
    try { current = (await wix.send(buildCreateBookingRequest({ booking: payload.booking, externalKey, confirmLater: paymentStatus !== null }))).booking || null; }
    catch (error) {
      rethrowRunStop(error);
      if (localRefusal(error)) throw error;
      if (error?.outcomeKnown !== false) return { outcome: 'failed', bookingId: null, error: bookingsWriteError(error), findings };
      let matches = [];
      try { matches = await read({ externalUserId: externalKey }); } catch (error) { rethrowRunStop(error); /* still unknown */ }
      if (matches.length !== 1) return { outcome: 'unknown-outcome', bookingId: null, matchCount: matches.length, candidateIds: matches.map(row => row.id), error: bookingsWriteError(error), findings };
      current = matches[0]; matchedBy = 'unknown-outcome-lookup';
    }
    if (!current?.id) return { outcome: 'unknown-outcome', bookingId: null, error: { message: 'Create Booking returned no id', outcomeKnown: false }, findings };
  }
  const id = current.id, fresh = async () => (await read({ id }))[0];
  try {
    if (paymentStatus !== null && ['CREATED', 'PENDING', 'WAITING_LIST'].includes(current.status)) {
      const now = await fresh();
      current = (await wix.send(buildConfirmBookingRequest({ bookingId: id, revision: now.revision, paymentStatus }))).booking;
    }
    if (canceled && current.status !== 'CANCELED') {
      const now = await fresh();
      current = (await wix.send(buildCancelBookingRequest({ bookingId: id, revision: now.revision }))).booking;
    }
    const final = await fresh();
    const expectStatus = canceled ? 'CANCELED' : 'CONFIRMED';
    if (!final || final.status !== expectStatus || (paymentStatus !== null && final.paymentStatus !== paymentStatus)) return { outcome: 'read-back-mismatch', bookingId: id, status: final?.status ?? null, paymentStatus: final?.paymentStatus ?? null, findings };
    return { outcome: matchedBy ? 'reconciled-existing' : 'written', bookingId: id, ...(matchedBy ? { matchedBy } : {}), status: final.status, paymentStatus: final.paymentStatus, findings };
  } catch (error) {
    rethrowRunStop(error);
    if (localRefusal(error)) throw error;
    // The booking exists; only a later step failed. A re-run resumes from the crosswalk id.
    return { outcome: 'partially-written', bookingId: id, status: current?.status ?? null, error: bookingsWriteError(error), findings };
  }
}
// Booked add-ons need the GUID of a group on that service (Wix 400s without one). The group that
// holds the add-on is used; an add-on left ungrouped by a full group is attached through the service's
// import group with skipAddOnValidation, which keeps its snapshot on the booking.
async function withAddOnGroups(wix, booking, findings) {
  const rows = booking.bookedAddOns || [];
  if (!rows.length) return { booking };
  const serviceId = booking.bookedEntity.slot?.serviceId || booking.bookedEntity.schedule?.serviceId;
  let groups;
  try { groups = await listBookingsAddOnGroups(wix, serviceId); } catch (error) { rethrowRunStop(error); return { error: bookingsWriteError(error) }; }
  if (!groups.length) return { error: { message: `service ${serviceId} has no add-on group to attach booked add-ons to`, code: 'booked-add-on-group-missing', outcomeKnown: true } };
  const bookedAddOns = rows.map(row => {
    const holding = groups.find(group => (group.addOns || []).some(item => item.addOnId === row.id));
    if (!holding) findings.push({ code: 'booked-add-on-ungrouped', addOnId: row.id, groupId: groups[0].groupId });
    return { ...row, groupId: (holding || groups[0]).groupId };
  });
  return { booking: { ...booking, bookedAddOns } };
}
function recordSourceKey(wix) {
  const key = recordClients.get(wix)?.sourceStableKey;
  if (!key) throw new Error('importBooking needs the record\'s sourceStableKey');
  return key;
}

// --- forms ----------------------------------------------------------------------
// VERIFIED LIVE (2026-10-26, throwaway site): see domains/forms/entities/*.json and the domain
// pitfall form-submission-automations-email-the-owner.
// - Create Form also creates an ACTIVE per-form automation ("New submission received for <form>",
//   a transactional email to the site's team). With the site muted, an API-created entry still
//   emailed the owner; with that automation and the preinstalled site-wide one INACTIVE, none did.
//   So entries import with the form's submission automations paused, and the pause is best-effort:
//   a failed pause is recorded (cutover item), never a reason to hold the form's entries.
// - Updating the PREINSTALLED automation returns it under a NEW id (an override); the old id then
//   404s. The pause ledger stores the returned id.
// - Wix keeps the import date as the entry date (`createdDate` is ignored), so the form gets one
//   hidden "Original submission date" field and each entry carries the source timestamp there.
// - Create Submission answers PENDING; an async spam pass then confirms it or removes it. An entry
//   that ends in spam is recorded and never re-sent; Report Not Spam is never called (it runs the
//   form's automations, like any new submission).
const FORMS_NAMESPACE = 'wix.form_app.form';
const FORM_ORIGINAL_DATE_TARGET = 'original_submission_date';
const FORM_ORIGINAL_DATE_LABEL = 'Original submission date';
const FORM_SUBMITTED_TRIGGER = 'wix_form_app-form_submitted';
const FORM_AUTOMATION_PAUSE_LEDGER = 'execution/forms/automation-pause.json';
const FORM_FIELD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A field target is a Wix field name: letters, digits and "_". Create Form refuses any other
// character for the whole form (UNSUPPORTED_FIELD_TARGETS_NAME; observed in a live run:
// Forminator element ids "name-1", "email-1" held every entry of the form). The writer maps a source-shaped
// target deterministically, on the create AND on every entry, so both sides agree; a valid target
// is unchanged.
function formFieldTarget(target) {
  return typeof target === 'string' ? target.replace(/[^A-Za-z0-9_]/g, '_') : target;
}
const formsSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// The pause and the restore are best-effort: only a run stop (signal, token expiry) escapes them.
// A refused or failed call is recorded, and the entries go ahead.
// A GUID-shaped, lowercase id derived from a seed, so a retried create builds the same schema.
function deterministicFieldId(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function formOriginalDateField(id) {
  return {
    id, hidden: true, identifier: 'TEXT_INPUT', fieldType: 'INPUT',
    inputOptions: { target: FORM_ORIGINAL_DATE_TARGET, pii: false, required: false, readOnly: false, inputType: 'STRING',
      stringOptions: { validation: { format: 'UNKNOWN_FORMAT', enum: [] }, componentType: 'TEXT_INPUT', textInputOptions: { label: FORM_ORIGINAL_DATE_LABEL, showLabel: true } } },
  };
}
const layoutItems = (form) => (form.steps || []).flatMap(step => Object.values((step && step.layout) || {}).flatMap(bp => (bp && bp.items) || []));

// `form` is the Wix Forms schema the mapping built (formFields + steps). The builder checks the
// live-verified invariants and appends the hidden original-date field, placed on the first step.
// `sourceFieldTargets` ({ sourceFieldName: target }) is returned for the crosswalk.
function formsCreatePlan({ form, sourceFieldTargets = {}, originalDateFieldId, sourceFormId } = {}) {
  if (!form || typeof form !== 'object') throw new Error('createForm: form is required.');
  if (typeof form.name !== 'string' || !form.name.trim()) throw new Error('createForm: form.name is required.');
  if (form.namespace != null && form.namespace !== FORMS_NAMESPACE) throw new Error(`createForm: imported forms belong in ${FORMS_NAMESPACE}.`);
  const rawFields = form.formFields;
  if (!Array.isArray(rawFields) || !rawFields.length) throw new Error('createForm: formFields must be a non-empty array.');
  if (!Array.isArray(form.steps) || !form.steps.length) throw new Error('createForm: at least one step with a layout is required.');
  // VERIFIED LIVE 2026-10-27: a step id that is not a GUID fails the create (`steps[0] id is not a valid GUID`).
  for (const step of form.steps) if (step && step.id != null && !FORM_FIELD_ID_PATTERN.test(String(step.id))) throw new Error('createForm: every step id must be a lowercase GUID.');
  const placed = new Set(layoutItems(form).map(item => item.fieldId));
  const targets = new Set();
  const fields = rawFields.map(field => field && field.fieldType === 'INPUT' && field.inputOptions && typeof field.inputOptions.target === 'string' && formFieldTarget(field.inputOptions.target) !== field.inputOptions.target
    ? { ...field, inputOptions: { ...field.inputOptions, target: formFieldTarget(field.inputOptions.target) } } : field);
  sourceFieldTargets = Object.fromEntries(Object.entries(sourceFieldTargets).map(([name, target]) => [name, formFieldTarget(target)]));
  for (const field of fields) {
    if (!field || !FORM_FIELD_ID_PATTERN.test(String(field.id))) throw new Error('createForm: every field needs a lowercase GUID id (the layout matches it).');
    if (!field.identifier) throw new Error(`createForm: field ${field.id} has no identifier (entries are then refused as UNKNOWN_VALUE_ERROR).`);
    if (field.fieldType !== 'INPUT') continue;
    const target = field.inputOptions && field.inputOptions.target;
    if (!target) throw new Error(`createForm: INPUT field ${field.id} has no inputOptions.target.`);
    if (target === FORM_ORIGINAL_DATE_TARGET) throw new Error(`createForm: target ${FORM_ORIGINAL_DATE_TARGET} is reserved for the original submission date.`);
    if (targets.has(target)) throw new Error(`createForm: target ${target} is used twice.`);
    targets.add(target);
    if (!placed.has(field.id)) throw new Error(`createForm: INPUT field ${field.id} is not placed in a step layout (Wix shows its values as empty).`);
  }
  for (const [name, target] of Object.entries(sourceFieldTargets)) if (!targets.has(target)) throw new Error(`createForm: source field ${name} maps to ${target}, which is not a field target.`);
  // Seeded by the source form id when given: two source forms with one name must not share it.
  const dateId = String(originalDateFieldId || deterministicFieldId(`${FORMS_NAMESPACE}:${sourceFormId != null ? `source:${sourceFormId}` : form.name}:${FORM_ORIGINAL_DATE_TARGET}`));
  if (!FORM_FIELD_ID_PATTERN.test(dateId)) throw new Error('createForm: originalDateFieldId must be a lowercase GUID.');
  const [first, ...rest] = form.steps;
  const breakpoints = Object.keys((first && first.layout) || {});
  if (!breakpoints.length) throw new Error('createForm: the first step has no layout.');
  const layout = Object.fromEntries(breakpoints.map(bp => {
    const items = (first.layout[bp] && first.layout[bp].items) || [];
    const row = items.reduce((max, item) => Math.max(max, Number(item.row || 0) + Number(item.height || 1)), 0);
    return [bp, { ...first.layout[bp], items: [...items, { fieldId: dateId, row, column: 0, width: 12, height: 1 }] }];
  }));
  return {
    form: { ...form, namespace: FORMS_NAMESPACE, formFields: [...fields, formOriginalDateField(dateId)], steps: [{ ...first, layout }, ...rest] },
    dateId, sourceFieldTargets: { ...sourceFieldTargets },
  };
}
function _buildCreateFormRequest(payload) {
  return { method: 'POST', url: `${WIXAPIS}/form-schema-service/v4/forms`, body: { form: formsCreatePlan(payload).form } };
}
function _buildQueryFormsRequest({ cursor } = {}) {
  return { method: 'POST', url: `${WIXAPIS}/form-schema-service/v4/forms/query`,
    body: { query: { filter: { namespace: { $eq: FORMS_NAMESPACE } }, cursorPaging: cursor ? { limit: 100, cursor } : { limit: 100 } } } };
}
const nextCursor = (r) => { const m = (r && (r.pagingMetadata || r.metadata)) || {}; return m.hasNext === false ? null : (m.cursors && m.cursors.next) || null; };
// A lost create is found only by the hidden original-date field id, which only this import puts on
// a form. Never by name: Wix renames a colliding name ("Contact (1)"), and the one "Contact" form
// on the site is usually the merchant's own, whose entries must not receive ours.
async function findCreatedForm(wix, name, dateId) {
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const r = await wix.send(buildQueryFormsRequest({ cursor }));
    for (const form of (r && r.forms) || []) {
      const ids = [...(form.formFields || []), ...(form.fields || [])].map(f => f && f.id);
      if (ids.includes(dateId)) return form;
    }
    cursor = nextCursor(r);
    if (!cursor) break;
  }
  return null;
}
function formsCreateResult(outcome, form, plan, extra = {}) {
  const findings = [];
  if (form && form.name && form.name !== plan.form.name) findings.push({ code: 'form-name-renamed', name: form.name });
  return { outcome, id: form ? form.id : null, name: form ? form.name : null, revision: form ? form.revision : null,
    fieldTargets: plan.sourceFieldTargets, originalDateTarget: FORM_ORIGINAL_DATE_TARGET, originalDateFieldId: plan.dateId, ...extra, findings };
}
// Outcomes: created | adopted (a lost create that is on the site) | failed. Record `name` from the
// result (a collision renames it) and persist `fieldTargets` + `originalDateTarget` to the crosswalk.
async function createForm(wix, payload, { readBackFirst = false } = {}) {
  const plan = formsCreatePlan(payload);
  // A re-run of a lost create (`readBack: 'not-found'`) looks for the form by its hidden field
  // first: a create that landed after the read-back is adopted, not made twice.
  if (readBackFirst) {
    const found = await findCreatedForm(wix, plan.form.name, plan.dateId);
    if (found) return formsCreateResult('adopted', found, plan);
  }
  try {
    const form = (await wix.send(buildCreateFormRequest(payload)) || {}).form;
    if (form && form.id) return formsCreateResult('created', form, plan);
    throw Object.assign(new Error('Create Form returned no id'), { outcomeKnown: false });
  } catch (error) {
    rethrowGiftCardUnsent(error);
    const unknown = error.outcomeKnown === false || error.status == null || error.status >= 500 || error.status === 408;
    if (!unknown) return formsCreateResult('failed', null, plan, { error: giftCardErrorFields(error) });
    try {
      const found = await findCreatedForm(wix, plan.form.name, plan.dateId);
      // Not found by its hidden field: the create did not land, and a re-run reads back first.
      return found ? formsCreateResult('adopted', found, plan) : formsCreateResult('failed', null, plan, { error: giftCardErrorFields(error), readBack: 'not-found' });
    } catch (readError) {
      rethrowGiftCardUnsent(readError);
      return formsCreateResult('failed', null, plan, { error: giftCardErrorFields(error), readError: giftCardErrorFields(readError) });
    }
  }
}

// One entry. `originalDate` is the source timestamp; it goes into the hidden field (and into
// createdDate, which Wix ignores today). `submitter` is read-only and refused.
// A source date with no zone ("2022-11-24 10:31:13", Forminator/WordPress local time) is read in
// `timeZone` (the source's IANA zone) when given, else as UTC. Never in the importer machine's
// zone: the same entry must land on the same instant wherever the import runs.
const ZONELESS_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;
function zoneOffsetMs(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
}
function parseSourceDateTime(text, timeZone) {
  const m = typeof text === 'string' ? ZONELESS_DATE_TIME.exec(text.trim()) : null;
  if (!m) return Date.parse(text);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), +((m[7] || '0').padEnd(3, '0')));
  if (!timeZone) return wall;
  let at = wall - zoneOffsetMs(wall, timeZone);
  at = wall - zoneOffsetMs(at, timeZone); // second pass settles a DST boundary
  return at;
}

function _buildCreateFormSubmissionRequest({ submission, originalDate, originalDateTarget = FORM_ORIGINAL_DATE_TARGET, originalDateTimeZone = null } = {}) {
  if (!submission || typeof submission !== 'object') throw new Error('createFormSubmission: submission is required.');
  if (!submission.formId) throw new Error('createFormSubmission: submission.formId is required.');
  if (!submission.submissions || typeof submission.submissions !== 'object' || Array.isArray(submission.submissions)) throw new Error('createFormSubmission: submission.submissions must be a map keyed by field target.');
  if ('submitter' in submission) throw new Error('createFormSubmission: submitter is read-only; carry identity as contactId.');
  const submissions = {};
  for (const [target, value] of Object.entries(submission.submissions)) {
    const key = formFieldTarget(target);
    if (Object.prototype.hasOwnProperty.call(submissions, key)) throw new Error(`createFormSubmission: targets ${target} and another map to ${key}.`);
    submissions[key] = value;
  }
  const body = { ...submission, submissions, seen: submission.seen === undefined ? true : submission.seen };
  if (originalDate != null) {
    const at = parseSourceDateTime(originalDate, originalDateTimeZone);
    if (!Number.isFinite(at)) throw new Error('createFormSubmission: originalDate must be a date-time.');
    const iso = new Date(at).toISOString();
    body.submissions[originalDateTarget] = iso;
    body.createdDate = iso;
  }
  return { method: 'POST', url: `${WIXAPIS}/forms/v4/submissions`, body: { submission: body } };
}
function _buildGetFormSubmissionRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/forms/v4/submissions/${encodeURIComponent(id)}` };
}
function _buildQueryFormSpamReportsRequest({ formId, cursor } = {}) {
  return { method: 'POST', url: `${WIXAPIS}/form-spam-submission-report-service/v4/form-spam-submission-reports/namespace/query`,
    body: { query: { filter: { namespace: { $eq: FORMS_NAMESPACE }, formId: { $eq: String(formId) } }, sort: [{ fieldName: 'reportedDate', order: 'DESC' }], cursorPaging: cursor ? { limit: 100, cursor } : { limit: 100 } } } };
}
// The spam report holding this entry, matched on every value it was sent with (the hidden date
// makes it unique per source entry). Newest first, a few pages only: the import just sent it.
async function findSpamReport(wix, formId, values) {
  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const r = await wix.send(buildQueryFormSpamReportsRequest({ formId, cursor }));
    const hit = ((r && r.formSpamSubmissionReports) || []).find(report => Object.entries(values).every(([k, v]) => JSON.stringify((report.submissions || {})[k]) === JSON.stringify(v)));
    if (hit) return hit;
    cursor = nextCursor(r);
    if (!cursor) break;
  }
  return null;
}
function _buildQueryFormSubmissionsRequest({ formId, cursor } = {}) {
  return { method: 'POST', url: `${WIXAPIS}/form-submission-service/v4/submissions/namespace/query`,
    body: { query: { filter: { namespace: { $eq: FORMS_NAMESPACE }, formId: { $eq: String(formId) } }, cursorPaging: cursor ? { limit: 100, cursor } : { limit: 100 } } } };
}
// The entry this import sent, matched on every value it was sent with (the hidden original date
// makes it unique per source entry). `sent` is the submission body as sent ({ formId, submissions }).
// Bounded: a form with more entries than the pages read is reported not found (unknown stays unknown).
async function findFormSubmission(wix, sent, { maxPages = 50 } = {}) {
  if (!sent || !sent.formId || !sent.submissions) throw new Error('findFormSubmission needs the submission as sent (formId, submissions).');
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const r = await wix.send(buildQueryFormSubmissionsRequest({ formId: sent.formId, cursor }));
    const hit = ((r && r.submissions) || []).find(row => row && row.formId === sent.formId && Object.entries(sent.submissions).every(([k, v]) => JSON.stringify((row.submissions || {})[k]) === JSON.stringify(v)));
    if (hit) return hit;
    cursor = nextCursor(r);
    if (!cursor) break;
  }
  return null;
}
// Outcomes: created (read back CONFIRMED) | in-spam (Wix moved it to spam; `spamReportId`) |
// deleted (gone and not in spam) | pending (not CONFIRMED within the wait; do not re-send) |
// unknown (the create's outcome is unknown; read back before any re-send) | failed (refused).
// None of in-spam, deleted, pending or unknown is ever re-sent by this writer.
//
// Two steps, so a bulk import can send every entry first and read them back after (Wix's spam pass
// needs ~2 s per entry; waiting per entry would serialize that). sendFormSubmission returns
// { outcome: 'sent', id, status, sentAt, sent } or a final outcome; verifyFormSubmission takes a
// 'sent' result to its final outcome, sleeping only while the entry is younger than the interval.
async function sendFormSubmission(wix, payload, { clock = Date.now } = {}) {
  const request = buildCreateFormSubmissionRequest(payload);
  const sent = request.body.submission;
  const done = (outcome, extra = {}) => ({ outcome, formId: sent.formId, ...extra });
  // A create whose reply was lost is read back once (the entry, else its spam report) before it is
  // reported unknown, so a found entry gets its id and is verified like any other.
  const readBack = async (error) => {
    try {
      const found = await findFormSubmission(wix, sent);
      if (found) return found.status === 'CONFIRMED' ? done('created', { id: found.id, status: found.status, adopted: true }) : done('sent', { id: found.id, status: found.status || null, sentAt: clock(), sent, adopted: true });
      const report = await findSpamReport(wix, sent.formId, sent.submissions);
      if (report) return done('in-spam', { spamReportId: report.id, reportReason: report.reportReason || null });
      return done('unknown', { error, readBack: 'not-found' });
    } catch (readError) {
      rethrowGiftCardUnsent(readError);
      return done('unknown', { error, readError: giftCardErrorFields(readError) });
    }
  };
  let created;
  try {
    created = (await wix.send(request) || {}).submission;
  } catch (error) {
    rethrowGiftCardUnsent(error);
    const unknown = error.outcomeKnown === false || error.status == null || error.status >= 500 || error.status === 408;
    return unknown ? readBack(giftCardErrorFields(error)) : done('failed', { error: giftCardErrorFields(error) });
  }
  if (!created || !created.id) return readBack({ message: 'Create Submission returned no id', outcomeKnown: false });
  if (created.status === 'CONFIRMED') return done('created', { id: created.id, status: created.status });
  return done('sent', { id: created.id, status: created.status || null, sentAt: clock(), sent });
}
async function verifyFormSubmission(wix, sendResult, { pollAttempts = 4, pollIntervalMs = 2000, sleep = formsSleep, clock = Date.now } = {}) {
  if (!sendResult || sendResult.outcome !== 'sent') return sendResult;
  const { id, sent } = sendResult;
  const done = (outcome, extra = {}) => ({ outcome, formId: sent.formId, id, ...extra });
  let status = sendResult.status;
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const wait = attempt === 0 ? pollIntervalMs - (clock() - sendResult.sentAt) : pollIntervalMs;
    if (wait > 0) await pauseFor(wix, sleep)(wait);
    try {
      const current = (await wix.send(buildGetFormSubmissionRequest(id)) || {}).submission;
      status = (current && current.status) || status;
      if (status === 'CONFIRMED') return done('created', { status });
    } catch (error) {
      rethrowGiftCardUnsent(error);
      if (error.status !== 404) return done('pending', { status, readError: giftCardErrorFields(error) });
      try {
        const report = await findSpamReport(wix, sent.formId, sent.submissions);
        return report ? done('in-spam', { spamReportId: report.id, reportReason: report.reportReason || null }) : done('deleted');
      } catch (readError) {
        rethrowGiftCardUnsent(readError);
        return done('deleted', { spamCheck: 'failed', readError: giftCardErrorFields(readError) });
      }
    }
  }
  return done('pending', { status });
}
async function createFormSubmission(wix, payload, options = {}) {
  return verifyFormSubmission(wix, await sendFormSubmission(wix, payload, options), options);
}

// Automations V2. Only the form's submission automations are touched: trigger
// `wix_form_app-form_submitted` with a formId filter naming this form, or with no formId filter
// (the preinstalled site-wide one). The update sends the full automation at its current revision.
function _buildQueryAutomationsRequest({ cursor } = {}) {
  return { method: 'POST', url: `${WIXAPIS}/automations-service/v2/automations/query`, body: { query: { cursorPaging: cursor ? { limit: 100, cursor } : { limit: 100 } } } };
}
function _buildGetAutomationRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/automations-service/v2/automations/${encodeURIComponent(id)}` };
}
function _buildUpdateAutomationStatusRequest({ automation, status } = {}) {
  if (!automation || !automation.id || automation.revision == null || !automation.configuration) throw new Error('updateAutomationStatus: the full automation (id, revision, configuration) as read is required.');
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new Error('updateAutomationStatus: status must be ACTIVE or INACTIVE.');
  if ((automation.configuration.trigger || {}).triggerKey !== FORM_SUBMITTED_TRIGGER) throw new Error(`updateAutomationStatus: only ${FORM_SUBMITTED_TRIGGER} automations are changed by the forms import.`);
  return { method: 'PATCH', url: `${WIXAPIS}/automations-service/v2/automations/${encodeURIComponent(automation.id)}`,
    body: { automation: { ...automation, configuration: { ...automation.configuration, status } } } };
}
function formAutomationApplies(automation, formId) {
  const trigger = (automation && automation.configuration && automation.configuration.trigger) || {};
  if (trigger.triggerKey !== FORM_SUBMITTED_TRIGGER) return false;
  const formFilters = (trigger.filters || []).filter(f => f && f.fieldKey === 'formId');
  return !formFilters.length || formFilters.some(f => String(f.filterExpression || '').includes(`"${formId}"`));
}
async function queryFormAutomations(wix, formId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const r = await wix.send(buildQueryAutomationsRequest({ cursor }));
    out.push(...((r && r.automations) || []).filter(a => formAutomationApplies(a, formId)));
    cursor = nextCursor(r);
    if (!cursor) break;
  }
  return out;
}
async function readPauseLedger(projectDir) {
  try { return JSON.parse(await fs.readFile(path.join(projectDir, FORM_AUTOMATION_PAUSE_LEDGER), 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, forms: [] };
    throw error;
  }
}
async function writePauseLedger(projectDir, ledger) {
  const file = path.join(projectDir, FORM_AUTOMATION_PAUSE_LEDGER);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  await fs.rename(tmp, file);
}
const ledgerForm = (ledger, formId) => {
  let row = ledger.forms.find(f => f.formId === formId);
  if (!row) { row = { formId, automations: [] }; ledger.forms.push(row); }
  return row;
};
// The pause ledger for one import, held in memory. A ledger that cannot be read or written never
// blocks the import: it is a finding (`form-pause-ledger-unreadable`), nothing is paused or lowered
// that could not be recorded first, and the restore works from these in-memory rows. An unreadable
// ledger is never overwritten (it may hold other forms' rows).
async function openPauseLedger(projectDir, formId) {
  const session = { projectDir, formId, ledger: { schemaVersion: 1, forms: [] }, readError: null, findings: [] };
  try { session.ledger = await readPauseLedger(projectDir); } catch (error) {
    session.readError = error;
    ledgerFinding(session, error);
  }
  return session;
}
function ledgerFinding(session, error) {
  if (!session.findings.length) session.findings.push({ code: 'form-pause-ledger-unreadable', formId: session.formId, ledger: FORM_AUTOMATION_PAUSE_LEDGER, error: giftCardErrorFields(error) });
}
async function savePauseLedger(session) {
  if (session.readError) return false;
  try { await writePauseLedger(session.projectDir, session.ledger); return true; } catch (error) {
    ledgerFinding(session, error);
    return false;
  }
}
const NOT_RECORDED = { message: 'the pause ledger could not be written first; left unchanged' };
// An automation's current id: the recorded one, or (after an override changed it and the process
// stopped before recording it) the one automation of this form with the same name.
async function currentAutomation(wix, row, formId) {
  try {
    const a = (await wix.send(buildGetAutomationRequest(row.currentId)) || {}).automation;
    if (a) return a;
  } catch (error) {
    rethrowGiftCardUnsent(error);
    if (error.status !== 404) throw error;
  }
  const same = (await queryFormAutomations(wix, formId)).filter(a => a.name === row.name);
  return same.length === 1 ? same[0] : null;
}
async function setAutomationStatus(wix, automation, status) {
  const updated = (await wix.send(buildUpdateAutomationStatusRequest({ automation, status })) || {}).automation;
  const id = (updated && updated.id) || automation.id;
  const readBack = (await wix.send(buildGetAutomationRequest(id)) || {}).automation;
  return { id, ok: Boolean(readBack && readBack.configuration && readBack.configuration.status === status) };
}
const pauseFindings = (formId, failed) => failed.map(row => ({ code: 'form-automations-not-paused', formId, automationId: row.automationId, error: row.error }));
// VERIFIED LIVE 2026-10-27: Create Form adds the form's own "New submission received" automation
// about 2 s AFTER the create returns, so a form created moments ago may not show it yet. Entries
// never wait for it: `ownMissing` tells importFormEntries to query again after each sent entry for
// up to OWN_AUTOMATION_WINDOW_MS. `ownAutomationWaitMs` stays 0 in imports.
const OWN_AUTOMATION_WINDOW_MS = 10000;
const ownFormAutomation = (automation, formId) => ((automation.configuration && automation.configuration.trigger && automation.configuration.trigger.filters) || [])
  .some(f => f && f.fieldKey === 'formId' && String(f.filterExpression || '').includes(`"${formId}"`));
// Best-effort and idempotent on resume: ONE bounded attempt per automation (query, update,
// read-back), no retry or poll. The ledger row is written BEFORE each update, so a stop never
// loses what to restore; when it cannot be written, that automation is left as it is. Returns
// { paused, failed, ownMissing, findings }: a failed pause is a finding and the cutover item
// `form-automations-not-paused`; the form's entries are still written right away.
async function pauseInSession(session, wix, { now, ownAutomationWaitMs = 0, sleep = formsSleep }) {
  const { formId } = session;
  const form = ledgerForm(session.ledger, formId);
  const paused = [], failed = [];
  let found;
  try {
    found = await queryFormAutomations(wix, formId);
    if (ownAutomationWaitMs > 0 && !found.some(a => ownFormAutomation(a, formId))) {
      await pauseFor(wix, sleep)(ownAutomationWaitMs);
      found = await queryFormAutomations(wix, formId);
    }
  } catch (error) {
    rethrowRunStop(error);
    const failedQuery = [{ automationId: null, name: null, error: giftCardErrorFields(error) }];
    return { formId, paused, failed: failedQuery, ownMissing: false, findings: pauseFindings(formId, failedQuery) };
  }
  for (const automation of found) {
    let row = form.automations.find(r => !r.restoredAt && (r.originalId === automation.id || r.currentId === automation.id));
    if (row && row.pausedAt) { paused.push(row); continue; }
    if (!row && automation.configuration.status !== 'ACTIVE') continue;
    if (!row) {
      row = { originalId: automation.id, currentId: automation.id, name: automation.name || null, statusBefore: automation.configuration.status, pausedAt: null, restoredAt: null };
      form.automations.push(row);
      if (!(await savePauseLedger(session))) {
        form.automations.splice(form.automations.indexOf(row), 1);
        failed.push({ automationId: automation.id, name: row.name, error: NOT_RECORDED });
        continue;
      }
    }
    try {
      const result = await setAutomationStatus(wix, automation, 'INACTIVE');
      row.currentId = result.id;
      if (result.ok) { row.pausedAt = now(); paused.push(row); } else failed.push({ automationId: result.id, name: row.name, error: { message: 'read-back is not INACTIVE' } });
    } catch (error) {
      rethrowRunStop(error);
      failed.push({ automationId: row.currentId, name: row.name, error: giftCardErrorFields(error) });
    }
    await savePauseLedger(session);
  }
  return { formId, paused, failed, ownMissing: !found.some(a => ownFormAutomation(a, formId)), findings: pauseFindings(formId, failed) };
}
async function pauseFormAutomations(wix, { projectDir, formId, now = () => new Date().toISOString(), ownAutomationWaitMs = 0, sleep = formsSleep } = {}) {
  if (!projectDir || !formId) throw new Error('pauseFormAutomations: projectDir and formId are required.');
  const session = await openPauseLedger(projectDir, formId);
  const result = await pauseInSession(session, wix, { now, ownAutomationWaitMs, sleep });
  return { ...result, findings: [...session.findings, ...result.findings] };
}
// Restores only what the ledger says this import paused, to its recorded status. Run it after the
// form's entries, and on every stop and resume path. One bounded attempt per automation.
// Returns { restored, notRestored, findings }: a failed restore is a finding and the cutover item
// `form-automations-not-restored`.
async function restoreAutomationsInSession(session, wix, { now }) {
  const { formId } = session;
  const form = session.ledger.forms.find(f => f.formId === formId);
  const restored = [], notRestored = [];
  for (const row of (form && form.automations) || []) {
    if (row.restoredAt) continue;
    try {
      const automation = await currentAutomation(wix, row, formId);
      if (!automation) { notRestored.push({ ...row, error: { message: 'automation not found' } }); continue; }
      row.currentId = automation.id;
      if (automation.configuration.status === row.statusBefore) { row.restoredAt = now(); restored.push(row); continue; }
      const result = await setAutomationStatus(wix, automation, row.statusBefore);
      row.currentId = result.id;
      if (result.ok) { row.restoredAt = now(); restored.push(row); } else notRestored.push({ ...row, error: { message: `read-back is not ${row.statusBefore}` } });
    } catch (error) {
      rethrowRunStop(error);
      notRestored.push({ ...row, error: giftCardErrorFields(error) });
    } finally {
      await savePauseLedger(session);
    }
  }
  return { formId, restored, notRestored,
    findings: notRestored.map(row => ({ code: 'form-automations-not-restored', formId, automationId: row.currentId, error: row.error })) };
}
async function restoreFormAutomations(wix, { projectDir, formId, now = () => new Date().toISOString() } = {}) {
  if (!projectDir || !formId) throw new Error('restoreFormAutomations: projectDir and formId are required.');
  const session = await openPauseLedger(projectDir, formId);
  const result = await restoreAutomationsInSession(session, wix, { now });
  return { ...result, findings: [...session.findings, ...result.findings] };
}
// The form's spam filter, handled like its automations. Under ADVANCED the async spam pass
// removed a genuine historical entry, and nobody can submit the form while it is on no page, so
// the import lowers it to NONE and puts it back afterwards. One bounded attempt (read, update,
// read-back); a failure is a finding (`form-spam-filter-not-lowered` / `-not-restored`) and the
// entries go ahead. The level before is in the pause ledger, written before the update; when it
// cannot be written, the level is left as it is.
const FORM_SPAM_LEVELS = ['NONE', 'BASIC', 'ADVANCED'];
function _buildGetFormRequest(id) {
  return { method: 'GET', url: `${WIXAPIS}/form-schema-service/v4/forms/${encodeURIComponent(id)}` };
}
// Update Form with a corrected schema at the form's current revision. The schema goes through the
// same formsCreatePlan as Create Form (checked invariants, the hidden original-date field with its
// deterministic id), so a form an earlier builder created with a broken field shape is repaired in
// place instead of created a second time.
function _buildUpdateFormSchemaRequest({ formId, revision, ...payload } = {}) {
  if (!formId || revision == null) throw new Error('updateFormSchema: formId and the current revision are required.');
  const plan = formsCreatePlan(payload);
  return { method: 'PATCH', url: `${WIXAPIS}/form-schema-service/v4/forms/${encodeURIComponent(formId)}`,
    body: { form: { ...plan.form, id: String(formId), revision: String(revision) } } };
}
// The INPUT field targets a form's live formFields carry. A form an earlier builder created can
// hold its inputs only in the legacy fields[] projection; it then carries none here.
const formInputTargets = form => new Set((form && form.formFields || []).filter(f => f && f.fieldType === 'INPUT' && f.inputOptions && f.inputOptions.target).map(f => f.inputOptions.target));
// True when the live form lacks an input target the planned schema has (entries for it are refused).
function formSchemaNeedsUpdate(liveForm, payload) {
  const live = formInputTargets(liveForm);
  return [...formInputTargets(formsCreatePlan(payload).form)].some(target => !live.has(target));
}
// LIVE-VERIFIED (2026-10-31): Update Form with the full schema body at the current revision repaired
// a form created with inputs only in fields[] in place (same id; entries then landed).
// Outcomes: unchanged (the live form already has every planned input target; nothing is sent, and
// ownership is not checked) | updated | failed. Only a form this import created is updated: the live form must carry the hidden
// original-date field id the plan derives (the identity findCreatedForm uses), so a merchant's own
// form is never overwritten. The form is read first for its schema and current revision.
async function updateFormSchema(wix, { formId, ...payload } = {}) {
  if (!formId) throw new Error('updateFormSchema: formId is required.');
  const plan = formsCreatePlan(payload);
  const current = (await wix.send(buildGetFormRequest(formId)) || {}).form;
  if (!current || current.revision == null) throw Object.assign(new Error('Get Form returned no form revision'), { outcomeKnown: true, requestSent: false });
  // A healthy form is left as it is, whatever seeded its hidden field id; ownership gates only the write.
  if (!formSchemaNeedsUpdate(current, payload)) return formsCreateResult('unchanged', current, plan);
  const ids = [...(current.formFields || []), ...(current.fields || [])].map(f => f && f.id);
  if (!ids.includes(plan.dateId)) return formsCreateResult('failed', current, plan, { reason: 'form-not-created-by-import' });
  const form = (await wix.send(buildUpdateFormSchemaRequest({ formId, revision: current.revision, ...payload })) || {}).form;
  if (!form || form.id !== String(formId)) throw Object.assign(new Error('Update Form returned no matching form'), { outcomeKnown: false });
  return formsCreateResult('updated', form, plan);
}
// A partial Update Form: only `spamFilterProtectionLevel`, at the form's current revision
// (formFields is not sent, so the fields are untouched).
function _buildUpdateFormSpamFilterRequest({ formId, revision, level } = {}) {
  if (!formId || revision == null) throw new Error('updateFormSpamFilter: formId and the current revision are required.');
  if (!FORM_SPAM_LEVELS.includes(level)) throw new Error(`updateFormSpamFilter: level must be one of ${FORM_SPAM_LEVELS.join(', ')}.`);
  return { method: 'PATCH', url: `${WIXAPIS}/form-schema-service/v4/forms/${encodeURIComponent(formId)}`,
    body: { form: { id: String(formId), revision: String(revision), spamFilterProtectionLevel: level } } };
}
// Wix's documented default when the field is absent.
const spamLevelOf = (form) => (form && form.spamFilterProtectionLevel) || 'ADVANCED';
async function setFormSpamFilter(wix, formId, level) {
  const form = (await wix.send(buildGetFormRequest(formId)) || {}).form;
  if (!form) throw Object.assign(new Error('Get Form returned no form'), { outcomeKnown: true });
  if (spamLevelOf(form) !== level) await wix.send(buildUpdateFormSpamFilterRequest({ formId, revision: form.revision, level }));
  const readBack = (await wix.send(buildGetFormRequest(formId)) || {}).form;
  return spamLevelOf(readBack) === level;
}
async function lowerSpamInSession(session, wix, { now }) {
  const { formId } = session;
  const form = ledgerForm(session.ledger, formId);
  const fail = (error) => ({ formId, lowered: false, findings: [{ code: 'form-spam-filter-not-lowered', formId, error }] });
  if (form.spamFilter && !form.spamFilter.restoredAt && form.spamFilter.loweredAt) return { formId, lowered: true, findings: [] };
  try {
    if (!form.spamFilter || form.spamFilter.restoredAt) {
      const current = (await wix.send(buildGetFormRequest(formId)) || {}).form;
      if (!current) return fail({ message: 'Get Form returned no form' });
      const previous = form.spamFilter;
      form.spamFilter = { levelBefore: spamLevelOf(current), loweredAt: null, restoredAt: null };
      if (!(await savePauseLedger(session))) {
        if (previous) form.spamFilter = previous; else delete form.spamFilter;
        return fail(NOT_RECORDED);
      }
    }
    const ok = await setFormSpamFilter(wix, formId, 'NONE');
    if (ok) { form.spamFilter.loweredAt = now(); await savePauseLedger(session); }
    return ok ? { formId, lowered: true, findings: [] } : fail({ message: 'read-back is not NONE' });
  } catch (error) {
    rethrowRunStop(error);
    return fail(giftCardErrorFields(error));
  }
}
async function lowerFormSpamFilter(wix, { projectDir, formId, now = () => new Date().toISOString() } = {}) {
  if (!projectDir || !formId) throw new Error('lowerFormSpamFilter: projectDir and formId are required.');
  const session = await openPauseLedger(projectDir, formId);
  const result = await lowerSpamInSession(session, wix, { now });
  return { ...result, findings: [...session.findings, ...result.findings] };
}
async function restoreSpamInSession(session, wix, { now }) {
  const { formId } = session;
  const form = session.ledger.forms.find(f => f.formId === formId);
  const spam = form && form.spamFilter;
  if (!spam || spam.restoredAt) return { formId, restored: true, findings: [] };
  const fail = (error) => ({ formId, restored: false, levelBefore: spam.levelBefore, findings: [{ code: 'form-spam-filter-not-restored', formId, levelBefore: spam.levelBefore, error }] });
  try {
    if (!(await setFormSpamFilter(wix, formId, spam.levelBefore))) return fail({ message: `read-back is not ${spam.levelBefore}` });
    spam.restoredAt = now();
    await savePauseLedger(session);
    return { formId, restored: true, findings: [] };
  } catch (error) {
    rethrowRunStop(error);
    return fail(giftCardErrorFields(error));
  }
}
async function restoreFormSpamFilter(wix, { projectDir, formId, now = () => new Date().toISOString() } = {}) {
  if (!projectDir || !formId) throw new Error('restoreFormSpamFilter: projectDir and formId are required.');
  const session = await openPauseLedger(projectDir, formId);
  const result = await restoreSpamInSession(session, wix, { now });
  return { ...result, findings: [...session.findings, ...result.findings] };
}

// What the session still has changed for its form: automations and the spam filter.
function pendingInSession(session) {
  const { formId } = session;
  const form = session.ledger.forms.find(f => f.formId === formId);
  return {
    automations: ((form && form.automations) || []).filter(r => !r.restoredAt).map(r => ({ formId, currentId: r.currentId, originalId: r.originalId })),
    spamFilter: form && form.spamFilter && !form.spamFilter.restoredAt ? { formId, levelBefore: form.spamFilter.levelBefore } : null,
  };
}
// Restores both from the session's rows (this run's, plus an earlier run's read at the start),
// best-effort: only a run stop escapes.
async function restoreFormChanges(session, wix, { now }) {
  let automations;
  try { automations = await restoreAutomationsInSession(session, wix, { now }); } catch (error) {
    rethrowRunStop(error);
    const notRestored = pendingInSession(session).automations.map(row => ({ ...row, error: giftCardErrorFields(error) }));
    automations = { notRestored, findings: notRestored.map(row => ({ code: 'form-automations-not-restored', formId: session.formId, automationId: row.currentId, error: row.error })) };
  }
  let spam;
  try { spam = await restoreSpamInSession(session, wix, { now }); } catch (error) {
    rethrowRunStop(error);
    const pending = pendingInSession(session).spamFilter;
    spam = pending ? { restored: false, levelBefore: pending.levelBefore, findings: [{ code: 'form-spam-filter-not-restored', formId: session.formId, levelBefore: pending.levelBefore, error: giftCardErrorFields(error) }] } : { restored: true, findings: [] };
  }
  return {
    findings: [...automations.findings, ...spam.findings],
    automationsNotRestored: automations.notRestored.map(row => ({ formId: session.formId, currentId: row.currentId, originalId: row.originalId, error: row.error })),
    spamFilterNotRestored: spam.restored ? [] : [{ formId: session.formId, levelBefore: spam.levelBefore }],
  };
}

const FORM_READ_POOL = 4;
// One form's entries, in four phases, each best-effort and none ever delaying an entry:
//   1. pause the form's automations and lower its spam filter (one attempt each);
//   2. SEND every entry in order (while the form's own automation is still missing, for up to
//      10 s after the pause, query again after each send: Wix adds it ~2 s after Create Form);
//   3. READ BACK every sent entry with a pool of FORM_READ_POOL, each on its own record client,
//      sleeping only while an entry is younger than the poll interval;
//   4. restore the automations and the spam filter, also after a run stop.
// `entries` are [{ wix, payload }], each `wix` the entry's own record client (bindRecordClient).
// It ALWAYS returns its results; only a run stop (signal, token expiry) rethrows, after the restore
// attempt. An entry the client refuses before sending is `not-sent`. `findings` go to the run
// report; automationsNotPaused / automationsNotRestored / spamFilterNotRestored feed the cutover
// items. The ledger keeps whatever is still changed for the resumed run to restore.
//
// Resume with no entries left: pass `wix`, a record client bound (under the entries task's grant)
// to any one of this form's entry keys, and the earlier run's changes are restored. Without it they
// are returned as not restored, so their cutover items are never lost.
// `pauseLedgerUnreadable` feeds the cutover item of that name: with no readable ledger, an
// automation an earlier stopped run left off cannot be told apart from one the owner turned off.
async function importFormEntries(options = {}) {
  const result = await importFormEntriesOnce(options);
  const unreadable = result.findings.some(f => f.code === 'form-pause-ledger-unreadable');
  return { ...result, pauseLedgerUnreadable: unreadable ? [{ formId: result.formId }] : [] };
}
async function importFormEntriesOnce({ projectDir, formId, entries = [], wix = null, writeOptions = {}, now = () => new Date().toISOString() } = {}) {
  const session = await openPauseLedger(projectDir, formId);
  const none = { formId, results: [], findings: [], automationsNotPaused: [], automationsNotRestored: [], spamFilterNotRestored: [] };
  if (!entries.length) {
    const pending = pendingInSession(session);
    if (!pending.automations.length && !pending.spamFilter) return { ...none, findings: [...session.findings] };
    if (wix) { const restore = await restoreFormChanges(session, wix, { now }); return { ...none, ...restore, findings: [...session.findings, ...restore.findings] }; }
    return { ...none, findings: [...session.findings], automationsNotRestored: pending.automations, spamFilterNotRestored: pending.spamFilter ? [pending.spamFilter] : [] };
  }
  const clock = writeOptions.clock || Date.now;
  let stopped = null;
  const guard = async (step, fallback) => { if (stopped) return fallback; try { return await step(); } catch (error) { rethrowRunStop(error); return fallback; } };
  let pause = { paused: [], failed: [], ownMissing: false, findings: [] }, spam = { findings: [] };
  const lateFindings = [], sends = [];
  try {
    pause = await guard(() => pauseInSession(session, entries[0].wix, { now }), { paused: [], failed: [{ automationId: null, error: { message: 'pause failed' } }], ownMissing: false, findings: [] });
    const pausedAt = clock();
    spam = await guard(() => lowerSpamInSession(session, entries[0].wix, { now }), { findings: [{ code: 'form-spam-filter-not-lowered', formId, error: { message: 'lower failed' } }] });

    for (const entry of entries) {
      try { sends.push(await sendFormSubmission(entry.wix, entry.payload, { clock })); } catch (error) {
        rethrowRunStop(error);
        sends.push({ outcome: 'not-sent', formId, error: giftCardErrorFields(error) });
      }
      // The form's own automation was not there yet: query again now, at no extra wait. The pause
      // is idempotent, so what was already paused is kept.
      if (pause.ownMissing && clock() - pausedAt < OWN_AUTOMATION_WINDOW_MS) {
        const again = await guard(() => pauseInSession(session, entry.wix, { now }), null);
        if (again) {
          const late = again.paused.filter(row => !pause.paused.some(p => p.originalId === row.originalId));
          // Entries already sent may have run it once: a run-report finding, not a cutover item.
          lateFindings.push(...late.map(row => ({ code: 'form-automation-paused-after-entries', formId, automationId: row.currentId, entriesBefore: sends.length })));
          pause = { ...again, failed: [...pause.failed.filter(f => !again.paused.some(p => p.currentId === f.automationId || p.originalId === f.automationId)), ...again.failed.filter(f => !pause.failed.some(p => p.automationId === f.automationId))] };
        }
      }
    }
  } catch (error) {
    stopped = error;
  }

  // Read-back pool: entries keep their order in `results`.
  const results = sends.slice();
  if (!stopped) {
    let next = 0;
    const worker = async () => {
      while (!stopped && next < sends.length) {
        const index = next++;
        if (sends[index].outcome !== 'sent') continue;
        try { results[index] = await verifyFormSubmission(entries[index].wix, sends[index], { ...writeOptions, clock }); } catch (error) {
          if (require('../../../lib/wix-auth').isRunInterruption(error)) { stopped = stopped || error; return; }
          results[index] = { outcome: 'pending', formId, id: sends[index].id, status: sends[index].status, readError: giftCardErrorFields(error) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(FORM_READ_POOL, sends.length) }, worker));
  }
  for (const [index, result] of results.entries()) if (result && result.outcome === 'sent') { const { sent, sentAt, ...rest } = result; results[index] = { ...rest, outcome: 'pending' }; }
  const last = entries[Math.max(0, sends.length - 1)].wix;
  // An automation that appeared after the pause, or that the pause never saw, ran for these entries:
  // record it (one query, after the entries), never re-send anything.
  let late = [];
  if (!stopped) {
    const known = new Set(ledgerForm(session.ledger, formId).automations.flatMap(r => [r.originalId, r.currentId]));
    late = await guard(async () => (await queryFormAutomations(last, formId)).filter(a => a.configuration.status === 'ACTIVE' && !known.has(a.id))
      .map(a => ({ automationId: a.id, name: a.name || null, error: { message: 'active during the import; not paused' } })), []);
  }
  let restore;
  try { restore = await restoreFormChanges(session, last, { now }); } catch (error) {
    throw stopped || error;
  }
  if (stopped) throw stopped;
  const notPaused = [...pause.failed, ...late.filter(row => !pause.failed.some(f => f.automationId === row.automationId))];
  return {
    formId, results: results.map(({ sent, sentAt, ...rest }) => rest),
    findings: [...session.findings, ...pauseFindings(formId, notPaused), ...lateFindings, ...spam.findings, ...restore.findings],
    automationsNotPaused: notPaused.map(row => ({ formId, automationId: row.automationId, error: row.error })),
    automationsNotRestored: restore.automationsNotRestored, spamFilterNotRestored: restore.spamFilterNotRestored,
  };
}

// Every paused automation not yet restored, across forms: what a completion report turns into
// `form-automations-not-restored`.
async function pendingFormAutomationRestores(projectDir) {
  const ledger = await readPauseLedger(projectDir);
  return ledger.forms.flatMap(f => f.automations.filter(r => !r.restoredAt).map(r => ({ formId: f.formId, ...r })));
}
// Every lowered spam filter not yet restored: `form-spam-filter-not-restored`.
async function pendingFormSpamFilterRestores(projectDir) {
  const ledger = await readPauseLedger(projectDir);
  return ledger.forms.filter(f => f.spamFilter && !f.spamFilter.restoredAt).map(f => ({ formId: f.formId, levelBefore: f.spamFilter.levelBefore }));
}

// Reviewed helpers that write an entity only through its own writer or marked builders (a
// reconcile-then-create, or a batch the codegen guide prescribes). A task may name one as the
// entity's write operation; the writer-gate test checks each one calls only that entity's writes.
const WRITE_HELPERS_BY_ENTITY = Object.freeze({
  // addDeliveryRegion stays accepted: importers generated on earlier toolkits name it.
  'ecom/delivery-profile': Object.freeze(['addDeliveryRegion', 'ensureDeliveryRegion', 'updateDeliveryRegion']),
  'stores/coupon': Object.freeze(['bulkCreateCoupons', 'ensureCoupon']),
  'members/member': Object.freeze(['updateMemberContact']),
});

// Every function in this file that produces a marked write request, by the entity its mark names:
// what an import client can accept a write for. A task's write operation counts as a writer for an
// entity only through this map, the entity's writerId, or its operation contracts; a native entity
// with none of them uses guarded raw requests. The contract test re-derives this map from the
// markRequest calls in this file, so a new or moved builder must be listed here.
const WRITE_BUILDERS_BY_ENTITY = Object.freeze({
  'blog/category': Object.freeze(['buildCreateCategoryRequest']),
  'blog/post': Object.freeze(['buildBulkCreateDraftPostsRequest', 'buildCreateBuildDraftPostRequest', 'buildCreateDraftPostRequest', 'buildDeleteDraftPostRequest', 'buildDeletePostRequest', 'buildUpdateBuildDraftPostRequest', 'publishDraftPost']),
  'blog/tag': Object.freeze(['buildCreateTagRequest']),
  'bookings/booking': Object.freeze(['buildCancelBookingRequest', 'buildConfirmBookingRequest', 'buildCreateBookingRequest']),
  'bookings/booking-form': Object.freeze(['buildCloneBookingFormRequest']),
  'bookings/calendar-event': Object.freeze(['buildCreateCalendarEventRequest', 'buildDeleteCalendarEventRequest']),
  'bookings/service': Object.freeze(['buildCreateBookingsServiceRequest', 'buildDeleteBookingsServiceRequest']),
  'bookings/service-add-on': Object.freeze(['buildCreateBookingsAddOnGroupRequest', 'buildCreateBookingsAddOnRequest', 'buildDeleteBookingsAddOnGroupRequest', 'buildDeleteBookingsAddOnRequest', 'buildSetBookingsAddOnGroupAddOnsRequest']),
  'cms/data-item': Object.freeze(['buildBulkSaveDataItemsRequest', 'buildInsertItemRequest', 'buildUpdateDataItemRequest']),
  'crm/contact': Object.freeze(['buildBulkUpsertContactsRequest', 'buildCreateContactRequest', 'buildUpdateBusinessContactRequest', 'buildUpdateContactRequest']),
  'crm/contact-label': Object.freeze(['buildUpdateContactTagsRequest']),
  'crm/email-subscription': Object.freeze(['buildBulkUpsertEmailSubscriptionsRequest']),
  'crm/label': Object.freeze(['buildFindOrCreateContactLabelRequest']),
  'events/category': Object.freeze(['buildCreateEventCategoryRequest']),
  'events/event': Object.freeze(['buildAssignEventToCategoriesRequest', 'buildCreateEventRequest']),
  'events/rsvp': Object.freeze(['buildCreateRsvpRequest']),
  'events/ticket-definition': Object.freeze(['buildCreateTicketDefinitionRequest']),
  'ecom/delivery-profile': Object.freeze(['buildAddDeliveryCarrierRequest', 'buildAddDeliveryRegionRequest', 'buildAddPickupLocationDeliveryRegionRequest', 'buildCreateDeliveryProfileRequest', 'buildRemoveDeliveryCarrierRequest', 'buildRemoveDeliveryRegionRequest', 'buildRemovePickupLocationDeliveryRegionRequest', 'buildUpdateDeliveryRegionRequest']),
  'ecom/discount-rule': Object.freeze(['buildCreateDiscountRuleRequest', 'buildDeleteDiscountRuleRequest']),
  'ecom/order': Object.freeze(['buildAddOrderPaymentRequest', 'buildCreateOrderRequest', 'buildImportOrderRequest', 'buildRefundOrderPaymentRequest', 'buildUpdateOrderExtendedFieldsRequest']),
  'ecom/order-merchant-note': Object.freeze(['buildAddOrderMerchantNotesRequest']),
  'ecom/pickup-location': Object.freeze(['buildCreatePickupLocationRequest', 'buildDeletePickupLocationRequest']),
  'ecom/shipping-option': Object.freeze(['buildCreateShippingOptionRequest', 'buildDeleteShippingOptionRequest', 'buildUpdateShippingOptionEstimateRequest']),
  'gift-cards/gift-card': Object.freeze(['buildCreateGiftCardRequest']),
  'gift-cards/gift-card-product': Object.freeze(['buildCreateGiftCardProductRequest', 'buildUpdateGiftCardProductRequest']),
  'forms/form': Object.freeze(['buildCreateFormRequest', 'buildUpdateFormSchemaRequest']),
  'forms/form-submission': Object.freeze(['buildCreateFormSubmissionRequest', 'buildUpdateAutomationStatusRequest', 'buildUpdateFormSpamFilterRequest']),
  'media/media-file': Object.freeze(['buildGenerateUploadUrlRequest', 'buildImportMediaRequest', 'buildImportPrivateDocumentRequest']),
  'members/member': Object.freeze(['buildCreateMemberRequest', 'buildUpdateMemberContactRequest', 'ensureMember']),
  'members/member-about': Object.freeze(['buildCreateMemberAboutRequest', 'buildUpdateMemberAboutRequest']),
  'pricing-plans/plan': Object.freeze(['buildArchivePlanRequest', 'buildCreatePlanRequest']),
  'seo/item-seo-tags': Object.freeze(['buildBulkSetItemSeoTagsRequest', 'setItemSeoTags']),
  'seo/seo-pattern': Object.freeze(['buildCreateSeoPatternRequest', 'buildSetSeoPatternRequest', 'ensureSeoPattern']),
  'seo/site-seo-tags': Object.freeze(['buildSetSiteSeoTagsRequest', 'setSiteSeoTags']),
  'pricing-plans/plan-order': Object.freeze(['buildCreateOfflinePlanOrderRequest', 'buildPausePlanOrderRequest']),
  'site/locale': Object.freeze(['buildUpdateBusinessRegionRequest', 'buildUpdateSiteLanguageRequest', 'buildUpdateSiteLocaleRequest']),
  'stores/back-in-stock-request': Object.freeze(['buildCreateBackInStockRequest', 'buildMarkBackInStockNotificationSentRequest']),
  'stores/brand': Object.freeze(['buildCreateStoresBrandRequest']),
  'stores/category': Object.freeze(['buildCreateStoresCategoryRequest']),
  'stores/category-membership': Object.freeze(['buildBulkAddItemToCategoriesRequest']),
  'stores/coupon': Object.freeze(['buildBulkCreateCouponsRequest', 'buildCreateCouponRequest', 'buildDeleteCouponRequest', 'buildUpdateCouponRequest']),
  'stores/inventory-item': Object.freeze(['buildBulkInventoryItemsRequest', 'buildCreateInventoryItemRequest']),
  'stores/product': Object.freeze(['buildBulkCreateStoresProductsRequest', 'buildCreateStoresProductRequest', 'buildDeleteStoresProductRequest', 'buildPatchStoresProductMediaRequest', 'buildPatchStoresProductRequest', 'buildPatchStoresProductTagsRequest', 'bulkAddItemToCategories']),
  'stores/product-customization': Object.freeze(['buildCreateStoresCustomizationRequest']),
  'stores/product-tag': Object.freeze(['buildCreateStoresProductTagRequest']),
  'stores/promotion': Object.freeze(['buildCreateStoresPromotionRequest']),
  'stores/review': Object.freeze(['buildBulkCreateReviewsRequest', 'buildModerateReviewRequest', 'buildSetStoresReviewReplyRequest']),
  'tax/manual-tax-mapping': Object.freeze(['buildCreateManualTaxMappingRequest', 'buildDeleteManualTaxMappingRequest']),
  'tax/tax-group': Object.freeze(['buildCreateTaxGroupRequest', 'buildDeleteTaxGroupRequest']),
  'tax/tax-region': Object.freeze(['buildCreateTaxRegionRequest', 'buildDeleteTaxRegionRequest']),
  'tax/tax-settings': Object.freeze(['buildUpsertTaxSettingsRequest']),
});

// Closed registry of request builders. Raw REST requests carry no authority.
const buildConvertToRicosRequest = (...args) => markRequest(_buildConvertToRicosRequest(...args), {"read": true});
const buildImportMediaRequest = (...args) => markRequest(_buildImportMediaRequest(...args), {"auxiliary": true, "entity": "media/media-file"});
const buildImportPrivateDocumentRequest = (...args) => markRequest(_buildImportPrivateDocumentRequest(...args), {"auxiliary": true, "entity": "media/media-file"});
const buildGenerateUploadUrlRequest = (...args) => markRequest(_buildGenerateUploadUrlRequest(...args), {"auxiliary": true, "entity": "media/media-file"});
const buildGenerateFileDownloadUrlRequest = (...args) => markRequest(_buildGenerateFileDownloadUrlRequest(...args), {"read": true});
const buildUpdateOrderExtendedFieldsRequest = (...args) => markRequest(_buildUpdateOrderExtendedFieldsRequest(...args), {"auxiliary": true, "entity": "ecom/order"});
const buildAddOrderMerchantNotesRequest = (...args) => markRequest(_buildAddOrderMerchantNotesRequest(...args), {"entity": "ecom/order-merchant-note"});
// The registry builders never take preservedTags: only the executors, which read the target first, supply them.
const buildBulkSetItemSeoTagsRequest = (itemType, entries, { preservedTags, ...options } = {}) => markRequest(_buildBulkSetItemSeoTagsRequest(itemType, entries, options), {"entity": "seo/item-seo-tags"});
const buildCreateSeoPatternRequest = ({ preservedTags, ...args } = {}) => markRequest(_buildCreateSeoPatternRequest(args), {"entity": "seo/seo-pattern"});
const buildSetSeoPatternRequest = ({ preservedTags, ...args } = {}) => markRequest(_buildSetSeoPatternRequest(args), {"entity": "seo/seo-pattern"});
const buildSetSiteSeoTagsRequest = ({ preservedTags, ...args } = {}) => markRequest(_buildSetSiteSeoTagsRequest(args), {"entity": "seo/site-seo-tags", "siteTags": true});
const buildGetOrderRequest = (...args) => markRequest(_buildGetOrderRequest(...args), {"read": true});
const buildCreateCategoryRequest = (...args) => markRequest(_buildCreateCategoryRequest(...args), {"entity": "blog/category"});
const buildCreateTagRequest = (...args) => markRequest(_buildCreateTagRequest(...args), {"entity": "blog/tag"});
const buildCreateDraftPostRequest = (...args) => markRequest(_buildCreateDraftPostRequest(...args), {"entity": "blog/post"});
const buildDeleteDraftPostRequest = (...args) => markRequest(_buildDeleteDraftPostRequest(...args), {"entity": "blog/post"});
const buildDeletePostRequest = (...args) => markRequest(_buildDeletePostRequest(...args), {"entity": "blog/post"});
const buildBulkCreateDraftPostsRequest = (...args) => markRequest(_buildBulkCreateDraftPostsRequest(...args), {"entity": "blog/post"});
const buildInsertItemRequest = (...args) => markRequest(_buildInsertItemRequest(...args), {"entity": "cms/data-item"});
const buildBulkSaveDataItemsRequest = (...args) => markRequest(_buildBulkSaveDataItemsRequest(...args), {"entity": "cms/data-item"});
const buildUpdateDataItemRequest = (...args) => markRequest(_buildUpdateDataItemRequest(...args), {"entity": "cms/data-item"});
const buildCreateStoresProductRequest = (...args) => markRequest(_buildCreateStoresProductRequest(...args), {"entity": "stores/product"});
const buildBulkCreateStoresProductsRequest = (...args) => markRequest(_buildBulkCreateStoresProductsRequest(...args), {"entity": "stores/product"});
const buildQueryStoresProductsRequest = (...args) => markRequest(_buildQueryStoresProductsRequest(...args), {"read": true});
const buildPatchStoresProductMediaRequest = (...args) => markRequest(_buildPatchStoresProductMediaRequest(...args), {entity: "stores/product", partial: true, productId: args[0].productId});
const buildGetStoresProductWithMediaRequest = (...args) => markRequest(_buildGetStoresProductWithMediaRequest(...args), {"read": true});
const buildGetStoresProductForVerificationRequest = (...args) => markRequest(_buildGetStoresProductForVerificationRequest(...args), {"read": true});
const buildPatchStoresProductTagsRequest = (...args) => markRequest(_buildPatchStoresProductTagsRequest(...args), {entity: "stores/product", partial: true, productId: args[0].productId});
const buildGetStoresProductRequest = (...args) => markRequest(_buildGetStoresProductRequest(...args), {"read": true});
const buildGetStoresProductBySlugRequest = (...args) => markRequest(_buildGetStoresProductBySlugRequest(...args), {"read": true});
const buildDeleteStoresProductRequest = (...args) => markRequest(_buildDeleteStoresProductRequest(...args), {"entity": "stores/product"});
const buildDeleteInstallSeededProductRequest = (...args) => markRequest(_buildDeleteInstallSeededProductRequest(...args), {"entity": "internal/buildDeleteInstallSeededProductRequest", "setupOperation": "clear-install-seeded-catalog"});
const buildDeleteInstallSeededCategoryRequest = (...args) => markRequest(_buildDeleteInstallSeededCategoryRequest(...args), {"entity": "internal/buildDeleteInstallSeededCategoryRequest", "setupOperation": "clear-install-seeded-catalog"});
const buildGetAllProductsCategoryRequest = (...args) => markRequest(_buildGetAllProductsCategoryRequest(...args), {"read": true});
const buildPatchStoresProductRequest = (...args) => markRequest(_buildPatchStoresProductRequest(...args), {entity: "stores/product", partial: true, productId: args[0].productId});
const buildQueryStoresCategoriesRequest = (...args) => markRequest(_buildQueryStoresCategoriesRequest(...args), {"read": true});
const buildCreateStoresCategoryRequest = (...args) => markRequest(_buildCreateStoresCategoryRequest(...args), {"entity": "stores/category"});
const buildBulkAddItemToCategoriesRequest = (...args) => markRequest(_buildBulkAddItemToCategoriesRequest(...args), {entity: 'stores/category-membership', productMembership: true, auxiliary: true});
const buildCreateContactRequest = (...args) => markRequest(_buildCreateContactRequest(...args), {"entity": "crm/contact"});
const buildBulkUpsertContactsRequest = (...args) => markRequest(_buildBulkUpsertContactsRequest(...args), {"entity": "crm/contact"});
const buildQueryContactsRequest = (...args) => markRequest(_buildQueryContactsRequest(...args), {"read": true});
const buildGetContactRequest = (...args) => markRequest(_buildGetContactRequest(...args), {"read": true});
const buildUpdateContactRequest = (...args) => markRequest(_buildUpdateContactRequest(...args), {"entity": "crm/contact"});
// The member's own contact (Members v1 Create Member drops some contact fields, e.g. an address's
// first line), updated inside the member task: the Contacts V5 update, marked as an auxiliary
// members/member write. Transport admits it only for the contact of this record's own member.
const buildUpdateMemberContactRequest = (...args) => markRequest(_buildUpdateContactRequest(...args), { entity: 'members/member', auxiliary: true, memberContact: true });
const buildBulkUpsertEmailSubscriptionsRequest = (...args) => markRequest(_buildBulkUpsertEmailSubscriptionsRequest(...args), {"entity": "crm/email-subscription"});
const buildFindOrCreateContactLabelRequest = (...args) => markRequest(_buildFindOrCreateContactLabelRequest(...args), {"entity": "crm/label"});
const buildGetContactLabelRequest = (...args) => markRequest(_buildGetContactLabelRequest(...args), {"read": true});
const buildUpdateContactTagsRequest = (...args) => markRequest(_buildUpdateContactTagsRequest(...args), {"entity": "crm/contact-label"});
const buildGetContactTagsRequest = (...args) => markRequest(_buildGetContactTagsRequest(...args), {"read": true});
const buildCreateMemberAboutRequest = (...args) => markRequest(_buildCreateMemberAboutRequest(...args), {"entity": "members/member-about"});
const buildUpdateMemberAboutRequest = (...args) => markRequest(_buildUpdateMemberAboutRequest(...args), {"entity": "members/member-about"});
const buildQueryMemberAboutsRequest = (...args) => markRequest(_buildQueryMemberAboutsRequest(...args), {"read": true});
const buildGetMemberAboutRequest = (...args) => markRequest(_buildGetMemberAboutRequest(...args), {"read": true});
const buildCreateCouponRequest = (...args) => markRequest(_buildCreateCouponRequest(...args), {"entity": "stores/coupon"});
const buildBulkCreateCouponsRequest = (...args) => markRequest(_buildBulkCreateCouponsRequest(...args), {"entity": "stores/coupon"});
const buildUpdateCouponRequest = (...args) => markRequest(_buildUpdateCouponRequest(...args), {"entity": "stores/coupon"});
const buildGetCouponRequest = (...args) => markRequest(_buildGetCouponRequest(...args), {"read": true});
const buildQueryCouponsRequest = (...args) => markRequest(_buildQueryCouponsRequest(...args), {"read": true});
const buildCreateDiscountRuleRequest = (...args) => markRequest(_buildCreateDiscountRuleRequest(...args), {"entity": "ecom/discount-rule"});
const buildQueryDiscountRulesRequest = (...args) => markRequest(_buildQueryDiscountRulesRequest(...args), {"read": true});
const buildDeleteDiscountRuleRequest = (...args) => markRequest(_buildDeleteDiscountRuleRequest(...args), {"entity": "ecom/discount-rule"});
const buildCreateTaxGroupRequest = (...args) => markRequest(_buildCreateTaxGroupRequest(...args), {"entity": "tax/tax-group"});
const buildQueryTaxGroupsRequest = (...args) => markRequest(_buildQueryTaxGroupsRequest(...args), {"read": true});
const buildListDefaultTaxGroupsRequest = (...args) => markRequest(_buildListDefaultTaxGroupsRequest(...args), {"read": true});
const buildDeleteTaxGroupRequest = (...args) => markRequest(_buildDeleteTaxGroupRequest(...args), {"entity": "tax/tax-group"});
const buildListTaxCalculatorsRequest = (...args) => markRequest(_buildListTaxCalculatorsRequest(...args), {"read": true});
const buildCreateTaxRegionRequest = (...args) => markRequest(_buildCreateTaxRegionRequest(...args), {"entity": "tax/tax-region"});
const buildQueryTaxRegionsRequest = (...args) => markRequest(_buildQueryTaxRegionsRequest(...args), {"read": true});
const buildDeleteTaxRegionRequest = (...args) => markRequest(_buildDeleteTaxRegionRequest(...args), {"entity": "tax/tax-region"});
const buildCreateManualTaxMappingRequest = (...args) => markRequest(_buildCreateManualTaxMappingRequest(...args), {"entity": "tax/manual-tax-mapping"});
const buildQueryManualTaxMappingsRequest = (...args) => markRequest(_buildQueryManualTaxMappingsRequest(...args), {"read": true});
const buildDeleteManualTaxMappingRequest = (...args) => markRequest(_buildDeleteManualTaxMappingRequest(...args), {"entity": "tax/manual-tax-mapping"});
const buildGetTaxSettingsRequest = (...args) => markRequest(_buildGetTaxSettingsRequest(...args), {"read": true});
const buildUpsertTaxSettingsRequest = (...args) => markRequest(_buildUpsertTaxSettingsRequest(...args), {"entity": "tax/tax-settings"});
const buildCreateDeliveryProfileRequest = (...args) => markRequest(_buildCreateDeliveryProfileRequest(...args), {"entity": "ecom/delivery-profile"});
const buildGetDeliveryProfileRequest = (...args) => markRequest(_buildGetDeliveryProfileRequest(...args), {"read": true});
const buildQueryDeliveryProfilesRequest = (...args) => markRequest(_buildQueryDeliveryProfilesRequest(...args), {"read": true});
const buildAddDeliveryRegionRequest = (...args) => markRequest(_buildAddDeliveryRegionRequest(...args), {"entity": "ecom/delivery-profile"});
const buildRemoveDeliveryRegionRequest = (...args) => markRequest(_buildRemoveDeliveryRegionRequest(...args), {"entity": "ecom/delivery-profile"});
const buildUpdateDeliveryRegionRequest = (...args) => markRequest(_buildUpdateDeliveryRegionRequest(...args), {"entity": "ecom/delivery-profile"});
const buildAddDeliveryCarrierRequest = (...args) => markRequest(_buildAddDeliveryCarrierRequest(...args), {"entity": "ecom/delivery-profile"});
const buildRemoveDeliveryCarrierRequest = (...args) => markRequest(_buildRemoveDeliveryCarrierRequest(...args), {"entity": "ecom/delivery-profile"});
const buildListInstalledDeliveryCarriersRequest = (...args) => markRequest(_buildListInstalledDeliveryCarriersRequest(...args), {"read": true});
const buildCreateShippingOptionRequest = (...args) => markRequest(_buildCreateShippingOptionRequest(...args), {"entity": "ecom/shipping-option"});
const buildQueryShippingOptionsRequest = (...args) => markRequest(_buildQueryShippingOptionsRequest(...args), {"read": true});
const buildGetShippingOptionRequest = (...args) => markRequest(_buildGetShippingOptionRequest(...args), {"read": true});
const buildUpdateShippingOptionEstimateRequest = (...args) => markRequest(_buildUpdateShippingOptionEstimateRequest(...args), {"entity": "ecom/shipping-option"});
const buildDeleteShippingOptionRequest = (...args) => markRequest(_buildDeleteShippingOptionRequest(...args), {"entity": "ecom/shipping-option"});
const buildUpdateBusinessContactRequest = (...args) => markRequest(_buildUpdateBusinessContactRequest(...args), {"entity": "crm/contact"});
const buildGetSitePropertiesRequest = (...args) => markRequest(_buildGetSitePropertiesRequest(...args), {"read": true});
const buildUpdateBusinessRegionRequest = (...args) => markRequest(_buildUpdateBusinessRegionRequest(...args), {"entity": "site/locale"});
const buildUpdateSiteLanguageRequest = (...args) => markRequest(_buildUpdateSiteLanguageRequest(...args), {"entity": "site/locale"});
const buildUpdateSiteLocaleRequest = (...args) => markRequest(_buildUpdateSiteLocaleRequest(...args), {"entity": "site/locale"});
const buildCreatePickupLocationRequest = (...args) => markRequest(_buildCreatePickupLocationRequest(...args), {"entity": "ecom/pickup-location"});
const buildGetPickupLocationRequest = (...args) => markRequest(_buildGetPickupLocationRequest(...args), {"read": true});
const buildQueryPickupLocationsRequest = (...args) => markRequest(_buildQueryPickupLocationsRequest(...args), {"read": true});
const buildDeletePickupLocationRequest = (...args) => markRequest(_buildDeletePickupLocationRequest(...args), {"entity": "ecom/pickup-location"});
const buildAddPickupLocationDeliveryRegionRequest = (...args) => markRequest(_buildAddPickupLocationDeliveryRegionRequest(...args), {"entity": "ecom/delivery-profile"});
const buildRemovePickupLocationDeliveryRegionRequest = (...args) => markRequest(_buildRemovePickupLocationDeliveryRegionRequest(...args), {"entity": "ecom/delivery-profile"});
const buildCreateOrderRequest = (...args) => markRequest(_buildCreateOrderRequest(...args), {"entity": "ecom/order"});
const buildQueryOrdersRequest = (...args) => markRequest(_buildQueryOrdersRequest(...args), {"read": true});
const buildImportOrderRequest = (...args) => markRequest(_buildImportOrderRequest(...args), {"entity": "ecom/order"});
const buildListOrderTransactionsRequest = (...args) => markRequest(_buildListOrderTransactionsRequest(...args), {"read": true});
const buildAddOrderPaymentRequest = (...args) => markRequest(_buildAddOrderPaymentRequest(...args), {"auxiliary": true, "entity": "ecom/order"});
const buildRefundOrderPaymentRequest = (...args) => markRequest(_buildRefundOrderPaymentRequest(...args), {"auxiliary": true, "entity": "ecom/order"});
const buildCreateInventoryItemRequest = (...args) => markRequest(_buildCreateInventoryItemRequest(...args), {"entity": "stores/inventory-item"});
const buildQueryCouponsByCodeRequest = (...args) => markRequest(_buildQueryCouponsByCodeRequest(...args), {"read": true});
const buildDeleteCouponRequest = (...args) => markRequest(_buildDeleteCouponRequest(...args), {"entity": "stores/coupon"});
const buildCreatePlanRequest = (...args) => markRequest(_buildCreatePlanRequest(...args), {"entity": "pricing-plans/plan"});
const buildQueryPlansByNameRequest = (...args) => markRequest(_buildQueryPlansByNameRequest(...args), {"read": true});
const buildArchivePlanRequest = (...args) => markRequest(_buildArchivePlanRequest(...args), {"entity": "pricing-plans/plan"});
const buildGetPlanRequest = (...args) => markRequest(_buildGetPlanRequest(...args), {"read": true});
const buildCreateOfflinePlanOrderRequest = (...args) => markRequest(_buildCreateOfflinePlanOrderRequest(...args), {"entity": "pricing-plans/plan-order"});
const buildPausePlanOrderRequest = (orderId) => markRequest(_buildPausePlanOrderRequest(orderId), {"auxiliary": true, "entity": "pricing-plans/plan-order", "planOrderId": String(orderId)});
const buildListPlanOrdersRequest = (...args) => markRequest(_buildListPlanOrdersRequest(...args), {"read": true});
const buildGetPlanOrderRequest = (...args) => markRequest(_buildGetPlanOrderRequest(...args), {"read": true});
const buildCreateMemberRequest = (...args) => markRequest(_buildCreateMemberRequest(...args), {"entity": "members/member"});
const buildGetMemberRequest = (...args) => markRequest(_buildGetMemberRequest(...args), {"read": true});
const buildQueryMembersByLoginEmailRequest = (...args) => markRequest(_buildQueryMembersByLoginEmailRequest(...args), {"read": true});
const buildQueryContactsByPhoneRequest = (...args) => markRequest(_buildQueryContactsByPhoneRequest(...args), {"read": true});
const buildMuteSiteNotificationsRequest = (...args) => markRequest(_buildMuteSiteNotificationsRequest(...args), {"entity": "internal/buildMuteSiteNotificationsRequest", "setupOperation": "mute-site-notifications"});
const buildUnmuteSiteNotificationsRequest = (...args) => markRequest(_buildUnmuteSiteNotificationsRequest(...args), {"entity": "internal/buildUnmuteSiteNotificationsRequest"});
const buildGetSiteMuteStateRequest = (...args) => markRequest(_buildGetSiteMuteStateRequest(...args), {"read": true});
const buildInstallWixAppRequest = (...args) => markRequest(_buildInstallWixAppRequest(...args), {"entity": "internal/buildInstallWixAppRequest", "setupOperation": "install-app"});
const buildInstallEditorAppsRequest = (...args) => markRequest(_buildInstallEditorAppsRequest(...args), {"entity": "internal/buildInstallEditorAppsRequest", "setupOperation": "install-app"});
const buildGetEditorUrlsRequest = (...args) => markRequest(_buildGetEditorUrlsRequest(...args), {"read": true});
const buildGetInstalledWixAppsRequest = (...args) => markRequest(_buildGetInstalledWixAppsRequest(...args), {"read": true});
const buildCloneBookingFormRequest = (...args) => markRequest(_buildCloneBookingFormRequest(...args), {"entity": "bookings/booking-form"});
const buildQueryBookingsResourcesRequest = (...args) => markRequest(_buildQueryBookingsResourcesRequest(...args), {"read": true});
const buildCreateBookingsServiceRequest = (...args) => markRequest(_buildCreateBookingsServiceRequest(...args), {"entity": "bookings/service"});
const buildQueryBookingsServicesRequest = (...args) => markRequest(_buildQueryBookingsServicesRequest(...args), {"read": true});
const buildDeleteBookingsServiceRequest = (...args) => markRequest(_buildDeleteBookingsServiceRequest(...args), {"entity": "bookings/service"});
const buildCreateEventCategoryRequest = (...args) => markRequest(_buildCreateEventCategoryRequest(...args), {"entity": "events/category"});
const buildQueryEventCategoriesRequest = (...args) => markRequest(_buildQueryEventCategoriesRequest(...args), {"read": true});
const buildCreateEventRequest = (...args) => markRequest(_buildCreateEventRequest(...args), {"entity": "events/event"});
const buildGetEventRequest = (...args) => markRequest(_buildGetEventRequest(...args), {"read": true});
const buildQueryEventsRequest = (...args) => markRequest(_buildQueryEventsRequest(...args), {"read": true});
const buildAssignEventToCategoriesRequest = (...args) => markRequest(_buildAssignEventToCategoriesRequest(...args), {"entity": "events/event", "auxiliary": true, "eventCategoryMembership": true});
const buildListEventCategoriesRequest = (...args) => markRequest(_buildListEventCategoriesRequest(...args), {"read": true});
const buildCreateTicketDefinitionRequest = (...args) => markRequest(_buildCreateTicketDefinitionRequest(...args), {"entity": "events/ticket-definition"});
const buildGetTicketDefinitionRequest = (...args) => markRequest(_buildGetTicketDefinitionRequest(...args), {"read": true});
const buildQueryTicketDefinitionsRequest = (...args) => markRequest(_buildQueryTicketDefinitionsRequest(...args), {"read": true});
const buildCreateRsvpRequest = (...args) => markRequest(_buildCreateRsvpRequest(...args), {"entity": "events/rsvp"});
const buildGetRsvpRequest = (...args) => markRequest(_buildGetRsvpRequest(...args), {"read": true});
const buildQueryRsvpsRequest = (...args) => markRequest(_buildQueryRsvpsRequest(...args), {"read": true});
const buildCreateCalendarEventRequest = (...args) => markRequest(_buildCreateCalendarEventRequest(...args), {"entity": "bookings/calendar-event"});
const buildDeleteCalendarEventRequest = (...args) => markRequest(_buildDeleteCalendarEventRequest(...args), {"entity": "bookings/calendar-event"});
const buildCreateGiftCardRequest = (...args) => markRequest(_buildCreateGiftCardRequest(...args), {"entity": "gift-cards/gift-card"});
const buildQueryGiftCardsByCodeRequest = (...args) => markRequest(_buildQueryGiftCardsByCodeRequest(...args), {"read": true});
const buildCreateGiftCardProductRequest = (...args) => markRequest(_buildCreateGiftCardProductRequest(...args), {"entity": "gift-cards/gift-card-product"});
const buildUpdateGiftCardProductRequest = (...args) => markRequest(_buildUpdateGiftCardProductRequest(...args), {"entity": "gift-cards/gift-card-product"});
const buildQueryGiftCardProductsRequest = (...args) => markRequest(_buildQueryGiftCardProductsRequest(...args), {"read": true});
const buildGetGiftCardProductRequest = (...args) => markRequest(_buildGetGiftCardProductRequest(...args), {"read": true});
const buildCreateBookingsAddOnRequest = (...args) => markRequest(_buildCreateBookingsAddOnRequest(...args), {"entity": "bookings/service-add-on", "partial": true});
const buildGetBookingsAddOnRequest = (...args) => markRequest(_buildGetBookingsAddOnRequest(...args), {"read": true});
const buildQueryBookingsAddOnsRequest = (...args) => markRequest(_buildQueryBookingsAddOnsRequest(...args), {"read": true});
const buildDeleteBookingsAddOnRequest = (...args) => markRequest(_buildDeleteBookingsAddOnRequest(...args), {"entity": "bookings/service-add-on"});
const buildCreateBookingsAddOnGroupRequest = (...args) => markRequest(_buildCreateBookingsAddOnGroupRequest(...args), {"entity": "bookings/service-add-on", "auxiliary": true, "addOnGroup": true});
const buildSetBookingsAddOnGroupAddOnsRequest = (...args) => markRequest(_buildSetBookingsAddOnGroupAddOnsRequest(...args), {"entity": "bookings/service-add-on", "auxiliary": true, "addOnGroup": true});
const buildListBookingsAddOnGroupsRequest = (...args) => markRequest(_buildListBookingsAddOnGroupsRequest(...args), {"read": true});
const buildDeleteBookingsAddOnGroupRequest = (...args) => markRequest(_buildDeleteBookingsAddOnGroupRequest(...args), {"entity": "bookings/service-add-on"});
const buildCreateBookingRequest = (...args) => markRequest(_buildCreateBookingRequest(...args), {"entity": "bookings/booking"});
const buildConfirmBookingRequest = (...args) => markRequest(_buildConfirmBookingRequest(...args), {"entity": "bookings/booking", "auxiliary": true, "bookingFollowUp": true});
const buildCancelBookingRequest = (...args) => markRequest(_buildCancelBookingRequest(...args), {"entity": "bookings/booking", "auxiliary": true, "bookingFollowUp": true});
const buildQueryBookingsRequest = (...args) => markRequest(_buildQueryBookingsRequest(...args), {"read": true});
const buildCreateFormRequest = (...args) => markRequest(_buildCreateFormRequest(...args), {"entity": "forms/form"});
const buildQueryFormsRequest = (...args) => markRequest(_buildQueryFormsRequest(...args), {"read": true});
const buildCreateFormSubmissionRequest = (...args) => markRequest(_buildCreateFormSubmissionRequest(...args), {"entity": "forms/form-submission"});
const buildGetFormSubmissionRequest = (...args) => markRequest(_buildGetFormSubmissionRequest(...args), {"read": true});
const buildQueryFormSpamReportsRequest = (...args) => markRequest(_buildQueryFormSpamReportsRequest(...args), {"read": true});
const buildQueryFormSubmissionsRequest = (...args) => markRequest(_buildQueryFormSubmissionsRequest(...args), {"read": true});
const buildQueryAutomationsRequest = (...args) => markRequest(_buildQueryAutomationsRequest(...args), {"read": true});
const buildGetAutomationRequest = (...args) => markRequest(_buildGetAutomationRequest(...args), {"read": true});
// Pausing the form's automations is part of importing its entries, under the entries' task and grant.
const buildUpdateAutomationStatusRequest = (...args) => markRequest(_buildUpdateAutomationStatusRequest(...args), {"auxiliary": true, "entity": "forms/form-submission"});
const buildGetFormRequest = (...args) => markRequest(_buildGetFormRequest(...args), {"read": true});
const buildUpdateFormSchemaRequest = (...args) => markRequest(_buildUpdateFormSchemaRequest(...args), {"entity": "forms/form"});
const buildUpdateFormSpamFilterRequest = (...args) => markRequest(_buildUpdateFormSpamFilterRequest(...args), {"auxiliary": true, "entity": "forms/form-submission"});

function withReadinessGrant(request, { readinessGrant, sourceStableKey }) {
  const marked = requestMark(request), copy = { ...request, readinessGrant, sourceStableKey };
  return marked ? markRequest(copy, marked) : copy;
}
// One source key per bulk item (sourceStableKeys[i] <-> the request's i-th item): one record's
// grant never covers the rest of the batch.
function withBulkReadinessGrant(request, { readinessGrant, sourceStableKeys }) {
  if (request.sourceStableKey !== undefined || !Array.isArray(sourceStableKeys)) throw new Error('withBulkReadinessGrant: sourceStableKeys[] is required and excludes sourceStableKey');
  const marked = requestMark(request), copy = { ...request, readinessGrant, sourceStableKeys: [...sourceStableKeys] };
  return marked ? markRequest(copy, marked) : copy;
}
const recordClients = new WeakMap();
function bindRecordClient(wix, { readinessGrant, sourceStableKey }) {
  const ctx = executionCapability.clientContext(wix);
  if (!ctx || ctx.kind !== 'import-task' || !require('../../../lib/dependency-readiness').verifyGrant(readinessGrant, ctx, sourceStableKey)) executionCapability.fail('DEPENDENCY_READINESS_REQUIRED');
  const recordClient = Object.freeze({ dryRun: wix.dryRun === true, send: request => wix.send(withReadinessGrant(request, { readinessGrant, sourceStableKey })) });
  recordClients.set(recordClient, { wix, readinessGrant, sourceStableKey });
  return recordClient;
}
// A landed record's recorded loss, from a toolkit composite holding only the record client: the
// gap is filed under the client's own task and the record client's own source key, never another.
// Returns false (nothing filed) for a client that is not an import-task record client.
async function recordWrittenGap(recordClient, { code, action, detail = {}, operatorRole, severity }) {
  const bound = recordClients.get(recordClient);
  if (!bound || executionCapability.clientContext(bound.wix)?.kind !== 'import-task') return false;
  await require('../../../lib/dependency-readiness').recordClientTaskGap({ wixClient: bound.wix, sourceStableKey: bound.sourceStableKey, code, action, detail, operatorRole, severity });
  return true;
}
function validReadBackEvidence(result, { siteId, targetId }) {
  const evidence = result && responseEvidence.get(result);
  if (!evidence?.mark?.read || evidence.siteId !== siteId || evidence.digest !== executionCapability.digest(JSON.stringify(result))) return false;
  const entity = result.product || result.contact || result.order || result.member || result;
  return entity.id === targetId || entity._id === targetId;
}
function captureSetupReferenceBindings(wix, step) {
  const ctx = executionCapability.clientContext(wix);
  if (ctx?.kind !== 'setup-step' || ctx.stepId !== step.id) executionCapability.fail('SETUP_WRITE_OUT_OF_STEP');
  if (!require('../../../lib/setup-verification').validatePlanShape({schemaVersion:1,steps:[step]},ctx.projectDir).ok) executionCapability.fail('SETUP_PLAN_INVALID');
  const reads = (clientReadResponses.get(wix) || []).filter(value => responseEvidence.get(value)?.digest === executionCapability.digest(JSON.stringify(value))), bindings = [];
  for (const declaration of step.referenceKeys || []) {
    const values = {}, candidates = [];
    for (const response of reads) {
      if (declaration.readBack) {
        const L=require('../../../lib/source-location'), ids=L.valuesAt(response,declaration.readBack.identityPath);
        const mapped=Object.fromEntries(Object.entries(declaration.readBack.values).map(([key,p])=>[key,L.valuesAt(response,p)]));
        if (ids.length===1 && typeof ids[0]==='string' && ids[0] && Object.values(mapped).every(v=>v.length===1 && typeof v[0]==='string' && v[0])) candidates.push({targetId:ids[0],values:Object.fromEntries(Object.entries(mapped).map(([key,v])=>[key,v[0]]))});
        continue;
      }
      if (declaration.ref === 'ecom/shipping-option' && response.shippingOption?.id) candidates.push({ targetId: response.shippingOption.id, values: { 'shippingInfo.code': response.shippingOption.id } });
      if (declaration.ref === 'tax/tax-group') for (const group of response.taxGroups || (response.taxGroup ? [response.taxGroup] : [])) candidates.push({ targetId: group.id, values: Object.fromEntries(declaration.paths.map(key => [key, group.id])) });
      if (declaration.ref === 'ecom/delivery-profile' && response.deliveryProfile?.id) for (const region of response.deliveryProfile.deliveryRegions || response.deliveryProfile.regions || []) for (const carrier of region.deliveryCarriers || region.carriers || []) if (carrier.appId) candidates.push({ targetId: response.deliveryProfile.id, values: { 'shippingInfo.carrierId': carrier.appId } });
    }
    const distinct = [...new Map(candidates.map(row => [JSON.stringify(row), row])).values()];
    if (distinct.length !== 1) throw new Error('setup_reference_readback_missing_or_ambiguous');
    for (const key of declaration.paths) values[key] = distinct[0].values[key];
    bindings.push({ ref: declaration.ref, sourceStableKey: declaration.sourceStableKey, targetId: distinct[0].targetId, values });
  }
  const errors = require('../../../lib/setup-verification').validateReferenceBindings(step, bindings, ctx.projectDir);
  if (errors.length) throw new Error(errors.join(';'));
  return bindings;
}
const inventoryEvidence = new WeakMap();
function registerQuickInventoryScope(wix, canonical, target) {
  const ctx = executionCapability.clientContext(wix), evidence = responseEvidence.get(target);
  if (!ctx || ctx.kind !== 'quick-entity' || ctx.adapterId !== 'quick-shopify' || ctx.entityId !== 'product' || evidence?.client !== wix || !evidence.mark?.read || evidence.digest !== executionCapability.digest(JSON.stringify(target)) || !canonical.slug || canonical.slug !== target.slug) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  const rows = require('./variant-correlation').resolveInventoryRows(canonical, target);
  let scope = inventoryEvidence.get(wix);
  if (!scope) { scope = { pairs: new Map(), items: new Map(), locations: new Set() }; inventoryEvidence.set(wix, scope); }
  for (const row of rows) scope.pairs.set(row.productId + ':' + row.variantId, Object.freeze({ ...row, inventory: Object.freeze({ ...row.inventory }) }));
  return rows;
}
const importInventoryEvidence = new WeakMap();
function recordInventoryResponse(wix, json, mark, request) {
  const ctx = executionCapability.clientContext(wix);
  if (ctx?.kind === 'import-task') {
    const scope = importInventoryEvidence.get(wix)?.get(request.sourceStableKey);
    if (!scope) return;
    if (mark?.inventoryRead === 'locations' && json.storesLocations?.length === 1) {
      const row = json.storesLocations[0];
      if (row.id && (mark.locationId ? row.id === mark.locationId : mark.defaultLocation && row.defaultLocation === true)) scope.locations.add(row.id);
    }
    if (mark?.inventoryRead === 'items') for (const item of json.inventoryItems || []) if (scope.pairs.has(item.productId + ':' + item.variantId) && scope.locations.has(item.locationId) && item.id && item.revision != null) scope.items.set(item.id, structuredClone(item));
    return;
  }
  if (ctx?.kind !== 'quick-entity' || ctx.adapterId !== 'quick-shopify' || ctx.entityId !== 'product') return;
  let scope = inventoryEvidence.get(wix);
  if (!scope) { scope = { pairs: new Map(), items: new Map(), locations: new Set() }; inventoryEvidence.set(wix, scope); }
  if (mark?.inventoryRead === 'locations' && mark.defaultLocation === true && json.storesLocations?.length === 1) {
    const row = json.storesLocations[0]; if (row.id && row.defaultLocation === true) scope.locations.add(row.id);
  }
  if (mark?.inventoryRead === 'items') for (const item of json.inventoryItems || []) {
    if (scope.pairs.has(item.productId + ':' + item.variantId) && scope.locations.has(item.locationId) && item.id && item.revision != null) scope.items.set(item.id, { ...item });
  }
}
function validateQuickInventoryWrite(wix, request, mark) {
  const scope = inventoryEvidence.get(wix), rows = request.body?.inventoryItems;
  if (!scope || !['create', 'update'].includes(mark.inventoryOperation) || !Array.isArray(rows) || !rows.length) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  for (const raw of rows) {
    const item = mark.inventoryOperation === 'update' ? raw.inventoryItem : raw;
    if (!item || Object.hasOwn(item, 'quantity') || Object.hasOwn(item, 'preorderInfo') || Object.hasOwn(item, 'trackQuantity') || typeof item.inStock !== 'boolean') executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
    let pair;
    if (mark.inventoryOperation === 'update') {
      const known = scope.items.get(item.id);
      if (!known || known.revision !== item.revision || Object.keys(item).some(key => !['id', 'revision', 'inStock'].includes(key))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
      pair = { ...known };
    } else pair = item;
    if (!scope.locations.has(pair.locationId) || !scope.pairs.has(pair.productId + ':' + pair.variantId) || scope.pairs.get(pair.productId + ':' + pair.variantId).inventory.inStock !== item.inStock) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  }
}
// Whether this record's own responses (its create, or a read it made) or its crosswalk row name
// `targetId` as the record's own add-on or booking.
const OWN_TARGET_IDS = {
  'bookings/service-add-on': value => [value.addOn?.id, ...(value.addOns || []).map(row => row?.id)],
  'bookings/booking': value => [value.booking?.id, ...(value.extendedBookings || []).map(row => row?.booking?.id)],
};
function recordSawTarget(wix, request, entity, targetId) {
  const ctx = executionCapability.clientContext(wix);
  if (!ctx || typeof targetId !== 'string' || !targetId) return false;
  const seen = (clientReadResponses.get(wix) || []).some(value => {
    const proof = responseEvidence.get(value);
    return proof && proof.request.sourceStableKey === request.sourceStableKey && proof.request.readinessGrant === request.readinessGrant && (proof.mark?.read || proof.mark?.entity === entity) &&
      proof.digest === executionCapability.digest(JSON.stringify(value)) && OWN_TARGET_IDS[entity](value).includes(targetId);
  });
  return seen || require('../../../lib/dependency-readiness').currentRecordTargetId(request.readinessGrant, ctx, request.sourceStableKey) === targetId;
}
// The member this record owns: one its own Create Member returned, or its current landed target.
// The contact id must be that member's contactId in one of this record's own member responses.
function recordMemberContactMatches(wix, request, contactId) {
  const ctx = executionCapability.clientContext(wix);
  if (!ctx || typeof contactId !== 'string' || !contactId) return false;
  const own = value => { const proof = responseEvidence.get(value); return proof && proof.request.sourceStableKey === request.sourceStableKey && proof.request.readinessGrant === request.readinessGrant && proof.digest === executionCapability.digest(JSON.stringify(value)) ? proof : null; };
  const responses = (clientReadResponses.get(wix) || []).filter(own);
  const owned = new Set(responses.filter(value => { const mark = own(value).mark; return mark?.entity === 'members/member' && !mark.read && !mark.auxiliary; }).map(value => value.member?.id).filter(Boolean));
  const current = require('../../../lib/dependency-readiness').currentRecordTargetId(request.readinessGrant, ctx, request.sourceStableKey);
  if (current) owned.add(current);
  return responses.some(value => value.member && owned.has(value.member.id) && value.member.contactId === contactId && /^(?:https:\/\/www\.wixapis\.com)?\/members\/v1\/members(?:[/?]|$)/.test(String(own(value).request.url)));
}
function recordProductMatches(wix, request, targetId, entity = 'stores/product') {
  const ctx = executionCapability.clientContext(wix);
  if (!ctx || !targetId) return false;
  const previous = (clientReadResponses.get(wix) || []).some(value => {
    const proof = responseEvidence.get(value);
    if (!proof || proof.request.sourceStableKey !== request.sourceStableKey || proof.digest !== executionCapability.digest(JSON.stringify(value))) return false;
    if (proof.mark?.entity === entity && !proof.mark.read) {
      // A product this record created through the bulk create (products-with-inventory): the
      // response names it only in productResults.results[].itemMetadata (no product.id), and only
      // a confirmed item counts. The flat `results` envelope is not this endpoint's shape.
      const bulk = entity === 'stores/product' ? value.productResults?.results : undefined;
      if (Array.isArray(bulk)) return bulk.some(row => row?.itemMetadata?.id === targetId && row.itemMetadata.success === true);
      return (value.product?.id || value.event?.id || value.id) === targetId;
    }
    // An event adopted after a lost create (adoptPublishedEvent): this record's own Get Event of it.
    return entity === 'events/event' && proof.mark?.read === true && String(proof.request.method).toUpperCase() === 'GET' &&
      new URL(proof.request.url).pathname === `/events/v3/events/${encodeURIComponent(targetId)}` && value.event?.id === targetId;
  });
  if (!previous && entity === 'stores/product' && adoptedProductTargets.get(wix)?.get(request.sourceStableKey) === targetId) return true;
  return previous || require('../../../lib/dependency-readiness').currentRecordTargetId(request.readinessGrant, ctx, request.sourceStableKey) === targetId;
}
// LIVE-FOUND: a product this record's own earlier create left on the site, which its marker cannot
// match (a source with an empty slug created before the builder minted one: Wix generated a slug,
// so verification reports an identity conflict on every resume and the product is never verified).
// The saved write-verification row is the join: it names this target for this key and site, nothing
// else claims it (no crosswalk row, no other state row, not a pre-import catalog product), it was
// never verified, and the product read back on this record's own client is unedited since that
// create (revision 1). Only then may this record's own writes name it (a slug PATCH so the marker
// agrees); importProducts then reconciles and verifies it as usual. It never creates a product.
// Returns the product, or null when it may not be adopted.
const adoptedProductTargets = new WeakMap();
async function admitSavedProductTarget(recordClient, { projectDir, siteId, expectedName }) {
  const record = recordClients.get(recordClient);
  const ctx = record && executionCapability.clientContext(record.wix);
  if (!ctx || ctx.kind !== 'import-task' || !ctx.task.entityRefs.includes('stores/product') || !projectDir || !siteId || siteId !== ctx.siteId) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  const key = record.sourceStableKey;
  const state = await require('../../../lib/write-verification-state').load(projectDir, siteId);
  const saved = state.rows[key], productId = saved?.targetId;
  if (typeof expectedName !== 'string' || !expectedName || !productId || !saved.identityConflict || saved.receipt || saved.lastVerifiedReceipt) return null;
  if (Object.entries(state.rows).some(([other, row]) => other !== key && row?.targetId === productId)) return null;
  if (require('../../../lib/catalog-baseline').protectedIds(projectDir).products.has(productId)) return null;
  const crosswalk = await require('../../../lib/local-state').loadCrosswalk(projectDir);
  if (crosswalk.bySource[key] || crosswalk.rows.some(row => row.targetSystem === 'wix' && row.targetId === productId)) return null;
  // A saved target that is gone (404) is simply not adoptable; any other error propagates.
  let product;
  try { product = await getStoresProduct(recordClient, productId); }
  catch (error) { if (error?.status === 404 && error.outcomeKnown !== false) return null; throw error; }
  // The name check comes before the authorization below: a different product is never admitted.
  if (product?.id !== productId || String(product.revision) !== '1' || product.name !== expectedName) return null;
  let ids = adoptedProductTargets.get(record.wix);
  if (!ids) { ids = new Map(); adoptedProductTargets.set(record.wix, ids); }
  ids.set(key, productId);
  return product;
}
// A plan-order pause names only an order id, so the body carries no reference to check. It is
// admitted only for an order this record already saw in a response to its own Pricing Plans
// requests (create, list or get) whose plan and member are the ones the record's grant resolved.
function recordPlanOrderMatches(wix, request, orderId) {
  const ctx = executionCapability.clientContext(wix), gate = require('../../../lib/dependency-readiness');
  if (!ctx || !orderId) return false;
  return (clientReadResponses.get(wix) || []).some(value => {
    const proof = responseEvidence.get(value);
    if (!proof || proof.request.sourceStableKey !== request.sourceStableKey || !new URL(proof.request.url).pathname.startsWith('/pricing-plans/v2/') || proof.digest !== executionCapability.digest(JSON.stringify(value))) return false;
    return [value.order, ...(Array.isArray(value.orders) ? value.orders : [])].some(order => order && order.id === orderId
      && gate.verifyReferenceTargets(request.readinessGrant, ctx, request.sourceStableKey, 'pricing-plans/plan', [order.planId])
      && gate.verifyReferenceTargets(request.readinessGrant, ctx, request.sourceStableKey, 'members/member', [order.buyer && order.buyer.memberId]));
  });
}
function registerImportInventoryScope(recordClient, canonical, target) {
  const record = recordClients.get(recordClient), evidence = responseEvidence.get(target);
  const ctx = record && executionCapability.clientContext(record.wix);
  if (!ctx?.task.entityRefs.includes('stores/product') || evidence?.client !== record.wix || !evidence.mark?.read || evidence.request.sourceStableKey !== record.sourceStableKey || evidence.digest !== executionCapability.digest(JSON.stringify(target)) || !canonical.slug || canonical.slug !== target.slug) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  // A read alone does not join this source record to an arbitrary target product.
  if (!recordProductMatches(record.wix, record, target.id)) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  const rows = require('./variant-correlation').resolveInventoryRows(canonical, target);
  rows.forEach((row, index) => { const inventory = require('./stores-inventory').inventoryForVariant(canonical.variants[index]); if (!inventory) throw new Error('Inventory source stock missing'); row.inventory = inventory; });
  const scope = { grant: record.readinessGrant, pairs: new Map(rows.map(row => [row.productId + ':' + row.variantId, structuredClone(row)])), locations: new Set(), items: new Map() };
  let scopes = importInventoryEvidence.get(record.wix); if (!scopes) { scopes = new Map(); importInventoryEvidence.set(record.wix, scopes); }
  scopes.set(record.sourceStableKey, scope); return rows;
}
function validateImportInventoryWrite(wix, request, mark) {
  const scope = importInventoryEvidence.get(wix)?.get(request.sourceStableKey), rows = request.body?.inventoryItems;
  if (!scope || scope.grant !== request.readinessGrant || !mark.inventoryOperation || !Array.isArray(rows) || !rows.length) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  for (const raw of rows) {
    const item = mark.inventoryOperation === 'update' ? raw.inventoryItem : raw;
    const known = mark.inventoryOperation === 'update' && scope.items.get(item?.id);
    if (!item || (mark.inventoryOperation === 'update' && (!known || known.revision !== item.revision))) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
    const identity = known || item, expected = scope.pairs.get(identity.productId + ':' + identity.variantId)?.inventory;
    if (!expected || !scope.locations.has(identity.locationId)) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
    const permitted = mark.inventoryOperation === 'update' ? ['id', 'revision', ...Object.keys(expected)] : ['productId', 'variantId', 'locationId', ...Object.keys(expected)];
    if (Object.keys(item).some(key => !permitted.includes(key)) || Object.entries(expected).some(([key, value]) => item[key] !== value)) executionCapability.fail('CAPABILITY_ENTITY_MISMATCH');
  }
}
function buildQueryInventoryLocationsRequest(filter) { return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/locations/query`, body: { query: { filter, cursorPaging: { limit: 2 } } } }, { read: true, inventoryRead: 'locations', defaultLocation: filter.defaultLocation === true, locationId: filter.id }); }
function buildQueryInventoryItemsRequest(query) { return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/inventory-items/query`, body: { query } }, { read: true, inventoryRead: 'items' }); }
function buildBulkInventoryItemsRequest(operation, inventoryItems) {
  if (!['create', 'update'].includes(operation)) throw new Error('inventory_operation_invalid');
  return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/bulk/inventory-items/${operation}`, body: { inventoryItems, returnEntity: false }, entity: 'stores/inventory-item' }, { entity: 'stores/inventory-item', inventoryOperation: operation, auxiliary: true });
}
function buildListStoresProductTagsRequest() { return markRequest({ method: 'GET', url: `${WIXAPIS}/tags/v1/tags?fqdn=wix.stores.catalog.v3.product` }, { read: true }); }
function buildCreateStoresProductTagRequest(name) { return markRequest({ method: 'POST', url: `${WIXAPIS}/tags/v1/tags`, body: { tag: { name, fqdn: 'wix.stores.catalog.v3.product' } }, entity: 'stores/product-tag' }, { entity: 'stores/product-tag' }); }
function buildQueryBlogCategoriesRequest() { return markRequest({ method: 'POST', url: `${WIXAPIS}/blog/v3/categories/query`, body: {} }, { read: true }); }
function buildListCmsCollectionsRequest() { return markRequest({ method: 'GET', url: `${WIXAPIS}/wix-data/v2/collections?query.paging.limit=100` }, { read: true }); }
function buildGetCmsCollectionRequest(id) { return markRequest({ method: 'GET', url: `${WIXAPIS}/wix-data/v2/collections/${encodeURIComponent(id)}?consistentRead=true` }, { read: true }); }
function buildGetCmsDataItemRequest(collectionId, id) {
  if (!collectionId || !id) throw new Error('CMS item read requires collection and item identity');
  return markRequest({ method: 'GET', url: `${WIXAPIS}/wix-data/v2/items/${encodeURIComponent(id)}?dataCollectionId=${encodeURIComponent(collectionId)}&consistentRead=true` }, { read: true });
}
function buildGetStoresCatalogVersionRequest() { return markRequest({ method: 'GET', url: `${WIXAPIS}/stores/v3/provision/version` }, { read: true }); }
async function ensureCmsCollection(wix, collection) {
  const definition = normalizeCmsCollectionDefinition(collection);
  return wix.send(markRequest({ method: 'POST', url: `${WIXAPIS}/wix-data/v2/collections`, body: { collection: definition } }, { setupOperation: 'ensure-cms-collection' }));
}
async function ensureBlogFallbackAuthor(wix, payload) {
  return (await wix.send(markRequest(_buildCreateMemberRequest(payload), { setupOperation: 'blog-fallback-author' }))).member;
}

// --- Stores brand, customization, promotion, back-in-stock request, review -------
// VERIFIED LIVE 2026-10-27 on a throwaway site. Each payload is the request body
// itself, so the readiness grant checks reference fields at the paths the entity declares.
const alreadyExists = error => error?.status === 409 || error?.applicationErrorCode === 'ALREADY_EXISTS' || error?.applicationErrorCode === 'BACK_IN_STOCK_NOTIFICATION_REQUEST_ALREADY_EXISTS';
async function queryAllPages(wix, build, key, { pageSize = 100, maxPages = 200 } = {}) {
  const all = [];
  let cursor = null, pages = 0;
  do {
    const response = await wix.send(build(cursor ? { cursorPaging: { limit: pageSize, cursor } } : { cursorPaging: { limit: pageSize } }));
    all.push(...(response[key] || []));
    cursor = response.pagingMetadata?.cursors?.next || response.metadata?.cursors?.next || null;
    pages += 1;
  } while (cursor && pages < maxPages);
  if (cursor) throw new Error(`${key}: still paging after ${maxPages} pages; refusing a partial index`);
  return all;
}

// Brand: { id, name } only. The name is unique: a duplicate create answers 409 ALREADY_EXISTS,
// and the existing brand is reused by an exact-name query (the query filters on name).
function buildCreateStoresBrandRequest({ brand } = {}) {
  if (typeof brand?.name !== 'string' || !brand.name.trim()) throw new Error('a Stores brand needs a non-empty name');
  return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/brands`, body: { brand: { name: brand.name } } }, { entity: 'stores/brand' });
}
function buildQueryStoresBrandsRequest(query = {}) { return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/brands/query`, body: { query } }, { read: true }); }
async function createStoresBrand(wix, payload) {
  try {
    return { outcome: 'created', brand: (await wix.send(buildCreateStoresBrandRequest(payload))).brand };
  } catch (error) {
    rethrowRunStop(error);
    if (!alreadyExists(error)) throw error;
    const found = ((await wix.send(buildQueryStoresBrandsRequest({ filter: { name: payload.brand.name } }))).brands || []).filter(row => row.name === payload.brand.name);
    if (found.length !== 1) throw Object.assign(new Error(`brand "${payload.brand.name}" exists but could not be resolved to one id`), { code: 'BRAND_EXISTS_UNRESOLVED', outcomeKnown: true });
    return { outcome: 'reused', brand: found[0] };
  }
}

// Customization: unique by (name, customizationType, customizationRenderType) — a duplicate is
// 409 ALREADY_EXISTS and is reused. The standalone shape uses freeTextInput /
// customizationRenderType; the product-side modifier names are refused here so a payload copied
// from a product never reaches this endpoint (connected-modifier-must-restate-the-settings).
function buildCreateStoresCustomizationRequest({ customization } = {}) {
  const c = customization || {};
  if (typeof c.name !== 'string' || !c.name.trim()) throw new Error('a Stores customization needs a name');
  if (!['MODIFIER', 'PRODUCT_OPTION'].includes(c.customizationType)) throw new Error('a Stores customization needs customizationType MODIFIER or PRODUCT_OPTION');
  if (!['FREE_TEXT', 'TEXT_CHOICES', 'SWATCH_CHOICES'].includes(c.customizationRenderType)) throw new Error('a Stores customization needs customizationRenderType FREE_TEXT, TEXT_CHOICES or SWATCH_CHOICES');
  for (const key of ['freeTextSettings', 'modifierRenderType']) if (Object.hasOwn(c, key)) throw new Error(`a Stores customization uses the standalone field names; ${key} belongs to a product modifier`);
  return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/customizations`, body: { customization: c } }, { entity: 'stores/product-customization' });
}
function buildQueryStoresCustomizationsRequest(query = {}) { return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/customizations/query`, body: { query } }, { read: true }); }
// What makes two groups the same: the free-text limits and title, or the choice names and types in order.
function customizationSettingsKey(c) {
  if (c.customizationRenderType === 'FREE_TEXT') { const f = c.freeTextInput || {}; return JSON.stringify([f.title || '', f.minCharCount || 0, f.maxCharCount ?? null]); }
  return JSON.stringify((c.choicesSettings?.choices || []).map(choice => [choice.choiceType || '', choice.name || '']));
}
async function createStoresCustomization(wix, payload) {
  try {
    return { outcome: 'created', customization: (await wix.send(buildCreateStoresCustomizationRequest(payload))).customization };
  } catch (error) {
    rethrowRunStop(error);
    if (!alreadyExists(error)) throw error;
    const c = payload.customization;
    const found = ((await wix.send(buildQueryStoresCustomizationsRequest({ filter: { name: c.name } }))).customizations || [])
      .filter(row => row.name === c.name && row.customizationType === c.customizationType && row.customizationRenderType === c.customizationRenderType);
    if (found.length !== 1) throw Object.assign(new Error(`customization "${c.name}" exists but could not be resolved to one id`), { code: 'CUSTOMIZATION_EXISTS_UNRESOLVED', outcomeKnown: true });
    // Same name, different settings: another add-on group. Reusing it would give products the
    // wrong choices, so the mapping must name the groups apart.
    if (customizationSettingsKey(found[0]) !== customizationSettingsKey(c)) throw Object.assign(new Error(`customization "${c.name}" exists with different settings; give same-named groups distinct names`), { code: 'CUSTOMIZATION_NAME_CONFLICT', outcomeKnown: true, existingId: found[0].id });
    return { outcome: 'reused', customization: found[0] };
  }
}

// The product-side modifier for a written customization: the id alone is refused, so the name,
// render type and settings are restated under their product-side names. Verified live
// 2026-10-27: a product created with this shape kept the customization's id.
function connectedModifierFromCustomization(customization, { mandatory = customization?.modifierSettings?.defaultMandatory === true } = {}) {
  const c = customization || {};
  if (!c.id || c.customizationType !== 'MODIFIER') throw new Error('a connected modifier needs a written MODIFIER customization with its id');
  const settings = c.customizationRenderType === 'FREE_TEXT' ? { freeTextSettings: c.freeTextInput } : { choicesSettings: c.choicesSettings };
  if (!Object.values(settings)[0]) throw new Error(`customization ${c.id} has no settings for ${c.customizationRenderType}`);
  return { id: c.id, name: c.name, modifierRenderType: c.customizationRenderType, mandatory, ...settings };
}

// Promotion: a category-page banner, never a discount. Only a Media Manager id is accepted: the
// media.url path saves the promotion disabled and clears the media if the async import fails
// (verified live), so the executor imports the image first and creates only once it is READY.
const PROMOTION_FIELDS = new Set(['name', 'enabled', 'media', 'categories', 'destinationUrl']);
function buildCreateStoresPromotionRequest({ promotion } = {}) {
  const p = promotion || {};
  for (const key of Object.keys(p)) if (!PROMOTION_FIELDS.has(key)) throw new Error(`a Stores promotion is a banner; field "${key}" is not part of it`);
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('a Stores promotion needs a name');
  if (typeof p.media?.id !== 'string' || !p.media.id || Object.keys(p.media).length !== 1) throw new Error('a Stores promotion needs media.id of an imported, ready Media Manager file (media.url fails silently)');
  if (!Array.isArray(p.categories) || !p.categories.length) throw new Error('a Stores promotion needs at least one category placement');
  for (const c of p.categories) if (typeof c?.id !== 'string' || !Number.isInteger(c.position) || c.position < 1) throw new Error('each promotion category placement needs an id and an integer position from 1');
  return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/promotions`, body: { promotion: p } }, { entity: 'stores/promotion' });
}
function buildGetStoresPromotionRequest(id) { return markRequest({ method: 'GET', url: `${WIXAPIS}/stores/v3/promotions/${encodeURIComponent(id)}` }, { read: true }); }
// The query filters on neither name nor category; callers match client-side.
function buildQueryStoresPromotionsRequest(query = {}) { return markRequest({ method: 'POST', url: `${WIXAPIS}/stores/v3/promotions/query`, body: { query } }, { read: true }); }
async function queryAllStoresPromotions(wix) { return queryAllPages(wix, buildQueryStoresPromotionsRequest, 'promotions'); }
async function readyMediaFile(wix, fileId, { tries = 10, delayMs = 1500 } = {}) {
  // A file just imported can answer 404 for a moment before it is readable.
  for (let i = 0; i < tries; i++) {
    try { return await waitUntilFileReady(wix, fileId, { tries: tries - i, delayMs }); } catch (error) { if (error?.status !== 404 || i === tries - 1) throw error; }
    await pauseFor(wix)(delayMs);
  }
  return null;
}
// Ours: every non-media field this record sends, the same on the site (categories by id,
// position and any placement flag sent). Two source banners that share a name on one category
// still differ in another field, or are each created on their first attempt (no lookup then).
function promotionKey(row, sent) {
  const categoryFields = [...new Set((sent?.categories || []).flatMap(c => Object.keys(c || {})))].sort();
  return JSON.stringify(Object.keys(sent || {}).filter(k => k !== 'media').sort().map(k => [k, k === 'categories'
    ? (row?.categories || []).map(c => categoryFields.map(f => c?.[f] ?? null)).map(v => JSON.stringify(v)).sort()
    : row?.[k] ?? null]));
}
async function findStoresPromotions(wix, promotion) {
  const key = promotionKey(promotion, promotion);
  return (await queryAllStoresPromotions(wix)).filter(row => promotionKey(row, promotion) === key);
}
async function adoptStoresPromotion(wix, found, imageUrl) {
  const read = (await wix.send(buildGetStoresPromotionRequest(found[0].id))).promotion || found[0];
  const duplicates = found.length > 1 ? { duplicateIds: found.slice(1).map(row => row.id) } : {};
  if (!read?.media?.image) return { outcome: 'image-cleared', promotion: read, imageUrl, fileId: read?.media?.id || null, adopted: true, ...duplicates };
  return { outcome: 'reused', promotion: read, ...duplicates };
}
// payload: { promotion: { name, enabled, categories, destinationUrl? }, imageUrl }. A failed image
// is a known per-record failure: nothing is created. A create whose reply was lost is looked up
// once before its error is passed on; a re-run of such a record passes `readBackFirst: true`, and
// a promotion an earlier attempt created (every non-media field the same) is then reused before
// any image import or create. A first attempt never looks: another record may share its name.
async function createStoresPromotion(wix, { promotion, imageUrl }, { mediaTries, mediaDelayMs, readBackFirst = false } = {}) {
  if (!imageUrl) throw Object.assign(new Error('a Stores promotion needs a source image URL'), { code: 'PROMOTION_IMAGE_MISSING', outcomeKnown: true });
  if (readBackFirst) {
    const existing = await findStoresPromotions(wix, promotion);
    if (existing.length) return adoptStoresPromotion(wix, existing, imageUrl);
  }
  const file = await importMedia(wix, { sourceUrl: imageUrl, mediaType: 'IMAGE' });
  let ready = null;
  try { ready = file?.id ? await readyMediaFile(wix, file.id, { tries: mediaTries, delayMs: mediaDelayMs }) : null; } catch (error) { rethrowRunStop(error); if (error?.code !== 'MEDIA_IMPORT_FAILED') throw error; }
  if (!ready) return { outcome: 'image-failed', promotion: null, imageUrl, fileId: file?.id || null };
  let created;
  try {
    created = (await wix.send(buildCreateStoresPromotionRequest({ promotion: { ...promotion, media: { id: ready.id } } }))).promotion;
  } catch (error) {
    rethrowRunStop(error);
    if (error?.outcomeKnown !== false || error?.requestSent === false) throw error;
    let found = [];
    try { found = await findStoresPromotions(wix, promotion); } catch (readError) { rethrowRunStop(readError); /* still unknown */ }
    if (!found.length) throw error;
    return adoptStoresPromotion(wix, found, imageUrl);
  }
  const read = (await wix.send(buildGetStoresPromotionRequest(created.id))).promotion;
  if (!read?.media?.image) return { outcome: 'image-cleared', promotion: read || created, imageUrl, fileId: ready.id };
  return { outcome: 'created', promotion: read };
}

// Back-in-stock request: needs the Back in Stock app and request collection on (setup step
// start-back-in-stock-collection), else 428 REQUEST_COLLECTION_DISABLED. itemDetails.name and
// .price are required. Creating sends no email. A duplicate (same item, email, still RECEIVED)
// is 409; Query filters on status only, so the existing request is found client-side.
const BACK_IN_STOCK = `${WIXAPIS}/back-in-stock-service/v1/back-in-stock-notification-requests`;
function buildCreateBackInStockRequest({ itemDetails, request } = {}) {
  if (typeof request?.email !== 'string' || !request.email.includes('@')) throw new Error('a back-in-stock request needs an email');
  const ref = request.catalogReference;
  if (typeof ref?.catalogItemId !== 'string' || !ref.catalogItemId) throw new Error('a back-in-stock request needs catalogReference.catalogItemId');
  if (ref.appId !== undefined && ref.appId !== WIX_STORES_APP_ID) throw new Error('back-in-stock requests only work for Wix Stores');
  if (typeof itemDetails?.name !== 'string' || !itemDetails.name) throw new Error('a back-in-stock request needs itemDetails.name');
  if (!/^\d+(\.\d+)?$/.test(String(itemDetails?.price ?? ''))) throw new Error('a back-in-stock request needs itemDetails.price as a non-negative decimal string');
  const body = { itemDetails: { ...itemDetails, price: String(itemDetails.price) }, request: { ...request, catalogReference: { ...ref, appId: WIX_STORES_APP_ID } } };
  return markRequest({ method: 'POST', url: BACK_IN_STOCK, body }, { entity: 'stores/back-in-stock-request' });
}
// Offline status change, sends nothing. Its body names no dependency, so it is auxiliary.
function buildMarkBackInStockNotificationSentRequest(id) {
  if (!id) throw new Error('marking a back-in-stock request needs its id');
  return markRequest({ method: 'PUT', url: `${BACK_IN_STOCK}/${encodeURIComponent(id)}/mark-as-notification-sent`, body: {} }, { entity: 'stores/back-in-stock-request', auxiliary: true });
}
function buildGetBackInStockRequestRequest(id) { return markRequest({ method: 'GET', url: `${BACK_IN_STOCK}/${encodeURIComponent(id)}` }, { read: true }); }
function buildQueryBackInStockRequestsRequest(query = {}) { return markRequest({ method: 'POST', url: `${BACK_IN_STOCK}/query`, body: { query } }, { read: true }); }
function buildStartBackInStockCollectionRequest() { return markRequest({ method: 'POST', url: `${BACK_IN_STOCK}/settings/start-collecting`, body: { appId: WIX_STORES_APP_ID } }, { setupOperation: 'start-back-in-stock-collection' }); }
// Get Settings is a PUT with an empty body; it changes nothing.
function buildGetBackInStockSettingsRequest() { return markRequest({ method: 'PUT', url: `${BACK_IN_STOCK}/settings`, body: {} }, { read: true }); }
const backInStockKey = r => [String(r?.email || '').toLowerCase(), r?.catalogReference?.catalogItemId || '', r?.catalogReference?.options?.variantId || ''].join('|');
// payload: the create body, plus notified: true when the source already notified this shopper,
// and knownRequestId: the request an earlier attempt of this record created (its journal or
// crosswalk target id). A known request is read and finished, never created again: once marked
// sent it no longer blocks a duplicate create, so a second create would make a second request.
// A mark whose reply was lost is read back; one still unconfirmed is `mark-unverified` with the
// request id, which the retry passes as knownRequestId.
async function createBackInStockRequest(wix, { notified = false, knownRequestId = null, ...payload }) {
  let request, outcome = 'created';
  if (knownRequestId) {
    try { request = (await wix.send(buildGetBackInStockRequestRequest(knownRequestId))).request || null; } catch (error) { rethrowRunStop(error); if (error?.status !== 404) throw error; }
    if (request && backInStockKey(request) !== backInStockKey(payload.request)) request = null;
    if (request) outcome = 'reused';
  }
  if (!request) try {
    request = (await wix.send(buildCreateBackInStockRequest(payload))).request;
  } catch (error) {
    rethrowRunStop(error);
    if (error?.applicationErrorCode === 'REQUEST_COLLECTION_DISABLED') throw Object.assign(error, { code: 'BACK_IN_STOCK_COLLECTION_DISABLED', setupStep: 'start-back-in-stock-collection' });
    if (!alreadyExists(error)) throw error;
    const key = backInStockKey(payload.request);
    const found = (await queryAllPages(wix, paging => buildQueryBackInStockRequestsRequest({ filter: { status: 'RECEIVED' }, ...paging }), 'requests')).filter(row => backInStockKey(row) === key);
    if (found.length !== 1) return { outcome: 'deferred', request: null, deferralReason: 'back-in-stock-duplicate-unresolved' };
    request = found[0]; outcome = 'reused';
  }
  if (notified && request.status !== 'NOTIFICATION_SENT') {
    try {
      request = (await wix.send(buildMarkBackInStockNotificationSentRequest(request.id))).request;
    } catch (error) {
      rethrowRunStop(error);
      if (error?.requestSent === false || error?.outcomeKnown !== false) throw Object.assign(error, { requestId: request.id });
      let read = null;
      try { read = (await wix.send(buildGetBackInStockRequestRequest(request.id))).request; } catch (readError) { rethrowRunStop(readError); /* still unknown */ }
      if (read?.status !== 'NOTIFICATION_SENT') return { outcome: 'mark-unverified', request: read || request, requestId: request.id };
      request = read;
    }
  }
  return { outcome, request };
}

// Review: needs the Wix Reviews app. Bulk create (1-100) requires author.contactId; one review per
// author per product (ALREADY_EXISTS per item). Verified live: bulk create accepts rating 0, and a
// REJECTED review is hidden from Get/Query unless returnPrivateReviews=true.
const REVIEWS_BULK_MAX = 100;
const REVIEW_TEXT_MAX = 3000;
function validateReview(r) {
  if (r?.namespace !== 'stores') throw new Error('a review namespace must be "stores"');
  if (typeof r.entityId !== 'string' || !r.entityId || r.entityId.length > 36) throw new Error('a review needs entityId, the Wix Stores product id');
  if (typeof r.author?.contactId !== 'string' || !r.author.contactId) throw new Error('a review needs author.contactId');
  if (r.author.authorName !== undefined && String(r.author.authorName).length > 100) throw new Error('a review authorName must be at most 100 characters');
  if (!Number.isInteger(r.content?.rating) || r.content.rating < 0 || r.content.rating > 5) throw new Error('a review rating must be an integer from 0 to 5');
  for (const key of ['title', 'body']) if (r.content[key] !== undefined && String(r.content[key]).length > REVIEW_TEXT_MAX) throw new Error(`a review ${key} must be at most ${REVIEW_TEXT_MAX} characters (plain text)`);
  if ((r.content.media || []).length > 10) throw new Error('a review takes at most 10 media items');
}
function buildBulkCreateReviewsRequest(reviews) {
  if (!Array.isArray(reviews) || !reviews.length || reviews.length > REVIEWS_BULK_MAX) throw new Error(`bulk review create takes 1-${REVIEWS_BULK_MAX} reviews`);
  reviews.forEach(validateReview);
  return markRequest({ method: 'POST', url: `${WIXAPIS}/reviews/v1/bulk/reviews/create`, body: { reviews, returnEntity: true } }, { entity: 'stores/review' });
}
// One review per call so each moderation belongs to one record; Wix answers with a jobId only.
function buildModerateReviewRequest({ reviewId, status }) {
  if (!reviewId) throw new Error('moderating a review needs its id');
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new Error('review moderation status must be APPROVED or REJECTED');
  return markRequest({ method: 'POST', url: `${WIXAPIS}/reviews/v1/bulk/reviews/moderate`, body: { filter: { id: { $in: [reviewId] } }, status } }, { entity: 'stores/review', auxiliary: true });
}
function buildGetReviewRequest(id) { return markRequest({ method: 'GET', url: `${WIXAPIS}/reviews/v1/reviews/${encodeURIComponent(id)}?returnPrivateReviews=true` }, { read: true }); }
function buildQueryReviewsRequest(query = {}) { return markRequest({ method: 'POST', url: `${WIXAPIS}/reviews/v1/reviews/query`, body: { query } }, { read: true }); }
// records: [{ sourceStableKey, review }]. With an import-task grant every item is checked against
// its own record. Returns one result per record by originalIndex; partial failure is normal.
async function createStoresReviews(wix, { records, readinessGrant }) {
  const results = [];
  for (let start = 0; start < records.length; start += REVIEWS_BULK_MAX) {
    const chunk = records.slice(start, start + REVIEWS_BULK_MAX);
    let response;
    try {
      const request = buildBulkCreateReviewsRequest(chunk.map(row => row.review));
      response = await wix.send(readinessGrant ? withBulkReadinessGrant(request, { readinessGrant, sourceStableKeys: chunk.map(row => row.sourceStableKey) }) : request);
    } catch (error) {
      rethrowRunStop(error);
      // One chunk's failure never hides the reviews earlier chunks created; a request that left
      // may have written, so its rows are unknown rather than failed.
      const sent = error?.requestSent !== undefined || error?.status !== undefined || error?.outcomeKnown !== undefined;
      const outcome = !sent || error?.requestSent === false || error?.outcomeKnown === true ? 'failed' : 'unknown';
      for (const row of chunk) results.push({ sourceStableKey: row.sourceStableKey, outcome, error });
      continue;
    }
    const byIndex = new Map((response.results || []).map(row => [row.itemMetadata?.originalIndex, row]));
    chunk.forEach((row, i) => {
      const item = byIndex.get(i);
      if (!item) results.push({ sourceStableKey: row.sourceStableKey, outcome: 'unknown' });
      else if (item.itemMetadata.success) results.push({ sourceStableKey: row.sourceStableKey, outcome: 'created', review: item.review, reviewId: item.itemMetadata.id });
      else results.push({ sourceStableKey: row.sourceStableKey, outcome: item.itemMetadata.error?.code === 'ALREADY_EXISTS' ? 'already-exists' : 'failed', error: item.itemMetadata.error || null });
    });
  }
  return results;
}
// Sets the source moderation state on created reviews: every moderation is sent first, then the
// reviews are read back in shared rounds, so the wait is paid once per batch, not per review.
// items: [{ wix, reviewId, status }] — wix is each record's own client.
async function moderateStoresReviews(items, { tries = 5, delayMs = 2000 } = {}) {
  const results = new Map(), pending = [];
  for (const item of items) {
    try { await item.wix.send(buildModerateReviewRequest(item)); pending.push(item); } catch (error) { rethrowRunStop(error); results.set(item, { outcome: 'moderation-failed', reviewId: item.reviewId, status: item.status, error }); }
  }
  for (let round = 0; round < tries && pending.length; round++) {
    if (round) await pauseFor(pending[0].wix)(delayMs);
    for (const item of [...pending]) {
      let review;
      try { review = (await item.wix.send(buildGetReviewRequest(item.reviewId))).review; } catch (error) { rethrowRunStop(error); continue; } // stays pending, unconfirmed at the end
      if (review?.moderation?.moderationStatus === item.status) { results.set(item, { outcome: 'moderated', reviewId: item.reviewId, review }); pending.splice(pending.indexOf(item), 1); }
    }
  }
  for (const item of pending) results.set(item, { outcome: 'moderation-unconfirmed', reviewId: item.reviewId, status: item.status });
  return items.map(item => results.get(item));
}
async function moderateStoresReview(wix, { reviewId, status }, options) {
  return (await moderateStoresReviews([{ wix, reviewId, status }], options))[0];
}
// Merchant reply (Set Reply, PATCH /reviews/v1/reviews/{id}/reply): reply is read-only on create,
// so it is a follow-up on a created review, sent with that review record's own grant (the client
// admits it only for this record's own review). One reply per review; Set Reply overwrites, so a
// retry is safe. Docs-verified, not yet exercised live. The read schema caps reply.message at 1000
// characters (the request allows 10000), so a longer reply is not sent.
const REVIEW_REPLY_MAX = 1000;
function buildSetStoresReviewReplyRequest({ reviewId, message } = {}) {
  if (typeof reviewId !== 'string' || !reviewId) throw new Error('a review reply needs the review id');
  if (typeof message !== 'string' || !message.trim()) throw new Error('a review reply needs a non-empty message');
  if (message.length > REVIEW_REPLY_MAX) throw Object.assign(new Error(`a review reply must be at most ${REVIEW_REPLY_MAX} characters (keep the full text in the CMS shadow)`), { code: 'review_reply_too_long', requestSent: false, outcomeKnown: true });
  return markRequest({ method: 'PATCH', url: `${WIXAPIS}/reviews/v1/reviews/${encodeURIComponent(reviewId)}/reply`, body: { message } }, { entity: 'stores/review', auxiliary: true, reviewReply: reviewId });
}
// A reply goes only on the record's own review: its crosswalk target, or a review this record read
// whose product and author are the ones its grant resolved (one review per author per product).
function recordOwnReview(wix, request, reviewId) {
  const ctx = executionCapability.clientContext(wix), gate = require('../../../lib/dependency-readiness');
  if (!ctx || typeof reviewId !== 'string' || !reviewId) return false;
  if (gate.currentRecordTargetId(request.readinessGrant, ctx, request.sourceStableKey) === reviewId) return true;
  return (clientReadResponses.get(wix) || []).some(value => {
    const proof = responseEvidence.get(value), review = value?.review;
    return proof?.mark?.read && proof.request.sourceStableKey === request.sourceStableKey && proof.request.readinessGrant === request.readinessGrant && proof.digest === executionCapability.digest(JSON.stringify(value)) &&
      review?.id === reviewId && gate.verifyReferenceMember(request.readinessGrant, ctx, request.sourceStableKey, 'stores/product', review.entityId) && gate.verifyReferenceMember(request.readinessGrant, ctx, request.sourceStableKey, 'crm/contact', review.author?.contactId);
  });
}
// wix: the review record's own client (bindRecordClient). Outcomes: verified | already-present
// (the review already has this reply: adopted on retry, nothing sent) | dry-run | not-sent (refused before
// send; journal failed, requestSent false) | failed (rejected) | unverified (sent, read-back differs)
// | review-not-found.
async function setStoresReviewReply(wix, { reviewId, message } = {}) {
  let request;
  try { request = buildSetStoresReviewReplyRequest({ reviewId, message }); }
  catch (error) { rethrowRunStop(error); return { outcome: 'not-sent', reviewId, requestSent: false, outcomeKnown: true, error: { code: error.code || 'review_reply_invalid', message: error.message } }; }
  const read = async () => (await wix.send(buildGetReviewRequest(reviewId))).review || null;
  let before;
  try { before = await read(); } catch (error) { rethrowRunStop(error); if (error.requestSent === false) throw error; if (error.status === 404 && error.outcomeKnown !== false) return { outcome: 'review-not-found', reviewId }; return { outcome: 'not-sent', reviewId, requestSent: false, outcomeKnown: true, error: memberErrorFields(error) }; }
  if (!before) return { outcome: 'review-not-found', reviewId };
  if (before._dryRunPlaceholder) { await wix.send(request); return { outcome: 'dry-run', reviewId }; }
  if (before.reply?.message === message) return { outcome: 'already-present', reviewId, review: before };
  let error = null;
  try { await wix.send(request); }
  catch (caught) {
    rethrowRunStop(caught);
    if (caught.requestSent === false) return { outcome: 'not-sent', reviewId, requestSent: false, outcomeKnown: true, error: { code: caught.code || null, message: String(caught.message).slice(0, 300) } };
    if (caught.outcomeKnown !== false) return { outcome: 'failed', reviewId, requestSent: true, outcomeKnown: true, error: memberErrorFields(caught) };
    error = memberErrorFields(caught);
  }
  let after = null;
  try { after = await read(); } catch (error) { rethrowRunStop(error); after = null; }
  return after?.reply?.message === message ? { outcome: 'verified', reviewId, review: after, ...(before.reply?.message ? { replacedReply: before.reply.message } : {}) } : { outcome: 'unverified', reviewId, requestSent: true, outcomeKnown: false, ...(error ? { error } : {}) };
}
// After ALREADY_EXISTS: the visible review by this author on this product, if exactly one.
async function findStoresReview(wix, { entityId, contactId }) {
  const found = (await queryAllPages(wix, buildQueryReviewsRequest, 'reviews')).filter(row => row.entityId === entityId && row.author?.contactId === contactId);
  return found.length === 1 ? found[0] : null;
}

module.exports = {
  requestMark,
  normalizeV5AddressItem, V5_ADDRESS_ITEM_KEYS, withReadinessGrant, withBulkReadinessGrant, bindRecordClient, admitSavedProductTarget, validReadBackEvidence, buildBoundedReadRequest, buildQueryBlogCategoriesRequest, captureSetupReferenceBindings, registerQuickInventoryScope, registerImportInventoryScope, buildQueryInventoryLocationsRequest, buildQueryInventoryItemsRequest, buildBulkInventoryItemsRequest,
  buildListStoresProductTagsRequest, buildCreateStoresProductTagRequest, buildListCmsCollectionsRequest, buildGetCmsCollectionRequest, buildGetCmsDataItemRequest, buildGetStoresCatalogVersionRequest, ensureCmsCollection, ensureBlogFallbackAuthor,
  WIXAPIS,
  TRANSIENT_WIX_STATUSES,
  isTransientWixError,
  isRetryableRicosError,
  RICOS_PLUGINS,
  RICOS_HTML_CAP,
  createDryRunConfig,
  normalizeDryRunValue,
  createWixSetupExecutor,
  createWixClient,
  createRateLimitThrottle,
  rateLimitEndpoint,
  RATE_LIMIT_POLICY,
  createWixCaptureClient,
  WRITE_BUILDERS_BY_ENTITY,
  WRITE_HELPERS_BY_ENTITY,
  buildCreateEventCategoryRequest, createEventCategory, buildQueryEventCategoriesRequest, queryAllEventCategories, findEventCategoriesByName,
  buildCreateEventRequest, createEvent, buildGetEventRequest, getEvent, buildQueryEventsRequest, findPublishedEvents, adoptPublishedEvent,
  buildAssignEventToCategoriesRequest, assignEventToCategories, buildListEventCategoriesRequest, listEventCategories,
  buildCreateTicketDefinitionRequest, createTicketDefinition, buildGetTicketDefinitionRequest, getTicketDefinition, buildQueryTicketDefinitionsRequest, findTicketDefinitionsByName,
  buildCreateRsvpRequest, createRsvp, buildGetRsvpRequest, getRsvp, buildQueryRsvpsRequest, findRsvpsByEmail,
  buildDirectRestRequest,
  sendDirectRest,
  buildGuardedRawRequest,
  sendGuardedRawRequest,
  buildGuardedRawReadRequest,
  verifyGuardedRawCanary,
  rawRequestSummary,
  resolveRawRequestOutcome,
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
  toDraftPostBody,
  buildCreateDraftPostRequest,
  createDraftPost,
  publishDraftPost,
  buildCreateBuildDraftPostRequest,
  buildUpdateBuildDraftPostRequest,
  buildBlogBuildReadRequest,
  buildDeleteDraftPostRequest,
  deleteDraftPost,
  buildDeletePostRequest,
  deletePost,
  BLOG_BULK_CREATE_MAX,
  buildBulkCreateDraftPostsRequest,
  bulkCreateDraftPosts,
  buildInsertItemRequest,
  buildGetSiteDataUsageRequest,
  insertDataItem,
  buildUpdateDataItemRequest,
  updateDataItem,
  queryAllDataItems,
  buildBulkSaveDataItemsRequest,
  bulkSaveDataItems,
  buildImportCrosswalkItem,
  syncImportCrosswalk,
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
  confirmedPictures,
  assertProductMediaGuardActive,
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
  attachStoresProductVideos,
  buildGetStoresProductRequestWithFields,
  buildGetStoresProductWithMediaRequest,
  getStoresProductWithMedia,
  observeStoresProductMediaIngest,
  withinWriteObservation,
  STORES_MEDIA_CREATE_OBSERVATION,
  verifyMemberContactIdentity,
  buildGetStoresProductForVerificationRequest,
  getStoresProductForVerification,
  storesProductMediaLanded,
  storesProductMediaItemLanded,
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
  buildDeleteInstallSeededProductRequest,
  buildDeleteInstallSeededCategoryRequest,
  buildGetAllProductsCategoryRequest,
  getAllProductsCategoryId,
  buildPatchStoresProductRequest,
  patchStoresProduct,
  buildGetItemSeoTagsRequest,
  getItemSeoTags,
  buildBulkSetItemSeoTagsRequest,
  bulkSetItemSeoTags,
  setItemSeoTags,
  buildGetSeoPatternRequest,
  buildListSeoPatternVariablesRequest,
  buildCreateSeoPatternRequest,
  buildSetSeoPatternRequest,
  ensureSeoPattern,
  buildGetSiteSeoTagsRequest,
  buildGetSiteShareImageFileRequest,
  buildSetSiteSeoTagsRequest,
  setSiteSeoTags,
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
  buildUpdateMemberContactRequest,
  updateMemberContact,
  buildFindOrCreateContactExtendedFieldRequest,
  findOrCreateContactExtendedField,
  buildBulkUpsertEmailSubscriptionsRequest,
  bulkUpsertEmailSubscriptions,
  buildFindOrCreateContactLabelRequest,
  buildGetContactLabelRequest,
  findOrCreateContactLabel,
  CONTACT_TAG_ID_MAX_LENGTH,
  CONTACT_TAG_IDS_MAX_PER_CALL,
  buildUpdateContactTagsRequest,
  buildGetContactTagsRequest,
  assignContactLabels,
  memberAboutContentFromText,
  buildCreateMemberAboutRequest,
  buildUpdateMemberAboutRequest,
  buildQueryMemberAboutsRequest,
  buildGetMemberAboutRequest,
  upsertMemberAbout,
  assertCouponRedeemabilityDecided,
  normalizeCouponSpecification,
  buildCreateCouponRequest,
  createCoupon,
  buildQueryCouponsRequest,
  queryCoupons, buildQueryCouponsByCodeRequest, queryCouponsByCode, buildDeleteCouponRequest, deleteCoupon, ensureCoupon, WIX_PRICING_PLANS_APP_DEF_ID, PLAN_WRITE_MIN_INTERVAL_MS, buildCreatePlanRequest, createPlan, buildQueryPlansByNameRequest, queryPlansByName, buildGetPlanRequest, getPlan, buildArchivePlanRequest, archivePlan, ensurePlanDefinition, buildCreateOfflinePlanOrderRequest, createOfflinePlanOrder, buildPausePlanOrderRequest, pausePlanOrder, buildListPlanOrdersRequest, listPlanOrders, buildGetPlanOrderRequest, getPlanOrder, ensurePlanOrder, PLAN_ORDER_PAID_SETTLE_READS,
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
  buildUpdateDeliveryRegionRequest,
  updateDeliveryRegion,
  planDeliveryRegionWrite,
  ensureDeliveryRegion,
  buildDeleteShippingOptionRequest,
  deleteShippingOption,
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
  buildGetShippingOptionRequest,
  getShippingOption,
  buildUpdateShippingOptionEstimateRequest,
  queryAllShippingOptions,
  createShippingOptionVerified,
  recoverShippingOption,
  buildUpdateBusinessContactRequest,
  updateBusinessContact,
  buildGetSitePropertiesRequest,
  getSiteProperties,
  buildUpdateBusinessRegionRequest,
  updateBusinessRegion,
  buildUpdateSiteLanguageRequest,
  updateSiteLanguage,
  buildUpdateSiteLocaleRequest,
  updateSiteLocale,
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
  provisionContactExtendedFields,
  provisionExtendedFieldRequirement,
  contactExtendedFields,
  buildGetOrderRequest,
  getOrder,
  buildImportPrivateDocumentRequest,
  INVOICE_MEDIA_FOLDER,
  importPrivateDocument,
  uploadPrivateDocument,
  buildGenerateFileDownloadUrlRequest,
  mergeOrderExtendedFields,
  buildUpdateOrderExtendedFieldsRequest,
  updateOrderExtendedFields,
  ORDER_MERCHANT_NOTES_MAX_PER_CALL,
  ORDER_MERCHANT_NOTE_MAX_LENGTH,
  buildAddOrderMerchantNotesRequest,
  addOrderMerchantNotes,
  buildCreateGiftCardRequest,
  buildQueryGiftCardsByCodeRequest,
  createGiftCard,
  findGiftCardByCode,
  buildCreateGiftCardProductRequest,
  buildUpdateGiftCardProductRequest,
  buildQueryGiftCardProductsRequest,
  buildGetGiftCardProductRequest,
  queryGiftCardProducts,
  ensureGiftCardProduct,
  FORMS_NAMESPACE,
  FORM_ORIGINAL_DATE_TARGET,
  FORM_SUBMITTED_TRIGGER,
  FORM_AUTOMATION_PAUSE_LEDGER,
  buildCreateFormRequest,
  buildQueryFormsRequest,
  createForm,
  buildUpdateFormSchemaRequest,
  updateFormSchema,
  formSchemaNeedsUpdate,
  buildCreateFormSubmissionRequest,
  buildGetFormSubmissionRequest,
  buildQueryFormSpamReportsRequest,
  buildQueryFormSubmissionsRequest,
  findFormSubmission,
  createFormSubmission,
  sendFormSubmission,
  verifyFormSubmission,
  buildQueryAutomationsRequest,
  buildGetAutomationRequest,
  buildUpdateAutomationStatusRequest,
  queryFormAutomations,
  pauseFormAutomations,
  restoreFormAutomations,
  importFormEntries,
  pendingFormAutomationRestores,
  buildGetFormRequest,
  buildUpdateFormSpamFilterRequest,
  lowerFormSpamFilter,
  restoreFormSpamFilter,
  pendingFormSpamFilterRestores,
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
  pacedCreateMember,
  buildGetMemberRequest, getMember, buildQueryMembersByLoginEmailRequest, queryMembersByLoginEmail,
  buildQueryContactsByPhoneRequest, queryContactsByPhone, ensureMember, isValidLoginEmail, splitMemberCreateContact, recordWrittenGap,
  MEMBER_WRITE_MIN_INTERVAL_MS,
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
  buildInstallEditorAppsRequest,
  installEditorApps,
  buildGetEditorUrlsRequest,
  getEditorType,
  EDITOR_INSTALL_EXPERIMENTS,
  NO_EDITOR_PART_ERROR,
  PAGE_PATH_CONFLICT_ERROR,
  editorInstallCompanions,
  EDITOR_INSTALL_URL,
  RICH_TEXT_VIEWER_APP_DEF_ID,
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
  BOOKINGS_ADD_ON_GROUP_MAX_ADD_ONS,
  buildCreateBookingsAddOnRequest,
  buildGetBookingsAddOnRequest,
  buildQueryBookingsAddOnsRequest,
  buildDeleteBookingsAddOnRequest,
  buildCreateBookingsAddOnGroupRequest,
  buildSetBookingsAddOnGroupAddOnsRequest,
  buildListBookingsAddOnGroupsRequest,
  buildDeleteBookingsAddOnGroupRequest,
  listBookingsAddOnGroups,
  importBookingsAddOn,
  bookingExternalKey,
  buildCreateBookingRequest,
  buildConfirmBookingRequest,
  buildCancelBookingRequest,
  buildQueryBookingsRequest,
  queryBookings,
  importBooking,
  // Stores domain writers
  buildCreateStoresBrandRequest, buildQueryStoresBrandsRequest, createStoresBrand,
  buildCreateStoresCustomizationRequest, buildQueryStoresCustomizationsRequest, createStoresCustomization, connectedModifierFromCustomization,
  buildCreateStoresPromotionRequest, buildGetStoresPromotionRequest, buildQueryStoresPromotionsRequest, queryAllStoresPromotions, findStoresPromotions, createStoresPromotion,
  buildCreateBackInStockRequest, buildMarkBackInStockNotificationSentRequest, buildGetBackInStockRequestRequest, buildQueryBackInStockRequestsRequest,
  buildStartBackInStockCollectionRequest, buildGetBackInStockSettingsRequest, createBackInStockRequest,
  REVIEWS_BULK_MAX, buildBulkCreateReviewsRequest, buildModerateReviewRequest, buildGetReviewRequest, buildQueryReviewsRequest, createStoresReviews, moderateStoresReviews, moderateStoresReview, findStoresReview, REVIEW_REPLY_MAX, buildSetStoresReviewReplyRequest, setStoresReviewReply,
};
