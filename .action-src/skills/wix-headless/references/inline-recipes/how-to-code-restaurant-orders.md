---
name: "How to Code Restaurant Orders"
description: The frontend cart/checkout contract for a Wix Restaurants Online-Ordering site — which SDK modules to import, how to read the ordering operation + fulfillment methods, the exact restaurant add-to-cart shape (appId = Orders app, options = operationId+menuId+sectionId, NOT variantId), and checkout via eCommerce. Specifies the *how* (modules + exact calls + failure modes); which menu/items to sell come from the request.
---
**RECIPE**: How to Code a Wix Restaurants Ordering Frontend (Online Orders + eCommerce cart)

A contract for the **frontend code** that lets a visitor **order** from a Wix Restaurants menu: reading the ordering operation and fulfillment methods, adding a menu item to the eCommerce cart with the restaurant `catalogReference`, and checking out. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which menu/items to sell and how the page looks come from the request you're fulfilling.

> **This recipe is for CODING ordering, not seeding it.** It assumes the backend already exists — a Restaurants **Menus** backend (menu → sections → items) **and** the Restaurants **Orders** app installed and configured (an `ENABLED` operation with fulfillment methods, every menu ordering-enabled). See `setup-restaurants.md` + `setup-restaurant-orders.md` for the backend. This recipe says nothing about creating any of it — only how to read and purchase from frontend code.

> **Reading (displaying) the menu is a SEPARATE recipe — pair this with it.** `how-to-code-restaurants.md` covers listing menus/sections/items, assembling the hierarchy in `sectionIds`/`itemIds` order, reading `item.priceInfo.price`, and rendering images. That recipe is **display-only** (no cart). **This** recipe adds the **ordering** layer on top: it consumes the same `menus`/`sections`/`items` reads and needs each rendered item's `_id`, its section's `_id`, and the menu's `_id` to build a cart line. Don't duplicate the menu-reading here — read it there, order it here.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the most common source of the `entity.id`-is-`undefined` cart bug. Fetch the `.md?apiView=SDK` form directly; don't re-discover these with search.

---

## The modules and the client (read this first)

**Restaurants Orders app id** (a constant you need for the cart's `catalogReference.appId`):
`9a5d83fd-8570-482e-81ab-cfa88942ee60`

**⚠️ This is the ORDERS app id, NOT the Stores app id.** A restaurant menu item added to the cart must carry `appId: '9a5d83fd-…'` (Orders). Using the Stores id (`215238eb-…`) — muscle memory from `how-to-code-a-store.md` — makes eCommerce resolve the line against the wrong catalog and the add fails. Menu items are **not** Stores products.

| Need | Package | Module (namespace) |
|---|---|---|
| Menus / sections / items (display) | `@wix/restaurants` | `menus` / `sections` / `items` — see `how-to-code-restaurants.md` |
| The ordering operation (for `operationId`) | `@wix/restaurants` | `operations` |
| Fulfillment methods (pickup/delivery to show) | `@wix/restaurants` | `fulfillmentMethods` |
| Cart (add / get / checkout) | `@wix/ecom` | `currentCart` |
| Redirect to hosted checkout | `@wix/redirects` | `redirects` |

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `operations` / `fulfillmentMethods` / `currentCart` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
  ```js
  import { operations, fulfillmentMethods } from '@wix/restaurants';
  import { currentCart } from '@wix/ecom';
  const { operations: ops } = await operations.listOperations();
  ```
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { menus, sections, items, operations, fulfillmentMethods } from '@wix/restaurants';
  import { currentCart } from '@wix/ecom';
  import { redirects } from '@wix/redirects';

  const client = createClient({
    modules: { menus, sections, items, operations, fulfillmentMethods, currentCart, redirects },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  // then: await client.operations.listOperations(), await client.currentCart.addToCurrentCart({...})
  ```
  The `clientId` is public, not a secret. A mis-wired public env var inlines as `undefined` and 400s every call.

---

## The shapes you read (field cheat-sheet)

These are **SDK read shapes** (`?apiView=SDK`), so entity ids are **`_id`**. Prices/fees are decimal **strings**. The cart-add body (under *Adding a menu item to the cart*) is a separate **write** shape; the `_id` rule applies to read **entities**, not to method-return wrappers (note `checkoutId`).

```jsonc
// operations.listOperations()  →  { operations: [...] }   (no arguments)
operation = {
  _id,                        // → cart options.operationId   (NOT .id → undefined)
  name, default,              // the auto-created ordering operation has default: true
  onlineOrderingStatus,       // "ENABLED" when the site is taking orders
  fulfillmentIds,             // ids of the fulfillment methods attached to this operation
  defaultFulfillmentType,     // "PICKUP" | "DELIVERY"
}

// fulfillmentMethods.listFulfillmentMethods()  →  { fulfillmentMethods: [...] }
fulfillmentMethod = {
  _id, type,                  // "PICKUP" | "DELIVERY"
  name, enabled,              // show only enabled:true to the visitor
  fee, minOrderPrice,         // decimal STRINGS ("0", "5") — no currency symbol
  pickupOptions,              // present when type PICKUP
  deliveryOptions,            // present when type DELIVERY (deliveryTimeInMinutes, deliveryArea, …)
}

// item (from items.listItems — see how-to-code-restaurants.md)
item = { _id, name, priceInfo: { price } }   // price is a decimal STRING; _id → cart catalogItemId

// currentCart.getCurrentCart()  →  { lineItems: [...] }
lineItem = { quantity, price: { amount }, image }   // amount is the string price; image is wix:image:// → resolve

// currentCart.createCheckoutFromCurrentCart({ channelType })  →  { checkoutId }   // a STRING — NOT { checkout }, NOT _id
// redirects.createRedirectSession({ ecomCheckout: { checkoutId }, callbacks })  →  { redirectSession: { fullUrl } }
```

---

## The features (build the ones the site needs)

Each subsection is a **self-contained feature** — implement only what the site uses. The only ordering is *within* a feature (read the operation before you build a cart line that references it).

### Reading the ordering operation (and the `_id` rule)

Get the operation so you have the **`operationId`** every cart line needs. `listOperations()` takes **no arguments** and returns a plain array.

```js
const { operations: ops = [] } = await operations.listOperations();
const op = ops.find((o) => o.onlineOrderingStatus === 'ENABLED') ?? ops.find((o) => o.default) ?? ops[0];
const operationId = op._id;
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md?apiView=SDK>

**⚠️ `list*` return the array as OPTIONAL — default it (`= []`) or the strict build fails.** `listOperations()` / `listFulfillmentMethods()` / `listItems()` type the returned array as `T[] | undefined`, so destructuring `{ operations: ops }` and calling `ops.find(...)` directly errors under `strict` / `astro check` (`'ops' is possibly 'undefined'`, TS18048) — a build-breaker on managed Astro. Default it in the destructure (`{ operations: ops = [] }`) or guard with `?? []`.

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** `operation.id` / `item.id` / `section.id` are `undefined` in SDK code. Feeding `operation.id` into `options.operationId` (or `item.id` into `catalogItemId`) sends an empty string and the add-to-cart fails. Use `_id` everywhere. (A surprising `id` field means you're reading the REST doc view — re-open with `?apiView=SDK`.)

**Read the operation once and reuse `operationId`** for every add-to-cart on the page — don't call `listOperations()` per line item.

### Reading fulfillment methods (pickup / delivery to show)

List the methods to render the visitor's pickup/delivery choices (fee, minimum, type). Show only `enabled: true`.

```js
const { fulfillmentMethods: methods = [] } = await fulfillmentMethods.listFulfillmentMethods();
const offered = methods.filter((m) => m.enabled);
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/list-fulfillment-methods.md?apiView=SDK> (default the array `= []` — see the optional-array note above)

**⚠️ `listFulfillmentMethods` takes an OPTIONS object, not a query builder.** It accepts an optional `{ paging }` object and returns a `Promise` of `{ fulfillmentMethods }` directly — do **not** chain `.find()`/`.eq()` on it (that's the `queryProducts` builder pattern from stores; it does not apply here). `fee` and `minOrderPrice` are decimal **strings** — render them with your currency, and `Number(...)` only if you need arithmetic. Which method the buyer actually uses (and the delivery time slot) is chosen on the **hosted checkout**; listing here is for display, not a required pre-checkout step.

### Adding a menu item to the cart — the restaurant `catalogReference`

This is the one shape that differs materially from a Stores cart. Build a line item whose `catalogReference` names the **Orders app** and carries **`operationId` + `menuId` + `sectionId`** in `options`.

```js
await currentCart.addToCurrentCart({
  lineItems: [{
    quantity,
    catalogReference: {
      catalogItemId: item._id,                              // the MENU ITEM's _id
      appId: '9a5d83fd-8570-482e-81ab-cfa88942ee60',        // the ORDERS app id (not Stores)
      options: {
        operationId,                                        // from listOperations()
        menuId,                                             // the _id of the menu the item is shown in
        sectionId,                                          // the _id of the section the item is shown under
      },
    },
  }],
});
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/add-to-current-cart.md?apiView=SDK>

**⚠️ CRITICAL: `options` MUST carry `operationId`, `menuId`, AND `sectionId` — all three.** A restaurant line item is identified by *where in the menu it was ordered from*, not by a variant. Omitting any of the three makes eCommerce unable to resolve the item against the Restaurants catalog — the add fails or the line can't be checked out. This is the restaurant analog of the store's mandatory `variantId`, and it fails the same quiet way.

**⚠️ CRITICAL: there is NO `variantId` here.** `options.variantId` is a **Stores** concept — menu items have no variants in this flow. Don't copy the store recipe's `variantId` resolution; a restaurant line uses `operationId`/`menuId`/`sectionId` instead. (Menu item *modifiers* — "extra cheese" — are a separate concern and out of scope for the basic order flow.)

**⚠️ Thread `sectionId` and `menuId` from the render, not a lookup.** When you assemble the menu (menu → sections → items, per `how-to-code-restaurants.md`), each item is rendered **inside** a known section and menu — capture that `section._id` and `menu._id` at render time and pass them to the add-to-cart handler alongside `item._id`. Re-deriving an item's section afterward is unnecessary and error-prone; you already have it in the render context.

Optional: `options.onlineOrderingPageUrl` (e.g. `"/online-ordering"`) lets the buyer click the cart line to return to the item — include it only if your site has such a page.

### Checkout

Create a checkout from the current cart, then redirect the buyer to the hosted checkout (identical to the storefront flow — restaurant orders ride on the same eCommerce checkout).
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/create-checkout-from-current-cart.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/get-current-cart.md?apiView=SDK>

```js
const checkout = await currentCart.createCheckoutFromCurrentCart({ channelType: currentCart.ChannelType.WEB });
const session = await redirects.createRedirectSession({
  ecomCheckout: { checkoutId: checkout.checkoutId },   // checkout.checkoutId — NOT checkout._id
  callbacks: { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` },
});
window.location.href = session.redirectSession.fullUrl; // the hosted-checkout URL (fulfillment + time slot chosen here)
```

**⚠️ `createCheckoutFromCurrentCart` returns `checkout.checkoutId`** (a string), **not** `checkout._id`. Reading `checkout._id` (over-applying the `_id` rule) throws *"Cannot read properties of undefined (reading '_id')"* — the silent checkout crash. The `_id` rule is for read **entities**, not method-return wrappers.

**⚠️ CRITICAL: `origin` for `postFlowUrl`/`thankYouPageUrl` MUST be the `https://` published host — derive it from `window.location.origin`, NEVER `new URL(request.url).origin`.** The Headless redirect allowlist registers the site's **`https://`** host and treats `http://<same host>` as a different, unlisted origin. If you build the redirect session in a **server route** (`src/pages/api/*`), `new URL(request.url).origin` resolves to `http://` behind Wix's TLS-terminating proxy → the buyer's return redirect **403s** with *"… isn't listed as an allowed redirect domain."* Pass `window.location.origin` from the client into the route (or force the scheme to `https`). Doc: <https://dev.wix.com/docs/go-headless/getting-started/setup/manage-urls/add-allowed-redirect-domains>.

**⚠️ LIVE PAID CHECKOUT PRECONDITION.** A visitor can add to cart and reach the hosted checkout with just this code, but **completing a paid order** needs the site to have a **premium plan and a configured payment method**. That's site provisioning, not a frontend bug — if checkout can't collect payment, the setup is incomplete, not the code.

### Reading the price and the cart

Menu item price is **`item.priceInfo.price`** — a decimal **string** with no currency symbol (see `how-to-code-restaurants.md`; the SDK `PriceInfo` type has only `price`, no `formattedPrice`). A cart line's price is **`lineItem.price.amount`** (also a string). Prefix your own currency in the UI. Cart line images are `wix:image://` identifiers — resolve them with `media.getScaledToFillImageUrl(id, w, h, {})` (4 args), never raw (see the store/menu recipes' image callout).

---

## Conclusion
A correct Restaurants ordering frontend:
- imports **`operations` / `fulfillmentMethods` from `@wix/restaurants`** (plus `menus`/`sections`/`items` for display) and **`currentCart` / `redirects`** from `@wix/ecom` / `@wix/redirects`;
- uses **`_id`** (never `id`) for the operation, menu, section, and item;
- reads the **`operationId`** once from `listOperations()` (the `ENABLED`/`default` operation) and reuses it;
- adds menu items with the **Orders app id `9a5d83fd-…`** (never the Stores id) and `options` carrying **`operationId` + `menuId` + `sectionId`** (all three) — **no `variantId`**;
- threads `menuId`/`sectionId` from the render context, not a re-lookup;
- checks out via **`createCheckoutFromCurrentCart` → `checkout.checkoutId` → `redirects`**, with an **`https://` `window.location.origin`** for the callbacks; the hosted checkout collects fulfillment + payment (which needs a premium plan + payment method).
</content>
