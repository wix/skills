---
name: "How to Code Restaurants"
description: The frontend read contract for a Wix Restaurants Menus site — which SDK modules to import, how to list menus/sections/items, how to re-order them by the parent's id arrays, how to read prices from priceInfo, and the _id / image gotchas the docs omit. Specifies the *how* (modules + exact calls + failure modes); which menu to render comes from the request.
---
**RECIPE**: How to Code a Wix Restaurants Frontend (Menus V1 — display-only)

A concise contract for writing the **frontend code** that renders a Wix Restaurants **menu**: listing the menu, its sections, and their items, assembling the hierarchy in display order, and reading each item's price. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which menu to show and how the page looks are decided by the request you're fulfilling.

> **This recipe is for CODING the menu display, not for seeding it.** It assumes a Restaurants Menus backend already exists (a menu, its sections, its items). It says nothing about creating them — only how to read and render them from frontend code.

> **Menus are DISPLAY-ONLY here.** The Wix Restaurants **Menus** app is a catalog for *showing* a menu — there is no cart, no checkout, no `variantId`, no `@wix/ecom` in this recipe. **Online ordering** (add-to-cart / checkout) and **table reservations** are **separate apps** (`@wix/restaurants` Orders / the distinct `@wix/table-reservations` package, installed only if the request calls for them) and are out of scope. If the site only shows a menu, you import one package and make read calls — nothing else.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the most common source of the `entity.id`-is-`undefined` bug. Fetch the `.md?apiView=SDK` form directly; don't re-discover these with search.

---

## The modules and the client (read this first)

**One package for menu display: `@wix/restaurants`.** It exposes three namespaces you read from — one per level of the hierarchy:

| Need | Package | Module (namespace) |
|---|---|---|
| Menus (list / get) | `@wix/restaurants` | `menus` |
| Sections (list / get) | `@wix/restaurants` | `sections` |
| Items (list / get) | `@wix/restaurants` | `items` |

The hierarchy is **Menu → Sections → Items**, wired by **id arrays**: a `menu.sectionIds[]` points at its sections, a `section.itemIds[]` points at its items. You read each level separately and stitch them together (see *Assembling the menu*).

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `menus` / `sections` / `items` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
  ```js
  import { menus, sections, items } from '@wix/restaurants';
  const { menus: menuList } = await menus.listMenus({ onlyVisible: true });
  ```
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { menus, sections, items } from '@wix/restaurants';

  const client = createClient({
    modules: { menus, sections, items },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  // then: await client.menus.listMenus({ onlyVisible: true })
  ```
  The `clientId` is public, not a secret. A mis-wired public env var inlines as `undefined` and 400s every call.

---

## The shapes you read (field cheat-sheet)

The exact field paths the frontend reads. These are **SDK read shapes** (`?apiView=SDK`), so ids are **`_id`**. Price is a decimal **string**.

```jsonc
// menus.listMenus({ onlyVisible: true })  →  { menus: [...] }
menu = {
  _id,                       // entity id (NOT .id → undefined in SDK code)
  name, description, visible,
  sectionIds,                // ORDERED array of section _ids — the section display order lives HERE
  urlQueryParam,             // slug fragment for the menu URL
}

// sections.listSections({ onlyVisible: true })  →  { sections: [...] }
section = {
  _id, name, description, visible,
  itemIds,                   // ORDERED array of item _ids — the item display order lives HERE
  image,                     // OPTIONAL media id STRING (wix:image://…) or absent — see Rendering images
}

// items.listItems({ onlyVisible: true })  →  { items: [...] }
item = {
  _id, name, description, visible,
  priceInfo: { price },      // PRICE. price is a decimal STRING ("9.50"), NO currency symbol. The SDK `PriceInfo` type carries ONLY `price` — there is no `formattedPrice`
  image,                     // OPTIONAL — a media id STRING (wix:image://…) or absent (text-only seed). NOT an object: resolve it, never read image.url
}
```

---

## The features (build the ones the site needs)

Each section below is a **self-contained feature** — implement only what the site uses. The only ordering is *within* the assembly (fetch levels before you stitch them).

### Listing menus / sections / items (and the `_id` rule)

Use the `list*` methods — they take a simple options object and return a plain array, with no query-builder ceremony:

```js
const { menus: menuList }    = await menus.listMenus({ onlyVisible: true });
const { sections: allSecs }  = await sections.listSections({ onlyVisible: true });
const { items: allItems }    = await items.listItems({ onlyVisible: true });
```
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/list-sections.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md?apiView=SDK>

**✅ PREFER `list*` over `query*` for reads.** `listMenus` / `listSections` / `listItems` take an options object (`{ onlyVisible, paging, menuIds/sectionIds/itemIds }`) and are unambiguous. The `queryMenus` / `queryItems` methods exist but their argument shape (object-param vs. fluent builder) is a known SDK-doc drift hotspot across Wix packages — avoid them for simple reads. To fetch a specific subset by id, pass the id array to the list method: `items.listItems({ itemIds: section.itemIds })`.

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** The SDK normalizes every entity's id to **`_id`**. `menu.id` / `section.id` / `item.id` are `undefined` in SDK code. Use `_id` everywhere — when following `sectionIds` / `itemIds`, when building links, and as React keys. (If a field name surprises you, you are probably reading the REST doc view — re-open it with `?apiView=SDK`.)

**Visibility:** pass `onlyVisible: true`, and note only entities seeded `visible: true` are returned to a visitor token anyway — a missing section/item usually means it wasn't seeded visible, not a query bug (ties back to the seed recipe).

### Assembling the menu (follow the id arrays — and preserve their order)

The three `list*` calls return **flat, unordered** arrays. The display structure and order live in the parent's id arrays (`menu.sectionIds`, `section.itemIds`), so stitch by looking entities up by `_id` **in id-array order** — do **not** render the raw `list*` order.

```js
const byId = (arr) => new Map(arr.map((e) => [e._id, e]));
const secById  = byId(allSecs);
const itemById = byId(allItems);

const menu = menuList[0];  // or match by urlQueryParam / name per the request
const structured = {
  ...menu,
  sections: (menu.sectionIds ?? [])
    .map((sid) => secById.get(sid))
    .filter(Boolean)                                  // a stale id (deleted section) → skip, don't crash
    .map((sec) => ({
      ...sec,
      items: (sec.itemIds ?? [])
        .map((iid) => itemById.get(iid))
        .filter(Boolean),
    })),
};
```

**⚠️ CRITICAL: order comes from `sectionIds` / `itemIds`, NOT from the `list*` response order.** `listSections` / `listItems` return entities in arbitrary (creation/internal) order. If you render `allSecs` / `allItems` directly, the menu shows "Desserts" before "Starters" and items in a scrambled order. Always map over the parent's ordered id array and look each child up by `_id`. **`.filter(Boolean)`** after each lookup so a dangling id (a child deleted out from under the menu) is skipped rather than rendering `undefined`.

### Reading the price

Read **`item.priceInfo.price`** — a decimal **string** (`"9.50"`) with **no currency symbol**. Render it directly, or `Number(item.priceInfo.price)` if you need arithmetic, and prefix your site's currency in the UI.

**⚠️ CRITICAL: price is under `priceInfo.price`, not a top-level `price` field — and there is NO `formattedPrice` on the SDK type.** Two traps here:
- The old top-level `item.price` is **deprecated** and reads `undefined` against seeded data → `$NaN` on the page. Always read `item.priceInfo.price`.
- The SDK's `PriceInfo` type is **`{ price?: string }`** only. `item.priceInfo.formattedPrice` **does not type-check** (`TS2339`) — even though the REST response happens to include a `formattedPrice`, the SDK type omits it, and the frontend calls the SDK. Do **not** read `formattedPrice`; format the currency yourself from `price` (the amount carries no symbol).

### Rendering images (only when imagery is on)

Menus are seeded **text-only by default**, so `section.image` / `item.image` are usually **absent** — guard for that and render a text-only card when missing. **`image` is a bare STRING** (the SDK types both `Section.image` and `Item.image` as `image?: string`) — a media identifier, usually a `wix:image://…`, occasionally an already-absolute URL. It is **not** an object, so **never read `image.url`** (`TS2339` — the recipe's earlier draft got this wrong). Resolve a `wix:image://` string through the helper (never put it straight into `<img src>` — it fails with `ERR_UNKNOWN_URL_SCHEME`):

```js
import { media } from '@wix/sdk';
function imgSrc(image, w = 600, h = 600) {
  if (!image) return '';                                   // absent (text-only) → caller renders a text card
  if (image.startsWith('wix:image://')) return media.getScaledToFillImageUrl(image, w, h, {});  // 4th arg REQUIRED
  return image;                                            // already an absolute https URL
}
```

**⚠️ `media.getScaledToFillImageUrl` takes FOUR arguments** in `@wix/sdk` — `(wixMediaIdentifier, width, height, options)`. The `options` object is **required** (unlike `getCroppedImageUrl`, whose `options?` is optional); a 3-arg call fails with `TS2554: Expected 4 arguments, but got 3`. Pass `{}` when you have no transform options.

Never hand-build a `static.wixstatic.com/.../v1/fit/...` URL — the format is easy to get wrong and the image then 403s. Doc: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>

---

## Conclusion
A correct Restaurants Menus frontend:
- imports **`menus` / `sections` / `items` from `@wix/restaurants`** — one package, three read namespaces; **no cart / checkout / ecom** (menus are display-only; ordering & reservations are separate apps);
- uses **`_id`** (never `id`) as every entity's id and when following `sectionIds` / `itemIds`;
- prefers the **`list*`** methods (option-object) over the drift-prone `query*` builders for reads;
- **assembles menu → sections → items in the order of the parent's `sectionIds` / `itemIds` arrays** (not the `list*` response order), `.filter(Boolean)` to drop dangling ids;
- reads price from **`item.priceInfo.price`** (a decimal string, no currency; **no `formattedPrice` on the SDK type**) — never the deprecated top-level `price`;
- treats `image` as an **optional string** (never `image.url`) and resolves `wix:image://` values through **`media.getScaledToFillImageUrl(id, w, h, {})`** (4 args), never raw.
