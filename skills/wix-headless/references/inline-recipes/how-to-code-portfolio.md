---
name: "How to Code Portfolio"
description: The frontend read contract for a Wix Portfolio backend — which @wix/portfolio modules, the exact list/query/detail calls, and the failure modes the docs omit (`_id` not `id`, object-param query NOT a builder, cover-image `.url` vs project-item `wix:image://` string). The *how*; which projects/collections to render come from the request.
---
**RECIPE**: How to Code a Portfolio Frontend (Wix Portfolio v1 — display-only, no eCommerce)

A contract for the **frontend code** of a portfolio/showcase site. The *how* (modules, calls, fields), not the *what* (which projects to show, the page design, the framework — those come from the request).

> **This recipe is for CODING, not seeding.** It assumes the backend already exists — collections and projects were created by `setup-portfolio.md`. It says nothing about creating data; it only reads and renders it. Portfolio is **display-only**: there is no cart, checkout, or eCommerce — do **not** pull in `@wix/ecom`/`@wix/redirects`.

> **⚠️ Reading rule — append `?apiView=SDK` to every doc link below.** Wix renders two views of each page: the bare/REST view shows `id`; the `?apiView=SDK` view shows **`_id`**. The SDK is what the frontend calls, so the REST view will actively mislead you (reading `project.id` yields `undefined` and detonates every downstream key/route). Always read the SDK view.

---

## The modules and the client (read this first)

**No app-id constant is needed** — Portfolio has no `catalogReference`/eCommerce surface. Everything is a plain read from `@wix/portfolio`.

**Module table** — import only what the site uses:

| Need | Package | Module | Key methods |
|---|---|---|---|
| Collections (groupings) | `@wix/portfolio` | `collections` | `listCollections(options?)`, `queryCollections(query, options?)`, `getCollection(id, options?)` |
| Projects (the showcased work) | `@wix/portfolio` | `projects` | `listProjects(options?)`, `queryProjects(query, options?)`, `getProject(id, options?)` |
| A project's media items (deeper project-page gallery) | `@wix/portfolio` | `projectItems` | `listProjectItems(projectId, options?)` |
| Resolve image media strings (covers **and** project items) | `@wix/sdk` | `media` | `getScaledToFillImageUrl(id, w, h, {})` |
| Build the client (non-Astro only) | `@wix/sdk` | `createClient`, `OAuthStrategy` | — |

- **There is one Portfolio API version (v1)** — no V1-vs-V3 trap like Stores.
- **`queryX` accepts BOTH an object-param and a builder overload** — `queryProjects({ filter, cursorPaging })` **and** `queryProjects().eq(…).find()` both type-check (unlike Stores/Bookings, whose object-param shape was removed). Either compiles; this recipe prefers a **client-side filter** (see Filtering) so you needn't pick.
- **Public read — no `auth.elevate`.** Portfolio content is public on the live site, so a visitor client reads collections/projects/items with **no elevation**. (The docs show `auth.elevate(...)` examples — those are for backend/admin jobs; a visitor-facing read does not need them. Elevation is the separate admin axis.)

**Auth / client — the framework split:**

- **Astro (Wix-managed, the default):** auth is **ambient**. Import the modules and call them directly from server components / `src/pages/api/*` — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
  ```ts
  import { collections, projects } from '@wix/portfolio';
  const { collections: cols } = await collections.listCollections();
  const { projects: projs } = await projects.listProjects();
  ```
- **Non-Astro (Vite/React/Vue/static):** build **one** manual visitor client and reuse it. The `clientId` is the app's **public** OAuth id (not a secret; `client_secret` never reaches the frontend).
  ```ts
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { collections, projects, projectItems } from '@wix/portfolio';
  const wixClient = createClient({
    modules: { collections, projects, projectItems },
    auth: OAuthStrategy({ clientId: import.meta.env.PUBLIC_WIX_CLIENT_ID }),
  });
  // then: await wixClient.projects.listProjects()
  ```
  A mis-wired public env var inlines as `undefined` and 400s **every** call — after building, confirm the actual `clientId` value is in the bundle.

---

## The features (build the ones the site needs)

Each subsection is self-contained — implement only what the site uses, in any order. Ordering matters only *within* a feature (resolve the collection/project before you filter/render by it).

### Listing the gallery (projects + collections) — and the `_id` rule

The gallery is two reads: **all projects** and **all collections**. Prefer the **`list*` methods** — they take an optional `options` (`{ paging: { limit, cursor }, includePageUrl }`) and need no query object:

```ts
const { projects: projs = [] } = await projects.listProjects();        // Astro: module; non-Astro: wixClient.projects…
const { collections: cols = [] } = await collections.listCollections();
```
Docs (read `?apiView=SDK`):
- <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/list-projects?apiView=SDK>
- <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/collections/list-collections?apiView=SDK>

**⚠️ CRITICAL — the id field is `_id`, never `id`.** Under `?apiView=SDK`, both `Project` and `Collection` expose **`_id`** (a GUID), `title`, `description`, `slug`, `hidden`, `coverImage`; `Project` also has `collectionIds: string[]` and `details`. Reading `.id` returns `undefined` — every `key={p.id}` and every `/[slug]` route built from it breaks silently. If you find yourself reading `id`, you're looking at the REST doc view.

**⚠️ The list arrays and `_id` are nullable under `strict`.** `listProjects()`/`listCollections()`/`listProjectItems()` return the array as `T[] | undefined` (default it with `= []` as above, or `?? []`), and `_id`/`slug` are `string | null | undefined`. So narrow before you key/route on them (`if (!p._id) continue`, `p.slug === params.slug`) — a bare `.filter`/`.includes(col._id)` won't type-check without the guard.

**⚠️ Only `Collection` has `sortOrder` — `Project` does not.** Sort **collections** by their numeric `sortOrder` for the owner's intended order (`[...cols].sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))`). **`Project` exposes no `sortOrder`** (reading it is `TS2339`) — render projects in the list-response order, or sort by a field they *do* have (`title`, `_createdDate`) if you need a stable one. Don't sort projects by `sortOrder`.

**⚠️ Respect `hidden`.** An entity with `hidden: true` should not appear publicly. Filter it out client-side (`projs.filter(p => !p.hidden)`) — and remember an *omitted* `hidden` comes back **absent** (proto3), so test `!p.hidden` (absent ⇒ falsy ⇒ shown), never `p.hidden === false`.

### Grouping / filtering by collection

A project links to its collections via **`project.collectionIds: string[]`** (a project can be in several). To show a collection's projects, the **default is a client-side filter** over the already-listed projects (avoids a second round-trip; narrow the nullable `_id` first):

```ts
const colId = collection._id;
const inCollection = colId ? projs.filter(p => p.collectionIds?.includes(colId)) : [];
```
This avoids the server-filter fragility and one extra round-trip; portfolios are small.

**If you filter server-side, `queryProjects`/`queryCollections` accepts EITHER shape — both compile.** The installed SDK exposes two overloads: an object-param `queryProjects({ filter, cursorPaging, sort })` (e.g. `projects.queryProjects({ cursorPaging: { limit: 100 } })`) **and** a fluent builder `queryProjects().eq('…', …).find()`. Either type-checks — pick one and confirm the filter matches before shipping. (Client-side filtering above sidesteps the choice.)
- <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/query-projects?apiView=SDK>

### Project detail page (resolve by slug, then its media)

Detail routes resolve a **`slug`** from the URL (the site is SSR — resolve at request time, no `getStaticPaths`). Resolve the project **client-side from the list** (reliable), then optionally load its media items:

```ts
const project = projs.find(p => p.slug === params.slug);        // from listProjects()
const { items } = await projectItems.listProjectItems(project._id);   // media gallery (owner-added)
```
- `projectItems.listProjectItems(projectId, options?)` — first arg is the **project `_id`** (positional), not an options object.
- <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/project-items/list-project-items?apiView=SDK>

Render `project.details` — an array of **`{ label, text }`** pairs (Role, Year, Client…) the seed may have set; it can be `[]`, so guard before mapping.

### Rendering images — ONE `Image` shape, always a media STRING

**⚠️ CRITICAL — `imageInfo` is a bare media STRING, for covers AND project items alike. There is no ready `.url`.** The installed SDK types **one** `Image { imageInfo?: string; focalPoint? }`, reused by `Project.coverImage`, `Collection.coverImage`, **and** `Item.image`. So `coverImage.imageInfo` and `item.image?.imageInfo` are both **strings** (a `wix:image://…` identifier) — reading `.url` on either is a type error (`TS2339: Property 'url' does not exist on type 'string'`). (The *REST* API returns `coverImage.imageInfo` as an object with a populated `url`, but the **SDK** — what the frontend calls — types it as a string; the package wins.) Resolve every portfolio image through the same `@wix/sdk` media helper — never drop a `wix:image://` value straight into `<img src>` (→ `ERR_UNKNOWN_URL_SCHEME`), never hand-build a `static.wixstatic.com` URL from it (→ 403):

```ts
import { media } from '@wix/sdk';

// cover (project or collection) — optional, guard it
const coverId = project.coverImage?.imageInfo;                 // string | undefined
const cover = coverId ? media.getScaledToFillImageUrl(coverId, 1200, 900, {}) : undefined;

// project-item media (same shape, same helper)
const itemId = item.image?.imageInfo;                          // string | undefined
const src = itemId ? media.getScaledToFillImageUrl(itemId, 1200, 900, {}) : undefined;
```

- **`media.getScaledToFillImageUrl` takes FOUR arguments** — `(wixMediaIdentifier, width, height, options)`; the `options` object is **required** (pass `{}`). A 3-arg call fails `TS2554`.
- **Covers are optional.** A text-only-seeded project/collection has **no** `coverImage` (absent), so the resolved value is `undefined` → render the **themed-block fallback** (`IMAGE_GENERATION.md`), never a broken `<img>`.

---

## Conclusion
- **Modules:** `collections`, `projects`, `projectItems` from `@wix/portfolio`; `media` + `createClient`/`OAuthStrategy` from `@wix/sdk`. **No** `@wix/ecom`/`@wix/redirects` — portfolio is display-only.
- **`_id`, never `id`** — read entities under `?apiView=SDK`; `.id` is `undefined`. List arrays are `T[] | undefined` (default `= []`); `_id`/`slug` are nullable — narrow before keying/routing.
- **Query has both overloads** — `queryProjects({ filter, cursorPaging })` **and** `queryProjects().eq().find()` compile; prefer client-side filtering by `collectionIds`/`slug`.
- **Only collections have `sortOrder`** (sort collections by it); projects don't — render in list order. **Respect `hidden`** (test `!hidden` — an omitted `hidden` is absent).
- **One `Image` shape:** `coverImage.imageInfo` and `item.image.imageInfo` are both bare media **strings** (no `.url`) → resolve every image via `media.getScaledToFillImageUrl(id, w, h, {})` (4 args); covers are optional → themed block. Never hand-build wixstatic URLs.
- **Public read, no `auth.elevate`** — visitor client reads all content; elevation is the separate admin axis.
