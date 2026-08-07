
# Wix CMS Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js`, the shared config `references/shared/wix-config.js`, and this vertical's `references/cms/wix-cms.js`. Copy **all three** into your app's `src/rest/` side by side — `wix-client.js` does `import { WIX_CLIENT_ID } from "./wix-config.js"` and the helper does `import { wixApiRequest } from "./wix-client.js"`, so they must land in the same folder.

Builds a real, client-only Wix CMS-backed app. The browser talks to Wix Data directly
over a public `WIX_CLIENT_ID` to read and write items in the site's data collections.
Never mock data; never hand-build API URLs — always go through the helpers, which call
the official Wix Data endpoints.

## When to use
- User wants to display Wix CMS / Content Manager content (a collection of posts,
  tutorials, recipes, team members, listings, FAQs, etc.) on a site.
- Replacing placeholder/mock content with live Wix Data items.
- Adding list pages, detail pages, category/tag filtering, or free-text search over an
  existing Wix data collection.
- Wiring a public form (contact, RSVP, review, signup) that writes a row into a collection.

## Prerequisites
1. A Wix site with **a data collection already created and populated** (this skill does
   NOT provision collections — it reads/writes existing ones). The merchant creates
   collections, fields, and items in the Wix dashboard (CMS / Content Manager).
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the
   Wix Business Manager surfaces a copyable prompt with the id filled in — see
   the router `SKILL.md`). Set it in `src/rest/wix-config.js` in place of the placeholder. It is
   a buyer-facing credential (it only mints anonymous visitor tokens), **not** a secret,
   so hardcoding/committing it is fine.
3. **Collection permissions** must match what you're doing. This skill runs as an
   anonymous visitor, so a call only works if the collection grants that action to
   "Anyone": Read for listing content, Insert for a public form. Update/Delete are
   almost always admin- or author-only and will fail for a visitor. The site owner sets
   these in the Wix dashboard (CMS → collection → Permissions). This is a **separate Wix
   setup step the user completes** — out of this skill's scope. If a read/insert fails
   with a permission error (HTTP 403) before that's set, that's expected; flag it and
   continue.
4. You need each collection's **collection ID** (its name, e.g. `Tutorials`) and its
   **field keys** (e.g. `title`, `publishDate`). Read field keys off a fetched item, or
   from the collection schema (see "Beyond the snippets"). **Carry your own seed/design
   plan's field keys forward as the canonical list for rendering** — the item shape here is
   user-defined (these are the keys *you* planned for the collection), so drive the UI off
   that known list rather than guessing keys or reverse-engineering them from a single row.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the UI however the project
wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Reads `WIX_CLIENT_ID`
  from `wix-config.js`. The visitor refresh token is persisted to localStorage; do not
  re-mint anonymously per load.
- `src/rest/wix-config.js` — set `WIX_CLIENT_ID` (and `WIX_METASITE_ID`) from the prompt.
- `src/rest/wix-cms.js` — exports:
  - **Read:** `queryDataItems`, `getDataItem`, `getDataItemBy`, `countDataItems`
  - **Write:** `insertDataItem`, `updateDataItem`, `removeDataItem`

The Data Item shape, the per-collection **permissions model**, and the **filter/sort
syntax** are documented as JSDoc comments at the top of `wix-cms.js`. Read them before
building the UI — read helpers return the item's flat `data` payload (which always
includes `_id`), and writes are bound by collection permissions.

**Owner field — use `_owner`.** The system field that holds the item's owner (the member
who inserted it) is **`_owner`** in Wix Data v2 — this is the key to filter on for a "my
items" view (`filter: { _owner: <memberId> }`) and the one Wix stamps on member inserts.
(The JSDoc comment in `wix-cms.js` currently labels it `_ownerId`; that is a typo in the
comment — the live field is `_owner`.)

## How to wire it (UI is the project's choice)
- **Content list** — `queryDataItems(collectionId, { filter?, sort?, limit?, cursor? })`
  **resolves to `{ items, nextCursor }`** (not a bare array) — destructure it, iterate
  `.items`, and render fields directly off each item (`item.title`, etc.). Each item is
  the flat `data` payload and always carries `_id`. Pass the returned `nextCursor` back as
  `cursor` to load the next page. Define `filter`/`sort` on the first request only — cursor
  follow-ups reuse the original query (pass only the cursor). See the reference snippet below.
- **Sort & date filters** — `sort` is an **array** of `{ fieldName, order: "ASC"|"DESC" }`
  (e.g. `sort: [{ fieldName: "publishDate", order: "DESC" }]`) — **not** a Mongo
  `{ field: -1 }` object. In a `filter`, date comparands must be wrapped as
  `{ "$date": "2026-05-05T00:00:00.000Z" }` (ISO string), not a bare string — e.g.
  `{ publishDate: { $lte: { "$date": new Date().toISOString() } } }`.
- **Reference fields** — a `MULTI_REFERENCE` field is **not** inline by default: without
  asking for it, `item.<field>` is not populated, so don't `.map` over it. Pass
  `includeReferences: [{ field: "<field>", limit: N }]` to `queryDataItems`; the referenced
  items then come back under `item.<field>`, and you render them by mapping that (see the
  snippet). The exact expanded shape (an array of referenced `data` payloads, each with its
  own `_id`) and any beyond-the-inline-limit expansion — confirm against the Query Referenced
  Data Items reference under "Beyond the snippets"; it is not spelled out in the helper's JSDoc.
- **Detail page** — route by the item's `_id` and call `getDataItem(collectionId, itemId)`;
  returns null on miss → show a not-found state, never invent an item. For human-readable
  URLs, add a slug-like field to the collection and route via
  `getDataItemBy(collectionId, "slug", slugFromUrl)`.
- **Filter & search** — pass a `filter` to `queryDataItems` using the operators documented
  in `wix-cms.js` (`$eq`, `$in`, `$gte`, `$startsWith`, `$hasSome`, `$and`/`$or`, …). For a
  simple text search, `{ title: { $startsWith: term } }`; for richer free-text/fuzzy search
  across fields, see "Beyond the snippets" (Search Data Items).
- **Public form** — on submit, `insertDataItem(collectionId, { name, email, message })`
  (field keys must match the collection). Requires the collection's Insert permission to be
  "Anyone". It resolves to the **flat inserted `data` payload** (including the newly assigned
  `_id`) — not a `{ dataItem: { … } }` wrapper — so read `_id`/fields straight off the return.
  Show success/failure from the resolved/thrown result; never fake a success.
- **Edit / delete (admin/author flows)** — `updateDataItem(collectionId, itemId, data)`
  (⚠ full replace — fetch + merge first to preserve other fields) and
  `removeDataItem(collectionId, itemId)`. Like insert, `updateDataItem` resolves to the flat
  updated `data` payload (with `_id`), not a `{ dataItem: { … } }` wrapper. These need
  Update/Delete granted to the caller, which visitors normally don't have — expect them to
  fail unless the collection is opened up.
- **Empty state** — if `countDataItems(collectionId)` is 0, show an empty state telling
  the user to add items in their Wix dashboard. Never invent items.

## Reference snippet (shape-correct; restyle freely)

The item shape is **user-defined** (the field keys are the ones from your own seed/design
plan), so this is a skeleton, not a drop-in — the data wiring is what's load-bearing:
`queryDataItems` returns `{ items, nextCursor }`, each item is a flat `data` payload with
`_id`, `sort` is an array of `{ fieldName, order }`, dates are `{ "$date": ISO }`, and a
`MULTI_REFERENCE` field only populates when you pass `includeReferences`. Keep that wiring;
swap the field keys (`title`, `photo`, `publishDate`, `ingredients`) for your own.

```jsx
import { useState, useEffect } from "react";
import { queryDataItems, countDataItems } from "@/rest/wix-cms";

// Field keys are YOUR OWN — the ones from your seed plan for this collection.
// Carry that plan forward as the canonical list of keys to render.
const COLLECTION = "Recipes";

export default function Recipes() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(null);

  useEffect(() => {
    countDataItems(COLLECTION).then(setTotal);
    queryDataItems(COLLECTION, {
      sort: [{ fieldName: "publishDate", order: "DESC" }],        // array of { fieldName, order } — NOT { field: -1 }
      filter: { publishDate: { $lte: { "$date": new Date().toISOString() } } }, // date wrapped in { "$date": ISO }
      includeReferences: [{ field: "ingredients", limit: 10 }],   // expand a MULTI_REFERENCE field inline
      limit: 24,
    }).then(({ items, nextCursor }) => {   // destructure — queryDataItems returns { items, nextCursor }
      setItems(items);                     // each item is the flat `data` payload, incl. _id
      setCursor(nextCursor);
    });
  }, []);

  const loadMore = () =>
    // cursor follow-ups reuse the first request's filter/sort — pass ONLY the cursor
    queryDataItems(COLLECTION, { cursor, limit: 24 }).then(({ items: more, nextCursor }) => {
      setItems((prev) => [...prev, ...more]);
      setCursor(nextCursor);
    });

  if (total === 0) return <p>{/* empty state — no items yet; point the user to the dashboard */}</p>;
  return (
    <div /* restyle */>
      {items.map((item) => (
        <article key={item._id} /* restyle */>
          <h3>{item.title}</h3>
          {/* item.ingredients is an array of referenced `data` payloads ONLY because of includeReferences */}
          <ul>{(item.ingredients || []).map((ref) => <li key={ref._id}>{ref.name}</li>)}</ul>
        </article>
      ))}
      {cursor && <button onClick={loadMore}>Load more</button>}
    </div>
  );
}
```

**Image fields need conversion — don't put the field straight into `<img src>`.** A
merchant-uploaded image field comes back as a Wix media URI like
`wix:image://v1/<id>~mv2.jpg/<filename>#originWidth=…&originHeight=…`, which a browser
**cannot** render directly. Only images written by your own seed step tend to be plain
`https://static.wixstatic.com/...` URLs, which do work in `<img src>`. So branch on it:
a value starting with `https://` (or `//`) is usable as-is; a `wix:image://` value must be
converted to a static URL first. **Neither helper in this skill converts media URIs** — look
up the current Wix Media image-URL conversion in the Wix docs (search "Wix Media" / "image
URL" in the API reference under "Beyond the snippets") and use that; never hand-assemble the
`static.wixstatic.com` URL by guessing the transform.

## Hard rules (do not violate)
- ✅ Read/write ONLY through the helpers in `wix-cms.js` (which call the official Wix Data
  `/wix-data/v2/items` endpoints).
- ❌ Never hand-build Wix Data URLs or invent endpoint paths.
- ❌ Never mock data — render live Wix Data items or the empty state.
- ❌ Never invent fields, reviews, ratings, or content not present in the collection.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Use the item's `_id` as the route key and as `itemId` for get/update/remove.
- ✅ `queryDataItems` resolves to `{ items, nextCursor }` (not a bare array) — destructure and
  iterate `.items`; each item is a flat `data` payload with `_id`. `insert`/`update` also
  resolve to the flat `data` payload (with `_id`), not a `{ dataItem: { … } }` wrapper.
- ✅ `sort` is `[{ fieldName, order: "ASC"|"DESC" }]` (not Mongo `{ field: -1 }`); date filter
  comparands are wrapped `{ "$date": "ISO" }` (not a bare string).
- ✅ A `MULTI_REFERENCE` field is not inline — pass `includeReferences: [{ field, limit }]` and
  only then `.map` over `item.<field>`; without it the field isn't populated.
- ✅ Convert `wix:image://` media URIs before using them in `<img src>` (a plain `https://` /
  `//` URL is fine as-is); look up the conversion in the Wix docs — no helper here does it.
- ✅ The owner field is `_owner` (Wix Data v2), not `_ownerId`.
- ✅ `updateDataItem` REPLACES the whole item — fetch with `getDataItem`, merge your
  changes, then pass the full object, or use Patch Data Item (see below) for partial edits.
- ✅ Treat permission errors (HTTP 403) as a configuration step, not a code bug: tell the
  user which permission to grant in the dashboard. Writes throw on failure — don't swallow
  the error and show a fake success.

## Beyond the snippets
The snippets cover the common CMS paths (list, detail, filter, count, insert, update,
remove). If you hit a use case they don't cover, make the call yourself with
`wixApiRequest` — but look up the exact endpoint, HTTP method, and request body in the
**official Wix API reference** first; never guess:
- CMS / Data Items API reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items.md
- Data Items sample flows: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/sample-flows.md
- **Partial update** (change some fields, keep the rest): Patch Data Item —
  https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/patch-data-item.md
- **Upsert** (insert or update by id): Save Data Item —
  https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/save-data-item.md
- **Bulk** insert/update/save/remove (many items in one call):
  https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items.md
- **Free-text / fuzzy search** across fields: Search Data Items —
  https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/search-data-items.md
- **Aggregations** (counts/averages grouped by a field): Aggregate Data Items —
  https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/aggregate-data-items.md
- **Distinct values** (e.g. all categories for a filter menu): Query Distinct Values —
  https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-distinct-values.md
- **Referenced items** (expand a reference field beyond the inline limit): Query Referenced
  Data Items — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-referenced-data-items.md
- **Collection schema / field keys & types**: Get Data Collection —
  https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/get-data-collection.md
- **Member-gated & user-generated content** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`). A collection whose permissions are `read: Anyone`,
  `insert: Site Member`, `update/remove: Site Member Author` gives you the classic pattern: anyone
  reads, only logged-in members write, and each member edits only their own. Sign the member in with
  custom login (on your own UI), then `insertDataItem` runs as the member and Wix stamps the item's
  `_owner` automatically — so a **"my items"** view is just
  `queryDataItems(collectionId, { filter: { _owner: <memberId> } })`, and author-only
  `updateDataItem`/`removeDataItem` are enforced server-side. (This skill never provisions the
  collection — the owner creates it with those permissions in the dashboard.)
  **Prefer Wix for member-generated content, and keep one feature's data and identity together.**
  Content that belongs to the Wix site (likes, reviews, submissions) is best kept in a Wix collection
  via these helpers, keyed on the Wix member's server-stamped `_owner`. What breaks is a *split*
  feature — the row stored in one place while the member is identified from the Wix session elsewhere
  (or filtered by some other `created_by`/user id): the two ids won't match, so ownership filters
  miss. Keep them on one side; for Wix-backed rows that's `_owner`.

Keep the snippets as the default for everything they already do; reach for the API
reference only for the gap.

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the CMS content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For CMS data those pages are:
- **Collections & items** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-cms` (`Dashboard → CMS`) → **Create Collection**, then open a collection to add items.
- **Permissions** — no separate deep link; in the same CMS area, open the collection → **More Actions → Permissions & Privacy**. For the headless app to work anonymously, set **Show content** to *Everyone* (visitor reads) and, for a public form, **Collect content** to *Everyone* (visitor inserts). Update/Delete stay admin-only.

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (same anonymous visitor, no re-mint per load)
- [ ] `queryDataItems` returns live items (destructured from `{ items, nextCursor }`);
      pagination via `nextCursor` loads more
- [ ] `sort` uses `[{ fieldName, order }]` and date filters wrap comparands in `{ "$date": ISO }`
- [ ] Multi-reference fields fetched with `includeReferences` before being mapped
- [ ] Image fields: `wix:image://` URIs converted before `<img src>`, not rendered raw
- [ ] Detail page uses the item's `_id` (or a slug field via `getDataItemBy`) and shows a
      not-found state on miss — no invented item
- [ ] Filter/sort produce the expected subset (operators match the field types)
- [ ] Public form `insertDataItem` succeeds only when Insert is "Anyone"; on a 403 the user
      is told to grant the permission — no fake success
- [ ] Update is treated as a full replace (fetch + merge), so no fields are silently dropped
- [ ] Empty state shown when `countDataItems` is 0
- [ ] No mock data anywhere; no hand-built Wix Data URLs
- [ ] Told the user at least once that they can continue setting up their content in the dashboard and provided deep links.
