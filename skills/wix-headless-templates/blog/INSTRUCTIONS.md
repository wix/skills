# Blog — playbook

The blog machinery ships as files — post reads (feed paging with pinned-first order, slug lookup
with the body/SEO fieldsets, related posts, counters), author bylines, category/tag taxonomy, likes,
comments, the feed/post/comments state machines, and the Ricos body renderer, typed end-to-end.
**The presentation doesn't ship — you build it** on the shipped hooks/DTOs: the post card, the grid,
the blog index surface, the category and tag surfaces, the post page surface, the home page, and the
brand. You never write blog data logic; you never skip designing. Authoring stays in the dashboard;
visitors read, like, and comment.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the shipped
pages' templates. Files you **create**: your feed island (skeleton below), your post surface, and
your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes, ratio)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(post.coverUrl, "(min-width: 1024px) 33vw, 100vw", 9 / 16)} alt={post.coverAlt} />`; `imgSrc()` / `imgSrcSet()` underneath |
| `wix/blog/types.ts` | the DTOs (`PostSummary`, `PostDetail`, `BlogAuthor`, `PostMetrics`, `BlogCategory`, `BlogTag`, `PostPage`, `BlogComment`, `CommentPage`) — contracts inlined below |
| `wix/blog/posts.ts` | `fetchPosts` (cursor-paged, pinned first, category/tag filtered on Wix, authors joined), `fetchPostBySlug` (full body + SEO + comments fields), `fetchRelatedPosts`, `fetchPostsByIds`, `fetchPostMetrics`; the helpers `postMetaLine`, `relativeDateLabel`, `formatCount`, `postPath`, `categoryPath`, `tagPath` — the transport; the rules and DTO mappers are in `posts-core.ts` beside it (shared with the REST layer) |
| `wix/blog/taxonomy.ts` | `fetchBlogCategories({ withPosts? })`, `fetchBlogTags`, `fetchTagsByIds`, `fetchCategoryBySlug`, `fetchTagBySlug`, `inIdOrder` — the transport; mappers in `taxonomy-core.ts` |
| `wix/blog/authors.ts` | `fetchAuthorsByIds` (one batched Members read per page), `fetchCurrentMemberId` — over the SDK's authenticated fetch; mappers in `authors-core.ts` |
| `wix/blog/post-likes.ts` | `likePost`, `unlikePost`, `fetchLikeState` — the viewer's like, client-only |
| `wix/blog/comments.ts` | `fetchComments`, `fetchReplies`, `createComment`, `deleteComment` — the post's thread as the viewer; rules in `comments-core.ts` |
| `wix/blog/blog-feed-store.ts` · `post-store.ts` · `comments-store.ts` | the feed, post, and comments state machines, framework-free (`createBlogFeedStore()`, `createPostStore()`, `createCommentsStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/blog/useBlogFeed.ts` | React binding of `blog-feed-store.ts`: feed + taxonomy filter + load-more — contract below |
| `hooks/blog/usePost.ts` | React binding of `post-store.ts`: post by slug + resolved chips + related + like state — contract below |
| `hooks/blog/useComments.ts` | React binding of `comments-store.ts`: the thread, replies, create/delete — contract below |
| `components/blog/RichContent.tsx` | the post-body (and comment-body) renderer — **wire as-is** (machinery, not a reference) |
| `components/blog/BlogFeedView.tsx` (+ `PostCard`, `PostByline`) · `PostView.tsx` · `PostLikeButton.tsx` (+ `EngagementRow`) · `CommentsView.tsx` | **reference implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). `title`/`description` are optional: an item page whose `<SEO.Tags>` resolved passes neither (one source of head tags). If another vertical is also deployed, its layout won — add a Blog nav link there |
| `pages/blog.astro` | SSR feed — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/blog/[...slug].astro` | SSR post page with owner-editable SEO — **keep the frontmatter, the `[...slug]` rest param, and the SEO pieces** (`wixMetadata`, `loadSEOTagsServiceConfig`, `<SEO.Tags>`) exactly; restyle the template. Chips in the post's order, tags read by id, related strip, the like row and the comments as `client:load` islands, the body island `client:only="react"` (the ricos viewer breaks under SSR). A slug that resolves to nothing returns a real 404 |
| `pages/blog/category/[slug].astro` | SSR category page (header: cover, label, description; the feed seeded with the category filter) with owner-editable SEO (`wixMetadata` on `categoryPageMetadata`, `BLOG_CATEGORY`) — same rules as the post page. Unknown slug → 404 |
| `pages/blog/tag/[slug].astro` | SSR tag page (header: label; the feed seeded with the tag filter). No SEO item type exists for tags — the layout's title is the label. Unknown slug → 404 |

## Routes

| path | page | notes |
|---|---|---|
| `/blog` | the feed | pinned first, newest first; category pills link to the category pages |
| `/blog/<slug>` | a post | `postPath(slug)` — a slug may contain `/`; the helper encodes per segment, the `[...slug]` param re-joins |
| `/blog/category/<slug>` | a category | `categoryPath(slug)`; 404 when the slug matches no category (Wix's own router answers 200 + empty feed; a headless page that exists for no category is a 404) |
| `/blog/tag/<slug>` | a tag | `tagPath(slug)`; 404 likewise; not in the sitemap (Wix lists no tag pages either) |

Never hand-build these — the three path helpers are the only source; `post.url` (the legacy blog's
page) is never used.

## What you build — the design job

1. **The post card + grid** — your tile (cover, title, excerpt, `postMetaLine(post)`, the byline and
   counters when the DTO carries them) and rhythm, with skeletons while `posts === null`, an honest
   empty state for `[]` when `error` is null, and a visibly different error state when it is not.
2. **The blog index surface** — the feed island on `useBlogFeed`: category row (only when >1
   non-empty category; pills as links to the category pages, or client-side filters), the grid, and a
   load-more control gated on `hasMore`.
3. **The category and tag surfaces** — the same island seeded with the filtered page, under a header
   (category: cover, label, description; tag: label) — restyle the two shipped page templates.
4. **The post page surface** — header (categories eyebrow, title, byline + meta line, cover), the body
   via the shipped `RichContent`, the engagement row (counters, like), the tag chips, the related strip,
   and the comments thread — restyle the `[...slug].astro` template around it.
5. **The home page** — hero, latest posts (fetch in frontmatter → your components), brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).
Style everything with Tailwind utilities on the tokens. Dark theme: the ricos CSS hardcodes
near-black text — add a global override scoping `.ricos-content` to the foreground token
(in Astro use `<style is:global>`; React islands don't inherit scoped Astro styles).

### What a complete blog shows (recommended defaults)

Defaults for a blog whose brief says nothing about them; the prompt wins where it differs. Look at
the seeded content before designing (how many posts, categories, covers, body structure) and design
for this blog, not for a stereotype of one.

- **Home:** what the blog is about and the latest posts (real ones, under a truthful heading) in the
  first screen; a category link goes to `categoryPath(slug)`, never to an anchor.
- **Index:** a real card — cover, title, meta line, byline — in the first screen at 390px too; the
  category row only when more than one category has posts; loading, empty, and error states that look
  different (the empty message only when `error` is null); load-more, never a raised page size.
- **Post page:** eyebrow, title, byline + meta line, cover as a bounded band on phones
  (`max-h-[45vh]`), the body, the engagement row, the tags, the related strip, the comments; a slug
  that resolves to nothing shows only the not-found state.
- **Copy:** render only what the DTO carries — a byline only with `authorName`, a counter only when
  its number is defined, a comments section only when `commentingEnabled && referenceId`; no invented
  authors, counts, or "trending" labels; no Wix IDs or technical words in visible text. A count that
  is unknown renders nothing, never "0".

### The contracts your components consume

Tested and working as they are; read the source when something is off or the brief wants more.

```ts
// PostSummary (tiles) — display-ready:
// { id, slug, title, excerpt, dateLabel /* "Aug 26, 2026" | "" */, dateISO,
//   minutesToRead /* 0 = unknown */, featured, pinned,
//   coverUrl /* "" = no cover (or the author hid it); a video cover → its poster, an embed → its thumbnail */,
//   coverAlt /* the author's alt text, else the title; "" with no cover */,
//   categoryIds, tagIds,
//   authorId, authorName /* "" = unresolved → no byline */, authorAvatarUrl /* "" = none */,
//   viewCount?, likeCount?, commentCount? /* undefined = unknown → render nothing */ }
// postMetaLine(post) → "Aug 26, 2026 · 4 min read" (either half alone; "" when neither is known) —
//   render it inside <time dateTime={post.dateISO}>; don't hand-assemble the separator.
// relativeDateLabel(post.dateISO, now?) → "3 days ago" under a week, "Aug 5" this year, "Aug 5, 2024"
//   otherwise — pass the SAME `now` on the server and the client (put it in the island's props).
// formatCount(n) → "1.2K" (formatCount(n, "full") → "1,234"); "" for undefined.
// postPath(slug) · categoryPath(slug) · tagPath(slug) → the only hrefs (slugs may contain "/").
// PostDetail adds: richContent (Ricos JSON | null — render ONLY via RichContent),
//   paragraphs (plain-text fallback body), updatedLabel/updatedISO ("" unless republished),
//   seoTitle /* owner's override, else title */, seoDescription /* override → excerpt → body, 500 chars */,
//   relatedPostIds, commentingEnabled, referenceId /* the comments thread; "" = none */.
// BlogAuthor:   { id, name, avatarUrl }
// PostMetrics:  { views?, likes?, comments? }
// BlogCategory: { id, slug, label, title /* SEO title, "" when unset */, description, postCount, coverUrl }   // display .label
// BlogTag:      { id, slug, label, postCount /* published posts */ }
// BlogComment:  { id, topLevelId /* null = top-level */, parentId, parentAuthorName /* "replying to" */,
//   authorId, authorName, authorAvatarUrl, isOwn /* the current member's → show delete */,
//   dateLabel, dateISO, status /* PUBLISHED | PENDING (awaiting approval) | DELETED (placeholder) | HIDDEN */,
//   content /* Ricos JSON | null → RichContent */, text /* plain text, for stacks without the viewer */, replyCount }

// useBlogFeed({ initialPage?, initialCategoryId?, initialTagId?, initialCategories?, initialTags?, pageSize? /* 20 */ }) →
// { posts: PostSummary[]|null /* null = loading → skeletons */,
//   categories, tags,
//   activeCategoryId, setActiveCategoryId(id|null),   // server-side filter
//   activeTagId, setActiveTagId(id|null),             // mutually exclusive with category
//   hasMore, loadMore(), loadingMore,
//   error /* set → posts may be [] and that is NOT an empty blog: render the error, not the empty state */ }
// Filters and paging run on Wix (a changed filter restarts the list; a late response is dropped).
// A category/tag page seeds a FILTERED first page: pass initialCategoryId/initialTagId with initialPage.

// usePost({ slug, initialPost?, initialCategories?, initialTags?, initialRelated?, engagement? /* true */ }) →
// { post: PostDetail|null, notFound /* true = render a 404 state, never invent a post */,
//   categories, tags /* THIS post's, in ITS order, resolved — display .label */,
//   related: PostSummary[]|null /* curated, else same-category recents; max 3 */,
//   isLiked, likeCount /* fresh count + this viewer's change; undefined = unknown */, likeCountLoaded,
//   viewCount, commentCount, liking, toggleLike() /* optimistic, rolls back */, error }
// The like state is personal and read in the browser only; on the server it stays false/unloaded.

// useComments({ referenceId, pageSize? /* 10 */, sort? /* "NEWEST_FIRST" */ }) →
// { comments: BlogComment[]|null /* top-level; null = loading */,
//   replies: { [topLevelId]: { comments, nextCursor, loading } } /* replies load on demand */,
//   hasMore, loadMore(), loadingMore, loadReplies(topLevelId),
//   sort, setSort("NEWEST_FIRST" | "OLDEST_FIRST"),
//   create(text, { parentId?, topLevelId? }) → BlogComment|null, remove(id),
//   saving, needsSignIn /* the server refused this identity → "sign in to comment" */,
//   currentMemberId, error }
// Mount only when post.commentingEnabled && post.referenceId. Replies to replies keep parentId
// (render "replying to parentAuthorName") but sit in their top-level comment's thread (two levels).

// <RichContent content={post.richContent} fallbackParagraphs={post.paragraphs} />
//   — the ONLY post-body render path; comments render their plain `text` (no viewer: their island is SSR'd). In Astro: client:only="react".
```

### The island you create — skeleton

The Astro pages ship; their frontmatter is machinery (SSR fetch → DTO props → island; the item
pages' SEO blocks) and stays as shipped. What you create is the feed island `blog.astro` and the
category/tag pages mount (and, in a SPA, the post surface — `PostView.tsx` shows its shape). Hooks
first, branches after (an early return above a hook changes hook order and React throws). Islands
render on the server too, after the 200 is sent — nothing in a render path may throw.

```tsx
// src/components/blog/<YourFeed>.tsx — YOU build it; blog.astro and the category/tag pages mount it.
import { useBlogFeed } from "../../hooks/blog/useBlogFeed";
import { categoryPath, formatCount, postMetaLine, postPath } from "../../wix/blog/posts";
import { imgAttrs } from "../../wix/media";
import type { BlogCategory, BlogTag, PostPage } from "../../wix/blog/types";

export default function YourFeed(props: {
  initialPage?: PostPage;              // SSR props — pass straight to useBlogFeed; omitted in a SPA
  initialCategoryId?: string | null;   // the filter initialPage was fetched with (category page)
  initialTagId?: string | null;        // (tag page)
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
}) {
  const feed = useBlogFeed(props);
  const { posts, categories, activeCategoryId, hasMore, loadMore, loadingMore, error } = feed;
  // …you implement the render:
  //   • a category row when more than one category has posts (categories.filter(c => c.postCount > 0)):
  //     "All" (href "/blog") first, then <a href={categoryPath(c.slug)}> per category, the active one
  //     marked by activeCategoryId (or buttons calling setActiveCategoryId for client-side filtering)
  //   • error → a short inline message; the empty state ONLY when !error
  //   • posts === null → skeleton tiles; [] → your honest empty state
  //   • else YOUR grid of YOUR tiles: cover via
  //     <img {...imgAttrs(p.coverUrl, "(min-width: 1024px) 33vw, 100vw", 9 / 16)} alt={p.coverAlt} /> — {} when
  //     there is no cover, render your placeholder then; title WRAPS (no truncate); excerpt clamped;
  //     <time dateTime={p.dateISO}>{postMetaLine(p)}</time>; byline only when p.authorName; counters only
  //     when defined (`${formatCount(p.viewCount)} views`); the tile links to postPath(p.slug)
  //   • hasMore → your "load more" control calling loadMore() (disabled while loadingMore)
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/blog/blog-feed-store.ts`, `post-store.ts`,
`comments-store.ts` — so you never rewrite them: create a store per surface, `subscribe`, render
from `getState()`, call its actions. Their `*State` interfaces are the render contract; read those.
What you write is the rendering — card, grid, filter row, post header, comment list — and for that
read these first; they are tested code for exactly that behaviour:

1. `components/blog/BlogFeedView.tsx` — the filter row (only categories with posts, "All" first,
   one active pill, pills as links or buttons), the skeleton grid while `posts === null`, the empty
   state only without an error, load-more disabled while loading; `PostCard` inside it is the tile:
   16:9 cover with the DTO's alt, wrapping title, clamped excerpt, the meta line in a `<time>`, the
   byline/counters only when present.
2. `components/blog/PostView.tsx` — the states in order (not found → error → loading → article),
   the categories eyebrow by `.label` in the post's order, the byline, the engagement row, the tag
   chips, the related strip, the comments gate.
3. `components/blog/PostLikeButton.tsx` — the like control: `aria-pressed`, disabled while `liking`,
   a skeleton for the count until `likeCountLoaded`, counters only when defined.
4. `components/blog/CommentsView.tsx` — the thread: two levels, "replying to", PENDING badge,
   DELETED placeholder, delete on `isOwn`, "Show N replies" on the seam, the sign-in prompt on
   `needsSignIn`, the form disabled while `saving`.
5. `components/blog/RichContent.tsx` — what the body renderer is: the `@wix/ricos` viewer, a React
   component that needs a bundler. On these stacks it doesn't run; the body renders from
   `post.paragraphs` (one `<p>` per entry) and a comment from `comment.text`, and headings, lists,
   quotes, and inline images flatten to text — say so in the closing message. A blog whose posts
   carry structure stays on Astro.

All under `templates/blog/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   other vertical's layout instead if both are deployed).
2. Write your feed island under `src/components/blog/` (a new name — don't overwrite the
   references), swap the island import in `pages/blog.astro`, `pages/blog/category/[slug].astro`,
   and `pages/blog/tag/[slug].astro`, and restyle the `pages/blog/[...slug].astro` template (keep its
   frontmatter + SEO pieces + the `client:only="react"` RichContent island; the like row and
   comments stay `client:load` islands — they read as the viewer). **Author your surfaces in as few
   messages as possible** — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs blog --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/blog/` —
`posts.ts`, `taxonomy.ts`, `authors.ts`, `post-likes.ts`, `comments.ts`, `types.ts`, the `*-core.ts`
rules, and the three stores `blog-feed-store.ts`, `post-store.ts`, `comments-store.ts`. None of it is
React. The hooks and components don't ship on this stack; the stores replace the hooks, and you write
the components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createBlogFeedStore(options)` per feed (`start()` when
  mounted, `stop()` when unmounted), `createPostStore({ slug, initialPost? })` per post surface,
  `createCommentsStore({ referenceId })` per thread (only when `commentingEnabled && referenceId`).
  State in, actions out — exactly the hooks' contracts above;
- the body: `@wix/ricos` is a React component — without React it doesn't render; use
  `post.paragraphs` (and `comment.text`) and say so in the closing message.

Routes `/blog`, `/blog/:slug` (null → your 404 view), `/blog/category/:slug`, `/blog/tag/:slug`
(`fetchCategoryBySlug`/`fetchTagBySlug` → `createBlogFeedStore({ initialCategoryId })` or a plain
`setActiveCategoryId`); dev server on 4321; a static build goes through `npx @wix/cli@latest release`
with `site.outputDirectory` pointing at the build folder, an SSR build is hosted by you. Post-page
tags from `post.seoTitle` and `post.seoDescription`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs blog --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `fetchPosts`, `fetchPostBySlug`,
`fetchRelatedPosts`, `postMetaLine`, `postPath`, `categoryPath`, `tagPath`, `formatCount` from
`./js/wix/posts.js`; `fetchBlogCategories`, `fetchBlogTags`, `fetchTagsByIds`, `fetchCategoryBySlug`,
`fetchTagBySlug` from `./js/wix/taxonomy.js`; `likePost`/`unlikePost`/`fetchLikeState` from
`./js/wix/post-likes.js`; the comments from `./js/wix/comments.js`; `imgAttrs` from
`./js/wix/media.js`. The state machines ship too: `createBlogFeedStore` from
`./js/wix/blog-feed-store.js` (the feed — filters, cursor paging; `start()` once the page is up),
`createPostStore` from `./js/wix/post-store.js` (the post, its resolved chips, related, the like
toggle), and `createCommentsStore` from `./js/wix/comments-store.js`. No components ship — you write
the rendering in plain JS: one render function per surface that reads `getState()`, called from
`subscribe`, with the surface's controls calling the store's actions. Pages are `blog.html`,
`post.html?slug=…`, `category.html?slug=…`, `tag.html?slug=…` (Wix static hosting serves files, not
directories — name the file and link to it; on this stack pass your own `postHref`-style helpers to
your renderers, the path helpers describe the Astro routes). The body renders from
`post.paragraphs` and a comment from `comment.text` (no Ricos viewer without a bundler — see the
reference files note). Set `document.title` and the meta description from `post.seoTitle` and
`post.seoDescription` once the post loads, as the Astro page does. The visitor token persists in
`localStorage` on its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs blog --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Reads render on the server: port `js/wix/posts.ts`,
`taxonomy.ts`, `authors.ts` and their `*-core.ts` to your language — the same functions returning
the same DTO shapes as dicts, one anonymous visitor token per process for these public reads (mint
and refresh per `client.ts`) — and render the feed, the category/tag pages, and the post page in your
templates to the contracts above, so titles and excerpts are in the HTML; post-page tags from
`post.seoTitle` and `post.seoDescription`. The body is `paragraphs` server-side too (the Ricos
viewer is React). Likes and comments run on the visitor's behalf — they are browser-side only, on
`./js/wix/post-store.js` and `./js/wix/comments-store.js` exactly as the static wiring above (never
through the process-wide token: a like or a comment would be attributed to it). The feed's category
filter and load-more can run client-side on `./js/wix/blog-feed-store.js` the same way, or as plain
server routes (`/blog/category/<slug>` via `fetchCategoryBySlug`, paging by cursor). Routes stay
`/blog`, `/blog/<slug>`, `/blog/category/<slug>`, `/blog/tag/<slug>`.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator must emit a page for every
post and every category — walk `fetchPosts` by `nextCursor` until it is null, never only the first
page. Run `deploy.mjs blog --stack static --out <build dir>` so `js/wix/` is inside the output the
pages import from, point `site.outputDirectory` at that folder, `wix release`. Pages sit at
different depths (`/`, `/blog/…`): give the templates one base path to `js/wix/` (a template
variable, or root-relative `/js/wix/…`), never a relative `./js/wix/`. The frozen grid is the first
paint; the category filter, load-more, likes, and comments still run client-side on the stores
from `./js/wix/`. Close with the live URL, the rebuild + release command, and one line for the owner:
posts published in the dashboard reach the site when that command runs.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/blog` → your feed on `useBlogFeed`;
`/blog/category/:slug` and `/blog/tag/:slug` → the same feed with `initialCategoryId`/`initialTagId`
(resolve the slug with `fetchCategoryBySlug`/`fetchTagBySlug`); `/blog/:slug` → your post surface on
`usePost({ slug })` (the `PostView` reference shows the shape; `notFound` → your 404 view). Deploy
wrote the public client id into `wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Likes, views, comments — what the shipped layer can and cannot do

- **Likes** run as the current identity (a member, or the anonymous visitor the token stands for):
  optimistic toggle, rolled back on failure, in the browser only. The count shown is the fresh
  metrics read (else the card's) plus this viewer's change.
- **View counting is not shipped**: `@wix/blog` in this template (1.0.645) has no `viewPost`; the
  installed SDK has to expose it before a page can count a view. Views still display from METRICS.
- **Comments** address the thread by `referenceId` as both contextId and resourceId, with the Blog
  app id — the public-SDK shape Wix's own headless blog uses. Verified live: the REFERENCE_ID
  fieldset returns the post without that field, the INTERNAL_ID fieldset carries it, and it equalled
  the post id on every post read — so the detail read asks for both and `posts-core.ts` falls back
  to the post id (what Wix's classic Blog widget addresses the thread by). A post page that shows no
  comments section therefore means `commentingEnabled` is off, not a missing id.
- Who may comment (members only, or guests too) is the dashboard's "Who can comment" setting,
  decided by the server: submit as the current session; a refusal sets `needsSignIn`. Comments may
  come back PENDING when the owner moderates — show "awaiting approval", never drop them.
- The site-wide comments master switch (Blog settings) has no public read: a post says
  `commentingEnabled` even when the owner turned comments off for the whole blog. Say so in the
  closing message when you ship comments.
- Members and comments go over the SDK's authenticated fetch (`wixFetch`) with literal REST paths —
  the template does not depend on `@wix/members` or `@wix/comments`; the REST twins use the same paths.

## Hard rules

- **The body renders only through `RichContent`** where it deploys (Astro, React) — a post body
  is a Ricos document, not HTML and not text: never `set:html`/innerHTML it, never stringify its
  nodes, never write your own node walker. Where it doesn't deploy, `paragraphs` is the honest
  body, and the closing message says so.
- **Data logic only through the shipped exports** — never rewrite their internals or re-derive a
  request shape; extend by adding a function in `wix/blog/` (API contracts: the `wix-docs` skill).
- **Route by `slug` through the shipped path helpers** — `postPath`, `categoryPath`, `tagPath`;
  never hand-build a post/category/tag URL from ids or from `post.url`; display taxonomy by `.label`
  (the API has no `.name`).
- **`notFound` means not found** — render your 404 state; never invent a post. Only published
  posts come back, so a "missing" post is usually an unseeded/unpublished one.
- **Filter and page at the source** — `useBlogFeed`'s filters and `fetchPosts` run on Wix before
  cursor paging; never filter a loaded page client-side, never raise the page limit instead of
  paging (`hasMore`/`loadMore`).
- **Never hand-build a wixstatic image URL** — `coverUrl` and `authorAvatarUrl` are already
  resolved; anything else goes through `wix/media.ts`.
- **Error is not empty** — render the empty state only when `error` is null; a failed read shows the
  error state.
- Where the shipped components deploy: theme via the `@theme` tokens, your markup in Tailwind
  utilities on the same tokens; no parallel theme files, no hardcoded palettes. Where they don't
  (`lib`, `static`, a port): style with what your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock posts, authors, dates, counts, or read times; no
  stock placeholder covers. **Render only what the DTO carries**: a byline needs `authorName`, a
  counter needs a defined number, a like control needs the post, a comments section needs
  `commentingEnabled && referenceId`.
- Keep the post and category pages' SEO pieces and the `[...slug]` rest param exactly as shipped;
  an item page whose `<SEO.Tags>` resolved passes no title/description to the layout.
- Likes and comments are the viewer's — client-side only, never during SSR or through a shared
  server token.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`).

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Posts (published and drafts) | `blog/posts` |
| Categories | `blog/categories` |
| Tags | `blog/tags` |
| Writers | `blog/writers` |
| Comments | `blog/comments` |
| Blog settings | `blog/settings` |

Only published posts appear on the site. Pinned posts lead the feed; a post's related posts, cover
visibility, alt text, SEO title/description, and per-post comments switch are set on the post.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-blog.mjs` from the project root.
Seed posts that exercise the UI (~3 posts, 2 categories when the brief has sections, varied
content blocks, a cover image per post). Authors resolve to the site owner's member profile — set a
nickname and photo in the dashboard for a real byline.
