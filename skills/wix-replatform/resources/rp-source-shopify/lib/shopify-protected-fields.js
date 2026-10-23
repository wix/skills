'use strict';

// Shopify protected customer data. Shopify approves name, email, phone and
// address separately. Ordinary three-record probes attribute a redaction by its GraphQL error
// path; bulk queries omit only fields in kinds Shopify actually named. A pathless or unrelated
// denial always fails closed.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const {
  SOURCE_COVERAGE_FILE,
  reconcileProject,
  upsertAdapterCoverageRows,
  writeJsonAtomic,
} = require('../../../lib/source-coverage.js');
const { ShopifyCliError } = require('./shopify-cli.js');

const KINDS = Object.freeze(['name', 'email', 'phone', 'address']);
const ENTITIES = Object.freeze(['customers', 'orders']);
const KIND_PROBES_FILE = 'data/shopify-discovery/kind-probes.json';
const WITHHELD_EXPORT_FILE = 'data/shopify-discovery/withheld-export.json';
const EXTRACT_MANIFEST_FILE = 'data/source-extract/extract-manifest.json';
const PROBE_SCHEMA_VERSION = 1;
const WITHHELD_EXPORT_SCHEMA_VERSION = 1;
const WITHHELD_EXPORT_CONFIRMATION = 'owner-exported';
const WITHHELD_EXPORT_CODE = 'shopify-withheld-details-export';
const PROBE_QUERIES_DIR = path.join(__dirname, '..', 'queries');

const ADDRESS_NAME_FIELDS = Object.freeze(['firstName', 'lastName']);
const ADDRESS_PHONE_FIELDS = Object.freeze(['phone']);
const ADDRESS_FIELDS = Object.freeze(['address1', 'address2', 'zip', 'latitude', 'longitude']);
const ADDRESS_UNPROTECTED_FIELDS = Object.freeze(['id', 'company', 'city', 'province', 'provinceCode', 'country', 'countryCodeV2']);

function prefixed(containers, fields) {
  return containers.flatMap((container) => fields.map((field) => `${container}.${field}`));
}

const CUSTOMER_ADDRESSES = Object.freeze(['defaultAddress', 'addresses']);
const ORDER_ADDRESSES = Object.freeze([
  'billingAddress',
  'shippingAddress',
  'customer.defaultAddress',
  'customer.addresses',
]);

const PROTECTED_FIELDS = Object.freeze({
  customers: Object.freeze({
    name: Object.freeze(['firstName', 'lastName', ...prefixed(CUSTOMER_ADDRESSES, ADDRESS_NAME_FIELDS)]),
    email: Object.freeze(['email', 'defaultEmailAddress.emailAddress']),
    phone: Object.freeze(['phone', 'defaultPhoneNumber.phoneNumber', ...prefixed(CUSTOMER_ADDRESSES, ADDRESS_PHONE_FIELDS)]),
    address: Object.freeze(prefixed(CUSTOMER_ADDRESSES, ADDRESS_FIELDS)),
  }),
  orders: Object.freeze({
    name: Object.freeze(['customer.firstName', 'customer.lastName', ...prefixed(ORDER_ADDRESSES, ADDRESS_NAME_FIELDS)]),
    email: Object.freeze(['email', 'customer.email', 'customer.defaultEmailAddress.emailAddress']),
    phone: Object.freeze(['phone', 'customer.phone', 'customer.defaultPhoneNumber.phoneNumber', ...prefixed(ORDER_ADDRESSES, ADDRESS_PHONE_FIELDS)]),
    address: Object.freeze(prefixed(ORDER_ADDRESSES, ADDRESS_FIELDS)),
  }),
});

const COMPOSITE_FIELDS = Object.freeze([
  'displayName',
  'defaultAddress.name',
  'defaultAddress.formatted',
  'defaultAddress.formattedArea',
  'addresses.name',
  'addresses.formatted',
  'addresses.formattedArea',
  'billingAddress.name',
  'billingAddress.formatted',
  'billingAddress.formattedArea',
  'shippingAddress.name',
  'shippingAddress.formatted',
  'shippingAddress.formattedArea',
  'customer.displayName',
]);

// Filled explicitly from the four committed bulk queries. The contract test compares the
// parsed leaf set with this list plus PROTECTED_FIELDS, so adding a query field requires a
// classification decision rather than silently becoming unprotected.
const UNPROTECTED_FIELDS = Object.freeze({
  customers: Object.freeze([
    'addresses.city', 'addresses.company', 'addresses.country', 'addresses.countryCodeV2',
    'addresses.id', 'addresses.province', 'addresses.provinceCode', 'createdAt',
    'defaultAddress.city', 'defaultAddress.company', 'defaultAddress.country',
    'defaultAddress.countryCodeV2', 'defaultAddress.id', 'defaultAddress.province',
    'defaultAddress.provinceCode', 'defaultEmailAddress.marketingOptInLevel',
    'defaultEmailAddress.marketingState', 'defaultEmailAddress.marketingUpdatedAt',
    'defaultPhoneNumber.marketingOptInLevel', 'defaultPhoneNumber.marketingState',
    'defaultPhoneNumber.marketingUpdatedAt', 'emailMarketingConsent.consentUpdatedAt',
    'emailMarketingConsent.marketingOptInLevel', 'emailMarketingConsent.marketingState', 'id',
    'locale', 'metafields.__typename', 'metafields.id', 'metafields.key',
    'metafields.namespace', 'metafields.type', 'metafields.value', 'note', 'numberOfOrders',
    'smsMarketingConsent.consentUpdatedAt', 'smsMarketingConsent.marketingOptInLevel',
    'smsMarketingConsent.marketingState', 'state', 'tags', 'taxExempt', 'updatedAt',
    'verifiedEmail',
  ]),
  orders: Object.freeze([
    'billingAddress.city', 'billingAddress.company', 'billingAddress.country',
    'billingAddress.countryCodeV2', 'billingAddress.province', 'billingAddress.provinceCode',
    'cancelReason', 'cancelledAt', 'closedAt', 'confirmed', 'createdAt', 'currencyCode',
    'customer.id', 'customerLocale', 'discountApplications.__typename',
    'discountApplications.allocationMethod', 'discountApplications.code',
    'discountApplications.description', 'discountApplications.targetSelection',
    'discountApplications.targetType', 'discountApplications.title',
    'discountApplications.value.__typename', 'discountApplications.value.amount',
    'discountApplications.value.currencyCode', 'discountApplications.value.percentage',
    'discountCodes', 'displayFinancialStatus', 'displayFulfillmentStatus',
    'fulfillments.createdAt', 'fulfillments.deliveredAt', 'fulfillments.displayStatus',
    'fulfillments.estimatedDeliveryAt', 'fulfillments.fulfillmentLineItems.__typename',
    'fulfillments.fulfillmentLineItems.id', 'fulfillments.fulfillmentLineItems.lineItem.id',
    'fulfillments.fulfillmentLineItems.quantity', 'fulfillments.id',
    'fulfillments.inTransitAt', 'fulfillments.location.id', 'fulfillments.name',
    'fulfillments.status', 'fulfillments.totalQuantity', 'fulfillments.trackingInfo.company',
    'fulfillments.trackingInfo.number', 'fulfillments.trackingInfo.url',
    'fulfillments.updatedAt', 'id', 'lineItems.__typename',
    'lineItems.discountedUnitPriceSet.presentmentMoney.amount',
    'lineItems.discountedUnitPriceSet.presentmentMoney.currencyCode',
    'lineItems.discountedUnitPriceSet.shopMoney.amount',
    'lineItems.discountedUnitPriceSet.shopMoney.currencyCode', 'lineItems.id',
    'lineItems.isGiftCard', 'lineItems.originalUnitPriceSet.presentmentMoney.amount',
    'lineItems.originalUnitPriceSet.presentmentMoney.currencyCode',
    'lineItems.originalUnitPriceSet.shopMoney.amount',
    'lineItems.originalUnitPriceSet.shopMoney.currencyCode', 'lineItems.product.id',
    'lineItems.quantity', 'lineItems.requiresShipping', 'lineItems.sku',
    'lineItems.taxLines.priceSet.shopMoney.amount',
    'lineItems.taxLines.priceSet.shopMoney.currencyCode', 'lineItems.taxLines.rate',
    'lineItems.taxLines.title', 'lineItems.taxable', 'lineItems.title',
    'lineItems.totalDiscountSet.presentmentMoney.amount',
    'lineItems.totalDiscountSet.presentmentMoney.currencyCode',
    'lineItems.totalDiscountSet.shopMoney.amount',
    'lineItems.totalDiscountSet.shopMoney.currencyCode', 'lineItems.variant.id',
    'lineItems.variantTitle', 'lineItems.vendor', 'metafields.__typename', 'metafields.id',
    'metafields.key', 'metafields.namespace', 'metafields.type', 'metafields.value', 'name',
    'note', 'number', 'paymentGatewayNames', 'presentmentCurrencyCode', 'processedAt',
    'refunds.createdAt', 'refunds.id', 'refunds.note', 'refunds.processedAt',
    'refunds.refundLineItems.__typename', 'refunds.refundLineItems.id',
    'refunds.refundLineItems.lineItem.id',
    'refunds.refundLineItems.priceSet.presentmentMoney.amount',
    'refunds.refundLineItems.priceSet.presentmentMoney.currencyCode',
    'refunds.refundLineItems.priceSet.shopMoney.amount',
    'refunds.refundLineItems.priceSet.shopMoney.currencyCode',
    'refunds.refundLineItems.quantity', 'refunds.refundLineItems.restockType',
    'refunds.refundLineItems.restocked',
    'refunds.refundLineItems.subtotalSet.presentmentMoney.amount',
    'refunds.refundLineItems.subtotalSet.presentmentMoney.currencyCode',
    'refunds.refundLineItems.subtotalSet.shopMoney.amount',
    'refunds.refundLineItems.subtotalSet.shopMoney.currencyCode',
    'refunds.refundLineItems.totalTaxSet.presentmentMoney.amount',
    'refunds.refundLineItems.totalTaxSet.presentmentMoney.currencyCode',
    'refunds.refundLineItems.totalTaxSet.shopMoney.amount',
    'refunds.refundLineItems.totalTaxSet.shopMoney.currencyCode',
    'refunds.totalRefundedSet.presentmentMoney.amount',
    'refunds.totalRefundedSet.presentmentMoney.currencyCode',
    'refunds.totalRefundedSet.shopMoney.amount',
    'refunds.totalRefundedSet.shopMoney.currencyCode', 'refunds.transactions.__typename',
    'refunds.transactions.amountSet.presentmentMoney.amount',
    'refunds.transactions.amountSet.presentmentMoney.currencyCode',
    'refunds.transactions.amountSet.shopMoney.amount',
    'refunds.transactions.amountSet.shopMoney.currencyCode', 'refunds.transactions.gateway',
    'refunds.transactions.id', 'refunds.transactions.kind',
    'refunds.transactions.processedAt', 'refunds.transactions.status', 'refunds.updatedAt',
    'shippingAddress.city', 'shippingAddress.company', 'shippingAddress.country',
    'shippingAddress.countryCodeV2', 'shippingAddress.province',
    'shippingAddress.provinceCode', 'shippingLines.__typename', 'shippingLines.code',
    'shippingLines.discountedPriceSet.presentmentMoney.amount',
    'shippingLines.discountedPriceSet.presentmentMoney.currencyCode',
    'shippingLines.discountedPriceSet.shopMoney.amount',
    'shippingLines.discountedPriceSet.shopMoney.currencyCode', 'shippingLines.id',
    'shippingLines.originalPriceSet.presentmentMoney.amount',
    'shippingLines.originalPriceSet.presentmentMoney.currencyCode',
    'shippingLines.originalPriceSet.shopMoney.amount',
    'shippingLines.originalPriceSet.shopMoney.currencyCode', 'shippingLines.source',
    'shippingLines.taxLines.priceSet.shopMoney.amount',
    'shippingLines.taxLines.priceSet.shopMoney.currencyCode', 'shippingLines.taxLines.rate',
    'shippingLines.taxLines.title', 'shippingLines.title', 'sourceName',
    'subtotalPriceSet.presentmentMoney.amount', 'subtotalPriceSet.presentmentMoney.currencyCode',
    'subtotalPriceSet.shopMoney.amount', 'subtotalPriceSet.shopMoney.currencyCode', 'tags',
    'taxLines.priceSet.shopMoney.amount', 'taxLines.priceSet.shopMoney.currencyCode',
    'taxLines.rate', 'taxLines.title', 'test', 'totalDiscountsSet.presentmentMoney.amount',
    'totalDiscountsSet.presentmentMoney.currencyCode', 'totalDiscountsSet.shopMoney.amount',
    'totalDiscountsSet.shopMoney.currencyCode', 'totalPriceSet.presentmentMoney.amount',
    'totalPriceSet.presentmentMoney.currencyCode', 'totalPriceSet.shopMoney.amount',
    'totalPriceSet.shopMoney.currencyCode', 'totalRefundedSet.presentmentMoney.amount',
    'totalRefundedSet.presentmentMoney.currencyCode', 'totalRefundedSet.shopMoney.amount',
    'totalRefundedSet.shopMoney.currencyCode',
    'totalShippingPriceSet.presentmentMoney.amount',
    'totalShippingPriceSet.presentmentMoney.currencyCode',
    'totalShippingPriceSet.shopMoney.amount', 'totalShippingPriceSet.shopMoney.currencyCode',
    'totalTaxSet.presentmentMoney.amount', 'totalTaxSet.presentmentMoney.currencyCode',
    'totalTaxSet.shopMoney.amount', 'totalTaxSet.shopMoney.currencyCode', 'updatedAt',
  ]),
});

function singular(entity) {
  if (entity === 'customers') return 'customer';
  if (entity === 'orders') return 'order';
  throw new Error(`protected fields do not apply to ${entity}`);
}

function entityForQuery(name) {
  if (name === 'customers') return 'customers';
  if (String(name).startsWith('orders-')) return 'orders';
  return null;
}

function probeKey(entity, kind) {
  return `${entity}:${kind}`;
}

function probeQueryFile(entity, kind) {
  return path.join(PROBE_QUERIES_DIR, `probe-${entity}-${kind}.graphql`);
}

function probeQuery(entity, kind) {
  if (!ENTITIES.includes(entity) || !KINDS.includes(kind)) throw new Error(`unknown protected-field probe ${entity}/${kind}`);
  return fs.readFileSync(probeQueryFile(entity, kind), 'utf8');
}

// ---------------------------------------------------------------------------------------------
// Small GraphQL selection parser: projection and the closed-field contract
// ---------------------------------------------------------------------------------------------

function tokenizeGraphQL(text) {
  return (String(text).replace(/#[^\n]*/g, ' ').match(/\.\.\.|[_A-Za-z][_0-9A-Za-z]*|-?\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|[$!(){}[\]:,@=]/g) || []);
}

function parseGraphQL(text) {
  const tokens = tokenizeGraphQL(text);
  const rootAt = tokens.indexOf('{');
  if (rootAt === -1) throw new Error('GraphQL document has no selection set');

  function balanced(i, open, close) {
    let depth = 0;
    const out = [];
    for (; i < tokens.length; i += 1) {
      const token = tokens[i];
      out.push(token);
      if (token === open) depth += 1;
      if (token === close) {
        depth -= 1;
        if (depth === 0) return { tokens: out, next: i + 1 };
      }
    }
    throw new Error(`unterminated GraphQL ${open}`);
  }

  function selectionSet(i) {
    if (tokens[i] !== '{') throw new Error('selection set must start with {');
    const nodes = [];
    i += 1;
    while (i < tokens.length && tokens[i] !== '}') {
      if (tokens[i] === '...') {
        const head = ['...'];
        i += 1;
        while (i < tokens.length && tokens[i] !== '{' && tokens[i] !== '}') {
          head.push(tokens[i]);
          i += 1;
        }
        const child = tokens[i] === '{' ? selectionSet(i) : null;
        if (child) i = child.next;
        nodes.push({ kind: 'fragment', head, children: child ? child.nodes : [] });
        continue;
      }
      const head = [];
      let name = tokens[i];
      head.push(tokens[i]);
      i += 1;
      if (tokens[i] === ':') {
        head.push(':', tokens[i + 1]);
        name = tokens[i + 1];
        i += 2;
      }
      if (tokens[i] === '(') {
        const args = balanced(i, '(', ')');
        head.push(...args.tokens);
        i = args.next;
      }
      while (tokens[i] === '@') {
        head.push('@', tokens[i + 1]);
        i += 2;
        if (tokens[i] === '(') {
          const directive = balanced(i, '(', ')');
          head.push(...directive.tokens);
          i = directive.next;
        }
      }
      let children = null;
      if (tokens[i] === '{') {
        const child = selectionSet(i);
        children = child.nodes;
        i = child.next;
      }
      nodes.push({ kind: 'field', name, head, children });
    }
    if (tokens[i] !== '}') throw new Error('unterminated GraphQL selection set');
    return { nodes, next: i + 1 };
  }

  const parsed = selectionSet(rootAt);
  return { preamble: tokens.slice(0, rootAt), nodes: parsed.nodes };
}

function printGraphQL(document) {
  function printNodes(nodes) {
    return nodes.map((node) => `${node.head.join(' ')}${node.children ? ` { ${printNodes(node.children)} }` : ''}`).join(' ');
  }
  return `${document.preamble.length ? `${document.preamble.join(' ')} ` : ''}{ ${printNodes(document.nodes)} }\n`;
}

function logicalPath(pathParts) {
  const stripped = pathParts.filter((part, index) => {
    if (index === 0 && ENTITIES.includes(part)) return false;
    return part !== 'edges' && part !== 'node' && !/^\d+$/.test(String(part));
  });
  return stripped.join('.');
}

function selectedLeafPaths(queryText, entity) {
  const document = parseGraphQL(queryText);
  const leaves = [];
  function walk(nodes, parts) {
    for (const node of nodes) {
      if (node.kind === 'fragment') { walk(node.children, parts); continue; }
      const next = [...parts, node.name];
      if (node.children) walk(node.children, next);
      else leaves.push(logicalPath(next));
    }
  }
  walk(document.nodes, []);
  return [...new Set(leaves.filter(Boolean))].sort();
}

function projectQuery(queryText, entity, withheldKinds = []) {
  if (!ENTITIES.includes(entity)) return String(queryText);
  const remove = new Set(withheldKinds.flatMap((kind) => PROTECTED_FIELDS[entity][kind] || []));
  if (!remove.size) return String(queryText);
  const document = parseGraphQL(queryText);
  function filter(nodes, parts) {
    const out = [];
    for (const node of nodes) {
      if (node.kind === 'fragment') {
        const children = filter(node.children, parts);
        if (children.length) out.push({ ...node, children });
        continue;
      }
      const next = [...parts, node.name];
      if (node.children) {
        const children = filter(node.children, next);
        if (children.length) out.push({ ...node, children });
      } else if (!remove.has(logicalPath(next))) {
        out.push(node);
      }
    }
    return out;
  }
  return printGraphQL({ ...document, nodes: filter(document.nodes, []) });
}

// ---------------------------------------------------------------------------------------------
// Probe records and coverage rows
// ---------------------------------------------------------------------------------------------

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function emptyProbeState() {
  return {
    schemaVersion: PROBE_SCHEMA_VERSION,
    probes: {},
    diagnostics: {},
    reapproved: {},
    withheld: { customers: [], orders: [] },
    projection: { customers: [], orders: [] },
  };
}

function normalizeProbeState(value) {
  if (!value || value.schemaVersion !== PROBE_SCHEMA_VERSION) return emptyProbeState();
  return {
    ...emptyProbeState(),
    ...value,
    probes: value.probes && typeof value.probes === 'object' ? value.probes : {},
    diagnostics: value.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics : {},
    reapproved: value.reapproved && typeof value.reapproved === 'object' ? value.reapproved : {},
    withheld: {
      customers: [...new Set((value.withheld && value.withheld.customers) || [])].filter((kind) => KINDS.includes(kind)).sort(),
      orders: [...new Set((value.withheld && value.withheld.orders) || [])].filter((kind) => KINDS.includes(kind)).sort(),
    },
    projection: {
      customers: [...new Set((value.projection && value.projection.customers) || [])].filter((kind) => KINDS.includes(kind)).sort(),
      orders: [...new Set((value.projection && value.projection.orders) || [])].filter((kind) => KINDS.includes(kind)).sort(),
    },
  };
}

async function readProbeState(projectDir) {
  return normalizeProbeState(await readJson(path.join(projectDir, KIND_PROBES_FILE), null));
}

async function writeProbeState(projectDir, state) {
  state.withheld.customers.sort();
  state.withheld.orders.sort();
  state.projection = { customers: [...state.withheld.customers], orders: [...state.withheld.orders] };
  await writeJsonAtomic(path.join(projectDir, KIND_PROBES_FILE), state);
}

function errorRecord(error) {
  return {
    code: error && error.extensions && error.extensions.code ? String(error.extensions.code) : String((error && error.code) || 'GRAPHQL_ERROR'),
    ...(Array.isArray(error && error.path) ? { path: error.path.map((part) => typeof part === 'number' ? part : String(part)) } : {}),
  };
}

function classifyProbe(entity, kind, errors = []) {
  const allowed = new Set(PROTECTED_FIELDS[entity][kind]);
  const records = errors.map(errorRecord);
  const matchedPaths = [...new Set(records
    .filter((error) => Array.isArray(error.path))
    .map((error) => logicalPath(error.path))
    .filter((field) => allowed.has(field)))].sort();
  return {
    entity,
    kind,
    outcome: matchedPaths.length ? 'withheld' : (records.length ? 'unattributed' : 'readable'),
    matchedPaths,
    errorCodes: [...new Set(records.map((error) => error.code))],
    ...(records.length ? { errors: records } : {}),
  };
}

function isPathlessAccessDenied(errors) {
  return errors.some((error) => error.code === 'source_auth_expired'
    || (error.code === 'ACCESS_DENIED' && !Array.isArray(error.path)));
}

async function checkSession(sessionCheck) {
  if (typeof sessionCheck !== 'function') return { ok: true };
  try {
    const result = await sessionCheck();
    return result && result.ok === false ? result : { ok: true };
  } catch (error) {
    return { ok: false, error: errorRecord(error) };
  }
}

async function executeProbe({ entity, kind, execute, sessionCheck, reapproved = false, markReapproved }) {
  let errors = [];
  try {
    const result = await execute(probeQuery(entity, kind), { first: 3 });
    errors = Array.isArray(result && result.errors) ? result.errors : [];
  } catch (error) {
    if (!(error instanceof ShopifyCliError)) throw error;
    errors = [error];
  }
  const records = errors.map(errorRecord);
  if (isPathlessAccessDenied(records)) {
    const checked = await checkSession(sessionCheck);
    if (!checked.ok && !reapproved) {
      await markReapproved();
      throw new ShopifyCliError('the Shopify connection failed while attributing protected customer data; re-approve it, then run the same step again', { code: 'source_auth_expired', errors: records });
    }
  }
  return classifyProbe(entity, kind, records);
}

function protectedCoverageRow(entity, kind, probe, { artifact = KIND_PROBES_FILE, pointerPrefix = 'probes' } = {}) {
  const sourceEntity = `${singular(entity)}-${kind}`;
  const removed = PROTECTED_FIELDS[entity][kind];
  return {
    coverageId: `shopify:${sourceEntity}`,
    platform: 'shopify',
    capability: entity === 'customers' ? 'crm.contact' : 'commerce.orders',
    sourceEntity,
    routes: [entity],
    reason: 'auth-gated',
    evidence: {
      artifact,
      pointer: `${pointerPrefix}; matched=${probe.matchedPaths.join(',')}; projection removes=${removed.join(',')}`,
    },
    recoverability: 'requires-development',
    disposition: null,
  };
}

function captureFailedRow(entity, errors, pointer, {
  artifact = KIND_PROBES_FILE,
  recoveryAction = `Fix the Shopify read of ${entity}, then run Shopify discovery with --reread ${entity}.`,
} = {}) {
  return {
    coverageId: `shopify:${entity}`,
    platform: 'shopify',
    capability: entity === 'customers' ? 'crm.contact' : 'commerce.orders',
    sourceEntity: entity,
    routes: [entity],
    reason: 'capture-failed',
    evidence: { artifact, pointer: `${pointer}; errors=${JSON.stringify(errors)}` },
    recoverability: 'import-operator',
    recoveryAction,
    disposition: null,
  };
}

function rowsForDiscoveryState(state) {
  const rows = [];
  for (const entity of ENTITIES) {
    const unattributed = [];
    for (const kind of KINDS) {
      const probe = state.probes[probeKey(entity, kind)];
      if (!probe) continue;
      if (probe.outcome === 'withheld') rows.push(protectedCoverageRow(entity, kind, probe, { pointerPrefix: `probes.${probeKey(entity, kind)}` }));
      else if (probe.outcome === 'unattributed') unattributed.push({ kind, errors: probe.errors || [] });
    }
    if (unattributed.length) rows.push(captureFailedRow(entity, unattributed, `unattributed probes for ${entity}`));
  }
  return rows;
}

async function runDiscoveryProbes(ctx) {
  const state = await readProbeState(ctx.projectDir);
  for (const entity of ENTITIES) {
    for (const kind of KINDS) {
      const key = probeKey(entity, kind);
      if (state.probes[key]) continue;
      const probe = await executeProbe({
        entity,
        kind,
        execute: ctx.execute,
        sessionCheck: ctx.sessionCheck,
        reapproved: state.reapproved[key] === true,
        markReapproved: async () => {
          state.reapproved[key] = true;
          await writeProbeState(ctx.projectDir, state);
        },
      });
      state.probes[key] = probe;
      if (probe.outcome === 'withheld' && !state.withheld[entity].includes(kind)) state.withheld[entity].push(kind);
      await writeProbeState(ctx.projectDir, state);
    }
  }
  await writeProbeState(ctx.projectDir, state);
  return { file: path.relative('data/shopify-discovery', KIND_PROBES_FILE), projection: state.projection, rows: rowsForDiscoveryState(state) };
}

async function resetProbeEntities(projectDir, entities) {
  const relevant = entities.filter((entity) => ENTITIES.includes(entity));
  if (!relevant.length) return false;
  const state = await readProbeState(projectDir);
  for (const entity of relevant) {
    for (const kind of KINDS) {
      delete state.probes[probeKey(entity, kind)];
      delete state.reapproved[probeKey(entity, kind)];
    }
    state.withheld[entity] = [];
  }
  state.diagnostics = {};
  await writeProbeState(projectDir, state);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Extract denial handler and denied reset
// ---------------------------------------------------------------------------------------------

async function denialHandler({ name, entity, entry, projectDir, execute }, { sessionCheck, checkpoint = null } = {}) {
  const protectedEntity = entityForQuery(name) || entity;
  if (!ENTITIES.includes(protectedEntity)) throw new Error(`protected denial handler received ${name}`);
  const state = await readProbeState(projectDir);
  const diagnosticKey = `${name}@${entry.settlingAt}`;
  if (!state.diagnostics[diagnosticKey]) {
    state.diagnostics[diagnosticKey] = {
      query: name,
      entity: protectedEntity,
      settlingAt: entry.settlingAt,
      withheldBefore: [...state.withheld[protectedEntity]],
      probes: {},
      reapproved: {},
    };
    await writeProbeState(projectDir, state);
  }
  const diagnostic = state.diagnostics[diagnosticKey];
  for (const kind of KINDS) {
    if (diagnostic.probes[kind]) continue;
    diagnostic.probes[kind] = await executeProbe({
      entity: protectedEntity,
      kind,
      execute,
      sessionCheck,
      reapproved: diagnostic.reapproved[kind] === true,
      markReapproved: async () => {
        diagnostic.reapproved[kind] = true;
        await writeProbeState(projectDir, state);
      },
    });
    await writeProbeState(projectDir, state);
    // The runner's crash matrix injects failures only after the durable probe write.
    if (typeof checkpoint === 'function') await checkpoint('after-probe', { kind, recorded: Object.keys(diagnostic.probes).length });
  }

  const withheldBefore = Array.isArray(diagnostic.withheldBefore) ? diagnostic.withheldBefore : [];
  const hasUnattributed = KINDS.some((kind) => diagnostic.probes[kind].outcome === 'unattributed');
  const newlyWithheld = KINDS.filter((kind) => diagnostic.probes[kind].outcome === 'withheld' && !withheldBefore.includes(kind));
  if (!hasUnattributed && newlyWithheld.length) {
    state.withheld[protectedEntity] = [...new Set([...state.withheld[protectedEntity], ...newlyWithheld])].sort();
    await writeProbeState(projectDir, state);
    const rows = newlyWithheld.map((kind) => protectedCoverageRow(protectedEntity, kind, diagnostic.probes[kind], { pointerPrefix: `diagnostics.${diagnosticKey}.${kind}` }));
    await upsertAdapterCoverageRows(projectDir, { adapter: 'shopify', rows, checkpoint });
    const coverageIds = rows.map((row) => row.coverageId);
    return {
      handlerOutcome: { attribution: 'withheld', kinds: newlyWithheld, coverageIds },
      stop: {
        code: 'shopify_protected_fields_withheld',
        message: `Shopify withheld ${newlyWithheld.join(', ')} from ${protectedEntity}; ${coverageIds.join(', ')} was recorded for a mapping decision.`,
      },
    };
  }

  const bulkError = entry.error || { message: 'Shopify denied the bulk export' };
  const row = captureFailedRow(protectedEntity, bulkError, `diagnostics.${diagnosticKey}; bulk=${JSON.stringify(bulkError)}`, {
    artifact: EXTRACT_MANIFEST_FILE,
    recoveryAction: `Fix the cause of the ${name} denial, then run shopify-extract.js --retry-failed.`,
  });
  await upsertAdapterCoverageRows(projectDir, { adapter: 'shopify', rows: [row], checkpoint });
  return {
    handlerOutcome: { attribution: 'unattributed', coverageId: row.coverageId },
    stop: { code: 'shopify_bulk_failed', message: `Shopify denied ${name}, but its four protected-field probes did not attribute the refusal. The projection was not narrowed.` },
  };
}

async function deniedReset({ manifest, projectDir }) {
  const state = await readProbeState(projectDir);
  const resets = [];
  for (const name of manifest.order || []) {
    const target = manifest.queries && manifest.queries[name];
    if (!target || target.state !== 'denied' || !target.handlerOutcome || target.handlerOutcome.attribution !== 'withheld') continue;
    const entity = entityForQuery(name);
    const kinds = target.handlerOutcome.kinds || [];
    if (!entity || !kinds.length || !kinds.every((kind) => state.withheld[entity].includes(kind))) continue;
    resets.push({ name, text: projectQuery(target.text, entity, state.withheld[entity]) });
  }
  return resets;
}

// ---------------------------------------------------------------------------------------------
// Hollow customer recheck
// ---------------------------------------------------------------------------------------------

function valuesAt(value, parts) {
  if (!parts.length) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, parts));
  if (!value || typeof value !== 'object') return [];
  return valuesAt(value[parts[0]], parts.slice(1));
}

function hasValue(record, field) {
  return valuesAt(record, field.split('.')).some((value) => value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== ''));
}

function isHollowCustomer(record, withheldKinds) {
  const withheldIdentity = ['name', 'email', 'phone'].filter((kind) => withheldKinds.includes(kind));
  if (!withheldIdentity.length) return false;
  const readable = ['name', 'email', 'phone'].filter((kind) => !withheldKinds.includes(kind));
  return !readable.some((kind) => PROTECTED_FIELDS.customers[kind].some((field) => hasValue(record, field)));
}

async function* recheckCustomers(records, projection) {
  const withheldKinds = Array.isArray(projection) ? projection : ((projection && projection.customers) || []);
  for await (const record of records) {
    if (isHollowCustomer(record, withheldKinds)) {
      if (!record || typeof record.id !== 'string' || !record.id) throw new Error('a hollow Shopify customer has no id');
      yield { kind: 'hollow', record: { id: record.id } };
    }
    else yield { kind: 'keep', record };
  }
}

async function coverageRowDispositioned(projectDir, coverageId) {
  const result = await reconcileProject(projectDir);
  return result.resolved.some((item) => item.row.coverageId === coverageId);
}

async function writeLine(stream, value) {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await new Promise((resolve) => stream.once('drain', resolve));
}

async function copyFileAtomic(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.copyFile(source, temp);
    await fsp.rename(temp, destination);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
}

async function customerRecheckHook({ records, projectDir, stagingDir }) {
  const state = await readProbeState(projectDir);
  const stamp = `${process.pid}.${Date.now()}`;
  const keptFile = path.join(stagingDir, `customers.rechecked.${stamp}.tmp`);
  const hollowFile = path.join(stagingDir, `customers-withheld-identity.${stamp}.tmp`);
  await fsp.mkdir(stagingDir, { recursive: true });
  const kept = fs.createWriteStream(keptFile, { encoding: 'utf8' });
  const hollow = fs.createWriteStream(hollowFile, { encoding: 'utf8' });
  let keptCount = 0;
  let hollowCount = 0;
  try {
    for await (const result of recheckCustomers(records, state.withheld)) {
      if (result.kind === 'keep') { await writeLine(kept, result.record); keptCount += 1; }
      else { await writeLine(hollow, result.record); hollowCount += 1; }
    }
    kept.end();
    hollow.end();
    await Promise.all([finished(kept), finished(hollow)]);
  } catch (error) {
    kept.destroy();
    hollow.destroy();
    await Promise.all([fsp.rm(keptFile, { force: true }), fsp.rm(hollowFile, { force: true })]);
    throw error;
  }

  const result = {
    ok: true,
    recordsFile: keptFile,
    recordCount: keptCount,
    sidecarFiles: hollowCount ? { 'customers-withheld-identity': hollowFile } : {},
    manifest: { withheldIdentityCount: hollowCount },
  };
  if (!hollowCount) {
    await fsp.rm(hollowFile, { force: true });
    return result;
  }

  // The coverage row points at this sidecar while the extract is stopped for mapping, before the
  // runner's final join. Keep the staged copy too; it becomes the current complete extract's
  // sidecar after mapping resumes.
  await copyFileAtomic(hollowFile, path.join(projectDir, 'data/source-extract/customers-withheld-identity.ndjson'));

  const coverageId = 'shopify:customers-withheld-identity';
  const row = {
    coverageId,
    platform: 'shopify',
    capability: 'crm.contact',
    sourceEntity: 'customers-withheld-identity',
    routes: ['customers'],
    reason: 'auth-gated',
    evidence: { artifact: EXTRACT_MANIFEST_FILE, pointer: `withheldIdentityCount=${hollowCount}; ids=data/source-extract/customers-withheld-identity.ndjson` },
    recoverability: 'requires-development',
    disposition: null,
  };
  await upsertAdapterCoverageRows(projectDir, { adapter: 'shopify', rows: [row] });
  if (!(await coverageRowDispositioned(projectDir, coverageId))) {
    result.stop = {
      code: 'shopify_protected_fields_withheld',
      message: `Shopify extract held back ${hollowCount} customer(s) with no readable identity; ${coverageId} was recorded for a mapping decision.`,
      details: { coverageId, withheldIdentityCount: hollowCount },
    };
  }
  return result;
}

function createBulkOptions({ projectDir, sessionCheck, probeState }) {
  const initial = normalizeProbeState(probeState);
  return {
    project: (name, text) => {
      const entity = entityForQuery(name);
      return entity ? projectQuery(text, entity, initial.withheld[entity]) : text;
    },
    handlers: {
      denied: (context) => denialHandler(context, { sessionCheck }),
      reassemble: { customers: customerRecheckHook },
    },
    deniedReset,
  };
}

// ---------------------------------------------------------------------------------------------
// Withheld export attestation and completion-report action
// ---------------------------------------------------------------------------------------------

function isWithheldCoverageId(coverageId) {
  return /^shopify:(?:customer|order)-(?:name|email|phone|address)$/.test(String(coverageId))
    || coverageId === 'shopify:customers-withheld-identity';
}

function latestReadAt(manifest) {
  const times = [];
  for (const entry of Object.values((manifest && manifest.queries) || {})) {
    for (const value of Object.values((entry && entry.readAt) || {})) {
      if (typeof value === 'string' && Number.isFinite(Date.parse(value))) times.push(value);
    }
  }
  times.sort((a, b) => Date.parse(a) - Date.parse(b));
  return times[times.length - 1] || null;
}

function validWithheldConfirmation(value) {
  return Boolean(value
    && value.schemaVersion === WITHHELD_EXPORT_SCHEMA_VERSION
    && value.confirmation === WITHHELD_EXPORT_CONFIRMATION
    && typeof value.confirmedAt === 'string'
    && Number.isFinite(Date.parse(value.confirmedAt))
    && typeof value.afterReadAt === 'string'
    && Number.isFinite(Date.parse(value.afterReadAt))
    && Array.isArray(value.coverageIds)
    && value.coverageIds.every(isWithheldCoverageId));
}

async function confirmWithheldExport(projectDir, confirmation, { now = () => new Date().toISOString() } = {}) {
  if (confirmation !== WITHHELD_EXPORT_CONFIRMATION) throw new Error(`confirmation must be ${WITHHELD_EXPORT_CONFIRMATION}`);
  const coverage = await readJson(path.join(projectDir, SOURCE_COVERAGE_FILE), null);
  const coverageIds = coverage && Array.isArray(coverage.rows)
    ? coverage.rows.map((row) => row.coverageId).filter(isWithheldCoverageId).sort()
    : [];
  if (!coverageIds.length) throw new Error('no withheld Shopify detail coverage row exists; nothing was confirmed');
  const manifest = await readJson(path.join(projectDir, EXTRACT_MANIFEST_FILE), null);
  if (!manifest || manifest.status !== 'complete') throw new Error('the current Shopify extract manifest is not complete; confirm the export only after the final read');
  const afterReadAt = latestReadAt(manifest);
  if (!afterReadAt) throw new Error('the complete Shopify extract manifest has no readAt timestamp');
  const file = path.join(projectDir, WITHHELD_EXPORT_FILE);
  const existing = await readJson(file, undefined).catch(() => Symbol.for('unreadable'));
  if (existing === Symbol.for('unreadable') || (existing !== null && !validWithheldConfirmation(existing))) {
    await fsp.rename(file, `${file}.unreadable-${now()}`);
  }
  const record = {
    schemaVersion: WITHHELD_EXPORT_SCHEMA_VERSION,
    confirmedAt: now(),
    confirmation,
    coverageIds,
    afterReadAt,
  };
  await writeJsonAtomic(file, record);
  return record;
}

module.exports = {
  KINDS,
  ENTITIES,
  ADDRESS_FIELDS,
  ADDRESS_UNPROTECTED_FIELDS,
  PROTECTED_FIELDS,
  UNPROTECTED_FIELDS,
  COMPOSITE_FIELDS,
  KIND_PROBES_FILE,
  WITHHELD_EXPORT_FILE,
  WITHHELD_EXPORT_CONFIRMATION,
  WITHHELD_EXPORT_CODE,
  probeQueryFile,
  probeQuery,
  logicalPath,
  selectedLeafPaths,
  projectQuery,
  classifyProbe,
  readProbeState,
  writeProbeState,
  protectedCoverageRow,
  captureFailedRow,
  runDiscoveryProbes,
  resetProbeEntities,
  denialHandler,
  deniedReset,
  isHollowCustomer,
  recheckCustomers,
  customerRecheckHook,
  createBulkOptions,
  isWithheldCoverageId,
  latestReadAt,
  validWithheldConfirmation,
  confirmWithheldExport,
};
