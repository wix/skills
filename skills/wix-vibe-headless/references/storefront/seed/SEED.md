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
// in memory (no hand-threading). Categories map name -> product NAMES. Pass an imageUrl per product
// to attach its image; omit it to skip images. options ONLY for real buyer choices (Size/Color); default none.
// imageUrl must be the FINAL https://media.base44.com/... url from the COMPLETED generate_image
// result — not a still-generating /__generating__/<id>.png placeholder (Wix can't fetch that).
// generate_image runs in the background while you build, so the urls are ready by seed time.
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
"sample" data, don't reset. Just add.

## Escape hatch — individual functions
Reach for the functions below only when the one-call `setupStore` doesn't fit (partial re-seed, custom
ordering, mid-flow checks). `setupStore` is built from them, in this order:

```js
await seed.installStoresApp(ctx);                                     // install + wait for the V3 catalog
const products = await seed.bulkCreateProducts(ctx, [                 // → [{id,slug,revision}], in stock by `quantity`
  { name: "The Glam Rocker", description: "…", price: 49.99, quantity: 12 },
]);
const cats = await seed.createCategories(ctx, ["Legends"]);           // sequential → [{id,name}]
await seed.addProductsToCategories(ctx, { [cats[0].id]: [products[0].id] });
// images: use the FINAL https://media.base44.com/... url only (never a /__generating__/ placeholder)
await seed.attachProductImages(ctx, products.map((p, i) => ({ id: p.id, url: imageUrls[i], altText: p.slug })));
```

## Functions
| fn | does |
|---|---|
| `setupStore(ctx, {products, categories?})` | **one-call**: install+wait → products → categories → images |
| `installStoresApp(ctx)` | install the Wix Stores app on the site (waits for the V3 catalog) |
| `bulkCreateProducts(ctx, products)` | one bulk create → `[{id,slug,revision}]`; products come out in stock with the `quantity` you pass |
| `createCategories(ctx, names)` | sequential (shared tree 409s on concurrent) → `[{id,name}]` |
| `addProductsToCategories(ctx, {catId:[pid]})` | sequential add-items |
| `attachProductImages(ctx, [{id,url,altText}])` | one bulk media attach; no revision to pass. Wix re-hosts each url server-side; the media can take a little while to appear on read-back (propagation) — normal, not a failure |

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-online-store.md`.
