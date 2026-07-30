---
name: "CMS Draft & Publish Workflow (Draft Items plugin)"
description: "Interact with CMS collections that gate their items behind a draft/publish workflow via the Draft Items plugin. Covers detecting the plugin, locating the paired drafts collection, reading published vs draft items, authoring/editing drafts, and publishing, unpublishing, reverting, and deleting items. Key endpoints: /wix-data/v2/items/publish-draft, /wix-data/v2/items/unpublish, /wix-data/v2/collections/add-draft-items-plugin, and the paired drafts collection referenced by draftItemsPluginOptions.draftsCollectionId."
---
# CMS Draft & Publish Workflow

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

Some CMS collections gate their items behind a **draft/publish workflow** instead of writing straight to the live site. Such a collection has the **Draft Items plugin** installed. Each item is in one of three states — **DRAFT**, **PUBLISHED**, or **CHANGED** (a published item with a pending draft edit) — and edits are staged as drafts until explicitly published.

This reference is for an agent that must **detect** whether a collection uses this workflow, **read** the right version of an item, and **drive item state transitions** (publish, unpublish, revert, delete) through the public Wix Data REST API.

## Prerequisites

1. Wix CMS enabled on the site.
2. The collection already exists (see [CMS Schema Management](cms-schema-management.md)).
3. API access with write permission on the collection's data items (reading, authoring drafts, and publishing all go through the Data Items API), plus collection-management permission to add or remove the Draft Items plugin.

## Required APIs

- **Data Items API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction) — includes Publish Data Item Draft and Unpublish Data Item.
- **Data Collections API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction) — Add/Delete Data Collection Plugin.

---

## Mental model — where drafts live

A collection with the Draft Items plugin has **two paired surfaces**:

| Surface | Collection ID | Holds |
|---------|---------------|-------|
| Published (live) | the collection's own id (e.g. `articles`) | Items visible on the site |
| Paired drafts | `draftItemsPluginOptions.draftsCollectionId` (conventionally `<collectionId>__drafts`, e.g. `articles__drafts`) | Pending drafts (new items not yet published, or edits to a published item) |

**Read the drafts collection id from the plugin — do not assume the `__drafts` suffix.** The published collection's Draft Items plugin exposes `draftItemsPluginOptions.draftsCollectionId`; the drafts collection's plugin exposes `draftItemsPluginOptions.publishedCollectionId`. Resolve the pairing from those fields.

Item **state** is derived from where the item exists:

| State | Meaning | Where it lives |
|-------|---------|----------------|
| **DRAFT** | Not yet on the site | Only in the drafts collection |
| **PUBLISHED** | Live on the site, no pending edit | Only in the published collection |
| **CHANGED** | Live on the site **and** has a pending draft edit | In both the published and drafts collections |

> Treat state as **server-authoritative**. Derive it from the published/draft surfaces (or the item the API returns) — never render an optimistic status before the write confirms.

---

## 1. Detect the workflow on a collection

Read the collection and inspect its **plugins**. A collection with the **Draft Items plugin** uses the draft/publish workflow.

```bash
curl -X GET \
'https://www.wixapis.com/wix-data/v2/collections/articles' \
-H 'Authorization: <AUTH>'
```

- **Draft Items plugin present** → the collection gates items behind draft/publish. Its `draftItemsPluginOptions.draftsCollectionId` gives the paired drafts collection to author and edit drafts against.
- **Draft Items plugin absent** → plain collection; every insert/update goes straight live. No draft surface exists.

---

## 2. Read items

Reads target a specific surface — there is no merged view:

- **Published items**: query the published collection (`articles`).
- **Drafts**: query the drafts collection resolved from `draftItemsPluginOptions.draftsCollectionId` (e.g. `articles__drafts`).

**Endpoint**: `POST /wix-data/v2/items/query`

```json
{
  "dataCollectionId": "articles__drafts",
  "query": {
    "filter": { "category": "news" },
    "paging": { "limit": 50, "offset": 0 }
  }
}
```

- To read only **published** items, query with `dataCollectionId: "articles"`.
- To read **drafts**, query with `dataCollectionId` set to the paired drafts collection id.
- Compute **CHANGED** by checking whether an item id exists in **both** the published and drafts surfaces.

---

## 3. Write & transition items

### Author a brand-new draft

Insert into the **drafts** collection. The item starts as **DRAFT**.

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

Update or patch against the **drafts** collection (`articles__drafts`). See [CMS Data Items CRUD](cms-data-items-crud.md) for Update/Patch shapes.

### Edit a PUBLISHED item → produces CHANGED

Editing a live item does **not** overwrite the live copy — it stages a **pending draft**, leaving the published version untouched until published. The live item then has a pending draft (state **CHANGED**).

**Create the draft first, then edit it.** To edit a published item, explicitly create the draft via the **create-draft** flow (`createDataItemDraft`) rather than relying on an implicit draft-on-update. Create-draft seeds a full draft copy of the currently-published item into the drafts collection under the same item id; you then apply your edits to that draft. This is the more reliable path — a bare partial update straight to the drafts collection risks producing a draft that is missing the fields you didn't touch. So: create-draft for the published item id, then Update/Patch that draft on the drafts collection (`articles__drafts`).

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

Discard the pending draft while keeping the live version as-is: **delete the item from the drafts collection**.

```bash
curl -X DELETE \
'https://www.wixapis.com/wix-data/v2/items/5331fc15-...?dataCollectionId=articles__drafts' \
-H 'Authorization: <AUTH>'
```

### Delete an item entirely (removes both versions)

Deleting must remove **both** the live item and any pending draft.

```bash
# live version
curl -X DELETE 'https://www.wixapis.com/wix-data/v2/items/<id>?dataCollectionId=articles' -H 'Authorization: <AUTH>'
# drafts collection, if a draft exists
curl -X DELETE 'https://www.wixapis.com/wix-data/v2/items/<id>?dataCollectionId=articles__drafts' -H 'Authorization: <AUTH>'
```

---

## 4. Enable / disable the workflow on a collection

**Enable** — add the Draft Items plugin (requires collection-management permission). Use the dedicated endpoint; the Draft Items plugin cannot be added through the generic add-plugin call.

**Endpoint**: `POST /wix-data/v2/collections/add-draft-items-plugin`

```bash
curl -X POST 'https://www.wixapis.com/wix-data/v2/collections/add-draft-items-plugin' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
        "dataCollectionId": "articles",
        "publishPluginConflictAction": "FAIL_WHEN_PUBLISH_INSTALLED"
  }'
```

`publishPluginConflictAction` controls what happens if the legacy Publish plugin is already installed:

| Value | Behavior |
|-------|----------|
| `FAIL_WHEN_PUBLISH_INSTALLED` | Fail if the Publish plugin is already installed. |
| `COPY_DRAFT_ITEMS_WITH_DRAFT_STATUS` | Copy draft items with draft status; where a published version already exists, discard the draft item. |

**Disable** — remove the plugin:

**Endpoint**: `POST /wix-data/v2/collections/delete-draft-items-plugin`

```bash
curl -X POST 'https://www.wixapis.com/wix-data/v2/collections/delete-draft-items-plugin' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
        "dataCollectionId": "articles",
        "draftItemsRemovalAction": "FAIL_IF_DRAFT_ITEMS_EXIST"
  }'
```

`draftItemsRemovalAction` decides the fate of existing drafts:

| Value | Behavior |
|-------|----------|
| `FAIL_IF_DRAFT_ITEMS_EXIST` | Fail if any draft items exist. |
| `DISCARD_EXISTING_DRAFT_ITEMS` | Discard draft items (data loss). |
| `PUBLISH_EXISTING_DRAFT_ITEMS` | Publish draft items, overwriting any currently published items with the same ids. |

---

## Permissions

At the REST level, every read/author/publish/unpublish call here goes through the Data Items API and requires write access to the collection's data items. Beyond that, individual draft and publish actions may be further permission-restricted per caller on the collection, and there's no way to introspect those permissions ahead of time — so attempt the action and **handle authorization errors gracefully** if the write is rejected.

---

## Decision table — collection + desired action → API + permission

| Collection state | Desired action | API call | Permission needed |
|------------------|----------------|----------|-------------------|
| Draft Items plugin absent | Any write | Normal insert/update — writes go live immediately | Write Data Items |
| Draft Items enabled | Detect workflow | `GET /collections/{id}` → inspect plugins for the Draft Items plugin; read `draftItemsPluginOptions.draftsCollectionId` | (read) |
| Draft Items enabled | Read published items | `POST /items/query` on the published id | read |
| Draft Items enabled | Read drafts | `POST /items/query` on the drafts collection id | read |
| PUBLISHED | Edit into a pending draft (→ CHANGED) | Create the draft (`createDataItemDraft`), then edit it on the drafts collection | Write Data Items |
| — | Create new draft (→ DRAFT) | `POST /items` on the drafts collection | Write Data Items |
| DRAFT / CHANGED | Publish (→ PUBLISHED) | `POST /items/publish-draft` (published id) | Write Data Items |
| PUBLISHED / CHANGED | Unpublish, keep as draft (→ DRAFT) | `POST /items/unpublish` `copyToDraft:true` | Write Data Items |
| PUBLISHED / CHANGED | Unpublish, discard | `POST /items/unpublish` `copyToDraft:false` | Write Data Items |
| CHANGED | Revert to live version (discard edit) | `DELETE /items/{id}?dataCollectionId=<drafts id>` | Write Data Items |
| any | Delete entirely (both versions) | Delete on the published id (+ drafts id if a draft exists) | Write Data Items |
| plain, no plugin | Enable workflow | `POST /collections/add-draft-items-plugin` | Manage Data Collections |

---

## Agent gotchas

- **Resolve the drafts collection from the plugin.** Read `draftItemsPluginOptions.draftsCollectionId` off the published collection's Draft Items plugin rather than assuming a `__drafts` suffix.
- **Status is server-authoritative.** Derive DRAFT/PUBLISHED/CHANGED from the published + drafts surfaces (or the value the API returns). Never compute it locally, and never render an optimistic status before the write confirms (**confirm-then-render**).
- **Pass the *published* collection id** to `publish-draft` and `unpublish` — not the drafts collection id. Author and edit drafts against the drafts collection id.
- **Publishing deletes the draft.** After `publish-draft`, the pending draft no longer exists; the returned item is the live one.
- **Unpublish overwrites an existing draft** when `copyToDraft: true` — any pending edit for that id is replaced with the previously-published data.
- **Refetch after publish/unpublish.** State changes across the published/draft surfaces are not guaranteed atomic; re-query rather than assuming local state. Wix Data is eventually consistent — use `consistentRead: true` if you must read immediately after a write.

---

## Related Documentation

- [Publish Data Item Draft](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/publish-data-item-draft)
- [Unpublish Data Item](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/unpublish-data-item)
- [Data Collections API](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction) — plugin management
- [CMS Data Items CRUD](cms-data-items-crud.md) — insert/update/patch/delete/query shapes
- [CMS Schema Management](cms-schema-management.md) — creating and modifying collections
- [Wix Data and Eventual Consistency](https://dev.wix.com/docs/api-reference/business-solutions/cms/eventual-consistency)
