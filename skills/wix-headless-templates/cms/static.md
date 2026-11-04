# The content site on a static site

The pages are HTML files at the root of the site. They import the CMS layer from `/js/wix/`: the
Wix Data reads and writes, and two stores that hold the state and the rules of a listing and of
one item. Nothing on the screen ships; every element is yours, in the design of the site. This
file shows how to drive the layer. The skeletons show the calls and the fields and leave the
markup to you. The seed plan is the contract: collection ids and field keys are bound verbatim,
as the plan spells them.

## The layer

`/js/wix/items.js`: `queryItems(collectionId, { filters, sort, limit, skip, include, withTotal })`
returns `{ items, hasNext, total }`; `getItemBy(collectionId, field, value, { include })` and
`getItemById(collectionId, id, { include })` return an item or null; `countItems(collectionId,
filters)`; `distinctValues(collectionId, field, { filters, limit })`, the values of one field
across the collection, for filter chips; the writes `insertItem`, `updateItem`,
`patchItemFields`, `removeItem`, `linkItems`, `unlinkItems`. `/js/wix/collections.js`:
`getCollectionSchema(collectionId)` with the field types and the permissions.
`/js/wix/items-core.js`: `formatDate(iso)` for a date field. `/js/wix/media.js`: `imgSrc(url,
width, height)` for a sized copy of an image field.

An item is `_id` plus the collection's fields, flat on the item (`item.title`, never
`item.data.title`). Text fields are strings, numbers are numbers, dates are ISO strings, images
are https URLs at the photo's own aspect, rich text is an HTML string, tags are string arrays, a
reference holds an id unless the query passed `include`. An absent field is undefined: render
nothing for it.

Two stores: `createCollectionStore(options)` in `/js/wix/collection-store.js` for a listing and
`createItemStore(options)` in `/js/wix/item-store.js` for one item. A store owns the rules: which
query is current, which page is on screen, what a late response is worth. A page reads the state
and calls the actions; it computes nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

Reads work on a collection whose read permission is `ANYONE`; a write from the page succeeds
only where the seed opened that verb, and a 403 is a permissions step, not a code bug.

## The pattern

One shape for both stores: create it, subscribe a render function, render once, start. A store
calls the listener on every change and not on subscribe, so the first render is yours. Controls
call the store's actions; delegate from the surface's root and read what to do from the element,
so a re-render of the markup keeps the listeners.

```js
import { createCollectionStore } from "/js/wix/collection-store.js";

var store = createCollectionStore({ collectionId: "Articles", sort: [{ field: "publishedAt", direction: "desc" }], limit: 12 });
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The listing

One page per content collection, `<collection>.html`, on
`createCollectionStore({ collectionId, filters, sort, limit, include, withTotal })`. The state:
`items` (null on the first load, a loading state; never again after), `hasNext`, `hasPrev`,
`page`, `total` and `pageCount` (with `withTotal`), `loading`, `fetching` (a new query runs
behind the items on screen: dim them, never blank them), `loadingMore`, `error`. The actions:
`setQuery({ filters, sort })` (the same values keep the page, a change refetches page 0),
`loadMore()`, `goToPage(n)`, `refresh()` after a write, `retry()` after an error.

Filters, sort and paging run on Wix across the collection; the chips of a filter come from
`distinctValues`, never from the page in hand. A filter is `{ field, op, value }` with `op` one
of "eq", "ne", "gt", "ge", "lt", "le", "contains", "startsWith", "endsWith", "in", "hasSome",
"hasAll", "between", "isEmpty", "isNotEmpty"; `between` takes `[start, end]` and ends at the
first excluded value; a date comparand is a Date object. A numbered pager, when the brief asks
for pages, is `goToPage(n)` with `pageCount` from a store created with `withTotal: true`.

A card shows the plan's fields: the image through `imgSrc`, the title, a date through
`formatDate`, a summary, and a link to the item page by its slug. `items` null is the loading
state, `[]` an honest empty state, `error` its own; a load-more control while `hasNext`, disabled
while `loadingMore`.

```js
import { createCollectionStore } from "/js/wix/collection-store.js";
import { distinctValues } from "/js/wix/items.js";

var COLLECTION = "Articles"; // the plan's collection id, verbatim
var SORT = [{ field: "publishedAt", direction: "desc" }];
var store = createCollectionStore({ collectionId: COLLECTION, sort: SORT, limit: 12 });
var topics = [];
distinctValues(COLLECTION, "topic").then(function (values) { topics = values; renderChips(); });
chipsEl.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  var topic = b.dataset.topic || null;
  store.setQuery({ filters: topic ? [{ field: "topic", op: "eq", value: topic }] : [], sort: SORT });
});
moreEl.addEventListener("click", function () { store.loadMore(); });
store.subscribe(function (s) {
  moreEl.hidden = !s.hasNext;
  moreEl.disabled = s.loadingMore;
  // the grid from s.items with imgSrc and formatDate; states for null, [] and s.error; dim while s.fetching
});
store.start();
```

`renderChips` writes one control per value in `topics`, each with `data-topic`, and one for all,
only when there is more than one value.

## The item page

`item.html?slug=…` on `createItemStore({ collectionId, ref: { by: { field: "slug", value } },
include })`; `ref: { id }` for a lookup by `_id`. The state: `item` (null while loading and when
not found; `notFound` tells them apart), `loading`, `error`; the action `retry()`. A slug that
resolves to nothing shows only the not-found state.

The page shows the plan's fields: the title, a date through `formatDate`, the image through
`imgSrc`, a rich-text field as the `innerHTML` of one wrapper, tags as text, a reference field as
a full item only when `include` named it, so an id is never rendered as content. Set
`document.title` and the meta description from the item's fields once it loads.

```js
import { createItemStore } from "/js/wix/item-store.js";
import { formatDate } from "/js/wix/items-core.js";
import { imgSrc } from "/js/wix/media.js";

var slug = new URLSearchParams(location.search).get("slug") || "";
var store = createItemStore({ collectionId: "Articles", ref: { by: { field: "slug", value: slug } }, include: ["author"] });
function render(s) {
  if (s.notFound) { root.textContent = "This page does not exist."; return; }
  if (!s.item) { root.textContent = s.error || "Loading…"; return; }
  var it = s.item;
  document.title = it.title || document.title;
  var html = "<h1>" + esc(it.title) + "</h1>";
  if (it.publishedAt) html += "<p>" + esc(formatDate(it.publishedAt)) + "</p>";
  if (it.image) html += '<img src="' + imgSrc(it.image, 1400, 800) + '" alt="">';
  html += "<div data-body></div>";
  root.innerHTML = html;
  if (typeof it.body === "string") root.querySelector("[data-body]").innerHTML = it.body;
}
store.subscribe(render);
render(store.getState());
store.start();
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the collection; the rich-text
field is the one value that goes in through `innerHTML`.

The home page shows real items under truthful headings from `queryItems(collectionId, { limit })`,
with the same card, and one path into each collection.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/<collection>.html` for each listing, `/item.html?slug=…` for an item page (one item page per
collection with a slug field: `/article.html?slug=…`, `/project.html?slug=…`). A link to a folder
gives the visitor a 404 page. Write the pages' scripts as files of their own and keep each file
small; a page's code travels as text in the upload call.

## Rules

- Data goes through the layer's exports; the request shapes stay in the layer.
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
  `setQuery` and apply across the collection.
- A reference field holds ids unless the query passed `include`.
- Selling items goes through the storefront solution, not a collection.
- Live data or an honest empty state: no invented items or fields; no Wix ids or technical words
  in visible text.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the
  rest compact or text actions.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/wix-cms` lists the collections;
`https://manage.wix.com/dashboard/{siteId}/wix-cms/data/{collectionId}` opens one collection's
items, its fields, and its permissions under More Actions. The seed result lists the collection
ids.

## Seeding

Per `seed/SEED.md` and `seed/seed-cms.mjs`: a plain-data plan, run in the script's order with
its waits. The plan is the content model the pages bind to: a `slug` field per collection with an
item page, an image field with a verified URL per item, a date field when the content is
chronological, and the read permission the pages need.
