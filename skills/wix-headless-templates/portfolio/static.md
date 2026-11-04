# The portfolio on a static site

The pages are HTML files at the root of the site. They import the portfolio layer from
`/js/wix/`: the collection and project reads, and three stores that hold the state of the
gallery, of one collection and of one project. Nothing on the screen ships; every element is
yours, in the design of the site. This file shows how to drive the layer. The skeletons show the
calls and the fields and leave the markup to you.

## The layer

`/js/wix/portfolio.js`: `fetchCollections({ limit })`, `fetchCollectionBySlug(slug)` (null when
the slug resolves to nothing), `fetchProjects({ collectionId, limit })`,
`fetchProjectBySlug(slug)` (null when nothing resolves), `fetchProjectGallery(projectId)`. Every
read is public; hidden items are filtered out and collections come in the owner's order. Images
arrive as https URLs, videos as playable mp4 URLs with a poster frame; render them as they are.
`/js/wix/portfolio-core.js`: `mediaElement(item)` turns a gallery item into `{ tag, attrs }` (an
`img` or a `video` with its attributes) or null. `/js/wix/media.js`: `imgSrc(url, width, height)`
for a sized copy of an image.

Three stores: `createCollectionsStore()` in `/js/wix/collections-store.js` for the gallery,
`createCollectionProjectsStore(slug)` in `/js/wix/collection-projects-store.js` for one
collection and its projects, `createProjectDetailStore(slug)` in
`/js/wix/project-detail-store.js` for one project and its gallery. A store owns the sequence:
it resolves the slug, then loads what hangs off it, and tells loading from not found. A page reads
the state and renders; it computes nothing of its own.

A collection carries `id`, `slug`, `title`, `description`, `imageUrl` ("" when it has no cover).
A project carries the same plus `collectionIds`; the detail adds `details`, rows of `label`,
`text`, `url` (null for a text row) and `target`. A gallery item carries `id`, `kind` ("image" or
"video"), `title`, `description`, `imageUrl` (the image, or the video's poster), `videoUrl`,
`linkUrl` and `linkTarget`.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for the three stores: create it, subscribe a render function, render once, start. A
store calls the listener on every change and not on subscribe, so the first render is yours.
The stores here have no actions beyond `start()` and `stop()`; the page's controls are links.

```js
import { createProjectDetailStore } from "/js/wix/project-detail-store.js";

var store = createProjectDetailStore(new URLSearchParams(location.search).get("slug") || "");
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The gallery

`portfolio.html` on `createCollectionsStore()`. The state: `collections` (null on the first load,
a loading state, never an empty one), `error`. A collection card shows its own cover through
`imgSrc` (the page's placeholder when `imageUrl` is ""), its `title`, and links to
`collection.html?slug=…`. `[]` is an honest empty state, `error` its own. The home page shows
real collections or projects under truthful headings with the same cards.

```js
import { createCollectionsStore } from "/js/wix/collections-store.js";
import { imgSrc } from "/js/wix/media.js";

var store = createCollectionsStore();
store.subscribe(function (s) {
  if (s.collections === null) { root.textContent = "Loading…"; return; }
  var html = "";
  s.collections.forEach(function (c) {
    html += '<a href="/collection.html?slug=' + encodeURIComponent(c.slug) + '">'
      + (c.imageUrl ? '<img src="' + imgSrc(c.imageUrl, 800, 600) + '" alt="" loading="lazy">' : "")
      + "<h2>" + esc(c.title) + "</h2></a>";
  });
  root.innerHTML = html;
  statusEl.textContent = s.error || (s.collections.length ? "" : "No collections yet.");
});
store.start();
```

## The collection page

`collection.html?slug=…` on `createCollectionProjectsStore(slug)`. The state: `collection` (null
while loading and when not found; `notFound` tells them apart), `projects` (null while loading),
`error`. The header is the collection's `title` and `description`, then only its projects, each a
card with `imageUrl` and `title` linking to `project.html?slug=…`. A slug that resolves to
nothing shows the not-found state alone, with no header or empty grid around it. Set
`document.title` and the meta description from `title` and `description` once the collection
loads.

```js
import { createCollectionProjectsStore } from "/js/wix/collection-projects-store.js";

var store = createCollectionProjectsStore(new URLSearchParams(location.search).get("slug") || "");
function render(s) {
  if (s.notFound) { root.textContent = "This collection does not exist."; return; }
  if (!s.collection) { root.textContent = s.error || "Loading…"; return; }
  document.title = s.collection.title;
  headEl.innerHTML = "<h1>" + esc(s.collection.title) + "</h1>" + (s.collection.description ? "<p>" + esc(s.collection.description) + "</p>" : "");
  if (s.projects === null) { gridEl.textContent = "Loading…"; return; }
  var html = "";
  s.projects.forEach(function (p) {
    html += '<a href="/project.html?slug=' + encodeURIComponent(p.slug) + '" data-project="' + p.id + '">' + esc(p.title) + "</a>";
  });
  gridEl.innerHTML = html || "No projects in this collection yet.";
  statusEl.textContent = s.error || "";
}
store.subscribe(render);
render(store.getState());
store.start();
```

## The project page

`project.html?slug=…` on `createProjectDetailStore(slug)`. The state: `project` (null while
loading and when not found; `notFound` tells them apart), `items` (the gallery, null while
loading), `error`. The page shows `title`, `description` and the `details` rows (label and text,
a link when `url` is set, with its `target`) before the gallery. Gallery items come in the
dashboard's order; each becomes an element through `mediaElement(item)`, never through a branch
on `kind` in the page; the caption is `item.title` when present, and an item's `linkUrl` wraps it
when set. On a phone a gallery image is a bounded band. Set `document.title` and the meta
description from `title` and `description` once the project loads.

```js
import { createProjectDetailStore } from "/js/wix/project-detail-store.js";
import { mediaElement } from "/js/wix/portfolio-core.js";

function figureOf(item) {
  var el = mediaElement(item);
  if (!el) return null;
  var media = document.createElement(el.tag);
  Object.keys(el.attrs).forEach(function (name) { media.setAttribute(name, String(el.attrs[name])); });
  var figure = document.createElement("figure");
  if (item.linkUrl) {
    var a = document.createElement("a");
    a.href = item.linkUrl;
    if (item.linkTarget) a.target = item.linkTarget;
    a.append(media);
    figure.append(a);
  } else figure.append(media);
  if (item.title) { var cap = document.createElement("figcaption"); cap.textContent = item.title; figure.append(cap); }
  return figure;
}
store.subscribe(function (s) {
  if (s.notFound || !s.project) { root.textContent = s.notFound ? "This project does not exist." : s.error || "Loading…"; return; }
  // the header from s.project: title, description, one row per entry in s.project.details
  if (s.items) galleryEl.replaceChildren.apply(galleryEl, s.items.map(figureOf).filter(Boolean));
});
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the site; the gallery is built
with DOM calls, so nothing in it needs escaping.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/portfolio.html`, `/collection.html?slug=…`, `/project.html?slug=…`. A link to a folder gives
the visitor a 404 page. Write the pages' scripts as files of their own and keep each file small;
a page's code travels as text in the upload call.

## Rules

- Reads go through the layer's exports: they filter hidden items, keep the owner's order and
  resolve every media value. Media URLs arrive resolved; use them as they are.
- This solution sells nothing. A "contact about this project" call to action is a link.
- `notFound` is the not-found state and `error` shows as the error state; a null while loading
  is loading.
- `details` rows render as given, text or link per row.
- Gallery items render through `mediaElement`.
- Live data or an honest empty state: no invented clients, awards, dates or media; no Wix ids or
  technical words in visible text.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/wix-portfolio/projects`: Projects and Collections are
tabs on that page. Projects adds projects and their media galleries; Collections groups them.

## Seeding

Per `seed/SEED.md` and `seed/seed-portfolio.mjs`: a plain-data plan, run in the script's order
with its waits. Seed collections and projects that exercise the pages: a cover on everything, two
or three gallery images per project, `details` rows on a couple of projects. A fresh install ships
sample content; seeding never deletes it, and the owner decides on any cleanup.
