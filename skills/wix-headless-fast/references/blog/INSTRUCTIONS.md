# Blog — playbook

The blog machinery ships as files — post reads (feed paging, slug lookup with the body
fieldsets), category/tag taxonomy, the feed and post state machines, and the Ricos body renderer,
typed end-to-end. **The presentation doesn't ship — you build it** on the shipped hooks/DTOs: the
post card, the grid, the blog index surface, the post page surface, the home page, and the brand.
You never write blog data logic; you never skip designing. The vertical is **read-only** —
visitors read posts; authoring stays in the dashboard.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two
shipped pages' templates. Files you **create**: your feed island (skeleton below), your post
surface, and your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes, ratio)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(post.coverUrl, "(min-width: 1024px) 33vw, 100vw", 9 / 16)} alt={post.title} />`; `imgSrc()` / `imgSrcSet()` underneath |
| `wix/blog/types.ts` | the DTOs (`PostSummary`, `PostDetail`, `BlogCategory`, `BlogTag`, `PostPage`) — contracts inlined below |
| `wix/blog/posts.ts` | `fetchPosts` (cursor-paged, category/tag filtered on Wix), `fetchPostBySlug` (full body), `postMetaLine(post)` ("Aug 27, 2026 · 4 min read") — the transport; the rules and DTO mappers are in `posts-core.ts` beside it (shared with the REST layer) |
| `wix/blog/taxonomy.ts` | `fetchBlogCategories`, `fetchBlogTags`, `fetchCategoryBySlug`, `fetchTagBySlug` — the transport; mappers in `taxonomy-core.ts` |
| `wix/blog/blog-feed-store.ts` · `post-store.ts` | the feed and post state machines, framework-free (`createBlogFeedStore()`, `createPostStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/blog/useBlogFeed.ts` | React binding of `blog-feed-store.ts`: feed + taxonomy filter + load-more — contract below |
| `hooks/blog/usePost.ts` | React binding of `post-store.ts`: post by slug + resolved chips — contract below |
| `components/blog/RichContent.tsx` | the post-body renderer — **wire as-is** (machinery, not a reference) |
| `components/blog/BlogFeedView.tsx` (+ `PostCard`) · `PostView.tsx` | **reference implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add a Blog nav link there |
| `pages/blog.astro` | SSR feed — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/blog/[...slug].astro` | SSR post page with owner-editable SEO — **keep the frontmatter, the `[...slug]` rest param, and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; restyle the template. The body island stays `client:only="react"` (the ricos viewer breaks under SSR). A slug that resolves to nothing returns a real 404 |

## What you build — the design job

1. **The post card + grid** — your tile (cover, title, excerpt, `postMetaLine(post)`) and rhythm,
   with skeletons while `posts === null` and an honest empty state for `[]`.
2. **The blog index surface** — the feed island on `useBlogFeed`: category filter (only when >1
   non-empty category), the grid, and a load-more control gated on `hasMore`.
3. **The post page surface** — header (categories eyebrow, title, meta line, cover), the body via
   the shipped `RichContent`, and the tag chips — restyle the `[...slug].astro` template around it.
4. **The home page** — hero, latest posts (fetch in frontmatter → your components), brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens. Dark theme: the ricos CSS hardcodes
near-black text — add a global override scoping `.ricos-content` to the foreground token
(in Astro use `<style is:global>`; React islands don't inherit scoped Astro styles).

### What a complete blog shows (recommended defaults)

Defaults for a blog whose brief says nothing about them; the prompt wins where it differs. Look at
the seeded content before designing (how many posts, categories, covers, body structure) and design
for this blog, not for a stereotype of one.

- **Home:** what the blog is about and the latest posts (real ones, under a truthful heading) in the
  first screen; a category link goes to the feed filtered to it, never to an anchor.
- **Index:** a real card — cover, title, meta line — in the first screen at 390px too; the category
  row only when more than one category has posts; loading, empty, and error states that look
  different; load-more, never a raised page size.
- **Post page:** eyebrow, title, meta line, cover as a bounded band on phones (`max-h-[45vh]`), the
  body, then the tags; a slug that resolves to nothing shows only the not-found state.
- **Copy:** nothing the author didn't write — no invented bylines, comment counts, likes, or
  "trending" labels; no Wix IDs or technical words in visible text.

### The contracts your components consume

Tested and working as they are; read the source when something is off or the brief wants more.

```ts
// PostSummary (tiles) — display-ready:
// { id, slug, title, excerpt, dateLabel /* "Aug 26, 2026" | "" */, dateISO,
//   minutesToRead /* 0 = unknown */, featured, pinned, coverUrl /* "" = no cover, 16:9 */,
//   categoryIds, tagIds }
// postMetaLine(post) → "Aug 26, 2026 · 4 min read" (either half alone; "" when neither is known) —
//   render it inside <time dateTime={post.dateISO}>; don't hand-assemble the separator.
// PostDetail adds: richContent (Ricos JSON | null — render ONLY via RichContent),
//   paragraphs (plain-text fallback body).
// BlogCategory: { id, slug, label, description, postCount, coverUrl }   // display .label
// BlogTag:      { id, slug, label, postCount /* published posts */ }

// useBlogFeed({ initialPage?, initialCategories?, initialTags?, pageSize? /* 20 */ }) →
// { posts: PostSummary[]|null /* null = loading → skeletons */,
//   categories, tags,
//   activeCategoryId, setActiveCategoryId(id|null),   // server-side filter
//   activeTagId, setActiveTagId(id|null),             // mutually exclusive with category
//   hasMore, loadMore(), loadingMore, error }
// Filters and paging run on Wix (a changed filter restarts the list; a late response is dropped).

// usePost({ slug, initialPost?, initialCategories?, initialTags? }) →
// { post: PostDetail|null, notFound /* true = render a 404 state, never invent a post */,
//   categories, tags /* THIS post's, resolved — display .label */, error }

// <RichContent content={post.richContent} fallbackParagraphs={post.paragraphs} />
//   — the ONLY body render path. In Astro: client:only="react".
```

### The island you create — skeleton

The two Astro pages ship; their frontmatter is machinery (SSR fetch → DTO props → island; the
post page's SEO block) and stays as shipped. What you create is the feed island `blog.astro` mounts
(and, in a SPA, the post surface — `PostView.tsx` shows its shape). Hooks first, branches after (an
early return above a hook changes hook order and React throws). Islands render on the server too,
after the 200 is sent — nothing in a render path may throw.

```tsx
// src/components/blog/<YourFeed>.tsx — YOU build it; blog.astro mounts it (swap the import there).
import { useBlogFeed } from "../../hooks/blog/useBlogFeed";
import { postMetaLine } from "../../wix/blog/posts";
import { imgAttrs } from "../../wix/media";
import type { BlogCategory, BlogTag, PostPage } from "../../wix/blog/types";

export default function YourFeed(props: {
  initialPage?: PostPage;              // SSR props from blog.astro — pass straight to useBlogFeed;
  initialCategories?: BlogCategory[];  // omitted in a SPA (client fetch)
  initialTags?: BlogTag[];
}) {
  const feed = useBlogFeed(props);
  const { posts, categories, activeCategoryId, setActiveCategoryId, hasMore, loadMore, loadingMore, error } = feed;
  // …you implement the render:
  //   • a category row when more than one category has posts (categories.filter(c => c.postCount > 0)):
  //     "All" (null) first, the active one marked by activeCategoryId, each calling setActiveCategoryId
  //   • error → a short inline message
  //   • posts === null → skeleton tiles; [] → your honest empty state
  //   • else YOUR grid of YOUR tiles: cover via
  //     <img {...imgAttrs(p.coverUrl, "(min-width: 1024px) 33vw, 100vw", 9 / 16)} alt={p.title} /> — {} when
  //     there is no cover, render your placeholder then; title WRAPS (no truncate); excerpt clamped;
  //     <time dateTime={p.dateISO}>{postMetaLine(p)}</time>; the tile links to `/blog/${p.slug}`
  //   • hasMore → your "load more" control calling loadMore() (disabled while loadingMore)
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/blog/blog-feed-store.ts`, `post-store.ts` — so you never
rewrite them: create a store per surface, `subscribe`, render from `getState()`, call its actions.
Their `*State` interfaces are the render contract; read those. What you write is the rendering —
card, grid, filter row, post header — and for that read these first; they are tested code for
exactly that behaviour:

1. `components/blog/BlogFeedView.tsx` — the filter row (only categories with posts, "All" first,
   one active pill), the skeleton grid while `posts === null`, the empty state, load-more disabled
   while loading; `PostCard` inside it is the tile: 16:9 cover, wrapping title, clamped excerpt,
   the meta line in a `<time>`.
2. `components/blog/PostView.tsx` — the states in order (not found → error → loading → article),
   the categories eyebrow by `.label`, the tag chips, the body slot.
3. `components/blog/RichContent.tsx` — what the body renderer is: the `@wix/ricos` viewer, a React
   component that needs a bundler. On these stacks it doesn't run; the body renders from
   `post.paragraphs` (one `<p>` per entry), and headings, lists, quotes, and inline images flatten
   to text — say so in the closing message. A blog whose posts carry structure stays on Astro.

All under `references/blog/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   other vertical's layout instead if both are deployed).
2. Write your feed island under `src/components/blog/` (a new name — don't overwrite the
   references), swap the island import in `pages/blog.astro`, and restyle the
   `pages/blog/[...slug].astro` template (keep its frontmatter + SEO pieces + the
   `client:only="react"` RichContent island). **Author your surfaces in as few messages as
   possible** — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs blog --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/blog/` —
`posts.ts`, `taxonomy.ts`, `types.ts`, the `*-core.ts` rules, and the two stores
`blog-feed-store.ts`, `post-store.ts`. None of it is React. The hooks and components don't ship on
this stack; the stores replace the hooks, and you write the components in your framework to the
contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createBlogFeedStore(options)` per feed (`start()` when
  mounted, `stop()` when unmounted), `createPostStore({ slug, initialPost? })` per post surface.
  State in, actions out — exactly the hooks' contracts above;
- the body: `@wix/ricos` is a React component — without React it doesn't render; use
  `post.paragraphs` and say so in the closing message.

Routes `/blog`, `/blog/:slug` (null → your 404 view); dev server on 4321; a static build goes
through `npx @wix/cli@latest release` with `site.outputDirectory` pointing at the build folder,
an SSR build is hosted by you. Post-page tags from `post.title` and `post.excerpt`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs blog --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `fetchPosts`, `fetchPostBySlug`,
`postMetaLine` from `./js/wix/posts.js`; `fetchBlogCategories`, `fetchBlogTags`,
`fetchCategoryBySlug`, `fetchTagBySlug` from `./js/wix/taxonomy.js`; `imgAttrs` from
`./js/wix/media.js`. The state machines ship too: `createBlogFeedStore` from
`./js/wix/blog-feed-store.js` (the feed — filters, cursor paging; `start()` once the page is up)
and `createPostStore` from `./js/wix/post-store.js` (the post and its resolved chips). No
components ship — you write the rendering in plain JS: one render function per surface that reads
`getState()`, called from `subscribe`, with the surface's controls calling the store's actions.
Pages are `blog.html` and `post.html?slug=…` (Wix static hosting serves files, not directories —
name the file and link to it). The body renders from `post.paragraphs` (no Ricos viewer without a
bundler — see the reference files note). Set `document.title` and the meta description from
`post.title` and `post.excerpt` once the post loads, as the Astro page does. The visitor token
persists in `localStorage` on its own; never mint per page. `npx @wix/cli@latest release`
uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs blog --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Reads render on the server: port `js/wix/posts.ts`,
`taxonomy.ts` and their `*-core.ts` to your language — the same six functions returning the same
DTO shapes as dicts, one anonymous visitor token per process for these public reads (mint and
refresh per `client.ts`) — and render the feed and the post page in your templates to the
contracts above, so titles and excerpts are in the HTML; post-page tags from `post.title` and
`post.excerpt`. The body is `paragraphs` server-side too (the Ricos viewer is React). Nothing in
this vertical runs on the visitor's behalf, so the browser side is optional: the feed's category
filter and load-more can run client-side on `./js/wix/blog-feed-store.js` exactly as the static
wiring above, or as plain server routes (`/blog?category=<slug>` via `fetchCategoryBySlug`,
paging by cursor). Routes stay `/blog`, `/blog/<slug>`.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator must emit a page for every
post — walk `fetchPosts` by `nextCursor` until it is null, never only the first page. Run
`deploy.mjs blog --stack static --out <build dir>` so `js/wix/` is inside the output the pages
import from, point `site.outputDirectory` at that folder, `wix release`. Pages sit at different
depths (`/`, `/blog/…`): give the templates one base path to `js/wix/` (a template variable, or
root-relative `/js/wix/…`), never a relative `./js/wix/`. The frozen grid is the first paint; the
category filter and load-more still run client-side on it through `createBlogFeedStore()` from
`./js/wix/blog-feed-store.js`. Close with the live URL, the rebuild + release command, and one
line for the owner: posts published in the dashboard reach the site when that command runs.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/blog` → your feed on `useBlogFeed`;
`/blog/:slug` → your post surface on `usePost({ slug })` (the `PostView` reference shows the
shape; `notFound` → your 404 view). Deploy wrote the public client id into `wix/config.ts`;
nothing else to configure.

## Hard rules

- **The body renders only through `RichContent`** where it deploys (Astro, React) — a post body
  is a Ricos document, not HTML and not text: never `set:html`/innerHTML it, never stringify its
  nodes, never write your own node walker. Where it doesn't deploy, `paragraphs` is the honest
  body, and the closing message says so.
- **Data logic only through the shipped exports** — never rewrite their internals or re-derive a
  request shape; extend by adding a function in `wix/blog/` (API contracts: the `wix-docs` skill).
- **Route by `slug` through the shipped functions** — never hand-build a post/category/tag URL
  from ids; display taxonomy by `.label` (the API has no `.name`).
- **`notFound` means not found** — render your 404 state; never invent a post. Only published
  posts come back, so a "missing" post is usually an unseeded/unpublished one.
- **Filter and page at the source** — `useBlogFeed`'s filters and `fetchPosts` run on Wix before
  cursor paging; never filter a loaded page client-side, never raise the page limit instead of
  paging (`hasMore`/`loadMore`).
- **Never hand-build a wixstatic image URL** — `coverUrl` is already resolved; anything else goes
  through `wix/media.ts`.
- Where the shipped components deploy: theme via the `@theme` tokens, your markup in Tailwind
  utilities on the same tokens; no parallel theme files, no hardcoded palettes. Where they don't
  (`lib`, `static`, a port): style with what your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock posts, authors, dates, or read times; no stock
  placeholder covers. No author bylines or comment/like UI — the DTOs don't carry them.
- Keep the post page's SEO pieces and `[...slug]` rest param exactly as shipped.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Give the owner the dashboard link plus the Blog pages — the deploy step's JSON printed
`dashboardUrl`; append `/blog/posts` for writing/editing posts and `/blog/categories` for
the category menu. Only published posts appear on the site.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-blog.mjs` from the project root.
Seed posts that exercise the UI (~3 posts, 2 categories when the brief has sections, varied
content blocks, a cover image per post).
