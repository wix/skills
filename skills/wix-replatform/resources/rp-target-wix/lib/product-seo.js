'use strict';

// Product SEO: plan from per-field source evidence, owner dispositions, guarded
// product writes, and per-field verification that allows for inheritance.
//
// Inputs are the canonical `product.seoEvidence` produced by the source adapter (for Yoast:
// rp-source-wordpress/lib/yoast-product-seo-evidence.js `seoEvidenceFromReceipt`):
//   { title|description|focusKeyword: { state: 'override'|'inherit'|'unknown', value? },
//     rendered: { title, description },   // sanitized rendered text, used ONLY for `materialize`
//     canonical: 'none'|'self'|'pending_policy' }
//
// Product SEO is written ONLY through Catalog V3 `product.seoData` (create, or a
// revision-protected PATCH). Never through the generic Item SEO bulk writer: on 2026-08-27 that
// call reported per-entry success for STORES_PRODUCT and persisted nothing. A success response
// is never proof; only the read-backs below are.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const conflicts = require('../../../lib/rerun-conflicts');
const { SEO_OUTCOMES, SEO_ACCEPTED_OUTCOMES } = require('../../../lib/seo-outcome-registry');

const TAG_FIELDS = Object.freeze(['title', 'description']);
const SEO_FIELDS = Object.freeze(['title', 'description', 'focusKeyword']);
const SEO_VALUES = Object.freeze(['acquire-evidence', 'omit', 'materialize']);
const FOCUS_VALUES = Object.freeze(['acquire-evidence', 'omit']);
const DISPOSITION_PREFIX = 'productSeoDisposition:';
const FOCUS_PREFIX = 'productSeoDisposition:focusKeywords:';
const INHERIT_SOURCES = Object.freeze(['TAG_SOURCE_DEFAULT_PATTERN', 'TAG_SOURCE_USER_PATTERN', 'TAG_SOURCE_SITE']);
const RESOLUTION_DELAYS_MS = Object.freeze([1000, 2000, 4000, 8000, 16000]);
const STORES_PRODUCT_ITEM_TYPE = 'STORES_PRODUCT';
// Products in flight in the SEO stage; matches the Stores write-pool guidance.
const SEO_STAGE_CONCURRENCY = 3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// --- evidence projection and hashing --------------------------------------------------
function fieldProjection(field) {
  if (!field || !['override', 'inherit', 'unknown'].includes(field.state)) return { state: 'unknown' };
  if (field.state === 'override') {
    if (typeof field.value !== 'string' || field.value.trim() === '') return { state: 'unknown' };
    return { state: 'override', value: field.value };
  }
  return { state: field.state };
}
function fieldEvidenceHash(field) {
  return sha256(canonicalJson(fieldProjection(field)));
}

// --- dispositions ---------------------------------------------------------------------
function normalizePairs(pairs) {
  return pairs.map((p) => ({ productId: String(p.productId), field: p.field }))
    .sort((a, b) => (a.productId === b.productId ? a.field.localeCompare(b.field) : a.productId.localeCompare(b.productId)));
}
function scopeIdFor(pairs) {
  return sha256(canonicalJson(normalizePairs(pairs))).slice(0, 16);
}
function dispositionKey(scopeId, { focusKeywords = false } = {}) {
  return `${focusKeywords ? FOCUS_PREFIX : DISPOSITION_PREFIX}${scopeId}`;
}

// Fail closed: anything malformed applies to nothing.
function validateDispositionEntry(key, entry) {
  const focus = key.startsWith(FOCUS_PREFIX);
  const scopeId = key.slice(focus ? FOCUS_PREFIX.length : DISPOSITION_PREFIX.length);
  if (!/^[0-9a-f]{16}$/.test(scopeId)) return { ok: false, reason: 'malformed-scope-id' };
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, reason: 'not-an-object' };
  if (entry.source !== 'user') return { ok: false, reason: 'not-a-user-decision' };
  if (!(focus ? FOCUS_VALUES : SEO_VALUES).includes(entry.value)) return { ok: false, reason: 'unknown-value' };
  if (typeof entry.decidedAt !== 'string' || Number.isNaN(Date.parse(entry.decidedAt))) return { ok: false, reason: 'missing-decidedAt' };
  const allowedFields = focus ? ['focusKeyword'] : TAG_FIELDS;
  if (!Array.isArray(entry.items) || !entry.items.length) return { ok: false, reason: 'no-items' };
  const seen = new Set();
  for (const item of entry.items) {
    if (!item || typeof item !== 'object' || item.productId == null || String(item.productId) === ''
      || !allowedFields.includes(item.field) || typeof item.evidenceHash !== 'string' || !/^[0-9a-f]{64}$/.test(item.evidenceHash)) {
      return { ok: false, reason: 'malformed-item' };
    }
    const pairKey = `${item.productId}\u0000${item.field}`;
    if (seen.has(pairKey)) return { ok: false, reason: 'duplicate-item' };
    seen.add(pairKey);
  }
  if (scopeIdFor(entry.items) !== scopeId) return { ok: false, reason: 'scope-id-mismatch' };
  return { ok: true, scopeId, focus, value: entry.value, items: entry.items };
}

// Which recorded owner disposition applies to each field of one product. A pair matches only
// when it is listed and its evidenceHash equals the field's CURRENT projection hash; a new
// product, a newly affected field or changed evidence is asked again.
function matchDispositions(decisions, productId, seoEvidence) {
  const id = String(productId);
  const matched = { title: null, description: null, focusKeyword: null };
  const ambiguous = new Set();
  const ignored = [];
  for (const key of Object.keys(decisions || {}).sort()) {
    if (!key.startsWith(DISPOSITION_PREFIX)) continue;
    const check = validateDispositionEntry(key, decisions[key]);
    if (!check.ok) { ignored.push({ key, reason: check.reason }); continue; }
    for (const item of check.items) {
      if (String(item.productId) !== id) continue;
      if (item.evidenceHash !== fieldEvidenceHash(seoEvidence && seoEvidence[item.field])) {
        ignored.push({ key, field: item.field, reason: 'evidence-changed' });
        continue;
      }
      const candidate = { scopeId: check.scopeId, value: check.value, key };
      const prior = matched[item.field];
      if (prior && (prior.scopeId !== candidate.scopeId || prior.value !== candidate.value)) ambiguous.add(item.field);
      else matched[item.field] = candidate;
    }
  }
  for (const field of ambiguous) { matched[field] = null; ignored.push({ field, reason: 'conflicting-dispositions' }); }
  return { matched, ignored };
}

// --- plan -----------------------------------------------------------------------------------
function tagFor(field, value) {
  return field === 'title'
    ? { type: 'title', children: value }
    : { type: 'meta', props: { name: 'description', content: value } };
}
function importOwnedIdentity(tag) {
  if (!tag || typeof tag !== 'object') return null;
  if (tag.type === 'title') return 'title';
  if (tag.type === 'meta' && tag.props && String(tag.props.name || '').toLowerCase() === 'description') return 'description';
  return null;
}
function tagValue(tag) {
  if (!tag) return undefined;
  return tag.type === 'title' ? tag.children : tag.props && tag.props.content;
}

// Per field:
//   write   -- a proven override, or the owner's `materialize` of an unknown field; verified.
//   inherit -- proven "no override"; no tag; verified to inherit.
//   omit    -- the owner accepted the loss of an unknown field; nothing written.
//   held    -- unknown evidence with rendered SEO and no applicable disposition.
//   none    -- unknown evidence but the source renders nothing for the field: nothing to hold.
function planProductSeo({ productId, seoEvidence, decisions = {} } = {}) {
  if (productId == null || String(productId) === '') throw new Error('planProductSeo: productId is required');
  if (!seoEvidence || typeof seoEvidence !== 'object') throw new Error('planProductSeo: seoEvidence is required');
  const id = String(productId);
  const { matched, ignored } = matchDispositions(decisions, id, seoEvidence);
  const fields = {};
  const residuals = [];
  const heldPairs = [];
  const projection = {};
  for (const field of TAG_FIELDS) {
    const f = fieldProjection(seoEvidence[field]);
    const disposition = matched[field];
    projection[field] = { ...f, ...(disposition ? { disposition: { scopeId: disposition.scopeId, value: disposition.value } } : {}) };
    if (f.state === 'override') { fields[field] = { action: 'write', value: f.value, verify: 'override' }; continue; }
    if (f.state === 'inherit') { fields[field] = { action: 'inherit', verify: 'inherit' }; continue; }
    const rendered = seoEvidence.rendered && typeof seoEvidence.rendered[field] === 'string' && seoEvidence.rendered[field].trim() !== ''
      ? seoEvidence.rendered[field].trim() : null;
    if (!rendered) { fields[field] = { action: 'none' }; continue; }
    if (disposition && disposition.value === 'omit') {
      fields[field] = { action: 'omit', disposition };
      residuals.push({ outcome: 'seo_disposition_accepted_gap', field });
    } else if (disposition && disposition.value === 'materialize') {
      // The value that will be written is part of the projection, so a changed rendered value
      // under a standing materialize choice is reconciled on the next rerun.
      projection[field].materializedValue = rendered;
      fields[field] = { action: 'write', value: rendered, verify: 'override', materialized: true, disposition };
      residuals.push({ outcome: 'seo_materialized', field });
    } else {
      fields[field] = { action: 'held', disposition: disposition || null };
      residuals.push({ outcome: 'seo_disposition_required', field });
      heldPairs.push({ productId: id, field, evidenceHash: fieldEvidenceHash(seoEvidence[field]) });
    }
  }
  const focus = fieldProjection(seoEvidence.focusKeyword);
  const focusDisposition = matched.focusKeyword;
  projection.focusKeyword = { ...focus, ...(focusDisposition ? { disposition: { scopeId: focusDisposition.scopeId, value: focusDisposition.value } } : {}) };
  if (focus.state === 'override') {
    // No verified product write path exists for focus keyphrases; the owner may accept the loss.
    if (focusDisposition && focusDisposition.value === 'omit') {
      fields.focusKeyword = { action: 'omit', disposition: focusDisposition };
      residuals.push({ outcome: 'focus_keywords_accepted_gap', field: 'focusKeyword' });
    } else {
      fields.focusKeyword = { action: 'held', disposition: focusDisposition || null };
      residuals.push({ outcome: 'focus_keywords_disposition_required', field: 'focusKeyword' });
      heldPairs.push({ productId: id, field: 'focusKeyword', evidenceHash: fieldEvidenceHash(seoEvidence.focusKeyword) });
    }
  } else {
    fields.focusKeyword = { action: 'none' };
  }
  if (seoEvidence.canonical === 'pending_policy') residuals.push({ outcome: 'canonical_pending_policy', field: 'canonical' });
  const tags = TAG_FIELDS.filter((field) => fields[field].action === 'write').map((field) => tagFor(field, fields[field].value));
  return {
    productId: id,
    fields,
    tags,
    residuals,
    heldPairs,
    ignoredDispositions: ignored,
    projection,
    projectionHash: sha256(canonicalJson(projection)),
  };
}

// The only SEO input to a product's sourceHash: per-field {state, value}, plus the
// applied disposition's {scopeId, value}. No capture time, channel or read metadata.
function seoHashProjection(input) {
  return planProductSeo(input).projection;
}
function seoProjectionHash(input) {
  return planProductSeo(input).projectionHash;
}

// `seoData` for a CREATE body. Omitted entirely when nothing is written, so a both-inherit
// product sends no seoData.
function seoDataForCreate(plan) {
  return plan && plan.tags.length ? { tags: plan.tags.map((tag) => JSON.parse(JSON.stringify(tag))) } : null;
}

// --- owner question ------------------------------------------------------------
// One batched question per kind. Never answered by the runtime, in any automation mode.
function buildSeoDispositionQuestions(plans) {
  const seoItems = [];
  const focusItems = [];
  for (const plan of plans || []) {
    for (const pair of plan.heldPairs || []) (pair.field === 'focusKeyword' ? focusItems : seoItems).push(pair);
  }
  const questions = [];
  const question = (items, focus) => {
    const scopeId = scopeIdFor(items);
    const sorted = normalizePairs(items).map((p) => items.find((i) => String(i.productId) === p.productId && i.field === p.field));
    return {
      key: dispositionKey(scopeId, { focusKeywords: focus }),
      scopeId,
      kind: focus ? 'focusKeywords' : 'productSeo',
      items: sorted.map((i) => ({ productId: String(i.productId), field: i.field, evidenceHash: i.evidenceHash })),
      allowedValues: focus ? [...FOCUS_VALUES] : [...SEO_VALUES],
      affectedProducts: [...new Set(sorted.map((i) => String(i.productId)))],
      prompt: focus
        ? 'Yoast focus keyphrases have no verified Wix product write path. Accept the loss for these products (omit), or keep them held while you look for evidence (acquire-evidence)?'
        : 'These products show SEO in the source, but the source cannot prove which title/description the merchant overrode. Supply the raw Yoast evidence (acquire-evidence), let them inherit Wix SEO patterns and record the loss (omit), or write the rendered title/description as item overrides (materialize)?',
    };
  };
  if (seoItems.length) questions.push(question(seoItems, false));
  if (focusItems.length) questions.push(question(focusItems, true));
  return questions;
}

// Records the OWNER's answer. There is deliberately no default: a missing or unknown answer throws.
function recordSeoDisposition({ question, value, decidedAt } = {}) {
  if (!question || !question.key || !Array.isArray(question.items)) throw new Error('recordSeoDisposition: a question from buildSeoDispositionQuestions is required');
  if (!question.allowedValues.includes(value)) throw new Error(`recordSeoDisposition: value must be one of ${question.allowedValues.join(', ')}`);
  if (!decidedAt) throw new Error('recordSeoDisposition: decidedAt is required');
  const entry = { value, source: 'user', decidedAt, items: question.items.map((i) => ({ ...i })) };
  const check = validateDispositionEntry(question.key, entry);
  if (!check.ok) throw new Error(`recordSeoDisposition: invalid entry (${check.reason})`);
  return { key: question.key, entry };
}

// --- tag merge and product read-back --------------------------------------------------------
// tags[] is replaced whole, so the current non-import-owned tags are sent back unchanged and only
// the import-owned title/description tags are replaced. `removeFields` names import-owned tags
// the source now says to drop (override -> inherit); anything else unmanaged is left as it is.
function mergeImportOwnedTags(currentTags, plan, { removeFields = [] } = {}) {
  const writes = new Map(TAG_FIELDS.filter((f) => plan.fields[f].action === 'write').map((f) => [f, tagFor(f, plan.fields[f].value)]));
  const out = [];
  for (const tag of currentTags || []) {
    const identity = importOwnedIdentity(tag);
    if (identity && (writes.has(identity) || removeFields.includes(identity))) continue;
    out.push(tag);
  }
  for (const field of TAG_FIELDS) if (writes.has(field)) out.push(writes.get(field));
  return out;
}
function ownTagsByIdentity(tags) {
  const by = { title: [], description: [] };
  for (const tag of tags || []) {
    const identity = importOwnedIdentity(tag);
    if (identity) by[identity].push(tag);
  }
  return by;
}
// Import-owned write fields that are missing or different on the product.
function writeFieldsDiffer(productTags, plan) {
  const by = ownTagsByIdentity(productTags);
  return TAG_FIELDS.filter((f) => plan.fields[f].action === 'write')
    .filter((f) => by[f].length !== 1 || tagValue(by[f][0]) !== plan.fields[f].value);
}
function importOwnedEqual(tagsA, tagsB) {
  const a = ownTagsByIdentity(tagsA);
  const b = ownTagsByIdentity(tagsB);
  return TAG_FIELDS.every((f) => canonicalJson(a[f].map(tagValue)) === canonicalJson(b[f].map(tagValue)));
}

// --- verification ---------------------------------------------------------------------
function verifiedFields(plan) {
  return TAG_FIELDS.filter((f) => plan.fields[f].verify);
}
function checkProductTags(product, plan) {
  const by = ownTagsByIdentity(product && product.seoData && product.seoData.tags);
  const failures = {};
  for (const field of verifiedFields(plan)) {
    const own = by[field];
    if (plan.fields[field].verify === 'override') {
      if (own.length !== 1 || tagValue(own[0]) !== plan.fields[field].value) failures[field] = 'seo_write_unverified';
    } else if (own.length) {
      failures[field] = 'seo_inheritance_unverified';
    }
  }
  return failures;
}
function checkResolution(itemSeoTags, plan) {
  const own = ownTagsByIdentity(itemSeoTags && itemSeoTags.tags);
  const resolved = { title: [], description: [] };
  for (const entry of (itemSeoTags && itemSeoTags.resolvedTags) || []) {
    const identity = importOwnedIdentity(entry && entry.tag);
    if (identity) resolved[identity].push(entry);
  }
  const failures = {};
  for (const field of verifiedFields(plan)) {
    const entries = resolved[field];
    if (plan.fields[field].verify === 'override') {
      const ok = entries.length === 1 && entries[0].source === 'TAG_SOURCE_ITEM' && tagValue(entries[0].tag) === plan.fields[field].value;
      if (!ok) failures[field] = 'seo_write_unverified';
    } else {
      // Inherited: no own tag, and any resolved value comes from a pattern or site setting. An
      // absent or blank resolved tag passes; no equality with the source template is required.
      // hasOverride alone is never evidence either way.
      const bad = own[field].length > 0 || entries.some((e) => {
        if (e.source === 'TAG_SOURCE_ITEM') return true;
        const value = tagValue(e.tag);
        const blank = value == null || String(value).trim() === '';
        return !blank && !INHERIT_SOURCES.includes(e.source);
      });
      if (bad) failures[field] = 'seo_inheritance_unverified';
    }
  }
  return failures;
}

// One product's resolution verification, step by step, so the stage can interleave products:
// the first resolution read happens with no wait; a product whose read fails a
// check or throws is re-read up to delaysMs.length more times, each no earlier than its delay
// after that product's previous read. A pass needs the exact expected state, so a stale read can
// pass only when that state was already present.
function startResolution(plan, product, delaysMs) {
  return { plan, delaysMs, productFailures: checkProductTags(product, plan), resolutionFailures: null, lastError: null, attempts: 0, productRevision: product.revision ?? null };
}
// Only the LATEST read decides the outcome. A failed read clears any earlier mismatch: that
// mismatch may just have been eventual consistency, so an unreadable final attempt is
// `seo_resolution_unverified` (re-verify next run), never a stale `seo_write_unverified`.
function applyResolutionRead(run, read) {
  run.attempts += 1;
  if (read.ok) { run.resolutionFailures = checkResolution(read.value, run.plan); run.lastError = null; }
  else {
    run.resolutionFailures = null;
    run.lastError = read.error && read.error.message ? read.error.message : String(read.error);
  }
  const passed = read.ok && !Object.keys(run.resolutionFailures).length;
  return passed || run.attempts > run.delaysMs.length;
}
function finishResolution(run) {
  const residuals = [];
  for (const field of verifiedFields(run.plan)) {
    const outcome = run.productFailures[field] || (run.resolutionFailures === null ? 'seo_resolution_unverified' : run.resolutionFailures[field]);
    if (outcome) residuals.push({ outcome, field });
  }
  return { verified: residuals.length === 0, residuals, attempts: run.attempts, productRevision: run.productRevision, ...(run.lastError ? { error: run.lastError } : {}) };
}
const asRead = async (fn) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error }; } };

// Serial single-product form of the same rule (used by callers outside the batched stage).
async function verifyProductSeo({ plan, readProduct, readItemSeoTags, product = null, sleep = pause, delaysMs = RESOLUTION_DELAYS_MS } = {}) {
  const fields = verifiedFields(plan);
  if (!fields.length) return { verified: true, skipped: true, residuals: [], attempts: 0, productRevision: product ? product.revision : null };
  let current = product;
  if (!current) {
    try { current = await readProduct(); } catch (error) {
      return { verified: false, residuals: fields.map((field) => ({ outcome: 'seo_resolution_unverified', field })), attempts: 0, error: error.message, productRevision: null };
    }
  }
  const run = startResolution(plan, current, delaysMs);
  for (;;) {
    if (applyResolutionRead(run, await asRead(readItemSeoTags))) break;
    await sleep(delaysMs[run.attempts - 1]);
  }
  return finishResolution(run);
}

// --- persisted SEO state (persistence + journal) ----------------------------------------
const stateFile = (projectDir) => path.join(projectDir, 'state', 'product-seo.json');
async function loadSeoState(projectDir, siteId) {
  try {
    const state = JSON.parse(await fs.readFile(stateFile(projectDir), 'utf8'));
    if (state.schemaVersion !== 1 || state.siteId !== siteId || !state.rows || Array.isArray(state.rows)) throw new Error('Invalid or wrong-site product SEO state');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, siteId, rows: {} };
    throw error;
  }
}
async function saveSeoState(projectDir, state) {
  const dest = stateFile(projectDir);
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try { await fs.writeFile(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 }); await fs.rename(tmp, dest); } finally { await fs.rm(tmp, { force: true }); }
}

// Before writes: what each product's SEO will do (added, changed, removed override -> inherit,
// held, unchanged). Pure; compares against the saved state only.
function previewProductSeo(rows, state = { rows: {} }) {
  return rows.map(({ sourceKey, plan }) => {
    const prev = state.rows[sourceKey];
    const held = TAG_FIELDS.filter((f) => plan.fields[f].action === 'held');
    if (prev && prev.verified && prev.projectionHash === plan.projectionHash) return { sourceKey, change: 'unchanged', held };
    const before = new Set(prev && prev.writtenFields || []);
    const after = new Set(TAG_FIELDS.filter((f) => plan.fields[f].action === 'write'));
    const removed = [...before].filter((f) => !after.has(f) && plan.fields[f].action === 'inherit');
    const added = [...after].filter((f) => !before.has(f));
    const change = removed.length ? 'removed' : added.length && !before.size ? 'added' : after.size ? 'changed' : held.length ? 'held' : 'unchanged';
    return { sourceKey, change, added, removed, held };
  });
}

// --- reconcile (create fallback, reruns, journal) -------------------------------------------
// Runs after the product exists. The caller holds the project state lock. Each row:
//   { sourceKey, targetId, plan, savedRevision }   savedRevision = the Wix revision recorded at
//   the last import-owned write (this run's post-create read for a new product).
// Dependencies are injected: readProduct(id), patchProduct({ productId, revision, seoData }),
// readItemSeoTags(id). `conflictDecisions` maps sourceKey -> a recorded user decision.
//
// Bounded execution: at most `concurrency` (3) products in flight, covering the product
// read, the optional PATCH and the first resolution read. Every Wix read goes through `pacer`
// (the process-wide target read pacer unless injected); a read still failing after the pacer's
// attempts counts as one failed resolution attempt. Products still pending after their first
// read are re-read in retry rounds by the same pool. The stage sleeps for Wix data to settle
// only when nothing is in flight, no first read is left and no re-read is due, and only until
// the earliest pending product is due -- never once per product -- so total settle wait stays
// within one product's delays (31 s). `clock` is milliseconds; `now` is the ISO timestamp.
async function reconcileProductSeo({ projectDir, siteId, rows, readProduct, patchProduct, readItemSeoTags, conflictDecisions = {}, sleep = pause, delaysMs = RESOLUTION_DELAYS_MS, pacer = null, concurrency = SEO_STAGE_CONCURRENCY, clock = () => Date.now(), now = () => new Date().toISOString() } = {}) {
  if (!projectDir || !siteId || !Array.isArray(rows)) throw new Error('reconcileProductSeo: projectDir, siteId and rows are required');
  for (const fn of [readProduct, patchProduct, readItemSeoTags]) if (typeof fn !== 'function') throw new Error('reconcileProductSeo: readProduct, patchProduct and readItemSeoTags are required');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('reconcileProductSeo: concurrency must be a positive integer');
  for (const row of rows) if (!row || !row.sourceKey || !row.targetId || !row.plan || !row.plan.fields) throw new Error('reconcileProductSeo: every row needs sourceKey, targetId and plan');
  // Lazy: wix-writers requires this module for its bulk-SEO guard.
  const readPacer = pacer || require('./wix-writers').sharedTargetReadPacer();
  const pacerBefore = readPacer.stats();
  const state = await loadSeoState(projectDir, siteId);

  // One serialized writer: one atomic state write at a time, each a snapshot taken in turn.
  let writeChain = Promise.resolve();
  const persist = () => {
    const next = writeChain.then(() => saveSeoState(projectDir, state));
    writeChain = next.catch(() => {});
    return next;
  };
  // Stage time: the injected clock, never behind the settle sleeps already taken (a test sleep
  // that does not advance the clock still makes the re-reads it waited for due).
  let sleptUntil = -Infinity;
  const stageNow = () => Math.max(clock(), sleptUntil);
  const paced = (fn) => readPacer.read(fn);

  const results = new Array(rows.length);
  const pending = []; // { index, run, finish, dueAt }

  // Everything one product does before its first resolution read; returns a finisher for the
  // verification outcome, or null when the product is already final.
  async function firstPass(index) {
    const row = rows[index];
    const { sourceKey, targetId, plan } = row;
    let prev = state.rows[sourceKey];
    if (prev && prev.targetId !== targetId) prev = null;
    const result = { sourceKey, targetId, wrote: false, verified: false, residuals: [...plan.residuals] };
    results[index] = result;
    const done = async (patch) => {
      if (patch) { state.rows[sourceKey] = { ...(state.rows[sourceKey] || {}), targetId, ...patch }; await persist(); }
    };
    const tagFail = (outcome, extra = {}) => { for (const field of verifiedFields(plan)) result.residuals.push({ outcome, field, ...extra }); };

    // Unchanged projection and a passed verification: no read, no write, no re-verification.
    if (prev && !prev.journal && prev.verified && prev.projectionHash === plan.projectionHash) {
      result.unchanged = true;
      result.verified = true;
      return;
    }

    const productRead = await paced(() => readProduct(targetId));
    if (!productRead.ok) { tagFail('seo_resolution_unverified'); result.error = productRead.error.message; return; }
    const current = productRead.value;
    const currentTags = (current && current.seoData && current.seoData.tags) || [];

    // Journal: a write that started but was never verified is reconciled by read-back, never replayed.
    let landedJournal = null;
    if (prev && prev.journal) {
      const j = prev.journal;
      if (importOwnedEqual(currentTags, j.intendedTags)) {
        landedJournal = j;
      } else if (String(current.revision) === String(j.baseRevision)) {
        prev = { ...prev, journal: null };
      } else {
        tagFail('seo_write_unverified', { reason: 'journaled write neither landed nor left the saved revision in place' });
        return;
      }
    }

    const projectionChanged = Boolean(prev && prev.projectionHash && prev.projectionHash !== plan.projectionHash);
    const by = ownTagsByIdentity(currentTags);
    const removeFields = projectionChanged
      ? TAG_FIELDS.filter((f) => ['inherit', 'omit'].includes(plan.fields[f].action) && by[f].length && (prev.writtenFields || []).includes(f))
      : [];
    const needsWrite = !landedJournal && (writeFieldsDiffer(currentTags, plan).length > 0 || removeFields.length > 0);
    let productForVerify = current;

    if (needsWrite) {
      const desiredTags = mergeImportOwnedTags(currentTags, plan, { removeFields });
      const baseRevision = (prev && prev.revision) || row.savedRevision || null;
      let writeRevision = baseRevision;
      const review = () => conflicts.buildConflictReview({
        sourceStableKey: sourceKey,
        targetId,
        entity: 'stores/product',
        error: { code: 'INVALID_REVISION', message: baseRevision ? 'The Wix product revision changed since the last import' : 'No saved Wix revision to protect this update' },
        savedTargetRevision: baseRevision,
        currentTargetRevision: current.revision ?? null,
        sourceHash: plan.projectionHash,
        proposedFields: { 'seoData.tags': desiredTags },
        currentTargetValues: { 'seoData.tags': currentTags },
      });
      if (!baseRevision || String(current.revision) !== String(baseRevision)) {
        const conflictReview = review();
        const decision = conflictDecisions[sourceKey];
        const approval = decision ? conflicts.approvalApplies({ decision, review: conflictReview }) : { applies: false };
        if (approval.applies && decision.choice === 'override') {
          const writePlan = conflicts.buildOverrideWritePlan({ decision, review: conflictReview });
          if (!writePlan.ok) { result.residuals.push({ outcome: 'seo_conflict', field: 'seoData', review: conflictReview }); return; }
          writeRevision = writePlan.revision;
        } else if (decision && conflicts.keepDecisionApplies({ decision, sourceHash: plan.projectionHash, currentTargetRevision: current.revision ?? null }).applies) {
          result.residuals.push({ outcome: 'seo_conflict_kept_wix', field: 'seoData' });
          return;
        } else {
          result.residuals.push({ outcome: 'seo_conflict', field: 'seoData', review: conflictReview });
          return;
        }
      }
      const journal = { intendedTags: desiredTags, intendedHash: plan.projectionHash, baseRevision: writeRevision, startedAt: now() };
      state.rows[sourceKey] = { ...(prev || {}), targetId, journal };
      await persist(); // the journal is durable before its PATCH
      try {
        const patched = await patchProduct({ productId: targetId, revision: writeRevision, seoData: { ...(current.seoData || {}), tags: desiredTags } });
        result.wrote = true;
        productForVerify = null;
        if (patched && patched.revision != null) state.rows[sourceKey].journal = { ...journal, writtenRevision: patched.revision };
      } catch (error) {
        const kind = conflicts.classifyUpdateError(error, { sentRevision: true }).kind;
        if (kind === 'revision_conflict' || kind === 'possible_revision_conflict') {
          // Rejected on revision: nothing landed, so the journal is cleared and the owner decides.
          state.rows[sourceKey] = { ...(prev || {}), targetId, journal: null };
          result.residuals.push({ outcome: 'seo_conflict', field: 'seoData', review: review(), error: error.message });
        } else {
          tagFail('seo_write_unverified', { error: error.message });
        }
        await persist();
        return;
      }
      await persist();
    }

    const finish = async (verification) => {
      result.attempts = verification.attempts;
      result.residuals.push(...verification.residuals);
      if (verification.verified) {
        result.verified = true;
        await done({
          projectionHash: plan.projectionHash,
          revision: verification.productRevision ?? (landedJournal && landedJournal.writtenRevision) ?? current.revision ?? null,
          verified: true,
          verifiedAt: now(),
          writtenFields: TAG_FIELDS.filter((f) => plan.fields[f].action === 'write'),
          journal: null,
        });
      } else {
        // Nothing advances until verification passes; a written-but-unverified change keeps its journal.
        await done({ verified: false });
      }
    };

    const fields = verifiedFields(plan);
    if (!fields.length) { await finish({ verified: true, residuals: [], attempts: 0, productRevision: current.revision ?? null }); return; }
    if (!productForVerify) {
      const reread = await paced(() => readProduct(targetId));
      if (!reread.ok) {
        await finish({ verified: false, residuals: fields.map((field) => ({ outcome: 'seo_resolution_unverified', field })), attempts: 0, productRevision: null });
        return;
      }
      productForVerify = reread.value;
    }
    const run = startResolution(plan, productForVerify, delaysMs);
    await resolutionRead({ run, finish, targetId, index });
  }

  async function resolutionRead(item) {
    const read = await paced(() => readItemSeoTags(item.targetId));
    if (applyResolutionRead(item.run, read)) { await item.finish(finishResolution(item.run)); return; }
    item.dueAt = stageNow() + item.run.delaysMs[item.run.attempts - 1];
    pending.push(item);
  }

  // The pool: due re-reads first, then first passes; settle-sleep only when nothing can start.
  let nextFirst = 0;
  let settleWaitMs = 0;
  let maxInFlight = 0;
  const inFlight = new Set();
  let failure = null;
  const nextTask = () => {
    const t = stageNow();
    let due = -1;
    for (let i = 0; i < pending.length; i += 1) if (pending[i].dueAt <= t && (due < 0 || pending[i].dueAt < pending[due].dueAt)) due = i;
    if (due >= 0) { const item = pending.splice(due, 1)[0]; return () => resolutionRead(item); }
    if (nextFirst < rows.length) { const index = nextFirst++; return () => firstPass(index); }
    return null;
  };
  while (!failure && (nextFirst < rows.length || pending.length || inFlight.size)) {
    let task;
    while (!failure && inFlight.size < concurrency && (task = nextTask())) {
      const p = task().catch((error) => { if (!failure) failure = error; }).finally(() => inFlight.delete(p));
      inFlight.add(p);
      maxInFlight = Math.max(maxInFlight, inFlight.size);
    }
    if (failure) break;
    if (inFlight.size) { await Promise.race(inFlight); continue; }
    if (pending.length) {
      const t = stageNow();
      const target = Math.min(...pending.map((item) => item.dueAt));
      if (target > t) {
        try { await sleep(target - t); } catch (error) { failure = error; break; }
        settleWaitMs += target - t;
        sleptUntil = Math.max(sleptUntil, target);
      }
    }
  }
  await Promise.allSettled([...inFlight]);
  await writeChain;
  if (failure) throw failure;

  const pacerAfter = readPacer.stats();
  const timing = {
    concurrency,
    maxInFlight,
    settleWaitMs,
    pacingWaitMs: (pacerAfter.pacingWaitMs || 0) - (pacerBefore.pacingWaitMs || 0),
    backoffWaitMs: (pacerAfter.backoffWaitMs || 0) - (pacerBefore.backoffWaitMs || 0),
    reads: (pacerAfter.reads || 0) - (pacerBefore.reads || 0),
  };
  return { siteId, results, stageResiduals: collectSeoStageResiduals(results), timing };
}

// --- completion rows ------------------------------------------------------------------
function collectSeoStageResiduals(results) {
  const groups = new Map();
  for (const result of results || []) {
    const seen = new Set();
    for (const residual of result.residuals || []) {
      if (!SEO_OUTCOMES.includes(residual.outcome)) throw new Error(`collectSeoStageResiduals: unknown outcome ${residual.outcome}`);
      if (seen.has(residual.outcome)) continue;
      seen.add(residual.outcome);
      if (!groups.has(residual.outcome)) groups.set(residual.outcome, []);
      groups.get(residual.outcome).push(result.sourceKey);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([outcome, sourceKeys]) => ({
    entity: 'product', stage: 'seo', outcome, count: sourceKeys.length, sourceKeys: sourceKeys.sort(),
  }));
}
function seoStageBlocksCompletion(stageResiduals) {
  return (stageResiduals || []).some((row) => row.count > 0 && !SEO_ACCEPTED_OUTCOMES.includes(row.outcome));
}

// Executable negative guard: no Stores product write routes through the generic Item SEO
// bulk writer. wix-writers' bulk builder calls this.
function assertNotStoresProductBulkSeo(itemType) {
  if (String(itemType || '').toUpperCase() === STORES_PRODUCT_ITEM_TYPE) {
    throw new Error('Generic Item SEO bulk writes are refused for STORES_PRODUCT: on 2026-08-27 that call reported per-entry success and persisted nothing. Write product SEO through Catalog V3 product.seoData (create, or a revision-protected PATCH) and verify by read-back.');
  }
}

module.exports = {
  TAG_FIELDS,
  SEO_FIELDS,
  SEO_VALUES,
  FOCUS_VALUES,
  INHERIT_SOURCES,
  RESOLUTION_DELAYS_MS,
  SEO_STAGE_CONCURRENCY,
  STORES_PRODUCT_ITEM_TYPE,
  canonicalJson,
  fieldProjection,
  fieldEvidenceHash,
  scopeIdFor,
  dispositionKey,
  validateDispositionEntry,
  matchDispositions,
  planProductSeo,
  seoHashProjection,
  seoProjectionHash,
  seoDataForCreate,
  buildSeoDispositionQuestions,
  recordSeoDisposition,
  importOwnedIdentity,
  mergeImportOwnedTags,
  writeFieldsDiffer,
  checkProductTags,
  checkResolution,
  verifyProductSeo,
  loadSeoState,
  previewProductSeo,
  reconcileProductSeo,
  collectSeoStageResiduals,
  seoStageBlocksCompletion,
  assertNotStoresProductBulkSeo,
};
