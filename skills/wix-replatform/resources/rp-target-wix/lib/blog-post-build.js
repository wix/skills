'use strict';

const ledger = require('./blog-post-build-ledger');
const reports = require('./blog-post-build-report');
const duplicates = require('./blog-post-build-duplicates');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const NOT_FOUND_CODE = 'NOT_FOUND';
function isNotFound(error) {
  if (error?.status !== 404) return false;
  const code = error.code || error.applicationErrorCode || error.details?.code ||
    error.body?.details?.applicationError?.code;
  const message = error.body?.message || error.message || '';
  return [NOT_FOUND_CODE, 'ENTITY_NOT_FOUND'].includes(code) ||
    (!code && error.outcomeKnown === true && /^entity not found\b/i.test(String(message)));
}
async function readOrNull(fn, id) {
  try { return await fn(id); }
  catch (error) { if (isNotFound(error)) return null; throw error; }
}
function stableKey(post) { return String(post.sourceStableKey ?? post.id); }
function sourceDate(post) { return Date.parse(post.firstPublishedDate || post.date || 0) || 0; }
function sortPosts(posts) { return [...posts].sort((a, b) => sourceDate(a) - sourceDate(b) || stableKey(a).localeCompare(stableKey(b))); }
function sampleKeys(posts) {
  if (!posts.length) return new Set();
  const ordered = sortPosts(posts);
  const chosen = [ordered[0]];
  const longest = [...ordered].sort((a, b) =>
    encodeURIComponent(b.desiredPost?.seoSlug || b.slug || '').length - encodeURIComponent(a.desiredPost?.seoSlug || a.slug || '').length)[0];
  if (longest && stableKey(longest) !== stableKey(chosen[0])) chosen.push(longest);
  const rest = ordered.filter(post => !chosen.includes(post)).sort((a, b) =>
    ledger.sha(stableKey(a)).localeCompare(ledger.sha(stableKey(b))));
  return new Set([...chosen, ...rest].slice(0, Math.min(10, posts.length)).map(stableKey));
}
function budgetPlan(posts, transforms = {}) {
  const ready = posts.filter(post => post.mediaReady !== false);
  if (transforms.rewriteLinks && ready.some(post => typeof post.hasPostLinks !== 'boolean')) {
    throw new Error('blog preflight needs hasPostLinks for every ready post when link rewriting is registered');
  }
  const N = ready.length;
  const S0 = ready.filter(post => post.slug && encodeURIComponent(post.slug).length > 100).length;
  const L = ready.filter(post => post.hasPostLinks === true).length;
  return { N, S0, L, ceiling: N + N + L + 40, expected: N + S0 + L + 40 };
}
function makeFinding(name, blocking, identity, details = {}) {
  return { check: name, blocking, findingKey: ledger.sha({ name, identity }), ...details };
}
function defaultChecks() {
  return [{ name: 'path', blocking: false, kind: 'verify', run(published, ctx) {
    const actual = publishedPath(published);
    const expected = ctx.expectedPath;
    return actual === expected ? [] : [makeFinding('path', false,
      { sourceStableKey: ctx.sourceStableKey, expected }, { expected, actual })];
  } }];
}
function checkRegistry(checks = []) {
  const out = [...defaultChecks(), ...checks];
  const names = new Set();
  for (const check of out) {
    if (!check.name || !ledger.SNAPSHOT_KINDS.has(check.kind) ||
      typeof check.run !== 'function' || typeof check.blocking !== 'boolean') throw new Error('invalid blog check');
    if (names.has(check.name)) throw new Error(`duplicate blog check ${check.name}`);
    names.add(check.name);
  }
  return out;
}
function phase(projectDir, post, value, extra = {}) {
  return ledger.appendRow(projectDir, { kind: 'phase', sourceStableKey: stableKey(post), phase: value, ...extra });
}
function current(projectDir, key) { return ledger.fold(ledger.readRows(projectDir)).posts.get(key); }
function bodyFrom(post) {
  const body = post.desiredPost;
  if (!body) throw new Error(`blog post ${stableKey(post)} has no desiredPost`);
  return ledger.validateDesiredPost(structuredClone(body));
}
function commitGeneration(projectDir, post, draftId, desiredPost, origin, event, projection, extra = {}) {
  const saved = ledger.saveGeneration(projectDir, stableKey(post), desiredPost, origin,
    { draftId, ...extra });
  return ledger.appendRow(projectDir, { kind: 'desired-state', sourceStableKey: stableKey(post),
    draftId, ...saved, event, projection });
}
function desiredFor(projectDir, key) {
  const state = current(projectDir, key);
  if (!state?.desired) throw new Error(`blog post ${key}: no committed desired state`);
  return ledger.loadGeneration(projectDir, state.desired.snapshotSha);
}
function validateClient(client) {
  for (const name of ['createDraft', 'updateDraft', 'publishDraft', 'getDraft', 'getPost',
    'listDrafts', 'deletePost']) {
    if (typeof client?.[name] !== 'function') throw new Error(`blog client needs ${name}`);
  }
}
async function allDrafts(client) {
  const drafts = [];
  let cursor = null;
  const seen = new Set();
  for (let page = 0; page < 1000; page += 1) {
    const result = await client.listDrafts({ cursor });
    if (!Array.isArray(result?.drafts)) throw new Error('draft listing lacked drafts array');
    drafts.push(...result.drafts);
    if (!result.nextCursor) return drafts;
    if (seen.has(result.nextCursor)) throw new Error('draft listing cursor repeated');
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error('draft listing page cap reached');
}
function candidateCreatedAfter(candidate, intent) {
  const created = Date.parse(candidate.createdDate || candidate.createdAt);
  const started = Date.parse(intent.ts);
  return Number.isFinite(created) && created >= started - 5 * 60_000;
}
function ownedElsewhere(id, key, state, crosswalk) {
  if (typeof crosswalk?.idOwners !== 'function') throw new Error('blog adoption requires crosswalk.idOwners');
  for (const [otherKey, other] of state.posts) {
    if (otherKey !== key && other.rows.some(row => row.draftId === id || row.postId === id)) return true;
  }
  return crosswalk.idOwners(id).some(owner => String(owner) !== key);
}
async function candidateDrafts(client, intent, post, state, crosswalk, expectedHashes, expectedTitle) {
  const list = await allDrafts(client);
  const pref = list.filter(candidate => {
    if (candidate.title !== expectedTitle) return false;
    // A list page can omit fields that a full draft read includes. Do not interpret
    // a sparse listing as proof that a draft does not match an uncertain create.
    return !candidate.createdDate && !candidate.createdAt || candidateCreatedAfter(candidate, intent);
  });
  const matches = [];
  const problems = [];
  for (const candidate of pref) {
    const full = await client.getDraft(candidate.id);
    if (ledger.fingerprint(full) !== intent.fingerprint) continue;
    if (!candidateCreatedAfter(full, intent)) {
      problems.push({ id: candidate.id, creationTime: 'missing-or-outside-window' });
      continue;
    }
    const bodyMatches = ledger.bodySha(full) === intent.createBodySha;
    const owned = ownedElsewhere(candidate.id, stableKey(post), state, crosswalk);
    const collision = expectedHashes.filter(value => value === intent.createBodySha).length > 1;
    if (bodyMatches && !owned && !collision) matches.push(full);
    else problems.push({ id: candidate.id, bodyMatches, ownedElsewhere: owned, sourceCollision: collision });
  }
  return { matches, problems };
}
async function recoverCreating(projectDir, post, client, crosswalk, expectedHashes, options) {
  const key = stableKey(post);
  const state = ledger.fold(ledger.readRows(projectDir));
  const intent = state.posts.get(key).phase;
  const title = desiredFor(projectDir, key).desiredPost.title;
  let found = await candidateDrafts(client, intent, post, state, crosswalk, expectedHashes, title);
  if (!found.matches.length && !found.problems.length) {
    await sleep(options.settleMs ?? 10_000);
    found = await candidateDrafts(client, intent, post, state, crosswalk, expectedHashes, title);
  }
  if (found.problems.length || found.matches.length > 1) {
    phase(projectDir, post, 'held', { reason: 'adoption-ambiguous', candidates: [...found.matches.map(x => x.id), ...found.problems.map(x => x.id)] });
    throw new Error(`blog post ${key}: adoption-ambiguous`);
  }
  if (found.matches.length === 1) return { draft: found.matches[0], recreated: false, adopted: true };
  // The intent pins the complete body. Source input may have changed since the crash.
  const pinned = desiredFor(projectDir, key).desiredPost;
  if (ledger.bodySha(pinned) !== intent.createBodySha) throw new Error(`blog post ${key}: create intent body changed`);
  const draft = await client.createDraft(pinned);
  return { draft, recreated: true };
}
async function captureCreate(projectDir, post, client, crosswalk, expectedHashes, options) {
  const key = stableKey(post);
  let state = current(projectDir, key);
  let newIntent = false;
  if (!state?.phase || state.phase.phase === 'media-pending' ||
    state.phase.phase === 'held' && state.phase.reason === 'desired-post-invalid' && !latestId(state)) {
    const body = bodyFrom(post);
    const oldId = crosswalk?.get ? await crosswalk.get(key) : null;
    if (oldId) {
      const id = typeof oldId === 'string' ? oldId : oldId.targetId || oldId.postId || oldId.draftId;
      if (!id) throw new Error(`blog post ${key}: crosswalk row has no target id`);
      const owners = typeof crosswalk.idOwners === 'function' ? crosswalk.idOwners(id).map(String) : [];
      if (owners.length !== 1 || owners[0] !== key) {
        phase(projectDir, post, 'held', { draftId: id, reason: 'legacy-mismatch' });
        throw new Error(`blog post ${key}: legacy crosswalk id has ambiguous owners`);
      }
      const draft = await readOrNull(value => client.getDraft(value), id);
      if (draft) {
        const full = draft.draftPost || draft;
        if (ledger.bodySha(full) !== ledger.bodySha(body) || ledger.fingerprint(full) !== ledger.fingerprint(body) ||
          ownedElsewhere(id, key, ledger.fold(ledger.readRows(projectDir)), crosswalk) ||
          expectedHashes.filter(hash => hash === ledger.bodySha(body)).length > 1) {
          phase(projectDir, post, 'held', { draftId: id, reason: 'legacy-mismatch' });
          throw new Error(`blog post ${key}: legacy-mismatch`);
        }
        commitGeneration(projectDir, post, id, body, 'source', 'captured', undefined,
          { ownerState: post.ownerState });
        phase(projectDir, post, 'drafted', { draftId: id, slug: full.slug || null,
          fingerprint: ledger.fingerprint(body), createBodySha: ledger.bodySha(body),
          storedBodySha: ledger.bodySha(full), legacy: true });
        return;
      }
      const published = await readOrNull(value => client.getPost(value), id);
      if (!published) throw new Error(`blog post ${key}: crosswalk target missing on both surfaces`);
      options.publishedCache?.set(key, published);
      const saved = commitGeneration(projectDir, post, id, body, 'source', 'captured', undefined,
        { ownerState: post.ownerState });
      const path = expectedPath(published.slug || body.seoSlug, post);
      phase(projectDir, post, 'snapshot-saved', { draftId: id,
        expectedPath: path, snapshotSha: saved.snapshotSha, snapshotOrigin: 'source' });
      phase(projectDir, post, 'adopted-published', { draftId: id, postId: id,
        expectedPath: path, publishedPath: publishedPath(published) });
      return;
    }
    commitGeneration(projectDir, post, null, body, 'run', 'captured', undefined,
      { ownerState: post.ownerState });
    phase(projectDir, post, 'creating', { fingerprint: ledger.fingerprint(body), createBodySha: ledger.bodySha(body) });
    state = current(projectDir, key);
    newIntent = true;
  }
  if (state.phase.phase !== 'creating') return;
  const result = newIntent
    ? { draft: await client.createDraft(desiredFor(projectDir, key).desiredPost), recreated: false }
    : await recoverCreating(projectDir, post, client, crosswalk, expectedHashes, options);
  const draft = result.draft?.draftPost || result.draft;
  if (!draft?.id) throw new Error(`blog post ${key}: create response lacks draft id`);
  if (result.adopted && ledger.bodySha(draft) !== state.phase.createBodySha) {
    phase(projectDir, post, 'held', { draftId: draft.id, reason: 'create-projection-mismatch' });
    throw new Error(`blog post ${key}: create response body projection differs`);
  }
  phase(projectDir, post, 'drafted', { draftId: draft.id, slug: draft.slug || null,
    fingerprint: state.phase.fingerprint, createBodySha: state.phase.createBodySha,
    storedBodySha: ledger.bodySha(draft), recreatedAfterIntent: result.recreated });
}
function latestId(postState) {
  return [...postState.rows].reverse().find(row => row.draftId)?.draftId;
}
function latestSlug(postState) {
  return [...postState.rows].reverse().find(row => Object.hasOwn(row, 'slug'))?.slug || null;
}
function expectedPath(slug, post) {
  if (!slug) return null;
  const prefix = String(post?.blogPathPrefix || '/post').replace(/\/$/, '');
  return `${prefix}/${encodeURIComponent(slug)}`;
}
function publishedPath(post) {
  const raw = post?.url?.path || post?.url?.relativePath || post?.path || post?.url;
  if (typeof raw === 'string') {
    try { return new URL(raw).pathname; } catch { return raw; }
  }
  return null;
}
async function updateWithIntent(projectDir, post, client, draftId, desiredPost, projection, origin, ownerState) {
  commitGeneration(projectDir, post, draftId, desiredPost, origin, 'update-intent', Object.keys(projection),
    { ownerState });
  const response = await client.updateDraft(draftId, projection);
  const partial = response?.draftPost || response || {};
  const committed = { ...desiredPost };
  if (Object.hasOwn(partial, 'slug') && partial.slug) committed.seoSlug = partial.slug;
  commitGeneration(projectDir, post, draftId, committed, origin, 'update-applied', Object.keys(projection),
    { ownerState, finalSlug: partial.slug || null });
  return { response: partial, desiredPost: committed };
}
async function finalizePost(projectDir, post, client, transforms = {}, options = {}) {
  const key = stableKey(post);
  let state = current(projectDir, key);
  if (!state || ['media-pending', 'snapshot-saved', 'publishing', 'published',
    'adopted-published', 'verified', 'verify-failed'].includes(state.phase?.phase)) return;
  if (state.phase?.phase === 'links-final' && !state.pendingIntent) return;
  if (state.phase?.phase === 'held' && ['adoption-ambiguous', 'legacy-mismatch',
    'create-projection-mismatch'].includes(state.phase.reason)) return;
  if (state.containmentOpen) return;
  const draftId = latestId(state);
  if (!draftId) return;
  if ((state.phase.phase === 'contained' || state.phase.reason === 'leftover-after-publish') &&
    typeof transforms.detectLeftovers !== 'function') {
    if (state.phase.phase !== 'held') phase(projectDir, post, 'held', { draftId,
      reason: 'leftover-after-publish' });
    return;
  }
  let generation = desiredFor(projectDir, key);
  let desired = generation.desiredPost;
  let origin = generation.snapshotOrigin;
  let ownerState = generation.ownerState;
  let slug = latestSlug(state);
  const heldResume = state.phase.phase === 'held' || state.phase.phase === 'contained' ||
    state.pendingIntent && origin === 'held-draft';
  if (heldResume) {
    const liveDraft = await client.getDraft(draftId);
    try { desired = ledger.fromDraftResponse(liveDraft); }
    catch (error) { phase(projectDir, post, 'held', { draftId, reason: 'desired-post-invalid', detail: error.message }); return; }
    origin = 'held-draft';
    if (typeof transforms.captureOwnerState === 'function')
      ownerState = await transforms.captureOwnerState(desired, post, ownerState);
    commitGeneration(projectDir, post, draftId, desired, origin, 'captured', undefined,
      { ownerState, finalSlug: (liveDraft.draftPost || liveDraft).slug || null });
    const readSlug = (liveDraft.draftPost || liveDraft).slug || null;
    if (!readSlug) { if (state.phase.reason !== 'slug-missing-in-response') phase(projectDir, post, 'held', { draftId, reason: 'slug-missing-in-response' }); return; }
    if (slug && readSlug !== slug) { if (state.phase.reason !== 'slug-changed-while-held') phase(projectDir, post, 'held', { draftId, reason: 'slug-changed-while-held', slug }); return; }
    slug = readSlug;
  }
  if (!heldResume && (state.phase.phase === 'drafted' || state.phase.phase === 'held' || state.phase.phase === 'contained')) {
    if (!slug || post.forceSlugUpdate) {
      const sourceSlug = post.slug || desired.seoSlug;
      if (!sourceSlug) { phase(projectDir, post, 'held', { draftId, reason: 'slug-missing-in-response' }); return; }
      desired.seoSlug = sourceSlug;
      const update = await updateWithIntent(projectDir, post, client, draftId, desired,
        { seoSlug: sourceSlug, media: desired.media }, origin, ownerState);
      desired = update.desiredPost;
      slug = update.response.slug || null;
      if (!slug) { phase(projectDir, post, 'held', { draftId, reason: 'slug-missing-in-response' }); return; }
      phase(projectDir, post, 'slug-set', { draftId, slug, expectedPath: expectedPath(slug, post) });
    }
  }
  if (!slug) { phase(projectDir, post, 'held', { draftId, reason: 'slug-missing-in-response' }); return; }
  if (options.slugOnly) return;
  const index = options.slugIndex || new Map();
  const rewritten = transforms.rewriteLinks ? await transforms.rewriteLinks(structuredClone(desired), post, index) : desired;
  if (rewritten?.waitingFor?.length) {
    phase(projectDir, post, 'held', { draftId, slug, reason: 'waiting-for-linked-post', waitingFor: rewritten.waitingFor }); return;
  }
  const next = rewritten?.desiredPost || rewritten;
  if (ledger.canonical(next.richContent) !== ledger.canonical(desired.richContent)) {
    desired = next;
    const update = await updateWithIntent(projectDir, post, client, draftId, desired,
      { richContent: desired.richContent, media: desired.media }, origin, ownerState);
    desired = update.desiredPost;
    if (!update.response.slug) { phase(projectDir, post, 'held', { draftId, reason: 'slug-missing-in-response' }); return; }
    if (update.response.slug !== slug) {
      phase(projectDir, post, 'held', { draftId, slug, reason: 'slug-changed-while-held' });
      return;
    }
    slug = update.response.slug;
  }
  const leftovers = transforms.detectLeftovers ? await transforms.detectLeftovers(desired, post, index) : [];
  ledger.appendRow(projectDir, { kind: 'leftover-set', sourceStableKey: key, findings: leftovers });
  const blockingLeftover = leftovers.find(f => f.blocking);
  if (blockingLeftover) {
    const reason = blockingLeftover.check === 'source-address' ? 'source-address-outside-link' :
      blockingLeftover.reason === 'source-address-outside-link' ? blockingLeftover.reason : 'leftover-after-rewrite';
    if (state.phase.phase !== 'held' || state.phase.reason !== reason)
      phase(projectDir, post, 'held', { draftId, slug, reason });
    return;
  }
  phase(projectDir, post, 'links-final', { draftId, slug, expectedPath: expectedPath(slug, post) });
}
async function proveAbsence(client, id, waits = [1000, 2000, 4000, 8000, 15000]) {
  for (const wait of waits) {
    if (wait) await sleep(wait);
    const published = await readOrNull(value => client.getPost(value), id);
    if (published) return { published: true, post: published };
  }
  const draft = await readOrNull(value => client.getDraft(value), id);
  if (!draft) throw new Error(`blog post ${id}: absence ambiguous; both post and draft missing`);
  return { published: false, draft };
}
async function verifyPost(projectDir, post, client, checks, sampled, via = 'read', fetchLivePage = true,
  alreadyRead = null) {
  const key = stableKey(post);
  const state = current(projectDir, key);
  const id = latestId(state);
  const published = alreadyRead || await client.getPost(id);
  const expected = [...state.rows].reverse().find(row => row.expectedPath)?.expectedPath;
  const ctx = { sourceStableKey: key, sourcePost: post, expectedPath: expected, sampled };
  const findings = [];
  const byKind = new Map();
  for (const check of checks) {
    const result = await check.run(published, ctx);
    if (!Array.isArray(result)) throw new Error(`blog check ${check.name} did not return findings`);
    if (!byKind.has(check.kind)) byKind.set(check.kind, []);
    for (const finding of result) {
      if (!finding?.findingKey) throw new Error(`blog check ${check.name} returned a finding without findingKey`);
      const normalized = { ...finding, check: check.name, blocking: check.blocking };
      findings.push(normalized);
      byKind.get(check.kind).push(normalized);
    }
  }
  if (sampled && fetchLivePage) {
    if (typeof client.fetchPage !== 'function') throw new Error('live-page fetch required for the verification sample');
    const page = await client.fetchPage(expected);
    if (page.status !== 200 || String(page.body || '').includes('fit/w_0')) {
      findings.push(makeFinding('live-page', false, { key, expected }, { status: page.status }));
    }
    const covers = page.coverUrls || [];
    if (covers.length > 3) throw new Error('sample page reported more than three cover URLs');
    for (const url of covers) {
      if (typeof client.fetchImage !== 'function') throw new Error('cover-image fetch required for a sampled page with a cover');
      const result = await client.fetchImage(url);
      if (result.status !== 200) findings.push(makeFinding('cover-url', false, { key, url }, { status: result.status }));
    }
  }
  for (const [kind, ownFindings] of byKind) {
    if (kind !== 'verify') ledger.appendRow(projectDir, { kind, sourceStableKey: key, findings: ownFindings });
  }
  if (!fetchLivePage) {
    for (const old of state.openFindings?.verify || []) {
      if (['live-page', 'cover-url'].includes(old.check)) findings.push(old);
    }
  }
  ledger.appendRow(projectDir, { kind: 'verify', sourceStableKey: key, findings, sampled,
    publishedPath: publishedPath(published) });
  const blocking = findings.some(finding => finding.blocking);
  if (blocking) return { blocking, findings, published };
  if (findings.length) phase(projectDir, post, 'verify-failed', { draftId: id,
    postId: id, publishedPath: publishedPath(published), reason: 'checks-failed' });
  else phase(projectDir, post, 'verified', { draftId: id, postId: id,
    publishedPath: publishedPath(published), via });
  return { blocking, findings, published };
}
async function containPost(projectDir, post, client, crosswalk, expectedHashes = [], options = {}) {
  const key = stableKey(post);
  let state = current(projectDir, key);
  const id = state.containmentOpen
    ? [...state.rows].reverse().find(row => row.phase === 'containing')?.postId
    : latestId(state);
  if (!state.containmentOpen) {
    const snap = [...state.rows].reverse().find(row => row.phase === 'snapshot-saved');
    const evidenceFile = options.published
      ? ledger.savePublishedEvidence(projectDir, key, options.published) : null;
    phase(projectDir, post, 'containing', { draftId: id, postId: id,
      snapshotSha: snap?.snapshotSha, evidenceFile,
      exposedFrom: [...state.rows].reverse().find(row =>
        ['publishing', 'adopted-published'].includes(row.phase))?.ts });
    state = current(projectDir, key);
  }
  let last = state.phase.phase;
  if (last === 'containing' || last === 'contain-failed' && state.phase.reason === 'delete-failed') {
    try {
      const before = await readOrNull(value => client.getPost(value), id);
      if (before) await client.deletePost(id);
      const missing = await readOrNull(value => client.getPost(value), id);
      if (missing) throw new Error('published post still exists');
      phase(projectDir, post, 'contain-deleted', { draftId: id, postId: id, containedAt: new Date().toISOString() });
    } catch (error) {
      phase(projectDir, post, 'contain-failed', { draftId: id, postId: id, reason: 'delete-failed', detail: error.message });
      throw error;
    }
  }
  state = current(projectDir, key); last = state.phase.phase;
  const snap = [...state.rows].reverse().find(row => row.phase === 'snapshot-saved');
  const sourceRecovery = [...state.rows].reverse().find(row => row.phase === 'contain-recreating' && row.snapshotSha);
  let saved;
  try { saved = ledger.loadGeneration(projectDir, sourceRecovery?.snapshotSha || snap?.snapshotSha, key); }
  catch (error) {
    const approval = options.confirmSourceRebuild;
    if (!approval || !String(approval.confirmedBy || '').trim() || !String(approval.note || '').trim()) {
      if (last !== 'contain-failed' || state.phase.reason !== 'snapshot-missing')
        phase(projectDir, post, 'contain-failed', { draftId: id, postId: id, reason: 'snapshot-missing' });
      throw new Error(`blog post ${key}: snapshot-missing requires a named source-rebuild confirmation`);
    }
    if (sourceRecovery) throw new Error(`blog post ${key}: confirmed source-rebuild snapshot is missing`);
    const rebuilt = bodyFrom(post);
    const row = commitGeneration(projectDir, post, id, rebuilt, 'source', 'captured', undefined,
      { ownerState: post.ownerState });
    phase(projectDir, post, 'contain-recreating', { draftId: id, postId: id,
      fingerprint: ledger.fingerprint(rebuilt), createBodySha: ledger.bodySha(rebuilt),
      snapshotSha: row.snapshotSha, sourceRebuildBy: approval.confirmedBy,
      sourceRebuildNote: approval.note });
    state = current(projectDir, key); last = state.phase.phase;
    saved = ledger.loadGeneration(projectDir, row.snapshotSha, key);
  }
  if (last === 'contain-deleted' || last === 'contain-failed' && state.phase.reason !== 'delete-failed') {
    let draft = await readOrNull(value => client.getDraft(value), id);
    if (!draft) {
      const previousIntent = [...state.rows].reverse().find(row => row.phase === 'contain-recreating');
      if (!previousIntent || last === 'contain-deleted') {
        phase(projectDir, post, 'contain-recreating', { draftId: id,
          fingerprint: ledger.fingerprint(saved.desiredPost), createBodySha: ledger.bodySha(saved.desiredPost) });
        state = current(projectDir, key);
      }
      last = 'contain-recreating';
    }
    if (draft) {
      const newId = (draft.draftPost || draft).id;
      phase(projectDir, post, 'contain-drafted', { draftId: newId, postId: id,
        storedBodySha: ledger.bodySha(draft), survivedDelete: true });
      commitGeneration(projectDir, post, newId, saved.desiredPost, saved.snapshotOrigin, 'captured', undefined,
        { ownerState: saved.ownerState, finalSlug: saved.finalSlug });
    }
  }
  state = current(projectDir, key); last = state.phase.phase;
  if (last === 'contain-recreating' || last === 'contain-failed' &&
    ['recreate-failed', 'recreate-ambiguous'].includes(state.phase.reason)) {
    const intent = [...state.rows].reverse().find(row => row.phase === 'contain-recreating');
    let found = await candidateDrafts(client, intent, post, ledger.fold(ledger.readRows(projectDir)),
      crosswalk, expectedHashes.length ? expectedHashes : [intent.createBodySha], saved.desiredPost.title);
    if (!found.matches.length && !found.problems.length) {
      await sleep(options.settleMs ?? 10_000);
      found = await candidateDrafts(client, intent, post, ledger.fold(ledger.readRows(projectDir)),
        crosswalk, expectedHashes.length ? expectedHashes : [intent.createBodySha], saved.desiredPost.title);
    }
    if (found.problems.length || found.matches.length > 1) {
      phase(projectDir, post, 'contain-failed', { draftId: id, postId: id, reason: 'recreate-ambiguous',
        candidates: [...found.matches.map(x => x.id), ...found.problems.map(x => x.id)] });
      throw new Error(`blog post ${key}: recreate-ambiguous`);
    }
    let draft;
    const recreatedAfterIntent = found.matches.length === 0;
    try { draft = found.matches[0] || await client.createDraft(saved.desiredPost); }
    catch (error) { phase(projectDir, post, 'contain-failed', { draftId: id, postId: id, reason: 'recreate-failed' }); throw error; }
    const newId = (draft.draftPost || draft).id;
    if (!newId || !recreatedAfterIntent && ledger.bodySha(draft) !== intent.createBodySha) {
      phase(projectDir, post, 'contain-failed', { draftId: id, postId: id, reason: 'recreate-ambiguous' });
      throw new Error(`blog post ${key}: recreated draft body mismatch`);
    }
    phase(projectDir, post, 'contain-drafted', { draftId: newId, postId: id,
      storedBodySha: ledger.bodySha(draft), recreatedAfterIntent });
    commitGeneration(projectDir, post, newId, saved.desiredPost, saved.snapshotOrigin, 'captured', undefined,
      { ownerState: saved.ownerState, finalSlug: saved.finalSlug });
  }
  state = current(projectDir, key); last = state.phase.phase;
  if (last === 'contain-drafted') {
    if (crosswalk && typeof crosswalk.set !== 'function') throw new Error('containment requires crosswalk.set');
    if (crosswalk?.set) await crosswalk.set(key, latestId(state));
    phase(projectDir, post, 'contain-linked', { draftId: latestId(state), postId: id });
  }
  state = current(projectDir, key);
  if (state.phase.phase === 'contain-linked') {
    const operation = [...state.rows].reverse().find(row => row.phase === 'containing');
    const deletion = [...state.rows].reverse().find(row => row.phase === 'contain-deleted');
    phase(projectDir, post, 'contained', { draftId: latestId(state), postId: id,
      reason: 'leftover-after-publish', exposedFrom: operation?.exposedFrom,
      containedAt: deletion?.containedAt, snapshotSha: operation?.snapshotSha });
  }
}
async function publishPost(projectDir, post, client, checks, sampled, options) {
  const key = stableKey(post);
  let state = current(projectDir, key);
  if (!state || state.containmentOpen) return;
  const id = latestId(state);
  if (state.phase.phase === 'links-final') {
    const currentBody = desiredFor(projectDir, key);
    const saved = commitGeneration(projectDir, post, id, currentBody.desiredPost,
      currentBody.snapshotOrigin, 'captured', undefined,
      { ownerState: currentBody.ownerState, finalSlug: state.phase.slug });
    ledger.loadGeneration(projectDir, saved.snapshotSha);
    phase(projectDir, post, 'snapshot-saved', { draftId: id,
      slug: state.phase.slug, expectedPath: state.phase.expectedPath, snapshotSha: saved.snapshotSha });
  }
  state = current(projectDir, key);
  if (state.phase.phase === 'snapshot-saved') {
    ledger.loadGeneration(projectDir, state.phase.snapshotSha);
    phase(projectDir, post, 'publishing', { draftId: id, expectedPath: state.phase.expectedPath });
    await client.publishDraft(id);
    phase(projectDir, post, 'published', { draftId: id, postId: id,
      expectedPath: state.phase.expectedPath });
  } else if (state.phase.phase === 'publishing') {
    const absence = await proveAbsence(client, id, options.absenceWaits);
    if (!absence.published) await client.publishDraft(id);
    phase(projectDir, post, 'published', { draftId: id, postId: id,
      expectedPath: state.phase.expectedPath });
  }
  state = current(projectDir, key);
  if (!['published', 'adopted-published'].includes(state.phase.phase)) return;
  const result = await verifyPost(projectDir, post, client, checks, sampled, 'read', true,
    options.publishedCache?.get(key));
  if (result.blocking) {
    await containPost(projectDir, post, client, options.crosswalk, options.expectedHashes,
      { ...options, published: result.published });
    throw new Error(`blog post ${key}: blocking verification failed; contained`);
  }
  return result;
}
async function runBlogBuild({ projectDir, posts, client, crosswalk, checks = [], transforms = {}, options = {} }) {
  validateClient(client);
  const originalClient = client;
  const measured = [];
  let activeKey = null;
  client = Object.create(originalClient);
  for (const name of ['createDraft', 'updateDraft', 'publishDraft', 'getDraft', 'getPost',
    'listDrafts', 'deletePost', 'fetchPage', 'fetchImage']) {
    if (typeof originalClient[name] !== 'function') continue;
    client[name] = async (...args) => {
      const started = Date.now();
      try { return await originalClient[name](...args); }
      finally { measured.push({ name, key: activeKey, ms: Date.now() - started }); }
    };
  }
  if (!Array.isArray(posts)) throw new Error('blog posts must be an array');
  const ordered = sortPosts(posts);
  const budget = budgetPlan(ordered, transforms);
  const log = options.log || console.log;
  log(`Blog preflight estimate (before writes): N=${budget.N}, S0=${budget.S0}, L=${budget.L}; ` +
    `added-call ceiling ${budget.ceiling}, expected ${budget.expected} (plus existing creates/publishes; 40 is a fixed maximum).`);
  const registry = checkRegistry(checks);
  return ledger.withLock(projectDir, async () => {
    let finalReport;
    try {
      ledger.setRunId(projectDir, options.runId);
      ledger.resetSnapshotMetrics(projectDir);
      const publishedCache = new Map();
      const hashes = [];
      const invalidKeys = new Set();
      for (const post of ordered.filter(item => item.desiredPost)) {
        const state = current(projectDir, stableKey(post));
        try {
          hashes.push(ledger.bodySha(state?.desired ? desiredFor(projectDir, stableKey(post)).desiredPost : bodyFrom(post)));
        } catch (error) {
          // A referenced generation is durable recovery state. Corruption cannot be
          // reclassified as a source validation hold and must stop before Wix writes.
          if (state?.desired && !state.containmentOpen) throw error;
          if (state?.containmentOpen ||
            ['published', 'adopted-published', 'verified', 'verify-failed'].includes(state?.phase?.phase)) {
            const original = state.rows.find(row => row.createBodySha)?.createBodySha;
            if (original) hashes.push(original);
            continue;
          }
          invalidKeys.add(stableKey(post));
          if (state?.phase?.phase !== 'held' || state.phase.reason !== 'desired-post-invalid')
            phase(projectDir, post, 'held', { draftId: state && latestId(state),
              reason: 'desired-post-invalid', detail: error.message });
        }
      }
      await duplicates.finishPendingEvidence(projectDir, client, crosswalk);
      for (const post of ordered) {
        const key = stableKey(post);
        activeKey = key;
        if (invalidKeys.has(key)) continue;
        const state = current(projectDir, key);
        if (state?.containmentOpen) {
          await containPost(projectDir, post, client, crosswalk, hashes, options);
          throw new Error(`blog post ${key}: containment completed; run stopped`);
        }
        if (['verified', 'verify-failed', 'published', 'adopted-published'].includes(state?.phase?.phase)) continue;
        if (post.mediaReady === false) {
          const reason = post.mediaPendingReason || 'media-not-ready';
          if (!state?.phase || state.phase.phase !== 'media-pending' || state.phase.reason !== reason)
            phase(projectDir, post, 'media-pending', { reason });
          continue;
        }
        if (!state?.phase || state.phase.phase === 'media-pending' || state.phase.phase === 'creating' ||
          state.phase.phase === 'held' && state.phase.reason === 'desired-post-invalid' && !latestId(state)) {
          await captureCreate(projectDir, post, client, crosswalk, hashes,
            { ...options, publishedCache });
        }
      }
      const exactSlugUpdates = ordered.filter(post => {
        const state = current(projectDir, stableKey(post));
        return state?.phase?.phase === 'drafted' && (!latestSlug(state) || post.forceSlugUpdate);
      }).length;
      log(`Blog preflight estimate (after drafts, before updates): N=${budget.N}, S=${exactSlugUpdates}, ` +
        `L=${budget.L}; added-call ceiling ${budget.N + exactSlugUpdates + budget.L + 40}.`);
      const slugIndex = new Map();
      for (const post of ordered) {
        activeKey = stableKey(post);
        const state = current(projectDir, stableKey(post));
        if (state?.phase?.phase === 'drafted' && !latestSlug(state)) {
          await finalizePost(projectDir, post, client, transforms, { slugOnly: true });
        }
      }
      for (const post of ordered) {
        activeKey = stableKey(post);
        const state = current(projectDir, stableKey(post));
        const slug = state && latestSlug(state);
        if (slug) slugIndex.set(stableKey(post), slug);
      }
      for (const post of ordered) {
        activeKey = stableKey(post);
        await finalizePost(projectDir, post, client, transforms, { slugIndex });
        const state = current(projectDir, stableKey(post));
        const slug = state && latestSlug(state);
        if (slug) slugIndex.set(stableKey(post), slug);
      }
      const sample = sampleKeys(ordered.filter(post => {
        const state = current(projectDir, stableKey(post));
        return state?.phase && !state.containmentOpen &&
          !['media-pending', 'held', 'contain-failed', 'contained'].includes(state.phase.phase);
      }));
      if (sample.size && (typeof client.fetchPage !== 'function' || typeof client.fetchImage !== 'function')) {
        throw new Error('blog sample requires fetchPage and fetchImage before the first publish');
      }
      let canaryDone = false;
      for (const post of ordered) {
        activeKey = stableKey(post);
        const state = current(projectDir, stableKey(post));
        if (state?.phase && ['links-final', 'snapshot-saved', 'publishing', 'published', 'adopted-published'].includes(state.phase.phase)) {
          if (state.rows.some(row => ['drafted', 'contain-drafted'].includes(row.phase) && row.recreatedAfterIntent)) {
            await duplicates.detectExtraDrafts(projectDir, client, crosswalk, stableKey(post));
          }
          const result = await publishPost(projectDir, post, client, registry, sample.has(stableKey(post)),
            { ...options, crosswalk, expectedHashes: hashes, publishedCache });
          if (!canaryDone) {
            if (result?.findings?.length) throw new Error(`blog canary ${stableKey(post)} failed verification`);
            canaryDone = true;
            const added = measured.filter(item => item.key === stableKey(post) &&
              ['updateDraft', 'getPost', 'fetchPage', 'fetchImage'].includes(item.name));
            const snapshots = ledger.snapshotMetrics(projectDir, stableKey(post));
            log(`Blog canary local snapshots (measured): ${snapshots.generations} generations, ` +
              `${snapshots.bytes} serialized bytes, ${snapshots.ms.toFixed(1)} ms.`);
            if (added.length) {
              const meanMs = added.reduce((sum, item) => sum + item.ms, 0) / added.length;
              log(`Blog canary timing (measured ${added.length} added calls): mean ${meanMs.toFixed(1)} ms; ` +
                `estimated clean added-call ceiling ${((budget.N + exactSlugUpdates + budget.L + 40) * meanMs / 1000).toFixed(1)} s. ` +
                'The estimate excludes unchanged creates/publishes and local snapshot I/O.');
            }
          }
        }
      }
      await duplicates.detectExtraDrafts(projectDir, client, crosswalk);
    } finally {
      try { finalReport = (await reports.refreshBlogHandoff(projectDir)).report; }
      finally { ledger.setRunId(projectDir, null); }
    }
    return finalReport;
  });
}
async function reverify({ projectDir, post, client, crosswalk, checks = [], sampled, options = {} }) {
  validateClient(client);
  return ledger.withLock(projectDir, async () => {
    const state = current(projectDir, stableKey(post));
    if (state?.phase?.phase !== 'verify-failed') throw new Error('post is not verify-failed');
    const result = await verifyPost(projectDir, post, client, checkRegistry(checks),
      sampled === undefined ? state.snapshots.verify?.sampled === true : sampled, 'reverify', false);
    if (result.blocking) { await containPost(projectDir, post, client, crosswalk, [ledger.bodySha(bodyFrom(post))], options); }
    return (await reports.refreshBlogHandoff(projectDir)).report;
  });
}

module.exports = { runBlogBuild, reverify, sampleKeys, sortPosts, checkRegistry,
  makeFinding, allDrafts, proveAbsence, isNotFound, expectedPath };
