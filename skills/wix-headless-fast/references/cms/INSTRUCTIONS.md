# CMS — playbook

The data machinery ships as files — typed reads/writes over ANY collection, hooks, and the
normalization layer (dates → ISO strings, `wix:image://` → https URLs), correct end-to-end.
CMS is schema-generic, so unlike other verticals there are **no fixed pages**: the seed plan
(`plan.json`) is the site's content model, and **you design the pages from it** — a listing
surface and an item page per content collection, plus the home page and the brand. You never
write data-access logic; you never skip designing.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read the reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/cms/types.ts` | the DTOs (`CmsItem`, `CmsFilter`, `CmsSort`, `CmsQuery`, `CmsPage`) — contracts below |
| `wix/cms/items.ts` | `queryItems`, `getItemById`, `getItemBy`, `countItems`, `insertItem`, `updateItem`, `patchItemFields`, `removeItem` |
| `hooks/cms/useCollection.ts` | list state + skip paging — contract below |
| `hooks/cms/useItem.ts` | one item by `_id` or slug field — contract below |
| `components/cms/CollectionView.tsx` (+ `CollectionCard`) | **REFERENCE implementation** — a field-map-driven grid; build your own instead of shipping it |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add your content nav links there |

There are **no shipped pages** — you author them (below).

## What you build — the design job

Read the seed plan first: its collections, field keys, and permissions are the contract your
pages bind to (collection ids and field keys verbatim).

1. **A listing surface per content collection** — your card (image, title, secondary fields)
   and rhythm, with skeletons while loading and an honest empty state — on `useCollection`
   (or SSR via `queryItems` alone when the page needs no interactivity).
2. **An item page per collection with a `slug` field** — your detail layout on the DTO
   (SSR fetch via `getItemBy`), with a real 404 on miss.
3. **The home page** — hero, featured items (fetch in frontmatter → your components), brand
   story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// CmsItem — display-ready, fields FLAT on the item (never item.data.*):
// { _id, _createdDate?, _updatedDate?, _owner?, ...fields }
//   TEXT/URL/EMAIL → string · NUMBER → number · BOOLEAN → boolean
//   DATE/DATETIME → ISO string (render: new Date(iso).toLocaleDateString())
//   IMAGE → resolved https URL (straight into <img src>; guard the absent case)
//   RICH_TEXT → the stored HTML string (render via set:html on a wrapper you control)
//   REFERENCE/MULTI_REFERENCE → id(s); full CmsItem(s) when queried with include

// queryItems(collectionId, { filters?, sort?, limit?, skip?, include?, withTotal? })
//   → { items: CmsItem[], hasNext, total }        // filters: [{ field, op, value }]
//     ops: eq ne gt ge lt le contains startsWith hasSome hasAll isEmpty isNotEmpty
//     DATE comparands must be Date objects (an ISO string matches nothing)
// getItemBy(collectionId, field, value) → CmsItem | null      // slug routing
// getItemById(collectionId, id) → CmsItem | null
// countItems(collectionId, filters?) → number

// useCollection(collectionId, { filters?, sort?, limit?, include?, initialItems?, initialHasNext? })
// → { items: CmsItem[]|null /* null = loading → skeletons */,
//     hasNext, loadMore(), loadingMore, error }   // changing filters/sort refetches

// useItem(collectionId, { id } | { by: { field, value } }, { initialItem? })
// → { item: CmsItem|null, notFound, error }       // notFound → your 404/miss state

// Writes (only when the collection's permissions allow the caller):
// insertItem(collectionId, data)                  // dates as Date objects; never set _owner
// patchItemFields(collectionId, id, fields)       // the safe partial change
// updateItem(collectionId, item)                  // REPLACES the whole item — see hard rules
// removeItem(collectionId, id)
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass) and add one nav
   link per content surface.
2. Author your pages under `src/pages/` — SSR fetch in the frontmatter, DTO props to your
   islands (`client:load`; a page with no interactivity needs no island at all). Listing:

   ```astro
   ---
   import SiteLayout from "../layouts/SiteLayout.astro";
   import { queryItems } from "../wix/cms/items";
   import type { CmsPage } from "../wix/cms/types";
   let page: CmsPage = { items: [], hasNext: false, total: null };
   try {
     page = await queryItems("recipes", { sort: [{ field: "publishDate", direction: "desc" }] });
   } catch {
     // an unguarded SSR throw truncates the response mid-stream
   }
   ---
   ```

   Item page (`src/pages/recipes/[slug].astro`): `getItemBy("recipes", "slug", Astro.params.slug!)`
   in the frontmatter; `return new Response(null, { status: 404 })` on null. SEO is plain
   `<title>`/`<meta name="description">` from the DTO via the layout props — CMS collections
   have **no owner-editable SEO item type**, so don't copy another vertical's
   `wixMetadata`/`<SEO.Tags>` wiring.
3. **Author your surfaces in as few messages as possible** — batch multiple Writes per
   message (components and pages are independent files).

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes are yours: a list route per collection on
`useCollection`, a detail route on `useItem` with `by: { field: "slug", value }`.

## Hard rules

- **Data only through the shipped exports** — never re-derive a Wix Data request, never
  import `@wix/data` directly in your components, never hand-build a `static.wixstatic.com`
  URL.
- **The id is `_id`, fields are flat** — `item.id` is undefined; `item.data.title` is the
  REST shape and reads undefined.
- **Bind by the seed plan's ids and keys verbatim** — collection ids have no namespace; a
  mistyped field key reads as a blank, not an error.
- **An empty read on a PUBLIC collection is a seed permissions bug** (`read` must be
  `ANYONE`) — fix the seed, never reach for `auth.elevate` (it doesn't exist on this path).
  On a member-scoped collection an empty anonymous read is the gate working, not a bug.
- **`updateItem` REPLACES the whole item** — omitted fields are wiped. Spread the full item,
  or use `patchItemFields`. Date fields on any write are Date objects — a round-tripped ISO
  string is silently stored as text and breaks date queries.
- **Writes 403 unless the collection was seeded with that verb open** — surface a 403 as a
  permissions setup step (which permission, where in the dashboard), not a code bug.
- **RICH_TEXT is HTML, not plain text** — render it with `set:html` (Astro) /
  `dangerouslySetInnerHTML` (React) on a wrapper; never interpolate it as text.
- Reference fields hold ids unless the query passed `include` — don't render an id as
  content.
- Guard absent IMAGE fields — render a fallback, never an empty/broken `<img>`.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Live data or an honest empty state — never mock items or invent fields not in the plan.

## Point the user to their dashboard

Give the owner the dashboard link — the deploy step's JSON printed `dashboardUrl`; append
`/wix-cms` for the collections area (items, fields, and More Actions → Permissions &
Privacy live there).

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-cms.mjs` from the project root. The
plan is the content model your pages bind to: design collections that exercise the UI
(a `slug` field per detail page, an IMAGE field with a verified `imageUrl` per item, a DATE
field when the content is chronological).

## Verify (before declaring done)

- [ ] Each listing page renders live items SSR (view-source shows titles) through YOUR
      components; an empty collection shows your honest empty state (no mock items).
- [ ] Item pages resolve by slug with a real 404 on a bad slug.
- [ ] Images render (resolved https URLs, no raw `wix:image://`); absent images fall back
      gracefully.
- [ ] Dates render formatted (no "Invalid Date", no raw ISO strings in copy).
- [ ] RICH_TEXT renders formatted (no visible HTML tags, no `[object Object]`).
- [ ] Any 403 surfaced as a permissions step with the dashboard link.
- [ ] Listing/item/home surfaces are YOUR designs on the tokens; data-layer/hook files
      unedited.
- [ ] Dashboard link handed to the owner.
