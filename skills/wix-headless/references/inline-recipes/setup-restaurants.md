---
name: "Setup Restaurants"
description: Initializes a Wix Restaurants Menus backend — cleans the install's default sample menu, then bulk-creates items, bulk-creates sections (referencing item ids), and creates the menu (referencing section ids), all visible. Specifies the *how* (calls + format); the menu/section/item counts and names come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Restaurants (Menus API)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` **and** `wix-site-id: <SITE_ID>`. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for preparing any new Wix site that uses the Wix Restaurants **Menus** app.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial menu setup.

> **This recipe is the *how*, not the *what*.** What to seed — how many menus, which sections, how many items per section and their names/descriptions/prices — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities or which entities to create.

> **API surfaces:** everything is the Restaurants **Menus V1** API on `https://www.wixapis.com/restaurants/menus/v1/...` (menus, sections, items — all under this one service). This is the **new** Wix Restaurants Menus API; do not mix in any older `restaurants/v1beta` or ordering/reservations endpoints. Online ordering and table reservations are **separate apps** and out of scope for menu seeding.

> **REST flattens the protobuf wrappers.** The raw method schemas show fields like `visible`, `id`, `description` as wrapper objects (`{"value": …}`). In the actual REST JSON they are **plain values** — send `"visible": true`, `"description": "text"`, and read back `"id": "<guid>"`. Never send `{"value": …}`.

---

## Article: Steps for Setting Up Wix Restaurants Menus
**YOU MUST** complete all the following steps **in the given order** (0-3) without skipping any and **without requiring additional user input**.

**⚠️ CRITICAL ORDER REQUIREMENT: build the hierarchy BOTTOM-UP — items (STEP 1) → sections (STEP 2) → menu (STEP 3).** A section is created with the **`itemIds`** of the items it contains, and a menu is created with the **`sectionIds`** of the sections it contains. So the child ids must exist before you create the parent. Do the cleanup (STEP 0) first of all, so the ids you delete are provably the install's samples.

### STEP 0: Clean the install — remove the default sample menu

**A freshly installed Wix Restaurants Menus app ships a fully populated default "Dinner Menu"** (roughly one menu, ~4 sections, ~21 items). Remove it **before** creating yours, so the storefront shows only your menu. Do this **first** — cleaning before you create guarantees the ids you delete are the install's samples, never your own entities. Delete children before parents (items → sections → menus):

1. **Bulk-delete items** — `GET https://www.wixapis.com/restaurants/menus/v1/items` (collect every `items[].id`), then `DELETE https://www.wixapis.com/restaurants/menus/v1/bulk/items/delete` with body `{"ids": ["<id>", …]}`.
2. **Bulk-delete sections** — `GET https://www.wixapis.com/restaurants/menus/v1/sections` (collect every `sections[].id`), then `DELETE https://www.wixapis.com/restaurants/menus/v1/bulk/sections/delete` with body `{"ids": ["<id>", …]}`.
3. **Delete menus** — `GET https://www.wixapis.com/restaurants/menus/v1/menus` (collect every `menus[].id`), then delete each one with `DELETE https://www.wixapis.com/restaurants/menus/v1/menus/{menuId}` (**no bulk-delete endpoint for menus** — one DELETE per menu; there is normally just the single default menu). Single delete takes only the path id — **no `revision` needed**.

The bulk-delete responses carry per-id `results[].itemMetadata.success`; a menu delete returns `200 {}`. If the lists come back empty, this is a safe no-op — continue.

### STEP 1: Bulk-create the items

Create all items in a **single bulk request** to `POST https://www.wixapis.com/restaurants/menus/v1/bulk/items/create`. **How many items, and their names/descriptions/prices, come from the request you're fulfilling — this step only gives the call and the required format.**

**Request body shape** (one representative item shown — repeat item objects inside the `items` array):

```json
{
  "items": [
    {
      "name": "Bruschetta al Pomodoro",
      "description": "Grilled sourdough, San Marzano tomatoes, basil.",
      "priceInfo": { "price": "9.50" },
      "visible": true
    }
  ],
  "returnEntity": true
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **Price goes in `priceInfo.price` as a decimal STRING** (`"9.50"`, not the number `9.50`). The currency is **derived from the site** — do **not** send a currency; the response echoes a `priceInfo.formattedPrice` (e.g. `"$9.50"`) in the site's currency.
- **Do NOT use the top-level `price` field** — it is deprecated (superseded by `priceInfo`). Use `priceInfo.price`.
- **`description` is a plain string** (not rich-text nodes). Omit it for a name-only item.
- **Set `"visible": true` explicitly** on every item (see the visibility callout below).
- **Imagery is opt-in** (`SEED.md` § "Entity images"). Seed **text-only by default** — omit `image`. Only when `imagery` is on does the dedicated Entity-images pass attach an `image` per item.
- If part of the bulk request fails, retry the failed items **once** with the exact same format; do not loop.

**⚠️ Reading the response — created items are under `results[].item`, and `results[].itemMetadata.success` is the per-item flag.** A successful bulk create returns `200`:

```json
{ "results": [
  { "itemMetadata": { "id": "<itemId>", "originalIndex": 0, "success": true },
    "item": { "id": "<itemId>", "name": "Bruschetta al Pomodoro", "priceInfo": { "price": "9.50", "formattedPrice": "$9.50" }, "visible": true } }
], "bulkActionMetadata": { "totalSuccesses": 1, "totalFailures": 0 } }
```

Keep each item's **`id`** (from `results[].item.id`), grouped by the section it belongs to — STEP 2 wires items into sections via these ids.

### STEP 2: Bulk-create the sections (referencing their item ids)

Create all sections in a **single bulk request** to `POST https://www.wixapis.com/restaurants/menus/v1/bulk/sections/create`. Each section carries the **`itemIds`** array of the items (from STEP 1) that belong to it. **Which sections, and which items go in each, come from the request you're fulfilling.**

**Request body shape** (repeat section objects inside the `sections` array):

```json
{
  "sections": [
    {
      "name": "Antipasti",
      "description": "To start",
      "visible": true,
      "itemIds": ["<itemId1>", "<itemId2>"]
    }
  ],
  "returnEntity": true
}
```

**⚠️ CRITICAL:**
- **`itemIds` must be real item ids from STEP 1**, in the display order you want. An item can appear in more than one section, but normally each item belongs to exactly one.
- **Set `"visible": true` explicitly.**
- Read created sections from **`results[].item`** (the bulk envelope reuses the generic `item` key even for sections). Keep each section's **`id`** — STEP 3 wires sections into the menu via these ids.
- Retry failed sections **once**; do not loop.

### STEP 3: Create the menu (referencing its section ids)

Create the menu with `POST https://www.wixapis.com/restaurants/menus/v1/menus`. The menu carries the **`sectionIds`** array of the sections (from STEP 2) it contains. There is normally **one** menu; if the request calls for several, use the bulk endpoint `POST https://www.wixapis.com/restaurants/menus/v1/bulk/menus/create` with a `{"menus": [ … ], "returnEntity": true}` body (same envelope as items/sections).

**Request body shape** — the single-create wraps the menu in a **`menu`** object:

```json
{
  "menu": {
    "name": "Dinner",
    "description": "Evening menu",
    "visible": true,
    "sectionIds": ["<sectionId1>", "<sectionId2>"]
  }
}
```

**⚠️ CRITICAL:**
- **`sectionIds` must be real section ids from STEP 2**, in display order.
- **Set `"visible": true` explicitly.**
- The single-create response is `{"menu": { "id": "<menuId>", "sectionIds": [ … ], "visible": true, "urlQueryParam": "dinner" }}` — read the **`menu.id`** (bulk create returns `results[].item` like the others). Keep the `menuId`.
- **`businessLocationId` is optional** — omit it and the menu/section bind to the site's default (main) business location. Only set it for a multi-location restaurant when the request names locations.

**⚠️ VISIBILITY — set `"visible": true` explicitly at every level (item, section, menu).** Storefront menu queries return only visible entities to visitors. Always include `visible: true` on every item, every section, and the menu, rather than relying on a default — an entity created without it may exist but not render on the live site.

---

## Conclusion
Following these steps **in order** sets up a new Wix Restaurants Menus site:
- Starts from a **clean menu** — the install's default sample "Dinner Menu", its sections, and its items are all removed first.
- Contains the menu, sections, and items called for by the request, built **bottom-up** (items → sections → menu) so every parent references real child ids.
- Every item, section, and menu is created **`visible: true`** so it appears on the live site.
- Prices are decimal strings under `priceInfo.price`; currency is the site's own. All calls use the Restaurants **Menus V1** API.
