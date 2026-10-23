'use strict';

// Blog post author attribution: resolve a real Wix member for each distinct source blog author,
// instead of attributing every imported post to the site owner.
//
// THE PITFALL: every imported blog post could carry the SAME memberId -- the site owner's own
// auto-created user-member -- regardless of which WordPress author actually wrote the post. The
// source data (data/source-extract/post.ndjson, via `_embedded.author`) names each post's
// distinct author, and all of them were discarded on import in favor of one hardcoded
// `WIX_BLOG_AUTHOR_MEMBER_ID`. Root cause: a stale
// assumption in wix-writers.js's members section ("attribute-to-owner blog imports need no
// member provisioning") -- a deliberate but wrong simplification, because Wix Blog's `memberId`
// is required and has no "unauthored" option.
//
// The sanctioned fix, verified directly against Wix's own documentation -- the internal skill
// doc "How to Create Blog Posts" (dev.wix.com/docs/api-reference/business-solutions/blog/skills/
// how-to-create-blog-posts, "Part 0: Get an Author/Member ID") -- is to CREATE a member when
// there is no existing member to reuse for an author: its `profile.nickname` (derived from
// `contact.firstName`) is the name the blog displays as the author, and "If the user named an
// author, use their name." The same doc, and wix-writers.js's own VERIFIED notes near
// `createMember`, confirm Create Member sends no email and fires no signup-automation trigger --
// member creation here is silent, not a notification risk.
//
// This creates ONE member per distinct SOURCE AUTHOR, never one per post: callers must resolve
// through a crosswalk keyed by `sourceAuthorId` (see the `crosswalk` param below) so two posts by
// the same WordPress author resolve to the same Wix member, and a resumed/re-run import never
// creates a second member for an author it already provisioned. Recording that crosswalk row
// after a successful create is the CALLER's responsibility (mirrors `customer-member.js` /
// `member-crosswalk.js`'s own ensure-then-persist split for the order-buyer member pass) --
// this module only resolves and creates; see rp-import-codegen/SKILL.md's "Blog post author
// attribution" section for the generated call site that does both.
//
// Not every migration source populates author info on every post (`_embedded.author` is a
// WordPress `_embed` convenience, not a guarantee across every source platform this toolkit
// supports) -- resolution falls back to the existing site-owner attribution when a post simply
// has no source author data, rather than making author resolution a hard requirement that blocks
// import.

const w = require('./wix-writers.js');

const OUTCOMES = Object.freeze([
  'blog-author-reconciled-existing', // crosswalk already had a member for this source author
  'blog-author-created', // no crosswalk row for this source author; a new member was created
  'blog-author-owner-fallback', // post carries no source author info at all; owner attribution
]);

// RFC 2606 reserves `.invalid` for addresses guaranteed never to resolve or be deliverable --
// unlike `example.com`/`example.org`, which some mail systems do attempt to resolve, `.invalid`
// is the correct TLD for a placeholder address that must never receive mail. The local part
// carries ONLY the opaque source author id (never the author's real name or any other PII) --
// the whole point of this fix is that the human's NAME is what is supposed to show up as
// "posted by X" on the blog, deliberately, via `profile.nickname`/`contact.firstName`; the
// placeholder address that makes the member creatable carries none of it. The domain is scoped
// per `siteId` so the SAME source author id across two different projects' migrations can never
// collide into the same placeholder address -- loginEmail uniqueness is per-site in Wix Members,
// so this costs nothing and removes any cross-project ambiguity from the scheme.
//
// Pattern: `blog-author-{hash(sourceAuthorId)}@{hash(siteId)}.invalid` (see the collision fix
// below for why each component is a hash of the raw value rather than the raw value itself).
//
// COLLISION FIX: an earlier version of this function
// derived the token via a lossy, human-readable sanitization (lowercase, then collapse every run
// of non-alphanumeric characters to a single `-`). That is not injective: two different raw
// values that differ only in WHICH separator character they use collapse to the identical token
// -- e.g. sourceAuthorId `'1-2'` and `'1@2'` both sanitized to `'1-2'`, so two genuinely distinct
// WordPress authors would have collided onto the SAME placeholder `loginEmail` and therefore the
// SAME Wix member, silently misattributing one author's posts to the other. The fix derives the
// token from a hash of the RAW, un-sanitized value instead: distinct inputs can never collide
// (short of a SHA-1 collision). This token is never exposed as user-facing content -- it only
// ever appears inside the `.invalid` placeholder email's local part; the real, human-readable
// author name goes solely into `profile.nickname`/`contact.firstName` (see
// `resolveBlogAuthorMemberId` below) -- so there is no readability requirement to trade off here.
function sanitizeForEmailToken(value) {
  const raw = value === undefined || value === null ? '' : String(value);
  return require('node:crypto').createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

function buildPlaceholderAuthorEmail({ sourceAuthorId, siteId }) {
  if (sourceAuthorId === undefined || sourceAuthorId === null || sourceAuthorId === '') {
    throw new Error('buildPlaceholderAuthorEmail requires sourceAuthorId');
  }
  const authorToken = sanitizeForEmailToken(sourceAuthorId);
  const siteToken = sanitizeForEmailToken(siteId || 'site');
  return `blog-author-${authorToken}@${siteToken}.invalid`;
}

// CORRECTED: this module previously paced its own Create
// Member write against a module-private `lastAuthorMemberWriteAt` clock, entirely disjoint from
// `ensureMember`'s own `lastMemberWriteAt` in wix-writers.js -- the two never saw each other's
// writes despite sharing the same `MEMBER_WRITE_MIN_INTERVAL_MS` constant. wix-writers.js's own
// comment documents the >=1s Create Member floor as a constraint on the Wix API endpoint
// itself, not on whichever function happens to call it, and rp-import-codegen/SKILL.md's
// generated importers run passes sequentially in ONE process -- so a migration's member
// pass (`ensureMember`) and blog-author pass (`resolveBlogAuthorMemberId`) could issue two
// Create Member calls under 1s apart. Fixed by going through wix-writers.js's exported
// `pacedCreateMember`, which reads and stamps the SAME clock `ensureMember` uses, so every
// Create Member call in the process -- regardless of which pass issues it -- is correctly
// spaced against every other one.
if (typeof w.pacedCreateMember !== 'function') {
  throw new Error('blog-author-attribution.js requires wix-writers.js to export pacedCreateMember');
}

// wix: the Wix API client (wix-writers.js's createWixClient()).
// sourceAuthorId / sourceAuthorName: pulled straight from the source post's author reference
//   (e.g. WordPress `_embedded.author[0].id`/`.name`) -- null/undefined/'' means the source gave
//   no author for this post at all.
// crosswalk: an object exposing async get(sourceAuthorId) -> { memberId, loginEmail } | null,
//   such as `member-crosswalk.js`'s createProjectMemberCrosswalk({ projectDir, sourceSystem,
//   sourceEntityType: 'blog-author' }). Required whenever sourceAuthorId is present -- this is
//   what makes repeat resolution of the same author idempotent across resumed runs.
// siteId: folded into the placeholder email's domain (see buildPlaceholderAuthorEmail).
// ownerMemberId: the existing single-owner attribution fallback, used only when the source gives
//   no author info for this post.
async function resolveBlogAuthorMemberId(wix, {
  sourceAuthorId = null,
  sourceAuthorName = null,
  crosswalk = null,
  siteId = null,
  ownerMemberId = null,
  safeModeOptions,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (sourceAuthorId === null || sourceAuthorId === undefined || sourceAuthorId === '') {
    if (!ownerMemberId) {
      throw new Error('resolveBlogAuthorMemberId: post has no source author and no ownerMemberId fallback was supplied');
    }
    return { outcome: 'blog-author-owner-fallback', memberId: String(ownerMemberId), created: false };
  }
  if (!crosswalk || typeof crosswalk.get !== 'function') {
    throw new Error('resolveBlogAuthorMemberId: a post with a source author requires a crosswalk with an async get(sourceAuthorId) lookup');
  }

  const existing = await crosswalk.get(sourceAuthorId);
  if (existing && existing.memberId) {
    return { outcome: 'blog-author-reconciled-existing', memberId: String(existing.memberId), created: false };
  }

  const displayName = (sourceAuthorName && String(sourceAuthorName).trim()) || `Author ${sourceAuthorId}`;
  const loginEmail = buildPlaceholderAuthorEmail({ sourceAuthorId, siteId });

  const member = await w.pacedCreateMember(wix, { email: loginEmail, name: displayName }, safeModeOptions, sleep);
  // createMember only ever skips on an empty email (buildCreateMemberRequest's own guard);
  // buildPlaceholderAuthorEmail never produces one, so reaching `skipped` means a caller bypassed
  // it -- surfaced as an error rather than silently falling through to the owner.
  if (member && member.skipped) {
    throw new Error(`resolveBlogAuthorMemberId: member creation was skipped unexpectedly: ${member.reason}`);
  }
  if (!member || !member.id) {
    throw new Error('resolveBlogAuthorMemberId: Create Member returned no id');
  }
  return {
    outcome: 'blog-author-created',
    memberId: String(member.id),
    created: true,
    loginEmail,
    displayName,
  };
}

module.exports = {
  OUTCOMES,
  sanitizeForEmailToken,
  buildPlaceholderAuthorEmail,
  resolveBlogAuthorMemberId,
};
