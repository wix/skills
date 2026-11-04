# The blog on a static site

The pages are HTML files at the root of the site. They import the blog modules from `/js/wix/`
and render what the modules return. This file is the whole playbook for that path: the modules,
the feed, the post page with likes and comments, the routes, the rules and the seed.

## The modules

`/js/wix/posts.js`: `fetchPosts(options)` returns `{ posts, nextCursor }`, pinned first then newest
first; `fetchPostBySlug(slug)` returns a post or null; `fetchRelatedPosts(post)`; `fetchPostMetrics`.
`/js/wix/taxonomy.js`: `fetchBlogCategories()`, `fetchBlogTags()`, `fetchCategoryBySlug(slug)`,
`fetchTagBySlug(slug)` (null when the slug matches nothing). `/js/wix/post-likes.js` and
`/js/wix/comments.js` are the transports the stores use. Cover and avatar URLs come resolved,
dates come as `dateLabel` with `dateISO` beside them, counters are numbers or undefined.
Three stores hold the state and the rules: `createBlogFeedStore` in `/js/wix/blog-feed-store.js`
(the feed: filters and cursor paging), `createPostStore` in `/js/wix/post-store.js` (one post,
its categories and tags resolved, the related strip, the like toggle), `createCommentsStore` in
`/js/wix/comments-store.js` (the thread of one post). Each `.js` opens with its declarations. A
store calls a listener on every change and not when it subscribes: render once after subscribing,
then `start()`. The visitor token persists in `localStorage` on its own; never mint one in a page.

## The feed

`blog.html` renders the feed from `createBlogFeedStore()`. `category.html?slug=…` resolves the
slug with `fetchCategoryBySlug` first (null is the not-found state, nothing else on the page) and
passes `initialCategoryId`; `tag.html?slug=…` does the same with `fetchTagBySlug` and
`initialTagId`. The state: `posts` (null on the first load: skeletons, not an empty state),
`categories`, `tags`, `activeCategoryId`, `activeTagId`, `hasMore`, `loadingMore`, `error`. The
actions: `setActiveCategoryId`, `setActiveTagId`, `loadMore`. Filters and paging run on Wix; a
loaded page is never filtered or re-sorted in the browser, and the page size stays as it is.
The category row shows only categories with `postCount` above zero, as links to the category
page. The empty message shows only while `error` is null. The example follows the store's declared
interface.

```html
<nav id="blog-filters"></nav>
<div id="posts"></div>
<p id="feed-status" hidden></p>
<button id="load-more" type="button" hidden>Load more</button>
```

```js
import { createBlogFeedStore } from "/js/wix/blog-feed-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const postHref = (p) => `/post.html?slug=${encodeURIComponent(p.slug)}`;
const categoryHref = (c) => `/category.html?slug=${encodeURIComponent(c.slug)}`;
const feed = createBlogFeedStore();
const filters = document.querySelector("#blog-filters"), grid = document.querySelector("#posts");
const status = document.querySelector("#feed-status"), more = document.querySelector("#load-more");
more.addEventListener("click", () => feed.loadMore().catch(() => {}));

const card = (p) => `
  <article class="card">
    ${p.coverUrl ? `<a href="${postHref(p)}"><img class="card-cover" src="${p.coverUrl}" alt="${esc(p.coverAlt)}" loading="lazy"></a>` : ""}
    <h2 class="card-title"><a href="${postHref(p)}">${esc(p.title)}</a></h2>
    ${p.excerpt ? `<p class="card-excerpt">${esc(p.excerpt)}</p>` : ""}
    <p class="card-meta">${p.dateLabel ? `<time datetime="${p.dateISO}">${p.dateLabel}</time>` : ""}${p.minutesToRead ? ` · ${p.minutesToRead} min read` : ""}</p>
    ${p.authorName ? `<p class="card-byline">${p.authorAvatarUrl ? `<img class="avatar" src="${p.authorAvatarUrl}" alt="">` : ""}${esc(p.authorName)}</p>` : ""}
  </article>`;

function renderFeed(s) {
  const withPosts = s.categories.filter((c) => c.postCount > 0);
  filters.innerHTML = withPosts.length > 1 ? `<a class="pill${s.activeCategoryId ? "" : " pill--active"}" href="/blog.html">All</a>` +
    withPosts.map((c) => `<a class="pill${c.id === s.activeCategoryId ? " pill--active" : ""}" href="${categoryHref(c)}">${esc(c.label)}</a>`).join("") : "";
  if (s.posts === null) { grid.innerHTML = `<div class="card card--skeleton"></div>`.repeat(3); return; }
  grid.innerHTML = s.posts.map(card).join("");
  status.hidden = !(s.error || s.posts.length === 0);
  status.textContent = s.error ? "The posts could not be loaded. Please try again." : s.posts.length === 0 ? "No posts yet." : "";
  more.hidden = !s.hasMore;
  more.disabled = s.loadingMore;
  more.textContent = s.loadingMore ? "Loading…" : "Load more";
}
feed.subscribe(renderFeed);
renderFeed(feed.getState());
feed.start();
```

The home page shows the latest posts under a truthful heading from `fetchPosts()`, with the same
card, and links its categories to the category page.

## The post page

`post.html?slug=…` renders from `createPostStore({ slug })`. The state: `post` (null while
loading and when not found; `notFound` tells them apart), `categories` and `tags` resolved to
objects (display `label`, route by `slug`), `related` (null while loading, [] when none),
`isLiked`, `likeCount`, `likeCountLoaded`, `viewCount`, `commentCount`, `liking`, `error`; the
action `toggleLike()` is optimistic and rolls back on failure. The body is `post.bodyHtml`, set
as the `innerHTML` of one wrapper, and `post.paragraphs` as paragraphs when it is "". The page
shows a byline only with `authorName`, a counter only when its number is defined, and the comments
section only when `commentingEnabled` and `referenceId` are set. `document.title` is
`post.seoTitle` and the meta description `post.seoDescription`. A slug that resolves to nothing
shows only the not-found state. On a phone the cover is a bounded band, so the title and the
first lines stay in the first screen.

```html
<article id="post"></article>
<section id="comments" hidden></section>
```

```js
import { createPostStore } from "/js/wix/post-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const slug = new URLSearchParams(location.search).get("slug") ?? "";
const store = createPostStore({ slug });
const root = document.querySelector("#post");
root.addEventListener("click", (e) => { if (e.target.closest("[data-like]")) store.toggleLike().catch(() => {}); });

function renderPost(s) {
  if (s.notFound) { root.innerHTML = `<p class="not-found">This post does not exist.</p>`; return; }
  if (!s.post) { root.innerHTML = s.error ? `<p class="error">${esc(s.error)}</p>` : `<div class="post-skeleton"></div>`; return; }
  const p = s.post;
  document.title = p.seoTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", p.seoDescription);
  root.innerHTML = `
    <header class="post-header">
      ${s.categories.length ? `<p class="eyebrow">${s.categories.map((c) => `<a href="/category.html?slug=${encodeURIComponent(c.slug)}">${esc(c.label)}</a>`).join(" · ")}</p>` : ""}
      <h1>${esc(p.title)}</h1>
      <p class="post-meta">${p.authorName ? `<span class="byline">${esc(p.authorName)}</span> · ` : ""}${p.dateLabel ? `<time datetime="${p.dateISO}">${p.dateLabel}</time>` : ""}${p.minutesToRead ? ` · ${p.minutesToRead} min read` : ""}</p>
      ${p.coverUrl ? `<img class="post-cover" src="${p.coverUrl}" alt="${esc(p.coverAlt)}">` : ""}
    </header>
    <div class="post-body"></div>
    <div class="post-engagement">
      <button type="button" class="like" data-like aria-pressed="${s.isLiked}" ${s.liking ? "disabled" : ""}>Like${s.likeCountLoaded && s.likeCount !== undefined ? ` <span class="like-count">${s.likeCount}</span>` : ""}</button>
      ${s.viewCount !== undefined ? `<span class="views">${s.viewCount} views</span>` : ""}
      ${s.commentCount !== undefined ? `<span class="comment-count">${s.commentCount} comments</span>` : ""}
    </div>
    ${s.tags.length ? `<p class="tags">${s.tags.map((t) => `<a class="tag" href="/tag.html?slug=${encodeURIComponent(t.slug)}">${esc(t.label)}</a>`).join("")}</p>` : ""}
    ${s.related?.length ? `<aside class="related"><h2>Related posts</h2>${s.related.map((r) => `<a class="related-item" href="/post.html?slug=${encodeURIComponent(r.slug)}">${r.coverUrl ? `<img src="${r.coverUrl}" alt="${esc(r.coverAlt)}" loading="lazy">` : ""}<span>${esc(r.title)}</span></a>`).join("")}</aside>` : ""}`;
  const body = root.querySelector(".post-body");
  if (p.bodyHtml) body.innerHTML = p.bodyHtml;
  else body.replaceChildren(...p.paragraphs.map((text) => Object.assign(document.createElement("p"), { textContent: text })));
  if (p.commentingEnabled && p.referenceId && !document.querySelector("#comments").dataset.mounted) mountComments(p.referenceId);
}
store.subscribe(renderPost);
renderPost(store.getState());
store.start();
```

## The comments

`createCommentsStore({ referenceId })` holds one post's thread, two levels deep. The state:
`comments` (null while the first page loads), `replies` keyed by top-level comment id (each with
`comments`, `nextCursor`, `loading`), `hasMore`, `loadingMore`, `saving`, `needsSignIn`,
`currentMemberId`, `sort`, `error`. The actions: `loadMore`, `loadReplies(topLevelId)`,
`setSort`, `create(text, { parentId, topLevelId })` (resolves to the comment, PENDING when the
owner moderates, or null when refused), `remove(commentId)` for the member's own. A comment's
body is `text`; a PENDING comment reads "awaiting approval"; a DELETED one is a placeholder kept
for its replies; the delete control shows on `isOwn`; a refusal sets `needsSignIn`, so the form
gives way to a sign-in note. Who may comment is the owner's setting, decided by the server.

```js
import { createCommentsStore } from "/js/wix/comments-store.js";

function mountComments(referenceId) {
  const box = document.querySelector("#comments");
  box.dataset.mounted = "1";
  box.hidden = false;
  const comments = createCommentsStore({ referenceId });
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  box.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target, text = form.elements.text.value.trim();
    if (text) comments.create(text, { parentId: form.dataset.parent || null, topLevelId: form.dataset.top || null }).then((c) => { if (c) form.reset(); });
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    if (b.dataset.action === "more") comments.loadMore().catch(() => {});
    if (b.dataset.action === "replies") comments.loadReplies(b.dataset.id).catch(() => {});
    if (b.dataset.action === "delete") comments.remove(b.dataset.id).catch(() => {});
  });
  const item = (c, s) => `
    <li class="comment" data-status="${c.status}">
      <p class="comment-meta">${esc(c.authorName || "Guest")}${c.parentAuthorName ? ` <span class="replying">replying to ${esc(c.parentAuthorName)}</span>` : ""} · <time datetime="${c.dateISO}">${c.dateLabel}</time>${c.status === "PENDING" ? ` · <em>awaiting approval</em>` : ""}</p>
      <p class="comment-text">${c.status === "DELETED" ? "<em>This comment was deleted.</em>" : esc(c.text)}</p>
      ${c.isOwn && c.status !== "DELETED" ? `<button type="button" class="text-action" data-action="delete" data-id="${c.id}">Delete</button>` : ""}
      ${c.topLevelId === null && c.replyCount > 0 ? replies(c, s) : ""}
    </li>`;
  const replies = (c, s) => {
    const t = s.replies[c.id];
    const shown = t?.comments ?? [];
    const remaining = c.replyCount - shown.length;
    return `<ul class="replies">${shown.map((r) => item(r, s)).join("")}</ul>${remaining > 0 ? `<button type="button" class="text-action" data-action="replies" data-id="${c.id}" ${t?.loading ? "disabled" : ""}>Show ${remaining} ${remaining === 1 ? "reply" : "replies"}</button>` : ""}`;
  };
  function renderComments(s) {
    if (s.comments === null) { box.innerHTML = `<h2>Comments</h2><p class="comments-skeleton"></p>`; return; }
    box.innerHTML = `<h2>Comments</h2>
      ${s.error ? `<p class="error">${esc(s.error)}</p>` : s.comments.length === 0 ? `<p>No comments yet.</p>` : ""}
      <ul class="comments">${s.comments.map((c) => item(c, s)).join("")}</ul>
      ${s.hasMore ? `<button type="button" data-action="more" ${s.loadingMore ? "disabled" : ""}>More comments</button>` : ""}
      ${s.needsSignIn ? `<p class="sign-in">Sign in to comment.</p>` : `<form class="comment-form"><label>Add a comment <textarea name="text" rows="3" required ${s.saving ? "disabled" : ""}></textarea></label><button type="submit" ${s.saving ? "disabled" : ""}>${s.saving ? "Posting…" : "Post"}</button></form>`}`;
  }
  comments.subscribe(renderComments);
  renderComments(comments.getState());
  comments.start();
}
```

A reply form reuses the same form with `data-parent` set to the comment's id and `data-top` to
its `topLevelId` (or its own id for a top-level comment).

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/blog.html`, `/post.html?slug=…`, `/category.html?slug=…`, `/tag.html?slug=…`. A post slug may
contain `/`; `encodeURIComponent` on the way out and `URLSearchParams` on the way in keep it
whole. A link to a folder gives the visitor a 404 page. One stylesheet and one script shared by
the pages, or inline per page, on one set of tokens.

## Rules

- Data goes through the module exports; extend by calling them, the request shapes stay in the
  modules.
- The body is `bodyHtml` set as the `innerHTML` of one wrapper, `paragraphs` when it is "".
  `richContent` is a document for a viewer this stack has no bundler for; leave it unread.
- Route by `slug`; display categories and tags by `label`.
- `notFound` means not found: render the not-found state. Only published posts come back, so a
  missing post is an unpublished one.
- Filter and page at the source: the feed store's filters and `fetchPosts` run on Wix before
  paging. Never filter a loaded page, never raise the page size.
- `coverUrl` and `authorAvatarUrl` arrive resolved; use them as they are.
- The empty state shows only when `error` is null; a failed read shows the error state.
- Live data or an honest empty state: no invented posts, authors, dates, counts or read times, no
  stock placeholder covers. A count that is unknown renders nothing.
- Likes and comments are the viewer's, in the browser, as the current session.
- View counting is not shipped; views display from the counters when present.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `blog/posts` (published posts and
drafts), `blog/categories`, `blog/tags`, `blog/writers`, `blog/comments`, `blog/settings`. Only
published posts appear on the site. Pinned posts lead the feed; a post's related posts, cover
visibility, alt text, SEO title and description, and its comments switch are set on the post.
The site-wide comments switch in the blog settings has no public read, so say in the close that
the owner decides there whether comments show.

## Seeding

Per `seed/SEED.md` and `seed/seed-blog.mjs`: a plain-data plan, run in the script's order with its
waits. Seed posts that exercise the pages (about three posts, two categories when the brief has
sections, varied content blocks, a cover image per post). Authors resolve to the site owner's
member profile; a nickname and a photo set in the dashboard give a real byline.
