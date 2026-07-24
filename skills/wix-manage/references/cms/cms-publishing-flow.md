---
name: "CMS Publishing Flow & Visible/Hidden (draft/publish)"
description: "Interact with CMS collections that gate items behind a draft/publish workflow — Visible/Hidden and Publishing Flow (Review). Covers detecting the mode, reading combined draft+live data, authoring/editing drafts, and publishing, unpublishing, reverting, and deleting items. Key endpoints: /wix-data/v2/items/publish-draft, /wix-data/v2/items/unpublish, /wix-data/v2/collections/add-plugin, and the `<collectionId>__drafts` shadow collection."
---
# CMS Publishing Flow & Visible/Hidden

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

Some CMS collections gate their items behind a **draft/publish workflow** instead of writing straight to the live site. This reference is for an agent that must **detect** whether a collection is in such a mode, **read** the right version of an item, and **drive item state transitions** (publish, unpublish, revert, delete) through the public Wix Data REST API.

There are two mode families:

- **Visible / Hidden (VH)** — an item is either **draft** (hidden from the site) or **published** (visible). Backed by the collection **Publish plugin**.
- **Publishing Flow (PF) / Review** — the CMS layers a review workflow on top, giving each item one of three states — **DRAFT**, **PUBLISHED**, **CHANGED** (a published item that has a pending edit) — and adds a **publish permission** distinct from update. PF is the CMS/UI experience; at the public REST level it is driven by the same Publish-plugin + drafts-shadow mechanism described here.

The two are **mutually exclusive** on a collection.

## Prerequisites

1. Wix CMS enabled on the site (appDefId: `e593b0bd-b783-45b8-97c2-873d42aacaf4`)
2. The collection already exists (see [CMS Schema Management](cms-schema-management.md))
3. API access with CMS permissions. Publishing requires **Write Data Items** (`SCOPE.DC-DATA.WRITE`); enabling/disabling the workflow requires **Manage Data Collections** (`SCOPE.DC-DATA.DATA-COLLECTIONS-MANAGE`).

## Required APIs

- **Data Items API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction) — includes Publish Data Item Draft and Unpublish Data Item
- **Data Collections API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction) — Add/Delete Data Collection Plugin

---

## Mental model — where drafts live

A collection with the Publish workflow enabled has **two logical surfaces**:

| Surface | Collection ID | Holds |
|---------|---------------|-------|
| Published (live) | `<collectionId>` (e.g. `articles`) | Items visible on the site |
| Drafts shadow | `<collectionId>__drafts` (e.g. `articles__drafts`) | Pending drafts (new items not yet published, or edits to a published item) |

Item **state** is derived from where the item exists:

| State | Meaning | Where it lives |
|-------|---------|----------------|
| **DRAFT** | Not yet on the site | Only in `<collectionId>__drafts` |
| **PUBLISHED** | Live on the site, no pending edit | Only in `<collectionId>` (live) |
| **CHANGED** | Live on the site **and** has a pending draft edit | In both `<collectionId>` and `<collectionId>__drafts` |

> Always treat state as **server-authoritative**. Derive it from the live/draft surfaces (or the status the API returns) — never guess it client-side, and never render an optimistic status before the write confirms.

---

## 1. Detect the mode of a collection

Read the collection and inspect its **plugins**. A collection with the **Publish plugin** (`type: "PUBLISH"`) uses the draft/publish workflow.

```bash
curl -X GET \
'https://www.wixapis.com/wix-data/v2/collections/articles' \
-H 'Authorization: <AUTH>'
```

- **Publish plugin present** → the collection gates items behind draft/publish (VH, or PF/Review as surfaced in the CMS UI).
- **Publish plugin absent** → plain collection; every insert/update goes straight live. No draft surface exists.

The plugin also carries `publishOptions.defaultStatus` (`PUBLISHED` | `DRAFT`) — the state a newly-inserted item gets.

> **Verify exact field path.** The `type: "PUBLISH"` plugin and `publishOptions.defaultStatus` shapes are confirmed against the Add Data Collection Plugin schema. The exact key under which plugins are returned on the **collection GET response** (e.g. a `plugins` array) should be confirmed against a live response before relying on it programmatically.

### VH vs PF (Review) distinction

At the **CMS/UI layer**, the workflow is modeled as `ItemLifecycleMode`: `OFF` | `SHOW_HIDE` (Visible/Hidden) | `REVIEW` (Publishing Flow). VH and PF map to different internal schema plugins, and PF adds the CHANGED state plus a separate publish permission.

> **Verify exact shape.** The `ItemLifecycleMode` enum, the internal plugin identifiers used to tell VH apart from PF (legacy publish plugin vs a draft-items plugin), and the read-time status fields **`_publishingStatus`** / **`_changedFields`** are **CMS-internal (cms-web) constructs**. They are *not* confirmed to appear in the public REST contract. For a public-API agent, treat "is there a pending draft for this live item?" (CHANGED) as **derived from the live + drafts surfaces**, not from a public status field. Do not depend on `_publishingStatus`/`_changedFields` being present in REST responses without verifying against a live payload.

---

## 2. Read items (combined draft + live view)

By **default**, reads return only **published** items. To include drafts, set `publishPluginOptions.includeDraftItems: true` on the query (REST) — the SDK equivalent is the `showDrafts: true` option.

**Endpoint**: `POST /wix-data/v2/items/query`

```json
{
  "dataCollectionId": "articles",
  "query": {
    "filter": { "category": "news" },
    "paging": { "limit": 50, "offset": 0 }
  },
  "publishPluginOptions": {
    "includeDraftItems": true
  }
}
```

- With `includeDraftItems: true`, the response contains **both** published items and drafts.
- The same `publishPluginOptions.includeDraftItems` flag is accepted by **Get Data Item** to fetch a single item including its draft.
- To read **only** drafts, query the shadow collection directly: `dataCollectionId: "articles__drafts"`.

> **Verify exact shape for status/diff.** The public query returns items; it does not (verified) return a per-item `_publishingStatus` enum or a `_changedFields` diff list. Compute CHANGED by checking whether an item id exists in **both** the live and draft surfaces. If your integration observes `_publishingStatus`/`_changedFields` on responses, confirm them against the live payload — they are CMS-internal fields.

---

## 3. Write & transition items

### Author a brand-new draft

Insert into the **drafts shadow** collection. The item starts as **DRAFT**.

**Endpoint**: `POST /wix-data/v2/items`

```json
{
  "dataCollectionId": "articles__drafts",
  "dataItem": {
    "data": { "title": "Draft headline", "body": "Work in progress" }
  }
}
```

### Edit a draft

Update or patch against the **drafts shadow** collection (`articles__drafts`). See [CMS Data Items CRUD](cms-data-items-crud.md) for Update/Patch shapes.

### Edit a PUBLISHED item → produces CHANGED

Editing a live item does **not** overwrite the live copy directly in a review workflow — it creates/updates a **pending draft**, leaving the live version untouched until published. In practice, write the edit to the **drafts shadow** collection (`articles__drafts`) for the same item id; the live item now has a pending draft (state **CHANGED**).

> **Verify exact shape.** The CMS frontend triggers this "create a draft before updating a published item" step for you. Whether the public REST layer auto-creates the draft on an ordinary Update against the **live** collection, versus requiring the write to target the **drafts shadow** collection, should be confirmed against a live call. The safe, verified path is: write edits of a live item to `articles__drafts`.

### Publish a pending draft (DRAFT/CHANGED → PUBLISHED)

Replaces the published item's data with the draft's content; the draft is then deleted. Pass the **published** collection id.

**Endpoint**: `POST /wix-data/v2/items/publish-draft`

```bash
curl -X POST \
'https://www.wixapis.com/wix-data/v2/items/publish-draft' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
    "dataCollectionId": "articles",
    "dataItemId": "5331fc15-9441-4fd4-bc7b-7f6870c69228"
}'
```

**Response** — the newly-published item (the draft is gone):
```json
{
  "dataItem": {
    "id": "5331fc15-9441-4fd4-bc7b-7f6870c69228",
    "dataCollectionId": "articles",
    "data": { "_id": "5331fc15-...", "title": "Draft headline" }
  }
}
```

- Returns `NOT_FOUND` if no pending draft exists for that id.

### Unpublish a live item (PUBLISHED/CHANGED → DRAFT)

Retracts a published item back to draft state. Pass the **published** collection id.

**Endpoint**: `POST /wix-data/v2/items/unpublish`

```bash
curl -X POST \
'https://www.wixapis.com/wix-data/v2/items/unpublish' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
    "dataCollectionId": "articles",
    "dataItemId": "5331fc15-9441-4fd4-bc7b-7f6870c69228",
    "copyToDraft": true
}'
```

`copyToDraft` controls the two "keep vs discard" variants:

| `copyToDraft` | Behavior | Use for |
|---------------|----------|---------|
| `true` (default) | Removes the live copy, creates a draft seeded with the previously-published data. Any existing pending draft for that id is **overwritten**. | "Unpublish and keep changes" |
| `false` | Removes the live copy **without** creating a draft. No `dataItem` returned. | "Unpublish and discard" |

- Response (`copyToDraft: true`) carries the **new draft**, not the removed live item.
- Returns `NOT_FOUND` if no published item exists with that id.

### Revert to live version (CHANGED → PUBLISHED, discard the pending edit)

Discard the pending draft while keeping the live version as-is: **delete the item from the drafts shadow collection**.

```bash
curl -X DELETE \
'https://www.wixapis.com/wix-data/v2/items/5331fc15-...?dataCollectionId=articles__drafts' \
-H 'Authorization: <AUTH>'
```

> **Verify exact endpoint.** There is no dedicated "discard draft" REST method found in the public docs; deleting the item from `<collectionId>__drafts` is the derived approach. Confirm against a live call that this leaves the published version untouched.

### Delete an item entirely (removes both versions)

Deleting must remove **both** the live item and any pending draft.

```bash
# live version
curl -X DELETE 'https://www.wixapis.com/wix-data/v2/items/<id>?dataCollectionId=articles' -H 'Authorization: <AUTH>'
# draft shadow, if a draft exists
curl -X DELETE 'https://www.wixapis.com/wix-data/v2/items/<id>?dataCollectionId=articles__drafts' -H 'Authorization: <AUTH>'
```

> **Verify exact endpoint / atomicity.** Whether a single Delete against the published collection cascades to the draft shadow (atomic delete of both versions) is a backend concern that should be confirmed. If it does not cascade, delete both surfaces as shown.

---

## 4. Enable / disable the workflow on a collection

**Enable** — add the Publish plugin (requires Manage Data Collections scope):

**Endpoint**: `POST /wix-data/v2/collections/add-plugin`

```bash
curl -X POST 'https://www.wixapis.com/wix-data/v2/collections/add-plugin' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
        "dataCollectionId": "articles",
        "plugin": {
            "type": "PUBLISH",
            "publishOptions": { "defaultStatus": "PUBLISHED" }
        }
  }'
```

- Adding a plugin of a type that already exists **fails** — this is what enforces VH ⇄ PF mutual exclusivity at the plugin level.
- `defaultStatus: "DRAFT"` makes new items start hidden; `"PUBLISHED"` makes them start live.

**Disable** — remove the plugin:

**Endpoint**: `POST /wix-data/v2/collections/delete-plugin` (Delete Data Collection Plugin)

> **Verify exact shape.** The delete-plugin request body (whether it takes `pluginType` / a `plugin.type` / a plugin id) should be confirmed from the [Delete Data Collection Plugin](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/delete-data-collection-plugin) reference before calling. The **VH → PF** (and reverse) transition — swapping one plugin for another and how existing drafts/live items are migrated — is a CMS-orchestrated flow; treat the item-level effects as **verify before relying on**.

---

## Permissions — what a caller can and can't do

Publishing Flow separates two capabilities (as surfaced in the CMS permissions model):

| Capability | Governs | Transitions it gates |
|------------|---------|----------------------|
| **manageDrafts** | Create / edit drafts | Author a draft, edit a live item into CHANGED, **Revert to live version** (discard draft) |
| **managePublishStatus** | Change what is live | **Publish** a draft, **Unpublish** a live item |

An agent whose caller has `manageDrafts` but **not** `managePublishStatus` can prepare and revert drafts but cannot make them live or take them down — the "content editor who cannot publish" case.

At the REST level, both draft edits and publish/unpublish require **Write Data Items** (`SCOPE.DC-DATA.WRITE`); the finer split is applied by CMS permissions on the collection.

> **Verify exact shape.** The `manageDrafts` / `managePublishStatus` split is a CMS-internal permission model. Confirm how these map to the public collection permission fields / scopes before gating behavior on them programmatically.

---

## Decision table — collection + desired action → API + permission

| Collection state | Desired action | API call | Permission needed |
|------------------|----------------|----------|-------------------|
| Publish plugin absent | Any write | Normal insert/update — writes go live immediately | Write Data Items |
| Publish enabled | Detect mode | `GET /collections/{id}` → inspect plugins | (read) |
| Publish enabled | Read live + drafts together | `POST /items/query` with `publishPluginOptions.includeDraftItems: true` | read |
| Publish enabled | Read only drafts | `POST /items/query` on `<id>__drafts` | read |
| Publish enabled | Create new draft (→ DRAFT) | `POST /items` on `<id>__drafts` | manageDrafts (Write Data Items) |
| PUBLISHED | Edit into a pending draft (→ CHANGED) | Update/Patch on `<id>__drafts` | manageDrafts (Write Data Items) |
| DRAFT / CHANGED | Publish (→ PUBLISHED) | `POST /items/publish-draft` (published id) | managePublishStatus (Write Data Items) |
| PUBLISHED / CHANGED | Unpublish, keep as draft (→ DRAFT) | `POST /items/unpublish` `copyToDraft:true` | managePublishStatus (Write Data Items) |
| PUBLISHED / CHANGED | Unpublish, discard | `POST /items/unpublish` `copyToDraft:false` | managePublishStatus (Write Data Items) |
| CHANGED | Revert to live version (discard edit) | `DELETE /items/{id}?dataCollectionId=<id>__drafts` | manageDrafts (Write Data Items) |
| any | Delete entirely (both versions) | Delete on `<id>` (+ `<id>__drafts` if present) | Write Data Items |
| NATIVE, no plugin | Enable workflow | `POST /collections/add-plugin` type `PUBLISH` | Manage Data Collections |

---

## Agent gotchas

- **Status is server-authoritative.** Derive DRAFT/PUBLISHED/CHANGED from the live + drafts surfaces (or the value the API returns). Never compute it locally, and never render an optimistic status before the write confirms (**confirm-then-render**).
- **Reads default to published-only.** You must opt in with `publishPluginOptions.includeDraftItems: true` (REST) / `showDrafts: true` (SDK) to see drafts.
- **Pass the *published* collection id** to `publish-draft` and `unpublish` — not the `__drafts` shadow id. Author/edit drafts against the `__drafts` shadow id.
- **Publishing deletes the draft.** After `publish-draft`, the pending draft no longer exists; the returned item is the live one.
- **Unpublish overwrites an existing draft** when `copyToDraft: true` — any pending edit for that id is replaced with the previously-published data.
- **Refetch after publish/unpublish.** State changes across the live/draft surfaces are not guaranteed atomic across multiple references; re-query siblings rather than assuming local state. Wix Data is eventually consistent — use `consistentRead: true` if you must read immediately after a write.
- **`_publishingStatus` / `_changedFields` are CMS-internal.** Don't send them in write payloads and don't rely on them in public REST responses without verifying against a live call.
- **Phase-1 non-goals (do not attempt via this workflow):** bulk publish, partial (field-level) publish, scheduled publishing, and cell-level / side-by-side diff of a CHANGED item. There is no verified public API for these in the review workflow.

---

## Unverified against public docs — confirm before relying on

The following were **not** confirmed in the public Wix REST documentation and are flagged inline above; verify each against a live call or the method schema before depending on it:

1. The exact key/array under which plugins are returned on the **collection GET response** (for detecting the Publish plugin).
2. Public existence/shape of per-item **`_publishingStatus`** and **`_changedFields`** — these are CMS-internal (cms-web) fields.
3. The `ItemLifecycleMode` enum and the internal plugin ids that distinguish **VH (SHOW_HIDE)** from **PF (REVIEW)**.
4. Whether an ordinary Update against the **live** collection auto-creates a draft (→ CHANGED), versus requiring the edit to target `<id>__drafts`.
5. A dedicated **discard-draft** endpoint (the doc-derived approach is deleting the item from `<id>__drafts`).
6. Whether Delete on the published collection **cascades** to the draft shadow (atomic delete of both versions).
7. The **Delete Data Collection Plugin** request body shape, and the item-level effects of the **VH ⇄ PF migration**.
8. The mapping of the CMS **`manageDrafts` / `managePublishStatus`** permission split onto public collection permission fields / scopes.

---

## Related Documentation

- [Publish Data Item Draft](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/publish-data-item-draft)
- [Unpublish Data Item](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/unpublish-data-item)
- [Add Data Collection Plugin](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/add-data-collection-plugin)
- [Delete Data Collection Plugin](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/delete-data-collection-plugin)
- [CMS Data Items CRUD](cms-data-items-crud.md) — insert/update/patch/delete/query shapes
- [CMS Schema Management](cms-schema-management.md) — creating and modifying collections
- [Wix Data and Eventual Consistency](https://dev.wix.com/docs/api-reference/business-solutions/cms/eventual-consistency)
</content>
</invoke>
