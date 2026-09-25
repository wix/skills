# Storefront — seeding

Seed the Wix Stores catalog by **running `seed-store.mjs` with a plan file** — don't hand-write
the REST calls. The script mints its own site token via the Wix CLI (requires a logged-in CLI
session and a `wix.config.json` in the working directory), installs the Stores app if needed,
waits for the V3 catalog, and creates everything in the right order.

**Set each product's type by what the buyer receives** — physical (shipped, has `quantity`) or
digital (a file they keep, `digitalFilePath`/`digitalFileUrl`, no `quantity`); the plan below shows
both. *Access* — a membership or an online course/program the buyer enrolls in — is Pricing Plans,
not a store product.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/storefront/seed/seed-store.mjs plan.json
```

Run this way, the result is the process itself: exit code `0` and the JSON on stdout (redirect it
to a file if you want it later). `.seed-exit` and `seed-result.json` are written by
`install/fast-path.mjs` when IT starts the seed — don't wait for them after a manual run.

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
      "quantity": 5 },
    { "name": "Backstage Guide", "description": "…", "price": 12,
      "digitalFilePath": "/Users/me/guide.pdf" }
  ],
  "categories": { "Legends": ["The Glam Rocker"], "Rising Stars": [] },
  "currency": "EUR"
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
- **Give every product an image** (a store without product images looks broken: gray boxes on
  tiles, PDP, and cart) — the default is an `imagePrompt` (AI-generated, ~1 Wix AI credit
  per image, account-billed): brand-contextual — subject, aesthetic/mood, palette, lighting —
  always ending "no text, no watermarks". At least one image in the set shows the real subject of the business — the actual product/space/service, not abstract decoration. For an asset the user actually supplied use `imagePath` (a file on
  this machine — uploaded to Wix Media) or `imageUrl` (their own hosted URL; verify it with
  `curl -sI` → 200) — never a stock-photo or guessed URL. Images resolve in parallel and never block the seed; a failed image leaves
  that product text-only. Seed text-only only when the user explicitly asks.
- `digitalFilePath` (a file on this machine) or `digitalFileUrl` — makes the product a digital
  download, uploaded and created with both the file and stock (`quantity` is ignored). It's also the
  only way in: a file-less digital product is created successfully, reads back healthy, and is then
  rejected at add-to-cart as `ITEM_NOT_FOUND_IN_CATALOG`. **No real file in hand?** Don't invent a
  URL and don't ship the product as digital — seed it physical with stock (drop
  `digitalFilePath`/`digitalFileUrl`, add `inStock` or a `quantity`) and tell the user the
  download needs a real file before it can be sold.
- `categories` — category name → product NAMES. Omit when the brief names none.
- `quantity` — tracked stock, a non-negative integer. For stock that isn't counted (made to
  order, print on demand, unlimited) use `"inStock": true` **instead** of `quantity`; sending
  both is rejected.
- `currency` — 3-letter ISO code. Set it **only when the brief names one** ("prices in euros",
  "a German store charging EUR"). Do **not** infer it from a language, a country, or an address
  — an unrequested switch silently reprices the whole catalog. The seed applies it before
  creating anything, because a product's price is stored in the site currency at create time.
  For a few seconds afterwards product reads can still report the old currency; that lag is
  expected and self-resolves, so don't re-verify it or retry.

**Default to 3 products** when you draft the catalog yourself — the seed shows the shape, not a
full inventory; the owner adds the rest in the dashboard. **Make those 3 exercise the shipped
UI**: give at least one product a color option and put one product on sale — truthfully to the
business (a ceramics studio has glaze colors; a bakery doesn't).

## A supplied catalog

When the user hands over their products in any form — a CSV, JSON or spreadsheet, a list typed in
the prompt, a PDF or image of a price list, a folder of product photos with a text file beside it,
a link to a page that lists them — that source is the plan and the 3-product default does not
apply: every product in it becomes a product. Read it however it needs to be read (parse the file,
open the PDF, fetch the page, look at the images), then map, don't author:

- Names, descriptions and prices verbatim; never rename, reprice, reword or add products.
- Column names vary; map by meaning: `price` → `price`; a was/compare/regular/list price →
  `compareAtPrice` (only when higher than `price`); stock/quantity/inventory → `quantity`, or
  `"inStock": true` when the file says unlimited or made to order; sku and anything the plan
  has no field for is dropped — say which columns you dropped.
- A category/collection/type column → `categories` (name → the products carrying it).
- A choices column ("Small|Large", "S, M, L", "6 inch / 8 inch") → one `options` entry of
  `type: "text"` named after the column (Size, Flavor…); `type: "color"` only when the file
  gives color codes. One row per variant with its own price is beyond the plan: seed the product
  once at the lowest price and tell the user variant prices are set in the dashboard.
- Their image column → `imageUrl`, verified with `curl -sI` → 200; a local path → `imagePath`.
  A row with no image is seeded text-only and listed in your summary. **Never `imagePrompt`
  beside a supplied catalog** — these are their products, not a mood board.
- `currency` only when the file or the brief states it.

Read the file before writing `plan.json` (`head`, or parse it — a quoted comma inside a
description is common), keep the mapping in one place, and show the user the row count you
seeded next to the row count you read.

**Seeding is additive — never delete or overwrite existing content.** No cleanup, no removing
"sample" data, no resets — not even on a site created a minute ago. The Stores install adds its
own sample products to a new catalog; they stay, and the owner removes them in the dashboard
(the Manage products link is in your summary). If a cleanup genuinely seems needed, ask the user
first. Categories are idempotent by name — a re-run reuses "Donuts" instead of creating a second one.

**A bulk create can partially succeed.** The result carries `failures: [{ name, error }]` next
to `products` — read it. A non-empty `failures` means those products are genuinely absent, not
mis-mapped, so the rest of the catalog is fine to build on. To retry, re-run the **same** plan:
creation is idempotent by name, so products that already exist are skipped rather than
duplicated. Never hand-patch ids to "fill the gap".

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
