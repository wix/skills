---
name: "How to Code a Blog"
description: The frontend read contract for a Blog V3 site — which @wix/blog modules to import, how to list/get posts with the mandatory RICH_CONTENT fieldset, how to resolve categories/tags/cover media, how to render Ricos rich content, and the read-public/write-authenticated comments flow. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which posts to render come from the blog the site reads.
---
**RECIPE**: How to Code a Wix Blog Frontend (Blog V3 + Ricos rich content)

A concise contract for writing the **frontend code** of a blog against a Blog V3 site: listing posts, opening a post by slug, rendering its rich content, resolving categories/tags/cover images, and (optionally) reading and submitting comments. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which posts to show, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the blog, not for seeding it.** It assumes a Blog V3 site already exists (published posts, optional categories/tags). It says nothing about creating posts — only how to read and render them from frontend code.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the most common source of `undefined`-id bugs (links to `/blog/undefined`). Fetch the `.md?apiView=SDK` form directly; if a field name surprises you, you're probably reading the REST view.

---

## The modules and the client (read this first)

**Wix Blog app id** (a constant Astro needs for blog-post page routing, and comments need as `appId`):
`14bcded7-0066-7c35-14d7-466cb3f09103`

**⚠️ CRITICAL: blog posts are NOT CMS collections — use `@wix/blog`, never `@wix/data`.** Querying blog content through `@wix/data` reads the wrong store and returns nothing. Import only:

| Need | Package | Module |
|---|---|---|
| Posts (list, get, query by slug) | `@wix/blog` | `posts` |
| Categories (resolve `categoryIds`) | `@wix/blog` | `categories` |
| Tags (resolve `tagIds`) | `@wix/blog` | `tags` |
| Render rich content | `@wix/ricos` | `RicosViewer` + `quickStartViewerPlugins` |
| Resolve `wix:image://` cover URIs | `@wix/sdk` | `media` |
| Likes — like/unlike a post (only if the site has members) | `@wix/blog` | `likes` |
| Comments — read/submit (only if the blog has comments) | `@wix/comments` | `comments` |
| Comment/like author name/photo (only with members) | `@wix/members` | `members` |

Discover the exact current call shapes with `SearchWixSDKDocumentation` (e.g. `"blog query posts"`, `"comments queryComments createComment"`) rather than walking a module menu — the menu pages often surface only dashboard/extension pages, not the runtime query functions. The `@wix/ricos` viewer API moves between versions — **follow the blog doc to the current viewer API; don't pin a version blind.**

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `posts` / `categories` / `tags` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { posts, categories, tags } from '@wix/blog';

  const client = createClient({
    modules: { posts, categories, tags },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  ```
  The `clientId` is public, not a secret.

---

## The blog features (build the ones the site needs)

Each section below is a **self-contained blog feature** — implement only the ones the site uses; they don't have to be built in order. The only ordering is *within* a feature (e.g. resolve `categoryIds` after you have the post).

### Listing posts (and the `RICH_CONTENT` + `_id` rules)

Query posts with `posts.queryPosts(...)`, newest first:

```js
const { items } = await posts
  .queryPosts({ fieldsets: ["RICH_CONTENT", "URL"] })
  .descending("firstPublishedDate")
  .limit(20)
  .find();
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/blog/posts/query-posts.md?apiView=SDK>

**⚠️ CRITICAL: request the `RICH_CONTENT` fieldset, or `post.richContent` is `undefined`.** `queryPosts` omits the body by default; without `fieldsets: ["RICH_CONTENT"]` the post comes back with no `richContent`, and the detail page renders blank. (Add `"URL"` to get `post.url`/`slug` for links.)

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** The SDK normalizes every entity's id to **`_id`**; `post.id` is `undefined` in SDK code. Use `post._id` for keys and lookups, and `post.slug` for links (`/blog/${post.slug}`). (A surprising field name means you're reading the REST doc view — re-open it with `?apiView=SDK`.)

**Visibility:** only published posts are returned to a visitor token, so a missing post usually means it wasn't seeded `publish: true` — not a query bug (ties back to the seed recipe).

### Opening a post by slug

Filter by `slug` and take the first item:

```js
const { items } = await posts
  .queryPosts({ fieldsets: ["RICH_CONTENT", "URL"] })
  .eq("slug", slug)
  .find();
const post = items[0];
if (!post) { /* 404 → redirect to /blog */ }
```

**Astro page routing + SEO (Wix-managed) — `wixMetadata` is required.** A blog-post detail page (`src/pages/blog/[...slug].astro`) is a Wix **item page**: its `<title>`/description/OG/canonical come from what the owner sets in the dashboard. Wire it per the canonical guide — **[Add SEO Support to Item Pages](https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md)** — which covers all three steps: export `wixMetadata` (registers the route → sitemap + dashboard SEO editor), call `loadSEOTagsServiceConfig(...)`, and render `<SEO.Tags>` (from `@wix/seo`; deps + `@wix/essentials ≥ 1.0.10` are in the guide's "Before you begin"). Source `wixMetadata` from `WIX_APPS`, referenced **directly** inside the export (it's evaluated in module scope):

```js
import { WIX_APPS } from "@wix/essentials";
import { seoTags } from "@wix/seo";           // → itemType: seoTags.ItemType.BLOG_POST

export const wixMetadata = {
  appDefId: WIX_APPS.blogs.id,
  pageIdentifier: WIX_APPS.blogs.postPageMetadata.pageIdentifier,
  identifiers: { slug: WIX_APPS.blogs.postPageMetadata.identifiers.slug },
};
```
Use the `[...slug]` **rest** param (not `[slug]`), and `Astro.params` directly — Wix headless projects run `output: "server"` (SSR), so there's no `getStaticPaths()`. **If you add a blog category route** (e.g. `/category/[slug]`), wire it the same way with `WIX_APPS.blogs.categoryPageMetadata` + `seoTags.ItemType.BLOG_CATEGORY`. ⚠️ Dashboard SEO *overrides* for blog **categories** may not be honored by the resolver (it can return label-derived defaults) — the route still registers and gets valid default tags, so this is a Wix-side gap, not a wiring bug.

### Rendering the post body (Ricos rich content)

The body is **Ricos** (`post.richContent`), not HTML — **never** `set:html={post.content}` (there is no `.content`), and never `String(node)`. Render it with `@wix/ricos`:

```tsx
// src/components/RicosViewer.tsx
import { quickStartViewerPlugins, RicosViewer } from '@wix/ricos';
import '@wix/ricos/css/all-plugins-viewer.css';

const plugins = quickStartViewerPlugins();   // module-level, once — not per render

export default function RicosContentViewer({ content }) {
  if (!content) return null;
  return <div className="ricos-content"><RicosViewer content={content} plugins={plugins} /></div>;
}
```
Doc: <https://dev.wix.com/docs/sdk/business-solutions/blog/introduction.md?apiView=SDK> (follow it to the current Ricos viewer API; verify with `SearchWixSDKDocumentation "ricos viewer"`).

**⚠️ CRITICAL (Astro): render the viewer with `client:only="react"`.** `@wix/ricos` is a React component that breaks under SSR. `<RicosViewer client:only="react" content={post.richContent} />` makes it render client-side only. `@wix/ricos` accepts the camelCase `richContent` from the `@wix/blog` SDK directly — no key renaming.

**⚠️ Ricos text invisible on dark themes.** The Ricos library CSS hardcodes near-black text color on paragraphs/lists. If the site theme is dark, scope an override on the `.ricos-content` wrapper forcing `var(--color-text)` — and in Astro use `<style is:global>`, because React islands don't inherit scoped Astro styles.

For a short excerpt/card summary use `post.excerpt` (a plain string) — not the raw `richContent` nodes.

### Resolving categories and tags

`post.categoryIds` / `post.tagIds` are id arrays — resolve each to a label:

```js
const { category } = await categories.getCategory(id);   // ENVELOPE — destructure { category }
const tag = await tags.getTag(id);                        // returns the BlogTag DIRECTLY — do NOT destructure
```
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/blog/category/get-category.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/blog/tags/get-tag.md?apiView=SDK>

**⚠️ CRITICAL: the two return shapes differ.** `categories.getCategory(id)` returns an **envelope** `{ category }` — destructure it. `tags.getTag(id)` returns the **tag object directly** — destructuring it as `{ tag }` yields `undefined`. Getting this backwards is a silent `undefined.label`.

### Rendering the cover image

A post's cover lives at `post.media?.wixMedia?.image` and may be a **`wix:image://` identifier, not a ready URL**. Resolve it with the SDK media module:

```js
import { media } from '@wix/sdk';
const coverUrl = post.media?.wixMedia?.image
  ? media.getImageUrl(post.media.wixMedia.image).url   // or media.getScaledToFillImageUrl(ref, w, h)
  : undefined;
```

**Never hand-build a `static.wixstatic.com/.../v1/fit/...` URL** — the format is easy to get wrong and the image then **403s**. Only `wix:image://` values need resolving; an already-absolute `https://` URL (e.g. an Unsplash placeholder seeded when imagery is off) goes straight into `<img src>`. Constrain Wix image URLs with `aspect-ratio` + `object-fit: cover` so they don't overflow at intrinsic size. Doc: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>

### Member features (only if the site has the members capability)

When the site has **members** (login — see `how-to-code-members-astro.md` / `-non-astro.md`), two blog features become member-native. Both follow the same **read-public / write-as-the-logged-in-member** shape as everywhere else — resolve identity at the action, never gate the whole page, and **never `auth.elevate()`** for a member acting on their own behalf.

> **⚠️ Members-only (gated) content — gate on a LIVE, queryable signal, never a hardcoded id/slug list.** If the brief gates full articles to paying members, decide "is this post gated?" from a signal **carried on the post itself** and read at request time — a `members-only` blog **category or tag**, or a boolean field on a companion CMS record — so a gated post the owner publishes later **self-classifies** with no code change. **Do NOT** gate by a hardcoded list of "premium" post slugs/ids frozen at build time: a members-only post added afterward would read as **public** (an owner edit silently lost). Combine the gate with the member check — resolve the visitor's plan/login at the action, and reveal the full body only when both the post is flagged gated *and* the member is eligible (plan eligibility is itself a live read — see `how-to-code-pricing-plans.md`).

> **⚠️ Members can LIKE and COMMENT — they CANNOT author or manage posts.** Every draft-post write/query method (`createDraftPost`, `updateDraftPost`, `publishDraftPost`, `deleteDraftPost`, `queryDraftPosts`) is **admin-only** (`applicableIdentities: [APP]`, Manage-Blog scope) — a member token is rejected. Blog authoring is a back-office capability; the seed recipe's `memberId` only *attributes* a post to a member, it doesn't grant members authoring rights (`setup-blog.md` STEP 1). Do **not** build a "write a post" / "my drafts" member surface expecting the member's own session to work. (It's only achievable by an app-mediated backend that `auth.elevate()`s to APP, creates on the member's behalf, and enforces per-member ownership itself — an authoring workflow with moderation implications, not a drop-in feature. Don't build it unless the brief explicitly asks.)

### Likes (member-native)

Liking is a first-class member action — `likes.createLike` / `deleteLike` / `queryLikes` accept a **`MEMBER`** identity (not admin), so a logged-in member likes/unlikes a post directly.

- **Show the count + "liked by me":** `likes.queryLikes` (public read) for the per-post total; the current member's like state comes from their own likes. Post-level engagement counts are also on the post via the metrics fieldset.
- **Toggle:** on click, POST to a backend endpoint (`src/pages/api/*.ts`) that calls `likes.createLike` / `deleteLike` with the request session; if the caller isn't a member, redirect to `/api/auth/login?returnUrl=…` (same gate-on-action shape as comments). Keys off the post id (`post._id`).
- Discover shapes: `SearchWixSDKDocumentation "blog likes createLike queryLikes"`.

### Comments — read public, write authenticated

> **⚠️ Intent-gate this feature.** Comments **hard-depend on members/login**, so build them **only when the brief explicitly asks for reader comments or discussion.** An unrequested comments feature drags in an unrequested login gate — consistent with the `CAPABILITIES.md` blog entry (comments are optional / intent-gated, not part of the baseline blog surface). Reading comments is public; **submitting / editing / deleting** needs a logged-in member — render the thread always, and resolve identity **at the action** (show a "log in to comment" prompt to anonymous visitors, not a form that bounces).

Package: `@wix/comments` (`comments`). The API keys off the post's **`referenceId`** — request the `REFERENCE_ID` fieldset when fetching the post, then `contextId = resourceId = post.referenceId`, and `appId = "14bcded7-0066-7c35-14d7-466cb3f09103"` (the Blog app id).

- **List (public, SSR) — use `listCommentsByResource`, NOT `queryComments`.** `comments.listCommentsByResource(APP_ID, { contextId, resourceId, commentSort: { order: "OLDEST_FIRST" }, cursorPaging: { limit } })` → returns `{ comments }`. **⚠️ The docs' `queryComments` example ships wrapped in `auth.elevate(comments.queryComments)` — an admin path that must NOT be used for the public/anonymous SSR read.** Reaching for `queryComments` steers you straight into that elevated example; use `listCommentsByResource` for the visitor read.
- **Comment body is Ricos, not a string.** `createComment` / `updateComment` take `content: { richContent: <ricos-doc> }` — the same `{ nodes: [{ type:"PARAGRAPH", nodes:[{ type:"TEXT", textData:{ text, decorations:[] }}]}]}` shape as post bodies. Convert the textarea string ↔ Ricos yourself (a small `plainTextToRicos` / `ricosToPlainText` helper).
- **Submit (member-gated):** POST to a backend endpoint (`src/pages/api/*.ts`) that resolves the session and calls `comments.createComment(...)`; if the caller isn't a member, redirect to `/api/auth/login?returnUrl=…` (framework-provided on managed Astro — **no `src/pages/api/auth` file needed**, `@wix/astro` emits it at build). **Not** a client island.
- **Edit / delete own comment — ownership is app-enforced.** The SDK does **not** enforce ownership server-side, so you must: fetch first (`comments.getComment(id)`), check `existing.author?.memberId === member._id`, then `comments.updateComment(id, { revision: existing.revision, content })` (**⚠️ update requires the fetched `revision`**) or `comments.deleteComment(id)`.
- **Comment count:** request the **`METRICS` fieldset** on the post fetch and read `post.metrics.comments`. Do **not** call `comments.countComments` — it needs elevation.
- **Author name/photo:** resolve `comment.author?.memberId` (and `post.memberId`) via `@wix/members`. Comment fields normalize to **`_id`** / **`_createdDate`** (same `_id` rule as posts).
- **Pagination / "load more":** `listCommentsByResource` is **cursor-paged** — pass `cursorPaging: { limit }` and follow the returned paging **cursor** for the next page; don't offset-page.
- **"Edited" indicator:** after an update, `comment.contentEdited === true` — render an "(edited)" marker.
- **Threaded replies (optional, only if the brief wants nested discussion):** a reply carries `comment.parentComment` (present *only* on replies); `comment.replyCount` is the number of replies; fetch one comment's thread with `comments.getCommentThread(commentId, …)`. For a flat thread (the common case), ignore `parentComment` and just render the `listCommentsByResource` results in `OLDEST_FIRST` order.
- **Optional extras (wire only if asked):** comment votes — `comment.voteSummary.upvoteCount` / `downvoteCount`; and marking/pinning — `comment.marked`.

> **⚠️ REST-vs-SDK permission trap.** The raw REST comments methods all report `applicableIdentities: [APP]` (admin) — but the **`@wix/comments` SDK path** resolves the **read as public** and the **write as the logged-in member**. Don't let the REST spec push you into `auth.elevate()`-ing the read or the member write — that's wrong for the visitor thread. Only the genuine **moderation** calls (`hideComment`, `moderateDraftContent`, `countComments`, `markComment`, publish/bulk-*) need elevation, and those are back-office, not part of the visitor-facing feature.

---

## Conclusion
A correct Blog V3 frontend:
- imports **`posts` / `categories` / `tags` from `@wix/blog`** (+ `@wix/ricos`, `media`) — **never `@wix/data`** for blog content;
- queries with the **`RICH_CONTENT` fieldset** (else `richContent` is `undefined`) and uses **`post._id`** (never `post.id`) and `post.slug` for links;
- renders the body with **`@wix/ricos` `RicosViewer`** (`client:only="react"` in Astro, `.ricos-content` color override for dark themes) — never `set:html`, never raw nodes;
- destructures **`categories.getCategory` as `{ category }`** but takes **`tags.getTag` directly** (not `{ tag }`);
- resolves **`wix:image://` covers via the SDK `media` module** — never a hand-built CDN URL;
- exports **`wixMetadata`** on the Astro `[...slug]` detail page;
- if comments exist, reads them **public/SSR** and submits via an **authenticated API endpoint** keyed on **`post.referenceId`** + the Blog `appId`;
- if the site has **members**, wires **likes** (`@wix/blog` `likes`, `MEMBER`-scoped) and comments as member-native, gate-on-action features — but **never** a member post-authoring surface (all draft-post methods are APP-only; a member token is rejected).
