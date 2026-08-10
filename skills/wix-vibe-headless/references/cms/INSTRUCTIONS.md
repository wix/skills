# Wix CMS — client utils (you build the UI)

Unlike the other verticals, CMS ships **no UI**. A CMS is schema-driven — every collection is
different — so there are no meaningful "list/detail" components to hand you. You **build the UI
yourself** (list, detail, home, forms) in your own framework and design tokens, calling the shipped
**utils**. Everything talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor token)
using the official Wix Data endpoints — never hand-build a Wix Data URL, never mock items.

## What ships (utils only)

| file | what it is |
|---|---|
| `rest/wix-cms.js` | Wix Data helpers over the official endpoints: `queryDataItems`, `getDataItem`, `getDataItemBy`, `countDataItems`, `insertDataItem`, `updateDataItem`, `removeDataItem`. |
| `lib/wixImage.js` | `wixImage(uri)` — converts a `wix:image://…` media field into a renderable URL (passes `https://` / `//` through). |
| `collection.config.js` | Optional one-file mapping: `COLLECTION_ID` (your collection's **name**, not a GUID) + `FIELDS` (map `title`/`image`/`summary`/`body`/`date`/`slug` to your field keys). Keeps field mapping in one place; skip it and pass field keys inline if you prefer. |
| `wix-config.js` *(shared)* | Set `WIX_CLIENT_ID` + `WIX_METASITE_ID` here (the one place both ids live). |
| `WixManageBanner` *(shared)* | Dev-only manage banner — mount it in your Layout (see the platform doc's "Done" step). |

## Prerequisites
- A Wix **data collection** as the read target, created + seeded separately (see **Seeding**) — it may
  be empty at build time, so render an honest empty state until items land. This skill does **not**
  provision collections.
- **Collection permissions** must grant the action you perform to the visitor: **read** (Show content
  → *Everyone*) for listing/detail; **insert** only if you add a public form or member submissions;
  update/delete are author/admin-only and **403 for a visitor**. The owner sets these in the dashboard
  (CMS → collection → Permissions) — a separate Wix step, out of scope. A 403 before it's set is
  expected: flag it and continue.

## Build the UI from the utils
Generate whatever the app needs — a list/grid, a detail page, a home page, a submit form — with your
framework, your router, and your design tokens. Wire the data with the helpers below (the shapes are
the bug-prone part). Mount the shared `WixManageBanner` (dev-only) in your Layout. Route conventions
are yours (e.g. a list path + `/item/:slugOrId` detail).

## Data shapes (load-bearing — keep this wiring)

```jsx
import { queryDataItems, getDataItem, getDataItemBy, countDataItems, insertDataItem } from "@/rest/wix-cms";
import { wixImage } from "@/lib/wixImage";

// LIST — queryDataItems resolves to { items, nextCursor } (NOT a bare array). Each item is the flat
// `data` payload and always carries `_id`. Pass nextCursor back as `cursor` for the next page;
// set filter/sort on the FIRST request only (cursor follow-ups reuse them — pass only the cursor).
const { items, nextCursor } = await queryDataItems("Recipes", {
  sort: [{ fieldName: "publishDate", order: "DESC" }],            // array of { fieldName, order } — NOT { field: -1 }
  filter: { publishDate: { $lte: { "$date": new Date().toISOString() } } }, // dates wrap as { "$date": ISO }
  limit: 24,
});

// DETAIL — by `_id` (getDataItem) or a slug field (getDataItemBy); returns null on miss →
// show a not-found state, never invent an item.
const one = await getDataItemBy("Recipes", "slug", slugFromUrl);

// FILTER/SEARCH — operators: $eq $ne $gt $gte $lt $lte $in $nin $startsWith $exists $hasSome $hasAll,
// combined with $and/$or/$not. Simple text search: { title: { $startsWith: term } }.

// MULTI_REFERENCE fields are NOT inline — pass includeReferences: [{ field: "ingredients", limit: 10 }]
// to queryDataItems, then read item.<field>.

// IMAGES — a media field comes back as a `wix:image://…` URI the browser can't render. Convert every
// image with wixImage() before <img src>: <img src={wixImage(item.cover)} />. Never render one raw.

// PUBLIC FORM — insertDataItem("Reviews", { name, email, message }); needs Insert = "Anyone" (or members).
// Resolves to the flat inserted `data` payload (with _id); throws on failure — never fake success.
```

## Owned records (CMS × Wix members)
For user-generated content tied to the logged-in member ("my items"): do the **insert client-side with
the member's token** (from the **members** vertical) so Wix stamps the row's `_owner` to that member;
then filter `{ _owner: <member.id> }`. A backend/connector-token insert sets `_owner` to the *app*, not
the member, so "my items" comes back empty — don't do that. The collection needs **Insert** permission
for members/anyone. (Fuller recipe lives with the members vertical.)

## Hard rules
- Set `WIX_CLIENT_ID` (in `wix-config`) — not the placeholder.
- Read/write **only** through the `wix-cms.js` helpers (official Wix Data endpoints) — never hand-build a URL.
- `queryDataItems` → `{ items, nextCursor }` (destructure, iterate `.items`); `sort` is `[{ fieldName, order }]`; date comparands wrap as `{ "$date": ISO }`.
- Convert `wix:image://` URIs via `wixImage()` before `<img src>`.
- Owner field is `_owner` (Wix Data v2), not `_ownerId`; "my items" → `{ filter: { _owner: <member.id> } }` (see above).
- `updateDataItem` **replaces** the whole item — fetch + merge first (or use Patch Data Item).
- Render live Wix data or an honest empty state — never mock items or invent fields not in the collection.
- Treat a 403 as a permissions setup step (tell the user which permission to grant), not a code bug.

## Fallback — beyond the helpers
Need something the helpers don't cover? Call it yourself with `wixApiRequest`, but look up the exact
endpoint/method/body in the official Wix reference first (or use the `wix-docs` skill) — never guess.
- Data Items API: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items.md
- Partial update (Patch): https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/patch-data-item.md
- Upsert by id (Save): https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/save-data-item.md
- Free-text search: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/search-data-items.md
- Aggregations: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/aggregate-data-items.md
- Distinct values (filter menus): https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-distinct-values.md
- Referenced items: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-referenced-data-items.md
- Collection schema / field keys: https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/get-data-collection.md
- Member-gated / user-generated content → the **members** vertical (`references/members/INSTRUCTIONS.md`).

## Seeding
Seed the collection per `seed/SEED.md` — the Wix Data v2 REST API with curl examples (create collection
+ permissions, bulk-insert, verify, references, images). Needs an elevated credential; separate from
this build, run in parallel.

## Point the user to their dashboard
Substitute the site's `metaSiteId`:
- **Collections & items** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-cms` → Create Collection, then add items.
- **Permissions** — same CMS area → open the collection → More Actions → Permissions & Privacy. Read anonymously → **Show content: Everyone**; public/member form → **Collect content: Everyone/Members**. Update/Delete stay admin-only.

## Verify
- [ ] `WIX_CLIENT_ID` set (not the placeholder); collection name + field keys correct (from the seed plan).
- [ ] List renders live items (`{ items, nextCursor }` destructured); pagination works; empty collection → honest empty state (no mock items).
- [ ] Detail resolves by slug or `_id`, with a not-found state on miss.
- [ ] Image fields render via `wixImage()` (no raw `wix:image://`).
- [ ] Any 403 surfaced to the user as a permissions step, with the dashboard deep links.
