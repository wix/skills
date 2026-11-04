# The storefront on a static site

The pages are HTML files at the root of the site. They import the storefront layer from
`/js/wix/`: the catalog and cart calls, and three stores that hold the state and the rules of a
shop. Nothing on the screen ships; every element is yours, in the design of the site. This file
shows how to drive the layer. The skeletons show the calls and the fields and leave the markup
to you.

## The layer

`/js/wix/catalog.js`: `searchCatalog`, `fetchFacetData`, `fetchProducts`,
`fetchProductsByCategory`, `fetchProductBySlug`, `fetchCategories`, `fetchCategoryBySlug`,
`fetchInventory`, `fetchBackInStockEnabled`, `requestBackInStock`. `/js/wix/cart.js` is the cart
transport; the pages reach it through the cart store. `/js/wix/media.js` gives `imgSrc(url,
width, height)` for a sized copy of an image. Money comes formatted and images come as https URLs;
render them as they are.

Three stores: `createShopStore` in `/js/wix/shop-store.js` for a listing, `createProductDetailStore`
in `/js/wix/product-detail-store.js` for one product, and `/js/wix/cart-store.js` for the cart,
one for the whole site. A store owns the rules: which choices are available with the current
picks, the price of the selection, the stock cap, why the add button is disabled, the cart's
totals. A page reads the state and calls the actions; it computes nothing of its own.

Every `.js` opens with its declarations: the state fields and the actions, with a comment on
each. Read the declarations of the store you are about to use.

## The pattern

One shape for every store: create it, subscribe a render function, render once, start.
A store calls the listener on every change and not on subscribe, so the first render is yours.

```js
import { createProductDetailStore } from "/js/wix/product-detail-store.js";

const store = createProductDetailStore({ slug: new URLSearchParams(location.search).get("slug") });
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

Controls call the store's actions. Delegate from the surface's root and read what to do from the
element, so a re-render of the markup keeps the listeners:

```js
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.option) store.selectOption(b.dataset.option, b.dataset.choice);
  else if (b.dataset.step) store.setQuantity(store.getState().quantity + Number(b.dataset.step));
  else if ("add" in b.dataset) store.add().catch(function () {});
});
```

The visitor token persists in `localStorage` on its own; never mint one in a page.

## The product page

`product.html?slug=…` on `createProductDetailStore({ slug })`. From the state:

- `product` is null while loading; `notFound` true means the slug resolves to nothing, and the
  page shows only the not-found state. `product` carries `name`, `descriptionHtml` (render as
  HTML), `gallery` (urls, main first), `infoSections` (title and html), `breadcrumbs` (Home, the
  category path, the product), `ribbons`, `modifiers`, `subscriptions`, `allowOneTimePurchase`.
- `price` is what to show at all times: the range until every option is picked, then the
  variant's price. `compareAtPrice` is the struck "was" when real; `pricePerUnit` when sold by
  unit. `imageUrl` is the picked choice's image when the merchant linked one; show it as the main
  image, else the gallery's first.
- `optionGroups`: one group per option, `name`, `isColor`, and `choices` with `choiceId`, `name`,
  `colorCode`, `selected`, `inStock`, `exists`. A choice with `inStock` or `exists` false is
  disabled. A colour option renders swatches from `colorCode`; any other renders chips.
  `selectOption(group.id, choice.choiceId)`.
- `product.modifiers`: `type` "choices" renders chips calling `setModifier(m.key, choice.key)`;
  `type` "text" renders a text field calling `setModifier(m.key, value)` on input, with
  `maxChars` when set. `modifierValues[m.key]` holds the value.
- `plans`: when the product is sold on plans, one chip per plan with its `name`, `terms` and
  `price`, `selected`; `selectPlan(plan.id)`, and `selectPlan(ONE_TIME_PLAN)` when
  `allowOneTimePurchase`.
- `quantity`, `setQuantity(n)`, `maxQuantity` as the stepper's ceiling; `remaining` is the units
  left when counted, worth a line when small.
- `canAdd` gates the add button; `blockedReason` is the neutral line beside it while disabled
  ("Choose Size"). `add()` adds the resolved variant and opens the cart; it rejects on refusal
  and `error` holds the message. `adding` while in flight. `isPreorder` labels the button
  "Pre-order" with `preorderMessage` under it.
- `canNotify` offers an email field for a sold-out item; `notify(email)`, `notifying`,
  `notifyResult` ("created" or "already-subscribed"), `notifyError`.

A sketch of the render, fields in, markup yours:

```js
function render(s) {
  if (!s.product) { root.textContent = s.notFound ? "This product is not available." : "Loading…"; return; }
  priceEl.textContent = s.price;
  compareEl.textContent = s.compareAtPrice || "";
  var html = "";
  s.optionGroups.forEach(function (g) {
    html += "<fieldset><legend>" + esc(g.name) + "</legend>";
    g.choices.forEach(function (c) {
      html += '<button type="button" data-option="' + g.id + '" data-choice="' + c.choiceId + '"'
        + (c.selected ? ' aria-pressed="true"' : ' aria-pressed="false"')
        + (!c.inStock || !c.exists ? " disabled" : "") + ">" + esc(c.name) + "</button>";
    });
    html += "</fieldset>";
  });
  html += '<button type="button" data-step="-1">−</button> ' + s.quantity + ' <button type="button" data-step="1">+</button>';
  html += '<button type="button" data-add' + (s.canAdd && !s.adding ? "" : " disabled") + ">" + (s.adding ? "Adding…" : s.isPreorder ? "Pre-order" : "Add to cart") + "</button>";
  if (s.blockedReason && !s.canAdd) html += "<p>" + esc(s.blockedReason) + "</p>";
  if (s.error) html += '<p role="alert">' + esc(s.error) + "</p>";
  root.innerHTML = html;
}
```

`esc` escapes `&`, `<`, `>` and `"` in anything that came from the catalog. Set `document.title`
from `product.name` once it loads, and the meta description from the first line of its text.

## The cart

`/js/wix/cart-store.js` is one store for the whole site. `subscribeCart(fn)` loads the cart on its
first call; `getCartState()` reads it. The state: `cart` (null before the first load), `open`,
`busy` (an operation in flight: disable the cart's controls), `pendingProductId` (the product
whose add is in flight: disable that tile's control, not the others), `error` (the last failed
operation's message; show it in the cart). `cart` carries `lines`, `itemCount`, `subtotal`,
`discounts`, `fees`, `taxes`, `pricesIncludeTax`, `total`, `coupon`, `note`. A line carries
`lineItemId` (what the actions take, never the product id), `productName`, `descriptionLines`,
`quantity`, `availableQuantity` (the stepper's cap when not null), `unitPrice`, `linePrice`,
`compareAtLinePrice`, `imageUrl`, `status` (anything but "IN_STOCK" needs a line of copy),
`subscription`.

The actions: `setCartOpen(true|false)`, `updateLineQuantity(lineItemId, n)`,
`removeCartLine(lineItemId)`, `applyCartCoupon(code)`, `removeCartCoupon()`, `setCartNote(text)`,
`goToCheckout()`. `addLine(productId, variantId, quantity)` is the tile's direct add.

The store opens the cart after every add, on success and on refusal, so `error` has a place to
show. Render `open` as a drawer or a panel: a fixed backdrop and panel, the page's scroll locked
while open, closed by Escape, a close control and a click on the backdrop, focus moved in and
returned on close. A cart page is the same render in the page flow when the brief asks for one.
Totals come from `cart`, never summed in the page; shipping reads "calculated at checkout", taxes
too unless `taxes` has rows or `pricesIncludeTax`. Checkout is the one primary action of the cart;
the steppers, remove and the coupon controls are compact.

The header's cart control:

```js
import { subscribeCart, setCartOpen } from "/js/wix/cart-store.js";

cartButton.addEventListener("click", function () { setCartOpen(true); });
subscribeCart(function (s) {
  var n = s.cart ? s.cart.itemCount : 0;
  countEl.textContent = n ? String(n) : "";
});
```

The cart's render, in the same shape as the product page's, driven by `subscribeCart`:

```js
subscribeCart(function (s) {
  backdrop.hidden = !s.open;
  errorEl.textContent = s.error || "";
  var lines = s.cart ? s.cart.lines : [];
  // one block per line: name, descriptionLines, linePrice, a stepper with data-line and
  // data-quantity, a remove control with data-line; then the totals and the checkout control
});
```

## The listing

`shop.html` on `createShopStore()`; `category.html?slug=…` resolves the slug with
`fetchCategoryBySlug` first (null is the not-found state) and passes `initialCategoryId`. The
state: `products` (null on the first load; the previous page while `loading` during a change,
dim it rather than blank it), `total`, `categories`, `sort`, `facets`, `priceRange`,
`selectedChoiceIds`, `hasActiveFilters`, `loading`, `error`, `hasMore`, `loadingMore`. The
actions: `setSort(key)`, `setFilters({ minPrice, maxPrice, inStockOnly, search })`,
`toggleChoice(choiceId)`, `clearFilters()`, `retry()`, `loadMore()`. `SORTS`, exported beside
the store, is an object keyed by sort whose values carry `label`. Sort, filters, facets and paging
run on Wix across the whole catalog, and the selection mirrors into the query string on its own.

A listing renders the result count, a sort control, the facets (one group per facet, each choice
with its `count`, swatches when `isColor`), a price pair bounded by `priceRange`, a clear control
when `hasActiveFilters`, the grid, a load-more control while `hasMore`, and states that look
different for loading, empty, no results and error with a retry.

Each tile shows the summary: `imageUrl` (`hoverImageUrl` on hover), `name`, the price, every
ribbon in `ribbons`, `discountNames` under the price, `swatches` as dots, `optionsSummary`. The
price reads "From {price}" when `fromPrice`, "{price} – {maxPrice}" when they differ, else `price`
with `compareAtPrice` struck beside it. Nothing is computed from these fields: no percent off, no
sale badge inferred, no struck price beside a range.

The tile's add control follows the summary: `availability` "OUT_OF_STOCK" links to the product
page; `hasSubscriptions` links to the product page; `quickAddable` adds in one click with
`addLine(p.id, p.minPriceVariantId, 1)`, disabled while `pendingProductId` is this product; any
other product links to the product page to pick its options. A picker on the tile is an option:
the product page's render on `createProductDetailStore({ slug: p.slug })` inside a panel with the
cart's overlay rules.

```js
import { createShopStore, SORTS } from "/js/wix/shop-store.js";

var shop = createShopStore();
Object.keys(SORTS).forEach(function (key) { sortEl.add(new Option(SORTS[key].label, key)); });
sortEl.addEventListener("change", function () { shop.setSort(sortEl.value); });
moreEl.addEventListener("click", function () { shop.loadMore(); });
shop.subscribe(function (s) {
  countEl.textContent = s.total === null ? "" : s.total + " products";
  moreEl.hidden = !s.hasMore;
  // facets from s.facets with data-choice → shop.toggleChoice; the grid from s.products
});
shop.start();
```

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/shop.html`, `/product.html?slug=…`, `/category.html?slug=…`, `/cart.html` when the brief wants a
cart page. A link to a folder gives the visitor a 404 page. Every page declares its charset in the
head; the host sends none. Write the pages' scripts as files of their own and keep each file small;
a page's code travels as text in the upload call.

## Rules

- Data and commerce go through the layer's exports. Extend by calling them; the request shapes
  stay in the layer.
- A product with options is added through the detail store, never by picking a variant in the
  page; a product with no options is added from the tile.
- Checkout only through `goToCheckout()`.
- Live data or an honest empty state: no invented products, prices, reviews, counts or delivery
  promises; no Wix ids or technical words in visible text.
- Cart totals come from the cart state.
- Browsing, cart and checkout need no login; the visitor session is already there.
- Sort and filter at the source: the shop store and `searchCatalog`, never on the array a page
  already holds.
- Render form inputs once; a render touches their values, the button and the error, not the inputs.
- Every control on the page has a rule in the stylesheet; one primary action per surface, the rest
  compact or text actions.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `wix-stores/products` (products),
`wix-stores/categories/list`, `wix-stores/inventory`, `ecom-platform/orders-list`,
`wix-stores/settings`, `wix-cashier/payments` (connect a payment method); the plan upgrade is
`https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Real payments need a connected
payment method and a premium plan; until then hosted checkout tells the visitor the store cannot
accept online payments yet. Give both links in the close.

## Seeding

Per `seed/SEED.md` and `seed/seed-storefront.mjs`: a plain-data plan, run in the script's order
with its waits. Seed a catalog that exercises the storefront (a product with a colour option, one
on sale, an image per product) unless the brief says otherwise. A fresh Stores install may carry
Wix's sample catalog; never delete it or anything else on the site, and name it in the close with
the products link so the owner removes it there.
