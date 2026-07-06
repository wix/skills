---
name: "How to Code CMS"
description: The frontend read/write contract for Wix CMS (Wix Data) — the `@wix/data` `items.query` builder, the `_id`-and-fields-on-the-item shape (not `item.data.field`), why public-read collections need no `auth.elevate`, how to resolve images and render Ricos rich text, and the visitor-write path for collaborative collections (`items.insert`/`update`/`remove`, the update-replaces-whole-item footgun, shared/unscoped data). Specifies the *how* (module + exact calls + the failure modes the docs omit); which collections to render/write come from the request.
---
**RECIPE**: How to Code a Wix CMS Frontend (`@wix/data`, Wix Data v2)

A concise contract for writing the **frontend code** that reads Wix CMS collections: listing items, filtering, following references, and rendering images and rich text. **This recipe is the *how* (which module, which calls, which fields), not the *what*** — which collections to show, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the frontend, not for seeding it.** It assumes the collections and items already exist and are **public-read** (created by `setup-cms.md`). It says nothing about creating collections or inserting data — only how to read them from frontend code.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view** describes the REST shape — items nested under `item.data.<field>` and queried via a `POST /items/query` body. The **`?apiView=SDK` view** describes the SDK shape — items with **fields on the item itself** and a chainable `items.query(...)` builder. The SDK is what your frontend calls; reading the REST view by mistake is the source of the `item.data.title`-returns-`undefined` bug below. Fetch the `.md?apiView=SDK` form directly.

---

## The module and the client (read this first)

**⚠️ CRITICAL: the Wix Data items API is the `items` named export of `@wix/data`** — `import { items } from "@wix/data"`, then `items.query` / `items.get` / `items.insert` / `items.update` / `items.remove` (plus `items.bulkInsert` / `items.queryReferenced`). Do **not** import from the internal `@wix/wix-data-items-sdk` — `@wix/data` is the single documented package.

| Need | Package | Module / export |
|---|---|---|
| Read collection items (query, get, filter, references) | `@wix/data` | `items` |
| Resolve `wix:image://` URIs to URLs | `@wix/sdk` | `media` |

**Collection id has NO namespace.** A native collection's id is just the name the seed created (`"team-members"`, `"faq"`, `"Projects"`) — pass it straight to `items.query("team-members")`. The `<namespace>/<name>` form is only for Wix App collections. Stay consistent with the `collectionId` the seed recipe kept.

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `items.query(...)` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { items } from '@wix/data';

  const client = createClient({
    modules: { items },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  // then: client.items.query('team-members').find()
  ```
  The `clientId` is public, not a secret.

**⚠️ CRITICAL: do NOT call `auth.elevate` — public collections are public-read, and member-scoped ones use the member token.** `setup-cms.md` creates a public collection with `read: "ANYONE"`, so the visitor token reads it directly. A pure SPA/static frontend has **no server and cannot elevate** at all; even on Astro the read is visitor-scoped and needs no elevation. (Elevation is only for collections that genuinely can't be public — not the case here.) **If a query on a PUBLIC collection comes back empty, it wasn't seeded public-read — that's a permissions bug in the seed, not a query bug** (re-check the collection's `read` permission); don't reach for `elevate` to paper over it.

**Member-scoped collections (only when the run includes members login).** A collection seeded member-scoped (`setup-cms.md` → `SITE_MEMBER_AUTHOR` for per-user-private, or `SITE_MEMBER` for member-only) is read/written with the **logged-in member's token** — the same client, just after the member has logged in (see `how-to-code-members-astro.md` / `how-to-code-members-non-astro.md`). Key rules:
- **Still NO `auth.elevate`.** The member token carries the identity; the platform scopes the rows server-side. Reaching for elevate here is the wrong axis (it's for admin/site-wide reads, not a member's own data).
- **`SITE_MEMBER_AUTHOR` returns only the caller's OWN rows automatically** (matched on the item's `_owner`) — you don't filter by owner in the query, and you **must not** set `_owner` on insert (the platform stamps it from the member identity). `items.query('my-notes').find()` as member A returns A's notes; as member B, B's.
- **An anonymous / not-yet-logged-in read returns ZERO items — that's the gate, not a bug.** Don't render a member-scoped surface to anonymous visitors: gate the route/page behind login first (bounce to the login flow), *then* query. An empty result after a confirmed login on a `SITE_MEMBER_AUTHOR` collection just means that member has no rows yet (show an empty state), not a permissions error.

---

## The shape you read (field cheat-sheet)

```jsonc
// items.query("CollectionId").find()  →  result.items[]
item = {
  _id,                                  // the item id (SDK normalizes to _id, NOT id)
  _createdDate, _updatedDate, _owner,   // system fields
  name, role, bio, order,               // YOUR fields — directly on the item (NOT item.data.name)
}
// result also has: result.length, result.hasNext(), result.pageSize
```

`result.items[]` is the array; paging via `result.hasNext()` / a follow-up `.find()`. A `wix:image://` value in an IMAGE field and a Ricos object in a RICH_TEXT/RICH_CONTENT field both need resolving before render (see below).

---

## The features (build the ones the site needs)

Each section is a **self-contained feature** — implement only what the site uses, in any order.

### Listing / reading (and the field-access rule)

Query a collection with the chainable builder; `.find()` resolves to `{ items, ... }`.
Doc: <https://dev.wix.com/docs/sdk/business-solutions/data/items/query.md?apiView=SDK>

```js
const { items: rows } = await items.query('team-members')
  .ascending('order')
  .limit(50)
  .find();
// rows[0] === { _id, name, role, bio, order, _createdDate, ... }
```

**⚠️ CRITICAL: fields are on the item itself — `item.name`, NOT `item.data.name`.** The SDK returns each field as a top-level property of the item (the API was revised to match the Velo `wix-data` shape). `item.data.name` is the **REST** response shape and reads `undefined` in SDK code — the silent "every field is blank" bug. If you're reaching through `.data`, you're reading the REST doc view; re-open it with `?apiView=SDK`.

**⚠️ CRITICAL: the id is `_id`, never `id`.** `item.id` is `undefined`; use `item._id` for keys, links, and reference lookups.

**⚠️ `items.queryDataItems(...)` does NOT exist in the SDK.** The chainable entry point is `items.query("collectionId")` — `queryDataItems` is a REST/method name. Don't mix the two.

### Filtering and single-item lookup

Chain filter/sort/page methods on the query builder, then `.find()`:

```js
// by slug (detail page)
const { items: [post] } = await items.query('articles').eq('slug', slug).limit(1).find();
// compound filter + sort
const { items: rows } = await items.query('products')
  .eq('inStock', true).gt('price', 25).ascending('title').limit(50).find();
```

Builder methods: `.eq` / `.ne` / `.gt` / `.ge` / `.lt` / `.le` / `.contains` / `.startsWith` / `.hasSome` / `.ascending` / `.descending` / `.limit` / `.skip`. (No `$`-operator JSON body — that's the REST `/items/query` shape; in the SDK the operators are builder methods.)

### Following references

A `REFERENCE` / `MULTI_REFERENCE` field stores only ids by default. To inline the referenced items, add `.include("<fieldKey>")`:

```js
const { items: rows } = await items.query('projects').include('teamMembers').find();
// rows[0].teamMembers is now an array of full team-member items, not ids
```
Doc: <https://dev.wix.com/docs/sdk/business-solutions/data/items/query-referenced.md?apiView=SDK> (for `items.queryReferenced`, the alternative when a multi-reference set is large). Without `.include(...)`, the field is just ids — resolve them yourself or use `include`.

### Rendering images (IMAGE fields)

An `IMAGE` field comes back as a **`wix:image://v1/<hash>/<file>#…` identifier, not a ready URL** — putting it straight into `<img src>` shows nothing (`ERR_UNKNOWN_URL_SCHEME`). Resolve it with the SDK media module, and reuse one helper on every render path:

```js
import { media } from '@wix/sdk';
function imgSrc(v, w = 800, h = 600) {
  if (!v) return '';
  if (typeof v === 'string' && v.startsWith('wix:image://')) return media.getScaledToFillImageUrl(v, w, h, {});
  return typeof v === 'string' ? v : (v?.url ?? '');   // an already-absolute https URL passes through
}
```

**Never hand-build a `static.wixstatic.com/.../v1/fit/...` URL** — the format is easy to get wrong and the image then **403s**. Only `wix:image://` values need resolving; an already-absolute `https://` URL (e.g. an Unsplash placeholder seeded when imagery was off) goes straight into `<img src>`. Doc: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>

**⚠️ When imagery is OFF (the seed default), IMAGE fields are EMPTY — fall back, don't render a broken `<img>`.** The seed is text-only unless imagery is on, so a `photo`/`coverImage`/`headshot` field is often **absent or empty** on every item. Guard the render: only emit `<img>` when the field resolves to a real URL, otherwise show a graceful fallback (an initials avatar, a colored placeholder, or simply omit the image) — never an empty/broken `<img src="">`. A missing image is expected content state here, not an error.

### Rendering rich text (RICH_TEXT / RICH_CONTENT fields)

Wix CMS stores `RICH_TEXT` / `RICH_CONTENT` as **Ricos JSON** — a structured node tree (PARAGRAPH, HEADING, BULLETED_LIST…), not HTML and not a string.

**⚠️ Do NOT `set:html={item.bio}` or `String(item.bio)` directly.** That dumps `[object Object]` or `{"nodes":...}` into the page. Render the Ricos node tree — either with a small SSR Ricos→HTML walker (covers PARAGRAPH, HEADING, lists, BLOCKQUOTE, BOLD/ITALIC/LINK; renders anything else defensively as a `<p>`), or with `@wix/ricos`'s React `RicosViewer` as a client island when the content carries the full feature set (galleries, embeds). For short bound fields a plain-text variant is fine; for a body field, render it **formatted**.

### Writing from the frontend (only to a visitor-writable collection)

Most collections are **read-only** from the visitor client — admin-owned content (catalog, team, articles) the site only displays. **Fire-and-forget visitor input** (contact, signup, lead capture) goes through **Wix Forms**, not CMS — don't `items.insert` for those.

But when the site is built around **shared, visitor-editable data** — a guestbook, a community board, a collaborative list anyone can add to and edit — that collection is seeded **visitor-writable** (`insert`/`update`/`remove: ANYONE`, see `setup-cms.md`), and the client does full CRUD with the same `items` module:

```js
const created = await items.insert('community-board', { title, note, status: 'open' }); // → item with _id
await items.update('community-board', { ...item, status: 'claimed' });                  // see footgun below
await items.remove('community-board', item._id);
```

**⚠️ CRITICAL: `items.update()` REPLACES the whole item — it does NOT patch.** Per the docs: *"If the existing item had fields with values and those fields aren't included in the updated item, the values in those properties are lost."* So `update('c', { _id, status })` **wipes `title`, `note`, and every other field** — the classic "toggling status erases the row" bug. **Always pass the FULL item** on update (spread the record you already hold in state: `{ ...item, status }`). If you only have the id + one changed field and not the whole record, use **`items.bulkPatch('c', [id]).setField('status', v).run()`** instead — `bulkPatch` modifies only the named fields. Doc: <https://dev.wix.com/docs/sdk/business-solutions/data/items/update.md?apiView=SDK>

**⚠️ A write needs the collection seeded with the matching open permission — else it 403s.** `items.insert`/`update`/`remove` only succeed if the collection was created with that verb at `ANYONE` (`setup-cms.md`). A write to an `ADMIN`-write collection 403s from the visitor client (there's no `auth.elevate` on this path to get around it). If writes 403, fix the seed permission, not the call.

**⚠️ On the ANONYMOUS path the data is SHARED and unscoped — no per-user identity.** The visitor token has no per-user identity, so an `ANYONE`-writable collection is **global/shared across all visitors** (not per-user, not cross-device) and **any visitor can edit or delete any row**. That's the intended model for a collaborative board; surface it as such. **For per-user-private data, that's the member-scoped path** (`SITE_MEMBER_AUTHOR`, see the member-scoped note above): the same `items.insert`/`update`/`remove` calls, but run under a **logged-in member's token**, and each member touches only their own `_owner`-matched rows. On Astro you may route writes through a backend `src/pages/api/*` endpoint, but the permission facts are identical — no `_owner` set by hand, no elevate.

---

## Conclusion
A correct Wix CMS frontend:
- imports the **`items`** export of **`@wix/data`** (never `@wix/wix-data-items-sdk`), and `media` from `@wix/sdk` for images;
- queries with **`items.query("collectionId")` + builder methods + `.find()`** (no namespace on the id; `queryDataItems` doesn't exist);
- reads fields **on the item** (`item.name`) and the id as **`item._id`** — never `item.data.name`, never `item.id`;
- does **no `auth.elevate`** — a public collection is read on the visitor token (an empty result there is a seed permissions bug, not a query bug), and a **member-scoped** collection (opt-in, `SITE_MEMBER_AUTHOR`/`SITE_MEMBER`) is read on the **logged-in member's token** with the same no-elevate rule (an anonymous read returning empty is the gate, not a bug);
- resolves `wix:image://` via `media.getScaledToFillImageUrl` and renders Ricos rich text formatted (never raw `set:html`/`String`);
- treats CMS as **read-only by default** (fire-and-forget input → Forms); writes to a **visitor-writable** collection use `items.insert`/`update`/`remove` — always passing the **full item** on `update` (it replaces, not patches), expecting the data to be **shared/unscoped**, and relying on the collection's seeded `ANYONE` write permission (no `auth.elevate`). For **per-user-private** data (opt-in, members login in the run) the same calls run under the **member token** against a `SITE_MEMBER_AUTHOR` collection — each member sees/edits only their own `_owner`-matched rows, `_owner` is never set by hand, and the surface is gated behind login.
