'use strict';

// rp-target-wix — blog post media: the cover (WordPress `featured_media`) and inline images.
//
// A blog importer that never resolves a WordPress image reference to a Wix file id ships posts
// with no cover and inline images still hot-linked to the old site. This module is the one
// place that does it, so no generated importer re-derives it.
//
// FAILURE POLICY (human-approved): when a post's cover or any inline image cannot be imported,
// THAT POST STAYS PENDING AND RECOVERABLE; other posts continue. Nothing is written to Wix for
// it — no draft, no publish, no crosswalk row — until every medium is confirmed READY. Do NOT
// add a partial-post fallback (import the text, drop a failed cover, keep a source URL for a
// failed inline image): that option was offered and not approved.
//
// Why the post waits for READY although a PENDING file id is already referenceable in blog
// content: that fact (see wix-writers.js, media import section) is true, but the policy needs
// failure discovery BEFORE the post ships, and only a settled file can say it failed.
//
// Caller shape (the generated blog importer):
//
//   const richContent = await convertHtmlToRichContent(wix, post.contentHtml); // no media option
//   const media = await importAndConfirmPostMedia(wix, { post, richContent, state, fetchFeaturedMedia });
//   if (!media.allReady) continue;        // nothing written; the state file already says why
//   applyPostMedia(richContent, media);   // rewrites the SAME document: no second conversion
//   // createDraftPost(wix, { ..., richContent, heroImageId: media.heroImageId }), crosswalk row, then
//   await state.markResolved(post.id, { targetPostId, runId, resumed: media.resumed });
//
// and on the crosswalk-gate path (the post is already written):
//
//   await state.closeIfCrosswalked(post.id, { targetPostId, runId });
//
// Both close the record AND own the recovery-log entry for a post that had been pending, so
// no caller ordering can lose it (see "Recovery-log entry" below).
//
// Inline identity. rewriteInlineMedia replaces an image only when its `imageData.image.src.url`
// EXACTLY equals a map key. So keys are collected from the converted Ricos document, never from
// raw HTML: the collection key and the rewrite key are the same string by construction, with no
// canonicalizer to drift from the converter's own entity decoding and encoding.
//
// Out of scope here: images the converter does not emit as a Ricos image node (lazy-load markup
// with the URL only in data-src/srcset), and inline video/audio.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const writers = require('./wix-writers.js');
const { resolveImageUrl } = require('../../rp-source-wordpress/lib/wp-image-url.js');

const SCHEMA_VERSION = 1;
const STATE_FILE = 'pending-blog-media.ndjson';
const OUTCOMES = ['imported', 'ready', 'fetch-failed', 'unresolvable-url', 'import-rejected', 'failed', 'not-ready', 'status-unknown'];
// A medium whose last row carries a file id in one of these outcomes is resumed, never
// re-imported: `ready` is reused as-is, the others are polled again.
const RESUMABLE = new Set(['imported', 'ready', 'not-ready', 'status-unknown']);

function postStableKey(postOrId) {
  const id = postOrId && typeof postOrId === 'object' ? postOrId.id : postOrId;
  if (id === undefined || id === null || id === '') throw new Error('blog-post-media: a post id is required');
  return `wordpress:post:${String(id)}`;
}

function postTitle(post) {
  const t = post && post.title;
  if (typeof t === 'string') return t;
  if (t && typeof t.rendered === 'string') return t.rendered;
  return null;
}

// --- collection --------------------------------------------------------------------------

function collectRewriteKeys(richContent) {
  const keys = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const url = node.imageData && node.imageData.image && node.imageData.image.src && node.imageData.image.src.url;
    if (typeof url === 'string' && url !== '') keys.push(url);
    (node.nodes || []).forEach(visit);
  };
  ((richContent && richContent.nodes) || []).forEach(visit);
  return keys;
}

// The import URL for one rewrite key: WHATWG resolution against the post's permalink, so
// relative and protocol-relative sources become absolute. Anything that is not http(s) after
// that (data:, blob:, a relative key with no permalink, malformed) is unresolvable.
function resolveImportUrl(key, base) {
  let url;
  try {
    url = base ? new URL(key, base) : new URL(key);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
}

// What this post needs imported. Inline media are deduped by import URL: every rewrite key that
// resolves to the same URL (the same string twice, or a relative and an absolute form) shares one
// import and one file id. An unresolvable key is its own medium, already failed.
function collectPostMedia({ post, richContent }) {
  const media = [];
  const featuredId = post && post.featured_media;
  if (featuredId !== undefined && featuredId !== null && String(featuredId) !== '' && String(featuredId) !== '0') {
    media.push({ mediaKey: `featured:${String(featuredId)}`, kind: 'featured', wpMediaId: String(featuredId), sourceUrl: null, rewriteKeys: [] });
  }
  const byMediaKey = new Map();
  for (const key of collectRewriteKeys(richContent)) {
    const importUrl = resolveImportUrl(key, post && post.link);
    const mediaKey = `inline:${importUrl || key}`;
    let item = byMediaKey.get(mediaKey);
    if (!item) {
      item = { mediaKey, kind: 'inline', wpMediaId: null, sourceUrl: importUrl, rewriteKeys: [] };
      if (!importUrl) item.unresolvable = true;
      byMediaKey.set(mediaKey, item);
      media.push(item);
    }
    if (!item.rewriteKeys.includes(key)) item.rewriteKeys.push(key);
  }
  return media;
}

// --- pending-media state (append-only, authoritative recovery record) -------------------
//
// migrations/<project>/state/crosswalk/pending-blog-media.ndjson. One row per state change; for a
// (sourceStableKey, mediaKey) the last row wins. A `resolved` row closes the post and later
// media rows for it are ignored. Crash discipline matches the pending-invoice file: split on the
// byte; a torn tail is truncated on disk before the next append; a complete unterminated last
// row is kept and terminated first; an unparsable line anywhere else throws as corruption.
//
// Recovery-log entry. A post that a rerun resolves after it had been pending owes one standard
// recovery-log entry. The `resolved` row records that debt (`recoveryOwed`) with a recoveryId and
// timestamp fixed at that moment; a later `recoveryLogged` row pays it. Until then every run that
// meets the post — normally through the crosswalk gate — re-checks the recovery log for that
// recoveryId and appends only if it is absent, then writes `recoveryLogged`. A crash (or a failed
// append) anywhere between the crosswalk row and `recoveryLogged` is therefore repaired by the
// next run, and never produces a second entry.
//
// `recovery` defaults to skills/wix-replatform/lib/import-recovery.js; tests may inject one with
// the same { loadRecoveryLog, appendRecoveryLogEntry } shape.
function createPendingBlogMediaState({ projectDir, recovery } = {}) {
  if (!projectDir) throw new Error('createPendingBlogMediaState needs the migration projectDir');
  const recoveryApi = () => recovery || require('../../../lib/import-recovery.js');
  const filePath = path.join(projectDir, 'state', 'crosswalk', STATE_FILE);
  let droppedPartialLine = null;

  async function readRows() {
    let buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { rows: [], needsTerminator: false };
      throw error;
    }
    const lastNewline = buffer.lastIndexOf(0x0a);
    const completeBytes = lastNewline === -1 ? 0 : lastNewline + 1;
    const complete = completeBytes > 0 ? buffer.subarray(0, completeBytes).toString('utf8').split('\n') : [];
    if (complete.length > 0) complete.pop();
    const rows = [];
    complete.forEach((raw, i) => {
      const line = raw.replace(/\r$/, '').trim();
      if (!line) return;
      try { rows.push(JSON.parse(line)); } catch (error) { throw new Error(`${filePath}:${i + 1} invalid NDJSON: ${error.message}`); }
    });
    const tail = buffer.subarray(completeBytes).toString('utf8');
    let needsTerminator = false;
    if (tail.trim()) {
      let row = null;
      try { row = JSON.parse(tail.trim()); } catch { row = null; }
      if (row) {
        rows.push(row);
        needsTerminator = true;
      } else {
        await fs.truncate(filePath, completeBytes);
        droppedPartialLine = { line: complete.length + 1, length: tail.length };
      }
    }
    return { rows, needsTerminator };
  }

  async function append(row) {
    const { needsTerminator } = await readRows(); // repair first, so this append starts a clean line
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (needsTerminator) await fs.appendFile(filePath, '\n', 'utf8');
    await fs.appendFile(filePath, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...row, updatedAt: new Date().toISOString() })}\n`, 'utf8');
  }

  // Fold the file into { sourceStableKey -> { title, resolved, targetPostId, media: Map } }.
  async function fold() {
    const { rows } = await readRows();
    const posts = new Map();
    for (const row of rows) {
      if (!row || typeof row.sourceStableKey !== 'string') continue;
      let post = posts.get(row.sourceStableKey);
      if (!post) {
        post = {
          sourceStableKey: row.sourceStableKey, title: null, resolved: false, targetPostId: null, media: new Map(),
          recoveryOwed: false, recoveryId: null, resolvedAt: null, resolvedRunId: null, recoveryLogged: false,
        };
        posts.set(row.sourceStableKey, post);
      }
      if (row.recoveryLogged === true) {
        if (post.resolved && row.recoveryId === post.recoveryId) post.recoveryLogged = true;
        continue;
      }
      if (post.resolved) continue; // closed: later media rows are ignored
      if (row.resolved === true) {
        post.resolved = true;
        post.targetPostId = row.targetPostId || null;
        post.recoveryOwed = row.recoveryOwed === true;
        post.recoveryId = row.recoveryId || null;
        post.resolvedAt = row.resolvedAt || null;
        post.resolvedRunId = row.resolvedRunId || null;
        continue;
      }
      if (typeof row.mediaKey !== 'string') continue;
      if (row.title) post.title = row.title;
      post.media.set(row.mediaKey, row);
    }
    return posts;
  }

  async function postRecord(postOrId) {
    return (await fold()).get(postStableKey(postOrId)) || null;
  }

  // Pay an owed recovery-log entry, idempotently: the entry is rebuilt from the `resolved` row,
  // so its recoveryId is stable and an entry already in the log is not appended again.
  async function settleRecoveryLog(record) {
    if (!record || !record.resolved || !record.recoveryOwed || record.recoveryLogged) return false;
    const api = recoveryApi();
    const existing = api.recoveryEntriesOf ? api.recoveryEntriesOf(await api.loadRecoveryLog(projectDir)) : await api.loadRecoveryLog(projectDir);
    if (!existing.some((entry) => entry && entry.recoveryId === record.recoveryId)) {
      await api.appendRecoveryLogEntry(projectDir, buildBlogMediaRecoveryEntry({
        runId: record.resolvedRunId,
        sourceStableKey: record.sourceStableKey,
        targetPostId: record.targetPostId,
        recoveryId: record.recoveryId,
        timestamp: record.resolvedAt,
      }));
    }
    await append({ sourceStableKey: record.sourceStableKey, recoveryLogged: true, recoveryId: record.recoveryId });
    return true;
  }

  async function close(postOrId, { targetPostId = null, runId = null, recoveryOwed = false } = {}) {
    const key = postStableKey(postOrId);
    let record = await postRecord(postOrId);
    if (!record) return { closed: false, recoveryLogged: false }; // no media: never had a record
    let closed = false;
    if (!record.resolved) {
      if (recoveryOwed && (typeof runId !== 'string' || runId === '')) {
        throw new Error(`blog-post-media: closing ${key} owes a recovery-log entry, so a runId is required`);
      }
      const resolvedAt = new Date().toISOString();
      const recoveryId = recoveryOwed
        ? `recovery-blog-media-${crypto.createHash('sha256').update(`${key}|${resolvedAt}`).digest('hex').slice(0, 12)}`
        : null;
      await append({
        sourceStableKey: key,
        resolved: true,
        targetPostId: targetPostId == null ? null : String(targetPostId),
        recoveryOwed: Boolean(recoveryOwed),
        recoveryId,
        resolvedAt,
        resolvedRunId: recoveryOwed ? runId : null,
      });
      closed = true;
      record = await postRecord(postOrId);
    }
    return { closed, recoveryLogged: await settleRecoveryLog(record) };
  }

  return {
    path: filePath,
    readRows,
    fold,
    postRecord,
    appendMedia: (row) => append(row),
    // After the post write and its crosswalk row. `resumed` is importAndConfirmPostMedia's flag:
    // a post that had been pending before this run owes a recovery-log entry, appended here.
    markResolved: (postOrId, { targetPostId = null, runId = null, resumed = false } = {}) =>
      close(postOrId, { targetPostId, runId, recoveryOwed: Boolean(resumed) }),
    // The crosswalk gate skipped this post: it is written, but an earlier run stopped before
    // closing its record or before paying its recovery-log entry. No media calls. An open record
    // closed here is a rerun resolving a pending post, so it owes the entry.
    closeIfCrosswalked: (postOrId, { targetPostId = null, runId = null } = {}) =>
      close(postOrId, { targetPostId, runId, recoveryOwed: true }),
    droppedPartialLine: () => droppedPartialLine,
  };
}

// --- import and confirm ------------------------------------------------------------------

function mediaRow(post, item, outcome, { fileId = null, reason = null, sizeInBytes = null } = {}) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`blog-post-media: unknown outcome ${outcome}`);
  return {
    sourceStableKey: postStableKey(post),
    title: postTitle(post),
    mediaKey: item.mediaKey,
    kind: item.kind,
    wpMediaId: item.wpMediaId,
    sourceUrl: item.sourceUrl,
    rewriteKeys: item.rewriteKeys,
    fileId: fileId == null ? null : String(fileId),
    ...(sizeInBytes == null ? {} : { sizeInBytes: String(sizeInBytes) }),
    outcome,
    reason: reason == null ? null : String(reason).slice(0, 300),
  };
}

function errorText(error) {
  if (!error) return 'unknown error';
  const status = error.status ? `${error.status} ` : '';
  return `${status}${error.message || String(error)}`;
}

// Import every distinct medium of one post, settle every file in parallel, record each step.
// Returns { allReady, heroImageId, inlineBySourceUrl, items, resumed }. `resumed` is true when the
// post already had an open record from an earlier run (the caller's recovery-log trigger).
//
// Options: `state` from createPendingBlogMediaState; `fetchFeaturedMedia(id)` returns the
// WordPress `wp/v2/media/{id}` record (or a URL string, or null); `settle` is passed to
// waitUntilFileReady as { tries, delayMs }; `displayName` is optional.
async function importAndConfirmPostMedia(wix, { post, richContent, state, fetchFeaturedMedia, settle } = {}) {
  if (!state) throw new Error('importAndConfirmPostMedia needs the pending-media state');
  if (typeof fetchFeaturedMedia !== 'function') throw new Error('importAndConfirmPostMedia needs fetchFeaturedMedia(id)');
  const record = await state.postRecord(post);
  if (record && record.resolved) {
    // Closed as written to `targetPostId`, yet the caller's crosswalk gate let it through. That is
    // an inconsistency between two state files, not a media failure; guessing would either
    // duplicate the post or write it without media. Stop and let the operator decide.
    throw Object.assign(
      new Error(`${postStableKey(post)} is recorded as written (Wix post ${record.targetPostId}) but is not in the crosswalk; repair the crosswalk before importing it again`),
      { code: 'BLOG_MEDIA_STATE_INCONSISTENT' },
    );
  }
  const prior = record ? record.media : new Map();
  const items = collectPostMedia({ post, richContent });
  const toSettle = [];

  for (const item of items) {
    const last = prior.get(item.mediaKey);
    if (last && last.fileId && RESUMABLE.has(last.outcome)) {
      if (item.kind === 'featured' && last.sourceUrl) item.sourceUrl = last.sourceUrl;
      item.fileId = last.fileId;
      if (last.outcome === 'ready' && (item.kind !== 'featured' || Number(last.sizeInBytes) > 0)) {
        item.outcome = 'ready'; continue;
      }
      toSettle.push(item);
      continue;
    }
    if (item.unresolvable) {
      item.outcome = 'unresolvable-url';
      item.reason = post && post.link ? 'not an http(s) URL' : 'relative URL and the post has no link to resolve it against';
      await state.appendMedia(mediaRow(post, item, item.outcome, { reason: item.reason }));
      continue;
    }
    if (item.kind === 'featured') {
      let resolved = null;
      try {
        const got = await fetchFeaturedMedia(item.wpMediaId);
        resolved = typeof got === 'string' ? got : (got ? resolveImageUrl(got) : null);
        if (!resolved) item.reason = 'WordPress media record has no usable image URL';
      } catch (error) {
        item.reason = `fetching WordPress media ${item.wpMediaId} failed: ${errorText(error)}`;
      }
      const absolute = resolved ? resolveImportUrl(resolved, post && post.link) : null;
      if (!absolute) {
        item.outcome = 'fetch-failed';
        if (resolved) item.reason = 'WordPress media URL is not an http(s) URL';
        await state.appendMedia(mediaRow(post, item, item.outcome, { reason: item.reason }));
        continue;
      }
      item.sourceUrl = absolute;
    }
    let file;
    try {
      file = await writers.importMedia(wix, {
        sourceUrl: item.sourceUrl,
        displayName: displayNameFor(item.sourceUrl),
        mediaType: 'IMAGE',
        wpId: item.wpMediaId != null ? item.wpMediaId : undefined,
      });
    } catch (error) {
      item.outcome = 'import-rejected';
      item.reason = errorText(error);
      await state.appendMedia(mediaRow(post, item, item.outcome, { reason: item.reason }));
      continue;
    }
    if (!file || !file.id) {
      item.outcome = 'import-rejected';
      item.reason = 'import response carried no file id';
      await state.appendMedia(mediaRow(post, item, item.outcome, { reason: item.reason }));
      continue;
    }
    item.fileId = String(file.id);
    // Checkpoint BEFORE polling: a crash from here on resumes this id instead of importing again.
    await state.appendMedia(mediaRow(post, item, 'imported', { fileId: item.fileId }));
    toSettle.push(item);
  }

  const settled = await Promise.all(toSettle.map(async (item) => {
    try {
      const ready = await writers.waitUntilFileReady(wix, item.fileId, settle || {});
      if (ready && (item.kind !== 'featured' || Number(ready.sizeInBytes) > 0))
        return { item, outcome: 'ready', sizeInBytes: ready.sizeInBytes };
      if (ready && item.kind === 'featured')
        return { item, outcome: 'not-ready', reason: 'cover is READY but has no non-zero sizeInBytes' };
      return { item, outcome: 'not-ready', reason: 'still PENDING when the settle window ended' };
    } catch (error) {
      if (error && error.code === 'MEDIA_IMPORT_FAILED') return { item, outcome: 'failed', reason: 'Wix reported the import FAILED' };
      return { item, outcome: 'status-unknown', reason: `reading the file status failed: ${errorText(error)}` };
    }
  }));
  for (const { item, outcome, reason, sizeInBytes } of settled) {
    item.outcome = outcome;
    item.reason = reason || null;
    if (outcome === 'failed') item.fileId = null; // a FAILED file is imported afresh next time
    await state.appendMedia(mediaRow(post, item, outcome,
      { fileId: item.fileId, reason: item.reason, sizeInBytes }));
  }

  const allReady = items.every((item) => item.outcome === 'ready');
  const featured = items.find((item) => item.kind === 'featured');
  const inlineBySourceUrl = new Map();
  for (const item of items) {
    if (item.kind === 'inline' && item.outcome === 'ready') {
      for (const key of item.rewriteKeys) inlineBySourceUrl.set(key, item.fileId);
    }
  }
  return {
    allReady,
    heroImageId: featured && featured.outcome === 'ready' ? featured.fileId : null,
    inlineBySourceUrl,
    items: items.map(({ unresolvable, ...rest }) => ({ ...rest, fileId: rest.fileId || null, reason: rest.reason || null })),
    resumed: Boolean(record),
  };
}

function displayNameFor(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

// Rewrite the inline images of the SAME converted document. Only for an allReady result: a
// partial rewrite is the unapproved fallback.
function applyPostMedia(richContent, result) {
  if (!result || !result.allReady) throw new Error('applyPostMedia: only an allReady media result may be applied to a post');
  return writers.rewriteInlineMedia(richContent, result.inlineBySourceUrl);
}

// Crosswalk hits must still enter the build runner for legacy reconciliation, but
// must not re-import media or close pending state before Wix identity is checked.
// Prefer the existing media ledger; a pre-ledger import supplies its local media
// crosswalk through resolveFromCrosswalk without making a new Wix media write.
async function existingPostMedia({ post, richContent, state, resolveFromCrosswalk } = {}) {
  if (!state) throw new Error('existingPostMedia needs pending-media state');
  const needed = collectPostMedia({ post, richContent });
  if (!needed.length) return { allReady: true, heroImageId: null,
    inlineBySourceUrl: new Map(), resumed: false, items: [] };
  const record = await state.postRecord(post);
  const local = record?.media;
  const resolved = [];
  for (const item of needed) {
    let row = local?.get(item.mediaKey);
    if ((!row || row.outcome !== 'ready' || !row.fileId ||
      item.kind === 'featured' && !(Number(row.sizeInBytes) > 0)) &&
      typeof resolveFromCrosswalk === 'function') row = await resolveFromCrosswalk(post, item);
    if (!row || row.outcome !== 'ready' || !row.fileId ||
      item.kind === 'featured' && !(Number(row.sizeInBytes) > 0)) {
      throw Object.assign(
        new Error(`blog legacy crosswalk ${postStableKey(post)} lacks confirmed READY media ${item.mediaKey}`),
        { code: 'BLOG_LEGACY_MEDIA_UNRESOLVED' });
    }
    resolved.push({ ...item, fileId: String(row.fileId), outcome: 'ready' });
  }
  const inlineBySourceUrl = new Map();
  for (const item of resolved.filter(value => value.kind === 'inline'))
    for (const key of item.rewriteKeys) inlineBySourceUrl.set(key, item.fileId);
  return { allReady: true,
    heroImageId: resolved.find(item => item.kind === 'featured')?.fileId || null,
    inlineBySourceUrl, resumed: Boolean(record && !record.resolved), items: resolved };
}

// --- report ------------------------------------------------------------------------------

function isCrosswalked(crosswalk, key) {
  if (!crosswalk) return false;
  if (typeof crosswalk === 'function') return Boolean(crosswalk(key));
  if (typeof crosswalk.has === 'function') return crosswalk.has(key);
  return false;
}

// Derived from the state file, never kept as a separate list. A post is pending when its record
// is open and it is not in the crosswalk — including when every medium is already READY but the
// post write was never recorded (`awaitingWrite`: a run stopped between the last READY row and
// the crosswalk row). `recoveryLogOwed` lists written posts whose recovery-log entry is not yet
// confirmed; the next run's crosswalk gate pays it. `crosswalk` is a Set/Map of sourceStableKeys
// or a function(sourceStableKey) -> truthy.
async function summarizePendingBlogMedia({ state, crosswalk } = {}) {
  if (!state) throw new Error('summarizePendingBlogMedia needs the pending-media state');
  const pending = [];
  const recoveryLogOwed = [];
  for (const post of (await state.fold()).values()) {
    if (post.resolved) {
      if (post.recoveryOwed && !post.recoveryLogged) recoveryLogOwed.push({ sourceStableKey: post.sourceStableKey, targetPostId: post.targetPostId, recoveryId: post.recoveryId });
      continue;
    }
    if (isCrosswalked(crosswalk, post.sourceStableKey)) continue;
    const media = [...post.media.values()]
      .filter((row) => row.outcome !== 'ready')
      .map((row) => ({ mediaKey: row.mediaKey, kind: row.kind, outcome: row.outcome, reason: row.reason || null, wpMediaId: row.wpMediaId || null, sourceUrl: row.sourceUrl || null, fileId: row.fileId || null }));
    const awaitingWrite = media.length === 0;
    pending.push({
      sourceStableKey: post.sourceStableKey,
      title: post.title,
      awaitingWrite,
      reason: awaitingWrite ? 'every medium is READY; the post write was not recorded — the next run writes it' : null,
      media,
    });
  }
  return { pendingMedia: pending.length, pending, recoveryLogOwed, statePath: 'state/crosswalk/pending-blog-media.ndjson' };
}

// The standard recovery-log entry for a post a rerun resolved after it had been pending. The
// state's markResolved / closeIfCrosswalked append it; callers do not.
function buildBlogMediaRecoveryEntry({ runId, post, sourceStableKey, targetPostId, recoveryId, timestamp, crosswalkChanges = { added: 1, updated: 0 } }) {
  const key = sourceStableKey || postStableKey(post);
  return {
    ...(recoveryId ? { recoveryId } : {}),
    ...(timestamp ? { timestamp } : {}),
    runId,
    mode: 'resumed',
    status: 'complete',
    reason: 'blog_post_media_resolved',
    selectionFilters: { entity: 'blog-post', sourceStableKey: key },
    recordsSelected: 1,
    recordsAttempted: 1,
    imported: 1,
    alreadyPresent: 0,
    failed: 0,
    deferred: 0,
    unresolved: 0,
    crosswalkChanges,
    summaryChanges: { blogPostsPendingMedia: -1, blogPostsImported: 1 },
    outcome: `blog post ${key} resolved as Wix post ${targetPostId} after its media reached READY`,
    logs: ['state/crosswalk/pending-blog-media.ndjson'],
  };
}

module.exports = {
  SCHEMA_VERSION,
  STATE_FILE,
  OUTCOMES,
  postStableKey,
  collectPostMedia,
  resolveImportUrl,
  createPendingBlogMediaState,
  importAndConfirmPostMedia,
  applyPostMedia,
  existingPostMedia,
  summarizePendingBlogMedia,
  buildBlogMediaRecoveryEntry,
};
