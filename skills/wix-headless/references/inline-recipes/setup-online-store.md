---
name: "Setup Online Store"
description: Initializes a Stores catalog with Catalog V3 — cleans default sample products, then bulk-creates products with options/variants/inventory (visible), and creates + assigns categories. Specifies the *how* (calls + format); counts and the specific products/categories come from the request being fulfilled.
---
**RECIPE**: Business Recipe – Initial Setup for a Wix Online Store (Catalog V3)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for preparing any new Wix site that uses the Online Stores app with Catalog V3.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial catalog setup.

> **This recipe is the *how*, not the *what*.** What to seed — how many products, which are in/out of stock, which categories — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities or which items to create.

> **API surfaces:** products use Catalog V3 (`https://www.wixapis.com/stores/v3/...`). The Categories API is the exception — it lives on a `v1` endpoint (`https://www.wixapis.com/categories/v1/categories`). Don't mix in any pre-V3 product endpoints.

---

## Article: Steps for Setting Up a Wix Online Store
**YOU MUST** complete the following steps **in the given order** (1-4) and **without requiring additional user input**. One conditional: **the category steps (3-4) run only when the request names categories** — if `intent.stores.categoriesNamed` is empty, **create none** (skill policy, per `SEED.md` § "What to seed per capability") and skip the category steps. Products (steps 1-2) always run; the **Attach images** step runs last, only when `imagery` is on.

**⚠️ CRITICAL ORDER REQUIREMENT: Do the product operations FIRST (clean + create, Steps 1-2), then categories (Steps 3-4). Categories API might take some time to be fully available after Stores installation, so always finish products before attempting category operations.**

### STEP 1: Clean the store — remove the default sample products

A freshly provisioned Wix Stores app comes pre-seeded with demo/sample products. Remove them **before** creating yours, so the storefront shows only your catalog. Do this **first** — cleaning before you create guarantees the ids you delete are the install's samples, never your own products.

1. **List the existing products** — `POST https://www.wixapis.com/stores/v3/products/query` with body `{"query": {"paging": {"limit": 50}}}`. Collect every `product.id` from the response.
2. **Bulk-delete them in one call** — `POST https://www.wixapis.com/stores/v3/bulk/products/delete` with body `{"productIds": ["<id1>", "<id2>", …]}` (the ids from step 1; up to 100 per call). The query on a fresh install returns the sample products; delete exactly those ids.

### STEP 2: Bulk-create the products (with options)

Create the products in a **single bulk request** to `POST https://www.wixapis.com/stores/v3/bulk/products-with-inventory/create`. **How many products, and which are in or out of stock, are set by the request you're fulfilling — this step only gives the call and the required format.** Each product needs a real web image URL relevant to it, and `price` via `actualPrice` (+ optional `compareAtPrice`).

**⚠️ CRITICAL: PRODUCT & VARIANT VISIBILITY — set `"visible": true` explicitly.**
Storefront product queries (`searchProducts` / `queryProducts`) return **only visible products** to site visitors. A product created without `"visible": true` is created successfully but will **NOT appear** on the live site — the catalog looks empty. So:
- Set `"visible": true` on **every product** (product level).
- Set `"visible": true` on **every variant**. A variant with `inventoryItem.quantity > 0` is buyable; a variant that should be out-of-stock stays `"visible": true` with `"quantity": 0`.
- Never rely on a default — always include `visible`.

**Request body shape** (one representative product shown — repeat product objects inside the `products` array):

```json
{
  "products": [
    {
      "name": "Pro Basketball Sneaker",
      "productType": "PHYSICAL",
      "physicalProperties": {},
      "visible": true,
      "visibleInPos": true,
      "description": {
        "nodes": [
          {
            "type": "PARAGRAPH",
            "id": "desc1",
            "nodes": [{ "type": "TEXT", "textData": { "text": "High-performance basketball sneaker with superior ankle support." } }],
            "paragraphData": { "textStyle": { "textAlignment": "AUTO" } }
          }
        ],
        "metadata": { "version": 1, "id": "basketball-desc-001" }
      },
      "options": [
        {
          "name": "Size",
          "optionRenderType": "TEXT_CHOICES",
          "choicesSettings": { "choices": [ { "choiceType": "CHOICE_TEXT", "name": "8" }, { "choiceType": "CHOICE_TEXT", "name": "9" } ] }
        },
        {
          "name": "Color",
          "optionRenderType": "SWATCH_CHOICES",
          "choicesSettings": { "choices": [ { "choiceType": "ONE_COLOR", "name": "Red", "colorCode": "#FF0000" }, { "choiceType": "ONE_COLOR", "name": "Blue", "colorCode": "#0000FF" } ] }
        }
      ],
      "variantsInfo": {
        "variants": [
          {
            "choices": [
              { "optionChoiceNames": { "optionName": "Size", "choiceName": "8", "renderType": "TEXT_CHOICES" } },
              { "optionChoiceNames": { "optionName": "Color", "choiceName": "Red", "renderType": "SWATCH_CHOICES" } }
            ],
            "price": { "actualPrice": { "amount": "159.99" }, "compareAtPrice": { "amount": "200.00" } },
            "visible": true,
            "inventoryItem": { "quantity": 25, "preorderInfo": { "enabled": false } },
            "physicalProperties": {}
          }
        ]
      }
    }
  ],
  "returnEntity": true
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **Description MUST be rich-text nodes**, not a plain string — a plain string causes an `"Expected an object"` error. Use the `{ "nodes": [...], "metadata": {...} }` shape shown.
- **Media — gated by the `imagery` policy (`SEED.md` § "Entity images"), no exception for stores.** **Always create products text-only here** — omit `media`. When `imagery` is **on**, the **Attach images** step below writes generated brand images in a second pass; it does **not** happen at create time.
- **Physical products MUST set `"productType": "PHYSICAL"` and an empty `"physicalProperties": {}`** (on the product and on each variant).
- **Options:** text options use `"optionRenderType": "TEXT_CHOICES"` + `"choiceType": "CHOICE_TEXT"`; color options use `"optionRenderType": "SWATCH_CHOICES"` + `"choiceType": "ONE_COLOR"` + a `colorCode`.
- **Variants = the full Cartesian product** of all option choices; each variant references **all** options via `optionChoiceNames`, sets `price.actualPrice.amount` (+ optional `compareAtPrice.amount`) as **strings**, and `inventoryItem.quantity`.
- If part of the bulk request fails, retry the failed products **once** with the exact same format; do not loop.

**⚠️ CRITICAL: options/variants are for things the buyer *selects and buys* — not for attributes you only filter or display by.** Make something an `option` (and thus a variant) **only if the buyer picks it to purchase a distinct SKU** (Size, Color, Format). An attribute you merely **filter, badge, or display by** — roast level, material, genre, "new arrival" — is **not** a variant: encode it in the **product name**, its **category**, or `description`, and never as an option. Modeling a display-only attribute as an option multiplies the variant Cartesian product for nothing (slower seeding, larger payload) and produces a buyer-facing selector that shouldn't exist. (A single-variant product is fine — give it one variant with no options.) **Default cardinality — keep it small:** unless the request names specific options, give each product **at most one option with ≤3 choices** (≤3 variants); many products legitimately have **none** (a single variant). This is a floor, not a cap — honor a larger/explicit option set when intent names one. The two-option example above shows the multi-option *format*; it is not the default shape to reach for.

**⚠️ Reading the response — created products are under `productResults.results[]`, NOT a top-level `results`.** A successful bulk create returns `200` with this shape:

```json
{ "productResults": { "results": [
  { "itemMetadata": { "id": "<productId>", "originalIndex": 0, "success": true },
    "item": { "id": "<productId>", "slug": "<slug>", "name": "…", "visible": true, … } }
] } }
```

Read each product's **`id`** (→ the `catalogItemId` you'll assign to categories in STEP 4 and the frontend will use) and **`slug`** from `productResults.results[].item`. There is **no** top-level `results` key — reading `response.results` finds nothing and makes a successful create look like it returned zero products. Check `productResults.results` first; **do not re-create on an empty top-level `results`**.

### STEP 3: Create the store's categories

Create the categories for the store — **the categories that fit the user's request.** Which categories (and how many) are set by the request you're fulfilling; this step only gives the call and format.

Use the **Create Category** endpoint: `POST https://www.wixapis.com/categories/v1/categories`. **There is no bulk-create endpoint for `/categories/v1/`** (the `events/v1/bulk/categories/create` URL is for the Events product, not Stores).

**⚠️ CRITICAL: create the categories SEQUENTIALLY — one call at a time, never concurrently.** Every category lives in the single shared `@wix/stores` category tree, which carries **one revision**. Firing the creates concurrently makes them race on that revision: all but one fail with `409 INVALID_REVISION` ("Outdated revision for entity id @wix/stores"), and the failed-then-retried calls can leave **duplicate categories** behind. So issue each create, wait for its response, then issue the next. (There are only a handful of categories — the serial cost is negligible.)

The request body must include a top-level `treeReference` field — it must **not** be nested inside the `category` object:

```json
{
  "category": {
    "name": "Drinkware",
    "description": "The Drinkware category includes a wide range of containers designed for holding beverages",
    "visible": true
  },
  "treeReference": {
    "appNamespace": "@wix/stores",
    "treeKey": null
  }
}
```

### STEP 4: Add Each Product to a Category

Add each product to the category it belongs to (per the request you're fulfilling). Acquire the product ids (from STEP 2's response) first. Use the **Bulk Add Items To Category** endpoint — products are the `items`: `POST https://www.wixapis.com/categories/v1/bulk/categories/{categoryId}/add-items` (one call per `categoryId` — the path parameter is single).

**Issue these add-items calls SEQUENTIALLY too** — one call at a time, waiting for each response before the next. They mutate the same shared `@wix/stores` tree as the creates above, so concurrent calls risk the same `409 INVALID_REVISION` race. Serial is the safe, deterministic choice (the category count is small).

The request body is `items` (each with the product's `catalogItemId` and the Stores `appId`) plus a `treeReference` at the **same level** as `items` (not nested):

```json
{
  "items": [
    { "catalogItemId": "<productId>", "appId": "215238eb-22a5-4c36-9e7b-e7c08025e04e" }
  ],
  "treeReference": {
    "appNamespace": "@wix/stores",
    "treeKey": null
  }
}
```

### Attach images (imagery ON only — skip otherwise)

**Only when `imagery` is on** (`SEED.md` § "Entity images"). Products were created text-only above; this pass-2 step writes a generated brand image onto each. Generate + import per `references/IMAGE_GENERATION.md`, keep `file.url`, then PATCH the product.

- The field that persists is **`media.itemsInfo.items`**, NOT `media.main`. `PATCH /stores/v3/products/{id}` setting `"media": { "itemsInfo": { "items": [ { "url": "<static.wixstatic.com/…>", "altText": "…" } ] } }`; the image may be referenced by a `static.wixstatic.com` **`url`** or by its Wix Media **`id`** (`<hash>~mv2.png`), either works.
- **⚠️ `media.main` set ALONE silently no-ops** — a `200` comes back but re-query shows no image; that is the trap. The server promotes the first `itemsInfo.items` entry to `media.main` for you, so **verify success by reading `media.main`** (`media.main.image.url` resolves to a `static.wixstatic.com` URL). Conversely `media.itemsInfo` is **write-only** — it comes back `null` on read, so never assert on it.
- **428 prevention:** first `GET /stores/v3/products/{id}` for its **`revision` + `options` + `variantsInfo`** and echo all three back in the PATCH body — do **not** send a field mask (the validator runs before masking).
- Send **one image per product** (primary); a larger gallery is out of scope for the seed.
- **Never block on image failure** — skip and leave the product text-only.

---

## Conclusion
Following these steps **in order** sets up a new V3 Wix Online Store site:
- Starts from a **clean catalog** — the install's default sample products are removed first.
- Contains the products and categories called for by the request, all created **`visible: true`** so they appear on the live site.
- Each product is connected to the category it belongs to.
- All products follow the correct Catalog V3 API format specified in STEP 2.
