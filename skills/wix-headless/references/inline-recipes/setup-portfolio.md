---
name: "Setup Portfolio"
description: Initializes a Wix Portfolio backend — cleans the install's default sample collection + projects, then creates collections and creates projects assigned to them via collectionIds (collections before projects). Specifies the *how* (calls + format); the collection/project counts and names come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Portfolio

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` **and** `wix-site-id: <SITE_ID>`. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for preparing any new Wix site that uses the Wix Portfolio app.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial portfolio setup.

> **This recipe is the *how*, not the *what*.** What to seed — how many collections, which ones, how many projects and their titles/descriptions — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities or which entities to create.

> **API surfaces:** everything is the Portfolio **v1** API on `https://www.wixapis.com/portfolio/v1/...` — `/collections` and `/projects`. Use the **public `/portfolio/v1/...`** form; the method pages' schema headers show an internal `/portfolio/collections/api/v1/...` / `/portfolio/projects/projects/api/v1/...` URL — **do not** call those.

> **Visibility is `hidden`, not `visible` — and it defaults to visible.** Portfolio's polarity is the **inverse** of Stores/Restaurants: entities carry a `hidden` boolean that **defaults to `false` (shown)**. So a collection/project created with no `hidden` field **appears on the live site** — you do **not** need to set anything to make it visible. Only set `"hidden": true` to hide one. (Send a plain boolean — `"hidden": false` — never a `{"value": …}` wrapper.) **Note:** when you omit `hidden` (or send `false`), the field is **absent** from the create/list response — proto3 drops false defaults — so *absent* reads as *false* reads as *shown*; `hidden` appears in the response only when you explicitly sent `true`. Don't treat a missing `hidden` as an error.

---

## Article: Steps for Setting Up Wix Portfolio
**YOU MUST** complete all the following steps **in the given order** (0-2, plus 3 when imagery is on) without skipping any and **without requiring additional user input**.

**⚠️ CRITICAL ORDER REQUIREMENT: create the COLLECTIONS first (STEP 1), then the PROJECTS (STEP 2).** A project is assigned to collections by a `collectionIds` array, and **that array is NOT validated on create** — a wrong or nonexistent collection id is **silently accepted**, producing an orphan project that appears under no collection. The only way to assign correctly is to create the collections first, read back their real ids, and thread those exact ids into each project. (There is **no** shared-revision `409` race — creating collections/projects concurrently is safe — but the id dependency still forces collections-before-projects.)

### STEP 0: Clean the portfolio — remove the default sample data

A freshly installed Wix Portfolio app comes pre-seeded with **one sample collection ("My Portfolio") and several sample projects** ("Editorial Portraits", "Seasonal Lookbook", …), all assigned to that collection. Remove them **before** creating yours, so the site shows only your content. Do this **first** — cleaning before you create guarantees the ids you delete are the install's samples, never your own.

**Delete children before the parent — projects first, then collections.** (Deleting a collection does not clean up the projects that reference it.)

1. **List the projects** — `GET https://www.wixapis.com/portfolio/v1/projects`. The projects are under `response.projects[]` (count at `response.metadata.count`). Collect every `project.id`.
2. **Delete each project** — `DELETE https://www.wixapis.com/portfolio/v1/projects/{projectId}`, one call per id (there is **no** bulk-delete for projects). Each returns `200`.
3. **List the collections** — `GET https://www.wixapis.com/portfolio/v1/collections` (`response.collections[]`); collect every `collection.id`.
4. **Delete each collection** — `DELETE https://www.wixapis.com/portfolio/v1/collections/{collectionId}`, one call per id. Each returns `200`.
5. **Verify** both lists now return `metadata.count: 0` before proceeding.

### STEP 1: Create the collections

Create the collections the request calls for — **which collections (and how many) come from the request**; this step only gives the call and format. Use **Create Collection**: `POST https://www.wixapis.com/portfolio/v1/collections`. There is **no bulk-create** — issue **one call per collection** (they may be fired concurrently — no `409` race — but sequential is just as correct and simplest).

The body wraps the entity in a `collection` object:

```json
{
  "collection": {
    "title": "Brand Identity",
    "description": "Logo systems and visual identities for growing companies.",
    "hidden": false
  }
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **The display name is `title`, not `name`.** A `name` field is ignored.
- **`slug` is optional — omit it and Wix auto-generates one from the title** (`"Brand Identity"` → `brand-identity`). Only send `slug` to force a specific one.
- **`hidden` is optional and defaults to `false` (shown)** — omit it for a visible collection; send `"hidden": true` only to hide one.
- **Text-only by default** — omit `coverImage` entirely (imagery is opt-in; see **Attach images**). `description` is a plain string.

**Reading the response — the created collection is under `collection`, not a top-level field.** A `200` returns:

```json
{ "collection": { "id": "<collectionId>", "revision": "1", "title": "Brand Identity",
  "slug": "brand-identity", "hidden": false, "sortOrder": 1783179721633, "url": { … } } }
```

Keep each **`collection.id`** (and `slug`) — the ids are the `collectionIds` you thread into projects in STEP 2. If a create fails, retry that collection **once** with the same body; do not loop.

### STEP 2: Create the projects, assigned to their collections

Create the projects the request calls for (counts/titles from the request). Use **Create Project**: `POST https://www.wixapis.com/portfolio/v1/projects` — **one call per project** (no bulk-create; concurrent is safe). Each project is assigned to one or more collections via **`collectionIds`**, populated with the **real ids from STEP 1**.

The body wraps the entity in a `project` object:

```json
{
  "project": {
    "title": "Northwind Rebrand",
    "description": "Full identity refresh for a logistics firm.",
    "collectionIds": ["<collectionId from STEP 1>"],
    "details": [
      { "label": "Role", "text": "Brand & Art Direction" },
      { "label": "Year", "text": "2025" }
    ],
    "hidden": false
  }
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **`collectionIds` must hold real ids captured from STEP 1.** They are **not validated** — a wrong/missing/guessed id is accepted silently and the project surfaces under no collection. Never invent a collection id; thread the STEP 1 response ids. A project with an **empty** `collectionIds: []` is created but belongs to no collection (only reachable from the all-projects list) — include at least one id unless the request truly wants an uncollected project.
- **The display name is `title`, not `name`.** `slug` auto-generates from the title when omitted.
- **`hidden` defaults to `false` (shown)** — same as collections; omit for visible.
- **`details` is optional** — an array of `{ label, text }` pairs (Role, Year, Client, …) that renders as the project's metadata. Include a couple where the brief gives that info; omit for a bare project (`details` comes back `[]`).
- **Text-only by default** — omit `coverImage` (see **Attach images**).

**Reading the response** — the created project is under `project`:

```json
{ "project": { "id": "<projectId>", "revision": "1", "title": "Northwind Rebrand",
  "slug": "northwind-rebrand", "hidden": false,
  "collectionIds": ["<collectionId>"], "details": [ … ] } }
```

Keep each **`project.id`** and `slug`. If a create fails, retry that project **once** with the same body; do not loop.

### Attach images (imagery opt-in — skip when imagery is off)

**Only if `imagery` is on** (`SEED.md` § "Entity images"). Portfolio is a visual showcase, so the cover-image-bearing entities are **both projects and collections**. Generate + import each image per `references/IMAGE_GENERATION.md` (generate → import to Wix Media → keep the WixMedia image **id**), then **PATCH the entity's `coverImage`**.

Attach to a project — `PATCH https://www.wixapis.com/portfolio/v1/projects/{projectId}` (collections are identical: `PATCH …/collections/{collectionId}` with a `collection` wrapper). Echo the entity's current **`revision`** (from the create response, or a fresh `GET`) — no field mask is needed:

```json
{
  "project": {
    "id": "<projectId>",
    "revision": "<current revision>",
    "coverImage": { "imageInfo": { "id": "<WixMedia image id>", "height": 2880, "width": 1920 } }
  }
}
```

- **`coverImage.imageInfo.id`** is the imported **WixMedia image id** (`file` id from the import step) — **and `height` + `width` are required** alongside it (`url` is read-only, returned populated). A missing revision or a stale one fails the PATCH.
- Image failures never block the run — skip and leave the entity text-only.

### Attach images — project gallery (imagery on only)

**Only if `imagery` is on.** The cover (attached just above) is just the **listing-card thumbnail**. A project's **media gallery** — the ordered images on its detail page, which the frontend reads via the SDK `projectItems.listProjectItems(projectId)` (`how-to-code-portfolio.md`) — is a **separate `item` entity you must create**, one call per image. Without this step an imagery-on project has a cover but an empty gallery.

```bash
curl -X POST 'https://www.wixapis.com/portfolio/v1/items' \   # lowercase `items` — `/Items` (capital) 404s
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "item": {
    "projectId": "<projectId from the create-projects step>",
    "sortOrder": 1,
    "title": "<image title>",
    "image": { "imageInfo": { "id": "<WixMedia image id>", "height": 896, "width": 1200 } }
  } }'
```

- **One call per image**; **`sortOrder`** (1, 2, 3…) sets the order the frontend renders. `image.imageInfo` is the same shape as `coverImage` (imported WixMedia id + height + width).
- **Response nests the created item under `item`** (a top-level empty `projectId:""` echo is also returned — ignore it).
- **⚠️ There is NO public list endpoint.** `GET /portfolio/v1/items?projectId=…`, `/projects/{id}/items`, `/items/project/{id}` **all 404** — do not hunt for one. To verify, `GET https://www.wixapis.com/portfolio/v1/items/{itemId}` one at a time; the frontend lists them via the SDK `projectItems.listProjectItems` (an internal URL the SDK resolves).
- **Cover vs items:** cover = listing thumbnail (the cover PATCH above); items = ordered detail-page gallery (this call). An imagery-on portfolio typically wants **both** — if a project has only its cover image, reuse that WixMedia id as item #1 so the gallery isn't empty.
- Item failures never block the run — skip and continue (a project with no items still renders from its cover).

---

## Conclusion
Following these steps **in order** sets up a new Wix Portfolio site:
- Starts from a **clean portfolio** — the install's default sample collection and projects are all removed first (projects before collections).
- Contains the collections and projects called for by the request, with **collections created first** so each project's `collectionIds` holds a real, verified collection id (the array is not validated, so a wrong id would silently orphan the project).
- Every collection and project is **shown** (`hidden` defaults to `false`) — nothing needs setting to be visible.
- Cover images are attached only when `imagery` is on; otherwise everything stays text-only. All calls use the Portfolio **v1** API.
