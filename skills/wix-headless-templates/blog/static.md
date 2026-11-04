# The blog on a static site

The pages are HTML files at the root of the site. They import the blog layer from `/js/wix/`:
the post, taxonomy and comment reads, and three stores that hold the state and the rules of a
blog. Nothing on the screen ships; every element is yours, in the design of the site. This file
shows how to drive the layer. The skeletons show the calls and the fields and leave the markup
to you.

## The layer

`/js/wix/posts.js`: `fetchPosts(options)` returns `{ posts, nextCursor }`, pinned first then
newest first; `fetchPostBySlug(slug)` (null when the slug resolves to nothing);
`fetchRelatedPosts(post)`; `fetchPostMetrics(postId)`. `/js/wix/taxonomy.js`:
`fetchBlogCategories()`, `fetchBlogTags()`, `fetchCategoryBySlug(slug)`, `fetchTagBySlug(slug)`
(null when nothing matches). `/js/wix/authors.js`, `/js/wix/post-likes.js` and
`/js/wix/comments.js` are the transports the stores use. Cover and avatar URLs come resolved,
dates come as `dateLabel` with `dateISO` beside them, counters are numbers or undefined; render
them as they are.

Three stores: `createBlogFeedStore(options)` in `/js/wix/blog-feed-store.js` for a listing,
`createPostStore({ slug })` in `/js/wix/post-store.js` for one post, and
`createCommentsStore({ referenceId })` in `/js/wix/comments-store.js` for one post's thread. A
store owns the rules: which filter is active, the cursor and the page size, the like toggle and
its rollback, which comment belongs to the viewer, when a comment needs a sign-in. A page reads
the state and calls the actions; it computes nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for every store: create it, subscribe a render function, render once, start. A store
calls the listener on every change and not on subscribe, so the first render is yours. Controls
call the store's actions; delegate from the surface's root and read what to do from the element,
so a re-render keeps the listeners.

```js
import { createPostStore } from "/js/wix/post-store.js";

var store = createPostStore({ slug: new URLSearchParams(location.search).get("slug") || "" });
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();

root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (b && "like" in b.dataset) store.toggleLike().catch(function () {});
});
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The feed

`blog.html` on `createBlogFeedStore()`. `category.html?slug=…` resolves the slug with
`fetchCategoryBySlug` first (null is the not-found state, nothing else on the page) and passes
`initialCategoryId`; `tag.html?slug=…` does the same with `fetchTagBySlug` and `initialTagId`.
From the state:

- `posts` is null while the first page loads (a loading state, not an empty one), then the page
  so far. `hasMore` and `loadingMore` drive a load-more control calling `loadMore()`. `error` is
  the failed read's message; the empty message shows only while `error` is null.
- `categories` and `tags`, with `activeCategoryId` and `activeTagId`. A category with `postCount`
  above zero is a link to its page, by `slug`, labelled by `label`; `setActiveCategoryId(id)` and
  `setActiveTagId(id)` switch the scope in place on the blog page.
- A card shows the summary's fields: `coverUrl` with `coverAlt`, `title`, `excerpt`, `dateLabel`
  in a `time` with `dateISO`, `minutesToRead`, `authorName` with `authorAvatarUrl`, `pinned` and
  `featured` when the design gives them a mark. A counter renders only when defined.

Filters and paging run on Wix; the loaded page is never filtered or re-sorted in the browser.

```js
import { createBlogFeedStore } from "/js/wix/blog-feed-store.js";

var feed = createBlogFeedStore();
moreEl.addEventListener("click", function () { feed.loadMore().catch(function () {}); });
feed.subscribe(function (s) {
  moreEl.hidden = !s.hasMore;
  moreEl.disabled = s.loadingMore;
  statusEl.textContent = s.error ? s.error : s.posts && !s.posts.length ? "No posts yet." : "";
  // the category links from s.categories; one card per entry of s.posts
});
feed.start();
```

The home page shows the latest posts under a truthful heading from `fetchPosts()`, with the same
card, and links its categories to the category page.

## The post page

`post.html?slug=…` on `createPostStore({ slug })`. From the state:

- `post` is null while loading and when not found; `notFound` tells them apart, and a slug that
  resolves to nothing shows only the not-found state. `post` carries `title`, `coverUrl`,
  `coverAlt`, `dateLabel`, `dateISO`, `updatedLabel`, `minutesToRead`, `authorName`,
  `authorAvatarUrl`, `seoTitle`, `seoDescription`, `commentingEnabled`, `referenceId`.
- The body is `post.bodyHtml`, set as the `innerHTML` of one wrapper; when it is "", render
  `post.paragraphs` as paragraphs. `richContent` is a document for a viewer this stack has no
  bundler for; leave it unread.
- `categories` and `tags` come resolved: display `label`, route by `slug`. `related` is null
  while loading and [] when none; each entry is a summary for a small card.
- `isLiked`, `likeCount`, `likeCountLoaded`, `viewCount`, `commentCount`: the like control calls
  `toggleLike()`, which is optimistic and rolls back on failure, disabled while `liking`; a count
  renders only when its number is defined, and the like count only once `likeCountLoaded`.
- `document.title` is `seoTitle` and the meta description `seoDescription`. A byline shows only
  with `authorName`. The comments section mounts only when `commentingEnabled` and `referenceId`
  are set. On a phone the cover is a bounded band, so the title and the first lines stay in the
  first screen.

```js
store.subscribe(function (s) {
  if (s.notFound) { root.textContent = "This post does not exist."; return; }
  if (!s.post) { root.textContent = s.error || "Loading…"; return; }
  document.title = s.post.seoTitle;
  titleEl.textContent = s.post.title;
  if (s.post.bodyHtml) bodyEl.innerHTML = s.post.bodyHtml;
  else bodyEl.replaceChildren.apply(bodyEl, s.post.paragraphs.map(function (t) { var p = document.createElement("p"); p.textContent = t; return p; }));
  likeEl.setAttribute("aria-pressed", String(s.isLiked));
  likeEl.disabled = s.liking;
  likeEl.textContent = "Like" + (s.likeCountLoaded && s.likeCount !== undefined ? " " + s.likeCount : "");
  // categories, tags and related from s.categories, s.tags, s.related
});
```

## The comments

`createCommentsStore({ referenceId })` holds one post's thread, two levels deep. From the state:

- `comments` is null while the first page loads, then the top-level comments. `hasMore` and
  `loadingMore` drive a load-more control calling `loadMore()`. `sort` with `setSort(sort)`.
- `replies` is keyed by top-level comment id, each with `comments`, `nextCursor` and `loading`;
  `loadReplies(topLevelId)` fills it. A comment's `replyCount` minus the replies shown is the
  count on the show-replies control.
- A comment carries `text`, `authorName`, `authorAvatarUrl`, `dateLabel`, `dateISO`, `status`,
  `isOwn`, `parentAuthorName`, `topLevelId`. A PENDING comment reads as awaiting approval; a
  DELETED one is a placeholder kept for its replies; the delete control shows on `isOwn` and
  calls `remove(id)`.
- `create(text, { parentId, topLevelId })` posts a comment or a reply and resolves to the comment
  (PENDING when the owner moderates) or null when refused; `saving` while in flight. A refusal
  sets `needsSignIn`, so the form gives way to a sign-in note. Who may comment is the owner's
  setting, decided by the server. `error` is the failed read's message.

```js
import { createCommentsStore } from "/js/wix/comments-store.js";

var comments = createCommentsStore({ referenceId: post.referenceId });
box.addEventListener("submit", function (e) {
  e.preventDefault();
  var text = e.target.elements.text.value.trim();
  if (text) comments.create(text, { parentId: e.target.dataset.parent || null, topLevelId: e.target.dataset.top || null })
    .then(function (c) { if (c) e.target.reset(); });
});
box.addEventListener("click", function (e) {
  var b = e.target.closest("button[data-action]");
  if (!b) return;
  if (b.dataset.action === "replies") comments.loadReplies(b.dataset.id).catch(function () {});
  else if (b.dataset.action === "delete") comments.remove(b.dataset.id).catch(function () {});
  else if (b.dataset.action === "more") comments.loadMore().catch(function () {});
});
comments.subscribe(function (s) {
  // the thread from s.comments and s.replies; the form, or a sign-in note when s.needsSignIn
});
comments.start();
```

A reply form is the same form with `data-parent` set to the comment's id and `data-top` to its
`topLevelId`, or to its own id for a top-level comment.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/blog.html`, `/post.html?slug=…`, `/category.html?slug=…`, `/tag.html?slug=…`. A post slug may
contain `/`; `encodeURIComponent` on the way out and `URLSearchParams` on the way in keep it whole.
A link to a folder gives the visitor a 404 page. Every page declares its charset in the head; the
host sends none. Write the pages' scripts as files of their own and keep each file small; a page's
code travels as text in the upload call.

## Rules

- Data goes through the layer's exports. Extend by calling them; the request shapes stay in the
  layer.
- The body is `bodyHtml` as the `innerHTML` of one wrapper, `paragraphs` when it is "".
- Route by `slug`; display categories and tags by `label`.
- `notFound` means not found: render the not-found state. Only published posts come back, so a
  missing post is an unpublished one.
- Filter and page at the source: the feed store and `fetchPosts` run on Wix before paging. Never
  filter a loaded page, never raise the page size.
- The empty state shows only when `error` is null; a failed read shows the error state.
- Live data or an honest empty state: no invented posts, authors, dates, counts or read times, no
  stock placeholder covers. A count that is unknown renders nothing.
- Likes and comments are the viewer's, in the browser, as the current session. View counting is
  not shipped; views display from the counters when present.
- Render form inputs once; a render touches their values, the button and the error, not the inputs.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

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
