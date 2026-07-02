
# Wix Blog Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and this vertical's `references/blog/wix-blog.js`. Copy **both** into your app's `src/rest/` side by side — the helper does `import { wixApiRequest } from "./wix-client.js"`, so they must land in the same folder.

Builds a real, client-only Wix blog reader. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock posts; never hand-build post/category/tag URLs — always
fetch live data through the official Blog REST endpoints and route by `slug`.

## When to use
- User wants a Wix blog/news/articles section or asks to "connect my Wix blog".
- Replacing placeholder/mock articles with live Wix Blog posts.
- Adding a post feed, post detail pages, category pages, or tag pages over an existing
  Wix Blog with published posts.

This skill is **read-only and visitor-facing**. It does not create, edit, publish, or
moderate posts — the author manages all content in the Wix dashboard.

## Prerequisites
1. A Wix site with **Wix Blog installed and posts already published** (this skill does
   NOT provision — it's read-only over published content). Draft/unpublished posts are
   never returned.
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the
   Wix Business Manager surfaces a copyable prompt with the id filled in — see
   the router `SKILL.md`). Paste it into `src/rest/wix-client.js` in place of the placeholder. It is
   a visitor-facing credential (it only mints anonymous visitor tokens), **not** a secret,
   so hardcoding/committing it is fine.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the blog's UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and
only adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to
  the id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The refresh token is
  persisted to localStorage so the same anonymous visitor is reused across reloads; do not
  re-mint anonymously per load.
- `src/rest/wix-blog.js` — exports:
  - **Posts:** `queryPosts`, `getPostBySlug`, `queryPostsByCategory`, `queryPostsByTag`, `getTotalPosts`
  - **Categories:** `queryCategories`, `getCategoryBySlug`
  - **Tags:** `queryTags`, `getTagBySlug`

The Post, Category, and Tag shapes are documented as JSDoc comments at the top of
`wix-blog.js`. Read them before building the UI — they describe the key fields and link to
the full API reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Post feed** — `queryPosts()` for the listing (published posts only, newest first with
  pinned posts leading); pass `nextCursor` back as `cursor` to load the next page. Render
  `title`, `excerpt`, `firstPublishedDate`, `minutesToRead`, and the cover image from
  **`heroImage.url`** (see the cover-image note below). Route to the detail page by `slug`.
- **Post detail** — `getPostBySlug(slug)` keyed off the URL slug; returns `null` on miss —
  show a not-found state, never invent a post. It returns full content:
  - `contentText` — the body as plain text. Split on `"\n"` to render simple paragraphs.
  - `richContent` — the body as a Ricos rich-content document (images, embeds, formatting).
    Render it with a Ricos renderer for a faithful post. See "Beyond the snippets" if you
    need rich rendering; `contentText` is the zero-dependency default.
  - Resolve `categoryIds` / `tagIds` to labels with `queryCategories()` / `queryTags()`
    (build an id→label map) to show category/tag chips.
- **Cover image** — use **`post.heroImage.url`** (a ready-to-use https URL) for the card
  thumbnail and post header. The `post.media` field is metadata only
  (`{ displayed, custom, altText }`) and carries **no URL**. When `heroImage` is absent and
  `media.custom === false`, the cover is the first image inside `richContent` — fall back to
  the first IMAGE node there, or show a text-only card. Never substitute a stock/placeholder image.
- **Category page** — `queryCategories()` for a category menu (ordered by `displayPosition`;
  hide categories with `postCount === 0` if you want); `getCategoryBySlug(slug)` for a
  category landing page. Pass `category.id` to `queryPostsByCategory(categoryId, { limit?, cursor? })`
  to list that category's posts; paginate exactly like `queryPosts`.
- **Tag page** — `queryTags()` for a tag cloud/list (most-used first); `getTagBySlug(slug)`
  for a tag landing page. Pass `tag.id` to `queryPostsByTag(tagId, { limit?, cursor? })`.
- **Empty state** — if `getTotalPosts()` is 0, show an empty state telling the user to
  publish posts in their Wix dashboard. Never invent posts.

## Hard rules (do not violate)
- ✅ Fetch posts/categories/tags ONLY through the shipped helpers (the official Blog REST
  endpoints). Route between screens by `slug`.
- ❌ Never hand-build post, category, or tag URLs to fetch content. Use `getPostBySlug`,
  `getCategoryBySlug`, `getTagBySlug`. (For an outbound link to the live Wix page, use the
  `url` field — `url.base + url.path` — returned on the object, not a string you assemble.)
- ❌ Never mock posts, authors, or content — render live Wix data or the empty state.
- ❌ Never generate fake comments, likes, view counts, or ratings. This skill is read-only
  and does not expose engagement actions; leave such UI empty or omit it.
- ❌ Never use a placeholder/stock cover image. If `heroImage` is missing, fall back to the
  first richContent image or a text-only card.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Use `heroImage.url` for the cover image; `media` is metadata only (no URL).
- The helpers fail soft on single-item lookups: `getPostBySlug` / `getCategoryBySlug` /
  `getTagBySlug` return `null` on a miss so you can show a proper not-found state — don't
  swallow that into a fake item.

## Beyond the snippets
The snippets cover the common blog-reader paths. If you hit a use case they don't cover
(e.g. rendering `richContent` faithfully, full-text search/filtering, related posts,
post metrics, members-only/pricing-plan posts, multilingual posts), extend the client
yourself with `wixApiRequest` — but look up the exact endpoint, HTTP method, and request
body in the **official Wix API reference** first; never guess:
- Blog API reference: https://dev.wix.com/docs/api-reference/business-solutions/blog.md
- Query Posts (filters/sort: `categoryIds`, `tagIds`, `hashtags`, `title`, dates, `featured`):
  https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts.md
- Rendering `richContent` (Ricos document format):
  https://dev.wix.com/docs/ricos/api-reference/ricos-document
- Each helper in `wix-blog.js` links its exact reference page inline.

Keep the snippets as the default for everything they already do; reach for the API
reference only for the gap.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (no re-mint storm; same anonymous visitor)
- [ ] Post feed lists live published posts, newest first, and paginates via `nextCursor`
- [ ] Post detail loads by `slug` and renders real `contentText` (or rendered `richContent`)
- [ ] `getPostBySlug` on a bad slug shows a not-found state (no invented post)
- [ ] Cover images come from `heroImage.url` (or richContent fallback) — no stock placeholders
- [ ] Category and tag pages list the right posts via `queryPostsByCategory` / `queryPostsByTag`
- [ ] Empty state shown when `getTotalPosts()` is 0
- [ ] No mock posts, authors, comments, likes, or view counts anywhere
