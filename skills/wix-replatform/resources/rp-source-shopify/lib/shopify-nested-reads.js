'use strict';

// A bulk query cannot hold a connection inside a list field ("Queries that contain a connection
// field within a list field are not currently supported"). Three datasets have one:
//   orders-refunds        Order.refunds[]                       -> refundLineItems, transactions
//   orders-fulfillments   Order.fulfillments[]                  -> fulfillmentLineItems
//   delivery-profiles     DeliveryProfile.profileLocationGroups[] -> locationGroupZones -> methodDefinitions
// One more is read the same way although it is not under a list field: a bundle variant's
// components (products -> variants -> productVariantComponents) sit one connection deeper than the
// products query nests, and only variants with requiresComponents true have any.
//   products              Product.variants[] (requiresComponents)  -> productVariantComponents
// Their bulk query carries everything that is not such a connection. This module is the
// `reassemble` hook that, before the dataset is marked done, reads those connections with
// ordinary read-only queries (queries/read-*.graphql) and writes them into the same rows, so the
// final file has the shape the bulk query used to promise. Nothing here sends a mutation, and a
// read that fails stops the dataset. The reads are serial and paced (READ_GAP_MS between calls),
// so a large store takes hours (see `estimateReads`); they are therefore checkpointed: every
// finished chunk of rows is kept with a marker beside it, and a rerun over the same downloaded
// rows continues after the last finished chunk instead of reading everything again.

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { finished } = require('node:stream/promises');

const QUERIES_DIR = path.join(__dirname, '..', 'queries');
const CHUNK_ROWS = 50;
const READ_GAP_MS = 250;
const MAX_PAGES = 10000;

// What a full read costs, so it can be shown to whoever approves it: one call per `batch` ids plus
// READ_GAP_MS of pause after each, before network time and before extra pages.
function estimateReads({ refunds = 0, fulfillments = 0 } = {}) {
  const calls = Math.ceil(refunds / READS.refund.batch) + Math.ceil(fulfillments / READS.fulfillment.batch);
  return { calls, pauseSeconds: Math.round((calls * READ_GAP_MS) / 1000) };
}

const READS = Object.freeze({
  refund: { file: 'read-refund-items.graphql', first: 10, batch: 4 },
  fulfillment: { file: 'read-fulfillment-items.graphql', first: 25, batch: 10 },
  zone: { file: 'read-delivery-zones.graphql', first: 25, batch: 1 },
  variantComponents: { file: 'read-variant-components.graphql', first: 25, batch: 10 },
});

const documents = new Map();
function document(kind) {
  if (!documents.has(kind)) documents.set(kind, fs.readFileSync(path.join(QUERIES_DIR, READS[kind].file), 'utf8'));
  return documents.get(kind);
}

class NestedReadFailure extends Error {
  constructor(message, evidence = {}) {
    super(message);
    this.name = 'NestedReadFailure';
    this.evidence = evidence;
  }
}

function costExceeded(errors) {
  return (errors || []).some((error) => error && error.extensions && error.extensions.code === 'MAX_COST_EXCEEDED');
}

function failure(what, errors) {
  const codes = [...new Set((errors || []).map((error) => (error && error.extensions && error.extensions.code) || 'GRAPHQL_ERROR'))];
  const messages = (errors || []).map((error) => error && error.message).filter(Boolean).join('; ').slice(0, 300);
  return new NestedReadFailure(`the ${what} read failed (${codes.join(', ')})${messages ? `: ${messages}` : ''}`, { codes });
}

async function* rowsOf(file) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  try {
    for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) if (line.length) yield JSON.parse(line);
  } finally {
    input.destroy();
  }
}

async function digestOf(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function readMarker(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeMarker(file, value) {
  const temporary = `${file}.next`;
  await fsp.writeFile(temporary, JSON.stringify(value));
  await fsp.rename(temporary, file);
}

// One call with the cost fallback: a refused cost halves the requested page size (never below 1).
async function costAware(execute, kind, variables, state) {
  for (;;) {
    const result = await execute(document(kind), { ...variables, first: state.first });
    if (result.errors && result.errors.length) {
      if (costExceeded(result.errors) && state.first > 1) { state.first = Math.max(1, Math.floor(state.first / 2)); continue; }
      throw failure(kind, result.errors);
    }
    return result.data;
  }
}

// `nodes(ids:)` reads for Refund / Fulfillment ids. `connections` names each connection and the
// variable carrying its cursor. A connection that reports another page is read to the end for
// that one id, so no record is cut at the page size.
async function readNodeConnections(ids, { kind, connections, execute, sleep }) {
  const state = { first: READS[kind].first };
  const out = new Map();
  const wanted = [...new Set(ids)];
  const take = async (batch) => {
    let data;
    try {
      data = await costAware(execute, kind, { ids: batch }, state);
    } catch (error) {
      if (error instanceof NestedReadFailure && batch.length > 1 && error.evidence.codes.includes('MAX_COST_EXCEEDED')) {
        const half = Math.ceil(batch.length / 2);
        await take(batch.slice(0, half));
        await take(batch.slice(half));
        return;
      }
      throw error;
    }
    const nodes = Array.isArray(data && data.nodes) ? data.nodes : [];
    for (const [index, id] of batch.entries()) {
      const node = nodes[index];
      if (!node || node.id !== id) throw new NestedReadFailure(`a ${kind} the bulk read listed could not be read by id`, { codes: ['NODE_MISSING'] });
      const record = {};
      for (const { field, after } of connections) {
        const connection = node[field];
        if (!connection || !Array.isArray(connection.nodes)) throw new NestedReadFailure(`the ${kind} read returned no ${field}`, { codes: ['CONNECTION_MISSING'] });
        const items = [...connection.nodes];
        let info = connection.pageInfo || {};
        for (let page = 0; info.hasNextPage && info.endCursor; page += 1) {
          if (page >= MAX_PAGES) throw new NestedReadFailure(`the ${kind} ${field} did not end after ${MAX_PAGES} pages`, { codes: ['PAGES_EXCEEDED'] });
          await sleep(READ_GAP_MS);
          const more = await costAware(execute, kind, { ids: [id], [after]: info.endCursor }, state);
          const again = more && Array.isArray(more.nodes) ? more.nodes[0] : null;
          if (!again || !again[field] || !Array.isArray(again[field].nodes)) throw new NestedReadFailure(`the ${kind} read returned no ${field} page`, { codes: ['CONNECTION_MISSING'] });
          items.push(...again[field].nodes);
          info = again[field].pageInfo || {};
        }
        record[field] = items;
      }
      out.set(id, record);
    }
  };
  for (let i = 0; i < wanted.length; i += READS[kind].batch) {
    if (i > 0) await sleep(READ_GAP_MS);
    await take(wanted.slice(i, i + READS[kind].batch));
  }
  return out;
}

const NODE_DATASETS = Object.freeze({
  'orders-refunds': { list: 'refunds', kind: 'refund', connections: [{ field: 'refundLineItems', after: 'itemsAfter' }, { field: 'transactions', after: 'transactionsAfter' }] },
  'orders-fulfillments': { list: 'fulfillments', kind: 'fulfillment', connections: [{ field: 'fulfillmentLineItems', after: 'itemsAfter' }] },
  products: { list: 'variants', kind: 'variantComponents', when: (variant) => variant.requiresComponents === true, connections: [{ field: 'productVariantComponents', after: 'componentsAfter' }] },
});

const wanted = (spec, element) => element && typeof element.id === 'string' && (!spec.when || spec.when(element));

async function enrichRows(spec, rows, context) {
  const elements = rows.flatMap((row) => (Array.isArray(row[spec.list]) ? row[spec.list] : [])).filter((element) => wanted(spec, element));
  if (!elements.length) return;
  const read = await readNodeConnections(elements.map((element) => element.id), { kind: spec.kind, connections: spec.connections, execute: context.execute, sleep: context.sleep });
  for (const element of elements) Object.assign(element, read.get(element.id));
}

// One zone at a time (`locationGroupZones(first: 1)`), its rates paged by cursor, so the requested
// cost stays small however many zones or rates a profile has.
async function readGroupZones(profileId, groupId, { execute, sleep }) {
  const state = { first: READS.zone.first };
  const zones = [];
  let zoneAfter = null;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) throw new NestedReadFailure(`the delivery zones did not end after ${MAX_PAGES} pages`, { codes: ['PAGES_EXCEEDED'] });
    let methodsAfter = null;
    let zone = null;
    let zoneInfo = {};
    for (let methodPage = 0; ; methodPage += 1) {
      if (page > 0 || methodPage > 0) await sleep(READ_GAP_MS);
      const data = await costAware(execute, 'zone', { id: profileId, group: groupId, zoneAfter, methodsAfter }, state);
      const profile = data && data.deliveryProfile;
      const group = profile && Array.isArray(profile.profileLocationGroups) ? profile.profileLocationGroups[0] : null;
      const connection = group && group.locationGroupZones;
      if (!connection || !Array.isArray(connection.nodes)) throw new NestedReadFailure('the delivery profile or its location group could not be read by id', { codes: ['NODE_MISSING'] });
      zoneInfo = connection.pageInfo || {};
      const node = connection.nodes[0];
      if (!node) return zones;
      const methods = node.methodDefinitions;
      if (!methods || !Array.isArray(methods.nodes)) throw new NestedReadFailure('the delivery zone read returned no methodDefinitions', { codes: ['CONNECTION_MISSING'] });
      if (!zone) zone = { ...node, methodDefinitions: [] };
      zone.methodDefinitions.push(...methods.nodes);
      const info = methods.pageInfo || {};
      if (!info.hasNextPage || !info.endCursor) break;
      methodsAfter = info.endCursor;
    }
    zones.push(zone);
    if (!zoneInfo.hasNextPage || !zoneInfo.endCursor) return zones;
    zoneAfter = zoneInfo.endCursor;
  }
}

async function enrichProfile(row, context) {
  for (const group of Array.isArray(row.profileLocationGroups) ? row.profileLocationGroups : []) {
    const groupId = group && group.locationGroup && group.locationGroup.id;
    if (typeof groupId !== 'string') continue;
    group.locationGroupZones = await readGroupZones(row.id, groupId, context);
  }
}

function needsRead(name, row) {
  if (name === 'delivery-profiles') return (Array.isArray(row.profileLocationGroups) ? row.profileLocationGroups : []).some((group) => group && group.locationGroup && group.locationGroup.id);
  const spec = NODE_DATASETS[name];
  return (Array.isArray(row[spec.list]) ? row[spec.list] : []).some((element) => wanted(spec, element));
}

function createNestedReadHook(name) {
  return async function nestedReadHook(context) {
    // Nothing to read (no refund, fulfillment or profile): the folded file is already final.
    let any = false;
    for await (const row of rowsOf(context.recordsFile)) {
      if (needsRead(name, row)) { any = true; break; }
    }
    if (!any) return undefined;
    // Neither name ends in .tmp or .partial, which every start deletes as a leftover.
    const dir = path.dirname(context.recordsFile);
    const output = path.join(dir, `${name}.nested-progress.ndjson`);
    const markerFile = path.join(dir, `${name}.nested-progress.json`);
    const sourceDigest = await digestOf(context.recordsFile);
    // Resume only over the same downloaded rows: the marker names them by digest, so a re-read
    // dataset (a different file) starts again, and so does a missing or short progress file.
    const marker = readMarker(markerFile);
    let skip = 0;
    let written = 0;
    if (marker && marker.version === 1 && marker.sourceDigest === sourceDigest && Number.isInteger(marker.rows) && Number.isInteger(marker.bytes)
      && fs.existsSync(output) && fs.statSync(output).size >= marker.bytes) {
      skip = marker.rows;
      written = marker.bytes;
      await fsp.truncate(output, written);
    } else {
      await fsp.rm(output, { force: true });
      await fsp.rm(markerFile, { force: true });
    }
    const out = fs.createWriteStream(output, { encoding: 'utf8', flags: skip ? 'a' : 'w' });
    let buffer = [];
    let rowsDone = skip;
    const write = (text) => new Promise((resolve, reject) => out.write(text, (error) => (error ? reject(error) : resolve())));
    const flush = async () => {
      if (!buffer.length) return;
      if (name === 'delivery-profiles') for (const row of buffer) await enrichProfile(row, context);
      else await enrichRows(NODE_DATASETS[name], buffer, context);
      const text = buffer.map((row) => `${JSON.stringify(row)}\n`).join('');
      await write(text);
      written += Buffer.byteLength(text);
      rowsDone += buffer.length;
      buffer = [];
      await writeMarker(markerFile, { version: 1, sourceDigest, rows: rowsDone, bytes: written });
    };
    try {
      let index = 0;
      for await (const row of rowsOf(context.recordsFile)) {
        if (index++ < skip) continue;
        buffer.push(row);
        if (buffer.length >= CHUNK_ROWS) await flush();
      }
      await flush();
      out.end();
      await finished(out);
    } catch (error) {
      // The finished chunks and their marker stay: a rerun over the same rows continues from them.
      out.destroy();
      if (error instanceof NestedReadFailure) {
        return { ok: false, errorCode: 'shopify_nested_read_failed', message: error.message, evidence: { ...error.evidence, rowsRead: rowsDone } };
      }
      throw error;
    }
    await fsp.rm(markerFile, { force: true });
    return { recordsFile: output };
  };
}

const NESTED_READ_QUERIES = Object.freeze(['orders-refunds', 'orders-fulfillments', 'delivery-profiles', 'products']);

function nestedReadHook(name) {
  return NESTED_READ_QUERIES.includes(name) ? createNestedReadHook(name) : null;
}

module.exports = {
  NESTED_READ_QUERIES,
  READS,
  nestedReadHook,
  estimateReads,
  readNodeConnections,
  readGroupZones,
  NestedReadFailure,
};
