---
name: rp-target-wix
description: >-
  Wix target adapter with verified write primitives, shared execution runtimes, and contract tests.
  Use when vendoring Wix writers, validating API shapes, or Wix provisioning mechanics.
---

# rp-target-wix

Wix **target adapter**. Owns the Wix-side write surface and shared execution runtime that every migration shares —
verified once here so the platform-agnostic stages and per-project codegen never
re-derive (and re-break) it. This is the symmetric counterpart to `rp-source-wordpress`:
that adapter owns *reading* a source platform; this one owns *writing* to Wix.

## Verified variant inventory import

`lib/stores-inventory.js` exports `inventoryForVariant`, `resolveInventoryLocation`, and
`reconcileInventory(wix, rows, {expectedCount, gaps, locationId?})`. Rows carry resolved
`productId`, `variantId`, and `inventory: {inStock:boolean}` OR `{quantity:integer}`.
`expectedCount` must equal rows plus named source gaps. Bulk writes follow complete location-
scoped reads; existing items reconcile or update by revision, then values and availability
are read back. Failure remains partial and the next invocation re-reads before writing.
The existing single-create inventory helpers remain available for narrow probes; imports
use the bulk reconciliation path. `trackQuantity` is derived and must never be sent.
Read `domains/stores/entities/inventory-item.json` and the setup inventory-probe contract.

## When this skill is used

Not a stage in the flow — a reference + shared library consulted by:

- **`rp-import-codegen`** vendors `lib/wix-writers.js` into the project (like the
  `wp-http` transport) plus the shared write/setup runtime modules, and generates thin
  project-specific write specs/transforms that **call these primitives/runtime APIs**.
  Codegen does not re-emit Wix API plumbing.
- **`rp-setup-discovery` / `rp-execute-setup`** consult the "Verified endpoints" and
  "Provisioning" notes for app-install / Wix-Data / collection mechanics.

Because the Wix surface is identical across source platforms, adding a new source
(`rp-source-shopify`, …) requires **no change here**.

## Shared runtime boundary

This adapter owns the **shared Wix layer** written once for all migrations.

It should own:

- verified request builders and endpoint primitives
- shared Wix client/auth handling
- shared retry and throttling policy
- generic write execution runtime
- generic setup execution/runtime behavior
- checkpoint helpers
- local crosswalk helpers (`state/crosswalk/crosswalk.ndjson` authority, append-only
  attempt journal, optional CMS mirror seed/upload adapters)
- URL preservation helpers (`state/url-preservation/` base paths, ledger, planned
  redirects, and unresolved route rows)
- NDJSON record-stream I/O (`lib/ndjson.js`): streaming read/write, batching by count and by
  cost, cursoring, and append-only producers. Migration data files are record streams, so the
  scan/batch/cursor primitives live here once instead of being re-derived by codegen.
- audit log emission
- compact execution report generation
- contract tests for stable request/runtime behavior

Per-migration code generation should own only:

- field maps
- transforms
- write specs
- setup-plan renderings
- entity ordering
- dependency wiring — populate `WriteSpec.dependencyRefs` from each in-scope entity's
  domain-knowledge `dependsOn` field (spec 0041), not re-derived per project

## Write contract (the verified Wix surface)

`lib/wix-writers.js` exposes pure request builders (`build*Request`) + executors. Shapes
marked **VERIFIED** were validated by a real call against a live site, not just read from
docs. Shapes marked **UNVERIFIED** are docs-schema/MCP-derived bootstrap primitives that
must be surfaced in execution plans until a live contract call promotes them. It also
exports `sendDirectRest` and `notifyMissingWriter` for generated native REST paths when
Wix has a native entity but this adapter does not yet ship a dedicated primitive.

This resource should also expose shared execution-runtime modules above those primitives,
so generated migrations use one common path for retries, throttling, checkpointing,
reporting, and audit logging.

**Read/return contract for `query*` executors.** Every `query*` executor
(`queryStoresProducts`, `queryStoresCategories`, `queryContacts`, `queryCoupons`,
`queryOrders`) **unwraps the response to the entity array and returns one page**, discarding
`pagingMetadata`. Two failure modes follow, both of which have shipped:

- **The return value IS the array.** Reading `.products` / `.categories` off it a second time
  gives `undefined` → `[]`. A dedupe index or existing-entity safety net then comes back
  empty *without erroring*, which is indistinguishable from a fresh site — so the import
  duplicates what is already there, and a setup verification reports 0 categories on a site
  with 25.
- **These executors cannot be cursor-paged**, because the cursor is in the metadata they
  discarded. Use a `queryAll*` primitive where one exists — `queryAllStoresCategories`,
  `queryAllStoresProducts`, `queryAllDataItems` — otherwise send
  `wix.send(build<X>Request(body))` and read `pagingMetadata.cursors.next` off the raw
  response.

Every sweep used for dedupe must **throw on a partial result rather than return it**. "Empty
net" and "empty store" look identical to the caller, and the caller assumes the second.

## Domain entity suitability knowledge

Target entity suitability lives in `domains/`, not in a large prose table in this skill.
Use the deterministic reader as the normal access path:

```bash
node scripts/domain-knowledge.js list-domains
node scripts/domain-knowledge.js list-entities --domain stores
node scripts/domain-knowledge.js read-entity --ref stores/product
node scripts/domain-knowledge.js resolve-source --source-system woocommerce --source-entity product
node scripts/domain-knowledge.js resolve-source --route /wc/v3/products
node scripts/domain-knowledge.js list-flagged --flag IMPORT_UNRELIABLE
node scripts/domain-knowledge.js summarize-entities --refs stores/product,ecom/order
```

`domains/index.json` is generated from domain/entity files and checked in. After editing
domain knowledge, run:

```bash
node scripts/domain-knowledge-validate.js --write-index
```

**Authoring or editing any entity file also requires the spec 0041 dependency check**, both
directions: (1) what does *this* entity need to already exist and be crosswalked — record it in
`dependsOn: string[]` (a `domain/entity` ref array; empty is a real, reviewed answer, not the same
as the field being absent); (2) does this entity change what an *already-written* entity's
`dependsOn` should say (e.g. authoring `gift-cards/gift-card` should have prompted revisiting
`ecom/order.json` — it hadn't, until spec 0042 caught it by hand). `domain-knowledge-validate.js`
checks `dependsOn` refs resolve and the whole graph stays acyclic whenever the field is present, but
it is not yet required on every entity — `node scripts/domain-knowledge-validate.js
--list-missing-deps` prints the live backlog of entities that have never had it authored at all;
that command is the source of truth, not a hand-maintained list.

`domains/SERVICE-PLUGINS.md` covers the escalation ladder for a source capability with no native
Wix primitive: **native primitive first, always**, then a Wix **service plugin** (Wix calls an
endpoint we host and we answer per request), and only then a recorded gap. It carries the cost list,
a worked example — bounded quantity discount bands, implemented live 2026-08-31 — and a catalog of
all 25 service plugins with per-plugin migration relevance. Read it before writing "Wix cannot
express this" into a gap report.

`writerId` values in entity files must match exported functions from `lib/wix-writers.js`;
use `null` for direct REST plans, setup/manual work, or unsupported native gaps.

Entity files may also expose `fieldContracts[]` for verified nested write paths. These
are machine-readable contracts for codegen and dry-run validators, not replacements for
the human notes below. For Stores products, `domains/stores/entities/product.json`
records the verified Catalog V3 create contract for `product.subscriptionDetails`,
including required nested paths, allowed recurrence values, read-back behavior, and the
live-validated `subscriptions[].description <= 60` constraint. Generated transforms
should consume that metadata through the vendored `wix-writers.js` exports instead of
copying limits into project-local code.

Live verification helpers must not edit `domains/` directly. When a probe changes a
target write assumption, emit a proposal artifact and let the orchestrator promote it
deliberately:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores subscription-create \
  --artifact migrations/<project>/setup/stores-subscription-verification.json \
  --proposal-artifact migrations/<project>/setup/contract-ledger-proposal.json
```

Use `lib/contract-ledger.js` to validate the handoff: a passed verification without a
proposal is incomplete, and a proposal that is neither promoted into `fieldContracts[]`
nor explicitly deferred is stale product knowledge. Codegen should consume
`fieldContracts[]` through `scripts/domain-knowledge.js summarize-entities`, which
includes promoted contracts.

### Dual product descriptions

When a canonical product contains both `shortDescription` and `description`,
`lib/wix-build.js` writes one Stores `plainDescription`: short body, `<hr />`, then long
body. HTML-empty bodies and normalized, case-insensitive `lorem ipsum…` filler are
treated as empty independently, so a real companion body remains. The horizontal-rule
serialization is unverified in a live Wix storefront: canary it and capture a Hebrew/RTL
screenshot before any bulk import or remediation backfill.

| Capability | Endpoint | Notes / traps |
| --- | --- | --- |
| HTML → rich content | `POST /ricos/v1/ricos-document/convert/to-ricos` | VERIFIED. `options.plugins` enum is **UPPERCASE** — the docs example shows lowercase and 400s. |
| Import media from URL | `POST /site-media/v1/files/import` | VERIFIED. **Async**: response is `PENDING`; poll `GET /site-media/v1/files/{id}` for `READY` before referencing. |
| Blog category | `POST /blog/v3/categories` | VERIFIED. body `{ category: { label, slug, description } }`. |
| Blog tag | `POST /blog/v3/tags` | VERIFIED. Body is **top-level `{ label, language }`** — NOT `{ tag: { label, slug } }`; slug is derived. |
| Blog post | `POST /blog/v3/draft-posts` → `…/{id}/publish` | VERIFIED. `memberId` **required** (3rd-party). VERIFIED (2026-08-02): the **site owner's auto-created user-member** satisfies it — it was already present on our API-provisioned test site with zero Members-area interaction (single-site observation), so attribute-to-owner needs no member provisioning. **Resolve it via `listMembers` + `loginEmail` match — never derive it from the account/user GUID** (the observed id equality is n=1 on a solo account, undocumented). Also VERIFIED (2026-08-02): author is **re-assignable after publish** — `PATCH /blog/v3/draft-posts/{id}` `{ draftPost: { memberId } }` then republish updates the published post's author (post id == draft id; republish fires non-suppressed events — do author-upgrade passes inside the notification-mute window). Visible custom cover media requires **both** `heroImage.id` and `media: { displayed:true, custom:true, wixMedia:{ image:{ id }}}`. `heroImage.id` alone leaves the cover hidden. |
| Blog posts (bulk) | `POST /blog/v3/bulk/draft-posts/create` | UNVERIFIED bootstrap (public docs + wix/skills `wix-manage` recipe, 2026-07-21). Max **20 posts/call**; `bulkCreateDraftPosts` chunks larger inputs. Prefer over per-post creates for N ≥ 2 (single create runs ~25–30s/call per the recipe). Publish is still per-post — a bulk `publish` flag is unverified. Surface in the execution plan until the live contract call promotes it. |
| CMS item | `POST /wix-data/v2/items` | VERIFIED. `{ dataCollectionId, dataItem: { data } }`. Requires Wix Data enabled (else `WDE0110`). |
| Members | `GET`/`POST /members/v1/members` | VERIFIED. dedup by `loginEmail` (gated PII; use a fallback member when absent). VERIFIED (2026-08-02, single-site observation): the target-site member list can already contain **auto-created user-members** for the owner/contributing Wix users (`status: APPROVED`; resolve by `loginEmail`, never by deriving from the account GUID — the observed id equality is undocumented) — never dedupe or count these against source-site members; `DELETE /members/v1/members/{id}` works for cleaning up importer-created members. Throughput: **no bulk create; documented ≥1s spacing** (10k ≈ 3h serial floor — plan + resume via crosswalk). Create sends **no email** and does **not** fire the signup automations trigger (source-confirmed) — silent by default. **Activation policy (decided 2026-08-03): passwords are never imported, and passwordless members complete the standard forgot-password flow (confirmed).** Delivery = post-import **label-wave automation**: owner creates one dashboard automation (trigger `label added`, e.g. `migrated-2026` → owner-branded email: "Log in → Forgot password"); importer applies the label via API in batches for rate control/re-targeting; enable only after the import window (AUTO-02 pause). **Never mass-send** `send-set-password-email` (3h single-use link), and never fetch/store per-member reset links — they are credential-equivalent secrets and the no-link flow needs none. |
| Stores product (BULK — the scale path) | `POST /stores/v3/bulk/products-with-inventory/create` | UNVERIFIED bootstrap. **Use this, not per-product creates, for any catalog above a handful** — 1000 products is 11 calls instead of 1000. Creates up to 100 products with inline options, inline brand/ribbon/infoSections, all variants AND per-variant inventory items in one request. **Five caps apply simultaneously and exceeding ANY ONE rejects the whole request:** products ≤100, `variantsInfo.variants` ≤1000 total, `options` ≤100 total, `modifiers` ≤100 total, `infoSections` ≤100 total. With 2 options per product the options cap binds at **50** products, not 100 — so batch with `lib/ndjson.js` → `readBatchesByLimits` using the exported `BULK_PRODUCT_LIMITS` + `storesProductBulkCost`, never on record count alone. **TRAP: bulk is NOT atomic** — a `200` can carry per-item failures in `results[].itemMetadata.success`; never infer success from the HTTP status. **TRAP: correlate results by `itemMetadata.originalIndex`**, not response position. **TRAP: `bulkActionMetadata.undetailedFailures`** counts failures whose detail the server dropped; ignoring it silently loses records. `returnEntity:false` (default) still returns `itemMetadata.id`, which is all a crosswalk needs — pass `true` only for a contract probe that must inspect the created entity. `bulkCreateStoresProductsWithInventory` handles normalization, correlation and the unaccounted-item check, returning `{ results, succeeded, failed, undetailedFailures, unaccounted }`. Normalization is purely local — HTML descriptions travel as `plainDescription` for Wix to convert server-side — so a batch is **one** HTTP call. It used to convert one description per product first, which made a 100-product batch 101 calls and reliably tripped the Ricos endpoint's 403 throttle. |
| Stores product | `POST /stores/v3/products`, `POST /stores/v3/products/query`, `PATCH /stores/v3/products/{id}`, `GET /stores/v3/products/{id}`, `GET /stores/v3/products/slug/{slug}` | VERIFIED (2026-07-05; media patch verified in migration-20260715-01). `buildCreateStoresProductRequest` runs `normalizeStoresProductV3`, which bakes in the create traps: PHYSICAL requires `physicalProperties:{}`; simple/V1-ish top-level `price`, `sku`, and physical properties are moved into a single V3 variant; option/variant choice names clamped to 50 (identical truncation both places); variant `optionChoiceNames.renderType` defaulted to `TEXT_CHOICES`; `compareAtPrice` dropped unless strictly > `actualPrice`; variant `price` must be a **money object** (`{ actualPrice: { amount: "14.95" } }`) — a bare string/number 400s "Expected an object" (verified 2026-07-19), so the normalizer coerces scalar prices. **Descriptions:** a string `description` is HTML and is moved to **`plainDescription`** by `normalizeStoresProductV3`; Wix converts that to rich content server-side, so the product path never calls the Ricos endpoint (`description` proper is a Ricos document *object* — HTML there is a type error). **TRAP: `plainDescription` is silently ignored when `description` is also set** — a 200 with an empty description — so the normalizer throws when both are present. **TRAP: hard cap of 16,000 characters** (the old Ricos path chunked at 28k and merged, so it was effectively unbounded); over-long bodies throw rather than truncate, and need an info section or an explicit `mapping-gaps.json` entry. For product media, prefer `media.itemsInfo.items[]` with external `url` values when the source URLs are publicly reachable: the Stores product API ingests them in the background, avoiding the slower, heavily-throttled Media Manager pre-import path. Use pre-imported Wix media ids only when the target flow requires them. **Upsert lookups:** `getStoresProduct(wix, id)` and `getStoresProductBySlug(wix, slug)` return the product or throw 404 — callers should catch and treat as `null` for "not found". **Catalog sweeps:** `queryStoresProducts` returns **one page** unwrapped to the array with the cursor discarded, so a crosswalk-recovery or name-match safety net must use **`queryAllStoresProducts(wix)`**, which follows the cursor and throws rather than returning a partial index. **Slugs:** sanitizing is owned by `lib/wix-build.js` (`toWixSlug`, applied automatically via the `coerce: 'slug'` rule on `product.slug`), not by this module and deliberately not by `normalizeStoresProductV3` — the writer passes the caller's slug through unchanged so URL preservation can record the original next to the derived `plannedTargetSlug`. It matters because Wix rejects anything outside `[a-z0-9-]` and slug validation precedes application, so one bad slug (Shopify mints `ph-5_5` from a "pH 5.5" title) 400s the entire bulk batch rather than just that product. **General patch:** `patchStoresProduct(wix, { productId, revision, ...fields })` applies `normalizeStoresProductV3`, so a string `description` moves to `plainDescription` here too; `revision` from the existing product is required. UNVERIFIED for get-by-id, get-by-slug, and general-field patch (endpoint VERIFIED; arbitrary-field patching and slug lookup not yet live-tested). **Variable products / variant matrices:** Wix Stores V3 requires server-assigned `optionChoiceId` GUIDs before a variant matrix can be built — those IDs do not exist until after the initial `createStoresProduct` call returns. A single-pass import therefore cannot create a full variant matrix in one call. The two-pass approach: (1) create the product with options declared (but no variants), (2) create each option choice via `POST /stores/v3/products/{id}/options/{optionId}/choices` to obtain server-assigned choice IDs, (3) create variants via `POST /stores/v3/products/{id}/variants`. When the two-pass flow is out of scope (e.g. public-data single-pass run), import as a single-variant product at the base price, record the fidelity loss in `mapping-gaps.json`, surface it in the execution-plan report, and ensure the generated product detail page renders `productOptions` when non-empty so the storefront is ready once options are added. |
| Stores category | `POST /categories/v1/categories`, `POST /categories/v1/categories/query` | VERIFIED (2026-07-05) for create. Body `{ category, treeReference }` — `treeReference` is **top-level** (sibling of `category`, `{appNamespace:"@wix/stores"}`); nesting it 400s "treeReference must not be empty". Empty optional strings such as `description: ""` are omitted. **Query:** same top-level `treeReference` trap applies. `queryStoresCategories(wix)` returns **one page (100 max)** unwrapped to the array — it does **not** return all categories, and the unwrap discards the cursor so it cannot be paged. Any dedupe/upsert index must use **`queryAllStoresCategories(wix)`**, which follows `pagingMetadata.cursors.next` and throws rather than returning a partial index. Observed 2026-07-29: a site with 119 categories read back as 100 through the single-page call, which would have duplicated the missing 19. UNVERIFIED for query (not yet live-tested). |
| Wix Tag (global) | `POST /tags/v1/tags` | UNVERIFIED bootstrap. Body `{ tag: { name, fqdn } }`. FQDN for Stores V3 products: `"wix.stores.catalog.v3.product"`. Max 100 tags per FQDN. Create tags before products; crosswalk tag IDs into product `tags.publicTags.tagIds[]` at create time. Tags are a native Wix entity — do not route product tags to CMS. |
| Stores inventory | `POST /stores/v3/inventory-items`, `POST /stores/v3/bulk/inventory-items/create`, `POST /stores/v3/bulk/inventory-items/update` | VERIFIED LIVE for single create, bulk create/update, Inventory and default-location Catalog read-back. Imports use `reconcileInventory` with the full expected variant count; persist its report and complete the inventory checkpoint only when `status:complete` and `complete:true`. No-data remains distinct. `buildCreateInventoryItemRequest` requires exactly one explicit `inStock` boolean or `quantity` integer; omitting both now throws instead of sending an unspecified stock policy. `trackQuantity` is validated for compatibility but omitted from requests because it is read-only. |
| Stores category membership | `POST /categories/v1/bulk/categories/add-item` | VERIFIED (2026-07-05). `{ item:{ catalogItemId, appId }, categoryIds[], treeReference }`; `appId` = Wix Stores `215238eb-…`, `catalogItemId` = Wix product id. |
| Contacts | `POST /contacts/v5/contacts`, `POST /contacts/v5/bulk/contacts/upsert`, `POST /contacts/v5/contacts/query`, `GET /contacts/v5/contacts/{id}`, `PATCH /contacts/v5/contacts/{id}` | **GA** (docs verified 2026-08-04 — was Developer Preview when selected on 2026-07-26). Do not fall back to V4 unless a migration explicitly chooses a legacy compatibility path. **The GA contact shape is FLAT** — no `info` wrapper, no `emails.items`/`phones.items` list wrappers: one main `email`/`phone` (contact matching + subscription status live on these) plus `additionalEmails`/`additionalPhones` arrays; `addresses[]` keeps postal fields **nested under `address`**; `company` is `{ name, jobTitle }`. Create and update both take `{ contact, allowDuplicates }`; update requires the current `revision` and has **no fieldMask**. Phone tags: `OTHER`/`MAIN`/`HOME`/`MOBILE`/`WORK`/`FAX` (no `UNTAGGED`). `buildCreateContactRequest`/`buildUpdateContactRequest` accept the flat GA `contact` (legacy `info` payloads convert strictly — non-mechanical keys like `extendedFields`/`labelKeys` throw). Live create/query/update verification is still pending a token with Contacts permissions (2026-07-26 probe got `403`) — keep V5 writers surfaced as UNVERIFIED in execution reports until a live contract test promotes them. **Custom fields (GA):** the V5 contact carries `extendedFields.namespaces.<ns>`; per the V5 contact-object docs, definitions go through the **Data Extension Schema API with FQDN `wix.contacts.*.contact`** (user-defined values under `_user_fields`). The V4 Contacts Extended Fields API (`POST /contacts/v4/extended-fields`, values under `info.extendedFields`) pairs with the V4 surface only — do not mix. CAVEAT: the Data Extension Schema intro's supported-objects table does not list contacts yet (docs inconsistency at GA cutover); verify the DES path live during setup before relying on it. **Labels → tags:** V5 exposes `tags.privateTags.tagIds[]` managed via the Tags API (same FQDN); V4 label APIs and the `labels_added` automation trigger are a V4-surface concept — resolve the tag/label story during setup before planning post-import label waves through V5 writers. |
| Coupons | `POST /stores/v2/coupons`, `POST /stores/v2/coupons/query`, `DELETE /stores/v2/coupons/{id}` | `createCoupon` VERIFIED LIVE (stores/coupon entity, multi-thousand import). **Contract:** use `ensureCoupon({ specification })` — Query Coupons by exact `specification.code` (paced, retried; the write is not readable immediately), zero matches creates, one reconciles, more is ambiguous and creates nothing. The specification comes from `rp-source-wordpress/lib/coupon-discovery.js` `mapCouponToWix`; never hand-roll it (epoch-ms times, explicit `appliesToSubscriptions`, exhausted codes `active: false`). |
| Members | `POST /members/v1/members`, `POST /members/v1/members/query`, `GET /members/v1/members/{id}`, `POST /contacts/v5/contacts/query` | Create VERIFIED LIVE. **Contract:** `ensureMember({ loginEmail, contact, knownMemberId })` (`customer-member.js` builds `contact` from a source customer — `buildMemberContact`, phone via `normalizePhoneE164`, never sent un-converted: Create Member 400s on anything not already E.164). Reconciles by a crosswalk row read back and verified (`member-crosswalk-row-stale` if not), else Query Members by `loginEmail` (one match reconciles, more is ambiguous); before every create that carries a phone, Contacts V5 is queried by that phone and it is DROPPED (`member-phone-collision-dropped`) on a match — Create Member reuses an existing contact with a matching phone even from a DELETED member, and two different customers would otherwise merge into one Wix identity. Persist `loginEmail` on the crosswalk row (`lib/member-crosswalk.js`) or `resolveOrderBuyer` (spec 0130) cannot link anything. Create Member ≥1s apart (documented floor). |
| Pricing plans | `POST /pricing-plans/v3/plans`, `POST /pricing-plans/v3/plans/query`, `POST /pricing-plans/v2/plans/{id}/archive` | Create VERIFIED LIVE 2026-08-16 (pricing-plans/plan entity). **Contract:** `ensurePlanDefinition({ plan, idempotencyKey, knownPlanId })` — the reconciliation IDENTITY is the client-minted `pricingVariants[].id` (offer-derived, preserved by Wix), never the name (names are cut to 50 chars and collide). A `knownPlanId` is read back (`GET /pricing-plans/v3/plans/{id}`) and adopted only if it exists, is not archived and carries our variant id, else `plan-crosswalk-row-stale`; then Query Plans by name, filtered to plans carrying our variant id (one reconciles, more is ambiguous, a merchant's same-named plan is ignored); then Create Plan ≥1s apart with `idempotencyKey` in the BODY beside `plan` (a header is ignored). An adopted plan that is ours but no longer inert is reported (`plan-reconciled-not-inert`), not archived. The body comes from `lib/pricing-plan-definition.js` `buildPlanDefinition` and is REFUSED unless `visibility: PRIVATE` and `buyable: false`; the CREATED plan is checked too and archived at once if it came back purchasable (`plan-failed`, cause `created-plan-not-inert`, `archived: true|false` — a FAILED archive is reported as such with `archiveError`, and `tallyPlanWriteOutcomes` counts it on `plans-live-hazard`, which blocks the report). `status: ACTIVE` is required though undocumented. Archive is the V2 call; V3 has none. |
| eCom order | **`POST /ecom/v1/orders/import`** (historical orders), `POST /ecom/v1/orders/query`, `POST /ecom/v1/orders/{orderId}/activities/add` | **VERIFIED LIVE** (2026-08-12 reference-store run; re-verified 2026-08-16 with applied discounts, line-item description lines and merchant notes). Import Order is the only import-safe path — see `ecom/order.json`. **Caller-supplied `id` VERIFIED LIVE 2026-09-05:** a never-seen GUID is accepted and kept; a re-send with an existing id silently REPLACES the whole body (attached payments and extendedFields survive); a non-GUID is a 400. `lib/order-history.js` derives the id from the source — do not pick one, and never re-send an existing order. **`POST /ecom/v1/orders` (createOrder) remains BLOCKED for migration**: it decrements inventory, emails the buyer and auto-creates contacts. TRAP: `order.number` must be numeric — a prefixed source number fails the whole call with a bare `400 {"message":"Not a numeric value"}` and no field path. |
| Site notifications mute | `POST /notification-preferences/v1/site-mute/mute`, `POST /notification-preferences/v1/site-mute/unmute`, `GET /notification-preferences/v1/site-mute` | VERIFIED (2026-08-04, full cycle live on a test target: mute → state read → idempotent re-mute → unmute → state restored, all 200). Spec 0012. Mutes **all** notifications of the site in context — all recipients, all channels; sendability denied regardless of recipient-level preferences. All three calls return `{ siteMuteState: { muted, reason?, mutedBy: { wixUserId } } }`; executors unwrap to `siteMuteState`. Mute body `{ reason?: string }` (≤500, clamped by the builder) — always pass a project-identifying reason (`RePlatform migration — <project>`) so the mute is auditable. **TRAP: re-mute overwrites `reason`** (last caller wins) — the import preflight's idempotent re-call must pass the same reason as setup. **AUTH TRAP: user tokens only** — the CLI-minted `OauthNG` site token (`WIX_AUTH_TOKEN` from `config/wix.env`) works; an account API key gets a uniform empty-body 403 on all three endpoints. Hard invariant: when mute is in effect (always for `WIX_SITE_STRATEGY=new`; explicit opt-in for existing sites), a failed mute halts the run before any import write — no degraded mode. `unmuteSiteNotifications` is **never called by the flow itself** — explicit owner request only; after an on-request unmute, confirm `muted: false` via `getSiteMuteState`. |
| Direct native REST | any Wix REST path derived by codegen | UNVERIFIED generated path for native Wix entities missing a dedicated adapter writer. Must log, call `notifyMissingWriter`, and be shown in the execution plan. |

## Safe-mode contact replacement

`lib/wix-writers.js` exports the shared safe-mode runtime:

```js
createSafeModeConfig(env)
mockEmailForEntity(entityType, entityId)
sanitizeContactFieldsForSafeMode(value, options)
sanitizeWixRequestBody(body, options)
```

Generated imports must pass `safeModeOptions` to writer builders/executors when
`SAFE_MODE` is enabled. Request builders sanitize a copied request body before returning
it and throw `SafeModeBlockedError` before any send when suspicious non-replaced email
values remain.

Safe-mode replacement paths use deterministic request-body paths with object fields,
array wildcards, and Wix wrapper arrays, for example:

```text
contact.email.email
contact.additionalEmails[].email
contact.phone.phone
order.billingInfo.email
dataItem.data.submissions[].email
```

Replacement only touches primitive leaf values — a generic path that lands on an object
(such as the GA Contacts V5 `email` object) is skipped rather than clobbered, and any raw
email left inside a skipped object still trips the suspicious-value block.

Target domain entity files may define `safeModeContactFields[]` with `{ kind, targetPath,
source, notes }` entries. Mapper/codegen must merge those target hints with source-side
contact evidence and user mappings, then pass resolved request-body paths to the shared
writers.

### Stores subscription validation

`lib/wix-writers.js` exports the Stores subscription contract and deterministic helpers:

- `STORES_SUBSCRIPTION_CONTRACT`
- `normalizeStoresProductSubscriptions`
- `validateStoresProductSubscriptionDetails`

Generated import code should call the normalizer from product transforms and the
validator during dry-run and immediately before live create. Validation failures are
record-level preflight failures/deferred outcomes; do not send known-invalid
subscription payloads to Wix to discover field errors live.

Catalog V3 subscriptions are a native Stores target, not an automatic CMS fallback or
semantic loss. Product create with `subscriptionDetails.allowOneTimePurchases` and
`subscriptions[]` entries containing `title`, `description`, `frequency`, `interval`, and
`autoRenewal` was verified live on 2026-07-26 in the nopong migration; Wix returned
server-assigned subscription option ids. Mapping/codegen should emit native recurring product
creates when the source cadence is known. General subscription patching remains unverified.

### Stores live verification helpers

Use the shared Stores verification CLI for live target checks that would otherwise become
migration-local snippets:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores subscription-create \
  --artifact migrations/<project>/setup/stores-subscription-verification.json \
  --proposal-artifact migrations/<project>/setup/contract-ledger-proposal.json
node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores product-count \
  --artifact migrations/<project>/execution/stores-product-count-verification.json
node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores product-by-source-marker \
  --marker-path customFields.sourceId --marker-value <source-id> \
  --artifact migrations/<project>/execution/stores-product-marker-verification.json
node skills/wix-replatform/resources/rp-target-wix/scripts/verify-stores.js stores delete-probe \
  --product-id <probe-product-id> \
  --artifact migrations/<project>/setup/stores-probe-cleanup.json
```

The CLI reads `WIX_AUTH_TOKEN` and `WIX_SITE_ID` from the environment or
`config/wix.env` under the current project root, creates the shared Wix client, and sends
requests through `wix.send(...)`. It writes machine-readable artifacts with the target
site id, endpoint, method, verified nested paths, discovered constraints, probe id,
cleanup status, warnings, recovery instructions, and timestamp. Failed probe cleanup is
not hidden: the artifact must remain with an explicit warning and a `delete-probe`
recovery command.

## Routed URL preservation behavior

URL preservation is a mapping and execution-state concern. This adapter owns only the
Wix-side facts that generated code may rely on when deciding whether a final target URL is
known.

Current import-only phase rules:

- Do not configure Wix redirects or site routing.
- Do not guess a destination relative URL from a slug when Wix route behavior has not been
  verified for that entity and delivery mode.
- When the destination base path or final URL is unknown, write URL ledger rows with
  `urlStatus: "pending_target_route"` or `target_url_missing` and record unresolved rows
  for the future website-builder phase.
- When a Wix create/update response or a safe declared lookup returns a final slug or
  relative path, generated code may record it as `actualTargetSlug` or
  `actualTargetRelativeUrl` and write a redirect plan if it differs from the source URL.

Known routed entity status:

| Entity | URL behavior contract |
| --- | --- |
| Blog posts | Create/publish is verified for content writes. Final public route exposure after publish is not verified here; generated code must treat the target route as `pending_target_route` unless a safe lookup in the generated write spec proves the final relative URL. |
| Blog categories | Category create is verified. Final public category route exposure is not verified here; default to `pending_target_route`. |
| Stores products | Product create and slug-bearing product operations are verified, but arbitrary route/base-path configuration is not part of this phase. Generated code may record actual target slugs only when returned or safely looked up; target relative URLs remain `pending_target_route` unless the route pattern is explicitly verified in the project. |
| Stores categories/collections | Category create is verified. Final collection/category route exposure is not verified here; default to `pending_target_route`. |
| CMS items with dynamic pages | CMS item writes are verified. Dynamic page route patterns are site-builder configuration, not native item import output; default to `pending_target_route` unless website-builder artifacts define the route. |

## Shared execution runtime contract

In addition to endpoint primitives, this adapter should define the reusable runtime API
that generated migrations call.

Conceptual contracts:

```ts
executeWriteSpec({
  spec,
  items,
  client,
  dryRun,
  runContext,
}): Promise<WriteExecutionReport>

executeSetupPlan({
  plan,
  client,
  dryRun,
  runContext,
}): Promise<SetupExecutionReport>
```

The exact filenames are implementation details, but the shared runtime should be the
single place that owns generic Wix execution mechanics.

### `WriteSpec` contract

Generated migrations should pass a declarative `WriteSpec` into the shared runtime.

Each spec should define, as applicable:

- `entity`
- `mode`: `create | update | upsert | bulk_create | bulk_upsert`
- `create`
- `update`
- `lookup`
- `bulk`
- `batchSize`
- `concurrency`
- `retryPolicy`
- `throttlePolicy`
- `auditKeys`
- `crosswalkAuthority: "local"`
- `cmsMirror`
- `crosswalkStrategy`
- `reconciliationStrategy`
- `dependencyRefs`
- `verificationLevel`: `verified | unverified`

This resource should document how each field is interpreted by the runtime.

### `WriteExecutionReport` contract

The shared runtime should return a compact, token-aware report suitable for the agent.

It should include:

- run ID
- entity
- counts: input, attempted, created, updated, skipped, failed, retried, throttled
- grouped error buckets
- references to fuller on-disk logs

The runtime should prefer grouped summaries over raw per-record detail.

These per-entity or per-phase reports are intermediate runtime outputs. They are inputs to
the final completion artifact, not replacements for it.

### Completion artifact contract

The shared runtime should support deterministic emission of a final machine-readable
completion artifact for the whole run.

Preferred output:

- `execution/completion-report.json`

This artifact should be the authoritative source for:

- final run status
- final imported/updated/skipped/failed counts
- separate dry-run counts when `dryRun: true`: requests built, Wix calls skipped,
  would-create/update/delete, would require live lookup, and local validation failures
- grouped skipped/deferred outcomes
- grouped failure outcomes
- dashboard/editor/preview destinations
- artifact references for audit/error/execution logs

The shared runtime should also support deterministic rendering inputs for:

- `execution/review/completion-summary.md`

The rendered summary should be derived from `completion-report.json`, not independently
invented by the agent.

### Audit log contract

The shared runtime should emit append-only machine-readable audit events.

Preferred format: NDJSON.

Each event should capture, at minimum:

- timestamp
- run ID
- phase: `setup | import`
- entity
- operation
- source ID when applicable
- target ID when known
- endpoint or primitive used
- attempt number
- result status
- HTTP status or platform error code when applicable
- latency

The `run ID` is required because audit files are append-only across dry-runs, retries, and
recovery passes. Completion reports should be generated from runtime counters for the
current run and may use audit aggregation only when filtered by `run ID`. The shared
`lib/audit-summary.js` helper enforces this filter for fallback/verification summaries.

### Dry-run runtime contract

The shared Wix runtime exports `createDryRunConfig`, `normalizeDryRunValue`,
`createWixClient`, and `createWixSetupExecutor`.

Dry-run is enabled by `DRY_RUN=true` or by the generated entrypoint's `--dry-run` flag.
It is disabled by default. `true`, `1`, `yes`, and `on` enable it; `false`, `0`, `no`,
and `off` disable it.

When `createWixClient({ dryRun: true })` is used:

- `authToken` and `siteId` may be blank unless the generated project requires the site ID
  for a local artifact namespace;
- `send()` must not call `fetch`, SDK, MCP, or CLI transports;
- `send()` must capture the would-send request under
  `state/attempts/wix-request-captures.ndjson` when `projectDir` or `requestCapturePath`
  is supplied;
- captured headers must omit `Authorization` and redact secret-like header/body keys;
- captured bodies must be after `SAFE_MODE` contact-value sanitization;
- response payloads must preserve the live shape expected by writer helpers, for example
  `{ contact }`, `{ product }`, `{ dataItem }`, `{ file }`, or an expected collection
  field such as `{ contacts: [] }` for skipped queries.

Dry-run placeholder target IDs are not live authority. If downstream local execution
needs them, write them only to `state/crosswalk/dry-run-crosswalk.ndjson` or keep them
in memory. Never append simulated target IDs to `state/crosswalk/crosswalk.ndjson` and
never upload them to a CMS crosswalk mirror.

When `createWixSetupExecutor({ dryRun: true })` is used, each setup step must first be
reduced to a structured intent, then captured as `planned_dry_run` without invoking MCP,
CLI, SDK, or REST transports that access or mutate Wix account/site state.

### Artifact authority at run completion

The shared runtime contract should preserve explicit artifact authority:

1. `execution-log.md` for chronology and operator/debug context only
2. `completion-report.json` for final outcome
3. `completion-summary.md` for deterministic user-facing rendering

The runtime should not force downstream consumers to reconstruct final outcome by reading
raw audit logs or chronological execution logs.

### Retry and throttling policy

This adapter should define one shared retry/throttling contract rather than letting each
migration invent its own.

It should classify, at minimum:

- retryable transport/network failures
- retryable `429` responses
- retryable `5xx` responses
- non-retryable `4xx` validation failures unless explicitly listed otherwise

When the server provides backoff hints such as `Retry-After`, the shared runtime should
honor them.

### Bulk and fallback policy

The shared runtime should know:

- when a native bulk primitive exists and is preferred
- when to fall back from bulk to per-record writes
- when an upsert requires lookup + create/update orchestration
- when an unverified native path must be surfaced before execution rather than used
  silently

## Media policy by target

Do not treat all media the same. The target domain decides whether media must exist in Wix
first or can be ingested through the entity API itself.

- **Wix Stores products:** prefer external URLs on `media.itemsInfo.items[]` and let the
  product API ingest them in the background. This is the default path when the URLs are
  publicly reachable.

  What one item accepts, from the machine-readable Catalog V3 spec (component
  `ProductMedia`) — not from the prose article, which disagrees on the cap:

  | Field | Direction | Constraint |
  | --- | --- | --- |
  | `setBy.id` **or** `setBy.url` | **in** | a `oneOf` — exactly one per item |
  | `altText` | **in** | 1–1000 characters |
  | `displayName` | **in** | max 80, and **only** accepted when the item is set by `url` |
  | `mediaType`, `uploadId` | out | read-only |
  | `media.image`, `media.video` | out | read-only; populated when the item is set by `id` |
  | `thumbnail` | out | Wix-generated; needs `THUMBNAIL` in the request's `fields` array |
  | `media.main` (on the parent) | out | read-only; always the first entry of `itemsInfo.items` — reorder the array to change it |

  ⚠️ **`thumbnail` is not an input.** It looks like a second image URL you could supply and
  it is not — `fields` is defined as *"Fields to include in the response"*, so `THUMBNAIL`
  only asks Wix to return a derivative it generated from the one file you uploaded. There is
  no input that influences it, and none that raises an already-ingested item's quality: the
  URL you send is that image's permanent ceiling. Send the source's original, maximum-
  resolution file — the source adapter owns that choice (WordPress sources: `wp-image-url.js`).

  ⚠️ **The cap is disputed by Wix's own docs.** The schema says `maxItems: 50` on
  `itemsInfo.items`; the *About Product Media* article says 15. Follow the schema and do not
  design near either bound.

  ⚠️ The article also says `width`/`height` are not populated for URL-set media. Observed
  behaviour contradicts it — a URL-set item read back live returned both — so reading
  dimensions back is a usable post-ingest check. Confirm at first live run before reporting
  it as a guarantee.

  ⚠️ **The 200 is a queue acknowledgement, not a delivery — and a failed ingest empties the
  gallery.** This is the most expensive trap on this endpoint, so it gets its own paragraph.
  The write returns 200 with the item echoed back as `mediaType: "UNKNOWN_MEDIA_TYPE"` and an
  `uploadId`; Wix fetches the URL afterwards, on its own side, with no callback and no status
  endpoint. `media.itemsInfo.items` is a **full replace**, so the product's existing image is
  discarded the moment the PATCH is accepted. When the later fetch fails, Wix **drops the item**
  and the product is left with **no images at all** — 200 on the write, no error anywhere, and
  the old picture already gone.

  It is transient and unattributable: observed live on a valid, publicly reachable 2048×2048
  JPEG that ingested fine on the very next identical attempt. Nothing about the file or the
  request predicts it, so there is nothing to validate up front.

  | Measured live, 2026-09-01, one catalog | Count |
  | --- | --- |
  | Items not ingested 60 s after an accepted write | **65 of 383** (17%) |
  | Of those, fixed by one identical retry | 64 |
  | Writes refused by an **edge-level 429** whose body is an HTML page, not JSON | 12 of 395 (3%) |

  So: **never treat a 200 as done.** Read the product back with `?fields=MEDIA_ITEMS_INFO`
  (a plain `GET` returns only `media.main` and looks empty even when healthy), and re-send
  anything whose items lack an `image.id`. A miss is *not yet known*, never *failed* — only
  re-sending distinguishes "still in flight" from "dropped and gone". Use
  `patchStoresProductMediaVerified`, which does this, rather than `patchStoresProductMedia`,
  which returns on the 200. Re-read the `revision` each round: the accepted-but-not-ingested
  write already incremented it.

  ⚠️ Two different failures, **one retry list**. A write refused with 429 leaves the OLD image
  in place; a write accepted but never ingested leaves NOTHING. Anything that did not reach the
  verified state goes into the next round, whatever went wrong — recording one of them as an
  error and dropping it out of the loop is how a run reports success over products it never
  fixed. Keep the write pool small (3 concurrent, not 6) so the edge limiter is not the thing
  the retry loop spends its rounds on.

  ⚠️ **A round that failed must back off before the next one, and it is a different wait from
  the settle wait.** The settle wait comes *after* an accepted write, so a round that throws
  never reaches it — retry immediately and the loop burns all its rounds in milliseconds against
  a rate limit that lasts tens of seconds, which is a retry loop that only looks like one. Two
  waits, two purposes: `settleMs` waits for an accepted write to finish ingesting, `retryDelayMs`
  waits for a refusal to lift. Skip the delay after the final round — there is nothing left to
  wait for and the caller should not pay for it.
- **Wix Blog cover images and other surfaces that require a Wix media id at create/update
  time:** import media first, then pass the Wix media id into the entity payload.
- **Generic Media Manager import** is a fallback/shared primitive, not the default for
  every entity carrying media.

## Media import source URL reachability

The media primitive imports by URL: Wix servers fetch the provided `sourceUrl`. Public
HTTPS URLs are expected; `localhost`, `127.0.0.1`, Docker-only hosts, and other
private-only URLs are not reachable by Wix during a live import. This is optional source
preparation and, as far as we know today, affects media import only.

If the source system is local, the migration should either:

- expose the source through a public HTTPS tunnel, then pass/rewire media URLs to that
  public base URL; or
- skip/defer media import and clearly state which media-dependent references will be
  missing until media is imported.

Ngrok quick setup for macOS:

```bash
brew install ngrok
ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
ngrok http 8090
export WP_BASE_URL=https://<id>.ngrok-free.app
```

## Validate by real call — do not trust doc examples

Codegen-time MCP doc checks confirm an endpoint *exists*; they do **not** confirm the
request *shape works*. The live wporg-news import proved doc examples can be wrong
(lowercase Ricos plugins → 400) or incomplete (featured image field, tag body). The
rule for this adapter:

- Treat a shape as verified **only after a real call succeeds** — encode the working
  shape here with a `// VERIFIED:` (or `// VERIFIED-TRAP:`) note and a date.
- A `// UNVERIFIED:` primitive is allowed as a bootstrap point for generated code, but it
  is not a silent live-write permission. The execution plan must call it out, and setup
  verification must either promote it with a sandbox/live validation or route to fallback.
- Keep `tests/target-wix/contract-test.js` current: it issues one real call per primitive
  against a sandbox site and is the single place schema drift surfaces. Tests live in the
  repo's `tests/` tree rather than in this bundle, so the published product carries no test
  harnesses. Run from the repo root:

  ```bash
  bash tests/run-all.sh target-wix
  WIX_AUTH_TOKEN=... WIX_SITE_ID=... bash tests/run-all.sh target-wix
  ```

  Without credentials the shape checks still run and the live calls are skipped.
  `tests/target-wix/ndjson-contract-test.js` covers `lib/ndjson.js` and never needs
  credentials.

  For live verification runs, pass `--progress-log <path>` and poll it per
  `CONVENTIONS.md#progress-log-polling`.

  Run on a cadence and after any Wix API change. A failing contract test — not a stranger's
  broken import — is how we learn the surface moved.

## Stores catalog is Catalog V3 only — Catalog V1 is not supported

**A migration only ever writes to a `V3_CATALOG` site.** Catalog V1 is not a supported
destination: there is no V1 write primitive here, no V1 fallback, and none should be added
(a former V1 fallback was removed — it only masked real V3 errors as spurious `428`s). A V1
site is a **blocker the run halts on**, not a variant the adapter, the mapper, or codegen
accommodates. The V3 create traps are handled in `lib/wix-writers.js`
(`normalizeStoresProductV3` + the top-level `treeReference` builder), so callers never
re-hit them.

**On a site this run created, a Stores install is guaranteed Catalog V3.** This section
used to require verifying that live, after a 2026-07-30 incident where a site scaffolded
from the `blank` headless template, with Stores installed afterwards through the App
Installation API, came up `V1_CATALOG` — Catalog version is fixed at provisioning, so
every V3 write on that site failed and the site had to be abandoned. The Wix platform has
since changed: Catalog V3 is now guaranteed at provisioning regardless of scaffold
template, so that failure mode can no longer occur for a newly-created site, and neither
the `--site-template commerce` requirement nor the pre-write version gate apply anymore —
see `0079-catalog-v3-guaranteed-retire-v1-gate.md`.

This does **not** extend to an existing site this run did not create — `rp-execute-setup`
("A `V1_CATALOG` verdict is terminal here") still treats that case as a live risk and
halts on it, since a pre-existing site's catalog version predates this guarantee.

## Order history: payment records, refunds and preserved invoice documents

Import Order creates **no** payment record — a freshly imported order reads back with
`payments: []` — so payment history is a separate write, and refunds have nothing to reference
until it exists. And the order write itself has no idempotency unless it is given an id.

**The contract is one call: `importOrderHistory` in `lib/order-history.js`.** It owns
the per-order sequence — derive the order id, read or write the crosswalk, import, gate, one
reconciliation read, payment, refunds, invoice document — and returns every stage's outcome:

```js
const { importOrderHistory, createProjectOrderCrosswalk } = require('./lib/order-history.js');
const result = await importOrderHistory(wix, {
  order,              // mapped Import Order body, no `id`
  sourceId, sourceSiteHost,
  evidence,           // { amount, paidDate, altPaidDate, currency, status, methodName, providerTransactionId,
                      //   offlinePayment, cardDisplay, refunds: [{ sourceId, amount, reason }],
                      //   invoice: { approval, sourceUrl, invoiceNumber, pendingMediaFileId } }
  crosswalk,          // createProjectOrderCrosswalk({ projectDir }) — required, persisted
  setupVerification,  // setup/extended-field-verification.json, read once per run
});
// result.outcomes = { order, payment, refunds: [{ sourceId, sourceOccurrence, outcome, refundId, paymentId }], invoice }
// result.findings, result.errors (partial failures carry a cause), result.orderId, result.paymentId
```

Its guarantees, each the answer to a real failure of the first end-to-end:

- The **order id is derived** from `sourceSiteHost` and `sourceId` and the crosswalk row is
  written before any further write. Hit or miss, the target is asked by id once — a read, not a
  duplicated store, and not a phantom order either. A crosswalk row from before derived ids (a Wix-minted id) wins and
  is counted as `order-id-from-crosswalk`. An existing order is **never re-sent**: Import Order's
  replace is silent and would overwrite a merchant's edits.
- **Evidence keys are a contract.** An unknown key throws and names the right one; it does not
  report an ineligible order. The target currency is `order.currency`.
- **One reconciliation read per order**, shared by the payment and every refund. Refund occurrences
  are assigned inside from source ids; pass all of an order's refunds together.
- **Every stage returns an outcome**, and a stage that failed after the order existed returns
  `payment-failed` / `refund-failed` / `invoice-failed` with `errors.<stage>.cause`, so a resume
  reconciles the order and retries only what failed. An order-stage failure fails the rest for the
  cause `order-not-imported`; a target that cannot be read is `order-target-read-failed` and
  writes nothing.
- **The buyer's member id comes through `buyer`, never on the body**, and the body's `buyerInfo.email` must be the billing email the member was corroborated against.
  `lib/order-buyer.js` `resolveOrderBuyer({ sourceCustomerId, billingEmail, memberCrosswalk,
  contactCrosswalk })` links `buyerInfo.memberId` only when the member crosswalk row's `loginEmail`
  equals the order's billing email; a guest, a missing row or a mismatch links nothing and reports
  (`buyer-*` outcomes). The result is stamped; the composite sets `buyerInfo` from it and refuses a
  body that carries `memberId` itself. Import Order stores ANY GUID there unvalidated (verified
  live), so this is the only guard.
- The invoice `approval` goes to the writer unchanged. The merchant opt-in is applied when the
  plan is built, nowhere else — and `resolvePreservationPlan()` stamps what it approves
  (`lib/preservation-approval-stamp.js`), so the writer refuses an opt-in that did not come from
  the plan. A READY Media file whose order patch failed comes back as
  `invoice-fields-write-failed` with `pendingMediaFileId`; the composite remembers it in the
  crosswalk (`getInvoiceFile`/`setInvoiceFile`) and the resume records that file instead of
  importing another. The crosswalk contract is four methods, all required.
- **Every crosswalk hit is verified with one paced order read.** A hit is not proof: a row
  pointing at an order the target no longer has (a cleared migration) is re-imported under the
  derived id and counted as `order-reimported-after-deletion`. One read per order per run, hit or
  miss.

Live: `tests/target-wix/order-history-live-sentinel.js` (credential-gated) — three runs against a
disposable site, one order and one payment afterwards, cleaned up through Bulk Delete Imported
Orders. Passed 2026-09-05.

### Per-writer reference — what the composite calls, in this order

The writers keep their contracts and remain callable; the composite is a new caller of them. This
is what each one guarantees, kept here because the guarantees are the reason the sequence is safe:

1. **Gate on the source, first.** `evaluatePaymentEligibility()` in `lib/order-payment-mapping.js`
   requires a positive amount AND a source paid date. An order total is not evidence of payment;
   neither is an order status, and neither is a transaction reference. Ineligible orders are
   reported under a named reason and never reach the target — which is also what keeps target
   reads proportional to evidenced payments rather than to the whole order population.
2. **Build the record**, with `buildPaymentRecord()`. `status` sits at payment level, not inside
   `regularPaymentDetails`. `savedPaymentMethod` is never set: the field is writable but no
   reusable credential can accompany it, so setting it asserts a charging agreement that does not
   exist. An unknown offline/online class is OMITTED, never guessed — that is how a card payment
   ends up labelled as cash.
3. **Reconcile before creating**, with `writeOrderPayment()`. It reads the order's existing
   payments every run and matches by provider reference, else by an exact fingerprint of the
   payment facts. The migration's own crosswalk is a hint, not proof of target state: it does not
   survive "Wix write succeeded, crosswalk write failed", and it is blind to payments the merchant
   created by hand. Exactly one match reconciles, more than one is ambiguous and prohibits
   creation, and a failed target read is its own outcome — **never** permission to create. Add
   Payments fails the ENTIRE call if a duplicate external transaction id is present, so writing
   blind breaks the run and can double recorded revenue.
4. **Refund only what the source evidences**, with `ensureOrderPaymentAndRefund()`. Assign
   occurrence numbers first and pass `sourceOccurrence` (the composite does this from the refunds'
   source ids; a direct caller uses `assignRefundOccurrences()`): two
   distinct source refunds can share a payment and an amount, and without it the second one
   reconciles against the first and is silently dropped. It no longer
   fabricates a payment to give a refund something to point at; a qualified refund whose order
   evidences no payment is reported as `refund-without-payment`. `externalRefund` is a hardcoded
   literal `true` — it defaults to `false`, which calls the payment provider for real. Omit
   `sideEffects` entirely: that is what suppresses restock and the customer email. The refund date
   cannot be preserved (read-only and immutable), so every written refund discloses that loss, and
   the true date must not be smuggled into the customer-visible `customerReason`.
5. **Preserve invoice documents by reference**, with `preserveOrderInvoiceDocument()`. Pass the
   `approval` straight from `resolvePreservationPlan()`, and pass `sourceSiteHost` with it. The
   writer refuses anything that is not an approval naming that exact URL, and it re-derives the
   DECISION from its own classification rather than trusting the approval's `action`: a document
   that is not on the source site needs `merchantOptedIn` however the approval is labelled — and
   the opt-in is believed only under the planner's provenance stamp.
   `action` is caller-supplied, and trusting it meant a caller could relabel a third-party
   document `preserve` and have it imported on nobody's authority. With no `sourceSiteHost` the
   guard answers `third-party`, so omitting it fails closed. Pass the persisted
   `setup/extended-field-verification.json` as `setupVerification`. When a previous run left an
   import in flight, pass its `pendingMediaFileId` back so the import RESUMES instead of creating
   another private orphan. It reads the
   order itself — pass an `orderId`, not an order object — so an existing file id suppresses the
   import and a re-run cannot import a second copy of a tax document. Pass the setup verification
   receipt (`setup/extended-field-verification.json`): without it the write is refused as
   `invoice-fields-not-provisioned`. The file is imported `private: true`; only the returned id is kept,
   because the Import File response echoes `sourceUrl` and that URL is a bearer link. Update Order MERGES the `extendedFields` object it is given — verified live: a foreign
   key survived a patch that never mentioned it. The write still sends the complete object, which
   is precautionary rather than load-bearing. Do not describe it as preventing data loss; the API
   does that itself. The Data Extension SCHEMA PUT is the opposite — there the merge is the only
   thing preserving a merchant's fields.

**Never call the invoicing service.** Re-issuing a historical tax document mints a second legal
document under a different number, and whether publishing one emails the customer is undocumented
in either direction. The contract is non-use, and it is provable:
`tests/target-wix/no-invoices-api-contract-test.js` scans the published tree.

Extended fields must be provisioned and verified before any value is written — see
`lib/data-extension-schema.js` and the provisioning section in `rp-execute-setup`. A value write
is blocked until setup verified that exact field.

## Coupons, coupon usage and plan definitions

Four small target-side pieces, all pure except the writers named in the table above:

- `lib/coupon-redemption-drift.js` — **a bearer voucher is money, and its redeemability must be
  decided at write time, not from the discovery snapshot.** `isBearerVoucher(coupon)` narrows to
  the money-instrument shape (a fixed amount, no scope, no minimum, `usage_limit: 1`);
  `classifySnapshot({ capturedAt, now, maxAgeMs })` refuses an undated or stale snapshot;
  `classifyPreWriteDrift` refuses to write a voucher spent since capture (`coupons-spent-after-capture`)
  and refuses to write one it cannot decide; `classifyPostImportDrift` + `buildVoucherDriftPlan`
  produce the cutover remedy plan, with face value and affected orders per code;
  `verifyRemedyApplied` insists on a post-settle read-back.
  **One measured fact drives all of it.** Update Coupon WRITES when the specification carries
  ONLY the changed fields plus a field mask — so a spent voucher is deactivated in place, keeping
  its id, code, dates and amount. Send the FULL specification alongside a narrow mask and it
  returns **200 with an empty body and writes nothing**: the shape everyone reaches for first, and
  a pass that counts 2xx responses reports a false pass on money. `buildRemedyRequest` can only
  emit the minimal form; `verifyRemedyApplied` refuses to call any 2xx applied without a
  post-settle read-back. `specification.tags` is the one usable marker field (every alternative is
  silently dropped) and spec 0142 freezes the vocabulary: `Imported` on everything a migration
  writes, plus `Already_Used` or `Disabled_At_Source` on a disabled one. All recorded as pitfalls
  on `domains/stores/entities/coupon.json`. See spec 0142.
- `lib/order-applied-discount-build.js` — `buildCouponAppliedDiscounts({ couponLines,
  resolveCoupon })` turns a source order's coupon lines into `appliedDiscounts[]` entries of the
  `coupon` variant (`{ id, code, name, amount: { amount } }`, `discountType: GLOBAL`) for the
  Import Order body. There is no standalone write: the entity `ecom/order-applied-discount` is
  written through `importOrder`. A code the coupon crosswalk cannot resolve produces NO entry and
  an unresolved line — never a dangling coupon id. Import Order stores money as-is, so
  `priceSummary.discount` must already agree with the entries.
- `lib/pricing-plan-definition.js` — `evaluatePlanSources({ B1, B2, B3 })` (the row-count gate
  and the "none found" wording), `buildPlanDefinition(offer)` (PRIVATE, unbuyable, ACTIVE; name
  and description truncated WITH a finding; 7-day minimum cycle and 10-year maximum), and
  `assertInertPlan`, which the request builder and writer both call.
- Live: `tests/target-wix/coupon-plan-live-sentinel.js` (credential-gated, cleans up) — one coupon
  of each mapped type including an expired and an exhausted one, one inert plan, one imported
  order carrying a coupon usage. Its verdicts are recorded as pitfalls on the entity files.

## What stays in codegen (not here)

Per-project field maps and ordering (which source field → which `data` key, the
media/author/taxonomy ref maps, upsert-by-key) live in the generated transforms/write
specs. This adapter holds the invariant Wix request shapes, transport, and shared
execution mechanics. Collection names and schemas (`PodcastEpisodes`, …) are
project-specific and come from the mapping plan.

## Provisioning pointers (see rp-execute-setup)

- Apps (Blog, Members) install via the App Installation API; ground `appDefId` from the
  official "Apps Created by Wix" table.
- **Wix Data enablement** (`WDE0110`): install the **Wix Data app `appDefId
  e593b0bd-b783-45b8-97c2-873d42aacaf4`** via the App Installation API; afterward `POST
  /wix-data/v2/collections` creates NATIVE collections with no `WDE0110` (verified live).
  Fallback: a custom app with a data-collections extension (declares collections at
  install time, but can't express REFERENCE fields).

## Scope & coverage

Wix has many apps/entities (Stores, Bookings, Events, Restaurants, Pricing Plans, CRM,
…). This adapter does **not** pre-build all of them. Coverage is **demand-driven** and
grows through reviewed releases. A migration may still target a native Wix entity before a
dedicated primitive exists; in that case codegen emits a native REST path using
`sendDirectRest`, logs the missing primitive, and calls `notifyMissingWriter` so the
RePlatform team can add the writer later.

**Native target ladder when no dedicated writer exists:**

1. **Use the dedicated `rp-target-wix` primitive** when one exists.
2. **If Wix has a native entity but no dedicated primitive, generate a native REST call**
   from Wix MCP/docs-schema, mark it `UNVERIFIED`, log it, call `notifyMissingWriter`, and
   surface it in the execution plan before any write. This is not a silent live write.
3. **Use CMS only when there is no suitable native Wix entity, or when the native entity
   is explicitly rejected for fidelity/side-effect reasons.** CMS is not a fallback for a
   missing adapter writer.
4. **Halt** if neither a native path nor an acceptable CMS/custom target exists.

The invariant: **anything not backed by a verified primitive is surfaced to the user for
consent before execution** — never written silently.

## Setup runtime expectations

This adapter should also define the shared setup-side runtime used by setup execution.

It should cover reusable mechanics for:

- app installation and verification
- Wix Data enablement verification
- CMS collection and field provisioning when supported
- setup step ordering/checkpointing
- setup audit logging
- setup execution reporting

`rp-execute-setup` should consume setup artifacts through this runtime rather than
re-implementing setup mechanics in skill-local prose or one-off scripts.

## Contract-test expectations

Contract tests should validate not only request builders, but also the most important
shared runtime invariants.

Examples:

- verified request shapes still serialize correctly
- retry policy classifies common Wix failures correctly
- throttle/backoff handling honors server hints
- compact reports preserve stable top-level fields
- completion reports preserve stable top-level fields
- audit events preserve the agreed machine-readable shape

Default-location `reconcileInventory` outcomes include `catalogVerification`: exact Catalog variant availability must agree even when no stock write is needed. Catalog reads are grouped per product with at most four concurrent reads and bounded retries. Non-default locations mark this check `not-applicable`; Inventory-only success is not a default-location Catalog completion verdict.


## Verified contact and product import callers

Use `lib/contact-import.js` `importContacts` and `lib/product-import.js` `importProducts`
for standard imports. They reconcile source identities before writes, persist candidate
IDs in project-local state, and publish crosswalks only after identity/value read-back.
The request primitives do not themselves certify a mapping. `lib/bulk-results.js` selects
rules through explicit Contacts V5 / products-with-inventory / Inventory adapters; missing
indexes are unresolved, never positional fallbacks. Blog bulk remains outside those adapters.

`lib/write-verification.js` forwards to the shared runtime comparators in
`skills/wix-replatform/lib/write-verification.js`. Contacts normalize only the
main email (trim/lowercase) and compare other mapped values exactly after the existing
per-source sanitizer. Phone-only identity and distinct source keys sharing a target block
and report. Product variant matching uses source-fixed projections and exact target IDs;
stock and default-location Catalog verification remain in `reconcileInventory`.

The existing subscription probe now records `valueEvidence`. Contract-ledger proposal
creation and promotion recheck those inputs; toggling `status` or supplying only present
paths cannot establish verified values. Existing published contracts remain in place.
These changes add no automatic probe or global canary gate. Schema fingerprints retained
as development evidence must be computed from saved docs-tool output, not authored claims.
