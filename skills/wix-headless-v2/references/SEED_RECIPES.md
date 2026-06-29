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

| Tier | Page | What it settles |
|---|---|---|
| 1 | <https://dev.wix.com/docs/api-reference/business-solutions/blog/skills/how-to-create-blog-posts.md> | The author `memberId` requirement for 3rd-party callers (and how to fetch one); the bulk endpoint to reach for; the **flat** per-item body shape vs. the nested shape that fails; Ricos nesting rules; publishing inline; asking for the post URL/slug in the response. **Read this first — it settles every known blog seeding failure.** |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/blog/blog-business-flow.md> | Step ordering: draft post → categories (optional) → tags (optional) → publish → verify. |
| 3 | <https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/list-members.md> | Fetch a valid author `memberId` — a prerequisite for the create call as a 3rd-party app. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/bulk-create-draft-posts.md> | Request/response shape for the bulk create (`postCount ≥ 2`); per-item success flags. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post.md> | Single-post create shape (`postCount = 1`). |

> Optional, only if intent calls for it: <https://dev.wix.com/docs/api-reference/business-solutions/blog/category/create-category.md> and <https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/create-tag.md> for grouping posts.

---

## stores — a product catalog

*SEED.md §3: `intent.stores.productCount` products fitting `brand`; named categories only if `categoriesNamed` is non-empty; text-only; keep `productIds[]`, `categoryIds[]`, slugs.*

| Tier | Page | What it settles |
|---|---|---|
| 1 | `inline-recipes/setup-online-store.md` (local — Read it, don't curl) | Master ordering + the full create flow, self-contained: **clean the install's default products first** (`products/query` → `bulk/products/delete`), then **bulk-create products with options/variants/inventory** (`bulk/products-with-inventory/create`) **with `visible: true`** so they appear on the live site (omitting it leaves the catalog empty to visitors), then categories (separate API, no bulk create). Rich-text descriptions, media shape, and options/variants structure are all inlined. |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/online-store-catalog-setup-flow.md> | Alternate full setup-flow view (locations → inventory → product, optional brands/ribbons) for the create-supporting-elements-first rationale. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products-with-inventory.md> | Method schema for the bundled in-stock bulk create — request/response shape and the returned product IDs, slugs, and variant IDs. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-delete-products.md> | Method schema for the STEP-1 clean: bulk delete products by `productIds` (≤100/call); pair with `POST /stores/v3/products/query` to collect the ids first. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category.md> | Method schema for creating one category; returns the category ID. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-add-items-to-category.md> | Method schema for assigning products into a category; returns per-item success. |

---

## cms — content collections

*SEED.md §3: one collection per `intent.cms.collections` entry, `itemCount` items each; collections are **public-read**; keep `collectionIds{}`, `itemIds{}`, field keys.*

| Tier | Page | What it settles |
|---|---|---|
| 1 | <https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-schema-management.md> | Collection creation: the field schema + permissions block, with the critical gotcha that **read must be public (ANYONE)** while writes stay admin-only, so visitors can read on the frontend. |
| 1 | <https://dev.wix.com/docs/api-reference/business-solutions/cms/skills/cms-data-items-crud.md> | Populating: items insert only into an existing collection; bulk-insert (with entity return) seeds many items and returns their IDs; data keys must match the schema; multi-reference fields can't be set at insert. |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/cms/sample-flows.md> | End-to-end ordering: create each public-read collection first, then bulk-insert its items; shows reference wiring between collections. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/create-data-collection.md> | Method schema for create-collection: needs an id, at least one field, and a permissions object (omit any and it fails); returns the collection ID. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/bulk-insert-data-items.md> | Method schema for bulk item insert — request/response shape and returned item IDs. |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-permissions/update-permissions.md> — only if a collection was created without public read; flips item-read to public after the fact.

---

## forms — lead-capture forms

*SEED.md §3: one form per `intent.forms.forms` entry, fields from the entry; keep `formIds[]` and each field's **`target`** key (frontend input `name` = target). Wix Forms is the standalone CRM API — **not** the events/bookings registration form.*

| Tier | Page | What it settles |
|---|---|---|
| 2 | <https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/sample-flows.md> | Lead-capture flow: create the form to define its fields, then keep the returned form id. |
| 3 | <https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form.md> | The standalone Wix Forms create-form (form schemas) method under CRM — defines the fields and each field's **`target`** key, plus namespace; returns the form id. This is NOT the events/bookings registration form. |

---

## events — an RSVP occasion, or upcoming events

*SEED.md §3: an **RSVP occasion** = one RSVP-type event with real details + a **future** date/time (registration form is built-in, so no form fields); or a **listing** = `intent.events.eventCount` events with future start dates. Keep `eventIds[]`, slugs.*

| Tier | Page | What it settles |
|---|---|---|
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/events/rsvp-business-flow.md> | The RSVP-occasion flow: mark the event RSVP-type and put details in the RSVP registration block; the form is **built-in** (name + email required, can't be removed), so no form fields are seeded; create then publish to go live. |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/sample-flow.md> | Worked example for full event setup (create → categorize → publish) — for the listing case; shows where the id and slug land and which fields are set at create. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/create-event.md> | Current create-event method: location + date/time settings (use **future** start/end), RSVP vs ticketed initial type (the two can't be converted later), and the draft flag. |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/publish-draft-event.md> — only if you create events as drafts; publishing is one-way, so seed published directly unless staging.

---

## bookings — bookable services

*SEED.md §3: `intent.bookings.serviceCount` services (name + short description, simple duration and price); use the **public** services endpoint, not the internal `/_api/` form; minimal availability; keep `serviceIds[]`, slugs.*

| Tier | Page | What it settles |
|---|---|---|
| 1 | <https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/create-and-update-booking-services.md> | The gold recipe: ordering (categories → staff → service → availability), online-booking must be enabled, payment-option validation rules, appointment services need staff by their **resource** id, and class/course need capacity + events. |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-set-up-a-service.md> | Step-ordered setup across service types (locations/staff/schedule/services/form) — what must exist before a service is bookable. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/create-service.md> | Create Service schema: required fields, duration via session durations, price under the payment block. Use the **public** services endpoint shown in the curl examples — NOT the internal `/_api/` form in the schema header. |

> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services.md> — use when seeding multiple services in one call.
> Optional: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-types.md> — read only if unsure which service type to use, since that drives staff/schedule requirements.

---

## pricing-plans — membership tiers

*SEED.md §3: `intent.pricing-plans.planCount` recurring plans (name, price, a **monthly** billing cycle); one create call per plan; keep `planIds[]`.*

| Tier | Page | What it settles |
|---|---|---|
| 1 | <https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/skills/create-and-update-pricing-plans.md> | The gold recipe: end-to-end create/update for Plans V3. |
| 2 | <https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/sample-flows.md> | Step ordering for common plan-setup flows. |
| 3 | <https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan.md> | Create-plan method: a recurring monthly plan needs a monthly billing cycle on its pricing variant (on-purchase start, until-cancelled end) plus the flat-rate price. |

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
