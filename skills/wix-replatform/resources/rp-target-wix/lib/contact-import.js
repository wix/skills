'use strict';
const w = require('./wix-writers');
const v = require('./write-verification');
const { contactId } = require('./bulk-results');
const stateIO = require('../../../lib/write-verification-state');
const local = require('../../../lib/local-state');
const executionCapability = require('../../../lib/execution-capability');
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const LOOKUP_TIMEOUT_MS = 10000;

// Schema: Contacts V5 Find Matching Contacts (GET); keep every primary identifier.
// Marked as a bounded read: an import-task client refuses any unmarked request as a write.
async function findMatching(wix, expected, { byPhone = true } = {}) {
  const params = new URLSearchParams();
  if (expected.externalId) params.set('externalId', expected.externalId);
  if (expected.email?.email) params.set('email', expected.email.email);
  if (byPhone && expected.phone?.phone) params.set('phone', expected.phone.phone);
  const result = await wix.send(w.buildBoundedReadRequest({ method: 'GET', url: `https://www.wixapis.com/contacts/v5/contacts/find-matching?${params}` }, LOOKUP_TIMEOUT_MS));
  if (!Array.isArray(result?.contacts) || result.contacts.length >= 100) throw new Error('Contact lookup is malformed or may be truncated');
  return result.contacts;
}
// The crosswalk row a verified contact is published under, keyed by the row's own `sourceKey`.
function contactCrosswalkRow(r) {
  return { schemaVersion: 1, sourceSystem: r.sourceSystem || 'source', sourceEntityType: r.sourceEntityType || 'contact', sourceId: stateIO.crosswalkSourceId(r),
    sourceStableKey: r.sourceKey, targetSystem: 'wix', targetEntityType: 'contact', targetId: r.targetId, status: 'imported' };
}
// A row with `shareExistingContact` (a guest buyer) may be the same person as a contact another
// source record already owns (a registered customer with the same email). Its identity is the email
// alone: one exact match adopts that contact (no write, no second contact) and the row is published
// under its own key with `sharedWith` naming the owner. No match creates it as usual.
const addressContract = require('../../../lib/contact-address-contract');
const sharesContact = r => r.shareExistingContact === true;
// The toolkit's own guest-buyer contact keys (order-buyer.js): one per guest email.
const GUEST_BUYER_KEY_MARKER = 'replatform:guest-buyer:';
// The identity part of a row (set-once externalId, email): what a kept existing contact is verified on.
const keptIdentity = expected => ({ ...(expected?.externalId ? { externalId: expected.externalId } : {}), ...(expected?.email ? { email: expected.email } : {}) });
// Every contact we write carries its own source marker as externalId (B-10). Contacts V5
// matching (docs: contacts-v5/matching-contacts) never matches a contact that has a DIFFERENT
// externalId, so with a marker on every contact one source record can never land on another's.
// Registered customers used to be written without one: 36 guest buyers sharing a customer's phone
// were merged into (and overwrote) the customer's contact by Wix's phone match.
// A contact with NO externalId and our email is ours to claim (an earlier run, or the same person
// already on the site): it is compared without the marker, and the write stamps it.
const withoutMarker = ({ externalId, ...rest }) => rest;
const identityView = (expected, contact) => (contact && !contact.externalId && expected?.externalId && v.email(expected?.email?.email) ? withoutMarker(expected) : expected);
// The lookup sees what Wix would match plus same-email contacts other source records own (a guest
// sharing a customer's contact). With an email, it is sent without the marker so those are listed.
const lookupKeys = expected => (v.email(expected?.email?.email) ? { email: expected.email, ...(expected.phone ? { phone: expected.phone } : {}) } : expected);
// A source value Wix refuses never stops the contact (live run 09895795, 11-17: emails like
// starting with a dot are refused 400 FORMAT on lookup; replay 11-15: INVALID_PHONE on upsert). The
// contact imports without that value; the row keeps `droppedValues` (replayed on every later pass)
// and the loop records one grouped cutover item per reason. A contact whose email was dropped is
// identified by a set-once externalId from its own source key (Contacts V5 identifier: matched and
// read back), so it is still looked up, verified and never created twice.
// A phone another source record also has (a household) stays on both contacts: each carries its own
// marker, so Wix does not match them on the phone. A phone whose only holder is a contact with no
// marker (Wix would merge into it) is dropped from this write and kept in the source archive.
const REFUSED_UPSERT_CODES = Object.freeze({ INVALID_PHONE: 'phone', INVALID_EMAIL: 'email' });
const DROP_REASONS = Object.freeze({ REFUSED: 'refused-by-wix', SHARED_PHONE: 'phone-shared-with-another-contact' });
function refusedLookupField(error) {
  const message = String(error?.message || '');
  if (!/→ 400:/.test(message) || !/"fieldViolations"/.test(message)) return null;
  const m = /"field":"(email|phone)"/.exec(message);
  return m ? m[1] : null;
}
const sourceExternalId = r => `${r.sourceSystem || 'source'}:${r.sourceEntityType || 'contact'}:${r.sourceId ?? r.sourceKey}`.slice(0, 100);
function dropValue(r, field, reason) {
  if (!r.expected || (r.droppedValues || []).some(d => d.field === field)) return false;
  if (field === 'email' && r.expected.email) { delete r.expected.email; if (!r.expected.externalId) r.expected.externalId = sourceExternalId(r); }
  else if (field === 'phone' && r.expected.phone) delete r.expected.phone;
  else return false;
  (r.droppedValues ||= []).push({ field, reason });
  return true;
}
async function importContacts(wix, { projectDir, siteId, rows, evaluation, verifyAttempts = 3, sleep = sleepDefault, dryRun = false } = {}) {
  if (!projectDir || !siteId || !Array.isArray(rows) || !Number.isInteger(verifyAttempts) || verifyAttempts < 1 || verifyAttempts > 5) throw new Error('Invalid contact import arguments');
  if (rows.some(r => typeof r.sourceKey !== 'string' || !r.sourceKey) || new Set(rows.map(r => r.sourceKey)).size !== rows.length) throw new Error('Unique source keys required');
  // Inside an import task every contact write needs the task's readiness grant for its own key.
  const importTask = executionCapability.clientContext(wix)?.kind === 'import-task';
  if (importTask && !dryRun && !evaluation) throw new Error('DEPENDENCY_EVALUATION_REQUIRED');
  return local.withStateLock(projectDir, async () => {
    const state = await stateIO.load(projectDir, siteId);
    const crosswalk = await local.loadCrosswalk(projectDir);
    const work = rows.map(row => {
      try {
        v.assertProjection(row.contact, 'contact');
        // A bad address shape holds only this row, before anything is sent, with its code: the
        // rest of the batch is still written (E3 rule: hold the record, keep going).
        const shape = addressContract.contactAddressShapeError(row.contact);
        if (shape) throw Object.assign(new Error(shape), { code: addressContract.CONTACT_ADDRESS_SHAPE_INVALID });
        const expected = w.buildCreateContactRequest({ contact: row.contact }).body.contact;
        if (!expected.externalId) expected.externalId = sourceExternalId(row);
        v.assertProjection(expected);
        const limits = [[expected.externalId, 100], [expected.name?.first, 1000], [expected.name?.last, 1000], [expected.email?.email, 320], [expected.phone?.phone, 50]];
        if (limits.some(([value, max]) => value != null && (typeof value !== 'string' || value.length > max))) throw new Error('Contact field exceeds its declared type or limit');
        for (const [key, max] of [['additionalEmails', 10], ['additionalPhones', 10], ['addresses', 50]]) if (expected[key] != null && (!Array.isArray(expected[key]) || expected[key].length > max)) throw new Error(`Contact ${key} exceeds its declared array limit`);
        const replayed = { ...row, expected };
        for (const d of state.rows[row.sourceKey]?.droppedValues || []) dropValue(replayed, d.field, d.reason);
        return { ...replayed, baseline: crosswalk.bySource[row.sourceKey] || state.rows[row.sourceKey]?.baseline || null, uncertain: Boolean(state.rows[row.sourceKey]?.uncertain), targetId: state.rows[row.sourceKey]?.targetId || crosswalk.bySource[row.sourceKey]?.targetId || state.rows[row.sourceKey]?.baseline?.targetId || null };
      } catch (e) { return { ...row, baseline: crosswalk.bySource[row.sourceKey] || state.rows[row.sourceKey]?.baseline || null, targetId: state.rows[row.sourceKey]?.targetId || crosswalk.bySource[row.sourceKey]?.targetId || state.rows[row.sourceKey]?.baseline?.targetId, uncertain: e.code === addressContract.CONTACT_ADDRESS_SHAPE_INVALID ? false : state.rows[row.sourceKey]?.uncertain, error: e.message,
        ...(e.code ? { errorCode: String(e.code) } : {}) }; }
    });
    // Resolve the entire input set before writes: even a later row can conflict with an earlier one.
    const shared = new Map();
    for (const r of work) for (const [key, value] of Object.entries({ externalId: r.expected?.externalId, email: v.email(r.expected?.email?.email) })) {
      if (!value) continue;
      const k = `${key}:${value}`;
      if (!shared.has(k)) shared.set(k, []);
      shared.get(k).push(r);
    }
    for (const group of shared.values()) if (group.length > 1) for (const r of group) r.error = 'Conflicting source contact identifiers';
    if (dryRun) return { siteId, intended: rows.length, status: 'simulated', verified: 0, rows: work.map(r => ({ sourceKey: r.sourceKey, verified: false, outcome: 'simulated' })) };
    // Who owns a Wix contact: a published crosswalk row, or another row of this site's write state
    // that wrote it but is not verified yet (succeeded_unverified). Without the second, a guest buyer
    // finds an unverified customer's contact by email, sees no owner, and creates a second contact
    // with the same email. Every ownership gate below reads this.
    const ownersOf = (contactTargetId, exceptKey) => {
      const found = crosswalk.rows.filter(x => x.sourceStableKey !== exceptKey && x.targetSystem === 'wix' && x.targetId === contactTargetId && x.targetEntityType !== 'member');
      for (const s of Object.values(state.rows)) {
        if (!s || s.sourceKey === exceptKey || s.targetId !== contactTargetId || s.identityConflict || s.sharedWith || found.some(x => x.sourceStableKey === s.sourceKey)) continue;
        found.push({ sourceStableKey: s.sourceKey, targetSystem: 'wix', targetEntityType: 'contact', targetId: s.targetId, pending: true });
      }
      return found;
    };
    let readinessGrant = null;
    if (importTask) {
      // The gate journals each deferral with its reason; a deferred row is never sent.
      const batch = await require('../../../lib/dependency-readiness').gateBatch({ evaluation, records: work.filter(r => !r.error).map(r => ({ sourceStableKey: r.sourceKey, payload: {} })) });
      for (const { sourceStableKey, deferral } of batch.defer) work.find(r => r.sourceKey === sourceStableKey).error = deferral.reason;
      readinessGrant = batch.grant;
    }
    for (const r of work) {
      if (r.error) continue;
      try {
        if (!r.expected.externalId && !v.email(r.expected.email?.email)) throw new Error('Phone-only or name-only identity is unsupported');
        const lookup = async () => {
          for (;;) {
            try { return await findMatching(wix, lookupKeys(r.expected)); } catch (e) {
              if (e && e.interruption === true) throw e;
              const field = refusedLookupField(e);
              if (!field || !dropValue(r, field, DROP_REASONS.REFUSED)) throw e;
            }
          }
        };
        const conflict = message => Object.assign(new Error(message), { identityConflict: true });
        const ownerOf = c => ownersOf(c.id, r.sourceKey)[0];
        const share = (c, owner) => { r.sharedWith = owner.sourceStableKey; r.expected = { email: r.expected.email }; return c; };
        const wroteEarlier = Boolean(r.targetId) && !state.rows[r.sourceKey]?.keptExisting;
        const candidates = await lookup();
        const marker = r.expected.externalId, mail = v.email(r.expected.email?.email);
        const sameEmail = c => Boolean(mail) && v.email(c.email?.email) === mail;
        const own = candidates.filter(c => c.externalId === marker);
        const free = candidates.filter(c => !c.externalId);
        const freeSame = free.filter(sameEmail);
        // Same email, another source record's marker: Wix never writes to it from this row.
        const ownedSame = candidates.filter(c => c.externalId && c.externalId !== marker && sameEmail(c));
        if (own.length > 1 || (!own.length && freeSame.length > 1)) throw conflict('Conflicting target contact identity');
        let target = own[0] || freeSame[0] || null;
        // Only a marker-less contact with our phone and not our email: Wix would merge this row into it.
        // A guest (same phone is not the same person) or a contact another of our records owns: the
        // phone is left off this write. A site contact that is not ours stays an identity conflict
        // for a registered customer (it may be the same person).
        const phoneOnly = target ? [] : free.filter(c => !sameEmail(c));
        if (phoneOnly.length && r.expected.phone?.phone) {
          if (sharesContact(r) || phoneOnly.every(ownerOf)) dropValue(r, 'phone', DROP_REASONS.SHARED_PHONE);
          else throw conflict('Conflicting target contact identity');
        }
        // A guest buyer with a registered customer's email is that customer (one contact, two keys),
        // and the mirror: a customer whose email a guest buyer's contact already has. Either shares the
        // contact and writes nothing. Any other owner is a conflict.
        if (!target && ownedSame.length) {
          const owner = ownedSame.length === 1 ? ownerOf(ownedSame[0]) : null;
          if (ownedSame.length > 1) throw conflict('Conflicting target contact identity');
          if (owner && (sharesContact(r) || String(owner.sourceStableKey).includes(GUEST_BUYER_KEY_MARKER))) target = share(ownedSame[0], owner);
          else if (owner) throw conflict('Target contact belongs to another source key');
        }
        if (target && sharesContact(r) && !r.sharedWith && ownerOf(target)) share(target, ownerOf(target));
        if (r.targetId) {
          if (!contactId(r.targetId)) throw Object.assign(new Error('Invalid candidate contact ID'), { identityConflict: true });
          const known = await w.getContact(wix, r.targetId);
          // A contact that now carries another record's marker was taken over: stop, never overwrite.
          if (!v.contactIdentity(identityView(r.expected, known), known, r.targetId).verified) throw conflict('Crosswalk contact identity does not agree');
          if (target && target.id !== r.targetId) throw conflict('Crosswalk and matching lookup disagree');
          r.actual = known;
        } else if (target) { r.targetId = target.id; r.actual = await w.getContact(wix, r.targetId); }
        // An uncertain earlier write (a lost bulk reply) that the lookup does not find is re-sent.
        // Upsert matches on the same identifiers the lookup used (externalId, email), so a write
        // that did land is updated in place, never duplicated. Parking it stranded whole batches.
        // Keep the existing contact (owner rule, 11-19): a Wix contact that already matches this row's
        // identity keeps its own values. Nothing is written; the row is verified on its identity
        // alone and published, so its orders link to that contact.
        // A kept contact we wrote earlier (our crosswalk) gets our marker; a site contact that is not
        // ours keeps everything, marker included (nothing is written to it).
        if (r.actual && !v.verifyContact(identityView(r.expected, r.actual), r.actual, r.targetId).verified) { r.expected = keptIdentity(wroteEarlier ? r.expected : identityView(r.expected, r.actual)); r.keptExisting = true; }
        const owners = r.targetId && !r.sharedWith ? ownersOf(r.targetId, r.sourceKey) : [];
        const guestOwned = owners.length && owners.every(c => String(c.sourceStableKey).includes(GUEST_BUYER_KEY_MARKER));
        // A contact carrying this row's own marker is this row's contact; guest buyers that share it
        // point at it legitimately, so this row keeps its own values (it is not demoted to a sharer).
        if (guestOwned && marker && r.actual?.externalId === marker) { /* ours */ }
        // A guest buyer with this email adopted the contact first: the same person, so this row
        // shares it (the mirror of a guest sharing a customer's contact). Any other owner is a conflict.
        else if (guestOwned && v.email(r.expected.email?.email)) share(target, owners[0]);
        else if (owners.length) throw conflict('Target contact belongs to another source key');
      } catch (e) { if (e && e.interruption === true) throw e; r.error = e.message; r.identityConflict = Boolean(e.identityConflict); }
    }
    for (const r of work) if (r.targetId && work.some(other => other !== r && other.targetId === r.targetId)) { r.error = 'Distinct source keys share a target contact'; r.identityConflict = true; }
    const save = r => {
      const previous = state.rows[r.sourceKey];
      const lastVerifiedReceipt = v.validReceipt(previous?.receipt) ? previous.receipt : previous?.lastVerifiedReceipt || null;
      state.rows[r.sourceKey] = { sourceKey: r.sourceKey, targetId: r.targetId, baseline: r.baseline, identityConflict: Boolean(r.identityConflict),
        outcome: r.outcome || 'needs_verification', uncertain: Boolean(r.uncertain), error: r.error || null, receipt: r.receipt || null, lastVerifiedReceipt,
        ...(r.sharedWith ? { sharedWith: r.sharedWith } : {}), ...(r.keptExisting ? { keptExisting: true } : {}), ...(r.errorCode ? { errorCode: r.errorCode } : {}), ...(r.droppedValues?.length ? { droppedValues: r.droppedValues } : {}) };
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
        const writer = readinessGrant ? { send: request => wix.send(w.withBulkReadinessGrant(request, { readinessGrant, sourceStableKeys: group.map(r => r.sourceKey) })) } : wix;
        const result = await w.bulkUpsertContacts(writer, group.map(r => r.expected), { updateMember: group[0].updateMember === true });
        const again = [];
        for (const outcome of result.results) {
          if (!outcome.correlated) continue;
          const r = group[outcome.index];
          if (outcome.success) {
            if (r.targetId && r.targetId !== outcome.contactId) { r.error = 'Upsert returned a different contact identity'; r.identityConflict = true; save(r); continue; }
            // Never silent: a write that landed on a contact another source record owns is recorded.
            if (ownersOf(outcome.contactId, r.sourceKey).length) {
              r.targetId = outcome.contactId; r.uncertain = false; r.error = 'Upsert landed on a contact another source record owns'; r.identityConflict = true; save(r); continue;
            }
            r.targetId = outcome.contactId; r.uncertain = false; r.confirmedCreate = true;
          } else if (REFUSED_UPSERT_CODES[outcome.errorCode] && dropValue(r, REFUSED_UPSERT_CODES[outcome.errorCode], DROP_REASONS.REFUSED)) {
            // Refused value: nothing was written; the same row goes again once without it.
            r.uncertain = false; again.push(r);
          } else { r.error = [outcome.errorCode, outcome.errorMessage].filter(Boolean).join(': ') || 'Contact write failed'; if (outcome.errorCode) r.errorCode = String(outcome.errorCode); r.uncertain = false; }
          save(r);
        }
        if (again.length) batches.push(again);
        for (const index of result.unresolvedIndexes) { group[index].error = 'Unresolved bulk contact result'; save(group[index]); }
      } catch (e) {
        // An expired token stops the import, and never as a contact outcome. The client raises it
        // only for a request that was refused or never sent, so the group is not uncertain:
        // clear the pre-write mark, or a resume after re-minting refuses every row in it.
        if (e && e.interruption === true) {
          if (e.requestApplied === false) { for (const r of group) { r.uncertain = false; save(r); } await stateIO.checkpoint(projectDir, state, group); }
          throw e;
        }
        for (const r of group) {
          r.error = e.message;
          // Refused before sending, or denied: nothing was written, so nothing is uncertain.
          if (e.requestSent === false || [401, 403].includes(e.status || e.statusCode)) r.uncertain = false;
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
        } catch (e) { if (e && e.interruption === true) throw e; r.readError = e.message; }
        if (attempt < verifyAttempts) await sleep(100 * attempt);
      }
      if (!r.receipt?.verified) { r.error ||= r.readError || 'Contact values could not be verified'; r.outcome = 'needs_verification'; }
      save(r);
      if (r.outcome === 'verified') publications.push({ row: contactCrosswalkRow(r), receipt: r.receipt, options: r });
      verifiedBatch.push(r);
      if (verifiedBatch.length === 100) { await stateIO.checkpoint(projectDir, state, verifiedBatch); verifiedBatch = []; }
    }
    await stateIO.checkpoint(projectDir, state, verifiedBatch);
    await stateIO.persist(projectDir, state);
    await stateIO.publishMany(projectDir, publications, work.filter(r => r.identityConflict).map(r => r.sourceKey));
    return stateIO.report(work.map(r => state.rows[r.sourceKey]), siteId);
  }, { script: 'contact-import.js', reentrant: true });
}
module.exports = { findMatching, importContacts, contactCrosswalkRow };
