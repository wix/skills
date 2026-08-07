# Storefront — seeding

Seed a Wix Stores catalog by **calling `seed-store.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Stores
seed operation. `require` it and call the functions with plain data.

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/storefront/seed/seed-store.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

await seed.installStoresApp(ctx);                       // if the site doesn't have Wix Stores yet

// Clean is a JUDGMENT call — never auto-delete. Only remove obvious install samples on a fresh
// install; if what's there could be the owner's real catalog, ask first (seeding is additive).
const existing = await seed.listProducts(ctx);
// await seed.deleteProducts(ctx, existing.filter(isObviousSample).map(p => p.id));

const products = await seed.bulkCreateProducts(ctx, [
  { name: "The Glam Rocker", description: "Sequin-studded velvet legend…", price: 49.99, quantity: 12 },
  // …just the catalog data. options ONLY for real buyer choices (Size/Color); default none.
]);

const cats = await seed.createCategories(ctx, ["Legends", "Rising Stars"]);   // only if the brief names categories
await seed.addProductsToCategories(ctx, { [cats[0].id]: products.map(p => p.id) });

// imagery ON only: generate images per IMAGE_GENERATION.md, then one bulk attach
await seed.attachProductImages(ctx, products.map((p, i) => ({ id: p.id, revision: p.revision, url: imageUrls[i], altText: p.slug })));
```

## Functions
| fn | does |
|---|---|
| `installStoresApp(ctx)` | install the Wix Stores app on the site |
| `listProducts(ctx)` | `[{id,name}]` — for the sample-cleanup judgment |
| `deleteProducts(ctx, ids)` | bulk-delete (only obvious samples) |
| `bulkCreateProducts(ctx, products)` | one bulk create → `[{id,slug,revision}]` |
| `createCategories(ctx, names)` | sequential (shared tree 409s on concurrent) → `[{id,name}]` |
| `addProductsToCategories(ctx, {catId:[pid]})` | sequential add-items |
| `attachProductImages(ctx, [{id,revision,url,altText}])` | one bulk media attach |

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-online-store.md`.
