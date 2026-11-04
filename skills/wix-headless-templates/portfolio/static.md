# The portfolio on a static site

The pages are HTML files at the root of the site. They import the portfolio modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the gallery of collections, the collection page, the project page, the routes, the
rules and the seed.

## The modules

`/js/wix/portfolio.js`: `fetchCollections()`, `fetchCollectionBySlug(slug)`, `fetchProjects({ collectionId })`,
`fetchProjectBySlug(slug)`, `fetchProjectGallery(projectId)`. Every read is public; hidden items
are filtered and collections come in the owner's order. Images arrive as https URLs, videos as
playable mp4 URLs with a poster frame. `/js/wix/portfolio-core.js`: `mediaElement(item)` turns a
gallery item into `{ tag, attrs }` (an `img` or a `video` with its attributes) or null.
`/js/wix/media.js`: `imgSrc(url, width, height)` for a sized copy.
Three stores hold the state: `createCollectionsStore()` in `/js/wix/collections-store.js` (the
gallery), `createCollectionProjectsStore(slug)` in `/js/wix/collection-projects-store.js` (one
collection and its projects), `createProjectDetailStore(slug)` in `/js/wix/project-detail-store.js`
(one project and its gallery). Each `.js` opens with its declarations. A store calls a listener on
every change and not when it subscribes: render once after subscribing, then `start()`. The visitor
token persists in `localStorage` on its own; never mint one in a page.

## The gallery

`portfolio.html` renders the collections from `createCollectionsStore()`. The state:
`collections` (null on the first load: skeletons, not an empty state), `error`. A collection
card shows its own cover (`imageUrl`, "" when none: the page's placeholder) and `title`, and links
to the collection page. The home page shows real collections or projects under truthful headings
with the same cards. The examples follow the stores' declared interfaces.

```html
<div id="collections"></div>
<p id="gallery-status" hidden></p>
```

```js
import { createCollectionsStore } from "/js/wix/collections-store.js";
import { imgSrc } from "/js/wix/media.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const store = createCollectionsStore();
const grid = document.querySelector("#collections"), status = document.querySelector("#gallery-status");

function renderGallery(s) {
  if (s.collections === null) { grid.innerHTML = `<div class="card card--skeleton"></div>`.repeat(4); return; }
  grid.innerHTML = s.collections.map((c) => `
    <a class="card" href="/collection.html?slug=${encodeURIComponent(c.slug)}">
      ${c.imageUrl ? `<img class="card-cover" src="${imgSrc(c.imageUrl, 800, 600)}" alt="" loading="lazy">` : `<div class="card-cover card-cover--empty"></div>`}
      <h2 class="card-title">${esc(c.title)}</h2>
    </a>`).join("");
  status.hidden = !(s.error || s.collections.length === 0);
  status.textContent = s.error ? "The portfolio could not be loaded. Please try again." : s.collections.length === 0 ? "No collections yet." : "";
}
store.subscribe(renderGallery);
renderGallery(store.getState());
store.start();
```

## The collection page

`collection.html?slug=…` renders from `createCollectionProjectsStore(slug)`. The state:
`collection` (null while loading and when not found; `notFound` tells them apart), `projects`
(null while loading), `error`. The header is the collection's `title` and `description`, then
only its projects, each a card with `imageUrl` and `title` linking to the project page. A slug
that resolves to nothing shows the not-found state alone, with no header or empty grid around it.
`document.title` and the meta description come from the collection's `title` and `description`.

```html
<section id="collection"></section>
```

```js
import { createCollectionProjectsStore } from "/js/wix/collection-projects-store.js";
import { imgSrc } from "/js/wix/media.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const slug = new URLSearchParams(location.search).get("slug") ?? "";
const store = createCollectionProjectsStore(slug);
const root = document.querySelector("#collection");

const projectCard = (p) => `
  <a class="card" href="/project.html?slug=${encodeURIComponent(p.slug)}">
    ${p.imageUrl ? `<img class="card-cover" src="${imgSrc(p.imageUrl, 800, 600)}" alt="" loading="lazy">` : `<div class="card-cover card-cover--empty"></div>`}
    <h2 class="card-title">${esc(p.title)}</h2>
  </a>`;

function renderCollection(s) {
  if (s.notFound) { root.innerHTML = `<p class="not-found">This collection does not exist.</p>`; return; }
  if (!s.collection) { root.innerHTML = s.error ? `<p class="error">${esc(s.error)}</p>` : `<div class="header-skeleton"></div>`; return; }
  const c = s.collection;
  document.title = c.title;
  if (c.description) document.querySelector('meta[name="description"]')?.setAttribute("content", c.description);
  root.innerHTML = `
    <header class="collection-header"><h1>${esc(c.title)}</h1>${c.description ? `<p>${esc(c.description)}</p>` : ""}</header>
    <div class="grid">${s.projects === null ? `<div class="card card--skeleton"></div>`.repeat(4) : s.projects.map(projectCard).join("")}</div>
    ${s.projects && s.projects.length === 0 ? `<p class="empty">No projects in this collection yet.</p>` : ""}
    ${s.error && s.projects ? `<p class="error">${esc(s.error)}</p>` : ""}`;
}
store.subscribe(renderCollection);
renderCollection(store.getState());
store.start();
```

## The project page

`project.html?slug=…` renders from `createProjectDetailStore(slug)`. The state: `project` (null
while loading and when not found; `notFound` tells them apart), `items` (the gallery, null while
loading), `error`. The page shows `title`, `description` and the `details` rows (label and text,
a link when `url` is set, with its `target`) before the gallery. Gallery items come in the
dashboard's order; each becomes an element through `mediaElement(item)`, never through a branch
on `kind` in the page; the caption is `item.title` when present, and an item's `linkUrl` wraps it
when set. On a phone a gallery image is a bounded band. `document.title` and the meta description
come from `title` and `description`.

```html
<article id="project"></article>
```

```js
import { createProjectDetailStore } from "/js/wix/project-detail-store.js";
import { mediaElement } from "/js/wix/portfolio-core.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const slug = new URLSearchParams(location.search).get("slug") ?? "";
const store = createProjectDetailStore(slug);
const root = document.querySelector("#project");

function galleryFigure(item) {
  const el = mediaElement(item);
  if (!el) return null;
  const media = document.createElement(el.tag);
  for (const [name, value] of Object.entries(el.attrs)) media.setAttribute(name, String(value));
  const figure = document.createElement("figure");
  figure.className = `gallery-item gallery-item--${item.kind}`;
  if (item.linkUrl) { const a = document.createElement("a"); a.href = item.linkUrl; if (item.linkTarget) a.target = item.linkTarget; a.append(media); figure.append(a); }
  else figure.append(media);
  if (item.title) { const cap = document.createElement("figcaption"); cap.textContent = item.title; figure.append(cap); }
  return figure;
}

function renderProject(s) {
  if (s.notFound) { root.innerHTML = `<p class="not-found">This project does not exist.</p>`; return; }
  if (!s.project) { root.innerHTML = s.error ? `<p class="error">${esc(s.error)}</p>` : `<div class="header-skeleton"></div>`; return; }
  const p = s.project;
  document.title = p.title;
  if (p.description) document.querySelector('meta[name="description"]')?.setAttribute("content", p.description);
  root.innerHTML = `
    <header class="project-header">
      <h1>${esc(p.title)}</h1>
      ${p.description ? `<p class="project-description">${esc(p.description)}</p>` : ""}
      ${p.details.length ? `<dl class="project-details">${p.details.map((d) => `<dt>${esc(d.label)}</dt><dd>${d.url ? `<a href="${esc(d.url)}"${d.target ? ` target="${esc(d.target)}" rel="noopener"` : ""}>${esc(d.text)}</a>` : esc(d.text)}</dd>`).join("")}</dl>` : ""}
    </header>
    <div class="gallery">${s.items === null ? `<div class="gallery-skeleton"></div>` : ""}</div>
    ${s.items && s.items.length === 0 ? `<p class="empty">No media in this project yet.</p>` : ""}`;
  if (s.items) root.querySelector(".gallery").replaceChildren(...s.items.map(galleryFigure).filter(Boolean));
}
store.subscribe(renderProject);
renderProject(store.getState());
store.start();
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/portfolio.html`, `/collection.html?slug=…`, `/project.html?slug=…`. A link to a folder gives
the visitor a 404 page. One stylesheet and one script shared by the pages, or inline per page,
on one set of tokens.

## Rules

- Reads go through the module exports: they filter hidden items, keep the owner's order and
  resolve every media value. Media URLs arrive resolved; use them as they are.
- This solution sells nothing. A "contact about this project" call to action is a link.
- `notFound` is the not-found state and `error` shows as the error state; a null while loading
  is loading.
- `details` rows render as given, text or link per row.
- Gallery items render through `mediaElement`.
- Live data or an honest empty state: no invented clients, awards, dates or media; no Wix ids or
  technical words in visible text.

## The owner's links

The dashboard URL from the provisioning step, followed by `/wix-portfolio/projects`: Projects and
Collections are tabs on that page. Projects adds projects and their media galleries; Collections
groups them.

## Seeding

Per `seed/SEED.md` and `seed/seed-portfolio.mjs`: a plain-data plan, run in the script's order
with its waits. Seed collections and projects that exercise the pages: a cover on everything, two
or three gallery images per project, `details` rows on a couple of projects. A fresh install ships
sample content; seeding never deletes it, and the owner decides on any cleanup.
