# Wix CMS — ready-made client

The CMS client is **shipped as real files**, not snippets to regenerate. It's a complete
list + detail over any Wix Data collection, styled entirely from `theme.css` tokens and pointed at
your collection from one `collection.config.js`. Copy it into the app, theme the tokens, map your
fields, wire the routes — you generate almost none of the data code (query/cursor pagination, detail
resolution by slug-or-id, image-URI conversion, empty state all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens) using the official
Wix Data endpoints. Never mock items; never hand-build a Wix Data URL — the shipped helpers call
`/wix-data/v2/items`.

## Prerequisites
- A Wix site with **a data collection** (CMS / Content Manager) as the read target. It's created and
  seeded separately (see **Seeding** below), in parallel with this build — so it may be empty at
  build time; the client renders the shipped empty state until items land. This skill does NOT
  provision collections.
- **Collection permissions** must grant the action you do to "Anyone" — this client runs as an
  anonymous visitor. Read for listing/detail (**Show content → Everyone**); Insert only if you add a
  public form. Update/Delete are admin/author-only and will 403 for a visitor. The owner sets these
  in the dashboard (CMS → collection → Permissions) — a **separate Wix setup step**, out of scope. A
  403 before it's set is expected; flag it and continue.
- The public headless **`WIX_CLIENT_ID`** (and `WIX_METASITE_ID`) from your prompt (buyer-facing,
  safe to hardcode/commit).

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole CMS UI client + REST scaffolds into `src/`
(imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map, so you
don't need to open them:**

| file | what it is |
|---|---|
| `theme.css` | design tokens — the **only** file you edit to re-skin (STEP 3) |
| `collection.config.js` | **you point at your collection + map field keys here** (STEP 2) |
| `hooks/useCollection.js` | list data — count, first page, cursor pagination for the configured collection |
| `hooks/useItemDetail.js` | detail data — resolves one item by slug (or `_id`) for a route |
| `components/ItemCard.jsx`, `ItemGrid.jsx` | list UI (grid + card, with empty state) |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `lib/wixImage.js` | converts a `wix:image://` media field to a renderable URL (used by the UI) |
| `pages/Collection.jsx`, `pages/ItemDetail.jsx` | the two shipped routes (list + detail) |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` + `rest/wix-cms.js` | REST transport + Wix Data helpers |

They're already in place — go **straight to config + theming + wiring**, nothing to verify first.
**Don't `read_file` the shipped page/component/hook source to inspect it** — the table says what each
is and every field shape you need is in the snippets below. Read a shipped file's source **only** on
a real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/cms/app/` → `src/`.)

## STEP 2 — Credentials + point at your collection
Two one-file edits (the CMS equivalent of storefront's credentials step):
- `src/rest/wix-config.js` — set `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt (the one place
  both ids live).
- `src/collection.config.js` — set `COLLECTION_ID` to your collection's **name** (e.g. `"Recipes"` —
  it's the id in Wix Data, not a GUID), and map `FIELDS` (`title`, `image`, `summary`, `body`,
  `date`, `slug`) to your collection's field keys. **Use the field keys from your own seed / design
  plan** as the canonical list — don't guess or reverse-engineer them from a fetched row. Set any
  role you don't have to `null` and the UI omits it; `title` is the only required role. If you map a
  `slug` field, detail URLs use it; otherwise they fall back to the item's `_id`.

## STEP 3 — Theme (the styling step — do ONLY this to the shipped components)
Edit `src/theme.css` tokens to the brand: palette, `--font-display`/`--font-body`, `--radius`,
spacing. Every shipped component reads these vars, so this re-skins the whole client. **Do not
restyle the shipped components' JSX** — that's what keeps this a copy, not a regeneration. Style the
home page / header you build (STEP 4) from the same tokens so it matches. Dark brand → activate the
dark tokens with `document.documentElement.dataset.theme = "dark"`.

## STEP 4 — Wire routes (surgical `find_replace` on `src/App.jsx`, never a rewrite)
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- `import "@/theme.css";` once at the app entry.
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Collection` / `ItemDetail` — so you **never edit the shipped pages to add a
  header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's **ResizeObserver-measured** height so it clears the chrome and
  self-corrects when the banner is dismissed.
- Routes under the Layout: your list path → `Collection`, `/item/:key` → `ItemDetail` (both shipped,
  as-is). **You add `/` → your own Home** page. (The list path and `/item/:key` are conventions — the
  card links to `/item/:key`; if you rename that route, keep the two in sync.)

CMS has **no cross-page state** (no cart), so there's **no provider to wrap** — this is the one place
the CMS Layout is simpler than storefront's `<CartProvider>`/`<CartDrawer>`.

```jsx
import "@/theme.css";
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only
import Collection from "@/pages/Collection";
import ItemDetail from "@/pages/ItemDetail";
import Home from "@/pages/Home";           // YOU build
import Header from "@/components/Header";   // YOU build — plain in-flow markup, NOT position:fixed
import Footer from "@/components/Footer";   // YOU build

function Layout() {
  const topRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {                                  // measure the fixed region → pad content below it
    const ro = new ResizeObserver(() => setOffset(topRef.current?.offsetHeight ?? 0));
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);
  return (<>
    <div ref={topRef} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <WixManageBanner />                    {/* null in prod / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped Collection/ItemDetail render here, untouched */}
      <Footer />
    </div>
  </>);
}

<Routes>
  <Route element={<Layout />}>                              {/* chrome wraps all */}
    <Route path="/" element={<Home />} />                   {/* yours */}
    <Route path="/browse" element={<Collection />} />       {/* shipped — rename the path to your content */}
    <Route path="/item/:key" element={<ItemDetail />} />    {/* shipped, as-is */}
  </Route>
</Routes>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** and a **`Footer`** — the two you drop into the `Layout`
(STEP 4) so they wrap every route — plus the overall brand story, styled from the same `theme.css`
tokens. **Compose the shipped pieces** — a featured strip is just `useCollection` + the shipped
`ItemGrid`; the nav is a link to your list route. Build the `Header` responsive via a **single-branch
`mobile`-state ternary** (copy storefront's pattern) — **never** a Tailwind `hidden md:*` toggle on an
inline-styled component (an inline `display` beats a Tailwind class, so both branches would render).

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useCollection } from "@/hooks/useCollection";
import ItemGrid from "@/components/ItemGrid";

export function Header() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);            // keep it reactive to viewport changes
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* brand/logo */}
      {mobile
        ? <YourMenu />                                       // your hamburger here
        : <div style={{ display: "flex", gap: 24 }}><Link to="/browse">Browse</Link></div>}
    </nav>
  );
}

export function Featured() {                                // on your home page
  const { items } = useCollection({ limit: 6 });            // hook returns { items, total, loadMore, hasMore }
  return <ItemGrid items={items || []} empty="Content coming soon." />;
}
```
Everything visual reads `theme.css` tokens, so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client (data shapes that are load-bearing)
The shipped hooks own the common paths; when you call the helpers directly (a filtered strip, a
search box, a form), keep this wiring — it's the bug-prone part:

```jsx
import { queryDataItems, getDataItem, getDataItemBy, countDataItems, insertDataItem } from "@/rest/wix-cms";

// LIST — queryDataItems resolves to { items, nextCursor } (NOT a bare array). Each item is the flat
// `data` payload and always carries `_id`. Pass nextCursor back as `cursor` for the next page;
// define filter/sort on the FIRST request only (cursor follow-ups reuse them — pass only the cursor).
const { items, nextCursor } = await queryDataItems("Recipes", {
  sort: [{ fieldName: "publishDate", order: "DESC" }],        // array of { fieldName, order } — NOT { field: -1 }
  filter: { publishDate: { $lte: { "$date": new Date().toISOString() } } }, // date wrapped { "$date": ISO }
  limit: 24,
});

// DETAIL — route by the item's `_id` (getDataItem) or a slug field (getDataItemBy); null on miss →
// show a not-found state, never invent an item. (useItemDetail already does this off collection.config.)
const one = await getDataItemBy("Recipes", "slug", slugFromUrl);

// FILTER & SEARCH — operators: $eq $ne $gt $gte $lt $lte $in $nin $startsWith $exists $hasSome $hasAll,
// combined with $and/$or/$not. Simple text search: { title: { $startsWith: term } }.

// MULTI_REFERENCE fields are NOT inline — without asking, item.<field> isn't populated. Pass
// includeReferences: [{ field: "ingredients", limit: 10 }] to queryDataItems, THEN .map item.<field>.

// PUBLIC FORM — insertDataItem("Reviews", { name, email, message }); needs Insert = "Anyone".
// Resolves to the flat inserted `data` payload (with _id); throws on failure — never fake success.
```

**Images are handled by the shipped `lib/wixImage.js`.** A merchant-uploaded image field comes back
as a `wix:image://…` media URI the browser can't render; `wixImage()` converts it (and passes
`https://` / `//` URLs through). The shipped `ItemCard`/`ItemDetail` already run every image through
it — if you render an image yourself, do the same: `import { wixImage } from "@/lib/wixImage"`.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Point at your collection + map `FIELDS` in `collection.config.js` (STEP 2) — using your seed plan's
  field keys, not guesses.
- Theme via `theme.css` tokens, never by rewriting the shipped components.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped
  `Collection`/`ItemDetail` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your
  `Header` is plain in-flow markup (not `position:fixed`).
- Read/write ONLY through the `wix-cms.js` helpers (they call the official Wix Data endpoints) — never
  hand-build a Wix Data URL.
- `queryDataItems` resolves to `{ items, nextCursor }` (destructure, iterate `.items`); `sort` is
  `[{ fieldName, order }]` (not Mongo `{ field: -1 }`); date comparands wrap as `{ "$date": ISO }`.
- Convert `wix:image://` URIs (via `lib/wixImage.js`) before `<img src>` — never render one raw.
- The owner field is `_owner` (Wix Data v2), not `_ownerId`. A "my items" view is
  `queryDataItems(collectionId, { filter: { _owner: memberId } })`.
- `updateDataItem` REPLACES the whole item — fetch + merge first (or use Patch Data Item).
- Render live Wix data or the shipped empty state — never mock items; never invent fields not in the
  collection.
- Treat a 403 as a permissions setup step (tell the user which permission to grant), not a code bug.

## Fallback only — beyond the shipped client
When you hit an error or need something the shipped client doesn't cover, make the call yourself with
`wixApiRequest` — but look up the exact endpoint, method, and body in the **official Wix API
reference** first; never guess. Or read the relevant shipped file under `src/`, or use the
**`wix-docs`** skill.
- CMS / Data Items API reference: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items.md
- **Partial update**: Patch Data Item — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/patch-data-item.md
- **Upsert by id**: Save Data Item — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/save-data-item.md
- **Bulk** insert/update/save/remove: https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items.md
- **Free-text / fuzzy search**: Search Data Items — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/search-data-items.md
- **Aggregations**: Aggregate Data Items — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/aggregate-data-items.md
- **Distinct values** (e.g. a filter menu): Query Distinct Values — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-distinct-values.md
- **Referenced items** (beyond the inline limit): Query Referenced Data Items — https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-referenced-data-items.md
- **Collection schema / field keys**: Get Data Collection — https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/get-data-collection.md
- **Member-gated & user-generated content** → the **members** vertical (`references/members/INSTRUCTIONS.md`).
  Keep a feature's data and identity together on one side: for Wix-backed member content, store the row
  in a Wix collection and key it on the server-stamped `_owner`.

## Point the user to their dashboard
Provide deep links so the owner can edit content (substitute the site's `metaSiteId`, from the handoff
/ `ListWixSites`):
- **Collections & items** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-cms` (`Dashboard → CMS`)
  → **Create Collection**, then open a collection to add items.
- **Permissions** — same CMS area → open the collection → **More Actions → Permissions & Privacy**. For
  the headless app to read anonymously, set **Show content** to *Everyone*; for a public form, set
  **Collect content** to *Everyone*. Update/Delete stay admin-only.

## Seeding
Seed the collection per `seed/SEED.md` (the build-time seed module) — separate from this client build;
run in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] `collection.config.js`: `COLLECTION_ID` set to the collection name; `FIELDS` mapped to your
      real field keys (from the seed plan); unused roles set to `null`.
- [ ] `theme.css` themed to the brand; shipped components/pages not restyled or rewritten.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all
      routes; shipped `Collection`/`ItemDetail` untouched; content clears the fixed chrome.
- [ ] `useCollection` returns live items (destructured from `{ items, nextCursor }`); Load-more paginates.
- [ ] Detail page resolves by slug (or `_id`) and shows a not-found state on miss — no invented item.
- [ ] Image fields render (via `lib/wixImage.js`) — `wix:image://` URIs converted, not shown raw.
- [ ] Empty collection shows the shipped empty state; no mock items anywhere.
- [ ] Any 403 surfaced to the user as a permissions step; told the user they can keep editing content
      in the dashboard, with deep links.
