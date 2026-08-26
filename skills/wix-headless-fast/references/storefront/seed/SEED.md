# Storefront — seeding

Seed the Wix Stores catalog by **running `seed-store.mjs` with a plan file** — don't hand-write
the REST calls. The script mints its own site token via the Wix CLI (requires a logged-in CLI
session and a `wix.config.json` in the working directory), installs the Stores app if needed,
waits for the V3 catalog, and creates everything in the right order.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/storefront/seed/seed-store.mjs plan.json
```

`plan.json` is plain data — write it from the brief:

```json
{
  "products": [
    { "name": "The Glam Rocker", "description": "Sequin-studded velvet legend…",
      "price": 49.99, "quantity": 12, "imageUrl": "https://…" },
    { "name": "The Understudy", "description": "…", "price": 245, "quantity": 8,
      "options": [{ "name": "Color", "type": "color",
                    "choices": [{ "name": "Ink", "colorCode": "#1B1B2F" },
                                { "name": "Bone", "colorCode": "#EDE6D6" }] }] },
    { "name": "Encore Jacket", "description": "…", "price": 68, "compareAtPrice": 129,
      "quantity": 5 }
  ],
  "categories": { "Legends": ["The Glam Rocker"], "Rising Stars": [] }
}
```

- `description` — plain text or simple HTML (`<p>`, `<br/>`, `<strong>`, `<em>`); converted to
  Wix rich text so the storefront renders paragraphs and bold, not tag text.
- `options` — ONLY things the buyer selects-and-buys (Size, Color); they become variants.
  `type: "color"` renders as real swatches (give every color choice a `colorCode`); anything
  else renders as text pills. Variants are expanded automatically (full cross-product, each
  carrying the product's price/compareAtPrice/quantity) — keep option counts small.
- `compareAtPrice` (> `price`) — the "was" price: strikethrough on the PDP, sale badge data on
  the tile.
- `imageUrl` — a real, fetchable https URL; Wix re-hosts it server-side. Omit to seed text-only.
- `categories` — category name → product NAMES. Omit when the brief names none.

**Seed a catalog that exercises the shipped UI**: unless the brief says otherwise, give at
least one product a color option and put one product on sale — truthfully to the business (a
ceramics studio has glaze colors; a bakery doesn't).

**Seeding is additive — never delete or overwrite existing content.** No cleanup, no removing
"sample" data, no resets. If a cleanup genuinely seems needed, ask the user first.

Two things this module does not seed (dashboard-only — tell the merchant):
**ribbons** ("New", "Best Seller") and **per-choice linked media** (color choice → gallery photo).

## Escape hatch — individual functions

`setupStore` is built from exported steps; import them only for a partial re-seed or custom
ordering: `installStoresApp`, `bulkCreateProducts`, `createCategories`,
`addProductsToCategories`, `attachProductImages` — plus `makeCtx()` for the auth context.

## Reference

If a call returns an unexpected shape or you need an operation this module doesn't cover, read
the live Wix API reference — never guess. The authoritative source recipe is
`wix-headless/references/inline-recipes/setup-online-store.md`. Key pages:

- Bulk Create Products With Inventory: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products-with-inventory.md
- Create Category: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category.md
- Bulk Add Items To Category: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-add-items-to-category.md
- Bulk Update Products (image attach): https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products.md
