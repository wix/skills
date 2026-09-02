# Storefront — seeding

Seed a Wix Stores catalog by **calling `seed-store.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Stores
seed operation. Load it and call **`setupStore` — the one-call path** — with plain data.

**Match each product's type to what the buyer receives** (the example shows both). *Access* — a
membership, or an online course/program the buyer enrolls in — isn't a store product at all; that's
the `pricing-plans` vertical, not here.

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/storefront/seed/seed-store.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// ONE call: install (+ wait for V3) → create products → categories → attach images, ids kept
// in memory (no hand-threading). Categories map name -> product NAMES. Pass an imageUrl per product
// to attach its image; omit it to skip images.
// imageUrl must be the FINAL https://media.base44.com/... url from the COMPLETED generate_image
// result — not a still-generating /__generating__/<id>.png placeholder (Wix can't fetch that).
// generate_image runs in the background while you build, so the urls are ready by seed time.
const result = await seed.setupStore(ctx, {
  products: [
    // physical — a shipped item: carries `quantity` (the default type)
    { name: "The Glam Rocker", description: "Sequin-studded velvet legend…", price: 49.99, quantity: 12, imageUrl: imageUrls[0] },
    // a product with buyer choices — see "Options, variants and sale prices" below
    { name: "The Understudy", description: "…", price: 245, quantity: 8, imageUrl: imageUrls[1],
      options: [{ name: "Color", type: "color", choices: [{ name: "Ink", colorCode: "#1B1B2F" }, { name: "Bone", colorCode: "#EDE6D6" }] }] },
    // a product on sale — compareAtPrice drives the strikethrough + the tile's percent-off badge
    { name: "Encore Jacket", description: "…", price: 68, compareAtPrice: 129, quantity: 5, imageUrl: imageUrls[2] },
    // digital — a file the buyer downloads & keeps (ebook, PDF, video): `digitalFileUrl`, NO `quantity`
    { name: "Backstage Guide", description: "…", price: 12, digitalFileUrl: "https://…/guide.pdf" },
  ],
  categories: { "Legends": ["The Glam Rocker"], "Rising Stars": [] },   // omit if the brief names none
});
// result: { products:[{id,slug,revision,name}], categories:[{id,name}], imagesAttached }
```

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add.

## How many, and exercising the UI

**Default to 3 products** unless the brief asks for a specific catalog — the seed shows the shape,
not a full inventory; the owner adds the rest later, from the Wix dashboard or by asking you for more.

The shipped storefront renders colour options as real swatches, shows a size/colour summary on each
tile, and puts a percent-off badge on a discounted product. A catalog of plain single-price products
leaves all of that invisible, so **make those 3 exercise it**: unless the brief says otherwise, give
at least one product a colour option and put one product on sale. Keep it truthful to the business.

```js
options: [
  { name: "Color", type: "color", choices: [{ name: "Ink", colorCode: "#1B1B2F" }, { name: "Bone", colorCode: "#EDE6D6" }] },
  { name: "Size",  type: "text",  choices: ["Small", "Medium", "Large"] },   // or [{ name: "Small" }, …]
]
```

- `type: "color"` → `SWATCH_CHOICES` with each choice's `colorCode`, which the PDP draws as a swatch.
  Any other `type` → text pills. Give every colour choice a `colorCode`.
- Variants are expanded for you: the full cross-product of the options, each carrying the product's
  `price`, `compareAtPrice` and `quantity`. Two options with 2 and 3 choices means 6 variants — keep
  option counts small.
- `compareAtPrice` (> `price`) is the "was" price: strikethrough on the PDP and a `−N%` badge on the
  tile, computed from the two amounts. It works with or without options.

## Digital downloads

**Pick the product type from what the buyer receives.** A shipped physical item is the default. A
**downloadable file the buyer keeps** — ebook, PDF guide, template, preset pack, printable, music
track, downloadable video — is a **digital** product: pass its file as `digitalFileUrl`. Selling
*access* rather than a file — a membership, subscription, or an online course/program the buyer
enrolls in — is **Pricing Plans**, not a Stores product, so it isn't seeded here.

`digitalFileUrl` (plus `digitalFileName` when the url carries no filename) makes a product a digital
download — uploaded and created with both the file and stock, which is what the cart requires
(`quantity` is ignored). It's also the only way in: a file-less digital product is created
successfully, reads back healthy, and is then rejected at add-to-cart as `ITEM_NOT_FOUND_IN_CATALOG`.

Two things this module does **not** seed, so don't try:

- **Ribbons** ("New", "Best Seller"). The tile renders `product.ribbon` when it's there, but ribbons
  are set in the Wix dashboard — tell the merchant that's where to add them.
- **Per-choice media** — the photo that makes picking a choice swap the gallery image. Seeded swatches
  select and price correctly; the gallery follows a choice once photos are linked to it (Wix dashboard,
  or the wix-manage "Update Product with Options" recipe → Choice & variant fields). The shipped PDP then
  follows automatically — `choiceImage()` reads it back at `media.items[].mediaId`.

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

## Reference
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-online-store.md`.

Read a method's page before writing its call: it carries the exact body shape, the required
permission scope, and the response envelope.
- Install a Wix app onto the site: https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app.md
- Import an image into Wix Media: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file.md
- Create Category: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category.md
- Bulk Update Categories: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-update-categories.md
- Bulk Add Items To Category: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-add-items-to-category.md
- Bulk Create Products With Inventory: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products-with-inventory.md
- Bulk Update Products: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products.md
- Bulk Create Inventory Items: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-create-inventory-items.md
- Query Products: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md
