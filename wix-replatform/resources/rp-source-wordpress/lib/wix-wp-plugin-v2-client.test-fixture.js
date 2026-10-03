'use strict';

// Exercises BOTH of the handler's capabilities, not just discoverStructure -- a self-test
// that only ever called discoverStructure would report readiness even if queryStructure
// (the route that actually returns real data) were completely broken.
async function selfTest({ discoverStructure, queryStructure, guardedValueColumns }) {
  const calls = [];
  const httpClient = {
    async get(url, options) {
      calls.push({ method: 'GET', url, options });
      return {
        table: options.params.table,
        columns: [
          { name: 'id', type: 'bigint(20) unsigned', nullable: false, key: 'primary' },
          { name: 'number', type: 'varchar(64)', nullable: false, key: 'unique' },
          { name: 'active', type: 'tinyint(1)', nullable: false, key: null },
        ],
      };
    },
    async post(url, options) {
      calls.push({ method: 'POST', url, options });
      return {
        rows: [{ id: '1', number: 'CARD0001', active: '1' }],
        pagingMetadata: { cursors: { next: null }, hasNext: false, total: 1 },
        redactionMetadata: { redactedValueCount: 0, redactedColumns: [] },
      };
    },
  };

  const discovered = await discoverStructure({ httpClient, siteBaseUrl: 'https://example.test', table: 'pimwick_gift_card' });
  if (discovered.table !== 'pimwick_gift_card' || discovered.columns.length !== 3) {
    throw new Error('fixture discovery did not return the expected table/columns shape');
  }
  const getCall = calls.find((call) => call.method === 'GET');
  if (!getCall || getCall.options.params.table !== 'pimwick_gift_card') {
    throw new Error('fixture discovery did not request the expected table param');
  }
  if (!getCall.url.endsWith('/wp-json/wix-wp-plugin/v2/structure')) {
    throw new Error('fixture discovery did not hit the expected wix-wp-plugin-v2 route');
  }

  const queried = await queryStructure({
    httpClient,
    siteBaseUrl: 'https://example.test',
    structureRequest: {
      table: 'pimwick_gift_card',
      select: [{ column: 'id' }, { column: 'number' }, { column: 'active' }],
      orderBy: [{ column: 'id', direction: 'asc' }],
    },
    limit: 10,
  });
  if (!Array.isArray(queried.rows) || queried.rows.length !== 1 || queried.rows[0].number !== 'CARD0001') {
    throw new Error('fixture query did not return the expected row shape');
  }
  if (queried.pagingMetadata.hasNext !== false || queried.pagingMetadata.total !== 1) {
    throw new Error('fixture query did not return the expected pagingMetadata shape');
  }
  const postCall = calls.find((call) => call.method === 'POST');
  if (!postCall || !postCall.url.endsWith('/wp-json/wix-wp-plugin/v2/query/admin-key')) {
    throw new Error('fixture query did not hit the expected wix-wp-plugin-v2 route');
  }
  const postedBody = JSON.parse(postCall.options.body);
  if (postedBody.structureRequest.table !== 'pimwick_gift_card' || postedBody.limit !== 10) {
    throw new Error('fixture query did not send the expected request body');
  }

  // --- spec 0122: the safety metadata must survive the client, and its absence must fail ---

  if (!queried.redactionMetadata || queried.redactionMetadata.redactedValueCount !== 0) {
    throw new Error('fixture query dropped redactionMetadata, which every response carries');
  }
  if (queried.eavAccess !== null) {
    throw new Error('a plain table must report eavAccess as null, not as a fabricated object');
  }

  // A plugin too old to send redactionMetadata has no value guard at all. Accepting that
  // response would report a guarded read that never happened, so the client must refuse it.
  const legacyClient = {
    async post() {
      return { rows: [{ id: '1' }], pagingMetadata: { cursors: { next: null }, hasNext: false, total: 1 } };
    },
  };
  let refusedLegacy = false;
  try {
    await queryStructure({
      httpClient: legacyClient,
      siteBaseUrl: 'https://example.test',
      structureRequest: { table: 'pimwick_gift_card', select: [{ column: 'id' }], orderBy: [{ column: 'id', direction: 'asc' }] },
    });
  } catch (error) {
    refusedLegacy = /redactionMetadata/.test(error.message);
  }
  if (!refusedLegacy) {
    throw new Error('a response with no redactionMetadata must be refused, not defaulted to zero');
  }

  // A key/value table: both routes must hand the caller enough to build a legal request,
  // INCLUDING the second guarded value column on a multi-pair schema.
  const eavClient = {
    async get(url, options) {
      return {
        table: options.params.table,
        columns: [
          { name: 'meta_id', type: 'bigint(20) unsigned', nullable: false, key: 'primary' },
          { name: 'meta_key', type: 'varchar(255)', nullable: true, key: 'index' },
          { name: 'meta_value', type: 'longtext', nullable: true, key: null },
          { name: 'name', type: 'varchar(64)', nullable: true, key: null },
          { name: 'value', type: 'longtext', nullable: true, key: null },
        ],
        eavPair: {
          keyColumn: 'meta_key',
          valueColumn: 'meta_value',
          additionalPairs: [{ keyColumn: 'name', valueColumn: 'value' }],
        },
      };
    },
    async post() {
      return {
        rows: [{ meta_key: 'last4', n: '12' }],
        pagingMetadata: { cursors: { next: null }, hasNext: false, total: 1 },
        redactionMetadata: { redactedValueCount: 1, redactedColumns: ['meta_value'] },
        eavAccess: { keyColumn: 'meta_key', valueColumn: 'meta_value', tier: 'key-discovery', pinnedKeys: [] },
      };
    },
  };
  const eavDiscovered = await discoverStructure({ httpClient: eavClient, siteBaseUrl: 'https://example.test', table: 'dual_meta' });
  if (!eavDiscovered.eavPair || eavDiscovered.eavPair.keyColumn !== 'meta_key') {
    throw new Error('discoverStructure dropped eavPair -- the caller loses its only advance notice that a table is key-scoped');
  }
  if (guardedValueColumns(eavDiscovered.eavPair).join(',') !== 'meta_value,value') {
    throw new Error('guardedValueColumns must report EVERY guarded value column, not only the first pair\'s');
  }
  const eavQueried = await queryStructure({
    httpClient: eavClient,
    siteBaseUrl: 'https://example.test',
    structureRequest: { table: 'dual_meta', select: [{ column: 'meta_key' }], orderBy: [{ column: 'meta_key', direction: 'asc' }] },
  });
  if (!eavQueried.eavAccess || eavQueried.eavAccess.tier !== 'key-discovery') {
    throw new Error('queryStructure dropped eavAccess -- the caller cannot tell the read was key-scoped');
  }
  if (eavQueried.redactionMetadata.redactedValueCount !== 1
    || eavQueried.redactionMetadata.redactedColumns[0] !== 'meta_value') {
    throw new Error('queryStructure dropped the redaction count -- a redacted value would look like real data');
  }

  return true;
}

module.exports = selfTest;
