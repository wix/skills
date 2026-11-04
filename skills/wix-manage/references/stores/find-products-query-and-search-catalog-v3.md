---
name: "Find Products (Query and Search, Catalog V3)"
description: Find, search, query, and list products from a Wix Store using Catalog V3 Search Products, Query Products, Get Product, and Query Inventory Items: by name, SKU, option choice, stock status, or price, with sorting and paging; reading one product's variants and details; and listing products with their variant count and stock.
---

# RECIPE: Business Recipe – Find Products in a Wix Store (Query and Search, Catalog V3)

> These calls need the Wix Stores app on the site (`appDefId` `215238eb-22a5-4c36-9e7b-e7c08025e04e`); a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [List Installed Apps](../app-installation/list-installed-apps.md) shows what the site has; [Install Wix Apps](../app-installation/install-wix-apps.md) adds it by that id.


Find products in a Wix store using the Catalog V3 Search Products and Query Products APIs. To change the products you find, continue with [Update Product with Options (Catalog V3)](update-product-with-options.md); to change their stock, with [Update Product Stock and Pre-Order (Catalog V3)](update-product-stock-and-pre-order.md).

## Article: How to Find Products

### STEP 0: Choose the right product lookup method

Every call in this recipe is complete and was run as written: send it without looking up its schema first. Open a linked method page only for a field the recipe does not show.

**Search Products lags behind new products.** It reads a search index that can miss products created in the last seconds (and, on a site set up minutes ago, for longer). Query Products reads the catalog itself and returns new products at once. So:

1. **Price and stock-status questions** ("under $20", "which products are out of stock"): send one Query Products call with `cursorPaging.limit: 100`. If `pagingMetadata.hasNext` is `false`, that page is the whole catalog: select in code (STEP 5). If `hasNext` is `true`, answer with the Search Products filter (STEP 1) instead, and do not page the catalog.
2. **Full listings** (every product, variant count and stock): page Query Products (STEP 5) for the products and their variant count, then page Query Inventory Items and combine them per `productId` with the STEP 7 code, which reports untracked variants as in stock, not as 0 units.
3. **Specific products** by name, SKU or option choice: Search Products (STEP 1). When it finds nothing, page Query Products and match in code before you say the product does not exist.

Use **Get Product** for one product's variants, and **Query Inventory Items** for stock quantities.

| Need | Endpoint | Notes |
| ---- | -------- | ----- |
| One product by its exact name | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) with `filter.name` | Exact match, case-insensitive (STEP 1). |
| Products whose name contains a word ("all SA21 items") | Search Products with `search.search` | Free text over the fields you name (STEP 1). |
| A product by SKU | Search Products with `variantsInfo.variants` `$matchItems` | Free text on a SKU is unreliable (STEP 1). |
| Products that have an option choice ("every product with an Orange color") | Search Products with `options.choicesSettings.choices.name` | Case-insensitive (STEP 1). |
| List all products or page through the catalog | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) | Cursor paging only (STEP 5). |
| Products by price — "products under $20", "between $10 and $50" | One Query Products page; Search Products `actualPriceRange` filter when the catalog has more pages | Rule 1 above (STEP 1, STEP 5). |
| Out-of-stock products | One Query Products page; Search Products `inventory.availabilityStatus` filter when the catalog has more pages | Rule 1 above (STEP 1, STEP 5). |
| Filter by `id`, `slug`, `handle`, dates, or `visible` | Query Products | STEP 4. |
| One product's variants, prices, SKUs, cost, description or categories | [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) | Search and Query return no variants (STEP 6). |
| Stock quantity per variant, total stock per product, negative stock | [Query Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/query-inventory-items) | Products carry an availability status, not a quantity (STEP 7). |

### STEP 1: Search products by name, SKU, option, stock status, or price

The price and stock-status filters below are for catalogs of more than one Query Products page (rule 1 in STEP 0); they share the index lag described there.

Search Products is `POST https://www.wixapis.com/stores/v3/products/search`. Free text goes in `search.search`; exact and structured criteria go in `search.filter`. Send only the part you need.

**Exact name** (`$eq`, `$in` and `$startsWith` on `name` ignore case: `"test eye serum"` finds `"Test Eye Serum"`. With `$eq`, part of a name finds nothing; `$startsWith` matches the start of a name):

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "filter": { "name": "Blue Shirt" }
  }
}'
```

**A word in the name.** The default `mode` is `OR`: `"Blue Shirt"` also returns every product with "Blue" or "Shirt" in its name. Send `"mode": "AND"` so that all words must be present, and still compare the returned names before you act on a product:

```json
{ "search": { "search": { "expression": "sa21", "fields": ["name"], "mode": "AND" } } }
```

**A SKU.** A free-text search on `variantsInfo.variants.sku` splits the SKU at `-` and can return the whole catalog. Match the SKU exactly (case-insensitive):

```json
{ "search": { "filter": { "variantsInfo.variants": { "$matchItems": [{ "sku": "TEE-RED-L" }] } } } }
```

**An option choice name** (case-insensitive), such as every product that sells an Orange color:

```json
{ "search": { "filter": { "options.choicesSettings.choices.name": { "$hasSome": ["Orange"] } } } }
```

**Stock status:** `{ "search": { "filter": { "inventory.availabilityStatus": { "$in": ["OUT_OF_STOCK", "PARTIALLY_OUT_OF_STOCK"] } } } }`. `PARTIALLY_OUT_OF_STOCK` means some of the product's variants are out of stock; leave it out when the user asks only about products that cannot be bought at all.

**Price.** `actualPriceRange.minValue.amount` is the price of the product's cheapest variant, and takes a number. "Products under $20" is this complete request:

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "filter": { "actualPriceRange.minValue.amount": { "$lt": 20 } },
    "cursorPaging": { "limit": 100 }
  }
}'
```

Read each product's price from `products[].actualPriceRange.minValue.amount` (a string, such as `"12"`). A field takes one operator: for "between $10 and $50" send `{ "$and": [ { "actualPriceRange.minValue.amount": { "$gte": 10 } }, { "actualPriceRange.minValue.amount": { "$lte": 50 } } ] }`; `{ "$gte": 10, "$lte": 50 }` on one field returns `400 Filter must contain single operator`. Add `"search": { "expression": "Shirt", "fields": ["name"], "mode": "AND" }` beside the filter to combine price with a word in the name.

The response puts the matches in `products`:

```json
{
  "products": [
    { "id": "...", "name": "Blue Shirt", "slug": "blue-shirt", "variantSummary": { "variantCount": 1 } }
  ],
  "pagingMetadata": { "count": 1, "hasNext": false, "cursors": {} }
}
```

Query Products returns the same envelope. Search Products takes up to 100 results per page in `search.cursorPaging.limit` and pages like Query Products (STEP 5). Search Products drops a deleted product at once, but can miss a product created in the last few seconds, which Query Products already returns. So when a name lookup finds nothing, page Query Products (STEP 5) and match `name` in code, ignoring case, before you tell the user the product does not exist.

### STEP 2: Query products with structured filters, sorting, or paging

Use the **POST** [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) endpoint to query products. The endpoint returns up to 100 products per request.

**Endpoint:** `POST https://www.wixapis.com/stores/v3/products/query`

**Basic query (first 100 products, default fields):**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": { "cursorPaging": { "limit": 100 } }
}'
```

This returns products with their default fields, including `inventory` for product-level availability and `variantSummary.variantCount`.

Take availability from `inventory`, and look up any other field you need in the Catalog V3 docs rather than carrying a name over from Catalog V1 — the two catalogs do not share a product shape. A name that isn't on the V3 product reads as `undefined` rather than raising, so the request still succeeds and a check against it quietly matches nothing: an availability question answered that way returns an empty list, which reads as "everything is in stock" instead of as a failure.

### STEP 3: Understanding the `fields` parameter

The `fields` array requests **additional** fields beyond the defaults. It does **NOT** accept property names like `"name"` or `"id"`.

**⚠️ CRITICAL: Valid `fields` enum values:**

| Enum Value                         | Description                  |
| ---------------------------------- | ---------------------------- |
| `URL`                              | Product page URL             |
| `CURRENCY`                         | Currency information         |
| `INFO_SECTION`                     | Info sections (rich content) |
| `MERCHANT_DATA`                    | Merchant-specific data       |
| `PLAIN_DESCRIPTION`                | Plain text description       |
| `INFO_SECTION_PLAIN_DESCRIPTION`   | Info section plain text      |
| `SUBSCRIPTION_PRICES_INFO`         | Subscription pricing         |
| `BREADCRUMBS_INFO`                 | Category breadcrumbs         |
| `WEIGHT_MEASUREMENT_UNIT_INFO`     | Weight unit info             |
| `VARIANT_OPTION_CHOICE_NAMES`      | Variant option choice names  |
| `MEDIA_ITEMS_INFO`                 | Additional media items       |
| `DESCRIPTION`                      | Rich text description        |
| `DIRECT_CATEGORIES_INFO`           | Direct category info         |
| `ALL_CATEGORIES_INFO`              | All category info            |
| `MIN_PRICE_VARIANT`                | Lowest-priced visible variant |
| `INFO_SECTION_DESCRIPTION`         | Info section rich content    |
| `THUMBNAIL`                        | Thumbnail image              |
| `DIRECT_CATEGORY_IDS`              | Direct category IDs          |
| `PRODUCT_CHOICES_MEDIA_REFERENCES` | Choice-specific media        |

**WRONG – these are NOT valid field values:**

```json
"fields": ["id", "name", "slug", "visible", "priceData"]
```

**CORRECT – use enum constants or leave empty for defaults:**

```json
"fields": []
```

**CORRECT – requesting additional fields:**

```json
"fields": ["DESCRIPTION", "URL", "ALL_CATEGORIES_INFO"]
```

### STEP 4: Filtering and sorting with Query Products

`QueryProducts` supports filters only on these fields. `name` and price are not among them (a `name` filter returns `400 Field 'name' is not declared as filterable`), so find products by name or price with Search Products (STEP 1) rather than paging the whole catalog and comparing in your own code:

| Field | Supported Filters | Sortable |
| ----- | ----------------- | -------- |
| `id` | `$eq`, `$ne`, `$exists`, `$in`, `$startsWith` | No |
| `handle` | `$eq`, `$ne`, `$exists`, `$in`, `$startsWith` | No |
| `options.id` | `$isEmpty`, `$hasAll`, `$hasSome` | No |
| `slug` | `$eq`, `$ne`, `$exists`, `$in`, `$startsWith` | Yes |
| `createdDate` | `$eq`, `$ne`, `$exists`, `$in`, `$lt`, `$lte`, `$gt`, `$gte` | Yes |
| `updatedDate` | `$eq`, `$ne`, `$exists`, `$in`, `$lt`, `$lte`, `$gt`, `$gte` | Yes |
| `visible` | `$eq`, `$ne`, `$exists`, `$in` | Yes |

**Query with filter and sort:**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "fields": [],
  "query": {
    "filter": {
      "visible": true
    },
    "sort": [
      {
        "fieldName": "createdDate",
        "order": "ASC"
      }
    ],
    "cursorPaging": {
      "limit": 50
    }
  }
}'
```

**Filter by product IDs:**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "fields": [],
  "query": {
    "filter": {
      "id": {
        "$in": [
          "product-id-1",
          "product-id-2"
        ]
      }
    }
  }
}'
```

### STEP 5: Handling pagination

Query Products and Search Products page with a cursor. Offset paging is silently ignored: `"paging": { "limit": 5, "offset": 5 }` returns the first page again, so a loop that raises `offset` never reaches the next products. Page like this:

1. Send the first request with `cursorPaging: { "limit": 100 }` (inside `query`, or inside `search` for Search Products) and any `filter` and `sort`.
2. While `pagingMetadata.hasNext` is `true`, send the cursor without `filter` or `sort`: `{ "query": { "cursorPaging": { "limit": 100, "cursor": "<pagingMetadata.cursors.next>" } } }` for Query Products, `{ "search": { "cursorPaging": { ... } } }` for Search Products. The cursor keeps the first request's filter and sort. Keep a top-level `fields` array on every page, or the later pages come back without those fields.

```javascript
const products = [];
let body = { query: { cursorPaging: { limit: 100 } } };
for (;;) {
  const page = (await wix.request({ method: "POST", url: "https://www.wixapis.com/stores/v3/products/query", body })).data;
  products.push(...page.products);
  if (!page.pagingMetadata.hasNext) break;
  body = { query: { cursorPaging: { limit: 100, cursor: page.pagingMetadata.cursors.next } } };
}
```

Each product carries `actualPriceRange.minValue.amount` (the cheapest variant's price, a string such as `"12"`) and `inventory.availabilityStatus` (`IN_STOCK`, `OUT_OF_STOCK`, `PARTIALLY_OUT_OF_STOCK`) by default. For a price or stock question, when the first page (`limit: 100`) has `hasNext: false`, select in the same execution; when it has `hasNext: true`, send the Search Products filter from STEP 1 instead of fetching more pages:

```javascript
const underTwenty = products.filter(p => Number(p.actualPriceRange?.minValue?.amount) < 20);
const outOfStock = products.filter(p => ["OUT_OF_STOCK", "PARTIALLY_OUT_OF_STOCK"].includes(p.inventory?.availabilityStatus));
```

`PARTIALLY_OUT_OF_STOCK` means some of the product's variants are out of stock; leave it out when the user asks only about products that cannot be bought at all.

### STEP 6: Read one product's details and variants

Search and Query do not return `variantsInfo`. For variants, prices, SKUs, cost, the description or categories of a product, call [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) with the `id` from STEP 1, and add the `fields` the question needs (repeat `fields` once per value):

```bash
curl -X GET 'https://www.wixapis.com/stores/v3/products/{productId}?fields=VARIANT_OPTION_CHOICE_NAMES&fields=MERCHANT_DATA&fields=PLAIN_DESCRIPTION' \
-H 'Authorization: <AUTH>'
```

The response is `{ "product": { ... } }`. The fields to read:

| Field | What it holds |
| --- | --- |
| `product.variantsInfo.variants[]` | `id`, `sku`, `price.actualPrice.amount`, `choices[].optionChoiceNames` (with `VARIANT_OPTION_CHOICE_NAMES`), `inventoryStatus.inStock` |
| `product.options[].choicesSettings.choices[]` | Each choice's `name`, `colorCode`, and its photos (request `PRODUCT_CHOICES_MEDIA_REFERENCES`) |
| `product.costRange`, `variants[].revenueDetails.cost` | Cost, with `MERCHANT_DATA`. `revenueDetails` is absent when no cost was set |
| `product.plainDescription` | Description as HTML, with `PLAIN_DESCRIPTION` |
| `product.directCategoriesInfo` | Categories, with `DIRECT_CATEGORIES_INFO` |

`inventoryStatus` on a variant has `inStock` and `preorderEnabled` only, never a quantity. For quantities, use STEP 7.

### STEP 7: Stock quantities, variant count and total stock

Stock lives in inventory items, one per variant (and per location when the store has several). [Query Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/query-inventory-items) is `POST https://www.wixapis.com/stores/v3/inventory-items/query`, up to 1000 items per page:

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/inventory-items/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {
    "filter": { "productId": { "$in": ["product-id-1", "product-id-2"] } },
    "cursorPaging": { "limit": 1000 }
  }
}'
```

Each item in `inventoryItems[]` has `id`, `revision`, `productId`, `variantId`, `trackQuantity`, `availabilityStatus` and `product.name`, `product.variantName`, `product.variantSku`. A tracked item (`trackQuantity: true`) has `quantity`; an untracked item has `inStock` (`true` or `false`) and no `quantity`. Other useful filters: `{ "quantity": { "$lt": 0 } }` for negative stock, `{ "product.variantSku": "TEE-RED-L" }` for one SKU (case-sensitive). `product.name` matching here is case-sensitive, so find products by name with Search Products first and filter inventory by `productId`.

Inventory paging returns no `hasNext`: request the next page while `pagingMetadata.cursors.next` is present.

To list every product with its variant count and total stock, take the product list from Query Products (STEP 5), with `variantSummary.variantCount`; not from Search Products, which can miss new products, and not from inventory items, which have no entry for a product created without inventory. Then page Query Inventory Items with no filter and sum per `productId`:

```javascript
const stock = {};
for (const item of inventoryItems) {
  const entry = stock[item.productId] ??= { units: 0, untrackedInStock: 0, untrackedOutOfStock: 0 };
  if (item.trackQuantity) entry.units += item.quantity;
  else if (item.inStock) entry.untrackedInStock += 1;
  else entry.untrackedOutOfStock += 1;
}
const rows = products.map(p => ({ name: p.name, variants: p.variantSummary.variantCount, ...stock[p.id] }));
```

Take the stock from the inventory items, not from the product's `inventory.availabilityStatus`: right after a create or a stock change, that product status lags for a few seconds (a new product created in stock reads `OUT_OF_STOCK`), while its inventory items are already right. Right after a create the inventory query can also return fewer items than `variantSummary.variantCount`: when it does, wait 3 seconds and query again (up to 3 times) before you sum. Report untracked variants as "in stock, quantity not tracked" (or out of stock, when `inStock` is `false`) rather than adding them as 0 units. Only a product that still has no inventory items after those retries was created without inventory; report it from the product's `inventory.availabilityStatus`, which is `OUT_OF_STOCK` for such a product.

---

## Important Notes

- **Variant data is NOT returned** by Query Products or Search Products. To get variant details, use Get Product (STEP 6) for individual products.
- **Non-visible products** require the `SCOPE.STORES.PRODUCT_READ_ADMIN` permission.
- Default fields include: `id`, `name`, `slug`, `visible`, `productType`, `inventory`, `media`, `variantSummary`, `createdDate`, `updatedDate`.
- **Availability and price are not in STEP 4's filterable set.** For out-of-stock products or a price range, select in code on a one-page catalog, or use the Search Products filters (rule 1 in STEP 0), rather than putting them in `query.filter`.
- The `fields` parameter adds fields **on top of** the defaults — you never need to request `id` or `name` explicitly.

## Conclusion

To find specific products by name, SKU, option choice or free text, use `POST https://www.wixapis.com/stores/v3/products/search`. To list, page, sort, or structurally filter products, use `POST https://www.wixapis.com/stores/v3/products/query` with `cursorPaging`; for a price or stock question, select in code when the catalog fits in one page, and use the Search Products filters otherwise. For a product's variants, use `GET https://www.wixapis.com/stores/v3/products/{productId}`; for stock quantities, `POST https://www.wixapis.com/stores/v3/inventory-items/query`. Use `fields: []` for defaults, or pass valid enum values like `DESCRIPTION`, `URL`, `ALL_CATEGORIES_INFO` for additional data. Never pass property names as field values.
