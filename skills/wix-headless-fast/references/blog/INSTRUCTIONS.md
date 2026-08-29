# Blog — playbook

The blog machinery ships as files — post reads (feed paging, slug lookup with the body
fieldsets), category/tag taxonomy, and the Ricos body renderer, typed end-to-end. **The
presentation is yours**: you design and implement the post card, the grid, the blog index
surface, and the post page surface on the shipped hooks/DTOs, plus the home page and the
brand. You never write blog data logic; you never skip designing. The vertical is
**read-only** — visitors read posts; authoring stays in the dashboard.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/blog/types.ts` | the DTOs (`PostSummary`, `PostDetail`, `BlogCategory`, `BlogTag`, `PostPage`) — contracts below |
| `wix/blog/posts.ts` | `fetchPosts` (paged, filterable), `fetchPostBySlug` (full body) |
| `wix/blog/taxonomy.ts` | `fetchBlogCategories`, `fetchBlogTags`, `fetchCategoryBySlug`, `fetchTagBySlug` |
| `hooks/blog/useBlogFeed.ts` | feed + taxonomy filter + load-more — contract below |
| `hooks/blog/usePost.ts` | post by slug + resolved chips — contract below |
| `components/blog/RichContent.tsx` | the post-body renderer — **wire AS-IS** (machinery, not a reference) |
| `components/blog/BlogFeedView.tsx` (+ `PostCard`) · `PostView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add a Blog nav link there |
| `pages/blog.astro` | SSR feed — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/blog/[...slug].astro` | SSR post page with owner-editable SEO — **keep the frontmatter, the `[...slug]` rest param, and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; restyle the template. The body island stays `client:only="react"` (the ricos viewer breaks under SSR) |

## What you build — the design job

1. **The post card + grid** — your tile (cover, title, excerpt, date · min-read presentation)
   and rhythm, with skeletons while loading and an honest empty state.
2. **The blog index surface** — the feed on `useBlogFeed`: category filter (only when >1
   non-empty category), the grid, and a load-more control gated on `hasMore`.
3. **The post page surface** — header (categories eyebrow, title, date, cover), the body via
   the shipped `RichContent`, and the tag chips — restyle the `[...slug].astro` template
   around it.
4. **The home page** — hero, latest posts (fetch in frontmatter → your components), brand
   story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens. Dark theme: the ricos CSS hardcodes
near-black text — add a global override scoping `.ricos-content` to the foreground token
(in Astro use `<style is:global>`; React islands don't inherit scoped Astro styles).

### The contracts your components consume

```ts
// PostSummary (tiles) — display-ready:
// { id, slug, title, excerpt, dateLabel /* "Aug 26, 2026" | "" */, dateISO,
//   minutesToRead /* 0 = unknown */, featured, pinned, coverUrl /* "" = no cover */,
//   categoryIds, tagIds }
// PostDetail adds: richContent (Ricos JSON | null — render ONLY via RichContent),
//   paragraphs (plain-text fallback body).
// BlogCategory: { id, slug, label, description, postCount, coverUrl }   // display .label
// BlogTag:      { id, slug, label, postCount }

// useBlogFeed({ initialPage?, initialCategories?, initialTags?, pageSize? }) →
// { posts: PostSummary[]|null /* null = loading → skeletons */,
//   categories, tags,
//   activeCategoryId, setActiveCategoryId(id|null),   // server-side filter
//   activeTagId, setActiveTagId(id|null),             // mutually exclusive with category
//   hasMore, loadMore(), loadingMore, error }

// usePost({ slug, initialPost?, initialCategories?, initialTags? }) →
// { post: PostDetail|null, notFound /* true = render a 404 state, never invent a post */,
//   categories, tags /* THIS post's, resolved — display .label */, error }

// <RichContent content={post.richContent} fallbackParagraphs={post.paragraphs} />
//   — the ONLY body render path. In Astro: client:only="react".
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   other vertical's layout instead if both are deployed).
2. Write your components under `src/components/blog/` (new names — don't overwrite the
   references), swap the island import in `pages/blog.astro`, and restyle the
   `pages/blog/[...slug].astro` template (keep its frontmatter + SEO pieces + the
   `client:only="react"` RichContent island). **Author your surfaces in as few messages as
   possible** — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/blog` → your feed on `useBlogFeed`;
`/blog/:slug` → your post surface on `usePost` (the `PostView` reference shows the shape).

## Hard rules

- **The body renders only through `RichContent`** — a post body is a Ricos document, not
  HTML and not text: never `set:html`/innerHTML it, never stringify its nodes, never write
  your own node walker. `paragraphs` is the honest fallback it already handles.
- **Route by `slug` through the shipped functions** — never hand-build a post/category/tag
  URL from ids; display taxonomy by `.label` (the API has no `.name`).
- **`notFound` means not found** — render your 404 state; never invent a post. Only
  published posts come back, so a "missing" post is usually an unseeded/unpublished one.
- **Never hand-build a wixstatic image URL** — `coverUrl` is already resolved; anything else
  goes through `wix/media.ts`.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.
- Live data or an honest empty state — never mock posts, authors, dates, or read times; no
  stock placeholder covers. No author bylines or comment/like UI — the DTOs don't carry
  them; don't fabricate engagement.
- The vertical is read-only because every draft-post write is APP-scoped — authoring stays in
  the dashboard. A brief that asks for comments or likes is covered by
  `wix-headless/references/inline-recipes/how-to-code-a-blog.md`.
- Keep the post page's SEO pieces and `[...slug]` rest param exactly as shipped.

## Point the user to their dashboard

Give the owner the dashboard link plus the Blog pages — the deploy step's JSON printed
`dashboardUrl`; append `/blog/posts` for writing/editing posts and `/blog/categories` for
the category menu. Only published posts appear on the site.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-blog.mjs` from the project root.
Seed posts that exercise the UI (~3 posts, 2 categories when the brief has sections, varied
content blocks, a cover image per post).

## Verify (before declaring done)

- [ ] `/blog` renders live posts SSR (view-source shows titles) through YOUR components;
      empty blog shows your honest empty state.
- [ ] A post page renders the full body via `RichContent` (headings/quotes/lists show, not
      raw text), with your header design; a bad slug returns 404/not-found.
- [ ] Category filter narrows the feed (server-side — check the network tab, not a hidden
      client filter); load-more appends the next page.
- [ ] Post page view-source carries the SEO tags (Astro).
- [ ] Card/grid/index/post surfaces/home are YOUR designs on the tokens; data-layer/hook
      files unedited; `RichContent` wired as-is.
- [ ] Dashboard links handed to the owner.
