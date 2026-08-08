# Wix Blog — ready-made client

The blog reader is **shipped as real files**, not snippets to regenerate. It's a complete feed + post
detail + category/tag landing pages, styled with your app's design tokens (base44's `src/index.css` —
the shadcn palette the design phase already set). Copy it into the app and wire the routes — you
generate almost none of the reader code (post paging, slug routing, the category/tag id→label
resolution, the plain-text body split all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). The reader is
**read-only and visitor-facing** — it never creates, edits, or moderates content. Never mock posts;
never hand-build a post/category/tag URL — route by `slug` through the shipped helpers.

## Prerequisites
- The site's **Wix Blog** is the read target. It's installed and seeded separately (see **Seeding** below), in parallel with this build — so it may be empty at build time; the client renders the shipped empty state until posts land. Draft/unpublished posts are never returned.
- The public headless **`WIX_CLIENT_ID`** from your prompt (visitor-facing, safe to hardcode/commit).

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole blog UI client + REST scaffolds into `src/`
(imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map, so you
don't need to open them:**

| file | what it is |
|---|---|
| `context/TaxonomyContext.jsx` | `useTaxonomy()` provider: categories + tags fetched **once**, exposed as `catById` / `tagById` id→object maps |
| `hooks/usePostDetail.js` | post-detail data — load by slug, not-found state, resolved category/tag chips, body paragraphs |
| `components/PostCard.jsx`, `PostGrid.jsx` | post listing UI (grid + card, with cover image + empty state) |
| `components/PostChips.jsx` | category/tag chips for a post (resolves ids via the taxonomy, routes by slug) |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `pages/Blog.jsx` | the feed route (`/blog`) — lists posts, paginates, empty state |
| `pages/PostDetail.jsx` | the post route (`/blog/:slug`) |
| `pages/CategoryPage.jsx`, `TagPage.jsx` | the taxonomy landing routes (`/blog/category/:slug`, `/blog/tag/:slug`) |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` + `rest/wix-blog.js` | REST transport + blog helpers (posts/categories/tags) |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each is
and every field shape you need is in the snippets below. Read a shipped file's source **only** on a
real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/blog/app/` → `src/`.)

## STEP 2 — Credentials
Write `src/rest/wix-config.js` with your `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt — the
one place both ids live.

## STEP 3 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens in
`src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`, `--muted`,
`--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`, `text-foreground`,
`bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`, `font-display`). Those tokens
are **already set to the brand by the design phase**, so the shipped pages are themed with zero work
here. To adjust the palette, edit `index.css` (`:root` **and** `.dark`) — the base44 way; **never add
a parallel theme file (e.g. a `theme.css`) or restyle the shipped JSX.** Build the Home/Header you add
(STEP 4) from the **same** base44 tokens/classes so it matches automatically. A dark brand is just
base44's dark palette in `index.css` — no per-component work.

## STEP 4 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- Wrap the routed tree in `<TaxonomyProvider>` (from `@/context/TaxonomyContext`) so categories/tags
  are fetched **once** and every card/chip reuses the shared map (never re-query per post).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Blog` / `PostDetail` / category / tag pages — so you **never edit the
  shipped pages to add a header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/blog` → `Blog`, `/blog/:slug` → `PostDetail`, `/blog/category/:slug` →
  `CategoryPage`, `/blog/tag/:slug` → `TagPage` (all shipped, as-is). **You add `/` → your own Home** page.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { TaxonomyProvider } from "@/context/TaxonomyContext";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only · default export, no props
import Blog from "@/pages/Blog";                       // shipped · default export, no props
import PostDetail from "@/pages/PostDetail";           // shipped · default export, no props
import CategoryPage from "@/pages/CategoryPage";       // shipped · default export, no props
import TagPage from "@/pages/TagPage";                 // shipped · default export, no props
import Home from "@/pages/Home";       // YOU build
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
      <Outlet />                             {/* shipped Blog / PostDetail / Category / Tag render here, untouched */}
      <Footer />
    </div>
  </>);
}

<TaxonomyProvider>
  <Routes>
    <Route element={<Layout />}>                                    {/* chrome wraps all */}
      <Route path="/" element={<Home />} />                         {/* yours */}
      <Route path="/blog" element={<Blog />} />                     {/* shipped, as-is */}
      <Route path="/blog/:slug" element={<PostDetail />} />         {/* shipped, as-is */}
      <Route path="/blog/category/:slug" element={<CategoryPage />} /> {/* shipped, as-is */}
      <Route path="/blog/tag/:slug" element={<TagPage />} />        {/* shipped, as-is */}
    </Route>
  </Routes>
</TaxonomyProvider>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** and a **`Footer`** — the two you drop into the `Layout`
(STEP 4) so they wrap every route — plus the overall brand story, styled with the same base44
tokens/classes. **Compose the shipped pieces** — a "latest posts" strip is just `queryPosts` + the shipped
`PostGrid`; a category nav is `useTaxonomy()` + links to `/blog/category/:slug`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryPosts } from "@/rest/wix-blog";
import { useTaxonomy } from "@/context/TaxonomyContext";
import PostGrid from "@/components/PostGrid";

// Responsive header: choose ONE branch with a state flag (never a Tailwind `hidden md:*` toggle —
// these navs are inline-styled, and an inline `display` beats a Tailwind class, so `hidden` never
// applies and BOTH branches render). One branch = one nav.
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
        ? <YourMenu />                                       // your hamburger + links here
        : <div style={{ display: "flex", gap: 24 }}><Link to="/">Home</Link><Link to="/blog">Blog</Link></div>}
    </nav>
  );
}
export function Latest() {                                   // on your home page
  const [posts, setPosts] = useState([]);
  // NB: queryPosts returns { posts, nextCursor } — destructure the array.
  useEffect(() => { queryPosts({ limit: 6 }).then(({ posts }) => setPosts(posts)); }, []);
  return <PostGrid posts={posts} empty="Posts coming soon." />;
}
export function CategoryNav() {                              // a menu of the blog's categories
  const { categories } = useTaxonomy();                     // fetched once by the provider
  return categories.filter((c) => c.postCount > 0)          // hide empty categories if you want
    .map((c) => <Link key={c.id} to={`/blog/category/${c.slug}`}>{c.label}</Link>);
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI

```jsx
// Every list helper returns an OBJECT, not a bare array — destructure first, or `.map` throws:
const { posts, nextCursor } = await queryPosts({ limit: 20 });          // pass nextCursor back as `cursor`
const { categories, total } = await queryCategories();                  // display c.label · count c.postCount
const { tags } = await queryTags();                                     // display t.label · count t.publishedPostCount
const { posts: inCategory } = await queryPostsByCategory(categoryId, { limit: 20 });
const { posts: withTag }    = await queryPostsByTag(tagId, { limit: 20 });

// Single-item lookups fail soft (null on miss) — show a not-found state, never invent an item:
const post = await getPostBySlug(slug);         // null → 404 state
const cat  = await getCategoryBySlug(slug);
const tag  = await getTagBySlug(slug);

// Cover image: post cover and category cover are DIFFERENT paths.
const postCover = post.media?.wixMedia?.image?.url;   // post/card cover (ready-to-use https)
const catCover  = cat.coverImage?.url;                // category landing cover
// No post cover? fall back to the first richContent IMAGE node, or a text-only card — never a stock image.

// Body: contentText is plain text (split on "\n" for paragraphs — the shipped hook does this).
// richContent is a Ricos document for a faithful render (images/embeds) — see "Extending".
```

**No author byline** — the reader helpers don't expose an author (`post.author` is undefined). Omit
the byline, or resolve it via the **members** vertical. **No engagement UI** — comments/likes/views
aren't exposed; leave them out.

## Extending the client
Building something beyond the shipped pages (faithful `richContent`, full-text search, related posts,
metrics, members-only posts)? Extend with `wixApiRequest`, but look up the exact endpoint/method/body
in the **official Wix API reference** first — never guess. Each helper in `wix-blog.js` links its
reference page inline.
- Blog API reference: https://dev.wix.com/docs/api-reference/business-solutions/blog.md
- Rendering `richContent` (Ricos document): https://dev.wix.com/docs/ricos/api-reference/ricos-document
- **Members-only posts** → the **members** vertical: once a member is logged in, the shipped read
  helpers return the gated content with no extra code (member *writes* — comments, likes — are not
  included; add them as an authenticated `wixApiRequest` call).

Fallback only — when you hit an error or need something not shown here: read the relevant shipped file
under `src/`, or look it up via the **`wix-docs`** skill.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped `Blog`/`PostDetail`/category/tag pages to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your `Header` is plain in-flow markup (not `position:fixed`).
- Route by `slug` through the shipped helpers — never hand-build a post/category/tag URL. Display categories/tags by `.label` (not `.name`).
- Render live Wix data or the shipped empty state — never mock posts, authors, comments, likes, or view counts; never use a stock/placeholder cover image.

## Point the user to their dashboard
Provide deep links so the owner can edit content (substitute the site's `metaSiteId`):
- **Posts** — `https://manage.wix.com/dashboard/{metaSiteId}/blog/posts` (write, edit, publish; only published posts appear in the app)
- **Categories** — `https://manage.wix.com/dashboard/{metaSiteId}/blog/categories`

## Seeding
Seed the blog per `seed/SEED.md` (the build-time module that creates posts/categories over the
connector) — separate from this client build; run in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] **Opened the vertical's data route(s)** (not just the home page) — `/blog` and a post detail page (plus a category/tag page) — and confirmed the shipped components render themed (surface, text, brand) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all routes; shipped `Blog`/`PostDetail`/`CategoryPage`/`TagPage` untouched; content clears the fixed chrome; `<TaxonomyProvider>` wraps the tree.
- [ ] Feed lists live published posts (newest first) and paginates via `nextCursor`; post detail loads by `slug`; a bad slug shows the not-found state (no invented post).
- [ ] Category/tag pages list the right posts; chips display `.label` and route by `.slug`; taxonomy fetched once (no re-query per card).
- [ ] Cover images come from `post.media.wixMedia.image.url` (category cover from `category.coverImage.url`) — no stock placeholders; no author byline / engagement UI invented.
- [ ] Empty catalog shows the shipped empty state; no mock posts anywhere.
