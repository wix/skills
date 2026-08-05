
# Wix CMS Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and this vertical's `references/cms/wix-cms.js`. Copy **both** into your app's `src/rest/` side by side — the helper does `import { wixApiRequest } from "./wix-client.js"`, so they must land in the same folder.

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
   the router `SKILL.md`). Paste it into `src/rest/wix-client.js` in place of the placeholder. It is
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
   from the collection schema (see "Beyond the snippets").

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the UI however the project
wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID`
  to the id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor
  refresh token is persisted to localStorage; do not re-mint anonymously per load.
- `src/rest/wix-cms.js` — exports:
  - **Read:** `queryDataItems`, `getDataItem`, `getDataItemBy`, `countDataItems`
  - **Write:** `insertDataItem`, `updateDataItem`, `removeDataItem`

The Data Item shape, the per-collection **permissions model**, and the **filter/sort
syntax** are documented as JSDoc comments at the top of `wix-cms.js`. Read them before
building the UI — read helpers return the item's flat `data` payload (which always
includes `_id`), and writes are bound by collection permissions.

## How to wire it (UI is the project's choice)
- **Content list** — `queryDataItems(collectionId, { filter?, sort?, limit?, cursor? })`
  for the listing; render fields directly off each returned item (`item.title`, etc.).
  Pass the returned `nextCursor` back as `cursor` to load the next page. Define
  `filter`/`sort` on the first request only — cursor follow-ups reuse the original query.
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
  "Anyone". Show success/failure from the resolved/thrown result; never fake a success.
- **Edit / delete (admin/author flows)** — `updateDataItem(collectionId, itemId, data)`
  (⚠ full replace — fetch + merge first to preserve other fields) and
  `removeDataItem(collectionId, itemId)`. These need Update/Delete granted to the caller,
  which visitors normally don't have — expect them to fail unless the collection is opened up.
- **Empty state** — if `countDataItems(collectionId)` is 0, show an empty state telling
  the user to add items in their Wix dashboard. Never invent items.

## Hard rules (do not violate)
- ✅ Read/write ONLY through the helpers in `wix-cms.js` (which call the official Wix Data
  `/wix-data/v2/items` endpoints).
- ❌ Never hand-build Wix Data URLs or invent endpoint paths.
- ❌ Never mock data — render live Wix Data items or the empty state.
- ❌ Never invent fields, reviews, ratings, or content not present in the collection.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Use the item's `_id` as the route key and as `itemId` for get/update/remove.
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
- [ ] `queryDataItems` returns live items; pagination via `nextCursor` loads more
- [ ] Detail page uses the item's `_id` (or a slug field via `getDataItemBy`) and shows a
      not-found state on miss — no invented item
- [ ] Filter/sort produce the expected subset (operators match the field types)
- [ ] Public form `insertDataItem` succeeds only when Insert is "Anyone"; on a 403 the user
      is told to grant the permission — no fake success
- [ ] Update is treated as a full replace (fetch + merge), so no fields are silently dropped
- [ ] Empty state shown when `countDataItems` is 0
- [ ] No mock data anywhere; no hand-built Wix Data URLs
- [ ] Told the user at least once that they can continue setting up their content in the dashboard and provided deep links.
