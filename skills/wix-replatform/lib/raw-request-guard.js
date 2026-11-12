'use strict';

// A native entity with no reviewed rp-target-wix writer is written by guarded raw
// requests. The agent picks method and URL; this module holds the rules the import client checks
// on every such request, the run journal of each call, and the first-record (canary) state.
//
// The readiness grant checks only the request body. What ties a raw request to its entity is
// here: the task's own entity, no DELETE, www.wixapis.com only, and never a URL that belongs to
// another entity's reviewed writer or to a toolkit-only operation (site mute, app install).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = 'www.wixapis.com';
// Toolkit-only services: a raw request must never unmute notifications, install an app, change
// a CMS collection schema or the site's business properties. Setup owns those.
const RESERVED_PREFIXES = Object.freeze(['/notification-preferences', '/apps-installer-service', '/wix-data/v2/collections', '/site-properties']);
const domainsDir = path.resolve(__dirname, '../resources/rp-target-wix/domains');
const toolkitDirs = [path.resolve(__dirname, '../resources/rp-target-wix/lib'), __dirname];

function fail(code, detail) { throw Object.assign(new Error(detail ? `${code}:${detail}` : code), { code, detail: detail || null, requestSent: false, outcomeKnown: true }); }
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value === undefined ? null : value)).digest('hex');
// Prefixes are compared lower-case with no trailing slash; the path is checked for that form too.
const normal = prefix => prefix.toLowerCase().replace(/\/+$/, '');

// The static part of every "METHOD /path" an entity's knowledge names, cut at the first `{`.
function endpointPrefixes(k) {
  const text = [k.preferredWrite?.endpoint, ...(k.preferredWrite?.writerScope?.rawEndpoints || []), ...Object.values(k.operationContracts || {}).map(c => c?.endpoint)].filter(v => typeof v === 'string').join(' ');
  const out = new Set();
  for (const match of text.matchAll(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+(?:https:\/\/www\.wixapis\.com)?(\/[^\s,;)]+)/g)) {
    const prefix = normal(match[1].split('{')[0].split('?')[0]);
    if (prefix.length > 1) out.add(prefix);
  }
  return [...out];
}
function allEntityRefs() {
  const index = JSON.parse(fs.readFileSync(path.join(domainsDir, 'index.json'), 'utf8'));
  return Object.entries(index.domains || {}).flatMap(([domain, row]) => Object.keys(row.entities || {}).map(entity => `${domain}/${entity}`)).sort();
}
function readKnowledge(ref) {
  try { return require('./dependency-proofs').domain(ref); } catch { return null; }
}
// Every www.wixapis.com path the toolkit's own code builds, by the entity its builder marks
// ('toolkit' when no mark names one). Read from the source, like the registry contract test, so a
// new builder joins automatically. A base constant (`const BASE = '…/stores/v3'`) is expanded
// where it is used; only prefixes of three or more segments count, so a bare base never covers a
// whole service.
function builderUrlPrefixes() {
  const out = [];
  for (const dir of toolkitDirs) for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.js') && file !== path.basename(__filename))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    const bases = new Map();
    for (const m of source.matchAll(/const ([A-Z_]+) = (['"`])https:\/\/www\.wixapis\.com([^'"`$]*)\2/g)) bases.set(m[1], m[3]);
    for (const m of source.matchAll(/const ([A-Z_]+) = `\$\{([A-Z_]+)\}([^`$]*)`/g)) if (bases.has(m[2])) bases.set(m[1], bases.get(m[2]) + m[3]);
    // Which entity a function's requests are for: its own mark, or the marked builder wrapping it.
    const entityOf = new Map();
    for (const m of source.matchAll(/const (\w+) = \(\.\.\.args\) => markRequest\((\w+)\(\.\.\.args\), \{([^}]*)\}\)/g)) {
      const entity = m[3].match(/["']?entity["']?:\s*["']([a-z-]+\/[a-z-]+)["']/)?.[1];
      if (entity && !entity.startsWith('internal/')) { entityOf.set(m[1], entity); entityOf.set(m[2], entity); }
    }
    const defs = [...source.matchAll(/^(?:async )?(?:const (\w+) =|function (\w+)\()/gm)].map(m => ({ index: m.index, name: m[1] || m[2] }));
    const owner = index => { let name = null; for (const def of defs) { if (def.index > index) break; name = def.name; } return entityOf.get(name) || 'toolkit'; };
    const add = (raw, index) => {
      const prefix = normal(raw.split('${')[0].split('?')[0]);
      if (prefix.split('/').filter(Boolean).length >= 3) out.push({ entityRef: owner(index), prefix });
    };
    for (const m of source.matchAll(/`\$\{([A-Z_]+)\}(\/[^`]*)`/g)) if (bases.has(m[1])) add(bases.get(m[1]) + m[2], m.index);
    for (const m of source.matchAll(/(['"`])https:\/\/www\.wixapis\.com(\/[^'"`]*)\1/g)) add(m[2], m.index);
    for (const [, value] of bases) add(value, 0);
  }
  return out;
}
let ownedCache = null;
// Every URL prefix that belongs to a reviewed writer: the knowledge endpoints of each entity that
// has one, and every path the toolkit's builders send. Rebuilt from code, never hand-kept.
function reviewedWriterPrefixes() {
  if (ownedCache) return ownedCache;
  const support = require('./target-import-support');
  const rows = [...allEntityRefs().filter(ref => support.hasReviewedWriter(ref))
    .flatMap(ref => endpointPrefixes(readKnowledge(ref) || {}).map(prefix => ({ entityRef: ref, prefix }))), ...builderUrlPrefixes()];
  const unique = new Map(rows.map(row => [`${row.entityRef} ${row.prefix}`, Object.freeze(row)]));
  ownedCache = Object.freeze([...unique.values()]);
  return ownedCache;
}
const under = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
// A delete exposed as a POST (`…/bulk/delete`, `…/delete-by-filter`, `…:delete`) is a delete.
const DELETE_SEGMENT = /(?:^|[-_:.])delete(?:$|[-_:.])/i;

// Null when the request may be sent for `entityRef`; otherwise the refusal reason. A write is
// POST, PUT or PATCH; a read (`read: true`) is GET only.
function refusal({ entityRef, method, url, body } = {}, { read = false } = {}) {
  const support = require('./target-import-support');
  if (typeof entityRef !== 'string' || !readKnowledge(entityRef)) return 'unknown-entity';
  if (!support.rawRequestEntity(entityRef)) return support.hasReviewedWriter(entityRef) ? 'reviewed-writer-exists' : 'not-native';
  // A scoped reviewed writer leaves only the records it does not cover to the raw path.
  const scoped = support.rawScopeRefusal(entityRef, { url, body });
  if (scoped) return scoped;
  if (!read && support.importUnsafe(entityRef)) return 'import-unsafe';
  const verb = String(method || '').toUpperCase();
  if (verb === 'DELETE') return 'delete';
  if (!(read ? ['GET'] : ['POST', 'PUT', 'PATCH']).includes(verb)) return 'method';
  let parsed;
  try { parsed = new URL(url); } catch { return 'url'; }
  if (parsed.protocol !== 'https:' || parsed.host !== HOST || parsed.username || parsed.password || parsed.port) return 'host';
  // Only a plain path is compared: an encoded byte, a matrix parameter or an empty segment could
  // read differently at the gateway than here.
  const segments = parsed.pathname.replace(/\/+$/, '').split('/').slice(1);
  if (/[%;]/.test(parsed.pathname) || !segments.length || segments.some(segment => !segment)) return 'path';
  const pathname = `/${segments.join('/')}`.toLowerCase();
  if (RESERVED_PREFIXES.some(prefix => under(pathname, prefix))) return 'reserved';
  if (read) return null;
  if (segments.some(segment => DELETE_SEGMENT.test(segment))) return 'delete';
  // The longest matching prefix decides. The entity's own knowledge endpoint wins a tie: it is
  // that entity's documented write path even when a toolkit helper calls the same service.
  const own = endpointPrefixes(readKnowledge(entityRef)).filter(prefix => under(pathname, prefix)).reduce((max, p) => Math.max(max, p.length), 0);
  const other = reviewedWriterPrefixes().find(row => row.entityRef !== entityRef && under(pathname, row.prefix) && row.prefix.length > own);
  return other ? `other-entity:${other.entityRef}` : null;
}
function assertAllowed(request, options) {
  const reason = refusal(request, options);
  if (reason) fail('RAW_REQUEST_REFUSED', reason);
}

// --- run journal ----------------------------------------------------------------------------
// One row before each raw call (`started`) and one after (`succeeded`, `failed`, `refused`). A
// `started` row with no later outcome is an unknown outcome: the record is never retried
// automatically. The journal sits beside the write-attempt journal; it is never pruned.
const journalPath = projectDir => path.join(projectDir, 'state', 'attempts', 'raw-requests.ndjson');
const canaryPath = projectDir => path.join(projectDir, 'state', 'attempts', 'raw-request-canaries.ndjson');
// Rows are read incrementally: each call reads only the bytes appended since the last one, so a
// long import does not re-read its whole journal per request.
const tails = new Map();
function readRows(file) {
  let tail = tails.get(file);
  let size;
  try { size = fs.statSync(file).size; } catch (error) { if (error.code === 'ENOENT') { tails.delete(file); return []; } throw error; }
  if (!tail || size < tail.offset) tail = { offset: 0, partial: '', rows: [] };
  if (size > tail.offset) {
    const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(size - tail.offset);
    try { fs.readSync(fd, bytes, 0, bytes.length, tail.offset); } finally { fs.closeSync(fd); }
    const lines = (tail.partial + bytes.toString('utf8')).split('\n');
    tail.partial = lines.pop();
    for (const line of lines) if (line) tail.rows.push(JSON.parse(line));
    tail.offset = size;
  }
  tails.set(file, tail);
  return tail.rows;
}
function appendRow(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), ...row })}\n`);
}
const keysOf = request => request.sourceStableKeys !== undefined ? [...request.sourceStableKeys] : [request.sourceStableKey];
function journalStarted(ctx, entityRef, request) {
  const callId = crypto.randomUUID();
  appendRow(journalPath(ctx.projectDir), { kind: 'raw-request', status: 'started', callId, runId: ctx.runId, taskId: ctx.taskId, entityRef,
    sourceStableKeys: keysOf(request), method: String(request.method).toUpperCase(), url: request.url, bodyDigest: digest(request.body) });
  return callId;
}
function journalOutcome(ctx, callId, entityRef, status, extra = {}) {
  appendRow(journalPath(ctx.projectDir), { kind: 'raw-request', status, callId, runId: ctx.runId, taskId: ctx.taskId, entityRef, ...extra });
}
// The journal folded into calls (in order), resolutions, and the first live call per run and
// entity. Folded incrementally, like the rows.
const folds = new Map();
function fold(projectDir) {
  const file = journalPath(projectDir), rows = readRows(file);
  let state = folds.get(file);
  if (!state || state.rows !== rows || state.seen > rows.length) state = { rows, seen: 0, byId: new Map(), resolved: new Set(), open: new Map() };
  for (; state.seen < rows.length; state.seen++) {
    const row = rows[state.seen];
    if (row.status === 'started') { const call = { ...row, outcome: null }; state.byId.set(row.callId, call); state.open.set(row.callId, call); }
    else if (row.status === 'resolved') { state.resolved.add(row.callId); state.open.delete(row.callId); }
    else if (state.byId.has(row.callId)) { state.byId.get(row.callId).outcome = row; state.open.delete(row.callId); }
  }
  folds.set(file, state);
  return state;
}
const calls = projectDir => [...fold(projectDir).byId.values()];
// Source keys with a raw call of unknown outcome, per entity. Cleared only by a recorded
// resolution (the operator checked the site), never by a retry.
function unknownKeys(projectDir, entityRef) {
  const out = new Set();
  for (const call of fold(projectDir).open.values()) if (call.entityRef === entityRef) for (const key of call.sourceStableKeys) out.add(key);
  return out;
}
function resolveUnknownOutcome(projectDir, { callId, resolution, evidence }) {
  if (!['written', 'not-written'].includes(resolution) || typeof evidence !== 'string' || !evidence.trim()) fail('RAW_REQUEST_RESOLUTION_INVALID');
  const { byId, resolved } = fold(projectDir), call = byId.get(callId);
  if (!call || call.outcome || resolved.has(callId)) fail('RAW_REQUEST_RESOLUTION_INVALID', 'no-unknown-call');
  appendRow(journalPath(projectDir), { kind: 'raw-request', status: 'resolved', callId, entityRef: call.entityRef, resolution, evidence });
}

// --- first record (canary) ------------------------------------------------------------------
// Per run and entity: the first source key written is the canary. Until its read-back passes,
// only the canary key may be written; a mismatch holds the entity for the rest of the run.
function canaryVerdict(projectDir, runId, entityRef) {
  return readRows(canaryPath(projectDir)).filter(row => row.runId === runId && row.entityRef === entityRef).at(-1) || null;
}
function canaryKey(projectDir, runId, entityRef) {
  const first = calls(projectDir).find(call => call.runId === runId && call.entityRef === entityRef && (!call.outcome || call.outcome.status === 'succeeded'));
  return first ? first.sourceStableKeys[0] : null;
}
function assertWritable(ctx, entityRef, request) {
  const keys = keysOf(request);
  if (keys.some(key => typeof key !== 'string' || !key)) fail('RAW_REQUEST_REFUSED', 'source-key');
  const unknown = unknownKeys(ctx.projectDir, entityRef);
  const blocked = keys.find(key => unknown.has(key));
  if (blocked) fail('RAW_REQUEST_OUTCOME_UNKNOWN', `${entityRef}:${blocked}`);
  const verdict = canaryVerdict(ctx.projectDir, ctx.runId, entityRef);
  if (verdict?.verdict === 'mismatch') fail('RAW_REQUEST_ENTITY_HELD', entityRef);
  if (verdict?.verdict === 'passed') return;
  const canary = canaryKey(ctx.projectDir, ctx.runId, entityRef);
  if (keys.length !== 1 || (canary && keys[0] !== canary)) fail('RAW_REQUEST_CANARY_PENDING', entityRef);
}
// Every leaf the canary sent must read back equal at the same path, except `ignorePaths`, each
// with a reason (a write-only field, a server-normalized value). Returns the differing paths.
// Every leaf path of a body, in the syntax `compare` reports (`a.b[0].c`).
function leafPaths(value, at = '') {
  if (!value || typeof value !== 'object') return at ? [at] : [];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, Array.isArray(value) ? `${at}[${key}]` : at ? `${at}.${key}` : key));
}
function compare(sent, readBack, ignorePaths = []) {
  const ignored = new Set(ignorePaths.map(row => row.path));
  const out = [];
  const walk = (value, actual, at) => {
    if (ignored.has(at)) return;
    if (value && typeof value === 'object') {
      if (!actual || typeof actual !== 'object' || Array.isArray(value) !== Array.isArray(actual)) { out.push(at || '$'); return; }
      for (const [key, child] of Object.entries(value)) walk(child, actual[key], Array.isArray(value) ? `${at}[${key}]` : at ? `${at}.${key}` : key);
      return;
    }
    if (value !== actual) out.push(at || '$');
  };
  walk(sent, readBack, '');
  return out;
}
function recordCanary(ctx, entityRef, { sourceStableKey, sentBody, sentPath = null, readBack, ignorePaths = [] }) {
  if (sentPath !== null && (typeof sentPath !== 'string' || !sentPath)) fail('RAW_REQUEST_CANARY_INVALID', 'sent-path');
  if (!Array.isArray(ignorePaths) || ignorePaths.some(row => !row || typeof row.path !== 'string' || typeof row.reason !== 'string' || !row.reason.trim())) fail('RAW_REQUEST_CANARY_INVALID', 'ignore-paths');
  if (canaryVerdict(ctx.projectDir, ctx.runId, entityRef)) fail('RAW_REQUEST_CANARY_INVALID', 'already-recorded');
  if (sourceStableKey !== canaryKey(ctx.projectDir, ctx.runId, entityRef)) fail('RAW_REQUEST_CANARY_INVALID', 'not-the-canary');
  // The body compared is the one the client sent and journaled, never a body supplied afterwards.
  const sent = calls(ctx.projectDir).find(call => call.runId === ctx.runId && call.entityRef === entityRef && call.sourceStableKeys[0] === sourceStableKey
    && call.outcome?.status === 'succeeded' && call.bodyDigest === digest(sentBody));
  if (!sent) fail('RAW_REQUEST_CANARY_INVALID', 'not-sent');
  const compared = sentPath ? sentPath.split('.').reduce((value, key) => value?.[key], sentBody) : sentBody;
  if (!compared || typeof compared !== 'object') fail('RAW_REQUEST_CANARY_INVALID', 'sent-path');
  // An ignore path names one leaf of the compared body, never the root or a whole branch, and
  // something must be left to compare: a canary that compares nothing has not checked anything.
  const leaves = leafPaths(compared);
  if (ignorePaths.some(row => !leaves.includes(row.path))) fail('RAW_REQUEST_CANARY_INVALID', 'ignore-path-not-a-leaf');
  if (!leaves.some(leaf => !ignorePaths.some(row => row.path === leaf))) fail('RAW_REQUEST_CANARY_INVALID', 'nothing-compared');
  const mismatches = compare(compared, readBack, ignorePaths);
  const row = { runId: ctx.runId, taskId: ctx.taskId, entityRef, sourceStableKey, verdict: mismatches.length ? 'mismatch' : 'passed', mismatches, sentPath, ignorePaths };
  appendRow(canaryPath(ctx.projectDir), row);
  return row;
}

// What cutover and the completion report need, per entity, from the journal alone.
function summary(projectDir) {
  const all = calls(projectDir), resolvedRows = readRows(journalPath(projectDir)).filter(row => row.status === 'resolved');
  const canaries = readRows(canaryPath(projectDir));
  const entities = [...new Set(all.map(call => call.entityRef))].sort();
  return entities.map(entityRef => {
    const own = all.filter(call => call.entityRef === entityRef), resolved = new Set(resolvedRows.map(row => row.callId));
    const latest = canaries.filter(row => row.entityRef === entityRef).at(-1) || null;
    return {
      entityRef, writer: 'raw-request', calls: own.length,
      succeeded: own.filter(call => call.outcome?.status === 'succeeded').length,
      failed: own.filter(call => ['failed', 'refused'].includes(call.outcome?.status)).length,
      unknownOutcome: own.filter(call => !call.outcome && !resolved.has(call.callId)).map(call => ({ callId: call.callId, sourceStableKeys: call.sourceStableKeys, method: call.method, url: call.url })),
      canary: latest ? { runId: latest.runId, verdict: latest.verdict, mismatches: latest.mismatches } : null,
    };
  });
}

module.exports = { refusal, assertAllowed, reviewedWriterPrefixes, builderUrlPrefixes, endpointPrefixes, journalPath, canaryPath, journalStarted, journalOutcome,
  assertWritable, recordCanary, compare, leafPaths, summary, resolveUnknownOutcome, unknownKeys, RESERVED_PREFIXES, digest };
