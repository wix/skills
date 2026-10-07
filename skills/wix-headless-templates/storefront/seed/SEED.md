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
node <SKILL_ROOT>/templates/storefront/seed/seed-store.mjs plan.json
```

Run this way, the result is the process itself: exit code `0` and the JSON on stdout (redirect it
to a file if you want it later). `.seed-exit` and `seed-result.json` are written by
`install/setup.mjs` when IT starts the seed — don't wait for them after a manual run.

`plan.json` is plain data — write it from the brief:

```json
{
  "products": [
    { "name": "The Glam Rocker", "description": "Sequin-studded velvet legend…",
      "price": 49.99, "quantity": 12, "imageUrl": "https://…" },
    { "name": "The Understudy", "description": "…", "price": 245, "quantity": 8,
      "options": [{ "name": "Color", "type": "color",
                    "choices": [{ "name": "Ink", "colorCode": "#1B1B2F", "imageUrl": "https://…/ink.jpg" },
                                { "name": "Bone", "colorCode": "#EDE6D6", "imageUrl": "https://…/bone.jpg" }] }] },
    { "name": "Encore Jacket", "description": "…", "price": 68, "compareAtPrice": 129,
      "quantity": 5, "ribbon": "Sale",
      "options": [{ "name": "Size", "choices": ["S", "M", "L"] }],
      "variantPrices": { "L": 74 },
      "modifiers": [{ "name": "Gift wrap", "mandatory": false, "choices": ["None", "Kraft paper"] },
                    { "name": "Engraving", "type": "text", "maxChars": 30 }],
      "infoSections": [{ "title": "Care", "description": "Dry clean only." }] },
    { "name": "Tour Poster", "description": "…", "price": 24, "quantity": 0,
      "preorder": { "message": "Ships in 3 weeks", "limit": 50 } },
    { "name": "Backstage Guide", "description": "…", "price": 12,
      "digitalFilePath": "/Users/me/guide.pdf" }
  ],
  "categories": { "Legends": ["The Glam Rocker"], "Rising Stars": [] },
  "categoryDetails": { "Legends": { "description": "The originals.", "imagePrompt": "…, no text, no watermarks" } },
  "currency": "EUR"
}
```

- `description` — plain text or simple HTML (`<p>`, `<br/>`, `<strong>`, `<em>`); converted to
  Wix rich text so the storefront renders paragraphs and bold, not tag text.
- `options` — ONLY things the buyer selects-and-buys (Size, Color); they become variants.
  `type: "color"` renders as real swatches (give every color choice a `colorCode`); anything
  else renders as text pills. Variants are expanded automatically (full cross-product, each
  carrying the product's price/compareAtPrice/quantity) — keep option counts small.
  A choice may carry its own photo — `imageUrl` | `imagePath` | `imagePrompt` (+ `altText`), the
  same three forms as a product image: it joins the product's gallery and the product page shows
  it when that choice is picked (a colour's photo). Give it when the source has one per colour.
- `variantPrices` — `{ "<choice name>": price }` when one option's choices are priced differently
  ("L": 74): every variant carrying that choice takes that price (the first priced choice wins);
  the tile then shows the range. Omit it when every variant costs the same.
- `compareAtPrice` (> `price`) — the "was" price: strikethrough on the PDP, sale badge data on
  the tile. Kept only on variants it stays above.
- `ribbon` — the label on the tile and PDP ("New", "Best Seller"); one per product, created by name.
- `modifiers` — buyer input that does NOT create variants: `{ name, choices: ["None", "Kraft paper"] }`
  renders pills, `{ name, type: "text", maxChars?, minChars? }` a free-text field. `mandatory`
  defaults to true (the storefront blocks the add until it's filled) — set `false` for optional
  extras. A choice may carry `addedPrice`.
- `infoSections` — `[{ title, description }]` (same description rules as above) — the PDP renders
  them as sections/accordions; two products with the same title share one section.
- `preorder` — `{ message?, limit? }` on a product WITH a `quantity` (pre-order rides on counted
  stock): once stock hits zero the storefront sells it as "Pre-order" with the message, up to
  `limit` units. Seed the pre-order item with `quantity: 0` when the brief wants it pre-orderable
  from day one.
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
- `categoryDetails` — per category name: `description` (plain text, the category page's intro)
  and one image source (`imagePrompt` / `imageUrl` / `imagePath`, same rules as product images)
  for the category's own image (`Category.imageUrl` — home-page category tiles). Applied on
  create only; an existing category keeps what it has.
- `quantity` — tracked stock, a non-negative integer. For stock that isn't counted (made to
  order, print on demand, unlimited) use `"inStock": true` **instead** of `quantity`; sending
  both is rejected.
- `currency` — 3-letter ISO code. Set it **only when the brief names one**: a sentence about
  currency ("prices in euros") or a price written with its unit ("9 dollars", "$9", "€20"). Do **not** infer it from a language, a country, or an address
  — an unrequested switch silently reprices the whole catalog. The seed applies it before
  creating anything, because a product's price is stored in the site currency at create time.
  For a few seconds afterwards product reads can still report the old currency; that lag is
  expected and self-resolves, so don't re-verify it or retry.

**Default to 3 products** when you draft the catalog yourself — the seed shows the shape, not a
full inventory; the owner adds the rest in the dashboard. **Make those 3 exercise the shipped
UI**: give at least one product a color option and put one product on sale — truthfully to the
business (a ceramics studio has glaze colors; a bakery doesn't). When the brief mentions gift
wrap, engraving, a message card, pre-orders, or "coming soon" stock, seed ONE product with that
modifier and ONE pre-order item so the surfaces exist to design against; never add them to a
brief that didn't ask.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For a store, each product the user
lists is one entry, whatever form the list arrives in. Its name, description and price become
`name`, `description` and `price`. A "was", "regular" or "compare at" price becomes `compareAtPrice`
when it is higher than the price. A stock count becomes `quantity`; "unlimited" or "made to order"
becomes `"inStock": true`. A category, collection or type becomes an entry in `categories`. A set of
choices the buyer picks from ("Small / Large", "S, M, L") becomes one `options` entry named after
what it is (Size, Flavor), `type: "text"`; use `type: "color"` only when the source gives color codes.
Their image becomes `imageUrl`. A separate price per size becomes `variantPrices` keyed by the
choice name, with `price` the lowest. A label like "New" or "Best Seller" becomes `ribbon`; "gift
wrap", "engraving", "add a message" become `modifiers`; a "ships in N weeks" item becomes
`preorder`; a materials/shipping/care paragraph becomes an `infoSections` entry. If a product has
no price, ask; never invent one. SKU codes are not seeded — say so.

**Seeding is additive — the seed never deletes or overwrites anything on the site, and neither do
you.** There is no cleanup flag and no cleanup step. The Stores install adds its own sample catalog to
a new site (a dozen products: "Baseball Cap", "Ceramic Flower Vase", "Crew T-Shirt", ...), and the
live shop lists them next to the owner's, so they are never silent: the result's `preexisting[]` names
every product the plan did not name (`{ id, name, slug }`), and the closing message says so with the
Manage products link (`dashboardProductsUrl` in the result) so the owner removes them there if they
want to. Categories are idempotent by name — a re-run reuses "Donuts" instead of creating a second one.

**Images are confirmed, not assumed.** `imagesAttached` counts the attaches the API reported as
successful; `imageFailures: [{ name, error }]` names the products left without an image and why.
`choiceImagesLinked` counts the choice photos linked to their choice, `choiceImageFailures:
[{ name, choice, error }]` the ones that are in the gallery but not linked (a re-run links them)
(one miss out of three was seen live — a revision moved between read and update). The seed already
retries a miss once. To retry again, re-run the same plan: existing products are reused and their
images attached; nothing is duplicated.

**A bulk create can partially succeed.** The result carries `failures: [{ name, error }]` next
to `products` — read it. A non-empty `failures` means those products are genuinely absent, not
mis-mapped, so the rest of the catalog is fine to build on. To retry, re-run the **same** plan:
creation is idempotent by name, so products that already exist are skipped rather than
duplicated. Never hand-patch ids to "fill the gap".

Two things this module does not seed (dashboard-only — tell the merchant): **SKUs** and
**subscription plans** (the storefront renders them when the merchant adds them).

## Escape hatch — individual functions

`setupStore` is built from exported steps; import them only for a partial re-seed or custom
ordering: `installStoresApp`, `readAllProducts`, `bulkCreateProducts`,
`createCategories(ctx, names, details?)`, `addProductsToCategories`, `attachProductImages` — plus
`makeCtx()` for the auth context.

## Reference

If a call returns an unexpected shape or you need an operation this module doesn't cover, read
the live Wix API reference — never guess. Every call in the script carries a `docs:` line
with its reference page. Key pages:

- Bulk Create Products With Inventory: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-create-products-with-inventory.md
- Create Category: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/create-category.md
- Bulk Add Items To Category: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/bulk-add-items-to-category.md
- Bulk Update Products (image attach): https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products.md
