# CMS — playbook

The data machinery ships as files — typed reads/writes over ANY collection, the list and item
state machines, their React bindings, and the normalization layer (dates → ISO strings,
`wix:image://` → https URLs), correct end-to-end. CMS is schema-generic, so unlike other
verticals there are **no fixed pages**: the seed plan (`plan.json`) is the site's content model,
and **you design the pages from it** — a listing surface and an item page per content collection,
plus the home page and the brand. You never write data-access logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the hooks
don't deploy at all; the stores behind them do, and each wiring section below says how to bind
them. Files you edit: `SiteLayout.astro` and `styles/global.css`. Files you **create** (skeletons
below): the listing and item pages with their islands, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(item.photo, "33vw")} alt={item.title} />`; `{}` for an absent image — render your placeholder then |
| `wix/cms/types.ts` | the DTOs (`CmsItem`, `CmsFilter`, `CmsSort`, `CmsQuery`, `CmsPage`) — contracts below |
| `wix/cms/items.ts` | `queryItems`, `getItemById`, `getItemBy`, `countItems`, `insertItem`, `updateItem`, `patchItemFields`, `removeItem` — the transport; the rules and DTO mappers are in `items-core.ts` beside it (shared with the REST layer) |
| `wix/cms/items-core.ts` | the normalization rules, the filter guard, the wire spelling of a query, and `formatDate(iso)` — a DATE field as copy ("" for absent/invalid, never "Invalid Date") |
| `wix/cms/collection-store.ts` · `item-store.ts` | the list and item state machines, framework-free (`createCollectionStore()`, `createItemStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/cms/useCollection.ts` | React binding of `collection-store.ts`: list state + skip paging — contract below |
| `hooks/cms/useItem.ts` | React binding of `item-store.ts`: one item by `_id` or slug field — contract below |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

There are **no shipped components** — the data layer, stores, and hooks are the machinery; every
component is yours.

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

### What a complete content site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
seeded content before designing (how many collections, which fields, whether items carry images
and dates) and design for this content, not for a stereotype of the business.

- **Home:** what the site is about and one path into the content in the first screen; real items
  under truthful headings; not a repeat of a listing page.
- **Listing:** a real card — image, title, a secondary field — in the first screen; each item a
  link to its item page (`/<collection>/<slug>`); loading, empty, and error states that look
  different; "load more" when `hasNext`.
- **Item page:** title, image, the date formatted, the body as HTML, related items only when a
  reference field carries them; a slug that resolves to nothing shows only the not-found state.
- **Copy:** nothing the owner didn't supply — no invented fields, counts, or authors; no Wix IDs or
  technical words in visible text.

### The contracts your components consume

Everything you need — tested and working as they are; read a file when something is off or the
brief wants more.

```ts
// CmsItem — display-ready, fields FLAT on the item (never item.data.*):
// { _id, _createdDate?, _updatedDate?, _owner?, ...fields }
//   TEXT/URL/EMAIL → string · NUMBER → number · BOOLEAN → boolean
//   DATE/DATETIME → ISO string (render: formatDate(item.publishDate) from wix/cms/items-core)
//   IMAGE → resolved https URL (<img {...imgAttrs(item.photo, "33vw")} />; {} when absent → your placeholder)
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

### The pages and islands you create — skeletons

The class names in these skeletons are the Astro/React spelling of layout rules that hold on
every stack, and each rule is also named in words beside its classes. On a stack where the hooks
don't deploy (`lib`, `static`, a port), keep the rule and write it in your own CSS.

Each page is a thin SSR shell (fetch → DTO props → island, or no island when the page has no
interactivity); each island is a thin view over a hook. Hooks first, branches after. The islands
render on the server too (`client:load` SSRs), and by then the 200 and headers are already sent — a
render throw truncates the body mid-stream. Render every state totally; nothing in a render path may
throw.

```astro
---
// src/pages/recipes.astro — YOU create it (one per content collection). Items are fetched
// SERVER-SIDE (view-source shows titles) and handed to the island as serialized DTO props.
import SiteLayout from "../layouts/SiteLayout.astro";
import CollectionView from "../components/cms/CollectionView";
import { queryItems } from "../wix/cms/items";
import type { CmsPage } from "../wix/cms/types";
const SORT = [{ field: "publishDate", direction: "desc" as const }];
let page: CmsPage = { items: [], hasNext: false, total: null };
try {
  page = await queryItems("recipes", { sort: SORT, limit: 12 });
} catch {
  // Guarded: an unguarded SSR throw truncates the response mid-stream; the island renders your empty state.
}
---
<SiteLayout title="Recipes">
  <!-- your page heading / intro, then: -->
  <CollectionView client:load collectionId="recipes" sort={SORT} limit={12} initialItems={page.items} initialHasNext={page.hasNext} />
</SiteLayout>
```

```astro
---
// src/pages/recipes/[slug].astro — YOU create it. SEO is plain <title>/<meta name="description">
// from the DTO via the layout props — CMS collections have NO owner-editable SEO item type, so
// don't copy another vertical's wixMetadata/<SEO.Tags> wiring.
import SiteLayout from "../../layouts/SiteLayout.astro";
import { getItemBy } from "../../wix/cms/items";
import { formatDate } from "../../wix/cms/items-core";
import { imgAttrs } from "../../wix/media";
let item = null;
try {
  item = await getItemBy("recipes", "slug", Astro.params.slug!, { include: ["categories"] });
} catch {
  // Guarded: an unhandled SSR throw truncates the response mid-stream.
}
// A missing slug is a real 404 — never a fallback to another item.
if (!item) return new Response(null, { status: 404 });
---
<SiteLayout title={String(item.title)} description={String(item.summary ?? "")}>
  <!-- your detail layout: title; the image through imgAttrs (a placeholder when it returns {});
       formatDate(item.publishDate); the RICH_TEXT body with set:html on a wrapper you control;
       included reference items by name — never an id as content -->
</SiteLayout>
```

```tsx
// src/components/cms/CollectionView.tsx — YOU build it; a listing page mounts it.
import { useCollection } from "../../hooks/cms/useCollection";
import { formatDate } from "../../wix/cms/items-core";
import { imgAttrs } from "../../wix/media";
import type { CmsFilter, CmsItem, CmsSort } from "../../wix/cms/types";

export default function CollectionView(props: {
  collectionId: string;
  filters?: CmsFilter[];
  sort?: CmsSort[];
  limit?: number;
  initialItems?: CmsItem[];     // SSR props from your page — pass straight to useCollection;
  initialHasNext?: boolean;     // omitted in a SPA (client fetch)
}) {
  const { collectionId, ...options } = props;
  const list = useCollection(collectionId, options);
  // …you implement the render:
  //   • error → a short inline message
  //   • items === null → skeleton cards; [] → your honest empty state (no mock items)
  //   • else YOUR grid of YOUR cards: image via <img {...imgAttrs(item.photo, "(min-width: 768px) 33vw, 100vw")} alt={String(item.title)} />
  //     — src, srcSet, sizes and lazy loading in one spread; {} when the field is absent → your
  //     placeholder; title WRAPS (`min-w-0`, `break-words`), no `truncate`; the date as
  //     formatDate(item.publishDate); the card links to `/${collectionId}/${item.slug}`
  //   • hasNext → your "load more" control calling loadMore() (disabled while loadingMore)
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `hooks/` arrives, and CMS ships no components. The
state machines behind the hooks do arrive — `wix/cms/collection-store.ts`, `item-store.ts` — so you
never rewrite them: create a store per surface, `subscribe`, render from `getState()`, call its
actions. Their `CollectionState` / `ItemState` interfaces are the render contract; read those. What
you write is the rendering — cards, the item view, the states — to the skeletons above. The two
hooks under `references/cms/app/hooks/cms/` are the binding pattern, ten lines each, if your
framework's external-store primitive is unfamiliar.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass) and add one nav link
   per content surface.
2. Author your pages under `src/pages/` per the skeletons above — SSR fetch in the frontmatter,
   DTO props to your islands (`client:load`; a page with no interactivity needs no island at all).
3. Write `pages/index.astro` (home) on `SiteLayout`.
4. **Author your surfaces in as few messages as possible** — batch multiple Writes per message
   (components and pages are independent files).

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

`deploy.mjs cms --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/cms/` —
`items.ts`, `types.ts`, `items-core.ts`, and the two stores `collection-store.ts`, `item-store.ts`.
None of it is React. The hooks don't ship on this stack; the stores replace them, and you write the
components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createCollectionStore({ collectionId, filters?, sort?, limit?, include?, initialItems? })`
  per listing (`start()` when mounted, `stop()` when unmounted, `setQuery()` when filters change,
  `loadMore()`), `createItemStore({ collectionId, ref: { id } | { by }, initialItem? })` per item
  surface. State in, actions out — exactly the hooks' contracts above.

Routes `/<collection>`, `/<collection>/:slug` (via `getItemBy`, null → your 404); dev server on
4321; a static build goes through `npx @wix/cli@latest release` with `site.outputDirectory`
pointing at the build folder, an SSR build is hosted by you. Page tags from the item's own fields.

### Wiring — static site (`--stack static`, no bundler)

`deploy.mjs cms --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM, the
`.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` — pages,
styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project root
(config, plan, seed output) is never the upload. Same function names and DTOs as the table above,
so the contracts on this page hold unchanged: `queryItems`, `getItemBy`, `getItemById`,
`countItems` (and the writes) from `./js/wix/items.js`; `formatDate` from `./js/wix/items-core.js`;
`imgAttrs` from `./js/wix/media.js`. The state machines ship too: `createCollectionStore` from
`./js/wix/collection-store.js` (the listing — `start()` once the page is up, `loadMore()`,
`setQuery()`), `createItemStore` from `./js/wix/item-store.js` (the item page — `notFound` is your
404 state). No components ship — you write the rendering in plain JS: one render function per
surface that reads `getState()`, called from `subscribe`, with the surface's controls calling the
store's actions. Pages are `<collection>.html` and `item.html?collection=…&slug=…` (Wix static
hosting serves files, not directories — name the file and link to it). Set `document.title` and
the meta description from the item's fields once it loads. The visitor token persists in
`localStorage` on its own; never mint per page. Reads work on any collection whose `read` is
`ANYONE`; a write from the page succeeds only where the seed opened that verb (403 → a permissions
step). `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Run `deploy.mjs cms --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the
server:** port `js/wix/items.ts` and `items-core.ts` to your language — `queryItems`, `getItemBy`,
`getItemById`, `countItems` returning the same DTO shapes as dicts (the core's `toValue` rules:
`{ "$date": iso }` → ISO string, `wix:image://` → the https URL form in `media.ts`), one anonymous
visitor token per process for these public reads (mint and refresh per `client.ts`) — and render
the listing and item pages in your templates to the contracts above, so titles are in the HTML;
page tags from the item's fields. **Visitor writes in the browser** (a collection the seed opened
to visitors or members): `insertItem` from `./js/wix/items.js` on the page, exactly as the static
wiring above — the browser owns the visitor token, so the server handles no per-visitor tokens.
Routes stay `/<collection>`, `/<collection>/<slug>`.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for the
reads, run at build time with one anonymous token; the generator must emit every item page (walk
`queryItems` by `skip` until `hasNext` is false — never only the first page). Run
`deploy.mjs cms --stack static --out <build dir>` so `js/wix/` is inside the output the pages
import from, point `site.outputDirectory` at that folder, `wix release`. Pages sit at different
depths (`/`, `/<collection>/…`): give the templates one base path to `js/wix/` (a template
variable, or root-relative `/js/wix/…`), never a relative `./js/wix/` — it breaks one level down.
The frozen listing is the first paint; a filter or "load more" still runs client-side on it
through `createCollectionStore()` from `./js/wix/collection-store.js`, exactly as on a static
site. Close with the live URL, the rebuild + release command, and one line for the owner:
dashboard edits to the content reach the site when that command runs.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes are yours: a list route per collection on
`useCollection`, a detail route on `useItem` with `by: { field: "slug", value }` (components
fetch client-side when no `initialItems` / `initialItem` is passed). Deploy wrote the public
client id into `wix/config.ts`; nothing else to configure.

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
  permissions setup step (which permission, where in the dashboard), not a code bug. Anything
  that needs elevated access runs server-side per `references/shared/CUSTOM_OPERATIONS.md`.
- **User-created content is a CMS contribution flow.** For a member or visitor submission that
  the app must later list, use the seeded CMS collection and its intended permission preset.
  If the operation needs elevated access — especially a browser-created file that must enter
  Media Manager — follow `references/shared/CUSTOM_OPERATIONS.md`: validate the caller and
  input in a narrow server endpoint before elevating one documented operation. Never call a
  privileged Media API directly from a client island.
- **Use the shipped upload capability when it fits.** Declare its named policy in
  `plan.capabilities.mediaUpload`; Fast deploys the endpoint, client helper, dependencies, and
  generated policy module. Your CMS surface calls `uploadMedia(policyId, file)` and stores the
  returned Wix Media reference. Do not author another upload endpoint for that flow.
- **RICH_TEXT is HTML, not plain text** — render it with `set:html` (Astro) /
  `dangerouslySetInnerHTML` (React) on a wrapper; never interpolate it as text.
- **Dates through `formatDate`**, images through `imgAttrs` — the DTO's ISO string and https URL
  are data, not copy.
- Reference fields hold ids unless the query passed `include` — don't render an id as
  content.
- Guard absent IMAGE fields — `imgAttrs` returns `{}`; render a fallback, never an empty/broken `<img>`.
- **Page at the source, not on a loaded list.** `hasNext`/`loadMore()` fetch the next page from
  Wix; never raise the page limit instead of paging, never filter or sort client-side a page you
  already hold — pass `filters`/`sort` and let Wix apply them across the collection.
- **Call every hook before any conditional return.** An island that returns early for
  `notFound`/loading above its hooks changes hook order between renders and React throws.
- Where the shipped code deploys with Tailwind (Astro, React): theme via the `@theme` tokens, your
  markup on the same tokens; no parallel theme files, no hardcoded palettes. Where it doesn't
  (`lib`, `static`, a port): style with whatever your stack does well, on one token set of your
  own; the rule that survives is the token set, not Tailwind.
- Live data or an honest empty state — never mock items or invent fields not in the plan.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`); a collection id is its `_id` (the seed result lists them).

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Collections | `wix-cms` |
| A collection's items (fields, and More Actions → Permissions & Privacy) | `wix-cms/data/{collectionId}` |

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-cms.mjs` from the project root. The
plan is the content model your pages bind to: design collections that exercise the UI
(a `slug` field per detail page, an IMAGE field with a verified `imageUrl` per item, a DATE
field when the content is chronological).
