'use strict';

// Durable state for the ordered blog importer. The ledger is the authority; reports and
// in-memory maps are projections and can be discarded after any operation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEDGER = 'blog-post-build.ndjson';
const LOCK = 'blog-post-build.lock';
const SNAPSHOT_DIR = 'blog-containment';
const PHASES = new Set([
  'media-pending', 'creating', 'drafted', 'slug-set', 'links-final', 'held',
  'snapshot-saved', 'publishing', 'published', 'adopted-published', 'verified',
  'verify-failed', 'containing', 'contain-deleted', 'contain-recreating',
  'contain-drafted', 'contain-linked', 'contained', 'contain-failed',
]);
const CONTAINMENT = new Set([
  'containing', 'contain-deleted', 'contain-recreating', 'contain-drafted',
  'contain-linked', 'contained', 'contain-failed',
]);
const DUPLICATE_EVENTS = new Set([
  'detected', 'provenance', 'ownership-confirmed', 'delete-chosen',
  'removed', 'kept', 'not-importer', 'unresolved',
]);
const SNAPSHOT_KINDS = new Set(['link-set', 'leftover-set', 'dates', 'verify']);
const DESIRED_EVENTS = new Set(['captured', 'update-intent', 'update-applied']);
const CLOSED_DUPLICATES = new Set(['removed', 'kept', 'not-importer']);
const ROW_CACHE = new Map();
const SNAPSHOT_METRICS = new Map();
const RUN_IDS = new Map();

function stateDir(projectDir) {
  if (!projectDir) throw new Error('blog build needs projectDir');
  return path.join(projectDir, 'state', 'crosswalk');
}
function ledgerPath(projectDir) { return path.join(stateDir(projectDir), LEDGER); }
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function normalizeRich(value, isNode = false) {
  if (Array.isArray(value)) return value.map(item => normalizeRich(item, false));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(isNode && key === 'id') &&
      !['createdDate', 'updatedDate', 'editedDate', 'metadata', 'documentStyle'].includes(key))
    .map(([key, item]) => [key, key === 'nodes' && Array.isArray(item)
      ? item.map(node => normalizeRich(node, true)) : normalizeRich(item, false)]));
}
function normalizeSeoData(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...value };
  if (Array.isArray(copy.tags) && copy.tags.length === 0) delete copy.tags;
  return Object.keys(copy).length ? copy : undefined;
}
function normalizeMedia(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = structuredClone(value);
  for (const image of [copy.wixMedia?.image, copy.heroImage]) {
    if (!image || typeof image !== 'object') continue;
    for (const field of ['url', 'width', 'height', 'filename']) delete image[field];
  }
  return copy;
}
function bodyProjection(post) {
  const src = post && (post.draftPost || post.post || post);
  if (!src || typeof src !== 'object') throw new Error('blog body must be an object');
  return {
    title: src.title,
    richContent: normalizeRich(src.richContent),
    media: normalizeMedia(src.media),
    heroImage: normalizeMedia({ heroImage: src.heroImage }).heroImage,
    memberId: src.memberId,
    firstPublishedDate: src.firstPublishedDate,
    excerpt: src.excerpt,
    categoryIds: [...(src.categoryIds || [])].sort(),
    tagIds: [...(src.tagIds || [])].sort(),
    seoData: normalizeSeoData(src.seoData),
  };
}
function bodySha(post) { return sha(bodyProjection(post)); }
function fingerprint(post) {
  const src = post && (post.draftPost || post.post || post);
  return sha({ title: src.title, firstPublishedDate: src.firstPublishedDate,
    memberId: src.memberId, excerpt: src.excerpt,
    coverId: src.media?.wixMedia?.image?.id || src.heroImage?.id || '' });
}
function validateDesiredPost(post) {
  const missing = [];
  for (const field of ['title', 'memberId', 'richContent']) {
    if (post?.[field] === undefined || post?.[field] === null || post[field] === '') missing.push(field);
  }
  if (!post?.richContent || !Array.isArray(post.richContent.nodes)) missing.push('richContent.nodes');
  if (missing.length) throw new Error(`desired-post-invalid: missing ${missing.join(', ')}`);
  return post;
}
function fromDraftResponse(response) {
  const draft = response?.draftPost || response;
  if (!draft || typeof draft !== 'object') throw new Error('draft response is missing');
  const fields = ['title', 'richContent', 'media', 'memberId', 'firstPublishedDate',
    'excerpt', 'categoryIds', 'tagIds', 'seoData', 'heroImage'];
  const post = Object.fromEntries(fields.filter(key => Object.hasOwn(draft, key)).map(key => [key, draft[key]]));
  if (draft.slug) post.seoSlug = draft.slug;
  return validateDesiredPost(post);
}
function readRows(projectDir) {
  const file = ledgerPath(projectDir);
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file, { bigint: true });
  const cached = ROW_CACHE.get(file);
  if (cached && cached.size === stat.size && cached.mtimeNs === stat.mtimeNs) return cached.rows;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const rows = [];
  const complete = content.endsWith('\n') ? lines.length - 1 : lines.length;
  for (let i = 0; i < complete; i += 1) {
    if (!lines[i]) throw new Error(`blog ledger line ${i + 1}: empty line`);
    let row;
    try { row = JSON.parse(lines[i]); }
    catch (error) {
      if (i === complete - 1 && !content.endsWith('\n')) break;
      throw new Error(`blog ledger line ${i + 1}: invalid JSON: ${error.message}`);
    }
    if (row.seq !== rows.length + 1) throw new Error(`blog ledger line ${i + 1}: expected seq ${rows.length + 1}, got ${row.seq}`);
    validateRow(row);
    rows.push(row);
  }
  ROW_CACHE.set(file, { size: stat.size, mtimeNs: stat.mtimeNs, rows });
  return rows;
}
function validateRow(row) {
  if (!row.sourceStableKey && row.kind !== 'spot-check') throw new Error(`blog ledger seq ${row.seq}: sourceStableKey missing`);
  if (row.kind === 'phase') {
    if (!PHASES.has(row.phase)) throw new Error(`blog ledger seq ${row.seq}: unknown phase`);
    if (['held', 'contain-failed'].includes(row.phase) && !row.reason) throw new Error(`blog ledger seq ${row.seq}: reason missing`);
    if (row.phase === 'verified' && !['read', 'reverify', 'accepted'].includes(row.via)) throw new Error(`blog ledger seq ${row.seq}: verified via missing`);
  } else if (row.kind === 'desired-state') {
    if (!DESIRED_EVENTS.has(row.event) || !row.snapshotSha || !row.generation) throw new Error(`blog ledger seq ${row.seq}: invalid desired state`);
  } else if (row.kind === 'duplicate') {
    if (!DUPLICATE_EVENTS.has(row.event) || !row.extraDraftId || !row.recordedDraftId) throw new Error(`blog ledger seq ${row.seq}: invalid duplicate`);
  } else if (SNAPSHOT_KINDS.has(row.kind)) {
    if (!Array.isArray(row.findings) || row.findings.some(f => !f.findingKey)) throw new Error(`blog ledger seq ${row.seq}: invalid findings`);
  } else if (row.kind === 'accepted') {
    if (!row.snapshotKind || !row.findingKey || !row.snapshotSeq || !row.acceptedBy) throw new Error(`blog ledger seq ${row.seq}: invalid acceptance`);
  } else if (row.kind === 'spot-check') {
    if (!row.coverageVersion || !Array.isArray(row.posts) || !row.checkedBy || !row.recordedBy) throw new Error(`blog ledger seq ${row.seq}: invalid spot-check`);
  } else throw new Error(`blog ledger seq ${row.seq}: unknown kind ${row.kind}`);
}
function appendRow(projectDir, row) {
  const dir = stateDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const rows = readRows(projectDir);
  const content = fs.existsSync(ledgerPath(projectDir)) ? fs.readFileSync(ledgerPath(projectDir), 'utf8') : '';
  if (content && !content.endsWith('\n')) {
    const tail = content.slice(content.lastIndexOf('\n') + 1);
    let valid = false;
    try { JSON.parse(tail); valid = true; } catch { /* torn tail already ignored by readRows */ }
    if (valid) fs.appendFileSync(ledgerPath(projectDir), '\n');
    else fs.truncateSync(ledgerPath(projectDir), Buffer.byteLength(content.slice(0, content.lastIndexOf('\n') + 1)));
  }
  const runId = row.runId || RUN_IDS.get(projectDir);
  const next = { ...row, ...(runId ? { runId } : {}), seq: rows.length + 1,
    ts: row.ts || new Date().toISOString() };
  validateRow(next);
  const fd = fs.openSync(ledgerPath(projectDir), 'a');
  try { fs.writeSync(fd, `${JSON.stringify(next)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  const stat = fs.statSync(ledgerPath(projectDir), { bigint: true });
  ROW_CACHE.set(ledgerPath(projectDir), { size: stat.size, mtimeNs: stat.mtimeNs,
    rows: [...rows, next] });
  return next;
}
function withLock(projectDir, run) {
  const dir = stateDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, LOCK);
  let fd;
  try { fd = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`blog build lock exists at ${lock}; Import Operator must inspect it`);
    throw error;
  }
  fs.writeSync(fd, `${process.pid}\n`); fs.fsyncSync(fd);
  const release = () => { fs.closeSync(fd); fs.unlinkSync(lock); };
  try {
    const result = run();
    if (result && typeof result.then === 'function') return result.finally(release);
    release();
    return result;
  } catch (error) { release(); throw error; }
}
function setRunId(projectDir, runId) {
  if (runId) RUN_IDS.set(projectDir, runId);
  else RUN_IDS.delete(projectDir);
}
function saveGeneration(projectDir, sourceStableKey, desiredPost, origin, extra = {}) {
  const started = process.hrtime.bigint();
  validateDesiredPost(desiredPost);
  if (!['run', 'held-draft', 'source'].includes(origin)) throw new Error('invalid blog snapshot origin');
  const payload = { schema: 3, sourceStableKey, draftId: extra.draftId || null,
    fingerprint: fingerprint(desiredPost), desiredPost, ownerState: extra.ownerState || null,
    finalSlug: extra.finalSlug || null, snapshotOrigin: origin,
    savedAt: new Date().toISOString() };
  const bytes = canonical(payload);
  const digest = sha(bytes);
  const dir = path.join(stateDir(projectDir), SNAPSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const safeKey = encodeURIComponent(sourceStableKey).replace(/%/g, '_');
  const file = path.join(dir, `${safeKey}.${digest}.snapshot.json`);
  if (!fs.existsSync(file)) {
    const temp = path.join(dir, `.${digest}.${process.pid}.tmp`);
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const metricsKey = `${projectDir}\u0000${sourceStableKey}`;
  const previous = SNAPSHOT_METRICS.get(metricsKey) || { bytes: 0, ms: 0, generations: 0 };
  SNAPSHOT_METRICS.set(metricsKey, { bytes: previous.bytes + Buffer.byteLength(bytes),
    ms: previous.ms + elapsedMs, generations: previous.generations + 1 });
  return { generation: digest, snapshotSha: digest, sourceStableKey };
}
function snapshotMetrics(projectDir, sourceStableKey) {
  return SNAPSHOT_METRICS.get(`${projectDir}\u0000${sourceStableKey}`) ||
    { bytes: 0, ms: 0, generations: 0 };
}
function resetSnapshotMetrics(projectDir) {
  for (const key of SNAPSHOT_METRICS.keys()) if (key.startsWith(`${projectDir}\u0000`)) SNAPSHOT_METRICS.delete(key);
}
function loadGeneration(projectDir, digest, sourceStableKey) {
  const dir = path.join(stateDir(projectDir), SNAPSHOT_DIR);
  const suffix = `.${digest}.snapshot.json`;
  const names = fs.readdirSync(dir).filter(name => name.endsWith(suffix));
  if (names.length !== 1) throw new Error(`blog snapshot ${digest}: expected one referenced generation, found ${names.length}`);
  const file = path.join(dir, names[0]);
  const data = fs.readFileSync(file, 'utf8');
  if (sha(data) !== digest) throw new Error(`blog snapshot hash mismatch: ${digest}`);
  const result = JSON.parse(data);
  if (sourceStableKey && result.sourceStableKey !== sourceStableKey) throw new Error(`blog snapshot source mismatch: ${digest}`);
  return result;
}
function savePublishedEvidence(projectDir, sourceStableKey, published) {
  const dir = path.join(stateDir(projectDir), SNAPSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const safeKey = encodeURIComponent(sourceStableKey).replace(/%/g, '_');
  const file = path.join(dir, `${safeKey}.published.json`);
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try { fs.writeSync(fd, `${JSON.stringify(published, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dirFd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  return path.relative(projectDir, file);
}
function fold(rows) {
  const posts = new Map();
  const duplicates = new Map();
  let spotCheck = null;
  for (const row of rows) {
    if (row.kind === 'spot-check') { spotCheck = row; continue; }
    const key = row.sourceStableKey;
    if (!posts.has(key)) posts.set(key, { sourceStableKey: key, phase: null, containmentOpen: false,
      desired: null, pendingIntent: null, snapshots: {}, accepted: new Map(), rows: [] });
    const post = posts.get(key);
    post.rows.push(row);
    if (row.kind === 'phase') {
      post.phase = row;
      if (row.phase === 'containing') post.containmentOpen = true;
      else if (row.phase === 'contained') post.containmentOpen = false;
    } else if (row.kind === 'desired-state') {
      if (row.event === 'captured' || row.event === 'update-applied') { post.desired = row; post.pendingIntent = null; }
      else post.pendingIntent = row;
    } else if (row.kind === 'duplicate') {
      const pair = `${key}\u0000${row.extraDraftId}`;
      if (!duplicates.has(pair)) duplicates.set(pair, { sourceStableKey: key, extraDraftId: row.extraDraftId,
        recordedDraftId: row.recordedDraftId, evidence: null, confirmation: null, choice: null });
      const item = duplicates.get(pair);
      item.last = row;
      if (['provenance', 'unresolved'].includes(row.event)) { item.evidence = row.evidence; item.confirmation = null; item.choice = null; }
      if (row.event === 'ownership-confirmed') item.confirmation = row;
      if (row.event === 'delete-chosen') item.choice = row;
      item.closed = CLOSED_DUPLICATES.has(row.event);
    } else if (SNAPSHOT_KINDS.has(row.kind)) post.snapshots[row.kind] = row;
    else if (row.kind === 'accepted') post.accepted.set(`${row.snapshotKind}\u0000${row.findingKey}`, row);
  }
  for (const post of posts.values()) {
    post.openFindings = Object.fromEntries(Object.entries(post.snapshots).map(([kind, snap]) =>
      [kind, snap.findings.filter(f => !post.accepted.has(`${kind}\u0000${f.findingKey}`))]));
  }
  return { posts, duplicates, spotCheck };
}

module.exports = {
  LEDGER, PHASES, CONTAINMENT, SNAPSHOT_KINDS, stateDir, ledgerPath, sha, canonical,
  bodyProjection, bodySha, fingerprint, validateDesiredPost, fromDraftResponse,
  readRows, appendRow, withLock, saveGeneration, loadGeneration, savePublishedEvidence, fold,
  snapshotMetrics, resetSnapshotMetrics,
  setRunId,
};
