# The content site on a static site

The pages are HTML files at the root of the site. They import the CMS modules from `/js/wix/`
and render the collections the seed plan created. This file is the whole playbook for that path:
the modules, the listing, the item page, the routes, the rules and the seed. The seed plan is
the contract: collection ids and field keys are bound verbatim, as the plan spells them.

## The modules

`/js/wix/items.js`: `queryItems(collectionId, { filters, sort, limit, skip, include, withTotal })`
returns `{ items, hasNext, total }`; `getItemBy(collectionId, field, value, { include })` and
`getItemById(collectionId, id, { include })` return an item or null; `countItems`,
`distinctValues` (the values of one field across the collection, for filter chips); the writes
`insertItem`, `updateItem`, `patchItemFields`, `removeItem`, `linkItems`, `unlinkItems`.
`/js/wix/collections.js`: `getCollectionSchema(collectionId)` with the field types and the
permissions. `/js/wix/items-core.js`: `formatDate(iso)` for a date field. `/js/wix/media.js`:
`imgSrc(url, width, height)` for a sized copy of an image field.
An item is `_id` plus the collection's fields, flat on the item (`item.title`, never `item.data.title`).
Text fields are strings, numbers are numbers, dates are ISO strings, images are https URLs at the
photo's own aspect, rich text is an HTML string, tags are string arrays, a reference holds an id
unless the query passed `include`. An absent field is undefined: render nothing for it.
Two stores hold the state and the rules: `createCollectionStore` in `/js/wix/collection-store.js`
(a listing) and `createItemStore` in `/js/wix/item-store.js` (one item). Each `.js` opens with
its declarations. A store calls a listener on every change and not when it subscribes: render once
after subscribing, then `start()`. The visitor token persists in `localStorage` on its own; never
mint one in a page. Reads work on a collection whose read permission is `ANYONE`; a write from
the page succeeds only where the seed opened that verb, and a 403 is a permissions step, not a
code bug.

## The listing

One page per content collection, `<collection>.html`, renders from
`createCollectionStore({ collectionId, filters, sort, limit, include, withTotal })`. The state:
`items` (null on the first load: skeletons, never again after), `hasNext`, `hasPrev`, `page`,
`total` and `pageCount` (with `withTotal`), `loading`, `fetching` (a new query runs behind the
items on screen: dim them), `loadingMore`, `error`. The actions: `setQuery({ filters, sort })`
(same values keep the page, a change refetches page 0), `loadMore()`, `goToPage(n)`,
`refresh()` after a write, `retry()` after an error. Filters, sort and paging run on Wix across
the collection; the chips of a filter come from `distinctValues`, never from the page in hand. The
example follows the store's declared interface; the field keys are the plan's.

```html
<div id="filters"></div>
<div id="items"></div>
<p id="list-status" hidden></p>
<button id="load-more" type="button" hidden>Load more</button>
```

```js
import { createCollectionStore } from "/js/wix/collection-store.js";
import { distinctValues } from "/js/wix/items.js";
import { formatDate } from "/js/wix/items-core.js";
import { imgSrc } from "/js/wix/media.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const COLLECTION = "Articles"; // the plan's collection id, verbatim
const store = createCollectionStore({ collectionId: COLLECTION, sort: [{ field: "publishedAt", direction: "desc" }], limit: 12 });
const filters = document.querySelector("#filters"), grid = document.querySelector("#items");
const status = document.querySelector("#list-status"), more = document.querySelector("#load-more");
let topic = null;

more.addEventListener("click", () => store.loadMore().catch(() => {}));
filters.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-topic]");
  if (!b) return;
  topic = b.dataset.topic || null;
  store.setQuery({ filters: topic ? [{ field: "topic", op: "eq", value: topic }] : [], sort: [{ field: "publishedAt", direction: "desc" }] });
  renderFilters();
});
let topics = [];
distinctValues(COLLECTION, "topic").then((values) => { topics = values; renderFilters(); }).catch(() => {});
function renderFilters() {
  filters.innerHTML = topics.length > 1 ? [`<button type="button" class="chip${topic ? "" : " chip--selected"}" data-topic="">All</button>`,
    ...topics.map((t) => `<button type="button" class="chip${t === topic ? " chip--selected" : ""}" data-topic="${esc(t)}">${esc(t)}</button>`)].join("") : "";
}

const card = (item) => `
  <article class="card">
    ${item.image ? `<a href="/item.html?slug=${encodeURIComponent(item.slug)}"><img src="${imgSrc(item.image, 600, 450)}" alt="" loading="lazy"></a>` : `<div class="card-placeholder"></div>`}
    <h2><a href="/item.html?slug=${encodeURIComponent(item.slug)}">${esc(item.title)}</a></h2>
    ${item.publishedAt ? `<time datetime="${item.publishedAt}">${formatDate(item.publishedAt)}</time>` : ""}
    ${item.summary ? `<p>${esc(item.summary)}</p>` : ""}
  </article>`;

function renderList(s) {
  if (s.items === null) { grid.innerHTML = `<div class="card card--skeleton"></div>`.repeat(6); return; }
  grid.innerHTML = s.items.map(card).join("");
  grid.classList.toggle("is-fetching", s.fetching);
  status.hidden = !(s.error || s.items.length === 0);
  status.textContent = s.error ? "The content could not be loaded. Please try again." : s.items.length === 0 ? "Nothing here yet." : "";
  more.hidden = !s.hasNext;
  more.disabled = s.loadingMore;
}
store.subscribe(renderList);
renderList(store.getState());
store.start();
```

A numbered pager, when the brief asks for pages, is `goToPage(n)` with `pageCount` from a store
created with `withTotal: true`.

## The item page

`item.html?slug=…` renders from `createItemStore({ collectionId, ref: { by: { field: "slug", value } }, include })`
(`ref: { id }` for a lookup by `_id`). The state: `item` (null while loading and when not found;
`notFound` tells them apart), `loading`, `error`; the action `retry()`. A rich-text field is
HTML, set as the `innerHTML` of one wrapper; a date goes through `formatDate`; a reference field
is a full item only when `include` named it, so an id is never rendered as content. The page
sets `document.title` and the meta description from the item's fields once it loads. A slug that
resolves to nothing shows only the not-found state.

```html
<article id="item"></article>
```

```js
import { createItemStore } from "/js/wix/item-store.js";
import { formatDate } from "/js/wix/items-core.js";
import { imgSrc } from "/js/wix/media.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const slug = new URLSearchParams(location.search).get("slug") ?? "";
const store = createItemStore({ collectionId: "Articles", ref: { by: { field: "slug", value: slug } }, include: ["author"] });
const root = document.querySelector("#item");

function renderItem(s) {
  if (s.notFound) { root.innerHTML = `<p class="not-found">This page does not exist.</p>`; return; }
  if (!s.item) { root.innerHTML = s.error ? `<p class="error">${esc(s.error)}</p>` : `<div class="item-skeleton"></div>`; return; }
  const it = s.item;
  document.title = it.title ?? document.title;
  if (it.summary) document.querySelector('meta[name="description"]')?.setAttribute("content", it.summary);
  root.innerHTML = `
    <header>
      <h1>${esc(it.title)}</h1>
      <p class="meta">${it.publishedAt ? `<time datetime="${it.publishedAt}">${formatDate(it.publishedAt)}</time>` : ""}${it.author?.name ? ` · ${esc(it.author.name)}` : ""}</p>
      ${it.image ? `<img class="item-cover" src="${imgSrc(it.image, 1400, 800)}" alt="">` : ""}
    </header>
    <div class="item-body"></div>
    ${Array.isArray(it.tags) && it.tags.length ? `<p class="tags">${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</p>` : ""}`;
  if (typeof it.body === "string") root.querySelector(".item-body").innerHTML = it.body; // a RICH_TEXT field is HTML
}
store.subscribe(renderItem);
renderItem(store.getState());
store.start();
```

The home page shows real items under truthful headings from `queryItems(collectionId, { limit })`,
with the same card, and one path into each collection.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/<collection>.html` for each listing, `/item.html?slug=…` for an item page (one item page per
collection with a slug field: `/article.html?slug=…`, `/project.html?slug=…`). A link to a folder
gives the visitor a 404 page. One stylesheet and one script shared by the pages, or inline per
page, on one set of tokens.

## Rules

- Data goes through the module exports; the request shapes stay in the modules.
- The id is `_id` and fields are flat on the item; bind the plan's collection ids and field keys
  verbatim. A mistyped key reads as a blank, not an error.
- An empty read on a public collection is a seed permissions matter: the read permission is
  `ANYONE`. On a member-scoped collection an empty anonymous read is the gate working.
- `updateItem` replaces the whole item; `patchItemFields` changes named fields. A date on a
  write is a Date object. A multi-reference is written with `linkItems`, never through the item.
- After a write, `refresh()` the listing; Wix Data is eventually consistent.
- Rich text is HTML on a wrapper's `innerHTML`; dates go through `formatDate`; images through
  `imgSrc`; an absent image field gets the page's placeholder.
- Page at the source: `loadMore()` and `goToPage(n)` fetch from Wix; filters and sort go through
  `setQuery` and apply across the collection. `between` ends at the first excluded value.
- A reference field holds ids unless the query passed `include`.
- Selling items goes through the storefront solution, not a collection.
- Live data or an honest empty state: no invented items or fields; no Wix ids or technical words
  in visible text.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/wix-cms` lists the collections;
`https://manage.wix.com/dashboard/{siteId}/wix-cms/data/{collectionId}` opens one collection's
items, its fields, and its permissions under More Actions. The seed result lists the collection ids.

## Seeding

Per `seed/SEED.md` and `seed/seed-cms.mjs`: a plain-data plan, run in the script's order with
its waits. The plan is the content model the pages bind to: a `slug` field per collection with an
item page, an image field with a verified URL per item, a date field when the content is
chronological, and the read permission the pages need.
