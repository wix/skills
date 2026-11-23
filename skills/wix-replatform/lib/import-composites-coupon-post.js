'use strict';

// Design v2 K1: coupons and blog posts run inside the shared loop (import-task-runner.js
// runRecordTask) like products, contacts and orders. Generated code gives only
// build(record, lookups); the loop gates, looks up, journals and sends. This file holds the fixed
// toolkit part for the two entities, as COMPOSITES entries the runner merges in:
//
// stores/coupon
//   build returns { specification } or the bare specification (from coupon-discovery.mapCouponToWix, which the AI uses as-is
//   unless the plan says otherwise) with product / category scope ids from lookups.ref.
//   - Safety (fixed, never an operator choice): a bearer voucher (single-use money amount) is
//     re-read from the source just before the write, and the pre-write drift verdict is the final
//     body. A voucher is never written from a stale or undated snapshot, nor when the re-read fails;
//     it is held with a cutover item instead. Other coupons are written from the snapshot.
//   - Send: ensureCoupon (query by exact code, then create), so a retry never makes a duplicate.
//   - A coupon written switched off because a plugin rule could not be carried, or a code that is
//     on the site more than once, becomes a cutover item.
//
// blog/post
//   build returns { draftPost: { title, excerpt, seoSlug, firstPublishedDate, categoryIds,
//   heroImage: { url } } } with category ids from lookups.ref, and loopInput { contentHtml } (which
//   source field is the body is a mapping choice). The hero follows the plan (row post-hero, helper
//   blog-post-media.heroImage): the URL the build gives is the one imported; no URL, no hero.
//   - Fixed: author lookup (an author member id the build looked up is kept; otherwise the
//     existing site owner, read-only, never a new member), Ricos conversion, cover and inline media,
//     and the blog build runner (draft, publish, read-back, recovery ledger).
//   - A post whose media is not ready is deferred and becomes a cutover item; a later pass that
//     lands it closes the item. The owner fallback is recorded as a cutover item (an attribution
//     choice the operator can change in Business Manager).
//
// Each composite reports through the loop: the loop journals the row and writes the crosswalk
// (`ownsCrosswalk: false`). Cutover items go through dependency-readiness recordTaskGap, which the
// completion report already turns into structured operatorActions.

const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // the run's freshness budget for source redeemability values
const STEP_DONE = 'done';

const drift = () => require('../resources/rp-target-wix/lib/coupon-redemption-drift');
const writers = () => require('../resources/rp-target-wix/lib/wix-writers');

// The extract's capture time for this source entity: the binding's own extract manifest, else the
// extract-wide manifest. Unknown is null (classifySnapshot refuses an undated snapshot).
function captureTime(projectDir, manifestPath, sourceEntity) {
  const read = file => { try { return JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')); } catch { return null; } };
  const own = manifestPath ? read(manifestPath) : null;
  if (own?.extractedAt) return own.extractedAt;
  return (read('data/source-extract/manifest.json')?.entities || []).find(row => row.entity === sourceEntity)?.extractedAt || null;
}

// The WordPress coupon re-read: wc/v3/coupons/{id} now, or null when the read failed.
async function wordpressCouponReader(projectDir) {
  const { readEnvFile } = require('./config-env');
  const { fetchJson, buildHeaders } = require('../resources/rp-source-wordpress/lib/wp-http');
  const env = await readEnvFile(path.join(projectDir, 'config', 'source.wordpress.env')).catch(() => ({}));
  for (const key of ['WP_BASE_URL', 'WP_USERNAME', 'WP_APPLICATION_PASSWORD']) if (!env[key] && process.env[key]) env[key] = process.env[key];
  if (!env.WP_BASE_URL) return async () => null;
  const headers = buildHeaders({ username: env.WP_USERNAME, applicationPassword: env.WP_APPLICATION_PASSWORD });
  const read = async id => { try { const response = await fetchJson(env.WP_BASE_URL, `/wc/v3/coupons/${encodeURIComponent(id)}`, { headers }); return response.ok ? response.json : null; } catch { return null; } };
  // Many coupons in one list read (`include`, 100 a page): Map of id -> coupon, or null when a read
  // failed. A coupon the list does not return is read on its own (read above).
  read.many = async ids => {
    try {
      const found = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const response = await fetchJson(env.WP_BASE_URL, '/wc/v3/coupons', { headers, query: { include: ids.slice(i, i + 100).join(','), per_page: 100 } });
        if (!response.ok || !Array.isArray(response.json)) return null;
        for (const row of response.json) found.set(String(row.id), row);
      }
      return found;
    } catch { return null; }
  };
  return read;
}

// Once per pass: the snapshot verdict and the source re-reader (only when a voucher can be written).
async function couponPass(c) {
  if (!c.shared.coupon) {
    const snapshot = drift().classifySnapshot({ capturedAt: captureTime(c.projectDir, c.manifestPath, c.sourceEntity), now: Date.now(), maxAgeMs: SNAPSHOT_MAX_AGE_MS });
    c.shared.coupon = { snapshot, readFresh: snapshot.fresh ? await c.primitives.couponReader(c.projectDir) : null, batch: null };
  }
  return c.shared.coupon;
}

// mapCouponToWix writes a coupon whose plugin rule Wix cannot hold switched off, with this tag.
const ruleHeld = specification => specification.active === false && Array.isArray(specification.tags) && specification.tags.includes(drift().TAGS.RULE_NOT_CARRIED);

const VOUCHER_HELD = 'coupon-voucher-not-written';
const voucherHold = async (c, code, detail) => {
  await c.recordGap(VOUCHER_HELD, { severity: 'high',
    action: 'These single-use money coupons (vouchers) were not written: whether each one was already spent at the source could not be confirmed right before the write (each record names why: an old or undated source snapshot, a failed source re-read, or a value Wix cannot hold). Extract coupons again and rerun the coupon import; it writes each voucher with its remaining uses. A value with more than 2 decimals must be created by hand in Business Manager.',
    detail });
  return { status: 'held', holds: [{ decisionId: 'coupon-usage', code }] };
};

// Wix refuses (400 "When scope or minimumSubtotal is not used - only FreeShipping coupon is
// allowed") a coupon with no scope, no minimum spend and no free shipping. mapCouponToWix always
// writes one of them (storewide is scope { namespace: 'stores' }); a plan that drops it (live run
// 09895795: 82 of 87 coupons) holds the coupon with a cutover item instead of sending it.
const wixAcceptsShape = s => Boolean(s.scope) || (s.minimumSubtotal !== undefined && s.minimumSubtotal !== null) || s.freeShipping === true;
const SHAPE_HELD = 'coupon-shape-not-accepted';
const shapeHold = async c => {
  if (!c.dryRun) await c.recordGap(SHAPE_HELD, { severity: 'high',
    action: 'These coupons were not written: the build gave them no scope, no minimum spend and no free shipping, and Wix refuses such a coupon. Requires Import Operator. Prompt: "In mapping/mapping-plan.json, make the coupon-scope row write scope.namespace = stores for a coupon with no product, no category and no minimum (as rp-source-wordpress mapCouponToWix does), then rerun the coupon import." Evidence: each coupon is imported (Business Manager → Marketing → Coupons) and this item closes.',
    detail: { outcome: SHAPE_HELD } });
  return { status: 'held', holds: [{ decisionId: 'coupon-scope', code: SHAPE_HELD }] };
};

// Wix refuses (400 "entityId not found") a coupon scoped to a product that is hidden on the site,
// so a coupon on a product imported hidden (a draft or private source product) can never be
// written as it is. One-click default and the only safe choice: hold it whole with a cutover task.
// Never widen it to storewide, never switch it off, never make the product visible (the owner's
// storefront call). The product's `visible` is read once per product per pass from the site, so a
// plan that changed the product-visible rule is still read right. An unreadable product is sent
// unchecked, as before (ensureCoupon marks the result).
const SCOPE_HIDDEN = 'coupon-scope-target-hidden';
const SCOPE_HIDDEN_RESUME = 'coupon-scope-target-hidden-resume';
// The scoped product on the site, read once per product per pass: { visible, name } or null.
const scopeProduct = async (specification, c) => {
  const group = specification.scope && specification.scope.group;
  if (!group || group.name !== 'product' || !group.entityId || !c.taskClient) return null;
  const cache = (c.shared.couponScopeProduct ||= new Map());
  const id = String(group.entityId);
  if (!cache.has(id)) cache.set(id, await c.primitives.productScope(c.taskClient, id).catch(() => null));
  return cache.get(id) || null;
};
const scopeTargetFor = async (specification, c) => {
  const product = await scopeProduct(specification, c);
  return product && typeof product.visible === 'boolean' ? { visible: product.visible } : undefined;
};
// Two tasks, one per role: the merchant's choice in Business Manager, then (only when the product
// was made visible) the Import Operator's resume. Each record names the coupon code (not for a
// single-use money voucher: its code is a bearer secret) and the product.
const hiddenHold = async (c, record, specification) => {
  if (!c.dryRun) {
    const product = await scopeProduct(specification, c);
    const detail = { ...(drift().isBearerVoucher(record) ? {} : { couponCode: String(specification.code) }), sourceCouponId: String(record.id),
      productId: String(specification.scope.group.entityId), ...(product?.name ? { productName: String(product.name).slice(0, 120) } : {}) };
    await c.recordGap(SCOPE_HIDDEN, { operatorRole: 'Cutover Operator', severity: 'medium',
      action: 'These coupons were not imported: each is limited to one product that is hidden on Wix (a draft, pending or private product at the source), and Wix refuses a coupon on a hidden product. Nothing was widened to the whole store. For each coupon (code and product listed), choose one in Business Manager: (a) Store Products → open the product → make it visible, then ask the Import Operator to resume the coupon import (the companion Import Operator task); (b) Marketing → Coupons → create the coupon yourself with the limit you want; or (c) confirm the coupon is not wanted. Evidence: the coupon exists in Marketing → Coupons, or is confirmed unwanted.',
      detail });
    await c.recordGap(SCOPE_HIDDEN_RESUME, { severity: 'medium',
      action: `Only for coupons whose product the merchant made visible (Cutover Operator task ${SCOPE_HIDDEN}, choice a): resume the coupon import task with --deferred-only. The coupon loop reads the product again and writes the coupon with its product limit; coupons already on the site are not sent again. For a coupon the merchant created by hand or declined, record it as an approved omission instead. Evidence: this task no longer lists the coupon.`,
      detail });
  }
  return { status: 'held', holds: [{ decisionId: 'coupon-scope', code: SCOPE_HIDDEN }] };
};

const coupon = {
  operation: 'createCoupon', steps: ['create'], ownsCrosswalk: false,
  // The loop's per-record check, inside the gate after build. It hands back `{ body }`. The gated body is the bare specification: the gate reads scope
  // ids at `scope.group.entityId` and the send check unwraps the writer's `{ specification }`, so
  // both read the same object (a wrapped body left every scoped coupon without its granted id).
  // Then the voucher safety check: the verdict is the body that is gated and sent; the mapper's
  // snapshot values are never sent for a voucher.
  // Before the batch's checks: one source read for every voucher in the batch, so a batch never pays
  // a per-record network wait (Poratus 11-19: ~3 s per voucher, a ~100 s pause per batch of 50).
  async prepareChecks(records, c) {
    const ids = records.filter(record => drift().isBearerVoucher(record)).map(record => record.id);
    if (c.shared.coupon) c.shared.coupon.batch = null;
    if (!ids.length) return;
    const pass = await couponPass(c);
    if (pass.snapshot.fresh && typeof pass.readFresh?.many === 'function') pass.batch = await pass.readFresh.many(ids);
  },
  async check(record, body, c) {
    const specification = body && typeof body === 'object' && Object.hasOwn(body, 'specification') ? body.specification : body;
    if (specification && typeof specification === 'object' && !wixAcceptsShape(specification)) return shapeHold(c);
    if (specification && typeof specification === 'object') {
      const scopeTarget = await scopeTargetFor(specification, c);
      if (scopeTarget && scopeTarget.visible === false) return hiddenHold(c, record, specification);
    }
    if (!specification || typeof specification !== 'object' || !drift().isBearerVoucher(record) || c.dryRun) return { body: specification };
    const { snapshot, readFresh, batch } = await couponPass(c);
    if (!snapshot.fresh) return voucherHold(c, `voucher-${snapshot.verdict}`, { outcome: snapshot.verdict });
    const hold = ruleHeld(specification) ? { reason: 'plugin-rule-not-carried', tag: drift().TAGS.RULE_NOT_CARRIED } : null;
    const verdict = drift().classifyPreWriteDrift({ snapshotCoupon: record, freshCoupon: batch?.has(String(record.id)) ? batch.get(String(record.id)) : await readFresh(record.id), hold });
    if (!verdict.write) return voucherHold(c, verdict.outcome, { outcome: verdict.outcome });
    const next = { ...specification, active: verdict.writeActive, tags: verdict.setTags };
    if (verdict.usageUnlimited) { delete next.usageLimit; next.usageUnlimited = true; }
    else if (verdict.writeUsageLimit != null) { next.usageLimit = verdict.writeUsageLimit; delete next.usageUnlimited; }
    return { body: next };
  },
  async send(client, payload, record, c) {
    const specification = payload;
    try { writers().assertCouponRedeemabilityDecided(specification); }
    catch (error) { return { base: { outcome: 'coupon-specification-invalid', writeAttempted: false, error: Object.assign(error, { code: 'coupon-specification-invalid' }) }, steps: {} }; }
    // The same visibility verdict the check read (cached for the pass); a hidden target never gets here.
    const scopeTarget = await scopeTargetFor(specification, c);
    const result = await c.primitives.ensureCoupon(client, { specification, ...(scopeTarget ? { scopeTarget } : {}) });
    if ((result.outcome === 'coupon-written' || result.outcome === 'coupon-reconciled-existing') && result.couponId) {
      const targetId = String(result.couponId);
      // A coupon held for a hidden product lands once the product is visible: its tasks close.
      if (scopeTarget && c.resolveGap) { await c.resolveGap(SCOPE_HIDDEN); await c.resolveGap(SCOPE_HIDDEN_RESUME); }
      const tag = drift().TAGS.RULE_NOT_CARRIED;
      if (ruleHeld(specification)) await c.recordGap('coupon-plugin-rule-held', { operatorRole: 'Cutover Operator', severity: 'high',
        action: `These coupons had a coupon-plugin rule Wix coupons cannot hold (a free gift, a shipping, payment, role or location limit, an automatic apply, or a product limit). They were imported switched off and tagged ${tag}. In Business Manager → Marketing → Coupons, switch each one on as it is, change it, or leave it off.`,
        detail: { targetId } });
      return { base: { targetId, outcome: result.outcome }, steps: { create: STEP_DONE } };
    }
    if (result.outcome === 'coupon-reconciliation-ambiguous') {
      await c.recordGap('coupon-code-duplicated-on-site', { operatorRole: 'Cutover Operator', severity: 'high',
        action: 'The site already holds more than one coupon with the same code as each of these source coupons, so none was written or adopted. In Business Manager → Marketing → Coupons, keep one coupon per code and delete the others, then rerun the coupon import.',
        detail: { matches: Number(result.matchCount) || 0 } });
      return { base: { outcome: 'coupon-reconciliation-ambiguous', writeAttempted: false, error: Object.assign(new Error('several coupons with this code exist on the site'), { code: 'coupon-reconciliation-ambiguous' }) }, steps: {} };
    }
    // The pre-create read failed: nothing was written; a later pass reads again.
    if (result.outcome === 'coupon-target-read-failed') return { base: { outcome: result.outcome, writeAttempted: false, error: Object.assign(new Error(String(result.error?.message || result.outcome)), { code: result.outcome }) }, steps: {} };
    const error = Object.assign(new Error(String(result.error?.message || result.outcome || 'coupon write failed')), { code: result.outcome || 'coupon-failed' }, Number.isInteger(result.error?.status) ? { status: result.error.status } : {});
    return { base: { outcome: result.outcome || 'coupon-failed', error }, steps: {} };
  },
};

// --- blog/post ---------------------------------------------------------------------------------

// The fields the blog media and build helpers read from a source post (source reading is fixed).
// The hero is the plan's: the build's heroImage.url. Its media key keeps the source media id, so a
// resumed post finds its earlier import; a URL with no source id gets a stable key from the URL.
function sourcePost(record, { contentHtml, title, heroUrl }) {
  const own = record.featured_media !== undefined && record.featured_media !== null && !['', '0'].includes(String(record.featured_media));
  const featured = heroUrl ? (own ? record.featured_media : `url-${require('node:crypto').createHash('sha256').update(heroUrl).digest('hex').slice(0, 16)}`) : 0;
  return { id: record.id, link: record.link, featured_media: featured, _embedded: record._embedded, title, contentHtml: String(contentHtml || ''), heroUrl: heroUrl || null };
}

// The site owner's member, read once per pass with the read-only listMembers. Anything but exactly
// one member cannot name the owner without guessing.
async function ownerMemberId(client) {
  const response = await writers().listMembers(client);
  const members = Array.isArray(response) ? response : response?.members || [];
  return members.length === 1 && members[0]?.id ? String(members[0].id) : null;
}

// The blog build runner for one post: media first (a post whose cover or inline image is not READY
// is written nowhere), then draft, publish, read-back and recovery. Returns { postId } or
// { pending: reason }.
// `blogClient` / `buildOptions` replace the Wix Blog client and the build runner's waits (tests drive
// the real stage against a fake Blog API with them); production uses createBlogBuildClient and the
// runner's own defaults.
async function publishPostDefault(client, { projectDir, runId, post, draftPost, existingTargetId, blogClient = null, buildOptions = {} }) {
  const w = writers();
  const blogMedia = require('../resources/rp-target-wix/lib/blog-post-media');
  const blogStage = require('../resources/rp-target-wix/lib/blog-post-build-stage');
  const blogLedger = require('../resources/rp-target-wix/lib/blog-post-build-ledger');
  const { createBlogBuildClient } = require('../resources/rp-target-wix/lib/blog-post-build-client');
  const key = blogMedia.postStableKey(post), hasContent = post.contentHtml.trim() !== '';
  const richContent = hasContent ? await w.convertHtmlToRichContent(client, post.contentHtml) : { nodes: [] };
  const pendingMedia = blogMedia.createPendingBlogMediaState({ projectDir });
  const fetchFeaturedMedia = async () => post.heroUrl || null;
  let media;
  try {
    media = existingTargetId
      ? await blogMedia.existingPostMedia({ post, richContent, state: pendingMedia, resolveFromCrosswalk: async () => null, wix: client })
      : await blogMedia.importAndConfirmPostMedia(client, { post, richContent, state: pendingMedia, fetchFeaturedMedia });
  } catch (error) {
    if (error.code !== 'BLOG_LEGACY_MEDIA_UNRESOLVED') throw error;
    media = { allReady: false, resumed: false, reason: error.message };
  }
  if (media.allReady) blogMedia.applyPostMedia(richContent, media);
  const desiredPost = media.allReady ? w.toDraftPostBody({ ...draftPost, ...(hasContent ? { richContent } : {}), heroImageId: media.heroImageId }) : null;
  const prepared = { sourceStableKey: key, id: post.id, date: draftPost.firstPublishedDate, slug: draftPost.slug, hasPostLinks: false,
    forceSlugUpdate: Boolean(desiredPost && draftPost.slug && !desiredPost.seoSlug), mediaReady: media.allReady, mediaPendingReason: media.reason || null,
    mediaResumed: media.resumed, existingCrosswalk: Boolean(existingTargetId), desiredPost };
  // The live-page sample needs the new Wix site's public URL, which is not known here
  // (WP_BASE_URL is the old site), so the sample is skipped.
  const fetchPage = async () => null;
  const fetchImage = async url => { const response = await fetch(url); return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) }; };
  // The stage's crosswalk view over the project crosswalk: the loop writes the row once the post lands.
  const crosswalk = {
    get: async () => existingTargetId || null,
    idOwners: id => (id && id === existingTargetId ? [key] : []),
    set: async () => {},
    recordVerified: async () => {},
  };
  const { pending } = await blogStage.runBlogBuildStage({ projectDir, sourcePosts: [post], preparedPosts: [prepared], client: blogClient || createBlogBuildClient(client, { fetchPage, fetchImage }), pendingMedia, runId, crosswalk, checks: [], transforms: {}, options: buildOptions });
  const phase = blogLedger.fold(blogLedger.readRows(projectDir)).posts.get(key)?.phase;
  if (phase?.phase === 'verified' && phase.postId) return { postId: String(phase.postId) };
  const row = (pending.pending || []).find(entry => entry.sourceStableKey === key);
  return { pending: row ? `blog-post-pending:${row.reason}`.slice(0, 200) : 'blog-post-pending' };
}

const POST_PENDING = 'blog-post-not-published';
const post = {
  operation: 'createDraftPost', steps: ['post'], ownsCrosswalk: false,
  // Inside the gate, after build. The gated body is the bare draft (the plan rows' paths, e.g.
  // categoryIds[], are relative to it, as the plan builder emits it); a `{ draftPost }` build is
  // unwrapped here so the gate and the send check read the category ids at the same path.
  async check(record, body) {
    const wrapped = body && typeof body === 'object' && Object.hasOwn(body, 'draftPost') && body.draftPost && typeof body.draftPost === 'object';
    return { body: wrapped ? body.draftPost : body };
  },
  async send(client, payload, record, c) {
    const draft = payload && typeof payload === 'object' && Object.hasOwn(payload, 'draftPost') ? payload.draftPost : payload;
    if (!draft || typeof draft !== 'object' || typeof draft.title !== 'string') return { base: { outcome: 'post-build-invalid', writeAttempted: false, error: Object.assign(new Error('post build must return a draft (or { draftPost }) with a title'), { code: 'post-build-invalid' }) }, steps: {} };
    const findings = [];
    let memberId = draft.memberId;
    if (!memberId) {
      if (c.shared.blogOwner === undefined) c.shared.blogOwner = await c.primitives.ownerMemberId(client);
      if (!c.shared.blogOwner) {
        await c.recordGap('blog-author-owner-unresolved', { severity: 'high',
          action: 'These posts were not written: they have no author member, and the new site does not have exactly one member to attribute them to. Make sure the site owner is the only member (or map post authors to members in the plan), then rerun the post import.',
          detail: {} });
        return { base: { outcome: 'blog-author-owner-unresolved', writeAttempted: false, error: Object.assign(new Error('site owner member not resolvable read-only'), { code: 'blog-author-owner-unresolved' }) }, steps: {} };
      }
      memberId = c.shared.blogOwner;
      findings.push({ code: 'blog-author-owner-fallback' });
    }
    const input = c.loopInput || {};
    // The draft body gets the imported file's id (heroImageId), never the source URL.
    // The slug: seoSlug is the field the Wix draft-post request reads (and the plan rows' target,
    // post.json); a bare `slug` is accepted too. toDraftPostBody takes it as `slug`.
    const { heroImage, seoSlug, slug: bareSlug, ...rest } = draft;
    const slug = seoSlug || bareSlug;
    const fields = { ...rest, ...(slug ? { slug } : {}) };
    const result = await c.primitives.publishPost(client, { projectDir: c.projectDir, runId: c.runId, existingTargetId: c.existingTargetId || null,
      ...(c.primitives.blogBuildClient ? { blogClient: c.primitives.blogBuildClient(client), buildOptions: c.primitives.blogBuildOptions || {} } : {}),
      post: sourcePost(record, { contentHtml: input.contentHtml, title: draft.title, heroUrl: heroImage?.url }), draftPost: { ...fields, memberId } });
    if (result?.pending) {
      await c.recordGap(POST_PENDING, { severity: 'high',
        action: 'These posts were not published yet: a cover or inline image was not ready on Wix (each record names why). Rerun the post import; it waits for the media and never creates a post twice. If an image is gone from the source, remove it from the post at the source or accept the post without it, then rerun.',
        detail: { reason: String(result.pending).slice(0, 200) } });
      return { deferred: String(result.pending).slice(0, 200) };
    }
    if (!result?.postId) return { base: { outcome: 'post-not-verified', unverified: true, error: Object.assign(new Error('the blog build runner returned no verified post'), { outcomeKnown: false }) }, steps: {} };
    await c.resolveGap(POST_PENDING);
    if (findings.length) await c.recordGap('blog-author-owner-fallback', { operatorRole: 'Cutover Operator', severity: 'low',
      action: 'These posts are attributed to the site owner because no author member was mapped (no member is created for a source author). In Business Manager → Blog, change a post\'s writer if it should show someone else.',
      detail: { targetId: result.postId } });
    return { base: { targetId: result.postId, outcome: 'post-verified' }, steps: { post: STEP_DONE }, findings };
  },
};

const primitives = {
  ensureCoupon: (client, options) => writers().ensureCoupon(client, options),
  // The site product's `visible` flag (boolean), or undefined when it cannot be read.
  productScope: async (client, id) => { const product = await writers().getStoresProduct(client, id); return product ? { visible: typeof product.visible === 'boolean' ? product.visible : undefined, name: product.name } : null; },
  couponReader: projectDir => wordpressCouponReader(projectDir),
  ownerMemberId: client => ownerMemberId(client),
  publishPost: publishPostDefault,
};

module.exports = { COMPOSITES: { 'stores/coupon': coupon, 'blog/post': post }, primitives, SNAPSHOT_MAX_AGE_MS, captureTime };
