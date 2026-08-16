# Spec: Wix Product Reviews and Blog Author Provisioning

## Status

Draft for implementation. No code changes are included in this spec.

## Problem statement

Two execution-time gaps are currently handled incorrectly:

1. Product reviews can currently fail with:
   `No verified native Wix product-review primitive was identified for this workflow`
2. Wix Blog import in public-only mode can currently stop at:
   `Wix Blog post import is marked IMPORT_UNRELIABLE, and original author identity is not available in public-only mode`

Both failures are too coarse.

- The first treats product reviews as if there is no usable native Wix target surface.
- The second treats missing original member identity as a hard stop, even though Wix Blog
  requires a `memberId` on draft-post create and RePlatform already has a native member
  create primitive.

## External facts to anchor the change

Verified from current official Wix docs on July 29, 2026:

- Wix Reviews has a native `Review` object and supports create/manage/retrieve for
  reviews of an entity such as a Stores product:
  <https://dev.wix.com/docs/api-reference/crm/community/feedback-moderation/reviews/reviews/review-object>
- Wix Blog `Create Draft Post` requires `memberId` for 3rd-party apps:
  <https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/list-draft-posts>

Verified live on August 2, 2026 (probe against the wporg-news migration's
API-provisioned Wix target site, "My Site 8"):

- Wix **auto-creates a user-member for the site owner** (and contributing Wix users) on
  API-provisioned sites — no Members-area interaction needed — and Create Draft Post
  accepts it from an API-key caller. So "attribute everything to the site owner" requires
  zero member provisioning. Resolution contract: find it via `GET /members/v1/members`
  (`fieldsets=FULL`) matching the owner's `loginEmail`; the probe's observed id equality
  (member id == account GUID) is a solo-account observation and undocumented — never
  construct the memberId from the account/user GUID. These auto user-members must never
  be deduped against source-site members.
- Post authorship is **re-assignable after publish**: `PATCH /blog/v3/draft-posts/{id}`
  with `{ draftPost: { memberId } }` followed by republish updates the published post's
  author (post id == draft id). Republish events are not suppressed by `saveType=IMPORT`,
  so author-reassignment passes must run inside the notification-mute window.

This means:

- product reviews are a native Wix target, even if our adapter does not yet expose a
  dedicated verified writer
- blog posts in third-party app flows must always resolve an author `memberId` before
  `POST /blog/v3/draft-posts`

## Goals

- Treat product reviews as a native Wix target with an unverified direct REST path, not
  as "no native primitive exists."
- Replace the current blog-author hard stop with deterministic fallback member
  provisioning for public-only runs.
- Keep the behavior explicit in product metadata so mapper, codegen, and execution all
  converge on the same rule.
- Preserve current safety posture around login identities and unverifiable source data.

## Non-goals

- Do not make original Wix Members login identity portable.
- Do not import source password hashes or original credentials.
- Do not claim verified-live support for Wix Reviews until a live write test exists.
- Do not solve all member dedup/merge policy in this change; this spec covers the minimal
  deterministic author-member path required for blog import.

## Desired behavior

### 1) Product reviews

When the source entity is specifically a product review:

- Mapping must classify it as a product-review subtype, not as a generic comment.
- The selected target must remain native Wix, using the Wix Reviews domain rather than a
  CMS fallback by default.
- If no dedicated writer exists yet, codegen/execution must use the existing direct REST
  native path pattern:
  - record the path as `unverified`
  - notify the RePlatform team that a dedicated writer is missing
  - surface the risk in the mapping and execution review artifacts
- The execution path must no longer raise the specific error
  `No verified native Wix product-review primitive was identified for this workflow`
  for this case.

### 2) Blog author provisioning

When importing blog posts and the source run is public-only:

- RePlatform must not require the original source author identity as a blocker for native
  Wix Blog import.
- Instead, it must deterministically provision or resolve a fallback Wix member and use
  that member as the post author.
- The member should be created before the first blog post that needs it, then reused for
  subsequent posts that resolve to the same fallback author strategy.
- The flow must continue to record the fidelity loss:
  original author identity is not preserved as a native Wix member identity in
  public-only mode.

## Author fallback model

### Terminology

- `original author`: the source-system person record if one exists
- `fallback author member`: the Wix member created or reused so Blog Draft Posts can be
  created in third-party mode
- `author attribution mode`: the strategy recorded in project artifacts for how blog
  authorship is being represented

### Default strategy

For public-only blog imports, use this default:

- Create one fallback Wix member per distinct source author when the source has stable
  public author data sufficient to derive a deterministic identity key.
- If the source author is not resolvable to a distinct stable public identity, create or
  reuse one project-level generic fallback author member.
- Alternative for the project-level case (verified live 2026-08-02): the site owner's
  auto-created user-member is a valid author and requires no provisioning at all —
  resolve it by `loginEmail` from the member list (never by deriving the id from the
  account GUID). Use it when the user prefers "posts authored by me" over a synthetic
  "Imported Author" appearing in the member list; record the choice as the
  `authorAttributionMode`.

Rationale:

- per-author fallback preserves more authorship structure when public data exists
- project-level fallback still allows import to proceed when only anonymous/public post
  content is available

### Deterministic identity key

The implementation should derive a stable fallback member key from best available public
  source data in this order:

1. source author id
2. source author slug
3. source author archive/profile URL
4. normalized display name
5. project-level constant `blog-author-fallback`

This key is for local crosswalk/idempotency. It is not exposed as user-facing content.

### Member create payload

The fallback member create path should continue to use the existing Members primitive and
safe-mode replacement behavior.

Preferred payload inputs:

- `loginEmail`: deterministic synthetic email derived from the fallback identity key
- `contact.firstName`: best available display name, else `Imported Author`
- `profile.nickname`: same best available display name
- `profile.slug`: derived stable slug from author key/display name

The synthetic email is acceptable here because:

- public-only mode lacks portable real login identity
- Wix member create requires a login identity
- the current product already supports synthetic safe-mode email patterns for native
  writes

### Reuse and idempotency

Before creating a fallback member, generated code should:

- consult local crosswalk state for an existing source-author -> member mapping
- optionally query Wix Members by the deterministic synthetic email when crosswalk state
  is absent or being rebuilt

After create/resolve:

- store the mapping in crosswalk state
- reuse the resolved `memberId` for all blog posts tied to that fallback author key

## Product metadata changes

### A. Add explicit Wix Reviews target knowledge

Introduce a domain/entity entry for product reviews owned by `rp-target-wix`.

Recommended shape:

- domain: likely `reviews` if a new domain is added, or another explicit target-owned
  location if the current taxonomy requires it
- entity: `product-review`
- classification: `native-plus-cms` or `native`
- native entity: `Review`
- preferred write: direct REST `POST` to the Wix Reviews surface, initially
  `verification: "docs"` or `verification: "unverified"` until live-tested
- reliability: should not claim reliable/native-verified yet
- pitfalls: relation/entity binding, moderation defaults, author/contact linkage, and any
  required namespace or verified-purchase semantics

The important contract is that product reviews must be discoverable as a native Wix
target so mapper/codegen stop treating them as a missing primitive.

### B. Update blog post target knowledge

Update blog post metadata to replace the current setup requirement wording:

- current: `Fallback member decision for author attribution.`
- intended: deterministic fallback member provisioning is part of the default runtime
  behavior for public-only/native blog import

The entity should still remain `IMPORT_UNRELIABLE` if slug preservation and other current
gaps still justify that flag.

### C. Keep members/member reliability conservative

Do not remove `IMPORT_UNRELIABLE` from site members globally. The new behavior does not
mean members become generally faithful imports. It only means a constrained synthetic
member path is acceptable for blog authorship enablement.

## Stage-by-stage changes

### 1) `rp-mapper`

- Disambiguate generic source `comment` into concrete subtypes:
  - blog comment
  - page comment
  - product review
  - custom content comment
- When subtype is product review, prefer the explicit native Reviews target.
- Record a faithfulness-ledger entry whenever the product-review path is still unverified.
- For blog posts in public-only mode, record:
  - native Blog target remains selected
  - author attribution mode uses fallback member provisioning
  - original author identity is not preserved

### 2) `rp-import-codegen`

- Generate a direct REST writer path for product reviews when no dedicated writer exists.
- Ensure generated execution-plan artifacts describe product reviews as native/unverified,
  not unsupported.
- Generate helper logic for fallback blog-author member resolution/provisioning before
  draft-post writes.
- Ensure blog posts depend on this member-resolution helper in the generated import order.

### 3) `rp-target-wix/lib/wix-writers.js`

- No new implementation is part of this spec, but the intended follow-up is:
  - either add a dedicated `createReview` primitive
  - or document the direct REST request shape and let codegen use `buildDirectRestRequest`
    until a dedicated writer is added
- Reuse existing `createMember` for fallback blog-author provisioning.
- If needed, add a narrow helper around member lookup/create to avoid duplicating author
  fallback logic in generated code.

### 4) `rp-execute-import`

- Product reviews should be executed as an unverified native path, not rejected as
  "no primitive."
- Blog posts should provision/resolve fallback author members during execution rather
  than halting on missing original identity in public-only mode.
- Completion and review artifacts must call out:
  - product-review native path remained unverified
  - blog authorship used synthetic fallback members where applicable

## Artifacts and reporting

The following user-facing statements must appear in generated review artifacts when
relevant:

- For product reviews:
  `Wix has a native Reviews entity for product reviews. This migration uses an unverified native write path pending dedicated adapter verification.`
- For blog authorship in public-only mode:
  `Blog posts will be authored by fallback Wix members created for import because third-party Wix Blog post creation requires memberId and original login identity is not available in public-only capture.`

Machine artifacts should also record:

- chosen `authorAttributionMode`
- fallback author key strategy
- whether authorship is per-source-author fallback or project-level fallback

## Acceptance criteria

1. A source entity classified as product review no longer produces
   `No verified native Wix product-review primitive was identified for this workflow`.
2. Mapping artifacts classify product reviews as a native Wix target and mark the path
   unverified until a live writer exists.
3. Public-only blog imports no longer stop because original author identity is missing.
4. Generated/imported blog posts always have a resolved `memberId` before
   `POST /blog/v3/draft-posts`.
5. Fallback author members are reused deterministically across reruns via local state.
6. Review artifacts clearly disclose that blog author identity is represented by fallback
   members rather than original portable identities.
7. Existing reliability warnings for general member import are preserved unless separately
   re-evaluated.

## Risks and open questions

1. Wix Reviews request shape still needs product-specific live verification:
   - required namespace, if any
   - whether author is expressed as contact, member, or another actor shape
   - moderation defaults on create
   - whether verified-purchase state is writable or derived
2. Member dedup policy needs care if a later authenticated run provides real users that
   overlap with previously-created fallback members. The re-attribution mechanics are now
   verified (2026-08-02): the authenticated re-run provisions/resolves the real per-author
   members, then for each fallback-attributed post PATCHes the draft `memberId` and
   republishes — the crosswalk must therefore record `authorAttributionMode` (and the
   author key) per post so the upgrade pass knows which posts to re-author. Remaining
   policy questions: when to delete the now-orphaned fallback members (delete works —
   `DELETE /members/v1/members/{id}` verified — but their auto-created contacts may
   linger), and republish-event exposure (not IMPORT-suppressed; mute window required).
3. Synthetic fallback members may appear in the site's member list; that is acceptable
   for this migration path but should be disclosed in review artifacts.
4. Some sources expose author display text per post but no stable author identity; those
   should fall back to the project-level generic member unless a deterministic per-author
   key can be justified from public data.

## Suggested implementation order

1. Add product metadata/domain knowledge for Wix Reviews product-review targeting.
2. Update mapper subtype routing and faithfulness-ledger text.
3. Update codegen/execution planning so product reviews use native-unverified direct REST.
4. Add fallback blog-author member resolution/provisioning helper around existing member
   create primitive.
5. Update execution and review artifact text.
6. Add contract tests for:
   - product review classification and execution-plan wording
   - public-only blog post imports resolving a fallback member id

