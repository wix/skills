# Wix Portfolio — ready-made client

The portfolio client is **shipped as real files**, not snippets to regenerate. It's a complete
collections gallery + collection page + project detail (media gallery + `details[]` rows), styled
with your app's design tokens (base44's `src/index.css` — the shadcn palette the design phase already
set). The install step copied it into `src/`; you wire the routes — you generate almost none of the
read/render code (return-object destructuring, `item.type` media branching, the `details[]` link
shape all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Portfolio is
**read-only**: never mock projects, never invent media — render live Wix data or the shipped empty
state. The content tree is **Collection → Project → Project Item (image/video)**.

## Prerequisites
- The site's **Wix Portfolio** is the read target. It's installed and seeded separately (see
  **Seeding** below), in parallel with this build — so it may be empty at build time; the client
  renders the shipped empty state until collections and projects land.
- The public headless **`WIX_CLIENT_ID`** from your prompt (visitor-facing, safe to hardcode/commit).
- If the read calls return `403`/`428` before content is published, the Portfolio app or its content
  may not be live yet — a **Wix dashboard step the owner completes**, out of scope here. Flag it and
  continue; don't fall back to mock data.

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole portfolio UI client + REST scaffolds into
`src/` (imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map,
so you don't need to open them:**

| file | what it is |
|---|---|
| `hooks/usePortfolioGallery.js` | collections gallery data — first page + count + cursor paging |
| `hooks/useCollectionProjects.js` | one collection's header + its projects (paged), by slug |
| `hooks/useProjectDetail.js` | project + its media gallery, by slug (null → not-found) |
| `components/CollectionCard.jsx`, `CollectionGrid.jsx` | collections listing UI (grid + card, with empty state) |
| `components/ProjectCard.jsx`, `ProjectGrid.jsx` | projects listing UI (grid + card, with empty state) |
| `components/ProjectMedia.jsx` | one gallery item — branches on `item.type` (IMAGE / VIDEO) |
| `components/WixManageBanner.jsx` | preview-only manage banner — drop it into your Layout (STEP 3) |
| `pages/Portfolio.jsx` | collections gallery route (`/portfolio`) |
| `pages/CollectionPage.jsx` | collection page route (`/collection/:slug`) |
| `pages/ProjectDetail.jsx` | project detail route (`/project/:slug`) |
| `rest/wix-config.js` | the two ids, written by the install step |
| `rest/wix-client.js` + `rest/wix-portfolio.js` | REST transport + portfolio read helpers |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each
is and every field shape you need is in the snippets below. Read a shipped file's source **only** on
a real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/portfolio/app/` → `src/`.)


## STEP 2 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens in
`src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`, `--muted`,
`--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`, `text-foreground`,
`bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`, `font-display`). Those tokens
are **already set to the brand by the design phase**, so the shipped pages are themed with zero work
here. To adjust the palette, edit `index.css` (`:root` **and** `.dark`) — the base44 way; **never add
a parallel theme file (e.g. a `theme.css`) or restyle the shipped JSX.** Build the Home/Header you add
(STEP 3) from the **same** base44 tokens/classes so it matches automatically. A dark brand is just
base44's dark palette in `index.css` — no per-component work.

## STEP 3 — Wire routes (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it. Portfolio is read-only with no cross-page state, so there's **no provider to wrap** (no
cart equivalent) — just the Layout and the routes.
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Portfolio` / `CollectionPage` / `ProjectDetail` — so you **never edit the
  shipped pages to add a header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, preview-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/portfolio` → `Portfolio`, `/collection/:slug` → `CollectionPage`,
  `/project/:slug` → `ProjectDetail` (all shipped, as-is). **You add `/` → your own Home** page.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, preview-only · default export, no props
import Portfolio from "@/pages/Portfolio";             // shipped · default export, no props
import CollectionPage from "@/pages/CollectionPage";   // shipped · default export, no props
import ProjectDetail from "@/pages/ProjectDetail";     // shipped · default export, no props
import Home from "@/pages/Home";        // YOU build
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
      <WixManageBanner />                    {/* null on the published site / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped pages render here, untouched */}
      <Footer />
    </div>
  </>);
}

<Routes>
  <Route element={<Layout />}>                                     {/* chrome wraps all */}
    <Route path="/" element={<Home />} />                          {/* yours */}
    <Route path="/portfolio" element={<Portfolio />} />            {/* shipped, as-is */}
    <Route path="/collection/:slug" element={<CollectionPage />} />{/* shipped, as-is */}
    <Route path="/project/:slug" element={<ProjectDetail />} />    {/* shipped, as-is */}
  </Route>
</Routes>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** and a **`Footer`** — the two you drop into the `Layout`
(STEP 3) so they wrap every route — plus the overall brand story, styled with the same base44
tokens/classes. **Compose the shipped pieces** — a featured strip is just `queryCollections` (or
`queryProjects`) + the shipped `CollectionGrid` / `ProjectGrid`; the nav is a link to `/portfolio`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryCollections } from "@/rest/wix-portfolio";
import CollectionGrid from "@/components/CollectionGrid";

// Responsive header: choose ONE branch with a state flag — do NOT render a desktop nav AND a mobile
// nav toggled by `hidden md:flex` / `md:hidden`. These navs are inline-styled, and an inline
// `display` beats a Tailwind class, so `hidden` never applies — BOTH branches render. One branch.
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
        ? <YourMenu />                                       // your hamburger + a link to /portfolio
        : <div style={{ display: "flex", gap: 24 }}><Link to="/portfolio">Work</Link></div>}
    </nav>
  );
}
export function Featured() {                                // on your home page
  const [collections, setCollections] = useState([]);
  // NB: queryCollections returns { collections, nextCursor } — destructure the array.
  useEffect(() => { queryCollections({ limit: 6 }).then(({ collections }) => setCollections(collections)); }, []);
  return <CollectionGrid collections={collections} empty="Collections coming soon." />;
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI (hand-built lists, images)

**Every list helper returns an OBJECT, not a bare array** — destructure the named key first, or
`.map`/`.filter` on the result throws `… is not a function` (the #1 portfolio-listing bug):

```jsx
// listings — destructure the named array + the cursor:
const { collections, nextCursor } = await queryCollections({ limit: 24 });   // visible, dashboard order
const { projects } = await queryProjects({ limit: 24 });                     // all work, newest-first
const { projects: inCollection } = await queryProjectsByCollection(collectionId, { limit: 24 });
const { items, total } = await listProjectItems(projectId);                  // gallery — iterate `items`

// single fetches return the object or null (render a not-found/empty state, never invent one):
const collection = await getCollectionBySlug(slug);
const project = await getProjectBySlug(slug);   // or getProject(id) when you hold a GUID
const n = await countCollections();             // number → 0 means the empty state

// media item branches on item.type ("IMAGE" | "VIDEO" | "UNDEFINED") — the shipped ProjectMedia
// already does this: IMAGE → item.image.imageInfo.url; VIDEO → item.video.videoInfo.resolutions[0].url
// (poster item.video.videoInfo.posters[0]). details[] rows: { label, text? } OR { label, link: { text, url, target } }.

// An image you render yourself (hero / custom card): make the url https + keep a token bg so a
// just-generated url that 404s for a second reads as a surface, not a blank block.
function BrandImage({ url, alt }) {
  const src = url?.startsWith("//") ? `https:${url}` : url;      // the shipped cards already do this
  return <div className="bg-card"><img src={src} alt={alt} /></div>;
}
```

Cover images live at `collection.coverImage.imageInfo.url` and `project.coverImage.imageInfo.url`
(projects are a one-of: fall back to `coverVideo.videoInfo.posters[0].url` / `resolutions[0].url`).

Fallback only — when you hit an error or need something not shown here (collection SEO, portfolio
settings, a field these snippets don't have): read the relevant shipped file under `src/`, or look
it up via the **`wix-docs`** skill / the Portfolio API reference. Each helper in `wix-portfolio.js`
links its own reference page inline; the whole area is here:
- Portfolio (collections, projects, project items): https://dev.wix.com/docs/api-reference/business-solutions/portfolio.md

## Hard rules
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 3) — never edit the shipped
  `Portfolio`/`CollectionPage`/`ProjectDetail` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your
  `Header` is plain in-flow markup (not `position:fixed`).
- Route on `slug` (`getCollectionBySlug`/`getProjectBySlug`); use `getProject(id)` only when you hold a GUID.
- Render live Wix data or the shipped empty state — never mock projects, collections, or media, and
  never hand-build Wix Media URLs or page permalinks (use the `url`/`imageInfo.url`/`resolutions[].url`
  fields Wix returns). Hidden collections/projects are already filtered out — don't add them back.

## Point the user to their dashboard
Provide the deep link so the owner can edit content (substitute the site's `metaSiteId`):
- **Portfolio** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-portfolio/projects`
  (`Dashboard → Portfolio`). Projects and Collections are tabs on this one page: the **Projects** tab
  adds projects and their media galleries; the **Collections** tab groups projects into collections.

## Seeding
Seed collections and projects per `seed/SEED.md` — separate from this client build; run in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] Opened the vertical's data route(s) (`/portfolio`, a collection, a project) — not just the home page — and confirmed the shipped components render themed (surface, text, brand) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all
      routes; shipped `Portfolio`/`CollectionPage`/`ProjectDetail` untouched; content clears the fixed chrome.
- [ ] Visitor token persists across reload (no re-mint storm; reads stay fast).
- [ ] Collections gallery renders live collections with cover images, in dashboard order.
- [ ] Clicking a collection lists its projects via `queryProjectsByCollection`.
- [ ] Project page renders the media gallery from `listProjectItems` (images AND videos) and the
      `details[]` rows (text rows and link rows both).
- [ ] Slug routing works; an unknown slug shows the shipped not-found state (no invented content).
- [ ] Empty catalog shows the shipped empty state (`countCollections()` is 0); no mock content anywhere.
- [ ] Told the user they can continue setting up their portfolio in the dashboard, with the deep link.
