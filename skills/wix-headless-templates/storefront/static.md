# The storefront on a static site

The pages are HTML files at the root of the site. They import the storefront modules from
`/js/wix/` and render what the modules return. This file is the whole playbook for that path: the
modules, the purchase controls, the listing, the item pages, the rules and the seed.

## The modules

`/js/wix/catalog.js`: `searchCatalog`, `fetchFacetData`, `fetchProducts`, `fetchProductBySlug`,
`fetchCategories`, `fetchCategoryBySlug`, `fetchInventory`, `resolveVariant`. Money comes
formatted, images come as https URLs; `/js/wix/media.js` gives `imgSrc(url, width, height)` for a
sized copy. `/js/wix/cart.js` is the cart transport; the pages use it through the cart store.
Three stores hold the state and the rules: `createShopStore` in `/js/wix/shop-store.js` (the
listing), `createProductDetailStore` in `/js/wix/product-detail-store.js` (one product), and
`/js/wix/cart-store.js` (the cart, one for the whole site: `subscribeCart`, `getCartState`,
`addLine`, `updateLineQuantity`, `removeCartLine`, `applyCartCoupon`, `removeCartCoupon`,
`setCartNote`, `goToCheckout`, `setCartOpen`). Each `.js` opens with its declarations. A store
calls a listener on every change and not when it subscribes: render once after subscribing.
The visitor token persists in `localStorage` on its own; never mint one in a page.

## The purchase controls

The purchase controls are yours to write, on the stores: the cart button, the cart drawer, the buy
controls of the product page and the add control of each tile. Each one is markup in your page,
a render function that reads a store's state, and listeners that call the store's actions. The
stores hold every rule: which choices are available with the current picks, the price of the
selection, the stock cap, why the button is disabled, the cart's totals. The page holds the markup
and the stylesheet, so every element on the screen is one you wrote and styled, in the design of
the site. The four examples are complete and tested. Keep their store calls and the field names
they read; the markup, the classes and the words are yours.

**The cart button**, in the header of every page. `subscribeCart` loads the cart on its first call.

```html
<button id="cart-button" type="button">Bag <span class="cart-count" hidden></span></button>
```

```js
import { subscribeCart, setCartOpen } from "/js/wix/cart-store.js";
const cartButton = document.querySelector("#cart-button");
const cartCount = cartButton.querySelector(".cart-count");
cartButton.addEventListener("click", () => setCartOpen(true));
subscribeCart((s) => {
  const n = s.cart?.itemCount ?? 0;
  cartCount.textContent = String(n);
  cartCount.hidden = n === 0;
});
```

**The cart drawer**, once per page, at the end of `body`. The store opens it after every add,
on success and on refusal, so the error has a place to show. The backdrop and the drawer are
`position: fixed`; the page stops scrolling while it is open; Escape, the close button and a
click on the backdrop close it; focus moves into the drawer and back on close. Checkout is the one
primary button; the steppers, remove and the coupon controls are compact, styled by their classes.

```html
<div id="cart" class="cart-backdrop" hidden>
  <aside class="cart-drawer" role="dialog" aria-modal="true" aria-label="Cart" tabindex="-1">
    <header class="cart-header"><h2>Cart <span class="cart-title-count"></span></h2>
      <button class="cart-close" type="button" aria-label="Close">×</button></header>
    <p class="cart-error" role="alert" hidden></p>
    <div class="cart-lines"></div>
    <div class="cart-extras" hidden>
      <form class="cart-coupon"><input name="code" placeholder="Promo code" autocomplete="off">
        <button type="submit">Apply</button></form>
      <p class="cart-coupon-applied" hidden></p>
      <label class="cart-note">Note to seller <textarea name="note" rows="2"></textarea></label>
    </div>
    <footer class="cart-footer" hidden>
      <div class="cart-totals"></div>
      <p class="cart-shipping"></p>
      <button class="cart-checkout" type="button">Checkout</button>
    </footer>
  </aside>
</div>
```

```js
import {
  getCartState, subscribeCart, setCartOpen, updateLineQuantity, removeCartLine,
  applyCartCoupon, removeCartCoupon, setCartNote, goToCheckout,
} from "/js/wix/cart-store.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const backdrop = document.querySelector("#cart");
const drawer = backdrop.querySelector(".cart-drawer");
const q = (sel) => backdrop.querySelector(sel);
const lines = q(".cart-lines"), extras = q(".cart-extras"), footer = q(".cart-footer");
const coupon = q(".cart-coupon"), couponApplied = q(".cart-coupon-applied"), note = q(".cart-note textarea");
let wasOpen = false, opener = null, pageOverflow = "";

q(".cart-close").addEventListener("click", () => setCartOpen(false));
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) setCartOpen(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && getCartState().open) setCartOpen(false); });
lines.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-line]");
  if (!b) return;
  if (b.dataset.quantity) updateLineQuantity(b.dataset.line, Number(b.dataset.quantity)).catch(() => {});
  else removeCartLine(b.dataset.line).catch(() => {});
});
coupon.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = coupon.elements.code.value.trim();
  if (code) applyCartCoupon(code).then(() => coupon.reset()).catch(() => {});
});
couponApplied.addEventListener("click", (e) => { if (e.target.closest("button")) removeCartCoupon().catch(() => {}); });
note.addEventListener("change", () => setCartNote(note.value).catch(() => {}));
q(".cart-checkout").addEventListener("click", () => goToCheckout().catch(() => {}));

const lineStatus = (l) => ({
  PARTIALLY_IN_STOCK: l.availableQuantity === null ? "Not all of this quantity is available" : `Only ${l.availableQuantity} available`,
  OUT_OF_STOCK: "Out of stock",
  REMOVED_FROM_CATALOG: "No longer available",
})[l.status] ?? "";

function renderCart(s) {
  if (s.open !== wasOpen) {
    wasOpen = s.open;
    backdrop.hidden = !s.open;
    if (s.open) { opener = document.activeElement; pageOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; drawer.focus(); }
    else { document.body.style.overflow = pageOverflow; opener?.focus?.(); }
  }
  const cart = s.cart, list = cart?.lines ?? [];
  q(".cart-title-count").textContent = cart?.itemCount ? `(${cart.itemCount})` : "";
  q(".cart-error").textContent = s.error ?? "";
  q(".cart-error").hidden = !s.error;
  extras.hidden = footer.hidden = list.length === 0;
  if (list.length === 0) { lines.innerHTML = `<p class="cart-empty">Your cart is empty.</p>`; return; }
  lines.innerHTML = list.map((l) => `
    <article class="cart-line" data-status="${l.status}">
      ${l.imageUrl ? `<img class="cart-line-image" src="${l.imageUrl}" alt="" loading="lazy">` : `<div class="cart-line-image"></div>`}
      <div class="cart-line-info">
        <p class="cart-line-name">${esc(l.productName)}</p>
        ${l.descriptionLines.map((d) => `<p class="cart-line-option">${esc(d)}</p>`).join("")}
        ${l.subscription ? `<p class="cart-line-plan">${esc(l.subscription)}</p>` : ""}
        ${lineStatus(l) ? `<p class="cart-line-status">${lineStatus(l)}</p>` : ""}
        <div class="cart-line-controls">
          <span class="cart-stepper">
            <button type="button" data-line="${l.lineItemId}" data-quantity="${l.quantity - 1}" aria-label="Decrease" ${l.quantity <= 1 ? "disabled" : ""}>−</button>
            <span class="cart-stepper-value">${l.quantity}</span>
            <button type="button" data-line="${l.lineItemId}" data-quantity="${l.quantity + 1}" aria-label="Increase" ${l.availableQuantity !== null && l.quantity >= l.availableQuantity ? "disabled" : ""}>+</button>
          </span>
          <button class="cart-line-remove" type="button" data-line="${l.lineItemId}">Remove</button>
        </div>
      </div>
      <p class="cart-line-price">${esc(l.linePrice)}${l.compareAtLinePrice ? ` <s>${esc(l.compareAtLinePrice)}</s>` : ""}</p>
    </article>`).join("");
  coupon.hidden = !!cart.coupon;
  couponApplied.hidden = !cart.coupon;
  if (cart.coupon) couponApplied.innerHTML = `Code ${esc(cart.coupon.code)} <button type="button">Remove</button>`;
  if (document.activeElement !== note) note.value = cart.note;
  q(".cart-totals").innerHTML = [
    ["Subtotal", cart.subtotal],
    ...cart.discounts.map((d) => [d.name || "Discount", `−${d.amount}`]),
    ...cart.fees.map((f) => [f.name || "Fee", f.amount]),
    ...(cart.pricesIncludeTax ? [] : cart.taxes.map((t) => [t.name || "Tax", t.amount])),
    ["Total", cart.total],
  ].filter(([, v]) => v).map(([k, v]) => `<div class="cart-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
  q(".cart-shipping").textContent = cart.pricesIncludeTax || cart.taxes.length ? "Shipping is calculated at checkout." : "Shipping and taxes are calculated at checkout.";
  for (const el of extras.querySelectorAll("button, input, textarea")) el.disabled = s.busy;
  q(".cart-checkout").disabled = s.busy;
  if (s.busy) for (const b of lines.querySelectorAll("button")) b.disabled = true;
}
subscribeCart(renderCart);
renderCart(getCartState());
```

**The buy controls of the product page**, on `createProductDetailStore({ slug })`. The store
resolves the variant from the picks and judges each choice against the others: a choice with
`inStock` or `exists` false is disabled. The add button is the one primary button; the choices are
chips, or swatches for a colour option; the stepper is one compact inline group.

```html
<div id="buy"></div>
```

```js
import { createProductDetailStore, ONE_TIME_PLAN } from "/js/wix/product-detail-store.js";

const store = createProductDetailStore({ slug: new URLSearchParams(location.search).get("slug") });
const buy = document.querySelector("#buy");

buy.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.option) store.selectOption(d.option, d.choice);
  else if (d.modifier) store.setModifier(d.modifier, d.choice);
  else if (d.plan) store.selectPlan(d.plan);
  else if (d.step) store.setQuantity(store.getState().quantity + Number(d.step));
  else if ("add" in d) store.add().catch(() => {});
  else if ("notify" in d) store.notify(buy.querySelector("input[type=email]").value).catch(() => {});
});
buy.addEventListener("input", (e) => { if (e.target.dataset.text) store.setModifier(e.target.dataset.text, e.target.value); });

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const chip = (attrs, label, on, off, extra = "") => `<button type="button" class="chip${extra}${on ? " chip--selected" : ""}" aria-pressed="${on}" ${off ? "disabled" : ""} ${attrs}>${label}</button>`;

function renderBuy(s) {
  if (!s.product) { buy.innerHTML = `<p>${s.notFound ? "This product is not available." : "Loading…"}</p>`; return; }
  const active = document.activeElement, textKey = active?.dataset?.text, caret = active?.selectionStart;
  buy.innerHTML = `
    ${s.optionGroups.map((g) => `<fieldset class="group"><legend>${esc(g.name)}</legend>${g.choices.map((ch) =>
      g.isColor && ch.colorCode
        ? chip(`data-option="${g.id}" data-choice="${ch.choiceId}" style="background:${ch.colorCode}" aria-label="${esc(ch.name)}" title="${esc(ch.name)}"`, "", ch.selected, !ch.inStock || !ch.exists, " chip--swatch")
        : chip(`data-option="${g.id}" data-choice="${ch.choiceId}"`, esc(ch.name), ch.selected, !ch.inStock || !ch.exists)).join("")}</fieldset>`).join("")}
    ${s.product.modifiers.map((m) => m.type === "choices"
      ? `<fieldset class="group"><legend>${esc(m.title)}</legend>${m.choices.map((ch) => chip(`data-modifier="${m.key}" data-choice="${ch.key}"`, esc(ch.name), s.modifierValues[m.key] === ch.key, false)).join("")}</fieldset>`
      : `<label class="group">${esc(m.title)}${m.maxChars ? ` <small>${(s.modifierValues[m.key] ?? "").length}/${m.maxChars}</small>` : ""}
           <textarea data-text="${m.key}" rows="2" ${m.maxChars ? `maxlength="${m.maxChars}"` : ""}>${esc(s.modifierValues[m.key] ?? "")}</textarea></label>`).join("")}
    ${s.plans.length ? `<fieldset class="group"><legend>Purchase</legend>
      ${s.product.allowOneTimePurchase ? chip(`data-plan="${ONE_TIME_PLAN}"`, `One-time ${s.variant?.price ?? ""}`, s.subscriptionPlanId === ONE_TIME_PLAN, false) : ""}
      ${s.plans.map((p) => chip(`data-plan="${p.id}"`, `${esc(p.name)} ${p.price} <small>${esc(p.terms)}</small>`, p.selected, false)).join("")}</fieldset>` : ""}
    <div class="actions">
      <span class="stepper">
        <button type="button" data-step="-1" aria-label="Decrease" ${s.quantity <= 1 || s.adding ? "disabled" : ""}>−</button>
        <span class="stepper-value">${s.quantity}</span>
        <button type="button" data-step="1" aria-label="Increase" ${s.quantity >= s.maxQuantity || s.adding ? "disabled" : ""}>+</button>
      </span>
      <button type="button" class="add" data-add aria-busy="${s.adding}" ${s.canAdd && !s.adding ? "" : "disabled"}>${s.adding ? "Adding…" : s.isPreorder ? "Pre-order" : "Add to cart"}</button>
    </div>
    ${s.remaining !== null && s.remaining > 0 && s.remaining <= 10 && s.canAdd && !s.isPreorder ? `<p class="note">Only ${s.remaining} left</p>` : ""}
    ${s.isPreorder && s.preorderMessage ? `<p class="note">${esc(s.preorderMessage)}</p>` : ""}
    ${s.blockedReason && !s.canAdd ? `<p class="reason">${esc(s.blockedReason)}</p>` : ""}
    ${s.error ? `<p class="error" role="alert">${esc(s.error)}</p>` : ""}
    ${s.canNotify && !s.notifyResult ? `<div class="notify"><label>Notify me when it's back <input type="email" autocomplete="email"></label>
      <button type="button" data-notify ${s.notifying ? "disabled" : ""}>${s.notifying ? "Saving…" : "Notify me"}</button>
      ${s.notifyError ? `<p class="error" role="alert">${esc(s.notifyError)}</p>` : ""}</div>` : ""}
    ${s.notifyResult ? `<p class="note" role="status">${s.notifyResult === "created" ? "We'll email you when it's back in stock." : "You're already on the list for this item."}</p>` : ""}`;
  if (textKey) { const t = buy.querySelector(`[data-text="${textKey}"]`); t?.focus(); t?.setSelectionRange(caret, caret); }
}
store.subscribe(renderBuy);
renderBuy(store.getState());
store.start();
```

**The add control of each tile**, the last row of the tile's text. The summary decides it: a
sold-out product links to its page, a product sold on plans links to its page, a `quickAddable`
product adds its cheapest variant in one click, every other product links to its page to pick
its options. The tile whose add is in flight is disabled through `pendingProductId`; the store
opens the drawer when the add returns. A picker on the tile is an option: the buy controls above
on `createProductDetailStore({ slug: product.slug })` in a panel with the drawer's overlay rules.

```js
import { addLine, subscribeCart } from "/js/wix/cart-store.js";

const productUrl = (p) => `/product.html?slug=${encodeURIComponent(p.slug)}`;
function tileControl(p) {
  if (p.availability === "OUT_OF_STOCK") return `<a class="tile-link" href="${productUrl(p)}">Sold out</a>`;
  if (p.hasSubscriptions) return `<a class="tile-link" href="${productUrl(p)}">Choose a plan</a>`;
  if (p.quickAddable) return `<button class="tile-add" type="button" data-add="${p.id}" data-variant="${p.minPriceVariantId ?? ""}">${p.preorder ? "Pre-order" : "Add to cart"}</button>`;
  return `<a class="tile-link" href="${productUrl(p)}">Choose options</a>`;
}
const grid = document.querySelector("#products");
grid.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-add]");
  if (b) addLine(b.dataset.add, b.dataset.variant || null, 1).catch(() => {});
});
subscribeCart((s) => {
  for (const b of grid.querySelectorAll("button[data-add]")) {
    const busy = s.pendingProductId === b.dataset.add;
    b.disabled = busy;
    b.setAttribute("aria-busy", String(busy));
  }
});
```

## The listing

`shop.html` and `category.html?slug=…` render one grid from `createShopStore()`: one render
function that reads `getState()`, called from `subscribe`, then `start()`. The category page
resolves the slug with `fetchCategoryBySlug` first (null is the not-found state, nothing else on
the page) and passes `initialCategoryId` to the store. The state: `products` (null on the first
load, the previous page while `loading` during a change), `total`, `categories`, `sort` with
`SORTS` (an object keyed by sort, render `SORTS[key].label`), `filters`, `facets`,
`priceRange`, `selectedChoiceIds`, `hasActiveFilters`, `loading`, `error`, `hasMore`,
`loadingMore`. The actions: `setSort`, `setFilters({ minPrice, maxPrice, inStockOnly, search })`,
`toggleChoice(choiceId)`, `clearFilters`, `retry`, `loadMore`. Sort, filters, facets and paging
run on Wix across the whole catalog, and the selection mirrors into the query string on its own.
Render the result count, a sort control, the facets as chips or a sidebar, a price pair bounded
by `priceRange`, a "load more" control while `hasMore`, and states that look different for
loading, empty, no results and error. Categories are links to `category.html?slug=…`, from the
nav or the shop page.

Each tile shows the summary: `imageUrl` (and `hoverImageUrl`), `name`, the price, every ribbon
in `ribbons`, `discountNames` under the price, `swatches` as dots, `optionsSummary`. The price
reads "From {price}" when `fromPrice`, "{price} – {maxPrice}" when they differ, else
`price` with `compareAtPrice` struck beside it when present. Nothing is computed from these
fields: no percent off, no sale badge inferred, no struck price beside a range.

## The product page

`product.html?slug=…` loads the product through the detail store's state: `product.name`, the
gallery (`product.gallery`, with `state.imageUrl` as the main image when set), `descriptionHtml`
through `innerHTML`, `infoSections` as sections or accordions, `breadcrumbs` (Home, the category
path, the product), and `state.price` with `compareAtPrice` and `pricePerUnit`. A slug that
resolves to nothing (`notFound`) shows only the not-found state. On a phone the image is a
bounded band so the name, the price and the add button stay in the first screen. Set
`document.title` and the meta description from the entity's `seoData` once it loads, on the
product and the category pages.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/shop.html`, `/product.html?slug=…`, `/category.html?slug=…`, `/cart.html` if the brief wants a
cart page beside the drawer. A link to a folder gives the visitor a 404 page. One stylesheet and
one script shared by the pages, or inline per page, either way on one set of tokens.

## Rules

- Data and commerce go through the module exports. Extend by calling them; the request shapes
  stay in the modules.
- A product with options is added through the detail store, never by picking a variant yourself;
  a product with no options is added from the tile.
- Checkout only through `goToCheckout()`.
- Live data or an honest empty state: no invented products, prices, reviews, counts or delivery
  promises; no Wix ids or technical words in visible text.
- Cart totals come from the cart state; shipping reads "calculated at checkout", taxes too unless
  the cart has tax rows or `pricesIncludeTax`.
- Browsing, cart and checkout need no login; the visitor session is already there.
- Sort and filter at the source: the shop store and `searchCatalog`, never on the array a page
  already holds.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `wix-stores/products` (products),
`wix-stores/categories/list`, `wix-stores/inventory`, `ecom-platform/orders-list`,
`wix-stores/settings`, `wix-cashier/payments` (connect a payment method); the plan upgrade is
`https://www.wix.com/upgrade/website?metaSiteId={siteId}`. Real payments need a connected
payment method and a premium plan; until then hosted checkout tells the visitor the store cannot
accept online payments yet. Give both links in the close.

## Seeding

Per `seed/SEED.md` and `seed/seed-store.mjs`: a plain-data plan, run in the script's order with
its waits. Seed a catalog that exercises the storefront (a product with a colour option, one on
sale, an image per product) unless the brief says otherwise. A fresh Stores install may carry
Wix's sample catalog; never delete it or anything else on the site, and name it in the close with
the products link so the owner removes it there.
