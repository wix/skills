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
| `wix-config.js` *(shared)* | the two ids, written by the install step. |
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
the bug-prone part). Mount the shared `WixManageBanner` (preview-only) in your Layout. Route conventions
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

// DATES — date/datetime fields (and _createdDate/_updatedDate) come back WRAPPED: { "$date": ISO }.
// Read through the wrapper — handing the object to `new Date()` yields an Invalid Date, which reaches
// the page as the text "Invalid Date":
const when = new Date(item.publishDate?.$date ?? item.publishDate);
// Write one back in the same shape, { "$date": iso }. A FILTER accepts either that or a plain ISO string.

// PUBLIC FORM — insertDataItem("Reviews", { name, email, message }); needs Insert = "Anyone" (or members).
// Resolves to the flat inserted `data` payload (with _id); throws on failure — never fake success.

// OWNED RECORDS ("my items") — insert from the CLIENT while the member is logged in, so Wix stamps
// `_owner` with THEIR id. (An insert carrying a connector/backend token stamps the app instead, and
// "my items" then reads back empty.)
const { member } = useMember();                      // from the members vertical (@/context/MemberContext)
await insertDataItem("Drawings", { title });         // member token in play → _owner = that member
const { items: mine } = await queryDataItems("Drawings", { filter: { _owner: member.id } });
// The member id lives at `member.id`: row fields carry a leading underscore (_id, _owner, _createdDate)
// while the member object uses plain `id`. Give the filter a real value — `member._id` evaluates to
// undefined, JSON.stringify drops it, and the query would match every row (or none), so the helpers
// throw first. For rows that must stay private, seed `read: SITE_MEMBER_AUTHOR` and skip the filter:
// the server scopes each read to its caller, and that keeps working when `member` is null (see below).
```

## Owned records (CMS × Wix members)
Runnable recipe: see **OWNED RECORDS** in the code block above. Requires the **members** vertical (it
supplies `useMember()`); the collection needs **Insert** for members. Always insert **client-side while
the member is logged in** — a backend/connector-token insert stamps `_owner` with the *app*, so "my
items" comes back empty forever.

**Decide which of these you're building — the choice is a collection permission, set at seed time:**

| goal | seed the collection with | how you read "mine" |
|---|---|---|
| public list + a personal *view* of it (e.g. a public gallery plus "my submissions") | `read: ANYONE` | `filter: { _owner: member.id }` — a **view** filter: it selects what to show, while every row stays readable by anyone |
| rows only their owner may ever see | `read: SITE_MEMBER_AUTHOR` (the **member-private** preset in `seed/SEED.md`) | query with **no filter** — the server scopes every read to the caller |

Reach for `SITE_MEMBER_AUTHOR` whenever the data is genuinely per-member: the server enforces it, and it
holds up when `useMember().member` is `null` — which is the state a logged-in member is in whenever the
Members Area app is absent (see the members vertical's "Identity vs. profile"), where a client-side id is
unavailable. For a public list **and** private rows, use **two collections** — permissions are per-collection.

## Images in a collection
Reading one goes through `wixImage()` (see the code block). Writing one has two shapes, because
**uploading to Wix Media takes a Manage-scope credential**: `generate-file-upload-url` and
`import-file` each require `SCOPE.DC-MEDIA.MANAGE-MEDIAMANAGER`, which a member or visitor token
never carries — a client-side upload answers **403 with an HTML body**. Pick by how the image is used:

| shape | field type | reach for it when |
|---|---|---|
| **data URL in the item** — `canvas.toDataURL()`, or any base64 string, written straight into the row | `TEXT` | small images: canvases, signatures, thumbnails, prototypes. An item caps at **500 KB** and base64 adds about a third, so keep the source under ~350 KB. Wix's own visitor-upload tutorial takes this route. |
| **real Wix Media asset** — a backend route uploads with an elevated credential and returns the CDN URL for the client to store | `IMAGE` | production images: CDN delivery, `wixImage()` transforms, reuse across the site, anything past that size cap |

**On base44 the elevated route is a backend function** — it holds the credential the client lacks:
```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // admin-level
// → POST /site-media/v1/files/generate-upload-url, PUT the bytes to it, return the file URL
```
That's the same Wix connector the seed step uses, and it's the supported way to reach a Manage-scope
API at runtime — a different thing from the Base44 solution kits the build rules exclude. Keep the
asset on Wix: `base44.integrations.Core.UploadFile` parks the file on Base44 instead, which splits the
source of truth away from the site.

**Authorize that function against the Wix member**, using the member token the client sends.
`base44.auth.me()` resolves the *Base44* account — you, the builder — so a function gated on it turns
real visitors away, while a `test_backend_function` run passes on your own token and reads as working.
Validate the mime type and the size there as well.

- Tutorial, data URL + elevated route: https://dev.wix.com/docs/go-headless/wix-managed-headless/full-integration-astro/feature-guides/upload-images-to-cms.md
- Generate File Upload Url: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/generate-file-upload-url.md
- Import File: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file.md

## Hard rules
- Read/write **only** through the `wix-cms.js` helpers (official Wix Data endpoints) — never hand-build a URL.
- `queryDataItems` → `{ items, nextCursor }` (destructure, iterate `.items`); `sort` is `[{ fieldName, order }]`; date comparands wrap as `{ "$date": ISO }`.
- Read date fields through the wrapper — `new Date(v?.$date ?? v)`. Dates arrive as `{ "$date": ISO }` (including `_createdDate` / `_updatedDate`), and `new Date(object)` puts the text "Invalid Date" on the page. See RETRIEVAL SHAPES in `rest/wix-cms.js` for the field types that need a converter.
- Convert `wix:image://` URIs via `wixImage()` before `<img src>`.
- Upload images from a backend route holding an elevated credential, and keep a member-submitted image under the 500 KB item cap when storing it as a data URL — a client-side Wix Media upload answers 403 (see **Images in a collection**).
- Owner field is `_owner` (Wix Data v2), not `_ownerId`; the member id lives at `member.id`, so "my items" → `{ filter: { _owner: member.id } }` (see above).
- **Give every filter key a defined value** — add the key only once you hold one: `...(memberId ? { _owner: memberId } : {})`. `JSON.stringify` drops `undefined`, so an undefined comparand would match every row (`{ _owner: undefined }`) or none (`{ _owner: { $eq: undefined } }`) with no error from the server; the helpers throw so it surfaces at the call site.
- **Let the query do the scoping** (a `filter`, or `read: SITE_MEMBER_AUTHOR` for privacy) so the server returns exactly the rows to show. A wrong result means the filter or the permission needs fixing — a client-side `.filter()` over rows the browser already holds only hides the symptom.
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
- [ ] Built "my items"? Signed in as **two different members** and confirmed each one sees their own rows and only those. Use two accounts: an owner filter can fail silently in either direction — every row, or zero rows — and both look plausible from a single account.
