# Storefront — seeding

Seed a Wix Stores catalog by **calling `seed-store.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Stores
seed operation. Load it and call **`setupStore` — the one-call path** — with plain data.

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/storefront/seed/seed-store.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// ONE call: install (+ wait for V3) → create products → categories → attach images, ids kept
// in memory (no hand-threading). Categories map name -> product NAMES. imageUrl per product only
// when imagery is on — passing it here does the image attach in the SAME pass, on the fresh
// create-time revision. options ONLY for real buyer choices (Size/Color); default none.
const result = await seed.setupStore(ctx, {
  products: [
    { name: "The Glam Rocker", description: "Sequin-studded velvet legend…", price: 49.99, quantity: 12, imageUrl: imageUrls[0] },
    // …just the catalog data
  ],
  categories: { "Legends": ["The Glam Rocker"], "Rising Stars": [] },   // omit if the brief names none
});
// result: { products:[{id,slug,revision,name}], categories:[{id,name}], imagesAttached }
```

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add. Need finer control than `setupStore`? The individual functions
below still exist (setupStore is built from them).

## Functions
| fn | does |
|---|---|
| `setupStore(ctx, {products, categories?})` | **one-call**: install+wait → products → categories → images |
| `installStoresApp(ctx)` | install the Wix Stores app on the site (waits for the V3 catalog) |
| `bulkCreateProducts(ctx, products)` | one bulk create → `[{id,slug,revision}]` |
| `createCategories(ctx, names)` | sequential (shared tree 409s on concurrent) → `[{id,name}]` |
| `addProductsToCategories(ctx, {catId:[pid]})` | sequential add-items |
| `attachProductImages(ctx, [{id,revision,url,altText}])` | one bulk media attach — each attach **bumps `revision`**; before a 2nd/manual attach (images generated later) re-read the current revision (`listProducts`), don't reuse the create-time one, else `INVALID_REVISION` |

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-online-store.md`.
