'use strict';

// The WooCommerce/WordPress full-API reader catalog (../reader-catalog.json): load, check,
// resolve defaults and order by dependency. Pure: no network, no project files.
//
// A catalog entry is data the fixed extractor runs. Only what the operator can't control is
// checked here (route shape, the payment-gateway deny rule, ids, dependencies, children and
// enrich placeholders); which entries a run reads, and its filters, come from the plan.

const fs = require('node:fs');
const path = require('node:path');
const { isDeniedGatewayRoute } = require('./wp-http.js');

const CATALOG_FILE = path.join(__dirname, '..', 'reader-catalog.json');
const PAGING_KINDS = new Set(['pages', 'none']);
const AUTH_KINDS = new Set(['store', 'wordpress']);
const RESPONSE_SHAPES = new Set(['array', 'object']);
// Query params a plan filter must never set: they belong to the fixed paging and read shape.
const RESERVED_PARAMS = new Set(['page', 'per_page', 'offset', 'context', '_embed', '_fields']);

function loadCatalog(file = CATALOG_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routeProblems(where, route, { placeholder = false } = {}) {
  const problems = [];
  if (typeof route !== 'string' || !route.startsWith('/')) problems.push(`${where}: route must start with "/"`);
  else {
    if (/^\/wp-json(\/|$)/i.test(route)) problems.push(`${where}: route must not include /wp-json (buildApiUrl adds it)`);
    if (/[?#]/.test(route)) problems.push(`${where}: route must not carry a query string; use query`);
    if (isDeniedGatewayRoute(route.replace(/\{id\}/g, '0'))) problems.push(`${where}: payment-gateway routes are never read`);
    if (placeholder && !route.includes('{id}')) problems.push(`${where}: route must contain {id} (the parent record id)`);
  }
  return problems;
}

// errors: string[]; empty when the catalog is usable. `targetExists(ref)` is optional.
function validateCatalog(catalog, { targetExists = null } = {}) {
  const errors = [];
  if (!catalog || catalog.schemaVersion !== 1) errors.push('catalog: schemaVersion must be 1');
  const entities = Array.isArray(catalog?.entities) ? catalog.entities : [];
  if (!entities.length) errors.push('catalog: entities must be a non-empty array');
  const ids = new Set();
  const allIds = new Set();
  for (const entry of entities) {
    for (const id of [entry?.id, ...(entry?.children || []).map((c) => c?.id)]) {
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) { errors.push(`entity id invalid: ${JSON.stringify(id)}`); continue; }
      if (allIds.has(id)) errors.push(`${id}: duplicate id`);
      allIds.add(id);
    }
    if (typeof entry?.id === 'string') ids.add(entry.id);
  }
  for (const entry of entities) {
    const where = entry?.id || '(no id)';
    if (entry.extractWith !== undefined && (!ids.has(entry.extractWith) || entry.extractWith === entry.id)) errors.push(`${where}: extractWith must name another catalog entity`);
    if (entry.kind === 'derived') {
      if (!ids.has(entry.from)) errors.push(`${where}: derived from unknown entity ${entry.from}`);
      if (typeof entry.deriver !== 'string') errors.push(`${where}: derived entry needs deriver`);
    } else {
      if (entry.kind !== undefined && entry.kind !== 'rest') errors.push(`${where}: unknown kind ${entry.kind}`);
      // A run's own reader module (plugin or custom route that is not a plain collection).
      if (entry.reader !== undefined && (typeof entry.reader !== 'string' || !/^src\/extract\/readers\/[A-Za-z0-9._-]+\.js$/.test(entry.reader))) errors.push(`${where}: reader must be src/extract/readers/<name>.js`);
      if (entry.reader === undefined || entry.route !== undefined) errors.push(...routeProblems(where, entry.route));
      if (entry.query !== undefined && (typeof entry.query !== 'object' || Array.isArray(entry.query) || entry.query === null)) errors.push(`${where}: query must be an object`);
      const paging = { ...catalog.defaults?.paging, ...entry.paging };
      if (!PAGING_KINDS.has(paging.kind)) errors.push(`${where}: paging.kind must be pages or none`);
      if (paging.kind === 'pages' && !(Number.isInteger(paging.perPage) && paging.perPage >= 1 && paging.perPage <= 100)) errors.push(`${where}: paging.perPage must be 1..100`);
      const auth = entry.auth || catalog.defaults?.auth;
      if (!AUTH_KINDS.has(auth)) errors.push(`${where}: auth must be store or wordpress`);
      const shape = entry.responseShape || catalog.defaults?.responseShape;
      if (!RESPONSE_SHAPES.has(shape)) errors.push(`${where}: responseShape must be array or object`);
      for (const param of entry.filterParams || []) if (RESERVED_PARAMS.has(param)) errors.push(`${where}: filterParams must not include reserved param ${param}`);
      for (const child of entry.children || []) {
        errors.push(...routeProblems(`${where}.${child.id}`, child.route, { placeholder: true }));
        if (child.when && (typeof child.when.field !== 'string' || !('equals' in child.when))) errors.push(`${where}.${child.id}: when needs field and equals`);
      }
      if (entry.hierarchy !== undefined && (typeof entry.hierarchy?.parentField !== 'string' || !entry.hierarchy.parentField)) errors.push(`${where}: hierarchy needs parentField`);
      const refd = entry.referencedRecords;
      if (refd !== undefined) {
        if (!ids.has(refd?.from)) errors.push(`${where}: referencedRecords from unknown entity ${refd?.from}`);
        for (const key of ['field', 'choice', 'readWhen']) if (typeof refd?.[key] !== 'string' || !refd[key]) errors.push(`${where}: referencedRecords needs ${key}`);
        errors.push(...routeProblems(`${where}.referencedRecords`, refd?.route, { placeholder: true }));
      }
      for (const enrich of entry.enrich || []) {
        errors.push(...routeProblems(`${where}.enrich.${enrich.field}`, enrich.route, { placeholder: true }));
        if (typeof enrich.field !== 'string' || !enrich.field) errors.push(`${where}: enrich needs field`);
      }
    }
    for (const dep of entry.dependsOn || []) if (!ids.has(dep)) errors.push(`${where}: dependsOn unknown entity ${dep}`);
    if (targetExists) {
      for (const target of [entry.target, ...(entry.children || []).map((c) => c.target)]) {
        if (target !== null && target !== undefined && !targetExists(target)) errors.push(`${where}: unknown target ${target}`);
      }
    }
  }
  try { orderEntries(entities); } catch (error) { errors.push(error.message); }
  return errors;
}

// One entry with catalog defaults applied. Never mutates the catalog.
function resolveEntry(catalog, entry) {
  if (entry.kind === 'derived') return { ...entry, dependsOn: entry.dependsOn || [entry.from] };
  const d = catalog.defaults || {};
  return {
    kind: 'rest',
    keyField: d.keyField || 'id',
    responseShape: d.responseShape || 'array',
    auth: d.auth || 'store',
    query: {},
    filterParams: [],
    dependsOn: [],
    children: [],
    enrich: [],
    optional: false,
    ...entry,
    paging: { ...d.paging, ...entry.paging },
  };
}

// Dependency order (stable: catalog order among peers). Throws on a cycle.
function orderEntries(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const done = new Set();
  const visiting = new Set();
  const out = [];
  const visit = (entry, trail) => {
    if (done.has(entry.id)) return;
    if (visiting.has(entry.id)) throw new Error(`dependency cycle: ${[...trail, entry.id].join(' -> ')}`);
    visiting.add(entry.id);
    for (const dep of entry.dependsOn || []) if (byId.has(dep)) visit(byId.get(dep), [...trail, entry.id]);
    visiting.delete(entry.id);
    done.add(entry.id);
    out.push(entry);
  };
  for (const entry of entries) visit(entry, []);
  return out;
}

module.exports = { CATALOG_FILE, RESERVED_PARAMS, loadCatalog, validateCatalog, resolveEntry, orderEntries };
