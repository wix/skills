# CMS — seeding (Wix Data v2 REST)

Seeding a collection is an **admin/build-time** job: create the collection(s), insert items, wire
references, attach images — all via the **Wix Data v2 REST API**. There is **no helper module** — make
the calls yourself with the shapes below. Needs an **elevated credential** (a connector token or a Wix
API key; the public `WIX_CLIENT_ID` cannot write — see the platform doc's seed-auth step).

**⛔ Additive only — never delete, reset, or overwrite existing content.**

## Auth (on every call)
The curls below are **request shapes** — endpoint, method, body. **Never inline the raw token/API key**
into a command: it would end up in the transcript, exec logs, and shell history. Keep the credential in
a variable and reference it.
- **On Base44 (and any exec-tool platform): don't shell out to curl — make these calls with `fetch()`**,
  taking the token from the connector so it's never printed:
  ```js
  const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // token stays in memory
  await fetch(`https://www.wixapis.com/wix-data/v2/collections`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "wix-site-id": METASITE_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ collection: { /* … */ } }),
  });
  ```
- **On a shell/curl platform:** load the credential into an env var from your secret manager (don't
  echo it), then reference `$TOKEN` — the literal never appears in the command you write:
  ```bash
  API=https://www.wixapis.com
  # TOKEN comes from your connector / secret manager (e.g. TOKEN="$WIX_TOKEN") — do NOT paste it here.
  AUTH=(-H "Authorization: Bearer $TOKEN" -H "wix-site-id: $METASITE_ID" -H "Content-Type: application/json")
  #  Wix API key instead of a token → -H "Authorization: $TOKEN"   (raw, NO "Bearer")
  ```

## 0 · Install the Wix Data app — only if a data call returns `WDE0110` (app not installed)
```bash
curl -sS -X POST "$API/apps-installer-service/v1/app-instance/install" "${AUTH[@]}" \
  -d '{"tenant":{"tenantType":"SITE","id":"<METASITE_ID>"},
       "appInstance":{"appDefId":"e593b0bd-b783-45b8-97c2-873d42aacaf4","enabled":true}}'
```

## 1 · Create a collection — the `permissions` block is MANDATORY
```bash
curl -sS -X POST "$API/wix-data/v2/collections" "${AUTH[@]}" -d '{
  "collection": {
    "id": "Recipes", "displayName": "Recipes",
    "fields": [
      { "key": "title", "displayName": "Title", "type": "TEXT" },
      { "key": "photo", "displayName": "Photo", "type": "IMAGE" },
      { "key": "categories", "displayName": "Categories", "type": "MULTI_REFERENCE",
        "typeMetadata": { "multiReference": { "referencedCollectionId": "Categories" } } }
    ],
    "permissions": { "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN", "read": "ANYONE" }
  }
}'
```
- The `id` you send **is** the collection id (Wix doesn't rename it) — keep it + the field keys.
- **Permissions is required and load-bearing.** A public collection's `read` **must** be `"ANYONE"` or a visitor query silently returns 0 items. Presets:

  | preset | `read` / `insert` / `update` / `remove` | use |
  |---|---|---|
  | **public-read** (default) | `ANYONE` / `ADMIN` / `ADMIN` / `ADMIN` | admin content, anyone reads |
  | **collaborative** | `ANYONE` / `ANYONE` / `ANYONE` / `ANYONE` | visitor-written shared board (anonymous, unscoped) |
  | **member-private** | `SITE_MEMBER_AUTHOR` / `SITE_MEMBER` / `SITE_MEMBER_AUTHOR` / `SITE_MEMBER_AUTHOR` | per-user "my…" rows (`_owner`-matched); **create it EMPTY** — members populate it from the client with their **member token** so Wix stamps `_owner` |
  | **member-shared-read-only** | `SITE_MEMBER` / `ADMIN` / `ADMIN` / `ADMIN` | gated: any member reads, seed/admin writes |
  | **public-wall** | `ANYONE` / `SITE_MEMBER` / `SITE_MEMBER_AUTHOR` / `SITE_MEMBER_AUTHOR` | members post, **everyone** reads (public gallery/feed); authors edit only their own |

- **The values are Wix user *roles*, and they're a hierarchy** — a role can do anything the roles below it can. Pick per action (`read` / `insert` / `update` / `remove`):

  | role | who, for that action |
  |---|---|
  | `ANYONE` | any visitor, logged in or not |
  | `SITE_MEMBER` | any logged-in member — **all** rows |
  | `SITE_MEMBER_AUTHOR` | logged-in members, but **only rows they created** (Wix matches `_owner`) — this is how "only mine" is enforced, server-side |
  | `CMS_EDITOR` | Wix users holding a CMS role |
  | `PRIVILEGED` / `ADMIN` | site admins + special permissions only |

  So **`read` is the privacy decision**: `SITE_MEMBER_AUTHOR` scopes each read to its caller on the
  server, so a member receives only their own rows and the client needs no filter; `ANYONE` publishes
  every row, and a `_owner` filter then selects a view of public data. Set it here, at create time —
  the client inherits whichever you choose.
  Reference: [Data Permissions](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-permissions/introduction.md)

- **MULTI_REFERENCE fields:** `typeMetadata.multiReference.referencedCollectionId` is mandatory (NOT `referencedCollection` — the docs' stale key stores an empty target and every later link is dead), and the **target collection must be created first**.
- `409 WDE0104` = "collection already exists" — fine (additive); skip and move on.

## 2 · Insert items — bulk
```bash
curl -sS -X POST "$API/wix-data/v2/bulk/items/insert" "${AUTH[@]}" -d '{
  "dataCollectionId": "Recipes",
  "dataItems": [ { "data": { "title": "Chocolate Cake" } }, { "data": { "title": "Pavlova" } } ],
  "returnEntity": true
}'
#  ← read each id from  results[].dataItem.id  (NOT results[].item)
```
Single item: `POST $API/wix-data/v2/items` with `{"dataCollectionId":"Recipes","dataItem":{"data":{…}}}`.
- Set plain fields + single `REFERENCE` (pass the target item's `_id` string) only. A **`MULTI_REFERENCE` value here is silently dropped** (no error) — wire it in step 4.

## 3 · Verify — a `200` does NOT prove the rows persisted
```bash
curl -sS -X POST "$API/wix-data/v2/items/query" "${AUTH[@]}" -d '{"dataCollectionId":"Recipes"}'
#  ← { "dataItems": [ { "id": "...", "data": { … } }, … ] }
```

## 4 · Wire multi-references — only if collections relate
```bash
curl -sS -X POST "$API/wix-data/v2/bulk/items/insert-references" "${AUTH[@]}" -d '{
  "dataCollectionId": "Recipes",
  "dataItemReferences": [
    { "referringItemFieldName": "categories", "referringItemId": "<recipeId>", "referencedItemId": "<categoryId>" }
  ]
}'
```
Resolves only if the field was created with a non-empty `referencedCollectionId` (step 1). Ids come from step 2's `results[].dataItem.id`.

## 5 · Images (optional)
An `IMAGE` field stores a **URL string**. Use a permanent Wix Media URL — if your image is external
(e.g. a generated one), **upload it to Wix Media first** (`POST /site-media/v1/files/import` with
`{url, mimeType, displayName}` → use the returned `file.url`; the blog/storefront seeds show this), then
set it. Attaching is a **read-merge-PUT** — a PUT replaces the whole item, so a partial body wipes the
other fields:
```bash
# query the item (step 3), merge the url into its IMAGE field, then PUT the WHOLE record back:
curl -sS -X PUT "$API/wix-data/v2/items/<itemId>" "${AUTH[@]}" -d '{
  "dataCollectionId": "Recipes",
  "dataItem": { "data": { <…all existing fields…>, "_id": "<itemId>", "photo": "https://…/file.jpg" } }
}'
```

## Gotchas
- Elevated credential required (the public client id can't write).
- **Provisioning race:** a fresh site's FIRST create/insert can transiently fail — `403`, or `400 WDE0117` ("MetaSite not found"), or `5xx`. Retry the same call **once** after ~3s, then fail loud (don't loop).
- Any PUT/update **replaces** the whole item — always fetch + merge (or use Patch Data Item).
- Verify with a query; a non-error POST is not proof of persistence.

## Reference
Read a method's page before writing its call: it carries the exact body shape, the required
permission scope, and the response envelope.
- Install a Wix app onto the site: https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app.md
- Import an image into Wix Media: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file.md
- Create Data Collection: https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/create-data-collection.md
- Bulk Insert Data Items: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/bulk-insert-data-items.md
- Bulk Insert Data Item References: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/bulk-insert-data-item-references.md
- Data Items API: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items.md
- Collections: https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections.md
- Anything not covered → use the `wix-docs` skill (search + read the live reference); never guess.
- Anything not covered → use the `wix-docs` skill (search + read the live reference); never guess.
