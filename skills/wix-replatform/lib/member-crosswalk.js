'use strict';

// A project-local crosswalk over the shared state/crosswalk/crosswalk.ndjson (the same file and
// row shape every other adapter reads -- see local-state.js and order-history.js's own comment on
// the convention), specialized to the shape resolveOrderBuyer needs: get(sourceCustomerId) ->
// { memberId, loginEmail } | null.
//
// Reuses local-state.js's rewrite-based loader rather than order-history.js's incremental,
// crash-hardened one: member volume is a small fraction of order volume (customers, not orders),
// so a full reparse on a cache miss is cheap, and the crash discipline order-history.js needed for
// the invoice-pending sibling file has no analogue here.

const path = require('node:path');
const localState = require('./local-state.js');

function createProjectMemberCrosswalk({ projectDir, sourceSystem = 'wordpress', sourceEntityType = 'customer' } = {}) {
  if (!projectDir) throw new Error('createProjectMemberCrosswalk needs the migration projectDir');
  const key = (sourceId) => `${sourceSystem}:${sourceEntityType}:${String(sourceId)}`;
  let cache = null;
  let cachedStatKey = null;

  async function refresh() {
    const filePath = localState.crosswalkPath(projectDir);
    let statKey = 'absent';
    try {
      const st = await require('node:fs/promises').stat(filePath);
      statKey = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
    if (cache && statKey === cachedStatKey) return cache;
    cache = await localState.loadCrosswalk(projectDir);
    cachedStatKey = statKey;
    return cache;
  }

  return {
    async get(sourceId) {
      const { bySource } = await refresh();
      const row = bySource[key(sourceId)];
      if (!row || row.status !== 'imported') return null;
      return { memberId: row.targetId, loginEmail: row.loginEmail || null };
    },
    // Writers persist through here so `loginEmail` rides the row alongside the required fields
    // (upsertCrosswalkRow does not reject extra properties).
    async put(sourceId, { memberId, loginEmail, contactId = null } = {}) {
      if (!memberId) throw new Error('createProjectMemberCrosswalk.put needs memberId');
      const row = {
        schemaVersion: 1,
        sourceSystem,
        sourceEntityType,
        sourceId: String(sourceId),
        sourceStableKey: key(sourceId),
        targetSystem: 'wix',
        targetEntityType: 'member',
        targetId: String(memberId),
        status: 'imported',
        updatedAt: new Date().toISOString(),
        ...(loginEmail ? { loginEmail: String(loginEmail).trim().toLowerCase() } : {}),
        ...(contactId ? { contactId: String(contactId) } : {}),
      };
      await localState.upsertCrosswalkRow(projectDir, row);
      cache = null; // next get() re-reads; low volume, correctness over the extra stat+parse
      return row;
    },
  };
}

module.exports = { createProjectMemberCrosswalk };
