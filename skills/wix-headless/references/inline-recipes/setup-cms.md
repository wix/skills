---
name: "Setup CMS"
description: Initializes a Wix CMS (Wix Data) backend — creates each collection with a public-read permissions block and the field schema, then bulk-inserts items (real field values) and verifies they persisted; wires multi-reference links when collections relate. Specifies the *how* (calls + format); which collections, fields, and counts come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix CMS (Wix Data v2)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for preparing any new Wix site that uses the **Wix CMS** (Wix Data) to hold content collections (team directory, FAQ, portfolio items, resources, recipes — any repeated structured content).
**Notice** this recipe is for **initial backend setup ONLY**, not for coding the frontend.

> **This recipe is the *how*, not the *what*.** Which collections to create, their fields, and how many items each holds is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide the schema or quantities.

> **API surfaces:** Wix CMS uses the **Wix Data v2** API on `https://www.wixapis.com/wix-data/v2/...` — collections under `/collections`, items under `/items` and `/bulk/items/*`. The CMS (Wix Data) app's `appDefId` is `e593b0bd-b783-45b8-97c2-873d42aacaf4` (an unmet `WDE0110` error means the app isn't installed). There is no V1/V3 split here — everything is `/wix-data/v2/`.

---

## Article: Steps for Setting Up Wix CMS
**YOU MUST** complete the steps in order, without requiring additional user input: create each collection (STEP 1) before inserting its items (STEP 2), and verify (STEP 3) before wiring any references (STEP 4). Items can only be inserted into a collection that already exists. The **Attach images** step runs **only when imagery is on** — skip it entirely otherwise.

### STEP 1: Create each collection (public-read)

Create one collection per entry the request names. **How many collections, their `id`/`displayName`, and their field schema come from the request you're fulfilling — this step only gives the call and the required format.**

Use the **Create Data Collection** endpoint: `POST https://www.wixapis.com/wix-data/v2/collections`.

```json
{
  "collection": {
    "id": "team-members",
    "displayName": "Team Members",
    "fields": [
      { "key": "name",  "displayName": "Name",  "type": "TEXT" },
      { "key": "role",  "displayName": "Role",  "type": "TEXT" },
      { "key": "bio",   "displayName": "Bio",   "type": "RICH_TEXT" },
      { "key": "order", "displayName": "Order", "type": "NUMBER" }
    ],
    "permissions": {
      "insert": "ADMIN",
      "update": "ADMIN",
      "remove": "ADMIN",
      "read":   "ANYONE"
    }
  }
}
```

The response returns the created collection — its `id` is the value you sent (Wix does not rename it). Keep that `id` and the exact field `key`s; the items step and the frontend both bind by them.

**⚠️ CRITICAL: the `permissions` block is mandatory, and for a PUBLIC collection `read` MUST be `"ANYONE"`.** A headless frontend reads with an **anonymous visitor token** and **cannot elevate** (a pure SPA/static site has no server; even on Astro the read path is visitor-scoped). If a **public** collection's `read` is anything but `ANYONE`, the visitor query returns **zero items with no error** — the page looks empty and it reads like a query bug when it's really a permissions bug. So default to `read: "ANYONE"`. **The one exception is a deliberately member-scoped collection** (opt-in, members login in the run) — see "Member-scoped collections" below, where `read` is `SITE_MEMBER`/`SITE_MEMBER_AUTHOR` on purpose and an anonymous empty read is the gate, not a bug. Omitting the whole `permissions` object fails the create either way.

**⚠️ Write permissions: `ADMIN` by default; open them ONLY for a collection the site lets visitors write.** Most collections hold **admin-owned content** (the catalog, the team, the articles) — visitors only read them, so keep `insert`/`update`/`remove` at `"ADMIN"` (only this seed token writes; a visitor write to an `ADMIN` collection 403s). But when the request models **visitor-written, shared data** — a guestbook, a community board, a collaborative list anyone can add to and edit — that collection must be **visitor-writable**, so set the verbs the site uses to `"ANYONE"`:

```json
"permissions": { "read": "ANYONE", "insert": "ANYONE", "update": "ANYONE", "remove": "ANYONE" }
```

Which collection (if any) is visitor-writable comes from the request; this step only gives the permission shape.

**⚠️ With an ANONYMOUS visitor token there is NO per-user identity — an `ANYONE`-writable collection is SHARED and unscoped.** Every anonymous visitor authenticates as the same kind of identity, so on the **anonymous** path the only open-write level that works is **`ANYONE`**, which means **any visitor can edit or delete any row** (the data is global/shared, not per-user, not per-device). That's correct for a collaborative board. **For per-user-private data, use the member-scoped variant below** — it needs a logged-in member. Don't open `insert`/`update`/`remove` to `ANYONE` on a collection that shouldn't be globally editable.

#### Member-scoped collections (opt-in — only when the run includes members login)

**Only create these when the request calls for per-user or member-only data AND members login is part of the run** (an account area, "my saved items", "members-only content"). Otherwise stay with the public-read / collaborative shapes above — this is **not** a default. A member-scoped collection needs a **logged-in member**; it runs on the **member token (the identity layer — login, no Members Area app install, no `auth.elevate`)**, and the platform enforces the scoping server-side from the caller's member identity. The role vocabulary the `permissions` block accepts, highest-to-lowest: `ADMIN` › `SITE_MEMBER_AUTHOR` › `SITE_MEMBER` › `ANYONE`. Two member shapes:

```jsonc
// Per-user-private ("my …" data — each member sees/edits only their OWN rows, scoped by the item's _owner)
"permissions": { "read": "SITE_MEMBER_AUTHOR", "insert": "SITE_MEMBER", "update": "SITE_MEMBER_AUTHOR", "remove": "SITE_MEMBER_AUTHOR" }

// Shared member-only (any logged-in member reads; only the seed/admin writes — gated content)
"permissions": { "read": "SITE_MEMBER", "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN" }
```

- **`SITE_MEMBER_AUTHOR`** = a signed-in member, **restricted to items they created** (the platform matches the item's `_owner` to the caller). `insert` is `SITE_MEMBER` (a member can create — the insert stamps them as owner; **don't set `_owner` yourself**), while `read`/`update`/`remove` are `SITE_MEMBER_AUTHOR` so each member touches only their own rows. This is the clean solution to per-user-private data — **no server code, no elevation, works on a pure SPA**, because the member token carries the identity the visitor token lacked.
- **`SITE_MEMBER`** = **any** signed-in member (not owner-scoped) — use for content every member may read but only the site writes.
- **An anonymous visitor reading a member-scoped collection gets ZERO items — that is the gate working, not the empty-page bug above.** Only treat an empty read as a seed defect on an `ANYONE`-read collection; on a `SITE_MEMBER*` collection an empty anonymous read is expected (the frontend must gate it behind login — see `how-to-code-cms.md`). Seeding items into a `SITE_MEMBER_AUTHOR` collection with the **admin/seed token** makes their `_owner` the admin, so no member will see them — seed such a collection **empty** (members populate it themselves) unless the brief wants admin-owned member-readable rows (then use the shared `SITE_MEMBER` shape).

**⚠️ CRITICAL: collection `id` has NO namespace.** A user-created (`NATIVE`) collection's `id` is just the name you choose (`"team-members"`, `"faq"`, `"Projects"`) — the `<namespace>/<name>` form (`Members/PublicData`) is **only** for Wix App collections. Use the exact `id` you set here everywhere downstream; the dashboard display name may differ from the `id`, so never guess it — keep the one you sent.

**Field types** (set `type` per field): `TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `DATETIME`, `URL`, `EMAIL`, `IMAGE`, `RICH_TEXT` / `RICH_CONTENT` (Ricos), `ARRAY_STRING`, `OBJECT`, `REFERENCE` (single), `MULTI_REFERENCE`. Use `RICH_TEXT`/`RICH_CONTENT` for formatted body copy and `TEXT` for plain strings. A `RICH_TEXT` field accepts an **HTML string** (`"<p>…</p>"`) at insert — it is stored verbatim, not coerced.

**⚠️ CRITICAL: a `MULTI_REFERENCE` (or single `REFERENCE`) field needs a `typeMetadata` binding, and the key is `referencedCollectionId` — NOT `referencedCollection`.** A reference field declared with only `{ "type": "MULTI_REFERENCE" }` (no metadata) creates a field whose target is **empty**, and every later reference wiring (STEP 4) reports success but **never resolves** — the links are silently dead. The binding lives under `typeMetadata.multiReference`:

```json
{
  "key": "categories",
  "displayName": "Categories",
  "type": "MULTI_REFERENCE",
  "typeMetadata": {
    "multiReference": {
      "referencedCollectionId": "recipe-categories",
      "referencingFieldKey": "recipes",
      "referencingDisplayName": "Recipes"
    }
  }
}
```

`referencedCollectionId` is the **target** collection's id (so that collection must be created first — order your STEP 1 creates accordingly); `referencingFieldKey`/`referencingDisplayName` name the auto-created back-reference on the target. **Beware: the official Create-Data-Collection docs example uses `referencedCollection` — the API accepts that payload with `200` but silently stores an empty `referencedCollectionId`, leaving a broken field.** Use `referencedCollectionId`. (A single `REFERENCE` field uses `typeMetadata.reference.referencedCollectionId` likewise.)

**⚠️ A fresh site's Wix Data backend can fail the FIRST few calls transiently while it propagates — retry the failed call ONCE, then proceed.** On a brand-new site the data backend may not be fully provisioned for the opening calls, surfacing as either of two same-root-cause errors that **self-heal within a few seconds**:
- **`403`** on collection-create (STEP 1), or
- **`400 WDE0117: "MetaSite not found"`** on a bulk item-insert (STEP 2).

Both are provisioning races, not payload bugs (the identical body succeeds on retry). On a `403` / `400 WDE0117` / `5xx` for any create or insert, wait briefly and **retry the failed call once with the same body**. **Do not loop** — a spiralling retry is a wasted headless run. If the single retry still fails, surface the response verbatim and fail loud.

### STEP 2: Bulk-insert each collection's items (with field data)

Populate each collection in a **single bulk call** per collection. **How many items and their content come from the request you're fulfilling — this step only gives the call and the required format.**

Use **Bulk Insert Data Items**: `POST https://www.wixapis.com/wix-data/v2/bulk/items/insert` (one call per collection; `dataCollectionId` is single-valued, so fire one bulk call per collection — these can run in parallel across collections). For a collection with a **single** item, the single-insert endpoint `POST /wix-data/v2/items` (body `{ "dataCollectionId": "...", "dataItem": { "data": {...} } }`) is equivalent.

```json
{
  "dataCollectionId": "team-members",
  "dataItems": [
    { "data": { "name": "Ada Lovelace", "role": "Founder", "bio": "<p>Builds the things.</p>", "order": 1 } },
    { "data": { "name": "Alan Turing",  "role": "Engineer", "bio": "<p>Breaks the things.</p>", "order": 2 } }
  ],
  "returnEntity": true
}
```

**⚠️ CRITICAL: every field goes inside `data`, with real values — an empty `data: {}` creates an empty record.** The collection schema existing is not the same as the item having content. Populate **every** field the page will render (`name`, `role`, `bio`, …) in the `data` object. An item inserted with missing fields ships a "content coming soon"–looking blank on the live page, and the API accepts it without error — the failure is invisible until STEP 3.

**⚠️ CRITICAL: the `data` keys MUST match the collection's field `key`s exactly.** A key the schema doesn't have is silently dropped (or rejected as a validation error); a mismatched case/spelling reads back as a missing field. Use the exact `key`s from STEP 1.

**⚠️ CRITICAL: do NOT set a MULTI_REFERENCE value at insert — it is SILENTLY DROPPED (no error).** Putting a `categories: ["<id>"]` array in `data` does **not** raise an error (it does **not** throw `WDE0303` on the bulk endpoint) — the insert returns `200 success`, but the multi-reference value is **silently discarded** (absent from the stored item). So a multi-reference left in `data` looks like it worked and isn't there. Insert the items first with **plain fields only**, then wire multi-references in STEP 4. A **single** `REFERENCE` field *can* be set at insert by passing the referenced item's `_id` string as the field value (`"venue": "<referenced-item-id>"`).

**⚠️ Reading the response — created items are under `results[].dataItem`, NOT `results[].item`.** A successful bulk insert returns the standard Wix bulk shape (note the per-item wrapper is **`dataItem`**, not `item`):

```json
{ "results": [
    { "action": "INSERT",
      "itemMetadata": { "id": "<itemId>", "originalIndex": 0, "success": true },
      "dataItem": { "id": "<itemId>", "dataCollectionId": "team-members",
                    "data": { "_id": "<itemId>", "name": "Ada Lovelace", "role": "Founder", "_createdDate": { "$date": "..." } } } }
  ],
  "bulkActionMetadata": { "totalSuccesses": 2, "totalFailures": 0 }
}
```

(The **single**-insert endpoint returns the same wrapper for one item: `{ "dataItem": { "id": "<itemId>", "data": { "_id": "<itemId>", ... } } }`.) The item id is the wrapper's top-level **`id`** (mirrored as `data._id`) — read it from `results[].dataItem.id` (bulk) or `dataItem.id` (single). There is **no** `results[].item` key — reading it finds nothing and makes a successful insert look empty. If part of the bulk request fails (`bulkActionMetadata.totalFailures > 0`), retry the failed items **once** with the same format; do not loop.

### STEP 3: Verify the inserts (mandatory)

A POST without an error does **not** prove the content persisted. After inserting, **query each collection once** and confirm every field you sent is present in the stored items.

Use **Query Data Items**: `POST https://www.wixapis.com/wix-data/v2/items/query` with body `{ "dataCollectionId": "<collection>" }`. For every returned item, confirm its `data` carries every field you POSTed. If a field is missing, re-insert that item once (DELETE then insert is safest — a PUT replaces the whole record) and re-verify; if it still fails, surface the missing-field error verbatim rather than reporting success.

### STEP 4: Wire multi-references (only if collections relate)

**Skip this step unless the request models a relationship** (e.g. a project → its team members, an article → its tags) as a `MULTI_REFERENCE` field. Single `REFERENCE` fields were already set in STEP 2.

Use **Bulk Insert Reference Data Items**: `POST https://www.wixapis.com/wix-data/v2/bulk/items/insert-references` — link a referring item's multi-reference field to one or more referenced item ids. (`/items/replace-references` replaces the whole set; `/bulk/items/remove-references` unlinks.) Both ids come from the STEP 2 responses.

**⚠️ CRITICAL: the body key is `dataItemReferences`, and each entry uses `referringItemFieldName` / `referringItemId` / `referencedItemId`.** The natural-looking shape (`references: [{ referencingItemId, referencedItemId }]` + a top-level `referenceProperty`) is **rejected with `400 WDE0080` "dataItemReferences must not be empty"**. Use exactly:

```json
{
  "dataCollectionId": "recipes",
  "dataItemReferences": [
    { "referringItemFieldName": "categories", "referringItemId": "<recipeId>", "referencedItemId": "<categoryId>" }
  ]
}
```

`referringItemFieldName` is the multi-reference field's key on the **referring** collection (`recipes.categories`); `referringItemId` is that item's id; `referencedItemId` is the target item's id.

**⚠️ References only resolve if the field was created with a non-empty `referencedCollectionId` (STEP 1).** This call can return `200` / `totalSuccesses` even when the field's target binding is empty — but then a read with `.include("categories")` (or `query-referenced`) returns nothing (and `query-referenced` errors `WDE0020 "Provided property [] is not a multi-reference field"`). If references insert "successfully" but never appear on reads, the field's `referencedCollectionId` was empty at create time — fix the STEP 1 field definition, not this call.

### Attach images (imagery ON only — skip otherwise)

**Only when `imagery` is on** (`SEED.md` § "Entity images"). This is the CMS entry in the required pass-2 "attach the generated image to the entity" flow — items were inserted text-only earlier (any `IMAGE` field left blank); now write the image onto each. It presumes the collection has an `IMAGE`-type field (from the field schema at create time). Generate + import per `references/IMAGE_GENERATION.md` and keep `file.url` (the permanent `wixstatic.com` URL — an `IMAGE` field stores the URL string).

**⚠️ Use read-merge-PUT, not PATCH.** A partial JsonPatch is fragile here; instead query the item, merge the image URL into its `data`, and PUT the **whole** record back:

1. **Read** the item — `POST https://www.wixapis.com/wix-data/v2/items/query` with `{ "dataCollectionId": "<collection>" }` (or filter to the one item). Keep its full `data` (including `_id`).
2. **Merge** the image URL into the item's image field key (e.g. `data.photo = "<file.url>"`), leaving every other field intact.
3. **PUT** the whole record — `PUT https://www.wixapis.com/wix-data/v2/items/<itemId>`:

```json
{ "dataCollectionId": "<collection>", "dataItem": { "data": { "_id": "<itemId>", "name": "…", "role": "…", "photo": "<file.url>" } } }
```

- **PUT replaces the entire record** — you must send back **all** existing fields (from step 1), not just the image, or the omitted fields are wiped. This is why you read-merge-PUT rather than sending the image alone.
- **Never block on image failure** (`SEED.md` § "Entity images" / IMAGE_GENERATION "Credits, cost & the not-generating fallback") — on failure, skip and leave the item text-only.

---

## Conclusion
Following these steps **in order** sets up a Wix CMS backend:
- Every collection is created with a `permissions` block whose **`read` is `ANYONE`**, so the headless visitor frontend can read it (the single most common "empty page" cause).
- Write verbs are **`ADMIN` by default** (visitor reads only); a collection the site lets visitors write is created with `insert`/`update`/`remove` at **`ANYONE`** (the only open-write level the anonymous visitor token supports — the data is then global/shared, with no per-user scoping).
- **(Opt-in, members only)** a per-user-private or member-only collection is created with a **member-scoped** `permissions` block — `SITE_MEMBER_AUTHOR` (own rows only, `_owner`-matched) or `SITE_MEMBER` (any logged-in member) — which runs on the **member token** (login/identity layer, no Members Area install, no elevate). This is the per-user scoping the anonymous path can't do; add it only when the brief asks and members login is in the run, and expect anonymous reads to return empty (the gate).
- Native collection `id`s carry **no namespace** and are kept verbatim for the frontend to bind to.
- Every item is bulk-inserted with **real field values** in `data` (keys matching the schema) and **verified to have persisted**.
- Reference fields are created with a non-empty `typeMetadata…referencedCollectionId` (the working key, not the docs' stale `referencedCollection`); multi-references are then wired with the reference endpoint's `dataItemReferences[]` shape (never set at insert — they're silently dropped there), and single references by item-id at insert.
- **When imagery is on**, each item's `IMAGE` field is filled by the **Attach images** step (pass-2) via **read-merge-PUT** (`PUT …/items/{id}` with the full merged record — a partial PUT wipes omitted fields), storing `file.url`; on failure the item stays text-only.
- **Keep** per collection: the `collectionId`, the field `key`s, and the `itemIds[]` — these are the producer for the coding handoff.
