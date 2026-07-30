---
name: "Find Products (Query and Search, Catalog V3)"
description: Find, search, query, and list products from a Wix Store using Catalog V3 Search Products and Query Products endpoints. Explains when to use each endpoint, correct fields enum values, filtering, sorting, and paging.
---

# RECIPE: Business Recipe – Find Products in a Wix Store (Query and Search, Catalog V3)

Find products in a Wix store using the Catalog V3 Search Products and Query Products APIs.

## Article: How to Find Products

### STEP 0: Choose the right product lookup method

Use **Search Products** for text search and name-based lookup. Use **Query Products** for structured filtering, sorting, paging, and listing products.

| Need | Endpoint | Notes |
| ---- | -------- | ----- |
| Find products by name or free text | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) | Best for user-provided names, keywords, and broad product lookup. |
| List all products or page through the catalog | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) | Supports paging and structured filters on the fields listed below. |
| Filter by `id`, `slug`, `handle`, dates, or `visible` | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) | Best for exact structured criteria. |
| Need exact name matching after text lookup | [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) + client-side match | Search by the name text, then match the returned `product.name` in your own code. |
| Find which products are out of stock | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) + client-side select | Stock lives on `inventory`, **not** `stock`, and is not filterable. See STEP 6. |

### STEP 1: Search products by name or free text

Use Search Products when the user gives a product name, keyword, or other text expression:

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "expression": "Blue Shirt"
  }
}'
```

For exact name matching, search with the user-provided text and then compare the returned `product.name` values in your own code.

### STEP 2: Query products with structured filters, sorting, or paging

Use the **POST** [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) endpoint to query products. The endpoint returns up to 100 products per request.

**Endpoint:** `POST https://www.wixapis.com/stores/v3/products/query`

**Basic query (all products, default fields):**

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": {}
}'
```

This returns all products with their default fields (`id`, `name`, `slug`, `visible`, `productType`, `inventory`, `media`, `actualPriceRange`, `createdDate`, `updatedDate`, and more).

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
| `MIN_VARIANT_PRICE_INFO`           | Minimum variant price        |
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

`QueryProducts` supports filters only on these fields:

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
        "field_name": "createdDate",
        "order": "ASC"
      }
    ],
    "paging": {
      "limit": 50,
      "offset": 0
    }
  }
}'
```

To filter by several product IDs, use the same shape with `"filter": {"id": {"$in": ["id-1", "id-2"]}}`.

### STEP 5: Handling pagination

The endpoint returns at most 100 products per request. Raise `query.paging.limit` to 100, then check the response `pagingMetadata` to determine whether more pages exist and continue paging until they are exhausted.

### STEP 6: Find which products are out of stock

Stock is on the product as **`inventory`**. There is **no `stock` field** on a Catalog V3 product, so `product.stock` is always `undefined` and any check on it silently matches nothing.

`inventory` is returned **by default** — no `fields` enum value requests it, and none is needed:

```json
"inventory": {
  "availabilityStatus": "OUT_OF_STOCK",
  "preorderStatus": "DISABLED",
  "preorderAvailability": "NO_VARIANTS"
}
```

`inventory.availabilityStatus` is one of exactly three values:

| Value | Meaning |
| ----- | ------- |
| `IN_STOCK` | All variants are in stock and available for purchase. |
| `OUT_OF_STOCK` | All variants are out of stock. |
| `PARTIALLY_OUT_OF_STOCK` | Some variants are out of stock, some are in stock. |

`inventory` is **absent from STEP 4's filterable field list**, so `QueryProducts` cannot filter on it — put it in `query.filter` and the request is rejected. Answer the question in **one** query call and select in your own code:

```js
// products from POST /stores/v3/products/query with "fields": []
const outOfStock = products.filter(
  (p) => p.inventory?.availabilityStatus === 'OUT_OF_STOCK'
      || p.inventory?.availabilityStatus === 'PARTIALLY_OUT_OF_STOCK',
);
```

Include `PARTIALLY_OUT_OF_STOCK` — those products do have out-of-stock variants, and omitting them under-reports. Page until `pagingMetadata.hasNext` is `false` so no product is missed.

**Only for per-variant or per-location stock detail**, use Inventory Items V3 — do not reach for it just to list out-of-stock products:

**Endpoint:** `POST https://www.wixapis.com/stores/v3/inventory-items/query`

It *can* filter on `availabilityStatus` (`IN_STOCK`, `OUT_OF_STOCK`, `PREORDER` — a different enum from the product's), and on `inStock`, `quantity`, `trackQuantity`, `productId`, and `product.name`. Items with `trackQuantity: true` carry a numeric `quantity`; items with `trackQuantity: false` carry a boolean `inStock` instead.

---

## Important Notes

- **Variant data is NOT returned** by Query Products. To get variant details, use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) for individual products.
- **Non-visible products** require the `SCOPE.STORES.PRODUCT_READ_ADMIN` permission.
- Default fields include: `id`, `name`, `slug`, `visible`, `productType`, `inventory`, `media`, `actualPriceRange`, `compareAtPriceRange`, `variantSummary`, `createdDate`, `updatedDate`.
- There is **no `stock` field and no `priceData` field** on a Catalog V3 product. `priceData` is Catalog V1; in V3 prices are `actualPriceRange` / `compareAtPriceRange`, and stock is `inventory` (see STEP 6).
- The `fields` parameter adds fields **on top of** the defaults — you never need to request `id` or `name` explicitly.

## Conclusion

To find products by name or free text, use `POST https://www.wixapis.com/stores/v3/products/search`. To list, page, sort, or structurally filter products, use `POST https://www.wixapis.com/stores/v3/products/query`. Use `fields: []` for defaults, or pass valid enum values like `DESCRIPTION`, `URL`, `ALL_CATEGORIES_INFO` for additional data. Never pass property names as field values.
