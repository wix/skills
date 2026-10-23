'use strict';
const w = require('./wix-writers');
const v = require('./write-verification');
const { contactId } = require('./bulk-results');
const stateIO = require('../../../lib/write-verification-state');
const local = require('../../../lib/local-state');
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));

// Schema: Contacts V5 Find Matching Contacts (GET); keep every primary identifier.
async function findMatching(wix, expected) {
  const params = new URLSearchParams();
  if (expected.externalId) params.set('externalId', expected.externalId);
  if (expected.email?.email) params.set('email', expected.email.email);
  if (expected.phone?.phone) params.set('phone', expected.phone.phone);
  const result = await wix.send({ method: 'GET', url: `https://www.wixapis.com/contacts/v5/contacts/find-matching?${params}` });
  if (!Array.isArray(result?.contacts) || result.contacts.length >= 100) throw new Error('Contact lookup is malformed or may be truncated');
  return result.contacts;
}
async function importContacts(wix, { projectDir, siteId, rows, verifyAttempts = 3, sleep = sleepDefault, dryRun = false } = {}) {
  if (!projectDir || !siteId || !Array.isArray(rows) || !Number.isInteger(verifyAttempts) || verifyAttempts < 1 || verifyAttempts > 5) throw new Error('Invalid contact import arguments');
  if (rows.some(r => typeof r.sourceKey !== 'string' || !r.sourceKey) || new Set(rows.map(r => r.sourceKey)).size !== rows.length) throw new Error('Unique source keys required');
  return local.withStateLock(projectDir, async () => {
    const state = await stateIO.load(projectDir, siteId);
    const crosswalk = await local.loadCrosswalk(projectDir);
    const work = rows.map(row => {
      try {
        v.assertProjection(row.contact, 'contact');
        const expected = w.buildCreateContactRequest({ contact: row.contact }, row.safeModeOptions).body.contact;
        v.assertProjection(expected);
        const limits = [[expected.externalId, 100], [expected.name?.first, 1000], [expected.name?.last, 1000], [expected.email?.email, 320], [expected.phone?.phone, 50]];
        if (limits.some(([value, max]) => value != null && (typeof value !== 'string' || value.length > max))) throw new Error('Contact field exceeds its declared type or limit');
        for (const [key, max] of [['additionalEmails', 10], ['additionalPhones', 10], ['addresses', 50]]) if (expected[key] != null && (!Array.isArray(expected[key]) || expected[key].length > max)) throw new Error(`Contact ${key} exceeds its declared array limit`);
        return { ...row, baseline: crosswalk.bySource[row.sourceKey] || state.rows[row.sourceKey]?.baseline || null, expected, uncertain: Boolean(state.rows[row.sourceKey]?.uncertain), targetId: state.rows[row.sourceKey]?.targetId || crosswalk.bySource[row.sourceKey]?.targetId || state.rows[row.sourceKey]?.baseline?.targetId || null };
      } catch (e) { return { ...row, baseline: crosswalk.bySource[row.sourceKey] || state.rows[row.sourceKey]?.baseline || null, targetId: state.rows[row.sourceKey]?.targetId || crosswalk.bySource[row.sourceKey]?.targetId || state.rows[row.sourceKey]?.baseline?.targetId, uncertain: state.rows[row.sourceKey]?.uncertain, error: e.message }; }
    });
    // Resolve the entire input set before writes: even a later row can conflict with an earlier one.
    const shared = new Map();
    for (const r of work) for (const [key, value] of Object.entries({ externalId: r.expected?.externalId, email: v.email(r.expected?.email?.email), phone: r.expected?.phone?.phone })) {
      if (!value) continue;
      const k = `${key}:${value}`;
      if (!shared.has(k)) shared.set(k, []);
      shared.get(k).push(r);
    }
    for (const group of shared.values()) if (group.length > 1) for (const r of group) r.error = 'Conflicting source contact identifiers';
    if (dryRun) return { siteId, intended: rows.length, status: 'simulated', verified: 0, rows: work.map(r => ({ sourceKey: r.sourceKey, verified: false, outcome: 'simulated' })) };
    for (const r of work) {
      if (r.error) continue;
      try {
        if (!r.expected.externalId && !v.email(r.expected.email?.email)) throw new Error('Phone-only or name-only identity is unsupported');
        const candidates = await findMatching(wix, r.expected);
        if (candidates.length > 1 || candidates.some(c => !v.contactIdentity(r.expected, c, c.id).verified)) throw Object.assign(new Error('Conflicting target contact identity'), { identityConflict: true });
        if (r.targetId) {
          if (!contactId(r.targetId)) throw Object.assign(new Error('Invalid candidate contact ID'), { identityConflict: true });
          const known = await w.getContact(wix, r.targetId);
          if (!v.contactIdentity(r.expected, known, r.targetId).verified) throw Object.assign(new Error('Crosswalk contact identity does not agree'), { identityConflict: true });
          if (candidates.length && candidates[0].id !== r.targetId) throw Object.assign(new Error('Crosswalk and matching lookup disagree'), { identityConflict: true });
          r.actual = known;
        } else if (candidates.length) { r.targetId = candidates[0].id; r.actual = await w.getContact(wix, r.targetId); }
        else if (state.rows[r.sourceKey]?.uncertain) throw new Error('Previous write outcome is uncertain; reconcile before retry');
        if (r.actual && !v.verifyContact(r.expected, r.actual, r.targetId).verified) throw new Error('Existing contact values differ; use the revision-protected update and conflict-review flow');
        if (r.targetId && crosswalk.rows.some(c => c.sourceStableKey !== r.sourceKey && c.targetSystem === 'wix' && c.targetId === r.targetId)) throw Object.assign(new Error('Target contact belongs to another source key'), { identityConflict: true });
      } catch (e) { r.error = e.message; r.identityConflict = Boolean(e.identityConflict); }
    }
    for (const r of work) if (r.targetId && work.some(other => other !== r && other.targetId === r.targetId)) { r.error = 'Distinct source keys share a target contact'; r.identityConflict = true; }
    const save = r => {
      const previous = state.rows[r.sourceKey];
      const lastVerifiedReceipt = v.validReceipt(previous?.receipt) ? previous.receipt : previous?.lastVerifiedReceipt || null;
      state.rows[r.sourceKey] = { sourceKey: r.sourceKey, targetId: r.targetId, baseline: r.baseline, identityConflict: Boolean(r.identityConflict),
        outcome: r.outcome || 'needs_verification', uncertain: Boolean(r.uncertain), error: r.error || null, receipt: r.receipt || null, lastVerifiedReceipt };
    };
    for (const r of work) save(r);
    await stateIO.checkpoint(projectDir, state, work);
    const pending = work.filter(r => !r.error && !(r.actual && v.verifyContact(r.expected, r.actual, r.targetId).verified));
    const batches = [];
    for (const memberMode of [false, true]) {
      const selected = pending.filter(r => (r.updateMember === true) === memberMode);
      for (let start = 0; start < selected.length; start += 100) batches.push(selected.slice(start, start + 100));
    }
    for (const group of batches) {
      for (const r of group) { r.uncertain = true; save(r); }
      await stateIO.checkpoint(projectDir, state, group);
      try {
        // Sanitize once per source record, never with one shared batch identity.
        const result = await w.bulkUpsertContacts(wix, group.map(r => r.expected), { updateMember: group[0].updateMember === true }, { safeMode: false });
        for (const outcome of result.results) {
          if (!outcome.correlated) continue;
          const r = group[outcome.index];
          if (outcome.success) {
            if (r.targetId && r.targetId !== outcome.contactId) { r.error = 'Upsert returned a different contact identity'; continue; }
            r.targetId = outcome.contactId; r.uncertain = false; r.confirmedCreate = true;
          } else { r.error = outcome.errorCode || 'Contact write failed'; r.uncertain = false; }
          save(r);
        }
        for (const index of result.unresolvedIndexes) { group[index].error = 'Unresolved bulk contact result'; save(group[index]); }
      } catch (e) {
        for (const r of group) {
          r.error = e.message;
          if ([401, 403].includes(e.status || e.statusCode)) r.uncertain = false;
          save(r);
        }
      }
      await stateIO.checkpoint(projectDir, state, group);
    }
    for (const r of work) if (r.targetId && work.some(other => other !== r && other.targetId === r.targetId)) { r.error = 'Distinct source keys share a target contact'; r.identityConflict = true; }
    const publications = [];
    let verifiedBatch = [];
    for (const r of work) {
      if (!r.error && r.targetId) for (let attempt = 1; attempt <= verifyAttempts; attempt++) {
        try {
          const actual = await w.getContact(wix, r.targetId);
          if (!v.contactIdentity(r.expected, actual, r.targetId).verified) r.identityConflict = true;
          r.receipt = v.receipt({ siteId, sourceKey: r.sourceKey, kind: 'contact', expected: r.expected, actual, targetId: r.targetId, operation: 'bulkUpsertContacts', attempts: attempt });
          if (r.identityConflict) break;
          if (r.receipt.verified) { r.outcome = 'verified'; r.uncertain = false; break; }
        } catch (e) { r.readError = e.message; }
        if (attempt < verifyAttempts) await sleep(100 * attempt);
      }
      if (!r.receipt?.verified) { r.error ||= r.readError || 'Contact values could not be verified'; r.outcome = 'needs_verification'; }
      save(r);
      if (r.outcome === 'verified') publications.push({ row: {
        schemaVersion: 1, sourceSystem: r.sourceSystem || 'source', sourceEntityType: 'contact', sourceId: r.sourceId || r.sourceKey,
        sourceStableKey: r.sourceKey, targetSystem: 'wix', targetEntityType: 'contact', targetId: r.targetId, status: 'imported',
      }, receipt: r.receipt, options: r });
      verifiedBatch.push(r);
      if (verifiedBatch.length === 100) { await stateIO.checkpoint(projectDir, state, verifiedBatch); verifiedBatch = []; }
    }
    await stateIO.checkpoint(projectDir, state, verifiedBatch);
    await stateIO.persist(projectDir, state);
    await stateIO.publishMany(projectDir, publications, work.filter(r => r.identityConflict).map(r => r.sourceKey));
    return stateIO.report(work.map(r => state.rows[r.sourceKey]), siteId);
  });
}
module.exports = { findMatching, importContacts };
