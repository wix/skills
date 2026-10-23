'use strict';

const ledger = require('./blog-post-build-ledger');
const reports = require('./blog-post-build-report');

function pairKey(key, extraId) { return `${key}\u0000${extraId}`; }
function currentPair(projectDir, key, extraId) {
  return ledger.fold(ledger.readRows(projectDir)).duplicates.get(pairKey(key, extraId));
}
function append(projectDir, key, recordedDraftId, extraDraftId, event, rest = {}) {
  return ledger.appendRow(projectDir, { kind: 'duplicate', sourceStableKey: key,
    recordedDraftId, extraDraftId, event, ...rest });
}
function isNotFound(error) {
  if (error?.status !== 404) return false;
  const code = error.code || error.applicationErrorCode || error.details?.code ||
    error.body?.details?.applicationError?.code;
  const message = error.body?.message || error.message || '';
  return ['NOT_FOUND', 'ENTITY_NOT_FOUND'].includes(code) ||
    (!code && error.outcomeKnown === true && /^entity not found\b/i.test(String(message)));
}
async function readOrNull(fn, id) {
  try { return await fn(id); } catch (error) { if (isNotFound(error)) return null; throw error; }
}
async function listAll(client) {
  const drafts = [];
  let cursor = null;
  const cursors = new Set();
  for (let n = 0; n < 1000; n += 1) {
    const page = await client.listDrafts({ cursor });
    if (!Array.isArray(page?.drafts)) throw new Error('draft listing lacks drafts array');
    drafts.push(...page.drafts);
    if (!page.nextCursor) return drafts;
    if (cursors.has(page.nextCursor)) throw new Error('draft listing cursor repeated');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('draft listing page cap reached');
}
function sourceRows(state, key) {
  return state.posts.get(key)?.rows || [];
}
function intentAndCreate(state, key) {
  const rows = sourceRows(state, key);
  const create = [...rows].reverse().find(row => row.kind === 'phase' && ['drafted', 'contain-drafted'].includes(row.phase));
  return {
    intent: [...rows].reverse().find(row => row.seq < create?.seq && row.kind === 'phase' &&
      ['creating', 'contain-recreating'].includes(row.phase)),
    create,
  };
}
function recordedElsewhere(state, id, key, crosswalk) {
  if (typeof crosswalk?.idOwners !== 'function') return true;
  for (const [otherKey, post] of state.posts) {
    if (otherKey !== key && post.rows.some(row => row.draftId === id || row.postId === id)) return true;
  }
  return Boolean(crosswalk?.idOwners?.(id)?.some(owner => String(owner) !== key));
}
function assessProvenance(state, key, extraId, draft, crosswalk) {
  const { intent, create } = intentAndCreate(state, key);
  const sourceFp = intent?.fingerprint;
  const creation = Date.parse(draft?.createdDate || draft?.createdAt);
  const edited = Date.parse(draft?.editedDate || draft?.updatedDate);
  const started = Date.parse(intent?.ts);
  const finished = Date.parse(create?.ts);
  const tests = {
    fingerprint: Boolean(draft && sourceFp && ledger.fingerprint(draft) === sourceFp),
    storedBody: Boolean(draft && create?.storedBodySha && ledger.bodySha(draft) === create.storedBodySha),
    creationWindow: Number.isFinite(creation) && Number.isFinite(started) && Number.isFinite(finished) &&
      creation >= started - 5 * 60_000 && creation <= finished,
    unedited: Number.isFinite(edited) && Number.isFinite(creation) && Math.abs(edited - creation) <= 1000,
    unowned: !recordedElsewhere(state, extraId, key, crosswalk),
  };
  return { status: Object.values(tests).every(Boolean) ? 'consistent' : 'inconsistent', tests,
    title: draft?.title || null, createdDate: draft?.createdDate || draft?.createdAt || null };
}
async function recordProvenance(projectDir, key, extraId, client, crosswalk, alreadyRead) {
  const pair = currentPair(projectDir, key, extraId);
  if (!pair || pair.closed) throw new Error('no open duplicate pair');
  let draft = alreadyRead;
  let readError;
  if (!draft) {
    try { draft = await client.getDraft(extraId); }
    catch (error) { readError = error.message; }
  }
  const state = ledger.fold(ledger.readRows(projectDir));
  const evidence = draft ? assessProvenance(state, key, extraId, draft, crosswalk)
    : { status: 'inconsistent', tests: {}, readError };
  append(projectDir, key, pair.recordedDraftId, extraId, 'provenance', { evidence });
  return evidence;
}
async function finishPendingEvidence(projectDir, client, crosswalk) {
  const state = ledger.fold(ledger.readRows(projectDir));
  for (const pair of state.duplicates.values()) {
    if (!pair.closed && !pair.evidence) await recordProvenance(projectDir, pair.sourceStableKey, pair.extraDraftId, client, crosswalk);
  }
}
async function detectExtraDrafts(projectDir, client, crosswalk, onlyKey) {
  const state = ledger.fold(ledger.readRows(projectDir));
  const targets = [...state.posts.entries()].filter(([key, post]) => (!onlyKey || key === onlyKey) &&
    post.rows.some(row => ['drafted', 'contain-drafted'].includes(row.phase) && row.recreatedAfterIntent));
  if (!targets.length) return [];
  const drafts = await listAll(client);
  const added = [];
  for (const [key, post] of targets) {
    const { intent, create } = intentAndCreate(state, key);
    if (!intent || !create) continue;
    const intentBody = [...post.rows].reverse().find(row => row.kind === 'desired-state' &&
      row.seq < intent.seq);
    if (!intentBody) throw new Error(`blog duplicate ${key}: create intent has no pinned body`);
    const expectedTitle = ledger.loadGeneration(projectDir, intentBody.snapshotSha, key).desiredPost.title;
    for (const draft of drafts) {
      if (draft.id === create.draftId || draft.title !== expectedTitle) continue;
      if (currentPair(projectDir, key, draft.id)) continue;
      // List responses need not include every fingerprint field; use one full read
      // for matching and provenance rather than missing a late-visible duplicate.
      let full;
      try { full = await client.getDraft(draft.id); }
      catch (error) {
        append(projectDir, key, create.draftId, draft.id, 'detected');
        append(projectDir, key, create.draftId, draft.id, 'provenance',
          { evidence: { status: 'inconsistent', tests: {}, readError: error.message } });
        added.push({ sourceStableKey: key, extraDraftId: draft.id });
        continue;
      }
      if (ledger.fingerprint(full) !== intent.fingerprint) continue;
      append(projectDir, key, create.draftId, draft.id, 'detected');
      added.push({ sourceStableKey: key, extraDraftId: draft.id });
      await recordProvenance(projectDir, key, draft.id, client, crosswalk, full);
    }
  }
  return added;
}
function ensureEvidence(pair, expected = 'consistent') {
  if (!pair || pair.closed || pair.evidence?.status !== expected) throw new Error(`duplicate needs current ${expected} evidence`);
}
function confirmOwnership(projectDir, key, extraId, chosenBy, note) {
  return ledger.withLock(projectDir, async () => {
    const pair = currentPair(projectDir, key, extraId);
    ensureEvidence(pair);
    if (!String(chosenBy || '').trim() || !String(note || '').trim()) throw new Error('ownership needs named person and their explanation');
    const row = append(projectDir, key, pair.recordedDraftId, extraId, 'ownership-confirmed', { chosenBy, note });
    return { row, ...(await reports.refreshBlogHandoff(projectDir)) };
  });
}
function keepOrNotImporter(projectDir, key, extraId, event, chosenBy, note) {
  return ledger.withLock(projectDir, async () => {
    const pair = currentPair(projectDir, key, extraId);
    if (!pair || pair.closed) throw new Error('no open duplicate pair');
    if (!['kept', 'not-importer'].includes(event)) throw new Error('invalid duplicate closure');
    if (!String(note || '').trim()) throw new Error('the person’s note is required');
    if (event === 'kept' && !String(chosenBy || '').trim()) throw new Error('chosenBy required');
    const row = append(projectDir, key, pair.recordedDraftId, extraId, event, { chosenBy, note });
    return { row, ...(await reports.refreshBlogHandoff(projectDir)) };
  });
}
async function deleteConfirmedExtra(projectDir, key, extraId, chosenBy, note, client, crosswalk) {
  return ledger.withLock(projectDir, async () => {
    let pair = currentPair(projectDir, key, extraId);
    ensureEvidence(pair);
    if (!pair.confirmation || !String(chosenBy || '').trim() || !String(note || '').trim()) {
      throw new Error('current ownership confirmation and a separate named delete choice required');
    }
    if (!pair.choice) append(projectDir, key, pair.recordedDraftId, extraId, 'delete-chosen', { chosenBy, note });
    const draft = await readOrNull(value => client.getDraft(value), extraId);
    if (!draft) {
      const post = await readOrNull(value => client.getPost(value), extraId);
      if (!post) {
        append(projectDir, key, pair.recordedDraftId, extraId, 'removed');
        return (await reports.refreshBlogHandoff(projectDir)).report;
      }
      append(projectDir, key, pair.recordedDraftId, extraId, 'unresolved',
        { evidence: { status: 'inconsistent', tests: { unpublished: false } } });
      return (await reports.refreshBlogHandoff(projectDir)).report;
    }
    const evidence = assessProvenance(ledger.fold(ledger.readRows(projectDir)), key, extraId, draft, crosswalk);
    if (evidence.status !== 'consistent') {
      append(projectDir, key, pair.recordedDraftId, extraId, 'unresolved', { evidence });
      return (await reports.refreshBlogHandoff(projectDir)).report;
    }
    if (typeof client.deleteDraft !== 'function') throw new Error('client needs deleteDraft for chosen duplicate deletion');
    await client.deleteDraft(extraId);
    const draftAfter = await readOrNull(value => client.getDraft(value), extraId);
    const postAfter = await readOrNull(value => client.getPost(value), extraId);
    if (draftAfter || postAfter) throw new Error('extra draft deletion not confirmed on both surfaces');
    pair = currentPair(projectDir, key, extraId);
    append(projectDir, key, pair.recordedDraftId, extraId, 'removed');
    return (await reports.refreshBlogHandoff(projectDir)).report;
  });
}

function recheckProvenance(projectDir, key, extraId, client, crosswalk) {
  return ledger.withLock(projectDir, async () => {
    const evidence = await recordProvenance(projectDir, key, extraId, client, crosswalk);
    return { evidence, ...(await reports.refreshBlogHandoff(projectDir)) };
  });
}

module.exports = { pairKey, currentPair, assessProvenance,
  finishPendingEvidence, detectExtraDrafts, confirmOwnership, keepOrNotImporter,
  deleteConfirmedExtra, recheckProvenance };
