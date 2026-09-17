'use strict';

// Client for wix-wp-plugin-v2 (spec 0101) -- the ONLY bridge-plugin-style mechanism this
// skill uses for data with no REST route at all (db-only, or admin-page-only with an
// underlying table). There is no per-capability fixed adapter any more: any db-only
// entity's fulfillment can point at this SAME handler with a different `table`, because
// wix-wp-plugin-v2 itself has no per-capability code -- see plugins/wix-wp-plugin-v2/README.md.
//
// Two capabilities, matching the plugin's own two routes:
//   - discoverStructure(): schema only (columns, types, key hints). Safe to call before a
//     human has decided anything about a table -- no row data leaves the site.
//   - queryStructure(): real row data, via one bounded, parameterized SELECT (select
//     columns/aggregates, optional where/groupBy, required orderBy, cursor pagination).
//     Pulling real data through this for a specific entity is a per-entity decision, not
//     implied by schema-discoverability -- e.g. gift-card-activity's balance/redemption
//     ledger still needs its own masking/correlation call (issue #186) even though its
//     schema is freely discoverable.

const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');

const HANDLER_VERSION = '1.3.0'; // 1.3.0: signed migration-key transport plus strict response-envelope validation.

function bodyOf(response) {
  return response && response.data !== undefined ? response.data : response;
}

function assertColumn(column, table) {
  if (!column || typeof column.name !== 'string' || column.name.length === 0) {
    throw new Error(`table ${table}: column name is required`);
  }
  if (typeof column.type !== 'string' || column.type.length === 0) {
    throw new Error(`table ${table}: column ${column.name} is missing a type`);
  }
  if (typeof column.nullable !== 'boolean') {
    throw new Error(`table ${table}: column ${column.name} is missing nullable`);
  }
  if (column.key !== null && !['primary', 'unique', 'index'].includes(column.key)) {
    throw new Error(`table ${table}: column ${column.name} has an invalid key hint ${JSON.stringify(column.key)}`);
  }
}

const EAV_TIERS = ['key-discovery', 'key-scoped'];

/**
 * `redactionMetadata`, required on every response (spec 0122 §5) and validated against the
 * schema's actual contract: a NON-NEGATIVE INTEGER count and an array of STRINGS.
 *
 * The loose version accepted `-1.5` and `[7]`, which was not merely untidy. Those values flow
 * straight into `sourceReadCounts()` and on to rp-telemetry, whose validator correctly rejects
 * them -- so a malformed count silently discarded the whole accumulated telemetry batch, far
 * from the response that caused it. Validate at the boundary, where the error can still name
 * the table.
 */
function assertRedactionMetadata(redactionMetadata, table) {
  if (!redactionMetadata || typeof redactionMetadata !== 'object' || Array.isArray(redactionMetadata)) {
    throw new Error(
      `table ${table}: response is missing redactionMetadata, which spec 0122 §5 requires on every `
      + 'query-structure response. The source site is running a wix-wp-plugin-v2 older than 0.4.0, which has no '
      + 'secret-value guard -- upgrade the plugin rather than treating this as an empty redaction set.',
    );
  }
  const { redactedValueCount, redactedColumns } = redactionMetadata;
  if (!Number.isInteger(redactedValueCount) || redactedValueCount < 0) {
    throw new Error(`table ${table}: redactionMetadata.redactedValueCount must be a non-negative integer (got ${JSON.stringify(redactedValueCount)})`);
  }
  if (!Array.isArray(redactedColumns) || redactedColumns.some((c) => typeof c !== 'string')) {
    throw new Error(`table ${table}: redactionMetadata.redactedColumns must be an array of column names`);
  }
  if (redactedValueCount > 0 && redactedColumns.length === 0) {
    throw new Error(`table ${table}: redactionMetadata reports ${redactedValueCount} redaction(s) but names no column -- a count with no column is not actionable`);
  }
  return { redactedValueCount, redactedColumns: [...redactedColumns] };
}

/** A {keyColumn, valueColumn} pair, as reported by either route. */
function assertPairShape(pair, table, where) {
  if (!pair || typeof pair.keyColumn !== 'string' || typeof pair.valueColumn !== 'string') {
    throw new Error(`table ${table}: ${where} must carry string keyColumn and valueColumn`);
  }
  return { keyColumn: pair.keyColumn, valueColumn: pair.valueColumn };
}

/**
 * discover-structure's `eavPair`. Absent for an ordinary table; when present it names the
 * column a query must pin. `additionalPairs` appears only for the rare schema carrying more
 * than one recognized pair -- and it is propagated rather than dropped, because every one of
 * those value columns is independently guarded and a caller that saw only the first would
 * build a request the plugin refuses.
 */
function assertEavPair(eavPair, table) {
  if (eavPair === undefined || eavPair === null) return null;
  const pair = assertPairShape(eavPair, table, 'eavPair');
  if (eavPair.additionalPairs !== undefined) {
    if (!Array.isArray(eavPair.additionalPairs)) throw new Error(`table ${table}: eavPair.additionalPairs must be an array`);
    pair.additionalPairs = eavPair.additionalPairs.map((p) => assertPairShape(p, table, 'eavPair.additionalPairs[]'));
  }
  return pair;
}

/**
 * query-structure's `eavAccess`. Absent for a table with no key/value pair; present with a
 * tier and the key names the request pinned otherwise. Validated rather than passed through
 * so a caller can branch on `tier` without re-checking the shape.
 */
function assertAccessPair(pair, table, where) {
  const shape = assertPairShape(pair, table, where);
  if (!EAV_TIERS.includes(pair.tier)) {
    throw new Error(`table ${table}: ${where}.tier ${JSON.stringify(pair.tier)} is not one of ${EAV_TIERS.join(', ')}`);
  }
  if (!Array.isArray(pair.pinnedKeys) || pair.pinnedKeys.some((k) => typeof k !== 'string')) {
    throw new Error(`table ${table}: ${where}.pinnedKeys must be an array of key names`);
  }
  return { ...shape, tier: pair.tier, pinnedKeys: [...pair.pinnedKeys] };
}

/**
 * query-structure's `eavAccess`. Absent for a table with no key/value pair.
 *
 * EVERY pair goes through the SAME validation, primary and additional alike. An earlier
 * version validated the primary strictly and then copied an additional pair's `tier`
 * unchecked while coercing a malformed `pinnedKeys` to `[]` — so a response claiming
 * `tier: "full"` on a second pair was accepted, and a caller branching on tier could conclude
 * a guarded column was freely readable. Validating one of N is not validating.
 */
function assertEavAccess(eavAccess, table) {
  if (eavAccess === undefined || eavAccess === null) return null;
  const access = assertAccessPair(eavAccess, table, 'eavAccess');
  if (eavAccess.additionalPairs !== undefined) {
    if (!Array.isArray(eavAccess.additionalPairs)) throw new Error(`table ${table}: eavAccess.additionalPairs must be an array`);
    access.additionalPairs = eavAccess.additionalPairs.map((p) => assertAccessPair(p, table, 'eavAccess.additionalPairs[]'));
  }
  return access;
}

/** Every pair in an eavAccess, primary first — what any per-pair reasoning should iterate. */
function eavAccessPairs(eavAccess) {
  if (!eavAccess) return [];
  const { keyColumn, valueColumn, tier, pinnedKeys } = eavAccess;
  return [{ keyColumn, valueColumn, tier, pinnedKeys }, ...(eavAccess.additionalPairs || [])];
}

/**
 * Every value column this table guards -- the primary pair's plus any additional ones. What
 * a caller needs to build a legal request: these columns are unreachable unless the matching
 * key column is pinned.
 */
function guardedValueColumns(pairOrAccess) {
  if (!pairOrAccess) return [];
  return [pairOrAccess.valueColumn, ...(pairOrAccess.additionalPairs || []).map((p) => p.valueColumn)];
}

/**
 * Reports the live column list for one bare table name. Structure only, never row data --
 * see modules/class-wmh2-structure-discovery.php's own contract. Throws on any
 * malformed/incomplete response rather than returning a partial result silently.
 *
 * Two credential modes, matching the plugin's own two route registrations for
 * `/structure`: the default is the WordPress Application Password path (GET, via the
 * caller-supplied `httpClient`). Pass `auth: { type: 'migration-key', migrationKey, siteId,
 * migrationId, timeoutMs }` to use the signed-JWT path instead -- required on a source site
 * with no WooCommerce, where the Application Password routes are `manage_woocommerce`-gated
 * and therefore unusable by any user at all (see "Signed migration-key path" below). That
 * mode calls the plugin directly over `fetch` and does not use `httpClient`.
 */
async function discoverStructure({ httpClient, siteBaseUrl, auth, table } = {}) {
  if (!siteBaseUrl || typeof siteBaseUrl !== 'string') throw new Error('siteBaseUrl is required');
  if (!table || typeof table !== 'string' || !/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error('table is required and must be a bare identifier (^[A-Za-z0-9_]+$)');
  }

  let body;
  if (auth && auth.type === 'migration-key') {
    if (!auth.migrationKey || typeof auth.migrationKey !== 'string') {
      throw new Error('auth.migrationKey is required for the migration-key credential path');
    }
    body = await callSignedOperation({
      siteBaseUrl,
      migrationKey: auth.migrationKey,
      operation: 'discover-structure',
      route: '/wix-wp-plugin/v2/structure',
      siteId: auth.siteId || DEFAULT_MIGRATION_KEY_SITE_ID,
      migrationId: auth.migrationId || randomUUID(),
      operationClaims: { table },
      timeoutMs: auth.timeoutMs,
    });
  } else {
    if (!httpClient || typeof httpClient.get !== 'function') throw new Error('httpClient.get is required');
    const base = siteBaseUrl.replace(/\/$/, '');
    const response = await httpClient.get(`${base}/wp-json/wix-wp-plugin/v2/structure`, {
      params: { table },
      auth,
    });
    body = bodyOf(response);
  }
  if (!body || body.table !== table || !Array.isArray(body.columns)) {
    throw new Error(`table ${table}: response did not match discover-structure's response-payload contract`);
  }
  for (const column of body.columns) assertColumn(column, table);

  // `eavPair` MUST be propagated (spec 0122 §6). Dropping it here was a real bug: it is the
  // caller's only advance warning that this table is key-scoped, so without it a caller
  // builds an unscoped "select every column" request and gets a 400 it cannot interpret.
  return { table: body.table, columns: body.columns, eavPair: assertEavPair(body.eavPair, table) };
}

/**
 * Runs one structure request. Returns one page of rows plus pagingMetadata -- the caller
 * is responsible for looping on `hasNext`/`cursors.next` until a full read completes, same
 * cursor-paging contract as any other WordPress source route this skill reads. This client
 * does not re-validate the structure request's own shape (table/select/where/groupBy/orderBy)
 * beyond requiring a `table` -- the plugin itself re-validates every identifier against a
 * live DESCRIBE on every request, so duplicating that here would only create a second copy
 * to keep in sync.
 *
 * Two credential modes, matching the plugin's own two route registrations: the default is
 * the WordPress Application Password path (POST /query/admin-key, plain JSON, via the
 * caller-supplied `httpClient`). Pass `auth: { type: 'migration-key', migrationKey, siteId,
 * migrationId, timeoutMs }` to use the signed-JWT path instead (POST /query, no `/admin-key`
 * suffix, JWT body) -- required on a source site with no WooCommerce, where the Application
 * Password routes are `manage_woocommerce`-gated and therefore unusable by any user at all.
 * That mode calls the plugin directly over `fetch` and does not use `httpClient`; it also
 * requires an integer `cursorPaging.limit` on every request (the admin-key path lets the
 * server default it), so an omitted `limit` falls back to this module's mirror of
 * `WMH2_Contract::DEFAULT_LIMIT`.
 *
 * `onSourceRead` is spec 0122 §7's telemetry hook: called once per successful read with the
 * counts for THAT read, for the caller to pass to rp-telemetry's `sourceRead()`. Optional, so
 * a unit test or a one-off script need not wire telemetry, but every real reader should.
 */
async function queryStructure({ httpClient, siteBaseUrl, auth, structureRequest, cursor, limit, onSourceRead } = {}) {
  if (!siteBaseUrl || typeof siteBaseUrl !== 'string') throw new Error('siteBaseUrl is required');
  if (!structureRequest || typeof structureRequest !== 'object' || typeof structureRequest.table !== 'string') {
    throw new Error('structureRequest with a table is required');
  }

  let body;
  if (auth && auth.type === 'migration-key') {
    if (!auth.migrationKey || typeof auth.migrationKey !== 'string') {
      throw new Error('auth.migrationKey is required for the migration-key credential path');
    }
    const cursorPaging = { cursor: cursor === undefined ? null : cursor, limit: limit === undefined ? DEFAULT_QUERY_LIMIT : limit };
    body = await callSignedOperation({
      siteBaseUrl,
      migrationKey: auth.migrationKey,
      operation: 'query-structure',
      route: '/wix-wp-plugin/v2/query',
      siteId: auth.siteId || DEFAULT_MIGRATION_KEY_SITE_ID,
      migrationId: auth.migrationId || randomUUID(),
      operationClaims: { structureRequest, cursorPaging },
      timeoutMs: auth.timeoutMs,
    });
  } else {
    if (!httpClient || typeof httpClient.post !== 'function') throw new Error('httpClient.post is required');
    const base = siteBaseUrl.replace(/\/$/, '');
    const requestBody = { structureRequest };
    if (cursor !== undefined) requestBody.cursor = cursor;
    if (limit !== undefined) requestBody.limit = limit;
    const response = await httpClient.post(`${base}/wp-json/wix-wp-plugin/v2/query/admin-key`, {
      body: JSON.stringify(requestBody),
      auth,
    });
    body = bodyOf(response);
  }
  if (!body || !Array.isArray(body.rows) || !body.pagingMetadata) {
    throw new Error(`table ${structureRequest.table}: response did not match query-structure's response-payload contract`);
  }
  const { pagingMetadata } = body;
  if (typeof pagingMetadata.hasNext !== 'boolean' || typeof pagingMetadata.total !== 'number'
    || !pagingMetadata.cursors || !('next' in pagingMetadata.cursors)) {
    throw new Error(`table ${structureRequest.table}: pagingMetadata does not match query-structure's response-payload contract`);
  }

  // REQUIRED on every response (spec 0122 §5), so its absence is a hard error rather than a
  // defaulted zero. A plugin old enough not to send it is a plugin without the value guard
  // at all, and silently treating that as "nothing was redacted" would report a guarded read
  // that never happened. Refusing names the real problem: upgrade the plugin.
  const redactionMetadata = assertRedactionMetadata(body.redactionMetadata, structureRequest.table);

  const eavAccess = assertEavAccess(body.eavAccess, structureRequest.table);
  if (onSourceRead) onSourceRead(sourceReadCounts(structureRequest.table, eavAccess, redactionMetadata));
  return { rows: body.rows, pagingMetadata, redactionMetadata, eavAccess };
}

// --- Signed migration-key path (spec 0101 "signed request/response" model, contract ---------
// version 2 per spec 0104) -----------------------------------------------------------------
//
// A WordPress site with no `wc/*` REST namespace has no `manage_woocommerce` capability for
// ANYONE, including an administrator -- the Application Password routes above are then
// structurally unusable, for every user on that site, not just a permissions edge case. The
// signed migration-key path is the only credential the plugin's own connection page ever
// issues that does not depend on that capability: `WMH2_Request_Auth::verify_operation()`
// checks a JWT signature and request-binding claims, never a WordPress capability.
//
// This is a DIFFERENT wire shape from the Application Password routes above, not a header
// swap on the same request: POST only (both operations), a distinct un-suffixed route
// (`/structure`, `/query` -- never `/query/admin-key`), `Content-Type: application/jwt` with
// the compact JWT as the entire raw body (never a JSON envelope), and a signed JWT string
// back rather than a plain JSON object. That is why this path calls `fetch` directly instead
// of going through the caller-supplied `httpClient` the Application Password functions take --
// an httpClient built for "send this JSON, get back that JSON" has no seam for "the body IS
// the credential-bearing artifact". `plugins/wix-wp-plugin-v2/examples/jwt-smoke-test.mjs` is
// the reference implementation this mirrors; reuse its claim set and response validation
// rather than inventing a second one that can drift from the plugin's own contract test
// (`tests/source-wordpress/wix-wp-plugin-v2-jwt-contract-v2-test.js`).

const JWT_REQUEST_ISSUER = 'wix-siteImportService';
const JWT_REQUEST_AUDIENCE = 'wix-wp-plugin-v2';
const JWT_RESPONSE_ISSUER = 'wix-wp-plugin-v2';
const JWT_RESPONSE_AUDIENCE = 'wix-siteImportService';
const JWT_CONTRACT_VERSION = 2;
const JWT_REQUEST_LIFETIME_SECONDS = 60; // must stay under the plugin's MAX_REQUEST_TOKEN_LIFETIME_SECONDS (120)
const DEFAULT_MIGRATION_KEY_SITE_ID = 'rp-source-wordpress';
const DEFAULT_QUERY_LIMIT = 50; // mirrors WMH2_Contract::DEFAULT_LIMIT; cursorPaging.limit is a required int on this path
const DEFAULT_SIGNED_TIMEOUT_MS = 60000;

function base64url(value) {
  return (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')).toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url');
}

/** Signs one operation's claims with the migration key. Returns the compact JWT plus the claims, so the caller can bind the response back to this exact request via `jti`. */
function signMigrationKeyRequest({ migrationKey, operation, route, siteId, migrationId, operationClaims }) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: JWT_REQUEST_ISSUER,
    aud: JWT_REQUEST_AUDIENCE,
    site_id: siteId,
    migration_id: migrationId,
    operation,
    contract_version: JWT_CONTRACT_VERSION,
    method: 'POST',
    route,
    ...operationClaims,
    iat: now,
    nbf: now,
    exp: now + JWT_REQUEST_LIFETIME_SECONDS,
    jti: randomUUID(),
  };
  const signingInput = [{ alg: 'HS256', typ: 'JWT' }, claims].map((part) => base64url(JSON.stringify(part))).join('.');
  const signature = createHmac('sha256', migrationKey).update(signingInput).digest();
  return { token: `${signingInput}.${base64url(signature)}`, requestClaims: claims };
}

/** Verifies a signed response's signature and every request-binding claim before trusting its payload. Never returns an unverified payload. */
function verifyMigrationKeyResponse({ migrationKey, jwt, requestClaims, operation, siteId, migrationId }) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) {
    throw new Error(`${operation}: response is not a compact three-part JWT`);
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(base64urlDecode(encodedHeader).toString('utf8'));
  if (header.alg !== 'HS256') {
    throw new Error(`${operation}: unexpected response JWT algorithm ${header.alg}`);
  }
  const expectedSignature = createHmac('sha256', migrationKey).update(`${encodedHeader}.${encodedPayload}`).digest();
  const actualSignature = base64urlDecode(encodedSignature);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new Error(`${operation}: response JWT signature is invalid`);
  }
  const claims = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error(`${operation}: response JWT claims must be an object`);
  }
  const now = Math.floor(Date.now() / 1000);
  const requiredClaims = [
    'iss', 'aud', 'site_id', 'migration_id', 'request_jti', 'operation',
    'contract_version', 'snapshot_id', 'payload', 'iat', 'exp', 'jti',
  ];
  const allowedClaims = new Set([...requiredClaims, 'wp_installation_id']);
  const unknownClaims = Object.keys(claims).filter((name) => !allowedClaims.has(name));
  if (unknownClaims.length > 0) {
    throw new Error(`${operation}: response JWT contains unknown claim(s): ${unknownClaims.join(', ')}`);
  }
  const missingClaims = requiredClaims.filter((name) => !Object.prototype.hasOwnProperty.call(claims, name));
  if (missingClaims.length > 0) {
    throw new Error(`${operation}: response JWT is missing required claim(s): ${missingClaims.join(', ')}`);
  }
  const expectedClaims = {
    iss: JWT_RESPONSE_ISSUER,
    aud: JWT_RESPONSE_AUDIENCE,
    site_id: siteId,
    migration_id: migrationId,
    request_jti: requestClaims.jti,
    operation,
    contract_version: JWT_CONTRACT_VERSION,
  };
  for (const [name, value] of Object.entries(expectedClaims)) {
    if (claims[name] !== value) {
      throw new Error(`${operation}: unexpected response claim ${name} (expected ${JSON.stringify(value)}, got ${JSON.stringify(claims[name])})`);
    }
  }
  if (!Number.isInteger(claims.iat)) {
    throw new Error(`${operation}: response JWT has no integer iat claim`);
  }
  if (!Number.isInteger(claims.exp) || claims.exp < now) {
    throw new Error(`${operation}: response JWT is expired or has no integer exp claim`);
  }
  for (const name of ['snapshot_id', 'jti']) {
    if (typeof claims[name] !== 'string' || claims[name] === '') {
      throw new Error(`${operation}: response JWT claim ${name} must be a non-empty string`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(claims, 'wp_installation_id')
    && (typeof claims.wp_installation_id !== 'string' || claims.wp_installation_id === '')) {
    throw new Error(`${operation}: response JWT claim wp_installation_id must be a non-empty string when present`);
  }
  if (!claims.payload || typeof claims.payload !== 'object' || Array.isArray(claims.payload)) {
    throw new Error(`${operation}: response JWT has no object payload claim`);
  }
  return claims.payload;
}

/** POSTs one signed operation and returns its verified payload. Refuses redirects: a 301/302 can rewrite the physical POST into a GET, which the plugin's own method binding then correctly rejects -- surfacing that as a redirect error is more actionable than the resulting 400. */
async function callSignedOperation({ siteBaseUrl, migrationKey, operation, route, siteId, migrationId, operationClaims, timeoutMs }) {
  const base = siteBaseUrl.replace(/\/$/, '');
  const { token, requestClaims } = signMigrationKeyRequest({ migrationKey, operation, route, siteId, migrationId, operationClaims });
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_SIGNED_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  let response;
  try {
    response = await fetch(`${base}/wp-json${route}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { accept: 'application/json', 'content-type': 'application/jwt' },
      body: token,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${operation}: redirected to ${response.headers.get('location') || '(unknown location)'} -- use the site's canonical HTTPS URL`);
  }
  const responseText = await response.text();
  if (!response.ok) {
    const error = new Error(`${operation}: HTTP ${response.status}: ${responseText}`);
    error.status = response.status;
    throw error;
  }
  let responseJwt;
  try {
    responseJwt = JSON.parse(responseText);
  } catch {
    responseJwt = responseText;
  }
  if (typeof responseJwt !== 'string') {
    throw new Error(`${operation}: response body is not a signed JWT string`);
  }
  return verifyMigrationKeyResponse({ migrationKey, jwt: responseJwt, requestClaims, operation, siteId, migrationId });
}

/**
 * Spec 0122 §7's per-read counts, derived HERE because this client is the single point every
 * bridge read passes through -- deriving them at any call site would mean every future caller
 * has to remember, and the one that forgets makes the run's total quietly wrong.
 *
 * Note what is NOT in here: key names. A run's own artifacts hold those. `redacted_values` is
 * the field worth aggregating across runs, because a non-zero total means some site keeps a
 * credential where nobody expected one.
 */
function sourceReadCounts(table, eavAccess, redactionMetadata) {
  const counts = { redacted_values: redactionMetadata.redactedValueCount };
  const pairs = eavAccessPairs(eavAccess);
  if (pairs.length > 0) {
    // MIXED-TIER RULE, stated rather than left to whichever pair happens to be first: a
    // request counts as SCOPED if ANY pair was pinned. The counts answer "how many reads
    // returned key/value DATA versus only key names", and one pinned pair means values came
    // back — so classifying by the primary pair alone would file a read that returned values
    // as a name-only discovery read. Reading the first pair's tier was the earlier behaviour
    // and it misclassified exactly this case.
    const anyPinned = pairs.some((p) => p.tier === 'key-scoped');
    counts[anyPinned ? 'scoped_queries' : 'discovery_queries'] = 1;
    counts[anyPinned ? 'scoped_tables' : 'discovery_tables'] = [table];
  }
  return counts;
}

/**
 * Would this request violate the tier rule -- i.e. does it name a guarded value column without
 * pinning that pair's key with `eq`/`in`?
 *
 * Decided from the request and the schema, NOT from the response, because the plugin answers a
 * tier violation with the same 400 as a nonexistent column, a malformed request, or a bad
 * cursor -- deliberately, so a refusal never discloses which column holds values. Treating
 * every 400 on a key/value table as a tier refusal was the earlier behaviour and it
 * misclassified the common case: a profile naming a column the site has since dropped is an
 * outdated profile, and filing it as a security-control refusal makes the one number that
 * should mean "something tried to reach values it had not named" mean nothing.
 *
 * Mirrors the plugin's own predicate (spec 0122 §2), which is why it lives beside the client
 * rather than at a call site.
 *
 * @param eavPair discover-structure's `eavPair` (with any `additionalPairs`), or null.
 */
function violatesTierRule(structureRequest, eavPair) {
  if (!eavPair) return false;
  const pairs = [{ keyColumn: eavPair.keyColumn, valueColumn: eavPair.valueColumn }, ...(eavPair.additionalPairs || [])];
  const where = Array.isArray(structureRequest.where) ? structureRequest.where : [];
  const names = new Set([
    ...(structureRequest.select || []).map((item) => item && item.column),
    ...where.map((condition) => condition && condition.column),
    ...(structureRequest.groupBy || []),
    ...(structureRequest.orderBy || []).map((item) => item && item.column),
  ]);
  return pairs.some(({ keyColumn, valueColumn }) => {
    if (!names.has(valueColumn)) return false;
    const pinned = where.some((c) => c && c.column === keyColumn && (c.op === 'eq' || c.op === 'in'));
    return !pinned;
  });
}

/** A tier-rule refusal, counted separately once `violatesTierRule` has established it is one. */
function recordTierRefusal(onSourceRead) {
  if (onSourceRead) onSourceRead({ tier_refusals: 1 });
}

// Spec 0122 §3. Two caps, both the plugin's, both load-bearing here.
const MAX_PINNED_KEYS = 50; // per scoped request
const MAX_PAGE_LIMIT = 200; // per page, WMH2_Contract::MAX_LIMIT
const MAX_SELECT_COLUMNS = 50; // WMH2_Structure_Query::MAX_SELECT_COLUMNS

/**
 * Page the discovery tier to exhaustion and return EVERY distinct key.
 *
 * Exhaustion is the whole contract. A truncated key list reads as "these are all the keys" and
 * sends a mapper down a wrong path, so this either returns a complete list or says plainly that
 * it did not: `truncated` is true when `maxKeys` was hit, and a caller must treat that as an
 * incomplete extraction rather than a slightly-short one. There is no silent cap.
 */
async function discoverEavKeys({ httpClient, siteBaseUrl, auth, table, keyColumn, maxKeys = 10000, onSourceRead } = {}) {
  // `maxKeys` bounds how many more PAGES we will fetch, not the exact list length: the check
  // runs after exhaustion, so a sweep can return up to one page beyond the cap while still
  // being complete. That is the right trade -- the alternative reported a table with exactly
  // `maxKeys` keys as truncated and blocked a complete extraction.
  const keys = [];
  const keyCounts = {};
  let cursor = null;
  let pages = 0;
  let truncated = false;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await queryStructure({
      httpClient,
      siteBaseUrl,
      auth,
      structureRequest: {
        table,
        // The COUNT is not decoration. It is what lets the plan state how many 200-row pages
        // each batch will need, so "how expensive is this extraction" is answerable before
        // running it rather than discovered while running it.
        select: [{ column: keyColumn }, { column: keyColumn, aggregate: 'count', as: 'n' }],
        groupBy: [keyColumn],
        orderBy: [{ column: keyColumn, direction: 'asc' }],
      },
      cursor,
      limit: MAX_PAGE_LIMIT,
      onSourceRead,
    });
    pages += 1;
    for (const row of page.rows) {
      if (typeof row[keyColumn] !== 'string') continue;
      keys.push(row[keyColumn]);
      const count = Number(row.n);
      keyCounts[row[keyColumn]] = Number.isFinite(count) ? count : null;
    }
    cursor = page.pagingMetadata.cursors.next;
    // Exhausted: complete, whatever the count. Checking the cap FIRST reported a table with
    // exactly `maxKeys` keys as truncated and blocked a complete extraction from promotion.
    if (!cursor) break;
    if (keys.length >= maxKeys) { truncated = true; break; }
  }
  return { keys: [...new Set(keys)], keyCounts, pages, truncated };
}

/**
 * Turn discovered key lists into the exact requests a generated reader runs to extract VALUES.
 *
 * This exists because "discover the keys, then read them" is two steps, and only the first was
 * ever executable from a persisted artifact. Discovery's `structure-request.json` for a
 * key/value table deliberately omits the guarded value columns, so a reader that runs it
 * verbatim extracts key NAMES and nothing else. The values are the whole point, so the second
 * step has to be an artifact too, not a paragraph telling a generator to improvise one.
 *
 * Three things this has to get right, each of which produced a broken plan when it did not:
 *
 * 1. **Carry the record identity.** A `postmeta` row is `{meta_key, meta_value}` plus the
 *    `post_id` it belongs to. Without that column the extraction is a bag of values that cannot
 *    be attributed to an order, which is worse than no extraction because it looks like data.
 *    Every non-key, non-value column rides along; once a key is pinned they are all readable.
 * 2. **One pair at a time.** Selecting a second pair's value column while pinning only the
 *    first pair's key is a request the plugin REFUSES (each value answers only to its own key).
 *    So each pair gets its own key list, its own batches and its own select.
 * 3. **Order by something unique.** Pagination here is offset-based, so ordering by a
 *    non-unique column (the key column, which repeats once per record) lets rows shift between
 *    pages. Prefer the primary key, then a unique column; fall back to the key column only when
 *    the table offers nothing better, and say so in the plan.
 *
 * @param keysByPair  { [keyColumn]: string[] } — one discovered key list per pair.
 */
function buildEavReadPlan({ table, eavPair, schemaColumns = [], keysByPair, countsByPair = null, batchSize = MAX_PINNED_KEYS, truncated = false }) {
  if (!eavPair) throw new Error(`table ${table}: buildEavReadPlan needs the eavPair from discover-structure`);
  if (!keysByPair || typeof keysByPair !== 'object') throw new Error(`table ${table}: keysByPair must be an object of keyColumn -> keys[]`);
  if (batchSize < 1 || batchSize > MAX_PINNED_KEYS) {
    throw new Error(`table ${table}: batchSize must be 1..${MAX_PINNED_KEYS} (the plugin's pinned-key cap)`);
  }

  const pairs = [{ keyColumn: eavPair.keyColumn, valueColumn: eavPair.valueColumn }, ...(eavPair.additionalPairs || [])];
  const keyColumns = new Set(pairs.map((pair) => pair.keyColumn));
  const valueColumns = new Set(pairs.map((pair) => pair.valueColumn));

  const named = schemaColumns.map((column) => (typeof column === 'string' ? { name: column, key: null } : column));
  const allIdentity = named.filter((column) => !keyColumns.has(column.name) && !valueColumns.has(column.name));

  // Offset pagination needs a stable, unique sort. Anything else lets a row move between pages.
  // ⚠️ MySQL permits MANY NULLs in a unique index, so a NULLABLE unique column can tie and is
  // not a stable sort. Only a primary key, or a unique column the schema reports as NOT NULL,
  // earns orderByIsUnique. A column whose nullability is unknown does not get the benefit of
  // the doubt -- claiming stable pagination and not having it is the failure being avoided.
  const uniqueColumn = named.find((c) => c.key === 'primary')
    || named.find((c) => c.key === 'unique' && c.nullable === false);
  const orderColumn = uniqueColumn ? uniqueColumn.name : null;

  // ⚠️ Two slots are RESERVED for the pair's key and value columns before identity columns are
  // taken. Appending them last and truncating the whole list to the select cap silently dropped
  // the value column on a table with 49+ identity columns -- a plan that looks complete, runs
  // without error, and extracts no values at all. When identity has to be trimmed, the columns
  // most likely to identify a record survive: the sort column, then indexed ones, then the rest.
  const identityBudget = MAX_SELECT_COLUMNS - 2;
  const ranked = [...allIdentity].sort((a, b) => rankIdentity(a, orderColumn) - rankIdentity(b, orderColumn));
  const identityColumns = ranked.slice(0, identityBudget).map((column) => column.name);
  const droppedIdentityColumns = ranked.slice(identityBudget).map((column) => column.name);

  let batchIndex = 0;
  const planPairs = pairs.map((pair) => {
    const counts = (countsByPair && countsByPair[pair.keyColumn]) || null;
    const keys = [...new Set((keysByPair[pair.keyColumn] || []).filter((k) => typeof k === 'string' && k !== ''))].sort();
    // identity + this pair's key + this pair's value, capped at the plugin's select limit. The
    // key column rides so a value can be attributed to its key without relying on request order,
    // which breaks the moment a key has no rows.
    const select = [...identityColumns, pair.keyColumn, pair.valueColumn].map((column) => ({ column }));
    const order = orderColumn || pair.keyColumn;
    const batches = [];
    for (let i = 0; i < keys.length; i += batchSize) {
      const batchKeys = keys.slice(i, i + batchSize);
      // Rows this batch will return, and therefore pages, when discovery supplied counts.
      // null when it did not -- an unknown is reported as unknown, never as zero.
      const expectedRows = counts ? batchKeys.reduce((sum, key) => sum + (Number.isFinite(counts[key]) ? counts[key] : 0), 0) : null;
      batches.push({
        batchIndex: batchIndex++,
        keyColumn: pair.keyColumn,
        keys: batchKeys,
        expectedRows,
        expectedPages: expectedRows === null ? null : Math.max(1, Math.ceil(expectedRows / MAX_PAGE_LIMIT)),
        structureRequest: {
          table,
          select,
          where: [{ column: pair.keyColumn, op: 'in', value: batchKeys }],
          orderBy: [{ column: order, direction: 'asc' }],
        },
      });
    }
    return { ...pair, distinctKeyCount: keys.length, batches };
  });

  const plan = {
    planVersion: 1,
    table,
    identityColumns,
    // Non-empty means the table is wider than the select cap allows, so extracted rows carry
    // less than the full record context. Reported, never silent.
    droppedIdentityColumns,
    orderColumn: orderColumn || null,
    // ⚠️ false means the sort column repeats, so offset pagination can shift rows between
    // pages. A reader must treat that extraction as best-effort and say so.
    orderByIsUnique: Boolean(orderColumn),
    batchSize,
    pageLimit: MAX_PAGE_LIMIT,
    keysTruncated: truncated,
    distinctKeyCount: planPairs.reduce((sum, pair) => sum + pair.distinctKeyCount, 0),
    expectedBatches: batchIndex,
    // The real request cost, not a batch count: a single batch whose keys hold thousands of
    // rows needs many 200-row pages. null when discovery could not supply counts.
    expectedScopedRequests: planPairs.every((pair) => pair.batches.every((b) => b.expectedPages !== null))
      ? planPairs.reduce((sum, pair) => sum + pair.batches.reduce((n, b) => n + b.expectedPages, 0), 0)
      : null,
    pairs: planPairs,
  };
  // Identity for the checkpoint. A resume must be able to tell that the plan it is resuming
  // into is the plan it started: discovery can rewrite the plan between runs (the site gained
  // or lost keys), and continuing a half-finished extraction against a different batch layout
  // silently mixes two reads.
  plan.planHash = eavReadPlanHash(plan);
  return plan;
}

// Excluded from the hash. `planHash` because a hash cannot cover itself -- including it made the
// embedded value un-recomputable from the persisted file, so nothing could ever verify it.
// `acknowledgedDroppedColumns` because it is a human annotation ABOUT the plan, not part of the
// read the plan describes; acknowledging an omission must not invalidate an in-flight resume.
//
// ⚠️ That exclusion has a consequence, and it is handled in the MANIFEST rather than here: the
// acknowledgement flips reconciliation from failure to success, so if it lived nowhere else,
// withdrawing it later would leave the plan hash unchanged and an incomplete extraction would
// still look reusable. `eavExtractionIsReusable()` below is where that is caught -- the
// approval is provenance, and provenance belongs with the artifact it approved.
const PLAN_HASH_EXCLUDED_KEYS = new Set(['planHash', 'acknowledgedDroppedColumns']);

/**
 * The canonical hash of a read plan's CONTENT.
 *
 * One function, used in three places that must agree: stamping the plan at build time,
 * re-deriving it from the persisted file before promotion, and checking a checkpoint on resume.
 * Three call sites hashing "the plan" three slightly different ways is how an integrity check
 * ends up unable to detect anything -- which is exactly what happened when the stamp was taken
 * before `planHash` existed and codegen was told to hash the finished file.
 *
 * Keys are sorted at every level so serialization order cannot change the answer.
 */
function eavReadPlanHash(plan) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort()
        .filter((key) => !PLAN_HASH_EXCLUDED_KEYS.has(key))
        .reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(plan))).digest('hex').slice(0, 16);
}

/**
 * Does this plan's embedded hash actually match its contents?
 *
 * Without this, `planHash` proves only that a checkpoint and a plan carry the same string --
 * so editing a batch's request while leaving the hash alone reconciled clean, which is the
 * tamper case an integrity check exists to catch.
 */
function verifyEavReadPlanIntegrity(plan) {
  const actual = eavReadPlanHash(plan);
  if (plan.planHash !== actual) {
    return `plan ${plan.table} declares planHash ${plan.planHash} but its contents hash to ${actual} -- the plan file was edited after discovery wrote it; regenerate it rather than extracting from it`;
  }
  return null;
}

/** Sort key for identity columns when the select cap forces a trim: keep what identifies a row. */
function rankIdentity(column, orderColumn) {
  if (column.name === orderColumn) return 0;
  if (column.key === 'primary') return 1;
  if (column.key === 'unique') return 2;
  if (column.key === 'index') return 3;
  return 4;
}

/** Every batch across every pair, in execution order. */
function eavReadPlanBatches(plan) {
  return (plan.pairs || []).flatMap((pair) => pair.batches);
}

/**
 * Did a plan's execution actually complete? Returns the problems; empty means clean.
 *
 * Separate from execution on purpose. "It did not throw" is not completeness, and the earlier
 * version of this accepted any non-negative row count, so a one-row extraction of a five-batch
 * plan passed. Completeness here means three things, and the third is the one that catches a
 * page loop that stopped early:
 *
 *   - every batch the plan expects was run, identified by index, not merely counted;
 *   - each batch read as many rows as its own first page said it would (`snapshotTotal`);
 *   - the rows actually written equal the sum of those totals.
 *
 * @param observed { batches: [{batchIndex, rowsRead, snapshotTotal}], rowsWritten }
 */
function reconcileEavReadPlan(plan, observed) {
  const problems = [];
  const batches = (observed && Array.isArray(observed.batches)) ? observed.batches : null;
  if (!batches) return ['reconcileEavReadPlan needs observed.batches: [{batchIndex, rowsRead, snapshotTotal}]'];

  if (plan.keysTruncated) {
    problems.push(`key discovery hit its cap, so the key list is INCOMPLETE -- this extraction cannot be treated as whole-table`);
  }
  if (Array.isArray(plan.droppedIdentityColumns) && plan.droppedIdentityColumns.length > 0
    && plan.acknowledgedDroppedColumns !== true) {
    problems.push(
      `this table is wider than the ${MAX_SELECT_COLUMNS}-column select cap, so ${plan.droppedIdentityColumns.length} column(s) are absent from every extracted row `
      + `(${plan.droppedIdentityColumns.join(', ')}). The extraction is INCOMPLETE per record. Either narrow the table's mapping and regenerate the plan with an explicit column choice, `
      + 'or set acknowledgedDroppedColumns: true on the plan to record that the omission was chosen deliberately',
    );
  }
  if (plan.orderByIsUnique === false) {
    problems.push(`this table has no primary or unique column, so batches were ordered by "${plan.orderColumn}", which repeats -- offset pagination may have shifted rows between pages and the extraction is best-effort`);
  }

  // ⚠️ Duplicates and strangers are rejected BEFORE any total is computed. Collapsing them into
  // a Map while summing the original array let a resume that re-ran batch 0 report double its
  // rows and reconcile clean -- duplicated output, promoted as complete.
  const expectedIndices = new Set(eavReadPlanBatches(plan).map((b) => b.batchIndex));
  // The plan must first be internally consistent: comparing a checkpoint against a plan whose
  // own hash no longer describes it just confirms two strings match.
  const tampered = verifyEavReadPlanIntegrity(plan);
  if (tampered) return [tampered];

  // ⚠️ REQUIRED, not optional. An optional integrity check is one the documented call path
  // forgets to pass, and then two different plans reconcile against each other.
  if (observed.planHash === undefined || observed.planHash === null) {
    return ['reconcileEavReadPlan requires observed.planHash -- without it a checkpoint from a different plan reconciles clean'];
  }
  if (observed.planHash !== plan.planHash) {
    return [`this checkpoint was written against plan ${observed.planHash}, but the plan on disk is ${plan.planHash} -- discovery rewrote it, so the extraction must restart rather than resume into a different batch layout`];
  }

  const seen = new Map();
  for (const observation of batches) {
    if (!expectedIndices.has(observation.batchIndex)) {
      problems.push(`observed batch ${observation.batchIndex} is not in this plan -- the checkpoint belongs to a different plan`);
      continue;
    }
    if (seen.has(observation.batchIndex)) {
      problems.push(`batch ${observation.batchIndex} was recorded more than once -- a resume re-ran it and its rows are duplicated in the output`);
      continue;
    }
    seen.set(observation.batchIndex, observation);
  }
  if (problems.some((p) => /recorded more than once|not in this plan/.test(p))) return problems;

  for (const batch of eavReadPlanBatches(plan)) {
    const ran = seen.get(batch.batchIndex);
    if (!ran) {
      problems.push(`batch ${batch.batchIndex} (${batch.keyColumn}, ${batch.keys.length} key(s)) never ran -- the extraction is partial`);
      continue;
    }
    if (!Number.isInteger(ran.snapshotTotal) || !Number.isInteger(ran.rowsRead)) {
      problems.push(`batch ${batch.batchIndex} reported a non-integer rowsRead/snapshotTotal`);
      continue;
    }
    if (ran.rowsRead !== ran.snapshotTotal) {
      problems.push(`batch ${batch.batchIndex} read ${ran.rowsRead} of ${ran.snapshotTotal} rows -- its page loop stopped early`);
    }
  }

  const expectedRows = [...seen.values()].reduce((sum, b) => sum + (Number.isInteger(b.rowsRead) ? b.rowsRead : 0), 0);
  if (!Number.isInteger(observed.rowsWritten) || observed.rowsWritten < 0) {
    problems.push('rowsWritten must be a non-negative integer');
  } else if (observed.rowsWritten !== expectedRows) {
    problems.push(`wrote ${observed.rowsWritten} rows but the batches read ${expectedRows} -- the output does not match what was fetched`);
  }
  return problems;
}

/**
 * What the manifest must record about a completed EAV extraction, so a later run can decide
 * whether the file on disk is still usable without re-reading the source.
 */
function eavExtractionManifest(plan, { planFile, completedBatches, rowsWritten, extractedAt, ndjsonDigest }) {
  if (typeof planFile !== 'string' || planFile === '') {
    throw new Error(`table ${plan.table}: eavExtractionManifest needs the planFile it was extracted from`);
  }
  if (typeof ndjsonDigest !== 'string' || ndjsonDigest === '') {
    throw new Error(`table ${plan.table}: eavExtractionManifest needs the ndjsonDigest of the promoted file -- a manifest not bound to its data describes nothing`);
  }
  return {
    kind: 'eav-read-plan',
    // Which plan produced this file. The hash proves the CONTENT matches; this says which
    // artifact on disk to go and re-hash, which a later run needs before it can compare.
    planFile,
    planHash: plan.planHash,
    completedBatches,
    rowsWritten,
    // These three qualify what the file CONTAINS, so they travel with it. A consumer must be
    // able to learn "rows in this file are missing columns" from the artifact rather than from
    // whoever happened to run the extraction.
    keysTruncated: Boolean(plan.keysTruncated),
    droppedIdentityColumns: plan.droppedIdentityColumns || [],
    orderByIsUnique: plan.orderByIsUnique !== false,
    // The APPROVAL that allowed an incomplete extraction to promote. Recorded because it is
    // deliberately outside planHash: without it here, withdrawing the acknowledgement would
    // change nothing a later run could see.
    acknowledgedDroppedColumns: plan.acknowledgedDroppedColumns === true,
    // Binds the manifest to the ACTUAL FILE. Everything else here describes the read that was
    // supposed to happen; this is the only field that says what landed on disk. Without it a
    // truncated, replaced or half-written NDJSON sitting beside a perfectly valid manifest is
    // accepted, and the manifest's authority is exactly what makes that dangerous.
    ndjsonDigest,
    extractedAt,
  };
}

/**
 * The digest recorded in a manifest and recomputed on reuse. One function so the two can never
 * be computed differently -- the same reasoning as eavReadPlanHash().
 */
function eavExtractionFileDigest(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

const EAV_MANIFEST_REQUIRED_FIELDS = [
  'planFile', 'planHash', 'completedBatches', 'rowsWritten', 'keysTruncated',
  'droppedIdentityColumns', 'orderByIsUnique', 'acknowledgedDroppedColumns', 'ndjsonDigest',
  'extractedAt',
];

/**
 * Can an existing extraction be reused, or must it be re-read? Returns the reasons it cannot;
 * empty means reuse is safe.
 *
 * **Re-verifies the recorded extraction rather than trusting that it happened.** An earlier
 * version checked only `kind`, `planHash` and the acknowledgement, so a manifest carrying
 * nothing but those two fields — or one recording zero completed batches, or a `rowsWritten`
 * that matched nothing — was accepted, and a run would skip re-extraction on the strength of a
 * manifest that described no extraction at all. A manifest is an assertion about a file; the
 * point of reading it is to check the assertion, not to accept it.
 *
 * So the checks are, in order of what makes later ones meaningless:
 *   1. shape — every field present and the right type;
 *   2. identity — the plan hash still matches, and the plan matches its own hash;
 *   3. completeness — the batches the manifest records must RECONCILE against the plan, the
 *      same reconciliation the extraction itself had to pass;
 *   4. qualifiers — what the manifest says about the file must still be true of the plan;
 *   5. approval — the dropped-column acknowledgement, which is outside the hash.
 */
function eavExtractionIsReusable(plan, manifest, observed) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.kind !== 'eav-read-plan') {
    return ['no EAV extraction manifest -- treat the existing file as stale'];
  }

  // ⚠️ REQUIRED, and required for the same reason planHash is: a check the caller may omit is a
  // check the caller omits. `observed` is what is actually on disk right now -- the sidecar path
  // the caller itself resolved, and the digest and line count of the final file it is deciding
  // whether to reuse. Everything else here reasons about a read that was SUPPOSED to happen.
  if (!observed || typeof observed !== 'object'
    || typeof observed.planFile !== 'string' || observed.planFile === ''
    || typeof observed.ndjsonDigest !== 'string' || observed.ndjsonDigest === ''
    || !Number.isInteger(observed.ndjsonRowCount) || observed.ndjsonRowCount < 0) {
    return ['eavExtractionIsReusable requires observed: { planFile, ndjsonDigest, ndjsonRowCount } read from disk -- without them the manifest is only checked against itself'];
  }

  // 1. Shape. Reported all at once, and nothing else runs: reasoning about completeness from a
  // manifest that is missing fields produces confident nonsense.
  const shape = [];
  for (const field of EAV_MANIFEST_REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) shape.push(`manifest is missing ${field}`);
  }
  if (shape.length === 0) {
    if (typeof manifest.planFile !== 'string' || manifest.planFile === '') shape.push('manifest planFile must be a non-empty string');
    if (typeof manifest.ndjsonDigest !== 'string' || manifest.ndjsonDigest === '') shape.push('manifest ndjsonDigest must be a non-empty string');
    if (!Array.isArray(manifest.completedBatches)) shape.push('manifest completedBatches must be an array');
    if (!Number.isInteger(manifest.rowsWritten) || manifest.rowsWritten < 0) shape.push('manifest rowsWritten must be a non-negative integer');
    if (!Array.isArray(manifest.droppedIdentityColumns)) shape.push('manifest droppedIdentityColumns must be an array');
    if (typeof manifest.keysTruncated !== 'boolean') shape.push('manifest keysTruncated must be a boolean');
    if (typeof manifest.orderByIsUnique !== 'boolean') shape.push('manifest orderByIsUnique must be a boolean');
    if (typeof manifest.acknowledgedDroppedColumns !== 'boolean') shape.push('manifest acknowledgedDroppedColumns must be a boolean');
  }
  if (shape.length > 0) return shape;

  // 2. Identity.
  const integrity = verifyEavReadPlanIntegrity(plan);
  if (integrity) return [integrity];
  if (manifest.planHash !== plan.planHash) {
    return [`the plan changed since this file was written (${manifest.planHash} -> ${plan.planHash}) -- re-extract`];
  }

  const reasons = [];

  // 2b. The manifest must describe THESE artifacts, not merely valid-looking ones.
  //
  // ⚠️ `manifest.planFile` is compared against the path the CALLER resolved; it is never opened.
  // A manifest is untrusted input -- it can name `../../something-else.json` -- so treating its
  // path as something to follow would let the file choose what it is validated against.
  if (manifest.planFile !== observed.planFile) {
    reasons.push(`manifest names plan file ${manifest.planFile} but this entity's plan is ${observed.planFile} -- the manifest belongs to a different extraction`);
  }
  if (manifest.ndjsonDigest !== observed.ndjsonDigest) {
    reasons.push('the extracted file does not match the digest its manifest recorded -- it was truncated, replaced or half-written since promotion; re-extract');
  }
  if (manifest.rowsWritten !== observed.ndjsonRowCount) {
    reasons.push(`the extracted file holds ${observed.ndjsonRowCount} row(s) but its manifest recorded ${manifest.rowsWritten} -- re-extract`);
  }

  // 3. Completeness -- the same bar the extraction had to clear, applied to what it recorded.
  reasons.push(...reconcileEavReadPlan(plan, {
    planHash: manifest.planHash,
    batches: manifest.completedBatches,
    rowsWritten: manifest.rowsWritten,
  }).map((problem) => `the recorded extraction does not reconcile: ${problem}`));

  // 4. Qualifiers. If the manifest says the file was paged on a tying sort key and the plan now
  // says otherwise, one of them is describing a different read.
  if (manifest.keysTruncated !== Boolean(plan.keysTruncated)) {
    reasons.push(`manifest records keysTruncated: ${manifest.keysTruncated}, the plan says ${Boolean(plan.keysTruncated)} -- they describe different reads`);
  }
  if (manifest.orderByIsUnique !== (plan.orderByIsUnique !== false)) {
    reasons.push(`manifest records orderByIsUnique: ${manifest.orderByIsUnique}, the plan says ${plan.orderByIsUnique !== false} -- they describe different reads`);
  }
  const dropped = plan.droppedIdentityColumns || [];
  if (JSON.stringify([...manifest.droppedIdentityColumns].sort()) !== JSON.stringify([...dropped].sort())) {
    reasons.push('manifest and plan disagree about which identity columns were dropped -- re-extract');
  }

  // 5. Approval, which is deliberately outside the hash and so cannot be caught by step 2.
  // Both sides are checked. The MANIFEST must record that this file's promotion was approved
  // -- a file with missing columns and no recorded approval was never sanctioned, whatever the
  // plan says today -- and the PLAN must still carry the approval, or it has been withdrawn.
  if (dropped.length > 0 && manifest.acknowledgedDroppedColumns !== true) {
    reasons.push(`this file has ${dropped.length} column(s) missing from every row and its manifest does not record an approval for that -- it was promoted unapproved, so re-extract rather than reuse it`);
  }
  if (dropped.length > 0 && plan.acknowledgedDroppedColumns !== true) {
    reasons.push(`this file was promoted with ${dropped.length} column(s) missing from every row, and that omission is no longer acknowledged -- re-extract or re-acknowledge`);
  }
  if (manifest.acknowledgedDroppedColumns === true && dropped.length === 0) {
    reasons.push('the file was promoted under a dropped-column acknowledgement that the current plan no longer needs -- re-extract so the rows carry the full record');
  }
  return reasons;
}

module.exports = {
  MAX_PINNED_KEYS,
  MAX_PAGE_LIMIT,
  MAX_SELECT_COLUMNS,
  discoverEavKeys,
  buildEavReadPlan,
  eavReadPlanHash,
  verifyEavReadPlanIntegrity,
  eavExtractionManifest,
  eavExtractionFileDigest,
  eavExtractionIsReusable,
  EAV_MANIFEST_REQUIRED_FIELDS,
  eavReadPlanBatches,
  reconcileEavReadPlan, HANDLER_VERSION, discoverStructure, queryStructure, guardedValueColumns, eavAccessPairs, sourceReadCounts, recordTierRefusal, violatesTierRule,
  signMigrationKeyRequest, verifyMigrationKeyResponse,
};
