'use strict';

// The sequential Shopify bulk runner. One bulk operation runs at a time, for both
// callers: the discovery census and the extract. A caller supplies its own
// manifest, staging directory, ordered query list and handlers; this module owns every state, stop
// and recovery rule, so a caller adds no runner and no recovery path of its own.
//
// Query states, one atomic manifest write per change:
//   pending -> starting -> running -> downloaded -> done
//                              \-> pending (one re-run, or an expired link)
//   running | downloaded -> settling -> failed | denied      (terminal; the handler runs in between)
// `settling` makes every terminal side effect recoverable: a query never becomes `failed` or
// `denied` directly. The runner writes `settling` with the outcome and the verbatim error, runs the
// outcome's handler, then writes the terminal state with the handler's result. On every start each
// `settling` entry's handler runs again before anything else, so every handler must be idempotent.
//
// run() resolves with { status: 'complete' | 'stopped' | 'awaiting_user_action', code?, message?,
// details?, manifest }. Anything else it throws is a crash: the manifest on disk is the recovery
// point, and a fresh runner over the same files resumes it.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const readline = require('node:readline');
const { fork } = require('node:child_process');
const { finished } = require('node:stream/promises');
const { buildShopifyCoverageRows, upsertAdapterCoverageRows, writeJsonAtomic } = require('../../../lib/source-coverage.js');
const { createUserAction, readUserAction } = require('../../../lib/user-actions.js');
const { ShopifyCliError } = require('./shopify-cli.js');
const { ShopifyExtractStop } = require('./import-findings.js');
const session = require('./shopify-session.js');

const QUERIES_DIR = path.join(__dirname, '..', 'queries');
const MANIFEST_SCHEMA_VERSION = 1;
const POLL_START_MS = 2000;
const POLL_CAP_MS = 30000;
const OVERDUE_MS = 4 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 1;
const MAX_DOWNLOAD_TRIES = 3;
const MAX_LINK_RERUNS = 2;
const SNAPSHOT_PLACEHOLDER = '{{SNAPSHOT_TIME}}';
const OVERDUE_NAMESPACE = 'shopify-bulk-overdue';
const RAW_EXTRACT_DIR = 'data/source-extract';
const EXTRACT_MANIFEST_FILE = 'extract-manifest.json';
const SQLITE_WORKER = path.join(__dirname, 'shopify-bulk-sqlite-worker.js');

const STATUS_QUERY = 'query RpBulkStatus($id: ID!) { node(id: $id) { ... on BulkOperation { id status errorCode createdAt completedAt objectCount rootObjectCount fileSize url partialDataUrl } } }';

// ---------------------------------------------------------------------------------------------
// The query catalog: eighteen queries, in this order, and how each one's child rows fold
// ---------------------------------------------------------------------------------------------

const MEDIA_TYPES = ['MediaImage', 'Video', 'ExternalVideo', 'Model3d', 'GenericFile'];
const DISCOUNT_APPLICATION_TYPES = ['DiscountCodeApplication', 'AutomaticDiscountApplication', 'ManualDiscountApplication', 'ScriptDiscountApplication'];

function typesTo(types, field, extra = {}) {
  return Object.fromEntries(types.map((type) => [type, { field, ...extra }]));
}

// `children` maps a child row's `__typename` to the field it folds into on its parent (`into` names
// an inline object of the parent that holds the field). `rootFields` and `childFields` are the
// fields initialised to [] so an empty connection reads as empty, not absent. `inline` lists
// non-connection list fields on a root row whose elements carry nested connections: such a
// child's `__parentId` may name the inline element, so its objects are indexed by `id`.
const QUERY_CATALOG = Object.freeze([
  { name: 'products', entity: 'products', rootFields: ['variants', 'media', 'metafields'], children: { ProductVariant: { field: 'variants' }, ...typesTo(MEDIA_TYPES, 'media'), Metafield: { field: 'metafields' } } },
  { name: 'collections', entity: 'collections', rootFields: ['products', 'metafields'], children: { Product: { field: 'products' }, Metafield: { field: 'metafields' } } },
  { name: 'customers', entity: 'customers', rootFields: ['metafields'], children: { Metafield: { field: 'metafields' } } },
  { name: 'orders-core', entity: 'orders', rootFields: ['lineItems', 'shippingLines', 'discountApplications', 'metafields'], children: { LineItem: { field: 'lineItems' }, ShippingLine: { field: 'shippingLines' }, ...typesTo(DISCOUNT_APPLICATION_TYPES, 'discountApplications'), Metafield: { field: 'metafields' } } },
  { name: 'orders-refunds', entity: 'orders', inline: { refunds: ['refundLineItems', 'transactions'] }, children: { RefundLineItem: { field: 'refundLineItems' }, OrderTransaction: { field: 'transactions' } } },
  { name: 'orders-fulfillments', entity: 'orders', inline: { fulfillments: ['fulfillmentLineItems'] }, children: { FulfillmentLineItem: { field: 'fulfillmentLineItems' } } },
  { name: 'gift-cards', entity: 'gift-cards', children: {} },
  { name: 'discounts', entity: 'discounts', children: { DiscountRedeemCode: { field: 'codes', into: 'discount' } } },
  { name: 'delivery-profiles', entity: 'delivery-profiles', rootFields: ['locationGroupZones'], childFields: { DeliveryLocationGroupZone: ['methodDefinitions'] }, children: { DeliveryLocationGroupZone: { field: 'locationGroupZones' }, DeliveryMethodDefinition: { field: 'methodDefinitions' } } },
  { name: 'inventory', entity: 'inventory-items', rootFields: ['inventoryLevels'], children: { InventoryLevel: { field: 'inventoryLevels' } } },
  { name: 'pages', entity: 'pages', children: {} },
  { name: 'blogs', entity: 'blogs', children: {} },
  { name: 'articles', entity: 'articles', children: {} },
  { name: 'menus', entity: 'menus', children: {} },
  { name: 'url-redirects', entity: 'url-redirects', children: {} },
  { name: 'locations', entity: 'locations', children: {} },
  { name: 'metaobjects', entity: 'metaobjects', rootFields: ['metaobjects'], children: { Metaobject: { field: 'metaobjects' } } },
  { name: 'files', entity: 'files', children: {} },
]);

const QUERY_NAMES = Object.freeze(QUERY_CATALOG.map((entry) => entry.name));
const CUSTOMER_QUERIES = Object.freeze(['customers']);
const ORDER_QUERIES = Object.freeze(['orders-core', 'orders-refunds', 'orders-fulfillments']);
const DENIAL_ATTRIBUTED_QUERIES = Object.freeze([...CUSTOMER_QUERIES, ...ORDER_QUERIES]);

function catalogEntry(name) {
  const entry = QUERY_CATALOG.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`unknown Shopify bulk query ${name}`);
  return entry;
}

function queryFilePath(name, dir = QUERIES_DIR) {
  return path.join(dir, `${name}.graphql`);
}

function readQueryFile(name, dir = QUERIES_DIR) {
  return fs.readFileSync(queryFilePath(name, dir), 'utf8');
}

// The text sent for one query: the file with the snapshot time filled in, then the caller's
// projection (`projectQuery`), if it passes one, for the customer and order queries.
function generateQueryText(name, { snapshotTime, project = null, dir = QUERIES_DIR } = {}) {
  let text = readQueryFile(name, dir);
  if (text.includes(SNAPSHOT_PLACEHOLDER)) {
    if (!snapshotTime) throw new Error(`query ${name} needs the snapshot time`);
    text = text.split(SNAPSHOT_PLACEHOLDER).join(snapshotTime);
  }
  if (typeof project === 'function' && DENIAL_ATTRIBUTED_QUERIES.includes(name)) text = project(name, text);
  return text;
}

// Static shape checks for the contract test: connections are the `edges { node }` blocks.
function stripForShape(text) {
  const noComments = String(text).replace(/#[^\n]*/g, ' ');
  let out = '';
  let depth = 0;
  let inString = false;
  for (let i = 0; i < noComments.length; i += 1) {
    const ch = noComments[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '(') { depth += 1; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

function connectionShape(text) {
  const tokens = stripForShape(text).match(/[{}]|[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const stack = [];
  let connections = 0;
  let maxDepth = 0;
  let open = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '{') {
      const isEdges = tokens[i - 1] === 'edges';
      stack.push(isEdges);
      if (isEdges) { open += 1; connections += 1; maxDepth = Math.max(maxDepth, open); }
    } else if (token === '}') {
      if (stack.pop()) open -= 1;
    }
  }
  return { connections, nestedLevels: Math.max(0, maxDepth - 1) };
}

// ---------------------------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------------------------

class BulkStop extends Error {
  constructor(code, message, { status = 'stopped', details = {} } = {}) {
    super(message);
    this.name = 'BulkStop';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const STOPPING_FAILED_CODE = 'shopify_bulk_failed';

function iso(ms) {
  return new Date(ms).toISOString();
}

function entityOf(name) {
  return catalogEntry(name).entity;
}

function isStopping(entry, caller) {
  if (caller !== 'extract') return false;
  if (entry.state === 'failed') return true;
  return entry.state === 'denied' && entry.handlerOutcome && entry.handlerOutcome.attribution === 'unattributed';
}

// ---------------------------------------------------------------------------------------------
// Files: JSONL validation, folding, ndjson writing, the default file host download
// ---------------------------------------------------------------------------------------------

async function removeFile(file) {
  await fsp.rm(file, { force: true });
}

async function writeTextAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, text, 'utf8');
  await fsp.rename(temp, file);
}

async function writeNdjsonAtomic(file, records) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const out = fs.createWriteStream(temp, { encoding: 'utf8' });
  let count = 0;
  try {
    for await (const record of records) {
      if (!out.write(`${JSON.stringify(record)}\n`)) await new Promise((resolve) => out.once('drain', resolve));
      count += 1;
    }
    out.end();
    await finished(out);
    await fsp.rename(temp, file);
    return count;
  } catch (error) {
    out.destroy();
    await removeFile(temp);
    throw error;
  }
}

async function* iterateNdjson(file) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) if (line.length) yield JSON.parse(line);
}

async function countLines(file) {
  try {
    await fsp.access(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let count = 0;
  for await (const _record of iterateNdjson(file)) count += 1;
  return count;
}

async function copyFileAtomic(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.copyFile(source, temp);
    await fsp.rename(temp, destination);
  } catch (error) {
    await removeFile(temp);
    throw error;
  }
}

// The download gate's file checks: empty or newline-terminated, and every line one
// JSON object. Streams the file; keeps no record in memory.
function validateJsonlFile(file) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    let rest = '';
    let lines = 0;
    let last = '';
    let failure = null;
    const checkLine = (line) => {
      if (failure) return;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        failure = 'a line does not parse as JSON';
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) failure = 'a line is not a JSON object';
      else lines += 1;
    };
    stream.on('data', (chunk) => {
      if (failure) return;
      last = chunk[chunk.length - 1];
      rest += chunk;
      let at = rest.indexOf('\n');
      while (at !== -1 && !failure) {
        checkLine(rest.slice(0, at));
        rest = rest.slice(at + 1);
        at = rest.indexOf('\n');
      }
    });
    stream.on('error', (error) => resolve({ ok: false, reason: `the file could not be read: ${error.message}` }));
    stream.on('end', () => {
      if (!failure && rest.length) failure = 'the file does not end with a newline';
      if (failure) resolve({ ok: false, reason: failure });
      else resolve({ ok: true, lines, endsWithNewline: last === '\n' || last === '' });
    });
  });
}

// Node 22.12 ships node:sqlite behind --experimental-sqlite. Keep the documented adapter
// invocation flag-free: on that one supported boundary runtime, only the disk-backed transform
// runs in a child with the built-in module enabled. Node 22.13+ stays in-process. The worker gets
// only paths and the public query shape, never credentials or record values over the command line.
function loadDatabaseSync() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch (error) {
    if (error && error.code === 'ERR_UNKNOWN_BUILTIN_MODULE') return null;
    throw error;
  }
}

function sqliteWorkerError(payload) {
  const error = new Error(payload && payload.message ? payload.message : 'the SQLite worker failed');
  if (payload && payload.name) error.name = payload.name;
  for (const field of ['code', 'errno', 'syscall', 'path']) {
    if (payload && payload[field] !== undefined) error[field] = payload[field];
  }
  if (payload && payload.stack) error.stack = payload.stack;
  return error;
}

function runSqliteWorker(operation, payload) {
  return new Promise((resolve, reject) => {
    // Preserve explicit memory ceilings used to prove the bounded-memory contract. Other Node
    // entry-point/debug flags belong to the parent, not to this internal helper.
    const memoryArgs = process.execArgv.filter((arg) => /^--(?:max-old-space-size|max-semi-space-size|stack-size)=/.test(arg));
    const child = fork(SQLITE_WORKER, [], {
      execArgv: [...memoryArgs, '--no-warnings', '--experimental-sqlite'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (!settled) fail(new Error(`the SQLite worker exited before replying (${signal || `code ${code}`})`));
    });
    child.once('message', (message) => {
      if (settled) return;
      settled = true;
      if (child.connected) child.disconnect();
      if (message && message.ok) resolve(message.result);
      else reject(sqliteWorkerError(message && message.error));
    });
    child.send({ operation, payload }, (error) => {
      if (error) fail(error);
    });
  });
}

// Shopify leaves `groupObjects` false, so children may precede their parents. Index child rows in
// a temporary SQLite database, then stream roots in source order and attach only that root's tree.
// Memory is therefore bounded by the largest assembled root, not by the full store export.
async function foldBulkJsonl(file, shape, { outputFile } = {}) {
  if (!outputFile) throw new Error('foldBulkJsonl requires outputFile');
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) return runSqliteWorker('foldBulkJsonl', { file, shape, outputFile });
  await fsp.mkdir(path.dirname(outputFile), { recursive: true });
  const work = `${outputFile}.${process.pid}.${Date.now()}.fold.tmp`;
  const outputTemp = `${outputFile}.${process.pid}.${Date.now()}.tmp`;
  const db = new DatabaseSync(work);
  let output = null;
  let lines = 0;
  try {
    db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = FILE;
      CREATE TABLE roots (seq INTEGER PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE children (
        seq INTEGER PRIMARY KEY,
        parent_id TEXT NOT NULL,
        child_id TEXT,
        child_type TEXT,
        json TEXT NOT NULL,
        attached INTEGER NOT NULL DEFAULT 0,
        orphan_reason TEXT
      );
    `);
    const addRoot = db.prepare('INSERT INTO roots(seq, json) VALUES (?, ?)');
    const addChild = db.prepare('INSERT INTO children(seq, parent_id, child_id, child_type, json) VALUES (?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    let inTransaction = true;
    try {
      for await (const line of readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })) {
        if (!line.length) continue;
        const row = JSON.parse(line);
        lines += 1;
        if (row.__parentId === undefined) addRoot.run(lines, line);
        else addChild.run(lines, String(row.__parentId), typeof row.id === 'string' ? row.id : null, typeof row.__typename === 'string' ? row.__typename : null, line);
      }
      db.exec('COMMIT');
      inTransaction = false;
      db.exec('CREATE INDEX children_parent ON children(parent_id, seq)');
    } catch (error) {
      if (inTransaction) db.exec('ROLLBACK');
      throw error;
    }

    const childrenFor = db.prepare('SELECT seq, json, child_type FROM children WHERE parent_id = ? AND attached = 0 ORDER BY seq');
    const markAttached = db.prepare('UPDATE children SET attached = 1 WHERE seq = ?');
    const markOrphan = db.prepare('UPDATE children SET orphan_reason = ? WHERE seq = ?');
    // Node 22.12's flag-gated StatementSync has no iterate(). Walk the integer primary key with
    // get() instead: one root is resident at a time and later runtimes follow the identical path.
    const nextRoot = db.prepare('SELECT seq, json FROM roots WHERE seq > ? ORDER BY seq LIMIT 1');
    const nestedParentTypes = new Set(Object.keys(shape.childFields || {}));
    output = fs.createWriteStream(outputTemp, { encoding: 'utf8' });
    let recordCount = 0;
    let rootSeq = 0;

    for (let stored = nextRoot.get(rootSeq); stored; stored = nextRoot.get(rootSeq)) {
      rootSeq = Number(stored.seq);
      const root = JSON.parse(stored.json);
      const seen = new Set();
      for (const field of shape.rootFields || []) if (!Array.isArray(root[field])) root[field] = [];
      for (const [field, nested] of Object.entries(shape.inline || {})) {
        for (const element of Array.isArray(root[field]) ? root[field] : []) {
          if (element && typeof element === 'object') for (const nestedField of nested) if (!Array.isArray(element[nestedField])) element[nestedField] = [];
        }
      }

      const attachChildren = (value, mayHaveChildren) => {
        if (!value || typeof value !== 'object') return;
        if (mayHaveChildren && typeof value.id === 'string' && !seen.has(value.id)) {
          seen.add(value.id);
          for (const storedChild of childrenFor.all(value.id)) {
            const rule = shape.children[storedChild.child_type];
            if (!rule) { markOrphan.run('unrecognised_child_type', storedChild.seq); continue; }
            const holder = rule.into ? (value[rule.into] && typeof value[rule.into] === 'object' ? value[rule.into] : null) : value;
            if (!holder) { markOrphan.run('parent_not_found', storedChild.seq); continue; }
            const child = JSON.parse(storedChild.json);
            delete child.__parentId;
            if (!Array.isArray(holder[rule.field])) holder[rule.field] = [];
            holder[rule.field].push(child);
            markAttached.run(storedChild.seq);
            attachChildren(child, nestedParentTypes.has(child.__typename));
          }
        }
      };
      attachChildren(root, true);
      for (const field of Object.keys(shape.inline || {})) {
        for (const element of Array.isArray(root[field]) ? root[field] : []) attachChildren(element, true);
      }

      const initialiseTree = (value) => {
        if (Array.isArray(value)) { for (const item of value) initialiseTree(item); return; }
        if (!value || typeof value !== 'object') return;
        const initialise = shape.childFields && shape.childFields[value.__typename];
        if (initialise) for (const field of initialise) if (!Array.isArray(value[field])) value[field] = [];
        for (const nested of Object.values(value)) initialiseTree(nested);
      };
      initialiseTree(root);
      if (!output.write(`${JSON.stringify(root)}\n`)) await new Promise((resolve) => output.once('drain', resolve));
      recordCount += 1;
    }
    output.end();
    await finished(output);
    output = null;

    const orphanCount = Number(db.prepare('SELECT COUNT(*) AS count FROM children WHERE attached = 0').get().count);
    if (orphanCount) {
      const orphans = db.prepare('SELECT parent_id, child_id, child_type, orphan_reason FROM children WHERE attached = 0 ORDER BY seq LIMIT 20').all().map((row) => ({
        reason: row.orphan_reason || 'parent_not_found',
        parentId: row.parent_id,
        id: row.child_id || null,
        type: row.child_type || null,
      }));
      await removeFile(outputTemp);
      return { orphans, orphanCount, lines };
    }
    await fsp.rename(outputTemp, outputFile);
    return { outputFile, recordCount, lines };
  } finally {
    if (output) output.destroy();
    db.close();
    await removeFile(outputTemp);
    await removeFile(work);
  }
}

// Join the three order datasets without loading any of them as a whole. Supplemental rows live
// in a temporary SQLite table; core orders stream through one at a time in their original order.
async function joinOrderFiles({ coreFile, refundsFile, fulfillmentsFile, outputFile, workDir = path.dirname(outputFile) }) {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) return runSqliteWorker('joinOrderFiles', { coreFile, refundsFile, fulfillmentsFile, outputFile, workDir });
  const work = path.join(workDir, `${path.basename(outputFile)}.${process.pid}.${Date.now()}.orders.tmp`);
  const outputTemp = path.join(workDir, `${path.basename(outputFile)}.${process.pid}.${Date.now()}.tmp`);
  const db = new DatabaseSync(work);
  let output = null;
  try {
    db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = FILE;
      CREATE TABLE supplements (
        query_name TEXT NOT NULL,
        order_id TEXT NOT NULL,
        value TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(query_name, order_id)
      );
      CREATE INDEX supplements_order ON supplements(order_id);
    `);
    const add = db.prepare('INSERT OR REPLACE INTO supplements(query_name, order_id, value) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    try {
      for (const [query, field, file] of [['orders-refunds', 'refunds', refundsFile], ['orders-fulfillments', 'fulfillments', fulfillmentsFile]]) {
        if (!file) continue; // this run does not carry that query
        // A `done` supplement always has its staged file, empty when the dataset is. A missing one
        // is lost input, never an empty dataset: fail loudly rather than write empty arrays.
        try {
          await fsp.access(file);
        } catch (error) {
          if (error.code === 'ENOENT') throw new Error(`the staged ${query} file is missing: ${path.basename(file)}`);
          throw error;
        }
        for await (const row of iterateNdjson(file)) add.run(query, String(row.id), JSON.stringify(Array.isArray(row[field]) ? row[field] : []));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const find = db.prepare('SELECT query_name, value FROM supplements WHERE order_id = ?');
    const markUsed = db.prepare('UPDATE supplements SET used = 1 WHERE order_id = ?');
    output = fs.createWriteStream(outputTemp, { encoding: 'utf8' });
    for await (const order of iterateNdjson(coreFile)) {
      const joined = { ...order, refunds: [], fulfillments: [] };
      for (const row of find.all(String(order.id))) joined[row.query_name === 'orders-refunds' ? 'refunds' : 'fulfillments'] = JSON.parse(row.value);
      markUsed.run(String(order.id));
      if (!output.write(`${JSON.stringify(joined)}\n`)) await new Promise((resolve) => output.once('drain', resolve));
    }
    output.end();
    await finished(output);
    output = null;
    await fsp.rename(outputTemp, outputFile);
    const droppedByQuery = Object.fromEntries(['orders-refunds', 'orders-fulfillments'].map((query) => [query, Number(db.prepare('SELECT COUNT(*) AS count FROM supplements WHERE query_name = ? AND used = 0').get(query).count)]));
    return { droppedOrphans: droppedByQuery['orders-refunds'] + droppedByQuery['orders-fulfillments'], droppedByQuery };
  } finally {
    if (output) output.destroy();
    db.close();
    await removeFile(outputTemp);
    await removeFile(work);
  }
}

// The default file host download: plain http(s), no content decoding (identity only), bytes
// counted as they arrive. It reports what happened; the gate decides what it means.
function defaultDownload(url, destination) {
  return new Promise((resolve) => {
    let client;
    try {
      client = String(url).startsWith('http:') ? http : https;
    } catch {
      client = https;
    }
    const request = client.get(url, { headers: { 'accept-encoding': 'identity' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode, bytes: 0 }));
        response.on('error', (error) => resolve({ status: response.statusCode, bytes: 0, error: error.message }));
        return;
      }
      const out = fs.createWriteStream(destination);
      let bytes = 0;
      let failed = null;
      response.on('data', (chunk) => { bytes += chunk.length; });
      response.on('error', (error) => { failed = error.message; out.end(); });
      response.on('aborted', () => { failed = failed || 'the connection was cut'; });
      response.pipe(out);
      out.on('finish', () => resolve({ status: 200, bytes, ...(failed || !response.complete ? { error: failed || 'the response did not complete' } : {}) }));
      out.on('error', (error) => resolve({ status: 200, bytes, error: error.message }));
    });
    request.on('error', (error) => resolve({ status: null, bytes: 0, error: error.message }));
  });
}

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

function newManifest({ caller, store, snapshotTime, queries, previousSidecars, now }) {
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    caller,
    store,
    snapshotTime,
    startedAt: iso(now()),
    status: 'running',
    order: queries.map((query) => query.name),
    queries: Object.fromEntries(queries.map((query) => [query.name, {
      state: 'pending',
      entity: query.entity || entityOf(query.name),
      text: query.text,
      attempts: 0,
      reapproved: false,
      downloadTries: 0,
      linkReruns: 0,
    }])),
  };
  if (previousSidecars.length) manifest.previousSidecars = [...new Set(previousSidecars)].sort();
  return manifest;
}

const OPERATION_FIELDS = ['operationId', 'runningAt', 'deadlineAt', 'overdueRound', 'overdueActionId', 'url', 'fileSize', 'objectCount', 'rootObjectCount', 'createdAt', 'completedAt', 'startedAt'];

// The shopify extract adapters plug into the runner here and add no runner logic of their own: a denial
// handler, a `failed` handler per query (`failed.byQuery`), a reassembly hook per query, the
// `denied` reset, and `project` (the projection applied to the customer and order query text).
// Everything a handler registers must be idempotent. Options passed to createBulkRunner
// override what is registered.
const registered = { handlers: {}, deniedReset: null, project: null };

function registerHandlers({ denied, failed, reassemble, deniedReset, project } = {}) {
  if (denied) registered.handlers.denied = denied;
  if (failed) registered.handlers.failed = { ...(registered.handlers.failed || {}), ...failed, byQuery: { ...((registered.handlers.failed || {}).byQuery || {}), ...(failed.byQuery || {}) } };
  if (reassemble) registered.handlers.reassemble = { ...(registered.handlers.reassemble || {}), ...reassemble };
  if (deniedReset) registered.deniedReset = deniedReset;
  if (project) registered.project = project;
}

function clearRegisteredHandlers() {
  registered.handlers = {};
  registered.deniedReset = null;
  registered.project = null;
}

function mergeHandlers(extra = {}) {
  const base = registered.handlers;
  return {
    denied: extra.denied || base.denied,
    failed: { ...(base.failed || {}), ...(extra.failed || {}), byQuery: { ...((base.failed || {}).byQuery || {}), ...((extra.failed || {}).byQuery || {}) } },
    reassemble: { ...(base.reassemble || {}), ...(extra.reassemble || {}) },
  };
}

function createBulkRunner(options = {}) {
  const {
    projectDir,
    store,
    caller,
    manifestPath,
    stagingDir,
    queries = null,
    snapshotTime = null,
    execute,
    handlers: handlerOptions = {},
    deniedReset = registered.deniedReset,
    retryFailed = false,
    previousSidecars = [],
    sessionCheck = null,
    download = defaultDownload,
    outputDir = null,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    progress = () => {},
    onPersist = null,
    overdueMs = OVERDUE_MS,
  } = options;
  if (caller !== 'extract' && caller !== 'census') throw new Error('caller must be extract or census');
  if (!projectDir || !manifestPath || !stagingDir) throw new Error('projectDir, manifestPath and stagingDir are required');
  if (typeof execute !== 'function' || typeof execute.startBulkOperation !== 'function') throw new Error('execute (a store executor with startBulkOperation) is required');
  if (caller === 'extract' && !outputDir) throw new Error('an extract needs outputDir');
  const stage = caller === 'extract' ? 'execution' : 'discovery';
  const extract = caller === 'extract';
  const normalizedStore = session.normalizeDomain(store);
  const handlers = mergeHandlers(handlerOptions);
  let manifest = null;

  // -------------------------------------------------------------------------------------------
  // Manifest
  // -------------------------------------------------------------------------------------------

  async function save(label, query = null) {
    await writeJsonAtomic(manifestPath, manifest);
    if (typeof onPersist === 'function') await onPersist({ label, query, state: query ? manifest.queries[query].state : null, manifest });
  }

  async function readManifest() {
    try {
      return JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  const entry = (name) => manifest.queries[name];

  async function setState(name, state, fields = {}, dropFields = []) {
    const target = entry(name);
    target.state = state;
    Object.assign(target, fields);
    for (const field of dropFields) delete target[field];
    await save(`${name}:${state}`, name);
  }

  function dropOperation(name) {
    const target = entry(name);
    for (const field of OPERATION_FIELDS) delete target[field];
  }

  // -------------------------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------------------------

  function coverageRowFor(name, { artifact, pointer, recoveryAction }) {
    const entity = entityOf(name);
    const [row] = buildShopifyCoverageRows({
      captureFailures: [{ entity, artifact, reads: [name], errors: [{ code: 'shopify_bulk' }] }],
      rawDir: RAW_EXTRACT_DIR,
    });
    return { ...row, evidence: { artifact, pointer }, recoveryAction };
  }

  function failureEvidence(name, target) {
    const parts = [`queries.${name}`, `state ${target.outcome || target.state}`, `errorCode ${target.errorCode || 'unknown'}`];
    if (target.error && target.error.message) parts.push(String(target.error.message).slice(0, 300));
    return parts.join('; ');
  }

  // The default `failed` handler. Extract: the capture-failed row, upserted by coverageId.
  // Census: the same row, carried in the entry's handlerOutcome for the discovery coverage step
  // (the raw coverage file does not exist until discovery's last step, so nothing is upserted).
  async function defaultFailedHandler({ name, entry: target }) {
    const recoveryAction = extract
      ? `Fix the cause named in the stop message, then run shopify-extract.js --retry-failed for ${entityOf(name)}.`
      : `Fix the cause, then run Shopify discovery again for ${entityOf(name)} (the extract's gated read also covers it).`;
    const row = coverageRowFor(name, {
      artifact: extract ? `${RAW_EXTRACT_DIR}/${EXTRACT_MANIFEST_FILE}` : path.relative(projectDir, manifestPath).split(path.sep).join('/'),
      pointer: failureEvidence(name, target),
      recoveryAction,
    });
    if (extract) await upsertAdapterCoverageRows(projectDir, { adapter: 'shopify', rows: [row] });
    return { handlerOutcome: { coverageId: row.coverageId, ...(extract ? {} : { row }) } };
  }

  // The fail-closed denial fallback, used only when the caller registers no denial handler (the
  // customer-and-order adapter registers its own): the denial is unattributed, so the dataset is treated like a failed one.
  async function defaultDeniedHandler(context) {
    const result = await defaultFailedHandler(context);
    return { handlerOutcome: { attribution: 'unattributed', ...result.handlerOutcome }, stop: { code: STOPPING_FAILED_CODE, message: `Shopify denied the ${context.name} export and the denial could not be attributed to a withheld detail.` } };
  }

  function failedHandlerFor(name) {
    const byQuery = (handlers.failed && handlers.failed.byQuery) || {};
    return byQuery[name] || (handlers.failed && handlers.failed.default) || defaultFailedHandler;
  }

  function handlerContext(name) {
    return { name, query: name, entity: entityOf(name), entry: entry(name), manifest, caller, stage, projectDir, store, execute, stagingDir, outputDir, manifestPath, now, sleep };
  }

  // -------------------------------------------------------------------------------------------
  // Settling
  // -------------------------------------------------------------------------------------------

  async function beginSettling(name, outcome, { errorCode, error }) {
    await setState(name, 'settling', { outcome, errorCode, error, settlingAt: iso(now()) });
  }

  // `later` is a start that finds an already-terminal stopping entry: it stops with the generic
  // `shopify_bulk_failed`; the first settle stops with the entry's own code.
  function stopFor(name, target, handlerStop, { later = false } = {}) {
    const entity = entityOf(name);
    if (handlerStop) {
      return new BulkStop(handlerStop.code, handlerStop.message || `Shopify ${caller} stopped (${handlerStop.code}) at ${name}.`, { details: { query: name, entity, ...(handlerStop.details || {}) } });
    }
    const specific = target.errorCode && target.state === 'failed' ? target.errorCode : STOPPING_FAILED_CODE;
    const code = later ? STOPPING_FAILED_CODE : specific;
    const cause = target.error && target.error.message ? `: ${String(target.error.message).slice(0, 300)}` : '';
    return new BulkStop(code, `Shopify dataset ${entity} could not be read (${specific})${cause}. Requires Import Operator: fix the cause named here, run \`shopify-extract.js --retry-failed\`, and when the extract completes record the coverage decision \`provided\` for \`shopify:${entity}\`; otherwise show the merchant the row at mapping.`, { details: { query: name, entity, errorCode: target.errorCode || null, coverageId: target.handlerOutcome ? target.handlerOutcome.coverageId : null } });
  }

  // Runs the outcome's handler for a `settling` entry, writes the terminal state, and returns the
  // stop the entry causes, or null.
  async function finishSettling(name) {
    const target = entry(name);
    const context = handlerContext(name);
    let result;
    if (target.outcome === 'failed') {
      result = await failedHandlerFor(name)({ ...context, outcome: 'failed' });
    } else {
      result = await (handlers.denied || defaultDeniedHandler)({ ...context, outcome: 'denied' });
    }
    const terminal = { handlerOutcome: (result && result.handlerOutcome) || {} };
    if (target.outcome === 'denied') terminal.deniedAt = iso(now());
    await setState(name, target.outcome, terminal);
    const handlerStop = result && result.stop ? result.stop : null;
    if (handlerStop) return stopFor(name, entry(name), handlerStop);
    if (isStopping(entry(name), caller)) return stopFor(name, entry(name), null);
    return null;
  }

  async function settle(name, outcome, details) {
    await beginSettling(name, outcome, details);
    const stop = await finishSettling(name);
    if (stop) throw stop;
  }

  async function settleAll() {
    for (const name of manifest.order) {
      if (entry(name).state === 'settling') {
        const stop = await finishSettling(name);
        if (stop) throw stop;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Session expiry, denial
  // -------------------------------------------------------------------------------------------

  async function authExpiredStop(extraMessage = '') {
    const action = await session.recordAuthExpired(projectDir, { stage, store });
    return new BulkStop('source_auth_expired', `the Shopify connection for ${store} expired during the ${caller}${extraMessage}. Re-approval request ${action.requestId} is pending: run the Shopify session check (with --connect if asked), answer it, then run the same step again. Finished reads are not repeated.`, { details: { requestId: action.requestId } });
  }

  async function runSessionCheck() {
    if (typeof sessionCheck !== 'function') return { ok: true };
    return sessionCheck();
  }

  async function handleDenial(name, evidence) {
    const target = entry(name);
    const check = await runSessionCheck();
    if (!check.ok && !target.reapproved) {
      dropOperation(name);
      await setState(name, 'pending', { reapproved: true });
      throw await authExpiredStop(` (Shopify denied the ${name} export and the session check failed)`);
    }
    const verbatim = { message: 'Shopify refused the bulk export with ACCESS_DENIED', ...evidence };
    if (DENIAL_ATTRIBUTED_QUERIES.includes(name)) {
      await settle(name, 'denied', { errorCode: 'ACCESS_DENIED', error: verbatim });
    } else {
      await settle(name, 'failed', { errorCode: STOPPING_FAILED_CODE, error: { ...verbatim, message: 'Shopify refused the bulk export with ACCESS_DENIED' } });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Per query
  // -------------------------------------------------------------------------------------------

  const hasCode = (errors, code) => (errors || []).some((error) => error && error.extensions && error.extensions.code === code);

  async function startQuery(name) {
    const target = entry(name);
    await setState(name, 'starting', { startedAt: iso(now()) });
    progress('Starting Shopify bulk export', { query: name });
    const result = await execute.startBulkOperation(target.text);
    if (result.errors && result.errors.length) {
      if (hasCode(result.errors, 'ACCESS_DENIED')) { await handleDenial(name, { graphqlErrors: result.errors }); return; }
      await settle(name, 'failed', { errorCode: STOPPING_FAILED_CODE, error: { message: 'Shopify answered the bulk start with GraphQL errors', graphqlErrors: result.errors } });
      return;
    }
    const payload = result.data && result.data.bulkOperationRunQuery;
    if (!payload) {
      await settle(name, 'failed', { errorCode: STOPPING_FAILED_CODE, error: { message: 'Shopify answered the bulk start with no bulkOperationRunQuery result' } });
      return;
    }
    if (Array.isArray(payload.userErrors) && payload.userErrors.length) {
      await settle(name, 'failed', { errorCode: STOPPING_FAILED_CODE, error: { message: 'Shopify refused the bulk start', userErrors: payload.userErrors } });
      return;
    }
    const operation = payload.bulkOperation;
    if (!operation || typeof operation.id !== 'string') {
      await settle(name, 'failed', { errorCode: STOPPING_FAILED_CODE, error: { message: 'Shopify answered the bulk start with no operation id' } });
      return;
    }
    const runningAt = now();
    await setState(name, 'running', { operationId: operation.id, runningAt: iso(runningAt), deadlineAt: iso(runningAt + overdueMs), overdueRound: 1 });
  }

  function overdueRequestId(name, round) {
    return session.sequencedRequestId(OVERDUE_NAMESPACE, `${caller}\0${name}\0${entry(name).operationId}`, round);
  }

  async function readActionIfAny(requestId) {
    try {
      return await readUserAction(projectDir, requestId);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function raiseOverdue(name) {
    const target = entry(name);
    const round = target.overdueRound || 1;
    const requestId = overdueRequestId(name, round);
    let action = await readActionIfAny(requestId);
    if (!action) {
      action = await createUserAction(projectDir, {
        requestId,
        kind: 'question',
        stage,
        title: `Shopify export overdue: ${name} (shopify_bulk_overdue)`,
        prompt: `Shopify has been preparing the \`${name}\` export (operation ${target.operationId}) for over ${round * 4} hours. Wait another 4 hours, or abort this dataset?`,
        response: { mode: 'choice' },
        choices: [
          { id: 'wait', label: 'Wait another 4 hours' },
          { id: 'abort', label: 'Abort this dataset' },
        ],
      });
    }
    await setState(name, 'running', { overdueActionId: action.requestId });
    throw new BulkStop('shopify_bulk_overdue', `Shopify has been preparing the ${name} export for over ${round * 4} hours. Answer request ${action.requestId} (wait or abort), then run the same step again.`, { status: 'awaiting_user_action', details: { query: name, operationId: target.operationId, round, requestIds: [action.requestId] } });
  }

  // Applies an answered overdue action, or stops while it is unanswered. Returns 'waited' | 'aborted'.
  async function applyOverdue(name) {
    const target = entry(name);
    const action = await readActionIfAny(target.overdueActionId);
    if (!action || action.status !== 'answered') {
      throw new BulkStop('shopify_bulk_overdue', `The ${name} export is overdue and request ${target.overdueActionId} is unanswered; nothing was polled or started.`, { status: 'awaiting_user_action', details: { query: name, operationId: target.operationId, round: target.overdueRound || 1, requestIds: [target.overdueActionId] } });
    }
    if (action.answer && action.answer.choice === 'abort') {
      await settle(name, 'failed', { errorCode: 'shopify_bulk_overdue_aborted', error: { message: `The ${name} export was aborted after it ran over ${(target.overdueRound || 1) * 4} hours; Shopify's operation ${target.operationId} was not cancelled and its result was never downloaded`, operationId: target.operationId, requestId: action.requestId } });
      return 'aborted';
    }
    const answeredAt = Date.parse(action.answer && action.answer.answeredAt);
    const base = Number.isFinite(answeredAt) ? answeredAt : now();
    await setState(name, 'running', { deadlineAt: iso(base + overdueMs), overdueRound: (target.overdueRound || 1) + 1 }, ['overdueActionId']);
    return 'waited';
  }

  function classifyOperation(operation) {
    if (!operation) return 'failed';
    if (operation.partialDataUrl) return 'failed';
    if (operation.status === 'COMPLETED') return 'completed';
    if (operation.status === 'FAILED' && operation.errorCode === 'ACCESS_DENIED') return 'denied';
    if (['FAILED', 'CANCELED', 'EXPIRED'].includes(operation.status)) return 'failed';
    return 'running';
  }

  async function failedResult(name, { errorCode = STOPPING_FAILED_CODE, message, evidence = {} }) {
    const target = entry(name);
    if (target.attempts < MAX_ATTEMPTS) {
      dropOperation(name);
      await setState(name, 'pending', { attempts: target.attempts + 1, downloadTries: 0 });
      return;
    }
    await settle(name, 'failed', { errorCode, error: { message, ...evidence } });
  }

  async function pollOperation(name) {
    const result = await execute(STATUS_QUERY, { id: entry(name).operationId });
    if (result.errors && result.errors.length) {
      return { errors: result.errors };
    }
    return { operation: result.data && result.data.node ? result.data.node : null };
  }

  async function processRunning(name) {
    if (entry(name).overdueActionId) {
      const outcome = await applyOverdue(name);
      if (outcome === 'aborted') return;
    }
    let wait = POLL_START_MS;
    for (;;) {
      const polled = await pollOperation(name);
      if (polled.errors) {
        if (hasCode(polled.errors, 'ACCESS_DENIED')) { await handleDenial(name, { graphqlErrors: polled.errors }); return; }
        await settle(name, 'failed', { errorCode: STOPPING_FAILED_CODE, error: { message: 'Shopify answered the status poll with GraphQL errors', graphqlErrors: polled.errors } });
        return;
      }
      const operation = polled.operation;
      const kind = classifyOperation(operation);
      if (kind === 'running') {
        if (now() >= Date.parse(entry(name).deadlineAt)) await raiseOverdue(name);
        await sleep(wait);
        wait = Math.min(wait * 2, POLL_CAP_MS);
        continue;
      }
      if (kind === 'denied') { await handleDenial(name, { operation: operationEvidence(operation) }); return; }
      if (kind === 'failed') {
        await failedResult(name, { message: operation ? `Shopify's bulk operation ended ${operation.status}${operation.errorCode ? ` (${operation.errorCode})` : ''}${operation.partialDataUrl ? ' with only partial data' : ''}` : 'Shopify no longer knows the bulk operation', evidence: { operation: operationEvidence(operation) } });
        return;
      }
      await setState(name, 'running', {
        url: operation.url || null,
        fileSize: operation.fileSize === undefined ? null : operation.fileSize,
        objectCount: operation.objectCount,
        rootObjectCount: operation.rootObjectCount,
        createdAt: operation.createdAt,
        completedAt: operation.completedAt,
      });
      await downloadGate(name);
      return;
    }
  }

  function operationEvidence(operation) {
    if (!operation) return null;
    return { id: operation.id, status: operation.status, errorCode: operation.errorCode || null, partialDataUrl: operation.partialDataUrl || null, objectCount: operation.objectCount, fileSize: operation.fileSize === undefined ? null : operation.fileSize };
  }

  // Marks the entry `downloaded` only when the whole gate holds.
  async function downloadGate(name) {
    const jsonl = path.join(stagingDir, `${name}.jsonl`);
    const partial = `${jsonl}.partial`;
    await fsp.mkdir(stagingDir, { recursive: true });
    for (;;) {
      const target = entry(name);
      if (!target.url) {
        if (String(target.objectCount) === '0') {
          await writeTextAtomic(jsonl, '');
          await setState(name, 'downloaded', { bytes: 0, lines: 0 });
          return;
        }
        await failedResult(name, { message: `Shopify completed the ${name} export with no file for ${target.objectCount} objects`, evidence: { operation: { objectCount: target.objectCount } } });
        return;
      }
      progress('Downloading Shopify bulk file', { query: name });
      await removeFile(partial);
      const result = await download(target.url, partial);
      const written = result && Number.isFinite(result.bytes) ? result.bytes : 0;
      if (result && (result.status === 400 || result.status === 403)) {
        await removeFile(partial);
        if (target.linkReruns >= MAX_LINK_RERUNS) {
          await settle(name, 'failed', { errorCode: 'shopify_bulk_download_failed', error: { message: `The ${name} export's download link expired ${target.linkReruns + 1} times (HTTP ${result.status})`, httpStatus: result.status } });
          return;
        }
        dropOperation(name);
        await setState(name, 'pending', { linkReruns: target.linkReruns + 1, downloadTries: 0 });
        return;
      }
      let reason = null;
      if (!result || result.status !== 200) reason = `the download answered ${result && result.status !== null && result.status !== undefined ? `HTTP ${result.status}` : 'no HTTP response'}${result && result.error ? ` (${result.error})` : ''}`;
      else if (result.error) reason = `the download failed: ${result.error}`;
      else if (target.fileSize === null || target.fileSize === undefined || String(written) !== String(target.fileSize)) reason = `the download was ${written} bytes, Shopify reported ${target.fileSize === null || target.fileSize === undefined ? 'no size' : target.fileSize}`;
      let checked = null;
      if (!reason) {
        checked = await validateJsonlFile(partial);
        if (!checked.ok) reason = checked.reason;
      }
      if (!reason) {
        await fsp.rename(partial, jsonl);
        await setState(name, 'downloaded', { bytes: written, lines: checked.lines });
        return;
      }
      await removeFile(partial);
      const tries = target.downloadTries + 1;
      await setState(name, 'running', { downloadTries: tries });
      if (tries < MAX_DOWNLOAD_TRIES) continue;
      await failedResult(name, { errorCode: 'shopify_bulk_download_failed', message: `The ${name} export could not be downloaded whole after ${tries} tries: ${reason}`, evidence: { reason } });
      return;
    }
  }

  async function reassemble(name) {
    const target = entry(name);
    const catalog = catalogEntry(name);
    const jsonl = path.join(stagingDir, `${name}.jsonl`);
    if (!fs.existsSync(jsonl)) {
      // `downloaded` promises a complete local file. If it is gone (staging cleared by hand), the
      // dataset is simply read again: no attempt is spent, nothing is guessed.
      dropOperation(name);
      await setState(name, 'pending', { downloadTries: 0 }, ['bytes', 'lines']);
      return;
    }
    const foldedFile = path.join(stagingDir, `${name}.folded.tmp`);
    const folded = await foldBulkJsonl(jsonl, catalog, { outputFile: foldedFile });
    if (folded.orphans) {
      await settle(name, 'failed', { errorCode: 'shopify_bulk_orphan_child', error: { message: `${folded.orphanCount} child row(s) of ${name} match no parent row`, orphans: folded.orphans } });
      return;
    }
    const hook = handlers.reassemble && handlers.reassemble[name];
    let records = null;
    let recordsFile = null;
    let recordCount = folded.recordCount;
    let outputs = {};
    let sidecarFiles = {};
    let result = {};
    let outputFile = null;
    let entryFields = {};
    let hookStop = null;
    if (hook) {
      const hooked = await hook({ ...handlerContext(name), records: iterateNdjson(foldedFile), recordsFile: foldedFile, recordCount, lines: folded.lines });
      if (hooked && hooked.ok === false) {
        await removeFile(foldedFile);
        await settle(name, 'failed', { errorCode: hooked.errorCode || STOPPING_FAILED_CODE, error: { message: hooked.message || `The ${name} recheck failed (${hooked.errorCode || STOPPING_FAILED_CODE})`, ...(hooked.evidence ? { evidence: hooked.evidence } : {}) } });
        return;
      }
      if (hooked && hooked.records) records = hooked.records;
      if (hooked && hooked.recordsFile) recordsFile = hooked.recordsFile;
      if (hooked && Number.isInteger(hooked.recordCount)) recordCount = hooked.recordCount;
      if (hooked && hooked.sidecars) outputs = hooked.sidecars;
      if (hooked && hooked.sidecarFiles) sidecarFiles = hooked.sidecarFiles;
      if (hooked && hooked.manifest) Object.assign(manifest, hooked.manifest);
      if (hooked && hooked.result) result = hooked.result;
      if (hooked && hooked.outputFile) outputFile = hooked.outputFile;
      if (hooked && hooked.entry) entryFields = hooked.entry;
      if (hooked && hooked.stop) hookStop = hooked.stop;
    }
    const readAt = { createdAt: target.createdAt || null, completedAt: target.completedAt || null };
    const durationMs = Number.isFinite(Date.parse(target.completedAt)) && Number.isFinite(Date.parse(target.createdAt)) ? Date.parse(target.completedAt) - Date.parse(target.createdAt) : null;
    if (extract) {
      const stagedName = outputFile || `${name}.ndjson`;
      const staged = path.join(stagingDir, stagedName);
      if (recordsFile) {
        await removeFile(staged);
        await fsp.rename(recordsFile, staged);
        await removeFile(foldedFile);
      } else if (records) {
        recordCount = await writeNdjsonAtomic(staged, records);
        await removeFile(foldedFile);
      } else {
        await fsp.rename(foldedFile, staged);
      }
      const sidecarNames = [...new Set([...Object.keys(outputs), ...Object.keys(sidecarFiles)])].sort();
      const oldSidecars = Array.isArray(target.sidecars) ? target.sidecars : [];
      for (const sidecar of oldSidecars.filter((sidecar) => !sidecarNames.includes(sidecar))) {
        await removeFile(path.join(stagingDir, `sidecar-${sidecar}.ndjson`));
        manifest.obsoleteSidecars = [...new Set([...(manifest.obsoleteSidecars || []), sidecar])].sort();
      }
      for (const sidecar of sidecarNames) {
        const destination = path.join(stagingDir, `sidecar-${sidecar}.ndjson`);
        if (sidecarFiles[sidecar]) {
          await removeFile(destination);
          await fsp.rename(sidecarFiles[sidecar], destination);
        } else {
          await writeNdjsonAtomic(destination, outputs[sidecar]);
        }
      }
      manifest.sidecars = [...new Set(manifest.order.flatMap((query) => query === name ? sidecarNames : (entry(query).sidecars || [])))].sort();
      await setState(name, 'done', { readAt, durationMs, records: recordCount, sidecars: sidecarNames, ...(outputFile ? { outputFile } : {}), ...entryFields }, ['url']);
    } else {
      await removeFile(foldedFile);
      await setState(name, 'done', { readAt, durationMs, result: { records: recordCount, ...result }, ...entryFields }, ['url']);
    }
    await removeFile(jsonl);
    if (hookStop) throw new BulkStop(hookStop.code, hookStop.message || `Shopify extract stopped (${hookStop.code}) at ${name}.`, { details: { query: name, entity: entityOf(name), ...(hookStop.details || {}) } });
  }

  async function processQuery(name) {
    for (;;) {
      const target = entry(name);
      switch (target.state) {
        case 'done':
          return;
        case 'denied':
          if (isStopping(target, caller)) throw stopFor(name, target, null, { later: true });
          return;
        case 'failed':
          if (extract) throw stopFor(name, target, null, { later: true });
          return;
        case 'settling': {
          const stop = await finishSettling(name);
          if (stop) throw stop;
          break;
        }
        case 'starting':
          dropOperation(name);
          await setState(name, 'pending');
          break;
        case 'pending':
          await startQuery(name);
          break;
        case 'running':
          await processRunning(name);
          break;
        case 'downloaded':
          await reassemble(name);
          break;
        default:
          throw new Error(`unknown query state ${target.state} for ${name}`);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Resume resets
  // -------------------------------------------------------------------------------------------

  async function cleanLeftovers() {
    let names = [];
    try {
      names = await fsp.readdir(stagingDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const leftover of names.filter((file) => file.endsWith('.partial') || file.endsWith('.tmp'))) await removeFile(path.join(stagingDir, leftover));
    // A crash between the `done` write and the JSONL delete leaves the file behind.
    for (const name of manifest.order) if (entry(name).state === 'done') await removeFile(path.join(stagingDir, `${name}.jsonl`));
  }

  function resetEntry(name, fields = {}) {
    const target = entry(name);
    dropOperation(name);
    for (const field of ['outcome', 'errorCode', 'error', 'settlingAt', 'handlerOutcome', 'deniedAt', 'readAt', 'durationMs', 'records', 'result', 'bytes', 'lines']) delete target[field];
    Object.assign(target, { state: 'pending', attempts: 0, downloadTries: 0, linkReruns: 0, reapproved: false }, fields);
  }

  async function applyResets() {
    if (!extract) return;
    let changed = false;
    if (typeof deniedReset === 'function') {
      for (const reset of (await deniedReset({ manifest, projectDir })) || []) {
        resetEntry(reset.name, { text: reset.text });
        changed = true;
      }
    }
    if (retryFailed) {
      for (const name of manifest.order) {
        if (isStopping(entry(name), caller)) { resetEntry(name); changed = true; }
      }
      if (manifest.countFailure && manifest.countFailure.entities) {
        for (const failedEntity of manifest.countFailure.entities) {
          for (const name of manifest.order.filter((candidate) => entityOf(candidate) === failedEntity)) {
            await removeFile(path.join(stagingDir, `${name}.ndjson`));
            resetEntry(name);
          }
        }
        delete manifest.countFailure;
        changed = true;
      }
    }
    // A `done` extract entry promises its staged output, and a resume never reads a
    // finished query again. When that output is gone before the final join, read the query again
    // without spending an attempt instead of joining the hole as an empty dataset.
    for (const name of manifest.order) {
      const target = entry(name);
      if (target.state !== 'done') continue;
      const files = [target.outputFile || `${name}.ndjson`, ...(target.sidecars || []).map((sidecar) => `sidecar-${sidecar}.ndjson`)].map((file) => path.join(stagingDir, file));
      const present = await Promise.all(files.map((file) => fsp.access(file).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; })));
      if (present.every(Boolean)) continue;
      for (const file of files) await removeFile(file);
      resetEntry(name);
      changed = true;
    }
    if (changed) await save('resets');
  }

  // -------------------------------------------------------------------------------------------
  // Extract: the final join and the count check
  // -------------------------------------------------------------------------------------------

  function expectedFinalFiles() {
    const entities = [...new Set(manifest.order.map(entityOf))];
    return [
      ...entities.map((entity) => {
        const first = manifest.order.find((name) => entityOf(name) === entity);
        return (first && entry(first).outputFile) || `${entity}.ndjson`;
      }),
      ...(manifest.sidecars || []).map((entity) => `${entity}.ndjson`),
    ];
  }

  async function joinFinalFiles() {
    await fsp.mkdir(outputDir, { recursive: true });
    const staged = (name) => path.join(stagingDir, `${name}.ndjson`);
    let droppedOrphans = 0;
    const droppedByQuery = {};
    for (const entity of [...new Set(manifest.order.map(entityOf))]) {
      const members = manifest.order.filter((name) => entityOf(name) === entity);
      if (entity !== 'orders') {
        const outputFile = entry(members[0]).outputFile || `${entity}.ndjson`;
        const stagedFile = entry(members[0]).outputFile || `${members[0]}.ndjson`;
        await copyFileAtomic(path.join(stagingDir, stagedFile), path.join(outputDir, outputFile));
        continue;
      }
      const joined = await joinOrderFiles({
        coreFile: staged('orders-core'),
        refundsFile: members.includes('orders-refunds') ? staged('orders-refunds') : null,
        fulfillmentsFile: members.includes('orders-fulfillments') ? staged('orders-fulfillments') : null,
        outputFile: path.join(outputDir, 'orders.ndjson'),
        workDir: stagingDir,
      });
      droppedOrphans += joined.droppedOrphans;
      Object.assign(droppedByQuery, joined.droppedByQuery);
    }
    for (const sidecar of manifest.sidecars || []) await copyFileAtomic(path.join(stagingDir, `sidecar-${sidecar}.ndjson`), path.join(outputDir, `${sidecar}.ndjson`));
    const currentSidecars = new Set(manifest.sidecars || []);
    for (const sidecar of new Set([...(manifest.previousSidecars || []), ...(manifest.obsoleteSidecars || [])])) {
      if (!currentSidecars.has(sidecar)) await removeFile(path.join(outputDir, `${sidecar}.ndjson`));
    }
    manifest.droppedOrphans = droppedOrphans;
    manifest.droppedOrphansByQuery = droppedByQuery;
  }

  const COUNT_QUERIES = {
    customers: (snapshot) => `query RpExtractCustomersCount { customersCount(query: "created_at:<='${snapshot}'", limit: null) { count precision } }`,
    orders: (snapshot) => `query RpExtractOrdersCount { ordersCount(query: "created_at:<='${snapshot}'", limit: null) { count precision } }`,
  };

  async function readExactCount(entity) {
    const root = entity === 'customers' ? 'customersCount' : 'ordersCount';
    let result;
    try {
      result = await execute(COUNT_QUERIES[entity](manifest.snapshotTime));
    } catch (error) {
      if (error instanceof ShopifyCliError && error.code === 'shopify_throttled') return { error: { code: 'shopify_throttled', message: error.message } };
      throw error;
    }
    if (result.errors && result.errors.length) return { error: { code: 'GRAPHQL_ERROR', message: result.errors.map((error) => error && error.message).filter(Boolean).join('; ').slice(0, 300) } };
    const counted = result.data && result.data[root];
    if (!counted || !Number.isInteger(counted.count)) return { error: { code: 'COUNT_MISSING', message: 'the count read returned no count' } };
    return { count: counted.count, precision: counted.precision || null };
  }

  async function countCheck() {
    const customersReceived = (await countLines(path.join(outputDir, 'customers.ndjson'))) || 0;
    const withheld = (manifest.sidecars || []).includes('customers-withheld-identity') ? ((await countLines(path.join(outputDir, 'customers-withheld-identity.ndjson'))) || 0) : 0;
    const received = { customers: customersReceived + withheld, orders: (await countLines(path.join(outputDir, 'orders.ndjson'))) || 0 };
    manifest.counts = {};
    const rows = [];
    const stopCodes = [];
    for (const entity of ['customers', 'orders']) {
      const expected = await readExactCount(entity);
      const record = { received: received[entity], ...(entity === 'customers' ? { withheldIdentity: withheld } : {}) };
      let outcome;
      if (expected.error) {
        outcome = 'inexact';
        Object.assign(record, { error: expected.error });
      } else if (expected.precision !== 'EXACT') {
        outcome = 'inexact';
        Object.assign(record, { expected: expected.count, precision: expected.precision });
      } else if (received[entity] < expected.count) {
        outcome = 'short';
        Object.assign(record, { expected: expected.count, precision: expected.precision });
      } else {
        outcome = 'pass';
        Object.assign(record, { expected: expected.count, precision: expected.precision });
      }
      record.outcome = outcome;
      manifest.counts[entity] = record;
      if (outcome === 'pass') continue;
      const code = outcome === 'short' ? 'shopify_extract_count_short' : 'shopify_extract_count_inexact';
      const pointer = outcome === 'short'
        ? `counts.${entity}: received ${record.received} < Shopify's exact count ${record.expected} (precision ${record.precision})`
        : `counts.${entity}: Shopify's count is not exact (${record.error ? `${record.error.code}: ${record.error.message}` : `precision ${record.precision}`}); received ${record.received}`;
      rows.push(coverageRowFor(orderQueryOf(entity), { artifact: `${RAW_EXTRACT_DIR}/${EXTRACT_MANIFEST_FILE}`, pointer, recoveryAction: `Run shopify-extract.js --retry-failed to read ${entity} again, or decide the shortfall at mapping.` }));
      stopCodes.push({ code, entity });
    }
    if (!stopCodes.length) { await save('counts'); return; }
    manifest.countFailure = { entities: stopCodes.map((stop) => stop.entity), codes: stopCodes.map((stop) => stop.code) };
    await save('counts');
    const result = await upsertAdapterCoverageRows(projectDir, { adapter: 'shopify', rows });
    throw new ShopifyExtractStop(stopCodes[0].code, `Shopify extract stopped (${stopCodes[0].code}): ${rows.map((row) => row.coverageId).join(', ')} recorded as source-coverage row(s) for the merchant's decision at mapping. Counts: ${JSON.stringify(manifest.counts)}. Requires Import Operator: after any cause is fixed, run \`shopify-extract.js --retry-failed\` to read the dataset again; when the extract completes, record the coverage decision \`provided\` for each row, otherwise show the merchant the row at mapping.`, { coverageIds: rows.map((row) => row.coverageId), ...result });
  }

  function orderQueryOf(entity) {
    return entity === 'customers' ? 'customers' : 'orders-core';
  }

  async function finishExtract() {
    if (!manifest.order.every((name) => entry(name).state === 'done')) {
      const open = manifest.order.filter((name) => entry(name).state !== 'done');
      throw new BulkStop(STOPPING_FAILED_CODE, `The extract cannot finish: ${open.join(', ')} ${open.length === 1 ? 'is' : 'are'} not read (${open.map((name) => `${name} ${entry(name).state}`).join(', ')}). Nothing was marked complete.`, { details: { open } });
    }
    await joinFinalFiles();
    await save('joined');
    await countCheck();
    manifest.status = 'complete';
    manifest.completedAt = iso(now());
    delete manifest.countFailure;
    await save('complete');
    await fsp.rm(stagingDir, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------------------------
  // run()
  // -------------------------------------------------------------------------------------------

  async function filesPresent() {
    for (const file of expectedFinalFiles()) {
      try {
        await fsp.access(path.join(outputDir, file));
      } catch {
        return false;
      }
    }
    return true;
  }

  async function runInner() {
    manifest = await readManifest();
    let storeMatches = !manifest;
    if (manifest && manifest.store) {
      try {
        storeMatches = session.normalizeDomain(manifest.store) === normalizedStore;
      } catch {
        storeMatches = false;
      }
    }
    if (manifest && !storeMatches) {
      const recorded = manifest.store || null;
      manifest = null;
      throw new BulkStop('shopify_extract_store_mismatch', `${path.basename(manifestPath)} was read from ${recorded || 'an unrecorded store'}, not ${normalizedStore}. Nothing was read or changed.`, { details: { recorded, store: normalizedStore } });
    }
    if (!manifest) {
      if (!Array.isArray(queries) || !queries.length) throw new Error('queries are required to start a new manifest');
      manifest = newManifest({ caller, store: normalizedStore, snapshotTime: extract ? snapshotTime : null, queries, previousSidecars, now });
      await save('created');
    }
    if (extract && manifest.status === 'complete') {
      if (!(await filesPresent())) {
        throw new BulkStop('shopify_extract_files_missing', `The extract manifest says complete but its final files are missing from ${path.relative(projectDir, outputDir)}. Run shopify-extract.js --catch-up to read the store again.`);
      }
      await fsp.rm(stagingDir, { recursive: true, force: true });
      return { status: 'complete', skipped: true };
    }
    if (manifest.lastStop) { delete manifest.lastStop; await save('cleared-stop'); }
    await settleAll();
    await cleanLeftovers();
    await applyResets();
    for (const name of manifest.order) {
      if (isStopping(entry(name), caller)) throw stopFor(name, entry(name), null, { later: true });
    }
    for (const name of manifest.order) await processQuery(name);
    if (extract) await finishExtract();
    else { manifest.status = 'complete'; manifest.completedAt = iso(now()); await save('complete'); }
    return { status: 'complete' };
  }

  async function run() {
    let stop = null;
    try {
      const outcome = await runInner();
      return { ...outcome, manifest };
    } catch (error) {
      if (error instanceof BulkStop) stop = error;
      else if (error instanceof ShopifyExtractStop) stop = new BulkStop(error.code, error.message, { details: error.details });
      else if (error instanceof ShopifyCliError && error.code === 'source_auth_expired') stop = await authExpiredStop();
      else if (error instanceof ShopifyCliError) stop = new BulkStop(error.code, error.message, { details: { cli: true } });
      else throw error;
    }
    if (manifest) {
      manifest.lastStop = { code: stop.code, message: stop.message, status: stop.status, at: iso(now()) };
      await save('stopped');
    }
    return { status: stop.status, code: stop.code, message: stop.message, details: stop.details, manifest };
  }

  return { run, get manifest() { return manifest; } };
}

module.exports = {
  QUERIES_DIR,
  QUERY_CATALOG,
  QUERY_NAMES,
  CUSTOMER_QUERIES,
  ORDER_QUERIES,
  DENIAL_ATTRIBUTED_QUERIES,
  MANIFEST_SCHEMA_VERSION,
  EXTRACT_MANIFEST_FILE,
  RAW_EXTRACT_DIR,
  SNAPSHOT_PLACEHOLDER,
  STATUS_QUERY,
  POLL_START_MS,
  POLL_CAP_MS,
  OVERDUE_MS,
  MAX_DOWNLOAD_TRIES,
  MAX_LINK_RERUNS,
  BulkStop,
  catalogEntry,
  entityOf,
  readQueryFile,
  generateQueryText,
  connectionShape,
  validateJsonlFile,
  foldBulkJsonl,
  joinOrderFiles,
  defaultDownload,
  registerHandlers,
  clearRegisteredHandlers,
  registeredProjection: () => registered.project,
  createBulkRunner,
};
