# Seed recipes — the pinned docs to read *before* seeding

This is an **index of doc pages**, not a set of payloads. For each capability it pins the exact pages to read — in order — so you read-then-act instead of guessing-then-failing. It carries **no endpoints, bodies, field templates, or caps**; those live on the pages and are read off them at run time (same rule as `SEED.md`).

**How to use it.** Before seeding a capability, look it up here and read its pinned pages top-to-bottom (Tier 1 → 3) until you can build the call. Only if a capability has **no entry** (or its entry is marked *to be pinned*), fall back to the generic navigation mechanism in `SEED.md` §1.

**URL form & how to read it.** Each pinned link is the **`.md` twin** of a docs article (the canonical article URL with `.md` appended). A page pinned here is **already curated — read it directly; don't re-discover it with search.** The two read paths take **different URL forms** — don't mix them:

- **`curl` the pinned link — first priority. Fetch it as-is (keep the `.md`)** for raw markdown. The pin *is* the exact page to read, so a direct fetch is the fastest and most deterministic path.
- **MCP doc tools — second priority** (discovery of a page this index doesn't pin, or a fallback if a fetch fails). **Pass the URL *without* the `.md` suffix:** `ReadFullDocsArticle` for recipe/flow/article pages (**Tier 1–2**), `SearchWixAPISpec → getResourceSchemaByUrl` for method/schema pages (**Tier 3**; resolves method pages only — read `…/skills/…` and other articles with `ReadFullDocsArticle`).

Never invent a URL or body from memory.

**Tiers.**
- **Tier 1 — Recipe** (`…/<vertical>/skills/<how-to-*>`): read first. Gives ordering, the cross-step gotchas, and the right bundled endpoint.
- **Tier 2 — Business/setup flow** (`…-business-flow` / `…-setup-flow`): the step ordering; read when there's no Tier-1 recipe or you need the sequence.
- **Tier 3 — Method schemas**: the specific create/list pages, to confirm request/response shape (prefer `SearchWixAPISpec → getResourceSchemaByUrl`).

---

## blog — initial posts

*SEED.md §3: `intent.blog.postCount` posts on `intent.blog.topics`; text-only; bulk-create when `postCount ≥ 2`; keep `postIds[]` + slugs.*

**Read `inline-recipes/setup-blog.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the Blog-V3 method/flow doc pages** (they're superseded by the recipe). It covers the full create flow: **fetch an author `memberId` first** (required for 3rd-party callers — a `GET /members` lookup; note `memberId` is author *attribution*, the caller stays APP, so this does **not** let members author posts), then **bulk-create published posts** (`bulk/draft-posts/create`, `publish:true`) with the **flat** per-item body shape (title/memberId/richContent directly in each `draftPosts[]` element — NOT the nested `draftPost` envelope, which 400s), valid **Ricos `richContent`** (TEXT-in-PARAGRAPH nesting, or "Expected a paragraph node"), text-only, then **collect slugs via `posts/query`** (the bulk response carries ids only). Optional categories/tags only if the request names them (re-publish after any PATCH). The single-post endpoint (`postCount=1`) and its nested `{draftPost:{…}}` envelope are inlined too.

---

## stores — a product catalog

*SEED.md §3: `intent.stores.productCount` products fitting `brand`; named categories only if `categoriesNamed` is non-empty; text-only; keep `productIds[]`, `categoryIds[]`, slugs.*

**Read `inline-recipes/setup-online-store.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the Catalog-V3 method/flow doc pages** (they're superseded by the recipe and only add confusion). It covers the full create flow: **clean the install's default products first** (`products/query` → `bulk/products/delete`), then **bulk-create products with options/variants/inventory** (`bulk/products-with-inventory/create`) **with `visible: true`** so they appear on the live site (omitting it leaves the catalog empty to visitors), then categories (separate API, sequential, no bulk create). Rich-text descriptions, media shape, and options/variants structure are all inlined.

---

## cms — content collections

*SEED.md §3: one collection per `intent.cms.collections` entry, `itemCount` items each; collections are **public-read**; keep `collectionIds{}`, `itemIds{}`, field keys.*

**Read `inline-recipes/setup-cms.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the Wix Data method/flow doc pages** (they're superseded by the recipe). It covers the full create flow: **create each collection with a `permissions` block whose `read` is `ANYONE`** (anything else and the headless visitor frontend reads back zero items — the #1 empty-page cause; native collection `id`s carry no namespace), then **bulk-insert each collection's items with real field values** in `data` (`bulk/items/insert`, `returnEntity: true`, keys matching the schema; read created items from `results[].dataItem`), then **verify every field persisted** with a query before wiring any **multi-references** (`bulk/items/insert-references` with a `dataItemReferences[]` body — a multi-reference set at insert is silently dropped, not rejected, and its field must be created with `referencedCollectionId` or links never resolve; single `REFERENCE`s can be set at insert). Also covers a **visitor-writable** collection variant (`insert`/`update`/`remove: ANYONE`) for collaborative data. The public-read permissions gotcha, the transient fresh-site provisioning race (403-on-create / `400 WDE0117`-on-insert, retry-once), and the empty-`data` blank-record trap are all inlined.

---

## forms — lead-capture forms

*SEED.md §3: one form per `intent.forms.forms` entry, fields from the entry; keep `formIds[]` and each field's **`target`** key (frontend input `name` = target). Wix Forms is the standalone CRM API — **not** the events/bookings registration form.*

**Read `inline-recipes/setup-forms.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the CRM Forms method/flow doc pages** (they're superseded by the recipe, and the create-form schema page is buried in RichContent noise). It covers the full create flow: **list-then-delete any pre-existing form first** (the install *sometimes* ships a default "Get in touch" — non-deterministic; a safe no-op when the list is empty, but when present its name collides and your form gets silently renamed "Get in touch 1"), then **create one form schema per requested form** (`form-schema-service/v4/forms`, one POST per form, no bulk) in namespace **`wix.form_app.form`** with **INPUT fields only** — each field needs a **shell-generated GUID `id`**, a unique/non-empty/immutable **`target`** key (missing → `UNSUPPORTED_FIELD_TARGETS_NAME`, dup → `DUPLICATED_FIELD_TARGETS`, dup id → `DUPLICATED_FIELD_IDS`), and a **`stringOptions.validation` block** (`format: "UNKNOWN_FORMAT"` for plain text — NOT `"UNDEFINED"`, which is the read-back value and 400s on write — or `"EMAIL"`/`"PHONE"`) **or the field isn't submittable** (visitor submissions 400 "additional properties"), then **verify** via a namespace list. The response returns created fields under **`form.fields[]`** with field ids **lowercased** — so bind by `target`. **Seed a `steps` layout + a `SUBMIT_BUTTON` DISPLAY field** (generate lowercase field GUIDs so each `steps[].…fieldId` matches its `formFields[].id`) — a form seeded **without** a layout stores submissions fine but the **Wix dashboard shows every submission blank** (confirmed live; a single create with the layout persists it, no PATCH). `postSubmissionTriggers.upsertContact` (contact mapping) is **silently dropped** through this endpoint (200 but not persisted) — don't rely on it; submissions are recorded against the schema regardless. **Keep** each form's `formId` + its field `target` keys.

---

## events — ticketed or RSVP occasions

*SEED.md §3: `intent.events.eventCount` events (default 1), each **`TICKETING`** (paid, with ticket tiers) or **`RSVP`** (free, built-in name+email form so no form fields), all with **future** dates. Keep `eventIds[]`, slugs, and per ticketed event its `ticketDefinitionIds[]`.*

**Read `inline-recipes/setup-events.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the Events V3 method/flow doc pages** (they're superseded by the recipe). It covers the full create flow: **create each event as a draft** (`events/v3/events`, `"draft": true`) with an **immutable `registration.initialType`** (`TICKETING` or `RSVP`) and **future** dates (a past event isn't purchasable/registerable or listed), then — **ticketed only** — **create the ticket definitions** (`events/v3/ticket-definitions`, `fixedPrice.value` a decimal **string**, `name` ≤ 30 chars, a `feeType`) **before** publishing, then **publish** (`events/v3/events/{id}/publish`, **one-way**). RSVP events seed no tickets and no form fields. The paid-ticket precondition (a live purchase needs a premium plan + a configured payment method — **note it, don't fail**) and the create→tickets→publish ordering (both `initialType` and publish are one-way) are inlined.

---

## bookings — bookable services

*SEED.md §3: `intent.bookings.serviceCount` services (name + short description, simple duration and price); use the **public** services endpoint, not the internal `/_api/` form; minimal availability; keep `serviceIds[]`, slugs.*

**Read `inline-recipes/setup-bookings.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the Bookings method/flow doc pages** (they're superseded by the recipe and the Create-Service page even shows the internal `/_api/` form the recipe tells you to avoid). It covers the full create flow: **resolve a staff `resourceId` (APPOINTMENT needs one) and CREATE a category (a fresh install ships ZERO categories; no `category.id` → service invisible on the live site) FIRST**, then **bulk-create** services on the **public** `bookings/v2/bulk/services/create` (flat V2 shape — `onlineBooking.enabled`, `defaultCapacity`, valid `payment.options`, `sessionDurations` for appointments; read created services from `results[].item`), then **bulk-schedule Calendar Events V3 sessions for CLASS** (`calendar/v3/bulk/events/create`, each wrapped `{event:{…}}`; else the class calendar is empty). Payment-option validation table, the `BUSINESS` vs `OWNER_BUSINESS` enum trap, and the staff `resourceId`-not-`id` rule are all inlined.

---

## pricing-plans — membership tiers (+ bookings membership integration)

*SEED.md §3: `intent.pricing-plans.planCount` recurring plans (name, price, a **monthly** billing cycle); one create call per plan; keep `planIds[]`. When bookings is also in the run, attach covered services so a plan is a bookings membership.*

**Read `inline-recipes/setup-pricing-plans.md`** (local — Read it, don't curl). It is **self-contained** — every endpoint, request body, and representative response is inlined, so read it and seed from it alone; **do not go fetch the Plans-V3 / Benefit-Programs method/flow doc pages** (they're superseded by the recipe and their headers even show the internal `/_api/` form the recipe tells you to avoid). It covers: **create each plan** (`pricing-plans/v3/plans`, one call per plan, no bulk) with pricing under `pricingVariants[].billingTerms` (cycle) + `pricingStrategies[].flatRate.amount` (a decimal **string**) — recurring / one-time / free are three `billingTerms`+amount shapes, currency is site-derived, `perks` are display-only; then — **only when bookings is in the run** — **attach bookings services via the Benefit Programs API** (a *separate* API, not a plan field): read the auto-created program definition (`GET …/benefit-programs/v1/program-definitions/by-namespace-and-external-id`, namespace `@wix/pricing-plans`) → create one pool definition (`providerAppId` = Bookings `13d21c63-…`, `price:"0"` = unlimited) → bulk-create items whose `externalId` is each covered bookings **service id**. The `pricingVariants`-not-`price` shape, decimal-string amounts, the strict `plan.id → programDefinition.id → itemSetId → items` ordering, the program-definition provisioning lag, and the `/bulk/items/create` vs `/bulk/items` path discrepancy are all inlined.

---

## gift-cards — a purchasable gift card

*SEED.md §3: one gift-card **product** whose amount options are `intent.gift-cards.denominations`; don't issue individual instances (those are created at purchase); keep `giftCardProductId`.*

| Tier | Page | What it settles |
|---|---|---|
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/sample-flows.md> | Step ordering for setting up a gift-card product, including preset denominations and promo pricing. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/create-gift-card-product.md> | The create method: denominations go in the product's preset variants (each with a value/price); a site allows only one gift-card product, so create vs. update accordingly. |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/introduction.md> — only if the preset-vs-custom variant distinction or expiration policy is unclear.

---

## portfolio — a project showcase

*SEED.md §3: create `intent.portfolio.collections`, then `projectCount` projects assigned to them — **collections before projects**; text-only; keep `collectionIds{}`, `projectIds[]`, slugs.*

| Tier | Page | What it settles |
|---|---|---|
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/sample-flow.md> | Confirms ordering: create and save collections first, then projects reference collection ids (collections-before-projects). |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/create-collection.md> | Create-collection schema; returns the collection id to capture for the project step. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/create-project.md> | Create-project schema: assign to collections via the collection-ids array; returns project id + slug. Omit media to stay text-only. |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/introduction.md> — only to confirm the Portfolio app must be installed first.

---

## restaurants — a menu

*SEED.md §3: one menu, then its `sections`, then `itemCount` items per section — **menu → sections → items** (items reference their section); keep `menuId`, `sectionIds[]`, `itemIds[]`.*

| Tier | Page | What it settles |
|---|---|---|
| 1 | <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/build-a-complete-menu.md> | The recipe: recommended build order and how the menu → sections → items hierarchy is wired via id arrays. |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sample-flows.md> | Menus-level sample flows for assembling a complete menu end to end. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/create-menu.md> | Create-menu schema: sections attach via the section-ids array; returns the menu id. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/create-section.md> | Create-section schema: items attach via the item-ids array; returns the section id. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/create-item.md> | Create-item schema: name + price info; returns the item id its section references. |

---

## donations — a fundraising campaign

*SEED.md §3: `intent.donations.campaignCount` campaign(s) with a goal, predefined amounts, and custom-amount enabled; one create call per campaign; keep `campaignIds[]`. Checkout rides on eCommerce (frontend's job).*

| Tier | Page | What it settles |
|---|---|---|
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/sample-flows.md> | Step ordering: create the campaign with a goal, predefined amounts, and custom-amount enabled, then verify. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/create-donation-campaign.md> | Create-campaign method: requires a name plus predefined amounts and/or custom-amount enabled; the goal carries a target (optional end date). |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/introduction.md> — only to confirm the amounts/frequencies model before composing the payload.

---

## coupons — cross-cutting discount (scoped to a parent vertical)

*SEED.md §3 cross-cutting: not a standalone vertical; create coupons scoped to a parent in this run (stores / bookings / events / pricing-plans); keep `couponIds[]`.*

| Tier | Page | What it settles |
|---|---|---|
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/coupons/about-wix-coupons.md> | Every coupon needs a scope with a namespace, and the parent vertical's app must be installed. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/coupons/coupons/create-a-coupon.md> | Create-coupon schema: the specification needs name/code/start plus a scope namespace and exactly one coupon-type field; returns the coupon id. |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/coupons/coupons/valid-scope-values.md> — only when you need the exact namespace/group values for the parent vertical you're scoping to.
